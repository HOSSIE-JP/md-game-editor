#ifndef GERONEKO_INPUT_H
#define GERONEKO_INPUT_H

#include <genesis.h>

typedef struct
{
    u16 held;
    u16 pressed;
    u16 released;
} InputState;

void inputInit(void);
void inputSample(void);
const InputState* inputGetPlayer1(void);

#endif
