/* ===================================================================
 * GERO Block - 繝代Ρ繝ｼ繧｢繝・・邂｡逅・
 * 繧｢繧､繝・Β縺ｮ逕滓・繝ｻ關ｽ荳九・繝代ラ繝ｫ縺ｨ縺ｮ陦晉ｪ√・蜉ｹ譫憺←逕ｨ
 * =================================================================== */

#include "game.h"

/* 繧ｰ繝ｭ繝ｼ繝舌Ν螟画焚螳夂ｾｩ */
PowerUpItem powerup_items[MAX_POWERUP_ITEMS];
PowerUpState powerup_state;

/** 繝代Ρ繝ｼ繧｢繝・・蜉ｹ譫懊・謖∫ｶ壽凾髢難ｼ医ヵ繝ｬ繝ｼ繝・・*/
#define POWERUP_DURATION    (60 * 15)   /* 15遘・@ 60fps */
#define SPEED_UP_BONUS      FIX16(2)
#define BARRIER_DRAW_UNKNOWN 0xFF

static u8 barrier_draw_state = BARRIER_DRAW_UNKNOWN;

/* ===================================================================
 * 蜀・Κ繝倥Ν繝代・
 * =================================================================== */

/** 繝槭Ν繝√・繝ｼ繝ｫ逋ｺ蜍包ｼ・all.c 縺ｫ縺ゅｋ蛻・｣ょ・逅・ｒ蜻ｼ縺ｶ・・*/
extern void ballInit(void);

/**
 * 繝槭Ν繝√・繝ｼ繝ｫ: 譌｢蟄倥・繧｢繧ｯ繝・ぅ繝悶・繝ｼ繝ｫ縺九ｉ2縺､霑ｽ蜉
 */
static void activateMultiBall(void)
{
    Ball *source = NULL;
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (balls[i].active) { source = &balls[i]; break; }
    }
    if (!source) return;

    fix16 speed = BALL_BASE_SPEED;
    if (powerup_state.speed_up)
        speed = speed + SPEED_UP_BONUS;

    u8 spawned = 0;
    for (u8 i = 0; i < MAX_BALLS && spawned < 2; i++)
    {
        if (!balls[i].active)
        {
            balls[i].active = TRUE;
            balls[i].x = source->x;
            balls[i].y = source->y;

            /* 蛻・｣りｧ貞ｺｦ繧貞ｷｦ蜿ｳ縺ｫ縺ｰ繧峨☆ */
            if (spawned == 0)
            {
                balls[i].vx = -speed;
                balls[i].vy = -F16_div(speed, FIX16(2));
            }
            else
            {
                balls[i].vx = speed;
                balls[i].vy = -F16_div(speed, FIX16(2));
            }
            spawned++;
        }
    }
}

/* ===================================================================
 * 繝代ヶ繝ｪ繝・け髢｢謨ｰ
 * =================================================================== */

/** 繝代Ρ繝ｼ繧｢繝・・蜈ｨ菴灘・譛溷喧 */
void powerupInit(void)
{
    powerupClearItems();
    powerupReset();
}

/** Drop items only. Active effects are intentionally preserved. */
void powerupClearItems(void)
{
    for (u8 i = 0; i < MAX_POWERUP_ITEMS; i++)
    {
        powerup_items[i].active = FALSE;
    }
}

/** 繝代Ρ繝ｼ繧｢繝・・蜉ｹ譫懊Μ繧ｻ繝・ヨ */
void powerupReset(void)
{
    powerup_state.barrier = FALSE;
    powerup_state.barrier_timer = 0;
    powerup_state.strong = FALSE;
    powerup_state.strong_timer = 0;
    powerup_state.speed_up = FALSE;
    powerup_state.speed_up_timer = 0;
    barrier_visible = FALSE;
    barrier_draw_state = BARRIER_DRAW_UNKNOWN;
}

/**
 * 繝代Ρ繝ｼ繧｢繝・・繧｢繧､繝・Β繧堤函謌・
 * 繝悶Ο繝・け遐ｴ螢贋ｽ咲ｽｮ縺九ｉ關ｽ荳矩幕蟋・
 */
void powerupSpawn(u8 row, u8 col, u8 type)
{
    if (type == POWERUP_NONE) return;

    /* 遨ｺ縺阪せ繝ｭ繝・ヨ繧呈爾縺・*/
    for (u8 i = 0; i < MAX_POWERUP_ITEMS; i++)
    {
        if (!powerup_items[i].active)
        {
            powerup_items[i].active = TRUE;
            powerup_items[i].type = type;
            /* 繝悶Ο繝・け荳ｭ螟ｮ縺九ｉ繧ｹ繝昴・繝ｳ */
            powerup_items[i].x = FIX16(col * BLOCK_W + BLOCK_W / 2 - POWERUP_ITEM_W / 2);
            powerup_items[i].y = FIX16(BLOCKS_OFFSET_Y * 8 + row * BLOCK_H);
            sndPlaySE(SND_SE_POWERUP_APPEAR);
            return;
        }
    }
}

/** 繝代Ρ繝ｼ繧｢繝・・譖ｴ譁ｰ・郁誠荳具ｼ九ヱ繝峨Ν陦晉ｪ・ｼ九ち繧､繝槭・・・*/
void powerupUpdate(void)
{
    /* --- 繧｢繧､繝・Β關ｽ荳句・逅・--- */
    for (u8 i = 0; i < MAX_POWERUP_ITEMS; i++)
    {
        if (!powerup_items[i].active) continue;

        powerup_items[i].y += POWERUP_FALL_SPEED;
        s16 iy = F16_toInt(powerup_items[i].y);

        /* 逕ｻ髱｢螟悶↓關ｽ縺｡縺溘ｉ豸域ｻ・*/
        if (iy > PLAY_FIELD_H)
        {
            powerup_items[i].active = FALSE;
            continue;
        }

        /* 繝代ラ繝ｫ縺ｨ縺ｮ陦晉ｪ√メ繧ｧ繝・け */
        s16 ix = F16_toInt(powerup_items[i].x);
        for (u8 p = 0; p < num_players; p++)
        {
            if (!paddles[p].active) continue;
            s16 px = F16_toInt(paddles[p].x);
            s16 py = paddles[p].y;

            if (ix + POWERUP_ITEM_W > px && ix < px + PADDLE_W &&
                iy + POWERUP_ITEM_H > py && iy < py + PADDLE_H)
            {
                /* 繝代Ρ繝ｼ繧｢繝・・蜿門ｾ・*/
                powerupActivate(powerup_items[i].type);
                powerup_items[i].active = FALSE;
                sndPlaySE(SND_SE_POWERUP_GET);
                score += 50;
                break;
            }
        }
    }

    /* --- 繧ｿ繧､繝槭・譖ｴ譁ｰ --- */
    if (powerup_state.barrier && powerup_state.barrier_timer > 0)
    {
        powerup_state.barrier_timer--;
        if (powerup_state.barrier_timer == 0)
        {
            powerup_state.barrier = FALSE;
            barrier_visible = FALSE;
        }
    }

    /* Strong and speed-up last until the player loses a life. */
}

/** 繝代Ρ繝ｼ繧｢繝・・蜉ｹ譫懊ｒ逋ｺ蜍・*/
void powerupActivate(u8 type)
{
    switch (type)
    {
        case POWERUP_MULTI_BALL:
            activateMultiBall();
            break;

        case POWERUP_STRONG:
            powerup_state.strong = TRUE;
            powerup_state.strong_timer = 0;
            break;

        case POWERUP_SPEED_UP:
            powerup_state.speed_up = TRUE;
            powerup_state.speed_up_timer = 0;
            break;

        case POWERUP_BARRIER:
            powerup_state.barrier = TRUE;
            powerup_state.barrier_timer = POWERUP_DURATION;
            barrier_visible = TRUE;
            break;
    }
}

/** 繝代Ρ繝ｼ繧｢繝・・繧｢繧､繝・Β謠冗判・医ワ繝ｼ繝峨え繧ｧ繧｢繧ｹ繝励Λ繧､繝郁ｨｭ螳夲ｼ・*/
void powerupDraw(void)
{
    for (u8 i = 0; i < MAX_POWERUP_ITEMS; i++)
    {
        u8 spr_idx = SPR_POWERUP_START + i;

        if (powerup_items[i].active)
        {
            /* 繧ｿ繧､繝励↓蠢懊§縺溘ち繧､繝ｫ繧､繝ｳ繝・ャ繧ｯ繧ｹ */
            u16 pu_tile = TILE_POWERUP_IDX + (powerup_items[i].type - 1) * TILES_PER_POWERUP;
            VDP_setSpriteFull(
                spr_idx,
                F16_toInt(powerup_items[i].x),
                F16_toInt(powerup_items[i].y),
                SPRITE_SIZE(2, 1),
                TILE_ATTR_FULL(PAL_SPRITES, TRUE, FALSE, FALSE, pu_tile),
                spr_idx + 1
            );
        }
        else
        {
            VDP_setSpriteFull(spr_idx, -128, -128, SPRITE_SIZE(1, 1), 0, spr_idx + 1);
        }
    }

    if (barrier_draw_state != (u8)barrier_visible)
    {
        u16 tile_y = (PLAY_FIELD_H / 8) - 1;  /* 譛荳玖｡・*/
        if (barrier_visible)
        {
            for (u8 tx = 0; tx < 32; tx++)
            {
                VDP_setTileMapXY(
                    BG_A,
                    TILE_ATTR_FULL(PAL_SPRITES, TRUE, FALSE, FALSE, TILE_BARRIER_IDX),
                    tx, tile_y
                );
            }
        }
        else
        {
            for (u8 tx = 0; tx < 32; tx++)
            {
                VDP_setTileMapXY(BG_A, 0, tx, tile_y);
            }
        }
        barrier_draw_state = (u8)barrier_visible;
    }

    VDP_setSpriteFull(SPR_BARRIER, -128, -128, SPRITE_SIZE(1, 1), 0, 0);
}
