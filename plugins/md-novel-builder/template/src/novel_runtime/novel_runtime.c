#include <genesis.h>
#include "novel.h"
#include "generated/novel_data.h"
#include "novel_runtime/novel_runtime.h"

#define NOVEL_PLANE_WIDTH          64
#define NOVEL_WINDOW_TOP           16
#define NOVEL_WINDOW_ROWS          12
#define NOVEL_MESSAGE_MAX_GLYPHS   96
#define NOVEL_MESSAGE_LOAD_BATCH   48
#define NOVEL_OVERLAY_MAX_TILES    192
#define NOVEL_SPRITE_TEXT_SLOTS    4
#define NOVEL_SPRITE_SLOTS         4
#define NOVEL_INPUT_WATCHERS       7
#define NOVEL_VARIABLE_MAX         255

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
    u16 atlas;
    u16 tile;
    u8 x;
    u8 y;
    bool body;
} GlyphPlacement;

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

static u8 inputWatcherCount;
static u16 inputWatcherMasks[NOVEL_INPUT_WATCHERS];
static s16 inputWatcherTargets[NOVEL_INPUT_WATCHERS];
static bool syncInputActive;
static u16 syncInputMask;
static s16 syncInputTarget;

static u16 currentPalette[64];
static u16 backgroundTileCount;
static u16 workTileBase;
static bool windowVisible;

static const NovelMessage *activeMessage;
static u8 activeMessagePage;
static GlyphPlacement messageGlyphs[NOVEL_MESSAGE_MAX_GLYPHS];
static u16 messageGlyphCount;
static u16 messageBodyStart;
static u16 messageLoaded;
static u16 messageRevealed;
static u16 messageTimer;
static bool messageComplete;

static const NovelChoice *activeChoice;
static u8 choiceIndex;
static u8 choiceLoadIndex;
static u16 choiceNextTile;

static SpriteTextState spriteTexts[NOVEL_SPRITE_TEXT_SLOTS];
static OverlayTile overlayTiles[NOVEL_OVERLAY_MAX_TILES];
static u16 overlayTileCount;
static u16 previousOverlayCells[NOVEL_OVERLAY_MAX_TILES];
static u16 previousOverlayCount;

static u16 effectFrames;
static s16 effectIntensity;
static u8 effectType;
static u16 effectPalette[64];

static u32 glyphBuffer[32];
static u32 solidTileBuffer[8];

static u16 windowTileBase(void)
{
    return workTileBase + runtimeProject->overlayVramTiles;
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

static void initializeSystemPalette(void)
{
    u16 index;
    for (index = 0; index < 64; index++)
        currentPalette[index] = 0;
    currentPalette[1] = 0x0EEE;
    currentPalette[2] = 0x0888;
    currentPalette[8] = 0x0000;
    PAL_setPalette(PAL0, currentPalette, CPU);
}

static void loadSolidTile(u16 tile, u8 color)
{
    u16 index;
    u32 row = ((u32)color << 28) | ((u32)color << 24) | ((u32)color << 20) | ((u32)color << 16) |
              ((u32)color << 12) | ((u32)color << 8) | ((u32)color << 4) | color;
    for (index = 0; index < 8; index++)
        solidTileBuffer[index] = row;
    VDP_loadTileData(solidTileBuffer, tile, 1, DMA);
}

static void hideWindow(void)
{
    if (!windowVisible)
        return;
    VDP_setWindowOnBottom(0);
    VDP_clearPlane(WINDOW, TRUE);
    windowVisible = FALSE;
}

static void showWindow(void)
{
    u16 fillTile = windowTileBase();
    u16 borderTile = fillTile + 1;
    loadSolidTile(fillTile, 8);
    loadSolidTile(borderTile, 2);
    VDP_setWindowOnBottom(NOVEL_WINDOW_ROWS);
    VDP_fillTileMapRect(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, fillTile), 0, NOVEL_WINDOW_TOP, 40, NOVEL_WINDOW_ROWS);
    VDP_fillTileMapRect(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, borderTile), 0, NOVEL_WINDOW_TOP, 40, 1);
    VDP_fillTileMapRect(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, borderTile), 0, NOVEL_WINDOW_TOP + NOVEL_WINDOW_ROWS - 1, 40, 1);
    windowVisible = TRUE;
}

static bool sjisGlyph(const u8 *text, u16 *position, u16 *atlas, bool *newline)
{
    u8 first;
    u8 second;
    u16 row;
    u16 column;
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
    if (!(((first >= 0x81) && (first <= 0x9F)) || ((first >= 0xE0) && (first <= 0xEF))))
        return TRUE;
    second = text[*position];
    if (second == 0)
        return FALSE;
    (*position)++;
    if ((second < 0x40) || (second > 0xFC) || (second == 0x7F))
        return TRUE;
    if (second < 0x9F)
    {
        row = (first <= 0x9F) ? (u16)((first - 0x81) * 2) : (u16)((first - 0xE0) * 2 + 62);
        column = (second <= 0x7E) ? (u16)(second - 0x40) : (u16)(second - 0x41);
    }
    else
    {
        row = (first <= 0x9F) ? (u16)((first - 0x81) * 2 + 1) : (u16)((first - 0xE0) * 2 + 63);
        column = (u16)(second - 0x9F);
    }
    if ((row >= 94) || (column >= 94))
        return TRUE;
    *atlas = row * 94 + column;
    return TRUE;
}

static u8 fontPixel(u16 atlas, u8 x, u8 y)
{
    const u8 *source = (const u8 *)&novel_sjis_font.tiles[(u32)atlas * 8];
    u8 packed = source[y * 4 + (x >> 1)];
    return (x & 1) ? (packed & 0x0F) : (packed >> 4);
}

static void setPackedPixel(u8 *target, u8 x, u8 y, u8 value)
{
    u16 index = (u16)y * 4 + (x >> 1);
    if (x & 1)
        target[index] = (target[index] & 0xF0) | (value & 0x0F);
    else
        target[index] = (target[index] & 0x0F) | ((value & 0x0F) << 4);
}

static void loadGlyph16(u16 atlas, u16 tile)
{
    u8 *target = (u8 *)glyphBuffer;
    u16 index;
    u8 x;
    u8 y;
    for (index = 0; index < 128; index++)
        target[index] = 0x88;
    for (y = 0; y < 16; y++)
    {
        for (x = 0; x < 16; x++)
        {
            u8 tileX = x >> 3;
            u8 tileY = y >> 3;
            u8 localX = x & 7;
            u8 localY = y & 7;
            u8 *tileData = target + (tileY * 2 + tileX) * 32;
            if (fontPixel(atlas, x >> 1, y >> 1) != 0)
                setPackedPixel(tileData, localX, localY, 1);
        }
    }
    VDP_loadTileData(glyphBuffer, tile, 4, DMA);
}

static void drawGlyphPlacement(VDPPlane plane, const GlyphPlacement *placement)
{
    u16 attr = TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, placement->tile);
    VDP_setTileMapXY(plane, attr, placement->x, placement->y);
    VDP_setTileMapXY(plane, attr + 1, placement->x + 1, placement->y);
    VDP_setTileMapXY(plane, attr + 2, placement->x, placement->y + 1);
    VDP_setTileMapXY(plane, attr + 3, placement->x + 1, placement->y + 1);
}

static void collectPlacements(const u8 *text, u8 startX, u8 startY, bool body)
{
    u16 position = 0;
    u16 atlas = 0;
    u8 x = startX;
    u8 y = startY;
    bool newline;
    while ((messageGlyphCount < NOVEL_MESSAGE_MAX_GLYPHS) && sjisGlyph(text, &position, &atlas, &newline))
    {
        GlyphPlacement *placement;
        if (newline)
        {
            x = startX;
            y += 2;
            continue;
        }
        placement = &messageGlyphs[messageGlyphCount];
        placement->atlas = atlas;
        placement->tile = windowTileBase() + 2 + messageGlyphCount * 4;
        placement->x = x;
        placement->y = y;
        placement->body = body;
        messageGlyphCount++;
        x += 2;
    }
}

static void setMouthAnimation(s8 slot, u16 mouth)
{
    u16 animation;
    if ((slot < 0) || (slot >= NOVEL_SPRITE_SLOTS) || (actorSprites[(u8)slot] == NULL))
        return;
    animation = (u16)actorAnimations[(u8)slot] + mouth;
    if (actorSprites[(u8)slot]->definition->numAnimation > animation)
        SPR_setAnim(actorSprites[(u8)slot], animation);
}

static void prepareMessagePage(void)
{
    messageGlyphCount = 0;
    messageLoaded = 0;
    messageRevealed = 0;
    messageTimer = 0;
    messageComplete = FALSE;
    autoCounter = 0;
    PAL_setColor(1, activeMessage->color);
    currentPalette[1] = activeMessage->color;
    showWindow();
    collectPlacements(activeMessage->speaker, 1, NOVEL_WINDOW_TOP + 1, FALSE);
    messageBodyStart = messageGlyphCount;
    collectPlacements(activeMessage->pages[activeMessagePage], 1, NOVEL_WINDOW_TOP + 3, TRUE);
    setMouthAnimation(activeMessage->mouthSlot, 1);
    runtimeMode = MODE_MESSAGE_PREP;
}

static void revealAllMessage(void)
{
    while (messageRevealed < (messageGlyphCount - messageBodyStart))
    {
        drawGlyphPlacement(WINDOW, &messageGlyphs[messageBodyStart + messageRevealed]);
        messageRevealed++;
    }
    messageComplete = TRUE;
    autoCounter = 0;
    setMouthAnimation(activeMessage->mouthSlot, 0);
}

static void updateMessagePrepare(void)
{
    u16 count = 0;
    while ((messageLoaded < messageGlyphCount) && (count < NOVEL_MESSAGE_LOAD_BATCH))
    {
        loadGlyph16(messageGlyphs[messageLoaded].atlas, messageGlyphs[messageLoaded].tile);
        messageLoaded++;
        count++;
    }
    if (messageLoaded < messageGlyphCount)
        return;
    for (count = 0; count < messageBodyStart; count++)
        drawGlyphPlacement(WINDOW, &messageGlyphs[count]);
    runtimeMode = MODE_MESSAGE;
    if ((messageGlyphCount == messageBodyStart) || (activeMessageSpeed == 0))
        revealAllMessage();
}

static bool messageAdvancePressed(void)
{
    return (pressedJoy & (BUTTON_B | BUTTON_C | BUTTON_START | BUTTON_RIGHT | BUTTON_DOWN)) != 0;
}

static void finishMessage(void)
{
    setMouthAnimation(activeMessage->mouthSlot, 0);
    activeMessage = NULL;
    runtimeMode = MODE_RUN;
}

static void updateMessage(void)
{
    if (!messageComplete)
    {
        if (messageAdvancePressed())
        {
            revealAllMessage();
            return;
        }
        messageTimer++;
        if (messageTimer >= activeMessageSpeed)
        {
            messageTimer = 0;
            if (messageRevealed < (messageGlyphCount - messageBodyStart))
            {
                drawGlyphPlacement(WINDOW, &messageGlyphs[messageBodyStart + messageRevealed]);
                messageRevealed++;
            }
            if (messageRevealed >= (messageGlyphCount - messageBodyStart))
                revealAllMessage();
        }
        return;
    }
    if (autoEnabled)
    {
        autoCounter++;
        if (autoCounter < runtimeProject->autoWaitFrames)
            return;
    }
    else if (!messageAdvancePressed())
        return;
    if (activeMessagePage + 1 < activeMessage->pageCount)
    {
        activeMessagePage++;
        prepareMessagePage();
    }
    else
        finishMessage();
}

static void drawImmediateText(const u8 *text, u8 startX, u8 startY, u16 *nextTile)
{
    u16 position = 0;
    u16 atlas = 0;
    u8 x = startX;
    u8 y = startY;
    bool newline;
    while (sjisGlyph(text, &position, &atlas, &newline))
    {
        GlyphPlacement placement;
        if (newline)
        {
            x = startX;
            y += 2;
            continue;
        }
        if (*nextTile + 3 > TILE_USER_MAX_INDEX)
            return;
        loadGlyph16(atlas, *nextTile);
        placement.tile = *nextTile;
        placement.x = x;
        placement.y = y;
        drawGlyphPlacement(WINDOW, &placement);
        *nextTile += 4;
        x += 2;
    }
}

static void beginChoice(void)
{
    showWindow();
    PAL_setColor(1, 0x0EEE);
    currentPalette[1] = 0x0EEE;
    choiceLoadIndex = 0;
    choiceNextTile = windowTileBase() + 2;
    runtimeMode = MODE_CHOICE_PREP;
}

static void updateChoicePrepare(void)
{
    if (choiceLoadIndex < activeChoice->count)
    {
        drawImmediateText(activeChoice->options[choiceLoadIndex].label, 5, NOVEL_WINDOW_TOP + 1 + choiceLoadIndex * 2, &choiceNextTile);
        choiceLoadIndex++;
        return;
    }
    VDP_setTileMapXY(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, windowTileBase() + 1), 1, NOVEL_WINDOW_TOP + 1 + choiceIndex * 2);
    runtimeMode = MODE_CHOICE;
}
static void eraseChoiceCursor(u8 index)
{
    VDP_setTileMapXY(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, windowTileBase()), 1, NOVEL_WINDOW_TOP + 1 + index * 2);
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
    if (choiceIndex != oldIndex)
    {
        eraseChoiceCursor(oldIndex);
        VDP_setTileMapXY(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, windowTileBase() + 1), 1, NOVEL_WINDOW_TOP + 1 + choiceIndex * 2);
    }
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
        currentPalette[slot + 1] = state->definition->color;
        PAL_setColor(slot + 1, state->definition->color);
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
                    if (fontPixel(atlas, pixelX >> 1, pixelY >> 1) != 0)
                        overlaySetPixel(x + pixelX, y + pixelY, slot + 1);
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

static void loadBackground(const NovelCommand *command)
{
    const Image *image = novelDataBackground((u16)command->target);
    u16 x;
    u16 y;
    if (image == NULL)
        return;
    hideWindow();
    if (command->flags & NOV_FLAG_FADE)
        PAL_fadeOutAll(command->frames, FALSE);
    VDP_clearPlane(BG_B, TRUE);
    copyPalette(PAL1, image->palette->data);
    x = runtimeProject->legacyCoordinates ? (u16)(4 + command->x) : (u16)(command->x >> 3);
    y = runtimeProject->legacyCoordinates ? (u16)command->y : (u16)(command->y >> 3);
    VDP_drawImageEx(BG_B, image, TILE_ATTR_FULL(PAL1, FALSE, FALSE, FALSE, TILE_USER_INDEX), x, y, FALSE, TRUE);
    backgroundTileCount = image->tileset->numTile;
    workTileBase = TILE_USER_INDEX + backgroundTileCount;
    if (command->flags & NOV_FLAG_FADE)
        PAL_fadeInAll(currentPalette, command->aux, FALSE);
    else
        PAL_setPalette(PAL1, image->palette->data, DMA);
    renderSpriteTexts();
}

static void setActor(const NovelCommand *command)
{
    u8 slot = command->slot;
    const SpriteDefinition *definition;
    u16 palette;
    if (slot >= NOVEL_SPRITE_SLOTS)
        return;
    if (!(command->flags & NOV_FLAG_VISIBLE) || (command->target < 0))
    {
        if (actorSprites[slot] != NULL)
            SPR_setVisibility(actorSprites[slot], HIDDEN);
        actorResources[slot] = -1;
        actorAnimations[slot] = 0;
        actorMoves[slot].active = FALSE;
        return;
    }
    definition = novelDataSprite((u16)command->target);
    if (definition == NULL)
        return;
    palette = novelDataSpritePalette((u16)command->target);
    copyPalette(palette, definition->palette->data);
    PAL_setPalette(palette, definition->palette->data, DMA);
    if (actorSprites[slot] == NULL)
        actorSprites[slot] = SPR_addSpriteEx(definition, effectiveX(command->x), command->y, TILE_ATTR(palette, FALSE, FALSE, FALSE), SPR_FLAG_AUTO_VISIBILITY | SPR_FLAG_AUTO_VRAM_ALLOC | SPR_FLAG_AUTO_TILE_UPLOAD);
    else if (actorResources[slot] != command->target)
        SPR_setDefinition(actorSprites[slot], definition);
    if (actorSprites[slot] == NULL)
        return;
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
            actorResources[slot] = -1;
            actorAnimations[slot] = 0;
        }
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
            else if (command->flags & NOV_FLAG_ASYNC)
            {
                u8 readIndex;
                u8 writeIndex = 0;
                if (mask == 0) break;
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
                }
                hideWindow();
                clearSpriteTexts();
                VDP_clearPlane(BG_A, TRUE);
                VDP_clearPlane(BG_B, TRUE);
                backgroundTileCount = 0;
                workTileBase = TILE_USER_INDEX;
                for (index = 0; index < 64; index++) effectPalette[index] = command->aux;
                PAL_setColors(0, effectPalette, 64, DMA);
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
                PAL_setColors(0, effectPalette, 64, DMA);
                effectFrames = command->frames ? command->frames : 1;
                runtimeMode = MODE_EFFECT;
            }
            else if (effectType == NOV_EFFECT_FADE_IN)
            {
                if (command->frames == 0) PAL_setColors(0, currentPalette, 64, DMA);
                else
                {
                    PAL_fadeInAll(currentPalette, command->frames, TRUE);
                    runtimeMode = MODE_EFFECT;
                }
            }
            else
            {
                for (index = 0; index < 64; index++) effectPalette[index] = command->aux;
                if (command->frames == 0) PAL_setColors(0, effectPalette, 64, DMA);
                else
                {
                    PAL_fadeToAll(effectPalette, command->frames, TRUE);
                    runtimeMode = MODE_EFFECT;
                }
            }
            break;
        }        default:
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
            PAL_setColors(0, currentPalette, 64, DMA);
            runtimeMode = MODE_RUN;
        }
        return;
    }
    if (effectFrames == 0)
    {
        VDP_setHorizontalScroll(BG_A, 0);
        VDP_setHorizontalScroll(BG_B, 0);
        runtimeMode = MODE_RUN;
        return;
    }
    offset = (effectFrames & 1) ? effectIntensity : -effectIntensity;
    VDP_setHorizontalScroll(BG_A, offset);
    VDP_setHorizontalScroll(BG_B, -offset);
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
}
