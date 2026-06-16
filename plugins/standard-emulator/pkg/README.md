# md-wasm

Mega Drive / Genesis エミュレーターコア ([md-core](../md-core)) の WebAssembly バインディングです。  
[wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) で生成された ES Module として提供されます。

---

## ビルド方法

### 前提ツール

```bash
# wasm-pack のインストール
cargo install wasm-pack
```

### dev ビルド（デバッグ情報あり）

```bash
# リポジトリルートから実行
wasm-pack build crates/md-wasm --target web --out-dir ../../frontend/pkg
```

### release ビルド（本番環境向け）

```bash
wasm-pack build crates/md-wasm --target web --release --out-dir ../../frontend/pkg
```

ビルド後のファイルは `frontend/pkg/` に出力されます。

---

## pkg/ の構成

| ファイル | 説明 |
|---------|------|
| `md_wasm.js` | ES Module ラッパー（wasm-bindgen 生成） |
| `md_wasm_bg.wasm` | WebAssembly バイナリ本体 |
| `md_wasm.d.ts` | TypeScript 型定義（低レベル API） |
| `md_wasm_bg.wasm.d.ts` | WASM バインディング型 |
| `package.json` | npm パッケージメタデータ (`name: "md-wasm"`) |
| `build_meta.js` | ビルドタイムスタンプ（`build.rs` 自動生成） |

---

## 公開 API

`EmulatorHandle` クラスが主要なエントリーポイントです。  
低レベル API の全一覧は `md_wasm.d.ts` を参照してください。

主なメソッド:

| メソッド | 説明 |
|---------|------|
| `new EmulatorHandle()` | インスタンス生成 |
| `load_rom(bytes)` | ROM バイト列をロード |
| `reset()` | ソフトリセット |
| `run_frame()` | 1 フレーム実行 |
| `get_framebuffer_argb()` | 320×224 ARGB フレームバッファを返す |
| `take_audio_samples(n)` | 48kHz ステレオ PCM サンプルを取得 |
| `set_controller_state(player, buttons)` | コントローラー状態を設定 |
| `save_state()` | エミュレーター状態をシリアライズ |
| `load_state(data)` | シリアライズ済みデータから復元 |
| `get_cpu_state()` | CPU レジスタ状態を JSON で返す |
| `get_memory(address, length)` | メモリを読み出す |
| `get_vram()` | VRAM (64KB) を返す |
| `get_cram()` | CRAM (128 bytes) を返す |

デバッグ API:

| メソッド | 説明 |
|---------|------|
| `get_vdp_registers_json()` | VDP レジスタを JSON で返す |
| `debug_render_plane(plane)` | プレーン A/B/W を ARGB で返す |
| `debug_render_tiles(palette)` | タイルシートを ARGB で返す |
| `debug_cram_colors_json()` | CRAM を色配列で返す |
| `debug_sprites_json()` | スプライト属性を JSON で返す |
| `trace_execution()` | 命令トレースリングバッファを返す |
| `set_breakpoint(address)` | ブレークポイントを設定 |

---

## 他プロジェクトへの組み込み

他の Web アプリや Electron アプリに組み込む場合は、低レベルの `EmulatorHandle` を  
直接使うのではなく、**`frontend/md-emulator.js`** のラッパークラスを使用することを推奨します。

詳細手順: **[docs/embedding.md](../../docs/embedding.md)**

---

## 依存クレート

| クレート | 説明 |
|---------|------|
| `md-core` | エミュレーターコア（M68K / Z80 / VDP / APU 統合） |
| `wasm-bindgen` | Rust ↔ JavaScript バインディング生成 |
| `serde-wasm-bindgen` | Rust 構造体の JSON シリアライズ |
| `serde` | シリアライズフレームワーク |

---

## ライセンス

MIT License — 詳細はリポジトリルートの `LICENSE` を参照してください。

---

## 関連ドキュメント

- [docs/embedding.md](../../docs/embedding.md) — 他プロジェクトへの組み込みガイド
- [docs/api.md](../../docs/api.md) — REST / WebSocket / JSON-RPC API
- [docs/spec.md](../../docs/spec.md) — エミュレーター仕様
