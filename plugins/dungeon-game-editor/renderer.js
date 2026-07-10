/*
 * ダンジョンゲームエディター renderer module
 *
 * 3D プレビューは render-core.js (SGDK エクスポータと同一のレンダリングコア)
 * を通して描画する。実機と同じ 16 色量子化・同じ離散アニメフレーム・同じ
 * ビルボード座標テーブルを使うため、プレビュー = 実機出力となる。
 */
await import(new URL('./render-core.js', import.meta.url));
const core = globalThis.DungeonRenderCore;

const MAX_SIZE = 20;
const DIRS = [
  { id: 'n', label: 'N', dx: 0, dy: -1, bit: 1, opposite: 's' },
  { id: 'e', label: 'E', dx: 1, dy: 0, bit: 2, opposite: 'w' },
  { id: 's', label: 'S', dx: 0, dy: 1, bit: 4, opposite: 'n' },
  { id: 'w', label: 'W', dx: -1, dy: 0, bit: 8, opposite: 'e' },
];
const DIR_INDEX = { n: 0, e: 1, s: 2, w: 3 };
const DIR_BY_ID = Object.fromEntries(DIRS.map((dir) => [dir.id, dir]));
const TOOLS = [
  { id: 'wall', label: '壁' },
  { id: 'door', label: '扉' },
  { id: 'one_way', label: '一方通行' },
  { id: 'dark', label: '暗闇' },
  { id: 'chest', label: '宝箱' },
  { id: 'stairs_up', label: '上階段' },
  { id: 'stairs_down', label: '下階段' },
  { id: 'start', label: '開始' },
  { id: 'erase', label: '消去' },
];
const DEFAULT_ASSET_REFS = {
  wall_texture: 'dungeon/textures/dungeon_texture_atlas.png#wall',
  door_texture: 'dungeon/textures/dungeon_texture_atlas.png#door',
  floor_texture: 'dungeon/textures/dungeon_texture_atlas.png#floor',
  ceiling_texture: 'dungeon/textures/dungeon_texture_atlas.png#ceiling',
  chest_texture: 'dungeon/textures/dungeon_texture_atlas.png#chest',
  stairs_up_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_up',
  stairs_down_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_down',
};
const VIEW_W = 200;
const VIEW_H = 128;
/* 実機の 1 アニメフレーム = DUN_ANIMATION_STEP_VBLANKS(2) vblank ≒ 33ms */
const FRAME_STEP_MS = 34;
const DARK_PALETTE_SCALE = 0.35;

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const state = {
    floors: [],
    settings: null,
    defaultAssets: DEFAULT_ASSET_REFS,
    projectDir: '',
    current: null,
    dirty: false,
    activeTab: 'map',
    tool: 'wall',
    preview: { x: 1, y: 1, dir: 1 },
    animation: null,
    animationFrame: 0,
    textureCache: new Map(),
    textures: null,
    viewModel: null,
    exportInfo: null,
    wasActive: root.classList.contains('active'),
    activationObserver: null,
  };

  root.innerHTML = `
    <div class="dge-root">
      <div class="dge-top-tabs">
        <button class="active" data-tab="map">フロア編集</button>
        <button data-tab="preview">3Dプレビュー</button>
        <button data-tab="assets">素材</button>
        <span class="dge-status"></span>
        <span class="dge-dirty"></span>
        <button class="dge-save" data-action="save">保存</button>
      </div>
      <section class="dge-panel active" data-panel="map">
        <div class="dge-shell">
          <aside class="dge-left">
            <div class="dge-row">
              <select class="dge-floor-select"></select>
              <button class="dge-icon" data-action="new" title="新規">+</button>
              <button class="dge-icon danger" data-action="delete" title="削除">-</button>
              <button class="dge-icon" data-action="move-up" title="上へ">↑</button>
              <button class="dge-icon" data-action="move-down" title="下へ">↓</button>
            </div>
            <label class="dge-field">フロア名<input class="dge-floor-name" type="text"></label>
            <div class="dge-size-row">
              <label class="dge-field">幅<input class="dge-width" type="number" min="4" max="20"></label>
              <label class="dge-field">高さ<input class="dge-height" type="number" min="4" max="20"></label>
            </div>
            <button class="dge-wide" data-action="generate">ランダム自動生成</button>
            <div class="dge-tool-title">配置</div>
            <div class="dge-tools"></div>
          </aside>
          <main class="dge-center">
            <canvas class="dge-map" width="640" height="640"></canvas>
          </main>
          <aside class="dge-right">
            <div class="dge-mini-title">セル</div>
            <div class="dge-cell-info">-</div>
            <div class="dge-mini-title">プレビュー位置</div>
            <div class="dge-preview-info">-</div>
            <div class="dge-compass">
              <button data-preview="turn-left">←</button>
              <button data-preview="forward">↑</button>
              <button data-preview="turn-right">→</button>
              <button data-preview="back">↓</button>
            </div>
          </aside>
        </div>
      </section>
      <section class="dge-panel" data-panel="preview">
        <div class="dge-preview-shell">
          <div class="dge-preview-stage">
            <canvas class="dge-view" width="200" height="128"></canvas>
            <canvas class="dge-minimap" width="160" height="160"></canvas>
          </div>
          <div class="dge-preview-controls">
            <button data-preview="turn-left">←</button>
            <button data-preview="forward">↑</button>
            <button data-preview="turn-right">→</button>
            <button data-preview="back">↓</button>
          </div>
        </div>
      </section>
      <section class="dge-panel" data-panel="assets">
        <div class="dge-assets"></div>
      </section>
    </div>
  `;
  root.tabIndex = 0;

  const ui = {
    status: root.querySelector('.dge-status'),
    dirty: root.querySelector('.dge-dirty'),
    floorSelect: root.querySelector('.dge-floor-select'),
    name: root.querySelector('.dge-floor-name'),
    width: root.querySelector('.dge-width'),
    height: root.querySelector('.dge-height'),
    tools: root.querySelector('.dge-tools'),
    map: root.querySelector('.dge-map'),
    view: root.querySelector('.dge-view'),
    cellInfo: root.querySelector('.dge-cell-info'),
    previewInfo: root.querySelector('.dge-preview-info'),
    assets: root.querySelector('.dge-assets'),
    tabs: Array.from(root.querySelectorAll('[data-tab]')),
    panels: Array.from(root.querySelectorAll('[data-panel]')),
    minimap: root.querySelector('.dge-minimap'),
  };
  const mapCtx = ui.map.getContext('2d');
  const viewCtx = ui.view.getContext('2d');
  const minimapCtx = ui.minimap.getContext('2d');
  mapCtx.imageSmoothingEnabled = false;
  viewCtx.imageSmoothingEnabled = false;
  minimapCtx.imageSmoothingEnabled = false;

  function blankCell(walls = 15) {
    return { walls, doors: 0, one_way: 0, dark: false, event: '', stairs: '' };
  }

  function blankFloor(order = 1) {
    const width = 12;
    const height = 12;
    return {
      id: '',
      name: `Floor ${order}`,
      order,
      width,
      height,
      start: { x: 1, y: 1, dir: 1 },
      assets: {},
      cells: Array.from({ length: height }, () => Array.from({ length: width }, () => blankCell(15))),
    };
  }

  function cellAt(x, y) {
    if (!state.current || x < 0 || y < 0 || x >= state.current.width || y >= state.current.height) return null;
    return state.current.cells[y][x];
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    ui.dirty.textContent = state.dirty ? '未保存' : '';
  }

  function setStatus(text) {
    ui.status.textContent = text || '';
  }

  function normalizeFloorForUi(floor) {
    const width = Math.max(4, Math.min(MAX_SIZE, Number(floor?.width || 12)));
    const height = Math.max(4, Math.min(MAX_SIZE, Number(floor?.height || 12)));
    const cells = Array.from({ length: height }, (_, y) => (
      Array.from({ length: width }, (_, x) => ({ ...blankCell(), ...(floor?.cells?.[y]?.[x] || {}) }))
    ));
    return {
      ...blankFloor(floor?.order || 1),
      ...(floor || {}),
      width,
      height,
      cells,
      start: { x: 1, y: 1, dir: 1, ...(floor?.start || {}) },
      assets: { ...state.defaultAssets, ...(floor?.assets || {}) },
    };
  }

  function syncForm() {
    if (!state.current) return;
    ui.name.value = state.current.name || '';
    ui.width.value = state.current.width;
    ui.height.value = state.current.height;
    state.preview = { ...state.current.start };
    stopPreviewAnimation();
    renderAll();
  }

  function readFormIntoCurrent() {
    if (!state.current) return;
    state.current.name = ui.name.value || state.current.name;
    resizeFloor(Number(ui.width.value), Number(ui.height.value));
  }

  function resizeFloor(width, height) {
    if (!state.current) return;
    const nextW = Math.max(4, Math.min(MAX_SIZE, Number(width || state.current.width)));
    const nextH = Math.max(4, Math.min(MAX_SIZE, Number(height || state.current.height)));
    if (nextW === state.current.width && nextH === state.current.height) return;
    const old = state.current.cells;
    state.current.cells = Array.from({ length: nextH }, (_, y) => (
      Array.from({ length: nextW }, (_, x) => old[y]?.[x] ? { ...old[y][x] } : blankCell(15))
    ));
    state.current.width = nextW;
    state.current.height = nextH;
    state.current.start.x = Math.min(state.current.start.x, nextW - 1);
    state.current.start.y = Math.min(state.current.start.y, nextH - 1);
  }

  function renderToolButtons() {
    ui.tools.innerHTML = TOOLS.map((tool) => (
      `<button class="${tool.id === state.tool ? 'active' : ''}" data-tool="${tool.id}">${tool.label}</button>`
    )).join('');
  }

  function renderFloorSelect() {
    ui.floorSelect.innerHTML = state.floors.map((floor) => (
      `<option value="${escapeHtml(floor.id)}">${escapeHtml(floor.name || floor.id)}</option>`
    )).join('');
    if (state.current) ui.floorSelect.value = state.current.id;
  }

  function renderMap() {
    const floor = state.current;
    if (!floor) return;
    const size = Math.floor(Math.min(ui.map.width / floor.width, ui.map.height / floor.height));
    const ox = Math.floor((ui.map.width - size * floor.width) / 2);
    const oy = Math.floor((ui.map.height - size * floor.height) / 2);
    mapCtx.fillStyle = '#101417';
    mapCtx.fillRect(0, 0, ui.map.width, ui.map.height);
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        const px = ox + x * size;
        const py = oy + y * size;
        mapCtx.fillStyle = cell.dark ? '#17151f' : '#1f2825';
        mapCtx.fillRect(px, py, size, size);
        if (cell.event === 'chest') drawMapText('宝', px, py, size, '#f3b44b');
        if (cell.stairs === 'up') drawMapText('↑', px, py, size, '#9fd3ff');
        if (cell.stairs === 'down') drawMapText('↓', px, py, size, '#c7a0ff');
      }
    }
    drawEdges(floor, ox, oy, size, 'walls', '#d7c8a0', 4);
    drawEdges(floor, ox, oy, size, 'doors', '#d98a42', 3);
    drawEdges(floor, ox, oy, size, 'one_way', '#77d4ff', 2, true);
    mapCtx.strokeStyle = '#45514d';
    mapCtx.lineWidth = 1;
    for (let x = 0; x <= floor.width; x++) line(ox + x * size, oy, ox + x * size, oy + floor.height * size);
    for (let y = 0; y <= floor.height; y++) line(ox, oy + y * size, ox + floor.width * size, oy + y * size);
    drawMapText('S', ox + floor.start.x * size, oy + floor.start.y * size, size, '#75f0a8');
  }

  function drawMapText(text, px, py, size, color) {
    mapCtx.fillStyle = color;
    mapCtx.font = `${Math.max(12, Math.floor(size * 0.45))}px sans-serif`;
    mapCtx.textAlign = 'center';
    mapCtx.textBaseline = 'middle';
    mapCtx.fillText(text, px + size / 2, py + size / 2);
  }

  function drawEdges(floor, ox, oy, size, key, color, width, arrow = false) {
    mapCtx.strokeStyle = color;
    mapCtx.lineWidth = width;
    mapCtx.lineCap = 'square';
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        const px = ox + x * size;
        const py = oy + y * size;
        DIRS.forEach((dir) => {
          if (!(cell[key] & dir.bit)) return;
          if ((dir.id === 'w' && x > 0) || (dir.id === 'n' && y > 0)) return;
          const edge = edgeLine(px, py, size, dir.id);
          line(edge.x0, edge.y0, edge.x1, edge.y1);
          if (arrow) drawArrow(edge, dir);
        });
      }
    }
  }

  function drawArrow(edge, dir) {
    const cx = (edge.x0 + edge.x1) / 2;
    const cy = (edge.y0 + edge.y1) / 2;
    mapCtx.fillStyle = '#77d4ff';
    mapCtx.beginPath();
    mapCtx.arc(cx + dir.dx * 4, cy + dir.dy * 4, 3, 0, Math.PI * 2);
    mapCtx.fill();
  }

  function edgeLine(px, py, size, dir) {
    if (dir === 'n') return { x0: px, y0: py, x1: px + size, y1: py };
    if (dir === 's') return { x0: px, y0: py + size, x1: px + size, y1: py + size };
    if (dir === 'e') return { x0: px + size, y0: py, x1: px + size, y1: py + size };
    return { x0: px, y0: py, x1: px, y1: py + size };
  }

  function line(x0, y0, x1, y1) {
    mapCtx.beginPath();
    mapCtx.moveTo(x0, y0);
    mapCtx.lineTo(x1, y1);
    mapCtx.stroke();
  }

  /* ------------------------------------------------------------------
   * 3D プレビュー (render-core による実機同等描画)
   * ------------------------------------------------------------------ */

  /*
   * ビューモデル: エッジ集合・パレット・シェード帯・ビルボードテーブル。
   * テクスチャ / 設定が変わったときだけ再構築する。
   */
  function getViewModel() {
    if (state.viewModel) return state.viewModel;
    const settings = state.settings || {};
    const textures = core.normalizeTextures(state.textures || {});
    const palette = core.buildViewPalette(textures);
    const spaces = core.buildEdgeSpaces(settings);
    const spritePalette = core.buildSpritePalette(textures);
    state.viewModel = {
      textures,
      settings,
      spaces,
      palette,
      darkPalette: core.darkenPalette(palette, DARK_PALETTE_SCALE),
      bands: core.buildBandTables(palette, textures),
      spritePalette,
      sheets: {
        chest: core.renderBillboardSheet(textures.chest, spritePalette),
        stairs_up: core.renderBillboardSheet(textures.stairs_up, spritePalette),
        stairs_down: core.renderBillboardSheet(textures.stairs_down, spritePalette),
      },
      billboards: core.buildBillboardTables(settings),
    };
    return state.viewModel;
  }

  function invalidateViewModel() {
    state.viewModel = null;
  }

  /*
   * 現在のプレビュー状態から描画フレームを決める。
   * 戻り値: { pose, defs, states, mirrored, bbPoses, baseCell }
   */
  function currentPreviewFrame(model) {
    const floor = state.current;
    const anim = state.animation;
    if (!anim) {
      return {
        pose: core.poseStatic(),
        defs: model.spaces.move,
        mirrored: false,
        bbPoses: model.billboards.staticPoses,
        base: { ...state.preview },
      };
    }
    const k = anim.frameIndex;
    if (anim.action === 'forward') {
      return {
        pose: model.spaces.frames.fwdPoses[k],
        defs: model.spaces.move,
        mirrored: false,
        bbPoses: model.billboards.fwdPoses[k],
        base: { x: anim.from.x, y: anim.from.y, dir: anim.from.dir },
      };
    }
    if (anim.action === 'back') {
      /* 後退 = 移動先セル基準の前進フレーム逆再生 */
      const reversed = model.spaces.frames.fwdPoses.length - 1 - k;
      return {
        pose: model.spaces.frames.fwdPoses[reversed],
        defs: model.spaces.move,
        mirrored: false,
        bbPoses: model.billboards.fwdPoses[reversed],
        base: { x: anim.to.x, y: anim.to.y, dir: anim.to.dir },
      };
    }
    const left = anim.action === 'turn-left';
    return {
      pose: model.spaces.frames.turnPoses[k],
      defs: left ? model.spaces.turnMirrored : model.spaces.turn,
      turnDefs: model.spaces.turn,
      mirrored: left,
      bbPoses: model.billboards.turnPoses[k],
      base: { x: anim.from.x, y: anim.from.y, dir: anim.from.dir },
    };
  }

  function renderPreview() {
    const floor = state.current;
    if (!floor) return;
    const model = getViewModel();
    const frame = currentPreviewFrame(model);
    const states = core.sampleEdgeStates(floor, frame.base.x, frame.base.y, frame.base.dir, frame.defs);
    /* 左回転: 鏡像エッジで右回転テーブルを評価し、水平反転で合成する (実機と同一) */
    const defsForRender = frame.mirrored ? frame.turnDefs : frame.defs;
    let indices = core.renderView(frame.pose, defsForRender, states, model.textures, model.palette, model.bands);
    if (frame.mirrored) indices = mirrorIndices(indices);

    const cell = cellAt(state.preview.x, state.preview.y);
    const paletteForView = cell?.dark ? model.darkPalette : model.palette;
    const image = viewCtx.createImageData(VIEW_W, VIEW_H);
    core.indicesToRgba(indices, paletteForView, image.data);
    drawBillboardsInto(image.data, model, frame, floor);
    viewCtx.putImageData(image, 0, 0);

    drawPreviewMinimap(floor, minimapPose());
    ui.previewInfo.textContent = `X:${state.preview.x} Y:${state.preview.y} ${DIRS[state.preview.dir]?.label || 'E'}`;
  }

  function mirrorIndices(indices) {
    const out = new Uint8Array(indices.length);
    for (let y = 0; y < VIEW_H; y++) {
      const rowStart = y * VIEW_W;
      for (let x = 0; x < VIEW_W; x++) {
        out[rowStart + x] = indices[rowStart + (VIEW_W - 1 - x)];
      }
    }
    return out;
  }

  /* ビルボード: 実機のスプライト描画と同じテーブル・同じ LOS ルールで合成する */
  function drawBillboardsInto(rgba, model, frame, floor) {
    const cells = model.billboards.cells;
    const size = core.BB_FRAME_SIZE;
    for (let i = 0; i < cells.length; i++) {
      const pose = frame.bbPoses[i];
      if (!pose || pose.frame < 0) continue;
      let dd = cells[i].dd;
      let dl = cells[i].dl;
      if (frame.mirrored) dl = -dl;
      const dir = frame.base.dir & 3;
      const right = (dir + 1) & 3;
      const ax = frame.base.x + dd * DIRS[dir].dx + dl * DIRS[right].dx;
      const ay = frame.base.y + dd * DIRS[dir].dy + dl * DIRS[right].dy;
      const cell = (ax >= 0 && ay >= 0 && ax < floor.width && ay < floor.height) ? floor.cells[ay][ax] : null;
      if (!cell) continue;
      let sheet = null;
      if (cell.event === 'chest') sheet = model.sheets.chest;
      else if (cell.stairs === 'up') sheet = model.sheets.stairs_up;
      else if (cell.stairs === 'down') sheet = model.sheets.stairs_down;
      if (!sheet) continue;
      if (!core.losVisible(floor, frame.base.x, frame.base.y, dir, dd, dl)) continue;
      const sx0 = frame.mirrored ? (VIEW_W - pose.x - size) : pose.x;
      const frameOffset = pose.frame * size;
      for (let y = 0; y < size; y++) {
        const dy = pose.y + y;
        if (dy < 0 || dy >= VIEW_H) continue;
        for (let x = 0; x < size; x++) {
          const dx = sx0 + x;
          if (dx < 0 || dx >= VIEW_W) continue;
          const paletteIndex = sheet.pixels[(y * sheet.width) + frameOffset + x];
          if (!paletteIndex) continue;
          const color = model.spritePalette[paletteIndex];
          const dest = ((dy * VIEW_W) + dx) * 4;
          rgba[dest] = color.r;
          rgba[dest + 1] = color.g;
          rgba[dest + 2] = color.b;
          rgba[dest + 3] = 255;
        }
      }
    }
  }

  /* ミニマップ表示用の補間ポーズ (見た目用であり実機挙動には影響しない) */
  function minimapPose() {
    if (!state.animation) {
      return {
        x: state.preview.x + 0.5,
        y: state.preview.y + 0.5,
        angle: dirAngle(state.preview.dir),
      };
    }
    const anim = state.animation;
    const t = core.easeSmooth((anim.frameIndex + 1) / (anim.total + 1));
    return {
      x: lerp(anim.from.x + 0.5, anim.to.x + 0.5, t),
      y: lerp(anim.from.y + 0.5, anim.to.y + 0.5, t),
      angle: lerpAngle(dirAngle(anim.from.dir), dirAngle(anim.to.dir), t),
    };
  }

  function drawPreviewMinimap(floor, pose) {
    const canvas = ui.minimap;
    const ctx = minimapCtx;
    const padding = 10;
    const size = Math.floor(Math.min((canvas.width - padding * 2) / floor.width, (canvas.height - padding * 2) / floor.height));
    const mapW = size * floor.width;
    const mapH = size * floor.height;
    const ox = Math.floor((canvas.width - mapW) / 2);
    const oy = Math.floor((canvas.height - mapH) / 2);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 13, 14, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        ctx.fillStyle = cell.dark ? '#15131d' : '#26302d';
        ctx.fillRect(ox + x * size, oy + y * size, Math.max(1, size - 1), Math.max(1, size - 1));
        if (cell.event === 'chest') drawMiniDot(ctx, ox, oy, size, x, y, '#f3b44b');
        if (cell.stairs === 'up') drawMiniDot(ctx, ox, oy, size, x, y, '#9fd3ff');
        if (cell.stairs === 'down') drawMiniDot(ctx, ox, oy, size, x, y, '#c7a0ff');
      }
    }
    drawMiniEdges(ctx, floor, ox, oy, size, 'walls', '#d7c8a0', 2);
    drawMiniEdges(ctx, floor, ox, oy, size, 'doors', '#d98a42', 2);
    const px = ox + pose.x * size;
    const py = oy + pose.y * size;
    const angle = pose.angle;
    ctx.fillStyle = '#75f0a8';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(angle) * size * 0.46, py + Math.sin(angle) * size * 0.46);
    ctx.lineTo(px + Math.cos(angle + 2.45) * size * 0.34, py + Math.sin(angle + 2.45) * size * 0.34);
    ctx.lineTo(px + Math.cos(angle - 2.45) * size * 0.34, py + Math.sin(angle - 2.45) * size * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#101417';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawMiniDot(ctx, ox, oy, size, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.floor(ox + x * size + size * 0.35),
      Math.floor(oy + y * size + size * 0.35),
      Math.max(2, Math.floor(size * 0.3)),
      Math.max(2, Math.floor(size * 0.3)),
    );
  }

  function drawMiniEdges(ctx, floor, ox, oy, size, key, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        const px = ox + x * size;
        const py = oy + y * size;
        DIRS.forEach((dir) => {
          if (!(cell[key] & dir.bit)) return;
          if ((dir.id === 'w' && x > 0) || (dir.id === 'n' && y > 0)) return;
          const edge = edgeLine(px, py, size, dir.id);
          ctx.beginPath();
          ctx.moveTo(edge.x0, edge.y0);
          ctx.lineTo(edge.x1, edge.y1);
          ctx.stroke();
        });
      }
    }
  }

  /* ------------------------------------------------------------------
   * テクスチャ読み込み (アトラス + サイドカー)
   * ------------------------------------------------------------------ */

  async function refreshProjectDir() {
    if (state.projectDir) return state.projectDir;
    const project = await api.electronAPI?.getCurrentProject?.().catch(() => null);
    state.projectDir = project?.projectDir || '';
    return state.projectDir;
  }

  async function loadTexturesForCurrent() {
    const floor = state.current;
    if (!floor) return;
    const projectDir = await refreshProjectDir();
    const refs = { ...state.defaultAssets, ...(floor.assets || {}) };
    const loaded = {};
    await Promise.all(core.TEXTURE_KINDS.map(async (kind) => {
      loaded[kind] = await loadTextureRef(refs[`${kind}_texture`], projectDir, kind);
    }));
    state.textures = loaded;
    invalidateViewModel();
    renderPreview();
  }

  async function loadTextureRef(ref, projectDir, kind) {
    const parsed = parseTextureRef(ref || DEFAULT_ASSET_REFS[`${kind}_texture`] || DEFAULT_ASSET_REFS.wall_texture);
    const cacheKey = `${parsed.path}#${parsed.tag || kind}`;
    if (state.textureCache.has(cacheKey)) return state.textureCache.get(cacheKey);
    const sourcePath = resolveAssetPath(parsed.path, projectDir);
    const read = sourcePath ? await api.electronAPI?.readFileAsDataUrl?.(sourcePath).catch(() => null) : null;
    if (!read?.ok || !read.dataUrl) return core.makeFallbackTexture(kind);
    const image = await loadImage(read.dataUrl).catch(() => null);
    if (!image) return core.makeFallbackTexture(kind);
    const layout = await loadAtlasLayout(sourcePath);
    const texture = cropAtlasTexture(image, parsed.tag || kind, layout) || core.makeFallbackTexture(kind);
    state.textureCache.set(cacheKey, texture);
    return texture;
  }

  /* アトラスサイドカー <atlas>.json ({"columns":4,"rows":2}) を読む */
  async function loadAtlasLayout(imagePath) {
    const sidecarPath = imagePath.replace(/\.png$/i, '.json');
    const cacheKey = `layout:${sidecarPath}`;
    if (state.textureCache.has(cacheKey)) return state.textureCache.get(cacheKey);
    let layout = core.ATLAS_LAYOUT_LEGACY;
    const read = await api.electronAPI?.readFileAsDataUrl?.(sidecarPath).catch(() => null);
    if (read?.ok && read.dataUrl) {
      try {
        const base64 = String(read.dataUrl).split(',')[1] || '';
        const meta = JSON.parse(decodeURIComponent(escape(atob(base64))));
        layout = core.atlasLayoutFor(meta);
      } catch (_) {
        layout = core.ATLAS_LAYOUT_LEGACY;
      }
    }
    state.textureCache.set(cacheKey, layout);
    return layout;
  }

  function parseTextureRef(ref) {
    const [pathPart, tagPart] = String(ref || '').split('#');
    return { path: pathPart.trim(), tag: String(tagPart || '').trim() };
  }

  function resolveAssetPath(assetPath, projectDir) {
    const clean = String(assetPath || '').replace(/\\/g, '/').replace(/^res\//, '');
    if (!clean) return '';
    if (/^\/|^[A-Za-z]:\//.test(clean)) return clean;
    if (!projectDir) return '';
    return `${projectDir.replace(/\/$/, '')}/res/${clean}`;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  function cropAtlasTexture(image, tag, layout) {
    const coords = layout.rects[tag];
    if (!coords) return null;
    const cellW = Math.floor(image.naturalWidth / layout.columns);
    const cellH = Math.floor(image.naturalHeight / layout.rows);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, cellW);
    canvas.height = Math.max(1, cellH);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, coords[0] * cellW, coords[1] * cellH, cellW, cellH, 0, 0, cellW, cellH);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: data.data };
  }

  function dirAngle(dir) {
    return [-Math.PI / 2, 0, Math.PI / 2, Math.PI][dir & 3] || 0;
  }

  function normalizeAngle(value) {
    let angle = value;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpAngle(a, b, t) {
    return a + normalizeAngle(b - a) * t;
  }

  /* ------------------------------------------------------------------
   * 素材タブ / 生成情報
   * ------------------------------------------------------------------ */

  function renderAssets() {
    const floor = state.current;
    if (!floor) return;
    const keys = [
      ['wall_texture', '壁'],
      ['door_texture', '扉'],
      ['floor_texture', '床'],
      ['ceiling_texture', '天井'],
      ['chest_texture', '宝箱'],
      ['stairs_up_texture', '上り階段'],
      ['stairs_down_texture', '下り階段'],
    ];
    ui.assets.innerHTML = keys.map(([key, label]) => `
      <label class="dge-field">${label}<input data-asset="${key}" type="text" value="${escapeHtml(floor.assets?.[key] || '')}"></label>
    `).join('') + renderGeneratedAssets();
  }

  function renderGeneratedAssets() {
    const exportInfo = state.exportInfo || {};
    const tileCount = exportInfo.patternTileCount ? `${exportInfo.patternTileCount} tiles` : '-';
    const warnings = Array.isArray(exportInfo.warnings) && exportInfo.warnings.length
      ? `<div class="dge-export-warnings">${exportInfo.warnings.map((w) => `⚠ ${escapeHtml(w)}`).join('<br>')}</div>`
      : '';
    return `
      <div class="dge-generated-assets">
        <button class="dge-wide" data-action="export-assets">SGDKアセット生成</button>
        <div>Tileset: ${escapeHtml(shortProjectPath(exportInfo.patternTilesetPath || 'res/dungeon/generated/dungeon_view_tileset.png'))}</div>
        <div>Res: ${escapeHtml(shortProjectPath(exportInfo.resourcePath || 'res/resources.res'))}</div>
        <div>${escapeHtml(tileCount)}</div>
        ${warnings}
      </div>
    `;
  }

  function shortProjectPath(filePath) {
    if (!filePath || !state.projectDir) return filePath || '';
    return String(filePath).startsWith(state.projectDir) ? String(filePath).slice(state.projectDir.length + 1) : filePath;
  }

  function renderAll() {
    renderToolButtons();
    renderFloorSelect();
    renderMap();
    renderPreview();
    renderAssets();
  }

  /* ------------------------------------------------------------------
   * マップ編集
   * ------------------------------------------------------------------ */

  function closestEdge(offsetX, offsetY, size) {
    const distances = [
      ['n', offsetY],
      ['s', size - offsetY],
      ['w', offsetX],
      ['e', size - offsetX],
    ].sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  function toggleEdge(x, y, dirId, key, forceOff = false) {
    const dir = DIR_BY_ID[dirId];
    const cell = cellAt(x, y);
    if (!cell || !dir) return;
    const next = forceOff ? false : !(cell[key] & dir.bit);
    cell[key] = next ? (cell[key] | dir.bit) : (cell[key] & ~dir.bit);
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    const neighbor = cellAt(nx, ny);
    const opposite = DIR_BY_ID[dir.opposite];
    if (neighbor) neighbor[key] = next ? (neighbor[key] | opposite.bit) : (neighbor[key] & ~opposite.bit);
  }

  function handleMapClick(event) {
    const floor = state.current;
    if (!floor) return;
    const rect = ui.map.getBoundingClientRect();
    const scaleX = ui.map.width / rect.width;
    const scaleY = ui.map.height / rect.height;
    const px = (event.clientX - rect.left) * scaleX;
    const py = (event.clientY - rect.top) * scaleY;
    const size = Math.floor(Math.min(ui.map.width / floor.width, ui.map.height / floor.height));
    const ox = Math.floor((ui.map.width - size * floor.width) / 2);
    const oy = Math.floor((ui.map.height - size * floor.height) / 2);
    const x = Math.floor((px - ox) / size);
    const y = Math.floor((py - oy) / size);
    const cell = cellAt(x, y);
    if (!cell) return;
    const edge = closestEdge(px - ox - x * size, py - oy - y * size, size);
    if (state.tool === 'wall') toggleEdge(x, y, edge, 'walls');
    if (state.tool === 'door') {
      toggleEdge(x, y, edge, 'doors');
      toggleEdge(x, y, edge, 'walls', true);
    }
    if (state.tool === 'one_way') toggleEdge(x, y, edge, 'one_way');
    if (state.tool === 'dark') cell.dark = !cell.dark;
    if (state.tool === 'chest') cell.event = cell.event === 'chest' ? '' : 'chest';
    if (state.tool === 'stairs_up') cell.stairs = cell.stairs === 'up' ? '' : 'up';
    if (state.tool === 'stairs_down') cell.stairs = cell.stairs === 'down' ? '' : 'down';
    if (state.tool === 'start') state.current.start = { x, y, dir: DIR_INDEX[edge] ?? 1 };
    if (state.tool === 'erase') Object.assign(cell, blankCell(0));
    state.preview = { ...state.current.start };
    ui.cellInfo.textContent = `X:${x} Y:${y} edge:${edge}`;
    setDirty(true);
    renderAll();
  }

  /* ------------------------------------------------------------------
   * プレビュー移動 (実機と同じ離散フレーム再生)
   * ------------------------------------------------------------------ */

  function canPreviewMove(dirIndex) {
    const dir = DIRS[dirIndex];
    const cell = cellAt(state.preview.x, state.preview.y);
    if (!cell || (cell.walls & dir.bit)) return false;
    return Boolean(cellAt(state.preview.x + dir.dx, state.preview.y + dir.dy));
  }

  function movePreview(action) {
    if (!state.current || state.animation) return;
    const model = getViewModel();
    const from = { ...state.preview };
    const to = { ...state.preview };
    if (action === 'turn-left') to.dir = (to.dir + 3) & 3;
    if (action === 'turn-right') to.dir = (to.dir + 1) & 3;
    if (action === 'forward' && canPreviewMove(to.dir)) {
      to.x += DIRS[to.dir].dx;
      to.y += DIRS[to.dir].dy;
    }
    if (action === 'back') {
      const dir = (state.preview.dir + 2) & 3;
      if (canPreviewMove(dir)) {
        to.x += DIRS[dir].dx;
        to.y += DIRS[dir].dy;
      }
    }
    if (from.x === to.x && from.y === to.y && from.dir === to.dir) return;
    const isTurn = action === 'turn-left' || action === 'turn-right';
    const total = isTurn ? model.spaces.frames.turnPoses.length : model.spaces.frames.fwdPoses.length;
    state.animation = { action, from, to, frameIndex: 0, total, lastStep: performance.now() };
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = requestAnimationFrame(stepPreviewAnimation);
  }

  function stepPreviewAnimation() {
    const anim = state.animation;
    if (!anim) return;
    renderPreview();
    const now = performance.now();
    if (now - anim.lastStep >= FRAME_STEP_MS) {
      anim.lastStep = now;
      anim.frameIndex++;
      if (anim.frameIndex >= anim.total) {
        state.preview = { ...anim.to };
        state.animation = null;
        renderPreview();
        return;
      }
    }
    state.animationFrame = requestAnimationFrame(stepPreviewAnimation);
  }

  function stopPreviewAnimation() {
    cancelAnimationFrame(state.animationFrame);
    state.animation = null;
  }

  /* ------------------------------------------------------------------
   * フロア CRUD / フック連携
   * ------------------------------------------------------------------ */

  async function refresh() {
    state.projectDir = '';
    await refreshProjectDir();
    const result = await api.plugins.invokeHook(plugin.id, 'listDungeonFloors', {});
    if (!result?.ok) {
      setStatus(result?.error || '読み込みに失敗しました');
      return;
    }
    state.defaultAssets = { ...DEFAULT_ASSET_REFS, ...(result.defaultAssets || {}) };
    state.floors = (result.floors || []).map(normalizeFloorForUi);
    state.settings = result.settings || null;
    state.current = state.floors[0] || blankFloor(1);
    invalidateViewModel();
    syncForm();
    await loadTexturesForCurrent();
    state.exportInfo = null;
    setDirty(false);
    setStatus(`${state.floors.length} floor`);
  }

  async function saveCurrent() {
    if (!state.current) return;
    readFormIntoCurrent();
    const result = await api.plugins.invokeHook(plugin.id, 'saveDungeonFloor', { floor: state.current });
    if (!result?.ok) {
      setStatus(result?.error || '保存に失敗しました');
      return;
    }
    state.current = normalizeFloorForUi(result.floor);
    const index = state.floors.findIndex((floor) => floor.id === state.current.id);
    if (index >= 0) state.floors[index] = state.current;
    else state.floors.push(state.current);
    setDirty(false);
    state.exportInfo = result.export || state.exportInfo;
    setStatus('保存しました');
    syncForm();
    void loadTexturesForCurrent();
  }

  async function createFloor() {
    const floor = blankFloor(state.floors.length + 1);
    const result = await api.plugins.invokeHook(plugin.id, 'saveDungeonFloor', { create: true, floor });
    if (result?.ok) await refresh();
  }

  async function deleteFloor() {
    if (!state.current?.id) return;
    const result = await api.plugins.invokeHook(plugin.id, 'deleteDungeonFloor', { id: state.current.id });
    if (result?.ok) await refresh();
    else setStatus(result?.error || '削除に失敗しました');
  }

  async function moveFloor(direction) {
    if (!state.current?.id) return;
    const result = await api.plugins.invokeHook(plugin.id, 'moveDungeonFloor', { id: state.current.id, direction });
    if (result?.ok) await refresh();
  }

  async function generateFloor() {
    const width = Number(ui.width.value || state.current?.width || 12);
    const height = Number(ui.height.value || state.current?.height || 12);
    const result = await api.plugins.invokeHook(plugin.id, 'generateDungeonFloor', { width, height, name: ui.name.value || undefined });
    if (!result?.ok) {
      setStatus(result?.error || '生成に失敗しました');
      return;
    }
    await refresh();
    state.current = state.floors.find((floor) => floor.id === result.floor.id) || state.current;
    syncForm();
  }

  async function exportAssets() {
    if (state.dirty) await saveCurrent();
    setStatus('SGDKアセット生成中...');
    const result = await api.plugins.invokeHook(plugin.id, 'exportDungeonData', {});
    if (!result?.ok) {
      setStatus(result?.error || 'SGDKアセット生成に失敗しました');
      return;
    }
    state.exportInfo = result;
    const warn = Array.isArray(result.warnings) && result.warnings.length ? ' ⚠' : '';
    setStatus(`SGDK ${result.patternTileCount || 0} tiles${result.cached ? ' (cache)' : ''}${warn}`);
    renderAssets();
  }

  function switchTab(tab) {
    state.activeTab = tab;
    ui.tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    ui.panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    renderAll();
  }

  function observePageActivation() {
    state.activationObserver = new MutationObserver(() => {
      const active = root.classList.contains('active');
      if (active && !state.wasActive) void refresh();
      state.wasActive = active;
    });
    state.activationObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  root.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    const tab = event.target?.dataset?.tab;
    const tool = event.target?.dataset?.tool;
    const preview = event.target?.dataset?.preview;
    if (tab) switchTab(tab);
    if (tool) {
      state.tool = tool;
      renderToolButtons();
    }
    if (preview) movePreview(preview);
    if (action === 'save') void saveCurrent();
    if (action === 'new') void createFloor();
    if (action === 'delete') void deleteFloor();
    if (action === 'move-up') void moveFloor('up');
    if (action === 'move-down') void moveFloor('down');
    if (action === 'generate') void generateFloor();
    if (action === 'export-assets') void exportAssets();
  });
  ui.map.addEventListener('click', handleMapClick);
  ui.floorSelect.addEventListener('change', () => {
    state.current = state.floors.find((floor) => floor.id === ui.floorSelect.value) || state.floors[0] || null;
    invalidateViewModel();
    syncForm();
    void loadTexturesForCurrent();
  });
  [ui.name, ui.width, ui.height].forEach((input) => input.addEventListener('input', () => {
    readFormIntoCurrent();
    setDirty(true);
    renderAll();
  }));
  ui.assets.addEventListener('input', (event) => {
    const key = event.target?.dataset?.asset;
    if (!key || !state.current) return;
    state.current.assets[key] = event.target.value;
    setDirty(true);
    void loadTexturesForCurrent();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') movePreview('forward');
    if (event.key === 'ArrowDown') movePreview('back');
    if (event.key === 'ArrowLeft') movePreview('turn-left');
    if (event.key === 'ArrowRight') movePreview('turn-right');
  });

  registerCapability('dungeon-game-editor', { root, refresh });
  observePageActivation();
  void refresh();

  return {
    deactivate() {
      cancelAnimationFrame(state.animationFrame);
      state.activationObserver?.disconnect?.();
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
