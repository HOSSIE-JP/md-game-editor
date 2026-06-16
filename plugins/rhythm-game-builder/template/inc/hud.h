#ifndef _HUD_H_
#define _HUD_H_

/**
 * @file hud.h
 * @brief HUD表示モジュール（スコア、コンボ、ゲージ、判定テキスト）
 *
 * BG_Aプレーンのテキスト表示とハードウェアスプライトで
 * ゲームプレイ中のHUDを描画する。
 *
 * 表示要素:
 * - スコア  : 画面左上 (PAL0 テキスト)
 * - コンボ  : 画面中央上 (PAL0 テキスト + PAL0 スプライト)
 * - 正確度  : 画面右上 (PAL0 テキスト)
 * - 判定テキスト: 画面左上第2行 (PAL0 スプライト)
 * - ゲージ  : 画面中央右 (PAL3 スプライト)
 */

#include <genesis.h>

#include "game_def.h"

/**
 * HUDシステムの初期化。
 * 各HUDスプライト（判定テキスト、コンボ数字、ゲージ）を生成する。
 * @param vram_index VRAMタイルの開始インデックス
 * @return 使用したVRAMタイル数
 */
u16 HUD_init(u16 vram_index);

/**
 * HUD表示値の更新。
 * 値が変化した場合のみ再描画を行い、VDP書き込みを最小化する。
 * @param score 現在スコア
 * @param combo 現在コンボ数
 * @param accuracy 正確度 (0-100%)
 */
void HUD_update(u32 score, u16 combo, u8 accuracy);

/**
 * 判定テキストを表示する (PERFECT/GREAT/GOOD/MISS)。
 * JUDGE_DISPLAY_FRAMES フレーム後に自動的に消える。
 * @param judge 判定タイプ (JUDGE_PERFECT..JUDGE_MISS)
 */
void HUD_showJudgment(u8 judge);

/**
 * HUDアニメーションの更新（毎フレーム呼び出し）。
 * 判定テキストのタイマーを減算し、時間経過後に非表示にする。
 */
void HUD_animate(void);

/**
 * HUDの表示/非表示を切り替える。
 * @param visible TRUE=表示, FALSE=非表示
 */
void HUD_setVisibility(bool visible);

/**
 * 画像ベースUIモードを切り替える。
 * TRUE の場合は BG_A へのテキスト描画を抑止し、
 * スプライト主体のHUD表示のみ行う。
 * @param use_image TRUE=画像UIモード, FALSE=テキストUIモード
 */
void HUD_setUseImageUI(bool use_image);

/**
 * ゲージ表示を更新する。
 * @param gauge_value 現在のゲージ値 (0-GAUGE_MAX)
 */
void HUD_updateGauge(u16 gauge_value);

/**
 * HUDリソースの解放。
 * 全HUDスプライトを破棄する。
 */
void HUD_release(void);

#endif /* _HUD_H_ */
