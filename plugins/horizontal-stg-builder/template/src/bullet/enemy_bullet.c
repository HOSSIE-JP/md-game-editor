#include <genesis.h>
#include "game/config.h"
#include "bullet/enemy_bullet.h"
#include "system/debug.h"

static EnemyBullet bullets[MAX_ENEMY_BULLETS];
static u8 activeCount;

static s16 abs16(s16 v)
{
    return (v < 0) ? (s16)-v : v;
}

void enemyBulletInit(void)
{
    activeCount = 0;
}

void enemyBulletReset(void)
{
    activeCount = 0;
}

bool enemyBulletSpawnStraight(s16 x, s16 y, s16 vx256, s16 vy256, u8 damage)
{
    EnemyBullet* bullet;

    if (activeCount >= MAX_ENEMY_BULLETS)
    {
        debugGetCounters()->enemyBulletOverflow++;
        return FALSE;
    }

    bullet = &bullets[activeCount++];
    bullet->x256 = (s32)x * FIXED_ONE;
    bullet->y256 = (s32)y * FIXED_ONE;
    bullet->vx256 = vx256;
    bullet->vy256 = vy256;
    bullet->damage = damage;
    bullet->type = 0;
    bullet->flags = ENEMY_BULLET_FLAG_CORE_BLOCKABLE;
    bullet->timer = 0;

    return TRUE;
}


bool enemyBulletSpawnStraightUnblockable(s16 x, s16 y, s16 vx256, s16 vy256, u8 damage)
{
    EnemyBullet* bullet;

    if (!enemyBulletSpawnStraight(x, y, vx256, vy256, damage))
        return FALSE;

    bullet = &bullets[activeCount - 1];
    bullet->flags &= (u8)~ENEMY_BULLET_FLAG_CORE_BLOCKABLE;
    return TRUE;
}

bool enemyBulletSpawnAimed(s16 x, s16 y, s16 targetX, s16 targetY, s16 speed256, u8 damage)
{
    const s16 dx = targetX - x;
    const s16 dy = targetY - y;
    const s16 adx = abs16(dx);
    const s16 ady = abs16(dy);
    const s16 denom = (adx > ady) ? adx : ady;
    s16 vx;
    s16 vy;

    if (denom == 0)
        return enemyBulletSpawnStraight(x, y, -speed256, 0, damage);

    /* Spawn-time only approximation: cheap max-norm normalization. */
    vx = (s16)(((s32)dx * speed256) / denom);
    vy = (s16)(((s32)dy * speed256) / denom);

    return enemyBulletSpawnStraight(x, y, vx, vy, damage);
}

bool enemyBulletSpawnSpreadLeft(s16 x, s16 y, s16 speed256, u8 damage)
{
    const s16 left = (speed256 < 0) ? speed256 : (s16)-speed256;
    const s16 half = (s16)(abs16(speed256) / 2);

    if ((MAX_ENEMY_BULLETS - activeCount) < 3)
    {
        debugGetCounters()->enemyBulletOverflow++;
        return FALSE;
    }

    enemyBulletSpawnStraight(x, y, left, (s16)-half, damage);
    enemyBulletSpawnStraight(x, y, left, 0, damage);
    enemyBulletSpawnStraight(x, y, left, half, damage);
    return TRUE;
}

void enemyBulletUpdateAll(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        EnemyBullet* bullet = &bullets[i];
        s16 x;
        s16 y;

        bullet->x256 += bullet->vx256;
        bullet->y256 += bullet->vy256;
        bullet->timer++;

        x = (s16)(bullet->x256 >> FIXED_SHIFT);
        y = (s16)(bullet->y256 >> FIXED_SHIFT);

        if ((x < -16) || (x > SCREEN_WIDTH + 16) ||
            (y < GAMEPLAY_TOP_PX - 16) || (y > SCREEN_HEIGHT + 16))
        {
            bullet->flags |= ENEMY_BULLET_FLAG_REMOVE;
        }
    }
}

void enemyBulletCleanup(void)
{
    u8 i = 0;

    while (i < activeCount)
    {
        if (bullets[i].flags & ENEMY_BULLET_FLAG_REMOVE)
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

u8 enemyBulletGetActiveCount(void)
{
    return activeCount;
}

EnemyBullet* enemyBulletGet(u8 index)
{
    if (index >= activeCount)
        return NULL;

    return &bullets[index];
}


void enemyBulletClearAll(void)
{
    activeCount = 0;
}
