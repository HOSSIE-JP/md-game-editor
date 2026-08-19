#ifndef GERONEKO_RENDERER_H
#define GERONEKO_RENDERER_H

#include <genesis.h>

typedef u8 RenderHandle;

typedef enum
{
    RENDER_CATEGORY_PLAYER = 0,
    RENDER_CATEGORY_PLAYER_BULLET,
    RENDER_CATEGORY_ENEMY,
    RENDER_CATEGORY_EFFECT,
    RENDER_CATEGORY_CORE,
    RENDER_CATEGORY_RECOVERY,
    RENDER_CATEGORY_BOSS
} RenderCategory;

void rendererInit(void);
bool rendererResetForStage(void);

RenderHandle rendererAcquire(RenderCategory category);
void rendererRelease(RenderHandle handle);

void rendererSetDefinition(RenderHandle handle, const SpriteDefinition* definition);
void rendererSetPosition(RenderHandle handle, s16 x, s16 y);
void rendererSetVisible(RenderHandle handle, bool visible);

void rendererHideAll(void);
void rendererPrepare(void);
void rendererCommit(void);

#endif
