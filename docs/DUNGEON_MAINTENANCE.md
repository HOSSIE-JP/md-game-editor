# ダンジョンエディター/ビルダー メンテナンスガイド

`plugins/dungeon-game-editor` + `plugins/dungeon-game-builder` の保守用ノウハウ集。ユーザー向け仕様は [PLUGIN.md](PLUGIN.md) の各プラグイン節を参照。ここには「なぜそうなっているか」「変更時に何を守るべきか」「過去に踏んだ罠」を残す。

## 1. 全体アーキテクチャと WYSIWYG 保証

```
plugins/dungeon-game-editor/
  render-core.js     … 共有レンダリングコア (UMD)。プレビューと SGDK エクスポートの両方が使う
  dungeon-service.js … メインプロセス。フロアCRUD/検証/SGDKエクスポート (require で render-core を読む)
  renderer.js        … エディターUI。import() + globalThis.DungeonRenderCore で render-core を読む
plugins/dungeon-game-builder/template/
  src/main.c         … ゲーム状態の所有者 (プレイヤー/踏破/エネミー/移動/フロア遷移)
  src/dungeon_view.c … 描画専任 (デシジョンタイル/ビルボード/ミニマップ)。状態はポインタで受け取る
  inc/dungeon_game.h … データ構造・フラグ定義 (エクスポート側と一致必須)
```

**最重要ルール: 3Dプレビュー = 実機出力 (WYSIWYG)。** 挙動を追加・変更するときは必ず JS 側 (render-core.js / renderer.js) と C 側 (main.c / dungeon_view.c) の両方へ同じ変更を入れる。片側だけの修正は不完全であり、レビューで差し戻す。

**render-core.js は UMD。** `import` / `export` / `require(` をファイル内に書いてはならない (テストが正規表現で検査している)。末尾で `module.exports = core` と `globalThis.DungeonRenderCore = core` の両方に代入する。

**モジュール境界 (C側):** main.c がゲーム状態を所有し、dungeon_view.c は描画のみ。dungeon_view.c は `dungeon_data.h` を include しない (フロア数マクロを使えない) ため、フロア数に依存する配列は main.c に置き、`DUN_setEnemies()` / `DUN_drawMinimap(floor, visited, ...)` のようにポインタで渡す。

## 2. 疑似3D方式 (デシジョンテーブル焼き込み)

- 4マス視界の全画面マスク列挙は ROM 爆発するため、**8x8タイル単位のデシジョンツリー** (周囲エッジ状態 開/壁/扉 → タイル実体) を焼き込み、実機 (`dungeon_view.c`) が毎アニメフレーム評価して ROM→VRAM ダブルバッファ (400タイル×2バンク) へ **2 vblank 分割 DMA** する。この 2 vblank はハード制約であり、ペーシング用に変更しない (追加待ちは `dun_extra_step_vblanks` で加算する)。
- 床/天井は焼き込まず 32x32 パターンを BG_B へ固定反復配置。壁/扉は透明 index 0 の BG_A タイルとして重ねる。
- 左ターン = 右ターンテーブルの鏡像評価 (`dun_edges_turn_mirrored`) + 水平反転合成。後退 = 移動先セル基準の前進フレーム逆再生。
- タイル爆発対策: 扉=壁+中央パネル共有、H/Vフリップ正規化dedup、シェード量子化、部分カバーエッジ上限8 (**全面カバーは絶対に捨てない** — 手前全開時に唯一タイルを描く背景壁になる)。
- 階段セルの壁面焼き込み案 (5状態分岐) はタイル1万枚/フレームに爆発したため不採用 → 階段は通行可能セル+ビルボードになった。ノード形式は6ワード (5状態) のまま将来用に維持。
- 移動補間: 前進/後退は**線形** (定速)。easeSmooth に戻すとセル境界ごとに減速→再加速し「1ブロックごとに一時停止する」と苦情が来る (実際に来た)。旋回のみ easeSmooth。

## 3. ビルボードシステム (宝箱/階段/エネミー)

- 素材は `settings.common_assets` (プロジェクト共通1組)。素材セット (壁/扉/床/天井) とは別管理。ビルボードは壁に焼き込まれないため素材セットに紐付ける理由がない。
- シートは 8距離バケット (`BB_BUCKET_HEIGHTS`、frame 0 = 最至近48px) の横並び。宝箱/階段 = 384x48 (1行、`SPR_setFrame`)。エネミー = 384x384 (8行 = 4方向×歩行2フレーム、`SPR_setAnimAndFrame(row, bucket)`)。SGDK は「行=アニメーション、列=フレーム」。
- 配置は (dd, dl) 相対セルごとの事前計算ポーズテーブル (`dun_bb_static/fwd/turn`、`DunBBPose {x,y,frame,depth_code}`、frame=-1 はカリング)。`depth_code` は `0=壁なし、1～15=遠→近`、`clamp(16 - ceil(z * 3), 1, 15)` の4bit量子化値。
- **足元 (dd=0, dl=0) のルール**: 静止・旋回ポーズでは最至近バケットへ固定表示 (`billboardUnderfootPose`)、**前進/後退ポーズではカリング** (`allowUnderfoot=false`)。移動アニメ中も表示し続けると「スプライトが追従してくる」と苦情が来る (実際に来た)。連続透視式は cam.z→0 の特異点があるため足元を通常式に通してはならない。
- PAL1 は 16 色固定 (index 0 = マゼンタ透過キー + 15色を宝箱/階段/エネミーのテクスチャから median-cut 量子化)。ビルボード素材を追加したら `buildSpritePalette` のサンプル対象に加える。既存スプライトの色味が微シフトするのは仕様。
- ハードウェアスプライトは `DUN_SPRITE_COUNT = 8` スロットを全ビルボードで共有。候補セル順 (近→遠) に割り当て、あふれた遠方は非表示。
- **側壁の部分遮蔽**: 壁・扉のZバッファを4bitコードへ変換し、各8x8タイル内の**最小非ゼロ深度**だけを返すstatic/fwd/turn用 `DunPriorityTable` を焼く。壁タイルは、重なる全ビルボードについて `tile_min_wall_depth > billboard_depth` の場合だけBG_AのPriority bitを立てる。同一コード・遠い壁は低Priorityのままなので誤遮蔽しない。混在深度タイルでは最大8px程度の隠し損ねを許容する保守的判定。床/天井、ビルボード同士は対象外。左右鏡像・前後移動・エネミースライドでは座標/距離バケットと一緒にdepth_codeも整数補間する。
- Sprite Engineの自動VRAM割当・自動タイル転送を使用し、全ビルボードを低Priorityで描く。BG_Aの低Priority壁はスプライトの後ろ、高Priority壁はスプライトの前になる。スプライト画素をRAMへ展開・比較・再DMAしてはならない。外接範囲は選択 `AnimationFrame.frameVDPSprites` の実メタスプライトからタイル単位で求める。
- 通常の移動/旋回は既存400ワードBG_AマップDMAへPriority bitを含める。`DUN_refreshBillboards()` は壁世代、表示数、外接タイル範囲、depth_codeの完全一致をキャッシュし、Priority bitが実際に変わった場合だけ400ワードを再送する。ピクセル位置だけが同じタイル内で動く敵スライドではマップDMAを発生させない。
- LOS ゲート: `losVisible` はセル中心間の supercover 線分判定 (整数誤差項、JS/C同一)。**格子の角を正確に通過する場合は両側の迂回路が開いている場合のみ可視** (AND)。OR にすると開いていない側の壁が実際には描画されるため、壁越しにスプライトが透ける (実際にバグとして踏んで修正した経緯がある。tests の partialCornerFloor が回帰ガード)。

## 4. エネミー (移動エンティティ)

- スポーンはセルフラグ (`cell.enemy` → flags bit 0x10)、実体は main.c の RAM 配列 `dun_enemies[DUNGEON_FLOOR_COUNT][8]` (フロア別永続、`dun_visited` と同じパターン)。
- AI は **render-core.js に1回実装 → main.c へ関数単位で移植** (losVisible と同じ二重実装パターン)。同一性の担保:
  - 16bit xorshift RNG (シフト定数 7, 9, 8 / seed 0x2025)。テストが**先頭5出力 (0x8ebc, 0x04d4, 0x8de3, 0x215d, 0x159a)** を断言しており、C移植の照合アンカーになっている。
  - RNG の消費順序も一致必須 (徘徊は roll を無条件に1回消費 → 分岐によって2回目)。
  - 追跡の同点タイブレークは横 (x) 優先。
- 占有ルール: エネミーはプレイヤー/宝箱/階段/他エネミーのセルへ侵入・通過不可。プレイヤー側も `canMove()` / `canPreviewMove()` (→ `core.canTraverse`) でエネミーセルをブロック。接触フックは**追跡ステップがプレイヤーセルへ侵入を試みたときのみ**発火 (徘徊は候補から除外されるため発火しない)。
- ティック間隔はフロア別 (`DungeonFloorData.enemy_step_vblanks`、0=プロジェクト既定を継承、エクスポート時に解決して焼き込み)。実機はティックごとに現在フロアの構造体から読むため、フロア遷移で自動的に切り替わる。
- 位置だけ変わる再描画は `DUN_refreshBillboards()` (壁の再ステージなし)。壁タイルまで再送すると無駄に 2 vblank 消費する。
- **移動スライド (瞬間移動に見せない)**: 敵は tick で論理セルを1マス進めるが、描画は tick 間を補間して滑らかにスライドさせる。仕組みは**実行時3D投影ではなく、直前セルと現セルの「焼き込み済みビルボードポーズ (画面座標)」の整数線形補間**なので、焼き込みテーブルは不変 (=`core.version` バンプ不要、既存キャッシュ有効) かつ 68k は整数演算のみ。要素: ① `DunEnemy.prev_x/prev_y` (= JS `enemy.prevX/prevY`) に tick 開始時のセルを記録 (AI分岐より前、JS/C同一位置)。② グローバルなスライド進捗 num/den (全敵共通、単一tick期限。C=`vtimer - enemy_last_step_vtime` / 間隔、JS=経過ms/間隔ms) を `DUN_setEnemySlide()` で毎フレーム view へ渡す。③ `updateBillboards`/`drawBillboardsInto` の敵分岐で、直前セルの相対 (dd,dl) を `dun_bb_cells`/`model.billboards.cells` から逆引きして両ポーズを取り、画面座標を `core.billboardSlideLerp` = `prev + trunc((cur-prev)*num/den)` (**0方向切り捨て**で JS `Math.trunc`=C 整数除算が一致) で補間。**距離バケット (スプライトサイズ) も `core.billboardSlideFrame` で補間**する — MD には連続スプライト拡縮が無いため8段階の焼き込み済みバケットを進行度で切り替え、移動中に距離変化で拡大縮小させる。バケットは**最近傍丸め** (対称・符号ごとに正の除算 `(2*|Δ*num|+den)/(2*den)`) で JS/C 一致させる (位置の切り捨てと違い、丸めないと末尾でサイズがポップする)。横移動 (距離不変) は prev/cur バケットが同じなのでサイズ変化しない。バケット数を増やすと段階が細かくなるが焼き込み変更 (シート幅・`core.version` バンプ) が要るため未対応。④ tick 間も動かすため毎フレーム再描画する (C=アイドル毎 `DUN_refreshBillboards`、JS=`requestAnimationFrame` の `stepEnemySlideLoop`)。視覚は論理セルへ**1tick遅れ**でスライドする (AI/当たり判定は論理セルを使う)。直前セルが視界窓外/カリング時は補間せず現セルへ描く (境界ポップは許容)。

## 5. 焼き込みキャッシュ — 最大の罠

`dungeon-service.js` はエクスポートを `res/dungeon/generated/**/bake.bin` (v8.serialize) にキャッシュする。キャッシュキー:

- セット別 (`computeBakeHash`): core.version + animation_frames/turn_frames + 壁/扉/床/天井のref文字列 + 画像バイナリ
- 共通ビルボード (`computeCommonBakeHash`): core.version + フレーム数 + 宝箱/階段/エネミーのref + 画像バイナリ
- 共通Priority (`computePriorityBakeHash`): core.version + animation_frames/turn_frames のみ。`res/dungeon/generated/priority/bake.bin` に1組だけ保存し、素材セットや画像、速度設定では無効化しない。葉は0～15の値だけで、深度PNG/TILESETは生成しない

**⚠ render-core.js の焼き込み結果に影響するロジック (デシジョンツリー、ポーズテーブル、シート生成、パレット) を変更したら必ず `core.version` を上げる。** 上げ忘れると既存プロジェクトの bake.bin がテクスチャ不変を理由に再利用され続け、修正が既存 ROM に反映されない。**このバグは実際に2回発生した** (階段ソリッド解除時、足元表示追加時)。`core.version` 直上に警告コメントあり。

検知方法: `node -e "const s=require('./plugins/dungeon-game-editor/dungeon-service.js'); console.log(s.exportDungeonData(require('path').resolve('projects/my_md_game')).cached)"` — バンプ直後の1回目は `false` (再焼き込み)、2回目は `true` になるはず。

**設定値の2系統を区別すること:**
- **焼き込みに影響する設定** (`animation_frames`/`turn_frames`) → bake hash に含める。変更でキャッシュ無効化。
- **ランタイムペーシング設定** (`move_speed_vblanks`/`enemy_step_vblanks`) → bake hash に含め**ない**。代わりに `exportPatternFiles(…, settings)` へ**キャッシュ由来でない fresh な settings** を渡して `#define` を毎回生成する (キャッシュヒット時に古い値が焼き付くのを防ぐ)。新しい設定を足すときはどちらの系統かをまず決める。

## 6. データモデルとマイグレーション

- セル: `{ walls, doors, one_way (各4bitマスク), dark, event('chest'|''), stairs('up'|'down'|''), enemy }`。エクスポート flags は dark=1, chest=2, stairs_up=4, stairs_down=8, enemy=16 (空き: 0x20/0x40/0x80)。`flagValue()` が唯一のエンコード地点。
- enemy は chest/stairs と排他 (`normalizeCell` が stairs/event の後に評価して落とす)。
- 素材参照は `path#tag` 形式。未定義タグは `makeFallbackTexture(kind)` の手続き生成へフォールバック — 新ビルボード種別のプレースホルダーは「アトラスに存在しないタグを既定refにする」だけで実現できる (enemy がこの方式)。
- **旧フォーマット互換は3世代ある**: ① フロア内蔵 inline `assets` (asset_sets 以前) ② asset_sets 内に宝箱/階段があった v1.1 ③ 現行 common_assets 分離。`resolveEffectiveState` / `normalizeCommonAssets` が読み込み時に前方変換する。migration を触るときは「settings.common_assets が明示されていれば尊重 → asset_sets から非既定値を採用 → フロア inline から補完」の優先順を崩さない (テストが3世代とも保持)。
- `persistedFloor()` が保存時に inline assets を剥がすため、フロア由来の migration は旧ファイルが残っている間だけ効く自己終息設計。

## 6.5. エネミースプライトの3Dモデル生成 (enemy-model-render.js) — エディター専用

`enemy_texture` (192x96、4方向列×歩行2フレーム行の48x48グリッド) を glTF/GLB + モーションから
ラスタライズしてPNGバイト列を差し替えるだけの機能。**焼き込み・スプライトシート寸法・SGDK Cテンプレート
は一切変更しない** (=`core.version` バンプ不要)。関連ファイル:

```
plugins/dungeon-game-editor/
  vendor/three/             … Three.js r160 サブセット (three.module.js / GLTFLoader.js /
                               BufferGeometryUtils.js / LICENSE / README.md)。バージョン更新手順は
                               vendor/three/README.md 参照。DRACO/KTX2/meshoptはvendorしない。
  enemy-model-geometry.js   … 依存フリーの純関数 (viewYaw/cellOrigin)。render-core.js と同じUMD規約
                               (import/export/requireを書かず module.exports + globalThis 両対応)。
                               Node (テスト) とブラウザ両方から読める。
  enemy-model-render.js     … 本体。ES module、vendor/threeを静的import。renderer.js はモーダルを
                               開いた時だけ `await import(new URL('./enemy-model-render.js', ...))`
                               で遅延ロードする (render-core.jsの兄弟importと同じ規約。起動時に
                               ~1MBのThree.jsを読まない)。
```

- **方向→列マッピング (最重要)**: ソース列 = view 0..3 = **[背, 右, 前, 左]** (C engineの
  `rel=(enemyDir-camDir)&3`、rel0=背 rel2=前 と同じ規約)。モデルGroupをworld +Y周りに
  `frontYawOffset(φ) + θ_col` 回転させる。θ: 背=180° 右=+90° 前=0° 左=-90°
  (`enemy-model-geometry.js` の `VIEW_YAW_DEG`)。φはユーザーの正面補正 (モデルが-Z向きなら180)。
  **検証アンカー**: `paintFallbackEnemyCell` (render-core.js:205-213) は view2=両目中央(前)、
  view1=目がスプライト右端、view3=目がスプライト左端、view0=目なし(背)。生成した「右」列(view=1)は
  スプライト右側に顔が来ること。テスト用の合成モデル (フロントマーカーを持つ非対称ジオメトリ) で
  WebGL経由の実描画を行い、view1で前マーカーの重心Xがセル右半分、view3で左半分に来ることを
  実地確認済み (カメラは常に+Z側に固定、モデルGroupのみ回転、three.jsの標準lookAt規約
  `right=cross(forward,up)` で world+X=screen右になることに依拠)。将来この対応を崩す変更を
  加える場合は同様の合成モデルテストで再確認すること。
- **16色化は必須**: `imageDataToIndexedPng` (renderer/renderer.js) は減色しない (ユニーク色を
  256まで収集するだけ)。リット済みの3D描画は数百色になり `validateAssetInspection` (<=16色) に
  落ちる。そのため `enemy-model-render.js` 内にローカル量子化 (`quantizeLocal16`: MD 3bit/chスナップ
  `snapChannelTo3Bit` [/36丸め、`paletteToVdpColors`と同じ規約] + 人気色法で不透明15色以下を選出) を
  実装し、`reconstructRgba` でクリーンなRGBA (各ピクセル=パレット色@alpha255、または透過@alpha0) へ
  再構成してから `image-quantize` capabilityの `imageDataToIndexedPng` へ渡す。透過はalpha<128の
  2値化のみで実現 (マゼンタcolor-keyは無関係、それは`blitBillboardFrame`側の別のフォールバック)。
- **エディター専用の境界**: `dungeon-service.js` / `render-core.js` / `plugins/dungeon-game-builder/**`
  からは一切参照されない (テストがソースパターンで保証)。生成物は既存の `commitEnemyTextureDataUrl`
  (renderer.js、`importAssetForSet` のtailと同じ検証・書き込み経路) を通って
  `dungeon/textures/common/enemy.png` へ書かれ、`common_assets.enemy_texture` を更新するだけなので、
  焼き込みキャッシュ無効化は既存の「画像バイナリ変更 → `computeCommonBakeHash` 変化」の仕組みに
  自然に乗る。
- **v1はセッション内メモリのみ**: 読み込んだモデルファイル・パラメータはディスクへ保存しない
  (モーダル再オープン時のみ、同一セッション内で最後のパラメータを復元)。sidecar保存はv2送り。
- パッケージング: `electron-builder.yml` は `plugins/**` を丸ごと `from: plugins / to: plugins` で
  同梱するため、`vendor/three/` を含め新規ファイルの追加設定は不要。

## 7. テストと検証手順

- **単体ファイル実行の罠**: `node --test tests/dungeon-plugins.test.js` は app-config 未ロードで plugin 列挙が空になり誤失敗する。正しくは:
  `node -e "require('./app-config').loadAppConfig(require('./app.config')); require('./tests/dungeon-plugins.test.js')"`
  最終確認は `npm test`。
- テストの型: ① render-core のロジック単体テスト (LOS/AI/ポーズ/パレット) ② エクスポート実物検証 (生成PNG寸法/palette、resources.res 行、生成Cの文字列) ③ **Cソースパターン断言** — JS と C の二重実装が乖離しないよう、C側に同じ定数・関数名・呼び出しパターンが存在することを正規表現で検査 ④ renderer.js ソース断言 (UI 配線)。
- 遮蔽変更時は、近い側壁で「手前と確定できる8x8壁タイルだけが前面化し、透明な開口側は残る」、遠い壁・同一深度・混在深度・複数候補で誤遮蔽しないこと、壁/扉、左右鏡像、static/fwd/turn、足元、敵スライドを確認する。Priority値は0～15、`resources.res` に `dun_occlusion_depth_tiles` が無いこと、Cに画素マスク/固定VRAM/9216B RAM/手動スプライトDMAが無いこと、600フレーム×8体で旧画素マスク相当処理より2倍以上高速なことを検査する。
- AI 変更時は不変条件ファジング (ランダムフロア×多ティックで占有違反/壁すり抜け/テレポートが無いこと) を書いて検証する。`stepEnemies` は決定的なので再現も容易。
- C コンパイル検証: SGDK は `data/tools/sgdk`、JRE は `data/tools/jre` (make に PATH 追加要)。`m68k-elf-gcc -fsyntax-only` を rescomp 生成ヘッダー付きで回すと構造体変更の破壊を早期検知できる。
- ヘッドレス実機検証: 同梱 WASM エミュ (initSync + EmulatorHandle) で ROM を実行し、`out/symbol.txt` の RAM アドレスを `get_memory` で読んで状態検証できる。ボタン bit: U1/D2/L4/R8/B16/C32/A64/START128。
- 実プロジェクト (`projects/my_md_game`) はリポジトリ内にあるがgitignore対象。実データでの regen 検証・キャッシュ検証に使える。ただし settings.json に旧既定値が明示保存されていると新既定が効かない点に注意 (既定値変更時はここも確認)。

## 8. 変更種別ごとのチェックリスト

**ビルボード種別を追加する** (enemy 追加の実績手順):
1. render-core.js: TEXTURE_KINDS / FALLBACK_COLORS / buildSpritePalette サンプル対象 / シート生成
2. dungeon-service.js: DEFAULT_ASSETS / ASSET_CONSTRAINTS / COMMON_ASSET_KEYS / COMMON_TEXTURE_KINDS / GENERATED_BB_SHEETS / buildBillboardExport / generatedCommonDescriptor / updateGeneratedResources
3. renderer.js: ASSET_META / COMMON_ASSET_KEYS / DEFAULT_ASSET_REFS (素材タブのカードは自動レンダリング) / drawBillboardsInto 分岐
4. dungeon_view.c: def 選択分岐
5. **core.version バンプ** + テスト (シート寸法 / resources.res / パターン断言)

**セル種別 (フラグ) を追加する**: CELL_FLAGS + DUN_FLAG_* (値一致) / blankCell×2 (service と renderer に別実装がある) / normalizeCell / flagValue / TOOLS + handleMapClick + renderMap グリフ + ミニマップ / makeGeneratedFloor (ランダム生成) / erase ツール対応。

**設定値を追加する**: §5 の2系統判定 → DEFAULT_SETTINGS + normalizeSettings クランプ → 設定タブ (renderSettings/readSettingsFormFields) → #define 出力 → C 側初期化 → プレビュー側の導出値 (frameStepMs 等) → ラウンドトリップ+キャッシュ挙動テスト。フロア別上書きにする場合は normalizeFloor + フロア編集フォーム + DungeonFloorData 構造体 (**エクスポート行と宣言のフィールド順一致**) + エクスポート時解決 (0=継承)。

**AI/移動ロジックを変更する**: JS (render-core) を先に変更しテストで固定 → C へ移植 (RNG 消費順序・タイブレーク・定数を一致) → ソースパターン断言更新 → 不変条件ファジング → WYSIWYG 確認。

**共通の最終確認**: `npm test` 全パス / 実プロジェクト regen (`cached` の遷移確認) / docs/PLUGIN.md の該当節更新 (実装とドキュメントの同期はこのペアの運用ルール)。
