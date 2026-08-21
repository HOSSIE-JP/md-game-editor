'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

async function importEditorModule(name) {
  return import(pathToFileURL(path.join(root, 'plugins', 'md-novel-editor', name)).href);
}

test('PCE型Script UIは18 command、階層Scene、参照renameを提供する', async () => {
  const ui = await importEditorModule('command-ui.mjs');
  assert.deepEqual(ui.COMMAND_DEFINITIONS.map((entry) => entry.type), [
    'background', 'sprite', 'spritemove', 'message', 'variable', 'choice', 'if', 'switch',
    'label', 'goto', 'inputcheck', 'jump', 'wait', 'cache', 'audio', 'effect', 'spritetext', 'comment',
  ]);
  const scenes = [
    { id: 'intro', name: '第01話/オープニング', commands: [] },
    { id: 'branch', name: '第01話/分岐/選択1', commands: [] },
    { id: 'interlude', name: '幕間', commands: [] },
  ];
  assert.deepEqual(ui.buildSceneRows(scenes).map((entry) => `${entry.type}:${entry.path || entry.scene.id}`), [
    'group:第01話', 'scene:intro', 'group:第01話/分岐', 'scene:branch', 'scene:interlude',
  ]);
  assert.deepEqual(ui.buildSceneRows(scenes, new Set(['第01話'])).map((entry) => `${entry.type}:${entry.path || entry.scene.id}`), [
    'group:第01話', 'scene:interlude',
  ]);

  const document = {
    futureRootField: { retained: true },
    startScene: 'old',
    scenes: [
      { id: 'old', name: 'Old', nextSceneId: 'old', commands: [{ type: 'jump', sceneId: 'old', futureCommandField: 7 }] },
      { id: 'menu', name: 'Menu', commands: [{ type: 'choice', choices: [{ label: 'Go', value: 1, targetSceneId: 'old' }] }] },
    ],
  };
  assert.equal(ui.sceneReferences(document, 'old').length, 4);
  ui.renameSceneReferences(document, 'old', 'renamed');
  assert.equal(document.startScene, 'renamed');
  assert.equal(document.scenes[0].nextSceneId, 'renamed');
  assert.equal(document.scenes[0].commands[0].sceneId, 'renamed');
  assert.equal(document.scenes[0].commands[0].futureCommandField, 7);
  assert.equal(document.scenes[1].commands[0].choices[0].targetSceneId, 'renamed');
  assert.deepEqual(document.futureRootField, { retained: true });
});

test('inline previewはSkip aliasとFull BGのmessage/choice禁止を維持する', async () => {
  const { simulateScene } = await importEditorModule('preview-core.mjs');
  const state = simulateScene({
    fullScreenBg: true,
    commands: [
      { type: 'background', assetId: 'ignored', skipped: true },
      { type: 'background', assetId: 'bg' },
      { type: 'message', speaker: 'A', text: 'hidden' },
      { type: 'choice', choices: [{ label: 'hidden' }] },
    ],
  }, 3);
  assert.equal(state.background.assetId, 'bg');
  assert.equal(state.message, null);
  assert.equal(state.choice, null);
});

test('full preview interpreterは分岐、Scene遷移、sprite持続、入力待ちを再現する', async () => {
  const { createScriptRuntime } = await importEditorModule('preview-runtime.mjs');
  const document = {
    version: 2,
    settings: { messageAdvanceMode: 'button' },
    startScene: 'intro',
    scenes: [
      {
        id: 'intro',
        commands: [
          { type: 'sprite', slot: 0, assetId: 'hero', x: 12, y: 20 },
          { type: 'variable', variableName: 'flag', operation: 'set', value: 1 },
          { type: 'if', variableName: 'flag', operator: 'eq', value: 1, targetLabel: 'yes', elseLabel: 'bad' },
          { type: 'label', name: 'bad' },
          { type: 'message', text: 'wrong branch' },
          { type: 'label', name: 'yes' },
          { type: 'choice', variableName: 'answer', choices: [{ label: '進む', value: 9, targetSceneId: 'end' }] },
        ],
      },
      { id: 'end', commands: [{ type: 'message', speaker: '部長', text: '到着' }] },
    ],
  };
  const runtime = createScriptRuntime(document);
  let snapshot = runtime.restart();
  assert.equal(snapshot.sceneId, 'intro');
  assert.equal(snapshot.choice.choices[0].label, '進む');
  assert.equal(snapshot.message, null);
  snapshot = runtime.choose(0);
  assert.equal(snapshot.sceneId, 'end');
  assert.equal(snapshot.message.text, '到着');
  assert.equal(snapshot.variables.answer, 9);
  assert.equal(snapshot.sprites[0].assetId, 'hero');

  const inputRuntime = createScriptRuntime({
    version: 2,
    startScene: 'input',
    scenes: [{ id: 'input', commands: [
      { type: 'inputcheck', mode: 'sync', buttons: ['i'], targetLabel: 'done' },
      { type: 'variable', variableName: 'wrong', operation: 'set', value: 1 },
      { type: 'label', name: 'done' },
      { type: 'variable', variableName: 'ok', operation: 'set', value: 1 },
      { type: 'message', text: 'ready' },
    ] }],
  });
  snapshot = inputRuntime.restart();
  assert.equal(snapshot.waiting.kind, 'input');
  assert.equal(inputRuntime.press('ii').waiting.kind, 'input');
  snapshot = inputRuntime.press('i');
  assert.equal(snapshot.variables.wrong, undefined);
  assert.equal(snapshot.variables.ok, 1);
  assert.equal(snapshot.message.text, 'ready');
});

test('full preview interpreterはrunawayと未解決Sceneを停止診断する', async () => {
  const { createScriptRuntime } = await importEditorModule('preview-runtime.mjs');
  const runaway = createScriptRuntime({
    startScene: 'loop',
    scenes: [{ id: 'loop', commands: [{ type: 'label', name: 'again' }, { type: 'goto', targetLabel: 'again' }] }],
  }, { runawayLimit: 100 });
  let snapshot = runaway.restart();
  assert.equal(snapshot.stopped, true);
  assert.match(snapshot.error, /100 Command/);
  assert.equal(runaway.consumeEvents().some((entry) => entry.type === 'runaway'), true);

  const broken = createScriptRuntime({
    startScene: 'start',
    scenes: [{ id: 'start', commands: [{ type: 'jump', sceneId: 'missing' }] }],
  });
  snapshot = broken.restart();
  assert.equal(snapshot.stopped, true);
  assert.match(snapshot.error, /missing/);
});

test('editor serviceはbuilderと同じMD到達状態予算を返す', async () => {
  const service = require(path.join(root, 'plugins', 'md-novel-editor', 'novel-service'));
  const result = await service.loadProject(path.join(root, 'template', 'template_md_novel'));
  assert.equal(result.ok, true);
  assert.ok(result.budget.states > 0);
  assert.ok(result.budget.maxBudget > 0);
  assert.ok(result.budget.maxBudget <= 1424);
  assert.deepEqual(result.budget.diagnostics, []);
});

test('renderer entryはPCE型3ペインv2 UIを有効化する', () => {
  const entry = fs.readFileSync(path.join(root, 'plugins', 'md-novel-editor', 'renderer.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'plugins', 'md-novel-editor', 'editor-shell.mjs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'plugins', 'md-novel-editor', 'renderer-app-v2.mjs'), 'utf8');
  assert.match(entry, /renderer-app-v2\.mjs/);
  assert.match(shell, /mn-left-column/);
  assert.match(shell, /mn-center-column/);
  assert.match(shell, /mn-right-column/);
  assert.match(shell, /システム設定/);
  assert.match(shell, /フォント/);
  assert.match(app, /HISTORY_LIMIT = 100/);
  assert.match(app, /beforeBuild\(\)/);
  const css = fs.readFileSync(path.join(root, 'plugins', 'md-novel-editor', 'pce-editor.css'), 'utf8');
  const fontUi = fs.readFileSync(path.join(root, 'plugins', 'md-novel-editor', 'editor-render.mjs'), 'utf8');
  assert.doesNotMatch(shell, /toggle-(?:left|right)/);
  assert.doesNotMatch(shell, /show-diagnostics/);
  assert.match(shell, /mn-scene-actions/);
  assert.match(app, /button\.dataset\.scriptMode/);
  assert.match(app, /applySceneJson/);
  assert.match(app, /guardSceneJson/);
  assert.match(app, /importMdNovelFont/);
  assert.match(app, /commitMdNovelFontGeneration/);
  assert.match(fontUi, /ビットマップフォント生成/);
  assert.match(css, /min-width:1280px/);
  assert.match(css, /mn-command-actions button \{ flex:0 0 28px; width:28px; height:28px/);
  assert.match(css, /mn-command-actions button \{[^}]*display:grid; place-items:center/);
  assert.match(css, /mn-command-text small \{ color:#000; opacity:1;/);
  assert.match(app, /beforeProjectSwitch\(\)/);
});
