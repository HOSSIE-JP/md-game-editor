/* =============================================================
 * Dungeon View — デシジョンテーブル方式の疑似3Dビュー描画
 *
 * エディタが焼き込んだ「画面タイルごとの周囲エッジ状態→タイル実体」
 * の三分木 (dungeon_patterns.c) を毎アニメフレーム評価し、
 * ROM 上のタイルセットから 400 タイルを VRAM のダブルバッファへ
 * DMA ストリーミングして 25x16 のビューを合成する。
 *
 *  - 前進/後退: dun_frames_fwd を順再生/逆再生
 *  - 右回転:   dun_frames_turn を再生
 *  - 左回転:   右回転テーブルを鏡像評価 (dun_edges_turn_mirrored) し
 *              水平反転で合成する
 *  - 宝箱/階段: プリスケール済みビルボードスプライト (dun_bb_*)
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
static Sprite *bb_sprites[DUN_SPRITE_COUNT];

void DUN_initView(void)
{
    u16 i;
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    PAL_setPalette(PAL0, dungeon_view_palette.data, CPU);
    PAL_setPalette(PAL1, dungeon_bb_palette.data, CPU);
    SPR_init();
    for (i = 0; i < DUN_SPRITE_COUNT; i++) bb_sprites[i] = NULL;
    back_bank = 0;
    view_dark = FALSE;
}

void DUN_setDark(bool dark)
{
    if (dark == view_dark) return;
    view_dark = dark;
    if (dark) PAL_setColors(0, dun_palette_dark, 16, CPU);
    else PAL_setPalette(PAL0, dungeon_view_palette.data, CPU);
}

/* ------------------------------------------------------------
 * エッジ状態評価 (0=開 / 1=壁 / 2=扉) — render-core と同一仕様
 * ------------------------------------------------------------ */

static bool inBounds(const DungeonFloorData *floor, s16 x, s16 y)
{
    return x >= 0 && y >= 0 && x < floor->width && y < floor->height;
}

static u8 edgeStateBetween(const DungeonFloorData *floor, s16 x, s16 y, u8 cross_dir)
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
        src = &dungeon_view_tileset.tiles[(u32)global * 8];
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
 * (6.4KB + 6.4KB + タイルマップ 800B を DMA キューで分割転送)
 */
static void flushFrame(void)
{
    const u16 bank_base = back_bank ? DUN_BANK1_INDEX : DUN_BANK0_INDEX;
    VDP_loadTileData(tile_staging, bank_base, DUN_BANK_HALF, DMA_QUEUE);
    SPR_update();
    SYS_doVBlankProcess();
    VDP_loadTileData(tile_staging + ((u32)DUN_BANK_HALF * 8), (u16)(bank_base + DUN_BANK_HALF), DUN_BANK_HALF, DMA_QUEUE);
    VDP_setTileMapDataRect(BG_A, map_staging, DUN_VIEW_X, DUN_VIEW_Y, DUN_VIEW_TILE_W, DUN_VIEW_TILE_H, DUN_VIEW_TILE_W, DMA_QUEUE);
    SPR_update();
    SYS_doVBlankProcess();
    back_bank ^= 1;
}

/* ------------------------------------------------------------
 * ビルボード (宝箱・階段)
 * ------------------------------------------------------------ */

static bool losPathClear(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, s8 dd, s8 dl, bool depth_first)
{
    const u8 right = (u8)((dir + 1) & 3);
    s16 cx = x;
    s16 cy = y;
    u8 pass;
    for (pass = 0; pass < 2; pass++)
    {
        const bool depth_step = depth_first ? (pass == 0) : (pass == 1);
        const s8 amount = depth_step ? dd : dl;
        const u8 base_dir = depth_step ? dir : right;
        const u8 cross = amount >= 0 ? base_dir : (u8)((base_dir + 2) & 3);
        s8 remain = amount >= 0 ? amount : (s8)(-amount);
        while (remain > 0)
        {
            if (edgeStateBetween(floor, cx, cy, cross) != 0) return FALSE;
            cx += dir_dx[cross];
            cy += dir_dy[cross];
            remain--;
        }
    }
    return TRUE;
}

static bool losVisible(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, s8 dd, s8 dl)
{
    if (dd == 0 && dl == 0) return TRUE;
    if (losPathClear(floor, x, y, dir, dd, dl, TRUE)) return TRUE;
    return losPathClear(floor, x, y, dir, dd, dl, FALSE);
}

static const SpriteDefinition *billboardDefForFlags(u8 flags)
{
    if (flags & DUN_FLAG_CHEST) return &dungeon_bb_chest;
    if (flags & DUN_FLAG_STAIRS_UP) return &dungeon_bb_stairs_up;
    if (flags & DUN_FLAG_STAIRS_DOWN) return &dungeon_bb_stairs_down;
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
        u8 flags;
        const SpriteDefinition *def;
        s16 sx;
        s16 sy;
        if (pose->frame < 0) continue;
        dd = dun_bb_cells[i].dd;
        dl = dun_bb_cells[i].dl;
        if (mirrored) dl = (s8)(-dl);
        ax = (s16)x + (s16)dd * dir_dx[dir] + (s16)dl * dir_dx[right];
        ay = (s16)y + (s16)dd * dir_dy[dir] + (s16)dl * dir_dy[right];
        if (!inBounds(floor, ax, ay)) continue;
        flags = floor->flags[DUN_INDEX(floor, ax, ay)];
        def = billboardDefForFlags(flags);
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
        SPR_setFrame(bb_sprites[used], pose->frame);
        SPR_setVisibility(bb_sprites[used], VISIBLE);
        used++;
    }
    for (; used < DUN_SPRITE_COUNT; used++)
    {
        if (bb_sprites[used]) SPR_setVisibility(bb_sprites[used], HIDDEN);
    }
}

/* ------------------------------------------------------------
 * 公開 API
 * ------------------------------------------------------------ */

void DUN_drawStatic(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_move, DUN_MOVE_EDGE_COUNT);
    stageFrame(&dun_frame_static, FALSE);
    updateBillboards(floor, x, y, dir & 3, dun_bb_static, FALSE);
    flushFrame();
}

void DUN_playForward(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    u16 frame;
    evaluateEdgeStates(floor, x, y, dir & 3, dun_edges_move, DUN_MOVE_EDGE_COUNT);
    for (frame = 0; frame < DUN_FWD_FRAMES; frame++)
    {
        stageFrame(&dun_frames_fwd[frame], FALSE);
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
        stageFrame(&dun_frames_fwd[frame - 1], FALSE);
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
        stageFrame(&dun_frames_turn[frame], left);
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
