# Codex 向け指示

このリポジトリは **MD Game Editor** 用です。Mega Drive エミュレーター本体の
Rust/WASM 実装は別リポジトリ (`md_emulator`) で管理します。

## 作業の進め方

- 対象は Mega Drive ゲームエディターと、このエディターで制作する SGDK ゲームです。
  Saturn/Yaul や別アプリの PC Engine 固有手順を持ち込まないでください。
- 最初に `git status --short`、対象の `project.json`、関連する実装とテストを確認し、
  既存の未コミット変更を保持してください。生成物だけでなく生成元を修正してください。
- 重要な判断では目的・前提・変更範囲・互換性・長期的影響を見直し、確認済みの事実と
  推測を区別してください。完了前には境界値、失敗経路、反例、隠れたコストを確認してください。
- 通常の実装判断は既存パターンに沿って進め、依頼の完了まで実装・検証を行ってください。
  無関係なリファクタリングや環境の恒久変更は避けてください。
- 過去の作業メモは調査の入口です。現行のソース・仕様・テストで再確認し、計画や
  過去のビルド成功を現在の実装完了の証拠として扱わないでください。
- Codex のモデル設定と適用条件は `docs/AI_DEVELOPMENT.md` を参照してください。

## 最初に必ず読むもの

- プラグイン、renderer module、Plugin Runtime、Test Play、AI Control API、
  パッケージングを変更する前に、次を読んでください。
  - `.github/skills/md-game-editor-plugin/SKILL.md`
  - `.github/skills/md-game-editor-plugin/instructions.md`
  - `docs/PLUGIN.md`
- 同梱 WASM エミュレーターや `copy-pkg` / `prepare-dist` を変更する前に、
  `docs/emulator-bundle.md` を読んでください。
- 公開 API や外部 AI 操作用 API を変更する場合は、同じ作業内で
  `docs/AI_CONTROL.md` または関連する `docs/` を更新してください。
- 外部リポジトリからコードをコピーしてはいけません。外部情報は挙動を
  理解するためだけに使い、実装は独自に行ってください。

## 現在のプロジェクト運用

- 新しい抽象化より既存のプロジェクトパターンを優先してください。
- Electron の renderer、preload、main process の責務は分離してください。
- ファイルシステム IPC は現在のプロジェクト内に限定し、プロジェクトルート
  外へのパストラバーサルを拒否してください。
- `renderer/renderer.js` は単一スクリプトとして読み込まれるため、既存の
  グローバル関数名を再定義しないでください。
- Plugin Runtime v2.5 では、新しい UI、converter、modal、preview は
  plugin 側 renderer module に置き、本体 HTML / renderer / main へ個別 plugin
  分岐を追加しないでください。
- Build / Test Play など単一選択 plugin は manifest の `roles` で宣言し、
  project 側は `project.json.pluginRoles` に保存してください。

## ゲーム制作・生成ランタイムの変更

- 対象ゲームの保存先を確認し、`project.json` の core、plugin、builder/Test Play role、
  toolchain 設定を読んでください。SGDK の API は対象環境のヘッダーと既存使用例で確認します。
- 編集データ → 検証 → C/RES 生成 → SGDK ROM → Test Play の流れを追ってください。
  `out/` の手修正だけで修正を終えず、再生成後も変更が残ることを確認します。
- JavaScript プレビューと生成 C ランタイムの移動・衝突・乱数・フレーム進行・描画を
  同じ入力で比較してください。状態の所有者と描画処理の責務を保持します。
- stable ID、revision、atomic write、未保存ガードを保持してください。Build/切替前の
  保存は `beforeBuild` / `beforeProjectSwitch` を使用し、保存失敗時は処理を中止します。
- 画像は共有 import/converter capability を使用し、最終変換後の寸法、indexed palette、
  透明 index、SPRITE の行/フレーム、ResComp symbol と参照整合を検証してください。
  別エディターで変更されたアセットは再アクティブ時に再読込します。
- VRAM/RAM/ROM、palette、sprite の総数と走査線負荷、DMA/VBlank の予算は、対象モードと
  実際の生成結果から確認してください。素材差し替え後は再生成・再ビルドが必要です。
- 音声変更は変換ファイルの生成だけでなく、登録・参照・再生切替を確認してください。
  聴取していない音質や実機で確認していない動作を検証済みと報告しないでください。
- `src/boot/rom_head.c` は本体による生成を尊重し、builder のテンプレート同期で上書き
  しないでください。追加した C ソースがビルド入力へ含まれることを確認します。

### 分野別の入口

| 変更対象 | 読む資料・確認する実装 | 主な回帰テスト |
|---|---|---|
| Plugin / IPC / lifecycle | `docs/PLUGIN.md`、`plugin-manager.js` | `tests/plugin-manager.test.js`、`tests/plugin-runtime-lifecycle.test.js` |
| ダンジョン | `docs/DUNGEON_MAINTENANCE.md`、`docs/PLUGIN.md`、`plugins/dungeon-game-editor/render-core.js` | `tests/dungeon-plugins.test.js` |
| MD ノベル / 共有 VN | `docs/NOVEL.md`、`plugins/shared/md-vn/` | `tests/novel-plugins.test.js`、`tests/novel-editor-ui.test.js` |
| BulletML STG | `docs/BULLETML_STG.md`、editor/builder と共有 runtime | `tests/bulletml-stg-plugins.test.js`、`tests/bulletml-stg-v2.test.js` |
| BGM | 対象 composer の service / renderer と `docs/PLUGIN.md` | `tests/md-bgm-composer.test.js`、`tests/easy-bgm-composer.test.js` |
| Build / Test Play | `build-system.js`、`docs/emulator-bundle.md` | `tests/build-system.test.js`、`tests/testplay-plugins.test.js` |

- ダンジョンは player の `canTraverse()` と敵の `enemyCanTraverse()` を混同しないでください。
  扉の両側、宝箱・階段・他エネミーの占有、フロア遷移時の素材/palette を確認します。
  共通ビルボードの現行保存形式は保守ガイドと service を参照し、古い移行案で上書きしません。
- `horizontal-stg-*` は既存互換を維持する対象です。新しい STG 機能は現行の
  BulletML STG に実装し、schema/ABI の非対応状態を黙って近似変換しないでください。

## ゲーム制作・生成ランタイムの変更

- 対象ゲームの保存先を確認し、`project.json` の core、plugin、builder/Test Play role、
  toolchain 設定を読んでください。SGDK の API は対象環境のヘッダーと既存使用例で確認します。
- 編集データ → 検証 → C/RES 生成 → SGDK ROM → Test Play の流れを追ってください。
  `out/` の手修正だけで修正を終えず、再生成後も変更が残ることを確認します。
- JavaScript プレビューと生成 C ランタイムの移動・衝突・乱数・フレーム進行・描画を
  同じ入力で比較してください。状態の所有者と描画処理の責務を保持します。
- stable ID、revision、atomic write、未保存ガードを保持してください。Build/切替前の
  保存は `beforeBuild` / `beforeProjectSwitch` を使用し、保存失敗時は処理を中止します。
- 画像は共有 import/converter capability を使用し、最終変換後の寸法、indexed palette、
  透明 index、SPRITE の行/フレーム、ResComp symbol と参照整合を検証してください。
  別エディターで変更されたアセットは再アクティブ時に再読込します。
- VRAM/RAM/ROM、palette、sprite の総数と走査線負荷、DMA/VBlank の予算は、対象モードと
  実際の生成結果から確認してください。素材差し替え後は再生成・再ビルドが必要です。
- 音声変更は変換ファイルの生成だけでなく、登録・参照・再生切替を確認してください。
  聴取していない音質や実機で確認していない動作を検証済みと報告しないでください。
- `src/boot/rom_head.c` は本体による生成を尊重し、builder のテンプレート同期で上書き
  しないでください。追加した C ソースがビルド入力へ含まれることを確認します。

### 分野別の入口

| 変更対象 | 読む資料・確認する実装 | 主な回帰テスト |
|---|---|---|
| Plugin / IPC / lifecycle | `docs/PLUGIN.md`、`plugin-manager.js` | `tests/plugin-manager.test.js`、`tests/plugin-runtime-lifecycle.test.js` |
| ダンジョン | `docs/DUNGEON_MAINTENANCE.md`、`docs/PLUGIN.md`、`plugins/dungeon-game-editor/render-core.js` | `tests/dungeon-plugins.test.js` |
| MD ノベル / 共有 VN | `docs/NOVEL.md`、`plugins/shared/md-vn/` | `tests/novel-plugins.test.js`、`tests/novel-editor-ui.test.js` |
| BulletML STG | `docs/BULLETML_STG.md`、editor/builder と共有 runtime | `tests/bulletml-stg-plugins.test.js`、`tests/bulletml-stg-v2.test.js` |
| BGM | 対象 composer の service / renderer と `docs/PLUGIN.md` | `tests/md-bgm-composer.test.js`、`tests/easy-bgm-composer.test.js` |
| Build / Test Play | `build-system.js`、`docs/emulator-bundle.md` | `tests/build-system.test.js`、`tests/testplay-plugins.test.js` |

- ダンジョンは player の `canTraverse()` と敵の `enemyCanTraverse()` を混同しないでください。
  扉の両側、宝箱・階段・他エネミーの占有、フロア遷移時の素材/palette を確認します。
  共通ビルボードの現行保存形式は保守ガイドと service を参照し、古い移行案で上書きしません。
- `horizontal-stg-*` は既存互換を維持する対象です。新しい STG 機能は現行の
  BulletML STG に実装し、schema/ABI の非対応状態を黙って近似変換しないでください。

## 同梱 WASM エミュレーター

- `standard-emulator` plugin は現在採用している Mega Drive WASM emulator を
  `plugins/standard-emulator/` に同梱します。
- `plugins/standard-emulator/emulator-build.json` で、元 `md_emulator`
  commit、dirty state、build meta、同梱ファイルの SHA-256 を追跡します。
- 同梱 WASM を更新する場合は、先に `md_emulator` 側で WASM をビルドし、
  このリポジトリで次を実行してください。

```bash
MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg
```

- `MD_EMULATOR_REPO` を指定しない `npm run copy-pkg` は、同梱済み WASM の
  検証だけを行います。親リポジトリが存在することを前提にしないでください。
- このリポジトリでは `md-api` をビルドしません。`standard-api-emulator` を
  使う場合は、platform 別の `md-api` binary を
  `plugins/standard-api-emulator/bin/` に配置してください。

## 回帰テスト

- コードを変更した後は、編集範囲に近いテストを実行してください。
- JavaScript の構文確認は `node --check <file>` を優先してください。
- 最終確認の基本コマンドは `npm test` です。
- `tests/run-tests.js` はアプリ設定を読み込む標準ハーネスです。単独テストの実行方法は
  対象ファイルを確認し、別の runner で標準ハーネスを置き換えないでください。
- ゲームの生成/ランタイム変更は関連テストに加えて対象プロジェクトの実 ROM をビルドし、
  可能な範囲で Test Play の入力・画面・音声を確認してください。GUI 起動だけで描画確認済み
  とせず、Node テスト、ROM ビルド、エミュレーター、実機の結果を区別します。
- 文書・設定だけの変更では参照先と構文・差分を検証し、不要なゲーム再生成は行いません。
- 最終報告には変更内容、実行した検証と結果、成果物のパス、未確認の項目を記載してください。
- `tests/run-tests.js` はアプリ設定を読み込む標準ハーネスです。単独テストの実行方法は
  対象ファイルを確認し、別の runner で標準ハーネスを置き換えないでください。
- ゲームの生成/ランタイム変更は関連テストに加えて対象プロジェクトの実 ROM をビルドし、
  可能な範囲で Test Play の入力・画面・音声を確認してください。GUI 起動だけで描画確認済み
  とせず、Node テスト、ROM ビルド、エミュレーター、実機の結果を区別します。
- 文書・設定だけの変更では参照先と構文・差分を検証し、不要なゲーム再生成は行いません。
- 最終報告には変更内容、実行した検証と結果、成果物のパス、未確認の項目を記載してください。
- テストを実行できない場合は、最終回答で理由と残るリスクを説明してください。

## コミットメッセージ方針

- Codex がこのリポジトリでコミットを作成する場合、コミットメッセージは
  日本語で書いてください。
- 件名は、実際の変更内容を表す簡潔な日本語にしてください。
