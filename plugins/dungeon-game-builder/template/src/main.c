/* =============================================================
 * Dungeon Game
 * デシジョンテーブル方式 25x16 BG タイル疑似3Dダンジョン
 *  - 前進/後退/左右回転を焼き込みフレームで滑らかにアニメーション
 *  - 扉 (プレイヤー通行可能・エネミー通行不可)、宝箱/階段ビルボード、暗闇セル対応
 * ============================================================= */

#include <genesis.h>
#include "dungeon_data.h"
#include "dungeon_patterns.h"
#include "dungeon_view.h"

#define DUN_USE_TEXT_HUD 1

static const s8 dir_dx[4] = { 0, 1, 0, -1 };
static const s8 dir_dy[4] = { -1, 0, 1, 0 };
static const u16 edge_bits[4] = { DUN_EDGE_N, DUN_EDGE_E, DUN_EDGE_S, DUN_EDGE_W };
static const u16 door_bits[4] = { DUN_DOOR_N, DUN_DOOR_E, DUN_DOOR_S, DUN_DOOR_W };
static const u16 oneway_bits[4] = { DUN_ONEWAY_N, DUN_ONEWAY_E, DUN_ONEWAY_S, DUN_ONEWAY_W };

static u8 floor_index;
static u8 player_x;
static u8 player_y;
static u8 player_dir;
static u16 prev_joy;

/*
 * エネミー: dun_visited と同じフロア別RAM永続パターンで main.c が所有する。
 * ビュー側 (dungeon_view.c) へは DUN_setEnemies() でポインタ+件数だけを渡す。
 * AI (徘徊/追跡/RNG) は render-core.js (JS) と本ファイルの二重実装 — losVisible と
 * 同じパターンなので、値・分岐の順序を変更したら両方に反映すること。
 */
static DunEnemy dun_enemies[DUNGEON_FLOOR_COUNT][DUN_MAX_ENEMIES];
static u16 enemy_rng_state;
static u32 enemy_next_step_vtime;
/* 直近に stepEnemies() を実行した vtimer。スライド進行度 (vtimer - この値) / 間隔 の起点。 */
static u32 enemy_last_step_vtime;

/*
 * ミニマップ自動マッピング用の踏破ビットフィールド (フロアごとに 1 セル = 1 bit)。
 * エディタが許すフロア最大サイズ (MAX_SIZE=20x20, dungeon-service.js) を上限に
 * 400 bit = 50 byte を確保する。DUNGEON_FLOOR_COUNT は dungeon_data.h のコンパイル時
 * マクロなので、フロア数ぶんの配列をここ (main.c) に持てる。
 * フロア数・プレイヤー位置・移動ロジックを既に把握している main.c がゲーム状態として
 * 所有し、描画専任の dungeon_view.c へは現在フロア分のポインタだけを渡す
 * (dungeon_view.c は dungeon_data.h を include していないため配列そのものは持てない)。
 */
#define DUN_VISITED_BYTES 50
static u8 dun_visited[DUNGEON_FLOOR_COUNT][DUN_VISITED_BYTES];

static bool inBounds(const DungeonFloorData *floor, s16 x, s16 y)
{
    return x >= 0 && y >= 0 && x < floor->width && y < floor->height;
}

static u16 edgesAt(const DungeonFloorData *floor, s16 x, s16 y)
{
    if (!inBounds(floor, x, y)) return DUN_EDGE_N | DUN_EDGE_E | DUN_EDGE_S | DUN_EDGE_W;
    return floor->edges[DUN_INDEX(floor, x, y)];
}

static bool hasWallAt(const DungeonFloorData *floor, s16 x, s16 y, u8 dir)
{
    const u8 opposite = (u8)((dir + 2) & 3);
    const s16 nx = x + dir_dx[dir];
    const s16 ny = y + dir_dy[dir];
    if (edgesAt(floor, x, y) & edge_bits[dir]) return TRUE;
    if (!inBounds(floor, nx, ny)) return TRUE;
    return (edgesAt(floor, nx, ny) & edge_bits[opposite]) != 0;
}

/* 扉ビットは境界のどちら側に保存されていても同じ1枚の扉として扱う。 */
static bool hasDoorAt(const DungeonFloorData *floor, s16 x, s16 y, u8 dir)
{
    const u8 opposite = (u8)((dir + 2) & 3);
    const s16 nx = x + dir_dx[dir];
    const s16 ny = y + dir_dy[dir];
    if (!inBounds(floor, x, y) || !inBounds(floor, nx, ny)) return FALSE;
    if (edgesAt(floor, x, y) & door_bits[dir]) return TRUE;
    return (edgesAt(floor, nx, ny) & door_bits[opposite]) != 0;
}

static u8 stairsFlagsAt(const DungeonFloorData *floor, s16 x, s16 y)
{
    if (!inBounds(floor, x, y)) return 0;
    return (u8)(floor->flags[DUN_INDEX(floor, x, y)] & (DUN_FLAG_STAIRS_UP | DUN_FLAG_STAIRS_DOWN));
}

/* (x, y) に現在フロアのアクティブなエネミーがいるか。プレイヤー移動の占有判定で使う。 */
static bool cellHasEnemy(s16 x, s16 y)
{
    u8 i;
    for (i = 0; i < DUN_MAX_ENEMIES; i++)
    {
        if (dun_enemies[floor_index][i].active && dun_enemies[floor_index][i].x == x && dun_enemies[floor_index][i].y == y) return TRUE;
    }
    return FALSE;
}

/* プレイヤーと敵で共有する幾何移動判定。扉は通行可能で、一方通行を尊重する。 */
static bool canTraverse(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    const s16 nx = (s16)x + dir_dx[dir];
    const s16 ny = (s16)y + dir_dy[dir];
    const u8 opposite = (u8)((dir + 2) & 3);
    const u16 current = edgesAt(floor, x, y);
    const u16 next = edgesAt(floor, nx, ny);
    if (!inBounds(floor, nx, ny)) return FALSE;
    if (hasWallAt(floor, x, y, dir)) return FALSE;
    if ((current & (DUN_ONEWAY_N | DUN_ONEWAY_E | DUN_ONEWAY_S | DUN_ONEWAY_W)) && !(current & oneway_bits[dir])) return FALSE;
    if ((next & (DUN_ONEWAY_N | DUN_ONEWAY_E | DUN_ONEWAY_S | DUN_ONEWAY_W)) && !(next & oneway_bits[opposite])) return FALSE;
    return TRUE;
}

/* プレイヤーは扉を通過できるが、エネミーが占有するセルへは進入できない。 */
static bool canMove(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    const s16 nx = (s16)x + dir_dx[dir];
    const s16 ny = (s16)y + dir_dy[dir];
    if (!canTraverse(floor, x, y, dir)) return FALSE;
    /* エネミーが占有するセルへは進入できない (プレイヤー・エネミー双方向でブロックされる) */
    if (cellHasEnemy(nx, ny)) return FALSE;
    return TRUE;
}

/*
 * 現在の floor_index/player_x/player_y のセルを踏破済みとして記録する
 * (ミニマップ自動マッピング用)。ゲーム開始・移動成功・階段到着のたびに呼ぶ。
 * セーブデータやエクスポートには一切影響しないランタイム限定の状態。
 */
static void markVisited(void)
{
    const DungeonFloorData *floor = &dungeon_floors[floor_index];
    const u16 bit = DUN_INDEX(floor, player_x, player_y);
    dun_visited[floor_index][bit >> 3] |= (u8)(1 << (bit & 7));
}

/* ============================================================
 * エネミーAI (render-core.js の同名関数群と line-for-line 対応)
 * ============================================================ */

/* xorshift16: render-core.js の xorshift16 と同一 (shift定数 7, 9, 8)。
 * u16 への暗黙切り詰めが JS 側の "& 0xffff" マスクと同じ効果になる。 */
static u16 enemyRngNext(void)
{
    u16 x = enemy_rng_state;
    x ^= (u16)(x << 7);
    x ^= (u16)(x >> 9);
    x ^= (u16)(x << 8);
    enemy_rng_state = x;
    return x;
}

/* (x, y) がプレイヤー・宝箱・階段・他のアクティブなエネミー (exclude_index は除く) で占有されているか */
static bool enemyBlockedCell(s16 exclude_index, s16 x, s16 y)
{
    const DungeonFloorData *floor = &dungeon_floors[floor_index];
    u8 flags;
    u8 i;
    if (!inBounds(floor, x, y)) return TRUE;
    if (x == player_x && y == player_y) return TRUE;
    flags = floor->flags[DUN_INDEX(floor, x, y)];
    if (flags & (DUN_FLAG_CHEST | DUN_FLAG_STAIRS_UP | DUN_FLAG_STAIRS_DOWN)) return TRUE;
    for (i = 0; i < DUN_MAX_ENEMIES; i++)
    {
        if ((s16)i == exclude_index) continue;
        if (!dun_enemies[floor_index][i].active) continue;
        if (dun_enemies[floor_index][i].x == x && dun_enemies[floor_index][i].y == y) return TRUE;
    }
    return FALSE;
}

/* 敵だけは扉を越えられない。プレイヤー用 canTraverse の扉通過挙動は維持する。 */
static bool enemyCanTraverse(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    if (hasDoorAt(floor, x, y, dir)) return FALSE;
    return canTraverse(floor, x, y, dir);
}

/* enemyCanTraverse + enemyBlockedCell (宝箱/階段を含む占有ブロック) の合成判定 */
static bool enemyCanMove(const DungeonFloorData *floor, s16 exclude_index, u8 x, u8 y, u8 dir)
{
    s16 nx;
    s16 ny;
    if (!enemyCanTraverse(floor, x, y, dir)) return FALSE;
    nx = (s16)x + dir_dx[dir];
    ny = (s16)y + dir_dy[dir];
    return !enemyBlockedCell(exclude_index, nx, ny);
}

/* 敵の視界判定用: 壁・扉のどちらも遮る (プレイヤー移動可否の hasWallAt とは異なり、扉も視線を遮る) */
static bool enemySightBlocked(const DungeonFloorData *floor, s16 x, s16 y, u8 dir)
{
    return hasWallAt(floor, x, y, dir) || hasDoorAt(floor, x, y, dir);
}

/* 視界: 正面直線 DUN_ENEMY_SIGHT_RANGE マス以内。壁と扉の両方が遮る */
static bool enemySeesPlayer(const DungeonFloorData *floor, const DunEnemy *enemy)
{
    const u8 dir = enemy->dir & 3;
    s16 cx = enemy->x;
    s16 cy = enemy->y;
    u8 step;
    for (step = 0; step < DUN_ENEMY_SIGHT_RANGE; step++)
    {
        if (enemySightBlocked(floor, cx, cy, dir)) return FALSE;
        cx += dir_dx[dir];
        cy += dir_dy[dir];
        if (!inBounds(floor, cx, cy)) return FALSE;
        if (cx == player_x && cy == player_y) return TRUE;
    }
    return FALSE;
}

/*
 * 徘徊: 75%直進 (可能なら) + それ以外は逆走を除く候補から一様選択。候補が無ければ最終手段で逆走。
 * render-core.js の stepEnemyWander と同一ロジック・同一順序で RNG を消費する。
 */
static void stepEnemyWander(const DungeonFloorData *floor, u8 index)
{
    DunEnemy *enemy = &dun_enemies[floor_index][index];
    const u8 forward_dir = enemy->dir & 3;
    const u8 reverse_dir = (u8)((forward_dir + 2) & 3);
    u8 candidates[3];
    u8 candidate_count = 0;
    bool forward_open = FALSE;
    u16 roll;
    s8 chosen = -1;
    u8 d;
    for (d = 0; d < 4; d++)
    {
        if (d == reverse_dir) continue;
        if (!enemyCanMove(floor, (s16)index, enemy->x, enemy->y, d)) continue;
        candidates[candidate_count++] = d;
        if (d == forward_dir) forward_open = TRUE;
    }
    roll = (u16)(enemyRngNext() % 100);
    if (forward_open && roll < DUN_ENEMY_WANDER_FORWARD_PCT)
    {
        chosen = (s8)forward_dir;
    }
    else if (candidate_count > 0)
    {
        chosen = (s8)candidates[enemyRngNext() % candidate_count];
    }
    else if (enemyCanMove(floor, (s16)index, enemy->x, enemy->y, reverse_dir))
    {
        chosen = (s8)reverse_dir;
    }
    if (chosen < 0) return;
    enemy->dir = (u8)chosen;
    enemy->x = (u8)(enemy->x + dir_dx[(u8)chosen]);
    enemy->y = (u8)(enemy->y + dir_dy[(u8)chosen]);
}

/* 軸差の大きい方 (同点は x 優先) を第一候補とする貪欲な向き最大2件を dirs[] に積み、件数を返す */
static u8 chaseDirs(const DunEnemy *enemy, s8 *dirs)
{
    const s16 dx = (s16)player_x - (s16)enemy->x;
    const s16 dy = (s16)player_y - (s16)enemy->y;
    const s16 adx = dx < 0 ? (s16)(-dx) : dx;
    const s16 ady = dy < 0 ? (s16)(-dy) : dy;
    const s8 x_dir = dx > 0 ? DUN_DIR_E : (dx < 0 ? DUN_DIR_W : -1);
    const s8 y_dir = dy > 0 ? DUN_DIR_S : (dy < 0 ? DUN_DIR_N : -1);
    u8 count = 0;
    if (adx >= ady)
    {
        if (x_dir >= 0) dirs[count++] = x_dir;
        if (y_dir >= 0) dirs[count++] = y_dir;
    }
    else
    {
        if (y_dir >= 0) dirs[count++] = y_dir;
        if (x_dir >= 0) dirs[count++] = x_dir;
    }
    return count;
}

/*
 * 追跡1歩。プレイヤーのセルへ侵入しようとした場合は移動せず TRUE (接触) を返す
 * (呼び出し側が onEnemyContact を呼ぶ)。候補が両方とも塞がっていれば移動しない。
 */
static bool stepEnemyChase(const DungeonFloorData *floor, u8 index)
{
    DunEnemy *enemy = &dun_enemies[floor_index][index];
    s8 dirs[2];
    const u8 count = chaseDirs(enemy, dirs);
    u8 i;
    for (i = 0; i < count; i++)
    {
        const u8 dir = (u8)dirs[i];
        s16 nx;
        s16 ny;
        if (!enemyCanTraverse(floor, enemy->x, enemy->y, dir)) continue;
        nx = (s16)enemy->x + dir_dx[dir];
        ny = (s16)enemy->y + dir_dy[dir];
        if (nx == player_x && ny == player_y)
        {
            enemy->dir = dir;
            return TRUE;
        }
        if (!enemyBlockedCell((s16)index, nx, ny))
        {
            enemy->dir = dir;
            enemy->x = (u8)nx;
            enemy->y = (u8)ny;
            return FALSE;
        }
    }
    if (count > 0) enemy->dir = (u8)dirs[0];
    return FALSE;
}

/* 将来の戦闘システム用フック。現在は空 (接触してもダメージ等のゲーム効果は一切発生しない) */
static void onEnemyContact(u8 enemy_index)
{
    (void)enemy_index;
}

/* 現在フロアの全アクティブエネミーを1tick分進める (main ループの vblank タイマー駆動から呼ぶ) */
static void stepEnemies(void)
{
    const DungeonFloorData *floor = &dungeon_floors[floor_index];
    u8 index;
    for (index = 0; index < DUN_MAX_ENEMIES; index++)
    {
        DunEnemy *enemy = &dun_enemies[floor_index][index];
        u8 before_x;
        u8 before_y;
        bool sees;
        if (!enemy->active) continue;
        before_x = enemy->x;
        before_y = enemy->y;
        /* スライド補間の起点。AI分岐より前で記録する (render-core.js stepEnemies と同一位置)。
         * 移動しなければ prev===cur になりスライドは発生しない。 */
        enemy->prev_x = before_x;
        enemy->prev_y = before_y;
        sees = enemySeesPlayer(floor, enemy);
        if (sees)
        {
            enemy->mode = DUN_ENEMY_MODE_CHASE;
            enemy->chase_timer = DUN_ENEMY_CHASE_TIMER;
        }
        if (enemy->mode == DUN_ENEMY_MODE_CHASE)
        {
            if (stepEnemyChase(floor, index)) onEnemyContact(index);
            if (!sees)
            {
                if (enemy->chase_timer > 0) enemy->chase_timer--;
                if (enemy->chase_timer == 0) enemy->mode = DUN_ENEMY_MODE_WANDER;
            }
        }
        else
        {
            stepEnemyWander(floor, index);
        }
        if (enemy->x != before_x || enemy->y != before_y) enemy->anim ^= 1;
    }
}

/*
 * 起動時に1回だけ、各フロアの DUN_FLAG_ENEMY スポーンセルから dun_enemies を組み立てる。
 * dun_visited (静的ゼロ初期化のみ) とは異なり、エネミーは向き/モード等の非ゼロ初期値が
 * 必要なため明示的な初期化関数を持つ。以降はフロア再訪でも再初期化しない (生存位置が
 * 永続する — dun_visited と同じ「main.c がフロア別RAMを所有」パターン)。
 */
static void initEnemies(void)
{
    u8 f;
    for (f = 0; f < DUNGEON_FLOOR_COUNT; f++)
    {
        const DungeonFloorData *floor = &dungeon_floors[f];
        u16 count = 0;
        u16 x;
        u16 y;
        for (y = 0; y < floor->height && count < DUN_MAX_ENEMIES; y++)
        {
            for (x = 0; x < floor->width && count < DUN_MAX_ENEMIES; x++)
            {
                const u8 flags = floor->flags[DUN_INDEX(floor, x, y)];
                if (!(flags & DUN_FLAG_ENEMY)) continue;
                /* 正規化済みデータでは排他だが、不正・旧データでもイベント上にスポーンさせない。 */
                if (flags & (DUN_FLAG_CHEST | DUN_FLAG_STAIRS_UP | DUN_FLAG_STAIRS_DOWN)) continue;
                dun_enemies[f][count].x = (u8)x;
                dun_enemies[f][count].y = (u8)y;
                dun_enemies[f][count].dir = DUN_DIR_N;
                dun_enemies[f][count].mode = DUN_ENEMY_MODE_WANDER;
                dun_enemies[f][count].anim = 0;
                dun_enemies[f][count].chase_timer = 0;
                dun_enemies[f][count].active = TRUE;
                dun_enemies[f][count].prev_x = (u8)x;
                dun_enemies[f][count].prev_y = (u8)y;
                count++;
            }
        }
        for (; count < DUN_MAX_ENEMIES; count++) dun_enemies[f][count].active = FALSE;
    }
}

static void applyMove(const DungeonFloorData *floor, u8 action)
{
    if (action == DUN_ACTION_TURN_L)
    {
        player_dir = (u8)((player_dir + 3) & 3);
        return;
    }
    if (action == DUN_ACTION_TURN_R)
    {
        player_dir = (u8)((player_dir + 1) & 3);
        return;
    }
    if (action == DUN_ACTION_FORWARD && canMove(floor, player_x, player_y, player_dir))
    {
        player_x = (u8)(player_x + dir_dx[player_dir]);
        player_y = (u8)(player_y + dir_dy[player_dir]);
        markVisited();
        return;
    }
    if (action == DUN_ACTION_BACKWARD)
    {
        const u8 dir = (u8)((player_dir + 2) & 3);
        if (canMove(floor, player_x, player_y, dir))
        {
            player_x = (u8)(player_x + dir_dx[dir]);
            player_y = (u8)(player_y + dir_dy[dir]);
            markVisited();
        }
    }
}

static void resetPlayer(void)
{
    const DungeonFloorData *floor = &dungeon_floors[floor_index];
    player_x = floor->start_x;
    player_y = floor->start_y;
    player_dir = floor->start_dir & 3;
    markVisited();
}

static void applyCellDarkness(const DungeonFloorData *floor)
{
    const u8 flags = floor->flags[DUN_INDEX(floor, player_x, player_y)];
    DUN_setDark((flags & DUN_FLAG_DARK) != 0);
}

static void drawCurrentView(const DungeonFloorData *floor)
{
    DUN_applyViewSet(floor->view_set);
    applyCellDarkness(floor);
    DUN_setEnemies(dun_enemies[floor_index], DUN_MAX_ENEMIES);
    DUN_drawStatic(floor, player_x, player_y, player_dir);
    DUN_drawMinimap(floor, dun_visited[floor_index], player_x, player_y, player_dir);
#if DUN_USE_TEXT_HUD
    DUN_drawHud(floor_index, player_x, player_y, player_dir);
#endif
}

/*
 * 階段遷移の到着位置。対象フロアの kind (flag) 階段セルそのものへ到着する
 * (階段は宝箱と同様に通行可能なため、隣接セルへ逃がす必要がない)。
 * 向きは壁で塞がれていない最初の方角 (見つからなければ北)。
 * render-core.js の stairsArrival と同一仕様。
 */
static bool findStairsArrival(const DungeonFloorData *floor, u8 flag, u8 *out_x, u8 *out_y, u8 *out_dir)
{
    u16 x;
    u16 y;
    for (y = 0; y < floor->height; y++)
    {
        for (x = 0; x < floor->width; x++)
        {
            u8 dir;
            if (!(floor->flags[DUN_INDEX(floor, x, y)] & flag)) continue;
            *out_x = (u8)x;
            *out_y = (u8)y;
            *out_dir = 0;
            for (dir = 0; dir < 4; dir++)
            {
                if (!hasWallAt(floor, (s16)x, (s16)y, dir))
                {
                    *out_dir = dir;
                    break;
                }
            }
            return TRUE;
        }
    }
    return FALSE;
}

/* フロアが切り替わったら TRUE。最上階の上り階段・最下階の下り階段は素通り (no-op) */
static bool goStairs(u8 stairs_flag)
{
    const bool up = (stairs_flag & DUN_FLAG_STAIRS_UP) != 0;
    const DungeonFloorData *dest;
    u8 ax;
    u8 ay;
    u8 adir;
    u8 target;
    if (up)
    {
        if (floor_index == 0) return FALSE;
        target = (u8)(floor_index - 1);
    }
    else
    {
        if ((u8)(floor_index + 1) >= dungeon_floor_count) return FALSE;
        target = (u8)(floor_index + 1);
    }
    floor_index = target;
    dest = &dungeon_floors[floor_index];
    /* 上ってきたなら到着フロアの下り階段、下りてきたなら上り階段の位置へ着地する */
    if (findStairsArrival(dest, up ? DUN_FLAG_STAIRS_DOWN : DUN_FLAG_STAIRS_UP, &ax, &ay, &adir))
    {
        player_x = ax;
        player_y = ay;
        player_dir = adir;
        markVisited();
    }
    else
    {
        resetPlayer();
    }
    drawCurrentView(dest);
    return TRUE;
}

static void performAction(const DungeonFloorData *floor, u8 action)
{
    if (action == DUN_ACTION_FORWARD)
    {
        DUN_playForward(floor, player_x, player_y, player_dir);
    }
    else if (action == DUN_ACTION_BACKWARD)
    {
        /* 後退 = 移動先セル基準の前進フレームを逆再生 */
        const u8 back = (u8)((player_dir + 2) & 3);
        const u8 target_x = (u8)(player_x + dir_dx[back]);
        const u8 target_y = (u8)(player_y + dir_dy[back]);
        DUN_playBackward(floor, target_x, target_y, player_dir);
    }
    else if (action == DUN_ACTION_TURN_L || action == DUN_ACTION_TURN_R)
    {
        DUN_playTurn(floor, player_x, player_y, player_dir, action == DUN_ACTION_TURN_L);
    }
    applyMove(floor, action);
    /* 前進/後退で階段セルへ足を踏み入れたら、着地直後に自動でフロアを切り替える */
    if (action == DUN_ACTION_FORWARD || action == DUN_ACTION_BACKWARD)
    {
        const u8 stairs = stairsFlagsAt(floor, player_x, player_y);
        /* goStairs が no-op (最上階/最下階) の場合は floor がまだ有効なので通常どおり描画する */
        if (stairs && goStairs(stairs)) return;
    }
    drawCurrentView(floor);
}

/* 移動/旋回は押しっぱなしで連続動作する (レベルトリガー) */
static u8 selectAction(const DungeonFloorData *floor, u16 joy)
{
    if ((joy & BUTTON_UP) && canMove(floor, player_x, player_y, player_dir)) return DUN_ACTION_FORWARD;
    if (joy & BUTTON_DOWN)
    {
        const u8 dir = (u8)((player_dir + 2) & 3);
        if (canMove(floor, player_x, player_y, dir)) return DUN_ACTION_BACKWARD;
    }
    if (joy & BUTTON_LEFT) return DUN_ACTION_TURN_L;
    if (joy & BUTTON_RIGHT) return DUN_ACTION_TURN_R;
    return DUN_ACTION_NONE;
}

int main(bool hardReset)
{
    (void)hardReset;
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    JOY_init();
    DUN_initView();
    initEnemies();
    enemy_rng_state = DUN_ENEMY_RNG_SEED_DEFAULT;
    /* 起動直後は floor_index==0 (dungeon_floors[0]) の per-floor 値を使う。
     * DUN_ENEMY_STEP_VBLANKS_DEFAULT は各フロアの enemy_step_vblanks 焼き込み時に
     * 「0=継承」を解決する既定値として dungeon-service.js のエクスポート時にのみ使われ、
     * 実機側では参照しない (ドキュメント用途で define 自体は残す)。 */
    enemy_next_step_vtime = vtimer + dungeon_floors[floor_index].enemy_step_vblanks;
    enemy_last_step_vtime = vtimer;
    resetPlayer();
    drawCurrentView(&dungeon_floors[floor_index]);

    while (TRUE)
    {
        const DungeonFloorData *floor = &dungeon_floors[floor_index];
        const u16 joy = JOY_readJoypad(JOY_1);
        const u16 pressed = joy & ~prev_joy;
        u8 action = DUN_ACTION_NONE;
        prev_joy = joy;

        if ((pressed & BUTTON_START) && dungeon_floor_count > 1)
        {
            floor_index = (u8)((floor_index + 1) % dungeon_floor_count);
            resetPlayer();
            drawCurrentView(&dungeon_floors[floor_index]);
        }
        else
        {
            action = selectAction(floor, joy);
            if (action != DUN_ACTION_NONE)
            {
                performAction(floor, action);
            }
        }

        /*
         * エネミーの徘徊/追跡は vblank タイマー駆動 (プレイヤー静止中も進む)。
         * (s32) 差分による符号付き比較で vtimer のラップアラウンドにも安全に対応する
         * (SGDK の一般的なイディオム)。ブロッキングアニメ中の複数回分の経過は
         * 1ステップに集約される (deadline を現在時刻基準で毎回引き直すため)。
         */
        {
            /* floor ではなく dungeon_floors[floor_index] を直接引く: 同じループ周回内で
             * START/階段によりフロアが切り替わっていた場合でも、切り替え後のフロアの
             * 間隔を即座に反映するため (ローカルの floor はループ先頭でのスナップショット)。 */
            const DungeonFloorData *enemy_floor = &dungeon_floors[floor_index];
            const u16 interval = enemy_floor->enemy_step_vblanks;
            s32 slide;
            if ((s32)(vtimer - enemy_next_step_vtime) >= 0)
            {
                enemy_last_step_vtime = vtimer;
                stepEnemies();
                enemy_next_step_vtime = vtimer + interval;
                DUN_setEnemies(dun_enemies[floor_index], DUN_MAX_ENEMIES);
            }
            /* 毎フレーム、直前 tick からの経過でスライド進行度を更新する。
             * DUN_refreshBillboardsは可視候補/LOSをAI tickごとにキャッシュし、画面座標・
             * 距離バケット・Priority範囲のいずれかが変わったフレームだけ描画を反映する。
             * 壁パターンは再転送せず、外接タイル境界/depth/表示数の変化でPriority bitが
             * 実際に変わった場合だけBG_AマップをDMA更新する。 */
            slide = (s32)(vtimer - enemy_last_step_vtime);
            if (slide < 0) slide = 0;
            if (slide > (s32)interval) slide = (s32)interval;
            DUN_setEnemySlide((u16)slide, interval);
            DUN_refreshBillboards();
        }

        SYS_doVBlankProcess();
    }

    return 0;
}
