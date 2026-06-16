#ifndef _DUNGEON_VIEW_H_
#define _DUNGEON_VIEW_H_

#include "dungeon_game.h"

void DUN_initView(void);
void DUN_drawView(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, u8 action, u8 anim_step);
void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir);

#endif /* _DUNGEON_VIEW_H_ */
