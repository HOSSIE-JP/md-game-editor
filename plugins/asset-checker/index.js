'use strict';

const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.json');

const TARGET_TYPES = new Set(['IMAGE', 'SPRITE', 'MAP', 'TILEMAP', 'TILESET', 'PALETTE', 'XGM', 'XGM2', 'WAV']);

function readTemplateSource() {
  return fs.readFileSync(path.join(__dirname, 'template', 'src', 'main.c'), 'utf-8');
}

function renderTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => String(values[key] ?? ''));
}

function normalizeType(asset) {
  return String(asset?.type || '').toUpperCase();
}

function sortByName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
}

function isIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''));
}

function escapeCString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function isBgmWav(asset) {
  const name = String(asset?.name || '').toLowerCase();
  const sourcePath = String(asset?.sourcePath || '').replace(/\\/g, '/').toLowerCase();
  return sourcePath.startsWith('bgm/') || /^bgm(?:_|$|-)/.test(name) || name.includes('_bgm');
}

function isHalfRateWav(asset) {
  const outRate = String(asset?.outRate || '').trim();
  return outRate === '6650';
}

function pathStem(value) {
  return path.basename(String(value || '').replace(/\\/g, '/')).replace(/\.[^.]*$/, '').toLowerCase();
}

function sourceBaseName(value) {
  const raw = path.basename(String(value || '').replace(/\\/g, '/')).replace(/\.[^.]*$/, '');
  const normalized = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  return normalized || 'tileset';
}

function normalizeAssetPath(value) {
  const parts = [];
  String(value || '').replace(/\\/g, '/').replace(/^res\//, '').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push(part);
    } else {
      parts.push(part);
    }
  });
  return parts.join('/');
}

function resolveAssetRelative(basePath, relativePath) {
  const baseDir = path.posix.dirname(String(basePath || '').replace(/\\/g, '/'));
  return normalizeAssetPath(path.posix.join(baseDir, String(relativePath || '').replace(/\\/g, '/')));
}

function readAssetText(projectDir, sourcePath) {
  if (!projectDir || !sourcePath) return '';
  const fullPath = path.join(projectDir, 'res', normalizeAssetPath(sourcePath));
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (_) {
    return '';
  }
}

function parseTmxTilesets(text, tilemapSourcePath) {
  const tilesets = [];
  const re = /<tileset\b([^>]*?)(?:\/>|>[\s\S]*?<\/tileset>)/gi;
  let match;
  let index = 0;
  while ((match = re.exec(String(text || '')))) {
    const sourceMatch = /\bsource\s*=\s*"([^"]+)"/i.exec(match[1]);
    const firstgidMatch = /\bfirstgid\s*=\s*"([0-9]+)"/i.exec(match[1]);
    if (sourceMatch?.[1]) {
      tilesets.push({
        firstgid: firstgidMatch ? Number.parseInt(firstgidMatch[1], 10) || 1 : 1,
        sourcePath: resolveAssetRelative(tilemapSourcePath, sourceMatch[1]),
        tmxIndex: index,
      });
    }
    index += 1;
  }
  return tilesets;
}

function parseTmxMapTileSize(text) {
  const mapMatch = /<map\b([^>]*)>/i.exec(String(text || ''));
  if (!mapMatch) return { width: 0, height: 0 };
  const readNumber = (name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*"([0-9]+)"`, 'i').exec(mapMatch[1]);
    return match ? Number.parseInt(match[1], 10) || 0 : 0;
  };
  return { width: readNumber('width'), height: readNumber('height') };
}

function parseXmlAttributes(text) {
  const attrs = {};
  String(text || '').replace(/([:\w-]+)\s*=\s*"([^"]*)"/g, (_match, key, value) => {
    attrs[key] = value;
    return '';
  });
  return attrs;
}

function parseCsvTileData(text) {
  return String(text || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10) || 0)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function parseTmxLayerData(text, layerName) {
  const re = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/gi;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const attrs = parseXmlAttributes(match[1]);
    if (String(attrs.name || '') !== String(layerName || '')) continue;
    const dataMatch = /<data\b([^>]*)>([\s\S]*?)<\/data>/i.exec(match[2]);
    if (!dataMatch) return [];
    const dataAttrs = parseXmlAttributes(dataMatch[1]);
    if (String(dataAttrs.encoding || '').toLowerCase() !== 'csv') return [];
    return parseCsvTileData(dataMatch[2]);
  }
  return [];
}

function parseTsxTileCount(text) {
  const match = /<tileset\b([^>]*)>/i.exec(String(text || ''));
  if (!match) return 0;
  const attrs = parseXmlAttributes(match[1]);
  return Number.parseInt(attrs.tilecount, 10) || 0;
}

function isPriorityLayerId(value) {
  return /(?:^|\s)(priority|prio)$/i.test(String(value || '').trim());
}

function priorityBaseLayerId(value) {
  return String(value || '').trim().replace(/\s+(priority|prio)$/i, '');
}

function headerForResFile(value) {
  const normalized = String(value || 'resources.res').replace(/\\/g, '/');
  const base = path.basename(normalized).replace(/\.[^.]*$/, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) return 'resources.h';
  return `${base}.h`;
}

function collectAssets(assets = []) {
  const normalized = (Array.isArray(assets) ? assets : [])
    .map((asset) => ({ ...asset, type: normalizeType(asset), name: String(asset?.name || '').trim() }))
    .filter((asset) => TARGET_TYPES.has(asset.type) && isIdentifier(asset.name));

  const images = normalized.filter((asset) => asset.type === 'IMAGE').sort(sortByName);
  const sprites = normalized.filter((asset) => asset.type === 'SPRITE').sort(sortByName);
  const tilemaps = normalized.filter((asset) => asset.type === 'MAP' || asset.type === 'TILEMAP').sort(sortByName);
  const tilesets = normalized.filter((asset) => asset.type === 'TILESET').sort(sortByName);
  const palettes = normalized.filter((asset) => asset.type === 'PALETTE').sort(sortByName);
  const bgms = normalized
    .filter((asset) => asset.type === 'XGM' || asset.type === 'XGM2' || (asset.type === 'WAV' && isBgmWav(asset)))
    .sort(sortByName);

  return { images, sprites, tilemaps, tilesets, palettes, bgms };
}

function arrayOrNone(entries, renderer, noneValue) {
  if (!entries.length) return `    ${noneValue}`;
  return entries.map(renderer).join(',\n');
}

function renderImageEntries(images) {
  return arrayOrNone(
    images,
    (asset) => `    { "${escapeCString(asset.name)}", &${asset.name} }`,
    '{ "none", NULL }',
  );
}

function renderSpriteEntries(sprites) {
  return arrayOrNone(
    sprites,
    (asset) => `    { "${escapeCString(asset.name)}", &${asset.name} }`,
    '{ "none", NULL }',
  );
}

function renderResourceIncludes(assets) {
  const headers = Array.from(new Set(
    (Array.isArray(assets) ? assets : []).map((asset) => headerForResFile(asset.resFile)),
  ));
  const ordered = headers
    .filter((header) => header !== 'resources.h')
    .sort((left, right) => left.localeCompare(right));
  return ['resources.h', ...ordered].map((header) => `#include "${header}"`).join('\n');
}

function findTilesetsForTilemap(tilemap, tilesets, context = {}) {
  const tmxText = String(tilemap.sourcePath || '').toLowerCase().endsWith('.tmx')
    ? readAssetText(context.projectDir, tilemap.sourcePath)
    : '';
  const tmxTilesets = parseTmxTilesets(tmxText, tilemap.sourcePath);
  if (tmxTilesets.length) {
    const byTmx = tmxTilesets.map((tmxTileset) => {
      const registered = tilesets.find((entry) => normalizeAssetPath(entry.sourcePath) === tmxTileset.sourcePath);
      if (registered) {
        return {
          ...registered,
          symbol: registered.name,
          firstgid: tmxTileset.firstgid,
          tmxIndex: tmxTileset.tmxIndex,
        };
      }
      const fallbackName = sourceBaseName(tmxTileset.sourcePath);
      return {
        type: 'TILESET',
        name: `${tilemap.name}_tileset${tmxTileset.tmxIndex}`,
        symbol: `${tilemap.name}_tileset${tmxTileset.tmxIndex}`,
        sourcePath: tmxTileset.sourcePath,
        firstgid: tmxTileset.firstgid,
        tmxIndex: tmxTileset.tmxIndex,
        fallbackName,
      };
    });
    if (tilemap.type === 'MAP' && tilemap.tileset) {
      const layerGids = parseTmxLayerData(tmxText, tilemap.tileset).filter((gid) => gid > 0);
      if (layerGids.length) {
        const layerTilesets = byTmx.map((entry, index) => {
          const nextFirstgid = byTmx[index + 1]?.firstgid || Infinity;
          const tsxText = readAssetText(context.projectDir, entry.sourcePath);
          const tileCount = parseTsxTileCount(tsxText) || (Number.isFinite(nextFirstgid) ? Math.max(0, nextFirstgid - entry.firstgid) : 0);
          const upper = tileCount > 0 ? entry.firstgid + tileCount : nextFirstgid;
          return { ...entry, firstgid: 1, tileCount, tmxFirstgid: entry.firstgid, tmxUpper: upper };
        }).filter((entry) => layerGids.some((gid) => gid >= entry.tmxFirstgid && gid < entry.tmxUpper));
        if (layerTilesets.length) return layerTilesets;
      }
    }
    if (byTmx.length) return byTmx;
  }
  if (!tilesets.length) return null;
  const explicit = tilemap.type === 'TILEMAP'
    ? tilesets.find((entry) => entry.name === tilemap.tileset)
    : null;
  if (explicit) return [{ ...explicit, symbol: explicit.name, firstgid: 1, tmxIndex: 0 }];
  const tilemapStem = pathStem(tilemap.sourcePath);
  const byStem = tilesets.find((entry) => pathStem(entry.sourcePath) === tilemapStem || pathStem(entry.name) === tilemapStem);
  if (byStem) return [{ ...byStem, symbol: byStem.name, firstgid: 1, tmxIndex: 0 }];
  return tilesets.length === 1 ? [{ ...tilesets[0], symbol: tilesets[0].name, firstgid: 1, tmxIndex: 0 }] : null;
}

function getTilemapSourceText(tilemap, context = {}) {
  return String(tilemap?.sourcePath || '').toLowerCase().endsWith('.tmx')
    ? readAssetText(context.projectDir, tilemap.sourcePath)
    : '';
}

function findPaletteForTileset(tileset, palettes) {
  if (!tileset || !palettes.length) return null;
  const sourceStem = pathStem(tileset.sourcePath);
  const bySource = palettes.find((entry) => {
    const palettePath = normalizeAssetPath(entry.sourcePath);
    const tilesetPath = normalizeAssetPath(tileset.sourcePath);
    return palettePath === tilesetPath || pathStem(palettePath) === sourceStem;
  });
  if (bySource) return bySource;
  const byName = palettes.find((entry) => entry.name === `${tileset.name}_palette` || entry.name === `${tileset.name}Palette`);
  if (byName) return byName;
  return palettes.length === 1 ? palettes[0] : null;
}

function findPalettesForTilesets(tilesetList, palettes) {
  const result = [];
  const seen = new Set();
  (tilesetList || []).forEach((tileset) => {
    const palette = findPaletteForTileset(tileset, palettes);
    if (!palette || seen.has(palette.name)) return;
    seen.add(palette.name);
    result.push(palette);
  });
  return result.slice(0, 3);
}

function paletteSlotsForTilesets(tilesetList, paletteList, allPalettes) {
  return (tilesetList || []).slice(0, 8).map((tileset) => {
    const palette = findPaletteForTileset(tileset, allPalettes);
    const slot = palette ? paletteList.findIndex((entry) => entry.name === palette.name) : 0;
    return slot >= 0 ? Math.min(slot, 2) : 0;
  });
}

function renderTilesetArray(tilesetList) {
  const values = (tilesetList || []).slice(0, 8).map((tileset) => `&${tileset.symbol || tileset.name}`);
  while (values.length < 8) values.push('NULL');
  return `{ ${values.join(', ')} }`;
}

function renderTileOffsetArray(tilesetList) {
  let cumulative = 0;
  const values = (tilesetList || []).slice(0, 8).map((tileset) => {
    if (Number(tileset.firstgid) === 1 && Number(tileset.tileCount) > 0) {
      const value = cumulative;
      cumulative += Number(tileset.tileCount) || 0;
      return String(value);
    }
    return String(Math.max(0, (Number(tileset.firstgid) || 1) - 1));
  });
  while (values.length < 8) values.push('0');
  return `{ ${values.join(', ')} }`;
}

function renderPaletteSlotArray(slotList) {
  const values = (slotList || []).slice(0, 8).map((slot) => String(slot));
  while (values.length < 8) values.push('0');
  return `{ ${values.join(', ')} }`;
}

function renderPaletteArray(paletteList) {
  const values = (paletteList || []).slice(0, 3).map((palette) => `&${palette.name}`);
  while (values.length < 3) values.push('NULL');
  return `{ ${values.join(', ')} }`;
}

function renderMapDefinitionArray(mapList) {
  const values = (mapList || []).slice(0, 8).map((asset) => (asset ? `&${asset.name}` : 'NULL'));
  while (values.length < 8) values.push('NULL');
  return `{ ${values.join(', ')} }`;
}

function findSiblingMapLayer(asset, tilemaps, layerId) {
  const source = normalizeAssetPath(asset?.sourcePath);
  const layer = String(layerId || '');
  if (!source || !layer) return null;
  return (tilemaps || []).find((candidate) => (
    candidate !== asset
    && candidate.type === 'MAP'
    && normalizeAssetPath(candidate.sourcePath) === source
    && String(candidate.tileset || '') === layer
  )) || null;
}

function findPrioritySibling(asset, tilemaps) {
  if (!asset || asset.type !== 'MAP' || !asset.tileset || isPriorityLayerId(asset.tileset)) return null;
  return (tilemaps || []).find((candidate) => (
    candidate !== asset
    && candidate.type === 'MAP'
    && normalizeAssetPath(candidate.sourcePath) === normalizeAssetPath(asset.sourcePath)
    && isPriorityLayerId(candidate.tileset)
    && priorityBaseLayerId(candidate.tileset) === String(asset.tileset || '')
  )) || null;
}

function mapPreviewPairForAsset(asset, tilemaps) {
  if (!asset || asset.type !== 'MAP') {
    return { mapPointer: asset?.type === 'MAP' ? `&${asset.name}` : 'NULL', definitions: [], priorityDefinitions: [] };
  }
  if (isPriorityLayerId(asset.tileset)) {
    const baseLayer = priorityBaseLayerId(asset.tileset);
    const base = findSiblingMapLayer(asset, tilemaps, baseLayer);
    if (base) return { mapPointer: 'NULL', definitions: [base], priorityDefinitions: [asset] };
    return { mapPointer: `&${asset.name}`, definitions: [], priorityDefinitions: [] };
  }
  const priority = findPrioritySibling(asset, tilemaps);
  if (priority) return { mapPointer: 'NULL', definitions: [asset], priorityDefinitions: [priority] };
  return { mapPointer: `&${asset.name}`, definitions: [], priorityDefinitions: [] };
}

function renderTilemapData(tilemaps, tilesets, palettes, context = {}) {
  const layerData = [];
  const rendered = (tilemaps || []).map((asset) => {
    const tmxText = getTilemapSourceText(asset, context);
    const previewPair = mapPreviewPairForAsset(asset, tilemaps);
    const tilesetSourceAsset = previewPair.definitions[0] || asset;
    const assetTilesets = findTilesetsForTilemap(tilesetSourceAsset, tilesets, context);
    const assetPalettes = findPalettesForTilesets(assetTilesets || [], palettes);
    const paletteSlots = paletteSlotsForTilesets(assetTilesets || [], assetPalettes, palettes);
    const sourceSize = asset.type === 'MAP' ? parseTmxMapTileSize(tmxText) : { width: 0, height: 0 };
    const previewLayer = 'NULL';
    const tilesetArray = renderTilesetArray(assetTilesets || []);
    const tileOffsetArray = renderTileOffsetArray(assetTilesets || []);
    const paletteSlotArray = renderPaletteSlotArray(paletteSlots);
    const paletteArray = renderPaletteArray(assetPalettes);
    const tilesetCount = Math.min((assetTilesets || []).length, 8);
    const paletteCount = Math.min(assetPalettes.length, 3);
    const kind = asset.type === 'MAP' ? 'TILEMAP_KIND_MAP' : 'TILEMAP_KIND_TILEMAP';
    const tilemapPointer = asset.type === 'TILEMAP' ? `&${asset.name}` : 'NULL';
    const mapPointer = asset.type === 'MAP' ? previewPair.mapPointer : 'NULL';
    const mapDefinitionArray = renderMapDefinitionArray(previewPair.definitions);
    const priorityDefinitionArray = renderMapDefinitionArray(previewPair.priorityDefinitions);
    const mapDefinitionCount = Math.min(previewPair.definitions.length, 8);
    const note = `${asset.name} (${asset.type}${tilesetCount ? '' : ' no tileset'})`;
    return `    { "${escapeCString(note)}", ${kind}, ${tilemapPointer}, ${mapPointer}, ${mapDefinitionArray}, ${priorityDefinitionArray}, ${mapDefinitionCount}, ${previewLayer}, ${tilesetArray}, ${tileOffsetArray}, ${paletteSlotArray}, ${tilesetCount}, ${paletteArray}, ${paletteCount}, ${sourceSize.width}, ${sourceSize.height} }`;
  });
  const entries = rendered.length
    ? rendered.join(',\n')
    : '    { "none", TILEMAP_KIND_TILEMAP, NULL, NULL, { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL }, { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL }, 0, NULL, { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL }, { 0, 0, 0, 0, 0, 0, 0, 0 }, { 0, 0, 0, 0, 0, 0, 0, 0 }, 0, { NULL, NULL, NULL }, 0, 0, 0 }';
  return { entries, layerData: layerData.join('\n\n'), count: rendered.length };
}

function renderBgmEntries(bgms) {
  return arrayOrNone(
    bgms,
    (asset) => {
      const kind = asset.type === 'WAV' ? 'BGM_KIND_WAV' : asset.type === 'XGM' ? 'BGM_KIND_XGM' : 'BGM_KIND_XGM2';
      const halfRate = asset.type === 'WAV' && isHalfRateWav(asset) ? 'TRUE' : 'FALSE';
      return `    { "${escapeCString(`${asset.name} (${asset.type})`)}", ${kind}, ${asset.name}, sizeof(${asset.name}), ${halfRate} }`;
    },
    '{ "none", BGM_KIND_XGM2, NULL, 0, FALSE }',
  );
}

function generateSource(assets = [], context = {}) {
  const grouped = collectAssets(assets);
  const total = grouped.images.length + grouped.sprites.length + grouped.tilemaps.length + grouped.bgms.length;
  if (total === 0) {
    return {
      ok: false,
      error: 'IMAGE / SPRITE / MAP / TILEMAP / XGM / XGM2 / BGM 用 WAV アセットが見つかりません。',
    };
  }

  const tilemapData = renderTilemapData(grouped.tilemaps, grouped.tilesets, grouped.palettes, context);
  const sourceCode = renderTemplate(readTemplateSource(), {
    VERSION: manifest.version,
    RESOURCE_INCLUDES: renderResourceIncludes(grouped.images.concat(grouped.sprites, grouped.tilemaps, grouped.tilesets, grouped.palettes, grouped.bgms)),
    IMAGE_COUNT: grouped.images.length,
    SPRITE_COUNT: grouped.sprites.length,
    TILEMAP_COUNT: tilemapData.count,
    BGM_COUNT: grouped.bgms.length,
    IMAGE_ENTRIES: renderImageEntries(grouped.images),
    SPRITE_ENTRIES: renderSpriteEntries(grouped.sprites),
    TILEMAP_LAYER_DATA: tilemapData.layerData,
    TILEMAP_ENTRIES: tilemapData.entries,
    BGM_ENTRIES: renderBgmEntries(grouped.bgms),
  });

  return { ok: true, sourceCode };
}

function onBuildStart(payload = {}, context = {}) {
  context?.logger?.info?.(`asset-checker build start: project=${payload?.projectDir || '-'}`);
  return {
    ok: true,
    makeVariables: {
      SRC_C: 'src/main.c',
    },
  };
}

function onBuildLog() {
  return { ok: true };
}

function onBuildEnd(payload, context = {}) {
  context?.logger?.info?.(`asset-checker build end: success=${Boolean(payload?.success)}`);
  return { ok: true };
}

function onBuildError(payload, context = {}) {
  context?.logger?.error?.(`asset-checker build error: ${payload?.error || 'unknown'}`);
  return { ok: true };
}

module.exports = {
  manifest,
  collectAssets,
  generateSource,
  readTemplateSource,
  renderResourceIncludes,
  findTilesetsForTilemap,
  onBuildStart,
  onBuildLog,
  onBuildEnd,
  onBuildError,
};
