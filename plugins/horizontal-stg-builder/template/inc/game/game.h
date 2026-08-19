#ifndef GERONEKO_GAME_H
#define GERONEKO_GAME_H

#include <genesis.h>

typedef enum
{
    GAME_STATE_BOOT = 0,
    GAME_STATE_TITLE,
    GAME_STATE_MAIN_MENU,
    GAME_STATE_OPTIONS,
    GAME_STATE_HIGH_SCORES,
    GAME_STATE_SOUND_TEST,
    GAME_STATE_HOW_TO,
    GAME_STATE_OPENING,
    GAME_STATE_STAGE_INTRO,
    GAME_STATE_STAGE_LOAD,
    GAME_STATE_PLAY,
    GAME_STATE_PAUSE,
    GAME_STATE_STAGE_CLEAR,
    GAME_STATE_CONTINUE,
    GAME_STATE_GAME_OVER,
    GAME_STATE_NAME_ENTRY,
    GAME_STATE_ENDING,
    GAME_STATE_STAFF_ROLL
} GameState;

typedef struct
{
    u32 score;
    u32 rngSeed;
    u16 abyssValue;
    u8 lives;
    u8 currentStage;
    u8 stageIndex;
    u8 weaponColor;
    u8 weaponLevel;
    u8 speedLevel;
    u8 bombs;
    u8 difficulty;
    u8 continuesLeft;
    u8 nextExtendIndex;
    u8 shotButton;
    u8 coreButton;
    u8 bombButton;
    u8 soundEnabled;
} GameSession;

void gameInit(bool hard);
void gameUpdate(void);

void gameRequestState(GameState next);
GameState gameGetState(void);

GameSession* gameGetSession(void);
void gameAddScore(u32 value);
u8 gameConsumeLife(void);
u8 gameGetLives(void);

u8 gameGetSpeedLevel(void);
bool gameAddSpeedLevel(void);

u8 gameGetBombs(void);
bool gameAddBomb(void);
bool gameUseBomb(void);

s16 gameScaleEnemyBulletSpeed(s16 speed256);
u8 gameGetEnemyShotCount(u32 sequence);

#endif
