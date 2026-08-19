#include <genesis.h>
#include "common.h"
#include "game/config.h"
#include "stage/background.h"
#include "stage/stage_controller.h"

static Map* bgA;
static Map* bgB;

static u16 bgBTilesIndex;
static u16 bgATilesIndex;

void backgroundInit(void)
{
    bgA = NULL;
    bgB = NULL;
}

void backgroundRelease(void)
{
    if (bgA != NULL)
    {
        MEM_free(bgA);
        bgA = NULL;
    }

    if (bgB != NULL)
    {
        MEM_free(bgB);
        bgB = NULL;
    }
}

bool backgroundResetForStage(const StageDefinition* stage)
{
    u16 tileIndex = TILE_USER_INDEX + ts_hud_icons.numTile;

    if (stage == NULL)
        return FALSE;

    backgroundRelease();

    PAL_setPalette(PAL0, stage->bgBPalette->data, DMA);
    PAL_setPalette(PAL1, stage->bgAPalette->data, DMA);

    bgBTilesIndex = tileIndex;
    if (!VDP_loadTileSet(stage->bgBTileSet, bgBTilesIndex, DMA))
        return FALSE;
    tileIndex += stage->bgBTileSet->numTile;

    bgATilesIndex = tileIndex;
    if (!VDP_loadTileSet(stage->bgATileSet, bgATilesIndex, DMA))
        return FALSE;
    tileIndex += stage->bgATileSet->numTile;

    if (tileIndex > TILE_USER_MAX_INDEX)
        return FALSE;

    bgB = MAP_create(
        stage->bgBMap,
        BG_B,
        TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, bgBTilesIndex));

    bgA = MAP_create(
        stage->bgAMap,
        BG_A,
        TILE_ATTR_FULL(PAL1, FALSE, FALSE, FALSE, bgATilesIndex));

    if ((bgA == NULL) || (bgB == NULL))
    {
        backgroundRelease();
        return FALSE;
    }

    MAP_scrollTo(bgB, 0, 0);
    MAP_scrollTo(bgA, 0, 0);

    return TRUE;
}

void backgroundPrepare(s32 cameraX256)
{
    const u32 cameraX = (u32)(cameraX256 >> FIXED_SHIFT);
    const StageDefinition* stage = stageGetCurrentDefinition();

    if (bgA != NULL)
        MAP_scrollTo(bgA, cameraX, 0);

    if ((bgB != NULL) && (stage != NULL))
        MAP_scrollTo(bgB, cameraX >> stage->parallaxShiftB, 0);
}
