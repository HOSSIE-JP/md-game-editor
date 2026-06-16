#ifndef _INPUT_H_
#define _INPUT_H_

/**
 * @file input.h
 * @brief ジョイパッド入力処理モジュール
 *
 * Mega Drive コントローラのボタンをリズムゲームのレーンにマッピングする。
 *
 * ボタン→レーン対応:
 *   LEFT=0, UP=1, DOWN=2, RIGHT=3, A=4, B=5, C=6
 */

#include <genesis.h>

#include "game_def.h"

/**
 * 入力システムの初期化。
 * 現状では特に初期化処理なし（ジョイパッドハンドラはmain.cで設定）。
 */
void INPUT_init(void);

/**
 * ボタン押下をレーン番号に変換する。
 * @param button ボタンマスク (BUTTON_UP, BUTTON_A 等)
 * @return レーン番号 (0-6)、該当なしは -1
 */
s8 INPUT_buttonToLane(u16 button);

/**
 * 現在押されている全レーンボタンをビットマスクで取得。
 * HOLDノートの継続判定に使用。
 * @return ビットN = レーンNが押されている
 */
u8 INPUT_getLaneState(void);

#endif /* _INPUT_H_ */
