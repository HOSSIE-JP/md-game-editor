#include <genesis.h>
#include "game/config.h"
#include "player/charge_shot.h"
#include "player/player.h"
#include "player/abyss_core.h"

enum
{
    CHARGE_SHOT_FLAG_REMOVE = 1 << 0
};

static ChargeShot shots[MAX_CHARGE_SHOTS];
static u8 shotCount;

static u16 chargeFrames;
static u8 chargeState;
static u16 savedFrames;
static bool savedForBomb;

static bool spawnShot(s16 x, s16 y, s16 vx256, u8 damage, u8 level)
{
    ChargeShot* shot;

    if (shotCount >= MAX_CHARGE_SHOTS)
        return FALSE;

    shot = &shots[shotCount++];
    shot->x256 = (s32)x * FIXED_ONE;
    shot->y256 = (s32)y * FIXED_ONE;
    shot->vx256 = vx256;
    shot->vy256 = 0;
    shot->timer = 0;
    shot->damage = damage;
    shot->level = level;
    shot->flags = 0;

    return TRUE;
}

static u8 baseDamageForLevel(ChargeLevel level)
{
    return (level == CHARGE_LEVEL_MAX) ?
        CHARGE_MAX_DAMAGE :
        CHARGE_MID_DAMAGE;
}

static void fireCharge(ChargeLevel level)
{
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    const AbyssCoreState coreState = abyssCoreGetState();
    u8 damage = baseDamageForLevel(level);

    if (coreState == CORE_STATE_LOST)
    {
        damage = (u8)(((u16)damage * 3) / 4);
        spawnShot(playerX + 12, playerY, CHARGE_SPEED256, damage, (u8)level);
        return;
    }

    if (coreState == CORE_STATE_MOUNT_REAR)
    {
        spawnShot(playerX + 12, playerY, CHARGE_SPEED256, damage, (u8)level);
        spawnShot(
            abyssCoreGetScreenX() - 8,
            abyssCoreGetScreenY(),
            (s16)-CHARGE_SPEED256,
            damage,
            (u8)level);
        return;
    }

    if ((coreState == CORE_STATE_DETACHED) ||
        (coreState == CORE_STATE_LAUNCHING) ||
        (coreState == CORE_STATE_RETURNING))
    {
        spawnShot(playerX + 12, playerY, CHARGE_SPEED256, damage, (u8)level);
        spawnShot(
            abyssCoreGetScreenX() + 8,
            abyssCoreGetScreenY(),
            CHARGE_SPEED256,
            damage,
            (u8)level);
        return;
    }

    /* Front mount: one forward-focused shot. */
    spawnShot(playerX + 12, playerY, CHARGE_SPEED256, damage, (u8)level);
}

void chargeInit(void)
{
    shotCount = 0;
    chargeFrames = 0;
    chargeState = CHARGE_STATE_IDLE;
    savedFrames = 0;
    savedForBomb = FALSE;
}

void chargeReset(void)
{
    shotCount = 0;
    chargeFrames = 0;
    chargeState = CHARGE_STATE_IDLE;
    savedFrames = 0;
    savedForBomb = FALSE;
}

void chargeUpdate(u16 pressed, u16 held, u16 released)
{
    if (!playerCanShoot())
    {
        if (chargeState != CHARGE_STATE_IDLE)
        {
            chargeFrames = 0;
            chargeState = CHARGE_STATE_IDLE;
        }
        return;
    }

    if (pressed & BUTTON_A)
    {
        chargeFrames = 0;
        chargeState = CHARGE_STATE_CHARGING;
    }

    if ((held & BUTTON_A) &&
        ((chargeState == CHARGE_STATE_CHARGING) ||
         (chargeState == CHARGE_STATE_HOLD_MAX)))
    {
        if (chargeFrames < CHARGE_MAX_FRAMES)
            chargeFrames++;

        if (chargeFrames >= CHARGE_MAX_FRAMES)
        {
            chargeFrames = CHARGE_MAX_FRAMES;
            chargeState = CHARGE_STATE_HOLD_MAX;
        }
    }

    if ((released & BUTTON_A) &&
        ((chargeState == CHARGE_STATE_CHARGING) ||
         (chargeState == CHARGE_STATE_HOLD_MAX)))
    {
        if (chargeFrames >= CHARGE_MAX_FRAMES)
            fireCharge(CHARGE_LEVEL_MAX);
        else if (chargeFrames >= CHARGE_MID_FRAMES)
            fireCharge(CHARGE_LEVEL_MID);

        chargeFrames = 0;
        chargeState = CHARGE_STATE_IDLE;
    }
}


void chargePauseForBomb(void)
{
    if ((chargeState == CHARGE_STATE_CHARGING) ||
        (chargeState == CHARGE_STATE_HOLD_MAX))
    {
        savedFrames = chargeFrames;
        savedForBomb = TRUE;
        chargeState = CHARGE_STATE_PAUSED;
    }
}

void chargeResumeAfterBomb(bool aHeld)
{
    ChargeLevel level = CHARGE_LEVEL_NONE;

    if (!savedForBomb)
        return;

    chargeFrames = savedFrames;
    savedFrames = 0;
    savedForBomb = FALSE;

    if (aHeld)
    {
        chargeState = (chargeFrames >= CHARGE_MAX_FRAMES) ?
            CHARGE_STATE_HOLD_MAX :
            CHARGE_STATE_CHARGING;
        return;
    }

    if (chargeFrames >= CHARGE_MAX_FRAMES)
        level = CHARGE_LEVEL_MAX;
    else if (chargeFrames >= CHARGE_MID_FRAMES)
        level = CHARGE_LEVEL_MID;

    if (level != CHARGE_LEVEL_NONE)
        fireCharge(level);

    chargeFrames = 0;
    chargeState = CHARGE_STATE_IDLE;
}

ChargeState chargeGetState(void)
{
    return (ChargeState)chargeState;
}

u16 chargeGetFrames(void)
{
    return chargeFrames;
}

void chargeShotUpdateAll(void)
{
    u8 i;

    for (i = 0; i < shotCount; i++)
    {
        ChargeShot* shot = &shots[i];

        shot->x256 += shot->vx256;
        shot->y256 += shot->vy256;
        shot->timer++;

        if (((shot->x256 >> FIXED_SHIFT) < -24) ||
            ((shot->x256 >> FIXED_SHIFT) > SCREEN_WIDTH + 24))
        {
            shot->flags |= CHARGE_SHOT_FLAG_REMOVE;
        }
    }
}

void chargeShotCleanup(void)
{
    u8 i = 0;

    while (i < shotCount)
    {
        if (shots[i].flags & CHARGE_SHOT_FLAG_REMOVE)
        {
            shots[i] = shots[shotCount - 1];
            shotCount--;
        }
        else
        {
            i++;
        }
    }
}

u8 chargeShotGetActiveCount(void)
{
    return shotCount;
}

ChargeShot* chargeShotGet(u8 index)
{
    if (index >= shotCount)
        return NULL;

    return &shots[index];
}
