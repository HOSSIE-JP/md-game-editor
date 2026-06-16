/* ===================================================================
 * GERO Block - グラフィック管理
 * エディタからエクスポートしたリソース（スプライト・画像・パレット）を
 * VRAMにロードする。リソース未設定時はプログラム生成のフォールバックを使用。
 * =================================================================== */

#include "game.h"
#include "game_resources.h"

#if defined(__GNUC__)
#define BLOCK_UNUSED __attribute__((unused))
#else
#define BLOCK_UNUSED
#endif

/* ===================================================================
 * フォールバック用パレット（リソース未バインド時）
 * =================================================================== */

/* システムパレット（PAL0）: フォント用にindex 15 = 白（0x0EEE）を含む
 * SGDK デフォルトの palette_grey と同一 */
static const u16 BLOCK_UNUSED fallback_system_palette[16] = {
    0x0000, 0x0222, 0x0444, 0x0666, 0x0888, 0x0AAA, 0x0CCC, 0x0EEE,
    0x0EEE, 0x0EEE, 0x0EEE, 0x0EEE, 0x0EEE, 0x0EEE, 0x0EEE, 0x0EEE
};

static const u16 BLOCK_UNUSED fallback_block_palette[16] = {
    0x0000,
    RGB24_TO_VDPCOLOR(0xE0E0E0), RGB24_TO_VDPCOLOR(0x808080),
    RGB24_TO_VDPCOLOR(0xE0D000), RGB24_TO_VDPCOLOR(0x808000),
    RGB24_TO_VDPCOLOR(0x00C000), RGB24_TO_VDPCOLOR(0x006000),
    RGB24_TO_VDPCOLOR(0x0060E0), RGB24_TO_VDPCOLOR(0x003080),
    RGB24_TO_VDPCOLOR(0x808080), RGB24_TO_VDPCOLOR(0x404040),
    RGB24_TO_VDPCOLOR(0xFFFFFF), RGB24_TO_VDPCOLOR(0xFF8080),
    0x0000, 0x0000, 0x0000
};

static const u16 BLOCK_UNUSED fallback_sprite_palette[16] = {
    0x0000,
    RGB24_TO_VDPCOLOR(0xFFFFFF), RGB24_TO_VDPCOLOR(0x00C0E0),
    RGB24_TO_VDPCOLOR(0x60E0FF), RGB24_TO_VDPCOLOR(0xFF60B0),
    RGB24_TO_VDPCOLOR(0xFF8000), RGB24_TO_VDPCOLOR(0x00B0FF),
    RGB24_TO_VDPCOLOR(0x00E000), RGB24_TO_VDPCOLOR(0xC0C0C0),
    RGB24_TO_VDPCOLOR(0xFFFF00),
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
};

/* ===================================================================
 * リソースからタイルデータをVRAMにロードするヘルパー
 * =================================================================== */

/**
 * SpriteDefinition からタイルデータを抽出して VRAM にロード
 * @param def       スプライト定義
 * @param tile_idx  VRAM タイルインデックス
 * @param max_tiles ロードする最大タイル数（VRAMレイアウト保護）
 */
static void loadSpriteTilesToVRAM(const SpriteDefinition *def, u16 tile_idx, u16 max_tiles)
{
    const TileSet *ts = def->animations[0]->frames[0]->tileset;
    u16 num = ts->numTile;
    if (num > max_tiles) num = max_tiles;

    if (ts->compression == COMPRESSION_NONE)
        VDP_loadTileData((const u32 *)ts->tiles, tile_idx, num, DMA);
    else
        VDP_loadTileSet(ts, tile_idx, DMA); /* 圧縮時はフル展開（注意） */
}

static void loadSpritePaletteOrFallback(u16 pal, const SpriteDefinition *def, const u16 *fallback)
{
    if (def && def->palette && def->palette->data)
        PAL_setPalette(pal, def->palette->data, CPU);
    else
        PAL_setPalette(pal, fallback, CPU);
}

static void loadSystemPalette(void)
{
#ifdef RES_SYSTEM_FONT_PALETTE
    PAL_setPalette(PAL_SYSTEM, RES_SYSTEM_FONT_PALETTE.data, CPU);
#else
    PAL_setPalette(PAL_SYSTEM, fallback_system_palette, CPU);
#endif
    PAL_setColor(PAL_SYSTEM * 16 + PAL_SYSTEM_WINDOW_BG_COLOR, 0x0000);
}

void gfxLoadSystemPalette(void)
{
    loadSystemPalette();
}

/* ===================================================================
 * フォールバック: プログラムによるタイル生成
 * =================================================================== */

static const u8 fb_fill[6]   = { 0, 1, 3, 5, 7, 9 };
static const u8 fb_border[6] = { 0, 2, 4, 6, 8, 10 };

static u32 makeRow(u8 c0, u8 c1, u8 c2, u8 c3, u8 c4, u8 c5, u8 c6, u8 c7)
{
    return ((u32)c0 << 28) | ((u32)c1 << 24) | ((u32)c2 << 20) | ((u32)c3 << 16)
         | ((u32)c4 << 12) | ((u32)c5 << 8)  | ((u32)c6 << 4)  | (u32)c7;
}

static u32 solidRow(u8 color)
{
    return makeRow(color, color, color, color, color, color, color, color);
}

static void BLOCK_UNUSED generateBlockTileData(u8 block_type, u32 *out)
{
    u8 f = fb_fill[block_type];
    u8 b = fb_border[block_type];
    u8 h = 11;

    for (u8 t = 0; t < 2; t++)
    {
        bool left_col  = (t == 0);
        bool right_col = (t == 1);

        for (u8 row = 0; row < 8; row++)
        {
            bool is_top    = (row == 0);
            bool is_bottom = (row == 7);

            if (is_top || is_bottom)
            {
                out[t * 8 + row] = solidRow(b);
            }
            else
            {
                u8 px[8];
                for (u8 p = 0; p < 8; p++)
                {
                    bool is_left  = (left_col && p == 0);
                    bool is_right = (right_col && p == 7);
                    px[p] = (is_left || is_right) ? b : f;
                }
                if (t == 0 && row == 1 && f != 0) px[1] = h;
                out[t * 8 + row] = makeRow(px[0], px[1], px[2], px[3],
                                           px[4], px[5], px[6], px[7]);
            }
        }
    }
}

static const u32 BLOCK_UNUSED fb_ball_tile[8] = {
    0x00000000, 0x00111000, 0x01111100, 0x01111100,
    0x01111100, 0x00111000, 0x00000000, 0x00000000
};

static const u32 BLOCK_UNUSED fb_paddle_0[8] = {
    0x00022222, 0x00222222, 0x02222222, 0x32222222,
    0x22222222, 0x02222222, 0x00222222, 0x00022222
};
static const u32 BLOCK_UNUSED fb_paddle_mid[8] = {
    0x22222222, 0x22222222, 0x22222222, 0x32222222,
    0x22222222, 0x22222222, 0x22222222, 0x22222222
};
static const u32 BLOCK_UNUSED fb_paddle_3[8] = {
    0x22222000, 0x22222200, 0x22222220, 0x22222220,
    0x22222220, 0x22222220, 0x22222200, 0x22222000
};

static const u32 BLOCK_UNUSED fb_pu_multi[16] = {
    0x00000000, 0x00084000, 0x00848400, 0x08444480,
    0x08444480, 0x00848400, 0x00084000, 0x00000000,
    0x00000000, 0x00048000, 0x00484800, 0x04848840,
    0x04848840, 0x00484800, 0x00048000, 0x00000000,
};
static const u32 BLOCK_UNUSED fb_pu_strong[16] = {
    0x00000000, 0x00555000, 0x05555500, 0x05585500,
    0x05555500, 0x05555500, 0x00555000, 0x00000000,
    0x00000000, 0x00555000, 0x05555500, 0x05555500,
    0x05585500, 0x05555500, 0x00555000, 0x00000000,
};
static const u32 BLOCK_UNUSED fb_pu_speedup[16] = {
    0x00000000, 0x00060000, 0x00660000, 0x06666000,
    0x06666000, 0x00660000, 0x00060000, 0x00000000,
    0x00000000, 0x00006000, 0x00066000, 0x00666600,
    0x00666600, 0x00066000, 0x00006000, 0x00000000,
};
static const u32 BLOCK_UNUSED fb_pu_barrier[16] = {
    0x00000000, 0x00770000, 0x07777000, 0x77777700,
    0x77777700, 0x07777000, 0x00770000, 0x00000000,
    0x00000000, 0x00077000, 0x00777700, 0x07777770,
    0x07777770, 0x00777700, 0x00077000, 0x00000000,
};

static const u32 barrier_tile_data[8] = {
    0x99999999, 0x00000000, 0x99999999, 0x00000000,
    0x00000000, 0x00000000, 0x00000000, 0x00000000
};

static const u32 window_bg_tile_data[8] = {
    0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF,
    0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF
};

static const u32 text_shadow_tile_data[8] = {
#if TEXT_PANEL_USE_HILIGHT_SHADOW
    0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF,
    0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF
#else
    0xF0F0F0F0, 0x0F0F0F0F, 0xF0F0F0F0, 0x0F0F0F0F,
    0xF0F0F0F0, 0x0F0F0F0F, 0xF0F0F0F0, 0x0F0F0F0F
#endif
};

static void coverBackgroundUnderGamePanel(void)
{
    VDP_fillTileMapRect(
        BG_B,
        TILE_ATTR_FULL(PAL_SYSTEM, FALSE, FALSE, FALSE, TILE_WINDOW_BG_IDX),
        UI_PANEL_TILE_X,
        0,
        UI_PANEL_W / 8,
        SCREEN_H / 8
    );
}

static u16 dimVdpColor(u16 color)
{
    u16 r = color & 0x00E;
    u16 g = (color >> 4) & 0x00E;
    u16 b = (color >> 8) & 0x00E;

    r = ((r * 3) / 4) & 0x00E;
    g = ((g * 3) / 4) & 0x00E;
    b = ((b * 3) / 4) & 0x00E;

    return (color & 0xF000) | r | (g << 4) | (b << 8);
}

static void dimBackgroundPalette(void)
{
    u16 palette[16];

    PAL_getColors(PAL_BG * 16, palette, 16);
    palette[0] = 0x0000;
    for (u8 index = 1; index < 16; index++)
    {
        palette[index] = dimVdpColor(palette[index]);
    }
    PAL_setPalette(PAL_BG, palette, CPU);
}

/* ===================================================================
 * パブリック関数
 * =================================================================== */

/** グラフィックス初期化（パレット＋全タイルロード） */
void gfxInit(void)
{
    gfxLoadPalettes();
#ifdef RES_SYSTEM_FONT
    VDP_loadFont(&RES_SYSTEM_FONT, DMA);
#endif
    gfxLoadBlockTiles();
    gfxLoadSpriteTiles();
}

/** パレットをVDPにロード */
void gfxLoadPalettes(void)
{
    loadSystemPalette();
#ifdef RES_SPR_BALL
    loadSpritePaletteOrFallback(PAL_SPRITES, &RES_SPR_BALL, fallback_sprite_palette);
#else
    PAL_setPalette(PAL_SPRITES, fallback_sprite_palette, CPU);
#endif
#ifdef RES_SPR_BLOCK_WHITE
    loadSpritePaletteOrFallback(PAL_BLOCKS, &RES_SPR_BLOCK_WHITE, fallback_block_palette);
#else
    PAL_setPalette(PAL_BLOCKS, fallback_block_palette, CPU);
#endif
}

/** ブロックタイルをVRAMにロード */
void gfxLoadBlockTiles(void)
{
#ifdef RES_SPR_BLOCK_WHITE
    loadSpriteTilesToVRAM(&RES_SPR_BLOCK_WHITE, TILE_BLOCK_START + 0 * TILES_PER_BLOCK, TILES_PER_BLOCK);
#else
    { u32 buf[16]; generateBlockTileData(BLOCK_WHITE, buf);
      VDP_loadTileData(buf, TILE_BLOCK_START + 0 * TILES_PER_BLOCK, TILES_PER_BLOCK, DMA); }
#endif

#ifdef RES_SPR_BLOCK_YELLOW
    loadSpriteTilesToVRAM(&RES_SPR_BLOCK_YELLOW, TILE_BLOCK_START + 1 * TILES_PER_BLOCK, TILES_PER_BLOCK);
#else
    { u32 buf[16]; generateBlockTileData(BLOCK_YELLOW, buf);
      VDP_loadTileData(buf, TILE_BLOCK_START + 1 * TILES_PER_BLOCK, TILES_PER_BLOCK, DMA); }
#endif

#ifdef RES_SPR_BLOCK_GREEN
    loadSpriteTilesToVRAM(&RES_SPR_BLOCK_GREEN, TILE_BLOCK_START + 2 * TILES_PER_BLOCK, TILES_PER_BLOCK);
#else
    { u32 buf[16]; generateBlockTileData(BLOCK_GREEN, buf);
      VDP_loadTileData(buf, TILE_BLOCK_START + 2 * TILES_PER_BLOCK, TILES_PER_BLOCK, DMA); }
#endif

#ifdef RES_SPR_BLOCK_BLUE
    loadSpriteTilesToVRAM(&RES_SPR_BLOCK_BLUE, TILE_BLOCK_START + 3 * TILES_PER_BLOCK, TILES_PER_BLOCK);
#else
    { u32 buf[16]; generateBlockTileData(BLOCK_BLUE, buf);
      VDP_loadTileData(buf, TILE_BLOCK_START + 3 * TILES_PER_BLOCK, TILES_PER_BLOCK, DMA); }
#endif

#ifdef RES_SPR_BLOCK_GRAY
    loadSpriteTilesToVRAM(&RES_SPR_BLOCK_GRAY, TILE_BLOCK_START + 4 * TILES_PER_BLOCK, TILES_PER_BLOCK);
#else
    { u32 buf[16]; generateBlockTileData(BLOCK_GRAY, buf);
      VDP_loadTileData(buf, TILE_BLOCK_START + 4 * TILES_PER_BLOCK, TILES_PER_BLOCK, DMA); }
#endif
}

/** スプライトタイルをVRAMにロード */
void gfxLoadSpriteTiles(void)
{
#ifdef RES_SPR_BALL
    loadSpriteTilesToVRAM(&RES_SPR_BALL, TILE_BALL_IDX, 1);
#else
    VDP_loadTileData(fb_ball_tile, TILE_BALL_IDX, 1, DMA);
#endif

#ifdef RES_SPR_PADDLE
    loadSpriteTilesToVRAM(&RES_SPR_PADDLE, TILE_PADDLE_IDX, TILE_PADDLE_COUNT);
#else
    VDP_loadTileData(fb_paddle_0,   TILE_PADDLE_IDX,     1, DMA);
    VDP_loadTileData(fb_paddle_mid, TILE_PADDLE_IDX + 1, 1, DMA);
    VDP_loadTileData(fb_paddle_mid, TILE_PADDLE_IDX + 2, 1, DMA);
    VDP_loadTileData(fb_paddle_3,   TILE_PADDLE_IDX + 3, 1, DMA);
#endif

#ifdef RES_SPR_POWERUP_MULTI_BALL
    loadSpriteTilesToVRAM(&RES_SPR_POWERUP_MULTI_BALL, TILE_POWERUP_IDX + 0 * TILES_PER_POWERUP, TILES_PER_POWERUP);
#else
    VDP_loadTileData(fb_pu_multi, TILE_POWERUP_IDX + 0 * TILES_PER_POWERUP, TILES_PER_POWERUP, DMA);
#endif

#ifdef RES_SPR_POWERUP_STRONG
    loadSpriteTilesToVRAM(&RES_SPR_POWERUP_STRONG, TILE_POWERUP_IDX + 1 * TILES_PER_POWERUP, TILES_PER_POWERUP);
#else
    VDP_loadTileData(fb_pu_strong, TILE_POWERUP_IDX + 1 * TILES_PER_POWERUP, TILES_PER_POWERUP, DMA);
#endif

#ifdef RES_SPR_POWERUP_SPEED_UP
    loadSpriteTilesToVRAM(&RES_SPR_POWERUP_SPEED_UP, TILE_POWERUP_IDX + 2 * TILES_PER_POWERUP, TILES_PER_POWERUP);
#else
    VDP_loadTileData(fb_pu_speedup, TILE_POWERUP_IDX + 2 * TILES_PER_POWERUP, TILES_PER_POWERUP, DMA);
#endif

#ifdef RES_SPR_POWERUP_BARRIER
    loadSpriteTilesToVRAM(&RES_SPR_POWERUP_BARRIER, TILE_POWERUP_IDX + 3 * TILES_PER_POWERUP, TILES_PER_POWERUP);
#else
    VDP_loadTileData(fb_pu_barrier, TILE_POWERUP_IDX + 3 * TILES_PER_POWERUP, TILES_PER_POWERUP, DMA);
#endif

    VDP_loadTileData(barrier_tile_data, TILE_BARRIER_IDX, 1, DMA);
    VDP_loadTileData(window_bg_tile_data, TILE_WINDOW_BG_IDX, 1, DMA);
    for (u8 i = 0; i < TILE_TEXT_SHADOW_COUNT; i++)
    {
        VDP_loadTileData(text_shadow_tile_data, TILE_TEXT_SHADOW_IDX + i, 1, DMA);
    }
}

/** 背景画像をBG_Bに描画
 *  VDP_drawImageEx が PAL をセットするので、その後にゲーム用パレットを再ロード */
void gfxDrawBackground(const Image *background_image)
{
    if (background_image)
    {
        VDP_drawImageEx(
            BG_B, background_image,
            TILE_ATTR_FULL(PAL_BG, FALSE, FALSE, FALSE, TILE_BG_START),
            0, 0, TRUE, DMA
        );
    }
    coverBackgroundUnderGamePanel();
    dimBackgroundPalette();
    /* 背景画像描画後にブロック/スプライト用パレットを再設定 */
    gfxLoadPalettes();
}
