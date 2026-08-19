#ifndef GERONEKO_ABYSS_CORE_H
#define GERONEKO_ABYSS_CORE_H

#include <genesis.h>

typedef enum
{
    CORE_STATE_LOST = 0,
    CORE_STATE_MOUNT_FRONT,
    CORE_STATE_MOUNT_REAR,
    CORE_STATE_LAUNCHING,
    CORE_STATE_DETACHED,
    CORE_STATE_RETURNING
} AbyssCoreState;

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;
    u16 timer;
    u8 state;
    u8 flags;
    u8 renderHandle;
} AbyssCoreController;

void abyssCoreInit(void);
void abyssCoreResetForStage(void);
void abyssCoreUpdate(u16 pressed);

void abyssCoreAcquireAt(s16 sourceScreenX);
void abyssCoreLose(void);

AbyssCoreState abyssCoreGetState(void);
bool abyssCoreIsOwned(void);
bool abyssCoreIsShieldActive(void);
bool abyssCoreCanDamage(void);

s16 abyssCoreGetScreenX(void);
s16 abyssCoreGetScreenY(void);

u8 abyssCoreGetDamage(void);

#endif
