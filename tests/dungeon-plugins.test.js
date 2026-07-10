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
  assert.deepEqual(editor.mainApi.hooks, [
    'listDungeonFloors',
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
  const settings = { animation_frames: 3, turn_frames: 3 };
  const spaces = core.buildEdgeSpaces(settings);
  assert.ok(spaces.move.length > 20 && spaces.move.length <= core.MOVE_EDGE_LIMIT);
  assert.ok(spaces.turn.length > spaces.move.length && spaces.turn.length <= core.TURN_EDGE_LIMIT);

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
      const composed = core.assembleTiles(bake, core.composeFromFrame(bake, states), pool);
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
  assert.equal(generated.floor.cells[generated.floor.start.y][generated.floor.start.x].stairs, 'up');

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
  assert.match(listed.floors[0].assets.door_texture, /#door$/);

  const exported = plugin.exportDungeonData({}, context);
  assert.equal(exported.ok, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_data.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_data.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_patterns.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_patterns.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_tileset.png')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_bb_chest.png')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_bb_stairs_up.png')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_bb_stairs_down.png')), true);
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
  assert.match(patternHeader, /#define DUN_TILESET_TILE_COUNT \d+/);
  assert.match(patternHeader, /#define DUN_BB_CELL_COUNT \d+/);
  assert.match(patternHeader, /typedef struct \{ s8 dd; s8 dl; u8 face; \} DunEdgeDef;/);
  assert.match(patternHeader, /DunFrameTable/);
  assert.match(patternHeader, /extern const u16 dun_palette_dark\[16\];/);
  assert.doesNotMatch(patternHeader, /DUN_WALL_VIEW_COUNT/);
  assert.doesNotMatch(patternHeader, /DUN_VIEW_PATTERN_COLUMNS/);
  assert.doesNotMatch(patternHeader, /dungeon_view_pattern_count/);

  const patternSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_patterns.c'), 'utf-8');
  assert.match(patternSource, /const DunEdgeDef dun_edges_move\[/);
  assert.match(patternSource, /const DunEdgeDef dun_edges_turn_mirrored\[/);
  assert.match(patternSource, /const DunFrameTable dun_frame_static/);
  assert.match(patternSource, /const DunFrameTable dun_frames_fwd\[DUN_FWD_FRAMES\]/);
  assert.match(patternSource, /const DunFrameTable dun_frames_turn\[DUN_TURN_FRAMES\]/);
  assert.match(patternSource, /const DunBBCell dun_bb_cells\[/);
  assert.match(patternSource, /const DunBBPose dun_bb_turn\[DUN_TURN_FRAMES\]/);
  assert.match(patternSource, /const u16 dun_palette_dark\[16\]/);
  assert.doesNotMatch(patternSource, /dungeon_view_pattern_count/);

  const tileCount = Number(patternHeader.match(/#define DUN_TILESET_TILE_COUNT (\d+)/)?.[1] || 0);
  assert.ok(tileCount > 100);
  assert.equal(exported.patternTileCount, tileCount);
  assert.ok(exported.budget && exported.budget.tileCount === tileCount);
  assert.ok(Array.isArray(exported.warnings));

  /* ビュータイルセット: index0 = 黒 / ビルボード: index0 = マゼンタ */
  const tileset = readIndexedPng(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_tileset.png'));
  assert.deepEqual(Array.from(tileset.plte.subarray(0, 3)), [0, 0, 0]);
  const chestSheet = readIndexedPng(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_bb_chest.png'));
  assert.deepEqual(Array.from(chestSheet.plte.subarray(0, 3)), [255, 0, 255]);
  assert.equal(chestSheet.width, 48 * 8);
  assert.equal(chestSheet.height, 48);
  let chestPixels = 0;
  for (let i = 0; i < chestSheet.pixels.length; i++) {
    if (chestSheet.pixels[i] !== 0) chestPixels++;
  }
  assert.ok(chestPixels > 500);

  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  assert.match(resources, /PALETTE dungeon_view_palette "dungeon\/generated\/dungeon_view_tileset\.png"/);
  assert.match(resources, /TILESET dungeon_view_tileset "dungeon\/generated\/dungeon_view_tileset\.png" NONE ALL/);
  assert.match(resources, /PALETTE dungeon_bb_palette "dungeon\/generated\/dungeon_bb_chest\.png"/);
  assert.match(resources, /SPRITE dungeon_bb_chest "dungeon\/generated\/dungeon_bb_chest\.png" 6 6 NONE 0/);
  assert.match(resources, /SPRITE dungeon_bb_stairs_up /);
  assert.match(resources, /SPRITE dungeon_bb_stairs_down /);
  assert.doesNotMatch(resources, /TILEMAP /);

  /* 2 回目のエクスポートは焼き込みキャッシュが効く */
  const again = plugin.exportDungeonData({}, context);
  assert.equal(again.ok, true);
  assert.equal(again.cached, true);
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
  assert.match(generated.sourceCode, /pressedAction/);
  assert.match(generated.sourceCode, /performAction/);
  assert.match(generated.sourceCode, /DUN_playForward/);
  assert.match(generated.sourceCode, /DUN_playBackward/);
  assert.match(generated.sourceCode, /DUN_playTurn/);
  assert.match(generated.sourceCode, /DUN_setDark/);
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
  assert.match(viewSource, /dun_palette_dark/);
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
  assert.match(floorTemplate.assets.door_texture, /#door$/);
  const settings = JSON.parse(fs.readFileSync(path.join(templateDir, 'data', 'dungeon', 'settings.json'), 'utf-8'));
  assert.equal(settings.turn_frames, 8);
  assert.equal(fs.existsSync(path.join(templateDir, 'res', 'dungeon', 'textures', 'dungeon_texture_atlas.png')), true);
});
