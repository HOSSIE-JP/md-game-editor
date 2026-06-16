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
  floor_texture: 'dungeon/textures/dungeon_texture_atlas.png#floor',
  ceiling_texture: 'dungeon/textures/dungeon_texture_atlas.png#ceiling',
  chest_texture: 'dungeon/textures/dungeon_texture_atlas.png#chest',
  stairs_up_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_up',
  stairs_down_texture: 'dungeon/textures/dungeon_texture_atlas.png#stairs_down',
};
const ATLAS_RECTS = {
  wall: [0, 0],
  floor: [1, 0],
  ceiling: [2, 0],
  chest: [0, 1],
  stairs_up: [1, 1],
  stairs_down: [2, 1],
};
const VIEW_W = 200;
const VIEW_H = 128;
const VIEW_HORIZON = 64;
const VIEW_PROJECT_Y = 58;
const VIEW_PROJECT_X = VIEW_PROJECT_Y;
const FOV = Math.atan((VIEW_W / 2) / VIEW_PROJECT_X) * 2;
const VIEW_EYE_Z = 0.42;
const VIEW_NEAR_CLIP = 0.045;
const VIEW_CAMERA_BACKSTEP = 0.18;
const VIEW_DEPTH_EPSILON = 0.002;
const WALL_SEGMENT_OVERLAP = 0.01;
const VIEW_MODEL_RADIUS = 7;
const ANIMATION_MS = 320;
const PREVIEW_TRANSPARENT_KEY = { r: 255, g: 0, b: 255 };

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
    textures: {},
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

  function renderPreview() {
    const floor = state.current;
    if (!floor) return;
    const pose = previewPose();
    drawPreviewGeometry(floor, pose);
    renderPreviewMinimap(floor, pose);
    ui.previewInfo.textContent = `X:${state.preview.x} Y:${state.preview.y} ${DIRS[state.preview.dir]?.label || 'E'}`;
  }

  function renderPreviewMinimap(floor, pose) {
    drawPreviewMinimap(floor, pose);
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

  function previewPose() {
    if (!state.animation) {
      return {
        x: state.preview.x + 0.5,
        y: state.preview.y + 0.5,
        angle: dirAngle(state.preview.dir),
      };
    }
    const now = performance.now();
    const t = Math.min(1, Math.max(0, (now - state.animation.startedAt) / ANIMATION_MS));
    const eased = easeInOut(t);
    const from = state.animation.from;
    const to = state.animation.to;
    return {
      x: lerp(from.x + 0.5, to.x + 0.5, eased),
      y: lerp(from.y + 0.5, to.y + 0.5, eased),
      angle: lerpAngle(dirAngle(from.dir), dirAngle(to.dir), eased),
    };
  }

  function drawPreviewGeometry(floor, pose) {
    const image = viewCtx.createImageData(VIEW_W, VIEW_H);
    const pixels = image.data;
    const zBuffer = new Float32Array(VIEW_W * VIEW_H);
    zBuffer.fill(Number.POSITIVE_INFINITY);
    const currentCell = cellAt(Math.floor(pose.x), Math.floor(pose.y)) || blankCell();
    const dark = currentCell.dark;
    const cameraPose = previewCameraPose(pose);
    drawPreviewPlanes(pixels, cameraPose, dark);
    drawPreviewWallModel(pixels, zBuffer, floor, cameraPose, dark);
    viewCtx.putImageData(image, 0, 0);
    drawPreviewBillboards(floor, cameraPose, zBuffer, dark);
  }

  function previewCameraPose(pose) {
    return {
      ...pose,
      x: pose.x - Math.cos(pose.angle) * VIEW_CAMERA_BACKSTEP,
      y: pose.y - Math.sin(pose.angle) * VIEW_CAMERA_BACKSTEP,
    };
  }

  function drawPreviewPlanes(pixels, _pose, _dark) {
    for (let sy = 0; sy < VIEW_H; sy++) {
      for (let sx = 0; sx < VIEW_W; sx++) {
        writeSolid(pixels, sx, sy, PREVIEW_TRANSPARENT_KEY.r, PREVIEW_TRANSPARENT_KEY.g, PREVIEW_TRANSPARENT_KEY.b);
      }
    }
  }

  function drawPreviewWallModel(pixels, zBuffer, floor, pose, dark) {
    drawWallRuns(pixels, zBuffer, floor, pose, dark, 'h');
    drawWallRuns(pixels, zBuffer, floor, pose, dark, 'v');
  }

  function drawWallRuns(pixels, zBuffer, floor, pose, dark, axis) {
    const lineCount = axis === 'h' ? floor.height + 1 : floor.width + 1;
    const segmentCount = axis === 'h' ? floor.width : floor.height;
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      let runKind = '';
      let runStart = 0;
      for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
        const kind = segmentIndex < segmentCount ? edgeKindAtGrid(floor, axis, segmentIndex, lineIndex) : '';
        if (kind && kind === runKind) continue;
        if (runKind) {
          drawWallRun3D(pixels, zBuffer, pose, runStart, segmentIndex, lineIndex, axis, runKind, dark);
        }
        runKind = kind;
        runStart = segmentIndex;
      }
    }
  }

  function drawWallRun3D(pixels, zBuffer, pose, runStart, runEnd, lineIndex, axis, kind, dark) {
    for (let segmentIndex = runStart; segmentIndex < runEnd; segmentIndex++) {
      const start = segmentIndex - (segmentIndex > runStart ? WALL_SEGMENT_OVERLAP : 0);
      const end = segmentIndex + 1 + (segmentIndex + 1 < runEnd ? WALL_SEGMENT_OVERLAP : 0);
      if (axis === 'h') drawWallSpan3D(pixels, zBuffer, pose, start, lineIndex, end, lineIndex, axis, kind, dark);
      else drawWallSpan3D(pixels, zBuffer, pose, lineIndex, start, lineIndex, end, axis, kind, dark);
    }
  }

  function edgeKindAtGrid(floor, axis, segmentIndex, lineIndex) {
    const first = axis === 'h'
      ? (lineIndex > 0 ? floor.cells[lineIndex - 1]?.[segmentIndex] : null)
      : (lineIndex > 0 ? floor.cells[segmentIndex]?.[lineIndex - 1] : null);
    const second = axis === 'h'
      ? (lineIndex < floor.height ? floor.cells[lineIndex]?.[segmentIndex] : null)
      : (lineIndex < floor.width ? floor.cells[segmentIndex]?.[lineIndex] : null);
    const firstBit = axis === 'h' ? DIR_BY_ID.s.bit : DIR_BY_ID.e.bit;
    const secondBit = axis === 'h' ? DIR_BY_ID.n.bit : DIR_BY_ID.w.bit;
    const door = (first && (first.doors & firstBit)) || (second && (second.doors & secondBit));
    const wall = !first || !second || (first.walls & firstBit) || (second.walls & secondBit);
    if (door) return 'door';
    return wall ? 'wall' : '';
  }

  function drawWallSpan3D(pixels, zBuffer, pose, x0, y0, x1, y1, axis, kind, dark) {
    const length = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const faceShade = wallFaceShade(pose, axis, dark);
    const world = [
      { x: x0, y: y0, z: 0, u: 0, v: 1 },
      { x: x1, y: y1, z: 0, u: length, v: 1 },
      { x: x1, y: y1, z: 1, u: length, v: 0 },
      { x: x0, y: y0, z: 1, u: 0, v: 0 },
    ];
    const clipped = clipCameraPolygon(world.map((point) => toCameraPoint(pose, point)));
    if (clipped.length < 3) return;
    const projected = clipped.map(projectCameraPoint).filter(Boolean);
    if (projected.length < 3) return;
    const texture = textureFor(kind === 'door' ? 'door' : 'wall');
    for (let i = 1; i < projected.length - 1; i++) {
      rasterTriangle(pixels, zBuffer, texture, projected[0], projected[i], projected[i + 1], faceShade);
    }
  }

  function wallFaceShade(pose, axis, dark) {
    const forward = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
    const normal = axis === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const alignment = Math.abs(forward.x * normal.x + forward.y * normal.y);
    const shade = 0.52 + alignment * 0.42;
    return dark ? Math.min(shade, 0.3) : shade;
  }

  function toCameraPoint(pose, point) {
    const forward = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
    const right = { x: -Math.sin(pose.angle), y: Math.cos(pose.angle) };
    const dx = point.x - pose.x;
    const dy = point.y - pose.y;
    return {
      x: dx * right.x + dy * right.y,
      y: point.z - VIEW_EYE_Z,
      z: dx * forward.x + dy * forward.y,
      u: point.u,
      v: point.v,
    };
  }

  function clipCameraPolygon(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const aIn = a.z >= VIEW_NEAR_CLIP;
      const bIn = b.z >= VIEW_NEAR_CLIP;
      if (aIn && bIn) {
        out.push(b);
      } else if (aIn && !bIn) {
        out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)));
      } else if (!aIn && bIn) {
        out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)), b);
      }
    }
    return out;
  }

  function interpolateCameraPoint(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: VIEW_NEAR_CLIP,
      u: lerp(a.u, b.u, t),
      v: lerp(a.v, b.v, t),
    };
  }

  function projectCameraPoint(point) {
    if (point.z < VIEW_NEAR_CLIP) return null;
    const invZ = 1 / point.z;
    return {
      x: VIEW_W / 2 + point.x * VIEW_PROJECT_X * invZ,
      y: VIEW_HORIZON - point.y * VIEW_PROJECT_Y * invZ,
      invZ,
      uOverZ: point.u * invZ,
      vOverZ: point.v * invZ,
    };
  }

  function rasterTriangle(pixels, zBuffer, texture, a, b, c, baseShade) {
    const area = edgeFunction(a, b, c.x, c.y);
    if (Math.abs(area) < 0.0001) return;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(VIEW_W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(VIEW_H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;
        const w0 = edgeFunction(b, c, sampleX, sampleY) / area;
        const w1 = edgeFunction(c, a, sampleX, sampleY) / area;
        const w2 = edgeFunction(a, b, sampleX, sampleY) / area;
        if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
        const invZ = (a.invZ * w0) + (b.invZ * w1) + (c.invZ * w2);
        const depth = 1 / invZ;
        const index = (py * VIEW_W) + px;
        if (depth > zBuffer[index] + VIEW_DEPTH_EPSILON) continue;
        const u = ((a.uOverZ * w0) + (b.uOverZ * w1) + (c.uOverZ * w2)) / invZ;
        const v = ((a.vOverZ * w0) + (b.vOverZ * w1) + (c.vOverZ * w2)) / invZ;
        const shade = Math.max(0.24, baseShade / (1 + depth * 0.08));
        const color = sampleTexture(texture, u, v, shade);
        const dest = index * 4;
        pixels[dest] = color.r;
        pixels[dest + 1] = color.g;
        pixels[dest + 2] = color.b;
        pixels[dest + 3] = 255;
        zBuffer[index] = Math.min(zBuffer[index], depth);
      }
    }
  }

  function edgeFunction(a, b, x, y) {
    return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
  }

  function drawPreviewBillboards(floor, pose, zBuffer, dark) {
    const sprites = [];
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        const texture = billboardTexture(cell);
        if (!texture) continue;
        const dx = x + 0.5 - pose.x;
        const dy = y + 0.5 - pose.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.08 || distance > 6) continue;
        const diff = normalizeAngle(Math.atan2(dy, dx) - pose.angle);
        if (Math.abs(diff) > FOV * 0.6) continue;
        sprites.push({ x, y, texture, distance, diff });
      }
    }
    sprites.sort((a, b) => b.distance - a.distance).forEach((sprite) => {
      const screenX = VIEW_W / 2 + Math.tan(sprite.diff) * VIEW_PROJECT_X;
      const size = Math.max(8, Math.min(72, (VIEW_PROJECT_Y * 0.92) / sprite.distance));
      const x0 = Math.floor(screenX - size / 2);
      const y0 = Math.floor(VIEW_HORIZON + size * 0.42 - size);
      drawTexturedBillboard(sprite.texture, x0, y0, Math.floor(size), Math.floor(size), zBuffer, sprite.distance, dark);
    });
  }

  function drawTexturedBillboard(texture, x0, y0, width, height, zBuffer, distance, dark) {
    const tex = texture || textureFor('chest');
    const shade = dark ? 0.42 : Math.max(0.42, 1 / (1 + distance * 0.08));
    const frame = viewCtx.getImageData(0, 0, VIEW_W, VIEW_H);
    const pixels = frame.data;
    for (let y = 0; y < height; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= VIEW_H) continue;
      for (let x = 0; x < width; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= VIEW_W) continue;
        if (distance > zBuffer[(sy * VIEW_W) + sx] + 0.1) continue;
        const color = sampleTexture(tex, x / Math.max(1, width - 1), y / Math.max(1, height - 1), shade);
        if (color.a < 10 || color.r + color.g + color.b < 18) continue;
        const i = ((sy * VIEW_W) + sx) * 4;
        pixels[i] = color.r;
        pixels[i + 1] = color.g;
        pixels[i + 2] = color.b;
        pixels[i + 3] = 255;
      }
    }
    viewCtx.putImageData(frame, 0, 0);
  }

  function billboardTexture(cell) {
    if (cell.event === 'chest') return textureFor('chest');
    if (cell.stairs === 'up') return textureFor('stairs_up');
    if (cell.stairs === 'down') return textureFor('stairs_down');
    return null;
  }

  function textureFor(kind) {
    return state.textures[kind] || state.textures.wall || makeFallbackTexture(kind);
  }

  function writeSample(pixels, sx, sy, texture, u, v, shade) {
    const color = sampleTexture(texture, u, v, shade);
    const i = ((sy * VIEW_W) + sx) * 4;
    pixels[i] = color.r;
    pixels[i + 1] = color.g;
    pixels[i + 2] = color.b;
    pixels[i + 3] = 255;
  }

  function writeSolid(pixels, sx, sy, r, g, b) {
    const i = ((sy * VIEW_W) + sx) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }

  function sampleTexture(texture, u, v, shade = 1) {
    const tex = texture || makeFallbackTexture('wall');
    const x = Math.abs(Math.floor(fractional(u) * tex.width)) % tex.width;
    const y = Math.abs(Math.floor(fractional(v) * tex.height)) % tex.height;
    const i = ((y * tex.width) + x) * 4;
    return {
      r: Math.max(0, Math.min(255, Math.floor(tex.data[i] * shade))),
      g: Math.max(0, Math.min(255, Math.floor(tex.data[i + 1] * shade))),
      b: Math.max(0, Math.min(255, Math.floor(tex.data[i + 2] * shade))),
      a: tex.data[i + 3],
    };
  }

  function makeFallbackTexture(kind) {
    if (!state.textureCache.has(`fallback:${kind}`)) {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      const palette = {
        wall: ['#756957', '#4a4338', '#a49678'],
        door: ['#8a552c', '#4c2f1d', '#d2a25b'],
        floor: ['#4b3829', '#2a211b', '#6a503a'],
        ceiling: ['#2b2b38', '#15151f', '#4e4e62'],
        chest: ['#c48433', '#5b351c', '#f1c46c'],
        stairs_up: ['#82badb', '#315c73', '#c5e8f4'],
        stairs_down: ['#9479d1', '#3e2e65', '#d5c6ff'],
      }[kind] || ['#756957', '#4a4338', '#a49678'];
      ctx.fillStyle = palette[1];
      ctx.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y += 8) {
        for (let x = 0; x < 32; x += 8) {
          ctx.fillStyle = ((x + y) & 8) ? palette[0] : palette[1];
          ctx.fillRect(x, y, 8, 8);
          ctx.strokeStyle = palette[2];
          ctx.strokeRect(x + 0.5, y + 0.5, 7, 7);
        }
      }
      state.textureCache.set(`fallback:${kind}`, canvasTexture(canvas));
    }
    return state.textureCache.get(`fallback:${kind}`);
  }

  function canvasTexture(canvas) {
    const ctx = canvas.getContext('2d');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { canvas, width: canvas.width, height: canvas.height, data: image.data };
  }

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
    const entries = [
      ['wall', refs.wall_texture],
      ['door', refs.wall_texture],
      ['floor', refs.floor_texture],
      ['ceiling', refs.ceiling_texture],
      ['chest', refs.chest_texture],
      ['stairs_up', refs.stairs_up_texture],
      ['stairs_down', refs.stairs_down_texture],
    ];
    const loaded = {};
    await Promise.all(entries.map(async ([key, ref]) => {
      loaded[key] = await loadTextureRef(ref, projectDir, key);
    }));
    state.textures = loaded;
    renderPreview();
  }

  async function loadTextureRef(ref, projectDir, kind) {
    const parsed = parseTextureRef(ref || DEFAULT_ASSET_REFS[`${kind}_texture`] || DEFAULT_ASSET_REFS.wall_texture);
    const cacheKey = `${parsed.path}#${parsed.tag || kind}`;
    if (state.textureCache.has(cacheKey)) return state.textureCache.get(cacheKey);
    const sourcePath = resolveAssetPath(parsed.path, projectDir);
    const read = sourcePath ? await api.electronAPI?.readFileAsDataUrl?.(sourcePath).catch(() => null) : null;
    if (!read?.ok || !read.dataUrl) return makeFallbackTexture(kind);
    const image = await loadImage(read.dataUrl).catch(() => null);
    if (!image) return makeFallbackTexture(kind);
    const texture = cropAtlasTexture(image, parsed.tag || kind);
    state.textureCache.set(cacheKey, texture);
    return texture;
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

  function cropAtlasTexture(image, tag) {
    const coords = ATLAS_RECTS[tag] || ATLAS_RECTS.wall;
    const cellW = Math.floor(image.naturalWidth / 3);
    const cellH = Math.floor(image.naturalHeight / 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, cellW);
    canvas.height = Math.max(1, cellH);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, coords[0] * cellW, coords[1] * cellH, cellW, cellH, 0, 0, cellW, cellH);
    return canvasTexture(canvas);
  }

  function fractional(value) {
    return value - Math.floor(value);
  }

  function dirAngle(dir) {
    return [-Math.PI / 2, 0, Math.PI / 2, Math.PI][dir & 3] || 0;
  }

  function dirIndexFromAngle(angle) {
    const normalized = normalizeAngle(angle);
    return (Math.round(normalized / (Math.PI / 2)) + 1 + 4) % 4;
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

  function easeInOut(t) {
    return t * t * (3 - 2 * t);
  }

  function renderAssets() {
    const floor = state.current;
    if (!floor) return;
    const keys = [
      ['wall_texture', '壁'],
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
    return `
      <div class="dge-generated-assets">
        <button class="dge-wide" data-action="export-assets">SGDKアセット生成</button>
        <div>Tileset: ${escapeHtml(shortProjectPath(exportInfo.patternTilesetPath || 'res/dungeon/generated/dungeon_view_tileset.png'))}</div>
        <div>Map: ${escapeHtml(shortProjectPath(exportInfo.patternMapPath || 'res/dungeon/generated/dungeon_view_map.png'))}</div>
        <div>Res: ${escapeHtml(shortProjectPath(exportInfo.resourcePath || 'res/resources.res'))}</div>
        <div>${escapeHtml(tileCount)}</div>
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

  function canPreviewMove(dirIndex) {
    const dir = DIRS[dirIndex];
    const cell = cellAt(state.preview.x, state.preview.y);
    if (!cell || (cell.walls & dir.bit)) return false;
    return Boolean(cellAt(state.preview.x + dir.dx, state.preview.y + dir.dy));
  }

  function movePreview(action) {
    if (!state.current || state.animation) return;
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
    state.animation = { action, from, to, startedAt: performance.now() };
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = requestAnimationFrame(stepPreviewAnimation);
  }

  function stepPreviewAnimation() {
    if (!state.animation) return;
    renderPreview();
    if (performance.now() - state.animation.startedAt >= ANIMATION_MS) {
      state.preview = { ...state.animation.to };
      state.animation = null;
      renderPreview();
      return;
    }
    state.animationFrame = requestAnimationFrame(stepPreviewAnimation);
  }

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
    const result = await api.plugins.invokeHook(plugin.id, 'exportDungeonData', {});
    if (!result?.ok) {
      setStatus(result?.error || 'SGDKアセット生成に失敗しました');
      return;
    }
    state.exportInfo = result;
    setStatus(`SGDK ${result.patternTileCount || 0} tiles`);
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
