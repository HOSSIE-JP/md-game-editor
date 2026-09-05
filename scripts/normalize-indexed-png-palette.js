'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function parseChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG signature is invalid');
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error('PNG chunk exceeds file length');
    chunks.push({ type: buffer.toString('ascii', offset + 4, offset + 8), data: Buffer.from(buffer.subarray(offset + 8, offset + 8 + length)) });
    offset = end;
    if (chunks.at(-1).type === 'IEND') break;
  }
  if (!chunks.length || chunks.at(-1).type !== 'IEND') throw new Error('PNG IEND is missing');
  return chunks;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left : upDistance <= diagonalDistance ? up : upperLeft;
}

function decodeIndexedRows(chunks) {
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data;
  if (!ihdr || ihdr.length !== 13) throw new Error('PNG IHDR is invalid');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 3 || ihdr[12] !== 0) throw new Error('Only non-interlaced 8-bit indexed PNG is supported');
  const compressed = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
  const filtered = zlib.inflateSync(compressed);
  const stride = width;
  if (filtered.length !== (stride + 1) * height) throw new Error('PNG scanline length is invalid');
  const pixels = Buffer.alloc(width * height);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)];
    const source = filtered.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const target = pixels.subarray(row * stride, (row + 1) * stride);
    const previous = row ? pixels.subarray((row - 1) * stride, row * stride) : null;
    for (let column = 0; column < stride; column += 1) {
      const left = column ? target[column - 1] : 0;
      const up = previous ? previous[column] : 0;
      const upperLeft = previous && column ? previous[column - 1] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : null;
      if (predictor == null) throw new Error(`Unsupported PNG filter ${filter}`);
      target[column] = (source[column] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function encodeChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function snapMegaDrivePalette(data) {
  const result = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) result[index] = Math.max(0, Math.min(252, Math.round(data[index] / 36) * 36));
  return result;
}

function normalize(inputPath, outputPath, maxColors = 16, options = {}) {
  const chunks = parseChunks(fs.readFileSync(inputPath));
  const palette = chunks.find((chunk) => chunk.type === 'PLTE');
  if (!palette || palette.data.length % 3) throw new Error('PNG PLTE is invalid');
  const decoded = decodeIndexedRows(chunks);
  const used = [...new Set(decoded.pixels)].sort((left, right) => left - right);
  const highest = used.at(-1) ?? 0;
  if (highest >= maxColors) throw new Error(`PNG uses palette index ${highest}; max allowed is ${maxColors - 1}`);
  const normalized = chunks.map((chunk) => {
    if (chunk.type === 'PLTE') {
      const data = chunk.data.subarray(0, maxColors * 3);
      return { ...chunk, data: options.snapMegaDrive ? snapMegaDrivePalette(data) : data };
    }
    if (chunk.type === 'tRNS') return { ...chunk, data: chunk.data.subarray(0, maxColors) };
    return chunk;
  });
  const output = Buffer.concat([PNG_SIGNATURE, ...normalized.map((chunk) => encodeChunk(chunk.type, chunk.data))]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, output);
  fs.renameSync(temporary, outputPath);
  return { width: decoded.width, height: decoded.height, usedColors: used.length, maxPaletteIndex: highest, paletteEntries: maxColors, megaDriveRgb333: Boolean(options.snapMegaDrive), bytes: output.length };
}

if (require.main === module) {
  const inputPath = path.resolve(process.argv[2] || '');
  const outputPath = path.resolve(process.argv[3] || process.argv[2] || '');
  const maxColors = Math.max(1, Math.min(256, Math.trunc(Number(process.argv[4]) || 16)));
  const snapMegaDrive = process.argv[5] === 'md';
  if (!process.argv[2]) throw new Error('Usage: node scripts/normalize-indexed-png-palette.js <input.png> [output.png] [max-colors]');
  process.stdout.write(`${JSON.stringify(normalize(inputPath, outputPath, maxColors, { snapMegaDrive }), null, 2)}\n`);
}

module.exports = { normalize, parseChunks, decodeIndexedRows, snapMegaDrivePalette };
