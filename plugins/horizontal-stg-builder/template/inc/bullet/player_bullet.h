#ifndef GERONEKO_PLAYER_BULLET_H
#define GERONEKO_PLAYER_BULLET_H

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
    u8 renderHandle;
} PlayerBullet;

enum
{
    PLAYER_BULLET_FLAG_REMOVE = 1 << 0
};

void playerBulletInit(void);
void playerBulletReset(void);
bool playerBulletSpawn(s32 x256, s32 y256, s16 vx256, s16 vy256, u8 damage);
void playerBulletUpdateAll(void);
void playerBulletCleanup(void);

u8 playerBulletGetActiveCount(void);
PlayerBullet* playerBulletGet(u8 index);

#endif
