/* ===================================================================
 * GERO Block - メインエントリポイント
 * ゲームループとステートマシン
 *
 * BGプレーン構成:
 *   BG_B (低優先度) : 背景ご褒美画像（ブロック破壊で露出）
 *   BG_A (高優先度) : ブロックタイル
 *   WINDOW          : 右80pxのUIパネル（スコア、残機等）
 *   スプライト      : ボール、パドル、パワーアップアイテム
 * =================================================================== */

#include "game.h"
#include "game_resources.h"
#include "stages.h"

/* ===================================================================
 * デバッグ出力マクロ
 * KDebug_Alert はエミュレータのデバッグコンソールに出力される
 * =================================================================== */

#ifdef DEBUG
#define DBG_MSG(msg) KDebug_Alert(msg)
#else
#define DBG_MSG(msg) KDebug_Alert(msg)
#endif

/** 起動時の画面表示用デバッグメッセージ */
static void bootMessage(const char *msg)
{
    KDebug_Alert(msg);
}

/* ===================================================================
 * グローバル変数定義
 * =================================================================== */

GameState game_state;
u8 current_stage;
u32 score;
u16 stage_time_frames;
u8 lives;
u8 num_players;
bool barrier_visible;
bool serve_ball_visible;

static u16 prev_joy1;
static u16 prev_joy2;
static u16 screen_timer;
static u16 input_lock_timer;
static u16 transition_palette[64];
static u16 white_palette[64];
static u16 stage_bonus_seconds_remaining;
static u32 stage_bonus_awarded;
static u16 stage_clear_timer;
static u8 stage_clear_phase;
static bool stage_clear_prompt_visible;
static u16 title_prompt_timer;
static bool title_prompt_visible;
static bool score_recorded;
static bool stage_bgm_pending;
static s8 submitted_score_rank;
static s8 name_entry_rank;
static u8 name_entry_cursor;
static char name_entry_name[4];

#define FRAMES_PER_SECOND 60
#define FADE_FRAMES 16
#define STAGE_CLEAR_WHITE_FADE_FRAMES ((3 * FRAMES_PER_SECOND) / 4)
#define PRE_STAGE_WAIT_FRAMES (1 * FRAMES_PER_SECOND)
#define MISS_WAIT_FRAMES (1 * FRAMES_PER_SECOND)
#define STAGE_TIME_FRAMES (STAGE_TIME_SECONDS * FRAMES_PER_SECOND)
#define STAGE_CLEAR_PHASE_PROMPT 0
#define STAGE_CLEAR_PHASE_BONUS  1
#define STAGE_CLEAR_PHASE_WAIT   2
#define STAGE_CLEAR_PROMPT_BLINK_FRAMES 30
#define STAGE_CLEAR_NEXT_WAIT_FRAMES (3 * FRAMES_PER_SECOND)
#define TITLE_PROMPT_BLINK_FRAMES 30

/** ボタンが今フレーム押されたか（エッジ検出） */
static bool buttonPressed(u16 current, u16 previous, u16 button)
{
    return (current & button) && !(previous & button);
}

static u16 secondsToFrames(u16 seconds)
{
    return seconds * FRAMES_PER_SECOND;
}

static void fadeOutToBlack(void)
{
    PAL_fadeOutAll(FADE_FRAMES, FALSE);
}

static void fadeInCurrent(void)
{
    gfxLoadSystemPalette();
    PAL_getColors(0, transition_palette, 64);
    PAL_setColors(0, palette_black, 64, CPU);
    PAL_fadeInAll(transition_palette, FADE_FRAMES, FALSE);
}

static void fillWhitePalette(void)
{
    for (u16 index = 0; index < 64; index++)
    {
        white_palette[index] = 0x0EEE;
    }
}

static void fadeOutToWhite(void)
{
    fillWhitePalette();
    PAL_getColors(0, transition_palette, 64);
    PAL_fadeAll(transition_palette, white_palette, STAGE_CLEAR_WHITE_FADE_FRAMES, FALSE);
}

static void fadeInCurrentFromWhite(void)
{
    gfxLoadSystemPalette();
    PAL_getColors(0, transition_palette, 64);
    fillWhitePalette();
    PAL_setColors(0, white_palette, 64, CPU);
    PAL_fadeInAll(transition_palette, STAGE_CLEAR_WHITE_FADE_FRAMES, FALSE);
}

static void hideGameSprites(void)
{
    for (u8 i = 0; i < SPR_TOTAL; i++)
    {
        VDP_setSpriteFull(i, -128, -128, SPRITE_SIZE(1, 1), 0, (i < SPR_TOTAL - 1) ? i + 1 : 0);
    }
    VDP_updateSprites(SPR_TOTAL, DMA_QUEUE);
    VDP_setHilightShadow(FALSE);
}

static void drawSystemImage(const Image *image)
{
    uiClearScreen();
    uiDisableGamePanel();
    hideGameSprites();
    if (image)
    {
        VDP_drawImageEx(
            BG_B, image,
            TILE_ATTR_FULL(PAL_BG, FALSE, FALSE, FALSE, TILE_BG_START),
            0, 0, TRUE, DMA
        );
    }
}

static void drawSystemImageOrFallback(const Image *image, void (*fallback)(void))
{
    fadeOutToBlack();
    gfxLoadSystemPalette();
    if (image)
        drawSystemImage(image);
    else
        fallback();
    fadeInCurrent();
}

static void drawSystemImageOrFallbackFromWhite(const Image *image, void (*fallback)(void))
{
    fadeOutToWhite();
    if (image)
        drawSystemImage(image);
    else
        fallback();
    fadeInCurrentFromWhite();
}

static void drawTitleScreenContent(const Image *image)
{
    fadeOutToBlack();
    gfxLoadSystemPalette();
    if (image)
    {
        drawSystemImage(image);
        uiSetTitlePrompt(TRUE);
    }
    else
    {
        uiDrawTitle();
    }
    fadeInCurrent();
    title_prompt_visible = TRUE;
    title_prompt_timer = TITLE_PROMPT_BLINK_FRAMES;
}

static bool hasStart(u16 joy1)
{
    return buttonPressed(joy1, prev_joy1, BUTTON_START);
}

static bool hasActionButton(u16 joy1)
{
    const u16 buttons = BUTTON_A | BUTTON_B | BUTTON_C | BUTTON_START;
    return (joy1 & buttons) && !(prev_joy1 & buttons);
}

static bool tickScreenTimer(void)
{
    if (screen_timer == 0) return FALSE;
    screen_timer--;
    return screen_timer == 0;
}

static void resetStageTimer(void)
{
    stage_time_frames = STAGE_TIME_FRAMES;
}

static void tickStageTimer(void)
{
    if (stage_time_frames > 0) stage_time_frames--;
}

static u16 stageTimeSeconds(void)
{
    return stage_time_frames / FRAMES_PER_SECOND;
}

static s8 submitScoreOnce(void)
{
    if (score_recorded) return submitted_score_rank;
    submitted_score_rank = scoreSubmit(score, current_stage >= STAGE_COUNT ? STAGE_COUNT : current_stage + 1);
    score_recorded = TRUE;
    return submitted_score_rank;
}

static void playTitleBGM(void)
{
#ifdef RES_BGM_TITLE_SCREEN
    sndPlayBGM(RES_BGM_TITLE_SCREEN, sizeof(RES_BGM_TITLE_SCREEN), RES_BGM_TITLE_SCREEN_HALF_RATE);
#else
    sndStopBGM();
#endif
}

static void playHighScoreBGM(void)
{
#ifdef RES_BGM_HIGH_SCORE_SCREEN
    sndPlayBGM(RES_BGM_HIGH_SCORE_SCREEN, sizeof(RES_BGM_HIGH_SCORE_SCREEN), RES_BGM_HIGH_SCORE_SCREEN_HALF_RATE);
#else
    sndStopBGM();
#endif
}

static void playGameClearBGM(void)
{
#ifdef RES_BGM_GAME_CLEAR_SCREEN
    sndPlayBGM(RES_BGM_GAME_CLEAR_SCREEN, sizeof(RES_BGM_GAME_CLEAR_SCREEN), RES_BGM_GAME_CLEAR_SCREEN_HALF_RATE);
#else
    sndStopBGM();
#endif
}

static void playCurrentStageBGM(void)
{
    const StageInfo *stage = &stage_table[current_stage];

    if (stage->bgm && stage->bgm_len > 0)
        sndPlayBGM(stage->bgm, stage->bgm_len, stage->bgm_half_rate);
    else
        sndStopBGM();
}

static void showLogo1(void);
static void showLogo2(void);
static void showTitleScreen(void);
static void showHighScoreScreen(void);
static void showGameOverScreen(void);
static void showGameClearScreen(void);
static void showNameEntryScreen(s8 rank);

static void showAttractStart(void)
{
#ifdef RES_IMG_LOGO_SCREEN_1
    showLogo1();
#elif defined(RES_IMG_LOGO_SCREEN_2)
    showLogo2();
#else
    showTitleScreen();
#endif
}

static void showLogo1(void)
{
#ifdef RES_IMG_LOGO_SCREEN_1
    drawSystemImageOrFallback(&RES_IMG_LOGO_SCREEN_1, uiDrawTitle);
    screen_timer = secondsToFrames(SCREEN_WAIT_LOGO_SCREEN_1_SECONDS);
    game_state = STATE_LOGO1;
#else
    showLogo2();
#endif
}

static void showLogo2(void)
{
#ifdef RES_IMG_LOGO_SCREEN_2
    drawSystemImageOrFallback(&RES_IMG_LOGO_SCREEN_2, uiDrawTitle);
    screen_timer = secondsToFrames(SCREEN_WAIT_LOGO_SCREEN_2_SECONDS);
    game_state = STATE_LOGO2;
#else
    showTitleScreen();
#endif
}

static void showTitleScreen(void)
{
#ifdef RES_IMG_TITLE_SCREEN
    drawTitleScreenContent(&RES_IMG_TITLE_SCREEN);
#else
    drawTitleScreenContent(NULL);
#endif
    screen_timer = secondsToFrames(SCREEN_WAIT_TITLE_SCREEN_SECONDS);
    game_state = STATE_TITLE;
    playTitleBGM();
}

static void showHighScoreScreen(void)
{
#ifdef RES_IMG_HIGH_SCORE_SCREEN
    fadeOutToBlack();
    drawSystemImage(&RES_IMG_HIGH_SCORE_SCREEN);
    uiDrawHighScoreOverlay();
    fadeInCurrent();
    screen_timer = secondsToFrames(SCREEN_WAIT_HIGH_SCORE_SCREEN_SECONDS);
    game_state = STATE_HIGHSCORE;
    playHighScoreBGM();
#else
    showLogo1();
#endif
}

static void showNameEntryScreen(s8 rank)
{
    if (rank < 0 || rank >= HIGH_SCORE_COUNT)
    {
        showAttractStart();
        return;
    }

    name_entry_rank = rank;
    name_entry_cursor = 0;
    name_entry_name[0] = 'A';
    name_entry_name[1] = 'A';
    name_entry_name[2] = 'A';
    name_entry_name[3] = '\0';

#ifdef RES_IMG_HIGH_SCORE_SCREEN
    fadeOutToBlack();
    drawSystemImage(&RES_IMG_HIGH_SCORE_SCREEN);
    uiDrawNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
    fadeInCurrent();
#else
    uiDrawHighScore();
    uiDrawNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
#endif
    screen_timer = 0;
    game_state = STATE_NAME_ENTRY;
    playHighScoreBGM();
}

static void showGameOverScreen(void)
{
    submitScoreOnce();
#ifdef RES_IMG_GAME_OVER_SCREEN
    drawSystemImageOrFallbackFromWhite(&RES_IMG_GAME_OVER_SCREEN, uiDrawGameOver);
#else
    drawSystemImageOrFallbackFromWhite(NULL, uiDrawGameOver);
#endif
    screen_timer = secondsToFrames(SCREEN_WAIT_GAME_OVER_SCREEN_SECONDS);
    game_state = STATE_GAME_OVER;
    sndPlaySE(SND_SE_GAME_OVER);
}

static void showGameClearScreen(void)
{
    submitScoreOnce();
#ifdef RES_IMG_GAME_CLEAR_SCREEN
    drawSystemImageOrFallback(&RES_IMG_GAME_CLEAR_SCREEN, uiDrawGameClear);
#else
    drawSystemImageOrFallback(NULL, uiDrawGameClear);
#endif
    screen_timer = secondsToFrames(SCREEN_WAIT_GAME_CLEAR_SCREEN_SECONDS);
    game_state = STATE_GAME_CLEAR;
    playGameClearBGM();
}

static void beginStageServe(void)
{
    game_state = STATE_SERVE;
    sndStopBGM();
    input_lock_timer = sndPlaySEAndWaitFrames(SND_SE_GAME_START, PRE_STAGE_WAIT_FRAMES);
    stage_bgm_pending = TRUE;
}

/* ===================================================================
 * ゲームステート遷移
 * =================================================================== */

/** ゲーム初期化（新規ゲーム開始） */
static void startNewGame(void)
{
    DBG_MSG("GERO Block: Starting new game");
    current_stage = 0;
    score = 0;
    score_recorded = FALSE;
    submitted_score_rank = -1;
    lives = INITIAL_LIVES;

    playerInit();
    ballInit();
    serve_ball_visible = TRUE;
    blockInit();
    powerupInit();

    /* ステージロード */
    fadeOutToBlack();
    blockLoadStage(current_stage);
    resetStageTimer();
    DBG_MSG("GERO Block: Stage 1 loaded");

    /* 画面セットアップ */
    uiClearScreen();
    gfxDrawBackground(stage_table[current_stage].background_image);
    uiEnableGamePanel();
    blockDrawAll();
    fadeInCurrent();

    beginStageServe();
    DBG_MSG("GERO Block: STATE_SERVE");
}

/** 次のステージへ進む */
static void advanceStage(void)
{
    current_stage++;

    if (current_stage >= STAGE_COUNT)
    {
        /* 全ステージクリア */
        DBG_MSG("GERO Block: All stages cleared!");
        sndStopBGM();
        showGameClearScreen();
        return;
    }

    DBG_MSG("GERO Block: Advancing to next stage");
    hideGameSprites();
    fadeOutToBlack();
    playerInit();
    ballInit();
    serve_ball_visible = TRUE;
    powerupClearItems();
    blockLoadStage(current_stage);
    resetStageTimer();

    uiClearScreen();
    gfxDrawBackground(stage_table[current_stage].background_image);
    uiEnableGamePanel();
    blockDrawAll();
    fadeInCurrent();

    beginStageServe();
}

/** ミス処理 */
static void loseLife(void)
{
    lives--;
    if (lives == 0)
    {
        game_state = STATE_GAME_OVER;
        sndStopBGM();
        showGameOverScreen();
    }
    else
    {
        /* リセットして再サーブ */
        powerupReset();
        serve_ball_visible = FALSE;
        game_state = STATE_SERVE;
        input_lock_timer = MISS_WAIT_FRAMES;
        sndPlaySE(SND_SE_BALL_LOSE);
    }
}

/* ===================================================================
 * メインループ内のステート処理
 * =================================================================== */

static void handleTitle(u16 joy1, u16 joy2)
{
    if (hasStart(joy1))
    {
        if (num_players == 0)
            num_players = 1;
        startNewGame();
        return;
    }
    if (tickScreenTimer())
    {
        showHighScoreScreen();
        return;
    }

    if (title_prompt_timer > 0) title_prompt_timer--;
    if (title_prompt_timer == 0)
    {
        title_prompt_visible = !title_prompt_visible;
        uiSetTitlePrompt(title_prompt_visible);
        title_prompt_timer = TITLE_PROMPT_BLINK_FRAMES;
    }

    /* Cボタンが押されたら2P */
    if (buttonPressed(joy1, prev_joy1, BUTTON_C) ||
        buttonPressed(joy2, prev_joy2, BUTTON_C))
    {
        num_players = 2;
    }

}

static void handleServe(u16 joy1, u16 joy2)
{
    if (input_lock_timer > 0)
    {
        input_lock_timer--;
        if (input_lock_timer == 0 && !serve_ball_visible)
        {
            ballInit();
            ballFollowPaddle(0);
            serve_ball_visible = TRUE;
        }
        return;
    }

    if (stage_bgm_pending)
    {
        stage_bgm_pending = FALSE;
        playCurrentStageBGM();
    }

    tickStageTimer();
    playerUpdate(joy1, joy2);
    ballFollowPaddle(0);

    /* A / B / C でサーブ */
    if (buttonPressed(joy1, prev_joy1, BUTTON_A) ||
        buttonPressed(joy1, prev_joy1, BUTTON_B) ||
        buttonPressed(joy1, prev_joy1, BUTTON_C))
    {
        ballServe(0);
        game_state = STATE_PLAYING;
    }
}

static void handlePlaying(u16 joy1, u16 joy2)
{
    tickStageTimer();
    playerUpdate(joy1, joy2);
    ballUpdate();
    powerupUpdate();

    /* 全ボール消滅チェック */
    if (ballActiveCount() == 0)
    {
        loseLife();
        return;
    }

    /* ステージクリアチェック */
    if (blockCheckClear())
    {
        u16 bonus_seconds = stageTimeSeconds();
        game_state = STATE_STAGE_CLEAR;
        stage_bonus_seconds_remaining = bonus_seconds;
        stage_bonus_awarded = 0;
        stage_clear_phase = STAGE_CLEAR_PHASE_PROMPT;
        stage_clear_timer = STAGE_CLEAR_PROMPT_BLINK_FRAMES;
        stage_clear_prompt_visible = TRUE;
        sndStopBGM();
        fadeOutToWhite();
        uiDrawStageClearPreview(stage_table[current_stage].clear_image, stage_table[current_stage].background_image);
        fadeInCurrentFromWhite();
        sndPlaySE(SND_SE_STAGE_CLEAR);
    }

    /* ポーズ */
    if (buttonPressed(joy1, prev_joy1, BUTTON_START))
    {
        game_state = STATE_PAUSE;
        uiSetPaused(TRUE);
        sndPlaySE(SND_SE_PAUSE);
    }
}

static void handlePause(u16 joy1)
{
    /* STARTで復帰 */
    if (buttonPressed(joy1, prev_joy1, BUTTON_START))
    {
        game_state = STATE_PLAYING;
        uiSetPaused(FALSE);
    }
}

static void handleStageClear(u16 joy1)
{
    if (stage_clear_phase == STAGE_CLEAR_PHASE_PROMPT)
    {
        if (hasActionButton(joy1))
        {
            stage_clear_phase = STAGE_CLEAR_PHASE_BONUS;
            stage_clear_prompt_visible = FALSE;
            uiSetStageClearPrompt(FALSE);
            uiDrawStageClearScore(stage_bonus_seconds_remaining, 0);
        }
        else
        {
            if (stage_clear_timer > 0) stage_clear_timer--;
            if (stage_clear_timer == 0)
            {
                stage_clear_prompt_visible = !stage_clear_prompt_visible;
                uiSetStageClearPrompt(stage_clear_prompt_visible);
                stage_clear_timer = STAGE_CLEAR_PROMPT_BLINK_FRAMES;
            }
        }
        return;
    }
    if (stage_clear_phase == STAGE_CLEAR_PHASE_BONUS)
    {
        if (stage_bonus_seconds_remaining > 0)
        {
            score += STAGE_BONUS_POINTS_PER_SECOND;
            stage_bonus_awarded += STAGE_BONUS_POINTS_PER_SECOND;
            stage_bonus_seconds_remaining--;
            sndPlaySE(SND_SE_BONUS_COUNT);
            uiUpdateStageClearBonus(stage_bonus_seconds_remaining, stage_bonus_awarded);
        }
        else
        {
            stage_clear_phase = STAGE_CLEAR_PHASE_WAIT;
            stage_clear_timer = STAGE_CLEAR_NEXT_WAIT_FRAMES;
        }
        return;
    }
    if (stage_clear_timer > 0 && !hasActionButton(joy1))
    {
        stage_clear_timer--;
        return;
    }
    advanceStage();
}

static void handleGameOver(u16 joy1)
{
    if (screen_timer > 0)
    {
        screen_timer--;
        return;
    }
    if (hasStart(joy1))
    {
        num_players = 0;
        sndStopBGM();
        if (submitted_score_rank >= 0)
            showNameEntryScreen(submitted_score_rank);
        else
            showAttractStart();
    }
}

static void handleLogo1(u16 joy1)
{
    if (hasStart(joy1))
        showTitleScreen();
    else if (tickScreenTimer())
        showLogo2();
}

static void handleLogo2(u16 joy1)
{
    if (hasStart(joy1) || tickScreenTimer())
        showTitleScreen();
}

static void handleHighScore(u16 joy1)
{
    if (hasStart(joy1))
        showTitleScreen();
    else if (tickScreenTimer())
        showLogo1();
}

static void finishNameEntry(void)
{
    if (name_entry_rank >= 0)
    {
        scoreSetHighScoreName((u8)name_entry_rank, name_entry_name);
    }
    name_entry_rank = -1;
    sndStopBGM();
    showLogo1();
}

static void handleNameEntry(u16 joy1)
{
    if (buttonPressed(joy1, prev_joy1, BUTTON_UP))
    {
        name_entry_name[name_entry_cursor] = (name_entry_name[name_entry_cursor] == 'Z')
            ? 'A'
            : name_entry_name[name_entry_cursor] + 1;
        uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
    }
    else if (buttonPressed(joy1, prev_joy1, BUTTON_DOWN))
    {
        name_entry_name[name_entry_cursor] = (name_entry_name[name_entry_cursor] == 'A')
            ? 'Z'
            : name_entry_name[name_entry_cursor] - 1;
        uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
    }

    if (buttonPressed(joy1, prev_joy1, BUTTON_LEFT))
    {
        if (name_entry_cursor > 0) name_entry_cursor--;
        uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
    }
    else if (buttonPressed(joy1, prev_joy1, BUTTON_RIGHT))
    {
        if (name_entry_cursor < 2) name_entry_cursor++;
        uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
    }

    if (buttonPressed(joy1, prev_joy1, BUTTON_A) || buttonPressed(joy1, prev_joy1, BUTTON_C))
    {
        if (name_entry_cursor < 2)
        {
            name_entry_cursor++;
            uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
        }
        else
        {
            finishNameEntry();
        }
    }
    else if (buttonPressed(joy1, prev_joy1, BUTTON_B))
    {
        if (name_entry_cursor > 0)
        {
            name_entry_cursor--;
            uiUpdateNameEntry((u8)name_entry_rank, name_entry_name, name_entry_cursor);
        }
    }
    else if (hasStart(joy1))
    {
        finishNameEntry();
    }
}

static void handleGameClear(u16 joy1)
{
    if (screen_timer > 0)
    {
        screen_timer--;
        return;
    }
    if (hasStart(joy1))
    {
        if (submitted_score_rank >= 0)
            showNameEntryScreen(submitted_score_rank);
        else
            showAttractStart();
    }
}

/* ===================================================================
 * メインエントリポイント
 * =================================================================== */

int main(bool hard_reset)
{
    /* --- 起動ログ --- */
    bootMessage("GERO Block: Starting...");

    /* --- VDP初期化 --- */
    VDP_setScreenWidth320();
    bootMessage("GERO Block: VDP initialized (320 mode)");

    /* --- グラフィック初期化 --- */
    gfxInit();
    bootMessage("GERO Block: GFX initialized (palettes + tiles)");

    /* --- サウンド初期化 --- */
    sndInit();
    bootMessage("GERO Block: Sound initialized");

    /* --- UI初期化 --- */
    uiInit();
    bootMessage("GERO Block: UI initialized");

    /* --- ステージデータ検証 --- */
    if (STAGE_COUNT == 0)
    {
        bootMessage("GERO Block ERROR: STAGE_COUNT is 0!");
        VDP_drawText("ERROR: NO STAGES", 7, 10);
        VDP_drawText("Export stages from", 6, 12);
        VDP_drawText("the editor first.", 6, 13);
        while (TRUE) { SYS_doVBlankProcess(); }
    }

    {
        /* 各ステージテーブルのポインタ検証 */
        char stage_buf[32];
        for (u8 i = 0; i < STAGE_COUNT && i < 10; i++)
        {
            if (stage_table[i].blocks == NULL)
            {
                sprintf(stage_buf, "ERR: Stage %d blocks=NULL", i + 1);
                bootMessage(stage_buf);
                VDP_drawText(stage_buf, 2, 10 + i);
            }
        }
        sprintf(stage_buf, "GERO Block: %d stages loaded", STAGE_COUNT);
        bootMessage(stage_buf);
    }

    /* --- 変数初期化 --- */
    game_state = STATE_TITLE;
    current_stage = 0;
    score = 0;
    stage_time_frames = STAGE_TIME_FRAMES;
    lives = INITIAL_LIVES;
    num_players = 0;
    barrier_visible = FALSE;
    serve_ball_visible = TRUE;
    prev_joy1 = 0;
    prev_joy2 = 0;
    stage_bonus_seconds_remaining = 0;
    stage_bonus_awarded = 0;
    stage_clear_timer = 0;
    stage_clear_phase = STAGE_CLEAR_PHASE_PROMPT;
    stage_clear_prompt_visible = TRUE;
    title_prompt_timer = 0;
    title_prompt_visible = TRUE;
    score_recorded = FALSE;
    stage_bgm_pending = FALSE;
    submitted_score_rank = -1;
    name_entry_rank = -1;
    name_entry_cursor = 0;
    name_entry_name[0] = 'A';
    name_entry_name[1] = 'A';
    name_entry_name[2] = 'A';
    name_entry_name[3] = '\0';
    scoreInit();
    bootMessage("GERO Block: Variables initialized");

    /* --- 初期画面 --- */
    showAttractStart();
    bootMessage("GERO Block: Attract screen drawn, entering main loop");

    /* ===================================================================
     * メインゲームループ
     * =================================================================== */
    while (TRUE)
    {
        /* 入力読み取り */
        u16 joy1 = JOY_readJoypad(JOY_1);
        u16 joy2 = JOY_readJoypad(JOY_2);

        /* ステート処理 */
        switch (game_state)
        {
            case STATE_LOGO1:
                handleLogo1(joy1);
                break;

            case STATE_LOGO2:
                handleLogo2(joy1);
                break;

            case STATE_TITLE:
                handleTitle(joy1, joy2);
                break;

            case STATE_HIGHSCORE:
                handleHighScore(joy1);
                break;

            case STATE_NAME_ENTRY:
                handleNameEntry(joy1);
                break;

            case STATE_SERVE:
                handleServe(joy1, joy2);
                break;

            case STATE_PLAYING:
                handlePlaying(joy1, joy2);
                break;

            case STATE_PAUSE:
                handlePause(joy1);
                break;

            case STATE_STAGE_CLEAR:
                handleStageClear(joy1);
                break;

            case STATE_GAME_OVER:
                handleGameOver(joy1);
                break;

            case STATE_GAME_CLEAR:
                handleGameClear(joy1);
                break;
        }

        /* スプライト描画（プレイ中のみ） */
        if (game_state == STATE_SERVE || game_state == STATE_PLAYING || game_state == STATE_PAUSE)
        {
            playerDraw();
            ballDraw();
            powerupDraw();
            uiUpdate();

            /* スプライトチェーン終端 */
            VDP_updateSprites(SPR_TOTAL, DMA_QUEUE);
        }

        /* 前フレーム入力保存 */
        prev_joy1 = joy1;
        prev_joy2 = joy2;

        /* VBlank同期 */
        SYS_doVBlankProcess();
    }

    return 0;
}
