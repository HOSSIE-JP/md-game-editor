// かんたん作曲プラグイン レンダラー UI
// 左: BGM一覧 / 中央: おまかせ作曲パネル + canvasグリッド(コード行/ピアノロール/ドラム行)

const STEPS_PER_BAR = 16;
const MIDI_HIGH = 96;
const MIDI_LOW = 36;
const PITCH_ROWS = MIDI_HIGH - MIDI_LOW + 1;
const CELL_W = 18;
const CELL_H = 14;
const DRUM_CELL_H = 20;
const LABEL_W = 56;
const CHORD_H = 26;
const RULER_H = 16;
const TOP_H = CHORD_H + RULER_H;
const DRUM_GAP = 6;
const DRUM_H = DRUM_GAP + DRUM_CELL_H * 3;
const UNDO_LIMIT = 100;
const AUTOSAVE_MS = 800;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TRACK_COLORS = { lead: '#ffd24a', harmony: '#ff5f6b', bass: '#41d98d' };
const DRUM_COLORS = { kick: '#ff8b3d', snare: '#c77bff', hat: '#4fc3f7' };
const DRUM_ORDER = ['kick', 'snare', 'hat'];
const TOOLS = [
  { id: 'lead', label: 'リード', color: TRACK_COLORS.lead },
  { id: 'harmony', label: 'ハモリ', color: TRACK_COLORS.harmony },
  { id: 'bass', label: 'ベース', color: TRACK_COLORS.bass },
  { id: 'noise', label: 'ノイズ', color: DRUM_COLORS.hat },
  { id: 'extend', label: 'のばす', color: '#8fa3ff' },
  { id: 'select', label: '選択', color: '#e8e8f0' },
  { id: 'erase', label: 'けしゴム', color: '#9aa0b4' },
];
const MELODIC_TRACKS = ['lead', 'harmony', 'bass'];

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function clampNum(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rangeInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function midiToName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export async function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const state = {
    plugin,
    api,
    logger,
    defs: null,
    songs: [],
    currentId: '',
    song: null,
    dirty: false,
    undoStack: [],
    redoStack: [],
    tool: 'lead',
    playing: false,
    playhead: -1,
    stepMs: 100,
    engineStatus: '',
    saveTimer: 0,
    saving: null,
    drag: null,
    selection: null,
    clipboard: null,
    status: '',
    drawQueued: false,
    observer: null,
    resizeObserver: null,
  };

  const invokeHook = async (hook, payload = {}) => {
    try {
      const raw = await api.plugins.invokeHook(plugin.id, hook, payload);
      return raw?.result ?? raw;
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };

  root.innerHTML = `
    <div class="ebc-root">
      <div class="ebc-shell">
        <aside class="ebc-left">
          <div class="ebc-left-head">
            <span>BGM一覧</span>
            <button type="button" class="ebc-btn ebc-btn-accent" data-action="new">＋新規</button>
          </div>
          <ul class="ebc-song-list" data-el="songList"></ul>
        </aside>
        <main class="ebc-center">
          <header class="ebc-transport">
            <button type="button" class="ebc-btn ebc-play" data-action="play">▶ 再生</button>
            <button type="button" class="ebc-btn" data-action="stop">■ 停止</button>
            <label class="ebc-tempo">テンポ
              <input type="range" data-field="tempo" min="60" max="240" step="1">
              <span class="ebc-tempo-value" data-el="tempoValue">140</span>
            </label>
            <label class="ebc-toggle"><input type="checkbox" data-field="loop">ループ</label>
            <span class="ebc-engine" data-el="engine"></span>
            <span class="ebc-spacer"></span>
            <button type="button" class="ebc-btn ebc-btn-export" data-action="export">ゲームに登録</button>
          </header>
          <section class="ebc-compose">
            <div class="ebc-row">
              <span class="ebc-cap">曲の長さ</span>
              <div class="ebc-chiprow" data-el="barsChoices"></div>
              <span class="ebc-cap">コード進行</span>
              <select class="ebc-select" data-field="chordPreset"></select>
              <label class="ebc-toggle"><input type="checkbox" data-field="sequence">ゼクエンツ</label>
              <label class="ebc-toggle"><input type="checkbox" data-field="cadence">カデンツ</label>
            </div>
            <div class="ebc-row">
              <span class="ebc-cap">おまかせ作曲</span>
              <div class="ebc-chiprow ebc-themes" data-el="themeChips"></div>
            </div>
            <div class="ebc-attrs" data-el="attrs"></div>
            <div class="ebc-row">
              <button type="button" class="ebc-btn ebc-btn-shuffle" data-action="shuffle">SHUFFLE</button>
              <button type="button" class="ebc-btn ebc-btn-super-shuffle" data-action="super-shuffle" title="にぎやかさ・スピード・明暗などのスライダーもまとめてランダム化します">全SHUFFLE</button>
              <button type="button" class="ebc-btn" data-action="undo">もどす</button>
              <button type="button" class="ebc-btn" data-action="redo">やりなおす</button>
              <button type="button" class="ebc-btn ebc-btn-danger" data-action="clear">クリア</button>
              <span class="ebc-hint">クリックで置く・もう一度で消す / のばすで右へドラッグ / コード行クリックで和音変更 / スペースで再生・停止</span>
            </div>
          </section>
          <div class="ebc-toolbar" data-el="tools"></div>
          <div class="ebc-grid-scroll" data-el="gridScroll">
            <canvas class="ebc-grid-canvas" data-el="gridCanvas"></canvas>
            <div class="ebc-grid-spacer" data-el="gridSpacer"></div>
            <div class="ebc-chord-pop" data-el="chordPop" hidden></div>
          </div>
          <div class="ebc-mixer" data-el="mixer"></div>
          <div class="ebc-status" data-el="status"></div>
          <div class="ebc-empty" data-el="empty" hidden>
            <p>まだBGMがありません。「＋新規」でおまかせ作曲をはじめましょう。</p>
          </div>
        </main>
      </div>
    </div>
  `;

  const els = {};
  root.querySelectorAll('[data-el]').forEach((el) => { els[el.dataset.el] = el; });
  const ctx = els.gridCanvas.getContext('2d');

  // ============================ 共通ヘルパー ============================

  function setStatus(text) {
    state.status = text;
    renderStatus();
  }

  function renderStatus() {
    const song = state.song;
    const base = song ? `${song.name}${state.dirty ? ' *' : ''} / ${song.bars}小節 / ${song.tempo} BPM` : '';
    els.status.textContent = state.status || base;
  }

  function totalSteps() {
    return state.song ? state.song.bars * STEPS_PER_BAR : 0;
  }

  function pushUndo() {
    if (!state.song) return;
    state.undoStack.push(structuredClone(state.song));
    if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    state.redoStack = [];
  }

  function undo() {
    if (!state.undoStack.length || !state.song) return;
    state.redoStack.push(structuredClone(state.song));
    state.song = state.undoStack.pop();
    markDirty();
    syncControls();
    requestDraw();
  }

  function redo() {
    if (!state.redoStack.length || !state.song) return;
    state.undoStack.push(structuredClone(state.song));
    state.song = state.redoStack.pop();
    markDirty();
    syncControls();
    requestDraw();
  }

  function markDirty() {
    if (!state.song) return;
    state.dirty = true;
    renderStatus();
    renderSongList();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { void flushSave(); }, AUTOSAVE_MS);
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (!state.song || !state.dirty) return;
    if (state.saving) await state.saving;
    if (!state.dirty) return;
    state.dirty = false;
    const snapshot = structuredClone(state.song);
    state.saving = invokeHook('saveEasySong', { song: snapshot });
    const res = await state.saving;
    state.saving = null;
    if (!res?.ok) {
      state.dirty = true;
      setStatus(`保存失敗: ${res?.error || 'unknown'}`);
    } else if (state.song && state.song.id === res.song?.id) {
      state.song.updatedAt = res.song.updatedAt;
      const summary = state.songs.find((item) => item.id === res.song.id);
      if (summary) {
        summary.name = res.song.name;
        summary.bars = res.song.bars;
        summary.tempo = res.song.tempo;
        summary.themeId = res.song.themeId;
        summary.updatedAt = res.song.updatedAt;
      }
    }
    renderStatus();
    renderSongList();
  }

  // ============================ モーダル ============================

  const modalHandle = api.createModal({ id: `easy-bgm-modal-${plugin.id}` });

  function openDialog({ title, bodyHtml, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false, onOpen }) {
    return new Promise((resolve) => {
      modalHandle.panel.innerHTML = `
        <div class="ebc-modal">
          <h3>${esc(title)}</h3>
          <div class="ebc-modal-body">${bodyHtml}</div>
          <div class="ebc-modal-actions">
            <button type="button" class="ebc-btn" data-modal-action="cancel">${esc(cancelLabel)}</button>
            <button type="button" class="ebc-btn ${danger ? 'ebc-btn-danger' : 'ebc-btn-accent'}" data-modal-action="ok">${esc(okLabel)}</button>
          </div>
        </div>
      `;
      const done = (value) => {
        modalHandle.close();
        resolve(value);
      };
      modalHandle.panel.querySelector('[data-modal-action="ok"]').addEventListener('click', () => done(true));
      modalHandle.panel.querySelector('[data-modal-action="cancel"]').addEventListener('click', () => done(false));
      modalHandle.open();
      onOpen?.(modalHandle.panel);
    });
  }

  // ============================ 再生 ============================

  function getPlayer() {
    return api.capabilities.get('vgm-preview-player') || null;
  }

  function formatEngine(engine = {}) {
    if (!engine) return '';
    const label = engine.label || (engine.highAccuracyAvailable ? 'Nuked-OPN2 WASM' : '簡易 Web Audio');
    return `音源: ${label}`;
  }

  async function playSong() {
    const song = state.song;
    const player = getPlayer();
    if (!song || !player?.load || !player?.play) {
      setStatus('プレビュープレイヤーを利用できません。');
      return;
    }
    await flushSave();
    stopPlayback({ silent: true });
    const res = await invokeHook('previewEasySong', { song });
    if (!res?.ok || !res.dataUrl) {
      setStatus(`再生失敗: ${res?.error || 'unknown'}`);
      return;
    }
    state.stepMs = res.stepMs || (60000 / song.tempo / 4);
    const loaded = player.load({ dataUrl: res.dataUrl });
    if (!loaded?.ok) {
      setStatus(`再生データの読み込みに失敗しました: ${loaded?.error || ''}`);
      return;
    }
    state.playing = true;
    const handlers = {
      onTime: (sec) => {
        if (!state.playing) return;
        const step = Math.floor((sec * 1000) / state.stepMs);
        if (step !== state.playhead) {
          state.playhead = clampNum(step, 0, totalSteps() - 1);
          autoScrollToPlayhead();
          requestDraw();
        }
      },
      onEnded: () => {
        if (state.playing && state.song?.loop) {
      void player?.play?.(handlers);
        } else {
          stopPlayback();
        }
      },
      onError: (err) => setStatus(`再生エラー: ${String(err?.message || err)}`),
    };
    const played = await player.play(handlers);
    state.engineStatus = formatEngine(played?.previewEngine || player.getEngineStatus?.());
    els.engine.textContent = state.engineStatus;
    setStatus('');
  }

  function stopPlayback({ silent = false } = {}) {
    const player = getPlayer();
    if (state.playing || !silent) player?.stop?.();
    state.playing = false;
    state.playhead = -1;
    requestDraw();
  }

  async function previewPlacement({ track, midi, drum }) {
    const player = getPlayer();
    if (!player?.load || !player?.play || state.playing || !state.song) return;
    const song = {
      themeId: state.song.themeId,
      bars: 2,
      tempo: 160,
      loop: false,
      key: state.song.key,
      chords: [],
      tracks: { lead: [], harmony: [], bass: [] },
      drums: { kick: [], snare: [], hat: [] },
      mixer: state.song.mixer,
    };
    if (drum) song.drums[drum] = [0];
    else if (track) song.tracks[track] = [{ step: 0, length: 2, midiNote: midi }];
    const res = await invokeHook('previewEasySong', { song, loop: false });
    if (!res?.ok || !res.dataUrl || state.playing) return;
    player.stop?.();
    const loaded = player.load({ dataUrl: res.dataUrl });
    if (loaded?.ok) void player.play({});
  }

  function autoScrollToPlayhead() {
    if (state.playhead < 0) return;
    const container = els.gridScroll;
    const x = LABEL_W + state.playhead * CELL_W;
    const viewLeft = container.scrollLeft + LABEL_W;
    const viewRight = container.scrollLeft + container.clientWidth - CELL_W * 2;
    if (x < viewLeft || x > viewRight) {
      container.scrollLeft = Math.max(0, x - Math.floor(container.clientWidth / 3));
    }
  }

  // ============================ 曲リスト ============================

  function themeLabel(themeId) {
    return state.defs?.themes.find((theme) => theme.id === themeId)?.label || themeId;
  }

  function renderSongList() {
    els.songList.innerHTML = state.songs.map((song) => {
      const active = song.id === state.currentId;
      const dirtyMark = active && state.dirty ? ' *' : '';
      return `
        <li class="ebc-song-item ${active ? 'active' : ''}" data-song-id="${esc(song.id)}">
          <button type="button" class="ebc-song-main" data-action="select-song" data-song-id="${esc(song.id)}">
            <span class="ebc-song-name">${esc(song.name)}${dirtyMark}</span>
            <span class="ebc-song-meta">${esc(themeLabel(song.themeId))} / ${song.bars}小節</span>
          </button>
          <span class="ebc-song-buttons">
            <button type="button" class="ebc-icon-btn" title="名前を変更" data-action="rename-song" data-song-id="${esc(song.id)}">✎</button>
            <button type="button" class="ebc-icon-btn" title="削除" data-action="delete-song" data-song-id="${esc(song.id)}">🗑</button>
          </span>
        </li>
      `;
    }).join('');
    els.empty.hidden = state.songs.length > 0;
  }

  async function refreshSongs({ keepSelection = true } = {}) {
    const res = await invokeHook('listEasySongs', {});
    if (!res?.ok) {
      setStatus(`一覧の読み込みに失敗しました: ${res?.error || 'unknown'}`);
      return;
    }
    state.songs = res.songs || [];
    if (!keepSelection || !state.songs.some((song) => song.id === state.currentId)) {
      const first = state.songs[0];
      if (first) await selectSong(first.id);
      else {
        state.currentId = '';
        state.song = null;
        requestDraw();
      }
    }
    renderSongList();
    renderStatus();
  }

  async function selectSong(id) {
    if (state.currentId === id && state.song) return;
    await flushSave();
    stopPlayback({ silent: true });
    const res = await invokeHook('loadEasySong', { id });
    if (!res?.ok) {
      setStatus(`読み込み失敗: ${res?.error || 'unknown'}`);
      return;
    }
    state.currentId = id;
    state.song = res.song;
    state.undoStack = [];
    state.redoStack = [];
    state.selection = null;
    state.playhead = -1;
    state.dirty = false;
    hideChordPop();
    renderSongList();
    syncControls();
    resetScroll();
    requestDraw();
    renderStatus();
  }

  async function createSong() {
    await flushSave();
    const themes = state.defs?.themes || [];
    const theme = themes[Math.floor(Math.random() * themes.length)] || { id: 'bright' };
    const composed = await invokeHook('composeEasySong', { themeId: theme.id, bars: 4 });
    if (!composed?.ok) {
      setStatus(`作曲に失敗しました: ${composed?.error || 'unknown'}`);
      return;
    }
    const name = `新しいBGM ${state.songs.length + 1}`;
    const saved = await invokeHook('saveEasySong', { song: { ...composed.song, name } });
    if (!saved?.ok) {
      setStatus(`保存に失敗しました: ${saved?.error || 'unknown'}`);
      return;
    }
    await refreshSongs({ keepSelection: false });
    await selectSong(saved.song.id);
    setStatus(`「${saved.song.name}」を作成しました。SHUFFLEやテーマで作り直せます。`);
  }

  async function renameSong(id) {
    const summary = state.songs.find((song) => song.id === id);
    if (!summary) return;
    let value = summary.name;
    const ok = await openDialog({
      title: '名前を変更',
      bodyHtml: `<input type="text" class="ebc-input" data-modal-field="name" value="${esc(summary.name)}" maxlength="40">`,
      okLabel: '変更',
      onOpen: (panel) => {
        const input = panel.querySelector('[data-modal-field="name"]');
        input.focus();
        input.select();
        input.addEventListener('input', () => { value = input.value; });
      },
    });
    if (!ok) return;
    const name = String(value || '').trim();
    if (!name) return;
    if (state.currentId === id && state.song) {
      state.song.name = name;
      markDirty();
      await flushSave();
    } else {
      const res = await invokeHook('loadEasySong', { id });
      if (res?.ok) await invokeHook('saveEasySong', { song: { ...res.song, name } });
    }
    await refreshSongs();
    renderStatus();
  }

  async function deleteSong(id) {
    const summary = state.songs.find((song) => song.id === id);
    if (!summary) return;
    const ok = await openDialog({
      title: 'BGMを削除',
      bodyHtml: `<p>「${esc(summary.name)}」を削除します。よろしいですか?</p>`,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    if (state.currentId === id) {
      state.currentId = '';
      state.song = null;
      state.dirty = false;
    }
    const res = await invokeHook('deleteEasySong', { id });
    if (!res?.ok) {
      setStatus(`削除失敗: ${res?.error || 'unknown'}`);
      return;
    }
    await refreshSongs({ keepSelection: false });
    setStatus(`「${summary.name}」を削除しました。`);
  }

  // ============================ 作曲コントロール ============================

  function renderComposePanel() {
    const defs = state.defs;
    if (!defs) return;
    els.barsChoices.innerHTML = defs.barChoices.map((bars) => {
      const label = bars === 16 ? '16小節(メロ→サビ)' : bars === 32 ? '32小節(メロ→展開→サビ)' : `${bars}小節`;
      return `<button type="button" class="ebc-chip" data-action="set-bars" data-bars="${bars}">${esc(label)}</button>`;
    }).join('');
    els.themeChips.innerHTML = defs.themes.map((theme) => (
      `<button type="button" class="ebc-chip" data-action="set-theme" data-theme-id="${esc(theme.id)}">${esc(theme.label)}</button>`
    )).join('');
    const presetSelect = root.querySelector('[data-field="chordPreset"]');
    presetSelect.innerHTML = ['<option value="">おまかせ</option>']
      .concat(defs.chordPresets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.label)}</option>`))
      .join('');
    els.attrs.innerHTML = defs.attributeDefs.map((def) => `
      <label class="ebc-attr">
        <span class="ebc-attr-head"><span>${esc(def.label)}</span><span class="ebc-attr-value" data-attr-value="${esc(def.key)}">50</span></span>
        <input type="range" min="0" max="100" step="1" data-attr="${esc(def.key)}">
        <span class="ebc-attr-scale"><span>${esc(def.lowLabel)}</span><span>${esc(def.highLabel)}</span></span>
      </label>
    `).join('');
    els.tools.innerHTML = TOOLS.map((tool) => (
      `<button type="button" class="ebc-tool" data-action="set-tool" data-tool="${esc(tool.id)}">
        <span class="ebc-tool-dot" style="background:${esc(tool.color)}"></span>${esc(tool.label)}
      </button>`
    )).join('');
    els.mixer.innerHTML = ['lead', 'harmony', 'bass', 'drums'].map((track) => {
      const label = track === 'drums' ? 'ドラム' : (defs.trackLabels[track] || track);
      const color = TRACK_COLORS[track] || DRUM_COLORS.kick;
      return `
        <div class="ebc-mixer-strip" data-mixer-track="${esc(track)}">
          <span class="ebc-mixer-label"><span class="ebc-tool-dot" style="background:${esc(color)}"></span>${esc(label)}</span>
          <button type="button" class="ebc-mini-btn" data-action="mixer-mute" data-track="${esc(track)}">M</button>
          <button type="button" class="ebc-mini-btn" data-action="mixer-solo" data-track="${esc(track)}">S</button>
          <input type="range" min="0" max="15" step="1" data-mixer-volume="${esc(track)}">
        </div>
      `;
    }).join('');
  }

  function syncControls() {
    const song = state.song;
    const hasSong = Boolean(song);
    root.querySelectorAll('.ebc-transport button, .ebc-transport input, .ebc-compose button, .ebc-compose input, .ebc-compose select, .ebc-toolbar button, .ebc-mixer button, .ebc-mixer input')
      .forEach((el) => { el.disabled = !hasSong; });
    root.querySelector('[data-action="new"]').disabled = false;
    if (!hasSong) return;

    const tempoInput = root.querySelector('[data-field="tempo"]');
    tempoInput.value = String(song.tempo);
    els.tempoValue.textContent = String(song.tempo);
    root.querySelector('[data-field="loop"]').checked = Boolean(song.loop);
    root.querySelector('[data-field="sequence"]').checked = Boolean(song.options.sequence);
    root.querySelector('[data-field="cadence"]').checked = Boolean(song.options.cadence);
    root.querySelector('[data-field="chordPreset"]').value = song.options.chordPresetId || '';
    root.querySelectorAll('[data-action="set-bars"]').forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.bars) === song.bars);
    });
    root.querySelectorAll('[data-action="set-theme"]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.themeId === song.themeId);
    });
    root.querySelectorAll('[data-attr]').forEach((slider) => {
      const key = slider.dataset.attr;
      slider.value = String(song.attributes[key] ?? 50);
      const valueEl = root.querySelector(`[data-attr-value="${key}"]`);
      if (valueEl) valueEl.textContent = String(song.attributes[key] ?? 50);
    });
    root.querySelectorAll('.ebc-tool').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === state.tool);
    });
    root.querySelectorAll('.ebc-mixer-strip').forEach((strip) => {
      const track = strip.dataset.mixerTrack;
      const mixer = song.mixer[track];
      if (!mixer) return;
      strip.querySelector('[data-action="mixer-mute"]').classList.toggle('active', mixer.mute);
      strip.querySelector('[data-action="mixer-solo"]').classList.toggle('active', mixer.solo);
      strip.querySelector(`[data-mixer-volume="${track}"]`).value = String(mixer.volume);
    });
    updateSpacer();
  }

  async function runCompose({ themeId, bars, jitter = false, superShuffle = false } = {}) {
    const song = state.song;
    if (!song) return;
    pushUndo();
    const nextTheme = themeId || song.themeId;
    let attributes = song.attributes;
    if (themeId && themeId !== song.themeId) {
      const themeDef = state.defs?.themes.find((theme) => theme.id === themeId);
      attributes = themeDef ? { ...themeDef.defaultAttributes } : undefined;
    }
    if (attributes && jitter) {
      attributes = Object.fromEntries(Object.entries(attributes).map(([key, value]) => (
        [key, clampNum(Math.round(value + (Math.random() * 16 - 8)), 0, 100)]
      )));
    }
    if (superShuffle) {
      // にぎやかさ・スピード・明暗などスライダー全体もまとめてランダム化する強化版SHUFFLE
      const base = attributes || song.attributes;
      attributes = Object.fromEntries(Object.keys(base).map((key) => (
        [key, rangeInt(0, 100)]
      )));
    }
    setStatus('作曲中...');
    const res = await invokeHook('composeEasySong', {
      themeId: nextTheme,
      bars: bars || song.bars,
      attributes,
      options: {
        sequence: song.options.sequence,
        cadence: song.options.cadence,
        chordPresetId: song.options.chordPresetId,
      },
      existing: song,
    });
    if (!res?.ok) {
      setStatus(`作曲失敗: ${res?.error || 'unknown'}`);
      state.undoStack.pop();
      return;
    }
    state.song = res.song;
    state.selection = null;
    markDirty();
    syncControls();
    requestDraw();
    setStatus('');
  }

  async function changeBars(bars) {
    const song = state.song;
    if (!song || song.bars === bars) return;
    const ok = await openDialog({
      title: '曲の長さを変更',
      bodyHtml: `<p>${bars}小節で作り直します(現在のメロディは新しく生成されます)。<br>「もどす」で直前の状態に戻せます。</p>`,
      okLabel: '作り直す',
    });
    if (!ok) {
      syncControls();
      return;
    }
    await runCompose({ bars });
  }

  async function clearNotes() {
    const song = state.song;
    if (!song) return;
    const ok = await openDialog({
      title: 'クリア',
      bodyHtml: '<p>すべてのノートとドラムを消去します。よろしいですか?</p>',
      okLabel: 'クリア',
      danger: true,
    });
    if (!ok) return;
    pushUndo();
    song.tracks = { lead: [], harmony: [], bass: [] };
    song.drums = { kick: [], snare: [], hat: [] };
    state.selection = null;
    markDirty();
    requestDraw();
  }

  // ============================ ノート編集 ============================

  function sortAndFixOverlaps(list) {
    list.sort((a, b) => a.step - b.step);
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const current = list[i];
      const next = list[i + 1];
      if (current.step + current.length > next.step) {
        current.length = next.step - current.step;
        if (current.length < 1) list.splice(i, 1);
      }
    }
  }

  function findNoteAt(track, step, midi) {
    return (state.song?.tracks[track] || []).find((note) => (
      note.midiNote === midi && step >= note.step && step < note.step + note.length
    )) || null;
  }

  function findAnyNoteAt(step, midi) {
    for (const track of MELODIC_TRACKS) {
      const note = findNoteAt(track, step, midi);
      if (note) return { track, note };
    }
    return null;
  }

  function placeNote(track, step, midi) {
    const list = state.song.tracks[track];
    const filtered = list.filter((note) => !(note.step === step));
    for (const note of filtered) {
      if (note.step < step && note.step + note.length > step) {
        note.length = step - note.step;
      }
    }
    filtered.push({ step, length: 1, midiNote: midi });
    state.song.tracks[track] = filtered;
    sortAndFixOverlaps(state.song.tracks[track]);
  }

  function removeNote(track, note) {
    const list = state.song.tracks[track];
    const index = list.indexOf(note);
    if (index >= 0) list.splice(index, 1);
  }

  function eraseAt(step, midi) {
    let removed = false;
    for (const track of MELODIC_TRACKS) {
      const note = findNoteAt(track, step, midi);
      if (note) {
        removeNote(track, note);
        removed = true;
      }
    }
    return removed;
  }

  function toggleDrum(drum, step, force) {
    const list = state.song.drums[drum];
    const index = list.indexOf(step);
    if (force === 'on') {
      if (index < 0) list.push(step);
    } else if (force === 'off') {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list.splice(index, 1);
    } else {
      list.push(step);
    }
    list.sort((a, b) => a - b);
    return list.includes(step);
  }

  function selectionNotes() {
    const sel = state.selection;
    if (!sel || !state.song) return [];
    const result = [];
    for (const track of MELODIC_TRACKS) {
      for (const note of state.song.tracks[track]) {
        if (note.step >= sel.stepMin && note.step <= sel.stepMax
          && note.midiNote >= sel.midiMin && note.midiNote <= sel.midiMax) {
          result.push({ track, note });
        }
      }
    }
    return result;
  }

  function copySelection() {
    const items = selectionNotes();
    if (!items.length) return;
    const base = Math.min(...items.map(({ note }) => note.step));
    state.clipboard = items.map(({ track, note }) => ({
      track,
      step: note.step - base,
      length: note.length,
      midiNote: note.midiNote,
    }));
    setStatus(`${items.length}音をコピーしました。クリックで貼り付けできます。`);
  }

  function pasteClipboard(step) {
    if (!state.clipboard?.length || !state.song) return;
    pushUndo();
    const max = totalSteps();
    for (const item of state.clipboard) {
      const target = step + item.step;
      if (target >= max) continue;
      const list = state.song.tracks[item.track];
      list.push({ step: target, length: Math.min(item.length, max - target), midiNote: item.midiNote });
    }
    for (const track of MELODIC_TRACKS) sortAndFixOverlaps(state.song.tracks[track]);
    markDirty();
    requestDraw();
  }

  function deleteSelection() {
    const items = selectionNotes();
    if (!items.length) return;
    pushUndo();
    for (const { track, note } of items) removeNote(track, note);
    state.selection = null;
    markDirty();
    requestDraw();
  }

  // ============================ コードポップアップ ============================

  function chordScalePcs() {
    const defs = state.defs;
    const song = state.song;
    if (!defs || !song) return [];
    let scale = defs.scales[song.key.mode] || defs.scales.major;
    if (scale.length !== 7) scale = song.key.mode === 'wholetone' ? defs.scales.lydian : defs.scales.minor;
    return scale;
  }

  function qualityFromThirdFifth(third, fifth) {
    if (third === 4 && fifth === 7) return 'maj';
    if (third === 3 && fifth === 7) return 'min';
    if (third === 3 && fifth === 6) return 'dim';
    if (third === 4 && fifth === 8) return 'aug';
    return 'maj';
  }

  function chordChoices() {
    const song = state.song;
    const scale = chordScalePcs();
    if (!song || !scale.length) return [];
    const suffix = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus4' };
    const choices = [];
    for (let index = 0; index < 7; index += 1) {
      const rootPc = (song.key.tonicPc + scale[index]) % 12;
      const third = (scale[(index + 2) % 7] - scale[index] + 12) % 12;
      const fifth = (scale[(index + 4) % 7] - scale[index] + 12) % 12;
      const quality = qualityFromThirdFifth(third, fifth);
      choices.push({ rootPc, quality, symbol: `${NOTE_NAMES[rootPc]}${suffix[quality]}` });
    }
    for (const borrowed of [10, 8]) {
      const rootPc = (song.key.tonicPc + borrowed) % 12;
      if (!choices.some((choice) => choice.rootPc === rootPc && choice.quality === 'maj')) {
        choices.push({ rootPc, quality: 'maj', symbol: NOTE_NAMES[rootPc] });
      }
    }
    return choices;
  }

  function showChordPop(bar, clientX) {
    const song = state.song;
    if (!song) return;
    const current = song.chords[bar];
    els.chordPop.innerHTML = `
      <div class="ebc-chord-pop-head">${bar + 1}小節目のコード</div>
      <div class="ebc-chord-pop-list">
        ${chordChoices().map((choice) => (
    `<button type="button" class="${current && current.rootPc === choice.rootPc && current.quality === choice.quality ? 'active' : ''}"
        data-chord-root="${choice.rootPc}" data-chord-quality="${esc(choice.quality)}">${esc(choice.symbol)}</button>`
  )).join('')}
      </div>
    `;
    els.chordPop.hidden = false;
    els.chordPop.dataset.bar = String(bar);
    const scrollRect = els.gridScroll.getBoundingClientRect();
    const x = clampNum(clientX - scrollRect.left, 8, els.gridScroll.clientWidth - 180);
    els.chordPop.style.left = `${x + els.gridScroll.scrollLeft}px`;
    els.chordPop.style.top = `${els.gridScroll.scrollTop + TOP_H + 4}px`;
  }

  function hideChordPop() {
    els.chordPop.hidden = true;
  }

  function applyChordChoice(bar, rootPc, quality) {
    const song = state.song;
    const defs = state.defs;
    if (!song || !defs) return;
    const intervals = defs.qualityIntervals[quality] || defs.qualityIntervals.maj;
    const suffix = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus4' };
    pushUndo();
    song.chords[bar] = {
      bar,
      degree: '',
      rootPc,
      quality,
      symbol: `${NOTE_NAMES[rootPc]}${suffix[quality] ?? ''}`,
      tones: intervals.map((interval) => (rootPc + interval) % 12),
    };
    markDirty();
    requestDraw();
  }

  // ============================ グリッド描画 ============================

  function updateSpacer() {
    const steps = totalSteps();
    const width = LABEL_W + steps * CELL_W + CELL_W;
    const height = TOP_H + PITCH_ROWS * CELL_H + DRUM_H;
    els.gridSpacer.style.width = `${width}px`;
    // canvas は sticky で在来フロー高を占有するため、その分を差し引いて
    // 総スクロール高 = コンテンツ高 に揃える
    const canvasHeight = Math.max(0, els.gridCanvas?.clientHeight || 0);
    els.gridSpacer.style.height = `${Math.max(0, height - canvasHeight)}px`;
  }

  function resetScroll() {
    els.gridScroll.scrollLeft = 0;
    if (state.song) {
      const registerCenter = MIDI_HIGH - 74; // C6付近が上1/4に来るように
      els.gridScroll.scrollTop = clampNum(registerCenter * CELL_H - 40, 0, PITCH_ROWS * CELL_H);
    }
  }

  function resizeCanvas() {
    const container = els.gridScroll;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    els.gridCanvas.width = Math.round(width * dpr);
    els.gridCanvas.height = Math.round(height * dpr);
    els.gridCanvas.style.width = `${width}px`;
    els.gridCanvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateSpacer();
    requestDraw();
  }

  function requestDraw() {
    if (state.drawQueued) return;
    state.drawQueued = true;
    requestAnimationFrame(() => {
      state.drawQueued = false;
      draw();
    });
  }

  function sectionLabelFor(role) {
    return state.defs?.sectionLabels?.[role] || role;
  }

  function draw() {
    const container = els.gridScroll;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, width, height);
    const song = state.song;
    if (!song) {
      ctx.fillStyle = '#5a5d78';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('左の「＋新規」からBGMを作成してください', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }

    const scrollLeft = container.scrollLeft;
    const scrollTop = clampNum(container.scrollTop, 0, Math.max(0, PITCH_ROWS * CELL_H - (height - TOP_H - DRUM_H)));
    const steps = totalSteps();
    const pitchTop = TOP_H;
    const pitchBottom = height - DRUM_H;
    const firstStep = Math.max(0, Math.floor((scrollLeft) / CELL_W));
    const lastStep = Math.min(steps - 1, Math.ceil((scrollLeft + width - LABEL_W) / CELL_W));
    const stepX = (step) => LABEL_W + step * CELL_W - scrollLeft;
    const midiY = (midi) => pitchTop + (MIDI_HIGH - midi) * CELL_H - scrollTop;
    const scalePcs = new Set(chordScalePcs().map((offset) => (song.key.tonicPc + offset) % 12));

    // ---- 音程グリッド ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, pitchTop, width, pitchBottom - pitchTop);
    ctx.clip();

    const firstRow = Math.max(0, Math.floor(scrollTop / CELL_H));
    const lastRow = Math.min(PITCH_ROWS - 1, Math.ceil((scrollTop + pitchBottom - pitchTop) / CELL_H));
    for (let row = firstRow; row <= lastRow; row += 1) {
      const midi = MIDI_HIGH - row;
      const y = midiY(midi);
      const pc = ((midi % 12) + 12) % 12;
      ctx.fillStyle = scalePcs.has(pc) ? '#181a2c' : '#131422';
      if (pc === song.key.tonicPc) ctx.fillStyle = '#1c1f36';
    ctx.fillRect(0, y, width, CELL_H);
    }

    // コードトーンハイライト(小節ごと)
    const firstBar = Math.floor(firstStep / STEPS_PER_BAR);
    const lastBar = Math.floor(lastStep / STEPS_PER_BAR);
    for (let bar = firstBar; bar <= lastBar; bar += 1) {
      const chord = song.chords[bar];
      if (!chord) continue;
      const tones = new Set(chord.tones);
      const x0 = Math.max(LABEL_W, stepX(bar * STEPS_PER_BAR));
      const x1 = Math.min(width, stepX((bar + 1) * STEPS_PER_BAR));
      if (x1 <= x0) continue;
      for (let row = firstRow; row <= lastRow; row += 1) {
        const midi = MIDI_HIGH - row;
        const pc = ((midi % 12) + 12) % 12;
        if (!tones.has(pc)) continue;
        const y = midiY(midi);
        ctx.fillStyle = pc === chord.rootPc ? 'rgba(126,150,255,0.16)' : 'rgba(126,150,255,0.08)';
        ctx.fillRect(x0, y, x1 - x0, CELL_H);
      }
    }

    // 縦線
    for (let step = firstStep; step <= lastStep + 1; step += 1) {
      const x = stepX(step);
      if (x < LABEL_W - CELL_W) continue;
      if (step % STEPS_PER_BAR === 0) ctx.strokeStyle = 'rgba(140,150,220,0.4)';
      else if (step % 4 === 0) ctx.strokeStyle = 'rgba(140,150,220,0.18)';
      else ctx.strokeStyle = 'rgba(140,150,220,0.07)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, pitchTop);
      ctx.lineTo(x + 0.5, pitchBottom);
      ctx.stroke();
    }
    // 横線
    for (let row = firstRow; row <= lastRow + 1; row += 1) {
      const y = pitchTop + row * CELL_H - scrollTop;
      ctx.strokeStyle = 'rgba(140,150,220,0.06)';
      ctx.beginPath();
      ctx.moveTo(LABEL_W, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    // セクション境界
    if (song.sections.length > 1) {
      ctx.font = 'bold 11px sans-serif';
      for (const section of song.sections) {
        const x = stepX(section.startBar * STEPS_PER_BAR);
        if (x < LABEL_W - 200 || x > width) continue;
        ctx.strokeStyle = 'rgba(255,210,74,0.45)';
        ctx.beginPath();
        ctx.moveTo(x + 0.5, pitchTop);
        ctx.lineTo(x + 0.5, pitchBottom);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,210,74,0.8)';
        ctx.fillText(sectionLabelFor(section.role), x + 5, pitchTop + 13);
      }
    }

    // 選択範囲
    if (state.selection) {
      const sel = state.selection;
      const x0 = stepX(sel.stepMin);
      const x1 = stepX(sel.stepMax + 1);
      const y0 = midiY(sel.midiMax);
      const y1 = midiY(sel.midiMin - 1);
      ctx.fillStyle = 'rgba(232,232,240,0.08)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = 'rgba(232,232,240,0.5)';
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    }

    // ノート
    for (const track of MELODIC_TRACKS) {
      const color = TRACK_COLORS[track];
      const active = state.tool === track;
      for (const note of song.tracks[track]) {
        if (note.step + note.length < firstStep || note.step > lastStep + 1) continue;
        const x = stepX(note.step);
        const y = midiY(note.midiNote);
        const noteWidth = note.length * CELL_W;
        ctx.globalAlpha = active || state.tool === 'extend' || state.tool === 'select' || state.tool === 'erase' ? 1 : 0.75;
        ctx.fillStyle = color;
        const radius = Math.min(6, CELL_H / 2 - 1);
        roundRect(ctx, x + 1.5, y + 1.5, Math.max(CELL_W - 3, noteWidth - 3), CELL_H - 3, radius);
        ctx.fill();
        if (note.length > 1) {
          ctx.globalAlpha *= 0.85;
          roundRect(ctx, x + 1.5, y + 1.5, noteWidth - 3, CELL_H - 3, radius);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // ---- 左ラベル列(音名) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, pitchTop, LABEL_W, pitchBottom - pitchTop);
    ctx.clip();
    ctx.fillStyle = '#171827';
    ctx.fillRect(0, pitchTop, LABEL_W, pitchBottom - pitchTop);
    ctx.font = '10px monospace';
    for (let row = firstRow; row <= lastRow; row += 1) {
      const midi = MIDI_HIGH - row;
      const pc = ((midi % 12) + 12) % 12;
      const y = midiY(midi);
      const name = midiToName(midi);
      ctx.fillStyle = pc === song.key.tonicPc ? '#ffd24a' : NOTE_NAMES[pc].includes('#') ? '#454a66' : '#8b90ad';
      ctx.fillText(name, 8, y + CELL_H - 4);
      if (pc === 0) {
        ctx.strokeStyle = 'rgba(140,150,220,0.25)';
        ctx.beginPath();
        ctx.moveTo(0, y + CELL_H + 0.5);
        ctx.lineTo(LABEL_W, y + CELL_H + 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ---- コード行 + ルーラー ----
    ctx.fillStyle = '#1a1c30';
    ctx.fillRect(0, 0, width, TOP_H);
    ctx.font = 'bold 12px monospace';
    for (let bar = firstBar; bar <= lastBar; bar += 1) {
      const chord = song.chords[bar];
      const x = stepX(bar * STEPS_PER_BAR);
      ctx.strokeStyle = 'rgba(140,150,220,0.3)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, TOP_H);
      ctx.stroke();
      if (chord) {
        ctx.fillStyle = '#ffd24a';
        ctx.fillText(chord.symbol, x + 6, CHORD_H - 8);
      }
    }
    ctx.font = '10px monospace';
    for (let step = firstStep; step <= lastStep; step += 1) {
      const x = stepX(step);
      if (step % STEPS_PER_BAR === 0) {
        ctx.fillStyle = '#c6cadf';
        ctx.fillText(String(step / STEPS_PER_BAR + 1), x + 4, TOP_H - 4);
      } else if (step % 4 === 0) {
        ctx.fillStyle = '#5a5d78';
        ctx.fillText('·', x + 6, TOP_H - 4);
      }
    }
    // 左上コーナー
    ctx.fillStyle = '#171827';
    ctx.fillRect(0, 0, LABEL_W, TOP_H);
    ctx.fillStyle = '#8b90ad';
    ctx.font = '10px sans-serif';
    ctx.fillText('コード', 8, CHORD_H - 9);

    // ---- ドラム行 ----
    const drumTop = pitchBottom + DRUM_GAP;
    ctx.fillStyle = '#101120';
    ctx.fillRect(0, pitchBottom, width, DRUM_H);
    DRUM_ORDER.forEach((drum, index) => {
      const y = drumTop + index * DRUM_CELL_H;
      ctx.fillStyle = index % 2 ? '#131424' : '#15172a';
      ctx.fillRect(LABEL_W, y, width - LABEL_W, DRUM_CELL_H);
      for (let step = firstStep; step <= lastStep + 1; step += 1) {
        const x = stepX(step);
        ctx.strokeStyle = step % STEPS_PER_BAR === 0 ? 'rgba(140,150,220,0.35)' : step % 4 === 0 ? 'rgba(140,150,220,0.15)' : 'rgba(140,150,220,0.05)';
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + DRUM_CELL_H);
        ctx.stroke();
      }
      const stepsList = song.drums[drum] || [];
      ctx.fillStyle = DRUM_COLORS[drum];
      for (const step of stepsList) {
        if (step < firstStep - 1 || step > lastStep + 1) continue;
        const x = stepX(step);
        ctx.beginPath();
        ctx.arc(x + CELL_W / 2, y + DRUM_CELL_H / 2, Math.min(6, DRUM_CELL_H / 2 - 3), 0, Math.PI * 2);
        ctx.fill();
      }
      // ラベル
      ctx.fillStyle = '#171827';
      ctx.fillRect(0, y, LABEL_W, DRUM_CELL_H);
      ctx.fillStyle = DRUM_COLORS[drum];
      ctx.font = '10px sans-serif';
      ctx.fillText(state.defs?.drumLabels?.[drum] || drum, 8, y + DRUM_CELL_H - 6);
    });

    // ---- 再生カーソル ----
    if (state.playhead >= 0) {
      const x = stepX(state.playhead);
      if (x >= LABEL_W - CELL_W && x <= width) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + CELL_W / 2, 0);
        ctx.lineTo(x + CELL_W / 2, height);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  // ============================ グリッド操作 ============================

  function hitTest(event) {
    const rect = els.gridCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const container = els.gridScroll;
    const height = container.clientHeight;
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const step = Math.floor((x + scrollLeft - LABEL_W) / CELL_W);
    if (x < LABEL_W) return { region: 'label' };
    if (step < 0 || step >= totalSteps()) return { region: 'outside' };
    if (y < CHORD_H) return { region: 'chord', bar: Math.floor(step / STEPS_PER_BAR), clientX: event.clientX };
    if (y < TOP_H) return { region: 'ruler', step };
    const pitchBottom = height - DRUM_H;
    if (y >= pitchBottom + DRUM_GAP) {
      const drumIndex = Math.floor((y - pitchBottom - DRUM_GAP) / DRUM_CELL_H);
      if (drumIndex >= 0 && drumIndex < DRUM_ORDER.length) {
        return { region: 'drum', drum: DRUM_ORDER[drumIndex], step };
      }
      return { region: 'outside' };
    }
    if (y >= pitchBottom) return { region: 'outside' };
    const midi = MIDI_HIGH - Math.floor((y - TOP_H + scrollTop) / CELL_H);
    if (midi < MIDI_LOW || midi > MIDI_HIGH) return { region: 'outside' };
    return { region: 'pitch', step, midi };
  }

  function onGridPointerDown(event) {
    if (!state.song || event.button !== 0) return;
    hideChordPop();
    const hit = hitTest(event);
    if (hit.region === 'chord') {
      showChordPop(hit.bar, hit.clientX);
      return;
    }
    if (hit.region === 'ruler') {
      // 拍クリック: 途中再生の代わりに再生ヘッド表示のみ(v1)
      return;
    }
    if (hit.region === 'drum') {
      pushUndo();
      const on = toggleDrum(hit.drum, hit.step);
      state.drag = { kind: 'drum', drum: hit.drum, mode: on ? 'on' : 'off', last: hit.step };
      if (on) void previewPlacement({ drum: hit.drum });
      markDirty();
      requestDraw();
      return;
    }
    if (hit.region !== 'pitch') return;

    const tool = state.tool;
    if (MELODIC_TRACKS.includes(tool)) {
      const existing = findNoteAt(tool, hit.step, hit.midi);
      pushUndo();
      if (existing && existing.step === hit.step) {
        removeNote(tool, existing);
        state.drag = { kind: 'erase-track', track: tool, last: `${hit.step}:${hit.midi}` };
      } else {
        placeNote(tool, hit.step, hit.midi);
        state.drag = { kind: 'paint', track: tool, last: `${hit.step}:${hit.midi}` };
        void previewPlacement({ track: tool, midi: hit.midi });
      }
      markDirty();
      requestDraw();
      return;
    }
    if (tool === 'extend') {
      const found = findAnyNoteAt(hit.step, hit.midi);
      if (found) {
        pushUndo();
        state.drag = { kind: 'extend', track: found.track, note: found.note };
      }
      return;
    }
    if (tool === 'erase') {
      pushUndo();
      const removed = eraseAt(hit.step, hit.midi);
      state.drag = { kind: 'erase-any', changed: removed };
      if (removed) {
        markDirty();
        requestDraw();
      }
      return;
    }
    if (tool === 'select') {
      if (state.selection && state.clipboard?.length
        && !(hit.step >= state.selection.stepMin && hit.step <= state.selection.stepMax
          && hit.midi >= state.selection.midiMin && hit.midi <= state.selection.midiMax)) {
        pasteClipboard(hit.step);
        return;
      }
      state.selection = { stepMin: hit.step, stepMax: hit.step, midiMin: hit.midi, midiMax: hit.midi };
      state.drag = { kind: 'select', anchorStep: hit.step, anchorMidi: hit.midi };
      requestDraw();
      return;
    }
    if (tool === 'noise') {
      // ノイズツールはドラム行専用。音程グリッドでは何もしない。
    }
  }

  function onGridPointerMove(event) {
    if (!state.drag || !state.song) return;
    const hit = hitTest(event);
    const drag = state.drag;
    if (drag.kind === 'drum' && hit.region === 'drum' && hit.drum === drag.drum && hit.step !== drag.last) {
      drag.last = hit.step;
      toggleDrum(drag.drum, hit.step, drag.mode);
      markDirty();
      requestDraw();
      return;
    }
    if (hit.region !== 'pitch') return;
    if (drag.kind === 'paint') {
      const key = `${hit.step}:${hit.midi}`;
      if (key !== drag.last) {
        drag.last = key;
        placeNote(drag.track, hit.step, hit.midi);
        markDirty();
        requestDraw();
      }
      return;
    }
    if (drag.kind === 'erase-track') {
      const note = findNoteAt(drag.track, hit.step, hit.midi);
      if (note) {
        removeNote(drag.track, note);
        markDirty();
        requestDraw();
      }
      return;
    }
    if (drag.kind === 'erase-any') {
      if (eraseAt(hit.step, hit.midi)) {
        drag.changed = true;
        markDirty();
        requestDraw();
      }
      return;
    }
    if (drag.kind === 'extend') {
      const note = drag.note;
      const list = state.song.tracks[drag.track];
      const next = list.find((item) => item.step > note.step);
      const maxLen = Math.min(
        (next ? next.step : totalSteps()) - note.step,
        totalSteps() - note.step,
      );
      const nextLen = clampNum(hit.step - note.step + 1, 1, Math.max(1, maxLen));
      if (nextLen !== note.length) {
        note.length = nextLen;
        markDirty();
        requestDraw();
      }
      return;
    }
    if (drag.kind === 'select') {
      state.selection = {
        stepMin: Math.min(drag.anchorStep, hit.step),
        stepMax: Math.max(drag.anchorStep, hit.step),
        midiMin: Math.min(drag.anchorMidi, hit.midi),
        midiMax: Math.max(drag.anchorMidi, hit.midi),
      };
      requestDraw();
    }
  }

  function onGridPointerUp() {
    if (!state.drag) return;
    if (state.drag.kind === 'erase-any' && !state.drag.changed) state.undoStack.pop();
    state.drag = null;
  }

  // ============================ イベント配線 ============================

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    switch (action) {
      case 'new': await createSong(); break;
      case 'select-song': await selectSong(button.dataset.songId); break;
      case 'rename-song': await renameSong(button.dataset.songId); break;
      case 'delete-song': await deleteSong(button.dataset.songId); break;
      case 'play': await playSong(); break;
      case 'stop': stopPlayback(); break;
      case 'shuffle': await runCompose({ jitter: false }); break;
      case 'super-shuffle': await runCompose({ superShuffle: true }); break;
      case 'set-theme': await runCompose({ themeId: button.dataset.themeId, jitter: true }); break;
      case 'set-bars': await changeBars(Number(button.dataset.bars)); break;
      case 'set-tool':
        state.tool = button.dataset.tool;
        state.selection = null;
        syncControls();
        requestDraw();
        break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'clear': await clearNotes(); break;
      case 'export': await exportToGame(); break;
      case 'mixer-mute':
      case 'mixer-solo': {
        const song = state.song;
        if (!song) break;
        const track = button.dataset.track;
        pushUndo();
        if (action === 'mixer-mute') song.mixer[track].mute = !song.mixer[track].mute;
        else song.mixer[track].solo = !song.mixer[track].solo;
        markDirty();
        syncControls();
        break;
      }
      default: break;
    }
  });

  root.addEventListener('input', (event) => {
    const song = state.song;
    if (!song) return;
    const target = event.target;
    if (target.dataset.field === 'tempo') {
      song.tempo = Number(target.value);
      els.tempoValue.textContent = target.value;
      markDirty();
      return;
    }
    if (target.dataset.attr) {
      song.attributes[target.dataset.attr] = Number(target.value);
      const valueEl = root.querySelector(`[data-attr-value="${target.dataset.attr}"]`);
      if (valueEl) valueEl.textContent = target.value;
      markDirty();
      return;
    }
    if (target.dataset.mixerVolume) {
      song.mixer[target.dataset.mixerVolume].volume = Number(target.value);
      markDirty();
    }
  });

  root.addEventListener('change', (event) => {
    const song = state.song;
    if (!song) return;
    const target = event.target;
    if (target.dataset.field === 'loop') {
      song.loop = target.checked;
      markDirty();
    } else if (target.dataset.field === 'sequence') {
      song.options.sequence = target.checked;
      void runCompose();
    } else if (target.dataset.field === 'cadence') {
      song.options.cadence = target.checked;
      void runCompose();
    } else if (target.dataset.field === 'chordPreset') {
      song.options.chordPresetId = target.value || null;
      void runCompose();
    } else if (target.dataset.attr) {
      // スライダーは input で値を反映済み。ドラッグ終了(change)で
      // 実際に作り直して「設定が反映されたか分からない」を防ぐ
      void runCompose();
    }
  });

  els.chordPop.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chord-root]');
    if (!button) return;
    const bar = Number(els.chordPop.dataset.bar || 0);
    applyChordChoice(bar, Number(button.dataset.chordRoot), button.dataset.chordQuality);
    hideChordPop();
  });

  els.gridCanvas.addEventListener('mousedown', onGridPointerDown);
  window.addEventListener('mousemove', onGridPointerMove);
  window.addEventListener('mouseup', onGridPointerUp);
  els.gridScroll.addEventListener('scroll', () => {
    hideChordPop();
    requestDraw();
  });

  const onKeyDown = (event) => {
    if (!root.classList.contains('active')) return;
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state.playing) stopPlayback();
      else void playSong();
      return;
    }
    if (!state.song) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (state.selection) {
        event.preventDefault();
        copySelection();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selection) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (event.key === 'Escape') {
      state.selection = null;
      hideChordPop();
      requestDraw();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // ============================ ゲーム登録 ============================

  async function exportToGame() {
    const song = state.song;
    if (!song) return;
    await flushSave();
    const resList = await api.electronAPI.listResDefinitions?.();
    const resFiles = resList?.ok ? (resList.files || []).map((file) => file.file) : [];
    const defaultFile = song.lastExport?.resFile
      || (resFiles.includes('resources.res') ? 'resources.res' : resFiles[0] || 'resources.res');
    const defaultSymbol = song.lastExport?.symbol || `easy_${String(song.id).replace(/^song_/, '').slice(0, 8)}`;

    let symbol = defaultSymbol;
    let resFile = defaultFile;
    const ok = await openDialog({
      title: 'ゲームに登録',
      bodyHtml: `
        <p>VGMを書き出して XGM2 アセットとして登録します。</p>
        <label class="ebc-modal-label">シンボル名(半角英数)
          <input type="text" class="ebc-input" data-modal-field="symbol" value="${esc(defaultSymbol)}" maxlength="32">
        </label>
        <label class="ebc-modal-label">登録先 .res ファイル
          <select class="ebc-select" data-modal-field="resfile">
            ${(resFiles.length ? resFiles : ['resources.res']).map((file) => (
    `<option value="${esc(file)}" ${file === defaultFile ? 'selected' : ''}>${esc(file)}</option>`
  )).join('')}
          </select>
        </label>
      `,
      okLabel: '登録',
      onOpen: (panel) => {
        const symbolInput = panel.querySelector('[data-modal-field="symbol"]');
        const fileSelect = panel.querySelector('[data-modal-field="resfile"]');
        symbolInput.addEventListener('input', () => { symbol = symbolInput.value; });
        fileSelect.addEventListener('change', () => { resFile = fileSelect.value; });
        symbolInput.focus();
      },
    });
    if (!ok) return;

    setStatus('書き出し中...');
    const result = await invokeHook('exportEasySongToGame', { song, symbol });
    if (!result?.ok) {
      setStatus(`書き出し失敗: ${result?.error || 'unknown'}`);
      return;
    }
    const finalSymbol = result.symbol;
    const alreadyRegistered = resList?.ok && (resList.files || []).some((file) => (
      (file.entries || []).some((entry) => String(entry.name) === finalSymbol)
    ));
    const isReExport = song.lastExport?.symbol === finalSymbol;
    if (alreadyRegistered && !isReExport) {
      setStatus(`シンボル「${finalSymbol}」は既に登録されています。ファイルのみ更新しました。`);
    } else if (!alreadyRegistered) {
      const added = await api.electronAPI.addResEntry?.({ file: resFile, entry: result.asset });
      if (!added?.ok) {
        setStatus(`アセット登録失敗: ${added?.error || 'unknown'}`);
        return;
      }
    }
    song.lastExport = { resFile, symbol: finalSymbol, vgmPath: result.files.vgm };
    markDirty();
    await flushSave();
    const reloadResources = api?.assets?.reloadResources;
    if (typeof reloadResources === 'function') {
      const reloaded = reloadResources.call(api.assets);
      if (reloaded && typeof reloaded.catch === 'function') {
        await reloaded.catch(() => {});
      }
    }
    setStatus(`「${finalSymbol}」を登録しました (${result.files.vgm})。ビルドでゲームに組み込まれます。`);
  }

  // ============================ 初期化 ============================

  const defsRes = await invokeHook('listEasyDefs', {});
  if (defsRes?.ok) {
    state.defs = defsRes.defs;
  } else {
    setStatus(`定義の読み込みに失敗しました: ${defsRes?.error || 'unknown'}`);
  }
  renderComposePanel();
  updateSpacer();
  await refreshSongs({ keepSelection: false });
  syncControls();
  resizeCanvas();
  resetScroll();
  requestDraw();
  renderStatus();

  state.resizeObserver = new ResizeObserver(() => resizeCanvas());
  state.resizeObserver.observe(els.gridScroll);

  state.observer = new MutationObserver(() => {
    if (root.classList.contains('active')) {
      void refreshSongs();
      resizeCanvas();
    }
  });
  state.observer.observe(root, { attributes: true, attributeFilter: ['class'] });

  registerCapability('easy-bgm-composer', {
    version: 1,
    getCurrentSongId: () => state.currentId,
  });

  logger?.info?.('かんたん作曲 UI を初期化しました');

  return {
    deactivate() {
      clearTimeout(state.saveTimer);
      void flushSave();
      stopPlayback({ silent: true });
      state.observer?.disconnect();
      state.resizeObserver?.disconnect();
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', onGridPointerMove);
      window.removeEventListener('mouseup', onGridPointerUp);
      modalHandle.destroy?.();
    },
  };
}
