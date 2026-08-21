'use strict';

const crypto = require('crypto');
const iconv = require('iconv-lite');
const { decodePng, encodeIndexedPng } = require('./novel-image');

const FONT_FORMAT_VERSION = 1;
const FONT_RENDERER = 'subset-16x16-v1';
const FONT_CELL_SIZE = 16;
const FONT_GRID_COLUMNS = 16;
const FONT_OUTPUT_PATH = 'res/novel/font/generated.png';
const BUNDLED_FONT_SOURCE = 'font/JF-Dot-Shinonome16.ttf';
const BUNDLED_FONT_ATLAS_SOURCE = 'font/JF-Dot-Shinonome16-atlas.png';
const BUNDLED_FONT_LABEL = '同梱 JF-Dot-Shinonome16.ttf';
const LEGACY_BUNDLED_FONT_SOURCE = 'font/misaki_gothic.png';
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_THRESHOLD = 190;
const FIXED_RUNTIME_CHARACTERS = Object.freeze(['　', '▼', '◆']);

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function fullWidthAscii(value) {
  return Array.from(String(value ?? '')).map((character) => {
    const code = character.codePointAt(0);
    if (code === 0x20) return '\u3000';
    if (code >= 0x21 && code <= 0x7e) return String.fromCodePoint(code + 0xfee0);
    return character;
  }).join('');
}

function normalizeLibrary(value) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const file = String(entry?.file || '').replace(/\\/g, '/');
    if (!/^assets\/fonts\/[A-Za-z0-9._-]+\.(?:ttf|otf|ttc)$/i.test(file)) continue;
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ file, label: String(entry?.label || file.split('/').pop()).slice(0, 120) });
  }
  return result;
}

function normalizeFontSettings(value = {}) {
  const library = normalizeLibrary(value.library);
  const requestedSource = String(value.source || '').replace(/\\/g, '/');
  const kind = value.kind === 'project' && /^assets\/fonts\/[A-Za-z0-9._-]+\.(?:ttf|otf|ttc)$/i.test(requestedSource)
    ? 'project'
    : 'bundled';
  return {
    ...value,
    kind,
    renderer: FONT_RENDERER,
    glyphWidth: FONT_CELL_SIZE,
    glyphHeight: FONT_CELL_SIZE,
    source: kind === 'project' ? requestedSource : BUNDLED_FONT_SOURCE,
    label: kind === 'project'
      ? String(value.label || library.find((entry) => entry.file === requestedSource)?.label || requestedSource.split('/').pop()).slice(0, 120)
      : BUNDLED_FONT_LABEL,
    fontSize: clamp(value.fontSize, 8, 32, DEFAULT_FONT_SIZE),
    threshold: clamp(
      kind === 'bundled' && requestedSource === LEGACY_BUNDLED_FONT_SOURCE && Number(value.threshold) === 32
        ? DEFAULT_FONT_THRESHOLD
        : value.threshold,
      1,
      254,
      DEFAULT_FONT_THRESHOLD,
    ),
    xOffset: clamp(value.xOffset, -8, 8, 0),
    yOffset: clamp(value.yOffset, -8, 8, 0),
    previewText: String(value.previewText || 'MDノベルのフォント表示\n19文字x4行').slice(0, 512),
    library,
    generation: value.generation && typeof value.generation === 'object' ? { ...value.generation } : null,
  };
}

function runtimeTextChunks(sceneDocument) {
  const chunks = [];
  for (const scene of sceneDocument?.scenes || []) {
    for (const command of scene?.commands || []) {
      if (!command || command.skip === true || command.type === 'comment') continue;
      if (command.type === 'message') chunks.push(command.speaker || '', command.text || '');
      else if (command.type === 'spritetext') chunks.push(command.text || '');
      else if (command.type === 'choice') {
        for (const choice of command.choices || []) chunks.push(choice?.label || '');
      }
    }
  }
  return chunks;
}

function shiftJisEntry(character, location = 'font') {
  const encoded = iconv.encode(character, 'shift_jis');
  const decoded = iconv.decode(encoded, 'shift_jis');
  if (decoded !== character || encoded.length < 1 || encoded.length > 2) {
    const shown = character === ' ' ? '(space)' : character;
    throw new Error(`Shift-JISに変換できない文字があります: ${location}: ${shown}`);
  }
  const code = encoded.length === 1 ? encoded[0] : (encoded[0] << 8) | encoded[1];
  return { character, code, bytes: [...encoded] };
}

function requireBufferRange(buffer, offset, length, label) {
  if (!Buffer.isBuffer(buffer) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Font ${label} table is truncated`);
  }
}

function sfntOffset(buffer) {
  requireBufferRange(buffer, 0, 12, 'header');
  if (buffer.subarray(0, 4).toString('ascii') !== 'ttcf') return 0;
  const count = buffer.readUInt32BE(8);
  if (count < 1 || count > 4096) throw new Error('Font collection has no usable face');
  requireBufferRange(buffer, 12, count * 4, 'collection');
  return buffer.readUInt32BE(12);
}

function sfntTable(buffer, tag) {
  const offset = sfntOffset(buffer);
  requireBufferRange(buffer, offset, 12, 'directory');
  const tableCount = buffer.readUInt16BE(offset + 4);
  if (tableCount < 1 || tableCount > 4096) throw new Error('Font table directory is invalid');
  requireBufferRange(buffer, offset + 12, tableCount * 16, 'directory');
  for (let index = 0; index < tableCount; index += 1) {
    const record = offset + 12 + index * 16;
    if (buffer.subarray(record, record + 4).toString('ascii') !== tag) continue;
    const tableOffset = buffer.readUInt32BE(record + 8);
    const length = buffer.readUInt32BE(record + 12);
    requireBufferRange(buffer, tableOffset, length, tag);
    return { offset: tableOffset, length };
  }
  throw new Error(`Font ${tag} table is missing`);
}

function cmapFormat4Checker(buffer, offset, available) {
  requireBufferRange(buffer, offset, 16, 'cmap format 4');
  const length = buffer.readUInt16BE(offset + 2);
  if (length < 16 || length > available) throw new Error('Font cmap format 4 length is invalid');
  requireBufferRange(buffer, offset, length, 'cmap format 4');
  const segmentCount = buffer.readUInt16BE(offset + 6) >> 1;
  if (segmentCount < 1 || 16 + segmentCount * 8 > length) throw new Error('Font cmap format 4 segments are invalid');
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  return (codePoint) => {
    if (codePoint > 0xffff) return false;
    for (let index = 0; index < segmentCount; index += 1) {
      const end = buffer.readUInt16BE(endCodes + index * 2);
      if (codePoint > end) continue;
      const start = buffer.readUInt16BE(startCodes + index * 2);
      if (codePoint < start) return false;
      const delta = buffer.readInt16BE(deltas + index * 2);
      const rangeOffsetAddress = rangeOffsets + index * 2;
      const rangeOffset = buffer.readUInt16BE(rangeOffsetAddress);
      if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
      const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - start) * 2;
      if (glyphAddress < offset || glyphAddress + 2 > offset + length) return false;
      const glyph = buffer.readUInt16BE(glyphAddress);
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    }
    return false;
  };
}

function cmapFormat12Checker(buffer, offset, available) {
  requireBufferRange(buffer, offset, 16, 'cmap format 12');
  const length = buffer.readUInt32BE(offset + 4);
  const groupCount = buffer.readUInt32BE(offset + 12);
  if (length < 16 || length > available || groupCount > 0x100000 || 16 + groupCount * 12 > length) {
    throw new Error('Font cmap format 12 groups are invalid');
  }
  requireBufferRange(buffer, offset, length, 'cmap format 12');
  return (codePoint) => {
    let low = 0;
    let high = groupCount;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      const group = offset + 16 + middle * 12;
      const start = buffer.readUInt32BE(group);
      const end = buffer.readUInt32BE(group + 4);
      if (codePoint < start) high = middle;
      else if (codePoint > end) low = middle + 1;
      else return (buffer.readUInt32BE(group + 8) + codePoint - start) !== 0;
    }
    return false;
  };
}

function createFontCoverageChecker(buffer) {
  const cmap = sfntTable(buffer, 'cmap');
  requireBufferRange(buffer, cmap.offset, 4, 'cmap');
  const count = buffer.readUInt16BE(cmap.offset + 2);
  requireBufferRange(buffer, cmap.offset + 4, count * 8, 'cmap records');
  const checkers = [];
  for (let index = 0; index < count; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && [1, 2, 10].includes(encoding))) continue;
    const relative = buffer.readUInt32BE(record + 4);
    if (relative >= cmap.length) continue;
    const subtable = cmap.offset + relative;
    requireBufferRange(buffer, subtable, 2, 'cmap subtable');
    const format = buffer.readUInt16BE(subtable);
    if (format === 12) checkers.unshift(cmapFormat12Checker(buffer, subtable, cmap.length - relative));
    else if (format === 4) checkers.push(cmapFormat4Checker(buffer, subtable, cmap.length - relative));
  }
  if (!checkers.length) throw new Error('Font has no supported Unicode cmap (format 4 or 12)');
  return (codePoint) => checkers.some((checker) => checker(codePoint));
}

function validateProjectFontCoverage(buffer, entries = []) {
  const hasCodePoint = createFontCoverageChecker(buffer);
  const missing = [];
  for (const entry of entries) {
    const codePoint = String(entry?.character || '').codePointAt(0);
    if (!Number.isInteger(codePoint) || !hasCodePoint(codePoint)) missing.push(entry?.character || '?');
  }
  if (missing.length) throw new Error(`登録fontにglyphがありません: ${[...new Set(missing)].slice(0, 12).join(' ')}`);
  return true;
}

function collectEntriesFromChunks(chunks, locationPrefix = 'text') {
  const byCode = new Map();
  for (const [chunkIndex, chunk] of chunks.entries()) {
    for (const character of Array.from(fullWidthAscii(chunk))) {
      if (character === '\r' || character === '\n') continue;
      const entry = shiftJisEntry(character, `${locationPrefix}[${chunkIndex}]`);
      if (!byCode.has(entry.code)) byCode.set(entry.code, entry);
    }
  }
  return [...byCode.values()].sort((left, right) => left.code - right.code);
}

function collectFontEntries(sceneDocument) {
  return collectEntriesFromChunks([...FIXED_RUNTIME_CHARACTERS, ...runtimeTextChunks(sceneDocument)]);
}

function collectPreviewEntries(previewText) {
  return collectEntriesFromChunks([previewText], 'preview');
}

function hashBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createFontPlan(sceneDocument, profileFont, sourceBuffer) {
  const font = normalizeFontSettings(profileFont);
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) throw new Error('Font source is empty');
  const entries = collectFontEntries(sceneDocument);
  const previewEntries = collectPreviewEntries(font.previewText);
  const height = Math.max(FONT_CELL_SIZE, Math.ceil(entries.length / FONT_GRID_COLUMNS) * FONT_CELL_SIZE);
  const input = {
    formatVersion: FONT_FORMAT_VERSION,
    renderer: FONT_RENDERER,
    kind: font.kind,
    source: font.source,
    sourceHash: hashBuffer(sourceBuffer),
    fontSize: font.fontSize,
    threshold: font.threshold,
    xOffset: font.xOffset,
    yOffset: font.yOffset,
    entries: entries.map((entry) => [entry.code, entry.character]),
  };
  return {
    font,
    entries,
    previewEntries,
    width: FONT_GRID_COLUMNS * FONT_CELL_SIZE,
    height,
    sourceHash: input.sourceHash,
    inputHash: hashBuffer(Buffer.from(JSON.stringify(input), 'utf8')),
    outputPath: FONT_OUTPUT_PATH,
  };
}

function jisCell(code) {
  if (code <= 0xff) return null;
  const lead = code >> 8;
  const trail = code & 0xff;
  if (!(((lead >= 0x81) && (lead <= 0x9f)) || ((lead >= 0xe0) && (lead <= 0xef)))) return null;
  if (trail < 0x40 || trail > 0xfc || trail === 0x7f) return null;
  let row = lead <= 0x9f ? ((lead - 0x81) * 2) + 0x21 : ((lead - 0xe0) * 2) + 0x5f;
  let column;
  if (trail >= 0x9f) {
    row += 1;
    column = trail - 0x7e;
  } else {
    column = trail - (trail < 0x7f ? 0x1f : 0x20);
  }
  row -= 0x21;
  column -= 0x21;
  return row >= 0 && row < 94 && column >= 0 && column < 94 ? { row, column } : null;
}

function generateBundledAtlas(plan, sourceBuffer) {
  if (plan.font.kind !== 'bundled') throw new Error('Bundled atlas generation requires the bundled font');
  const source = decodePng(sourceBuffer);
  if (source.width !== 1504 || source.height !== 1504) throw new Error('Bundled JF-Dot-Shinonome16 atlas has invalid dimensions');
  const indices = new Uint8Array(plan.width * plan.height);
  for (const [glyphIndex, entry] of plan.entries.entries()) {
    const cell = jisCell(entry.code);
    if (!cell) throw new Error(`同梱JF-Dot-Shinonome16に収録できない文字です: ${entry.character}`);
    const size = plan.font.fontSize;
    const cellX = (glyphIndex % FONT_GRID_COLUMNS) * FONT_CELL_SIZE;
    const cellY = Math.floor(glyphIndex / FONT_GRID_COLUMNS) * FONT_CELL_SIZE;
    const originX = (glyphIndex % FONT_GRID_COLUMNS) * FONT_CELL_SIZE + Math.floor((FONT_CELL_SIZE - size) / 2) + plan.font.xOffset;
    const originY = Math.floor(glyphIndex / FONT_GRID_COLUMNS) * FONT_CELL_SIZE + Math.floor((FONT_CELL_SIZE - size) / 2) + plan.font.yOffset;
    let ink = 0;
    for (let targetY = 0; targetY < size; targetY += 1) {
      for (let targetX = 0; targetX < size; targetX += 1) {
        const sourceX = cell.column * FONT_CELL_SIZE + Math.min(FONT_CELL_SIZE - 1, Math.floor(targetX * FONT_CELL_SIZE / size));
        const sourceY = cell.row * FONT_CELL_SIZE + Math.min(FONT_CELL_SIZE - 1, Math.floor(targetY * FONT_CELL_SIZE / size));
        const sourcePixel = sourceY * source.width + sourceX;
        const rgbaOffset = sourcePixel * 4;
        const alpha = source.rgba[rgbaOffset + 3];
        const luminance = Math.max(source.rgba[rgbaOffset], source.rgba[rgbaOffset + 1], source.rgba[rgbaOffset + 2]);
        if (alpha === 0 || luminance < plan.font.threshold) continue;
        const outputX = originX + targetX;
        const outputY = originY + targetY;
        if (outputX < cellX || outputX >= cellX + FONT_CELL_SIZE
          || outputY < cellY || outputY >= cellY + FONT_CELL_SIZE) continue;
        indices[outputY * plan.width + outputX] = 1;
        ink += 1;
      }
    }
    if (ink === 0 && entry.character !== '　') throw new Error(`同梱JF-Dot-Shinonome16にglyphがありません: ${entry.character}`);
  }
  return encodeIndexedPng(plan.width, plan.height, indices, [[0, 0, 0, 0], [255, 255, 255, 255]]);
}

function canonicalizeGeneratedAtlas(plan, pngBuffer) {
  const decoded = decodePng(pngBuffer);
  if (decoded.width !== plan.width || decoded.height !== plan.height) {
    throw new Error(`Font atlas dimensions must be ${plan.width}x${plan.height}`);
  }
  const indices = new Uint8Array(plan.width * plan.height);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    const luminance = Math.max(decoded.rgba[offset], decoded.rgba[offset + 1], decoded.rgba[offset + 2]);
    if (decoded.rgba[offset + 3] >= 128 && luminance >= 128) indices[pixel] = 1;
  }
  for (const [glyphIndex, entry] of plan.entries.entries()) {
    if (entry.character === '　') continue;
    const originX = (glyphIndex % FONT_GRID_COLUMNS) * FONT_CELL_SIZE;
    const originY = Math.floor(glyphIndex / FONT_GRID_COLUMNS) * FONT_CELL_SIZE;
    let ink = 0;
    for (let y = 0; y < FONT_CELL_SIZE; y += 1) {
      for (let x = 0; x < FONT_CELL_SIZE; x += 1) ink += indices[(originY + y) * plan.width + originX + x] ? 1 : 0;
    }
    if (ink === 0) throw new Error(`Font atlasにglyphがありません: ${entry.character}`);
  }
  return encodeIndexedPng(plan.width, plan.height, indices, [[0, 0, 0, 0], [255, 255, 255, 255]]);
}

function generationMetadata(plan, pngBuffer) {
  return {
    formatVersion: FONT_FORMAT_VERSION,
    renderer: FONT_RENDERER,
    inputHash: plan.inputHash,
    sourceHash: plan.sourceHash,
    outputPath: FONT_OUTPUT_PATH,
    pngSha256: hashBuffer(pngBuffer),
    glyphCount: plan.entries.length,
    width: plan.width,
    height: plan.height,
  };
}

function validateGeneration(plan, generation, pngBuffer) {
  if (!generation || generation.formatVersion !== FONT_FORMAT_VERSION || generation.renderer !== FONT_RENDERER) {
    throw new Error('Font atlas generation metadata is missing or unsupported');
  }
  if (generation.inputHash !== plan.inputHash) throw new Error('Font atlas is stale; save the Font tab before building');
  if (generation.outputPath !== FONT_OUTPUT_PATH) throw new Error('Font atlas output path is invalid');
  const canonical = canonicalizeGeneratedAtlas(plan, pngBuffer);
  const hash = hashBuffer(canonical);
  if (generation.pngSha256 !== hash || !Buffer.from(canonical).equals(Buffer.from(pngBuffer))) {
    throw new Error('Font atlas file hash or indexed bitmap format is invalid');
  }
  return true;
}

module.exports = {
  FONT_FORMAT_VERSION,
  FONT_RENDERER,
  FONT_CELL_SIZE,
  FONT_GRID_COLUMNS,
  FONT_OUTPUT_PATH,
  BUNDLED_FONT_SOURCE,
  BUNDLED_FONT_ATLAS_SOURCE,
  BUNDLED_FONT_LABEL,
  LEGACY_BUNDLED_FONT_SOURCE,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_THRESHOLD,
  FIXED_RUNTIME_CHARACTERS,
  fullWidthAscii,
  normalizeFontSettings,
  runtimeTextChunks,
  shiftJisEntry,
  createFontCoverageChecker,
  validateProjectFontCoverage,
  collectEntriesFromChunks,
  collectFontEntries,
  collectPreviewEntries,
  createFontPlan,
  jisCell,
  generateBundledAtlas,
  canonicalizeGeneratedAtlas,
  generationMetadata,
  validateGeneration,
};
