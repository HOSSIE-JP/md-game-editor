# BulletML STG Studio

`bulletml-stg-editor` と `bulletml-stg-builder` は、Mega Drive向けのBulletML弾幕、縦／横ステージ、診断ROMを一体で作る組み込みpluginです。旧`horizontal-stg-*`とはデータもruntimeも分離しており、既存projectを自動移行しません。

仕様の基準は[BulletML Reference ver. 0.21](https://www.asahi-net.or.jp/~cs8k-cyu/bulletml/bulletml_ref_e.html)です。Mega Driveの表示予算は[Genesis Software Manual](https://segaretro.org/images/9/95/GenesisSoftwareManual.pdf)のH40条件（320×224、80 sprite、1走査線20 piece／320 dot）を使います。実装は外部コードを含まない独自のparser、compiler、VM、C runtimeです。

## 構成

| 項目 | 契約 |
|---|---|
| 対象 | 素のMega Drive、SGDK 2.11、NTSC 60Hz、H40 320×224 |
| Editor | `types: ["editor", "asset"]`、`asset-manager`と`sprite-editor`へ依存 |
| Builder | exclusive `builder` role、`bulletml-stg-editor`への一方向依存 |
| Template | `template_bulletml_stg`。Builderと`standard-emulator`を選択済み |
| bytecode | big-endian `BMLB ABI v1`、1 pattern 64KiB未満 |
| Preview | IRを直接実行せず、MDと同じコンパイル済みBMLBを実行 |

Editorを単独で有効化しても編集、XML交換、compile、Previewができます。Builderは保存済みEditorデータだけを読み、C runtime、生成C、ResComp定義、BMLB、proofを同期します。`src/boot/rom_head.c`は上書きせず、全Cファイルを`makeVariables.SRC_C`へ明示します。

## 編集正本

```text
data/bulletml/
├── project.json
├── editor-state.json
├── patterns/
│   └── <stable-id>.json
├── stages/
│   ├── vertical.json
│   └── horizontal.json
├── exports/
│   ├── <stable-id>.xml
│   └── <stable-id>.md-bullet.json
└── proof.json
```

- `project.json`はschema version、固定profile、共有sprite、4つのpattern roleを持ちます。
- pattern JSONは安定ID、定義、命令、式文字列、sprite、円hitbox、寿命、画面外余白を持ちます。
- `editor-state.json`は選択、pane幅、最終view、graph座標、pan、zoomを保持します。
- stage JSONは最大64 event、最大8 waypointの折線経路、Boss phaseを保持します。
- draftは不完全でも保存できます。ただし診断errorを持つprojectはBuild/Test Playできません。

保存はproject-root検査、revision照合、同一directory内の一時ファイルからのatomic replaceを使います。競合revisionは上書きせず返し、削除したpatternは`patterns/.deleted/`へ退避して復元できます。`Ctrl+S`、明示Save、dirty表示、切替時のSave／Discard／Cancelを備え、`beforeBuild`と`beforeProjectSwitch`は保存失敗またはCancel時に操作をvetoします。

## Patternエディター

Patternページは左のpattern／definition一覧、中央の構造化フローまたはノードGraphと320×224 Preview、右のInspector／診断／XMLで構成します。paneとPreview splitはドラッグでき、projectごとに復元します。

- 構造化フローとDOM＋SVG Graphは同じIR reducerを編集します。
- definition追加／削除、command追加／削除／並べ替え、Ref接続、共通Inspector編集を両viewで扱います。
- Graphはdefinitionを主要node、commandを折り畳みblock、Refをedgeとして表示し、階層自動配置、手動位置、pan、zoomを持ちます。
- Undo／Redoは100段です。
- 新規patternは空白、狙い撃ち、扇、回転、rank変化、rand散弾、速度変更、旋回、子弾分裂から作れます。
- 式は通常フォームと詳細テキストを切り替え、compile診断と値域を表示します。
- XML欄はcanonical生成結果の表示／コピーと、明示再取込だけを行います。JSONとXMLのライブ二重編集はしません。

Previewは最後に成功したcompile結果を保持します。play／pause／step／reset、frame移動、発射元と自機のdrag、rank、seed、`type=none`の縦横切替、hitbox、弾数、context、opcode、spawn、drop、走査線piece／dot heatmapを表示します。

## BulletML v0.21 subset

| 対応 | 内容 |
|---|---|
| 要素 | `fire`、`wait`、`repeat`、`vanish`、`changeDirection`、`changeSpeed` |
| Ref | `bulletRef`、`actionRef`、`fireRef`、param最大4個 |
| direction | `aim`、`absolute`、`relative`、`sequence` |
| speed | `absolute`、`relative`、`sequence` |
| 変数 | `$1..$4`、`$rand`、`$rank` |
| 式 | 定数式と動的アフィン式。定数部分はPC側で畳み込み |
| 非対応 | `accel`、動的除数、剰余、動的値同士の積、一般式、再帰Ref |

`wait`／`times`は0以上、`term`は1以上のu16へゼロ方向切り捨てします。top actionは2、bullet内並列actionは2、Ref／repeat深さは4、definitionは255が上限です。未知要素、重複label、未解決Ref、循環Ref、範囲外値は近似変換せずerrorにします。

`type=vertical`と`horizontal`は専用方向、`type=none`は両方向で使えるgeneric patternです。

## XML交換と安全性

exportは標準BulletML XMLを改変しません。MD固有情報は同名の`.md-bullet.json`へ分離し、canonical XML SHA-256、pattern ID、共有sprite、円hitbox、寿命、余白を保存します。

import parserはネットワークへアクセスしません。公式DOCTYPEは取得せず読み飛ばし、外部DTD／Entity、内部subset、未知要素を行・列付きで拒否します。sidecarのhashがXMLと一致しない場合は適用せず、既定bindingまたは未設定draftとしてwarningを返します。コメントと元の空白／整形はround-trip対象外です。

## 数値意味論

- 座標と速度はscale 64のsigned 16bit、式評価はsigned Q16.16です。
- 角度は0=上、時計回りのu16 turn値で、1024段のsin LUTを使います。
- `$rank`と`$rand`はQ0.16です。
- RNGはxorshift16で、seed 0は`0xACE1`へ正規化します。各`$rand`出現は式の左から1回ずつ進めます。
- `fire aim`は発射ごとに自機方向を再計算します。
- `changeDirection aim`は開始frameの目標方向へ固定します。
- `sequence`状態はaction context単位でrepeatとinline actionへ引き継ぎます。
- 方向／速度補間は商と余りを保持し、term終了時に目標値へ正確に一致させます。

## MD runtimeと表示予算

固定profileは敵弾48、発射元5、action context 106、同一frame生成16、global opcode 512/frameです。opcodeを使い切ったcontextはPCを保持して次frameから再開します。pool／spawn／context超過では新しいfireを拒否し、counterを増やします。

公開C API:

```c
void BML_init(void);
s16 BML_startEmitter(const u8 *program, u16 length, s16 x64, s16 y64,
                     u16 direction, u16 seed, u16 rankQ16);
bool BML_updateEmitter(s16 emitterId, s16 x64, s16 y64, u16 direction);
bool BML_stopEmitter(s16 emitterId);
void BML_setPlayer(s16 x64, s16 y64);
void BML_tick(void);
u16 BML_applyDisplayBudget(u16 reservedGlobalSprites,
                           const u8 *piecesByScanline,
                           const u16 *dotsByScanline);
const BML_Bullet *BML_getBullets(u16 *count);
void BML_clearAll(void);
const BML_Metrics *BML_getMetrics(void);
```

Hostは敵移動、SPRITE描画、衝突、得点を所有します。`BML_applyDisplayBudget`へ渡す224要素の走査線配列には、Hostが先に予約したpiece／dot数を入れます。配列は入力専用で、runtimeは内部scratchへ合成するためHostの予約値を書き換えません。弾は生成通番の古い順に割り当て、表示できない新しい弾を論理poolから削除します。その後の`BML_getBullets`だけを描画・衝突へ使うため、不可視弾の当たり判定は残りません。

弾は既定600 frameで、外接矩形が既定32pxの画面外余白を越えた場合も削除します。

## 弾sprite

`res/gfx/bulletml_bullet.png`は初回Build時だけ既定画像を作り、その後のBuildでは上書きしない編集可能資産です。縦横別の320×224 indexed背景、固定player／enemy／boss、縦横別BGM、射撃／被弾／撃破SFXはBuilder同梱物で、今回のEditor対象外です。背景は反復語彙へ収束する低タイル数の原寸画像としてBG_Bへ描画します。

Build時に次を検証します。

- 全patternと`project.defaultSprite`が同じasset、source、PAL3、frame寸法、frame数を使う。
- indexed-color PNG、非interlace、16色以下である。
- 各frameは8／16／24／32pxの組み合わせで、1 hardware pieceに収まる。
- PNG全体をframe格子へ分割した数と`frameCount`が一致する。
- animation frameは1行の横並びsheetとし、SGDKのanimation 0へ一意に対応させる。
- `tileCount = width / 8 × height / 8 × frameCount`で、共有資産の合計が128以下である。
- PLTE bytesのSHA-256が全metadataの`paletteFingerprint`と一致する。

複数frameは8 frameごとに切り替えて表示します。全frameのタイルは低位の共有VRAMへ1回だけロードし、48個の弾Spriteはmanual tile indexで参照します。32×32弾でも個体ごとに16タイルを複製しません。別source、別寸法、複数paletteを混在させる構成はBMLB v1 runtimeではBuild errorです。

## Stagesと診断ROM

Stagesページは縦／横の独立stageを編集し、出現frame、enemy種別、HP、score、任意pattern、最大8 waypointと到達frame、Bossの最大3 phaseを扱います。通常敵は同時4、Bossは同時1です。4つのrole slotは新規eventの既定patternです。

Boss phase開始とBoss撃破では敵弾を全消去し、通常敵撃破では発射済み弾を残します。統合Previewは敵経路、BulletML、自機射撃、衝突、残機、score、表示予算を同じ固定profileで実行します。

統合Previewはrenderer内の近似軌道ではなく、main側のproject境界付きsessionで全event／phaseのcompile済みBMLBを実行します。startBulletmlStagePreview／stepBulletmlStagePreview／seekBulletmlStagePreview／stopBulletmlStagePreviewを使い、敵HP、phase閾値、自機弾、Boss／通常敵ごとの弾消去規則、被弾無敵、生成順表示削除、80 sprite／20 piece／320 dot上限を1つの状態遷移で扱います。

Stages画面ではEasy／Normal／Hard（rank 0／0.5／1）とseedを選べます。矢印で移動、Zで射撃、ShiftまたはXで低速、Cでhitbox／負荷表示、Enterでpauseし、canvas上のpointerで自機を移動できます。frame sliderのseekはsessionをresetし、入力なしで指定frameまで決定的に再実行します。

ROMは起動後すぐタイトルを表示します。タイトルでは縦／横とEasy／Normal／Hardを選び、rankを0／0.5／1へ設定します。Cで完全診断を明示実行し、ゲーム中はCで診断表示を切り替えます。D-pad移動、A連射、B低速、Start pause、3残機、被弾無敵を備えます。各面は約60秒の敵波と3-phase Bossです。

## Build生成物

- `res/bulletml/generated/*.bmlb`
- `res/bulletml.res`
- `res/bulletml_game.res`
- `src/generated/bulletml_catalog.c`
- `inc/generated/bulletml_catalog.h`
- `src/bulletml/*.c`、`inc/bulletml/*.h`
- `data/bulletml/proof.json`

Build前に各patternをrank 0／0.5／1 × seed `0x0001`／`0xACE1`／`0xFFFF` × 自機経路3種の27ケース、3600 frameで実行します。generic patternは縦横それぞれを実行します。完全stageも同じdifficulty、seed、経路で検証します。fire drop、opcode枯渇、context枯渇、display削除が1度でも発生するとBuildを拒否します。

`proof.json`はproject、IR、BMLB、stage matrix、最大負荷、弾PNG／palette、共有VRAM／背景タイル予算、linker symbolから得た静的RAM／heap headroom、C self-test期待CRC、ROM SHA-256、SGDK pathを記録します。

Builderはユーザーpatternとは別に、48弾を16発ずつ3回生成する内部診断BMLBと、4つの待機emitter用BMLBを生成します。完全診断はタイトルでCを押したときだけ開始し、進行画面を先に表示してから、BGMとSFXを有効にして140 frame実行します。敵弾48、発射元5、同一frame生成16へ実際に到達したこと、drop 0、H40の80 sprite／20 piece／320 dot以内を検査します。通常起動では10,000 frame self-testと負荷probeを遅延実行しないため、タイトルから直ちにプレイできます。

60Hz gateは、全140 frameで`SYS_doVBlankProcess()`へ到達し、SGDK CPU loadが100%未満で、計測区間がNTSC 1 frameの1280 subtick以下であることです。SGDK 2.11の`getSubTick()`はVBlank中に固定値を返すため、最大値がちょうど1280の場合はVBlank到達数とCPU loadを併用して判定します。定常frame、`BML_tick`、表示予算処理、最大frameとそのframe番号はWASM proofへ別々に記録します。

## 検証

```powershell
node --check plugins/bulletml-stg-editor/index.js
node --check plugins/bulletml-stg-editor/bulletml-stage-preview.js
node --check plugins/bulletml-stg-editor/renderer.js
node --check plugins/bulletml-stg-builder/index.js
node --test tests/bulletml-stg-plugins.test.js
npm test

# SGDK Build後の同梱WASM検証
npm run verify:bulletml-stg-wasm -- --project <project-directory>
```

WASM検証はROMとsymbolを読み、C self-test 10,000 frameのCRCをJS VMと照合します。さらに縦横stageを自動操作で通し、stage clear、音声非ゼロ、最大bullet／emitter／context／opcode／spawn、全drop counter、CPU負荷、最小heap空き、Sprite Engine最小空きtile、ROM／WASM SHA-256を`wasm-proof/bulletml-stg-wasm-proof.json`へ保存します。assertionが1件でもfalseならコマンド自体が失敗します。

## 明示的な非対象

旧horizontal STGの移行、PAL／H32／32X、`accel`、一般式、複数弾palette、矩形hitbox、ライブXML同期、背景／音声／敵素材Editor、Windows配布版package検証、実Mega Drive検証は対象外です。実機確認はWASM、SGDK build、proofとは別の外部gateとして扱います。
