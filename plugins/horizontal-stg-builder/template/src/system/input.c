#include <genesis.h>
#include "system/input.h"

static InputState player1;
static u16 previous1;

void inputInit(void)
{
    previous1 = JOY_readJoypad(JOY_1);
    player1.held = previous1;
    player1.pressed = 0;
    player1.released = 0;
}

void inputSample(void)
{
    const u16 current = JOY_readJoypad(JOY_1);

    player1.held = current;
    player1.pressed = current & ~previous1;
    player1.released = previous1 & ~current;

    previous1 = current;
}

const InputState* inputGetPlayer1(void)
{
    return &player1;
}
