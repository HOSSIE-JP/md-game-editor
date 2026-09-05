const FIELD_META = Object.freeze({
  id: ['安定ID', '保存・参照・実行時IDの割当で使う識別子です。作成後は変更しません。'],
  name: ['表示名', 'エディター内の一覧に表示する分かりやすい名前です。'],
  title: ['作品タイトル', 'タイトル画面やROM情報に使用する作品名です。'],
  rank: ['固定難度係数', 'BulletMLの$rankへ渡す0〜1の値です。ボスの各段階だけ個別上書きできます。'],
  target: ['実行環境', 'Mega Drive向けの映像・解像度・ROM条件です。'],
  platform: ['機種', '出力対象機種です。このStudioではMega Drive固定です。'],
  sgdk: ['SGDK版', 'ビルドに使用するSGDKの対応版です。'],
  video: ['映像方式', 'NTSCは60Hz、PALは50Hzです。本StudioはNTSCを対象にします。'],
  hMode: ['横解像度モード', 'H40は320ドット幅のMega Drive表示モードです。'],
  width: ['画面幅', 'ゲーム画面の横幅（ピクセル）です。'],
  height: ['画面高さ', 'ゲーム画面の縦幅（ピクセル）です。'],
  players: ['プレイヤー人数', '同時プレイヤー数です。本Studioは1P専用です。'],
  romBytes: ['ROM上限', '生成ROMに許可する最大バイト数です。4 MiB超過はビルドエラーです。'],
  modes: ['収録モード', '同一ROMへキャンペーンとキャラバンを収録する設定です。'],
  campaign: ['キャンペーン', '複数ステージを順番・分岐で進む通常モードの設定です。'],
  caravan: ['キャラバン', '指定1ステージを時間制限付きで遊ぶスコアアタック設定です。'],
  startStageId: ['開始ステージ', 'キャンペーンを新規開始したとき最初に読み込むステージです。'],
  stageId: ['ステージ', '対象となるステージの安定IDです。'],
  continues: ['コンティニュー回数', 'ゲームオーバー後に現在ステージを再開できる回数です。'],
  continueScore: ['再開時スコア', 'コンティニューした際にスコアをこの値へ戻します。'],
  carry: ['ステージ間の持越し', 'キャンペーンで次ステージへ引き継ぐ得点・残機・ボム・武器・速度の一覧です。'],
  timeLimitFrames: ['制限時間', 'キャラバン終了までのフレーム数です。NTSCでは60フレーム＝1秒です。'],
  resetOnHit: ['被弾時の初期化', '被弾したとき武器・速度・ボムをどう戻すか指定します。'],
  weapon: ['被弾時の武器', '「維持」は現在の武器を保ち、「初期武器」は開始時の武器へ戻します。'],
  bombs: ['ボム数', '初期所持数、または被弾後に補充する方法です。'],
  patternRoles: ['既定弾幕', '縦・横ステージの通常敵／ボスへ使う既定パターンです。'],
  verticalNormal: ['縦面・通常敵の弾幕', '縦スクロール面の通常敵に使う既定弾幕です。'],
  verticalBoss: ['縦面・ボスの弾幕', '縦スクロール面のボスに使う既定弾幕です。'],
  horizontalNormal: ['横面・通常敵の弾幕', '横スクロール面の通常敵に使う既定弾幕です。'],
  horizontalBoss: ['横面・ボスの弾幕', '横スクロール面のボスに使う既定弾幕です。'],
  palettes: ['パレット割当', 'PAL0〜PAL3を背景・自機・敵・弾などへ割り当てます。'],
  PAL0: ['PAL0用途', '背景BやHUDなど、パレット0の用途メモです。'],
  PAL1: ['PAL1用途', '背景Aなど、パレット1の用途メモです。'],
  PAL2: ['PAL2用途', '自機やアイテムなど、パレット2の用途メモです。'],
  PAL3: ['PAL3用途', '敵・弾・演出など、パレット3の用途メモです。'],
  bomb: ['ボム共通設定', '全武器で共通利用するボムの所持数・威力・演出・効果音です。'],
  initialStock: ['初期ボム数', 'ゲーム開始時に所持するボム数です。'],
  maxStock: ['ボム上限', '所持できるボムの最大数です。'],
  damage: ['ダメージ', '命中時に対象のHPから減らす値です。'],
  clearEnemyBullets: ['敵弾消去', '有効にするとボム使用時に画面内の敵弾を消去します。'],
  invincibleFrames: ['無敵時間', 'ボム使用後に自機が無敵になるフレーム数です。'],
  effectId: ['演出', '再生する共通演出の安定IDです。'],
  defaultSprite: ['既定の弾画像', 'パターンに個別指定がない場合に使用する敵弾スプライトです。'],
  patternOrder: ['弾幕の表示順', '弾幕パターンを一覧や生成カタログへ並べる安定順です。'],
  paletteFingerprint: ['パレット検証値', 'ビルド時に自動生成する内部検証値です。'],
  asset: ['アセット', 'ResCompへ登録済みのアセットを右側の選択UIから指定します。'],
  palette: ['使用パレット', 'スプライトが使用するPAL0〜PAL3です。'],
  frameWidth: ['1コマ幅', 'アニメーション1コマの横幅（ピクセル）です。'],
  frameHeight: ['1コマ高さ', 'アニメーション1コマの高さ（ピクセル）です。'],
  frameCount: ['コマ数', 'アニメーションに含まれるフレーム数です。'],
  animationRow: ['アニメーション行', 'スプライトエディターで定義したアニメーション行番号です。'],
  hardwarePieces: ['スプライト分割数', '1コマを構成するMega Driveハードウェアスプライト数です。'],
  tileCount: ['使用タイル数', 'ビルド時に算出するスプライトの使用タイル数です。'],
  pools: ['同時数上限', '実行時に確保する弾・敵・アイテム・演出などの固定枠上限です。'],
  enemyBullets: ['敵弾上限', '画面内で同時に存在できる敵弾数です。'],
  playerShots: ['自弾上限', '画面内で同時に存在できる自機弾数です。'],
  vmContexts: ['BulletML処理枠上限', '同時実行できるBulletML動作処理枠の数です。'],
  emitters: ['発射口', '弾を出す相対位置と角度の一覧です。'],
  enemies: ['敵上限', '同時に存在できる通常敵・破壊可能背景の数です。'],
  bossParts: ['ボス部位上限', '同時に存在できるボス部位数です。'],
  items: ['アイテム上限', '画面内で同時に存在できるアイテム数です。'],
  effects: ['演出上限', '同時に再生できる演出数です。'],
  opcodesPerFrame: ['命令実行上限', '1フレームで実行できるBulletML命令数です。'],
  bulletSpawnsPerFrame: ['弾生成上限', '1フレームに新規生成できる敵弾数です。'],
  dmaWordsPerFrame: ['DMA転送上限', '1フレームに許可するVRAM DMA転送量（ワード）です。'],
  pcmChannels: ['PCMチャンネル数', 'WAV効果音に確保する同時再生チャンネル数です。'],
  titleFrames: ['タイトル待機時間', 'タイトル画面を自動表示するフレーム数です。'],
  screens: ['画面一覧', 'タイトル、モード選択、ゲーム、結果、ランキングなど作品内の画面進行です。'],
  continueFrames: ['コンティニュー待機時間', 'コンティニュー入力を受け付けるフレーム数です。'],
  nameLength: ['名前文字数', 'ランキング入力で保存する名前の文字数です。'],
  autoSave: ['自動保存タイミング', '再開地点を保存するタイミングです。'],
  defaults: ['既定ボタン', 'ショット・ボム・速度切替へ割り当てる初期ボタンです。'],
  remappable: ['変更できる操作', 'オプション画面でプレイヤーがボタンを変更できる操作の一覧です。'],
  buttons: ['使用ボタン', '割当に使用できるA／B／Cボタンの一覧です。'],
  shot: ['ショットボタン', '自機弾を発射するボタンです。'],
  speedShift: ['速度切替ボタン', '低速→通常→高速を循環させるボタンです。'],
  rejectDuplicates: ['重複割当禁止', '有効にするとショット・ボム・速度切替へ同じボタンを割り当てられません。'],
  persistInSram: ['SRAMへ保存', 'ボタン設定をSRAMへ保存し、次回起動時に復元します。'],
  magic: ['保存識別子', '他ゲームのSRAMデータと区別する4文字の識別子です。'],
  version: ['保存形式版', 'SRAMデータ構造の版番号です。互換性判定に使います。'],
  checksum: ['破損検出方式', 'SRAMデータ破損を検出するチェックサム方式です。'],
  topCount: ['ランキング件数', 'Modeごとに保存するハイスコア件数です。'],
  campaignRanking: ['キャンペーン順位項目', 'キャンペーンの順位表へ保存する得点・到達ステージ数・プレイ時間です。'],
  caravanRanking: ['キャラバン順位項目', 'キャラバンの順位表へ保存する得点・残り時間です。'],
  checkpoint: ['再開地点の保存項目', 'キャンペーン再開に必要な次ステージ・得点・残機・ボム・武器・速度・フラグなどです。'],
  resumeRankingEligible: ['再開後もランキング対象', '保存地点から再開したプレイも上位10件の対象に含めます。'],
  sprite: ['表示スプライト', '表示に使用するResComp SPRITEとアニメーション行です。'],
  animation: ['入力アニメーション', 'ステージ方向と方向キー入力に応じたスプライト行切替です。'],
  axis: ['切替基準', 'stageは縦面で左右、横面で上下の入力を自動使用します。'],
  vertical: ['縦ステージ', '縦スクロール時の方向入力別アニメーション行です。'],
  horizontal: ['横ステージ', '横スクロール時の方向入力別アニメーション行です。'],
  negative: ['負方向入力', '左または上を押している間のアニメーション行です。'],
  neutral: ['入力なし', '方向キーを押していないときのアニメーション行です。'],
  positive: ['正方向入力', '右または下を押している間のアニメーション行です。'],
  speeds: ['3段階速度', '速度切替ボタンで循環する低速・通常・高速です。'],
  slow: ['低速', '低速時の自機移動速度です。'],
  normal: ['通常速度', '通常時の自機移動速度です。'],
  fast: ['高速', '高速時の自機移動速度です。'],
  unit: ['速度単位', '移動速度値の固定小数点単位です。'],
  initial: ['初期状態', 'ゲーム開始時の残機・ボム・武器・速度です。'],
  lives: ['初期残機', 'ゲーム開始時の自機残機数です。'],
  weaponId: ['武器', '使用・切替対象となる武器の安定IDです。'],
  speed: ['速度', '移動速度、弾速、または波打ちの進行速度です。'],
  hitbox: ['当たり判定', '中心からの相対位置と半径で表す円形の当たり判定です。'],
  x: ['X位置', '基準点からの横方向位置または相対的なずれです。'],
  y: ['Y位置', '基準点からの縦方向位置または相対的なずれです。'],
  radius: ['半径', '円形当たり判定の半径（ピクセル）です。'],
  lifetime: ['弾の寿命', '敵弾を自動的に消去するまでの最大フレーム数です。'],
  margin: ['画面外余白', '敵弾を画面外として消去する境界の外側余白（ピクセル）です。'],
  duplicateScore: ['同じ武器の再取得得点', '現在と同じ武器アイテムを取ったときに加算する得点です。'],
  intervalFrames: ['発射間隔', 'ショットを連射できる間隔（フレーム）です。'],
  angle: ['発射角度', '弾の進行角度です。ステージ方向を基準に解釈します。'],
  simultaneous: ['同時弾数', '1回のショットで同時に生成する弾数です。'],
  type: ['種類', 'この項目の動作種別です。'],
  amount: ['増加量', '取得時にボムなどへ加算する量です。'],
  score: ['得点', '撃破・取得時に加算する得点です。'],
  durationFrames: ['所要時間', '移動・演出・切替を完了するまでのフレーム数です。'],
  se: ['効果音', '再生するResComp WAVアセットです。'],
  placements: ['演出の配置', '爆発開始からの時刻と相対位置で複数の演出を並べます。'],
  frame: ['開始フレーム', 'イベント発火または演出再生を開始するフレームです。'],
  loop: ['繰り返す', '最後の移動点の後に先頭へ戻るか指定します。'],
  waypoints: ['移動点', '通過位置・所要フレーム・補間方法の一覧です。'],
  interpolation: ['補間方法', '2点間の移動やスクロール変化の仕方です。'],
  hp: ['耐久力', '破壊までに必要なダメージ量です。'],
  movementId: ['移動パターン', '使用する再利用可能な移動パターンの安定IDです。'],
  patternId: ['弾幕パターン', '実行するBulletMLパターンの安定IDです。'],
  drop: ['落下アイテム', '撃破時に落とすアイテムと確率です。'],
  itemId: ['アイテム', '落下または取得対象アイテムの安定IDです。'],
  chance: ['落下確率', 'アイテムを落とす確率です。0〜1で指定します。'],
  explosionId: ['爆発パターン', '破壊時に再生する爆発パターンの安定IDです。'],
  destructibleBackground: ['破壊可能背景', '有効にするとスクロールで消滅せず、ゲーム空間に固定された破壊対象として扱います。'],
  giantBackground: ['背景式巨大ボス', '有効にするとBG_Aタイルマップと追従部位で巨大ボスを表現します。'],
  giantBoss: ['巨大ボス設定', '背景面を使う巨大ボスのIDと、戦闘背景面・ボス表示面を指定します。'],
  parts: ['ボス部位', '個別の耐久力と当たり判定を持つ破壊可能なボス部位です。'],
  globalHpTransfer: ['本体HP転送率', '部位が受けたダメージのうちボス本体HPへ転送する割合（0〜1）です。'],
  followBackground: ['背景へ追従', '有効にすると部位位置をボス背景のスクロールへ追従させます。'],
  disableEventId: ['破壊時イベント', '部位破壊時に無効化・発火するイベント識別子です。'],
  phases: ['ボス段階', 'HP閾値順に切り替わる1〜8個のボス段階です。'],
  activeParts: ['有効なボス部位', 'この段階で当たり判定と耐久力を有効にするボス部位IDの一覧です。'],
  threshold: ['開始HP閾値', 'ボス残りHP率がこの値以下になると次の段階へ切り替わります。'],
  rankOverride: ['難度上書き', 'この段階だけ作品固定の$rankを上書きします。空なら作品設定値を使います。'],
  clearBullets: ['切替時に敵弾消去', '段階開始時に画面内の敵弾を消去します。'],
  backgroundId: ['背景', '使用または切替対象となる背景の安定IDです。'],
  arenaPlane: ['戦闘背景面', '巨大ボス戦の背景に専有するBG_AまたはBG_Bです。'],
  bossPlane: ['ボス表示面', '巨大ボスのタイルマップに専有するBG_AまたはBG_Bです。'],
  wave: ['波打ち演出', '背景面へ適用する波打ちパターンと範囲・強さです。'],
  preset: ['波打ち種類', '正弦波、二重正弦波、波紋、せん断、揺れから選びます。'],
  start: ['開始位置', '視差帯または波打ちを適用する範囲の開始座標です。'],
  end: ['終了位置', '視差帯または波打ちを適用する範囲の終了座標です。'],
  amplitude: ['振幅', '波打ちによる最大変位量です。'],
  wavelength: ['波長', '波打ちが1周期する座標間隔です。'],
  fadeFrames: ['フェード時間', '暗転／復帰または波打ちのフェードに使うフレーム数です。'],
  giantBossArena: ['巨大ボス専用画面', '有効にするとBG_Bを戦闘背景、BG_Aをボスタイルマップへ専有します。'],
  BG_A: ['背景A面（BG_A）', '前景側の面に使うマップ・視差帯・波打ち設定です。'],
  BG_B: ['背景B面（BG_B）', '後景側の面に使うマップ・視差帯・波打ち設定です。'],
  map: ['タイルマップ', '背景表示に使用するResComp MAP/TILEMAPです。'],
  collisionMap: ['衝突マップ', '地形の当たり判定に使うResComp MAP/TILEMAPと衝突レイヤーです。'],
  bands: ['視差帯', '範囲ごとに主スクロール倍率を変える最大8個の重ならない帯です。'],
  multiplier: ['スクロール倍率', '主カメラのスクロールへ掛ける倍率です。0で固定、1で等速です。'],
  transition: ['背景切替方式', '即時切替または、暗転・分割転送・復帰を行うフェード切替です。'],
  bgm: ['BGM', '背景またはステージで再生するResComp XGM2/VGMアセットです。'],
  solid: ['通行不可', '衝突対象がこの材質へ侵入できないようにします。'],
  masks: ['衝突対象', '自機、敵、自機弾、敵弾ごとに判定有無を指定します。'],
  player: ['自機に適用', '自機へこの当たり判定材質を適用します。'],
  enemy: ['敵に適用', '敵へこの当たり判定材質を適用します。'],
  playerShot: ['自機弾に適用', '自機弾へこの当たり判定材質を適用します。'],
  enemyShot: ['敵弾に適用', '敵弾へこの当たり判定材質を適用します。'],
  trigger: ['発火条件', 'フレーム、主カメラ位置、フラグ、ボス撃破などイベントを開始する条件です。'],
  action: ['実行内容', '条件成立時に実行する出現・背景・スクロール・フラグ・終了処理です。'],
  order: ['同フレーム実行順', '同じフレームで条件成立したイベントを処理する安定順です。'],
  spawnFrame: ['配置基準フレーム', '時間軸表示と従来の出現処理との互換に使うフレームです。'],
  enemyType: ['敵表示種別', 'プレビューで通常敵・砲台などを描き分ける種別です。'],
  enemyId: ['出現する敵', '敵出現イベントで使用する敵カタログの安定IDです。'],
  bossId: ['対象のボス', 'ボス出現・撃破条件・巨大ボス設定で使用するボスの安定IDです。'],
  dropItemId: ['落下アイテム', 'このイベントで撃破した敵が落とすアイテムの安定IDです。空なら落としません。'],
  flag: ['フラグ名', 'イベント条件・設定・ステージ分岐に使用する真偽フラグ名です。'],
  boss: ['ボスイベント', '有効にするとボス段階を持つイベントとして扱います。'],
  path: ['移動経路', 'ステージ内で通過する位置とフレームの一覧です。'],
  value: ['設定値', 'フラグやスクロールなどの実行内容へ渡す値です。'],
  operator: ['比較方法', 'フラグやスクロール条件を判定する比較演算です。'],
  scroll: ['主カメラ位置', 'イベントを発火させる主カメラのスクロール位置です。'],
  plane: ['対象の背景面', '背景処理を適用するBG_AまたはBG_Bです。'],
  next: ['次ステージ分岐', 'フラグ条件に応じた遷移先ステージの一覧です。'],
  equals: ['一致条件', 'フラグ値がこの真偽値と一致したとき遷移します。'],
  mainScroll: ['主スクロール', 'ステージ方向とカメラの基本スクロール設定です。'],
  orientation: ['ステージ方向', '縦または横スクロールを指定します。'],
  duration: ['ステージ長', 'ステージ全体の長さまたは制限フレームです。'],
  events: ['ステージイベント', '左のイベント一覧から選択して個別にGUI編集します。'],
  profile: ['内部実行プロファイル', 'BMLB ABIと実機上限から自動生成される内部設定です。通常は編集しません。'],
  entries: ['登録項目', '左の一覧から選択して個別にGUI編集します。'],
});

const ENUMS = Object.freeze({
  orientation: [['vertical', '縦スクロール'], ['horizontal', '横スクロール']],
  axis: [['stage', 'ステージ方向に合わせる'], ['horizontal', '左右入力'], ['vertical', '上下入力']],
  interpolation: [['step', '即時（step）'], ['linear', '一定速度（linear）'], ['smoothstep', '滑らか（smoothstep）']],
  preset: [['none', 'なし'], ['sine', '正弦波'], ['dual-sine', '二重正弦波'], ['ripple', '波紋'], ['shear', 'せん断'], ['jitter', '揺れ']],
  transition: [['cut', '即時切替'], ['fade', 'フェード切替']],
  type_item: [['weapon', '武器切替'], ['bomb', 'ボム補充'], ['score', '得点獲得']],
  speed_mode: [['slow', '低速'], ['normal', '通常'], ['fast', '高速']],
  reset_weapon: [['retain', '現在の武器を維持'], ['initial', '初期武器へ戻す']],
  reset_bombs: [['retain', '現在数を維持'], ['initial', '初期数へ補充']],
  button: [['A', 'Aボタン'], ['B', 'Bボタン'], ['C', 'Cボタン']],
  palette: [['PAL0', 'PAL0'], ['PAL1', 'PAL1'], ['PAL2', 'PAL2'], ['PAL3', 'PAL3']],
  plane: [['BG_A', 'BG_A（前景）'], ['BG_B', 'BG_B（後景）']],
  trigger_type: [['frame', '指定フレーム'], ['scroll', '主カメラ位置'], ['flag', 'フラグ条件'], ['boss_defeated', 'ボス撃破'], ['condition', '条件（フラグ／ボス撃破）']],
  action_type: [['spawn_enemy', '敵出現'], ['spawn_boss', 'ボス出現'], ['background', '背景切替'], ['set_background', '背景切替'], ['scroll', 'スクロール変更'], ['set_scroll', 'スクロール変更'], ['wave', '波打ち変更'], ['set_wave', '波打ち変更'], ['set_flag', 'フラグ設定'], ['clear_bullets', '敵弾消去'], ['stage_clear', 'ステージ終了']],
  operator: [['eq', '等しい'], ['ne', '等しくない'], ['gte', '以上'], ['lte', '以下']],
});

function listOptions(entries, allowNone = true) {
  const result = allowNone ? [{ value: '', label: 'なし' }] : [];
  return result.concat((entries || []).map((entry) => ({ value: entry.id, label: entry.name ? `${entry.name}（${entry.id}）` : entry.id })));
}

function catalog(snapshot, kind) {
  return snapshot?.collections?.[kind]?.entries || [];
}

function referenceOptions(key, snapshot) {
  if (key === 'weaponId') return listOptions(catalog(snapshot, 'weapons'));
  if (key === 'movementId') return listOptions(catalog(snapshot, 'movements'));
  if (key === 'patternId') return listOptions(snapshot?.patterns);
  if (key === 'backgroundId') return listOptions(catalog(snapshot, 'backgrounds'));
  if (key === 'enemyId') return listOptions(catalog(snapshot, 'enemies'));
  if (key === 'bossId') return listOptions(catalog(snapshot, 'bosses'));
  if (key === 'itemId' || key === 'dropItemId') return listOptions(catalog(snapshot, 'items'));
  if (key === 'effectId') return listOptions(catalog(snapshot, 'effects'));
  if (key === 'explosionId') return listOptions(catalog(snapshot, 'explosions'));
  if (key === 'stageId' || key === 'startStageId') return listOptions(snapshot?.stages, false);
  return null;
}

export function kindMeta(kind) {
  return ({
    project: ['作品設定', '作品全体の固定条件、収録モード、被弾時動作、ボムを設定します。'],
    pools: ['実行時上限', 'RAM・処理負荷を決める各種同時確保枠と1フレーム上限です。'],
    'game-flow': ['画面進行', 'タイトル、コンティニュー、名前入力、自動保存の進行設定です。'],
    input: ['操作設定', 'A/B/Cへの既定割当とSRAM保存規則です。'],
    save: ['SRAM・ランキング', '保存形式、上位10件、3文字名、再開後のランキング資格を設定します。'],
    player: ['プレイヤー', '1作品1人の自機スプライト、方向別アニメーション、速度、初期状態です。'],
    weapons: ['武器', '自機弾の発射間隔、威力、速度、発射口です。'],
    items: ['アイテム', '武器切替、ボム、得点アイテムの取得効果です。'],
    effects: ['共通演出', '共通スプライトアニメーションと効果音です。'],
    explosions: ['爆発パターン', '時刻・相対位置付きで複数の共通演出を並べます。'],
    movements: ['移動パターン', '敵・ボス・背景式巨大ボスで再利用する移動点の動きです。'],
    enemies: ['敵', '通常敵・破壊可能背景の耐久力、弾幕、落下アイテム、爆発です。'],
    bosses: ['ボス', '本体、破壊可能な部位、1〜8段階、背景演出を設定します。'],
    backgrounds: ['背景', 'BG_A/B、視差帯、波打ち、切替、BGMを設定します。'],
    'collision-materials': ['当たり判定材質', '通行不可・ダメージと対象別の衝突有無を設定します。'],
  })[kind] || [kind, `${kind}の設定です。`];
}

export function stgFieldMeta(path, value, key, { snapshot = null } = {}) {
  const name = String(key ?? path.at(-1) ?? '設定');
  const parentName = String(path.at(-2) ?? '');
  const arrayItem = typeof key === 'number' ? ({
    carry: ['持越し項目', '次ステージへ持ち越す状態です。'],
    patternOrder: ['弾幕パターン', 'この位置へ並べる弾幕パターンの安定IDです。'],
    screens: ['画面', '作品内の画面進行に含める画面です。'],
    remappable: ['変更可能な操作', 'オプション画面でボタンを変更できる操作です。'],
    buttons: ['ボタン', '操作割当に使用できるボタンです。'],
    campaignRanking: ['順位項目', 'キャンペーン順位表へ保存する値です。'],
    caravanRanking: ['順位項目', 'キャラバン順位表へ保存する値です。'],
    checkpoint: ['保存項目', '再開地点へ保存する値です。'],
    activeParts: ['ボス部位', 'この段階で有効にするボス部位の安定IDです。'],
  })[parentName] : null;
  const base = arrayItem || FIELD_META[name] || [name, `${name}の値です。内部保存キーは変更されません。`];
  const meta = { label: base[0], help: base[1] };
  if (name === 'schemaVersion' || name === 'kind' || name === 'profile' || name === 'entries' || name === 'events' || name === 'paletteFingerprint' || name === 'tileCount' || path.map(String).includes('profile')) meta.hidden = true;
  if (name === 'id' && path.length <= 3) meta.readonly = true;
  const joined = path.map(String).join('.');
  const refs = referenceOptions(name, snapshot);
  if (refs) meta.options = refs;
  if (typeof key === 'number' && parentName === 'carry') meta.options = [['score', '得点'], ['lives', '残機'], ['bombs', 'ボム'], ['weapon', '武器'], ['speed', '速度']].map(([optionValue, label]) => ({ value: optionValue, label }));
  else if (typeof key === 'number' && parentName === 'patternOrder') meta.options = listOptions(snapshot?.patterns, false);
  else if (typeof key === 'number' && parentName === 'screens') meta.options = ['title', 'mode-select', 'options', 'gameplay', 'pause', 'result', 'continue', 'game-over', 'name-entry', 'ranking'].map((optionValue) => ({ value: optionValue, label: ({ title: 'タイトル', 'mode-select': 'モード選択', options: '操作設定', gameplay: 'ゲーム本編', pause: '一時停止', result: '結果', continue: 'コンティニュー', 'game-over': 'ゲームオーバー', 'name-entry': '名前入力', ranking: 'ランキング' })[optionValue] }));
  else if (typeof key === 'number' && parentName === 'remappable') meta.options = [['shot', 'ショット'], ['bomb', 'ボム'], ['speedShift', '速度切替']].map(([optionValue, label]) => ({ value: optionValue, label }));
  else if (typeof key === 'number' && parentName === 'buttons') meta.options = ENUMS.button;
  else if (typeof key === 'number' && parentName === 'campaignRanking') meta.options = [['score', '得点'], ['stagesCleared', 'クリアしたステージ数'], ['playFrames', 'プレイ時間']].map(([optionValue, label]) => ({ value: optionValue, label }));
  else if (typeof key === 'number' && parentName === 'caravanRanking') meta.options = [['score', '得点'], ['remainingFrames', '残り時間']].map(([optionValue, label]) => ({ value: optionValue, label }));
  else if (typeof key === 'number' && parentName === 'checkpoint') meta.options = [['nextStageId', '次のステージ'], ['score', '得点'], ['lives', '残機'], ['bombs', 'ボム'], ['weaponId', '武器'], ['speed', '速度'], ['flags', 'キャンペーンフラグ'], ['stagesCleared', 'クリア数']].map(([optionValue, label]) => ({ value: optionValue, label }));
  else if (typeof key === 'number' && parentName === 'activeParts') {
    const partIds = [...new Set(catalog(snapshot, 'bosses').flatMap((boss) => (boss.parts || []).map((part) => part.id)))];
    meta.options = partIds.map((partId) => ({ value: partId, label: partId }));
  }
  if (name === 'orientation') meta.options = ENUMS.orientation;
  else if (name === 'axis') meta.options = ENUMS.axis;
  else if (name === 'interpolation') meta.options = ENUMS.interpolation;
  else if (name === 'preset') meta.options = ENUMS.preset;
  else if (name === 'transition') meta.options = ENUMS.transition;
  else if (name === 'palette') meta.options = ENUMS.palette;
  else if (name === 'plane' || name === 'arenaPlane' || name === 'bossPlane') meta.options = ENUMS.plane;
  else if (name === 'operator') meta.options = ENUMS.operator;
  else if (name === 'type' && joined.includes('trigger')) meta.options = ENUMS.trigger_type;
  else if (name === 'type' && joined.includes('action')) meta.options = ENUMS.action_type;
  else if (name === 'type' && joined.includes('items')) meta.options = ENUMS.type_item;
  else if (name === 'shot' || name === 'bomb' || name === 'speedShift') meta.options = ENUMS.button;
  else if (name === 'weapon' && joined.includes('resetOnHit')) meta.options = ENUMS.reset_weapon;
  else if (name === 'bombs' && joined.includes('resetOnHit')) meta.options = ENUMS.reset_bombs;
  else if (name === 'speed' && (joined.includes('initial') || joined.includes('resetOnHit'))) meta.options = ENUMS.speed_mode;
  if (name === 'drop') meta.nullable = true;
  if (name === 'rankOverride') { meta.type = 'number'; meta.allowNull = true; }
  if (['rank', 'rankOverride', 'chance', 'globalHpTransfer'].includes(name)) { meta.min = 0; meta.max = 1; meta.step = 0.05; }
  if (name === 'threshold') { meta.min = 0; meta.max = 100; meta.step = 1; meta.suffix = '%'; }
  if (['frame', 'durationFrames', 'intervalFrames', 'fadeFrames', 'invincibleFrames', 'timeLimitFrames', 'titleFrames', 'continueFrames'].includes(name)) meta.suffix = 'フレーム';
  if (Array.isArray(value)) {
    meta.itemLabel = ({
      emitters: '発射口', placements: '配置', waypoints: '移動点', parts: '部位',
      phases: '段階', bands: '視差帯', path: '経路点', next: '分岐',
    })[name] || '項目';
  }
  return meta;
}

const ARRAY_TEMPLATES = Object.freeze({
  emitters: { x: 0, y: -8, angle: 0 },
  placements: { frame: 0, x: 0, y: 0, effectId: '' },
  waypoints: { x: 0, y: 0, durationFrames: 60, interpolation: 'linear' },
  parts: { id: 'part', hp: 10, hitbox: { x: 0, y: 0, radius: 8 }, globalHpTransfer: 1, explosionId: '', followBackground: false, disableEventId: '' },
  phases: { threshold: 100, patternId: '', movementId: '', rankOverride: 0.5, clearBullets: true, backgroundId: '', wave: { preset: 'none', start: 0, end: 223, amplitude: 0, wavelength: 32, speed: 0, fadeFrames: 0 } },
  bands: { start: 0, end: 223, multiplier: 1 },
  path: { frame: 0, x: 160, y: 0, interpolation: 'linear' },
  next: { flag: '', equals: true, stageId: '' },
  drop: { itemId: '', chance: 1 },
});

export function stgArrayTemplate(path, array) {
  const key = String(path.at(-1) ?? '');
  if (ARRAY_TEMPLATES[key]) return ARRAY_TEMPLATES[key];
  if (array?.length) return undefined;
  return {};
}

export function japaneseValue(value) {
  return ({
    vertical: '縦', horizontal: '横', none: 'なし', normal: '通常', slow: '低速', fast: '高速',
    ready: '待機中', campaign: 'キャンペーン', caravan: 'キャラバン',
    spawn_enemy: '敵出現', spawn_boss: 'ボス出現', stage_clear: 'ステージ終了',
  })[value] || value;
}

export function commandMeta(op) {
  return ({
    fire: ['弾を発射', '方向・速度・弾定義（Bullet）を使って弾を生成します。'],
    wait: ['待機', '指定フレームの間、この動作定義の次命令を待ちます。'],
    repeat: ['繰り返し', '内包する動作または参照先の動作を指定回数繰り返します。'],
    vanish: ['消滅', 'この弾を画面から削除します。'],
    changeDirection: ['方向変更', '指定期間で弾の進行方向を変更します。'],
    changeSpeed: ['速度変更', '指定期間で弾の速度を変更します。'],
    actionRef: ['動作参照（Action）', '別の動作定義を呼び出します。'],
    fireRef: ['発射参照（Fire）', '別の発射定義を呼び出します。'],
  })[op] || [op, `${op}命令です。`];
}

export function definitionMeta(kind) {
  return ({
    action: ['動作（Action）', '命令列をまとめ、開始動作や他の定義から呼び出します。'],
    fire: ['発射（Fire）', '方向・速度と弾定義の組合せを再利用します。'],
    bullet: ['弾（Bullet）', '弾自身の方向・速度・実行する動作を定義します。'],
  })[kind] || [kind, `${kind}定義です。`];
}

const PATTERN_FIELD_META = Object.freeze({
  op: ['命令の種類', 'この命令が行う処理です。種類を変える場合は命令を削除して追加し直します。'],
  direction: ['方向', '弾の発射方向または進行方向です。'],
  speed: ['速度', '弾の発射速度または進行速度です。'],
  type: ['指定方法', '狙い、絶対値、相対値、連続差分のどれとして値を解釈するか指定します。'],
  value: ['値・式', '数値、$rank、$rand、$1〜$4を組み合わせた式を指定できます。'],
  term: ['変化時間', '方向・速度を目標値まで変化させるフレーム数です。'],
  times: ['繰り返し回数', '内包する動作または参照先の動作を繰り返す回数です。'],
  action: ['実行する動作', '繰り返し命令が実行する内包動作または参照先です。'],
  bullet: ['発射する弾', '発射命令が生成する簡易弾または弾定義の参照です。'],
  ref: ['参照先', '呼び出す弾幕定義の名前です。右上の参照接続からも選択できます。'],
  params: ['引数', '参照先の$1〜$4へ左から順に渡す値・式です。最大4件です。'],
  inline: ['内包設定', 'この命令内に直接保存する方向・速度・動作設定です。'],
  commands: ['内包命令', '中央の構造化フローで追加・削除・並べ替えます。'],
  actions: ['弾の動作', '中央の弾設定で追加・削除・編集します。'],
});

export function patternFieldMeta(path, value, key) {
  const name = String(key ?? path.at(-1) ?? '設定');
  const base = PATTERN_FIELD_META[name] || [typeof key === 'number' ? `引数${Number(key) + 1}` : name, `${name}の設定です。`];
  const meta = { label: base[0], help: base[1] };
  const joined = path.map(String).join('.');
  if (name === 'op' || name === 'commands' || name === 'actions') meta.hidden = true;
  if ((name === 'direction' || name === 'speed') && joined.includes('inline')) meta.nullable = true;
  if (name === 'type' && joined.includes('direction')) {
    meta.options = [['aim', '自機狙い'], ['absolute', '絶対角'], ['relative', '相対角'], ['sequence', '連続差分']].map(([optionValue, label]) => ({ value: optionValue, label }));
  } else if (name === 'type' && joined.includes('speed')) {
    meta.options = [['absolute', '絶対速度'], ['relative', '相対速度'], ['sequence', '連続差分']].map(([optionValue, label]) => ({ value: optionValue, label }));
  }
  if (name === 'term') meta.suffix = 'フレーム';
  if (name === 'params') meta.itemLabel = '引数';
  return meta;
}

export function patternArrayTemplate(path) {
  const name = String(path.at(-1) || '');
  if (name === 'params') return '0';
  if (name === 'direction') return { type: 'absolute', value: '0' };
  if (name === 'speed') return { type: 'absolute', value: '1.5' };
  return undefined;
}
