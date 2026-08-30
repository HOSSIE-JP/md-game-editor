#include <genesis.h>
#include <string.h>
#include <bulletml.h>
#include <bulletml_game.h>
#include "bulletml/bulletml_runtime.h"
#include "bulletml/bulletml_game.h"
#include "generated/bulletml_catalog.h"

#define HOST_MAX_ENEMIES 5
#define HOST_PLAYER_SHOTS 8

typedef struct {
    bool active;
    const BML_GameEvent *event;
    s16 emitterId;
    s16 x;
    s16 y;
    u16 hp;
    u8 phase;
    Sprite *sprite;
} HostEnemy;

static HostEnemy enemies[HOST_MAX_ENEMIES];
static Sprite *playerSprite;
static Sprite *bulletSprites[BML_MAX_BULLETS];
static Sprite *shotSprites[HOST_PLAYER_SHOTS];
static u16 bulletFrameTileIndexes[BML_BULLET_FRAME_COUNT];
static s16 shotX[HOST_PLAYER_SHOTS];
static s16 shotY[HOST_PLAYER_SHOTS];
static bool shotActive[HOST_PLAYER_SHOTS];
static bool shotVisible[HOST_PLAYER_SHOTS];
static u8 reservedPieces[BML_SCANLINES];
static u16 reservedDots[BML_SCANLINES];
static s16 playerX;
static s16 playerY;
static u16 lives;
static u32 score;
static u16 invincible;
static u16 hitInvincibilityFrames;
static bool diagnostics;
static bool selfTestPassed;
static bool loadTestPassed;
static bool diagnosticsRan;
static u16 renderedBulletCount;

volatile u16 bmlQaScreen;
volatile u16 bmlQaSelfTest;
volatile u16 bmlQaSelfTestCrcHigh;
volatile u16 bmlQaSelfTestCrcLow;
volatile u16 bmlQaSelfTestFrame;
volatile u16 bmlQaOrientation;
volatile u16 bmlQaDifficulty;
volatile u16 bmlQaStageFrame;
volatile u16 bmlQaCompletedStages;
volatile u16 bmlQaStageOutcome;
volatile u16 bmlQaMaxBullets;
volatile u16 bmlQaMaxEmitters;
volatile u16 bmlQaMaxContexts;
volatile u16 bmlQaMaxOpcodes;
volatile u16 bmlQaMaxSpawns;
volatile u16 bmlQaFireDrops;
volatile u16 bmlQaPoolDrops;
volatile u16 bmlQaSpawnDrops;
volatile u16 bmlQaContextDrops;
volatile u16 bmlQaOpcodeExhaustions;
volatile u16 bmlQaDisplayDeletes;
volatile u16 bmlQaMaxCpuLoad;
volatile u16 bmlQaMinFreeRam;
volatile u16 bmlQaMaxAllocatedRam;
volatile u16 bmlQaMinFreeSpriteTiles;
volatile u16 bmlQaLives;
volatile u16 bmlQaHits;
volatile u16 bmlQaLoadProbe;
volatile u16 bmlQaLoadFrame;
volatile u16 bmlQaLoadMaxBullets;
volatile u16 bmlQaLoadMaxEmitters;
volatile u16 bmlQaLoadMaxContexts;
volatile u16 bmlQaLoadMaxOpcodes;
volatile u16 bmlQaLoadMaxSpawns;
volatile u16 bmlQaLoadFireDrops;
volatile u16 bmlQaLoadContextDrops;
volatile u16 bmlQaLoadOpcodeExhaustions;
volatile u16 bmlQaLoadDisplayDeletes;
volatile u16 bmlQaLoadMaxGlobalSprites;
volatile u16 bmlQaLoadMaxPieces;
volatile u16 bmlQaLoadMaxDots;
volatile u16 bmlQaLoadMaxCpuLoad;
volatile u16 bmlQaLoadMaxCpuFrame;
volatile u16 bmlQaLoadVBlankFrames;
volatile u16 bmlQaLoadMaxTickSubticks;
volatile u16 bmlQaLoadMaxBudgetSubticks;
volatile u16 bmlQaLoadMaxFrameSubticks;
volatile u16 bmlQaLoadMaxFrameFrame;
volatile u16 bmlQaLoadTickSubticks;
volatile u16 bmlQaLoadBudgetSubticks;
volatile u16 bmlQaLoadFrameSubticks;

static s16 bmlAbs16(s16 value) {
    return value < 0 ? (s16) -value : value;
}

static void reserveSpriteLines(s16 x, s16 y, u8 width, u8 height);

static void updateResourceQa(void) {
    const u16 freeRam = MEM_getFree();
    const u16 allocatedRam = MEM_getAllocated();
    const u16 freeSpriteTiles = SPR_getFreeVRAM();
    if (freeRam < bmlQaMinFreeRam) bmlQaMinFreeRam = freeRam;
    if (allocatedRam > bmlQaMaxAllocatedRam) bmlQaMaxAllocatedRam = allocatedRam;
    if (freeSpriteTiles < bmlQaMinFreeSpriteTiles) bmlQaMinFreeSpriteTiles = freeSpriteTiles;
}

static void drawTitle(u16 orientation, u16 difficulty) {
    bmlQaScreen = 1;
    bmlQaOrientation = orientation;
    bmlQaDifficulty = difficulty;
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_drawText("BULLETML STG", 14, 5);
    VDP_drawText(orientation ? "> HORIZONTAL" : "> VERTICAL  ", 11, 10);
    if (difficulty == 0) VDP_drawText("  EASY  >", 14, 13);
    else if (difficulty == 1) VDP_drawText(" NORMAL  >", 14, 13);
    else VDP_drawText("  HARD  >", 14, 13);
    VDP_drawText("D-PAD SELECT  A/START BEGIN", 6, 20);
    if (diagnosticsRan) {
        VDP_drawText(selfTestPassed ? "SELF-TEST CRC: OK" : "SELF-TEST CRC: FAILED", 11, 23);
        VDP_drawText(loadTestPassed ? "LOAD 48/5/16: OK" : "LOAD 48/5/16: FAILED", 11, 24);
    } else {
        VDP_drawText("C: RUN FULL QA", 13, 23);
    }
}

static bool runSelfTest(void) {
    u32 crc = 0xFFFFFFFFUL;
    u16 frame;
    s16 emitter;
    if (!bmlGamePatternCount) return FALSE;
    BML_init();
    BML_setPlayer(160 * 64, 196 * 64);
    emitter = BML_startEmitter(
        bmlGamePatterns[BML_SELF_TEST_PATTERN_INDEX].data,
        bmlGamePatterns[BML_SELF_TEST_PATTERN_INDEX].size,
        160 * 64,
        28 * 64,
        0,
        0xACE1,
        0x7FFF
    );
    if (emitter < 0) return FALSE;
    for (frame = 0; frame < 10000; frame++) {
        BML_tick();
        BML_applyDisplayBudget(0, NULL, NULL);
        crc = BML_stateCrc(crc);
        bmlQaSelfTestFrame = frame + 1;
    }
    crc ^= 0xFFFFFFFFUL;
    bmlQaSelfTestCrcHigh = (u16) (crc >> 16);
    bmlQaSelfTestCrcLow = (u16) crc;
    return crc == BML_SELF_TEST_EXPECTED_CRC;
}

static bool runLoadProbe(void) {
    static const s16 idleX[4] = { 40, 100, 220, 280 };
    static const s16 idleY[4] = { 32, 64, 144, 176 };
    u16 frame;
    u16 index;
    u16 cpuLoad;
    u32 frameStart;
    u32 phaseStart;
    u32 tickEnd;
    u32 workEnd;
    u32 frameElapsed;
    u32 elapsed;
    s16 emitter;
    const BML_Metrics *qa;
    bmlQaLoadFrame = 0;
    bmlQaLoadMaxBullets = 0;
    bmlQaLoadMaxEmitters = 0;
    bmlQaLoadMaxContexts = 0;
    bmlQaLoadMaxOpcodes = 0;
    bmlQaLoadMaxSpawns = 0;
    bmlQaLoadFireDrops = 0;
    bmlQaLoadContextDrops = 0;
    bmlQaLoadOpcodeExhaustions = 0;
    bmlQaLoadDisplayDeletes = 0;
    bmlQaLoadMaxGlobalSprites = 0;
    bmlQaLoadMaxPieces = 0;
    bmlQaLoadMaxDots = 0;
    bmlQaLoadMaxCpuLoad = 0;
    bmlQaLoadMaxCpuFrame = 0;
    bmlQaLoadVBlankFrames = 0;
    bmlQaLoadMaxTickSubticks = 0;
    bmlQaLoadMaxBudgetSubticks = 0;
    bmlQaLoadMaxFrameSubticks = 0;
    bmlQaLoadMaxFrameFrame = 0;
    bmlQaLoadTickSubticks = 0;
    bmlQaLoadBudgetSubticks = 0;
    bmlQaLoadFrameSubticks = 0;
    BML_init();
    BML_setPlayer(160 * 64, 196 * 64);
    XGM2_setLoopNumber(-1);
    XGM2_play(bml_bgm_vertical);
    for (frame = 0; frame < 16; frame++) SYS_doVBlankProcess();
    emitter = BML_startEmitter(
        bml_internal_diagnostic_burst,
        BML_DIAGNOSTIC_BURST_SIZE,
        160 * 64,
        112 * 64,
        2048,
        0xACE1,
        0x7FFF
    );
    if (emitter < 0) return FALSE;
    for (index = 0; index < 4; index++) {
        emitter = BML_startEmitter(
            bml_internal_diagnostic_idle,
            BML_DIAGNOSTIC_IDLE_SIZE,
            idleX[index] * 64,
            idleY[index] * 64,
            0,
            (u16) (0xACE2 + index),
            0x7FFF
        );
        if (emitter < 0) return FALSE;
    }
    memset(reservedPieces, 0, sizeof(reservedPieces));
    memset(reservedDots, 0, sizeof(reservedDots));
    reserveSpriteLines(152, 188, 16, 16);
    reserveSpriteLines(152, 104, 16, 16);
    for (index = 0; index < 4; index++) reserveSpriteLines(idleX[index] - 8, idleY[index] - 8, 16, 16);
    XGM2_playPCM(bml_sfx_shot, sizeof(bml_sfx_shot), SOUND_PCM_CH3);
    for (frame = 0; frame < BML_DIAGNOSTIC_LOAD_FRAMES; frame++) {
        frameStart = getSubTick();
        phaseStart = frameStart;
        BML_tick();
        tickEnd = getSubTick();
        BML_applyDisplayBudget(6, reservedPieces, reservedDots);
        workEnd = getSubTick();
        elapsed = tickEnd - phaseStart;
        bmlQaLoadTickSubticks = (u16) elapsed;
        if (elapsed > bmlQaLoadMaxTickSubticks) bmlQaLoadMaxTickSubticks = (u16) elapsed;
        elapsed = workEnd - tickEnd;
        frameElapsed = workEnd - frameStart;
        bmlQaLoadBudgetSubticks = (u16) elapsed;
        if (elapsed > bmlQaLoadMaxBudgetSubticks) bmlQaLoadMaxBudgetSubticks = (u16) elapsed;
        qa = BML_getMetrics();
        bmlQaLoadFrame = frame + 1;
        if (qa->bullets > bmlQaLoadMaxBullets) bmlQaLoadMaxBullets = qa->bullets;
        if (qa->emitters > bmlQaLoadMaxEmitters) bmlQaLoadMaxEmitters = qa->emitters;
        if (qa->contexts > bmlQaLoadMaxContexts) bmlQaLoadMaxContexts = qa->contexts;
        if (qa->opcodesThisFrame > bmlQaLoadMaxOpcodes) bmlQaLoadMaxOpcodes = qa->opcodesThisFrame;
        if (qa->spawnedThisFrame > bmlQaLoadMaxSpawns) bmlQaLoadMaxSpawns = qa->spawnedThisFrame;
        bmlQaLoadFireDrops = (u16) qa->fireDrops;
        bmlQaLoadContextDrops = (u16) qa->contextDrops;
        bmlQaLoadOpcodeExhaustions = (u16) qa->opcodeExhaustions;
        bmlQaLoadDisplayDeletes = (u16) qa->displayDeletes;
        if (qa->displaySpritesThisFrame > bmlQaLoadMaxGlobalSprites) bmlQaLoadMaxGlobalSprites = qa->displaySpritesThisFrame;
        if (qa->maxPiecesThisFrame > bmlQaLoadMaxPieces) bmlQaLoadMaxPieces = qa->maxPiecesThisFrame;
        if (qa->maxDotsThisFrame > bmlQaLoadMaxDots) bmlQaLoadMaxDots = qa->maxDotsThisFrame;
        bmlQaLoadFrameSubticks = (u16) frameElapsed;
        if (frameElapsed > bmlQaLoadMaxFrameSubticks) {
            bmlQaLoadMaxFrameSubticks = (u16) frameElapsed;
            bmlQaLoadMaxFrameFrame = frame + 1;
        }
        SYS_doVBlankProcess();
        bmlQaLoadVBlankFrames++;
        cpuLoad = SYS_getCPULoad();
        if (cpuLoad > bmlQaLoadMaxCpuLoad) {
            bmlQaLoadMaxCpuLoad = cpuLoad;
            bmlQaLoadMaxCpuFrame = frame + 1;
        }
    }
    XGM2_stop();
    return bmlQaLoadFrame == BML_DIAGNOSTIC_LOAD_FRAMES
        && bmlQaLoadMaxBullets == BML_MAX_BULLETS
        && bmlQaLoadMaxEmitters == BML_MAX_EMITTERS
        && bmlQaLoadMaxSpawns == BML_MAX_SPAWNS_PER_FRAME
        && bmlQaLoadMaxContexts <= BML_MAX_CONTEXTS
        && bmlQaLoadMaxOpcodes <= BML_MAX_OPCODES_PER_FRAME
        && !bmlQaLoadFireDrops
        && !bmlQaLoadContextDrops
        && !bmlQaLoadOpcodeExhaustions
        && !bmlQaLoadDisplayDeletes
        && bmlQaLoadMaxGlobalSprites <= 80
        && bmlQaLoadMaxPieces <= 20
        && bmlQaLoadMaxDots <= 320
        && bmlQaLoadVBlankFrames == BML_DIAGNOSTIC_LOAD_FRAMES
        && bmlQaLoadMaxFrameSubticks <= BML_DIAGNOSTIC_NTSC_SUBTICKS_PER_FRAME
        && bmlQaLoadMaxCpuLoad < 100;
}

static void runDiagnostics(void) {
    bmlQaScreen = 4;
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_drawText("RUNNING FULL QA", 12, 9);
    VDP_drawText("10K CRC + 48/5/16 LOAD", 8, 13);
    VDP_drawText("PLEASE WAIT", 14, 17);
    SYS_doVBlankProcess();

    bmlQaSelfTest = 0;
    bmlQaSelfTestCrcHigh = 0;
    bmlQaSelfTestCrcLow = 0;
    bmlQaSelfTestFrame = 0;
    bmlQaLoadProbe = 0;
    selfTestPassed = runSelfTest();
    bmlQaSelfTest = selfTestPassed ? 1 : 2;
    loadTestPassed = runLoadProbe();
    bmlQaLoadProbe = loadTestPassed ? 1 : 2;
    diagnosticsRan = TRUE;
}

static void selectGame(u16 *orientation, u16 *difficulty) {
    u16 previous = 0;
    drawTitle(*orientation, *difficulty);
    while (TRUE) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & (BUTTON_UP | BUTTON_DOWN)) { *orientation ^= 1; drawTitle(*orientation, *difficulty); }
        if (pressed & BUTTON_LEFT) { *difficulty = (*difficulty + 2) % 3; drawTitle(*orientation, *difficulty); }
        if (pressed & BUTTON_RIGHT) { *difficulty = (*difficulty + 1) % 3; drawTitle(*orientation, *difficulty); }
        if (pressed & BUTTON_C) {
            runDiagnostics();
            drawTitle(*orientation, *difficulty);
            previous = JOY_readJoypad(JOY_1);
            SYS_doVBlankProcess();
            continue;
        }
        if (pressed & (BUTTON_A | BUTTON_START)) break;
        SYS_doVBlankProcess();
    }
}

static void positionAt(const BML_GameEvent *event, u16 age, s16 *x, s16 *y) {
    u8 index;
    if (!event->pathCount) { *x = 160; *y = 32; return; }
    if (age <= event->path[0].frame) { *x = event->path[0].x; *y = event->path[0].y; return; }
    for (index = 1; index < event->pathCount; index++) {
        const BML_GameWaypoint *previous = &event->path[index - 1];
        const BML_GameWaypoint *next = &event->path[index];
        if (age <= next->frame) {
            u16 duration = next->frame - previous->frame;
            u16 elapsed = age - previous->frame;
            *x = previous->x + (s16) (((s32) (next->x - previous->x) * elapsed) / (duration ? duration : 1));
            *y = previous->y + (s16) (((s32) (next->y - previous->y) * elapsed) / (duration ? duration : 1));
            return;
        }
    }
    *x = event->path[event->pathCount - 1].x;
    *y = event->path[event->pathCount - 1].y;
}

static Sprite *enemySpriteFor(u8 type) {
    if (type == 2) return SPR_addSprite(&bml_boss, 0, 0, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
    if (type == 1) return SPR_addSprite(&bml_turret, 0, 0, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
    return SPR_addSprite(&bml_grunt, 0, 0, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
}

static void clearEnemies(void) {
    u8 index;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) {
        if (enemies[index].sprite) { SPR_releaseSprite(enemies[index].sprite); enemies[index].sprite = NULL; }
        enemies[index].active = FALSE;
    }
}

static s16 freeEnemySlot(bool boss) {
    u8 index;
    u8 normal = 0;
    u8 bosses = 0;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) { if (enemies[index].event->boss) bosses++; else normal++; }
    if ((boss && bosses >= 1) || (!boss && normal >= 4)) return -1;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (!enemies[index].active) return index;
    return -1;
}

static void spawnEvent(const BML_GameEvent *event, u16 rankQ16, u16 seed) {
    s16 slot = freeEnemySlot(event->boss != 0);
    const BML_GamePattern *pattern;
    if (slot < 0 || event->patternIndex >= bmlGamePatternCount) return;
    pattern = &bmlGamePatterns[event->patternIndex];
    memset(&enemies[slot], 0, sizeof(enemies[slot]));
    enemies[slot].active = TRUE;
    enemies[slot].event = event;
    enemies[slot].hp = event->hp;
    enemies[slot].phase = 0;
    positionAt(event, 0, &enemies[slot].x, &enemies[slot].y);
    enemies[slot].emitterId = BML_startEmitter(pattern->data, pattern->size, enemies[slot].x * 64, enemies[slot].y * 64, 0, seed, rankQ16);
    enemies[slot].sprite = enemySpriteFor(event->enemyType);
    updateResourceQa();
}

static void stopEnemy(HostEnemy *enemy, bool boss) {
    if (enemy->emitterId >= 0) BML_stopEmitter(enemy->emitterId);
    if (boss) BML_clearAll();
    if (enemy->sprite) { SPR_releaseSprite(enemy->sprite); enemy->sprite = NULL; }
    score += enemy->event->score;
    enemy->active = FALSE;
    XGM2_playPCM(bml_sfx_destroy, sizeof(bml_sfx_destroy), SOUND_PCM_CH2);
}

static void updateEnemies(u16 gameFrame, u16 rankQ16) {
    u8 index;
    (void) rankQ16;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) {
        HostEnemy *enemy = &enemies[index];
        u16 age = gameFrame - enemy->event->spawnFrame;
        positionAt(enemy->event, age, &enemy->x, &enemy->y);
        BML_updateEmitter(enemy->emitterId, enemy->x * 64, enemy->y * 64, 0);
        if (enemy->sprite) { SPR_setPosition(enemy->sprite, enemy->x - (enemy->event->boss ? 16 : 8), enemy->y - (enemy->event->boss ? 16 : 8)); SPR_setVisibility(enemy->sprite, VISIBLE); }
        if (!enemy->event->boss && age >= 660) stopEnemy(enemy, FALSE);
        if (enemy->event->boss && enemy->event->phaseCount) {
            u16 percent = (u16) (((u32) enemy->hp * 100) / (enemy->event->hp ? enemy->event->hp : 1));
            if (enemy->phase + 1 < enemy->event->phaseCount && percent <= enemy->event->phaseThreshold[enemy->phase + 1]) {
                const BML_GamePattern *pattern;
                enemy->phase++;
                BML_clearAll();
                BML_stopEmitter(enemy->emitterId);
                pattern = &bmlGamePatterns[enemy->event->phasePattern[enemy->phase]];
                enemy->emitterId = BML_startEmitter(pattern->data, pattern->size, enemy->x * 64, enemy->y * 64, 0, 0xACE1 + enemy->phase, rankQ16);
            }
        }
    }
}

static void firePlayerShot(void) {
    u8 index;
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) if (!shotActive[index]) {
        shotActive[index] = TRUE;
        shotX[index] = playerX;
        shotY[index] = playerY - 10;
        XGM2_playPCM(bml_sfx_shot, sizeof(bml_sfx_shot), SOUND_PCM_CH3);
        return;
    }
}

static void updateShots(bool horizontal) {
    u8 shot;
    u8 enemy;
    for (shot = 0; shot < HOST_PLAYER_SHOTS; shot++) if (shotActive[shot]) {
        if (horizontal) shotX[shot] += 7; else shotY[shot] -= 7;
        if (shotX[shot] < -8 || shotX[shot] > 328 || shotY[shot] < -8 || shotY[shot] > 232) shotActive[shot] = FALSE;
        for (enemy = 0; enemy < HOST_MAX_ENEMIES && shotActive[shot]; enemy++) if (enemies[enemy].active && bmlAbs16(enemies[enemy].x - shotX[shot]) < (enemies[enemy].event->boss ? 20 : 12) && bmlAbs16(enemies[enemy].y - shotY[shot]) < (enemies[enemy].event->boss ? 20 : 12)) {
            shotActive[shot] = FALSE;
            if (enemies[enemy].hp) enemies[enemy].hp--;
            if (!enemies[enemy].hp) stopEnemy(&enemies[enemy], enemies[enemy].event->boss != 0);
        }
    }
}

static void reserveSpriteLines(s16 x, s16 y, u8 width, u8 height) {
    s16 top = y;
    s16 bottom = y + height - 1;
    u16 line;
    (void) x;
    if (bottom < 0 || top > 223) return;
    if (top < 0) top = 0;
    if (bottom > 223) bottom = 223;
    for (line = (u16) top; line <= (u16) bottom; line++) { reservedPieces[line]++; reservedDots[line] += width; }
}

static void applyBulletSprites(void) {
    u16 count;
    u16 index;
    u16 reservedGlobal = 1;
    const BML_Bullet *view;
    memset(reservedPieces, 0, sizeof(reservedPieces));
    memset(reservedDots, 0, sizeof(reservedDots));
    reserveSpriteLines(playerX - 8, playerY - 8, 16, 16);
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) { reservedGlobal++; reserveSpriteLines(enemies[index].x - 16, enemies[index].y - 16, enemies[index].event->boss ? 32 : 16, enemies[index].event->boss ? 32 : 16); }
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) if (shotActive[index]) { reservedGlobal++; reserveSpriteLines(shotX[index] - 4, shotY[index] - 4, 8, 8); }
    BML_applyDisplayBudget(reservedGlobal, reservedPieces, reservedDots);
    view = BML_getBullets(&count);
    for (index = 0; index < count; index++) {
        SPR_setPosition(bulletSprites[index], (view[index].x64 / 64) - (view[index].width / 2), (view[index].y64 / 64) - (view[index].height / 2));
#if BML_BULLET_FRAME_COUNT > 1
        {
            const u16 frame = (view[index].age / BML_BULLET_FRAME_TICKS) % BML_BULLET_FRAME_COUNT;
            SPR_setFrame(bulletSprites[index], frame);
            SPR_setVRAMTileIndex(bulletSprites[index], bulletFrameTileIndexes[frame]);
        }
#endif
        SPR_setVisibility(bulletSprites[index], VISIBLE);
    }
    for (index = count; index < renderedBulletCount; index++) SPR_setVisibility(bulletSprites[index], HIDDEN);
    renderedBulletCount = count;
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) {
        if (shotActive[index]) {
            SPR_setPosition(shotSprites[index], shotX[index] - 4, shotY[index] - 4);
            if (!shotVisible[index]) { SPR_setVisibility(shotSprites[index], VISIBLE); shotVisible[index] = TRUE; }
        } else if (shotVisible[index]) { SPR_setVisibility(shotSprites[index], HIDDEN); shotVisible[index] = FALSE; }
    }
}

static void collidePlayer(void) {
    u16 count;
    u16 index;
    const BML_Bullet *view = BML_getBullets(&count);
    if (invincible) { invincible--; return; }
    for (index = 0; index < count; index++) {
        s16 dx = (view[index].x64 / 64) + view[index].hitboxX - playerX;
        s16 dy = (view[index].y64 / 64) + view[index].hitboxY - playerY;
        s16 radius = view[index].hitboxRadius + 3;
        if ((s32) dx * dx + (s32) dy * dy <= (s32) radius * radius) {
            if (lives) lives--;
            invincible = hitInvincibilityFrames;
            bmlQaHits++;
            BML_clearAll();
            XGM2_playPCM(bml_sfx_hit, sizeof(bml_sfx_hit), SOUND_PCM_CH4);
            break;
        }
    }
}

static void drawHud(u16 frame) {
    char text[40];
    sprintf(text, "LIFE %u  SCORE %lu  TIME %u", lives, score, frame / 60);
    VDP_clearTextArea(0, 0, 40, 2);
    VDP_drawText(text, 1, 0);
    if (diagnostics) {
        const BML_Metrics *value = BML_getMetrics();
        sprintf(text, "B%u C%u OP%u DROP%lu", value->bullets, value->contexts, value->opcodesThisFrame, value->fireDrops + value->displayDeletes);
        VDP_drawText(text, 1, 1);
    }
}

static bool drawStageBackground(bool horizontal) {
    const Image *background = horizontal ? &bml_bg_horizontal : &bml_bg_vertical;
    Animation *animation = bml_bullet.animations[0];
    u16 nextTile = TILE_USER_INDEX + background->tileset->numTile;
    u16 frame;
    if (!VDP_drawImageEx(BG_B, background, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX), 0, 0, TRUE, TRUE)) return FALSE;
    if (animation->numFrame != BML_BULLET_FRAME_COUNT) return FALSE;
    for (frame = 0; frame < BML_BULLET_FRAME_COUNT; frame++) {
        AnimationFrame *animationFrame = animation->frames[frame];
        const u16 frameTiles = animationFrame->tileset->numTile;
        if (!frameTiles || nextTile + frameTiles > TILE_USER_MAX_INDEX + 1) return FALSE;
        bulletFrameTileIndexes[frame] = nextTile;
        if (!VDP_loadTileSet(animationFrame->tileset, nextTile, DMA)) return FALSE;
        nextTile += frameTiles;
    }
    return TRUE;
}

static bool initSprites(void) {
    u16 index;
    SPR_init();
    playerSprite = SPR_addSprite(&bml_player, playerX - 8, playerY - 8, TILE_ATTR(PAL1, TRUE, FALSE, FALSE));
    if (!playerSprite) return FALSE;
    for (index = 0; index < BML_MAX_BULLETS; index++) {
        bulletSprites[index] = SPR_addSpriteEx(&bml_bullet, -16, -16, TILE_ATTR_FULL(PAL3, TRUE, FALSE, FALSE, bulletFrameTileIndexes[0]), 0);
        if (!bulletSprites[index]) return FALSE;
        SPR_setVisibility(bulletSprites[index], HIDDEN);
    }
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) {
        shotSprites[index] = SPR_addSprite(&bml_player_shot, -16, -16, TILE_ATTR(PAL1, TRUE, FALSE, FALSE));
        if (!shotSprites[index]) return FALSE;
        SPR_setVisibility(shotSprites[index], HIDDEN);
    }
    return TRUE;
}

static void releaseSprites(void) {
    u16 index;
    clearEnemies();
    if (playerSprite) { SPR_releaseSprite(playerSprite); playerSprite = NULL; }
    for (index = 0; index < BML_MAX_BULLETS; index++) if (bulletSprites[index]) { SPR_releaseSprite(bulletSprites[index]); bulletSprites[index] = NULL; }
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) if (shotSprites[index]) { SPR_releaseSprite(shotSprites[index]); shotSprites[index] = NULL; }
    SPR_update();
}

static void runStage(const BML_GameStage *stage, u16 difficulty) {
    u16 gameFrame = 0;
    u16 nextEvent = 0;
    u16 previous = 0;
    bool paused = FALSE;
    u16 rankQ16 = difficulty == 0 ? 0 : difficulty == 1 ? 0x7FFF : 0xFFFF;
    bmlQaOrientation = stage->horizontal ? 1 : 0;
    bmlQaDifficulty = difficulty;
    bmlQaStageFrame = 0;
    bmlQaStageOutcome = 0;
    bmlQaMaxBullets = 0;
    bmlQaMaxEmitters = 0;
    bmlQaMaxContexts = 0;
    bmlQaMaxOpcodes = 0;
    bmlQaMaxSpawns = 0;
    bmlQaFireDrops = 0;
    bmlQaPoolDrops = 0;
    bmlQaSpawnDrops = 0;
    bmlQaContextDrops = 0;
    bmlQaOpcodeExhaustions = 0;
    bmlQaDisplayDeletes = 0;
    bmlQaMaxCpuLoad = 0;
    bmlQaMinFreeRam = 0xFFFF;
    bmlQaMaxAllocatedRam = 0;
    bmlQaMinFreeSpriteTiles = 0xFFFF;
    bmlQaLives = 3;
    bmlQaHits = 0;
    BML_init();
    memset(enemies, 0, sizeof(enemies));
    memset(shotActive, 0, sizeof(shotActive));
    memset(shotVisible, 0, sizeof(shotVisible));
    renderedBulletCount = 0;
    lives = 3; score = 0; invincible = 0; diagnostics = FALSE;
    hitInvincibilityFrames = difficulty == 0 ? 1200 : difficulty == 1 ? 600 : 300;
    playerX = stage->horizontal ? 48 : 160;
    playerY = stage->horizontal ? 112 : 196;
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    if (!drawStageBackground(stage->horizontal) || !initSprites()) {
        bmlQaStageOutcome = 2;
        bmlQaScreen = 3;
        return;
    }
    updateResourceQa();
    XGM2_setLoopNumber(-1);
    XGM2_play(stage->horizontal ? bml_bgm_horizontal : bml_bgm_vertical);
    bmlQaScreen = 2;
    while (lives && gameFrame < stage->durationFrames) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & BUTTON_START) paused = !paused;
        if (pressed & BUTTON_C) diagnostics = !diagnostics;
        if (!paused) {
            s16 speed = (joy & BUTTON_B) ? 1 : 3;
            if (joy & BUTTON_LEFT) playerX -= speed;
            if (joy & BUTTON_RIGHT) playerX += speed;
            if (joy & BUTTON_UP) playerY -= speed;
            if (joy & BUTTON_DOWN) playerY += speed;
            if (playerX < 8) playerX = 8;
            if (playerX > 312) playerX = 312;
            if (playerY < 16) playerY = 16;
            if (playerY > 216) playerY = 216;
            if ((joy & BUTTON_A) && !(gameFrame % 5)) firePlayerShot();
            while (nextEvent < stage->eventCount && stage->events[nextEvent].spawnFrame <= gameFrame) { spawnEvent(&stage->events[nextEvent], rankQ16, (u16) (0xACE1 + nextEvent * 73)); nextEvent++; }
            updateEnemies(gameFrame, rankQ16);
            updateShots(stage->horizontal);
            BML_setPlayer(playerX * 64, playerY * 64);
            BML_tick();
            applyBulletSprites();
            collidePlayer();
            gameFrame++;
            {
                const BML_Metrics *qa = BML_getMetrics();
                bmlQaStageFrame = gameFrame;
                if (qa->bullets > bmlQaMaxBullets) bmlQaMaxBullets = qa->bullets;
                if (qa->emitters > bmlQaMaxEmitters) bmlQaMaxEmitters = qa->emitters;
                if (qa->contexts > bmlQaMaxContexts) bmlQaMaxContexts = qa->contexts;
                if (qa->opcodesThisFrame > bmlQaMaxOpcodes) bmlQaMaxOpcodes = qa->opcodesThisFrame;
                if (qa->spawnedThisFrame > bmlQaMaxSpawns) bmlQaMaxSpawns = qa->spawnedThisFrame;
                bmlQaFireDrops = (u16) qa->fireDrops;
                bmlQaPoolDrops = (u16) qa->poolDrops;
                bmlQaSpawnDrops = (u16) qa->spawnDrops;
                bmlQaContextDrops = (u16) qa->contextDrops;
                bmlQaOpcodeExhaustions = (u16) qa->opcodeExhaustions;
                bmlQaDisplayDeletes = (u16) qa->displayDeletes;
            }
        }
        SPR_setPosition(playerSprite, playerX - 8, playerY - 8);
        SPR_setVisibility(playerSprite, (invincible && (gameFrame & 2)) ? HIDDEN : VISIBLE);
        if (!(gameFrame % 30) || (diagnostics && !(gameFrame % 4))) drawHud(gameFrame);
        SPR_update();
        SYS_doVBlankProcess();
        {
            u16 cpuLoad = SYS_getCPULoad();
            if (gameFrame > 60 && cpuLoad > bmlQaMaxCpuLoad) bmlQaMaxCpuLoad = cpuLoad;
            bmlQaLives = lives;
        }
    }
    XGM2_stop();
    releaseSprites();
    bmlQaCompletedStages++;
    bmlQaStageOutcome = lives ? 1 : 2;
    bmlQaScreen = 3;
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    VDP_drawText(lives ? "STAGE CLEAR" : "GAME OVER", 14, 10);
    VDP_drawText("PRESS START", 14, 15);
    while (!(JOY_readJoypad(JOY_1) & BUTTON_START)) SYS_doVBlankProcess();
    while (JOY_readJoypad(JOY_1) & BUTTON_START) SYS_doVBlankProcess();
}

void BML_gameRun(void) {
    u16 orientation = 0;
    u16 difficulty = 1;
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    PAL_setPalette(PAL1, bml_player.palette->data, CPU);
    PAL_setPalette(PAL2, bml_grunt.palette->data, CPU);
    PAL_setPalette(PAL3, bml_bullet.palette->data, CPU);
    bmlQaScreen = 0;
    bmlQaSelfTest = 0;
    bmlQaSelfTestCrcHigh = 0;
    bmlQaSelfTestCrcLow = 0;
    bmlQaSelfTestFrame = 0;
    bmlQaCompletedStages = 0;
    bmlQaLoadProbe = 0;
    selfTestPassed = FALSE;
    loadTestPassed = FALSE;
    diagnosticsRan = FALSE;
    while (TRUE) {
        selectGame(&orientation, &difficulty);
        runStage(&bmlGameStages[orientation], difficulty);
    }
}
