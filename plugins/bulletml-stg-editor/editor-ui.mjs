export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatJson(value) { return JSON.stringify(value, null, 2); }

export function optionList(values, selected, labels = {}) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

export function buildShell() {
  return `<div class="bml-layout">
    <header class="bml-toolbar">
      <div class="bml-brand"><strong>BulletML STG Studio</strong><span>BMLB ABI v1 · MD H40 320×224 · 60Hz</span><em data-role="dirty"></em></div>
      <div class="bml-toolbar-actions"><button data-action="undo">↶ Undo</button><button data-action="redo">↷ Redo</button><button data-action="save" class="primary">保存</button><button data-action="validate">検証</button><button data-action="stress">27ケース負荷検証</button></div>
    </header>
    <nav class="bml-page-tabs"><button data-page="patterns" class="active">Patterns</button><button data-page="stages">Stages</button></nav>
    <section class="bml-page active" data-section="patterns">
      <div class="bml-pattern-workspace" data-role="pattern-workspace">
        <aside class="bml-pane bml-left-pane">
          <div class="bml-pane-title"><strong>Patterns</strong><button data-action="new-pattern">＋</button></div>
          <div class="bml-new-row"><select data-role="template"><option value="blank">空白</option><option value="aimed">狙い撃ち</option><option value="fan">扇</option><option value="rotation">回転</option><option value="rank">rank変化</option><option value="rand">rand散弾</option><option value="speed">速度変更</option><option value="turn">旋回</option><option value="split">子弾分裂</option></select></div>
          <div class="bml-pattern-list" data-role="pattern-list"></div>
          <div class="bml-pane-title"><strong>Definitions</strong><div><button data-action="add-definition" data-kind="action">A＋</button><button data-action="add-definition" data-kind="fire">F＋</button><button data-action="add-definition" data-kind="bullet">B＋</button></div></div>
          <div class="bml-definition-list" data-role="definition-list"></div>
          <details class="bml-deleted"><summary>削除済み</summary><div data-role="deleted-list"></div></details>
        </aside>
        <div class="bml-resizer vertical" data-resize="left" aria-label="左pane幅"></div>
        <main class="bml-center-pane">
          <section class="bml-edit-pane">
            <div class="bml-pane-title bml-view-toolbar"><strong data-role="edit-title">構造化フロー</strong><div><button data-view="structured" class="active">構造化</button><button data-view="graph">Graph</button><select data-role="command-kind"><option>fire</option><option>wait</option><option>repeat</option><option>vanish</option><option>changeDirection</option><option>changeSpeed</option><option>actionRef</option><option>fireRef</option></select><button data-action="add-command">命令＋</button><button data-action="move-command" data-delta="-1" title="選択命令を上へ">↑</button><button data-action="move-command" data-delta="1" title="選択命令を下へ">↓</button><button data-action="delete-command" title="選択命令を削除">命令×</button></div></div>
            <div class="bml-structured active" data-role="structured"></div>
            <div class="bml-graph" data-role="graph"><svg data-role="graph-svg"><g data-role="graph-edges"></g></svg><div class="bml-graph-nodes" data-role="graph-nodes"></div></div>
          </section>
          <div class="bml-resizer horizontal" data-resize="preview" aria-label="Preview高さ"></div>
          <section class="bml-preview-pane">
            <div class="bml-pane-title bml-preview-toolbar"><strong>Compiled BMLB Preview</strong><div><button data-action="preview-reset">|◀</button><button data-action="preview-step">▶|</button><button data-action="preview-play" data-role="play">▶</button><label>rank <input data-role="rank" type="range" min="0" max="1" step="0.05" value="0.5"></label><label>seed <input data-role="seed" value="0xACE1"></label><label>向き <select data-role="orientation"><option value="vertical">縦</option><option value="horizontal">横</option></select></label></div></div>
            <div class="bml-preview-body"><div class="bml-screen"><canvas width="320" height="224" data-role="preview"></canvas><span>emitter / playerをdrag</span></div><div class="bml-preview-info"><input data-role="frame" type="range" min="0" max="0" value="0"><div data-role="metrics"></div><canvas width="224" height="54" data-role="heatmap"></canvas></div></div>
          </section>
        </main>
        <div class="bml-resizer vertical" data-resize="right" aria-label="右pane幅"></div>
        <aside class="bml-pane bml-right-pane">
          <nav class="bml-side-tabs"><button data-side="inspector" class="active">Inspector</button><button data-side="diagnostics">診断</button><button data-side="xml">XML</button></nav>
          <section class="bml-side-section active" data-side-section="inspector">
            <div data-role="selection-label" class="bml-selection"></div>
            <textarea data-role="inspector" spellcheck="false"></textarea>
            <button data-action="apply-inspector" class="primary">Inspectorを適用</button>
            <fieldset class="bml-expression"><legend>式フォーム</legend><label>対象 <select data-role="expression-path"></select></label><div class="bml-affine"><input data-role="expr-constant" type="number" step="0.01" value="0"><span>＋</span><input data-role="expr-coefficient" type="number" step="0.01" value="1"><span>×</span><select data-role="expr-variable"><option value="">なし</option><option>$rank</option><option>$rand</option><option>$1</option><option>$2</option><option>$3</option><option>$4</option></select></div><label>詳細式 <input data-role="expr-advanced"></label><button data-action="apply-expression">式を適用</button><output data-role="expr-diagnostic"></output></fieldset>
            <fieldset class="bml-ref-connector"><legend>Ref接続</legend><div><label>種別 <select data-role="ref-kind"></select></label><label>target <select data-role="ref-target"></select></label></div><button data-action="connect-ref">選択命令へ接続</button><output data-role="ref-diagnostic"></output></fieldset>
          </section>
          <section class="bml-side-section" data-side-section="diagnostics"><div data-role="diagnostics"></div></section>
          <section class="bml-side-section" data-side-section="xml"><div class="bml-xml-actions"><button data-action="refresh-xml">生成</button><button data-action="copy-xml">コピー</button><button data-action="reimport-xml">検証して再取込</button></div><textarea data-role="xml" spellcheck="false"></textarea><pre data-role="sidecar"></pre></section>
        </aside>
      </div>
    </section>
    <section class="bml-page" data-section="stages">
      <div class="bml-stage-toolbar"><button data-orientation="vertical" class="active">Vertical</button><button data-orientation="horizontal">Horizontal</button><button data-action="add-event">敵event＋</button><button data-action="add-boss">Boss＋</button><button data-action="save-stage" class="primary">Stage保存</button><span>最大64 event / 通常敵4 + Boss1 / 8 waypoint / 3 phase</span></div>
      <div class="bml-stage-workspace">
        <aside class="bml-pane"><div class="bml-pane-title"><strong>Events</strong></div><div data-role="event-list" class="bml-event-list"></div></aside>
        <main><div data-role="timeline" class="bml-timeline"></div><div class="bml-screen stage"><canvas width="320" height="224" data-role="stage-preview"></canvas></div><input data-role="stage-frame" type="range" min="0" max="3600" value="0"><div class="bml-stage-controls"><button data-action="stage-reset">|◀</button><button data-action="stage-step">▶|</button><button data-action="stage-play" data-role="stage-play">▶</button><label>難易度 <select data-role="stage-difficulty"><option value="0">Easy</option><option value="1" selected>Normal</option><option value="2">Hard</option></select></label><label>seed <input data-role="stage-seed" value="0xACE1"></label><span data-role="stage-metrics"></span><small>矢印 移動 / Z 射撃 / Shift 低速 / C 診断 / Enter pause</small></div></main>
        <aside class="bml-pane"><div class="bml-pane-title"><strong>Event / Path / Phase</strong></div><textarea data-role="stage-inspector" spellcheck="false"></textarea><div class="bml-inline"><button data-action="apply-stage-inspector" class="primary">適用</button><button data-action="add-waypoint">waypoint＋</button><button data-action="add-phase">phase＋</button><button data-action="delete-event">削除</button></div><div data-role="stage-diagnostics"></div></aside>
      </div>
    </section>
    <footer class="bml-status" data-role="status">読込待ち</footer>
  </div>`;
}
