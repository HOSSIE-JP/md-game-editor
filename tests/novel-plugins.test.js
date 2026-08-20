'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const schema = require('../plugins/md-novel-editor/novel-schema');
const image = require('../plugins/md-novel-editor/novel-image');
const convert = require('../plugins/md-novel-editor/novel-convert');
const service = require('../plugins/md-novel-editor/novel-service');
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

test('import, optimistic save, transaction retention, and raw unknown-field round-trip', async (t) => {
  const source = temporaryDirectory(t, 'md-novel-source-');
  const target = temporaryDirectory(t, 'md-novel-target-');
  const fixture = createSourceFixture(source);
  fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ coreId: 'mega-drive' }, null, 2));
  const imported = await service.importPceProject(target, { sourceProjectDir: source, portraitPaletteGroups: { PAL2: ['mu'], PAL3: [] } });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.sceneDocument, fixture.sceneDocument);
  assert.equal(imported.bindings.audioVariants['song@0'].status, 'ready');
  assert.equal(imported.bindings.audioVariants['sfx@1'].status, 'ready');
  assert.equal(fs.existsSync(path.join(target, 'res', imported.bindings.audioVariants['song@0'].sourcePath)), true);
  const fingerprints = new Set(['sp_mu_a', 'sp_mu_b'].map((id) => imported.bindings.assets[id].paletteFingerprint));
  assert.equal(fingerprints.size, 1);
  const originalTransactionPaths = Object.keys(imported.transaction.documents);

  const edited = structuredClone(imported.sceneDocument);
  edited.scenes[0].commands[5].text = 'edited';
  const saved = await service.saveProject(target, {
    sceneDocument: edited,
    targetProfile: imported.targetProfile,
    bindings: imported.bindings,
    baseRevisions: imported.revisions,
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
    { type: 'message', speaker: 'A', text: 'A'.repeat(76), mouthSlot: 0 },
  ];
  const bindings = structuredClone(imported.bindings);
  bindings.sourceSceneRevision = schema.hashDocument(sceneDocument);
  const generated = codegen.generateProject({
    sceneDocument,
    catalog: imported.catalog,
    targetProfile: imported.targetProfile,
    bindings,
  });
  const c = generated.files['src/generated/novel_data.c'];
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
  assert.equal(generated.report.variables, 4);
  assert.equal(generated.report.switches, 2);
  assert.equal(generated.report.messages, 1);
  assert.match(generated.files['res/novel.res'], /SPRITE nov_spr_/);
});

test('preflight rejects aggregate VRAM and scanline sprite overflow', () => {
  const vram = codegen.visibleBudget({ scenes: [{ commands: [
    { type: 'background', assetId: 'bg' },
    { type: 'message', text: 'x' },
  ] }] }, { assets: { bg: { metadata: { uniqueTiles: 1100 } } } });
  assert.equal(vram.diagnostics.some((entry) => entry.code === 'vram-budget'), true);

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
  assert.equal(carry.maxBudget, 1445);
  assert.equal(carry.diagnostics.some((entry) => entry.code === 'vram-budget'), true);
});

test('preflight reserves disjoint VRAM for simultaneous SpriteText and WINDOW glyphs', () => {
  const budget = codegen.visibleBudget({ startScene: 'overlay', scenes: [{ id: 'overlay', commands: [
    { type: 'spritetext', slot: 0, text: 'A', x: 1, y: 1, visible: true },
    { type: 'spritetext', slot: 1, text: 'B', x: 33, y: 1, visible: true },
    { type: 'message', text: 'x' },
  ] }] }, { assets: {} });
  assert.equal(budget.maxOverlayTiles, 18);
  assert.equal(budget.maxBudget, 399);
  assert.equal(budget.diagnostics.length, 0);
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
  const staging = path.join(target, 'data', 'md-novel', '.staging');
  assert.equal(!fs.existsSync(staging) || fs.readdirSync(staging).length === 0, true);
  assert.equal(logs.some((line) => /sprite VRAM/.test(line)), true);
});
