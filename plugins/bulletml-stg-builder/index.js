'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const manifest = require('./manifest.json');
const service = require('../bulletml-stg-editor/bulletml-service');
const compiler = require('../bulletml-stg-editor/bulletml-compiler');
const simulator = require('../bulletml-stg-editor/bulletml-simulator');
const schema = require('../bulletml-stg-editor/bulletml-schema');

const SOURCE_FILES = Object.freeze([
  'src/main.c',
  'src/bulletml/bulletml_runtime.c',
  'src/bulletml/bulletml_lut.c',
  'src/bulletml/bulletml_game.c',
  'src/generated/bulletml_catalog.c',
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

function bulletSpriteConfig(snapshot) {
  const entries = [
    { path: 'project.defaultSprite', sprite: snapshot.project.defaultSprite },
    ...snapshot.patterns.map((pattern) => ({ path: `patterns.${pattern.id}.sprite`, sprite: pattern.sprite })),
  ];
  const first = entries[0].sprite;
  const source = String(first.source || '').replace(/\\/g, '/').replace(/^res\//, '');
  const frameWidth = Number(first.frameWidth);
  const frameHeight = Number(first.frameHeight);
  const frameCount = Number(first.frameCount);
  const tileCount = Number(first.tileCount);
  const errors = [];
  const comparable = ['assetId', 'source', 'palette', 'frameWidth', 'frameHeight', 'frameCount', 'hardwarePieces', 'tileCount'];
  for (const entry of entries) {
    for (const key of comparable) {
      const left = key === 'source' ? String(entry.sprite[key] || '').replace(/\\/g, '/').replace(/^res\//, '') : entry.sprite[key];
      const right = key === 'source' ? source : first[key];
      if (String(left) !== String(right)) errors.push(`${entry.path}.${key}: v1 runtimeでは全patternがproject.defaultSpriteと同じ共有spriteを使う必要があります`);
    }
  }
  if (!source || path.posix.isAbsolute(source) || source.split('/').includes('..')) errors.push('project.defaultSprite.source: res内の相対pathを指定してください');
  if (![8, 16, 24, 32].includes(frameWidth) || ![8, 16, 24, 32].includes(frameHeight)) errors.push('project.defaultSprite: frameは8〜32pxの8px単位で指定してください');
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 255) errors.push('project.defaultSprite.frameCount: 1..255で指定してください');
  if (Number(first.hardwarePieces) !== 1) errors.push('project.defaultSprite.hardwarePieces: 1 hardware pieceだけ使用できます');
  if (String(first.palette) !== 'PAL3') errors.push('project.defaultSprite.palette: PAL3を指定してください');
  const expectedTiles = frameWidth * frameHeight / 64 * frameCount;
  if (tileCount !== expectedTiles) errors.push(`project.defaultSprite.tileCount: ${expectedTiles}を指定してください`);
  if (expectedTiles > 128) errors.push(`project.defaultSprite.tileCount: ${expectedTiles} tileは上限128を超えています`);
  if (errors.length) throw new Error(`BulletML弾sprite契約に違反しています:\n${errors.join('\n')}`);
  return { source, frameWidth, frameHeight, frameCount, tileCount, paletteFingerprint: String(first.paletteFingerprint || '') };
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
  return { width, height, bitDepth, colors: plte.length / 3, paletteFingerprint: sha256(plte) };
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

function selfTestCrc(pattern) {
  const compiled = compiler.compilePattern(pattern);
  const vm = new simulator.BulletmlVm(compiled.bytes, { seed: 0xace1 });
  vm.setRank(0.5); vm.setPlayer(160, 196); vm.startEmitter({ x: 160, y: 28, orientation: 'vertical' });
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

function generateCatalog(snapshot, bulletSprite = bulletSpriteConfig(snapshot)) {
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
      const thresholds = Array.from({ length: 3 }, (_, index) => event.phases[index]?.threshold || 0).join(', ');
      const phases = Array.from({ length: 3 }, (_, index) => patternIndexes.get(event.phases[index]?.patternId) ?? patternIndexes.get(event.patternId) ?? 0).join(', ');
      return `    { ${event.spawnFrame}, ${event.hp}, ${event.score}, ${{ grunt: 0, turret: 1, boss: 2 }[event.enemyType] ?? 0}, ${event.boss ? 1 : 0}, ${patternIndexes.get(event.patternId) ?? 0}, ${event.path.length}, ${event.phases.length}, { ${points} }, { ${thresholds} }, { ${phases} } }`;
    });
    return { name, source: `static const BML_GameEvent ${name}[${Math.max(1, entries.length)}] = {\n${entries.length ? entries.join(',\n') : '    { 0 }'}\n};`, count: entries.length, duration: stage.durationFrames, horizontal: stage.orientation === 'horizontal' };
  });
  const test = selfTestCrc(snapshot.patterns[0]);
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

function syncStaticFiles(projectDir, bulletSprite) {
  for (const [target, source] of Object.entries(STATIC_FILES)) copyFile(path.join(templateRoot(), source), path.join(projectDir, target));
  service.atomicWriteFile(path.join(projectDir, 'src', 'bulletml', 'bulletml_lut.c'), generateLutSource());
  for (const [relative, contents] of Object.entries(staticAssets())) {
    if (relative === 'res/gfx/bulletml_bullet.png') continue;
    service.atomicWriteFile(path.join(projectDir, relative), contents);
  }
  service.atomicWriteFile(path.join(projectDir, 'res', 'bulletml_game.res'), gameResourceSource(bulletSprite));
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
  const bulletSprite = bulletSpriteConfig(preflight.snapshot);
  ensureDefaultBulletAsset(projectDir, bulletSprite);
  const bulletAsset = validateBulletSpriteAsset(projectDir, preflight.snapshot, bulletSprite);
  const exported = service.exportBuild(projectDir, { frames: context.bulletmlValidationFrames || 3600 });
  if (!exported.ok) return exported;
  syncStaticFiles(projectDir, bulletSprite);
  const catalog = generateCatalog(exported.snapshot, bulletAsset);
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
  const fixedAssets = staticAssets();
  const backgroundTiles = {
    vertical: generatedIndexedTileCount(fixedAssets['res/gfx/bml_bg_vertical.png']),
    horizontal: generatedIndexedTileCount(fixedAssets['res/gfx/bml_bg_horizontal.png']),
  };
  proof.runtime.vram = {
    systemTiles: 16,
    fontTiles: 96,
    spriteEngineRegionTiles: 420,
    worstCaseAutoSpriteTiles: 44,
    sharedBulletTiles: bulletAsset.tileCount,
    sharedBulletTileLimit: 128,
    backgroundTiles,
    worstCaseHardwareSprites: 62,
    h40HardwareSpriteLimit: 80,
    withinBudget: bulletAsset.tileCount <= 128 && Math.max(backgroundTiles.vertical, backgroundTiles.horizontal) + bulletAsset.tileCount <= 158 && 44 <= 420 && 62 <= 80,
  };
  proof.bulletSprite = bulletAsset;
  service.atomicWriteFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  context.logger?.info?.(`BulletML BMLB ${exported.snapshot.patterns.length}件、48弾/5 emitter/16 burst診断、runtime、固定background/audio/enemy素材を同期し、共有弾spriteを検証しました`);
  return { ok: true, exported, catalog, bulletAsset, diagnosticLoad: catalog.diagnosticLoad, sourceFiles: SOURCE_FILES.slice(), proof };
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
    proof.rom = { path: path.relative(projectDir, romPath).replace(/\\/g, '/'), bytes: fs.statSync(romPath).size, sha256: sha256(fs.readFileSync(romPath)) };
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
