#include <genesis.h>
#include "generated/novel_data.h"
#include "novel_runtime/novel_runtime.h"

int main(bool hardReset)
{
    (void)hardReset;
    VDP_setScreenWidth320();
    VDP_setScreenHeight224();
    VDP_setPlaneSize(64, 32, TRUE);
    novelInit(&gNovelProject);

    while (TRUE)
    {
        novelUpdate();
        SYS_doVBlankProcess();
    }

    return 0;
}
