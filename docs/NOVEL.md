# MDノベルエディター / ビルダー

`md-novel-editor` と `md-novel-builder` は、PCE Game Editor の Visual Novel JSON v2 を正本のまま読み書きし、Mega Drive / SGDK 2.11 向けの画像、音声、C runtime、ResComp 定義へ変換します。

互換対象は `assets/pce-vn-scenes.json` の JSON、コマンド名、分岐、変数、入力、待機、scene state の意味論です。PCE の scene-pack binary、save-state binary、VDC/SATB/VRAM address、System Card font、CD transport、ADPCM/CD-DA ABI は互換対象ではありません。

## 構成

| component | 役割 |
|---|---|
| `md-novel-editor` | PCE project import、Script/System/Font/Assets/診断、320x224 preview、revision付き保存 |
| `md-novel-builder` | validation、budget preflight、SGDK runtime/RES/C生成、builder role、ROM size gate |
| `template_md_novel` | 画像、立ち絵、分岐、PSG BGM/SFXを含む、そのままBuild/Test Playできるstarter |
| `standard-emulator` | 生成ROMのWASM Test Play |

builder は hook-only です。`manifest.json` の `generator` は `false` で、検証と生成は `onBuildStart` に一元化します。

## PCE型エディターUI

`Script`タブはPCE Visual Novel Editorの基本操作をMD plugin内へ移植しています。左に階層化SceneとCommandパレット、中央に色分けされたCommandカード、右に選択Command時点の320x224 previewとGUI編集フォームを配置します。列幅はresizerで変更でき、3列は常に表示します。viewportが1280px未満のときは列を隠したり重ねたりせず、workspace全体を横scrollします。列幅、Commandパレット、Sceneグループの開閉状態はprojectを開き直しても保持します。

- Scene名の`/`区切りをグループとして表示し、Scene追加・削除・開始Scene指定・並べ替えを行えます。ID変更時は`startScene`、`nextSceneId`、`jump`、`choice`の参照も更新します。参照されているSceneの削除は確認し、移動先を暗黙に変更しません。
- PCE JSON v2の18種（BG、Sprite、Sprite Move、Message、Variable、Choice、IF、Switch、Label、GOTO、Input、Jump、Wait、Cache、Audio、Effect、SpriteText、Comment）をCommandパレットまたはドラッグ&ドロップで追加できます。カードは1始まり番号、カテゴリ色、Skip、検索、並べ替え、コピー、前後貼り付け、削除を備えます。
- 選択Commandは型別GUIで編集し、Scene単位でGUI/JSONを切り替えられます。JSONは選択Sceneのraw objectを表示し、`Scene JSONを適用`でsyntax、ID重複、ID形式、commands型/件数を検証して明示適用します。未適用JSONがある状態でGUI、Scene、tab、Preview、保存へ移動すると、適用・破棄・キャンセルを選びます。既知fieldだけをGUIからpatchするため、未知fieldは保持されます。未知commandはJSON専用で保持・編集し、既知commandへの型変更はその型の既定値で作り直します。
- Undo/Redoは100段、Command clipboardは同じproject内で利用できます。`Ctrl+S`で保存、`Ctrl+Z`でUndo、`Ctrl+Y`または`Ctrl+Shift+Z`でRedoします。
- `System`はPCE互換のmessage速度・AUTO初期値・auto waitとMD target設定を分離して表示します。`Font`は同梱Misakiまたはprojectへ登録したTTF/OTF/TTCを選択し、size 8..32、threshold 1..254、x/y offset -8..8、preview textを調整して、固定16x16のindexed bitmapを生成します。使用glyphはspeaker、本文、choice、SpriteText、固定記号のsubsetです。`Assets`はbindingとtile/sprite/audio容量、`診断`tabはpath付きwarning/errorを表示します。

右側のCommand Previewは選択Commandまでを評価した表示です。`Preview`は選択Sceneの先頭から動く別ウィンドウを開き、message、choice、変数、label分岐、scene遷移、待機、入力、AUTO、Sprite Move、PSG previewを同じscript interpreterで再生します。`最初から`、早送り、runtime/変数/sprite/budget Debugを備え、100,000 commandを超える無限ループは停止して診断します。入力は方向key、Z=I/B、X=II/C、Enter=RUN/START、A=SELECT/AUTOです。

CD-DA、ADPCM、message voiceはフォームとJSONに残りますが、MDでは無音のため再生操作を無効化して理由を表示します。PSG songはpattern preview、変換済みPSG SFXはWAV previewを行います。再読込、Build、Test Play、project切替では未保存内容を保存または確認し、revision競合や保存失敗時は操作を中止します。

## project data

```text
assets/pce-vn-scenes.json          PCE互換script正本
assets/pce-assets.json             PCE互換asset catalog/provenance
assets/pce-font.json               PCE font provenance（任意）
assets/fonts/                      登録したproject-local TTF/OTF/TTC
data/md-novel/target-profile.json  MD表示・音声・入力・budget設定
data/md-novel/asset-bindings.json  assetId → MD resource binding
data/md-novel/transaction.json     複数documentのcommit hash
res/novel/font/generated.png       使用glyphだけの16x16 indexed atlas
res/novel/                         MD向け変換済みPNG/VGM/WAV
res/novel.res                      builder生成ResComp定義
inc/generated/novel_data.h         builder生成宣言
src/generated/novel_data.c         builder生成scene/resource table
src/novel_runtime/                 builder所有SGDK runtime
```

scene JSON は parsed object を丸ごと保持し、既知fieldだけをUIで変更します。未知のroot/scene/command fieldは保存時に落としません。MD固有fieldをscene JSONへ注入せず、target profileとbindingへ分離します。

各documentはstable SHA-256 revisionを持ちます。保存はbase revisionを照合し、temp fileの`fsync`、backup、atomic renameを行います。transaction manifestのhashが一致しないprojectは保存・ビルドを停止します。絶対path、`..`、symlink/junction escape、危険なJSON key、過大JSON、過深nestingも拒否します。

## PCE projectの取り込み

1. Mega Drive projectを`template_md_novel`から作成します。
2. `ノベル`ページで`PCEプロジェクト取込`を押します。
3. 元projectの`project.json`を選択します。
4. 取込後に`診断`と`Assets`を確認し、`保存`します。
5. `Build`または`Test Play`を実行します。

importは元projectのscene/catalogを先に検証し、参照中assetだけを変換します。画像は元source PNGをMD RGB333 / indexed 16色へ再変換し、PCE generated 4bpp binaryは使用しません。立ち絵は`sp_<group>_*`のgroup単位でPAL2/PAL3へ決定的に分け、同じbank内は共同量子化します。PSGは実際に参照された`(assetId, channel)` variantだけを生成します。

再importは自動監視ではありません。外部変更を取り込む前に未保存編集を保存し、明示的に再importしてください。

## script互換

top-levelは`version`、`settings`、`startScene`、`scenes`です。sceneは`id`、`name`、`fullScreenBg`、`commands`、`nextSceneId`を扱います。version 2より新しいdocument、未知command、解決不能なscene/label/asset参照はerrorです。`comment`と`skip: true`はruntimeへ出力しません。

| command | MD runtime |
|---|---|
| `background` | BG_Bへ表示。`transition: fade`はfadeOut/転送/fadeInを同期実行 |
| `sprite` | 4 logical slotをSGDK Sprite Engineで保持。表示、反転、animationを反映 |
| `spritemove` | 0..65535 frame、sync/async、animation切替を反映 |
| `message` | speaker 1行 + 本文19列×4行。1押下目で全文、2押下目で次page/command |
| `audio` | PSG songをXGM2、PSG SFXをXGM2 PCM CH2で再生。stop targetを保持 |
| `cache` | command順を保つzero-time NOP。warningを表示 |
| `variable` | signed 16-bit。define/set/add/sub/random、min/max、飽和add/sub、inclusive random |
| `choice` | 最大4択。選択値をvariableへ保存し、scene遷移または同scene継続 |
| `if` | eq/ne/lt/lte/gt/gteとtrue/else label |
| `switch` | 最大16 caseとdefault label。0 caseもdefaultへfall through |
| `label` / `goto` | 同scene内PCへ解決。duplicate labelは最初を使用しwarning |
| `inputcheck` | sync/async/cancel。最大7 async watcher、後の重複button割当を優先 |
| `jump` | scene遷移。変数と通常sprite/audio stateは維持し、move/message/choice/input watcherは解除 |
| `wait` | 0..65535 frame。0は同tick継続 |
| `effect` | fadeOut、fadeIn、blank、flash、shake |
| `spritetext` | 4 logical slot、各先頭32文字、blink、exact pixel BG_A compositor |

scene数は最大255、1 sceneのruntime commandは最大255、変数は予約変数を含め最大255です。予約変数`AUTO_ENABLE`と`MSG_SPEED`のindex/意味論を維持します。`settings.messageSpeedFrames`、`messageAdvanceMode`、`messageAutoWaitFrames`はglobal設定です。

`fullScreenBg` sceneへ入るとactor slotを解放します。MD版では320x224全画面を使えるため、PCE版の「Full BG中はmessage/choice禁止」は適用しません。SpriteTextはscene切替時にclearします。

## MD表示profile

- H40、320x224、NTSC 60Hz、64x32 plane
- `pce-legacy-256`: backgroundは`x = 4 + PCE tile x`、sprite/move/SpriteTextは`x = PCE x + 32`
- `md-h40`: 320px native座標をそのまま使用
- BG_B=背景、BG_A=SpriteText overlay、WINDOW=会話/選択肢
- WINDOWは下96px。16x16 glyph、speaker 1行、本文19列×4行、1page 75 cell
- choice labelはJSON上24文字まで保持し、MD windowは先頭17文字を表示してwarning
- PAL0=WINDOW/font/BG_A、PAL1=背景、PAL2/PAL3=立ち絵2系統
- Unicode JSONを正本にし、build時にShift-JISへround-trip検査変換。同梱Misaki Gothic 8x8または登録fontを16x16 cellへrasterizeし、使用glyphだけVRAMへ転送
- 登録fontはcontent hashで重複排除し、`cmap` format 4/12で全runtime文字の実在を検査します。壊れたfont、未収録glyph、未生成/stale atlas、PNG hash不一致はhard errorです。active fontを削除するときは先に同梱Misakiへ切替・再生成・保存してからproject copyだけを削除します

SpriteTextはPCEの1文字1hardware spriteを再現しません。H40 scanline上限を避けるため、BG_Aのdirty tile compositorへ描画します。1px座標を保持するため1文字が最大9 tileへ触れます。WINDOW領域ではWINDOWがBG_Aを隠します。

## 画像・palette・VRAM制約

画像は8px境界のindexed PNG、1 palette bankあたり透明index 0を含む16色です。preflightは`startScene`からscene/command PC単位の到達可能状態を探索し、label/goto/if/switch、choice/jump/nextScene、sync/async input watcher、終了後のstartScene再開を含めて、runtimeで実際に持続し得る背景・立ち絵・SpriteText・WINDOWだけを合算します。

| gate | hard limit |
|---|---:|
| scene VRAM | 1424 user tiles |
| hardware sprite pieces | 80 |
| 1 scanline sprite pieces | 20 |
| 1 scanline sprite pixels | 320 |
| SpriteText | 4 slots / 先頭32文字 |
| SpriteText BG_A dirty tiles | 192 |
| DMA profile | 6144 bytes/frame |

VRAM診断は各到達状態について`background unique tiles + WINDOW/font/page glyph + BG_A dirty tiles + simultaneous sprite frame tiles`を合算します。scene入口ではSpriteText/WINDOW/input watcherをclearし、`fullScreenBg`ならactorも解放するruntime規則を適用するため、互いに到達不能なproject全体最大値を組み合わせません。SpriteTextは4 slotの16x16 glyphが実際に触れる8x8 cellのunionを数え、WINDOW表示時はproject最大overlay領域と381 tileのWINDOW領域を別VRAM範囲へ予約します。立ち絵は生成後の`maxNumTile`/`maxNumSprite`、sync/async moveの掃引Y範囲、配置scanlineを使用します。探索が100,000状態を超える場合も安全側のbuild errorです。超過時に暗黙の再量子化、asset omission、BG_A退避は行いません。

## 音声

- driverはXGM2のみ
- PCE PSG song: inline patternからchannel shift/clamp済みVGMを生成し、XGM2 BGMへ変換
- PCE PSG SFX: inline patternから6650Hz mono WAVを生成し、XGM2 PCM CH2でone-shot再生
- CD-DA、ADPCM command、message voice: JSONとcommand順を保持したzero-time無音NOP。editorとBuild Logへwarning
- message voiceを無視する場合は通常の`messageSpeedFrames`/`messageAutoWaitFrames`へfallback
- mapperは初版では無効。ROM warning 3.5MiB、hard limit 4MiB

## 入力

| PCE script | MD button | standard Test Play既定key |
|---|---|---|
| `i` | B | Z |
| `ii` | C | X |
| `run` | START | Enter |
| SELECT / AUTO | A | A |
| 方向 | 同名 | 矢印key |

message送りはB/C/START/RIGHT/DOWN、choice決定はB/C/STARTです。Aは`AUTO_ENABLE`切替に予約します。

## Build生成と失敗条件

`onBuildStart`はscene/profile/binding/transaction/fontを再検証し、build ID別stagingへ全生成物を書き、hash確認後にcommit manifestを最後に更新します。内容が同じ生成物とstatic runtimeは書き直さずmtimeを保持します。正本JSONはbuildから変更しません。ResComp symbolは大文字小文字を無視して重複検査します。

builderが返す`makeVariables.SRC_C`は次の3ファイルだけです。

```text
src/main.c
src/novel_runtime/novel_runtime.c
src/generated/novel_data.c
```

`src/boot/rom_head.c`と`sega.s`は通常Cソースへ混入させません。`onBuildStart`が`{ok:false}`を返すかthrow/rejectした場合、hostはSGDKを開始せず、`onBuildError`と失敗`build-end`を1回だけ通知します。

通常の`Build`は従来どおり`clean release`です。`Test Play`だけ`skipClean`を要求し、前回Build成功manifest、ROM、全object、生成物、toolchain、`SRC_C`、runtime ABI、font format、ResComp契約のhashが一致した場合に限って`clean`を省略して`make release`の依存判定を使います。scene/font/asset変更時は内容が変わった生成物だけmtimeを更新するため、その依存objectだけが再生成されます。

manifest欠落/破損、前回失敗、ROM/object/生成物の欠落またはhash不一致、toolchain/SRC_C/runtime ABI/font format/ResComp契約変更ではTest Playも自動的にclean buildへ戻ります。Build Logには生成物のchanged/unchanged件数、cache hit/miss理由、完全無変更時の`input unchanged/object reused`を出します。ROMだけをblind reuseしてTest Playを開始することはありません。

未保存のplugin編集はBuild/Test Play/Project切替前にgeneric lifecycleで保存されます。保存が失敗した場合は操作を中止します。Test Play windowを再利用する場合も、新しいROM URLへreloadします。

## 検証

近接回帰:

```powershell
node --test tests/novel-editor-ui.test.js tests/novel-plugins.test.js tests/plugin-runtime-lifecycle.test.js tests/build-lifecycle.test.js tests/testplay-plugins.test.js tests/build-system.test.js tests/packaging-config.test.js
```

移植済みprojectの同梱WASM検証:

```powershell
node scripts/verify-md-novel-wasm.js --project projects/ishi_no_ura_01_md --output artifacts/md-novel
```

template由来ROMも同じprocessでreload検証する場合は`--template-rom <path-to-rom.bin>`を追加します。検証scriptはロゴskip、タイトル開始、PSG PCM出力、message完了/送り、save-state復元、別ROM load、元ROM reloadをassertし、PNGとJSONを`artifacts/md-novel/`へ保存します。

実績project `projects/ishi_no_ura_01_md` は、元 `ishi_no_ura_01` のscene JSONとstable hashが一致し、18 scenes / 503 commands / 275 messagesをSGDK 2.11でROM化しています。最新のROM size/hashとWASM assertは`artifacts/md-novel/ishi_no_ura_01-build-proof.json`および`ishi_no_ura_01-wasm-proof.json`を参照してください。

WASM成功は実機タイミングの代替ではありません。release前にはMega Drive実機または高精度emulatorでも、palette、scanline sprite、PCM中の大容量DMAを確認してください。
