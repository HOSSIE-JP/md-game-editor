#ifndef _NOTE_H_
#define _NOTE_H_

/**
 * @file note.h
 * @brief ノートデータ構造と譜面管理モジュール
 *
 * リズムゲームの中核ロジック:
 * - ノートは上から下へスクロールし、判定ラインに向かう
 * - MAX_VISIBLE_NOTES 個の ActiveNote プールでハードウェアスプライトを管理
 * - TAP: 単押し, HOLD: 長押し, RAPID: 連打
 */

#include <genesis.h>

#include "game_def.h"

/* ============================================================
 * ノートデータ構造体
 *
 * エディタからエクスポートされた譜面の1ノート分のデータ。
 * song_data.c で静的に定義される。
 * ============================================================ */
typedef struct {
	u16 frame;	  /**< 判定フレーム (60fps基準) */
	u8 type;	  /**< ノートタイプ/レーン (NOTE_LEFT..NOTE_C) */
	u8 pattern;	  /**< パターン (PATTERN_TAP/HOLD/RAPID) */
	u16 duration; /**< 持続フレーム数 (HOLD/RAPIDのみ、TAPは0) */
} NoteData;

/* ============================================================
 * 譜面メタデータ
 *
 * 1曲の全難易度の譜面情報を保持。
 * 楽曲タイトル、BPM、オフセット、
 * 各難易度のノート数とノート配列へのポインタ。
 * ============================================================ */
typedef struct {
	const char* title;				   /**< 楽曲タイトル */
	u16 bpm;						   /**< テンポ (BPM) */
	u16 offset_ms;					   /**< 開始オフセット (ms) */
	u16 note_count[DIFF_COUNT];		   /**< 各難易度のノート数 */
	const NoteData* notes[DIFF_COUNT]; /**< 各難易度のノート配列 */
} ChartInfo;

/* ============================================================
 * アクティブノート（画面上に表示中のノート）
 *
 * ノートプールの各スロットが保持する実行時データ。
 * スプライトの生成・移動・判定・解放を管理する。
 * ============================================================ */
typedef struct {
	s16 y;			  /**< 現在Y座標 (px) */
	u8 lane;		  /**< レーン番号 (NOTE_LEFT..NOTE_C) */
	u8 pattern;		  /**< パターン種別 */
	u16 target_frame; /**< 判定ライン到達フレーム */
	u16 duration;	  /**< HOLD/RAPID の持続フレーム */
	u16 chart_index;  /**< 譜面配列内のインデックス */
	bool active;	  /**< 表示中フラグ */
	bool judged;	  /**< 判定済みフラグ */
	u8 anim_state;	  /**< アニメーション状態 (NOTE_ANIM_*) */
	u8 anim_timer;	  /**< ヒット/ミスアニメ残りフレーム */
	Sprite* sprite;	  /**< VDPスプライトハンドル */
} ActiveNote;

/* ============================================================
 * 公開関数
 * ============================================================ */

/**
 * ノートシステムの初期化。
 * ノートプールをクリアし、PAL1 にノートパレットをロードする。
 * @param vram_index ノートスプライト用のVRAM開始インデックス
 * @return 使用したVRAMタイル数
 */
u16 NOTE_init(u16 vram_index);

/**
 * 指定難易度の譜面をロードする。
 * 既存のノートはすべて解放される。
 * @param chart 譜面データへのポインタ
 * @param difficulty 難易度 (DIFF_EASY/NORMAL/HARD)
 */
void NOTE_loadChart(const ChartInfo* chart, u8 difficulty);

/**
 * ノートの位置更新とスポーン/デスポーン処理。
 * 毎フレーム呼び出す。
 * @param current_frame 現在のゲームフレーム
 */
void NOTE_update(u16 current_frame);

/**
 * 静的BG要素（レーン背景、判定ライン、ラベル）を描画する。
 * 初回呼び出し時のみ描画し、2回目以降はスキップされる。
 */
void NOTE_draw(void);

/**
 * 指定レーンのノートを判定する。
 * 判定ウィンドウ内で最も近い未判定ノートを探す。
 * @param lane レーン番号 (NOTE_LEFT..NOTE_C)
 * @param current_frame 現在のゲームフレーム
 * @return 判定結果 (JUDGE_PERFECT..JUDGE_MISS)、判定対象なしは -1
 */
s8 NOTE_judge(u8 lane, u16 current_frame);

/**
 * 判定ラインを過ぎたミスノートをチェックする。
 * @param current_frame 現在のゲームフレーム
 * @return 今回新たにミスとなったノート数
 */
u16 NOTE_checkMisses(u16 current_frame);

/**
 * 最後に判定されたノートのパターンを取得。
 * NOTE_judge() 直後にのみ有効。
 * @return PATTERN_TAP/HOLD/RAPID
 */
u8 NOTE_getLastJudgedPattern(void);

/**
 * 最後に判定されたノートの持続フレームを取得。
 * @return 持続フレーム数 (TAPは0)
 */
u16 NOTE_getLastJudgedDuration(void);

/**
 * 全ノートが判定済みか確認する。
 * @return TRUE=譜面完了
 */
bool NOTE_isChartComplete(void);

/**
 * 全ノートスプライトを解放する。
 * 判定ライン・レーンラベルスプライトも解放。
 */
void NOTE_release(void);

/**
 * 現在の譜面の総ノート数を取得する。
 * @return 総ノート数
 */
u16 NOTE_getTotalCount(void);

/**
 * 画像ベースUIモードの切り替え。
 * TRUE の場合、NOTE_draw() はテキスト描画をスキップし、
 * 背景画像によるUIを使用する。
 * @param use_image TRUE=画像ベースUI, FALSE=テキスト描画
 */
void NOTE_setUseImageUI(bool use_image);

#endif /* _NOTE_H_ */
