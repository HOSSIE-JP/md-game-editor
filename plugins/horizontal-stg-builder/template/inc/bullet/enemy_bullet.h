#ifndef GERONEKO_ENEMY_BULLET_H
#define GERONEKO_ENEMY_BULLET_H

#include <genesis.h>

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;

    u8 damage;
    u8 type;
    u8 flags;
    u8 timer;
} EnemyBullet;

enum
{
    ENEMY_BULLET_FLAG_REMOVE = 1 << 0,
    ENEMY_BULLET_FLAG_SPECIAL = 1 << 1,
    ENEMY_BULLET_FLAG_CORE_BLOCKABLE = 1 << 2
};

void enemyBulletInit(void);
void enemyBulletReset(void);

bool enemyBulletSpawnStraight(s16 x, s16 y, s16 vx256, s16 vy256, u8 damage);
bool enemyBulletSpawnStraightUnblockable(s16 x, s16 y, s16 vx256, s16 vy256, u8 damage);
bool enemyBulletSpawnAimed(s16 x, s16 y, s16 targetX, s16 targetY, s16 speed256, u8 damage);
bool enemyBulletSpawnSpreadLeft(s16 x, s16 y, s16 speed256, u8 damage);

void enemyBulletUpdateAll(void);
void enemyBulletCleanup(void);
void enemyBulletClearAll(void);

u8 enemyBulletGetActiveCount(void);
EnemyBullet* enemyBulletGet(u8 index);

#endif
