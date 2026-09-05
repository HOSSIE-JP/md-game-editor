#include <genesis.h>
#include <string.h>
#include <bulletml.h>
#include "bulletml/bulletml_runtime.h"
#include "bulletml/bulletml_lut.h"
#include "bulletml/bulletml_game.h"
#include "generated/bulletml_catalog.h"
#include "generated/novel_data.h"
#include "novel_runtime/novel_runtime.h"

#define HOST_MAX_ENEMIES BML_POOL_ENEMIES
#define HOST_PLAYER_SHOTS BML_POOL_PLAYER_SHOTS

typedef struct {
    bool active;
    const BML_GameEvent *event;
    s16 emitterId;
    s16 x;
    s16 y;
    u16 hp;
    u8 phase;
    const BML_EnemyConfig *enemyConfig;
    const BML_BossConfig *bossConfig;
    u16 partHp[BML_GAME_MAX_BOSS_PARTS];
    u16 spawnFrame;
    u16 movementStartFrame;
    u8 movementRuntimeId;
    Sprite *sprite;
} HostEnemy;

typedef struct {
    bool active;
    const BML_ItemConfig *config;
    s16 x;
    s16 y;
    Sprite *sprite;
} HostItem;

typedef struct {
    bool active;
    const BML_EffectConfig *config;
    s16 x;
    s16 y;
    u16 age;
    u16 delay;
    bool suppressSe;
    Sprite *sprite;
} HostEffect;

static HostEnemy enemies[HOST_MAX_ENEMIES];
static HostItem hostItems[BML_POOL_ITEMS];
static HostEffect hostEffects[BML_POOL_EFFECTS];
static Sprite *playerSprite;
static Sprite *bulletSprites[BML_MAX_BULLETS];
static Sprite *shotSprites[HOST_PLAYER_SHOTS];
static u16 bulletFrameTileIndexes[BML_BULLET_FRAME_COUNT];
static s16 shotX[HOST_PLAYER_SHOTS];
static s16 shotY[HOST_PLAYER_SHOTS];
static s32 shotXQ8[HOST_PLAYER_SHOTS];
static s32 shotYQ8[HOST_PLAYER_SHOTS];
static s16 shotVXQ8[HOST_PLAYER_SHOTS];
static s16 shotVYQ8[HOST_PLAYER_SHOTS];
static u8 shotDamage[HOST_PLAYER_SHOTS];
static bool shotActive[HOST_PLAYER_SHOTS];
static bool shotVisible[HOST_PLAYER_SHOTS];
static u8 reservedPieces[BML_SCANLINES];
static u16 reservedDots[BML_SCANLINES];
static u16 reservedMaxPieces;
static u16 reservedMaxDots;
static s16 playerX;
static s16 playerY;
static s32 playerXQ8;
static s32 playerYQ8;
static u16 lives;
static u8 bombs;
static u8 speedMode;
static u8 weaponRuntimeId;
static u32 score;
static u16 invincible;
static u16 hitInvincibilityFrames;
static bool diagnostics;
static bool selfTestPassed;
static bool loadTestPassed;
static bool diagnosticsRan;
static u16 renderedBulletCount;
static u8 currentMode;
static bool stageClearRequested;
static s32 mainScrollQ8;
static s32 cameraScrollQ8;
static s32 scrollStartQ8;
static s32 scrollTargetQ8;
static u16 scrollTweenFrame;
static u16 scrollTweenDuration;
static u8 scrollTweenInterpolation;
static u8 activeBackgroundRuntimeId;
static BML_WaveConfig activeWave[2];
static u16 activeWaveStartFrame[2];
static u16 activeWaveCacheWavelength[2];
static u16 activeWaveCacheCoordinateStep[2];
static u16 activeWaveCachePhaseStep[2];
static u16 activeWaveCacheRemainderStep[2];
static Map *activeBackgroundMaps[2];
static bool backgroundLoadFailed;
static u16 flagHashes[32];
static u8 flagValues[32];
static u8 typedEventFired[256];
static u8 bossSeen[256];
static u16 shotButton = BML_DEFAULT_SHOT_BUTTON;
static u16 bombButton = BML_DEFAULT_BOMB_BUTTON;
static u16 speedButton = BML_DEFAULT_SPEED_BUTTON;
static bool gameplayBgmActive;
static u8 stagesCleared;
static u32 playFrames;
static u8 checkpointStageRuntimeId;
static bool checkpointValid;
static u32 checkpointScore;
static u32 checkpointPlayFrames;
static u8 checkpointLives;
static u8 checkpointBombs;
static u8 checkpointWeaponRuntimeId;
static u8 checkpointSpeedMode;
static u8 checkpointStagesCleared;

typedef struct {
    u32 score;
    u32 metric1;
    u32 metric2;
    char name[3];
} BML_HighScore;

static BML_HighScore highScores[2][BML_SAVE_TOP_COUNT];

volatile u16 bmlQaScreen;
volatile u16 bmlQaSelfTest;
volatile u16 bmlQaSelfTestCrcHigh;
volatile u16 bmlQaSelfTestCrcLow;
volatile u16 bmlQaSelfTestFrame;
volatile u16 bmlQaOrientation;
volatile u16 bmlQaDifficulty;
volatile u16 bmlQaShotButton;
volatile u16 bmlQaBombButton;
volatile u16 bmlQaSpeedButton;
volatile u16 bmlQaSramLoaded;
volatile u16 bmlQaCheckpointValid;
volatile u16 bmlQaGameplayBgmStarted;
volatile u16 bmlQaPcmWhileBgm;
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

static const BML_WeaponConfig *findWeapon(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlWeaponCount; index++) if (bmlWeapons[index].runtimeId == runtimeId) return &bmlWeapons[index];
    return bmlWeaponCount ? &bmlWeapons[0] : NULL;
}

static const BML_ItemConfig *findItem(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlItemCount; index++) if (bmlItems[index].runtimeId == runtimeId) return &bmlItems[index];
    return NULL;
}

static const BML_EffectConfig *findEffect(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlEffectCount; index++) if (bmlEffects[index].runtimeId == runtimeId) return &bmlEffects[index];
    return NULL;
}

static const BML_ExplosionConfig *findExplosion(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlExplosionCount; index++) if (bmlExplosions[index].runtimeId == runtimeId) return &bmlExplosions[index];
    return NULL;
}

static const BML_MovementConfig *findMovement(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlMovementCount; index++) if (bmlMovements[index].runtimeId == runtimeId) return &bmlMovements[index];
    return NULL;
}

static const BML_EnemyConfig *findEnemyConfig(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlEnemyCount; index++) if (bmlEnemies[index].runtimeId == runtimeId) return &bmlEnemies[index];
    return NULL;
}

static const BML_BossConfig *findBossConfig(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlBossCount; index++) if (bmlBosses[index].runtimeId == runtimeId) return &bmlBosses[index];
    return NULL;
}

static const BML_BackgroundConfig *findBackground(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlBackgroundCount; index++) if (bmlBackgrounds[index].runtimeId == runtimeId) return &bmlBackgrounds[index];
    return NULL;
}

static u16 flagHash(const char *text) {
    u16 value = 0x811C;
    if (!text) return 0;
    while (*text) { value = (u16) ((value ^ (u8) *text++) * 0x0193); }
    return value ? value : 1;
}

static bool readFlag(const char *name) {
    u16 hash = flagHash(name);
    u8 index;
    if (!hash) return FALSE;
    for (index = 0; index < 32; index++) if (flagHashes[index] == hash) return flagValues[index] != 0;
    return FALSE;
}

static void writeFlag(const char *name, bool value) {
    u16 hash = flagHash(name);
    u8 index;
    if (!hash) return;
    for (index = 0; index < 32; index++) if (!flagHashes[index] || flagHashes[index] == hash) { flagHashes[index] = hash; flagValues[index] = value ? 1 : 0; return; }
}

static void runDemo(s16 sceneIndex) {
    u16 index;
    if (sceneIndex < 0) return;
    BML_shutdown();
    XGM2_stop();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_clearPlane(WINDOW, TRUE);
    novelInit(&gNovelProject);
    for (index = 0; index < BML_DEMO_FLAG_COUNT; index++) {
        novelSetVariable(bmlDemoFlagVariableIndexes[index], readFlag(bmlDemoFlagNames[index]) ? 1 : 0);
    }
    novelStartScene((u16) sceneIndex);
    while (novelIsRunning()) {
        novelUpdate();
        SYS_doVBlankProcess();
    }
    for (index = 0; index < BML_DEMO_FLAG_COUNT; index++) {
        writeFlag(bmlDemoFlagNames[index], novelGetVariable(bmlDemoFlagVariableIndexes[index]) != 0);
    }
    novelShutdown();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_clearPlane(WINDOW, TRUE);
}

static u16 tweenQ8(u16 elapsed, u16 duration, u8 interpolation) {
    u32 t;
    if (!duration || elapsed >= duration) return 256;
    if (interpolation == BML_INTERPOLATION_STEP) return 0;
    t = ((u32) elapsed * 256) / duration;
    if (interpolation == BML_INTERPOLATION_SMOOTHSTEP) t = (t * t * (768 - (t << 1))) >> 16;
    return (u16) t;
}

static bool movementPosition(u8 runtimeId, u16 age, s16 *x, s16 *y) {
    const BML_MovementConfig *movement = findMovement(runtimeId);
    u16 total = 0;
    u16 cursor = 0;
    u8 index;
    if (!movement || !movement->pointCount) return FALSE;
    for (index = 1; index < movement->pointCount; index++) total += movement->points[index].durationFrames;
    if (movement->loop && total) age %= total;
    *x = movement->points[0].x;
    *y = movement->points[0].y;
    for (index = 1; index < movement->pointCount; index++) {
        const BML_MovementPoint *previous = &movement->points[index - 1];
        const BML_MovementPoint *next = &movement->points[index];
        const u16 duration = next->durationFrames ? next->durationFrames : 1;
        if (age <= cursor + duration) {
            const u16 ratio = tweenQ8(age - cursor, duration, next->interpolation);
            *x = previous->x + (s16) (((s32) (next->x - previous->x) * ratio) >> 8);
            *y = previous->y + (s16) (((s32) (next->y - previous->y) * ratio) >> 8);
            return TRUE;
        }
        cursor += duration;
        *x = next->x;
        *y = next->y;
    }
    return TRUE;
}

#define BML_SAVE_BYTES 512
#define BML_SAVE_CHECKSUM_OFFSET 510
#define BML_SAVE_SCORE_OFFSET 16
#define BML_SAVE_SCORE_BYTES 15
#define BML_SAVE_CHECKPOINT_OFFSET 320
#define BML_SAVE_FLAGS_OFFSET 340

static void bufferWrite32(u8 *buffer, u16 offset, u32 value) {
    buffer[offset] = value >> 24; buffer[offset + 1] = value >> 16; buffer[offset + 2] = value >> 8; buffer[offset + 3] = value;
}

static u32 bufferRead32(const u8 *buffer, u16 offset) {
    return ((u32) buffer[offset] << 24) | ((u32) buffer[offset + 1] << 16) | ((u32) buffer[offset + 2] << 8) | buffer[offset + 3];
}

static u16 saveCrc(const u8 *buffer) {
    u16 crc = 0xFFFF;
    u16 index;
    u8 bit;
    for (index = 0; index < BML_SAVE_CHECKSUM_OFFSET; index++) {
        crc ^= (u16) buffer[index] << 8;
        for (bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? (u16) ((crc << 1) ^ 0x1021) : (u16) (crc << 1);
    }
    return crc;
}

static u8 buttonCode(u16 button) { return button == BUTTON_B ? 1 : button == BUTTON_C ? 2 : 0; }
static u16 buttonMask(u8 code) { return code == 1 ? BUTTON_B : code == 2 ? BUTTON_C : BUTTON_A; }

static void updateMenuQa(void) {
    bmlQaShotButton = buttonCode(shotButton);
    bmlQaBombButton = buttonCode(bombButton);
    bmlQaSpeedButton = buttonCode(speedButton);
    bmlQaCheckpointValid = checkpointValid ? 1 : 0;
}

static void saveAll(void) {
    u8 buffer[BML_SAVE_BYTES];
    u16 offset;
    u8 mode;
    u8 row;
    u8 index;
    u16 crc;
    memset(buffer, 0, sizeof(buffer));
    bufferWrite32(buffer, 0, BML_SAVE_MAGIC);
    buffer[4] = BML_SAVE_VERSION;
    buffer[5] = buttonCode(shotButton);
    buffer[6] = buttonCode(bombButton);
    buffer[7] = buttonCode(speedButton);
    for (mode = 0; mode < 2; mode++) for (row = 0; row < BML_SAVE_TOP_COUNT; row++) {
        const BML_HighScore *entry = &highScores[mode][row];
        offset = BML_SAVE_SCORE_OFFSET + (mode * BML_SAVE_TOP_COUNT + row) * BML_SAVE_SCORE_BYTES;
        bufferWrite32(buffer, offset, entry->score);
        bufferWrite32(buffer, offset + 4, entry->metric1);
        bufferWrite32(buffer, offset + 8, entry->metric2);
        buffer[offset + 12] = entry->name[0]; buffer[offset + 13] = entry->name[1]; buffer[offset + 14] = entry->name[2];
    }
    offset = BML_SAVE_CHECKPOINT_OFFSET;
    buffer[offset] = checkpointValid ? 1 : 0;
    buffer[offset + 1] = checkpointStageRuntimeId;
    buffer[offset + 2] = checkpointLives;
    buffer[offset + 3] = checkpointBombs;
    buffer[offset + 4] = checkpointWeaponRuntimeId;
    buffer[offset + 5] = checkpointSpeedMode;
    buffer[offset + 6] = checkpointStagesCleared;
    bufferWrite32(buffer, offset + 8, checkpointScore);
    bufferWrite32(buffer, offset + 12, checkpointPlayFrames);
    for (index = 0; index < 32; index++) {
        offset = BML_SAVE_FLAGS_OFFSET + index * 3;
        buffer[offset] = flagHashes[index] >> 8; buffer[offset + 1] = flagHashes[index]; buffer[offset + 2] = flagValues[index];
    }
    crc = saveCrc(buffer);
    buffer[BML_SAVE_CHECKSUM_OFFSET] = crc >> 8;
    buffer[BML_SAVE_CHECKSUM_OFFSET + 1] = crc;
    SRAM_enable();
    for (offset = 0; offset < BML_SAVE_BYTES; offset++) SRAM_writeByte(offset, buffer[offset]);
    SRAM_disable();
    bmlQaSramLoaded = 1;
    updateMenuQa();
}

static void loadAll(void) {
    u8 buffer[BML_SAVE_BYTES];
    u16 offset;
    u16 expected;
    u8 mode;
    u8 row;
    u8 index;
    bmlQaSramLoaded = 0;
    updateMenuQa();
    SRAM_enableRO();
    for (offset = 0; offset < BML_SAVE_BYTES; offset++) buffer[offset] = SRAM_readByte(offset);
    SRAM_disable();
    expected = ((u16) buffer[BML_SAVE_CHECKSUM_OFFSET] << 8) | buffer[BML_SAVE_CHECKSUM_OFFSET + 1];
    if (bufferRead32(buffer, 0) != BML_SAVE_MAGIC || buffer[4] != BML_SAVE_VERSION || saveCrc(buffer) != expected) return;
    shotButton = buttonMask(buffer[5]); bombButton = buttonMask(buffer[6]); speedButton = buttonMask(buffer[7]);
    if (shotButton == bombButton || shotButton == speedButton || bombButton == speedButton) { shotButton = BML_DEFAULT_SHOT_BUTTON; bombButton = BML_DEFAULT_BOMB_BUTTON; speedButton = BML_DEFAULT_SPEED_BUTTON; }
    for (mode = 0; mode < 2; mode++) for (row = 0; row < BML_SAVE_TOP_COUNT; row++) {
        BML_HighScore *entry = &highScores[mode][row];
        offset = BML_SAVE_SCORE_OFFSET + (mode * BML_SAVE_TOP_COUNT + row) * BML_SAVE_SCORE_BYTES;
        entry->score = bufferRead32(buffer, offset);
        entry->metric1 = bufferRead32(buffer, offset + 4);
        entry->metric2 = bufferRead32(buffer, offset + 8);
        entry->name[0] = buffer[offset + 12]; entry->name[1] = buffer[offset + 13]; entry->name[2] = buffer[offset + 14];
    }
    offset = BML_SAVE_CHECKPOINT_OFFSET;
    checkpointValid = buffer[offset] != 0;
    checkpointStageRuntimeId = buffer[offset + 1];
    checkpointLives = buffer[offset + 2]; checkpointBombs = buffer[offset + 3]; checkpointWeaponRuntimeId = buffer[offset + 4]; checkpointSpeedMode = buffer[offset + 5]; checkpointStagesCleared = buffer[offset + 6];
    checkpointScore = bufferRead32(buffer, offset + 8); checkpointPlayFrames = bufferRead32(buffer, offset + 12);
    for (index = 0; index < 32; index++) { offset = BML_SAVE_FLAGS_OFFSET + index * 3; flagHashes[index] = ((u16) buffer[offset] << 8) | buffer[offset + 1]; flagValues[index] = buffer[offset + 2]; }
    bmlQaSramLoaded = 1;
    updateMenuQa();
}

static u8 highScoreNameCharIndex(char value) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    u8 index;
    for (index = 0; index < sizeof(alphabet) - 1; index++) if (alphabet[index] == value) return index;
    return 0;
}

static void drawHighScoreName(u8 mode, u32 value, const char name[3], u8 cursor) {
    char text[32];
    char marker[16] = "            ";
    bmlQaScreen = 6;
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_drawText(mode == 0 ? "CAMPAIGN TOP 10" : "CARAVAN TOP 10", 12, 5);
    VDP_drawText("NEW HIGH SCORE", 13, 8);
    sprintf(text, "SCORE %lu", value);
    VDP_drawText(text, 13, 11);
    sprintf(text, "NAME  %c %c %c", name[0], name[1], name[2]);
    VDP_drawText(text, 12, 14);
    marker[6 + cursor * 2] = '^';
    marker[7 + cursor * 2] = 0;
    VDP_drawText(marker, 12, 15);
    VDP_drawText("UP/DOWN LETTER  LEFT/RIGHT", 6, 19);
    VDP_drawText("A/START NEXT / ENTER", 9, 21);
}

static void enterHighScoreName(u8 mode, u32 value, char name[3]) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const u8 alphabetCount = sizeof(alphabet) - 1;
    u8 cursor = 0;
    u16 previous = JOY_readJoypad(JOY_1);
    name[0] = 'A'; name[1] = 'A'; name[2] = 'A';
    drawHighScoreName(mode, value, name, cursor);
    while (TRUE) {
        const u16 joy = JOY_readJoypad(JOY_1);
        const u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & BUTTON_LEFT) { cursor = cursor ? cursor - 1 : 2; drawHighScoreName(mode, value, name, cursor); }
        if (pressed & BUTTON_RIGHT) { cursor = (cursor + 1) % 3; drawHighScoreName(mode, value, name, cursor); }
        if (pressed & (BUTTON_UP | BUTTON_DOWN)) {
            u8 index = highScoreNameCharIndex(name[cursor]);
            index = (pressed & BUTTON_UP) ? (index + 1) % alphabetCount : (index + alphabetCount - 1) % alphabetCount;
            name[cursor] = alphabet[index];
            drawHighScoreName(mode, value, name, cursor);
        }
        if (pressed & (BUTTON_A | BUTTON_START)) {
            if (cursor < 2) { cursor++; drawHighScoreName(mode, value, name, cursor); }
            else return;
        }
        SYS_doVBlankProcess();
    }
}

static void insertHighScore(u8 mode, u32 value, u32 metric1, u32 metric2) {
    u8 row;
    u8 shift;
    for (row = 0; row < BML_SAVE_TOP_COUNT; row++) if (value > highScores[mode][row].score) {
        char name[3];
        enterHighScoreName(mode, value, name);
        for (shift = BML_SAVE_TOP_COUNT - 1; shift > row; shift--) highScores[mode][shift] = highScores[mode][shift - 1];
        highScores[mode][row].score = value; highScores[mode][row].metric1 = metric1; highScores[mode][row].metric2 = metric2;
        highScores[mode][row].name[0] = name[0]; highScores[mode][row].name[1] = name[1]; highScores[mode][row].name[2] = name[2];
        break;
    }
    saveAll();
}

static void saveCheckpoint(u8 nextStageRuntimeId) {
    checkpointValid = nextStageRuntimeId != 0;
    checkpointStageRuntimeId = nextStageRuntimeId;
    checkpointScore = score; checkpointPlayFrames = playFrames; checkpointLives = lives; checkpointBombs = bombs; checkpointWeaponRuntimeId = weaponRuntimeId; checkpointSpeedMode = speedMode; checkpointStagesCleared = stagesCleared;
    saveAll();
}

static void reserveSpriteLines(s16 x, s16 y, u8 width, u8 height);
static const BML_CollisionMaterial *collisionMaterialAt(const BML_GameStage *stage, s16 screenX, s16 screenY);
static bool switchBackground(const BML_BackgroundConfig *background, bool fade);
static u8 buttonCode(u16 button);
static void saveAll(void);

static void updateResourceQa(void) {
    const u16 freeRam = MEM_getFree();
    const u16 allocatedRam = MEM_getAllocated();
    const u16 freeSpriteTiles = SPR_getFreeVRAM();
    if (freeRam < bmlQaMinFreeRam) bmlQaMinFreeRam = freeRam;
    if (allocatedRam > bmlQaMaxAllocatedRam) bmlQaMaxAllocatedRam = allocatedRam;
    if (freeSpriteTiles < bmlQaMinFreeSpriteTiles) bmlQaMinFreeSpriteTiles = freeSpriteTiles;
}

static void drawTitle(u16 mode, u16 ignored) {
    (void) ignored;
    bmlQaScreen = 1;
    bmlQaOrientation = mode;
    bmlQaDifficulty = 1;
    updateMenuQa();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    VDP_drawText("GERONEKO -ABYSS STRIKE-", 8, 5);
    if (mode == 0) VDP_drawText("> CAMPAIGN", 13, 10);
    else if (mode == 1) VDP_drawText("> CARAVAN", 13, 10);
    else VDP_drawText("> RESUME", 13, 10);
    VDP_drawText("FIXED RANK / 1 PLAYER", 9, 13);
    VDP_drawText("UP/DOWN MODE  A BEGIN  B OPTIONS", 3, 20);
    if (diagnosticsRan) {
        VDP_drawText(selfTestPassed ? "SELF-TEST CRC: OK" : "SELF-TEST CRC: FAILED", 11, 23);
        VDP_drawText(loadTestPassed ? "LOAD 48/5/16: OK" : "LOAD 48/5/16: FAILED", 11, 24);
    } else {
        VDP_drawText("C: RUN FULL QA", 13, 23);
    }
}

static void drawOptions(u8 selected) {
    char text[32];
    const char labels[3] = { 'A', 'B', 'C' };
    bmlQaScreen = 5;
    updateMenuQa();
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    VDP_drawText("OPTIONS - BUTTON ASSIGN", 9, 5);
    sprintf(text, "%c SHOT        %c", selected == 0 ? '>' : ' ', labels[buttonCode(shotButton)]); VDP_drawText(text, 11, 10);
    sprintf(text, "%c BOMB        %c", selected == 1 ? '>' : ' ', labels[buttonCode(bombButton)]); VDP_drawText(text, 11, 12);
    sprintf(text, "%c SPEED SHIFT %c", selected == 2 ? '>' : ' ', labels[buttonCode(speedButton)]); VDP_drawText(text, 11, 14);
    VDP_drawText("LEFT/RIGHT CHANGE  A SAVE", 6, 20);
}

static void runOptions(void) {
    u8 selected = 0;
    u16 previous = 0;
    drawOptions(selected);
    while (TRUE) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & BUTTON_UP) { selected = (selected + 2) % 3; drawOptions(selected); }
        if (pressed & BUTTON_DOWN) { selected = (selected + 1) % 3; drawOptions(selected); }
        if (pressed & (BUTTON_LEFT | BUTTON_RIGHT)) {
            u16 *target = selected == 0 ? &shotButton : selected == 1 ? &bombButton : &speedButton;
            u16 *otherA = selected == 0 ? &bombButton : &shotButton;
            u16 *otherB = selected == 2 ? &bombButton : &speedButton;
            u16 old = *target;
            u8 code = buttonCode(*target);
            code = (pressed & BUTTON_RIGHT) ? (code + 1) % 3 : (code + 2) % 3;
            *target = buttonMask(code);
            if (*otherA == *target) *otherA = old;
            else if (*otherB == *target) *otherB = old;
            drawOptions(selected);
        }
        if (pressed & (BUTTON_A | BUTTON_START)) { saveAll(); return; }
        SYS_doVBlankProcess();
    }
}

static bool runSelfTest(void) {
    u32 crc = 0xFFFFFFFFUL;
    u16 frame;
    s16 emitter;
    if (!bmlGamePatternCount) return FALSE;
    BML_init();
    if (!BML_isReady()) return FALSE;
    BML_setPlayer(160 * 64, 196 * 64);
    emitter = BML_startEmitter(
        bmlGamePatterns[BML_SELF_TEST_PATTERN_INDEX].data,
        bmlGamePatterns[BML_SELF_TEST_PATTERN_INDEX].size,
        160 * 64,
        28 * 64,
        0,
        0xACE1,
        BML_FIXED_RANK_Q16
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
    if (!BML_isReady()) return FALSE;
    BML_setPlayer(160 * 64, 196 * 64);
#if BML_HAS_DIAGNOSTIC_BGM
    XGM2_setLoopNumber(-1);
    XGM2_play(BML_DIAGNOSTIC_BGM);
#endif
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
#if BML_HAS_DIAGNOSTIC_PCM
    XGM2_playPCM(BML_DIAGNOSTIC_PCM, sizeof(BML_DIAGNOSTIC_PCM), SOUND_PCM_CH3);
#endif
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
    BML_shutdown();
    diagnosticsRan = TRUE;
}

static void selectGame(u16 *mode, u16 *fixedRank) {
    u16 previous = 0;
    u16 maximum = checkpointValid ? 2 : (BML_CARAVAN_ENABLED ? 1 : 0);
    *fixedRank = 1;
    drawTitle(*mode, *fixedRank);
    while (TRUE) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & BUTTON_UP) { *mode = *mode ? *mode - 1 : maximum; drawTitle(*mode, *fixedRank); }
        if (pressed & BUTTON_DOWN) { *mode = (*mode + 1) % (maximum + 1); drawTitle(*mode, *fixedRank); }
        if (pressed & BUTTON_B) { runOptions(); drawTitle(*mode, *fixedRank); previous = JOY_readJoypad(JOY_1); }
        if (pressed & BUTTON_C) {
            runDiagnostics();
            drawTitle(*mode, *fixedRank);
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
    if (event->movementRuntimeId && movementPosition(event->movementRuntimeId, age, x, y)) return;
    if (!event->pathCount) { *x = 160; *y = 32; return; }
    if (age <= event->path[0].frame) { *x = event->path[0].x; *y = event->path[0].y; return; }
    for (index = 1; index < event->pathCount; index++) {
        const BML_GameWaypoint *previous = &event->path[index - 1];
        const BML_GameWaypoint *next = &event->path[index];
        if (age <= next->frame) {
            u16 duration = next->frame - previous->frame;
            u16 elapsed = age - previous->frame;
            u16 ratio = tweenQ8(elapsed, duration ? duration : 1, next->interpolation);
            *x = previous->x + (s16) (((s32) (next->x - previous->x) * ratio) >> 8);
            *y = previous->y + (s16) (((s32) (next->y - previous->y) * ratio) >> 8);
            return;
        }
    }
    *x = event->path[event->pathCount - 1].x;
    *y = event->path[event->pathCount - 1].y;
}

static Sprite *enemySpriteFor(const BML_GameEvent *event) {
    const BML_SpriteRef *reference;
    Sprite *sprite;
    u8 part;
    const BML_EnemyConfig *enemyConfig = event->boss ? NULL : findEnemyConfig(event->entityRuntimeId);
    const BML_BossConfig *bossConfig = event->boss ? findBossConfig(event->entityRuntimeId) : NULL;
    if (bossConfig) for (part = 0; part < bossConfig->partCount; part++) if (bossConfig->parts[part].followBackground) return NULL;
    reference = bossConfig ? &bossConfig->sprite : enemyConfig ? &enemyConfig->sprite : NULL;
    if (!reference || !reference->definition) return NULL;
    sprite = SPR_addSprite(reference->definition, 0, 0, TILE_ATTR(PAL3, TRUE, FALSE, FALSE));
    if (sprite) SPR_setAnim(sprite, reference->animationRow);
    return sprite;
}

static void clearEnemies(void) {
    u8 index;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) {
        if (enemies[index].sprite) { SPR_releaseSprite(enemies[index].sprite); enemies[index].sprite = NULL; }
        enemies[index].active = FALSE;
    }
}

static void clearItemsAndEffects(void) {
    u8 index;
    for (index = 0; index < BML_POOL_ITEMS; index++) {
        if (hostItems[index].sprite) SPR_releaseSprite(hostItems[index].sprite);
        memset(&hostItems[index], 0, sizeof(hostItems[index]));
    }
    for (index = 0; index < BML_POOL_EFFECTS; index++) {
        if (hostEffects[index].sprite) SPR_releaseSprite(hostEffects[index].sprite);
        memset(&hostEffects[index], 0, sizeof(hostEffects[index]));
    }
}

static void spawnEffect(u8 effectRuntimeId, s16 x, s16 y, u16 delay, bool suppressSe) {
    const BML_EffectConfig *config = findEffect(effectRuntimeId);
    u8 index;
    if (!config) return;
    for (index = 0; index < BML_POOL_EFFECTS; index++) if (!hostEffects[index].active) {
        hostEffects[index].active = TRUE;
        hostEffects[index].config = config;
        hostEffects[index].x = x;
        hostEffects[index].y = y;
        hostEffects[index].delay = delay;
        hostEffects[index].suppressSe = suppressSe;
        hostEffects[index].age = 0;
        hostEffects[index].sprite = NULL;
        return;
    }
}

static void spawnExplosion(u8 explosionRuntimeId, s16 x, s16 y, bool suppressFirstSe) {
    const BML_ExplosionConfig *explosion = findExplosion(explosionRuntimeId);
    u8 index;
    if (!explosion) return;
    for (index = 0; index < explosion->placementCount; index++) {
        const BML_EffectPlacement *placement = &explosion->placements[index];
        spawnEffect(placement->effectRuntimeId, x + placement->x, y + placement->y, placement->frame, suppressFirstSe && index == 0);
    }
}

static void updateEffects(void) {
    u8 index;
    for (index = 0; index < BML_POOL_EFFECTS; index++) if (hostEffects[index].active) {
        HostEffect *effect = &hostEffects[index];
        if (effect->age == effect->delay && !effect->sprite) {
            effect->sprite = SPR_addSprite(effect->config->sprite.definition, effect->x - 8, effect->y - 8, TILE_ATTR(PAL3, TRUE, FALSE, FALSE));
            if (effect->sprite) SPR_setAnim(effect->sprite, effect->config->sprite.animationRow);
            if (!effect->suppressSe && effect->config->se && effect->config->seSize) XGM2_playPCM(effect->config->se, effect->config->seSize, SOUND_PCM_CH2);
        }
        if (effect->age >= effect->delay + effect->config->durationFrames) {
            if (effect->sprite) SPR_releaseSprite(effect->sprite);
            memset(effect, 0, sizeof(*effect));
        } else effect->age++;
    }
}

static void spawnItem(u8 itemRuntimeId, s16 x, s16 y) {
    const BML_ItemConfig *config = findItem(itemRuntimeId);
    u8 index;
    if (!config) return;
    for (index = 0; index < BML_POOL_ITEMS; index++) if (!hostItems[index].active) {
        hostItems[index].active = TRUE;
        hostItems[index].config = config;
        hostItems[index].x = x;
        hostItems[index].y = y;
        hostItems[index].sprite = SPR_addSprite(config->sprite.definition, x - 8, y - 8, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
        if (hostItems[index].sprite) SPR_setAnim(hostItems[index].sprite, config->sprite.animationRow);
        return;
    }
}

static void applyItem(const BML_ItemConfig *item) {
    if (item->type == BML_ITEM_WEAPON) {
        if (weaponRuntimeId == item->weaponRuntimeId) score += item->score;
        else weaponRuntimeId = item->weaponRuntimeId;
    } else if (item->type == BML_ITEM_BOMB) {
        if (bombs >= BML_BOMB_MAX_STOCK) score += item->score;
        else { bombs += item->amount; if (bombs > BML_BOMB_MAX_STOCK) bombs = BML_BOMB_MAX_STOCK; }
    } else score += item->score;
}

static void updateItems(bool horizontal) {
    u8 index;
    for (index = 0; index < BML_POOL_ITEMS; index++) if (hostItems[index].active) {
        HostItem *item = &hostItems[index];
        if (horizontal) item->x--; else item->y++;
        if (item->sprite) SPR_setPosition(item->sprite, item->x - 8, item->y - 8);
        if (bmlAbs16(item->x - playerX) <= 12 && bmlAbs16(item->y - playerY) <= 12) {
            applyItem(item->config);
            if (item->sprite) SPR_releaseSprite(item->sprite);
            memset(item, 0, sizeof(*item));
        } else if (item->x < -16 || item->x > 336 || item->y < -16 || item->y > 240) {
            if (item->sprite) SPR_releaseSprite(item->sprite);
            memset(item, 0, sizeof(*item));
        }
    }
}

static s16 freeEnemySlot(bool boss) {
    u8 index;
    u8 normal = 0;
    u8 bosses = 0;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) { if (enemies[index].event->boss) bosses++; else normal++; }
    if ((boss && bosses >= 1) || (!boss && normal >= HOST_MAX_ENEMIES - 1)) return -1;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (!enemies[index].active) return index;
    return -1;
}

static void spawnEvent(const BML_GameEvent *event, u16 rankQ16, u16 seed) {
    s16 slot = freeEnemySlot(event->boss != 0);
    const BML_GamePattern *pattern = event->patternIndex < bmlGamePatternCount ? &bmlGamePatterns[event->patternIndex] : NULL;
    u8 part;
    if (slot < 0) return;
    memset(&enemies[slot], 0, sizeof(enemies[slot]));
    enemies[slot].active = TRUE;
    enemies[slot].event = event;
    enemies[slot].hp = event->hp;
    enemies[slot].phase = 0;
    enemies[slot].spawnFrame = event->spawnFrame;
    enemies[slot].movementStartFrame = event->spawnFrame;
    enemies[slot].movementRuntimeId = event->movementRuntimeId;
    enemies[slot].enemyConfig = event->boss ? NULL : findEnemyConfig(event->entityRuntimeId);
    enemies[slot].bossConfig = event->boss ? findBossConfig(event->entityRuntimeId) : NULL;
    if (event->boss) bossSeen[event->entityRuntimeId] = 1;
    if (enemies[slot].bossConfig) for (part = 0; part < enemies[slot].bossConfig->partCount; part++) enemies[slot].partHp[part] = enemies[slot].bossConfig->parts[part].hp;
    positionAt(event, 0, &enemies[slot].x, &enemies[slot].y);
    enemies[slot].emitterId = pattern ? BML_startEmitter(pattern->data, pattern->size, enemies[slot].x * 64, enemies[slot].y * 64, 0, seed, rankQ16) : -1;
    enemies[slot].sprite = enemySpriteFor(event);
    updateResourceQa();
}

static void stopEnemy(HostEnemy *enemy, bool boss, bool destroyed) {
    u8 explosionId = boss && enemy->bossConfig ? enemy->bossConfig->explosionRuntimeId : enemy->enemyConfig ? enemy->enemyConfig->explosionRuntimeId : 0;
    const u8 *destroySe = boss && enemy->bossConfig ? enemy->bossConfig->se : enemy->enemyConfig ? enemy->enemyConfig->se : NULL;
    u32 destroySeSize = boss && enemy->bossConfig ? enemy->bossConfig->seSize : enemy->enemyConfig ? enemy->enemyConfig->seSize : 0;
    if (enemy->emitterId >= 0) BML_stopEmitter(enemy->emitterId);
    if (destroyed && boss) BML_clearAll();
    if (enemy->sprite) { SPR_releaseSprite(enemy->sprite); enemy->sprite = NULL; }
    if (destroyed) {
        score += enemy->event->score;
        if (enemy->event->itemRuntimeId) spawnItem(enemy->event->itemRuntimeId, enemy->x, enemy->y);
        if (destroySe && destroySeSize) XGM2_playPCM(destroySe, destroySeSize, SOUND_PCM_CH2);
#if BML_HAS_DESTROY_SE
        else XGM2_playPCM(BML_DESTROY_SE, sizeof(BML_DESTROY_SE), SOUND_PCM_CH2);
#endif
        spawnExplosion(explosionId, enemy->x, enemy->y, destroySeSize != 0
#if BML_HAS_DESTROY_SE
            || TRUE
#endif
        );
    }
    enemy->active = FALSE;
}

static void updateEnemies(const BML_GameStage *stage, u16 gameFrame, u16 rankQ16) {
    u8 index;
    (void) rankQ16;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) {
        HostEnemy *enemy = &enemies[index];
        u16 age = gameFrame - enemy->spawnFrame;
        const s16 oldX = enemy->x;
        const s16 oldY = enemy->y;
        const BML_CollisionMaterial *material;
        if (!enemy->movementRuntimeId || !movementPosition(enemy->movementRuntimeId, gameFrame - enemy->movementStartFrame, &enemy->x, &enemy->y)) positionAt(enemy->event, age, &enemy->x, &enemy->y);
        material = collisionMaterialAt(stage, enemy->x, enemy->y);
        if (material && (material->mask & 2)) {
            if (material->solid) { enemy->x = oldX; enemy->y = oldY; }
            if (material->damage) {
                enemy->hp = enemy->hp > material->damage ? enemy->hp - material->damage : 0;
                if (!enemy->hp) { stopEnemy(enemy, enemy->event->boss != 0, TRUE); continue; }
            }
        }
        if (enemy->emitterId >= 0) BML_updateEmitter(enemy->emitterId, enemy->x * 64, enemy->y * 64, 0);
        if (enemy->sprite) { SPR_setPosition(enemy->sprite, enemy->x - (enemy->event->boss ? 16 : 8), enemy->y - (enemy->event->boss ? 16 : 8)); SPR_setVisibility(enemy->sprite, VISIBLE); }
        if (!enemy->event->boss && (!enemy->enemyConfig || !enemy->enemyConfig->destructibleBackground) && age >= 660) stopEnemy(enemy, FALSE, FALSE);
        if (enemy->event->boss && enemy->event->phaseCount) {
            u16 percent = (u16) (((u32) enemy->hp * 100) / (enemy->event->hp ? enemy->event->hp : 1));
            bool activePartAlive = TRUE;
            if (enemy->bossConfig && enemy->phase < enemy->bossConfig->phaseCount) {
                const u8 mask = enemy->bossConfig->phases[enemy->phase].activePartMask;
                u8 part;
                activePartAlive = FALSE;
                for (part = 0; part < enemy->bossConfig->partCount; part++) if ((mask & (1 << part)) && enemy->partHp[part]) activePartAlive = TRUE;
            }
            if (enemy->phase + 1 < enemy->event->phaseCount && (percent <= enemy->event->phaseThreshold[enemy->phase + 1] || !activePartAlive)) {
                const BML_GamePattern *pattern;
                enemy->phase++;
                const BML_BossPhaseConfig *phaseConfig = enemy->bossConfig && enemy->phase < enemy->bossConfig->phaseCount ? &enemy->bossConfig->phases[enemy->phase] : NULL;
                u16 phaseRank = phaseConfig && phaseConfig->rankQ16 >= 0 ? (u16) phaseConfig->rankQ16 : rankQ16;
                if (!phaseConfig || phaseConfig->clearBullets) BML_clearAll();
                if (enemy->emitterId >= 0) BML_stopEmitter(enemy->emitterId);
                if (phaseConfig) {
                    const BML_BackgroundConfig *phaseBackground;
                    if (phaseConfig->movementRuntimeId) { enemy->movementRuntimeId = phaseConfig->movementRuntimeId; enemy->movementStartFrame = gameFrame; }
                    if (phaseConfig->backgroundRuntimeId && phaseConfig->backgroundRuntimeId != activeBackgroundRuntimeId) {
                        activeBackgroundRuntimeId = phaseConfig->backgroundRuntimeId;
                        phaseBackground = findBackground(activeBackgroundRuntimeId);
                        if (phaseBackground) {
                            activeWave[0] = phaseBackground->bgA.wave;
                            activeWave[1] = phaseBackground->bgB.wave;
                            activeWaveStartFrame[0] = gameFrame;
                            activeWaveStartFrame[1] = gameFrame;
                        }
                        if (!switchBackground(phaseBackground, phaseBackground && phaseBackground->transition)) backgroundLoadFailed = TRUE;
                    }
                    if (phaseConfig->wave.preset != BML_WAVE_NONE) { activeWave[0] = phaseConfig->wave; activeWaveStartFrame[0] = gameFrame; }
                }
                if (enemy->event->phasePattern[enemy->phase] < bmlGamePatternCount) {
                    pattern = &bmlGamePatterns[enemy->event->phasePattern[enemy->phase]];
                    enemy->emitterId = BML_startEmitter(pattern->data, pattern->size, enemy->x * 64, enemy->y * 64, 0, 0xACE1 + enemy->phase, phaseRank);
                } else enemy->emitterId = -1;
            }
        }
    }
}

static void firePlayerShot(bool horizontal) {
    const BML_WeaponConfig *weapon = findWeapon(weaponRuntimeId);
    u8 active = 0;
    u8 shot;
    u8 emitter;
    if (!weapon) return;
    for (shot = 0; shot < HOST_PLAYER_SHOTS; shot++) if (shotActive[shot]) active++;
    for (emitter = 0; emitter < weapon->emitterCount && active < weapon->simultaneous; emitter++) {
        for (shot = 0; shot < HOST_PLAYER_SHOTS; shot++) if (!shotActive[shot]) {
            const BML_WeaponEmitter *source = &weapon->emitters[emitter];
            if (!shotSprites[shot]) {
                shotSprites[shot] = SPR_addSprite(weapon->sprite.definition, -16, -16, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
                if (!shotSprites[shot]) continue;
                SPR_setAnim(shotSprites[shot], weapon->sprite.animationRow);
                SPR_setVisibility(shotSprites[shot], HIDDEN);
            }
            shotActive[shot] = TRUE;
            shotXQ8[shot] = ((s32) playerX + source->x) << 8;
            shotYQ8[shot] = ((s32) playerY + source->y) << 8;
            if (horizontal) {
                shotVXQ8[shot] = weapon->speedQ8;
                shotVYQ8[shot] = (s16) (((s32) source->angleDegrees * weapon->speedQ8) / 45);
            } else {
                shotVXQ8[shot] = (s16) (((s32) source->angleDegrees * weapon->speedQ8) / 45);
                shotVYQ8[shot] = -(s16) weapon->speedQ8;
            }
            shotX[shot] = shotXQ8[shot] >> 8;
            shotY[shot] = shotYQ8[shot] >> 8;
            shotDamage[shot] = weapon->damage;
            if (shotSprites[shot]) {
                SPR_setDefinition(shotSprites[shot], weapon->sprite.definition);
                SPR_setAnim(shotSprites[shot], weapon->sprite.animationRow);
            }
            active++;
            break;
        }
    }
#if BML_HAS_SHOT_SE
    if (gameplayBgmActive) bmlQaPcmWhileBgm = 1;
    XGM2_playPCM(BML_SHOT_SE, sizeof(BML_SHOT_SE), SOUND_PCM_CH3);
#endif
}

static void updateShots(const BML_GameStage *stage) {
    u8 shot;
    u8 enemy;
    for (shot = 0; shot < HOST_PLAYER_SHOTS; shot++) if (shotActive[shot]) {
        shotXQ8[shot] += shotVXQ8[shot];
        shotYQ8[shot] += shotVYQ8[shot];
        shotX[shot] = shotXQ8[shot] >> 8;
        shotY[shot] = shotYQ8[shot] >> 8;
        if (shotX[shot] < -8 || shotX[shot] > 328 || shotY[shot] < -8 || shotY[shot] > 232) shotActive[shot] = FALSE;
        if (shotActive[shot]) {
            const BML_CollisionMaterial *material = collisionMaterialAt(stage, shotX[shot], shotY[shot]);
            if (material && (material->mask & 4)) shotActive[shot] = FALSE;
        }
        for (enemy = 0; enemy < HOST_MAX_ENEMIES && shotActive[shot]; enemy++) if (enemies[enemy].active) {
            HostEnemy *target = &enemies[enemy];
            u8 radius = target->bossConfig ? target->bossConfig->hitboxRadius : target->enemyConfig ? target->enemyConfig->hitboxRadius : 10;
            bool hit = FALSE;
            bool partHit = FALSE;
            bool backgroundBoss = FALSE;
            const u8 activePartMask = target->bossConfig && target->phase < target->bossConfig->phaseCount ? target->bossConfig->phases[target->phase].activePartMask : 0xFF;
            u8 part;
            if (target->bossConfig) for (part = 0; part < target->bossConfig->partCount; part++) if (target->bossConfig->parts[part].followBackground) backgroundBoss = TRUE;
            if (target->bossConfig) for (part = 0; part < target->bossConfig->partCount && !partHit; part++) if (target->partHp[part] && (activePartMask & (1 << part))) {
                const BML_BossPartConfig *partConfig = &target->bossConfig->parts[part];
                const s16 backgroundX = partConfig->followBackground && stage->horizontal ? -(cameraScrollQ8 >> 8) : 0;
                const s16 backgroundY = partConfig->followBackground && !stage->horizontal ? -(cameraScrollQ8 >> 8) : 0;
                if (bmlAbs16(target->x + partConfig->hitboxX + backgroundX - shotX[shot]) <= partConfig->hitboxRadius && bmlAbs16(target->y + partConfig->hitboxY + backgroundY - shotY[shot]) <= partConfig->hitboxRadius) {
                    const u16 damage = shotDamage[shot];
                    const u16 transfer = ((u32) damage * partConfig->globalHpTransferQ8) >> 8;
                    target->partHp[part] = target->partHp[part] > damage ? target->partHp[part] - damage : 0;
                    target->hp = target->hp > transfer ? target->hp - transfer : 0;
                    if (!target->partHp[part]) {
                        spawnExplosion(partConfig->explosionRuntimeId, target->x + partConfig->hitboxX, target->y + partConfig->hitboxY, FALSE);
                        writeFlag(partConfig->disableEventId, TRUE);
                    }
                    hit = TRUE; partHit = TRUE;
                }
            }
            if (!partHit && !backgroundBoss) hit = bmlAbs16(target->x - shotX[shot]) <= radius && bmlAbs16(target->y - shotY[shot]) <= radius;
            if (hit) {
                shotActive[shot] = FALSE;
                if (!partHit && target->hp) target->hp = target->hp > shotDamage[shot] ? target->hp - shotDamage[shot] : 0;
                if (!target->hp) stopEnemy(target, target->event->boss != 0, TRUE);
            }
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
    for (line = (u16) top; line <= (u16) bottom; line++) {
        reservedPieces[line]++;
        reservedDots[line] += width;
        if (reservedPieces[line] > reservedMaxPieces) reservedMaxPieces = reservedPieces[line];
        if (reservedDots[line] > reservedMaxDots) reservedMaxDots = reservedDots[line];
    }
}

static void applyBulletSprites(void) {
    u16 count;
    u16 index;
    u16 reservedGlobal = 1;
    const BML_Bullet *view;
    view = BML_getBullets(&count);
    if (count) {
        memset(reservedPieces, 0, sizeof(reservedPieces));
        memset(reservedDots, 0, sizeof(reservedDots));
        reservedMaxPieces = 0;
        reservedMaxDots = 0;
        reserveSpriteLines(playerX - 8, playerY - 8, 16, 16);
        for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) { reservedGlobal++; reserveSpriteLines(enemies[index].x - 16, enemies[index].y - 16, enemies[index].event->boss ? 32 : 16, enemies[index].event->boss ? 32 : 16); }
        for (index = 0; index < HOST_PLAYER_SHOTS; index++) if (shotActive[index]) { reservedGlobal++; reserveSpriteLines(shotX[index] - 4, shotY[index] - 4, 8, 8); }
        for (index = 0; index < BML_POOL_ITEMS; index++) if (hostItems[index].active) { reservedGlobal++; reserveSpriteLines(hostItems[index].x - 8, hostItems[index].y - 8, 16, 16); }
        for (index = 0; index < BML_POOL_EFFECTS; index++) if (hostEffects[index].active && hostEffects[index].sprite) { reservedGlobal++; reserveSpriteLines(hostEffects[index].x - 8, hostEffects[index].y - 8, 16, 16); }
        if (count <= 8) BML_applyDisplayBudgetSparse(reservedGlobal, reservedPieces, reservedDots, reservedMaxPieces, reservedMaxDots);
        else BML_applyDisplayBudget(reservedGlobal, reservedPieces, reservedDots);
        view = BML_getBullets(&count);
    }
    for (index = 0; index < count; index++) {
        if (!bulletSprites[index]) {
            bulletSprites[index] = SPR_addSpriteEx(&BML_BULLET_SPRITE, -16, -16, TILE_ATTR_FULL(PAL3, TRUE, FALSE, FALSE, bulletFrameTileIndexes[0]), 0);
            if (!bulletSprites[index]) {
                BML_removeBullet(index);
                view = BML_getBullets(&count);
                index--;
                continue;
            }
            SPR_setAnim(bulletSprites[index], BML_BULLET_ANIMATION_ROW);
            SPR_setVisibility(bulletSprites[index], HIDDEN);
        }
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
    for (index = count; index < renderedBulletCount; index++) if (bulletSprites[index]) {
        SPR_releaseSprite(bulletSprites[index]);
        bulletSprites[index] = NULL;
    }
    renderedBulletCount = count;
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) {
        if (shotActive[index]) {
            SPR_setPosition(shotSprites[index], shotX[index] - 4, shotY[index] - 4);
            if (!shotVisible[index]) { SPR_setVisibility(shotSprites[index], VISIBLE); shotVisible[index] = TRUE; }
        } else if (shotVisible[index]) { SPR_setVisibility(shotSprites[index], HIDDEN); shotVisible[index] = FALSE; }
    }
}

static void activateBomb(void) {
    u8 index;
    if (!bombs) return;
    bombs--;
    if (BML_BOMB_CLEAR_BULLETS) BML_clearAll();
    invincible = BML_BOMB_INVINCIBLE_FRAMES;
    spawnEffect(BML_BOMB_EFFECT_ID, playerX, playerY, 0, FALSE);
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active) {
        HostEnemy *enemy = &enemies[index];
        enemy->hp = enemy->hp > BML_BOMB_DAMAGE ? enemy->hp - BML_BOMB_DAMAGE : 0;
        if (!enemy->hp) stopEnemy(enemy, enemy->event->boss != 0, TRUE);
    }
}

static void applyPlayerHit(void) {
    if (lives) lives--;
    invincible = hitInvincibilityFrames;
    bmlQaHits++;
    BML_clearAll();
    if (BML_HIT_RESET_WEAPON == 1) weaponRuntimeId = bmlPlayerConfig.initialWeaponRuntimeId;
    if (BML_HIT_RESET_SPEED == 1) speedMode = 0;
    else if (BML_HIT_RESET_SPEED == 2) speedMode = 1;
    else if (BML_HIT_RESET_SPEED == 3) speedMode = 2;
    if (BML_HIT_RESET_BOMBS == 1) bombs = bmlPlayerConfig.initialBombs;
    else if (BML_HIT_RESET_BOMBS == 2) bombs = 0;
#if BML_HAS_HIT_SE
    XGM2_playPCM(BML_HIT_SE, sizeof(BML_HIT_SE), SOUND_PCM_CH4);
#endif
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
            applyPlayerHit();
            break;
        }
    }
}

static void drawHud(u16 frame) {
    char text[40];
    const BML_WeaponConfig *weapon = findWeapon(weaponRuntimeId);
    u16 time = currentMode == 1 ? (BML_CARAVAN_TIME_LIMIT_FRAMES > frame ? (BML_CARAVAN_TIME_LIMIT_FRAMES - frame) / 60 : 0) : frame / 60;
    sprintf(text, "L%u B%u S%u SCORE %lu", lives, bombs, speedMode + 1, score);
    VDP_clearTextArea(0, 0, 40, 2);
    VDP_drawText(text, 1, 0);
    sprintf(text, "%s  TIME %u", weapon ? weapon->name : "NONE", time);
    VDP_drawText(text, 1, 1);
    if (diagnostics) {
        const BML_Metrics *value = BML_getMetrics();
        sprintf(text, "B%u C%u OP%u DROP%lu", value->bullets, value->contexts, value->opcodesThisFrame, value->fireDrops + value->displayDeletes);
        VDP_drawText(text, 1, 2);
    }
}

static void releaseBackgroundMaps(void) {
    u8 plane;
    for (plane = 0; plane < 2; plane++) {
        if (activeBackgroundMaps[plane]) {
            MEM_free(activeBackgroundMaps[plane]);
            activeBackgroundMaps[plane] = NULL;
        }
    }
}

static bool loadBackgroundPlane(const BML_BackgroundPlane *config, u8 index) {
    const VDPPlane plane = index ? BG_B : BG_A;
    const u16 base = index ? TILE_USER_INDEX : TILE_USER_INDEX + BML_BG_B_TILE_RESERVE;
    const u16 reserve = index ? BML_BG_B_TILE_RESERVE : BML_BG_A_TILE_RESERVE;
    const u16 palette = index ? PAL0 : PAL1;
    if (!config || !config->map || !config->tileset) return TRUE;
    if (config->tileset->numTile > reserve) return FALSE;
    if (config->palette) PAL_setPalette(palette, config->palette, CPU);
    if (!VDP_loadTileSet(config->tileset, base, DMA)) return FALSE;
    activeBackgroundMaps[index] = MAP_create(config->map, plane, TILE_ATTR_FULL(palette, FALSE, FALSE, FALSE, base));
    if (!activeBackgroundMaps[index]) return FALSE;
    MAP_scrollTo(activeBackgroundMaps[index], 0, 0);
    return TRUE;
}

static bool switchBackground(const BML_BackgroundConfig *background, bool fade) {
    u16 targetPalette[64];
    u16 palette;
    u16 frames = background && background->fadeFrames ? background->fadeFrames : 16;
    for (palette = 0; palette < 4; palette++) PAL_getPalette(palette, &targetPalette[palette * 16]);
    if (background && background->bgB.palette) memcpy(&targetPalette[0], background->bgB.palette, 16 * sizeof(u16));
    if (background && background->bgA.palette) memcpy(&targetPalette[16], background->bgA.palette, 16 * sizeof(u16));
    if (fade) PAL_fadeOutAll(frames, FALSE);
    releaseBackgroundMaps();
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    if (!background) return FALSE;
    if (!loadBackgroundPlane(&background->bgB, 1)) {
        releaseBackgroundMaps();
        return FALSE;
    }
    SYS_doVBlankProcess();
    if (!loadBackgroundPlane(&background->bgA, 0)) {
        releaseBackgroundMaps();
        return FALSE;
    }
    SYS_doVBlankProcess();
    if (fade) PAL_fadeIn(0, 63, targetPalette, frames, FALSE);
    return TRUE;
}

static bool drawStageBackground(const BML_BackgroundConfig *config, bool horizontal) {
    Animation *animation = BML_BULLET_SPRITE.animations[BML_BULLET_ANIMATION_ROW];
    u16 nextTile = TILE_USER_INDEX + BML_BG_B_TILE_RESERVE + BML_BG_A_TILE_RESERVE;
    u16 frame;
    SPR_initEx(BML_GAME_SPRITE_VRAM_TILES);
    if (!switchBackground(config, FALSE)) return FALSE;
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
    const BML_WeaponConfig *weapon = findWeapon(weaponRuntimeId);
    playerSprite = SPR_addSprite(bmlPlayerConfig.sprite.definition, playerX - 8, playerY - 8, TILE_ATTR(PAL2, TRUE, FALSE, FALSE));
    if (!playerSprite) return FALSE;
    SPR_setAnim(playerSprite, bmlPlayerConfig.verticalRows[1]);
    if (!weapon || !weapon->sprite.definition) return FALSE;
    return TRUE;
}

static void releaseSprites(void) {
    u16 index;
    clearEnemies();
    clearItemsAndEffects();
    if (playerSprite) { SPR_releaseSprite(playerSprite); playerSprite = NULL; }
    for (index = 0; index < BML_MAX_BULLETS; index++) if (bulletSprites[index]) { SPR_releaseSprite(bulletSprites[index]); bulletSprites[index] = NULL; }
    for (index = 0; index < HOST_PLAYER_SHOTS; index++) if (shotSprites[index]) { SPR_releaseSprite(shotSprites[index]); shotSprites[index] = NULL; }
    SPR_update();
}

static const BML_CollisionMaterial *findCollisionMaterial(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlCollisionMaterialCount; index++) if (bmlCollisionMaterials[index].runtimeId == runtimeId) return &bmlCollisionMaterials[index];
    return NULL;
}

static u8 collisionValueAt(const BML_CollisionMap *map, u32 target) {
    u32 cursor = 0;
    u16 index;
    for (index = 0; index + 1 < map->rleSize; index += 2) {
        const u16 next = cursor + map->rle[index];
        if (target < next) return map->rle[index + 1];
        cursor = next;
    }
    return 0;
}

static u16 collisionTileCoordinate(u32 worldCoordinate, u16 tileSize, u16 tileCount) {
    u32 tileCoordinate;
    if (tileSize == 8) tileCoordinate = worldCoordinate >> 3;
    else if (tileSize == 16) tileCoordinate = worldCoordinate >> 4;
    else tileCoordinate = worldCoordinate / tileSize;
    while (tileCoordinate >= tileCount) tileCoordinate -= tileCount;
    return (u16) tileCoordinate;
}

static const BML_CollisionMaterial *collisionMaterialAt(const BML_GameStage *stage, s16 screenX, s16 screenY) {
    const BML_CollisionMap *map;
    s32 worldX;
    s32 worldY;
    u16 tileX;
    u16 tileY;
    if (!stage || stage->collisionIndex == 255 || stage->collisionIndex >= bmlCollisionMapCount) return NULL;
    map = &bmlCollisionMaps[stage->collisionIndex];
    worldX = screenX + (stage->horizontal ? (cameraScrollQ8 >> 8) : 0);
    worldY = screenY + (stage->horizontal ? 0 : (cameraScrollQ8 >> 8));
    if (worldX < 0 || worldY < 0) return NULL;
    tileX = collisionTileCoordinate((u32) worldX, map->tileWidth, map->width);
    tileY = collisionTileCoordinate((u32) worldY, map->tileHeight, map->height);
    return findCollisionMaterial(collisionValueAt(map, (u32) tileY * map->width + tileX));
}

static void collideEnemyShotsWithMap(const BML_GameStage *stage) {
    u16 count;
    u16 index = 0;
    const BML_Bullet *bullets = BML_getBullets(&count);
    while (index < count) {
        const BML_CollisionMaterial *material = collisionMaterialAt(stage, bullets[index].x64 / 64, bullets[index].y64 / 64);
        if (material && (material->mask & 8)) {
            BML_removeBullet(index);
            bullets = BML_getBullets(&count);
        } else index++;
    }
}

static void fillBackgroundScrollTable(const BML_BackgroundPlane *plane, const BML_WaveConfig *wave, u8 planeIndex, u16 frame, u16 startFrame, u16 coordinateStep, u16 count, s16 *target) {
    const u16 wavelength = wave && wave->wavelength ? wave->wavelength : 1;
    u16 phaseStep = 0;
    u16 phaseRemainderStep = 0;
    const s32 framePhase = wave ? ((s32) frame * wave->speedQ8) >> 8 : 0;
    const s16 defaultBandOffset = (s16) -(cameraScrollQ8 >> 8);
    s16 bandOffsets[8];
    u16 phaseRemainder = 0;
    s32 spatialPhase = 0;
    s32 amplitudeQ8 = 0;
    u16 coordinate = 0;
    u8 bandIndex;
    u16 index;
    if (wave && wave->preset != BML_WAVE_NONE && wave->amplitudeQ8) {
        if (activeWaveCacheWavelength[planeIndex] != wavelength || activeWaveCacheCoordinateStep[planeIndex] != coordinateStep) {
            const u32 numerator = (u32) coordinateStep * 1024;
            activeWaveCacheWavelength[planeIndex] = wavelength;
            activeWaveCacheCoordinateStep[planeIndex] = coordinateStep;
            activeWaveCachePhaseStep[planeIndex] = (u16) (numerator / wavelength);
            activeWaveCacheRemainderStep[planeIndex] = (u16) (numerator % wavelength);
        }
        phaseStep = activeWaveCachePhaseStep[planeIndex];
        phaseRemainderStep = activeWaveCacheRemainderStep[planeIndex];
    }
    for (bandIndex = 0; bandIndex < plane->bandCount; bandIndex++) bandOffsets[bandIndex] = (s16) (-(((cameraScrollQ8 >> 8) * plane->bands[bandIndex].multiplierQ8) >> 8));
    if (wave && wave->preset != BML_WAVE_NONE && wave->amplitudeQ8) {
        u16 fadeQ8 = 256;
        const u16 age = (u16) (frame - startFrame);
        if (wave->fadeFrames && age < wave->fadeFrames) fadeQ8 = (u16) (((u32) age * 256) / wave->fadeFrames);
        amplitudeQ8 = ((s32) wave->amplitudeQ8 * fadeQ8) >> 8;
    }
    for (index = 0; index < count; index++) {
        s16 bandOffset = defaultBandOffset;
        s16 offset = 0;
        for (bandIndex = 0; bandIndex < plane->bandCount; bandIndex++) if (coordinate >= plane->bands[bandIndex].start && coordinate <= plane->bands[bandIndex].end) {
            bandOffset = bandOffsets[bandIndex];
            break;
        }
        if (amplitudeQ8 && coordinate >= wave->start && coordinate <= wave->end) {
            if (wave->preset == BML_WAVE_JITTER) {
                const u8 noise = (coordinate * 37 + frame * 17) & 3;
                const s16 jitter = noise == 0 ? -1 : noise == 3 ? 1 : 0;
                offset = (s16) (((s32) jitter * amplitudeQ8) >> 8);
            } else if (wave->preset == BML_WAVE_SHEAR) {
                offset = (s16) (((s32) (coordinate - wave->start) * amplitudeQ8) / ((wave->end - wave->start + 1) << 8));
            } else {
                const u16 phase = (u16) ((spatialPhase + framePhase) & 1023);
                const s32 first = ((s32) BML_sinQ14[phase] * amplitudeQ8) >> 22;
                if (wave->preset == BML_WAVE_DUAL_SINE) {
                    const s32 second = ((s32) BML_sinQ14[(phase * 2 + 127) & 1023] * amplitudeQ8) >> 23;
                    offset = (s16) (first + second);
                } else if (wave->preset == BML_WAVE_RIPPLE) offset = (s16) (first < 0 ? -first : first);
                else offset = (s16) first;
            }
        }
        target[index] = bandOffset + offset;
        coordinate += coordinateStep;
        spatialPhase += phaseStep;
        phaseRemainder += phaseRemainderStep;
        if (phaseRemainder >= wavelength) {
            phaseRemainder -= wavelength;
            spatialPhase++;
        }
    }
}

static void applyBackgroundScroll(const BML_GameStage *stage, u16 frame) {
    const BML_BackgroundConfig *background = findBackground(activeBackgroundRuntimeId);
    const u16 camera = (u16) (cameraScrollQ8 >> 8);
    const u16 mapCamera = camera & 0xFFF0;
    u8 plane;
    if (!background) return;
    for (plane = 0; plane < 2; plane++) if (activeBackgroundMaps[plane]) {
        const u32 mapX = stage->horizontal ? mapCamera : 0;
        const u32 mapY = stage->horizontal ? 0 : mapCamera;
        if (activeBackgroundMaps[plane]->posX != mapX || activeBackgroundMaps[plane]->posY != mapY) {
            VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);
            MAP_scrollTo(activeBackgroundMaps[plane], mapX, mapY);
            break;
        }
    }
    if (stage->horizontal) {
        static s16 bgA[224];
        static s16 bgB[224];
        VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE);
        fillBackgroundScrollTable(&background->bgA, &activeWave[0], 0, frame, activeWaveStartFrame[0], 1, 224, bgA);
        fillBackgroundScrollTable(&background->bgB, &activeWave[1], 1, frame, activeWaveStartFrame[1], 1, 224, bgB);
        VDP_setHorizontalScrollLine(BG_A, 0, bgA, 224, DMA_QUEUE);
        VDP_setHorizontalScrollLine(BG_B, 0, bgB, 224, DMA_QUEUE);
    } else {
        static s16 bgA[20];
        static s16 bgB[20];
        VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_COLUMN);
        fillBackgroundScrollTable(&background->bgA, &activeWave[0], 0, frame, activeWaveStartFrame[0], 16, 20, bgA);
        fillBackgroundScrollTable(&background->bgB, &activeWave[1], 1, frame, activeWaveStartFrame[1], 16, 20, bgB);
        VDP_setVerticalScrollTile(BG_A, 0, bgA, 20, DMA_QUEUE);
        VDP_setVerticalScrollTile(BG_B, 0, bgB, 20, DMA_QUEUE);
    }
}

static bool bossRuntimeIdActive(u8 runtimeId) {
    u8 index;
    for (index = 0; index < HOST_MAX_ENEMIES; index++) if (enemies[index].active && enemies[index].bossConfig && enemies[index].bossConfig->runtimeId == runtimeId) return TRUE;
    return FALSE;
}

static void executeTypedAction(const BML_StageEventV2 *event, u16 gameFrame) {
    const BML_BackgroundConfig *background;
    if (event->actionType == BML_ACTION_SET_SCROLL) {
        scrollStartQ8 = mainScrollQ8;
        scrollTargetQ8 = event->valueQ8;
        scrollTweenFrame = 0;
        scrollTweenDuration = event->durationFrames;
        scrollTweenInterpolation = event->interpolation;
        if (!scrollTweenDuration) mainScrollQ8 = scrollTargetQ8;
    } else if (event->actionType == BML_ACTION_SET_BACKGROUND) {
        activeBackgroundRuntimeId = event->backgroundRuntimeId;
        background = findBackground(activeBackgroundRuntimeId);
        if (background) {
            activeWave[0] = background->bgA.wave;
            activeWave[1] = background->bgB.wave;
            activeWaveStartFrame[0] = gameFrame;
            activeWaveStartFrame[1] = gameFrame;
            if (!switchBackground(background, event->transition || background->transition)) backgroundLoadFailed = TRUE;
        } else backgroundLoadFailed = TRUE;
    } else if (event->actionType == BML_ACTION_SET_WAVE) {
        activeWave[event->plane ? 1 : 0] = event->wave;
        activeWaveStartFrame[event->plane ? 1 : 0] = gameFrame;
    } else if (event->actionType == BML_ACTION_SET_FLAG) {
        writeFlag(event->flag, event->valueQ8 != 0);
    } else if (event->actionType == BML_ACTION_CLEAR_BULLETS) {
        BML_clearAll();
    } else if (event->actionType == BML_ACTION_STAGE_CLEAR) {
        stageClearRequested = TRUE;
    }
}

static void processTypedEvents(const BML_GameStage *stage, u16 gameFrame) {
    u8 index;
    for (index = 0; index < stage->typedEventCount; index++) if (!typedEventFired[index]) {
        const BML_StageEventV2 *event = &stage->typedEvents[index];
        bool ready = FALSE;
        if (event->triggerType == BML_TRIGGER_FRAME) ready = gameFrame >= (u16) (event->triggerValueQ8 >> 8);
        else if (event->triggerType == BML_TRIGGER_SCROLL) ready = cameraScrollQ8 >= event->triggerValueQ8;
        else if (event->triggerBossRuntimeId) ready = bossSeen[event->triggerBossRuntimeId] && !bossRuntimeIdActive(event->triggerBossRuntimeId);
        else if (event->triggerFlag && event->triggerFlag[0]) ready = readFlag(event->triggerFlag);
        if (ready) { typedEventFired[index] = 1; executeTypedAction(event, gameFrame); }
    }
}

static void updateMainScroll(void) {
    if (scrollTweenDuration && scrollTweenFrame < scrollTweenDuration) {
        const u16 ratio = tweenQ8(scrollTweenFrame, scrollTweenDuration, scrollTweenInterpolation);
        mainScrollQ8 = scrollStartQ8 + (((scrollTargetQ8 - scrollStartQ8) * ratio) >> 8);
        scrollTweenFrame++;
    }
    cameraScrollQ8 += mainScrollQ8;
}

static u8 runStage(const BML_GameStage *stage) {
    u16 gameFrame = 0;
    u16 nextEvent = 0;
    u16 previous = 0;
    bool paused = FALSE;
    u16 rankQ16 = BML_FIXED_RANK_Q16;
    const BML_BackgroundConfig *background;
    bmlQaOrientation = stage->horizontal ? 1 : 0;
    bmlQaDifficulty = 1;
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
    bmlQaLives = lives;
    bmlQaHits = 0;
    BML_init();
    if (!BML_isReady()) {
        bmlQaStageOutcome = 2;
        bmlQaScreen = 3;
        return 2;
    }
    memset(enemies, 0, sizeof(enemies));
    memset(hostItems, 0, sizeof(hostItems));
    memset(hostEffects, 0, sizeof(hostEffects));
    memset(shotActive, 0, sizeof(shotActive));
    memset(shotVisible, 0, sizeof(shotVisible));
    memset(typedEventFired, 0, sizeof(typedEventFired));
    memset(bossSeen, 0, sizeof(bossSeen));
    renderedBulletCount = 0;
    invincible = 0; diagnostics = FALSE; stageClearRequested = FALSE; backgroundLoadFailed = FALSE;
    gameplayBgmActive = FALSE;
    bmlQaGameplayBgmStarted = 0;
    bmlQaPcmWhileBgm = 0;
    hitInvincibilityFrames = 180;
    mainScrollQ8 = 256; cameraScrollQ8 = 0; scrollStartQ8 = 256; scrollTargetQ8 = 256; scrollTweenFrame = 0; scrollTweenDuration = 0; scrollTweenInterpolation = BML_INTERPOLATION_STEP;
    activeBackgroundRuntimeId = stage->backgroundRuntimeId;
    background = findBackground(activeBackgroundRuntimeId);
    activeWaveStartFrame[0] = 0; activeWaveStartFrame[1] = 0;
    if (background) { activeWave[0] = background->bgA.wave; activeWave[1] = background->bgB.wave; }
    else { memset(activeWave, 0, sizeof(activeWave)); }
    playerX = stage->horizontal ? 48 : 160;
    playerY = stage->horizontal ? 112 : 196;
    playerXQ8 = (s32) playerX << 8;
    playerYQ8 = (s32) playerY << 8;
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    if (!drawStageBackground(background, stage->horizontal) || !initSprites()) {
        bmlQaStageOutcome = 2;
        bmlQaScreen = 3;
        return 2;
    }
    updateResourceQa();
    if (background && background->bgm) {
        XGM2_setLoopNumber(-1);
        XGM2_play(background->bgm);
        gameplayBgmActive = TRUE;
        bmlQaGameplayBgmStarted = 1;
    }
    bmlQaScreen = 2;
    while (lives && !stageClearRequested && !backgroundLoadFailed && gameFrame < stage->durationFrames) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & BUTTON_START) paused = !paused;
        if (!paused) {
            const s32 oldXQ8 = playerXQ8;
            const s32 oldYQ8 = playerYQ8;
            const u16 playerSpeed = bmlPlayerConfig.speedsQ8[speedMode];
            const BML_WeaponConfig *weapon = findWeapon(weaponRuntimeId);
            const BML_CollisionMaterial *material;
            u8 animationRow;
            if (pressed & speedButton) speedMode = (speedMode + 1) % 3;
            if (pressed & bombButton) activateBomb();
            if (joy & BUTTON_LEFT) playerXQ8 -= playerSpeed;
            if (joy & BUTTON_RIGHT) playerXQ8 += playerSpeed;
            if (joy & BUTTON_UP) playerYQ8 -= playerSpeed;
            if (joy & BUTTON_DOWN) playerYQ8 += playerSpeed;
            if (playerXQ8 < (8 << 8)) playerXQ8 = 8 << 8;
            if (playerXQ8 > (312 << 8)) playerXQ8 = 312 << 8;
            if (playerYQ8 < (16 << 8)) playerYQ8 = 16 << 8;
            if (playerYQ8 > (216 << 8)) playerYQ8 = 216 << 8;
            playerX = playerXQ8 >> 8; playerY = playerYQ8 >> 8;
            material = collisionMaterialAt(stage, playerX, playerY);
            if (material && (material->mask & 1)) {
                if (material->solid) { playerXQ8 = oldXQ8; playerYQ8 = oldYQ8; playerX = playerXQ8 >> 8; playerY = playerYQ8 >> 8; }
                if (material->damage && !invincible) applyPlayerHit();
            }
            if (stage->horizontal) animationRow = (joy & BUTTON_UP) && !(joy & BUTTON_DOWN) ? bmlPlayerConfig.horizontalRows[0] : (joy & BUTTON_DOWN) && !(joy & BUTTON_UP) ? bmlPlayerConfig.horizontalRows[2] : bmlPlayerConfig.horizontalRows[1];
            else animationRow = (joy & BUTTON_LEFT) && !(joy & BUTTON_RIGHT) ? bmlPlayerConfig.verticalRows[0] : (joy & BUTTON_RIGHT) && !(joy & BUTTON_LEFT) ? bmlPlayerConfig.verticalRows[2] : bmlPlayerConfig.verticalRows[1];
            SPR_setAnim(playerSprite, animationRow);
            if (weapon && (joy & shotButton) && !(gameFrame % weapon->intervalFrames)) firePlayerShot(stage->horizontal);
            processTypedEvents(stage, gameFrame);
            while (nextEvent < stage->eventCount && stage->events[nextEvent].spawnFrame <= gameFrame) { spawnEvent(&stage->events[nextEvent], rankQ16, (u16) (0xACE1 + nextEvent * 73)); nextEvent++; }
            updateEnemies(stage, gameFrame, rankQ16);
            updateShots(stage);
            updateItems(stage->horizontal);
            updateEffects();
            updateMainScroll();
            applyBackgroundScroll(stage, gameFrame);
            BML_setPlayer(playerX * 64, playerY * 64);
            BML_tick();
            collideEnemyShotsWithMap(stage);
            applyBulletSprites();
            collidePlayer();
            gameFrame++;
            playFrames++;
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
    gameplayBgmActive = FALSE;
    BML_shutdown();
    releaseSprites();
    releaseBackgroundMaps();
    if (lives && !backgroundLoadFailed && (stageClearRequested || (stage->caravan && gameFrame >= stage->durationFrames))) bmlQaCompletedStages++;
    bmlQaStageOutcome = lives && !backgroundLoadFailed && (stageClearRequested || (stage->caravan && gameFrame >= stage->durationFrames)) ? 1 : 2;
    bmlQaScreen = 3;
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    VDP_drawText(bmlQaStageOutcome == 1 ? (stage->caravan ? "TIME UP - RESULT" : "STAGE CLEAR") : "GAME OVER", 12, 10);
    VDP_drawText("PRESS START", 14, 15);
    while (!(JOY_readJoypad(JOY_1) & BUTTON_START)) SYS_doVBlankProcess();
    while (JOY_readJoypad(JOY_1) & BUTTON_START) SYS_doVBlankProcess();
    return bmlQaStageOutcome;
}

static const BML_GameStage *findStage(u8 runtimeId) {
    u8 index;
    for (index = 0; index < bmlGameStageCount; index++) if (bmlGameStages[index].runtimeId == runtimeId) return &bmlGameStages[index];
    return NULL;
}

static u8 nextStageId(const BML_GameStage *stage) {
    u8 index;
    for (index = 0; index < stage->nextCount; index++) {
        const BML_StageNext *edge = &stage->next[index];
        if (!edge->flag || !edge->flag[0] || readFlag(edge->flag) == edge->equals) return edge->stageRuntimeId;
    }
    return 0;
}

static void resetRunState(void) {
    score = 0;
    lives = bmlPlayerConfig.initialLives;
    bombs = bmlPlayerConfig.initialBombs;
    weaponRuntimeId = bmlPlayerConfig.initialWeaponRuntimeId;
    speedMode = bmlPlayerConfig.initialSpeed;
    stagesCleared = 0;
    playFrames = 0;
    memset(flagHashes, 0, sizeof(flagHashes));
    memset(flagValues, 0, sizeof(flagValues));
}

static bool askContinue(u8 *remaining) {
    u16 previous = 0;
    if (!*remaining) return FALSE;
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    VDP_drawText("CONTINUE?", 15, 9);
    VDP_drawText("START: YES   B: NO", 10, 13);
    while (TRUE) {
        u16 joy = JOY_readJoypad(JOY_1);
        u16 pressed = joy & ~previous;
        previous = joy;
        if (pressed & (BUTTON_A | BUTTON_START)) { (*remaining)--; return TRUE; }
        if (pressed & BUTTON_B) return FALSE;
        SYS_doVBlankProcess();
    }
}

static void runCampaign(bool resume) {
    u8 stageRuntimeId;
    u8 continues = BML_CAMPAIGN_CONTINUES;
    currentMode = 0;
    if (resume && checkpointValid) {
        stageRuntimeId = checkpointStageRuntimeId;
        score = checkpointScore; playFrames = checkpointPlayFrames; lives = checkpointLives; bombs = checkpointBombs; weaponRuntimeId = checkpointWeaponRuntimeId; speedMode = checkpointSpeedMode; stagesCleared = checkpointStagesCleared;
    } else {
        resetRunState();
        stageRuntimeId = BML_CAMPAIGN_START_STAGE_ID;
        runDemo(BML_DEMO_OPENING_SCENE);
    }
    while (stageRuntimeId) {
        const BML_GameStage *stage = findStage(stageRuntimeId);
        u8 outcome;
        u8 next;
        if (!stage) break;
        runDemo(stage->preDemoScene);
        outcome = runStage(stage);
        if (outcome != 1) {
            if (askContinue(&continues)) { score = 0; lives = bmlPlayerConfig.initialLives; bombs = bmlPlayerConfig.initialBombs; continue; }
            break;
        }
        stagesCleared++;
        runDemo(stage->postDemoScene);
        next = nextStageId(stage);
        if (!next) runDemo(readFlag(BML_DEMO_ENDING_FLAG) == BML_DEMO_ENDING_RESCUE_WHEN ? BML_DEMO_ENDING_RESCUE_SCENE : BML_DEMO_ENDING_DESTROY_SCENE);
        saveCheckpoint(next);
        stageRuntimeId = next;
    }
    insertHighScore(0, score, stagesCleared, playFrames);
    checkpointValid = FALSE;
    saveAll();
}

static void runCaravan(void) {
    const BML_GameStage *stage = findStage(BML_CARAVAN_STAGE_ID);
    u32 remaining;
    currentMode = 1;
    resetRunState();
    if (!stage) return;
    runDemo(BML_DEMO_CARAVAN_PRE_SCENE);
    runStage(stage);
    runDemo(BML_DEMO_CARAVAN_RESULT_SCENE);
    remaining = BML_CARAVAN_TIME_LIMIT_FRAMES > bmlQaStageFrame ? BML_CARAVAN_TIME_LIMIT_FRAMES - bmlQaStageFrame : 0;
    insertHighScore(1, score, remaining, playFrames);
}

void BML_gameRun(void) {
    u16 mode = 0;
    u16 fixedRank = 1;
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    PAL_setPalette(PAL2, bmlPlayerConfig.sprite.definition->palette->data, CPU);
    if (bmlEnemyCount) PAL_setPalette(PAL3, bmlEnemies[0].sprite.definition->palette->data, CPU);
    else PAL_setPalette(PAL3, BML_BULLET_SPRITE.palette->data, CPU);
    bmlQaScreen = 0;
    bmlQaSelfTest = 0;
    bmlQaSelfTestCrcHigh = 0;
    bmlQaSelfTestCrcLow = 0;
    bmlQaSelfTestFrame = 0;
    bmlQaCompletedStages = 0;
    bmlQaLoadProbe = 0;
    bmlQaShotButton = 0;
    bmlQaBombButton = 1;
    bmlQaSpeedButton = 2;
    bmlQaSramLoaded = 0;
    bmlQaCheckpointValid = 0;
    bmlQaGameplayBgmStarted = 0;
    bmlQaPcmWhileBgm = 0;
    selfTestPassed = FALSE;
    loadTestPassed = FALSE;
    diagnosticsRan = FALSE;
    memset(highScores, 0, sizeof(highScores));
    resetRunState();
    loadAll();
    while (TRUE) {
        if (!checkpointValid && mode == 2) mode = 0;
        selectGame(&mode, &fixedRank);
        if (mode == 1) runCaravan();
        else runCampaign(mode == 2);
    }
}
