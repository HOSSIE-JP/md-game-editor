/**
 * @file sound.c
 * @brief サウンド管理モジュール（XGM2ドライバのラッパー）
 *
 * SGDK の XGM2 ドライバを介して BGM と効果音を再生する。
 *
 * チャンネル割り当て:
 *   CH1 (SOUND_PCM_CH1): BGMストリーミング再生
 *   CH2 (SOUND_PCM_CH2): 判定SE (ヒット音等)
 *   CH3 (SOUND_PCM_CH3): アクションSE / HOLDティック
 *   CH4 (SOUND_PCM_CH4): RAPID SE
 *
 * 制限事項:
 *   - XGM2_pause / XGM2_resume は再開時に音色復帰が完全ではない場合がある。
 *     ただし再生位置は維持されるため、リズム同期を優先してこちらを使用する。
 *   - XGM2_playPCM() は NULL データや len=0 で呼ぶとクラッシュするため、
 *     各関数でガードチェックを行う。
 */

#include "sound.h"

#include <genesis.h>

/* 現在再生中BGMの状態を保持（ポーズ復帰用） */
static const u8* bgm_current_data;
static u32 bgm_current_len;
static bool bgm_started;
static bool bgm_paused;

/**
 * サウンドシステムの初期化。
 * XGM2ドライバはSGDKのブート時に自動初期化されるため、
 * ここでは追加の初期化処理は行わない。
 */
void SOUND_init(void) {
	/* XGM2ドライバはSGDKが自動初期化するため追加処理不要 */
	bgm_current_data = NULL;
	bgm_current_len = 0;
	bgm_started = FALSE;
	bgm_paused = FALSE;
}

/**
 * BGMを再生開始する。
 * PCMチャンネル1 (SOUND_PCM_CH1) でストリーミング再生を行う。
 * bgmがNULLまたはlenが0の場合は何もしない（クラッシュ防止）。
 *
 * @param bgm PCM音楽データへのポインタ
 * @param len BGMデータのバイト数
 */
void SOUND_playBGM(const u8* bgm, u32 len) {
	if (bgm != NULL && len > 0) {
		/* CH1をBGM専用として高優先度で再生。6650レートサンプルのためhalfRate=TRUE */
		XGM2_playPCMEx(bgm, len, SOUND_PCM_CH1, 15, TRUE, FALSE);
		bgm_current_data = bgm;
		bgm_current_len = len;
		bgm_started = TRUE;
		bgm_paused = FALSE;
	}
}

/**
 * BGMを停止する。
 * PCMチャンネル1の再生を即座に停止する。
 */
void SOUND_stopBGM(void) {
	XGM2_stopPCM(SOUND_PCM_CH1);
	bgm_paused = FALSE;
	bgm_started = FALSE;
}

/**
 * BGMのポーズ/レジューム。
 *
 * XGM2のグローバルなポーズ/レジュームAPIを利用することで、
 * 再生位置を維持したまま一時停止と再開を行う。
 * レジューム失敗時のみフォールバックとして再生し直す。
 *
 * @param pause TRUE=ポーズ(停止), FALSE=レジューム(未実装)
 */
void SOUND_pauseBGM(bool pause) {
	if (!bgm_started) return;

	if (pause) {
		if (!bgm_paused) {
			XGM2_pause();
			bgm_paused = TRUE;
		}
	} else {
		if (bgm_paused) {
			XGM2_resume();
			bgm_paused = FALSE;
		}
	}
}

/**
 * 効果音(SE)を再生する。
 * 指定されたPCMチャンネルでワンショット再生を行う。
 * seがNULLまたはlenが0の場合は何もしない（クラッシュ防止）。
 *
 * @param se     PCM音声データへのポインタ
 * @param len    データのバイト数
 * @param channel PCMチャンネル (SOUND_PCM_CH2..CH4)
 */
void SOUND_playSE(const u8* se, u32 len, u16 channel) {
	if (se != NULL && len > 0) {
		/* XGM2はPCM 3ch(CH1-CH3)なのでCH4指定はCH3に丸める */
		SoundPCMChannel ch = (SoundPCMChannel)channel;
		if (ch == SOUND_PCM_CH4) ch = SOUND_PCM_CH3;
		XGM2_playPCM(se, len, ch);
	}
}

/* ============================================================
 * プレビュー再生（選曲画面用）
 * ============================================================ */

#define PREVIEW_PLAY_FRAMES 600 /* ~10秒 at 60fps */
#define PREVIEW_FADE_FRAMES 30

static bool preview_active = FALSE;
static u16 preview_timer;
static u8 preview_fade_step;

void SOUND_playPreview(const u8* bgm, u32 len) {
	SOUND_stopPreview();
	if (bgm != NULL && len > 0) {
		XGM2_playPCMEx(bgm, len, SOUND_PCM_CH1, 15, TRUE, FALSE);
		preview_active = TRUE;
		preview_timer = PREVIEW_PLAY_FRAMES;
		preview_fade_step = 0;
	}
}

void SOUND_updatePreview(void) {
	if (!preview_active) return;

	if (preview_timer > 0) {
		preview_timer--;
		return;
	}

	/* フェードアウトフェーズ */
	preview_fade_step++;
	if (preview_fade_step >= PREVIEW_FADE_FRAMES) {
		SOUND_stopPreview();
	}
}

void SOUND_stopPreview(void) {
	if (preview_active) {
		XGM2_stopPCM(SOUND_PCM_CH1);
		preview_active = FALSE;
		preview_timer = 0;
		preview_fade_step = 0;
	}
}
