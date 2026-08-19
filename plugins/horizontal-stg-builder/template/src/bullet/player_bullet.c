#include <genesis.h>
#include "game/config.h"
#include "bullet/player_bullet.h"
#include "system/debug.h"

static PlayerBullet bullets[MAX_PLAYER_BULLETS];
static u8 activeCount;

void playerBulletInit(void)
{
    playerBulletReset();
}

void playerBulletReset(void)
{
    activeCount = 0;
}

bool playerBulletSpawn(s32 x256, s32 y256, s16 vx256, s16 vy256, u8 damage)
{
    PlayerBullet* bullet;

    if (activeCount >= MAX_PLAYER_BULLETS)
    {
        debugGetCounters()->playerBulletOverflow++;
        return FALSE;
    }

    bullet = &bullets[activeCount++];
    bullet->x256 = x256;
    bullet->y256 = y256;
    bullet->vx256 = vx256;
    bullet->vy256 = vy256;
    bullet->damage = damage;
    bullet->type = 0;
    bullet->flags = 0;
    bullet->renderHandle = INVALID_RENDER_HANDLE;

    return TRUE;
}

void playerBulletUpdateAll(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        PlayerBullet* bullet = &bullets[i];

        bullet->x256 += bullet->vx256;
        bullet->y256 += bullet->vy256;

        if ((bullet->x256 >> FIXED_SHIFT) > (SCREEN_WIDTH + 16))
            bullet->flags |= PLAYER_BULLET_FLAG_REMOVE;
    }
}

void playerBulletCleanup(void)
{
    u8 i = 0;

    while (i < activeCount)
    {
        if (bullets[i].flags & PLAYER_BULLET_FLAG_REMOVE)
        {
            bullets[i] = bullets[activeCount - 1];
            activeCount--;
        }
        else
        {
            i++;
        }
    }
}

u8 playerBulletGetActiveCount(void)
{
    return activeCount;
}

PlayerBullet* playerBulletGet(u8 index)
{
    if (index >= activeCount) return NULL;
    return &bullets[index];
}
