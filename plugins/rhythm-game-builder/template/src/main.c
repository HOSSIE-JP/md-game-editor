/**
 * main.c - MDリズムゲーム エントリーポイントとステートマシン
 *
 * MD Rhythm Editor により自動生成
 * ゲームループと画面遷移:
 *   タイトル → 選曲 → ゲームプレイ → リザルト → (選曲)
 */

#include <genesis.h>

#include "game_def.h"
#include "game.h"
#include "note.h"
#include "hud.h"
#include "input.h"
#include "sound.h"
#include "song_data.h"
#include "rhythm.h"
#include "wobble.h"
#include "rhythm_resources.h"
#include "highscore.h"
#include "helpers.h"
#include <utils/draw_sjis.h>

/* SJIS描画用VRAMタイル領域（選曲画面/ゲームプレイ共用） */
#define SJIS_VRAM_BASE    1200
#define SJIS_TILES_PER_ENTRY 14

/* 現在のゲーム状態 */
static u8 current_state;

/* 選択中の楽曲と難易度 */
static u16 selected_song;
static u8 selected_difficulty;

/* システムパレット(PAL0)の退避 */
static u16 system_palette_pal0[16];

/* プレビュー再生中の楽曲ID */
static u16 preview_song_id;

/* ジョイパッドイベントハンドラ */
static void joyEventHandler(u16 joy, u16 changed, u16 state);

/* 各画面の初期化・更新関数 */
static void initTitle(void);
static void updateTitle(void);
static void initSelect(void);
static void updateSelect(void);
static void initGameplay(void);
static void updateGameplay(void);
static void initResult(void);
static void updateResult(void);
static void fadeOutScene(void);
static void fadeInScene(void);

static void drawGameplayHeaderText(const SongEntry* entry);
static void drawSelectMeta(void);
static void startPreview(void);

static void restoreSystemPal0(void)
{
    PAL_setPalette(PAL0, system_palette_pal0, CPU);
}

#define SCENE_FADE_FRAMES 12

/* Select a safe animation index for difficulty icon. */
static u16 getDiffIconAnimIndex(void)
{
    if (spr_icon_diff.numAnimation == 0) return 0;
    if (selected_difficulty >= spr_icon_diff.numAnimation) return 0;
    return selected_difficulty;
}

static void fadeOutScene(void)
{
    PAL_fadeOut(0, 63, SCENE_FADE_FRAMES, FALSE);
    PAL_setColors(0, palette_black, 64, CPU);
}

static void fadeInScene(void)
{
    u16 pal_work[64];
    PAL_getColors(0, pal_work, 64);
    PAL_fadeIn(0, 63, pal_work, SCENE_FADE_FRAMES, FALSE);
}

/* ============================================================
 * 選曲画面: wobble風 背景/H-INT/疑似透過メニュー
 * ============================================================ */

#define SELECT_WOBBLE_MENU_OFFSET_X  1
#define SELECT_WOBBLE_MENU_OFFSET_Y  5
#ifndef SELECT_WOBBLE_AMPLITUDE_DEF
#define SELECT_WOBBLE_AMPLITUDE_DEF  FIX16(0.6250)
#endif
#ifndef SELECT_WOBBLE_SPEED_DEF
#define SELECT_WOBBLE_SPEED_DEF      FIX16(1.0000)
#endif
#ifndef SELECT_WOBBLE_ANGVEL_DEF
#define SELECT_WOBBLE_ANGVEL_DEF     FIX16(4.0000)
#endif

#ifndef SELECT_DIAG_SCROLL_X_SPEED
#define SELECT_DIAG_SCROLL_X_SPEED   FIX16(0.5000)
#endif
#ifndef SELECT_DIAG_SCROLL_Y_SPEED
#define SELECT_DIAG_SCROLL_Y_SPEED   FIX16(0.5000)
#endif

#define SELECT_MENU_ATTR(v, h, idx) TILE_ATTR_FULL(PAL3, 0, v, h, idx)

static bool  select_wobble_enabled = FALSE;
static vu16  select_line_display = 0;
static vfix16 select_line_graphics = 0;
static s16   select_line_buffer[224];
static fix16 select_wave = 0;
static fix16 select_angle = 0;

static fix16 select_diag_scroll_x = 0;
static fix16 select_diag_scroll_y = 0;
static s16   select_diag_scroll_x_px = 0;
static s16   select_diag_scroll_y_px = 0;

HINTERRUPT_CALLBACK selectHIntHandler()
{
    if (!select_wobble_enabled) return;
    VDP_setVerticalScroll(BG_B, select_diag_scroll_y_px + F16_toInt(select_line_graphics) - select_line_display);
    if (select_line_display < 224)
        select_line_graphics += select_line_buffer[select_line_display++];
}

static void selectVBlankHandler(void)
{
    if (!select_wobble_enabled) return;
    select_line_display = 0;
    select_line_graphics = 0;
    VDP_setVerticalScroll(BG_B, select_diag_scroll_y_px + F16_toInt(select_line_graphics) - select_line_display);
}

static void enableSelectWobble(void)
{
    select_wobble_enabled = TRUE;
    SYS_disableInts();
    SYS_setVBlankCallback(selectVBlankHandler);
    SYS_setHIntCallback(selectHIntHandler);
    VDP_setHIntCounter(0);
    VDP_setHInterrupt(TRUE);
    SYS_enableInts();
}

static void disableSelectWobble(void)
{
    SYS_disableInts();
    VDP_setHInterrupt(FALSE);
    SYS_setHIntCallback(NULL);
    SYS_setVBlankCallback(NULL);
    SYS_enableInts();
    select_wobble_enabled = FALSE;
    select_diag_scroll_x = 0;
    select_diag_scroll_y = 0;
    select_diag_scroll_x_px = 0;
    select_diag_scroll_y_px = 0;
    VDP_setHorizontalScroll(BG_B, 0);
    VDP_setVerticalScroll(BG_B, 0);
}

static void setupSelectWobbleBackground(void)
{
    const u16 w = 64 / 8;
    const u16 h = 64 / 8;
    PAL_setPalette(PAL1, image_sgdk_logo.palette->data, CPU);
    VDP_loadTileSet(image_sgdk_logo.tileset, TILE_USER_INDEX, CPU);
    VDP_clearTileMapRect(BG_B, 0, 0, 64, 32);
    for (u16 y = 0; y < 32; y += h)
    {
        for (s16 x = -w; x < 40; x += w)
        {
            const s16 shift = (3 * y / h) % w;
            VDP_setTileMapEx(BG_B, image_sgdk_logo.tilemap,
                             TILE_ATTR_FULL(PAL1, FALSE, FALSE, FALSE, TILE_USER_INDEX),
                             x + shift, y, 0, 0, w, h, CPU);
        }
    }
}

static void setupSelectBackdropSprites(void)
{
    resetSpriteHelper();
    const u16 idxCorner = loadSpriteData(&sprite_MenuBackdrop_Corner);
    const u16 idxEdgeH  = loadSpriteData(&sprite_MenuBackdrop_EdgeH);
    const u16 idxEdgeV  = loadSpriteData(&sprite_MenuBackdrop_EdgeV);
    const u16 idxCenter = loadSpriteData(&sprite_MenuBackdrop_Center);
    PAL_setPalette(PAL3, sprite_MenuBackdrop_Center.palette->data, CPU);
    /* 文字領域を暗く見せるため、パネル全体をshadow寄りで統一 */
    addSprite(  0,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxCorner));
    addSprite( 32,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite( 64,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite( 96,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(128,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(136,  0, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(168,  0, SELECT_MENU_ATTR(FALSE,  TRUE, idxCorner));
    addSprite(  0, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeV));
    addSprite( 32, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxCenter));
    addSprite( 64, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxCenter));
    addSprite( 96, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxCenter));
    addSprite(128, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxCenter));
    addSprite(136, 32, SELECT_MENU_ATTR(FALSE, FALSE, idxCenter));
    addSprite(168, 32, SELECT_MENU_ATTR(FALSE,  TRUE, idxEdgeV));
    addSprite(  0, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxCorner));
    addSprite( 32, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite( 64, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite( 96, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(128, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(136, 64, SELECT_MENU_ATTR(FALSE, FALSE, idxEdgeH));
    addSprite(168, 64, SELECT_MENU_ATTR(FALSE,  TRUE, idxCorner));
    moveSprites(SELECT_WOBBLE_MENU_OFFSET_X * 8, SELECT_WOBBLE_MENU_OFFSET_Y * 8);
}

static void updateSelectDiagonalScroll(void)
{
    /* 背景を右上→左下へ流す（視覚移動） */
    select_diag_scroll_x -= SELECT_DIAG_SCROLL_X_SPEED;
    select_diag_scroll_y += SELECT_DIAG_SCROLL_Y_SPEED;
    select_diag_scroll_x_px = (s16)F16_toInt(select_diag_scroll_x);
    select_diag_scroll_y_px = (s16)F16_toInt(select_diag_scroll_y);
    if (select_diag_scroll_x_px < -511)
    {
        select_diag_scroll_x += FIX16(512.0);
        select_diag_scroll_x_px = (s16)F16_toInt(select_diag_scroll_x);
    }
    if (select_diag_scroll_y_px > 511)
    {
        select_diag_scroll_y -= FIX16(512.0);
        select_diag_scroll_y_px = (s16)F16_toInt(select_diag_scroll_y);
    }
    VDP_setHorizontalScroll(BG_B, select_diag_scroll_x_px);
}

static void updateSelectWobbleWave(void)
{
    const fix16 amplitude = SELECT_WOBBLE_AMPLITUDE_DEF;
    const fix16 wave_speed = SELECT_WOBBLE_SPEED_DEF;
    const fix16 angular_velocity = SELECT_WOBBLE_ANGVEL_DEF;
    select_wave += wave_speed;
    u16 steps = F16_toInt(select_wave);
    if (steps == 0) return;
    if (steps > 223) steps = 223;
    for (u16 i = 0; i < (224 - steps); i++)
        select_line_buffer[i] = select_line_buffer[i + steps];
    for (; steps > 0; steps--, select_wave -= FIX16(1.0))
    {
        select_angle += angular_velocity;
        select_line_buffer[224 - steps] = FIX16(1.0) + F16_mul(amplitude, sinFix16(F16_toInt(select_angle) + 512));
    }
}

/**
 * BG_B に背景画像をロードし、テキスト色を復元する。
 * @param img IMAGE リソースへのポインタ
 * @param vram_idx ロード先のVRAMタイルインデックス
 * @param pal 背景に使用するパレットライン
 * @return 画像が使用したタイル数
 */
static u16 loadBackground(const Image* img, u16 vram_idx, u16 pal)
{
    PAL_setPalette(pal, img->palette->data, CPU);
    VDP_drawImageEx(BG_B, img, TILE_ATTR_FULL(pal, FALSE, FALSE, FALSE, vram_idx), 0, 0, FALSE, TRUE);
    return img->tileset->numTile;
}

/**
 * 選曲画面の背景とアルバムアートをロードする。
 */
static void loadSelectBg(void)
{
    const u16 album_x = 26; /* 208px */
    const u16 album_y = 5;  /* 40px */
    const u16 album_vram = TILE_USER_INDEX + image_sgdk_logo.tileset->numTile;

    VDP_clearPlane(BG_A, TRUE);

    if (song_count > 0)
    {
        const Image* art = song_database[selected_song].album_art;
        if (art != NULL)
        {
            PAL_setPalette(PAL1, art->palette->data, CPU);
            VDP_drawImageEx(BG_A, art,
                            TILE_ATTR_FULL(PAL1, FALSE, FALSE, FALSE, album_vram),
                            album_x, album_y, FALSE, TRUE);
            return;
        }
    }
}

/* ============================================================
 * ゲームプレイ背景とシステムUIオーバーレイ
 * ============================================================ */

/* VRAM slots reserved in initGameplay() */
static u16 gp_bg_vram;
static u16 gp_album_vram;
static u16 gp_album_tiles;
static const Image* gp_album_art;
static Sprite* gp_mood_sprite;
static u8  gp_prev_mood;
static const SpriteDefinition* gp_mood_def;
#define GAME_ALBUM_X        29 /* 232px */
#define GAME_ALBUM_Y        2  /* 16px */
#define GAME_INFO_X         22 /* 176px */
#define GAME_INFO_Y         13
#define MOOD_SPRITE_X       184
#define MOOD_SPRITE_Y       128

static u16 getMoodAnimIndex(const SpriteDefinition* def, u8 mood)
{
    if (def == NULL || def->numAnimation == 0) return 0;
    if (mood >= def->numAnimation) return def->numAnimation - 1;
    return mood;
}

/**
 * Draw gameplay scene background and optional album art on BG_A.
 */
static void drawGameplayBg(const Image* bg_img, const Image* album_img)
{
    VDP_drawImageEx(BG_B, bg_img,
                    TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, gp_bg_vram),
                    0, 0, FALSE, TRUE);

    VDP_clearPlane(BG_A, TRUE);
    if (album_img != NULL && gp_album_tiles > 0)
    {
        VDP_drawImageEx(BG_A, album_img,
                        TILE_ATTR_FULL(PAL2, FALSE, FALSE, FALSE, gp_album_vram),
                        GAME_ALBUM_X, GAME_ALBUM_Y, FALSE, TRUE);
    }
}

/**
 * ゲームプレイ中のヘッダーテキスト（ファイル名・難易度）を描画
 */
static void drawGameplayHeaderText(const SongEntry* entry)
{
    const char* diff_names[] = { "EASY", "NORMAL", "HARD" };
    const char* name = "unknown";
    if (entry != NULL && entry->display_name != NULL && entry->display_name[0] != '\0')
        name = entry->display_name;

    /* 楽曲名・難易度は右側情報パネルへ描画 */
    VDP_setTextPalette(PAL0);
    VDP_drawText("                  ", GAME_INFO_X, GAME_INFO_Y);
    draw_sjis_text(BG_A, name,
                   TILE_ATTR_FULL(PAL0, 0, 0, 0, SJIS_VRAM_BASE),
                   GAME_INFO_X, GAME_INFO_Y, FALSE);
    VDP_drawText("                  ", GAME_INFO_X, GAME_INFO_Y + 1);
    VDP_drawText(diff_names[selected_difficulty], GAME_INFO_X, GAME_INFO_Y + 1);
}


int main(bool hardReset)
{
    (void)hardReset;

    /* VDP基本設定 */
    VDP_setScreenWidth320();

    /* サブシステム初期化 */
    SPR_init();
    INPUT_init();
    SOUND_init();
    HIGHSCORE_init();

    /* SGDK標準のシステムパレットを退避(PAL0維持用) */
    PAL_getColors(0, system_palette_pal0, 16);

    /* ジョイパッドコールバック設定 */
    JOY_setEventHandler(joyEventHandler);

    /* システムフォントをグラデーションフォントへ差し替え */
    VDP_loadFontData(tileset_Font_Gradient.tiles, 96, CPU);

    /* 初期値 */
    selected_song = 0;
    selected_difficulty = DIFF_NORMAL;

    /* Logo splash sequence */
    current_state = STATE_LOGO;
    loadBackground(&bg_logo, TILE_USER_INDEX, PAL3);
    fadeInScene();
    {
        u16 logo_wait = 60;
        while (logo_wait > 0)
        {
            logo_wait--;
            SYS_doVBlankProcess();
        }
    }

    fadeOutScene();

    loadBackground(&bg_logo2, TILE_USER_INDEX, PAL3);
    fadeInScene();
    {
        u16 logo_wait = 60;
        while (logo_wait > 0)
        {
            logo_wait--;
            SYS_doVBlankProcess();
        }
    }

    fadeOutScene();

    /* タイトル画面で開始 */
    current_state = STATE_TITLE;
    initTitle();

    fadeInScene();

    /* メインループ */
    while (TRUE)
    {
        switch (current_state)
        {
            case STATE_TITLE:    updateTitle();    break;
            case STATE_SELECT:   updateSelect();   break;
            case STATE_GAMEPLAY: updateGameplay(); break;
            case STATE_RESULT:   updateResult();   break;
        }

        SPR_update();
        SYS_doVBlankProcess();
    }

    return 0;
}


/* ============================================================
 * タイトル画面
 * ============================================================ */

static void initTitle(void)
{
    disableSelectWobble();
    restoreSystemPal0();
    VDP_setHilightShadow(FALSE);
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    SPR_reset();

    /* BG_B にタイトル背景をロード */
    loadBackground(&bg_title, TILE_USER_INDEX, PAL0);

    VDP_setTextPalette(PAL0);
    VDP_drawText("MD RHYTHM GAME", 9, 6);
    VDP_drawText("for Mega Drive", 9, 8);

    char buf[40];
    sprintf(buf, "%u song(s) loaded", song_count);
    VDP_drawText(buf, 9, 12);

    /* 診断: 楽曲数のステータス表示 */
    if (song_count == 0)
    {
        VDP_drawText("WARNING: No songs!", 7, 14);
        VDP_drawText("Export from editor first.", 4, 15);
    }
    else
    {
        /* 確認用: 先頭楽曲のタイトルを表示 */
        const ChartInfo* first = song_database[0].chart;
        if (first != NULL && first->title != NULL)
        {
            sprintf(buf, "[%.28s]", first->title);
            VDP_drawText(buf, 5, 14);
        }
    }

    VDP_drawText("PRESS START", 10, 18);
}

static void updateTitle(void)
{
    /* 入力はjoyEventHandlerで処理 */
}


/* ============================================================
 * 選曲画面
 * ============================================================ */

#define SELECT_LIST_Y       7   /* 56px */
#define SELECT_LIST_X       3   /* 24px */
#define SELECT_LIST_MAX     8   /* wobbleメニュー内に収まる最大行数 */
static u16 select_scroll;       /* 最初に表示する楽曲のインデックス */
static Sprite* select_diff_icon; /* 難易度アイコンスプライト */

static void drawSelectMeta(void)
{
    if (song_count == 0 || selected_song >= song_count) return;

    const SongEntry* entry = &song_database[selected_song];
    const ChartInfo* chart = entry->chart;
    char buf[16];

    /* 楽曲名 — SJIS対応描画 (24,16), max 14 chars */
    VDP_drawText("              ", 24, 16); /* 前回のテキストをクリア */
    draw_sjis_text(BG_A, entry->display_name,
                   TILE_ATTR_FULL(PAL0, 0, 0, 0,
                                  SJIS_VRAM_BASE + SELECT_LIST_MAX * SJIS_TILES_PER_ENTRY),
                   24, 16, FALSE);

    /* BPM (192,144) = tile (24,18) */
    sprintf(buf, " BPM:%-3u      ", chart->bpm);
    VDP_drawText(buf, 24, 18);

    /* HIGH-SCORE label (192,160) = tile (24,20) */
    VDP_drawText("HIGH-SCORE    ", 24, 20);

    /* Score per difficulty — 未プレイは「-」表示 */
    if (HIGHSCORE_hasScore(selected_song, DIFF_EASY))
        sprintf(buf, "EASY   %7lu", (unsigned long)HIGHSCORE_getScore(selected_song, DIFF_EASY));
    else
        sprintf(buf, "EASY        -");
    VDP_drawText(buf, 24, 21);
    if (HIGHSCORE_hasScore(selected_song, DIFF_NORMAL))
        sprintf(buf, "NORMAL %7lu", (unsigned long)HIGHSCORE_getScore(selected_song, DIFF_NORMAL));
    else
        sprintf(buf, "NORMAL      -");
    VDP_drawText(buf, 24, 22);
    if (HIGHSCORE_hasScore(selected_song, DIFF_HARD))
        sprintf(buf, "HARD   %7lu", (unsigned long)HIGHSCORE_getScore(selected_song, DIFF_HARD));
    else
        sprintf(buf, "HARD        -");
    VDP_drawText(buf, 24, 23);
}

static void startPreview(void)
{
    if (song_count > 0 && selected_song < song_count)
    {
        const SongEntry* entry = &song_database[selected_song];
        if (entry->bgm != NULL)
        {
            SOUND_playPreview(entry->bgm, entry->bgm_len);
            preview_song_id = selected_song;
        }
    }
}

static void drawSelectList(void)
{
    VDP_setTextPalette(PAL0);

    for (u16 i = 0; i < SELECT_LIST_MAX; i++)
    {
        u16 tile_y = SELECT_LIST_Y + i;
        u16 si = select_scroll + i;
        if (si < song_count)
        {
            /* カーソルとクリア用スペースをASCIIで描画 */
            char prefix[22];
            sprintf(prefix, "%c                    ", (si == selected_song) ? '>' : ' ');
            VDP_drawText(prefix, SELECT_LIST_X, tile_y);

            /* 楽曲名をSJIS対応描画 */
            const SongEntry* entry = &song_database[si];
            draw_sjis_text(BG_A, entry->display_name,
                           TILE_ATTR_FULL(PAL0, 0, 0, 0,
                                          SJIS_VRAM_BASE + i * SJIS_TILES_PER_ENTRY),
                           SELECT_LIST_X + 1, tile_y, FALSE);
        }
        else
        {
            VDP_drawText("                     ", SELECT_LIST_X, tile_y);
        }
    }

    /* 難易度 */
    const char* diff_names[] = { "EASY  ", "NORMAL", "HARD  " };
    char dbuf[24];
    VDP_drawText("SONG LIST", SELECT_LIST_X, SELECT_LIST_Y - 1);
    sprintf(dbuf, "Diff: %s", diff_names[selected_difficulty]);
    VDP_drawText(dbuf, SELECT_LIST_X, 24);

    VDP_drawText("U/D:Song L/R:Diff ST:Play", 1, 26);

    /* 難易度アイコンスプライトを更新 */
    if (select_diff_icon != NULL)
    {
        SPR_setAnimAndFrame(select_diff_icon, getDiffIconAnimIndex(), 0);
    }

    /* 右サイドメタ情報 */
    drawSelectMeta();
}

static void initSelect(void)
{
    disableSelectWobble();
    restoreSystemPal0();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    SPR_reset();

    VDP_setHilightShadow(TRUE);
    VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);
    setupSelectWobbleBackground();
    setupSelectBackdropSprites();
    memsetU16((u16*)select_line_buffer, FIX16(1.0), 224);
    select_wave = 0;
    select_angle = 0;
    select_diag_scroll_x = 0;
    select_diag_scroll_y = 0;
    select_diag_scroll_x_px = 0;
    select_diag_scroll_y_px = 0;
    VDP_setHorizontalScroll(BG_B, 0);
    enableSelectWobble();

    /* Explicitly load sprite palettes for select scene. */
    PAL_setPalette(PAL2, spr_icon_diff.palette->data, CPU);

    /* 選曲BG_A: アルバムアートとメタ情報を描画 */
    loadSelectBg();

    /* 難易度アイコンスプライトを作成 */
    select_diff_icon = SPR_addSprite(&spr_icon_diff, 128, 188,
                                     TILE_ATTR(PAL2, FALSE, FALSE, FALSE));
    if (select_diff_icon != NULL)
    {
        SPR_setAnimAndFrame(select_diff_icon, getDiffIconAnimIndex(), 0);
        SPR_setVisibility(select_diff_icon, VISIBLE);
    }

    select_scroll = 0;
    if (selected_song >= song_count && song_count > 0)
        selected_song = 0;

    drawSelectList();

    /* プレビュー再生開始 */
    startPreview();
}

static void updateSelect(void)
{
    SOUND_updatePreview();
    updateSelectDiagonalScroll();
    updateSelectWobbleWave();
}


/* ============================================================
 * ゲームプレイ
 * ============================================================ */

static u16 vram_index;

static void initGameplay(void)
{
    disableSelectWobble();
    VDP_setHilightShadow(FALSE);
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    SPR_reset();

    /* 楽曲インデックスの検証 */
    if (selected_song >= song_count)
    {
        char ebuf[36];
        VDP_setTextPalette(PAL0);
        sprintf(ebuf, "ERR: song %u >= %u", selected_song, song_count);
        VDP_drawText(ebuf, 4, 10);
        VDP_drawText("Press START to go back", 4, 14);
        current_state = STATE_RESULT;
        return;
    }

    /* VRAMリソースの確保 */
    vram_index = TILE_USER_INDEX;

    /* 楽曲エントリを先行ロード（楽曲別画像の解決用） */
    const SongEntry* entry = &song_database[selected_song];

    /* Mood sprite sheet (animation type by gameplay mood) */
    gp_album_art = entry->album_art;
    gp_mood_def = entry->mood_sprite;
    gp_mood_sprite = NULL;

    /* gameplay_ui は PAL0 に固定 */
    PAL_setPalette(PAL0, img_gameplay_ui.palette->data, CPU);

    /* ゲーム画面 PAL3 は mood sprite を優先（なければ gameplay_ui にフォールバック） */
    if (gp_mood_def != NULL && gp_mood_def->palette != NULL)
    {
        PAL_setPalette(PAL3, gp_mood_def->palette->data, CPU);
    }
    else
    {
        PAL_setPalette(PAL3, img_gameplay_ui.palette->data, CPU);
    }

    /* ゲームプレイ中アルバムアートは PAL2 を使用 */
    if (gp_album_art != NULL && gp_album_art->palette != NULL)
    {
        PAL_setPalette(PAL2, gp_album_art->palette->data, CPU);
    }

    /* VRAM予約: 背景タイル */
    gp_bg_vram  = vram_index;
    vram_index += img_gameplay_ui.tileset->numTile;
    gp_album_vram = vram_index;
    gp_album_tiles = (gp_album_art != NULL) ? gp_album_art->tileset->numTile : 0;
    vram_index += gp_album_tiles;
    /* Initial draw: gameplay background + album art */
    gp_prev_mood = 1;
    drawGameplayBg(&img_gameplay_ui, gp_album_art);
    if (gp_mood_def != NULL)
    {
        gp_mood_sprite = SPR_addSprite(gp_mood_def, MOOD_SPRITE_X, MOOD_SPRITE_Y,
                                      TILE_ATTR(PAL3, FALSE, FALSE, FALSE));
        if (gp_mood_sprite != NULL)
        {
            SPR_setAnimAndFrame(gp_mood_sprite, getMoodAnimIndex(gp_mood_def, gp_prev_mood), 0);
        }
    }

    /* ゲームサブシステムの初期化 */
    vram_index += GAME_init(vram_index);

    /* スプライトパレットの明示ロード。
     * SGDK の SPRITE_FLAG_AUTO_VDP_PALETTE が SPR_addSprite 時に
     * パレットを自動ロードし NOTE_init 内の設定を上書きする場合があるため、
     * GAME_init 完了後に改めて明示ロードし確実に反映させる。 */
    PAL_setPalette(PAL1, spr_note.palette->data, CPU);    /* ノートスプライト */

    /* NOTE/HUD を画像UIモードに切り替える（GAME_init後に設定する） */
    NOTE_setUseImageUI(TRUE);

    HUD_setUseImageUI(TRUE);

    /* エントリの検証 */
    if (entry->chart == NULL)
    {
        VDP_setTextPalette(PAL0);
        VDP_drawText("ERR: chart ptr is NULL", 4, 10);
        VDP_drawText("Press START to go back", 4, 14);
        current_state = STATE_RESULT;
        return;
    }

    GAME_start(entry->chart, selected_difficulty);

    /* 画面左上テキスト（曲名・難易度） */
    drawGameplayHeaderText(entry);

    /* アクション効果音の設定 (tap, hold, rapid) */
    GAME_setActionSE(
        sfx_se_tap, sizeof(sfx_se_tap),
        NULL, 0,
        NULL, 0);

    /* カウントダウン後にBGMを再生 */
    if (entry->bgm != NULL)
    {
        GAME_setBGM(entry->bgm, entry->bgm_len);
    }
}

static void updateGameplay(void)
{
    /* ポーズメニュー結果を確認 */
    const GameState* gs = GAME_getState();
    if (gs->pause_result == 1) {
        /* リトライ: ゲームを再初期化 */
        fadeOutScene();
        GAME_release();
        initGameplay();
        fadeInScene();
        return;
    } else if (gs->pause_result == 2) {
        /* 選曲に戻る */
        fadeOutScene();
        GAME_release();
        current_state = STATE_SELECT;
        initSelect();
        fadeInScene();
        return;
    }

    /* Mood animation切替（bad/normal/good/excellent） */
    if (gs->playing && gs->mood != gp_prev_mood)
    {
        gp_prev_mood = gs->mood;
        if (gp_mood_sprite != NULL && gp_mood_def != NULL)
        {
            SPR_setAnimAndFrame(gp_mood_sprite, getMoodAnimIndex(gp_mood_def, gp_prev_mood), 0);
        }
    }

    bool running = GAME_update();
    GAME_draw();

    if (!running)
    {
        fadeOutScene();
        GAME_release();
        current_state = STATE_RESULT;
        initResult();
        fadeInScene();
    }
}


/* ============================================================
 * リザルト画面
 * ============================================================ */

static void initResult(void)
{
    disableSelectWobble();
    VDP_setHilightShadow(FALSE);
    const GameState* gs = GAME_getState();

    /* ハイスコア更新 */
    HIGHSCORE_updateScore(selected_song, selected_difficulty, gs->score);

    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    SPR_reset();

    /* BG_B にリザルト背景をロード */
    loadBackground(&bg_result, TILE_USER_INDEX, PAL0);

    VDP_setTextPalette(PAL0);
    VDP_drawText("= RESULT =", 10, 3);

    /* 楽曲名 */
    const ChartInfo* chart = song_database[selected_song].chart;
    VDP_drawText(chart->title, 8, 5);

    char buf[32];
    sprintf(buf, "SCORE: %lu", (unsigned long)gs->score);
    VDP_drawText(buf, 8, 8);

    sprintf(buf, "MAX COMBO: %u", gs->max_combo);
    VDP_drawText(buf, 8, 10);

    sprintf(buf, "PERFECT: %u", gs->judge_counts[JUDGE_PERFECT]);
    VDP_drawText(buf, 8, 13);
    sprintf(buf, "GREAT:   %u", gs->judge_counts[JUDGE_GREAT]);
    VDP_drawText(buf, 8, 14);
    sprintf(buf, "GOOD:    %u", gs->judge_counts[JUDGE_GOOD]);
    VDP_drawText(buf, 8, 15);
    sprintf(buf, "MISS:    %u", gs->judge_counts[JUDGE_MISS]);
    VDP_drawText(buf, 8, 16);

    /* 正確度 */
    u16 total_notes = NOTE_getTotalCount();
    u16 accuracy = 0;
    if (total_notes > 0)
    {
        u32 total_score = (u32)gs->judge_counts[JUDGE_PERFECT] * 100
                        + (u32)gs->judge_counts[JUDGE_GREAT] * 75
                        + (u32)gs->judge_counts[JUDGE_GOOD] * 50;
        accuracy = total_score / total_notes;
    }
    sprintf(buf, "ACCURACY: %u%%", accuracy);
    VDP_drawText(buf, 8, 18);

    /* グレード */
    const char* grade;
    if (accuracy >= 95) grade = "S";
    else if (accuracy >= 90) grade = "A";
    else if (accuracy >= 80) grade = "B";
    else if (accuracy >= 70) grade = "C";
    else grade = "D";
    sprintf(buf, "GRADE: %s", grade);
    VDP_drawText(buf, 8, 20);

    VDP_drawText("START: Song Select", 7, 25);
}

static void updateResult(void)
{
    /* 入力はjoyEventHandlerで処理 */
}


/* ============================================================
 * ジョイパッドイベントハンドラ
 * ============================================================ */

static void joyEventHandler(u16 joy, u16 changed, u16 state)
{
    if (joy != JOY_1) return;

    switch (current_state)
    {
        case STATE_LOGO:
            /* ロゴ表示中は全入力を無視 */
            break;

        case STATE_TITLE:
            if (changed & state & BUTTON_START)
            {
                if (song_count > 0)
                {
                    fadeOutScene();
                    current_state = STATE_SELECT;
                    initSelect();
                    fadeInScene();
                }
            }
            break;

        case STATE_SELECT:
            if (changed & state & BUTTON_START)
            {
                SOUND_stopPreview();
                fadeOutScene();
                current_state = STATE_GAMEPLAY;
                initGameplay();
                fadeInScene();
            }
            else if (changed & state & BUTTON_B)
            {
                SOUND_stopPreview();
                fadeOutScene();
                current_state = STATE_TITLE;
                initTitle();
                fadeInScene();
            }
            else if (changed & state & BUTTON_UP)
            {
                if (selected_song > 0)
                    selected_song--;
                else
                    selected_song = song_count - 1;
                if (selected_song < select_scroll)
                    select_scroll = selected_song;
                if (selected_song >= select_scroll + SELECT_LIST_MAX)
                    select_scroll = (selected_song >= SELECT_LIST_MAX) ? selected_song - SELECT_LIST_MAX + 1 : 0;
                loadSelectBg();
                drawSelectList();
                startPreview();
            }
            else if (changed & state & BUTTON_DOWN)
            {
                if (selected_song < song_count - 1)
                    selected_song++;
                else
                    selected_song = 0;
                if (selected_song >= select_scroll + SELECT_LIST_MAX)
                    select_scroll = selected_song - SELECT_LIST_MAX + 1;
                if (selected_song < select_scroll)
                    select_scroll = 0;
                loadSelectBg();
                drawSelectList();
                startPreview();
            }
            else if (changed & state & BUTTON_LEFT)
            {
                if (selected_difficulty > 0)
                {
                    selected_difficulty--;
                    drawSelectList();
                }
            }
            else if (changed & state & BUTTON_RIGHT)
            {
                if (selected_difficulty < DIFF_COUNT - 1)
                {
                    selected_difficulty++;
                    drawSelectList();
                }
            }
            break;

        case STATE_GAMEPLAY:
            GAME_handleInput(joy, changed, state);
            break;

        case STATE_RESULT:
            if (changed & state & BUTTON_START)
            {
                fadeOutScene();
                current_state = STATE_SELECT;
                initSelect();
                fadeInScene();
            }
            break;
    }
}
