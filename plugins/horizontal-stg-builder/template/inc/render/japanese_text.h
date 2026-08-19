#ifndef HORIZONTAL_STG_JAPANESE_TEXT_H
#define HORIZONTAL_STG_JAPANESE_TEXT_H

#include <genesis.h>

void stgTextBegin(u16 firstTile);
u16 stgTextDraw(VDPPlane plane, const u8* text, u16 palette, bool priority, u16 x, u16 y);
u16 stgTextGetNextTile(void);

#endif
