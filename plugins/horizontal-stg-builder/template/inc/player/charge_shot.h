#ifndef GERONEKO_CHARGE_SHOT_H
#define GERONEKO_CHARGE_SHOT_H

#include <genesis.h>

typedef enum
{
    CHARGE_STATE_IDLE = 0,
    CHARGE_STATE_CHARGING,
    CHARGE_STATE_HOLD_MAX,
    CHARGE_STATE_PAUSED
} ChargeState;

typedef enum
{
    CHARGE_LEVEL_NONE = 0,
    CHARGE_LEVEL_MID,
    CHARGE_LEVEL_MAX
} ChargeLevel;

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;
    u16 timer;
    u8 damage;
    u8 level;
    u8 flags;
} ChargeShot;

void chargeInit(void);
void chargeReset(void);
void chargeUpdate(u16 pressed, u16 held, u16 released);
void chargePauseForBomb(void);
void chargeResumeAfterBomb(bool aHeld);

ChargeState chargeGetState(void);
u16 chargeGetFrames(void);

void chargeShotUpdateAll(void);
void chargeShotCleanup(void);

u8 chargeShotGetActiveCount(void);
ChargeShot* chargeShotGet(u8 index);

#endif
