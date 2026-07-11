#ifndef _DUNGEON_VIEW_H_
#define _DUNGEON_VIEW_H_

#include "dungeon_game.h"

void DUN_initView(void);
void DUN_applyViewSet(u8 view_set);
void DUN_setDark(bool dark);
/* 移動アニメーション1フレームあたり、必須の DMA 転送 (2 vblank) に追加する待ち vblank 数。
 * ゲーム側のパワーアップ演出などから呼び、移動テンポを実行時に変更できる。 */
void DUN_setMoveSpeed(u8 extra_vblanks);
/* ミニマップ表示モード。VISITED (既定) は自分が歩いたセルのみ表示する自動マッピング、
 * FULL はフロア全体を常時表示する。マップ入手アイテムなどゲーム側のイベントから
 * DUN_setMinimapMode で実行時に切り替える想定。 */
#define DUN_MINIMAP_VISITED 0
#define DUN_MINIMAP_FULL    1
void DUN_setMinimapMode(u8 mode);
void DUN_drawStatic(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playForward(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playBackward(const DungeonFloorData *floor, u8 target_x, u8 target_y, u8 dir);
void DUN_playTurn(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, bool left);
/* visited: 現在フロアの踏破ビットフィールド (1 セル = 1 bit, DUN_INDEX と同じ並び)。
 * FULL モードでは未参照だが、呼び出し側は常に現在フロアのポインタを渡す。 */
void DUN_drawMinimap(const DungeonFloorData *floor, const u8 *visited, u8 x, u8 y, u8 dir);
void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir);

#endif /* _DUNGEON_VIEW_H_ */
