#ifndef _GAME_H_
#define _GAME_H_

/**
 * @file game.h
 * @brief ゲームプレイシーン管理モジュール
 *
 * NOTE, HUD, INPUT, SOUND サブシステムを統括し、
 * スコア・コンボ・正確度・ムードを管理する。
 *
 * 具体的な役割:
 * - 譜面データのロードとゲーム開始
 * - 毎フレームのノート更新・判定・ミスチェック
 * - HOLD/RAPID ノートの継続追跡
 * - コントローラ入力の受付と判定処理
 * - BGM・SEのトリガー管理
 */

#include <genesis.h>

#include "game_def.h"
#include "note.h"

/* ============================================================
 * ゲーム状態構造体
 *
 * ゲームプレイ中の全情報を保持。
 * GAME_getState() で読み取り専用ポインタを取得可能。
 * ============================================================ */
typedef struct {
	u32 score;			 /**< 現在スコア */
	u16 combo;			 /**< 現在コンボ数 */
	u16 max_combo;		 /**< 最大コンボ数 */
	u16 judge_counts[4]; /**< 各判定のカウント [PERFECT, GREAT, GOOD, MISS] */
	u16 current_frame;	 /**< 現在フレーム（カウントダウン後からカウント） */
	u16 gauge;			 /**< ゲージ値 (0-GAUGE_MAX) */
	u8 difficulty;		 /**< 選択された難易度 (DIFF_EASY/NORMAL/HARD) */
	u8 mood;			 /**< ムード値 0=Bad, 1=Normal, 2=Good, 3=Excellent */
	bool playing;		 /**< ゲーム進行中フラグ */
	bool complete;		 /**< ゲーム完了フラグ */
	bool paused;		 /**< ポーズ中フラグ */
	u8 pause_result;	 /**< ポーズメニュー結果 0=なし 1=リトライ 2=選曲へ */
} GameState;

/* ============================================================
 * 公開 API
 * ============================================================ */

/**
 * ゲームプレイシーンの初期化。
 * NOTE・HUD サブシステムを初期化し、ゲーム状態をリセットする。
 * @param vram_index VRAMタイルの開始インデックス
 * @return 使用したVRAMタイル数
 */
u16 GAME_init(u16 vram_index);

/**
 * 指定された譜面と難易度でゲームを開始する。
 * カウントダウン後にノートが流れ始める。
 * @param chart 譜面データへのポインタ
 * @param difficulty 難易度 (DIFF_EASY/NORMAL/HARD)
 */
void GAME_start(const ChartInfo* chart, u8 difficulty);

/**
 * ゲームプレイの1フレーム更新。
 * カウントダウン、ノート更新、ミスチェック、
 * HOLD/RAPID追跡、HUD更新、譜面完了チェックを行う。
 * @return TRUE=ゲーム続行中, FALSE=完了
 */
bool GAME_update(void);

/**
 * ゲームプレイの描画処理。
 * NOTE_draw() を呼び出してノートとBG要素を描画する。
 */
void GAME_draw(void);

/**
 * ジョイパッド入力の処理。
 * ボタン押下時にノート判定、HOLD/RAPID開始、SE再生を行う。
 * @param joy ジョイパッド番号 (JOY_1)
 * @param changed 変化したボタンのマスク
 * @param state 現在のボタン状態マスク
 */
void GAME_handleInput(u16 joy, u16 changed, u16 state);

/**
 * 現在のゲーム状態を取得（読み取り専用）。
 * @return GameState への const ポインタ
 */
const GameState* GAME_getState(void);

/**
 * ゲームプレイリソースの解放。
 * NOTE, HUD, SOUND を停止・解放し、スプライトを破棄する。
 */
void GAME_release(void);

/**
 * BGMデータを設定する。
 * 実際の再生はカウントダウン完了時に GAME_update() 内で行われる。
 * @param bgm PCM/XGM2 BGMデータへのポインタ（NULLで無効）
 * @param len BGMデータのバイト数
 */
void GAME_setBGM(const u8* bgm, u32 len);

/**
 * 判定レベル別SEデータを設定する。
 * NULL を渡すと対応するSEが無効化される。
 * @param se_perfect  PERFECT 判定時のSEデータ
 * @param perfect_len PERFECT SEのデータ長
 * @param se_great    GREAT 判定時のSEデータ
 * @param great_len   GREAT SEのデータ長
 * @param se_good     GOOD 判定時のSEデータ
 * @param good_len    GOOD SEのデータ長
 * @param se_miss     MISS 判定時のSEデータ
 * @param miss_len    MISS SEのデータ長
 */
void GAME_setJudgeSE(const u8* se_perfect,
					 u32 perfect_len,
					 const u8* se_great,
					 u32 great_len,
					 const u8* se_good,
					 u32 good_len,
					 const u8* se_miss,
					 u32 miss_len);

/**
 * アクション別SEデータを設定する。
 * 判定SEとは別に、ボタン操作自体に対するフィードバック音。
 *   tap  : すべてのボタン押下時に再生
 *   hold : HOLD継続中に定期的に再生
 *   rapid: RAPID連打ヒット時に再生
 * NULL を渡すと対応するSEが無効化される。
 * @param se_tap   タップSEデータ
 * @param tap_len  タップSEのデータ長
 * @param se_hold  ホールドSEデータ
 * @param hold_len ホールドSEのデータ長
 * @param se_rapid ラピッドSEデータ
 * @param rapid_len ラピッドSEのデータ長
 */
void GAME_setActionSE(
	const u8* se_tap, u32 tap_len, const u8* se_hold, u32 hold_len, const u8* se_rapid, u32 rapid_len);

/**
 * ポーズをトグルする。
 * ポーズ時: BGM停止、入力無視
 * 復帰時: BGM再開
 */
void GAME_togglePause(void);

/**
 * ポーズ中にメニュー入力を処理する。
 * @param changed 変化したボタンのマスク
 * @param state 現在のボタン状態マスク
 * @return 0=ゲーム続行, 1=リトライ, 2=選曲に戻る
 */
u8 GAME_handlePauseInput(u16 changed, u16 state);

#endif /* _GAME_H_ */
