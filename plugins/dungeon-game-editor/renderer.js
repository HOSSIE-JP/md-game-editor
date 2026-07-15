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
  { id: 'enemy', label: '敵' },
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
  enemy_texture: 'dungeon/textures/dungeon_texture_atlas.png#enemy',
};
const ASSET_META = Object.freeze({
  wall_texture: { label: '壁', kind: 'wall', fileName: 'wall', width: 96, height: 96, opaque: true },
  door_texture: { label: '扉', kind: 'door', fileName: 'door', width: 96, height: 96, opaque: true },
  floor_texture: { label: '床', kind: 'floor', fileName: 'floor', width: 32, height: 32, opaque: true },
  ceiling_texture: { label: '天井', kind: 'ceiling', fileName: 'ceiling', width: 32, height: 32, opaque: true },
  chest_texture: { label: '宝箱', kind: 'chest', fileName: 'chest', width: 48, height: 48, opaque: false },
  stairs_up_texture: { label: '上り階段', kind: 'stairs_up', fileName: 'stairs_up', width: 48, height: 48, opaque: false },
  stairs_down_texture: { label: '下り階段', kind: 'stairs_down', fileName: 'stairs_down', width: 48, height: 48, opaque: false },
  enemy_texture: { label: '敵', kind: 'enemy', fileName: 'enemy', width: 192, height: 96, opaque: false },
});
const ASSET_KEYS = Object.freeze(Object.keys(ASSET_META));
/* 壁焼き込み4要素は素材セット単位、宝箱/階段/敵4要素はプロジェクト共通 (settings.common_assets) */
const SET_ASSET_KEYS = Object.freeze(['wall_texture', 'door_texture', 'floor_texture', 'ceiling_texture']);
const COMMON_ASSET_KEYS = Object.freeze(['chest_texture', 'stairs_up_texture', 'stairs_down_texture', 'enemy_texture']);
const COMMON_CARD_SENTINEL = '__common__';
const MAX_ASSET_SETS = 255;
const VIEW_W = 200;
const VIEW_H = 128;
const ANIMATION_FRAMES_MIN = 2;
const ANIMATION_FRAMES_MAX = 8;
/* dungeon-service.js の MOVE_SPEED_VBLANKS_MAX と揃える */
const MOVE_SPEED_VBLANKS_MAX = 60;
/* dungeon-service.js の ENEMY_STEP_VBLANKS_MIN/MAX と揃える */
const ENEMY_STEP_VBLANKS_MIN = 5;
const ENEMY_STEP_VBLANKS_MAX = 240;
const ENEMY_MAX_PER_FLOOR = 8;
/* エネミーAIの実時間ティック駆動 (main.c の vblank タイマー相当)。50ms周期でポーリングし、
 * 経過時間が enemy_step_vblanks*VBLANK_MS 以上になったら1tick進める。 */
const ENEMY_TICK_POLL_MS = 50;
const MINIMAP_ENEMY_COLOR = '#ff5f5f';
/* 実機の必須DMA転送 = DUN_ANIMATION_STEP_VBLANKS(2) vblank (dungeon_view.c flushFrame と同じ値)。
 * 1 vblank ≒ 16.67ms (NTSC 60Hz)。実際のプレビュー間隔は settings.move_speed_vblanks
 * (エディタで設定する起動時デフォルトのペーシング) を加えて frameStepMs() で求める。 */
const DUN_ANIMATION_STEP_VBLANKS = 2;
const VBLANK_MS = 1000 / 60;
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
    /* 自動マッピング用の踏破済みセル: floorId -> Set<"x,y">。フロア切替をまたいで
     * プレビューセッション中は保持し、セル編集/データ再読込でリセットする。 */
    visitedByFloor: new Map(),
    /* ミニマップ表示モード: 'visited' (自分が歩いた場所のみ, 既定) / 'full' (全体表示) */
    minimapMode: 'visited',
    /* エネミーのシミュ状態: floorId -> [{x,y,dir,mode,anim,chaseTimer,active}, ...]。
     * visitedByFloor と同じリセット規則 (handleMapClick / resizeFloor は該当フロアのみ、
     * refresh / restoreCommittedState は全リセット)。RNG はセッション単位 (実機の
     * enemy_rng_state と同じくフロア非依存の単一系列) で、全リセット時のみ再シードする。 */
    enemiesByFloor: new Map(),
    enemyRng: null,
    enemyLastTick: 0,
    enemyIntervalId: null,
    /* エネミースライド描画専用の requestAnimationFrame ハンドル (AI論理ステップの
     * setInterval とは独立)。stepPreviewAnimation の state.animationFrame と同じ役割。 */
    enemySlideFrame: null,
    textureCache: new Map(),
    textureCacheEpoch: 0,
    textures: null,
    viewModel: null,
    assetEditorSetId: '',
    assetTextures: null,
    assetViewModel: null,
    textureGeneration: 0,
    assetTextureGeneration: 0,
    assetCardsGeneration: 0,
    committed: null,
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
        <button data-tab="settings">設定</button>
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
            <label class="dge-field">素材セット<select class="dge-floor-asset-set"></select></label>
            <div class="dge-size-row">
              <label class="dge-field">幅<input class="dge-width" type="number" min="4" max="20"></label>
              <label class="dge-field">高さ<input class="dge-height" type="number" min="4" max="20"></label>
            </div>
            <label class="dge-field">エネミー移動間隔 (このフロア)
              <input class="dge-enemy-step" type="number" min="0" max="240" step="1" placeholder="0">
              <small class="dge-enemy-step-hint"></small>
            </label>
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
            <div class="dge-minimap-wrap">
              <canvas class="dge-minimap" width="160" height="160"></canvas>
              <button type="button" class="dge-minimap-mode" data-action="minimap-mode">歩いた場所のみ</button>
            </div>
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
      <section class="dge-panel" data-panel="settings">
        <div class="dge-settings"></div>
      </section>
    </div>
  `;
  root.tabIndex = 0;

  const ui = {
    status: root.querySelector('.dge-status'),
    dirty: root.querySelector('.dge-dirty'),
    floorSelect: root.querySelector('.dge-floor-select'),
    floorAssetSet: root.querySelector('.dge-floor-asset-set'),
    name: root.querySelector('.dge-floor-name'),
    width: root.querySelector('.dge-width'),
    height: root.querySelector('.dge-height'),
    enemyStep: root.querySelector('.dge-enemy-step'),
    enemyStepHint: root.querySelector('.dge-enemy-step-hint'),
    tools: root.querySelector('.dge-tools'),
    map: root.querySelector('.dge-map'),
    view: root.querySelector('.dge-view'),
    cellInfo: root.querySelector('.dge-cell-info'),
    previewInfo: root.querySelector('.dge-preview-info'),
    assets: root.querySelector('.dge-assets'),
    settings: root.querySelector('.dge-settings'),
    tabs: Array.from(root.querySelectorAll('[data-tab]')),
    panels: Array.from(root.querySelectorAll('[data-panel]')),
    minimap: root.querySelector('.dge-minimap'),
    minimapMode: root.querySelector('.dge-minimap-mode'),
    assetsView: null,
  };
  const mapCtx = ui.map.getContext('2d');
  const viewCtx = ui.view.getContext('2d');
  const minimapCtx = ui.minimap.getContext('2d');
  mapCtx.imageSmoothingEnabled = false;
  viewCtx.imageSmoothingEnabled = false;
  minimapCtx.imageSmoothingEnabled = false;

  function blankCell(walls = 15) {
    return { walls, doors: 0, one_way: 0, dark: false, event: '', stairs: '', enemy: false };
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
      asset_set_id: firstAssetSet()?.id || '',
      enemy_step_vblanks: 0,
      cells: Array.from({ length: height }, () => Array.from({ length: width }, () => blankCell(15))),
    };
  }

  function cellAt(x, y) {
    if (!state.current || x < 0 || y < 0 || x >= state.current.width || y >= state.current.height) return null;
    return state.current.cells[y][x];
  }

  /* ------------------------------------------------------------------
   * ミニマップ自動マッピング (踏破済みセル追跡) — 実機 dungeon_view.c の
   * DUN_MINIMAP_VISITED と対になるプレビュー側の状態。
   *
   * state.visitedByFloor は floorId -> Set<"x,y"> で、フロア切替 (フロア選択
   * ドロップダウン・階段遷移) をまたいでプレビューセッション中は保持する
   * (実機がフロアごとの踏破ビットフィールドを RAM に持ち続けるのと同じ)。
   * 「歩き直し」とみなしてリセットするのは以下のときだけ:
   *   - フロアデータの再読込・巻き戻し (refresh / restoreCommittedState)
   *   - セル編集によりそのフロアのデータ自体が変わったとき
   *     (handleMapClick でのマップ編集、resizeFloor での実サイズ変更)
   * 保存 (saveCurrent) 自体はセルを変えないのでリセットしない。
   * ------------------------------------------------------------------ */

  function visitedKey(x, y) {
    return `${x},${y}`;
  }

  function getVisitedSet(floorId) {
    const key = floorId || '';
    let set = state.visitedByFloor.get(key);
    if (!set) {
      set = new Set();
      state.visitedByFloor.set(key, set);
    }
    return set;
  }

  function markPreviewVisited(floor, x, y) {
    if (!floor) return;
    getVisitedSet(floor.id).add(visitedKey(x, y));
  }

  function isPreviewVisited(floorId, x, y) {
    const set = state.visitedByFloor.get(floorId || '');
    return Boolean(set && set.has(visitedKey(x, y)));
  }

  function resetVisitedForFloor(floorId) {
    state.visitedByFloor.delete(floorId || '');
  }

  function resetAllVisited() {
    state.visitedByFloor.clear();
  }

  /* ミニマップのセル (床/宝箱/階段の塗り) を表示するか。full モードは常に表示 */
  function shouldDrawMinimapCell(mode, floorId, x, y) {
    return mode === 'full' || isPreviewVisited(floorId, x, y);
  }

  /* ミニマップの壁/扉エッジを表示するか。自セルか、辺を挟んだ隣接セルの
   * どちらかが訪問済みなら表示する (歩いて隣から見た壁として扱う)。
   * hasNeighbor=false (マップ外周) では自セルの訪問状態のみで判定する。
   * 実機 dungeon_view.c の DUN_drawMinimap と同じ規則。 */
  function shouldDrawMinimapEdge(mode, floorId, x, y, nx, ny, hasNeighbor) {
    if (mode === 'full') return true;
    if (isPreviewVisited(floorId, x, y)) return true;
    return hasNeighbor && isPreviewVisited(floorId, nx, ny);
  }

  /* ------------------------------------------------------------------
   * エネミーAIプレビュー・シミュレーション — 実機 (main.c) の dun_enemies /
   * stepEnemies / vblank タイマー tick を core.stepEnemies 経由で再現する。
   * visitedByFloor と同じ Map<floorId, [...]> パターンでフロア切替をまたいで
   * 生存状態を保持する (実機のフロア別RAM永続パターンに対応)。
   * ------------------------------------------------------------------ */

  function getEnemiesForFloor(floor) {
    if (!floor) return [];
    let list = state.enemiesByFloor.get(floor.id);
    if (!list) {
      list = core.enemySpawns(floor).map((spawn) => ({
        x: spawn.x,
        y: spawn.y,
        prevX: spawn.x,
        prevY: spawn.y,
        dir: 0,
        mode: 0,
        anim: 0,
        chaseTimer: 0,
        active: true,
      }));
      state.enemiesByFloor.set(floor.id, list);
    }
    return list;
  }

  function resetEnemiesForFloor(floorId) {
    state.enemiesByFloor.delete(floorId || '');
  }

  function resetAllEnemies() {
    state.enemiesByFloor.clear();
    state.enemyRng = null;
  }

  /*
   * 実機の floor->enemy_step_vblanks 相当: 現在フロアの上書き値があればそれを、
   * 0/未設定ならプロジェクト既定 (settings.enemy_step_vblanks) を使う。
   * フロア切替 (階段移動・フロア選択) で歩速が変わる実機の挙動とプレビューを一致させる。
   */
  function enemyTickIntervalMs() {
    const raw = Number(state.current?.enemy_step_vblanks) || Number(state.settings?.enemy_step_vblanks) || 90;
    const vblanks = Math.max(ENEMY_STEP_VBLANKS_MIN, Math.min(ENEMY_STEP_VBLANKS_MAX, raw));
    return vblanks * VBLANK_MS;
  }

  /*
   * エネミー移動スライドの現在の進行度。0 = 直前tickのセル (prevX/prevY)、
   * 1 (=den/den) = 現tickのセル (x/y) を描く。num/den の形で返すのは C 側
   * DUN_setEnemySlide (vblank単位の整数) と同じ端点を JS 側 (経過ms/間隔ms) でも
   * 保つため。Cは受け取った比率をQ0.16へ1回だけ変換し、各planを同じ結果へ補間する。
   */
  function enemySlideProgress() {
    const den = enemyTickIntervalMs();
    if (!(den > 0)) return { num: 1, den: 1 };
    const elapsed = performance.now() - state.enemyLastTick;
    const num = Math.max(0, Math.min(den, elapsed));
    return { num, den };
  }

  function startEnemyLoop() {
    stopEnemyLoop();
    state.enemyLastTick = performance.now();
    state.enemyIntervalId = setInterval(tickEnemyLoop, ENEMY_TICK_POLL_MS);
    state.enemySlideFrame = requestAnimationFrame(stepEnemySlideLoop);
  }

  function stopEnemyLoop() {
    if (state.enemyIntervalId != null) clearInterval(state.enemyIntervalId);
    state.enemyIntervalId = null;
    if (state.enemySlideFrame != null) cancelAnimationFrame(state.enemySlideFrame);
    state.enemySlideFrame = null;
  }

  /*
   * setInterval(50ms) + 経過時間ゲート: 実機の vblank タイマー駆動と同じ「間隔が
   * 経過したら1tick進める」パターンを実時間で近似する。プレイヤーが移動アニメ中
   * (state.animation) はエネミーも静止する (実機のブロッキングアニメ中と同じ仕様)。
   */
  function tickEnemyLoop() {
    if (!root.classList.contains('active')) return;
    const floor = state.current;
    if (!floor || state.animation) return;
    const now = performance.now();
    if (now - state.enemyLastTick < enemyTickIntervalMs()) return;
    state.enemyLastTick = now;
    const enemies = getEnemiesForFloor(floor);
    if (!enemies.length) return;
    if (!state.enemyRng) state.enemyRng = core.makeEnemyRng(core.ENEMY_RNG_DEFAULT_SEED);
    const player = { x: state.preview.x, y: state.preview.y, dir: state.preview.dir };
    const contacts = core.stepEnemies(floor, enemies, player, state.enemyRng);
    if (contacts.length) setStatus(`エネミーが接触しました (${contacts.length}体)`);
    renderPreview();
  }

  /*
   * tickEnemyLoop が論理セルを進めるのは間隔ごとだが、その間もセル間を補間して滑らかに
   * スライドさせるため requestAnimationFrame で毎フレーム再描画する (実機 main.c の
   * アイドル毎フレーム DUN_refreshBillboards に対応)。ページ非アクティブ・プレイヤー移動
   * アニメ中・エネミー不在時は再描画しない (tickEnemyLoop と同じガード)。
   */
  function stepEnemySlideLoop() {
    state.enemySlideFrame = requestAnimationFrame(stepEnemySlideLoop);
    if (!root.classList.contains('active')) return;
    const floor = state.current;
    if (!floor || state.animation) return;
    const enemies = state.enemiesByFloor.get(floor.id);
    if (!enemies || !enemies.length) return;
    renderPreview();
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    ui.dirty.textContent = state.dirty ? '未保存' : '';
  }

  function setStatus(text) {
    ui.status.textContent = text || '';
  }

  function cloneData(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function assetSets() {
    return Array.isArray(state.settings?.asset_sets) ? state.settings.asset_sets : [];
  }

  function firstAssetSet() {
    return assetSets()[0] || null;
  }

  function assetSetById(id) {
    return assetSets().find((set) => set.id === id) || null;
  }

  function selectedAssetSet() {
    return assetSetById(state.assetEditorSetId) || firstAssetSet();
  }

  function normalizeAssetSetForUi(assetSet, index) {
    const id = String(assetSet?.id || (index === 0 ? 'default' : `set-${index + 1}`)).trim();
    const assets = {};
    SET_ASSET_KEYS.forEach((key) => {
      assets[key] = String(assetSet?.assets?.[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    });
    return {
      id,
      name: String(assetSet?.name || id || `Set ${index + 1}`).trim(),
      assets,
    };
  }

  function normalizeCommonAssetsForUi(commonAssets) {
    const source = commonAssets && typeof commonAssets === 'object' ? commonAssets : {};
    const assets = {};
    COMMON_ASSET_KEYS.forEach((key) => {
      assets[key] = String(source[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    });
    return assets;
  }

  function normalizeSettingsForUi(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const hasSets = Array.isArray(source.asset_sets);
    const rawSets = hasSets
      ? source.asset_sets
      : [{ id: 'default', name: 'Default', assets: state.defaultAssets }];
    return {
      ...source,
      asset_sets: rawSets.map(normalizeAssetSetForUi),
      common_assets: normalizeCommonAssetsForUi(source.common_assets),
    };
  }

  function effectiveAssetsForFloor(floor) {
    const common = state.settings?.common_assets || {};
    const set = assetSetById(floor?.asset_set_id);
    if (set) return { ...state.defaultAssets, ...common, ...set.assets };
    if (floor?.assets) return { ...state.defaultAssets, ...common, ...floor.assets };
    return { ...state.defaultAssets, ...common };
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
      asset_set_id: String(floor?.asset_set_id || floor?.assetSetId || firstAssetSet()?.id || ''),
      ...(floor?.assets ? { assets: { ...state.defaultAssets, ...floor.assets } } : {}),
    };
  }

  /* 「0 = 設定タブの既定値 (現在 N)」ヒント: プロジェクト既定値 (settings.enemy_step_vblanks) を表示する */
  function updateEnemyStepHint() {
    if (!ui.enemyStepHint) return;
    const projectDefault = Math.max(ENEMY_STEP_VBLANKS_MIN, Math.min(ENEMY_STEP_VBLANKS_MAX, Number(state.settings?.enemy_step_vblanks) || 90));
    ui.enemyStepHint.textContent = `0 = 設定タブの既定値 (現在 ${projectDefault})`;
  }

  function syncForm() {
    if (!state.current) return;
    ui.name.value = state.current.name || '';
    ui.width.value = state.current.width;
    ui.height.value = state.current.height;
    ui.enemyStep.value = state.current.enemy_step_vblanks || 0;
    updateEnemyStepHint();
    renderFloorAssetSetSelect();
    if (!state.assetEditorSetId) state.assetEditorSetId = state.current.asset_set_id || firstAssetSet()?.id || '';
    state.preview = { ...state.current.start };
    /* 実機の resetPlayer() と同じく、開始セルへ着地したら踏破済みとして記録する */
    markPreviewVisited(state.current, state.preview.x, state.preview.y);
    stopPreviewAnimation();
    renderAll();
  }

  function readFormIntoCurrent() {
    if (!state.current) return;
    state.current.name = ui.name.value || state.current.name;
    resizeFloor(Number(ui.width.value), Number(ui.height.value));
    const rawEnemyStep = Number.parseInt(ui.enemyStep.value, 10);
    state.current.enemy_step_vblanks = Number.isFinite(rawEnemyStep) && rawEnemyStep > 0
      ? Math.max(ENEMY_STEP_VBLANKS_MIN, Math.min(ENEMY_STEP_VBLANKS_MAX, rawEnemyStep))
      : 0;
  }

  function resizeFloor(width, height) {
    if (!state.current) return;
    const nextW = Math.max(4, Math.min(MAX_SIZE, Number(width || state.current.width)));
    const nextH = Math.max(4, Math.min(MAX_SIZE, Number(height || state.current.height)));
    if (nextW === state.current.width && nextH === state.current.height) return;
    /* セル配列そのものが作り直されるため、踏破済み記録・エネミーのシミュ状態は無効になる */
    resetVisitedForFloor(state.current.id);
    resetEnemiesForFloor(state.current.id);
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

  function renderFloorAssetSetSelect() {
    const selectedId = String(state.current?.asset_set_id || '');
    const known = assetSets().some((set) => set.id === selectedId);
    const missing = selectedId && !known
      ? `<option value="${escapeHtml(selectedId)}">不明なセット (${escapeHtml(selectedId)})</option>`
      : '';
    ui.floorAssetSet.innerHTML = missing + assetSets().map((set) => (
      `<option value="${escapeHtml(set.id)}">${escapeHtml(set.name || set.id)}</option>`
    )).join('');
    ui.floorAssetSet.value = selectedId;
    ui.floorAssetSet.disabled = assetSets().length === 0;
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
        if (cell.enemy) drawMapText('敵', px, py, size, MINIMAP_ENEMY_COLOR);
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
  function buildViewModel(sourceTextures) {
    const settings = state.settings || {};
    const textures = core.normalizeTextures(sourceTextures || {});
    const palette = core.buildViewPalette(textures);
    const spaces = core.buildEdgeSpaces(settings);
    const spritePalette = core.buildSpritePalette(textures);
    const background = core.buildBandTables(palette, textures);
    return {
      textures,
      settings,
      spaces,
      palette,
      darkPalette: core.darkenPalette(palette, DARK_PALETTE_SCALE),
      backdrop: core.buildBackdropSheet(palette, textures),
      background,
      transparentBackground: new Uint8Array(background.length),
      spritePalette,
      sheets: {
        chest: core.renderBillboardSheet(textures.chest, spritePalette),
        stairs_up: core.renderBillboardSheet(textures.stairs_up, spritePalette),
        stairs_down: core.renderBillboardSheet(textures.stairs_down, spritePalette),
        enemy: core.renderEnemyBillboardSheet(textures.enemy, spritePalette),
      },
      billboards: core.buildBillboardTables(settings),
    };
  }

  function getViewModel(assetEditor = false) {
    if (assetEditor) {
      if (!state.assetViewModel) state.assetViewModel = buildViewModel(state.assetTextures || state.textures || {});
      return state.assetViewModel;
    }
    if (!state.viewModel) state.viewModel = buildViewModel(state.textures || {});
    return state.viewModel;
  }

  function invalidateViewModel(includeAssetEditor = true) {
    state.viewModel = null;
    if (includeAssetEditor) state.assetViewModel = null;
  }

  function clearTextureCache() {
    state.textureCacheEpoch++;
    state.textureCache.clear();
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
    const image = composePreviewImage(model, floor);
    viewCtx.putImageData(image, 0, 0);

    if (ui.assetsView) {
      const assetsContext = ui.assetsView.getContext('2d');
      assetsContext.imageSmoothingEnabled = false;
      const assetModel = getViewModel(true);
      assetsContext.putImageData(composePreviewImage(assetModel, floor), 0, 0);
    }

    drawPreviewMinimap(floor, minimapPose());
    renderMinimapModeButton();
    ui.previewInfo.textContent = `X:${state.preview.x} Y:${state.preview.y} ${DIRS[state.preview.dir]?.label || 'E'}`;
  }

  /* ミニマップ表示モードのトグルボタンのラベルを現在の state.minimapMode に合わせる */
  function renderMinimapModeButton() {
    if (!ui.minimapMode) return;
    const visitedOnly = state.minimapMode !== 'full';
    ui.minimapMode.textContent = visitedOnly ? '歩いた場所のみ' : '全体表示';
    ui.minimapMode.title = visitedOnly ? 'クリックで全体表示に切り替え' : 'クリックで歩いた場所のみに切り替え';
    ui.minimapMode.classList.toggle('full', !visitedOnly);
  }

  function composePreviewImage(model, floor) {
    const frame = currentPreviewFrame(model);
    const states = core.sampleEdgeStates(floor, frame.base.x, frame.base.y, frame.base.dir, frame.defs);
    /* 左回転: 鏡像エッジで右回転テーブルを評価し、水平反転で合成する (実機と同一) */
    const defsForRender = frame.mirrored ? frame.turnDefs : frame.defs;
    const rendered = core.renderViewDetailed(
      frame.pose,
      defsForRender,
      states,
      model.textures,
      model.palette,
      model.transparentBackground,
    );
    let foreground = rendered.pixels;
    let wallDepth = rendered.depthCodes;
    if (frame.mirrored) {
      foreground = mirrorIndices(foreground);
      wallDepth = mirrorIndices(wallDepth);
    }
    const billboards = collectBillboards(model, frame, floor);
    const tileDepths = core.minimumDepthByTile(wallDepth);
    const priorityTiles = core.priorityTilesForBillboards(
      tileDepths,
      billboards.map((item) => ({ ...item.tileBounds, depthCode: item.depthCode })),
    );
    /* ハードウェアの描画順: BG_B → 低Priority BG_A → 低Priority sprite → 高Priority BG_A。 */
    const indices = new Uint8Array(model.background);
    for (let y = 0; y < VIEW_H; y++) {
      for (let x = 0; x < VIEW_W; x++) {
        const pixel = (y * VIEW_W) + x;
        const wall = foreground[pixel];
        const tile = ((y >> 3) * core.VIEW_TILE_W) + (x >> 3);
        if (wall && !priorityTiles[tile]) indices[pixel] = wall;
      }
    }
    const cell = cellAt(state.preview.x, state.preview.y);
    const paletteForView = cell?.dark ? model.darkPalette : model.palette;
    const image = viewCtx.createImageData(VIEW_W, VIEW_H);
    core.indicesToRgba(indices, paletteForView, image.data);
    drawBillboardsInto(image.data, model, billboards);
    drawHighPriorityWalls(image.data, foreground, priorityTiles, paletteForView);
    return image;
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

  /*
   * ビルボード: 実機のスプライト描画と同じテーブル・同じ LOS ルールで合成する。
   * エネミーの実位置検索 (enemies配列) をセルのフラグ (宝箱/階段) 参照より先に行う
   * (実機 updateBillboards の enemyAt() 優先ルールと同じ)。
   */
  function collectBillboards(model, frame, floor) {
    const cells = model.billboards.cells;
    const size = core.BB_FRAME_SIZE;
    const enemies = state.enemiesByFloor.get(floor.id) || [];
    const dir = frame.base.dir & 3;
    const items = [];
    /* エネミーのセル間スライド進行度 (num/den)。静止フレーム以外 (プレイヤー移動アニメ中) は
     * enemyLastTick が進まないため num は den へ張り付き、実質 cur セルで静止する。 */
    const slide = enemySlideProgress();
    for (let i = 0; i < cells.length && items.length < core.DUN_MAX_ENEMIES; i++) {
      const pose = frame.bbPoses[i];
      if (!pose || pose.frame < 0) continue;
      let dd = cells[i].dd;
      let dl = cells[i].dl;
      if (frame.mirrored) dl = -dl;
      const right = (dir + 1) & 3;
      const ax = frame.base.x + dd * DIRS[dir].dx + dl * DIRS[right].dx;
      const ay = frame.base.y + dd * DIRS[dir].dy + dl * DIRS[right].dy;
      if (ax < 0 || ay < 0 || ax >= floor.width || ay >= floor.height) continue;
      const enemy = core.enemyAt(enemies, ax, ay);
      let sheet = null;
      let rowOffset = 0;
      if (enemy) {
        sheet = model.sheets.enemy;
        let rel = ((enemy.dir - dir) + 4) & 3;
        if (frame.mirrored) rel = (4 - rel) & 3;
        rowOffset = ((rel * 2) + (enemy.anim & 1)) * size;
      } else {
        const cell = floor.cells[ay][ax];
        if (cell.event === 'chest') sheet = model.sheets.chest;
        else if (cell.stairs === 'up') sheet = model.sheets.stairs_up;
        else if (cell.stairs === 'down') sheet = model.sheets.stairs_down;
      }
      if (!sheet) continue;
      const currentVisible = core.losVisible(floor, frame.base.x, frame.base.y, dir, dd, dl);
      const moving = Boolean(enemy && (enemy.prevX !== enemy.x || enemy.prevY !== enemy.y));
      let posePrev = null;
      let previousVisible = false;
      if (moving) {
        const podx = enemy.prevX - frame.base.x;
        const pody = enemy.prevY - frame.base.y;
        const pdd = (podx * DIRS[dir].dx) + (pody * DIRS[dir].dy);
        const pdlWorld = (podx * DIRS[right].dx) + (pody * DIRS[right].dy);
        const wantDl = frame.mirrored ? -pdlWorld : pdlWorld;
        let pj = -1;
        for (let k = 0; k < cells.length; k++) {
          if (cells[k].dd === pdd && cells[k].dl === wantDl) { pj = k; break; }
        }
        posePrev = pj >= 0 ? frame.bbPoses[pj] : null;
        if (posePrev && posePrev.frame >= 0) {
          previousVisible = core.losVisible(floor, frame.base.x, frame.base.y, dir, pdd, pdlWorld);
        } else {
          posePrev = null;
        }
      }
      if (enemy) {
        if (!core.billboardSlideVisible(currentVisible, previousVisible, Boolean(posePrev), slide.num, slide.den)) continue;
      } else if (!currentVisible) {
        continue;
      }
      const sx0 = frame.mirrored ? (VIEW_W - pose.x - size) : pose.x;
      /* エネミーは直前セル (prevX/prevY) の焼き込みポーズと現セルのポーズを num/den で
       * 補間してスライドさせる (実機 dungeon_view.c updateBillboards と同一式)。現在セルが
       * LOS外でも直前セルが見えていれば終端直前まで残し、壁Priorityで滑らかに隠す。 */
      let drawSx0 = sx0;
      let drawTop = pose.y;
      let drawFrame = pose.frame;
      let drawDepthCode = pose.depthCode || 0;
      if (enemy && posePrev && slide.num < slide.den) {
        const prevSx0 = frame.mirrored ? (VIEW_W - posePrev.x - size) : posePrev.x;
        drawSx0 = core.billboardSlideLerp(prevSx0, sx0, slide.num, slide.den);
        drawTop = core.billboardSlideLerp(posePrev.y, pose.y, slide.num, slide.den);
        /* 距離バケット (スプライトサイズ) も補間し、移動に合わせて拡大縮小を段階変化させる */
        drawFrame = core.billboardSlideFrame(posePrev.frame, pose.frame, slide.num, slide.den);
        drawDepthCode = core.billboardSlideLerp(
          posePrev.depthCode || 0,
          pose.depthCode || 0,
          slide.num,
          slide.den,
        );
      }
      const frameOffset = drawFrame * size;
      const visibleBounds = billboardVisibleBounds(sheet, rowOffset, frameOffset, size);
      if (!visibleBounds) continue;
      const tileBounds = core.tileBoundsForRect(
        drawSx0 + visibleBounds.x,
        drawTop + visibleBounds.y,
        visibleBounds.width,
        visibleBounds.height,
      );
      if (!tileBounds) continue;
      items.push({
        sheet,
        rowOffset,
        frameOffset,
        x: drawSx0,
        y: drawTop,
        depthCode: drawDepthCode,
        tileBounds,
      });
    }
    return items;
  }

  function billboardVisibleBounds(sheet, rowOffset, frameOffset, size) {
    let x0 = size;
    let y0 = size;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < size; y++) {
      const sourceRow = rowOffset + y;
      for (let x = 0; x < size; x++) {
        if (!sheet.pixels[(sourceRow * sheet.width) + frameOffset + x]) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0 || y1 < y0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  function drawBillboardsInto(rgba, model, billboards) {
    const size = core.BB_FRAME_SIZE;
    billboards.forEach((item) => {
      for (let y = 0; y < size; y++) {
        const dy = item.y + y;
        if (dy < 0 || dy >= VIEW_H) continue;
        const sourceRow = item.rowOffset + y;
        for (let x = 0; x < size; x++) {
          const dx = item.x + x;
          if (dx < 0 || dx >= VIEW_W) continue;
          const paletteIndex = item.sheet.pixels[(sourceRow * item.sheet.width) + item.frameOffset + x];
          if (!paletteIndex) continue;
          const color = model.spritePalette[paletteIndex];
          const dest = ((dy * VIEW_W) + dx) * 4;
          rgba[dest] = color.r;
          rgba[dest + 1] = color.g;
          rgba[dest + 2] = color.b;
          rgba[dest + 3] = 255;
        }
      }
    });
  }

  function drawHighPriorityWalls(rgba, foreground, priorityTiles, palette) {
    for (let y = 0; y < VIEW_H; y++) {
      for (let x = 0; x < VIEW_W; x++) {
        const pixel = (y * VIEW_W) + x;
        const paletteIndex = foreground[pixel];
        const tile = ((y >> 3) * core.VIEW_TILE_W) + (x >> 3);
        if (!paletteIndex || !priorityTiles[tile]) continue;
        const color = palette[paletteIndex];
        const dest = pixel * 4;
        rgba[dest] = color.r;
        rgba[dest + 1] = color.g;
        rgba[dest + 2] = color.b;
        rgba[dest + 3] = 255;
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
    const mode = state.minimapMode;
    const floorId = floor.id;
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        if (!shouldDrawMinimapCell(mode, floorId, x, y)) continue;
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
    /* エネミー: 踏破済みセル上のみ描画 (FULL時は常時) — 実機ミニマップと同じルール */
    (state.enemiesByFloor.get(floorId) || []).forEach((enemy) => {
      if (!enemy.active) return;
      if (!shouldDrawMinimapCell(mode, floorId, enemy.x, enemy.y)) return;
      drawMiniDot(ctx, ox, oy, size, enemy.x, enemy.y, MINIMAP_ENEMY_COLOR);
    });
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
    const mode = state.minimapMode;
    const floorId = floor.id;
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const cell = floor.cells[y][x];
        const px = ox + x * size;
        const py = oy + y * size;
        DIRS.forEach((dir) => {
          if (!(cell[key] & dir.bit)) return;
          if ((dir.id === 'w' && x > 0) || (dir.id === 'n' && y > 0)) return;
          const nx = x + dir.dx;
          const ny = y + dir.dy;
          const hasNeighbor = nx >= 0 && ny >= 0 && nx < floor.width && ny < floor.height;
          if (!shouldDrawMinimapEdge(mode, floorId, x, y, nx, ny, hasNeighbor)) return;
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
    const generation = ++state.textureGeneration;
    const floorId = floor.id;
    const setId = floor.asset_set_id;
    const projectDir = await refreshProjectDir();
    const refs = effectiveAssetsForFloor(floor);
    const loaded = await loadTextureRefs(refs, projectDir);
    if (generation !== state.textureGeneration || state.current?.id !== floorId || state.current?.asset_set_id !== setId) return;
    state.textures = loaded;
    state.viewModel = null;
    renderPreview();
  }

  async function loadTexturesForAssetEditor() {
    const set = selectedAssetSet();
    if (!set) {
      state.assetTextures = null;
      state.assetViewModel = null;
      renderPreview();
      return;
    }
    const generation = ++state.assetTextureGeneration;
    const setId = set.id;
    const projectDir = await refreshProjectDir();
    const loaded = await loadTextureRefs({ ...state.defaultAssets, ...state.settings?.common_assets, ...set.assets }, projectDir);
    if (generation !== state.assetTextureGeneration || selectedAssetSet()?.id !== setId) return;
    state.assetTextures = loaded;
    state.assetViewModel = null;
    renderPreview();
  }

  async function loadTextureRefs(refs, projectDir) {
    const loaded = {};
    const cacheEpoch = state.textureCacheEpoch;
    await Promise.all(core.TEXTURE_KINDS.map(async (kind) => {
      loaded[kind] = await loadTextureRef(refs[`${kind}_texture`], projectDir, kind, cacheEpoch);
    }));
    return loaded;
  }

  async function loadTextureRef(ref, projectDir, kind, cacheEpoch = state.textureCacheEpoch) {
    const parsed = parseTextureRef(ref || DEFAULT_ASSET_REFS[`${kind}_texture`] || DEFAULT_ASSET_REFS.wall_texture);
    const cacheKey = `${parsed.path}#${parsed.tag || '$whole'}`;
    if (state.textureCache.has(cacheKey)) return state.textureCache.get(cacheKey);
    const sourcePath = resolveAssetPath(parsed.path, projectDir);
    const read = sourcePath ? await api.electronAPI?.readFileAsDataUrl?.(sourcePath).catch(() => null) : null;
    if (!read?.ok || !read.dataUrl) return core.makeFallbackTexture(kind);
    const image = await loadImage(read.dataUrl).catch(() => null);
    if (!image) return core.makeFallbackTexture(kind);
    let texture = null;
    if (parsed.tag) {
      const layout = await loadAtlasLayout(sourcePath, cacheEpoch);
      texture = cropAtlasTexture(image, parsed.tag, layout);
    } else {
      texture = wholeImageTexture(image);
    }
    texture ||= core.makeFallbackTexture(kind);
    if (cacheEpoch === state.textureCacheEpoch) state.textureCache.set(cacheKey, texture);
    return texture;
  }

  /* アトラスサイドカー <atlas>.json ({"columns":4,"rows":2}) を読む */
  async function loadAtlasLayout(imagePath, cacheEpoch = state.textureCacheEpoch) {
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
    if (cacheEpoch === state.textureCacheEpoch) state.textureCache.set(cacheKey, layout);
    return layout;
  }

  function parseTextureRef(ref) {
    const [pathPart, tagPart] = String(ref || '').split('#');
    return { path: pathPart.trim(), tag: String(tagPart || '').trim() };
  }

  function resolveAssetPath(assetPath, projectDir) {
    const clean = String(assetPath || '').replace(/\\/g, '/').replace(/^res\//, '');
    if (!clean) return '';
    if (!projectDir) return '';
    const rootPath = String(projectDir).replace(/\\/g, '/').replace(/\/$/, '');
    if (/^\/|^[A-Za-z]:\//.test(clean)) {
      const absolute = clean.replace(/\/$/, '');
      const foldedRoot = rootPath.toLowerCase();
      const foldedAbsolute = absolute.toLowerCase();
      return foldedAbsolute === foldedRoot || foldedAbsolute.startsWith(`${foldedRoot}/`) ? absolute : '';
    }
    if (clean.split('/').some((part) => part === '..') || clean.includes('\0')) return '';
    return `${rootPath}/res/${clean.replace(/^\/+/, '')}`;
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

  function wholeImageTexture(image) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
    canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
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
    const sets = assetSets();
    if (!assetSetById(state.assetEditorSetId)) state.assetEditorSetId = state.current?.asset_set_id || sets[0]?.id || '';
    if (!assetSetById(state.assetEditorSetId)) state.assetEditorSetId = sets[0]?.id || '';
    const set = selectedAssetSet();
    const referenceCount = set ? countSetReferences(set.id) : 0;
    const deleteBlocked = !set || sets.length <= 1 || referenceCount > 0;
    const setList = sets.map((entry) => {
      const references = countSetReferences(entry.id);
      return `
        <button type="button" class="dge-set-item ${entry.id === set?.id ? 'active' : ''}" data-set-select="${escapeHtml(entry.id)}">
          <span>${escapeHtml(entry.name || entry.id)}</span>
          <small>${references ? `${references} floor` : '未使用'}</small>
        </button>
      `;
    }).join('');

    const content = set ? `
      <section class="dge-set-editor">
        <header class="dge-set-header">
          <div>
            <h2>${escapeHtml(set.name)}</h2>
            <code>${escapeHtml(set.id)}</code>
          </div>
          <div class="dge-set-actions">
            <button type="button" data-action="set-rename">名前変更</button>
            <button type="button" data-action="set-delete" class="danger" ${deleteBlocked ? 'disabled' : ''}
              title="${deleteBlocked ? escapeHtml(sets.length <= 1 ? '最後の素材セットは削除できません' : `${referenceCount}フロアから参照されています`) : '素材セットを削除'}">削除</button>
          </div>
        </header>
        <div class="dge-assets-workspace">
          <div class="dge-asset-card-grid">
            ${SET_ASSET_KEYS.map((key) => renderAssetCard(set, key)).join('')}
          </div>
          <aside class="dge-assets-preview-pane">
            <div class="dge-mini-title">実機相当3Dプレビュー</div>
            <canvas class="dge-assets-view" width="200" height="128"></canvas>
            <p>${escapeHtml(state.current?.name || 'フロア未選択')} の視点で素材を確認します。</p>
            ${renderGeneratedAssets()}
          </aside>
        </div>
      </section>
    ` : `
      <div class="dge-assets-empty">
        <p>素材セットがありません。「新規」で作成してください。</p>
      </div>
    `;

    const commonSection = `
      <section class="dge-set-editor dge-common-editor">
        <header class="dge-set-header">
          <div>
            <h2>共通素材</h2>
            <code>宝箱・階段 (全素材セット共通・プロジェクトで1回だけ生成)</code>
          </div>
        </header>
        <div class="dge-asset-card-grid">
          ${COMMON_ASSET_KEYS.map((key) => renderCommonAssetCard(key)).join('')}
        </div>
      </section>
    `;

    ui.assets.innerHTML = `
      <div class="dge-assets-layout">
        <aside class="dge-set-list-pane">
          <header>
            <strong>素材セット</strong>
            <span>${sets.length}/${MAX_ASSET_SETS}</span>
          </header>
          <div class="dge-set-list">${setList || '<p>未定義</p>'}</div>
          <div class="dge-set-list-actions">
            <button type="button" data-action="set-new" ${sets.length >= MAX_ASSET_SETS ? 'disabled' : ''}>新規</button>
            <button type="button" data-action="set-duplicate" ${!set || sets.length >= MAX_ASSET_SETS ? 'disabled' : ''}>複製</button>
          </div>
        </aside>
        <div class="dge-assets-main">
          ${commonSection}
          ${content}
        </div>
      </div>
    `;
    ui.assetsView = ui.assets.querySelector('.dge-assets-view');
    if (ui.assetsView) ui.assetsView.getContext('2d').imageSmoothingEnabled = false;
    const generation = ++state.assetCardsGeneration;
    if (set) SET_ASSET_KEYS.forEach((key) => void loadAssetCardPreview(set.id, key, generation));
    COMMON_ASSET_KEYS.forEach((key) => void loadAssetCardPreview(COMMON_CARD_SENTINEL, key, generation));
  }

  /* ------------------------------------------------------------------
   * 設定タブ (アニメーションフレーム数 / 移動速度の既定値)
   * ------------------------------------------------------------------ */

  function renderSettings() {
    if (!ui.settings) return;
    const settings = state.settings || {};
    const animationFrames = Math.max(ANIMATION_FRAMES_MIN, Math.min(ANIMATION_FRAMES_MAX, Number(settings.animation_frames) || ANIMATION_FRAMES_MAX));
    const turnFrames = Math.max(ANIMATION_FRAMES_MIN, Math.min(ANIMATION_FRAMES_MAX, Number(settings.turn_frames) || animationFrames));
    const moveSpeed = Math.max(0, Math.min(MOVE_SPEED_VBLANKS_MAX, Number(settings.move_speed_vblanks) || 0));
    const enemyStep = Math.max(ENEMY_STEP_VBLANKS_MIN, Math.min(ENEMY_STEP_VBLANKS_MAX, Number(settings.enemy_step_vblanks) || 90));
    ui.settings.innerHTML = `
      <div class="dge-settings-form">
        <h2>ダンジョン設定</h2>
        <p class="dge-settings-hint">
          アニメーションフレーム数を減らすとパターン数が減りROM容量を削減できますが、動きは荒くなります。
          移動速度は前進/後退の1コマごとに、実機必須の2vblank転送に加えて追加で待つvblank数です。
          値が大きいほど1マスの移動がゆっくりになり、0で最速 (追加待ちなし) になります。
          ここで設定するのは起動時の既定値で、ゲーム内のパワーアップ演出などから DUN_setMoveSpeed() を
          呼ぶことで実行中に変更できます (このプレビューは既定値のみを反映します)。
          エネミー移動間隔は徘徊/追跡の1手ごとに待つvblank数です (焼き込みには影響せず、保存のたびに
          再ベイクなしで反映されます)。
        </p>
        <label class="dge-field">前進/後退アニメーションフレーム数 (${ANIMATION_FRAMES_MIN}〜${ANIMATION_FRAMES_MAX})
          <input type="number" min="${ANIMATION_FRAMES_MIN}" max="${ANIMATION_FRAMES_MAX}" step="1" data-settings-field="animation_frames" value="${animationFrames}">
        </label>
        <label class="dge-field">旋回アニメーションフレーム数 (${ANIMATION_FRAMES_MIN}〜${ANIMATION_FRAMES_MAX})
          <input type="number" min="${ANIMATION_FRAMES_MIN}" max="${ANIMATION_FRAMES_MAX}" step="1" data-settings-field="turn_frames" value="${turnFrames}">
        </label>
        <label class="dge-field">移動速度: 追加待ちvblank数 (0〜${MOVE_SPEED_VBLANKS_MAX}, 0=最速)
          <input type="number" min="0" max="${MOVE_SPEED_VBLANKS_MAX}" step="1" data-settings-field="move_speed_vblanks" value="${moveSpeed}">
        </label>
        <label class="dge-field">エネミー移動間隔: vblank数 (${ENEMY_STEP_VBLANKS_MIN}〜${ENEMY_STEP_VBLANKS_MAX}, 既定90≒1.5秒)
          <input type="number" min="${ENEMY_STEP_VBLANKS_MIN}" max="${ENEMY_STEP_VBLANKS_MAX}" step="1" data-settings-field="enemy_step_vblanks" value="${enemyStep}">
        </label>
        <button type="button" class="dge-wide" data-action="settings-save">設定を保存</button>
      </div>
    `;
  }

  function readSettingsFormFields() {
    if (!ui.settings) return null;
    const animInput = ui.settings.querySelector('[data-settings-field="animation_frames"]');
    const turnInput = ui.settings.querySelector('[data-settings-field="turn_frames"]');
    const speedInput = ui.settings.querySelector('[data-settings-field="move_speed_vblanks"]');
    const enemyStepInput = ui.settings.querySelector('[data-settings-field="enemy_step_vblanks"]');
    const animationFrames = Math.max(ANIMATION_FRAMES_MIN, Math.min(ANIMATION_FRAMES_MAX, Number(animInput?.value) || ANIMATION_FRAMES_MAX));
    const turnFrames = Math.max(ANIMATION_FRAMES_MIN, Math.min(ANIMATION_FRAMES_MAX, Number(turnInput?.value) || animationFrames));
    const moveSpeed = Math.max(0, Math.min(MOVE_SPEED_VBLANKS_MAX, Number(speedInput?.value) || 0));
    const enemyStep = Math.max(ENEMY_STEP_VBLANKS_MIN, Math.min(ENEMY_STEP_VBLANKS_MAX, Number(enemyStepInput?.value) || 90));
    return {
      animation_frames: animationFrames,
      turn_frames: turnFrames,
      move_speed_vblanks: moveSpeed,
      enemy_step_vblanks: enemyStep,
    };
  }

  async function saveSettingsForm() {
    const fields = readSettingsFormFields();
    if (!fields) return;
    if (!await guardUnsaved('設定を保存する')) return;
    const nextSettings = { ...state.settings, ...fields };
    const result = await api.plugins.invokeHook(plugin.id, 'saveDungeonSettings', { settings: cloneData(nextSettings) });
    if (!result?.ok) {
      setStatus(result?.error || '設定の保存に失敗しました');
      return;
    }
    state.settings = normalizeSettingsForUi(result.settings || nextSettings);
    if (Array.isArray(result.floors)) state.floors = result.floors.map(normalizeFloorForUi);
    state.current = state.floors.find((floor) => floor.id === state.current?.id) || state.floors[0] || state.current;
    state.exportInfo = result.export || state.exportInfo;
    invalidateViewModel();
    setDirty(false);
    captureCommittedState();
    setStatus('設定を保存しました');
    renderSettings();
    renderPreview();
    updateEnemyStepHint();
  }

  function renderAssetCard(set, key) {
    const meta = ASSET_META[key];
    const ref = String(set.assets?.[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    const isDefault = ref === String(state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    return `
      <article class="dge-asset-card" data-asset-card="${key}">
        <header>
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${meta.width}×${meta.height} / 16色${meta.opaque ? ' / 不透明' : ' / 透過可'}</span>
        </header>
        <div class="dge-asset-thumb"><img alt="${escapeHtml(meta.label)} preview"></div>
        <label>保存先<input type="text" readonly value="${escapeHtml(ref)}" title="${escapeHtml(ref)}"></label>
        <div class="dge-asset-facts">
          <span data-asset-dimensions>読込中...</span>
          <span data-asset-colors>- colors</span>
        </div>
        <div class="dge-asset-validation pending" data-asset-validation>検証中...</div>
        <div class="dge-asset-actions">
          <button type="button" data-action="asset-import" data-asset-key="${key}">${isDefault ? '選択' : '置換'}</button>
          <button type="button" data-action="asset-default" data-asset-key="${key}" ${isDefault ? 'disabled' : ''}>既定に戻す</button>
        </div>
      </article>
    `;
  }

  function renderCommonAssetCard(key) {
    const meta = ASSET_META[key];
    const commonAssets = state.settings?.common_assets || {};
    const ref = String(commonAssets[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    const isDefault = ref === String(state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    return `
      <article class="dge-asset-card" data-asset-card="${key}" data-common="1">
        <header>
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${meta.width}×${meta.height} / 16色${meta.opaque ? ' / 不透明' : ' / 透過可'}</span>
        </header>
        <div class="dge-asset-thumb"><img alt="${escapeHtml(meta.label)} preview"></div>
        <label>保存先<input type="text" readonly value="${escapeHtml(ref)}" title="${escapeHtml(ref)}"></label>
        <div class="dge-asset-facts">
          <span data-asset-dimensions>読込中...</span>
          <span data-asset-colors>- colors</span>
        </div>
        <div class="dge-asset-validation pending" data-asset-validation>検証中...</div>
        <div class="dge-asset-actions">
          <button type="button" data-action="asset-import" data-asset-key="${key}" data-common="1">${isDefault ? '選択' : '置換'}</button>
          <button type="button" data-action="asset-default" data-asset-key="${key}" data-common="1" ${isDefault ? 'disabled' : ''}>既定に戻す</button>
          ${key === 'enemy_texture' ? '<button type="button" data-action="asset-model-gen" data-asset-key="enemy_texture">3Dモデルから生成</button>' : ''}
        </div>
      </article>
    `;
  }

  function renderGeneratedAssets() {
    const exportInfo = state.exportInfo || {};
    const tileCount = exportInfo.patternTileCount ? `${exportInfo.patternTileCount} tiles` : '-';
    const setStats = Array.isArray(exportInfo.sets)
      ? exportInfo.sets
      : (Array.isArray(exportInfo.assetSets) ? exportInfo.assetSets : []);
    const perSet = setStats.length ? `
      <div class="dge-export-set-stats">
        ${setStats.map((entry) => `<div>${escapeHtml(entry.name || entry.id || 'set')}: ${escapeHtml(entry.tileCount ?? entry.patternTileCount ?? '-')} tiles / ${escapeHtml(entry.budget?.totalBytes ?? entry.bytes ?? entry.romBytes ?? '-')} bytes${entry.cached ? ' (cache)' : ''}</div>`).join('')}
      </div>
    ` : '';
    const warnings = Array.isArray(exportInfo.warnings) && exportInfo.warnings.length
      ? `<div class="dge-export-warnings">${exportInfo.warnings.map((w) => `⚠ ${escapeHtml(w)}`).join('<br>')}</div>`
      : '';
    return `
      <div class="dge-generated-assets">
        <button class="dge-wide" data-action="export-assets">SGDKアセット生成</button>
        <div>Tileset: ${escapeHtml(shortProjectPath(exportInfo.patternTilesetPath || 'res/dungeon/generated/dungeon_view_tileset.png'))}</div>
        <div>Res: ${escapeHtml(shortProjectPath(exportInfo.resourcePath || 'res/resources.res'))}</div>
        <div>${escapeHtml(tileCount)}</div>
        ${perSet}
        ${warnings}
      </div>
    `;
  }

  function shortProjectPath(filePath) {
    if (!filePath || !state.projectDir) return filePath || '';
    return String(filePath).startsWith(state.projectDir) ? String(filePath).slice(state.projectDir.length + 1) : filePath;
  }

  function countSetReferences(setId) {
    return state.floors.reduce((count, floor) => count + (floor.asset_set_id === setId ? 1 : 0), 0);
  }

  function makeUniqueSetId(name) {
    const stem = String(name || 'set')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || `set-${Date.now().toString(36)}`;
    const used = new Set(assetSets().map((set) => set.id));
    let id = stem;
    let suffix = 2;
    while (used.has(id)) id = `${stem}-${suffix++}`;
    return id;
  }

  async function createAssetSet({ duplicate = false } = {}) {
    if (assetSets().length >= MAX_ASSET_SETS) {
      setStatus(`素材セットは${MAX_ASSET_SETS}件までです`);
      return;
    }
    if (!await guardUnsaved('新しい素材セットを作成')) return;
    const source = duplicate ? selectedAssetSet() : null;
    const initialName = source ? `${source.name} コピー` : `素材セット ${assetSets().length + 1}`;
    const name = await requestTextModal(duplicate ? '素材セットを複製' : '素材セットを作成', 'セット名', initialName, duplicate ? '複製' : '作成');
    if (!name) return;
    const set = {
      id: makeUniqueSetId(name),
      name,
      assets: cloneData(source?.assets || state.defaultAssets),
    };
    state.settings.asset_sets.push(normalizeAssetSetForUi(set, assetSets().length));
    state.assetEditorSetId = set.id;
    setDirty(true);
    setStatus(`素材セット「${name}」を追加しました`);
    renderAll();
    void loadTexturesForAssetEditor();
  }

  async function renameAssetSet() {
    const set = selectedAssetSet();
    if (!set) return;
    const name = await requestTextModal('素材セット名を変更', 'セット名', set.name, '変更');
    if (!name || name === set.name) return;
    set.name = name;
    setDirty(true);
    setStatus(`素材セット名を「${name}」へ変更しました`);
    renderAll();
  }

  function deleteAssetSet() {
    const set = selectedAssetSet();
    if (!set) return;
    if (assetSets().length <= 1) {
      setStatus('最後の素材セットは削除できません');
      return;
    }
    const references = countSetReferences(set.id);
    if (references > 0) {
      setStatus(`${references}フロアから参照されているため削除できません`);
      return;
    }
    state.settings.asset_sets = assetSets().filter((entry) => entry.id !== set.id);
    state.assetEditorSetId = firstAssetSet()?.id || '';
    state.assetTextures = null;
    state.assetViewModel = null;
    setDirty(true);
    setStatus(`素材セット「${set.name}」を削除しました`);
    renderAll();
    void loadTexturesForAssetEditor();
  }

  async function selectAssetEditorSet(setId) {
    if (!assetSetById(setId) || setId === state.assetEditorSetId) return;
    if (!await guardUnsaved('別の素材セットへ切り替え')) {
      renderAssets();
      renderPreview();
      return;
    }
    state.assetEditorSetId = setId;
    state.assetTextures = null;
    state.assetViewModel = null;
    renderAll();
    await loadTexturesForAssetEditor();
  }

  function requestTextModal(title, label, initialValue, submitText) {
    return new Promise((resolve) => {
      const html = `
        <header class="dge-modal-header"><h2>${escapeHtml(title)}</h2></header>
        <form class="dge-modal-form">
          <label>${escapeHtml(label)}<input type="text" value="${escapeHtml(initialValue)}" maxlength="80" required></label>
          <div class="dge-modal-actions">
            <button type="button" data-decision="cancel">キャンセル</button>
            <button type="submit" class="primary">${escapeHtml(submitText)}</button>
          </div>
        </form>
      `;
      const modal = api.createModal({
        id: `${plugin.id}-text-modal`,
        panelClassName: 'app-panel app-panel-sm dge-modal-panel',
        html,
      });
      const form = modal.panel.querySelector('form');
      const input = modal.panel.querySelector('input');
      let finished = false;
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(null);
      };
      const finish = (value) => {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.close();
        modal.destroy();
        resolve(value);
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        finish(String(input.value || '').trim() || null);
      }, { once: true });
      modal.panel.querySelector('[data-decision="cancel"]')?.addEventListener('click', () => finish(null), { once: true });
      modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(null), { once: true });
      document.addEventListener('keydown', onKeyDown);
      modal.open();
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  async function loadAssetCardPreview(setId, key, generation) {
    const isCommon = setId === COMMON_CARD_SENTINEL;
    const set = isCommon ? null : assetSetById(setId);
    const meta = ASSET_META[key];
    if ((!isCommon && !set) || !meta) return;
    const ref = isCommon
      ? String(state.settings?.common_assets?.[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key])
      : String(set.assets?.[key] || state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    const parsed = parseTextureRef(ref);
    const projectDir = await refreshProjectDir();
    const sourcePath = resolveAssetPath(parsed.path, projectDir);
    const read = sourcePath ? await api.electronAPI?.readFileAsDataUrl?.(sourcePath).catch(() => null) : null;
    if (!read?.ok || !read.dataUrl) {
      if (parsed.tag) {
        const texture = core.makeFallbackTexture(meta.kind);
        const pixels = inspectPixels(texture.data);
        updateAssetCard(setId, key, generation, {
          dataUrl: textureToDataUrl(texture),
          width: texture.width,
          height: texture.height,
          colors: pixels.colors,
          legacy: true,
          status: `互換参照 #${parsed.tag}（既定描画へフォールバック）`,
        });
        return;
      }
      updateAssetCard(setId, key, generation, { error: read?.error || '画像を読み込めません' });
      return;
    }
    try {
      const image = await loadImage(read.dataUrl);
      if (parsed.tag) {
        const layout = await loadAtlasLayout(sourcePath);
        const cropped = cropAtlasTexture(image, parsed.tag, layout);
        const texture = cropped || core.makeFallbackTexture(meta.kind);
        const pixels = inspectPixels(texture.data);
        updateAssetCard(setId, key, generation, {
          dataUrl: textureToDataUrl(texture),
          width: texture.width,
          height: texture.height,
          colors: pixels.colors,
          legacy: true,
          status: cropped ? `互換アトラス #${parsed.tag}` : `互換アトラス #${parsed.tag}（既定描画へフォールバック）`,
        });
        return;
      }
      const inspection = await inspectImageDataUrl(read.dataUrl);
      const validation = validateAssetInspection(inspection, meta);
      updateAssetCard(setId, key, generation, {
        dataUrl: read.dataUrl,
        width: inspection.width,
        height: inspection.height,
        colors: inspection.colors,
        ok: validation.ok,
        status: validation.message,
      });
    } catch (err) {
      updateAssetCard(setId, key, generation, { error: String(err?.message || err) });
    }
  }

  function updateAssetCard(setId, key, generation, details) {
    if (generation !== state.assetCardsGeneration) return;
    if (setId !== COMMON_CARD_SENTINEL && selectedAssetSet()?.id !== setId) return;
    const card = ui.assets.querySelector(`[data-asset-card="${key}"]`);
    if (!card) return;
    const image = card.querySelector('img');
    const dimensions = card.querySelector('[data-asset-dimensions]');
    const colors = card.querySelector('[data-asset-colors]');
    const validation = card.querySelector('[data-asset-validation]');
    if (details.dataUrl) image.src = details.dataUrl;
    else image.removeAttribute('src');
    dimensions.textContent = details.width && details.height ? `${details.width}×${details.height}` : '-';
    colors.textContent = Number.isFinite(details.colors) ? `${details.colors} colors` : '- colors';
    validation.className = `dge-asset-validation ${details.error ? 'error' : (details.legacy || details.ok ? 'ok' : 'error')}`;
    validation.textContent = details.error || details.status || '検証できません';
  }

  function textureToDataUrl(texture) {
    const canvas = document.createElement('canvas');
    canvas.width = texture.width;
    canvas.height = texture.height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(texture.width, texture.height);
    image.data.set(texture.data);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function importAssetForSet(key) {
    const isCommon = COMMON_ASSET_KEYS.includes(key);
    const set = isCommon ? null : selectedAssetSet();
    const meta = ASSET_META[key];
    if ((!isCommon && !set) || !meta) return;
    const picked = await api.electronAPI.pickFile({
      title: `${meta.label}画像を選択`,
      properties: ['openFile'],
      filters: [
        { name: 'PNG / BMP', extensions: ['png', 'bmp'] },
        { name: 'PNG', extensions: ['png'] },
        { name: 'BMP', extensions: ['bmp'] },
      ],
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const pipeline = api.capabilities.get('image-import-pipeline')
      || await api.capabilities.require?.('image-import-pipeline', 1000);
    if (!pipeline?.convertToIndexed16) {
      setStatus('画像インポート機能が無効です（Asset Manager / Resize / Quantize を確認してください）');
      return;
    }

    setStatus(`${meta.label}を変換中...`);
    const converted = await pipeline.convertToIndexed16({
      sourcePath: picked.sourcePath,
      targetSize: { width: meta.width, height: meta.height },
    }).catch((err) => ({ canceled: true, warning: String(err?.message || err) }));
    if (converted?.canceled) {
      setStatus(converted?.warning || '画像変換をキャンセルしました');
      return;
    }

    let ext = String(converted?.targetExtension || '.png').trim().toLowerCase();
    if (!ext.startsWith('.')) ext = `.${ext}`;
    if (ext !== '.png') {
      setStatus(`保存形式が不正です: ${ext}（8bit Indexed PNGのみ使用できます）`);
      return;
    }

    let dataUrl = converted?.convertedDataUrl || converted?.originalDataUrl || '';
    if (!dataUrl) {
      const read = await api.electronAPI.readFileAsDataUrl(picked.sourcePath).catch(() => null);
      dataUrl = read?.dataUrl || '';
    }
    if (!dataUrl) {
      setStatus('変換画像を読み込めません');
      return;
    }

    try {
      let inspection = await inspectImageDataUrl(dataUrl);
      if (!isRequiredIndexedPng(inspection.png)) {
        const encoder = api.capabilities.get('image-quantize')?.imageDataToIndexedPng || api.imageDataToIndexedPng;
        if (!encoder) throw new Error('8bit Indexed PNGへ再エンコードできません');
        dataUrl = await encoder(inspection.imageData);
        inspection = await inspectImageDataUrl(dataUrl);
      }
      const validation = validateAssetInspection(inspection, meta);
      if (!validation.ok) throw new Error(validation.message);

      const safeSetId = isCommon ? 'common' : safePathPart(set.id);
      const targetSubdir = `dungeon/textures/${safeSetId}`;
      const targetFileName = `${meta.fileName}${ext}`;
      const written = await api.electronAPI.writeAssetFile({
        sourcePath: picked.sourcePath,
        targetSubdir,
        targetFileName,
        dataUrl,
      });
      if (!written?.ok) throw new Error(written?.error || '画像の保存に失敗しました');
      if (!isCommon && selectedAssetSet()?.id !== set.id) return;
      const relativePath = normalizeSavedAssetPath(written.relativePath || `${targetSubdir}/${targetFileName}`);
      if (isCommon) {
        if (!state.settings.common_assets) state.settings.common_assets = {};
        state.settings.common_assets[key] = relativePath;
      } else {
        set.assets[key] = relativePath;
      }
      setDirty(true);
      setStatus(`${meta.label}を設定しました${converted.warning ? ` / ${converted.warning}` : ''}`);
      if (isCommon) refreshTextureConsumers(null, { common: true });
      else refreshTextureConsumers(set.id);
    } catch (err) {
      setStatus(`${meta.label}: ${String(err?.message || err)}`);
      renderAssets();
      renderPreview();
    }
  }

  /*
   * 「3Dモデルから生成」: glTF/GLB + モーションを読み込み、4方向×歩行2フレームの
   * enemy_texture (192x96 indexed<=16色) をラスタライズして既存のenemy_texture書き込み
   * 経路 (commitEnemyTextureDataUrl → importAssetForSet と同じtail) へ流す。
   * 描画本体は enemy-model-render.js (Three.jsをvendor、モーダルを開いた時だけ遅延import)。
   * v1はセッション内メモリのみ: モデルファイル自体・パラメータはディスクへ保存せず、
   * 同一セッション内での再オープン時のみ最後のパラメータをモーダルへ復元する。
   */
  const enemyModelDefaultParams = Object.freeze({
    frontYawOffset: 0,
    elevationDeg: 0,
    zoom: 1,
    clipName: '',
    sampleFractionA: 0,
    sampleFractionB: 0.5,
  });

  function dataUrlToArrayBuffer(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) throw new Error('不正なデータURLです');
    const binary = atob(String(dataUrl).slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function drawEnemyModelPreview(canvasEl, imageData) {
    const ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.putImageData(imageData, 0, 0);
  }

  async function openEnemyModelGenerator() {
    let renderModule;
    try {
      renderModule = await import(new URL('./enemy-model-render.js', import.meta.url));
    } catch (err) {
      setStatus('3Dモデル機能のライブラリ (vendor/three) が見つかりません');
      return;
    }

    if (!state.enemyModelParams) state.enemyModelParams = { ...enemyModelDefaultParams };
    const lastParams = state.enemyModelParams;

    const html = `
      <header class="dge-modal-header"><h2>敵スプライトを3Dモデルから生成</h2></header>
      <div class="dge-model-modal-body">
        <div class="dge-model-modal-controls">
          <div class="dge-model-modal-row">
            <button type="button" data-model-pick>glTF/GLBを選択…</button>
            <span class="dge-model-modal-filename" data-model-filename>未選択</span>
          </div>
          <label>アニメーション
            <select data-model-clip><option value="">(静止ポーズ)</option></select>
          </label>
          <label>歩行フレームA (サンプル時刻)
            <input type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(lastParams.sampleFractionA))}" data-model-fraction-a>
          </label>
          <label>歩行フレームB (サンプル時刻)
            <input type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(lastParams.sampleFractionB))}" data-model-fraction-b>
          </label>
          <label>モデルの正面
            <select data-model-front-yaw>
              <option value="0" ${lastParams.frontYawOffset === 0 ? 'selected' : ''}>+Z向き (既定)</option>
              <option value="180" ${lastParams.frontYawOffset === 180 ? 'selected' : ''}>-Z向き (180°反転)</option>
            </select>
          </label>
          <label>仰角 <span data-model-elevation-value>${escapeHtml(String(lastParams.elevationDeg))}°</span>
            <input type="range" min="-30" max="30" step="1" value="${escapeHtml(String(lastParams.elevationDeg))}" data-model-elevation>
          </label>
          <label>ズーム <span data-model-zoom-value>${Number(lastParams.zoom).toFixed(2)}×</span>
            <input type="range" min="0.5" max="2" step="0.05" value="${escapeHtml(String(lastParams.zoom))}" data-model-zoom>
          </label>
        </div>
        <div class="dge-model-modal-preview">
          <canvas class="dge-model-preview-canvas" width="${core.BB_ENEMY_SOURCE_W}" height="${core.BB_ENEMY_SOURCE_H}" data-model-preview></canvas>
          <div class="dge-model-modal-status" data-model-status>3Dモデル(.glb/.gltf)を選択してください</div>
        </div>
      </div>
      <div class="dge-modal-actions">
        <button type="button" data-decision="cancel">キャンセル</button>
        <button type="button" class="primary" data-decision="apply" disabled>敵テクスチャとして適用</button>
      </div>
    `;

    const modal = api.createModal({
      id: `${plugin.id}-model-modal`,
      panelClassName: 'app-panel app-panel-lg dge-modal-panel dge-model-modal',
      html,
    });
    modal.panel.innerHTML = html;

    const els = {
      pick: modal.panel.querySelector('[data-model-pick]'),
      filename: modal.panel.querySelector('[data-model-filename]'),
      clip: modal.panel.querySelector('[data-model-clip]'),
      fractionA: modal.panel.querySelector('[data-model-fraction-a]'),
      fractionB: modal.panel.querySelector('[data-model-fraction-b]'),
      frontYaw: modal.panel.querySelector('[data-model-front-yaw]'),
      elevation: modal.panel.querySelector('[data-model-elevation]'),
      elevationValue: modal.panel.querySelector('[data-model-elevation-value]'),
      zoom: modal.panel.querySelector('[data-model-zoom]'),
      zoomValue: modal.panel.querySelector('[data-model-zoom-value]'),
      preview: modal.panel.querySelector('[data-model-preview]'),
      status: modal.panel.querySelector('[data-model-status]'),
      applyButton: modal.panel.querySelector('[data-decision="apply"]'),
    };

    let session = null;
    let model = null;
    let renderGeneration = 0;
    let debounceTimer = null;
    let finished = false;

    const setModalStatus = (text) => { els.status.textContent = text; };

    const currentParams = () => ({
      frontYawOffset: Number(els.frontYaw.value) || 0,
      elevationDeg: Number(els.elevation.value) || 0,
      zoom: Number(els.zoom.value) || 1,
      clipName: els.clip.value || '',
      sampleFractionA: Number(els.fractionA.value) || 0,
      sampleFractionB: Number(els.fractionB.value) || 0,
    });

    const finish = (decision) => {
      if (finished) return;
      finished = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener('keydown', onKeyDown);
      session?.dispose?.();
      session = null;
      modal.close();
      modal.destroy();
      return decision;
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish('cancel');
    };

    async function doRender() {
      if (!model || !session || finished) return;
      const generation = ++renderGeneration;
      const params = currentParams();
      state.enemyModelParams = params;
      try {
        const imageData = await renderModule.renderGrid(session, model, params);
        if (generation !== renderGeneration || finished) return;
        drawEnemyModelPreview(els.preview, imageData);
        els.applyButton.disabled = false;
        setModalStatus('プレビューを更新しました');
      } catch (err) {
        if (generation !== renderGeneration || finished) return;
        setModalStatus(`描画エラー: ${String(err?.message || err)}`);
        els.applyButton.disabled = true;
      }
    }

    const scheduleRender = () => {
      if (!model || !session) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void doRender(); }, 120);
    };

    els.pick.addEventListener('click', async () => {
      const picked = await api.electronAPI.pickFile({
        title: '3Dモデルを選択',
        properties: ['openFile'],
        filters: [{ name: 'glTF / GLB', extensions: ['glb', 'gltf'] }],
      });
      if (picked?.canceled || !picked?.sourcePath) return;
      setModalStatus('モデルを読み込み中...');
      els.applyButton.disabled = true;
      try {
        const read = await api.electronAPI.readFileAsDataUrl(picked.sourcePath);
        if (!read?.dataUrl) throw new Error('ファイルを読み込めません');
        const arrayBuffer = dataUrlToArrayBuffer(read.dataUrl);
        model = await renderModule.parseModel(arrayBuffer);
        els.filename.textContent = String(picked.sourcePath).split(/[\\/]/).pop() || picked.sourcePath;
        els.clip.innerHTML = `<option value="">(静止ポーズ)</option>${
          model.clipNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
        }`;
        if (!session) session = renderModule.createSession();
        setModalStatus('モデルを読み込みました');
        scheduleRender();
      } catch (err) {
        model = null;
        setModalStatus(`読み込みエラー: ${String(err?.message || err)}`);
      }
    });

    els.clip.addEventListener('change', scheduleRender);
    els.fractionA.addEventListener('input', scheduleRender);
    els.fractionB.addEventListener('input', scheduleRender);
    els.frontYaw.addEventListener('change', scheduleRender);
    els.elevation.addEventListener('input', () => {
      els.elevationValue.textContent = `${els.elevation.value}°`;
      scheduleRender();
    });
    els.zoom.addEventListener('input', () => {
      els.zoomValue.textContent = `${Number(els.zoom.value).toFixed(2)}×`;
      scheduleRender();
    });

    modal.panel.querySelectorAll('[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.dataset.decision === 'cancel') { finish('cancel'); return; }
        if (button.dataset.decision !== 'apply' || !model || !session) return;
        els.applyButton.disabled = true;
        setModalStatus('16色PNGへ変換中...');
        try {
          const params = currentParams();
          const imageData = await renderModule.renderGrid(session, model, params);
          const dataUrl = await renderModule.toIndexedEnemyPng(imageData, api);
          state.enemyModelParams = params;
          finish('apply');
          await commitEnemyTextureDataUrl(dataUrl);
        } catch (err) {
          setModalStatus(`生成エラー: ${String(err?.message || err)}`);
          els.applyButton.disabled = false;
        }
      });
    });
    modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish('cancel'));
    document.addEventListener('keydown', onKeyDown);
    modal.open();
  }

  async function commitEnemyTextureDataUrl(dataUrl) {
    const key = 'enemy_texture';
    const meta = ASSET_META[key];
    try {
      let inspection = await inspectImageDataUrl(dataUrl);
      if (!isRequiredIndexedPng(inspection.png)) {
        const encoder = api.capabilities.get('image-quantize')?.imageDataToIndexedPng || api.imageDataToIndexedPng;
        if (!encoder) throw new Error('8bit Indexed PNGへ再エンコードできません');
        dataUrl = await encoder(inspection.imageData);
        inspection = await inspectImageDataUrl(dataUrl);
      }
      const validation = validateAssetInspection(inspection, meta);
      if (!validation.ok) throw new Error(validation.message);

      const targetSubdir = 'dungeon/textures/common';
      const targetFileName = `${meta.fileName}.png`;
      const written = await api.electronAPI.writeAssetFile({
        targetSubdir,
        targetFileName,
        dataUrl,
      });
      if (!written?.ok) throw new Error(written?.error || '画像の保存に失敗しました');
      const relativePath = normalizeSavedAssetPath(written.relativePath || `${targetSubdir}/${targetFileName}`);
      if (!state.settings.common_assets) state.settings.common_assets = {};
      state.settings.common_assets[key] = relativePath;
      setDirty(true);
      setStatus(`${meta.label}を3Dモデルから生成しました`);
      refreshTextureConsumers(null, { common: true });
    } catch (err) {
      setStatus(`${meta.label}: ${String(err?.message || err)}`);
      renderAssets();
      renderPreview();
    }
  }

  function resetAssetToDefault(key) {
    if (!ASSET_META[key]) return;
    if (COMMON_ASSET_KEYS.includes(key)) {
      if (!state.settings?.common_assets) return;
      state.settings.common_assets[key] = String(state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
      setDirty(true);
      setStatus(`${ASSET_META[key].label}を既定素材へ戻しました`);
      refreshTextureConsumers(null, { common: true });
      return;
    }
    const set = selectedAssetSet();
    if (!set) return;
    set.assets[key] = String(state.defaultAssets[key] || DEFAULT_ASSET_REFS[key]);
    setDirty(true);
    setStatus(`${ASSET_META[key].label}を既定素材へ戻しました`);
    refreshTextureConsumers(set.id);
  }

  function refreshTextureConsumers(changedSetId, options = {}) {
    clearTextureCache();
    state.viewModel = null;
    state.assetViewModel = null;
    state.assetTextures = null;
    renderAll();
    if (options.common || state.current?.asset_set_id === changedSetId) void loadTexturesForCurrent();
    void loadTexturesForAssetEditor();
  }

  function normalizeSavedAssetPath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^res\//i, '');
  }

  function safePathPart(value) {
    const raw = String(value || '').toLowerCase();
    const safe = raw
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'set';
    if (safe === raw && /^[a-z0-9_-]+$/.test(raw)) return safe;
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index++) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${safe}-${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)}`;
  }

  function inspectPixels(data) {
    const colors = new Set();
    let hasTransparency = false;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 255) hasTransparency = true;
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${alpha}`);
    }
    return { colors: colors.size, hasTransparency };
  }

  async function inspectImageDataUrl(dataUrl) {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = inspectPixels(imageData.data);
    const png = inspectPng(dataUrl);
    return {
      width,
      height,
      colors: Math.max(pixels.colors, Number(png?.paletteEntries || 0)),
      hasTransparency: pixels.hasTransparency,
      imageData,
      png,
    };
  }

  function validateAssetInspection(inspection, meta) {
    const errors = [];
    if (inspection.width !== meta.width || inspection.height !== meta.height) {
      errors.push(`サイズは${meta.width}×${meta.height}が必要です（現在${inspection.width}×${inspection.height}）`);
    }
    if (inspection.colors > 16) errors.push(`色数が16色を超えています（${inspection.colors}色）`);
    if (meta.opaque && inspection.hasTransparency) errors.push('透過ピクセルは使用できません');
    if (!isRequiredIndexedPng(inspection.png)) errors.push('8bit・非interlaceのIndexed PNGではありません');
    return {
      ok: errors.length === 0,
      message: errors.length ? errors.join(' / ') : '有効: 8bit Indexed PNG',
    };
  }

  function isRequiredIndexedPng(png) {
    return Boolean(png
      && png.bitDepth === 8
      && png.colorType === 3
      && png.interlace === 0
      && png.paletteEntries > 0
      && png.paletteEntries <= 16);
  }

  function inspectPng(dataUrl) {
    try {
      const comma = String(dataUrl || '').indexOf(',');
      if (comma < 0 || !/image\/png/i.test(String(dataUrl).slice(0, comma))) return null;
      const binary = atob(String(dataUrl).slice(comma + 1));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      if (bytes.length < 33 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;
      const result = {
        width: readU32Be(bytes, 16),
        height: readU32Be(bytes, 20),
        bitDepth: bytes[24],
        colorType: bytes[25],
        interlace: bytes[28],
        paletteEntries: 0,
      };
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = readU32Be(bytes, offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (type === 'PLTE') result.paletteEntries = Math.floor(length / 3);
        offset += 12 + length;
        if (type === 'IDAT' || type === 'IEND') break;
      }
      return result;
    } catch (_) {
      return null;
    }
  }

  function readU32Be(bytes, offset) {
    return (((bytes[offset] << 24) >>> 0)
      | (bytes[offset + 1] << 16)
      | (bytes[offset + 2] << 8)
      | bytes[offset + 3]) >>> 0;
  }

  function renderAll() {
    renderToolButtons();
    renderFloorSelect();
    renderFloorAssetSetSelect();
    renderMap();
    renderAssets();
    renderSettings();
    renderPreview();
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
    if (state.tool === 'chest') {
      cell.event = cell.event === 'chest' ? '' : 'chest';
      /* 宝箱/階段セルとはエネミーのスポーンが排他 (normalizeCell と同じ規則) */
      if (cell.event === 'chest') cell.enemy = false;
    }
    if (state.tool === 'stairs_up') {
      cell.stairs = cell.stairs === 'up' ? '' : 'up';
      if (cell.stairs) cell.enemy = false;
    }
    if (state.tool === 'stairs_down') {
      cell.stairs = cell.stairs === 'down' ? '' : 'down';
      if (cell.stairs) cell.enemy = false;
    }
    if (state.tool === 'enemy') {
      if (cell.enemy) {
        cell.enemy = false;
      } else if (cell.event === 'chest' || cell.stairs) {
        setStatus('宝箱・階段のセルにはエネミーを配置できません');
      } else {
        const count = floor.cells.flat().filter((c) => c.enemy).length;
        if (count >= ENEMY_MAX_PER_FLOOR) setStatus(`エネミーは1フロアにつき${ENEMY_MAX_PER_FLOOR}体までです`);
        else cell.enemy = true;
      }
    }
    if (state.tool === 'start') state.current.start = { x, y, dir: DIR_INDEX[edge] ?? 1 };
    if (state.tool === 'erase') Object.assign(cell, blankCell(0));
    /* マップを編集したフロアの踏破済み記録・エネミーのシミュ状態は無効になる。プレビュー位置は
     * 従来どおり開始セルへ戻るので、そのセルだけを歩き直しとして記録する */
    resetVisitedForFloor(floor.id);
    resetEnemiesForFloor(floor.id);
    state.preview = { ...state.current.start };
    markPreviewVisited(state.current, state.preview.x, state.preview.y);
    ui.cellInfo.textContent = `X:${x} Y:${y} edge:${edge}`;
    setDirty(true);
    renderAll();
  }

  /* ------------------------------------------------------------------
   * プレビュー移動 (実機と同じ離散フレーム再生)
   * ------------------------------------------------------------------ */

  /*
   * core.canTraverse 経由 (プレイヤーと同じ壁/一方通行ルール) + エネミー占有ブロックの合成。
   * 旧実装は one_way を一切見ていなかった (実機の canMove は見ている) — この修正で
   * プレビューと実機の一方通行挙動が一致するようになる (意図した挙動変更)。
   */
  function canPreviewMove(dirIndex) {
    const floor = state.current;
    if (!floor) return false;
    if (!core.canTraverse(floor, state.preview.x, state.preview.y, dirIndex)) return false;
    const dir = DIRS[dirIndex];
    const nx = state.preview.x + dir.dx;
    const ny = state.preview.y + dir.dy;
    const enemies = state.enemiesByFloor.get(floor.id) || [];
    return !enemies.some((enemy) => enemy.active && enemy.x === nx && enemy.y === ny);
  }

  /* 階段遷移: 前のフロアの下り階段 / 次のフロアの上り階段の位置そのものへ */
  async function previewGoStairs(kind) {
    const currentOrder = Number(state.current?.order || 1);
    const targetOrder = kind === 'up' ? currentOrder - 1 : currentOrder + 1;
    let target = state.floors.find((floor) => Number(floor.order) === targetOrder);
    if (!target) {
      setStatus(kind === 'up' ? 'これより上のフロアはありません' : 'これより下のフロアはありません');
      return;
    }
    if (!await guardUnsaved('階段で別フロアへ移動する')) return;
    target = state.floors.find((floor) => Number(floor.order) === targetOrder);
    if (!target) return;
    const arrival = core.stairsArrival(target, kind === 'up' ? 'down' : 'up');
    state.current = target;
    state.preview = arrival
      ? { x: arrival.x, y: arrival.y, dir: arrival.dir }
      : { ...target.start };
    /* 実機の goStairs() と同じく、遷移先フロアの到着セルを踏破済みとして記録する */
    markPreviewVisited(target, state.preview.x, state.preview.y);
    stopPreviewAnimation();
    invalidateViewModel();
    ui.floorSelect.value = target.id;
    ui.name.value = target.name || '';
    ui.width.value = target.width;
    ui.height.value = target.height;
    ui.enemyStep.value = target.enemy_step_vblanks || 0;
    updateEnemyStepHint();
    setStatus(`${target.name || target.id} へ移動しました`);
    renderAll();
    void loadTexturesForCurrent();
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
    /* 前進/後退で階段セルへ着地したら、移動完了後に自動でフロア遷移する */
    const arrivesOnStairs = !isTurn;
    state.animation = { action, from, to, frameIndex: 0, total, lastStep: performance.now(), arrivesOnStairs };
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = requestAnimationFrame(stepPreviewAnimation);
  }

  /*
   * 実機の1アニメフレーム = DUN_ANIMATION_STEP_VBLANKS(2, ハード必須) +
   * settings.move_speed_vblanks (エディタ設定の既定ペーシング) vblank。
   * プレビューのフレーム間隔をこれに合わせることで、実機が起動直後に
   * 再生する速さとエディタ上のプレビューが一致する (WYSIWYG)。
   */
  function frameStepMs() {
    const extra = Math.max(0, Math.min(MOVE_SPEED_VBLANKS_MAX, Number(state.settings?.move_speed_vblanks) || 0));
    return (DUN_ANIMATION_STEP_VBLANKS + extra) * VBLANK_MS;
  }

  function stepPreviewAnimation() {
    const anim = state.animation;
    if (!anim) return;
    renderPreview();
    const now = performance.now();
    if (now - anim.lastStep >= frameStepMs()) {
      anim.lastStep = now;
      anim.frameIndex++;
      if (anim.frameIndex >= anim.total) {
        state.preview = { ...anim.to };
        /* 実機の applyMove() 直後の markVisited() と同じく、移動完了時点で
         * (回転のみの場合は同一セルへの無害な再マークになる) 着地セルを記録する */
        markPreviewVisited(state.current, state.preview.x, state.preview.y);
        state.animation = null;
        renderPreview();
        if (anim.arrivesOnStairs) {
          const landed = cellAt(anim.to.x, anim.to.y);
          if (landed && landed.stairs) void previewGoStairs(landed.stairs);
        }
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

  function captureCommittedState() {
    state.committed = {
      floors: cloneData(state.floors),
      settings: cloneData(state.settings),
      currentId: state.current?.id || '',
      assetEditorSetId: state.assetEditorSetId,
    };
  }

  function restoreCommittedState() {
    if (!state.committed) return;
    state.settings = cloneData(state.committed.settings);
    state.floors = cloneData(state.committed.floors);
    state.current = state.floors.find((floor) => floor.id === state.committed.currentId)
      || state.floors[0]
      || blankFloor(1);
    state.assetEditorSetId = assetSetById(state.committed.assetEditorSetId)
      ? state.committed.assetEditorSetId
      : (state.current.asset_set_id || firstAssetSet()?.id || '');
    /* 未保存の変更を破棄してコミット済みデータへ巻き戻す = データの再読込と同義 */
    resetAllVisited();
    resetAllEnemies();
    clearTextureCache();
    state.textures = null;
    state.assetTextures = null;
    invalidateViewModel();
    setDirty(false);
    syncForm();
    void loadTexturesForCurrent();
    void loadTexturesForAssetEditor();
  }

  function askUnsavedDecision(actionLabel) {
    return new Promise((resolve) => {
      const html = `
        <header class="dge-modal-header"><h2>未保存の変更</h2></header>
        <div class="dge-modal-form">
          <p>${escapeHtml(actionLabel)}前に、変更を保存するか破棄してください。</p>
          <div class="dge-modal-actions">
            <button type="button" data-decision="cancel">キャンセル</button>
            <button type="button" data-decision="discard" class="danger">破棄</button>
            <button type="button" data-decision="save" class="primary">保存</button>
          </div>
        </div>
      `;
      const modal = api.createModal({
        id: `${plugin.id}-unsaved-modal`,
        panelClassName: 'app-panel app-panel-sm dge-modal-panel',
        html,
      });
      let finished = false;
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish('cancel');
      };
      const finish = (decision) => {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.close();
        modal.destroy();
        resolve(decision);
      };
      modal.panel.querySelectorAll('[data-decision]').forEach((button) => {
        button.addEventListener('click', () => finish(button.dataset.decision || 'cancel'), { once: true });
      });
      modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish('cancel'), { once: true });
      document.addEventListener('keydown', onKeyDown);
      modal.open();
    });
  }

  async function guardUnsaved(actionLabel) {
    if (!state.dirty) return true;
    const decision = await askUnsavedDecision(actionLabel);
    if (decision === 'cancel') return false;
    if (decision === 'save') return saveCurrent();
    restoreCommittedState();
    return true;
  }

  async function refresh({ guard = false, preferredFloorId = '' } = {}) {
    if (guard && !await guardUnsaved('再読み込みする')) return false;
    const previousFloorId = preferredFloorId || state.current?.id || '';
    state.projectDir = '';
    await refreshProjectDir();
    const result = await api.plugins.invokeHook(plugin.id, 'listDungeonFloors', {});
    if (!result?.ok) {
      setStatus(result?.error || '読み込みに失敗しました');
      return false;
    }
    state.defaultAssets = { ...DEFAULT_ASSET_REFS, ...(result.defaultAssets || {}) };
    state.settings = normalizeSettingsForUi(result.settings);
    state.floors = (result.floors || []).map(normalizeFloorForUi);
    /* フロアデータをディスクから再読込した = 新しいプレビューセッションとして扱う */
    resetAllVisited();
    resetAllEnemies();
    state.current = state.floors.find((floor) => floor.id === previousFloorId) || state.floors[0] || blankFloor(1);
    state.assetEditorSetId = assetSetById(state.current.asset_set_id)
      ? state.current.asset_set_id
      : (firstAssetSet()?.id || '');
    clearTextureCache();
    state.textures = null;
    state.assetTextures = null;
    invalidateViewModel();
    syncForm();
    await Promise.all([loadTexturesForCurrent(), loadTexturesForAssetEditor()]);
    state.exportInfo = null;
    setDirty(false);
    captureCommittedState();
    setStatus(`${state.floors.length} floor`);
    return true;
  }

  async function saveCurrent() {
    if (!state.current) return false;
    readFormIntoCurrent();
    const floor = cloneData(state.current);
    delete floor.assets;
    const result = await api.plugins.invokeHook(plugin.id, 'saveDungeonState', {
      floor,
      settings: cloneData(state.settings),
    });
    if (!result?.ok) {
      setStatus(result?.error || '保存に失敗しました');
      return false;
    }
    state.settings = normalizeSettingsForUi(result.settings || state.settings);
    if (Array.isArray(result.floors)) {
      state.floors = result.floors.map(normalizeFloorForUi);
    }
    const savedFloor = normalizeFloorForUi(result.floor || floor);
    const index = state.floors.findIndex((entry) => entry.id === savedFloor.id);
    if (index >= 0) state.floors[index] = savedFloor;
    else state.floors.push(savedFloor);
    state.current = state.floors.find((entry) => entry.id === savedFloor.id) || savedFloor;
    if (!assetSetById(state.assetEditorSetId)) state.assetEditorSetId = state.current.asset_set_id || firstAssetSet()?.id || '';
    setDirty(false);
    state.exportInfo = result.export || state.exportInfo;
    captureCommittedState();
    setStatus('保存しました');
    syncForm();
    void Promise.all([loadTexturesForCurrent(), loadTexturesForAssetEditor()]);
    return true;
  }

  async function createFloor() {
    if (!await guardUnsaved('新しいフロアを作成する')) return;
    const floor = blankFloor(state.floors.length + 1);
    const result = await api.plugins.invokeHook(plugin.id, 'saveDungeonState', {
      create: true,
      floor,
      settings: cloneData(state.settings),
    });
    if (!result?.ok) {
      setStatus(result?.error || 'フロア作成に失敗しました');
      return;
    }
    await refresh({ preferredFloorId: result.floor?.id || '' });
  }

  async function deleteFloor() {
    if (!await guardUnsaved('フロアを削除する')) return;
    if (!state.current?.id) return;
    const result = await api.plugins.invokeHook(plugin.id, 'deleteDungeonFloor', { id: state.current.id });
    if (result?.ok) await refresh();
    else setStatus(result?.error || '削除に失敗しました');
  }

  async function moveFloor(direction) {
    if (!await guardUnsaved('フロア順を変更する')) return;
    if (!state.current?.id) return;
    const id = state.current.id;
    const result = await api.plugins.invokeHook(plugin.id, 'moveDungeonFloor', { id: state.current.id, direction });
    if (result?.ok) await refresh({ preferredFloorId: id });
  }

  async function generateFloor() {
    if (!await guardUnsaved('ランダムフロアを作成する')) return;
    const width = Number(ui.width.value || state.current?.width || 12);
    const height = Number(ui.height.value || state.current?.height || 12);
    const result = await api.plugins.invokeHook(plugin.id, 'generateDungeonFloor', {
      width,
      height,
      name: ui.name.value || undefined,
      asset_set_id: state.current?.asset_set_id || firstAssetSet()?.id || '',
    });
    if (!result?.ok) {
      setStatus(result?.error || '生成に失敗しました');
      return;
    }
    await refresh({ preferredFloorId: result.floor?.id || '' });
  }

  async function exportAssets() {
    if (state.dirty && !await saveCurrent()) return;
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
    if (tab === 'assets') void loadTexturesForAssetEditor();
  }

  function observePageActivation() {
    state.activationObserver = new MutationObserver(() => {
      const active = root.classList.contains('active');
      if (active && !state.wasActive) void refresh({ guard: true });
      state.wasActive = active;
    });
    state.activationObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  root.addEventListener('click', (event) => {
    const actionTarget = event.target?.closest?.('[data-action]');
    const tabTarget = event.target?.closest?.('[data-tab]');
    const toolTarget = event.target?.closest?.('[data-tool]');
    const previewTarget = event.target?.closest?.('[data-preview]');
    const setTarget = event.target?.closest?.('[data-set-select]');
    const action = actionTarget?.dataset?.action;
    const tab = tabTarget?.dataset?.tab;
    const tool = toolTarget?.dataset?.tool;
    const preview = previewTarget?.dataset?.preview;
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
    if (action === 'set-new') void createAssetSet();
    if (action === 'set-duplicate') void createAssetSet({ duplicate: true });
    if (action === 'set-rename') void renameAssetSet();
    if (action === 'set-delete') deleteAssetSet();
    if (action === 'asset-import') void importAssetForSet(actionTarget.dataset.assetKey);
    if (action === 'asset-default') resetAssetToDefault(actionTarget.dataset.assetKey);
    if (action === 'asset-model-gen') void openEnemyModelGenerator();
    if (action === 'settings-save') void saveSettingsForm();
    if (action === 'minimap-mode') {
      state.minimapMode = state.minimapMode === 'full' ? 'visited' : 'full';
      renderPreview();
    }
    if (setTarget?.dataset?.setSelect) void selectAssetEditorSet(setTarget.dataset.setSelect);
  });
  ui.map.addEventListener('click', handleMapClick);
  ui.floorSelect.addEventListener('change', async () => {
    const requestedId = ui.floorSelect.value;
    const previousId = state.current?.id || '';
    ui.floorSelect.value = previousId;
    if (!await guardUnsaved('別のフロアへ切り替える')) return;
    state.current = state.floors.find((floor) => floor.id === requestedId) || state.floors[0] || null;
    if (!state.current) return;
    state.assetEditorSetId = assetSetById(state.current.asset_set_id)
      ? state.current.asset_set_id
      : (firstAssetSet()?.id || '');
    state.textures = null;
    state.assetTextures = null;
    invalidateViewModel();
    syncForm();
    void Promise.all([loadTexturesForCurrent(), loadTexturesForAssetEditor()]);
  });
  ui.floorAssetSet.addEventListener('change', () => {
    if (!state.current) return;
    state.current.asset_set_id = ui.floorAssetSet.value;
    delete state.current.assets;
    state.assetEditorSetId = state.current.asset_set_id;
    clearTextureCache();
    state.textures = null;
    state.assetTextures = null;
    invalidateViewModel();
    setDirty(true);
    setStatus(`素材セットを「${assetSetById(state.current.asset_set_id)?.name || state.current.asset_set_id}」へ変更しました`);
    renderAll();
    void Promise.all([loadTexturesForCurrent(), loadTexturesForAssetEditor()]);
  });
  [ui.name, ui.width, ui.height, ui.enemyStep].forEach((input) => input.addEventListener('input', () => {
    readFormIntoCurrent();
    setDirty(true);
    renderAll();
  }));
  root.addEventListener('keydown', (event) => {
    if (event.target?.matches?.('input, select, textarea, button')) return;
    if (event.key === 'ArrowUp') movePreview('forward');
    if (event.key === 'ArrowDown') movePreview('back');
    if (event.key === 'ArrowLeft') movePreview('turn-left');
    if (event.key === 'ArrowRight') movePreview('turn-right');
  });

  registerCapability('dungeon-game-editor', { root, refresh: () => refresh({ guard: true }) });
  observePageActivation();
  startEnemyLoop();
  void refresh({ guard: false });

  return {
    deactivate() {
      cancelAnimationFrame(state.animationFrame);
      state.activationObserver?.disconnect?.();
      stopEnemyLoop();
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
