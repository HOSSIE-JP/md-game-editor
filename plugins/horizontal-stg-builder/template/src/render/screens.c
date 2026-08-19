#include <genesis.h>
#include "common.h"
#include "render/screens.h"
#include "render/japanese_text.h"
#include "generated/game_data.h"
#include "generated/generated_ids.h"

static const u16 uiPalette[16] =
{
    0x0000, 0x0EEE, 0x0ACE, 0x068E,
    0x044A, 0x0E88, 0x0ECA, 0x0AEE,
    0x0246, 0x0468, 0x08AC, 0x0CEE,
    0x0608, 0x0A4A, 0x0C8C, 0x0EEE
};

#define TITLE_SCREEN_LINES 224
#define TITLE_LOGO_X 4
#define TITLE_LOGO_Y 2
#define TITLE_LOGO_HEIGHT_TILES 8

static const s8 titleRipple[32] =
{
     0,  1,  2,  3,  4,  4,  3,  2,
     1,  0, -1, -2, -3, -4, -4, -3,
    -2, -1,  0,  1,  2,  3,  3,  2,
     1,  0, -1, -2, -3, -3, -2, -1
};

static s16 titleScrollA[TITLE_SCREEN_LINES];
static s16 titleScrollB[TITLE_SCREEN_LINES];
static bool titleEffectActive;

static void beginScreen(void)
{
    titleEffectActive = FALSE;
    VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);
    VDP_setHorizontalScroll(BG_A, 0);
    VDP_setHorizontalScroll(BG_B, 0);
    SPR_reset();
    VDP_setWindowOnTop(0);
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_clearPlane(WINDOW, TRUE);
    PAL_setPalette(PAL0, uiPalette, DMA);
    VDP_setTextPlane(BG_A);
    VDP_setTextPalette(PAL0);
    VDP_setTextPriority(TRUE);
    stgTextBegin(TILE_USER_INDEX);
}

static void drawCentered(const u8* text, u16 y)
{
    const u16 width = stgTextDraw(BG_A, text, PAL0, TRUE, 0, 30);
    VDP_clearTileMapRect(BG_A, 0, 30, 40, 1);
    stgTextDraw(BG_A, text, PAL0, TRUE, (width < 40) ? (40 - width) / 2 : 0, y);
}

static void drawList(const u8* const* items, u8 count, u8 selected, u16 y)
{
    u8 i;
    for (i = 0; i < count; i++)
    {
        VDP_drawTextBG(BG_A, (i == selected) ? ">" : " ", 7, y + (i * 2));
        stgTextDraw(BG_A, items[i], PAL0, TRUE, 10, y + (i * 2));
    }
}

void screensInit(void)
{
    beginScreen();
}

void screensDrawTitle(void)
{
    u16 tileIndex = TILE_USER_INDEX;
    const u32 neededTiles = (u32)tileIndex + img_title_background.tileset->numTile + img_title_logo.tileset->numTile;
    bool backgroundDrawn = FALSE;
    bool logoDrawn = FALSE;

    beginScreen();

    if (neededTiles <= ((u32)TILE_USER_MAX_INDEX + 1))
    {
        PAL_setPalette(PAL0, img_title_background.palette->data, DMA);
        PAL_setPalette(PAL1, img_title_logo.palette->data, DMA);
        backgroundDrawn = VDP_drawImageEx(
            BG_B,
            &img_title_background,
            TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, tileIndex),
            0,
            0,
            FALSE,
            TRUE);
        tileIndex += img_title_background.tileset->numTile;
        logoDrawn = VDP_drawImageEx(
            BG_A,
            &img_title_logo,
            TILE_ATTR_FULL(PAL1, TRUE, FALSE, FALSE, tileIndex),
            TITLE_LOGO_X,
            TITLE_LOGO_Y,
            FALSE,
            TRUE);
    }

    if (!backgroundDrawn || !logoDrawn)
    {
        beginScreen();
        drawCentered(gStgTextTitle, 8);
    }
    else
    {
        titleEffectActive = TRUE;
        VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE);
        screensUpdateTitle(0);
    }

    VDP_drawTextBG(BG_A, "PRESS START", 15, 21);
    VDP_drawTextBG(BG_A, "2026 MD GAME EDITOR", 10, 26);
}

void screensUpdateTitle(u32 frame)
{
    u16 line;

    if (!titleEffectActive)
        return;

    for (line = 0; line < TITLE_SCREEN_LINES; line++)
    {
        titleScrollA[line] = 0;
        titleScrollB[line] = 0;

        if ((line >= (TITLE_LOGO_Y * 8)) &&
            (line < ((TITLE_LOGO_Y + TITLE_LOGO_HEIGHT_TILES) * 8)))
        {
            const u16 bandLine = line - (TITLE_LOGO_Y * 8);
            const u16 distanceToEdge = (bandLine < 32) ? bandLine : (63 - bandLine);
            const u16 envelope = (distanceToEdge < 8) ? distanceToEdge : 8;
            const u16 phaseFast = (bandLine + (frame << 1)) & 31;
            const u16 phaseSlow = ((bandLine >> 1) + (frame >> 1)) & 31;
            const s16 offset = titleRipple[phaseFast] + (titleRipple[phaseSlow] >> 1);
            titleScrollA[line] = (s16)((offset * envelope) >> 4);
        }
    }

    if (frame == 0)
        VDP_setHorizontalScrollLine(BG_B, 0, titleScrollB, TITLE_SCREEN_LINES, DMA_QUEUE);
    VDP_setHorizontalScrollLine(BG_A, 0, titleScrollA, TITLE_SCREEN_LINES, DMA_QUEUE);
}

void screensDrawMainMenu(u8 selected)
{
    beginScreen();
    drawCentered(gStgTextTitle, 3);
    drawList(gStgMainMenuItems, STG_MAIN_MENU_COUNT, selected, 8);
}

static char buttonLabel(u8 value)
{
    return (value == 0) ? 'A' : ((value == 1) ? 'B' : 'C');
}

void screensDrawOptions(u8 selected, const StgOptions* options)
{
    static const char* difficultyNames[STG_DIFFICULTY_COUNT] = { "EASY", "NORMAL", "HARD" };
    char value[12];
    u8 i;
    beginScreen();
    VDP_drawTextBG(BG_A, "OPTIONS", 16, 3);
    for (i = 0; i < STG_OPTION_ITEM_COUNT; i++)
    {
        VDP_drawTextBG(BG_A, (i == selected) ? ">" : " ", 4, 7 + i * 3);
        stgTextDraw(BG_A, gStgOptionItems[i], PAL0, TRUE, 7, 7 + i * 3);
    }
    VDP_drawTextBG(BG_A, difficultyNames[options->difficulty], 25, 7);
    value[0] = buttonLabel(options->shotButton); value[1] = 0;
    VDP_drawTextBG(BG_A, value, 28, 10);
    value[0] = buttonLabel(options->coreButton);
    VDP_drawTextBG(BG_A, value, 28, 13);
    value[0] = buttonLabel(options->bombButton);
    VDP_drawTextBG(BG_A, value, 28, 16);
    VDP_drawTextBG(BG_A, options->soundEnabled ? "ON " : "OFF", 26, 19);
    VDP_drawTextBG(BG_A, "B: BACK", 16, 25);
}

static char scoreNameChar(const StgHighScore* entry, u8 index)
{
    if (index >= STG_NAME_ENTRY_LENGTH)
        return '-';
    return entry->name[index];
}

void screensDrawHighScores(u8 difficulty)
{
    static const char* difficultyNames[STG_DIFFICULTY_COUNT] = { "EASY", "NORMAL", "HARD" };
    const StgHighScore* rows = saveGetHighScores(difficulty);
    char line[32];
    u8 i;
    beginScreen();
    stgTextDraw(BG_A, gStgMainMenuItems[2], PAL0, TRUE, 14, 2);
    VDP_drawTextBG(BG_A, difficultyNames[difficulty], 17, 4);
    for (i = 0; i < STG_HIGHSCORE_ROWS; i++)
    {
        char scoreText[12];
        intToStr(i + 1, line, 2);
        line[2] = '.'; line[3] = ' ';
        line[4] = scoreNameChar(&rows[i], 0);
        line[5] = scoreNameChar(&rows[i], 1);
        line[6] = scoreNameChar(&rows[i], 2); line[7] = ' ';
        uintToStr(rows[i].score, scoreText, 8);
        strcpy(&line[8], scoreText);
        VDP_drawTextBG(BG_A, line, 8, 6 + i * 2);
    }
    VDP_drawTextBG(BG_A, "LEFT/RIGHT  B:BACK", 10, 26);
}

void screensDrawSoundTest(u8 audioId, bool playing)
{
    char value[8];
    beginScreen();
    stgTextDraw(BG_A, gStgMainMenuItems[3], PAL0, TRUE, 13, 4);
    VDP_drawTextBG(BG_A, "TRACK", 12, 10);
    intToStr(audioId, value, 2);
    VDP_drawTextBG(BG_A, value, 22, 10);
    VDP_drawTextBG(BG_A, playing ? "A: STOP" : "A: PLAY", 15, 15);
    VDP_drawTextBG(BG_A, "LEFT/RIGHT  B:BACK", 10, 24);
}

void screensDrawHowTo(void)
{
    u8 i;
    beginScreen();
    stgTextDraw(BG_A, gStgMainMenuItems[4], PAL0, TRUE, 15, 3);
    for (i = 0; i < STG_HOW_TO_LINE_COUNT; i++)
        stgTextDraw(BG_A, gStgHowToLines[i], PAL0, TRUE, 4, 8 + i * 3);
    VDP_drawTextBG(BG_A, "B: BACK", 16, 25);
}

void screensDrawOpening(u8 page)
{
    beginScreen();
    if (page < STG_OPENING_LINE_COUNT)
        drawCentered(gStgOpeningLines[page], 12);
    VDP_drawTextBG(BG_A, "A / START", 15, 25);
}

void screensDrawStageIntro(u8 stageIndex, u8 stageId)
{
    char number[4];
    beginScreen();
    VDP_drawTextBG(BG_A, "STAGE", 13, 9);
    intToStr(stageIndex + 1, number, 1);
    VDP_drawTextBG(BG_A, number, 20, 9);
    if ((stageId < STAGE_TYPE_COUNT) && (gStgStageNames[stageId] != NULL))
        drawCentered(gStgStageNames[stageId], 13);
}

void screensDrawPause(u8 selected)
{
    VDP_setWindowOnTop(8);
    VDP_clearPlane(WINDOW, TRUE);
    VDP_setTextPlane(WINDOW);
    VDP_drawTextBG(WINDOW, "======== PAUSE ========", 8, 0);
    VDP_drawTextBG(WINDOW, selected == 0 ? "> CONTINUE" : "  CONTINUE", 13, 3);
    VDP_drawTextBG(WINDOW, selected == 1 ? "> TITLE" : "  TITLE", 13, 5);
}

void screensClearPause(void)
{
    VDP_clearPlane(WINDOW, TRUE);
    VDP_setWindowOnTop(2);
    VDP_setTextPlane(WINDOW);
}

void screensDrawStageResult(u32 clearFrames, bool noMiss, bool coreOwned, u8 bombs, u32 bonus)
{
    char value[12];
    u8 i;
    beginScreen();
    drawCentered(gStgTextStageClear, 3);
    for (i = 0; i < STG_RESULT_ITEM_COUNT; i++)
        stgTextDraw(BG_A, gStgResultItems[i], PAL0, TRUE, 5, 8 + i * 3);
    uintToStr(clearFrames / 60, value, 4); VDP_drawTextBG(BG_A, value, 29, 8);
    VDP_drawTextBG(BG_A, noMiss ? "YES" : "NO ", 29, 11);
    VDP_drawTextBG(BG_A, coreOwned ? "YES" : "NO ", 29, 14);
    intToStr(bombs, value, 1); VDP_drawTextBG(BG_A, value, 31, 17);
    uintToStr(bonus, value, 8); VDP_drawTextBG(BG_A, value, 24, 21);
    VDP_drawTextBG(BG_A, "A / START", 15, 25);
}

void screensDrawContinue(u8 seconds, u8 continuesLeft)
{
    char value[8];
    beginScreen();
    drawCentered(gStgTextContinueTitle, 8);
    intToStr(seconds, value, 2); VDP_drawTextBG(BG_A, value, 19, 13);
    VDP_drawTextBG(BG_A, "CREDIT", 14, 17);
    intToStr(continuesLeft, value, 1); VDP_drawTextBG(BG_A, value, 22, 17);
    VDP_drawTextBG(BG_A, "A: YES   B: NO", 12, 22);
}

void screensDrawGameOver(void)
{
    beginScreen();
    drawCentered(gStgTextGameOverTitle, 12);
}

void screensDrawNameEntry(const char* name, u8 cursor, u32 score)
{
    char value[12];
    char shown[(STG_NAME_ENTRY_LENGTH * 2) + 1];
    u8 i;
    beginScreen();
    drawCentered(gStgTextNameEntryTitle, 5);
    for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
    {
        shown[i * 2] = name[i];
        shown[i * 2 + 1] = ' ';
    }
    shown[STG_NAME_ENTRY_LENGTH * 2] = 0;
    VDP_drawTextBG(BG_A, shown, 17, 12);
    VDP_drawTextBG(BG_A, "^", 17 + cursor * 2, 14);
    uintToStr(score, value, 8); VDP_drawTextBG(BG_A, value, 16, 18);
    VDP_drawTextBG(BG_A, "D-PAD: EDIT  A: OK", 10, 24);
}

void screensDrawEnding(u8 page)
{
    beginScreen();
    if (page < STG_ENDING_LINE_COUNT)
        drawCentered(gStgEndingLines[page], 12);
    VDP_drawTextBG(BG_A, "A / START", 15, 25);
}

void screensDrawStaffRoll(u32 timer)
{
    char value[12];
    beginScreen();
    drawCentered(gStgTextStaffRoll, 3);
    VDP_drawTextBG(BG_A, "GAME DESIGN / PROGRAM", 9, 8);
    VDP_drawTextBG(BG_A, "MD GAME EDITOR + CODEX", 8, 11);
    VDP_drawTextBG(BG_A, "ART / MUSIC", 14, 15);
    VDP_drawTextBG(BG_A, "GERONEKO PROJECT", 11, 18);
    uintToStr(timer / 60, value, 4); VDP_drawTextBG(BG_A, value, 18, 24);
}
