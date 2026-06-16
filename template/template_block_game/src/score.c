/* ===================================================================
 * GERO Block - スコアとハイスコア保存
 * =================================================================== */

#include "game.h"

#define BLOCK_SRAM_CONTROL_PTR ((volatile u8 *)0xA130F1)
#define BLOCK_SRAM_BASE_PTR    ((volatile u8 *)0x200001)
#define SRAM_MAGIC         0x47424853UL  /* GBHS */
#define SRAM_VERSION       4
#define SRAM_OFFSET_MAGIC  0
#define SRAM_OFFSET_VER    4
#define SRAM_OFFSET_SCORE  8
#define SRAM_OFFSET_STAGE  (SRAM_OFFSET_SCORE + HIGH_SCORE_COUNT * 4)
#define SRAM_OFFSET_NAME   (SRAM_OFFSET_STAGE + HIGH_SCORE_COUNT)
#define SRAM_OFFSET_SUM    (SRAM_OFFSET_NAME + HIGH_SCORE_COUNT * 3)

static u32 high_scores[HIGH_SCORE_COUNT];
static u8 high_score_stages[HIGH_SCORE_COUNT];
static char high_score_names[HIGH_SCORE_COUNT][4];

static void sramEnable(void)
{
    *BLOCK_SRAM_CONTROL_PTR = 1;
}

static void sramDisable(void)
{
    *BLOCK_SRAM_CONTROL_PTR = 0;
}

static u8 sramRead8(u16 offset)
{
    return BLOCK_SRAM_BASE_PTR[(u32)offset * 2];
}

static void sramWrite8(u16 offset, u8 value)
{
    BLOCK_SRAM_BASE_PTR[(u32)offset * 2] = value;
}

static u32 sramRead32(u16 offset)
{
    return ((u32)sramRead8(offset) << 24)
        | ((u32)sramRead8(offset + 1) << 16)
        | ((u32)sramRead8(offset + 2) << 8)
        | (u32)sramRead8(offset + 3);
}

static void sramWrite32(u16 offset, u32 value)
{
    sramWrite8(offset, (u8)(value >> 24));
    sramWrite8(offset + 1, (u8)(value >> 16));
    sramWrite8(offset + 2, (u8)(value >> 8));
    sramWrite8(offset + 3, (u8)value);
}

static u32 checksumScores(void)
{
    u32 sum = SRAM_MAGIC ^ SRAM_VERSION;
    for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
    {
        sum ^= high_scores[i] + ((u32)i * 0x45D9F3BU);
        sum ^= ((u32)high_score_stages[i] << ((i & 3) * 8));
        sum ^= ((u32)high_score_names[i][0] << 16) | ((u32)high_score_names[i][1] << 8) | (u32)high_score_names[i][2];
    }
    return sum;
}

static void clearHighScores(void)
{
    for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
    {
        high_scores[i] = 0;
        high_score_stages[i] = 0;
        high_score_names[i][0] = 'A';
        high_score_names[i][1] = 'A';
        high_score_names[i][2] = 'A';
        high_score_names[i][3] = '\0';
    }
}

static void saveHighScores(void)
{
    sramEnable();
    sramWrite32(SRAM_OFFSET_MAGIC, SRAM_MAGIC);
    sramWrite32(SRAM_OFFSET_VER, SRAM_VERSION);
    for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
    {
        sramWrite32(SRAM_OFFSET_SCORE + i * 4, high_scores[i]);
        sramWrite8(SRAM_OFFSET_STAGE + i, high_score_stages[i]);
        sramWrite8(SRAM_OFFSET_NAME + i * 3 + 0, high_score_names[i][0]);
        sramWrite8(SRAM_OFFSET_NAME + i * 3 + 1, high_score_names[i][1]);
        sramWrite8(SRAM_OFFSET_NAME + i * 3 + 2, high_score_names[i][2]);
    }
    sramWrite32(SRAM_OFFSET_SUM, checksumScores());
    sramDisable();
}

void scoreInit(void)
{
    clearHighScores();
    sramEnable();
    if (sramRead32(SRAM_OFFSET_MAGIC) == SRAM_MAGIC && sramRead32(SRAM_OFFSET_VER) == SRAM_VERSION)
    {
        for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
        {
            high_scores[i] = sramRead32(SRAM_OFFSET_SCORE + i * 4);
            high_score_stages[i] = sramRead8(SRAM_OFFSET_STAGE + i);
            high_score_names[i][0] = sramRead8(SRAM_OFFSET_NAME + i * 3 + 0);
            high_score_names[i][1] = sramRead8(SRAM_OFFSET_NAME + i * 3 + 1);
            high_score_names[i][2] = sramRead8(SRAM_OFFSET_NAME + i * 3 + 2);
            high_score_names[i][3] = '\0';
            for (u8 c = 0; c < 3; c++)
            {
                if (high_score_names[i][c] < 'A' || high_score_names[i][c] > 'Z')
                    high_score_names[i][c] = 'A';
            }
        }
        if (sramRead32(SRAM_OFFSET_SUM) != checksumScores())
        {
            clearHighScores();
        }
    }
    sramDisable();
}

s8 scoreSubmit(u32 value, u8 reached_stage)
{
    if (value == 0) return -1;
    if (reached_stage == 0) reached_stage = 1;

    for (u8 i = 0; i < HIGH_SCORE_COUNT; i++)
    {
        if (value < high_scores[i]) continue;
        if (value == high_scores[i] && reached_stage <= high_score_stages[i]) continue;

        for (s16 j = HIGH_SCORE_COUNT - 1; j > i; j--)
        {
            high_scores[j] = high_scores[j - 1];
            high_score_stages[j] = high_score_stages[j - 1];
            high_score_names[j][0] = high_score_names[j - 1][0];
            high_score_names[j][1] = high_score_names[j - 1][1];
            high_score_names[j][2] = high_score_names[j - 1][2];
            high_score_names[j][3] = '\0';
        }
        high_scores[i] = value;
        high_score_stages[i] = reached_stage;
        high_score_names[i][0] = 'A';
        high_score_names[i][1] = 'A';
        high_score_names[i][2] = 'A';
        high_score_names[i][3] = '\0';
        saveHighScores();
        return (s8)i;
    }
    return -1;
}

void scoreSetHighScoreName(u8 rank, const char *name)
{
    if (rank >= HIGH_SCORE_COUNT || name == NULL) return;
    for (u8 i = 0; i < 3; i++)
    {
        char c = name[i];
        if (c < 'A' || c > 'Z') c = 'A';
        high_score_names[rank][i] = c;
    }
    high_score_names[rank][3] = '\0';
    saveHighScores();
}

const char *scoreGetHighScoreName(u8 rank)
{
    if (rank >= HIGH_SCORE_COUNT) return "---";
    return high_score_names[rank];
}

u32 scoreGetHighScore(u8 rank)
{
    if (rank >= HIGH_SCORE_COUNT) return 0;
    return high_scores[rank];
}

u8 scoreGetHighScoreStage(u8 rank)
{
    if (rank >= HIGH_SCORE_COUNT) return 0;
    return high_score_stages[rank];
}

u32 scoreGetTopScore(void)
{
    return high_scores[0];
}
