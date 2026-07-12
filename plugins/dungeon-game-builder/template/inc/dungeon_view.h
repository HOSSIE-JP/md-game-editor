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
/* エネミー: main.c が所有する現在フロアのリストへのポインタ+件数を渡す。DUN_drawStatic /
 * DUN_playForward 等の描画呼び出しより前に (毎フレーム) 呼んでおくこと。 */
void DUN_setEnemies(const DunEnemy *list, u8 count);
/* エネミー移動スライドの進行度 (num/den、0..den) を設定する。main.c が毎フレーム更新し、
 * updateBillboards が直前セル→現セルの画面座標を補間する。 */
void DUN_setEnemySlide(u16 num, u16 den);
/*
 * プレイヤー静止中にエネミーだけが動いた場合の軽量リフレッシュ。壁タイルの再ステージ・
 * DMA 転送は行わず、直近の DUN_drawStatic 呼び出し位置でビルボード (スプライト) だけを
 * 更新する。main.c のエネミー tick (vblank タイマー駆動) から毎tick呼ぶ想定。
 */
void DUN_refreshBillboards(void);
void DUN_drawStatic(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playForward(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playBackward(const DungeonFloorData *floor, u8 target_x, u8 target_y, u8 dir);
void DUN_playTurn(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, bool left);
/* visited: 現在フロアの踏破ビットフィールド (1 セル = 1 bit, DUN_INDEX と同じ並び)。
 * FULL モードでは未参照だが、呼び出し側は常に現在フロアのポインタを渡す。 */
void DUN_drawMinimap(const DungeonFloorData *floor, const u8 *visited, u8 x, u8 y, u8 dir);
void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir);

#endif /* _DUNGEON_VIEW_H_ */
