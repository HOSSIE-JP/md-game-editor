#include <genesis.h>
#include "game/config.h"
#include "stage/stage_controller.h"
#include "enemy/enemy.h"
#include "enemy/boss.h"
#include "item/item.h"
#include "generated/generated_ids.h"
#include "generated/stage_defs.h"

enum
{
    STAGE_CMD_END = 0,
    STAGE_CMD_SPAWN_ENEMY = 1,
    STAGE_CMD_STAGE_CLEAR = 2,
    STAGE_CMD_SET_FLAG = 3,
    STAGE_CMD_SPAWN_ITEM = 4,
    STAGE_CMD_START_BOSS = 5
};

typedef struct
{
    const u8* ptr;
    u32 nextAt;
    bool ended;
} StageEventCursor;

static StageContext context;
static StageEventCursor frameCursor;
static StageEventCursor scrollCursor;
static const u8* conditionPtr;

static u16 readU16LE(const u8** ptr)
{
    const u8* p = *ptr;
    const u16 value = (u16)p[0] | ((u16)p[1] << 8);
    *ptr = p + 2;
    return value;
}

static s16 readS16LE(const u8** ptr)
{
    return (s16)readU16LE(ptr);
}

static void initDeltaCursor(StageEventCursor* cursor, const u8* stream)
{
    cursor->ptr = stream;
    cursor->nextAt = readU16LE(&cursor->ptr);
    cursor->ended = FALSE;
}

static void setFlag(u8 flag)
{
    if (flag < 8)
        context.flags |= (u8)(1u << flag);
}

static void executeCommand(u8 command, const u8** ptr)
{
    switch (command)
    {
        case STAGE_CMD_SPAWN_ENEMY:
        {
            const u8 enemyType = *(*ptr)++;
            const s16 screenX = readS16LE(ptr);
            const s16 screenY = readS16LE(ptr);

            enemySpawn(
                (EnemyTypeId)enemyType,
                context.cameraX256 + ((s32)screenX * FIXED_ONE),
                (s32)screenY * FIXED_ONE);
            break;
        }


        case STAGE_CMD_SPAWN_ITEM:
        {
            const u8 itemType = *(*ptr)++;
            const s16 screenX = readS16LE(ptr);
            const s16 screenY = readS16LE(ptr);
            itemSpawn((ItemType)itemType, screenX, screenY);
            break;
        }


        case STAGE_CMD_START_BOSS:
        {
            const u8 bossId = *(*ptr)++;
            if (bossStart(bossId))
            {
                context.scrollSpeed256 = 0;
                context.activeBossId = bossId;
                context.bossEncounterActive = TRUE;
            }
            break;
        }

        case STAGE_CMD_STAGE_CLEAR:
            context.clearArmed = TRUE;
            break;

        case STAGE_CMD_SET_FLAG:
        {
            const u8 flag = *(*ptr)++;
            if (flag != 0xFF)
                setFlag(flag);
            break;
        }

        case STAGE_CMD_END:
        default:
            break;
    }
}

static void updateDeltaCursor(StageEventCursor* cursor, u32 current)
{
    while (!cursor->ended && (current >= cursor->nextAt))
    {
        const u8 command = *cursor->ptr++;

        if (command == STAGE_CMD_END)
        {
            cursor->ended = TRUE;
            break;
        }

        executeCommand(command, &cursor->ptr);

        cursor->nextAt += readU16LE(&cursor->ptr);
    }
}

static bool conditionIsTrue(u8 conditionId)
{
    switch (conditionId)
    {
        case 0:
            return stageGetFlag(0) && (enemyGetActiveCount() == 0);

        default:
            return FALSE;
    }
}

static void updateConditionCursor(void)
{
    while (TRUE)
    {
        const u8 conditionId = *conditionPtr;

        if (conditionId == 0xFF)
            return;

        if (!conditionIsTrue(conditionId))
            return;

        conditionPtr++;

        {
            const u8 command = *conditionPtr++;
            if (command == STAGE_CMD_END)
                return;

            executeCommand(command, &conditionPtr);
        }
    }
}

void stageInit(void)
{
    context.stageId = STG_FIRST_STAGE_ID;
    context.cameraX256 = 0;
    context.previousCameraX256 = 0;
    context.stageFrame = 0;
    context.scrollSpeed256 = FIXED_ONE;
    context.flags = 0;
    context.activeBossId = BOSS_NONE;
    context.bossEncounterActive = FALSE;
    context.finalBossDefeated = FALSE;
    context.clearArmed = FALSE;
    context.definition = NULL;
}

void stageEnter(u8 stageId)
{
    const StageDefinition* def;

    if ((stageId == STAGE_NONE) || (stageId >= STAGE_TYPE_COUNT))
        stageId = STG_FIRST_STAGE_ID;

    def = &gStageDefinitions[stageId];

    context.stageId = stageId;
    context.cameraX256 = 0;
    context.previousCameraX256 = 0;
    context.stageFrame = 0;
    context.scrollSpeed256 = def->initialScrollSpeed256;
    context.flags = 0;
    context.activeBossId = BOSS_NONE;
    context.bossEncounterActive = FALSE;
    context.finalBossDefeated = FALSE;
    context.clearArmed = FALSE;
    context.definition = def;

    initDeltaCursor(&frameCursor, def->frameStream);
    initDeltaCursor(&scrollCursor, def->scrollStream);
    conditionPtr = def->conditionStream;
}

void stageUpdate(void)
{
    u32 scrollX;

    if (context.bossEncounterActive && bossIsDefeated())
    {
        context.bossEncounterActive = FALSE;
        if ((context.definition != NULL) &&
            (context.activeBossId == context.definition->bossId))
        {
            context.finalBossDefeated = TRUE;
        }
        else if (context.definition != NULL)
        {
            context.scrollSpeed256 = context.definition->initialScrollSpeed256;
        }
    }

    context.previousCameraX256 = context.cameraX256;
    context.cameraX256 += context.scrollSpeed256;
    context.stageFrame++;

    scrollX = (u32)(context.cameraX256 >> FIXED_SHIFT);

    /* Fixed deterministic order: frame -> scroll -> condition. */
    updateDeltaCursor(&frameCursor, context.stageFrame);
    updateDeltaCursor(&scrollCursor, scrollX);
    updateConditionCursor();
}

void stageLeave(void)
{
}

s32 stageGetCameraX256(void)
{
    return context.cameraX256;
}

u32 stageGetFrame(void)
{
    return context.stageFrame;
}

bool stageGetFlag(u8 flag)
{
    if (flag >= 8)
        return FALSE;

    return (context.flags & (1u << flag)) != 0;
}

bool stageIsEndRequested(void)
{
    if (!context.clearArmed || bossIsActive())
        return FALSE;

    if ((context.definition == NULL) ||
        (context.definition->bossId == BOSS_NONE))
        return TRUE;

    return context.finalBossDefeated;
}


void stageRequestClear(void)
{
    context.clearArmed = TRUE;
}


const StageDefinition* stageGetCurrentDefinition(void)
{
    return context.definition;
}
