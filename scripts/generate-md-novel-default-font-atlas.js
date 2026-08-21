'use strict';

const fs = require('node:fs');
const path = require('node:path');
const iconv = require('iconv-lite');
const { app, BrowserWindow } = require('electron');
const { createFontCoverageChecker } = require('../plugins/md-novel-editor/novel-font');
const { decodePng, encodeIndexedPng } = require('../plugins/md-novel-editor/novel-image');

const CELL_SIZE = 16;
const GRID_SIZE = 94;
const DEFAULT_THRESHOLD = 190;
const FONT_FILE = 'JF-Dot-Shinonome16.ttf';
const ATLAS_FILE = 'JF-Dot-Shinonome16-atlas.png';

function shiftJisBytes(row, column) {
  const jisRow = row + 0x21;
  const jisColumn = column + 0x21;
  const lead = ((jisRow - 0x21) >> 1) + (jisRow <= 0x5e ? 0x81 : 0xc1);
  const trail = (jisRow & 1)
    ? jisColumn + (jisColumn < 0x60 ? 0x1f : 0x20)
    : jisColumn + 0x7e;
  return Buffer.from([lead, trail]);
}

function atlasEntries(fontBuffer) {
  const hasCodePoint = createFontCoverageChecker(fontBuffer);
  const entries = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const character = iconv.decode(shiftJisBytes(row, column), 'shift_jis');
      const codePoint = character.codePointAt(0);
      entries.push({
        character: character.length === 1 && character !== '\ufffd' && hasCodePoint(codePoint) ? character : '',
        row,
        column,
      });
    }
  }
  return entries;
}

function canonicalIndexedPng(pngBuffer) {
  const decoded = decodePng(pngBuffer);
  const expected = CELL_SIZE * GRID_SIZE;
  if (decoded.width !== expected || decoded.height !== expected) {
    throw new Error(`Unexpected atlas dimensions: ${decoded.width}x${decoded.height}`);
  }
  const indices = new Uint8Array(decoded.width * decoded.height);
  let inkPixels = 0;
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    if (decoded.rgba[offset + 3] < 128) continue;
    indices[pixel] = 1;
    inkPixels += 1;
  }
  if (inkPixels < 10000) throw new Error(`Atlas has too little glyph data: ${inkPixels} pixels`);
  return { png: encodeIndexedPng(decoded.width, decoded.height, indices, [[0, 0, 0, 0], [255, 255, 255, 255]]), inkPixels };
}

async function renderAtlas(fontBuffer, threshold) {
  const window = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><title>font atlas</title>');
    const fontDataUrl = `data:font/ttf;base64,${fontBuffer.toString('base64')}`;
    const entries = atlasEntries(fontBuffer);
    const script = `(${async ({ cellSize, gridSize, thresholdValue, fontUrl, glyphs }) => {
      const face = new FontFace('md_novel_default', `url("${fontUrl}")`);
      await face.load();
      document.fonts.add(face);
      const canvas = document.createElement('canvas');
      canvas.width = cellSize * gridSize;
      canvas.height = cellSize * gridSize;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff';
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      context.font = `${cellSize}px "md_novel_default"`;
      for (const entry of glyphs) {
        if (!entry.character || entry.character === '　') continue;
        const metrics = context.measureText(entry.character);
        const ascent = Number(metrics.actualBoundingBoxAscent || cellSize * 0.8);
        const descent = Number(metrics.actualBoundingBoxDescent || cellSize * 0.2);
        const width = Number(metrics.width || cellSize);
        const cellX = entry.column * cellSize;
        const cellY = entry.row * cellSize;
        const x = cellX + (cellSize - width) / 2;
        const baseline = cellY + (cellSize - ascent - descent) / 2 + ascent;
        context.save();
        context.beginPath();
        context.rect(cellX, cellY, cellSize, cellSize);
        context.clip();
        context.fillText(entry.character, x, baseline);
        context.restore();
      }
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const alpha = imageData.data[offset + 3];
        const luminance = Math.max(imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]);
        const enabled = Math.round(alpha * luminance / 255) >= thresholdValue;
        imageData.data[offset] = enabled ? 255 : 0;
        imageData.data[offset + 1] = enabled ? 255 : 0;
        imageData.data[offset + 2] = enabled ? 255 : 0;
        imageData.data[offset + 3] = enabled ? 255 : 0;
      }
      context.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    }})(${JSON.stringify({
      cellSize: CELL_SIZE,
      gridSize: GRID_SIZE,
      thresholdValue: threshold,
      fontUrl: fontDataUrl,
      glyphs: entries,
    })})`;
    const dataUrl = await window.webContents.executeJavaScript(script, true);
    const match = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
    if (!match) throw new Error('Chromium did not return a PNG atlas');
    return Buffer.from(match[1], 'base64');
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  const defaultRoot = path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'res', 'novel', 'font');
  const sourcePath = path.resolve(process.argv[2] || path.join(defaultRoot, FONT_FILE));
  const outputPath = path.resolve(process.argv[3] || path.join(defaultRoot, ATLAS_FILE));
  const threshold = Number(process.argv[4] || DEFAULT_THRESHOLD);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 254) throw new Error('Threshold must be an integer from 1 to 254');
  const fontBuffer = fs.readFileSync(sourcePath);
  const rendered = await renderAtlas(fontBuffer, threshold);
  const canonical = canonicalIndexedPng(rendered);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonical.png);
  process.stdout.write(`${outputPath}\n${CELL_SIZE}px / threshold ${threshold} / ${canonical.inkPixels} ink pixels\n`);
}

app.disableHardwareAcceleration();
app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });