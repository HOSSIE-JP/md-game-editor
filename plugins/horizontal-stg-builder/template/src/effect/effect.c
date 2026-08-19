#include <genesis.h>
#include "game/config.h"
#include "effect/effect.h"
#include "system/debug.h"
#include "render/renderer.h"

static Effect effects[MAX_EFFECTS];
static u8 activeCount;

void effectInit(void)
{
    activeCount = 0;
}

void effectReset(void)
{
    u8 i;

    for (i = 0; i < activeCount; i++)
    {
        if (effects[i].renderHandle != INVALID_RENDER_HANDLE)
            rendererRelease(effects[i].renderHandle);
    }

    activeCount = 0;
}

bool effectSpawnExplosion(s16 x, s16 y)
{
    Effect* effect;
    RenderHandle handle;

    if (activeCount >= MAX_EFFECTS)
    {
        debugGetCounters()->effectOverflow++;
        return FALSE;
    }

    handle = rendererAcquire(RENDER_CATEGORY_EFFECT);
    if (handle == INVALID_RENDER_HANDLE)
    {
        debugGetCounters()->effectOverflow++;
        return FALSE;
    }

    effect = &effects[activeCount++];
    effect->x = x;
    effect->y = y;
    effect->timer = 24;
    effect->type = 0;
    effect->frame = 0;
    effect->flags = 0;
    effect->renderHandle = handle;

    rendererSetPosition(handle, x - 8, y - 8);
    return TRUE;
}

void effectUpdateAll(void)
{
    u8 i = 0;

    while (i < activeCount)
    {
        Effect* effect = &effects[i];

        if (effect->timer > 0)
            effect->timer--;

        if (effect->timer == 0)
        {
            rendererRelease(effect->renderHandle);
            effects[i] = effects[activeCount - 1];
            activeCount--;
        }
        else
        {
            i++;
        }
    }
}

u8 effectGetActiveCount(void)
{
    return activeCount;
}

const Effect* effectGet(u8 index)
{
    if (index >= activeCount)
        return NULL;

    return &effects[index];
}
