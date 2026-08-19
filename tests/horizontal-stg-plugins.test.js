'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..');
const editorRoot = path.join(repoRoot, 'plugins', 'horizontal-stg-editor');
const builderRoot = path.join(repoRoot, 'plugins', 'horizontal-stg-builder');
const starterTemplate = path.join(repoRoot, 'template', 'template_horizontal_stg');
const geronekoTemplate = path.join(repoRoot, 'template', 'template_geroneko_abyss_strike');
const schema = require(path.join(editorRoot, 'horizontal-stg-schema'));
const service = require(path.join(editorRoot, 'horizontal-stg-service'));
const editor = require(editorRoot);
const builder = require(builderRoot);

function tempProject(templateDir = starterTemplate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-hstg-'));
  fs.cpSync(templateDir, root, { recursive: true });
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('horizontal STG manifests use Plugin Runtime renderer modules and the exclusive builder role', () => {
  const editorManifest = require(path.join(editorRoot, 'manifest.json'));
  const builderManifest = require(path.join(builderRoot, 'manifest.json'));

  assert.equal(editorManifest.id, 'horizontal-stg-editor');
  assert.equal(editorManifest.renderer.entry, 'renderer.js');
  assert.equal(editorManifest.version, '1.3.0');
  assert.ok(editorManifest.renderer.capabilities.includes('horizontal-stg-editor'));
  for (const dependency of ['image-quantize-converter', 'sprite-editor', 'tilemap-editor', 'md-bgm-composer']) {
    assert.ok(editorManifest.dependencies.includes(dependency), dependency);
  }
  assert.deepEqual(editorManifest.mainApi.hooks, [
    'loadHorizontalStgProject',
    'saveHorizontalStgDocument',
    'deleteHorizontalStgEntity',
    'reorderHorizontalStgStages',
    'validateHorizontalStgProject',
    'exportHorizontalStgData',
  ]);
  assert.equal(builderManifest.id, 'horizontal-stg-builder');
  assert.equal(builderManifest.version, '1.3.0');
  assert.deepEqual(builderManifest.roles, [{ id: 'builder', label: 'ビルド', exclusive: true, order: 10 }]);
  assert.ok(builderManifest.permissions.includes('build.configure'));
});

test('generated horizontal STG build outputs stay out of Git source inputs', () => {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const pattern of [
    '/artifacts/',
    '/plugins/horizontal-stg-builder/template/src/generated/',
    '/plugins/horizontal-stg-builder/template/inc/generated/',
    '/plugins/horizontal-stg-builder/template/res/common.res',
    '/template/template_horizontal_stg/src/',
    '/template/template_geroneko_abyss_strike/src/',
  ]) {
    assert.ok(gitignore.includes(pattern), pattern);
  }
  const builderSource = fs.readFileSync(path.join(builderRoot, 'index.js'), 'utf8');
  assert.doesNotMatch(builderSource, /'generated\/(?:boss_defs|enemy_defs|stage_defs|weapon_defs)\.h'/);
});

test('generic and GERONEKO templates select the horizontal STG builder and standard emulator', () => {
  for (const templateDir of [starterTemplate, geronekoTemplate]) {
    const project = JSON.parse(fs.readFileSync(path.join(templateDir, 'project.json'), 'utf8'));
    assert.equal(project.pluginRoles.builder, 'horizontal-stg-builder');
    assert.equal(project.pluginRoles.testplay, 'standard-emulator');
    assert.ok(project.pluginSettings.sidebarOrder.includes('horizontal-stg-editor'));
  }
});

test('GERONEKO data loads as five ordered stages, twenty enemies, ten bosses, fourteen cues, and 268 events', () => {
  const loaded = service.loadProject(geronekoTemplate);
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(loaded.validation.ok, true, JSON.stringify(loaded.validation.errors));
  assert.deepEqual(loaded.snapshot.project.stage_order, [
    'blue-horizon',
    'drowned-metro',
    'black-lantern',
    'iron-nest',
    'living-ark',
  ]);
  assert.equal(loaded.snapshot.stages.length, 5);
  assert.equal(loaded.snapshot.enemies.length, 20);
  assert.equal(loaded.snapshot.bosses.length, 10);
  assert.equal(loaded.snapshot.audio.length, 14);
  assert.equal(loaded.snapshot.stages.reduce((sum, stage) => sum + stage.events.length, 0), 268);
  assert.equal(loaded.snapshot.stages.reduce((sum, stage) => (
    sum + stage.events.filter((event) => event.command === 'spawn_enemy').length
  ), 0), 242);

  const secondsToFinalBosses = loaded.snapshot.stages.reduce((total, stage) => {
    const finalBossAt = Math.max(...stage.events
      .filter((event) => event.command === 'start_boss' && event.trigger.type === 'scroll')
      .map((event) => event.trigger.at));
    return total + ((finalBossAt * 256) / stage.scroll_speed_256 / 60);
  }, 0);
  assert.equal(Number((secondsToFinalBosses / 60).toFixed(2)), 29.12);
  assert.ok(loaded.snapshot.stages.every((stage) => stage.scroll_speed_256 === 80));

  const finalBoss = loaded.snapshot.bosses.find((boss) => boss.id === 'abyssal-core');
  assert.equal(finalBoss.forms, 2);
  assert.equal(finalBoss.movement, 'orbit');
  assert.equal(finalBoss.fire_pattern, 'core');
  assert.deepEqual(loaded.snapshot.project.rules.extend_scores, [200000, 700000]);
  assert.deepEqual(loaded.snapshot.project.input.remappable, ['A', 'B', 'C']);
});

test('GERONEKO backgrounds use a dense MD tile vocabulary within the gameplay VRAM budget', () => {
  const snapshot = service.readSnapshot(geronekoTemplate);
  for (const stage of snapshot.stages) {
    const bgA = service.inspectIndexedPng(path.join(geronekoTemplate, 'res', stage.assets.bg_a));
    const bgB = service.inspectIndexedPng(path.join(geronekoTemplate, 'res', stage.assets.bg_b));
    assert.equal(bgA.width, stage.length_px, `${stage.id} BG_A width`);
    assert.equal(bgA.height, 224, `${stage.id} BG_A height`);
    assert.equal(bgB.width, 320 + (stage.length_px >> stage.parallax_shift_b), `${stage.id} BG_B width`);
    assert.equal(bgB.height, 224, `${stage.id} BG_B height`);
    for (const image of [bgA, bgB]) {
      assert.equal(image.colorType, 3);
      assert.equal(image.bitDepth, 8);
      assert.equal(image.interlace, 0);
      assert.ok(image.usedPaletteEntries >= 1 && image.usedPaletteEntries <= 16);
    }
    const totalTiles = bgA.totalTileCount + bgB.totalTileCount;
    const detailRatio = (bgA.detailedTileCount + bgB.detailedTileCount) / totalTiles;
    const gameplayPatterns = 18 + bgA.optimizedTilePatterns + bgB.optimizedTilePatterns;
    assert.ok(bgA.uniqueTilePatterns >= 64 && bgA.uniqueTilePatterns <= 700, `${stage.id} rich BG_A tile vocabulary`);
    assert.ok(bgB.uniqueTilePatterns >= 320 && bgB.uniqueTilePatterns <= 700, `${stage.id} rich BG_B tile vocabulary`);
    assert.ok(bgB.uniformFourByFourRatio < 0.45, `${stage.id} is final-resolution art, not 4x nearest blocks`);
    assert.ok(detailRatio >= 0.25, `${stage.id} detailed tile ratio`);
    assert.ok(gameplayPatterns >= 400 && gameplayPatterns <= 1500, `${stage.id} dense background VRAM budget`);
  }
});

test('title ships a one-piece confrontation illustration and line-warped transparent logo', () => {
  const background = service.inspectIndexedPng(path.join(geronekoTemplate, 'res', 'gfx', 'title_background.png'));
  const logo = service.inspectIndexedPng(path.join(geronekoTemplate, 'res', 'gfx', 'title_logo.png'));
  const screensSource = fs.readFileSync(path.join(builderRoot, 'template', 'src', 'render', 'screens.c'), 'utf8');
  const gameSource = fs.readFileSync(path.join(builderRoot, 'template', 'src', 'game', 'game.c'), 'utf8');
  const generated = schema.generateFiles(service.readSnapshot(geronekoTemplate));

  assert.equal(background.width, 320);
  assert.equal(background.height, 224);
  assert.equal(background.colorType, 3);
  assert.equal(background.bitDepth, 8);
  assert.ok(background.usedPaletteEntries <= 16);
  assert.ok(background.uniformFourByFourRatio < 0.55);
  assert.ok(background.detailedTileRatio > 0.3);
  assert.equal(logo.width, 256);
  assert.equal(logo.height, 64);
  assert.equal(logo.hasTransparency, true);
  assert.ok(logo.usedPaletteEntries <= 16);
  // 64x32 planes start maps at 0xC000: 1005 user tiles remain after SGDK font + 420 sprite tiles.
  assert.ok(background.optimizedTilePatterns + logo.optimizedTilePatterns <= 1005);
  assert.ok(generated.files['res/common.res'].includes('IMAGE img_title_background "gfx/title_background.png" NONE ALL 0'));
  assert.ok(generated.files['res/common.res'].includes('IMAGE img_title_logo "gfx/title_logo.png" NONE ALL 0'));
  assert.ok(screensSource.includes('&img_title_background'));
  assert.ok(screensSource.includes('&img_title_logo'));
  assert.ok(screensSource.includes('VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE)'));
  assert.ok(screensSource.includes('VDP_setHorizontalScrollLine(BG_A'));
  assert.ok(screensSource.includes('titleRipple[phaseFast]'));
  assert.ok(gameSource.includes('screensUpdateTitle(stateTimer)'));
});

test('graphical HUD ships eighteen indexed icon and gauge tiles', () => {
  const hudPath = path.join(geronekoTemplate, 'res', 'gfx', 'hud_icons.png');
  const hud = service.inspectIndexedPng(hudPath);
  assert.equal(hud.width, 144);
  assert.equal(hud.height, 8);
  assert.equal(hud.colorType, 3);
  assert.equal(hud.bitDepth, 8);
  assert.ok(hud.usedPaletteEntries <= 16);
  assert.equal(hud.uniqueTilePatterns, 18);
});

test('GERONEKO ships fourteen distinct VGM cues with valid headers', () => {
  const snapshot = service.readSnapshot(geronekoTemplate);
  const hashes = snapshot.audio.map((cue) => {
    const bytes = fs.readFileSync(path.join(geronekoTemplate, 'res', cue.path));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'Vgm ', cue.id);
    assert.ok(bytes.length > 256, cue.id);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(hashes.length, 14);
  assert.equal(new Set(hashes).size, 14);
});

test('generated GERONEKO data covers configuration, text, audio, render data, stages, enemies, bosses, and weapons', () => {
  const generated = schema.generateFiles(service.readSnapshot(geronekoTemplate));
  assert.equal(generated.ok, true, JSON.stringify(generated.errors));
  for (const file of [
    'inc/generated/game_config.h',
    'inc/generated/game_data.h',
    'src/generated/game_data.c',
    'inc/generated/audio_data.h',
    'src/generated/audio_data.c',
    'inc/generated/render_data.h',
    'src/generated/render_data.c',
    'src/generated/stage_defs.c',
    'src/generated/enemy_defs.c',
    'src/generated/boss_defs.c',
    'src/generated/weapon_defs.c',
  ]) {
    assert.ok(Object.hasOwn(generated.files, file), file);
  }
  assert.equal(generated.report.counts.stages, 5);
  assert.equal(generated.report.counts.enemies, 20);
  assert.equal(generated.report.counts.bosses, 10);
  assert.equal(generated.report.counts.audio, 14);
  assert.equal(generated.report.counts.events, 268);
});

test('integrated editor exposes actual asset, tile, audio, pattern, timeline, and preview tools', () => {
  const appSource = fs.readFileSync(path.join(editorRoot, 'renderer-app.mjs'), 'utf8');
  const uiSource = fs.readFileSync(path.join(editorRoot, 'editor-ui.mjs'), 'utf8');
  const hostSource = fs.readFileSync(path.join(repoRoot, 'renderer', 'renderer.js'), 'utf8');

  assert.match(appSource, /readFileAsDataUrl/);
  assert.match(appSource, /writeAssetFile/);
  assert.match(appSource, /collectUniqueTiles/);
  assert.match(appSource, /querySelectorAll\('\.hstg-event-row\[data-event-index\]'\)/);
  assert.match(uiSource, /upsertCollectionEntity/);
  assert.match(uiSource, /document\.id, 'text', 'readonly'/);
  assert.match(appSource, /bulletVectors/);
  assert.match(appSource, /capabilities\.get\('vgm-preview-player'\)/);
  assert.match(appSource, /api\.pages\?\.open/);
  assert.match(uiSource, /<canvas width="320" height="224" data-role="preview"/);
  assert.match(uiSource, /data-role="timeline"/);
  assert.match(uiSource, /8×8 背景タイル編集/);
  assert.match(uiSource, /data-page="md-bgm-composer"/);
  assert.match(hostSource, /pages: \{/);
  assert.match(hostSource, /open: \(pageOrPluginId\) =>/);
});

test('preview core models parallax, enemy movement, bullet patterns, and unique 8x8 tiles', async () => {
  const core = await import(pathToFileURL(path.join(editorRoot, 'preview-core.mjs')).href);
  assert.equal(core.backgroundSourceX(500, 640, 320, 1), 250);
  assert.equal(core.eventReferenceKey('spawn_enemy'), 'enemy_id');
  assert.equal(core.bulletVectors('spread').length, 3);
  assert.equal(core.bulletVectors('core', 0.5, 'boss').length, 16);
  const position = core.simulateSpawnPosition(
    { trigger: { at: 100 }, payload: { x: 336, y: 112 } },
    { vx256: -256, vy256: 0, behavior: 'straight' },
    164,
    256,
  );
  assert.equal(position.x, 272);
  assert.equal(position.y, 112);

  const data = new Uint8ClampedArray(16 * 8 * 4);
  for (let y = 0; y < 8; y += 1) data.fill(255, ((y * 16) + 8) * 4, ((y * 16) + 16) * 4);
  assert.equal(core.collectUniqueTiles({ width: 16, height: 8, data }).length, 2);
});

test('collection save preserves unselected entries and replaces only the selected entity', async () => {
  const ui = await import(pathToFileURL(path.join(editorRoot, 'editor-ui.mjs')).href);
  const original = [{ id: 'a', hp: 1 }, { id: 'b', hp: 2 }, { id: 'c', hp: 3 }];
  const updated = ui.upsertCollectionEntity(original, 'b', { id: 'b', hp: 20 });
  assert.deepEqual(updated, [{ id: 'a', hp: 1 }, { id: 'b', hp: 20 }, { id: 'c', hp: 3 }]);
  assert.deepEqual(original, [{ id: 'a', hp: 1 }, { id: 'b', hp: 2 }, { id: 'c', hp: 3 }]);
  assert.deepEqual(ui.upsertCollectionEntity(original, 'new', { id: 'd', hp: 4 }).map((entry) => entry.id), ['a', 'b', 'c', 'd']);
});

test('editable system sprite paths flow into generated ResComp resources', () => {
  const snapshot = service.readSnapshot(geronekoTemplate);
  snapshot.project.assets.player = 'gfx/player_ship_custom.png';
  const generated = schema.generateFiles(snapshot);
  assert.equal(generated.ok, true);
  assert.ok(generated.files['res/common.res'].includes('SPRITE spr_player_test "gfx/player_ship_custom.png"'));
});

test('runtime includes the complete game flow, persistent SRAM, remappable controls, and ABYSS CORE ownership', () => {
  const runtime = path.join(builderRoot, 'template');
  const gameHeader = fs.readFileSync(path.join(runtime, 'inc', 'game', 'game.h'), 'utf8');
  const gameSource = fs.readFileSync(path.join(runtime, 'src', 'game', 'game.c'), 'utf8');
  const saveSource = fs.readFileSync(path.join(runtime, 'src', 'system', 'save.c'), 'utf8');
  const coreSource = fs.readFileSync(path.join(runtime, 'src', 'player', 'abyss_core.c'), 'utf8');
  const editorRenderer = [
    fs.readFileSync(path.join(editorRoot, 'renderer.js'), 'utf8'),
    fs.readFileSync(path.join(editorRoot, 'renderer-app.mjs'), 'utf8'),
  ].join('\n');

  for (const state of [
    'TITLE', 'MAIN_MENU', 'OPTIONS', 'HIGH_SCORES', 'SOUND_TEST', 'HOW_TO',
    'OPENING', 'STAGE_INTRO', 'STAGE_LOAD', 'PLAY', 'PAUSE', 'STAGE_CLEAR',
    'CONTINUE', 'GAME_OVER', 'NAME_ENTRY', 'ENDING', 'STAFF_ROLL',
  ]) {
    assert.match(gameHeader, new RegExp(`GAME_STATE_${state}`));
  }
  assert.match(gameSource, /mapGameplayInput\(rawInput, &input\)/);
  assert.match(gameSource, /session\.abyssValue != 0/);
  assert.match(saveSource, /SRAM_writeLong\(SAVE_OFFSET_MAGIC, SAVE_MAGIC\)/);
  assert.match(saveSource, /SRAM_readLong\(SAVE_OFFSET_MAGIC\) == SAVE_MAGIC/);
  assert.match(saveSource, /SAVE_OFFSET_OPTIONS/);
  assert.match(saveSource, /SAVE_OFFSET_SCORES/);
  assert.match(coreSource, /gameGetSession\(\)->abyssValue = 1/);
  assert.match(coreSource, /gameGetSession\(\)->abyssValue = 0/);
  assert.match(editorRenderer, /action === 'delete'\) runGuard/);
  assert.match(editorRenderer, /action === 'move-up'\) runGuard/);
  assert.match(editorRenderer, /openEntity\(kind, id\)[\s\S]*?runGuard\(\(\) => \{/);
});

test('runtime renders charge, lives, weapon power, speed, bombs, and core through graphical HUD tiles', () => {
  const runtime = path.join(builderRoot, 'template');
  const hudSource = fs.readFileSync(path.join(runtime, 'src', 'render', 'hud.c'), 'utf8');
  const backgroundSource = fs.readFileSync(path.join(runtime, 'src', 'stage', 'background.c'), 'utf8');
  const generated = schema.generateFiles(service.readSnapshot(geronekoTemplate));

  assert.match(hudSource, /#define CHARGE_BAR_SEGMENTS 12/);
  assert.match(hudSource, /HUD_TILE_LIFE/);
  assert.match(hudSource, /HUD_TILE_BOMB/);
  assert.match(hudSource, /HUD_TILE_WEAPON_RED/);
  assert.ok(hudSource.includes('drawPips(19, 0'));
  assert.ok(hudSource.includes('VDP_loadTileSet(&ts_hud_icons, HUD_TILE_BASE, DMA)'));
  assert.ok(!hudSource.includes('intToStr(charge'));
  assert.ok(backgroundSource.includes('TILE_USER_INDEX + ts_hud_icons.numTile'));
  assert.ok(generated.files['res/common.res'].includes('TILESET ts_hud_icons "gfx/hud_icons.png" NONE NONE'));
});

test('stable runtime IDs reserve zero and survive normalization without renumbering', () => {
  const original = service.readSnapshot(geronekoTemplate);
  const first = schema.assignRuntimeIds(original);
  const second = schema.assignRuntimeIds(schema.deepClone(first));
  assert.deepEqual(second.id_registry, first.id_registry);
  for (const namespace of ['stages', 'enemies', 'bosses']) {
    const values = Object.values(first.id_registry.namespaces[namespace]);
    assert.ok(values.length > 0);
    assert.ok(values.every((value) => value >= 1 && value <= 255));
    assert.equal(new Set(values).size, values.length);
  }
  const files = schema.generateFiles(first);
  assert.equal(files.ok, true);
  assert.match(files.files['inc/generated/generated_ids.h'], /STAGE_NONE = 0/);
  assert.match(files.files['inc/generated/generated_ids.h'], /#define STG_FIRST_STAGE_ID STAGE_BLUE_HORIZON/);
});

test('spawn_item event bytes use the fixed zero-based SGDK ItemType enum', () => {
  const snapshot = schema.assignRuntimeIds(service.readSnapshot(starterTemplate));
  const generated = schema.generateFiles(snapshot);
  assert.equal(generated.ok, true);
  const source = generated.files['src/generated/training_reef_events.c'];
  // delta 420 from the prior scroll event, command 4, ITEM_POWER=3, x=300, y=88
  assert.match(source, /0xA4, 0x01, 0x04, 0x03, 0x2C, 0x01, 0x58, 0x00/);
});

test('validation rejects broken stage references before generating C', () => {
  const snapshot = schema.assignRuntimeIds(service.readSnapshot(starterTemplate));
  snapshot.stages[0].events[0].payload.enemy_id = 'missing-enemy';
  const result = schema.generateFiles(snapshot);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'STG_EVENT_ENEMY_REF'));
});

test('project path resolver rejects absolute paths and traversal', () => {
  const root = path.resolve(starterTemplate);
  assert.throws(() => service.resolveProjectPath(root, '..\\outside.json'), /traversal/);
  assert.throws(() => service.resolveProjectPath(root, path.resolve(root, 'project.json')), /project-relative/);
  assert.equal(service.resolveProjectPath(root, 'data/horizontal-stg/project.json'), path.join(root, 'data', 'horizontal-stg', 'project.json'));
});

test('document saves use optimistic revisions and reject stale editor writes', () => {
  const root = tempProject();
  try {
    const loaded = service.loadProject(root);
    assert.equal(loaded.ok, true);
    const stage = loaded.snapshot.stages[0];
    const first = service.saveDocument(root, {
      kind: 'stage',
      id: stage.id,
      baseRevision: loaded.snapshot.revisions.stages[stage.id],
      data: { ...stage, name: 'REVISION ONE' },
    });
    assert.equal(first.ok, true, first.error);
    const stale = service.saveDocument(root, {
      kind: 'stage',
      id: stage.id,
      baseRevision: loaded.snapshot.revisions.stages[stage.id],
      data: { ...stage, name: 'STALE WRITE' },
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    assert.equal(service.readSnapshot(root).stages[0].name, 'REVISION ONE');
  } finally {
    cleanup(root);
  }
});

test('stage reorder requires every stage exactly once and updates first stage', () => {
  const root = tempProject(geronekoTemplate);
  try {
    const loaded = service.loadProject(root);
    const reversed = [...loaded.snapshot.project.stage_order].reverse();
    const invalid = service.reorderStages(root, { ids: reversed.slice(1) });
    assert.equal(invalid.ok, false);
    const result = service.reorderStages(root, {
      ids: reversed,
      baseRevision: loaded.snapshot.revisions.project,
    });
    assert.equal(result.ok, true, result.error);
    const project = service.readSnapshot(root).project;
    assert.deepEqual(project.stage_order, reversed);
    assert.equal(project.first_stage_id, reversed[0]);
  } finally {
    cleanup(root);
  }
});

test('indexed PNG inspection counts actual used palette indices', () => {
  const pngPath = path.join(builderRoot, 'template', 'res', 'gfx', 'stage01_bg_a.png');
  const inspected = service.inspectIndexedPng(pngPath);
  assert.equal(inspected.colorType, 3);
  assert.equal(inspected.bitDepth, 8);
  assert.equal(inspected.interlace, 0);
  assert.ok(inspected.paletteEntries >= inspected.usedPaletteEntries);
  assert.ok(inspected.usedPaletteEntries >= 1 && inspected.usedPaletteEntries <= 16);
});

test('builder exports explicit C sources and never asks SGDK to compile boot twice', () => {
  const root = tempProject(geronekoTemplate);
  try {
    const result = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [] });
    assert.equal(result.ok, true, result.error);
    assert.ok(fs.existsSync(path.join(root, 'res', 'gfx', 'hud_icons.png')));
    assert.ok(fs.existsSync(path.join(root, 'res', 'gfx', 'title_background.png')));
    assert.ok(fs.existsSync(path.join(root, 'res', 'gfx', 'title_logo.png')));
    const commonRes = fs.readFileSync(path.join(root, 'res', 'common.res'), 'utf8');
    assert.match(commonRes, /IMAGE img_title_background/);
    assert.match(commonRes, /IMAGE img_title_logo/);
    assert.match(commonRes, /TILESET ts_hud_icons/);
    const sources = result.makeVariables.SRC_C.split(' ');
    assert.ok(sources.includes('src/generated/blue_horizon_events.c'));
    assert.ok(sources.includes('src/generated/living_ark_events.c'));
    assert.ok(sources.includes('src/stage/stage_controller.c'));
    assert.ok(!sources.some((source) => /rom_head|sega\.s/.test(source)));
    assert.equal(new Set(sources).size, sources.length);
    assert.match(fs.readFileSync(path.join(root, 'src', 'main.c'), 'utf8'), /int main\(bool hardReset\)/);
  } finally {
    cleanup(root);
  }
});

test('builder rejects duplicate ResComp symbols and ROMs above the configured 4 MiB hard limit', () => {
  const root = tempProject();
  try {
    const duplicate = builder.onBuildStart({ projectDir: root }, {
      projectDir: root,
      assets: [
        { name: 'same_symbol', sourcePath: 'res/a.res' },
        { name: 'same_symbol', sourcePath: 'res/b.res' },
      ],
    });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error, /same_symbol/);

    const romPath = path.join(root, 'out', 'rom.bin');
    fs.mkdirSync(path.dirname(romPath), { recursive: true });
    fs.writeFileSync(romPath, Buffer.alloc(1));
    fs.truncateSync(romPath, (4 * 1024 * 1024) + 1);
    const size = builder.onBuildEnd({ projectDir: root, romPath }, { projectDir: root });
    assert.equal(size.ok, false);
    assert.match(size.error, /hard limit/);
  } finally {
    cleanup(root);
  }
});

test('editor hook guards missing project context instead of touching the filesystem', () => {
  const result = editor.loadHorizontalStgProject({}, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /projectDir is required/);
});
