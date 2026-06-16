#ifndef _RHYTHM_SOUND_H_
#define _RHYTHM_SOUND_H_

/**
 * @file sound.h
 * @brief サウンド管理モジュール (BGM: XGM2, SE: PCM)
 *
 * SGDK の XGM2 ドライバのラッパー。
 * BGM は PCM チャンネル1でストリーミング再生、
 * SE は PCM チャンネル2～4でワンショット再生を行う。
 *
 * チャンネル割り当て:
 *   CH1: BGM (SOUND_PCM_CH1)
 *   CH2: 判定 SE (SOUND_PCM_CH2)
 *   CH3: アクション SE / HOLDティック (SOUND_PCM_CH3)
 *   CH4: RAPID SE (SOUND_PCM_CH4)
 */

#include <genesis.h>

/**
 * サウンドシステムの初期化。
 * XGM2ドライバはSGDKが自動初期化するため、追加処理はない。
 */
void SOUND_init(void);

/**
 * BGMを再生開始する (PCMストリーム)。
 * @param bgm PCM音楽データへのポインタ
 * @param len BGMデータのバイト数
 */
void SOUND_playBGM(const u8* bgm, u32 len);

/**
 * BGMを停止する。
 */
void SOUND_stopBGM(void);

/**
 * BGMのポーズ/レジューム。
 * XGM2のポーズ/レジューム機能を使用して同期ずれを最小化する。
 * 実行環境によって再開が失敗した場合は内部フォールバックで再生を再開する。
 * @param pause TRUE=ポーズ, FALSE=レジューム
 */
void SOUND_pauseBGM(bool pause);

/**
 * 効果音を再生する。
 * @param se PCM音声データへのポインタ
 * @param len データのバイト数
 * @param channel PCMチャンネル (SOUND_PCM_CH2..CH4)
 */
void SOUND_playSE(const u8* se, u32 len, u16 channel);

/**
 * プレビュー再生を開始する（選曲画面用）。
 * 約10秒再生後に自動停止する。
 * @param bgm PCM音楽データへのポインタ
 * @param len BGMデータのバイト数
 */
void SOUND_playPreview(const u8* bgm, u32 len);

/**
 * プレビュー再生のフレーム更新。
 * 毎フレーム呼び出してタイマーを進行させる。
 */
void SOUND_updatePreview(void);

/**
 * プレビュー再生を停止する。
 */
void SOUND_stopPreview(void);

#endif /* _RHYTHM_SOUND_H_ */
