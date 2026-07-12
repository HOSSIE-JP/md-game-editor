/* =============================================================
 * Dungeon View — デシジョンテーブル方式の疑似3Dビュー描画
 *
 * エディタが焼き込んだ「画面タイルごとの周囲エッジ状態→タイル実体」
 * の三分木 (dungeon_patterns.c) を毎アニメフレーム評価し、
 * ROM 上のタイルセットから 400 タイルを VRAM のダブルバッファへ
 * DMA ストリーミングして 25x16 のビューを合成する。
 *
 *  - 前進/後退: 選択素材セットの frames_fwd を順再生/逆再生
 *  - 右回転:   選択素材セットの frames_turn を再生
 *  - 左回転:   右回転テーブルを鏡像評価 (dun_edges_turn_mirrored) し
 *              水平反転で合成する
 *  - 床/天井:  選択素材セットの 32x32 パターンを BG_B へ反復配置
 *  - 宝箱/階段: 素材セットに依らないプロジェクト共通のプリスケール済みビルボードスプライト
 * ============================================================= */
#include "dungeon_view.h"
#include "dungeon_patterns.h"
#include "resources.h"

#define DUN_VIEW_X 4
#define DUN_VIEW_Y 4
#define DUN_BANK_TILES DUN_VIEW_TILE_COUNT
#define DUN_BANK_HALF (DUN_BANK_TILES / 2)
#define DUN_BANK0_INDEX TILE_USER_INDEX
#define DUN_BANK1_INDEX (TILE_USER_INDEX + DUN_BANK_TILES)
#define DUN_SPRITE_COUNT 8

static const s8 dir_dx[4] = { 0, 1, 0, -1 };
static const s8 dir_dy[4] = { -1, 0, 1, 0 };
static const u16 edge_bits[4] = { DUN_EDGE_N, DUN_EDGE_E, DUN_EDGE_S, DUN_EDGE_W };
static const u16 door_bits[4] = { DUN_DOOR_N, DUN_DOOR_E, DUN_DOOR_S, DUN_DOOR_W };

static u8 edge_state[DUN_EDGE_STATE_MAX];
static u32 tile_staging[DUN_BANK_TILES * 8];
static u16 map_staging[DUN_VIEW_TILE_COUNT];
static u8 back_bank;
static bool view_dark;
static const DunViewSet *active_view_set;
static Sprite *bb_sprites[DUN_SPRITE_COUNT];
/* main.c が所有するフロア別 dun_enemies へのポインタ (DUN_setEnemies 経由)。所有権は
 * main.c のまま — dungeon_view.c は読み取り専用の参照として保持するだけ。 */
static const DunEnemy *active_enemies;
static u8 active_enemy_count;
/* DUN_refreshBillboards 用: 直近の DUN_drawStatic 呼び出し時のカメラ位置 (静止中のみ更新) */
static const DungeonFloorData *last_static_floor;
static u8 last_static_x;
static u8 last_static_y;
static u8 last_static_dir;
/* flushFrame の必須 2 vblank DMA 転送に追加する待ち vblank 数 (0 = 追加なし)。
 * 起動時は DUN_MOVE_SPEED_VBLANKS_DEFAULT で初期化し、DUN_setMoveSpeed で
 * ゲーム側 (パワーアップ等) から実行時に変更できる。 */
static u8 dun_extra_step_vblanks;
/* ミニマップ表示モード (DUN_MINIMAP_VISITED / DUN_MINIMAP_FULL)。起動時は
 * VISITED (自動マッピング) で初期化し、DUN_setMinimapMode でゲーム側
 * (マップ入手アイテム等) から実行時に切り替えられる。 */
static u8 dun_minimap_mode;

/* ミニマップ (ビュー右の余白, BG_A + PAL2, 4px/セル) */
#define DUN_MM_TILES_W 10
#define DUN_MM_TILES_H 10
#define DUN_MM_PX (DUN_MM_TILES_W * 8)
#define DUN_MM_BASE (DUN_BANK1_INDEX + DUN_BANK_TILES)
#define DUN_MM_X 30
#define DUN_MM_Y 4
#define DUN_MM_CELL 4
#define DUN_BACKGROUND_BASE (DUN_MM_BASE + (DUN_MM_TILES_W * DUN_MM_TILES_H))

static u32 mm_tiles[DUN_MM_TILES_W * DUN_MM_TILES_H * 8];
static u16 background_map[DUN_VIEW_TILE_COUNT];
static const u16 dun_mm_palette[16] = {
    0x0000, /* 0: 未使用 */
    0x0222, /* 1: 背景 */
    0x0444, /* 2: 床 */
    0x0424, /* 3: 暗闇床 */
    0x0EEE, /* 4: 壁 */
    0x008E, /* 5: 扉 (オレンジ) */
    0x04E4, /* 6: プレイヤー (緑) */
    0x02EE, /* 7: 宝箱 (黄) */
    0x0EC8, /* 8: 上り階段 (水色) */
    0x0C4A, /* 9: 下り階段 (紫) */
    0x044E, /* 10: エネミー (赤) */
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
};
static void mmWriteTileMap(void);

static void writeBackground(void)
{
    u16 x;
    u16 y;
    for (y = 0; y < DUN_VIEW_TILE_H; y++)
    {
        const u16 pattern_base = (y < 8) ? 0 : (DUN_BACKGROUND_TILE_COUNT / 2);
        const u16 pattern_row = (u16)((y & 3) * 4);
        for (x = 0; x < DUN_VIEW_TILE_W; x++)
        {
            const u16 tile = (u16)(pattern_base + pattern_row + (x & 3));
            background_map[(y * DUN_VIEW_TILE_W) + x] =
                TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, DUN_BACKGROUND_BASE + tile);
        }
    }
    VDP_loadTileSet(active_view_set->background_tileset, DUN_BACKGROUND_BASE, CPU);
    VDP_setTileMapDataRect(BG_B, background_map, DUN_VIEW_X, DUN_VIEW_Y,
                           DUN_VIEW_TILE_W, DUN_VIEW_TILE_H, DUN_VIEW_TILE_W, CPU);
}

void DUN_applyViewSet(u8 view_set)
{
    if (view_set >= DUN_VIEW_SET_COUNT) view_set = 0;
    if (active_view_set == &dun_view_sets[view_set]) return;

    active_view_set = &dun_view_sets[view_set];
    if (view_dark) PAL_setColors(0, active_view_set->dark_palette, 16, CPU);
    else PAL_setPalette(PAL0, active_view_set->view_palette->data, CPU);
    PAL_setPalette(PAL1, dun_common_bb_palette.data, CPU);
    writeBackground();
}

void DUN_initView(void)
{
    u16 i;
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    PAL_setColors(32, dun_mm_palette, 16, CPU);
    SPR_init();
    for (i = 0; i < DUN_SPRITE_COUNT; i++) bb_sprites[i] = NULL;
    back_bank = 0;
    view_dark = FALSE;
    active_view_set = NULL;
    active_enemies = NULL;
    active_enemy_count = 0;
    last_static_floor = NULL;
    dun_extra_step_vblanks = DUN_MOVE_SPEED_VBLANKS_DEFAULT;
    dun_minimap_mode = DUN_MINIMAP_VISITED;
    DUN_applyViewSet(0);
    mmWriteTileMap();
}

void DUN_setDark(bool dark)
{
    if (dark == view_dark) return;
    view_dark = dark;
    if (dark) PAL_setColors(0, active_view_set->dark_palette, 16, CPU);
    else PAL_setPalette(PAL0, active_view_set->view_palette->data, CPU);
}

/* ゲーム側のパワーアップ演出などから呼び、移動アニメーションのテンポを変える */
void DUN_setMoveSpeed(u8 extra_vblanks)
{
    dun_extra_step_vblanks = extra_vblanks;
}

/* ゲーム側 (マップ入手アイテム等) から呼び、ミニマップの表示モードを実行時に切り替える */
void DUN_setMinimapMode(u8 mode)
{
    dun_minimap_mode = mode;
}

/* main.c から毎フレーム (描画呼び出しの前に) 呼び、現在フロアのエネミーリストを渡す */
void DUN_setEnemies(const DunEnemy *list, u8 count)
{
    active_enemies = list;
    active_enemy_count = count;
}

/* (ax, ay) にいるアクティブなエネミーを返す。フラグ参照 (billboardDefForFlags) より先に呼ぶ */
static const DunEnemy *enemyAt(s16 ax, s16 ay)
{
    u8 i;
    for (i = 0; i < active_enemy_count; i++)
    {
        if (active_enemies[i].active && active_enemies[i].x == ax && active_enemies[i].y == ay) return &active_enemies[i];
    }
    return NULL;
}

/* ------------------------------------------------------------
 * エッジ状態評価 (0=開 / 1=壁 / 2=扉) — render-core と同一仕様
 * ソリッドなセルは開いた面を壁として描くが、階段も宝箱と同様に通行可能な
 * イベントセルへ変更したため、現在ソリッドになるセル種別は存在しない。
 * ------------------------------------------------------------ */

static bool inBounds(const DungeonFloorData *floor, s16 x, s16 y)
{
    return x >= 0 && y >= 0 && x < floor->width && y < floor->height;
}

/* 将来ソリッドなセル種別を追加する場合のフックとして残す (render-core.js の cellIsSolid と同一) */
static bool cellIsSolidAt(const DungeonFloorData *floor, s16 x, s16 y)
{
    (void)floor;
    (void)x;
    (void)y;
    return FALSE;
}

/* 壁/扉ビットのみのエッジ判定 */
static u8 rawEdgeState(const DungeonFloorData *floor, s16 x, s16 y, u8 cross_dir)
{
    const u8 opposite = (u8)((cross_dir + 2) & 3);
    const s16 nx = x + dir_dx[cross_dir];
    const s16 ny = y + dir_dy[cross_dir];
    const bool a_in = inBounds(floor, x, y);
    const bool b_in = inBounds(floor, nx, ny);
    const u16 ea = a_in ? floor->edges[DUN_INDEX(floor, x, y)] : 0;
    const u16 eb = b_in ? floor->edges[DUN_INDEX(floor, nx, ny)] : 0;
    if ((ea & door_bits[cross_dir]) || (eb & door_bits[opposite])) return 2;
    if (!a_in || !b_in) return 1;
    if ((ea & edge_bits[cross_dir]) || (eb & edge_bits[opposite])) return 1;
    return 0;
}

static u8 edgeStateBetween(const DungeonFloorData *floor, s16 x, s16 y, u8 cross_dir)
{
    const u8 state = rawEdgeState(floor, x, y, cross_dir);
    if (state != 0) return state;
    if (cellIsSolidAt(floor, x, y)) return 1;
    if (cellIsSolidAt(floor, x + dir_dx[cross_dir], y + dir_dy[cross_dir])) return 1;
    return 0;
}

static void evaluateEdgeStates(const DungeonFloorData *floor, u8 x, u8 y, u8 dir,
                               const DunEdgeDef *defs, u16 count)
{
    const u8 right = (u8)((dir + 1) & 3);
    u16 i;
    for (i = 0; i < count; i++)
    {
        const DunEdgeDef *def = &defs[i];
        const s16 ax = (s16)x + (s16)def->dd * dir_dx[dir] + (s16)def->dl * dir_dx[right];
        const s16 ay = (s16)y + (s16)def->dd * dir_dy[dir] + (s16)def->dl * dir_dy[right];
        const u8 cross = (def->face == 0) ? dir : right;
        edge_state[i] = edgeStateBetween(floor, ax, ay, cross);
    }
}

/* ------------------------------------------------------------
 * フレーム合成: デシジョンツリー評価 → タイルステージング → DMA
 * ------------------------------------------------------------ */

static void stageFrame(const DunFrameTable *table, bool mirrored)
{
    const u16 bank_base = back_bank ? DUN_BANK1_INDEX : DUN_BANK0_INDEX;
    u16 tile;
    for (tile = 0; tile < DUN_VIEW_TILE_COUNT; tile++)
    {
        u16 src_tile = tile;
        u16 ref;
        u16 local;
        u16 global;
        u8 flips;
        const u32 *src;
        u32 *dest;
        if (mirrored)
        {
            const u16 tx = tile % DUN_VIEW_TILE_W;
            const u16 ty = tile / DUN_VIEW_TILE_W;
            src_tile = (u16)((ty * DUN_VIEW_TILE_W) + (DUN_VIEW_TILE_W - 1 - tx));
        }
        ref = table->offsets[src_tile];
        while (!(ref & 0x8000))
        {
            ref = table->nodes[ref + 1 + edge_state[table->nodes[ref]]];
        }
        local = (u16)(ref & 0x7fff);
        global = table->tile_map[local];
        flips = table->tile_flips[local];
        if (mirrored) flips ^= 1;
        src = &active_view_set->view_tileset->tiles[(u32)global * 8];
        dest = &tile_staging[(u32)tile * 8];
        dest[0] = src[0];
        dest[1] = src[1];
        dest[2] = src[2];
        dest[3] = src[3];
        dest[4] = src[4];
        dest[5] = src[5];
        dest[6] = src[6];
        dest[7] = src[7];
        map_staging[tile] = TILE_ATTR_FULL(PAL0, FALSE, (flips & 2) ? 1 : 0, (flips & 1) ? 1 : 0, bank_base + tile);
    }
}

/*
 * ステージング済みフレームを裏バンクへ 2 vblank で転送して表示を切り替える。
 * (6.4KB + 6.4KB + タイルマップ 800B を DMA キューで分割転送。この 2 vblank は
 * ダブルバッファ転送のハード制約でありペーシング用途で変更しない)
 * dun_extra_step_vblanks > 0 の場合、その後に追加で vblank を待って
 * アニメーションのテンポを落とす (DUN_setMoveSpeed でランタイムに変更可能)。
 */
static void flushFrame(void)
{
    const u16 bank_base = back_bank ? DUN_BANK1_INDEX : DUN_BANK0_INDEX;
    u8 extra;
    VDP_loadTileData(tile_staging, bank_base, DUN_BANK_HALF, DMA_QUEUE);
    SPR_update();
    SYS_doVBlankProcess();
    VDP_loadTileData(tile_staging + ((u32)DUN_BANK_HALF * 8), (u16)(bank_base + DUN_BANK_HALF), DUN_BANK_HALF, DMA_QUEUE);
    VDP_setTileMapDataRect(BG_A, map_staging, DUN_VIEW_X, DUN_VIEW_Y, DUN_VIEW_TILE_W, DUN_VIEW_TILE_H, DUN_VIEW_TILE_W, DMA_QUEUE);
    SPR_update();
    SYS_doVBlankProcess();
    back_bank ^= 1;
    for (extra = 0; extra < dun_extra_step_vblanks; extra++) SYS_doVBlankProcess();
}

/* ------------------------------------------------------------
 * ビルボード (宝箱・階段)
 * ------------------------------------------------------------ */

/*
 * LOS: カメラセル中心 → 対象セル中心の線分が横切るエッジ/セルを
 * supercover 走査 (整数誤差項) で判定する。壁・扉セルは視線を遮る。
 * render-core の losVisible と同一の整数アルゴリズム。
 */
static bool losEdgeOpen(const DungeonFloorData *floor, s16 cx, s16 cy, u8 cross_dir)
{
    return rawEdgeState(floor, cx, cy, cross_dir) == 0;
}

/* 現在ソリッドなセル種別は存在しないため、範囲外セルのみを遮蔽とみなす */
static bool losCellSolid(const DungeonFloorData *floor, s16 cx, s16 cy)
{
    if (!inBounds(floor, cx, cy)) return TRUE;
    return cellIsSolidAt(floor, cx, cy);
}

static bool losVisible(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, s8 dd, s8 dl)
{
    const u8 right = (u8)((dir + 1) & 3);
    const s16 tx = (s16)x + (s16)dd * dir_dx[dir] + (s16)dl * dir_dx[right];
    const s16 ty = (s16)y + (s16)dd * dir_dy[dir] + (s16)dl * dir_dy[right];
    const s16 adx = tx > x ? (s16)(tx - x) : (s16)(x - tx);
    const s16 ady = ty > y ? (s16)(ty - y) : (s16)(y - ty);
    const u8 sx = tx > x ? DUN_DIR_E : DUN_DIR_W;
    const u8 sy = ty > y ? DUN_DIR_S : DUN_DIR_N;
    s16 cx = x;
    s16 cy = y;
    s16 err = adx - ady;
    s16 steps = adx + ady;
    if (dd == 0 && dl == 0) return TRUE;
    while (steps > 0)
    {
        if (err > 0 || ady == 0)
        {
            if (!losEdgeOpen(floor, cx, cy, sx)) return FALSE;
            cx += dir_dx[sx];
            cy += dir_dy[sx];
            err -= (s16)(2 * ady);
            steps--;
        }
        else if (err < 0 || adx == 0)
        {
            if (!losEdgeOpen(floor, cx, cy, sy)) return FALSE;
            cx += dir_dx[sy];
            cy += dir_dy[sy];
            err += (s16)(2 * adx);
            steps--;
        }
        else
        {
            /*
             * 線分が格子の角を正確に通過する場合。どちらか一方の回り込みが
             * 開いていれば「セル到達」は可能だが、レンダラは開いていない側の
             * 壁もそのまま描画するため、その壁はカメラ直近では画面上で対象と
             * 同じ領域に映り込み得る。見た目上の遮蔽と一致させるため両方が
             * 開いている場合のみ可視とする (どちらか一方でも壁なら遮蔽)。
             */
            const s16 nx = cx + dir_dx[sx];
            const s16 ny = cy + dir_dy[sx];
            const s16 mx = cx + dir_dx[sy];
            const s16 my = cy + dir_dy[sy];
            const bool via_x = losEdgeOpen(floor, cx, cy, sx) && !losCellSolid(floor, nx, ny) && losEdgeOpen(floor, nx, ny, sy);
            const bool via_y = losEdgeOpen(floor, cx, cy, sy) && !losCellSolid(floor, mx, my) && losEdgeOpen(floor, mx, my, sx);
            if (!via_x || !via_y) return FALSE;
            cx += dir_dx[sx] + dir_dx[sy];
            cy += dir_dy[sx] + dir_dy[sy];
            err += (s16)(2 * adx - 2 * ady);
            steps -= 2;
        }
        if ((cx != tx || cy != ty) && losCellSolid(floor, cx, cy)) return FALSE;
    }
    return TRUE;
}

/* 宝箱/上り階段/下り階段は素材セットに依らずプロジェクト共通スプライトを使う */
static const SpriteDefinition *billboardDefForFlags(u8 flags)
{
    if (flags & DUN_FLAG_CHEST) return &dun_common_bb_chest;
    if (flags & DUN_FLAG_STAIRS_UP) return &dun_common_bb_stairs_up;
    if (flags & DUN_FLAG_STAIRS_DOWN) return &dun_common_bb_stairs_down;
    return NULL;
}

static void updateBillboards(const DungeonFloorData *floor, u8 x, u8 y, u8 dir,
                             const DunBBPose *poses, bool mirrored)
{
    const u8 right = (u8)((dir + 1) & 3);
    u16 used = 0;
    u16 i;
    for (i = 0; i < DUN_BB_CELL_COUNT && used < DUN_SPRITE_COUNT; i++)
    {
        const DunBBPose *pose = &poses[i];
        s8 dd;
        s8 dl;
        s16 ax;
        s16 ay;
        const SpriteDefinition *def;
        const DunEnemy *enemy;
        u8 anim_row = 0;
        s16 sx;
        s16 sy;
        if (pose->frame < 0) continue;
        dd = dun_bb_cells[i].dd;
        dl = dun_bb_cells[i].dl;
        if (mirrored) dl = (s8)(-dl);
        ax = (s16)x + (s16)dd * dir_dx[dir] + (s16)dl * dir_dx[right];
        ay = (s16)y + (s16)dd * dir_dy[dir] + (s16)dl * dir_dy[right];
        if (!inBounds(floor, ax, ay)) continue;
        /* エネミーの実位置検索をフラグ参照より先に行う (エネミーが優先される) */
        enemy = enemyAt(ax, ay);
        if (enemy)
        {
            u8 rel = (u8)(((s16)enemy->dir - (s16)dir + 4) & 3);
            if (mirrored) rel = (u8)((4 - rel) & 3);
            def = &dun_common_bb_enemy;
            anim_row = (u8)((rel * 2) + (enemy->anim & 1));
        }
        else
        {
            const u8 flags = floor->flags[DUN_INDEX(floor, ax, ay)];
            def = billboardDefForFlags(flags);
        }
        if (!def) continue;
        if (!losVisible(floor, x, y, dir, dd, dl)) continue;
        sx = pose->x;
        if (mirrored) sx = (s16)(DUN_VIEW_PIXEL_W - pose->x - (DUN_BB_FRAME_TILES * 8));
        sx += DUN_VIEW_X * 8;
        sy = (s16)(pose->y + (DUN_VIEW_Y * 8));
        if (!bb_sprites[used])
        {
            bb_sprites[used] = SPR_addSprite(def, sx, sy, TILE_ATTR(PAL1, TRUE, FALSE, FALSE));
            if (!bb_sprites[used]) continue;
        }
        SPR_setDefinition(bb_sprites[used], def);
        SPR_setPosition(bb_sprites[used], sx, sy);
        if (enemy) SPR_setAnimAndFrame(bb_sprites[used], anim_row, pose->frame);
        else SPR_setFrame(bb_sprites[used], pose->frame);
        SPR_setVisibility(bb_sprites[used], VISIBLE);
        used++;
    }
    for (; used < DUN_SPRITE_COUNT; used++)
    {
        if (bb_sprites[used]) SPR_setVisibility(bb_sprites[used], HIDDEN);
    }
}

/* ------------------------------------------------------------
 * ミニマップ描画
 * ------------------------------------------------------------ */

#define MM_COLOR_BG 1
#define MM_COLOR_FLOOR 2
#define MM_COLOR_DARK 3
#define MM_COLOR_WALL 4
#define MM_COLOR_DOOR 5
#define MM_COLOR_PLAYER 6
#define MM_COLOR_CHEST 7
#define MM_COLOR_STAIRS_UP 8
#define MM_COLOR_STAIRS_DOWN 9
#define MM_COLOR_ENEMY 10

static void mmSetPixel(u16 px, u16 py, u16 color)
{
    u32 *row;
    u16 shift;
    if (px >= DUN_MM_PX || py >= DUN_MM_PX) return;
    row = &mm_tiles[((((py >> 3) * DUN_MM_TILES_W) + (px >> 3)) * 8) + (py & 7)];
    shift = (u16)((7 - (px & 7)) * 4);
    *row = (*row & ~((u32)0xf << shift)) | ((u32)(color & 0xf) << shift);
}

static void mmFillRect(u16 px, u16 py, u16 w, u16 h, u16 color)
{
    u16 ix;
    u16 iy;
    for (iy = 0; iy < h; iy++)
    {
        for (ix = 0; ix < w; ix++) mmSetPixel(px + ix, py + iy, color);
    }
}

/* 訪問済みセル判定 (DUN_MINIMAP_VISITED 用)。visited は main.c 側が持つ現在フロアの
 * 踏破ビットフィールド (DUN_INDEX と同じ並びの 1 セル = 1 bit)。範囲外は未訪問扱い。 */
static bool mmIsVisited(const DungeonFloorData *floor, const u8 *visited, s16 x, s16 y)
{
    u16 bit;
    if (!inBounds(floor, x, y)) return FALSE;
    bit = DUN_INDEX(floor, x, y);
    return (visited[bit >> 3] & (u8)(1 << (bit & 7))) != 0;
}

static void mmWriteTileMap(void)
{
    u16 buf[DUN_MM_TILES_W * DUN_MM_TILES_H];
    u16 i;
    for (i = 0; i < DUN_MM_TILES_W * DUN_MM_TILES_H; i++)
    {
        buf[i] = TILE_ATTR_FULL(PAL2, FALSE, FALSE, FALSE, DUN_MM_BASE + i);
    }
    VDP_setTileMapDataRect(BG_A, buf, DUN_MM_X, DUN_MM_Y, DUN_MM_TILES_W, DUN_MM_TILES_H, DUN_MM_TILES_W, CPU);
}

void DUN_drawMinimap(const DungeonFloorData *floor, const u8 *visited, u8 px, u8 py, u8 dir)
{
    const u16 cell = DUN_MM_CELL;
    const u16 ox = (u16)((DUN_MM_PX - (floor->width * cell)) / 2);
    const u16 oy = (u16)((DUN_MM_PX - (floor->height * cell)) / 2);
    u16 x;
    u16 y;
    u16 i;
    for (i = 0; i < DUN_MM_TILES_W * DUN_MM_TILES_H * 8; i++) mm_tiles[i] = 0x11111111;
    for (y = 0; y < floor->height; y++)
    {
        for (x = 0; x < floor->width; x++)
        {
            const u16 edges = floor->edges[DUN_INDEX(floor, x, y)];
            const u8 flags = floor->flags[DUN_INDEX(floor, x, y)];
            const u16 bx = ox + (x * cell);
            const u16 by = oy + (y * cell);
            /* DUN_MINIMAP_FULL では全セル訪問済み扱い。VISITED では実際の踏破状態を見る */
            const bool self_visited = (dun_minimap_mode == DUN_MINIMAP_FULL) || mmIsVisited(floor, visited, x, y);
            if (self_visited)
            {
                u16 fill = (flags & DUN_FLAG_DARK) ? MM_COLOR_DARK : MM_COLOR_FLOOR;
                if (flags & DUN_FLAG_STAIRS_UP) fill = MM_COLOR_STAIRS_UP;
                if (flags & DUN_FLAG_STAIRS_DOWN) fill = MM_COLOR_STAIRS_DOWN;
                mmFillRect(bx, by, cell, cell, fill);
                if (flags & DUN_FLAG_CHEST) mmFillRect(bx + 1, by + 1, cell - 2, cell - 2, MM_COLOR_CHEST);
            }
            /*
             * 壁/扉は各セルの北辺と西辺 + 外周の南/東辺で描く。VISITED モードでは
             * 自セルか、辺を挟んだ隣接セルのどちらかが訪問済みなら描画する
             * (歩いて隣から見た壁も「見えている」ものとして扱う)。外周の南/東辺は
             * 隣接セルが存在しないため自セルの訪問状態のみで判定する。
             */
            if ((edges & (DUN_EDGE_N | DUN_DOOR_N)) && (self_visited || mmIsVisited(floor, visited, x, y - 1)))
                mmFillRect(bx, by, cell, 1, (edges & DUN_DOOR_N) ? MM_COLOR_DOOR : MM_COLOR_WALL);
            if ((edges & (DUN_EDGE_W | DUN_DOOR_W)) && (self_visited || mmIsVisited(floor, visited, x - 1, y)))
                mmFillRect(bx, by, 1, cell, (edges & DUN_DOOR_W) ? MM_COLOR_DOOR : MM_COLOR_WALL);
            if ((y == floor->height - 1) && (edges & (DUN_EDGE_S | DUN_DOOR_S)) && self_visited)
                mmFillRect(bx, by + cell - 1, cell, 1, (edges & DUN_DOOR_S) ? MM_COLOR_DOOR : MM_COLOR_WALL);
            if ((x == floor->width - 1) && (edges & (DUN_EDGE_E | DUN_DOOR_E)) && self_visited)
                mmFillRect(bx + cell - 1, by, 1, cell, (edges & DUN_DOOR_E) ? MM_COLOR_DOOR : MM_COLOR_WALL);
        }
    }
    /* エネミー: 踏破済みセル上のみ描画 (FULL時は常時)。プレビュー側も同ルールで #ff5f5f ドット */
    {
        u16 i;
        for (i = 0; i < active_enemy_count; i++)
        {
            const DunEnemy *enemy = &active_enemies[i];
            u16 ex;
            u16 ey;
            bool enemy_visited;
            if (!enemy->active) continue;
            enemy_visited = (dun_minimap_mode == DUN_MINIMAP_FULL) || mmIsVisited(floor, visited, enemy->x, enemy->y);
            if (!enemy_visited) continue;
            ex = ox + (enemy->x * cell);
            ey = oy + (enemy->y * cell);
            mmFillRect(ex + 1, ey + 1, cell - 2, cell - 2, MM_COLOR_ENEMY);
        }
    }
    /* プレイヤー位置 (2x2) と向き (1px) は表示モードに関わらず常に描く */
    {
        const u16 bx = ox + (px * cell);
        const u16 by = oy + (py * cell);
        static const s8 face_dx[4] = { 1, 3, 1, 0 };
        static const s8 face_dy[4] = { 0, 1, 3, 1 };
        mmFillRect(bx + 1, by + 1, 2, 2, MM_COLOR_PLAYER);
        mmSetPixel(bx + face_dx[dir & 3], by + face_dy[dir & 3], MM_COLOR_PLAYER);
    }
    VDP_loadTileData(mm_tiles, DUN_MM_BASE, DUN_MM_TILES_W * DUN_MM_TILES_H, DMA_QUEUE);
}

/* ------------------------------------------------------------
 * 公開 API
 * ------------------------------------------------------------ */

void DUN_drawStatic(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    last_static_floor = floor;
    last_static_x = x;
    last_static_y = y;
    last_static_dir = dir & 3;
    evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_move, DUN_MOVE_EDGE_COUNT);
    stageFrame(active_view_set->frame_static, FALSE);
    updateBillboards(floor, x, y, dir & 3, dun_bb_static, FALSE);
    flushFrame();
}

/*
 * プレイヤー静止中にエネミーだけが動いた場合の軽量リフレッシュ。壁タイルの再ステージ・
 * DMA 転送は行わず、直近の DUN_drawStatic のカメラ位置でビルボードだけを更新する。
 */
void DUN_refreshBillboards(void)
{
    if (!last_static_floor) return;
    updateBillboards(last_static_floor, last_static_x, last_static_y, last_static_dir, dun_bb_static, FALSE);
    SPR_update();
}

void DUN_playForward(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    u16 frame;
    evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_move, DUN_MOVE_EDGE_COUNT);
    for (frame = 0; frame < DUN_FWD_FRAMES; frame++)
    {
        stageFrame(&active_view_set->frames_fwd[frame], FALSE);
        updateBillboards(floor, x, y, dir & 3, dun_bb_fwd[frame], FALSE);
        flushFrame();
    }
}

/* 後退 = 移動先セル (target) 基準の前進アニメーションを逆再生する */
void DUN_playBackward(const DungeonFloorData *floor, u8 target_x, u8 target_y, u8 dir)
{
    u16 frame;
    evaluateEdgeStates(floor, target_x, target_y, dir & 3, dun_edges_move, DUN_MOVE_EDGE_COUNT);
    for (frame = DUN_FWD_FRAMES; frame > 0; frame--)
    {
        stageFrame(&active_view_set->frames_fwd[frame - 1], FALSE);
        updateBillboards(floor, target_x, target_y, dir & 3, dun_bb_fwd[frame - 1], FALSE);
        flushFrame();
    }
}

/* 左回転は右回転テーブルの鏡像評価 + 水平反転合成 */
void DUN_playTurn(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, bool left)
{
    u16 frame;
    if (left) evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_turn_mirrored, DUN_TURN_EDGE_COUNT);
    else evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_turn, DUN_TURN_EDGE_COUNT);
    for (frame = 0; frame < DUN_TURN_FRAMES; frame++)
    {
        stageFrame(&active_view_set->frames_turn[frame], left);
        updateBillboards(floor, x, y, dir & 3, dun_bb_turn[frame], left);
        flushFrame();
    }
}

void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir)
{
    static const char dirs[4] = { 'N', 'E', 'S', 'W' };
    char line[40];
    VDP_clearTextLine(0);
    VDP_clearTextLine(1);
    sprintf(line, "DBG F:%u X:%02u Y:%02u DIR:%c(%u)", floor_index + 1, x, y, dirs[dir & 3], dir & 3);
    VDP_drawText(line, 1, 0);
    VDP_drawText("UP/DOWN MOVE  LEFT/RIGHT TURN", 1, 1);
}
