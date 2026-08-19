#include <genesis.h>
#include "common.h"
#include "game/config.h"
#include "render/renderer.h"
#include "player/player.h"
#include "player/charge_shot.h"
#include "bullet/player_bullet.h"
#include "bullet/enemy_bullet.h"
#include "item/item.h"

#define PERSISTENT_SLOT_COUNT (1 + MAX_ENEMIES + 6 + 1 + 2 + MAX_BOSS_RENDER_PARTS)
#define BULLET_VISUAL_SLOT_COUNT 23
#define ITEM_VISUAL_SLOT_COUNT 8
#define CHARGE_VISUAL_SLOT_COUNT 4
#define RENDER_SLOT_COUNT (PERSISTENT_SLOT_COUNT + BULLET_VISUAL_SLOT_COUNT)

typedef enum
{
    BULLET_VISUAL_PLAYER = 0,
    BULLET_VISUAL_ENEMY
} BulletVisualType;

typedef struct
{
    Sprite* sprite;
    RenderCategory category;
    bool active;
} RenderSlot;

typedef struct
{
    Sprite* sprite;
    BulletVisualType type;
    bool visible;
} BulletVisualSlot;

static RenderSlot slots[PERSISTENT_SLOT_COUNT];
static BulletVisualSlot bulletSlots[BULLET_VISUAL_SLOT_COUNT];
static Sprite* itemSlots[ITEM_VISUAL_SLOT_COUNT];
static Sprite* chargeSlots[CHARGE_VISUAL_SLOT_COUNT];

static u16 categoryAttr(RenderCategory category)
{
    switch (category)
    {
        case RENDER_CATEGORY_PLAYER:
        case RENDER_CATEGORY_CORE:
            return TILE_ATTR(PAL2, TRUE, FALSE, FALSE);

        case RENDER_CATEGORY_ENEMY:
        case RENDER_CATEGORY_RECOVERY:
        case RENDER_CATEGORY_BOSS:
        case RENDER_CATEGORY_EFFECT:
        default:
            return TILE_ATTR(PAL3, FALSE, FALSE, FALSE);
    }
}

static const SpriteDefinition* categoryDef(RenderCategory category)
{
    switch (category)
    {
        case RENDER_CATEGORY_PLAYER:
            return &spr_player_test;

        case RENDER_CATEGORY_CORE:
            return &spr_core_test;

        case RENDER_CATEGORY_ENEMY:
        case RENDER_CATEGORY_RECOVERY:
            return &spr_enemy_test;

        case RENDER_CATEGORY_BOSS:
            return &spr_boss_part_test;

        case RENDER_CATEGORY_EFFECT:
        default:
            return &spr_explosion_test;
    }
}

static bool createPersistentSlot(u8 index, RenderCategory category)
{
    Sprite* sprite = SPR_addSpriteSafe(categoryDef(category), -32, -32, categoryAttr(category));

    slots[index].sprite = sprite;
    slots[index].category = category;
    slots[index].active = FALSE;

    if (sprite == NULL)
        return FALSE;

    SPR_setVisibility(sprite, HIDDEN);
    return TRUE;
}



static bool createChargeSlot(u8 index)
{
    Sprite* sprite = SPR_addSpriteSafe(
        &spr_charge_test,
        -24,
        -16,
        TILE_ATTR(PAL2, TRUE, FALSE, FALSE));

    chargeSlots[index] = sprite;

    if (sprite == NULL)
        return FALSE;

    SPR_setVisibility(sprite, HIDDEN);
    return TRUE;
}

static bool createItemSlot(u8 index)
{
    Sprite* sprite = SPR_addSpriteSafe(
        &spr_item_red_test,
        -16,
        -16,
        TILE_ATTR(PAL2, FALSE, FALSE, FALSE));

    itemSlots[index] = sprite;

    if (sprite == NULL)
        return FALSE;

    SPR_setVisibility(sprite, HIDDEN);
    return TRUE;
}

static const SpriteDefinition* itemDefinition(u8 type)
{
    switch ((ItemType)type)
    {
        case ITEM_BLUE_CAPSULE:
            return &spr_item_blue_test;
        case ITEM_GREEN_CAPSULE:
            return &spr_item_green_test;
        case ITEM_POWER:
            return &spr_item_power_test;
        case ITEM_ABYSS_CORE:
            return &spr_item_core_test;
        case ITEM_SPEED:
            return &spr_item_speed_test;
        case ITEM_BOMB:
            return &spr_item_bomb_test;
        case ITEM_RED_CAPSULE:
        default:
            return &spr_item_red_test;
    }
}

static bool createBulletSlot(u8 index)
{
    Sprite* sprite = SPR_addSpriteSafe(
        &spr_player_bullet_test,
        -16,
        -16,
        TILE_ATTR(PAL2, TRUE, FALSE, FALSE));

    bulletSlots[index].sprite = sprite;
    bulletSlots[index].type = BULLET_VISUAL_PLAYER;
    bulletSlots[index].visible = FALSE;

    if (sprite == NULL)
        return FALSE;

    SPR_setVisibility(sprite, HIDDEN);
    return TRUE;
}

static void setBulletSlotType(BulletVisualSlot* slot, BulletVisualType type)
{
    if (slot->type == type)
        return;

    slot->type = type;

    if (type == BULLET_VISUAL_ENEMY)
    {
        SPR_setDefinition(slot->sprite, &spr_enemy_bullet_test);
        SPR_setPalette(slot->sprite, PAL3);
        SPR_setPriority(slot->sprite, FALSE);
    }
    else
    {
        SPR_setDefinition(slot->sprite, &spr_player_bullet_test);
        SPR_setPalette(slot->sprite, PAL2);
        SPR_setPriority(slot->sprite, TRUE);
    }
}

static bool submitBullet(u8* nextSlot, BulletVisualType type, s16 x, s16 y)
{
    BulletVisualSlot* slot;

    if (*nextSlot >= BULLET_VISUAL_SLOT_COUNT)
        return FALSE;

    slot = &bulletSlots[(*nextSlot)++];
    setBulletSlotType(slot, type);
    slot->visible = TRUE;

    SPR_setPosition(slot->sprite, x - 4, y - 4);
    SPR_setVisibility(slot->sprite, VISIBLE);
    return TRUE;
}

void rendererInit(void)
{
    SPR_init();
}

bool rendererResetForStage(void)
{
    u8 slot = 0;
    u8 i;

    SPR_reset();

    PAL_setPalette(PAL2, spr_player_test.palette->data, DMA);
    PAL_setPalette(PAL3, spr_enemy_test.palette->data, DMA);

    if (!createPersistentSlot(slot++, RENDER_CATEGORY_PLAYER))
        return FALSE;

    for (i = 0; i < MAX_ENEMIES; i++)
        if (!createPersistentSlot(slot++, RENDER_CATEGORY_ENEMY))
            return FALSE;

    for (i = 0; i < 6; i++)
        if (!createPersistentSlot(slot++, RENDER_CATEGORY_EFFECT))
            return FALSE;

    if (!createPersistentSlot(slot++, RENDER_CATEGORY_CORE))
        return FALSE;

    for (i = 0; i < 2; i++)
        if (!createPersistentSlot(slot++, RENDER_CATEGORY_RECOVERY))
            return FALSE;

    for (i = 0; i < MAX_BOSS_RENDER_PARTS; i++)
        if (!createPersistentSlot(slot++, RENDER_CATEGORY_BOSS))
            return FALSE;

    for (i = 0; i < BULLET_VISUAL_SLOT_COUNT; i++)
        if (!createBulletSlot(i))
            return FALSE;

    for (i = 0; i < ITEM_VISUAL_SLOT_COUNT; i++)
        if (!createItemSlot(i))
            return FALSE;

    for (i = 0; i < CHARGE_VISUAL_SLOT_COUNT; i++)
        if (!createChargeSlot(i))
            return FALSE;

    return TRUE;
}

RenderHandle rendererAcquire(RenderCategory category)
{
    u8 i;

    for (i = 0; i < PERSISTENT_SLOT_COUNT; i++)
    {
        RenderSlot* slot = &slots[i];

        if ((slot->category == category) && !slot->active && (slot->sprite != NULL))
        {
            slot->active = TRUE;
            SPR_setPosition(slot->sprite, -32, -32);
            SPR_setVisibility(slot->sprite, VISIBLE);
            return i;
        }
    }

    return INVALID_RENDER_HANDLE;
}

void rendererRelease(RenderHandle handle)
{
    if (handle >= PERSISTENT_SLOT_COUNT)
        return;

    slots[handle].active = FALSE;

    if (slots[handle].sprite != NULL)
    {
        SPR_setVisibility(slots[handle].sprite, HIDDEN);
        SPR_setPosition(slots[handle].sprite, -32, -32);
    }
}

void rendererSetDefinition(RenderHandle handle, const SpriteDefinition* definition)
{
    if ((handle >= PERSISTENT_SLOT_COUNT) ||
        (slots[handle].sprite == NULL) ||
        (definition == NULL))
        return;

    SPR_setDefinition(slots[handle].sprite, definition);
}

void rendererSetPosition(RenderHandle handle, s16 x, s16 y)
{
    if ((handle >= PERSISTENT_SLOT_COUNT) || !slots[handle].active || (slots[handle].sprite == NULL))
        return;

    SPR_setPosition(slots[handle].sprite, x, y);
}

void rendererSetVisible(RenderHandle handle, bool visible)
{
    if ((handle >= PERSISTENT_SLOT_COUNT) || (slots[handle].sprite == NULL))
        return;

    SPR_setVisibility(slots[handle].sprite, visible ? VISIBLE : HIDDEN);
}


void rendererHideAll(void)
{
    u8 i;

    for (i = 0; i < PERSISTENT_SLOT_COUNT; i++)
    {
        if (slots[i].sprite != NULL)
            SPR_setVisibility(slots[i].sprite, HIDDEN);
    }

    for (i = 0; i < BULLET_VISUAL_SLOT_COUNT; i++)
    {
        if (bulletSlots[i].sprite != NULL)
            SPR_setVisibility(bulletSlots[i].sprite, HIDDEN);
    }

    for (i = 0; i < ITEM_VISUAL_SLOT_COUNT; i++)
    {
        if (itemSlots[i] != NULL)
            SPR_setVisibility(itemSlots[i], HIDDEN);
    }

    for (i = 0; i < CHARGE_VISUAL_SLOT_COUNT; i++)
    {
        if (chargeSlots[i] != NULL)
            SPR_setVisibility(chargeSlots[i], HIDDEN);
    }

    SPR_update();
}

void rendererPrepare(void)
{
    const Player* player = playerGet();
    const s16 playerX = playerGetScreenX();
    const s16 playerY = playerGetScreenY();
    u8 nextSlot = 0;
    u8 i;

    /* Hide bullet visual slots; only selected logical bullets are shown this frame. */
    for (i = 0; i < BULLET_VISUAL_SLOT_COUNT; i++)
    {
        bulletSlots[i].visible = FALSE;
        SPR_setVisibility(bulletSlots[i].sprite, HIDDEN);
    }

    (void)player;

    for (i = 0; i < ITEM_VISUAL_SLOT_COUNT; i++)
        SPR_setVisibility(itemSlots[i], HIDDEN);

    for (i = 0; i < CHARGE_VISUAL_SLOT_COUNT; i++)
        SPR_setVisibility(chargeSlots[i], HIDDEN);

    /* Charge shots have dedicated high-priority visual slots. */
    for (i = 0; (i < chargeShotGetActiveCount()) && (i < CHARGE_VISUAL_SLOT_COUNT); i++)
    {
        ChargeShot* shot = chargeShotGet(i);

        if (shot == NULL)
            continue;

        SPR_setPosition(
            chargeSlots[i],
            (s16)(shot->x256 >> FIXED_SHIFT) - 8,
            (s16)(shot->y256 >> FIXED_SHIFT) - 4);
        SPR_setVisibility(chargeSlots[i], VISIBLE);
    }

    /* Items: visual cap 8, logical cap 16. */
    for (i = 0; (i < itemGetActiveCount()) && (i < ITEM_VISUAL_SLOT_COUNT); i++)
    {
        Item* item = itemGet(i);

        if ((item == NULL) || (item->flags & (ITEM_FLAG_COLLECTED | ITEM_FLAG_REMOVE)))
            continue;

        SPR_setDefinition(itemSlots[i], itemDefinition(item->type));
        SPR_setPalette(itemSlots[i], PAL2);
        SPR_setPosition(
            itemSlots[i],
            (s16)(item->x256 >> FIXED_SHIFT) - 4,
            (s16)(item->y256 >> FIXED_SHIFT) - 4);
        SPR_setVisibility(itemSlots[i], VISIBLE);
    }

    /* Pass 1: dangerous enemy bullets near the player. */
    for (i = 0; i < enemyBulletGetActiveCount(); i++)
    {
        EnemyBullet* bullet = enemyBulletGet(i);
        s16 x;
        s16 y;
        s16 dx;
        s16 dy;

        if ((bullet == NULL) || (bullet->flags & ENEMY_BULLET_FLAG_REMOVE))
            continue;

        x = (s16)(bullet->x256 >> FIXED_SHIFT);
        y = (s16)(bullet->y256 >> FIXED_SHIFT);
        dx = x - playerX;
        dy = y - playerY;

        if ((dx > -64) && (dx < 64) && (dy > -48) && (dy < 48))
            submitBullet(&nextSlot, BULLET_VISUAL_ENEMY, x, y);
    }

    /* Pass 2: player bullets. */
    for (i = 0; i < playerBulletGetActiveCount(); i++)
    {
        PlayerBullet* bullet = playerBulletGet(i);
        if ((bullet == NULL) || (bullet->flags & PLAYER_BULLET_FLAG_REMOVE))
            continue;

        if (!submitBullet(
                &nextSlot,
                BULLET_VISUAL_PLAYER,
                (s16)(bullet->x256 >> FIXED_SHIFT),
                (s16)(bullet->y256 >> FIXED_SHIFT)))
            break;
    }

    /* Pass 3: remaining enemy bullets, skipping those already submitted as dangerous. */
    for (i = 0; i < enemyBulletGetActiveCount(); i++)
    {
        EnemyBullet* bullet = enemyBulletGet(i);
        s16 x;
        s16 y;
        s16 dx;
        s16 dy;

        if ((bullet == NULL) || (bullet->flags & ENEMY_BULLET_FLAG_REMOVE))
            continue;

        x = (s16)(bullet->x256 >> FIXED_SHIFT);
        y = (s16)(bullet->y256 >> FIXED_SHIFT);
        dx = x - playerX;
        dy = y - playerY;

        if ((dx > -64) && (dx < 64) && (dy > -48) && (dy < 48))
            continue;

        if (!submitBullet(&nextSlot, BULLET_VISUAL_ENEMY, x, y))
            break;
    }
}

void rendererCommit(void)
{
    SPR_update();
}
