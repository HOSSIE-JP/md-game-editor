/**
 * md-emulator.js  — Mega Drive エミュレーター埋め込みラッパー
 *
 * 使い方（最小例）:
 *   import MdEmulator from './md-emulator.js';
 *   const emu = new MdEmulator({ wasmJsUrl: './pkg/md_wasm.js' });
 *   await emu.init();
 *   emu.attachCanvas(document.querySelector('canvas'));
 *   await emu.loadRom(romBytes);
 *   emu.play();
 *
 * 詳細は docs/embedding.md を参照。
 */

// ──────────────────────────────────────────────────
// 定数
// ──────────────────────────────────────────────────

/** コントローラーボタンビットマスク */
const BUTTONS = Object.freeze({
  UP:    0x01,
  DOWN:  0x02,
  LEFT:  0x04,
  RIGHT: 0x08,
  B:     0x10,
  C:     0x20,
  A:     0x40,
  START: 0x80,
});

const TARGET_FPS           = 60;
const FRAME_MS             = 1000 / TARGET_FPS;
const AUDIO_SAMPLE_RATE    = 48000;
const AUDIO_PULL_FRAMES    = Math.ceil(AUDIO_SAMPLE_RATE / TARGET_FPS);
const AUDIO_MAX_AHEAD_SEC  = 0.05;
const AUDIO_AHEAD_RESET_SEC = 0.02;

// ──────────────────────────────────────────────────
// MdEmulator クラス
// ──────────────────────────────────────────────────

/**
 * Mega Drive エミュレーターの埋め込みラッパークラス。
 *
 * EventTarget を継承しており、以下のカスタムイベントを発行する:
 *   - `ready`     : WASM の初期化完了後
 *   - `romloaded` : ROM のロード完了後（detail: { sramRestored: boolean }）
 *   - `frame`     : フレーム描画後（detail: { frame: number }）
 *   - `error`     : エラー発生時（detail: { message: string, cause?: Error }）
 */
export default class MdEmulator extends EventTarget {
  // ── Static ──

  /** コントローラーボタンビットマスク定数 */
  static get Buttons() {
    return BUTTONS;
  }

  // ── Constructor ──

  /**
   * @param {object} [options]
   * @param {string}  [options.wasmJsUrl='./pkg/md_wasm.js'] WASM JSラッパーのURL
   * @param {boolean} [options.audio=true]   オーディオを有効にするか
   * @param {boolean} [options.sram=true]    IndexedDB SRAM 自動保存を有効にするか
   * @param {number}  [options.sramAutoSaveFrames=300] SRAM 自動保存の間隔（フレーム数）
   */
  constructor(options = {}) {
    super();
    this._opts = {
      wasmJsUrl:          options.wasmJsUrl ?? './pkg/md_wasm.js',
      audio:              options.audio     ?? true,
      sram:               options.sram      ?? true,
      sramAutoSaveFrames: options.sramAutoSaveFrames ?? 300,
    };

    /** @type {any|null} wasm-bindgen が生成した EmulatorHandle インスタンス */
    this._handle       = null;
    this._wasmModule   = null;
    this._ready        = false;
    this._running      = false;
    this._rafId        = null;
    this._lastTs       = 0;
    this._accumulator  = 0;
    this._frameCount   = 0;

    // Canvas
    this._canvas       = null;
    this._ctx          = null;
    this._imageData    = null;

    // Audio
    this._audioContext = null;
    this._audioNextTime = 0;
    this._audioMuted   = false;

    // SRAM
    this._sramKey          = null;
    this._sramFrameCounter = 0;
  }

  // ── Public: 初期化 ──

  /**
   * WASM モジュールをロードして初期化する。
   * 成功後に `ready` イベントを発行する。
   * @returns {Promise<void>}
   */
  async init() {
    try {
      this._wasmModule = await import(this._opts.wasmJsUrl);
      await this._wasmModule.default(this._opts.wasmJsUrl.replace(/\.js([?#].*)?$/, '_bg.wasm$1'));
      this._handle = new this._wasmModule.EmulatorHandle();
      this._ready  = true;
      this.dispatchEvent(new CustomEvent('ready'));
    } catch (e) {
      this._emitError('WASM 初期化に失敗しました', e);
      throw e;
    }
  }

  /**
   * 明示的に WASM URL と .wasm URL を別々に指定して初期化する。
   * バンドラー (Vite / webpack) を使う場合はこちらを推奨。
   *
   * @param {string}          jsUrl    WASM JS ラッパーの URL
   * @param {string|Request}  wasmUrl  .wasm バイナリの URL または Response
   * @returns {Promise<void>}
   */
  async initExplicit(jsUrl, wasmUrl) {
    try {
      this._wasmModule = await import(jsUrl);
      await this._wasmModule.default(wasmUrl);
      this._handle = new this._wasmModule.EmulatorHandle();
      this._ready  = true;
      this.dispatchEvent(new CustomEvent('ready'));
    } catch (e) {
      this._emitError('WASM 初期化に失敗しました', e);
      throw e;
    }
  }

  // ── Public: Canvas ──

  /**
   * 描画対象の canvas 要素をアタッチする。
   * 320×224 の canvas を推奨。
   * @param {HTMLCanvasElement} canvas
   */
  attachCanvas(canvas) {
    this._canvas    = canvas;
    this._ctx       = canvas.getContext('2d');
    this._imageData = this._ctx.createImageData(canvas.width, canvas.height);
  }

  /**
   * アタッチ済み canvas を切り離す。
   */
  detachCanvas() {
    this._canvas    = null;
    this._ctx       = null;
    this._imageData = null;
  }

  // ── Public: ROM 操作 ──

  /**
   * ROM をロードする。
   *
   * @param {ArrayBuffer|Uint8Array|File|Blob} data
   * @param {string} [label]  SRAM 保存に使うキー名（省略時はファイル名または "rom"）
   * @returns {Promise<void>}
   */
  async loadRom(data, label) {
    this._assertReady();
    const bytes = await this._toUint8Array(data);
    const romLabel = label ?? (data instanceof File ? data.name : 'rom');
    this._stopLoop();
    try {
      this._handle.load_rom(bytes);
      this._handle.reset();
    } catch (e) {
      this._emitError('ROM のロードに失敗しました', e);
      throw e;
    }
    this._frameCount   = 0;
    this._sramFrameCounter = 0;

    let sramRestored = false;
    if (this._opts.sram) {
      this._sramKey = _computeRomKey(bytes, romLabel);
      sramRestored  = await this._restoreSram();
    }
    this.dispatchEvent(new CustomEvent('romloaded', { detail: { sramRestored } }));
  }

  // ── Public: 実行制御 ──

  /** エミュレーターを再生（フレームループ開始）する。 */
  play() {
    this._assertReady();
    if (this._running) return;
    this._startLoop();
  }

  /** エミュレーターを一時停止する。 */
  pause() {
    this._stopLoop();
  }

  /** ソフトリセットを行う。 */
  reset() {
    this._assertReady();
    this._stopLoop();
    this._handle.reset();
    this._frameCount  = 0;
  }

  /**
   * 1 フレームだけ手動で進める（ステップ実行）。
   * 停止中のみ有効。
   */
  stepFrame() {
    this._assertReady();
    if (this._running) return;
    this._runOneFrame();
  }

  /**
   * n サイクルだけ進める。
   * @param {number} cycles
   */
  step(cycles) {
    this._assertReady();
    this._handle.step(cycles);
  }

  /**
   * 1 M68K 命令だけ進める（デバッグ用）。
   */
  stepInstruction() {
    this._assertReady();
    this._handle.step_instruction();
  }

  // ── Public: コントローラー入力 ──

  /**
   * コントローラーのボタン状態を設定する。
   * @param {number} player   プレイヤー番号（1 または 2）
   * @param {number} buttons  ビットマスク（MdEmulator.Buttons の OR 結合）
   */
  setInput(player, buttons) {
    if (!this._handle) return;
    this._handle.set_controller_state(player, buttons);
  }

  // ── Public: セーブ・ロード ──

  /**
   * エミュレーター状態をスナップショットとして取得する。
   * @returns {Uint8Array}
   */
  saveState() {
    this._assertReady();
    try {
      return this._handle.save_state();
    } catch (e) {
      this._emitError('状態の保存に失敗しました', e);
      throw e;
    }
  }

  /**
   * スナップショットから状態を復元する。
   * @param {Uint8Array|ArrayBuffer} data
   */
  loadState(data) {
    this._assertReady();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    try {
      this._handle.load_state(bytes);
    } catch (e) {
      this._emitError('状態の復元に失敗しました', e);
      throw e;
    }
  }

  // ── Public: SRAM ──

  /** ROM が SRAM をサポートしているか返す。 */
  hasSram() {
    return this._handle ? this._handle.has_sram() : false;
  }

  /**
   * SRAM の内容をバイト列で返す。
   * @returns {Uint8Array}
   */
  getSram() {
    this._assertReady();
    return this._handle.get_sram();
  }

  /**
   * SRAM の内容を復元する。
   * @param {Uint8Array|ArrayBuffer} data
   */
  loadSram(data) {
    this._assertReady();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this._handle.load_sram(bytes);
  }

  // ── Public: オーディオ ──

  /**
   * オーディオのミュート状態を切り替える。
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._audioMuted = muted;
  }

  /** @returns {boolean} */
  get muted() {
    return this._audioMuted;
  }

  /**
   * AudioContext が存在する場合に返す（高度な制御用）。
   * @returns {AudioContext|null}
   */
  get audioContext() {
    return this._audioContext;
  }

  // ── Public: デバッグ ──

  /**
   * 生の EmulatorHandle を返す（上級者向け）。
   * wasm-bindgen が生成した全 API に直接アクセスできる。
   * @returns {any|null}
   */
  get handle() {
    return this._handle;
  }

  /** @returns {boolean} WASM が初期化済みか */
  get ready() {
    return this._ready;
  }

  /** @returns {boolean} フレームループが動作中か */
  get running() {
    return this._running;
  }

  /** @returns {number} 現在のフレームカウント */
  get frameCount() {
    return this._frameCount;
  }

  /**
   * メモリをバイト列で読み出す。
   * @param {number} address
   * @param {number} length
   * @returns {Uint8Array}
   */
  getMemory(address, length) {
    this._assertReady();
    return this._handle.get_memory(address, length);
  }

  /**
   * CPU レジスタ状態を返す。
   * @returns {object}
   */
  getCpuState() {
    this._assertReady();
    return this._handle.get_cpu_state();
  }

  /**
   * ブレークポイントを設定する。
   * @param {number} address
   */
  setBreakpoint(address) {
    this._assertReady();
    this._handle.set_breakpoint(address);
  }

  /**
   * ビルドバージョン（タイムスタンプ）を返す。
   * @returns {string}
   */
  get buildVersion() {
    return this._wasmModule?.EmulatorHandle?.build_version?.() ?? 'unknown';
  }

  // ── Public: 後片付け ──

  /**
   * フレームループを止め、AudioContext を閉じてリソースを解放する。
   */
  destroy() {
    this._stopLoop();
    if (this._audioContext) {
      this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }
    this._handle  = null;
    this._ready   = false;
  }

  // ──────────────────────────────────────────────────
  // Private: フレームループ
  // ──────────────────────────────────────────────────

  _startLoop() {
    this._running     = true;
    this._lastTs      = 0;
    this._accumulator = 0;
    this._rafId       = requestAnimationFrame((ts) => this._frameTick(ts));
  }

  _stopLoop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _frameTick(ts) {
    if (!this._running) return;
    if (!this._lastTs) this._lastTs = ts;
    this._accumulator += ts - this._lastTs;
    this._lastTs = ts;

    // ブラウザが停止した後の蓄積を最大 3 フレームに抑制
    if (this._accumulator > FRAME_MS * 3) this._accumulator = FRAME_MS * 3;

    while (this._accumulator >= FRAME_MS) {
      this._accumulator -= FRAME_MS;
      this._runOneFrame();
    }
    this._rafId = requestAnimationFrame((ts) => this._frameTick(ts));
  }

  _runOneFrame() {
    if (!this._handle) return;
    this._handle.run_frame();

    if (this._canvas && this._ctx && this._imageData) {
      const pixels = this._handle.get_framebuffer_argb();
      _argbToImageData(pixels, this._imageData, this._canvas.width, this._canvas.height);
      this._ctx.putImageData(this._imageData, 0, 0);
    }

    if (this._opts.audio && !this._audioMuted) {
      this._drainAudio();
    }

    this._frameCount += 1;

    // SRAM 自動保存
    if (this._opts.sram && this._handle.has_sram?.()) {
      this._sramFrameCounter += 1;
      if (this._sramFrameCounter >= this._opts.sramAutoSaveFrames) {
        this._sramFrameCounter = 0;
        this._autoSaveSram().catch(() => {});
      }
    }

    this.dispatchEvent(new CustomEvent('frame', { detail: { frame: this._frameCount } }));
  }

  // ──────────────────────────────────────────────────
  // Private: オーディオ
  // ──────────────────────────────────────────────────

  _ensureAudio() {
    if (!this._audioContext) {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: AUDIO_SAMPLE_RATE,
      });
      this._audioNextTime = 0;
    }
  }

  _drainAudio() {
    if (!this._handle) return;
    this._ensureAudio();
    const ctx = this._audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const rawSamples = this._handle.take_audio_samples(AUDIO_PULL_FRAMES);
    if (!rawSamples || rawSamples.length < 2) return;

    const frameCount = Math.floor(rawSamples.length / 2);
    const buffer     = ctx.createBuffer(2, frameCount, AUDIO_SAMPLE_RATE);
    const left       = buffer.getChannelData(0);
    const right      = buffer.getChannelData(1);
    for (let i = 0; i < frameCount; i++) {
      left[i]  = rawSamples[i * 2]     ?? 0;
      right[i] = rawSamples[i * 2 + 1] ?? 0;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (this._audioNextTime < now) this._audioNextTime = now;
    if (this._audioNextTime > now + AUDIO_MAX_AHEAD_SEC) {
      this._audioNextTime = now + AUDIO_AHEAD_RESET_SEC;
    }
    source.start(this._audioNextTime);
    this._audioNextTime += buffer.duration;
  }

  // ──────────────────────────────────────────────────
  // Private: SRAM
  // ──────────────────────────────────────────────────

  async _restoreSram() {
    if (!this._handle?.has_sram?.()) return false;
    const saved = await _loadSramFromDb(this._sramKey);
    if (!saved || saved.length === 0) return false;
    try {
      this._handle.load_sram(saved);
      return true;
    } catch {
      return false;
    }
  }

  async _autoSaveSram() {
    if (!this._handle || !this._sramKey) return;
    try {
      const data = this._handle.get_sram();
      if (data && data.length > 0) await _saveSramToDb(this._sramKey, data);
    } catch {
      // サイレントフェイル
    }
  }

  // ──────────────────────────────────────────────────
  // Private: ユーティリティ
  // ──────────────────────────────────────────────────

  _assertReady() {
    if (!this._ready || !this._handle) {
      throw new Error('MdEmulator が初期化されていません。init() を先に呼んでください。');
    }
  }

  /**
   * 様々な入力型を Uint8Array に変換する。
   * @param {ArrayBuffer|Uint8Array|File|Blob} data
   * @returns {Promise<Uint8Array>}
   */
  async _toUint8Array(data) {
    if (data instanceof Uint8Array)   return data;
    if (data instanceof ArrayBuffer)  return new Uint8Array(data);
    if (data instanceof File || data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    throw new TypeError('ROM データの形式が不正です。ArrayBuffer, Uint8Array, File, または Blob を渡してください。');
  }

  _emitError(message, cause) {
    this.dispatchEvent(new CustomEvent('error', { detail: { message, cause } }));
  }
}

// ──────────────────────────────────────────────────
// モジュールスコープのユーティリティ（非公開）
// ──────────────────────────────────────────────────

/**
 * ARGB Uint32Array → ImageData (RGBA Uint8ClampedArray) 変換
 * @param {Uint32Array} pixelsArgb
 * @param {ImageData}   imageData
 * @param {number}      width
 * @param {number}      height
 */
function _argbToImageData(pixelsArgb, imageData, width, height) {
  const dst   = imageData.data;
  const limit = Math.min(pixelsArgb.length, width * height);
  for (let i = 0; i < limit; i++) {
    const color  = pixelsArgb[i] >>> 0;
    const offset = i * 4;
    dst[offset]     = (color >> 16) & 0xff; // R
    dst[offset + 1] = (color >>  8) & 0xff; // G
    dst[offset + 2] =  color        & 0xff; // B
    dst[offset + 3] = (color >> 24) & 0xff; // A
  }
}

/**
 * ROM バイト列から一意なキーを生成する（FNV-1a ベース）。
 * @param {Uint8Array} romBytes
 * @param {string}     label
 * @returns {string}
 */
function _computeRomKey(romBytes, label) {
  let hash  = 0x811c9dc5 >>> 0;
  const limit = Math.min(romBytes.length, 512);
  for (let i = 0; i < limit; i++) {
    hash ^= romBytes[i];
    hash  = Math.imul(hash, 0x01000193) >>> 0;
  }
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `sram_${safeLabel}_${romBytes.length}_${hash.toString(16)}`;
}

// ──────────────────────────────────────────────────
// IndexedDB SRAM ストレージ
// ──────────────────────────────────────────────────

const _DB_NAME    = 'md-emulator-sram';
const _DB_VERSION = 1;
const _STORE_NAME = 'saves';

function _openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(_STORE_NAME)) {
        db.createObjectStore(_STORE_NAME);
      }
    };
    req.onsuccess = (ev) => resolve(ev.target.result);
    req.onerror   = (ev) => reject(ev.target.error);
  });
}

async function _saveSramToDb(key, data) {
  const db = await _openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(_STORE_NAME, 'readwrite');
    tx.objectStore(_STORE_NAME).put(new Uint8Array(data), key);
    tx.oncomplete = () => resolve();
    tx.onerror    = (ev) => reject(ev.target.error);
  });
}

async function _loadSramFromDb(key) {
  if (!key) return null;
  const db = await _openDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE_NAME, 'readonly');
    const req = tx.objectStore(_STORE_NAME).get(key);
    req.onsuccess = (ev) => resolve(ev.target.result ?? null);
    req.onerror   = (ev) => reject(ev.target.error);
  });
}
