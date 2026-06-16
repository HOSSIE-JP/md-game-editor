export function normalizeSymbolName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'sprite_name';
}

export function parseSpriteSizeToken(value, imageDimension = 0) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  const numeric = Number.parseInt(upper, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { raw, mode: 'tiles', value: 2, pixels: 16, frames: imageDimension > 0 ? Math.max(1, Math.floor(imageDimension / 16)) : 1 };
  }
  if (upper.endsWith('P')) {
    const pixels = snapSpritePixels(numeric);
    return { raw, mode: 'pixels', value: pixels, pixels, frames: imageDimension > 0 ? Math.max(1, Math.floor(imageDimension / pixels)) : 1 };
  }
  if (upper.endsWith('F')) {
    const frames = Math.max(1, numeric);
    const pixels = imageDimension > 0 ? snapSpritePixels(Math.floor(imageDimension / frames)) : frames * 8;
    return { raw, mode: 'frames', value: frames, pixels, frames };
  }
  const tiles = Math.max(1, numeric);
  const pixels = snapSpritePixels(tiles * 8);
  return { raw, mode: 'tiles', value: tiles, pixels, frames: imageDimension > 0 ? Math.max(1, Math.floor(imageDimension / pixels)) : 1 };
}

export function snapSpritePixels(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 8;
  return Math.max(8, Math.min(248, Math.round(n / 8) * 8));
}

export function formatSpritePixelToken(value) {
  return `${snapSpritePixels(value)}p`;
}

export function formatSpriteTileToken(value) {
  return String(Math.max(1, Math.min(31, Math.floor(snapSpritePixels(value) / 8))));
}

export function computeFrameGrid(imageWidth, imageHeight, widthToken, heightToken) {
  const width = parseSpriteSizeToken(widthToken, imageWidth).pixels;
  const height = parseSpriteSizeToken(heightToken, imageHeight).pixels;
  const columns = Math.max(1, Math.floor((Number(imageWidth) || width) / width));
  const rows = Math.max(1, Math.floor((Number(imageHeight) || height) / height));
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let frame = 0; frame < columns; frame += 1) {
      frames.push({ row, frame, x: frame * width, y: row * height, width, height });
    }
  }
  return { width, height, columns, rows, frames };
}

export function parseSpriteTime(value, rows = 1, columns = 1) {
  const rowCount = normalizeCount(rows, 1);
  const columnCount = normalizeCount(columns, 1);
  const sourceRows = parseSpriteTimeRows(value, rowCount, columnCount);
  const matrix = createTimeMatrix(rowCount, columnCount, '0');
  sourceRows.forEach((row, rowIndex) => {
    row.slice(0, columnCount).forEach((cell, columnIndex) => {
      matrix[rowIndex][columnIndex] = normalizeTimeCell(cell);
    });
  });
  return matrix;
}

export function updateSpriteTimeCell(value, rows, columns, rowIndex, frameIndex, nextTime) {
  const matrix = parseSpriteTimeRows(value, rows, columns);
  const safeRow = clampIndex(rowIndex, matrix.length);
  const safeFrame = clampIndex(frameIndex, matrix[safeRow]?.length || 1);
  matrix[safeRow][safeFrame] = normalizeTimeCell(nextTime);
  return serializeSpriteTime(matrix);
}

export function serializeSpriteTime(matrix) {
  const rows = Array.isArray(matrix) && matrix.length ? matrix : [['0']];
  return `[${rows.map((row) => `[${(Array.isArray(row) ? row : []).map((cell) => normalizeTimeCell(cell)).join(',')}]`).join('')}]`;
}

export function deriveRowFrameCounts(value, rows = 1, columns = 1) {
  const columnCount = normalizeCount(columns, 1);
  return parseSpriteTimeRows(value, rows, columnCount)
    .map((row) => Math.max(1, Math.min(columnCount, row.length || columnCount)));
}

export function resizeSpriteTimeRow(value, rows, columns, rowIndex, frameCount, fillTime) {
  const columnCount = normalizeCount(columns, 1);
  const matrix = parseSpriteTimeRows(value, rows, columnCount);
  const safeRow = clampIndex(rowIndex, matrix.length);
  const safeCount = Math.max(1, Math.min(columnCount, Math.floor(Number(frameCount) || 1)));
  const fill = normalizeTimeCell(fillTime);
  const row = matrix[safeRow].slice(0, safeCount);
  while (row.length < safeCount) row.push(fill);
  matrix[safeRow] = row;
  return serializeSpriteTime(matrix);
}

export function getActiveFrameCountForRow(value, rows, columns, rowIndex) {
  const counts = deriveRowFrameCounts(value, rows, columns);
  return counts[clampIndex(rowIndex, counts.length)] || 1;
}

function parseSpriteTimeRows(value, rows = 1, columns = 1) {
  const rowCount = normalizeCount(rows, 1);
  const columnCount = normalizeCount(columns, 1);
  const text = String(value == null ? '' : value).trim();
  if (!text || !text.startsWith('[')) {
    const fill = normalizeTimeCell(text || '0');
    return createTimeMatrix(rowCount, columnCount, fill);
  }

  const matches = Array.from(text.matchAll(/\[([^\[\]]*)\]/g)).map((match) => match[1]);
  const rowsText = matches.length > 0 ? matches : [text.replace(/^\[+|\]+$/g, '')];
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const rowText = rowsText[rowIndex];
    if (rowText == null) return createTimeRow(columnCount, '0');
    const values = rowText === '' ? [''] : rowText.split(',').map((cell) => normalizeTimeCell(cell));
    return values.slice(0, columnCount).length ? values.slice(0, columnCount) : ['0'];
  });
}

function createTimeMatrix(rows, columns, fill) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => normalizeTimeCell(fill)));
}

function createTimeRow(columns, fill) {
  return Array.from({ length: columns }, () => normalizeTimeCell(fill));
}

function normalizeTimeCell(value) {
  const text = String(value == null ? '' : value).trim();
  if (text === '') return '';
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(n);
}

function normalizeCount(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function clampIndex(value, length) {
  const max = Math.max(0, Number(length) - 1);
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}
