#include <genesis.h>
#include "common.h"
#include "render/japanese_text.h"

#define STG_SJIS_FONT_WIDTH_TILES 94

static u16 nextTile;

void stgTextBegin(u16 firstTile)
{
    nextTile = firstTile;
}

u16 stgTextDraw(VDPPlane plane, const u8* text, u16 palette, bool priority, u16 x, u16 y)
{
    u16 cursorX = x;
    u16 cursorY = y;
    u16 index = 0;

    if (text == NULL)
        return 0;

    while (text[index] != 0)
    {
        const u8 c = text[index++];

        if (c == '\n')
        {
            cursorX = x;
            cursorY++;
            continue;
        }

        if (((c >= 0x81) && (c <= 0x9F)) || ((c >= 0xE0) && (c <= 0xEF)))
        {
            u16 fontRow;
            u16 fontColumn;
            u32 tileOffset;
            u8 c2;

            if (text[index] == 0)
                break;
            c2 = text[index++];
            if (c2 < 0x40 || c2 > 0xFC || c2 == 0x7F)
                continue;

            if (c2 < 0x9F)
            {
                fontRow = (c <= 0x9F) ? (u16)((c - 0x81) * 2) : (u16)((c - 0xE0) * 2 + 62);
                fontColumn = (c2 <= 0x7E) ? (u16)(c2 - 0x40) : (u16)(c2 - 0x41);
            }
            else
            {
                fontRow = (c <= 0x9F) ? (u16)((c - 0x81) * 2 + 1) : (u16)((c - 0xE0) * 2 + 63);
                fontColumn = (u16)(c2 - 0x9F);
            }

            if ((fontRow >= 94) || (fontColumn >= 94) || (nextTile > TILE_USER_MAX_INDEX))
                continue;
            tileOffset = ((u32)fontRow * STG_SJIS_FONT_WIDTH_TILES + fontColumn) * 8;
            VDP_loadTileData(&stg_sjis_font.tiles[tileOffset], nextTile, 1, CPU);
            VDP_setTileMapXY(plane, TILE_ATTR_FULL(palette, priority, FALSE, FALSE, nextTile), cursorX++, cursorY);
            nextTile++;
        }
        else if ((c >= 0x20) && (c <= 0x7E))
        {
            VDP_setTileMapXY(
                plane,
                TILE_ATTR_FULL(palette, priority, FALSE, FALSE, TILE_FONT_INDEX + (c - 0x20)),
                cursorX++,
                cursorY);
        }
    }
    return cursorX - x;
}

u16 stgTextGetNextTile(void)
{
    return nextTile;
}
