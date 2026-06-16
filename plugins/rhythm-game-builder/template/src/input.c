/**
 * @file input.c
 * @brief コントローラ入力マッピングモジュール
 *
 * Mega Drive コントローラのボタンをリズムゲームのレーンに対応付ける。
 *
 * ボタン → レーン対応表:
 *   BUTTON_LEFT  → NOTE_LEFT  (レーン0)
 *   BUTTON_UP    → NOTE_UP    (レーン1)
 *   BUTTON_DOWN  → NOTE_DOWN  (レーン2)
 *   BUTTON_RIGHT → NOTE_RIGHT (レーン3)
 *   BUTTON_A     → NOTE_A     (レーン4)
 *   BUTTON_B     → NOTE_B     (レーン5)
 *   BUTTON_C     → NOTE_C     (レーン6)
 *
 * 7レーン全てを使うことで、Mega Driveの3ボタン＋十字キーを
 * 最大限に活用する。
 */

#include "input.h"

#include <genesis.h>

#include "game_def.h"

/* ボタン→レーン マッピングテーブル */
/* 各ボタンを個別にチェックして対応レーンを返す */

/**
 * 入力システムの初期化。
 * ジョイパッドハンドラは main.c で設定されるため、
 * ここでは追加の初期化は行わない。
 */
void INPUT_init(void) { /* ジョイパッドハンドラはmainで設定するため初期化不要 */ }

/**
 * 単一ボタンのビットマスクを対応するレーン番号に変換する。
 *
 * 複数ボタンが同時にセットされている場合、
 * 優先度の高い方（LEFT→UP→DOWN→RIGHT→A→B→C）が返る。
 *
 * @param button SGDKのボタンビットマスク (BUTTON_UP, BUTTON_A 等)
 * @return 対応レーン番号 (NOTE_LEFT..NOTE_C)、該当なしなら -1
 */
s8 INPUT_buttonToLane(u16 button) {
	if (button & BUTTON_LEFT) return NOTE_LEFT;
	if (button & BUTTON_UP) return NOTE_UP;
	if (button & BUTTON_DOWN) return NOTE_DOWN;
	if (button & BUTTON_RIGHT) return NOTE_RIGHT;
	if (button & BUTTON_A) return NOTE_A;
	if (button & BUTTON_B) return NOTE_B;
	if (button & BUTTON_C) return NOTE_C;

	return -1;
}

/**
 * 現在押されている全レーンの状態をビットフラグで取得する。
 *
 * JOY_readJoypad() で現在のジョイパッド状態を読み取り、
 * 各ボタンの押下状態を対応レーンのビットにマッピングする。
 * HOLD/RAPID ノートの継続判定に使用する。
 *
 * @return レーン状態のビットフラグ (bit0=NOTE_LEFT .. bit6=NOTE_C)
 */
u8 INPUT_getLaneState(void) {
	u16 joy = JOY_readJoypad(JOY_1);
	u8 lanes = 0;

	if (joy & BUTTON_LEFT) lanes |= (1 << NOTE_LEFT);
	if (joy & BUTTON_UP) lanes |= (1 << NOTE_UP);
	if (joy & BUTTON_DOWN) lanes |= (1 << NOTE_DOWN);
	if (joy & BUTTON_RIGHT) lanes |= (1 << NOTE_RIGHT);
	if (joy & BUTTON_A) lanes |= (1 << NOTE_A);
	if (joy & BUTTON_B) lanes |= (1 << NOTE_B);
	if (joy & BUTTON_C) lanes |= (1 << NOTE_C);

	return lanes;
}
