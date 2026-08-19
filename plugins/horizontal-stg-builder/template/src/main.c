#include <genesis.h>
#include "game/game.h"

int main(bool hardReset)
{
    VDP_setScreenWidth320();
    VDP_setScreenHeight224();
    VDP_setPlaneSize(64, 32, TRUE);

    gameInit(hardReset);

    while (TRUE)
    {
        gameUpdate();
        SYS_doVBlankProcess();
    }

    return 0;
}
