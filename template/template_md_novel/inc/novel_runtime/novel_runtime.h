#ifndef MD_NOVEL_RUNTIME_H
#define MD_NOVEL_RUNTIME_H

#include <genesis.h>

typedef enum
{
    NOV_CMD_NOP = 0,
    NOV_CMD_BACKGROUND,
    NOV_CMD_SPRITE,
    NOV_CMD_MOVE,
    NOV_CMD_MESSAGE,
    NOV_CMD_AUDIO,
    NOV_CMD_WAIT,
    NOV_CMD_JUMP,
    NOV_CMD_INPUT,
    NOV_CMD_SPRITETEXT,
    NOV_CMD_CHOICE,
    NOV_CMD_EFFECT,
    NOV_CMD_VARIABLE,
    NOV_CMD_IF,
    NOV_CMD_SWITCH,
    NOV_CMD_GOTO
} NovelCommandType;

#define NOV_FLAG_VISIBLE        0x01
#define NOV_FLAG_FLIP_X         0x02
#define NOV_FLAG_FLIP_Y         0x04
#define NOV_FLAG_ASYNC          0x08
#define NOV_FLAG_FADE           0x10

#define NOV_FLAG_AUDIO_PLAY     0x01
#define NOV_FLAG_AUDIO_STOP     0x02
#define NOV_FLAG_AUDIO_BGM      0x04
#define NOV_FLAG_AUDIO_SFX      0x08
#define NOV_FLAG_AUDIO_IGNORED  0x10

#define NOV_FLAG_INPUT_CANCEL   0x01

#define NOV_MSG_SEPARATE_TOP    0x01
#define NOV_CHOICE_LOWERED      0x01

#define NOV_VAR_DEFINE          0
#define NOV_VAR_SET             1
#define NOV_VAR_ADD             2
#define NOV_VAR_SUB             3
#define NOV_VAR_RANDOM          4

#define NOV_COMPARE_EQ          0
#define NOV_COMPARE_NE          1
#define NOV_COMPARE_LT          2
#define NOV_COMPARE_LTE         3
#define NOV_COMPARE_GT          4
#define NOV_COMPARE_GTE         5

#define NOV_EFFECT_FADE_OUT     0
#define NOV_EFFECT_FADE_IN      1
#define NOV_EFFECT_BLANK        2
#define NOV_EFFECT_SHAKE        3
#define NOV_EFFECT_FLASH        4

typedef struct
{
    const u8 *speaker;
    const u8 * const *pages;
    u8 pageCount;
    s8 mouthSlot;
    u16 color;
    u8 layoutFlags;
} NovelMessage;

typedef struct
{
    const u8 *text;
    u16 color;
    u16 blinkFrames;
} NovelSpriteText;

typedef struct
{
    const u8 *label;
    s16 targetScene;
    s16 value;
} NovelChoiceOption;

typedef struct
{
    u8 count;
    u8 defaultIndex;
    u8 layoutFlags;
    s16 variableIndex;
    NovelChoiceOption options[4];
} NovelChoice;

typedef struct
{
    s16 value;
    s16 targetPc;
} NovelSwitchCase;

typedef struct
{
    u8 count;
    s16 defaultPc;
    NovelSwitchCase cases[16];
} NovelSwitch;

typedef struct
{
    u8 type;
    u8 flags;
    u8 slot;
    u8 count;
    s16 x;
    s16 y;
    u16 frames;
    s16 target;
    u16 aux;
    const void *data;
} NovelCommand;

typedef struct
{
    const NovelCommand *commands;
    u16 commandCount;
    s16 nextScene;
    bool fullScreen;
} NovelScene;

typedef struct
{
    const NovelScene *scenes;
    u16 sceneCount;
    u16 startScene;
    u16 messageSpeedFrames;
    bool autoEnabled;
    u16 autoWaitFrames;
    u16 spriteVramTiles;
    u16 overlayVramTiles;
    bool legacyCoordinates;
    const s16 *initialVariables;
    u16 variableCount;
} NovelProject;

void novelInit(const NovelProject *project);
void novelStartScene(u16 sceneIndex);
void novelUpdate(void);
bool novelIsRunning(void);
s16 novelGetVariable(u16 index);
void novelSetVariable(u16 index, s16 value);
void novelShutdown(void);

#endif
