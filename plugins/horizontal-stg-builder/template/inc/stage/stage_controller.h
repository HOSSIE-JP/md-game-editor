#ifndef GERONEKO_STAGE_CONTROLLER_H
#define GERONEKO_STAGE_CONTROLLER_H

#include <genesis.h>
#include "stage/stage_definition.h"

typedef struct
{
    u8 stageId;
    s32 cameraX256;
    s32 previousCameraX256;
    u32 stageFrame;
    s16 scrollSpeed256;
    u8 flags;
    u8 activeBossId;
    bool bossEncounterActive;
    bool finalBossDefeated;
    bool clearArmed;
    const StageDefinition* definition;
} StageContext;

void stageInit(void);
void stageEnter(u8 stageId);
void stageUpdate(void);
void stageLeave(void);

s32 stageGetCameraX256(void);
u32 stageGetFrame(void);

bool stageGetFlag(u8 flag);
bool stageIsEndRequested(void);
void stageRequestClear(void);
const StageDefinition* stageGetCurrentDefinition(void);

#endif
