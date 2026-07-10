'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* テストを高速化するため少ないフレーム数で焼き込む */
function writeFastSettings(projectDir) {
  const dir = path.join(projectDir, 'data', 'dungeon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ animation_frames: 3, turn_frames: 3 }));
}

function readIndexedPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  let plte = null;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 3);
    }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    assert.equal(raw[rowStart], 0);
    pixels.set(raw.subarray(rowStart + 1, rowStart + 1 + width), y * width);
  }
  return { width, height, pixels, plte };
}

test('dungeon plugins declare MD editor and builder capabilities', () => {
  const userData = makeTempDir('md-editor-dungeon-plugin-list-');
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const editor = pluginManager.listPlugins().find((item) => item.id === 'dungeon-game-editor');
  const builder = pluginManager.listPlugins().find((item) => item.id === 'dungeon-game-builder');

  assert.ok(editor);
  assert.equal(editor.name, 'ダンジョンゲームエディター');
  assert.deepEqual(editor.supportedCores, ['mega-drive']);
  assert.equal(editor.hasRenderer, true);
  assert.equal(editor.renderer.page, 'dungeon-game-editor');
  assert.deepEqual(editor.renderer.capabilities, ['page', 'dungeon-game-editor']);
  assert.equal(editor.version, '1.1.0');
  assert.ok(editor.permissions.includes('dialog.openFile'));
  assert.ok(editor.dependencies.includes('asset-manager'));
  assert.ok(editor.dependencies.includes('image-resize-converter'));
  assert.ok(editor.dependencies.includes('image-quantize-converter'));
  assert.deepEqual(editor.mainApi.hooks, [
    'listDungeonFloors',
    'saveDungeonState',
    'saveDungeonFloor',
    'deleteDungeonFloor',
    'moveDungeonFloor',
    'generateDungeonFloor',
    'exportDungeonData',
    'listDungeonSettings',
    'saveDungeonSettings',
  ]);

  assert.ok(builder);
  assert.equal(builder.name, 'ダンジョンゲームビルダー');
  assert.deepEqual(builder.supportedCores, ['mega-drive']);
  assert.deepEqual(builder.dependencies, ['dungeon-game-editor']);
  assert.equal(builder.roles.length, 1);
  assert.equal(builder.roles[0].id, 'builder');

  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'renderer.js'), 'utf-8');
  assert.match(rendererSource, /saveDungeonState/);
  assert.match(rendererSource, /pickFile/);
  assert.match(rendererSource, /convertToIndexed16/);
  assert.match(rendererSource, /targetExtension/);
  assert.match(rendererSource, /writeAssetFile/);
  assert.match(rendererSource, /isRequiredIndexedPng/);
  assert.match(rendererSource, /textureCacheEpoch/);
  assert.match(rendererSource, /guardUnsaved/);
  assert.match(rendererSource, /core\.compositeView/);
});

test('dungeon render core is UMD and keeps compose == direct render', () => {
  const corePath = path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'render-core.js');
  const coreSource = fs.readFileSync(corePath, 'utf-8');
  assert.doesNotMatch(coreSource, /^\s*import\s/m);
  assert.doesNotMatch(coreSource, /^\s*export\s/m);
  assert.doesNotMatch(coreSource, /require\(/);
  assert.match(coreSource, /module\.exports = core/);
  assert.match(coreSource, /globalThis\.DungeonRenderCore = core/);

  const core = require(corePath);
  assert.equal(core.EDGE_STATE_COUNT, 5);
  const settings = { animation_frames: 3, turn_frames: 3 };
  const spaces = core.buildEdgeSpaces(settings);
  assert.ok(spaces.move.length > 20 && spaces.move.length <= core.MOVE_EDGE_LIMIT);
  assert.ok(spaces.turn.length > spaces.move.length && spaces.turn.length <= core.TURN_EDGE_LIMIT);

  /* 階段セルはソリッド: 開いた面は壁として描かれ、視線と移動を遮る */
  const blank = () => ({ walls: 0, doors: 0, one_way: 0, dark: false, event: '', stairs: '' });
  const mkFloor = () => ({ width: 5, height: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, blank)) });
  const stairsFloor = mkFloor();
  stairsFloor.cells[1][2].stairs = 'up';
  assert.equal(core.cellIsSolid(stairsFloor.cells[1][2]), true);
  assert.equal(core.edgeStateBetween(stairsFloor, 2, 2, 0), core.EDGE_STATE_WALL);
  assert.equal(core.rawEdgeState(stairsFloor, 2, 2, 0), core.EDGE_STATE_OPEN);
  assert.deepEqual(core.stairsArrival(stairsFloor, 'up'), { x: 2, y: 0, dir: 0 });

  /* LOS: 壁越し・角越し・階段セル越しの宝箱は見えない。階段セル自体は見える */
  const wallFloor = mkFloor();
  wallFloor.cells[2][2].walls = 2;
  wallFloor.cells[2][3].walls = 8;
  assert.equal(core.losVisible(wallFloor, 2, 2, 1, 2, 0), false);
  assert.equal(core.losVisible(wallFloor, 2, 2, 0, 2, 0), true);
  const cornerFloor = mkFloor();
  cornerFloor.cells[3][2].walls |= 1;
  cornerFloor.cells[2][2].walls |= 4;
  cornerFloor.cells[2][1].walls |= 2;
  cornerFloor.cells[2][2].walls |= 8;
  assert.equal(core.losVisible(cornerFloor, 1, 3, 0, 2, 2), false);
  assert.equal(core.losVisible(stairsFloor, 2, 3, 0, 3, 0), false);
  assert.equal(core.losVisible(stairsFloor, 2, 3, 0, 2, 0), true);

  /* 鏡像の対合性 */
  spaces.turn.forEach((def, index) => {
    const back = core.mirrorEdgeDef(spaces.turnMirrored[index]);
    assert.deepEqual({ dd: back.dd, dl: back.dl, face: back.face }, { dd: def.dd, dl: def.dl, face: def.face });
  });

  const textures = core.normalizeTextures({});
  const palette = core.buildViewPalette(textures);
  assert.equal(palette.length, 16);
  assert.deepEqual([palette[0].r, palette[0].g, palette[0].b], [0, 0, 0]);
  const bands = core.buildBandTables(palette, textures);
  assert.equal(bands.length, core.VIEW_W * core.VIEW_H);
  const backdrop = core.buildBackdropSheet(palette, textures);
  assert.deepEqual([backdrop.width, backdrop.height], [32, 64]);
  const pool = core.makeTilePool();
  const frames = core.buildFrames(settings);

  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const floor = service.makeGeneratedFloor({ width: 10, height: 10 });

  const checks = [
    { pose: frames.staticPose, defs: spaces.move },
    { pose: frames.fwdPoses[0], defs: spaces.move },
    { pose: frames.turnPoses[1], defs: spaces.turn },
  ];
  checks.forEach(({ pose, defs }) => {
    const bake = core.bakeFrame(pose, defs, textures, palette, bands, pool);
    assert.ok(bake.stats.nodeWords < 32768);
    for (const [px, py, dir] of [[2, 2, 1], [5, 5, 0], [7, 3, 2], [3, 7, 3]]) {
      const states = core.sampleEdgeStates(floor, px, py, dir, defs);
      const foreground = core.assembleTiles(bake, core.composeFromFrame(bake, states), pool);
      const composed = core.compositeView(core.buildBackground(bands), foreground);
      const direct = core.renderView(pose, defs, states, textures, palette, bands);
      let diff = 0;
      for (let i = 0; i < composed.length; i++) {
        if (composed[i] !== direct[i]) diff++;
      }
      /* 遠距離スライバー切り捨てによる差のみ許容 (全 25600px 中) */
      assert.ok(diff <= 64, `composed view diverged from direct render: ${diff}px`);
    }
  });
});

test('dungeon-game-editor generates bounded thin-wall floors and exports SGDK data', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-editor-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const context = { projectDir, logger: logger() };
  writeFastSettings(projectDir);

  const generated = plugin.generateDungeonFloor({ width: 20, height: 18, name: 'Labyrinth' }, context);
  assert.equal(generated.ok, true);
  assert.equal(generated.floor.width, 20);
  assert.equal(generated.floor.height, 18);
  assert.equal(generated.floor.cells.length, 18);
  assert.equal(generated.floor.cells[0].length, 20);
  /* 階段セルはソリッドになるため開始セルには置かれない */
  assert.equal(generated.floor.cells[generated.floor.start.y][generated.floor.start.x].stairs, '');
  assert.ok(generated.floor.cells.flat().some((cell) => cell.stairs === 'up'));

  const cells = generated.floor.cells.flat();
  assert.ok(cells.some((cell) => cell.doors !== 0));
  assert.ok(cells.some((cell) => cell.event === 'chest'));
  assert.ok(cells.some((cell) => cell.stairs === 'down'));
  assert.ok(cells.some((cell) => cell.walls !== 15));

  const listed = plugin.listDungeonFloors({}, context);
  assert.equal(listed.ok, true);
  assert.equal(listed.maxSize, 20);
  assert.equal(listed.floors.length, 1);
  assert.equal(listed.settings.turn_frames, 3);
  assert.equal(listed.floors[0].asset_set_id, 'default');
  assert.match(listed.settings.asset_sets[0].assets.door_texture, /#door$/);

  const exported = plugin.exportDungeonData({}, context);
  assert.equal(exported.ok, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_data.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_data.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_patterns.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_patterns.c')), true);
  assert.equal(exported.assetSets.length, 1);
  const generatedSet = exported.assetSets[0];
  assert.equal(fs.existsSync(path.join(projectDir, 'res', generatedSet.paths.tileset)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', generatedSet.paths.background)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', generatedSet.paths.billboards.chest)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', generatedSet.paths.billboards.stairs_up)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', generatedSet.paths.billboards.stairs_down)), true);
  /* 旧全画面パターン atlas は生成されない */
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_map.png')), false);

  const header = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_data.h'), 'utf-8');
  assert.match(header, /#define DUNGEON_FLOOR_COUNT 1/);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  assert.match(source, /const DungeonFloorData dungeon_floors/);
  assert.match(source, /dungeon_floor_1_edges/);

  const patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_ANIMATION_FRAMES 3/);
  assert.match(patternHeader, /#define DUN_TURN_ANIMATION_FRAMES 3/);
  assert.match(patternHeader, /#define DUN_ANIMATION_STEP_VBLANKS 2/);
  assert.match(patternHeader, /#define DUN_FWD_FRAMES 2/);
  assert.match(patternHeader, /#define DUN_TURN_FRAMES 2/);
  assert.match(patternHeader, /#define DUN_MOVE_EDGE_COUNT \d+/);
  assert.match(patternHeader, /#define DUN_TURN_EDGE_COUNT \d+/);
  assert.match(patternHeader, /#define DUN_EDGE_STATE_COUNT 5/);
  assert.match(patternHeader, /#define DUN_VIEW_SET_COUNT 1/);
  assert.match(patternHeader, /#define DUN_BACKGROUND_TILE_COUNT 32/);
  assert.match(patternHeader, /#define DUN_TILESET_TILE_COUNT \d+/);
  assert.match(patternHeader, /#define DUN_BB_CELL_COUNT \d+/);
  assert.match(patternHeader, /typedef struct \{ s8 dd; s8 dl; u8 face; \} DunEdgeDef;/);
  assert.match(patternHeader, /DunFrameTable/);
  assert.match(patternHeader, /typedef struct \{[\s\S]*const TileSet \*background_tileset;[\s\S]*\} DunViewSet;/);
  assert.match(patternHeader, /extern const DunViewSet dun_view_sets\[DUN_VIEW_SET_COUNT\];/);
  assert.doesNotMatch(patternHeader, /DUN_WALL_VIEW_COUNT/);
  assert.doesNotMatch(patternHeader, /DUN_VIEW_PATTERN_COLUMNS/);
  assert.doesNotMatch(patternHeader, /dungeon_view_pattern_count/);

  const patternSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_patterns.c'), 'utf-8');
  assert.match(patternSource, /const DunEdgeDef dun_edges_move\[/);
  assert.match(patternSource, /const DunEdgeDef dun_edges_turn_mirrored\[/);
  assert.match(patternSource, /frame_static/);
  assert.match(patternSource, /frames_fwd\[DUN_FWD_FRAMES\]/);
  assert.match(patternSource, /frames_turn\[DUN_TURN_FRAMES\]/);
  assert.match(patternSource, /const DunBBCell dun_bb_cells\[/);
  assert.match(patternSource, /const DunBBPose dun_bb_turn\[DUN_TURN_FRAMES\]/);
  assert.match(patternSource, /palette_dark\[16\]/);
  assert.match(patternSource, /const DunViewSet dun_view_sets\[DUN_VIEW_SET_COUNT\]/);
  assert.doesNotMatch(patternSource, /dungeon_view_pattern_count/);

  const tileCount = Number(patternHeader.match(/#define DUN_TILESET_TILE_COUNT (\d+)/)?.[1] || 0);
  assert.ok(tileCount > 100);
  assert.equal(exported.patternTileCount, tileCount);
  assert.ok(exported.budget && exported.budget.tileCount === tileCount);
  assert.ok(Array.isArray(exported.warnings));

  /* ビュータイルセット: index0 = 黒 / ビルボード: index0 = マゼンタ */
  const tileset = readIndexedPng(path.join(projectDir, 'res', generatedSet.paths.tileset));
  assert.deepEqual(Array.from(tileset.plte.subarray(0, 3)), [0, 0, 0]);
  const background = readIndexedPng(path.join(projectDir, 'res', generatedSet.paths.background));
  assert.deepEqual([background.width, background.height], [32, 64]);
  const chestSheet = readIndexedPng(path.join(projectDir, 'res', generatedSet.paths.billboards.chest));
  assert.deepEqual(Array.from(chestSheet.plte.subarray(0, 3)), [255, 0, 255]);
  assert.equal(chestSheet.width, 48 * 8);
  assert.equal(chestSheet.height, 48);
  let chestPixels = 0;
  for (let i = 0; i < chestSheet.pixels.length; i++) {
    if (chestSheet.pixels[i] !== 0) chestPixels++;
  }
  assert.ok(chestPixels > 500);

  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  assert.match(resources, /PALETTE dun_[a-z0-9_]+_view_palette /);
  assert.match(resources, /TILESET dun_[a-z0-9_]+_view_tileset .* NONE ALL/);
  assert.match(resources, /TILESET dun_[a-z0-9_]+_background_tileset .* NONE NONE/);
  assert.match(resources, /PALETTE dun_[a-z0-9_]+_bb_palette /);
  assert.match(resources, /SPRITE dun_[a-z0-9_]+_bb_chest .* 6 6 NONE 0/);
  assert.match(resources, /SPRITE dun_[a-z0-9_]+_bb_stairs_up /);
  assert.match(resources, /SPRITE dun_[a-z0-9_]+_bb_stairs_down /);
  assert.doesNotMatch(resources, /TILEMAP /);

  /* 2 回目のエクスポートは焼き込みキャッシュが効く */
  const again = plugin.exportDungeonData({}, context);
  assert.equal(again.ok, true);
  assert.equal(again.cached, true);
});

test('dungeon asset sets migrate legacy floors and export per-set resources with selective cache', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-sets-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const plugin = require('../plugins/dungeon-game-editor');
  const dungeonDir = path.join(projectDir, 'data', 'dungeon');
  const floorsDir = path.join(dungeonDir, 'floors');
  fs.mkdirSync(floorsDir, { recursive: true });

  const legacyAssets = { ...service.DEFAULT_ASSETS, wall_texture: 'dungeon/textures/legacy.png#wall' };
  const legacyFloor = service.makeGeneratedFloor({
    id: 'legacy-floor',
    name: 'Legacy',
    order: 1,
    width: 8,
    height: 8,
    assets: legacyAssets,
  });
  delete legacyFloor.asset_set_id;
  fs.writeFileSync(path.join(floorsDir, 'floor_001_legacy.json'), `${JSON.stringify(legacyFloor, null, 2)}\n`);
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), JSON.stringify({ animation_frames: 3, turn_frames: 3 }));

  const listed = plugin.listDungeonFloors({}, { projectDir, logger: logger() });
  assert.equal(listed.ok, true);
  assert.match(listed.floors[0].asset_set_id, /^legacy-/);
  assert.equal(listed.settings.asset_sets.length, 2);
  const stillLegacy = JSON.parse(fs.readFileSync(path.join(floorsDir, 'floor_001_legacy.json'), 'utf-8'));
  assert.ok(stillLegacy.assets);
  assert.equal(Object.hasOwn(stillLegacy, 'asset_set_id'), false);

  const migrated = plugin.saveDungeonState({ floor: listed.floors[0], settings: listed.settings }, { projectDir, logger: logger() });
  assert.equal(migrated.ok, true);
  const migratedFloor = JSON.parse(fs.readFileSync(path.join(floorsDir, 'floor_001_legacy.json'), 'utf-8'));
  assert.equal(Object.hasOwn(migratedFloor, 'assets'), false);
  assert.match(migratedFloor.asset_set_id, /^legacy-/);

  const settings = migrated.settings;
  settings.asset_sets.push({
    id: 'lava',
    name: 'Lava',
    assets: { ...service.DEFAULT_ASSETS, wall_texture: 'dungeon/textures/lava.png#wall' },
  });
  const second = service.makeGeneratedFloor({
    id: 'lava-floor',
    name: 'Lava Floor',
    order: 2,
    width: 8,
    height: 8,
    asset_set_id: 'lava',
  });
  const saved = plugin.saveDungeonState({ create: true, floor: second, settings }, { projectDir, logger: logger() });
  assert.equal(saved.ok, true);
  assert.equal(saved.export.assetSets.length, 2);
  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  assert.equal((resources.match(/_background_tileset /g) || []).length, 2);
  const dataSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 0, dungeon_floor_1_edges/);
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 1, dungeon_floor_2_edges/);

  const cached = plugin.exportDungeonData({}, { projectDir, logger: logger() });
  assert.equal(cached.cached, true);
  const nextSettings = JSON.parse(fs.readFileSync(path.join(dungeonDir, 'settings.json'), 'utf-8'));
  nextSettings.asset_sets.find((set) => set.id === 'lava').assets.wall_texture = 'dungeon/textures/lava-2.png#wall';
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), `${JSON.stringify(nextSettings, null, 2)}\n`);
  const changed = plugin.exportDungeonData({}, { projectDir, logger: logger() });
  assert.equal(changed.cached, false);
  assert.equal(changed.assetSets.find((set) => set.id === migratedFloor.asset_set_id).cached, true);
  assert.equal(changed.assetSets.find((set) => set.id === 'lava').cached, false);
});

test('dungeon tagless texture validation enforces indexed dimensions and colors', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-validate-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const textureDir = path.join(projectDir, 'res', 'dungeon', 'textures', 'test');
  const palette = [
    { r: 0, g: 0, b: 0 },
    { r: 224, g: 224, b: 224 },
  ];
  const validPixels = new Uint8Array(96 * 96);
  validPixels.fill(1);
  service.writeIndexedPng(path.join(textureDir, 'wall.png'), 96, 96, palette, validPixels);
  assert.equal(service.validateTextureRef(projectDir, 'wall_texture', 'dungeon/textures/test/wall.png').ok, true);

  service.writeIndexedPng(path.join(textureDir, 'small.png'), 32, 32, palette, new Uint8Array(32 * 32));
  assert.throws(
    () => service.validateTextureRef(projectDir, 'wall_texture', 'dungeon/textures/test/small.png'),
    /96x96px/,
  );

  const manyPalette = Array.from({ length: 17 }, (_, index) => ({ r: index * 12, g: index * 8, b: index * 4 }));
  const manyPixels = new Uint8Array(96 * 96);
  manyPixels.fill(1);
  service.writeIndexedPng(path.join(textureDir, 'many.png'), 96, 96, manyPalette, manyPixels);
  assert.throws(
    () => service.validateTextureRef(projectDir, 'wall_texture', 'dungeon/textures/test/many.png'),
    /16色以下/,
  );

  const outsidePath = path.join(makeTempDir('md-editor-dungeon-outside-'), 'wall.png');
  service.writeIndexedPng(outsidePath, 96, 96, palette, validPixels);
  assert.throws(
    () => service.validateTextureRef(projectDir, 'wall_texture', outsidePath),
    /画像が見つかりません/,
  );

  assert.throws(() => service.validateProjectState([], { asset_sets: [] }), /1件以上/);
  assert.throws(
    () => service.validateProjectState([], { asset_sets: [service.DEFAULT_ASSET_SET, service.DEFAULT_ASSET_SET] }),
    /重複/,
  );
  assert.throws(
    () => service.validateProjectState([{ name: 'Broken', asset_set_id: 'missing' }], { asset_sets: [service.DEFAULT_ASSET_SET] }),
    /存在しません/,
  );
});

test('dungeon state save rejects invalid set assets before persisting settings', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-preflight-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  writeFastSettings(projectDir);
  const floor = service.makeGeneratedFloor({
    id: 'floor-1',
    name: 'Floor 1',
    order: 1,
    width: 8,
    height: 8,
    asset_set_id: 'default',
  });
  const first = service.saveState(projectDir, { create: true, floor });
  assert.equal(first.ok, true);

  const invalidDir = path.join(projectDir, 'res', 'dungeon', 'textures', 'default');
  service.writeIndexedPng(
    path.join(invalidDir, 'wall.png'),
    32,
    32,
    [{ r: 0, g: 0, b: 0 }, { r: 224, g: 224, b: 224 }],
    new Uint8Array(32 * 32),
  );
  const invalidSettings = JSON.parse(JSON.stringify(first.settings));
  invalidSettings.asset_sets[0].assets.wall_texture = 'dungeon/textures/default/wall.png';
  assert.throws(
    () => service.saveState(projectDir, { floor: first.floor, settings: invalidSettings }),
    /96x96px/,
  );
  const persisted = JSON.parse(fs.readFileSync(path.join(projectDir, 'data', 'dungeon', 'settings.json'), 'utf-8'));
  assert.match(persisted.asset_sets[0].assets.wall_texture, /#wall$/);
});

test('dungeon-game-builder syncs engine, writes generated main, and build variables', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-builder-'), 'demo');
  const builder = require('../plugins/dungeon-game-builder');
  const manifest = require('../plugins/dungeon-game-builder/manifest.json');
  const context = { projectDir, assets: [], logger: logger() };
  writeFastSettings(projectDir);

  const generated = builder.generateSource([], context);
  assert.equal(generated.ok, true);
  assert.match(generated.sourceCode, new RegExp(`Generated by dungeon-game-builder v${escapeRegExp(manifest.version)}`));
  assert.match(generated.sourceCode, /int main\(bool hardReset\)/);
  assert.match(generated.sourceCode, /hasWallAt/);
  assert.match(generated.sourceCode, /DUN_USE_TEXT_HUD 1/);
  assert.match(generated.sourceCode, /selectAction/);
  assert.match(generated.sourceCode, /performAction/);
  assert.match(generated.sourceCode, /DUN_playForward/);
  assert.match(generated.sourceCode, /DUN_playBackward/);
  assert.match(generated.sourceCode, /DUN_playTurn/);
  assert.match(generated.sourceCode, /DUN_setDark/);
  assert.match(generated.sourceCode, /DUN_applyViewSet/);
  assert.match(generated.sourceCode, /DUN_drawMinimap/);
  assert.match(generated.sourceCode, /DUN_ACTION_STAIRS/);
  assert.match(generated.sourceCode, /goStairs/);
  assert.match(generated.sourceCode, /stairsFlagsAt/);
  /* 前進/後退は押しっぱなし (レベルトリガー) */
  assert.match(generated.sourceCode, /\(joy & BUTTON_UP\)/);
  assert.match(generated.sourceCode, /\(joy & BUTTON_DOWN\)/);
  assert.match(generated.sourceCode, /SPR_update/);
  assert.match(generated.sourceCode, /canMove\(floor, player_x, player_y, player_dir\)/);
  assert.doesNotMatch(generated.sourceCode, /KDebug_Alert/);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_view.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_data.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'sega.s')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_game.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_view.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_patterns.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_patterns.c')), true);

  const viewSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_view.c'), 'utf-8');
  assert.match(viewSource, /DUN_VIEW_TILE_W/);
  assert.match(viewSource, /#include "resources\.h"/);
  assert.match(viewSource, /evaluateEdgeStates/);
  assert.match(viewSource, /stageFrame/);
  assert.match(viewSource, /VDP_loadTileData\(tile_staging/);
  assert.match(viewSource, /DMA_QUEUE/);
  assert.match(viewSource, /VDP_setTileMapDataRect/);
  assert.match(viewSource, /dun_edges_turn_mirrored/);
  assert.match(viewSource, /SPR_addSprite/);
  assert.match(viewSource, /losVisible/);
  assert.match(viewSource, /rawEdgeState/);
  assert.match(viewSource, /cellIsSolidAt/);
  assert.match(viewSource, /DUN_drawMinimap/);
  assert.match(viewSource, /dun_mm_palette/);
  assert.match(viewSource, /active_view_set->dark_palette/);
  assert.match(viewSource, /active_view_set->view_tileset/);
  assert.match(viewSource, /active_view_set->background_tileset/);
  assert.match(viewSource, /VDP_setTileMapDataRect\(BG_B/);
  assert.doesNotMatch(viewSource, /VDP_setTileMapXY/);
  assert.doesNotMatch(viewSource, /loadCachedTile/);
  assert.doesNotMatch(viewSource, /dungeon_view_tilemap/);
  assert.doesNotMatch(viewSource, /MAP_create/);

  const buildStart = builder.onBuildStart({ projectDir }, context);
  assert.equal(buildStart.ok, true);
  assert.match(buildStart.makeVariables.SRC_C, /src\/main\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_view\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_data\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_patterns\.c/);
  assert.equal(Object.hasOwn(buildStart.makeVariables, 'SRC_S'), false);
});

test('dungeon-game-editor renderer drives preview through the shared render core', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'style.css'), 'utf-8');

  assert.match(rendererSource, /3Dプレビュー/);
  assert.match(rendererSource, /data-tool="?\$\{tool\.id\}/);
  assert.match(rendererSource, /generateDungeonFloor/);
  assert.match(rendererSource, /import\(new URL\('\.\/render-core\.js', import\.meta\.url\)\)/);
  assert.match(rendererSource, /globalThis\.DungeonRenderCore/);
  assert.match(rendererSource, /core\.renderView/);
  assert.match(rendererSource, /core\.sampleEdgeStates/);
  assert.match(rendererSource, /core\.buildEdgeSpaces/);
  assert.match(rendererSource, /core\.buildBillboardTables/);
  assert.match(rendererSource, /core\.losVisible/);
  assert.match(rendererSource, /mirrorIndices/);
  assert.match(rendererSource, /drawBillboardsInto/);
  assert.match(rendererSource, /darkenPalette/);
  assert.match(rendererSource, /FRAME_STEP_MS/);
  assert.match(rendererSource, /door_texture/);
  assert.match(rendererSource, /drawPreviewMinimap/);
  assert.match(rendererSource, /readFileAsDataUrl/);
  assert.match(rendererSource, /cropAtlasTexture/);
  assert.match(rendererSource, /exportDungeonData/);
  assert.match(rendererSource, /SGDKアセット生成/);
  assert.match(rendererSource, /requestAnimationFrame/);
  assert.match(rendererSource, /MutationObserver/);
  assert.match(rendererSource, /registerCapability\('dungeon-game-editor'/);
  assert.match(rendererSource, /ArrowUp/);
  assert.match(rendererSource, /wall_texture/);
  assert.match(styleSource, /\.dge-view/);
  assert.match(styleSource, /\.dge-minimap/);
  assert.match(styleSource, /\.dge-panel\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styleSource, /\.dge-shell\s*\{[\s\S]*min-width:\s*840px/);
  assert.match(styleSource, /image-rendering:\s*pixelated/);
});

test('dungeon template starts with valid settings and plugin roles', () => {
  const templateDir = path.join(__dirname, '..', 'template', 'template_dungeon_game');
  const config = JSON.parse(fs.readFileSync(path.join(templateDir, 'project.json'), 'utf-8'));
  assert.equal(config.coreId, 'mega-drive');
  assert.equal(config.title, 'DUNGEON TEST');
  assert.equal(config.author, 'HOSSIE');
  assert.equal(config.serial, 'GM 00000000-02');
  assert.deepEqual(config.pluginRoles, {
    builder: 'dungeon-game-builder',
    testplay: 'standard-emulator',
  });
  const floorTemplate = JSON.parse(fs.readFileSync(path.join(templateDir, 'data', 'dungeon', 'floors', 'floor_001_template.json'), 'utf-8'));
  assert.equal(floorTemplate.asset_set_id, 'default');
  assert.equal(Object.hasOwn(floorTemplate, 'assets'), false);
  /* 階段セルはソリッドのため開始セルとは別に配置される */
  assert.equal(floorTemplate.cells[floorTemplate.start.y][floorTemplate.start.x].stairs, '');
  const templateCells = floorTemplate.cells.flat();
  assert.ok(templateCells.some((cell) => cell.stairs === 'up'));
  assert.ok(templateCells.some((cell) => cell.stairs === 'down'));
  const settings = JSON.parse(fs.readFileSync(path.join(templateDir, 'data', 'dungeon', 'settings.json'), 'utf-8'));
  assert.equal(settings.turn_frames, 8);
  assert.equal(settings.asset_sets[0].id, 'default');
  assert.match(settings.asset_sets[0].assets.door_texture, /#door$/);
  assert.equal(fs.existsSync(path.join(templateDir, 'res', 'dungeon', 'textures', 'dungeon_texture_atlas.png')), true);
});
