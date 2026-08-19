#ifndef GERONEKO_EFFECT_H
#define GERONEKO_EFFECT_H

#include <genesis.h>

typedef struct
{
    s16 x;
    s16 y;
    u16 timer;
    u8 type;
    u8 frame;
    u8 flags;
    u8 renderHandle;
} Effect;

void effectInit(void);
void effectReset(void);
void effectUpdateAll(void);
bool effectSpawnExplosion(s16 x, s16 y);

u8 effectGetActiveCount(void);
const Effect* effectGet(u8 index);

#endif
