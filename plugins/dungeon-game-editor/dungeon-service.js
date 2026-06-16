'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_SIZE = 20;
const MIN_SIZE = 4;
const DIRS = [
  { id: 'n', bit: 1, dx: 0, dy: -1, opposite: 's' },
  { id: 'e', bit: 2, dx: 1, dy: 0, opposite: 'w' },
  { id: 's', bit: 4, dx: 0, dy: 1, opposite: 'n' },
  { id: 'w', bit: 8, dx: -1, dy: 0, opposite: 'e' },
];
const DIR_BY_ID = Object.fromEntries(DIRS.map((dir) => [dir.id, dir]));
const DIR_INDEX = { n: 0, e: 1, s: 2, w: 3 };
const CELL_FLAGS = {
  dark: 1,
  chest: 2,
  stairs_up: 4,
  stairs_down: 8,
};
const DEFAULT_SETTINGS = {
  animation_frames: 8,
  view_tile_width: 25,
  view_tile_height: 16,
  view_pixel_width: 200,
  view_pixel_height: 128,
};
const DEFAULT_ASSETS = {
  wall_texture: 'dungeon/textures/dungeon_texture_atlas.png#wall',
  floor_texture: 'dungeon/textures/dungeon_texture_atlas.png#floor',
  ceiling_texture: 'dungeon/textures/dungeon_texture_atlas.png#ceiling',
  chest_texture: 'dungeon/textures/dungeon_texture_atlas.png#chest',
  stairs_up_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_up',
  stairs_down_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_down',
};
const ATLAS_RECTS = {
  wall: [0, 0],
  floor: [1, 0],
  ceiling: [2, 0],
  chest: [0, 1],
  stairs_up: [1, 1],
  stairs_down: [2, 1],
};
const WALL_VIEW_BITS = {
  nearLeft: 1,
  nearRight: 2,
  nearFront: 4,
  farLeft: 8,
  farRight: 16,
  farFront: 32,
};
const WALL_VIEW_COUNT = 64;
const WALL_PHASE_COUNT = 5;
const DUN_VIEW_PATTERN_COLUMNS = 8;
const DUN_ANIMATION_STEP_VBLANKS = 4;
const TILESET_TILES_PER_ROW = 32;
const VIEW_HORIZON = 64;
const VIEW_PROJECT_Y = 58;
const VIEW_PROJECT_X = VIEW_PROJECT_Y;
const VIEW_EYE_Z = 0.42;
const VIEW_NEAR_CLIP = 0.045;
const VIEW_CAMERA_BACKSTEP = 0.18;
const VIEW_DEPTH_EPSILON = 0.002;
const WALL_SEGMENT_OVERLAP = 0.01;
const PATTERN_TEXTURE_MAX_SIZE = 96;
const GENERATED_RESOURCE_BEGIN = '// DUNGEON_GENERATED_BEGIN';
const GENERATED_RESOURCE_END = '// DUNGEON_GENERATED_END';
const GENERATED_TILESET_REL = 'dungeon/generated/dungeon_view_tileset.png';
const GENERATED_MAP_REL = 'dungeon/generated/dungeon_view_map.png';
const PATTERN_TRANSPARENT_COLOR = 0xff00ff;
const PATTERN_PALETTE = [
  PATTERN_TRANSPARENT_COLOR,
  0x101018,
  0x202030,
  0x282018,
  0x403020,
  0x303030,
  0x505050,
  0x787060,
  0xb0a080,
  0x604020,
  0xa07038,
  0x4060a0,
  0xc08830,
  0xf0c060,
  0x70a0c0,
  0xe0e8f0,
].map((color) => ({
  value: color,
  r: (color >> 16) & 0xff,
  g: (color >> 8) & 0xff,
  b: color & 0xff,
}));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function getDungeonDir(projectDir) {
  return path.join(projectDir, 'data', 'dungeon');
}

function getFloorsDir(projectDir) {
  return path.join(getDungeonDir(projectDir), 'floors');
}

function getSettingsPath(projectDir) {
  return path.join(getDungeonDir(projectDir), 'settings.json');
}

function ensureResourcesFile(projectDir) {
  const resPath = path.join(projectDir, 'res', 'resources.res');
  ensureDir(path.dirname(resPath));
  if (!fs.existsSync(resPath)) fs.writeFileSync(resPath, '', 'utf-8');
  return resPath;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeId(value, prefix = 'floor') {
  const text = String(value || '').trim();
  return text || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeFilePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'floor';
}

function blankCell(edgeMask = 15) {
  return {
    walls: edgeMask,
    doors: 0,
    one_way: 0,
    dark: false,
    event: '',
    stairs: '',
  };
}

function normalizeEdgeMask(value, fallback = 0) {
  if (typeof value === 'number') return value & 15;
  if (value && typeof value === 'object') {
    return DIRS.reduce((mask, dir) => (
      value[dir.id] || value[dir.id.toUpperCase()] ? mask | dir.bit : mask
    ), 0);
  }
  return fallback & 15;
}

function normalizeCell(cell) {
  const source = cell && typeof cell === 'object' ? cell : {};
  return {
    walls: normalizeEdgeMask(source.walls, 15),
    doors: normalizeEdgeMask(source.doors, 0),
    one_way: normalizeEdgeMask(source.one_way || source.oneWay, 0),
    dark: Boolean(source.dark),
    event: String(source.event || ''),
    stairs: ['up', 'down'].includes(source.stairs) ? source.stairs : '',
  };
}

function normalizeStart(start, width, height) {
  return {
    x: clampInt(start?.x, 0, width - 1, 1),
    y: clampInt(start?.y, 0, height - 1, 1),
    dir: clampInt(start?.dir, 0, 3, 1),
  };
}

function normalizeFloor(floor = {}, fallbackOrder = 1, fallbackName = `Floor ${fallbackOrder}`) {
  const width = clampInt(floor.width, MIN_SIZE, MAX_SIZE, 12);
  const height = clampInt(floor.height, MIN_SIZE, MAX_SIZE, 12);
  const order = clampInt(floor.order, 1, 999, fallbackOrder);
  const cells = Array.from({ length: height }, (_, y) => (
    Array.from({ length: width }, (_, x) => normalizeCell(Array.isArray(floor.cells?.[y]) ? floor.cells[y][x] : null))
  ));
  return {
    id: normalizeId(floor.id, 'floor'),
    name: String(floor.name || fallbackName),
    order,
    width,
    height,
    start: normalizeStart(floor.start || {}, width, height),
    assets: { ...DEFAULT_ASSETS, ...(floor.assets && typeof floor.assets === 'object' ? floor.assets : {}) },
    cells,
  };
}

function normalizeSettings(settings = {}) {
  const incoming = settings && typeof settings === 'object' ? settings : {};
  return {
    animation_frames: clampInt(incoming.animation_frames, 2, 8, DEFAULT_SETTINGS.animation_frames),
    view_tile_width: DEFAULT_SETTINGS.view_tile_width,
    view_tile_height: DEFAULT_SETTINGS.view_tile_height,
    view_pixel_width: DEFAULT_SETTINGS.view_pixel_width,
    view_pixel_height: DEFAULT_SETTINGS.view_pixel_height,
  };
}

function listFloorFiles(projectDir) {
  const floorsDir = getFloorsDir(projectDir);
  if (!fs.existsSync(floorsDir)) return [];
  return fs.readdirSync(floorsDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(floorsDir, name))
    .sort((a, b) => a.localeCompare(b));
}

function loadFloors(projectDir) {
  return listFloorFiles(projectDir)
    .map((filePath) => ({ filePath, floor: readJson(filePath, null) }))
    .filter((entry) => entry.floor && typeof entry.floor === 'object')
    .map((entry, index) => ({
      filePath: entry.filePath,
      floor: normalizeFloor(entry.floor, index + 1, `Floor ${index + 1}`),
    }))
    .sort((left, right) => left.floor.order - right.floor.order || left.floor.name.localeCompare(right.floor.name));
}

function floorFilePath(projectDir, floor, existingFilePath) {
  if (existingFilePath) return existingFilePath;
  const order = String(floor.order || 1).padStart(3, '0');
  return path.join(getFloorsDir(projectDir), `floor_${order}_${safeFilePart(floor.id)}.json`);
}

function findFloorFile(projectDir, id) {
  return loadFloors(projectDir).find((entry) => entry.floor.id === id)?.filePath || '';
}

function makeNextFloorName(floors) {
  const max = floors.reduce((highest, floor) => {
    const match = /(\d+)\s*$/.exec(String(floor.name || ''));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `Floor ${max + 1}`;
}

function hasEdge(floor, x, y, edgeName) {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return true;
  return Boolean(floor.cells[y][x].walls & DIR_BY_ID[edgeName].bit);
}

function setEdge(cells, width, height, x, y, edgeName, key, enabled) {
  const dir = DIR_BY_ID[edgeName];
  if (!dir || x < 0 || y < 0 || x >= width || y >= height) return;
  const cell = cells[y][x];
  cell[key] = enabled ? (cell[key] | dir.bit) : (cell[key] & ~dir.bit);
  const nx = x + dir.dx;
  const ny = y + dir.dy;
  const opposite = DIR_BY_ID[dir.opposite];
  if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
    const neighbor = cells[ny][nx];
    neighbor[key] = enabled ? (neighbor[key] | opposite.bit) : (neighbor[key] & ~opposite.bit);
  }
}

function carve(cells, width, height, x, y, edgeName) {
  setEdge(cells, width, height, x, y, edgeName, 'walls', false);
}

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function inBounds(width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function buildMaze(cells, width, height, startX, startY) {
  const visited = new Set([cellKey(startX, startY)]);
  const stack = [{ x: startX, y: startY }];
  while (stack.length) {
    const current = stack[stack.length - 1];
    const candidates = shuffle(DIRS)
      .map((dir) => ({ dir, x: current.x + dir.dx, y: current.y + dir.dy }))
      .filter((entry) => inBounds(width, height, entry.x, entry.y) && !visited.has(cellKey(entry.x, entry.y)));
    if (!candidates.length) {
      stack.pop();
      continue;
    }
    const next = candidates[0];
    carve(cells, width, height, current.x, current.y, next.dir.id);
    visited.add(cellKey(next.x, next.y));
    stack.push({ x: next.x, y: next.y });
  }
}

function carveRoom(cells, width, height, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (x > room.x) carve(cells, width, height, x, y, 'w');
      if (y > room.y) carve(cells, width, height, x, y, 'n');
    }
  }
}

function roomsOverlap(a, b) {
  return a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y;
}

function placeRooms(cells, width, height) {
  const target = clampInt(Math.floor((width * height) / 42), 3, 8, 4);
  const rooms = [];
  for (let attempt = 0; attempt < target * 18 && rooms.length < target; attempt++) {
    const w = clampInt(2 + Math.floor(Math.random() * 4), 2, Math.min(5, width - 2), 3);
    const h = clampInt(2 + Math.floor(Math.random() * 4), 2, Math.min(5, height - 2), 3);
    const x = 1 + Math.floor(Math.random() * Math.max(1, width - w - 1));
    const y = 1 + Math.floor(Math.random() * Math.max(1, height - h - 1));
    const room = { x, y, w, h };
    if (rooms.some((entry) => roomsOverlap(entry, room))) continue;
    rooms.push(room);
    carveRoom(cells, width, height, room);
  }
  return rooms;
}

function markDoors(cells, width, height, rooms) {
  rooms.forEach((room) => {
    const edges = [];
    for (let x = room.x; x < room.x + room.w; x++) {
      edges.push({ x, y: room.y, dir: 'n' });
      edges.push({ x, y: room.y + room.h - 1, dir: 's' });
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      edges.push({ x: room.x, y, dir: 'w' });
      edges.push({ x: room.x + room.w - 1, y, dir: 'e' });
    }
    const candidates = shuffle(edges).filter((edge) => {
      const dir = DIR_BY_ID[edge.dir];
      const nx = edge.x + dir.dx;
      const ny = edge.y + dir.dy;
      return inBounds(width, height, nx, ny) && !(cells[edge.y][edge.x].walls & dir.bit);
    });
    candidates.slice(0, 1 + Math.floor(Math.random() * 2)).forEach((edge) => {
      setEdge(cells, width, height, edge.x, edge.y, edge.dir, 'doors', true);
    });
  });
}

function walkableNeighbors(floor, x, y) {
  return DIRS
    .map((dir) => ({ dir, x: x + dir.dx, y: y + dir.dy }))
    .filter((entry) => inBounds(floor.width, floor.height, entry.x, entry.y) && !(floor.cells[y][x].walls & entry.dir.bit));
}

function farthestCell(floor, start) {
  const queue = [{ x: start.x, y: start.y, d: 0 }];
  const visited = new Set([cellKey(start.x, start.y)]);
  let farthest = queue[0];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.d > farthest.d) farthest = current;
    walkableNeighbors(floor, current.x, current.y).forEach((next) => {
      const key = cellKey(next.x, next.y);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push({ x: next.x, y: next.y, d: current.d + 1 });
    });
  }
  return farthest;
}

function makeGeneratedFloor(payload = {}) {
  const width = clampInt(payload.width, MIN_SIZE, MAX_SIZE, 12);
  const height = clampInt(payload.height, MIN_SIZE, MAX_SIZE, 12);
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => blankCell(15)));
  const startX = 1;
  const startY = 1;
  buildMaze(cells, width, height, startX, startY);
  const rooms = placeRooms(cells, width, height);
  markDoors(cells, width, height, rooms);

  const floor = normalizeFloor({
    id: payload.id,
    name: payload.name,
    order: payload.order,
    width,
    height,
    start: { x: startX, y: startY, dir: 1 },
    assets: payload.assets || {},
    cells,
  }, payload.order || 1, payload.name || 'Generated Floor');
  const down = farthestCell(floor, floor.start);
  floor.cells[floor.start.y][floor.start.x].stairs = 'up';
  floor.cells[down.y][down.x].stairs = 'down';

  shuffle(rooms).slice(0, Math.max(1, Math.floor(rooms.length / 2))).forEach((room, index) => {
    const x = Math.min(room.x + room.w - 1, room.x + 1 + (index % Math.max(1, room.w - 1)));
    const y = Math.min(room.y + room.h - 1, room.y + 1);
    if (x === floor.start.x && y === floor.start.y) return;
    if (x === down.x && y === down.y) return;
    floor.cells[y][x].event = 'chest';
  });

  for (let i = 0; i < Math.max(1, Math.floor((width * height) / 90)); i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    if ((x === floor.start.x && y === floor.start.y) || (x === down.x && y === down.y)) continue;
    floor.cells[y][x].dark = true;
  }

  return floor;
}

function readSettings(projectDir) {
  return normalizeSettings(readJson(getSettingsPath(projectDir), DEFAULT_SETTINGS));
}

function exportHeader(projectDir, floors) {
  const outPath = path.join(projectDir, 'inc', 'dungeon_data.h');
  const lines = [
    '/* Generated by dungeon-game-editor */',
    '#ifndef _DUNGEON_DATA_H_',
    '#define _DUNGEON_DATA_H_',
    '',
    '#include "dungeon_game.h"',
    '',
    `#define DUNGEON_FLOOR_COUNT ${floors.length}`,
    '',
    'extern const DungeonFloorData dungeon_floors[DUNGEON_FLOOR_COUNT];',
    'extern const u8 dungeon_floor_count;',
    '',
    '#endif /* _DUNGEON_DATA_H_ */',
    '',
  ];
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  return outPath;
}

function edgeValue(cell) {
  return (cell.walls & 15) | ((cell.doors & 15) << 4) | ((cell.one_way & 15) << 8);
}

function flagValue(cell) {
  let flags = 0;
  if (cell.dark) flags |= CELL_FLAGS.dark;
  if (cell.event === 'chest') flags |= CELL_FLAGS.chest;
  if (cell.stairs === 'up') flags |= CELL_FLAGS.stairs_up;
  if (cell.stairs === 'down') flags |= CELL_FLAGS.stairs_down;
  return flags;
}

function cArray(values, indent = '    ') {
  return values.map((value, index) => `${index % 12 === 0 ? indent : ''}${value}${index === values.length - 1 ? '' : ','}`).join('\n');
}

function cHexArray(values, perLine = 8, digits = 8) {
  const lines = [];
  for (let index = 0; index < values.length; index += perLine) {
    lines.push(`    ${values.slice(index, index + perLine).map((value) => `0x${value.toString(16).padStart(digits, '0')}`).join(', ')}${index + perLine >= values.length ? '' : ','}`);
  }
  return lines.join('\n');
}

function parseTextureRef(ref) {
  const [pathPart, tagPart] = String(ref || '').split('#');
  return { assetPath: String(pathPart || '').trim(), tag: String(tagPart || '').trim() };
}

function resolveAssetPath(projectDir, assetPath) {
  const clean = String(assetPath || '').replace(/\\/g, '/').replace(/^res\//, '');
  if (!clean) return '';
  const projectRoot = path.resolve(projectDir);
  if (path.isAbsolute(clean)) {
    const absolute = path.resolve(clean);
    return absolute === projectRoot || absolute.startsWith(`${projectRoot}${path.sep}`) ? absolute : '';
  }
  const resRoot = path.join(projectRoot, 'res');
  const resolved = path.resolve(resRoot, clean);
  return resolved === resRoot || resolved.startsWith(`${resRoot}${path.sep}`) ? resolved : '';
}

function parsePng(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`not a PNG file: ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error(`unsupported PNG encoding: ${filePath}`);
      }
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2], 255]);
    } else if (type === 'tRNS') {
      transparency = Array.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height || bitDepth !== 8) throw new Error(`unsupported PNG bit depth: ${filePath}`);
  const bytesPerPixel = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!bytesPerPixel) throw new Error(`unsupported PNG color type ${colorType}: ${filePath}`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc(height * stride);
  let inputOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = inflated[inputOffset++];
      const a = x >= bytesPerPixel ? raw[rowStart + x - bytesPerPixel] : 0;
      const b = y > 0 ? raw[prevStart + x] : 0;
      const c = y > 0 && x >= bytesPerPixel ? raw[prevStart + x - bytesPerPixel] : 0;
      let value = rawByte;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) value += paethPredictor(a, b, c);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}: ${filePath}`);
      raw[rowStart + x] = value & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * stride) + (x * bytesPerPixel);
      const dest = ((y * width) + x) * 4;
      if (colorType === 6) {
        pixels[dest] = raw[src];
        pixels[dest + 1] = raw[src + 1];
        pixels[dest + 2] = raw[src + 2];
        pixels[dest + 3] = raw[src + 3];
      } else if (colorType === 2) {
        pixels[dest] = raw[src];
        pixels[dest + 1] = raw[src + 1];
        pixels[dest + 2] = raw[src + 2];
        pixels[dest + 3] = 255;
      } else if (colorType === 3) {
        const color = palette?.[raw[src]] || [0, 0, 0, 255];
        pixels[dest] = color[0];
        pixels[dest + 1] = color[1];
        pixels[dest + 2] = color[2];
        pixels[dest + 3] = transparency?.[raw[src]] ?? color[3];
      } else if (colorType === 0) {
        pixels[dest] = raw[src];
        pixels[dest + 1] = raw[src];
        pixels[dest + 2] = raw[src];
        pixels[dest + 3] = 255;
      } else if (colorType === 4) {
        pixels[dest] = raw[src];
        pixels[dest + 1] = raw[src];
        pixels[dest + 2] = raw[src];
        pixels[dest + 3] = raw[src + 1];
      }
    }
  }

  return { width, height, data: pixels };
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function writeIndexedPng(filePath, width, height, palette, pixels) {
  if (pixels.length !== width * height) {
    throw new Error(`indexed PNG pixel count mismatch: ${filePath}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((color, index) => {
    const dest = index * 3;
    plte[dest] = color.r;
    plte[dest + 1] = color.g;
    plte[dest + 2] = color.b;
  });
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.subarray(y * width, (y + 1) * width)).copy(raw, rowStart + 1);
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND'),
  ]));
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function cropTexture(image, tag) {
  const coords = ATLAS_RECTS[tag] || ATLAS_RECTS.wall;
  const cellW = Math.max(1, Math.floor(image.width / 3));
  const cellH = Math.max(1, Math.floor(image.height / 2));
  const out = new Uint8Array(cellW * cellH * 4);
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const sx = Math.min(image.width - 1, coords[0] * cellW + x);
      const sy = Math.min(image.height - 1, coords[1] * cellH + y);
      const source = ((sy * image.width) + sx) * 4;
      const dest = ((y * cellW) + x) * 4;
      out[dest] = image.data[source];
      out[dest + 1] = image.data[source + 1];
      out[dest + 2] = image.data[source + 2];
      out[dest + 3] = image.data[source + 3];
    }
  }
  return { width: cellW, height: cellH, data: out };
}

function fallbackWallTexture() {
  const width = 32;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const brick = ((Math.floor(y / 8) + Math.floor((x + (Math.floor(y / 8) & 1) * 8) / 16)) & 1) === 0;
      const mortar = (y % 8) === 0 || ((x + (Math.floor(y / 8) & 1) * 8) % 16) === 0;
      const color = mortar ? [176, 160, 128] : (brick ? [117, 105, 87] : [74, 67, 56]);
      const i = ((y * width) + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function resizeTextureForPatterns(texture, maxSize = PATTERN_TEXTURE_MAX_SIZE) {
  const scale = Math.min(1, maxSize / Math.max(texture.width, texture.height));
  const width = Math.max(1, Math.round(texture.width * scale));
  const height = Math.max(1, Math.round(texture.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor((x / width) * texture.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / width) * texture.width));
      const sy0 = Math.floor((y / height) * texture.height);
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / height) * texture.height));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < Math.min(texture.height, sy1); sy++) {
        for (let sx = sx0; sx < Math.min(texture.width, sx1); sx++) {
          const source = ((sy * texture.width) + sx) * 4;
          r += texture.data[source];
          g += texture.data[source + 1];
          b += texture.data[source + 2];
          a += texture.data[source + 3];
          count++;
        }
      }
      const dest = ((y * width) + x) * 4;
      data[dest] = Math.round(r / Math.max(1, count));
      data[dest + 1] = Math.round(g / Math.max(1, count));
      data[dest + 2] = Math.round(b / Math.max(1, count));
      data[dest + 3] = Math.round(a / Math.max(1, count));
    }
  }
  return { width, height, data };
}

function loadWallTexture(projectDir, floor) {
  const ref = parseTextureRef(floor?.assets?.wall_texture || DEFAULT_ASSETS.wall_texture);
  const imagePath = resolveAssetPath(projectDir, ref.assetPath);
  if (!imagePath || !fs.existsSync(imagePath)) return resizeTextureForPatterns(fallbackWallTexture());
  try {
    return resizeTextureForPatterns(cropTexture(parsePng(imagePath), ref.tag || 'wall'));
  } catch (_) {
    return resizeTextureForPatterns(fallbackWallTexture());
  }
}

function buildPatternAssets(settings, wallTexture) {
  const viewTileW = settings.view_tile_width;
  const viewTileH = settings.view_tile_height;
  const viewPixelW = settings.view_pixel_width;
  const viewPixelH = settings.view_pixel_height;
  const palette = buildPatternPalette(wallTexture);
  const transparentTile = Array(8).fill(0);
  const transparentKey = tileRowsKey(transparentTile);
  const tileRows = [transparentTile];
  const tileLookup = new Map([[transparentKey, 0]]);
  const maps = [];

  for (let mask = 0; mask < WALL_VIEW_COUNT; mask++) {
    for (let phase = 0; phase < WALL_PHASE_COUNT; phase++) {
      const pixels = renderPatternPixels(viewPixelW, viewPixelH, wallTexture, palette, mask, phase);
      const map = [];
      for (let ty = 0; ty < viewTileH; ty++) {
        for (let tx = 0; tx < viewTileW; tx++) {
          const rows = patternTileRows(pixels, viewPixelW, tx, ty);
          const key = tileRowsKey(rows);
          let tileIndex = tileLookup.get(key);
          if (tileIndex == null) {
            tileIndex = tileRows.length;
            tileRows.push(rows);
            tileLookup.set(key, tileIndex);
          }
          map.push(tileIndex);
        }
      }
      maps.push(map);
    }
  }

  return {
    palette,
    tileRows,
    tiles: tileRows.flat(),
    tileCount: tileRows.length,
    maps,
  };
}

function tileRowsKey(rows) {
  return rows.map((row) => row.toString(16).padStart(8, '0')).join(',');
}

function buildPatternPalette(texture) {
  const colors = [];
  const shades = [0.28, 0.36, 0.46, 0.56, 0.68, 0.82, 0.96];
  const stepX = Math.max(1, Math.floor(texture.width / 48));
  const stepY = Math.max(1, Math.floor(texture.height / 48));
  for (let y = 0; y < texture.height; y += stepY) {
    for (let x = 0; x < texture.width; x += stepX) {
      const i = ((y * texture.width) + x) * 4;
      if (texture.data[i + 3] < 16) continue;
      shades.forEach((shade) => {
        colors.push({
          r: Math.max(0, Math.min(255, Math.round(texture.data[i] * shade))),
          g: Math.max(0, Math.min(255, Math.round(texture.data[i + 1] * shade))),
          b: Math.max(0, Math.min(255, Math.round(texture.data[i + 2] * shade))),
        });
      });
    }
  }
  const quantized = quantizePalette(colors, 15);
  const fallback = PATTERN_PALETTE.slice(1);
  while (quantized.length < 15) quantized.push(fallback[quantized.length % fallback.length]);
  return [PATTERN_PALETTE[0], ...quantized.slice(0, 15)];
}

function quantizePalette(colors, count) {
  if (!colors.length) return PATTERN_PALETTE.slice(1, count + 1);
  let buckets = [colors.slice()];
  while (buckets.length < count) {
    let bestIndex = -1;
    let bestRange = -1;
    buckets.forEach((bucket, index) => {
      if (bucket.length < 2) return;
      const range = colorRange(bucket);
      if (range.value > bestRange) {
        bestRange = range.value;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    const bucket = buckets.splice(bestIndex, 1)[0];
    const channel = colorRange(bucket).channel;
    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.max(1, Math.floor(bucket.length / 2));
    buckets.push(bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets
    .map(averageColor)
    .sort((a, b) => colorLuma(a) - colorLuma(b));
}

function colorRange(colors) {
  const min = { r: 255, g: 255, b: 255 };
  const max = { r: 0, g: 0, b: 0 };
  colors.forEach((color) => {
    min.r = Math.min(min.r, color.r);
    min.g = Math.min(min.g, color.g);
    min.b = Math.min(min.b, color.b);
    max.r = Math.max(max.r, color.r);
    max.g = Math.max(max.g, color.g);
    max.b = Math.max(max.b, color.b);
  });
  const ranges = [
    { channel: 'r', value: max.r - min.r },
    { channel: 'g', value: max.g - min.g },
    { channel: 'b', value: max.b - min.b },
  ];
  return ranges.sort((a, b) => b.value - a.value)[0];
}

function averageColor(colors) {
  const total = colors.reduce((sum, color) => ({
    r: sum.r + color.r,
    g: sum.g + color.g,
    b: sum.b + color.b,
  }), { r: 0, g: 0, b: 0 });
  const count = Math.max(1, colors.length);
  return {
    value: ((Math.round(total.r / count) << 16) | (Math.round(total.g / count) << 8) | Math.round(total.b / count)) >>> 0,
    r: Math.round(total.r / count),
    g: Math.round(total.g / count),
    b: Math.round(total.b / count),
  };
}

function colorLuma(color) {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function renderPatternPixels(width, height, texture, palette, mask, phase) {
  const pixels = new Uint8Array(width * height);
  const zBuffer = new Float32Array(width * height);
  zBuffer.fill(Number.POSITIVE_INFINITY);
  const p = phase / Math.max(1, WALL_PHASE_COUNT - 1);
  const pose = previewCameraPose({ x: 0.5 + p, y: 0.5, angle: 0 });
  patternWallSpans(mask).forEach((span) => {
    drawWallSpanPattern(pixels, zBuffer, width, height, texture, palette, pose, span);
  });
  return pixels;
}

function previewCameraPose(pose) {
  return {
    ...pose,
    x: pose.x - Math.cos(pose.angle) * VIEW_CAMERA_BACKSTEP,
    y: pose.y - Math.sin(pose.angle) * VIEW_CAMERA_BACKSTEP,
  };
}

function patternWallSpans(mask) {
  const spans = [];
  const hasNearFront = Boolean(mask & WALL_VIEW_BITS.nearFront);
  if (!hasNearFront) {
    if (mask & WALL_VIEW_BITS.farLeft) spans.push(wallSpan(1, 0, 2, 0, 'h'));
    if (mask & WALL_VIEW_BITS.farRight) spans.push(wallSpan(1, 1, 2, 1, 'h'));
    if (mask & WALL_VIEW_BITS.farFront) spans.push(wallSpan(2, 0, 2, 1, 'v'));
  }
  if (mask & WALL_VIEW_BITS.nearLeft) spans.push(wallSpan(0, 0, 1, 0, 'h'));
  if (mask & WALL_VIEW_BITS.nearRight) spans.push(wallSpan(0, 1, 1, 1, 'h'));
  if (hasNearFront) {
    if (!(mask & WALL_VIEW_BITS.nearLeft)) spans.push(wallSpan(0.62, 0, 1, 0, 'h'));
    if (!(mask & WALL_VIEW_BITS.nearRight)) spans.push(wallSpan(0.62, 1, 1, 1, 'h'));
    spans.push(wallSpan(1, 0, 1, 1, 'v'));
  }
  return spans;
}

function wallSpan(x0, y0, x1, y1, axis) {
  if (axis === 'h') return { x0, y0, x1: x1 + WALL_SEGMENT_OVERLAP, y1, axis };
  return { x0, y0, x1, y1: y1 + WALL_SEGMENT_OVERLAP, axis };
}

function drawWallSpanPattern(pixels, zBuffer, width, height, texture, palette, pose, span) {
  const length = Math.max(1, Math.hypot(span.x1 - span.x0, span.y1 - span.y0));
  const faceShade = wallFaceShade(pose, span.axis, false);
  const world = [
    { x: span.x0, y: span.y0, z: 0, u: 0, v: 1 },
    { x: span.x1, y: span.y1, z: 0, u: length, v: 1 },
    { x: span.x1, y: span.y1, z: 1, u: length, v: 0 },
    { x: span.x0, y: span.y0, z: 1, u: 0, v: 0 },
  ];
  const clipped = clipCameraPolygon(world.map((point) => toCameraPoint(pose, point)));
  if (clipped.length < 3) return;
  const projected = clipped.map((point) => projectCameraPoint(point, width)).filter(Boolean);
  if (projected.length < 3) return;
  for (let i = 1; i < projected.length - 1; i++) {
    rasterPatternTriangle(pixels, zBuffer, width, height, texture, palette, projected[0], projected[i], projected[i + 1], faceShade);
  }
}

function wallFaceShade(pose, axis, dark) {
  const forward = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
  const normal = axis === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const alignment = Math.abs(forward.x * normal.x + forward.y * normal.y);
  const shade = 0.52 + alignment * 0.42;
  return dark ? Math.min(shade, 0.3) : shade;
}

function toCameraPoint(pose, point) {
  const forward = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
  const right = { x: -Math.sin(pose.angle), y: Math.cos(pose.angle) };
  const dx = point.x - pose.x;
  const dy = point.y - pose.y;
  return {
    x: dx * right.x + dy * right.y,
    y: point.z - VIEW_EYE_Z,
    z: dx * forward.x + dy * forward.y,
    u: point.u,
    v: point.v,
  };
}

function clipCameraPolygon(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const aIn = a.z >= VIEW_NEAR_CLIP;
    const bIn = b.z >= VIEW_NEAR_CLIP;
    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)));
    } else if (!aIn && bIn) {
      out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)), b);
    }
  }
  return out;
}

function interpolateCameraPoint(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: VIEW_NEAR_CLIP,
    u: lerp(a.u, b.u, t),
    v: lerp(a.v, b.v, t),
  };
}

function projectCameraPoint(point, width) {
  if (point.z < VIEW_NEAR_CLIP) return null;
  const invZ = 1 / point.z;
  return {
    x: width / 2 + point.x * VIEW_PROJECT_X * invZ,
    y: VIEW_HORIZON - point.y * VIEW_PROJECT_Y * invZ,
    invZ,
    uOverZ: point.u * invZ,
    vOverZ: point.v * invZ,
  };
}

function rasterPatternTriangle(pixels, zBuffer, width, height, texture, palette, a, b, c, baseShade) {
  const area = edgeFunction(a, b, c.x, c.y);
  if (Math.abs(area) < 0.0001) return;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const sampleX = px + 0.5;
      const sampleY = py + 0.5;
      const w0 = edgeFunction(b, c, sampleX, sampleY) / area;
      const w1 = edgeFunction(c, a, sampleX, sampleY) / area;
      const w2 = edgeFunction(a, b, sampleX, sampleY) / area;
      if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
      const invZ = (a.invZ * w0) + (b.invZ * w1) + (c.invZ * w2);
      const depth = 1 / invZ;
      const index = (py * width) + px;
      if (depth > zBuffer[index] + VIEW_DEPTH_EPSILON) continue;
      const u = ((a.uOverZ * w0) + (b.uOverZ * w1) + (c.uOverZ * w2)) / invZ;
      const v = ((a.vOverZ * w0) + (b.vOverZ * w1) + (c.vOverZ * w2)) / invZ;
      const shade = Math.max(0.24, baseShade / (1 + depth * 0.08));
      pixels[index] = sampleWallPalette(texture, palette, u, v, shade);
      zBuffer[index] = Math.min(zBuffer[index], depth);
    }
  }
}

function edgeFunction(a, b, x, y) {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function patternTileRows(pixels, width, tileX, tileY) {
  const rows = [];
  const blockX = tileX * 8;
  const blockY = tileY * 8;
  for (let py = 0; py < 8; py++) {
    let row = 0;
    for (let px = 0; px < 8; px++) {
      row = ((row << 4) | (pixels[((blockY + py) * width) + blockX + px] & 15)) >>> 0;
    }
    rows.push(row >>> 0);
  }
  return rows;
}

function sampleWallPalette(texture, palette, u, v, shade) {
  const x = Math.abs(Math.floor(fractional(u) * texture.width)) % texture.width;
  const y = Math.abs(Math.floor(fractional(v) * texture.height)) % texture.height;
  const i = ((y * texture.width) + x) * 4;
  const alpha = texture.data[i + 3];
  if (alpha < 16) return 0;
  return nearestPalette(palette, texture.data[i] * shade, texture.data[i + 1] * shade, texture.data[i + 2] * shade);
}

function nearestPalette(palette, r, g, b) {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < palette.length; index++) {
    const color = palette[index];
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const score = dr * dr + dg * dg + db * db;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

function fractional(value) {
  return value - Math.floor(value);
}

function tilePaletteIndex(tileRows, tileIndex, px, py) {
  const rows = tileRows[tileIndex] || tileRows[0] || Array(8).fill(0);
  return (rows[py] >>> ((7 - px) * 4)) & 15;
}

function writeTilesetAtlas(projectDir, patterns) {
  const width = TILESET_TILES_PER_ROW * 8;
  const rows = Math.max(1, Math.ceil(patterns.tileCount / TILESET_TILES_PER_ROW));
  const height = rows * 8;
  const pixels = new Uint8Array(width * height);
  patterns.tileRows.forEach((_tile, tileIndex) => {
    const ox = (tileIndex % TILESET_TILES_PER_ROW) * 8;
    const oy = Math.floor(tileIndex / TILESET_TILES_PER_ROW) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        pixels[((oy + py) * width) + ox + px] = tilePaletteIndex(patterns.tileRows, tileIndex, px, py);
      }
    }
  });
  const outPath = path.join(projectDir, 'res', GENERATED_TILESET_REL);
  writeIndexedPng(outPath, width, height, patterns.palette || PATTERN_PALETTE, pixels);
  return outPath;
}

function writeMapAtlas(projectDir, settings, patterns) {
  const blockTileW = settings.view_tile_width;
  const blockTileH = settings.view_tile_height;
  const blockPixelW = blockTileW * 8;
  const blockPixelH = blockTileH * 8;
  const rows = Math.max(1, Math.ceil(patterns.maps.length / DUN_VIEW_PATTERN_COLUMNS));
  const width = DUN_VIEW_PATTERN_COLUMNS * blockPixelW;
  const height = rows * blockPixelH;
  const pixels = new Uint8Array(width * height);
  patterns.maps.forEach((map, patternIndex) => {
    const blockX = (patternIndex % DUN_VIEW_PATTERN_COLUMNS) * blockPixelW;
    const blockY = Math.floor(patternIndex / DUN_VIEW_PATTERN_COLUMNS) * blockPixelH;
    for (let ty = 0; ty < blockTileH; ty++) {
      for (let tx = 0; tx < blockTileW; tx++) {
        const tileIndex = map[(ty * blockTileW) + tx];
        const ox = blockX + (tx * 8);
        const oy = blockY + (ty * 8);
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            pixels[((oy + py) * width) + ox + px] = tilePaletteIndex(patterns.tileRows, tileIndex, px, py);
          }
        }
      }
    }
  });
  const outPath = path.join(projectDir, 'res', GENERATED_MAP_REL);
  writeIndexedPng(outPath, width, height, patterns.palette || PATTERN_PALETTE, pixels);
  return { outPath, columns: DUN_VIEW_PATTERN_COLUMNS, rows };
}

function updateGeneratedResources(projectDir) {
  const resPath = ensureResourcesFile(projectDir);
  const generatedLines = [
    GENERATED_RESOURCE_BEGIN,
    `PALETTE dungeon_view_palette "${GENERATED_TILESET_REL}"`,
    `TILESET dungeon_view_tileset "${GENERATED_TILESET_REL}" NONE ALL`,
    `TILEMAP dungeon_view_tilemap "${GENERATED_MAP_REL}" dungeon_view_tileset NONE ALL 0`,
    GENERATED_RESOURCE_END,
  ];
  const current = fs.existsSync(resPath) ? fs.readFileSync(resPath, 'utf-8') : '';
  const blockPattern = new RegExp(`${escapeForRegExp(GENERATED_RESOURCE_BEGIN)}[\\s\\S]*?${escapeForRegExp(GENERATED_RESOURCE_END)}\\n?`, 'm');
  const nextBlock = `${generatedLines.join('\n')}\n`;
  const next = blockPattern.test(current)
    ? current.replace(blockPattern, nextBlock)
    : `${current.replace(/\s*$/u, '')}${current.trim() ? '\n\n' : ''}${nextBlock}`;
  fs.writeFileSync(resPath, next, 'utf-8');
  return resPath;
}

function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exportSource(projectDir, floors) {
  const outPath = path.join(projectDir, 'src', 'dungeon_data.c');
  const chunks = [
    '/* Generated by dungeon-game-editor */',
    '#include "dungeon_data.h"',
    '',
  ];
  floors.forEach((floor, index) => {
    const flat = floor.cells.flat();
    chunks.push(
      `static const u16 dungeon_floor_${index + 1}_edges[${flat.length}] = {`,
      cArray(flat.map(edgeValue)),
      '};',
      `static const u8 dungeon_floor_${index + 1}_flags[${flat.length}] = {`,
      cArray(flat.map(flagValue)),
      '};',
      '',
    );
  });
  chunks.push(`const u8 dungeon_floor_count = ${floors.length};`);
  chunks.push(`const DungeonFloorData dungeon_floors[DUNGEON_FLOOR_COUNT] = {`);
  floors.forEach((floor, index) => {
    const startDir = clampInt(floor.start.dir, 0, 3, 1);
    chunks.push(`    { ${floor.width}, ${floor.height}, ${floor.start.x}, ${floor.start.y}, ${startDir}, dungeon_floor_${index + 1}_edges, dungeon_floor_${index + 1}_flags },`);
  });
  chunks.push('};', '');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, chunks.join('\n'), 'utf-8');
  return outPath;
}

function exportPatternInfo(projectDir, floors) {
  const headerPath = path.join(projectDir, 'inc', 'dungeon_patterns.h');
  const sourcePath = path.join(projectDir, 'src', 'dungeon_patterns.c');
  const settings = readSettings(projectDir);
  const wallTexture = loadWallTexture(projectDir, floors[0]);
  const patterns = buildPatternAssets(settings, wallTexture);
  const tilesetPath = writeTilesetAtlas(projectDir, patterns);
  const mapInfo = writeMapAtlas(projectDir, settings, patterns);
  const resourcePath = updateGeneratedResources(projectDir);
  const headerLines = [
    '/* Generated by dungeon-game-editor */',
    '#ifndef _DUNGEON_PATTERNS_H_',
    '#define _DUNGEON_PATTERNS_H_',
    '',
    '#include <genesis.h>',
    '',
    `#define DUN_VIEW_TILE_W ${settings.view_tile_width}`,
    `#define DUN_VIEW_TILE_H ${settings.view_tile_height}`,
    `#define DUN_VIEW_PIXEL_W ${settings.view_pixel_width}`,
    `#define DUN_VIEW_PIXEL_H ${settings.view_pixel_height}`,
    `#define DUN_ANIMATION_FRAMES ${settings.animation_frames}`,
    `#define DUN_ANIMATION_STEP_VBLANKS ${DUN_ANIMATION_STEP_VBLANKS}`,
    `#define DUN_WALL_PHASE_COUNT ${WALL_PHASE_COUNT}`,
    `#define DUN_WALL_VIEW_COUNT ${WALL_VIEW_COUNT}`,
    '#define DUN_VIEW_PATTERN_COUNT (DUN_WALL_VIEW_COUNT * DUN_WALL_PHASE_COUNT)',
    `#define DUN_VIEW_PATTERN_COLUMNS ${mapInfo.columns}`,
    `#define DUN_VIEW_PATTERN_ROWS ${mapInfo.rows}`,
    '#define DUN_VIEW_PATTERN_BLOCK_TILE_W DUN_VIEW_TILE_W',
    '#define DUN_VIEW_PATTERN_BLOCK_TILE_H DUN_VIEW_TILE_H',
    `#define DUN_PATTERN_TILE_COUNT ${patterns.tileCount}`,
    '',
    'extern const u16 dungeon_view_pattern_count;',
    '',
    '#endif /* _DUNGEON_PATTERNS_H_ */',
    '',
  ];
  const sourceLines = [
    '/* Generated by dungeon-game-editor */',
    '#include "dungeon_patterns.h"',
    '',
    'const u16 dungeon_view_pattern_count = DUN_VIEW_PATTERN_COUNT;',
    '',
  ];
  ensureDir(path.dirname(headerPath));
  ensureDir(path.dirname(sourcePath));
  fs.writeFileSync(headerPath, headerLines.join('\n'), 'utf-8');
  fs.writeFileSync(sourcePath, sourceLines.join('\n'), 'utf-8');
  return {
    headerPath,
    sourcePath,
    tileCount: patterns.tileCount,
    tilesetPath,
    mapPath: mapInfo.outPath,
    resourcePath,
  };
}

function exportDungeonData(projectDir) {
  ensureDir(getFloorsDir(projectDir));
  ensureResourcesFile(projectDir);
  let floors = loadFloors(projectDir).map((entry) => entry.floor);
  if (!floors.length) {
    floors = [makeGeneratedFloor({ width: 12, height: 12, name: 'Floor 1', order: 1 })];
    writeJson(floorFilePath(projectDir, floors[0]), floors[0]);
  }
  const headerPath = exportHeader(projectDir, floors);
  const sourcePath = exportSource(projectDir, floors);
  const pattern = exportPatternInfo(projectDir, floors);
  return {
    ok: true,
    floorCount: floors.length,
    headerPath,
    sourcePath,
    patternPath: pattern.headerPath,
    patternSourcePath: pattern.sourcePath,
    patternTileCount: pattern.tileCount,
    patternTilesetPath: pattern.tilesetPath,
    patternMapPath: pattern.mapPath,
    resourcePath: pattern.resourcePath,
  };
}

function listFloors(projectDir) {
  ensureDir(getFloorsDir(projectDir));
  ensureResourcesFile(projectDir);
  return {
    ok: true,
    floors: loadFloors(projectDir).map((entry) => entry.floor),
    settings: readSettings(projectDir),
    maxSize: MAX_SIZE,
    defaultAssets: DEFAULT_ASSETS,
  };
}

function saveFloor(projectDir, payload = {}) {
  ensureDir(getFloorsDir(projectDir));
  const current = loadFloors(projectDir).map((entry) => entry.floor);
  const isCreate = Boolean(payload.create) || !payload.floor?.id;
  const nextOrder = current.length + 1;
  const fallbackName = isCreate ? makeNextFloorName(current) : `Floor ${payload.floor?.order || nextOrder}`;
  const floor = normalizeFloor(payload.floor || {}, payload.floor?.order || nextOrder, fallbackName);
  if (isCreate && (!payload.floor?.name || /Floor\s*\d+$/i.test(String(payload.floor.name)))) floor.name = fallbackName;
  if (isCreate && !payload.floor?.order) floor.order = nextOrder;
  const existing = findFloorFile(projectDir, floor.id);
  const filePath = floorFilePath(projectDir, floor, existing);
  writeJson(filePath, floor);
  return { ok: true, floor, filePath, export: exportDungeonData(projectDir) };
}

function deleteFloor(projectDir, payload = {}) {
  const id = String(payload.id || payload.floorId || '').trim();
  if (!id) return { ok: false, error: 'floor id is required' };
  const entries = loadFloors(projectDir);
  const target = entries.find((entry) => entry.floor.id === id);
  if (!target) return { ok: false, error: `floor not found: ${id}` };
  fs.unlinkSync(target.filePath);
  loadFloors(projectDir).forEach((entry, index) => {
    writeJson(entry.filePath, { ...entry.floor, order: index + 1 });
  });
  return { ok: true, deletedId: id, export: exportDungeonData(projectDir) };
}

function moveFloor(projectDir, payload = {}) {
  const id = String(payload.id || payload.floorId || '').trim();
  const direction = String(payload.direction || '').toLowerCase();
  if (!id) return { ok: false, error: 'floor id is required' };
  if (direction !== 'up' && direction !== 'down') return { ok: false, error: 'direction must be up or down' };
  const entries = loadFloors(projectDir);
  const fromIndex = entries.findIndex((entry) => entry.floor.id === id);
  if (fromIndex < 0) return { ok: false, error: `floor not found: ${id}` };
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= entries.length) return { ok: true, moved: false, floor: entries[fromIndex].floor };
  const nextEntries = entries.slice();
  const [moved] = nextEntries.splice(fromIndex, 1);
  nextEntries.splice(toIndex, 0, moved);
  let movedFloor = moved.floor;
  nextEntries.forEach((entry, index) => {
    const next = { ...entry.floor, order: index + 1 };
    if (entry.floor.id === id) movedFloor = next;
    writeJson(entry.filePath, next);
  });
  return { ok: true, moved: true, floor: movedFloor, export: exportDungeonData(projectDir) };
}

function generateFloor(projectDir, payload = {}) {
  const current = loadFloors(projectDir).map((entry) => entry.floor);
  const order = clampInt(payload.order, 1, 999, current.length + 1);
  const floor = makeGeneratedFloor({
    ...payload,
    order,
    name: payload.name || makeNextFloorName(current),
  });
  const filePath = floorFilePath(projectDir, floor, findFloorFile(projectDir, floor.id));
  writeJson(filePath, floor);
  return { ok: true, floor, filePath, export: exportDungeonData(projectDir) };
}

function listSettings(projectDir) {
  ensureDir(getDungeonDir(projectDir));
  ensureResourcesFile(projectDir);
  return { ok: true, settings: readSettings(projectDir), defaultAssets: DEFAULT_ASSETS };
}

function saveSettings(projectDir, payload = {}) {
  const incoming = payload.settings && typeof payload.settings === 'object' ? payload.settings : payload;
  const settings = normalizeSettings({ ...readSettings(projectDir), ...incoming });
  writeJson(getSettingsPath(projectDir), settings);
  return { ok: true, settings, export: exportDungeonData(projectDir) };
}

module.exports = {
  MAX_SIZE,
  MIN_SIZE,
  DIRS,
  DIR_INDEX,
  DEFAULT_ASSETS,
  DEFAULT_SETTINGS,
  normalizeFloor,
  normalizeSettings,
  makeGeneratedFloor,
  listFloors,
  saveFloor,
  deleteFloor,
  moveFloor,
  generateFloor,
  exportDungeonData,
  listSettings,
  saveSettings,
  hasEdge,
};
