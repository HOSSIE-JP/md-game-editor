#include <genesis.h>
#include "system/save.h"

#define SAVE_MAGIC 0x474E4153UL
#define SAVE_VERSION 1
#define SAVE_OFFSET_MAGIC 0
#define SAVE_OFFSET_VERSION 4
#define SAVE_OFFSET_OPTIONS 5
#define SAVE_OFFSET_SCORES 10
#define SAVE_ENTRY_SIZE (5 + STG_NAME_ENTRY_LENGTH)
#define SAVE_OFFSET_CHECKSUM (SAVE_OFFSET_SCORES + (STG_DIFFICULTY_COUNT * STG_HIGHSCORE_ROWS * SAVE_ENTRY_SIZE))

static StgOptions options;
static StgHighScore scores[STG_DIFFICULTY_COUNT][STG_HIGHSCORE_ROWS];

static u32 entryOffset(u8 difficulty, u8 row)
{
    return SAVE_OFFSET_SCORES + (((u32)difficulty * STG_HIGHSCORE_ROWS + row) * SAVE_ENTRY_SIZE);
}

static u32 mixChecksum(u32 checksum, u8 value)
{
    return (checksum ^ value) * 16777619UL;
}

static u32 checksumData(void)
{
    u32 checksum = 2166136261UL;
    u8 d;
    u8 row;
    u8 i;

    checksum = mixChecksum(checksum, options.difficulty);
    checksum = mixChecksum(checksum, options.soundEnabled);
    checksum = mixChecksum(checksum, options.shotButton);
    checksum = mixChecksum(checksum, options.coreButton);
    checksum = mixChecksum(checksum, options.bombButton);

    for (d = 0; d < STG_DIFFICULTY_COUNT; d++)
    {
        for (row = 0; row < STG_HIGHSCORE_ROWS; row++)
        {
            const StgHighScore* entry = &scores[d][row];
            checksum = mixChecksum(checksum, (u8)(entry->score >> 24));
            checksum = mixChecksum(checksum, (u8)(entry->score >> 16));
            checksum = mixChecksum(checksum, (u8)(entry->score >> 8));
            checksum = mixChecksum(checksum, (u8)entry->score);
            checksum = mixChecksum(checksum, entry->stage);
            for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
                checksum = mixChecksum(checksum, (u8)entry->name[i]);
        }
    }
    return checksum;
}

static void resetData(void)
{
    u8 d;
    u8 row;
    u8 i;

    options.difficulty = STG_DEFAULT_DIFFICULTY;
    options.soundEnabled = TRUE;
    options.shotButton = 0;
    options.coreButton = 1;
    options.bombButton = 2;

    for (d = 0; d < STG_DIFFICULTY_COUNT; d++)
    {
        for (row = 0; row < STG_HIGHSCORE_ROWS; row++)
        {
            scores[d][row].score = 0;
            scores[d][row].stage = 0;
            for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
                scores[d][row].name[i] = '-';
        }
    }
}

static void writeAll(void)
{
    u8 d;
    u8 row;
    u8 i;

    SRAM_enable();
    SRAM_writeLong(SAVE_OFFSET_MAGIC, SAVE_MAGIC);
    SRAM_writeByte(SAVE_OFFSET_VERSION, SAVE_VERSION);
    SRAM_writeByte(SAVE_OFFSET_OPTIONS + 0, options.difficulty);
    SRAM_writeByte(SAVE_OFFSET_OPTIONS + 1, options.soundEnabled);
    SRAM_writeByte(SAVE_OFFSET_OPTIONS + 2, options.shotButton);
    SRAM_writeByte(SAVE_OFFSET_OPTIONS + 3, options.coreButton);
    SRAM_writeByte(SAVE_OFFSET_OPTIONS + 4, options.bombButton);

    for (d = 0; d < STG_DIFFICULTY_COUNT; d++)
    {
        for (row = 0; row < STG_HIGHSCORE_ROWS; row++)
        {
            const u32 offset = entryOffset(d, row);
            SRAM_writeLong(offset, scores[d][row].score);
            SRAM_writeByte(offset + 4, scores[d][row].stage);
            for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
                SRAM_writeByte(offset + 5 + i, (u8)scores[d][row].name[i]);
        }
    }
    SRAM_writeLong(SAVE_OFFSET_CHECKSUM, checksumData());
    SRAM_disable();
}

static bool validButtonOptions(void)
{
    if ((options.shotButton > 2) || (options.coreButton > 2) || (options.bombButton > 2))
        return FALSE;
    return (options.shotButton != options.coreButton) &&
           (options.shotButton != options.bombButton) &&
           (options.coreButton != options.bombButton);
}

void saveInit(void)
{
    u32 storedChecksum;
    u8 d;
    u8 row;
    u8 i;
    bool valid;

    resetData();
    SRAM_enableRO();
    valid = (SRAM_readLong(SAVE_OFFSET_MAGIC) == SAVE_MAGIC) &&
            (SRAM_readByte(SAVE_OFFSET_VERSION) == SAVE_VERSION);
    if (valid)
    {
        options.difficulty = SRAM_readByte(SAVE_OFFSET_OPTIONS + 0);
        options.soundEnabled = SRAM_readByte(SAVE_OFFSET_OPTIONS + 1) != 0;
        options.shotButton = SRAM_readByte(SAVE_OFFSET_OPTIONS + 2);
        options.coreButton = SRAM_readByte(SAVE_OFFSET_OPTIONS + 3);
        options.bombButton = SRAM_readByte(SAVE_OFFSET_OPTIONS + 4);
        for (d = 0; d < STG_DIFFICULTY_COUNT; d++)
        {
            for (row = 0; row < STG_HIGHSCORE_ROWS; row++)
            {
                const u32 offset = entryOffset(d, row);
                scores[d][row].score = SRAM_readLong(offset);
                scores[d][row].stage = SRAM_readByte(offset + 4);
                for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
                    scores[d][row].name[i] = (char)SRAM_readByte(offset + 5 + i);
            }
        }
        storedChecksum = SRAM_readLong(SAVE_OFFSET_CHECKSUM);
        valid = (storedChecksum == checksumData()) &&
                (options.difficulty < STG_DIFFICULTY_COUNT) &&
                validButtonOptions();
    }
    SRAM_disable();

    if (!valid)
    {
        resetData();
        writeAll();
    }
}

const StgOptions* saveGetOptions(void)
{
    return &options;
}

void saveSetOptions(const StgOptions* value)
{
    if (value == NULL)
        return;
    options = *value;
    if (options.difficulty >= STG_DIFFICULTY_COUNT)
        options.difficulty = STG_DIFFICULTY_NORMAL;
    if (!validButtonOptions())
    {
        options.shotButton = 0;
        options.coreButton = 1;
        options.bombButton = 2;
    }
    writeAll();
}

const StgHighScore* saveGetHighScores(u8 difficulty)
{
    if (difficulty >= STG_DIFFICULTY_COUNT)
        difficulty = STG_DIFFICULTY_NORMAL;
    return scores[difficulty];
}

s8 saveRankForScore(u8 difficulty, u32 score)
{
    u8 row;
    if (difficulty >= STG_DIFFICULTY_COUNT)
        return -1;
    for (row = 0; row < STG_HIGHSCORE_ROWS; row++)
    {
        if (score > scores[difficulty][row].score)
            return (s8)row;
    }
    return -1;
}

s8 saveInsertScore(u8 difficulty, u32 score, u8 stage, const char* name)
{
    const s8 rank = saveRankForScore(difficulty, score);
    u8 row;
    u8 insertRank;
    u8 i;
    if (rank < 0)
        return -1;
    insertRank = (u8)rank;
    for (row = STG_HIGHSCORE_ROWS - 1; row > insertRank; row--)
        scores[difficulty][row] = scores[difficulty][row - 1];
    scores[difficulty][insertRank].score = score;
    scores[difficulty][insertRank].stage = stage;
    for (i = 0; i < STG_NAME_ENTRY_LENGTH; i++)
        scores[difficulty][insertRank].name[i] = (name && name[i]) ? name[i] : '-';
    writeAll();
    return rank;
}
