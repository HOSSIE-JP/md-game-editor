const CHANNELS = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'PSG1', 'PSG2', 'PSG3', 'NOISE'];
const ROWS_PER_PATTERN = 64;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PIANO_NOTES = Array.from({ length: 37 }, (_, index) => 84 - index);
const TRACKER_KEYBOARD_MAP = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23,
};

let audioContext = null;
let previewTimers = [];
let previewRowTimer = 0;

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const state = {
    plugin,
    api,
    resFiles: [],
    expandedFiles: new Set(),
    fileFilter: '',
    keyword: '',
    selectedKey: '',
    selectedAsset: null,
    selectedExternal: false,
    pendingNew: false,
    editable: true,
    dirty: false,
    viewMode: 'tracker',
    pianoChannel: 'FM1',
    pianoTool: 'draw',
    showPianoLayers: true,
    pianoSelection: null,
    pianoDrag: null,
    pianoHover: null,
    channelMute: Object.fromEntries(CHANNELS.map((id) => [id, false])),
    channelVisible: Object.fromEntries(CHANNELS.map((id) => [id, true])),
    selectedCell: { row: 0, channel: 'FM1' },
    keyboardOctave: 4,
    instrumentPanel: 'instrument',
    instrumentTestNote: 'C5',
    presetName: 'Preset 1',
    presetStartRow: 0,
    presetLength: 8,
    presetPasteRow: 0,
    playbackRow: -1,
    song: createDefaultSong(),
    selectedPattern: 0,
    selectedInstrument: 'fm_bell',
    undo: [],
    redo: [],
    diagnostics: [],
    allocations: [],
    status: '',
    previewEngineStatus: '',
    selectedOrderIndex: 0,
    leftColumnWidth: 300,
    rightColumnWidth: 320,
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'md-bgm-composer-shell';
  wrapper.innerHTML = renderShell();
  api.mountElement(wrapper, 'page');

  const els = queryElements(wrapper);
  applyColumnWidths(state, els);
  bindEvents({ plugin, api, logger, state, els });
  renderAll(state, els);
  void refreshAssets({ state, els });
  const pageRefreshObserver = setupPageAutoRefresh(root, state, els);

  registerCapability('md-bgm-composer', {
    getSong: () => structuredClone(state.song),
    setSong(song) {
      pushUndo(state);
      state.song = normalizeSong(song);
      selectOrderIndex(state, 0);
      state.dirty = true;
      renderAll(state, els);
    },
    validate: () => validateViaMain(plugin, api, state, els),
    refreshAssets: () => refreshAssets({ state, els }),
    selectAsset: ({ resFile, lineNumber }) => requestSelectAsset(assetKey(resFile, { lineNumber }), { plugin, api, state, els }),
    importMidiToRes: ({ resFile, sourcePath, symbol }) => importMidiToRes({ plugin, api, state, els, sourcePath, symbol, resFile }),
    saveCurrentSong: () => saveCurrentSong({ plugin, api, state, els }),
  });

  registerCapability('music-import-handler', {
    async importMidi(sourcePath) {
      return importMidiToRes({ plugin, api, state, els, sourcePath });
    },
  });

  logger.debug('md-bgm-composer renderer activated');
  return {
    deactivate() {
      stopPreview();
      pageRefreshObserver?.disconnect?.();
      wrapper.remove();
    },
  };
}

function renderShell() {
  return `
    <div class="md-bgm-layout" data-role="layout">
      <aside class="md-bgm-sidebar left">
        <div class="md-bgm-list-toolbar">
          <h2>BGM</h2>
        </div>
        <div class="md-bgm-filter">
          <label>.res ファイル
            <select data-role="res-filter"></select>
          </label>
          <label>アセット名
            <input data-role="keyword" type="search" placeholder="keyword">
          </label>
        </div>
        <div class="md-bgm-list-actions">
          <button type="button" class="md-bgm-import-button" data-action="import-music-to-res" title="MIDI/VGM/XGM を登録" aria-label="MIDI/VGM/XGM を登録">
            <svg class="icon"><use href="#icon-file-plus"></use></svg>
            <span>Import</span>
          </button>
          <button type="button" class="md-bgm-icon" data-action="create-empty" title="空のBGM作成" aria-label="空のBGM作成">＋</button>
        </div>
        <div class="md-bgm-asset-tree" data-role="asset-tree"></div>
      </aside>
      <div class="md-bgm-column-resizer" data-resize-column="left" role="separator" aria-orientation="vertical" title="列幅を変更"></div>
      <main class="md-bgm-main">
        <div class="md-bgm-toolbar" role="toolbar" aria-label="BGM composer toolbar">
          <div class="md-bgm-segmented" role="tablist">
            <button type="button" data-view="tracker" class="active">Tracker</button>
            <button type="button" data-view="piano">Piano Roll</button>
          </div>
          <div class="md-bgm-tool-group">
            <button type="button" class="md-bgm-icon" data-action="edit-external" data-role="edit-external" title="編集" aria-label="編集" hidden>✎</button>
            <button type="button" class="md-bgm-icon" data-action="play" title="プレビュー再生" aria-label="プレビュー再生">▶</button>
            <button type="button" class="md-bgm-icon" data-action="stop" title="停止" aria-label="停止">■</button>
            <button type="button" class="md-bgm-icon" data-action="validate" title="検証" aria-label="検証">✓</button>
            <button type="button" class="md-bgm-icon" data-action="undo" title="Undo" aria-label="Undo">↶</button>
            <button type="button" class="md-bgm-icon" data-action="redo" title="Redo" aria-label="Redo">↷</button>
          </div>
          <span class="md-bgm-status" data-role="status"></span>
        </div>
        <div class="md-bgm-external-notice" data-role="external-notice" hidden>
          外部 VGM/XGM のためプレビュー専用です。編集するには近似復元で中間ファイルを作成してください。
        </div>
        <div class="md-bgm-pattern-strip" data-role="patterns"></div>
        <div class="md-bgm-editor-pane" data-role="editor-pane">
          <div class="md-bgm-tracker-wrap" data-role="tracker-wrap">
            <table class="md-bgm-tracker" data-role="tracker"></table>
          </div>
          <div class="md-bgm-piano-wrap" data-role="piano-wrap" hidden>
            <div class="md-bgm-piano-toolbar">
              <div class="md-bgm-piano-tools" data-role="piano-tools" aria-label="Piano roll tools"></div>
              <div class="md-bgm-piano-channel-tabs" data-role="piano-channel-tabs"></div>
              <label class="md-bgm-toggle"><input data-role="piano-layers" type="checkbox" checked> Layer</label>
            </div>
            <div class="md-bgm-piano-scroll" data-role="piano-scroll">
              <div class="md-bgm-piano-grid" data-role="piano-grid"></div>
              <div class="md-bgm-piano-selection-rect" data-role="piano-selection-rect" hidden></div>
            </div>
          </div>
        </div>
      </main>
      <div class="md-bgm-column-resizer" data-resize-column="right" role="separator" aria-orientation="vertical" title="列幅を変更"></div>
      <aside class="md-bgm-sidebar right">
        <section class="md-bgm-form">
          <div class="md-bgm-section-title">Song</div>
          <label>Title<input data-field="title" type="text"></label>
          <label>Artist<input data-field="artist" type="text"></label>
          <label>Symbol<input data-field="symbol" type="text"></label>
          <div class="md-bgm-pair">
            <label>Tempo<input data-field="tempo" type="number" min="30" max="300"></label>
            <label>Speed<input data-field="speed" type="number" min="1" max="31"></label>
          </div>
        </section>
        <section class="md-bgm-form" data-role="instrument-editor"></section>
        <section>
          <div class="md-bgm-section-title">Import / Analyze</div>
          <div class="md-bgm-allocations" data-role="allocations"></div>
        </section>
        <section>
          <div class="md-bgm-section-title">Diagnostics</div>
          <div class="md-bgm-diagnostics" data-role="diagnostics"></div>
        </section>
      </aside>
    </div>
  `;
}

function queryElements(root) {
  return {
    status: root.querySelector('[data-role="status"]'),
    layout: root.querySelector('[data-role="layout"]'),
    columnResizers: Array.from(root.querySelectorAll('[data-resize-column]')),
    resFilter: root.querySelector('[data-role="res-filter"]'),
    keyword: root.querySelector('[data-role="keyword"]'),
    assetTree: root.querySelector('[data-role="asset-tree"]'),
    editExternal: root.querySelector('[data-role="edit-external"]'),
    externalNotice: root.querySelector('[data-role="external-notice"]'),
    patterns: root.querySelector('[data-role="patterns"]'),
    tracker: root.querySelector('[data-role="tracker"]'),
    trackerWrap: root.querySelector('[data-role="tracker-wrap"]'),
    pianoWrap: root.querySelector('[data-role="piano-wrap"]'),
    pianoGrid: root.querySelector('[data-role="piano-grid"]'),
    pianoTools: root.querySelector('[data-role="piano-tools"]'),
    pianoChannelTabs: root.querySelector('[data-role="piano-channel-tabs"]'),
    pianoLayers: root.querySelector('[data-role="piano-layers"]'),
    pianoScroll: root.querySelector('[data-role="piano-scroll"]'),
    pianoSelectionRect: root.querySelector('[data-role="piano-selection-rect"]'),
    instrumentEditor: root.querySelector('[data-role="instrument-editor"]'),
    diagnostics: root.querySelector('[data-role="diagnostics"]'),
    allocations: root.querySelector('[data-role="allocations"]'),
    fields: Array.from(root.querySelectorAll('[data-field]')),
    viewButtons: Array.from(root.querySelectorAll('[data-view]')),
    shell: root,
  };
}

function createDefaultSong(options = {}) {
  const symbol = normalizeSymbol(options.symbol || 'bgm_001');
  return {
    version: 1,
    title: String(options.title || 'New BGM'),
    artist: String(options.artist || ''),
    symbol,
    tempo: Number(options.tempo) || 150,
    speed: Number(options.speed) || 6,
    rowsPerPattern: ROWS_PER_PATTERN,
    channels: CHANNELS.map((id) => ({ id, type: id.startsWith('FM') ? 'fm' : id === 'NOISE' ? 'noise' : 'psg', label: id })),
    order: [0],
    patterns: [{ id: 0, name: 'Pattern 00', rows: emptyRows() }],
    instruments: [
      createDefaultInstrument('fm', 'fm_bell', 'FM Bell'),
      createDefaultInstrument('psg', 'psg_square', 'PSG Square'),
      createDefaultInstrument('noise', 'noise_kit', 'Noise Kit'),
    ],
    metadata: { profile: 'xgm2-safe', createdBy: 'md-bgm-composer' },
  };
}

function emptyRows() {
  return Array.from({ length: ROWS_PER_PATTERN }, () => ({ cells: {} }));
}

function createDefaultInstrument(type, id, name) {
  const base = { id, name, type, volume: 10, pan: 'center' };
  if (type === 'fm') {
    return {
      ...base,
      algorithm: 4,
      feedback: 2,
      ams: 0,
      fms: 0,
      operators: Array.from({ length: 4 }, () => ({
        tl: 32, ar: 31, dr: 12, sr: 0, rr: 8, sl: 4, detune: 0, multiple: 1, rs: 0, am: 0, ssgEg: 0,
      })),
    };
  }
  if (type === 'noise') return { ...base, envelope: 'hold', noiseFrequency: 'clocked' };
  return { ...base, envelope: 'hold', toneMode: 'square' };
}

function normalizeInstrument(instrument) {
  if (!instrument || typeof instrument !== 'object') return instrument;
  const defaults = createDefaultInstrument(instrument.type || 'fm', instrument.id || 'instrument', instrument.name || instrument.id || 'Instrument');
  Object.assign(instrument, { ...defaults, ...instrument });
  if (instrument.type === 'fm') {
    instrument.ams = Number.isFinite(Number(instrument.ams)) ? Math.max(0, Math.min(3, Number(instrument.ams))) : 0;
    instrument.fms = Number.isFinite(Number(instrument.fms)) ? Math.max(0, Math.min(7, Number(instrument.fms))) : 0;
    instrument.operators = Array.from({ length: 4 }, (_, index) => ({
      ...defaults.operators[index],
      ...((instrument.operators || [])[index] || {}),
    }));
    instrument.operators.forEach((op) => {
      op.rs = Number.isFinite(Number(op.rs)) ? Math.max(0, Math.min(3, Number(op.rs))) : 0;
      op.am = Number.isFinite(Number(op.am)) ? Math.max(0, Math.min(1, Number(op.am))) : 0;
      op.ssgEg = Number.isFinite(Number(op.ssgEg)) ? Math.max(0, Math.min(15, Number(op.ssgEg))) : 0;
      op.detune = Number.isFinite(Number(op.detune ?? op.dt1)) ? Number(op.detune ?? op.dt1) : 0;
      op.multiple = Number.isFinite(Number(op.multiple ?? op.mul)) ? Number(op.multiple ?? op.mul) : 1;
      op.dr = Number.isFinite(Number(op.dr ?? op.d1r)) ? Number(op.dr ?? op.d1r) : 12;
      op.sr = Number.isFinite(Number(op.sr ?? op.d2r)) ? Number(op.sr ?? op.d2r) : 0;
      op.sl = Number.isFinite(Number(op.sl ?? op.d1l)) ? Number(op.sl ?? op.d1l) : 4;
    });
  }
  return instrument;
}

function normalizeSong(song) {
  const base = createDefaultSong();
  const next = { ...base, ...(song || {}) };
  next.order = Array.isArray(next.order) && next.order.length ? next.order : [0];
  next.patterns = Array.isArray(next.patterns) && next.patterns.length ? next.patterns : base.patterns;
  next.instruments = Array.isArray(next.instruments) && next.instruments.length ? next.instruments : base.instruments;
  next.metadata = { ...(base.metadata || {}), ...(next.metadata || {}) };
  next.metadata.patternPresets = Array.isArray(next.metadata.patternPresets) ? next.metadata.patternPresets : [];
  next.patterns.forEach((pattern) => {
    pattern.rows = Array.isArray(pattern.rows) ? pattern.rows : emptyRows();
    while (pattern.rows.length < ROWS_PER_PATTERN) pattern.rows.push({ cells: {} });
  });
  next.instruments.forEach(normalizeInstrument);
  return next;
}

function bindEvents({ plugin, api, logger, state, els }) {
  els.shell.addEventListener('click', async (event) => {
    const actionTarget = event.target?.closest?.('[data-action]');
    const action = actionTarget?.dataset?.action;
    if (!action) return;
    if (action === 'refresh') await refreshAssets({ state, els });
    if (action === 'import-music-to-res') {
      if (await confirmCanReplaceCurrentSong({ plugin, api, state, els })) {
        await pickAndImportMusicToRes({ plugin, api, state, els });
      }
    }
    if (action === 'create-empty') {
      if (await confirmCanReplaceCurrentSong({ plugin, api, state, els })) {
        await createEmptySong({ plugin, api, state, els });
      }
    }
    if (action === 'add-pattern') addPattern(state, els);
    if (action === 'delete-pattern') deleteSelectedPattern(state, els);
    if (action === 'set-piano-tool') setPianoTool(state, els, actionTarget?.dataset?.tool);
    if (action === 'select-piano-channel') selectPianoChannel(state, els, actionTarget?.dataset?.channel);
    if (action === 'toggle-channel-visibility') toggleChannelVisibility(state, els, actionTarget?.dataset?.channel);
    if (action === 'toggle-channel-mute') toggleChannelMute(state, els, actionTarget?.dataset?.channel);
    if (action === 'instrument-tab') switchInstrumentPanel(state, els, actionTarget?.dataset?.panel);
    if (action === 'test-instrument') testSelectedInstrument(state);
    if (action === 'save-pattern-preset') savePatternPreset(state, els);
    if (action === 'paste-pattern-preset') pastePatternPreset(state, els, actionTarget?.dataset?.presetId);
    if (action === 'delete-pattern-preset') deletePatternPreset(state, els, actionTarget?.dataset?.presetId);
    if (action === 'edit-external') await editExternalAsset({ plugin, api, state, els });
    if (action === 'save') await saveCurrentSong({ plugin, api, state, els });
    if (action === 'delete-current') await deleteCurrentAsset({ api, state, els });
    if (action === 'play') void playPreview({ plugin, api, state, els });
    if (action === 'stop') {
      stopPreview(state);
      renderEditorMode(state, els);
    }
    if (action === 'validate') await validateViaMain(plugin, api, state, els);
    if (action === 'undo') restoreHistory(state, els, 'undo');
    if (action === 'redo') restoreHistory(state, els, 'redo');
  });
  els.assetTree.addEventListener('click', (event) => {
    const fileToggle = event.target?.closest('[data-file-toggle]');
    if (fileToggle) {
      const file = fileToggle.dataset.fileToggle || '';
      if (state.expandedFiles.has(file)) state.expandedFiles.delete(file);
      else state.expandedFiles.add(file);
      renderAssetTree(state, els);
      return;
    }
    const key = event.target?.closest('[data-asset-key]')?.dataset?.assetKey;
    if (key) void requestSelectAsset(key, { plugin, api, state, els });
  });
  els.resFilter.addEventListener('change', () => {
    state.fileFilter = els.resFilter.value;
    renderAssetTree(state, els);
  });
  els.keyword.addEventListener('input', () => {
    state.keyword = els.keyword.value;
    renderAssetTree(state, els);
  });
  els.viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.viewMode = button.dataset.view || 'tracker';
      renderEditorMode(state, els);
    });
  });
  els.pianoLayers.addEventListener('change', () => {
    state.showPianoLayers = els.pianoLayers.checked;
    renderPianoRoll(state, els);
  });
  els.columnResizers.forEach((resizer) => {
    resizer.addEventListener('pointerdown', (event) => startColumnResize(event, state, els, resizer.dataset.resizeColumn));
  });
  els.fields.forEach((field) => {
    field.addEventListener('change', () => {
      if (!state.editable) return;
      pushUndo(state);
      const key = field.dataset.field;
      state.song[key] = field.type === 'number' ? Number(field.value) : field.value;
      state.dirty = true;
      renderAll(state, els);
    });
  });
}

function applyColumnWidths(state, els) {
  if (!els.layout) return;
  els.layout.style.setProperty('--md-bgm-left', `${Math.round(state.leftColumnWidth)}px`);
  els.layout.style.setProperty('--md-bgm-right', `${Math.round(state.rightColumnWidth)}px`);
}

function startColumnResize(event, state, els, side) {
  if (!['left', 'right'].includes(side)) return;
  event.preventDefault();
  const startX = event.clientX;
  const startLeft = state.leftColumnWidth;
  const startRight = state.rightColumnWidth;
  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    if (side === 'left') {
      state.leftColumnWidth = clampNumber(startLeft + dx, 220, 560);
    } else {
      state.rightColumnWidth = clampNumber(startRight - dx, 260, 620);
    }
    applyColumnWidths(state, els);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  window.addEventListener('pointercancel', up, { once: true });
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function setupPageAutoRefresh(pageRoot, state, els) {
  if (!pageRoot || typeof MutationObserver === 'undefined') return null;
  let wasActive = pageRoot.classList.contains('active');
  const observer = new MutationObserver(() => {
    const active = pageRoot.classList.contains('active');
    if (active && !wasActive) {
      void refreshAssets({ state, els, preserveDirty: true });
    }
    wasActive = active;
  });
  observer.observe(pageRoot, { attributes: true, attributeFilter: ['class'] });
  return observer;
}

async function requestSelectAsset(key, { plugin, api, state, els } = {}) {
  if (!key || key === state.selectedKey || !state.dirty) {
    return selectAsset(key, { state, els, plugin, api });
  }
  const ok = await confirmCanReplaceCurrentSong({ plugin, api, state, els });
  if (!ok) {
    renderAssetTree(state, els);
    return { ok: false, canceled: true };
  }
  return selectAsset(key, { state, els, plugin, api });
}

async function confirmCanReplaceCurrentSong({ plugin, api, state, els }) {
  if (!state.dirty) return true;
  const decision = await confirmUnsavedAssetSwitch(api, state.song);
  if (decision === 'cancel') {
    renderAssetTree(state, els);
    setStatus(state, els, '操作をキャンセルしました。');
    return false;
  }
  if (decision === 'save') {
    const saved = await saveCurrentSong({ plugin, api, state, els });
    if (!saved?.ok) {
      renderAssetTree(state, els);
      return false;
    }
  } else {
    state.dirty = false;
  }
  return true;
}

async function refreshAssets({ state, els, preserveDirty = false }) {
  setStatus(state, els, 'BGM 定義を読み込み中...');
  const result = await state.api.electronAPI.listResDefinitions();
  if (!result?.ok) {
    setStatus(state, els, `読み込み失敗: ${result?.error || 'unknown'}`);
    return result;
  }
  state.resRoot = result.resRoot || '';
  state.resFiles = (result.files || []).map((file) => ({
    ...file,
    entries: (file.entries || []).filter((entry) => ['XGM', 'XGM2'].includes(String(entry.type || '').toUpperCase())),
  }));
  state.resFiles.forEach((file) => state.expandedFiles.add(file.file));
  await annotateIntermediateAvailability(state);
  if (!state.fileFilter || !state.resFiles.some((file) => file.file === state.fileFilter)) {
    state.fileFilter = state.resFiles[0]?.file || '';
  }
  if (!state.selectedKey || !findAssetByKey(state, state.selectedKey)) {
    const first = state.resFiles.flatMap((file) => file.entries.map((entry) => assetKey(file.file, entry)))[0] || '';
    state.selectedKey = first;
  }
  renderResFilter(state, els);
  renderAssetTree(state, els);
  if (preserveDirty && state.dirty && state.selectedKey && findAssetByKey(state, state.selectedKey)) {
    state.selectedAsset = findAssetByKey(state, state.selectedKey);
    renderAll(state, els);
  } else if (state.selectedKey) await selectAsset(state.selectedKey, { state, els });
  else {
    clearEditorSelection(state, 'BGM 定義がありません。');
    renderAll(state, els);
  }
  setStatus(state, els, `BGM ${countAssets(state)} 件`);
  return result;
}

function renderResFilter(state, els) {
  els.resFilter.innerHTML = state.resFiles.map((file) => `<option value="${esc(file.file)}">${esc(file.file)}</option>`).join('');
  els.resFilter.value = state.fileFilter;
}

function renderAssetTree(state, els) {
  const keyword = String(state.keyword || '').trim().toLowerCase();
  const files = state.resFiles
    .filter((file) => !state.fileFilter || file.file === state.fileFilter)
    .map((file) => ({
      ...file,
      entries: file.entries.filter((entry) => {
        if (!keyword) return true;
        return [entry.name, entry.type, entry.sourcePath, ...(entry.files || [])]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      }),
    }));
  if (!files.length || files.every((file) => file.entries.length === 0)) {
    els.assetTree.innerHTML = '<div class="md-bgm-empty">XGM/XGM2 定義がありません</div>';
    return;
  }
  els.assetTree.innerHTML = files.map((file) => {
    const expanded = state.expandedFiles.has(file.file);
    return `
      <section class="md-bgm-res-file">
        <button type="button" class="md-bgm-res-title" data-file-toggle="${esc(file.file)}">
          <span>${expanded ? '▾' : '▸'}</span>
          <strong>${esc(file.file)}</strong>
          <span>${file.entries.length}</span>
        </button>
      ${expanded ? file.entries.map((entry) => {
        const key = assetKey(file.file, entry);
        const source = entry.sourcePath || entry.files?.[0] || '';
        const active = key === state.selectedKey;
        return `
          <div class="md-bgm-asset ${active ? 'active' : ''}" data-asset-key="${esc(key)}" role="button" tabindex="0">
            <div class="md-bgm-asset-meta">
              <span>${esc(entry.name || '')}${active && state.dirty ? ' *' : ''}</span>
              <small>${esc(entry.type || '')} ${esc(source)}</small>
              <em>${entry.intermediateAvailable ? '編集可' : 'プレビュー専用'}</em>
            </div>
            ${active ? `
              <div class="md-bgm-asset-actions">
                <button type="button" class="md-bgm-asset-icon md-bgm-primary" data-action="save" title="保存" aria-label="保存">
                  <svg class="icon"><use href="#icon-save"></use></svg>
                </button>
                <button type="button" class="md-bgm-asset-icon md-bgm-danger" data-action="delete-current" title="削除" aria-label="削除">
                  <svg class="icon"><use href="#icon-trash"></use></svg>
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('') : ''}
      </section>
    `;
  }).join('');
}

async function selectAsset(key, { state, els, plugin, api } = {}) {
  stopPreview(state);
  state.selectedKey = key || '';
  state.selectedAsset = findAssetByKey(state, key);
  state.pendingNew = false;
  state.selectedExternal = false;
  state.editable = true;
  state.dirty = false;
  renderAssetTree(state, els);
  const selected = state.selectedAsset;
  if (!selected) {
    clearEditorSelection(state, 'BGM 定義がありません。');
    renderAll(state, els);
    return;
  }
  const entry = selected.entry;
  const jsonPath = getJsonSidecarPath(state, entry);
  const jsonSong = await readSongJson(state.api, jsonPath);
  if (jsonSong) {
    state.song = normalizeSong(jsonSong);
    state.diagnostics = [];
    state.status = `読み込みました: ${entry.name}`;
  } else {
    state.song = createDefaultSong({ symbol: entry.name, title: entry.name });
    state.selectedExternal = true;
    state.editable = false;
    state.diagnostics = [{ level: 'warn', code: 'external-preview-only', message: '中間ファイルがないためプレビュー専用です。編集時に近似復元します。' }];
    state.status = `プレビュー専用: ${entry.name}`;
  }
  state.song.symbol = normalizeSymbol(entry.name || state.song.symbol);
  selectOrderIndex(state, 0);
  renderAll(state, els);
}

function clearEditorSelection(state, status = '') {
  stopPreview(state);
  state.selectedKey = '';
  state.selectedAsset = null;
  state.pendingNew = false;
  state.selectedExternal = false;
  state.editable = false;
  state.dirty = false;
  state.song = createDefaultSong({ title: '', symbol: 'bgm_001' });
  state.selectedPattern = 0;
  state.selectedOrderIndex = 0;
  state.selectedCell = { row: 0, channel: 'FM1' };
  state.pianoSelection = null;
  state.pianoDrag = null;
  state.playbackRow = -1;
  state.allocations = [];
  state.diagnostics = status ? [{ level: 'info', code: 'no-bgm-asset', message: status }] : [];
  state.status = status;
}

async function readSongJson(api, absPath) {
  if (!absPath) return null;
  const read = await api.electronAPI.readFileAsDataUrl(absPath).catch(() => null);
  if (!read?.ok || !read.dataUrl) return null;
  try {
    return JSON.parse(dataUrlToText(read.dataUrl));
  } catch {
    return null;
  }
}

function dataUrlToText(dataUrl) {
  const body = String(dataUrl || '').split(',')[1] || '';
  return decodeURIComponent(escape(atob(body)));
}

async function pickAndImportMusicToRes(args) {
  const result = await args.api.electronAPI.pickFile({
    title: 'BGM アセットを選択',
    properties: ['openFile'],
    filters: [
      { name: 'Music', extensions: ['mid', 'midi', 'vgm', 'xgm'] },
      { name: 'MIDI', extensions: ['mid', 'midi'] },
      { name: 'VGM/XGM', extensions: ['vgm', 'xgm'] },
    ],
  });
  if (result?.canceled || !result?.sourcePath) return;
  await importMusicToRes({ ...args, sourcePath: result.sourcePath, symbol: normalizeSymbol(result.fileName || getFileName(result.sourcePath) || 'bgm') });
}

async function importMusicToRes({ plugin, api, state, els, sourcePath, symbol, resFile }) {
  const ext = getExtension(sourcePath);
  if (ext === '.mid' || ext === '.midi') {
    return importMidiViaConverterToRes({ plugin, api, state, els, sourcePath, symbol, resFile });
  }
  if (ext === '.vgm' || ext === '.xgm') {
    return importMusicFileToRes({ api, state, els, sourcePath, symbol, resFile, ext });
  }
  setStatus(state, els, 'MIDI/VGM/XGM ファイルを選択してください。');
  return { ok: false, error: 'unsupported music file' };
}

async function importMidiViaConverterToRes({ api, state, els, sourcePath, symbol, resFile }) {
  const targetRes = resFile || state.fileFilter || state.resFiles[0]?.file || 'resources.res';
  const safeSymbol = normalizeSymbol(symbol || getFileName(sourcePath) || 'bgm');
  setStatus(state, els, 'MIDI を VGM へ変換中...');
  const converter = api.capabilities?.get?.('midi-convert-ui');
  const converted = converter?.convertMidiMusic
    ? await converter.convertMidiMusic({
      sourcePath,
      symbol: safeSymbol,
      targetSubdir: 'music',
      targetFileName: safeSymbol,
      outputs: { vgm: true, xgm: false, registerAsset: false },
    })
    : await invokeMidiConverterHook(api, {
      sourcePath,
      symbol: safeSymbol,
      targetSubdir: 'music',
      targetFileName: safeSymbol,
      outputs: { vgm: true, xgm: false, registerAsset: false },
    });
  if (!converted?.ok || !converted.files?.vgm) {
    setStatus(state, els, converted?.error || 'MIDI 変換に失敗しました。');
    return converted || { ok: false, error: 'midi convert failed' };
  }
  const relativePath = stripResPrefix(converted.files.vgm);
  const entry = {
    type: 'XGM2',
    name: safeSymbol,
    sourcePath: relativePath,
    files: [relativePath],
    options: '',
  };
  const added = await addMusicEntry({ api, state, els, resFile: targetRes, entry });
  if (!added?.ok) return added;
  await refreshAndSelectEntry({ state, els, resFile: targetRes, symbol: safeSymbol });
  const imported = await state.api.plugins.invokeHook(state.plugin.id, 'importMidi', { sourcePath, symbol: safeSymbol });
  const importedBody = imported?.result || imported;
  if (importedBody?.ok) {
    state.song = normalizeSong(importedBody.song);
    state.song.symbol = safeSymbol;
    state.allocations = importedBody.allocations || [];
    state.diagnostics = [
      ...(importedBody.diagnostics || []),
      ...(converted.diagnostics || []),
      ...(converted.warnings || []).map((message) => ({ level: 'warn', code: 'midi-converter-warning', message })),
    ];
    state.selectedExternal = false;
    state.editable = true;
    state.dirty = true;
    await saveCurrentSong({ plugin: state.plugin, api, state, els, forceResFile: targetRes });
  } else {
    state.diagnostics = converted.diagnostics || [];
    state.allocations = [];
  }
  setStatus(state, els, `MIDI を変換して登録しました: ${safeSymbol}`);
  return { ...converted, asset: entry };
}

async function invokeMidiConverterHook(api, payload) {
  const result = await api.plugins.invokeHook('midi-converter', 'convertMidiMusic', payload);
  return result?.result || result;
}

async function importMusicFileToRes({ api, state, els, sourcePath, symbol, resFile, ext }) {
  const targetRes = resFile || state.fileFilter || state.resFiles[0]?.file || 'resources.res';
  const safeSymbol = normalizeSymbol(symbol || getFileName(sourcePath) || 'bgm');
  const normalizedExt = ext === '.xgm' ? '.xgm' : '.vgm';
  const copy = await api.electronAPI.writeAssetFile({
    sourcePath,
    targetSubdir: 'music',
    targetFileName: `${safeSymbol}${normalizedExt}`,
  });
  if (!copy?.ok) {
    setStatus(state, els, `コピー失敗: ${copy?.error || 'unknown'}`);
    return copy;
  }
  const relativePath = stripResPrefix(copy.relativePath);
  const entry = normalizedExt === '.xgm'
    ? { type: 'XGM', name: safeSymbol, sourcePath: relativePath, timing: 'AUTO', options: '' }
    : { type: 'XGM2', name: safeSymbol, sourcePath: relativePath, files: [relativePath], options: '' };
  const added = await addMusicEntry({ api, state, els, resFile: targetRes, entry });
  if (!added?.ok) return added;
  state.diagnostics = [];
  state.allocations = [];
  await refreshAndSelectEntry({ state, els, resFile: targetRes, symbol: safeSymbol });
  setStatus(state, els, `${entry.type} アセットを登録しました: ${safeSymbol}`);
  return { ok: true, asset: entry, file: copy.relativePath };
}

async function addMusicEntry({ api, state, els, resFile, entry }) {
  const duplicate = state.resFiles
    .flatMap((file) => file.entries || [])
    .some((item) => item.name === entry.name);
  if (duplicate) {
    const message = `同名の BGM 定義があります: ${entry.name}`;
    setStatus(state, els, message);
    return { ok: false, error: message };
  }
  const added = await api.electronAPI.addResEntry({ file: resFile, entry });
  if (!added?.ok) {
    setStatus(state, els, `アセット登録失敗: ${added?.error || 'unknown'}`);
  }
  return added;
}

async function refreshAndSelectEntry({ state, els, resFile, symbol }) {
  await refreshAssets({ state, els });
  const file = state.resFiles.find((item) => item.file === resFile);
  const created = file?.entries.find((item) => item.name === symbol);
  if (created) await selectAsset(assetKey(resFile, created), { state, els });
}

async function importMidiToRes({ plugin, api, state, els, sourcePath, symbol, resFile }) {
  if (!(await confirmCanReplaceCurrentSong({ plugin, api, state, els }))) {
    return { ok: false, canceled: true };
  }
  const targetRes = resFile || state.fileFilter || state.resFiles[0]?.file || 'resources.res';
  const safeSymbol = normalizeSymbol(symbol || sourcePath.split(/[\\/]/).pop() || 'bgm');
  const result = await api.plugins.invokeHook(plugin.id, 'importMidi', { sourcePath, symbol: safeSymbol });
  const body = result?.result || result;
  if (!body?.ok) {
    setStatus(state, els, body?.error || 'MIDI import に失敗しました。');
    return body;
  }
  state.song = normalizeSong(body.song);
  state.song.symbol = safeSymbol;
  state.song.title = state.song.title || safeSymbol;
  state.allocations = body.allocations || [];
  state.diagnostics = body.diagnostics || [];
  state.selectedAsset = { file: { file: targetRes }, entry: null };
  state.selectedKey = '';
  state.pendingNew = true;
  state.selectedExternal = false;
  state.editable = true;
  state.dirty = true;
  selectOrderIndex(state, 0);
  renderAll(state, els);
  await saveCurrentSong({ plugin, api, state, els, forceResFile: targetRes });
  return body;
}

async function createEmptySong({ plugin, api, state, els }) {
  const targetRes = state.fileFilter || state.resFiles[0]?.file || 'resources.res';
  const symbol = nextDefaultSymbol(state);
  state.song = normalizeSong(createDefaultSong({ symbol, title: symbol }));
  state.allocations = [];
  state.diagnostics = [];
  state.selectedAsset = { file: { file: targetRes }, entry: null };
  state.selectedKey = '';
  state.pendingNew = true;
  state.selectedExternal = false;
  state.editable = true;
  state.dirty = true;
  selectOrderIndex(state, 0);
  renderAll(state, els);
  await saveCurrentSong({ plugin, api, state, els, forceResFile: targetRes });
}

async function editExternalAsset({ plugin, api, state, els }) {
  const selected = state.selectedAsset;
  const entry = selected?.entry;
  const sourcePath = getMusicSourceAbsolutePath(state, entry);
  if (!entry || !sourcePath) {
    setStatus(state, els, '復元できる VGM/XGM がありません。');
    return { ok: false, error: 'source not found' };
  }
  const ok = await confirmLossyRestore(api, entry);
  if (!ok) return { ok: false, canceled: true };
  setStatus(state, els, '近似復元中...');
  const result = await api.plugins.invokeHook(plugin.id, 'analyzeVgm', { sourcePath, symbol: entry.name });
  const body = result?.result || result;
  if (!body?.ok) {
    state.diagnostics = [{ level: 'error', code: 'music-analyze-failed', message: body?.error || '近似復元に失敗しました。' }];
    renderAll(state, els);
    return body;
  }
  state.song = normalizeSong(body.song);
  state.song.symbol = normalizeSymbol(entry.name || state.song.symbol);
  state.diagnostics = body.diagnostics || [];
  state.selectedExternal = false;
  state.editable = true;
  state.dirty = true;
  selectOrderIndex(state, 0);
  renderAll(state, els);
  return saveCurrentSong({ plugin, api, state, els, forceResFile: selected.file.file });
}

function confirmLossyRestore(api, entry) {
  return new Promise((resolve) => {
    const modal = api.createModal({
      id: 'md-bgm-composer-lossy-restore',
      panelClassName: 'app-panel app-panel-sm',
      html: `
        <div class="md-bgm-modal">
          <h2>近似復元</h2>
          <p>${esc(entry.name)} を VGM/XGM から中間形式へ逆変換します。</p>
          <p>音色、effect、細かなタイミングは完全には復元できません。</p>
          <div class="md-bgm-modal-actions">
            <button type="button" class="md-bgm-btn" data-role="cancel">キャンセル</button>
            <button type="button" class="md-bgm-btn primary" data-role="ok">復元して編集</button>
          </div>
        </div>
      `,
    });
    modal.panel.querySelector('[data-role="cancel"]')?.addEventListener('click', () => {
      modal.close();
      resolve(false);
    }, { once: true });
    modal.panel.querySelector('[data-role="ok"]')?.addEventListener('click', () => {
      modal.close();
      resolve(true);
    }, { once: true });
    modal.open();
  });
}

function confirmUnsavedAssetSwitch(api, song) {
  return new Promise((resolve) => {
    const modal = api.createModal({
      id: 'md-bgm-composer-unsaved-switch',
      panelClassName: 'app-panel app-panel-sm',
      html: `
        <div class="md-bgm-modal">
          <h2>未保存の変更</h2>
          <p>${esc(song?.title || song?.symbol || '現在のBGM')} に未保存の変更があります。</p>
          <p>別のアセットを開く前に、変更を保存するか破棄してください。</p>
          <div class="md-bgm-modal-actions">
            <button type="button" class="md-bgm-btn" data-role="cancel">キャンセル</button>
            <button type="button" class="md-bgm-btn danger" data-role="discard">破棄して開く</button>
            <button type="button" class="md-bgm-btn primary" data-role="save">保存して開く</button>
          </div>
        </div>
      `,
    });
    const finish = (decision) => {
      modal.close();
      resolve(decision);
    };
    modal.panel.querySelector('[data-role="cancel"]')?.addEventListener('click', () => finish('cancel'), { once: true });
    modal.panel.querySelector('[data-role="discard"]')?.addEventListener('click', () => finish('discard'), { once: true });
    modal.panel.querySelector('[data-role="save"]')?.addEventListener('click', () => finish('save'), { once: true });
    modal.open();
  });
}

function confirmDeleteAsset(api, entry) {
  return new Promise((resolve) => {
    const modal = api.createModal({
      id: 'md-bgm-composer-delete-asset',
      panelClassName: 'app-panel app-panel-sm',
      html: `
        <div class="md-bgm-modal">
          <h2>定義を削除</h2>
          <p>${esc(entry.name)} の .res 定義を削除します。</p>
          <p>生成済みの VGM/XGM と中間ファイルは削除しません。</p>
          <div class="md-bgm-modal-actions">
            <button type="button" class="md-bgm-btn" data-role="cancel">キャンセル</button>
            <button type="button" class="md-bgm-btn danger" data-role="ok">削除</button>
          </div>
        </div>
      `,
    });
    modal.panel.querySelector('[data-role="cancel"]')?.addEventListener('click', () => {
      modal.close();
      resolve(false);
    }, { once: true });
    modal.panel.querySelector('[data-role="ok"]')?.addEventListener('click', () => {
      modal.close();
      resolve(true);
    }, { once: true });
    modal.open();
  });
}

async function deleteCurrentAsset({ api, state, els }) {
  const selected = state.selectedAsset;
  if (!selected?.entry) {
    setStatus(state, els, '削除する BGM 定義を選択してください。');
    return { ok: false, error: 'no selection' };
  }
  const ok = await confirmDeleteAsset(api, selected.entry);
  if (!ok) return { ok: false, canceled: true };
  const result = await api.electronAPI.deleteResEntry({
    file: selected.file.file,
    lineNumber: selected.entry.lineNumber,
  });
  if (!result?.ok) {
    setStatus(state, els, `削除失敗: ${result?.error || 'unknown'}`);
    return result;
  }
  const deletedName = selected.entry.name;
  state.selectedKey = '';
  state.selectedAsset = null;
  state.pendingNew = false;
  state.selectedExternal = false;
  clearEditorSelection(state, '');
  await refreshAssets({ state, els });
  setStatus(state, els, `削除しました: ${deletedName}`);
  return result;
}

async function saveCurrentSong({ plugin, api, state, els, forceResFile } = {}) {
  if (!state.editable && !state.pendingNew) {
    setStatus(state, els, 'プレビュー専用です。編集するには近似復元してください。');
    return { ok: false, error: 'preview-only' };
  }
  const selected = state.selectedAsset;
  const existingEntry = selected?.entry || null;
  const symbol = normalizeSymbol(state.song.symbol || existingEntry?.name || 'bgm');
  const sourcePath = existingEntry?.sourcePath || existingEntry?.files?.[0] || `music/${symbol}.vgm`;
  const outputType = String(existingEntry?.type || 'XGM2').toUpperCase();
  const result = await api.plugins.invokeHook(plugin.id, 'exportMusic', {
    song: { ...state.song, symbol },
    symbol,
    sourcePath,
    outputs: { xgm: outputType === 'XGM', registerAsset: false },
  });
  const body = result?.result || result;
  if (!body?.ok) {
    setStatus(state, els, body?.error || '保存に失敗しました。');
    return body;
  }
  state.diagnostics = [...(body.diagnostics || []), ...(body.warnings || []).map((message) => ({ level: 'warn', code: 'save-warning', message }))];
  if (existingEntry) {
    existingEntry.intermediateAvailable = true;
    existingEntry.intermediatePath = body.files?.json || existingEntry.intermediatePath || '';
    renderAssetTree(state, els);
  }
  if (!existingEntry || state.pendingNew) {
    const resFile = forceResFile || selected?.file?.file || state.fileFilter || 'resources.res';
    const entry = {
      type: 'XGM2',
      name: symbol,
      sourcePath: body.files.vgm.replace(/^res\//, ''),
      files: [body.files.vgm.replace(/^res\//, '')],
      options: '',
    };
    const added = await api.electronAPI.addResEntry({ file: resFile, entry });
    if (!added?.ok) {
      setStatus(state, els, `アセット登録失敗: ${added?.error || 'unknown'}`);
      return added;
    }
    state.pendingNew = false;
    await refreshAssets({ state, els });
    const file = state.resFiles.find((item) => item.file === resFile);
    const created = file?.entries.find((item) => item.name === symbol);
    if (created) await selectAsset(assetKey(resFile, created), { state, els });
  }
  state.dirty = false;
  setStatus(state, els, `保存しました: ${symbol}`);
  renderAll(state, els);
  return body;
}

function renderAll(state, els) {
  renderStatus(state, els);
  renderEditableState(state, els);
  renderSongFields(state, els);
  renderPatterns(state, els);
  renderEditorMode(state, els);
  renderInstrumentEditor(state, els);
  renderDiagnostics(state, els);
  renderAllocations(state, els);
}

function renderEditableState(state, els) {
  if (els.externalNotice) els.externalNotice.hidden = !state.selectedExternal;
  if (els.editExternal) els.editExternal.hidden = !state.selectedExternal;
  els.fields.forEach((field) => { field.disabled = !state.editable; });
}

function renderStatus(state, els) {
  els.status.textContent = state.status || `${state.song.title} / ${state.song.symbol}${state.dirty ? ' *' : ''}`;
}

function setStatus(state, els, text) {
  state.status = text;
  renderStatus(state, els);
}

function renderSongFields(state, els) {
  els.fields.forEach((field) => {
    const value = state.song[field.dataset.field];
    if (String(field.value) !== String(value ?? '')) field.value = value ?? '';
  });
}

function renderPatterns(state, els) {
  els.patterns.innerHTML = '';
  state.song.order.forEach((patternId, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `md-bgm-pattern${index === getSelectedOrderIndex(state) ? ' active' : ''}`;
    button.textContent = `${String(index).padStart(2, '0')}: P${String(patternId).padStart(2, '0')}`;
    button.addEventListener('click', () => {
      selectOrderIndex(state, index);
      renderPatterns(state, els);
      renderEditorMode(state, els);
    });
    els.patterns.appendChild(button);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'md-bgm-pattern action';
  add.dataset.action = 'add-pattern';
  add.title = 'パターン追加';
  add.setAttribute('aria-label', 'パターン追加');
  add.textContent = '＋';
  els.patterns.appendChild(add);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'md-bgm-pattern danger';
  remove.dataset.action = 'delete-pattern';
  remove.title = 'パターン削除';
  remove.setAttribute('aria-label', 'パターン削除');
  remove.textContent = '－';
  remove.disabled = state.song.order.length <= 1;
  els.patterns.appendChild(remove);
}

function renderEditorMode(state, els) {
  els.viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === state.viewMode));
  els.trackerWrap.hidden = state.viewMode !== 'tracker';
  els.pianoWrap.hidden = state.viewMode !== 'piano';
  if (state.viewMode === 'piano') renderPianoRoll(state, els);
  else renderTracker(state, els);
}

function renderTracker(state, els) {
  const pattern = getSelectedPattern(state);
  const header = `<thead><tr><th>Row</th>${CHANNELS.map((id) => `
    <th class="${state.channelMute[id] ? 'is-muted' : ''}">
      <button type="button" class="md-bgm-channel-mute" data-action="toggle-channel-mute" data-channel="${id}" title="${state.channelMute[id] ? 'ミュート解除' : 'ミュート'}">${state.channelMute[id] ? '×' : '♪'}</button>
      <span>${id}</span>
    </th>`).join('')}</tr></thead>`;
  const body = pattern.rows.map((row, rowIndex) => {
    const cells = CHANNELS.map((channelId) => {
      const cell = row.cells?.[channelId] || {};
      const value = cell.note ? `${cell.note} ${cell.instrument || ''} ${cell.effect || ''}`.trim() : '';
      const selected = state.selectedCell?.row === rowIndex && state.selectedCell?.channel === channelId;
      return `<td class="${selected ? 'is-selected' : ''} ${state.channelMute[channelId] ? 'is-muted' : ''}">
        <div class="md-bgm-tracker-cell-display">${renderTrackerCellParts(cell)}</div>
        <input data-row="${rowIndex}" data-channel="${channelId}" value="${escapeHtml(value)}" placeholder="---" ${state.editable ? '' : 'disabled'}>
      </td>`;
    }).join('');
    const classes = [
      rowIndex === state.playbackRow ? 'is-playing' : '',
      rowIndex > 0 && rowIndex % 8 === 0 ? 'row-group-boundary' : '',
    ].filter(Boolean).join(' ');
    return `<tr class="${classes}" data-row-index="${rowIndex}"><th>${String(rowIndex).padStart(2, '0')}</th>${cells}</tr>`;
  }).join('');
  els.tracker.innerHTML = `${header}<tbody>${body}</tbody>`;
  els.tracker.querySelectorAll('input').forEach((input) => {
    input.addEventListener('focus', () => {
      state.selectedCell = { row: Number(input.dataset.row), channel: input.dataset.channel };
      els.tracker.querySelectorAll('td.is-selected').forEach((td) => td.classList.remove('is-selected'));
      input.closest('td')?.classList.add('is-selected');
    });
    input.addEventListener('keydown', (event) => {
      handleTrackerKeydown(event, state, els);
    });
    input.addEventListener('change', () => {
      if (!state.editable) return;
      pushUndo(state);
      updateCellFromText(state, pattern, Number(input.dataset.row), input.dataset.channel, input.value);
      state.dirty = true;
      renderAll(state, els);
    });
  });
}

function renderTrackerCellParts(cell) {
  if (!cell?.note) {
    return '<span class="md-bgm-cell-empty">... .. ...</span>';
  }
  return `
    <span class="md-bgm-cell-note">${escapeHtml(cell.note || '...')}</span>
    <span class="md-bgm-cell-inst">${escapeHtml(formatInstrumentToken(cell.instrument))}</span>
    <span class="md-bgm-cell-effect">${escapeHtml(cell.effect || '...')}</span>
  `;
}

function formatInstrumentToken(instrumentId) {
  if (!instrumentId) return '..';
  const compact = String(instrumentId).replace(/^(fm_|psg_|noise_)/, '');
  return compact.slice(0, 2).padEnd(2, '.');
}

function renderPianoRoll(state, els) {
  const pattern = getSelectedPattern(state);
  els.pianoLayers.checked = state.showPianoLayers;
  renderPianoTools(state, els);
  renderPianoChannelTabs(state, els);
  const header = `<div class="md-bgm-piano-row header"><span class="md-bgm-piano-corner"></span>${pattern.rows.map((_, row) => `<button type="button" class="${pianoColumnClass(row)} ${state.pianoHover?.row === row ? 'is-hover-col' : ''}" data-piano-row="${row}" data-piano-note="">${row}</button>`).join('')}</div>`;
  const rows = PIANO_NOTES.map((midiNote) => {
    const note = midiNoteToName(midiNote);
    const black = note.includes('#');
    const octave = note.startsWith('C') ? 'octave-boundary' : '';
    const cells = pattern.rows.map((row, rowIndex) => {
      const active = Number(row.cells?.[state.pianoChannel]?.midiNote) === midiNote;
      const ghosts = state.showPianoLayers ? getPianoGhostChannels(state, row, midiNote, state.pianoChannel) : [];
      const selected = isPianoCellSelected(state, rowIndex, midiNote);
      const hoverCol = state.pianoHover?.row === rowIndex;
      const hoverRow = state.pianoHover?.note === midiNote;
      const classes = [pianoColumnClass(rowIndex), active ? 'active' : '', selected ? 'is-selected' : '', hoverCol ? 'is-hover-col' : '', hoverRow ? 'is-hover-row' : '', hoverCol && hoverRow ? 'is-hover-cell' : '', rowIndex === state.playbackRow ? 'is-playing' : '', ghosts.length ? 'has-ghost' : ''].filter(Boolean).join(' ');
      const ghostHtml = ghosts.map((channelId) => `<i class="md-bgm-piano-ghost ${escapeHtml(channelClass(channelId))}" title="${escapeHtml(channelId)}"></i>`).join('');
      return `<button type="button" class="${classes}" data-piano-row="${rowIndex}" data-piano-cell-row="${rowIndex}" data-piano-note="${midiNote}" title="${note} row ${rowIndex}" ${state.editable ? '' : 'disabled'}>${ghostHtml}</button>`;
    }).join('');
    return `<div class="md-bgm-piano-row ${black ? 'black-key' : 'white-key'} ${octave} ${state.pianoHover?.note === midiNote ? 'is-hover-row' : ''}" data-piano-note-row="${midiNote}"><span class="md-bgm-piano-key ${black ? 'black' : 'white'} ${state.pianoHover?.note === midiNote ? 'is-hover-row' : ''}" data-piano-key-note="${midiNote}">${note}</span>${cells}</div>`;
  }).join('');
  els.pianoGrid.innerHTML = header + rows;
  els.pianoGrid.tabIndex = 0;
  els.pianoGrid.querySelectorAll('[data-piano-note]').forEach((button) => {
    button.addEventListener('contextmenu', (event) => handlePianoContextMenu(event, state, els));
    button.addEventListener('pointerdown', (event) => handlePianoPointerDown(event, state, els));
    button.addEventListener('pointerenter', (event) => handlePianoPointerEnter(event, state, els));
  });
  els.pianoGrid.onpointermove = (event) => handlePianoPointerMove(event, state, els);
  els.pianoGrid.onpointerleave = () => clearPianoHover(state, els);
  els.pianoGrid.onpointerup = (event) => handlePianoPointerUp(event, state, els);
  els.pianoGrid.onpointercancel = () => {
    state.pianoDrag = null;
    renderPianoSelection(els, state);
  };
  els.pianoGrid.onkeydown = (event) => handlePianoKeydown(event, state, els);
  renderPianoSelection(els, state);
}

function renderPianoTools(state, els) {
  els.pianoTools.innerHTML = [
    { tool: 'draw', title: '描画', icon: '<path d="M4 20l4.5-1 10-10-3.5-3.5-10 10L4 20zM14 5l3.5 3.5" />' },
    { tool: 'erase', title: '消去', icon: '<path d="M4 15l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-6 6H6l-2-3zM10 18h10" />' },
    { tool: 'select', title: '範囲選択', icon: '<rect x="5" y="5" width="14" height="14" rx="1" />' },
  ].map(({ tool, title, icon }) => `
    <button type="button" class="md-bgm-piano-tool ${state.pianoTool === tool ? 'active' : ''}" data-action="set-piano-tool" data-tool="${tool}" title="${title}" aria-label="${title}" aria-pressed="${state.pianoTool === tool ? 'true' : 'false'}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
    </button>
  `).join('');
}

function handlePianoContextMenu(event, state, els) {
  event.preventDefault();
  if (!state.editable) return;
  const cell = event.target?.closest?.('[data-piano-note]');
  const point = pianoPointFromElement(cell);
  if (!point) return;
  pushUndo(state);
  deletePianoNoteAt(state, point.row, point.note);
  setPianoSelection(state, point, point);
  state.dirty = true;
  renderAll(state, els);
}

function handlePianoPointerDown(event, state, els) {
  if (!state.editable || event.button !== 0) return;
  const cell = event.target?.closest?.('[data-piano-note]');
  const point = pianoPointFromElement(cell);
  if (!point) return;
  event.preventDefault();
  els.pianoGrid.focus?.();
  if (state.pianoTool === 'draw') {
    pushUndo(state);
    togglePianoNoteAt(state, point.row, point.note);
    state.pianoSelection = null;
    state.dirty = true;
    renderAll(state, els);
    return;
  }
  if (state.pianoTool === 'erase') {
    pushUndo(state);
    deletePianoNoteAt(state, point.row, point.note);
    state.pianoDrag = { tool: 'erase', anchor: point, current: point, moved: false };
    state.pianoSelection = null;
    state.dirty = true;
    cell.setPointerCapture?.(event.pointerId);
    return;
  }
  state.pianoDrag = { tool: 'select', anchor: point, current: point, moved: false };
  setPianoSelection(state, point, point);
  renderPianoSelection(els, state);
  cell.setPointerCapture?.(event.pointerId);
}

function handlePianoPointerEnter(event, state, els) {
  const point = pianoPointFromElement(event.target?.closest?.('[data-piano-note]'));
  if (!point) return;
  setPianoHover(state, els, point);
  if (!state.pianoDrag || !state.editable) return;
  updatePianoDragToPoint(point, state, els);
}

function handlePianoPointerMove(event, state, els) {
  const hoverPoint = pianoPointFromPointer(event);
  if (hoverPoint) setPianoHover(state, els, hoverPoint);
  if (!state.pianoDrag || !state.editable) return;
  const point = hoverPoint;
  if (!point) return;
  updatePianoDragToPoint(point, state, els);
}

function updatePianoDragToPoint(point, state, els) {
  if (state.pianoDrag.tool === 'erase') {
    deletePianoNoteAt(state, point.row, point.note);
    state.pianoDrag.current = point;
    state.pianoDrag.moved = true;
    state.dirty = true;
    return;
  }
  if (point.row !== state.pianoDrag.current.row || point.note !== state.pianoDrag.current.note) {
    state.pianoDrag.current = point;
    state.pianoDrag.moved = true;
    setPianoSelection(state, state.pianoDrag.anchor, point);
    renderPianoSelection(els, state);
  }
}

function handlePianoPointerUp(event, state, els) {
  if (!state.pianoDrag) return;
  const drag = state.pianoDrag;
  state.pianoDrag = null;
  if (drag.tool === 'erase') {
    renderAll(state, els);
    return;
  }
  if (drag.moved) {
    renderPianoSelection(els, state);
    return;
  }
  setPianoSelection(state, drag.anchor, drag.anchor);
  renderPianoSelection(els, state);
}

function handlePianoKeydown(event, state, els) {
  if (!state.editable || state.viewMode !== 'piano') return;
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    deletePianoSelection(state, els);
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const rowDelta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const noteDelta = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    movePianoSelection(state, els, rowDelta, noteDelta);
  }
}

function pianoPointFromElement(element) {
  if (!element || !element.dataset?.pianoNote) return null;
  const note = Number(element.dataset.pianoNote);
  const row = Number(element.dataset.pianoRow);
  if (!Number.isFinite(note) || !note || !Number.isFinite(row)) return null;
  return { row, note };
}

function pianoPointFromPointer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-piano-note]');
  return pianoPointFromElement(element);
}

function setPianoSelection(state, anchor, current) {
  const rowMin = Math.max(0, Math.min(anchor.row, current.row));
  const rowMax = Math.min(ROWS_PER_PATTERN - 1, Math.max(anchor.row, current.row));
  const noteMin = Math.min(anchor.note, current.note);
  const noteMax = Math.max(anchor.note, current.note);
  state.pianoSelection = { rowMin, rowMax, noteMin, noteMax };
}

function isPianoCellSelected(state, row, note) {
  const selection = state.pianoSelection;
  return Boolean(selection
    && row >= selection.rowMin
    && row <= selection.rowMax
    && note >= selection.noteMin
    && note <= selection.noteMax);
}

function renderPianoSelection(els, state) {
  els.pianoGrid.querySelectorAll('[data-piano-note]').forEach((button) => {
    const point = pianoPointFromElement(button);
    if (point) button.classList.toggle('is-selected', isPianoCellSelected(state, point.row, point.note));
  });
  updatePianoSelectionRect(els, state);
  renderPianoHover(els, state);
}

function setPianoHover(state, els, point) {
  if (state.pianoHover?.row === point.row && state.pianoHover?.note === point.note) return;
  state.pianoHover = point;
  renderPianoHover(els, state);
}

function clearPianoHover(state, els) {
  if (!state.pianoHover) return;
  state.pianoHover = null;
  renderPianoHover(els, state);
}

function renderPianoHover(els, state) {
  const hover = state.pianoHover;
  els.pianoGrid.querySelectorAll('[data-piano-row]').forEach((element) => {
    element.classList.toggle('is-hover-col', Boolean(hover) && Number(element.dataset.pianoRow) === hover.row);
  });
  els.pianoGrid.querySelectorAll('[data-piano-note]').forEach((element) => {
    const point = pianoPointFromElement(element);
    const hoverCol = Boolean(hover) && point?.row === hover.row;
    const hoverRow = Boolean(hover) && point?.note === hover.note;
    element.classList.toggle('is-hover-col', hoverCol);
    element.classList.toggle('is-hover-row', hoverRow);
    element.classList.toggle('is-hover-cell', hoverCol && hoverRow);
  });
  els.pianoGrid.querySelectorAll('[data-piano-note-row]').forEach((element) => {
    element.classList.toggle('is-hover-row', Boolean(hover) && Number(element.dataset.pianoNoteRow) === hover.note);
  });
  els.pianoGrid.querySelectorAll('[data-piano-key-note]').forEach((element) => {
    element.classList.toggle('is-hover-row', Boolean(hover) && Number(element.dataset.pianoKeyNote) === hover.note);
  });
}

function updatePianoSelectionRect(els, state) {
  const rect = els.pianoSelectionRect;
  if (!rect) return;
  const selection = state.pianoSelection;
  if (!selection || state.pianoTool !== 'select') {
    rect.hidden = true;
    return;
  }
  const topNote = selection.noteMax;
  const bottomNote = selection.noteMin;
  const first = getPianoCellElement(els, selection.rowMin, topNote);
  const last = getPianoCellElement(els, selection.rowMax, bottomNote);
  if (!first || !last) {
    rect.hidden = true;
    return;
  }
  rect.hidden = false;
  rect.style.left = `${first.offsetLeft}px`;
  rect.style.top = `${first.offsetTop}px`;
  rect.style.width = `${(last.offsetLeft + last.offsetWidth) - first.offsetLeft}px`;
  rect.style.height = `${(last.offsetTop + last.offsetHeight) - first.offsetTop}px`;
}

function getPianoCellElement(els, row, note) {
  return els.pianoGrid.querySelector(`[data-piano-row="${row}"][data-piano-note="${note}"]`);
}

function togglePianoNoteAt(state, rowIndex, midiNote) {
  const pattern = getSelectedPattern(state);
  const row = pattern.rows[rowIndex];
  const current = row.cells?.[state.pianoChannel];
  if (current?.midiNote === midiNote) {
    delete row.cells[state.pianoChannel];
  } else {
    row.cells = row.cells || {};
    row.cells[state.pianoChannel] = {
      note: midiNoteToName(midiNote),
      midiNote,
      instrument: getInstrumentForChannel(state, state.pianoChannel),
      volume: 12,
      effect: '',
    };
  }
}

function deletePianoNoteAt(state, rowIndex, midiNote) {
  const row = getSelectedPattern(state).rows[rowIndex];
  for (const channelId of getPianoSelectionChannels(state)) {
    if (Number(row?.cells?.[channelId]?.midiNote) === midiNote) {
      delete row.cells[channelId];
    }
  }
}

function deletePianoSelection(state, els) {
  const selection = state.pianoSelection;
  if (!selection) return;
  pushUndo(state);
  const pattern = getSelectedPattern(state);
  const channels = getPianoSelectionChannels(state);
  for (let rowIndex = selection.rowMin; rowIndex <= selection.rowMax; rowIndex += 1) {
    for (const channelId of channels) {
      const cell = pattern.rows[rowIndex]?.cells?.[channelId];
      if (cell && Number(cell.midiNote) >= selection.noteMin && Number(cell.midiNote) <= selection.noteMax) {
        delete pattern.rows[rowIndex].cells[channelId];
      }
    }
  }
  state.dirty = true;
  renderAll(state, els);
}

function movePianoSelection(state, els, rowDelta, noteDelta) {
  const selection = state.pianoSelection;
  if (!selection || (!rowDelta && !noteDelta)) return;
  const pattern = getSelectedPattern(state);
  const moved = [];
  const channels = getPianoSelectionChannels(state);
  for (let rowIndex = selection.rowMin; rowIndex <= selection.rowMax; rowIndex += 1) {
    for (const channelId of channels) {
      const cell = pattern.rows[rowIndex]?.cells?.[channelId];
      const midiNote = Number(cell?.midiNote);
      if (cell && midiNote >= selection.noteMin && midiNote <= selection.noteMax) {
        const targetRow = rowIndex + rowDelta;
        const targetNote = midiNote + noteDelta;
        if (targetRow < 0 || targetRow >= ROWS_PER_PATTERN || targetNote < Math.min(...PIANO_NOTES) || targetNote > Math.max(...PIANO_NOTES)) continue;
        moved.push({ channelId, rowIndex, targetRow, targetNote, cell: structuredClone(cell) });
      }
    }
  }
  if (!moved.length) return;
  pushUndo(state);
  moved.forEach(({ channelId, rowIndex }) => {
    delete pattern.rows[rowIndex].cells[channelId];
  });
  moved.forEach(({ channelId, targetRow, targetNote, cell }) => {
    pattern.rows[targetRow].cells = pattern.rows[targetRow].cells || {};
    pattern.rows[targetRow].cells[channelId] = {
      ...cell,
      note: midiNoteToName(targetNote),
      midiNote: targetNote,
    };
  });
  state.pianoSelection = {
    rowMin: Math.max(0, Math.min(ROWS_PER_PATTERN - 1, selection.rowMin + rowDelta)),
    rowMax: Math.max(0, Math.min(ROWS_PER_PATTERN - 1, selection.rowMax + rowDelta)),
    noteMin: selection.noteMin + noteDelta,
    noteMax: selection.noteMax + noteDelta,
  };
  state.dirty = true;
  renderAll(state, els);
}

function getPianoSelectionChannels(state) {
  return CHANNELS.filter((channelId) => (
    channelId === state.pianoChannel
    || (state.showPianoLayers && state.channelVisible[channelId])
  ));
}

function renderPianoChannelTabs(state, els) {
  els.pianoChannelTabs.innerHTML = CHANNELS.map((channelId) => `
    <div class="md-bgm-piano-channel-tab ${channelId === state.pianoChannel ? 'active' : ''} ${state.channelMute[channelId] ? 'is-muted' : ''} ${state.channelVisible[channelId] ? '' : 'is-hidden'}">
      <button type="button" class="md-bgm-piano-channel-name" data-action="select-piano-channel" data-channel="${channelId}">${channelId}</button>
      <button type="button" class="md-bgm-channel-visible" data-action="toggle-channel-visibility" data-channel="${channelId}" title="${state.channelVisible[channelId] ? '非表示' : '表示'}">${state.channelVisible[channelId] ? '◉' : '○'}</button>
      <button type="button" class="md-bgm-channel-mute" data-action="toggle-channel-mute" data-channel="${channelId}" title="${state.channelMute[channelId] ? 'ミュート解除' : 'ミュート'}">${state.channelMute[channelId] ? '×' : '♪'}</button>
    </div>
  `).join('');
}

function pianoColumnClass(rowIndex) {
  return [
    rowIndex % 16 === 0 ? 'bar-boundary' : '',
    rowIndex % 4 === 0 ? 'beat-boundary' : '',
  ].filter(Boolean).join(' ');
}

function getPianoGhostChannels(state, row, midiNote, activeChannel) {
  return CHANNELS.filter((channelId) => (
    channelId !== activeChannel
    && state.channelVisible[channelId]
    && Number(row.cells?.[channelId]?.midiNote) === midiNote
  ));
}

function getSelectedPattern(state) {
  const selectedId = state.song.order[getSelectedOrderIndex(state)] ?? state.selectedPattern;
  return state.song.patterns.find((entry) => entry.id === selectedId) || state.song.patterns[0];
}

function getSelectedOrderIndex(state) {
  const order = Array.isArray(state.song.order) ? state.song.order : [];
  if (state.selectedOrderIndex >= 0 && state.selectedOrderIndex < order.length && order[state.selectedOrderIndex] === state.selectedPattern) {
    return state.selectedOrderIndex;
  }
  const index = order.indexOf(state.selectedPattern);
  if (index >= 0) {
    state.selectedOrderIndex = index;
    return index;
  }
  state.selectedOrderIndex = 0;
  state.selectedPattern = order[0] ?? 0;
  return 0;
}

function selectOrderIndex(state, index) {
  const order = Array.isArray(state.song.order) ? state.song.order : [];
  const clamped = Math.max(0, Math.min(order.length - 1, Number(index) || 0));
  state.selectedOrderIndex = clamped;
  state.selectedPattern = order[clamped] ?? 0;
}

function updateCellFromText(state, pattern, rowIndex, channelId, text) {
  const row = pattern.rows[rowIndex];
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    delete row.cells[channelId];
    return;
  }
  const note = tokens[0].toUpperCase();
  const instrument = tokens[1] || getInstrumentForChannel(state, channelId);
  const effect = tokens[2] || '';
  row.cells[channelId] = {
    note,
    midiNote: note === 'N' ? null : noteNameToMidi(note),
    instrument,
    volume: 12,
    effect,
  };
}

function addPattern(state, els) {
  if (!state.editable) return;
  pushUndo(state);
  const ids = state.song.patterns.map((pattern) => Number(pattern.id) || 0);
  const id = ids.length ? Math.max(...ids) + 1 : 0;
  state.song.patterns.push({ id, name: `Pattern ${String(id).padStart(2, '0')}`, rows: emptyRows() });
  state.song.order.push(id);
  selectOrderIndex(state, state.song.order.length - 1);
  state.dirty = true;
  renderAll(state, els);
}

function deleteSelectedPattern(state, els) {
  if (!state.editable || state.song.order.length <= 1) return;
  pushUndo(state);
  const deleted = state.selectedPattern;
  const index = state.song.order.indexOf(deleted);
  state.song.order.splice(index >= 0 ? index : 0, 1);
  if (!state.song.order.includes(deleted)) {
    state.song.patterns = state.song.patterns.filter((pattern) => pattern.id !== deleted);
  }
  selectOrderIndex(state, Math.max(0, Math.min(index, state.song.order.length - 1)));
  state.dirty = true;
  renderAll(state, els);
}

function handleTrackerKeydown(event, state, els) {
  if (!state.editable) return;
  const input = event.target?.closest?.('input[data-row][data-channel]');
  if (!input) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const row = Number(input.dataset.row);
  const channel = input.dataset.channel;
  if (key === '[' || key === ']') {
    event.preventDefault();
    state.keyboardOctave = Math.max(0, Math.min(8, state.keyboardOctave + (key === ']' ? 1 : -1)));
    setStatus(state, els, `Keyboard octave: C${state.keyboardOctave}`);
    return;
  }
  if (key === 'Backspace' || key === 'Delete') {
    event.preventDefault();
    pushUndo(state);
    clearSongCell(state, row, channel);
    state.dirty = true;
    renderAll(state, els);
    focusTrackerCell(els, row, channel);
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault();
    const next = getAdjacentCell(row, channel, key);
    state.selectedCell = next;
    focusTrackerCell(els, next.row, next.channel);
    return;
  }
  if (!(key in TRACKER_KEYBOARD_MAP)) return;
  event.preventDefault();
  pushUndo(state);
  const semitone = TRACKER_KEYBOARD_MAP[key];
  const midiNote = (state.keyboardOctave + 1) * 12 + semitone;
  const cell = setSongCellFromMidi(state, row, channel, midiNote);
  playImmediateCell(state, channel, midiNote, cell);
  state.dirty = true;
  const nextRow = Math.min(ROWS_PER_PATTERN - 1, row + 1);
  state.selectedCell = { row: nextRow, channel };
  renderAll(state, els);
  focusTrackerCell(els, nextRow, channel);
}

function setSongCellFromMidi(state, rowIndex, channelId, midiNote) {
  const pattern = getSelectedPattern(state);
  const row = pattern.rows[rowIndex];
  row.cells = row.cells || {};
  row.cells[channelId] = {
    note: channelId === 'NOISE' ? 'N' : midiNoteToName(midiNote),
    midiNote: channelId === 'NOISE' ? null : midiNote,
    instrument: getInstrumentForChannel(state, channelId),
    volume: 12,
    effect: '',
  };
  return row.cells[channelId];
}

function clearSongCell(state, rowIndex, channelId) {
  const pattern = getSelectedPattern(state);
  const row = pattern.rows[rowIndex];
  if (row?.cells) delete row.cells[channelId];
}

function getAdjacentCell(row, channel, key) {
  const channelIndex = Math.max(0, CHANNELS.indexOf(channel));
  if (key === 'ArrowUp') return { row: Math.max(0, row - 1), channel };
  if (key === 'ArrowDown') return { row: Math.min(ROWS_PER_PATTERN - 1, row + 1), channel };
  if (key === 'ArrowLeft') return { row, channel: CHANNELS[Math.max(0, channelIndex - 1)] };
  return { row, channel: CHANNELS[Math.min(CHANNELS.length - 1, channelIndex + 1)] };
}

function focusTrackerCell(els, row, channel) {
  const input = els.tracker.querySelector(`input[data-row="${row}"][data-channel="${channel}"]`);
  input?.focus?.();
  input?.select?.();
}

function getInstrumentForChannel(state, channelId) {
  const expected = channelType(channelId);
  const instruments = state.song.instruments || [];
  const selected = instruments.find((entry) => entry.id === state.selectedInstrument);
  if (selected?.type === expected) return selected.id;
  if (selected && selected.type !== expected) {
    upsertDiagnostic(state, {
      level: 'warn',
      code: 'instrument-type-mismatch',
      message: `${selected.name || selected.id} は ${channelId} に合わないため既定音色を使いました。`,
    });
  }
  return instruments.find((entry) => entry.type === expected)?.id
    || (expected === 'fm' ? 'fm_bell' : expected === 'noise' ? 'noise_kit' : 'psg_square');
}

function channelType(channelId) {
  if (channelId.startsWith('FM')) return 'fm';
  return channelId === 'NOISE' ? 'noise' : 'psg';
}

function channelClass(channelId) {
  return `ch-${String(channelId || '').toLowerCase()}`;
}

function upsertDiagnostic(state, diagnostic) {
  const index = state.diagnostics.findIndex((item) => item.code === diagnostic.code);
  if (index >= 0) state.diagnostics[index] = diagnostic;
  else state.diagnostics.push(diagnostic);
}

function toggleChannelMute(state, els, channelId) {
  if (!channelId || !(channelId in state.channelMute)) return;
  state.channelMute[channelId] = !state.channelMute[channelId];
  renderEditorMode(state, els);
}

function toggleChannelVisibility(state, els, channelId) {
  if (!channelId || !(channelId in state.channelVisible)) return;
  state.channelVisible[channelId] = !state.channelVisible[channelId];
  renderEditorMode(state, els);
}

function setPianoTool(state, els, tool) {
  if (!['draw', 'erase', 'select'].includes(tool)) return;
  state.pianoTool = tool;
  state.pianoDrag = null;
  if (tool !== 'select') state.pianoSelection = null;
  renderPianoRoll(state, els);
}

function selectPianoChannel(state, els, channelId) {
  if (!CHANNELS.includes(channelId)) return;
  state.pianoChannel = channelId;
  state.pianoSelection = null;
  state.pianoDrag = null;
  renderPianoRoll(state, els);
}

function isChannelMuted(state, channelId) {
  return Boolean(state.channelMute?.[channelId]);
}

function playImmediateCell(state, channelId, midiNote, cell, options = {}) {
  if (!options.ignoreMute && isChannelMuted(state, channelId)) return;
  void playImmediateCellViaVgm(state, channelId, midiNote, cell, options);
}

async function playImmediateCellViaVgm(state, channelId, midiNote, cell, options = {}) {
  const player = getVgmPreviewPlayer(state);
  if (!player?.load || !player?.play || !state.api?.plugins?.invokeHook) {
    const context = audioContext || new AudioContext();
    audioContext = context;
    playCell(context, channelId, midiNote, cell, getInstrumentById(state, cell?.instrument));
    return;
  }
  const instrumentId = cell?.instrument || getInstrumentForChannel(state, channelId);
  const previewSong = createSingleCellPreviewSong(state, channelId, midiNote, { ...cell, instrument: instrumentId });
  const result = await songToPreviewVgm(state, previewSong, 'input_preview');
  if (!result?.ok || !result.dataUrl) {
    const context = audioContext || new AudioContext();
    audioContext = context;
    playCell(context, channelId, midiNote, cell, getInstrumentById(state, instrumentId));
    return;
  }
  stopPreview(state);
  const loaded = player.load({ dataUrl: result.dataUrl });
  if (!loaded?.ok) return;
  const played = await player.play({});
  state.previewEngineStatus = formatPreviewEngineStatus(played?.previewEngine || player.getEngineStatus?.());
}

function createSingleCellPreviewSong(state, channelId, midiNote, cell) {
  const song = createDefaultSong({
    symbol: 'input_preview',
    title: 'Input Preview',
    tempo: 150,
    speed: 12,
  });
  song.instruments = structuredClone(state.song.instruments || []);
  song.patterns[0].rows = emptyRows();
  song.patterns[0].rows[0].cells[channelId] = {
    note: channelId === 'NOISE' ? 'N' : midiNoteToName(midiNote),
    midiNote: channelId === 'NOISE' ? null : midiNote,
    instrument: cell?.instrument,
    volume: cell?.volume ?? 12,
    effect: cell?.effect || '',
  };
  return song;
}

function getVgmPreviewPlayer(state) {
  return state.api?.capabilities?.get?.('vgm-preview-player') || null;
}

function formatPreviewEngineStatus(engine = {}) {
  if (!engine) return '';
  const label = engine.label || (engine.highAccuracyAvailable ? 'Nuked-OPN2 WASM' : '簡易 Web Audio');
  const stateText = engine.highAccuracyAvailable ? '有効' : engine.state === 'loading' ? '確認中' : 'fallback';
  return `${label} (${stateText})`;
}

async function songToPreviewVgm(state, song, symbol = 'preview_bgm') {
  const result = await state.api.plugins.invokeHook(state.plugin.id, 'previewMusic', {
    song,
    symbol,
  });
  return result?.result || result;
}

function cloneSongForPreview(state) {
  const song = structuredClone(state.song);
  song.patterns = (song.patterns || []).map((pattern) => ({
    ...pattern,
    rows: (pattern.rows || []).map((row) => {
      const cells = {};
      Object.entries(row.cells || {}).forEach(([channelId, cell]) => {
        if (!isChannelMuted(state, channelId)) cells[channelId] = cell;
      });
      return { ...row, cells };
    }),
  }));
  return song;
}

function fallbackImmediatePreview(state, channelId, midiNote, cell) {
  const context = audioContext || new AudioContext();
  audioContext = context;
  playCell(context, channelId, midiNote, cell, getInstrumentById(state, cell?.instrument));
}

function getInstrumentById(state, instrumentId) {
  return (state.song.instruments || []).find((entry) => entry.id === instrumentId);
}

function renderInstrumentEditor(state, els) {
  const instruments = state.song.instruments || [];
  const selected = instruments.find((entry) => entry.id === state.selectedInstrument) || instruments[0];
  if (!selected) {
    els.instrumentEditor.innerHTML = '<p class="muted">Instrument がありません。</p>';
    return;
  }
  normalizeInstrument(selected);
  state.selectedInstrument = selected.id;
  els.instrumentEditor.innerHTML = `
    <div class="md-bgm-section-title">Instrument</div>
    <div class="md-bgm-editor-tabs">
      <button type="button" data-action="instrument-tab" data-panel="instrument" class="${state.instrumentPanel === 'instrument' ? 'active' : ''}">Instrument</button>
      <button type="button" data-action="instrument-tab" data-panel="presets" class="${state.instrumentPanel === 'presets' ? 'active' : ''}">Pattern presets</button>
    </div>
    ${state.instrumentPanel === 'presets' ? renderPatternPresetEditor(state) : renderInstrumentFields(state, selected, instruments)}
  `;
  els.instrumentEditor.querySelectorAll('[data-inst-select]').forEach((selector) => {
    selector.disabled = !state.editable;
    selector.addEventListener('change', () => {
      state.selectedInstrument = selector.value;
      renderInstrumentEditor(state, els);
    });
  });
  els.instrumentEditor.querySelectorAll('[data-inst-field], [data-op-field], [data-preset-field]').forEach((input) => {
    input.disabled = !state.editable;
    input.addEventListener('change', () => {
      if (!state.editable) return;
      if (input.dataset.presetField) {
        updatePresetFormState(state, input);
        return;
      }
      pushUndo(state);
      if (input.dataset.opField) {
        const op = selected.operators[Number(input.dataset.op)];
        op[input.dataset.opField] = Number(input.value);
      } else {
        selected[input.dataset.instField] = input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
        normalizeInstrument(selected);
      }
      state.dirty = true;
      renderAll(state, els);
    });
  });
}

function renderInstrumentFields(state, selected, instruments) {
  return `
    <label>Selected<select data-inst-select>
      ${instruments.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === selected.id ? 'selected' : ''}>${escapeHtml(entry.name || entry.id)} (${escapeHtml(entry.type || '')})</option>`).join('')}
    </select></label>
    <label>Name<input data-inst-field="name" value="${escapeHtml(selected.name || '')}"></label>
    <label>Type<select data-inst-field="type">
      ${['fm', 'psg', 'noise'].map((type) => `<option value="${type}" ${selected.type === type ? 'selected' : ''}>${type}</option>`).join('')}
    </select></label>
    <div class="md-bgm-pair">
      <label>Volume<input data-inst-field="volume" type="number" min="0" max="15" value="${Number(selected.volume) || 10}"></label>
      <label>Test note<input data-inst-field="testNote" data-preset-field="instrumentTestNote" value="${escapeHtml(state.instrumentTestNote)}"></label>
    </div>
    <label>Pan<select data-inst-field="pan">
      ${['center', 'left', 'right'].map((pan) => `<option value="${pan}" ${selected.pan === pan ? 'selected' : ''}>${pan}</option>`).join('')}
    </select></label>
    ${selected.type === 'fm' ? renderFmInstrumentFields(selected) : renderPsgInstrumentFields(selected)}
    <button type="button" class="md-bgm-btn" data-action="test-instrument">Test instrument</button>
  `;
}

function renderFmInstrumentFields(selected) {
  return `
    <div class="md-bgm-pair">
      <label>Algorithm<input data-inst-field="algorithm" type="number" min="0" max="7" value="${Number(selected.algorithm) || 0}"></label>
      <label>Feedback<input data-inst-field="feedback" type="number" min="0" max="7" value="${Number(selected.feedback) || 0}"></label>
    </div>
    <div class="md-bgm-pair">
      <label>AMS<input data-inst-field="ams" type="number" min="0" max="3" value="${Number(selected.ams) || 0}"></label>
      <label>FMS<input data-inst-field="fms" type="number" min="0" max="7" value="${Number(selected.fms) || 0}"></label>
    </div>
    <table class="md-bgm-operator-table">
      <thead><tr><th>OP</th><th>TL</th><th>AR</th><th>DR</th><th>SR</th><th>RR</th><th>SL</th><th>DT</th><th>MUL</th><th>RS</th><th>AM</th><th>SSG</th></tr></thead>
      <tbody>${selected.operators.map((op, index) => `
        <tr><th>${index + 1}</th>${['tl', 'ar', 'dr', 'sr', 'rr', 'sl', 'detune', 'multiple', 'rs', 'am', 'ssgEg'].map((field) => `
          <td><input data-op="${index}" data-op-field="${field}" type="number" value="${Number(op[field]) || 0}"></td>
        `).join('')}</tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderPsgInstrumentFields(selected) {
  if (selected.type === 'noise') {
    return `
      <label>Envelope<select data-inst-field="envelope">${['hold', 'fade', 'pluck'].map((value) => `<option value="${value}" ${selected.envelope === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Noise frequency<select data-inst-field="noiseFrequency">${['clocked', 'white', 'periodic'].map((value) => `<option value="${value}" ${selected.noiseFrequency === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
    `;
  }
  return `
    <label>Envelope<select data-inst-field="envelope">${['hold', 'fade', 'pluck'].map((value) => `<option value="${value}" ${selected.envelope === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
    <label>Tone mode<select data-inst-field="toneMode">${['square', 'soft', 'bright'].map((value) => `<option value="${value}" ${selected.toneMode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
  `;
}

function renderPatternPresetEditor(state) {
  const presets = getPatternPresets(state);
  return `
    <div class="md-bgm-preset-form">
      <label>Name<input data-preset-field="presetName" value="${escapeHtml(state.presetName)}"></label>
      <div class="md-bgm-pair">
        <label>Start row<input data-preset-field="presetStartRow" type="number" min="0" max="${ROWS_PER_PATTERN - 1}" value="${Number(state.presetStartRow) || 0}"></label>
        <label>Length<input data-preset-field="presetLength" type="number" min="1" max="${ROWS_PER_PATTERN}" value="${Number(state.presetLength) || 1}"></label>
      </div>
      <label>Paste row<input data-preset-field="presetPasteRow" type="number" min="0" max="${ROWS_PER_PATTERN - 1}" value="${Number(state.presetPasteRow) || 0}"></label>
      <button type="button" class="md-bgm-btn" data-action="save-pattern-preset">Save preset</button>
    </div>
    <div class="md-bgm-preset-list">
      ${presets.length ? presets.map((preset) => `
        <div class="md-bgm-preset-item">
          <strong>${escapeHtml(preset.name)}</strong>
          <span>${preset.rows?.length || 0} rows</span>
          <button type="button" data-action="paste-pattern-preset" data-preset-id="${escapeHtml(preset.id)}">Paste</button>
          <button type="button" data-action="delete-pattern-preset" data-preset-id="${escapeHtml(preset.id)}">Delete</button>
        </div>
      `).join('') : '<p class="muted">Pattern preset はまだありません。</p>'}
    </div>
  `;
}

function getPatternPresets(state) {
  state.song.metadata = state.song.metadata || {};
  state.song.metadata.patternPresets = Array.isArray(state.song.metadata.patternPresets) ? state.song.metadata.patternPresets : [];
  return state.song.metadata.patternPresets;
}

function updatePresetFormState(state, input) {
  const key = input.dataset.presetField;
  if (!key) return;
  state[key] = input.type === 'number' ? Number(input.value) : input.value;
}

function switchInstrumentPanel(state, els, panel) {
  state.instrumentPanel = panel === 'presets' ? 'presets' : 'instrument';
  renderInstrumentEditor(state, els);
}

function savePatternPreset(state, els) {
  if (!state.editable) return;
  const pattern = getSelectedPattern(state);
  const start = Math.max(0, Math.min(ROWS_PER_PATTERN - 1, Number(state.presetStartRow) || 0));
  const length = Math.max(1, Math.min(ROWS_PER_PATTERN - start, Number(state.presetLength) || 1));
  const presets = getPatternPresets(state);
  pushUndo(state);
  presets.push({
    id: `preset_${Date.now().toString(36)}`,
    name: String(state.presetName || `Preset ${presets.length + 1}`),
    rows: structuredClone(pattern.rows.slice(start, start + length)),
  });
  state.dirty = true;
  renderAll(state, els);
}

function pastePatternPreset(state, els, presetId) {
  if (!state.editable) return;
  const preset = getPatternPresets(state).find((entry) => entry.id === presetId);
  if (!preset) return;
  const pattern = getSelectedPattern(state);
  const start = Math.max(0, Math.min(ROWS_PER_PATTERN - 1, Number(state.presetPasteRow) || 0));
  const rows = preset.rows || [];
  pushUndo(state);
  rows.forEach((row, index) => {
    if (start + index < ROWS_PER_PATTERN) pattern.rows[start + index] = structuredClone(row);
  });
  if (start + rows.length > ROWS_PER_PATTERN) {
    upsertDiagnostic(state, {
      level: 'warn',
      code: 'pattern-preset-truncated',
      message: 'Pattern preset の貼り付けが pattern 末尾で切り捨てられました。',
    });
  }
  state.dirty = true;
  renderAll(state, els);
}

function deletePatternPreset(state, els, presetId) {
  if (!state.editable) return;
  pushUndo(state);
  state.song.metadata.patternPresets = getPatternPresets(state).filter((entry) => entry.id !== presetId);
  state.dirty = true;
  renderAll(state, els);
}

function testSelectedInstrument(state) {
  const instrument = getInstrumentById(state, state.selectedInstrument);
  if (!instrument) return;
  const midi = instrument.type === 'noise' ? null : noteNameToMidi(state.instrumentTestNote) ?? 72;
  const channelId = instrument.type === 'fm' ? 'FM1' : instrument.type === 'noise' ? 'NOISE' : 'PSG1';
  playImmediateCell(state, channelId, midi, {
    note: instrument.type === 'noise' ? 'N' : midiNoteToName(midi),
    midiNote: midi,
    instrument: instrument.id,
    volume: instrument.volume || 12,
  }, { ignoreMute: true });
}

function renderDiagnostics(state, els) {
  if (!state.diagnostics.length) {
    els.diagnostics.innerHTML = '<p class="muted">問題はありません。</p>';
    return;
  }
  els.diagnostics.innerHTML = state.diagnostics.map((diag) => `
    <div class="md-bgm-diagnostic ${escapeHtml(diag.level || 'info')}">
      <strong>${escapeHtml(diag.code || diag.level || 'info')}</strong>
      <span>${escapeHtml(diag.message || '')}</span>
    </div>
  `).join('');
}

function renderAllocations(state, els) {
  if (!state.allocations.length) {
    els.allocations.innerHTML = '<p class="muted">MIDI 追加または VGM 解析後に情報が表示されます。</p>';
    return;
  }
  els.allocations.innerHTML = state.allocations.map((allocation) => `
    <div class="md-bgm-allocation">
      <span>${escapeHtml(allocation.trackName || allocation.key || '')}</span>
      <strong>${escapeHtml(allocation.target || '')}</strong>
    </div>
  `).join('');
}

async function validateViaMain(plugin, api, state, els) {
  const result = await api.plugins.invokeHook(plugin.id, 'validateSong', { song: state.song });
  state.diagnostics = result?.diagnostics || result?.result?.diagnostics || [];
  renderAll(state, els);
  return result;
}

async function playPreview({ plugin, api, state, els }) {
  stopPreview(state);
  const song = state.song;
  const sequence = buildPlaybackSequence(song);
  if (!sequence.length) return;
  const rowMs = rowDurationMs(song);
  const player = getVgmPreviewPlayer(state);
  if (!player?.load || !player?.play || !api?.plugins?.invokeHook) {
    playPreviewFallback(state, els, sequence, rowMs);
    return;
  }
  const previewSong = cloneSongForPreview(state);
  const result = await api.plugins.invokeHook(plugin.id, 'previewMusic', {
    song: previewSong,
    symbol: `${previewSong.symbol || 'bgm'}_preview`,
  });
  const body = result?.result || result;
  if (!body?.ok || !body.dataUrl) {
    setStatus(state, els, body?.error || 'VGM preview generation failed');
    playPreviewFallback(state, els, sequence, rowMs);
    return;
  }
  const loaded = player.load({ dataUrl: body.dataUrl });
  if (!loaded?.ok) {
    setStatus(state, els, loaded?.error || 'VGM preview load failed');
    playPreviewFallback(state, els, sequence, rowMs);
    return;
  }
  let playbackStep = 0;
  applyPlaybackStep(state, els, sequence, playbackStep);
  renderEditorMode(state, els);
  const played = await player.play({
    onTime: (currentSec) => {
      const nextStep = Math.min(sequence.length - 1, Math.max(0, Math.floor((currentSec * 1000) / rowMs)));
      if (nextStep !== playbackStep) {
        playbackStep = nextStep;
        applyPlaybackStep(state, els, sequence, playbackStep);
      }
      renderPlaybackIndicator(state, els);
    },
    onEnded: () => {
      stopPreview(state);
      renderEditorMode(state, els);
    },
    onError: (error) => {
      setStatus(state, els, `Preview error: ${error?.message || error}`);
      stopPreview(state);
      renderEditorMode(state, els);
    },
  });
  state.previewEngineStatus = formatPreviewEngineStatus(played?.previewEngine || player.getEngineStatus?.());
  if (played?.ok) setStatus(state, els, `Preview: ${state.previewEngineStatus}`);
  else {
    setStatus(state, els, played?.error || 'VGM preview failed');
    stopPreview(state);
    renderEditorMode(state, els);
  }
}

function playPreviewFallback(state, els, sequence, rowMs) {
  const context = audioContext || new AudioContext();
  audioContext = context;
  let playbackStep = 0;
  applyPlaybackStep(state, els, sequence, playbackStep);
  renderEditorMode(state, els);
  previewRowTimer = window.setInterval(() => {
    playbackStep += 1;
    if (playbackStep >= sequence.length) {
      stopPreview(state);
      renderEditorMode(state, els);
      return;
    }
    applyPlaybackStep(state, els, sequence, playbackStep);
    renderPlaybackIndicator(state, els);
  }, rowMs);
  sequence.forEach((step, stepIndex) => {
    const row = step.row;
    Object.entries(row.cells || {}).forEach(([channelId, cell]) => {
      if (isChannelMuted(state, channelId)) return;
      const midi = cell.midiNote ?? noteNameToMidi(cell.note);
      if (midi == null && channelId !== 'NOISE') return;
      const timer = window.setTimeout(() => playCell(context, channelId, midi, cell, getInstrumentById(state, cell.instrument)), stepIndex * rowMs);
      previewTimers.push(timer);
    });
  });
  state.previewEngineStatus = '簡易 Web Audio (fallback)';
  setStatus(state, els, `Preview: ${state.previewEngineStatus}`);
}

function buildPlaybackSequence(song) {
  return (song.order || []).flatMap((patternId, orderIndex) => {
    const pattern = song.patterns.find((entry) => entry.id === patternId);
    return (pattern?.rows || []).map((row, rowIndex) => ({ orderIndex, patternId, rowIndex, row }));
  });
}

function rowDurationMs(song) {
  const tempo = Math.max(30, Number(song?.tempo) || 150);
  const speed = Math.max(1, Math.min(31, Number(song?.speed) || 6));
  return (60000 / tempo / 4) * (speed / 6);
}

function applyPlaybackStep(state, els, sequence, stepIndex) {
  const step = sequence[stepIndex];
  if (!step) return;
  const changedPattern = state.selectedOrderIndex !== step.orderIndex || state.selectedPattern !== step.patternId;
  state.selectedOrderIndex = step.orderIndex;
  state.selectedPattern = step.patternId;
  state.playbackRow = step.rowIndex;
  if (changedPattern) {
    renderPatterns(state, els);
    renderEditorMode(state, els);
  }
}

function renderPlaybackIndicator(state, els) {
  els.tracker.querySelectorAll('tr[data-row-index]').forEach((row) => {
    row.classList.toggle('is-playing', Number(row.dataset.rowIndex) === state.playbackRow);
  });
  els.pianoGrid.querySelectorAll('[data-piano-row]').forEach((cell) => {
    cell.classList.toggle('is-playing', Number(cell.dataset.pianoRow) === state.playbackRow);
  });
  const target = state.viewMode === 'piano'
    ? els.pianoGrid.querySelector(`[data-piano-cell-row="${state.playbackRow}"]`)
    : els.tracker.querySelector(`tr[data-row-index="${state.playbackRow}"]`);
  const container = state.viewMode === 'piano' ? els.pianoScroll : els.trackerWrap;
  scrollPlaybackTarget(container, target);
}

function scrollPlaybackTarget(container, target) {
  if (!container || !target) return;
  if (container.contains(document.activeElement) && document.activeElement?.matches?.('input, textarea, select')) return;
  const targetTop = target.offsetTop;
  const targetBottom = targetTop + target.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  if (targetTop < viewTop) container.scrollTop = Math.max(0, targetTop - 28);
  else if (targetBottom > viewBottom) container.scrollTop = targetBottom - container.clientHeight + 28;
}

function playCell(context, channelId, midiNote, cell, instrument = null) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  const type = instrument?.type || channelType(channelId);
  osc.type = type === 'fm' ? (Number(instrument?.algorithm) >= 4 ? 'sine' : 'triangle') : 'square';
  osc.frequency.value = channelId === 'NOISE' ? 120 : 440 * (2 ** ((Number(midiNote) - 69) / 12));
  const volume = Number(cell.volume ?? instrument?.volume ?? 12);
  const tl = type === 'fm' ? averageOperatorTl(instrument) : 0;
  gain.gain.value = Math.max(0.02, Math.min(0.2, (volume / 80) * (1 - Math.min(96, tl) / 140)));
  osc.connect(gain).connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.18);
}

function averageOperatorTl(instrument) {
  const ops = instrument?.operators || [];
  if (!ops.length) return 24;
  return ops.reduce((sum, op) => sum + (Number(op.tl) || 0), 0) / ops.length;
}

function stopPreview(state) {
  previewTimers.forEach((timer) => window.clearTimeout(timer));
  previewTimers = [];
  if (previewRowTimer) window.clearInterval(previewRowTimer);
  previewRowTimer = 0;
  getVgmPreviewPlayer(state)?.stop?.();
  if (state) state.playbackRow = -1;
}

function restoreHistory(state, els, direction) {
  const from = direction === 'undo' ? state.undo : state.redo;
  const to = direction === 'undo' ? state.redo : state.undo;
  const snapshot = from.pop();
  if (!snapshot) return;
  to.push(structuredClone(state.song));
  state.song = normalizeSong(snapshot);
  state.dirty = true;
  renderAll(state, els);
}

function pushUndo(state) {
  state.undo.push(structuredClone(state.song));
  state.redo = [];
  if (state.undo.length > 40) state.undo.shift();
}

function assetKey(file, entry) {
  return `${file}::${entry?.lineNumber ?? ''}`;
}

function findAssetByKey(state, key) {
  for (const file of state.resFiles) {
    const entry = file.entries.find((item) => assetKey(file.file, item) === key);
    if (entry) return { file, entry };
  }
  return null;
}

function countAssets(state) {
  return state.resFiles.reduce((sum, file) => sum + file.entries.length, 0);
}

async function annotateIntermediateAvailability(state) {
  await Promise.all(state.resFiles.flatMap((file) => file.entries.map(async (entry) => {
    entry.intermediatePath = getJsonSidecarPath(state, entry);
    entry.intermediateAvailable = Boolean(await readSongJson(state.api, entry.intermediatePath));
  })));
}

function getVgmSourcePath(entry) {
  if (!entry) return '';
  if (String(entry.sourcePath || '').toLowerCase().endsWith('.vgm')) return entry.sourcePath;
  const first = Array.isArray(entry.files) ? entry.files[0] : '';
  return String(first || '').toLowerCase().endsWith('.vgm') ? first : '';
}

function getMusicSourcePath(entry) {
  if (!entry) return '';
  const candidates = [entry.sourcePath, ...(Array.isArray(entry.files) ? entry.files : [])];
  return String(candidates.find((item) => /\.(vgm|xgm)$/i.test(String(item || ''))) || '');
}

function getVgmSourceAbsolutePath(state, entry) {
  const rel = getVgmSourcePath(entry);
  if (!rel || !state.resRoot) return '';
  return `${state.resRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

function getMusicSourceAbsolutePath(state, entry) {
  const rel = getMusicSourcePath(entry);
  if (!rel || !state.resRoot) return '';
  return `${state.resRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

function getJsonSidecarPath(state, entry) {
  const rel = getVgmSourcePath(entry) || getMusicSourcePath(entry) || entry?.sourcePath || '';
  if (!rel || !state.resRoot) return '';
  return `${state.resRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${rel.replace(/\.[^.]+$/, '.mdbgm.json').replace(/^\/+/, '')}`;
}

function nextDefaultSymbol(state) {
  const names = new Set(state.resFiles.flatMap((file) => file.entries.map((entry) => entry.name)));
  let index = 1;
  while (names.has(`bgm_${String(index).padStart(3, '0')}`)) index += 1;
  return `bgm_${String(index).padStart(3, '0')}`;
}

function normalizeSymbol(value) {
  const raw = String(value || 'bgm')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[A-Za-z_]/.test(raw) ? raw : `bgm_${raw || 'bgm'}`;
}

function getExtension(filePath) {
  const name = getFileName(filePath).toLowerCase();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

function getFileName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function stripResPrefix(filePath) {
  return String(filePath || '').replace(/^res[\\/]/i, '').replace(/\\/g, '/');
}

function noteNameToMidi(noteName) {
  const match = String(noteName || '').trim().match(/^([A-G])(#?)(-?\d+)$/i);
  if (!match) return null;
  const index = NOTE_NAMES.indexOf(`${match[1].toUpperCase()}${match[2] || ''}`);
  return index < 0 ? null : (Number(match[3]) + 1) * 12 + index;
}

function midiNoteToName(note) {
  const n = Number(note);
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${octave}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

const esc = escapeHtml;
