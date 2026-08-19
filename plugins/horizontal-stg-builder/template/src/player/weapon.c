#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "player/player.h"
#include "player/weapon.h"
#include "player/charge_shot.h"
#include "player/bomb.h"
#include "bullet/player_bullet.h"
#include "generated/weapon_defs.h"

static bool waveUp;

void weaponInit(void)
{
    waveUp = FALSE;
}

WeaponColor weaponGetColor(void)
{
    return (WeaponColor)gameGetSession()->weaponColor;
}

u8 weaponGetLevel(void)
{
    return gameGetSession()->weaponLevel;
}

const WeaponDefinition* weaponGetCurrentDefinition(void)
{
    const GameSession* session = gameGetSession();
    u8 level = session->weaponLevel;

    if (level < WEAPON_LEVEL_MIN)
        level = WEAPON_LEVEL_MIN;
    if (level > WEAPON_LEVEL_MAX)
        level = WEAPON_LEVEL_MAX;

    return &gWeaponDefinitions[session->weaponColor][level - 1];
}

void weaponFireNormal(void)
{
    const Player* player = playerGet();
    const WeaponDefinition* def = weaponGetCurrentDefinition();
    const u8 level = weaponGetLevel();
    const s32 x = player->x256 + (8 * FIXED_ONE);
    const s32 y = player->y256;

    switch ((WeaponPattern)def->pattern)
    {
        case WEAPON_PATTERN_ABYSS_WAVE:
        {
            const s16 waveVy = waveUp ? 96 : -96;
            waveUp = !waveUp;
            playerBulletSpawn(x, y, def->speed256, waveVy, def->damage);
            if (level >= 2)
                playerBulletSpawn(x, y, def->speed256, (s16)-waveVy, def->damage);
            if (level >= 3)
                playerBulletSpawn(x, y, def->speed256, 0, def->damage);
            break;
        }

        case WEAPON_PATTERN_PLASMA_SPREAD:
            playerBulletSpawn(x, y, def->speed256, 0, def->damage);
            if (level >= 2)
            {
                playerBulletSpawn(x, y, def->speed256, -128, def->damage);
                playerBulletSpawn(x, y, def->speed256, 128, def->damage);
            }
            if (level >= 3)
            {
                playerBulletSpawn(x, y, def->speed256, -256, def->damage);
                playerBulletSpawn(x, y, def->speed256, 256, def->damage);
            }
            break;

        case WEAPON_PATTERN_BURST_LASER:
        default:
            playerBulletSpawn(x, y, def->speed256, 0, def->damage);
            if (level >= 2)
                playerBulletSpawn(x - (4 * FIXED_ONE), y - (3 * FIXED_ONE), def->speed256, 0, def->damage);
            if (level >= 3)
                playerBulletSpawn(x - (8 * FIXED_ONE), y + (3 * FIXED_ONE), def->speed256, 0, def->damage);
            break;
    }
}

void weaponUpdate(const u16 pressed, const u16 held, const u16 released)
{
    if (bombIsActive())
        return;

    if (!playerCanShoot())
    {
        chargeUpdate(pressed, held, released);
        return;
    }

    if (pressed & BUTTON_A)
        weaponFireNormal();

    chargeUpdate(pressed, held, released);
}

WeaponPickupResult weaponApplyAttributeCapsule(WeaponColor color)
{
    GameSession* session = gameGetSession();

    if (session->weaponColor == (u8)color)
        return WEAPON_PICKUP_SAME_ATTRIBUTE;

    session->weaponColor = (u8)color;
    return WEAPON_PICKUP_SWITCHED;
}

bool weaponApplyPowerUp(void)
{
    GameSession* session = gameGetSession();

    if (session->weaponLevel >= WEAPON_LEVEL_MAX)
        return FALSE;

    session->weaponLevel++;
    return TRUE;
}
