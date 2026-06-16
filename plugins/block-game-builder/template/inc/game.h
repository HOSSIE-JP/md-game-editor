/* ===================================================================
 * GERO Block - ゲーム定義ヘッダー
 * ブロック崩しゲーム (Sega Genesis / Mega Drive)
 * =================================================================== */

#ifndef _GAME_H_
#define _GAME_H_

#include <genesis.h>
#include <kdebug.h>

/* ===================================================================
 * 画面・フィールド定数
 * =================================================================== */

/** 画面サイズ */
#define SCREEN_W            320
#define SCREEN_H            224

/** プレイフィールド（左側ブロックエリア） */
#define PLAY_FIELD_W        240
#define PLAY_FIELD_H        224

/** UIパネル（右側） */
#define UI_PANEL_W          80
#define UI_PANEL_TILE_X     30  /* タイル列30から（ピクセル240から） */

/* ===================================================================
 * ブロックグリッド定数
 * =================================================================== */

#define GRID_COLS           15
#define GRID_ROWS           24

/** ブロックサイズ（ピクセル） */
#define BLOCK_W             16
#define BLOCK_H             8

/** ブロックサイズ（タイル単位） */
#define BLOCK_TILE_W        2
#define BLOCK_TILE_H        1

/** ブロック配置開始位置（タイル行） */
#define BLOCKS_OFFSET_Y     0

/* ===================================================================
 * ブロック種類
 * =================================================================== */

#define BLOCK_EMPTY         0
#define BLOCK_WHITE         1
#define BLOCK_YELLOW        2
#define BLOCK_GREEN         3
#define BLOCK_BLUE          4
#define BLOCK_GRAY          5
#define BLOCK_TYPE_COUNT    6

/* ===================================================================
 * パワーアップ種類
 * =================================================================== */

#define POWERUP_NONE        0
#define POWERUP_MULTI_BALL  1
#define POWERUP_STRONG      2
#define POWERUP_SPEED_UP    3
#define POWERUP_BARRIER     4
#define POWERUP_TYPE_COUNT  5

/* ===================================================================
 * ボール
 * =================================================================== */

#define BALL_SIZE           6
#ifndef BALL_BASE_SPEED
#define BALL_BASE_SPEED     FIX16(2)
#endif
#define MAX_BALLS           3

/* BGMボリューム (0-100, XGM2/VGMモードで有効) */
#ifndef BGM_VOLUME
#define BGM_VOLUME          100
#endif

/* ===================================================================
 * パドル
 * =================================================================== */

#define PADDLE_W            32
#define PADDLE_H            8
#ifndef PADDLE_SPEED
#define PADDLE_SPEED        FIX16(3)
#endif
#define PADDLE_Y_POS        (PLAY_FIELD_H - 16)
#define MAX_PLAYERS         2

/* ===================================================================
 * パワーアップアイテム（落下物）
 * =================================================================== */

#define POWERUP_ITEM_W      16
#define POWERUP_ITEM_H      8
#define POWERUP_FALL_SPEED  FIX16(1)
#define MAX_POWERUP_ITEMS   4

/* ===================================================================
 * VRAM タイルレイアウト
 * =================================================================== */

/** ブロック用タイル: 5種類 × 2タイル = 10タイル */
#define TILE_BLOCK_START    TILE_USER_INDEX
#define TILES_PER_BLOCK     2
#define TILE_BLOCK_COUNT    (5 * TILES_PER_BLOCK)
#define TILE_BLOCK_END      (TILE_BLOCK_START + TILE_BLOCK_COUNT)

/** ボール用タイル: 1タイル */
#define TILE_BALL_IDX       TILE_BLOCK_END

/** パドル用タイル: 4タイル（32px = 4×8px） */
#define TILE_PADDLE_IDX     (TILE_BALL_IDX + 1)
#define TILE_PADDLE_COUNT   4

/** パワーアップ用タイル: 4種類 × 2タイル（16×8 = 2×1） = 8タイル */
#define TILE_POWERUP_IDX    (TILE_PADDLE_IDX + TILE_PADDLE_COUNT)
#define TILES_PER_POWERUP   2
#define TILE_POWERUP_COUNT  (4 * TILES_PER_POWERUP)

/** バリア用タイル: 1タイル */
#define TILE_BARRIER_IDX    (TILE_POWERUP_IDX + TILE_POWERUP_COUNT)

/** UIパネル背景用タイル: 1タイル */
#define TILE_WINDOW_BG_IDX  (TILE_BARRIER_IDX + 1)

/** テキスト暗幕用タイル: 1タイル */
#define TILE_TEXT_SHADOW_IDX (TILE_WINDOW_BG_IDX + 1)
#define TILE_TEXT_SHADOW_COUNT 16

/** 背景画像用タイル開始位置 */
#define TILE_BG_START       (TILE_TEXT_SHADOW_IDX + TILE_TEXT_SHADOW_COUNT)

/* ===================================================================
 * パレット割り当て
 * =================================================================== */

#define PAL_SYSTEM          PAL0
#define PAL_SPRITES         PAL1
#define PAL_BLOCKS          PAL2
#define PAL_BG              PAL3

#define PAL_SYSTEM_WINDOW_BG_COLOR 14

/* ===================================================================
 * ゲーム初期設定
 * =================================================================== */

#ifndef INITIAL_LIVES
#define INITIAL_LIVES       3
#endif

#define STAGE_TIME_SECONDS  180
#define STAGE_BONUS_POINTS_PER_SECOND 1000
#define BLOCK_HIT_SCORE     100
#define BLOCK_BREAK_SCORE   500
#define HIGH_SCORE_COUNT    20

#ifndef SCREEN_WAIT_LOGO_SCREEN_1_SECONDS
#define SCREEN_WAIT_LOGO_SCREEN_1_SECONDS 0
#endif
#ifndef SCREEN_WAIT_LOGO_SCREEN_2_SECONDS
#define SCREEN_WAIT_LOGO_SCREEN_2_SECONDS 0
#endif
#ifndef SCREEN_WAIT_TITLE_SCREEN_SECONDS
#define SCREEN_WAIT_TITLE_SCREEN_SECONDS 0
#endif
#ifndef SCREEN_WAIT_HIGH_SCORE_SCREEN_SECONDS
#define SCREEN_WAIT_HIGH_SCORE_SCREEN_SECONDS 0
#endif
#ifndef SCREEN_WAIT_GAME_OVER_SCREEN_SECONDS
#define SCREEN_WAIT_GAME_OVER_SCREEN_SECONDS 0
#endif
#ifndef SCREEN_WAIT_GAME_CLEAR_SCREEN_SECONDS
#define SCREEN_WAIT_GAME_CLEAR_SCREEN_SECONDS 0
#endif

#ifndef TEXT_PANEL_USE_HILIGHT_SHADOW
#define TEXT_PANEL_USE_HILIGHT_SHADOW 1
#endif

/* ===================================================================
 * ハードウェアスプライトインデックス
 * =================================================================== */

#define SPR_BALL_START      0
#define SPR_PADDLE_START    (SPR_BALL_START + MAX_BALLS)
#define SPR_POWERUP_START   (SPR_PADDLE_START + MAX_PLAYERS)
#define SPR_BARRIER         (SPR_POWERUP_START + MAX_POWERUP_ITEMS)
#define SPR_GAME_TOTAL      (SPR_BARRIER + 1)
#define SPR_TEXT_PANEL_COUNT 48
#define SPR_TOTAL           ((SPR_GAME_TOTAL > SPR_TEXT_PANEL_COUNT) ? SPR_GAME_TOTAL : SPR_TEXT_PANEL_COUNT)

/* ===================================================================
 * ゲーム状態
 * =================================================================== */

typedef enum {
    STATE_LOGO1,
    STATE_LOGO2,
    STATE_TITLE,
    STATE_HIGHSCORE,
    STATE_NAME_ENTRY,
    STATE_SERVE,
    STATE_PLAYING,
    STATE_PAUSE,
    STATE_STAGE_CLEAR,
    STATE_GAME_OVER,
    STATE_GAME_CLEAR
} GameState;

/* ===================================================================
 * データ構造体
 * =================================================================== */

/** ボール */
typedef struct {
    fix16 x;
    fix16 y;
    fix16 vx;
    fix16 vy;
    bool active;
} Ball;

/** パドル */
typedef struct {
    fix16 x;
    s16 y;
    bool active;
} Paddle;

/** パワーアップ落下アイテム */
typedef struct {
    fix16 x;
    fix16 y;
    u8 type;
    bool active;
} PowerUpItem;

/** パワーアップ状態（現在有効な効果） */
typedef struct {
    bool barrier;
    u16 barrier_timer;
    bool strong;
    u16 strong_timer;
    bool speed_up;
    u16 speed_up_timer;
} PowerUpState;

/** ステージ情報 */
typedef struct {
    const u8 (*blocks)[GRID_COLS];
    const u8 (*powerups)[GRID_COLS];
    const u8 *bgm;
    u32 bgm_len;
    bool bgm_half_rate;
    const Image *background_image; /* ステージ背景画像（NULLの場合は単色背景） */
    const Image *clear_image;  /* ステージクリア画像（NULLの場合はテキストのみ） */
} StageInfo;

/* ===================================================================
 * グローバル変数（extern宣言）
 * =================================================================== */

extern GameState game_state;
extern u8 current_stage;
extern u32 score;
extern u16 stage_time_frames;
extern u8 lives;
extern u8 num_players;
extern bool barrier_visible;
extern bool serve_ball_visible;

extern Ball balls[MAX_BALLS];
extern Paddle paddles[MAX_PLAYERS];

/** ランタイムブロック状態（残り耐久値 / 0=消滅済み） */
extern u8 block_hp[GRID_ROWS][GRID_COLS];
/** 各ブロックのパワーアップ種類 */
extern u8 block_powerup[GRID_ROWS][GRID_COLS];

extern PowerUpItem powerup_items[MAX_POWERUP_ITEMS];
extern PowerUpState powerup_state;

/* ===================================================================
 * ブロック種類別 耐久値テーブル
 * -1 = 破壊不可
 * =================================================================== */

static const s8 block_base_hp[BLOCK_TYPE_COUNT] = {
    0,      /* EMPTY */
    1,      /* WHITE */
    1,      /* YELLOW */
    2,      /* GREEN */
    3,      /* BLUE */
    -1      /* GRAY（破壊不可） */
};

/* ===================================================================
 * 各モジュール 関数宣言
 * =================================================================== */

/* --- player.c --- */
void playerInit(void);
void playerUpdate(u16 joy1, u16 joy2);
void playerDraw(void);

/* --- ball.c --- */
void ballInit(void);
void ballServe(u8 paddle_idx);
void ballUpdate(void);
void ballDraw(void);
void ballFollowPaddle(u8 paddle_idx);
u8 ballActiveCount(void);

/* --- block.c --- */
void blockInit(void);
void blockLoadStage(u8 stage_idx);
void blockDrawAll(void);
bool blockCheckClear(void);
void blockHit(u8 row, u8 col, u8 damage);

/* --- powerup.c --- */
void powerupInit(void);
void powerupSpawn(u8 row, u8 col, u8 type);
void powerupUpdate(void);
void powerupDraw(void);
void powerupActivate(u8 type);
void powerupClearItems(void);
void powerupReset(void);

/* --- ui.c --- */
void uiInit(void);
void uiUpdate(void);
void uiDrawTitle(void);
void uiSetTitlePrompt(bool visible);
void uiSetPaused(bool visible);
void uiDrawHighScore(void);
void uiDrawHighScoreOverlay(void);
void uiDrawNameEntry(u8 rank, const char *name, u8 cursor);
void uiUpdateNameEntry(u8 rank, const char *name, u8 cursor);
void uiDrawGameOver(void);
void uiDrawGameClear(void);
void uiDrawStageClearPreview(const Image *clear_image, const Image *background_image);
void uiSetStageClearPrompt(bool visible);
void uiDrawStageClearScore(u16 time_seconds, u32 bonus_score);
void uiUpdateStageClearBonus(u16 time_seconds, u32 bonus_score);
void uiEnableGamePanel(void);
void uiDisableGamePanel(void);
void uiClearScreen(void);

/* --- score.c --- */
void scoreInit(void);
s8 scoreSubmit(u32 value, u8 reached_stage);
void scoreSetHighScoreName(u8 rank, const char *name);
const char *scoreGetHighScoreName(u8 rank);
u32 scoreGetHighScore(u8 rank);
u8 scoreGetHighScoreStage(u8 rank);
u32 scoreGetTopScore(void);

/* --- gfx.c --- */
void gfxInit(void);
void gfxLoadBlockTiles(void);
void gfxLoadSpriteTiles(void);
void gfxLoadPalettes(void);
void gfxLoadSystemPalette(void);
void gfxDrawBackground(const Image *background_image);

/* --- snd.c --- */
void sndInit(void);
void sndPlayBGM(const u8 *bgm, u32 len, bool half_rate);
void sndStopBGM(void);
void sndSetBGMVolume(u8 volume);
void sndPlaySE(u8 se_id);
u16 sndPlaySEAndWaitFrames(u8 se_id, u16 fallback_frames);

/* SE ID 定数（snd.c 内のルックアップテーブルインデックス） */
#define SND_SE_BALL_HIT_PADDLE  1
#define SND_SE_BALL_HIT_WALL    2
#define SND_SE_BLOCK_BREAK      3
#define SND_SE_BLOCK_HIT        4
#define SND_SE_POWERUP_APPEAR   5
#define SND_SE_POWERUP_GET      6
#define SND_SE_BALL_LOSE        7
#define SND_SE_GAME_OVER        8
#define SND_SE_STAGE_CLEAR      9
#define SND_SE_GAME_START       10
#define SND_SE_PAUSE            11
#define SND_SE_BONUS_COUNT      12

#endif /* _GAME_H_ */
