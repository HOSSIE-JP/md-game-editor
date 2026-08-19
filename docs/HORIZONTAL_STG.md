# 横スクロールSTGプラグイン

MD Game Editor で横スクロールSTGを編集し、SGDK 2.11向けROMを生成する組み込みプラグインです。
`horizontal-stg-editor` がproject-local JSONの編集・検証・C/RES生成を担当し、
`horizontal-stg-builder` が共通ランタイムを同期してSGDKビルドへ必要なCソースを明示します。
Test Playは既存の `standard-emulator` roleを使用します。

## 新規プロジェクト

新規プロジェクト画面では次のテンプレートを選べます。

| テンプレート | 用途 |
|---|---|
| `template_horizontal_stg` | 1面・5イベントの汎用スターター。独自ゲームの土台 |
| `template_geroneko_abyss_strike` | 5面完成版 `GERONEKO: ABYSS STRIKE` |

両テンプレートの `project.json` は次のroleを選択済みです。

```json
{
  "pluginRoles": {
    "builder": "horizontal-stg-builder",
    "testplay": "standard-emulator"
  }
}
```

プロジェクト作成後はサイドバーの「横STG」で編集し、「検証」または「生成」を実行します。
Buildは生成を再実行してからSGDKを起動するため、保存済みJSONが常に正本です。

## データ構成

編集データは `data/horizontal-stg/` に保存します。

```text
data/horizontal-stg/
├── project.json
├── flow.json
├── id-registry.json
├── definitions/
│   ├── enemies.json
│   ├── bosses.json
│   ├── weapons.json
│   ├── items.json
│   ├── effects.json
│   └── audio.json
└── stages/
    └── <stage-id>.json
```

entity IDは英小文字、数字、`_`、`-`から成る安定IDです。生成時には
`id-registry.json` の1～255を保持し、0は `NONE` 用に予約します。表示名変更や並べ替えで
runtime IDを採番し直しません。保存はrevision照合とatomic replaceを使い、別の編集で更新済みの
文書を古い画面から上書きしようとすると競合として拒否します。削除データは `.deleted` へ退避します。

ステージイベントのtriggerは `frame`、`scroll`、`condition`、commandは次を扱います。

- `spawn_enemy`
- `spawn_item`
- `start_boss`
- `stage_clear`
- `set_flag`

存在しない敵・ボス・アイテム参照、未対応command、重複ID、範囲外のruntime IDは生成前にエラーになります。

## エディター

`horizontal-stg-editor` はPlugin Runtime v2.5のrenderer moduleとして実装し、本体HTMLや
`renderer/renderer.js` にゲーム固有分岐を持ちません。

- ステージ、システムスプライト、敵、ボス、武器、アイテム、エフェクト、BGM、画面フロー、設定を専用フォームでタブ編集
- project-localの実BG_A/Bと実スプライトを合成する320x224等倍プレビュー。parallax、敵移動、ボス出現、敵弾／ボス弾パターンを再生
- scroll timeline上で敵・アイテム・ボスのマーカーを選択／移動し、数値フォームでも位置・参照・commandを編集
- 背景PNGから抽出した8x8パターンをスタンプ／スポイト／64段undoで編集し、8bit indexed PNGへ保存
- システム／敵／ボス画像を共有画像pipelineで寸法調整・16色化して取り込み、Sprite Editor／TileMap Editorへ汎用ページAPIで移動
- VGM／XGM／WAVの取り込み、共有VGM playerによる再生、MD BGM Composerへの移動
- ステージ順の変更、読取専用の安定IDを保った追加・削除。collection保存は選択entityだけをupsertして未選択定義を保持
- JSON構文、参照、pool、ROM予算、画像形式、背景密度の一括診断
- 未保存状態でタブ・entity・並び順・削除を切り替える際の「保存／破棄／キャンセル」
- optimistic revisionによる同時更新の拒否

入力画像のraw pathはプロジェクト相対に限定します。絶対パスと `..` traversalは拒否します。

## 画像と音声の制約

背景は8bit indexed、非interlace、使用palette index 16色以下、224px高です。

- BG_A幅: `length_px`
- BG_B幅: `320 + (length_px >> parallax_shift_b)`
- BG_A/Bの各ファイルは `res/` 配下のproject-relative path

GERONEKO完成版v1.3.0のステージ背景は、`scripts/generate-horizontal-stg-visuals.py` が最終出力寸法へ8x8パターンを直接配置します。縮小画像をnearestで拡大する工程はなく、出力PNGの1pxがそのまま実機の1pxです。単純な数種類の反復から、雲層／島影／海面、沈没都市の塔／橋／配管、洞窟層／結晶、工廠のリベット／炉／歯車、生体膜／血管／眼球を組み合わせるMD世代相当の語彙へ更新しました。反転重複除去後はBG_B 364～602 pattern、透明BG_A 73～342 pattern、固定HUD 18枚を含む面別合計455～958 patternです。

タイトルは `gfx/title_background.png`（320x224、一枚絵、PAL0）と `gfx/title_logo.png`（256x64、透明、PAL1）を別々の`IMAGE`として持ちます。GERONEKO完成版の一枚絵は左のGERONEKOと右奥の巨大クジラ型航空母艦が夕暮れの海で対峙する構図です。ImageGen原画を320x224の実出力解像度で直接16色化し、3x3中央値処理だけで一時的な色ノイズを整理するため、nearest拡大はありません。背景804 patternとロゴ120 patternの合計924枚を`NONE ALL`で直接ロードし、64x32 planeで使える1005 user tile以内に収めます。ロゴはBG_Aへ重ね、ロゴがある64走査線だけを`HSCROLL_LINE`で半振幅変位させます。ロゴ外の走査線とBG_Bは0 scrollに固定し、別画面へ移ると`HSCROLL_PLANE`へ戻します。

PNG検査はraw tile数、ResComp `ALL` と同じ左右／上下反転を含む実効pattern数、3色以上を使うdetail tile比率に加え、4x4ブロックが単色になる割合を返します。一般projectでは実効背景patternが160未満なら`STG_ASSET_BACKGROUND_LOW_VARIETY`、detail tile比率18%未満なら`STG_ASSET_BACKGROUND_LOW_DETAIL` warningです。同梱v1.3背景の回帰テストはBG_B 320 pattern以上、BG_A 64 pattern以上、detail tile比率25%以上、単色4x4比率45%未満を固定し、粗い反復と4倍nearest化の再発を検出します。タイトルはdetail tile比率30%超と背景＋ロゴ1005 pattern以下も固定します。一般projectでは既定Sprite Engineの420 tile予約を考慮し、HUD 18枚を含むBG_A/Bの実効tile合計が1 stageあたり1500枚を超える場合は`STG_ASSET_BACKGROUND_VRAM` errorです。

敵は16x16、プレイヤーは24x16、ボスは32x32単位のSpriteDefinitionを基本にします。
ResComp symbolは生成前に重複検査します。音楽は `XGM2` 用VGM sourceを登録し、
ランタイムはtitle、各面、midboss、boss、final boss、result、continue/game over、ending、
name entry、staff rollのcueを切り替えます。

## 生成物とビルド

「生成」またはBuild開始時に、主に次を更新します。

```text
inc/generated/generated_ids.h
inc/generated/game_config.h
inc/generated/game_data.h
inc/generated/audio_data.h
inc/generated/render_data.h
src/generated/game_data.c
src/generated/audio_data.c
src/generated/render_data.c
src/generated/enemy_defs.c
src/generated/boss_defs.c
src/generated/weapon_defs.c
src/generated/stage_defs.c
src/generated/<stage-id>_events.c
res/common.res
out/reports/horizontal-stg-report.json
```

builderは `src/boot/rom_head.c` を同期対象にせず、MD Game Editorがproject設定から生成した
ROM headerを尊重します。`src/boot/sega.s` も通常の `SRC_C` には含めずSGDK専用ruleへ任せます。
複数Cファイルは `onBuildStart().makeVariables.SRC_C` で明示し、重複objectを排除します。

ROM予算はproject JSONで設定します。GERONEKO完成版はtarget 3.5 MiB、hard limit 4 MiBで、
2026-08-19のSGDK 2.11 release buildは初版v1.0.0が655,360 bytes、グラフィック改善版v1.1.0と等倍タイル／対峙タイトル版v1.2.0が各524,288 bytes、背景パターンと統合エディターを増強したv1.3.0が655,360 bytesでした。v1.3.0のSHA-256は`f64c1fb4ba0d0747df95e16b0b52f716f22c75c624ad2d5869146b672f884268`です。128 KiBの増加後も3.5 MiB targetと4 MiB hard limitを十分に下回ります。hard limit超過はBuild失敗、target超過はwarningです。

## ランタイム機能

共通SGDKランタイムには次を含みます。

- boot、title、main menu、options、high scores、sound test、how-to
- 320x224 title一枚絵、透明ロゴ、64走査線のline-scrollによるロゴのラスター変形
- opening、stage intro/load/play/pause/clear、continue、game over、name entry、ending、staff roll
- 3属性・3段階の通常ショット、36/84 frame charge、bomb、speed/power/recovery item
- 数値charge表示に代わる12 segment gauge（LOW／READY／MAX）と、機体残数、武器色／3段階power、speed、bomb、ABYSS COREを示す18 tile icon HUD
- ABYSS COREの前後装着、射出、追従、帰還、shield、接触damage、被弾時喪失
- 20種の敵behavior/fire patternと、部位HPを持つ中ボス／ボス
- Easy/Normal/Hardの敵弾数・速度補正
- 3 lives、2 bombs、3 continues、20万／70万点extend
- A/B/Cのshot/core/bomb割当変更
- optionsと難易度別high score/name entryのSRAM保存

ABYSS COREの所有状態は `GameSession.abyssValue` とcontroller stateを同期し、ステージ遷移で
復元します。被弾喪失時は両方をクリアします。

## GERONEKO: ABYSS STRIKE

| Stage | length | events | enemy spawns | midboss | boss |
|---|---:|---:|---:|---|---|
| BLUE HORIZON | 6144 | 47 | 41 | SWORD FISH | LEVIATHAN |
| DROWNED METRO | 6656 | 49 | 44 | OCTO CONSTRUCTOR | CRAB FORTRESS |
| BLACK LANTERN | 7168 | 53 | 48 | ANGLER HUNTER | NAUTILUS FORTRESS |
| IRON NEST | 7680 | 57 | 52 | MANTIS STRIKER | SPIDER CRAB FACTORY |
| LIVING ARK | 8192 | 62 | 57 | COELACANTH GUARD | ABYSSAL CORE |

合計は5面、20敵定義、10ボス定義、242敵出現、268イベント、14曲です。
全ステージのscroll speedは80/256 px/frameで、各最終ボストリガまでの無停止scroll基準は
合計29.12分です。ボス戦、opening、result、endingを含む想定プレイ時間は30～35分です。
最終ボス `ABYSSAL CORE` は2形態、orbit movement、core fire patternを使用します。

完成版テンプレートには各面の等倍タイル背景、プレイヤー、20敵、10ボス、弾、item、effect、
ボス対峙タイトル一枚絵と独立ロゴの変換済みproduction asset、および相互に異なる14本のVGM sourceを同梱します。汎用スターターの
fallback assetは差し替え前提で、完成版のproduction assetとは区別します。

## SRAMと標準WASM Test Play

MD Game Editorが生成するROM headerは、SGDKのodd-byte SRAM規約に合わせます。

| field | value |
|---|---|
| marker | `RA` |
| type | `0xF8` |
| flags | `0x20` (odd byte) |
| start | `0x00200001` |
| end | `0x0020FFFF` |

`standard-emulator` は同じ範囲を32 KiBとして公開します。WASMを更新する場合は
[emulator-bundle.md](emulator-bundle.md) の手順に従い、`emulator-build.json` のcommit、
dirty state、build meta、SHA-256を更新してください。

## 検証

変更時の基本確認は次です。

```powershell
node --check plugins\horizontal-stg-editor\renderer.js
node --check plugins\horizontal-stg-editor\renderer-app.mjs
node --check plugins\horizontal-stg-editor\editor-ui.mjs
node --check plugins\horizontal-stg-editor\preview-core.mjs
node --check plugins\horizontal-stg-editor\index.js
node --check plugins\horizontal-stg-builder\index.js
node --test tests\horizontal-stg-plugins.test.js
node --test tests\build-system.test.js tests\testplay-plugins.test.js
npm run copy-pkg
npm run prepare:dist
npm test
```

実ROM確認では汎用スターターとGERONEKO完成版を同梱SGDK 2.11でrelease buildします。
GERONEKOはさらに標準WASMでtitleを2つのwarp位相で撮影し、titleからStage 1まで入力を進め、full charge HUDと等倍タイル背景を撮影します。framebufferの変化、audio sample、
SRAM初期化、save stateの保存／復元を確認します。ユニット／WASM確認は実機確認の代替ではないため、
release前にはMega Drive実機または対象flash cartでも入力、音、SRAM電源断保持を確認してください。
