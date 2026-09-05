'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const service = require('../plugins/bulletml-stg-editor/bulletml-service');

const repoRoot = path.join(__dirname, '..');
const templateRoot = path.join(repoRoot, 'template', 'template_bulletml_stg');
const moduleUrl = pathToFileURL(path.join(repoRoot, 'plugins', 'bulletml-stg-editor', 'renderer-app.mjs')).href;
const styleUrl = pathToFileURL(path.join(repoRoot, 'plugins', 'bulletml-stg-editor', 'style.css')).href;

function browserVerification(rendererUrl, loadedProject) {
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timeout: ${label}`);
  };
  const click = (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`missing element: ${selector}`);
    element.click();
    return element;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const root = document.querySelector('#root');
  let snapshot = clone(loadedProject.snapshot);
  let automaticPreviewCount = 0;
  const guardHost = document.createElement('div');
  document.body.append(guardHost);
  const api = {
    createModal({ html }) {
      const panel = document.createElement('div');
      panel.innerHTML = html; panel.hidden = true; guardHost.append(panel);
      return { panel, open() { panel.hidden = false; }, close() { panel.hidden = true; }, destroy() { panel.remove(); } };
    },
    plugins: {
      async invokeHook(_id, hook, payload = {}) {
        if (hook === 'loadBulletmlProject') return clone({ ...loadedProject, snapshot });
        if (hook === 'compileBulletmlPattern') return {
          ok: true, sha256: 'a'.repeat(64), report: { byteLength: 32 },
          preview: { crc32: '1234abcd', trace: [1, 2, 3].map((frame) => ({ frame, bullets: [], metrics: {} })) },
        };
        if (hook === 'exportBulletmlXml') return { ok: true, xml: '<bulletml type="none"></bulletml>\n', sidecar: { patternId: payload.pattern?.id || '' } };
        if (hook === 'saveBulletmlProject') {
          snapshot.editorState = clone(payload.editorState);
          snapshot.revisions.editorState = 'editor-state-saved';
          return { ok: true, snapshot: clone(snapshot) };
        }
        if (hook === 'startBulletmlStagePreview') return {
          ok: true, sessionId: 'ui-smoke',
          preview: {
            frame: 0, durationFrames: payload.stage.durationFrames, bullets: [], enemies: [], shots: [],
            player: payload.orientation === 'horizontal' ? { x: 48, y: 112 } : { x: 160, y: 196 },
            metrics: { scanlinePieces: [], scanlineDots: [] }, outcome: 'running',
          },
        };
        if (hook === 'stopBulletmlStagePreview') return { ok: true, stopped: true };
        if (hook === 'stepBulletmlStagePreview' || hook === 'seekBulletmlStagePreview') return {
          ok: true,
          preview: { frame: Number(payload.frame || payload.frames || 0), durationFrames: 3600, bullets: [], enemies: [], shots: [], player: { x: 160, y: 196 }, metrics: { scanlinePieces: [], scanlineDots: [] }, outcome: 'running' },
        };
        throw new Error(`unexpected hook: ${hook}`);
      },
    },
    capabilities: {
      get(name) {
        if (name !== 'rescomp-asset-picker') return null;
        return {
          async mountPreview(container, reference) {
            automaticPreviewCount += 1;
            container.innerHTML = `<p data-test-automatic-preview>${reference?.symbol || '未選択'}を自動プレビュー</p>`;
          },
          stopPreview() {},
        };
      },
      async require(name) { return this.get(name); },
    },
  };
  let capability = null;
  return import(rendererUrl).then(async ({ activatePlugin }) => {
    const lifecycle = activatePlugin({
      plugin: { id: 'bulletml-stg-editor' }, root, api,
      logger: { error(message) { throw new Error(message); }, info() {}, warn() {}, debug() {} },
      registerCapability(_name, value) { capability = value; },
    });
    await waitFor(() => document.querySelectorAll('[data-action="select-pattern"]').length === 5, 'initial pattern list');
    if (!capability) throw new Error('renderer capability was not registered');
    const tabLabels = [...document.querySelectorAll('[data-page]')].map((button) => button.textContent.trim());
    for (const label of ['作品設定', 'プレイヤー', '武器', 'アイテム', '演出', '移動', '敵', 'ボス', '背景・衝突', 'ステージ', 'デモ', '弾幕', '診断']) {
      if (!tabLabels.includes(label)) throw new Error(`Japanese tab is missing: ${label}`);
    }
    if (document.querySelector('[data-v2-asset-action="preview"]')) throw new Error('manual Preview button must not exist');
    click('[data-page="player"]');
    await waitFor(() => document.querySelector('[data-section="player"]').classList.contains('active'), 'Player page');
    if (!document.querySelector('[data-section="player"] .structured-form')) throw new Error('Player settings did not render as a GUI form');
    if (!document.querySelector('[data-section="player"] .structured-help[title]')) throw new Error('Player GUI help tooltip is missing');
    if (!document.querySelector('[data-section="player"] [data-v2-asset-option="animationRow"]')) throw new Error('Player animation row did not render as a GUI asset option');
    await waitFor(() => automaticPreviewCount > 0 && document.querySelector('[data-test-automatic-preview]'), 'automatic asset preview');
    click('[data-page="patterns"]');
    await waitFor(() => document.querySelector('[data-section="patterns"]').classList.contains('active'), 'Patterns page');
    if (!document.querySelector('[data-role="pattern-settings-form"] [data-structured-form="pattern-settings"]')) throw new Error('Pattern sprite and hitbox settings did not render as a GUI form');
    if (!document.querySelector('[data-role="pattern-animation-row"]')) throw new Error('Pattern animation row GUI is missing');
    if (!document.querySelector('[data-role="pattern-asset-preview"] [data-test-automatic-preview]')) throw new Error('Pattern asset did not open an automatic preview');
    const loop = document.querySelector('[data-role="preview-loop"]');
    if (!loop.checked) throw new Error('Preview loop must default to ON');

    const filter = document.querySelector('[data-role="pattern-filter"]');
    filter.value = 'ref'; filter.dispatchEvent(new Event('input', { bubbles: true }));
    if (document.querySelectorAll('[data-action="select-pattern"]').length !== 1) throw new Error('Pattern filter did not reduce the list');
    click('[data-action="select-pattern"][data-id="ref-showcase"]');
    click('[data-action="select-definition"][data-key="action:volley"]');
    click('[data-action="select-command"][data-command-path="definitions.1.commands.0"]');
    if (document.querySelector('[data-action="connect-ref"]').disabled) throw new Error('Ref connector did not become enabled for fireRef');
    if (!document.querySelector('[data-role="command-form"] [data-structured-form="pattern-command"]')) throw new Error('Pattern command details did not render as a GUI form');
    if (!document.querySelector('[data-role="command-form"] .structured-help[title]')) throw new Error('Pattern command tooltip is missing');

    const definitionFilter = document.querySelector('[data-role="definition-filter"]');
    definitionFilter.value = 'fire'; definitionFilter.dispatchEvent(new Event('change', { bubbles: true }));
    if (document.querySelectorAll('[data-role="definition-list"] [data-action="select-definition"]').length !== 1) throw new Error('Definition display filter failed');
    if (!document.querySelector('[data-role="edit-title"]').textContent.includes('volley')) throw new Error('Definition filter changed the editor selection');
    click('[data-action="select-definition"][data-key="fire:aimed-fire"]');
    if (!document.querySelector('[data-action="apply-definition-properties"]')?.textContent.includes('発射')) throw new Error('Fire definition did not render a Japanese structured form');
    definitionFilter.value = 'bullet'; definitionFilter.dispatchEvent(new Event('change', { bubbles: true }));
    click('[data-action="select-definition"][data-key="bullet:payload"]');
    if (!document.querySelector('[data-action="apply-definition-properties"]')?.textContent.includes('弾設定')) throw new Error('Bullet definition did not render a Japanese structured form');

    const name = document.querySelector('[data-role="pattern-name"]');
    name.value = 'Ref Showcase Renamed';
    click('[data-action="apply-pattern-metadata"]');
    if (!document.querySelector('[data-action="select-pattern"][data-id="ref-showcase"]').textContent.includes('Ref Showcase Renamed')) throw new Error('Pattern rename was not reflected in the list');
    if (document.querySelector('[data-role="pattern-id"]').textContent !== 'ref-showcase') throw new Error('Pattern stable ID changed during rename');

    loop.checked = false; loop.dispatchEvent(new Event('change', { bubbles: true }));
    if (loop.checked) throw new Error('Preview loop toggle did not switch OFF');
    click('[data-page="stages"]');
    click('[data-choice="discard"]');
    await waitFor(() => document.querySelector('[data-section="stages"]').classList.contains('active'), 'Stages page');
    if (!document.querySelector('[data-role="stage-settings-form"] [data-structured-form="stage-settings"]')) throw new Error('Stage basic settings did not render as a GUI form');
    if (!document.querySelector('[data-role="stage-collision-layer"]')) throw new Error('Stage collision layer GUI is missing');
    if (!document.querySelector('[data-role="stage-asset-preview"] [data-test-automatic-preview]')) throw new Error('Stage collision map did not open an automatic preview');
    for (const action of ['new-stage', 'delete-stage', 'restore-stage']) {
      const selector = action === 'restore-stage' ? '[data-role="stage-deleted-list"]' : `[data-action="${action}"]`;
      if (!document.querySelector(selector)) throw new Error(`Stage CRUD GUI is missing: ${action}`);
    }
    if (!document.querySelector('[data-path-mode="selected"]').classList.contains('active')) throw new Error('selected-event path mode must be the default');
    click('[data-path-mode="all"]');
    if (!document.querySelector('[data-path-mode="all"]').classList.contains('active')) throw new Error('all-path mode did not activate');

    const bossButton = [...document.querySelectorAll('[data-role="event-list"] [data-action="select-event"]')]
      .find((button) => button.textContent.includes('boss-gate'));
    if (!bossButton) throw new Error('Showcase Boss event was not found');
    bossButton.click();
    if (!document.querySelector('[data-role="stage-form"] .structured-form')) throw new Error('Stage event did not render as a GUI form');
    if (!document.querySelector('[data-role="stage-form"] .structured-help[title]')) throw new Error('Stage event tooltip is missing');
    const addPhase = document.querySelector('[data-action="add-phase"]');
    const removePhase = document.querySelector('[data-action="remove-phase"]');
    if (addPhase.disabled || removePhase.disabled || !document.querySelector('[data-role="phase-summary"]').textContent.includes('2/8')) throw new Error('initial Boss phase controls are incorrect');
    removePhase.click();
    if (addPhase.disabled || !removePhase.disabled || !document.querySelector('[data-role="phase-summary"]').textContent.includes('1/8')) throw new Error('one-phase lower bound is incorrect');
    for (let index = 0; index < 7; index += 1) addPhase.click();
    if (!addPhase.disabled || removePhase.disabled || !document.querySelector('[data-role="phase-summary"]').textContent.includes('8/8')) throw new Error('eight-phase upper bound is incorrect');

    click('[data-page="patterns"]');
    click('[data-choice="discard"]');
    await waitFor(() => document.querySelector('[data-section="patterns"]').classList.contains('active'), 'Patterns page');
    const inspector = document.querySelector('[data-side-section="inspector"]');
    const expression = document.querySelector('.bml-expression');
    const layout = {
      inspectorOverflowX: getComputedStyle(inspector).overflowX,
      expressionFits: expression.scrollWidth <= expression.clientWidth + 1,
    };
    if (layout.inspectorOverflowX !== 'hidden' || !layout.expressionFits) throw new Error(`Inspector overflow regression: ${JSON.stringify(layout)}`);
    click('[data-page="demos"]');
    await waitFor(() => document.querySelector('[data-section="demos"]').classList.contains('active'), 'Demos page');
    if (!document.querySelector('[data-vn-commands-gui] .structured-form')) throw new Error('Demo commands did not render as a GUI form');
    if (!document.querySelector('[data-vn-commands-gui] .structured-help[title]')) throw new Error('Demo command tooltip is missing');
    if (!document.querySelector('[data-vn-binding-gui] .structured-form')) throw new Error('Demo binding extras did not render as a GUI form');
    lifecycle.deactivate();
    return { ok: true, patternCount: 5, japaneseTabs: tabLabels.length, guiForms: ['player', 'pattern-settings', 'pattern-command', 'stage-settings', 'stage-event', 'demo-binding', 'demo-command'], automaticPreviewCount, refEnabled: true, loopDefault: true, pathModes: ['selected', 'all'], bossPhaseBounds: [1, 8], layout };
  });
}

async function main() {
  const loaded = service.loadProject(templateRoot);
  if (!loaded.ok) throw new Error(loaded.error);
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1500,
    height: 950,
    webPreferences: { contextIsolation: false, nodeIntegration: false, webSecurity: false },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${styleUrl}"><style>html,body,#root{width:100%;height:100%;margin:0}#root{display:block}</style></head><body><section id="root" class="editor-page active"></section></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const result = await window.webContents.executeJavaScript(`(${browserVerification.toString()})(${JSON.stringify(moduleUrl)}, ${JSON.stringify(loaded)})`, true);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
}

main().then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
