#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "enemy/enemy.h"
#include "effect/effect.h"
#include "system/debug.h"
#include "stage/stage_controller.h"
#include "render/renderer.h"
#include "generated/enemy_defs.h"
#include "generated/render_data.h"
#include "bullet/enemy_bullet.h"
#include "player/player.h"

static Enemy enemies[MAX_ENEMIES];
static u8 activeIndices[MAX_ENEMIES];
static u8 freeIndices[MAX_ENEMIES];
static u8 activeCount;
static u8 freeCount;

void enemyInit(void)
{
    enemyReset();
}

void enemyReset(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Enemy* enemy = &enemies[activeIndices[i]];
        if (enemy->renderHandle != INVALID_RENDER_HANDLE)
            rendererRelease(enemy->renderHandle);
    }

    activeCount = 0;
    freeCount = MAX_ENEMIES;

    for (i = 0; i < MAX_ENEMIES; i++)
    {
        freeIndices[i] = (u8)(MAX_ENEMIES - 1 - i);
    }
}

const EnemyDefinition* enemyGetDefinition(EnemyTypeId type)
{
    if (type >= ENEMY_TYPE_COUNT)
        return NULL;

    return &gEnemyDefinitions[type];
}

bool enemySpawn(EnemyTypeId type, s32 x256, s32 y256)
{
    const EnemyDefinition* def = enemyGetDefinition(type);
    Enemy* enemy;
    RenderHandle handle;
    u8 slot;

    if ((def == NULL) || (freeCount == 0))
    {
        debugGetCounters()->enemyOverflow++;
        return FALSE;
    }

    handle = rendererAcquire(RENDER_CATEGORY_ENEMY);
    if (handle == INVALID_RENDER_HANDLE)
    {
        debugGetCounters()->enemyOverflow++;
        return FALSE;
    }

    slot = freeIndices[--freeCount];
    enemy = &enemies[slot];

    enemy->x256 = x256;
    enemy->y256 = y256;
    enemy->vx256 = def->vx256;
    enemy->vy256 = def->vy256;
    enemy->hp = def->hp;
    enemy->pendingDamage = 0;
    enemy->timer = 0;
    enemy->work0 = (s16)(y256 >> FIXED_SHIFT);
    enemy->work1 = def->vy256;
    enemy->type = type;
    enemy->behavior = def->behavior;
    enemy->state = 0;
    enemy->flags = 0;
    enemy->renderHandle = handle;
    rendererSetDefinition(handle, gStgEnemySprites[type]);

    activeIndices[activeCount++] = slot;
    return TRUE;
}

static void updateBehavior(Enemy* enemy, s16 screenX)
{
    switch ((EnemyBehaviorId)enemy->behavior)
    {
        case ENEMY_BEHAVIOR_SINE:
            enemy->x256 += enemy->vx256;
            enemy->y256 += (enemy->timer & 32) ? 64 : -64;
            break;

        case ENEMY_BEHAVIOR_ZIGZAG:
            if ((enemy->timer % 45) == 0)
            {
                if (enemy->vy256 == 0)
                    enemy->vy256 = (enemy->timer & 64) ? 192 : -192;
                else
                    enemy->vy256 = -enemy->vy256;
            }
            enemy->x256 += enemy->vx256;
            enemy->y256 += enemy->vy256;
            break;

        case ENEMY_BEHAVIOR_HOVER:
            if (screenX > 244)
                enemy->x256 += enemy->vx256;
            enemy->y256 += (enemy->timer & 48) < 24 ? -48 : 48;
            break;

        case ENEMY_BEHAVIOR_DIVE:
            if (enemy->timer == 30)
            {
                enemy->vx256 -= 128;
                enemy->vy256 = (playerGetScreenY() >= (enemy->y256 >> FIXED_SHIFT)) ? 224 : -224;
            }
            enemy->x256 += enemy->vx256;
            enemy->y256 += enemy->vy256;
            break;

        case ENEMY_BEHAVIOR_ANCHOR:
            if (screenX > 268)
                enemy->x256 += enemy->vx256;
            break;

        case ENEMY_BEHAVIOR_STRAIGHT:
        default:
            enemy->x256 += enemy->vx256;
            enemy->y256 += enemy->vy256;
            break;
    }

    if ((enemy->y256 >> FIXED_SHIFT) < (GAMEPLAY_TOP_PX + 8))
    {
        enemy->y256 = (GAMEPLAY_TOP_PX + 8) * FIXED_ONE;
        enemy->vy256 = (enemy->vy256 < 0) ? -enemy->vy256 : enemy->vy256;
    }
    else if ((enemy->y256 >> FIXED_SHIFT) > (SCREEN_HEIGHT - 8))
    {
        enemy->y256 = (SCREEN_HEIGHT - 8) * FIXED_ONE;
        enemy->vy256 = (enemy->vy256 > 0) ? -enemy->vy256 : enemy->vy256;
    }
}

void enemyUpdateAll(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Enemy* enemy = &enemies[activeIndices[i]];
        s16 screenX;
        s16 screenY;

        if (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE))
            continue;

        enemy->timer++;

        screenX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
        updateBehavior(enemy, screenX);

        screenX = (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT);
        screenY = (s16)(enemy->y256 >> FIXED_SHIFT);

        rendererSetPosition(enemy->renderHandle, screenX - 12, screenY - 8);

        {
            const EnemyDefinition* def = enemyGetDefinition(enemy->type);

            if ((def != NULL) &&
                (def->firePattern != ENEMY_FIRE_NONE) &&
                (def->fireInterval > 0) &&
                (screenX >= 0) && (screenX < SCREEN_WIDTH) &&
                ((enemy->timer % def->fireInterval) == 0))
            {
                const u16 shotIndex = (u16)(enemy->timer / def->fireInterval);
                const u8 volleyCount = gameGetEnemyShotCount(shotIndex);
                const s16 bulletSpeed = gameScaleEnemyBulletSpeed(2 * FIXED_ONE);
                u8 volley;

                for (volley = 0; volley < volleyCount; volley++)
                {
                    const s16 spawnY = screenY + (s16)(volley * 8);
                    if (def->firePattern == ENEMY_FIRE_AIMED)
                    {
                        enemyBulletSpawnAimed(
                            screenX - 8,
                            spawnY,
                            playerGetScreenX(),
                            playerGetScreenY() + (s16)(volley * 12),
                            bulletSpeed,
                            1);
                    }
                    else if (def->firePattern == ENEMY_FIRE_SPREAD)
                    {
                        enemyBulletSpawnSpreadLeft(
                            screenX - 8,
                            spawnY,
                            bulletSpeed,
                            1);
                    }
                    else
                    {
                        switch (shotIndex % 3)
                        {
                            case 1:
                                enemyBulletSpawnAimed(screenX - 8, spawnY, playerGetScreenX(), playerGetScreenY(), bulletSpeed, 1);
                                break;
                            case 2:
                                enemyBulletSpawnSpreadLeft(screenX - 8, spawnY, bulletSpeed, 1);
                                break;
                            case 0:
                            default:
                                enemyBulletSpawnStraight(
                                    screenX - 8,
                                    spawnY,
                                    gameScaleEnemyBulletSpeed(ENEMY_BULLET_SPEED256),
                                    0,
                                    1);
                                break;
                        }
                    }
                }
            }
        }

        if (screenX < -32)
        {
            enemy->flags |= ENEMY_FLAG_REMOVE;
        }
    }
}


void enemyApplyBombTestDamage(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Enemy* enemy = &enemies[activeIndices[i]];

        if (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE))
            continue;

        /* Current Vertical Slice enemies are all classified as small. */
        enemy->pendingDamage += BOMB_SMALL_ENEMY_DAMAGE;
    }
}

void enemyResolveDamage(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Enemy* enemy = &enemies[activeIndices[i]];

        if (enemy->pendingDamage == 0)
            continue;

        enemy->hp -= (s16)enemy->pendingDamage;
        enemy->pendingDamage = 0;

        if (enemy->hp <= 0)
        {
            enemy->flags |= ENEMY_FLAG_DEAD;
        }
    }
}

void enemyCleanup(void)
{
    const s32 cameraX256 = stageGetCameraX256();
    u8 i = 0;

    while (i < activeCount)
    {
        const u8 slot = activeIndices[i];
        Enemy* enemy = &enemies[slot];

        if (enemy->flags & (ENEMY_FLAG_DEAD | ENEMY_FLAG_REMOVE))
        {
            if (enemy->flags & ENEMY_FLAG_DEAD)
            {
                const EnemyDefinition* def = enemyGetDefinition(enemy->type);

                if (def != NULL)
                    gameAddScore(def->score);

                effectSpawnExplosion(
                    (s16)((enemy->x256 - cameraX256) >> FIXED_SHIFT),
                    (s16)(enemy->y256 >> FIXED_SHIFT));
            }

            rendererRelease(enemy->renderHandle);

            activeIndices[i] = activeIndices[activeCount - 1];
            activeCount--;

            freeIndices[freeCount++] = slot;
        }
        else
        {
            i++;
        }
    }
}

u8 enemyGetActiveCount(void)
{
    return activeCount;
}

Enemy* enemyGetByActiveIndex(u8 index)
{
    if (index >= activeCount) return NULL;
    return &enemies[activeIndices[index]];
}
