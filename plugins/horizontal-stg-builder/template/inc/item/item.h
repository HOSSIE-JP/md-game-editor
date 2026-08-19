#ifndef GERONEKO_ITEM_H
#define GERONEKO_ITEM_H

#include <genesis.h>

typedef enum
{
    ITEM_RED_CAPSULE = 0,
    ITEM_BLUE_CAPSULE,
    ITEM_GREEN_CAPSULE,
    ITEM_POWER,
    ITEM_ABYSS_CORE,
    ITEM_SPEED,
    ITEM_BOMB,
    ITEM_TYPE_COUNT
} ItemType;

typedef enum
{
    ITEM_STATE_POP = 0,
    ITEM_STATE_DRIFT
} ItemState;

enum
{
    ITEM_FLAG_COLLECTED = 1 << 0,
    ITEM_FLAG_REMOVE = 1 << 1
};

typedef struct
{
    s32 x256;
    s32 y256;
    s16 vx256;
    s16 vy256;
    u16 timer;
    u8 type;
    u8 state;
    u8 flags;
} Item;

void itemInit(void);
void itemReset(void);

bool itemSpawn(ItemType type, s16 x, s16 y);
void itemUpdateAll(void);
void itemResolveCollected(void);
void itemCleanup(void);

u8 itemGetActiveCount(void);
Item* itemGet(u8 index);

#endif
