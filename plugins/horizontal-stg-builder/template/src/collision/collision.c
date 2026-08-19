#include <genesis.h>
#include "game/config.h"
#include "collision/collision.h"
#include "bullet/player_bullet.h"
#include "bullet/enemy_bullet.h"
#include "enemy/enemy.h"
#include "enemy/boss.h"
#include "item/item.h"
#include "player/player.h"
#include "player/abyss_core.h"
#include "player/charge_shot.h"
#include "player/bomb.h"
#include "player/recovery.h"
#include "stage/stage_controller.h"

static bool overlapRadius(s16 ax, s16 ay, s16 bx, s16 by, s16 radius)
{
    const s16 dx = ax - bx;
    const s16 dy = ay - by;

    return (dx > -radius) && (dx < radius) &&
           (dy > -radius) && (dy < radius);
}

static void collisionCoreShieldVsEnemyBullets(void)
{
    const s16 coreX = abyssCoreGetScreenX();
    const s16 coreY = abyssCoreGetScreenY();
    u8 i;

    if (!abyssCoreIsShieldActive())
        return;

    for (i = 0; i < enemyBulletGetActiveCount(); i++)
    {
        EnemyBullet* bullet = enemyBulletGet(i);

        if ((bullet == NULL) || (bullet->flags & ENEMY_BULLET_FLAG_REMOVE))
            continue;

        if (!(bullet->flags & ENEMY_BULLET_FLAG_CORE_BLOCKABLE))
            continue;

        if (overlapRadius(
                coreX,
                coreY,
                (s16)(bullet->x256 >> FIXED_SHIFT),
                (s16)(bullet->y256 >> FIXED_SHIFT),
                10))
        {
            bullet->flags |= ENEMY_BULLET_FLAG_REMOVE;
        }
    }
}

static void collisionChargeShotsVsEnemies(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    u8 si;

    for (si = 0; si < chargeShotGetActiveCount(); si++)
    {
        ChargeShot* shot = chargeShotGet(si);
        u8 ei;

        if (shot == NULL)
            continue;

        for (ei = 0; ei < enemyGetActiveCount(); ei++)
        {
            Enemy* enemy = enemyGetByActiveIndex(ei);
            s16 enemyX;
            s16 enemyY;

            if ((enemy == NULL) || (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE)))
                continue;

            enemyX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
            enemyY = (s16)(enemy->y256 >> FIXED_SHIFT);

            if (overlapRadius(
                    (s16)(shot->x256 >> FIXED_SHIFT),
                    (s16)(shot->y256 >> FIXED_SHIFT),
                    enemyX,
                    enemyY,
                    12))
            {
                enemy->pendingDamage += shot->damage;
            }
        }
    }
}

static void collisionCoreVsEnemies(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    const u8 damage = abyssCoreGetDamage();
    const s16 coreX = abyssCoreGetScreenX();
    const s16 coreY = abyssCoreGetScreenY();
    u8 ei;

    if (!abyssCoreCanDamage() || (damage == 0))
        return;

    for (ei = 0; ei < enemyGetActiveCount(); ei++)
    {
        Enemy* enemy = enemyGetByActiveIndex(ei);
        s16 enemyX;
        s16 enemyY;

        if ((enemy == NULL) || (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE)))
            continue;

        enemyX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
        enemyY = (s16)(enemy->y256 >> FIXED_SHIFT);

        if (overlapRadius(coreX, coreY, enemyX, enemyY, 12))
            enemy->pendingDamage += damage;
    }
}


static void collisionPlayerBulletsVsBoss(void)
{
    u8 i;

    if (!bossIsActive())
        return;

    for (i = 0; i < playerBulletGetActiveCount(); i++)
    {
        PlayerBullet* bullet = playerBulletGet(i);

        if ((bullet == NULL) || (bullet->flags & PLAYER_BULLET_FLAG_REMOVE))
            continue;

        if (bossApplyHitAt(
                (s16)(bullet->x256 >> FIXED_SHIFT),
                (s16)(bullet->y256 >> FIXED_SHIFT),
                bullet->damage))
        {
            bullet->flags |= PLAYER_BULLET_FLAG_REMOVE;
        }
    }
}

static void collisionChargeShotsVsBoss(void)
{
    u8 i;

    if (!bossIsActive())
        return;

    for (i = 0; i < chargeShotGetActiveCount(); i++)
    {
        ChargeShot* shot = chargeShotGet(i);

        if (shot == NULL)
            continue;

        bossApplyHitAt(
            (s16)(shot->x256 >> FIXED_SHIFT),
            (s16)(shot->y256 >> FIXED_SHIFT),
            shot->damage);
    }
}

static void collisionCoreVsBoss(void)
{
    const u8 damage = abyssCoreGetDamage();

    if (!bossIsActive() || !abyssCoreCanDamage() || (damage == 0))
        return;

    bossApplyHitAt(
        abyssCoreGetScreenX(),
        abyssCoreGetScreenY(),
        damage);
}

static void collisionPlayerBulletsVsEnemies(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    u8 bi;

    for (bi = 0; bi < playerBulletGetActiveCount(); bi++)
    {
        PlayerBullet* bullet = playerBulletGet(bi);
        u8 ei;

        if (bullet == NULL || (bullet->flags & PLAYER_BULLET_FLAG_REMOVE))
            continue;

        if (recoveryTryHitByNormalShot(
                (s16)(bullet->x256 >> FIXED_SHIFT),
                (s16)(bullet->y256 >> FIXED_SHIFT)))
        {
            bullet->flags |= PLAYER_BULLET_FLAG_REMOVE;
            continue;
        }

        for (ei = 0; ei < enemyGetActiveCount(); ei++)
        {
            Enemy* enemy = enemyGetByActiveIndex(ei);
            s16 enemyScreenX;
            s16 enemyScreenY;

            if (enemy == NULL || (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE)))
                continue;

            enemyScreenX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
            enemyScreenY = (s16)(enemy->y256 >> FIXED_SHIFT);

            if (overlapRadius(
                    (s16)(bullet->x256 >> FIXED_SHIFT),
                    (s16)(bullet->y256 >> FIXED_SHIFT),
                    enemyScreenX,
                    enemyScreenY,
                    8))
            {
                enemy->pendingDamage += bullet->damage;
                bullet->flags |= PLAYER_BULLET_FLAG_REMOVE;
                break;
            }
        }
    }
}

static void collisionPlayerVsEnemyBullets(void)
{
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    u8 i;

    if (!playerCanBeHit() || bombIsActive())
        return;

    for (i = 0; i < enemyBulletGetActiveCount(); i++)
    {
        EnemyBullet* bullet = enemyBulletGet(i);

        if ((bullet == NULL) || (bullet->flags & ENEMY_BULLET_FLAG_REMOVE))
            continue;

        if (overlapRadius(
                playerX,
                playerY,
                (s16)(bullet->x256 >> FIXED_SHIFT),
                (s16)(bullet->y256 >> FIXED_SHIFT),
                6))
        {
            bullet->flags |= ENEMY_BULLET_FLAG_REMOVE;
            playerRequestHit();
            break;
        }
    }
}

static void collisionPlayerVsEnemyBodies(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    u8 i;

    if (!playerCanBeHit() || bombIsActive())
        return;

    if (bossPlayerBodyCollision(playerX, playerY))
    {
        playerRequestHit();
        return;
    }

    for (i = 0; i < enemyGetActiveCount(); i++)
    {
        Enemy* enemy = enemyGetByActiveIndex(i);
        s16 enemyX;
        s16 enemyY;

        if ((enemy == NULL) || (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE)))
            continue;

        enemyX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
        enemyY = (s16)(enemy->y256 >> FIXED_SHIFT);

        if (overlapRadius(playerX, playerY, enemyX, enemyY, 10))
        {
            playerRequestHit();
            break;
        }
    }
}

static void collisionPlayerVsItems(void)
{
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    u8 i;

    for (i = 0; i < itemGetActiveCount(); i++)
    {
        Item* item = itemGet(i);

        if ((item == NULL) || (item->flags & (ITEM_FLAG_COLLECTED | ITEM_FLAG_REMOVE)))
            continue;

        /* pickup box deliberately larger than hurtbox */
        if (overlapRadius(
                playerX,
                playerY,
                (s16)(item->x256 >> FIXED_SHIFT),
                (s16)(item->y256 >> FIXED_SHIFT),
                14))
        {
            item->flags |= ITEM_FLAG_COLLECTED;
        }
    }
}

void collisionRunGameplay(void)
{
    /* Shield must run before Player-vs-bullet. */
    collisionCoreShieldVsEnemyBullets();

    collisionPlayerVsEnemyBullets();
    collisionPlayerVsEnemyBodies();

    collisionPlayerBulletsVsEnemies();
    collisionPlayerBulletsVsBoss();

    collisionChargeShotsVsEnemies();
    collisionChargeShotsVsBoss();

    collisionCoreVsEnemies();
    collisionCoreVsBoss();

    collisionPlayerVsItems();
}
