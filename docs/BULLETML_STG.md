# BulletML STG Studio v2

`bulletml-stg-editor`と`bulletml-stg-builder` 2.0は、SGDK 2.11向けの汎用1P STGを編集・検証・生成する組み込みpluginです。BulletMLの敵弾VMだけでなく、Player、Weapon、Item、Enemy、Boss、背景、collision、複数Stage、Campaign／Caravan、VN Demo、SRAMまでを1つのproject契約として扱います。

両pluginのIDはv1と同じですが、`data/bulletml/`はschema v2へ破壊的更新されています。schema v1は自動移行せず、読込・保存・Build時に「schema v1は2.0で非対応」と明示して停止します。新しいv2 Showcaseから作り直してください。

旧`horizontal-stg-editor`／`horizontal-stg-builder`は開発終了です。`templateDeprecated: true`のテンプレートは新規作成一覧から除外されますが、既存projectの編集・Buildコードと回帰テストは維持します。

## 固定ターゲット

| 項目 | 契約 |
|---|---|
| platform | Mega Drive / SGDK 2.11 |
| video | NTSC、H40、320×224 |
| player | 1P、1作品1Player |
| stage方向 | Stage単位で縦／横を混在可能 |
| mode | 同一ROMにCampaignとCaravanを収録可能 |
| difficulty | 選択なし。`$rank`はProject固定値、Boss phaseだけ上書き可能 |
| BulletML | BulletML v0.21 subset、big-endian `BMLB ABI v1` |
| ROM | 4 MiB以下 |

## Plugin構成

| component | version / 役割 |
|---|---|
| `bulletml-stg-editor` | 2.0.0。13 tab、schema/CRUD、Pattern editor、Stage Preview、Demo editor |
| `bulletml-stg-builder` | 2.0.0。hook-only builder、BMLB/C/RES/VN/font/collision/proof生成 |
| `asset-manager` | 1.1.0。共通`rescomp-asset-picker` capability |
| `sprite-editor` | 0.2.0。`openSprite({ symbol })`で登録済みSPRITEを直接編集 |
| `tilemap-editor` | 0.2.0。`openMap({ symbol, collisionLayer })`でMAP/TILEMAPとcollision layerを直接編集 |
| `plugins/shared/md-vn/` | MD NovelとBulletML Demoが共有するschema、editor component、preview、font、image、compiler |
| `plugins/shared/tilemap/tmx-parser-core.js` | TileMap EditorとBuilderが共有するTMX/TSX parserとcollision RLE |

Editorは`asset-manager`、`sprite-editor`、`tilemap-editor`へ依存し、BuilderはEditorへ一方向依存します。新しいUI、picker、modal、previewはplugin renderer moduleへ置き、本体rendererにBulletML固有分岐を追加しません。

## ResComp Asset Picker

`asset-manager`はrenderer capability `rescomp-asset-picker`として次を公開します。

```js
picker.list({ types })
picker.resolve({ symbol, type })
picker.openPicker({ types, selectedSymbol, allowNone, title })
picker.mountPreview(container, assetOrReference, options)
```

Pickerは開くたびにResComp定義を再読込し、`SPRITE`、`XGM2`／`XGM`／`VGM`、`WAV`、`IMAGE`、`MAP`／`TILEMAP`をプレビューします。候補を選んだ時点で右側のプレビューが自動更新されるため、別の「Preview」ボタンはありません。SPRITEプレビューはResCompのコマ寸法と`time`行列を読み、アニメーション行の選択、再生、`time=0`停止を再現します。

保存する参照は物理pathや行番号ではなく次の形式です。

```json
{ "symbol": "player_ship", "type": "SPRITE", "animationRow": 1 }
{ "symbol": "stage1_map", "type": "MAP", "collisionLayer": "Collision:near" }
{ "symbol": "stage1_bgm", "type": "XGM2" }
```

missing symbol、型違い、symbol重複、`path`／`sourcePath`／`lineNumber`などの物理参照は保存とBuildのhard errorです。

## schema v2 project data

```text
data/bulletml/
  project.json                 target、rank、mode、Bomb、被弾reset
  pools.json                   enemy/player-shot/item/effect/part/PCM pool
  game-flow.json               Campaign DAGとCaravan設定
  input.json                   A/B/Cのshot/bomb/speed割当
  save.json                    SRAM magic/version/Top10/checkpoint
  player.json                  単一Player、速度、方向別animation ROW
  weapons.json                 Player shot catalog
  items.json                   Weapon/Bomb/Score item catalog
  effects.json                 共通Sprite animationとSE
  explosions.json              frame/相対位置付きEffect配置
  movements.json               waypoint library
  enemies.json                 Enemy、破壊可能背景entity
  bosses.json                  phase、parts、巨大Boss設定
  backgrounds.json             BG_A/B、band、wave、BGM
  collision-materials.json     solid/damage/mask
  patterns/<stable-id>.json    BulletML IR
  stages/<stable-id>.json      typed event stream
  demo-bindings.json           canonical VN sceneとのbinding
  runtime-ids.json             catalog別stable runtime ID registry
  editor-state.json            UI状態
  .deleted/**                  削除済みentry/pattern/stageの復元データ
assets/pce-vn-scenes.json       MD Novelと共有するcanonical scene document
```

PatternとStageはstable IDごとのfile、その他は型別collectionです。runtime IDはcatalogごとに1～255を割り当て、0をNONEに予約します。削除したIDは`retired`へ移し、復元時は同じruntime IDを戻します。

全document保存はrevision照合、project root境界、atomic replace、`.deleted`退避を使います。未保存内容を持つactivationは`beforeBuild`／`beforeProjectSwitch`で保存完了までawaitし、競合・検証・書込失敗時は操作をvetoします。不完全draftやschema v1を古いdisk状態のままBuildしません。

## Studio UI

Studioは次の13タブをプラグイン内に表示します。

1. 作品設定
2. プレイヤー
3. 武器
4. アイテム
5. 演出
6. 移動
7. 敵
8. ボス
9. 背景・衝突
10. ステージ
11. デモ
12. 弾幕
13. 診断

作品設定から背景・衝突までの全データ、ステージ基本設定とイベント、弾幕の弾画像・当たり判定・命令、デモ命令と割当は、日本語ラベル付きの入れ子GUIフォームで編集します。配列もGUIから追加・削除・上下移動でき、未設定のdropや個別弾設定は「設定する」／「設定を外す」で切り替えられます。ラベル横の「？」へマウスを置くと用途、単位、ゲームへの影響を表示します。JSONは通常操作には不要で、「上級者向け」折りたたみ内に外部生成データの確認・一括修正用としてだけ残します。自動生成する実行profileとruntime ID registryは通常フォームに表示しません。

弾幕は構造化フローとDOM＋SVG接続図が同じ編集履歴を使い、100段の元に戻す／やり直すを共有します。表示の絞り込みと編集対象の選択は分離されています。弾スプライト、animation ROW、パレット、コマ寸法、当たり判定、寿命、画面外余白、動作（Action）、発射（Fire）、弾（Bullet）、参照（Ref）はGUIで編集します。スプライトを選択した時点で自動プレビューし、選択済みassetはSprite Editorへ直接開けます。実行プレビューは中間データを近似実行せず、MD実機と同じコンパイル済みBMLBを実行します。繰り返し再生は既定で有効です。

ステージタブではステージ自体を追加でき、名前、縦／横、長さ、背景、スクロール、衝突MAP/layer、次ステージ分岐をGUI編集します。削除はdata/bulletml/stages/.deleted/へ退避し、同じタブから復元できます。衝突MAPも選択時に自動プレビューし、TileMap Editorへ直接開けます。

canonical BulletML XML import/exportはMD情報をhash付き`.md-bullet.json` sidecarへ分離します。外部DTD／Entity、内部subset、未知要素、未解決・循環Ref、非対応式、`accel`は行・列付きerrorとして拒否します。

Stages Previewはproject境界付きmain sessionで全event／phaseのBMLB、自機弾、Player入力、HP、Boss parts、Bomb、drop、collision、score、lives、sprite/scanline予算を同じtickで実行します。start／step／seek／stop hookを使い、seekは同じrank/seedから決定的に再実行します。

## Player、Weapon、Item、Effect

- PlayerはStage方向ごとにaxisとnegative／neutral／positiveのanimation ROWを持ちます。既定は縦面が左／中／右、横面が上／中／下です。
- Slow→Normal→Fastをspeed button押下ごとに循環し、Stage間で保持します。
- A/B/Cはshot／bomb／speed shiftへ重複なしで割り当て、OptionsとSRAMへ保存します。
- Player shotは敵BulletMLから独立したpoolです。発射間隔、damage、速度、角度、発射位置、同時数、SPRITEを構造化編集します。
- Weapon itemは指定Weaponへ直接切替し、同種再取得時はWeaponの`duplicateScore`へ変換します。
- Bombはstock、全敵damage、敵弾消去、無敵時間、Effect、SEをProjectで共有します。
- Itemはstable ID付きWeapon／Bomb／Score catalogです。Enemy/Boss dropは固定1件またはNONEです。
- Effectは共通SPRITE animationと任意WAVを持ち、Explosion Patternが複数Effectをframe/相対位置付きで配置します。
- Enemy/Bossの個別WAVは撃破SEとして最初のExplosion Effect SEを上書きし、同一frameの二重再生を避けます。自然退場はscore、drop、explosion、撃破SEを発生させません。
- 被弾時のWeapon維持/初期化、Normal速度化、Bomb初期数補充はProject設定です。

## Enemy、Boss、Movement

Movementはwaypoint、所要frame、step／linear／smoothstep、loopを持つ再利用libraryです。Enemy、Boss、巨大BossのBG移動からstable IDで参照します。

EnemyはHP、score、hitbox、Movement、BulletML Pattern、drop、Explosion、撃破SEを持ちます。`destructibleBackground: true`はtileではなくworld固定STG Entityとして扱い、自然退場せずSprite/HP/hitbox/drop/Explosionを持ちます。

BossはHP閾値の降順で1～8 phaseを持ちます。各phaseはPattern、Movement、active Parts、背景、wave、敵弾消去、任意rank上書きを設定できます。Partsは個別HP、global HP転送率、hitbox、破壊Explosion、無効化flag、BG追従を持ちます。

巨大Boss encounterではBG_Bをarena、BG_AをBoss tilemapへ専有します。BG scrollに追従するBoss Partsだけが当たり判定を担当し、BG pixel/tile自体をdamage判定へ使いません。

## Stage、背景、collision

Stage graphはDAG限定です。eventはstableな`order`で処理され、Frame、主camera scroll、flag、Boss撃破のtyped triggerと、spawn、背景、scroll、wave、flag、明示`stage_clear`のtyped actionを持ちます。各Stageには到達可能な`stage_clear`が必須です。

背景はBG_A/Bの2 planeです。各plane最大8個の非重複bandへ主scroll倍率を設定します。横面はscanline band、縦面はcolumn bandとして実機と同じ方向にpreview/runtime適用します。

- scroll変更: step／linear／smoothstepとduration
- wave: planeごとに1つ。sine、dual-sine、ripple、shear、jitter、範囲、振幅、波長、速度、fade
- 背景切替: CutまたはFade out→分割転送→Fade in
- 完全seamless背景切替: 非対応

collisionは1:1 near mapと主cameraへ固定し、parallax/waveは見た目だけを変形します。Materialはsolid/damageとPlayer、Enemy、Player Shot、Enemy Shotのmaskを持ちます。Builderは選択した`collisionLayer`を共有TMX parserで再読込し、RLE catalogを生成します。TileMap Editorが以前生成したC fileには依存しません。

## Campaign、Caravan、SRAM

ROM起動後のMode SelectからCampaignまたはCaravanを選びます。

Campaignはscore、lives、bombs、weapon、speedをStage間で持ち越します。Continueは現在Stageを再開してscoreを0へ戻し、その後もranking対象です。Auto Saveはpost-stage Demo終了後、次Stage直前に1件保存します。checkpointには次Stage、全持越し状態、campaign flags、clear数が入り、繰り返しResumeしてもTop10対象です。

CaravanはProject指定の専用1面と制限frameを使います。時間切れ時に入力、敵、弾を即停止してResultへ移ります。

SRAMはmagic/version/checksumを持ち、Options、Mode別Top10、3文字name、Campaign checkpointを保存します。Campaign rankingはscore、到達Stage数、play time、Caravan rankingはscoreと残りframeを保持します。

## VN Demo

デモタブはMD Novelと同じ共有エディター部品を表示します。シーン命令は種類別GUIから追加・編集・削除・並べ替えでき、命令JSONの直接編集は不要です。正本は`assets/pce-vn-scenes.json`で、BulletML側はオープニング、ステージ前後、救済／破壊エンディングと`endingSelector`だけを`demo-bindings.json`へ保存します。

DemoはStage資産を解放してから専用Modeへ入り、終了時にVN資産を解放してgameplay runtimeを再初期化します。BG、actor、typewriter、Move、SpriteText、BGM/SE、WAIT/INPUT、choice、flagを使用でき、gameplay overlayは行いません。VN flagは次Stage選択とStage event conditionへ渡されます。日本語＋ASCIIの使用glyphだけをproject-localまたは同梱fontから16×16 atlasへ生成します。

共有実装は`plugins/shared/md-vn/scene-schema.js`、`font.js`、`image.js`、`preview.mjs`、`compiler.js`、`editor-component.mjs`です。旧MD Novel pathは互換wrapperとして同じ実装を参照します。

## Build、予算、proof

Builderは`generator: false`のhook-only pluginです。`onBuildStart`で全参照・schema・graph・asset・palette・collision・VN・budgetを検証し、全C sourceを`makeVariables.SRC_C`へ一意に列挙します。`src/boot/rom_head.c`は上書きしません。

主な生成物:

```text
res/bulletml/generated/*.bmlb
res/bulletml/internal/*.bmlb
res/bulletml.res
res/bulletml_game.res
res/novel.res
src/generated/bulletml_catalog.c
inc/generated/bulletml_catalog.h
src/generated/novel_data.c
inc/generated/novel_data.h
src/bulletml/*.c
src/novel_runtime/novel_runtime.c
data/bulletml/proof.json
wasm-proof/bulletml-stg-wasm-proof.json
out/rom.bin
```

Build前にPattern/Stageをrank 0／0.5／1、seed 3種、自機経路3種の27ケースでstressします。runtimeで実際に使うrankはProject固定値です。fire/pool/context/opcode drop、sprite 80、1走査線20 piece／320 dot、VRAM、RAM、DMA、PCM 4 channel、4 MiB ROM上限はhard errorです。Movement、shot、drop、Bomb、Boss phase、scroll、wave、collision mask、event順、score/saveはJS/C共有fixtureまたはCRCでparityを検査します。

`proof.json`はcatalog、BMLB、stage matrix、collision RLE、font、asset/palette、最大負荷、RAM/VRAM、ROM SHA-256を記録します。同梱WASM proofはMode Select、Campaign/Caravan開始、Options重複なし、SRAM再起動、10,000 frame CRC、48 bullet/5 emitter/16 spawn負荷、60Hz、XGM2＋WAV同時出力をassertします。

## Showcase

`template/template_bulletml_stg`は全機能入りの完成Showcase「GERONEKO -ABYSS STRIKE-」です。旧5面版とは名前だけを共有する新作で、最小Starterは別に持ちません。

- Campaign: 縦面、横面、BG巨大Boss面の3面
- Caravan: score item、pool負荷、時間切れを確認する専用1面
- Theme: 宇宙の星骸機関、蒼紺＋金の機械遺跡、硬質pixel art、日本語中心VN、Melodic FM＋PSG
- Gameplay: 3 Weapon、3段速度、Bomb、全Item、Movement、drop、Explosion、破壊背景、collision mask、背景切替/band/wave、Boss Parts、VN
- Ending: 最終choiceの救済／破壊を`abyss_choice`へ保存し、同じ3面の後で別Ending bindingへ分岐

画像はAI生成したオリジナル原画を`assets/source-art/`へ保存し、MD向けindexed 16色/RGB333/8px境界へ変換しています。`audit.json`にsourceと変換後PNGのSHA-256、寸法、palette fingerprintを記録します。BGM/SEはproject-localの新規素材で、外部作品素材を含みません。

## 検証コマンド

```powershell
node --check plugins/bulletml-stg-editor/renderer.js
node --check plugins/bulletml-stg-builder/index.js
node --test tests/bulletml-stg-v2.test.js tests/bulletml-stg-plugins.test.js
npm run verify:bulletml-studio-ui
npm run verify:bulletml-stg-wasm
npm test
npm run prepare:dist
npm run build:win
```

`verify:bulletml-studio-ui`は13-tab renderer、Pattern/Ref/loop/path、Boss phase 1～8、layoutを操作検証します。`verify:bulletml-stg-wasm`の既定projectはShowcaseです。assertionが1件でもfalseなら失敗します。

## 手動・外部release gate

自動操作の完了範囲はMode開始までです。次は自動テストやWASM proofだけでは完了扱いにしません。

- Campaign全DAG routeと救済／破壊Endingの完全playthrough
- Caravanの時間切れResultとname entry
- Windows packaged appで全plugin mount、Asset Picker、Demos tab、保存、Build、Test Play
- 実Mega Drive／flash cartでSRAM電源断保持、XGM2＋WAV音量、scanline欠け、入力感触

## 明示的な非対象

schema v1移行、Horizontal STGからの移行、PAL/H32/32X、2P、複数Player定義、難易度選択、完全seamless背景切替、BG pixel/tileへのdamage判定、gameplay上のVN overlay、BulletML `accel`と一般式は対象外です。
