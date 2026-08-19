#ifndef HORIZONTAL_STG_SCREENS_H
#define HORIZONTAL_STG_SCREENS_H

#include <genesis.h>
#include "system/save.h"

void screensInit(void);
void screensDrawTitle(void);
void screensUpdateTitle(u32 frame);
void screensDrawMainMenu(u8 selected);
void screensDrawOptions(u8 selected, const StgOptions* options);
void screensDrawHighScores(u8 difficulty);
void screensDrawSoundTest(u8 audioId, bool playing);
void screensDrawHowTo(void);
void screensDrawOpening(u8 page);
void screensDrawStageIntro(u8 stageIndex, u8 stageId);
void screensDrawPause(u8 selected);
void screensClearPause(void);
void screensDrawStageResult(u32 clearFrames, bool noMiss, bool coreOwned, u8 bombs, u32 bonus);
void screensDrawContinue(u8 seconds, u8 continuesLeft);
void screensDrawGameOver(void);
void screensDrawNameEntry(const char* name, u8 cursor, u32 score);
void screensDrawEnding(u8 page);
void screensDrawStaffRoll(u32 timer);

#endif
