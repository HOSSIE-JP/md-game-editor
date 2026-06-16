const NOTE_TYPES = ['LEFT', 'UP', 'DOWN', 'RIGHT', 'A', 'B', 'C'];
const NOTE_LABELS = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', A: 'A', B: 'B', C: 'C' };
const PATTERNS = ['TAP', 'HOLD', 'RAPID'];
const DIFFICULTIES = [
  { id: 'easy', label: 'EASY' },
  { id: 'normal', label: 'NORMAL' },
  { id: 'hard', label: 'HARD' },
];
const CANVAS_W = 960;
const CANVAS_H = 300;
const WAVE_H = 96;
const LANES_TOP = 122;
const LANE_H = 23;
const DEFAULT_DURATION = 120;
const MOOD_FRAME_W = 128;
const MOOD_FRAME_H = 96;
const MOOD_FPS = 8;
const NOTE_KEY_MAP = {
  ArrowUp: 'UP',
  KeyW: 'UP',
  ArrowDown: 'DOWN',
  KeyS: 'DOWN',
  ArrowLeft: 'LEFT',
  KeyA: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyD: 'RIGHT',
  KeyZ: 'A',
  KeyJ: 'A',
  KeyX: 'B',
  KeyK: 'B',
  KeyC: 'C',
  KeyL: 'C',
};
const AUTO_PRESETS = {
  easy: { density: 'beat', skip: 0.5, hold: 0.05, rapid: 0, holdMin: 0.5, holdMax: 1, rapidDur: 0.5 },
  normal: { density: 'beat', skip: 0.15, hold: 0.1, rapid: 0.05, holdMin: 0.4, holdMax: 1, rapidDur: 0.5 },
  hard: { density: 'eighth', skip: 0.1, hold: 0.15, rapid: 0.1, holdMin: 0.3, holdMax: 1, rapidDur: 0.5 },
  extreme: { density: 'sixteenth', skip: 0.05, hold: 0.2, rapid: 0.15, holdMin: 0.3, holdMax: 1.2, rapidDur: 0.6 },
};
const SPRITE_FRAME_HINTS = {
  note_sheet: { width: '2', height: '2', time: '4' },
  judge_text: { width: '8', height: '2', time: '0' },
  gauge_fill: { width: '1', height: '1', time: '0' },
  icon_diff: { width: '3', height: '3', time: '0' },
};

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const state = {
    activeTab: 'song',
    activeDifficulty: 'normal',
    songs: [],
    settings: defaultSettings(),
    resources: emptyResources(),
    assetSlots: null,
    current: null,
    currentOriginalId: '',
    dirty: false,
    settingsDirty: false,
    selectedNoteIndex: -1,
    selectedNoteIndices: new Set(),
    tool: { type: 'A', pattern: 'TAP' },
    zoom: 1,
    scroll: 0,
    duration: DEFAULT_DURATION,
    playbackRate: 1,
    recording: false,
    audio: null,
    audioButton: null,
    songAudio: null,
    playheadTime: 0,
    playbackTimer: 0,
    audioCtx: null,
    audioBuffer: null,
    moodPreviewImage: null,
    moodPreviewFrame: 0,
    moodPreviewTimer: 0,
    dragging: null,
    selectionBox: null,
    canvasMouseUpHandler: null,
    activationObserver: null,
    wasActive: root.classList.contains('active'),
  };

  root.dataset.pluginOwner = plugin.id;
  root.innerHTML = `
    <div class="rhythm-editor-root">
      <div class="rge-top-tabs">
        <button class="active" data-tab="song">楽曲編集</button>
        <button data-tab="assets">アセット設定</button>
        <button data-tab="settings">ゲーム設定</button>
        <span class="rge-status"></span>
        <span class="rge-dirty"></span>
        <button class="rge-save" data-action="save-all">保存</button>
        <button class="rge-export" data-action="export">生成</button>
      </div>

      <section class="rge-tab-panel active" data-panel="song">
        <div class="rge-shell">
          <main class="rge-center">
            <details class="rge-meta-accordion" open>
              <summary>
                <span class="rge-accordion-caret" aria-hidden="true"></span>
                <span class="rge-meta-title">楽曲メタ情報</span>
                <span class="rge-accordion-state" aria-hidden="true"></span>
              </summary>
              <section class="rge-meta-panel">
                <div class="rge-meta-column">
                  <div class="rge-row rge-song-row">
                    <select class="rge-song-select" title="楽曲選択"></select>
                    <button class="rge-icon" data-action="new-song" title="新規">+</button>
                    <button class="rge-icon danger" data-action="delete-song" title="削除">-</button>
                    <button class="rge-icon" data-action="move-song-up" title="前へ移動">↑</button>
                    <button class="rge-icon" data-action="move-song-down" title="次へ移動">↓</button>
                  </div>
                  <label class="rge-field">楽曲WAV
                    <div class="rge-row">
                      <select class="rge-audio-select"></select>
                      <button class="rge-icon" data-action="import-song-audio" title="楽曲インポート">＋</button>
                    </div>
                  </label>
                  <div class="rge-field-pair">
                    <label class="rge-field">曲ID<input class="rge-song-id" type="text" spellcheck="false"></label>
                    <label class="rge-field">曲名<input class="rge-title" type="text"></label>
                  </div>
                  <div class="rge-field-pair">
                    <label class="rge-field">表示名<input class="rge-display-name" type="text"></label>
                    <label class="rge-field">アーティスト<input class="rge-artist" type="text"></label>
                  </div>
                  <div class="rge-field-pair">
                    <label class="rge-field">BPM<input class="rge-bpm" type="number" min="30" max="300" step="0.1"></label>
                    <label class="rge-field">オフセット秒<input class="rge-offset" type="number" min="-60" max="60" step="0.001"></label>
                  </div>
                </div>
                <div class="rge-meta-column rge-media-column">
                  <label class="rge-field rge-preview-field">アルバムアート
                    <div class="rge-row">
                      <select class="rge-album-select"></select>
                      <button class="rge-icon" data-action="import-album" title="画像インポート">＋</button>
                    </div>
                    <span class="rge-stage-thumb rge-album-thumb">-</span>
                  </label>
                  <div class="rge-field rge-preview-field">
                    <label>ムードスプライト</label>
                    <div class="rge-row">
                      <select class="rge-mood-select"></select>
                      <button class="rge-icon" data-action="import-mood" title="スプライトインポート">＋</button>
                    </div>
                    <div class="rge-sprite-preview">
                      <div class="rge-sprite-preview-frame">
                        <canvas class="rge-mood-preview" width="${MOOD_FRAME_W}" height="${MOOD_FRAME_H}"></canvas>
                      </div>
                      <div class="rge-mood-preview-info">SPRITE ${MOOD_FRAME_W} × ${MOOD_FRAME_H}px / ${MOOD_FPS}fps</div>
                    </div>
                  </div>
                </div>
              </section>
            </details>
            <div class="rge-difficulty-row">
              <div class="rge-difficulty-tabs">
                <button class="active" data-difficulty="easy">EASY</button>
                <button data-difficulty="normal">NORMAL</button>
                <button data-difficulty="hard">HARD</button>
              </div>
            </div>
            <section class="rge-chart-panel">
              <div class="rge-chart-toolbar">
                <div class="rge-playback-controls">
                  <button class="rge-icon rge-play-toggle" data-action="toggle-playback" title="再生/一時停止">▶</button>
                  <button class="rge-icon" data-action="stop-playback" title="停止">■</button>
                </div>
                <label class="rge-speed-control">速度<input class="rge-playback-speed" type="range" min="0.25" max="2" step="0.25" value="1"></label>
                <span class="rge-speed-label">1.00x</span>
                <label class="rge-record-control"><input class="rge-record-toggle" type="checkbox">録音</label>
                <button class="rge-icon wide" data-action="auto-bpm" title="選択中の楽曲WAVからBPMを推定">自動BPM</button>
                <button class="rge-icon wide" data-action="auto-place" title="自動ノーツ配置">自動配置</button>
                <button class="rge-icon wide danger" data-action="delete-selected" title="選択ノーツを削除">削除</button>
                <label>ズーム<input class="rge-zoom" type="range" min="0.5" max="4" step="0.25" value="1"></label>
                <label>スクロール<input class="rge-scroll" type="range" min="0" max="120" step="0.01" value="0"></label>
                <button class="rge-icon" data-action="fit-song" title="全体表示">↔</button>
              </div>
              <canvas class="rge-waveform" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
              <div class="rge-chart-footer">
                <span class="rge-chart-summary"></span>
                <span class="rge-chart-time"></span>
              </div>
            </section>
            <section class="rge-note-tools">
              <div class="rge-tool-group">
                <div class="rge-palette-title">ノート</div>
                <div class="rge-note-palette"></div>
              </div>
              <div class="rge-tool-group">
                <div class="rge-palette-title">パターン</div>
                <div class="rge-pattern-palette"></div>
              </div>
            </section>
          </main>
        </div>
      </section>

      <section class="rge-tab-panel" data-panel="assets">
        <div class="rge-assets">
          <div class="rge-asset-tabs">
            <button class="active" data-asset-tab="sprites">スプライト</button>
            <button data-asset-tab="backgrounds">背景</button>
            <button data-asset-tab="ui">UI</button>
            <button data-asset-tab="se">SE</button>
          </div>
          <table class="rge-asset-table">
            <thead><tr><th>用途</th><th>仕様</th><th>登録</th><th>確認</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <section class="rge-tab-panel" data-panel="settings">
        <div class="rge-settings">
          <div class="rge-setting-band">
            <label class="rge-field">選曲揺れ幅<input data-effect="wobble_amplitude" type="number" min="0" max="4" step="0.0625"></label>
            <label class="rge-field">揺れ速度<input data-effect="wobble_speed" type="number" min="0" max="16" step="0.125"></label>
            <label class="rge-field">角速度<input data-effect="wobble_angular_velocity" type="number" min="0" max="32" step="0.125"></label>
            <label class="rge-field">背景X速度<input data-effect="diag_scroll_x_speed" type="number" min="-8" max="8" step="0.125"></label>
            <label class="rge-field">背景Y速度<input data-effect="diag_scroll_y_speed" type="number" min="-8" max="8" step="0.125"></label>
          </div>
          <div class="rge-validation">
            <button data-action="validate">検証</button>
            <pre class="rge-validation-output"></pre>
          </div>
        </div>
      </section>

      <div class="rge-preview" hidden>
        <button class="rge-preview-close" type="button">×</button>
        <div class="rge-preview-body"></div>
      </div>
    </div>
  `;

  const ui = collectUi(root);
  const ctx = ui.canvas.getContext('2d');

  function collectUi(scope) {
    return {
      shell: scope.querySelector('.rge-shell'),
      topTabs: Array.from(scope.querySelectorAll('.rge-top-tabs [data-tab]')),
      panels: Array.from(scope.querySelectorAll('.rge-tab-panel')),
      status: scope.querySelector('.rge-status'),
      dirty: scope.querySelector('.rge-dirty'),
      songSelect: scope.querySelector('.rge-song-select'),
      songId: scope.querySelector('.rge-song-id'),
      title: scope.querySelector('.rge-title'),
      displayName: scope.querySelector('.rge-display-name'),
      artist: scope.querySelector('.rge-artist'),
      bpm: scope.querySelector('.rge-bpm'),
      offset: scope.querySelector('.rge-offset'),
      audioSelect: scope.querySelector('.rge-audio-select'),
      albumSelect: scope.querySelector('.rge-album-select'),
      albumThumb: scope.querySelector('.rge-album-thumb'),
      moodSelect: scope.querySelector('.rge-mood-select'),
      moodPreview: scope.querySelector('.rge-mood-preview'),
      moodPreviewInfo: scope.querySelector('.rge-mood-preview-info'),
      difficultyTabs: Array.from(scope.querySelectorAll('.rge-difficulty-tabs [data-difficulty]')),
      playToggle: scope.querySelector('.rge-play-toggle'),
      playbackSpeed: scope.querySelector('.rge-playback-speed'),
      speedLabel: scope.querySelector('.rge-speed-label'),
      recordToggle: scope.querySelector('.rge-record-toggle'),
      zoom: scope.querySelector('.rge-zoom'),
      scroll: scope.querySelector('.rge-scroll'),
      canvas: scope.querySelector('.rge-waveform'),
      chartSummary: scope.querySelector('.rge-chart-summary'),
      chartTime: scope.querySelector('.rge-chart-time'),
      notePalette: scope.querySelector('.rge-note-palette'),
      patternPalette: scope.querySelector('.rge-pattern-palette'),
      assetTabs: Array.from(scope.querySelectorAll('.rge-asset-tabs [data-asset-tab]')),
      assetBody: scope.querySelector('.rge-asset-table tbody'),
      effectInputs: Array.from(scope.querySelectorAll('[data-effect]')),
      validationOutput: scope.querySelector('.rge-validation-output'),
      preview: scope.querySelector('.rge-preview'),
      previewBody: scope.querySelector('.rge-preview-body'),
      previewClose: scope.querySelector('.rge-preview-close'),
    };
  }

  function defaultSettings() {
    return {
      sprites: {},
      backgrounds: {},
      ui: {},
      se: {},
      select_effects: {
        wobble_amplitude: 0.625,
        wobble_speed: 1,
        wobble_angular_velocity: 4,
        diag_scroll_x_speed: 0.5,
        diag_scroll_y_speed: 0.5,
      },
    };
  }

  function emptyResources() {
    return { images: [], sprites: [], songs: [], ses: [], all: [] };
  }

  function setStatus(text) {
    ui.status.textContent = text || '';
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    updateDirtyLabel();
  }

  function setSettingsDirty(value) {
    state.settingsDirty = Boolean(value);
    updateDirtyLabel();
  }

  function updateDirtyLabel() {
    const labels = [];
    if (state.dirty) labels.push('譜面未保存');
    if (state.settingsDirty) labels.push('設定未保存');
    ui.dirty.textContent = labels.join(' / ');
  }

  function sanitizeSymbolName(value) {
    let symbol = String(value || '')
      .trim()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    if (!symbol) symbol = 'asset';
    if (/^[0-9]/.test(symbol)) symbol = `asset_${symbol}`;
    return symbol;
  }

  function normalizeSong(song = {}, index = 0) {
    const id = sanitizeSymbolName(song.song_id || song.id || song.title || `song_${index + 1}`);
    const charts = {};
    DIFFICULTIES.forEach(({ id: diff }) => {
      const notes = Array.isArray(song.charts?.[diff]?.notes) ? song.charts[diff].notes : [];
      charts[diff] = {
        notes: notes.map((note) => ({
          time: Math.max(0, Number(note.time) || 0),
          type: NOTE_TYPES.includes(String(note.type || '').toUpperCase()) ? String(note.type).toUpperCase() : 'A',
          pattern: PATTERNS.includes(String(note.pattern || '').toUpperCase()) ? String(note.pattern).toUpperCase() : 'TAP',
          duration: Math.max(0, Number(note.duration) || 0),
        })).sort((a, b) => a.time - b.time),
      };
    });
    return {
      song_id: id,
      title: String(song.title || id),
      display_name: String(song.display_name || song.title || id),
      artist: String(song.artist || ''),
      bpm: Number(song.bpm) || 120,
      offset: Number(song.offset) || 0,
      order: Number(song.order) || index + 1,
      audio_symbol: String(song.audio_symbol || ''),
      song_images: {
        album_art: String(song.song_images?.album_art || ''),
        mood_sprite: {
          symbol: String(song.song_images?.mood_sprite?.symbol || song.song_images?.mood_sprite || ''),
          frame_w: MOOD_FRAME_W,
          frame_h: MOOD_FRAME_H,
          fps: MOOD_FPS,
        },
      },
      charts,
    };
  }

  function makeNewSong() {
    const order = state.songs.length + 1;
    return normalizeSong({
      song_id: `song_${order}`,
      title: `Song ${order}`,
      display_name: `Song ${order}`,
      bpm: 120,
      offset: 0,
      order,
      charts: {
        easy: { notes: [] },
        normal: { notes: [] },
        hard: { notes: [] },
      },
    }, order - 1);
  }

  function currentNotes() {
    return state.current?.charts?.[state.activeDifficulty]?.notes || [];
  }

  function currentSpan() {
    return Math.max(1.5, 12 / state.zoom);
  }

  function maxScroll() {
    return Math.max(0, state.duration - currentSpan());
  }

  function timeToX(time) {
    return ((Number(time) - state.scroll) / currentSpan()) * CANVAS_W;
  }

  function xToTime(x) {
    return state.scroll + (x / CANVAS_W) * currentSpan();
  }

  function typeToLane(type) {
    const index = NOTE_TYPES.indexOf(type);
    return index >= 0 ? index : 4;
  }

  function laneToY(lane) {
    return LANES_TOP + lane * LANE_H;
  }

  function yToLane(y) {
    return Math.max(0, Math.min(NOTE_TYPES.length - 1, Math.floor((y - LANES_TOP) / LANE_H)));
  }

  function snapTime(time) {
    const beat = 60 / Math.max(30, Number(state.current?.bpm) || 120);
    const grid = beat / 4;
    const offset = Number(state.current?.offset) || 0;
    return Math.max(0, Math.round((time - offset) / grid) * grid + offset);
  }

  function selectedIndices() {
    return Array.from(state.selectedNoteIndices)
      .filter((index) => index >= 0 && index < currentNotes().length)
      .sort((a, b) => a - b);
  }

  function clearNoteSelection() {
    state.selectedNoteIndex = -1;
    state.selectedNoteIndices.clear();
  }

  function selectNoteIndex(index, additive = false) {
    if (!additive) state.selectedNoteIndices.clear();
    if (index >= 0) {
      state.selectedNoteIndices.add(index);
      state.selectedNoteIndex = index;
    } else if (!additive) {
      state.selectedNoteIndex = -1;
    }
  }

  function setSelectedIndices(indices) {
    state.selectedNoteIndices.clear();
    state.selectedNoteIndex = -1;
    indices.forEach((index) => {
      if (index >= 0 && index < currentNotes().length) {
        state.selectedNoteIndices.add(index);
        state.selectedNoteIndex = index;
      }
    });
  }

  function rebuildSelectedIndicesFromObjects(selectedObjects) {
    state.selectedNoteIndices.clear();
    state.selectedNoteIndex = -1;
    if (!selectedObjects?.size) return;
    currentNotes().forEach((note, index) => {
      if (selectedObjects.has(note)) {
        state.selectedNoteIndices.add(index);
        state.selectedNoteIndex = index;
      }
    });
  }

  function estimateDuration() {
    const noteMax = state.songs.reduce((max, song) => {
      DIFFICULTIES.forEach(({ id }) => {
        (song.charts?.[id]?.notes || []).forEach((note) => {
          max = Math.max(max, Number(note.time || 0) + Number(note.duration || 0) + 4);
        });
      });
      return max;
    }, 0);
    const audioDuration = Number(state.audioBuffer?.duration || state.songAudio?.duration || 0);
    state.duration = Math.max(DEFAULT_DURATION, noteMax, audioDuration || 0);
    ui.scroll.max = String(maxScroll());
  }

  function renderTopTabs() {
    ui.topTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
    ui.panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === state.activeTab));
  }

  function renderDifficultyTabs() {
    ui.difficultyTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.difficulty === state.activeDifficulty));
  }

  function renderSelect(select, entries, emptyLabel = '(なし)') {
    const prev = select.value;
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel;
    select.appendChild(empty);
    (entries || []).forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.name;
      opt.textContent = entry.name;
      select.appendChild(opt);
    });
    select.value = prev;
  }

  function renderSongSelect() {
    const prev = state.current?.song_id || '';
    ui.songSelect.innerHTML = '';
    state.songs.forEach((song, index) => {
      const opt = document.createElement('option');
      opt.value = song.song_id;
      opt.textContent = `${index + 1}. ${song.display_name || song.title || song.song_id}`;
      ui.songSelect.appendChild(opt);
    });
    ui.songSelect.value = prev;
  }

  function renderPalettes() {
    ui.notePalette.innerHTML = NOTE_TYPES.map((type) => (
      `<button class="${state.tool.type === type ? 'active' : ''}" data-note-tool="${type}" title="${type}">${NOTE_LABELS[type]}</button>`
    )).join('');
    ui.patternPalette.innerHTML = PATTERNS.map((pattern) => (
      `<button class="${state.tool.pattern === pattern ? 'active' : ''}" data-pattern-tool="${pattern}">${pattern}</button>`
    )).join('');
  }

  function renderSongForm() {
    const song = state.current;
    const disabled = !song;
    [ui.songId, ui.title, ui.displayName, ui.artist, ui.bpm, ui.offset, ui.audioSelect, ui.albumSelect, ui.moodSelect].forEach((control) => {
      control.disabled = disabled;
    });
    renderSelect(ui.audioSelect, state.resources.songs || [], '(未設定)');
    renderSelect(ui.albumSelect, state.resources.images || [], '(サンプル)');
    renderSelect(ui.moodSelect, state.resources.sprites || [], '(サンプル)');
    if (!song) {
      clearNoteSelection();
      ui.songId.value = '';
      ui.title.value = '';
      ui.displayName.value = '';
      ui.artist.value = '';
      ui.bpm.value = '120';
      ui.offset.value = '0';
      ui.albumSelect.value = '';
      ui.moodSelect.value = '';
      ui.albumThumb.textContent = '-';
      ui.albumThumb.style.backgroundImage = '';
      void updateMoodPreview();
      draw();
      return;
    }
    ui.songId.value = song.song_id;
    ui.title.value = song.title;
    ui.displayName.value = song.display_name;
    ui.artist.value = song.artist;
    ui.bpm.value = String(song.bpm);
    ui.offset.value = String(song.offset);
    ui.audioSelect.value = song.audio_symbol || '';
    ui.albumSelect.value = song.song_images?.album_art || '';
    ui.moodSelect.value = song.song_images?.mood_sprite?.symbol || '';
    estimateDuration();
    void updateAlbumThumb();
    void updateMoodPreview();
    renderSelectedNote();
    renderNoteList();
    draw();
  }

  function readFormIntoSong() {
    if (!state.current) return;
    state.current.song_id = sanitizeSymbolName(ui.songId.value || state.current.song_id);
    state.current.title = ui.title.value || state.current.song_id;
    state.current.display_name = ui.displayName.value || state.current.title;
    state.current.artist = ui.artist.value || '';
    state.current.bpm = Number(ui.bpm.value) || 120;
    state.current.offset = Number(ui.offset.value) || 0;
    state.current.audio_symbol = ui.audioSelect.value || '';
    state.current.song_images = {
      album_art: ui.albumSelect.value || '',
      mood_sprite: {
        symbol: ui.moodSelect.value || '',
        frame_w: MOOD_FRAME_W,
        frame_h: MOOD_FRAME_H,
        fps: MOOD_FPS,
      },
    };
  }

  async function updateAlbumThumb() {
    ui.albumThumb.textContent = '-';
    ui.albumThumb.style.backgroundImage = '';
    const symbol = ui.albumSelect.value;
    const asset = selectedAsset('images', symbol);
    if (!asset?.sourceAbsolutePath) return;
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath).catch(() => null);
    if (!read?.ok || !read.dataUrl) return;
    ui.albumThumb.textContent = '';
    ui.albumThumb.style.backgroundImage = `url("${read.dataUrl}")`;
  }

  async function updateMoodPreview() {
    stopMoodPreviewTimer();
    state.moodPreviewImage = null;
    state.moodPreviewFrame = 0;
    const canvas = ui.moodPreview;
    const info = ui.moodPreviewInfo;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0f141a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (info) info.textContent = `SPRITE ${MOOD_FRAME_W} × ${MOOD_FRAME_H}px / ${MOOD_FPS}fps`;

    const symbol = ui.moodSelect.value;
    const asset = selectedAsset('sprites', symbol);
    if (!asset?.sourceAbsolutePath) {
      context.fillStyle = '#69758a';
      context.font = '12px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('-', canvas.width / 2, canvas.height / 2);
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath).catch(() => null);
    if (!read?.ok || !read.dataUrl) return;
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode().catch(() => null);
    if (!img.naturalWidth || !img.naturalHeight) return;
    if (ui.moodSelect.value !== symbol) return;
    state.moodPreviewImage = img;
    if (info) {
      const columns = Math.max(1, Math.floor(img.naturalWidth / MOOD_FRAME_W));
      const rows = Math.max(1, Math.floor(img.naturalHeight / MOOD_FRAME_H));
      info.textContent = `SPRITE ${asset.name}: ${MOOD_FRAME_W} × ${MOOD_FRAME_H}px / ${columns} cols × ${rows} rows`;
    }
    drawMoodPreviewFrame();
    scheduleMoodPreviewFrame();
  }

  function drawMoodPreviewFrame() {
    const canvas = ui.moodPreview;
    const img = state.moodPreviewImage;
    if (!canvas || !img) return;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0f141a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const columns = Math.max(1, Math.floor(img.naturalWidth / MOOD_FRAME_W));
    const rows = Math.max(1, Math.floor(img.naturalHeight / MOOD_FRAME_H));
    const frameCount = Math.max(1, columns * rows);
    const frame = state.moodPreviewFrame % frameCount;
    const sx = (frame % columns) * MOOD_FRAME_W;
    const sy = Math.floor(frame / columns) * MOOD_FRAME_H;
    context.drawImage(img, sx, sy, MOOD_FRAME_W, MOOD_FRAME_H, 0, 0, canvas.width, canvas.height);
  }

  function scheduleMoodPreviewFrame() {
    stopMoodPreviewTimer();
    if (!state.moodPreviewImage) return;
    state.moodPreviewTimer = window.setTimeout(() => {
      state.moodPreviewFrame += 1;
      drawMoodPreviewFrame();
      scheduleMoodPreviewFrame();
    }, 1000 / MOOD_FPS);
  }

  function stopMoodPreviewTimer() {
    if (state.moodPreviewTimer) {
      window.clearTimeout(state.moodPreviewTimer);
      state.moodPreviewTimer = 0;
    }
  }

  function renderSettingsForm() {
    const effects = state.settings?.select_effects || defaultSettings().select_effects;
    ui.effectInputs.forEach((input) => {
      input.value = String(effects[input.dataset.effect] ?? '');
    });
  }

  function readSettingsForm() {
    const next = JSON.parse(JSON.stringify(state.settings || defaultSettings()));
    next.select_effects = next.select_effects || {};
    ui.effectInputs.forEach((input) => {
      next.select_effects[input.dataset.effect] = Number(input.value) || 0;
    });
    return next;
  }

  function renderAssetSettings() {
    const slots = state.assetSlots || {};
    const bucket = root.querySelector('.rge-asset-tabs .active')?.dataset.assetTab || 'sprites';
    const rows = slots[bucket] || [];
    ui.assetBody.innerHTML = rows.map((slot) => {
      const value = state.settings?.[bucket]?.[slot.id] || '';
      const resourceKind = bucket === 'se' ? 'ses' : bucket === 'backgrounds' || bucket === 'ui' && slot.type === 'IMAGE' ? 'images' : 'sprites';
      const entries = bucket === 'se' ? state.resources.ses : resourceKind === 'images' ? state.resources.images : state.resources.sprites;
      const options = ['<option value="">(サンプル)</option>'].concat((entries || []).map((entry) => (
        `<option value="${escapeHtml(entry.name)}" ${entry.name === value ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`
      ))).join('');
      const spec = slot.type === 'SPRITE'
        ? `${slot.type} ${slot.width || '-'}x${slot.height || '-'} tiles ${slot.palette || ''}`
        : slot.type === 'IMAGE'
          ? `${slot.width || '-'}x${slot.height || '-'} ${slot.palette || ''}`
          : 'XGM2 PCM 6650Hz';
      return `
        <tr data-bucket="${escapeHtml(bucket)}" data-role="${escapeHtml(slot.id)}">
          <td><strong>${escapeHtml(slot.label)}</strong>${slot.required ? '<span class="rge-required">必須</span>' : ''}</td>
          <td>${escapeHtml(spec)}</td>
          <td><select class="rge-binding-select">${options}</select></td>
          <td>
            <button class="rge-icon" data-action="import-asset" title="インポート">＋</button>
            <button class="rge-icon" data-action="preview-asset" title="プレビュー">▶</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function normalizeResourceBuckets(resources) {
    const all = (resources?.all || []).map((entry) => ({
      ...entry,
      name: String(entry?.name || ''),
      type: String(entry?.type || '').toUpperCase(),
      sourcePath: String(entry?.sourcePath || ''),
      sourceAbsolutePath: String(entry?.sourceAbsolutePath || ''),
    })).filter((entry) => entry.name);
    const songs = all.filter((entry) => {
      const source = entry.sourcePath.replace(/\\/g, '/').toLowerCase();
      const name = entry.name.toLowerCase();
      return entry.type === 'WAV' && (source.startsWith('songs/') || source.startsWith('bgm/') || source.startsWith('rhythm/songs/') || name.includes('song') || name.includes('bgm'));
    });
    return {
      all,
      images: resources?.images || all.filter((entry) => entry.type === 'IMAGE'),
      sprites: resources?.sprites || all.filter((entry) => entry.type === 'SPRITE'),
      songs: resources?.songs || songs,
      ses: resources?.ses || all.filter((entry) => entry.type === 'WAV' && !songs.some((song) => song.name === entry.name)),
    };
  }

  async function refreshResourcesFromResFile() {
    if (!api.electronAPI?.listResDefinitions) return;
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok || !Array.isArray(result.files)) return;
    const entries = result.files.flatMap((file) => (file.entries || []).map((entry) => ({ ...entry, file: file.file })));
    state.resources = normalizeResourceBuckets({ all: entries });
  }

  async function refresh() {
    const result = await api.plugins.invokeHook(plugin.id, 'listRhythmSongs', {});
    if (!result?.ok) {
      setStatus(result?.error || 'リズムゲームデータを読み込めませんでした');
      return;
    }
    state.songs = (result.songs || []).map(normalizeSong);
    state.settings = result.settings || defaultSettings();
    state.resources = normalizeResourceBuckets(result.resources || emptyResources());
    state.assetSlots = result.assetSlots || state.assetSlots;
    await refreshResourcesFromResFile();
    const currentId = state.current?.song_id || state.songs[0]?.song_id || '';
    state.current = state.songs.find((song) => song.song_id === currentId) || state.songs[0] || null;
    state.currentOriginalId = state.current?.song_id || '';
    clearNoteSelection();
    renderSongSelect();
    renderSongForm();
    renderSettingsForm();
    renderAssetSettings();
    void loadAudioForCurrentSong();
    setDirty(false);
    setSettingsDirty(false);
    setStatus('読み込みました');
  }

  async function refreshVisibleAssetDefinitions() {
    const values = {
      audio: ui.audioSelect.value,
      album: ui.albumSelect.value,
      mood: ui.moodSelect.value,
    };
    await refreshResourcesFromResFile();
    renderSongForm();
    ui.audioSelect.value = values.audio || '';
    ui.albumSelect.value = values.album || '';
    ui.moodSelect.value = values.mood || '';
    renderAssetSettings();
    await updateAlbumThumb();
    await updateMoodPreview();
    draw();
    setStatus('アセット定義を更新しました');
  }

  async function saveCurrentSong() {
    if (!state.current) return true;
    readFormIntoSong();
    const result = await api.plugins.invokeHook(plugin.id, 'saveRhythmSong', {
      previous_song_id: state.currentOriginalId || state.current.song_id,
      song: state.current,
    });
    if (!result?.ok) {
      setStatus(result?.error || '楽曲を保存できませんでした');
      return false;
    }
    state.current = normalizeSong(result.song || state.current);
    state.currentOriginalId = state.current.song_id;
    state.songs = (result.songs || state.songs).map(normalizeSong);
    renderSongSelect();
    setDirty(false);
    setStatus(`保存しました: ${state.current.display_name}`);
    return true;
  }

  async function saveSettings() {
    const next = readSettingsForm();
    const result = await api.plugins.invokeHook(plugin.id, 'saveRhythmSettings', { settings: next });
    if (!result?.ok) {
      setStatus(result?.error || '設定を保存できませんでした');
      return false;
    }
    state.settings = result.settings || next;
    setSettingsDirty(false);
    renderAssetSettings();
    setStatus('設定を保存しました');
    return true;
  }

  async function saveAll() {
    if (state.dirty && !(await saveCurrentSong())) return false;
    if (state.settingsDirty && !(await saveSettings())) return false;
    return true;
  }

  async function createSong() {
    if (!(await confirmDirty())) return;
    const song = makeNewSong();
    const result = await api.plugins.invokeHook(plugin.id, 'saveRhythmSong', { create: true, song });
    if (!result?.ok) {
      setStatus(result?.error || '楽曲を作成できませんでした');
      return;
    }
    state.songs = (result.songs || []).map(normalizeSong);
    state.current = normalizeSong(result.song || song);
    state.currentOriginalId = state.current.song_id;
    renderSongSelect();
    renderSongForm();
    setDirty(false);
    setStatus(`作成しました: ${state.current.display_name}`);
  }

  async function deleteSong() {
    if (!state.current) return;
    if (!window.confirm(`楽曲を削除しますか？\n${state.current.display_name || state.current.song_id}`)) return;
    const result = await api.plugins.invokeHook(plugin.id, 'deleteRhythmSong', { song_id: state.current.song_id });
    if (!result?.ok) {
      setStatus(result?.error || '楽曲を削除できませんでした');
      return;
    }
    state.songs = (result.songs || []).map(normalizeSong);
    state.current = state.songs[0] || null;
    state.currentOriginalId = state.current?.song_id || '';
    renderSongSelect();
    renderSongForm();
    setDirty(false);
    setStatus('削除しました');
  }

  async function moveSong(direction) {
    if (!state.current) return;
    const result = await api.plugins.invokeHook(plugin.id, 'moveRhythmSong', { song_id: state.current.song_id, direction });
    if (!result?.ok) {
      setStatus(result?.error || '楽曲を移動できませんでした');
      return;
    }
    state.songs = (result.songs || []).map(normalizeSong);
    state.current = state.songs.find((song) => song.song_id === (result.song?.song_id || state.current.song_id)) || state.current;
    state.currentOriginalId = state.current?.song_id || '';
    renderSongSelect();
    setStatus(result.moved ? '順序を変更しました' : 'これ以上移動できません');
  }

  async function exportRhythmData() {
    if (!(await saveAll())) return;
    const result = await api.plugins.invokeHook(plugin.id, 'exportRhythmData', {});
    setStatus(result?.ok ? 'ビルド用データを生成しました' : (result?.error || '生成に失敗しました'));
  }

  async function validateProject() {
    const result = await api.plugins.invokeHook(plugin.id, 'validateRhythmProject', {});
    if (!result?.ok && !result?.errors) {
      ui.validationOutput.textContent = result?.error || '検証に失敗しました';
      return;
    }
    const lines = [];
    if (result.errors?.length) lines.push('ERROR', ...result.errors);
    if (result.warnings?.length) lines.push('WARN', ...result.warnings);
    if (!lines.length) lines.push(`OK: ${result.songCount || 0} song(s)`);
    ui.validationOutput.textContent = lines.join('\n');
  }

  function renderSelectedNote() {
    // Selection is represented directly on the waveform canvas.
  }

  function renderNoteList() {
    const notes = currentNotes();
    const selected = selectedIndices().length;
    const suffix = selected ? ` / ${selected} selected` : '';
    ui.chartSummary.textContent = `${DIFFICULTIES.find((item) => item.id === state.activeDifficulty)?.label || ''}: ${notes.length} notes${suffix}`;
  }

  function addNoteAt(canvasX, canvasY) {
    if (!state.current || canvasY < LANES_TOP) return;
    const lane = yToLane(canvasY);
    const type = NOTE_TYPES[lane] || state.tool.type;
    const note = {
      time: round3(snapTime(xToTime(canvasX))),
      type,
      pattern: state.tool.pattern,
      duration: state.tool.pattern === 'TAP' ? 0 : 0.5,
    };
    const notes = currentNotes();
    notes.push(note);
    notes.sort((a, b) => a.time - b.time);
    selectNoteIndex(notes.indexOf(note));
    setDirty(true);
    estimateDuration();
    renderSelectedNote();
    renderNoteList();
    draw();
  }

  function hitTestNote(canvasX, canvasY) {
    const notes = currentNotes();
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const note = notes[i];
      const x = timeToX(note.time);
      const y = laneToY(typeToLane(note.type)) + LANE_H / 2;
      if (Math.abs(canvasX - x) <= 10 && Math.abs(canvasY - y) <= 10) return i;
      if (note.duration > 0) {
        const endX = timeToX(note.time + note.duration);
        if (canvasY >= y - 7 && canvasY <= y + 7 && canvasX >= Math.min(x, endX) && canvasX <= Math.max(x, endX)) return i;
      }
    }
    return -1;
  }

  function selectedNoteObjects() {
    const notes = currentNotes();
    return new Set(selectedIndices().map((index) => notes[index]).filter(Boolean));
  }

  function sortNotesAndPreserveSelection(selectedObjects = selectedNoteObjects()) {
    currentNotes().sort((a, b) => a.time - b.time);
    rebuildSelectedIndicesFromObjects(selectedObjects);
  }

  function updateSelectionBox(point) {
    const box = state.selectionBox;
    if (!box) return;
    box.endX = point.x;
    box.endY = point.y;
    const x1 = Math.min(box.startX, box.endX);
    const x2 = Math.max(box.startX, box.endX);
    const y1 = Math.min(box.startY, box.endY);
    const y2 = Math.max(box.startY, box.endY);
    const timeStart = xToTime(x1);
    const timeEnd = xToTime(x2);
    const laneStart = yToLane(y1);
    const laneEnd = yToLane(y2);
    const next = new Set(box.additive ? box.baseSelected : []);
    currentNotes().forEach((note, index) => {
      const noteLane = typeToLane(note.type);
      const noteEnd = Number(note.time || 0) + Number(note.duration || 0);
      if (noteLane >= laneStart && noteLane <= laneEnd && Number(note.time || 0) <= timeEnd && noteEnd >= timeStart) {
        next.add(index);
      }
    });
    setSelectedIndices(next);
    renderNoteList();
  }

  function deleteSelectedNotes() {
    const indices = selectedIndices().sort((a, b) => b - a);
    if (!indices.length) return;
    const notes = currentNotes();
    indices.forEach((index) => {
      if (index >= 0 && index < notes.length) notes.splice(index, 1);
    });
    clearNoteSelection();
    setDirty(true);
    estimateDuration();
    renderSelectedNote();
    renderNoteList();
    draw();
    setStatus(`${indices.length}個のノーツを削除しました`);
  }

  function isEditableTarget(target) {
    const tag = String(target?.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
  }

  function noteTypeFromKey(event) {
    return NOTE_KEY_MAP[event.code] || '';
  }

  function addRecordedNote(type) {
    if (!state.recording || !state.songAudio || state.songAudio.paused || !state.current) return false;
    const time = snapTime(Math.max(0, Number(state.songAudio.currentTime || 0)));
    const note = {
      time: round3(time),
      type,
      pattern: state.tool.pattern,
      duration: state.tool.pattern === 'TAP' ? 0 : round3(60 / Math.max(30, Number(state.current.bpm) || 120)),
    };
    const notes = currentNotes();
    notes.push(note);
    notes.sort((a, b) => a.time - b.time);
    selectNoteIndex(notes.indexOf(note));
    setDirty(true);
    estimateDuration();
    renderNoteList();
    draw();
    return true;
  }

  function onDocumentKeyDown(event) {
    if (!root.classList.contains('active')) return;
    if (isEditableTarget(event.target)) return;
    const type = noteTypeFromKey(event);
    if (state.recording && type && !event.repeat && addRecordedNote(type)) {
      event.preventDefault();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIndices().length) {
      event.preventDefault();
      deleteSelectedNotes();
    }
  }

  function canvasPoint(event) {
    const rect = ui.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawWaveform();
    drawTimeline();
    drawLanes();
    drawNotes();
    drawSelectionBox();
    drawPlayhead();
  }

  function drawWaveform() {
    ctx.save();
    ctx.fillStyle = '#171f28';
    ctx.fillRect(0, 0, CANVAS_W, WAVE_H);
    ctx.strokeStyle = '#4fc3aa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const buffer = state.audioBuffer;
    if (buffer) {
      const data = buffer.getChannelData(0);
      const start = Math.floor(state.scroll * buffer.sampleRate);
      const end = Math.min(data.length, Math.floor((state.scroll + currentSpan()) * buffer.sampleRate));
      const samplesPerPixel = Math.max(1, Math.floor((end - start) / CANVAS_W));
      for (let x = 0; x < CANVAS_W; x += 1) {
        const s0 = start + x * samplesPerPixel;
        let min = 0;
        let max = 0;
        for (let s = 0; s < samplesPerPixel && s0 + s < data.length; s += 1) {
          const v = data[s0 + s];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        ctx.moveTo(x + 0.5, WAVE_H / 2 + min * 40);
        ctx.lineTo(x + 0.5, WAVE_H / 2 + max * 40);
      }
    } else {
      for (let x = 0; x < CANVAS_W; x += 6) {
        const y = WAVE_H / 2 + Math.sin((x + state.scroll * 90) / 16) * 16;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTimeline() {
    ctx.save();
    const bpm = Math.max(30, Number(state.current?.bpm) || 120);
    const beat = 60 / bpm;
    const offset = Number(state.current?.offset) || 0;
    const first = offset + Math.floor((state.scroll - offset) / beat) * beat;
    ctx.font = '12px system-ui, sans-serif';
    for (let t = first; t <= state.scroll + currentSpan() + beat; t += beat) {
      const x = timeToX(t);
      const beatIndex = Math.round((t - offset) / beat);
      const major = beatIndex % 4 === 0;
      ctx.strokeStyle = major ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.10)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,.65)';
        ctx.fillText(formatTime(t), x + 4, WAVE_H + 18);
      }
    }
    ctx.restore();
  }

  function drawLanes() {
    ctx.save();
    NOTE_TYPES.forEach((type, lane) => {
      const y = laneToY(lane);
      ctx.fillStyle = lane % 2 ? '#161b22' : '#1d232b';
      ctx.fillRect(0, y, CANVAS_W, LANE_H - 1);
      ctx.fillStyle = '#d7dee8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(NOTE_LABELS[type] || type, 8, y + 16);
    });
    ctx.restore();
  }

  function drawNotes() {
    const notes = currentNotes();
    ctx.save();
    notes.forEach((note, index) => {
      const x = timeToX(note.time);
      if (x < -80 || x > CANVAS_W + 80) return;
      const y = laneToY(typeToLane(note.type)) + LANE_H / 2;
      const selected = index === state.selectedNoteIndex || state.selectedNoteIndices.has(index);
      const color = note.pattern === 'HOLD' ? '#7aa7ff' : note.pattern === 'RAPID' ? '#ffcc66' : '#6be0b5';
      if (note.duration > 0) {
        const endX = timeToX(note.time + note.duration);
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,.5)';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath();
      roundedRect(ctx, x - 9, y - 9, 18, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0e1116';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NOTE_LABELS[note.type] || note.type, x, y);
    });
    ctx.restore();
  }

  function drawSelectionBox() {
    const box = state.selectionBox;
    if (!box?.active) return;
    const x = Math.min(box.startX, box.endX);
    const y = Math.min(box.startY, box.endY);
    const w = Math.abs(box.endX - box.startX);
    const h = Math.abs(box.endY - box.startY);
    ctx.save();
    ctx.fillStyle = 'rgba(103, 213, 187, .12)';
    ctx.strokeStyle = '#67d5bb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawPlayhead() {
    const x = timeToX(state.playheadTime);
    if (x < -2 || x > CANVAS_W + 2) return;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  async function loadAudioForCurrentSong() {
    stopSongPlayback(true);
    state.audioBuffer = null;
    state.songAudio = null;
    const symbol = state.current?.audio_symbol || '';
    const asset = selectedAsset('songs', symbol) || selectedAsset('all', symbol);
    if (!asset?.sourceAbsolutePath) {
      draw();
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath).catch(() => null);
    if (!read?.ok || !read.dataUrl) return;
    state.songAudio = new Audio(read.dataUrl);
    state.songAudio.dataset.symbol = symbol;
    state.songAudio.playbackRate = state.playbackRate;
    state.songAudio.addEventListener('ended', () => stopSongPlayback(true));
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.audioCtx && AudioContextClass) state.audioCtx = new AudioContextClass();
    const bytes = await fetch(read.dataUrl).then((res) => res.arrayBuffer());
    state.audioBuffer = state.audioCtx
      ? await state.audioCtx.decodeAudioData(bytes.slice(0)).catch(() => null)
      : null;
    estimateDuration();
    draw();
  }

  async function toggleSongPlayback() {
    if (!state.songAudio && state.current?.audio_symbol) {
      await loadAudioForCurrentSong();
    }
    if (!state.songAudio) {
      setStatus('楽曲WAVが未設定です');
      return;
    }
    if (!state.songAudio.paused) {
      state.songAudio.pause();
      state.playheadTime = state.songAudio.currentTime || state.playheadTime;
      stopPlaybackTimer();
      syncPlaybackButton();
      draw();
      return;
    }
    if (state.playheadTime >= state.duration) state.playheadTime = 0;
    state.songAudio.currentTime = Math.max(0, Math.min(state.playheadTime, state.songAudio.duration || state.duration));
    await state.songAudio.play().catch((err) => {
      setStatus(`再生できません: ${String(err?.message || err)}`);
    });
    syncPlaybackButton();
    schedulePlaybackFrame();
  }

  function stopSongPlayback(resetPosition = true) {
    if (state.songAudio) {
      state.songAudio.pause();
      if (resetPosition) state.songAudio.currentTime = 0;
    }
    stopPlaybackTimer();
    if (resetPosition) {
      state.playheadTime = 0;
      state.scroll = 0;
      ui.scroll.value = '0';
    } else if (state.songAudio) {
      state.playheadTime = state.songAudio.currentTime || state.playheadTime;
    }
    syncPlaybackButton();
    draw();
  }

  function stopPlaybackTimer() {
    if (state.playbackTimer) {
      window.clearTimeout(state.playbackTimer);
      state.playbackTimer = 0;
    }
  }

  function schedulePlaybackFrame() {
    stopPlaybackTimer();
    if (!state.songAudio || state.songAudio.paused) {
      syncPlaybackButton();
      return;
    }
    state.playheadTime = state.songAudio.currentTime || 0;
    if (state.playheadTime < state.scroll || state.playheadTime > state.scroll + currentSpan()) {
      state.scroll = Math.max(0, Math.min(maxScroll(), state.playheadTime - currentSpan() * 0.2));
      ui.scroll.value = String(state.scroll);
    }
    ui.chartTime.textContent = `${formatTime(state.playheadTime)} / ${formatTime(state.duration)}`;
    draw();
    state.playbackTimer = window.setTimeout(schedulePlaybackFrame, 33);
  }

  function syncPlaybackButton() {
    if (!ui.playToggle) return;
    const playing = !!state.songAudio && !state.songAudio.paused;
    ui.playToggle.textContent = playing ? '⏸' : '▶';
    ui.playToggle.title = playing ? '一時停止' : '再生';
    ui.playToggle.classList.toggle('active', playing);
    ui.recordToggle?.closest('.rge-record-control')?.classList.toggle('active', state.recording && playing);
  }

  function setPlaybackRate(rate) {
    state.playbackRate = Math.max(0.25, Math.min(2, Number(rate) || 1));
    if (state.songAudio) state.songAudio.playbackRate = state.playbackRate;
    if (ui.playbackSpeed) ui.playbackSpeed.value = String(state.playbackRate);
    if (ui.speedLabel) ui.speedLabel.textContent = `${state.playbackRate.toFixed(2)}x`;
  }

  function setRecording(enabled) {
    state.recording = Boolean(enabled);
    if (ui.recordToggle) ui.recordToggle.checked = state.recording;
    ui.recordToggle?.closest('.rge-record-control')?.classList.toggle('armed', state.recording);
    syncPlaybackButton();
    setStatus(state.recording ? '録音ON: 再生中にキー入力でノーツを配置します' : '録音OFF');
  }

  function detectBeats() {
    const buffer = state.audioBuffer;
    if (!buffer) return [];
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
    const hopSize = Math.max(1, Math.floor(sampleRate * 0.01));
    const energies = [];
    for (let i = 0; i < data.length - windowSize; i += hopSize) {
      let sum = 0;
      for (let j = 0; j < windowSize; j += 1) {
        const v = data[i + j];
        sum += v * v;
      }
      energies.push(Math.sqrt(sum / windowSize));
    }
    const beats = [];
    const avgWindow = 43;
    const threshold = 1.3;
    const minInterval = sampleRate * 0.15 / hopSize;
    let lastBeatIdx = -minInterval;
    for (let i = avgWindow; i < energies.length - avgWindow; i += 1) {
      let avg = 0;
      for (let j = i - avgWindow; j <= i + avgWindow; j += 1) avg += energies[j];
      avg /= avgWindow * 2 + 1;
      if (energies[i] > avg * threshold && i - lastBeatIdx > minInterval && energies[i] >= energies[i - 1] && energies[i] >= energies[i + 1]) {
        beats.push((i * hopSize) / sampleRate);
        lastBeatIdx = i;
      }
    }
    return beats;
  }

  function detectAndSetBpm() {
    if (!state.audioBuffer || !state.current) {
      setStatus('楽曲WAVが未設定です');
      return;
    }
    const beats = detectBeats();
    if (beats.length < 4) {
      setStatus('BPMを検出できませんでした');
      return;
    }
    const intervals = [];
    for (let i = 1; i < beats.length; i += 1) intervals.push(beats[i] - beats[i - 1]);
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)] || 0.5;
    let detectedBpm = 60 / medianInterval;
    while (detectedBpm < 60) detectedBpm *= 2;
    while (detectedBpm > 200) detectedBpm /= 2;
    detectedBpm = Math.round(detectedBpm * 10) / 10;
    const offset = round3(beats[0] % (60 / detectedBpm));
    state.current.bpm = detectedBpm;
    state.current.offset = offset;
    ui.bpm.value = String(detectedBpm);
    ui.offset.value = String(offset);
    setDirty(true);
    draw();
    setStatus(`自動BPM: ${detectedBpm} / オフセット ${offset.toFixed(3)}s (${beats.length} beats)`);
  }

  function openAutoPlaceDialog() {
    if (!state.current) {
      setStatus('譜面が未選択です');
      return;
    }
    if (!state.audioBuffer) {
      setStatus('楽曲WAVが未設定です');
      return;
    }
    const noteChecks = NOTE_TYPES.map((type) => (
      `<label><input type="checkbox" name="note-type" value="${type}" checked>${NOTE_LABELS[type]}</label>`
    )).join('');
    const modal = api.createModal({
      id: `rge-auto-place-${plugin.id}`,
      className: 'app-modal rge-auto-modal',
      panelClassName: 'app-panel rge-auto-panel',
      html: `
        <header><h2>自動ノーツ配置</h2></header>
        <div class="rge-auto-body">
          <section>
            <label>難易度プリセット</label>
            <div class="rge-auto-presets">
              <button type="button" data-preset="easy">やさしい</button>
              <button type="button" data-preset="normal">ふつう</button>
              <button type="button" data-preset="hard">むずかしい</button>
              <button type="button" data-preset="extreme">おにむず</button>
            </div>
          </section>
          <section class="rge-auto-grid">
            <label>配置密度（グリッド）
              <select data-auto="density">
                <option value="whole">全音符（1小節に1個）</option>
                <option value="half-note">2分音符（1小節に2個）</option>
                <option value="beat" selected>4分音符（拍ごと）</option>
                <option value="eighth">8分音符</option>
                <option value="sixteenth">16分音符</option>
              </select>
            </label>
            <label>範囲
              <select data-auto="range">
                <option value="all" selected>全体</option>
                <option value="beats-only">ビート検出位置のみ</option>
              </select>
            </label>
          </section>
          <section>
            <label>ノーツ間引き率: <span data-auto-skip-label>30%</span></label>
            <input data-auto="skip" type="range" min="0" max="0.9" step="0.05" value="0.3">
          </section>
          <section>
            <label>使用するノーツ</label>
            <div class="rge-auto-note-types">${noteChecks}</div>
          </section>
          <section>
            <label>HOLD / RAPID Settings</label>
            <div class="rge-auto-grid rge-auto-hr">
              <label>HOLD Chance <input data-auto="hold" type="range" min="0" max="0.5" step="0.05" value="0.15"><span data-auto-hold-label>15%</span></label>
              <label>RAPID Chance <input data-auto="rapid" type="range" min="0" max="0.5" step="0.05" value="0.1"><span data-auto-rapid-label>10%</span></label>
              <label>HOLD Min(s) <input data-auto="hold-min" type="number" min="0.2" max="2" step="0.1" value="0.3"></label>
              <label>HOLD Max(s) <input data-auto="hold-max" type="number" min="0.3" max="4" step="0.1" value="1.0"></label>
              <label>RAPID Dur(s) <input data-auto="rapid-dur" type="number" min="0.2" max="2" step="0.1" value="0.5"></label>
            </div>
          </section>
          <section>
            <label class="rge-auto-check"><input data-auto="clear" type="checkbox">既存のノーツをクリア</label>
          </section>
        </div>
        <footer class="rge-auto-actions">
          <button type="button" data-auto-cancel>キャンセル</button>
          <button type="button" data-auto-execute>配置実行</button>
        </footer>
      `,
    });
    const panel = modal.panel;
    const close = () => {
      modal.close();
      modal.destroy();
    };
    const syncLabels = () => {
      panel.querySelector('[data-auto-skip-label]').textContent = `${Math.round(Number(panel.querySelector('[data-auto="skip"]').value) * 100)}%`;
      panel.querySelector('[data-auto-hold-label]').textContent = `${Math.round(Number(panel.querySelector('[data-auto="hold"]').value) * 100)}%`;
      panel.querySelector('[data-auto-rapid-label]').textContent = `${Math.round(Number(panel.querySelector('[data-auto="rapid"]').value) * 100)}%`;
    };
    panel.querySelectorAll('[data-auto="skip"], [data-auto="hold"], [data-auto="rapid"]').forEach((input) => input.addEventListener('input', syncLabels));
    panel.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        applyAutoPreset(panel, button.dataset.preset);
        panel.querySelectorAll('[data-preset]').forEach((item) => item.classList.toggle('active', item === button));
        syncLabels();
      });
    });
    panel.querySelector('[data-auto-cancel]')?.addEventListener('click', close);
    panel.querySelector('[data-auto-execute]')?.addEventListener('click', () => {
      executeAutoPlace(panel);
      close();
    });
    modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', close);
    modal.open();
    syncLabels();
  }

  function applyAutoPreset(panel, presetName) {
    const preset = AUTO_PRESETS[presetName];
    if (!preset) return;
    panel.querySelector('[data-auto="density"]').value = preset.density;
    panel.querySelector('[data-auto="skip"]').value = String(preset.skip);
    panel.querySelector('[data-auto="hold"]').value = String(preset.hold);
    panel.querySelector('[data-auto="rapid"]').value = String(preset.rapid);
    panel.querySelector('[data-auto="hold-min"]').value = String(preset.holdMin);
    panel.querySelector('[data-auto="hold-max"]').value = String(preset.holdMax);
    panel.querySelector('[data-auto="rapid-dur"]').value = String(preset.rapidDur);
  }

  function readAutoOptions(panel) {
    const enabledTypes = Array.from(panel.querySelectorAll('input[name="note-type"]:checked')).map((input) => input.value);
    return {
      density: panel.querySelector('[data-auto="density"]').value,
      range: panel.querySelector('[data-auto="range"]').value,
      skipRate: Number(panel.querySelector('[data-auto="skip"]').value) || 0,
      holdChance: Number(panel.querySelector('[data-auto="hold"]').value) || 0,
      rapidChance: Number(panel.querySelector('[data-auto="rapid"]').value) || 0,
      minHoldDur: Number(panel.querySelector('[data-auto="hold-min"]').value) || 0.3,
      maxHoldDur: Number(panel.querySelector('[data-auto="hold-max"]').value) || 1,
      rapidDur: Number(panel.querySelector('[data-auto="rapid-dur"]').value) || 0.5,
      clearExisting: panel.querySelector('[data-auto="clear"]').checked,
      enabledTypes,
    };
  }

  function executeAutoPlace(panel) {
    if (!state.current || !state.audioBuffer) return;
    const opts = readAutoOptions(panel);
    if (!opts.enabledTypes.length) {
      setStatus('使用するノーツを選択してください');
      return;
    }
    const bpm = Math.max(30, Number(state.current.bpm) || 120);
    const beatLen = 60 / bpm;
    const offset = Number(state.current.offset) || 0;
    const duration = Number(state.audioBuffer.duration || state.duration || DEFAULT_DURATION);
    const divisionMap = { whole: 0.25, 'half-note': 0.5, beat: 1, eighth: 2, sixteenth: 4 };
    const interval = beatLen / (divisionMap[opts.density] || 1);
    let positions = [];
    if (opts.range === 'beats-only') {
      positions = detectBeats();
    } else {
      for (let time = offset; time < duration; time += interval) {
        if (time >= 0) positions.push(time);
      }
    }
    if (!positions.length) {
      setStatus('自動配置できる位置がありません');
      return;
    }
    const energyAt = makeEnergySampler();
    const energies = positions.map((time) => energyAt(time));
    const maxEnergy = Math.max(0.001, ...energies);
    const notes = currentNotes();
    if (opts.clearExisting) notes.length = 0;
    let skipUntil = 0;
    let lastType = '';
    let sameCount = 0;
    let typeIndex = 0;
    const created = [];
    positions.forEach((time, index) => {
      if (time < skipUntil) return;
      const beatPhase = positiveModulo(time - offset, beatLen) / beatLen;
      const measurePhase = positiveModulo(time - offset, beatLen * 4) / (beatLen * 4);
      const onBeat = beatPhase < 0.05 || beatPhase > 0.95;
      const onMeasure = measurePhase < 0.05 || measurePhase > 0.95;
      if (!onMeasure && Math.random() < opts.skipRate) return;
      const energy = energies[index] / maxEnergy;
      let pattern = 'TAP';
      let noteDuration = 0;
      if (onBeat && energy > 0.55 && Math.random() < opts.holdChance) {
        let sustained = 0;
        for (let j = index + 1; j < Math.min(index + 8, positions.length); j += 1) {
          if (energies[j] / maxEnergy > 0.35) sustained += 1;
          else break;
        }
        if (sustained >= 2) {
          pattern = 'HOLD';
          noteDuration = opts.minHoldDur + (opts.maxHoldDur - opts.minHoldDur) * energy;
          skipUntil = time + noteDuration;
        }
      }
      if (pattern === 'TAP' && (onMeasure || onBeat) && energy > 0.65 && Math.random() < opts.rapidChance) {
        pattern = 'RAPID';
        noteDuration = opts.rapidDur * (0.8 + energy * 0.4);
        skipUntil = time + noteDuration;
      }
      let type = '';
      if (pattern === 'HOLD' || pattern === 'RAPID') {
        const dirs = opts.enabledTypes.filter((item) => ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(item));
        type = dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : opts.enabledTypes[0];
      } else {
        if (onBeat && energy > 0.5) {
          const buttons = opts.enabledTypes.filter((item) => ['A', 'B', 'C'].includes(item));
          if (buttons.length && Math.random() < 0.55) type = buttons[Math.floor(Math.random() * buttons.length)];
        }
        if (!type) {
          if (sameCount >= 3 || (sameCount >= 2 && Math.random() < 0.5)) {
            const others = opts.enabledTypes.filter((item) => item !== lastType);
            type = others.length ? others[Math.floor(Math.random() * others.length)] : opts.enabledTypes[typeIndex % opts.enabledTypes.length];
          } else {
            type = opts.enabledTypes[typeIndex % opts.enabledTypes.length];
          }
          typeIndex += 1;
        }
      }
      sameCount = type === lastType ? sameCount + 1 : 1;
      lastType = type;
      const note = { time: round3(time), type, pattern, duration: noteDuration > 0 ? round3(noteDuration) : 0 };
      notes.push(note);
      created.push(note);
    });
    notes.sort((a, b) => a.time - b.time);
    rebuildSelectedIndicesFromObjects(new Set(created));
    setDirty(true);
    estimateDuration();
    renderNoteList();
    draw();
    const counts = { TAP: 0, HOLD: 0, RAPID: 0 };
    created.forEach((note) => { counts[note.pattern] = (counts[note.pattern] || 0) + 1; });
    setStatus(`自動配置: ${created.length} notes (TAP:${counts.TAP} HOLD:${counts.HOLD} RAPID:${counts.RAPID})`);
  }

  function makeEnergySampler() {
    const buffer = state.audioBuffer;
    if (!buffer) return () => 0.5;
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const win = Math.max(1, Math.floor(sampleRate * 0.05));
    return (time) => {
      const start = Math.max(0, Math.floor(time * sampleRate));
      let sum = 0;
      let count = 0;
      for (let i = 0; i < win && start + i < data.length; i += 1) {
        const v = data[start + i];
        sum += v * v;
        count += 1;
      }
      return Math.sqrt(sum / Math.max(1, count));
    };
  }

  function positiveModulo(value, mod) {
    if (!mod) return 0;
    return ((value % mod) + mod) % mod;
  }

  async function previewAudioSymbol(button, symbol) {
    if (!symbol) return;
    if (state.audio && state.audio.dataset.symbol === symbol && !state.audio.paused) {
      state.audio.pause();
      state.audio.currentTime = 0;
      if (button) button.textContent = '▶';
      return;
    }
    if (state.audio) {
      state.audio.pause();
      if (state.audioButton) state.audioButton.textContent = '▶';
    }
    const asset = selectedAsset('all', symbol) || selectedAsset('songs', symbol) || selectedAsset('ses', symbol);
    if (!asset?.sourceAbsolutePath) {
      setStatus(`プレビュー対象が見つかりません: ${symbol}`);
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath).catch(() => null);
    if (!read?.ok || !read.dataUrl) return;
    state.audio = new Audio(read.dataUrl);
    state.audio.dataset.symbol = symbol;
    state.audioButton = button;
    if (button) button.textContent = '■';
    state.audio.addEventListener('ended', () => {
      if (button) button.textContent = '▶';
    }, { once: true });
    await state.audio.play().catch(() => {
      if (button) button.textContent = '▶';
    });
  }

  async function importSongAudio() {
    if (!state.current) return;
    const picked = await api.electronAPI.pickFile({
      title: '楽曲 WAV/MP3 を選択',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;
    const symbol = await openAssetSymbolModal('楽曲', `song_${state.current.song_id}_bgm`);
    if (!symbol) return;
    await importAudioAsset({
      picked,
      symbol,
      targetSubdir: 'songs',
      label: 'リズムゲーム楽曲',
      afterRegister: async () => {
        state.current.audio_symbol = symbol;
        renderSongForm();
        ui.audioSelect.value = symbol;
        setDirty(true);
        await loadAudioForCurrentSong();
      },
    });
  }

  async function importAssetForRow(row) {
    if (!row) return;
    const bucket = row.dataset.bucket;
    const roleId = row.dataset.role;
    const role = (state.assetSlots?.[bucket] || []).find((slot) => slot.id === roleId);
    if (!role) return;
    if (bucket === 'se') {
      const picked = await api.electronAPI.pickFile({
        title: 'SE WAV/MP3 を選択',
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }, { name: 'All Files', extensions: ['*'] }],
      });
      if (picked?.canceled || !picked?.sourcePath) return;
      const symbol = await openAssetSymbolModal(role.label, `se_${role.id}`);
      if (!symbol) return;
      await importAudioAsset({
        picked,
        symbol,
        targetSubdir: 'sfx',
        label: role.label,
        afterRegister: async () => saveAssetBinding(bucket, role.id, symbol),
      });
      return;
    }
    const picked = await api.electronAPI.pickFile({
      title: '画像を選択',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;
    const symbol = await openAssetSymbolModal(role.label, `${role.type === 'SPRITE' ? 'spr' : 'img'}_${role.id}`);
    if (!symbol) return;
    await importImageAsset({
      picked,
      symbol,
      role,
      targetSubdir: role.type === 'SPRITE' ? 'sprite' : 'gfx',
      label: role.label,
      afterRegister: async () => saveAssetBinding(bucket, role.id, symbol),
    });
  }

  async function importSongImage(kind) {
    if (!state.current) return;
    const picked = await api.electronAPI.pickFile({
      title: kind === 'album' ? 'アルバムアートを選択' : 'ムードスプライトを選択',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked?.canceled || !picked?.sourcePath) return;
    const symbol = await openAssetSymbolModal(kind === 'album' ? 'アルバムアート' : 'ムードスプライト', `${kind === 'album' ? 'img' : 'spr'}_${state.current.song_id}_${kind}`);
    if (!symbol) return;
    const role = kind === 'album'
      ? { type: 'IMAGE', width: 80, height: 80, label: 'アルバムアート' }
      : {
          type: 'SPRITE',
          width: Math.ceil(MOOD_FRAME_W / 8),
          height: Math.ceil(MOOD_FRAME_H / 8),
          label: 'ムードスプライト',
          time: String(Math.max(1, Math.round(60 / MOOD_FPS))),
        };
    await importImageAsset({
      picked,
      symbol,
      role,
      targetSubdir: kind === 'album' ? 'gfx' : 'sprite',
      label: role.label,
      afterRegister: async () => {
        if (kind === 'album') {
          state.current.song_images.album_art = symbol;
          ui.albumSelect.value = symbol;
        } else {
          state.current.song_images.mood_sprite.symbol = symbol;
          ui.moodSelect.value = symbol;
        }
        setDirty(true);
        renderSongForm();
        if (kind === 'mood') await updateMoodPreview();
      },
    });
  }

  async function importAudioAsset({ picked, symbol, targetSubdir, label, afterRegister }) {
    const audioCapability = api.capabilities.get('audio-convert-ui');
    if (audioCapability?.openAudioConvertModal) {
      await audioCapability.openAudioConvertModal({
        picked,
        targetSubdir,
        targetFileName: `${symbol}.wav`,
        symbol,
        comment: label,
        resFile: 'resources.res',
        options: { mono: true, sampleRate: 6650, outRate: 6650, driver: 'XGM2', far: true },
        entry: xgm2Pcm6650Entry(symbol, '', label),
        resEntry: xgm2Pcm6650Entry(symbol, '', label),
        resEntryDefaults: xgm2Pcm6650Entry(symbol, '', label),
      });
      void (async () => {
        const found = await waitForResourceSymbol(symbol);
        if (!found) return;
        await refreshResourcesFromResFile();
        await afterRegister?.();
        setStatus(`登録しました: ${symbol}`);
      })();
      return;
    }
    const lower = String(picked.sourcePath || '').toLowerCase();
    if (!lower.endsWith('.wav')) {
      setStatus('MP3/OGGの取り込みには音声変換プラグインが必要です');
      return;
    }
    const written = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir,
      targetFileName: `${symbol}.wav`,
    });
    if (!written?.ok) {
      setStatus(written?.error || '音声コピーに失敗しました');
      return;
    }
    const added = await api.electronAPI.addResEntry({ file: 'resources.res', entry: xgm2Pcm6650Entry(symbol, written.relativePath, label) });
    if (!added?.ok) {
      setStatus(added?.error || 'resources.res への追加に失敗しました');
      return;
    }
    await refreshResourcesFromResFile();
    await afterRegister?.();
    setStatus(`登録しました: ${symbol}`);
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

  async function importImageAsset({ picked, symbol, role, targetSubdir, label, afterRegister }) {
    const imagePipeline = api.capabilities.get('image-import-pipeline');
    if (!imagePipeline?.convertToIndexed16) {
      logger.error('画像減色コンバーターまたは画像リサイズコンバーターが無効または未インストールです');
      return;
    }
    const targetSize = role.type === 'IMAGE' && role.width && role.height
      ? { width: Number(role.width), height: Number(role.height) }
      : null;
    const converted = await imagePipeline.convertToIndexed16({ sourcePath: picked.sourcePath, targetSize });
    if (converted?.canceled) return;
    const ext = converted.targetExtension || '.png';
    const written = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir,
      targetFileName: `${symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!written?.ok) {
      setStatus(written?.error || '画像コピーに失敗しました');
      return;
    }
    const entry = role.type === 'SPRITE'
      ? spriteEntry(symbol, written.relativePath, role, label)
      : imageEntry(symbol, written.relativePath, label);
    const added = await api.electronAPI.addResEntry({ file: 'resources.res', entry });
    if (!added?.ok) {
      setStatus(added?.error || 'resources.res への追加に失敗しました');
      return;
    }
    await refreshResourcesFromResFile();
    await afterRegister?.();
    setStatus(`登録しました: ${symbol}`);
  }

  function spriteEntry(symbol, sourcePath, role, comment) {
    const hint = SPRITE_FRAME_HINTS[role.id] || role;
    return {
      type: 'SPRITE',
      name: symbol,
      sourcePath,
      width: String(hint.width || '1'),
      height: String(hint.height || '1'),
      compression: 'NONE',
      time: String(hint.time || '0'),
      collision: 'NONE',
      optType: 'BALANCED',
      optLevel: 'FAST',
      optDuplicate: 'FALSE',
      comment,
    };
  }

  function imageEntry(symbol, sourcePath, comment) {
    return {
      type: 'IMAGE',
      name: symbol,
      sourcePath,
      compression: 'BEST',
      mapOpt: 'ALL',
      mapBase: '0',
      comment,
    };
  }

  async function waitForResourceSymbol(symbol) {
    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      await refreshResourcesFromResFile();
      if ((state.resources.all || []).some((entry) => entry.name === symbol)) return true;
    }
    return false;
  }

  async function saveAssetBinding(bucket, roleId, symbol) {
    const settings = JSON.parse(JSON.stringify(state.settings || defaultSettings()));
    settings[bucket] = settings[bucket] || {};
    settings[bucket][roleId] = symbol || '';
    const result = await api.plugins.invokeHook(plugin.id, 'saveRhythmSettings', { settings });
    if (!result?.ok) {
      setStatus(result?.error || 'アセット設定を保存できませんでした');
      return false;
    }
    state.settings = result.settings || settings;
    setSettingsDirty(false);
    renderAssetSettings();
    return true;
  }

  function selectedAsset(kind, symbol) {
    const name = String(symbol || '').trim();
    if (!name) return null;
    if (kind === 'all') return (state.resources.all || []).find((entry) => entry.name === name) || null;
    return (state.resources[kind] || []).find((entry) => entry.name === name) || null;
  }

  async function previewAssetFromRow(row) {
    if (!row) return;
    const select = row.querySelector('.rge-binding-select');
    const symbol = select?.value || '';
    if (!symbol) return;
    const asset = selectedAsset('all', symbol);
    if (!asset?.sourceAbsolutePath) return;
    if (asset.type === 'WAV') {
      await previewAudioSymbol(row.querySelector('[data-action="preview-asset"]'), symbol);
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(asset.sourceAbsolutePath).catch(() => null);
    if (!read?.ok || !read.dataUrl) return;
    ui.previewBody.innerHTML = `<img src="${read.dataUrl}" alt="${escapeHtml(symbol)}">`;
    ui.preview.hidden = false;
  }

  function openAssetSymbolModal(label, defaultSymbol) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `rge-symbol-modal-${plugin.id}`,
        className: 'app-modal rge-symbol-modal',
        panelClassName: 'app-panel rge-symbol-panel',
        html: `
          <header><h2>アセット名</h2></header>
          <div class="rge-symbol-body">
            <label class="rge-field">${escapeHtml(label)}<input class="rge-symbol-input" type="text" value="${escapeHtml(sanitizeSymbolName(defaultSymbol))}" spellcheck="false"></label>
          </div>
          <footer class="rge-symbol-actions">
            <button type="button" class="rge-symbol-cancel">キャンセル</button>
            <button type="button" class="rge-symbol-ok">登録</button>
          </footer>
        `,
      });
      const input = modal.panel.querySelector('.rge-symbol-input');
      const finish = (value) => {
        modal.close();
        modal.destroy();
        resolve(value === null ? '' : sanitizeSymbolName(value));
      };
      modal.panel.querySelector('.rge-symbol-ok')?.addEventListener('click', () => finish(input.value));
      modal.panel.querySelector('.rge-symbol-cancel')?.addEventListener('click', () => finish(null));
      modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(null));
      modal.open();
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  function confirmDirty() {
    if (!state.dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `rge-dirty-guard-${plugin.id}`,
        className: 'app-modal rge-dirty-modal',
        panelClassName: 'app-panel rge-dirty-panel',
        html: `
          <header><h2>未保存の譜面</h2></header>
          <div class="rge-dirty-body">現在の楽曲を保存しますか？</div>
          <footer class="rge-dirty-actions">
            <button type="button" data-choice="cancel">キャンセル</button>
            <button type="button" data-choice="discard">破棄</button>
            <button type="button" data-choice="save">保存</button>
          </footer>
        `,
      });
      modal.panel.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', async () => {
          const choice = button.dataset.choice;
          modal.close();
          modal.destroy();
          if (choice === 'cancel') resolve(false);
          else if (choice === 'discard') {
            setDirty(false);
            resolve(true);
          } else {
            resolve(await saveCurrentSong());
          }
        });
      });
      modal.open();
    });
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

  function round3(value) {
    return Math.round(Number(value || 0) * 1000) / 1000;
  }

  function formatTime(value) {
    return `${round3(value).toFixed(3)}s`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roundedRect(context, x, y, width, height, radius) {
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, width, height, radius);
      return;
    }
    context.rect(x, y, width, height);
  }

  root.addEventListener('click', async (event) => {
    const action = event.target?.dataset?.action;
    if (event.target?.dataset?.tab) {
      state.activeTab = event.target.dataset.tab;
      renderTopTabs();
    }
    if (event.target?.dataset?.difficulty) {
      readFormIntoSong();
      state.activeDifficulty = event.target.dataset.difficulty;
      clearNoteSelection();
      renderDifficultyTabs();
      renderSelectedNote();
      renderNoteList();
      draw();
    }
    if (event.target?.dataset?.noteTool) {
      state.tool.type = event.target.dataset.noteTool;
      renderPalettes();
    }
    if (event.target?.dataset?.patternTool) {
      state.tool.pattern = event.target.dataset.patternTool;
      renderPalettes();
    }
    if (event.target?.dataset?.assetTab) {
      ui.assetTabs.forEach((tab) => tab.classList.toggle('active', tab === event.target));
      renderAssetSettings();
    }
    if (action === 'save-all') await saveAll();
    if (action === 'export') await exportRhythmData();
    if (action === 'validate') await validateProject();
    if (action === 'new-song') await createSong();
    if (action === 'delete-song') await deleteSong();
    if (action === 'move-song-up') await moveSong('up');
    if (action === 'move-song-down') await moveSong('down');
    if (action === 'fit-song') {
      state.zoom = Math.max(0.5, Math.min(4, 12 / Math.max(4, state.duration)));
      state.scroll = 0;
      ui.zoom.value = String(state.zoom);
      ui.scroll.value = '0';
      draw();
    }
    if (action === 'toggle-playback') await toggleSongPlayback();
    if (action === 'stop-playback') stopSongPlayback(true);
    if (action === 'delete-selected') deleteSelectedNotes();
    if (action === 'auto-bpm') detectAndSetBpm();
    if (action === 'auto-place') openAutoPlaceDialog();
    if (action === 'import-song-audio') await importSongAudio();
    if (action === 'import-album') await importSongImage('album');
    if (action === 'import-mood') await importSongImage('mood');
    if (action === 'import-asset') await importAssetForRow(event.target.closest('tr'));
    if (action === 'preview-asset') await previewAssetFromRow(event.target.closest('tr'));
  });

  root.addEventListener('input', (event) => {
    if ([ui.songId, ui.title, ui.displayName, ui.artist, ui.bpm, ui.offset, ui.audioSelect, ui.albumSelect, ui.moodSelect].includes(event.target)) {
      readFormIntoSong();
      setDirty(true);
      if (event.target === ui.albumSelect) void updateAlbumThumb();
      if (event.target === ui.moodSelect) void updateMoodPreview();
      if (event.target === ui.audioSelect) void loadAudioForCurrentSong();
    }
    if (event.target === ui.zoom) {
      state.zoom = Number(ui.zoom.value) || 1;
      ui.scroll.max = String(maxScroll());
      draw();
    }
    if (event.target === ui.scroll) {
      state.scroll = Math.max(0, Math.min(maxScroll(), Number(ui.scroll.value) || 0));
      ui.chartTime.textContent = `${formatTime(state.scroll)} - ${formatTime(state.scroll + currentSpan())}`;
      draw();
    }
    if (event.target === ui.playbackSpeed) setPlaybackRate(ui.playbackSpeed.value);
    if (event.target?.dataset?.effect) setSettingsDirty(true);
  });

  root.addEventListener('change', async (event) => {
    if (event.target === ui.recordToggle) setRecording(ui.recordToggle.checked);
    if (event.target === ui.songSelect) {
      if (!(await confirmDirty())) {
        ui.songSelect.value = state.current?.song_id || '';
        return;
      }
      state.current = state.songs.find((song) => song.song_id === ui.songSelect.value) || null;
      state.currentOriginalId = state.current?.song_id || '';
      clearNoteSelection();
      renderSongForm();
      await loadAudioForCurrentSong();
    }
    if (event.target?.classList?.contains('rge-binding-select')) {
      const row = event.target.closest('tr');
      await saveAssetBinding(row.dataset.bucket, row.dataset.role, event.target.value);
    }
  });

  ui.canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    const hit = hitTestNote(point.x, point.y);
    if (hit >= 0) {
      if (!event.shiftKey && !state.selectedNoteIndices.has(hit)) clearNoteSelection();
      selectNoteIndex(hit, true);
      const notes = currentNotes();
      const selected = selectedIndices();
      const selectedObjects = new Set(selected.map((index) => notes[index]).filter(Boolean));
      state.dragging = {
        startX: point.x,
        startY: point.y,
        anchorTime: notes[hit]?.time || 0,
        anchorLane: typeToLane(notes[hit]?.type),
        offset: xToTime(point.x) - (notes[hit]?.time || 0),
        original: selected.map((index) => ({
          note: notes[index],
          time: Number(notes[index]?.time || 0),
          lane: typeToLane(notes[index]?.type),
        })),
        selectedObjects,
        active: false,
      };
      renderSelectedNote();
      renderNoteList();
      draw();
      return;
    }
    if (!event.shiftKey) clearNoteSelection();
    state.selectionBox = {
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
      active: false,
      additive: event.shiftKey,
      baseSelected: new Set(state.selectedNoteIndices),
    };
    draw();
  });
  ui.canvas.addEventListener('mousemove', (event) => {
    const point = canvasPoint(event);
    if (state.dragging) {
      const dx = point.x - state.dragging.startX;
      const dy = point.y - state.dragging.startY;
      if (!state.dragging.active && Math.sqrt(dx * dx + dy * dy) > 3) state.dragging.active = true;
      if (!state.dragging.active) return;
      const anchorTime = round3(snapTime(xToTime(point.x) - state.dragging.offset));
      const timeDelta = anchorTime - state.dragging.anchorTime;
      const laneDelta = yToLane(point.y) - state.dragging.anchorLane;
      state.dragging.original.forEach(({ note, time, lane }) => {
        note.time = round3(Math.max(0, time + timeDelta));
        note.type = NOTE_TYPES[Math.max(0, Math.min(NOTE_TYPES.length - 1, lane + laneDelta))] || note.type;
      });
      rebuildSelectedIndicesFromObjects(state.dragging.selectedObjects);
      renderNoteList();
      draw();
      return;
    }
    if (state.selectionBox) {
      const dx = point.x - state.selectionBox.startX;
      const dy = point.y - state.selectionBox.startY;
      if (!state.selectionBox.active && Math.sqrt(dx * dx + dy * dy) > 5) state.selectionBox.active = true;
      if (state.selectionBox.active) updateSelectionBox(point);
      draw();
    }
  });
  const onCanvasMouseUp = (event) => {
    const point = event.target === ui.canvas ? canvasPoint(event) : null;
    if (state.dragging) {
      if (state.dragging.active) {
        sortNotesAndPreserveSelection(state.dragging.selectedObjects);
        setDirty(true);
      }
      state.dragging = null;
      renderNoteList();
      draw();
      return;
    }
    if (state.selectionBox) {
      const box = state.selectionBox;
      if (box.active) {
        state.selectionBox = null;
        renderNoteList();
        draw();
        return;
      }
      state.selectionBox = null;
      if (point) addNoteAt(point.x, point.y);
      else draw();
    }
  };
  window.addEventListener('mouseup', onCanvasMouseUp);
  state.canvasMouseUpHandler = onCanvasMouseUp;
  ui.canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    const hit = hitTestNote(point.x, point.y);
    if (hit >= 0) {
      if (!state.selectedNoteIndices.has(hit)) selectNoteIndex(hit);
      deleteSelectedNotes();
    }
  });
  ui.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.25 : 0.25;
    state.zoom = Math.max(0.5, Math.min(4, state.zoom + delta));
    ui.zoom.value = String(state.zoom);
    ui.scroll.max = String(maxScroll());
    draw();
  }, { passive: false });
  ui.previewClose.addEventListener('click', () => {
    ui.preview.hidden = true;
    if (state.audio) state.audio.pause();
  });
  document.addEventListener('keydown', onDocumentKeyDown);

  renderTopTabs();
  renderDifficultyTabs();
  renderPalettes();
  setPlaybackRate(state.playbackRate);
  observePageActivation();
  void refresh();
  registerCapability('rhythm-game-editor', { pluginId: plugin.id, root, refresh });
  logger.debug('rhythm-game-editor renderer activated');

  return {
    deactivate() {
      if (state.audio) state.audio.pause();
      stopSongPlayback(false);
      stopMoodPreviewTimer();
      state.audioCtx?.close?.();
      if (state.canvasMouseUpHandler) window.removeEventListener('mouseup', state.canvasMouseUpHandler);
      document.removeEventListener('keydown', onDocumentKeyDown);
      state.activationObserver?.disconnect();
      root.innerHTML = '';
    },
  };
}
