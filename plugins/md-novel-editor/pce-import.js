'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  decodePng,
  encodeRgbaPng,
  normalizeCropAnchor,
  resizeRgbaCover,
} = require('./novel-image');

const fsp = fs.promises;
const TARGET_BACKGROUND = Object.freeze({ width: 320, height: 192 });
const PCE_BACKGROUND = Object.freeze({ width: 224, height: 136 });
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
const LOW_QUALITY_PATH = /(?:^|\/)(?:pce|qa|preview|previews|thumbnail|thumbnails|rejected[^/]*|anchor|anchors|placeholder|placeholder-images)(?:\/|$)/i;

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeCandidateName(value) {
  return path.basename(String(value || ''), path.extname(String(value || '')))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function nameTokens(value) {
  return normalizeCandidateName(value).split('_').filter((token) => token.length > 1 || /^\d+$/.test(token));
}

function candidateNameScore(relativePath, asset) {
  const candidate = normalizeCandidateName(relativePath);
  const candidateCompact = candidate.replace(/_/g, '');
  const identities = [asset?.id, asset?.source].map(normalizeCandidateName).filter(Boolean);
  let score = 0;
  for (const identity of identities) {
    const compact = identity.replace(/_/g, '');
    if (candidate === identity) score = Math.max(score, 1000);
    else if (candidateCompact.includes(compact) || compact.includes(candidateCompact)) score = Math.max(score, 720);
    else {
      const tokens = nameTokens(identity);
      let cursor = 0;
      const ordered = tokens.length >= 2 && tokens.every((token) => {
        const found = candidate.indexOf(token, cursor);
        if (found < 0) return false;
        cursor = found + token.length;
        return true;
      });
      if (ordered) score = Math.max(score, 430 + Math.min(120, tokens.length * 15));
    }
  }
  if (LOW_QUALITY_PATH.test(String(relativePath).replace(/\\/g, '/'))) score -= 350;
  return score;
}

function probeJpeg(buffer) {
  let offset = 2;
  while (offset + 8 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions are missing');
}

function probeWebp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error('WEBP signature is missing');
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  if (kind === 'VP8 ' && buffer.length >= 30) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error('Unsupported WEBP header');
}

function probeImageDimensions(buffer, extension) {
  const ext = String(extension || '').toLowerCase();
  if (ext === '.png') {
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG signature is missing');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (ext === '.bmp') {
    if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') throw new Error('BMP signature is missing');
    return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if (ext === '.jpg' || ext === '.jpeg') return probeJpeg(buffer);
  if (ext === '.webp') return probeWebp(buffer);
  throw new Error(`Unsupported image extension: ${extension}`);
}

function decodeWithElectron(buffer) {
  let nativeImage;
  try {
    ({ nativeImage } = require('electron'));
  } catch (_error) {
    throw new Error('Electron image codec is unavailable');
  }
  if (!nativeImage?.createFromBuffer) throw new Error('Electron image codec is unavailable');
  const image = nativeImage.createFromBuffer(buffer, { scaleFactor: 1 });
  if (!image || image.isEmpty()) throw new Error('Image decode failed');
  return decodePng(image.toPNG());
}

function decodeBmp(buffer) {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') throw new Error('BMP signature is missing');
  const pixelOffset = buffer.readUInt32LE(10);
  const dibSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bits = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (dibSize < 40 || width <= 0 || signedHeight === 0 || planes !== 1 || ![24, 32].includes(bits) || compression !== 0) {
    throw new Error('Only uncompressed 24-bit or 32-bit BMP images are supported');
  }
  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const bytesPerPixel = bits / 8;
  const rowBytes = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (pixelOffset + rowBytes * height > buffer.length) throw new Error('BMP pixel data is truncated');
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const rowOffset = pixelOffset + sourceY * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const source = rowOffset + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      rgba[target] = buffer[source + 2];
      rgba[target + 1] = buffer[source + 1];
      rgba[target + 2] = buffer[source];
      rgba[target + 3] = bits === 32 ? buffer[source + 3] : 255;
    }
  }
  return { width, height, rgba };
}

function decodeImageBuffer(buffer, extension, options = {}) {
  const ext = String(extension || '').toLowerCase();
  if (ext === '.png') {
    try { return decodePng(buffer); } catch (error) {
      if (!options.allowElectronFallback) throw error;
    }
  }
  if (ext === '.bmp') {
    try { return decodeBmp(buffer); } catch (error) {
      if (!options.allowElectronFallback && !options.decodeExternal) throw error;
    }
  }
  const decoder = options.decodeExternal || decodeWithElectron;
  return decoder(buffer, ext);
}

async function listSourceImages(sourceRoot) {
  const sourceDirectory = path.join(sourceRoot, 'source');
  let rootStat;
  try { rootStat = await fsp.lstat(sourceDirectory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
  const result = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        result.push(path.relative(sourceRoot, target).replace(/\\/g, '/'));
      }
    }
  }
  await walk(sourceDirectory);
  return result;
}

function referencedBackgroundIds(sceneDocument) {
  const ids = new Set();
  for (const scene of sceneDocument?.scenes || []) {
    for (const command of scene?.commands || []) {
      if (command?.type === 'background' && command.skip !== true && command.skipped !== true && command.assetId) ids.add(String(command.assetId));
    }
  }
  return ids;
}

async function inspectPceBackgrounds(sourceRoot, sceneDocument, catalog, readSource) {
  const assets = Array.isArray(catalog?.assets) ? catalog.assets : Array.isArray(catalog) ? catalog : [];
  const byId = new Map(assets.map((asset) => [String(asset?.id || ''), asset]));
  const referenced = referencedBackgroundIds(sceneDocument);
  const sourceImages = await listSourceImages(sourceRoot);
  const result = [];
  for (const assetId of [...referenced].sort()) {
    const asset = byId.get(assetId);
    if (!asset || asset.type !== 'image' || !asset.source) continue;
    const originalBuffer = await readSource(String(asset.source));
    const originalExtension = path.extname(String(asset.source)).toLowerCase();
    const originalSize = probeImageDimensions(originalBuffer, originalExtension);
    if (originalSize.width !== PCE_BACKGROUND.width || originalSize.height !== PCE_BACKGROUND.height) continue;
    const candidates = [];
    for (const relativePath of sourceImages) {
      const nameScore = candidateNameScore(relativePath, asset);
      if (nameScore <= 0) continue;
      try {
        const buffer = await readSource(relativePath);
        const size = probeImageDimensions(buffer, path.extname(relativePath));
        const larger = size.width > PCE_BACKGROUND.width || size.height > PCE_BACKGROUND.height;
        candidates.push({
          relativePath,
          format: path.extname(relativePath).slice(1).toLowerCase(),
          width: size.width,
          height: size.height,
          sha256: hashBuffer(buffer),
          score: nameScore + (larger ? 120 : 0) + Math.min(80, Math.floor(Math.log2(Math.max(1, size.width * size.height / (224 * 136))) * 20)),
          larger,
          lowQualityPath: LOW_QUALITY_PATH.test(relativePath),
        });
      } catch (_error) {
        // Broken candidates remain non-selectable instead of blocking inspection.
      }
    }
    candidates.sort((left, right) => right.score - left.score || (right.width * right.height) - (left.width * left.height) || left.relativePath.localeCompare(right.relativePath));
    const top = candidates[0];
    const second = candidates[1];
    const highConfidence = Boolean(top?.larger && !top.lowQualityPath && top.score >= 1000 && (!second || top.score - second.score >= 40));
    result.push({
      assetId,
      source: String(asset.source).replace(/\\/g, '/'),
      original: { width: originalSize.width, height: originalSize.height, sha256: hashBuffer(originalBuffer) },
      candidates: candidates.slice(0, 24),
      defaultSelection: highConfidence
        ? { mode: 'source', relativePath: top.relativePath, sha256: top.sha256, anchor: 'center' }
        : { mode: 'pce', relativePath: String(asset.source).replace(/\\/g, '/'), sha256: hashBuffer(originalBuffer), anchor: 'center' },
    });
  }
  const sourceRevision = crypto.createHash('sha256').update(JSON.stringify(result.map((entry) => ({
    assetId: entry.assetId,
    original: entry.original.sha256,
    candidates: entry.candidates.map((candidate) => [candidate.relativePath, candidate.sha256]),
  })))).digest('hex');
  return { target: TARGET_BACKGROUND, backgrounds: result, sourceRevision };
}

function resizedBackground(image, anchor) {
  return resizeRgbaCover(image, TARGET_BACKGROUND.width, TARGET_BACKGROUND.height, normalizeCropAnchor(anchor));
}

function previewDataUrl(image, anchor) {
  const resized = resizedBackground(image, anchor);
  return `data:image/png;base64,${encodeRgbaPng(resized.width, resized.height, resized.rgba).toString('base64')}`;
}

module.exports = {
  TARGET_BACKGROUND,
  PCE_BACKGROUND,
  SUPPORTED_EXTENSIONS,
  normalizeCandidateName,
  candidateNameScore,
  probeImageDimensions,
  decodeBmp,
  decodeImageBuffer,
  listSourceImages,
  referencedBackgroundIds,
  inspectPceBackgrounds,
  resizedBackground,
  previewDataUrl,
  hashBuffer,
};
