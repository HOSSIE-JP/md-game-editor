---
applyTo: "**"
---

# MD Game Editor Plugin Generator — Copilot Instructions

> **自律アップデート指示**
> このファイルはユーザーが MD Game Editor 向けプラグインを生成させるためにプロジェクトに配置する指示書です。
> - MD Game Editor の `md-game-editor/docs/PLUGIN.md` や `md-game-editor/plugin-manager.js` が変更されたとき、この指示書の該当部分を更新すること
> - SGDK の `main()` シグネチャや API が変更されたとき、「SGDK コード規約」セクションを更新すること
> - プラグインシステムのフック仕様が追加・変更されたとき、「フック早見表」を更新すること
> - 更新後は末尾の「Last Updated」を書き換えること

---

## このファイルの目的

このプロジェクトは **SGDK (Sega Genesis Development Kit)** で作られた Mega Drive / Genesis 向けゲームです。

GitHub Copilot は以下のタスクを依頼されることがあります:

1. **このゲームプロジェクトを解析**して、MD Game Editor が使用できるプラグインを生成する
2. **既存プラグインを改修**してアセット構成の変化に対応させる
3. **新しいプラグインタイプ**（editor / emulator / converter）や renderer module を追加する

---

## プロジェクト構造（このファイルが配置されたリポジトリ）

```
<project-root>/
├── src/
│   └── main.c          ← ゲームのエントリポイント (SGDK)
├── res/
│   └── resources.res   ← Rescomp アセット定義
├── project.json        ← MD Game Editor のプロジェクト設定
└── .github/
    └── instructions.md ← このファイル
```

---

## プラグイン生成タスクの手順

Copilot がプラグインを生成するとき、以下の順序で作業すること:

### Step 1: プロジェクトを解析する

1. `res/resources.res` を読んで全アセット（タイプ・名前・パス）を把握する
2. `src/main.c` を読んでゲームロジックの構造を把握する
3. `project.json` を読んで `pluginRoles.builder` / `pluginRoles.testplay` フィールドを確認する

### Step 2: manifest.json を作成する

```jsonc
{
  "id": "<plugin-id>",          // フォルダ名と一致（英小文字・ハイフンのみ）
  "name": "<表示名>",
  "description": "<説明>",
  "version": "1.0.0",
  "icon": "build",
  "types": ["build"],           // 必ず配列
  "generator": true,            // generateSource/generateSourceAsync を持つ場合。hook 専用なら false
  "supportedCores": ["mega-drive"], // mega-drive / pc-engine / *。未指定は legacy MD 扱い
  "hooks": ["onBuildStart", "onBuildEnd"],
  "permissions": ["project.read", "project.write", "build.configure"],
  "roles": [
    { "id": "builder", "label": "Build", "exclusive": true, "order": 10 }
  ],
  "renderer": {                  // UI/capability を提供する場合のみ
    "entry": "renderer.js",
    "styles": ["style.css"],
    "page": "my-page",
    "capabilities": ["page"]
  }
}
```

### Step 3: index.js を作成する

```js
'use strict';

const manifest = require('./manifest.json');

/**
 * @param {Array<{type:string, name:string, sourcePath:string, sourceAbsolutePath:string}>} assets
 * @param {{ projectDir: string, logger: object }} context
 */
function generateSource(assets, context) {
  // このプロジェクトのアセット構成に合わせてコードを生成する
  return { ok: true, sourceCode: '/* generated */' };
}

function onBuildStart(payload, context) {
  context.logger.info(`ビルド開始: ${payload.projectDir}`);
  return { ok: true };
}

module.exports = { generateSource, onBuildStart };
```

### renderer.js を持つ場合

Plugin Runtime v2.5 では、Assets / Code / Converter のような機能固有 UI を本体 `md-game-editor/renderer/renderer.js` に追加しない。
プラグイン配下の `renderer.js` で capability を登録する。

```js
export function activatePlugin({ plugin, root, pageRoot, hostRoot, api, logger, registerCapability }) {
  const modal = api.createModal({
    id: `${plugin.id}-modal`,
    html: '<p>Plugin UI</p>',
  });
  registerCapability('my-capability', { root });
  logger.info(`${plugin.id} renderer activated`);
  return {
    deactivate() {
      modal.destroy();
    },
  };
}
```

`renderer.entry` と `renderer.styles` は plugin ディレクトリ内の相対パスに限定する。`../` や絶対パスで plugin 外へ出る指定は禁止。
ページを持たない converter でも `hostRoot` が渡されるため、独自 modal や背景処理のために本体 HTML を変更しない。
editor plugin の `pageRoot` / `root` は `<section class="editor-page">` 自体なので、root に付ける plugin 固有 class へ `display` を指定しない。ページ表示はホストの `.editor-page.active` が管理する。ページ全体の `display: flex` / `grid` は root 直下に wrapper 要素を作って指定する。
プラグイン同士の連携は `api.capabilities.get()` / `api.capabilities.require()` / `api.events.on()` / `api.events.emit()` を使い、本体側に個別 plugin ID の分岐を追加しない。
renderer から main process hook を呼ぶ場合は `hooks` と `mainApi.hooks` の両方に宣言し、`api.plugins.invokeHook()` または `window.electronAPI.invokePluginHook()` を使う。
未保存のpluginデータをBuild/Test Play/project切替へ反映する場合、`activatePlugin()`の返却objectへasync `beforeBuild(payload)` / `beforeProjectSwitch(payload)`を実装する。active順にawaitされ、`false`、`{ ok: false, error, canceled? }`、throw/rejectは操作を中止する。正本へのatomic save完了前に成功を返さない。
asset type / import / image 変換は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として登録する。
PC Engine core の asset schema は `assets/pce-assets.json` v2 を標準にし、`image` / `sprite` / `palette` / `psg-song` / `psg-sfx` / `adpcm` / `cdda-track` を扱う。旧 `psg-sequence` は `psg-sfx` として正規化する。
PCE 専用の標準 editor/converter は `pce-asset-manager` / `pce-sprite-editor` / `pce-palette-editor` / `pce-music-editor` / `pce-image-converter` / `pce-audio-converter` とし、`supportedCores: ["pc-engine"]` を宣言する。
PCE-CD は `targetMedia: "cd"` + `toolchain: "llvm-mos"` の実験的ターゲットで、IPL / System Card はユーザー指定ファイルに限定し、plugin や repository に同梱しない。
Build / Test Play など単一選択 plugin は `roles` で宣言し、project.json の標準保存先は `pluginRoles` とする。
単一選択 role で競合 plugin が無効化される場合、その plugin に依存する plugin も同時に無効化される。
Runtime v2.5 では `project.json.coreId` がプロジェクト単位の実効 core。未指定の既存 MD project は `mega-drive`、`platform: "pce"` を持つ既存 PCE project は `pc-engine` として扱う。
新規 plugin は `supportedCores` を宣言する。MD 専用は `["mega-drive"]`、PCE 専用は `["pc-engine"]`、共有 plugin は `["*"]`。未宣言 plugin は後方互換のため MD 専用扱い。
現在 core に非対応の plugin は既定で非表示になり、有効化、role 選択、hook/generator 呼び出し対象から除外される。
setup / project / build / asset schema / template のようなシステム固有機能は `types: ["core"]` の core plugin/provider 側に置く。
`permissions` は v2.5 では表示・レビュー用途の宣言で、sandbox 強制ではない。
新規 plugin で本体 `main.js` / `preload.js` / `build-system.js` の個別追記が必要に見える場合は、まず Runtime v2.5 の汎用 API または core provider の不足として扱う。

### Runtime v2.5 で必ず守る開発手順

1. `manifest.json` に `types`、`supportedCores`、`permissions`、必要な `roles`、`hooks`、`renderer.capabilities` を宣言する
2. Build / Test Play の単一選択 plugin は `roles` を宣言し、project 側は `project.json.pluginRoles` に保存する
3. MD 専用 plugin は `supportedCores: ["mega-drive"]`、PCE 専用 plugin は `["pc-engine"]`、共有 plugin は `["*"]` を宣言する
4. UI、modal、preview、converter 連携は plugin の `renderer.js` で実装し、本体 HTML / renderer / main / preload へ個別追記しない
5. main process の処理が必要な場合は `hooks` と `mainApi.hooks` に同じ hook 名を宣言し、renderer から `api.plugins.invokeHook()` で呼ぶ
6. asset 登録拡張は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として提供する
7. アセット参照を持つ editor plugin は、画面表示時または sidebar 再アクティブ時に `.res` / source data を再読込し、一覧・select・preview を最新化する
8. 未保存変更がある状態で別アセット選択・新規追加・import を行う場合は、保存 / 破棄 / キャンセルを選べる plugin-owned modal を出す

### Step 4: 配置場所を案内する

生成したプラグインフォルダを以下のどちらかに配置するようユーザーに案内する:

- **開発時** → MD Game Editor リポジトリの `md-game-editor/plugins/<plugin-id>/`
- **パッケージ済みアプリ** → `<userData>/plugins/<plugin-id>/`  
  （Settings > Plugins 画面の「📂 フォルダを開く」から開ける）

組み込みpluginは配布時に`resources/plugins`へ置かれ、`app.asar`の外側から読み込まれる。bare `require("package")`を使う場合、root `dependencies`だけでは解決できないため、推移依存とLICENSEを含めて`electron-builder.yml`の`extraResources`から`resources/node_modules`へ公開し、実packaged appでplugin mountを確認する。userData pluginは依存をplugin-localに同梱する。

---

## SGDK コード規約（必須）

### main 関数シグネチャ

```c
/* SGDK 2.11 以降 — 必須シグネチャ */
int main(bool hardReset)
{
    (void)hardReset;
    /* ... */
    return 0;
}
```

> ⛔ `void main()` や `int main(void)` は **使用禁止**。ビルド警告が発生する。

### よく使う SGDK API

```c
#include <genesis.h>

// 画面
VDP_setScreenWidth320();
VDP_drawImage(BG_B, &myImage, 0, 0);
VDP_clearPlane(BG_B, TRUE);

// パレット
PAL_setColors(0, (u16*)palette_black, 64, CPU);
PAL_fadeIn(0, 63, savedPal, 20, FALSE);
PAL_fadeOut(0, 63, 10, FALSE);

// ジョイパッド
u16 btn = JOY_readJoypad(JOY_1);
if (btn & BUTTON_A) { /* ... */ }

// 音楽 (XGM2)
XGM2_loadDriver(TRUE);
XGM2_play(bgm);
XGM2_stop();

// Vblank
SYS_doVBlankProcess();
```

---

## resources.res の読み方

各行のフォーマット:

```
TYPE   name   "ファイルパス"   [追加パラメータ]
```

| タイプ | C の extern 型 | 説明 |
|---|---|---|
| `IMAGE` | `const Image name;` | 背景画像 (最大 320×224px) |
| `SPRITE` | `const SpriteDefinition name;` | スプライト定義 |
| `XGM2` | `const u8 name[];` | FM 音楽 (SGDK 2.x 推奨) |
| `XGM` | `const u8 name[];` | FM 音楽 (旧形式) |
| `WAV` | `const u8 name[];` | PCM サウンド |
| `TILESET` | `const TileSet name;` | タイルセット |
| `MAP` | `const Map name;` | タイルマップ |
| `PALETTE` | `const Palette name;` | パレット定義 |

生成コードでは `resources.h` をインクルードすることで extern 宣言が自動で提供される:

```c
#include <genesis.h>
#include "resources.h"
```

TileMap エディタの collision は ResComp の `MAP` / `TILEMAP` layer_id ではなく、TMX の `Collision` / `Collision:<name>` tile layer として保存される。ゲーム側で使う場合はエディタが生成する `inc/tilemap_collision.h` / `src/tilemap_collision.c` の `tilemap_collision_at()` を参照する。

---

## Editor UI / preview ノウハウ

- editor plugin の `root` は `.editor-page` なので `display` を直接指定しない。ページ内 wrapper に grid / flex を指定する。
- アセット編集画面は、左に一覧、中央に preview / editor、右に property form の 3 列を基本とする。左右列や中央上下 preview は resizer / splitter で調整可能にする。
- pane header / toolbar は端まで通し、padding はフォームや空状態メッセージ側に持たせる。pane 自体に padding を入れると特定列のヘッダーだけ内側へずれる。
- 保存 / 削除 action は選択中アセットのリスト項目右端に置き、未保存状態もリスト上で分かるようにする。
- 繰り返し UI は各行に同じ label を置かず、ヘッダー行 + テーブル型にする。Animation Rows では `ROW / 有効 / 既定 time / 状態` のような列にする。
- 再生・停止・先頭・末尾・loop は icon button を使う。select の表示は `1 (4 frames)` のように、周辺文脈と重複しない短い表記にする。
- SPRITE preview はスプライトシート全体ではなく、RESCOMP 定義の frame size / ROW animation / time / collision を反映する。`time=0` は SGDK に合わせて再生停止として扱い、canvas では `imageSmoothingEnabled = false` を指定する。

### Dungeon game v1.1 素材セット

- `settings.json.asset_sets` に、安定した `id`、表示用 `name`、壁・扉・床・天井・宝箱・上り階段・下り階段の7参照を持つ素材セットを1～255件、順序付きで保存する。フロアはinline素材を持たず `asset_set_id` で参照する。
- 重複ID、存在しない参照、セット0件、255件超過は保存/ビルドエラーにする。最後のセットと参照中セットは削除させない。旧 `floor.assets` は開くだけでは書き換えず、最初の明示保存時に同一内容を重複排除して全フロアを一括移行する。
- フロアと設定を一度に更新するときは `saveDungeonState({ floor, settings })` を使い、exportを1回だけ行う。既存の個別保存hookは後方互換のため維持する。
- 素材UIはplugin renderer内に置き、`dialog.openFile`、`image-import-pipeline.convertToIndexed16()`、`writeAssetFile()` を利用する。結果の `targetExtension` を尊重し、project内の `res/dungeon/textures/<set-id>/` だけへ保存する。
- 変換後は8bit・非interlace・16色以下のindexed PNGであることをrenderer/serviceの双方で検証する。壁/扉は96x96・不透明、床/天井は32x32・不透明、宝箱/上下階段は48x48・透過可。エラー時は設定を更新しない。
- 各素材カードはcontain表示、pixel smoothingなしのpreviewと、寸法・色数・保存先・検証結果を表示する。上書き後はtexture cacheを破棄し、非同期読込結果には世代番号を持たせる。新規タグなし画像は全体、旧 `path#tag` は3x2/4x2アトラス要素として扱う。
- 床/天井の32x32パターンはBG_Bの下半分/上半分（各200x64）へ固定反復配置し、decision tableへ焼き込まない。壁/扉はpalette index 0が透明なBG_A動的タイルとして重ねる。previewとgeneratorは共有render coreで同じ合成を行う。
- 参照中の素材セットごとにSGDK tileset/background/palette/billboard sprite/decision tableを生成し、フロアの素材セットindexと `DunViewSet` registryで初期表示・フロア遷移時に切り替える。未使用セットをROMへ含めず、cacheとbudgetはセット単位に管理する。
- 壁・扉による宝箱/階段/エネミーの部分遮蔽は、共有render coreで `0=壁なし、1～15=遠→近` に量子化し、8x8タイル内の最小非ゼロ壁コードが重なる全ビルボードのコードより大きい場合だけBG_Aを高Priorityにする。previewとSGDKは同じ厳密比較・整数補間・タイル単位判定を使う。
- Priority decision tableはテクスチャ非依存の共通1組とし、素材セット追加で複製しない。深度PNG/TILESETを生成せず、SGDK側は低Priorityスプライトの自動VRAM割当・自動タイル転送を使う。画素マスク、8スロット×36タイル固定VRAM、9216B RAM、手動スプライトDMAを再導入しない。
- `DUN_refreshBillboards()` は静止視点の可視候補/LOS/ポーズ検索を敵リスト世代単位で最大8件のplanへキャッシュする。敵スライド進捗の除算はQ0.16生成の1回/フレームに集約し、各スロットは乗算/シフトで従来と同じ整数結果へ補間する。setter、Priority map DMA、`SPR_update()` は対応する差分がある場合だけ実行し、生成 `main.c` に無条件の `SPR_update()` を置かない。
- 敵の壁跨ぎは現在/直前セルのLOSを対称に扱う。現在セルがLOS外でも直前セルがLOS内で両端ポーズが有効ならスライド終端直前まで候補を残し、BG_A Priorityに隠させる。終端で現在LOSへ確定する規則をpreviewとSGDKで一致させる。
- 敵AIはプレイヤー用 `canTraverse()` と別の `enemyCanTraverse()` をJS/C双方で使い、境界両側の扉ビットを通行不可にする。徘徊・追跡とも同じ判定を通し、宝箱/上下階段/プレイヤー/他エネミーのセルは占有不可、競合する宝箱/階段フラグはスポーン時にも除外する。

---

## フック早見表

| フック | 呼ばれるタイミング | payload の主要フィールド |
|---|---|---|
| `onBuildStart` | ビルド開始直前 | `projectDir` |
| `onBuildLog` | ビルドログ 1 行ごと | `text`, `level` |
| `onBuildEnd` | ビルド成功後 | `projectDir`, `romPath`, `elapsed` |
| `onBuildError` | ビルド失敗時 | `projectDir`, `error` |
| `onTestPlay` | Test Play ボタン押下 | `romPath` |
| `generateSource` | ジェネレータ実行時 | *(assets 配列)* |

`onTestPlay` の `context.testPlay` には、組み込みエミュレータープラグイン向けに `openWasmWindow` / `openApiWindow` / `startApiServer` / `stopApiServer` / `isApiServerRunning` が渡される。

---

`onBuildStart`が`{ ok: false }`を返す、throwする、またはPromise rejectした場合、MD/PCEともtoolchainは開始されず、`onBuildError`が1回だけ呼ばれる。hook専用builderは`generator: false`にし、preflight/codegenは`onBuildStart`へ一本化する。

renderer activationの`beforeBuild` / `beforeProjectSwitch`はmain process hookではなく、未保存renderer stateを永続化またはvetoする非同期lifecycleである。

---

## generateSource の実装ルール

1. **バリデーション優先**: 必要なアセットが存在しない場合は `{ ok: false, error: "説明" }` を返す
2. **生成コードの先頭コメント**: `/* Generated by <plugin-id> v<version> */` を必ず入れる
3. **アセット名から変数名を動的生成**: ハードコードを避ける
4. **SGDK ヘッダのみ使用**: `#include <genesis.h>` と `#include "resources.h"` だけで完結させる
5. **エラーは例外でなく返り値で**: `throw` ではなく `{ ok: false, error }` を使う

---

## project.json へのプラグイン登録

プラグインを生成したら、`project.json` の `pluginRoles.builder` を更新するよう案内する:

```json
{
  "name": "My Game",
  "author": "Your Name",
  "serial": "GM MYGAME-00",
  "region": "JPN",
  "pluginRoles": {
    "builder": "<新しいプラグインのid>",
    "testplay": "standard-emulator"
  }
}
```

---

## MDノベル plugin

- `md-novel-editor`は`assets/pce-vn-scenes.json` v2を正本として未知fieldを保持し、MD設定を`data/md-novel/target-profile.json`、asset対応を`asset-bindings.json`へ分離する。
- renderer UI、import、preview、診断はplugin内に置き、main serviceはproject root/realpath検査、revision、atomic replace、transaction hashを必須とする。
- `beforeBuild` / `beforeProjectSwitch`は未保存編集をatomic saveし、失敗した場合はvetoする。古いdisk状態でBuild/Test Playを成功させない。
- `md-novel-builder`は`generator: false`のhook-only builder。canonical dataを変更せず、staging生成物をhash検証してからcommitし、`makeVariables.SRC_C`へ全C sourceを明示する。
- H40 320x224、PAL0=system、PAL1=background、PAL2/PAL3=portrait。背景・立ち絵のscene持続を含むVRAM、sprite、scanline、DMA、4MiB ROM gateをbuild時に再検査する。
- CDDA/ADPCM/voiceはwarning+NOP、PSG song/SFXは参照された`(assetId, channel)` variantだけをXGM2/VGMまたはWAVへ変換する。
- 実装、`docs/PLUGIN.md`、`docs/NOVEL.md`、`tests/novel-plugins.test.js`を同じ作業で更新する。

---

## 横スクロールSTG plugin

- `horizontal-stg-editor` は `data/horizontal-stg/` の安定ID付きJSONを専用フォームで編集し、安定IDを読取専用にする。collectionは選択entityだけをupsertし、revision競合、atomic write、`.deleted` 退避、未保存ガードを維持する
- rendererに実BG_A/B・spriteの320x224 preview、敵／item／boss timeline、弾幕preview、8x8 stamp／eyedropper／undo、共有画像pipeline、VGM previewを置き、Sprite／TileMap／BGM editorへは汎用`api.pages.open()`で遷移する
- `horizontal-stg-builder` は共通runtimeと生成C/RESを同期し、`makeVariables.SRC_C` に全Cソースを重複なく明示する
- `src/boot/rom_head.c` は本体生成を尊重して上書きせず、`sega.s` を通常Cソースへ混入させない
- 背景は8bit indexed／非interlace／16色以下／224px高。BG_A幅はstage length、BG_B幅は `320 + (length >> parallax_shift)`
- 背景は反転重複除去後の実効pattern数、detail tile比率、4x4単色block比率を検査する。160 pattern未満またはdetail 18%未満をwarning、固定HUD 18 tile込み1500 tile超をerrorにする。同梱v1.3はBG_B 364～602／BG_A 73～342の8x8語彙を最終解像度へ直接配置する
- HUD icon atlasは順序固定のため `TILESET ... NONE NONE` とし、`TILE_USER_INDEX`の18 tileを背景より先に予約する
- titleは320x224 `img_title_background`と透明`img_title_logo`を別`IMAGE ... NONE ALL`にし、合計1005 user tile以内へ収める。BG_Aのロゴ64走査線だけ`HSCROLL_LINE`で半振幅変形し、別画面では`HSCROLL_PLANE`へ戻す
- event triggerはframe/scroll/condition、commandはspawn enemy/item、start boss、stage clear、set flagを生成前に参照検証する
- `template_horizontal_stg` は汎用スターター、`template_geroneko_abyss_strike` は5面完成例としてbuilderとstandard WASM roleを選択済みにする
- 仕様変更時は `docs/HORIZONTAL_STG.md`、`docs/PLUGIN.md`、`tests/horizontal-stg-plugins.test.js` を同じ作業で更新する

---

## OSS / ライセンス遵守

- 生成するすべてのコードは **オリジナル実装** とする
- 外部リポジトリのコードを直接コピーしない
- SGDK 公式 API の使用は問題ない
- GPL/AGPL コードを参考に実装した場合は制御フローを変えて書き直す

---
*Last Updated: 2026-08 / SGDK 2.11 / Plugin Runtime v2.5 / Core Plugin / PCE asset/audio plugins / AI Control API / TileMap collision / Rhythm game plugins / Dungeon game plugins v1.3 / Horizontal STG editor and builder v1.3 / MD Novel editor and builder / Async save and build abort lifecycle / Stable STG IDs and SGDK event streams / Graphical STG HUD / final-resolution tile backgrounds and line-warped title art / GERONEKO five-stage template / Editor UX guardrails / Bundled WASM SRAM and split metadata*


## MD/PCE split note

- Mega Drive plugins are developed under `md-game-editor/plugins/<plugin-id>/`.
- PC Engine plugins are developed under `pce-game-editor/plugins/<plugin-id>/`.
- Shared plugins must explicitly declare `supportedCores: ["*"]`; v1 shared distribution includes `code-editor`.
- Core-specific plugins should not be copied between apps unless their manifest support and runtime behavior are intentionally made shared.

## Bundled WASM split note

- The split MD Game Editor repository tracks the Mega Drive WASM runtime under `plugins/standard-emulator/`.
- `plugins/standard-emulator/emulator-build.json` records the source emulator commit, dirty state, build meta, and SHA-256 hashes for bundled runtime files.
- Refresh the bundle only by building the emulator repo first and running `MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg`.
- Without `MD_EMULATOR_REPO`, `copy-pkg` verifies the bundled runtime and must not require the parent `md_emulator` checkout.
- The split editor repository does not build `md-api`; `standard-api-emulator` needs a platform binary under `plugins/standard-api-emulator/bin/` if that plugin is used.
