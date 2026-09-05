export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatJson(value) { return JSON.stringify(value, null, 2); }

export function optionList(values, selected, labels = {}) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

const V2_TABS = Object.freeze([
  ['project', '作品設定', '作品全体・画面進行・入力・SRAMを設定します。'],
  ['player', 'プレイヤー', '自機スプライト、方向別アニメーション、速度、初期状態を設定します。'],
  ['weapons', '武器', '自機弾の発射間隔・威力・速度・発射口を設定します。'],
  ['items', 'アイテム', '武器切替、ボム補充、得点アイテムを設定します。'],
  ['effects', '演出', '共通演出と爆発パターンを設定します。'],
  ['movement', '移動', '敵・ボスで再利用する移動点の動きを設定します。'],
  ['enemies', '敵', '通常敵・破壊可能背景の耐久力、弾幕、落下アイテムを設定します。'],
  ['bosses', 'ボス', 'ボス本体、部位、1〜8段階、背景演出を設定します。'],
  ['backgrounds', '背景・衝突', '背景面、視差、波打ち、背景切替、当たり判定を設定します。'],
  ['stages', 'ステージ', 'ステージイベント、経路、ボス出現とプレビューを編集します。'],
  ['demos', 'デモ', 'ステージ間のVNシーンと画面進行への割当を編集します。'],
  ['patterns', '弾幕', 'BulletMLパターンを構造化編集し、実行プレビューします。'],
  ['diagnostics', '診断', 'ビルドを止める問題と実機資源の上限を確認します。'],
]);

function genericPage(page, title, description, kinds, collection = true) {
  return `<section class="bml-page bml-v2-page" data-section="${page}" data-v2-page="${page}" data-v2-kinds="${kinds.join(',')}" data-v2-collection="${collection ? 'true' : 'false'}">
    <header class="bml-v2-toolbar"><div><strong>${title}</strong><small>${description}</small></div><label title="このタブ内で編集する設定分類を切り替えます">設定分類 <select data-v2-kind></select></label><button data-v2-action="add" ${collection ? '' : 'hidden'} title="同じ種類の新しい登録項目を追加します">＋追加</button><button data-v2-action="delete" ${collection ? '' : 'hidden'} title="選択項目を復元可能な削除済み領域へ退避します">削除</button><button data-v2-action="save" class="primary" title="この設定分類の変更を保存します">保存</button></header>
    <div class="bml-v2-workspace">
      <aside><div class="bml-pane-title"><strong data-v2-list-title>${collection ? '登録項目' : '設定一覧'}</strong><output data-v2-count></output></div><div class="bml-v2-list" data-v2-list></div><details><summary title="削除時に退避した項目を確認・復元します">削除済み</summary><div class="bml-v2-deleted" data-v2-deleted></div></details></aside>
      <main><div class="bml-v2-summary" data-v2-summary></div><p class="bml-form-guide">各項目はGUIで編集できます。<span class="structured-help" title="ラベル横の？へマウスを置くと、用途・単位・影響を表示します。" tabindex="0">?</span></p><div class="bml-v2-fields" data-v2-fields></div><details class="bml-v2-advanced"><summary title="通常は開く必要がありません。外部生成データの確認や一括修正に使います">上級者向け：内部JSON</summary><label class="bml-v2-json-label">内部データ<textarea spellcheck="false" data-v2-json></textarea></label><div class="bml-inline"><button data-v2-action="apply" title="入力したJSONを検証し、GUIの編集中データへ反映します">JSONをGUIへ反映</button><output data-v2-error></output></div></details></main>
      <aside class="bml-v2-assets"><div class="bml-pane-title"><strong>使用アセット</strong></div><p class="bml-form-guide">アセットを選ぶと自動的にプレビューします。</p><div data-v2-assets></div><div class="bml-v2-preview" data-v2-preview><p>アセットを選択すると、ここへ自動的にプレビューします。</p></div></aside>
    </div>
  </section>`;
}

export function buildShell() {
  return `<div class="bml-layout">
    <header class="bml-toolbar">
      <div class="bml-brand"><strong>BulletML STG Studio</strong><span>BMLB ABI v1 · MD H40 320×224 · 60Hz</span><em data-role="dirty"></em></div>
      <div class="bml-toolbar-actions"><button data-action="undo" title="直前の弾幕編集を取り消します">↶ 元に戻す</button><button data-action="redo" title="取り消した弾幕編集をやり直します">↷ やり直す</button><button data-action="save" class="primary" title="現在の全タブの変更を保存します">保存</button><button data-action="validate" title="データ形式・参照先・実機資源上限を検証します">検証</button><button data-action="stress" title="難度0／0.5／1、複数の乱数初期値・向きで負荷検証します">27条件の負荷検証</button></div>
    </header>
    <nav class="bml-page-tabs">${V2_TABS.map(([id, label, help], index) => `<button data-page="${id}" class="${index === 0 ? 'active' : ''}" title="${escapeHtml(help)}">${label}</button>`).join('')}</nav>
    ${genericPage('project', '作品設定・画面進行', '固定環境、同時数上限、収録モード、入力、SRAMと引継ぎ規則', ['project', 'pools', 'game-flow', 'input', 'save'], false)}
    ${genericPage('player', 'プレイヤー', '1作品1人、自機画像、方向別アニメーション、3段階速度、被弾時の初期化と当たり判定', ['player'], false)}
    ${genericPage('weapons', '武器', '自機弾専用の同時数枠、発射間隔、威力、速度、角度、同時弾数', ['weapons'])}
    ${genericPage('items', 'アイテム', '武器切替、ボム、得点アイテム、同じ武器を再取得したときの得点', ['items'])}
    ${genericPage('effects', '演出・爆発', '共通スプライトアニメーションと、時刻・相対位置付き爆発パターン', ['effects', 'explosions'])}
    ${genericPage('movement', '移動ライブラリ', '移動点、所要フレーム、補間、繰り返しを再利用', ['movements'])}
    ${genericPage('enemies', '敵・破壊可能背景', '耐久力、移動、BulletML弾幕、落下アイテム、爆発、効果音', ['enemies'])}
    ${genericPage('bosses', 'ボス', '1〜8段階、破壊可能な部位、背景、難度上書き、巨大ボス追従', ['bosses'])}
    ${genericPage('backgrounds', '背景・衝突', '背景2面（BG_A/B）の視差帯、スクロール、波打ち、切替、当たり判定材質', ['backgrounds', 'collision-materials'])}
    <section class="bml-page active" data-section="patterns">
      <div class="bml-pattern-workspace" data-role="pattern-workspace">
        <aside class="bml-pane bml-left-pane">
          <div class="bml-pane-title"><strong>弾幕パターン</strong><button data-action="new-pattern" title="左下で選んだ雛形から新しい弾幕パターンを作成">＋</button></div>
          <div class="bml-new-row"><select data-role="template"><option value="blank">空白</option><option value="aimed">狙い撃ち</option><option value="fan">扇</option><option value="rotation">回転</option><option value="rank">難度変化（$rank）</option><option value="rand">ランダム散弾（$rand）</option><option value="speed">速度変更</option><option value="turn">旋回</option><option value="split">子弾分裂</option><option value="reference">参照接続サンプル</option></select></div>
          <div class="bml-filter-row">
            <input data-role="pattern-filter" type="search" placeholder="名前 / IDを絞り込み" aria-label="弾幕パターンを絞り込み" title="表示する弾幕パターンを名前または安定IDで絞り込みます">
            <select data-role="pattern-type-filter" aria-label="パターン方向で絞り込み" title="縦用・横用・方向非依存で絞り込みます"><option value="all">すべて</option><option value="none">方向非依存</option><option value="vertical">縦用</option><option value="horizontal">横用</option></select>
            <output data-role="pattern-count"></output>
          </div>
          <div class="bml-pattern-list" data-role="pattern-list"></div>
          <div class="bml-pattern-properties">
            <label title="一覧に表示する弾幕名です。安定IDは変わりません">パターン名 <input data-role="pattern-name"></label>
            <div><label title="この弾幕を縦面・横面のどちら向けとして扱うか指定します">方向 <select data-role="pattern-type"><option value="none">方向非依存</option><option value="vertical">縦用</option><option value="horizontal">横用</option></select></label><button data-action="apply-pattern-metadata" title="入力した名前と方向を編集中データへ反映">名前・方向を反映</button></div>
            <small>安定ID: <code data-role="pattern-id">-</code></small>
          </div>
          <details class="bml-pattern-settings" open>
            <summary title="敵弾の画像、パレット、コマ寸法、当たり判定、寿命と画面外余白を編集します">弾の表示・当たり判定</summary>
            <div data-role="pattern-settings-form" class="bml-pattern-settings-form"></div>
            <div data-role="pattern-assets" class="bml-pattern-assets"></div>
            <div data-role="pattern-asset-preview" class="bml-v2-preview bml-pattern-asset-preview"></div>
          </details>
          <div class="bml-pane-title"><strong>弾幕定義</strong><div><button data-action="add-definition" data-kind="action" title="命令列をまとめる動作定義（Action）を追加">動作＋</button><button data-action="add-definition" data-kind="fire" title="発射条件をまとめる発射定義（Fire）を追加">発射＋</button><button data-action="add-definition" data-kind="bullet" title="弾自身の動作をまとめる弾定義（Bullet）を追加">弾＋</button></div></div>
          <div class="bml-definition-filter"><label title="表示する定義種別を絞り込みます">表示 <select data-role="definition-filter"><option value="all">すべて</option><option value="action">動作（Action）</option><option value="fire">発射（Fire）</option><option value="bullet">弾（Bullet）</option></select></label><output data-role="definition-count"></output><small>行をクリックすると編集対象が切り替わります</small></div>
          <div class="bml-definition-list" data-role="definition-list"></div>
          <details class="bml-deleted"><summary>削除済み</summary><div data-role="deleted-list"></div></details>
        </aside>
        <div class="bml-resizer vertical" data-resize="left" aria-label="左pane幅"></div>
        <main class="bml-center-pane">
          <section class="bml-edit-pane">
            <div class="bml-pane-title bml-view-toolbar"><strong data-role="edit-title">構造化フロー</strong><div><button data-view="structured" class="active" title="フォームと命令列で編集">構造化</button><button data-view="graph" title="定義間の参照を接続図で確認">接続図</button><select data-role="command-kind" title="追加する命令の種類"><option value="fire">弾を発射</option><option value="wait">待機</option><option value="repeat">繰り返し</option><option value="vanish">消滅</option><option value="changeDirection">方向変更</option><option value="changeSpeed">速度変更</option><option value="actionRef">動作を参照</option><option value="fireRef">発射を参照</option></select><button data-action="add-command" title="選択中の定義へ命令を追加">命令＋</button><button data-action="move-command" data-delta="-1" title="選択命令を上へ">↑</button><button data-action="move-command" data-delta="1" title="選択命令を下へ">↓</button><button data-action="delete-command" title="選択命令を削除">命令×</button></div></div>
            <div class="bml-structured active" data-role="structured"></div>
            <div class="bml-graph" data-role="graph"><svg data-role="graph-svg"><g data-role="graph-edges"></g></svg><div class="bml-graph-nodes" data-role="graph-nodes"></div></div>
          </section>
          <div class="bml-resizer horizontal" data-resize="preview" aria-label="プレビュー高さ"></div>
          <section class="bml-preview-pane">
            <div class="bml-pane-title bml-preview-toolbar"><strong>コンパイル結果プレビュー</strong><div><button data-action="preview-reset" title="先頭フレームへ戻す">|◀</button><button data-action="preview-step" title="1フレーム進める">▶|</button><button data-action="preview-play" data-role="play" title="再生／一時停止">▶</button><label class="bml-toggle" title="末尾まで再生したら先頭へ戻ります"><input data-role="preview-loop" type="checkbox" checked> 繰り返し</label><label title="BulletMLの$rankへ渡すプレビュー用難度係数">難度 <input data-role="rank" type="range" min="0" max="1" step="0.05" value="0.5"></label><label title="同じ値なら$randの結果を再現できます">乱数初期値 <input data-role="seed" value="0xACE1"></label><label title="縦面・横面で弾の画面外判定を切り替えます">向き <select data-role="orientation"><option value="vertical">縦</option><option value="horizontal">横</option></select></label></div></div>
            <div class="bml-preview-body"><div class="bml-screen"><canvas width="320" height="224" data-role="preview"></canvas><span>発射元／自機はドラッグで移動</span></div><div class="bml-preview-info"><input data-role="frame" type="range" min="0" max="0" value="0" title="表示するフレーム"><div data-role="metrics"></div><canvas width="224" height="54" data-role="heatmap" title="走査線ごとのスプライト負荷"></canvas></div></div>
          </section>
        </main>
        <div class="bml-resizer vertical" data-resize="right" aria-label="右pane幅"></div>
        <aside class="bml-pane bml-right-pane">
          <nav class="bml-side-tabs"><button data-side="inspector" class="active" title="選択命令の式や参照を編集">選択項目</button><button data-side="diagnostics" title="データ形式・参照エラーを表示">診断</button><button data-side="xml" title="BulletML XMLの生成・再取込">XML</button></nav>
          <section class="bml-side-section active" data-side-section="inspector">
            <div data-role="selection-label" class="bml-selection"></div>
            <div data-role="command-form" class="bml-command-form"></div>
            <fieldset class="bml-expression"><legend title="BulletML式を分解して安全に編集します">式フォーム</legend><label title="選択命令内で編集する式">対象 <select data-role="expression-path"></select></label><div class="bml-affine"><input data-role="expr-constant" type="number" step="0.01" value="0" title="定数項"><span>＋</span><input data-role="expr-coefficient" type="number" step="0.01" value="1" title="変数へ掛ける係数"><span>×</span><select data-role="expr-variable" title="使用するBulletML変数"><option value="">なし</option><option>$rank</option><option>$rand</option><option>$1</option><option>$2</option><option>$3</option><option>$4</option></select></div><label title="定数・$rank・$rand・$1〜$4を使う詳細式">詳細式 <input data-role="expr-advanced"></label><button data-action="apply-expression" title="式を選択命令へ反映">式を適用</button><output data-role="expr-diagnostic"></output></fieldset>
            <fieldset class="bml-ref-connector"><legend title="別の弾幕定義へ安全に参照接続します">参照接続</legend><div><label>定義種別 <select data-role="ref-kind"></select></label><label>接続先 <select data-role="ref-target"></select></label></div><button data-action="connect-ref" title="選択命令を指定した弾幕定義へ接続">選択命令へ接続</button><output data-role="ref-diagnostic"></output></fieldset>
            <details class="bml-v2-advanced"><summary title="通常は構造化フローと式フォームを使ってください">上級者向け：選択項目JSON</summary><textarea data-role="inspector" spellcheck="false"></textarea><button data-action="apply-inspector" class="primary" title="JSONを検証して選択項目へ反映">JSONを選択項目へ反映</button></details>
          </section>
          <section class="bml-side-section" data-side-section="diagnostics"><div data-role="diagnostics"></div></section>
          <section class="bml-side-section" data-side-section="xml"><div class="bml-xml-actions"><button data-action="refresh-xml">生成</button><button data-action="copy-xml">コピー</button><button data-action="reimport-xml">検証して再取込</button></div><textarea data-role="xml" spellcheck="false"></textarea><pre data-role="sidecar"></pre></section>
        </aside>
      </div>
    </section>
    <section class="bml-page" data-section="stages">
      <div class="bml-stage-toolbar"><label title="編集するステージを切り替えます">ステージ <select data-role="stage-select"></select></label><span data-role="stage-orientation-label"></span><button data-action="new-stage" title="GUIで編集する新しいステージを追加します">ステージ＋</button><button data-action="delete-stage" title="現在のステージを復元可能な削除済み領域へ退避します">ステージ削除</button><details class="bml-stage-deleted"><summary title="削除時に退避したステージを一覧から復元します">削除済み</summary><div data-role="stage-deleted-list"></div></details><button data-action="add-event" title="条件と実行内容を持つ通常イベントを追加">イベント＋</button><button data-action="add-boss" title="1〜8段階を持つボスイベントを追加">ボス＋</button><button data-action="save-stage" class="primary" title="現在のステージを保存">ステージ保存</button><div class="bml-path-toggle"><small>経路表示</small><button data-path-mode="selected" class="active" title="選択イベントの経路だけ表示">選択のみ</button><button data-path-mode="all" title="全イベントの経路を表示">すべて</button></div><span>安定ID・明示的なステージ終了・ボス最大8段階</span></div>
      <div class="bml-stage-workspace">
        <aside class="bml-pane"><div class="bml-pane-title"><strong>イベント一覧</strong></div><div data-role="event-list" class="bml-event-list"></div></aside>
        <main><div data-role="timeline" class="bml-timeline"></div><div class="bml-screen stage"><canvas width="320" height="224" data-role="stage-preview"></canvas></div><input data-role="stage-frame" type="range" min="0" max="3600" value="0" title="プレビューするステージのフレーム"><div class="bml-stage-controls"><button data-action="stage-reset" title="ステージプレビューを先頭へ戻す">|◀</button><button data-action="stage-step" title="1フレーム進める">▶|</button><button data-action="stage-play" data-role="stage-play" title="再生／一時停止">▶</button><label title="実行時に使用する作品固定の$rank">固定難度 <output data-role="stage-rank">0.5</output></label><label title="同じ値なら乱数結果を再現できます">乱数初期値 <input data-role="stage-seed" value="0xACE1"></label><span data-role="stage-metrics"></span><small>矢印: 移動 / Z: ショット / X: ボム / C: 速度切替 / Enter: 一時停止</small></div></main>
        <aside class="bml-pane bml-stage-inspector"><div class="bml-pane-title"><strong>ステージ基本設定</strong></div><p class="bml-form-guide">名前、向き、長さ、背景、衝突マップ、次ステージ分岐をGUIで編集します。</p><div data-role="stage-settings-form" class="bml-stage-settings-form"></div><div data-role="stage-assets" class="bml-stage-assets"></div><div data-role="stage-asset-preview" class="bml-v2-preview bml-stage-asset-preview"></div><div class="bml-pane-title"><strong>イベント・経路・ボス段階</strong></div><p class="bml-form-guide">選択イベントをGUIで編集します。ラベル横の？に説明があります。</p><div data-role="stage-form" class="bml-stage-form"></div><details class="bml-v2-advanced"><summary>上級者向け：イベントJSON</summary><textarea data-role="stage-inspector" spellcheck="false"></textarea><button data-action="apply-stage-inspector" title="JSONを検証して選択イベントへ反映">JSONをGUIへ反映</button></details><div class="bml-inline"><button data-action="add-waypoint" title="移動経路へ移動点を追加">移動点＋</button><button data-action="remove-phase" title="最後のボス段階を削除">段階−</button><button data-action="add-phase" title="ボス段階を追加（最大8）">段階＋</button><button data-action="delete-event" title="選択イベントを削除">削除</button></div><div data-role="phase-summary" class="bml-phase-summary"></div><div data-role="stage-diagnostics"></div></aside>
      </div>
    </section>
    <section class="bml-page bml-demos-page" data-section="demos"><header class="bml-v2-toolbar"><div><strong>ステージ間デモ</strong><small>共通ノベルシーン · オープニング / ステージ前後 / エンディングへの割当</small></div><button data-action="save-demo" class="primary" title="シーン内容と画面進行への割当を保存">シーンと割当を保存</button></header><div data-role="vn-editor-mount" class="bml-vn-mount"></div></section>
    <section class="bml-page bml-project-diagnostics" data-section="diagnostics"><header class="bml-v2-toolbar"><div><strong>診断</strong><small>データ形式、アセット、ステージ分岐、実行時ID、実機資源上限のビルド判定</small></div><button data-action="validate" title="現在の保存データを再検証">再検証</button><button data-action="stress" title="難度0／0.5／1と複数条件で負荷検証">負荷検証</button></header><div data-role="project-diagnostics"></div></section>
    <footer class="bml-status" data-role="status">読込待ち</footer>
  </div>`;
}
