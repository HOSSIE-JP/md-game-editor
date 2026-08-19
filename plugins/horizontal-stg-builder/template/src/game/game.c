#include <genesis.h>
#include "game/game.h"
#include "game/config.h"
#include "system/input.h"
#include "system/debug.h"
#include "system/save.h"
#include "system/audio.h"
#include "player/player.h"
#include "player/weapon.h"
#include "player/charge_shot.h"
#include "player/abyss_core.h"
#include "player/bomb.h"
#include "player/recovery.h"
#include "bullet/player_bullet.h"
#include "bullet/enemy_bullet.h"
#include "enemy/enemy.h"
#include "enemy/boss.h"
#include "collision/collision.h"
#include "effect/effect.h"
#include "item/item.h"
#include "stage/stage_controller.h"
#include "stage/background.h"
#include "render/renderer.h"
#include "render/hud.h"
#include "render/screens.h"
#include "generated/generated_ids.h"
#include "generated/game_data.h"

#define RESULT_NO_MISS_BONUS 50000UL
#define RESULT_CORE_BONUS 30000UL
#define RESULT_BOMB_BONUS 10000UL
#define RESULT_TIME_LIMIT_SECONDS 300UL
#define RESULT_TIME_BONUS_PER_SECOND 100UL
#define GAME_OVER_DISPLAY_FRAMES 180

static const char nameAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-";

static GameState currentState;
static GameState requestedState;
static bool hasStateRequest;
static GameSession session;

static u32 stateTimer;
static u8 menuSelection;
static u8 optionSelection;
static u8 scoreDifficulty;
static u8 soundTestTrack;
static bool soundTestPlaying;
static u8 storyPage;
static u8 pauseSelection;
static bool stageNoMiss;
static bool bossWasActive;

static u32 resultFrames;
static u32 resultBonus;
static bool resultNoMiss;
static bool resultCoreOwned;
static u8 resultBombs;

static StgOptions optionDraft;
static char nameEntry[STG_NAME_ENTRY_LENGTH + 1];
static u8 nameEntryIndexes[STG_NAME_ENTRY_LENGTH];
static u8 nameEntryCursor;

static u16 physicalButtonMask(u8 index)
{
    if (index == 1)
        return BUTTON_B;
    if (index == 2)
        return BUTTON_C;
    return BUTTON_A;
}

static u16 mapGameplayMask(u16 raw)
{
    u16 mapped = raw & (u16)~(BUTTON_A | BUTTON_B | BUTTON_C);

    if (raw & physicalButtonMask(session.shotButton))
        mapped |= BUTTON_A;
    if (raw & physicalButtonMask(session.coreButton))
        mapped |= BUTTON_B;
    if (raw & physicalButtonMask(session.bombButton))
        mapped |= BUTTON_C;

    return mapped;
}

static void mapGameplayInput(const InputState* raw, InputState* mapped)
{
    mapped->held = mapGameplayMask(raw->held);
    mapped->pressed = mapGameplayMask(raw->pressed);
    mapped->released = mapGameplayMask(raw->released);
}

static bool acceptPressed(const InputState* input)
{
    return (input->pressed & (BUTTON_A | BUTTON_START)) != 0;
}

static u8 wrapSelection(u8 value, s8 delta, u8 count)
{
    s16 next;

    if (count == 0)
        return 0;

    next = (s16)value + delta;
    while (next < 0)
        next += count;
    while (next >= count)
        next -= count;
    return (u8)next;
}

static void applySavedOptions(void)
{
    const StgOptions* saved = saveGetOptions();

    session.difficulty = saved->difficulty;
    session.shotButton = saved->shotButton;
    session.coreButton = saved->coreButton;
    session.bombButton = saved->bombButton;
    session.soundEnabled = saved->soundEnabled;
}

static void startNewRun(void)
{
    applySavedOptions();
    session.score = 0;
    session.lives = PLAYER_INITIAL_LIVES;
    session.stageIndex = 0;
    session.currentStage = gStgStageOrder[0];
    session.weaponColor = WEAPON_COLOR_RED;
    session.weaponLevel = WEAPON_LEVEL_MIN;
    session.speedLevel = SPEED_LEVEL_MIN;
    session.bombs = BOMB_INITIAL_STOCK;
    session.abyssValue = 0;
    session.rngSeed = 1;
    session.continuesLeft = STG_CONTINUE_COUNT;
    session.nextExtendIndex = 0;
}

static u32 calculateStageBonus(void)
{
    const u32 clearSeconds = resultFrames / 60;
    u32 bonus = 0;

    if (clearSeconds < RESULT_TIME_LIMIT_SECONDS)
        bonus += (RESULT_TIME_LIMIT_SECONDS - clearSeconds) * RESULT_TIME_BONUS_PER_SECOND;
    if (resultNoMiss)
        bonus += RESULT_NO_MISS_BONUS;
    if (resultCoreOwned)
        bonus += RESULT_CORE_BONUS;
    bonus += (u32)resultBombs * RESULT_BOMB_BONUS;
    return bonus;
}

static void beginScoreRegistration(void)
{
    if (saveRankForScore(session.difficulty, session.score) >= 0)
        gameRequestState(GAME_STATE_NAME_ENTRY);
    else
        gameRequestState(GAME_STATE_TITLE);
}

static void initializeNameEntry(void)
{
    u8 i;

    for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
    {
        nameEntry[i] = 'A';
        nameEntryIndexes[i] = 0;
    }
    nameEntry[STG_NAME_ENTRY_LENGTH] = 0;
    nameEntryCursor = 0;
}

static void swapButtonMapping(u8 action, s8 delta)
{
    u8* target;
    u8* otherA;
    u8* otherB;
    u8 current;
    u8 replacement;

    if (action == 1)
    {
        target = &optionDraft.shotButton;
        otherA = &optionDraft.coreButton;
        otherB = &optionDraft.bombButton;
    }
    else if (action == 2)
    {
        target = &optionDraft.coreButton;
        otherA = &optionDraft.shotButton;
        otherB = &optionDraft.bombButton;
    }
    else
    {
        target = &optionDraft.bombButton;
        otherA = &optionDraft.shotButton;
        otherB = &optionDraft.coreButton;
    }

    current = *target;
    replacement = wrapSelection(current, delta, 3);
    if (*otherA == replacement)
        *otherA = current;
    else if (*otherB == replacement)
        *otherB = current;
    *target = replacement;
}

static void playBossMusic(void)
{
    const StageDefinition* stage = stageGetCurrentDefinition();
    const u8 bossId = bossGetId();

    if ((stage != NULL) && (bossId == stage->bossId))
    {
        if (session.stageIndex + 1 >= STG_STAGE_ORDER_COUNT)
            audioPlay(STG_AUDIO_FINAL_BOSS);
        else
            audioPlay(STG_AUDIO_BOSS);
    }
    else
    {
        audioPlay(STG_AUDIO_MIDBOSS);
    }
}

static void synchronizeBossMusic(void)
{
    const bool active = bossIsActive();

    if (active && !bossWasActive)
    {
        playBossMusic();
    }
    else if (!active && bossWasActive)
    {
        const StageDefinition* stage = stageGetCurrentDefinition();
        if ((stage != NULL) && (bossGetId() != stage->bossId))
            audioPlay(stage->musicId);
    }

    bossWasActive = active;
}

static void enterStageLoad(void)
{
    const StageDefinition* definition;

    if (!rendererResetForStage())
    {
        gameRequestState(GAME_STATE_GAME_OVER);
        return;
    }

    enemyReset();
    bossResetForStage();
    playerBulletReset();
    enemyBulletReset();
    effectReset();
    itemReset();
    chargeReset();
    playerResetForStage();
    abyssCoreResetForStage();
    if (session.abyssValue != 0)
        abyssCoreAcquireAt(playerGetScreenX() + 18);
    bombResetForStage();
    recoveryResetForStage();
    stageEnter(session.currentStage);

    definition = stageGetCurrentDefinition();
    if (!backgroundResetForStage(definition))
    {
        gameRequestState(GAME_STATE_GAME_OVER);
        return;
    }

    VDP_setWindowOnTop(HUD_ROWS);
    hudReset();
    hudSetScore(session.score);
    hudSetLives(session.lives);
    hudSetWeapon(session.weaponColor, session.weaponLevel);
    hudSetSpeed(session.speedLevel);
    hudSetBombs(session.bombs);
    hudSetCharge(0, 0);
    hudSetCoreState((u8)abyssCoreGetState());
    hudPrepare();

    stageNoMiss = TRUE;
    bossWasActive = FALSE;
    if (definition != NULL)
        audioPlay(definition->musicId);
    gameRequestState(GAME_STATE_PLAY);
}

static void enterState(GameState state, GameState previous)
{
    stateTimer = 0;

    switch (state)
    {
        case GAME_STATE_TITLE:
            backgroundRelease();
            menuSelection = 0;
            audioPlay(STG_AUDIO_TITLE);
            screensDrawTitle();
            break;

        case GAME_STATE_MAIN_MENU:
            audioPlay(STG_AUDIO_TITLE);
            screensDrawMainMenu(menuSelection);
            break;

        case GAME_STATE_OPTIONS:
            optionDraft = *saveGetOptions();
            optionSelection = 0;
            screensDrawOptions(optionSelection, &optionDraft);
            break;

        case GAME_STATE_HIGH_SCORES:
            scoreDifficulty = session.difficulty;
            screensDrawHighScores(scoreDifficulty);
            break;

        case GAME_STATE_SOUND_TEST:
            audioStop();
            soundTestTrack = (AUDIO_TYPE_COUNT > 1) ? 1 : AUDIO_NONE;
            soundTestPlaying = FALSE;
            screensDrawSoundTest(soundTestTrack, soundTestPlaying);
            break;

        case GAME_STATE_HOW_TO:
            screensDrawHowTo();
            break;

        case GAME_STATE_OPENING:
            storyPage = 0;
            screensDrawOpening(storyPage);
            break;

        case GAME_STATE_STAGE_INTRO:
            audioStop();
            screensDrawStageIntro(session.stageIndex, session.currentStage);
            break;

        case GAME_STATE_STAGE_LOAD:
            enterStageLoad();
            break;

        case GAME_STATE_PLAY:
            if (previous == GAME_STATE_PAUSE)
            {
                screensClearPause();
                audioResume();
            }
            VDP_setWindowOnTop(HUD_ROWS);
            break;

        case GAME_STATE_PAUSE:
            pauseSelection = 0;
            audioPause();
            screensDrawPause(pauseSelection);
            break;

        case GAME_STATE_STAGE_CLEAR:
            resultFrames = stageGetFrame();
            resultNoMiss = stageNoMiss;
            resultCoreOwned = abyssCoreIsOwned();
            resultBombs = session.bombs;
            resultBonus = calculateStageBonus();
            gameAddScore(resultBonus);
            stageLeave();
            backgroundRelease();
            audioPlay(STG_AUDIO_STAGE_CLEAR);
            screensDrawStageResult(resultFrames, resultNoMiss, resultCoreOwned, resultBombs, resultBonus);
            break;

        case GAME_STATE_CONTINUE:
            backgroundRelease();
            audioPlay(STG_AUDIO_GAME_OVER_CONTINUE);
            screensDrawContinue(STG_CONTINUE_SECONDS, session.continuesLeft);
            break;

        case GAME_STATE_GAME_OVER:
            backgroundRelease();
            audioPlay(STG_AUDIO_GAME_OVER_CONTINUE);
            screensDrawGameOver();
            break;

        case GAME_STATE_NAME_ENTRY:
            audioPlay(STG_AUDIO_NAME_ENTRY);
            initializeNameEntry();
            screensDrawNameEntry(nameEntry, nameEntryCursor, session.score);
            break;

        case GAME_STATE_ENDING:
            backgroundRelease();
            audioPlay(STG_AUDIO_ENDING);
            storyPage = 0;
            screensDrawEnding(storyPage);
            break;

        case GAME_STATE_STAFF_ROLL:
            audioPlay(STG_AUDIO_STAFF_ROLL);
            screensDrawStaffRoll(0);
            break;

        case GAME_STATE_BOOT:
        default:
            break;
    }
}

static void applyRequestedState(void)
{
    GameState previous;

    if (!hasStateRequest)
        return;

    previous = currentState;
    currentState = requestedState;
    hasStateRequest = FALSE;
    enterState(currentState, previous);
}

void gameInit(bool hard)
{
    (void)hard;

    inputInit();
    debugInit();
    rendererInit();
    hudInit();
    backgroundInit();
    stageInit();
    playerInit();
    weaponInit();
    chargeInit();
    abyssCoreInit();
    bombInit();
    recoveryInit();
    playerBulletInit();
    enemyBulletInit();
    enemyInit();
    bossInit();
    effectInit();
    itemInit();
    saveInit();

    applySavedOptions();
    audioInit(session.soundEnabled != 0);
    screensInit();

    session.score = 0;
    session.lives = PLAYER_INITIAL_LIVES;
    session.currentStage = STG_FIRST_STAGE_ID;
    session.stageIndex = 0;
    session.weaponColor = WEAPON_COLOR_RED;
    session.weaponLevel = WEAPON_LEVEL_MIN;
    session.speedLevel = SPEED_LEVEL_MIN;
    session.bombs = BOMB_INITIAL_STOCK;
    session.abyssValue = 0;
    session.rngSeed = 1;
    session.continuesLeft = STG_CONTINUE_COUNT;
    session.nextExtendIndex = 0;

    currentState = GAME_STATE_BOOT;
    hasStateRequest = FALSE;
    gameRequestState(GAME_STATE_TITLE);
    applyRequestedState();
}

static void updateTitle(const InputState* input)
{
    stateTimer++;
    screensUpdateTitle(stateTimer);

    if (acceptPressed(input))
        gameRequestState(GAME_STATE_MAIN_MENU);
}

static void updateMainMenu(const InputState* input)
{
    bool changed = FALSE;

    if (input->pressed & BUTTON_UP)
    {
        menuSelection = wrapSelection(menuSelection, -1, STG_MAIN_MENU_COUNT);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_DOWN)
    {
        menuSelection = wrapSelection(menuSelection, 1, STG_MAIN_MENU_COUNT);
        changed = TRUE;
    }

    if (acceptPressed(input))
    {
        switch (menuSelection)
        {
            case 0:
                startNewRun();
                gameRequestState(GAME_STATE_OPENING);
                break;
            case 1:
                gameRequestState(GAME_STATE_OPTIONS);
                break;
            case 2:
                gameRequestState(GAME_STATE_HIGH_SCORES);
                break;
            case 3:
                gameRequestState(GAME_STATE_SOUND_TEST);
                break;
            case 4:
            default:
                gameRequestState(GAME_STATE_HOW_TO);
                break;
        }
        return;
    }

    if (input->pressed & BUTTON_B)
    {
        gameRequestState(GAME_STATE_TITLE);
        return;
    }

    if (changed)
        screensDrawMainMenu(menuSelection);
}

static void updateOptions(const InputState* input)
{
    bool changed = FALSE;
    s8 delta = 0;

    if (input->pressed & BUTTON_UP)
    {
        optionSelection = wrapSelection(optionSelection, -1, STG_OPTION_ITEM_COUNT);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_DOWN)
    {
        optionSelection = wrapSelection(optionSelection, 1, STG_OPTION_ITEM_COUNT);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_LEFT)
        delta = -1;
    else if ((input->pressed & BUTTON_RIGHT) || (input->pressed & BUTTON_A))
        delta = 1;

    if (delta != 0)
    {
        if (optionSelection == 0)
            optionDraft.difficulty = wrapSelection(optionDraft.difficulty, delta, STG_DIFFICULTY_COUNT);
        else if (optionSelection <= 3)
            swapButtonMapping(optionSelection, delta);
        else
            optionDraft.soundEnabled = !optionDraft.soundEnabled;
        changed = TRUE;
    }

    if ((input->pressed & BUTTON_B) || (input->pressed & BUTTON_START))
    {
        saveSetOptions(&optionDraft);
        applySavedOptions();
        audioSetEnabled(session.soundEnabled != 0);
        gameRequestState(GAME_STATE_MAIN_MENU);
        return;
    }

    if (changed)
        screensDrawOptions(optionSelection, &optionDraft);
}

static void updateHighScores(const InputState* input)
{
    bool changed = FALSE;

    if (input->pressed & BUTTON_LEFT)
    {
        scoreDifficulty = wrapSelection(scoreDifficulty, -1, STG_DIFFICULTY_COUNT);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_RIGHT)
    {
        scoreDifficulty = wrapSelection(scoreDifficulty, 1, STG_DIFFICULTY_COUNT);
        changed = TRUE;
    }
    if (input->pressed & (BUTTON_B | BUTTON_START))
    {
        gameRequestState(GAME_STATE_MAIN_MENU);
        return;
    }
    if (changed)
        screensDrawHighScores(scoreDifficulty);
}

static void updateSoundTest(const InputState* input)
{
    bool changed = FALSE;

    if ((AUDIO_TYPE_COUNT > 1) && (input->pressed & BUTTON_LEFT))
    {
        soundTestTrack--;
        if (soundTestTrack == AUDIO_NONE)
            soundTestTrack = AUDIO_TYPE_COUNT - 1;
        changed = TRUE;
    }
    if ((AUDIO_TYPE_COUNT > 1) && (input->pressed & BUTTON_RIGHT))
    {
        soundTestTrack++;
        if (soundTestTrack >= AUDIO_TYPE_COUNT)
            soundTestTrack = 1;
        changed = TRUE;
    }
    if (input->pressed & BUTTON_A)
    {
        if (soundTestPlaying)
            audioStop();
        else
            audioPlay(soundTestTrack);
        soundTestPlaying = audioGetCurrent() == soundTestTrack;
        changed = TRUE;
    }
    if (input->pressed & (BUTTON_B | BUTTON_START))
    {
        audioStop();
        gameRequestState(GAME_STATE_MAIN_MENU);
        return;
    }
    if (changed)
        screensDrawSoundTest(soundTestTrack, soundTestPlaying);
}

static void updateHowTo(const InputState* input)
{
    if (input->pressed & (BUTTON_A | BUTTON_B | BUTTON_START))
        gameRequestState(GAME_STATE_MAIN_MENU);
}

static void updateOpening(const InputState* input)
{
    if (!acceptPressed(input) && !(input->pressed & BUTTON_B))
        return;

    storyPage++;
    if (storyPage >= STG_OPENING_LINE_COUNT)
        gameRequestState(GAME_STATE_STAGE_INTRO);
    else
        screensDrawOpening(storyPage);
}

static void updateStageIntro(const InputState* input)
{
    stateTimer++;
    if ((stateTimer >= 90) || acceptPressed(input))
        gameRequestState(GAME_STATE_STAGE_LOAD);
}

static void updatePlay(const InputState* rawInput)
{
    InputState input;

    if (rawInput->pressed & BUTTON_START)
    {
        gameRequestState(GAME_STATE_PAUSE);
        return;
    }

    mapGameplayInput(rawInput, &input);

    stageUpdate();
    playerUpdate(&input);
    bombUpdate(input.pressed, input.held);
    weaponUpdate(input.pressed, input.held, input.released);
    abyssCoreUpdate(input.pressed);
    recoveryUpdate();

    bossUpdate();
    enemyUpdateAll();
    playerBulletUpdateAll();
    enemyBulletUpdateAll();
    chargeShotUpdateAll();
    itemUpdateAll();

    collisionRunGameplay();

    enemyResolveDamage();
    bossResolveDamage();
    playerResolvePendingHit();
    itemResolveCollected();

    enemyCleanup();
    playerBulletCleanup();
    enemyBulletCleanup();
    chargeShotCleanup();
    itemCleanup();

    effectUpdateAll();
    synchronizeBossMusic();

    if (!hasStateRequest && stageIsEndRequested())
        gameRequestState(GAME_STATE_STAGE_CLEAR);

    backgroundPrepare(stageGetCameraX256());

    hudSetScore(session.score);
    hudSetWeapon(session.weaponColor, session.weaponLevel);
    hudSetSpeed(session.speedLevel);
    hudSetBombs(session.bombs);
    hudSetCharge(chargeGetFrames(), (u8)chargeGetState());
    hudSetCoreState((u8)abyssCoreGetState());
    hudPrepare();

    rendererPrepare();
    rendererCommit();
    debugDraw();
}

static void updatePause(const InputState* input)
{
    bool changed = FALSE;

    if (input->pressed & (BUTTON_UP | BUTTON_DOWN))
    {
        pauseSelection ^= 1;
        changed = TRUE;
    }
    if (input->pressed & BUTTON_START)
    {
        gameRequestState(GAME_STATE_PLAY);
        return;
    }
    if (input->pressed & BUTTON_B)
    {
        gameRequestState(GAME_STATE_PLAY);
        return;
    }
    if (input->pressed & BUTTON_A)
    {
        if (pauseSelection == 0)
            gameRequestState(GAME_STATE_PLAY);
        else
        {
            audioStop();
            gameRequestState(GAME_STATE_TITLE);
        }
        return;
    }
    if (changed)
        screensDrawPause(pauseSelection);
}

static void updateStageClear(const InputState* input)
{
    stateTimer++;
    if ((stateTimer < 30) || !acceptPressed(input))
        return;

    if (session.stageIndex + 1 < STG_STAGE_ORDER_COUNT)
    {
        session.stageIndex++;
        session.currentStage = gStgStageOrder[session.stageIndex];
        gameRequestState(GAME_STATE_STAGE_INTRO);
    }
    else
    {
        gameRequestState(GAME_STATE_ENDING);
    }
}

static void updateContinue(const InputState* input)
{
    u8 previousSeconds;
    u8 seconds;

    previousSeconds = (stateTimer / 60 >= STG_CONTINUE_SECONDS) ? 0 :
        (u8)(STG_CONTINUE_SECONDS - (stateTimer / 60));
    stateTimer++;
    seconds = (stateTimer / 60 >= STG_CONTINUE_SECONDS) ? 0 :
        (u8)(STG_CONTINUE_SECONDS - (stateTimer / 60));

    if ((input->pressed & BUTTON_A) && (session.continuesLeft > 0))
    {
        session.continuesLeft--;
        session.lives = PLAYER_INITIAL_LIVES;
        session.speedLevel = SPEED_LEVEL_MIN;
        session.bombs = BOMB_INITIAL_STOCK;
        gameRequestState(GAME_STATE_STAGE_INTRO);
        return;
    }
    if ((input->pressed & BUTTON_B) || (seconds == 0))
    {
        gameRequestState(GAME_STATE_GAME_OVER);
        return;
    }
    if (seconds != previousSeconds)
        screensDrawContinue(seconds, session.continuesLeft);
}

static void updateGameOver(const InputState* input)
{
    stateTimer++;
    if ((stateTimer >= GAME_OVER_DISPLAY_FRAMES) || acceptPressed(input))
        beginScoreRegistration();
}

static void commitNameEntry(void)
{
    saveInsertScore(session.difficulty, session.score, session.stageIndex + 1, nameEntry);
    gameRequestState(GAME_STATE_TITLE);
}

static void updateNameEntry(const InputState* input)
{
    const u8 alphabetCount = (u8)(sizeof(nameAlphabet) - 1);
    bool changed = FALSE;

    if (input->pressed & BUTTON_UP)
    {
        nameEntryIndexes[nameEntryCursor] = wrapSelection(nameEntryIndexes[nameEntryCursor], 1, alphabetCount);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_DOWN)
    {
        nameEntryIndexes[nameEntryCursor] = wrapSelection(nameEntryIndexes[nameEntryCursor], -1, alphabetCount);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_LEFT)
    {
        nameEntryCursor = wrapSelection(nameEntryCursor, -1, STG_NAME_ENTRY_LENGTH);
        changed = TRUE;
    }
    if (input->pressed & BUTTON_RIGHT)
    {
        nameEntryCursor = wrapSelection(nameEntryCursor, 1, STG_NAME_ENTRY_LENGTH);
        changed = TRUE;
    }

    nameEntry[nameEntryCursor] = nameAlphabet[nameEntryIndexes[nameEntryCursor]];

    if (input->pressed & BUTTON_A)
    {
        if (nameEntryCursor + 1 >= STG_NAME_ENTRY_LENGTH)
        {
            commitNameEntry();
            return;
        }
        nameEntryCursor++;
        changed = TRUE;
    }
    if (input->pressed & BUTTON_B)
    {
        if (nameEntryCursor > 0)
            nameEntryCursor--;
        changed = TRUE;
    }
    if (input->pressed & BUTTON_START)
    {
        commitNameEntry();
        return;
    }

    if (changed)
        screensDrawNameEntry(nameEntry, nameEntryCursor, session.score);
}

static void updateEnding(const InputState* input)
{
    if (!acceptPressed(input))
        return;

    storyPage++;
    if (storyPage >= STG_ENDING_LINE_COUNT)
        gameRequestState(GAME_STATE_STAFF_ROLL);
    else
        screensDrawEnding(storyPage);
}

static void updateStaffRoll(const InputState* input)
{
    stateTimer++;
    if ((stateTimer % 60) == 0)
        screensDrawStaffRoll(stateTimer);
    if ((stateTimer >= STG_STAFF_ROLL_FRAMES) || acceptPressed(input))
        beginScoreRegistration();
}

void gameUpdate(void)
{
    const InputState* input;

    inputSample();
    input = inputGetPlayer1();

    switch (currentState)
    {
        case GAME_STATE_TITLE:
            updateTitle(input);
            break;
        case GAME_STATE_MAIN_MENU:
            updateMainMenu(input);
            break;
        case GAME_STATE_OPTIONS:
            updateOptions(input);
            break;
        case GAME_STATE_HIGH_SCORES:
            updateHighScores(input);
            break;
        case GAME_STATE_SOUND_TEST:
            updateSoundTest(input);
            break;
        case GAME_STATE_HOW_TO:
            updateHowTo(input);
            break;
        case GAME_STATE_OPENING:
            updateOpening(input);
            break;
        case GAME_STATE_STAGE_INTRO:
            updateStageIntro(input);
            break;
        case GAME_STATE_PLAY:
            updatePlay(input);
            break;
        case GAME_STATE_PAUSE:
            updatePause(input);
            break;
        case GAME_STATE_STAGE_CLEAR:
            updateStageClear(input);
            break;
        case GAME_STATE_CONTINUE:
            updateContinue(input);
            break;
        case GAME_STATE_GAME_OVER:
            updateGameOver(input);
            break;
        case GAME_STATE_NAME_ENTRY:
            updateNameEntry(input);
            break;
        case GAME_STATE_ENDING:
            updateEnding(input);
            break;
        case GAME_STATE_STAFF_ROLL:
            updateStaffRoll(input);
            break;
        case GAME_STATE_BOOT:
        case GAME_STATE_STAGE_LOAD:
        default:
            break;
    }
    applyRequestedState();
}

void gameRequestState(GameState next)
{
    requestedState = next;
    hasStateRequest = TRUE;
}

GameState gameGetState(void)
{
    return currentState;
}

GameSession* gameGetSession(void)
{
    return &session;
}

void gameAddScore(u32 value)
{
    session.score += value;

    while ((session.nextExtendIndex < STG_EXTEND_COUNT) &&
           (session.score >= gStgExtendScores[session.nextExtendIndex]))
    {
        if (session.lives < 9)
            session.lives++;
        session.nextExtendIndex++;
        hudSetLives(session.lives);
    }

    hudSetScore(session.score);
}

u8 gameConsumeLife(void)
{
    stageNoMiss = FALSE;

    if (session.lives > 0)
        session.lives--;

    if (session.weaponLevel > WEAPON_LEVEL_MIN)
        session.weaponLevel--;
    chargeReset();
    abyssCoreLose();

    session.speedLevel = SPEED_LEVEL_MIN;
    if (session.bombs < 1)
        session.bombs = 1;

    recoveryOnPlayerDeath();

    hudSetLives(session.lives);
    hudSetWeapon(session.weaponColor, session.weaponLevel);
    hudSetSpeed(session.speedLevel);
    hudSetBombs(session.bombs);
    return session.lives;
}

u8 gameGetLives(void)
{
    return session.lives;
}

u8 gameGetSpeedLevel(void)
{
    return session.speedLevel;
}

bool gameAddSpeedLevel(void)
{
    if (session.speedLevel >= SPEED_LEVEL_MAX)
        return FALSE;

    session.speedLevel++;
    hudSetSpeed(session.speedLevel);
    return TRUE;
}

u8 gameGetBombs(void)
{
    return session.bombs;
}

bool gameAddBomb(void)
{
    if (session.bombs >= BOMB_MAX_STOCK)
        return FALSE;

    session.bombs++;
    hudSetBombs(session.bombs);
    return TRUE;
}

bool gameUseBomb(void)
{
    if (session.bombs == 0)
        return FALSE;

    session.bombs--;
    hudSetBombs(session.bombs);
    return TRUE;
}

s16 gameScaleEnemyBulletSpeed(s16 speed256)
{
    u16 percent;

    if (session.difficulty == STG_DIFFICULTY_EASY)
        percent = STG_EASY_BULLET_SPEED_PERCENT;
    else if (session.difficulty == STG_DIFFICULTY_HARD)
        percent = STG_HARD_BULLET_SPEED_PERCENT;
    else
        percent = STG_NORMAL_BULLET_SPEED_PERCENT;

    return (s16)(((s32)speed256 * percent) / 100);
}

u8 gameGetEnemyShotCount(u32 sequence)
{
    if (session.difficulty == STG_DIFFICULTY_EASY)
        return ((sequence % 5) == 0) ? 0 : 1;
    if (session.difficulty == STG_DIFFICULTY_HARD)
        return ((sequence % 5) == 0) ? 2 : 1;
    return 1;
}