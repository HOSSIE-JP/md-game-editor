#include <genesis.h>
#include "common.h"
#include "game/config.h"
#include "player/charge_shot.h"
#include "render/hud.h"

#define HUD_TILE_BASE TILE_USER_INDEX
#define CHARGE_BAR_SEGMENTS 12

typedef enum
{
    HUD_TILE_LIFE = 0,
    HUD_TILE_BOMB,
    HUD_TILE_WEAPON_RED,
    HUD_TILE_WEAPON_BLUE,
    HUD_TILE_WEAPON_GREEN,
    HUD_TILE_PIP_ON,
    HUD_TILE_PIP_OFF,
    HUD_TILE_SPEED,
    HUD_TILE_CORE_ON,
    HUD_TILE_CORE_OFF,
    HUD_TILE_GAUGE_EMPTY,
    HUD_TILE_GAUGE_LOW,
    HUD_TILE_GAUGE_MID,
    HUD_TILE_GAUGE_MAX,
    HUD_TILE_GAUGE_LEFT,
    HUD_TILE_GAUGE_RIGHT,
    HUD_TILE_MULTIPLY,
    HUD_TILE_SEPARATOR
} HudTile;

static u32 score;
static u8 lives;
static u8 weaponColor;
static u8 weaponLevel;
static u8 chargeSegments;
static u8 chargeTier;
static u8 chargeState;
static u8 coreState;
static u8 speedLevel;
static u8 bombStock;

static bool scoreDirty;
static bool livesDirty;
static bool weaponDirty;
static bool gameOverDirty;
static bool stageClearDirty;
static bool chargeDirty;
static bool coreDirty;
static bool speedDirty;
static bool bombDirty;

static void drawHudTile(u16 x, u16 y, HudTile tile)
{
    VDP_setTileMapXY(
        WINDOW,
        TILE_ATTR_FULL(PAL2, TRUE, FALSE, FALSE, HUD_TILE_BASE + (u16)tile),
        x,
        y);
}

static void drawPips(u16 x, u16 y, u8 value)
{
    u8 index;
    for (index = 0; index < 3; index++)
        drawHudTile(x + index, y, (index < value) ? HUD_TILE_PIP_ON : HUD_TILE_PIP_OFF);
}

static u8 segmentsForCharge(u16 frames)
{
    u32 scaled;
    if (frames == 0)
        return 0;
    scaled = ((u32)frames * CHARGE_BAR_SEGMENTS + CHARGE_MAX_FRAMES - 1) / CHARGE_MAX_FRAMES;
    return (scaled > CHARGE_BAR_SEGMENTS) ? CHARGE_BAR_SEGMENTS : (u8)scaled;
}

static u8 tierForCharge(u16 frames)
{
    if (frames >= CHARGE_MAX_FRAMES)
        return 3;
    if (frames >= CHARGE_MID_FRAMES)
        return 2;
    return (frames > 0) ? 1 : 0;
}

static void drawStaticHud(void)
{
    VDP_drawTextBG(WINDOW, "SCORE", 0, 0);
    drawHudTile(13, 0, HUD_TILE_LIFE);
    drawHudTile(14, 0, HUD_TILE_MULTIPLY);
    drawHudTile(23, 0, HUD_TILE_SPEED);
    drawHudTile(28, 0, HUD_TILE_BOMB);
    drawHudTile(29, 0, HUD_TILE_MULTIPLY);
    VDP_drawTextBG(WINDOW, "CHARGE", 0, 1);
    drawHudTile(6, 1, HUD_TILE_GAUGE_LEFT);
    drawHudTile(19, 1, HUD_TILE_GAUGE_RIGHT);
}

void hudInit(void)
{
    score = 0;
    lives = 0;
    weaponColor = 0;
    weaponLevel = 1;
    chargeSegments = 0;
    chargeTier = 0;
    chargeState = 0;
    coreState = 0;
    speedLevel = 1;
    bombStock = 0;

    scoreDirty = TRUE;
    livesDirty = TRUE;
    weaponDirty = TRUE;
    gameOverDirty = FALSE;
    stageClearDirty = FALSE;
    chargeDirty = TRUE;
    coreDirty = TRUE;
    speedDirty = TRUE;
    bombDirty = TRUE;

    VDP_setWindowOnTop(HUD_ROWS);
    VDP_setTextPlane(WINDOW);
    VDP_setTextPalette(PAL0);
    VDP_setTextPriority(TRUE);
}

void hudReset(void)
{
    VDP_setWindowOnTop(HUD_ROWS);
    VDP_setTextPlane(WINDOW);
    VDP_setTextPalette(PAL0);
    VDP_setTextPriority(TRUE);
    VDP_clearPlane(WINDOW, TRUE);
    VDP_loadTileSet(&ts_hud_icons, HUD_TILE_BASE, DMA);
    drawStaticHud();
    scoreDirty = TRUE;
    livesDirty = TRUE;
    weaponDirty = TRUE;
    gameOverDirty = FALSE;
    stageClearDirty = FALSE;
    chargeDirty = TRUE;
    coreDirty = TRUE;
    speedDirty = TRUE;
    bombDirty = TRUE;
}

void hudSetScore(u32 value)
{
    if (score != value)
    {
        score = value;
        scoreDirty = TRUE;
    }
}

void hudSetLives(u8 value)
{
    if (lives != value)
    {
        lives = value;
        livesDirty = TRUE;
    }
}

void hudSetWeapon(u8 color, u8 level)
{
    if ((weaponColor != color) || (weaponLevel != level))
    {
        weaponColor = color;
        weaponLevel = level;
        weaponDirty = TRUE;
    }
}

void hudSetCharge(u16 frames, u8 state)
{
    const u8 segments = segmentsForCharge(frames);
    const u8 tier = tierForCharge(frames);
    if ((chargeSegments != segments) || (chargeTier != tier) || (chargeState != state))
    {
        chargeSegments = segments;
        chargeTier = tier;
        chargeState = state;
        chargeDirty = TRUE;
    }
}

void hudSetCoreState(u8 state)
{
    if (coreState != state)
    {
        coreState = state;
        coreDirty = TRUE;
    }
}

void hudSetSpeed(u8 level)
{
    if (speedLevel != level)
    {
        speedLevel = level;
        speedDirty = TRUE;
    }
}

void hudSetBombs(u8 bombs)
{
    if (bombStock != bombs)
    {
        bombStock = bombs;
        bombDirty = TRUE;
    }
}

void hudShowStageClear(void)
{
    stageClearDirty = TRUE;
}

void hudShowGameOver(void)
{
    gameOverDirty = TRUE;
}

void hudPrepare(void)
{
    if (scoreDirty)
    {
        char text[12];
        uintToStr(score, text, 6);
        VDP_drawTextBGFill(WINDOW, text, 6, 0, 6);
        scoreDirty = FALSE;
    }

    if (livesDirty)
    {
        char text[4];
        intToStr(lives, text, 1);
        VDP_drawTextBGFill(WINDOW, text, 15, 0, 1);
        livesDirty = FALSE;
    }

    if (weaponDirty)
    {
        const u8 color = (weaponColor > 2) ? 0 : weaponColor;
        drawHudTile(18, 0, (HudTile)(HUD_TILE_WEAPON_RED + color));
        drawPips(19, 0, (weaponLevel > 3) ? 3 : weaponLevel);
        weaponDirty = FALSE;
    }

    if (speedDirty)
    {
        drawPips(24, 0, (speedLevel > 3) ? 3 : speedLevel);
        speedDirty = FALSE;
    }

    if (bombDirty)
    {
        char text[4];
        intToStr(bombStock, text, 1);
        VDP_drawTextBGFill(WINDOW, text, 30, 0, 1);
        bombDirty = FALSE;
    }

    if (chargeDirty)
    {
        const HudTile fill = (chargeTier >= 3) ? HUD_TILE_GAUGE_MAX :
            ((chargeTier == 2) ? HUD_TILE_GAUGE_MID : HUD_TILE_GAUGE_LOW);
        const char* status = (chargeTier >= 3) ? "MAX  " :
            ((chargeTier == 2) ? "READY" : ((chargeState == CHARGE_STATE_PAUSED) ? "PAUSE" : "     "));
        u8 index;
        for (index = 0; index < CHARGE_BAR_SEGMENTS; index++)
            drawHudTile(7 + index, 1, (index < chargeSegments) ? fill : HUD_TILE_GAUGE_EMPTY);
        VDP_drawTextBGFill(WINDOW, status, 21, 1, 5);
        chargeDirty = FALSE;
    }

    if (coreDirty)
    {
        char status[2];
        drawHudTile(33, 0, (coreState == 0) ? HUD_TILE_CORE_OFF : HUD_TILE_CORE_ON);
        status[0] = (coreState == 0) ? '-' : ((coreState == 1) ? 'F' : ((coreState == 2) ? 'R' : 'D'));
        status[1] = 0;
        VDP_drawTextBGFill(WINDOW, status, 34, 0, 1);
        coreDirty = FALSE;
    }

    if (stageClearDirty)
    {
        VDP_drawTextBG(WINDOW, "STAGE CLEAR", 27, 1);
        stageClearDirty = FALSE;
    }

    if (gameOverDirty)
    {
        VDP_drawTextBG(WINDOW, "GAME OVER", 29, 1);
        gameOverDirty = FALSE;
    }
}
