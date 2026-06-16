/* ===================================================================
 * GERO Block - UI描画
 * Windowプレーンを使ったスコア・ライフ表示、
 * タイトル画面・ゲームオーバー画面
 * =================================================================== */

#include "game.h"

/* 文字列バッファ */
static char str_buf[24];

#define UI_TEXT_X (UI_PANEL_TILE_X + 1)
#define UI_VALUE_CLEAR "        "
#define TEXT_PANEL_TILE_ATTR TILE_ATTR_FULL(PAL_BG, FALSE, FALSE, FALSE, TILE_TEXT_SHADOW_IDX)
#define STAGE_CLEAR_LABEL_X 13
#define STAGE_CLEAR_VALUE_X 20
#define STAGE_CLEAR_VALUE_CLEAR "       "
#define NAME_ENTRY_PANEL_X 13
#define NAME_ENTRY_PANEL_W 15

static bool panel_dirty = TRUE;
static u32 last_hi_score = 0xFFFFFFFF;
static u32 last_score = 0xFFFFFFFF;
static u8 last_lives = 0xFF;
static u8 last_stage = 0xFF;
static u16 last_time_seconds = 0xFFFF;
static bool last_strong = TRUE;
static bool last_speed_up = TRUE;
static bool last_barrier = TRUE;

/* ===================================================================
 * 内部ヘルパー
 * =================================================================== */

/** Windowプレーン上のテキスト描画 (X座標はタイル単位)
 *  CPU転送を使用（XGMドライバ併用時のDMA_QUEUEタイミング問題を回避） */
static void drawWindowText(const char *text, u16 tile_x, u16 tile_y)
{
    VDP_drawTextEx(WINDOW, text, TILE_ATTR(PAL_SYSTEM, TRUE, FALSE, FALSE), tile_x, tile_y, CPU);
}

static void fillGamePanelBackground(void)
{
    const u16 tile = TILE_ATTR_FULL(PAL_SYSTEM, TRUE, FALSE, FALSE, TILE_WINDOW_BG_IDX);
    VDP_fillTileMapRect(
        WINDOW,
        tile,
        UI_PANEL_TILE_X,
        0,
        UI_PANEL_W / 8,
        SCREEN_H / 8
    );
}

static void invalidateGamePanel(void)
{
    panel_dirty = TRUE;
    last_hi_score = 0xFFFFFFFF;
    last_score = 0xFFFFFFFF;
    last_lives = 0xFF;
    last_stage = 0xFF;
    last_time_seconds = 0xFFFF;
    last_strong = TRUE;
    last_speed_up = TRUE;
    last_barrier = TRUE;
}

static void clearWindowLine(u16 y)
{
    drawWindowText(UI_VALUE_CLEAR, UI_TEXT_X, y);
}

/** BG_A上のテキスト描画 */
static void drawBgText(const char *text, u16 tile_x, u16 tile_y)
{
    VDP_drawTextEx(BG_A, text, TILE_ATTR(PAL_SYSTEM, TRUE, FALSE, FALSE), tile_x, tile_y, CPU);
}

static void hideAllSprites(void)
{
    for (u8 i = 0; i < SPR_TOTAL; i++)
    {
        VDP_setSpriteFull(i, -128, -128, SPRITE_SIZE(1, 1), 0, (i < SPR_TOTAL - 1) ? i + 1 : 0);
    }
    VDP_updateSprites(SPR_TOTAL, DMA_QUEUE);
    VDP_setHilightShadow(FALSE);
}

static void drawTextPanelShadow(s16 x, s16 y, u8 cols, u8 rows)
{
    u8 index = 0;
    u8 total = cols * rows;
    if (total > SPR_TEXT_PANEL_COUNT) total = SPR_TEXT_PANEL_COUNT;

    hideAllSprites();
#if TEXT_PANEL_USE_HILIGHT_SHADOW
    VDP_setHilightShadow(TRUE);
#else
    VDP_setHilightShadow(FALSE);
#endif

    for (u8 row = 0; row < rows; row++)
    {
        for (u8 col = 0; col < cols; col++)
        {
            if (index >= SPR_TEXT_PANEL_COUNT) break;
            VDP_setSpriteFull(
                index,
                x + (col * 32),
                y + (row * 32),
                SPRITE_SIZE(4, 4),
                TEXT_PANEL_TILE_ATTR,
                (index < total - 1) ? index + 1 : 0
            );
            index++;
        }
    }

    VDP_updateSprites(SPR_TEXT_PANEL_COUNT, DMA_QUEUE);
}

/* ===================================================================
 * パブリック関数
 * =================================================================== */

/** UI初期化 */
void uiInit(void)
{
    VDP_setTextPalette(PAL_SYSTEM);
}

/** ゲーム中UIパネルを有効化（Window表示） */
void uiEnableGamePanel(void)
{
    /* 右80ピクセル(5×16px列)をWindowプレーンとして使用
     * VDP_setWindowOnRight は 2タイル単位(16px)で列数指定
     * UI_PANEL_W(80) / 16 = 5列 → 右10タイル(80px)がWindow表示 */
    VDP_setWindowOnRight(UI_PANEL_W / 16);
    fillGamePanelBackground();
    invalidateGamePanel();
}

/** UIパネルを無効化（タイトル画面等で全画面使用） */
void uiDisableGamePanel(void)
{
    /* FALSE = 左側、0列 = Windowなし（全画面BGプレーンを使用） */
    VDP_setWindowHPos(FALSE, 0);
}

/** 画面クリア */
void uiClearScreen(void)
{
    hideAllSprites();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_clearPlane(WINDOW, TRUE);
    invalidateGamePanel();
}

/** ゲーム中UI更新 */
void uiUpdate(void)
{
    u32 top_score = scoreGetTopScore();
    u16 time_seconds = stage_time_frames / 60;
    if (score > top_score) top_score = score;

    if (panel_dirty)
    {
        fillGamePanelBackground();
        drawWindowText("HI", UI_TEXT_X, 0);
        drawWindowText("SCORE", UI_TEXT_X, 3);
        drawWindowText("LIFE", UI_TEXT_X, 7);
        drawWindowText("STAGE", UI_TEXT_X, 11);
        drawWindowText("TIME", UI_TEXT_X, 14);
        drawWindowText("POWER", UI_TEXT_X, 18);
        panel_dirty = FALSE;
    }
    if (game_state == STATE_PAUSE)
    {
        drawWindowText("PAUSED", UI_TEXT_X, 24);
    }

    if (last_hi_score != top_score)
    {
        clearWindowLine(1);
        uintToStr(top_score, str_buf, 7);
        drawWindowText(str_buf, UI_TEXT_X, 1);
        last_hi_score = top_score;
    }

    if (last_score != score)
    {
        clearWindowLine(4);
        uintToStr(score, str_buf, 7);
        drawWindowText(str_buf, UI_TEXT_X, 4);
        last_score = score;
    }

    if (last_lives != lives)
    {
        clearWindowLine(8);
        intToStr(lives, str_buf, 1);
        drawWindowText(str_buf, UI_TEXT_X, 8);
        last_lives = lives;
    }

    if (last_stage != current_stage)
    {
        clearWindowLine(12);
        intToStr(current_stage + 1, str_buf, 2);
        drawWindowText(str_buf, UI_TEXT_X, 12);
        last_stage = current_stage;
    }

    if (last_time_seconds != time_seconds)
    {
        clearWindowLine(15);
        uintToStr(time_seconds, str_buf, 3);
        drawWindowText(str_buf, UI_TEXT_X, 15);
        last_time_seconds = time_seconds;
    }

    if (last_strong != powerup_state.strong || last_speed_up != powerup_state.speed_up || last_barrier != powerup_state.barrier)
    {
        for (u16 y = 19; y < 23; y++) clearWindowLine(y);
        u16 status_y = 19;
        if (powerup_state.strong)
        {
            drawWindowText("STR", UI_TEXT_X, status_y);
            status_y++;
        }
        if (powerup_state.speed_up)
        {
            drawWindowText("SPD", UI_TEXT_X, status_y);
            status_y++;
        }
        if (powerup_state.barrier)
        {
            drawWindowText("BAR", UI_TEXT_X, status_y);
        }
        last_strong = powerup_state.strong;
        last_speed_up = powerup_state.speed_up;
        last_barrier = powerup_state.barrier;
    }
}

void uiSetPaused(bool visible)
{
    clearWindowLine(24);
    if (visible)
    {
        drawWindowText("PAUSED", UI_TEXT_X, 24);
    }
}

/** タイトル画面描画 */
void uiDrawTitle(void)
{
    uiClearScreen();
    uiDisableGamePanel();

    drawBgText("GERO BLOCK", 15, 6);
    drawBgText("BLOCK BREAKER", 13, 8);

    uiSetTitlePrompt(TRUE);

    hideAllSprites();
}

void uiSetTitlePrompt(bool visible)
{
    VDP_fillTileMapRect(BG_A, 0, 14, 24, 12, 1);
    if (visible)
    {
        drawBgText("PRESS START", 14, 24);
    }
}

/** ハイスコア画面描画 */
void uiDrawHighScore(void)
{
    uiClearScreen();
    uiDisableGamePanel();
    hideAllSprites();
    uiDrawHighScoreOverlay();
}

void uiDrawHighScoreOverlay(void)
{
    drawTextPanelShadow(64, 8, 6, 6);
    drawBgText("HIGH SCORE", 14, 2);
    drawBgText("RK NAM SCORE   ST", 10, 4);
    for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
    {
        u8 reached_stage = scoreGetHighScoreStage(i);
        sprintf(str_buf, "%02d %s ", i + 1, scoreGetHighScoreName(i));
        uintToStr(scoreGetHighScore(i), str_buf + 7, 7);
        if (reached_stage)
            sprintf(str_buf + 14, " ST%02d", reached_stage);
        else
            sprintf(str_buf + 14, " ST--");
        drawBgText(str_buf, (SCREEN_W / 8 - strlen(str_buf)) / 2, 5 + i);
    }
}

void uiDrawNameEntry(u8 rank, const char *name, u8 cursor)
{
    uiDrawHighScoreOverlay();
    drawBgText("NAME ENTRY", 15, 25);
    uiUpdateNameEntry(rank, name, cursor);
}

void uiUpdateNameEntry(u8 rank, const char *name, u8 cursor)
{
    u16 y = 5 + rank;
    if (rank >= HIGH_SCORE_COUNT) return;

    u8 reached_stage = scoreGetHighScoreStage(rank);
    sprintf(str_buf, "%02d %s ", rank + 1, name);
    uintToStr(scoreGetHighScore(rank), str_buf + 7, 7);
    if (reached_stage)
        sprintf(str_buf + 14, " ST%02d", reached_stage);
    else
        sprintf(str_buf + 14, " ST--");

    drawBgText(str_buf, (SCREEN_W / 8 - strlen(str_buf)) / 2, y);
    VDP_fillTileMapRect(BG_A, 0, NAME_ENTRY_PANEL_X, 26, NAME_ENTRY_PANEL_W, 2);
    drawBgText("               ", NAME_ENTRY_PANEL_X, 26);
    drawBgText("               ", NAME_ENTRY_PANEL_X, 27);
    sprintf(str_buf, "   %c %c %c", name[0], name[1], name[2]);
    drawBgText(str_buf, 15, 26);
    drawBgText("^", 18 + cursor * 2, 27);
}

/** ゲームオーバー画面描画 */
void uiDrawGameOver(void)
{
    uiClearScreen();
    uiDisableGamePanel();
    hideAllSprites();
    drawBgText("GAME OVER", 11, 12);
    uintToStr(score, str_buf, 7);
    drawBgText("SCORE:", 12, 14);
    drawBgText(str_buf, 18, 14);
    drawBgText("PRESS START", 10, 18);
}

/** ゲームクリア画面描画 */
void uiDrawGameClear(void)
{
    uiClearScreen();
    uiDisableGamePanel();
    hideAllSprites();
    drawBgText("GAME CLEAR!", 10, 12);
    uintToStr(score, str_buf, 7);
    drawBgText("SCORE:", 12, 14);
    drawBgText(str_buf, 18, 14);
    drawBgText("PRESS START", 10, 18);
}

/** ステージクリア画面描画
 *  clear_image が指定されている場合は BG_B に画像を表示 */
void uiDrawStageClearPreview(const Image *clear_image, const Image *background_image)
{
    uiDisableGamePanel();
    VDP_clearPlane(BG_A, TRUE);
    hideAllSprites();
    const Image *display_image = clear_image ? clear_image : background_image;
    if (display_image)
    {
        /* クリア画像をBG_Bに描画（背景を上書き） */
        VDP_drawImageEx(
            BG_B, display_image,
            TILE_ATTR_FULL(PAL_BG, FALSE, FALSE, FALSE, TILE_BG_START),
            0, 0, TRUE, DMA
        );
        /* 画像描画後にゲーム用パレットを再設定 */
        gfxLoadPalettes();
    }

    uiSetStageClearPrompt(TRUE);
}

void uiSetStageClearPrompt(bool visible)
{
    VDP_fillTileMapRect(BG_A, 0, 0, 24, SCREEN_W / 8, 1);
    if (visible)
    {
        drawBgText("STAGE CLEAR!", 14, 24);
    }
}

void uiDrawStageClearScore(u16 time_seconds, u32 bonus_score)
{
    VDP_clearPlane(BG_A, TRUE);
    drawTextPanelShadow(80, 88, 5, 3);
    drawBgText("STAGE CLEAR!", 14, 12);
    uintToStr(score, str_buf, 7);
    drawBgText("SCORE:", STAGE_CLEAR_LABEL_X, 14);
    drawBgText(str_buf, STAGE_CLEAR_VALUE_X, 14);
    uiUpdateStageClearBonus(time_seconds, bonus_score);
}

void uiUpdateStageClearBonus(u16 time_seconds, u32 bonus_score)
{
    uintToStr(time_seconds, str_buf, 7);
    drawBgText(" TIME:", STAGE_CLEAR_LABEL_X, 15);
    drawBgText(STAGE_CLEAR_VALUE_CLEAR, STAGE_CLEAR_VALUE_X, 15);
    drawBgText(str_buf, STAGE_CLEAR_VALUE_X, 15);

    uintToStr(bonus_score, str_buf, 7);
    drawBgText("BONUS:", STAGE_CLEAR_LABEL_X, 16);
    drawBgText(STAGE_CLEAR_VALUE_CLEAR, STAGE_CLEAR_VALUE_X, 16);
    drawBgText(str_buf, STAGE_CLEAR_VALUE_X, 16);

    uintToStr(score, str_buf, 7);
    drawBgText(STAGE_CLEAR_VALUE_CLEAR, STAGE_CLEAR_VALUE_X, 14);
    drawBgText(str_buf, STAGE_CLEAR_VALUE_X, 14);
}
