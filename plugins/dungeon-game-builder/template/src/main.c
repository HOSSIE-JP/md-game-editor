/* =============================================================
 * Dungeon Game
 * デシジョンテーブル方式 25x16 BG タイル疑似3Dダンジョン
 *  - 前進/後退/左右回転を焼き込みフレームで滑らかにアニメーション
 *  - 扉 (通行可能)、宝箱/階段ビルボード、暗闇セル対応
 * ============================================================= */

#include <genesis.h>
#include "dungeon_data.h"
#include "dungeon_patterns.h"
#include "dungeon_view.h"

#define DUN_USE_TEXT_HUD 1

static const s8 dir_dx[4] = { 0, 1, 0, -1 };
static const s8 dir_dy[4] = { -1, 0, 1, 0 };
static const u16 edge_bits[4] = { DUN_EDGE_N, DUN_EDGE_E, DUN_EDGE_S, DUN_EDGE_W };
static const u16 oneway_bits[4] = { DUN_ONEWAY_N, DUN_ONEWAY_E, DUN_ONEWAY_S, DUN_ONEWAY_W };

static u8 floor_index;
static u8 player_x;
static u8 player_y;
static u8 player_dir;
static u16 prev_joy;

static bool inBounds(const DungeonFloorData *floor, s16 x, s16 y)
{
    return x >= 0 && y >= 0 && x < floor->width && y < floor->height;
}

static u16 edgesAt(const DungeonFloorData *floor, s16 x, s16 y)
{
    if (!inBounds(floor, x, y)) return DUN_EDGE_N | DUN_EDGE_E | DUN_EDGE_S | DUN_EDGE_W;
    return floor->edges[DUN_INDEX(floor, x, y)];
}

static bool hasWallAt(const DungeonFloorData *floor, s16 x, s16 y, u8 dir)
{
    const u8 opposite = (u8)((dir + 2) & 3);
    const s16 nx = x + dir_dx[dir];
    const s16 ny = y + dir_dy[dir];
    if (edgesAt(floor, x, y) & edge_bits[dir]) return TRUE;
    if (!inBounds(floor, nx, ny)) return TRUE;
    return (edgesAt(floor, nx, ny) & edge_bits[opposite]) != 0;
}

static bool canMove(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    const s16 nx = (s16)x + dir_dx[dir];
    const s16 ny = (s16)y + dir_dy[dir];
    const u8 opposite = (u8)((dir + 2) & 3);
    const u16 current = edgesAt(floor, x, y);
    const u16 next = edgesAt(floor, nx, ny);
    if (!inBounds(floor, nx, ny)) return FALSE;
    if (hasWallAt(floor, x, y, dir)) return FALSE;
    if ((current & (DUN_ONEWAY_N | DUN_ONEWAY_E | DUN_ONEWAY_S | DUN_ONEWAY_W)) && !(current & oneway_bits[dir])) return FALSE;
    if ((next & (DUN_ONEWAY_N | DUN_ONEWAY_E | DUN_ONEWAY_S | DUN_ONEWAY_W)) && !(next & oneway_bits[opposite])) return FALSE;
    return TRUE;
}

static void applyMove(const DungeonFloorData *floor, u8 action)
{
    if (action == DUN_ACTION_TURN_L)
    {
        player_dir = (u8)((player_dir + 3) & 3);
        return;
    }
    if (action == DUN_ACTION_TURN_R)
    {
        player_dir = (u8)((player_dir + 1) & 3);
        return;
    }
    if (action == DUN_ACTION_FORWARD && canMove(floor, player_x, player_y, player_dir))
    {
        player_x = (u8)(player_x + dir_dx[player_dir]);
        player_y = (u8)(player_y + dir_dy[player_dir]);
        return;
    }
    if (action == DUN_ACTION_BACKWARD)
    {
        const u8 dir = (u8)((player_dir + 2) & 3);
        if (canMove(floor, player_x, player_y, dir))
        {
            player_x = (u8)(player_x + dir_dx[dir]);
            player_y = (u8)(player_y + dir_dy[dir]);
        }
    }
}

static void resetPlayer(void)
{
    const DungeonFloorData *floor = &dungeon_floors[floor_index];
    player_x = floor->start_x;
    player_y = floor->start_y;
    player_dir = floor->start_dir & 3;
}

static void applyCellDarkness(const DungeonFloorData *floor)
{
    const u8 flags = floor->flags[DUN_INDEX(floor, player_x, player_y)];
    DUN_setDark((flags & DUN_FLAG_DARK) != 0);
}

static void drawCurrentView(const DungeonFloorData *floor)
{
    applyCellDarkness(floor);
    DUN_drawStatic(floor, player_x, player_y, player_dir);
#if DUN_USE_TEXT_HUD
    DUN_drawHud(floor_index, player_x, player_y, player_dir);
#endif
}

static void performAction(const DungeonFloorData *floor, u8 action)
{
    if (action == DUN_ACTION_FORWARD)
    {
        DUN_playForward(floor, player_x, player_y, player_dir);
    }
    else if (action == DUN_ACTION_BACKWARD)
    {
        /* 後退 = 移動先セル基準の前進フレームを逆再生 */
        const u8 back = (u8)((player_dir + 2) & 3);
        const u8 target_x = (u8)(player_x + dir_dx[back]);
        const u8 target_y = (u8)(player_y + dir_dy[back]);
        DUN_playBackward(floor, target_x, target_y, player_dir);
    }
    else if (action == DUN_ACTION_TURN_L || action == DUN_ACTION_TURN_R)
    {
        DUN_playTurn(floor, player_x, player_y, player_dir, action == DUN_ACTION_TURN_L);
    }
    applyMove(floor, action);
    drawCurrentView(floor);
}

static u8 pressedAction(const DungeonFloorData *floor, u16 pressed)
{
    if ((pressed & BUTTON_UP) && canMove(floor, player_x, player_y, player_dir)) return DUN_ACTION_FORWARD;
    if (pressed & BUTTON_DOWN)
    {
        const u8 dir = (u8)((player_dir + 2) & 3);
        if (canMove(floor, player_x, player_y, dir)) return DUN_ACTION_BACKWARD;
    }
    if (pressed & BUTTON_LEFT) return DUN_ACTION_TURN_L;
    if (pressed & BUTTON_RIGHT) return DUN_ACTION_TURN_R;
    return DUN_ACTION_NONE;
}

int main(bool hardReset)
{
    (void)hardReset;
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    JOY_init();
    DUN_initView();
    resetPlayer();
    drawCurrentView(&dungeon_floors[floor_index]);

    while (TRUE)
    {
        const DungeonFloorData *floor = &dungeon_floors[floor_index];
        const u16 joy = JOY_readJoypad(JOY_1);
        const u16 pressed = joy & ~prev_joy;
        u8 action = DUN_ACTION_NONE;
        prev_joy = joy;

        if ((pressed & BUTTON_START) && dungeon_floor_count > 1)
        {
            floor_index = (u8)((floor_index + 1) % dungeon_floor_count);
            resetPlayer();
            drawCurrentView(&dungeon_floors[floor_index]);
        }
        else
        {
            action = pressedAction(floor, pressed);
            if (action != DUN_ACTION_NONE)
            {
                performAction(floor, action);
            }
        }

        SPR_update();
        SYS_doVBlankProcess();
    }

    return 0;
}
