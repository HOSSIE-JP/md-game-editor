const GRID_ROWS = 24;
const GRID_COLS = 15;
const CANVAS_W = 320;
const CANVAS_H = 224;
const FIELD_W = 240;
const BLOCK_W = 16;
const BLOCK_H = 8;

const BLOCKS = [
  { id: 0, label: 'X', name: '消しゴム', color: 'transparent' },
  { id: 1, label: 'W', name: '白', color: '#f8f8f8' },
  { id: 2, label: 'Y', name: '黄', color: '#ffd33d' },
  { id: 3, label: 'G', name: '緑', color: '#35c759' },
  { id: 4, label: 'B', name: '青', color: '#438cff' },
  { id: 5, label: '#', name: 'グレー', color: '#8a8f98' },
];
const POWERUPS = [
  { id: '', label: '-', name: 'なし' },
  { id: 'multi_ball', label: 'M', name: 'マルチボール' },
  { id: 'strong', label: 'S', name: 'ストロング' },
  { id: 'speed_up', label: 'U', name: 'スピードアップ' },
  { id: 'barrier', label: '=', name: 'バリア' },
];
const POWERUP_BORDER_COLORS = {
  multi_ball: '#0b7a32',
  strong: '#ff4d4f',
  speed_up: '#438cff',
  barrier: '#000000',
};
const SE_ROLES = [
  { id: 'ball_hit_paddle', label: 'ボールがパドルにあたる', required: true },
  { id: 'ball_hit_wall', label: 'ボールが壁に当たる', required: true },
  { id: 'block_break', label: 'ブロック破壊', required: true },
  { id: 'block_hit', label: 'ブロックにヒット', required: true },
  { id: 'powerup_appear', label: 'パワーアップ出現', required: false },
  { id: 'powerup_get', label: 'パワーアップ取得', required: false },
  { id: 'ball_lose', label: 'ボール落下（ミス）', required: false },
  { id: 'game_over', label: 'ゲームオーバー', required: false },
  { id: 'stage_clear', label: 'ステージクリア', required: false },
  { id: 'bonus_count', label: 'ボーナス得点加算', required: false },
  { id: 'game_start', label: 'ゲーム開始', required: false },
  { id: 'pause', label: 'ポーズ', required: false },
];
const SPRITE_ROLES = [
  { id: 'ball', label: 'ボール', required: true, width: 8, height: 8, palette: 'PAL1' },
  { id: 'paddle', label: 'パドル', required: true, width: 32, height: 8, palette: 'PAL1' },
  { id: 'powerup_multi_ball', label: 'パワーアップ：マルチボール', required: true, width: 16, height: 8, palette: 'PAL1' },
  { id: 'powerup_strong', label: 'パワーアップ：ストロング', required: true, width: 16, height: 8, palette: 'PAL1' },
  { id: 'powerup_speed_up', label: 'パワーアップ：スピードアップ', required: true, width: 16, height: 8, palette: 'PAL1' },
  { id: 'powerup_barrier', label: 'パワーアップ：バリア', required: true, width: 16, height: 8, palette: 'PAL1' },
  { id: 'block_white', label: 'ブロック：白', required: true, width: 16, height: 8, palette: 'PAL2' },
  { id: 'block_yellow', label: 'ブロック：黄', required: true, width: 16, height: 8, palette: 'PAL2' },
  { id: 'block_green', label: 'ブロック：緑', required: true, width: 16, height: 8, palette: 'PAL2' },
  { id: 'block_blue', label: 'ブロック：青', required: true, width: 16, height: 8, palette: 'PAL2' },
  { id: 'block_gray', label: 'ブロック：グレー', required: true, width: 16, height: 8, palette: 'PAL2' },
];
const SYSTEM_IMAGE_ROLES = [
  { id: 'logo_screen_1', label: 'ロゴ画面1', required: false, width: 320, height: 224, palette: 'PAL3' },
  { id: 'logo_screen_2', label: 'ロゴ画面2', required: false, width: 320, height: 224, palette: 'PAL3' },
  { id: 'title_screen', label: 'タイトル画面', required: false, width: 320, height: 224, palette: 'PAL3' },
  { id: 'game_over_screen', label: 'ゲームオーバー画面', required: false, width: 320, height: 224, palette: 'PAL3' },
  { id: 'high_score_screen', label: 'ハイスコア画面', required: false, width: 320, height: 224, palette: 'PAL3' },
  { id: 'game_clear_screen', label: 'ゲームクリア画面', required: false, width: 320, height: 224, palette: 'PAL3' },
];
export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const state = {
    activeTab: 'stage',
    activeAssetTab: 'images',
    stages: [],
    resources: { images: [], stageImages: [], bgms: [], sprites: [], ses: [], tilesets: [], palettes: [], all: [] },
    settings: defaultSettings(),
    current: null,
    dirty: false,
    settingsDirty: false,
    selectedBlock: 1,
    selectedPowerUp: '',
    backgroundImage: null,
    showStageBackground: true,
    audio: null,
    activationObserver: null,
    wasActive: root.classList.contains('active'),
  };

  root.innerHTML = `
    <div class="block-stage-editor-root">
    <div class="bse-top-tabs">
      <button class="active" data-tab="stage">ステージ編集</button>
      <button data-tab="assets">アセット設定</button>
      <button data-tab="settings">ゲーム設定</button>
      <span class="bse-status"></span>
      <span class="bse-dirty"></span>
      <button class="bse-save bse-top-save" data-action="save-all">保存</button>
    </div>
    <section class="bse-tab-panel active" data-panel="stage">
      <div class="bse-shell">
        <aside class="bse-left">
          <div class="bse-row bse-stage-row">
            <select class="bse-stage-select" title="ステージ選択"></select>
            <button class="bse-icon" data-action="new" title="新規">+</button>
            <button class="bse-icon danger" data-action="delete" title="削除">-</button>
            <button class="bse-icon" data-action="move-up" title="前へ移動">↑</button>
            <button class="bse-icon" data-action="move-down" title="次へ移動">↓</button>
          </div>
          <label class="bse-field">ステージ名<input class="bse-stage-name" type="text"></label>
          <label class="bse-field">BGM<div class="bse-row"><select class="bse-bgm-select"></select><button class="bse-icon" data-action="preview-bgm" title="プレビュー">▶</button></div></label>
          <label class="bse-toggle"><input class="bse-bg-visible" type="checkbox" checked>背景表示</label>
          <label class="bse-field">背景画像<select class="bse-bg-select"></select><span class="bse-stage-thumb bse-bg-thumb">-</span></label>
          <label class="bse-field">クリア画像<select class="bse-clear-select"></select><span class="bse-stage-thumb bse-clear-thumb">-</span></label>
        </aside>
        <main class="bse-center"><canvas class="bse-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas></main>
        <aside class="bse-right">
          <div class="bse-palette-title">ブロック</div>
          <div class="bse-block-palette"></div>
          <div class="bse-palette-title">パワーアップ</div>
          <div class="bse-power-palette"></div>
        </aside>
      </div>
    </section>
    <section class="bse-tab-panel" data-panel="assets">
      <div class="bse-assets">
        <div class="bse-nested-tabs">
          <button class="active" data-asset-tab="images">システム背景</button>
          <button data-asset-tab="stage-images">ステージ背景</button>
          <button data-asset-tab="sprites">スプライト</button>
          <button data-asset-tab="se">効果音</button>
          <button data-asset-tab="bgms">BGM</button>
        </div>
        <div class="bse-asset-table-wrap"></div>
      </div>
    </section>
    <section class="bse-tab-panel" data-panel="settings">
      <div class="bse-settings-panel">
        <label class="bse-range">ボール速度<input data-setting="ball_speed" type="range" min="1" max="5" step="1"><output></output></label>
        <label class="bse-range">パドル速度<input data-setting="paddle_speed" type="range" min="1" max="5" step="1"><output></output></label>
        <label class="bse-range">初期残機数<input data-setting="initial_lives" type="range" min="1" max="99" step="1"><output></output></label>
        <label class="bse-range">BGMボリューム<input data-setting="bgm_volume" type="range" min="0" max="100" step="5"><output></output></label>
        <div class="bse-settings-group">
          <label class="bse-field">タイトル画面BGM<select class="bse-screen-bgm-select" data-screen-bgm="title_screen"></select></label>
          <label class="bse-field">ゲームクリア画面BGM<select class="bse-screen-bgm-select" data-screen-bgm="game_clear_screen"></select></label>
          <label class="bse-field">ハイスコア画面BGM<select class="bse-screen-bgm-select" data-screen-bgm="high_score_screen"></select></label>
        </div>
        <label class="bse-field bse-font-field">システムフォント
          <div class="bse-row">
            <select class="bse-font-select"></select>
            <button class="bse-icon" data-action="import-font" title="登録">+</button>
          </div>
          <span class="bse-stage-thumb bse-font-thumb">-</span>
          <span class="bse-font-palette-row">
            <span class="bse-palette-badge">PAL0</span>
            <span class="bse-font-palette-label">システムパレット(PAL0)</span>
            <span class="bse-palette-strip bse-font-palette" title="システムパレット(PAL0)">Palette -</span>
          </span>
        </label>
      </div>
    </section>
    <div class="bse-preview" hidden><div class="bse-preview-panel"><button class="bse-icon bse-preview-close" title="閉じる">x</button><div class="bse-preview-body"></div></div></div>
    </div>
  `;

  const ui = {
    status: root.querySelector('.bse-status'),
    topTabs: Array.from(root.querySelectorAll('[data-tab]')),
    panels: Array.from(root.querySelectorAll('[data-panel]')),
    assetTabs: Array.from(root.querySelectorAll('[data-asset-tab]')),
    assetWrap: root.querySelector('.bse-asset-table-wrap'),
    stageSelect: root.querySelector('.bse-stage-select'),
    moveUp: root.querySelector('[data-action="move-up"]'),
    moveDown: root.querySelector('[data-action="move-down"]'),
    stageName: root.querySelector('.bse-stage-name'),
    bgSelect: root.querySelector('.bse-bg-select'),
    bgmSelect: root.querySelector('.bse-bgm-select'),
    bgVisible: root.querySelector('.bse-bg-visible'),
    clearSelect: root.querySelector('.bse-clear-select'),
    bgThumb: root.querySelector('.bse-bg-thumb'),
    clearThumb: root.querySelector('.bse-clear-thumb'),
    fontSelect: root.querySelector('.bse-font-select'),
    screenBgmSelects: Array.from(root.querySelectorAll('[data-screen-bgm]')),
    fontThumb: root.querySelector('.bse-font-thumb'),
    fontPalette: root.querySelector('.bse-font-palette'),
    dirty: root.querySelector('.bse-dirty'),
    canvas: root.querySelector('.bse-canvas'),
    blockPalette: root.querySelector('.bse-block-palette'),
    powerPalette: root.querySelector('.bse-power-palette'),
    preview: root.querySelector('.bse-preview'),
    previewBody: root.querySelector('.bse-preview-body'),
    settingInputs: Array.from(root.querySelectorAll('[data-setting]')),
  };
  const ctx = ui.canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function defaultSettings() {
    return {
      se_bindings: {},
      sprite_bindings: {},
      image_usage_bindings: {},
      game_settings: {
        ball_speed: 2,
        paddle_speed: 3,
        initial_lives: 3,
        bgm_volume: 100,
        system_font_symbol: '',
        screen_wait_seconds: {},
        screen_bgm_symbols: {},
      },
    };
  }

  function blankStage(order = 1, name = `Stage ${order}`) {
    return {
      id: '',
      name,
      order,
      bgm_symbol: '',
      background_image_symbol: '',
      clear_image_symbol: '',
      blocks: Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0)),
      power_ups: {},
    };
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    updateDirtyIndicator();
  }

  function setSettingsDirty(value) {
    state.settingsDirty = Boolean(value);
    updateDirtyIndicator();
  }

  function updateDirtyIndicator() {
    ui.dirty.textContent = state.dirty || state.settingsDirty ? '未保存' : '';
  }

  function setStatus(text) {
    ui.status.textContent = text || '';
  }

  function isStageImageResource(entry) {
    const sourcePath = String(entry?.sourcePath || '').replace(/\\/g, '/').toLowerCase();
    return sourcePath.startsWith('stage/');
  }

  function normalizeResourceBuckets(resources) {
    const next = {
      images: [],
      stageImages: [],
      bgms: [],
      sprites: [],
      ses: [],
      tilesets: [],
      palettes: [],
      all: [],
      ...(resources || {}),
    };
    const images = Array.isArray(next.images) ? next.images : [];
    next.stageImages = images.filter(isStageImageResource);
    return next;
  }

  function systemImageResources() {
    return (state.resources.images || []).filter((entry) => !isStageImageResource(entry));
  }

  function selectedAsset(kind, symbol) {
    const direct = (state.resources[kind] || []).find((asset) => asset.name === symbol);
    if (direct) return direct;
    if (kind === 'stageImages') {
      return (state.resources.images || []).find((asset) => asset.name === symbol) || null;
    }
    return null;
  }

  function renderSelect(select, entries, emptyLabel) {
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel;
    select.appendChild(empty);
    entries.forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.name;
      opt.textContent = entry.name;
      select.appendChild(opt);
    });
  }

  function syncTopTabs() {
    ui.topTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
    ui.panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === state.activeTab));
  }

  function syncAssetTabs() {
    ui.assetTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.assetTab === state.activeAssetTab));
  }

  async function loadImageForSymbol(symbol) {
    state.backgroundImage = null;
    const asset = selectedAsset('stageImages', symbol);
    if (!asset?.sourceAbsolutePath) {
      draw();
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) {
      draw();
      return;
    }
    const img = new Image();
    img.onload = () => {
      state.backgroundImage = img;
      draw();
    };
    img.src = read.dataUrl;
  }

  async function updateStageImageThumb(element, symbol) {
    if (!element) return;
    element.textContent = '-';
    element.style.backgroundImage = '';
    const asset = selectedAsset('stageImages', symbol);
    if (!asset?.sourceAbsolutePath) return;
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) return;
    element.textContent = '';
    element.style.backgroundImage = `url("${read.dataUrl}")`;
  }

  function updateStageThumbs() {
    void updateStageImageThumb(ui.bgThumb, ui.bgSelect.value);
    void updateStageImageThumb(ui.clearThumb, ui.clearSelect.value);
  }

  function syncFormFromStage() {
    const stage = state.current;
    ui.stageName.value = stage?.name || '';
    ui.bgSelect.value = stage?.background_image_symbol || '';
    ui.bgmSelect.value = stage?.bgm_symbol || '';
    ui.clearSelect.value = stage?.clear_image_symbol || '';
    updateStageThumbs();
  }

  function readFormIntoStage() {
    if (!state.current) return;
    state.current.name = ui.stageName.value.trim() || `Stage ${state.current.order || 1}`;
    state.current.background_image_symbol = ui.bgSelect.value;
    state.current.bgm_symbol = ui.bgmSelect.value;
    state.current.clear_image_symbol = ui.clearSelect.value;
  }

  function applyBackgroundSelection() {
    if (ui.bgSelect.value && !ui.clearSelect.value) {
      ui.clearSelect.value = ui.bgSelect.value;
    }
    readFormIntoStage();
    void loadImageForSymbol(ui.bgSelect.value);
    updateStageThumbs();
  }

  function setCurrentStage(stage) {
    state.current = JSON.parse(JSON.stringify(stage || blankStage(state.stages.length + 1)));
    syncFormFromStage();
    setDirty(false);
    updateMoveStageButtons();
    void loadImageForSymbol(state.current.background_image_symbol);
    draw();
  }

  function renderStageOptions() {
    ui.stageSelect.innerHTML = '';
    state.stages.forEach((stage) => {
      const opt = document.createElement('option');
      opt.value = stage.id;
      opt.textContent = `${stage.order}. ${stage.name}`;
      ui.stageSelect.appendChild(opt);
    });
    if (state.current?.id) ui.stageSelect.value = state.current.id;
    updateMoveStageButtons();
  }

  function updateMoveStageButtons() {
    const index = state.stages.findIndex((stage) => stage.id === state.current?.id);
    const hasSelection = index >= 0;
    ui.moveUp.disabled = !hasSelection || index === 0;
    ui.moveDown.disabled = !hasSelection || index === state.stages.length - 1;
  }

  function renderPalettes() {
    ui.blockPalette.innerHTML = '';
    BLOCKS.forEach((block) => {
      const btn = document.createElement('button');
      btn.className = `bse-swatch${state.selectedBlock === block.id ? ' active' : ''}`;
      btn.title = block.name;
      btn.textContent = block.label;
      btn.style.setProperty('--swatch-color', block.color);
      btn.addEventListener('click', () => {
        state.selectedBlock = block.id;
        renderPalettes();
      });
      ui.blockPalette.appendChild(btn);
    });

    ui.powerPalette.innerHTML = '';
    POWERUPS.forEach((power) => {
      const btn = document.createElement('button');
      btn.className = `bse-power${state.selectedPowerUp === power.id ? ' active' : ''}`;
      btn.title = power.name;
      btn.textContent = power.label;
      btn.addEventListener('click', () => {
        state.selectedPowerUp = power.id;
        renderPalettes();
      });
      ui.powerPalette.appendChild(btn);
    });
  }

  async function refresh() {
    const [stageResult, settingsResult] = await Promise.all([
      api.plugins.invokeHook(plugin.id, 'listStages', {}),
      api.plugins.invokeHook(plugin.id, 'listBlockSettings', {}),
    ]);
    if (!stageResult?.ok) {
      logger.error(stageResult?.error || 'ステージ一覧の取得に失敗しました');
      return;
    }
    if (!settingsResult?.ok) {
      logger.error(settingsResult?.error || '設定の取得に失敗しました');
      return;
    }

    state.stages = stageResult.stages || [];
    state.resources = normalizeResourceBuckets(settingsResult.resources || stageResult.resources || {});
    await refreshResourcesFromResFile();
    state.settings = settingsResult.settings || defaultSettings();
    renderSelect(ui.bgSelect, state.resources.stageImages || [], '(なし)');
    renderSelect(ui.clearSelect, state.resources.stageImages || [], '(なし)');
    renderSelect(ui.bgmSelect, state.resources.bgms || [], '(なし)');
    renderSelect(ui.fontSelect, state.resources.tilesets || [], '(デフォルト)');
    ui.screenBgmSelects.forEach((select) => renderSelect(select, state.resources.bgms || [], '(なし)'));
    renderStageOptions();
    if (!state.current && state.stages.length) setCurrentStage(state.stages[0]);
    if (!state.current) setCurrentStage(blankStage(1));
    syncFormFromStage();
    renderAssetSettings();
    syncSettingsForm();
  }

  async function saveCurrent() {
    readFormIntoStage();
    const result = await api.plugins.invokeHook(plugin.id, 'saveStage', { stage: state.current });
    if (!result?.ok) {
      logger.error(result?.error || 'ステージ保存に失敗しました');
      return false;
    }
    state.current = result.stage;
    setDirty(false);
    await refresh();
    ui.stageSelect.value = state.current.id;
    setStatus(`保存しました: ${state.current.name}`);
    return true;
  }

  async function createStage() {
    const result = await api.plugins.invokeHook(plugin.id, 'saveStage', { create: true, stage: {} });
    if (!result?.ok) {
      logger.error(result?.error || 'ステージ作成に失敗しました');
      return;
    }
    await refresh();
    setCurrentStage(result.stage);
    renderStageOptions();
  }

  async function deleteStage() {
    if (!state.current?.id) return;
    const result = await api.plugins.invokeHook(plugin.id, 'deleteStage', { id: state.current.id });
    if (!result?.ok) {
      logger.error(result?.error || 'ステージ削除に失敗しました');
      return;
    }
    state.current = null;
    await refresh();
    setCurrentStage(state.stages[0] || blankStage(1));
  }

  async function moveStage(direction) {
    if (!state.current?.id) return;
    if (state.dirty && !(await saveCurrent())) return;
    const id = state.current?.id;
    if (!id) return;
    const result = await api.plugins.invokeHook(plugin.id, 'moveStage', { id, direction });
    if (!result?.ok) {
      logger.error(result?.error || 'ステージの並び替えに失敗しました');
      return;
    }
    await refresh();
    setCurrentStage(result.stage || state.stages.find((stage) => stage.id === id) || state.stages[0] || blankStage(1));
    renderStageOptions();
    setStatus(result.moved ? `並び替えました: ${state.current.name}` : 'これ以上移動できません');
  }

  function syncSettingsForm() {
    const values = state.settings.game_settings || defaultSettings().game_settings;
    ui.settingInputs.forEach((input) => {
      input.value = String(values[input.dataset.setting] ?? input.min);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = input.dataset.setting === 'bgm_volume' ? `${input.value}%` : input.value;
    });
    ui.fontSelect.value = values.system_font_symbol || '';
    ui.screenBgmSelects.forEach((select) => {
      select.value = values.screen_bgm_symbols?.[select.dataset.screenBgm] || '';
    });
    updateSystemFontPreview();
    setSettingsDirty(false);
  }

  function readSettingsForm() {
    const next = { ...state.settings, game_settings: { ...(state.settings.game_settings || {}) } };
    ui.settingInputs.forEach((input) => {
      next.game_settings[input.dataset.setting] = Number(input.value);
    });
    next.game_settings.system_font_symbol = ui.fontSelect.value || '';
    next.game_settings.screen_wait_seconds = {
      ...((state.settings.game_settings || {}).screen_wait_seconds || {}),
    };
    next.game_settings.screen_bgm_symbols = {
      ...((state.settings.game_settings || {}).screen_bgm_symbols || {}),
    };
    ui.screenBgmSelects.forEach((select) => {
      next.game_settings.screen_bgm_symbols[select.dataset.screenBgm] = select.value || '';
    });
    return next;
  }

  async function saveSettings() {
    const result = await api.plugins.invokeHook(plugin.id, 'saveBlockSettings', { settings: readSettingsForm() });
    if (!result?.ok) {
      logger.error(result?.error || '設定保存に失敗しました');
      return;
    }
    state.settings = result.settings;
    syncSettingsForm();
    renderAssetSettings();
    setStatus('ゲーム設定を保存しました');
  }

  async function saveSettingsState(settings, statusText = 'ゲーム設定を保存しました') {
    const result = await api.plugins.invokeHook(plugin.id, 'saveBlockSettings', { settings });
    if (!result?.ok) {
      logger.error(result?.error || '設定保存に失敗しました');
      return false;
    }
    state.settings = result.settings;
    syncSettingsForm();
    renderAssetSettings();
    setStatus(statusText);
    return true;
  }

  async function saveAll() {
    const saved = [];
    if (state.settingsDirty) {
      await saveSettings();
      saved.push('ゲーム設定');
    }
    if (state.dirty) {
      await saveCurrent();
      saved.push('ステージ');
    }
    if (saved.length === 0) {
      setStatus('保存する変更はありません');
      return;
    }
    setStatus(`保存しました: ${saved.join(' / ')}`);
  }

  async function saveAssetBinding(kind, roleId, symbol) {
    const validation = await validateAssetSelection(kind, roleId, symbol);
    if (!validation.ok) {
      setStatus(validation.error);
      renderAssetSettings();
      return false;
    }
    const settings = JSON.parse(JSON.stringify(state.settings || defaultSettings()));
    const key = kind === 'se' ? 'se_bindings' : kind === 'sprites' ? 'sprite_bindings' : 'image_usage_bindings';
    settings[key] = settings[key] || {};
    if (symbol) settings[key][roleId] = symbol;
    else delete settings[key][roleId];
    const result = await api.plugins.invokeHook(plugin.id, 'saveBlockSettings', { settings });
    if (!result?.ok) {
      logger.error(result?.error || 'アセット設定の保存に失敗しました');
      return;
    }
    state.settings = result.settings;
    renderAssetSettings();
    setStatus('アセット設定を保存しました');
    return true;
  }

  async function refreshSettingsState() {
    const result = await api.plugins.invokeHook(plugin.id, 'listBlockSettings', {});
    if (!result?.ok) return false;
    state.resources = normalizeResourceBuckets(result.resources || state.resources);
    state.settings = result.settings || state.settings;
    return true;
  }

  async function waitForResourceSymbol(kind, symbol, attempts = 120) {
    const resourceKind = kind === 'se' ? 'ses' : kind;
    for (let index = 0; index < attempts; index += 1) {
      await refreshSettingsState();
      if ((state.resources[resourceKind] || []).some((entry) => entry.name === symbol)) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return false;
  }

  function entryForAssetTab() {
    if (state.activeAssetTab === 'bgms') {
      return { roles: [], key: '', kind: 'bgms', resources: state.resources.bgms || [] };
    }
    if (state.activeAssetTab === 'stage-images') {
      return { roles: [], key: '', kind: 'stage-images', resources: state.resources.stageImages || [] };
    }
    if (state.activeAssetTab === 'se') {
      return { roles: SE_ROLES, key: 'se_bindings', kind: 'se', resources: state.resources.ses || [] };
    }
    if (state.activeAssetTab === 'sprites') {
      return { roles: SPRITE_ROLES, key: 'sprite_bindings', kind: 'sprites', resources: state.resources.sprites || [] };
    }
    return { roles: SYSTEM_IMAGE_ROLES, key: 'image_usage_bindings', kind: 'images', resources: systemImageResources() };
  }

  function renderAssetSettings() {
    syncAssetTabs();
    const { roles, key, kind, resources } = entryForAssetTab();
    if (kind === 'bgms') {
      renderBgmAssets(resources);
      return;
    }
    if (kind === 'stage-images') {
      renderStageImageAssets(resources);
      return;
    }
    const bindings = state.settings[key] || {};
    const rows = roles.map((role) => {
      const symbol = bindings[role.id] || '';
      const asset = resources.find((entry) => entry.name === symbol);
      const size = kind === 'se' ? audioDurationMarkup(asset) : (role.width ? `${role.width}x${role.height}` : '-');
      return `
        <tr data-role="${role.id}" data-kind="${kind}">
          <td class="bse-preview-cell">${previewMarkup(kind, asset)}</td>
          <td>${contentMarkup(kind, role, asset)}</td>
          <td><span class="bse-tag ${role.required ? 'required' : 'optional'}">${role.required ? '必須' : '任意'}</span></td>
          <td>${size}</td>
          <td><select class="bse-binding-select">${optionsMarkup(resources, symbol)}</select></td>
          <td><button class="bse-icon" data-action="import-asset" title="登録">+</button></td>
        </tr>
      `;
    }).join('');
    ui.assetWrap.innerHTML = `
      <table class="bse-asset-table">
        <thead><tr><th>プレビュー</th><th>内容</th><th>要求</th><th>サイズ</th><th>アセット設定</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    hydratePreviewCells(ui.assetWrap);
  }

  function renderBgmAssets(resources) {
    const wavs = (resources || []).filter((entry) => String(entry.type || '').toUpperCase() === 'WAV');
    const rows = wavs.map((asset) => `
      <tr data-kind="bgms" data-symbol="${escapeHtml(asset.name)}">
        <td class="bse-preview-cell">${previewMarkup('bgms', asset)}</td>
        <td><div class="bse-content-cell"><div class="bse-content-label">${escapeHtml(asset.name)}</div></div></td>
        <td><span class="bse-tag optional">任意</span></td>
        <td>${audioDurationMarkup(asset)}</td>
        <td>XGM2 / 6650 Hz</td>
        <td><button class="bse-icon danger" data-action="delete-bgm" data-symbol="${escapeHtml(asset.name)}" title="削除">-</button></td>
      </tr>
    `).join('');
    ui.assetWrap.innerHTML = `
      <div class="bse-asset-toolbar"><button class="bse-icon" data-action="import-bgm" title="BGM登録">+</button></div>
      <table class="bse-asset-table">
        <thead><tr><th>プレビュー</th><th>アセット設定</th><th>要求</th><th>再生長</th><th>形式</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="bse-empty-row">BGM WAV は未登録です</td></tr>'}</tbody>
      </table>
    `;
    hydratePreviewCells(ui.assetWrap);
  }

  function renderStageImageAssets(resources) {
    const rows = (resources || []).map((asset) => `
      <tr data-kind="stage-images" data-symbol="${escapeHtml(asset.name)}">
        <td class="bse-preview-cell">${previewMarkup('stage-images', asset)}</td>
        <td>${contentMarkup('stage-images', { label: asset.name, required: false, palette: 'PAL3' }, asset)}</td>
        <td><span class="bse-tag optional">任意</span></td>
        <td>320x224</td>
        <td>IMAGE / PAL3</td>
        <td><button class="bse-icon danger" data-action="delete-stage-image" data-symbol="${escapeHtml(asset.name)}" title="削除">-</button></td>
      </tr>
    `).join('');
    ui.assetWrap.innerHTML = `
      <div class="bse-asset-toolbar"><button class="bse-icon" data-action="import-stage-image" title="ステージ背景登録">+</button></div>
      <table class="bse-asset-table">
        <thead><tr><th>プレビュー</th><th>アセット設定</th><th>要求</th><th>サイズ</th><th>形式</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="bse-empty-row">ステージ背景画像は未登録です</td></tr>'}</tbody>
      </table>
    `;
    hydratePreviewCells(ui.assetWrap);
  }

  function contentMarkup(kind, role, asset) {
    const palette = kind === 'se' || !asset?.sourceAbsolutePath
      ? ''
      : `<div class="bse-palette-strip" data-palette-source="${escapeHtml(asset.sourceAbsolutePath)}" title="使用パレット"></div>`;
    const wait = kind === 'images'
      ? `<label class="bse-screen-wait">待機<input data-screen-wait-inline="${escapeHtml(role.id)}" type="number" min="0" max="999" step="1" value="${screenWaitValue(role.id)}">秒</label>`
      : '';
    const paletteBadge = role.palette ? `<span class="bse-palette-badge">${escapeHtml(role.palette)}</span>` : '';
    return `<div class="bse-content-cell"><div class="bse-content-label">${escapeHtml(role.label)}${paletteBadge}</div>${palette}${wait}</div>`;
  }

  function screenWaitValue(roleId) {
    const waits = (state.settings.game_settings || {}).screen_wait_seconds || {};
    const value = Number(waits[roleId]);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(999, Math.floor(value));
  }

  function updateScreenWait(roleId, value) {
    const next = { ...(state.settings || defaultSettings()) };
    next.game_settings = { ...(next.game_settings || defaultSettings().game_settings) };
    next.game_settings.screen_wait_seconds = { ...(next.game_settings.screen_wait_seconds || {}) };
    next.game_settings.screen_wait_seconds[roleId] = Math.min(999, Math.max(0, Math.floor(Number(value) || 0)));
    state.settings = next;
    setSettingsDirty(true);
  }

  function audioDurationMarkup(asset) {
    if (!asset?.sourceAbsolutePath) return '-';
    return `<span class="bse-audio-duration" data-audio-source="${escapeHtml(asset.sourceAbsolutePath)}">...</span>`;
  }

  function optionsMarkup(resources, selected) {
    const options = ['<option value="">(未設定)</option>'];
    resources.forEach((entry) => {
      options.push(`<option value="${escapeHtml(entry.name)}"${entry.name === selected ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`);
    });
    return options.join('');
  }

  function previewMarkup(kind, asset) {
    if (!asset) {
      return kind === 'se' || kind === 'bgms'
        ? '<span class="bse-empty-audio-preview">-</span>'
        : '<span class="bse-empty-preview">-</span>';
    }
    if (kind === 'se' || kind === 'bgms') {
      return `<button class="bse-icon bse-audio-preview" data-action="preview-row-audio" data-symbol="${escapeHtml(asset.name)}" data-source="${escapeHtml(asset.sourceAbsolutePath || '')}" title="再生">▶</button>`;
    }
    return `<div class="bse-thumb" data-source="${escapeHtml(asset.sourceAbsolutePath || '')}" data-alt="${escapeHtml(asset.name)}"></div>`;
  }

  async function hydratePreviewCells(scope) {
    const dataUrlCache = new Map();
    const readDataUrl = async (source) => {
      if (!source) return '';
      if (dataUrlCache.has(source)) return dataUrlCache.get(source);
      const read = await api.electronAPI.readFileAsDataUrl(source);
      const dataUrl = read?.ok && read.dataUrl ? read.dataUrl : '';
      dataUrlCache.set(source, dataUrl);
      return dataUrl;
    };

    const thumbs = Array.from(scope.querySelectorAll('.bse-thumb[data-source]'));
    await Promise.all(thumbs.map(async (thumb) => {
      const source = thumb.dataset.source;
      if (!source) return;
      const dataUrl = await readDataUrl(source);
      if (!dataUrl) return;
      thumb.innerHTML = '';
      thumb.style.backgroundImage = `url("${dataUrl}")`;
    }));

    const durations = Array.from(scope.querySelectorAll('.bse-audio-duration[data-audio-source]'));
    await Promise.all(durations.map(async (cell) => {
      const dataUrl = await readDataUrl(cell.dataset.audioSource);
      const duration = dataUrl ? await measureAudioDuration(dataUrl) : 0;
      cell.textContent = duration > 0 ? formatDuration(duration) : '-';
    }));

    const palettes = Array.from(scope.querySelectorAll('.bse-palette-strip[data-palette-source]'));
    await Promise.all(palettes.map(async (strip) => {
      const dataUrl = await readDataUrl(strip.dataset.paletteSource);
      const palette = dataUrl ? await extractPalette(dataUrl) : { colors: [], total: 0 };
      renderPaletteStrip(strip, palette);
    }));
  }

  function measureAudioDuration(dataUrl) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => {
        resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      }, { once: true });
      audio.addEventListener('error', () => resolve(0), { once: true });
      audio.src = dataUrl;
    });
  }

  function formatDuration(seconds) {
    const totalTenths = Math.max(0, Math.round(seconds * 10));
    const minutes = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return minutes > 0
      ? `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`
      : `${secs}.${tenths}s`;
  }

  function extractPalette(dataUrl) {
    const indexed = extractIndexedPalette(dataUrl);
    if (indexed.colors.length) return Promise.resolve(indexed);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 1;
          canvas.height = img.naturalHeight || 1;
          const paletteCtx = canvas.getContext('2d', { willReadFrequently: true });
          paletteCtx.drawImage(img, 0, 0);
          const pixels = paletteCtx.getImageData(0, 0, canvas.width, canvas.height).data;
          const colors = [];
          const seen = new Set();
          let total = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            const alpha = pixels[index + 3];
            if (alpha === 0) continue;
            const hex = `#${[pixels[index], pixels[index + 1], pixels[index + 2]]
              .map((part) => part.toString(16).padStart(2, '0'))
              .join('')}`;
            if (seen.has(hex)) continue;
            seen.add(hex);
            total += 1;
            if (colors.length < 16) colors.push(hex);
          }
          resolve({ colors, total });
        } catch (_) {
          resolve({ colors: [], total: 0 });
        }
      };
      img.onerror = () => resolve({ colors: [], total: 0 });
      img.src = dataUrl;
    });
  }

  function extractIndexedPalette(dataUrl) {
    const bytes = bytesFromDataUrl(dataUrl);
    if (!bytes.length) return { colors: [], total: 0 };
    const png = extractPngPalette(bytes);
    if (png.colors.length) return png;
    const bmp = extractBmpPalette(bytes);
    if (bmp.colors.length) return bmp;
    return { colors: [], total: 0 };
  }

  function bytesFromDataUrl(dataUrl) {
    const match = /^data:[^;,]+(?:;[^,]+)?,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) return new Uint8Array();
    try {
      const body = match[1];
      const binary = dataUrl.includes(';base64,')
        ? atob(body)
        : decodeURIComponent(body);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch (_) {
      return new Uint8Array();
    }
  }

  function readU32Be(bytes, offset) {
    return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
  }

  function readU16Le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32Le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
  }

  function hexColor(r, g, b) {
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }

  function extractPngPalette(bytes) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
      return { colors: [], total: 0 };
    }
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = readU32Be(bytes, offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const dataOffset = offset + 8;
      if (dataOffset + length > bytes.length) break;
      if (type === 'PLTE') {
        const total = Math.floor(length / 3);
        const colors = [];
        for (let index = 0; index < Math.min(16, total); index += 1) {
          const base = dataOffset + index * 3;
          colors.push(hexColor(bytes[base], bytes[base + 1], bytes[base + 2]));
        }
        return { colors, total: colors.length };
      }
      if (type === 'IDAT' || type === 'IEND') break;
      offset = dataOffset + length + 4;
    }
    return { colors: [], total: 0 };
  }

  function extractBmpPalette(bytes) {
    if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
      return { colors: [], total: 0 };
    }
    const dataOffset = readU32Le(bytes, 10);
    const dibSize = readU32Le(bytes, 14);
    const bitDepth = readU16Le(bytes, 28);
    if (![1, 2, 4, 8].includes(bitDepth)) return { colors: [], total: 0 };
    const colorCountRaw = readU32Le(bytes, 46);
    const total = colorCountRaw || (1 << bitDepth);
    const paletteOffset = 14 + dibSize;
    const available = Math.max(0, Math.min(total, Math.floor((Math.min(dataOffset, bytes.length) - paletteOffset) / 4)));
    const visible = Math.min(16, available);
    const colors = [];
    for (let index = 0; index < visible; index += 1) {
      const base = paletteOffset + index * 4;
      colors.push(hexColor(bytes[base + 2], bytes[base + 1], bytes[base]));
    }
    return { colors, total: colors.length };
  }

  function renderPaletteStrip(strip, palette) {
    strip.innerHTML = '';
    if (!palette.colors.length) {
      strip.textContent = 'Palette -';
      return;
    }
    palette.colors.forEach((color) => {
      const swatch = document.createElement('span');
      swatch.className = 'bse-palette-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      strip.appendChild(swatch);
    });
    if (palette.total > palette.colors.length) {
      const more = document.createElement('span');
      more.className = 'bse-palette-more';
      more.textContent = `+${palette.total - palette.colors.length}`;
      strip.appendChild(more);
    }
  }

  async function importAssetForRow(row) {
    const kind = row.dataset.kind;
    const role = roleById(kind, row.dataset.role);
    if (!role) return;
    const picked = await api.electronAPI.pickFile({
      title: 'アセットを選択',
      properties: ['openFile'],
      filters: kind === 'se'
        ? [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'vgm', 'xgm'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'Images', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const symbol = await requestAssetSymbol(kind, role);
    if (!symbol) return;
    if (kind === 'se') {
      await importAudioAsset({
        picked,
        symbol,
        kind,
        label: role.label,
        targetSubdir: 'sfx',
        afterRegister: async () => {
          await saveAssetBinding(kind, role.id, symbol);
        },
      });
      return;
    }

    const imagePipeline = api.capabilities.get('image-import-pipeline');
    if (!imagePipeline?.convertToIndexed16) {
      logger.error('画像減色コンバーターまたは画像リサイズコンバーターが無効または未インストールです');
      return;
    }
    const converted = await imagePipeline.convertToIndexed16({
      sourcePath: picked.sourcePath,
      targetSize: { width: role.width, height: role.height },
    });
    if (converted?.canceled) return;

    const ext = converted.targetExtension || '.png';
    const copyResult = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir: kind === 'sprites' ? 'sprite' : 'gfx',
      targetFileName: `${symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!copyResult?.ok) {
      logger.error(copyResult?.error || 'アセットコピーに失敗しました');
      return;
    }

    const entry = kind === 'sprites'
      ? {
          type: 'SPRITE',
          name: symbol,
          sourcePath: copyResult.relativePath,
          width: String(Math.ceil(role.width / 8)),
          height: String(Math.ceil(role.height / 8)),
          compression: 'NONE',
          time: '0',
          collision: 'NONE',
          optType: 'BALANCED',
          optLevel: 'FAST',
          optDuplicate: 'FALSE',
          comment: role.label,
        }
      : {
          type: 'IMAGE',
          name: symbol,
          sourcePath: copyResult.relativePath,
          compression: 'NONE',
          mapOpt: 'ALL',
          mapBase: '0',
          comment: role.label,
        };
    const added = await api.electronAPI.addResEntry({ file: 'resources.res', entry });
    if (!added?.ok) {
      logger.error(added?.error || 'resources.res への追加に失敗しました');
      return;
    }
    await refresh();
    const saved = await saveAssetBinding(kind, role.id, symbol);
    await refresh();
    if (saved) setStatus(`登録しました: ${symbol}`);
  }

  async function importBgmAsset() {
    const picked = await api.electronAPI.pickFile({
      title: 'BGM WAVを選択',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const symbol = await requestStandaloneAssetSymbol('BGM', `bgm_${Date.now().toString(36)}`);
    if (!symbol) return;
    await importAudioAsset({
      picked,
      symbol,
      kind: 'bgms',
      label: 'BGM',
      targetSubdir: 'bgm',
      afterRegister: async () => {
        await refreshResourcesFromResFile();
        renderSelect(ui.bgmSelect, state.resources.bgms || [], '(なし)');
      },
    });
  }

  async function importStageImageAsset() {
    const picked = await api.electronAPI.pickFile({
      title: 'ステージ背景画像を選択',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const symbol = await requestStandaloneAssetSymbol('ステージ背景', `stage_bg_${Date.now().toString(36)}`);
    if (!symbol) return;

    const imagePipeline = api.capabilities.get('image-import-pipeline');
    if (!imagePipeline?.convertToIndexed16) {
      logger.error('画像減色コンバーターまたは画像リサイズコンバーターが無効または未インストールです');
      return;
    }
    const converted = await imagePipeline.convertToIndexed16({
      sourcePath: picked.sourcePath,
      targetSize: { width: 320, height: 224 },
    });
    if (converted?.canceled) return;
    const ext = converted.targetExtension || '.png';

    const copyResult = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir: 'stage',
      targetFileName: `${symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!copyResult?.ok) {
      logger.error(copyResult?.error || 'ステージ背景画像のコピーに失敗しました');
      return;
    }

    const added = await api.electronAPI.addResEntry({
      file: 'resources.res',
      entry: {
        type: 'IMAGE',
        name: symbol,
        sourcePath: copyResult.relativePath,
        compression: 'NONE',
        mapOpt: 'ALL',
        mapBase: '0',
        comment: 'ステージ背景',
      },
    });
    if (!added?.ok) {
      logger.error(added?.error || 'resources.res への追加に失敗しました');
      return;
    }

    await refresh();
    renderSelect(ui.bgSelect, state.resources.stageImages || [], '(なし)');
    renderSelect(ui.clearSelect, state.resources.stageImages || [], '(なし)');
    setStatus(`登録しました: ${symbol}`);
  }

  async function importAudioAsset({ picked, symbol, kind, label, targetSubdir, afterRegister }) {
    const audioCapability = api.capabilities.get('audio-convert-ui');
    if (!audioCapability?.openAudioConvertModal) {
      logger.error('音声変換コンバータープラグインが無効または未インストールです');
      return;
    }
    await audioCapability.openAudioConvertModal({
      picked,
      targetSubdir,
      targetFileName: `${symbol}.wav`,
      symbol,
      comment: label,
      resFile: 'resources.res',
      options: xgm2Pcm6650Options(),
      entry: xgm2Pcm6650Entry(symbol, '', label),
      resEntry: xgm2Pcm6650Entry(symbol, '', label),
      resEntryDefaults: xgm2Pcm6650Entry(symbol, '', label),
    });
    void (async () => {
      const found = await waitForResourceSymbol(kind, symbol);
      if (!found) return;
      await enforceXgm2Pcm6650(symbol);
      await refresh();
      await afterRegister?.();
      await refresh();
      setStatus(`登録しました: ${symbol}`);
    })();
  }

  function xgm2Pcm6650Options() {
    return {
      mono: true,
      sampleRate: 6650,
      outRate: 6650,
      driver: 'XGM2',
      far: true,
    };
  }

  function xgm2Pcm6650Entry(symbol, sourcePath = '', comment = '') {
    return {
      type: 'WAV',
      name: symbol,
      sourcePath,
      driver: 'XGM2',
      outRate: '6650',
      far: 'TRUE',
      comment,
    };
  }

  async function enforceXgm2Pcm6650(symbol) {
    if (!api.electronAPI?.listResDefinitions || !api.electronAPI?.updateResEntry) return false;
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok || !Array.isArray(result.files)) return false;
    for (const file of result.files) {
      const entry = (file.entries || []).find((item) => item.name === symbol && String(item.type || '').toUpperCase() === 'WAV');
      if (!entry) continue;
      const updated = {
        ...entry,
        driver: 'XGM2',
        outRate: '6650',
        far: 'TRUE',
      };
      const saved = await api.electronAPI.updateResEntry({ file: file.file, lineNumber: entry.lineNumber, entry: updated });
      return Boolean(saved?.ok);
    }
    return false;
  }

  async function deleteBgmAsset(symbol) {
    const name = String(symbol || '').trim();
    if (!name) return;
    if (!window.confirm(`BGMアセットを削除しますか？\n${name}`)) return;
    await refreshResourcesFromResFile();
    const asset = (state.resources.bgms || []).find((entry) => entry.name === name);
    if (!asset?.file || !asset?.lineNumber) {
      setStatus(`削除対象のBGMが見つかりません: ${name}`);
      return;
    }
    const deleted = await api.electronAPI.deleteResEntry({ file: asset.file, lineNumber: asset.lineNumber });
    if (!deleted?.ok) {
      logger.error(deleted?.error || 'BGMアセットの削除に失敗しました');
      return;
    }
    const affected = (state.stages || []).filter((stage) => stage.bgm_symbol === name);
    for (const stage of affected) {
      await api.plugins.invokeHook(plugin.id, 'saveStage', { stage: { ...stage, bgm_symbol: '' } });
    }
    const settings = JSON.parse(JSON.stringify(state.settings || defaultSettings()));
    const screenBgms = settings.game_settings?.screen_bgm_symbols || {};
    let settingsChanged = false;
    Object.entries(screenBgms).forEach(([key, value]) => {
      if (value === name) {
        screenBgms[key] = '';
        settingsChanged = true;
      }
    });
    if (settingsChanged) {
      settings.game_settings.screen_bgm_symbols = screenBgms;
      await api.plugins.invokeHook(plugin.id, 'saveBlockSettings', { settings });
    }
    if (state.current?.bgm_symbol === name) state.current.bgm_symbol = '';
    await refresh();
    setStatus(`BGMアセットを削除しました: ${name}`);
  }

  async function deleteStageImageAsset(symbol) {
    const name = String(symbol || '').trim();
    if (!name) return;
    if (!window.confirm(`ステージ背景画像を削除しますか？\n${name}`)) return;
    await refreshResourcesFromResFile();
    const asset = (state.resources.stageImages || []).find((entry) => entry.name === name)
      || (state.resources.images || []).find((entry) => entry.name === name);
    if (!asset?.file || !asset?.lineNumber) {
      const affected = (state.stages || []).filter((stage) => (
        stage.background_image_symbol === name || stage.clear_image_symbol === name
      ));
      for (const stage of affected) {
        await api.plugins.invokeHook(plugin.id, 'saveStage', {
          stage: {
            ...stage,
            background_image_symbol: stage.background_image_symbol === name ? '' : stage.background_image_symbol,
            clear_image_symbol: stage.clear_image_symbol === name ? '' : stage.clear_image_symbol,
          },
        });
      }
      if (state.current?.background_image_symbol === name) state.current.background_image_symbol = '';
      if (state.current?.clear_image_symbol === name) state.current.clear_image_symbol = '';
      await refreshSettingsState();
      renderSelect(ui.bgSelect, state.resources.stageImages || [], '(なし)');
      renderSelect(ui.clearSelect, state.resources.stageImages || [], '(なし)');
      syncFormFromStage();
      renderAssetSettings();
      setStatus(`ステージ背景一覧を更新しました: ${name}`);
      return;
    }
    const deleted = await api.electronAPI.deleteResEntry({ file: asset.file, lineNumber: asset.lineNumber });
    if (!deleted?.ok) {
      logger.error(deleted?.error || 'ステージ背景画像の削除に失敗しました');
      return;
    }
    const affected = (state.stages || []).filter((stage) => (
      stage.background_image_symbol === name || stage.clear_image_symbol === name
    ));
    for (const stage of affected) {
      await api.plugins.invokeHook(plugin.id, 'saveStage', {
        stage: {
          ...stage,
          background_image_symbol: stage.background_image_symbol === name ? '' : stage.background_image_symbol,
          clear_image_symbol: stage.clear_image_symbol === name ? '' : stage.clear_image_symbol,
        },
      });
    }
    if (state.current?.background_image_symbol === name) state.current.background_image_symbol = '';
    if (state.current?.clear_image_symbol === name) state.current.clear_image_symbol = '';
    await refresh();
    setStatus(`ステージ背景画像を削除しました: ${name}`);
  }

  async function importSystemFont() {
    const picked = await api.electronAPI.pickFile({
      title: 'システムフォント画像を選択',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const symbol = await requestStandaloneAssetSymbol('システムフォント', 'font_system');
    if (!symbol) return;
    const paletteSymbol = `${symbol}_palette`;
    await refreshSettingsState();
    await refreshResourcesFromResFile();
    if (resourceNameExists(paletteSymbol)) {
      setStatus(`アセット名は既に登録されています: ${paletteSymbol}`);
      return;
    }

    const imagePipeline = api.capabilities.get('image-import-pipeline');
    if (!imagePipeline?.convertToIndexed16) {
      logger.error('画像減色コンバーターまたは画像リサイズコンバーターが無効または未インストールです');
      return;
    }
    const converted = await imagePipeline.convertToIndexed16({
      sourcePath: picked.sourcePath,
      targetSize: { width: 128, height: 48 },
    });
    if (converted?.canceled) return;
    const ext = converted.targetExtension || '.png';
    const sizeDataUrl = converted.convertedDataUrl || converted.originalDataUrl || '';
    if (!sizeDataUrl) {
      logger.error('システムフォント画像の確認結果を取得できませんでした');
      return;
    }
    const convertedSize = await measureImageDataUrl(sizeDataUrl);
    if (!convertedSize || convertedSize.width !== 128 || convertedSize.height !== 48) {
      logger.error('システムフォント画像は128x48に変換する必要があります');
      return;
    }

    const copyResult = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir: 'font',
      targetFileName: `${symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!copyResult?.ok) {
      logger.error(copyResult?.error || 'システムフォント画像のコピーに失敗しました');
      return;
    }

    const tilesetEntry = {
      type: 'TILESET',
      name: symbol,
      sourcePath: copyResult.relativePath,
      compression: 'NONE',
      opt: 'ALL',
      ordering: 'ROW',
      export: 'FALSE',
      comment: 'システムフォント',
    };
    const paletteEntry = {
      type: 'PALETTE',
      name: paletteSymbol,
      sourcePath: copyResult.relativePath,
      comment: 'システムフォント PAL0',
    };
    for (const entry of [tilesetEntry, paletteEntry]) {
      const added = await api.electronAPI.addResEntry({ file: 'resources.res', entry });
      if (!added?.ok) {
        logger.error(added?.error || 'resources.res への追加に失敗しました');
        return;
      }
    }

    await refreshResourcesFromResFile();
    renderSelect(ui.fontSelect, state.resources.tilesets || [], '(デフォルト)');
    ui.fontSelect.value = symbol;
    const settings = readSettingsForm();
    settings.game_settings.system_font_symbol = symbol;
    await saveSettingsState(settings, `システムフォントを登録しました: ${symbol}`);
  }

  async function validateAssetSelection(kind, roleId, symbol) {
    if (!symbol) return { ok: true };
    const role = roleById(kind, roleId);
    if (!role) return { ok: false, error: '不明なアセット設定です' };
    const resourceKind = kind === 'se' ? 'ses' : kind;
    const asset = selectedAsset(resourceKind, symbol);
    if (!asset) return { ok: false, error: `アセットが見つかりません: ${symbol}` };
    if (kind === 'se') return { ok: true };

    const size = await measureAsset(asset);
    if (!size) return { ok: false, error: `${symbol} の画像サイズを確認できません` };
    if (size.width !== role.width || size.height !== role.height) {
      return {
        ok: false,
        error: `${role.label} は ${role.width}x${role.height} が必要ですが、${symbol} は ${size.width}x${size.height} です`,
      };
    }
    return { ok: true };
  }

  async function measureAsset(asset) {
    if (asset?.type === 'SPRITE') {
      const tileW = Number(asset.width);
      const tileH = Number(asset.height);
      if (Number.isFinite(tileW) && tileW > 0 && Number.isFinite(tileH) && tileH > 0) {
        return { width: tileW * 8, height: tileH * 8 };
      }
    }
    if (!asset?.sourceAbsolutePath) return null;
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = read.dataUrl;
    });
  }

  function measureImageDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function roleById(kind, id) {
    const roles = kind === 'se' ? SE_ROLES : kind === 'sprites' ? SPRITE_ROLES : SYSTEM_IMAGE_ROLES;
    return roles.find((role) => role.id === id);
  }

  function suggestedSymbol(roleId) {
    const prefix = state.activeAssetTab === 'se' ? 'se' : state.activeAssetTab === 'sprites' ? 'spr' : 'img';
    return sanitizeSymbolName(`${prefix}_${roleId}`);
  }

  function sanitizeSymbolName(value) {
    let symbol = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    if (!symbol) symbol = 'asset';
    if (/^[0-9]/.test(symbol)) symbol = `asset_${symbol}`;
    return symbol;
  }

  function resourceNameExists(symbol) {
    const needle = String(symbol || '').trim();
    if (!needle) return false;
    return (state.resources.all || []).some((entry) => entry.name === needle)
      || ['images', 'stageImages', 'bgms', 'sprites', 'ses', 'tilesets', 'palettes'].some((kind) => (
        (state.resources[kind] || []).some((entry) => entry.name === needle)
      ));
  }

  function observePageActivation() {
    const observer = new MutationObserver(() => {
      const active = root.classList.contains('active');
      if (active && !state.wasActive) void refreshVisibleAssetDefinitions();
      state.wasActive = active;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    state.activationObserver = observer;
  }

  async function refreshResourcesFromResFile() {
    if (!api.electronAPI?.listResDefinitions) return;
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok || !Array.isArray(result.files)) return;
    const entries = result.files.flatMap((file) => (file.entries || []).map((entry) => ({ ...entry, file: file.file })));
    const normalized = entries.map((entry) => ({
      ...entry,
      name: String(entry?.name || ''),
      type: String(entry?.type || '').toUpperCase(),
      sourcePath: String(entry?.sourcePath || ''),
      sourceAbsolutePath: String(entry?.sourceAbsolutePath || ''),
    })).filter((entry) => entry.name);
    state.resources = normalizeResourceBuckets({
      ...(state.resources || {}),
      images: normalized.filter((entry) => entry.type === 'IMAGE'),
      bgms: normalized.filter(isBgmResource),
      sprites: normalized.filter((entry) => entry.type === 'SPRITE'),
      ses: normalized.filter((entry) => entry.type === 'WAV'),
      tilesets: normalized.filter((entry) => entry.type === 'TILESET'),
      palettes: normalized.filter((entry) => entry.type === 'PALETTE'),
      all: normalized,
    });
  }

  async function refreshVisibleAssetDefinitions() {
    const stageValues = {
      bg: ui.bgSelect.value,
      clear: ui.clearSelect.value,
      bgm: ui.bgmSelect.value,
    };
    const fontValue = ui.fontSelect.value;
    const screenBgmValues = new Map(ui.screenBgmSelects.map((select) => [select.dataset.screenBgm, select.value]));
    await refreshResourcesFromResFile();
    renderSelect(ui.bgSelect, state.resources.stageImages || [], '(なし)');
    renderSelect(ui.clearSelect, state.resources.stageImages || [], '(なし)');
    renderSelect(ui.bgmSelect, state.resources.bgms || [], '(なし)');
    renderSelect(ui.fontSelect, state.resources.tilesets || [], '(デフォルト)');
    setSelectValueIfAvailable(ui.bgSelect, stageValues.bg);
    setSelectValueIfAvailable(ui.clearSelect, stageValues.clear);
    setSelectValueIfAvailable(ui.bgmSelect, stageValues.bgm);
    setSelectValueIfAvailable(ui.fontSelect, fontValue);
    ui.screenBgmSelects.forEach((select) => {
      renderSelect(select, state.resources.bgms || [], '(なし)');
      setSelectValueIfAvailable(select, screenBgmValues.get(select.dataset.screenBgm) || '');
    });
    readFormIntoStage();
    renderAssetSettings();
    updateStageThumbs();
    updateSystemFontPreview();
    await loadImageForSymbol(state.current?.background_image_symbol || '');
    draw();
    setStatus('アセット定義を更新しました');
  }

  function setSelectValueIfAvailable(select, value) {
    select.value = value || '';
    if (value && select.value !== value) select.value = '';
  }

  function isBgmResource(entry) {
    const type = String(entry?.type || '').toUpperCase();
    const sourcePath = String(entry?.sourcePath || '').replace(/\\/g, '/').toLowerCase();
    return type === 'XGM' || type === 'XGM2' || (type === 'WAV' && sourcePath.startsWith('bgm/'));
  }

  async function requestAssetSymbol(kind, role) {
    const defaultSymbol = suggestedSymbol(role.id);
    const label = kind === 'se' ? '効果音' : kind === 'sprites' ? 'スプライト' : '画像';
    const raw = await openAssetSymbolModal(label, defaultSymbol);
    if (raw === null) return '';
    if (!String(raw).trim()) {
      setStatus('アセット名を入力してください');
      return '';
    }
    const symbol = sanitizeSymbolName(raw);
    if (!symbol) {
      setStatus('アセット名を入力してください');
      return '';
    }
    await refreshSettingsState();
    await refreshResourcesFromResFile();
    if (resourceNameExists(symbol)) {
      setStatus(`アセット名は既に登録されています: ${symbol}`);
      return '';
    }
    return symbol;
  }

  async function requestStandaloneAssetSymbol(label, defaultSymbol) {
    const raw = await openAssetSymbolModal(label, sanitizeSymbolName(defaultSymbol));
    if (raw === null) return '';
    if (!String(raw).trim()) {
      setStatus('アセット名を入力してください');
      return '';
    }
    const symbol = sanitizeSymbolName(raw);
    if (!symbol) {
      setStatus('アセット名を入力してください');
      return '';
    }
    await refreshSettingsState();
    await refreshResourcesFromResFile();
    if (resourceNameExists(symbol)) {
      setStatus(`アセット名は既に登録されています: ${symbol}`);
      return '';
    }
    return symbol;
  }

  async function updateSystemFontPreview() {
    if (!ui.fontThumb || !ui.fontPalette) return;
    ui.fontThumb.textContent = '-';
    ui.fontThumb.style.backgroundImage = '';
    renderPaletteStrip(ui.fontPalette, { colors: [], total: 0 });

    const asset = selectedAsset('tilesets', ui.fontSelect.value);
    if (!asset?.sourceAbsolutePath) return;
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) return;
    ui.fontThumb.textContent = '';
    ui.fontThumb.style.backgroundImage = `url("${read.dataUrl}")`;
    const palette = extractIndexedPalette(read.dataUrl);
    renderPaletteStrip(ui.fontPalette, palette.colors.length ? palette : await extractPalette(read.dataUrl));
  }

  function openAssetSymbolModal(label, defaultSymbol) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `bse-symbol-modal-${plugin.id}`,
        className: 'app-modal bse-symbol-modal',
        panelClassName: 'app-panel bse-symbol-panel',
        html: `
          <header class="bse-symbol-header">
            <h2>アセット名</h2>
          </header>
          <div class="bse-symbol-body">
            <label class="bse-symbol-field">${escapeHtml(label)}の登録名
              <input class="bse-symbol-input" type="text" value="${escapeHtml(defaultSymbol)}" spellcheck="false">
            </label>
          </div>
          <footer class="bse-symbol-actions">
            <button type="button" class="bse-symbol-cancel">キャンセル</button>
            <button type="button" class="bse-symbol-ok">登録</button>
          </footer>
        `,
      });
      const input = modal.panel.querySelector('.bse-symbol-input');
      const ok = modal.panel.querySelector('.bse-symbol-ok');
      const cancel = modal.panel.querySelector('.bse-symbol-cancel');
      const backdrop = modal.modal.querySelector('[data-modal-close]');
      let resolved = false;

      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.close();
        modal.destroy();
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(null);
        if (event.key === 'Enter' && document.activeElement === input) finish(input.value);
      };

      ok.addEventListener('click', () => finish(input.value));
      cancel.addEventListener('click', () => finish(null));
      backdrop?.addEventListener('click', () => finish(null));
      document.addEventListener('keydown', onKeyDown);
      modal.open();
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function drawGrid() {
    ctx.save();
    ctx.lineWidth = 0.5;
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        const x = col * BLOCK_W;
        const y = row * BLOCK_H;
        const value = state.current?.blocks?.[row]?.[col] || 0;
        const block = BLOCKS.find((item) => item.id === value) || BLOCKS[0];
        if (value) {
          ctx.fillStyle = block.color;
          ctx.fillRect(x + 0.5, y + 0.5, BLOCK_W - 1, BLOCK_H - 1);
        }
        const power = state.current?.power_ups?.[`${row},${col}`];
        const powerBorder = POWERUP_BORDER_COLORS[power];
        if (value === 2 && powerBorder) {
          ctx.save();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = powerBorder;
          ctx.strokeRect(x + 2, y + 2, BLOCK_W - 4, BLOCK_H - 4);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.09)';
        ctx.strokeRect(x + 0.25, y + 0.25, BLOCK_W - 0.5, BLOCK_H - 0.5);
      }
    }
    ctx.restore();
  }

  function drawPanel() {
    ctx.fillStyle = state.showStageBackground && state.backgroundImage
      ? 'rgba(32, 36, 45, .58)'
      : '#20242d';
    ctx.fillRect(FIELD_W, 0, CANVAS_W - FIELD_W, CANVAS_H);
  }

  function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#173922';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (state.showStageBackground && state.backgroundImage) {
      ctx.drawImage(state.backgroundImage, 0, 0, CANVAS_W, CANVAS_H);
    }
    drawGrid();
    drawPanel();
  }

  function paint(event) {
    if (!state.current) return;
    const rect = ui.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((event.clientY - rect.top) / rect.height) * CANVAS_H;
    if (x < 0 || x >= FIELD_W || y < 0 || y >= CANVAS_H) return;
    const col = Math.floor(x / BLOCK_W);
    const row = Math.floor(y / BLOCK_H);
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return;
    const value = event.buttons === 2 ? 0 : state.selectedBlock;
    state.current.blocks[row][col] = value;
    const key = `${row},${col}`;
    if (value === 2 && state.selectedPowerUp) {
      state.current.power_ups[key] = state.selectedPowerUp;
    } else {
      delete state.current.power_ups[key];
    }
    setDirty(true);
    draw();
  }

  async function previewAsset(kind, symbol) {
    const asset = selectedAsset(kind, symbol);
    if (!asset?.sourceAbsolutePath) return;
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) return;
    ui.previewBody.innerHTML = '';
    if (kind === 'bgms' || kind === 'ses') {
      if (state.audio) state.audio.pause();
      state.audio = new Audio(read.dataUrl);
      state.audio.controls = true;
      state.audio.autoplay = true;
      ui.previewBody.appendChild(state.audio);
    } else {
      const img = document.createElement('img');
      img.src = read.dataUrl;
      img.alt = asset.name;
      ui.previewBody.appendChild(img);
    }
    ui.preview.hidden = false;
  }

  async function toggleAudioPreview(button, symbol) {
    if (state.audio && state.audio.dataset?.symbol === symbol && !state.audio.paused) {
      state.audio.pause();
      state.audio.currentTime = 0;
      button.textContent = '▶';
      button.title = '再生';
      return;
    }
    if (state.audio) {
      state.audio.pause();
      if (state.audioButton) {
        state.audioButton.textContent = '▶';
        state.audioButton.title = '再生';
      }
    }
    let sourcePath = button.dataset.source
      || selectedAsset('ses', symbol)?.sourceAbsolutePath
      || selectedAsset('bgms', symbol)?.sourceAbsolutePath
      || '';
    if (!sourcePath) {
      await refreshSettingsState();
      sourcePath = selectedAsset('ses', symbol)?.sourceAbsolutePath
        || selectedAsset('bgms', symbol)?.sourceAbsolutePath
        || '';
      if (sourcePath) button.dataset.source = sourcePath;
    }
    if (!sourcePath) {
      setStatus(`プレビュー対象が見つかりません: ${symbol}`);
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
    if (!read?.ok || !read.dataUrl) return;
    state.audio = new Audio(read.dataUrl);
    state.audio.dataset.symbol = symbol;
    state.audioButton = button;
    button.textContent = '■';
    button.title = '停止';
    state.audio.addEventListener('ended', () => {
      button.textContent = '▶';
      button.title = '再生';
    }, { once: true });
    await state.audio.play().catch(() => {
      button.textContent = '▶';
      button.title = '再生';
    });
  }

  root.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    if (action === 'new') void createStage();
    if (action === 'delete') void deleteStage();
    if (action === 'move-up') void moveStage('up');
    if (action === 'move-down') void moveStage('down');
    if (action === 'save-all') void saveAll();
    if (action === 'preview-bgm') void previewAsset('bgms', ui.bgmSelect.value);
    if (action === 'preview-row-audio') void toggleAudioPreview(event.target, event.target.dataset.symbol);
    if (action === 'import-asset') void importAssetForRow(event.target.closest('tr'));
    if (action === 'import-bgm') void importBgmAsset();
    if (action === 'delete-bgm') void deleteBgmAsset(event.target.dataset.symbol);
    if (action === 'import-stage-image') void importStageImageAsset();
    if (action === 'delete-stage-image') void deleteStageImageAsset(event.target.dataset.symbol);
    if (action === 'import-font') void importSystemFont();
  });
  root.addEventListener('change', (event) => {
    if (event.target?.classList?.contains('bse-binding-select')) {
      const row = event.target.closest('tr');
      void saveAssetBinding(row.dataset.kind, row.dataset.role, event.target.value);
    }
  });
  root.addEventListener('input', (event) => {
    const roleId = event.target?.dataset?.screenWaitInline;
    if (roleId) updateScreenWait(roleId, event.target.value);
  });
  root.querySelector('.bse-preview-close').addEventListener('click', () => {
    if (state.audio) state.audio.pause();
    ui.preview.hidden = true;
  });
  ui.topTabs.forEach((tab) => tab.addEventListener('click', () => {
    state.activeTab = tab.dataset.tab;
    syncTopTabs();
  }));
  ui.assetTabs.forEach((tab) => tab.addEventListener('click', () => {
    state.activeAssetTab = tab.dataset.assetTab;
    renderAssetSettings();
  }));
  ui.stageSelect.addEventListener('change', () => {
    const stage = state.stages.find((item) => item.id === ui.stageSelect.value);
    if (stage) setCurrentStage(stage);
    updateMoveStageButtons();
  });
  [ui.stageName, ui.bgSelect, ui.bgmSelect, ui.clearSelect].forEach((control) => {
    control.addEventListener('input', () => {
      if (control === ui.bgSelect) {
        applyBackgroundSelection();
        setDirty(true);
        return;
      }
      readFormIntoStage();
      setDirty(true);
      if (control === ui.clearSelect) updateStageThumbs();
    });
    control.addEventListener('change', () => {
      if (control === ui.bgSelect) {
        applyBackgroundSelection();
        setDirty(true);
        return;
      }
      readFormIntoStage();
      setDirty(true);
      if (control === ui.clearSelect) updateStageThumbs();
    });
  });
  ui.fontSelect.addEventListener('change', () => {
    setSettingsDirty(true);
    updateSystemFontPreview();
  });
  ui.screenBgmSelects.forEach((select) => {
    select.addEventListener('change', () => setSettingsDirty(true));
  });
  ui.bgVisible.addEventListener('change', () => {
    state.showStageBackground = ui.bgVisible.checked;
    draw();
  });
  ui.settingInputs.forEach((input) => {
    input.addEventListener('input', () => {
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = input.dataset.setting === 'bgm_volume' ? `${input.value}%` : input.value;
      setSettingsDirty(true);
    });
  });
  ui.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  ui.canvas.addEventListener('mousedown', paint);
  ui.canvas.addEventListener('mousemove', (event) => {
    if (event.buttons) paint(event);
  });

  syncTopTabs();
  renderPalettes();
  observePageActivation();
  void refresh();
  registerCapability('block-stage-editor', { pluginId: plugin.id, root, refresh });
  logger.debug('block-stage-editor renderer activated');

  return {
    deactivate() {
      if (state.audio) state.audio.pause();
      state.activationObserver?.disconnect();
      root.innerHTML = '';
    },
  };
}
