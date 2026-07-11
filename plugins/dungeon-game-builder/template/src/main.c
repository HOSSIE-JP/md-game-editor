/* =============================================================
 * Dungeon Game
 * デシジョンテーブル方式 25x16 BG タイル疑似3Dダンジョン
 *  - 前進/後退/左右回転を焼き込みフレームで滑らかにアニメーション
 *  - 扉 (通行可能)、宝箱/階段ビルボード、暗闇セル対応
 * ============================================================= */

#include <genesis.h>
#include "dungeon_data.h"
#include "dungeon_patterns.h"
#include "dungeon_view.h"

#define DUN_USE_TEXT_HUD 1

static const s8 dir_dx[4] = { 0, 1, 0, -1 };
static const s8 dir_dy[4] = { -1, 0, 1, 0 };
static const u16 edge_bits[4] = { DUN_EDGE_N, DUN_EDGE_E, DUN_EDGE_S, DUN_EDGE_W };
static const u16 oneway_bits[4] = { DUN_ONEWAY_N, DUN_ONEWAY_E, DUN_ONEWAY_S, DUN_ONEWAY_W };

static u8 floor_index;
static u8 player_x;
static u8 player_y;
static u8 player_dir;
static u16 prev_joy;

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

static u8 stairsFlagsAt(const DungeonFloorData *floor, s16 x, s16 y)
{
    if (!inBounds(floor, x, y)) return 0;
    return (u8)(floor->flags[DUN_INDEX(floor, x, y)] & (DUN_FLAG_STAIRS_UP | DUN_FLAG_STAIRS_DOWN));
}

static bool canMove(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
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

        SPR_update();
        SYS_doVBlankProcess();
    }

    return 0;
}
