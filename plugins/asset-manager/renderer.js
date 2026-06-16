import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  MIDI_EXTS,
  allowedTypesForExtension,
  defaultSubDirForType,
  inferTypeFromExtension,
  normalizeSymbolName,
} from './asset-utils.mjs';

const DEFAULT_TYPES = ['PALETTE', 'IMAGE', 'BITMAP', 'SPRITE', 'XGM', 'XGM2', 'WAV', 'MAP', 'TILEMAP', 'TILESET'];

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  if (root) {
    root.dataset.pluginOwner = plugin.id;
  }

  const autoReload = setupAutoReloadOnOpen({ root, api, logger });

  registerCapability('asset-manager', {
    pluginId: plugin.id,
    root,
    buildPreviewPalette({ dataUrl, fallbackColors, maxColors } = {}) {
      return buildPreviewPaletteFromDataUrl(dataUrl, fallbackColors, { maxColors });
    },
  });

  registerCapability('asset-type-provider', {
    priority: 0,
    getTypeInfo(file = {}) {
      const ext = String(file.ext || '').toLowerCase();
      const initialType = inferTypeFromExtension(ext);
      const fileName = String(file.fileName || '');
      const isAudioInput = AUDIO_EXTS.includes(ext);
      const isMidiInput = MIDI_EXTS.includes(ext);
      return {
        initialType,
        allowedTypes: allowedTypesForExtension(ext, DEFAULT_TYPES),
        defaultSubdir: defaultSubDirForType(initialType),
        defaultSymbol: normalizeSymbolName(fileName),
        suggestedFileName: initialType === 'WAV' && isAudioInput
          ? `${fileName.replace(/\.[^.]+$/, '')}.wav`
          : fileName,
        isImageInput: IMAGE_EXTS.includes(ext),
        isAudioInput,
        isMidiInput,
      };
    },
  });

  registerCapability('image-import-pipeline', {
    priority: 0,
    async convertToIndexed16({ sourcePath, targetSize } = {}) {
      const resizeCapability = api.capabilities.get('image-resize');
      if (!resizeCapability?.openResizeModal) {
        return {
          canceled: true,
          convertedDataUrl: '',
          originalDataUrl: '',
          warning: '画像リサイズコンバータープラグインが無効または未インストールです',
        };
      }

      const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
      if (!read?.ok || !read.dataUrl) {
        return { canceled: true, convertedDataUrl: '', originalDataUrl: '', warning: read?.error || '' };
      }

      const img = new Image();
      img.src = read.dataUrl;
      await img.decode();

      let warning = '';
      let workingDataUrl = read.dataUrl;
      const originalIndexed = extractIndexedSourcePalette(read.dataUrl);
      const requestedWidth = Number(targetSize?.width);
      const requestedHeight = Number(targetSize?.height);
      const targetMatchesSource = (
        (!Number.isFinite(requestedWidth) || requestedWidth <= 0 || requestedWidth === img.naturalWidth)
        && (!Number.isFinite(requestedHeight) || requestedHeight <= 0 || requestedHeight === img.naturalHeight)
      );
      if (originalIndexed.format === 'png' && originalIndexed.colors.length > 0 && originalIndexed.colors.length <= 16 && targetMatchesSource) {
        return {
          canceled: false,
          convertedDataUrl: '',
          targetExtension: '.png',
          originalDataUrl: read.dataUrl,
          warning: '',
        };
      }
      if (originalIndexed.format === 'bmp' && targetMatchesSource) {
        const bmpDataUrl = await encodeBmpSourceAsIndexedPng(originalIndexed);
        if (!bmpDataUrl) {
          return {
            canceled: true,
            convertedDataUrl: '',
            originalDataUrl: read.dataUrl,
            warning: 'BMPで使用されているパレットが16色を超えています',
          };
        }
        return {
          canceled: false,
          convertedDataUrl: bmpDataUrl,
          targetExtension: '.png',
          originalDataUrl: read.dataUrl,
          warning: 'BMPのパレット0番を維持してPNGに変換しました',
        };
      }

      const resizeResult = await resizeCapability.openResizeModal(read.dataUrl, img.naturalWidth, img.naturalHeight, {
        targetSize: targetSize || null,
      });
      if (!resizeResult.ok) {
        return { canceled: true, convertedDataUrl: '', originalDataUrl: read.dataUrl, warning: 'リサイズ/クリッピングをキャンセルしました' };
      }
      if (resizeResult.skipped && originalIndexed.format === 'png' && originalIndexed.colors.length > 0 && originalIndexed.colors.length <= 16) {
        return {
          canceled: false,
          convertedDataUrl: '',
          targetExtension: '.png',
          originalDataUrl: read.dataUrl,
          warning: '',
        };
      }
      if (resizeResult.skipped && originalIndexed.format === 'bmp') {
        const bmpDataUrl = await encodeBmpSourceAsIndexedPng(originalIndexed);
        if (!bmpDataUrl) {
          return {
            canceled: true,
            convertedDataUrl: '',
            originalDataUrl: read.dataUrl,
            warning: 'BMPで使用されているパレットが16色を超えています',
          };
        }
        return {
          canceled: false,
          convertedDataUrl: bmpDataUrl,
          targetExtension: '.png',
          originalDataUrl: read.dataUrl,
          warning: 'BMPのパレット0番を維持してPNGに変換しました',
        };
      }
      if (resizeResult.dataUrl && resizeResult.dataUrl !== read.dataUrl) {
        workingDataUrl = resizeResult.dataUrl;
        warning = 'リサイズ/クリッピングを適用しました';
      }

      const workImg = new Image();
      workImg.src = workingDataUrl;
      await workImg.decode();

      const canvas = document.createElement('canvas');
      canvas.width = workImg.width;
      canvas.height = workImg.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(workImg, 0, 0);
      const imageData = ctx.getImageData(0, 0, workImg.width, workImg.height);
      const quantizeCapability = api.capabilities.get('image-quantize');
      const countColors = quantizeCapability?.countUniqueColors || api.countUniqueColors;
      const unique = countColors(imageData);
      const hasTransparent = imageData.data.some((value, index) => index % 4 === 3 && value < 128);
      const paletteSlots = unique + (hasTransparent ? 1 : 0);
      const sourceIndexed = extractIndexedPngPalette(workingDataUrl);

      if (paletteSlots <= 16) {
        let savedDataUrl = '';
        const preserveIndexed = sourceIndexed.colors.length > 0 && sourceIndexed.colors.length <= 16
          ? sourceIndexed
          : originalIndexed;
        if (preserveIndexed.colors.length > 0 && preserveIndexed.colors.length <= 16) {
          if (workingDataUrl !== read.dataUrl && preserveIndexed === originalIndexed) {
            savedDataUrl = await encodeImageDataWithIndexedPalette(imageData, preserveIndexed);
          } else {
            savedDataUrl = workingDataUrl;
          }
          savedDataUrl = await ensureIndexedTransparentIndexUsed(savedDataUrl, extractIndexedPngPalette(savedDataUrl)) || savedDataUrl;
        } else {
          try {
            const encodeIndexed = quantizeCapability?.imageDataToIndexedPng || api.imageDataToIndexedPng;
            savedDataUrl = await encodeIndexed(imageData);
          } catch (err) {
            logger.warn(`indexed PNG 変換失敗、RGBA PNG にフォールバック: ${String(err?.message || err)}`);
            savedDataUrl = workingDataUrl;
          }
        }
        return {
          canceled: false,
          convertedDataUrl: savedDataUrl,
          targetExtension: '.png',
          originalDataUrl: read.dataUrl,
          warning,
        };
      }

      if (!quantizeCapability?.openQuantizeModal) {
        return {
          canceled: true,
          convertedDataUrl: '',
          originalDataUrl: read.dataUrl,
          warning: '画像減色コンバータープラグインが無効または未インストールです',
        };
      }

      const quantized = await quantizeCapability.openQuantizeModal(workingDataUrl, { sourcePath });
      if (!quantized.ok) {
        return {
          canceled: true,
          convertedDataUrl: '',
          originalDataUrl: read.dataUrl,
          warning: '減色変換をキャンセルしました',
        };
      }

      return {
        canceled: false,
        convertedDataUrl: quantized.dataUrl,
        targetExtension: '.png',
        originalDataUrl: read.dataUrl,
        warning: `${warning ? `${warning} / ` : ''}減色変換を適用: ${unique} colors -> 16 colors`,
      };
    },
  });

  registerCapability('asset-import-handler', {
    priority: 0,
    canHandle() {
      return true;
    },
    getDefaultTypeInfo(file) {
      return api.capabilities.get('asset-type-provider')?.getTypeInfo(file) || null;
    },
  });

  logger.debug('asset-manager renderer activated');
  return {
    deactivate() {
      autoReload?.disconnect?.();
      if (root?.dataset.pluginOwner === plugin.id) {
        delete root.dataset.pluginOwner;
      }
    },
  };
}

function setupAutoReloadOnOpen({ root, api, logger }) {
  if (!root || typeof MutationObserver !== 'function') return null;

  let wasOpen = false;
  let loading = false;

  const reloadIfOpened = async () => {
    const isOpen = root.isConnected && root.classList.contains('active') && !root.hidden;
    if (!isOpen) {
      wasOpen = false;
      return;
    }
    if (wasOpen || loading) return;

    wasOpen = true;
    loading = true;
    try {
      const result = await api.assets?.reloadResources?.({ keepSelection: true });
      if (!result?.ok) {
        logger.warn(`リソース再読み込み失敗: ${result?.error || 'unknown'}`);
      }
    } catch (err) {
      logger.warn(`リソース再読み込み失敗: ${String(err?.message || err)}`);
    } finally {
      loading = false;
    }
  };

  const observer = new MutationObserver(reloadIfOpened);
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'] });
  queueMicrotask(reloadIfOpened);

  return {
    disconnect() {
      observer.disconnect();
    },
  };
}

function dataUrlBytes(dataUrl) {
  const text = String(dataUrl || '');
  const marker = ';base64,';
  const index = text.indexOf(marker);
  if (index < 0) return new Uint8Array();
  try {
    const binary = atob(text.slice(index + marker.length));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch (_) {
    return new Uint8Array();
  }
}

function extractIndexedSourcePalette(dataUrl) {
  const png = extractIndexedPngPalette(dataUrl);
  if (png.colors.length) return { ...png, format: 'png' };
  const bmp = extractIndexedBmpPalette(dataUrl);
  if (bmp.colors.length) return { ...bmp, format: 'bmp' };
  return { colors: [], transparentIndex: -1, format: '' };
}

export function buildPreviewPaletteFromDataUrl(dataUrl, fallbackColors = [], options = {}) {
  const maxColors = Math.max(1, Math.min(256, Number(options.maxColors) || 16));
  const source = extractIndexedSourcePalette(dataUrl);
  const slots = [];

  if (source.colors.length > 0) {
    source.colors.slice(0, maxColors).forEach((color, index) => {
      slots.push({
        r: color.r,
        g: color.g,
        b: color.b,
        transparent: index === source.transparentIndex,
      });
    });
    if (source.transparentIndex >= maxColors && source.transparentIndex < source.colors.length) {
      const color = source.colors[source.transparentIndex];
      slots[maxColors - 1] = { r: color.r, g: color.g, b: color.b, transparent: true };
    }
  } else {
    const fallback = Array.isArray(fallbackColors) ? fallbackColors : [];
    fallback.slice(0, maxColors).forEach((color) => {
      slots.push({
        r: Number(color?.r) || 0,
        g: Number(color?.g) || 0,
        b: Number(color?.b) || 0,
        transparent: Boolean(color?.transparent),
      });
    });
  }

  while (slots.length < maxColors) {
    slots.push({ r: 0, g: 0, b: 0, transparent: false, empty: true });
  }

  return slots.slice(0, maxColors);
}

function readU32Be(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readU16Le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readI32Le(bytes, offset) {
  const value = readU32Le(bytes, offset);
  return value > 0x7FFFFFFF ? value - 0x100000000 : value;
}

function extractIndexedPngPalette(dataUrl) {
  const bytes = dataUrlBytes(dataUrl);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    return { colors: [], transparentIndex: -1 };
  }

  let offset = 8;
  let colors = [];
  let transparentIndex = -1;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32Be(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataOffset = offset + 8;
    if (dataOffset + length > bytes.length) break;
    if (type === 'IHDR') {
      width = readU32Be(bytes, dataOffset);
      height = readU32Be(bytes, dataOffset + 4);
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
    }
    if (type === 'PLTE') {
      colors = [];
      for (let index = 0; index < Math.floor(length / 3); index += 1) {
        const base = dataOffset + index * 3;
        colors.push({ r: bytes[base], g: bytes[base + 1], b: bytes[base + 2] });
      }
    }
    if (type === 'tRNS') {
      for (let index = 0; index < length; index += 1) {
        if (bytes[dataOffset + index] === 0) {
          transparentIndex = index;
          break;
        }
      }
    }
    if (type === 'IDAT') {
      idat.push(bytes.slice(dataOffset, dataOffset + length));
    }
    if (type === 'IEND') break;
    offset = dataOffset + length + 4;
  }
  return { colors, transparentIndex, width, height, bitDepth, colorType, idat };
}

function extractIndexedBmpPalette(dataUrl) {
  const bytes = dataUrlBytes(dataUrl);
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return { colors: [], transparentIndex: -1 };
  }

  const dataOffset = readU32Le(bytes, 10);
  const dibSize = readU32Le(bytes, 14);
  const width = readI32Le(bytes, 18);
  const signedHeight = readI32Le(bytes, 22);
  const planes = readU16Le(bytes, 26);
  const bitDepth = readU16Le(bytes, 28);
  const compression = readU32Le(bytes, 30);
  if (planes !== 1 || compression !== 0 || width <= 0 || signedHeight === 0 || ![1, 2, 4, 8].includes(bitDepth)) {
    return { colors: [], transparentIndex: -1 };
  }

  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const colorCountRaw = readU32Le(bytes, 46);
  const totalColors = colorCountRaw || (1 << bitDepth);
  const paletteOffset = 14 + dibSize;
  const availableColors = Math.max(0, Math.min(totalColors, Math.floor((Math.min(dataOffset, bytes.length) - paletteOffset) / 4)));
  if (availableColors <= 0) {
    return { colors: [], transparentIndex: -1 };
  }

  const colors = [];
  for (let index = 0; index < availableColors; index += 1) {
    const base = paletteOffset + index * 4;
    colors.push({ r: bytes[base + 2], g: bytes[base + 1], b: bytes[base] });
  }

  const rowStride = Math.floor((width * bitDepth + 31) / 32) * 4;
  if (dataOffset + rowStride * height > bytes.length) {
    return { colors: [], transparentIndex: -1 };
  }

  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceOffset = dataOffset + sourceY * rowStride;
    unpackIndexedRow(bytes.slice(sourceOffset, sourceOffset + rowStride), bitDepth, indices, y * width, width);
  }

  return {
    colors,
    transparentIndex: 0,
    width,
    height,
    bitDepth,
    colorType: 3,
    idat: [],
    indices,
  };
}

async function ensureIndexedTransparentIndexUsed(dataUrl, png) {
  if (png.colorType !== 3 || png.transparentIndex !== 0 || !png.colors.length || !png.idat?.length) {
    return '';
  }

  const indices = await decodeIndexedPngIndices(png);
  if (!indices.length || indices.some((index) => index === 0)) {
    return '';
  }

  indices[indices.length - 1] = 0;
  return encodeIndexedPng8(png.width, png.height, indices, png.colors, 0);
}

async function encodeBmpSourceAsIndexedPng(bmp) {
  if (!bmp?.indices?.length || !bmp?.colors?.length || bmp.width <= 0 || bmp.height <= 0) {
    return '';
  }

  const used = new Set();
  bmp.indices.forEach((index) => {
    if (index >= 0 && index < bmp.colors.length) used.add(index);
  });
  used.add(0);
  if (used.size > 16) return '';

  const sourceIndices = Array.from(used).sort((left, right) => left - right);
  const palette = [];
  const remap = new Map();
  sourceIndices.forEach((sourceIndex) => {
    remap.set(sourceIndex, palette.length);
    palette.push(bmp.colors[sourceIndex] || { r: 0, g: 0, b: 0 });
  });
  if (remap.get(0) !== 0) return '';

  const indices = new Uint8Array(bmp.indices.length);
  for (let offset = 0; offset < bmp.indices.length; offset += 1) {
    indices[offset] = remap.get(bmp.indices[offset]) ?? 0;
  }
  return encodeIndexedPng8(bmp.width, bmp.height, indices, palette, -1);
}

async function encodeImageDataWithIndexedPalette(imageData, png) {
  if (!imageData?.data || !png?.colors?.length) return '';
  const indices = new Uint8Array(imageData.width * imageData.height);
  const hasTransparent = png.transparentIndex >= 0 && png.transparentIndex < png.colors.length;
  const data = imageData.data;

  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    if (hasTransparent && data[offset + 3] < 128) {
      indices[pixel] = png.transparentIndex;
      continue;
    }
    indices[pixel] = nearestPaletteIndex({
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2],
    }, png.colors);
  }

  return encodeIndexedPng8(imageData.width, imageData.height, indices, png.colors, png.transparentIndex);
}

function nearestPaletteIndex(color, palette) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((entry, index) => {
    const dr = color.r - entry.r;
    const dg = color.g - entry.g;
    const db = color.b - entry.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

async function decodeIndexedPngIndices(png) {
  if (![1, 2, 4, 8].includes(png.bitDepth) || png.width <= 0 || png.height <= 0) {
    return new Uint8Array();
  }

  const compressedLength = png.idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let offset = 0;
  png.idat.forEach((chunk) => {
    compressed.set(chunk, offset);
    offset += chunk.length;
  });

  const inflated = await inflateBytes(compressed);
  const rowBytes = Math.ceil((png.width * png.bitDepth) / 8);
  if (inflated.length < (rowBytes + 1) * png.height) return new Uint8Array();

  const rows = [];
  let sourceOffset = 0;
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < png.height; y += 1) {
    const filter = inflated[sourceOffset];
    const row = inflated.slice(sourceOffset + 1, sourceOffset + 1 + rowBytes);
    const decoded = unfilterPngRow(filter, row, prev);
    rows.push(decoded);
    prev = decoded;
    sourceOffset += rowBytes + 1;
  }

  const indices = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    unpackIndexedRow(rows[y], png.bitDepth, indices, y * png.width, png.width);
  }
  return indices;
}

async function inflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function unfilterPngRow(filter, row, prev) {
  const out = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index > 0 ? out[index - 1] : 0;
    const up = prev[index] || 0;
    const upLeft = index > 0 ? prev[index - 1] || 0 : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paethPredictor(left, up, upLeft);
    out[index] = (row[index] + predictor) & 0xFF;
  }
  return out;
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

function unpackIndexedRow(row, bitDepth, indices, destOffset, width) {
  for (let x = 0; x < width; x += 1) {
    if (bitDepth === 8) {
      indices[destOffset + x] = row[x];
    } else if (bitDepth === 4) {
      const value = row[Math.floor(x / 2)];
      indices[destOffset + x] = x % 2 === 0 ? (value >> 4) & 0x0F : value & 0x0F;
    } else if (bitDepth === 2) {
      const value = row[Math.floor(x / 4)];
      indices[destOffset + x] = (value >> (6 - (x % 4) * 2)) & 0x03;
    } else {
      const value = row[Math.floor(x / 8)];
      indices[destOffset + x] = (value >> (7 - (x % 8))) & 0x01;
    }
  }
}

async function encodeIndexedPng8(width, height, indices, palette, transparentIndex) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  writeU32Be(ihdrData, 0, width);
  writeU32Be(ihdrData, 4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 3;

  const plteData = new Uint8Array(palette.length * 3);
  palette.forEach((color, index) => {
    plteData[index * 3] = color.r;
    plteData[index * 3 + 1] = color.g;
    plteData[index * 3 + 2] = color.b;
  });

  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    raw.set(indices.slice(y * width, y * width + width), y * (width + 1) + 1);
  }

  const chunks = [
    signature,
    pngChunk('IHDR', ihdrData),
    pngChunk('PLTE', plteData),
  ];
  if (transparentIndex >= 0 && transparentIndex < palette.length) {
    const trnsData = new Uint8Array(transparentIndex + 1).fill(255);
    trnsData[transparentIndex] = 0;
    chunks.push(pngChunk('tRNS', trnsData));
  }
  chunks.push(
    pngChunk('IDAT', await deflateBytes(raw)),
    pngChunk('IEND', new Uint8Array()),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return blobToDataUrl(new Blob([result], { type: 'image/png' }));
}

async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  writeU32Be(chunk, 0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  writeU32Be(chunk, 8 + data.length, crc32(chunk, 4, 8 + data.length));
  return chunk;
}

function writeU32Be(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xFF;
  bytes[offset + 1] = (value >>> 16) & 0xFF;
  bytes[offset + 2] = (value >>> 8) & 0xFF;
  bytes[offset + 3] = value & 0xFF;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start, end) {
  let crc = 0xFFFFFFFF;
  for (let index = start; index < end; index += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}
