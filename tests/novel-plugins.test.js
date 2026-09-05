'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const schema = require('../plugins/md-novel-editor/novel-schema');
const image = require('../plugins/md-novel-editor/novel-image');
const font = require('../plugins/md-novel-editor/novel-font');
const convert = require('../plugins/md-novel-editor/novel-convert');
const service = require('../plugins/md-novel-editor/novel-service');
const pceImport = require('../plugins/md-novel-editor/pce-import');
const plugin = require('../plugins/md-novel-editor');
const builder = require('../plugins/md-novel-builder');
const codegen = require('../plugins/md-novel-builder/codegen');

function temporaryDirectory(t, prefix = 'md-novel-test-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), true);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function solidPng(width, height, palette, pattern = 0) {
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) indices[y * width + x] = (x + y + pattern) % palette.length;
  }
  return image.encodeIndexedPng(width, height, indices, palette);
}

function patternedPng(width, height, palette, seed = 1) {
  const indices = new Uint8Array(width * height);
  let state = seed >>> 0;
  for (let index = 0; index < indices.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    indices[index] = (state >>> 0) % palette.length;
  }
  return image.encodeIndexedPng(width, height, indices, palette);
}

function minimalJpegHeader(width, height) {
  const buffer = Buffer.alloc(23);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  buffer.set([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9], 11);
  return buffer;
}

function minimalBmpHeader(width, height) {
  const buffer = Buffer.alloc(26);
  buffer.write('BM', 0, 'ascii');
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  return buffer;
}

function twoPixelBmp() {
  const buffer = Buffer.alloc(62);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(2, 18);
  buffer.writeInt32LE(1, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(8, 34);
  buffer.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return buffer;
}

function minimalWebpHeader(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBPVP8X', 8, 'ascii');
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function minimalUnicodeFont(codePoints) {
  const points = [...new Set(codePoints)].sort((left, right) => left - right);
  const cmapOffset = 28;
  const cmapLength = 28 + points.length * 12;
  const buffer = Buffer.alloc(cmapOffset + cmapLength);
  buffer.writeUInt32BE(0x00010000, 0);
  buffer.writeUInt16BE(1, 4);
  buffer.write('cmap', 12, 4, 'ascii');
  buffer.writeUInt32BE(cmapOffset, 20);
  buffer.writeUInt32BE(cmapLength, 24);
  buffer.writeUInt16BE(0, cmapOffset);
  buffer.writeUInt16BE(1, cmapOffset + 2);
  buffer.writeUInt16BE(3, cmapOffset + 4);
  buffer.writeUInt16BE(10, cmapOffset + 6);
  buffer.writeUInt32BE(12, cmapOffset + 8);
  const subtable = cmapOffset + 12;
  buffer.writeUInt16BE(12, subtable);
  buffer.writeUInt16BE(0, subtable + 2);
  buffer.writeUInt32BE(16 + points.length * 12, subtable + 4);
  buffer.writeUInt32BE(0, subtable + 8);
  buffer.writeUInt32BE(points.length, subtable + 12);
  points.forEach((codePoint, index) => {
    const group = subtable + 16 + index * 12;
    buffer.writeUInt32BE(codePoint, group);
    buffer.writeUInt32BE(codePoint, group + 4);
    buffer.writeUInt32BE(index + 1, group + 8);
  });
  return buffer;
}

function fixtureDocuments() {
  const sceneDocument = {
    version: 2,
    settings: { messageSpeedFrames: 10, messageAdvanceMode: 'button', messageAutoWaitFrames: 60, futureSetting: 'kept' },
    startScene: 's1',
    futureRoot: { nested: ['keep', { flag: true }] },
    scenes: [{
      id: 's1',
      name: 'Fixture',
      futureScene: { key: 'value' },
      commands: [
        { type: 'background', assetId: 'bg', transition: 'none', x: 0, y: 0, futureCommand: { n: 1 } },
        { type: 'sprite', slot: 0, assetId: 'sp_mu_a', x: 0, y: 0, animationId: 'default', visible: true },
        { type: 'sprite', slot: 1, assetId: 'sp_mu_b', x: 64, y: 0, animationId: 'default', visible: true },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'song', channel: 0, target: 'bgm' },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'sfx', channel: 1, target: 'sfx' },
        { type: 'message', speaker: 'A', text: 'hello', voiceAssetId: 'voice', mouthSlot: 0 },
      ],
      nextSceneId: '',
    }],
  };
  const animations = [{ id: 'default', frameWidth: 8, frameHeight: 8, frameCount: 1, frameDelay: 8, frameDelays: [8], firstCell: 0, frameStrideCells: 1, loop: true }];
  const catalog = {
    version: 2,
    assets: [
      { id: 'bg', type: 'image', source: 'assets/images/bg.png', options: { transparentIndex: 0 } },
      { id: 'sp_mu_a', type: 'sprite', source: 'assets/sprites/a.png', options: { transparentIndex: 0, animations, spriteEditor: { frameWidth: 8, frameHeight: 8, time: '1', collision: 'NONE' } } },
      { id: 'sp_mu_b', type: 'sprite', source: 'assets/sprites/b.png', options: { transparentIndex: 0, animations, spriteEditor: { frameWidth: 8, frameHeight: 8, time: '1', collision: 'NONE' } } },
      { id: 'song', type: 'psg-song', source: '', options: { bpm: 120, steps: 2, pattern: [{ step: 0, channel: 0, note: 'C4', period: 428, volume: 20 }, { step: 1, channel: 0, volume: 0 }] } },
      { id: 'sfx', type: 'psg-sfx', source: '', options: { bpm: 120, steps: 2, pattern: [{ step: 0, channel: 0, period: 100, volume: 31 }, { step: 1, channel: 0, period: 100, volume: 0 }] } },
      { id: 'voice', type: 'adpcm', source: 'assets/audio/voice.wav', options: {} },
    ],
  };
  return { sceneDocument, catalog };
}

function createSourceFixture(root) {
  const { sceneDocument, catalog } = fixtureDocuments();
  fs.mkdirSync(path.join(root, 'assets', 'images'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'sprites'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ coreId: 'pc-engine', serial: 'TEST-NOVEL' }, null, 2));
  fs.writeFileSync(path.join(root, 'assets', 'pce-vn-scenes.json'), JSON.stringify(sceneDocument, null, 2));
  fs.writeFileSync(path.join(root, 'assets', 'pce-assets.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(root, 'assets', 'pce-font.json'), JSON.stringify({ version: 1, fontPath: '', fonts: [], futureFont: true }, null, 2));
  fs.writeFileSync(path.join(root, 'assets', 'images', 'bg.png'), solidPng(8, 8, [[0, 0, 0, 255], [255, 128, 0, 255]]));
  fs.writeFileSync(path.join(root, 'assets', 'sprites', 'a.png'), solidPng(8, 8, [[0, 0, 0, 255], [255, 0, 0, 255]]));
  fs.writeFileSync(path.join(root, 'assets', 'sprites', 'b.png'), solidPng(8, 8, [[0, 0, 0, 255], [0, 255, 0, 255]], 1));
  return { sceneDocument, catalog };
}

test('md-novel-editor manifest exposes Runtime v2.5 hooks and matching page', () => {
  const manifest = plugin.manifest;
  assert.deepEqual(manifest.types, ['editor', 'asset']);
  assert.deepEqual(manifest.supportedCores, ['mega-drive']);
  assert.equal(manifest.tab.page, manifest.renderer.page);
  for (const hook of manifest.mainApi.hooks) {
    assert.equal(manifest.hooks.includes(hook), true);
    assert.equal(typeof plugin[hook], 'function');
  }
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-editor', 'renderer-app.mjs'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-editor', 'novel-service.js'), 'utf8');
  assert.doesNotMatch(renderer, /['"](?:mu|chika|ren)['"]/);
  assert.doesNotMatch(serviceSource, /['"](?:mu|chika|ren)['"]/);
});

test('schema keeps unknown fields and reports ignored PCE voice without mutating raw input', () => {
  const { sceneDocument, catalog } = fixtureDocuments();
  const before = JSON.stringify(sceneDocument);
  const result = schema.validateSceneDocument(sceneDocument, catalog);
  assert.equal(result.errors.length, 0);
  assert.equal(result.diagnostics.some((entry) => entry.code === 'voice-ignored'), true);
  assert.equal(JSON.stringify(sceneDocument), before);
  assert.equal(sceneDocument.futureRoot.nested[1].flag, true);
});

test('joint portrait quantization reserves transparent index zero and shares one palette', () => {
  const entries = [
    { asset: { id: 'a', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 8, frameHeight: 8 } } }, buffer: solidPng(8, 8, [[0, 0, 0, 255], [255, 0, 0, 255]]) },
    { asset: { id: 'b', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 8, frameHeight: 8 } } }, buffer: solidPng(8, 8, [[0, 0, 0, 255], [0, 255, 0, 255]], 1) },
  ];
  const outputs = convert.convertVisualGroup(entries, { reserveTransparent: true });
  assert.deepEqual(outputs.get('a').palette, outputs.get('b').palette);
  assert.deepEqual(outputs.get('a').palette[0], [0, 0, 0, 0]);
  assert.equal(outputs.get('a').metadata.maxNumSprite, 1);
  assert.equal(image.decodePng(outputs.get('a').png).sourceIndices.includes(0), true);
});

test('PAL0 visual conversion reserves black and white while sprite index zero stays transparent', () => {
  const background = convert.convertVisualGroup([{
    asset: { id: 'bg', type: 'image', options: {} },
    buffer: solidPng(8, 8, [[8, 8, 8, 255], [240, 240, 240, 255], [220, 40, 40, 255]]),
  }], { paletteProfile: 'pal0-reserved', reserveTransparent: false }).get('bg');
  assert.deepEqual(background.palette[0], [0, 0, 0, 255]);
  assert.deepEqual(background.palette[1], [255, 255, 255, 255]);
  assert.equal(background.palette.length, 16);
  assert.equal(background.metadata.paletteProfile, 'pal0-reserved');
  assert.equal(Number.isFinite(background.metadata.quality.meanDeltaE), true);

  const spriteSource = solidPng(8, 8, [[0, 0, 0, 0], [0, 0, 0, 255], [255, 0, 0, 255]]);
  const sprite = convert.convertVisualGroup([{
    asset: { id: 'sprite', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 8, frameHeight: 8 } } },
    buffer: spriteSource,
  }], { paletteProfile: 'pal0-reserved', reserveTransparent: true }).get('sprite');
  assert.deepEqual(sprite.palette[0], [0, 0, 0, 0]);
  assert.deepEqual(sprite.palette[1], [255, 255, 255, 255]);
  const decoded = image.decodePng(sprite.png);
  assert.equal(decoded.sourceIndices.includes(0), true);
  assert.equal(decoded.sourceIndices.some((value) => value >= 2), true);
  assert.equal(decoded.sourceIndices[1] >= 2, true);
  assert.deepEqual(sprite.palette[decoded.sourceIndices[1]].slice(0, 3), [36, 36, 36]);

  const shared = convert.convertVisualGroup([
    { asset: { id: 'shared-bg', type: 'image', options: {} }, buffer: solidPng(8, 8, [[0, 0, 0, 255], [0, 0, 255, 255]]) },
    { asset: { id: 'shared-sprite', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 8, frameHeight: 8 } } }, buffer: solidPng(8, 8, [[0, 0, 0, 0], [255, 0, 0, 255]]) },
  ], { paletteProfile: 'pal0-reserved', reserveTransparent: true });
  const sharedBackground = image.decodePng(shared.get('shared-bg').png);
  const sharedSprite = image.decodePng(shared.get('shared-sprite').png);
  assert.equal(sharedBackground.sourceIndices[0], 0);
  assert.equal(sharedSprite.sourceIndices[0], 0);
  assert.equal(shared.get('shared-bg').metadata.transparent, false);
  assert.equal(shared.get('shared-sprite').metadata.transparent, true);
  assert.equal(shared.get('shared-bg').paletteFingerprint, shared.get('shared-sprite').paletteFingerprint);
});

test('palette schema rejects invalid IDs and preserves ignored SpriteText color', () => {
  const document = { version: 2, startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL4' },
    { type: 'spritetext', slot: 0, text: 'x', x: 0, y: 0, color: '#ff0000' },
  ] }] };
  const catalog = { assets: [{ id: 'bg', type: 'image', source: 'assets/bg.png' }] };
  const validation = schema.validateSceneDocument(document, catalog);
  assert.equal(validation.diagnostics.some((entry) => entry.code === 'palette-invalid' && entry.severity === 'error'), true);
  assert.equal(validation.diagnostics.some((entry) => entry.code === 'spritetext-color-ignored' && entry.severity === 'warning'), true);
  assert.equal(document.scenes[0].commands[1].color, '#ff0000');
  assert.equal(schema.newCommandPalette('background'), 'PAL0');
  assert.deepEqual([0, 1, 2, 3].map((slot) => schema.newCommandPalette('sprite', slot)), ['PAL1', 'PAL2', 'PAL3', 'PAL3']);
});
test('input schema rejects an empty sync or async button mask', () => {

  const inputDocument = { version: 2, startScene: 'input', scenes: [{ id: 'input', commands: [
    { type: 'inputcheck', mode: 'sync', buttons: [] },
    { type: 'inputcheck', mode: 'cancel', buttons: [] },
  ] }] };
  const inputValidation = schema.validateSceneDocument(inputDocument, { assets: [] });
  assert.equal(inputValidation.diagnostics.some((entry) => entry.code === 'input-buttons-empty' && entry.severity === 'error'), true);
  assert.equal(inputValidation.diagnostics.filter((entry) => entry.code === 'input-buttons-empty').length, 1);
});


test('binding validation forbids one asset across PAL0 and general profiles', () => {
  const sceneDocument = { version: 2, startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL0' },
    { type: 'background', assetId: 'bg', palette: 'PAL1' },
  ] }] };
  const catalog = { assets: [{ id: 'bg', type: 'image', source: 'assets/bg.png' }] };
  const bindings = {
    sourceSceneRevision: schema.hashDocument(sceneDocument),
    assets: { bg: {
      assetId: 'bg', runtimeType: 'IMAGE', sourcePath: 'novel/bg.png', symbol: 'bg',
      legacyPalette: 'PAL0', paletteGroup: null, paletteFingerprint: 'fingerprint',
      paletteRgb333: Array.from({ length: 16 }, () => [0, 0, 0]),
      conversion: { paletteProfile: 'pal0-reserved' }, metadata: { quality: {} },
    } },
    audioVariants: {}, paletteGroups: {},
  };
  const diagnostics = service.validateBindings(sceneDocument, catalog, bindings);
  assert.equal(diagnostics.some((entry) => entry.code === 'asset-palette-profile-conflict'), true);
});
test('PSG conversion creates valid VGM and mono PCM WAV containers', () => {
  const { catalog } = fixtureDocuments();
  const song = catalog.assets.find((asset) => asset.id === 'song');
  const sfx = catalog.assets.find((asset) => asset.id === 'sfx');
  const vgm = convert.generatePsgSongVgm(song, 0);
  const wav = convert.generatePsgSfxWav(sfx, 1, 6650);
  assert.equal(vgm.subarray(0, 4).toString('ascii'), 'Vgm ');
  assert.equal(vgm.readUInt32LE(0x2c) > 0, true);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 6650);
});

test('default novel font is the bundled JF-Dot-Shinonome16 at 16px and threshold 190', () => {
  const profile = font.normalizeFontSettings();
  assert.equal(profile.kind, 'bundled');
  assert.equal(profile.source, 'font/JF-Dot-Shinonome16.ttf');
  assert.equal(profile.label, '同梱 JF-Dot-Shinonome16.ttf');
  assert.equal(profile.fontSize, 16);
  assert.equal(profile.threshold, 190);
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'res', 'novel', 'font', 'JF-Dot-Shinonome16.ttf'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), '5e265e45349b3328afa67dc3905a3ca3c628cf7c7e0eccea9c7ce8a8acc127cc');
  const atlas = image.decodePng(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'res', 'novel', 'font', 'JF-Dot-Shinonome16-atlas.png')));
  assert.deepEqual([atlas.width, atlas.height], [1504, 1504]);
  const glyphBounds = (character) => {
    const cell = font.jisCell(font.shiftJisEntry(character).code);
    let minimumY = 16;
    let maximumY = -1;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const offset = (((cell.row * 16) + y) * atlas.width + (cell.column * 16) + x) * 4;
        if (atlas.rgba[offset + 3] >= 128) {
          minimumY = Math.min(minimumY, y);
          maximumY = Math.max(maximumY, y);
        }
      }
    }
    return { minimumY, maximumY };
  };
  assert.deepEqual(glyphBounds('、'), { minimumY: 12, maximumY: 15 });
  assert.deepEqual(glyphBounds('。'), { minimumY: 11, maximumY: 14 });
  assert.deepEqual(glyphBounds('「'), { minimumY: 0, maximumY: 10 });
  assert.deepEqual(glyphBounds('」'), { minimumY: 5, maximumY: 15 });
  const migrated = font.normalizeFontSettings({ kind: 'bundled', source: 'font/misaki_gothic.png', fontSize: 16, threshold: 32 });
  assert.equal(migrated.source, profile.source);
  assert.equal(migrated.threshold, 190);
});
test('subset font plan generates baseline-preserving indexed 16x16 glyphs and rejects unsupported text', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'res', 'novel', 'font', 'JF-Dot-Shinonome16.ttf'));
  const atlas = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'res', 'novel', 'font', 'JF-Dot-Shinonome16-atlas.png'));
  const sceneDocument = {
    scenes: [{
      id: 'font',
      commands: [
        { type: 'message', speaker: 'A', text: '日本語、。' },
        { type: 'choice', choices: [{ label: 'OK' }] },
        { type: 'spritetext', text: '表示' },
      ],
    }],
  };
  const plan = font.createFontPlan(sceneDocument, font.normalizeFontSettings(), source);
  const png = font.generateBundledAtlas(plan, atlas);
  const metadata = font.generationMetadata(plan, png);
  assert.equal(font.validateGeneration(plan, metadata, png), true);
  const decoded = image.decodePng(png);
  assert.equal(decoded.width, 256);
  assert.equal(decoded.height % 16, 0);
  assert.equal(plan.entries.some((entry) => entry.character === 'Ａ'), true);
  assert.equal(plan.previewEntries.some((entry) => entry.character === 'Ｍ'), true);
  assert.equal(plan.entries.some((entry) => entry.character === 'Ｍ'), false);
  assert.equal(plan.entries.some((entry) => entry.character === '▼'), true);
  for (const [character, expected] of [['、', [12, 15]], ['。', [11, 14]]]) {
    const glyphIndex = plan.entries.findIndex((entry) => entry.character === character);
    const cellX = (glyphIndex % 16) * 16;
    const cellY = Math.floor(glyphIndex / 16) * 16;
    let minimumY = 16;
    let maximumY = -1;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const offset = ((cellY + y) * decoded.width + cellX + x) * 4;
        if (decoded.rgba[offset + 3] >= 128) {
          minimumY = Math.min(minimumY, y);
          maximumY = Math.max(maximumY, y);
        }
      }
    }
    assert.deepEqual([minimumY, maximumY], expected);
  }
  const custom = minimalUnicodeFont(['日', '本'].map((character) => character.codePointAt(0)));
  assert.equal(font.validateProjectFontCoverage(custom, [{ character: '日' }, { character: '本' }]), true);
  assert.throws(() => font.validateProjectFontCoverage(custom, [{ character: '語' }]), /glyph/);
  assert.throws(() => font.createFontPlan({ scenes: [{ commands: [{ type: 'message', text: '😀' }] }] }, {}, source), /Shift-JIS/);
});

test('project font import deduplicates, generates a validated subset, and deletes safely', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-font-source-');
  const target = temporaryDirectory(t, 'md-novel-font-target-');
  createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  const imported = await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  const entries = font.collectFontEntries(imported.sceneDocument);
  const fontPath = path.join(source, 'fixture.ttf');
  fs.writeFileSync(fontPath, minimalUnicodeFont(entries.map((entry) => entry.character.codePointAt(0))));
  const first = await service.importFont(target, { sourcePath: fontPath, label: 'Fixture' });
  const second = await service.importFont(target, { sourcePath: fontPath, label: 'Fixture duplicate' });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(first.entry.file, second.entry.file);

  const profile = structuredClone(imported.targetProfile);
  profile.font = {
    ...profile.font,
    kind: 'project',
    source: first.entry.file,
    label: first.entry.label,
    library: [first.entry],
    generation: null,
  };
  const plan = await service.prepareFontGeneration(target, { sceneDocument: imported.sceneDocument, targetProfile: profile });
  assert.equal(plan.currentValid, false);
  const indices = new Uint8Array(plan.width * plan.height);
  plan.entries.forEach((entry, index) => {
    if (entry.character !== '　') indices[Math.floor(index / 16) * 16 * plan.width + (index % 16) * 16] = 1;
  });
  const png = image.encodeIndexedPng(plan.width, plan.height, indices, [[0, 0, 0, 0], [255, 255, 255, 255]]);
  const committed = await service.commitFontGeneration(target, {
    sceneDocument: imported.sceneDocument,
    targetProfile: profile,
    inputHash: plan.inputHash,
    pngDataUrl: `data:image/png;base64,${png.toString('base64')}`,
  });
  profile.font.generation = committed.generation;
  const saved = await service.saveProject(target, {
    sceneDocument: imported.sceneDocument,
    targetProfile: profile,
    bindings: imported.bindings,
    baseRevisions: imported.revisions,
  });
  assert.equal((await service.validateFontProject(target, saved.sceneDocument, saved.targetProfile)).plan.entries.length, entries.length);

  const fallbackProfile = structuredClone(saved.targetProfile);
  fallbackProfile.font = { ...fallbackProfile.font, kind: 'bundled', source: font.BUNDLED_FONT_SOURCE, library: [], generation: null };
  const fallback = await service.saveProject(target, {
    sceneDocument: saved.sceneDocument,
    targetProfile: fallbackProfile,
    bindings: saved.bindings,
    baseRevisions: saved.revisions,
  });
  assert.equal(fallback.targetProfile.font.kind, 'bundled');
  const adjustedProfile = structuredClone(fallback.targetProfile);
  adjustedProfile.font = { ...adjustedProfile.font, threshold: 200, generation: null };
  const adjustedPlan = await service.prepareFontGeneration(target, { sceneDocument: fallback.sceneDocument, targetProfile: adjustedProfile });
  const adjustedIndices = new Uint8Array(adjustedPlan.width * adjustedPlan.height);
  adjustedPlan.entries.forEach((entry, index) => {
    if (entry.character !== '　') adjustedIndices[Math.floor(index / 16) * 16 * adjustedPlan.width + (index % 16) * 16] = 1;
  });
  const adjustedPng = image.encodeIndexedPng(adjustedPlan.width, adjustedPlan.height, adjustedIndices, [[0, 0, 0, 0], [255, 255, 255, 255]]);
  const adjustedCommit = await service.commitFontGeneration(target, {
    sceneDocument: fallback.sceneDocument,
    targetProfile: adjustedProfile,
    inputHash: adjustedPlan.inputHash,
    pngDataUrl: `data:image/png;base64,${adjustedPng.toString('base64')}`,
  });
  adjustedProfile.font.generation = adjustedCommit.generation;
  const adjustedSaved = await service.saveProject(target, {
    sceneDocument: fallback.sceneDocument,
    targetProfile: adjustedProfile,
    bindings: fallback.bindings,
    baseRevisions: fallback.revisions,
  });
  assert.equal(adjustedSaved.targetProfile.font.threshold, 200);
  assert.equal(adjustedSaved.targetProfile.font.generation.pngSha256, adjustedCommit.generation.pngSha256);
  await service.deleteFont(target, { relativePath: first.entry.file });
  assert.equal(fs.existsSync(path.join(target, first.entry.file)), false);
});

test('PCE HQ background inspection, preview, portable import, and native placement are atomic', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-hq-source-');
  const target = temporaryDirectory(t, 'md-novel-hq-target-');
  const fixture = createSourceFixture(source);
  fixture.sceneDocument.scenes[0].commands[0] = {
    ...fixture.sceneDocument.scenes[0].commands[0], x: 2, y: 1, futureCropField: { keep: true },
  };
  fixture.sceneDocument.scenes[0].commands.splice(1, 0, {
    type: 'background', assetId: 'full_title', transition: 'none', x: 3, y: 4, futureFullField: 9,
  });
  fixture.catalog.assets.push({ id: 'full_title', type: 'image', source: 'assets/images/full-title.png', options: {} });
  fs.writeFileSync(path.join(source, 'assets', 'pce-vn-scenes.json'), JSON.stringify(fixture.sceneDocument, null, 2));
  fs.writeFileSync(path.join(source, 'assets', 'pce-assets.json'), JSON.stringify(fixture.catalog, null, 2));
  fs.writeFileSync(path.join(source, 'assets', 'images', 'bg.png'), solidPng(224, 136, [[0, 0, 0, 255], [8, 24, 64, 255], [240, 80, 40, 255]]));
  fs.writeFileSync(path.join(source, 'assets', 'images', 'full-title.png'), solidPng(256, 224, [[0, 0, 0, 255], [80, 160, 240, 255]]));
  fs.mkdirSync(path.join(source, 'source', 'art'), { recursive: true });
  fs.writeFileSync(path.join(source, 'source', 'art', 'bg.png'), solidPng(640, 384, [[0, 0, 0, 255], [16, 80, 168, 255], [248, 200, 72, 255]]));
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));

  const inspected = await service.inspectPceProject(target, { sourceProjectDir: source });
  assert.equal(inspected.backgrounds.length, 1);
  assert.equal(inspected.backgrounds[0].assetId, 'bg');
  assert.equal(inspected.backgrounds[0].defaultSelection.mode, 'source');
  assert.deepEqual(inspected.target, { width: 320, height: 192 });
  const candidate = inspected.backgrounds[0].candidates[0];
  const selection = { mode: 'source', relativePath: candidate.relativePath, sha256: candidate.sha256, anchor: 'bottom-right' };
  const preview = await service.readPceNovelImportPreview(target, {
    sourceProjectDir: source, sourceRevision: inspected.sourceRevision, assetId: 'bg', selection,
  });
  assert.equal(preview.sourceWidth, 640);
  assert.equal(preview.sourceHeight, 384);
  assert.match(preview.dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(() => service.readPceNovelImportPreview(target, {
    sourceProjectDir: source, sourceRevision: 'stale', assetId: 'bg', selection,
  }), /source files changed/);
  await assert.rejects(() => service.readPceNovelImportPreview(target, {
    sourceProjectDir: source,
    assetId: 'bg',
    selection: { mode: 'source', relativePath: '../escape.png', anchor: 'center' },
  }), /Unsafe project path|must be under source/);

  const imported = await service.importPceProject(target, {
    sourceProjectDir: source,
    sourceRevision: inspected.sourceRevision,
    backgroundSelections: { bg: selection },
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.importReport.resizedBackgrounds, 1);
  assert.equal(imported.importReport.hqBackgrounds, 1);
  assert.equal(imported.importReport.fallbackBackgrounds, 0);
  const backgroundCommand = imported.sceneDocument.scenes[0].commands[0];
  const fullCommand = imported.sceneDocument.scenes[0].commands[1];
  assert.deepEqual({ x: backgroundCommand.x, y: backgroundCommand.y }, { x: 0, y: 0 });
  assert.deepEqual(backgroundCommand.futureCropField, { keep: true });
  assert.deepEqual({ x: fullCommand.x, y: fullCommand.y, future: fullCommand.futureFullField }, { x: 3, y: 4, future: 9 });
  const bgBinding = imported.bindings.assets.bg;
  assert.equal(bgBinding.placementMode, 'md-native-tiles');
  assert.deepEqual(bgBinding.conversion.resize, { width: 320, height: 192, fit: 'cover', anchor: 'bottom-right' });
  assert.equal(bgBinding.importSource.mode, 'source');
  assert.equal(bgBinding.importSource.sourceWidth, 640);
  assert.equal(bgBinding.importSource.sourceHeight, 384);
  assert.equal(fs.existsSync(path.join(target, bgBinding.originalSource)), true);
  const convertedBg = image.decodePng(fs.readFileSync(path.join(target, 'res', bgBinding.sourcePath)));
  assert.deepEqual({ width: convertedBg.width, height: convertedBg.height }, { width: 320, height: 192 });
  assert.deepEqual(convertedBg.palette[0].slice(0, 3), [0, 0, 0]);
  assert.deepEqual(convertedBg.palette[1].slice(0, 3), [255, 255, 255]);
  const convertedFull = image.decodePng(fs.readFileSync(path.join(target, 'res', imported.bindings.assets.full_title.sourcePath)));
  assert.deepEqual({ width: convertedFull.width, height: convertedFull.height }, { width: 256, height: 224 });

  const fontSource = await service.readFontSource(target, imported.targetProfile.font);
  const fontPlan = font.createFontPlan(imported.sceneDocument, imported.targetProfile.font, fontSource.buffer);
  const generated = codegen.generateProject({ ...imported, fontPlan: { entries: fontPlan.entries } });
  assert.match(generated.files['src/generated/novel_data.c'], /NOV_CMD_BACKGROUND, NOV_FLAG_BG_NATIVE_TILE, 0, 0, 0, 0,/);
  fs.writeFileSync(path.join(source, 'source', 'art', 'bg.png'), solidPng(640, 384, [[0, 0, 0, 255], [255, 0, 0, 255]]));
  await assert.rejects(() => service.importPceProject(target, {
    sourceProjectDir: source,
    sourceRevision: inspected.sourceRevision,
    backgroundSelections: { bg: selection },
  }), /source files changed/);
  const afterRejectedImport = await service.loadProject(target);
  assert.equal(afterRejectedImport.bindings.assets.bg.importSource.sourceSha256, bgBinding.importSource.sourceSha256);
});

test('ambiguous or absent HQ candidates fall back to the PCE image', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-hq-ambiguous-');
  const fixture = createSourceFixture(source);
  fs.writeFileSync(path.join(source, 'assets', 'images', 'bg.png'), solidPng(224, 136, [[0, 0, 0, 255], [128, 128, 128, 255]]));
  fs.mkdirSync(path.join(source, 'source', 'a'), { recursive: true });
  fs.mkdirSync(path.join(source, 'source', 'b'), { recursive: true });
  fs.writeFileSync(path.join(source, 'source', 'a', 'bg.png'), solidPng(640, 384, [[0, 0, 0, 255], [255, 0, 0, 255]]));
  fs.writeFileSync(path.join(source, 'source', 'b', 'bg.png'), solidPng(640, 384, [[0, 0, 0, 255], [0, 255, 0, 255]]));
  const inspected = await service.inspectPceProject('', { sourceProjectDir: source });
  assert.equal(inspected.backgrounds[0].candidates.length, 2);
  assert.equal(inspected.backgrounds[0].defaultSelection.mode, 'pce');
  fs.rmSync(path.join(source, 'source'), { recursive: true, force: true });
  const absent = await service.inspectPceProject('', { sourceProjectDir: source });
  assert.equal(absent.backgrounds[0].candidates.length, 0);
  assert.equal(absent.backgrounds[0].defaultSelection.mode, 'pce');
  assert.equal(fixture.catalog.assets[0].id, 'bg');
});

test('PCE import reports oversized 320x192 VRAM as a warning while build preflight stays hard', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-vram-import-source-');
  const target = temporaryDirectory(t, 'md-novel-vram-import-target-');
  const fixture = createSourceFixture(source);
  const palette = Array.from({ length: 16 }, (_, index) => [
    (index & 1) ? 255 : 0,
    (index & 2) ? 255 : 0,
    (index & 4) ? 255 : ((index & 8) ? 128 : 0),
    255,
  ]);
  fs.writeFileSync(path.join(source, 'assets', 'images', 'bg.png'), patternedPng(224, 136, palette, 11));
  for (const [assetId, fileName, seed] of [['sp_mu_a', 'a.png', 21], ['sp_mu_b', 'b.png', 31]]) {
    const asset = fixture.catalog.assets.find((entry) => entry.id === assetId);
    asset.options.spriteEditor.frameWidth = 64;
    asset.options.spriteEditor.frameHeight = 64;
    asset.options.animations[0].frameWidth = 64;
    asset.options.animations[0].frameHeight = 64;
    fs.writeFileSync(path.join(source, 'assets', 'sprites', fileName), patternedPng(64, 64, palette, seed));
  }
  fs.writeFileSync(path.join(source, 'assets', 'pce-assets.json'), JSON.stringify(fixture.catalog, null, 2));
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));

  const imported = await service.importPceProject(target, { sourceProjectDir: source });
  const warning = imported.importReport.warnings.find((entry) => entry.code === 'vram-budget');
  assert.equal(imported.ok, true);
  assert.equal(warning?.severity, 'warning');
  assert.equal(warning?.backgroundAssetId, 'bg');
  assert.equal(Array.isArray(warning?.spriteAssetIds), true);
  const reloaded = await service.loadProject(target);
  assert.equal(reloaded.ok, false);
  assert.equal(reloaded.budget.diagnostics.some((entry) => entry.code === 'vram-budget' && entry.severity === 'error'), true);
});

test('import, explicit PCE palettes, joint quantization, optimistic save, and unknown-field round-trip', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-source-');
  const target = temporaryDirectory(t, 'md-novel-target-');
  const fixture = createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  const imported = await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  assert.equal(imported.ok, true);
  assert.equal(imported.targetProfile.font.source, 'font/JF-Dot-Shinonome16.ttf');
  assert.equal(imported.targetProfile.font.fontSize, 16);
  assert.equal(imported.targetProfile.font.threshold, 190);
  for (const relativePath of [
    'res/novel/font/JF-Dot-Shinonome16.ttf',
    'res/novel/font/JF-Dot-Shinonome16-README.txt',
    'res/novel/font/JF-Dot-Shinonome16-LICENSE',
    'res/novel/font/generated.png',
  ]) assert.equal(fs.existsSync(path.join(target, relativePath)), true, relativePath);
  const bundledSourcePath = path.join(target, 'res', 'novel', 'font', 'JF-Dot-Shinonome16.ttf');
  fs.rmSync(bundledSourcePath);
  assert.equal(fs.existsSync(bundledSourcePath), false);
  await service.prepareFontGeneration(target, { sceneDocument: imported.sceneDocument, targetProfile: imported.targetProfile });
  assert.equal(fs.existsSync(bundledSourcePath), true);
  assert.deepEqual(imported.sceneDocument, service.injectPcePalettes(fixture.sceneDocument));
  assert.equal(imported.sceneDocument.scenes[0].commands[0].palette, 'PAL0');
  assert.equal(imported.sceneDocument.scenes[0].commands[1].palette, 'PAL1');
  assert.equal(imported.sceneDocument.scenes[0].commands[2].palette, 'PAL2');
  const customAssignments = { background: 'PAL2', slots: ['PAL3', 'PAL1', 'PAL0', 'PAL2'] };
  const customScene = service.injectPcePalettes(fixture.sceneDocument, customAssignments);
  assert.equal(customScene.scenes[0].commands[0].palette, 'PAL2');
  assert.equal(customScene.scenes[0].commands[1].palette, 'PAL3');
  assert.equal(customScene.scenes[0].commands[2].palette, 'PAL1');
  assert.deepEqual(service.normalizePcePaletteAssignments(customAssignments), customAssignments);
  assert.throws(() => service.normalizePcePaletteAssignments({
    background: 'PAL4',
    slots: ['PAL1', 'PAL2', 'PAL3', 'PAL0'],
  }), /PAL0, PAL1, PAL2, or PAL3/);
  assert.deepEqual(imported.importReport.paletteAssignments, {
    background: 'PAL0', slots: ['PAL1', 'PAL2', 'PAL3', 'PAL3'],
  });
  assert.equal(imported.bindings.audioVariants['song@0'].status, 'ready');
  assert.equal(imported.bindings.audioVariants['sfx@1'].status, 'ready');
  assert.equal(fs.existsSync(path.join(target, 'res', imported.bindings.audioVariants['song@0'].sourcePath)), true);
  const independentFingerprints = new Set(['sp_mu_a', 'sp_mu_b'].map((id) => imported.bindings.assets[id].paletteFingerprint));
  assert.equal(independentFingerprints.size, 2);
  assert.equal(imported.bindings.assets.sp_mu_a.paletteGroup, null);
  const indexed = await service.readIndexedAssets(target, { assetIds: ['bg', 'sp_mu_a'] });
  assert.equal(Buffer.from(indexed.assets.bg.indicesBase64, 'base64').length, 64);
  assert.equal(indexed.assets.bg.paletteRgb333.length, 16);

  const grouped = await service.quantizePaletteGroup(target, {
    groupId: 'portraits',
    members: ['sp_mu_a', 'sp_mu_b'],
    baseRevisions: imported.revisions,
  });
  assert.equal(grouped.ok, true);
  assert.equal(grouped.bindings.assets.sp_mu_a.paletteGroup, 'portraits');
  assert.equal(grouped.bindings.assets.sp_mu_a.paletteFingerprint, grouped.bindings.assets.sp_mu_b.paletteFingerprint);
  assert.deepEqual(grouped.bindings.paletteGroups.portraits.members, ['sp_mu_a', 'sp_mu_b']);

  const legacyBindings = structuredClone(grouped.bindings);
  legacyBindings.assets.bg.conversion.converterVersion = 1;
  legacyBindings.assets.sp_mu_a.conversion.converterVersion = 1;
  legacyBindings.assets.sp_mu_b.conversion.converterVersion = 1;
  await service.commitDocuments(target, { [service.RELATIVE_PATHS.bindings]: legacyBindings }, { sourceSceneRevision: legacyBindings.sourceSceneRevision });
  const staleConversions = await service.loadProject(target);
  assert.equal(staleConversions.diagnostics.some((entry) => entry.code === 'visual-conversion-source-stale' && entry.assetId === 'bg'), true);
  assert.equal(staleConversions.diagnostics.some((entry) => entry.code === 'palette-group-conversion-stale' && entry.groupId === 'portraits'), true);
  const regrouped = await service.quantizePaletteGroup(target, {
    groupId: 'portraits',
    members: ['sp_mu_a', 'sp_mu_b'],
    baseRevisions: staleConversions.revisions,
  });
  assert.equal(regrouped.diagnostics.some((entry) => entry.code === 'palette-group-conversion-stale'), false);
  assert.equal(regrouped.diagnostics.some((entry) => entry.code === 'visual-conversion-source-stale' && entry.assetId === 'bg'), true);
  const active = await service.saveProject(target, {
    sceneDocument: regrouped.sceneDocument,
    targetProfile: regrouped.targetProfile,
    bindings: regrouped.bindings,
    baseRevisions: regrouped.revisions,
  });
  assert.equal(active.ok, true);
  assert.equal(active.diagnostics.some((entry) => entry.code.includes('conversion') && entry.severity === 'error'), false);
  const originalTransactionPaths = Object.keys(active.transaction.documents);

  const edited = structuredClone(active.sceneDocument);
  edited.scenes[0].commands[5].text = 'edited';
  const saved = await service.saveProject(target, {
    sceneDocument: edited,
    targetProfile: active.targetProfile,
    bindings: active.bindings,
    baseRevisions: active.revisions,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.sceneDocument.futureRoot.nested[1].flag, true);
  assert.equal(saved.sceneDocument.scenes[0].commands[0].futureCommand.n, 1);
  assert.equal(originalTransactionPaths.every((entry) => saved.transaction.documents[entry]), true);
  await assert.rejects(() => service.saveProject(target, { baseRevisions: { scene: 'stale' } }), /Stale scene/);

  fs.writeFileSync(path.join(target, 'data', 'md-novel', 'target-profile.json'), JSON.stringify({ ...saved.targetProfile, tampered: true }, null, 2));
  const tampered = await service.loadProject(target);
  assert.equal(tampered.diagnostics.some((entry) => entry.code === 'transaction-hash-mismatch'), true);
  await assert.rejects(() => service.saveProject(target, {}), /inconsistent Novel transaction/);
});

test('PCE import shares one sprite across PAL0-PAL2 and PAL3 with the stricter shadow-safe profile', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-shared-sprite-source-');
  const target = temporaryDirectory(t, 'md-novel-shared-sprite-target-');
  const fixture = createSourceFixture(source);
  fixture.sceneDocument.scenes[0].commands.push({
    type: 'sprite',
    slot: 2,
    assetId: 'sp_mu_a',
    x: 128,
    y: 0,
    animationId: 'default',
    visible: true,
  });
  fs.writeFileSync(path.join(source, 'assets', 'pce-vn-scenes.json'), JSON.stringify(fixture.sceneDocument, null, 2));
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));

  const imported = await service.importPceProject(target, { sourceProjectDir: source });
  const requirement = service.visualProfileRequirements(imported.sceneDocument, imported.bindings).get('sp_mu_a');
  assert.deepEqual(new Set(requirement.palettes), new Set(['PAL1', 'PAL3']));
  assert.deepEqual(new Set(requirement.profiles), new Set(['shadow-safe-pal012', 'shadow-safe-pal3']));
  assert.equal(schema.compatiblePaletteProfile(requirement.profiles), 'shadow-safe-pal3');
  assert.equal(schema.compatiblePaletteProfile(['pal0-reserved', 'general']), null);
  assert.equal(schema.paletteProfileSatisfies('shadow-safe-pal3', 'shadow-safe-pal012'), true);
  assert.equal(schema.paletteProfileSatisfies('shadow-safe-pal012', 'shadow-safe-pal3'), false);
  assert.equal(imported.bindings.assets.sp_mu_a.conversion.paletteProfile, 'shadow-safe-pal3');
  assert.equal(imported.diagnostics.some((entry) => entry.code === 'asset-palette-profile-conflict'), false);

  const convertedPath = path.join(target, 'res', imported.bindings.assets.sp_mu_a.sourcePath);
  const converted = image.decodePng(fs.readFileSync(convertedPath));
  assert.equal(converted.sourceIndices.includes(14), false);
  assert.equal(converted.sourceIndices.includes(15), false);

  const grouped = await service.quantizePaletteGroup(target, {
    groupId: 'shared_portraits',
    members: ['sp_mu_a', 'sp_mu_b'],
    baseRevisions: imported.revisions,
  });
  assert.equal(grouped.ok, true);
  assert.equal(grouped.bindings.paletteGroups.shared_portraits.profile, 'shadow-safe-pal3');
  assert.equal(grouped.bindings.assets.sp_mu_a.conversion.paletteProfile, 'shadow-safe-pal3');
  assert.equal(grouped.bindings.assets.sp_mu_b.conversion.paletteProfile, 'shadow-safe-pal3');
  assert.equal(grouped.bindings.assets.sp_mu_a.paletteFingerprint, grouped.bindings.assets.sp_mu_b.paletteFingerprint);
  assert.equal(grouped.diagnostics.some((entry) => entry.code === 'palette-group-profile-conflict'), false);
});

test('project path and JSON guards reject traversal and prototype keys', () => {
  assert.throws(() => service.normalizeRelative('../escape.json'), /Unsafe project path/);
  assert.throws(() => service.normalizeRelative('data//escape.json'), /Unsafe project path/);
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => service.assertSafeJson(dangerous), /Unsafe JSON key/);
  assert.equal({}.polluted, undefined);
});

test('main hook converts failures into explicit ok:false results', async () => {
  const result = await plugin.loadMdNovelProject({}, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /projectDir/);
});


test('preview core preserves legacy coordinates, 75-cell pages, and four logical slots', async () => {
  const preview = await import('../plugins/md-novel-editor/preview-core.mjs');
  assert.equal(preview.effectiveX('background', 2, 'pce-legacy-256'), 48);
  assert.equal(preview.effectiveX('sprite', 12, 'pce-legacy-256'), 44);
  assert.equal(preview.effectiveX('sprite', 12, 'md-h40'), 12);
  const text = Array.from({ length: 76 }, () => 'A').join('');
  const pages = preview.paginateMessage(text);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].join('').length, 75);
  assert.equal(pages[1].join('').length, 1);
  const state = preview.simulateScene({ commands: [
    { type: 'background', assetId: 'bg', x: 2, y: 1 },
    { type: 'sprite', slot: 3, assetId: 'portrait', x: 10, y: 20, visible: true },
    { type: 'spritemove', slot: 3, x: 30, y: 40, frames: 10 },
    { type: 'spritetext', slot: 2, text: 'label', x: 1, y: 2, visible: true },
    { type: 'message', speaker: 'A', text },
  ] }, 4);
  assert.equal(state.sprites.length, 4);
  assert.equal(state.sprites[3].x, 30);
  assert.equal(state.spriteTexts[2].text, 'label');
  assert.equal(state.message.pages.length, 2);
});

test('md-novel-builder is hook-only and exports explicit source files without boot duplication', () => {
  assert.equal(builder.manifest.generator, false);
  assert.deepEqual(builder.manifest.supportedCores, ['mega-drive']);
  assert.equal(builder.manifest.roles.some((role) => role.id === 'builder' && role.exclusive), true);
  assert.deepEqual(builder.SOURCE_FILES, [
    'src/main.c',
    'src/novel_runtime/novel_runtime.c',
    'src/generated/novel_data.c',
  ]);
  assert.equal(builder.SOURCE_FILES.some((entry) => entry.includes('/boot/')), false);
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'md-novel-builder', 'template', 'src', 'novel_runtime', 'novel_runtime.c'), 'utf8');
  assert.match(runtime, /u16 guard = 0;/);
  assert.match(runtime, /guard < 512/);
  assert.match(runtime, /palette = \(u16\)command->count & 3/);
  assert.match(runtime, /loadedPaletteIds\[palette\] == paletteId/);
  assert.match(runtime, /overlaySetPixel\(x \+ pixelX, y \+ pixelY, 1\)/);
  assert.match(runtime, /restoreMessageColor\(\);/);
  assert.match(runtime, /messageDownTile/);
  assert.match(runtime, /messageAutoTile/);
  assert.match(runtime, /setMessageCursor\(messageCursorTimer < 30 \? 1 : 0\)/);
  assert.match(runtime, /else if \(mask == 0\)[\s\S]*?break;/);
  const backgroundLoader = runtime.slice(runtime.indexOf('static void loadBackground'), runtime.indexOf('static void setActor'));
  const flushIndex = backgroundLoader.indexOf('flushPendingActorClear();');
  const clearIndex = backgroundLoader.indexOf('VDP_clearPlane(BG_B, TRUE);');
  assert.ok(flushIndex >= 0 && clearIndex > flushIndex);
  assert.match(runtime, /actorSceneClearPending = TRUE;/);
  assert.doesNotMatch(runtime, /novelDataSpritePalette\(/);
});

test('codegen preserves control flow, variables, input mapping, animation, and 75-cell pagination', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-codegen-source-');
  const target = temporaryDirectory(t, 'md-novel-codegen-target-');
  createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  const imported = await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  const sceneDocument = structuredClone(imported.sceneDocument);
  sceneDocument.scenes[0].commands = [
    { type: 'background', assetId: 'bg', transition: 'fade', fadeOutFrames: 2, fadeInFrames: 3, x: 0, y: 0 },
    { type: 'sprite', slot: 0, assetId: 'sp_mu_a', x: 0, y: 0, animationId: 'default', visible: true },
    { type: 'spritemove', slot: 0, x: 8, y: 8, frames: 10, async: true, animationAssetId: 'sp_mu_a', animationId: 'default' },
    { type: 'variable', variableName: 'route', operation: 'define', value: 5, min: 0, max: 9 },
    { type: 'variable', variableName: 'route', operation: 'add', value: 2 },
    { type: 'if', variableName: 'route', operator: 'eq', value: 7, targetLabel: 'route_yes', elseLabel: 'route_no' },
    { type: 'label', name: 'route_yes' },
    { type: 'switch', variableName: 'route', cases: [{ value: 7, targetLabel: 'route_case' }], defaultLabel: 'route_no' },
    { type: 'switch', variableName: 'route', cases: [], defaultLabel: 'route_no' },
    { type: 'label', name: 'route_case' },
    { type: 'goto', targetLabel: 'done' },
    { type: 'label', name: 'route_no' },
    { type: 'variable', variableName: 'route', operation: 'random', min: -2, max: 2 },
    { type: 'choice', variableName: 'choiceResult', defaultIndex: 0, choices: [{ label: 'continue', value: 9, targetSceneId: '' }] },
    { type: 'inputcheck', buttons: ['i', 'ii', 'run'], mode: 'async', targetLabel: 'done' },
    { type: 'inputcheck', buttons: [], mode: 'cancel', targetLabel: '' },
    { type: 'effect', effect: 'fadeOut', frames: 2, color: '#000000' },
    { type: 'effect', effect: 'fadeIn', frames: 2 },
    { type: 'effect', effect: 'blank', frames: 0, color: '#000000' },
    { type: 'effect', effect: 'flash', frames: 2, color: '#ffffff' },
    { type: 'effect', effect: 'shake', frames: 2, intensity: 3 },
    { type: 'label', name: 'done' },
    { type: 'message', speaker: 'A', text: 'A'.repeat(76), textColor: '#ff0000', mouthSlot: 0 },
  ];
  const bindings = structuredClone(imported.bindings);
  bindings.sourceSceneRevision = schema.hashDocument(sceneDocument);
  const fontSource = await service.readFontSource(target, imported.targetProfile.font);
  const fontPlan = font.createFontPlan(sceneDocument, imported.targetProfile.font, fontSource.buffer);
  const generated = codegen.generateProject({
    sceneDocument,
    catalog: imported.catalog,
    targetProfile: imported.targetProfile,
    fontPlan: { entries: fontPlan.entries },
    bindings,
  });
  const c = generated.files['src/generated/novel_data.c'];
  assert.match(c, /NOV_CMD_BACKGROUND, NOV_FLAG_FADE, 0, 0,/);
  assert.match(c, /NOV_CMD_SPRITE, NOV_FLAG_VISIBLE, 0, 1,/);
  assert.match(c, /u16 novelDataBackgroundPaletteId\(u16 index\)/);
  assert.match(c, /u16 novelDataSpritePaletteId\(u16 index\)/);
  assert.match(c, /NOV_CMD_VARIABLE, NOV_VAR_DEFINE/);
  assert.match(c, /NOV_CMD_VARIABLE, NOV_VAR_ADD/);
  assert.match(c, /NOV_CMD_IF, NOV_COMPARE_EQ/);
  assert.match(c, /NOV_CMD_SWITCH/);
  assert.match(c, /NOV_CMD_GOTO/);
  assert.match(c, /NOV_CMD_INPUT, NOV_FLAG_ASYNC/);
  assert.match(c, /BUTTON_B \| BUTTON_C \| BUTTON_START/);
  assert.match(c, /static const NovelSwitch nov_switch_0/);
  assert.match(c, /static const NovelSwitch nov_switch_1 = \{ 0, \d+, \{ \{ 0, -1 \} \} \};/);
  assert.match(c, /static const s16 nov_initial_variables\[\] = \{ 0, 0, 5, 0 \}/);
  assert.match(c, /nov_message_0_pages\[\] = \{ nov_text_\d+, nov_text_\d+ \}/);
  assert.match(c, /static const NovelMessage nov_message_0 = \{ [^\r\n]+0x000e, \d+ \};/);
  assert.equal(generated.warnings.some((entry) => entry.code?.startsWith('pal0-message-')), false);
  assert.equal(generated.report.variables, 4);
  assert.equal(generated.report.switches, 2);
  assert.equal(generated.report.messages, 1);
  assert.match(generated.files['res/novel.res'], /SPRITE nov_spr_/);
  assert.match(c, /const u16 nov_font_codes\[\]/);
  assert.match(generated.files['res/novel.res'], /TILESET novel_font_subset "novel\/font\/generated\.png"/);
  assert.equal(generated.report.glyphs, fontPlan.entries.length);
  assert.equal(fontPlan.entries.some((entry) => entry.character === 'Ａ'), true);
});

test('preflight rejects aggregate VRAM and scanline sprite overflow', () => {
  const vram = codegen.visibleBudget({ scenes: [{ commands: [
    { type: 'background', assetId: 'bg' },
    { type: 'message', text: 'x' },
  ] }] }, { assets: { bg: { metadata: { uniqueTiles: 1100 } } } });
  const vramDiagnostic = vram.diagnostics.find((entry) => entry.code === 'vram-budget');
  assert.equal(Boolean(vramDiagnostic), true);
  assert.equal(vramDiagnostic.backgroundAssetId, 'bg');
  assert.equal(vramDiagnostic.backgroundTiles, 1100);
  assert.match(vramDiagnostic.message, /BG 1100, sprites 0, overlay 0, message 377/);

  const commands = Array.from({ length: 4 }, (_, slot) => ({ type: 'sprite', slot, assetId: `sp${slot}`, x: slot * 32, y: 0, visible: true }));
  const assets = Object.fromEntries(Array.from({ length: 4 }, (_, slot) => [`sp${slot}`, { metadata: { frameWidth: 96, frameHeight: 128, maxNumTile: 64, maxNumSprite: 12 } }]));
  const scanline = codegen.visibleBudget({ scenes: [{ commands }] }, { assets });
  assert.equal(scanline.diagnostics.some((entry) => entry.code === 'sprite-scanline-pixels'), true);
  assert.equal(scanline.maxScanlinePixels, 384);
});

test('preflight includes backgrounds and sprites that persist across scene changes', () => {
  const carry = codegen.visibleBudget({ startScene: 'first', scenes: [
    { id: 'first', nextSceneId: 'second', commands: [{ type: 'sprite', slot: 0, assetId: 'actor', x: 0, y: 0, visible: true }] },
    { id: 'second', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: 'x' }] },
  ] }, { assets: {
    actor: { metadata: { frameWidth: 64, frameHeight: 128, maxNumTile: 64, maxNumSprite: 8 } },
    bg: { metadata: { uniqueTiles: 1000 } },
  } });
  assert.equal(carry.maxSpriteTiles, 64);
  assert.equal(carry.maxBudget, 1441);
  assert.equal(carry.diagnostics.some((entry) => entry.code === 'vram-budget'), true);
});

test('preflight reserves disjoint VRAM for simultaneous SpriteText and message sprite glyphs', () => {
  const budget = codegen.visibleBudget({ startScene: 'overlay', scenes: [{ id: 'overlay', commands: [
    { type: 'spritetext', slot: 0, text: 'A', x: 1, y: 1, visible: true },
    { type: 'spritetext', slot: 1, text: 'B', x: 33, y: 1, visible: true },
    { type: 'message', text: 'x' },
  ] }] }, { assets: {} });
  assert.equal(budget.maxOverlayTiles, 18);
  assert.deepEqual(budget.sceneOverlayTiles, [18]);
  assert.equal(budget.maxBudget, 395);
  assert.equal(budget.diagnostics.length, 0);
});

test('preflight reserves SpriteText overlay per scene instead of across unrelated scenes', () => {
  const budget = codegen.visibleBudget({ startScene: 'title', scenes: [
    { id: 'title', nextSceneId: 'story', commands: [
      { type: 'spritetext', slot: 0, text: 'TITLE', x: 0, y: 0, visible: true },
    ] },
    { id: 'story', commands: [
      { type: 'background', assetId: 'bg' },
      { type: 'message', text: 'x' },
    ] },
  ] }, { assets: { bg: { metadata: { uniqueTiles: 960 } } } });
  assert.equal(budget.maxOverlayTiles > 0, true);
  assert.deepEqual(budget.sceneOverlayTiles, [budget.maxOverlayTiles, 0]);
  assert.equal(budget.maxBudget, 1337);
  assert.equal(budget.diagnostics.some((entry) => entry.code === 'vram-budget'), false);
});

test('preflight rejects simultaneous physical PAL conflicts but allows sequential or shared-fingerprint reuse', () => {
  const asset = (fingerprint, sprite = false) => ({
    paletteFingerprint: fingerprint,
    metadata: sprite
      ? { frameWidth: 8, frameHeight: 8, maxNumTile: 1, maxNumSprite: 1 }
      : { uniqueTiles: 1 },
  });
  const simultaneous = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL2' },
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL2', x: 0, y: 0, visible: true },
  ] }] }, { assets: { bg: asset('bg-palette'), actor: asset('actor-palette', true) } });
  assert.equal(simultaneous.diagnostics.some((entry) => entry.code === 'palette-runtime-conflict' && entry.palette === 'PAL2'), true);

  const sequential = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'sprite', slot: 0, assetId: 'actor-a', palette: 'PAL2', x: 0, y: 0, visible: true },
    { type: 'sprite', slot: 0, assetId: 'actor-b', palette: 'PAL2', x: 8, y: 0, visible: true },
  ] }] }, { assets: { 'actor-a': asset('a', true), 'actor-b': asset('b', true) } });
  assert.equal(sequential.diagnostics.some((entry) => entry.code === 'palette-runtime-conflict'), false);

  const shared = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL3' },
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL3', x: 0, y: 0, visible: true },
  ] }] }, { assets: { bg: asset('joint'), actor: asset('joint', true) } });
  assert.equal(shared.diagnostics.some((entry) => entry.code === 'palette-runtime-conflict'), false);
});

test('preflight reserves the selected PAL1 or PAL2 index 14 for normal-intensity message glyphs', () => {
  const pal0Background = {
    paletteFingerprint: 'bg',
    metadata: { uniqueTiles: 1, usesPaletteIndex1: true },
  };
  const assetBindings = { assets: { bg: pal0Background } };
  const occupied = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL0' },
    { type: 'message', text: 'red', textColor: '#ff0000' },
  ] }] }, assetBindings);
  assert.equal(occupied.diagnostics.some((entry) => entry.code?.startsWith('pal0-message-')), false);
  assert.deepEqual(occupied.messageColorFallbacks, []);

  const spriteBinding = (fingerprint, paletteIndicesUsed) => ({
    paletteFingerprint: fingerprint,
    metadata: { frameWidth: 8, frameHeight: 8, maxNumTile: 1, maxNumSprite: 1, paletteIndicesUsed },
  });
  const pal1BackgroundUsesPal2 = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL1' },
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL2', x: 0, y: 0, visible: true },
    { type: 'message', text: 'white' },
  ] }] }, { assets: { bg: pal0Background, actor: spriteBinding('actor', [14]) } });
  const pal2Diagnostic = pal1BackgroundUsesPal2.diagnostics.find((entry) => entry.code === 'message-normal-index-conflict');
  assert.equal(pal2Diagnostic?.severity, 'error');
  assert.equal(pal2Diagnostic?.palette, 'PAL2');
  assert.deepEqual(pal2Diagnostic?.assetIds, ['actor']);

  const pal0BackgroundUsesPal1 = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL0' },
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL1', x: 0, y: 0, visible: true },
    { type: 'message', text: 'white' },
  ] }] }, { assets: { bg: pal0Background, actor: spriteBinding('actor', [14]) } });
  assert.equal(pal0BackgroundUsesPal1.diagnostics.some((entry) => entry.code === 'message-normal-index-conflict' && entry.palette === 'PAL1'), true);

  const safe = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'background', assetId: 'bg', palette: 'PAL0' },
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL1', x: 0, y: 0, visible: true },
    { type: 'spritetext', slot: 1, text: 'overlay', x: 0, y: 0, visible: true },
    { type: 'message', text: 'red', textColor: '#ff0000' },
  ] }] }, { assets: { bg: pal0Background, actor: spriteBinding('actor', [13]) } });
  assert.equal(safe.diagnostics.some((entry) => entry.code === 'message-normal-index-conflict'), false);
  assert.deepEqual(safe.messageColorFallbacks, []);
});
test('builder rejects case-insensitive ResComp symbol conflicts', (t) => {
  const target = temporaryDirectory(t, 'md-novel-symbol-target-');
  fs.mkdirSync(path.join(target, 'res'), { recursive: true });
  fs.writeFileSync(path.join(target, 'res', 'other.res'), 'IMAGE SharedSymbol "other.png" NONE ALL\n');
  assert.throws(() => builder.validateResSymbols(target, 'IMAGE sharedsymbol "novel/a.png" NONE ALL 0\n'), /conflicts/);
});

test('onBuildStart commits a complete generated set and removes build staging', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-build-source-');
  const target = temporaryDirectory(t, 'md-novel-build-target-');
  createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  const logs = [];
  const result = await builder.onBuildStart({ projectDir: target }, { logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line) } });
  assert.equal(result.ok, true);
  assert.equal(result.makeVariables.SRC_C, builder.SOURCE_FILES.join(' '));
  assert.equal(result.makeVariables.SRC_C.includes('boot'), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'data', 'md-novel', 'generated-manifest.json'), 'utf8'));
  for (const relative of [...Object.keys(builder.STATIC_FILES), 'res/novel.res', 'inc/generated/novel_data.h', 'src/generated/novel_data.c']) {
    assert.equal(typeof manifest.files[relative], 'string');
    assert.equal(fs.existsSync(path.join(target, ...relative.split('/'))), true);
  }
  const messageShape = image.decodePng(fs.readFileSync(path.join(target, 'res', 'novel', 'system', 'message-shapes.png')));
  assert.equal(messageShape.sourceIndices.every((index) => index === 1), true);
  const staging = path.join(target, 'data', 'md-novel', '.staging');
  assert.equal(!fs.existsSync(staging) || fs.readdirSync(staging).length === 0, true);
  assert.equal(logs.some((line) => /sprite VRAM/.test(line)), true);
});

test('Test Play cache reuses unchanged objects and forces clean after generated cache corruption', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-incremental-source-');
  const target = temporaryDirectory(t, 'md-novel-incremental-target-');
  const toolchain = temporaryDirectory(t, 'md-novel-toolchain-');
  createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  fs.writeFileSync(path.join(toolchain, 'makefile.gen'), '# fixture\n');
  const logs = [];
  const context = { projectDir: target, logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) } };
  const first = await builder.onBuildStart({ projectDir: target, toolchainPath: toolchain, skipClean: true }, context);
  assert.equal(first.ok, true);
  assert.equal(first.skipClean, false);
  const mainPath = path.join(target, 'src', 'main.c');
  const firstMtime = fs.statSync(mainPath).mtimeMs;
  fs.mkdirSync(path.join(target, 'out', 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'out', 'rom.bin'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(target, 'out', 'src', 'main.o'), Buffer.from('object'));
  const completed = await builder.onBuildEnd({ projectDir: target, romPath: path.join(target, 'out', 'rom.bin') }, context);
  assert.equal(completed.ok, true);

  const second = await builder.onBuildStart({ projectDir: target, toolchainPath: toolchain, skipClean: true }, context);
  assert.equal(second.ok, true);
  assert.equal(second.skipClean, true);
  assert.equal(fs.statSync(mainPath).mtimeMs, firstMtime);
  let manifest = JSON.parse(fs.readFileSync(path.join(target, 'data', 'md-novel', 'generated-manifest.json'), 'utf8'));
  assert.equal(manifest.fileStats.changed, 0);
  assert.equal(manifest.fileStats.unchanged > 0, true);
  assert.equal(logs.some((line) => /input unchanged\/object reused/.test(line)), true);

  const objectPath = path.join(target, 'out', 'src', 'main.o');
  fs.unlinkSync(objectPath);
  const missingObject = await builder.onBuildStart({ projectDir: target, toolchainPath: toolchain, skipClean: true }, context);
  assert.equal(missingObject.ok, true);
  assert.equal(missingObject.skipClean, false);
  assert.equal(logs.some((line) => /previous object is missing/.test(line)), true);
  fs.writeFileSync(objectPath, Buffer.from('rebuilt-object'));
  assert.equal((await builder.onBuildEnd({ projectDir: target, romPath: path.join(target, 'out', 'rom.bin') }, context)).ok, true);
  const recovered = await builder.onBuildStart({ projectDir: target, toolchainPath: toolchain, skipClean: true }, context);
  assert.equal(recovered.skipClean, true);

  const generatedSource = path.join(target, 'src', 'generated', 'novel_data.c');
  fs.appendFileSync(generatedSource, '\n/* corrupt */\n');
  const third = await builder.onBuildStart({ projectDir: target, toolchainPath: toolchain, skipClean: true }, context);
  assert.equal(third.ok, true);
  assert.equal(third.skipClean, false);
  manifest = JSON.parse(fs.readFileSync(path.join(target, 'data', 'md-novel', 'generated-manifest.json'), 'utf8'));
  assert.equal(manifest.lastBuildSuccess, false);
  assert.equal(logs.some((line) => /cache mismatch/.test(line)), true);
});

test('incremental build rewrites absolute ResComp dependencies below a non-ASCII project path', (t) => {
  const target = temporaryDirectory(t, 'md-novel-日本語-path-');
  const dependencyDir = path.join(target, 'out', 'res');
  fs.mkdirSync(dependencyDir, { recursive: true });
  const dependencyPath = path.join(dependencyDir, 'novel.d');
  const absoluteRoot = path.resolve(target).replace(/\\/g, '/');
  fs.writeFileSync(dependencyPath, [
    'out/res/novel.o: res/novel.res \\',
    `${absoluteRoot}/res/novel/backgrounds/bg.png \\`,
    `${absoluteRoot}/res/novel/font/generated.png`,
    '',
  ].join('\n'));
  assert.equal(builder.normalizeRescompDependencyFiles(target), 1);
  const normalized = fs.readFileSync(dependencyPath, 'utf8');
  assert.equal(normalized.includes(absoluteRoot), false);
  assert.match(normalized, /res\/novel\/backgrounds\/bg\.png/);
  assert.match(normalized, /res\/novel\/font\/generated\.png/);
  assert.equal(builder.normalizeRescompDependencyFiles(target), 0);
});

test('target profile v1 migrates to sprite shadow profile v2 without discarding extensions', () => {
  const legacy = schema.defaultTargetProfile();
  legacy.schemaVersion = 1;
  legacy.video.messagePlane = 'WINDOW';
  legacy.window = { ...legacy.window, renderer: 'opaque-window', opaque: true, futureWindow: { retained: true } };
  legacy.futureRoot = { retained: true };
  const migrated = schema.migrateTargetProfile(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.video.messagePlane, 'SPRITE');
  assert.equal(migrated.window.renderer, 'shadow-highlight-sprite-2x2');
  assert.equal(Object.hasOwn(migrated.window, 'opaque'), false);
  assert.deepEqual(migrated.window.futureWindow, { retained: true });
  assert.deepEqual(migrated.futureRoot, { retained: true });
  assert.deepEqual(service.validateProfile(migrated), []);

  const future = { ...migrated, schemaVersion: 99, futureSchema: { retained: true } };
  assert.deepEqual(schema.migrateTargetProfile(future), future);
  assert.equal(service.validateProfile(future).some((entry) => entry.code === 'profile-version'), true);
});

test('shadow-safe sprite conversion never emits hardware H/S operator indices', () => {
  const palette = Array.from({ length: 16 }, (_, index) => [
    (index * 37) & 0xff,
    (index * 73) & 0xff,
    (index * 109) & 0xff,
    index === 0 ? 0 : 255,
  ]);
  const entry = {
    asset: { id: 'portrait', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 16, frameHeight: 16 } } },
    buffer: solidPng(16, 16, palette),
  };
  const pal012 = convert.convertVisualGroup([entry], { paletteProfile: 'shadow-safe-pal012', reserveTransparent: true }).get('portrait');
  const pal3 = convert.convertVisualGroup([entry], { paletteProfile: 'shadow-safe-pal3', reserveTransparent: true }).get('portrait');
  assert.equal(pal012.metadata.paletteProfile, 'shadow-safe-pal012');
  assert.deepEqual(pal012.palette[1], [255, 255, 255, 255]);
  assert.equal(pal3.metadata.paletteProfile, 'shadow-safe-pal3');
  assert.equal(image.decodePng(pal012.png).sourceIndices.includes(14), false);
  assert.equal(image.decodePng(pal3.png).sourceIndices.includes(14), false);
  assert.equal(image.decodePng(pal3.png).sourceIndices.includes(15), false);
});

test('weighted palette splitting never emits empty black boxes for a dominant edge color', () => {
  const colors = [
    [36, 36, 73, 255],
    [73, 182, 36, 255],
    [0, 36, 36, 255],
    [255, 255, 219, 255],
    [73, 146, 36, 255],
    [36, 109, 36, 255],
    [36, 109, 0, 255],
    [219, 219, 182, 255],
    [109, 109, 73, 255],
    [182, 182, 182, 255],
    [146, 146, 109, 255],
    [73, 73, 73, 255],
    [219, 146, 109, 255],
    [109, 219, 73, 255],
  ];
  const palette = [[255, 0, 255, 0], ...colors];
  const indices = new Uint8Array(256 * 64);
  indices.fill(1);
  let cursor = 12000;
  for (let paletteIndex = 2; paletteIndex < palette.length; paletteIndex += 1) {
    for (let count = 0; count < 100; count += 1) indices[cursor++] = paletteIndex;
  }
  while (cursor < indices.length) indices[cursor++] = 0;
  const entry = {
    asset: { id: 'dominant', type: 'sprite', options: { transparentIndex: 0, spriteEditor: { frameWidth: 8, frameHeight: 8 } } },
    buffer: image.encodeIndexedPng(256, 64, indices, palette),
  };
  const converted = convert.convertVisualGroup([entry], { paletteProfile: 'shadow-safe-pal3', reserveTransparent: true }).get('dominant');
  const dynamic = converted.palette.slice(1, 14);
  assert.equal(dynamic.filter((color) => color.slice(0, 3).some(Boolean)).length, 13);
  assert.equal(converted.metadata.quality.p95DeltaE < 20, true);
});

test('PCE HQ candidate probing supports four formats and deterministic name ranking', () => {
  assert.deepEqual(pceImport.probeImageDimensions(solidPng(13, 17, [[0, 0, 0, 255]]), '.png'), { width: 13, height: 17 });
  assert.deepEqual(pceImport.probeImageDimensions(minimalJpegHeader(321, 199), '.jpg'), { width: 321, height: 199 });
  assert.deepEqual(pceImport.probeImageDimensions(minimalBmpHeader(640, 384), '.bmp'), { width: 640, height: 384 });
  assert.deepEqual(pceImport.probeImageDimensions(minimalWebpHeader(800, 480), '.webp'), { width: 800, height: 480 });
  const bmp = pceImport.decodeImageBuffer(twoPixelBmp(), '.bmp');
  assert.deepEqual({ width: bmp.width, height: bmp.height }, { width: 2, height: 1 });
  assert.deepEqual([...bmp.rgba], [255, 0, 0, 255, 0, 255, 0, 255]);
  for (const extension of ['.jpg', '.jpeg', '.webp']) {
    let called = '';
    const decoded = pceImport.decodeImageBuffer(Buffer.from([1]), extension, {
      decodeExternal: (_buffer, ext) => { called = ext; return { width: 1, height: 1, rgba: Uint8Array.from([1, 2, 3, 255]) }; },
    });
    assert.equal(called, extension);
    assert.deepEqual([...decoded.rgba], [1, 2, 3, 255]);
  }
  const asset = { id: 'bg_hallway.day', source: 'assets/images/BG_HALLWAY_DAY.png' };
  const exact = pceImport.candidateNameScore('source/art/bg-hallway_day.png', asset);
  const contained = pceImport.candidateNameScore('source/art/final_bg_hallway_day_master.png', asset);
  const preview = pceImport.candidateNameScore('source/preview/bg-hallway_day.png', asset);
  assert.equal(pceImport.normalizeCandidateName('ＢＧ．Hallway-day.png'), 'bg_hallway_day');
  assert.equal(exact > contained, true);
  assert.equal(preview < exact, true);
});

test('cover crop honors all anchor axes and emits the exact MD dimensions', () => {
  for (const anchor of ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']) {
    const output = image.resizeRgbaCover({
      width: 4,
      height: 2,
      rgba: Uint8Array.from([
        10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
        50, 0, 0, 255, 60, 0, 0, 255, 70, 0, 0, 255, 80, 0, 0, 255,
      ]),
    }, 2, 2, anchor);
    assert.equal(output.width, 2);
    assert.equal(output.height, 2);
    assert.equal(output.rgba.length, 16);
  }
  const left = image.resizeRgbaCover({ width: 4, height: 2, rgba: Uint8Array.from([
    10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
    50, 0, 0, 255, 60, 0, 0, 255, 70, 0, 0, 255, 80, 0, 0, 255,
  ]) }, 2, 2, 'left');
  const right = image.resizeRgbaCover({ width: 4, height: 2, rgba: Uint8Array.from([
    10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
    50, 0, 0, 255, 60, 0, 0, 255, 70, 0, 0, 255, 80, 0, 0, 255,
  ]) }, 2, 2, 'right');
  assert.equal(left.rgba[0] < right.rgba[0], true);
});

test('message hardware budget uses 377 tiles and one 16px sprite per glyph', () => {
  const message = { type: 'message', speaker: 'A'.repeat(8), text: 'A'.repeat(50) };
  const plain = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [message] }] }, { assets: {} });
  assert.equal(plain.messageVramTiles, 377);
  assert.equal(plain.maxMessagePieces, 59);
  assert.equal(plain.maxRevealFrames, 4);
  const afterAdvance = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', fullScreenBg: true, commands: [
    message,
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL1', x: 0, y: 128, visible: true },
  ] }] }, { assets: { actor: { metadata: { frameWidth: 64, frameHeight: 64, maxNumTile: 8, maxNumSprite: 2, paletteIndicesUsed: [1] } } } });
  assert.equal(afterAdvance.maxScanlinePixels, 304);
  assert.deepEqual(plain.messageSeparateTop, []);

  const actor = { metadata: { frameWidth: 32, frameHeight: 31, maxNumTile: 4, maxNumSprite: 1, paletteIndicesUsed: [1] } };
  const adaptive = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL1', x: 0, y: 121, visible: true },
    message,
  ] }] }, { assets: { actor } });
  assert.deepEqual(adaptive.messageSeparateTop, []);
  assert.equal(adaptive.maxMessagePieces, 59);
  assert.equal(adaptive.maxSpritePieces, 60);
  assert.equal(adaptive.maxScanlinePixels, 304);
  assert.equal(adaptive.diagnostics.length, 0);

  const tooMany = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [{
    type: 'message', speaker: 'A'.repeat(16), text: 'A'.repeat(75),
  }] }] }, { assets: {} });
  assert.equal(tooMany.maxMessagePieces, 92);
  assert.equal(tooMany.diagnostics.some((entry) => entry.code === 'sprite-piece-budget'), true);
});

test('choice layout lowers only when the shifted rows reduce scanline overflow', () => {
  const actorCommands = Array.from({ length: 3 }, (_, slot) => ({
    type: 'sprite', slot, assetId: `actor${slot}`, x: slot * 64, y: 16, visible: true,
  }));
  const choice = {
    type: 'choice',
    choices: Array.from({ length: 4 }, (_, index) => ({ label: String(index).repeat(17) })),
  };
  const bindings = { assets: Object.fromEntries(Array.from({ length: 3 }, (_, slot) => [`actor${slot}`, {
    metadata: { frameWidth: 64, frameHeight: 128, maxNumTile: 64, maxNumSprite: 8 },
  }])) };
  const adaptive = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [...actorCommands, choice] }] }, bindings);
  assert.deepEqual(adaptive.choiceLowered, ['0:3']);
  assert.equal(adaptive.maxScanlinePixels, 280);
  assert.equal(adaptive.diagnostics.some((entry) => entry.code === 'sprite-scanline-pixels'), false);

  const tallBindings = { assets: Object.fromEntries(Object.entries(bindings.assets).map(([id, binding]) => [id, {
    ...binding, metadata: { ...binding.metadata, frameHeight: 176 },
  }])) };
  const unsafe = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [...actorCommands, choice] }] }, tallBindings);
  assert.deepEqual(unsafe.choiceLowered, []);
  assert.equal(unsafe.maxScanlinePixels, 472);
  assert.equal(unsafe.diagnostics.some((entry) => entry.code === 'sprite-scanline-pixels'), true);
});

test('preflight rejects shadow operator palette indices and lower-band SpriteText', () => {
  const message = { type: 'message', text: 'safe' };
  const actorBudget = (palette, paletteIndicesUsed, extraCommands = []) => codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'sprite', slot: 0, assetId: 'actor', palette, x: 0, y: 120, visible: true },
    ...extraCommands,
    message,
  ] }] }, { assets: { actor: { metadata: { frameWidth: 16, frameHeight: 32, maxNumTile: 4, maxNumSprite: 1, paletteIndicesUsed } } } });
  assert.equal(actorBudget('PAL0', [14]).diagnostics.some((entry) => entry.code === 'shadow-operator-palette-index'), true);
  assert.equal(actorBudget('PAL3', [15]).diagnostics.some((entry) => entry.code === 'shadow-operator-palette-index'), true);
  assert.equal(actorBudget('PAL3', [13]).diagnostics.some((entry) => entry.code === 'shadow-operator-palette-index'), false);

  const moving = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL1', x: 0, y: 0, visible: true },
    { type: 'spritemove', slot: 0, x: 0, y: 140, frames: 10, async: true },
    message,
  ] }] }, { assets: { actor: { metadata: { frameWidth: 16, frameHeight: 16, maxNumTile: 4, maxNumSprite: 1, paletteIndicesUsed: [14] } } } });
  assert.equal(moving.diagnostics.some((entry) => entry.code === 'shadow-operator-palette-index'), true);

  const lowerText = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'spritetext', slot: 0, text: 'PRESS', x: 0, y: 127, visible: true },
    message,
  ] }] }, { assets: {} });
  assert.equal(lowerText.diagnostics.some((entry) => entry.code === 'spritetext-shadow-overlap'), true);
  const upperText = codegen.visibleBudget({ startScene: 's', scenes: [{ id: 's', commands: [
    { type: 'spritetext', slot: 0, text: 'PRESS', x: 0, y: 112, visible: true },
    message,
  ] }] }, { assets: {} });
  assert.equal(upperText.diagnostics.some((entry) => entry.code === 'spritetext-shadow-overlap'), false);
});

test('runtime guards the y=128 H interrupt and uses low-priority index 14 message sprites', () => {
  const root = path.join(__dirname, '..', 'plugins', 'md-novel-builder');
  const runtime = fs.readFileSync(path.join(root, 'template', 'src', 'novel_runtime', 'novel_runtime.c'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'template', 'inc', 'novel_runtime', 'novel_runtime.h'), 'utf8');
  const res = codegen.generateResFile({ backgrounds: [], sprites: [], bgm: [], sfx: [] });
  assert.match(runtime, /#define NOVEL_MESSAGE_SPRITES\s+80/);
  assert.match(runtime, /#define NOVEL_MESSAGE_VRAM_TILES\s+377/);
  assert.match(header, /u16 overlayVramTiles;[\s\S]*?bool fullScreen;/);
  assert.match(runtime, /runtimeProject->scenes\[currentScene\]\.overlayVramTiles/);
  assert.match(runtime, /SYS_setVIntCallback\(novelVInt\)/);
  assert.match(runtime, /static HINTERRUPT_CALLBACK novelHInt\(void\)/);
  assert.match(runtime, /SYS_setHIntCallback\(novelHInt\)/);
  assert.match(runtime, /VDP_setHIntCounter\(1\)/);
  assert.match(runtime, /shadowHIntCount\+\+;[\s\S]*?shadowHIntCount >= 64/);
  assert.match(runtime, /VDP_setHilightShadow\(shadowHIntCount >= 64\)/);
  assert.match(runtime, /SPR_FLAG_INSERT_HEAD \| SPR_FLAG_AUTO_VISIBILITY/);
  assert.match(runtime, /if \(actorSprites\[slot\] != NULL\)\s*\{\s*SPR_releaseSprite\(actorSprites\[slot\]\);\s*actorSprites\[slot\] = NULL;\s*\}/);
  assert.match(runtime, /const u8 capacity = NOVEL_MESSAGE_SPRITES - actorSpriteObjectCount\(\);\s*if \(messageSpriteActive >= capacity\) return;/);
  assert.match(runtime, /reserveActorSpriteObject\(\);\s*actorSprites\[slot\] = SPR_addSpriteEx/);
  assert.match(runtime, /static OverlayTile \*overlayTiles;/);
  assert.match(runtime, /overlayTiles = MEM_alloc\(sizeof\(OverlayTile\) \* NOVEL_OVERLAY_MAX_TILES\)/);
  assert.match(runtime, /MEM_free\(overlayTiles\);\s*overlayTiles = NULL;/);
  assert.match(runtime, /SPR_update\(\);\s*SPR_end\(\);\s*XGM2_stop\(\);/);
  const messageEmitter = runtime.slice(runtime.indexOf('static void emitMessageSprite'), runtime.indexOf('static void finishMessageSprites'));
  assert.doesNotMatch(messageEmitter, /SPR_FLAG_AUTO_VRAM_ALLOC/);
  assert.match(runtime, /SPR_setAlwaysOnTop\(sprite\)/);
  assert.match(runtime, /#define NOVEL_MESSAGE_COLOR_INDEX\s+14/);
  assert.doesNotMatch(runtime, /NOVEL_MESSAGE_MASK_INDEX/);
  assert.match(runtime, /for \(index = 0; index < tiles \* 32; index\+\+\) target\[index\] = 0/);
  assert.match(runtime, /setPackedPixel\([^;]+NOVEL_MESSAGE_COLOR_INDEX\);/);
  assert.match(runtime, /return \(backgroundPalette == PAL1\) \? PAL2 : PAL1;/);
  assert.match(messageEmitter, /TILE_ATTR_FULL\(messagePalette, FALSE,/);
  assert.match(runtime, /emitMessageSprite\(&nov_msg_16x16, x \+ glyph \* 16, y, tile\)/);
  assert.match(runtime, /emitMessageSprite\(&nov_msg_8x8, 304,/);
  assert.match(runtime, /emitMessageSprite\(&nov_msg_8x8, 8, topY \+ choiceIndex \* 16 \+ 4,/);
  assert.match(messageEmitter, /SPR_setPalette\(sprite, messagePalette\)/);
  assert.match(runtime, /SPR_setPriority\(sprite, FALSE\)/);
  assert.match(runtime, /messagePaletteOriginalColor = currentPalette\[index\];/);
  assert.match(runtime, /currentPalette\[index\] = messagePaletteOriginalColor;[\s\S]*?PAL_setColors\(index, &currentPalette\[index\], 1, DMA_QUEUE_COPY\);/);
  assert.match(runtime, /messageDownTile\[8\][^\r\n]+0x0EEEEEE0/);
  const spriteTextRenderer = runtime.slice(runtime.indexOf('static void renderSpriteTexts'), runtime.indexOf('static void clearSpriteTexts'));
  assert.match(spriteTextRenderer, /TILE_ATTR_FULL\(PAL0, FALSE, FALSE, FALSE, 0\), previousOverlayCells/);
  assert.match(spriteTextRenderer, /TILE_ATTR_FULL\(PAL0, TRUE, FALSE, FALSE, tileIndex\), cell/);
  assert.match(runtime, /messagePrepareStage == 2[\s\S]*?queueBottomRow\(\);[\s\S]*?queueCursorTile\(1\);[\s\S]*?else[\s\S]*?renderMessageSprites\(\);/);
  assert.match(runtime, /messageCursorKind = 0;[\s\S]*?hideMessageSprites\(\);[\s\S]*?activeMessage = NULL;/);
  assert.match(runtime, /setAllColorsSafe\(effectPalette\)/);
  assert.match(runtime, /setHorizontalScrollSafe\(offset, -offset\)/);
  assert.match(runtime, /VDP_loadTileData\([^;]+DMA_QUEUE_COPY\)/);
  assert.match(runtime, /PAL_setPalette\(palette, colors, DMA_QUEUE_COPY\)/);
  assert.match(runtime, /PAL_setColors\(index, &currentPalette\[index\], 1, DMA_QUEUE_COPY\)/);
  assert.match(runtime, /PAL_setColors\(0, colors, 64, DMA_QUEUE_COPY\)/);
  const disarm = runtime.slice(runtime.indexOf('static void disarmMessageShadow'), runtime.indexOf('static void armMessageShadow'));
  assert.match(disarm, /SYS_disableInts\(\);[\s\S]*?VDP_setHInterrupt\(FALSE\);[\s\S]*?SYS_setHIntCallback\(NULL\);[\s\S]*?SYS_setVIntCallback\(NULL\);[\s\S]*?VDP_setHilightShadow\(FALSE\);[\s\S]*?SYS_enableInts\(\);/);
  const arm = runtime.slice(runtime.indexOf('static void armMessageShadow'), runtime.indexOf('static void hideWindow'));
  assert.match(arm, /SYS_disableInts\(\);[\s\S]*?shadowFrameReady = FALSE;[\s\S]*?VDP_setHInterrupt\(FALSE\);[\s\S]*?SYS_setHIntCallback\(novelHInt\);[\s\S]*?SYS_setVIntCallback\(novelVInt\);[\s\S]*?VDP_setHIntCounter\(1\);[\s\S]*?VDP_setVInterrupt\(TRUE\);[\s\S]*?VDP_setHInterrupt\(TRUE\);[\s\S]*?SYS_enableInts\(\);/);
  const vInt = runtime.slice(runtime.indexOf('static void novelVInt'), runtime.indexOf('static s16 effectiveX'));
  assert.match(vInt, /shadowHIntCount = 0;[\s\S]*?VDP_setHilightShadow\(FALSE\);[\s\S]*?shadowFrameReady = TRUE;/);
  const backgroundLoader = runtime.slice(runtime.indexOf('static void loadBackground'), runtime.indexOf('static void setActor'));
  assert.match(backgroundLoader, /hideWindow\(\);[\s\S]*?VDP_clearPlane\(BG_B, TRUE\);[\s\S]*?VDP_drawImageEx\(BG_B,/);
  const init = runtime.slice(runtime.indexOf('void novelInit'), runtime.indexOf('void novelUpdate'));
  assert.match(init, /VDP_setHInterrupt\(FALSE\);[\s\S]*?SYS_setVIntCallback\(NULL\);[\s\S]*?SYS_setHIntCallback\(NULL\);/);
  assert.doesNotMatch(runtime, /VDP_setTextPlane\(WINDOW\)/);
  assert.match(header, /NOV_MSG_SEPARATE_TOP\s+0x01/);
  assert.match(header, /NOV_CHOICE_LOWERED\s+0x01/);
  assert.match(header, /u8 layoutFlags;[\s\S]*?s16 variableIndex;/);
  assert.match(runtime, /choiceTopY\(void\)[\s\S]*?activeChoice->layoutFlags & NOV_CHOICE_LOWERED/);
  assert.match(runtime, /emitGlyphRow\(messageRowLengths\[0\], 40, topY,/);
  assert.match(runtime, /topY \+ choiceIndex \* 16 \+ 4/);
  assert.doesNotMatch(res, /SPRITE nov_msg_(?:32x16|16x32|32x32)/);
  assert.match(res, /SPRITE nov_msg_16x16/);
  assert.match(res, /SPRITE nov_msg_8x8/);
});
