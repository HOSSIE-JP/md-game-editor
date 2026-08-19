#ifndef GERONEKO_RECOVERY_H
#define GERONEKO_RECOVERY_H

#include <genesis.h>
#include "item/item.h"

void recoveryInit(void);
void recoveryResetForStage(void);
void recoveryOnPlayerDeath(void);
void recoveryUpdate(void);

bool recoveryTryHitByNormalShot(s16 x, s16 y);

#endif
