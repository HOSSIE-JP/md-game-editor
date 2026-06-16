export const DEFAULT_TILEMAP = {
  name: 'map001',
  width: 40,
  height: 28,
  tileWidth: 8,
  tileHeight: 8,
  tilesetName: 'tileset001',
  tilesetImage: 'tileset001.png',
  tilesetColumns: 1,
  tilesetTileCount: 1,
  layers: [
    { name: 'Ground', visible: true, opacity: 1, priority: false, data: [] },
  ],
};

export const COLLISION_TYPES = [
  { value: 0, id: 'none', label: 'None', description: '判定なし。通常どおり通過できます' },
  { value: 1, id: 'solid', label: 'Solid', description: '通行不可の壁・床として扱います' },
  { value: 2, id: 'platform', label: 'Platform', description: '上から乗れる一方向床として扱います' },
  { value: 3, id: 'ladder', label: 'Ladder', description: 'はしご・登れる領域として扱います' },
  { value: 4, id: 'damage', label: 'Damage', description: 'ダメージ床・危険領域として扱います' },
];

export function normalizeSymbolName(value, fallback = 'map001') {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || fallback;
}

export function isCollisionLayerName(value) {
  return /^collision(?::|$)/i.test(String(value || '').trim());
}

export function createBlankTilemap(options = {}) {
  const width = clampInt(options.width, 1, 512, DEFAULT_TILEMAP.width);
  const height = clampInt(options.height, 1, 512, DEFAULT_TILEMAP.height);
  const tileWidth = clampInt(options.tileWidth, 8, 64, DEFAULT_TILEMAP.tileWidth);
  const tileHeight = clampInt(options.tileHeight, 8, 64, DEFAULT_TILEMAP.tileHeight);
  const name = normalizeSymbolName(options.name, DEFAULT_TILEMAP.name);
  const tilesetName = normalizeSymbolName(options.tilesetName || `${name}_tiles`, 'tileset001');
  const baseLayer = {
    name: String(options.layerName || 'Ground'),
    visible: true,
    opacity: 1,
    priority: false,
    collision: false,
    data: new Array(width * height).fill(0),
  };
  return {
    ...DEFAULT_TILEMAP,
    name,
    width,
    height,
    tileWidth,
    tileHeight,
    tilesetName,
    tilesetImage: `${tilesetName}.png`,
    tilesets: [{ firstgid: 1, source: `../tilesets/${tilesetName}.tsx` }],
    tilesetColumns: 1,
    tilesetTileCount: 1,
    layers: [baseLayer],
    warnings: [],
  };
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function buildTsx(map) {
  const tileWidth = clampInt(map.tileWidth, 1, 1024, DEFAULT_TILEMAP.tileWidth);
  const tileHeight = clampInt(map.tileHeight, 1, 1024, DEFAULT_TILEMAP.tileHeight);
  const columns = Math.max(1, Number(map.tilesetColumns) || 1);
  const tileCount = Math.max(1, Number(map.tilesetTileCount) || columns);
  const image = String(map.tilesetImage || `${map.tilesetName || 'tileset001'}.png`);
  const width = Math.max(tileWidth, Number(map.tilesetImageWidth) || columns * tileWidth);
  const rows = Math.max(1, Math.ceil(tileCount / columns));
  const height = Math.max(tileHeight, Number(map.tilesetImageHeight) || rows * tileHeight);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="1.10" tiledversion="1.10.2" name="${escapeXml(map.tilesetName || 'tileset001')}" tilewidth="${tileWidth}" tileheight="${tileHeight}" tilecount="${tileCount}" columns="${columns}">`,
    ` <image source="${escapeXml(image)}" width="${width}" height="${height}"/>`,
    '</tileset>',
    '',
  ].join('\n');
}

export function buildTmx(map) {
  const width = clampInt(map.width, 1, 4096, DEFAULT_TILEMAP.width);
  const height = clampInt(map.height, 1, 4096, DEFAULT_TILEMAP.height);
  const tileWidth = clampInt(map.tileWidth, 1, 1024, DEFAULT_TILEMAP.tileWidth);
  const tileHeight = clampInt(map.tileHeight, 1, 1024, DEFAULT_TILEMAP.tileHeight);
  const tilesets = normalizeTilesets(map);
  const layers = normalizeLayers(map.layers, width, height);
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${width}" height="${height}" tilewidth="${tileWidth}" tileheight="${tileHeight}" infinite="0" nextlayerid="${layers.length + 1}" nextobjectid="1">`,
  ];

  tilesets.forEach((tileset) => {
    parts.push(` <tileset firstgid="${tileset.firstgid}" source="${escapeXml(tileset.source)}"/>`);
  });

  layers.forEach((layer, index) => {
    const visible = layer.visible === false || layer.collision ? ' visible="0"' : '';
    const opacity = Number(layer.opacity);
    const opacityAttr = Number.isFinite(opacity) && opacity >= 0 && opacity < 1 ? ` opacity="${opacity}"` : '';
    parts.push(` <layer id="${index + 1}" name="${escapeXml(layer.name)}" width="${width}" height="${height}"${visible}${opacityAttr}>`);
    parts.push('  <data encoding="csv">');
    parts.push(formatCsvLayer(layer.data, width, height));
    parts.push('  </data>');
    parts.push(' </layer>');
  });

  parts.push('</map>', '');
  return parts.join('\n');
}

export function parseTsx(text) {
  const root = matchTag(text, 'tileset');
  if (!root) throw new Error('TSX tileset element not found');
  const attrs = parseAttrs(root.attrs);
  const imageTag = matchSelfClosingTag(root.body, 'image');
  const imageAttrs = imageTag ? parseAttrs(imageTag.attrs) : {};
  return {
    tilesetName: attrs.name || 'tileset001',
    tileWidth: clampInt(attrs.tilewidth, 1, 1024, DEFAULT_TILEMAP.tileWidth),
    tileHeight: clampInt(attrs.tileheight, 1, 1024, DEFAULT_TILEMAP.tileHeight),
    tilesetTileCount: clampInt(attrs.tilecount, 1, 65535, 1),
    tilesetColumns: clampInt(attrs.columns, 1, 4096, 1),
    tilesetImage: imageAttrs.source || '',
    tilesetImageWidth: clampInt(imageAttrs.width, 1, 65535, 0),
    tilesetImageHeight: clampInt(imageAttrs.height, 1, 65535, 0),
  };
}

export function parseTmx(text) {
  const warnings = [];
  const root = matchTag(text, 'map');
  if (!root) throw new Error('TMX map element not found');
  const attrs = parseAttrs(root.attrs);
  if (attrs.orientation && attrs.orientation !== 'orthogonal') {
    warnings.push(`未対応 orientation: ${attrs.orientation}`);
  }
  if (attrs.infinite === '1') {
    warnings.push('infinite map は v1 では保存対象外です');
  }
  if (/<chunk\b/i.test(root.body)) {
    warnings.push('chunked layer data は v1 では保存対象外です');
  }
  if (/<objectgroup\b/i.test(root.body)) {
    warnings.push('object layer は v1.1 候補です。読み込み時は保持しません');
  }
  if (/<imagelayer\b/i.test(root.body) || /<group\b/i.test(root.body)) {
    warnings.push('image/group layer は v1 では保存対象外です');
  }

  const tilesets = matchTilesetTags(root.body).map((tilesetTag) => {
    const tilesetAttrs = parseAttrs(tilesetTag.attrs);
    return {
      firstgid: clampInt(tilesetAttrs.firstgid, 1, 65535, 1),
      source: tilesetAttrs.source || '',
      name: sourceBaseName(tilesetAttrs.source || 'tileset001'),
    };
  });
  const firstTileset = tilesets[0] || { firstgid: 1, source: '', name: 'tileset001' };
  const width = clampInt(attrs.width, 1, 4096, DEFAULT_TILEMAP.width);
  const height = clampInt(attrs.height, 1, 4096, DEFAULT_TILEMAP.height);
  const layers = [];
  const layerRe = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/gi;
  let layerMatch;
  while ((layerMatch = layerRe.exec(root.body))) {
    const layerAttrs = parseAttrs(layerMatch[1]);
    const dataTag = matchTag(layerMatch[2], 'data');
    if (!dataTag) {
      warnings.push(`layer '${layerAttrs.name || ''}' に data がありません`);
      continue;
    }
    const dataAttrs = parseAttrs(dataTag.attrs);
    if (String(dataAttrs.encoding || '').toLowerCase() !== 'csv') {
      warnings.push(`layer '${layerAttrs.name || ''}' は CSV encoding ではありません`);
      continue;
    }
    if (dataAttrs.compression) {
      warnings.push(`layer '${layerAttrs.name || ''}' は compressed data です`);
      continue;
    }
    layers.push({
      name: layerAttrs.name || `Layer ${layers.length + 1}`,
      visible: layerAttrs.visible !== '0' || isCollisionLayerName(layerAttrs.name || ''),
      opacity: Number(layerAttrs.opacity || 1),
      priority: /\s(priority|prio)$/i.test(layerAttrs.name || ''),
      collision: isCollisionLayerName(layerAttrs.name || ''),
      data: normalizeLayerData(parseCsvLayer(dataTag.body), width, height),
    });
  }

  if (layers.length === 0) {
    layers.push({ name: 'Ground', visible: true, opacity: 1, priority: false, collision: false, data: new Array(width * height).fill(0) });
  }

  return {
    name: 'map001',
    width,
    height,
    tileWidth: clampInt(attrs.tilewidth, 1, 1024, DEFAULT_TILEMAP.tileWidth),
    tileHeight: clampInt(attrs.tileheight, 1, 1024, DEFAULT_TILEMAP.tileHeight),
    tilesetSource: firstTileset.source || '',
    tilesetName: firstTileset.name,
    tilesets,
    layers,
    warnings,
  };
}

export function formatCsvLayer(data, width, height) {
  const normalized = normalizeLayerData(data, width, height);
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    const row = normalized.slice(y * width, y * width + width);
    lines.push(`   ${row.join(',')}${y === height - 1 ? '' : ','}`);
  }
  return lines.join('\n');
}

export function parseCsvLayer(text) {
  return String(text || '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function normalizeLayerData(data, width, height) {
  const size = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
  const out = new Array(size).fill(0);
  (Array.isArray(data) ? data : []).slice(0, size).forEach((value, index) => {
    out[index] = Math.max(0, Number.parseInt(value, 10) || 0);
  });
  return out;
}

export function normalizeLayers(layers, width, height) {
  const source = Array.isArray(layers) && layers.length ? layers : DEFAULT_TILEMAP.layers;
  return source.map((layer, index) => ({
    name: String(layer?.name || `Layer ${index + 1}`),
    visible: layer?.visible !== false,
    opacity: Number.isFinite(Number(layer?.opacity)) ? Number(layer.opacity) : 1,
    priority: !!layer?.priority,
    collision: !!layer?.collision || isCollisionLayerName(layer?.name),
    data: normalizeLayerData(layer?.data || [], width, height),
  }));
}

export function repeatedBrushGid(brush, columns, firstgid, offsetX, offsetY) {
  const safeColumns = Math.max(1, Number(columns) || 1);
  const w = Math.max(1, Number(brush?.w) || 1);
  const h = Math.max(1, Number(brush?.h) || 1);
  const bx = (Number(brush?.x) || 0) + positiveModulo(offsetX, w);
  const by = (Number(brush?.y) || 0) + positiveModulo(offsetY, h);
  return Math.max(1, Number(firstgid) || 1) + (by * safeColumns) + bx;
}

export function extractCollisionMaps(map, mapName = map?.name || DEFAULT_TILEMAP.name) {
  const width = clampInt(map?.width, 1, 4096, DEFAULT_TILEMAP.width);
  const height = clampInt(map?.height, 1, 4096, DEFAULT_TILEMAP.height);
  const layers = normalizeLayers(map?.layers || [], width, height).filter((layer) => layer.collision);
  return layers.map((layer, index) => {
    const suffix = collisionLayerSuffix(layer.name);
    const name = index === 0 && !suffix
      ? normalizeSymbolName(mapName, DEFAULT_TILEMAP.name)
      : normalizeSymbolName(`${mapName}_${suffix || `collision_${index + 1}`}`, `${DEFAULT_TILEMAP.name}_${index + 1}`);
    return {
      name,
      layerName: layer.name,
      width,
      height,
      data: normalizeLayerData(layer.data, width, height).map((value) => clampInt(value, 0, 255, 0)),
    };
  });
}

export function buildCollisionHeader(collisionMaps = []) {
  const maps = Array.isArray(collisionMaps) ? collisionMaps : [];
  const externs = maps.map((entry) => `extern const TilemapCollisionMap tilemap_collision_${normalizeSymbolName(entry.name)};`);
  return [
    '/* Generated by tilemap-editor. */',
    '#ifndef TILEMAP_COLLISION_H',
    '#define TILEMAP_COLLISION_H',
    '',
    '#include <genesis.h>',
    '',
    '#define TILEMAP_COLLISION_NONE 0',
    '#define TILEMAP_COLLISION_SOLID 1',
    '#define TILEMAP_COLLISION_PLATFORM 2',
    '#define TILEMAP_COLLISION_LADDER 3',
    '#define TILEMAP_COLLISION_DAMAGE 4',
    `#define TILEMAP_COLLISION_MAP_COUNT ${maps.length}`,
    '',
    'typedef struct',
    '{',
    '    const char* name;',
    '    u16 width;',
    '    u16 height;',
    '    const u8* data;',
    '} TilemapCollisionMap;',
    '',
    ...externs,
    maps.length ? '' : '',
    'extern const TilemapCollisionMap* const tilemap_collision_maps[TILEMAP_COLLISION_MAP_COUNT > 0 ? TILEMAP_COLLISION_MAP_COUNT : 1];',
    '',
    'u8 tilemap_collision_at(const TilemapCollisionMap* map, s16 tileX, s16 tileY);',
    'const TilemapCollisionMap* tilemap_collision_find(const char* name);',
    '',
    '#endif /* TILEMAP_COLLISION_H */',
    '',
  ].join('\n');
}

export function buildCollisionSource(collisionMaps = []) {
  const maps = Array.isArray(collisionMaps) ? collisionMaps : [];
  const arrays = maps.map((entry) => {
    const symbol = normalizeSymbolName(entry.name);
    return [
      `static const u8 tilemap_collision_${symbol}_data[] = {`,
      formatU8Array(entry.data || []),
      '};',
      `const TilemapCollisionMap tilemap_collision_${symbol} = { "${escapeCString(entry.name)}", ${Math.max(1, Number(entry.width) || 1)}, ${Math.max(1, Number(entry.height) || 1)}, tilemap_collision_${symbol}_data };`,
    ].join('\n');
  });
  const table = maps.length
    ? maps.map((entry) => `    &tilemap_collision_${normalizeSymbolName(entry.name)}`).join(',\n')
    : '    NULL';
  return [
    '/* Generated by tilemap-editor. */',
    '#include <string.h>',
    '#include "tilemap_collision.h"',
    '',
    ...arrays,
    maps.length ? '' : '',
    'const TilemapCollisionMap* const tilemap_collision_maps[TILEMAP_COLLISION_MAP_COUNT > 0 ? TILEMAP_COLLISION_MAP_COUNT : 1] = {',
    table,
    '};',
    '',
    'u8 tilemap_collision_at(const TilemapCollisionMap* map, s16 tileX, s16 tileY)',
    '{',
    '    if (!map || !map->data || tileX < 0 || tileY < 0) return TILEMAP_COLLISION_NONE;',
    '    if ((u16)tileX >= map->width || (u16)tileY >= map->height) return TILEMAP_COLLISION_NONE;',
    '    return map->data[((u16)tileY * map->width) + (u16)tileX];',
    '}',
    '',
    'const TilemapCollisionMap* tilemap_collision_find(const char* name)',
    '{',
    '    if (!name) return NULL;',
    '    for (u16 i = 0; i < TILEMAP_COLLISION_MAP_COUNT; i++)',
    '    {',
    '        const TilemapCollisionMap* map = tilemap_collision_maps[i];',
    '        if (map && map->name && strcmp(map->name, name) == 0) return map;',
    '    }',
    '    return NULL;',
    '}',
    '',
  ].join('\n');
}

export function normalizeTilesets(map = {}) {
  const source = Array.isArray(map.tilesets)
    ? map.tilesets
    : [{ firstgid: 1, source: map.tilesetSource || `../tilesets/${map.tilesetName || 'tileset001'}.tsx` }];
  const seen = new Set();
  return source
    .map((tileset, index) => ({
      firstgid: clampInt(tileset?.firstgid, 1, 65535, index + 1),
      source: normalizeTilesetSource(tileset?.source || ''),
    }))
    .filter((tileset) => {
      const key = `${tileset.firstgid}:${tileset.source}`;
      if (!tileset.source || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.firstgid - right.firstgid);
}

export function sourceBaseName(source) {
  return normalizeSymbolName(String(source || '').split(/[\\/]/).pop() || '', 'tileset001');
}

function normalizeTilesetSource(source) {
  const normalized = normalizeRelativePath(String(source || '').replace(/^res[\\/]/, ''));
  if (normalized.startsWith('maps/tilesets/')) return `../${normalized.slice(5)}`;
  if (normalized.startsWith('tilesets/')) return `../${normalized}`;
  return normalized;
}

function normalizeRelativePath(path) {
  const parts = [];
  String(path || '').replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
    } else {
      parts.push(part);
    }
  });
  return parts.join('/');
}

function collisionLayerSuffix(name) {
  const match = /^collision(?::(.+))?$/i.exec(String(name || '').trim());
  return match?.[1] ? normalizeSymbolName(match[1], '') : '';
}

function positiveModulo(value, mod) {
  return ((Number(value) || 0) % mod + mod) % mod;
}

function formatU8Array(data) {
  const values = (Array.isArray(data) ? data : []).map((value) => clampInt(value, 0, 255, 0));
  if (!values.length) return '    0';
  const lines = [];
  for (let index = 0; index < values.length; index += 24) {
    lines.push(`    ${values.slice(index, index + 24).join(', ')}`);
  }
  return lines.join(',\n');
}

function escapeCString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    attrs[match[1]] = unescapeXml(match[2]);
  }
  return attrs;
}

function matchTag(text, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = re.exec(String(text || ''));
  return match ? { attrs: match[1], body: match[2] } : null;
}

function matchSelfClosingTag(text, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)\\/>`, 'i');
  const match = re.exec(String(text || ''));
  return match ? { attrs: match[1], body: '' } : null;
}

function matchTilesetTags(text) {
  const out = [];
  const re = /<tileset\b([^>]*?)(?:\/>|>[\s\S]*?<\/tileset>)/gi;
  let match;
  while ((match = re.exec(String(text || '')))) {
    out.push({ attrs: match[1], body: '' });
  }
  return out;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
