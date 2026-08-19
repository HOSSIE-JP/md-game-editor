#ifndef GERONEKO_ENEMY_H
#define GERONEKO_ENEMY_H

#include <genesis.h>

typedef u8 EnemyTypeId;

typedef enum
{
    ENEMY_BEHAVIOR_STRAIGHT = 0,
    ENEMY_BEHAVIOR_SINE,
    ENEMY_BEHAVIOR_ZIGZAG,
    ENEMY_BEHAVIOR_HOVER,
    ENEMY_BEHAVIOR_DIVE,
    ENEMY_BEHAVIOR_ANCHOR
} EnemyBehaviorId;

typedef enum
{
    ENEMY_FIRE_NONE = 0,
    ENEMY_FIRE_CYCLE,
    ENEMY_FIRE_AIMED,
    ENEMY_FIRE_SPREAD
} EnemyFirePattern;

typedef struct
{
    s16 hp;
    s16 vx256;
    s16 vy256;

    u16 score;
    u16 fireInterval;

    u8 behavior;
    u8 firePattern;
    u8 flags;
} EnemyDefinition;

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;

    s16 hp;
    u16 pendingDamage;
    u16 timer;

    s16 work0;
    s16 work1;

    u8 type;
    u8 behavior;
    u8 state;
    u8 flags;
    u8 renderHandle;
} Enemy;

enum
{
    ENEMY_FLAG_DEAD = 1 << 0,
    ENEMY_FLAG_REMOVE = 1 << 1
};

void enemyInit(void);
void enemyReset(void);

bool enemySpawn(EnemyTypeId type, s32 x256, s32 y256);
void enemyUpdateAll(void);
void enemyResolveDamage(void);
void enemyApplyBombTestDamage(void);
void enemyCleanup(void);

u8 enemyGetActiveCount(void);
Enemy* enemyGetByActiveIndex(u8 index);
const EnemyDefinition* enemyGetDefinition(EnemyTypeId type);

#endif
