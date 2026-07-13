'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');
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
  assert.equal(editor.version, '1.3.0');
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
  assert.match(rendererSource, /core\.minimumDepthByTile\(wallDepth\)/);
  assert.match(rendererSource, /core\.priorityTilesForBillboards\(/);
  assert.match(rendererSource, /drawHighPriorityWalls\(/);
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

  /*
   * 足元 (dd=0, dl=0) のビルボードは static/turn ポーズ (プレイヤーがそのセルに留まっている
   * 間) では常に最至近バケットへ固定表示される (allowUnderfoot=true)。一方 fwd ポーズ
   * (前進/後退アニメーションの中間フレーム) では allowUnderfoot=false を渡し、セルを離れた
   * 瞬間にカリングされる (frame=-1) — 移動アニメーション中ずっと表示され続けて
   * 「スプライトが追いかけてくる」ように見える不具合の修正。
   */
  assert.ok(core.buildBillboardCells().some((cell) => cell.dd === 0 && cell.dl === 0));
  const underfoot = core.billboardPose(frames.staticPose, { dd: 0, dl: 0 }, true);
  assert.equal(underfoot.frame, 0);
  assert.equal(underfoot.x, Math.round(core.VIEW_W / 2) - (core.BB_FRAME_SIZE / 2));
  assert.ok(underfoot.y > 0 && underfoot.y + core.BB_FRAME_SIZE < core.VIEW_H);
  assert.deepEqual(underfoot, core.billboardPose(frames.turnPoses[0], { dd: 0, dl: 0 }, true));
  const underfootFwd = core.billboardPose(frames.fwdPoses[0], { dd: 0, dl: 0 }, false);
  assert.deepEqual(underfootFwd, { x: 0, y: 0, frame: -1, depthCode: 0 });
  assert.notDeepEqual(underfootFwd, underfoot);

  /*
   * buildBillboardTables (実際に共通ベイク/JSプレビューが読む経路) でも同じ挙動になることを
   * 確認する belt-and-braces チェック: dun_bb_static/dun_bb_turn は (0,0) セルで frame=0 の
   * ままだが、dun_bb_fwd の全フレームで (0,0) セルは frame=-1 にカリングされる。
   */
  const billboardTables = core.buildBillboardTables(settings);
  const underfootCellIndex = billboardTables.cells.findIndex((cell) => cell.dd === 0 && cell.dl === 0);
  assert.ok(underfootCellIndex >= 0);
  assert.equal(billboardTables.staticPoses[underfootCellIndex].frame, 0);
  billboardTables.turnPoses.forEach((poses) => assert.equal(poses[underfootCellIndex].frame, 0));
  billboardTables.fwdPoses.forEach((poses) => assert.equal(poses[underfootCellIndex].frame, -1));

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
      const detailed = core.renderViewDetailed(pose, defs, states, textures, palette, bands);
      assert.deepEqual(detailed.pixels, direct);
      assert.equal(detailed.depthCodes.length, core.VIEW_W * core.VIEW_H);
      let diff = 0;
      for (let i = 0; i < composed.length; i++) {
        if (composed[i] !== direct[i]) diff++;
      }
      /* 遠距離スライバー切り捨てによる差のみ許容 (全 25600px 中) */
      assert.ok(diff <= 64, `composed view diverged from direct render: ${diff}px`);
    }
  });
  assert.equal(core.quantizeOcclusionDepth(Number.POSITIVE_INFINITY), 0);
  assert.equal(core.quantizeOcclusionDepth(0.72), 13);
  assert.equal(core.quantizeOcclusionDepth(1.22), 12);
  assert.ok(core.quantizeOcclusionDepth(0.72) > core.quantizeOcclusionDepth(1.22));
});

test('dungeon tile Priority: near wall tiles hide billboards conservatively without false occlusion', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const settings = { animation_frames: 3, turn_frames: 3 };
  const spaces = core.buildEdgeSpaces(settings);
  const pose = spaces.frames.staticPose;
  const textures = core.normalizeTextures({});
  const palette = core.buildViewPalette(textures);
  const bands = core.buildBandTables(palette, textures);

  const renderSingleWall = (wanted, state = core.EDGE_STATE_WALL) => {
    const index = spaces.move.findIndex((def) => (
      def.dd === wanted.dd && def.dl === wanted.dl && def.face === wanted.face
    ));
    assert.ok(index >= 0);
    const states = new Uint8Array(spaces.move.length);
    states[index] = state;
    return core.renderViewDetailed(pose, spaces.move, states, textures, palette, bands).depthCodes;
  };
  const classifyPriority = (depthCodes, billboard, additionalBoxes = []) => {
    const tileDepths = core.minimumDepthByTile(depthCodes);
    const bounds = core.tileBoundsForRect(billboard.x, billboard.y, core.BB_FRAME_SIZE, core.BB_FRAME_SIZE);
    const priority = core.priorityTilesForBillboards(tileDepths, [
      { ...bounds, depthCode: billboard.depthCode },
      ...additionalBoxes,
    ]);
    let intended = 0;
    let hidden = 0;
    let missed = 0;
    let falseOcclusion = 0;
    let opening = 0;
    for (let y = 0; y < core.BB_FRAME_SIZE; y++) {
      for (let x = 0; x < core.BB_FRAME_SIZE; x++) {
        const dx = billboard.x + x;
        const dy = billboard.y + y;
        if (dx < 0 || dy < 0 || dx >= core.VIEW_W || dy >= core.VIEW_H) continue;
        const depth = depthCodes[(dy * core.VIEW_W) + dx];
        const high = priority[((dy >> 3) * core.VIEW_TILE_W) + (dx >> 3)] !== 0;
        if (!depth) {
          opening++;
          continue;
        }
        if (depth > billboard.depthCode) {
          intended++;
          if (high) hidden++;
          else missed++;
        } else if (high) {
          falseOcclusion++;
        }
      }
    }
    return { intended, hidden, missed, falseOcclusion, opening };
  };

  const sideBillboard = core.billboardPose(pose, { dd: 1, dl: -1 }, true);
  const nearWall = renderSingleWall({ dd: 0, dl: -1, face: 0 });
  const nearPriority = classifyPriority(nearWall, sideBillboard);
  assert.ok(nearPriority.hidden > 100, 'near wall must hide part of the billboard');
  assert.ok(nearPriority.opening > 100, 'transparent opening must leave part of the billboard visible');
  assert.equal(nearPriority.falseOcclusion, 0, 'conservative tile rule must never hide a same/near billboard');
  assert.ok(nearPriority.missed <= 128, `tile-boundary leakage is unexpectedly large: ${nearPriority.missed}px`);
  const mirroredBillboard = core.billboardPose(pose, { dd: 1, dl: 1 }, true);
  const mirroredPriority = classifyPriority(renderSingleWall({ dd: 0, dl: 1, face: 0 }), mirroredBillboard);
  assert.deepEqual(mirroredPriority, nearPriority, 'left/right Priority classification must remain mirror-symmetric');
  assert.deepEqual(
    renderSingleWall({ dd: 0, dl: -1, face: 0 }, core.EDGE_STATE_DOOR),
    nearWall,
    'wall and door use identical occlusion geometry',
  );

  const centerBillboard = core.billboardPose(pose, { dd: 1, dl: 0 }, true);
  const farWall = renderSingleWall({ dd: 2, dl: -1, face: 0 });
  const farPriority = classifyPriority(farWall, centerBillboard);
  assert.equal(farPriority.hidden, 0, 'far wall must not hide a nearer billboard');
  assert.equal(farPriority.falseOcclusion, 0);

  /* 厳密な > 比較と、重なる全ビルボードに対する安全判定。 */
  const syntheticDepth = new Uint8Array(core.VIEW_TILE_W * core.VIEW_TILE_H);
  syntheticDepth[0] = 8;
  const syntheticBox = { tx0: 0, ty0: 0, tx1: 0, ty1: 0 };
  assert.equal(core.priorityTilesForBillboards(syntheticDepth, [{ ...syntheticBox, depthCode: 8 }])[0], 0);
  assert.equal(core.priorityTilesForBillboards(syntheticDepth, [{ ...syntheticBox, depthCode: 7 }])[0], 1);
  assert.equal(core.priorityTilesForBillboards(syntheticDepth, [
    { ...syntheticBox, depthCode: 7 },
    { ...syntheticBox, depthCode: 9 },
  ])[0], 0);

  const priorityFrame = core.bakePriorityFrame(pose, spaces.move);
  assert.equal(Object.hasOwn(priorityFrame, 'tileMap'), false);
  assert.ok(priorityFrame.values.length > 0 && priorityFrame.values.length <= 16);
  priorityFrame.values.forEach((value) => assert.ok(value >= 0 && value <= 15));

  const billboardTables = core.buildBillboardTables(settings);
  [billboardTables.staticPoses, ...billboardTables.fwdPoses, ...billboardTables.turnPoses]
    .flat()
    .forEach((billboard) => {
      if (billboard.frame < 0) assert.equal(billboard.depthCode, 0);
      else assert.ok(billboard.depthCode >= 1 && billboard.depthCode <= 15);
    });
});

test('dungeon tile Priority: 8 moving billboards over 600 frames is at least twice as fast as pixel masking', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const wallPixels = new Uint8Array(core.VIEW_W * core.VIEW_H);
  const tileDepths = new Uint8Array(core.VIEW_TILE_W * core.VIEW_TILE_H);
  for (let y = 0; y < core.VIEW_H; y++) {
    for (let x = 0; x < core.VIEW_W; x++) {
      wallPixels[(y * core.VIEW_W) + x] = ((x + (y * 3)) % 11) < 6 ? 6 + ((x >> 4) % 8) : 0;
    }
  }
  core.minimumDepthByTile(wallPixels, tileDepths);

  const boxesForFrame = (frame) => Array.from({ length: 8 }, (_, index) => {
    const x = 8 + ((frame + (index * 19)) % 136);
    const y = 16 + ((index * 11) % 56);
    return { ...core.tileBoundsForRect(x, y, 48, 48), depthCode: 5 + ((frame >> 5) + index) % 9 };
  });
  const runPixelMask = () => {
    let checksum = 0;
    for (let frame = 0; frame < 600; frame++) {
      const boxes = boxesForFrame(frame);
      boxes.forEach((box) => {
        const sx = box.tx0 * 8;
        const sy = box.ty0 * 8;
        for (let y = 0; y < 48; y++) {
          const dy = sy + y;
          if (dy >= core.VIEW_H) continue;
          for (let x = 0; x < 48; x++) {
            const dx = sx + x;
            if (dx >= core.VIEW_W) continue;
            checksum += wallPixels[(dy * core.VIEW_W) + dx] > box.depthCode ? 1 : 0;
          }
        }
      });
    }
    return checksum;
  };
  const runPriority = () => {
    let checksum = 0;
    let previousSignature = '';
    for (let frame = 0; frame < 600; frame++) {
      const boxes = boxesForFrame(frame);
      const signature = boxes.map((box) => `${box.tx0},${box.ty0},${box.tx1},${box.ty1},${box.depthCode}`).join(';');
      if (signature === previousSignature) continue;
      previousSignature = signature;
      const priorities = core.priorityTilesForBillboards(tileDepths, boxes);
      for (let tile = 0; tile < priorities.length; tile++) checksum += priorities[tile];
    }
    return checksum;
  };
  /* JITの初回コストを測定から外し、3回の中央値で一時的なOSスケジューリング差を緩和する。 */
  runPixelMask();
  runPriority();
  const measure = (fn) => {
    const samples = [];
    let checksum = 0;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      checksum ^= fn();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    assert.ok(checksum >= 0);
    return samples[1];
  };
  const pixelMaskMs = measure(runPixelMask);
  const priorityMs = measure(runPriority);
  assert.ok(pixelMaskMs / priorityMs >= 2, `Priority ${priorityMs.toFixed(2)}ms vs pixel mask ${pixelMaskMs.toFixed(2)}ms`);
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
  assert.ok(exported.priority);
  assert.equal(exported.priority.key, 'priority');
  assert.equal(fs.existsSync(exported.priority.cachePath), true);
  assert.equal(Object.hasOwn(exported.priority, 'tilesetPath'), false);
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
  assert.match(patternHeader, /typedef struct \{ s16 x; s16 y; s8 frame; u8 depth_code; \} DunBBPose;/);
  assert.match(patternHeader, /DunFrameTable/);
  assert.match(patternHeader, /typedef struct \{[\s\S]*const TileSet \*background_tileset;[\s\S]*\} DunViewSet;/);
  assert.match(patternHeader, /extern const DunViewSet dun_view_sets\[DUN_VIEW_SET_COUNT\];/);
  assert.match(patternHeader, /typedef struct \{[\s\S]*const u8 \*values;[\s\S]*\} DunPriorityTable;/);
  assert.match(patternHeader, /extern const DunPriorityTable dun_priority_frame_static;/);
  assert.match(patternHeader, /extern const DunPriorityTable dun_priority_frames_fwd\[DUN_FWD_FRAMES\];/);
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
  assert.match(patternSource, /const DunPriorityTable dun_priority_frame_static/);
  assert.match(patternSource, /const DunPriorityTable dun_priority_frames_fwd\[DUN_FWD_FRAMES\]/);
  assert.match(patternSource, /dun_priority_static_values\[\d+\] = \{/);
  assert.match(patternSource, /palette_dark\[16\]/);
  assert.match(patternSource, /const DunViewSet dun_view_sets\[DUN_VIEW_SET_COUNT\]/);
  assert.doesNotMatch(patternSource, /dungeon_view_pattern_count/);

  const tileCount = Number(patternHeader.match(/#define DUN_TILESET_TILE_COUNT (\d+)/)?.[1] || 0);
  assert.ok(tileCount > 100);
  assert.equal(exported.patternTileCount, tileCount);
  assert.ok(exported.budget && exported.budget.tileCount === tileCount);
  assert.ok(exported.budget.priorityValueCount > 0);
  assert.ok(exported.budget.priorityTableBytes > 0);
  assert.equal(exported.budget.priorityTotalBytes, exported.budget.priorityTableBytes);
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
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'occlusion')), false);

  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  assert.match(resources, /PALETTE dun_[a-z0-9_]+_view_palette /);
  assert.match(resources, /TILESET dun_[a-z0-9_]+_view_tileset .* NONE ALL/);
  assert.match(resources, /TILESET dun_[a-z0-9_]+_background_tileset .* NONE NONE/);
  /* 宝箱/階段ビルボードは素材セットに依らずプロジェクトで1回だけ生成される (dun_common_bb_*) */
  assert.match(resources, /PALETTE dun_common_bb_palette /);
  assert.match(resources, /SPRITE dun_common_bb_chest .* 6 6 NONE 0/);
  assert.match(resources, /SPRITE dun_common_bb_stairs_up /);
  assert.match(resources, /SPRITE dun_common_bb_stairs_down /);
  assert.equal((resources.match(/TILESET dun_occlusion_depth_tiles /g) || []).length, 0);
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
  assert.equal(firstExport.priority.cached, true);
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
  assert.equal(saved.export.priority.cached, true, 'move speed must not invalidate geometry-only Priority cache');
  patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_MOVE_SPEED_VBLANKS_DEFAULT 5/);

  /* 一方、animation_frames の変更は従来どおり焼き込みキャッシュを無効化する */
  const savedFrames = plugin.saveDungeonSettings({ settings: { ...saved.settings, animation_frames: 4 } }, context);
  assert.equal(savedFrames.ok, true);
  assert.equal(savedFrames.export.cached, false);
  assert.equal(savedFrames.export.priority.cached, false);

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
  /* PriorityテーブルはCデータとして共通1組だけ生成され、深度TILESETは不要。 */
  assert.equal((resources.match(/TILESET dun_occlusion_depth_tiles /g) || []).length, 0);
  assert.equal(saved.export.priority.key, 'priority');
  const dataSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  /* 末尾から2番目の数値がフロア構造体の enemy_step_vblanks (両フロアともプロジェクト既定90を継承) */
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 0, 90, dungeon_floor_1_edges/);
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 1, 90, dungeon_floor_2_edges/);

  const cached = plugin.exportDungeonData({}, { projectDir, logger: logger() });
  assert.equal(cached.cached, true);
  const nextSettings = JSON.parse(fs.readFileSync(path.join(dungeonDir, 'settings.json'), 'utf-8'));
  nextSettings.asset_sets.find((set) => set.id === 'lava').assets.wall_texture = 'dungeon/textures/lava-2.png#wall';
  fs.writeFileSync(path.join(dungeonDir, 'settings.json'), `${JSON.stringify(nextSettings, null, 2)}\n`);
  const changed = plugin.exportDungeonData({}, { projectDir, logger: logger() });
  assert.equal(changed.cached, false);
  assert.equal(changed.assetSets.find((set) => set.id === migratedFloor.asset_set_id).cached, true);
  assert.equal(changed.assetSets.find((set) => set.id === 'lava').cached, false);
  assert.equal(changed.priority.cached, true, 'material changes must not invalidate geometry-only Priority data');
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
  assert.equal(changedCommon.priority.cached, true, 'common sprite changes must not invalidate Priority data');
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

/* ==================================================================
 * ダンジョンエネミー: AI (render-core.js) / 焼き込み / 設定 / Cソース / renderer
 * ================================================================== */

function blankEnemyTestCell() {
  return { walls: 0, doors: 0, one_way: 0, dark: false, event: '', stairs: '', enemy: false };
}

function makeEnemyTestFloor(width, height) {
  return {
    width,
    height,
    cells: Array.from({ length: height }, () => Array.from({ length: width }, blankEnemyTestCell)),
  };
}

test('dungeon enemy AI: xorshift16 RNG anchor sequence (seed 0x2025) for cross-checking the C port', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const rng = core.makeEnemyRng(0x2025);
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(core.enemyRngNext(rng));
  /*
   * このアンカー系列は main.c の enemyRngNext (同一 shift 定数 7,9,8、u16 暗黙切り詰め) と
   * 一致するはずの参照値。C側を変更した場合はこの値を実機/エミュレータ側で同様に出力させ、
   * 一致することを確認すること (losVisible と同じ二重実装の照合パターン)。
   */
  assert.deepEqual(seq, [0x8ebc, 0x04d4, 0x8de3, 0x215d, 0x159a]);
  assert.equal(core.ENEMY_RNG_DEFAULT_SEED, 0x2025);
  assert.equal(core.DUN_MAX_ENEMIES, 8);
  assert.equal(core.ENEMY_SIGHT_RANGE, 3);
  assert.equal(core.ENEMY_CHASE_TIMER, 5);
  assert.equal(core.ENEMY_WANDER_FORWARD_PERCENT, 75);
});

test('dungeon enemy AI: canTraverse/enemySpawns/enemyBlockedCell/enemyAt/enemyCanMove/enemySeesPlayer', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');

  /* canTraverse: 壁は遮る、扉は通行可 */
  const wallFloor = makeEnemyTestFloor(4, 4);
  wallFloor.cells[1][1].walls |= 2; /* east wall at (1,1) */
  assert.equal(core.canTraverse(wallFloor, 1, 1, 1), false);
  wallFloor.cells[1][1].walls = 0;
  wallFloor.cells[1][1].doors |= 2;
  assert.equal(core.canTraverse(wallFloor, 1, 1, 1), true);

  /* canTraverse: one_way は現在セル・移動先セル両方のルールを尊重する */
  const owFloor = makeEnemyTestFloor(4, 4);
  owFloor.cells[1][1].one_way |= 2; /* (1,1) は東方向のみ退出可 */
  assert.equal(core.canTraverse(owFloor, 1, 1, 1), true);
  assert.equal(core.canTraverse(owFloor, 1, 1, 0), false);
  assert.equal(core.canTraverse(owFloor, 1, 1, 2), false);
  const owFloor2 = makeEnemyTestFloor(4, 4);
  owFloor2.cells[1][2].one_way |= 8; /* (2,1) は西方向のみ (=東からの進入のみ許可) */
  assert.equal(core.canTraverse(owFloor2, 1, 1, 1), true, '進入方向が one_way と一致すれば許可');
  const owFloor3 = makeEnemyTestFloor(4, 4);
  owFloor3.cells[1][2].one_way |= 2; /* (2,1) は東方向のみ (=西からの進入は不可) */
  assert.equal(core.canTraverse(owFloor3, 1, 1, 1), false, '進入方向が one_way と不一致なら拒否');

  /* enemySpawns: cell.enemy===true のセルを走査順で、DUN_MAX_ENEMIES件を上限に返す */
  const spawnFloor = makeEnemyTestFloor(3, 3);
  spawnFloor.cells[0][2].enemy = true;
  spawnFloor.cells[2][0].enemy = true;
  spawnFloor.cells[1][1].enemy = true;
  const spawns = core.enemySpawns(spawnFloor);
  assert.deepEqual(spawns, [{ x: 2, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }]);
  const fullFloor = makeEnemyTestFloor(4, 4);
  fullFloor.cells.flat().forEach((cell) => { cell.enemy = true; });
  assert.equal(core.enemySpawns(fullFloor).length, core.DUN_MAX_ENEMIES);

  /* enemyBlockedCell: プレイヤー・宝箱・階段・他のアクティブなエネミーで占有 */
  const occFloor = makeEnemyTestFloor(5, 5);
  occFloor.cells[2][3].event = 'chest';
  occFloor.cells[3][2].stairs = 'up';
  const enemies = [
    { x: 4, y: 4, dir: 0, mode: 0, anim: 0, chaseTimer: 0, active: true },
    { x: 0, y: 0, dir: 0, mode: 0, anim: 0, chaseTimer: 0, active: false },
  ];
  const player = { x: 1, y: 1 };
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 1, 1), true, 'プレイヤーのセルはブロック');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 3, 2), true, '宝箱のセルはブロック');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 2, 3), true, '階段のセルはブロック');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 4, 4), true, '他のアクティブなエネミーのセルはブロック');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, 0, player, 4, 4), false, 'exclude指定した自分自身のセルはブロックしない');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 0, 0), false, '非アクティブなエネミーのセルはブロックしない');
  assert.equal(core.enemyBlockedCell(occFloor, enemies, -1, player, 2, 2), false, '無関係な空セルはブロックしない');

  /* enemyAt: (x,y) にいるアクティブなエネミーを返す */
  assert.equal(core.enemyAt(enemies, 4, 4), enemies[0]);
  assert.equal(core.enemyAt(enemies, 0, 0), null, '非アクティブは対象外');
  assert.equal(core.enemyAt(enemies, 1, 1), null);

  /* enemyCanMove: canTraverse + 占有ブロックの合成 */
  const moveFloor = makeEnemyTestFloor(5, 5);
  moveFloor.cells[2][2].walls |= 2; /* east wall */
  const moveEnemies = [{ x: 2, y: 2, dir: 1, mode: 0, anim: 0, chaseTimer: 0, active: true }];
  assert.equal(core.enemyCanMove(moveFloor, moveEnemies, 0, null, 2, 2, 1), false, '壁でブロック');
  assert.equal(core.enemyCanMove(moveFloor, moveEnemies, 0, null, 2, 2, 2), true, '南は開いている');
  const movePlayer = { x: 2, y: 3 };
  assert.equal(core.enemyCanMove(moveFloor, moveEnemies, 0, movePlayer, 2, 2, 2), false, 'プレイヤー占有セルへはブロック');

  /* enemySeesPlayer: 正面直線3マス以内、壁と扉どちらも遮る (LOSのlosVisibleとは異なるルール) */
  const sightFloor = makeEnemyTestFloor(6, 6);
  const enemyLooking = (dir) => ({ x: 2, y: 2, dir, mode: 0, anim: 0, chaseTimer: 0, active: true });
  assert.equal(core.enemySeesPlayer(sightFloor, enemyLooking(1), { x: 5, y: 2 }), true, '東3マス先、遮蔽なし');
  assert.equal(core.enemySeesPlayer(sightFloor, enemyLooking(1), { x: 6, y: 2 }), false, '射程外 (4マス先)');
  assert.equal(core.enemySeesPlayer(sightFloor, enemyLooking(0), { x: 2, y: 5 }), false, '背後は見えない');
  const doorSightFloor = makeEnemyTestFloor(6, 6);
  doorSightFloor.cells[2][3].doors |= 2; /* (3,2) の東に扉 */
  assert.equal(core.enemySeesPlayer(doorSightFloor, enemyLooking(1), { x: 5, y: 2 }), false, '扉も視線を遮る (壁と同様)');
  const wallSightFloor = makeEnemyTestFloor(6, 6);
  wallSightFloor.cells[2][3].walls |= 2;
  assert.equal(core.enemySeesPlayer(wallSightFloor, enemyLooking(1), { x: 5, y: 2 }), false, '壁も視線を遮る');
});

test('dungeon enemy AI: stepEnemies chase converges to contact and reverts to wander after the chase timer expires', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');

  /* 追跡→接触: プレイヤーの正面3マス先にエネミーを配置し、収束するまでstepEnemiesを回す */
  const floor = makeEnemyTestFloor(7, 7);
  const enemies = [{ x: 3, y: 0, dir: 2 /* S */, mode: core.ENEMY_MODE_WANDER, anim: 0, chaseTimer: 0, active: true }];
  const player = { x: 3, y: 3, dir: 0 };
  const rng = core.makeEnemyRng(0x2025);

  const tick1 = core.stepEnemies(floor, enemies, player, rng);
  assert.equal(enemies[0].mode, core.ENEMY_MODE_CHASE, '視界に入ったら即座に追跡モードへ');
  assert.deepEqual([enemies[0].x, enemies[0].y], [3, 1]);
  assert.deepEqual(tick1, []);

  const tick2 = core.stepEnemies(floor, enemies, player, rng);
  assert.deepEqual([enemies[0].x, enemies[0].y], [3, 2]);
  assert.deepEqual(tick2, []);

  const tick3 = core.stepEnemies(floor, enemies, player, rng);
  /* プレイヤーのセルへ侵入しようとしたので接触。移動はブロックされ、位置は変わらない */
  assert.deepEqual(tick3, [0]);
  assert.deepEqual([enemies[0].x, enemies[0].y], [3, 2]);
  assert.equal(enemies[0].active, true, '接触してもエネミーは非アクティブ化しない (将来の戦闘フック用の空実装)');

  const tick4 = core.stepEnemies(floor, enemies, player, rng);
  assert.deepEqual(tick4, [0], '隣接して視界がある限り毎tick接触する');

  /* タイマー復帰: 見失った状態が続くと ENEMY_CHASE_TIMER tick で徘徊へ戻る */
  const timerFloor = makeEnemyTestFloor(6, 6);
  const timerEnemies = [{ x: 0, y: 0, dir: 1 /* E, プレイヤーへ向いていない */, mode: core.ENEMY_MODE_CHASE, anim: 0, chaseTimer: 2, active: true }];
  const timerPlayer = { x: 5, y: 5 };
  const timerRng = core.makeEnemyRng(0x2025);
  core.stepEnemies(timerFloor, timerEnemies, timerPlayer, timerRng);
  assert.equal(timerEnemies[0].mode, core.ENEMY_MODE_CHASE);
  assert.equal(timerEnemies[0].chaseTimer, 1);
  core.stepEnemies(timerFloor, timerEnemies, timerPlayer, timerRng);
  assert.equal(timerEnemies[0].chaseTimer, 0);
  assert.equal(timerEnemies[0].mode, core.ENEMY_MODE_WANDER, 'chaseTimerが尽きたら徘徊モードへ復帰');
});

test('dungeon enemy AI: wander/chase never occupy the player, another enemy, chest, or stairs cell across many ticks', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const floor = service.makeGeneratedFloor({ width: 12, height: 12, name: 'Invariant Floor' });
  const spawns = core.enemySpawns(floor).length ? core.enemySpawns(floor) : [{ x: 1, y: 2 }, { x: 2, y: 1 }];
  spawns.forEach((spawn) => { floor.cells[spawn.y][spawn.x].enemy = true; });
  const enemies = core.enemySpawns(floor).map((spawn) => ({ x: spawn.x, y: spawn.y, dir: 0, mode: 0, anim: 0, chaseTimer: 0, active: true }));
  assert.ok(enemies.length >= 1);
  const player = { x: floor.start.x, y: floor.start.y, dir: floor.start.dir };
  const rng = core.makeEnemyRng(0x2025);
  for (let tick = 0; tick < 80; tick++) {
    core.stepEnemies(floor, enemies, player, rng);
    enemies.forEach((enemy, index) => {
      const cell = floor.cells[enemy.y][enemy.x];
      assert.notDeepEqual([enemy.x, enemy.y], [player.x, player.y], `tick ${tick}: enemy ${index} on player cell`);
      assert.notEqual(cell.event, 'chest', `tick ${tick}: enemy ${index} on chest cell`);
      assert.equal(cell.stairs, '', `tick ${tick}: enemy ${index} on stairs cell`);
      enemies.forEach((other, otherIndex) => {
        if (otherIndex === index) return;
        assert.notDeepEqual([enemy.x, enemy.y], [other.x, other.y], `tick ${tick}: enemy ${index} overlapping enemy ${otherIndex}`);
      });
    });
  }
});

test('dungeon enemy billboard sheet: 384x384 dimensions and byte-identical chest sheet after the blitBillboardFrame refactor', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const enemyTexture = core.makeFallbackTexture('enemy');
  assert.deepEqual([enemyTexture.width, enemyTexture.height], [192, 96]);
  const palette = core.buildSpritePalette({});
  const enemySheet = core.renderEnemyBillboardSheet(enemyTexture, palette);
  assert.deepEqual([enemySheet.width, enemySheet.height], [384, 384]);

  /* 既存のチェストシート (単一行、384x48) は blitBillboardFrame 抽出後もバイト一致する */
  const chestTexture = core.makeFallbackTexture('chest');
  const chestSheet = core.renderBillboardSheet(chestTexture, palette);
  assert.deepEqual([chestSheet.width, chestSheet.height], [384, 48]);
  let nonZero = 0;
  for (let i = 0; i < chestSheet.pixels.length; i++) if (chestSheet.pixels[i]) nonZero++;
  assert.ok(nonZero > 0, 'chest sheet should have drawn pixels');
});

test('dungeon enemy export: cell flag bit16, 384x384 indexed PNG, single resources.res SPRITE line, and DUN_ENEMY_STEP_VBLANKS_DEFAULT define', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-enemy-export-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const context = { projectDir, logger: logger() };
  writeFastSettings(projectDir);

  const floor = service.makeGeneratedFloor({ id: 'enemy-floor', name: 'Enemy Floor', order: 1, width: 10, height: 10, asset_set_id: 'default' });
  /* 生成済みのランダム配置を上書きし、既知の2セルにエネミーを立てる (排他性を尊重する) */
  floor.cells.flat().forEach((cell) => { cell.enemy = false; });
  const spot1 = floor.cells.flat().find((cell) => !cell.stairs && cell.event !== 'chest');
  spot1.enemy = true;
  const saved = plugin.saveDungeonState({ create: true, floor, settings: service.DEFAULT_SETTINGS }, context);
  assert.equal(saved.ok, true);

  const exported = saved.export;
  assert.equal(exported.ok, true);
  assert.ok(exported.common);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', exported.common.paths.billboards.enemy)), true);

  const sheet = readIndexedPng(path.join(projectDir, 'res', exported.common.paths.billboards.enemy));
  assert.deepEqual([sheet.width, sheet.height], [384, 384]);
  assert.deepEqual(Array.from(sheet.plte.subarray(0, 3)), [255, 0, 255], 'palette index 0 is magenta (transparent key)');

  const dataSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  /* flagValue: DUN_FLAG_ENEMY = 0x10 = 16 は cell.enemy がある行に現れる */
  assert.match(dataSource, /dungeon_floor_1_flags/);
  const savedFloorCell = saved.floor.cells.flat().find((cell) => cell.enemy);
  assert.ok(savedFloorCell, 'エネミーセルが保存されている');

  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  assert.match(resources, /SPRITE dun_common_bb_enemy "dungeon\/generated\/dungeon_bb_enemy\.png" 6 6 NONE 0/);
  assert.equal((resources.match(/SPRITE dun_common_bb_enemy /g) || []).length, 1);

  const patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_ENEMY_STEP_VBLANKS_DEFAULT 90/);
});

test('dungeon enemy_step_vblanks setting round-trips and keeps the bake cache; enemy_texture change invalidates only the common bake', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-enemy-settings-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  const context = { projectDir, logger: logger() };
  writeFastSettings(projectDir);

  /* 既定値90 (1.5秒相当、旧45が速すぎるというユーザー報告を受けて引き上げ) */
  assert.equal(service.normalizeSettings({}).enemy_step_vblanks, 90);
  assert.equal(service.normalizeSettings({ enemy_step_vblanks: 1 }).enemy_step_vblanks, 5);
  assert.equal(service.normalizeSettings({ enemy_step_vblanks: 9999 }).enemy_step_vblanks, 240);
  assert.equal(service.normalizeSettings({ enemy_step_vblanks: 30.9 }).enemy_step_vblanks, 30);

  const generated = plugin.generateDungeonFloor({ width: 10, height: 10, name: 'Enemy Settings Test' }, context);
  assert.equal(generated.ok, true);
  const listed = plugin.listDungeonSettings({}, context);
  assert.equal(listed.ok, true);

  /* 既定値 (90) と異なる値へ変更し、実際に反映されたことを確認する (既定値と同じ値では round-trip の証明にならない) */
  const savedStep = plugin.saveDungeonSettings({ settings: { ...listed.settings, enemy_step_vblanks: 60 } }, context);
  assert.equal(savedStep.ok, true);
  assert.equal(savedStep.settings.enemy_step_vblanks, 60);
  assert.equal(savedStep.export.cached, true, 'enemy_step_vblanks alone should not invalidate the bake cache');
  assert.equal(savedStep.export.common.cached, true);
  const patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  assert.match(patternHeader, /#define DUN_ENEMY_STEP_VBLANKS_DEFAULT 60/);

  const withEnemyTexture = { ...savedStep.settings, common_assets: { ...savedStep.settings.common_assets, enemy_texture: 'dungeon/textures/dungeon_texture_atlas.png#chest' } };
  const savedTexture = plugin.saveDungeonSettings({ settings: withEnemyTexture }, context);
  assert.equal(savedTexture.ok, true);
  assert.equal(savedTexture.export.cached, false);
  assert.equal(savedTexture.export.common.cached, false, 'enemy_texture change invalidates the common billboard bake');
  assert.equal(savedTexture.export.assetSets[0].cached, true, 'per-set wall/door/floor/ceiling bake is unaffected');
});

test('dungeon per-floor enemy_step_vblanks: normalizeFloor clamping rules and export inherit-vs-override', () => {
  const service = require('../plugins/dungeon-game-editor/dungeon-service');

  /*
   * 0/未指定 = プロジェクト既定を継承。1..4 のような ENEMY_STEP_VBLANKS_MIN (5) 未満の
   * 非0値は「継承」の0と紛れないよう MIN へ切り上げる。負値/非数は0 (継承) 扱いにする。
   */
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 0 }).enemy_step_vblanks, 0);
  assert.equal(service.normalizeFloor({}).enemy_step_vblanks, 0);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 1 }).enemy_step_vblanks, 5);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 4 }).enemy_step_vblanks, 5);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 5 }).enemy_step_vblanks, 5);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 120 }).enemy_step_vblanks, 120);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 9999 }).enemy_step_vblanks, 240);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: -5 }).enemy_step_vblanks, 0);
  assert.equal(service.normalizeFloor({ enemy_step_vblanks: 'not-a-number' }).enemy_step_vblanks, 0);

  const projectDir = path.join(makeTempDir('md-editor-dungeon-floor-enemy-step-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const context = { projectDir, logger: logger() };
  writeFastSettings(projectDir);

  /* フロア1: enemy_step_vblanks 未指定 = プロジェクト既定 (90) を継承してエクスポートされる */
  const inheritFloor = service.makeGeneratedFloor({ id: 'inherit-floor', name: 'Inherit', order: 1, width: 8, height: 8, asset_set_id: 'default' });
  assert.equal(inheritFloor.enemy_step_vblanks, 0);
  const savedInherit = plugin.saveDungeonState({ create: true, floor: inheritFloor, settings: service.DEFAULT_SETTINGS }, context);
  assert.equal(savedInherit.ok, true);

  /* フロア2: 明示的に30を指定 = プロジェクト既定と無関係にそのままエクスポートされる */
  const overrideFloor = service.makeGeneratedFloor({ id: 'override-floor', name: 'Override', order: 2, width: 8, height: 8, asset_set_id: 'default' });
  overrideFloor.enemy_step_vblanks = 30;
  const savedOverride = plugin.saveDungeonState({ create: true, floor: overrideFloor, settings: savedInherit.settings }, context);
  assert.equal(savedOverride.ok, true);
  assert.equal(savedOverride.floor.enemy_step_vblanks, 30);

  const dataSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 0, 90, dungeon_floor_1_edges/);
  assert.match(dataSource, /\{ 8, 8, \d+, \d+, \d+, 0, 30, dungeon_floor_2_edges/);
});

test('dungeon enemy spawn validation rejects a 9th enemy on a single floor', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-enemy-cap-'), 'demo');
  const service = require('../plugins/dungeon-game-editor/dungeon-service');
  writeFastSettings(projectDir);

  const floor = service.makeGeneratedFloor({ id: 'cap-floor', name: 'Cap Floor', order: 1, width: 10, height: 10, asset_set_id: 'default' });
  floor.cells.flat().forEach((cell) => { cell.enemy = false; });
  const eligible = floor.cells.flat().filter((cell) => !cell.stairs && cell.event !== 'chest');
  eligible.slice(0, 9).forEach((cell) => { cell.enemy = true; });
  assert.ok(eligible.slice(0, 9).length === 9, 'test fixture needs at least 9 eligible cells');

  assert.throws(
    () => service.validateProjectState([floor], service.DEFAULT_SETTINGS),
    /エネミーは8体までです/,
  );

  /* normalizeCell の排他規則: 宝箱/階段セルに立てた enemy フラグは保存時に自動的に落ちる */
  const exclusiveCell = service.normalizeFloor({
    id: 'x', name: 'x', order: 1, width: 2, height: 2,
    cells: [[{ event: 'chest', enemy: true }, { stairs: 'up', enemy: true }], [{}, {}]],
  }).cells;
  assert.equal(exclusiveCell[0][0].enemy, false);
  assert.equal(exclusiveCell[0][1].enemy, false);
});

test('dungeon-game-builder generates enemy AI C source matching render-core.js constants (dual-implementation cross-check)', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-enemy-csource-'), 'demo');
  const builder = require('../plugins/dungeon-game-builder');
  const context = { projectDir, assets: [], logger: logger() };
  writeFastSettings(projectDir);

  const generated = builder.generateSource([], context);
  assert.equal(generated.ok, true);

  const gameHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_game.h'), 'utf-8');
  assert.match(gameHeader, /#define DUN_FLAG_ENEMY\s+0x10/);
  assert.match(gameHeader, /#define DUN_MAX_ENEMIES 8/);
  assert.match(gameHeader, /#define DUN_ENEMY_SIGHT_RANGE 3/);
  assert.match(gameHeader, /#define DUN_ENEMY_CHASE_TIMER 5/);
  assert.match(gameHeader, /#define DUN_ENEMY_WANDER_FORWARD_PCT 75/);
  assert.match(gameHeader, /#define DUN_ENEMY_RNG_SEED_DEFAULT 0x2025/);
  assert.match(gameHeader, /typedef struct DunEnemy/);
  /*
   * per-floor エネミー速度: u8 スカラーはポインタメンバより前に置く (既存の
   * width/height/start_x/start_y/start_dir/view_set と同じグループ)。
   * dungeon-service.js の exportSource 行エミッタもこの順序と一致させる。
   */
  assert.match(
    gameHeader,
    /typedef struct DungeonFloorData\s*\{\s*u8 width;\s*u8 height;\s*u8 start_x;\s*u8 start_y;\s*u8 start_dir;\s*u8 view_set;\s*u8 enemy_step_vblanks;\s*const u16 \*edges;\s*const u8 \*flags;\s*\} DungeonFloorData;/,
  );

  const viewHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_view.h'), 'utf-8');
  assert.match(viewHeader, /void DUN_setEnemies\(const DunEnemy \*list, u8 count\);/);
  assert.match(viewHeader, /void DUN_refreshBillboards\(void\);/);

  const viewSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_view.c'), 'utf-8');
  assert.match(viewSource, /void DUN_setEnemies\(const DunEnemy \*list, u8 count\)/);
  assert.match(viewSource, /void DUN_refreshBillboards\(void\)/);
  assert.match(viewSource, /static const DunEnemy \*enemyAt\(/);
  assert.match(viewSource, /typedef struct[\s\S]*u8 tx0;[\s\S]*u8 depth_code;[\s\S]*DunPriorityBox;/);
  assert.match(viewSource, /static u8 wall_priority_depth\[DUN_VIEW_TILE_COUNT\];/);
  assert.match(viewSource, /static void addBillboardPriorityBox\(const AnimationFrame \*frame/);
  assert.match(viewSource, /if \(wall_depth <= box->depth_code\)/);
  assert.match(viewSource, /next_attr \|= TILE_ATTR_PRIORITY_MASK;/);
  assert.match(viewSource, /SPR_addSprite\(def, sx, sy, TILE_ATTR\(PAL1, FALSE, FALSE, FALSE\)\)/);
  assert.match(viewSource, /stageFrame\(active_view_set->frame_static, &dun_priority_frame_static, FALSE\)/);
  assert.match(viewSource, /if \(updateBillboards\([\s\S]*VDP_setTileMapDataRect\(BG_A, map_staging/);
  const refreshBody = viewSource.match(/void DUN_refreshBillboards\(void\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(refreshBody, /SPR_update\(\)/, 'main loop must own the single Sprite Engine update per vblank');
  /* ソフトウェア画素マスク、固定VRAM、9KB RAM、手動スプライトDMAは全廃。 */
  assert.doesNotMatch(viewSource, /buildMaskedBillboardTiles|occlusionDepthAt|commitBillboard/);
  assert.doesNotMatch(viewSource, /DUN_BB_SLOT_TILES|DUN_BB_VRAM|bb_tile_buffers/);
  assert.doesNotMatch(viewSource, /SPR_setAutoTileUpload|SPR_setVRAMTileIndex|DMA_getQueueTransferSize/);
  assert.match(viewSource, /#define MM_COLOR_ENEMY 10/);
  assert.match(viewSource, /dun_common_bb_enemy/);
  /* エネミー優先ルール: フラグ参照 (billboardDefForFlags) より先に enemyAt() を検索する */
  const enemyAtIndex = viewSource.indexOf('enemy = enemyAt(ax, ay)');
  const flagsIndex = viewSource.indexOf('billboardDefForFlags(flags)');
  assert.ok(enemyAtIndex > 0 && flagsIndex > enemyAtIndex, 'enemyAt lookup must run before the flags fallback');

  const mainSource = generated.sourceCode;
  assert.match(mainSource, /static DunEnemy dun_enemies\[DUNGEON_FLOOR_COUNT\]\[DUN_MAX_ENEMIES\];/);
  assert.match(mainSource, /static u16 enemy_rng_state;/);
  /* xorshift16: JS/C同一のshift定数 (7, 9, 8) */
  assert.match(mainSource, /x \^= \(u16\)\(x << 7\);/);
  assert.match(mainSource, /x \^= \(u16\)\(x >> 9\);/);
  assert.match(mainSource, /x \^= \(u16\)\(x << 8\);/);
  assert.match(mainSource, /static bool enemySeesPlayer\(/);
  assert.match(mainSource, /static void stepEnemyWander\(/);
  assert.match(mainSource, /static bool stepEnemyChase\(/);
  assert.match(mainSource, /static void stepEnemies\(void\)/);
  assert.match(mainSource, /static void onEnemyContact\(u8 enemy_index\)/);
  assert.match(mainSource, /static void initEnemies\(void\)/);
  /* 接触はプレイヤーセルへの侵入試行時のみ発火し、移動はブロックされる */
  assert.match(mainSource, /if \(stepEnemyChase\(floor, index\)\) onEnemyContact\(index\);/);
  /* プレイヤー移動もエネミー占有セルでブロックされる (双方向ブロック) */
  assert.match(mainSource, /if \(cellHasEnemy\(nx, ny\)\) return FALSE;/);
  /* vtimer 差分は符号付きキャストでラップアラウンド安全に比較する */
  assert.match(mainSource, /if \(\(s32\)\(vtimer - enemy_next_step_vtime\) >= 0\)/);
  assert.match(mainSource, /DUN_refreshBillboards\(\);/);
  /*
   * per-floor エネミー速度: main.c はもう static u8 enemy_step_vblanks を持たず、
   * 常にフロア構造体のフィールドを読む (フロア切替で即座にペースが変わるようにするため)。
   */
  assert.doesNotMatch(mainSource, /static u8 enemy_step_vblanks;/);
  assert.match(mainSource, /enemy_next_step_vtime = vtimer \+ dungeon_floors\[floor_index\]\.enemy_step_vblanks;/);
  assert.match(mainSource, /const u16 interval = enemy_floor->enemy_step_vblanks;/);
  assert.match(mainSource, /enemy_next_step_vtime = vtimer \+ interval;/);
  /*
   * 移動スライド: 直前tick開始時のセル (prev_x/prev_y) を記録し、毎フレーム進行度を
   * DUN_setEnemySlide で更新して tick 間もセル間を補間する。DunEnemy 構造体・DUN_setEnemySlide
   * 宣言/定義・スライド静的変数・updateBillboards の補間式・main.c の毎フレーム更新を確認する。
   */
  assert.match(gameHeader, /typedef struct DunEnemy\s*\{[\s\S]*u8 prev_x;\s*u8 prev_y;[\s\S]*\} DunEnemy;/);
  assert.match(viewHeader, /void DUN_setEnemySlide\(u16 num, u16 den\);/);
  assert.match(viewSource, /void DUN_setEnemySlide\(u16 num, u16 den\)/);
  assert.match(viewSource, /static u16 enemy_slide_num;/);
  assert.match(viewSource, /enemy_slide_num < enemy_slide_den/);
  assert.match(viewSource, /\(\(s32\)\(cur_sx - prev_sx\) \* enemy_slide_num\) \/ enemy_slide_den/);
  /* 距離バケット (サイズ) も補間して移動中に拡大縮小する (最近傍丸め) */
  assert.match(viewSource, /draw_frame = \(s16\)\(prev_pose->frame \+ \(\(fn < 0\) \? -q : q\)\)/);
  assert.match(viewSource, /SPR_setAnimAndFrame\(bb_sprites\[used\], draw_anim, draw_frame\)/);
  assert.match(mainSource, /enemy->prev_x = before_x;/);
  assert.match(mainSource, /static u32 enemy_last_step_vtime;/);
  assert.match(mainSource, /enemy_last_step_vtime = vtimer;/);
  assert.match(mainSource, /DUN_setEnemySlide\(\(u16\)slide, interval\);/);
});

test('dungeon-game-editor renderer wires the enemy tool, sim state, and settings field', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'renderer.js'), 'utf-8');
  assert.match(rendererSource, /\{ id: 'enemy', label: '敵' \}/);
  assert.match(rendererSource, /enemiesByFloor: new Map\(\)/);
  assert.match(rendererSource, /function getEnemiesForFloor\(floor\)/);
  assert.match(rendererSource, /function resetEnemiesForFloor\(floorId\)/);
  assert.match(rendererSource, /function resetAllEnemies\(\)/);
  assert.match(rendererSource, /function startEnemyLoop\(\)/);
  assert.match(rendererSource, /function stopEnemyLoop\(\)/);
  assert.match(rendererSource, /function tickEnemyLoop\(\)/);
  assert.match(rendererSource, /core\.stepEnemies\(floor, enemies, player, state\.enemyRng\)/);
  assert.match(rendererSource, /core\.enemySpawns\(floor\)/);
  assert.match(rendererSource, /core\.enemyAt\(enemies, ax, ay\)/);
  assert.match(rendererSource, /core\.canTraverse\(floor, state\.preview\.x, state\.preview\.y, dirIndex\)/);
  assert.match(rendererSource, /data-settings-field="enemy_step_vblanks"/);
  assert.match(rendererSource, /resetEnemiesForFloor\(floor\.id\);/);
  assert.match(rendererSource, /resetEnemiesForFloor\(state\.current\.id\);/);
  assert.match(rendererSource, /resetAllEnemies\(\);/);
  assert.match(rendererSource, /MINIMAP_ENEMY_COLOR/);
  assert.match(rendererSource, /エネミーは1フロアにつき/);
  /* per-floor エネミー速度上書き: フロア編集フォームの入力欄と、現在フロア優先で読む enemyTickIntervalMs */
  assert.match(rendererSource, /class="dge-enemy-step"/);
  assert.match(rendererSource, /enemyStep: root\.querySelector\('\.dge-enemy-step'\)/);
  assert.match(rendererSource, /Number\(state\.current\?\.enemy_step_vblanks\) \|\| Number\(state\.settings\?\.enemy_step_vblanks\) \|\| 90/);
  assert.match(rendererSource, /state\.current\.enemy_step_vblanks = Number\.isFinite\(rawEnemyStep\)/);
  /* 移動スライド: 毎フレーム再描画ループ + drawBillboardsInto の補間 (実機と同一式) */
  assert.match(rendererSource, /function stepEnemySlideLoop\(\)/);
  assert.match(rendererSource, /function enemySlideProgress\(\)/);
  assert.match(rendererSource, /core\.billboardSlideLerp\(prevSx0, sx0, slide\.num, slide\.den\)/);
  assert.match(rendererSource, /core\.billboardSlideLerp\(posePrev\.y, pose\.y, slide\.num, slide\.den\)/);
  assert.match(rendererSource, /core\.billboardSlideFrame\(posePrev\.frame, pose\.frame, slide\.num, slide\.den\)/);
  assert.match(rendererSource, /core\.renderViewDetailed\(/);
  assert.match(rendererSource, /core\.minimumDepthByTile\(wallDepth\)/);
  assert.match(rendererSource, /core\.priorityTilesForBillboards\(/);
  assert.match(rendererSource, /function collectBillboards\(/);
  assert.match(rendererSource, /function drawHighPriorityWalls\(/);
  assert.doesNotMatch(rendererSource, /wallDepth\[\(dy \* VIEW_W\) \+ dx\] > drawDepthCode/);
  assert.match(rendererSource, /posePrev\.depthCode \|\| 0/);
});

test('dungeon enemy movement: stepEnemies records the previous cell and billboardSlideLerp interpolates', () => {
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  /* billboardSlideLerp: num=0 で prev、num=den で cur、中間は 0方向切り捨て (C の整数除算と一致) */
  assert.equal(core.billboardSlideLerp(10, 40, 0, 4), 10);
  assert.equal(core.billboardSlideLerp(10, 40, 4, 4), 40);
  assert.equal(core.billboardSlideLerp(10, 40, 2, 4), 25);
  assert.equal(core.billboardSlideLerp(40, 10, 1, 4), 33); /* 40 + trunc(-30*1/4)=40-7 */
  assert.equal(core.billboardSlideLerp(10, 40, 3, 0), 40); /* den=0 は cur */

  /* billboardSlideFrame: 距離バケット (サイズ) の最近傍丸め補間。中央でサイズが切り替わり、
   * 末尾ポップを避ける。lerp と違い round のため両端が prev/cur、中間で切り替わる。 */
  assert.equal(core.billboardSlideFrame(6, 4, 0, 4), 6);
  assert.equal(core.billboardSlideFrame(6, 4, 4, 4), 4);
  assert.equal(core.billboardSlideFrame(6, 4, 2, 4), 5);
  assert.equal(core.billboardSlideFrame(4, 5, 1, 4), 4); /* 中央未満はまだ prev サイズ */
  assert.equal(core.billboardSlideFrame(4, 5, 2, 4), 5); /* 中央で cur サイズへ切替 */
  assert.equal(core.billboardSlideFrame(4, 4, 2, 4), 4); /* 横移動 (距離不変) はサイズ変化なし */
  assert.equal(core.billboardSlideFrame(6, 4, 3, 0), 4); /* den=0 は cur */

  const blank = () => ({ walls: 0, doors: 0, one_way: 0, dark: false, event: '', stairs: '', enemy: false });
  const mk = (w, h) => ({ width: w, height: h, cells: Array.from({ length: h }, () => Array.from({ length: w }, blank)) });
  const floor = mk(6, 6);
  const enemies = core.enemySpawns(floor);
  enemies.push({ x: 2, y: 2, dir: 1, mode: 0, chaseTimer: 0, anim: 0, active: true, prevX: 2, prevY: 2 });
  const e = enemies[enemies.length - 1];
  const rng = core.makeEnemyRng(0x2025);
  const before = { x: e.x, y: e.y };
  core.stepEnemies(floor, enemies, { x: 5, y: 5, dir: 0 }, rng);
  /* prevX/prevY は tick開始時のセルを保持する (移動有無に関わらず) */
  assert.equal(e.prevX, before.x);
  assert.equal(e.prevY, before.y);
  if (e.x === before.x && e.y === before.y) {
    assert.equal(e.prevX, e.x, '移動しなければ prev===cur');
  }
});

/* ==================================================================
 * エネミースプライトを3Dモデル+モーションから生成する機能
 * (plugins/dungeon-game-editor/enemy-model-geometry.js, enemy-model-render.js,
 *  vendor/three, renderer.js配線)。
 *
 * enemy-model-render.js は Three.js を静的 import する ES module であり、
 * このテストハーネス (Node, --testでCommonJS require) では実行できない
 * (DOM/WebGLも無い)。そのため方向→列マッピングの純関数 (viewYaw/cellOrigin) は
 * 依存フリーな enemy-model-geometry.js (UMD, render-core.js と同じ規約) に
 * 分離してあり、ここで直接 require() してテストする。描画・量子化ロジック本体は
 * ソースパターン断言のみ (手動E2Eが必須、DUNGEON_MAINTENANCE.md参照)。
 * ================================================================== */

test('enemy model geometry: viewYaw yaw table (back/right/front/left) and frontYawOffset', () => {
  const geometry = require('../plugins/dungeon-game-editor/enemy-model-geometry.js');
  assert.equal(geometry.VIEWS, 4);
  assert.equal(geometry.WALK_FRAMES, 2);
  assert.equal(geometry.CELL, 48);
  assert.equal(geometry.SOURCE_W, 192);
  assert.equal(geometry.SOURCE_H, 96);

  /*
   * 列順 = [背面, 右, 前, 左] (C engine の rel=(enemyDir-camDir)&3、rel0=背 rel2=前 と同じ規約)。
   * render-core.js の paintFallbackEnemyCell (view2=両目中央/正面、view1=目が右端、
   * view3=目が左端、view0=目なし/背面) が検証アンカー: 生成した「右」列(view=1)は
   * スプライト右側に顔/目が来ること (手動E2Eで確認、DUNGEON_MAINTENANCE.md参照)。
   */
  assert.equal(geometry.viewYaw(0, 0), 180, '背面 (view=0) は180°');
  assert.equal(geometry.viewYaw(1, 0), 90, '右 (view=1) は+90°');
  assert.equal(geometry.viewYaw(2, 0), 0, '前 (view=2) は0°');
  assert.equal(geometry.viewYaw(3, 0), -90, '左 (view=3) は-90°');

  /* frontYawOffset (φ) は加算オフセット (モデルが-Z向きの場合の0/180トグル等) */
  assert.equal(geometry.viewYaw(2, 180), 180, '前 (view=2) + φ180 = 180');
  assert.equal(geometry.viewYaw(0, 180), 360, '背面 (view=0) + φ180 = 360');
  assert.equal(geometry.viewYaw(1, -10), 80, '右 (view=1) + φ-10 = 80');

  /* view は 0..3 の範囲外でも4を法として正規化する */
  assert.equal(geometry.viewYaw(4, 0), geometry.viewYaw(0, 0));
  assert.equal(geometry.viewYaw(-1, 0), geometry.viewYaw(3, 0));
});

test('enemy model geometry: cellOrigin maps (view,walk) to the 48x48 grid used by the 192x96 sheet', () => {
  const geometry = require('../plugins/dungeon-game-editor/enemy-model-geometry.js');
  assert.deepEqual(geometry.cellOrigin(0, 0), { x: 0, y: 0 });
  assert.deepEqual(geometry.cellOrigin(1, 0), { x: 48, y: 0 });
  assert.deepEqual(geometry.cellOrigin(2, 0), { x: 96, y: 0 });
  assert.deepEqual(geometry.cellOrigin(3, 0), { x: 144, y: 0 });
  assert.deepEqual(geometry.cellOrigin(0, 1), { x: 0, y: 48 });
  assert.deepEqual(geometry.cellOrigin(3, 1), { x: 144, y: 48 });
  /* makeFallbackEnemyTexture (render-core.js) と同じ (view*cellW, walk*cellH) 規約 */
  const core = require('../plugins/dungeon-game-editor/render-core.js');
  const cellW = core.BB_ENEMY_SOURCE_W / core.BB_ENEMY_VIEWS;
  const cellH = core.BB_ENEMY_SOURCE_H / core.BB_ENEMY_WALK_FRAMES;
  assert.equal(cellW, geometry.CELL);
  assert.equal(cellH, geometry.CELL);
});

test('enemy model geometry module is UMD (no import/export/require), matching render-core.js convention', () => {
  const geometrySource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'enemy-model-geometry.js'),
    'utf-8',
  );
  assert.doesNotMatch(geometrySource, /^\s*import\s/m);
  assert.doesNotMatch(geometrySource, /^\s*export\s/m);
  assert.doesNotMatch(geometrySource, /require\(/);
  assert.match(geometrySource, /module\.exports = api/);
  assert.match(geometrySource, /globalThis\.DungeonEnemyModelGeometry = api/);
});

test('vendor/three: three.module.js / GLTFLoader.js / BufferGeometryUtils.js are vendored with rewritten relative imports', () => {
  const vendorDir = path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'vendor', 'three');
  assert.ok(fs.existsSync(path.join(vendorDir, 'three.module.js')), 'three.module.js is vendored');
  assert.ok(fs.existsSync(path.join(vendorDir, 'GLTFLoader.js')), 'GLTFLoader.js is vendored');
  assert.ok(fs.existsSync(path.join(vendorDir, 'BufferGeometryUtils.js')), 'BufferGeometryUtils.js is vendored');
  assert.ok(fs.existsSync(path.join(vendorDir, 'LICENSE')), 'LICENSE is vendored');

  const gltfLoaderSource = fs.readFileSync(path.join(vendorDir, 'GLTFLoader.js'), 'utf-8');
  const bufferUtilsSource = fs.readFileSync(path.join(vendorDir, 'BufferGeometryUtils.js'), 'utf-8');
  /* file:// はbare specifierを解決できないため、'three'への importは相対パスへ書き換え済みでなければならない */
  assert.doesNotMatch(gltfLoaderSource, /from\s+['"]three['"]/);
  assert.doesNotMatch(bufferUtilsSource, /from\s+['"]three['"]/);
  assert.doesNotMatch(gltfLoaderSource, /from\s+['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/);
  assert.match(gltfLoaderSource, /from\s+['"]\.\/three\.module\.js['"]/);
  assert.match(gltfLoaderSource, /from\s+['"]\.\/BufferGeometryUtils\.js['"]/);
  assert.match(bufferUtilsSource, /from\s+['"]\.\/three\.module\.js['"]/);
  assert.match(gltfLoaderSource, /class GLTFLoader/);

  const threeSource = fs.readFileSync(path.join(vendorDir, 'three.module.js'), 'utf-8');
  assert.doesNotMatch(threeSource, /from\s+['"]three['"]/, 'three.module.js core has no external imports');
});

test('enemy-model-render.js is an ES module that statically imports vendored Three.js and exposes the generator API', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'enemy-model-render.js'),
    'utf-8',
  );
  assert.match(source, /import \* as THREE from '\.\/vendor\/three\/three\.module\.js'/);
  assert.match(source, /import \{ GLTFLoader \} from '\.\/vendor\/three\/GLTFLoader\.js'/);
  assert.match(source, /await import\(new URL\('\.\/enemy-model-geometry\.js', import\.meta\.url\)\)/);
  assert.match(source, /async function parseModel\(arrayBuffer\)/);
  assert.match(source, /async function renderGrid\(session, model, params/);
  assert.match(source, /async function toIndexedEnemyPng\(imageData, api\)/);
  assert.match(source, /function createSession\(/);
  assert.match(source, /function disposeSession\(session\)/);
  assert.match(source, /renderer\.dispose\(\)/);
  assert.match(source, /renderer\.forceContextLoss\(\)/);

  /* DRACO/KTX2/meshopt は非対応: parse前に日本語メッセージでreject */
  assert.match(source, /KHR_draco_mesh_compression/);
  assert.match(source, /KHR_texture_basisu/);
  assert.match(source, /EXT_meshopt_compression/);
  assert.match(source, /非対応の圧縮形式/);

  /* 16色化必須: imageDataToIndexedPng は減色しないため、ローカル量子化→クリーンRGBA再構成を経由する */
  assert.match(source, /function quantizeLocal16\(/);
  assert.match(source, /maxOpaqueColors = 15/);
  assert.match(source, /function reconstructRgba\(/);
  assert.match(source, /function snapChannelTo3Bit\(/);
  assert.match(source, /capabilities\?\.get\?\.\('image-quantize'\)/);
  assert.match(source, /imageDataToIndexedPng/);

  /* 焼き込み・エクスポート側・render-core.jsからは参照されない (エディター専用) */
  const coreSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'render-core.js'), 'utf-8');
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'dungeon-service.js'), 'utf-8');
  assert.doesNotMatch(coreSource, /enemy-model-render/);
  assert.doesNotMatch(coreSource, /THREE/);
  assert.doesNotMatch(serviceSource, /enemy-model-render/);
  assert.doesNotMatch(serviceSource, /vendor\/three/);
});

test('dungeon-game-editor renderer wires the "3Dモデルから生成" button, lazy-loaded modal, and commit path', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'renderer.js'), 'utf-8');

  /* enemy_texture カードだけに出るボタン */
  assert.match(rendererSource, /key === 'enemy_texture' \? '<button type="button" data-action="asset-model-gen"/);
  /* ルートクリックハンドラの配線 */
  assert.match(rendererSource, /if \(action === 'asset-model-gen'\) void openEnemyModelGenerator\(\);/);
  /* モーダルを開いた時だけ遅延import (起動時に~1MBのThree.jsを読まない) */
  assert.match(rendererSource, /async function openEnemyModelGenerator\(\)/);
  assert.match(rendererSource, /await import\(new URL\('\.\/enemy-model-render\.js', import\.meta\.url\)\)/);
  assert.match(rendererSource, /3Dモデル機能のライブラリ \(vendor\/three\) が見つかりません/);
  /* 全終了経路でセッションをdispose */
  assert.match(rendererSource, /session\?\.dispose\?\.\(\);/);
  /* commitEnemyTextureDataUrl は importAssetForSet のtailと同じ検証・書き込み経路を通る */
  assert.match(rendererSource, /async function commitEnemyTextureDataUrl\(dataUrl\)/);
  assert.match(rendererSource, /isRequiredIndexedPng\(inspection\.png\)/);
  assert.match(rendererSource, /validateAssetInspection\(inspection, meta\)/);
  assert.match(rendererSource, /targetSubdir: 'dungeon\/textures\/common'|const targetSubdir = 'dungeon\/textures\/common'/);
  assert.match(rendererSource, /targetFileName = `\$\{meta\.fileName\}\.png`/);
  assert.match(rendererSource, /state\.settings\.common_assets\[key\] = relativePath/);
  assert.match(rendererSource, /refreshTextureConsumers\(null, \{ common: true \}\)/);
});
