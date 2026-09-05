'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const schema = require('../plugins/bulletml-stg-editor/bulletml-schema');
const host = require('../plugins/bulletml-stg-editor/stg-schema-v2');

const repoRoot = path.resolve(__dirname, '..');
const templateRoot = path.join(repoRoot, 'template', 'template_bulletml_stg');
const dataRoot = path.join(templateRoot, 'data', 'bulletml');
const resRoot = path.join(templateRoot, 'res');
const assetsRoot = path.join(templateRoot, 'assets');

const PALETTES = Object.freeze({
  pal0: ['000000', 'ffffff', '081020', '102848', '185080', '2878a0', '48a0c0', '78c8d8', '382810', '785018', 'b88028', 'e0b848', '606878', '8898a8', 'b8c8d8', 'f0e8c8'],
  pal1: ['000000', 'ffffff', '080818', '101838', '182858', '203878', '385898', '5878b0', '382808', '684010', '987020', 'c8a038', 'e8d078', '505868', '8898b0', 'd8e8f0'],
  pal2: ['000000', 'ffffff', '081828', '103858', '186888', '28a0b8', '68d0d8', 'b8f0e8', '482008', '884018', 'c87820', 'f0b840', '603060', '985898', 'd898d0', 'f0d8e8'],
  pal3: ['000000', 'ffffff', '180818', '481028', '802040', 'b83850', 'e86060', 'f89870', '302008', '685018', 'a08028', 'e0b840', '303858', '586898', '88a8c8', 'd8e8f0'],
});

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function writeJson(relative, value) { const target = path.join(templateRoot, relative); ensureDir(path.dirname(target)); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); }
function write(relative, value) { const target = path.join(templateRoot, relative); ensureDir(path.dirname(target)); fs.writeFileSync(target, value); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

function paletteBytes(palette) {
  return Buffer.from(palette.flatMap((hex) => [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]));
}

function indexedPng(width, height, palette, pixel, transparent = true) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) rows[y * (width + 1) + 1 + x] = Math.max(0, Math.min(15, pixel(x, y) | 0));
  }
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', paletteBytes(palette))];
  if (transparent) chunks.push(chunk('tRNS', Buffer.from([0, ...Array(15).fill(255)])));
  chunks.push(chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function wavTone(frequency, seconds, kind = 'square') {
  const rate = 13300;
  const samples = Math.max(1, Math.round(rate * seconds));
  const data = Buffer.alloc(samples);
  let noise = 0x5a17;
  for (let index = 0; index < samples; index += 1) {
    noise ^= noise << 7; noise ^= noise >>> 9; noise ^= noise << 8;
    const phase = (index * frequency / rate) % 1;
    const envelope = 1 - index / samples;
    const sample = kind === 'noise' ? ((noise & 255) / 127.5 - 1) : (phase < 0.5 ? 1 : -1);
    data[index] = Math.max(0, Math.min(255, Math.round(128 + sample * 92 * envelope)));
  }
  const output = Buffer.alloc(44 + data.length);
  output.write('RIFF', 0); output.writeUInt32LE(36 + data.length, 4); output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate, 28);
  output.writeUInt16LE(1, 32); output.writeUInt16LE(8, 34); output.write('data', 36); output.writeUInt32LE(data.length, 40); data.copy(output, 44);
  return output;
}

function vgmPsg(sequence, bass = false) {
  const commands = [];
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (const period of sequence) {
      const p = Math.max(1, Math.min(1023, period));
      commands.push(0x50, 0x80 | (p & 0x0f), 0x50, (p >> 4) & 0x3f, 0x50, 0x90);
      if (bass) commands.push(0x50, 0xa0 | ((p * 2) & 0x0f), 0x50, ((p * 2) >> 4) & 0x3f, 0x50, 0xb4);
      for (let frame = 0; frame < 12; frame += 1) commands.push(0x62);
    }
  }
  commands.push(0x66);
  const data = Buffer.from(commands);
  const output = Buffer.alloc(0x40 + data.length);
  output.write('Vgm ', 0); output.writeUInt32LE(output.length - 4, 4); output.writeUInt32LE(0x00000150, 8);
  output.writeUInt32LE(3579545, 0x0c); output.writeUInt32LE(60 * sequence.length * 12 * 4, 0x18); output.writeUInt32LE(0x0c, 0x34);
  data.copy(output, 0x40);
  return output;
}

function spritePixel(kind, width, height) {
  return (x, y) => {
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    if (kind === 'player') {
      const row = Math.floor(y / 16);
      const localY = y % 16;
      const frame = Math.floor(x / 16);
      const localX = x % 16;
      const lean = (row % 3) - 1;
      const center = 7.5 + lean * (8 - localY) * 0.18;
      if (localY > 1 && localY < 15 && Math.abs(localX - center) < (localY + 1) * 0.43) return localY > 11 ? 11 + (frame % 2) : (row < 3 ? 5 + frame : 6 + frame);
      if (localY > 9 && Math.abs(localX - center) < 2) return 15;
      return 0;
    }
    if (kind === 'bullet') return dx + dy < Math.min(width, height) * 0.48 ? (dx + dy < 2 ? 15 : 6) : 0;
    if (kind === 'shot') return dx < Math.max(1, width * 0.18) && y < height - 1 ? (y < height / 2 ? 15 : 7) : 0;
    if (kind === 'item') return dx + dy < Math.min(width, height) * 0.42 ? (x < cx ? 10 : 12) : 0;
    if (kind === 'effect') {
      const frame = Math.floor(x / 16);
      const lx = x % 16;
      const dd = Math.abs(lx - 7.5) + Math.abs(y - 7.5);
      return dd < 3 + frame * 1.5 && dd > Math.max(0, frame - 2) ? 7 + (frame % 6) : 0;
    }
    if (kind === 'boss') return dx + dy < Math.min(width, height) * 0.55 ? (dx < width * .12 || dy < height * .12 ? 14 : ((x + y) % 7 < 2 ? 11 : 5)) : 0;
    if (kind === 'part') return dx < width * .4 && dy < height * .4 ? ((x ^ y) & 3 ? 8 : 12) : 0;
    return dx + dy < Math.min(width, height) * .42 ? ((x + y) % 5 ? 5 : 12) : 0;
  };
}

function backgroundPixel(variant, paletteOffset = 0) {
  return (x, y) => {
    const star = ((x * 37 + y * 17 + variant * 53) % 211) === 0;
    if (star) return 15;
    const grid = (x % (32 + variant * 8) < 2) || (y % (24 + variant * 4) < 2);
    const ring = Math.abs(Math.hypot(x - 160, y - 112) - (40 + variant * 17)) < 3;
    const ruin = y > 120 + Math.sin((x + variant * 19) / 21) * 22 && ((Math.floor(x / 16) + variant) % 3 !== 0);
    if (ring) return 11 + paletteOffset;
    if (grid) return 4 + paletteOffset;
    if (ruin) return 2 + ((x >> 4) + (y >> 4) + variant) % 4;
    return 2 + ((x >> 5) + (y >> 5) + variant) % 2;
  };
}

function writeImages() {
  const files = {
    'res/gfx/bml_bullet.png': indexedPng(8, 8, PALETTES.pal3, spritePixel('bullet', 8, 8)),
    'res/gfx/player_ship.png': indexedPng(48, 96, PALETTES.pal2, spritePixel('player', 48, 96)),
    'res/gfx/player_shot.png': indexedPng(8, 8, PALETTES.pal2, spritePixel('shot', 8, 8)),
    'res/gfx/player_spread.png': indexedPng(8, 8, PALETTES.pal2, (x, y) => spritePixel('shot', 8, 8)(y, x)),
    'res/gfx/player_laser.png': indexedPng(8, 16, PALETTES.pal2, spritePixel('shot', 8, 16)),
    'res/gfx/items.png': indexedPng(48, 16, PALETTES.pal2, (x, y) => spritePixel('item', 16, 16)(x % 16, y) + Math.floor(x / 16) % 3),
    'res/gfx/explosion.png': indexedPng(64, 16, PALETTES.pal3, spritePixel('effect', 64, 16)),
    'res/gfx/enemy_scout.png': indexedPng(16, 16, PALETTES.pal3, spritePixel('enemy', 16, 16)),
    'res/gfx/enemy_turret.png': indexedPng(24, 24, PALETTES.pal3, spritePixel('part', 24, 24)),
    'res/gfx/destructible.png': indexedPng(32, 32, PALETTES.pal3, spritePixel('part', 32, 32)),
    'res/gfx/boss_stage1.png': indexedPng(64, 48, PALETTES.pal3, spritePixel('boss', 64, 48)),
    'res/gfx/boss_stage2.png': indexedPng(80, 48, PALETTES.pal3, spritePixel('boss', 80, 48)),
    'res/gfx/boss_core.png': indexedPng(96, 64, PALETTES.pal3, spritePixel('boss', 96, 64)),
    'res/gfx/boss_part.png': indexedPng(32, 32, PALETTES.pal3, spritePixel('part', 32, 32)),
    'res/gfx/title_background.png': indexedPng(320, 224, PALETTES.pal0, backgroundPixel(4), false),
    'res/gfx/bml_bg_vertical.png': indexedPng(320, 224, PALETTES.pal0, backgroundPixel(0), false),
    'res/gfx/bml_bg_horizontal.png': indexedPng(320, 224, PALETTES.pal0, backgroundPixel(1), false),
    'res/maps/abyss_tiles.png': indexedPng(128, 128, PALETTES.pal1, (x, y) => {
      const tile = (Math.floor(x / 8) + Math.floor(y / 8) * 16) & 15;
      if ((x % 8 === 0) || (y % 8 === 0)) return 2;
      return tile === 0 ? 0 : 3 + ((tile + x + y) % 10);
    }),
    'assets/images/vn_abyss.png': indexedPng(320, 224, PALETTES.pal0, backgroundPixel(3), false),
    'assets/sprites/vn_geroneko.png': indexedPng(64, 96, PALETTES.pal2, spritePixel('player', 64, 96)),
  };
  for (const [relative, contents] of Object.entries(files)) write(relative, contents);
  return { bulletPaletteFingerprint: sha256(paletteBytes(PALETTES.pal3)), files: Object.keys(files) };
}

function tmxLayer(name, width, height, valueAt) {
  const values = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) values.push(valueAt(x, y));
  return ` <layer id="${name === 'BG_A' ? 1 : name === 'BG_B' ? 2 : 3}" name="${name}" width="${width}" height="${height}"><data encoding="csv">\n${values.join(',')}\n</data></layer>`;
}

function writeMaps() {
  write('res/maps/abyss.tsx', `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.10.2" name="Abyss" tilewidth="8" tileheight="8" tilecount="256" columns="16"><image source="abyss_tiles.png" width="128" height="128"/></tileset>\n`);
  const definitions = [
    ['stage1', 40, 56, 1], ['stage2', 80, 28, 2], ['stage3', 40, 40, 3], ['caravan', 40, 56, 4],
  ];
  for (const [id, width, height, variant] of definitions) {
    const visualA = (x, y) => 1 + ((x * 3 + y * 5 + variant * 7) % 31);
    const visualB = (x, y) => 33 + ((x + Math.floor(y / 2) + variant * 11) % 31);
    const collision = (x, y) => {
      if (id === 'stage2' && (y === 0 || y === height - 1) && x % 9 < 5) return 1;
      if (id === 'stage1' && y > height - 5 && x % 7 < 4) return 2;
      if (id === 'stage3' && (x < 2 || x > width - 3) && y > 8) return 1;
      if (id === 'caravan' && y > height - 4 && x % 11 < 3) return 2;
      return 0;
    };
    const tmx = `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${width}" height="${height}" tilewidth="8" tileheight="8" infinite="0"><tileset firstgid="1" source="abyss.tsx"/>\n${tmxLayer('BG_B', width, height, visualB)}\n${tmxLayer('BG_A', width, height, visualA)}\n${tmxLayer('Collision:near', width, height, collision)}\n</map>\n`;
    write(`res/maps/${id}.tmx`, tmx);
  }
}

function resourcesRes() {
  const lines = [
    'SPRITE bml_bullet "gfx/bml_bullet.png" 1 1 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE player_ship "gfx/player_ship.png" 2 2 NONE 5,5,5;5,5,5;5,5,5;5,5,5;5,5,5;5,5,5 NONE BALANCED FAST FALSE',
    'SPRITE player_shot "gfx/player_shot.png" 1 1 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE player_spread "gfx/player_spread.png" 1 1 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE player_laser "gfx/player_laser.png" 1 2 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE item_catalog "gfx/items.png" 2 2 NONE 8,8,8 NONE BALANCED FAST FALSE',
    'SPRITE effect_explosion "gfx/explosion.png" 2 2 NONE 3,3,3,3 NONE BALANCED FAST FALSE',
    'SPRITE enemy_scout "gfx/enemy_scout.png" 2 2 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE enemy_turret "gfx/enemy_turret.png" 3 3 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE destructible_ruin "gfx/destructible.png" 4 4 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE boss_stage1 "gfx/boss_stage1.png" 8 6 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE boss_stage2 "gfx/boss_stage2.png" 10 6 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE boss_core "gfx/boss_core.png" 12 8 NONE 0 NONE BALANCED FAST FALSE',
    'SPRITE boss_part "gfx/boss_part.png" 4 4 NONE 0 NONE BALANCED FAST FALSE',
    'IMAGE title_background "gfx/title_background.png" NONE ALL 0',
    'IMAGE bml_bg_vertical "gfx/bml_bg_vertical.png" NONE ALL 0',
    'IMAGE bml_bg_horizontal "gfx/bml_bg_horizontal.png" NONE ALL 0',
    'TILESET abyss_tiles "maps/abyss_tiles.png" NONE ALL ROW FALSE',
  ];
  for (const id of ['stage1', 'stage2', 'stage3', 'caravan']) {
    lines.push(`MAP ${id}_bg_a "maps/${id}.tmx" BG_A NONE NONE 0 ROW`);
    lines.push(`MAP ${id}_bg_b "maps/${id}.tmx" BG_B NONE NONE 0 ROW`);
    lines.push(`MAP ${id}_collision "maps/${id}.tmx" "Collision:near" NONE NONE 0 ROW`);
  }
  lines.push(
    'XGM2 bml_bgm_vertical "music/stage1.vgm"',
    'XGM2 bml_bgm_horizontal "music/stage2.vgm"',
    'XGM2 bgm_stage3 "music/stage3.vgm"',
    'XGM2 bgm_caravan "music/caravan.vgm"',
    'XGM2 bgm_demo "music/demo.vgm"',
    'WAV bml_sfx_shot "sfx/shot.wav" XGM2 13300 FALSE',
    'WAV bml_sfx_hit "sfx/hit.wav" XGM2 13300 FALSE',
    'WAV bml_sfx_destroy "sfx/explosion.wav" XGM2 13300 FALSE',
    'WAV sfx_bomb "sfx/bomb.wav" XGM2 13300 FALSE',
    'WAV sfx_item "sfx/item.wav" XGM2 13300 FALSE',
    ''
  );
  write('res/resources.res', lines.join('\n'));
}

function writeAudio() {
  const songs = {
    stage1: [428, 381, 339, 285, 320, 339, 381, 428],
    stage2: [339, 285, 254, 226, 254, 285, 320, 381],
    stage3: [508, 428, 381, 339, 320, 285, 254, 226],
    caravan: [285, 254, 226, 214, 226, 254, 285, 320],
    demo: [508, 570, 508, 428, 508, 570, 640, 570],
  };
  for (const [id, notes] of Object.entries(songs)) write(`res/music/${id}.vgm`, vgmPsg(notes, true));
  write('res/sfx/shot.wav', wavTone(1100, .06));
  write('res/sfx/hit.wav', wavTone(240, .12, 'noise'));
  write('res/sfx/explosion.wav', wavTone(90, .28, 'noise'));
  write('res/sfx/bomb.wav', wavTone(52, .65, 'noise'));
  write('res/sfx/item.wav', wavTone(1320, .15));
}

function collection(kind, entries) { return { schemaVersion: 2, kind, entries }; }
function ref(symbol, type, extras = {}) { return { symbol, type, ...extras }; }

function projectDocument(fingerprint) {
  return {
    ...host.DEFAULT_PROJECT,
    title: 'GERONEKO -ABYSS STRIKE-',
    rank: 0.5,
    campaign: { ...host.DEFAULT_PROJECT.campaign, startStageId: 'stage-1-vertical' },
    caravan: { ...host.DEFAULT_PROJECT.caravan, stageId: 'caravan-abyss', timeLimitFrames: 7200 },
    bomb: { initialStock: 3, maxStock: 9, damage: 40, clearEnemyBullets: true, invincibleFrames: 180, effectId: 'bomb-wave', se: ref('sfx_bomb', 'WAV') },
    defaultSprite: { ...schema.DEFAULT_SPRITE, paletteFingerprint: fingerprint },
    patternOrder: ['generic-aimed', 'vertical-fan', 'horizontal-rank', 'boss-split', 'ref-showcase'],
    patternRoles: { verticalNormal: 'generic-aimed', verticalBoss: 'vertical-fan', horizontalNormal: 'horizontal-rank', horizontalBoss: 'boss-split' },
  };
}

function showcaseCollections() {
  return {
    weapons: collection('weapons', [
      { id: 'needle', name: 'NEEDLE', sprite: ref('player_shot', 'SPRITE'), intervalFrames: 5, damage: 2, speed: 6, angle: 0, simultaneous: 6, duplicateScore: 1000, emitters: [{ x: -4, y: -8, angle: 0 }, { x: 4, y: -8, angle: 0 }] },
      { id: 'spread', name: 'FAN', sprite: ref('player_spread', 'SPRITE'), intervalFrames: 8, damage: 1, speed: 5, angle: 0, simultaneous: 9, duplicateScore: 1500, emitters: [{ x: 0, y: -8, angle: -18 }, { x: 0, y: -8, angle: 0 }, { x: 0, y: -8, angle: 18 }] },
      { id: 'laser', name: 'ARC LASER', sprite: ref('player_laser', 'SPRITE'), intervalFrames: 3, damage: 3, speed: 8, angle: 0, simultaneous: 4, duplicateScore: 2000, emitters: [{ x: 0, y: -10, angle: 0 }] },
    ]),
    items: collection('items', [
      { id: 'weapon-needle', type: 'weapon', name: 'NEEDLE CORE', sprite: ref('item_catalog', 'SPRITE', { animationRow: 0 }), weaponId: 'needle', amount: 1, score: 1000 },
      { id: 'weapon-spread', type: 'weapon', name: 'FAN CORE', sprite: ref('item_catalog', 'SPRITE', { animationRow: 0 }), weaponId: 'spread', amount: 1, score: 1500 },
      { id: 'weapon-laser', type: 'weapon', name: 'LASER CORE', sprite: ref('item_catalog', 'SPRITE', { animationRow: 0 }), weaponId: 'laser', amount: 1, score: 2000 },
      { id: 'bomb-cell', type: 'bomb', name: 'BOMB CELL', sprite: ref('item_catalog', 'SPRITE', { animationRow: 1 }), amount: 1, score: 500 },
      { id: 'score-gold', type: 'score', name: 'STAR RELIC', sprite: ref('item_catalog', 'SPRITE', { animationRow: 2 }), amount: 1, score: 5000 },
    ]),
    effects: collection('effects', [
      { id: 'small-burst', name: 'Small Burst', sprite: ref('effect_explosion', 'SPRITE', { animationRow: 0 }), durationFrames: 24, se: ref('bml_sfx_destroy', 'WAV') },
      { id: 'gold-burst', name: 'Gold Burst', sprite: ref('effect_explosion', 'SPRITE', { animationRow: 0 }), durationFrames: 32, se: ref('bml_sfx_destroy', 'WAV') },
      { id: 'bomb-wave', name: 'Bomb Wave', sprite: ref('effect_explosion', 'SPRITE', { animationRow: 0 }), durationFrames: 60, se: ref('sfx_bomb', 'WAV') },
    ]),
    explosions: collection('explosions', [
      { id: 'single', name: 'Single', placements: [{ frame: 0, effectId: 'small-burst', x: 0, y: 0 }] },
      { id: 'boss-chain', name: 'Boss Chain', placements: [{ frame: 0, effectId: 'small-burst', x: -20, y: 0 }, { frame: 8, effectId: 'small-burst', x: 18, y: -12 }, { frame: 16, effectId: 'gold-burst', x: 0, y: 8 }, { frame: 24, effectId: 'gold-burst', x: -8, y: -18 }] },
    ]),
    movements: collection('movements', [
      { id: 'swoop', name: 'Swoop', loop: false, waypoints: [{ x: 160, y: -16, durationFrames: 0, interpolation: 'linear' }, { x: 120, y: 72, durationFrames: 90, interpolation: 'smoothstep' }, { x: 200, y: 140, durationFrames: 120, interpolation: 'linear' }] },
      { id: 'side-patrol', name: 'Side Patrol', loop: true, waypoints: [{ x: 336, y: 64, durationFrames: 0, interpolation: 'linear' }, { x: 220, y: 72, durationFrames: 90, interpolation: 'smoothstep' }, { x: 220, y: 150, durationFrames: 120, interpolation: 'smoothstep' }] },
      { id: 'boss-hover', name: 'Boss Hover', loop: true, waypoints: [{ x: 120, y: 64, durationFrames: 0, interpolation: 'linear' }, { x: 200, y: 72, durationFrames: 120, interpolation: 'smoothstep' }] },
      { id: 'giant-bg-drift', name: 'Giant BG Drift', loop: false, waypoints: [{ x: 0, y: -128, durationFrames: 0, interpolation: 'linear' }, { x: 0, y: 0, durationFrames: 360, interpolation: 'smoothstep' }] },
    ]),
    enemies: collection('enemies', [
      { id: 'scout', name: 'Star Scout', sprite: ref('enemy_scout', 'SPRITE'), hp: 4, score: 300, hitbox: { x: 0, y: 0, radius: 7 }, movementId: 'swoop', patternId: 'generic-aimed', drop: { itemId: 'score-gold' }, explosionId: 'single', se: ref('bml_sfx_hit', 'WAV') },
      { id: 'turret', name: 'Ruin Turret', sprite: ref('enemy_turret', 'SPRITE'), hp: 12, score: 800, hitbox: { x: 0, y: 0, radius: 10 }, movementId: 'side-patrol', patternId: 'horizontal-rank', drop: { itemId: 'bomb-cell' }, explosionId: 'single', se: ref('bml_sfx_hit', 'WAV') },
      { id: 'destructible-ruin', name: 'Destructible Ruin', sprite: ref('destructible_ruin', 'SPRITE'), hp: 18, score: 1200, hitbox: { x: 0, y: 0, radius: 14 }, movementId: '', patternId: '', drop: { itemId: 'weapon-spread' }, explosionId: 'boss-chain', se: ref('bml_sfx_destroy', 'WAV'), destructibleBackground: true },
    ]),
    bosses: collection('bosses', [
      { id: 'astral-gate', name: 'ASTRAL GATE', sprite: ref('boss_stage1', 'SPRITE'), hp: 180, score: 20000, hitbox: { x: 0, y: 0, radius: 24 }, movementId: 'boss-hover', patternId: 'vertical-fan', drop: { itemId: 'weapon-laser' }, explosionId: 'boss-chain', se: ref('bml_sfx_destroy', 'WAV'), parts: [{ id: 'left-core', hp: 35, globalHpTransfer: .5, hitbox: { x: -24, y: 2, radius: 10 }, explosionId: 'single', disableEventId: 'disable-left' }], phases: [{ threshold: 100, patternId: 'vertical-fan', movementId: 'boss-hover', activeParts: ['left-core'], clearBullets: false }, { threshold: 55, patternId: 'boss-split', movementId: 'boss-hover', activeParts: [], clearBullets: true, rankOverride: .7 }] },
      { id: 'golden-engine', name: 'GOLDEN ENGINE', sprite: ref('boss_stage2', 'SPRITE'), hp: 240, score: 30000, hitbox: { x: 0, y: 0, radius: 26 }, movementId: 'boss-hover', patternId: 'horizontal-rank', drop: { itemId: 'bomb-cell' }, explosionId: 'boss-chain', se: ref('bml_sfx_destroy', 'WAV'), parts: [{ id: 'upper', hp: 45, globalHpTransfer: .35, hitbox: { x: 0, y: -18, radius: 11 }, explosionId: 'single', disableEventId: 'engine-slow' }, { id: 'lower', hp: 45, globalHpTransfer: .35, hitbox: { x: 0, y: 18, radius: 11 }, explosionId: 'single', disableEventId: 'engine-wave' }], phases: [{ threshold: 100, patternId: 'horizontal-rank', movementId: 'boss-hover', activeParts: ['upper', 'lower'], clearBullets: false }, { threshold: 66, patternId: 'ref-showcase', movementId: 'boss-hover', activeParts: ['lower'], wave: { preset: 'shear', amplitude: 3, wavelength: 80, speed: 1 }, clearBullets: true }, { threshold: 33, patternId: 'boss-split', movementId: 'boss-hover', activeParts: [], clearBullets: true, rankOverride: .85 }] },
      { id: 'abyss-core', name: 'ABYSS CORE', sprite: ref('boss_core', 'SPRITE'), hp: 168, score: 50000, hitbox: { x: 0, y: 0, radius: 30 }, movementId: 'giant-bg-drift', patternId: 'boss-split', drop: null, explosionId: 'boss-chain', se: ref('bml_sfx_destroy', 'WAV'), giantBackground: true, parts: [{ id: 'left-pylon', hp: 60, globalHpTransfer: .4, hitbox: { x: -88, y: 12, radius: 18 }, explosionId: 'boss-chain', disableEventId: 'pylon-left-down', followBackground: true }, { id: 'right-pylon', hp: 60, globalHpTransfer: .4, hitbox: { x: 88, y: 12, radius: 18 }, explosionId: 'boss-chain', disableEventId: 'pylon-right-down', followBackground: true }, { id: 'heart', hp: 120, globalHpTransfer: 1, hitbox: { x: 0, y: 0, radius: 20 }, explosionId: 'boss-chain', disableEventId: 'core-open', followBackground: true }], phases: [{ threshold: 100, patternId: 'ref-showcase', movementId: 'giant-bg-drift', activeParts: ['left-pylon', 'right-pylon'], backgroundId: 'giant-core', clearBullets: false }, { threshold: 70, patternId: 'vertical-fan', movementId: 'giant-bg-drift', activeParts: ['heart'], backgroundId: 'giant-core', wave: { preset: 'dual-sine', amplitude: 4, wavelength: 72, speed: 1.5 }, clearBullets: true }, { threshold: 35, patternId: 'boss-split', movementId: 'giant-bg-drift', activeParts: ['heart'], backgroundId: 'giant-core', wave: { preset: 'ripple', amplitude: 6, wavelength: 48, speed: 2 }, clearBullets: true, rankOverride: 1 }] },
    ]),
    backgrounds: collection('backgrounds', [
      { id: 'vertical-ruins', name: 'Vertical Ruins', BG_A: { map: ref('stage1_bg_a', 'MAP'), bands: [{ start: 0, end: 79, multiplier: .4 }, { start: 80, end: 159, multiplier: .75 }, { start: 160, end: 223, multiplier: 1 }], wave: { preset: 'sine', start: 64, end: 192, amplitude: 2, wavelength: 96, speed: .5, fadeFrames: 30 } }, BG_B: { map: ref('stage1_bg_b', 'MAP'), bands: [{ start: 0, end: 223, multiplier: .2 }], wave: { preset: 'none' } }, transition: 'fade', fadeFrames: 20, bgm: ref('bml_bgm_vertical', 'XGM2') },
      { id: 'horizontal-foundry', name: 'Horizontal Foundry', BG_A: { map: ref('stage2_bg_a', 'MAP'), bands: [{ start: 0, end: 63, multiplier: .25 }, { start: 64, end: 143, multiplier: .65 }, { start: 144, end: 223, multiplier: 1 }], wave: { preset: 'shear', start: 96, end: 208, amplitude: 3, wavelength: 80, speed: 1, fadeFrames: 20 } }, BG_B: { map: ref('stage2_bg_b', 'MAP'), bands: [{ start: 0, end: 111, multiplier: .15 }, { start: 112, end: 223, multiplier: .35 }], wave: { preset: 'none' } }, transition: 'cut', fadeFrames: 0, bgm: ref('bml_bgm_horizontal', 'XGM2') },
      { id: 'giant-core', name: 'Giant Core Arena', BG_A: { map: ref('stage3_bg_a', 'MAP'), bands: [{ start: 0, end: 223, multiplier: 1 }], wave: { preset: 'dual-sine', start: 0, end: 223, amplitude: 4, wavelength: 72, speed: 1.5, fadeFrames: 30 } }, BG_B: { map: ref('stage3_bg_b', 'MAP'), bands: [{ start: 0, end: 223, multiplier: .35 }], wave: { preset: 'none' } }, transition: 'fade', fadeFrames: 24, giantBossArena: true, bgm: ref('bgm_stage3', 'XGM2') },
      { id: 'caravan-depth', name: 'Caravan Depth', BG_A: { map: ref('caravan_bg_a', 'MAP'), bands: [{ start: 0, end: 111, multiplier: .6 }, { start: 112, end: 223, multiplier: 1.25 }], wave: { preset: 'jitter', start: 160, end: 223, amplitude: 1, wavelength: 24, speed: 2, fadeFrames: 0 } }, BG_B: { map: ref('caravan_bg_b', 'MAP'), bands: [{ start: 0, end: 223, multiplier: .3 }], wave: { preset: 'none' } }, transition: 'cut', fadeFrames: 0, bgm: ref('bgm_caravan', 'XGM2') },
    ]),
    'collision-materials': collection('collision-materials', [
      { id: 'none', name: 'None', solid: false, damage: 0, masks: { player: false, enemy: false, playerShot: false, enemyShot: false } },
      { id: 'solid', name: 'Solid Ruin', solid: true, damage: 0, masks: { player: true, enemy: true, playerShot: true, enemyShot: false } },
      { id: 'damage', name: 'Abyss Current', solid: false, damage: 1, masks: { player: true, enemy: false, playerShot: false, enemyShot: false } },
    ]),
  };
}

function spawn(id, frame, enemyId, x, y, patternId, extras = {}) {
  const boss = extras.boss === true;
  return { id, order: frame, trigger: { type: 'frame', frame }, action: { type: boss ? 'spawn_boss' : 'spawn_enemy', [boss ? 'bossId' : 'enemyId']: enemyId }, spawnFrame: frame, enemyType: enemyId, boss, hp: extras.hp || (boss ? 180 : 4), score: extras.score || (boss ? 20000 : 300), patternId, path: extras.path || [{ x, y, frame: 0 }, { x: x + (boss ? 0 : 30), y: y + 80, frame: 120, interpolation: 'smoothstep' }], phases: extras.phases || [], dropItemId: extras.dropItemId || '' };
}

function stageDocuments() {
  return [
    host.normalizeStage({ id: 'stage-1-vertical', name: '星骸縦坑', orientation: 'vertical', durationFrames: 3600, backgroundId: 'vertical-ruins', collisionMap: ref('stage1_collision', 'MAP', { collisionLayer: 'near' }), next: [{ stageId: 'stage-2-horizontal', flag: '', equals: true }], events: [
      { id: 'bg-start', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'set_background', backgroundId: 'vertical-ruins', transition: 'fade' } },
      spawn('scout-a', 120, 'scout', 80, -12, 'generic-aimed', { dropItemId: 'score-gold' }),
      spawn('scout-b', 300, 'scout', 230, -12, 'vertical-fan', { dropItemId: 'weapon-spread' }),
      spawn('ruin-a', 720, 'destructible-ruin', 160, 64, '', { hp: 18, score: 1200, path: [{ x: 160, y: 64, frame: 0 }] }),
      { id: 'scroll-boost', order: 900, trigger: { type: 'frame', frame: 900 }, action: { type: 'set_scroll', value: 1.8, durationFrames: 180, interpolation: 'smoothstep' } },
      spawn('boss-gate', 2400, 'astral-gate', 160, 64, 'vertical-fan', { boss: true, hp: 180, score: 20000, phases: [{ threshold: 100, patternId: 'vertical-fan' }, { threshold: 55, patternId: 'boss-split', rankOverride: .7 }] }),
      { id: 'clear', order: 3599, trigger: { type: 'condition', bossId: 'astral-gate' }, action: { type: 'stage_clear' } },
    ] }, 'stage-1-vertical'),
    host.normalizeStage({ id: 'stage-2-horizontal', name: '金色機関回廊', orientation: 'horizontal', durationFrames: 3900, backgroundId: 'horizontal-foundry', collisionMap: ref('stage2_collision', 'MAP', { collisionLayer: 'near' }), next: [{ stageId: 'stage-3-giant', flag: '', equals: true }], events: [
      { id: 'bg-start', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'set_background', backgroundId: 'horizontal-foundry', transition: 'cut' } },
      spawn('turret-a', 180, 'turret', 336, 60, 'horizontal-rank', { dropItemId: 'bomb-cell', path: [{ x: 336, y: 60, frame: 0 }, { x: 220, y: 60, frame: 120 }] }),
      spawn('scout-c', 420, 'scout', 336, 140, 'ref-showcase', { path: [{ x: 336, y: 140, frame: 0 }, { x: 180, y: 112, frame: 150 }] }),
      { id: 'wave-on', order: 960, trigger: { type: 'scroll', scroll: 640 }, action: { type: 'set_wave', plane: 'BG_A', wave: { preset: 'shear', start: 96, end: 208, amplitude: 3, wavelength: 80, speed: 1, fadeFrames: 30 } } },
      spawn('boss-engine', 2700, 'golden-engine', 240, 112, 'horizontal-rank', { boss: true, hp: 240, score: 30000, phases: [{ threshold: 100, patternId: 'horizontal-rank' }, { threshold: 66, patternId: 'ref-showcase' }, { threshold: 33, patternId: 'boss-split', rankOverride: .85 }] }),
      { id: 'clear', order: 3899, trigger: { type: 'condition', bossId: 'golden-engine' }, action: { type: 'stage_clear' } },
    ] }, 'stage-2-horizontal'),
    host.normalizeStage({ id: 'stage-3-giant', name: '深淵核', orientation: 'vertical', durationFrames: 4200, backgroundId: 'giant-core', collisionMap: ref('stage3_collision', 'MAP', { collisionLayer: 'near' }), next: [], giantBoss: { bossId: 'abyss-core', arenaPlane: 'BG_B', bossPlane: 'BG_A' }, events: [
      { id: 'bg-start', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'set_background', backgroundId: 'giant-core', transition: 'fade' } },
      spawn('core', 480, 'abyss-core', 160, 70, 'ref-showcase', { boss: true, hp: 168, score: 50000, path: [{ x: 160, y: -64, frame: 0 }, { x: 160, y: 70, frame: 360 }], phases: [{ threshold: 100, patternId: 'ref-showcase' }, { threshold: 70, patternId: 'vertical-fan' }, { threshold: 35, patternId: 'boss-split', rankOverride: 1 }] }),
      { id: 'core-wave', order: 1600, trigger: { type: 'condition', flag: 'core-open', operator: 'set' }, action: { type: 'set_wave', plane: 'BG_A', wave: { preset: 'ripple', start: 0, end: 223, amplitude: 6, wavelength: 48, speed: 2, fadeFrames: 30 } } },
      { id: 'clear', order: 4199, trigger: { type: 'condition', bossId: 'abyss-core' }, action: { type: 'stage_clear' } },
    ] }, 'stage-3-giant'),
    host.normalizeStage({ id: 'caravan-abyss', name: 'ABYSS CARAVAN 120', orientation: 'vertical', durationFrames: 7200, backgroundId: 'caravan-depth', collisionMap: ref('caravan_collision', 'MAP', { collisionLayer: 'near' }), next: [], caravan: true, events: [
      { id: 'bg-start', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'set_background', backgroundId: 'caravan-depth', transition: 'cut' } },
      ...Array.from({ length: 10 }, (_, index) => spawn(`wave-${index + 1}`, 180 + index * 540, index % 3 === 2 ? 'turret' : 'scout', 40 + (index * 57) % 240, -12, index % 2 ? 'vertical-fan' : 'horizontal-rank', { dropItemId: 'score-gold' })),
      { id: 'clear', order: 7199, trigger: { type: 'frame', frame: 7199 }, action: { type: 'stage_clear' } },
    ] }, 'caravan-abyss'),
  ];
}

function scenesDocument() {
  const message = (speaker, text) => ({ type: 'message', speaker, text, textColor: '#ffffff', voiceAssetId: '', mouthSlot: null });
  const background = () => ({ type: 'background', assetId: 'bg_abyss', transition: 'fade', fadeOutFrames: 16, fadeInFrames: 16, x: 0, y: 0, palette: 'PAL0' });
  const actor = (x = 32) => ({ type: 'sprite', slot: 0, assetId: 'sp_geroneko', x, y: 24, animationId: 'default', flipX: false, flipY: false, visible: true, palette: 'PAL2' });
  const scene = (id, name, commands, nextSceneId = '') => ({ id, name, commands, nextSceneId });
  return {
    version: 2,
    settings: { messageSpeedFrames: 2, messageAdvanceMode: 'button', messageAutoWaitFrames: 60 },
    startScene: 'opening',
    scenes: [
      scene('opening', '起動', [background(), actor(), { type: 'audio', kind: 'psg', action: 'play', assetId: 'demo_bgm', channel: 0, target: 'bgm' }, message('ネコ型航宙機 GERONEKO', '星骸機関が再起動した。蒼紺の深淵へ潜航する。'), { type: 'wait', frames: 30 }]),
      scene('pre-1', '第一層', [background(), message('管制AI ミオ', '縦坑を降下。左右入力で機体姿勢が変わる。速度シフトを忘れないで。')]),
      scene('post-1', '門の残響', [background(), actor(180), { type: 'spritemove', slot: 0, x: 120, y: 24, frames: 30 }, message('GERONEKO', '門は破壊した。でも奥から、呼ぶ声がする。')]),
      scene('pre-2', '第二層', [background(), message('ミオ', '横坑へ転進。上下一帯が衝突地形、金色機関の波形に注意。')]),
      scene('post-2', '記憶片', [background(), message('星骸機関', 'ワタシハ、捨テラレタ星ノ記憶。壊スノカ、救ウノカ。'), { type: 'variable', variableName: 'core_heard', operation: 'define', value: 1, min: 0, max: 1 }]),
      scene('pre-3', '最深部', [background(), actor(), message('ミオ', 'BG_Aそのものが巨大個体。画素ではなく追従Partsを狙って！')]),
      scene('post-3-choice', '選択', [background(), message('星骸機関', '選ベ。ワタシヲ星空ヘ還スカ、永遠ニ停止スルカ。'), { type: 'variable', variableName: 'abyss_choice', operation: 'define', value: 0, min: 0, max: 1 }, { type: 'choice', variableName: 'abyss_choice', defaultIndex: 0, choices: [{ label: '救済する', value: 1, targetSceneId: '' }, { label: '破壊する', value: 0, targetSceneId: '' }] }]),
      scene('ending-rescue', '救済END', [background(), message('GERONEKO', '機関を開放する。記憶は新しい星座になって、深淵を照らした。'), { type: 'variable', variableName: 'ending_rescue', operation: 'define', value: 1, min: 0, max: 1 }]),
      scene('ending-destroy', '破壊END', [background(), message('GERONEKO', '機関を停止する。静寂の向こうで、最後の金色光が消えた。'), { type: 'variable', variableName: 'ending_destroy', operation: 'define', value: 1, min: 0, max: 1 }]),
      scene('caravan-intro', 'CARAVAN', [background(), message('ミオ', '120秒の深度試験。時間切れで入力・敵・弾を即停止する。')]),
      scene('caravan-result', 'RESULT', [background(), message('ミオ', '試験終了。スコアと残りframeをSRAMへ記録した。')]),
    ],
  };
}

function writeVnDocuments() {
  writeJson('assets/pce-vn-scenes.json', scenesDocument());
  writeJson('assets/pce-assets.json', {
    version: 2,
    assets: [
      { id: 'bg_abyss', name: 'Abyss VN background', type: 'image', source: 'assets/images/vn_abyss.png', options: {} },
      { id: 'sp_geroneko', name: 'GERONEKO actor', type: 'sprite', source: 'assets/sprites/vn_geroneko.png', options: { transparentIndex: 0, animations: [{ id: 'default', name: 'Default', frameWidth: 64, frameHeight: 96, firstCell: 0, frameCount: 1, frameDelay: 12, frameDelays: [12], frameStrideCells: 1, loop: true }] } },
      { id: 'demo_bgm', name: 'Demo BGM', type: 'psg-song', source: '', options: { kind: 'song', bpm: 96, speed: 6, steps: 8, volume: 22, pattern: [{ step: 0, channel: 0, period: 508, volume: 22 }, { step: 2, channel: 0, period: 428, volume: 22 }, { step: 4, channel: 0, period: 381, volume: 22 }, { step: 6, channel: 0, period: 428, volume: 22 }] } },
    ],
  });
}

function updatePatterns(fingerprint) {
  const patternRoot = path.join(dataRoot, 'patterns');
  ensureDir(patternRoot);
  for (const fileName of fs.readdirSync(patternRoot).filter((file) => file.endsWith('.json'))) {
    const filePath = path.join(patternRoot, fileName);
    const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pattern = schema.normalizePattern(current, path.basename(fileName, '.json'));
    pattern.schemaVersion = 2;
    pattern.sprite = { ...schema.DEFAULT_SPRITE, asset: ref('bml_bullet', 'SPRITE', { animationRow: 0 }), paletteFingerprint: fingerprint };
    fs.writeFileSync(filePath, `${JSON.stringify(pattern, null, 2)}\n`);
  }
}

function writeDocuments(fingerprint) {
  const project = projectDocument(fingerprint);
  const collections = showcaseCollections();
  const stages = stageDocuments();
  writeJson('data/bulletml/project.json', project);
  writeJson('data/bulletml/pools.json', host.DEFAULT_POOLS);
  writeJson('data/bulletml/game-flow.json', host.DEFAULT_GAME_FLOW);
  writeJson('data/bulletml/input.json', host.DEFAULT_INPUT);
  writeJson('data/bulletml/save.json', host.DEFAULT_SAVE);
  writeJson('data/bulletml/player.json', host.DEFAULT_PLAYER);
  for (const [kind, value] of Object.entries(collections)) writeJson(`data/bulletml/${kind}.json`, value);
  const demoBindings = {
    ...host.DEFAULT_DEMO_BINDINGS,
    opening: 'opening',
    stages: {
      'stage-1-vertical': { pre: 'pre-1', post: 'post-1' },
      'stage-2-horizontal': { pre: 'pre-2', post: 'post-2' },
      'stage-3-giant': { pre: 'pre-3', post: 'post-3-choice' },
    },
    endings: { rescue: 'ending-rescue', destroy: 'ending-destroy' },
    endingSelector: { flag: 'abyss_choice', rescueWhen: true },
    caravan: { pre: 'caravan-intro', result: 'caravan-result' },
    flags: ['core_heard', 'abyss_choice', 'ending_rescue', 'ending_destroy'],
  };
  writeJson('data/bulletml/demo-bindings.json', demoBindings);
  writeJson('data/bulletml/editor-state.json', { ...schema.DEFAULT_EDITOR_STATE, schemaVersion: 2, page: 'project', selectedPatternId: 'generic-aimed', selectedStageId: 'stage-1-vertical' });
  for (const stage of stages) writeJson(`data/bulletml/stages/${stage.id}.json`, stage);
  // Old filenames become explicit v2 stages too, so no schema-v1 file can be
  // encountered by a 2.0 reader before a clean checkout removes them.
  const oldVertical = path.join(dataRoot, 'stages', 'vertical.json');
  const oldHorizontal = path.join(dataRoot, 'stages', 'horizontal.json');
  if (fs.existsSync(oldVertical)) fs.unlinkSync(oldVertical);
  if (fs.existsSync(oldHorizontal)) fs.unlinkSync(oldHorizontal);
  updatePatterns(fingerprint);
  const snapshot = { project, collections, patterns: fs.readdirSync(path.join(dataRoot, 'patterns')).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(dataRoot, 'patterns', file), 'utf8'))), stages, runtimeIds: host.DEFAULT_RUNTIME_IDS };
  writeJson('data/bulletml/runtime-ids.json', host.reconcileRuntimeIds(snapshot));
}

function writeProjectConfig() {
  writeJson('project.json', {
    coreId: 'mega-drive', title: 'GERONEKO -ABYSS STRIKE-', author: 'MD GAME EDITOR', serial: 'GM GNAS0001-00', region: 'JUE', generatedAt: new Date().toISOString(),
    pluginRoles: { builder: 'bulletml-stg-builder', testplay: 'standard-emulator' },
    pluginSettings: { sidebarOrder: ['bulletml-stg-editor', 'asset-manager', 'sprite-editor', 'tilemap-editor', 'code-editor'] },
  });
}

function main() {
  if (!templateRoot.startsWith(path.join(repoRoot, 'template') + path.sep)) throw new Error('Refusing to generate outside bundled template root');
  ensureDir(dataRoot); ensureDir(resRoot); ensureDir(assetsRoot);
  const images = writeImages();
  writeMaps();
  writeAudio();
  resourcesRes();
  writeVnDocuments();
  writeDocuments(images.bulletPaletteFingerprint);
  writeProjectConfig();
  const report = {
    schemaVersion: 2,
    title: 'GERONEKO -ABYSS STRIKE-',
    generatedAt: new Date().toISOString(),
    campaignStages: 3,
    caravanStages: 1,
    indexedImages: images.files.length,
    bulletPaletteFingerprint: images.bulletPaletteFingerprint,
  };
  writeJson('data/bulletml/showcase-generation.json', report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
