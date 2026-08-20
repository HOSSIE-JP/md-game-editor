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

export function drawNovelFrame(canvas, visual = {}, options = {}) {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const coordinateMode = options.coordinateMode || 'pce-legacy-256';
  const imageForAsset = options.imageForAsset || (() => null);
  const bindings = options.bindings || {};
  const width = canvas.width || 320;
  const height = canvas.height || 224;
  context.save();
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  const shake = visual.effect?.effect === 'shake' ? Math.max(0, Math.min(8, number(visual.effect.intensity, 4))) : 0;
  if (shake) context.translate((Math.floor(number(options.time) / 60) % 2 ? shake : -shake), 0);
  if (visual.background) {
    const image = imageForAsset(visual.background.assetId);
    if (image) {
      const x = effectiveX('background', visual.background.x, coordinateMode);
      const y = coordinateMode === 'pce-legacy-256' ? number(visual.background.y) * 8 : number(visual.background.y);
      context.drawImage(image, x, y);
    }
  }
  for (const sprite of visual.sprites || []) {
    if (!sprite || sprite.visible === false) continue;
    const image = imageForAsset(sprite.assetId);
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
  for (const entry of visual.spriteTexts || []) {
    if (!entry || entry.visible === false) continue;
    context.fillStyle = safeColor(entry.color);
    const x = effectiveX('spritetext', entry.x, coordinateMode);
    const lines = String(entry.text || '').split('\n');
    lines.forEach((line, row) => context.fillText(Array.from(line).slice(0, 32).join(''), x, number(entry.y) + row * 16));
  }
  if (visual.message || visual.choice) {
    context.fillStyle = '#070b11';
    context.fillRect(0, 128, 320, 96);
    context.strokeStyle = '#8298b3';
    context.strokeRect(.5, 128.5, 319, 95);
    context.font = '14px sans-serif';
    if (visual.message) {
      context.fillStyle = safeColor(visual.message.textColor);
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
  context.restore();
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
