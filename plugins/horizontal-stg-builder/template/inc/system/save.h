#ifndef HORIZONTAL_STG_SAVE_H
#define HORIZONTAL_STG_SAVE_H

#include <genesis.h>
#include "generated/game_config.h"

#define STG_DIFFICULTY_COUNT 3

typedef enum
{
    STG_DIFFICULTY_EASY = 0,
    STG_DIFFICULTY_NORMAL,
    STG_DIFFICULTY_HARD
} StgDifficulty;

typedef struct
{
    u32 score;
    u8 stage;
    char name[STG_NAME_ENTRY_LENGTH];
} StgHighScore;

typedef struct
{
    u8 difficulty;
    u8 soundEnabled;
    u8 shotButton;
    u8 coreButton;
    u8 bombButton;
} StgOptions;

void saveInit(void);
const StgOptions* saveGetOptions(void);
void saveSetOptions(const StgOptions* options);

const StgHighScore* saveGetHighScores(u8 difficulty);
s8 saveRankForScore(u8 difficulty, u32 score);
s8 saveInsertScore(u8 difficulty, u32 score, u8 stage, const char* name);

#endif
