---
name: md-game-editor-plugin
description: Create, modify, or review MD Game Editor plugins in the Electron app. Use for tasks involving md-game-editor/plugins, Plugin Runtime hooks, manifest.json, generateSource, editor/build/emulator/converter plugin types, SGDK source generation, project.json plugin registration, or plugin documentation updates.
---

# SKILL: MD Game Editor Plugin Generator

> **自律アップデート指示**
> このファイルは MD Game Editor のプラグインシステム仕様を記述したスキルファイルです。
> 以下のいずれかが発生した場合、**このファイル自体を必ず更新すること**:
> - `md-game-editor/PLUGIN.md` の仕様が変更された
> - `md-game-editor/plugin-manager.js` に新しいフック/タイプが追加・削除された
> - `md-game-editor/plugins/` に新しい組み込みプラグインが追加された
> - Plugin Runtime のメジャーバージョンが上がった
> 更新後は「§ Last Updated」セクションの日付とバージョンを書き換えること。
>
> § Last Updated: 2026-06 / Plugin Runtime v2.5 / Core Plugin / PCE asset/audio/font plugins / AI Control API / TileMap collision / Rhythm game plugins / Dungeon game plugins / Dungeon generated wall patterns / Dungeon SGDK TILESET/TILEMAP assets / Dungeon template / Editor UX guardrails / Bundled WASM split metadata

---

## 目的

このスキルは GitHub Copilot が **MD Game Editor** 向けのプラグインを自律的に生成するために必要な知識を提供します。  
既存の SGDK ゲームプロジェクトのコードを読み解き、そのゲームを生成・制御するプラグインを作成するために使用します。

---

## 前提知識

### MD Game Editor のプラグインシステム

- **Plugin Runtime v2.5** を採用
- プラグインは `manifest.json` を必須とし、必要に応じて `index.js` と `renderer.js` を持つ
- `index.js` は Electron メインプロセス (Node.js) 上で動作する（ブラウザ API は使用不可）
- `renderer.js` は Electron renderer process の ES module として動作し、UI/capability を登録する
- `index.js` は `require()`、`renderer.js` は `export function activatePlugin(...)` を使う

### 配置場所

| 環境 | パス |
|---|---|
| 開発時 | `md-game-editor/plugins/<plugin-id>/` |
| パッケージ済みアプリ | `<userData>/plugins/<plugin-id>/` |

---

## manifest.json 完全仕様

```jsonc
{
  "id": "my-plugin",           // 必須: フォルダ名と一致させる（英小文字・ハイフンのみ）
  "name": "表示名",             // 必須: UI に表示される名前
  "description": "説明文",      // 任意: 設定画面用の説明
  "version": "1.0.0",          // 必須: semver 形式
  "icon": "puzzle",            // 任意: サイドバーなどで使う組み込みアイコン名
  "types": ["build"],          // 必須: 配列で記述
  "generator": true,           // 任意: generateSource/generateSourceAsync を持つ場合。hook 専用なら false
  "supportedCores": ["mega-drive"], // 必須推奨: mega-drive / pc-engine / *。未指定は legacy MD 扱い
  "hooks": ["onBuildStart"],   // 任意: 実装するフック名の宣言
  "permissions": ["project.read", "project.write", "build.configure"],
  "roles": [
    { "id": "builder", "label": "Build", "exclusive": true, "order": 10 }
  ],
  "mainApi": {                  // 任意: renderer から呼べる main hook/capability
    "hooks": ["convertAudio"],
    "capabilities": ["audio-convert"]
  },
  "tab": {                     // 任意: editor タイプでタブを追加する場合
    "label": "My Tab",
    "icon": "code",
    "page": "my-page",
    "order": 20
  },
  "renderer": {                 // 任意: renderer process 側の UI/capability
    "entry": "renderer.js",
    "styles": ["style.css"],
    "page": "my-page",
    "capabilities": ["page"]
  },
  "dependencies": ["other-id"] // 任意: 依存プラグイン ID
}
```

### タイプ一覧

| タイプ | 用途 | 主なフック |
|---|---|---|
| `build` | ビルドパイプライン参加・ソースコード生成 | `onBuildStart` / `onBuildEnd` / `onBuildError` / `generateSource` |
| `editor` | エディタ UI タブを提供 | `getTab` / `onActivate` / `onDeactivate` |
| `asset` | アセット管理機能 | `editor` との組み合わせが一般的 |
| `emulator` | Test Play 実行 | `onTestPlay` |
| `converter` | 画像・音声変換などの処理/UI capability | `renderer.capabilities` / 独自 hook |
| `core` | project core の setup / project / build / asset schema / template provider | main process 側 provider |

### core / supportedCores

- Runtime v2.5 では `project.json.coreId` がプロジェクト単位の実効 core。未指定の既存 MD project は `mega-drive`、`platform: "pce"` を持つ既存 PCE project は `pc-engine` として扱う
- 新規 plugin は `supportedCores` を宣言する。MD 専用は `["mega-drive"]`、PCE 専用は `["pc-engine"]`、project FS API だけを使う共有 plugin は `["*"]`
- `supportedCores` 未宣言の既存 plugin は後方互換のため `["mega-drive"]` 扱い
- 現在 core に非対応の plugin は既定で非表示になり、有効化、role 選択、hook/generator 呼び出し対象から除外される
- setup / project / build / asset schema / template のようなシステム固有機能は `types: ["core"]` の core plugin/provider 側に置き、通常 plugin は role/hook/capability に閉じる

### renderer module パターン

Plugin Runtime v2.5 では、機能固有 UI は本体 `md-game-editor/renderer/renderer.js` へ直接追加せず、プラグイン配下の renderer module に置く。

```js
export function activatePlugin({ plugin, root, pageRoot, hostRoot, api, logger, registerCapability }) {
  registerCapability('my-capability', { root });
  return {
    deactivate() {
      // イベント購読や DOM 状態を片付ける
    },
  };
}
```

- `entry` と `styles` は plugin ディレクトリ内の相対パスだけを指定する
- `../` や絶対パスで plugin 外へ出る指定は禁止
- Assets / Code のようなページ UI は `renderer.page` と `tab.page` を一致させる
- サイドバーの初期表示順は `tab.order` の昇順。ゲーム特化エディタは 1-9、Assets は 10、BGM は 20、Code は 30 を目安にし、ユーザーのドラッグ並び替え保存がある場合はそちらが優先される
- Converter は `image-resize`, `image-quantize`, `audio-convert-ui` などの capability を登録し、利用側 plugin は capability 経由で呼び出す
- 新規ページ、ツール、converter、モーダル、プレビューは本体 HTML/renderer に追加せず、`root` / `pageRoot` / `hostRoot` と `api.createModal()` / `api.mountElement()` で plugin 側に mount する
- editor plugin の `pageRoot` / `root` は `<section class="editor-page">` 自体なので、root に付ける plugin 固有 class へ `display` を指定しない。ページ全体の `display` はホストの `.editor-page.active` が管理する。レイアウト用の `display: flex/grid` は root 直下の wrapper 要素に指定する
- プラグイン同士の連携は `api.capabilities.get()` / `api.capabilities.require()` / `api.events.on()` / `api.events.emit()` を使い、本体側に個別 plugin ID の分岐を追加しない
- renderer から main process hook を呼ぶ場合は `hooks` と `mainApi.hooks` の両方に宣言し、`api.plugins.invokeHook()` または `window.electronAPI.invokePluginHook()` を使う
- asset type / import / image 変換は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として登録する。標準コピー前に独自 wizard を挟む場合は `asset-import-handler.handleImport(payload)` を実装する
- PCE core では `assets/pce-assets.json` v2 を使い、標準タイプは `image` / `sprite` / `palette` / `psg-song` / `psg-sfx` / `adpcm` / `cdda-track`。旧 `psg-sequence` は `psg-sfx` として扱う
- 組み込み PCE editor は `pce-font-editor` / `pce-asset-manager` / `pce-sprite-editor` / `pce-palette-editor` / `pce-music-editor`、converter は `pce-image-converter` / `pce-audio-converter`
- PCE-CD は `project.json.targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提にした実験的ターゲット。IPL / System Card はユーザー指定ファイルとして扱い、リポジトリや plugin へ同梱しない
- Build / Test Play など単一選択 plugin は `roles` で宣言し、project.json の標準保存先は `pluginRoles` とする
- 単一選択 role で競合 plugin が無効化される場合、その plugin に依存する plugin も同時に無効化される
- `src/boot/rom_head.c` はプロジェクト設定からエディタ本体が生成するため、build plugin のテンプレート同期で上書きしない
- `permissions` は v2.5 では表示・レビュー用途の宣言で、sandbox 強制ではない
- 新規 plugin で本体 `main.js` / `preload.js` / `build-system.js` の個別追記が必要に見える場合は、まず Runtime v2.5 の汎用 API または core provider の不足として扱う

### Runtime v2.5 で必ず守る開発手順

1. `manifest.json` に `types`、`supportedCores`、`permissions`、必要な `roles`、`hooks`、`renderer.capabilities` を宣言する
2. Build / Test Play の単一選択 plugin は `roles` を宣言し、project 側は `project.json.pluginRoles` に保存する
3. MD 専用 plugin は `supportedCores: ["mega-drive"]`、PCE 専用 plugin は `["pc-engine"]`、共有 plugin は `["*"]` を宣言する
4. UI、modal、preview、converter 連携は plugin の `renderer.js` で実装し、本体 HTML / renderer / main / preload へ個別追記しない
5. main process の処理が必要な場合は `hooks` と `mainApi.hooks` に同じ hook 名を宣言し、renderer から `api.plugins.invokeHook()` で呼ぶ
6. asset 登録拡張は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として提供する。標準コピー前に独自 wizard を挟む場合は `asset-import-handler.handleImport(payload)` を使う

---

## フック完全仕様

### `onBuildStart(payload, context)`

```ts
payload: { projectDir: string }
context: { logger: Logger, projectDir: string }
return:  { ok: boolean, error?: string }
```

### `onBuildLog(payload)`

```ts
payload: { text: string, level: 'info' | 'warn' | 'error' | 'debug' }
return:  { ok: boolean }
```

### `onBuildEnd(payload, context)`

```ts
payload: { projectDir: string, romPath: string, elapsed: number }
context: { logger: Logger }
return:  { ok: boolean, error?: string }
```

### `onBuildError(payload, context)`

```ts
payload: { projectDir: string, error: string }
context: { logger: Logger }
return:  { ok: boolean }
```

### `generateSource(assets, context)` / `generateSourceAsync(assets, context)`

**最重要**: `build` タイプで `src/main.c` を生成するジェネレータ関数。  
`window.electronAPI.runPluginGenerator(pluginId)` から呼び出される。

```ts
assets: Array<{
  type: string;             // 'IMAGE' | 'SPRITE' | 'XGM2' | 'XGM' | 'WAV' など
  name: string;             // リソース名 (例: 'image001', 'bgm')
  sourcePath: string;       // プロジェクト相対パス
  sourceAbsolutePath: string; // 絶対パス
}>
context: { projectDir: string, logger: Logger }
return:  { ok: boolean, sourceCode?: string, error?: string }
```

### `onTestPlay(payload)`

```ts
payload: { romPath: string }
return:  { ok: boolean, handled: boolean }
// handled: true → プラグイン側で Test Play 起動済み
// context.testPlay.openWasmWindow / openApiWindow で組み込みウィンドウを起動できる
```

### `getTab()`, `onActivate(payload, context)`, `onDeactivate(payload, context)`

`editor` タイプのプラグイン用フック。`manifest.json` の `tab` オブジェクトと連動する。

---

## index.js の必須パターン

### build プラグイン（ソースコード生成あり）

```js
'use strict';

const manifest = require('./manifest.json');

/**
 * @param {Array<{type:string, name:string, sourcePath:string, sourceAbsolutePath:string}>} assets
 * @param {{ projectDir: string, logger: object }} context
 */
function generateSource(assets, context) {
  // アセットを解析してソースコードを生成する
  // ...
  return { ok: true, sourceCode: '/* generated code */' };
}

function onBuildStart(payload, context) {
  context.logger.info(`ビルド開始: ${payload.projectDir}`);
  return { ok: true };
}

function onBuildEnd(payload, context) {
  context.logger.info(`ROM 生成完了: ${payload.romPath}`);
  return { ok: true };
}

module.exports = { generateSource, onBuildStart, onBuildEnd };
```

### SGDK main 関数の必須シグネチャ

```c
/* SGDK 2.11 以降の必須シグネチャ */
int main(bool hardReset)
{
    (void)hardReset;
    /* ... */
    return 0;
}
```

> ⚠️ `void main()` や `int main(void)` は SGDK 2.11 以降でビルド警告が発生する。
> 必ず `int main(bool hardReset)` を使用し、`(void)hardReset;` でパラメータを消費すること。

---

## 既存 SGDK プロジェクトの解析方法

### Step 1: project.json を読む

```json
{
  "name": "プロジェクト名",
  "author": "作者名",
  "serial": "GM MYGAME-00",
  "region": "JPN",
  "pluginRoles": {
    "builder": "my-build-plugin",
    "testplay": "standard-emulator"
  }
}
```

`pluginRoles.builder` に自作プラグインの `id` を設定するとビルド時に呼ばれる。`pluginRoles.testplay` は Test Play 用プラグインを指定する。

### Step 2: res/resources.res を解析する

`.res` ファイルの各行の形式:

```
TYPE   name   "ファイルパス"   [追加パラメータ...]
```

よく使うタイプ:

| タイプ | 説明 | SGDK の C 変数型 |
|---|---|---|
| `IMAGE` | 320×224 の背景画像 | `const Image name` |
| `SPRITE` | スプライト | `const SpriteDefinition name` |
| `XGM2` | FM 音楽 (推奨) | `const u8 name[]` |
| `XGM` | FM 音楽 (旧) | `const u8 name[]` |
| `WAV` | PCM 音声 | `const u8 name[]` |
| `TILESET` | タイルセット | `const TileSet name` |
| `MAP` | タイルマップ | `const Map name` |
| `PALETTE` | パレット | `const Palette name` |

### Step 3: src/main.c の既存コードを読む

- どのような SGDK API を使っているか把握する
- 状態機械、スプライト管理、音楽再生の構造を理解する
- プラグイン生成時はこれを「ベース」に自動化・パラメータ化するコードを生成する

---

## generateSource 実装パターン集

### 画像スライドショー（参考実装: slideshow プラグイン）

```
1. assets から type=IMAGE かつ name が "image" で始まるものを名前順ソート
2. 存在しない場合は { ok: false, error: "..." } を返す
3. BGR アセットを extern 宣言してスライド配列を生成
4. main() でタイマーとジョイパッド入力でスライドを切り替える
```

### 汎用 build プラグインの設計指針

1. `assets` の解析は防衛的に行う（存在しないアセットタイプは `ok: false` を返す）
2. 生成コードの先頭に `/* Generated by <plugin-id> v<version> */` コメントを入れる
3. ハードコードを避け、アセット名から変数名を動的に生成する
4. SGDK API は `#include <genesis.h>` だけで利用可能
5. グローバル変数は最小限にし、スタック変数を優先する

---

## 既存組み込みプラグイン一覧

| id | タイプ | 説明 |
|---|---|---|
| `slideshow` | `build` | imageXXX アセットのスライドショー生成 |
| `code-editor` | `editor` | src/ ファイルツリー + コードエディタ |
| `asset-manager` | `editor`, `asset` | resources.res アセット管理 |
| `sprite-editor` | `editor`, `asset` | SPRITE 定義編集 + スプライトシート/フレームプレビュー。ROW 有効フレーム数は `time` 行列長で表現し、preview は animation / `time=0` 停止 / collision overlay を反映する |
| `tilemap-editor` | `editor`, `asset` | Tiled 互換 TMX/TSX サブセット編集 + SGDK TILESET/MAP/TILEMAP 登録 + tile collision data 生成 |
| `image-resize-converter` | `converter` | 8px 境界リサイズ |
| `image-quantize-converter` | `converter` | 16 色減色変換 |
| `audio-converter` | `converter` | WAV/MP3/OGG 変換と音声変換 UI |
| `midi-converter` | `converter`, `asset` | MIDI から VGM/XGM 生成、XGM2 アセット登録 payload 生成 |
| `md-bgm-composer` | `editor`, `converter`, `asset` | Mega Drive 向け BGM tracker、MIDI import、VGM/XGM export、XGM2 アセット登録 |
| `rhythm-game-editor` | `editor`, `asset` | Mega Drive 向けリズムゲームの楽曲/譜面/波形/アルバムアート/ムードスプライト/システムアセット設定 |
| `rhythm-game-builder` | `build` | リズムゲームエンジン同期、譜面/RES/C データ生成、builder role による ROM ビルド連携 |
| `dungeon-game-editor` | `editor` | Mega Drive 向け 3D ダンジョンの薄壁フロア編集、ランダム生成、ミニマップ付き 3D プレビュー、フロア別素材設定、3Dビュー由来の SGDK TILESET/TILEMAP アセット生成 |
| `dungeon-game-builder` | `build` | 25x16 BG タイル描画のダンジョンエンジン同期、フロア/生成済みビュー TILEMAP アセット、builder role による ROM ビルド連携 |
| `standard-emulator` | `emulator` | WASM Mega Drive エミュレーター |
| `standard-api-emulator` | `emulator`, `tool` | REST API Mega Drive エミュレーター |
| `ai-control` | `editor`, `tool` | 外部 AI ツール向け localhost REST / MCP bridge |

> 新しいプラグインが追加されたら、このテーブルに追記し § Last Updated を更新すること。

### 分離後の標準エミュレーター同梱

MD Game Editor リポジトリは `standard-emulator` plugin 内に現在採用している
Mega Drive WASM エミュレーターを同梱します。`plugins/standard-emulator/pkg/`、
`md-emulator.js`、`wasm-player.js`、`emulator-build.json` を一緒に管理し、
元エミュレーター repo の commit、dirty state、WASM build meta、SHA-256 を
追跡します。

更新する場合は、エミュレーター repo 側で WASM をビルドしたあと
`MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg` を実行します。
`MD_EMULATOR_REPO` がない場合、`copy-pkg` は同梱済みアセットの検証だけを行います。
分離後の editor repo は `md-api` をビルドしないため、`standard-api-emulator` を
使う場合は `plugins/standard-api-emulator/bin/` へ platform 別 binary を配置します。

---

## コード生成ルール（OSS / ライセンス）

- 生成コードは必ず **オリジナル実装** とする
- 外部リポジトリからのコードコピーは禁止
- SGDK の公式 API (`genesis.h` で宣言された関数) を使うことは問題ない
- 疑わしい類似コードが生まれた場合は制御フローを変えて書き直す

---

## よくある間違い

| 間違い | 正しい対応 |
|---|---|
| `types: "build"` | `types: ["build"]` — 必ず配列で |
| `void main()` | `int main(bool hardReset)` |
| hooks 宣言と実装の不一致 | manifest の hooks と module.exports のキーを一致させる |
| Electron API を直接使う | `context` / `require()` 経由でアクセスする |
| ブラウザ API (fetch, DOM) を使う | プラグインはメインプロセス (Node.js) で動作するため使用不可 |
| generateSource でエラー時に例外を throw | `{ ok: false, error: "メッセージ" }` を返す |
| editor plugin の root class に `display: flex/grid` を指定 | root 直下の wrapper に指定する。root は `.editor-page` なので、`display` を上書きすると別タブでも前の plugin 画面が表示される |
| アセット一覧や select を初回読込時のまま使う | 画面表示時・sidebar 再アクティブ時に `.res` / source data を再読込し、一覧・select・preview を同期する |
| 未保存変更のある asset を暗黙に切り替える | 保存 / 破棄 / キャンセルを選べる plugin-owned modal を挟む |
| 保存 / 削除をプロパティフォーム末尾にだけ置く | 選択中リスト項目の右端に保存・削除 action を置き、未保存状態をリスト上にも出す |
| 繰り返し行の入力に同じ説明ラベルを重ねる | ヘッダー行 + テーブル型 UI にして、各 ROW は input と状態表示だけにする |
| SPRITE preview でシート全体だけを表示する | frame size / animation ROW / time / collision を反映した再生 preview を表示する |

---

## Editor UI 実装ノウハウ

- editor plugin の root はホストの `.editor-page` なので、`display` を直接指定しない。root 直下の wrapper に grid / flex を指定する。
- アセット編集画面は左に一覧、中央に preview / editor、右に property form の 3 列を基本とする。左右列や中央上下 preview は resizer / splitter で調整可能にする。
- pane header / toolbar は端まで通し、padding はフォームや空状態メッセージ側に持たせる。pane 自体に padding を入れると特定列のヘッダーだけ内側へずれる。
- アセット参照を持つ editor は、画面表示時と sidebar 再アクティブ時に `.res` / source data を再読込する。更新ボタンだけに頼らない。
- 別アセット選択・新規追加・import・reload で未保存内容が消える場合は、`api.createModal()` で保存 guard を実装する。
- 保存 / 削除 action は、選択中アセットのリスト項目右端に置く。プロパティフォーム末尾だけに置かない。
- 繰り返し UI は各行に同じ label を置かず、ヘッダー行 + テーブル型にする。Animation Rows では `ROW / 有効 / 既定 time / 状態` のような列にする。
- 再生・停止・先頭・末尾・loop は icon button を使う。周辺文脈で意味が明確な select label は `1 (4 frames)` のように簡潔にする。
- SPRITE は画像ファイルではなく RESCOMP 定義として preview する。`imageSmoothingEnabled = false`、`time=0` 停止、ROW ごとの有効フレーム数、time 数字 overlay、collision overlay を反映する。


## MD/PCE split note

- Mega Drive plugins are developed under `md-game-editor/plugins/<plugin-id>/`.
- PC Engine plugins are developed under `pce-game-editor/plugins/<plugin-id>/`.
- Shared plugins must explicitly declare `supportedCores: ["*"]`; v1 shared distribution includes `code-editor`.
- Core-specific plugins should not be copied between apps unless their manifest support and runtime behavior are intentionally made shared.
