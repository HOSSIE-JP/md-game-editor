#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "player/bomb.h"
#include "player/charge_shot.h"
#include "bullet/enemy_bullet.h"
#include "enemy/enemy.h"
#include "enemy/boss.h"

static bool active;
static u16 timer;

static void startBomb(void)
{
    if (!gameUseBomb())
        return;

    active = TRUE;
    timer = BOMB_ACTIVE_FRAMES;

    chargePauseForBomb();

    enemyBulletClearAll();
    enemyApplyBombTestDamage();
    bossApplyBombTestDamage();
}

void bombInit(void)
{
    active = FALSE;
    timer = 0;
}

void bombResetForStage(void)
{
    active = FALSE;
    timer = 0;
}

void bombUpdate(u16 pressed, u16 held)
{
    if (!active)
    {
        if (pressed & BUTTON_C)
            startBomb();

        return;
    }

    if (timer > 0)
        timer--;

    if (timer == 0)
    {
        active = FALSE;
        chargeResumeAfterBomb((held & BUTTON_A) != 0);
    }
}

bool bombIsActive(void)
{
    return active;
}

u16 bombGetTimer(void)
{
    return timer;
}
