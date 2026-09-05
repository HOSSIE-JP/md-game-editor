# AI による MD Game Editor 開発

AI の作業入口はルートの `AGENTS.md` です。Plugin Runtime の詳細仕様は
`.github/skills/md-game-editor-plugin/` と `docs/PLUGIN.md` を正とし、
分野固有の制約は `AGENTS.md` の参照表から確認します。

## GPT-6 Astra

プロジェクトの `.codex/config.toml` で `model = "gpt-6-astra"` を指定します。
推論強度は既存のユーザー/実行設定を引き継ぐため、このファイルでは上書きしません。
認証情報、provider、承認ポリシー、sandbox、MCP、グローバル設定は変更しません。

Codex は信頼済みプロジェクトでプロジェクト設定を読み込みます。CLI の明示指定など
上位の設定がある場合はそちらが優先されます。既に開いているタスクの実行モデルが
このファイル編集だけで切り替わったとは扱わず、アプリのモデル選択表示を確認してください。
モデル利用権限はアカウント側の条件に従い、設定ファイルでは付与されません。

この設定は開発エージェント用です。ゲーム ROM、エディターの AI Control API、
MCP のプロトコルを変更するものではありません。

公式資料（2026-09-05 確認）:

- [GPT-6 Astra のモデルガイド](https://developers.openai.com/api/docs/guides/latest-model)
- [Codex のプロジェクト設定と優先順位](https://learn.chatgpt.com/docs/config-file/config-basic)

## 実行と完了の確認

リポジトリルートで実行します。

```powershell
git status --short
node --check path/to/changed-file.js
npm test
```

アプリの起動は `npm start`。ゲームは対象 `project.json` の builder role と
ツールチェーンを使って Build し、生成した ROM を Test Play で検証します。
ツールチェーンの配置や対象ゲームのパスは現環境で確認し、別作業の絶対パスを固定しません。

バグ修正では再現条件を確認してから最小の修正と対応する回帰確認を行います。
ゲーム制作では最終アセットの保存・登録・生成・ROM ビルドまで行い、古い生成物での
テスト結果を流用しません。各分野の詳細な完了条件は対応する `docs/` を参照してください。
