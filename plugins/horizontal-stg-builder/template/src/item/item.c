#include <genesis.h>
#include "game/config.h"
#include "game/game.h"
#include "item/item.h"
#include "player/weapon.h"
#include "player/abyss_core.h"

static Item items[MAX_ITEMS];
static u8 activeCount;

void itemInit(void)
{
    activeCount = 0;
}

void itemReset(void)
{
    activeCount = 0;
}

bool itemSpawn(ItemType type, s16 x, s16 y)
{
    Item* item;

    if (activeCount >= MAX_ITEMS)
        return FALSE;

    item = &items[activeCount++];
    item->x256 = (s32)x * FIXED_ONE;
    item->y256 = (s32)y * FIXED_ONE;
    item->vx256 = 0;
    item->vy256 = ITEM_POP_VY256;
    item->timer = ITEM_POP_FRAMES;
    item->type = (u8)type;
    item->state = ITEM_STATE_POP;
    item->flags = 0;

    return TRUE;
}

void itemUpdateAll(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Item* item = &items[i];
        s16 x;

        if (item->flags & (ITEM_FLAG_COLLECTED | ITEM_FLAG_REMOVE))
            continue;

        item->x256 += item->vx256;
        item->y256 += item->vy256;

        if (item->state == ITEM_STATE_POP)
        {
            if (item->timer > 0)
                item->timer--;

            if (item->timer == 0)
            {
                item->state = ITEM_STATE_DRIFT;
                item->vx256 = ITEM_DRIFT_VX256;
                item->vy256 = 0;
            }
        }

        x = (s16)(item->x256 >> FIXED_SHIFT);
        if (x < -16)
            item->flags |= ITEM_FLAG_REMOVE;
    }
}

void itemResolveCollected(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        Item* item = &items[i];

        if (!(item->flags & ITEM_FLAG_COLLECTED))
            continue;

        switch ((ItemType)item->type)
        {
            case ITEM_RED_CAPSULE:
                if (weaponApplyAttributeCapsule(WEAPON_COLOR_RED) == WEAPON_PICKUP_SAME_ATTRIBUTE)
                    gameAddScore(SAME_ATTRIBUTE_SCORE_BONUS);
                break;

            case ITEM_BLUE_CAPSULE:
                if (weaponApplyAttributeCapsule(WEAPON_COLOR_BLUE) == WEAPON_PICKUP_SAME_ATTRIBUTE)
                    gameAddScore(SAME_ATTRIBUTE_SCORE_BONUS);
                break;

            case ITEM_GREEN_CAPSULE:
                if (weaponApplyAttributeCapsule(WEAPON_COLOR_GREEN) == WEAPON_PICKUP_SAME_ATTRIBUTE)
                    gameAddScore(SAME_ATTRIBUTE_SCORE_BONUS);
                break;


            case ITEM_ABYSS_CORE:
                if (!abyssCoreIsOwned())
                    abyssCoreAcquireAt((s16)(item->x256 >> FIXED_SHIFT));
                else
                    gameAddScore(CORE_DUPLICATE_SCORE_BONUS);
                break;

            case ITEM_SPEED:
                if (!gameAddSpeedLevel())
                    gameAddScore(SPEED_MAX_SCORE_BONUS);
                break;

            case ITEM_BOMB:
                if (!gameAddBomb())
                    gameAddScore(BOMB_MAX_SCORE_BONUS);
                break;

            case ITEM_POWER:
                if (!weaponApplyPowerUp())
                    gameAddScore(POWER_MAX_SCORE_BONUS);
                break;

            default:
                break;
        }

        item->flags |= ITEM_FLAG_REMOVE;
    }
}

void itemCleanup(void)
{
    u8 i = 0;

    while (i < activeCount)
    {
        if (items[i].flags & ITEM_FLAG_REMOVE)
        {
            items[i] = items[activeCount - 1];
            activeCount--;
        }
        else
        {
            i++;
        }
    }
}

u8 itemGetActiveCount(void)
{
    return activeCount;
}

Item* itemGet(u8 index)
{
    if (index >= activeCount)
        return NULL;

    return &items[index];
}
