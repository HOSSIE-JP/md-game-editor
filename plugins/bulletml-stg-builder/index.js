'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const manifest = require('./manifest.json');
const service = require('../bulletml-stg-editor/bulletml-service');
const documentService = require('../bulletml-stg-editor/stg-document-service');
const compiler = require('../bulletml-stg-editor/bulletml-compiler');
const simulator = require('../bulletml-stg-editor/bulletml-simulator');
const schema = require('../bulletml-stg-editor/bulletml-schema');
const vnService = require('../bulletml-stg-editor/stg-vn-service');
const sharedVn = require('../shared/md-vn');
const vnCompiler = require('../shared/md-vn/compiler');
const vnRuntimeAssets = require('../shared/md-vn/runtime-assets');
const tmxParser = require('../shared/tilemap/tmx-parser-core');

const SOURCE_FILES = Object.freeze([
  'src/main.c',
  'src/bulletml/bulletml_runtime.c',
  'src/bulletml/bulletml_lut.c',
  'src/bulletml/bulletml_game.c',
  'src/generated/bulletml_catalog.c',
  'src/novel_runtime/novel_runtime.c',
  'src/generated/novel_data.c',
]);

const STATIC_FILES = Object.freeze({
  'src/main.c': 'src/main.c',
  'src/bulletml/bulletml_runtime.c': 'src/bulletml/bulletml_runtime.c',
  'src/bulletml/bulletml_game.c': 'src/bulletml/bulletml_game.c',
  'inc/bulletml/bulletml_runtime.h': 'inc/bulletml/bulletml_runtime.h',
  'inc/bulletml/bulletml_lut.h': 'inc/bulletml/bulletml_lut.h',
  'inc/bulletml/bulletml_game.h': 'inc/bulletml/bulletml_game.h',
});

const DEFAULT_BULLET_SOURCE = 'gfx/bulletml_bullet.png';
const DIAGNOSTIC_LOAD_RESOURCES = Object.freeze([
  Object.freeze({ key: 'burst', symbol: 'bml_internal_diagnostic_burst', relative: 'res/bulletml/internal/diagnostic-burst-v1.bmlb' }),
  Object.freeze({ key: 'idle', symbol: 'bml_internal_diagnostic_idle', relative: 'res/bulletml/internal/diagnostic-idle-v1.bmlb' }),
]);

function templateRoot() { return path.join(__dirname, 'template'); }
function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function copyFile(source, destination) { ensureDir(path.dirname(destination)); fs.copyFileSync(source, destination); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function indexedPng(width, height, pixel, palette) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(16 * 3);
  const colors = palette.slice(0, 16);
  while (colors.length < 16) colors.push([0, 0, 0]);
  colors.forEach((color, index) => { plte[index * 3] = color[0]; plte[index * 3 + 1] = color[1]; plte[index * 3 + 2] = color[2]; });
  const transparency = Buffer.from([0, ...Array(15).fill(255)]);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + x + 1] = pixel(x, y) & 15;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('PLTE', plte), pngChunk('tRNS', transparency), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function wavTone(frequency, seconds, mode = 'sine') {
  const rate = 6650;
  const samples = Math.max(32, Math.round(rate * seconds));
  const data = Buffer.alloc(samples);
  for (let index = 0; index < samples; index += 1) {
    const envelope = 1 - index / samples;
    const phase = index * frequency / rate;
    const wave = mode === 'noise' ? ((((index * 1103515245 + 12345) >>> 16) & 255) / 127.5 - 1) : Math.sin(phase * Math.PI * 2);
    data[index] = Math.max(0, Math.min(255, Math.round(128 + wave * 100 * envelope)));
  }
  const output = Buffer.alloc(44 + data.length);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate, 28); output.writeUInt16LE(1, 32); output.writeUInt16LE(8, 34); output.write('data', 36); output.writeUInt32LE(data.length, 40); data.copy(output, 44);
  return output;
}

function vgmPsg(notes, bass = false) {
  const headerSize = 0x100;
  const commands = [];
  const write = (value) => { commands.push(0x50, value & 0xff); };
  const setTone = (channel, period, volume) => {
    write(0x80 | ((channel & 3) << 5) | (period & 15));
    write((period >> 4) & 63);
    write(0x90 | ((channel & 3) << 5) | (volume & 15));
  };
  for (let bar = 0; bar < 8; bar += 1) for (let step = 0; step < notes.length; step += 1) {
    setTone(0, notes[step], 2);
    if (bass) setTone(1, notes[(step + 2) % notes.length] * 2, 6);
    for (let frame = 0; frame < 15; frame += 1) commands.push(0x62);
  }
  write(0x9f); write(0xbf); commands.push(0x66);
  const output = Buffer.alloc(headerSize + commands.length);
  output.write('Vgm ', 0); output.writeUInt32LE(output.length - 4, 4); output.writeUInt32LE(0x00000171, 8); output.writeUInt32LE(3579545, 0x0c);
  const totalSamples = 8 * notes.length * 15 * 735;
  output.writeUInt32LE(totalSamples, 0x18); output.writeUInt32LE(headerSize - 0x1c, 0x1c); output.writeUInt32LE(totalSamples, 0x20); output.writeUInt32LE(headerSize - 0x34, 0x34);
  Buffer.from(commands).copy(output, headerSize);
  return output;
}

function palette() {
  return [[0, 0, 0], [238, 246, 255], [76, 201, 240], [67, 97, 238], [128, 237, 153], [249, 199, 79], [249, 132, 74], [247, 37, 133], [181, 23, 158], [114, 9, 183], [63, 55, 201], [35, 61, 77], [65, 90, 119], [119, 141, 169], [255, 84, 112], [255, 255, 255]];
}

function staticAssets() {
  const colors = palette();
  const diamond = (size, primary, secondary) => indexedPng(size, size, (x, y) => {
    const distance = Math.abs(x - (size - 1) / 2) + Math.abs(y - (size - 1) / 2);
    if (distance > size * .55) return 0;
    return distance < size * .22 ? secondary : primary;
  }, colors);
  const verticalBackground = indexedPng(320, 224, (x, y) => {
    const lane = x % 40;
    if ((x % 32 === 4 && y % 32 === 6) || (x % 32 === 23 && y % 32 === 19)) return (x + y) % 3 ? 2 : 1;
    if (lane === 0 || lane === 39) return 12;
    return ((Math.trunc(x / 40) + Math.trunc(y / 32)) & 1) ? 0 : 11;
  }, colors);
  const horizontalBackground = indexedPng(320, 224, (x, y) => {
    const band = y % 32;
    if ((x % 40 === 7 && y % 24 === 5) || (x % 40 === 29 && y % 24 === 17)) return (x + y) % 3 ? 7 : 1;
    if (band === 0 || band === 31) return 10;
    return ((Math.trunc(x / 40) + Math.trunc(y / 32)) & 1) ? 0 : 9;
  }, colors);
  return {
    'res/gfx/bml_bg_vertical.png': verticalBackground,
    'res/gfx/bml_bg_horizontal.png': horizontalBackground,
    'res/gfx/bulletml_bullet.png': diamond(8, 5, 15),
    'res/gfx/bml_player.png': indexedPng(16, 16, (x, y) => y > 2 && y < 15 && Math.abs(x - 7.5) < (y - 1) * .55 ? (y > 11 ? 3 : 2) : 0, colors),
    'res/gfx/bml_player_shot.png': indexedPng(8, 8, (x, y) => x >= 3 && x <= 4 && y <= 6 ? 4 : 0, colors),
    'res/gfx/bml_grunt.png': diamond(16, 6, 5),
    'res/gfx/bml_turret.png': indexedPng(16, 16, (x, y) => (x > 2 && x < 13 && y > 4 && y < 14) ? (x > 6 && x < 9 ? 7 : 6) : 0, colors),
    'res/gfx/bml_boss.png': indexedPng(32, 32, (x, y) => { const dx = Math.abs(x - 15.5); const dy = Math.abs(y - 15.5); return dx + dy < 17 ? (dx < 6 && dy < 6 ? 15 : dx > 12 ? 8 : 7) : 0; }, colors),
    'res/audio/bml_vertical.vgm': vgmPsg([428, 381, 339, 320, 285, 320, 339, 381], true),
    'res/audio/bml_horizontal.vgm': vgmPsg([339, 320, 285, 254, 285, 320, 381, 320], true),
    'res/audio/bml_shot.wav': wavTone(880, .07),
    'res/audio/bml_hit.wav': wavTone(180, .18, 'noise'),
    'res/audio/bml_destroy.wav': wavTone(90, .28, 'noise'),
  };
}

function bulletSpriteConfig(snapshot, projectDir = '') {
  const entries = [
    { path: 'project.defaultSprite', sprite: snapshot.project.defaultSprite },
    ...snapshot.patterns.map((pattern) => ({ path: `patterns.${pattern.id}.sprite`, sprite: pattern.sprite })),
  ];
  const first = entries[0].sprite;
  const symbol = String(first.asset?.symbol || '');
  let source = '';
  if (projectDir) {
    const matches = documentService.buildAssetIndex(projectDir).index.get(symbol) || [];
    if (matches.length !== 1) throw new Error(matches.length ? `ResComp弾sprite symbolが重複しています: ${symbol}` : `ResComp弾sprite symbolがありません: ${symbol}`);
    if (String(matches[0].type || '').toUpperCase() !== 'SPRITE') throw new Error(`ResComp弾asset ${symbol} はSPRITEではありません`);
    source = String(matches[0].sourcePath || '').replace(/\\/g, '/').replace(/^res\//, '');
  }
  const frameWidth = Number(first.frameWidth);
  const frameHeight = Number(first.frameHeight);
  const frameCount = Number(first.frameCount);
  const tileCount = Number(first.tileCount);
  const errors = [];
  const comparable = ['palette', 'frameWidth', 'frameHeight', 'frameCount', 'hardwarePieces', 'tileCount'];
  for (const entry of entries) {
    if (String(entry.sprite.asset?.symbol || '') !== symbol || String(entry.sprite.asset?.type || '').toUpperCase() !== 'SPRITE') errors.push(`${entry.path}.asset: 全patternがproject.defaultSpriteと同じSPRITE symbolを使う必要があります`);
    for (const key of comparable) {
      const left = entry.sprite[key];
      const right = first[key];
      if (String(left) !== String(right)) errors.push(`${entry.path}.${key}: v1 runtimeでは全patternがproject.defaultSpriteと同じ共有spriteを使う必要があります`);
    }
  }
  if (!symbol) errors.push('project.defaultSprite.asset.symbol: SPRITE symbolを指定してください');
  if (projectDir && (!source || path.posix.isAbsolute(source) || source.split('/').includes('..'))) errors.push('project.defaultSprite.asset: ResComp SPRITEのsourceがres内相対pathではありません');
  if (![8, 16, 24, 32].includes(frameWidth) || ![8, 16, 24, 32].includes(frameHeight)) errors.push('project.defaultSprite: frameは8〜32pxの8px単位で指定してください');
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 255) errors.push('project.defaultSprite.frameCount: 1..255で指定してください');
  if (Number(first.hardwarePieces) !== 1) errors.push('project.defaultSprite.hardwarePieces: 1 hardware pieceだけ使用できます');
  if (String(first.palette) !== 'PAL3') errors.push('project.defaultSprite.palette: PAL3を指定してください');
  const expectedTiles = frameWidth * frameHeight / 64 * frameCount;
  if (tileCount !== expectedTiles) errors.push(`project.defaultSprite.tileCount: ${expectedTiles}を指定してください`);
  if (expectedTiles > 128) errors.push(`project.defaultSprite.tileCount: ${expectedTiles} tileは上限128を超えています`);
  if (errors.length) throw new Error(`BulletML弾sprite契約に違反しています:\n${errors.join('\n')}`);
  return { symbol, source, animationRow: Number(first.asset?.animationRow) || 0, frameWidth, frameHeight, frameCount, tileCount, paletteFingerprint: String(first.paletteFingerprint || '') };
}

function parseIndexedPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new Error('PNG signatureが不正です');
  let offset = 8;
  let ihdr = null;
  let plte = null;
  let ended = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('PNG chunk headerが途中で終わっています');
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error('PNG chunkが途中で終わっています');
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) throw new Error(`PNG ${type} chunkのCRCが不正です`);
    if (type === 'IHDR') {
      if (ihdr || length !== 13) throw new Error('PNG IHDRが不正です');
      ihdr = Buffer.from(data);
    } else if (type === 'PLTE') {
      if (plte || !length || length % 3) throw new Error('PNG PLTEが不正です');
      plte = Buffer.from(data);
    } else if (type === 'IEND') {
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ihdr || !plte || !ended) throw new Error('PNGにIHDR/PLTE/IENDが揃っていません');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (colorType !== 3 || ![1, 2, 4, 8].includes(bitDepth)) throw new Error('弾spriteはindexed-color PNGである必要があります');
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) throw new Error('非標準compression/filterまたはinterlace PNGは使用できません');
  if (plte.length > 16 * 3) throw new Error(`弾sprite paletteは16色以下です（現在${plte.length / 3}色）`);
  const paletteRgb = Array.from({ length: plte.length / 3 }, (_, index) => [plte[index * 3], plte[index * 3 + 1], plte[index * 3 + 2]]);
  return { width, height, bitDepth, colors: plte.length / 3, paletteFingerprint: sha256(plte), paletteRgb };
}

function generatedIndexedTileCount(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') chunks.push(data);
    offset += 12 + length;
  }
  if (!width || !height || width % 8 || height % 8 || !chunks.length) throw new Error('生成背景PNGのtile gridが不正です');
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width + 1;
  if (raw.length !== stride * height) throw new Error('生成背景PNGのscanline長が不正です');
  const tiles = new Set();
  for (let tileY = 0; tileY < height; tileY += 8) for (let tileX = 0; tileX < width; tileX += 8) {
    const rows = [];
    for (let row = 0; row < 8; row += 1) {
      const scanline = (tileY + row) * stride;
      if (raw[scanline] !== 0) throw new Error('生成背景PNGはfilter 0である必要があります');
      rows.push(raw.subarray(scanline + 1 + tileX, scanline + 1 + tileX + 8));
    }
    tiles.add(Buffer.concat(rows).toString('hex'));
  }
  return tiles.size;
}

function readProjectJson(projectDir, relativePath) {
  const target = vnService.resolveInside(projectDir, relativePath);
  if (!fs.existsSync(target)) throw new Error(`${relativePath} がありません`);
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { throw new Error(`${relativePath}: JSON parse error: ${error.message}`); }
}

function resolveRegisteredAsset(assetIndex, symbol, type) {
  const matches = assetIndex?.index?.get(symbol) || [];
  const expected = String(type || '').toUpperCase();
  const typed = matches.filter((entry) => !expected || String(entry.type || '').toUpperCase() === expected);
  if (typed.length !== 1) throw new Error(`VN assetを一意に解決できません: ${symbol} (${expected || 'ANY'})`);
  return typed[0];
}

function resolveMapTilesetAsset(projectDir, assetIndex, mapSymbol) {
  const mapAsset = resolveRegisteredAsset(assetIndex, mapSymbol, 'MAP');
  const root = path.resolve(projectDir);
  const mapPath = path.resolve(mapAsset.sourceAbsolutePath);
  const ensureInside = (target, label) => {
    const resolved = path.resolve(target);
    const relative = path.relative(root, resolved);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return resolved;
    throw new Error(`${label} がproject root外を参照しています: ${target}`);
  };
  const tmxText = fs.readFileSync(ensureInside(mapPath, 'TMX'), 'utf8');
  const parsed = tmxParser.parseTmx(tmxText);
  let imagePath;
  if (parsed.tilesetSource) {
    const tsxPath = ensureInside(path.resolve(path.dirname(mapPath), parsed.tilesetSource), 'TSX');
    const tsx = tmxParser.parseTsx(fs.readFileSync(tsxPath, 'utf8'));
    imagePath = ensureInside(path.resolve(path.dirname(tsxPath), tsx.imageSource), 'TSX image');
  } else {
    const image = /<tileset\b[^>]*>[\s\S]*?<image\b[^>]*\bsource\s*=\s*(["'])(.*?)\1/i.exec(tmxText);
    if (!image) throw new Error(`TMX tileset imageを解決できません: ${mapSymbol}`);
    imagePath = ensureInside(path.resolve(path.dirname(mapPath), image[2]), 'TMX image');
  }
  const candidates = [];
  for (const [symbol, entries] of assetIndex?.index || []) {
    for (const entry of entries) {
      if (String(entry.type || '').toUpperCase() === 'TILESET' && path.resolve(entry.sourceAbsolutePath) === imagePath) candidates.push({ symbol, entry });
    }
  }
  if (candidates.length !== 1) throw new Error(`MAP ${mapSymbol}のTSX imageに対応するTILESET assetを一意に登録してください: ${path.relative(root, imagePath)}`);
  const info = parseIndexedPng(fs.readFileSync(imagePath));
  if (info.width % 8 || info.height % 8) throw new Error(`MAP tilesetは8px gridである必要があります: ${mapSymbol}`);
  const palette = info.paletteRgb.map(([red, green, blue]) => ((Math.round(blue * 7 / 255) << 9) | (Math.round(green * 7 / 255) << 5) | (Math.round(red * 7 / 255) << 1)));
  while (palette.length < 16) palette.push(0);
  return { symbol: candidates[0].symbol, imagePath, tileCount: (info.width / 8) * (info.height / 8), paletteFingerprint: info.paletteFingerprint, palette: palette.slice(0, 16) };
}

function prepareNovelIntegration(projectDir, snapshot, assetIndex) {
  const validation = vnService.validateDemoBindings(projectDir, snapshot);
  if (!validation.ok) {
    const first = validation.diagnostics.find((entry) => entry.severity === 'error');
    throw new Error(`BulletML Demo validation failed: ${first?.path || '-'}: ${first?.message || 'invalid scene'}`);
  }
  const sceneDocument = validation.canonical.sceneDocument;
  const catalog = readProjectJson(projectDir, 'assets/pce-assets.json');
  const backgroundSource = vnService.resolveInside(projectDir, 'assets/images/vn_abyss.png');
  const spriteSource = vnService.resolveInside(projectDir, 'assets/sprites/vn_geroneko.png');
  if (!fs.existsSync(backgroundSource) || !fs.existsSync(spriteSource)) throw new Error('VN Showcase画像assetがありません');
  const demoMusic = resolveRegisteredAsset(assetIndex, 'bgm_demo', 'XGM2');
  const backgroundPng = fs.readFileSync(backgroundSource);
  const spritePng = fs.readFileSync(spriteSource);
  const backgroundInfo = parseIndexedPng(backgroundPng);
  const spriteInfo = parseIndexedPng(spritePng);
  if (backgroundInfo.width !== 320 || backgroundInfo.height !== 224) throw new Error('VN backgroundは320x224 indexed 16色である必要があります');
  if (spriteInfo.width !== 64 || spriteInfo.height !== 96) throw new Error('VN actorは64x96 indexed 16色である必要があります');

  const targetProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'template', 'template_md_novel', 'data', 'md-novel', 'target-profile.json'), 'utf8'));
  targetProfile.coordinateMode = 'md-native-320';
  targetProfile.video.legacyViewportX = 0;
  const fontSource = fs.readFileSync(vnRuntimeAssets.bundledAtlasPath());
  const plan = sharedVn.createFontSubsetPlan(sceneDocument, targetProfile.font, fontSource);
  const fontPng = sharedVn.font.generateBundledAtlas(plan, fontSource);
  const fontPlan = {
    entries: plan.entries.map((entry) => ({ character: entry.character, code: entry.code })),
    width: plan.width,
    height: plan.height,
    inputHash: plan.inputHash,
  };
  const bindings = {
    schemaVersion: 1,
    sourceSceneRevision: sharedVn.hashDocument(sceneDocument),
    assets: {
      bg_abyss: {
        assetId: 'bg_abyss', sourceType: 'image', runtimeType: 'IMAGE', symbol: 'nov_stg_bg_abyss', palette: 'PAL0',
        sourcePath: 'novel/backgrounds/abyss.png', originalSource: 'assets/images/vn_abyss.png', paletteFingerprint: backgroundInfo.paletteFingerprint,
        metadata: { width: 320, height: 224, uniqueTiles: generatedIndexedTileCount(backgroundPng), paletteEntries: backgroundInfo.colors, paletteIndicesUsed: [2, 3, 4, 5, 6], transparent: false, frameWidth: 320, frameHeight: 224, maxNumTile: 0, maxNumSprite: 0, timing: '', collision: '' },
      },
      sp_geroneko: {
        assetId: 'sp_geroneko', sourceType: 'sprite', runtimeType: 'SPRITE', symbol: 'nov_stg_sp_geroneko', palette: 'PAL2',
        sourcePath: 'novel/sprites/geroneko.png', originalSource: 'assets/sprites/vn_geroneko.png', paletteFingerprint: spriteInfo.paletteFingerprint,
        metadata: { width: 64, height: 96, uniqueTiles: generatedIndexedTileCount(spritePng), paletteEntries: spriteInfo.colors, paletteIndicesUsed: [0, 2, 3, 4, 5], transparent: true, frameWidth: 64, frameHeight: 96, maxNumTile: 96, maxNumSprite: 6, timing: '[[12]]', collision: 'NONE' },
      },
    },
    audioVariants: {
      'demo_bgm@0': { key: 'demo_bgm@0', assetId: 'demo_bgm', channel: 0, sourceType: 'psg-song', runtimeType: 'XGM2', symbol: 'nov_stg_demo_bgm', sourcePath: 'novel/music/demo.vgm', status: 'ready' },
    },
  };
  for (const symbol of ['nov_stg_bg_abyss', 'nov_stg_sp_geroneko', 'nov_stg_demo_bgm', 'novel_font_subset', 'nov_msg_16x16', 'nov_msg_8x8']) {
    const conflicts = (assetIndex?.index?.get(symbol) || []).filter((entry) => !/(?:^|[\\/])novel\.res$/i.test(String(entry.file || '')));
    if (conflicts.length) throw new Error(`VN generated ResComp symbolが既存assetと衝突します: ${symbol}`);
  }
  const generated = vnCompiler.generateProject({ sceneDocument, catalog, bindings, fontPlan, targetProfile });
  const files = {
    ...vnRuntimeAssets.collectRuntimeFiles(),
    ...generated.files,
    'res/novel/font/generated.png': fontPng,
    'res/novel/backgrounds/abyss.png': backgroundPng,
    'res/novel/sprites/geroneko.png': spritePng,
    'res/novel/music/demo.vgm': fs.readFileSync(demoMusic.sourceAbsolutePath),
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    service.atomicWriteFile(vnService.resolveInside(projectDir, relativePath), contents);
  }
  const sceneIndexes = Object.fromEntries((sceneDocument.scenes || []).map((scene, index) => [String(scene.id || ''), index]));
  const variables = vnCompiler.collectVariableTable(sceneDocument);
  const flagBindings = (snapshot.demoBindings.flags || []).map((name) => {
    const variableIndex = variables.index.get(String(name));
    if (!Number.isInteger(variableIndex)) throw new Error(`Demo flagに対応するVN variableがありません: ${name}`);
    return { name: String(name), variableIndex };
  });
  return {
    sceneDocument,
    sceneIndexes,
    flagBindings,
    report: generated.report,
    warnings: generated.warnings,
    files: Object.keys(files).sort(),
    sourceSceneRevision: bindings.sourceSceneRevision,
  };
}

function parseLinkerRamSymbols(contents) {
  const symbols = new Map();
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{8})\s+\S\s+(\S+)$/);
    if (match) symbols.set(match[2], Number.parseInt(match[1], 16) & 0xffffff);
  }
  const edata = symbols.get('_edata');
  const bend = symbols.get('_bend');
  if (!Number.isInteger(edata) || !Number.isInteger(bend) || (edata & 0xff0000) !== 0xff0000 || (bend & 0xff0000) !== 0xff0000 || bend < edata) {
    throw new Error('SGDK symbol.txtから_edata/_bendを解決できません');
  }
  const stackReserveBytes = 0x0a00;
  const initializedBytes = edata & 0xffff;
  const staticBytes = bend & 0xffff;
  const bssBytes = staticBytes - initializedBytes;
  const heapBytesBeforeRuntimeAllocation = 0x10000 - stackReserveBytes - ((staticBytes + 1) & ~1) - 2;
  return {
    totalBytes: 0x10000,
    initializedBytes,
    bssBytes,
    staticBytes,
    stackReserveBytes,
    heapBytesBeforeRuntimeAllocation,
    withinBudget: heapBytesBeforeRuntimeAllocation >= 4096,
  };
}

function bulletAssetPath(projectDir, config) {
  return service.resolveProjectPath(projectDir, path.posix.join('res', config.source));
}

function ensureDefaultBulletAsset(projectDir, config) {
  const target = bulletAssetPath(projectDir, config);
  if (fs.existsSync(target)) return target;
  if (config.source !== DEFAULT_BULLET_SOURCE || config.frameWidth !== 8 || config.frameHeight !== 8 || config.frameCount !== 1) {
    throw new Error(`弾spriteがありません: res/${config.source}`);
  }
  service.atomicWriteFile(target, staticAssets()['res/gfx/bulletml_bullet.png']);
  return target;
}

function validateBulletSpriteAsset(projectDir, snapshot, config = bulletSpriteConfig(snapshot)) {
  const target = bulletAssetPath(projectDir, config);
  if (!fs.existsSync(target)) throw new Error(`弾spriteがありません: res/${config.source}`);
  const contents = fs.readFileSync(target);
  const parsed = parseIndexedPng(contents);
  if (parsed.height !== config.frameHeight || parsed.width !== config.frameWidth * config.frameCount) {
    throw new Error(`弾sprite画像は1行のanimation sheet ${config.frameWidth * config.frameCount}x${config.frameHeight}pxである必要があります（現在${parsed.width}x${parsed.height}px）`);
  }
  const fingerprints = new Set([
    snapshot.project.defaultSprite.paletteFingerprint,
    ...snapshot.patterns.map((pattern) => pattern.sprite.paletteFingerprint),
  ].map((value) => String(value || '')).filter(Boolean));
  if (fingerprints.size > 1 || (fingerprints.size === 1 && !fingerprints.has(parsed.paletteFingerprint))) {
    throw new Error(`弾sprite palette fingerprintがPNGと一致しません: ${parsed.paletteFingerprint}`);
  }
  return { ...config, ...parsed, relativePath: `res/${config.source}`, sha256: sha256(contents) };
}

function gameResourceSource(config) {
  return Buffer.from([
    'IMAGE bml_bg_vertical "gfx/bml_bg_vertical.png" NONE ALL 0',
    'IMAGE bml_bg_horizontal "gfx/bml_bg_horizontal.png" NONE ALL 0',
    `SPRITE bml_bullet "${config.source}" ${config.frameWidth / 8} ${config.frameHeight / 8} NONE 0 NONE BALANCED FAST FALSE`,
    'SPRITE bml_player "gfx/bml_player.png" 2 2 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE bml_player_shot "gfx/bml_player_shot.png" 1 1 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE bml_grunt "gfx/bml_grunt.png" 2 2 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE bml_turret "gfx/bml_turret.png" 2 2 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE bml_boss "gfx/bml_boss.png" 4 4 NONE 0 NONE BALANCED FAST FALSE',
    'XGM2 bml_bgm_vertical "audio/bml_vertical.vgm"',
    'XGM2 bml_bgm_horizontal "audio/bml_horizontal.vgm"',
    'WAV bml_sfx_shot "audio/bml_shot.wav" XGM2 6650 FALSE',
    'WAV bml_sfx_hit "audio/bml_hit.wav" XGM2 6650 FALSE',
    'WAV bml_sfx_destroy "audio/bml_destroy.wav" XGM2 6650 FALSE',
    '',
  ].join('\n'), 'utf8');
}

function generateLutSource() {
  const lines = (values, width = 16) => Array.from({ length: Math.ceil(values.length / width) }, (_, row) => `    ${values.slice(row * width, row * width + width).join(', ')}`).join(',\n');
  const trig = Array.from({ length: 1024 }, (_, index) => Math.round(Math.sin(index * Math.PI * 2 / 1024) * 16384));
  const atan = Array.from({ length: 256 }, (_, index) => Math.round(Math.atan(index / 255) * 65536 / (Math.PI * 2)));
  return `#include "bulletml/bulletml_lut.h"\n\nconst s16 BML_sinQ14[1024] = {\n${lines(trig)}\n};\n\nconst u16 BML_atanTurn[256] = {\n${lines(atan)}\n};\n`;
}

function cIdentifier(value) { return String(value || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1'); }
function cString(value) { return JSON.stringify(String(value || '')); }

function selfTestCrc(pattern, rank = 0.5) {
  const compiled = compiler.compilePattern(pattern);
  const vm = new simulator.BulletmlVm(compiled.bytes, { seed: 0xace1 });
  vm.setRank(rank); vm.setPlayer(160, 196); vm.startEmitter({ x: 160, y: 28, orientation: 'vertical' });
  let crc = 0xffffffff;
  for (let frame = 0; frame < 10000; frame += 1) { vm.tick(); vm.applyDisplayBudget(); crc = vm.stateCrc(crc); }
  return { value: (crc ^ 0xffffffff) >>> 0, sha256: compiled.sha256 };
}

function diagnosticPatternSprite(snapshot, bulletSprite) {
  const projectSprite = snapshot.project.defaultSprite || {};
  return {
    ...schema.DEFAULT_SPRITE,
    ...projectSprite,
    source: bulletSprite.source,
    frameWidth: bulletSprite.frameWidth,
    frameHeight: bulletSprite.frameHeight,
    frameCount: bulletSprite.frameCount,
    tileCount: bulletSprite.tileCount,
    paletteFingerprint: bulletSprite.paletteFingerprint || projectSprite.paletteFingerprint || 'builder-diagnostic',
  };
}

function reserveDiagnosticHostSprite(budget, x, y, width, height) {
  const top = Math.max(0, Math.floor(y - height / 2));
  const bottom = Math.min(223, Math.ceil(y + height / 2) - 1);
  if (budget.globalSprites >= simulator.GLOBAL_SPRITES) return false;
  for (let line = top; line <= bottom; line += 1) {
    if (budget.scanlinePieces[line] + 1 > simulator.SCANLINE_PIECES || budget.scanlineDots[line] + width > simulator.SCANLINE_DOTS) return false;
  }
  budget.globalSprites += 1;
  for (let line = top; line <= bottom; line += 1) {
    budget.scanlinePieces[line] += 1;
    budget.scanlineDots[line] += width;
  }
  return true;
}

function runDiagnosticLoadProof(burst, idle) {
  const burstVm = new simulator.BulletmlVm(burst.bytes, { seed: 0xace1 });
  const idleVms = Array.from({ length: 4 }, (_, index) => new simulator.BulletmlVm(idle.bytes, { seed: 0xace1 + index + 1 }));
  const vms = [burstVm, ...idleVms];
  const emitters = [
    burstVm.startEmitter({ x: 160, y: 112, direction: 2048, orientation: 'vertical' }),
    ...idleVms.map((vm, index) => vm.startEmitter({ x: [40, 100, 220, 280][index], y: [32, 64, 144, 176][index], orientation: 'vertical' })),
  ];
  for (const vm of vms) { vm.setPlayer(160, 196); vm.setRank(0.5); }
  const frames = 140;
  const maxima = { bullets: 0, emitters: 0, contexts: 0, opcodes: 0, spawns: 0, globalSprites: 0, pieces: 0, dots: 0 };
  let hostBudgetOk = emitters.every((value) => value >= 0);
  for (let frame = 0; frame < frames; frame += 1) {
    let opcodes = 0;
    let spawns = 0;
    for (const vm of vms) {
      vm.tick();
      const metrics = vm.getMetrics();
      opcodes += metrics.opcodesThisFrame;
      spawns += vm.spawnedThisFrame;
    }
    let budget = { globalSprites: 0, scanlinePieces: Array(224).fill(0), scanlineDots: Array(224).fill(0) };
    for (const position of [[160, 196], [160, 112], [40, 32], [100, 64], [220, 144], [280, 176]]) {
      hostBudgetOk = reserveDiagnosticHostSprite(budget, position[0], position[1], 16, 16) && hostBudgetOk;
    }
    for (const vm of vms) {
      const display = vm.applyDisplayBudget(budget);
      budget = { globalSprites: display.globalSprites, scanlinePieces: display.scanlinePieces, scanlineDots: display.scanlineDots };
    }
    const metrics = vms.map((vm) => vm.getMetrics());
    maxima.bullets = Math.max(maxima.bullets, ...[vms.reduce((sum, vm) => sum + vm.getBullets().length, 0)]);
    maxima.emitters = Math.max(maxima.emitters, metrics.reduce((sum, value) => sum + value.emitters, 0));
    maxima.contexts = Math.max(maxima.contexts, metrics.reduce((sum, value) => sum + value.contexts, 0));
    maxima.opcodes = Math.max(maxima.opcodes, opcodes);
    maxima.spawns = Math.max(maxima.spawns, spawns);
    maxima.globalSprites = Math.max(maxima.globalSprites, budget.globalSprites);
    maxima.pieces = Math.max(maxima.pieces, ...budget.scanlinePieces);
    maxima.dots = Math.max(maxima.dots, ...budget.scanlineDots);
  }
  const finalMetrics = vms.map((vm) => vm.getMetrics());
  const drops = {
    fire: finalMetrics.reduce((sum, value) => sum + value.fireDrops, 0),
    pool: finalMetrics.reduce((sum, value) => sum + value.poolDrops, 0),
    spawn: finalMetrics.reduce((sum, value) => sum + value.spawnDrops, 0),
    context: finalMetrics.reduce((sum, value) => sum + value.contextDrops, 0),
    opcodeExhaustions: finalMetrics.reduce((sum, value) => sum + value.opcodeExhaustions, 0),
    displayDeletes: finalMetrics.reduce((sum, value) => sum + value.displayDeletes, 0),
  };
  const expected = {
    bullets: schema.LIMITS.bullets,
    emitters: schema.LIMITS.emitters,
    spawnsPerFrame: schema.LIMITS.spawnsPerFrame,
    globalSprites: simulator.GLOBAL_SPRITES,
    scanlinePieces: simulator.SCANLINE_PIECES,
    scanlineDots: simulator.SCANLINE_DOTS,
    subticksPerFrame: 1280,
  };
  const ok = hostBudgetOk
    && maxima.bullets === expected.bullets
    && maxima.emitters === expected.emitters
    && maxima.spawns === expected.spawnsPerFrame
    && maxima.globalSprites <= expected.globalSprites
    && maxima.pieces <= expected.scanlinePieces
    && maxima.dots <= expected.scanlineDots
    && Object.values(drops).every((value) => value === 0);
  return {
    ok,
    frames,
    seed: '0xACE1',
    rank: 0.5,
    audioResources: ['bml_bgm_vertical', 'bml_sfx_shot'],
    expected,
    maxima,
    drops,
    bmlb: { burstSha256: burst.sha256, idleSha256: idle.sha256 },
  };
}

function diagnosticLoadBundle(snapshot, bulletSprite = bulletSpriteConfig(snapshot)) {
  const sprite = diagnosticPatternSprite(snapshot, bulletSprite);
  const inlineBullet = { ref: '', params: [], inline: { actions: [] } };
  const fire = { op: 'fire', direction: { type: 'sequence', value: '22.5' }, speed: { type: 'absolute', value: '1' }, bullet: inlineBullet };
  const burstPattern = schema.normalizePattern({
    id: 'builder-diagnostic-burst',
    name: 'Builder Diagnostic 48 Bullet Burst',
    type: 'none',
    rootActions: ['top'],
    sprite,
    hitbox: { x: 0, y: 0, radius: 3 },
    lifetime: 600,
    margin: 32,
    definitions: [{
      kind: 'action',
      label: 'top',
      commands: [{
        op: 'repeat',
        times: '3',
        action: {
          commands: [
            { op: 'repeat', times: '16', action: { commands: [fire] } },
            { op: 'wait', value: '60' },
          ],
        },
      }],
    }],
  });
  const idlePattern = schema.normalizePattern({
    id: 'builder-diagnostic-idle',
    name: 'Builder Diagnostic Idle Emitter',
    type: 'none',
    rootActions: ['top'],
    sprite,
    hitbox: { x: 0, y: 0, radius: 3 },
    lifetime: 600,
    margin: 32,
    definitions: [{ kind: 'action', label: 'top', commands: [{ op: 'wait', value: '1000' }] }],
  });
  const burst = { pattern: burstPattern, ...compiler.compilePattern(burstPattern) };
  const idle = { pattern: idlePattern, ...compiler.compilePattern(idlePattern) };
  const proof = runDiagnosticLoadProof(burst, idle);
  if (!proof.ok) throw new Error('Builder diagnostic load proof failed: ' + JSON.stringify({ maxima: proof.maxima, drops: proof.drops }));
  return { burst, idle, proof };
}

function writeDiagnosticLoadResources(projectDir, bundle) {
  const resourceLines = [];
  const generatedFiles = [];
  for (const resource of DIAGNOSTIC_LOAD_RESOURCES) {
    const output = service.resolveProjectPath(projectDir, resource.relative);
    service.atomicWriteFile(output, bundle[resource.key].bytes);
    generatedFiles.push(resource.relative);
    resourceLines.push('BIN ' + resource.symbol + ' "' + resource.relative.replace(/^res\//, '') + '"');
  }
  const resourcePath = service.resolveProjectPath(projectDir, 'res/bulletml.res');
  const existing = fs.readFileSync(resourcePath, 'utf8').replace(/\s*$/, '');
  service.atomicWriteFile(resourcePath, existing + '\n' + resourceLines.join('\n') + '\n');
  generatedFiles.push('res/bulletml.res');
  return generatedFiles;
}

function generateLegacyCatalog(snapshot, bulletSprite = bulletSpriteConfig(snapshot)) {
  const diagnosticLoad = diagnosticLoadBundle(snapshot, bulletSprite);
  const patternIndexes = new Map(snapshot.patterns.map((pattern, index) => [pattern.id, index]));
  const patternLines = snapshot.patterns.map((pattern) => {
    const symbol = `bmlb_${cIdentifier(pattern.id)}`;
    const byteLength = compiler.compilePattern(pattern).bytes.length;
    return `    { ${symbol}, ${byteLength}, ${cString(pattern.id)}, ${{ none: 0, vertical: 1, horizontal: 2 }[pattern.type]} }`;
  });
  const eventArrays = snapshot.stages.map((stage) => {
    const name = `bml_${stage.orientation}_events`;
    const entries = stage.events.slice().sort((left, right) => left.spawnFrame - right.spawnFrame).map((event) => {
      const points = Array.from({ length: 8 }, (_, index) => event.path[index] || { x: 0, y: 0, frame: 0 }).map((point) => `{ ${Math.trunc(point.x)}, ${Math.trunc(point.y)}, ${Math.trunc(point.frame)} }`).join(', ');
      const thresholds = Array.from({ length: 8 }, (_, index) => event.phases[index]?.threshold || 0).join(', ');
      const phases = Array.from({ length: 8 }, (_, index) => patternIndexes.get(event.phases[index]?.patternId) ?? patternIndexes.get(event.patternId) ?? 0).join(', ');
      return `    { ${event.spawnFrame}, ${event.hp}, ${event.score}, ${{ grunt: 0, turret: 1, boss: 2 }[event.enemyType] ?? 0}, ${event.boss ? 1 : 0}, ${patternIndexes.get(event.patternId) ?? 0}, ${event.path.length}, ${Math.min(8, event.phases.length)}, { ${points} }, { ${thresholds} }, { ${phases} } }`;
    });
    return { name, source: `static const BML_GameEvent ${name}[${Math.max(1, entries.length)}] = {\n${entries.length ? entries.join(',\n') : '    { 0 }'}\n};`, count: entries.length, duration: stage.durationFrames, horizontal: stage.orientation === 'horizontal' };
  });
  const test = selfTestCrc(snapshot.patterns[0], snapshot.project.rank);
  const source = `#include <genesis.h>\n#include <bulletml.h>\n#include "bulletml/bulletml_game.h"\n#include "generated/bulletml_catalog.h"\n\nconst BML_GamePattern bmlGamePatterns[${Math.max(1, patternLines.length)}] = {\n${patternLines.length ? patternLines.join(',\n') : '    { NULL, 0, "none", 0 }'}\n};\nconst u8 bmlGamePatternCount = ${patternLines.length};\n\n${eventArrays.map((entry) => entry.source).join('\n\n')}\n\nconst BML_GameStage bmlGameStages[2] = {\n${eventArrays.map((entry) => `    { ${entry.name}, ${entry.count}, ${entry.duration}, ${entry.horizontal ? 'TRUE' : 'FALSE'} }`).join(',\n')}\n};\n`;
  const header = `#ifndef GENERATED_BULLETML_CATALOG_H\n#define GENERATED_BULLETML_CATALOG_H\n\n#define BML_SELF_TEST_EXPECTED_CRC 0x${test.value.toString(16).padStart(8, '0').toUpperCase()}UL\n#define BML_SELF_TEST_PATTERN_INDEX 0\n#define BML_BULLET_FRAME_COUNT ${bulletSprite.frameCount}\n#define BML_BULLET_FRAME_TICKS 8\n\n#endif\n`;
  const diagnosticHeader = [
    '',
    '#define BML_DIAGNOSTIC_BURST_SIZE ' + diagnosticLoad.burst.bytes.length,
    '#define BML_DIAGNOSTIC_IDLE_SIZE ' + diagnosticLoad.idle.bytes.length,
    '#define BML_DIAGNOSTIC_LOAD_FRAMES ' + diagnosticLoad.proof.frames,
    '#define BML_DIAGNOSTIC_NTSC_SUBTICKS_PER_FRAME 1280',
    '',
  ].join('\n');
  const headerWithDiagnostics = header.replace('\n#endif\n', diagnosticHeader + '\n#endif\n');
  return { source, header: headerWithDiagnostics, selfTest: test, diagnosticLoad };
}

const CATALOG_LIMITS = Object.freeze({ emitters: 8, placements: 16, movementPoints: 16, bossParts: 16, phases: 8, bands: 8, next: 8, legacyPath: 8 });

function collectionEntries(snapshot, kind) {
  return Array.isArray(snapshot?.[kind]?.entries) ? snapshot[kind].entries : Array.isArray(snapshot?.collections?.[kind]?.entries) ? snapshot.collections[kind].entries : [];
}

function stableRuntimeId(snapshot, kind, id) {
  if (!id) return 0;
  const value = Number(snapshot?.runtimeIds?.catalogs?.[kind]?.[id]);
  if (!Number.isInteger(value) || value < 1 || value > 255) throw new Error(`stable runtime IDがありません: ${kind}.${id}`);
  return value;
}

function cBool(value) { return value ? 'TRUE' : 'FALSE'; }
function q8(value) { return Math.max(-2147483648, Math.min(2147483647, Math.round(Number(value || 0) * 256))); }
function q16Rank(value) { return value == null ? -1 : Math.max(0, Math.min(65535, Math.round(Number(value) * 65535))); }
function cArray(items, size, fallback) { return Array.from({ length: size }, (_, index) => items[index] == null ? fallback : items[index]).join(', '); }
function cResourceSymbol(value) {
  const symbol = String(value || '').trim();
  if (!symbol) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) throw new Error(`ResComp symbolをC識別子として使用できません: ${symbol}`);
  return symbol;
}
function spriteInitializer(value) {
  const symbol = cResourceSymbol(value?.symbol);
  return symbol ? `{ &${symbol}, ${Math.max(0, Math.min(255, Math.trunc(Number(value?.animationRow) || 0)))} }` : '{ NULL, 0 }';
}
function audioPointer(value) {
  const symbol = cResourceSymbol(value?.symbol);
  return symbol ? { pointer: symbol, size: `sizeof(${symbol})` } : { pointer: 'NULL', size: '0' };
}
function patternIndexFor(patternIndexes, id) { return patternIndexes.has(id) ? patternIndexes.get(id) : 255; }
function interpolationCode(value) { return ({ step: 0, linear: 1, smoothstep: 2 })[value] ?? 0; }
function waveCode(value) { return ({ none: 0, sine: 1, 'dual-sine': 2, ripple: 3, shear: 4, jitter: 5 })[value] ?? 0; }
function waveInitializer(value = {}) {
  return `{ ${waveCode(value.preset)}, ${Math.trunc(Number(value.start) || 0)}, ${Math.trunc(Number(value.end) || 0)}, ${q8(value.amplitude)}, ${Math.max(1, Math.trunc(Number(value.wavelength) || 64))}, ${q8(value.speed)}, ${Math.trunc(Number(value.fadeFrames) || 0)} }`;
}
function itemTypeCode(value) { return ({ weapon: 0, bomb: 1, score: 2 })[value] ?? 2; }

function resourceHeaders(assetIndex) {
  const names = new Set(['bulletml']);
  for (const matches of assetIndex?.index?.values?.() || []) for (const entry of matches || []) {
    const name = path.basename(String(entry.file || ''), path.extname(String(entry.file || '')));
    if (name) names.add(name);
  }
  return Array.from(names).sort().map((name) => `#include <${name}.h>`).join('\n');
}

function buildCollisionCatalogs(snapshot, projectDir, assetIndex) {
  if (!projectDir || !assetIndex) return [];
  const solidId = stableRuntimeId(snapshot, 'collision-materials', 'solid');
  const damageId = stableRuntimeId(snapshot, 'collision-materials', 'damage');
  const result = [];
  for (const stage of snapshot.stages || []) {
    const reference = stage.collisionMap;
    if (!reference?.symbol) continue;
    const matches = assetIndex.index.get(reference.symbol) || [];
    if (matches.length !== 1 || String(matches[0].type).toUpperCase() !== 'MAP') throw new Error(`collision MAP assetを一意に解決できません: ${reference.symbol}`);
    const text = fs.readFileSync(matches[0].sourceAbsolutePath, 'utf8');
    const map = tmxParser.parseTmx(text);
    const layer = tmxParser.findLayer(map, reference.collisionLayer);
    if (!layer) throw new Error(`collision layerがありません: ${reference.symbol}.${reference.collisionLayer}`);
    const mapping = { 0: 0, 1: solidId, 2: damageId, 4: damageId };
    const unknown = Array.from(new Set(layer.data.filter((value) => mapping[value] == null)));
    if (unknown.length) throw new Error(`collision layerに未割当tile値があります: ${reference.symbol}.${layer.name} = ${unknown.join(', ')}`);
    const values = layer.data.map((value) => mapping[value]);
    const rle = tmxParser.encodeRle(values);
    if (rle.length > 65535) throw new Error(`collision RLEが65535 byteを超えています: ${stage.id}`);
    result.push({ stageId: stage.id, stageRuntimeId: stableRuntimeId(snapshot, 'stages', stage.id), width: map.width, height: map.height, tileWidth: map.tileWidth, tileHeight: map.tileHeight, layerName: layer.name, rle });
  }
  return result;
}

function generateCatalog(snapshot, bulletSprite = bulletSpriteConfig(snapshot), options = {}) {
  const assetIndex = options.assetIndex || (options.projectDir ? documentService.buildAssetIndex(options.projectDir) : null);
  const demo = options.demo || { sceneIndexes: {}, flagBindings: [] };
  const demoSceneIndex = (sceneId) => Number.isInteger(demo.sceneIndexes?.[String(sceneId || '')]) ? demo.sceneIndexes[String(sceneId || '')] : -1;
  const diagnosticLoad = diagnosticLoadBundle(snapshot, bulletSprite);
  const patternIndexes = new Map(snapshot.patterns.map((pattern, index) => [pattern.id, index]));
  const patternLines = snapshot.patterns.map((pattern) => {
    const symbol = `bmlb_${cIdentifier(pattern.id)}`;
    const byteLength = compiler.compilePattern(pattern).bytes.length;
    return `    { ${symbol}, ${byteLength}, ${cString(pattern.id)}, ${{ none: 0, vertical: 1, horizontal: 2 }[pattern.type] ?? 0} }`;
  });
  const patternRuntimeIds = snapshot.patterns.map((pattern) => stableRuntimeId(snapshot, 'patterns', pattern.id));

  const weapons = collectionEntries(snapshot, 'weapons');
  const items = collectionEntries(snapshot, 'items');
  const effects = collectionEntries(snapshot, 'effects');
  const explosions = collectionEntries(snapshot, 'explosions');
  const movements = collectionEntries(snapshot, 'movements');
  const enemies = collectionEntries(snapshot, 'enemies');
  const bosses = collectionEntries(snapshot, 'bosses');
  const backgrounds = collectionEntries(snapshot, 'backgrounds');
  const materials = collectionEntries(snapshot, 'collision-materials');
  const enemyById = new Map(enemies.map((entry) => [entry.id, entry]));
  const bossById = new Map(bosses.map((entry) => [entry.id, entry]));

  const weaponLines = weapons.map((entry) => {
    const emitters = (entry.emitters || []).slice(0, CATALOG_LIMITS.emitters).map((emitter) => `{ ${Math.trunc(Number(emitter.x) || 0)}, ${Math.trunc(Number(emitter.y) || 0)}, ${Math.trunc(Number(emitter.angle) || 0)} }`);
    return `    { ${stableRuntimeId(snapshot, 'weapons', entry.id)}, ${cString(entry.id)}, ${cString(entry.name)}, ${spriteInitializer(entry.sprite)}, ${Math.trunc(entry.intervalFrames)}, ${Math.trunc(entry.damage)}, ${q8(entry.speed)}, ${Math.trunc(entry.simultaneous)}, ${Math.trunc(entry.duplicateScore)}, { ${cArray(emitters, CATALOG_LIMITS.emitters, '{ 0, 0, 0 }')} }, ${emitters.length} }`;
  });
  const itemLines = items.map((entry) => `    { ${stableRuntimeId(snapshot, 'items', entry.id)}, ${cString(entry.id)}, ${itemTypeCode(entry.type)}, ${spriteInitializer(entry.sprite)}, ${stableRuntimeId(snapshot, 'weapons', entry.weaponId)}, ${Math.trunc(entry.amount)}, ${Math.trunc(entry.score)} }`);
  const effectLines = effects.map((entry) => {
    const audio = audioPointer(entry.se);
    return `    { ${stableRuntimeId(snapshot, 'effects', entry.id)}, ${cString(entry.id)}, ${spriteInitializer(entry.sprite)}, ${Math.trunc(entry.durationFrames)}, ${audio.pointer}, ${audio.size} }`;
  });
  const explosionLines = explosions.map((entry) => {
    const placements = (entry.placements || []).slice(0, CATALOG_LIMITS.placements).map((placement) => `{ ${Math.trunc(placement.frame)}, ${stableRuntimeId(snapshot, 'effects', placement.effectId)}, ${Math.trunc(placement.x)}, ${Math.trunc(placement.y)} }`);
    return `    { ${stableRuntimeId(snapshot, 'explosions', entry.id)}, ${cString(entry.id)}, { ${cArray(placements, CATALOG_LIMITS.placements, '{ 0, 0, 0, 0 }')} }, ${placements.length} }`;
  });
  const movementLines = movements.map((entry) => {
    const points = (entry.waypoints || []).slice(0, CATALOG_LIMITS.movementPoints).map((point) => `{ ${Math.trunc(point.x)}, ${Math.trunc(point.y)}, ${Math.trunc(point.durationFrames)}, ${interpolationCode(point.interpolation)} }`);
    return `    { ${stableRuntimeId(snapshot, 'movements', entry.id)}, ${cString(entry.id)}, ${cBool(entry.loop)}, { ${cArray(points, CATALOG_LIMITS.movementPoints, '{ 0, 0, 0, 0 }')} }, ${points.length} }`;
  });
  const enemyLines = enemies.map((entry) => {
    const audio = audioPointer(entry.se);
    return `    { ${stableRuntimeId(snapshot, 'enemies', entry.id)}, ${cString(entry.id)}, ${spriteInitializer(entry.sprite)}, ${Math.trunc(entry.hp)}, ${Math.trunc(entry.score)}, ${Math.trunc(entry.hitbox?.x || 0)}, ${Math.trunc(entry.hitbox?.y || 0)}, ${Math.trunc(entry.hitbox?.radius || 0)}, ${stableRuntimeId(snapshot, 'movements', entry.movementId)}, ${patternIndexFor(patternIndexes, entry.patternId)}, ${stableRuntimeId(snapshot, 'items', entry.drop?.itemId)}, ${stableRuntimeId(snapshot, 'explosions', entry.explosionId)}, ${audio.pointer}, ${audio.size}, ${cBool(entry.destructibleBackground)} }`;
  });
  const bossLines = bosses.map((entry) => {
    const audio = audioPointer(entry.se);
    const parts = (entry.parts || []).slice(0, CATALOG_LIMITS.bossParts).map((part) => `{ ${cString(part.id)}, ${Math.trunc(part.hp)}, ${q8(part.globalHpTransfer)}, ${Math.trunc(part.hitbox?.x || 0)}, ${Math.trunc(part.hitbox?.y || 0)}, ${Math.trunc(part.hitbox?.radius || 0)}, ${stableRuntimeId(snapshot, 'explosions', part.explosionId)}, ${cString(part.disableEventId)}, ${cBool(part.followBackground)} }`);
    const partIndexes = new Map((entry.parts || []).slice(0, CATALOG_LIMITS.bossParts).map((part, index) => [part.id, index]));
    const phases = (entry.phases || []).slice(0, CATALOG_LIMITS.phases).map((phase) => {
      const active = Array.isArray(phase.activeParts) && phase.activeParts.length ? phase.activeParts : [...partIndexes.keys()];
      const activePartMask = active.reduce((mask, id) => partIndexes.has(id) ? mask | (1 << partIndexes.get(id)) : mask, 0);
      return `{ ${Math.trunc(phase.threshold)}, ${patternIndexFor(patternIndexes, phase.patternId)}, ${stableRuntimeId(snapshot, 'movements', phase.movementId)}, ${stableRuntimeId(snapshot, 'backgrounds', phase.backgroundId)}, ${activePartMask}, ${cBool(phase.clearBullets)}, ${q16Rank(phase.rankOverride)}, ${waveInitializer(phase.wave)} }`;
    });
    return `    { ${stableRuntimeId(snapshot, 'bosses', entry.id)}, ${cString(entry.id)}, ${spriteInitializer(entry.sprite)}, ${Math.trunc(entry.hp)}, ${Math.trunc(entry.score)}, ${Math.trunc(entry.hitbox?.radius || 0)}, ${stableRuntimeId(snapshot, 'movements', entry.movementId)}, ${patternIndexFor(patternIndexes, entry.patternId)}, ${stableRuntimeId(snapshot, 'items', entry.drop?.itemId)}, ${stableRuntimeId(snapshot, 'explosions', entry.explosionId)}, ${audio.pointer}, ${audio.size}, { ${cArray(parts, CATALOG_LIMITS.bossParts, '{ NULL, 0, 0, 0, 0, 0, 0, NULL, FALSE }')} }, ${parts.length}, { ${cArray(phases, CATALOG_LIMITS.phases, `{ 0, 255, 0, 0, 0, FALSE, -1, ${waveInitializer()} }`)} }, ${phases.length} }`;
  });
  const mapTilesets = new Map();
  const mapTileset = (mapSymbol) => {
    if (!mapTilesets.has(mapSymbol)) {
      const resolved = resolveMapTilesetAsset(options.projectDir, assetIndex, mapSymbol);
      resolved.paletteSymbol = `bml_bg_palette_${resolved.paletteFingerprint.slice(0, 12)}`;
      mapTilesets.set(mapSymbol, resolved);
    }
    return mapTilesets.get(mapSymbol);
  };
  const planeInitializer = (plane = {}) => {
    const mapSymbol = cResourceSymbol(plane.map?.symbol);
    const tileset = mapSymbol ? mapTileset(plane.map.symbol) : null;
    const bands = (plane.bands || []).slice(0, CATALOG_LIMITS.bands).map((band) => `{ ${Math.trunc(band.start)}, ${Math.trunc(band.end)}, ${q8(band.multiplier)} }`);
    return `{ ${mapSymbol ? `&${mapSymbol}` : 'NULL'}, ${tileset ? `&${cResourceSymbol(tileset.symbol)}` : 'NULL'}, ${tileset ? tileset.paletteSymbol : 'NULL'}, { ${cArray(bands, CATALOG_LIMITS.bands, '{ 0, 0, 0 }')} }, ${bands.length}, ${waveInitializer(plane.wave)} }`;
  };
  const backgroundLines = backgrounds.map((entry) => {
    const bgm = audioPointer(entry.bgm);
    return `    { ${stableRuntimeId(snapshot, 'backgrounds', entry.id)}, ${cString(entry.id)}, ${planeInitializer(entry.BG_A)}, ${planeInitializer(entry.BG_B)}, ${entry.transition === 'fade' ? 1 : 0}, ${Math.trunc(entry.fadeFrames)}, ${bgm.pointer} }`;
  });
  const materialLines = materials.map((entry) => {
    const mask = (entry.masks?.player ? 1 : 0) | (entry.masks?.enemy ? 2 : 0) | (entry.masks?.playerShot ? 4 : 0) | (entry.masks?.enemyShot ? 8 : 0);
    return `    { ${stableRuntimeId(snapshot, 'collision-materials', entry.id)}, ${cString(entry.id)}, ${cBool(entry.solid)}, ${Math.trunc(entry.damage)}, ${mask} }`;
  });

  const backgroundTilesetEntries = [...mapTilesets.values()];
  const uniqueBackgroundTilesets = [...new Map(backgroundTilesetEntries.map((entry) => [`${entry.symbol}:${entry.paletteFingerprint}`, entry])).values()];
  const paletteBySymbol = new Map(backgroundTilesetEntries.map((entry) => [entry.paletteSymbol, entry.palette]));
  const backgroundPaletteDefinitions = [...paletteBySymbol].map(([symbol, values]) => `const u16 ${symbol}[16] = { ${values.map((value) => `0x${value.toString(16).padStart(4, '0')}`).join(', ')} };`).join('\n');
  const backgroundPaletteDeclarations = [...paletteBySymbol.keys()].map((symbol) => `extern const u16 ${symbol}[16];`).join('\n');
  const planeReserve = (planeName) => Math.max(0, ...backgrounds.map((entry) => {
    const symbol = entry?.[planeName]?.map?.symbol;
    return symbol ? mapTileset(symbol).tileCount : 0;
  }));
  const bgATileReserve = planeReserve('BG_A');
  const bgBTileReserve = planeReserve('BG_B');
  if (bgATileReserve + bgBTileReserve + bulletSprite.tileCount > 900) throw new Error(`Background + bullet tile reserveが900 tileを超えています: ${bgATileReserve + bgBTileReserve + bulletSprite.tileCount}`);

  const collisionCatalogs = buildCollisionCatalogs(snapshot, options.projectDir, assetIndex);
  const collisionIndexByStage = new Map(collisionCatalogs.map((entry, index) => [entry.stageId, index]));
  const collisionArrays = collisionCatalogs.map((entry, index) => `static const u8 bml_collision_rle_${index}[${Math.max(1, entry.rle.length)}] = { ${entry.rle.length ? entry.rle.join(', ') : '0'} };`);
  const collisionLines = collisionCatalogs.map((entry, index) => `    { ${entry.stageRuntimeId}, ${entry.width}, ${entry.height}, ${entry.tileWidth}, ${entry.tileHeight}, bml_collision_rle_${index}, ${entry.rle.length}, ${cString(entry.layerName)} }`);

  const typedActionCodes = { spawn_enemy: 0, spawn_boss: 1, spawn_destructible: 2, set_scroll: 3, set_background: 4, set_wave: 5, set_flag: 6, clear_bullets: 7, stage_clear: 8 };
  const triggerCodes = { frame: 0, scroll: 1, condition: 2 };
  const stageBundles = (snapshot.stages || []).map((stage, stageIndex) => {
    const sorted = (stage.events || []).slice().sort((left, right) => (left.order - right.order) || String(left.id).localeCompare(String(right.id)));
    const typed = sorted.map((event) => {
      const action = event.action || {};
      const trigger = event.trigger || {};
      const triggerValue = trigger.type === 'scroll' ? q8(trigger.scroll) : q8(trigger.frame);
      const spawnEnemy = action.type === 'spawn_enemy' || action.type === 'spawn_destructible';
      const spawnBoss = action.type === 'spawn_boss';
      const setBackground = action.type === 'set_background';
      return `    { ${cString(event.id)}, ${Math.trunc(event.order)}, ${triggerCodes[trigger.type] ?? 0}, ${triggerValue}, ${cString(trigger.flag)}, ${cString(trigger.operator)}, ${trigger.type === 'condition' ? stableRuntimeId(snapshot, 'bosses', trigger.bossId) : 0}, ${typedActionCodes[action.type] ?? 0}, ${spawnEnemy ? stableRuntimeId(snapshot, 'enemies', action.enemyId) : 0}, ${spawnBoss ? stableRuntimeId(snapshot, 'bosses', action.bossId) : 0}, ${setBackground ? stableRuntimeId(snapshot, 'backgrounds', action.backgroundId) : 0}, ${(spawnEnemy || spawnBoss) ? stableRuntimeId(snapshot, 'movements', event.movementId || action.movementId) : 0}, ${(spawnEnemy || spawnBoss) ? stableRuntimeId(snapshot, 'items', event.dropItemId || action.itemId) : 0}, ${(spawnEnemy || spawnBoss) ? patternIndexFor(patternIndexes, event.patternId || action.patternId) : 255}, ${action.plane === 'BG_B' ? 1 : 0}, ${q8(action.value)}, ${Math.trunc(action.durationFrames)}, ${interpolationCode(action.interpolation)}, ${action.transition === 'fade' ? 1 : 0}, ${waveInitializer(action.wave)}, ${cString(action.flag)} }`;
    });
    const legacy = sorted.filter((event) => ['spawn_enemy', 'spawn_boss', 'spawn_destructible'].includes(event.action?.type)).map((event) => {
      const isBoss = event.action.type === 'spawn_boss';
      const entity = isBoss ? bossById.get(event.action.bossId) : enemyById.get(event.action.enemyId);
      const points = (event.path || []).slice(0, CATALOG_LIMITS.legacyPath).map((point) => `{ ${Math.trunc(point.x)}, ${Math.trunc(point.y)}, ${Math.trunc(point.frame)}, ${interpolationCode(point.interpolation)} }`);
      const phases = isBoss ? (entity?.phases || []) : (event.phases || []);
      const thresholds = phases.slice(0, CATALOG_LIMITS.phases).map((phase) => Math.trunc(phase.threshold));
      const phasePatterns = phases.slice(0, CATALOG_LIMITS.phases).map((phase) => patternIndexFor(patternIndexes, phase.patternId || event.patternId || entity?.patternId));
      const entityId = isBoss ? event.action.bossId : event.action.enemyId;
      return `    { ${Math.trunc(event.trigger?.frame ?? event.spawnFrame)}, ${Math.trunc(event.hp || entity?.hp || 1)}, ${Math.trunc(event.score || entity?.score || 0)}, ${isBoss ? 2 : entityId === 'turret' ? 1 : 0}, ${isBoss ? 1 : 0}, ${patternIndexFor(patternIndexes, event.patternId || entity?.patternId)}, ${points.length}, ${Math.min(CATALOG_LIMITS.phases, phases.length)}, { ${cArray(points, CATALOG_LIMITS.legacyPath, '{ 0, 0, 0, 0 }')} }, { ${cArray(thresholds, CATALOG_LIMITS.phases, '0')} }, { ${cArray(phasePatterns, CATALOG_LIMITS.phases, '255')} }, ${stableRuntimeId(snapshot, isBoss ? 'bosses' : 'enemies', entityId)}, ${stableRuntimeId(snapshot, 'movements', event.movementId || entity?.movementId)}, ${stableRuntimeId(snapshot, 'items', event.dropItemId || entity?.drop?.itemId)} }`;
    });
    const eventName = `bml_stage_${stageIndex}_events`;
    const typedName = `bml_stage_${stageIndex}_typed`;
    const next = (stage.next || []).slice(0, CATALOG_LIMITS.next).map((edge) => `{ ${stableRuntimeId(snapshot, 'stages', edge.stageId)}, ${cString(edge.flag)}, ${cBool(edge.equals)} }`);
    const demoBinding = stage.caravan ? { pre: snapshot.demoBindings.caravan?.pre, post: snapshot.demoBindings.caravan?.result } : (snapshot.demoBindings.stages?.[stage.id] || {});
    return {
      definitions: `static const BML_GameEvent ${eventName}[${Math.max(1, legacy.length)}] = {\n${legacy.length ? legacy.join(',\n') : '    { 0 }'}\n};\nstatic const BML_StageEventV2 ${typedName}[${Math.max(1, typed.length)}] = {\n${typed.length ? typed.join(',\n') : '    { 0 }'}\n};`,
      initializer: `    { ${eventName}, ${legacy.length}, ${Math.trunc(stage.durationFrames)}, ${cBool(stage.orientation === 'horizontal')}, ${stableRuntimeId(snapshot, 'stages', stage.id)}, ${stableRuntimeId(snapshot, 'backgrounds', stage.backgroundId)}, ${collisionIndexByStage.has(stage.id) ? collisionIndexByStage.get(stage.id) : 255}, ${typedName}, ${typed.length}, { ${cArray(next, CATALOG_LIMITS.next, '{ 0, NULL, FALSE }')} }, ${next.length}, ${cBool(stage.caravan)}, ${demoSceneIndex(demoBinding.pre)}, ${demoSceneIndex(demoBinding.post)}, ${cString(stage.id)}, ${cString(stage.name)} }`,
    };
  });

  const initialWeaponRuntimeId = stableRuntimeId(snapshot, 'weapons', snapshot.player.initial.weaponId);
  const playerLine = `{ ${spriteInitializer(snapshot.player.sprite)}, { ${snapshot.player.animation.vertical.negative}, ${snapshot.player.animation.vertical.neutral}, ${snapshot.player.animation.vertical.positive} }, { ${snapshot.player.animation.horizontal.negative}, ${snapshot.player.animation.horizontal.neutral}, ${snapshot.player.animation.horizontal.positive} }, ${Math.trunc(snapshot.player.hitbox.x)}, ${Math.trunc(snapshot.player.hitbox.y)}, ${Math.trunc(snapshot.player.hitbox.radius)}, { ${Math.trunc(snapshot.player.speeds.slow)}, ${Math.trunc(snapshot.player.speeds.normal)}, ${Math.trunc(snapshot.player.speeds.fast)} }, ${Math.trunc(snapshot.player.initial.lives)}, ${Math.trunc(snapshot.player.initial.bombs)}, ${initialWeaponRuntimeId}, ${{ slow: 0, normal: 1, fast: 2 }[snapshot.player.initial.speed] ?? 1} }`;
  const test = selfTestCrc(snapshot.patterns[0], snapshot.project.rank);
  const source = `#include <genesis.h>\n${resourceHeaders(assetIndex)}\n#include "bulletml/bulletml_game.h"\n#include "generated/bulletml_catalog.h"\n\nconst BML_GamePattern bmlGamePatterns[${Math.max(1, patternLines.length)}] = {\n${patternLines.length ? patternLines.join(',\n') : '    { NULL, 0, "none", 0 }'}\n};\nconst u8 bmlGamePatternCount = ${patternLines.length};\nconst u8 bmlPatternRuntimeIds[${Math.max(1, patternRuntimeIds.length)}] = { ${patternRuntimeIds.length ? patternRuntimeIds.join(', ') : '0'} };\n\n${stageBundles.map((bundle) => bundle.definitions).join('\n\n')}\n\nconst BML_GameStage bmlGameStages[${Math.max(1, stageBundles.length)}] = {\n${stageBundles.length ? stageBundles.map((bundle) => bundle.initializer).join(',\n') : '    { 0 }'}\n};\nconst u8 bmlGameStageCount = ${stageBundles.length};\n\nconst BML_PlayerConfig bmlPlayerConfig = ${playerLine};\nconst BML_WeaponConfig bmlWeapons[${Math.max(1, weaponLines.length)}] = {\n${weaponLines.length ? weaponLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlWeaponCount = ${weaponLines.length};\nconst BML_ItemConfig bmlItems[${Math.max(1, itemLines.length)}] = {\n${itemLines.length ? itemLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlItemCount = ${itemLines.length};\nconst BML_EffectConfig bmlEffects[${Math.max(1, effectLines.length)}] = {\n${effectLines.length ? effectLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlEffectCount = ${effectLines.length};\nconst BML_ExplosionConfig bmlExplosions[${Math.max(1, explosionLines.length)}] = {\n${explosionLines.length ? explosionLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlExplosionCount = ${explosionLines.length};\nconst BML_MovementConfig bmlMovements[${Math.max(1, movementLines.length)}] = {\n${movementLines.length ? movementLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlMovementCount = ${movementLines.length};\nconst BML_EnemyConfig bmlEnemies[${Math.max(1, enemyLines.length)}] = {\n${enemyLines.length ? enemyLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlEnemyCount = ${enemyLines.length};\nconst BML_BossConfig bmlBosses[${Math.max(1, bossLines.length)}] = {\n${bossLines.length ? bossLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlBossCount = ${bossLines.length};\nconst BML_BackgroundConfig bmlBackgrounds[${Math.max(1, backgroundLines.length)}] = {\n${backgroundLines.length ? backgroundLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlBackgroundCount = ${backgroundLines.length};\nconst BML_CollisionMaterial bmlCollisionMaterials[${Math.max(1, materialLines.length)}] = {\n${materialLines.length ? materialLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlCollisionMaterialCount = ${materialLines.length};\n${collisionArrays.join('\n')}\nconst BML_CollisionMap bmlCollisionMaps[${Math.max(1, collisionLines.length)}] = {\n${collisionLines.length ? collisionLines.join(',\n') : '    { 0 }'}\n};\nconst u8 bmlCollisionMapCount = ${collisionLines.length};\n`;

  const sourceWithDemo = `${source}${backgroundPaletteDefinitions}\nconst char * const bmlDemoFlagNames[${Math.max(1, demo.flagBindings.length)}] = { ${demo.flagBindings.length ? demo.flagBindings.map((entry) => cString(entry.name)).join(', ') : 'NULL'} };\nconst u16 bmlDemoFlagVariableIndexes[${Math.max(1, demo.flagBindings.length)}] = { ${demo.flagBindings.length ? demo.flagBindings.map((entry) => entry.variableIndex).join(', ') : '0'} };\n`;
  const button = (value) => ({ A: 'BUTTON_A', B: 'BUTTON_B', C: 'BUTTON_C' })[value] || 'BUTTON_A';
  const hasAsset = (symbol, type) => (assetIndex?.index?.get(symbol) || []).some((entry) => !type || String(entry.type).toUpperCase() === type);
  const fallbackImages = hasAsset('bml_bg_vertical', 'IMAGE') && hasAsset('bml_bg_horizontal', 'IMAGE');
  const shotSe = hasAsset('bml_sfx_shot', 'WAV');
  const hitSe = hasAsset('bml_sfx_hit', 'WAV');
  const destroySe = hasAsset('bml_sfx_destroy', 'WAV');
  const diagnosticBgmSymbol = cResourceSymbol(backgrounds.find((entry) => entry.bgm?.symbol)?.bgm?.symbol);
  const diagnosticPcmSymbol = cResourceSymbol(effects.find((entry) => entry.se?.symbol)?.se?.symbol || snapshot.project.bomb.se?.symbol);
  const startStageRuntimeId = stableRuntimeId(snapshot, 'stages', snapshot.project.campaign.startStageId);
  const caravanStageRuntimeId = stableRuntimeId(snapshot, 'stages', snapshot.project.caravan.stageId);
  const resetWeapon = ({ retain: 0, initial: 1 })[snapshot.project.resetOnHit.weapon] ?? 0;
  const resetSpeed = ({ retain: 0, slow: 1, normal: 2, fast: 3 })[snapshot.project.resetOnHit.speed] ?? 2;
  const resetBombs = ({ retain: 0, initial: 1, zero: 2 })[snapshot.project.resetOnHit.bombs] ?? 1;
  const bombEffectRuntimeId = stableRuntimeId(snapshot, 'effects', snapshot.project.bomb.effectId);
  const header = `#ifndef GENERATED_BULLETML_CATALOG_H\n#define GENERATED_BULLETML_CATALOG_H\n\n${resourceHeaders(assetIndex)}\n\n#define BML_SCHEMA_VERSION 2\n#define BML_SELF_TEST_EXPECTED_CRC 0x${test.value.toString(16).padStart(8, '0').toUpperCase()}UL\n#define BML_SELF_TEST_PATTERN_INDEX 0\n#define BML_BULLET_SPRITE ${cResourceSymbol(snapshot.project.defaultSprite.asset.symbol)}\n#define BML_BULLET_ANIMATION_ROW ${Math.trunc(snapshot.project.defaultSprite.asset.animationRow || 0)}\n#define BML_BULLET_FRAME_COUNT ${bulletSprite.frameCount}\n#define BML_BULLET_FRAME_TICKS 8\n#define BML_FIXED_RANK_Q16 ${q16Rank(snapshot.project.rank)}\n#define BML_CAMPAIGN_ENABLED ${snapshot.project.modes.campaign ? 1 : 0}\n#define BML_CARAVAN_ENABLED ${snapshot.project.modes.caravan ? 1 : 0}\n#define BML_CAMPAIGN_START_STAGE_ID ${startStageRuntimeId}\n#define BML_CARAVAN_STAGE_ID ${caravanStageRuntimeId}\n#define BML_CARAVAN_TIME_LIMIT_FRAMES ${Math.trunc(snapshot.project.caravan.timeLimitFrames)}\n#define BML_CAMPAIGN_CONTINUES ${Math.trunc(snapshot.project.campaign.continues)}\n#define BML_POOL_PLAYER_SHOTS ${Math.trunc(snapshot.pools.playerShots)}\n#define BML_POOL_ENEMIES ${Math.trunc(snapshot.pools.enemies)}\n#define BML_POOL_ITEMS ${Math.trunc(snapshot.pools.items)}\n#define BML_POOL_EFFECTS ${Math.trunc(snapshot.pools.effects)}\n#define BML_POOL_BOSS_PARTS ${Math.trunc(snapshot.pools.bossParts)}\n#define BML_BOMB_INITIAL_STOCK ${Math.trunc(snapshot.project.bomb.initialStock)}\n#define BML_BOMB_MAX_STOCK ${Math.trunc(snapshot.project.bomb.maxStock)}\n#define BML_BOMB_DAMAGE ${Math.trunc(snapshot.project.bomb.damage)}\n#define BML_BOMB_CLEAR_BULLETS ${snapshot.project.bomb.clearEnemyBullets ? 1 : 0}\n#define BML_BOMB_INVINCIBLE_FRAMES ${Math.trunc(snapshot.project.bomb.invincibleFrames)}\n#define BML_BOMB_EFFECT_ID ${bombEffectRuntimeId}\n#define BML_HIT_RESET_WEAPON ${resetWeapon}\n#define BML_HIT_RESET_SPEED ${resetSpeed}\n#define BML_HIT_RESET_BOMBS ${resetBombs}\n#define BML_DEFAULT_SHOT_BUTTON ${button(snapshot.input.defaults.shot)}\n#define BML_DEFAULT_BOMB_BUTTON ${button(snapshot.input.defaults.bomb)}\n#define BML_DEFAULT_SPEED_BUTTON ${button(snapshot.input.defaults.speedShift)}\n#define BML_SAVE_VERSION ${Math.trunc(snapshot.save.version)}\n#define BML_SAVE_TOP_COUNT ${Math.trunc(snapshot.save.topCount)}\n#define BML_SAVE_MAGIC 0x${Buffer.from(String(snapshot.save.magic).padEnd(4, ' ').slice(0, 4), 'ascii').toString('hex').toUpperCase()}UL\n#define BML_HAS_FALLBACK_IMAGES ${fallbackImages ? 1 : 0}\n${fallbackImages ? '#define BML_VERTICAL_IMAGE bml_bg_vertical\n#define BML_HORIZONTAL_IMAGE bml_bg_horizontal' : ''}\n#define BML_HAS_SHOT_SE ${shotSe ? 1 : 0}\n${shotSe ? '#define BML_SHOT_SE bml_sfx_shot' : ''}\n#define BML_HAS_HIT_SE ${hitSe ? 1 : 0}\n${hitSe ? '#define BML_HIT_SE bml_sfx_hit' : ''}\n#define BML_HAS_DESTROY_SE ${destroySe ? 1 : 0}\n${destroySe ? '#define BML_DESTROY_SE bml_sfx_destroy' : ''}\n#define BML_HAS_DIAGNOSTIC_BGM ${diagnosticBgmSymbol ? 1 : 0}\n${diagnosticBgmSymbol ? `#define BML_DIAGNOSTIC_BGM ${diagnosticBgmSymbol}` : ''}\n#define BML_HAS_DIAGNOSTIC_PCM ${diagnosticPcmSymbol ? 1 : 0}\n${diagnosticPcmSymbol ? `#define BML_DIAGNOSTIC_PCM ${diagnosticPcmSymbol}` : ''}\n\n#define BML_DIAGNOSTIC_BURST_SIZE ${diagnosticLoad.burst.bytes.length}\n#define BML_DIAGNOSTIC_IDLE_SIZE ${diagnosticLoad.idle.bytes.length}\n#define BML_DIAGNOSTIC_LOAD_FRAMES ${diagnosticLoad.proof.frames}\n#define BML_DIAGNOSTIC_NTSC_SUBTICKS_PER_FRAME 1280\n\n#endif\n`;
  const demoHeader = `#define BML_BG_A_TILE_RESERVE ${bgATileReserve}\n#define BML_BG_B_TILE_RESERVE ${bgBTileReserve}\n#define BML_GAME_SPRITE_VRAM_TILES 420\n${backgroundPaletteDeclarations}\n#define BML_DEMO_OPENING_SCENE ${demoSceneIndex(snapshot.demoBindings.opening)}\n#define BML_DEMO_ENDING_RESCUE_SCENE ${demoSceneIndex(snapshot.demoBindings.endings?.rescue)}\n#define BML_DEMO_ENDING_DESTROY_SCENE ${demoSceneIndex(snapshot.demoBindings.endings?.destroy)}\n#define BML_DEMO_ENDING_FLAG ${cString(snapshot.demoBindings.endingSelector?.flag)}\n#define BML_DEMO_ENDING_RESCUE_WHEN ${cBool(snapshot.demoBindings.endingSelector?.rescueWhen !== false)}\n#define BML_DEMO_CARAVAN_PRE_SCENE ${demoSceneIndex(snapshot.demoBindings.caravan?.pre)}\n#define BML_DEMO_CARAVAN_RESULT_SCENE ${demoSceneIndex(snapshot.demoBindings.caravan?.result)}\n#define BML_DEMO_FLAG_COUNT ${demo.flagBindings.length}\nextern const char * const bmlDemoFlagNames[${Math.max(1, demo.flagBindings.length)}];\nextern const u16 bmlDemoFlagVariableIndexes[${Math.max(1, demo.flagBindings.length)}];\n`;
  const headerWithDemo = header.replace('#define BML_HAS_FALLBACK_IMAGES', `${demoHeader}#define BML_HAS_FALLBACK_IMAGES`);
  return { source: sourceWithDemo, header: headerWithDemo, selfTest: test, diagnosticLoad, collisionCatalogs, backgroundTilesets: uniqueBackgroundTilesets.map((entry) => ({ symbol: entry.symbol, tileCount: entry.tileCount, paletteFingerprint: entry.paletteFingerprint })), backgroundTileReserve: { bgA: bgATileReserve, bgB: bgBTileReserve, bullet: bulletSprite.tileCount }, counts: { patterns: snapshot.patterns.length, stages: stageBundles.length, weapons: weapons.length, items: items.length, effects: effects.length, explosions: explosions.length, movements: movements.length, enemies: enemies.length, bosses: bosses.length, backgrounds: backgrounds.length, materials: materials.length, collisions: collisionCatalogs.length, demoScenes: Object.keys(demo.sceneIndexes || {}).length, demoFlags: demo.flagBindings.length } };
}

function syncStaticFiles(projectDir, bulletSprite) {
  for (const [target, source] of Object.entries(STATIC_FILES)) copyFile(path.join(templateRoot(), source), path.join(projectDir, target));
  service.atomicWriteFile(path.join(projectDir, 'src', 'bulletml', 'bulletml_lut.c'), generateLutSource());
}

function duplicateAssetDiagnostics(assets) {
  const seen = new Map();
  const duplicates = [];
  for (const asset of assets || []) {
    const name = String(asset?.name || '').trim();
    if (!name) continue;
    if (seen.has(name)) duplicates.push(`${name} (${seen.get(name)} / ${asset.sourcePath || 'unknown'})`);
    else seen.set(name, asset.sourcePath || 'unknown');
  }
  return duplicates;
}

function prepareProject(projectDir, context = {}) {
  const duplicates = duplicateAssetDiagnostics(context.assets || []);
  if (duplicates.length) return { ok: false, error: `ResComp symbolが重複しています:\n${duplicates.join('\n')}` };
  const preflight = service.validateProject(projectDir);
  if (!preflight.ok) return preflight;
  const bulletSprite = bulletSpriteConfig(preflight.snapshot, projectDir);
  ensureDefaultBulletAsset(projectDir, bulletSprite);
  const bulletAsset = validateBulletSpriteAsset(projectDir, preflight.snapshot, bulletSprite);
  const exported = service.exportBuild(projectDir, { frames: context.bulletmlValidationFrames || 3600 });
  if (!exported.ok) return exported;
  syncStaticFiles(projectDir, bulletSprite);
  const assetIndex = documentService.buildAssetIndex(projectDir);
  const demo = prepareNovelIntegration(projectDir, exported.snapshot, assetIndex);
  const catalog = generateCatalog(exported.snapshot, bulletAsset, { projectDir, assetIndex, demo });
  const diagnosticFiles = writeDiagnosticLoadResources(projectDir, catalog.diagnosticLoad);
  exported.generatedFiles.push(...diagnosticFiles.filter((file) => !exported.generatedFiles.includes(file)));
  service.atomicWriteFile(path.join(projectDir, 'src', 'generated', 'bulletml_catalog.c'), catalog.source);
  service.atomicWriteFile(path.join(projectDir, 'inc', 'generated', 'bulletml_catalog.h'), catalog.header);
  const proofPath = path.join(projectDir, 'data', 'bulletml', 'proof.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.runtime = {
    abi: 1,
    sourceSha256: sha256(fs.readFileSync(path.join(templateRoot(), STATIC_FILES['src/bulletml/bulletml_runtime.c']))),
    selfTestFrames: 10000,
    selfTestExpectedCrc: catalog.selfTest.value.toString(16).padStart(8, '0'),
    selfTestPatternBmlbSha256: catalog.selfTest.sha256,
    loadProbe: catalog.diagnosticLoad.proof,
  };
  const backgroundTiles = {
    bgAReserve: catalog.backgroundTileReserve.bgA,
    bgBReserve: catalog.backgroundTileReserve.bgB,
    tilesets: catalog.backgroundTilesets,
  };
  const staticGameplayTiles = catalog.backgroundTileReserve.bgA + catalog.backgroundTileReserve.bgB + bulletAsset.tileCount;
  proof.runtime.vram = {
    systemTiles: 16,
    fontTiles: 96,
    spriteEngineRegionTiles: 420,
    worstCaseAutoSpriteTiles: 44,
    sharedBulletTiles: bulletAsset.tileCount,
    sharedBulletTileLimit: 128,
    backgroundTiles,
    staticGameplayTiles,
    staticGameplayTileLimit: 900,
    demoMaxTiles: demo.report.budget.maxBudget,
    worstCaseHardwareSprites: 62,
    h40HardwareSpriteLimit: 80,
    withinBudget: bulletAsset.tileCount <= 128 && staticGameplayTiles <= 900 && demo.report.budget.maxBudget <= 1024 && 44 <= 420 && 62 <= 80,
  };
  proof.runtime.catalogs = catalog.counts;
  proof.runtime.demo = { sourceSceneRevision: demo.sourceSceneRevision, scenes: demo.report.scenes, commands: demo.report.commands, glyphs: demo.report.glyphs, variables: demo.report.variables, flags: demo.flagBindings.length, generatedFiles: demo.files };
  proof.runtime.collision = catalog.collisionCatalogs.map((entry) => ({ stageId: entry.stageId, width: entry.width, height: entry.height, layerName: entry.layerName, rawBytes: entry.width * entry.height, rleBytes: entry.rle.length }));
  proof.bulletSprite = bulletAsset;
  service.atomicWriteFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  context.logger?.info?.(`BulletML v2 catalog ${exported.snapshot.stages.length} stage、BMLB ${exported.snapshot.patterns.length}件、TMX collision ${catalog.collisionCatalogs.length}件、VN ${demo.report.scenes} sceneを生成しました`);
  for (const warning of demo.warnings || []) context.logger?.warn?.(`BulletML VN: ${warning.message || warning.code || warning}`);
  return { ok: true, exported, catalog, demo, bulletAsset, diagnosticLoad: catalog.diagnosticLoad, sourceFiles: SOURCE_FILES.slice(), proof };
}

function generateSource(_assets = [], context = {}) {
  if (!context.projectDir) return { ok: false, error: 'projectDir is required' };
  try { const prepared = prepareProject(context.projectDir, context); return prepared.ok ? { ok: true, sourceCode: fs.readFileSync(path.join(templateRoot(), 'src', 'main.c'), 'utf8'), exported: prepared.exported } : prepared; }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

function onBuildStart(payload = {}, context = {}) {
  const projectDir = payload.projectDir || context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  try {
    const prepared = prepareProject(projectDir, { ...context, toolchainPath: payload.toolchainPath || context.toolchainPath });
    if (!prepared.ok) return prepared;
    return { ok: true, makeVariables: { SRC_C: prepared.sourceFiles.join(' ') }, proof: prepared.proof };
  } catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

function onBuildLog() { return { ok: true }; }

function onBuildEnd(payload = {}, context = {}) {
  try {
    const projectDir = payload.projectDir || context.projectDir;
    const romPath = payload.romPath || payload.outputPath;
    if (!projectDir || !romPath || !fs.existsSync(romPath)) return { ok: true };
    const proofPath = path.join(projectDir, 'data', 'bulletml', 'proof.json');
    const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    const romBytes = fs.statSync(romPath).size;
    if (romBytes > 4 * 1024 * 1024) throw new Error(`BulletML ROMが4 MiB上限を超えています: ${romBytes} bytes`);
    proof.rom = { path: path.relative(projectDir, romPath).replace(/\\/g, '/'), bytes: romBytes, limitBytes: 4 * 1024 * 1024, sha256: sha256(fs.readFileSync(romPath)) };
    const symbolPath = payload.symbolPath || path.join(path.dirname(romPath), 'symbol.txt');
    if (!fs.existsSync(symbolPath)) throw new Error(`BulletML RAM proofにsymbol.txtが必要です: ${symbolPath}`);
    proof.runtime.ram = parseLinkerRamSymbols(fs.readFileSync(symbolPath, 'utf8'));
    if (!proof.runtime.ram.withinBudget || !proof.runtime.vram?.withinBudget) throw new Error('BulletML RAM/VRAM予算を超えています');
    proof.sgdkPath = payload.toolchainPath || context.toolchainPath || '';
    service.atomicWriteFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    context.logger?.info?.(`BulletML ROM SHA-256 ${proof.rom.sha256}`);
    return { ok: true, proof };
  } catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

function onBuildError(payload = {}, context = {}) { context.logger?.error?.(`BulletML STG build error: ${payload.error || 'unknown error'}`); return { ok: true }; }

module.exports = {
  manifest,
  SOURCE_FILES,
  STATIC_FILES,
  DIAGNOSTIC_LOAD_RESOURCES,
  generateLutSource,
  generateCatalog,
  diagnosticLoadBundle,
  runDiagnosticLoadProof,
  writeDiagnosticLoadResources,
  staticAssets,
  bulletSpriteConfig,
  parseIndexedPng,
  generatedIndexedTileCount,
  prepareNovelIntegration,
  parseLinkerRamSymbols,
  validateBulletSpriteAsset,
  gameResourceSource,
  prepareProject,
  generateSource,
  onBuildStart,
  onBuildLog,
  onBuildEnd,
  onBuildError,
};
