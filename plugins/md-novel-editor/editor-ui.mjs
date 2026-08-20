export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export function diagnosticHtml(diagnostics = []) {
  if (!diagnostics.length) return '<div class="mn-empty">診断はありません。</div>';
  return diagnostics.map((entry) => `<article class="mn-diagnostic ${escapeHtml(entry.severity || 'info')}"><strong>${escapeHtml(entry.severity || 'info')} · ${escapeHtml(entry.code || '')}</strong><code>${escapeHtml(entry.path || '')}</code><p>${escapeHtml(entry.message || '')}</p></article>`).join('');
}

export function buildShell() {
  return `
    <div class="mn-shell">
      <header class="mn-toolbar">
        <button type="button" data-action="reload">再読込</button>
        <button type="button" data-action="save" class="primary">保存</button>
        <button type="button" data-action="import">PCEプロジェクト取込</button>
        <button type="button" data-action="validate">検証</button>
        <span data-role="dirty" class="mn-dirty"></span>
        <span data-role="status" class="mn-status"></span>
      </header>
      <nav class="mn-tabs">
        <button type="button" data-tab="script" class="active">Script</button>
        <button type="button" data-tab="system">System</button>
        <button type="button" data-tab="font">Font</button>
        <button type="button" data-tab="assets">Assets</button>
        <button type="button" data-tab="diagnostics">診断</button>
      </nav>
      <div class="mn-workspace">
        <aside class="mn-scenes">
          <div class="mn-heading"><strong>Scenes</strong><span data-role="scene-count"></span></div>
          <div data-role="scene-list" class="mn-list"></div>
        </aside>
        <main class="mn-main">
          <section data-section="script" class="mn-section active">
            <div class="mn-script-toolbar">
              <button type="button" data-action="undo">↶ Undo</button>
              <button type="button" data-action="redo">↷ Redo</button>
              <button type="button" data-action="add-command">＋ Command</button>
              <button type="button" data-action="move-up">↑</button>
              <button type="button" data-action="move-down">↓</button>
              <button type="button" data-action="delete-command">削除</button>
            </div>
            <div class="mn-script-grid">
              <div data-role="command-list" class="mn-command-list"></div>
              <form data-role="command-form" class="mn-command-form">
                <div class="mn-heading"><strong data-role="command-title">Command</strong><span data-role="command-index"></span></div>
                <textarea name="command-json" data-role="command-json" spellcheck="false"></textarea>
                <button type="submit" class="primary">JSONを適用</button>
              </form>
            </div>
          </section>
          <section data-section="system" class="mn-section"><form data-role="system-form" class="mn-form"></form></section>
          <section data-section="font" class="mn-section"><form data-role="font-form" class="mn-form"></form></section>
          <section data-section="assets" class="mn-section"><div data-role="asset-list" class="mn-assets"></div></section>
          <section data-section="diagnostics" class="mn-section"><div data-role="diagnostics" class="mn-diagnostics"></div></section>
        </main>
        <aside class="mn-preview-panel">
          <div class="mn-heading"><strong>MD Preview</strong><span data-role="preview-label"></span></div>
          <canvas data-role="preview" width="320" height="224"></canvas>
          <div class="mn-preview-controls">
            <button type="button" data-action="preview-prev">◀</button>
            <input data-role="preview-index" type="range" min="0" max="0" value="0">
            <button type="button" data-action="preview-next">▶</button>
          </div>
          <small>320×224 H40 / I=B · II=C · RUN=START · SELECT=A</small>
        </aside>
      </div>
    </div>`;
}
