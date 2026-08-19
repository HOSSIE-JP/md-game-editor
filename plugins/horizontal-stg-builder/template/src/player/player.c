#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "player/player.h"
#include "render/renderer.h"

static Player player;

static s32 clamp256(s32 value, s32 minValue, s32 maxValue)
{
    if (value < minValue) return minValue;
    if (value > maxValue) return maxValue;
    return value;
}

static void placeAtRespawn(void)
{
    player.x256 = PLAYER_START_X * FIXED_ONE;
    player.y256 = PLAYER_START_Y * FIXED_ONE;
    rendererSetPosition(
        player.renderHandle,
        (s16)(player.x256 >> FIXED_SHIFT) - 12,
        (s16)(player.y256 >> FIXED_SHIFT) - 8);
}

void playerInit(void)
{
    player.renderHandle = INVALID_RENDER_HANDLE;
    player.state = PLAYER_STATE_ACTIVE;
    player.flags = 0;
}

void playerResetForStage(void)
{
    player.vx256 = 0;
    player.vy256 = 0;
    player.stateTimer = 0;
    player.invincibleTimer = 0;
    player.state = PLAYER_STATE_ACTIVE;
    player.flags = 0;
    player.weaponColor = 0;
    player.weaponLevel = 1;

    player.renderHandle = rendererAcquire(RENDER_CATEGORY_PLAYER);
    placeAtRespawn();
    rendererSetVisible(player.renderHandle, TRUE);
}

bool playerCanShoot(void)
{
    return (player.state == PLAYER_STATE_ACTIVE) ||
           (player.state == PLAYER_STATE_INVINCIBLE);
}

bool playerCanBeHit(void)
{
    return (player.state == PLAYER_STATE_ACTIVE) &&
           !(player.flags & PLAYER_FLAG_PENDING_HIT);
}

void playerRequestHit(void)
{
    if (playerCanBeHit())
        player.flags |= PLAYER_FLAG_PENDING_HIT;
}

void playerResolvePendingHit(void)
{
    if (!(player.flags & PLAYER_FLAG_PENDING_HIT))
        return;

    player.flags &= (u8)~PLAYER_FLAG_PENDING_HIT;
    player.state = PLAYER_STATE_HIT;
    player.stateTimer = PLAYER_HIT_FRAMES;
    player.invincibleTimer = 0;
    rendererSetVisible(player.renderHandle, FALSE);
    gameConsumeLife();
}

void playerUpdate(const InputState* input)
{
    s16 dx = 0;
    s16 dy = 0;
    s16 moveSpeed = PLAYER_SPEED_LV1_256;

    switch (gameGetSpeedLevel())
    {
        case 3:
            moveSpeed = PLAYER_SPEED_LV3_256;
            break;
        case 2:
            moveSpeed = PLAYER_SPEED_LV2_256;
            break;
        case 1:
        default:
            moveSpeed = PLAYER_SPEED_LV1_256;
            break;
    }

    if (player.state == PLAYER_STATE_HIT)
    {
        if (player.stateTimer > 0)
            player.stateTimer--;

        if (player.stateTimer == 0)
        {
            if (gameGetLives() == 0)
            {
                player.state = PLAYER_STATE_GAME_OVER;
                gameRequestState(GAME_STATE_CONTINUE);
            }
            else
            {
                placeAtRespawn();
                player.state = PLAYER_STATE_INVINCIBLE;
                player.invincibleTimer = PLAYER_INVINCIBLE_FRAMES;
                rendererSetVisible(player.renderHandle, TRUE);
            }
        }
        return;
    }

    if (player.state == PLAYER_STATE_INVINCIBLE)
    {
        if (player.invincibleTimer > 0)
            player.invincibleTimer--;

        rendererSetVisible(player.renderHandle, (player.invincibleTimer & 4) != 0);

        if (player.invincibleTimer == 0)
        {
            player.state = PLAYER_STATE_ACTIVE;
            rendererSetVisible(player.renderHandle, TRUE);
        }
    }

    if ((player.state != PLAYER_STATE_ACTIVE) &&
        (player.state != PLAYER_STATE_INVINCIBLE))
        return;

    if (input->held & BUTTON_LEFT)  dx -= moveSpeed;
    if (input->held & BUTTON_RIGHT) dx += moveSpeed;
    if (input->held & BUTTON_UP)    dy -= moveSpeed;
    if (input->held & BUTTON_DOWN)  dy += moveSpeed;

    player.vx256 = dx;
    player.vy256 = dy;

    player.x256 += dx;
    player.y256 += dy;

    player.x256 = clamp256(player.x256, 12 * FIXED_ONE, (SCREEN_WIDTH - 12) * FIXED_ONE);
    player.y256 = clamp256(
        player.y256,
        (GAMEPLAY_TOP_PX + 8) * FIXED_ONE,
        (SCREEN_HEIGHT - 8) * FIXED_ONE);

    rendererSetPosition(
        player.renderHandle,
        (s16)(player.x256 >> FIXED_SHIFT) - 12,
        (s16)(player.y256 >> FIXED_SHIFT) - 8);
}

const Player* playerGet(void)
{
    return &player;
}

s16 playerGetScreenX(void)
{
    return (s16)(player.x256 >> FIXED_SHIFT);
}

s16 playerGetScreenY(void)
{
    return (s16)(player.y256 >> FIXED_SHIFT);
}
