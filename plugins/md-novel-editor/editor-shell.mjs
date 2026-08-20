export function buildEditorShell() {
  return `
    <div class="mn-shell">
      <header class="mn-global-toolbar">
        <button type="button" data-action="reload">再読込</button>
        <button type="button" data-action="save" class="primary">保存</button>
        <button type="button" data-action="import">PCEプロジェクト取込</button>
        <button type="button" data-action="validate">検証</button>
        <span class="mn-toolbar-separator"></span>
        <button type="button" data-action="undo" title="元に戻す (Ctrl+Z)">↶ Undo</button>
        <button type="button" data-action="redo" title="やり直す (Ctrl+Y)">↷ Redo</button>
        <span data-role="dirty" class="mn-dirty"></span>
        <span data-role="status" class="mn-status"></span>
      </header>
      <nav class="mn-tabs" aria-label="Novel editor tabs">
        <button type="button" data-tab="script" class="active">スクリプト</button>
        <button type="button" data-tab="system">システム設定</button>
        <button type="button" data-tab="font">フォント</button>
        <button type="button" data-tab="assets">Assets</button>
        <button type="button" data-tab="diagnostics">診断</button>
      </nav>
      <div class="mn-tab-host">
        <section data-section="script" class="mn-section active">
          <div class="mn-script-workspace" data-role="script-workspace">
            <aside class="mn-left-column" data-role="left-column">
              <section class="mn-library mn-scene-library">
                <header class="mn-library-header">
                  <h2>Scenes</h2>
                  <span data-role="scene-count" class="mn-count"></span>
                  <button type="button" class="icon" data-action="add-scene" title="Scene追加">＋</button>
                  <button type="button" class="icon" data-action="reload" title="再読込">↻</button>
                </header>
                <div data-role="scene-list" class="mn-scene-list"></div>
              </section>
              <section class="mn-library mn-command-library" data-role="command-library">
                <button type="button" class="mn-library-header mn-library-toggle" data-action="toggle-command-library" aria-expanded="true">
                  <h2>Commands</h2><span data-role="command-library-chevron">▾</span>
                </button>
                <div class="mn-command-library-body" data-role="command-library-body">
                  <input data-role="command-search" class="mn-input" placeholder="Command検索" aria-label="Command検索">
                  <div data-role="command-palette" class="mn-command-palette"></div>
                </div>
              </section>
            </aside>
            <div class="mn-column-resizer" data-resizer="left" role="separator" aria-orientation="vertical"></div>
            <main class="mn-center-column">
              <div class="mn-scene-sticky">
                <div class="mn-scene-title-row">
                  <button type="button" class="icon mn-column-toggle" data-action="toggle-left" title="左列を折り畳む">☰</button>
                  <div class="mn-scene-title-block">
                    <h2 data-role="scene-title">Scene</h2>
                    <div class="mn-scene-fields">
                      <label><span>Name</span><input data-role="scene-name" class="mn-input" placeholder="第01話/オープニング"></label>
                      <label class="mn-scene-id-field"><span>ID</span><input data-role="scene-id" class="mn-input mn-mono" maxlength="32" spellcheck="false"></label>
                      <div class="mn-mode-switch" role="group" aria-label="Script編集モード">
                        <button type="button" data-script-mode="gui" class="active">GUI</button>
                        <button type="button" data-script-mode="json">JSON</button>
                      </div>
                      <input data-role="command-list-search" class="mn-input mn-list-search" placeholder="Scene内Command検索" aria-label="Scene内Command検索">
                    </div>
                  </div>
                  <div class="mn-scene-actions">
                    <label class="mn-check"><input type="checkbox" data-role="scene-full-bg"><span>Full BG</span></label>
                    <button type="button" data-action="open-preview">▶ Preview</button>
                    <button type="button" data-action="save" class="primary">保存</button>
                    <button type="button" class="icon mn-column-toggle" data-action="toggle-right" title="右列を折り畳む">▣</button>
                  </div>
                </div>
                <div class="mn-budget" data-role="scene-budget" data-level="ok">
                  <div class="mn-budget-head"><span data-role="budget-label">MD Scene予算</span><span data-role="budget-value"></span></div>
                  <div class="mn-budget-track"><span data-role="budget-fill"></span></div>
                  <div class="mn-budget-metrics" data-role="budget-metrics"></div>
                </div>
              </div>
              <div class="mn-command-list" data-role="command-list"></div>
              <div class="mn-scene-json-pane" data-role="scene-json-pane" hidden>
                <textarea data-role="scene-json" class="mn-json-editor" spellcheck="false"></textarea>
                <button type="button" data-action="apply-scene-json" class="primary">Scene JSONを適用</button>
              </div>
              <div class="mn-inline-error" data-role="script-error"></div>
            </main>
            <div class="mn-column-resizer" data-resizer="right" role="separator" aria-orientation="vertical"></div>
            <aside class="mn-right-column" data-role="right-column">
              <section class="mn-command-preview-panel">
                <header class="mn-panel-title"><strong data-role="command-preview-title">Command Preview</strong><span data-role="preview-label"></span></header>
                <canvas data-role="command-preview" width="320" height="224"></canvas>
                <div class="mn-preview-audio-row"><span data-role="preview-audio-status"></span><button type="button" data-action="preview-audio" disabled>▶ 再生</button></div>
              </section>
              <form data-role="command-form" class="mn-command-detail"></form>
            </aside>
          </div>
        </section>
        <section data-section="system" class="mn-section"><div class="mn-settings-page"><form data-role="system-form" class="mn-system-form"></form></div></section>
        <section data-section="font" class="mn-section">
          <div class="mn-font-page">
            <aside class="mn-font-settings" data-role="font-settings"></aside>
            <main class="mn-font-preview">
              <section class="mn-font-panel"><header><h2>ゲーム内表示イメージ</h2><span>19文字 × 4行 / 16×16</span></header><canvas data-role="font-text-preview" width="304" height="80"></canvas></section>
              <section class="mn-font-panel"><header><h2>使用glyph atlas</h2><span data-role="font-glyph-count"></span></header><canvas data-role="font-atlas-preview" width="512" height="128"></canvas></section>
            </main>
          </div>
        </section>
        <section data-section="assets" class="mn-section"><div data-role="asset-list" class="mn-assets"></div></section>
        <section data-section="diagnostics" class="mn-section"><div data-role="diagnostics" class="mn-diagnostics"></div></section>
      </div>
    </div>`;
}
