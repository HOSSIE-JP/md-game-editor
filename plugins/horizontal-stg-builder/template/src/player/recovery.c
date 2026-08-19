#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "player/recovery.h"
#include "render/renderer.h"

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;

    u8 itemType;
    u8 state;
    u8 renderHandle;
} RecoveryCarrier;

enum
{
    RECOVERY_CARRIER_WAITING = 0,
    RECOVERY_CARRIER_ACTIVE,
    RECOVERY_CARRIER_DONE
};

static RecoveryCarrier carriers[2];
static bool sequenceActive;
static u16 sequenceTimer;

static ItemType chooseSecondRecoveryItem(void)
{
    const GameSession* session = gameGetSession();

    if (session->weaponLevel < WEAPON_LEVEL_MAX)
        return ITEM_POWER;

    if (session->speedLevel < SPEED_LEVEL_MAX)
        return ITEM_SPEED;

    return ITEM_BOMB;
}

static void releaseCarrier(RecoveryCarrier* carrier)
{
    if (carrier->renderHandle != INVALID_RENDER_HANDLE)
    {
        rendererRelease(carrier->renderHandle);
        carrier->renderHandle = INVALID_RENDER_HANDLE;
    }

    carrier->state = RECOVERY_CARRIER_DONE;
}

static void spawnCarrier(u8 index, ItemType itemType, s16 y)
{
    RecoveryCarrier* carrier = &carriers[index];

    if (carrier->state != RECOVERY_CARRIER_WAITING)
        return;

    carrier->renderHandle = rendererAcquire(RENDER_CATEGORY_RECOVERY);
    if (carrier->renderHandle == INVALID_RENDER_HANDLE)
    {
        carrier->state = RECOVERY_CARRIER_DONE;
        return;
    }

    carrier->x256 = (s32)(SCREEN_WIDTH + 16) * FIXED_ONE;
    carrier->y256 = (s32)y * FIXED_ONE;
    carrier->vx256 = RECOVERY_CARRIER_VX256;
    carrier->itemType = (u8)itemType;
    carrier->state = RECOVERY_CARRIER_ACTIVE;

    rendererSetPosition(
        carrier->renderHandle,
        (s16)(carrier->x256 >> FIXED_SHIFT) - 8,
        y - 8);
}

void recoveryInit(void)
{
    recoveryResetForStage();
}

void recoveryResetForStage(void)
{
    u8 i;

    for (i = 0; i < 2; i++)
    {
        if (carriers[i].renderHandle != INVALID_RENDER_HANDLE)
            rendererRelease(carriers[i].renderHandle);

        carriers[i].renderHandle = INVALID_RENDER_HANDLE;
        carriers[i].state = RECOVERY_CARRIER_DONE;
    }

    sequenceActive = FALSE;
    sequenceTimer = 0;
}

void recoveryOnPlayerDeath(void)
{
    u8 i;

    for (i = 0; i < 2; i++)
    {
        if (carriers[i].renderHandle != INVALID_RENDER_HANDLE)
            rendererRelease(carriers[i].renderHandle);

        carriers[i].renderHandle = INVALID_RENDER_HANDLE;
        carriers[i].state = RECOVERY_CARRIER_WAITING;
    }

    sequenceActive = TRUE;
    sequenceTimer = 0;
}

void recoveryUpdate(void)
{
    u8 i;

    if (!sequenceActive)
        return;

    sequenceTimer++;

    if (sequenceTimer == RECOVERY_FIRST_DELAY)
        spawnCarrier(0, ITEM_ABYSS_CORE, 72);

    if (sequenceTimer == RECOVERY_SECOND_DELAY)
        spawnCarrier(1, chooseSecondRecoveryItem(), 152);

    for (i = 0; i < 2; i++)
    {
        RecoveryCarrier* carrier = &carriers[i];

        if (carrier->state != RECOVERY_CARRIER_ACTIVE)
            continue;

        carrier->x256 += carrier->vx256;

        rendererSetPosition(
            carrier->renderHandle,
            (s16)(carrier->x256 >> FIXED_SHIFT) - 8,
            (s16)(carrier->y256 >> FIXED_SHIFT) - 8);

        if ((carrier->x256 >> FIXED_SHIFT) < -16)
            releaseCarrier(carrier);
    }

    if ((sequenceTimer > RECOVERY_SECOND_DELAY) &&
        (carriers[0].state == RECOVERY_CARRIER_DONE) &&
        (carriers[1].state == RECOVERY_CARRIER_DONE))
    {
        sequenceActive = FALSE;
    }
}

bool recoveryTryHitByNormalShot(s16 x, s16 y)
{
    u8 i;

    for (i = 0; i < 2; i++)
    {
        RecoveryCarrier* carrier = &carriers[i];
        s16 cx;
        s16 cy;
        s16 dx;
        s16 dy;

        if (carrier->state != RECOVERY_CARRIER_ACTIVE)
            continue;

        cx = (s16)(carrier->x256 >> FIXED_SHIFT);
        cy = (s16)(carrier->y256 >> FIXED_SHIFT);
        dx = x - cx;
        dy = y - cy;

        if ((dx > -10) && (dx < 10) &&
            (dy > -10) && (dy < 10))
        {
            itemSpawn((ItemType)carrier->itemType, cx, cy);
            releaseCarrier(carrier);
            return TRUE;
        }
    }

    return FALSE;
}
