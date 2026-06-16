/**
 * md-emulator.d.ts — MdEmulator TypeScript 型定義
 *
 * 使い方:
 *   import MdEmulator, { type MdEmulatorOptions, type ButtonMap } from './md-emulator.js';
 */

// ──────────────────────────────────────────────────
// オプション
// ──────────────────────────────────────────────────

export interface MdEmulatorOptions {
  /**
   * WASM JS ラッパーの URL。
   * @default './pkg/md_wasm.js'
   */
  wasmJsUrl?: string;

  /**
   * オーディオを有効にするか。
   * @default true
   */
  audio?: boolean;

  /**
   * IndexedDB を使った SRAM 自動保存を有効にするか。
   * @default true
   */
  sram?: boolean;

  /**
   * SRAM 自動保存の間隔（フレーム数、60fps 換算で約 5 秒）。
   * @default 300
   */
  sramAutoSaveFrames?: number;
}

// ──────────────────────────────────────────────────
// ボタンビットマスク
// ──────────────────────────────────────────────────

export interface ButtonMap {
  readonly UP:    0x01;
  readonly DOWN:  0x02;
  readonly LEFT:  0x04;
  readonly RIGHT: 0x08;
  readonly B:     0x10;
  readonly C:     0x20;
  readonly A:     0x40;
  readonly START: 0x80;
}

// ──────────────────────────────────────────────────
// CustomEvent の detail 型
// ──────────────────────────────────────────────────

export interface RomLoadedDetail {
  /** IndexedDB から SRAM が復元されたか */
  sramRestored: boolean;
}

export interface FrameDetail {
  /** 現在のフレームカウント（ROM ロード後からの累積） */
  frame: number;
}

export interface EmulatorErrorDetail {
  message: string;
  cause?: Error | unknown;
}

// ──────────────────────────────────────────────────
// イベントマップ（addEventListener のオーバーロード用）
// ──────────────────────────────────────────────────

export interface MdEmulatorEventMap {
  /** WASM 初期化完了 */
  ready:     CustomEvent<void>;
  /** ROM ロード完了 */
  romloaded: CustomEvent<RomLoadedDetail>;
  /** フレーム描画完了 */
  frame:     CustomEvent<FrameDetail>;
  /** エラー発生 */
  error:     CustomEvent<EmulatorErrorDetail>;
}

// ──────────────────────────────────────────────────
// MdEmulator クラス
// ──────────────────────────────────────────────────

export default class MdEmulator extends EventTarget {
  // ── Static ──

  /** コントローラーボタンビットマスク定数 */
  static readonly Buttons: ButtonMap;

  // ── Constructor ──

  constructor(options?: MdEmulatorOptions);

  // ── EventTarget オーバーロード ──

  addEventListener<K extends keyof MdEmulatorEventMap>(
    type: K,
    listener: (ev: MdEmulatorEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof MdEmulatorEventMap>(
    type: K,
    listener: (ev: MdEmulatorEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;

  // ── 初期化 ──

  /**
   * WASM モジュールをロードして初期化する。
   * 成功後に `ready` イベントを発行する。
   */
  init(): Promise<void>;

  /**
   * WASM JS URL と .wasm URL を明示的に指定して初期化する。
   * バンドラー (Vite / webpack) を使う場合に推奨。
   *
   * @param jsUrl   wasm-bindgen が生成した JS ラッパーの URL
   * @param wasmUrl .wasm バイナリの URL
   */
  initExplicit(jsUrl: string, wasmUrl: string | URL | Request): Promise<void>;

  // ── Canvas ──

  /**
   * 描画対象の canvas 要素をアタッチする（推奨サイズ: 320×224）。
   */
  attachCanvas(canvas: HTMLCanvasElement): void;

  /**
   * アタッチ済み canvas を切り離す。
   */
  detachCanvas(): void;

  // ── ROM ──

  /**
   * ROM をロードする。
   * @param data  ArrayBuffer, Uint8Array, File, または Blob
   * @param label SRAM 保存に使うキー名（省略時はファイル名または "rom"）
   */
  loadRom(data: ArrayBuffer | Uint8Array | File | Blob, label?: string): Promise<void>;

  // ── 実行制御 ──

  /** フレームループを開始する。 */
  play(): void;

  /** フレームループを停止する。 */
  pause(): void;

  /** ソフトリセットを行う。 */
  reset(): void;

  /**
   * 1 フレームだけ手動で進める（一時停止中のみ有効）。
   */
  stepFrame(): void;

  /**
   * 指定サイクル数だけ進める。
   * @param cycles M68K クロックサイクル数
   */
  step(cycles: number): void;

  /**
   * 1 M68K 命令だけ進める（デバッグ用）。
   */
  stepInstruction(): void;

  // ── コントローラー ──

  /**
   * コントローラーのボタン状態を設定する。
   * @param player   プレイヤー番号（1 または 2）
   * @param buttons  ビットマスク（MdEmulator.Buttons の OR 結合）
   */
  setInput(player: 1 | 2, buttons: number): void;

  // ── セーブ・ロード ──

  /**
   * 現在のエミュレーター状態をシリアライズする。
   */
  saveState(): Uint8Array;

  /**
   * スナップショットから状態を復元する。
   * @param data saveState() が返したバイト列
   */
  loadState(data: Uint8Array | ArrayBuffer): void;

  // ── SRAM ──

  /** ROM が SRAM をサポートしているか返す。 */
  hasSram(): boolean;

  /** SRAM の内容を返す。 */
  getSram(): Uint8Array;

  /**
   * SRAM の内容を復元する。
   * @param data バイト列
   */
  loadSram(data: Uint8Array | ArrayBuffer): void;

  // ── オーディオ ──

  /**
   * ミュート状態を設定する。
   * @param muted true でミュート
   */
  setMuted(muted: boolean): void;

  /** 現在のミュート状態 */
  readonly muted: boolean;

  /** 使用中の AudioContext（存在する場合） */
  readonly audioContext: AudioContext | null;

  // ── デバッグ ──

  /**
   * 生の EmulatorHandle（wasm-bindgen 生成）を返す。
   * すべての低レベル WASM API にアクセスできる。
   */
  readonly handle: object | null;

  /** WASM が初期化済みか */
  readonly ready: boolean;

  /** フレームループが動作中か */
  readonly running: boolean;

  /** ROM ロード後からの累積フレームカウント */
  readonly frameCount: number;

  /** ビルドバージョン（タイムスタンプ） */
  readonly buildVersion: string;

  /**
   * メモリ読み出し。
   * @param address M68K アドレス
   * @param length  バイト数
   */
  getMemory(address: number, length: number): Uint8Array;

  /**
   * CPU レジスタ状態を返す（M68K + Z80）。
   */
  getCpuState(): {
    m68k: {
      d: number[];
      a: number[];
      pc: number;
      sr: number;
      usp: number;
      ssp: number;
    };
    z80: {
      pc: number;
      sp: number;
      a: number;
      f: number;
      bc: number;
      de: number;
      hl: number;
    };
  };

  /**
   * ブレークポイントを設定する。
   * @param address M68K アドレス
   */
  setBreakpoint(address: number): void;

  // ── 後片付け ──

  /**
   * フレームループを止め、AudioContext を閉じてリソースを解放する。
   * 再利用はできない（再利用する場合は新しいインスタンスを生成すること）。
   */
  destroy(): void;
}
