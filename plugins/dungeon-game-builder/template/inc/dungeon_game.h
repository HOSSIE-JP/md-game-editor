#ifndef _DUNGEON_GAME_H_
#define _DUNGEON_GAME_H_

#include <genesis.h>
#include <kdebug.h>

#define DUN_DIR_N 0
#define DUN_DIR_E 1
#define DUN_DIR_S 2
#define DUN_DIR_W 3

#define DUN_EDGE_N 0x0001
#define DUN_EDGE_E 0x0002
#define DUN_EDGE_S 0x0004
#define DUN_EDGE_W 0x0008
#define DUN_DOOR_N 0x0010
#define DUN_DOOR_E 0x0020
#define DUN_DOOR_S 0x0040
#define DUN_DOOR_W 0x0080
#define DUN_ONEWAY_N 0x0100
#define DUN_ONEWAY_E 0x0200
#define DUN_ONEWAY_S 0x0400
#define DUN_ONEWAY_W 0x0800

#define DUN_FLAG_DARK        0x01
#define DUN_FLAG_CHEST       0x02
#define DUN_FLAG_STAIRS_UP   0x04
#define DUN_FLAG_STAIRS_DOWN 0x08
#define DUN_FLAG_ENEMY       0x10

#define DUN_ACTION_NONE     0
#define DUN_ACTION_FORWARD  1
#define DUN_ACTION_BACKWARD 2
#define DUN_ACTION_TURN_L   3
#define DUN_ACTION_TURN_R   4

typedef struct DungeonFloorData
{
    u8 width;
    u8 height;
    u8 start_x;
    u8 start_y;
    u8 start_dir;
    u8 view_set;
    u8 enemy_step_vblanks;
    const u16 *edges;
    const u8 *flags;
} DungeonFloorData;

#define DUN_INDEX(floor, x, y) ((u16)((y) * (floor)->width + (x)))

/*
 * エネミー: main.c が dun_enemies[DUNGEON_FLOOR_COUNT][DUN_MAX_ENEMIES] としてフロア別に
 * 永続所有する (dun_visited と同じパターン)。ビュー側 (dungeon_view.c) へは
 * DUN_setEnemies() でポインタ+件数だけを渡す。AI は render-core.js (JS) と main.c (C) の
 * 二重実装 (losVisible と同じパターン)。x=0,y=0 が起点セルとダブっても構わないが、
 * 占有ルール上エネミーは常にプレイヤーのセル (dd=0,dl=0) を避ける — 死角なので専用の
 * dd=0,dl=0 除外コードは不要 (占有ブロックが自然に防ぐ)。
 */
#define DUN_MAX_ENEMIES 8
#define DUN_ENEMY_MODE_WANDER 0
#define DUN_ENEMY_MODE_CHASE  1
/* 視界: 正面直線何マス以内でプレイヤーを捕捉するか (壁・扉どちらも遮る) */
#define DUN_ENEMY_SIGHT_RANGE 3
/* 追跡モードを保持する残りtick数 (プレイヤーを見失ってからこの回数で徘徊へ復帰) */
#define DUN_ENEMY_CHASE_TIMER 5
/* 徘徊: 直進が可能な場合にそれを選ぶ確率 (%) */
#define DUN_ENEMY_WANDER_FORWARD_PCT 75
/* render-core.js の ENEMY_RNG_DEFAULT_SEED と同一値 (xorshift16 の初期シード) */
#define DUN_ENEMY_RNG_SEED_DEFAULT 0x2025

typedef struct DunEnemy
{
    u8 x;
    u8 y;
    u8 dir;
    u8 mode;
    u8 anim;
    u8 chase_timer;
    u8 active;
    /* prev_x/prev_y: 描画側のスライド補間用に、直前tick開始時点のセルを保持する
     * (render-core.js の enemy.prevX/prevY と同一。移動しなければ prev===cur)。 */
    u8 prev_x;
    u8 prev_y;
    u8 _pad;
} DunEnemy;

#endif /* _DUNGEON_GAME_H_ */
