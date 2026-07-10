'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const core = require('./render-core.js');

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
  turn_frames: 8,
  view_tile_width: 25,
  view_tile_height: 16,
  view_pixel_width: 200,
  view_pixel_height: 128,
};
const DEFAULT_ASSETS = {
  wall_texture: 'dungeon/textures/dungeon_texture_atlas.png#wall',
  door_texture: 'dungeon/textures/dungeon_texture_atlas.png#door',
  floor_texture: 'dungeon/textures/dungeon_texture_atlas.png#floor',
  ceiling_texture: 'dungeon/textures/dungeon_texture_atlas.png#ceiling',
  chest_texture: 'dungeon/textures/dungeon_texture_atlas.png#chest',
  stairs_up_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_up',
  stairs_down_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_down',
};
const DUN_ANIMATION_STEP_VBLANKS = 2;
const TILESET_TILES_PER_ROW = 32;
const PATTERN_TEXTURE_MAX_SIZE = 96;
const GENERATED_RESOURCE_BEGIN = '// DUNGEON_GENERATED_BEGIN';
const GENERATED_RESOURCE_END = '// DUNGEON_GENERATED_END';
const GENERATED_TILESET_REL = 'dungeon/generated/dungeon_view_tileset.png';
const GENERATED_LEGACY_MAP_REL = 'dungeon/generated/dungeon_view_map.png';
const GENERATED_BB_SHEETS = {
  chest: 'dungeon/generated/dungeon_bb_chest.png',
  stairs_up: 'dungeon/generated/dungeon_bb_stairs_up.png',
  stairs_down: 'dungeon/generated/dungeon_bb_stairs_down.png',
};
const BAKE_CACHE_REL = 'dungeon/generated/dungeon_bake_cache.json';
const BUDGET_TILE_WARN = 40000;
const BUDGET_NODE_WORDS_WARN = 24000;
const BUDGET_TOTAL_BYTES_WARN = 1536 * 1024;
const DARK_PALETTE_SCALE = 0.35;

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
  const animationFrames = clampInt(incoming.animation_frames, 2, 8, DEFAULT_SETTINGS.animation_frames);
  return {
    animation_frames: animationFrames,
    turn_frames: clampInt(incoming.turn_frames, 2, 8, animationFrames),
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

/* ==================================================================
 * PNG 入出力
 * ================================================================== */

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

/* ==================================================================
 * テクスチャ読み込み (アトラス + サイドカー + フォールバック)
 * ================================================================== */

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

function atlasSidecarPath(imagePath) {
  return imagePath.replace(/\.png$/i, '.json');
}

function cropTexture(image, tag, layout) {
  const coords = layout.rects[tag];
  if (!coords) return null;
  const cellW = Math.max(1, Math.floor(image.width / layout.columns));
  const cellH = Math.max(1, Math.floor(image.height / layout.rows));
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

function resizeTextureForPatterns(texture, maxSize = PATTERN_TEXTURE_MAX_SIZE) {
  const scale = Math.min(1, maxSize / Math.max(texture.width, texture.height));
  if (scale >= 1) return texture;
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

/*
 * フロアのアセット参照から描画用テクスチャ一式を読み込む。
 * アトラス PNG は path ごとに 1 回だけパースし、サイドカー
 * <atlas>.json ({"columns":4,"rows":2}) があれば扉付きレイアウトで切り出す。
 * タグ未定義 (旧 3x2 アトラスの door 等) は手続き生成にフォールバックする。
 */
function loadViewTextures(projectDir, floor) {
  const refs = { ...DEFAULT_ASSETS, ...(floor?.assets || {}) };
  const atlasCache = new Map();
  const textures = {};
  core.TEXTURE_KINDS.forEach((kind) => {
    const ref = parseTextureRef(refs[`${kind}_texture`] || DEFAULT_ASSETS[`${kind}_texture`]);
    const imagePath = resolveAssetPath(projectDir, ref.assetPath);
    let texture = null;
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        let atlas = atlasCache.get(imagePath);
        if (!atlas) {
          atlas = {
            image: parsePng(imagePath),
            layout: core.atlasLayoutFor(readJson(atlasSidecarPath(imagePath), null)),
          };
          atlasCache.set(imagePath, atlas);
        }
        const cropped = cropTexture(atlas.image, ref.tag || kind, atlas.layout);
        if (cropped) texture = resizeTextureForPatterns(cropped);
      } catch (_) {
        texture = null;
      }
    }
    textures[kind] = texture || core.makeFallbackTexture(kind);
  });
  return textures;
}

/* ==================================================================
 * SGDK エクスポート: フロアデータ (dungeon_data.h / dungeon_data.c)
 * ================================================================== */

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

/* ==================================================================
 * SGDK エクスポート: ビューデータ (デシジョンテーブル + タイルセット)
 * ================================================================== */

function buildViewExport(settings, textures) {
  const spaces = core.buildEdgeSpaces(settings);
  const palette = core.buildViewPalette(textures);
  const bands = core.buildBandTables(palette, textures);
  const pool = core.makeTilePool();
  const warnings = [];

  const staticFrame = core.bakeFrame(spaces.frames.staticPose, spaces.move, textures, palette, bands, pool);
  const fwdFrames = spaces.frames.fwdPoses.map((pose) => (
    core.bakeFrame(pose, spaces.move, textures, palette, bands, pool)
  ));
  const turnFrames = spaces.frames.turnPoses.map((pose) => (
    core.bakeFrame(pose, spaces.turn, textures, palette, bands, pool)
  ));

  const spritePalette = core.buildSpritePalette(textures);
  const sheets = {
    chest: core.renderBillboardSheet(textures.chest, spritePalette),
    stairs_up: core.renderBillboardSheet(textures.stairs_up, spritePalette),
    stairs_down: core.renderBillboardSheet(textures.stairs_down, spritePalette),
  };
  const billboards = core.buildBillboardTables(settings);

  const allFrames = [staticFrame, ...fwdFrames, ...turnFrames];
  const nodeWordsMax = Math.max(...allFrames.map((frame) => frame.stats.nodeWords));
  const nodeWordsTotal = allFrames.reduce((sum, frame) => sum + frame.stats.nodeWords, 0);
  const tableBytes = allFrames.reduce((sum, frame) => (
    sum + (frame.offsets.length + frame.nodes.length + frame.tileMap.length) * 2 + frame.tileMap.length
  ), 0);
  const tileBytes = pool.count * 32;
  const totalBytes = tileBytes + tableBytes;

  if (pool.count > BUDGET_TILE_WARN) {
    warnings.push(`タイル数が多すぎます (${pool.count} > ${BUDGET_TILE_WARN})。テクスチャを単純化するかフレーム数を減らしてください。`);
  }
  if (nodeWordsMax > BUDGET_NODE_WORDS_WARN) {
    warnings.push(`デシジョンテーブルが大きすぎます (${nodeWordsMax} words/frame > ${BUDGET_NODE_WORDS_WARN})。`);
  }
  if (totalBytes > BUDGET_TOTAL_BYTES_WARN) {
    warnings.push(`ダンジョンビューの生成データが ${(totalBytes / 1024).toFixed(0)}KB あります (推奨 ${(BUDGET_TOTAL_BYTES_WARN / 1024).toFixed(0)}KB 以下)。`);
  }

  return {
    settings,
    spaces,
    palette,
    bands,
    pool,
    staticFrame,
    fwdFrames,
    turnFrames,
    spritePalette,
    sheets,
    billboards,
    budget: {
      tileCount: pool.count,
      tileBytes,
      nodeWordsMax,
      nodeWordsTotal,
      tableBytes,
      totalBytes,
    },
    warnings,
  };
}

function tilePaletteIndex(tileRows, tileIndex, px, py) {
  const rows = tileRows[tileIndex] || [0, 0, 0, 0, 0, 0, 0, 0];
  return (rows[py] >>> ((7 - px) * 4)) & 15;
}

function writeTilesetAtlas(projectDir, pool, palette) {
  const width = TILESET_TILES_PER_ROW * 8;
  const rows = Math.max(1, Math.ceil(pool.count / TILESET_TILES_PER_ROW));
  const height = rows * 8;
  const pixels = new Uint8Array(width * height);
  pool.rows.forEach((_tile, tileIndex) => {
    const ox = (tileIndex % TILESET_TILES_PER_ROW) * 8;
    const oy = Math.floor(tileIndex / TILESET_TILES_PER_ROW) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        pixels[((oy + py) * width) + ox + px] = tilePaletteIndex(pool.rows, tileIndex, px, py);
      }
    }
  });
  const outPath = path.join(projectDir, 'res', GENERATED_TILESET_REL);
  writeIndexedPng(outPath, width, height, palette, pixels);
  return outPath;
}

function writeBillboardSheets(projectDir, sheets, spritePalette) {
  const paths = {};
  Object.entries(GENERATED_BB_SHEETS).forEach(([kind, rel]) => {
    const sheet = sheets[kind];
    const outPath = path.join(projectDir, 'res', rel);
    writeIndexedPng(outPath, sheet.width, sheet.height, spritePalette, sheet.pixels);
    paths[kind] = outPath;
  });
  return paths;
}

function updateGeneratedResources(projectDir) {
  const resPath = ensureResourcesFile(projectDir);
  const generatedLines = [
    GENERATED_RESOURCE_BEGIN,
    `PALETTE dungeon_view_palette "${GENERATED_TILESET_REL}"`,
    `TILESET dungeon_view_tileset "${GENERATED_TILESET_REL}" NONE ALL`,
    `PALETTE dungeon_bb_palette "${GENERATED_BB_SHEETS.chest}"`,
    `SPRITE dungeon_bb_chest "${GENERATED_BB_SHEETS.chest}" ${core.BB_FRAME_TILES} ${core.BB_FRAME_TILES} NONE 0`,
    `SPRITE dungeon_bb_stairs_up "${GENERATED_BB_SHEETS.stairs_up}" ${core.BB_FRAME_TILES} ${core.BB_FRAME_TILES} NONE 0`,
    `SPRITE dungeon_bb_stairs_down "${GENERATED_BB_SHEETS.stairs_down}" ${core.BB_FRAME_TILES} ${core.BB_FRAME_TILES} NONE 0`,
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

/* ==================================================================
 * SGDK エクスポート: dungeon_patterns.h / dungeon_patterns.c
 * ================================================================== */

function cHexU16Array(name, values, isStatic = true) {
  const lines = [`${isStatic ? 'static ' : ''}const u16 ${name}[${values.length}] = {`];
  for (let index = 0; index < values.length; index += 12) {
    const slice = Array.from(values.slice(index, index + 12));
    lines.push(`    ${slice.map((value) => `0x${(value & 0xffff).toString(16).padStart(4, '0')}`).join(', ')}${index + 12 >= values.length ? '' : ','}`);
  }
  lines.push('};');
  return lines;
}

function cU8Array(name, values, isStatic = true) {
  const lines = [`${isStatic ? 'static ' : ''}const u8 ${name}[${values.length}] = {`];
  for (let index = 0; index < values.length; index += 16) {
    const slice = Array.from(values.slice(index, index + 16));
    lines.push(`    ${slice.join(', ')}${index + 16 >= values.length ? '' : ','}`);
  }
  lines.push('};');
  return lines;
}

function cEdgeDefArray(name, defs) {
  const lines = [`const DunEdgeDef ${name}[${defs.length}] = {`];
  defs.forEach((def, index) => {
    lines.push(`    { ${def.dd}, ${def.dl}, ${def.face} }${index === defs.length - 1 ? '' : ','}`);
  });
  lines.push('};');
  return lines;
}

function emitFrameTable(lines, prefix, frame) {
  const nodes = frame.nodes.length ? frame.nodes : Uint16Array.from([0]);
  lines.push(...cHexU16Array(`${prefix}_off`, frame.offsets));
  lines.push(...cHexU16Array(`${prefix}_nodes`, nodes));
  lines.push(...cHexU16Array(`${prefix}_tiles`, frame.tileMap.map((ref) => ref.index)));
  lines.push(...cU8Array(`${prefix}_flips`, frame.tileMap.map((ref) => ref.flips)));
  return `{ ${prefix}_off, ${prefix}_nodes, ${prefix}_tiles, ${prefix}_flips }`;
}

function emitBillboardPoseRows(poses) {
  return poses.map((pose) => `{ ${pose.x}, ${pose.y}, ${pose.frame} }`).join(', ');
}

function exportPatternFiles(projectDir, view) {
  const headerPath = path.join(projectDir, 'inc', 'dungeon_patterns.h');
  const sourcePath = path.join(projectDir, 'src', 'dungeon_patterns.c');
  const { spaces, billboards, settings } = view;
  const fwdCount = view.fwdFrames.length;
  const turnCount = view.turnFrames.length;
  const bbCells = billboards.cells;

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
    '#define DUN_VIEW_TILE_COUNT (DUN_VIEW_TILE_W * DUN_VIEW_TILE_H)',
    `#define DUN_ANIMATION_FRAMES ${settings.animation_frames}`,
    `#define DUN_TURN_ANIMATION_FRAMES ${settings.turn_frames}`,
    `#define DUN_ANIMATION_STEP_VBLANKS ${DUN_ANIMATION_STEP_VBLANKS}`,
    `#define DUN_FWD_FRAMES ${fwdCount}`,
    `#define DUN_TURN_FRAMES ${turnCount}`,
    `#define DUN_MOVE_EDGE_COUNT ${spaces.move.length}`,
    `#define DUN_TURN_EDGE_COUNT ${spaces.turn.length}`,
    '#define DUN_EDGE_STATE_MAX 128',
    `#define DUN_TILESET_TILE_COUNT ${view.pool.count}`,
    `#define DUN_BB_CELL_COUNT ${bbCells.length}`,
    `#define DUN_BB_FRAME_TILES ${core.BB_FRAME_TILES}`,
    `#define DUN_BB_FRAME_COUNT ${core.BB_BUCKET_HEIGHTS.length}`,
    '',
    'typedef struct { s8 dd; s8 dl; u8 face; } DunEdgeDef;',
    'typedef struct { s8 dd; s8 dl; } DunBBCell;',
    'typedef struct { s16 x; s16 y; s8 frame; } DunBBPose;',
    'typedef struct {',
    '    const u16 *offsets;    /* [DUN_VIEW_TILE_COUNT] bit15=葉 */',
    '    const u16 *nodes;      /* [edgeId, open, wall, door] の u16 ストリーム */',
    '    const u16 *tile_map;   /* ローカルID → グローバルタイル番号 */',
    '    const u8 *tile_flips;  /* ローカルID → bit0=HFLIP, bit1=VFLIP */',
    '} DunFrameTable;',
    '',
    'extern const DunEdgeDef dun_edges_move[DUN_MOVE_EDGE_COUNT];',
    'extern const DunEdgeDef dun_edges_turn[DUN_TURN_EDGE_COUNT];',
    'extern const DunEdgeDef dun_edges_turn_mirrored[DUN_TURN_EDGE_COUNT];',
    'extern const DunFrameTable dun_frame_static;',
    'extern const DunFrameTable dun_frames_fwd[DUN_FWD_FRAMES];',
    'extern const DunFrameTable dun_frames_turn[DUN_TURN_FRAMES];',
    'extern const DunBBCell dun_bb_cells[DUN_BB_CELL_COUNT];',
    'extern const DunBBPose dun_bb_static[DUN_BB_CELL_COUNT];',
    'extern const DunBBPose dun_bb_fwd[DUN_FWD_FRAMES][DUN_BB_CELL_COUNT];',
    'extern const DunBBPose dun_bb_turn[DUN_TURN_FRAMES][DUN_BB_CELL_COUNT];',
    'extern const u16 dun_palette_dark[16];',
    '',
    '#endif /* _DUNGEON_PATTERNS_H_ */',
    '',
  ];

  const lines = [
    '/* Generated by dungeon-game-editor */',
    '#include "dungeon_patterns.h"',
    '',
  ];

  lines.push(...cEdgeDefArray('dun_edges_move', spaces.move));
  lines.push(...cEdgeDefArray('dun_edges_turn', spaces.turn));
  lines.push(...cEdgeDefArray('dun_edges_turn_mirrored', spaces.turnMirrored));
  lines.push('');

  const staticRef = emitFrameTable(lines, 'dun_dt_static', view.staticFrame);
  lines.push(`const DunFrameTable dun_frame_static = ${staticRef};`, '');

  const fwdRefs = view.fwdFrames.map((frame, index) => emitFrameTable(lines, `dun_dt_fwd_${index}`, frame));
  lines.push(`const DunFrameTable dun_frames_fwd[DUN_FWD_FRAMES] = {`);
  fwdRefs.forEach((ref, index) => lines.push(`    ${ref}${index === fwdRefs.length - 1 ? '' : ','}`));
  lines.push('};', '');

  const turnRefs = view.turnFrames.map((frame, index) => emitFrameTable(lines, `dun_dt_turn_${index}`, frame));
  lines.push(`const DunFrameTable dun_frames_turn[DUN_TURN_FRAMES] = {`);
  turnRefs.forEach((ref, index) => lines.push(`    ${ref}${index === turnRefs.length - 1 ? '' : ','}`));
  lines.push('};', '');

  lines.push(`const DunBBCell dun_bb_cells[DUN_BB_CELL_COUNT] = {`);
  bbCells.forEach((cell, index) => {
    lines.push(`    { ${cell.dd}, ${cell.dl} }${index === bbCells.length - 1 ? '' : ','}`);
  });
  lines.push('};', '');

  lines.push(`const DunBBPose dun_bb_static[DUN_BB_CELL_COUNT] = {`);
  lines.push(`    ${emitBillboardPoseRows(billboards.staticPoses)}`);
  lines.push('};', '');

  lines.push(`const DunBBPose dun_bb_fwd[DUN_FWD_FRAMES][DUN_BB_CELL_COUNT] = {`);
  billboards.fwdPoses.forEach((poses, index) => {
    lines.push(`    { ${emitBillboardPoseRows(poses)} }${index === billboards.fwdPoses.length - 1 ? '' : ','}`);
  });
  lines.push('};', '');

  lines.push(`const DunBBPose dun_bb_turn[DUN_TURN_FRAMES][DUN_BB_CELL_COUNT] = {`);
  billboards.turnPoses.forEach((poses, index) => {
    lines.push(`    { ${emitBillboardPoseRows(poses)} }${index === billboards.turnPoses.length - 1 ? '' : ','}`);
  });
  lines.push('};', '');

  const darkColors = core.paletteToVdpColors(core.darkenPalette(view.palette, DARK_PALETTE_SCALE));
  lines.push(...cHexU16Array('dun_palette_dark', darkColors, false));
  lines.push('');

  ensureDir(path.dirname(headerPath));
  ensureDir(path.dirname(sourcePath));
  fs.writeFileSync(headerPath, headerLines.join('\n'), 'utf-8');
  fs.writeFileSync(sourcePath, lines.join('\n'), 'utf-8');
  return { headerPath, sourcePath };
}

/* ==================================================================
 * ビューエクスポート統括 (キャッシュ付き)
 * ================================================================== */

function computeBakeHash(projectDir, floor, settings) {
  const hash = crypto.createHash('sha1');
  hash.update(`core:${core.version}`);
  hash.update(JSON.stringify({
    animation_frames: settings.animation_frames,
    turn_frames: settings.turn_frames,
  }));
  hash.update(JSON.stringify(floor?.assets || {}));
  const refs = { ...DEFAULT_ASSETS, ...(floor?.assets || {}) };
  const seen = new Set();
  Object.values(refs).forEach((ref) => {
    const imagePath = resolveAssetPath(projectDir, parseTextureRef(ref).assetPath);
    if (!imagePath || seen.has(imagePath)) return;
    seen.add(imagePath);
    try {
      hash.update(fs.readFileSync(imagePath));
      const sidecar = atlasSidecarPath(imagePath);
      if (fs.existsSync(sidecar)) hash.update(fs.readFileSync(sidecar));
    } catch (_) {
      hash.update('missing');
    }
  });
  return hash.digest('hex');
}

function viewOutputPaths(projectDir) {
  return [
    path.join(projectDir, 'inc', 'dungeon_patterns.h'),
    path.join(projectDir, 'src', 'dungeon_patterns.c'),
    path.join(projectDir, 'res', GENERATED_TILESET_REL),
    ...Object.values(GENERATED_BB_SHEETS).map((rel) => path.join(projectDir, 'res', rel)),
  ];
}

function exportViewAssets(projectDir, floors) {
  const settings = readSettings(projectDir);
  const floor = floors[0];
  const bakeHash = computeBakeHash(projectDir, floor, settings);
  const cachePath = path.join(projectDir, 'res', BAKE_CACHE_REL);
  const cached = readJson(cachePath, null);
  const outputsExist = viewOutputPaths(projectDir).every((filePath) => fs.existsSync(filePath));
  if (cached && cached.hash === bakeHash && cached.summary && outputsExist) {
    updateGeneratedResources(projectDir);
    return { ...cached.summary, cached: true };
  }

  const textures = loadViewTextures(projectDir, floor);
  const view = buildViewExport(settings, textures);
  const tilesetPath = writeTilesetAtlas(projectDir, view.pool, view.palette);
  const sheetPaths = writeBillboardSheets(projectDir, view.sheets, view.spritePalette);
  const { headerPath, sourcePath } = exportPatternFiles(projectDir, view);
  const resourcePath = updateGeneratedResources(projectDir);

  const legacyMapPath = path.join(projectDir, 'res', GENERATED_LEGACY_MAP_REL);
  try {
    if (fs.existsSync(legacyMapPath)) fs.rmSync(legacyMapPath);
  } catch (_) { /* 旧ファイル削除は失敗しても致命的でない */ }

  const summary = {
    headerPath,
    sourcePath,
    tilesetPath,
    sheetPaths,
    resourcePath,
    tileCount: view.pool.count,
    moveEdgeCount: view.spaces.move.length,
    turnEdgeCount: view.spaces.turn.length,
    fwdFrameCount: view.fwdFrames.length,
    turnFrameCount: view.turnFrames.length,
    budget: view.budget,
    warnings: view.warnings,
  };
  writeJson(cachePath, { hash: bakeHash, summary });
  return { ...summary, cached: false };
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
  const view = exportViewAssets(projectDir, floors);
  return {
    ok: true,
    floorCount: floors.length,
    headerPath,
    sourcePath,
    patternPath: view.headerPath,
    patternSourcePath: view.sourcePath,
    patternTileCount: view.tileCount,
    patternTilesetPath: view.tilesetPath,
    resourcePath: view.resourcePath,
    budget: view.budget,
    warnings: view.warnings,
    cached: view.cached,
  };
}

/* ==================================================================
 * フロア CRUD / 設定
 * ================================================================== */

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
  /* テスト・内部利用向け */
  buildViewExport,
  loadViewTextures,
  exportViewAssets,
  computeBakeHash,
  renderCore: core,
};
