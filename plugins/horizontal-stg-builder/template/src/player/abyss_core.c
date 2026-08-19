#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "player/abyss_core.h"
#include "player/player.h"
#include "render/renderer.h"

static AbyssCoreController core;

static s16 stepToward(s16 current, s16 target, s16 step)
{
    if (current < target)
    {
        current += step;
        if (current > target) current = target;
    }
    else if (current > target)
    {
        current -= step;
        if (current < target) current = target;
    }

    return current;
}

static void syncMountedPosition(void)
{
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    s16 x = playerX;

    if (core.state == CORE_STATE_MOUNT_FRONT)
        x += 18;
    else if (core.state == CORE_STATE_MOUNT_REAR)
        x -= 18;

    core.x256 = (s32)x * FIXED_ONE;
    core.y256 = (s32)playerY * FIXED_ONE;
}

static void renderCore(void)
{
    if (core.state == CORE_STATE_LOST)
    {
        rendererSetVisible(core.renderHandle, FALSE);
        return;
    }

    rendererSetVisible(core.renderHandle, TRUE);
    rendererSetPosition(
        core.renderHandle,
        (s16)(core.x256 >> FIXED_SHIFT) - 8,
        (s16)(core.y256 >> FIXED_SHIFT) - 4);
}

void abyssCoreInit(void)
{
    core.renderHandle = INVALID_RENDER_HANDLE;
    core.state = CORE_STATE_LOST;
}

void abyssCoreResetForStage(void)
{
    core.renderHandle = rendererAcquire(RENDER_CATEGORY_CORE);
    core.state = CORE_STATE_LOST;
    core.timer = 0;
    core.flags = 0;
    rendererSetVisible(core.renderHandle, FALSE);
}

void abyssCoreAcquireAt(s16 sourceScreenX)
{
    const s16 playerX = playerGetScreenX();

    if (core.state != CORE_STATE_LOST)
        return;

    core.state = (sourceScreenX >= playerX) ?
        CORE_STATE_MOUNT_FRONT :
        CORE_STATE_MOUNT_REAR;

    core.timer = 0;
    syncMountedPosition();
    renderCore();
    gameGetSession()->abyssValue = 1;
}

void abyssCoreLose(void)
{
    core.state = CORE_STATE_LOST;
    core.timer = 0;
    rendererSetVisible(core.renderHandle, FALSE);
    gameGetSession()->abyssValue = 0;
}

void abyssCoreUpdate(u16 pressed)
{
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();

    if ((core.state == CORE_STATE_MOUNT_FRONT) ||
        (core.state == CORE_STATE_MOUNT_REAR))
    {
        syncMountedPosition();

        if (pressed & BUTTON_B)
        {
            core.state = CORE_STATE_LAUNCHING;
            core.vx256 = CORE_LAUNCH_SPEED256;
            core.vy256 = 0;
            core.timer = 0;
        }
    }
    else if (core.state == CORE_STATE_LAUNCHING)
    {
        core.x256 += core.vx256;
        core.timer++;

        if ((core.x256 >> FIXED_SHIFT) >= (playerX + CORE_DETACHED_OFFSET_X))
        {
            core.state = CORE_STATE_DETACHED;
            core.timer = 0;
        }
    }
    else if (core.state == CORE_STATE_DETACHED)
    {
        s16 x = (s16)(core.x256 >> FIXED_SHIFT);
        s16 y = (s16)(core.y256 >> FIXED_SHIFT);
        const s16 targetX = playerX + CORE_DETACHED_OFFSET_X;

        x = stepToward(x, targetX, 1);
        y = stepToward(y, playerY, CORE_FOLLOW_SPEED256 >> FIXED_SHIFT);

        core.x256 = (s32)x * FIXED_ONE;
        core.y256 = (s32)y * FIXED_ONE;
        core.timer++;

        if (pressed & BUTTON_B)
        {
            core.state = CORE_STATE_RETURNING;
            core.timer = 0;
        }
    }
    else if (core.state == CORE_STATE_RETURNING)
    {
        s16 x = (s16)(core.x256 >> FIXED_SHIFT);
        s16 y = (s16)(core.y256 >> FIXED_SHIFT);
        const s16 step = CORE_RETURN_SPEED256 >> FIXED_SHIFT;

        x = stepToward(x, playerX, step);
        y = stepToward(y, playerY, step);

        core.x256 = (s32)x * FIXED_ONE;
        core.y256 = (s32)y * FIXED_ONE;
        core.timer++;

        if ((x >= playerX - 6) && (x <= playerX + 6) &&
            (y >= playerY - 6) && (y <= playerY + 6))
        {
            core.state = (x >= playerX) ?
                CORE_STATE_MOUNT_FRONT :
                CORE_STATE_MOUNT_REAR;
            core.timer = 0;
            syncMountedPosition();
        }
    }

    renderCore();
}

AbyssCoreState abyssCoreGetState(void)
{
    return (AbyssCoreState)core.state;
}

bool abyssCoreIsOwned(void)
{
    return core.state != CORE_STATE_LOST;
}

bool abyssCoreIsShieldActive(void)
{
    return core.state == CORE_STATE_DETACHED;
}

bool abyssCoreCanDamage(void)
{
    return (core.state == CORE_STATE_LAUNCHING) ||
           (core.state == CORE_STATE_DETACHED) ||
           (core.state == CORE_STATE_RETURNING);
}

s16 abyssCoreGetScreenX(void)
{
    return (s16)(core.x256 >> FIXED_SHIFT);
}

s16 abyssCoreGetScreenY(void)
{
    return (s16)(core.y256 >> FIXED_SHIFT);
}

u8 abyssCoreGetDamage(void)
{
    if ((core.state == CORE_STATE_LAUNCHING) ||
        (core.state == CORE_STATE_RETURNING))
        return CORE_LAUNCH_DAMAGE;

    if ((core.state == CORE_STATE_DETACHED) &&
        ((core.timer % CORE_OVERLAP_HIT_INTERVAL) == 0))
        return CORE_OVERLAP_DAMAGE;

    return 0;
}
