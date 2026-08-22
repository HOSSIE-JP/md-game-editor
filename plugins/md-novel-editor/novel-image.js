'use strict';

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = Array.from({ length: 256 }, (_, value) => {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
    }
    return current >>> 0;
  });
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, payload])), 0);
  return Buffer.concat([length, name, payload, checksum]);
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpperLeft = Math.abs(prediction - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) return left;
  if (distanceUp <= distanceUpperLeft) return up;
  return upperLeft;
}

function unpackIndexedRow(row, width, bitDepth) {
  const result = new Uint8Array(width);
  if (bitDepth === 8) {
    result.set(row.subarray(0, width));
    return result;
  }
  const mask = (1 << bitDepth) - 1;
  for (let x = 0; x < width; x += 1) {
    const bitOffset = x * bitDepth;
    const byte = row[bitOffset >> 3];
    const shift = 8 - bitDepth - (bitOffset & 7);
    result[x] = (byte >> shift) & mask;
  }
  return result;
}

function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG signature is missing');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = [];
  let transparency = null;
  const idat = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`PNG chunk ${type} is truncated`);
    const payload = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
      if (payload[10] !== 0 || payload[11] !== 0) throw new Error('Unsupported PNG compression or filter method');
      interlace = payload[12];
    } else if (type === 'PLTE') {
      palette = [];
      for (let index = 0; index + 2 < payload.length; index += 3) {
        palette.push([payload[index], payload[index + 1], payload[index + 2], 255]);
      }
    } else if (type === 'tRNS') {
      transparency = Buffer.from(payload);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(payload));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height) throw new Error('PNG has invalid dimensions');
  if (interlace !== 0) throw new Error('Interlaced PNG is not supported');
  if (![2, 3, 6].includes(colorType)) throw new Error(`Unsupported PNG color type ${colorType}`);
  if (colorType !== 3 && bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (colorType === 3 && ![1, 2, 4, 8].includes(bitDepth)) throw new Error(`Unsupported indexed PNG bit depth ${bitDepth}`);

  if (transparency && colorType === 3) {
    palette = palette.map((color, index) => [color[0], color[1], color[2], transparency[index] ?? 255]);
  }

  const bitsPerPixel = colorType === 2 ? 24 : colorType === 6 ? 32 : bitDepth;
  const rowBytes = Math.ceil(width * bitsPerPixel / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const expected = height * (rowBytes + 1);
  if (inflated.length < expected) throw new Error('PNG image data is truncated');

  const rows = [];
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const raw = inflated.subarray(sourceOffset, sourceOffset + rowBytes);
    sourceOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    const previous = rows[y - 1] || Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const value = raw[index];
      const left = index >= filterBytesPerPixel ? row[index - filterBytesPerPixel] : 0;
      const up = previous[index] || 0;
      const upperLeft = index >= filterBytesPerPixel ? previous[index - filterBytesPerPixel] : 0;
      if (filter === 0) row[index] = value;
      else if (filter === 1) row[index] = (value + left) & 0xff;
      else if (filter === 2) row[index] = (value + up) & 0xff;
      else if (filter === 3) row[index] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[index] = (value + paeth(left, up, upperLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
    rows.push(row);
  }

  const rgba = new Uint8Array(width * height * 4);
  const sourceIndices = colorType === 3 ? new Uint8Array(width * height) : null;
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    const indexes = colorType === 3 ? unpackIndexedRow(row, width, bitDepth) : null;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const target = pixel * 4;
      if (colorType === 3) {
        const index = indexes[x];
        sourceIndices[pixel] = index;
        const color = palette[index] || [0, 0, 0, 255];
        rgba[target] = color[0];
        rgba[target + 1] = color[1];
        rgba[target + 2] = color[2];
        rgba[target + 3] = color[3];
      } else {
        const stride = colorType === 6 ? 4 : 3;
        const source = x * stride;
        rgba[target] = row[source];
        rgba[target + 1] = row[source + 1];
        rgba[target + 2] = row[source + 2];
        rgba[target + 3] = colorType === 6 ? row[source + 3] : 255;
      }
    }
  }

  return { width, height, bitDepth, colorType, rgba, sourceIndices, palette };
}

function encodeIndexedPng(width, height, indices, palette) {
  const w = Number(width) | 0;
  const h = Number(height) | 0;
  if (w <= 0 || h <= 0) throw new Error('Indexed PNG dimensions must be positive');
  if (!(indices instanceof Uint8Array) && !Buffer.isBuffer(indices)) throw new Error('Indexed PNG indices are required');
  if (indices.length !== w * h) throw new Error('Indexed PNG index count mismatch');
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 256) throw new Error('Indexed PNG palette is invalid');

  let maxIndex = 0;
  for (const value of indices) maxIndex = Math.max(maxIndex, value);
  if (maxIndex >= palette.length) throw new Error('Indexed PNG contains a palette overflow');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const plte = Buffer.alloc(palette.length * 3);
  const trns = Buffer.alloc(palette.length, 255);
  let hasTransparency = false;
  palette.forEach((entry, index) => {
    const color = entry || [0, 0, 0, 255];
    plte[index * 3] = color[0] & 0xff;
    plte[index * 3 + 1] = color[1] & 0xff;
    plte[index * 3 + 2] = color[2] & 0xff;
    trns[index] = color[3] == null ? 255 : color[3] & 0xff;
    if (trns[index] !== 255) hasTransparency = true;
  });

  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y += 1) {
    const offset = y * (w + 1);
    raw[offset] = 0;
    Buffer.from(indices.buffer, indices.byteOffset + y * w, w).copy(raw, offset + 1);
  }

  const chunks = [
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
  ];
  if (hasTransparency) chunks.push(pngChunk('tRNS', trns));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
  chunks.push(pngChunk('IEND'));
  return Buffer.concat(chunks);
}

function snapChannel(value) {
  return Math.round(Math.max(0, Math.min(255, Number(value) || 0)) * 7 / 255) * 255 / 7;
}

function snapRgb333(r, g, b) {
  return [Math.round(snapChannel(r)), Math.round(snapChannel(g)), Math.round(snapChannel(b)), 255];
}

function srgbToLinear(value) {
  const channel = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(color) {
  const red = srgbToLinear(color?.[0]);
  const green = srgbToLinear(color?.[1]);
  const blue = srgbToLinear(color?.[2]);
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const pivot = (value) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function degrees(value) { return value * 180 / Math.PI; }
function radians(value) { return value * Math.PI / 180; }

function ciede2000(left, right) {
  const [l1, a1, b1] = left;
  const [l2, a2, b2] = right;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt((meanC ** 7) / ((meanC ** 7) + (25 ** 7))));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const angle = degrees(Math.atan2(b, a));
    return angle < 0 ? angle + 360 : angle;
  };
  const hp1 = hue(ap1, b1);
  const hp2 = hue(ap2, b2);
  const deltaL = l2 - l1;
  const deltaC = cp2 - cp1;
  let deltaH = 0;
  if (cp1 * cp2 !== 0) {
    const difference = hp2 - hp1;
    deltaH = Math.abs(difference) <= 180 ? difference : difference > 180 ? difference - 360 : difference + 360;
  }
  const deltaBigH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(radians(deltaH / 2));
  const meanL = (l1 + l2) / 2;
  const meanCp = (cp1 + cp2) / 2;
  let meanHp = hp1 + hp2;
  if (cp1 * cp2 === 0) meanHp = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) meanHp /= 2;
  else if (meanHp < 360) meanHp = (meanHp + 360) / 2;
  else meanHp = (meanHp - 360) / 2;
  const t = 1
    - 0.17 * Math.cos(radians(meanHp - 30))
    + 0.24 * Math.cos(radians(2 * meanHp))
    + 0.32 * Math.cos(radians(3 * meanHp + 6))
    - 0.20 * Math.cos(radians(4 * meanHp - 63));
  const deltaTheta = 30 * Math.exp(-(((meanHp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt((meanCp ** 7) / ((meanCp ** 7) + (25 ** 7)));
  const sl = 1 + (0.015 * ((meanL - 50) ** 2)) / Math.sqrt(20 + ((meanL - 50) ** 2));
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt = -Math.sin(radians(2 * deltaTheta)) * rc;
  const lTerm = deltaL / sl;
  const cTerm = deltaC / sc;
  const hTerm = deltaBigH / sh;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm);
}

function colorKey(color) {
  return ((color[0] & 0xff) << 16) | ((color[1] & 0xff) << 8) | (color[2] & 0xff);
}

function keyColor(key) {
  return [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff, 255];
}

function collectHistogram(images, options = {}) {
  const histogram = new Map();
  for (const image of images) {
    const transparentIndex = options.transparentIndex ?? image.transparentIndex;
    const pixels = image.rgba;
    for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
      if (pixels[pixel * 4 + 3] < 128) continue;
      if (image.sourceIndices && transparentIndex != null && image.sourceIndices[pixel] === transparentIndex) continue;
      const snapped = snapRgb333(pixels[pixel * 4], pixels[pixel * 4 + 1], pixels[pixel * 4 + 2]);
      const key = colorKey(snapped);
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }
  return histogram;
}

function boxRange(entries, channel) {
  let min = 255;
  let max = 0;
  for (const entry of entries) {
    const color = keyColor(entry.key);
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  }
  return max - min;
}

function splitColorBoxes(histogram, maxColors) {
  const entries = Array.from(histogram, ([key, count]) => ({ key, count }))
    .sort((left, right) => left.key - right.key);
  if (entries.length <= maxColors) {
    return entries
      .sort((left, right) => right.count - left.count || left.key - right.key)
      .map((entry) => keyColor(entry.key));
  }

  const boxes = [entries];
  while (boxes.length < maxColors) {
    let candidate = -1;
    let candidateScore = -1;
    let splitChannel = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box.length < 2) continue;
      const ranges = [0, 1, 2].map((channel) => boxRange(box, channel));
      const channel = ranges.indexOf(Math.max(...ranges));
      const weight = box.reduce((sum, entry) => sum + entry.count, 0);
      const score = ranges[channel] * weight;
      if (score > candidateScore) {
        candidate = index;
        candidateScore = score;
        splitChannel = channel;
      }
    }
    if (candidate < 0) break;

    const box = boxes[candidate].slice().sort((left, right) => {
      const a = keyColor(left.key)[splitChannel];
      const b = keyColor(right.key)[splitChannel];
      return a - b || left.key - right.key;
    });
    const total = box.reduce((sum, entry) => sum + entry.count, 0);
    let cumulative = 0;
    let splitAt = 1;
    for (; splitAt < box.length; splitAt += 1) {
      cumulative += box[splitAt - 1].count;
      if (cumulative >= total / 2) break;
    }
    boxes.splice(candidate, 1, box.slice(0, splitAt), box.slice(splitAt));
  }

  return boxes.map((box) => {
    let weight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const entry of box) {
      const color = keyColor(entry.key);
      weight += entry.count;
      red += color[0] * entry.count;
      green += color[1] * entry.count;
      blue += color[2] * entry.count;
    }
    return snapRgb333(red / weight, green / weight, blue / weight);
  });
}

function nearestPaletteIndex(color, palette, startIndex = 0, paletteLab = null, cache = null) {
  const key = `${startIndex}:${colorKey(color)}`;
  if (cache?.has(key)) return cache.get(key);
  const sourceLab = rgbToLab(color);
  const candidates = paletteLab || palette.map(rgbToLab);
  let best = startIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = startIndex; index < palette.length; index += 1) {
    const distance = ciede2000(sourceLab, candidates[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  cache?.set(key, best);
  return best;
}

function quantizeImages(images, options = {}) {
  const reserveTransparent = Boolean(options.reserveTransparent);
  const forbiddenPaletteIndices = [...new Set((options.forbiddenPaletteIndices || [])
    .map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < 16))].sort((a, b) => a - b);
  const fixedPalette = (Array.isArray(options.fixedPalette) ? options.fixedPalette : [])
    .map((color) => snapRgb333(color?.[0], color?.[1], color?.[2]));
  if (fixedPalette.length > 16) throw new Error('Fixed palette exceeds 16 colors');
  const reservedSlots = fixedPalette.length || (reserveTransparent ? 1 : 0);
  if (forbiddenPaletteIndices.some((index) => index < reservedSlots)) throw new Error('Forbidden palette index conflicts with a fixed palette slot');
  const dynamicIndices = Array.from({ length: 16 }, (_, index) => index)
    .filter((index) => index >= reservedSlots && !forbiddenPaletteIndices.includes(index));
  const maxColors = dynamicIndices.length;
  const histogram = collectHistogram(images, options);
  const fixedKeys = new Set(fixedPalette.map(colorKey));
  const blackKey = colorKey([0, 0, 0]);
  const needsVisibleBlackSubstitute = reserveTransparent && fixedKeys.has(blackKey);
  const visibleBlackCount = needsVisibleBlackSubstitute ? (histogram.get(blackKey) || 0) : 0;
  for (const key of fixedKeys) histogram.delete(key);
  if (visibleBlackCount > 0) {
    const substituteKey = colorKey(snapRgb333(36, 36, 36));
    histogram.set(substituteKey, (histogram.get(substituteKey) || 0) + visibleBlackCount);
  }
  const colors = splitColorBoxes(histogram, maxColors);
  let palette = fixedPalette.length
    ? [...fixedPalette, ...colors]
    : reserveTransparent
      ? [[0, 0, 0, 0], ...colors]
      : colors;
  if (forbiddenPaletteIndices.length) {
    const indexed = Array.from({ length: 16 }, () => [0, 0, 0, 255]);
    fixedPalette.forEach((color, index) => { indexed[index] = color; });
    if (reserveTransparent && !fixedPalette.length) indexed[0] = [0, 0, 0, 0];
    colors.forEach((color, index) => { indexed[dynamicIndices[index]] = color; });
    palette = indexed;
  }
  if (reserveTransparent) palette[0] = [palette[0]?.[0] || 0, palette[0]?.[1] || 0, palette[0]?.[2] || 0, 0];
  if (!palette.length) palette.push([0, 0, 0, 255]);
  const paddingColor = needsVisibleBlackSubstitute ? snapRgb333(36, 36, 36) : [0, 0, 0, 255];
  while (palette.length < 16) palette.push([...paddingColor]);

  const paletteLab = palette.map(rgbToLab);
  const nearestCache = new Map();
  const converted = images.map((image) => {
    const indices = new Uint8Array(image.width * image.height);
    const transparentIndex = options.transparentIndex ?? image.transparentIndex;
    const imageUsesTransparency = reserveTransparent && image.reserveTransparent !== false;
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const alpha = image.rgba[pixel * 4 + 3];
      const transparent = imageUsesTransparency && (
        alpha < 128
        || (image.sourceIndices && transparentIndex != null && image.sourceIndices[pixel] === transparentIndex)
      );
      if (transparent) {
        indices[pixel] = 0;
        continue;
      }
      const snapped = snapRgb333(
        image.rgba[pixel * 4],
        image.rgba[pixel * 4 + 1],
        image.rgba[pixel * 4 + 2],
      );
      if (forbiddenPaletteIndices.length) {
        const sourceLab = rgbToLab(snapped);
        let best = dynamicIndices[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const paletteIndex of dynamicIndices) {
          const distance = ciede2000(sourceLab, paletteLab[paletteIndex]);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = paletteIndex;
          }
        }
        indices[pixel] = best;
      } else {
        indices[pixel] = nearestPaletteIndex(snapped, palette, imageUsesTransparency ? 1 : 0, paletteLab, nearestCache);
      }
    }
    const errors = [];
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      if (imageUsesTransparency && indices[pixel] === 0) continue;
      const source = snapRgb333(image.rgba[pixel * 4], image.rgba[pixel * 4 + 1], image.rgba[pixel * 4 + 2]);
      errors.push(ciede2000(rgbToLab(source), paletteLab[indices[pixel]]));
    }
    errors.sort((left, right) => left - right);
    const meanDeltaE = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : 0;
    const p95DeltaE = errors.length ? errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))] : 0;
    return {
      ...image,
      indices,
      palette,
      quality: { meanDeltaE, p95DeltaE },
      png: encodeIndexedPng(image.width, image.height, indices, palette),
    };
  });
  return { palette, images: converted };
}

function flipTile(tile, horizontal, vertical) {
  const result = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const sourceX = horizontal ? 7 - x : x;
      const sourceY = vertical ? 7 - y : y;
      result[y * 8 + x] = tile[sourceY * 8 + sourceX];
    }
  }
  return result;
}

function tileKey(tile) {
  return Buffer.from(tile).toString('base64');
}

function countUniqueTiles(indices, width, height, options = {}) {
  if (width % 8 || height % 8) throw new Error('Tile analysis requires 8-pixel alignment');
  const allowFlip = options.allowFlip !== false;
  const unique = new Set();
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      const tile = new Uint8Array(64);
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          tile[y * 8 + x] = indices[(tileY + y) * width + tileX + x];
        }
      }
      const variants = [tileKey(tile)];
      if (allowFlip) {
        variants.push(tileKey(flipTile(tile, true, false)));
        variants.push(tileKey(flipTile(tile, false, true)));
        variants.push(tileKey(flipTile(tile, true, true)));
      }
      variants.sort();
      unique.add(variants[0]);
    }
  }
  return unique.size;
}

module.exports = {
  PNG_SIGNATURE,
  crc32,
  decodePng,
  encodeIndexedPng,
  snapRgb333,
  rgbToLab,
  ciede2000,
  collectHistogram,
  quantizeImages,
  countUniqueTiles,
};
