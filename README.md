# md-game-editor

Electron ベースの **Mega Drive Game Editor** です。  
`standard-emulator` プラグインにビルド済み Mega Drive WASM エミュレーターを同梱し、親の `md_emulator` リポジトリがなくても Test Play を起動できます。

同梱しているエミュレーターの出所は `plugins/standard-emulator/emulator-build.json` に記録します。WASM package version、build meta、元リポジトリ commit、dirty 状態、各同梱ファイルの SHA-256 を追跡できます。

---

## 目次

1. [ディレクトリ構成](#ディレクトリ構成)
2. [前提条件](#前提条件)
3. [初期セットアップ](#初期セットアップ)
4. [開発モードで起動](#開発モードで起動)
5. [パッケージング (配布ビルド)](#パッケージング-配布ビルド)
6. [ポータブルモード](#ポータブルモード)
7. [アプリ名・アイコンの変更](#アプリ名アイコンの変更)
8. [利用プロジェクトでの拡張方法](#利用プロジェクトでの拡張方法)
9. [アンインストール](#アンインストール)

---

## ディレクトリ構成

```
md-game-editor/
├── main.js                  # メインプロセス (ウィンドウ管理 / IPC ハブ)
├── preload.js               # メインウィンドウ向け contextBridge
├── debug-preload.js         # デバッグウィンドウ向け contextBridge
├── testplay-settings-preload.js  # テストプレイ設定ウィンドウ向け contextBridge
├── setup-manager.js         # ツール (SGDK / JRE / marsdev) の管理
├── build-system.js          # SGDK ビルドオーケストレーション
├── electron-builder.yml     # パッケージング設定
├── package.json
├── renderer/                # レンダラープロセス (HTML / CSS / JS)
│   ├── index.html           # メイン画面 (プロジェクト設定 / ビルド)
│   ├── testplay-settings.html  # 入力設定画面
│   ├── debug-wasm.html      # WASM デバッグビューア
│   └── style.css
├── scripts/
│   ├── copy-pkg.js          # 同梱 WASM の検証 / 明示された md_emulator repo からの更新
│   └── prepare-dist.js      # パッケージ前準備 (build-meta 注入 + 同梱 WASM 検証)
├── projects/                # 同梱サンプルプロジェクト
└── plugins/                 # Build / Test Play / Editor プラグイン
```

---

## 前提条件

| ツール | バージョン | 用途 |
|---|---|---|
| Node.js | 20 LTS 以上 | Electron / npm |
| SGDK | 2.0 以上 | ゲーム ROM ビルド (任意) |
| MD Emulator repo | 任意 | 同梱 WASM を新しいエミュレーター成果物で更新する場合のみ |

### インストール確認

```powershell
node -v
```

---

## 初期セットアップ

```powershell
# 分離後の md-game-editor リポジトリで
cd d:\path\to\md-game-editor

# 1. Electron 依存関係のインストール
npm install

# 2. 同梱 WASM アセットの検証
npm run copy-pkg
```

同梱 WASM を新しい `md_emulator` の成果物で更新する場合だけ、`MD_EMULATOR_REPO` にエミュレーターリポジトリを指定します。先にエミュレーター側で `npm run wasm:build` または `npm run wasm:build:release` を実行し、`frontend/pkg/` を更新してください。

```bash
MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg
```

---

## 開発モードで起動

```powershell
npm start          # 起動準備後、Electron をシグナル転送ラッパー経由で起動
# または
npm run dev        # start と同等
```

## Rescomp アセット管理（メイン画面 Assets）

メイン画面の Assets ページは、SGDK プロジェクトの `res/*.res` を読み取り、定義をファイル単位で管理できます。

### できること

- `.res` ファイルの選択と新規作成
- 定義一覧の検索フィルタ（名前 / 種別 / 入力パス）
- 対応タイプの定義編集
  - `PALETTE`, `IMAGE`, `BITMAP`, `SPRITE`, `XGM`, `XGM2`, `WAV`, `MAP`, `TILEMAP`, `TILESET`
- アセット登録（ファイルダイアログ）
  - 選択したファイルを `res/` 配下へコピー（サブディレクトリ指定可）
  - その相対パスで `.res` に定義を追加

### MIDI BGM の登録

`.mid` / `.midi` を登録する場合は、Assets ページの「登録」で MIDI ファイルを選び、通常のアセット登録画面で type / symbol / 保存先を確認して登録します。MIDI Converter は追加の確認画面を開かず、その設定を使ってすぐに変換と `.res` 登録を行います。

基本手順:

1. `Symbol` に C コードから参照するアセット名を入力する。
2. 通常は `Target` を `XGM2 (VGM source)` のままにする。
3. 「登録」を押す。

この設定では `res/music/<symbol>.vgm` が生成され、`resources.res` に `XGM2 <symbol> music/<symbol>.vgm` として登録されます。Mega Drive / SGDK の BGM として使う場合は、この XGM2 登録が推奨です。

`Target` に `XGM` を選ぶと `.xgm` を直接登録できます。この場合、`resources.res` には `XGM <symbol> music/<symbol>.xgm AUTO` が登録されます。ただし `.xgm` 生成には SGDK 付属の `xgmtool.exe` が必要です。`xgmtool.exe` が見つからない、または実行できない環境では VGM 生成までは成功し、XGM 登録は warning として止まります。

変換結果の status に `Voice steal` が多く表示される場合は、MIDI の同時発音数が Mega Drive の FM チャンネル数を超えています。必要に応じて BGM 作曲プラグインへ import し、トラック割当や音数を調整してください。

登録後に Assets 一覧で `.vgm` ソースの `XGM2` アセットを選ぶと、プレビューパネルの再生ボタンで簡易 VGM preview ができます。これは Web Audio による FM + PSG 近似再生で、実機音色の完全再現ではありませんが、メロディやテンポの確認に使えます。`.xgm` のみのアセットは初期対応では preview 対象外です。

### 画像減色（16色化）

画像系アセット登録時、16色を超える場合は減色ダイアログを開けます。

- 透明色（パレット 0）の扱い
  - 指定なし
  - 元画像の透明情報を利用
  - 指定色を透明色として利用
- ディザリング
  - ON/OFF
  - ウェイト調整
  - パターン選択（`diagonal4`, `diagonal2`, `horizontal4`, `horizontal2`, `vertical4`, `vertical2`）
- 変換前/変換後をリアルタイムプレビュー

Assets ページ上部の `res ディレクトリを開く` ボタンで、現在のプロジェクトの `res/` をエクスプローラーで直接開けます。

### プラグイン開発時の注意

アセット登録やゲーム固有エディタを plugin として追加する場合は、詳細仕様を [`PLUGIN.md`](PLUGIN.md) に集約しています。特に画像 import では、標準 Assets 画面と plugin 固有 UI の両方が同じ converter capability を使うため、片方だけに変換・保存処理を実装しないでください。

画像変換 pipeline は `convertedDataUrl` だけでなく、保存拡張子を表す `targetExtension` も返す設計にすると安全です。BMP を PNG 化する場合は canvas の `toDataURL()` だけに頼ると indexed palette が失われるため、BMP のカラーテーブルとピクセル index、PNG の `PLTE` / `tRNS` を直接扱う実装にしてください。palette index 0 を透明色やシステム上の特別色として扱うゲームでは、保存後のファイルを再読込して palette 0 が維持されていることを確認します。

plugin を変更した後は、少なくとも以下を確認します。

```powershell
node --check plugins\<plugin-id>\renderer.js
node --check plugins\<plugin-id>\index.js
npm test
```

---

## パッケージング (配布ビルド)

### Windows (既定: ポータブル ZIP)

```powershell
npm run build:win
# → dist/MegaDriveGameEditor-0.1.0-x64.zip
```

この ZIP は既に portable モード用に構成されており、展開後すぐに実行できます。
実行ファイルと同階層に `portable` マーカーを自動同梱するため、設定・ツール・プロジェクトは ZIP 展開先の `data/` に保存されます。

### Windows (任意: NSIS インストーラー)

```powershell
npm run build:win:installer
# → dist/MegaDriveGameEditor-0.1.0-x64.exe
```

### macOS (DMG)

```bash
npm run build:mac
# → dist/MegaDriveEmulator-0.1.0.dmg
```

内部で実行されること (`prepare:dist`):

1. `build-meta.json` を生成
2. `plugins/standard-emulator/` 内の同梱 WASM アセットと `emulator-build.json` を検証

`prepare:dist` はエミュレーター repo の WASM ビルドや `md-api` の cargo build を実行しません。配布へ入れる WASM を更新する場合は、事前に `MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg` を実行してください。

VSCode タスクからも実行できます:

- `Electron: Prepare Dist Assets` — アセットのみ準備
- `Electron: Package (Windows)` — Windows 向けパッケージング
- `Electron: Package (macOS)` — macOS 向けパッケージング

---

## ポータブルモード

通常、アプリのデータ（設定・ツール・プロジェクトファイル）は OS のユーザープロファイル下に保存されます。

| OS | デフォルトパス |
|---|---|
| Windows | `%APPDATA%\MegaDriveEmulator` |
| macOS | `~/Library/Application Support/MegaDriveEmulator` |
| Linux | `~/.config/MegaDriveEmulator` |

**ポータブルモード**を有効にすると、すべてのデータをアプリ実行ファイルと同じフォルダ内の `data/` ディレクトリに格納します。USB ドライブなどへの持ち運びや、環境を汚さずに複数バージョンを共存させる用途に適しています。

### 有効化方法

#### パッケージ済みアプリ (配布版)

Windows の既定ビルド (`npm run build:win`) では、この `portable` ファイルは自動で含まれます。
手動で作成するのは、インストーラー版などを portable 化したい場合だけです。

`.exe` または `.app` と同じディレクトリに `portable` という名前の**空ファイル**を置きます:

```
MegaDriveEmulator.exe
portable            ← このファイルを作成
resources/
data/               ← ポータブルモード時にここにデータが保存される
```

```powershell
# Windows PowerShell 例 (exe と同じフォルダで実行)
New-Item -ItemType File -Name portable
```

#### 開発モード

リポジトリルートに `.portable` ファイルを置きます:

```powershell
New-Item -ItemType File -Name ".portable"
npm start
```

### ポータブルモードの解除

対応するマーカーファイル (`portable` / `.portable`) を削除すれば、次回起動からデフォルトの OS ユーザープロファイルに戻ります。

> **注意**: ポータブルモードのデータとデフォルトモードのデータは共有されません。引き継ぐ場合は `data/` フォルダを手動でコピーしてください。

---

## アプリ名・アイコンの変更

### アプリ名の変更

`electron-builder.yml` の `productName` を変更します:

```yaml
# electron-builder.yml
appId: com.yourcompany.yourgame    # ← アプリの一意 ID も変更推奨
productName: YourGameEditor        # ← ここを変更
```

`package.json` の `name` も合わせて変更しておくとよいです:

```json
{
  "name": "your-game-editor",
  "version": "1.0.0",
  "description": "Your Game Editor for Mega Drive"
}
```

### アイコンの変更

1. アイコンファイルを用意します:
   - Windows: `build/icon.ico` (256×256 推奨)
   - macOS: `build/icon.icns`
   - Linux: `build/icon.png` (512×512 推奨)

2. `electron-builder.yml` で参照します:

```yaml
win:
  icon: build/icon.ico
  target:
    - nsis
    - zip
mac:
  icon: build/icon.icns
  target:
    - dmg
linux:
  icon: build/icon.png
```

> `electron-builder` はデフォルトで `build/` フォルダを探すため、ファイルを置くだけで自動認識される場合もあります。

---

## 利用プロジェクトでの拡張方法

このリポジトリはサンプル実装です。独自ゲームプロジェクト用に以下を拡張してください。

### 1. IPC の追加 (バックエンド処理)

`main.js` に IPC ハンドラを追加します:

```js
// main.js
ipcMain.handle('myFeature:doSomething', async (_event, arg) => {
  // Node.js / OS API を自由に呼べる
  return { result: 'ok' };
});
```

対応する `preload.js` に公開 API を追加します:

```js
// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myFeatureAPI', {
  doSomething: (arg) => ipcRenderer.invoke('myFeature:doSomething', arg),
});
```

レンダラー側では `window.myFeatureAPI.doSomething(...)` として呼び出します。

### 2. ビルドシステムのカスタマイズ

`build-system.js` を編集します:

- `getProjectDir()` — プロジェクトの保存先を変更
- `buildRom()` — 独自のビルドコマンドを差し替え
- スキーマ: `title` / `serial` / `author` フィールドを追加・変更可能

### 3. 設定のカスタマイズ

`setup-manager.js` を編集します:

- `getDefaultTestPlaySettings()` — デフォルトのキーマップや設定値を変更
- `getToolsDir()` は `app.getPath('userData')` ベースで構築されているため、ポータブルモード対応も自動で有効になります

### 4. サンプル ROM の差し替え

`template/template_slideshow/src/main.c` を編集するか、`template/` 配下のテンプレートプロジェクトを差し替えます。  
ビルドコマンドは `build-system.js` の `buildRom()` が制御しています。

### 5. 画面レイアウトの変更

`renderer/` 以下の HTML / CSS を編集します:

- `index.html` + `renderer.js` — メイン設定画面
- `debug-wasm.html` — WASM デバッグビューア

Test Play 画面は `plugins/standard-emulator/` や `plugins/standard-api-emulator/` 側に内包されています。

---

## アンインストール

### Windows (インストーラー版)

**方法 A**: `コントロールパネル → プログラムと機能` から `MegaDriveEmulator` を選択してアンインストール。

**方法 B**: インストーラー (`MegaDriveEmulator Setup x.x.x.exe`) を再実行すると「アンインストール」オプションが表示されます。

アンインストール後もユーザーデータが残る場合は手動で削除します:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\MegaDriveEmulator"
```

### Windows (ポータブル ZIP 版)

アプリフォルダをそのまま削除するだけです。レジストリや OS への書き込みは一切ありません。

```powershell
Remove-Item -Recurse -Force "C:\path\to\MegaDriveEmulator"
```

### macOS

`/Applications/MegaDriveEmulator.app` をゴミ箱に捨てます。  
ユーザーデータを削除する場合:

```bash
rm -rf ~/Library/Application\ Support/MegaDriveEmulator
rm -rf ~/Library/Logs/MegaDriveEmulator
```

### macOS (ポータブルモード)

`.app` バンドルと同階層の `data/` フォルダごと削除します。

### データ保存場所まとめ

| 環境 | データ保存先 |
|---|---|
| Windows (通常) | `%APPDATA%\MegaDriveEmulator` |
| Windows (ポータブル) | `<アプリフォルダ>\data\` |
| macOS (通常) | `~/Library/Application Support/MegaDriveEmulator` |
| macOS (ポータブル) | `<.appバンドルの親フォルダ>\data\` |
| 開発モード (通常) | OS デフォルトの userData パス |
| 開発モード (ポータブル) | `data\` |

---

## テスト

Electron 配下の JavaScript テストは Node.js 標準の `node:test` で実行します。Electron 本体は起動せず、`electron` モジュールをテスト用モックに差し替えるため、main process 用モジュールや preload の IPC ブリッジを軽量に検証できます。

### コマンドラインで実行

リポジトリルートで実行します。

```powershell
npm test
```

### VSCode タスクで実行

VSCode の `Terminal: Run Task` から次のタスクを選択します。

- `Electron: Run Tests`

### テスト対象

- `tests/build-system.test.js`: プロジェクト作成、既存プロジェクトを開く処理、プラグイン選択保存、ツールチェーン未設定時の失敗経路
- `tests/setup-manager.test.js`: テストプレイ設定の正規化、SGDK / Marsdev パス検出
- `tests/preload.test.js`: renderer に公開する preload API と IPC チャンネル
- `tests/plugin-manager.test.js`: プラグイン manifest 正規化、有効化と依存関係処理
- `tests/rescomp-manager.test.js`: `.res` 解析、生成、更新、削除、パストラバーサル拒否

新しい Electron 側機能を追加した場合は、対象モジュールに近い `tests/*.test.js` にケースを追加してください。Electron の実ウィンドウを必要としないロジックは、既存の `tests/helpers/mock-electron.js` を使って `app` / `ipcRenderer` / `contextBridge` をモックします。
