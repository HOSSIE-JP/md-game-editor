---
name: md-game-editor-plugin
description: Create, modify, or review MD Game Editor plugins in the Electron app. Use for tasks involving md-game-editor/plugins, Plugin Runtime hooks, manifest.json, generateSource, editor/build/emulator/converter plugin types, SGDK source generation, project.json plugin registration, or plugin documentation updates.
---

# SKILL: MD Game Editor Plugin Generator

> **自律アップデート指示**
> このファイルは MD Game Editor のプラグインシステム仕様を記述したスキルファイルです。
> 以下のいずれかが発生した場合、**このファイル自体を必ず更新すること**:
> - `md-game-editor/docs/PLUGIN.md` の仕様が変更された
> - `md-game-editor/plugin-manager.js` に新しいフック/タイプが追加・削除された
> - `md-game-editor/plugins/` に新しい組み込みプラグインが追加された
> - Plugin Runtime のメジャーバージョンが上がった
> 更新後は「§ Last Updated」セクションの日付とバージョンを書き換えること。
>
> § Last Updated: 2026-08 / Plugin Runtime v2.5 / Core Plugin / PCE asset/audio/font plugins / AI Control API / TileMap collision / Rhythm game plugins / Dungeon game plugins v1.3 / Horizontal STG editor and builder v1.3 / MD Novel editor and builder / HInt-safe VDP transfers and incremental ResComp dependencies / Async save and build abort lifecycle / Stable STG IDs and SGDK event streams / Graphical STG HUD / final-resolution tile backgrounds and line-warped title art / GERONEKO five-stage template / Editor UX guardrails / Bundled WASM SRAM and split metadata

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
7. 未保存のplugin編集をBuild/Test Play/project切替へ反映する場合は、renderer activationが返すasync `beforeBuild` / `beforeProjectSwitch`で永続化し、失敗時は明示的にvetoする

---

## フック完全仕様

### `onBuildStart(payload, context)`

```ts
payload: { projectDir: string, toolchainPath?: string, skipClean?: boolean }
context: { logger: Logger, projectDir: string }
return:  {
  ok: boolean,
  error?: string,
  makeVariables?: Record<string, string>,
  env?: Record<string, string>,
  makeTargets?: string[],
  skipClean?: boolean
}
```

`onBuildStart`が`{ ok: false, error }`を返す、throwする、またはPromise rejectした場合、MD/PCEともtoolchainを開始しない。hostは`onBuildError`を1回呼び、失敗した`build-end`を通知する。hook専用builderは`generator: false`にし、重いpreflight/codegenを`onBuildStart`へ一本化する。

MDの`payload.skipClean`は差分ビルドの要求にすぎない。builderは前回成功manifest、ROM/object/生成物、toolchainとbuild契約を検証してから戻り値の`skipClean: true`を返し、検証不能時は`false`へ戻す。

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

### renderer activation lifecycle

`activatePlugin()`の返却objectは、任意で`async beforeBuild(payload)`と`async beforeProjectSwitch(payload)`を実装できる。payloadには`projectDir`、`coreId`、`pluginId`、`lifecycle`と操作固有fieldが入る。active pluginをactivation順にawaitし、`false`、`{ ok: false, error, canceled? }`、throw/rejectは最初のvetoとして操作を中止する。未保存データを持つeditorは、正本へのatomic saveが完了してから`{ ok: true }`を返す。

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
| `dungeon-game-editor` | `editor` | Mega Drive向け3Dダンジョンの薄壁フロア編集、ランダム生成、フロア別4要素素材セットとプロジェクト共通ビルボード、標準SGDK画像pipelineによる取り込み/検証/個別preview、固定BG_B + 動的Priority付き透明BG_A壁を共有する実機一致3D preview、セット別リソース生成 |
| `dungeon-game-builder` | `build` | 素材セット別 `DunViewSet` 切替、固定BG_Bの床/天井と透明BG_Aの壁/扉、共通Priorityデシジョンテーブル、低Priority自動VRAMビルボード、移動/旋回/階段/LOS/暗闇/ミニマップ、builder roleによるROMビルド連携 |
| `md-novel-editor` | `editor`, `asset` | PCE VN JSON v2の非破壊編集/import、palette割当と224x136 BG source確認wizard、MD target sidecar、runtime相当320x224 preview、診断、async保存guard |
| `md-novel-builder` | `build` | hook-only preflight/codegen、SGDK Novel runtime、XGM2/PCM変換、VRAM/scanline/ROM gate、builder role連携 |
| `horizontal-stg-editor` | `editor` | 実画像320x224 preview、8x8背景stamp、system/enemy/boss sprite、BGM preview、弾幕、timeline配置、安定ID、検証 |
| `horizontal-stg-builder` | `build` | 横STGランタイム同期、C/RES/event stream生成、18 tile icon HUD、MD密度の等倍8x8背景、title IMAGEとline-scrollロゴ、背景VRAM診断、builder role連携 |
| `standard-emulator` | `emulator` | WASM Mega Drive エミュレーター |
| `standard-api-emulator` | `emulator`, `tool` | REST API Mega Drive エミュレーター |
| `ai-control` | `editor`, `tool` | 外部 AI ツール向け localhost REST / MCP bridge |

> 新しいプラグインが追加されたら、このテーブルに追記し § Last Updated を更新すること。

### MD Novel plugin規約

- script正本は`assets/pce-vn-scenes.json`。未知fieldを保持し、MD物理設定を`data/md-novel/target-profile.json`、asset対応を`asset-bindings.json`へ分離する
- `md-novel-editor`のUI/import/palette割当modal/previewはplugin renderer内に置き、main処理はmanifestの`hooks`と`mainApi.hooks`を一致させてserviceへ委譲する。背景source modalはlarge panelとcontainer-responsive layoutを使い、可視行だけ自動previewし、非同期結果の世代を照合する。Full PreviewはBG fade、typewriter、page cursor、WAIT/INPUT割込、Move、SpriteText blink、生成subset fontをruntimeと同期する
- 保存はrevision照合、project root/realpath検査、atomic replace、transaction hashを使う。`beforeBuild` / `beforeProjectSwitch`は保存完了までawaitし、失敗時にvetoする
- `md-novel-builder`は`generator: false`のhook-only builder。canonical dataを読取専用にし、staging一式をhash検証後にcommitしてから明示`SRC_C`を返す。通常Buildはclean、Test Playは検証済みcacheだけ差分buildにする
- fontはproject-local TTF/OTF/TTCまたは同梱`JF-Dot-Shinonome16.ttf`（既定size 16 / threshold 190）から固定16x16の使用glyph subsetを生成する。glyph個別bboxではなくfont共通baselineで配置して句読点・括弧の設計位置を保持し、Shift-JIS round-trip、font cmap、atlas hashをbuild時にhard validationする
- H40 320x224、PAL0 system、PAL1 background、PAL2/PAL3 portraitを新規command/取込modalの既定とし、取込時はBG/SLOT0～3をPAL0～PAL3へ個別指定可能にする。背景・立ち絵のscene持続を含むVRAM/80 sprite/scanline/4MiB予算をbuild errorで検査する。SpriteTextのBG_A tile予約とmessage tile baseはscene別最大値を使い、別sceneのoverlay最大値を合算しない
- message/choiceのShadow bandはHInt counter 1の周期割り込みをVBlankごとに数え、y=128から作る。armした途中frameでは次のVBlankまでShadowへ切り替えず、VBlankでH/Sとカウンタをリセットする。BG/overlay転送前には割り込みマスク下で即時解除する。文字はBGがPAL1ならPAL2、それ以外はPAL1を選び、H/Sで通常輝度になる予約index 14のlow-priority 16x16 spriteを1 glyphずつ使う。透明index 0は背景のShadowを解除しない。SpriteTextの旧BG_A dirty cellはlow-priority透明tile 0へ戻し、high-priority透明cellを後続messageへ残さない。選択PALのindex 14を使う可視assetはpreflight errorとし、表示中だけ文字色へ差し替えて終了時に復元する。実glyph数を80 pieces、20 pieces/scanline、320px/scanlineのgateへ計上し、固定377 tileは3回に分けてqueueし、最後のDMAがVBlankで反映された次frameから表示する
- Test Play用ResComp `.d`のproject絶対pathは`out/**`内だけで相対化し、日本語・空白project pathでも差分makeが依存素材を解決できるようにする
- PCE取込では参照画像が実寸224x136の通常BGだけを対象に、`source/**`のPNG/JPEG/BMP/WebP候補を読取専用hookで検査する。9方向cover cropで320x192へ変換し、portable master、source hash、resize recipe、`md-native-tiles`配置をbindingへ保存する。曖昧/未検出はPCE画像へfallbackし、256x224等は変更しない
- PCE CDDA/ADPCM/voiceはJSONを保持してwarning+NOP、PSG song/SFXは参照された`(assetId, channel)`だけXGM2/VGMまたはWAVへ変換する
- 詳細契約、入力対応、検証手順は`docs/NOVEL.md`を実装と同時に更新する

### Horizontal STG plugin規約

- 編集正本は `data/horizontal-stg/`。entityは安定ID、runtime IDは1～255、0はNONEに予約する
- 保存はrevision照合とatomic replaceを使い、削除は `.deleted` へ退避する。安定IDは専用UIで読取専用、collectionは選択entityだけをupsertして他定義を保持する
- 専用rendererに実BG_A/B・spriteの320x224 preview、敵／item／boss timeline、弾幕preview、8x8 stamp／eyedropper／undo、画像pipeline、VGM previewを置く。関連pluginへは汎用`api.pages.open()`で遷移する
- 背景は8bit indexed／非interlace／16色以下／224px高。BG_A幅はstage length、BG_B幅は `320 + (length >> parallax_shift)`
- 背景品質検査は反転を正規化した実効tile pattern、detail tile比率、4x4単色block比率を測る。160 pattern未満またはdetail 18%未満をwarning、固定HUD 18枚込み1500枚超をerrorにする。同梱v1.3はBG_B 364～602／BG_A 73～342の8x8語彙を最終解像度へ直接配置する
- `ts_hud_icons` はenum順を保つため `NONE NONE` で18 tileを生成し、`TILE_USER_INDEX`へロードして背景開始indexをその枚数だけ後ろへずらす
- titleは320x224 `img_title_background`をBG_B、透明`img_title_logo`をBG_Aへ`NONE ALL`で描画し、合計1005 user tile以内へ収める。ロゴ64走査線だけ`HSCROLL_LINE`で半振幅変形し、画面遷移時はplane scrollへ必ず戻す
- builderは `src/boot/rom_head.c` を上書きせず、全Cソースを `makeVariables.SRC_C` へ重複なく列挙する
- 生成対象はconfig、Shift-JIS text、audio/render、enemy/boss/weapon/stage、event stream、RES、reportを一体で更新する
- 新規projectには `template_horizontal_stg`、完成例には `template_geroneko_abyss_strike` を使う
- 詳細契約と検証は `docs/HORIZONTAL_STG.md` を実装と同時に更新する

### Dungeon game v1.1 素材セット規約

- `data/dungeon/settings.json.asset_sets` は順序付きの1～255件で、各要素は安定した `id`、表示用 `name`、壁・扉・床・天井・宝箱・上り階段・下り階段の7参照を持つ `assets` から成る。重複ID、0件、255件超過は保存/ビルドエラーにする。
- `data/dungeon/floors/*.json` はinline `assets` を複製せず `asset_set_id` で参照する。存在しない参照はエラーにし、最後のセットとフロア参照中のセットは削除させない。旧inline `assets` は読み込み/ビルド互換を保ち、最初の明示保存で内容ごとに重複排除して新形式へ移行する。
- フロアと設定を同時保存する変更には `saveDungeonState({ floor, settings })` を使い、exportを1回にまとめる。既存のfloor/settings個別hookは後方互換のため残す。
- rendererの素材選択は `dialog.openFile` → `image-import-pipeline.convertToIndexed16()` → `writeAssetFile()` を使い、変換結果の `targetExtension` を尊重して `res/dungeon/textures/<set-id>/` に保存する。raw pathは編集入力にせず読み取り専用表示とする。
- 保存画像は8bit・非interlace・16色以下のindexed PNG。壁/扉は96x96・不透明、床/天井は32x32・不透明、宝箱/上下階段は48x48・透過可としてrenderer/serviceの両方で再検証する。カードpreviewはcontain表示、pixel smoothingなしで寸法・色数・保存先・検証結果を併記する。
- 新規タグなし画像は全体を1要素として扱う。既存の `path#tag` は3x2/4x2アトラス互換として切り出す。上書き時はtexture cacheを無効化し、非同期previewは世代管理して別セットへ古い結果を反映しない。
- 床/天井の32x32パターンはデシジョンタイルへ焼き込まず、BG_Bの下半分/上半分（各200x64）へ固定反復配置する。壁/扉はpalette index 0を透明にしたBG_A動的タイルとして重ね、rendererとserviceは同じ合成順でWYSIWYGを保つ。
- ビルドは参照中セットごとに壁/扉tileset、床/天井background tileset、通常/暗闇palette、ビルボードpalette + sprite sheet、decision tableを生成し、`DunViewSet`レジストリとフロアのセットindexで切り替える。未参照セットはROMへ出力せず、cache/budget/warningはセット別と合計で返す。
- 壁・扉によるビルボード遮蔽は共有render coreの4bit深度コード (`0=壁なし、1～15=遠→近`) を8x8タイル内の最小非ゼロ値へ縮約し、重なる全ビルボードについて `tile_min_wall_depth > billboard_depth` の場合だけBG_Aを高Priorityにする。同一コード・遠い壁は低Priorityのままとし、previewとSGDKでstatic/fwd/turnおよび敵スライドの深度補間を一致させる。
- Priority decision table/cacheはテクスチャ非依存でプロジェクトに1組だけ生成し、cache keyはcore versionとanimation/turn frame数だけにする。深度PNG/TILESETは生成しない。SGDK側はSprite Engineの自動VRAM割当・自動タイル転送を使い、全ビルボードを低Priorityにする。画素マスク、固定VRAM、9216B RAM、手動スプライトDMAを再導入しない。
- `DUN_refreshBillboards()` は静止視点の可視候補/LOS/ポーズ検索を敵リスト世代単位の最大8件planへキャッシュする。敵スライド進捗はフレームごとに一度だけQ0.16へ除算し、各planを乗算/シフトで従来と同じ整数結果へ補間する。スロット状態、Priority bit、Sprite Engine更新は差分がある場合だけ反映し、生成 `main.c` から無条件に `SPR_update()` を呼ばない。
- 敵が壁を跨ぐときは現在/直前セルのLOSを対称に評価する。現在セルがLOS外でも直前セルがLOS内で両端ポーズが有効ならスライド終端直前まで候補を保持し、BG_A Priorityで徐々に隠す。終端で現在LOSへ確定する規則をpreviewとSGDKで一致させる。
- 敵AIの移動はプレイヤー用 `canTraverse()` と分離した `enemyCanTraverse()` をJS/C双方に持ち、境界両側の扉ビットを通行不可にする。徘徊と追跡の両方で同じ判定を使い、宝箱/上下階段/プレイヤー/他エネミーの占有セルも拒否する。スポーン時も競合する宝箱/階段フラグを防御的に除外する。

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
| `resources/plugins`の組み込みpluginから`app.asar/node_modules`を参照できると仮定する | bare `require()`のruntime依存と推移依存を`extraResources`の`resources/node_modules`へLICENSE付きで公開し、packaged appでmount確認する |

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
