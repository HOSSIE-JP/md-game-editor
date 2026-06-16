/* ===================================================================
 * GERO Block - ブロック管理
 * BG_A プレーンにブロックタイルを描画・消去する
 * =================================================================== */

#include "game.h"
#include "stages.h"

/* グローバル変数定義 */
u8 block_hp[GRID_ROWS][GRID_COLS];
u8 block_powerup[GRID_ROWS][GRID_COLS];

/** ブロック種類記憶（ダメージ表示用） */
static u8 block_type_grid[GRID_ROWS][GRID_COLS];
/** 破壊可能ブロック残数 */
static u16 breakable_count;

/* ===================================================================
 * 内部ヘルパー
 * =================================================================== */

/**
 * 1ブロック分のBG_Aタイルを描画
 * block_type: BLOCK_WHITE〜BLOCK_GRAY (1-5)
 */
static u8 visibleBlockType(u8 block_type, u8 hp)
{
    if (block_type == BLOCK_BLUE)
    {
        if (hp >= 3) return BLOCK_BLUE;
        if (hp == 2) return BLOCK_GREEN;
        return BLOCK_WHITE;
    }
    if (block_type == BLOCK_GREEN)
    {
        return hp >= 2 ? BLOCK_GREEN : BLOCK_WHITE;
    }
    return block_type;
}

static void drawBlockTile(u8 row, u8 col, u8 block_type)
{
    if (block_type == BLOCK_EMPTY) return;

    u16 base_tile = TILE_BLOCK_START + (block_type - 1) * TILES_PER_BLOCK;
    u16 tile_x = col * BLOCK_TILE_W;
    u16 tile_y = BLOCKS_OFFSET_Y + row * BLOCK_TILE_H;

    /* 2×1 タイルを配置 */
    for (u8 ty = 0; ty < BLOCK_TILE_H; ty++)
    {
        for (u8 tx = 0; tx < BLOCK_TILE_W; tx++)
        {
            u16 tile_idx = base_tile + ty * BLOCK_TILE_W + tx;
            VDP_setTileMapXY(
                BG_A,
                TILE_ATTR_FULL(PAL_BLOCKS, TRUE, FALSE, FALSE, tile_idx),
                tile_x + tx,
                tile_y + ty
            );
        }
    }
}

/**
 * 1ブロック分のBG_Aタイルを消去（透明にする）
 * → BG_Bの背景が透けて見えるようになる
 */
static void clearBlockTile(u8 row, u8 col)
{
    u16 tile_x = col * BLOCK_TILE_W;
    u16 tile_y = BLOCKS_OFFSET_Y + row * BLOCK_TILE_H;

    for (u8 ty = 0; ty < BLOCK_TILE_H; ty++)
    {
        for (u8 tx = 0; tx < BLOCK_TILE_W; tx++)
        {
            VDP_setTileMapXY(BG_A, 0, tile_x + tx, tile_y + ty);
        }
    }
}

/* ===================================================================
 * パブリック関数
 * =================================================================== */

/** ブロック管理初期化 */
void blockInit(void)
{
    memset(block_hp, 0, sizeof(block_hp));
    memset(block_powerup, 0, sizeof(block_powerup));
    memset(block_type_grid, 0, sizeof(block_type_grid));
    breakable_count = 0;
}

/** ステージデータをロード */
void blockLoadStage(u8 stage_idx)
{
    if (stage_idx >= STAGE_COUNT)
    {
        KDebug_Alert("blockLoadStage: stage_idx out of range!");
        return;
    }

    const StageInfo *info = &stage_table[stage_idx];

    if (info->blocks == NULL)
    {
        KDebug_Alert("blockLoadStage: blocks pointer is NULL!");
        return;
    }

    blockInit();

    /* ブロック配置 + 耐久値設定 */
    for (u8 row = 0; row < GRID_ROWS; row++)
    {
        for (u8 col = 0; col < GRID_COLS; col++)
        {
            u8 type = info->blocks[row][col];
            if (type >= BLOCK_TYPE_COUNT) type = BLOCK_EMPTY;
            block_type_grid[row][col] = type;

            if (type == BLOCK_EMPTY)
            {
                block_hp[row][col] = 0;
            }
            else if (type == BLOCK_GRAY)
            {
                /* 破壊不可: 便宜上 HP=255 */
                block_hp[row][col] = 255;
            }
            else
            {
                block_hp[row][col] = block_base_hp[type];
                breakable_count++;
            }

            /* パワーアップ */
            if (info->powerups != NULL)
            {
                block_powerup[row][col] = info->powerups[row][col];
            }
        }
    }

    /* デバッグ: 破壊可能ブロック数をログに出力 */
    {
        char buf[48];
        sprintf(buf, "blockLoadStage(%d): breakable=%d", stage_idx, breakable_count);
        KDebug_Alert(buf);
        if (breakable_count == 0)
        {
            KDebug_Alert("WARNING: No breakable blocks! Stage will clear immediately.");
        }
    }
}

/** 全ブロックをBG_Aに描画 */
void blockDrawAll(void)
{
    /* まずBG_Aのブロックエリアをクリア */
    for (u8 row = 0; row < GRID_ROWS; row++)
    {
        for (u8 col = 0; col < GRID_COLS; col++)
        {
            u8 type = block_type_grid[row][col];
            if (type != BLOCK_EMPTY && block_hp[row][col] > 0)
            {
                drawBlockTile(row, col, visibleBlockType(type, block_hp[row][col]));
            }
            else
            {
                clearBlockTile(row, col);
            }
        }
    }
}

/** ステージクリア判定 */
bool blockCheckClear(void)
{
    return (breakable_count == 0);
}

/**
 * ブロック被弾処理
 * @param row  行
 * @param col  列
 * @param damage ダメージ量
 */
void blockHit(u8 row, u8 col, u8 damage)
{
    if (row >= GRID_ROWS || col >= GRID_COLS) return;

    u8 hp = block_hp[row][col];
    if (hp == 0) return;

    u8 type = block_type_grid[row][col];

    /* 破壊不可ブロック */
    if (type == BLOCK_GRAY)
    {
        sndPlaySE(SND_SE_BLOCK_HIT);
        return;
    }

    /* ダメージ適用 */
    if (damage >= hp)
    {
        /* 破壊 */
        block_hp[row][col] = 0;
        clearBlockTile(row, col);
        breakable_count--;
        score += BLOCK_BREAK_SCORE;
        sndPlaySE(SND_SE_BLOCK_BREAK);

        /* パワーアップアイテムドロップ */
        u8 pu_type = block_powerup[row][col];
        if (pu_type != POWERUP_NONE)
        {
            powerupSpawn(row, col, pu_type);
        }
    }
    else
    {
        /* ダメージのみ（表示変化は残HPで色を若干変更） */
        block_hp[row][col] = hp - damage;
        score += BLOCK_HIT_SCORE;
        sndPlaySE(SND_SE_BLOCK_HIT);
        drawBlockTile(row, col, visibleBlockType(type, block_hp[row][col]));
    }
}
