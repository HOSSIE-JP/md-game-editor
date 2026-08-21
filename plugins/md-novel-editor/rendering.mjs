import { effectiveX } from './preview-core.mjs';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeColor(value, fallback = '#ffffff') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

export function collectVisualAssetIds(visual = {}) {
  return [...new Set([
    visual.background?.assetId,
    ...(visual.sprites || []).map((entry) => entry?.assetId),
  ].filter(Boolean))];
}

function visualPalette(command, binding = null) {
  const explicit = String(command?.palette || '').toUpperCase();
  if (/^PAL[0-3]$/.test(explicit)) return explicit;
  const legacy = String(binding?.legacyPalette || binding?.palette || '').toUpperCase();
  if (/^PAL[0-3]$/.test(legacy)) return legacy;
  return command?.type === 'background' ? 'PAL1' : 'PAL2';
}

function defaultPhysicalPalette(name) {
  const palette = Array.from({ length: 16 }, () => [0, 0, 0]);
  if (name === 'PAL0') palette[1] = [255, 255, 255];
  return palette;
}

function rgbFromColor(value, fallback = [255, 255, 255]) {
  const normalized = safeColor(value, '');
  if (!normalized) return [...fallback];
  return [1, 3, 5].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
}

function isMdWhite(value) {
  return rgbFromColor(value).every((channel) => Math.round(channel * 7 / 255) === 7);
}

function clonedPalette(value, fallbackName) {
  if (!Array.isArray(value) || value.length !== 16) return defaultPhysicalPalette(fallbackName);
  return value.map((color) => [0, 1, 2].map((index) => Math.max(0, Math.min(255, Number(color?.[index]) || 0))));
}

export function physicalPaletteFrame(visual = {}, bindings = {}, indexedForAsset = () => null) {
  const owners = [];
  if (visual.background?.assetId) owners.push({ type: 'background', order: number(visual.background._paletteLoadOrder, 0), command: visual.background });
  (visual.sprites || []).forEach((sprite, slot) => {
    if (sprite?.assetId && sprite.visible !== false) owners.push({ type: 'sprite', slot, order: number(sprite._paletteLoadOrder, slot + 1), command: sprite });
  });
  owners.forEach((owner) => {
    owner.assetId = String(owner.command.assetId || '');
    owner.binding = bindings.assets?.[owner.assetId] || {};
    owner.palette = visualPalette({ ...owner.command, type: owner.type }, owner.binding);
    owner.paletteFingerprint = String(owner.binding.paletteFingerprint || owner.assetId);
  });
  owners.sort((left, right) => left.order - right.order);
  const palettes = Object.fromEntries(['PAL0', 'PAL1', 'PAL2', 'PAL3'].map((name) => [name, defaultPhysicalPalette(name)]));
  const byPalette = new Map();
  for (const owner of owners) {
    const indexed = indexedForAsset(owner.assetId);
    owner.usesPaletteIndex1 = Boolean(owner.binding.metadata?.usesPaletteIndex1)
      || Boolean(indexed?.indices?.some?.((index) => (index & 15) === 1));
    palettes[owner.palette] = clonedPalette(owner.binding.paletteRgb333 || indexed?.paletteRgb333, owner.palette);
    const entries = byPalette.get(owner.palette) || [];
    entries.push(owner);
    byPalette.set(owner.palette, entries);
  }
  palettes.PAL0[0] = [0, 0, 0];
  const pal0IndexOneOwners = (byPalette.get('PAL0') || []).filter((owner) => owner.usesPaletteIndex1);
  const spriteTextVisible = (visual.spriteTexts || []).some((entry) => entry && entry.visible !== false);
  const messageColorFallback = visual.message && !isMdWhite(visual.message.textColor) && (pal0IndexOneOwners.length || spriteTextVisible)
    ? {
      requestedColor: safeColor(visual.message.textColor),
      assetIds: [...new Set(pal0IndexOneOwners.map((owner) => owner.assetId))],
      spriteTextVisible,
    }
    : null;
  palettes.PAL0[1] = visual.message && !messageColorFallback ? rgbFromColor(visual.message.textColor) : [255, 255, 255];
  const conflicts = [];
  for (const [palette, paletteOwners] of byPalette) {
    const fingerprints = [...new Set(paletteOwners.map((owner) => owner.paletteFingerprint))];
    if (fingerprints.length > 1) conflicts.push({
      palette,
      assetIds: [...new Set(paletteOwners.map((owner) => owner.assetId))],
      lastAssetId: paletteOwners[paletteOwners.length - 1].assetId,
    });
  }
  return { palettes, owners, conflicts, messageColorFallback };
}

function indexedSurface(canvas, assetId, palette, record, transparent, cache) {
  if (!record?.indices || !record.width || !record.height) return null;
  const signature = palette.flat().join(',');
  const key = `${assetId}:${transparent ? 'sprite' : 'image'}:${signature}`;
  if (cache?.has(key)) return cache.get(key);
  const documentRef = canvas?.ownerDocument || globalThis.document;
  const surface = documentRef?.createElement?.('canvas');
  if (!surface) return null;
  surface.width = record.width;
  surface.height = record.height;
  const context = surface.getContext('2d');
  const image = context.createImageData(record.width, record.height);
  for (let index = 0; index < record.indices.length; index += 1) {
    const colorIndex = record.indices[index] & 15;
    const color = palette[colorIndex] || [0, 0, 0];
    const offset = index * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = transparent && colorIndex === 0 ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
  cache?.set(key, surface);
  return surface;
}

export function drawNovelFrame(canvas, visual = {}, options = {}) {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const coordinateMode = options.coordinateMode || 'pce-legacy-256';
  const imageForAsset = options.imageForAsset || (() => null);
  const indexedForAsset = options.indexedForAsset || (() => null);
  const bindings = options.bindings || {};
  const physical = physicalPaletteFrame(visual, bindings, indexedForAsset);
  const width = canvas.width || 320;
  const height = canvas.height || 224;
  const sourceFor = (command, type) => {
    const assetId = command?.assetId;
    const binding = bindings.assets?.[assetId] || {};
    const paletteName = visualPalette({ ...command, type }, binding);
    const record = indexedForAsset(assetId);
    return indexedSurface(canvas, assetId, physical.palettes[paletteName], record, type === 'sprite', options.paletteCanvasCache) || imageForAsset(assetId);
  };
  context.save();
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  const shake = visual.effect?.effect === 'shake' ? Math.max(0, Math.min(8, number(visual.effect.intensity, 4))) : 0;
  if (shake) context.translate((Math.floor(number(options.time) / 60) % 2 ? shake : -shake), 0);
  if (visual.background) {
    const image = sourceFor(visual.background, 'background');
    if (image) {
      const x = effectiveX('background', visual.background.x, coordinateMode);
      const y = coordinateMode === 'pce-legacy-256' ? number(visual.background.y) * 8 : number(visual.background.y);
      context.drawImage(image, x, y);
    }
  }
  for (const sprite of visual.sprites || []) {
    if (!sprite || sprite.visible === false) continue;
    const image = sourceFor(sprite, 'sprite');
    if (!image) continue;
    const metadata = bindings.assets?.[sprite.assetId]?.metadata || {};
    const frameWidth = Math.max(1, number(metadata.frameWidth, image.naturalWidth || image.width));
    const frameHeight = Math.max(1, number(metadata.frameHeight, image.naturalHeight || image.height));
    const x = effectiveX('sprite', sprite.x, coordinateMode);
    const y = number(sprite.y);
    context.save();
    context.translate(x + (sprite.flipX ? frameWidth : 0), y + (sprite.flipY ? frameHeight : 0));
    context.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
    context.drawImage(image, 0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    context.restore();
  }
  context.textBaseline = 'top';
  context.font = '16px monospace';
  context.fillStyle = `rgb(${physical.palettes.PAL0[1].join(',')})`;
  for (const entry of visual.spriteTexts || []) {
    if (!entry || entry.visible === false) continue;
    const x = effectiveX('spritetext', entry.x, coordinateMode);
    const lines = String(entry.text || '').split('\n');
    lines.forEach((line, row) => context.fillText(Array.from(line).slice(0, 32).join(''), x, number(entry.y) + row * 16));
  }
  if (visual.message || visual.choice) {
    context.fillStyle = '#000';
    context.fillRect(0, 128, 320, 96);
    context.font = '14px sans-serif';
    if (visual.message) {
      context.fillStyle = `rgb(${physical.palettes.PAL0[1].join(',')})`;
      context.fillText(String(visual.message.speaker || ''), 8, 140);
      const page = visual.message.pages?.[visual.message.pageIndex || 0] || [];
      page.forEach((line, row) => context.fillText(line, 8, 160 + row * 16));
      context.fillText(visual.autoEnabled ? '◆' : '▼', 300, 205);
    } else {
      context.fillStyle = '#fff';
      (visual.choice.choices || []).slice(0, 4).forEach((choice, index) => {
        const selected = index === number(visual.choiceIndex, visual.choice.defaultIndex || 0);
        context.fillText(`${selected ? '▶' : ' '} ${Array.from(String(choice.label || '')).slice(0, 17).join('')}`, 8, 143 + index * 19);
      });
    }
  }
  if (visual.effect && visual.effect.effect !== 'shake') {
    const effect = visual.effect.effect;
    if (effect === 'blank' || effect === 'fadeOut' || effect === 'flash') {
      context.globalAlpha = effect === 'flash' ? .65 : effect === 'fadeOut' ? .72 : 1;
      context.fillStyle = safeColor(visual.effect.color, effect === 'flash' ? '#ffffff' : '#000000');
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
    }
  }
  if (physical.conflicts.length) {
    context.lineWidth = 3;
    context.strokeStyle = '#ff3154';
    context.strokeRect(1.5, 1.5, width - 3, height - 3);
    context.fillStyle = '#ff3154';
    context.fillRect(0, 0, width, 18);
    context.fillStyle = '#fff';
    context.font = 'bold 11px sans-serif';
    context.fillText(`PAL競合: ${physical.conflicts.map((entry) => entry.palette).join(', ')}（後勝ち表示）`, 5, 3);
  }
  context.restore();
  return physical;
}
let shiftJisGlyphMap = null;

function jisCell(lead, trail) {
  let row = lead <= 0x9f ? ((lead - 0x81) * 2) + 0x21 : ((lead - 0xe0) * 2) + 0x5f;
  let column;
  if (trail >= 0x9f) {
    row += 1;
    column = trail - 0x7e;
  } else {
    column = trail - (trail < 0x7f ? 0x1f : 0x20);
  }
  return { row: row - 0x21, column: column - 0x21 };
}

export function buildShiftJisGlyphMap() {
  if (shiftJisGlyphMap) return shiftJisGlyphMap;
  shiftJisGlyphMap = new Map();
  let decoder;
  try { decoder = new TextDecoder('shift_jis', { fatal: false }); } catch (_) { return shiftJisGlyphMap; }
  const leads = [...Array.from({ length: 0x9f - 0x81 + 1 }, (_unused, index) => 0x81 + index), ...Array.from({ length: 0xef - 0xe0 + 1 }, (_unused, index) => 0xe0 + index)];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      if (trail === 0x7f) continue;
      const character = decoder.decode(new Uint8Array([lead, trail]));
      if (!character || character === '�' || shiftJisGlyphMap.has(character)) continue;
      shiftJisGlyphMap.set(character, jisCell(lead, trail));
    }
  }
  return shiftJisGlyphMap;
}

function drawAtlasGlyph(context, atlas, character, x, y, size, glyphMap) {
  if (character === ' ' || character === '\t') return;
  const cell = glyphMap.get(character);
  if (cell && atlas) {
    context.imageSmoothingEnabled = false;
    context.drawImage(atlas, cell.column * 8, cell.row * 8, 8, 8, x, y, size, size);
    return;
  }
  context.fillStyle = '#fff';
  context.font = `${Math.max(8, size - 2)}px monospace`;
  context.textBaseline = 'top';
  context.fillText(character, x, y);
}

export function drawFontPreviews(textCanvas, atlasCanvas, text, atlasImage, atlasText = text) {
  const glyphMap = buildShiftJisGlyphMap();
  const used = [...new Set(Array.from(String(atlasText || '')).filter((character) => character !== '\r' && character !== '\n'))];
  const textContext = textCanvas?.getContext?.('2d');
  if (textContext) {
    textContext.imageSmoothingEnabled = false;
    textContext.fillStyle = '#000';
    textContext.fillRect(0, 0, textCanvas.width, textCanvas.height);
    let column = 0;
    let row = 0;
    for (const character of Array.from(String(text || ''))) {
      if (character === '\r') continue;
      if (character === '\n') { column = 0; row += 1; if (row >= 4) break; continue; }
      if (column >= 19) { column = 0; row += 1; }
      if (row >= 4) break;
      drawAtlasGlyph(textContext, atlasImage, character, column * 16, 8 + row * 16, 16, glyphMap);
      column += 1;
    }
  }
  const atlasContext = atlasCanvas?.getContext?.('2d');
  if (atlasContext) {
    const rows = Math.max(1, Math.ceil(used.length / 16));
    atlasCanvas.height = Math.max(128, rows * 32);
    atlasContext.fillStyle = '#050b10';
    atlasContext.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    used.forEach((character, index) => {
      const x = (index % 16) * 32;
      const y = Math.floor(index / 16) * 32;
      atlasContext.strokeStyle = '#24465c';
      atlasContext.strokeRect(x + .5, y + .5, 31, 31);
      drawAtlasGlyph(atlasContext, atlasImage, character, x + 8, y + 8, 16, glyphMap);
    });
  }
  return used;
}

function fullWidthPreviewText(value) {
  return Array.from(String(value || '')).map((character) => {
    const code = character.codePointAt(0);
    if (code === 0x20) return '　';
    if (code >= 0x21 && code <= 0x7e) return String.fromCodePoint(code + 0xfee0);
    return character;
  }).join('');
}

export function drawSubsetFontPreviews(textCanvas, atlasCanvas, text, atlasImage, entries = [], options = {}) {
  const previewEntries = Array.isArray(options.previewEntries) ? options.previewEntries : entries;
  const previewImage = options.previewImage || atlasImage;
  const entryByCharacter = new Map(previewEntries.map((entry, index) => [entry.character, { ...entry, index }]));
  const drawGlyph = (context, character, x, y, size = 16) => {
    const entry = entryByCharacter.get(character);
    if (entry && atlasImage) {
      const sourceX = (entry.index % 16) * 16;
      const sourceY = Math.floor(entry.index / 16) * 16;
      context.imageSmoothingEnabled = false;
      context.drawImage(previewImage, sourceX, sourceY, 16, 16, x, y, size, size);
      return true;
    }
    if (character !== '　') {
      context.strokeStyle = '#ff5f6d';
      context.strokeRect(x + .5, y + .5, size - 1, size - 1);
      context.beginPath();
      context.moveTo(x + 3, y + 3);
      context.lineTo(x + size - 3, y + size - 3);
      context.moveTo(x + size - 3, y + 3);
      context.lineTo(x + 3, y + size - 3);
      context.stroke();
    }
    return false;
  };
  const textContext = textCanvas?.getContext?.('2d');
  if (textContext) {
    textContext.fillStyle = '#000';
    textContext.fillRect(0, 0, textCanvas.width, textCanvas.height);
    let column = 0;
    let row = 0;
    for (const character of Array.from(fullWidthPreviewText(text))) {
      if (character === '\r') continue;
      if (character === '\n') { column = 0; row += 1; if (row >= 4) break; continue; }
      if (column >= 19) { column = 0; row += 1; }
      if (row >= 4) break;
      drawGlyph(textContext, character, column * 16, 8 + row * 16);
      column += 1;
    }
  }
  const atlasContext = atlasCanvas?.getContext?.('2d');
  if (atlasContext) {
    const sourceHeight = Math.max(16, Math.ceil(entries.length / 16) * 16);
    atlasCanvas.width = 512;
    atlasCanvas.height = Math.max(128, sourceHeight * 2);
    atlasContext.fillStyle = '#050b10';
    atlasContext.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    atlasContext.imageSmoothingEnabled = false;
    if (atlasImage) atlasContext.drawImage(atlasImage, 0, 0, 256, sourceHeight, 0, 0, 512, sourceHeight * 2);
  }
}
