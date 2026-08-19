#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "enemy/boss.h"
#include "bullet/enemy_bullet.h"
#include "player/player.h"
#include "render/renderer.h"
#include "stage/stage_controller.h"
#include "generated/boss_defs.h"
#include "generated/render_data.h"

static BossController boss;

static const s16 partOffsetX[MAX_BOSS_PARTS] = { -18, 18, 0 };
static const s16 partOffsetY[MAX_BOSS_PARTS] = { -12, -12, 12 };

const BossDefinition* bossGetDefinition(u8 bossId)
{
    if (bossId >= BOSS_TYPE_COUNT)
        return NULL;

    return &gBossDefinitions[bossId];
}

static void hideParts(void)
{
    u8 i;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        if (boss.parts[i].renderHandle != INVALID_RENDER_HANDLE)
            rendererSetVisible(boss.parts[i].renderHandle, FALSE);
    }
}

static void releaseParts(void)
{
    u8 i;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        if (boss.parts[i].renderHandle != INVALID_RENDER_HANDLE)
        {
            rendererRelease(boss.parts[i].renderHandle);
            boss.parts[i].renderHandle = INVALID_RENDER_HANDLE;
        }
    }
}

static void updatePartRender(void)
{
    const s16 bossX = (s16)(boss.x256 >> FIXED_SHIFT);
    const s16 bossY = (s16)(boss.y256 >> FIXED_SHIFT);
    u8 i;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        BossPart* part = &boss.parts[i];

        if (part->renderHandle == INVALID_RENDER_HANDLE)
            continue;

        if (part->flags & BOSS_PART_DESTROYED)
        {
            rendererSetVisible(part->renderHandle, FALSE);
            continue;
        }

        rendererSetVisible(part->renderHandle, TRUE);
        rendererSetPosition(
            part->renderHandle,
            bossX + part->offsetX - 16,
            bossY + part->offsetY - 16);
    }
}

void bossInit(void)
{
    u8 i;

    boss.state = BOSS_STATE_INACTIVE;
    boss.phase = 0;
    boss.flags = 0;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
        boss.parts[i].renderHandle = INVALID_RENDER_HANDLE;
}

void bossResetForStage(void)
{
    releaseParts();
    boss.state = BOSS_STATE_INACTIVE;
    boss.phase = 0;
    boss.phaseTimer = 0;
    boss.attackTimer = 0;
}

bool bossStart(u8 bossId)
{
    const BossDefinition* def = bossGetDefinition(bossId);
    u8 i;

    if ((def == NULL) || bossIsActive())
        return FALSE;

    if (boss.state == BOSS_STATE_DEFEATED)
    {
        releaseParts();
        boss.state = BOSS_STATE_INACTIVE;
    }

    boss.bossId = bossId;
    boss.x256 = (s32)def->entryX * FIXED_ONE;
    boss.y256 = (s32)def->y * FIXED_ONE;
    boss.phaseTimer = 0;
    boss.attackTimer = 0;
    boss.state = BOSS_STATE_ENTRY;
    boss.phase = 0;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        BossPart* part = &boss.parts[i];

        part->offsetX = partOffsetX[i];
        part->offsetY = partOffsetY[i];
        part->pendingDamage = 0;
        part->flags = BOSS_PART_DAMAGEABLE |
                      BOSS_PART_DESTRUCTIBLE |
                      BOSS_PART_HAZARDOUS;
        if ((i == 2) && (def->forms > 1))
            part->flags &= (u8)~BOSS_PART_DAMAGEABLE;

        part->hp = def->partHp[i];
        part->renderHandle = rendererAcquire(RENDER_CATEGORY_BOSS);
        rendererSetDefinition(part->renderHandle, gStgBossSprites[bossId]);

        if (part->renderHandle == INVALID_RENDER_HANDLE)
        {
            releaseParts();
            boss.state = BOSS_STATE_INACTIVE;
            return FALSE;
        }
    }

    updatePartRender();
    return TRUE;
}

static s16 triangleOffset(u32 timer, u16 period, s16 amplitude)
{
    const u16 half = period / 2;
    u16 position = (u16)(timer % period);
    if (position >= half)
        position = period - position;
    return (s16)(((s32)position * amplitude * 2) / half) - amplitude;
}

static void updateActiveMovement(const BossDefinition* def)
{
    const s16 amplitude = (boss.phase > 0) ? 30 : 20;

    switch ((BossMovementId)def->movement)
    {
        case BOSS_MOVE_WAVE:
            boss.y256 = (s32)(def->y + triangleOffset(boss.phaseTimer, 120, amplitude)) * FIXED_ONE;
            break;
        case BOSS_MOVE_DASH:
            boss.x256 = (s32)(def->activeX + triangleOffset(boss.phaseTimer, 180, amplitude)) * FIXED_ONE;
            break;
        case BOSS_MOVE_ORBIT:
            boss.x256 = (s32)(def->activeX + triangleOffset(boss.phaseTimer, 160, amplitude)) * FIXED_ONE;
            boss.y256 = (s32)(def->y + triangleOffset(boss.phaseTimer + 40, 160, amplitude)) * FIXED_ONE;
            break;
        case BOSS_MOVE_HUNT:
        {
            s16 y = (s16)(boss.y256 >> FIXED_SHIFT);
            const s16 target = playerGetScreenY();
            if (y < target) y++;
            else if (y > target) y--;
            if (y < 40) y = 40;
            if (y > 200) y = 200;
            boss.y256 = (s32)y * FIXED_ONE;
            break;
        }
        case BOSS_MOVE_SPIRAL:
            boss.x256 = (s32)(def->activeX + triangleOffset(boss.phaseTimer, 144, amplitude)) * FIXED_ONE;
            boss.y256 = (s32)(def->y + triangleOffset(boss.phaseTimer + 36, 96, amplitude)) * FIXED_ONE;
            break;
        case BOSS_MOVE_ANCHOR:
        case BOSS_MOVE_STATIONARY:
        default:
            break;
    }
}

static void fireBossPattern(const BossDefinition* def, s16 x, s16 y, u16 attackIndex, u8 volley)
{
    const s16 speed = gameScaleEnemyBulletSpeed(2 * FIXED_ONE);
    const s16 spawnY = y + (s16)(volley * 8);
    const s16 targetY = playerGetScreenY() + (s16)(volley * 12);

    switch ((BossFirePatternId)def->firePattern)
    {
        case BOSS_FIRE_FAN:
        case BOSS_FIRE_WEB:
            enemyBulletSpawnSpreadLeft(x, spawnY, speed, 1);
            if (def->firePattern == BOSS_FIRE_WEB)
                enemyBulletSpawnAimed(x, spawnY, playerGetScreenX(), targetY, speed, 1);
            break;
        case BOSS_FIRE_WALL:
            enemyBulletSpawnStraight(x, spawnY - 24, (s16)-speed, 0, 1);
            enemyBulletSpawnStraight(x, spawnY, (s16)-speed, 0, 1);
            enemyBulletSpawnStraight(x, spawnY + 24, (s16)-speed, 0, 1);
            break;
        case BOSS_FIRE_SPIRAL:
            enemyBulletSpawnStraight(x, spawnY, (s16)-speed, (s16)(((s16)(attackIndex % 5) - 2) * (speed / 3)), 1);
            break;
        case BOSS_FIRE_LANCE:
            enemyBulletSpawnStraightUnblockable(x, spawnY, (s16)-speed, 0, 1);
            break;
        case BOSS_FIRE_LURE:
            enemyBulletSpawnAimed(x, spawnY, playerGetScreenX(), targetY, speed, 1);
            if ((attackIndex % 4) == 0)
                enemyBulletSpawnStraightUnblockable(x, spawnY - 12, (s16)-speed, 0, 1);
            break;
        case BOSS_FIRE_CROSS:
            enemyBulletSpawnStraight(x, spawnY, (s16)-speed, 0, 1);
            enemyBulletSpawnStraight(x, spawnY, (s16)-speed, (s16)(speed / 2), 1);
            enemyBulletSpawnStraight(x, spawnY, (s16)-speed, (s16)-(speed / 2), 1);
            break;
        case BOSS_FIRE_CORE:
            enemyBulletSpawnSpreadLeft(x, spawnY, speed, 1);
            if (boss.phase > 0)
            {
                enemyBulletSpawnAimed(x, spawnY, playerGetScreenX(), targetY, speed, 1);
                if ((attackIndex & 1) == 0)
                    enemyBulletSpawnStraightUnblockable(x, spawnY, (s16)-speed, 0, 1);
            }
            break;
        case BOSS_FIRE_AIMED:
        default:
            enemyBulletSpawnAimed(x, spawnY, playerGetScreenX(), targetY, speed, 1);
            break;
    }
}

void bossUpdate(void)
{
    const BossDefinition* def = bossGetDefinition(boss.bossId);

    if ((def == NULL) ||
        boss.state == BOSS_STATE_INACTIVE ||
        boss.state == BOSS_STATE_DEFEATED)
        return;

    if (boss.state == BOSS_STATE_ENTRY)
    {
        boss.x256 += def->entryVx256;

        if ((boss.x256 >> FIXED_SHIFT) <= def->activeX)
        {
            boss.x256 = (s32)def->activeX * FIXED_ONE;
            boss.state = BOSS_STATE_ACTIVE;
            boss.phaseTimer = 0;
            boss.attackTimer = 0;
        }
    }
    else if (boss.state == BOSS_STATE_ACTIVE)
    {
        boss.phaseTimer++;
        boss.attackTimer++;
        updateActiveMovement(def);

        if ((def->fireInterval > 0) && ((boss.attackTimer % def->fireInterval) == 0))
        {
            const s16 x = (s16)(boss.x256 >> FIXED_SHIFT) - 16;
            const s16 y = (s16)(boss.y256 >> FIXED_SHIFT);
            const u16 attackIndex = (u16)(boss.attackTimer / def->fireInterval);
            const u8 volleyCount = gameGetEnemyShotCount(attackIndex);
            u8 volley;

            for (volley = 0; volley < volleyCount; volley++)
                fireBossPattern(def, x, y, attackIndex, volley);
        }
    }
    else if (boss.state == BOSS_STATE_DYING)
    {
        boss.phaseTimer++;

        if (boss.phaseTimer >= def->deathFrames)
        {
            gameAddScore(def->score);
            hideParts();
            releaseParts();
            boss.state = BOSS_STATE_DEFEATED;
        }
    }

    updatePartRender();
}

void bossResolveDamage(void)
{
    const BossDefinition* def = bossGetDefinition(boss.bossId);
    u8 i;

    if ((def == NULL) || (boss.state != BOSS_STATE_ACTIVE))
        return;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        BossPart* part = &boss.parts[i];

        if ((part->flags & BOSS_PART_DESTROYED) ||
            (part->pendingDamage == 0))
            continue;

        part->hp -= (s16)part->pendingDamage;
        part->pendingDamage = 0;

        if (part->hp <= 0)
        {
            part->hp = 0;
            part->flags |= BOSS_PART_DESTROYED;
        }
    }

    if ((boss.parts[0].flags & BOSS_PART_DESTROYED) &&
        (boss.parts[1].flags & BOSS_PART_DESTROYED))
    {
        if (boss.phase == 0)
        {
            boss.phase = 1;
            boss.phaseTimer = 0;
            if (def->forms > 1)
                boss.parts[2].flags |= BOSS_PART_DAMAGEABLE;
        }
    }

    if (boss.parts[2].flags & BOSS_PART_DESTROYED)
    {
        boss.state = BOSS_STATE_DYING;
        boss.phaseTimer = 0;
    }
}

bool bossApplyHitAt(s16 x, s16 y, u8 damage)
{
    const s16 bossX = (s16)(boss.x256 >> FIXED_SHIFT);
    const s16 bossY = (s16)(boss.y256 >> FIXED_SHIFT);
    u8 i;

    if (boss.state != BOSS_STATE_ACTIVE)
        return FALSE;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        BossPart* part = &boss.parts[i];
        const s16 px = bossX + part->offsetX;
        const s16 py = bossY + part->offsetY;
        const s16 dx = x - px;
        const s16 dy = y - py;

        if ((part->flags & BOSS_PART_DESTROYED) ||
            !(part->flags & BOSS_PART_DAMAGEABLE))
            continue;

        if ((dx > -12) && (dx < 12) &&
            (dy > -12) && (dy < 12))
        {
            part->pendingDamage += damage;
            return TRUE;
        }
    }

    return FALSE;
}

bool bossPlayerBodyCollision(s16 x, s16 y)
{
    const s16 bossX = (s16)(boss.x256 >> FIXED_SHIFT);
    const s16 bossY = (s16)(boss.y256 >> FIXED_SHIFT);
    u8 i;

    if (boss.state != BOSS_STATE_ACTIVE)
        return FALSE;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        const BossPart* part = &boss.parts[i];
        const s16 dx = x - (bossX + part->offsetX);
        const s16 dy = y - (bossY + part->offsetY);

        if ((part->flags & BOSS_PART_DESTROYED) ||
            !(part->flags & BOSS_PART_HAZARDOUS))
            continue;

        if ((dx > -12) && (dx < 12) &&
            (dy > -12) && (dy < 12))
            return TRUE;
    }

    return FALSE;
}

void bossApplyBombTestDamage(void)
{
    u8 i;

    if (boss.state != BOSS_STATE_ACTIVE)
        return;

    for (i = 0; i < MAX_BOSS_PARTS; i++)
    {
        BossPart* part = &boss.parts[i];

        if ((part->flags & BOSS_PART_DESTROYED) ||
            !(part->flags & BOSS_PART_DAMAGEABLE))
            continue;

        part->pendingDamage += bossGetDefinition(boss.bossId)->bombFixedDamage;
    }
}

bool bossIsActive(void)
{
    return (boss.state == BOSS_STATE_ENTRY) ||
           (boss.state == BOSS_STATE_ACTIVE) ||
           (boss.state == BOSS_STATE_DYING);
}

bool bossIsDefeated(void)
{
    return boss.state == BOSS_STATE_DEFEATED;
}

BossState bossGetState(void)
{
    return (BossState)boss.state;
}

u8 bossGetId(void)
{
    return boss.bossId;
}
