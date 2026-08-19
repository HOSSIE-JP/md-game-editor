#ifndef GERONEKO_HUD_H
#define GERONEKO_HUD_H

#include <genesis.h>

void hudInit(void);
void hudReset(void);
void hudSetScore(u32 score);
void hudSetLives(u8 lives);
void hudSetWeapon(u8 color, u8 level);
void hudSetCharge(u16 frames, u8 state);
void hudSetCoreState(u8 state);
void hudSetSpeed(u8 level);
void hudSetBombs(u8 bombs);
void hudShowStageClear(void);
void hudShowGameOver(void);
void hudPrepare(void);

#endif
