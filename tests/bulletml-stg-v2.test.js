'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..');
const showcaseRoot = path.join(repoRoot, 'template', 'template_bulletml_stg');
const editorRoot = path.join(repoRoot, 'plugins', 'bulletml-stg-editor');
const service = require(path.join(editorRoot, 'bulletml-service'));
const host = require(path.join(editorRoot, 'stg-schema-v2'));
const runtimeCore = require(path.join(editorRoot, 'stg-runtime-core'));
const tmx = require(path.join(repoRoot, 'plugins', 'shared', 'tilemap', 'tmx-parser-core'));
const builder = require(path.join(repoRoot, 'plugins', 'bulletml-stg-builder'));

function copyShowcase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-v2-'));
  fs.cpSync(showcaseRoot, root, { recursive: true });
  return root;
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test('schema v1 is rejected with an explicit non-migration error', () => {
  const root = copyShowcase();
  try {
    const target = path.join(root, 'data', 'bulletml', 'project.json');
    const project = JSON.parse(fs.readFileSync(target, 'utf8'));
    project.schemaVersion = 1;
    fs.writeFileSync(target, `${JSON.stringify(project, null, 2)}\n`);
    const loaded = service.loadProject(root);
    assert.equal(loaded.ok, false);
    assert.match(loaded.error, /schema v1は2\.0で非対応/);
    assert.match(loaded.error, /v2 Showcaseを新規作成/);
  } finally { cleanup(root); }
});

test('v2 collection CRUD checks revisions and restores the same stable runtime ID from .deleted', () => {
  const root = copyShowcase();
  try {
    const initial = service.readSnapshot(root);
    const weapon = initial.collections.weapons.entries[0];
    const runtimeId = initial.runtimeIds.catalogs.weapons[weapon.id];
    assert.ok(runtimeId >= 1 && runtimeId <= 255);

    const removed = service.deleteDocumentEntry(root, { kind: 'weapons', id: weapon.id, baseRevision: initial.revisions.weapons });
    assert.equal(removed.ok, true, removed.error);
    assert.match(removed.backup, /data\/bulletml\/\.deleted\/weapons\/.+\.json$/);
    assert.equal(removed.snapshot.runtimeIds.catalogs.weapons[weapon.id], undefined);
    assert.equal(removed.snapshot.runtimeIds.retired.weapons[weapon.id], runtimeId);

    const stale = service.restoreDocumentEntry(root, { kind: 'weapons', fileName: path.basename(removed.backup), baseRevision: initial.revisions.weapons });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);

    const restored = service.restoreDocumentEntry(root, { kind: 'weapons', fileName: path.basename(removed.backup), baseRevision: removed.snapshot.revisions.weapons });
    assert.equal(restored.ok, true, restored.error);
    assert.equal(restored.entry.id, weapon.id);
    assert.equal(restored.snapshot.runtimeIds.catalogs.weapons[weapon.id], runtimeId);
    assert.equal(restored.snapshot.runtimeIds.retired.weapons[weapon.id], undefined);
    assert.equal(fs.existsSync(path.join(root, removed.backup)), false);
  } finally { cleanup(root); }
});

test('Stage CRUD uses revision guards, .deleted recovery, and stable runtime IDs', () => {
  const root = copyShowcase();
  try {
    const initial = service.readSnapshot(root);
    const stage = initial.stages.find((entry) => entry.id === 'caravan-abyss');
    const runtimeId = initial.runtimeIds.catalogs.stages[stage.id];
    const removed = service.deleteStage(root, { id: stage.id, baseRevision: initial.revisions.stages[stage.id] });
    assert.equal(removed.ok, true, removed.error);
    assert.match(removed.backup, /data\/bulletml\/stages\/\.deleted\/.+\.json$/);
    assert.equal(removed.snapshot.stages.some((entry) => entry.id === stage.id), false);
    assert.equal(removed.snapshot.deletedStages[0].stage.id, stage.id);
    assert.equal(removed.snapshot.runtimeIds.catalogs.stages[stage.id], undefined);
    assert.equal(removed.snapshot.runtimeIds.retired.stages[stage.id], runtimeId);

    const restored = service.restoreStage(root, { fileName: path.basename(removed.backup) });
    assert.equal(restored.ok, true, restored.error);
    assert.equal(restored.stage.id, stage.id);
    assert.equal(restored.snapshot.runtimeIds.catalogs.stages[stage.id], runtimeId);
    assert.equal(restored.snapshot.runtimeIds.retired.stages[stage.id], undefined);
    assert.equal(restored.snapshot.deletedStages.length, 0);
  } finally { cleanup(root); }
});

test('v2 document save rejects missing and type-mismatched ResComp symbols before writing', () => {
  const root = copyShowcase();
  try {
    const initial = service.readSnapshot(root);
    const missing = host.clone(initial.collections.weapons);
    missing.entries[0].sprite = { symbol: 'missing_weapon_sprite', type: 'SPRITE', animationRow: 0 };
    const missingResult = service.saveDocument(root, { kind: 'weapons', document: missing, baseRevision: initial.revisions.weapons });
    assert.equal(missingResult.ok, false);
    assert.match(missingResult.error, /ResComp assetがありません/);

    const mismatch = host.clone(initial.collections.weapons);
    mismatch.entries[0].sprite = { symbol: 'player_ship', type: 'WAV', animationRow: 0 };
    const mismatchResult = service.saveDocument(root, { kind: 'weapons', document: mismatch, baseRevision: initial.revisions.weapons });
    assert.equal(mismatchResult.ok, false);
    assert.match(mismatchResult.error, /asset型が違います/);
    assert.equal(service.readSnapshot(root).revisions.weapons, initial.revisions.weapons);

    const diagnostics = [];
    host.validateAssetReference({ symbol: 'bml_player', type: 'SPRITE', path: 'res/gfx/player.png' }, 'test.asset', diagnostics, 'SPRITE');
    assert.ok(diagnostics.some((entry) => entry.code === 'STG_ASSET_PHYSICAL_REF'));
  } finally { cleanup(root); }
});

test('rescomp-asset-picker reloads definitions and diagnoses missing, type mismatch, and duplicate symbols', async () => {
  const pickerModule = await import(pathToFileURL(path.join(repoRoot, 'plugins', 'asset-manager', 'rescomp-asset-picker.mjs')).href);
  const definitions = {
    ok: true,
    files: [{ file: 'resources.res', entries: [
      { name: 'ship', type: 'SPRITE', sourcePath: 'gfx/ship.png' },
      { name: 'stage_bgm', type: 'XGM2', sourcePath: 'music/stage.vgm' },
      { name: 'near_map', type: 'MAP', sourcePath: 'maps/stage.tmx' },
    ] }],
  };
  let reloads = 0;
  let reads = 0;
  const picker = pickerModule.createRescompAssetPicker({
    plugin: { id: 'asset-manager' },
    logger: { warn() {} },
    api: {
      assets: { async reloadResources() { reloads += 1; } },
      electronAPI: { async listResDefinitions() { reads += 1; return definitions; } },
    },
  });
  const sprites = await picker.list({ types: ['SPRITE'] });
  assert.deepEqual(sprites.assets.map((asset) => asset.symbol), ['ship']);
  assert.equal((await picker.resolve({ symbol: 'ship', type: 'SPRITE' })).ok, true);
  assert.equal(reloads, 2);
  assert.equal(reads, 2);

  const entries = pickerModule.flattenResDefinitions({ files: [
    { file: 'a.res', entries: [{ name: 'dup', type: 'IMAGE' }] },
    { file: 'b.res', entries: [{ name: 'dup', type: 'SPRITE' }, { name: 'music', type: 'XGM2' }] },
  ] });
  assert.equal(pickerModule.resolveAsset(entries, { symbol: 'none', type: 'SPRITE' }).code, 'ASSET_MISSING');
  assert.equal(pickerModule.resolveAsset(entries, { symbol: 'music', type: 'WAV' }).code, 'ASSET_TYPE_MISMATCH');
  assert.equal(pickerModule.resolveAsset(entries, { symbol: 'dup' }).code, 'ASSET_DUPLICATE');
  assert.deepEqual(pickerModule.duplicateSymbolDiagnostics(entries).map((entry) => entry.symbol), ['dup']);
  assert.deepEqual(
    pickerModule.spriteAnimationPlan({ width: '16p', height: '16p', time: '[[3,4][5,0]]' }, 32, 32, 1),
    { frameWidth: 16, frameHeight: 16, columns: 2, rows: 2, row: 1, frameCount: 2, durations: [5, 0] },
  );

  const spriteRenderer = fs.readFileSync(path.join(repoRoot, 'plugins', 'sprite-editor', 'renderer.js'), 'utf8');
  const mapRenderer = fs.readFileSync(path.join(repoRoot, 'plugins', 'tilemap-editor', 'renderer.js'), 'utf8');
  assert.match(spriteRenderer, /registerCapability\('sprite-editor',[\s\S]*openSprite/);
  assert.match(spriteRenderer, /async function openSprite\(\{ symbol \}/);
  assert.match(mapRenderer, /registerCapability\('tilemap-editor',[\s\S]*openMap/);
  assert.match(mapRenderer, /async function openMap\(\{ symbol, collisionLayer = '' \}/);
});

test('Japanese structured GUI edits nested values and arrays without requiring JSON', async () => {
  const structured = await import(pathToFileURL(path.join(repoRoot, 'plugins', 'shared', 'structured-form.mjs')).href);
  const localization = await import(pathToFileURL(path.join(editorRoot, 'ui-localization.mjs')).href);
  const data = {
    id: 'enemy-1',
    name: '敵1',
    hp: 10,
    drop: { itemId: '', chance: 0.5 },
    waypoints: [{ x: 0, y: 0, durationFrames: 30, interpolation: 'linear' }],
  };
  const html = structured.renderStructuredForm(data, {
    scope: 'test',
    resolveMeta: (fieldPath, value, key) => localization.stgFieldMeta(['enemies', ...fieldPath], value, key, {
      snapshot: { collections: { items: { entries: [{ id: 'score', name: 'Score' }] } } },
    }),
  });
  assert.match(html, /表示名/);
  assert.match(html, /耐久力/);
  assert.match(html, /落下確率/);
  assert.match(html, /structured-help/);
  assert.match(html, /data-structured-action="add"/);
  assert.doesNotMatch(html, />drop\.itemId</);

  structured.applyStructuredField(data, {
    value: '25',
    dataset: { structuredField: structured.encodeStructuredPath(['hp']) },
  });
  assert.equal(data.hp, 25);
  const add = {
    dataset: {
      structuredAction: 'add',
      structuredPath: structured.encodeStructuredPath(['waypoints']),
    },
  };
  assert.equal(structured.applyStructuredArrayAction(data, add, localization.stgArrayTemplate), true);
  assert.equal(data.waypoints.length, 2);
  assert.equal(data.waypoints[1].interpolation, 'linear');

  data.drop = null;
  const optionalHtml = structured.renderStructuredForm(data, {
    scope: 'test',
    resolveMeta: (fieldPath, value, key) => localization.stgFieldMeta(['enemies', ...fieldPath], value, key),
  });
  assert.match(optionalHtml, /data-structured-action="enable"/);
  const enable = { dataset: { structuredAction: 'enable', structuredPath: structured.encodeStructuredPath(['drop']) } };
  assert.equal(structured.applyStructuredArrayAction(data, enable, localization.stgArrayTemplate), true);
  assert.deepEqual(data.drop, { itemId: '', chance: 1 });
  const clear = { dataset: { structuredAction: 'clear', structuredPath: structured.encodeStructuredPath(['drop']) } };
  assert.equal(structured.applyStructuredArrayAction(data, clear, localization.stgArrayTemplate), true);
  assert.equal(data.drop, null);
});

test('BulletML UI is Japanese, keeps JSON advanced-only, and previews assets automatically', async () => {
  const ui = await import(pathToFileURL(path.join(editorRoot, 'editor-ui.mjs')).href);
  const html = ui.buildShell();
  for (const label of ['作品設定', 'プレイヤー', '武器', 'アイテム', '演出', '移動', '敵', 'ボス', '背景・衝突', 'ステージ', 'デモ', '弾幕', '診断']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /上級者向け：内部JSON/);
  assert.match(html, /data-role="stage-form"/);
  assert.match(html, /data-role="stage-settings-form"/);
  assert.match(html, /data-role="pattern-settings-form"/);
  assert.match(html, /data-action="new-stage"/);
  assert.match(html, /data-action="delete-stage"/);
  assert.match(html, /data-role="stage-deleted-list"/);
  assert.match(html, /data-role="command-form"/);
  assert.match(html, /title="[^"]+"/);

  const editorSource = fs.readFileSync(path.join(editorRoot, 'v2-document-editor.mjs'), 'utf8');
  assert.doesNotMatch(editorSource, /data-v2-asset-action="preview"/);
  assert.match(editorSource, /mountAutomaticPreview/);
  assert.match(editorSource, /data-v2-asset-card/);
  assert.match(editorSource, /renderStructuredForm/);

  const vnSource = fs.readFileSync(path.join(repoRoot, 'plugins', 'shared', 'md-vn', 'editor-component.mjs'), 'utf8');
  assert.doesNotMatch(vnSource, /Commands JSON/);
  assert.match(vnSource, /シーン命令/);
  assert.match(vnSource, /VN_COMMAND_TEMPLATES/);
  assert.match(vnSource, /renderStructuredForm/);

  const rendererSource = fs.readFileSync(path.join(editorRoot, 'renderer-app.mjs'), 'utf8');
  assert.match(rendererSource, /scope: 'pattern-command'/);
  assert.match(rendererSource, /scope: 'pattern-settings'/);
  assert.match(rendererSource, /mountPatternSpritePreview/);
  assert.match(rendererSource, /deleteBulletmlStage/);
  assert.match(rendererSource, /restoreBulletmlStage/);
  assert.match(rendererSource, /patternFieldMeta/);
  assert.match(rendererSource, /applyStructuredField\(next, commandControl\)/);
  assert.match(rendererSource, /applyStructuredArrayAction\(next, button, patternArrayTemplate\)/);
});

test('canonical VN scene save is revision guarded and keeps BulletML bindings separate', () => {
  const root = copyShowcase();
  try {
    const loaded = service.loadProject(root);
    assert.equal(loaded.ok, true, loaded.error);
    assert.equal(loaded.demoEditor.sceneDocument.scenes.length, 11);
    assert.equal(loaded.demoEditor.bindings.canonicalSceneDocument, 'assets/pce-vn-scenes.json');
    assert.deepEqual(loaded.demoEditor.bindings.endingSelector, { flag: 'abyss_choice', rescueWhen: true });
    const endingChoice = loaded.demoEditor.sceneDocument.scenes.find((scene) => scene.id === 'post-3-choice').commands.find((command) => command.type === 'choice');
    assert.deepEqual(endingChoice.choices.map((choice) => choice.targetSceneId), ['', '']);
    const edited = host.clone(loaded.demoEditor.sceneDocument);
    edited.scenes[0].name += ' 検証';
    const saved = service.saveDemo(root, {
      sceneDocument: edited,
      bindings: loaded.demoEditor.bindings,
      baseRevisions: loaded.demoEditor.revisions,
    });
    assert.equal(saved.ok, true, saved.error);
    assert.notEqual(saved.demoEditor.revisions.sceneDocument, loaded.demoEditor.revisions.sceneDocument);
    const stale = service.saveDemo(root, {
      sceneDocument: loaded.demoEditor.sceneDocument,
      bindings: loaded.demoEditor.bindings,
      baseRevisions: loaded.demoEditor.revisions,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
  } finally { cleanup(root); }
});

test('Stage graph, explicit clear event, band overlap, and physical refs are hard validation diagnostics', () => {
  const snapshot = service.readSnapshot(showcaseRoot);
  const cycle = host.clone(snapshot);
  cycle.stages.find((stage) => stage.id === 'stage-3-giant').next = [{ stageId: 'stage-1-vertical', flag: '', equals: true }];
  assert.ok(host.validateSnapshot(cycle, null).diagnostics.some((entry) => entry.code === 'STG_STAGE_GRAPH_CYCLE'));

  const missingClear = host.clone(snapshot);
  const stage = missingClear.stages.find((entry) => entry.id === 'stage-1-vertical');
  stage.events = stage.events.filter((event) => event.action.type !== 'stage_clear');
  assert.ok(host.validateSnapshot(missingClear, null).diagnostics.some((entry) => entry.code === 'STG_STAGE_CLEAR'));

  const overlap = host.clone(snapshot);
  overlap.collections.backgrounds.entries[0].BG_A.bands = [
    { start: 0, end: 120, multiplier: 1 },
    { start: 120, end: 223, multiplier: .5 },
  ];
  assert.ok(host.validateSnapshot(overlap, null).diagnostics.some((entry) => entry.code === 'STG_BACKGROUND_BAND_OVERLAP'));

  const badEnemySe = host.clone(snapshot);
  badEnemySe.collections.enemies.entries[0].se = { symbol: 'bml_sfx_hit', type: 'IMAGE' };
  assert.ok(host.validateSnapshot(badEnemySe, null).diagnostics.some((entry) => entry.code === 'STG_ASSET_TYPE' && entry.path.endsWith('.se.type')));
});

test('shared TMX/TSX parser selects collision layers and round-trips compressed catalogs', () => {
  const mapText = fs.readFileSync(path.join(showcaseRoot, 'res', 'maps', 'stage1.tmx'), 'utf8');
  const tsxText = fs.readFileSync(path.join(showcaseRoot, 'res', 'maps', 'abyss.tsx'), 'utf8');
  const map = tmx.parseTmx(mapText);
  const tileset = tmx.parseTsx(tsxText);
  assert.equal(map.width, 40);
  assert.equal(map.height, 56);
  assert.equal(map.tilesetSource, 'abyss.tsx');
  assert.equal(tileset.imageSource, 'abyss_tiles.png');
  const catalog = tmx.collisionCatalog(mapText, 'Collision:near');
  assert.equal(catalog.layerName, 'Collision:near');
  assert.ok(catalog.rle.length < catalog.values.length);
  assert.deepEqual(tmx.decodeRle(catalog.rle, catalog.values.length), catalog.values);
});

test('Showcase AI source-art audit proves 320x224 indexed RGB333 conversion', () => {
  const root = path.join(showcaseRoot, 'assets', 'source-art');
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'audit.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, audit.source.file));
  const converted = fs.readFileSync(path.join(root, audit.megaDriveReference.file));
  const parsed = builder.parseIndexedPng(converted);
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), audit.source.sha256);
  assert.equal(crypto.createHash('sha256').update(converted).digest('hex'), audit.megaDriveReference.sha256);
  assert.deepEqual({ width: parsed.width, height: parsed.height, bitDepth: parsed.bitDepth, colors: parsed.colors }, { width: 320, height: 224, bitDepth: 8, colors: 16 });
  assert.equal(parsed.paletteFingerprint, audit.megaDriveReference.paletteFingerprint);
  assert.ok(parsed.paletteRgb.flat().every((channel) => channel % 36 === 0));
  assert.equal(parsed.width % 8, 0);
  assert.equal(parsed.height % 8, 0);
});

test('JS runtime parity fixtures cover movement, shot, item, Wave presets, scroll interpolation, and SRAM CRC', () => {
  const movement = { loop: false, waypoints: [
    { x: 0, y: 0, durationFrames: 0, interpolation: 'linear' },
    { x: 100, y: 40, durationFrames: 100, interpolation: 'linear' },
  ] };
  assert.deepEqual(runtimeCore.movementPoint(movement, 25), { x: 25, y: 10 });
  assert.equal(runtimeCore.interpolationRatio('step', .999), 0);
  assert.equal(runtimeCore.interpolationRatio('step', 1), 1);
  assert.equal(runtimeCore.interpolationRatio('smoothstep', .25), .15625);
  assert.deepEqual(runtimeCore.shotVelocity('vertical', 8, 0), { x: 0, y: -8 });
  assert.deepEqual(runtimeCore.shotVelocity('horizontal', 8, 0), { x: 8, y: 0 });
  assert.equal(runtimeCore.cycleSpeed('fast'), 'slow');

  const weapons = new Map([['laser', { duplicateScore: 2500 }]]);
  assert.deepEqual(runtimeCore.applyItem({ weaponId: 'laser', score: 100, bombs: 1 }, { type: 'weapon', weaponId: 'laser' }, weapons, {}), { weaponId: 'laser', score: 2600, bombs: 1 });
  assert.equal(runtimeCore.applyItem({ weaponId: 'laser', score: 0, bombs: 8 }, { type: 'bomb', amount: 3 }, weapons, { maxStock: 9 }).bombs, 9);

  const wave = { start: 0, end: 223, amplitude: 12, wavelength: 48, speed: 1.25, fadeFrames: 120 };
  const words = [];
  for (const preset of ['sine', 'dual-sine', 'ripple', 'shear', 'jitter']) {
    for (const frame of [0, 30, 60, 120, 240]) words.push(runtimeCore.waveOffset({ ...wave, preset }, 96, frame, 0xace1, 0));
  }
  assert.deepEqual(words, [0, 0, 2, 9, 11, 0, 1, 4, 11, 5, 0, 0, 2, 9, 11, 0, 1, 2, 5, 5, 0, 0, -6, -12, -12]);
  assert.equal(runtimeCore.crc32Words(words).toString(16).padStart(8, '0'), '676269a8');
  assert.equal(runtimeCore.crc16Ccitt(Buffer.from('123456789')), 0x29b1);
});

test('Demo and gameplay release their mode-exclusive runtime memory', () => {
  const runtime = fs.readFileSync(path.join(repoRoot, 'plugins', 'bulletml-stg-builder', 'template', 'src', 'bulletml', 'bulletml_runtime.c'), 'utf8');
  const game = fs.readFileSync(path.join(repoRoot, 'plugins', 'bulletml-stg-builder', 'template', 'src', 'bulletml', 'bulletml_game.c'), 'utf8');
  assert.match(runtime, /static BML_Context \*contexts;/);
  assert.match(runtime, /contexts = MEM_alloc\(sizeof\(BML_Context\) \* BML_MAX_CONTEXTS\)/);
  assert.match(runtime, /void BML_shutdown\(void\)[\s\S]*?MEM_free\(contexts\);[\s\S]*?contexts = NULL;/);
  assert.match(game, /static void runDemo\(s16 sceneIndex\)[\s\S]*?BML_shutdown\(\);/);
  assert.match(game, /runDemo\(readFlag\(BML_DEMO_ENDING_FLAG\) == BML_DEMO_ENDING_RESCUE_WHEN \? BML_DEMO_ENDING_RESCUE_SCENE : BML_DEMO_ENDING_DESTROY_SCENE\);/);
  assert.match(game, /XGM2_stop\(\);[\s\S]*?gameplayBgmActive = FALSE;[\s\S]*?BML_shutdown\(\);[\s\S]*?releaseSprites\(\);/);
});

test('enemy despawn is not a kill and destructible backgrounds persist until destroyed', () => {
  const preview = fs.readFileSync(path.join(editorRoot, 'bulletml-stage-preview.js'), 'utf8');
  const game = fs.readFileSync(path.join(repoRoot, 'plugins', 'bulletml-stg-builder', 'template', 'src', 'bulletml', 'bulletml_game.c'), 'utf8');
  const header = fs.readFileSync(path.join(repoRoot, 'plugins', 'bulletml-stg-builder', 'template', 'inc', 'bulletml', 'bulletml_game.h'), 'utf8');
  assert.match(preview, /stopEnemy\(enemy, destroyed = true\)[\s\S]*?if \(destroyed\) \{[\s\S]*?this\.score \+= enemy\.event\.score/);
  assert.match(preview, /!enemy\.definition\?\.destructibleBackground && age >= 660\)[\s\S]*?this\.stopEnemy\(enemy, false\)/);
  assert.match(game, /static void stopEnemy\(HostEnemy \*enemy, bool boss, bool destroyed\)[\s\S]*?if \(destroyed\) \{[\s\S]*?score \+= enemy->event->score/);
  assert.match(game, /!enemy->enemyConfig->destructibleBackground\) && age >= 660\) stopEnemy\(enemy, FALSE, FALSE\)/);
  assert.match(game, /const u8 \*destroySe = [\s\S]*?XGM2_playPCM\(destroySe, destroySeSize, SOUND_PCM_CH2\)/);
  assert.match(game, /spawnExplosion\(explosionId, enemy->x, enemy->y, destroySeSize != 0/);
  assert.match(header, /BML_EnemyConfig;[\s\S]*?typedef struct \{[\s\S]*?BML_BossConfig;/);
  assert.ok((header.match(/const u8 \*se;/g) || []).length >= 3, 'Effect, Enemy, and Boss configs expose SE pointers');
});

test('shared MD VN modules own schema, font, image, preview, and compiler implementations', () => {
  const sharedRoot = path.join(repoRoot, 'plugins', 'shared', 'md-vn');
  for (const file of ['scene-schema.js', 'font.js', 'image.js', 'preview.mjs', 'compiler.js']) {
    const source = fs.readFileSync(path.join(sharedRoot, file), 'utf8');
    assert.ok(source.length > 1000, `${file} must contain the shared implementation`);
    assert.doesNotMatch(source, /require\(['"]\.\.\/\.\.\/md-novel-(?:editor|builder)/);
  }
  assert.strictEqual(require(path.join(repoRoot, 'plugins', 'md-novel-editor', 'novel-schema')), require(path.join(sharedRoot, 'scene-schema')));
  assert.strictEqual(require(path.join(repoRoot, 'plugins', 'md-novel-builder', 'codegen')), require(path.join(sharedRoot, 'compiler')));
});

test('Builder rejects ROMs larger than 4 MiB before release proof can pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-rom-limit-'));
  try {
    const proofDir = path.join(root, 'data', 'bulletml');
    const outDir = path.join(root, 'out');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(path.join(showcaseRoot, 'data', 'bulletml', 'proof.json'), path.join(proofDir, 'proof.json'));
    const romPath = path.join(outDir, 'rom.bin');
    fs.writeFileSync(romPath, Buffer.alloc(4 * 1024 * 1024 + 1));
    const result = builder.onBuildEnd({ projectDir: root, romPath });
    assert.equal(result.ok, false);
    assert.match(result.error, /4 MiB上限/);
  } finally { cleanup(root); }
});
