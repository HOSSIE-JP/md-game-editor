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
  assert.equal(ui.defaultCommand('background').palette, 'PAL0');
  assert.equal(ui.defaultCommand('sprite').palette, 'PAL1');
  assert.match(ui.renderCommandFields({ type: 'background', assetId: 'bg', palette: 'PAL3' }, { catalog: { assets: [] } }), /name="palette"/);
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

test('inline previewはSkip aliasを維持しFull BGでもmessage/choiceを表示する', async () => {
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
  assert.equal(state.choice.choices[0].label, 'hidden');
  const messageState = simulateScene({
    fullScreenBg: true,
    commands: [
      { type: 'background', assetId: 'bg' },
      { type: 'message', speaker: 'A', text: 'visible' },
    ],
  }, 1);
  assert.equal(messageState.message.text, 'visible');
});

test('adaptive choice preview uses the compiled lowered layout across skipped commands', async () => {
  const rendering = await importEditorModule('rendering.mjs');
  const { createScriptRuntime } = await importEditorModule('preview-runtime.mjs');
  assert.equal(rendering.choiceTopY({}), 136);
  assert.equal(rendering.choiceTopY({ _layoutLowered: true }), 152);

  const runtime = createScriptRuntime({
    startScene: 's',
    scenes: [{ id: 's', commands: [
      { type: 'comment', text: 'not emitted' },
      { type: 'wait', frames: 1, skip: true },
      { type: 'choice', choices: [{ label: '進む' }] },
    ] }],
  }, { choiceLowered: ['s:0'] });
  const snapshot = runtime.restart();
  assert.equal(snapshot.choice._layoutLowered, true);
});

test('physical palette preview applies last-loaded colors and reports conflicts', async () => {
  const { physicalPaletteFrame } = await importEditorModule('rendering.mjs');
  const red = Array.from({ length: 16 }, () => [0, 0, 0]);
  const green = Array.from({ length: 16 }, () => [0, 0, 0]);
  red[2] = [255, 0, 0];
  green[2] = [0, 255, 0];
  const bindings = { assets: {
    bg: { paletteFingerprint: 'red', paletteRgb333: red },
    actor: { paletteFingerprint: 'green', paletteRgb333: green },
  } };
  const physical = physicalPaletteFrame({
    background: { type: 'background', assetId: 'bg', palette: 'PAL2', _paletteLoadOrder: 1 },
    sprites: [{ type: 'sprite', assetId: 'actor', palette: 'PAL2', _paletteLoadOrder: 2, visible: true }],
    spriteTexts: [],
  }, bindings);
  assert.deepEqual(physical.palettes.PAL2[2], [0, 255, 0]);
  assert.deepEqual(physical.conflicts[0].assetIds, ['bg', 'actor']);
  assert.equal(physical.conflicts[0].lastAssetId, 'actor');

  bindings.assets.actor.paletteFingerprint = 'red';
  bindings.assets.actor.paletteRgb333 = red;
  const shared = physicalPaletteFrame({
    background: { type: 'background', assetId: 'bg', palette: 'PAL2', _paletteLoadOrder: 1 },
    sprites: [{ type: 'sprite', assetId: 'actor', palette: 'PAL2', _paletteLoadOrder: 2, visible: true }],
  }, bindings);
  assert.equal(shared.conflicts.length, 0);
  const message = physicalPaletteFrame({ message: { textColor: '#ff0000' } }, { assets: {} });
  assert.deepEqual(message.palettes.PAL0[0], [0, 0, 0]);
  assert.deepEqual(message.palettes.PAL0[1], [255, 0, 0]);
  assert.equal(message.messageColorFallback, null);

  bindings.assets.bg.metadata = { usesPaletteIndex1: true };
  const occupiedMessage = physicalPaletteFrame({
    background: { type: 'background', assetId: 'bg', palette: 'PAL0' },
    sprites: [],
    spriteTexts: [],
    message: { textColor: '#ff0000' },
  }, bindings);
  assert.deepEqual(occupiedMessage.palettes.PAL0[1], [255, 255, 255]);
  assert.deepEqual(occupiedMessage.messageColorFallback?.assetIds, ['bg']);

  const overlayMessage = physicalPaletteFrame({
    spriteTexts: [{ text: 'overlay', visible: true }],
    message: { textColor: '#ff0000' },
  }, { assets: {} });
  assert.deepEqual(overlayMessage.palettes.PAL0[1], [255, 255, 255]);
  assert.equal(overlayMessage.messageColorFallback?.spriteTextVisible, true);
});

test('Assets UI exposes palette swatches, usage, and explicit joint quantization', async () => {
  const { assetsHtml } = await importEditorModule('editor-render.mjs');
  const palette = Array.from({ length: 16 }, (_, index) => [index * 17, 0, 0]);
  const html = assetsHtml({
    assets: { actor: { assetId: 'actor', runtimeType: 'SPRITE', sourcePath: 'actor.png', paletteRgb333: palette, paletteGroup: 'cast', conversion: { paletteProfile: 'general' }, metadata: { quality: { meanDeltaE: 2, p95DeltaE: 4 } } } },
    paletteGroups: { cast: { id: 'cast', members: ['actor'], profile: 'general', paletteRgb333: palette, paletteFingerprint: 'abc', quality: {} } },
  }, { scenes: [{ commands: [{ type: 'sprite', slot: 0, assetId: 'actor', palette: 'PAL3' }] }] });
  assert.match(html, /共同減色して保存/);
  assert.match(html, /mn-palette-swatches/);
  assert.match(html, /PAL3/);
  assert.match(html, /data-group-id="cast"/);
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

test('full preview interpreterは文字送り、BG fade、WAIT割込、Move、SpriteText点滅をフレーム再現する', async () => {
  const { createScriptRuntime } = await importEditorModule('preview-runtime.mjs');
  const messageRuntime = createScriptRuntime({
    settings: { messageSpeedFrames: 2, messageAdvanceMode: 'button' },
    startScene: 'message',
    scenes: [{ id: 'message', commands: [
      { type: 'message', speaker: 'A', text: 'AB' },
      { type: 'wait', frames: 3 },
      { type: 'variable', variableName: 'done', operation: 'set', value: 1 },
      { type: 'message', text: 'end' },
    ] }],
  });
  let snapshot = messageRuntime.restart();
  assert.equal(snapshot.message.revealedGlyphs, 0);
  assert.equal(snapshot.message.complete, false);
  assert.equal(messageRuntime.elapseFrames(1).message.revealedGlyphs, 0);
  snapshot = messageRuntime.elapseFrames(1);
  assert.equal(snapshot.message.revealedGlyphs, 1);
  snapshot = messageRuntime.press('i');
  assert.equal(snapshot.message.revealedGlyphs, 2);
  assert.equal(snapshot.message.complete, true);
  snapshot = messageRuntime.press('i');
  assert.equal(snapshot.waiting.kind, 'wait');
  assert.equal(messageRuntime.elapseFrames(2).variables.done, undefined);
  snapshot = messageRuntime.elapseFrames(1);
  assert.equal(snapshot.variables.done, 1);
  assert.equal(snapshot.message.text, 'end');

  const fadeRuntime = createScriptRuntime({
    startScene: 'fade',
    scenes: [{ id: 'fade', commands: [
      { type: 'background', assetId: 'old', transition: 'none' },
      { type: 'background', assetId: 'new', transition: 'fade', fadeOutFrames: 2, fadeInFrames: 2 },
      { type: 'message', text: 'ready' },
    ] }],
  });
  snapshot = fadeRuntime.restart();
  assert.equal(snapshot.background.assetId, 'old');
  assert.equal(snapshot.waiting.kind, 'background');
  snapshot = fadeRuntime.elapseFrames(2);
  assert.equal(snapshot.background.assetId, 'new');
  assert.equal(snapshot.backgroundTransition.phase, 'in');
  assert.equal(snapshot.fadeAlpha, 1);
  snapshot = fadeRuntime.elapseFrames(2);
  assert.equal(snapshot.backgroundTransition, null);
  assert.equal(snapshot.fadeAlpha, 0);
  assert.equal(snapshot.message.text, 'ready');

  const interruptRuntime = createScriptRuntime({
    startScene: 'input',
    scenes: [{ id: 'input', commands: [
      { type: 'inputcheck', mode: 'async', buttons: ['i'], targetLabel: 'done' },
      { type: 'wait', frames: 120 },
      { type: 'variable', variableName: 'wrong', operation: 'set', value: 1 },
      { type: 'label', name: 'done' },
      { type: 'variable', variableName: 'ok', operation: 'set', value: 1 },
      { type: 'message', text: 'interrupted' },
    ] }],
  });
  snapshot = interruptRuntime.restart();
  assert.equal(snapshot.waiting.kind, 'wait');
  assert.equal(interruptRuntime.elapseFrames(10).waiting.frames, 110);
  snapshot = interruptRuntime.press('i');
  assert.equal(snapshot.variables.wrong, undefined);
  assert.equal(snapshot.variables.ok, 1);
  assert.equal(snapshot.message.text, 'interrupted');

  const animationRuntime = createScriptRuntime({
    startScene: 'animation',
    scenes: [{ id: 'animation', commands: [
      { type: 'sprite', slot: 0, assetId: 'actor', x: 0, y: 0 },
      { type: 'spritemove', slot: 0, x: 10, y: 20, frames: 10, async: true },
      { type: 'spritetext', slot: 0, text: 'PRESS', x: 0, y: 180, blinkFrames: 2, visible: true },
      { type: 'wait', frames: 10 },
      { type: 'message', text: 'moved' },
    ] }],
  });
  snapshot = animationRuntime.restart();
  assert.equal(snapshot.waiting.kind, 'wait');
  snapshot = animationRuntime.elapseFrames(1);
  assert.equal(snapshot.sprites[0].x, 1);
  assert.equal(snapshot.spriteTexts[0].blinkOn, true);
  snapshot = animationRuntime.elapseFrames(1);
  assert.equal(snapshot.sprites[0].x, 2);
  assert.equal(snapshot.spriteTexts[0].blinkOn, false);
  snapshot = animationRuntime.elapseFrames(8);
  assert.equal(snapshot.sprites[0].x, 10);
  assert.equal(snapshot.sprites[0].y, 20);
  assert.equal(snapshot.message.text, 'moved');
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
  assert.match(app, /data-pce-palette="background"/);
  assert.match(app, /data-pce-palette="slot3"/);
  assert.match(app, /paletteAssignments/);
  assert.match(app, /ensurePreviewFont/);
  assert.match(app, /fontEntries: state\.fontPlan\?\.entries/);
  assert.match(app, /commitMdNovelFontGeneration/);
  assert.match(fontUi, /ビットマップフォント生成/);
  assert.match(fontUi, /JF-Dot-Shinonome16\.ttf/);
  assert.match(fontUi, /しきい値190/);
  assert.match(app, /DEFAULT_FONT_THRESHOLD = 190/);
  assert.match(css, /min-width:1280px/);
  assert.match(css, /mn-command-actions button \{ flex:0 0 28px; width:28px; height:28px/);
  assert.match(css, /mn-command-actions button \{[^}]*display:grid; place-items:center/);
  assert.match(css, /mn-command-text small \{ color:#000; opacity:1;/);
  assert.match(css, /mn-pce-palette-grid/);
  assert.match(app, /beforeProjectSwitch\(\)/);
});

test('preview shadow follows the Mega Drive RGB333 shadow table', async () => {
  const { mdShadowRgb333 } = await importEditorModule('rendering.mjs');
  assert.deepEqual(mdShadowRgb333([255, 128, 36]), [119, 68, 17]);
  assert.deepEqual(mdShadowRgb333([0, 255, 119]), [0, 119, 51]);
  assert.deepEqual(mdShadowRgb333([NaN, -1, 999]), [0, 0, 119]);
});