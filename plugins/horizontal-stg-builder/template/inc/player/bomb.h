#ifndef GERONEKO_BOMB_H
#define GERONEKO_BOMB_H

#include <genesis.h>

void bombInit(void);
void bombResetForStage(void);
void bombUpdate(u16 pressed, u16 held);

bool bombIsActive(void);
u16 bombGetTimer(void);

#endif
