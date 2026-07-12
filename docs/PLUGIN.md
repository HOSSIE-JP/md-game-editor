# MD Game Editor — プラグイン開発ガイド

このドキュメントは、**MD Game Editor** 向けのカスタムプラグインを開発する方を対象としています。  
プラグインシステム (Plugin Runtime v2.5) の仕様、マニフェスト定義、コア選択、フック API、レンダラーモジュール、およびレンダラーからの呼び出し方を解説します。

---

## 目次

1. [プラグインの配置場所](#1-プラグインの配置場所)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [manifest.json 仕様](#3-manifestjson-仕様)
4. [プラグインタイプ一覧](#4-プラグインタイプ一覧)
5. [フック一覧](#5-フック一覧)
6. [index.js の書き方](#6-indexjs-の書き方)
7. [コンテキストオブジェクト](#7-コンテキストオブジェクト)
8. [依存関係の宣言](#8-依存関係の宣言)
9. [タブ UI の追加 (tab オブジェクト)](#9-タブ-ui-の追加-tab-オブジェクト)
10. [Renderer Module](#10-renderer-module)
11. [有効 / 無効の管理](#11-有効--無効の管理)
12. [レンダラーから呼び出せる IPC API](#12-レンダラーから呼び出せる-ipc-api)
13. [既存プラグイン一覧](#13-既存プラグイン一覧)
14. [開発の流れ (チュートリアル)](#14-開発の流れ-チュートリアル)
15. [よくある間違い](#15-よくある間違い)
16. [実装ノウハウ](#16-実装ノウハウ)
17. [AI Control API](#17-ai-control-api)

---

## 1. プラグインの配置場所

### 開発時（非パッケージ）

```
md-game-editor/plugins/<plugin-id>/
```

### パッケージ済みアプリ

```
<app resources>/plugins/<plugin-id>/
```

アプリ内の **Settings > Plugins** パネルの「📂 フォルダを開く」ボタンで、実際の配置先を Explorer で開けます。

---

## 2. ディレクトリ構成

プラグインは `manifest.json` を必須とし、必要に応じて main process 用の `index.js` と renderer process 用の `renderer.js` を追加します。

```
md-game-editor/plugins/
└── my-plugin/
    ├── manifest.json   ← 必須: メタデータ・タイプ・フック宣言
    ├── index.js        ← 任意: main process のフック/ジェネレータ実装
    ├── renderer.js     ← 任意: renderer process の UI/capability 実装
    └── style.css       ← 任意: renderer module 用スタイル
```

その他のファイル（ライブラリ・アセットなど）を追加することも可能です。  
`index.js` から `require('./lib/util.js')` のように相対パスで参照できます。`renderer.js` は ES module として読み込まれます。

---

## 3. manifest.json 仕様

```jsonc
{
  "id": "my-plugin",           // 必須: 一意な ID (英小文字・ハイフンのみ推奨)
  "name": "My Plugin",         // 必須: 表示名
  "description": "...",        // 任意: 説明文
  "version": "1.0.0",          // 必須: semver 形式
  "icon": "puzzle",            // 任意: サイドバーなどで使う組み込みアイコン名
  "types": ["build"],          // 必須: プラグインタイプ (配列)
  "generator": true,           // 任意: generateSource/generateSourceAsync を明示する場合
  "supportedCores": ["mega-drive"], // 任意: 対応 core。未指定は legacy 互換で mega-drive 扱い
  "core": {                     // types: ["core"] の場合のみ使用
    "id": "mega-drive",
    "label": "Mega Drive",
    "platform": "md"
  },
  "hooks": ["onBuildStart"],   // 任意: 実装するフック名の一覧
  "permissions": [              // 任意: 使用する host 権限の宣言 (v2.5)
    "project.read",
    "project.write",
    "dialog.openFile",
    "res.read",
    "res.write",
    "main.invokeHook",
    "build.configure"
  ],
  "roles": [                    // 任意: 単一選択 role の宣言 (v2.5)
    { "id": "builder", "label": "Build", "exclusive": true, "order": 10 }
  ],
  "mainApi": {                  // 任意: renderer から呼び出せる main hook/capability
    "hooks": ["convertAudio"],
    "capabilities": ["audio-convert"]
  },
  "tab": { ... },              // 任意: タブ UI を追加する場合
  "renderer": {                 // 任意: renderer module を提供する場合
    "entry": "renderer.js",
    "styles": ["style.css"],
    "page": "my-page",
    "capabilities": ["page"]
  },
  "dependencies": ["other-id"] // 任意: 依存プラグイン ID の一覧
}
```

### フィールド詳細

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `string` | ✅ | プラグインを一意に識別する ID。フォルダ名と一致させること |
| `name` | `string` | ✅ | UI に表示される名前 |
| `description` | `string` | — | 設定画面に表示される説明文 |
| `version` | `string` | ✅ | semver 形式 (例: `"1.0.0"`) |
| `icon` | `string` | — | サイドバーなどで使う組み込みアイコン名。`assets` / `code` / `grid` / `sprite` / `music` / `play` / `bug` / `build` / `puzzle` など |
| `types` | `string[]` | ✅ | タイプ名の配列。複数タイプを持てる |
| `generator` | `boolean` | — | `generateSource` / `generateSourceAsync` を持つ plugin かを明示する。hook 専用 build plugin は `false` を推奨 |
| `supportedCores` | `string[]` | — | 対応する project core。`"mega-drive"` / `"pc-engine"` / `"*"`。未指定の既存 plugin は `"mega-drive"` として扱う |
| `core` | `object` | — | `types` に `"core"` を含む core plugin の metadata。`id` / `label` / `platform` を持つ |
| `hooks` | `string[]` | — | 実装するフック名を列挙する（宣言のみ。実装は `index.js`） |
| `permissions` | `string[]` | — | 使用する host 権限の宣言。v2.5 では表示・レビュー用途で、sandbox 強制はしない |
| `roles` | `Array<object|string>` | — | builder/testplay など、設定画面で単一選択する plugin role |
| `mainApi` | `object` | — | renderer plugin から呼び出し可能な main process hook / capability の許可リスト |
| `tab` | `object` | — | エディタにタブを追加する場合。[§9 参照](#9-タブ-ui-の追加-tab-オブジェクト) |
| `renderer` | `object` | — | renderer process 側の UI/capability を提供する場合。[§10 参照](#10-renderer-module) |
| `dependencies` | `string[]` | — | 依存プラグイン ID。[§8 参照](#8-依存関係の宣言) |

> **注意**: `types` は必ず **配列**で記述してください。文字列単体の `"type"` フィールドは Runtime v2.5 では使用しません。

---

## 4. プラグインタイプ一覧

`types` に指定できる値の一覧です。一つのプラグインが複数のタイプを持てます。

| タイプ名 | 説明 | 主なフック |
|---|---|---|
| `build` | ビルドパイプラインに参加するプラグイン | `onBuildStart` / `onBuildLog` / `onBuildEnd` / `onBuildError` |
| `editor` | エディタ UI にタブを提供するプラグイン | `getTab` / `onActivate` / `onDeactivate` |
| `asset` | アセット管理機能を提供するプラグイン | （`editor` との組み合わせが一般的） |
| `emulator` | Test Play 実行を担当するプラグイン | `onTestPlay` |
| `converter` | 画像などの変換処理を提供するプラグイン | （主にレンダラー側から直接利用） |
| `core` | project core の setup / project / build / asset schema / template provider | main process 側 provider として扱う |

### Project core と `supportedCores`

Runtime v2.5 では、Mega Drive と PC Engine の違いをプロジェクト単位の core として扱います。`project.json.coreId` が実効 core で、未指定の既存 MD project は `"mega-drive"`、`platform: "pce"` を持つ既存 PCE project は `"pc-engine"` として推定されます。

通常 plugin は `supportedCores` を宣言してください。MD 専用なら `["mega-drive"]`、PCE 専用なら `["pc-engine"]`、project FS API だけを使う共有 plugin は `["*"]` を指定します。未宣言 plugin は後方互換のため `["mega-drive"]` として扱われます。現在の core に非対応の plugin は Plugins 画面で既定非表示になり、有効化、role 選択、hook/generator 呼び出しの対象からも除外されます。

core plugin は `types: ["core"]` と `core` metadata を持つ manifest で宣言します。組み込み core plugin ID は `mega-drive-core` / `pc-engine-core`、core ID は `mega-drive` / `pc-engine` です。core plugin は UI を直接持たず、main process 側の provider として setup / project template / build / asset schema / default roles を提供します。

---

## 5. フック一覧

### `onBuildStart`

ビルド開始直前に呼び出されます。

```ts
// payload
{ projectDir: string }

// context
{ logger: Logger }

// 戻り値
{ ok: boolean, error?: string }
```

### `onBuildLog`

ビルドプロセスからのログ行が届くたびに呼び出されます。

```ts
// payload
{ text: string, level: 'info' | 'warn' | 'error' | 'debug' }

// 戻り値
{ ok: boolean }
```

### `onBuildEnd`

ビルド完了（成功）後に呼び出されます。

```ts
// payload
{ projectDir: string, romPath: string, elapsed: number }

// 戻り値
{ ok: boolean, error?: string }
```

### `onBuildError`

ビルド失敗時に呼び出されます。

```ts
// payload
{ projectDir: string, error: string }

// 戻り値
{ ok: boolean }
```

### `getTab`

エディタのタブ情報を返します。`editor` タイプのプラグインが実装します。

```ts
// payload: なし

// 戻り値
{
  id: string,
  label: string,
  icon?: string,
  mountType: 'builtin-code-editor' | string
}
```

### `onActivate`

タブがアクティブになったときに呼び出されます。

```ts
// payload: {}
// context: { logger: Logger }
// 戻り値: { ok: boolean }
```

### `onDeactivate`

タブが非アクティブになったときに呼び出されます。

```ts
// payload: {}
// context: { logger: Logger }
// 戻り値: { ok: boolean }
```

### `onTestPlay`

Test Play ボタンが押されたときに呼び出されます。`emulator` タイプのプラグインが実装します。

```ts
// payload
{ romPath: string }

// 戻り値
{
  ok: boolean,
  handled: boolean  // true を返すとプラグイン側で Test Play 起動済みとして扱う
}
```

`context.testPlay` には、組み込みエミュレータープラグイン向けのホスト API が渡されます。

```ts
context.testPlay.openWasmWindow({ romPath, pluginId })
context.testPlay.openApiWindow({ romPath, pluginId, port? })
context.testPlay.startApiServer({ port? })
context.testPlay.stopApiServer()
context.testPlay.isApiServerRunning()
```

### `generateSource` / `generateSourceAsync`

`build` タイプのプラグインがソースコードを生成するために実装します。  
フックではなく **ジェネレータ関数** として扱われ、`plugins:runGenerator` IPC から呼び出されます。

```ts
// 引数
assets: Array<{
  type: string,       // 'IMAGE' | 'SPRITE' | 'XGM2' | 'WAV' など
  name: string,       // リソース名 (例: 'image001')
  sourcePath: string, // プロジェクト相対パス
  sourceAbsolutePath: string // 絶対パス
}>

context: {
  projectDir: string,
  logger: Logger
}

// 戻り値
{ ok: boolean, sourceCode?: string, error?: string }
```

---

## 6. index.js の書き方

### 最小構成

```js
'use strict';

module.exports = {
  // hooks ここに実装
};
```

### build プラグイン例

```js
'use strict';

const manifest = require('./manifest.json');

/**
 * ソースコード生成関数
 * @param {Array<{type:string, name:string, sourcePath:string}>} assets
 * @param {{ projectDir:string, logger:object }} context
 */
async function generateSourceAsync(assets, context) {
  context.logger.info('generateSource 開始');

  const images = assets.filter((a) => a.type === 'IMAGE');
  if (images.length === 0) {
    return { ok: false, error: 'IMAGE アセットが見つかりません' };
  }

  const sourceCode = `#include <genesis.h>\n/* generated by ${manifest.id} */\n`;
  return { ok: true, sourceCode };
}

async function onBuildStart(payload, context) {
  context.logger.info(`ビルド開始: ${payload.projectDir}`);
  return { ok: true };
}

async function onBuildEnd(payload, context) {
  context.logger.info(`ビルド完了: ${payload.romPath}`);
  return { ok: true };
}

module.exports = {
  generateSourceAsync,
  onBuildStart,
  onBuildEnd,
};
```

### editor タブ プラグイン例

```js
'use strict';

const manifest = require('./manifest.json');

function getTab() {
  return {
    id: manifest.id,
    label: manifest.tab?.label || manifest.name,
    icon: manifest.tab?.icon || 'default',
    mountType: 'builtin-code-editor', // または独自のマウントタイプ
  };
}

function onActivate(_payload, context) {
  context?.logger?.info(`${manifest.id} activated`);
  return { ok: true };
}

function onDeactivate(_payload, context) {
  context?.logger?.info(`${manifest.id} deactivated`);
  return { ok: true };
}

module.exports = { manifest, getTab, onActivate, onDeactivate };
```

---

## 7. コンテキストオブジェクト

フック関数の第 2 引数 `context` には、以下のプロパティが含まれます。

```ts
interface PluginContext {
  projectDir: string;    // 現在のプロジェクトディレクトリの絶対パス
  logger: Logger;        // ログ出力オブジェクト
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  log(message: string): void;  // info の別名
}
```

`logger` で出力したメッセージは、エディタの **Build Log** パネルと **Plugin Log** パネルの両方に表示されます。

---

## 8. 依存関係の宣言

プラグイン A がプラグイン B の機能を必要とする場合、`dependencies` に宣言します。

```jsonc
{
  "id": "my-editor",
  "dependencies": ["image-resize-converter", "image-quantize-converter"]
}
```

**動作ルール**:

- プラグイン A を **有効化** すると、依存している B も自動的に有効化されます
- プラグイン B を **無効化** しようとすると、B に依存している A も自動的に無効化されます
- 単一選択 role で別のプラグインが選ばれて B が無効化される場合も、B に依存している A は同時に無効化されます
- 依存するプラグインが存在しない場合、`setEnabled` の戻り値 `missingDependencies` に ID が含まれます

---

## 9. タブ UI の追加 (tab オブジェクト)

`editor` タイプのプラグインは `manifest.json` に `tab` オブジェクトを追加することで、エディタ上部のタブバーに項目を追加できます。

```jsonc
"tab": {
  "label": "My Tab",   // 必須: タブに表示されるラベル
  "icon": "code",      // 任意: アイコン識別子
  "page": "my-page",   // 任意: ページ識別子
  "order": 20          // 任意: タブの表示順 (小さい値が左)
}
```

サイドバーの初期表示順も `tab.order` の昇順です。ユーザーがドラッグで並び替えた後は、プロジェクトごとの保存済み順序が優先されます。
組み込み plugin の基本 order は、ゲーム特化エディタを最優先にし、その後に Assets / BGM / Code / Plugins / Settings が並ぶようにしています。

| order | 目安 |
|---:|---|
| 1-9 | ゲーム特化エディタ（例: ブロック崩しステージエディタ） |
| 10 | Assets |
| 20 | BGM |
| 30 | Code |
| 40 以降 | 追加エディタ / 補助ツール |

`getTab` フックで返すオブジェクトの `mountType` により、タブコンテンツのマウント方式が決まります。

| `mountType` | 説明 |
|---|---|
| `"builtin-code-editor"` | 組み込みのコードエディタを使用 |
| その他の文字列 | カスタムマウントタイプ（将来の拡張用） |

---

## 10. Renderer Module

Plugin Runtime v2.5 では、main process の `index.js` とは別に renderer process 用 ES module を提供できます。
本体 renderer はアプリシェル、ページ切替、IPC host API、プラグイン読込を担当し、Assets / Code / Converter などの機能固有 UI は renderer module が capability として登録します。

```jsonc
"renderer": {
  "entry": "renderer.js",          // 必須: plugin ディレクトリ内の ES module
  "styles": ["style.css"],         // 任意: plugin ディレクトリ内 CSS
  "page": "assets",                // 任意: タブ/ページを持つ場合のマウント先
  "capabilities": ["page"]         // 任意: 提供する機能名
}
```

`entry` と `styles` は plugin ディレクトリ内の相対パスだけが有効です。絶対パスや `../` で plugin 外へ出る指定は拒否され、`PluginInfo.hasRenderer` は `false` になります。

renderer module は次の関数を export します。

```js
export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  registerCapability('my-capability', { /* plugin-owned UI helpers */ });
  return {
    deactivate() {
      // 任意: イベント購読や DOM 状態の片付け
    },
  };
}
```

| 引数 | 説明 |
|---|---|
| `plugin` | `PluginInfo` |
| `root` | pageRoot があれば pageRoot、なければ hostRoot。既定 mount 先 |
| `pageRoot` | ページを持つプラグインの `<section>`。ページを持たない場合は `null` |
| `hostRoot` | すべての renderer plugin に割り当てられる plugin 専用 root。converter や modal UI はここへ mount する |
| `api` | 本体が公開する安全な host API と `window.electronAPI` |
| `logger` | Plugin Log / Build Log に出力する logger |
| `registerCapability` | `capabilities` の実装を登録する関数 |

> v2.5 以降、新規プラグインは `md-game-editor/renderer/renderer.js` や `md-game-editor/renderer/index.html` へ追記せず、`renderer.js` の `activatePlugin()` 内で `root` / `pageRoot` / `hostRoot` に DOM を構築してください。converter のようにページを持たないプラグインにも `hostRoot` が渡されるため、独自モーダルや非表示 UI を本体 HTML に事前定義する必要はありません。

### Renderer Host API

`activatePlugin()` に渡される `api` は、既存 IPC の薄いラッパーに加えて、プラグイン間連携と plugin-owned UI 用の helper を提供します。

```js
export function activatePlugin({ plugin, hostRoot, api, registerCapability }) {
  const modal = api.createModal({
    id: `${plugin.id}-modal`,
    html: '<div class="settings-form compact-form"><p>Plugin UI</p></div>',
  });

  registerCapability('my-tool', {
    open() {
      modal.open();
    },
  });

  const off = api.events.on('my-tool:refresh', (payload) => {
    console.log(payload?.reason);
  });

  return {
    deactivate() {
      off();
      modal.destroy();
    },
  };
}
```

| API | 説明 |
|---|---|
| `api.mountElement(element, target?)` | plugin 専用 root へ DOM を mount する。`target: "page"` で pageRoot 優先 |
| `api.unmountElement(element)` | mount 済み DOM を削除する |
| `api.createModal(options)` | plugin 専用 root 配下に標準 modal を作成し、`open()` / `close()` / `destroy()` を返す |
| `api.capabilities.get(name)` | 有効な provider の capability 実装を取得する |
| `api.capabilities.require(name, timeoutMs?)` | capability 登録を待つ。見つからない場合は `null` |
| `api.capabilities.list()` | 現在有効な capability と provider plugin ID を列挙する |
| `api.plugins.invokeHook(id, hook, payload)` | `mainApi.hooks` で許可された main process hook を呼び出す |
| `api.events.emit(name, detail)` | renderer plugin 間の軽量イベントを発行する |
| `api.events.on(name, handler)` | renderer plugin 間イベントを購読し、解除関数を返す |

本体側に残すべきものは、プロジェクト内ファイル操作 IPC、ビルド/Test Play orchestration、plugin 読込、共通 shell UI です。新しいページ、ツール、converter、モーダル、プレビュー、plugin 間連携は plugin 側 renderer module と capability/event で実装してください。

### Renderer ページ CSS の注意

`pageRoot` / `root` が `<section class="editor-page">` 自体になる editor plugin では、その root 要素へ `display` を指定しないでください。ページの表示・非表示はホスト側の `.editor-page.active` が管理します。plugin CSS で次のような指定をすると、非アクティブな plugin ページが隠れず、別のサイドバータブを選択しても前の editor plugin が表示され続けます。

```css
/* NG: page root が .editor-page の場合、ホストの display:none を上書きする */
.my-plugin-root {
  display: flex;
}
```

ページ全体のレイアウトは、root 直下に wrapper を作ってそこへ `display: flex` / `grid` を指定してください。

```js
export function activatePlugin({ root }) {
  root.classList.add('my-plugin-page');
  root.innerHTML = '<div class="my-plugin-layout"></div>';
}
```

```css
.my-plugin-layout {
  display: grid;
  height: 100%;
}
```

renderer から main process hook を呼ぶ場合は、`hooks` と `mainApi.hooks` の両方に hook 名を宣言してください。新規 plugin で本体 `main.js` / `preload.js` / `build-system.js` の個別追記が必要に見える場合は、まず Runtime v2.5 の汎用 API 不足として扱い、個別 plugin ID の分岐を本体へ追加しないでください。

### Plugin Runtime v2.5 の追加 capability

Asset 登録や converter 連携は本体 renderer へ追記せず、renderer capability として登録します。

| capability | 用途 |
|---|---|
| `asset-type-provider` | 拡張子から候補 type、既定 subdir、既定 symbol、追加 UI 情報を返す |
| `asset-import-handler` | import の優先度・処理可否・copy/変換/登録方針を提供する。`handleImport(payload)` を実装すると標準コピー前に plugin-owned wizard を開ける |
| `image-import-pipeline` | 画像 import 時の resize / quantize / Indexed PNG 化を提供する |

新規 asset type や converter を追加するときは、`asset-manager` や converter plugin がこれらを登録します。本体 `renderer.js` に type 分岐を追加しないでください。

### Plugin roles

Build / Test Play のように「有効 plugin のうち 1 つだけを選ぶ」機能は `roles` で宣言します。

```jsonc
"roles": [
  { "id": "builder", "label": "Build", "exclusive": true, "order": 10 },
  { "id": "testplay", "label": "Test Play", "exclusive": true, "order": 20 }
]
```

Build ボタンに使う plugin は `builder` role、Test Play ボタンに使う plugin は `testplay` role を manifest に必ず宣言します。プロジェクト設定では `pluginRoles` だけを使用します。

### Audio converter の実装

音声変換 plugin は `hooks` と `mainApi.hooks` に `convertAudio` を宣言し、renderer からは `api.plugins.invokeHook(plugin.id, "convertAudio", payload)` を使います。preview は `readTempFileAsDataUrl(tempPath, { deleteAfter: true })`、登録は `writeAssetFile()` を使います。

---

## 11. 有効 / 無効の管理

プラグインの有効・無効状態は `<userData>/plugins-state.json` に保存されます。  
デフォルトはすべて **有効** です。

### `plugins-state.json` の形式

```json
{
  "my-plugin": { "enabled": false },
  "other-plugin": { "enabled": true }
}
```

ユーザーは Settings 画面の Plugins タブからトグルで切り替えられます。  
プラグイン自身がこのファイルを直接編集する必要はありません。

---

## 12. レンダラーから呼び出せる IPC API

レンダラープロセス（`renderer.js` など）は `window.electronAPI` 経由でプラグイン関連の IPC を呼び出せます。

### プラグイン管理

```js
// 全プラグイン一覧を取得。現在 core 非対応 plugin も含める場合は includeIncompatible を使う
const plugins = await window.electronAPI.listPlugins({ includeIncompatible: false });
// => Array<PluginInfo>

// core 一覧と現在の active core
const cores = await window.electronAPI.listCores();
const activeCore = await window.electronAPI.getActiveCore();

// 特定プラグインの renderer asset を取得
const assets = await window.electronAPI.getPluginRendererAssets('my-plugin');
// => { ok: boolean, renderer?: object, rendererAssets?: object, error?: string }

// 単一選択 role の現在値を取得/保存 (v2.5)
const roles = await window.electronAPI.getPluginRoles();
await window.electronAPI.setPluginRole('builder', 'my-build-plugin');

// プラグインを有効/無効化
const result = await window.electronAPI.setPluginEnabled('my-plugin', true);
// => { ok: boolean, changed: Array<{id,enabled,reason}>, changedIds: string[], missingDependencies: string[] }

// ジェネレータ実行 (src/main.c が生成される)
const result = await window.electronAPI.runPluginGenerator('my-plugin');
// => { ok: boolean, srcPath?: string, error?: string }

// plugins フォルダを Explorer で開く
await window.electronAPI.openPluginsFolder();

// converter preview 用の一時ファイルを Data URL 化
const preview = await window.electronAPI.readTempFileAsDataUrl(tempWavPath, { deleteAfter: true });
```

### PCE asset API

PC Engine core のプロジェクトでは、PCE asset manager 用の安全な project-local IPC を利用できます。

```js
// assets/pce-assets.json を取得
const assets = await window.electronAPI.listAssets();

// PNG/BMP を project 配下へコピーし、SuperFamiconv で pce / pce_sprite へ変換する
const imported = await window.electronAPI.importAssetImage({
  sourcePath: '/absolute/path/source.png', // dialog で選ばれた読み取り元
  kind: 'background',                      // "background" | "sprite"
  id: 'title_bg',
  paletteBank: 0,
  tileBase: 32,
  mapBase: 0,
  cellWidth: 16,
  cellHeight: 16,
  transparentIndex: 0,
});

// WAV を ADPCM / CD-DA 用に project 配下へコピー・変換する
const audio = await window.electronAPI.importAssetAudio({
  sourcePath: '/absolute/path/source.wav',
  kind: 'adpcm', // "adpcm" | "cdda-track"
  id: 'voice_01',
  sampleRate: 16000,
  track: 2,
  loop: false,
});

// project root 内の asset source だけを Data URL 化する
const preview = await window.electronAPI.previewAssetSource('assets/images/title_bg.png');

// pce-assets.json の順序を保存する
await window.electronAPI.reorderAssets(['title_bg', 'hero_sprite']);
```

`previewAssetSource` と `reorderAssets` は絶対パス、`..`、symlink escape を拒否します。`importAssetImage` / `importAssetAudio` の `sourcePath` は読み取り元として dialog 由来の絶対パスを許可しますが、保存される `source` / generated file path は必ず project 相対です。BMP は renderer 側で PNG Data URL (`convertedDataUrl`) に変換してから import します。

`assets/pce-assets.json` の v2 画像/音声タイプは `image` (BG), `sprite`, `palette`, `psg-song`, `psg-sfx`, `adpcm`, `cdda-track` です。旧 `psg-sequence` は読み込み時に `psg-sfx` として正規化されます。PCE-CD は `project.json.targetMedia: "cd"` と `toolchain: "llvm-mos"` の組み合わせで実験的に扱い、IPL / System Card は Setup でユーザー所有ファイルを指定します。

### `PluginInfo` の型

```ts
interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;            // manifest.icon。未指定時は tab.icon、どちらもなければ空文字
  pluginTypes: string[];   // types 配列の正規化済み値
  pluginType: string;      // pluginTypes[0]
  supportedCores: string[]; // 対応 core。未宣言 plugin は ["mega-drive"] に正規化される
  compatibleWithActiveCore: boolean; // listPlugins({ coreId }) 時の互換判定
  core: {
    id: string;
    label: string;
    platform: string;
  } | null;                // types に core を含む場合の core metadata
  tab: object | null;      // manifest.tab の値
  dependencies: string[];
  hooks: string[];
  permissions: string[];
  roles: Array<{
    id: string;
    label: string;
    exclusive: boolean;
    order: number;
  }>;
  mainApi: {
    hooks: string[];
    capabilities: string[];
  };
  hasGenerator: boolean;   // generateSource / generateSourceAsync が存在するか
  renderer: {
    entry: string;
    styles: string[];
    page: string;
    capabilities: string[];
    error?: string;
  } | null;
  hasRenderer: boolean;
  rendererAssets: {
    scriptUrl: string;      // file:// URL
    styleUrls: string[];    // file:// URL
  } | null;
  enabled: boolean;        // 現在の有効状態
}
```

### イベント購読

プラグインのログは `onPluginLog` で購読できます。

```js
window.electronAPI.onPluginLog((payload) => {
  // payload: { pluginId: string, text: string, level: 'info'|'warn'|'error'|'debug' }
  console.log(`[${payload.pluginId}] ${payload.text}`);
});
```

---

## 13. 既存プラグイン一覧

### `slideshow` — スライドショーゲーム

| 項目 | 値 |
|---|---|
| タイプ | `build` |
| バージョン | 1.1.0 |
| フック | `onBuildStart`, `onBuildLog`, `onBuildEnd`, `onBuildError` |
| ジェネレータ | `generateSource` ✅ |

`resources.res` に登録された `imageXXX` という名前の IMAGE アセットを 5 秒ごとに切り替えるスライドショー用の `main.c` を自動生成します。

---

### `code-editor` — コードエディタ

| 項目 | 値 |
|---|---|
| タイプ | `editor` |
| バージョン | 0.1.0 |
| フック | `getTab`, `onActivate`, `onDeactivate` |
| renderer capability | `page`, `code-editor` |

`src/` 配下のファイルをツリー表示して編集・新規作成・削除できる標準エディタプラグインです。

---

### `asset-manager` — Rescomp アセット管理

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| バージョン | 1.0.0 |
| 依存 | `image-resize-converter`, `image-quantize-converter`, `audio-converter` |
| renderer capability | `page`, `asset-manager` |

`resources.res` のアセット一覧・編集・登録を担うメインエディタプラグインです。  
画像アセットのリサイズ・減色変換、音声変換 UI を依存 converter capability 経由で呼び出します。

---

### `pce-asset-manager` — PCE アセット管理

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| 対応 core | `pc-engine` |
| バージョン | 0.2.0 |
| renderer capability | `page`, `asset-manager`, `asset-type-provider`, `asset-import-handler`, `audio-import-handler` |

`assets/pce-assets.json` v2 を編集する PC Engine 用の標準アセット管理です。BG image / Sprite sheet / Palette / PSG song/SFX / ADPCM / CD-DA track を扱い、PNG/BMP は SuperFamiconv、WAV は内製変換で generated asset を作成します。

---

### `pce-sprite-editor` / `pce-palette-editor` / `pce-music-editor`

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| 対応 core | `pc-engine` |
| renderer capability | `sprite-editor`, `palette-editor`, `psg-music-editor` |

PCE アセット管理と同じ `pce-assets.json` を、スプライト・パレット・PSG トラッカーの各視点で編集する補助エディタです。通常 plugin なので本体 UI へ直書きせず、Plugin Runtime v2.5 の renderer page と capability で mount します。

---

### `pce-image-converter` / `pce-audio-converter`

| 項目 | 値 |
|---|---|
| タイプ | `converter` |
| 対応 core | `pc-engine` |
| renderer capability | `pce-image-converter`, `pce-audio-converter`, `image-import-pipeline`, `audio-convert-ui` |

PCE 用の画像/音声 import を capability として提供します。実変換は PCE asset API と project-local generated files に集約し、外部コードをアプリ本体へコピーしません。

---

### `sprite-editor` — SPRITE エディタ

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| バージョン | 0.1.0 |
| 依存 | `asset-manager`, `image-resize-converter`, `image-quantize-converter` |
| renderer capability | `page`, `sprite-editor` |

RESCOMP の `SPRITE` 定義を `.res` ファイル単位でツリー表示し、スプライトシートのフレーム分割、アニメーション行、フレーム時間、SPRITE パラメータを編集します。画像追加時は標準の画像 import pipeline を使い、8px 境界リサイズと 16 色減色の既存フローに揃えます。

ROW ごとの有効フレーム数は plugin 独自メタデータではなく、RESCOMP 標準の `time` 行列長で表現します。`time=0` は SGDK の挙動に合わせて「そのフレームで再生停止」として preview でも扱い、Sprite Sheet 上には各フレームの time 値を重ねて表示します。Asset Manager 側の SPRITE preview も、スプライトシート全体ではなく定義済みアニメーションを再生確認できる UI にします。

---

### `tilemap-editor` — TileMap エディタ

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| バージョン | 0.1.0 |
| 依存 | `asset-manager`, `image-resize-converter`, `image-quantize-converter` |
| renderer capability | `page`, `tilemap-editor` |

Tiled 互換の `.tmx` / `.tsx` サブセットを編集し、SGDK ResComp の `TILESET` + `MAP` / `TILEMAP` 定義として `resources.res` へ登録します。v1 は orthogonal / fixed-size / CSV tile layer / single image tileset を対象にし、priority は `<layer> priority` 形式の補助 layer で表現します。

TMX 入力の `MAP` / `TILEMAP` 定義では、ResComp 構文に合わせて Asset Manager の `tileset_id` 欄を `layer_id` として扱います。画像入力の `MAP` / `TILEMAP` では従来どおり `tileset_id` です。

collision は `Collision` / `Collision:<name>` という TMX tile layer に CSV 値として保存します。ResComp の描画対象 layer_id には使わず、TileMap エディタ保存時に `inc/tilemap_collision.h` / `src/tilemap_collision.c` を生成してゲーム側の判定ロジックから参照します。

---

### `image-resize-converter` — 画像リサイズコンバーター

| 項目 | 値 |
|---|---|
| タイプ | `converter` |
| バージョン | 1.0.0 |
| renderer capability | `image-resize` |

8 ドット境界へのリサイズ / クリッピング機能を提供します。  
`asset-manager` が依存して利用します。

---

### `image-quantize-converter` — 画像減色コンバーター

| 項目 | 値 |
|---|---|
| タイプ | `converter` |
| バージョン | 1.0.0 |
| renderer capability | `image-quantize` |

画像を 16 色に減色変換する機能を提供します。  
参照パレット指定・メディアンカット法による独立実装です。

---

### `audio-converter` — 音声変換コンバーター

| 項目 | 値 |
|---|---|
| タイプ | `converter` |
| バージョン | 1.0.0 |
| main hook | `convertAudio` |
| renderer capability | `audio-convert-ui` |

WAV/MP3/OGG を SGDK 向け WAV に変換します。ffmpeg を使う変換処理は main process の `index.js` が担当し、範囲指定などの UI は renderer capability として提供します。

---

### `midi-converter` — MIDI 音楽コンバーター

| 項目 | 値 |
|---|---|
| タイプ | `converter`, `asset` |
| バージョン | 0.1.0 |
| main hook | `convertMidiMusic` |
| renderer capability | `midi-convert-ui`, `asset-import-handler`, `vgm-preview-player` |

MIDI ファイルを plugin-local の JavaScript converter で Mega Drive 向け VGM に変換し、必要に応じて SGDK `xgmtool.exe` で XGM も生成します。Asset Manager の MIDI import handler としても動作し、`.mid` / `.midi` を `XGM2 <symbol> music/<symbol>.vgm` または `XGM <symbol> music/<symbol>.xgm AUTO` として登録できます。Python ランタイムには依存しません。

`vgm-preview-player` capability は、Asset Manager の preview パネルから `.vgm` ソースを簡易再生するための Web Audio player です。YM2612 / PSG の register write、wait、end を読み、FM + PSG を近似音で鳴らします。実機音色の完全再現ではなく、MIDI 変換結果のメロディ、テンポ、同時発音の確認を目的にします。`.xgm` だけのアセットは初期対応では preview 対象外です。

#### Asset Manager からの MIDI 登録

Asset Manager の「登録」から `.mid` / `.midi` を選ぶと、通常のアセット登録画面で `type`、`symbol`、保存先を確認したあと、そのまま MIDI Converter が変換と `.res` 登録を行います。MIDI Converter 用の追加 wizard は開きません。

通常は type を `XGM2` のままにして、`Symbol` を C の識別子として使いやすい名前に整えてから「登録」を押します。この場合は `res/music/<symbol>.vgm` が生成され、`resources.res` には `XGM2 <symbol> music/<symbol>.vgm` として登録されます。

| 項目 | 説明 |
|---|---|
| Asset Manager の `type` | 登録するアセット形式です。通常は `XGM2` 推奨です。`XGM` は `.xgm` を直接登録したい場合に選びます。 |
| Asset Manager の `Symbol` | `resources.res` に登録するアセット名です。C コードから参照する識別子になるため、英数字と `_` を使う名前にします。 |
| 保存先 / ファイル名 | 生成される `.vgm` / `.xgm` の出力先です。既定は `res/music/` です。 |

`XGM2` は VGM ファイルをソースとして SGDK/ResComp 側で扱う運用なので、`xgmtool.exe` が見つからなくても VGM 生成とアセット登録を進められます。`XGM` を選ぶ場合は `.xgm` ファイルが必要なため、`xgmtool.exe` がない、または実行できない環境では warning が表示され、XGM アセット登録は行われません。

変換後の status には生成された `VGM` / `XGM` のパス、登録予定または登録済みの asset、読み取った note 数、voice steal 数、warning が表示されます。`Voice steal` が多い場合は MIDI 側の同時発音数が YM2612 のチャンネル数を超えているため、BGM 作曲プラグインに import してトラックや音数を調整してください。

MIDI Converter を単独で開く場合は `midi-convert-ui.openMidiConvertModal()` の簡易画面を使えますが、Asset Manager 経由の登録では Asset Manager の入力値を正とし、追加確認を挟まない設計にしています。

---

### `md-bgm-composer` — BGM 作曲エディタ

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `converter`, `asset` |
| バージョン | 0.1.0 |
| 依存 | `midi-converter` |
| main hook | `importMidi`, `exportMusic`, `validateSong` |
| renderer capability | `page`, `md-bgm-composer`, `music-import-handler` |

Mega Drive の YM2612 + PSG 構成に合わせた tracker 型 BGM エディタです。MIDI ファイルを import して XGM2-safe profile に自動割当し、診断を確認しながら調整できます。MIDI から直接 VGM/XGM を生成する処理は `midi-converter` capability を優先して利用し、tracker からの export では plugin-local JSON、VGM、XGM を生成して XGM2 アセットとして `resources.res` へ登録します。

---

### `rhythm-game-editor` — リズムゲームエディター

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `asset` |
| バージョン | 1.0.0 |
| 依存 | `asset-manager`, `audio-converter`, `image-resize-converter`, `image-quantize-converter`, `rhythm-game-builder` |
| main hook | `listRhythmSongs`, `saveRhythmSong`, `deleteRhythmSong`, `moveRhythmSong`, `listRhythmSettings`, `saveRhythmSettings`, `exportRhythmData`, `validateRhythmProject` |
| renderer capability | `page`, `rhythm-game-editor` |

Mega Drive 向けリズムゲームの楽曲メタ情報、WAV/MP3 入力からの譜面編集、波形表示、ノート配置、アルバムアート、プレイ状況に応じたムードスプライト、ゲーム内システムアセット設定を扱います。  
データは project-local の `data/rhythm/charts/*.json` と `data/rhythm/game-assets.json` に保存し、ビルド時に `res/rhythm.res`、`inc/song_data.h`、`src/song_data.c` などへ生成します。

---

### `rhythm-game-builder` — リズムゲームビルダー

| 項目 | 値 |
|---|---|
| タイプ | `build` |
| バージョン | 1.0.0 |
| 依存 | `rhythm-game-editor` |
| フック | `onBuildStart`, `onBuildLog`, `onBuildEnd`, `onBuildError` |
| ロール | `builder` |
| ジェネレータ | `generateSource` ✅ |

`_rythum_game` 由来のローカルエンジンを plugin template として同期し、リズムゲームエディターの譜面・アセット設定から SGDK 用の C/RES データを生成します。テンプレートには Codex image_gen で作成したサンプル画像と簡易サンプル音声が含まれ、ユーザーアセット未設定の project でもビルド用データを生成できます。`src/boot/rom_head.c` はエディタ本体の ROM ヘッダー生成を尊重し、同期対象にしません。

---

### `dungeon-game-editor` — ダンジョンゲームエディター

| 項目 | 値 |
|---|---|
| タイプ | `editor` |
| バージョン | 1.1.0 |
| 依存 | `asset-manager`, `image-resize-converter`, `image-quantize-converter`, `dungeon-game-builder` |
| main hook | `listDungeonFloors`, `saveDungeonFloor`, `deleteDungeonFloor`, `moveDungeonFloor`, `generateDungeonFloor`, `exportDungeonData`, `listDungeonSettings`, `saveDungeonSettings`, `saveDungeonState` |
| renderer capability | `page`, `dungeon-game-editor` |

Wizardry 型の薄い壁を持つ 3D ダンジョンをフロア単位で編集します。最大 20x20 の可変サイズ、壁/扉/一方通行/ダークゾーン/宝箱/上り階段/下り階段/開始位置を扱い、指定サイズから玄室、扉、宝箱、離れた階段を含むランダム生成を行えます。内部設計・変更時のチェックリスト・過去の不具合の経緯は [DUNGEON_MAINTENANCE.md](DUNGEON_MAINTENANCE.md) を参照してください。v1.1 では壁・扉・床・天井の4要素を再利用可能な素材セットとして複数定義し、フロア編集時の素材セット選択を即座に3Dプレビューへ反映します。宝箱・上り階段・下り階段の3要素はデシジョンタイルへ焼き込まないビルボードスプライトであり素材セットに紐付ける技術的理由がないため、`settings.common_assets` としてプロジェクトに1組だけ定義し、全ての素材セット・フロアで共有します。階段セルは宝箱と同様に壁ではなく通行可能なイベントセルとして中央にビルボード表示され、前進/後退でそのセルへ足を踏み入れると自動的に対応するフロア (上り階段なら1つ上、下り階段なら1つ下) へ遷移し、遷移先の対応する種類の階段セルそのものへ壁で塞がれていない最初の向きを向いて到着します。プレイヤーが立っているセルに宝箱/階段がある場合、静止時 (static) と旋回アニメーション中 (turn、その場から動かないため) はビルボードのカリングを行わず最至近スプライトへ固定表示するため、足元に何があるか視認できます。前進/後退アニメーション中 (fwd、セルを離れる/入る動作) はこのセルをカリングし非表示にします。これにより、セルを離れた瞬間に足元スプライトが消え、移動アニメーション中ずっと表示され続けて「スプライトが追いかけてくる」ように見える不具合を避けています。

素材セットは `data/dungeon/settings.json` の順序付き `asset_sets` に `{ id, name, assets: { wall_texture, door_texture, floor_texture, ceiling_texture } }` として保存し、各 `data/dungeon/floors/*.json` は `asset_set_id` だけを参照します。IDはセットの表示名を変更しても変わらない安定IDで、セットは1～255件、ID重複と存在しない参照は保存・ビルドエラーです。最後のセット、およびフロアから参照中のセットは削除できません。宝箱/上り階段/下り階段は `settings.common_assets = { chest_texture, stairs_up_texture, stairs_down_texture }` としてセットとは別に1組だけ保存し、未設定時は保存・ビルドエラーです。旧フロアのinline `assets` は読み込み・ビルド時に同じ内容をまとめた仮想セットとして扱い、最初の明示保存時に `asset_sets` / `asset_set_id` 形式へ一括移行します。`common_assets` が存在しない旧保存ファイル (v1.1以前、宝箱/階段が各 `asset_sets[].assets` に残っている形式) は、各キーについて既定値と異なる値を持つ最初のセットから採用して `common_assets` を補完し、既定値のみの場合は既定値をそのまま使います。フロアと設定を同時に確定する場合は `saveDungeonState({ floor, settings })` を使用し、exportを1回だけ行います。既存の個別保存hookも後方互換のため利用できます。

素材カードの「選択/置換」はPNG/BMPのファイルダイアログから標準 `image-import-pipeline.convertToIndexed16()` を呼び、結果の `targetExtension` を使って壁/扉/床/天井は `res/dungeon/textures/<set-id>/` へ、宝箱/上り階段/下り階段は `res/dungeon/textures/common/` へ保存します。新規のタグなし画像は画像全体、既存の `path#tag` は3x2/4x2アトラスの該当要素として読み取ります。変換後の保存形式は8bit・非interlace・16色以下のindexed PNGです。壁/扉は96x96・不透明、床/天井は32x32・不透明、宝箱/上り階段/下り階段は48x48・透過可で、rendererとserviceの両方が寸法・色数・透過・project-local保存先を検証します。不正な素材は設定へ反映しません。素材タブは選択中の素材セット固有カード (壁/扉/床/天井) に加え、選択セットに関わらず常に表示される「共通素材」セクション (宝箱/上り階段/下り階段、プロジェクトで1箇所のみ編集) を持ちます。各カードにはcontain表示のピクセルプレビュー、寸法、色数、保存先、検証結果を表示し、上書き時はtexture cacheを無効化します。

3DプレビューとSGDK生成は共有レンダリングコア `render-core.js` を通ります。床/天井はデシジョンタイルへ焼き込まず、それぞれ32x32パターンをBG_Bの下半分/上半分（各200x64）へ固定反復配置します。壁/扉は非描画部をpalette index 0にした透明BG_Aの動的デシジョンタイルとして重ねるため、固定背景が透けて見えます。コアはこの「固定BG_B + 透明BG_A」を合成し、奥行き4マスの3Dプレビュー、離散移動/旋回アニメーション、宝箱/階段ビルボード、supercover LOS、暗闇を実機出力と一致させます。前進/後退の移動補間は線形 (定速) で、連続移動時にセル境界で減速しません (旋回のみ easeSmooth)。「設定」タブでは `animation_frames` / `turn_frames` (各2～8、少ないほどROM削減) と `move_speed_vblanks` (0～60、1アニメフレームあたり必須2vblankへ追加する待ちvblank数の起動時デフォルト)、`enemy_step_vblanks` (5～240、既定90≒1.5秒、エネミーの1歩あたり間隔のプロジェクト既定値) を編集でき、プレビューの再生間隔も同じ値から導出されます。フロア編集タブでは各フロアごとにこの値を上書きでき (0または未指定=プロジェクト既定を継承、1～4はENEMY_STEP_VBLANKS_MINの5へ切り上げ)、フロアを切り替える (階段移動含む) とプレビューのエネミー歩行ペースも即座にそのフロアの値へ切り替わります。プレビューのミニマップは踏破済みセルのみ表示する自動マッピングが既定で、ミニマップ下のトグルで全体表示と切り替えられます (踏破状態はセッション内のフロア別に保持し、セル編集やフロア再読込でリセット)。

フロア編集の「敵」ツールでエネミーのスポーン地点を配置できます (1フロア8体まで、宝箱/階段セルとは排他、`cell.enemy` → flags bit 0x10)。エネミーの見た目は共通素材 `enemy_texture` (192×96 = 4方向列×歩行2フレーム行の48×48グリッド、透過可、未設定時は手続き生成のプレースホルダー) から、8距離バケット×8行 (方向×歩行) の384×384スプライトシートとして1回だけ焼き込みます。3Dプレビューは実機と同一のAI (16bit xorshift RNGによる決定的な徘徊 = 75%直進+候補一様選択、正面直線3マスの視界検知 — 壁と扉が遮る — で追跡モードへ移行し軸差優先の貪欲移動、見失って5歩で徘徊復帰) をリアルタイムにシミュレートし、エネミーの占有セル (プレイヤー/宝箱/階段/他エネミーと相互侵入不可) や接触 (ステータス表示) も再現します。シミュレーション状態は踏破状態と同じ規則でセッション内フロア別に保持されます。

共通素材タブの `enemy_texture` カードには「3Dモデルから生成」ボタンがあり、glTF/GLB (+モーション) を読み込んで4方向×歩行2フレームのスプライトをラスタライズし、既存の `enemy_texture` 書き込み経路へ直接反映できます。描画はエディター側のみで完結する機能で、同梱のThree.jsサブセット (`plugins/dungeon-game-editor/vendor/three/`) をモーダルを開いた時だけ遅延ロードして使用し、ROM/エクスポート側 (`dungeon-service.js`) やSGDK Cテンプレートは一切関与しません。モーダルではモデルファイル選択、アニメーションクリップ選択 (未選択時は静止ポーズを両歩行フレームへ複製)、歩行フレームA/Bのサンプル時刻、モデル正面の0°/180°トグル、仰角、ズームを調整でき、192×96プレビュー (nearest拡大) を見ながら「敵テクスチャとして適用」で確定します。生成時は同梱の軽量16色量子化 (メガドライブの3bit/chスナップ+人気色法) でリット済みの3D描画を15色以下の不透明パレット+透過へ変換してから標準の8bit Indexed PNGエンコーダへ渡すため、`enemy_texture` に要求される16色以下・透過可の制約を満たします。読み込んだモデルファイルやパラメータはディスクへ保存されないセッション内メモリのみの機能で (再生成は再度モデルを選び直す)、DRACO/KTX2/meshopt圧縮を必須とするモデルは非対応として明示的に拒否されます。

保存/ビルド時は参照されている素材セットごとに壁/扉タイルセット、床/天井の32x64背景タイルセット、通常/暗闇paletteとデシジョンテーブルを生成します。宝箱/上り階段/下り階段のビルボードpaletteと3種のsprite sheetは素材セット数に関わらずプロジェクトで1回だけ焼き込み、`dun_common_bb_palette` / `dun_common_bb_chest` / `dun_common_bb_stairs_up` / `dun_common_bb_stairs_down` という固定symbolで `resources.res` へ1組だけ出力します (素材セットを何件追加しても複製されません)。フロアデータは素材セットindexを持ち、生成側の `DunViewSet` レジストリから壁焼き込み系の対応リソースを選びます (宝箱/階段は前述の固定symbolを直接参照するため `DunViewSet` には含まれません)。焼き込みcacheは素材セット別 (壁/扉/床/天井) と共通ビルボード用を別々のキーで管理するため、共通素材の変更は各セットの壁焼き込みキャッシュを無効化せず、逆も同様です。タイル数、テーブル容量、ROM推定量、警告はセット別と合計で管理し、未参照セットはROMへ出力しません。`resources.res` の生成ブロックはセットID由来の安全なsymbolで冪等更新します。

---

### `dungeon-game-builder` — ダンジョンゲームビルダー

| 項目 | 値 |
|---|---|
| タイプ | `build` |
| バージョン | 1.1.0 |
| 依存 | `dungeon-game-editor` |
| フック | `onBuildStart`, `onBuildLog`, `onBuildEnd`, `onBuildError` |
| ロール | `builder` |
| ジェネレータ | `generateSource` ✅ |

ダンジョンゲーム用のSGDKエンジンテンプレートを同期し、ダンジョンエディターのフロアデータからROM用CデータとResCompアセットを生成します。`DUN_applyViewSet()` は初期表示とフロア遷移時に `DungeonFloorData` の素材セットindexから `DunViewSet` を選び、PAL0、固定BG_B、active tileset/frame table、暗闇paletteをまとめて切り替えます。宝箱/上り階段/下り階段のビルボードスプライトとPAL1のビルボードpaletteは素材セットに依らないプロジェクト共通資産のため `DunViewSet` には含まれず、生成された `dun_common_bb_chest` / `dun_common_bb_stairs_up` / `dun_common_bb_stairs_down` (SpriteDefinition) と `dun_common_bb_palette` (Palette) をコード側 (`billboardDefForFlags()`, `PAL_setPalette(PAL1, ...)`) が直接参照します。暗闇中に遷移した場合も移動先セットの暗色paletteを適用します。

エンジン (`dungeon_view.c`) はBG_A上の25x16タイル（200x128px）について、毎アニメフレーム、壁/扉だけを焼き込んだデシジョンツリーを周囲エッジ状態（開/壁/扉）で評価し、透明indexを含む400タイルをVRAMのダブルバッファへ2 vblank分割DMAで転送します。床/天井はBG_Bへ固定反復配置され、BG_Aの透明部から表示されます。十字キーの連続動作、前後移動、旋回、階段によるフロア移動、宝箱/階段のLOS付きビルボード、暗闇、BG_A + PAL2のミニマップは従来どおり動作し、フロア遷移時には選択素材セットの壁/扉/床/天井のみが切り替わります (宝箱/階段のスプライト・paletteはフロア遷移をまたいで共通です)。階段セルは宝箱と同様に通行可能で `canMove()` はもはや階段セルをブロックせず、前進/後退でそのセルへ足を踏み入れた直後に `performAction()` が `goStairs()` を呼んで遷移先フロアの対応する階段セルそのものへ (`findStairsArrival()` が選ぶ壁で塞がれていない最初の向きで) 着地させます。最上階の上り階段・最下階の下り階段では遷移せずその場に留まります。

ゲーム側から呼べるランタイムAPIとして、`DUN_setMoveSpeed(u8 extra_vblanks)` は移動アニメーション1フレームあたり必須2vblankへ追加する待ちvblank数を実行時に変更します (起動時はエディター設定由来の `DUN_MOVE_SPEED_VBLANKS_DEFAULT`、パワーアップによる移動速度変化などに使用)。ミニマップは自動マッピングが既定で、`main.c` がRAM上のフロア別踏破ビットフィールド (`dun_visited`、最大20x20=50バイト/フロア) をゲーム開始・移動成功・階段到着時に更新し、`DUN_drawMinimap()` は踏破済みセルとその隣接壁のみを描画します (プレイヤーマーカーは常時表示)。`DUN_setMinimapMode(DUN_MINIMAP_FULL)` で全体表示へ切り替えられるため、宝箱から地図を入手するといったギミックを将来ゲームコードから実装できます。踏破状態はセーブ/エクスポートへ影響しないランタイム限定の状態です。

エネミーは `main.c` がフロア別RAM配列 `dun_enemies[DUNGEON_FLOOR_COUNT][DUN_MAX_ENEMIES(8)]` (`DunEnemy {x,y,dir,mode,anim,chase_timer,active}`) として所有し、起動時に flags の `DUN_FLAG_ENEMY(0x10)` からスポーンします。歩行間隔はフロアごとに `DungeonFloorData.enemy_step_vblanks` (u8) として焼き込まれ (エディターのフロア編集で0/未指定=プロジェクト既定を継承、それ以外は明示値をそのまま焼き込み)、メインループは `vtimer` 差分でこのフィールドを毎ティック直接参照してAIティックを駆動するため、階段やフロア切替で即座にそのフロアのペースへ切り替わります。`DUN_ENEMY_STEP_VBLANKS_DEFAULT` はプロジェクト既定値のドキュメント用defineとして生成されますが、実機コードはこれを直接読みません。徘徊/追跡 (render-core.js と同一の xorshift16・視界・貪欲移動ロジック) の後、新API `DUN_refreshBillboards()` (壁の再ステージなしのスプライトのみ更新) とミニマップ再描画で反映します。プレイヤーのブロッキング移動アニメ中はエネミーが静止し、バックログは1歩に集約されます。エネミーはプレイヤー/宝箱/階段/他エネミーのセルへ侵入できず、プレイヤー側も `canMove()` でエネミー占有セルをブロックされます。追跡中のエネミーがプレイヤーセルへ侵入を試みると移動せず空のフック `onEnemyContact(u8 enemy_index)` が発火するため、戦闘などのゲームロジックはここへ実装します。描画は `DUN_setEnemies()` で渡されたリストを `updateBillboards()` がフラグ参照より優先して検索し、カメラ相対向き×歩行フレームの行を `SPR_setAnimAndFrame(row, 距離バケット)` で選択します (宝箱/階段は従来どおり `SPR_setFrame`)。ミニマップには踏破済みセル上のエネミーのみ `MM_COLOR_ENEMY` で表示されます。

新規プロジェクト用には `template_dungeon_game` を同梱します。`project.json` は `dungeon-game-builder` と `standard-emulator` の role、MD ROM ヘッダー検証を通る title/author/serial を持つため、テンプレートから作成した project は Settings の未設定エラーを避けてそのまま Test Play できます。

---

### `standard-emulator` — 標準エミュレーター（WASM）

| 項目 | 値 |
|---|---|
| タイプ | `emulator` |
| バージョン | 1.0.0 |
| フック | `onTestPlay` |

WASM ベースの Mega Drive エミュレーターです。  
Test Play ボタン押下時に呼び出され、プラグイン内に内包した `testplay.html` / `testplay-preload.js` から WASM ウィンドウを起動します。

分離後の MD Game Editor リポジトリでは、`plugins/standard-emulator/pkg/` と
`md-emulator.js` / `wasm-player.js` を同梱・追跡します。元エミュレーターの
commit、WASM build meta、各ファイルの SHA-256 は
`plugins/standard-emulator/emulator-build.json` に記録します。更新時は
エミュレーター側で WASM をビルドしてから
`MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg` を実行します。

---

### `standard-api-emulator` — 標準エミュレーター（API）

| 項目 | 値 |
|---|---|
| タイプ | `emulator`, `tool` |
| バージョン | 1.0.0 |
| フック | `onTestPlay` |
| renderer capability | `api-emulator-control` |

REST API サーバー (`md-api`) 経由で Mega Drive エミュレーターを操作します。  
Test Play 開始時に API サーバーを起動し、API 操作用サブウィンドウを開きます。サブウィンドウが閉じられると API サーバーも停止します。

分離後の MD Game Editor リポジトリは `md-api` をビルドしません。この plugin を
使う場合は、platform 別の `md-api` / `md-api.exe` を
`plugins/standard-api-emulator/bin/` に配置してください。通常の Test Play は
`standard-emulator` の同梱 WASM を使います。

---

### `ai-control` — AI Control

| 項目 | 値 |
|---|---|
| タイプ | `editor`, `tool` |
| バージョン | 1.0.0 |
| renderer capability | `page`, `ai-control` |

外部 AI ツールから MD Game Editor を操作するための localhost REST / MCP bridge を起動します。  
`standard-api-emulator` がエミュレーター操作用 API であるのに対し、`ai-control` はプロジェクト作成、アセット登録、プラグイン実行、ビルド、Test Play など Editor 操作用 API です。

---

## 14. 開発の流れ (チュートリアル)

### Runtime v2.5 で plugin 開発者が必ず行うこと

1. `manifest.json` に `types`、`supportedCores`、`permissions`、必要な `roles`、`hooks`、`renderer.capabilities` を宣言する。
2. Build / Test Play の単一選択 plugin は `roles` を宣言し、プロジェクト側は `project.json.pluginRoles` に plugin ID を保存する。
3. MD 専用 plugin は `supportedCores: ["mega-drive"]`、PCE 専用 plugin は `["pc-engine"]`、共有 plugin は `["*"]` を宣言する。
4. UI、modal、preview、converter 連携は plugin の `renderer.js` で実装し、本体 HTML / renderer / main / preload へ個別追記しない。
5. main process の処理が必要な場合は `hooks` と `mainApi.hooks` に同じ hook 名を宣言し、renderer から `api.plugins.invokeHook()` で呼ぶ。
6. asset 登録拡張は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として提供する。
7. 新しい plugin で本体修正が必要に見えた場合は、まず汎用 API または core provider の不足として扱い、plugin 固有分岐を本体へ追加しない。
8. renderer 側の入力 UI は `window.prompt()` / `alert()` ではなく、`api.createModal()` で plugin-owned modal として実装する。
9. `.res` のアセット名は物理ファイル名ではなく ResComp alias / C symbol として扱い、登録前・ビルド前に重複検査する。
10. SGDK の `src/boot/sega.s` / `src/boot/rom_head.c` は専用 build rule が扱うため、plugin の `makeVariables` へ通常ソースとして追加しない。
11. `src/boot/rom_head.c` はプロジェクト設定からエディタ本体が生成するため、build plugin のテンプレート同期で上書きしない。
12. アセット参照を持つ editor plugin は、画面を開いた時点または sidebar で再アクティブになった時点で `.res` / source data を再読込し、一覧・select・preview を最新化する。更新ボタンに依存した状態同期だけにしない。
13. 選択中アセットに未保存変更がある状態で別アセット選択・新規追加・import を行う場合は、保存 / 破棄 / キャンセルを選べる plugin-owned modal を出し、暗黙に編集内容を捨てない。

### 手順 1: フォルダを作成する

```
md-game-editor/plugins/my-build-plugin/
├── manifest.json
└── index.js
```

### 手順 2: manifest.json を作成する

```json
{
  "id": "my-build-plugin",
  "name": "My Build Plugin",
  "description": "カスタムビルドプラグインのサンプル",
  "version": "1.0.0",
  "icon": "build",
  "types": ["build"],
  "supportedCores": ["mega-drive"],
  "permissions": ["project.read", "build.configure"],
  "roles": [{ "id": "builder", "label": "Build", "exclusive": true, "order": 10 }],
  "hooks": ["onBuildEnd"]
}
```

### 手順 3: index.js を作成する

```js
'use strict';

async function onBuildEnd(payload, context) {
  context.logger.info(`ROM が生成されました: ${payload.romPath}`);
  return { ok: true };
}

module.exports = { onBuildEnd };
```

### 手順 4: アプリを再起動して有効化する

1. `npm start` でアプリを起動
2. Settings > Plugins を開く
3. `my-build-plugin` が一覧に表示されていることを確認
4. トグルを ON にする

### 手順 5: 動作確認

プロジェクトをビルドすると、Build Log に `ROM が生成されました: ...` と表示されます。

---

## 15. よくある間違い

### `types` を文字列で書いてしまう

```jsonc
// ❌ Runtime v2.5 では無効
{ "type": "build" }

// ✅ 正しい書き方
{ "types": ["build"] }
```

### `hooks` の宣言が `index.js` の実装と一致しない

`hooks` フィールドは宣言のみです。実装がなくても起動時エラーにはなりませんが、  
`invokeHook` を呼び出したときに `skipped: true` が返されます。  
宣言と実装は必ず一致させてください。

### `generateSource` と `generateSourceAsync` の混在

どちらか一方のみ実装してください。両方ある場合は `generateSourceAsync` が優先されます。

### 依存プラグインが存在しないのに `dependencies` に記載する

`setPluginEnabled` の `missingDependencies` に含まれます。  
存在しない ID は `dependencies` に記載しないでください。

### `context.logger` が undefined になる

`invokeHook` は `context` 引数が省略された場合、空オブジェクト `{}` を渡します。  
`context?.logger?.info(...)` のようにオプショナルチェーンを使うか、  
フック関数のデフォルト引数を `context = {}` にしてください。

### アセット一覧や select を初回読込時のまま使う

Sprite / TileMap / Music / Block Stage のような editor plugin は、画面表示時と sidebar で再アクティブになった時点で `.res` / source data を再読込してください。別 plugin で追加・削除された asset を古い一覧のまま編集すると、preview や保存先が実体とずれます。

### 保存 / 削除をプロパティフォーム末尾にだけ置く

アセット単位の editor では、保存・削除 action を選択中リスト項目の右端にも置き、未保存状態をリスト上で見えるようにしてください。プロパティフォームの末尾だけに action を置くと、一覧と編集状態の対応が弱くなります。

### 繰り返し行の入力に同じ説明ラベルを重ねる

Animation Rows のような繰り返し UI は、各行に `有効` / `既定 time` などの label を繰り返さず、ヘッダー行 + テーブル型レイアウトにします。行の高さを抑えることで、ROW 数が増えても preview 領域を圧迫しません。

### preview で素材ファイルそのものだけを表示する

SPRITE など定義に意味がある asset は、画像ファイル全体ではなく frame size / animation ROW / time / collision などの定義を反映した preview を表示してください。

---

## 16. 実装ノウハウ

### Editor plugin の画面設計

複数の editor plugin が sidebar に並ぶ前提で、各 plugin は独立した page として振る舞います。`root` 自体の `display` を上書きせず、root 直下の wrapper で grid / flex を構成してください。plugin page の activation を検知して必要な再読込を行う場合は、`MutationObserver` で `.active` class の付与を監視し、非アクティブ時の描画や保存処理を避けます。

アセット編集 UI は、左にアセット一覧、中央に preview / editor、右に property form を置く 3 列構成を基本にします。左右列は resizer で調整可能にし、中央の上下 preview も splitter で高さ調整できると、画像・TileMap・SPRITE のような大きな canvas を扱いやすくなります。

ヘッダーや toolbar は pane の端まで通し、フォームや空状態メッセージ側だけに padding を持たせます。pane 自体に padding を入れると、特定列のヘッダーだけ内側へずれて見えます。繰り返し行の編集 UI では label を各行で反復せず、ヘッダー行に「有効」「既定 time」などの意味を置き、各行は input と状態表示だけにします。

再生・停止・先頭・末尾・loop などの preview 操作は icon button を使い、文脈が明確な select label は簡潔にします。たとえば SPRITE animation select は `ROW 1 (4 frames)` ではなく `1 (4 frames)` のように、周辺 UI で意味が分かる情報を繰り返さないでください。

保存 / 削除 action は、プロパティフォームの末尾だけでなく、選択中アセットのリスト項目右端に置くと状態と操作が対応しやすくなります。未保存状態ではリスト名に `*` や status を出し、別アセットを開く前に保存 guard modal を挟みます。

### アセット登録 UI

`resources.res` の `name` は ResComp が生成する C symbol です。UI で「アセット名」として表示する値は物理ファイル名ではなく、この alias を使ってください。

アセット登録の基本フロー:

1. ファイルを選択する
2. converter を起動する前に alias 入力 modal を出す
3. alias を C symbol として安全な形へ正規化する
4. `res:listDefinitions` で現在の `.res` を読み、既存 alias と重複していないか確認する
5. converter に `symbol` / `targetFileName` を渡す
6. `addResEntry()` または converter の登録処理後に `.res` を読み直し、select / preview / validation を更新する

`window.prompt()` / `alert()` は Electron の埋め込み renderer で期待通り動かないことがあるため、plugin UI では `api.createModal()` を使います。

### 画像 import pipeline と保存形式

画像アセットを登録する plugin は、変換結果の `dataUrl` だけでなく保存形式も明示してください。`image-import-pipeline.convertToIndexed16()` のような capability が `{ convertedDataUrl, targetExtension }` を返す場合、呼び出し側は `targetFileName` の拡張子を `targetExtension` に合わせます。これを怠ると、中身は BMP なのにファイル名が `.png`、またはその逆になり、preview / ResComp / palette 表示のどこかで原因が分かりにくい不具合になります。

```js
const converted = await imagePipeline.convertToIndexed16({ sourcePath, targetSize });
const ext = converted.targetExtension || '.png';
const copyResult = await api.electronAPI.writeAssetFile({
  sourcePath,
  targetSubdir: 'gfx',
  targetFileName: `${symbol}${ext}`,
  dataUrl: converted.convertedDataUrl || '',
});
```

変換を行わず元ファイルをそのままコピーしたい場合は、`convertedDataUrl: ''` を返します。`writeAssetFile()` は `dataUrl` が空なら `sourcePath` をコピーします。一方、PNG などに変換済みのバイナリを保存したい場合は必ず `convertedDataUrl` を渡します。

標準アセット登録画面とゲーム固有エディタの登録 UI の両方が同じ `image-import-pipeline` を使う可能性があります。片方だけ直すと、もう片方に古い PNG 変換や拡張子固定の経路が残ります。画像 import の仕様を変えたら、標準登録経路と plugin 固有登録経路の両方で `convertedDataUrl` / `targetExtension` / `targetFileName` の扱いを確認してください。

### アセット一覧と保存ガード

Sprite / TileMap / Music / Block Stage のような editor plugin は、画面を開いた時点で `.res` や編集元ファイルを再読込し、一覧・filter・select・preview を最新状態にします。ユーザーが手動で押す「更新」ボタンだけを同期手段にすると、別 plugin で追加・削除されたアセットを古い状態のまま編集してしまいます。

選択中アセットに未保存変更がある場合、別アセット選択・新規追加・import・reload で内容が消えないように、保存 / 破棄 / キャンセルを選べる modal を出してください。`window.confirm()` ではなく `api.createModal()` を使い、保存を選んだ場合は現在の asset を保存してから次の操作へ進めます。

### SPRITE editor / preview の注意

SPRITE は単なる画像ファイルではなく、`width` / `height` / `time` / `collision` などを含む RESCOMP 定義です。preview ではスプライトシート全体を cover 表示せず、定義された frame size と ROW ごとの animation を使って再生確認できるようにします。canvas 描画では `imageSmoothingEnabled = false` を指定し、pixel art をぼかさないでください。

ROW ごとの有効フレーム数は `time` 行列の各 ROW 長で表現します。scalar time を読み込んだ場合は全 ROW / 全列有効として展開し、UI 編集後は `[[...][...]]` 形式へ serialize します。フレーム time が `0` の場合、SGDK 上ではそのフレーム以降の再生が進まないため、editor preview でも停止として扱います。

Sprite Sheet には 8x8 grid、選択 frame、無効 frame の overlay、各 frame の time 値を重ねて表示します。シートクリックは ROW / frame 選択だけを行い、自動再生は開始しません。collision が `BOX` / `CIRCLE` の場合は、SGDK の collision size が frame の約 75% であることを踏まえて frame preview に overlay を出します。frame size は RESCOMP 制約に合わせ、tile 幅・高さが 32 未満、pixel では最大 248px までに制約してください。

Asset Manager の右列 preview でも SPRITE はシートそのものではなく、選択 ROW の animation を表示します。再生 / 停止は icon button にし、animation select の表示は `1 (4 frames)` のように簡潔にします。

### BMP / PNG palette の扱い

SGDK / ResComp 向け画像では、単に canvas へ描いて `canvas.toDataURL('image/png')` すると indexed palette が失われ、実際に使われている色だけで RGBA PNG へ再構成されます。未使用 palette、特に BMP の palette index 0 を保持したい場合、この経路を通してはいけません。

安全な方針:

- indexed PNG は `PLTE` / `tRNS` / `IDAT` を直接読んで palette と index を扱う
- indexed BMP は BMP ヘッダー、カラーテーブル、ピクセル index を直接読む
- BMP を PNG 化する場合は、BMP の index 0 を PNG palette index 0 に固定する
- 8bit BMP のようにカラーテーブルが256色でも、実使用 index が16色以内なら、使用 index だけを16色以内に remap して indexed PNG として保存できる
- 変換後に palette preview を見るだけでなく、保存されたファイルを再読込して `PLTE` / BMP カラーテーブルを確認する

リサイズやクリッピングを実施した場合は canvas 経由を避けられないことがあります。その場合でも、元画像が indexed PNG / BMP なら元 palette を参照 palette として保持し、最終的に自前の indexed PNG encoder で保存してください。`imageDataToIndexedPng()` のように実ピクセルから palette を作り直す関数は、未使用 palette を落とすため「最適化してよい画像」にだけ使います。

### resources.res の重複検査

同じ alias を複数行に登録すると、ResComp 後の assembler で次のようなエラーになります。

```text
Error: symbol `se_block_hit' is already defined
```

この状態はビルドログだけでは原因箇所が分かりにくいため、build plugin は ResComp 前に `assets` の `name` を集計し、重複があれば `{ ok: false, error }` を返してください。`lineNumber` / `resFileAbsolutePath` が取れる場合は、`resources.res:17` のように行番号付きで表示します。

### 画像・音声 preview

- 画像 thumbnail は「画像全体が見える」「アスペクト比を維持する」「領域内で最大化する」を満たす
- 一覧 thumbnail は `background-size: contain` か同等の処理を使う
- `cover` 相当の表示や `width:100%; height:100%` による引き伸ばしは禁止
- 小さい sprite も拡大表示する。`img` の `max-width/max-height` だけでは元サイズのまま小さく見える場合がある
- WAV preview は再生/停止の icon button にし、一覧では `HTMLAudioElement` の metadata などから再生長を表示すると確認しやすい
- 画像アセットでは、実画像から使用色を抽出し palette swatch として表示すると、SGDK の palette 制約を確認しやすい

### 複数 C ファイルを持つ build plugin

ゲームエンジンを複数 C ファイルで構成する build plugin は、`onBuildStart()` で `makeVariables.SRC_C` を明示します。

```js
function onBuildStart(payload, context) {
  return {
    ok: true,
    makeVariables: {
      SRC_C: [
        'src/main.c',
        'src/ball.c',
        'src/block.c',
        'src/player.c',
      ].join(' '),
    },
  };
}
```

注意点:

- `SRC_C` の明示は SGDK の wildcard compile による無関係な `src/*.c` 混入を防ぐ
- `src/boot/rom_head.c` は `SRC_C` に入れない
- `src/boot/sega.s` は `SRC_S` に入れない
- `src/boot/rom_head.c` はプロジェクト設定の ROM ヘッダー情報を反映する本体生成ファイルなので、build plugin の `syncEngine()` などでテンプレートからコピーして上書きしない
- SGDK 2.11 の `makefile.gen` は `src/boot/sega.s` を専用 rule で `out/sega.o` としてリンクする
- `out/sega.o` と `out/src/boot/sega.o` が同時にリンクされる場合、`rom_header` の multiple definition が起きる

### テストと確認

- plugin manager / renderer metadata / hook / build option の回帰は `md-game-editor/tests/*.test.js` に追加する
- Windows では `node --test tests/**/*.test.js` より `node tests/run-tests.js` が安定する
- 変更後は `node --check <変更した .js>` と `cd md-game-editor && node tests/run-tests.js` を実行する
- Build plugin を変更した場合は、可能なら実プロジェクトで generator 実行と SGDK build を通し、`out/cmd_` に不要な object が入っていないか確認する
- パッケージ済みアプリで確認する場合は、source tree の `md-game-editor/plugins` と packaged tree の `resources/plugins` が同期しているか確認する

---

## 17. AI Control API

AI Control API の詳細は [AI_CONTROL.md](AI_CONTROL.md) を参照してください。

- Editor 内の `AI Control` タブで明示的に起動した場合のみ `127.0.0.1` に公開する
- REST と MCP は同じ tool registry を使い、`editor_status` / `asset_add` / `build_run` などの tool 名と引数を共有する
- project state を変更する tool は `dryRun: true` または `confirm: true` が必要
- MCP stdio sidecar は `scripts/md-game-editor-mcp.js` で、`MD_EDITOR_CONTROL_URL` と `MD_EDITOR_CONTROL_TOKEN` を環境変数から読む
- stdout には MCP JSON-RPC メッセージだけを出し、診断ログは stderr に出す


## MD/PCE split note

- Mega Drive plugins are developed under `md-game-editor/plugins/<plugin-id>/`.
- PC Engine plugins are developed under `pce-game-editor/plugins/<plugin-id>/`.
- Shared plugins must explicitly declare `supportedCores: ["*"]`; v1 shared distribution includes `code-editor`.
- Core-specific plugins should not be copied between apps unless their manifest support and runtime behavior are intentionally made shared.
