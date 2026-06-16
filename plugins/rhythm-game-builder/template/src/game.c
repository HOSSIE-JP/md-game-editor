/**
 * @file game.c
 * @brief ゲームプレイシーン管理モジュール
 *
 * NOTE（ノート表示・判定）、HUD（スコア・コンボ表示）、
 * INPUT（コントローラ入力）、SOUND（BGM・SE再生）の
 * 各サブシステムを統括し、ゲームプレイ全体の進行を制御する。
 *
 * 主な管理対象:
 *   - スコア   : 判定結果に応じた加算
 *   - コンボ   : 連続成功回数の追跡
 *   - 正確度   : 各判定の重み付き平均（百分率）
 *   - ムード   : 正確度に基づくパフォーマンス段階（Bad/Normal/Good/Excellent）
 *
 * ゲームフロー:
 *   GAME_init() → GAME_start() → [GAME_update() + GAME_draw() 毎フレーム]
 *   → 譜面完了 → GAME_release()
 */

/* ============================================================
 * インクルード
 * ============================================================ */
#include "game.h" /* 本モジュールの公開API・GameState構造体 */

#include <genesis.h> /* SGDK メインヘッダ */

#include "game_def.h"  /* ゲーム全体の定数定義 */
#include "hud.h"	   /* HUD（ヘッドアップディスプレイ）サブシステム */
#include "input.h"	   /* 入力処理サブシステム */
#include "note.h"	   /* ノート管理サブシステム */
#include "rhythm.h" /* rhythm builder generated resources */
#include "rhythm_resources.h"
#include "sound.h"	   /* サウンド管理サブシステム */

/* ============================================================
 * 内部ゲーム状態
 * ============================================================ */

/** ゲームプレイ中の全状態を保持する構造体インスタンス */
static GameState game_state;

/* ============================================================
 * 正確度計算用
 * ============================================================ */

/** 正確度の分子（各判定の重み累計: PERFECT=100, GREAT=75, GOOD=50, MISS=0） */
static u32 accuracy_numerator;

/* ============================================================
 * HOLDノート追跡（レーンごと）
 * ============================================================ */

/** 各レーンでHOLDが進行中かどうか */
static bool lane_holding[LANE_COUNT];
/** 各レーンのHOLD終了フレーム番号 */
static u16 lane_hold_end_frame[LANE_COUNT];

/* ============================================================
 * RAPIDノート追跡（レーンごと）
 * ============================================================ */

/** 各レーンでRAPID（連打）が進行中かどうか */
static bool lane_rapid[LANE_COUNT];
/** 各レーンのRAPID終了フレーム番号 */
static u16 lane_rapid_end_frame[LANE_COUNT];
/** 各レーンで最後にRAPIDヒットが発生したフレーム番号 */
static u16 lane_rapid_last_hit_frame[LANE_COUNT];
/** RAPID連打の最小入力間隔（フレーム数）。これより短い間隔の入力は無視される */
#define RAPID_HIT_INTERVAL 4 /* min frames between rapid hits */

/* ============================================================
 * カウントダウン制御
 * ============================================================ */

/** ゲーム開始前のカウントダウン時間（60fps × 2秒 = 120フレーム） */
#define COUNTDOWN_FRAMES 120 /* 2 seconds at 60fps */
/** カウントダウン残りフレーム数 */
static u16 countdown;

/* ============================================================
 * 譜面終了後の待機制御
 * ============================================================ */

/** 譜面終了後、リザルト画面に遷移するまでの待機フレーム数 */
#define END_WAIT_FRAMES 120
/** 終了待機の残りフレーム数 */
static u16 end_wait;

/* ============================================================
 * 判定SE（効果音）データポインタ
 * GAME_setJudgeSE() で設定される
 * ============================================================ */

/** PERFECT判定時のSEデータ */
static const u8* se_perfect_data;
/** PERFECT判定SEのデータ長（バイト） */
static u32 se_perfect_len;
/** GREAT判定時のSEデータ */
static const u8* se_great_data;
/** GREAT判定SEのデータ長（バイト） */
static u32 se_great_len;
/** GOOD判定時のSEデータ */
static const u8* se_good_data;
/** GOOD判定SEのデータ長（バイト） */
static u32 se_good_len;
/** MISS判定時のSEデータ */
static const u8* se_miss_data;
/** MISS判定SEのデータ長（バイト） */
static u32 se_miss_len;

/* ============================================================
 * BGMデータ
 * GAME_setBGM() で設定され、カウントダウン完了後に再生される
 * ============================================================ */

/** BGM音声データへのポインタ */
static const u8* bgm_data;
/** BGMデータのバイト長 */
static u32 bgm_len;

/* ============================================================
 * アクションSE（操作音）データポインタ
 * GAME_setActionSE() で設定される
 * ============================================================ */

/** タップ（ボタン押下）時のSEデータ */
static const u8* se_tap_data;
/** タップSEのデータ長（バイト） */
static u32 se_tap_len;
/** HOLD継続中のSEデータ（一定間隔で鳴らす） */
static const u8* se_hold_data;
/** HOLD SEのデータ長（バイト） */
static u32 se_hold_len;
/** RAPID連打時のSEデータ */
static const u8* se_rapid_data;
/** RAPID SEのデータ長（バイト） */
static u32 se_rapid_len;

/* ============================================================
 * ポーズメニュー
 * ============================================================ */

/** ポーズメニューの選択中項目 (0=Resume, 1=Retry, 2=Quit) */
static u8 pause_menu_cursor;
/** ポーズメニュー項目数 */
#define PAUSE_MENU_COUNT 3
#define PAUSE_TEXT_X 15
#define PAUSE_TEXT_Y 10
#define PAUSE_TEXT_W 20

/* ============================================================
 * 内部関数の前方宣言
 * ============================================================ */

/** 判定結果をスコア・コンボ・SE・ゲージに反映する */
static void applyJudgment(u8 result);
/** 正確度に基づいてムード値を更新する */
static void updateMood(void);
/** 現在の正確度（0?100%）を計算して返す */
static u8 calcAccuracy(void);

/* ============================================================
 * 公開API実装
 * ============================================================ */

/**
 * GAME_init - ゲームプレイシーンの初期化
 *
 * 処理の流れ:
 *   1. NOTE・HUDサブシステムを初期化し、使用VRAMタイル数を累算
 *   2. GameState構造体をゼロクリアし、ムードをNormalに設定
 *   3. HOLD/RAPID追跡配列をリセット
 *   4. カウントダウン・終了待機・各種SE・BGMポインタを初期化
 *
 * @param vram_index VRAMタイルの開始インデックス
 * @return 使用したVRAMタイル数の合計
 */
u16 GAME_init(u16 vram_index) {
	u16 tiles_used = 0; /* 使用済みVRAMタイル数の累計 */

	/* サブシステム初期化: NOTEとHUDを順にVRAMに配置 */
	tiles_used += NOTE_init(vram_index);
	tiles_used += HUD_init(vram_index + tiles_used);

	/* ゲーム状態を全てゼロにリセットし、ムードをNormal(1)に設定 */
	memset(&game_state, 0, sizeof(GameState));
	game_state.mood = 1; /* Normal */

	/* 正確度分子をリセット */
	accuracy_numerator = 0;

	/* 全レーンのHOLD/RAPID追跡を初期化 */
	for (u8 i = 0; i < LANE_COUNT; i++) {
		lane_holding[i] = FALSE;
		lane_rapid[i] = FALSE;
	}

	/* カウントダウン・終了待機フレームを初期値に設定 */
	countdown = COUNTDOWN_FRAMES;
	end_wait = END_WAIT_FRAMES;

	/* 判定SEポインタを全てNULLにリセット */
	se_perfect_data = NULL;
	se_perfect_len = 0;
	se_great_data = NULL;
	se_great_len = 0;
	se_good_data = NULL;
	se_good_len = 0;
	se_miss_data = NULL;
	se_miss_len = 0;

	/* BGMデータポインタをリセット */
	bgm_data = NULL;
	bgm_len = 0;

	/* アクションSEポインタを全てNULLにリセット */
	se_tap_data = NULL;
	se_tap_len = 0;
	se_hold_data = NULL;
	se_hold_len = 0;
	se_rapid_data = NULL;
	se_rapid_len = 0;

	/* ポーズメニュー初期化 */
	pause_menu_cursor = 0;

	return tiles_used;
}

/**
 * GAME_start - 指定譜面でゲームを開始する
 *
 * 処理の流れ:
 *   1. 譜面データの妥当性を検証（NULLチェック、難易度範囲、ノート配列）
 *   2. GameStateに難易度とプレイフラグを設定
 *   3. NOTEサブシステムに譜面をロード
 *   4. HUDを有効化し、「READY?」メッセージを表示
 *   5. カウントダウンを開始
 *
 * @param chart 譜面データへのポインタ（ChartInfo構造体）
 * @param difficulty 難易度 (DIFF_EASY=0, DIFF_NORMAL=1, DIFF_HARD=2)
 */
void GAME_start(const ChartInfo* chart, u8 difficulty) {
	/* バリデーション: 譜面データがNULLの場合はエラー表示して中止 */
	if (chart == NULL) {
		// VDP_setTextPalette(PAL0);
		VDP_drawText("ERROR: chart is NULL!", 5, 10);
		VDP_drawText("Check song_data export.", 4, 12);
		game_state.playing = FALSE;
		return;
	}

	/* バリデーション: 難易度が範囲外の場合はエラー表示して中止 */
	if (difficulty >= DIFF_COUNT) {
		char dbuf[36];
		// VDP_setTextPalette(PAL0);
		sprintf(dbuf, "ERROR: bad diff=%u", difficulty);
		VDP_drawText(dbuf, 5, 10);
		game_state.playing = FALSE;
		return;
	}

	/* バリデーション: 指定難易度のノート配列がNULLの場合はエラー表示して中止 */
	if (chart->notes[difficulty] == NULL) {
		// VDP_setTextPalette(PAL0);
		VDP_drawText("ERROR: notes array NULL!", 4, 10);
		char dbuf[36];
		sprintf(dbuf, "diff=%u count=%u", difficulty, chart->note_count[difficulty]);
		VDP_drawText(dbuf, 4, 12);
		game_state.playing = FALSE;
		return;
	}

	/* 警告: ノート数が0の場合は警告表示（続行はする） */
	if (chart->note_count[difficulty] == 0) {
		// VDP_setTextPalette(PAL0);
		VDP_drawText("WARN: 0 notes in chart", 5, 10);
	}

	/* ゲーム状態に難易度とプレイフラグを設定 */
	game_state.difficulty = difficulty;
	game_state.playing = TRUE;
	game_state.complete = FALSE;
	game_state.paused = FALSE;
	game_state.pause_result = 0;
	game_state.current_frame = 0;
	game_state.gauge = GAUGE_MAX / 2; /* ゲージは50%から開始 */

	/* NOTEサブシステムに譜面データをロード */
	NOTE_loadChart(chart, difficulty);

	/* HUDを有効化し、初期状態で表示 */
	HUD_setVisibility(TRUE);
	HUD_update(0, 0, 100);

	/* カウントダウンを開始 */
	countdown = COUNTDOWN_FRAMES;
}

/**
 * GAME_update - ゲームプレイの1フレーム更新
 *
 * 毎フレーム呼び出され、以下を順に実行する:
 *   1. カウントダウンフェーズの処理（「GO!」表示、BGM開始）
 *   2. NOTEサブシステムの更新（ノート移動）
 *   3. ミスノートの検出と判定適用
 *   4. HOLDノートの継続追跡（スコア加算・途中離し検出）
 *   5. RAPIDノートの終了チェック
 *   6. ヒットエフェクトタイマー更新
 *   7. HOLD継続中のSE再生（16フレーム毎）
 *   8. HUD表示更新（スコア・コンボ・正確度）
 *   9. ムード更新
 *  10. 譜面完了チェックと終了処理
 *
 * @return TRUE=ゲーム続行中, FALSE=ゲーム完了
 */
bool GAME_update(void) {
	/* ゲームがプレイ中でなければ即座にFALSEを返す */
	if (!game_state.playing) return FALSE;

	/* --- ポーズ中は処理をスキップ --- */
	if (game_state.paused) return TRUE;

	/* --- カウントダウンフェーズ --- */
	if (countdown > 0) {
		countdown--;
		/* カウントダウン完了: BGM再生開始 */
		if (countdown == 0) {
			if (bgm_data != NULL) SOUND_playBGM(bgm_data, bgm_len);
			/* BGM開始タイミングでPAL1が壊れるケースへの保険: 直後に再ロード */
			PAL_setPalette(PAL1, spr_note.palette->data, CPU);
		}
		return TRUE;
	}

	/* --- ノートシステム更新: ノートの移動・表示を進行 --- */
	NOTE_update(game_state.current_frame);

	/* --- ミスノート検出: 判定ウィンドウを過ぎたノートをミスとして判定 --- */
	u16 miss_count = NOTE_checkMisses(game_state.current_frame);
	for (u16 m = 0; m < miss_count; m++) {
		applyJudgment(JUDGE_MISS);
	}

	/* --- HOLD/RAPIDノートの継続追跡 --- */
	u8 lane_state = INPUT_getLaneState(); /* 現在のレーン押下状態を取得 */
	for (u8 lane = 0; lane < LANE_COUNT; lane++) {
		/* HOLDノートの追跡処理 */
		if (lane_holding[lane]) {
			if (game_state.current_frame >= lane_hold_end_frame[lane]) {
				/* HOLD完了: 終了フレームに到達 */
				lane_holding[lane] = FALSE;
			} else if (lane_state & (1 << lane)) {
				/* まだ押し続けている: ティックスコアを加算 */
				game_state.score += SCORE_HOLD_TICK;
			} else {
				/* 途中で離した: HOLDを終了 */
				lane_holding[lane] = FALSE;
			}
		}

		/* RAPIDノートの終了チェック */
		if (lane_rapid[lane]) {
			if (game_state.current_frame >= lane_rapid_end_frame[lane]) {
				lane_rapid[lane] = FALSE;
			}
		}
	}

	/* --- ゲージ更新 --- */
	HUD_updateGauge(game_state.gauge);

	/* --- HOLD継続中のSE再生（16フレーム毎に1回鳴らす） --- */
	if (se_hold_data != NULL) {
		for (u8 lane = 0; lane < LANE_COUNT; lane++) {
			/* HOLD中かつボタンが押されているレーンを探す */
			if (lane_holding[lane] && (lane_state & (1 << lane)) && (game_state.current_frame & 0x0F) == 0) {
				SOUND_playSE(se_hold_data, se_hold_len, SOUND_PCM_CH3);
				break; /* 同時に鳴らすSEは1つまで */
			}
		}
	}

	/* --- HUD表示の更新: スコア・コンボ・正確度を反映 --- */
	u8 accuracy = calcAccuracy();
	HUD_update(game_state.score, game_state.combo, accuracy);
	HUD_animate();

	/* --- ムードの更新: 正確度に応じてムード段階を変更 --- */
	updateMood();

	/* --- 譜面完了チェック --- */
	if (NOTE_isChartComplete()) {
		/* 終了待機フレームをカウントダウン */
		end_wait--;
		if (end_wait == 0) {
			/* 待機完了: ゲームを停止して完了フラグを立てる */
			game_state.playing = FALSE;
			game_state.complete = TRUE;
			HUD_setVisibility(FALSE);
			SOUND_stopBGM();
			return FALSE;
		}
	}

	/* 現在フレームを進めて続行 */
	game_state.current_frame++;
	return TRUE;
}

/**
 * GAME_draw - ゲームプレイの描画処理
 *
 * NOTE_draw() を呼び出し、ノートスプライトとBG要素を描画する。
 * 毎フレーム、GAME_update() の後に呼ばれる。
 */
void GAME_draw(void) { NOTE_draw(); }

/**
 * GAME_handleInput - コントローラ入力の処理
 *
 * ボタンが新たに押されたときに以下を実行:
 *   1. 各ノートボタン（上下左右ABC）の押下をチェック
 *   2. タップSEを再生
 *   3. RAPID進行中のレーンなら連打ヒットを処理
 *   4. 通常ノートの判定を実行し、結果を適用
 *   5. HOLD/RAPIDパターンのノートなら追跡を開始
 *   6. STARTボタンでポーズ（未実装）
 *
 * @param joy ジョイパッド番号（通常JOY_1）
 * @param changed 変化したボタンのビットマスク
 * @param state 現在のボタン押下状態のビットマスク
 */
void GAME_handleInput(u16 joy, u16 changed, u16 state) {
	/* ポーズ中はポーズメニューの入力のみ処理 */
	if (game_state.paused) {
		u8 result = GAME_handlePauseInput(changed, state);
		if (result > 0) game_state.pause_result = result;
		return;
	}

	/* プレイ中でない、またはカウントダウン中は入力を無視 */
	if (!game_state.playing || countdown > 0) return;

	/* 新たに押されたボタンを検出（changed & state = 今フレームで押された） */
	u16 newly_pressed = changed & state;

	/* ノート入力に使用するボタン一覧（7ボタン: 左上／下右ABC） */
	static const u16 note_buttons[] = {BUTTON_LEFT, BUTTON_UP, BUTTON_DOWN, BUTTON_RIGHT, BUTTON_A, BUTTON_B, BUTTON_C};

	/* 各ノートボタンを順にチェック */
	for (u8 i = 0; i < 7; i++) {
		/* このボタンが押されていなければスキップ */
		if (!(newly_pressed & note_buttons[i])) continue;

		/* ボタンをレーン番号に変換（-1なら対応なし） */
		s8 lane = INPUT_buttonToLane(note_buttons[i]);
		if (lane < 0) continue;

		/* ボタン押下時にタップSEを再生 */
		if (se_tap_data != NULL) SOUND_playSE(se_tap_data, se_tap_len, SOUND_PCM_CH3);

		/* --- RAPIDノート進行中のレーンでの連打ヒット処理 --- */
		if (lane_rapid[(u8)lane]) {
			/* 最小入力間隔を満たしているかチェック */
			if (game_state.current_frame >= lane_rapid_last_hit_frame[(u8)lane] + RAPID_HIT_INTERVAL) {
				/* RAPIDヒット成功: スコア加算・コンボ継続 */
				game_state.score += SCORE_RAPID_HIT;
				game_state.combo++;
				if (game_state.combo > game_state.max_combo) game_state.max_combo = game_state.combo;
				lane_rapid_last_hit_frame[(u8)lane] = game_state.current_frame;
				HUD_showJudgment(JUDGE_PERFECT);
				/* RAPID用SEを再生 */
				if (se_rapid_data != NULL) SOUND_playSE(se_rapid_data, se_rapid_len, SOUND_PCM_CH3);
			}
			continue; /* RAPID進行中は通常判定をスキップ */
		}

		/* --- 通常ノートの判定処理 --- */
		s8 result = NOTE_judge((u8)lane, game_state.current_frame);

		if (result >= 0) {
			/* 判定結果をスコア・コンボ・SE・エフェクトに反映 */
			applyJudgment((u8)result);

			/* 判定したノートのパターンと持続時間を取得 */
			u8 pattern = NOTE_getLastJudgedPattern();
			u16 duration = NOTE_getLastJudgedDuration();

			/* HOLDパターンの場合: レーンのHOLD追跡を開始 */
			if (pattern == PATTERN_HOLD && duration > 0) {
				lane_holding[(u8)lane] = TRUE;
				lane_hold_end_frame[(u8)lane] = game_state.current_frame + duration;
			}
			/* RAPIDパターンの場合: レーンのRAPID追跡を開始 */
			else if (pattern == PATTERN_RAPID && duration > 0) {
				lane_rapid[(u8)lane] = TRUE;
				lane_rapid_end_frame[(u8)lane] = game_state.current_frame + duration;
				lane_rapid_last_hit_frame[(u8)lane] = game_state.current_frame;
			}
		}
	}

	/* STARTボタンでポーズトグル */
	if (newly_pressed & BUTTON_START) {
		GAME_togglePause();
	}
}

/* ============================================================
 * ポーズ機能
 * ============================================================ */

/** ポーズメニューを描画 */
static void drawPauseMenu(void) {
	const char* items[] = {"Resume", "Retry", "Quit"};
	VDP_drawText("= PAUSE =           ", PAUSE_TEXT_X, PAUSE_TEXT_Y);
	for (u8 i = 0; i < PAUSE_MENU_COUNT; i++) {
		char buf[24];
		sprintf(buf, "%s %s", (i == pause_menu_cursor) ? ">" : " ", items[i]);
		VDP_drawText("                    ", PAUSE_TEXT_X, PAUSE_TEXT_Y + 2 + i * 2);
		VDP_drawText(buf, PAUSE_TEXT_X, PAUSE_TEXT_Y + 2 + i * 2);
	}
}

/** ポーズメニューをクリア */
static void clearPauseMenu(void) {
	for (u8 i = 0; i <= 6; i++) {
		VDP_drawText("                    ", PAUSE_TEXT_X, PAUSE_TEXT_Y + i);
	}
}

void GAME_togglePause(void) {
	game_state.paused = !game_state.paused;
	if (game_state.paused) {
		SOUND_pauseBGM(TRUE);
		pause_menu_cursor = 0;
		drawPauseMenu();
	} else {
		clearPauseMenu();
		SOUND_pauseBGM(FALSE);
		/* 復帰直後もPAL1を再適用（環境差でのパレット欠損対策） */
		PAL_setPalette(PAL1, spr_note.palette->data, CPU);
	}
}

u8 GAME_handlePauseInput(u16 changed, u16 state) {
	u16 pressed = changed & state;

	if (pressed & BUTTON_UP) {
		if (pause_menu_cursor > 0) {
			pause_menu_cursor--;
			drawPauseMenu();
		}
	} else if (pressed & BUTTON_DOWN) {
		if (pause_menu_cursor < PAUSE_MENU_COUNT - 1) {
			pause_menu_cursor++;
			drawPauseMenu();
		}
	} else if (pressed & (BUTTON_START | BUTTON_A)) {
		switch (pause_menu_cursor) {
			case 0: /* Resume */
				GAME_togglePause();
				return 0;
			case 1: /* Retry */
				SOUND_stopBGM();
				game_state.paused = FALSE;
				clearPauseMenu();
				return 1;
			case 2: /* Quit */
				SOUND_stopBGM();
				game_state.paused = FALSE;
				clearPauseMenu();
				game_state.playing = FALSE;
				return 2;
		}
	}

	return 0;
}

/**
 * GAME_getState - 現在のゲーム状態を取得する
 *
 * 読み取り専用のポインタを返す。
 * リザルト画面等でスコア・コンボ・判定数を参照するために使用。
 *
 * @return GameState構造体へのconstポインタ
 */
const GameState* GAME_getState(void) { return &game_state; }

/**
 * GAME_release - ゲームプレイリソースの解放
 *
 * 処理の流れ:
 *   1. NOTEサブシステムの解放
 *   2. HUDサブシステムの解放
 *   3. BGMの停止
 *   4. ヒットエフェクトスプライトの解放
 */
void GAME_release(void) {
	NOTE_release();
	HUD_release();
	SOUND_stopBGM();
}

/* ============================================================
 * 内部関数実装
 * ============================================================ */

/**
 * applyJudgment - 判定結果をゲーム状態に反映する
 *
 * 処理の流れ:
 *   1. 判定カウントをインクリメント
 *   2. 判定に応じたスコア加算とコンボ更新
 *      - PERFECT/GREAT/GOOD: スコア加算 + コンボ+1
 *      - MISS: コンボリセット
 *   3. 最大コンボの更新
 *   4. HUDに判定ポップアップを表示
 *   5. ヒットエフェクトスプライトの表示（MISS以外）
 *   6. 判定別SEの再生
 *   7. 正確度分子の加算
 *
 * @param result 判定結果 (JUDGE_PERFECT/GREAT/GOOD/MISS)
 */
static void applyJudgment(u8 result) {
	/* 判定カウントをインクリメント */
	game_state.judge_counts[result]++;

	/* 判定結果に応じてスコア加算とコンボ更新 */
	switch (result) {
		case JUDGE_PERFECT:
			game_state.score += SCORE_PERFECT; /* 300点加算 */
			game_state.combo++;
			break;
		case JUDGE_GREAT:
			game_state.score += SCORE_GREAT; /* 200点加算 */
			game_state.combo++;
			break;
		case JUDGE_GOOD:
			game_state.score += SCORE_GOOD; /* 100点加算 */
			game_state.combo++;
			break;
		case JUDGE_MISS:
			game_state.combo = 0; /* コンボリセット */
			break;
	}

	/* 最大コンボの更新 */
	if (game_state.combo > game_state.max_combo) game_state.max_combo = game_state.combo;

	/* HUDに判定ポップアップを表示 */
	HUD_showJudgment(result);

	/* ゲージ更新 */
	switch (result) {
		case JUDGE_PERFECT:
			game_state.gauge += GAUGE_GAIN_PERFECT;
			if (game_state.gauge > GAUGE_MAX) game_state.gauge = GAUGE_MAX;
			break;
		case JUDGE_GREAT:
			game_state.gauge += GAUGE_GAIN_GREAT;
			if (game_state.gauge > GAUGE_MAX) game_state.gauge = GAUGE_MAX;
			break;
		case JUDGE_GOOD:
			game_state.gauge += GAUGE_GAIN_GOOD;
			if (game_state.gauge > GAUGE_MAX) game_state.gauge = GAUGE_MAX;
			break;
		case JUDGE_MISS:
			if (game_state.gauge >= GAUGE_DRAIN_MISS)
				game_state.gauge -= GAUGE_DRAIN_MISS;
			else
				game_state.gauge = 0;
			break;
	}

	/* 判定別のSEを再生（設定されている場合のみ） */
	switch (result) {
		case JUDGE_PERFECT:
			if (se_perfect_data != NULL) SOUND_playSE(se_perfect_data, se_perfect_len, SOUND_PCM_CH2);
			break;
		case JUDGE_GREAT:
			if (se_great_data != NULL) SOUND_playSE(se_great_data, se_great_len, SOUND_PCM_CH2);
			break;
		case JUDGE_GOOD:
			if (se_good_data != NULL) SOUND_playSE(se_good_data, se_good_len, SOUND_PCM_CH2);
			break;
		case JUDGE_MISS:
			if (se_miss_data != NULL) SOUND_playSE(se_miss_data, se_miss_len, SOUND_PCM_CH2);
			break;
	}

	/* 正確度分子を加算（PERFECT=100, GREAT=75, GOOD=50, MISS=0） */
	switch (result) {
		case JUDGE_PERFECT:
			accuracy_numerator += 100;
			break;
		case JUDGE_GREAT:
			accuracy_numerator += 75;
			break;
		case JUDGE_GOOD:
			accuracy_numerator += 50;
			break;
		default:
			break;
	}
}

/**
 * updateMood - 正確度に基づいてムードを更新する
 *
 * ムードは4段階:
 *   3 = Excellent (正確度 >= MOOD_EXCELLENT_THRESHOLD)
 *   2 = Good      (正確度 >= MOOD_GOOD_THRESHOLD)
 *   1 = Normal    (正確度 >= MOOD_NORMAL_THRESHOLD)
 *   0 = Bad       (それ以下)
 */
static void updateMood(void) {
	u8 accuracy = calcAccuracy();

	if (accuracy >= MOOD_EXCELLENT_THRESHOLD)
		game_state.mood = 3; /* Excellent */
	else if (accuracy >= MOOD_GOOD_THRESHOLD)
		game_state.mood = 2; /* Good */
	else if (accuracy >= MOOD_NORMAL_THRESHOLD)
		game_state.mood = 1; /* Normal */
	else
		game_state.mood = 0; /* Bad */
}

/**
 * calcAccuracy - 現在の正確度を計算する
 *
 * 計算式: accuracy_numerator / 総判定数
 * 各判定の重み: PERFECT=100, GREAT=75, GOOD=50, MISS=0
 * 判定がまだない場合は100%を返す。
 *
 * @return 正確度 (0?100)
 */
static u8 calcAccuracy(void) {
	/* 総判定数を計算 */
	u16 total = game_state.judge_counts[JUDGE_PERFECT] + game_state.judge_counts[JUDGE_GREAT] +
				game_state.judge_counts[JUDGE_GOOD] + game_state.judge_counts[JUDGE_MISS];

	/* 判定がまだない場合は100%を返す */
	if (total == 0) return 100;

	/* 重み付き平均を算出 */
	return (u8)(accuracy_numerator / total);
}

/* ============================================================
 * SE・BGM設定用公開API
 * ============================================================ */

/**
 * GAME_setJudgeSE - 判定別SEデータを設定する
 *
 * 各判定（PERFECT/GREAT/GOOD/MISS）発生時に再生するSEを登録する。
 * NULLを渡すとその判定のSEは無効化される。
 *
 * @param se_perfect PERFECT判定SEデータへのポインタ
 * @param perfect_len PERFECT SEのバイト長
 * @param se_great GREAT判定SEデータへのポインタ
 * @param great_len GREAT SEのバイト長
 * @param se_good GOOD判定SEデータへのポインタ
 * @param good_len GOOD SEのバイト長
 * @param se_miss MISS判定SEデータへのポインタ
 * @param miss_len MISS SEのバイト長
 */
void GAME_setJudgeSE(const u8* se_perfect,
					 u32 perfect_len,
					 const u8* se_great,
					 u32 great_len,
					 const u8* se_good,
					 u32 good_len,
					 const u8* se_miss,
					 u32 miss_len) {
	se_perfect_data = se_perfect;
	se_perfect_len = perfect_len;
	se_great_data = se_great;
	se_great_len = great_len;
	se_good_data = se_good;
	se_good_len = good_len;
	se_miss_data = se_miss;
	se_miss_len = miss_len;
}

/**
 * GAME_setBGM - BGMデータを設定する
 *
 * 実際の再生はGAME_update()内のカウントダウン完了時に行われる。
 * NULLを渡すとBGMは再生されない。
 *
 * @param bgm PCM/XGM2 BGMデータへのポインタ
 * @param len BGMデータのバイト長
 */
void GAME_setBGM(const u8* bgm, u32 len) {
	bgm_data = bgm;
	bgm_len = len;
}

/**
 * GAME_setActionSE - アクション（操作）SEデータを設定する
 *
 * ボタン押下時のタップ音、HOLD継続中の音、
 * RAPID連打時の音をそれぞれ設定する。
 *
 * @param se_tap タップSEデータへのポインタ
 * @param tap_len タップSEのバイト長
 * @param se_hold HOLD SEデータへのポインタ
 * @param hold_len HOLD SEのバイト長
 * @param se_rapid RAPID SEデータへのポインタ
 * @param rapid_len RAPID SEのバイト長
 */
void GAME_setActionSE(
	const u8* se_tap, u32 tap_len, const u8* se_hold, u32 hold_len, const u8* se_rapid, u32 rapid_len) {
	se_tap_data = se_tap;
	se_tap_len = tap_len;
	se_hold_data = se_hold;
	se_hold_len = hold_len;
	se_rapid_data = se_rapid;
	se_rapid_len = rapid_len;
}
