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

  /*
   * poseForward は等速 (線形) 補間: 押しっぱなし連続移動でセル境界ごとに
   * 減速→再加速する"もたつき"を防ぐため、easeSmooth (smoothstep) をやめた。
   * 端点 (t=0, t=1) は smoothstep でも一致するため中間点で検証する。
   */
  const smoothstep = (x) => x * x * (3 - 2 * x);
  assert.equal(core.poseForward(0).d, -core.VIEW_CAMERA_BACKSTEP);
  assert.ok(Math.abs(core.poseForward(1).d - (-core.VIEW_CAMERA_BACKSTEP + 1)) < 1e-9);
  const forwardQuarter = core.poseForward(0.25);
  assert.ok(Math.abs(forwardQuarter.d - (-core.VIEW_CAMERA_BACKSTEP + 0.25)) < 1e-9, 'poseForward(0.25) should be linear in t');
  assert.ok(
    Math.abs(forwardQuarter.d - (-core.VIEW_CAMERA_BACKSTEP + smoothstep(0.25))) > 0.05,
    'poseForward should no longer match the old easeSmooth curve away from the midpoint',
  );
  /* poseTurnRight は今回のスコープ外: easeSmooth のままであることを確認する */
  const turnQuarterAngle = core.poseTurnRight(0.25).angle;
  assert.ok(Math.abs(turnQuarterAngle - smoothstep(0.25) * (Math.PI / 2)) < 1e-9, 'poseTurnRight should keep easeSmooth');

  /*
   * 階段セルは宝箱と同様に通行可能 (ソリッドではない): 周囲の開いた面は
   * 壁として描かれず、視線も移動も遮らない。到着位置は階段セルそのもの
   * (壁で塞がれていない最初の方角を向く)。
   */
  const blank = () => ({ walls: 0, doors: 0, one_way: 0, dark: false, event: '', stairs: '' });
  const mkFloor = () => ({ width: 5, height: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, blank)) });
  const stairsFloor = mkFloor();
  stairsFloor.cells[1][2].stairs = 'up';
  assert.equal(core.cellIsSolid(stairsFloor.cells[1][2]), false);
  assert.equal(core.edgeStateBetween(stairsFloor, 2, 2, 0), core.EDGE_STATE_OPEN);
  assert.equal(core.rawEdgeState(stairsFloor, 2, 2, 0), core.EDGE_STATE_OPEN);
  assert.deepEqual(core.stairsArrival(stairsFloor, 'up'), { x: 2, y: 1, dir: 0 });

  /* LOS: 壁越し・角越しの宝箱は見えない。階段セルはもはやソリッドでないため視線を遮らない */
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
  assert.equal(core.losVisible(stairsFloor, 2, 3, 0, 3, 0), true);
  assert.equal(core.losVisible(stairsFloor, 2, 3, 0, 2, 0), true);

  /*
   * LOS 回帰: 視線が格子の角を正確に通過する斜め遠方 (dd と dl が等しい) の
   * 判定で、迂回経路の片側だけが開いていれば旧実装は可視と判定していた。
   * しかしレンダラは開いていない側の壁も実際に描画するため、カメラ直近の
   * 壁越しに宝箱/階段が透けて見えるバグになっていた
   * (カメラのすぐ右の壁と、南から回り込む迂回路だけが開いている場合)。
   * 両方の迂回路が開いている場合のみ可視とする。
   */
  const partialCornerFloor = mkFloor();
  assert.equal(core.losVisible(partialCornerFloor, 2, 0, 2, 2, 2), true); /* 迂回路が両方開いていれば可視 */
  partialCornerFloor.cells[0][2].walls |= 8; /* カメラ自身のセル (2,0) の西側 (進行方向基準で右) を壁にする */
  assert.equal(core.losVisible(partialCornerFloor, 2, 0, 2, 2, 2), false); /* 片側だけ開いていても遮蔽 */

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

  /* 足元 (dd=0, dl=0) のビルボードは常に最至近バケットへ固定表示され、pose に依存しない */
  assert.ok(core.buildBillboardCells().some((cell) => cell.dd === 0 && cell.dl === 0));
  const underfoot = core.billboardPose(frames.staticPose, { dd: 0, dl: 0 });
  assert.equal(underfoot.frame, 0);
  assert.equal(underfoot.x, Math.round(core.VIEW_W / 2) - (core.BB_FRAME_SIZE / 2));
  assert.ok(underfoot.y > 0 && underfoot.y + core.BB_FRAME_SIZE < core.VIEW_H);
  assert.deepEqual(underfoot, core.billboardPose(frames.fwdPoses[0], { dd: 0, dl: 0 }));

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
  /* placeStairs は開始セルを行き止まり候補から除外するため、階段は開始セルには置かれない */
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
  assert.equal(Object.hasOwn(generatedSet.paths, 'billboards'), false);
  assert.ok(exported.common);
  assert.equal(exported.common.key, 'common');
  assert.equal(fs.existsSync(path.join(projectDir, 'res', exported.common.paths.billboards.chest)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', exported.common.paths.billboards.stairs_up)), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', exported.common.paths.billboards.stairs_down)), true);
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
  /* move_speed_vblanks 未設定は既定の 0 (追加待ちなし = 最速) */
  assert.match(patternHeader, /#define DUN_MOVE_SPEED_VBLANKS_DEFAULT 0/);
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
  /* 宝箱/階段/ビルボードpaletteはDunViewSetから外れ、グローバルsymbolとして生成される */
  assert.doesNotMatch(patternHeader, /const SpriteDefinition \*chest;/);
  assert.doesNotMatch(patternHeader, /const SpriteDefinition \*stairs_up;/);
  assert.doesNotMatch(patternHeader, /const SpriteDefinition \*stairs_down;/);
  assert.doesNotMatch(patternHeader, /const Palette \*billboard_palette;/);
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
  const chestSheet = readIndexedPng(path.join(projectDir, 'res', exported.common.paths.billboards.chest));
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
  /* 宝箱/階段ビルボードは素材セットに依らずプロジェクトで1回だけ生成される (dun_common_bb_*) */
  assert.match(resources, /PALETTE dun_common_bb_palette /);
  assert.match(resources, /SPRITE dun_common_bb_chest .* 6 6 NONE 0/);
  assert.match(resources, /SPRITE dun_common_bb_stairs_up /);
  assert.match(resources, /SPRITE dun_common_bb_stairs_down /);
  assert.equal((resources.match(/SPRITE dun_common_bb_chest /g) || []).length, 1);
  assert.doesNotMatch(resources, /TILEMAP /);

  /* 2 回目のエクスポートは焼き込みキャッシュが効く */
  const again = plugin.exportDungeonData({}, context);
  assert.equal(again.ok, true);
  assert.equal(again.cached, true);
});

test('dungeon move_speed_vblanks and frame-count settings round-trip with bounds and skip the bake cache', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-move-speed-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const context = { projectDir, logger: logger() };
  writeFastSettings(projectDir);

  /* normalizeSettings: 既定値・範囲クランプ (move_speed_vblanks は 0-60, フレーム数は 2-8) */
  assert.equal(service.normalizeSettings({}).move_speed_vblanks, 0);
  assert.equal(service.normalizeSettings({ move_speed_vblanks: -5 }).move_speed_vblanks, 0);
  assert.equal(service.normalizeSettings({ move_speed_vblanks: 999 }).move_speed_vblanks, 60);
  assert.equal(service.normalizeSettings({ move_speed_vblanks: 12.9 }).move_speed_vblanks, 12);
  assert.equal(service.normalizeSettings({ animation_frames: 1 }).animation_frames, 2);
  assert.equal(service.normalizeSettings({ animation_frames: 99 }).animation_frames, 8);
  assert.equal(service.normalizeSettings({ turn_frames: 1 }).turn_frames, 2);
  assert.equal(service.normalizeSettings({ turn_frames: 99 }).turn_frames, 8);

  const generated = plugin.generateDungeonFloor({ width: 10, height: 10, name: 'Speed Test' }, context);
  assert.equal(generated.ok, true);

  const listed = plugin.listDungeonSettings({}, context);
  assert.equal(listed.ok, true);
  assert.equal(listed.settings.move_speed_vblanks, 0);

  const firstExport = plugin.exportDungeonData({}, context);
  assert.equal(firstExport.ok, true);
  /* generateDungeonFloor が既にベイクしているので、無変更のこの再エクスポートはキャッシュが効く */
  assert.equal(firstExport.cached, true);
  let patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_MOVE_SPEED_VBLANKS_DEFAULT 0/);

  /*
   * move_speed_vblanks だけを変更する: 壁決定木・ビルボード座標など焼き込み
   * 結果には影響しないランタイムのペーシング値なので computeBakeHash 対象外
   * (キャッシュは無効化されない) だが、生成ヘッダの既定値は毎回最新化される。
   */
  const saved = plugin.saveDungeonSettings({ settings: { ...listed.settings, move_speed_vblanks: 5 } }, context);
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.move_speed_vblanks, 5);
  assert.equal(saved.export.ok, true);
  assert.equal(saved.export.cached, true, 'move_speed_vblanks alone should not invalidate the wall/billboard bake cache');
  patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_MOVE_SPEED_VBLANKS_DEFAULT 5/);

  /* 一方、animation_frames の変更は従来どおり焼き込みキャッシュを無効化する */
  const savedFrames = plugin.saveDungeonSettings({ settings: { ...saved.settings, animation_frames: 4 } }, context);
  assert.equal(savedFrames.ok, true);
  assert.equal(savedFrames.export.cached, false);

  /* ビルダー側: dungeon_view.c/.h にランタイム変数・セッタ・起動時初期化が生成される */
  const builder = require('../plugins/dungeon-game-builder');
  const builderResult = builder.generateSource([], context);
  assert.equal(builderResult.ok, true);
  const viewSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_view.c'), 'utf-8');
  assert.match(viewSource, /static u8 dun_extra_step_vblanks;/);
  assert.match(viewSource, /dun_extra_step_vblanks = DUN_MOVE_SPEED_VBLANKS_DEFAULT;/);
  assert.match(viewSource, /void DUN_setMoveSpeed\(u8 extra_vblanks\)/);
  assert.match(viewSource, /dun_extra_step_vblanks = extra_vblanks;/);
  assert.match(viewSource, /for \(extra = 0; extra < dun_extra_step_vblanks; extra\+\+\) SYS_doVBlankProcess\(\);/);
  const viewHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_view.h'), 'utf-8');
  assert.match(viewHeader, /void DUN_setMoveSpeed\(u8 extra_vblanks\);/);

  /*
   * ミニマップ自動マッピング: 実機は VISITED (自分が歩いたセルのみ) を既定モードとし、
   * FULL (全体表示) はマップ入手アイテム等ゲーム側から DUN_setMinimapMode で切替可能。
   * 踏破ビットフィールドは main.c 側 (フロア数・移動ロジックを既に把握) が所有し、
   * dungeon_view.c へは現在フロア分のポインタだけを渡す。
   */
  assert.match(viewHeader, /#define DUN_MINIMAP_VISITED 0/);
  assert.match(viewHeader, /#define DUN_MINIMAP_FULL\s+1/);
  assert.match(viewHeader, /void DUN_setMinimapMode\(u8 mode\);/);
  assert.match(viewHeader, /void DUN_drawMinimap\(const DungeonFloorData \*floor, const u8 \*visited, u8 x, u8 y, u8 dir\);/);
  assert.match(viewSource, /static u8 dun_minimap_mode;/);
  assert.match(viewSource, /dun_minimap_mode = DUN_MINIMAP_VISITED;/);
  assert.match(viewSource, /void DUN_setMinimapMode\(u8 mode\)\s*\{\s*dun_minimap_mode = mode;/);
  assert.match(viewSource, /static bool mmIsVisited\(const DungeonFloorData \*floor, const u8 \*visited, s16 x, s16 y\)/);
  assert.match(viewSource, /void DUN_drawMinimap\(const DungeonFloorData \*floor, const u8 \*visited, u8 px, u8 py, u8 dir\)/);
  /* VISITED モードでは自セル/隣接セルどちらかの訪問状態でセル塗り・壁/扉の描画を切り替える */
  assert.match(viewSource, /const bool self_visited = \(dun_minimap_mode == DUN_MINIMAP_FULL\) \|\| mmIsVisited\(floor, visited, x, y\);/);
  assert.match(viewSource, /self_visited \|\| mmIsVisited\(floor, visited, x, y - 1\)/);
  assert.match(viewSource, /self_visited \|\| mmIsVisited\(floor, visited, x - 1, y\)/);

  const mainSource = builderResult.sourceCode;
  assert.match(mainSource, /static u8 dun_visited\[DUNGEON_FLOOR_COUNT\]\[DUN_VISITED_BYTES\];/);
  assert.match(mainSource, /static void markVisited\(void\)/);
  /* ゲーム開始・移動成功・階段到着のたびに踏破を記録する */
  assert.match(mainSource, /player_y = \(u8\)\(player_y \+ dir_dy\[player_dir\]\);\s*markVisited\(\);/);
  assert.match(mainSource, /player_y = \(u8\)\(player_y \+ dir_dy\[dir\]\);\s*markVisited\(\);/);
  assert.match(mainSource, /player_dir = floor->start_dir & 3;\s*markVisited\(\);/);
  assert.match(mainSource, /player_dir = adir;\s*markVisited\(\);/);
  assert.match(mainSource, /DUN_drawMinimap\(floor, dun_visited\[floor_index\], player_x, player_y, player_dir\);/);
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
  /* 宝箱/階段は素材セットが2件あっても共通ビルボードとして1回だけ生成される (重複排除) */
  assert.equal((resources.match(/SPRITE dun_common_bb_chest /g) || []).length, 1);
  assert.equal((resources.match(/PALETTE dun_common_bb_palette /g) || []).length, 1);
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
  /* 素材セット固有の壁テクスチャ変更は共通ビルボード焼き込みを無効化しない */
  assert.equal(changed.common.cached, true);

  const nextSettings2 = JSON.parse(fs.readFileSync(path.join(dungeonDir, 'settings.json'), 'utf-8'));
  nextSettings2.common_assets.chest_texture = 'dungeon/textures/legacy.png#chest';
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), `${JSON.stringify(nextSettings2, null, 2)}\n`);
  const changedCommon = plugin.exportDungeonData({}, { projectDir, logger: logger() });
  assert.equal(changedCommon.cached, false);
  assert.equal(changedCommon.common.cached, false);
  /* 共通素材の変更は各素材セットの壁/扉/床/天井の焼き込みキャッシュを無効化しない */
  assert.equal(changedCommon.assetSets.find((set) => set.id === migratedFloor.asset_set_id).cached, true);
  assert.equal(changedCommon.assetSets.find((set) => set.id === 'lava').cached, true);
});

test('dungeon common_assets migrates from legacy per-set chest/stairs values without throwing', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-common-migrate-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const dungeonDir = path.join(projectDir, 'data', 'dungeon');
  fs.mkdirSync(dungeonDir, { recursive: true });

  /* v1.1 以前の保存形式: common_assets が無く、asset_sets[].assets に宝箱/階段が残っている */
  const legacySettings = {
    animation_frames: 3,
    turn_frames: 3,
    asset_sets: [
      {
        id: 'default',
        name: 'Default',
        assets: {
          ...service.DEFAULT_ASSETS,
          chest_texture: 'dungeon/textures/legacy-set/chest.png#chest',
          stairs_up_texture: 'dungeon/textures/legacy-set/stairs_up.png#stairs_up',
        },
      },
    ],
  };
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), JSON.stringify(legacySettings));

  const normalized = service.normalizeSettings(legacySettings);
  assert.equal(normalized.common_assets.chest_texture, 'dungeon/textures/legacy-set/chest.png#chest');
  assert.equal(normalized.common_assets.stairs_up_texture, 'dungeon/textures/legacy-set/stairs_up.png#stairs_up');
  /* 差分のなかった項目は既定値へフォールバックする */
  assert.equal(normalized.common_assets.stairs_down_texture, service.DEFAULT_ASSETS.stairs_down_texture);
  /* 素材セット側からは宝箱/階段キーが失われる (壁焼き込み4種のみ残る) */
  assert.equal(Object.hasOwn(normalized.asset_sets[0].assets, 'chest_texture'), false);
  assert.deepEqual(Object.keys(normalized.asset_sets[0].assets).sort(), service.SET_ASSET_KEYS.slice().sort());

  assert.doesNotThrow(() => {
    const plugin = require('../plugins/dungeon-game-editor');
    const listed = plugin.listDungeonFloors({}, { projectDir, logger: logger() });
    assert.equal(listed.ok, true);
    assert.equal(listed.settings.common_assets.chest_texture, 'dungeon/textures/legacy-set/chest.png#chest');
  });
});

test('dungeon common_assets migrates from an even older floor-inline legacy assets blob (pre-asset_sets)', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-common-floor-migrate-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const plugin = require('../plugins/dungeon-game-editor');
  const dungeonDir = path.join(projectDir, 'data', 'dungeon');
  const floorsDir = path.join(dungeonDir, 'floors');
  fs.mkdirSync(floorsDir, { recursive: true });

  /* asset_sets 自体が存在しなかった頃の形式: フロアが直接 inline assets を持つ */
  const legacyAssets = { ...service.DEFAULT_ASSETS, chest_texture: 'dungeon/textures/legacy-floor/chest.png#chest' };
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
  /* settings.json には asset_sets も common_assets も存在しない */
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), JSON.stringify({ animation_frames: 3, turn_frames: 3 }));

  const listed = plugin.listDungeonFloors({}, { projectDir, logger: logger() });
  assert.equal(listed.ok, true);
  /* asset_sets 由来のスキャンでは既定値しか見つからないため、フロアの inline 値が拾われる */
  assert.equal(listed.settings.common_assets.chest_texture, 'dungeon/textures/legacy-floor/chest.png#chest');
  /* 差分のなかったキーは既定値のまま */
  assert.equal(listed.settings.common_assets.stairs_up_texture, service.DEFAULT_ASSETS.stairs_up_texture);
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
  /* common_assets 未設定は宝箱/階段が未設定として拒否される (素材セット数・重複チェックより後) */
  assert.throws(
    () => service.validateProjectState([], { asset_sets: [service.DEFAULT_ASSET_SET] }),
    /共通素材/,
  );
  assert.throws(
    () => service.validateProjectState(
      [{ name: 'Broken', asset_set_id: 'missing' }],
      { asset_sets: [service.DEFAULT_ASSET_SET], common_assets: service.DEFAULT_SETTINGS.common_assets },
    ),
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
  /* 階段は「バンプで確認」ではなく前進/後退で足を踏み入れた瞬間に自動でフロア遷移する */
  assert.doesNotMatch(generated.sourceCode, /DUN_ACTION_STAIRS/);
  assert.match(generated.sourceCode, /goStairs/);
  assert.match(generated.sourceCode, /stairsFlagsAt/);
  assert.match(generated.sourceCode, /const u8 stairs = stairsFlagsAt\(floor, player_x, player_y\);/);
  assert.match(generated.sourceCode, /if \(stairs && goStairs\(stairs\)\) return;/);
  assert.doesNotMatch(generated.sourceCode, /if \(stairsFlagsAt\(floor, nx, ny\)\) return FALSE;/);
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

  const viewHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_view.h'), 'utf-8');
  assert.match(viewHeader, /void DUN_setMoveSpeed\(u8 extra_vblanks\);/);

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
  /* 移動速度 (パワーアップ等でランタイム変更可能なペーシング) 用のフック */
  assert.match(viewSource, /static u8 dun_extra_step_vblanks;/);
  assert.match(viewSource, /dun_extra_step_vblanks = DUN_MOVE_SPEED_VBLANKS_DEFAULT;/);
  assert.match(viewSource, /void DUN_setMoveSpeed\(u8 extra_vblanks\)\s*\{\s*dun_extra_step_vblanks = extra_vblanks;/);
  assert.match(viewSource, /for \(extra = 0; extra < dun_extra_step_vblanks; extra\+\+\) SYS_doVBlankProcess\(\);/);
  /* 必須の2vblank DMA転送 (SYS_doVBlankProcess を2回) はそのまま残っている */
  assert.equal((viewSource.match(/SYS_doVBlankProcess\(\);/g) || []).length >= 3, true);
  assert.match(viewSource, /dun_mm_palette/);
  assert.match(viewSource, /active_view_set->dark_palette/);
  assert.match(viewSource, /active_view_set->view_tileset/);
  assert.match(viewSource, /active_view_set->background_tileset/);
  /* 宝箱/階段/ビルボードpaletteは素材セット非依存のグローバル資産へ移行済み */
  assert.doesNotMatch(viewSource, /active_view_set->chest/);
  assert.doesNotMatch(viewSource, /active_view_set->stairs_up/);
  assert.doesNotMatch(viewSource, /active_view_set->stairs_down/);
  assert.doesNotMatch(viewSource, /active_view_set->billboard_palette/);
  assert.match(viewSource, /&dun_common_bb_chest/);
  assert.match(viewSource, /&dun_common_bb_stairs_up/);
  assert.match(viewSource, /&dun_common_bb_stairs_down/);
  assert.match(viewSource, /dun_common_bb_palette\.data/);
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
  /* プレビューのフレーム間隔は settings.move_speed_vblanks から導出する (実機起動時の既定テンポと一致させる) */
  assert.match(rendererSource, /function frameStepMs\(\)/);
  assert.match(rendererSource, /DUN_ANIMATION_STEP_VBLANKS/);
  assert.match(rendererSource, /state\.settings\?\.move_speed_vblanks/);
  assert.doesNotMatch(rendererSource, /FRAME_STEP_MS/);
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
  /* 宝箱/階段はプロジェクト共通の「共通素材」セクションとして分離表示される */
  assert.match(rendererSource, /共通素材/);
  assert.match(rendererSource, /COMMON_ASSET_KEYS/);
  assert.match(rendererSource, /SET_ASSET_KEYS/);
  assert.match(rendererSource, /renderCommonAssetCard/);
  /* 階段セルは宝箱と同様に通行可能 (ソリッド判定でブロックしない) */
  assert.doesNotMatch(rendererSource, /core\.cellIsSolid/);
  assert.match(rendererSource, /core\.stairsArrival/);
  /* 前進/後退で階段セルへ着地したら、アニメーション完了後に自動でフロア遷移する */
  assert.match(rendererSource, /arrivesOnStairs/);
  /* 設定タブ: アニメーションフレーム数・移動速度の既定値を編集するUI (Part 2/3) */
  assert.match(rendererSource, /data-tab="settings"/);
  assert.match(rendererSource, /data-panel="settings"/);
  assert.match(rendererSource, /function renderSettings\(\)/);
  assert.match(rendererSource, /data-settings-field="animation_frames"/);
  assert.match(rendererSource, /data-settings-field="turn_frames"/);
  assert.match(rendererSource, /data-settings-field="move_speed_vblanks"/);
  assert.match(rendererSource, /saveDungeonSettings/);
  assert.match(rendererSource, /action === 'settings-save'/);
  assert.match(styleSource, /\.dge-view/);
  assert.match(styleSource, /\.dge-minimap/);
  assert.match(styleSource, /\.dge-panel\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styleSource, /\.dge-shell\s*\{[\s\S]*min-width:\s*840px/);
  assert.match(styleSource, /image-rendering:\s*pixelated/);
  assert.match(styleSource, /\.dge-settings\s*\{/);

  /*
   * ミニマップ自動マッピング (プレビュー側): 実機 DUN_MINIMAP_VISITED と対になる
   * 踏破済みセル追跡・表示モードトグル。フロアごとに Set を保持し、フロア切替では
   * 保持したままセル編集/データ再読込でリセットする。
   */
  assert.match(rendererSource, /visitedByFloor: new Map\(\)/);
  assert.match(rendererSource, /minimapMode: 'visited'/);
  assert.match(rendererSource, /function markPreviewVisited\(floor, x, y\)/);
  assert.match(rendererSource, /function isPreviewVisited\(floorId, x, y\)/);
  assert.match(rendererSource, /function resetVisitedForFloor\(floorId\)/);
  assert.match(rendererSource, /function resetAllVisited\(\)/);
  assert.match(rendererSource, /function shouldDrawMinimapCell\(mode, floorId, x, y\)/);
  assert.match(rendererSource, /function shouldDrawMinimapEdge\(mode, floorId, x, y, nx, ny, hasNeighbor\)/);
  /* 実機と同じ3箇所 (開始/移動完了/階段到着) で記録する */
  assert.match(rendererSource, /markPreviewVisited\(state\.current, state\.preview\.x, state\.preview\.y\)/);
  assert.match(rendererSource, /markPreviewVisited\(target, state\.preview\.x, state\.preview\.y\)/);
  /* マップ編集・実サイズ変更でそのフロアの踏破記録をリセットする */
  assert.match(rendererSource, /resetVisitedForFloor\(floor\.id\)/);
  assert.match(rendererSource, /resetVisitedForFloor\(state\.current\.id\)/);
  /* データ再読込・巻き戻しは新しいプレビューセッションとして全リセットする */
  assert.match(rendererSource, /resetAllVisited\(\);[\s\S]{0,80}state\.current = state\.floors\.find/);
  /* プレビュー内ミニマップのモード切替トグル (フロア編集タブとは別のグローバル設定タブではない) */
  assert.match(rendererSource, /data-action="minimap-mode"/);
  assert.match(rendererSource, /function renderMinimapModeButton\(\)/);
  assert.match(rendererSource, /action === 'minimap-mode'/);
  assert.match(styleSource, /\.dge-minimap-mode/);
  assert.match(styleSource, /\.dge-minimap-wrap/);
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
  /* テンプレートの開始セルには階段が置かれていない (階段は通行可能だがレベルデザイン上、開始セルとは別に配置) */
  assert.equal(floorTemplate.cells[floorTemplate.start.y][floorTemplate.start.x].stairs, '');
  const templateCells = floorTemplate.cells.flat();
  assert.ok(templateCells.some((cell) => cell.stairs === 'up'));
  assert.ok(templateCells.some((cell) => cell.stairs === 'down'));
  const settings = JSON.parse(fs.readFileSync(path.join(templateDir, 'data', 'dungeon', 'settings.json'), 'utf-8'));
  assert.equal(settings.turn_frames, 8);
  assert.equal(settings.asset_sets[0].id, 'default');
  assert.match(settings.asset_sets[0].assets.door_texture, /#door$/);
  assert.equal(Object.hasOwn(settings.asset_sets[0].assets, 'chest_texture'), false);
  assert.match(settings.common_assets.chest_texture, /#chest$/);
  assert.match(settings.common_assets.stairs_up_texture, /#stairs_up$/);
  assert.match(settings.common_assets.stairs_down_texture, /#stairs_down$/);
  assert.equal(fs.existsSync(path.join(templateDir, 'res', 'dungeon', 'textures', 'dungeon_texture_atlas.png')), true);
});
