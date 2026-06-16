/* ===================================================================
 * GERO Block - 繝代ラ繝ｫ蛻ｶ蠕｡
 * =================================================================== */

#include "game.h"
#include "game_resources.h"

/* 繧ｰ繝ｭ繝ｼ繝舌Ν螟画焚螳夂ｾｩ */
Paddle paddles[MAX_PLAYERS];

#define PADDLE_FAST_BUTTONS (BUTTON_A | BUTTON_B | BUTTON_C)

/* ===================================================================
 * 蛻晄悄蛹・
 * =================================================================== */

void playerInit(void)
{
    /* Player 1: 荳ｭ螟ｮ驟咲ｽｮ */
    paddles[0].x = FIX16((PLAY_FIELD_W - PADDLE_W) / 2);
    paddles[0].y = PADDLE_Y_POS;
    paddles[0].active = TRUE;

    /* Player 2: 髱槭い繧ｯ繝・ぅ繝厄ｼ・P譎ゅ↓譛牙柑蛹厄ｼ・*/
    paddles[1].x = FIX16((PLAY_FIELD_W - PADDLE_W) / 2);
    paddles[1].y = PADDLE_Y_POS;
    paddles[1].active = (num_players >= 2);
}

/* ===================================================================
 * 譖ｴ譁ｰ
 * =================================================================== */

void playerUpdate(u16 joy1, u16 joy2)
{
    /* --- Player 1 --- */
    if (paddles[0].active)
    {
        fix16 speed = (joy1 & PADDLE_FAST_BUTTONS) ? (PADDLE_SPEED * 2) : PADDLE_SPEED;

        if (joy1 & BUTTON_LEFT)
            paddles[0].x -= speed;
        if (joy1 & BUTTON_RIGHT)
            paddles[0].x += speed;

        /* 逕ｻ髱｢遶ｯ繧ｯ繝ｩ繝ｳ繝・*/
        if (paddles[0].x < FIX16(0))
            paddles[0].x = FIX16(0);
        if (paddles[0].x > FIX16(PLAY_FIELD_W - PADDLE_W))
            paddles[0].x = FIX16(PLAY_FIELD_W - PADDLE_W);
    }

    /* --- Player 2 --- */
    if (paddles[1].active && num_players >= 2)
    {
        fix16 speed = (joy2 & PADDLE_FAST_BUTTONS) ? (PADDLE_SPEED * 2) : PADDLE_SPEED;

        if (joy2 & BUTTON_LEFT)
            paddles[1].x -= speed;
        if (joy2 & BUTTON_RIGHT)
            paddles[1].x += speed;

        /* 逕ｻ髱｢遶ｯ繧ｯ繝ｩ繝ｳ繝・*/
        if (paddles[1].x < FIX16(0))
            paddles[1].x = FIX16(0);
        if (paddles[1].x > FIX16(PLAY_FIELD_W - PADDLE_W))
            paddles[1].x = FIX16(PLAY_FIELD_W - PADDLE_W);
    }
}

/* ===================================================================
 * 謠冗判・医ワ繝ｼ繝峨え繧ｧ繧｢繧ｹ繝励Λ繧､繝郁ｨｭ螳夲ｼ・
 * =================================================================== */

void playerDraw(void)
{
    for (u8 p = 0; p < MAX_PLAYERS; p++)
    {
        u8 spr_idx = SPR_PADDLE_START + p;

        if (paddles[p].active)
        {
            VDP_setSpriteFull(
                spr_idx,
                F16_toInt(paddles[p].x),
                paddles[p].y,
                SPRITE_SIZE(4, 1),
                TILE_ATTR_FULL(PAL_SPRITES, TRUE, FALSE, FALSE, TILE_PADDLE_IDX),
                spr_idx + 1
            );
        }
        else
        {
            /* 髱櫁｡ｨ遉ｺ: 逕ｻ髱｢螟悶↓驟咲ｽｮ */
            VDP_setSpriteFull(spr_idx, -128, -128, SPRITE_SIZE(1, 1), 0, spr_idx + 1);
        }
    }
}
