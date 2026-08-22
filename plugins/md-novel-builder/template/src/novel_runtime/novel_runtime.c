#include <genesis.h>
#include "novel.h"
#include "generated/novel_data.h"
#include "novel_runtime/novel_runtime.h"
extern const u16 nov_font_codes[];
extern const u16 nov_font_glyph_count;


#define NOVEL_PLANE_WIDTH          64
#define NOVEL_MESSAGE_ROWS         5
#define NOVEL_MESSAGE_COLUMNS      19
#define NOVEL_MESSAGE_SPRITES      38
#define NOVEL_MESSAGE_TOP_Y        136
#define NOVEL_MESSAGE_VRAM_TILES   377
#define NOVEL_MESSAGE_TOP_TILES    0
#define NOVEL_MESSAGE_MIDDLE_TILES 152
#define NOVEL_MESSAGE_BOTTOM_TILES 304
#define NOVEL_MESSAGE_CURSOR_TILE  376
#define NOVEL_OVERLAY_MAX_TILES    192
#define NOVEL_SPRITE_TEXT_SLOTS    4
#define NOVEL_SPRITE_SLOTS         4
#define NOVEL_INPUT_WATCHERS       7
#define NOVEL_VARIABLE_MAX         255
#define NOVEL_PALETTE_NONE         0xFF

typedef enum
{
    MODE_RUN = 0,
    MODE_WAIT,
    MODE_INPUT,
    MODE_MESSAGE_PREP,
    MODE_MESSAGE,
    MODE_CHOICE_PREP,
    MODE_CHOICE,
    MODE_MOVE,
    MODE_EFFECT,
    MODE_HALT
} RuntimeMode;

typedef struct
{
    bool active;
    s16 startX;
    s16 startY;
    s16 targetX;
    s16 targetY;
    u16 frames;
    u16 elapsed;
} MoveState;


typedef struct
{
    const NovelSpriteText *definition;
    s16 x;
    s16 y;
    bool visible;
    bool blinkOn;
    u16 blinkTimer;
} SpriteTextState;

typedef struct
{
    u16 cell;
    u8 pixels[32];
} OverlayTile;

static const NovelProject *runtimeProject;
static s16 currentScene;
static u16 currentPc;
static RuntimeMode runtimeMode;
static u16 waitCounter;
static u16 previousJoy;
static u16 pressedJoy;
static bool autoEnabled;
static u16 autoCounter;
static u16 activeMessageSpeed;
static s16 variables[NOVEL_VARIABLE_MAX];
static u16 variableCount;
static u16 randomState;

static Sprite *actorSprites[NOVEL_SPRITE_SLOTS];
static s16 actorResources[NOVEL_SPRITE_SLOTS];
static s16 actorAnimations[NOVEL_SPRITE_SLOTS];
static MoveState actorMoves[NOVEL_SPRITE_SLOTS];
static bool actorSceneClearPending;

static u8 inputWatcherCount;
static u16 inputWatcherMasks[NOVEL_INPUT_WATCHERS];
static s16 inputWatcherTargets[NOVEL_INPUT_WATCHERS];
static bool syncInputActive;
static u16 syncInputMask;
static s16 syncInputTarget;

static u16 currentPalette[64];
static u16 loadedPaletteIds[4];
static u8 paletteOwnerCounts[4];
static u8 backgroundPalette;
static u8 actorPalettes[NOVEL_SPRITE_SLOTS];
static u16 backgroundTileCount;
static u16 workTileBase;
static bool windowVisible;
static volatile bool shadowArmed;
static Sprite *messageSprites[NOVEL_MESSAGE_SPRITES];
static u8 messageSpriteAllocated;
static u8 messageSpriteActive;
static u16 messageRows[NOVEL_MESSAGE_ROWS][NOVEL_MESSAGE_COLUMNS];
static u8 messageRowLengths[NOVEL_MESSAGE_ROWS];
static bool messageBandMerged[2];
static u8 messagePrepareStage;
static u8 messageRevealStage;
static const NovelMessage *activeMessage;
static u8 activeMessagePage;
static u16 messageRevealed;
static u16 messageTimer;
static bool messageComplete;
static u16 messageCursorTimer;
static u8 messageCursorKind;

static const NovelChoice *activeChoice;
static u8 choiceIndex;

static SpriteTextState spriteTexts[NOVEL_SPRITE_TEXT_SLOTS];
static OverlayTile overlayTiles[NOVEL_OVERLAY_MAX_TILES];
static u16 overlayTileCount;
static u16 previousOverlayCells[NOVEL_OVERLAY_MAX_TILES];
static u16 previousOverlayCount;

static u16 effectFrames;
static s16 effectIntensity;
static u8 effectType;
static u16 effectPalette[64];

static u32 glyphBuffer[128];
static const u32 messageDownTile[8] = { 0, 0, 0x01111110, 0x00111100, 0x00011000, 0, 0, 0 };
static const u32 messageAutoTile[8] = { 0x00011000, 0x00111100, 0x01111110, 0x11111111, 0x01111110, 0x00111100, 0x00011000, 0 };
static const u32 choiceCursorTile[8] = { 0x01000000, 0x01100000, 0x01110000, 0x01111000, 0x01110000, 0x01100000, 0x01000000, 0 };


static u16 messageTileBase(void)
{
    return workTileBase + runtimeProject->overlayVramTiles;
}

static HINTERRUPT_CALLBACK novelHInt(void)
{
    VDP_setHilightShadow(TRUE);
    VDP_setHInterrupt(FALSE);
}

static void novelVInt(void)
{
    VDP_setHilightShadow(FALSE);
    if (shadowArmed)
    {
        VDP_setHIntCounter(127);
        VDP_setHInterrupt(TRUE);
    }
    else
        VDP_setHInterrupt(FALSE);
}

static s16 effectiveX(s16 value)
{
    return runtimeProject->legacyCoordinates ? (s16)(value + 32) : value;
}

static s16 clampS16(s32 value)
{
    if (value < -32768) return -32768;
    if (value > 32767) return 32767;
    return (s16)value;
}

static s16 variableValue(s16 index)
{
    if ((index < 0) || ((u16)index >= variableCount)) return 0;
    return variables[(u16)index];
}

static void setVariable(s16 index, s16 value)
{
    if ((index < 0) || ((u16)index >= variableCount)) return;
    if (index == 0)
    {
        value = value ? 1 : 0;
        autoEnabled = value != 0;
    }
    else if (index == 1)
    {
        if (value < 0) value = 0;
        if (value > 6) value = 6;
    }
    variables[(u16)index] = value;
}

static u16 nextRandomValue(void)
{
    u16 value = randomState;
    value ^= (u16)(value << 7);
    value ^= (u16)(value >> 9);
    value ^= (u16)(value << 8);
    if (value == 0) value = 0xACE1;
    randomState = value;
    return value;
}

static s16 randomRange(s16 minimum, s16 maximum)
{
    s32 difference;
    u16 span;
    if (minimum > maximum)
    {
        s16 temporary = minimum;
        minimum = maximum;
        maximum = temporary;
    }
    difference = (s32)maximum - (s32)minimum;
    span = difference >= 65535 ? 65535 : (u16)(difference + 1);
    if (span == 0) return minimum;
    return clampS16((s32)minimum + (nextRandomValue() % span));
}

static bool compareValue(s16 left, u8 operation, s16 right)
{
    if (operation == NOV_COMPARE_NE) return left != right;
    if (operation == NOV_COMPARE_LT) return left < right;
    if (operation == NOV_COMPARE_LTE) return left <= right;
    if (operation == NOV_COMPARE_GT) return left > right;
    if (operation == NOV_COMPARE_GTE) return left >= right;
    return left == right;
}

static u16 currentMessageSpeed(void)
{
    s16 override = variableValue(1);
    if ((override >= 1) && (override <= 6)) return (u16)(override - 1) * 10;
    return runtimeProject->messageSpeedFrames;
}
static void copyPalette(u16 palette, const u16 *colors)
{
    u16 index;
    for (index = 0; index < 16; index++)
        currentPalette[palette * 16 + index] = colors[index];
}

static void loadPhysicalPalette(u16 palette, const u16 *colors, u16 paletteId)
{
    if ((palette > PAL3) || (colors == NULL))
        return;
    copyPalette(palette, colors);
    if (loadedPaletteIds[palette] == paletteId)
        return;
    PAL_setPalette(palette, colors, DMA_QUEUE_COPY);
    loadedPaletteIds[palette] = paletteId;
}

static void releasePaletteOwner(u8 palette)
{
    if ((palette <= PAL3) && (paletteOwnerCounts[palette] > 0))
        paletteOwnerCounts[palette]--;
}

static void claimPaletteOwner(u8 palette)
{
    if ((palette <= PAL3) && (paletteOwnerCounts[palette] < 0xFF))
        paletteOwnerCounts[palette]++;
}

static void setMessageColor(u16 color)
{
    currentPalette[1] = color;
    PAL_setPalette(PAL0, currentPalette, DMA_QUEUE_COPY);
}

static void restoreMessageColor(void)
{
    setMessageColor(0x0EEE);
}

static void setAllColorsSafe(const u16 *colors)
{
    PAL_setColors(0, colors, 64, DMA_QUEUE_COPY);
}

static void startFadeInSafe(u16 frames)
{
    SYS_disableInts();
    PAL_fadeInAll(currentPalette, frames, TRUE);
    SYS_enableInts();
}

static void startFadeToSafe(const u16 *colors, u16 frames)
{
    SYS_disableInts();
    PAL_fadeToAll(colors, frames, TRUE);
    SYS_enableInts();
}

static void setHorizontalScrollSafe(s16 planeA, s16 planeB)
{
    SYS_disableInts();
    VDP_setHorizontalScroll(BG_A, planeA);
    VDP_setHorizontalScroll(BG_B, planeB);
    SYS_enableInts();
}

static void initializeSystemPalette(void)
{
    u16 index;
    for (index = 0; index < 64; index++)
        currentPalette[index] = 0;
    currentPalette[1] = 0x0EEE;
    for (index = 0; index < 4; index++)
    {
        loadedPaletteIds[index] = 0xFFFF;
        paletteOwnerCounts[index] = 0;
        actorPalettes[index] = NOVEL_PALETTE_NONE;
    }
    backgroundPalette = NOVEL_PALETTE_NONE;
    PAL_setColors(0, currentPalette, 64, CPU);
}
static u16 findFontGlyph(u16 code)
{
    u16 low = 0;
    u16 high = nov_font_glyph_count;
    while (low < high)
    {
        u16 middle = low + ((high - low) >> 1);
        u16 candidate = nov_font_codes[middle];
        if (candidate < code)
            low = middle + 1;
        else
            high = middle;
    }
    if ((low < nov_font_glyph_count) && (nov_font_codes[low] == code))
        return low;
    return 0;
}

static bool sjisGlyph(const u8 *text, u16 *position, u16 *atlas, bool *newline)
{
    u8 first;
    u8 second;
    u16 code;
    *newline = FALSE;
    first = text[*position];
    if (first == 0)
        return FALSE;
    (*position)++;
    if (first == '\n')
    {
        *newline = TRUE;
        return TRUE;
    }
    code = first;
    if (((first >= 0x81) && (first <= 0x9F)) || ((first >= 0xE0) && (first <= 0xEF)))
    {
        second = text[*position];
        if (second == 0)
            return FALSE;
        (*position)++;
        if ((second < 0x40) || (second > 0xFC) || (second == 0x7F))
        {
            *atlas = 0;
            return TRUE;
        }
        code = ((u16)first << 8) | second;
    }
    *atlas = findFontGlyph(code);
    return TRUE;
}

static u8 fontPixel(u16 atlas, u8 x, u8 y)
{
    u16 glyphColumn = atlas & 15;
    u16 glyphRow = atlas >> 4;
    u16 tile = glyphRow * 64 + (u16)(y >> 3) * 32 + glyphColumn * 2 + (x >> 3);
    u8 localX = x & 7;
    u8 localY = y & 7;
    const u8 *source = (const u8 *)&novel_font_subset.tiles[(u32)tile * 8];
    u8 packed = source[localY * 4 + (localX >> 1)];
    return (localX & 1) ? (packed & 0x0F) : (packed >> 4);
}

static void setPackedPixel(u8 *target, u8 x, u8 y, u8 value)
{
    u16 index = (u16)y * 4 + (x >> 1);
    if (x & 1)
        target[index] = (target[index] & 0xF0) | (value & 0x0F);
    else
        target[index] = (target[index] & 0x0F) | ((value & 0x0F) << 4);
}

static void clearGlyphBuffer(u16 tiles)
{
    u16 index;
    u8 *target = (u8 *)glyphBuffer;
    for (index = 0; index < tiles * 32; index++) target[index] = 0;
}

static void packGlyph(u16 atlas, u8 originX, u8 originY, u8 widthTiles, u8 heightTiles)
{
    u8 x;
    u8 y;
    u8 *target = (u8 *)glyphBuffer;
    (void)widthTiles;
    for (y = 0; y < 16; y++)
    {
        for (x = 0; x < 16; x++)
        {
            u8 pixel = fontPixel(atlas, x, y);
            if (pixel != 0)
            {
                u8 targetX = originX + x;
                u8 targetY = originY + y;
                u16 tile = (u16)(targetX >> 3) * heightTiles + (targetY >> 3);
                setPackedPixel(target + tile * 32, targetX & 7, targetY & 7, 1);
            }
        }
    }
}

static u16 bandColumnTile(u16 offset, u8 column)
{
    return messageTileBase() + offset + ((column < 9) ? (u16)column * 16 : 144);
}

static void queueRowChunk(u8 row, u8 column, u16 tile, u8 width)
{
    u8 first = column * 2;
    u16 tiles = (u16)(width >> 3) * 2;
    clearGlyphBuffer(tiles);
    if (first < messageRowLengths[row]) packGlyph(messageRows[row][first], 0, 0, width >> 3, 2);
    if ((width == 32) && (first + 1 < messageRowLengths[row])) packGlyph(messageRows[row][first + 1], 16, 0, 4, 2);
    VDP_loadTileData(glyphBuffer, tile, tiles, DMA_QUEUE_COPY);
}

static void queueBandRows(u8 upperRow, u8 lowerRow, u16 offset)
{
    u8 column;
    for (column = 0; column < 10; column++)
    {
        u8 width = (column == 9) ? 16 : 32;
        u16 tile = bandColumnTile(offset, column);
        u16 rowTiles = (u16)(width >> 3) * 2;
        queueRowChunk(upperRow, column, tile, width);
        queueRowChunk(lowerRow, column, tile + rowTiles, width);
    }
}

static void queueMergedBand(u8 upperRow, u8 lowerRow, u16 offset)
{
    u8 column;
    u8 maximum = messageRowLengths[upperRow] > messageRowLengths[lowerRow] ? messageRowLengths[upperRow] : messageRowLengths[lowerRow];
    u8 columns = (maximum + 1) >> 1;
    for (column = 0; column < columns; column++)
    {
        u8 first = column * 2;
        u8 width = (column == 9) ? 16 : 32;
        u16 tiles = (u16)(width >> 3) * 4;
        clearGlyphBuffer(tiles);
        if (first < messageRowLengths[upperRow]) packGlyph(messageRows[upperRow][first], 0, 0, width >> 3, 4);
        if ((width == 32) && (first + 1 < messageRowLengths[upperRow])) packGlyph(messageRows[upperRow][first + 1], 16, 0, 4, 4);
        if (first < messageRowLengths[lowerRow]) packGlyph(messageRows[lowerRow][first], 0, 16, width >> 3, 4);
        if ((width == 32) && (first + 1 < messageRowLengths[lowerRow])) packGlyph(messageRows[lowerRow][first + 1], 16, 16, 4, 4);
        VDP_loadTileData(glyphBuffer, bandColumnTile(offset, column), tiles, DMA_QUEUE_COPY);
    }
}

static void queueBottomRow(void)
{
    u8 column;
    for (column = 0; column < 9; column++)
        queueRowChunk(4, column, messageTileBase() + NOVEL_MESSAGE_BOTTOM_TILES + (u16)column * 8, 32);
}

static void queueCursorTile(u8 kind)
{
    const u32 *source = choiceCursorTile;
    if (kind == 1) source = messageDownTile;
    else if (kind == 2) source = messageAutoTile;
    VDP_loadTileData(source, messageTileBase() + NOVEL_MESSAGE_CURSOR_TILE, 1, DMA_QUEUE_COPY);
}

static void hideMessageSprites(void)
{
    u8 index;
    for (index = 0; index < messageSpriteAllocated; index++)
        if (messageSprites[index] != NULL) SPR_setVisibility(messageSprites[index], HIDDEN);
    messageSpriteActive = 0;
}

static void emitMessageSprite(const SpriteDefinition *definition, s16 x, s16 y, u16 tile)
{
    Sprite *sprite;
    if (messageSpriteActive >= NOVEL_MESSAGE_SPRITES) return;
    sprite = messageSprites[messageSpriteActive];
    if (sprite == NULL)
    {
        sprite = SPR_addSpriteEx(definition, x, y, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, tile), SPR_FLAG_INSERT_HEAD | SPR_FLAG_AUTO_VISIBILITY);
        messageSprites[messageSpriteActive] = sprite;
        if (sprite != NULL)
        {
            messageSpriteAllocated = messageSpriteActive + 1;
            SPR_setAlwaysOnTop(sprite);
        }
    }
    else if (sprite->definition != definition)
        SPR_setDefinition(sprite, definition);
    if (sprite == NULL) return;
    SPR_setVRAMTileIndex(sprite, tile);
    SPR_setPosition(sprite, x, y);
    SPR_setPalette(sprite, PAL0);
    SPR_setPriority(sprite, TRUE);
    SPR_setVisibility(sprite, VISIBLE);
    messageSpriteActive++;
}

static void finishMessageSprites(void)
{
    u8 index;
    for (index = messageSpriteActive; index < messageSpriteAllocated; index++)
        if (messageSprites[index] != NULL) SPR_setVisibility(messageSprites[index], HIDDEN);
}

static u16 bodyRowStart(u8 bodyRow)
{
    u8 row;
    u16 result = 0;
    for (row = 0; row < bodyRow; row++) result += messageRowLengths[row + 1];
    return result;
}

static u8 visibleBodyRowLength(u8 bodyRow)
{
    u16 start = bodyRowStart(bodyRow);
    u16 length = messageRowLengths[bodyRow + 1];
    if (messageRevealed <= start) return 0;
    if (messageRevealed >= start + length) return (u8)length;
    return (u8)(messageRevealed - start);
}

static void emitRow(u8 row, u8 visibleLength, s16 x, s16 y, u16 offset, bool lower)
{
    u8 column;
    u8 chunks = (visibleLength + 1) >> 1;
    for (column = 0; column < chunks; column++)
    {
        u8 remaining = visibleLength - column * 2;
        u16 tile = (offset == NOVEL_MESSAGE_BOTTOM_TILES)
            ? messageTileBase() + NOVEL_MESSAGE_BOTTOM_TILES + (u16)column * 8
            : bandColumnTile(offset, column);
        if (lower) tile += (column == 9) ? 4 : 8;
        emitMessageSprite(remaining == 1 ? &nov_msg_16x16 : &nov_msg_32x16, x + column * 32, y, tile);
    }
}

static void emitMerged(u8 upperRow, u8 lowerRow, s16 x, s16 y, u16 offset)
{
    u8 column;
    u8 maximum = messageRowLengths[upperRow] > messageRowLengths[lowerRow] ? messageRowLengths[upperRow] : messageRowLengths[lowerRow];
    u8 chunks = (maximum + 1) >> 1;
    for (column = 0; column < chunks; column++)
    {
        u8 second = column * 2 + 1;
        bool wide = (second < messageRowLengths[upperRow]) || (second < messageRowLengths[lowerRow]);
        emitMessageSprite(wide ? &nov_msg_32x32 : &nov_msg_16x32, x + column * 32, y, bandColumnTile(offset, column));
    }
}

static void renderMessageSprites(void)
{
    u8 bottomVisible;
    if (!windowVisible)
    {
        hideMessageSprites();
        return;
    }
    messageSpriteActive = 0;
    if (messageBandMerged[0])
        emitMerged(0, 1, 8, NOVEL_MESSAGE_TOP_Y, NOVEL_MESSAGE_TOP_TILES);
    else
    {
        emitRow(0, messageRowLengths[0], 8, NOVEL_MESSAGE_TOP_Y, NOVEL_MESSAGE_TOP_TILES, FALSE);
        emitRow(1, visibleBodyRowLength(0), 8, NOVEL_MESSAGE_TOP_Y + 16, NOVEL_MESSAGE_TOP_TILES, TRUE);
    }
    if (messageBandMerged[1])
        emitMerged(2, 3, 8, NOVEL_MESSAGE_TOP_Y + 32, NOVEL_MESSAGE_MIDDLE_TILES);
    else
    {
        emitRow(2, visibleBodyRowLength(1), 8, NOVEL_MESSAGE_TOP_Y + 32, NOVEL_MESSAGE_MIDDLE_TILES, FALSE);
        emitRow(3, visibleBodyRowLength(2), 8, NOVEL_MESSAGE_TOP_Y + 48, NOVEL_MESSAGE_MIDDLE_TILES, TRUE);
    }
    bottomVisible = visibleBodyRowLength(3);
    emitRow(4, bottomVisible, 8, NOVEL_MESSAGE_TOP_Y + 64, NOVEL_MESSAGE_BOTTOM_TILES, FALSE);
    if (messageCursorKind != 0)
        emitMessageSprite(&nov_msg_8x8, 304, NOVEL_MESSAGE_TOP_Y + 72, messageTileBase() + NOVEL_MESSAGE_CURSOR_TILE);
    finishMessageSprites();
}

static s16 choiceTopY(void)
{
    return NOVEL_MESSAGE_TOP_Y + ((activeChoice && (activeChoice->layoutFlags & NOV_CHOICE_LOWERED)) ? 16 : 0);
}

static void renderChoiceSprites(void)
{
    const s16 topY = choiceTopY();
    messageSpriteActive = 0;
    emitMerged(0, 1, 40, topY, NOVEL_MESSAGE_TOP_TILES);
    emitMerged(2, 3, 40, topY + 32, NOVEL_MESSAGE_MIDDLE_TILES);
    emitMessageSprite(&nov_msg_8x8, 8, topY + choiceIndex * 16 + 4, messageTileBase() + NOVEL_MESSAGE_CURSOR_TILE);
    finishMessageSprites();
}

static void disarmMessageShadow(void)
{
    shadowArmed = FALSE;
}

static void hideWindow(void)
{
    if (!windowVisible) return;
    windowVisible = FALSE;
    hideMessageSprites();
    disarmMessageShadow();
}

static void showWindow(void)
{
    hideMessageSprites();
    windowVisible = TRUE;
    shadowArmed = TRUE;
    messageCursorKind = 0;
}

static void clearMessageRows(void)
{
    u8 row;
    u8 column;
    for (row = 0; row < NOVEL_MESSAGE_ROWS; row++)
    {
        messageRowLengths[row] = 0;
        for (column = 0; column < NOVEL_MESSAGE_COLUMNS; column++) messageRows[row][column] = 0;
    }
}

static void collectSingleRow(const u8 *text, u8 row, u8 limit)
{
    u16 position = 0;
    u16 atlas = 0;
    bool newline;
    while ((messageRowLengths[row] < limit) && sjisGlyph(text, &position, &atlas, &newline))
    {
        if (newline) break;
        messageRows[row][messageRowLengths[row]++] = atlas;
    }
}

static void collectBodyRows(const u8 *text)
{
    u16 position = 0;
    u16 atlas = 0;
    u8 row = 1;
    bool newline;
    while ((row < NOVEL_MESSAGE_ROWS) && sjisGlyph(text, &position, &atlas, &newline))
    {
        u8 limit = row == 4 ? 18 : 19;
        if (newline)
        {
            row++;
            continue;
        }
        if (messageRowLengths[row] >= limit)
        {
            row++;
            if (row >= NOVEL_MESSAGE_ROWS) break;
        }
        messageRows[row][messageRowLengths[row]++] = atlas;
    }
}

static void setMouthAnimation(s8 slot, u16 mouth)
{
    u16 animation;
    if ((slot < 0) || (slot >= NOVEL_SPRITE_SLOTS) || (actorSprites[(u8)slot] == NULL)) return;
    animation = (u16)actorAnimations[(u8)slot] + mouth;
    if (actorSprites[(u8)slot]->definition->numAnimation > animation) SPR_setAnim(actorSprites[(u8)slot], animation);
}

static u16 messageBodyGlyphCount(void)
{
    return messageRowLengths[1] + messageRowLengths[2] + messageRowLengths[3] + messageRowLengths[4];
}

static void prepareMessagePage(void)
{
    clearMessageRows();
    collectSingleRow(activeMessage->speaker, 0, 16);
    collectBodyRows(activeMessage->pages[activeMessagePage]);
    messageRevealed = 0;
    messageTimer = 0;
    messageComplete = FALSE;
    messagePrepareStage = 0;
    messageRevealStage = 0;
    messageBandMerged[0] = FALSE;
    messageBandMerged[1] = FALSE;
    autoCounter = 0;
    messageCursorTimer = 0;
    setMessageColor(activeMessage->color);
    showWindow();
    setMouthAnimation(activeMessage->mouthSlot, 1);
    runtimeMode = MODE_MESSAGE_PREP;
}

static void mergeCompletedBands(void)
{
    u16 firstEnd = messageRowLengths[1];
    u16 middleEnd = firstEnd + messageRowLengths[2] + messageRowLengths[3];
    if (!(activeMessage->layoutFlags & NOV_MSG_SEPARATE_TOP) && !messageBandMerged[0] && (messageRevealed >= firstEnd))
    {
        queueMergedBand(0, 1, NOVEL_MESSAGE_TOP_TILES);
        messageBandMerged[0] = TRUE;
    }
    if (!messageBandMerged[1] && (messageRevealed >= middleEnd))
    {
        queueMergedBand(2, 3, NOVEL_MESSAGE_MIDDLE_TILES);
        messageBandMerged[1] = TRUE;
    }
}

static void completeMessage(void)
{
    messageRevealed = messageBodyGlyphCount();
    mergeCompletedBands();
    messageComplete = TRUE;
    autoCounter = 0;
    setMouthAnimation(activeMessage->mouthSlot, 0);
    renderMessageSprites();
}

static void updateRevealAll(void)
{
    if (messageRevealStage == 1)
    {
        messageRevealed = messageRowLengths[1];
        mergeCompletedBands();
        renderMessageSprites();
        messageRevealStage = 2;
        return;
    }
    if (messageRevealStage == 2)
    {
        messageRevealed = messageRowLengths[1] + messageRowLengths[2] + messageRowLengths[3];
        mergeCompletedBands();
        renderMessageSprites();
        messageRevealStage = 3;
        return;
    }
    messageRevealStage = 0;
    completeMessage();
}

static void updateMessagePrepare(void)
{
    if (messagePrepareStage == 0)
        queueBandRows(0, 1, NOVEL_MESSAGE_TOP_TILES);
    else if (messagePrepareStage == 1)
        queueBandRows(2, 3, NOVEL_MESSAGE_MIDDLE_TILES);
    else
    {
        queueBottomRow();
        queueCursorTile(1);
        renderMessageSprites();
        runtimeMode = MODE_MESSAGE;
        if (messageBodyGlyphCount() == 0) completeMessage();
        else if (activeMessageSpeed == 0) messageRevealStage = 1;
    }
    messagePrepareStage++;
}

static bool messageAdvancePressed(void)
{
    return (pressedJoy & (BUTTON_B | BUTTON_C | BUTTON_START | BUTTON_RIGHT | BUTTON_DOWN)) != 0;
}

static void setMessageCursor(u8 kind)
{
    if (messageCursorKind == kind) return;
    if (kind != 0) queueCursorTile(kind);
    messageCursorKind = kind;
    renderMessageSprites();
}

static void updateMessageCursor(void)
{
    if (autoEnabled)
    {
        setMessageCursor(2);
        return;
    }
    if (!messageComplete)
    {
        setMessageCursor(0);
        return;
    }
    messageCursorTimer = (messageCursorTimer + 1) % 60;
    setMessageCursor(messageCursorTimer < 30 ? 1 : 0);
}

static void finishMessage(void)
{
    setMouthAnimation(activeMessage->mouthSlot, 0);
    restoreMessageColor();
    messageCursorKind = 0;
    hideMessageSprites();
    activeMessage = NULL;
    runtimeMode = MODE_RUN;
}

static void updateMessage(void)
{
    u16 total = messageBodyGlyphCount();
    if (messageRevealStage != 0)
    {
        updateRevealAll();
        return;
    }
    updateMessageCursor();
    if (!messageComplete)
    {
        if (messageAdvancePressed())
        {
            messageRevealStage = 1;
            return;
        }
        messageTimer++;
        if (messageTimer >= activeMessageSpeed)
        {
            messageTimer = 0;
            if (messageRevealed < total) messageRevealed++;
            mergeCompletedBands();
            if (messageRevealed >= total) completeMessage();
            else renderMessageSprites();
        }
        return;
    }
    if (autoEnabled)
    {
        autoCounter++;
        if (autoCounter < runtimeProject->autoWaitFrames) return;
    }
    else if (!messageAdvancePressed()) return;
    if (activeMessagePage + 1 < activeMessage->pageCount)
    {
        activeMessagePage++;
        prepareMessagePage();
    }
    else
        finishMessage();
}

static void collectChoiceRows(void)
{
    u8 row;
    clearMessageRows();
    for (row = 0; row < activeChoice->count; row++) collectSingleRow(activeChoice->options[row].label, row, 17);
}

static void beginChoice(void)
{
    showWindow();
    restoreMessageColor();
    collectChoiceRows();
    messagePrepareStage = 0;
    runtimeMode = MODE_CHOICE_PREP;
}

static void updateChoicePrepare(void)
{
    if (messagePrepareStage == 0)
    {
        queueMergedBand(0, 1, NOVEL_MESSAGE_TOP_TILES);
        messagePrepareStage++;
        return;
    }
    queueMergedBand(2, 3, NOVEL_MESSAGE_MIDDLE_TILES);
    queueCursorTile(0);
    renderChoiceSprites();
    messagePrepareStage++;
    runtimeMode = MODE_CHOICE;
}

static void updateChoice(void);
static void enterScene(s16 sceneIndex);

static void updateChoice(void)
{
    u8 oldIndex = choiceIndex;
    if ((pressedJoy & BUTTON_UP) != 0)
        choiceIndex = (choiceIndex == 0) ? (activeChoice->count - 1) : (choiceIndex - 1);
    else if ((pressedJoy & BUTTON_DOWN) != 0)
        choiceIndex = (choiceIndex + 1) % activeChoice->count;
    if (choiceIndex != oldIndex) renderChoiceSprites();
    if ((pressedJoy & (BUTTON_B | BUTTON_C | BUTTON_START)) != 0)
    {
        const NovelChoiceOption *option = &activeChoice->options[choiceIndex];
        s16 targetScene = option->targetScene;
        setVariable(activeChoice->variableIndex, option->value);
        activeChoice = NULL;
        hideWindow();
        if (targetScene >= 0) enterScene(targetScene);
        else runtimeMode = MODE_RUN;
    }
}
static OverlayTile *overlayTile(u16 cell)
{
    u16 index;
    for (index = 0; index < overlayTileCount; index++)
        if (overlayTiles[index].cell == cell)
            return &overlayTiles[index];
    if (overlayTileCount >= NOVEL_OVERLAY_MAX_TILES)
        return NULL;
    overlayTiles[overlayTileCount].cell = cell;
    for (index = 0; index < 32; index++)
        overlayTiles[overlayTileCount].pixels[index] = 0;
    overlayTileCount++;
    return &overlayTiles[overlayTileCount - 1];
}

static void overlaySetPixel(s16 x, s16 y, u8 color)
{
    OverlayTile *tile;
    u16 cell;
    if ((x < 0) || (x >= 320) || (y < 0) || (y >= 224))
        return;
    cell = (u16)(y >> 3) * NOVEL_PLANE_WIDTH + (u16)(x >> 3);
    tile = overlayTile(cell);
    if (tile != NULL)
        setPackedPixel(tile->pixels, x & 7, y & 7, color);
}

static void renderSpriteTexts(void)
{
    u16 index;
    SYS_disableInts();
    u8 slot;
    for (index = 0; index < previousOverlayCount; index++)
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, 0), previousOverlayCells[index] % NOVEL_PLANE_WIDTH, previousOverlayCells[index] / NOVEL_PLANE_WIDTH);
    previousOverlayCount = 0;
    overlayTileCount = 0;
    for (slot = 0; slot < NOVEL_SPRITE_TEXT_SLOTS; slot++)
    {
        SpriteTextState *state = &spriteTexts[slot];
        u16 position = 0;
        u16 atlas = 0;
        u8 glyph = 0;
        s16 originX;
        s16 x;
        s16 y;
        bool newline;
        if (!state->visible || !state->blinkOn || (state->definition == NULL))
            continue;
        originX = effectiveX(state->x);
        x = originX;
        y = state->y;
        while ((glyph < 32) && sjisGlyph(state->definition->text, &position, &atlas, &newline))
        {
            u8 pixelX;
            u8 pixelY;
            if (newline)
            {
                x = originX;
                y += 16;
                continue;
            }
            for (pixelY = 0; pixelY < 16; pixelY++)
                for (pixelX = 0; pixelX < 16; pixelX++)
                    if (fontPixel(atlas, pixelX, pixelY) != 0)
                        overlaySetPixel(x + pixelX, y + pixelY, 1);
            x += 16;
            glyph++;
        }
    }
    for (index = 0; index < overlayTileCount; index++)
    {
        u16 tileIndex = workTileBase + index;
        u16 cell = overlayTiles[index].cell;
        if (tileIndex > TILE_USER_MAX_INDEX)
            break;
        VDP_loadTileData((u32 *)overlayTiles[index].pixels, tileIndex, 1, DMA);
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, tileIndex), cell % NOVEL_PLANE_WIDTH, cell / NOVEL_PLANE_WIDTH);
        previousOverlayCells[previousOverlayCount++] = cell;
    }
    SYS_enableInts();
}
static void clearSpriteTexts(void)
{
    u8 slot;
    for (slot = 0; slot < NOVEL_SPRITE_TEXT_SLOTS; slot++)
    {
        spriteTexts[slot].definition = NULL;
        spriteTexts[slot].visible = FALSE;
        spriteTexts[slot].blinkOn = TRUE;
        spriteTexts[slot].blinkTimer = 0;
    }
    renderSpriteTexts();
}

static void updateSpriteTextBlink(void)
{
    u8 slot;
    bool changed = FALSE;
    for (slot = 0; slot < NOVEL_SPRITE_TEXT_SLOTS; slot++)
    {
        SpriteTextState *state = &spriteTexts[slot];
        if (!state->visible || (state->definition == NULL) || (state->definition->blinkFrames == 0))
            continue;
        state->blinkTimer++;
        if (state->blinkTimer >= state->definition->blinkFrames)
        {
            state->blinkTimer = 0;
            state->blinkOn = !state->blinkOn;
            changed = TRUE;
        }
    }
    if (changed)
        renderSpriteTexts();
}

static void flushPendingActorClear(void)
{
    if (!actorSceneClearPending)
        return;
    SPR_update();
    SYS_doVBlankProcess();
    actorSceneClearPending = FALSE;
}

static void loadBackground(const NovelCommand *command)
{
    const Image *image = novelDataBackground((u16)command->target);
    u16 palette = (u16)command->count & 3;
    u16 paletteId = novelDataBackgroundPaletteId((u16)command->target);
    u16 x;
    u16 y;
    if (image == NULL)
        return;
    hideWindow();
    if (command->flags & NOV_FLAG_FADE)
        PAL_fadeOutAll(command->frames, FALSE);
    flushPendingActorClear();
    VDP_clearPlane(BG_B, TRUE);
    if (backgroundPalette != NOVEL_PALETTE_NONE)
        releasePaletteOwner(backgroundPalette);
    backgroundPalette = (u8)palette;
    claimPaletteOwner(backgroundPalette);
    loadPhysicalPalette(palette, image->palette->data, paletteId);
    x = runtimeProject->legacyCoordinates ? (u16)(4 + command->x) : (u16)(command->x >> 3);
    y = runtimeProject->legacyCoordinates ? (u16)command->y : (u16)(command->y >> 3);
    VDP_drawImageEx(BG_B, image, TILE_ATTR_FULL(palette, FALSE, FALSE, FALSE, TILE_USER_INDEX), x, y, FALSE, TRUE);
    backgroundTileCount = image->tileset->numTile;
    workTileBase = TILE_USER_INDEX + backgroundTileCount;
    if (command->flags & NOV_FLAG_FADE)
        PAL_fadeInAll(currentPalette, command->aux, FALSE);
    renderSpriteTexts();
}
static void setActor(const NovelCommand *command)
{
    u8 slot = command->slot;
    const SpriteDefinition *definition;
    u16 palette;
    u16 paletteId;
    if (slot >= NOVEL_SPRITE_SLOTS)
        return;
    if (!(command->flags & NOV_FLAG_VISIBLE) || (command->target < 0))
    {
        if (actorSprites[slot] != NULL)
            SPR_setVisibility(actorSprites[slot], HIDDEN);
        releasePaletteOwner(actorPalettes[slot]);
        actorPalettes[slot] = NOVEL_PALETTE_NONE;
        actorResources[slot] = -1;
        actorAnimations[slot] = 0;
        actorMoves[slot].active = FALSE;
        return;
    }
    definition = novelDataSprite((u16)command->target);
    if (definition == NULL)
        return;
    palette = (u16)command->count & 3;
    paletteId = novelDataSpritePaletteId((u16)command->target);
    loadPhysicalPalette(palette, definition->palette->data, paletteId);
    if (actorSprites[slot] == NULL)
        actorSprites[slot] = SPR_addSpriteEx(definition, effectiveX(command->x), command->y, TILE_ATTR(palette, FALSE, FALSE, FALSE), SPR_FLAG_AUTO_VISIBILITY | SPR_FLAG_AUTO_VRAM_ALLOC | SPR_FLAG_AUTO_TILE_UPLOAD);
    else if (actorResources[slot] != command->target)
        SPR_setDefinition(actorSprites[slot], definition);
    if (actorSprites[slot] == NULL)
        return;
    if (actorPalettes[slot] != palette)
    {
        releasePaletteOwner(actorPalettes[slot]);
        actorPalettes[slot] = (u8)palette;
        claimPaletteOwner(actorPalettes[slot]);
    }
    actorResources[slot] = command->target;
    actorAnimations[slot] = (s16)command->aux;
    SPR_setPalette(actorSprites[slot], palette);
    SPR_setPosition(actorSprites[slot], effectiveX(command->x), command->y);
    SPR_setHFlip(actorSprites[slot], (command->flags & NOV_FLAG_FLIP_X) != 0);
    SPR_setVFlip(actorSprites[slot], (command->flags & NOV_FLAG_FLIP_Y) != 0);
    if (actorSprites[slot]->definition->numAnimation > command->aux)
        SPR_setAnim(actorSprites[slot], command->aux);
    SPR_setVisibility(actorSprites[slot], VISIBLE);
}
static void startMove(const NovelCommand *command)
{
    MoveState *move;
    Sprite *sprite;
    if ((command->slot >= NOVEL_SPRITE_SLOTS) || (actorSprites[command->slot] == NULL))
        return;
    sprite = actorSprites[command->slot];
    if ((command->target >= 0) && (actorResources[command->slot] == command->target) && (sprite->definition->numAnimation > command->aux))
    {
        actorAnimations[command->slot] = (s16)command->aux;
        SPR_setAnim(sprite, command->aux);
    }
    move = &actorMoves[command->slot];
    move->active = TRUE;
    move->startX = SPR_getPositionX(sprite);
    move->startY = SPR_getPositionY(sprite);
    move->targetX = effectiveX(command->x);
    move->targetY = command->y;
    move->frames = command->frames ? command->frames : 1;
    move->elapsed = 0;
}

static bool updateMoves(void)
{
    u8 slot;
    bool any = FALSE;
    for (slot = 0; slot < NOVEL_SPRITE_SLOTS; slot++)
    {
        MoveState *move = &actorMoves[slot];
        if (!move->active || (actorSprites[slot] == NULL))
            continue;
        move->elapsed++;
        if (move->elapsed >= move->frames)
        {
            SPR_setPosition(actorSprites[slot], move->targetX, move->targetY);
            move->active = FALSE;
        }
        else
        {
            s16 x = move->startX + (s32)(move->targetX - move->startX) * move->elapsed / move->frames;
            s16 y = move->startY + (s32)(move->targetY - move->startY) * move->elapsed / move->frames;
            SPR_setPosition(actorSprites[slot], x, y);
            any = TRUE;
        }
    }
    return any;
}

static void enterScene(s16 sceneIndex)
{
    u8 slot;
    if ((sceneIndex < 0) || (sceneIndex >= runtimeProject->sceneCount))
    {
        runtimeMode = MODE_HALT;
        return;
    }
    currentScene = sceneIndex;
    currentPc = 0;
    runtimeMode = MODE_RUN;
    inputWatcherCount = 0;
    syncInputActive = FALSE;
    syncInputMask = 0;
    syncInputTarget = -1;
    activeMessage = NULL;
    activeChoice = NULL;
    restoreMessageColor();
    hideWindow();
    for (slot = 0; slot < NOVEL_SPRITE_SLOTS; slot++)
        actorMoves[slot].active = FALSE;
    clearSpriteTexts();
    if (runtimeProject->scenes[sceneIndex].fullScreen)
    {
        for (slot = 0; slot < NOVEL_SPRITE_SLOTS; slot++)
        {
            if (actorSprites[slot] != NULL)
            {
                SPR_releaseSprite(actorSprites[slot]);
                actorSprites[slot] = NULL;
            }
            releasePaletteOwner(actorPalettes[slot]);
            actorPalettes[slot] = NOVEL_PALETTE_NONE;
            actorResources[slot] = -1;
            actorAnimations[slot] = 0;
        }
        actorSceneClearPending = TRUE;
    }
}
static void executeCommand(const NovelCommand *command)
{
    switch (command->type)
    {
        case NOV_CMD_BACKGROUND:
            loadBackground(command);
            currentPc++;
            break;
        case NOV_CMD_SPRITE:
            setActor(command);
            currentPc++;
            break;
        case NOV_CMD_MOVE:
            startMove(command);
            currentPc++;
            if (!(command->flags & NOV_FLAG_ASYNC))
                runtimeMode = MODE_MOVE;
            break;
        case NOV_CMD_MESSAGE:
            activeMessage = (const NovelMessage *)command->data;
            activeMessagePage = 0;
            activeMessageSpeed = currentMessageSpeed();
            currentPc++;
            prepareMessagePage();
            break;
        case NOV_CMD_AUDIO:
            if (!(command->flags & NOV_FLAG_AUDIO_IGNORED))
            {
                if (command->flags & NOV_FLAG_AUDIO_STOP)
                {
                    if (command->flags & NOV_FLAG_AUDIO_BGM) XGM2_stop();
                    if (command->flags & NOV_FLAG_AUDIO_SFX) XGM2_stopPCM(SOUND_PCM_CH2);
                }
                else if (command->flags & NOV_FLAG_AUDIO_BGM) novelDataPlayBgm((u16)command->target);
                else if (command->flags & NOV_FLAG_AUDIO_SFX) novelDataPlaySfx((u16)command->target);
            }
            currentPc++;
            break;
        case NOV_CMD_WAIT:
            currentPc++;
            if (command->frames != 0)
            {
                waitCounter = command->frames;
                runtimeMode = MODE_WAIT;
            }
            break;
        case NOV_CMD_JUMP:
            enterScene(command->target);
            break;
        case NOV_CMD_INPUT:
        {
            u16 mask = command->aux;
            currentPc++;
            if (command->flags & NOV_FLAG_INPUT_CANCEL)
            {
                inputWatcherCount = 0;
            }
            else if (mask == 0)
            {
                break;
            }
            else if (command->flags & NOV_FLAG_ASYNC)
            {
                u8 readIndex;
                u8 writeIndex = 0;
                for (readIndex = 0; readIndex < inputWatcherCount; readIndex++)
                {
                    u16 remaining = inputWatcherMasks[readIndex] & (u16)~mask;
                    if (remaining == 0) continue;
                    inputWatcherMasks[writeIndex] = remaining;
                    inputWatcherTargets[writeIndex] = inputWatcherTargets[readIndex];
                    writeIndex++;
                }
                if (writeIndex < NOVEL_INPUT_WATCHERS)
                {
                    inputWatcherMasks[writeIndex] = mask;
                    inputWatcherTargets[writeIndex] = command->target;
                    writeIndex++;
                }
                inputWatcherCount = writeIndex;
            }
            else
            {
                syncInputActive = TRUE;
                syncInputMask = mask;
                syncInputTarget = command->target;
                runtimeMode = MODE_INPUT;
            }
            break;
        }
        case NOV_CMD_SPRITETEXT:
            if (command->slot < NOVEL_SPRITE_TEXT_SLOTS)
            {
                SpriteTextState *state = &spriteTexts[command->slot];
                state->definition = (const NovelSpriteText *)command->data;
                state->x = command->x;
                state->y = command->y;
                state->visible = (command->flags & NOV_FLAG_VISIBLE) != 0;
                state->blinkOn = TRUE;
                state->blinkTimer = 0;
                renderSpriteTexts();
            }
            currentPc++;
            break;
        case NOV_CMD_CHOICE:
            activeChoice = (const NovelChoice *)command->data;
            choiceIndex = activeChoice->defaultIndex;
            currentPc++;
            beginChoice();
            break;
        case NOV_CMD_VARIABLE:
        {
            s16 current = variableValue(command->target);
            if (command->flags == NOV_VAR_ADD) setVariable(command->target, clampS16((s32)current + command->x));
            else if (command->flags == NOV_VAR_SUB) setVariable(command->target, clampS16((s32)current - command->x));
            else if (command->flags == NOV_VAR_RANDOM) setVariable(command->target, randomRange(command->x, command->y));
            else setVariable(command->target, command->x);
            currentPc++;
            break;
        }
        case NOV_CMD_IF:
        {
            s16 branch = compareValue(variableValue(command->target), command->flags, (s16)command->aux) ? command->x : command->y;
            currentPc++;
            if (branch >= 0) currentPc = (u16)branch;
            break;
        }
        case NOV_CMD_SWITCH:
        {
            const NovelSwitch *branch = (const NovelSwitch *)command->data;
            s16 destination = branch->defaultPc;
            s16 value = variableValue(command->target);
            u8 index;
            for (index = 0; index < branch->count; index++)
            {
                if (branch->cases[index].value == value)
                {
                    destination = branch->cases[index].targetPc;
                    break;
                }
            }
            currentPc++;
            if (destination >= 0) currentPc = (u16)destination;
            break;
        }
        case NOV_CMD_GOTO:
            currentPc++;
            if (command->target >= 0) currentPc = (u16)command->target;
            break;
        case NOV_CMD_EFFECT:
        {
            u16 index;
            u8 slotIndex;
            currentPc++;
            effectType = command->flags;
            if (effectType == NOV_EFFECT_BLANK)
            {
                for (slotIndex = 0; slotIndex < NOVEL_SPRITE_SLOTS; slotIndex++)
                {
                    actorMoves[slotIndex].active = FALSE;
                    if (actorSprites[slotIndex] != NULL) SPR_setVisibility(actorSprites[slotIndex], HIDDEN);
                    releasePaletteOwner(actorPalettes[slotIndex]);
                    actorPalettes[slotIndex] = NOVEL_PALETTE_NONE;
                }
                if (backgroundPalette != NOVEL_PALETTE_NONE)
                    releasePaletteOwner(backgroundPalette);
                backgroundPalette = NOVEL_PALETTE_NONE;
                restoreMessageColor();
                hideWindow();
                clearSpriteTexts();
                VDP_clearPlane(BG_A, TRUE);
                VDP_clearPlane(BG_B, TRUE);
                backgroundTileCount = 0;
                workTileBase = TILE_USER_INDEX;
                for (index = 0; index < 64; index++) effectPalette[index] = command->aux;
                for (index = 0; index < 4; index++) loadedPaletteIds[index] = 0xFFFF;
                setAllColorsSafe(effectPalette);
            }
            else if (effectType == NOV_EFFECT_SHAKE)
            {
                effectFrames = command->frames;
                effectIntensity = command->x ? command->x : 2;
                if (effectFrames != 0) runtimeMode = MODE_EFFECT;
            }
            else if (effectType == NOV_EFFECT_FLASH)
            {
                for (index = 0; index < 64; index++) effectPalette[index] = command->aux;
                setAllColorsSafe(effectPalette);
                effectFrames = command->frames ? command->frames : 1;
                runtimeMode = MODE_EFFECT;
            }
            else if (effectType == NOV_EFFECT_FADE_IN)
            {
                if (command->frames == 0) setAllColorsSafe(currentPalette);
                else
                {
                    startFadeInSafe(command->frames);
                    runtimeMode = MODE_EFFECT;
                }
            }
            else
            {
                for (index = 0; index < 64; index++) effectPalette[index] = command->aux;
                if (command->frames == 0) setAllColorsSafe(effectPalette);
                else
                {
                    startFadeToSafe(effectPalette, command->frames);
                    runtimeMode = MODE_EFFECT;
                }
            }
            break;
        }
        default:
            currentPc++;
            break;
    }
}

static void executeRun(void)
{
    u16 guard = 0;
    while ((runtimeMode == MODE_RUN) && (guard < 512))
    {
        const NovelScene *scene = &runtimeProject->scenes[currentScene];
        if (currentPc >= scene->commandCount)
        {
            if (scene->nextScene >= 0)
                enterScene(scene->nextScene);
            else
                runtimeMode = MODE_HALT;
            return;
        }
        executeCommand(&scene->commands[currentPc]);
        guard++;
    }
}

static void updateInputWatchers(void)
{
    u8 index;
    for (index = 0; index < inputWatcherCount; index++)
    {
        if ((pressedJoy & inputWatcherMasks[index]) != 0)
        {
            s16 target = inputWatcherTargets[index];
            u8 slot;
            inputWatcherCount = 0;
            syncInputActive = FALSE;
            activeMessage = NULL;
            activeChoice = NULL;
            restoreMessageColor();
            for (slot = 0; slot < NOVEL_SPRITE_SLOTS; slot++) actorMoves[slot].active = FALSE;
            hideWindow();
            if (target >= 0) currentPc = (u16)target;
            runtimeMode = MODE_RUN;
            return;
        }
    }
    if (syncInputActive && ((pressedJoy & syncInputMask) != 0))
    {
        s16 target = syncInputTarget;
        inputWatcherCount = 0;
        syncInputActive = FALSE;
        restoreMessageColor();
        hideWindow();
        if (target >= 0) currentPc = (u16)target;
        runtimeMode = MODE_RUN;
    }
}
static void updateEffect(void)
{
    s16 offset;
    if ((effectType == NOV_EFFECT_FADE_OUT) || (effectType == NOV_EFFECT_FADE_IN))
    {
        if (!PAL_isDoingFade()) runtimeMode = MODE_RUN;
        return;
    }
    if (effectType == NOV_EFFECT_FLASH)
    {
        if (effectFrames > 0) effectFrames--;
        if (effectFrames == 0)
        {
            setAllColorsSafe(currentPalette);
            runtimeMode = MODE_RUN;
        }
        return;
    }
    if (effectFrames == 0)
    {
        setHorizontalScrollSafe(0, 0);
        runtimeMode = MODE_RUN;
        return;
    }
    offset = (effectFrames & 1) ? effectIntensity : -effectIntensity;
    setHorizontalScrollSafe(offset, -offset);
    effectFrames--;
}
void novelInit(const NovelProject *project)
{
    u8 slot;
    u16 index;
    runtimeProject = project;
    currentScene = -1;
    currentPc = 0;
    runtimeMode = MODE_RUN;
    previousJoy = 0;
    variableCount = project->variableCount > NOVEL_VARIABLE_MAX ? NOVEL_VARIABLE_MAX : project->variableCount;
    for (index = 0; index < variableCount; index++)
        variables[index] = project->initialVariables ? project->initialVariables[index] : 0;
    for (; index < NOVEL_VARIABLE_MAX; index++) variables[index] = 0;
    autoEnabled = variableCount > 0 ? variables[0] != 0 : project->autoEnabled;
    if (variableCount > 0) variables[0] = autoEnabled ? 1 : 0;
    randomState = 0xACE1;
    backgroundTileCount = 0;
    workTileBase = TILE_USER_INDEX;
    windowVisible = FALSE;
    shadowArmed = FALSE;
    messageSpriteAllocated = 0;
    messageSpriteActive = 0;
    messagePrepareStage = 0;
    messageRevealStage = 0;
    for (slot = 0; slot < NOVEL_MESSAGE_SPRITES; slot++) messageSprites[slot] = NULL;
    actorSceneClearPending = FALSE;
    previousOverlayCount = 0;
    overlayTileCount = 0;
    inputWatcherCount = 0;
    syncInputActive = FALSE;
    syncInputMask = 0;
    syncInputTarget = -1;
    effectType = NOV_EFFECT_SHAKE;
    for (slot = 0; slot < NOVEL_SPRITE_SLOTS; slot++)
    {
        actorSprites[slot] = NULL;
        actorResources[slot] = -1;
        actorAnimations[slot] = 0;
        actorMoves[slot].active = FALSE;
    }
    initializeSystemPalette();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_clearPlane(WINDOW, TRUE);
    JOY_init();
    Z80_loadDriver(Z80_DRIVER_XGM2, TRUE);
    SPR_initEx(project->spriteVramTiles);
    VDP_setHilightShadow(FALSE);
    VDP_setHInterrupt(FALSE);
    SYS_setVIntCallback(novelVInt);
    SYS_setHIntCallback(novelHInt);
    enterScene(project->startScene);
}
void novelUpdate(void)
{
    u16 joy = JOY_readJoypad(JOY_1);
    pressedJoy = joy & ~previousJoy;
    previousJoy = joy;
    if (pressedJoy & BUTTON_A)
        setVariable(0, autoEnabled ? 0 : 1);
    if (runtimeMode != MODE_MOVE)
        updateMoves();
    updateSpriteTextBlink();
    updateInputWatchers();
    switch (runtimeMode)
    {
        case MODE_RUN:
            executeRun();
            break;
        case MODE_WAIT:
            if (waitCounter > 0) waitCounter--;
            if (waitCounter == 0) runtimeMode = MODE_RUN;
            break;
        case MODE_INPUT:
            break;
        case MODE_MESSAGE_PREP:
            updateMessagePrepare();
            break;
        case MODE_MESSAGE:
            updateMessage();
            break;
        case MODE_CHOICE_PREP:
            updateChoicePrepare();
            break;
        case MODE_CHOICE:
            updateChoice();
            break;
        case MODE_MOVE:
            if (!updateMoves()) runtimeMode = MODE_RUN;
            break;
        case MODE_EFFECT:
            updateEffect();
            break;
        case MODE_HALT:
            if (pressedJoy & (BUTTON_B | BUTTON_C | BUTTON_START))
                enterScene(runtimeProject->startScene);
            break;
        default:
            runtimeMode = MODE_RUN;
            break;
    }
    SPR_update();
    actorSceneClearPending = FALSE;
}
