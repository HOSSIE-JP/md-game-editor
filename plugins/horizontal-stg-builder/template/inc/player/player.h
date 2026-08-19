#ifndef GERONEKO_PLAYER_H
#define GERONEKO_PLAYER_H

#include <genesis.h>
#include "system/input.h"

typedef enum
{
    PLAYER_STATE_ACTIVE = 0,
    PLAYER_STATE_HIT,
    PLAYER_STATE_RESPAWN,
    PLAYER_STATE_INVINCIBLE,
    PLAYER_STATE_STAGE_CLEAR,
    PLAYER_STATE_GAME_OVER
} PlayerState;

enum
{
    PLAYER_FLAG_PENDING_HIT = 1 << 0
};

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;

    u16 stateTimer;
    u16 invincibleTimer;

    u8 state;
    u8 flags;
    u8 weaponColor;
    u8 weaponLevel;
    u8 renderHandle;
} Player;

void playerInit(void);
void playerResetForStage(void);
void playerUpdate(const InputState* input);

void playerRequestHit(void);
void playerResolvePendingHit(void);
bool playerCanBeHit(void);
bool playerCanShoot(void);

const Player* playerGet(void);
s16 playerGetScreenX(void);
s16 playerGetScreenY(void);

#endif
