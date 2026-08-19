#ifndef GERONEKO_BOSS_H
#define GERONEKO_BOSS_H

#include <genesis.h>
#include "game/config.h"

typedef enum
{
    BOSS_STATE_INACTIVE = 0,
    BOSS_STATE_ENTRY,
    BOSS_STATE_ACTIVE,
    BOSS_STATE_DYING,
    BOSS_STATE_DEFEATED
} BossState;

typedef enum
{
    BOSS_MOVE_STATIONARY = 0,
    BOSS_MOVE_WAVE,
    BOSS_MOVE_DASH,
    BOSS_MOVE_ORBIT,
    BOSS_MOVE_ANCHOR,
    BOSS_MOVE_HUNT,
    BOSS_MOVE_SPIRAL
} BossMovementId;

typedef enum
{
    BOSS_FIRE_AIMED = 0,
    BOSS_FIRE_FAN,
    BOSS_FIRE_WALL,
    BOSS_FIRE_SPIRAL,
    BOSS_FIRE_LANCE,
    BOSS_FIRE_LURE,
    BOSS_FIRE_CROSS,
    BOSS_FIRE_WEB,
    BOSS_FIRE_CORE
} BossFirePatternId;

enum
{
    BOSS_PART_DAMAGEABLE = 1 << 0,
    BOSS_PART_DESTRUCTIBLE = 1 << 1,
    BOSS_PART_HAZARDOUS = 1 << 2,
    BOSS_PART_DESTROYED = 1 << 3
};

typedef struct
{
    s16 offsetX;
    s16 offsetY;
    s16 hp;
    u16 pendingDamage;
    u8 flags;
    u8 renderHandle;
} BossPart;

typedef struct
{
    s16 entryX;
    s16 activeX;
    s16 y;
    s16 entryVx256;

    s16 partHp[MAX_BOSS_PARTS];
    u32 score;

    u16 fireInterval;
    u16 deathFrames;

    u8 bombFixedDamage;
    u8 movement;
    u8 firePattern;
    u8 forms;
} BossDefinition;

typedef struct
{
    s32 x256;
    s32 y256;

    u32 phaseTimer;
    u32 attackTimer;

    BossPart parts[MAX_BOSS_PARTS];

    u8 bossId;
    u8 state;
    u8 phase;
    u8 flags;
} BossController;

void bossInit(void);
void bossResetForStage(void);

bool bossStart(u8 bossId);
void bossUpdate(void);
void bossResolveDamage(void);

bool bossApplyHitAt(s16 x, s16 y, u8 damage);
bool bossPlayerBodyCollision(s16 x, s16 y);

void bossApplyBombTestDamage(void);

bool bossIsActive(void);
bool bossIsDefeated(void);
BossState bossGetState(void);
u8 bossGetId(void);
const BossDefinition* bossGetDefinition(u8 bossId);

#endif
