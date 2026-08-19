#ifndef GERONEKO_WEAPON_H
#define GERONEKO_WEAPON_H

#include <genesis.h>

typedef enum
{
    WEAPON_COLOR_RED = 0,
    WEAPON_COLOR_BLUE,
    WEAPON_COLOR_GREEN,
    WEAPON_COLOR_COUNT
} WeaponColor;

typedef enum
{
    WEAPON_PATTERN_BURST_LASER = 0,
    WEAPON_PATTERN_ABYSS_WAVE,
    WEAPON_PATTERN_PLASMA_SPREAD
} WeaponPattern;

typedef enum
{
    WEAPON_PICKUP_SWITCHED = 0,
    WEAPON_PICKUP_SAME_ATTRIBUTE
} WeaponPickupResult;

typedef struct
{
    u8 damage;
    u8 pattern;
    s16 speed256;
    u8 flags;
} WeaponDefinition;

void weaponInit(void);
void weaponUpdate(const u16 pressed, const u16 held, const u16 released);
void weaponFireNormal(void);

WeaponPickupResult weaponApplyAttributeCapsule(WeaponColor color);
bool weaponApplyPowerUp(void);

WeaponColor weaponGetColor(void);
u8 weaponGetLevel(void);
const WeaponDefinition* weaponGetCurrentDefinition(void);

#endif
