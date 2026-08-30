#ifndef BULLETML_GAME_H
#define BULLETML_GAME_H

#include <genesis.h>

#define BML_GAME_MAX_EVENTS 64
#define BML_GAME_MAX_WAYPOINTS 8
#define BML_GAME_MAX_PHASES 3

typedef struct {
    s16 x;
    s16 y;
    u16 frame;
} BML_GameWaypoint;

typedef struct {
    u16 spawnFrame;
    u16 hp;
    u16 score;
    u8 enemyType;
    u8 boss;
    u8 patternIndex;
    u8 pathCount;
    u8 phaseCount;
    BML_GameWaypoint path[BML_GAME_MAX_WAYPOINTS];
    u8 phaseThreshold[BML_GAME_MAX_PHASES];
    u8 phasePattern[BML_GAME_MAX_PHASES];
} BML_GameEvent;

typedef struct {
    const u8 *data;
    u16 size;
    const char *id;
    u8 type;
} BML_GamePattern;

typedef struct {
    const BML_GameEvent *events;
    u8 eventCount;
    u16 durationFrames;
    bool horizontal;
} BML_GameStage;

extern const BML_GamePattern bmlGamePatterns[];
extern const u8 bmlGamePatternCount;
extern const BML_GameStage bmlGameStages[2];

void BML_gameRun(void);

#endif
