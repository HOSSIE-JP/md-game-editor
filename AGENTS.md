# Codex 向け指示

このリポジトリは **MD Game Editor** 用です。Mega Drive エミュレーター本体の
Rust/WASM 実装は別リポジトリ (`md_emulator`) で管理します。

## 最初に必ず読むもの

- プラグイン、renderer module、Plugin Runtime、Test Play、AI Control API、
  パッケージングを変更する前に、次を読んでください。
  - `.github/skills/md-game-editor-plugin/SKILL.md`
  - `.github/skills/md-game-editor-plugin/instructions.md`
  - `PLUGIN.md`
- 同梱 WASM エミュレーターや `copy-pkg` / `prepare-dist` を変更する前に、
  `docs/emulator-bundle.md` を読んでください。
- 公開 API や外部 AI 操作用 API を変更する場合は、同じ作業内で
  `AI_CONTROL.md` または関連する `docs/` を更新してください。
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
- テストを実行できない場合は、最終回答で理由と残るリスクを説明してください。

## コミットメッセージ方針

- Codex がこのリポジトリでコミットを作成する場合、コミットメッセージは
  日本語で書いてください。
- 件名は、実際の変更内容を表す簡潔な日本語にしてください。
