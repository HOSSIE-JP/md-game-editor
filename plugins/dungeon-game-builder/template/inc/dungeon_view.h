#ifndef _DUNGEON_VIEW_H_
#define _DUNGEON_VIEW_H_

#include "dungeon_game.h"

void DUN_initView(void);
void DUN_setDark(bool dark);
void DUN_drawStatic(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playForward(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_playBackward(const DungeonFloorData *floor, u8 target_x, u8 target_y, u8 dir);
void DUN_playTurn(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, bool left);
void DUN_drawMinimap(const DungeonFloorData *floor, u8 x, u8 y, u8 dir);
void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir);

#endif /* _DUNGEON_VIEW_H_ */
