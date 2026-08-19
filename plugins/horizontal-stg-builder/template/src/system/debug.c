#include <genesis.h>
#include "system/debug.h"
#include "stage/stage_controller.h"

static DebugCounters counters;

void debugInit(void)
{
    counters.playerBulletOverflow = 0;
    counters.enemyBulletOverflow = 0;
    counters.enemyOverflow = 0;
    counters.effectOverflow = 0;
}

DebugCounters* debugGetCounters(void)
{
    return &counters;
}

void debugDraw(void)
{
#if defined(DEBUG) || defined(_DEBUG)
    char text[8];

    uintToStr(stageGetFrame(), text, 5);
    VDP_drawTextBGFill(WINDOW, text, 30, 1, 5);

    intToStr(counters.playerBulletOverflow, text, 1);
    VDP_drawTextBGFill(WINDOW, text, 36, 1, 1);

    intToStr(counters.enemyBulletOverflow, text, 1);
    VDP_drawTextBGFill(WINDOW, text, 37, 1, 1);

    intToStr(counters.enemyOverflow, text, 1);
    VDP_drawTextBGFill(WINDOW, text, 38, 1, 1);
#else
    (void)counters;
#endif
}
