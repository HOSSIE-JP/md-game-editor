#include "dungeon_view.h"
#include "dungeon_patterns.h"
#include "resources.h"

#define DUN_TILE_CACHE_BASE TILE_USER_INDEX
#define DUN_TILE_CACHE_SIZE (DUN_VIEW_TILE_W * DUN_VIEW_TILE_H)
#define DUN_VIEW_X 4
#define DUN_VIEW_Y 4

#define DUN_MASK_NEAR_LEFT  0x01
#define DUN_MASK_NEAR_RIGHT 0x02
#define DUN_MASK_NEAR_FRONT 0x04
#define DUN_MASK_FAR_LEFT   0x08
#define DUN_MASK_FAR_RIGHT  0x10
#define DUN_MASK_FAR_FRONT  0x20

static const s8 dir_dx[4] = { 0, 1, 0, -1 };
static const s8 dir_dy[4] = { -1, 0, 1, 0 };
static const u16 edge_bits[4] = { DUN_EDGE_N, DUN_EDGE_E, DUN_EDGE_S, DUN_EDGE_W };
static const u16 door_bits[4] = { DUN_DOOR_N, DUN_DOOR_E, DUN_DOOR_S, DUN_DOOR_W };
static u16 tile_cache_sources[DUN_TILE_CACHE_SIZE];

void DUN_initView(void)
{
    PAL_setPalette(PAL0, dungeon_view_palette.data, CPU);
}

static bool inBounds(const DungeonFloorData *floor, s16 x, s16 y)
{
    return x >= 0 && y >= 0 && x < floor->width && y < floor->height;
}

static u16 cellEdges(const DungeonFloorData *floor, s16 x, s16 y)
{
    if (!inBounds(floor, x, y)) return DUN_EDGE_N | DUN_EDGE_E | DUN_EDGE_S | DUN_EDGE_W;
    return floor->edges[DUN_INDEX(floor, x, y)];
}

static bool hasWallOrDoorAt(const DungeonFloorData *floor, s16 x, s16 y, u8 dir)
{
    const u8 opposite = (u8)((dir + 2) & 3);
    const s16 nx = x + dir_dx[dir];
    const s16 ny = y + dir_dy[dir];
    const u16 current = cellEdges(floor, x, y);
    if (current & (edge_bits[dir] | door_bits[dir])) return TRUE;
    if (!inBounds(floor, nx, ny)) return TRUE;
    return (cellEdges(floor, nx, ny) & (edge_bits[opposite] | door_bits[opposite])) != 0;
}

static u8 animationPhase(u8 action, u8 anim_step)
{
    const u8 max_phase = DUN_WALL_PHASE_COUNT > 1 ? (DUN_WALL_PHASE_COUNT - 1) : 1;
    u8 phase = anim_step;
    if (action != DUN_ACTION_FORWARD && action != DUN_ACTION_BACKWARD) return 0;
    if (phase > max_phase) phase = max_phase;
    if (action == DUN_ACTION_BACKWARD) phase = (u8)(max_phase - phase);
    return phase;
}

static u8 viewMaskForPose(const DungeonFloorData *floor, u8 x, u8 y, u8 dir)
{
    const u8 left = (u8)((dir + 3) & 3);
    const u8 right = (u8)((dir + 1) & 3);
    const s16 fx = (s16)x + dir_dx[dir];
    const s16 fy = (s16)y + dir_dy[dir];
    u8 mask = 0;

    if (hasWallOrDoorAt(floor, x, y, left)) mask |= DUN_MASK_NEAR_LEFT;
    if (hasWallOrDoorAt(floor, x, y, right)) mask |= DUN_MASK_NEAR_RIGHT;
    if (hasWallOrDoorAt(floor, x, y, dir)) mask |= DUN_MASK_NEAR_FRONT;

    if (!(mask & DUN_MASK_NEAR_FRONT))
    {
        if (hasWallOrDoorAt(floor, fx, fy, left)) mask |= DUN_MASK_FAR_LEFT;
        if (hasWallOrDoorAt(floor, fx, fy, right)) mask |= DUN_MASK_FAR_RIGHT;
        if (hasWallOrDoorAt(floor, fx, fy, dir)) mask |= DUN_MASK_FAR_FRONT;
    }

    return mask;
}

static u16 sourceTileAt(u16 pattern_x, u16 pattern_y, u16 tx, u16 ty)
{
    const u16 map_x = pattern_x + tx;
    const u16 map_y = pattern_y + ty;
    const u16 source_attr = dungeon_view_tilemap.tilemap[(map_y * dungeon_view_tilemap.w) + map_x];
    return source_attr & TILE_INDEX_MASK;
}

static u16 loadCachedTile(u16 source_tile, u16 *cache_count)
{
    u16 index;
    if (source_tile >= dungeon_view_tileset.numTile) source_tile = 0;
    for (index = 0; index < *cache_count; index++)
    {
        if (tile_cache_sources[index] == source_tile) return index;
    }
    if (*cache_count >= DUN_TILE_CACHE_SIZE) return 0;
    index = *cache_count;
    tile_cache_sources[index] = source_tile;
    *cache_count = (u16)(*cache_count + 1);
    VDP_loadTileData(&dungeon_view_tileset.tiles[source_tile * 8], DUN_TILE_CACHE_BASE + index, 1, CPU);
    return index;
}

static void drawPattern(u16 pattern_index)
{
    const u16 pattern = pattern_index % DUN_VIEW_PATTERN_COUNT;
    const u16 pattern_x = (pattern % DUN_VIEW_PATTERN_COLUMNS) * DUN_VIEW_PATTERN_BLOCK_TILE_W;
    const u16 pattern_y = (pattern / DUN_VIEW_PATTERN_COLUMNS) * DUN_VIEW_PATTERN_BLOCK_TILE_H;
    u16 cache_count = 0;
    u16 ty;
    for (ty = 0; ty < DUN_VIEW_TILE_H; ty++)
    {
        u16 tx;
        for (tx = 0; tx < DUN_VIEW_TILE_W; tx++)
        {
            const u16 source_attr = dungeon_view_tilemap.tilemap[((pattern_y + ty) * dungeon_view_tilemap.w) + pattern_x + tx];
            const u16 source_tile = sourceTileAt(pattern_x, pattern_y, tx, ty);
            const u16 cache_slot = loadCachedTile(source_tile, &cache_count);
            const u16 tile_attr = (source_attr & TILE_ATTR_MASK) | (DUN_TILE_CACHE_BASE + cache_slot);
            VDP_setTileMapXY(BG_A, tile_attr, DUN_VIEW_X + tx, DUN_VIEW_Y + ty);
        }
    }
}

void DUN_drawView(const DungeonFloorData *floor, u8 x, u8 y, u8 dir, u8 action, u8 anim_step)
{
    const u8 mask = viewMaskForPose(floor, x, y, dir & 3);
    const u8 phase = animationPhase(action, anim_step);
    const u16 pattern = ((u16)mask * DUN_WALL_PHASE_COUNT) + phase;
    drawPattern(pattern);
}

void DUN_drawHud(u8 floor_index, u8 x, u8 y, u8 dir)
{
    static const char dirs[4] = { 'N', 'E', 'S', 'W' };
    char line[40];
    VDP_clearTextLine(0);
    VDP_clearTextLine(1);
    VDP_clearTextLine(24);
    VDP_clearTextLine(25);
    sprintf(line, "DBG F:%u X:%02u Y:%02u DIR:%c(%u)", floor_index + 1, x, y, dirs[dir & 3], dir & 3);
    VDP_drawText(line, 1, 0);
    VDP_drawText("UP/DOWN MOVE  LEFT/RIGHT TURN", 1, 1);
    VDP_drawText(line, 1, 24);
    VDP_drawText("BORDER MAGENTA = EMPTY BG", 1, 25);
}
