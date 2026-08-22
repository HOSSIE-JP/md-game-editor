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
- `System`はPCE互換のmessage速度・AUTO初期値・auto waitとMD target設定を分離して表示します。`Font`は既定の同梱`JF-Dot-Shinonome16.ttf`（size 16、threshold 190）またはprojectへ登録したTTF/OTF/TTCを選択し、size 8..32、threshold 1..254、x/y offset -8..8、preview textを調整して、固定16x16のindexed bitmapを生成します。使用glyphはspeaker、本文、choice、SpriteText、固定記号のsubsetです。`Assets`はbinding、使用PAL、ordered RGB333 swatch、palette品質、tile/sprite/audio容量を表示し、同じprofileの画像を明示的なpalette groupとして「共同減色して保存」できます。`診断`tabはpath付きwarning/errorを表示します。

右側のCommand Previewは選択Commandまでを評価した表示です。`Preview`は選択Sceneの先頭から動く別ウィンドウを開き、MD runtimeと同じ60fpsの状態遷移でBG fadeOut/転送/fadeIn、1glyph単位のmessage送り、手動page待ち、AUTO、choice、変数、label分岐、scene遷移、WAIT、sync/async INPUT、補間中のSprite Move、SpriteText blink、sprite animation、PSG previewを再生します。文字・選択肢・SpriteTextは生成対象の16x16 subset font atlasで描画します。`最初から`、早送り、runtime/変数/sprite/budget Debugを備え、100,000 commandを超える無限ループは停止して診断します。入力は方向key、Z=I/B、X=II/C、Enter=RUN/START、A=SELECT/AUTOです。

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
res/novel/font/JF-Dot-Shinonome16.ttf  既定font本体（付属license文書と同伴）
res/novel/font/generated.png       使用glyphだけの16x16 indexed atlas
res/novel/                         MD向け変換済みPNG/VGM/WAV
res/novel.res                      builder生成ResComp定義
inc/generated/novel_data.h         builder生成宣言
src/generated/novel_data.c         builder生成scene/resource table
src/novel_runtime/                 builder所有SGDK runtime
```

scene JSON は parsed object を丸ごと保持し、既知fieldだけをUIで変更します。未知のroot/scene/command fieldは保存時に落としません。今回のscript拡張として`background.palette`と`sprite.palette`だけを任意fieldで保持し、値は`PAL0`～`PAL3`です。field未指定はAuto（従来互換）として読みます。変換profile、ordered palette、fingerprint、品質、groupなどMD固有の物理情報はsceneへ混ぜず、target profileとbindingへ分離します。

各documentはstable SHA-256 revisionを持ちます。保存はbase revisionを照合し、temp fileの`fsync`、backup、atomic renameを行います。transaction manifestのhashが一致しないprojectは保存・ビルドを停止します。絶対path、`..`、symlink/junction escape、危険なJSON key、過大JSON、過深nestingも拒否します。

## PCE projectの取り込み

1. Mega Drive projectを`template_md_novel`から作成します。
2. `ノベル`ページで`PCEプロジェクト取込`を押します。
3. 元projectの`project.json`を選択します。
4. ダイアログでBGとSLOT0～SLOT3の変換先を、それぞれPAL0～PAL3から選びます。同じPALを共有する指定もできます。
5. 取込後に`診断`と`Assets`を確認し、`保存`します。
6. `Build`または`Test Play`を実行します。

importは元projectのscene/catalogを先に検証し、参照中assetだけを変換します。既定fontは`JF-Dot-Shinonome16.ttf`、size 16、threshold 190で生成済みにするため、取込直後から画面操作なしでBuildできます。画像は元source PNGをMD RGB333 / indexed 16色へ再変換し、PCE generated 4bpp binaryは使用しません。PCE取込では既存のpalette fieldをダイアログの割り当てで上書きします。既定値はBG=PAL0、SLOT0=PAL1、SLOT1=PAL2、SLOT2/SLOT3=PAL3です。背景はPAL0ならindex 0=黒/index 1=白を予約し、PAL1～PAL3はgeneral profileで再減色します。SpriteはH/S operator色を避けるshadow-safe profileで再減色し、PAL0～PAL2はindex 14、PAL3はindex 14/15を使用しません。各画像は独立に減色し、自動group化しません。同じPALへ同時表示してfingerprintが衝突するprojectも取込自体は完了して診断を表示しますが、Buildは停止します。必要な画像だけAssets tabで明示的に共同減色してください。PSGは実際に参照された`(assetId, channel)` variantだけを生成します。

再importは自動監視ではありません。外部変更を取り込む前に未保存編集を保存し、明示的に再importしてください。

## script互換

top-levelは`version`、`settings`、`startScene`、`scenes`です。sceneは`id`、`name`、`fullScreenBg`、`commands`、`nextSceneId`を扱います。version 2より新しいdocument、未知command、解決不能なscene/label/asset参照はerrorです。`comment`と`skip: true`はruntimeへ出力しません。

| command | MD runtime |
|---|---|
| `background` | BG_Bへ表示。任意の`palette`（PAL0～PAL3）を読込み、`transition: fade`はfadeOut/転送/fadeInを同期実行 |
| `sprite` | 4 logical slotをSGDK Sprite Engineで保持。任意の`palette`（PAL0～PAL3）、表示、反転、animationを反映 |
| `spritemove` | 0..65535 frame、sync/async、animation切替を反映 |
| `message` | speaker 1行 + 本文19列×4行。1押下目で全文、2押下目で次page/command。手動page待ちは右下に点滅`▼`、AUTO中は入力中から`◆`を表示 |
| `audio` | PSG songをXGM2、PSG SFXをXGM2 PCM CH2で再生。stop targetを保持 |
| `cache` | command順を保つzero-time NOP。warningを表示 |
| `variable` | signed 16-bit。define/set/add/sub/random、min/max、飽和add/sub、inclusive random |
| `choice` | 最大4択。選択値をvariableへ保存し、scene遷移または同scene継続 |
| `if` | eq/ne/lt/lte/gt/gteとtrue/else label |
| `switch` | 最大16 caseとdefault label。0 caseもdefaultへfall through |
| `label` / `goto` | 同scene内PCへ解決。duplicate labelは最初を使用しwarning |
| `inputcheck` | sync/async/cancel。最大7 async watcher、後の重複button割当を優先。sync/asyncの空button指定は検証error（旧データはzero-timeで継続） |
| `jump` | scene遷移。変数と通常sprite/audio stateは維持し、move/message/choice/input watcherは解除 |
| `wait` | 0..65535 frame。0は同tick継続 |
| `effect` | fadeOut、fadeIn、blank、flash、shake |
| `spritetext` | 4 logical slot、各先頭32文字、blink、exact pixel BG_A compositor |

scene数は最大255、1 sceneのruntime commandは最大255、変数は予約変数を含め最大255です。予約変数`AUTO_ENABLE`と`MSG_SPEED`のindex/意味論を維持します。`settings.messageSpeedFrames`、`messageAdvanceMode`、`messageAutoWaitFrames`はglobal設定です。

`fullScreenBg` sceneへ入るとactor slotを解放します。次のBGを転送する前にSprite Engineの非表示SATをVBlankへ反映するため、新BGの上に旧spriteが1frame残りません。MD版では320x224全画面を使えるため、PCE版の「Full BG中はmessage/choice禁止」は適用しません。SpriteTextはscene切替時にclearします。

## MD表示profile

`target-profile.json` schema v2は`video.messagePlane: "SPRITE"`と`window.renderer: "shadow-highlight-sprite-2x2"`を必須にします。v1は読込時に未知fieldを保持したままv2へ移行し、次回保存で永続化します。旧`window.opaque`とWINDOW描画へのfallbackはありません。将来versionは自動downgradeせず検証errorにします。

- H40、320x224、NTSC 60Hz、64x32 plane
- `pce-legacy-256`: backgroundは`x = 4 + PCE tile x`、sprite/move/SpriteTextは`x = PCE x + 32`
- `md-h40`: 320px native座標をそのまま使用
- BG_B=背景、BG_A=SpriteText overlay、hardware sprite=会話/選択肢
- VBlankでH/Sを解除してHInt counter 127を設定し、y=128の水平割り込み1回でHilight/Shadowを有効化します。VIntは停止しません。message/choiceを隠す、scene遷移、BG転送、同期input、blankではH/Sを解除します
- y=128以降はMega DriveのShadowで疑似半透明化し、その上へPAL0・high priority・always-on-topの文字spriteを表示します。PreviewもRGB333のShadow値へ変換してから文字を描きます
- 16x16 glyphを横2文字単位の32x16 spriteへまとめ、全文表示後は上下2行を32x32 spriteへ再編します。通常の19列×4行 + cursorは最大30 message spriteです
- speakerと本文先頭行を同じ32px高spriteへまとめるとactorとの合計がscanline 320pxを超えるpageだけ、speaker行を分離します。この安全layoutの管理上限は38 message spriteです。preflightはlayoutをpage単位で決定し、80 pieces、20 pieces/scanline、320px/scanlineを厳密に検査します
- choiceの既定位置`y=136..184`が可視actorと重なってscanline上限を超え、`y=152..200`へ1行下げると負荷が下がるcommandは自動的に下段layoutへ切り替えます。下段でも上限を超える場合はassetを暗黙に隠さずBuild errorにします
- message用VRAMは固定377 tileです。上152 tile、中152 tile、下72 tile + cursor 1 tileを3 VBlankへ分け、各frame 6144 bytes以内の`DMA_QUEUE_COPY`で転送します。choiceは2 frameです
- speaker 1行 + 本文19列×4行、1page 75 cell。choice labelはJSON上24文字まで保持し、表示は先頭17文字でwarningを出します
- manual messageのpage完了時は右下に30frame周期で点滅する`▼`、AUTO時は本文表示中から常灯する`◆`を表示します
- 最終pageを決定して次commandへ進むと旧文字spriteとcursorを消します。Shadow bandは次のmessage/choiceまたは解除commandまで維持するため、3frameの次page準備中に古い文字が残ったり背景が明滅したりしません
- PAL0～PAL3はBG/Sprite Commandごとに選択できます。PAL0 index 0=黒、index 1=白をmessage/choice/SpriteTextと共有します
- 新規CommandはBG=PAL0、sprite slot 0=PAL1、slot 1=PAL2、slot 2/3=PAL3。palette未指定の既存JSONはAutoとして従来binding/fallback（BG=PAL1、Sprite=PAL2）を維持します
- Unicode JSONを正本にし、build時にShift-JISへround-trip検査変換します。登録fontはcontent hashで重複排除し、`cmap` format 4/12、全runtime glyph、生成atlasのhashを検証します

SpriteTextはPCEの1文字1hardware spriteを再現せず、BG_Aのdirty tile compositorへ描画します。1px座標を保持するため1文字が最大9 tileへ触れます。message/choice中に可視SpriteTextがy=128以降へ交差すると、その文字もShadowを受けて見え方が変わるためBuild errorです。先に上側へ移動するか非表示にしてください。

## 画像・palette・VRAM制約

画像は8px境界のindexed PNGです。背景は従来どおりPAL0ならindex 0=黒/index 1=白を固定する`pal0-reserved`、PAL1～PAL3なら`general`を使います。Spriteは元source PNGから明示的に再変換し、PAL0～PAL2では`shadow-safe-pal012`（index 0=透明、index 1=白、index 14=H/S予約）、PAL3では`shadow-safe-pal3`（index 0=透明、index 14/15=H/S予約）を使います。予約indexは量子化候補にも最終pixelにも使いません。減色後はすべてMD RGB333へsnapし、ordered 16色paletteのfingerprintをbindingへ保存します。平均ΔEが8超またはp95が20超なら画質warningです。

同じ物理PALへ同時表示する画像はordered palette fingerprintが完全一致しなければBuild errorです。scene遷移など時間的に重ならない画像は同じPALを再利用できます。同じsprite assetをPAL0～PAL2とPAL3の両方で使う場合は、互換性のある厳しい`shadow-safe-pal3`へ一度だけ変換して共有します。背景の`pal0-reserved`と`general`など互換性のないprofileを同じassetで使う場合は、別assetへ複製してください。`paletteGroup`は同じ実効profileの画像だけを共同減色する明示操作です。profile v2移行時はgroupも元画像から「共同減色して保存」で再変換してください。Buildは画像を変更せず、converter v4より古い変換やprofile不一致をerrorにします。

RuntimeはBG/Sprite表示時に対象resourceのpaletteを指定PALへ読み込み、同じfingerprintならDMAを省略します。hide/replace時は論理ownerを解放し、Sprite Move中は割当を維持します。fullScreen sceneのactor解放はBGのclear/drawより先にVBlankへcommitします。Previewもindexed pixelと物理PALの最終loadを使って再着色し、同時衝突を赤枠で表示します。

PAL0のmessage/choice/SpriteTextはindex 1を共有します。通常は白へ復元し、`message.textColor`指定中だけindex 1を書き換え、message終了時に白へ戻します。非白messageがPAL0画像のindex 1または可視SpriteTextと重なる場合は、そのmessageだけ白で描画してwarningを出します。元の`message.textColor`はJSONに保持されます。`spritetext.color`もJSON互換のため保持しますがMD runtimeでは無視します。

preflightは`startScene`からscene/command PC単位の到達可能状態を探索し、label/goto/if/switch、choice/jump/nextScene、sync/async input watcher、終了後のstartScene再開を含めて、runtimeで持続し得る背景・立ち絵・SpriteText・message spriteを合算します。Sprite Moveは開始位置から終了位置までの掃引Y範囲も検査します。

| gate | hard limit |
|---|---:|
| scene VRAM | 1424 user tiles |
| message VRAM | 377 tiles |
| hardware sprite pieces | 80 |
| message sprite objects | 通常30 / 安全layout最大38 |
| 1 scanline sprite pieces | 20 |
| 1 scanline sprite pixels | 320 |
| SpriteText | 4 slots / 先頭32文字 |
| SpriteText BG_A dirty tiles | 192 |
| DMA profile | 6144 bytes/frame |
| message reveal DMA | 最大3 frames |

VRAM診断は各到達状態について`background unique tiles + 377 message tiles + BG_A dirty tiles + simultaneous sprite frame tiles`を合算します。scene入口ではSpriteText/message/input watcherをclearし、`fullScreenBg`ならactorも解放するruntime規則を適用するため、互いに到達不能なproject全体最大値を組み合わせません。SpriteTextは4 slotの16x16 glyphが実際に触れる8x8 cellのunionを数えます。立ち絵は生成後の`maxNumTile`/`maxNumSprite`、配置scanline、Move掃引範囲、H/S bandと交差するpalette operator indexを使用します。探索が100,000状態を超える場合も安全側のBuild errorです。超過時に暗黙の再量子化、asset omission、BG_A退避、旧WINDOW fallbackは行いません。
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

`src/boot/rom_head.c`と`sega.s`は通常Cソースへ混入させません。生成ABI 4では`NovelCommand.count`へBG/Spriteのpalette index（0～3）を格納し、resourceごとのordered palette fingerprint IDを`novelDataBackgroundPaletteId()` / `novelDataSpritePaletteId()`でruntimeへ渡します。`NovelMessage.layoutFlags`はscanline 320pxを守る必要があるpageに`NOV_MSG_SEPARATE_TOP`を指定し、`NovelChoice.layoutFlags`は適応下段配置に`NOV_CHOICE_LOWERED`を指定します。`onBuildStart`が`{ok:false}`を返すかthrow/rejectした場合、hostはSGDKを開始せず、`onBuildError`と失敗`build-end`を1回だけ通知します。

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

実績project `projects/ishi_no_ura_01_md` は、元 `ishi_no_ura_01` のscene JSONとstable hashが一致し、18 scenes / 504 commands / 275 messagesをSGDK 2.11でROM化しています。最新のROM size/hashとWASM assertは`artifacts/md-novel/ishi_no_ura_01-build-proof.json`および`ishi_no_ura_01-wasm-proof.json`を参照してください。

WASM成功は実機タイミングの代替ではありません。release前にはMega Drive実機または高精度emulatorでも、palette、scanline sprite、PCM中の大容量DMAを確認してください。
