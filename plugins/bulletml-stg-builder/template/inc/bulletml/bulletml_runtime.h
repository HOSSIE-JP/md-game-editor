#ifndef BULLETML_RUNTIME_H
#define BULLETML_RUNTIME_H

#include <genesis.h>

#define BML_MAX_BULLETS 48
#define BML_MAX_EMITTERS 5
#define BML_MAX_CONTEXTS 106
#define BML_MAX_SPAWNS_PER_FRAME 16
#define BML_MAX_OPCODES_PER_FRAME 512
#define BML_SCANLINES 224

typedef struct {
    u16 id;
    s16 x64;
    s16 y64;
    u16 direction;
    s16 speed64;
    u16 age;
    u8 hitboxRadius;
    s8 hitboxX;
    s8 hitboxY;
    u8 width;
    u8 height;
    bool visible;
} BML_Bullet;

typedef struct {
    u32 frame;
    u16 bullets;
    u16 emitters;
    u16 contexts;
    u16 maxBullets;
    u16 maxEmitters;
    u16 maxContexts;
    u16 spawnedThisFrame;
    u16 opcodesThisFrame;
    u16 lastOpcode;
    u16 displaySpritesThisFrame;
    u16 maxPiecesThisFrame;
    u16 maxDotsThisFrame;
    u32 spawned;
    u32 fireDrops;
    u32 poolDrops;
    u32 spawnDrops;
    u32 contextDrops;
    u32 opcodeExhaustions;
    u32 displayDeletes;
    u32 culled;
    u32 expired;
} BML_Metrics;

void BML_init(void);
bool BML_isReady(void);
void BML_shutdown(void);
s16 BML_startEmitter(const u8 *program, u16 programLength, s16 x64, s16 y64, u16 direction, u16 seed, u16 rankQ16);
bool BML_updateEmitter(s16 emitterId, s16 x64, s16 y64, u16 direction);
bool BML_stopEmitter(s16 emitterId);
void BML_setPlayer(s16 x64, s16 y64);
void BML_tick(void);
u16 BML_applyDisplayBudget(u16 reservedGlobalSprites, const u8 *reservedPiecesByScanline, const u16 *reservedDotsByScanline);
u16 BML_applyDisplayBudgetSparse(u16 reservedGlobalSprites, const u8 *reservedPiecesByScanline, const u16 *reservedDotsByScanline, u16 reservedMaxPieces, u16 reservedMaxDots);
const BML_Bullet *BML_getBullets(u16 *count);
bool BML_removeBullet(u16 index);
void BML_clearAll(void);
const BML_Metrics *BML_getMetrics(void);
u32 BML_stateCrc(u32 previous);

#endif
