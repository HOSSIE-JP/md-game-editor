#ifndef GERONEKO_STAGE_DEFINITION_H
#define GERONEKO_STAGE_DEFINITION_H

#include <genesis.h>

typedef struct
{
    const TileSet* bgATileSet;
    const MapDefinition* bgAMap;
    const Palette* bgAPalette;

    const TileSet* bgBTileSet;
    const MapDefinition* bgBMap;
    const Palette* bgBPalette;

    const u8* frameStream;
    const u8* scrollStream;
    const u8* conditionStream;

    s16 initialScrollSpeed256;
    u32 lengthPx;
    u8 parallaxShiftB;
    u8 musicId;
    u8 midbossId;
    u8 bossId;
    u8 flags;
} StageDefinition;

#endif
