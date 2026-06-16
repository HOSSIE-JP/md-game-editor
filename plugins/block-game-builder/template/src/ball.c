/* ===================================================================
 * GERO Block - 繝懊・繝ｫ蛻ｶ蠕｡
 * 繝懊・繝ｫ縺ｮ迚ｩ逅・ｼ皮ｮ励∝｣√・繝代ラ繝ｫ繝ｻ繝悶Ο繝・け縺ｨ縺ｮ陦晉ｪ∝愛螳・
 * =================================================================== */

#include "game.h"
#include "game_resources.h"

#if defined(__GNUC__)
#define BLOCK_UNUSED __attribute__((unused))
#else
#define BLOCK_UNUSED
#endif

/* 繧ｰ繝ｭ繝ｼ繝舌Ν螟画焚螳夂ｾｩ */
Ball balls[MAX_BALLS];

/* ===================================================================
 * 蜀・Κ繝倥Ν繝代・
 * =================================================================== */

/** 繧ｰ繝ｪ繝・ラ蠎ｧ讓吶∈縺ｮ螟画鋤 */
static s16 pixelToGridCol(s16 x)
{
    if (x < 0) return -1;
    return x / BLOCK_W;
}

static s16 pixelToGridRow(s16 y)
{
    s16 offset_y = BLOCKS_OFFSET_Y * 8;  /* 繝悶Ο繝・け驟咲ｽｮ髢句ｧ戯繝斐け繧ｻ繝ｫ */
    if (y < offset_y) return -1;
    return (y - offset_y) / BLOCK_H;
}

/** 繝悶Ο繝・け繧ｰ繝ｪ繝・ラ蜀・°繝√ぉ繝・け */
static bool isBlockAt(s16 grid_col, s16 grid_row)
{
    if (grid_col < 0 || grid_col >= GRID_COLS) return FALSE;
    if (grid_row < 0 || grid_row >= GRID_ROWS) return FALSE;
    return (block_hp[grid_row][grid_col] > 0);
}

/** 迴ｾ蝨ｨ縺ｮ繝懊・繝ｫ騾溷ｺｦ繧貞叙蠕・*/
static fix16 getBallSpeed(void)
{
    fix16 speed = BALL_BASE_SPEED;
    if (powerup_state.speed_up)
        speed = speed + FIX16(2);
    return speed;
}

/** 繝悶Ο繝・け陦晉ｪ・ｼ・ム繝｡繝ｼ繧ｸ蜃ｦ逅・*/
static void handleBlockHit(s16 col, s16 row)
{
    u8 damage = powerup_state.strong ? 3 : 1;
    blockHit(row, col, damage);
}

/* ===================================================================
 * X霆ｸ譁ｹ蜷代・繝悶Ο繝・け陦晉ｪ√メ繧ｧ繝・け
 * =================================================================== */

static void checkBlockCollisionX(Ball *b)
{
    s16 bx = F16_toInt(b->x);
    s16 by = F16_toInt(b->y);

    /* 騾ｲ陦梧婿蜷代・蜈育ｫｯX蠎ｧ讓・*/
    s16 check_x = (b->vx > 0) ? (bx + BALL_SIZE - 1) : bx;

    /* 繝懊・繝ｫ縺ｮ荳顔ｫｯ繝ｻ荳ｭ螟ｮ繝ｻ荳狗ｫｯ縺ｧ繝√ぉ繝・け */
    s16 check_points[3] = { by, by + BALL_SIZE / 2, by + BALL_SIZE - 1 };

    for (u8 i = 0; i < 3; i++)
    {
        s16 col = pixelToGridCol(check_x);
        s16 row = pixelToGridRow(check_points[i]);

        if (isBlockAt(col, row))
        {
            handleBlockHit(col, row);
            b->vx = -b->vx;
            /* 繝懊・繝ｫ繧定｡晉ｪ・擇縺ｮ螟悶↓謚ｼ縺怜・縺・*/
            if (b->vx > 0)
                b->x = FIX16(col * BLOCK_W + BLOCK_W);
            else
                b->x = FIX16(col * BLOCK_W - BALL_SIZE);
            return;
        }
    }
}

/* ===================================================================
 * Y霆ｸ譁ｹ蜷代・繝悶Ο繝・け陦晉ｪ√メ繧ｧ繝・け
 * =================================================================== */

static void checkBlockCollisionY(Ball *b)
{
    s16 bx = F16_toInt(b->x);
    s16 by = F16_toInt(b->y);

    /* 騾ｲ陦梧婿蜷代・蜈育ｫｯY蠎ｧ讓・*/
    s16 check_y = (b->vy > 0) ? (by + BALL_SIZE - 1) : by;

    /* 繝懊・繝ｫ縺ｮ蟾ｦ遶ｯ繝ｻ荳ｭ螟ｮ繝ｻ蜿ｳ遶ｯ縺ｧ繝√ぉ繝・け */
    s16 check_points[3] = { bx, bx + BALL_SIZE / 2, bx + BALL_SIZE - 1 };

    for (u8 i = 0; i < 3; i++)
    {
        s16 col = pixelToGridCol(check_points[i]);
        s16 row = pixelToGridRow(check_y);

        if (isBlockAt(col, row))
        {
            handleBlockHit(col, row);
            b->vy = -b->vy;
            /* 繝懊・繝ｫ繧定｡晉ｪ・擇縺ｮ螟悶↓謚ｼ縺怜・縺・*/
            s16 block_top = BLOCKS_OFFSET_Y * 8 + row * BLOCK_H;
            if (b->vy > 0)
                b->y = FIX16(block_top + BLOCK_H);
            else
                b->y = FIX16(block_top - BALL_SIZE);
            return;
        }
    }
}

/* ===================================================================
 * 繝代ラ繝ｫ陦晉ｪ√メ繧ｧ繝・け
 * =================================================================== */

static void checkPaddleCollision(Ball *b)
{
    /* 荳区婿蜷代↓遘ｻ蜍穂ｸｭ縺ｧ縺ｪ縺代ｌ縺ｰ繧ｹ繧ｭ繝・・ */
    if (b->vy <= 0) return;

    s16 bx = F16_toInt(b->x);
    s16 by = F16_toInt(b->y);
    fix16 ball_bottom = b->y + FIX16(BALL_SIZE);

    for (u8 p = 0; p < num_players; p++)
    {
        if (!paddles[p].active) continue;

        s16 px = F16_toInt(paddles[p].x);
        s16 py = paddles[p].y;

        /* AABB蛻､螳・*/
        if (bx + BALL_SIZE <= px) continue;
        if (bx >= px + PADDLE_W) continue;
        if (F16_toInt(ball_bottom) <= py) continue;
        if (by >= py + PADDLE_H) continue;

        /* 繝偵ャ繝井ｽ咲ｽｮ ( -1.0 .. +1.0 ) */
        fix16 ball_cx = b->x + FIX16(BALL_SIZE / 2);
        fix16 paddle_cx = paddles[p].x + FIX16(PADDLE_W / 2);
        fix16 offset = ball_cx - paddle_cx;
        fix16 half_w = FIX16(PADDLE_W / 2);

        /* 豈皮紫繧定ｨ育ｮ暦ｼ・1..1縺ｫ繧ｯ繝ｩ繝ｳ繝暦ｼ・*/
        fix16 ratio = F16_div(offset, half_w);
        if (ratio < FIX16(-1)) ratio = FIX16(-1);
        if (ratio > FIX16(1))  ratio = FIX16(1);

        fix16 speed = getBallSpeed();

        /* VX: 繝偵ャ繝井ｽ咲ｽｮ縺ｫ蠢懊§縺ｦ隗貞ｺｦ螟画峩 (譛螟ｧ80%縺ｮX繧ｳ繝ｳ繝昴・繝阪Φ繝・ */
        b->vx = F16_mul(speed, F16_mul(ratio, FIX16(0.8)));

        /* VY: 蟶ｸ縺ｫ荳頑婿蜷代・溷ｺｦ繧堤ｶｭ謖・*/
        fix16 abs_vx = (b->vx < 0) ? -b->vx : b->vx;
        b->vy = -(speed - F16_div(abs_vx, FIX16(3)));

        /* 譛菴朱剞縺ｮ荳頑婿蜷鷹溷ｺｦ繧剃ｿ晁ｨｼ */
        if (b->vy > -FIX16(1))
            b->vy = -FIX16(1);

        /* 繝代ラ繝ｫ縺ｮ荳翫↓謚ｼ縺怜・縺・*/
        b->y = FIX16(py - BALL_SIZE);
        sndPlaySE(SND_SE_BALL_HIT_PADDLE);
        return;
    }
}

/* ===================================================================
 * 繝代ヶ繝ｪ繝・け髢｢謨ｰ
 * =================================================================== */

/** 繝懊・繝ｫ蛻晄悄蛹・*/
void ballInit(void)
{
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        balls[i].active = FALSE;
        balls[i].x = FIX16(0);
        balls[i].y = FIX16(0);
        balls[i].vx = FIX16(0);
        balls[i].vy = FIX16(0);
    }
}

/** 繧ｵ繝ｼ繝・ 繝代ラ繝ｫ荳翫°繧峨・繝ｼ繝ｫ繧堤匱蟆・*/
void ballServe(u8 paddle_idx)
{
    if (paddle_idx >= MAX_PLAYERS) return;

    /* 遨ｺ縺阪せ繝ｭ繝・ヨ繧呈爾縺・*/
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (!balls[i].active)
        {
            balls[i].active = TRUE;
            balls[i].x = paddles[paddle_idx].x + FIX16(PADDLE_W / 2 - BALL_SIZE / 2);
            balls[i].y = FIX16(paddles[paddle_idx].y - BALL_SIZE - 1);

            fix16 speed = getBallSpeed();
            /* 繧・ｄ蜿ｳ荳頑婿蜷代↓逋ｺ蟆・*/
            balls[i].vx = F16_div(speed, FIX16(3));
            balls[i].vy = -speed;
            return;
        }
    }
}

/** 繝懊・繝ｫ繧偵ヱ繝峨Ν縺ｮ荳翫↓霑ｽ蠕薙＆縺帙ｋ・医し繝ｼ繝門燕・・*/
void ballFollowPaddle(u8 paddle_idx)
{
    if (paddle_idx >= MAX_PLAYERS) return;

    /* 譛蛻昴・髱槭い繧ｯ繝・ぅ繝悶↑繝懊・繝ｫ・医∪縺溘・繝懊・繝ｫ0・峨ｒ霑ｽ蠕・*/
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (!balls[i].active)
        {
            balls[i].x = paddles[paddle_idx].x + FIX16(PADDLE_W / 2 - BALL_SIZE / 2);
            balls[i].y = FIX16(paddles[paddle_idx].y - BALL_SIZE - 1);
            return;
        }
    }
}

/** 繝槭Ν繝√・繝ｼ繝ｫ: 譌｢蟄倥・繝ｼ繝ｫ縺九ｉ2縺､蛻・｣・*/
static void BLOCK_UNUSED spawnMultiBall(void)
{
    /* 譛蛻昴・繧｢繧ｯ繝・ぅ繝悶・繝ｼ繝ｫ繧定ｵｷ轤ｹ縺ｫ縺吶ｋ */
    Ball *src = NULL;
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (balls[i].active) { src = &balls[i]; break; }
    }
    if (!src) return;

    fix16 speed = getBallSpeed();

    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (!balls[i].active)
        {
            balls[i].active = TRUE;
            balls[i].x = src->x;
            balls[i].y = src->y;

            /* 蛻・｣りｧ貞ｺｦ繧偵★繧峨☆ */
            if (i == 1)
            {
                balls[i].vx = -speed;
                balls[i].vy = -F16_div(speed, FIX16(2));
            }
            else
            {
                balls[i].vx = speed;
                balls[i].vy = -F16_div(speed, FIX16(2));
            }
        }
    }
}

/** 繝懊・繝ｫ蜈ｨ菴捺峩譁ｰ */
void ballUpdate(void)
{
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (!balls[i].active) continue;

        Ball *b = &balls[i];

        /* X遘ｻ蜍・*/
        b->x += b->vx;
        s16 bx = F16_toInt(b->x);

        /* 蟾ｦ螢・*/
        if (bx < 0)
        {
            b->x = FIX16(0);
            b->vx = -b->vx;
            sndPlaySE(SND_SE_BALL_HIT_WALL);
        }
        /* 蜿ｳ螢・(繝励Ξ繧､繝輔ぅ繝ｼ繝ｫ繝臥ｫｯ) */
        if (bx + BALL_SIZE > PLAY_FIELD_W)
        {
            b->x = FIX16(PLAY_FIELD_W - BALL_SIZE);
            b->vx = -b->vx;
            sndPlaySE(SND_SE_BALL_HIT_WALL);
        }

        /* X譁ｹ蜷代ヶ繝ｭ繝・け陦晉ｪ・*/
        checkBlockCollisionX(b);

        /* Y遘ｻ蜍・*/
        b->y += b->vy;
        s16 by = F16_toInt(b->y);

        /* 螟ｩ莠・*/
        if (by < 0)
        {
            b->y = FIX16(0);
            b->vy = -b->vy;
            sndPlaySE(SND_SE_BALL_HIT_WALL);
        }

        /* Y譁ｹ蜷代ヶ繝ｭ繝・け陦晉ｪ・*/
        checkBlockCollisionY(b);

        /* 繝代ラ繝ｫ陦晉ｪ・*/
        checkPaddleCollision(b);

        /* 荳狗ｫｯ繝√ぉ繝・け */
        by = F16_toInt(b->y);
        if (by + BALL_SIZE >= PLAY_FIELD_H)
        {
            if (powerup_state.barrier)
            {
                /* 繝舌Μ繧｢縺ｧ蜿榊ｰ・*/
                b->y = FIX16(PLAY_FIELD_H - BALL_SIZE - 1);
                b->vy = -b->vy;
            }
            else
            {
                /* 繝懊・繝ｫ豸域ｻ・*/
                b->active = FALSE;
                sndPlaySE(SND_SE_BALL_LOSE);
            }
        }
    }

    /* 繝槭Ν繝√・繝ｼ繝ｫ蜃ｦ逅・ 繝代Ρ繝ｼ繧｢繝・・逋ｺ蜍墓凾 */
    /* (powerupActivate蜀・°繧牙他縺ｰ繧後ｋ) */
}

/** 繧｢繧ｯ繝・ぅ繝悶↑繝懊・繝ｫ縺ｮ謨ｰ */
u8 ballActiveCount(void)
{
    u8 count = 0;
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        if (balls[i].active) count++;
    }
    return count;
}

/** 繝懊・繝ｫ謠冗判・医ワ繝ｼ繝峨え繧ｧ繧｢繧ｹ繝励Λ繧､繝郁ｨｭ螳夲ｼ・*/
void ballDraw(void)
{
    for (u8 i = 0; i < MAX_BALLS; i++)
    {
        u8 spr_idx = SPR_BALL_START + i;

        if (balls[i].active)
        {
            VDP_setSpriteFull(
                spr_idx,
                F16_toInt(balls[i].x),
                F16_toInt(balls[i].y),
                SPRITE_SIZE(1, 1),
                TILE_ATTR_FULL(PAL_SPRITES, TRUE, FALSE, FALSE, TILE_BALL_IDX),
                spr_idx + 1
            );
        }
        else if (game_state == STATE_SERVE && serve_ball_visible && i == 0)
        {
            /* 繧ｵ繝ｼ繝門ｾ・■: 繝懊・繝ｫ繧偵ヱ繝峨Ν荳翫↓陦ｨ遉ｺ */
            fix16 bx = paddles[0].x + FIX16(PADDLE_W / 2 - BALL_SIZE / 2);
            s16 by = paddles[0].y - BALL_SIZE - 1;
            VDP_setSpriteFull(
                spr_idx,
                F16_toInt(bx), by,
                SPRITE_SIZE(1, 1),
                TILE_ATTR_FULL(PAL_SPRITES, TRUE, FALSE, FALSE, TILE_BALL_IDX),
                spr_idx + 1
            );
        }
        else
        {
            VDP_setSpriteFull(spr_idx, -128, -128, SPRITE_SIZE(1, 1), 0, spr_idx + 1);
        }
    }
}
