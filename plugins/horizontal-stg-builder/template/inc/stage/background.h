#ifndef GERONEKO_BACKGROUND_H
#define GERONEKO_BACKGROUND_H

#include <genesis.h>
#include "stage/stage_definition.h"

void backgroundInit(void);
bool backgroundResetForStage(const StageDefinition* stage);
void backgroundPrepare(s32 cameraX256);
void backgroundRelease(void);

#endif
