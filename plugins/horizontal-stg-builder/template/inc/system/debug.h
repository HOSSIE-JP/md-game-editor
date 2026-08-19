#ifndef GERONEKO_DEBUG_H
#define GERONEKO_DEBUG_H

#include <genesis.h>

typedef struct
{
    u16 playerBulletOverflow;
    u16 enemyBulletOverflow;
    u16 enemyOverflow;
    u16 effectOverflow;
} DebugCounters;

void debugInit(void);
DebugCounters* debugGetCounters(void);
void debugDraw(void);

#endif
