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

#define DUN_ACTION_NONE     0
#define DUN_ACTION_FORWARD  1
#define DUN_ACTION_BACKWARD 2
#define DUN_ACTION_TURN_L   3
#define DUN_ACTION_TURN_R   4
#define DUN_ACTION_STAIRS   5

typedef struct DungeonFloorData
{
    u8 width;
    u8 height;
    u8 start_x;
    u8 start_y;
    u8 start_dir;
    u8 view_set;
    const u16 *edges;
    const u8 *flags;
} DungeonFloorData;

#define DUN_INDEX(floor, x, y) ((u16)((y) * (floor)->width + (x)))

#endif /* _DUNGEON_GAME_H_ */
