'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..');
const editorRoot = path.join(repoRoot, 'plugins', 'bulletml-stg-editor');
const builderRoot = path.join(repoRoot, 'plugins', 'bulletml-stg-builder');
const starterTemplate = path.join(repoRoot, 'template', 'template_bulletml_stg');
const schema = require(path.join(editorRoot, 'bulletml-schema'));
const expression = require(path.join(editorRoot, 'bulletml-expression'));
const xml = require(path.join(editorRoot, 'bulletml-xml'));
const compiler = require(path.join(editorRoot, 'bulletml-compiler'));
const simulator = require(path.join(editorRoot, 'bulletml-simulator'));
const { StagePreviewSession } = require(path.join(editorRoot, 'bulletml-stage-preview'));
const service = require(path.join(editorRoot, 'bulletml-service'));
const editor = require(editorRoot);
const builder = require(builderRoot);

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-'));
  fs.mkdirSync(path.join(root, 'data', 'bulletml', 'patterns'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'bulletml', 'stages'), { recursive: true });
  return root;
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test('BulletML plugins declare one-way dependencies and matching main hooks', () => {
  const manifest = require(path.join(editorRoot, 'manifest.json'));
  const builderManifest = require(path.join(builderRoot, 'manifest.json'));
  assert.deepEqual(manifest.types, ['editor', 'asset']);
  assert.deepEqual(manifest.supportedCores, ['mega-drive']);
  assert.equal(manifest.version, '2.0.0');
  assert.deepEqual(manifest.dependencies, ['asset-manager', 'sprite-editor', 'tilemap-editor']);
  assert.ok(!manifest.dependencies.includes('bulletml-stg-builder'));
  assert.deepEqual(manifest.mainApi.hooks, manifest.hooks.filter((hook) => !['getTab', 'onActivate', 'onDeactivate'].includes(hook)));
  assert.deepEqual(builderManifest.dependencies, ['bulletml-stg-editor']);
  assert.deepEqual(builderManifest.roles, [{ id: 'builder', label: 'ビルド', exclusive: true, order: 10 }]);
  assert.equal(builderManifest.generator, false);
});

test('BulletML v2 Showcase selects the builder and mixes Campaign/Caravan stage orientations', () => {
  const project = JSON.parse(fs.readFileSync(path.join(starterTemplate, 'project.json'), 'utf8'));
  assert.deepEqual(project.pluginRoles, { builder: 'bulletml-stg-builder', testplay: 'standard-emulator' });
  const snapshot = service.readSnapshot(starterTemplate);
  assert.equal(snapshot.project.schemaVersion, 2);
  assert.equal(snapshot.project.title, 'GERONEKO -ABYSS STRIKE-');
  assert.equal(snapshot.patterns.length, 5);
  assert.equal(snapshot.stages.length, 4);
  assert.deepEqual(snapshot.stages.filter((stage) => stage.id.startsWith('stage-')).map((stage) => stage.orientation), ['vertical', 'horizontal', 'vertical']);
  assert.equal(snapshot.project.caravan.stageId, 'caravan-abyss');
  assert.equal(snapshot.project.caravan.timeLimitFrames, 7200);
  assert.equal(snapshot.project.patternRoles.verticalNormal, 'generic-aimed');
  const refShowcase = snapshot.patterns.find((pattern) => pattern.id === 'ref-showcase');
  assert.ok(refShowcase);
  assert.equal(schema.validatePattern(refShowcase).ok, true);
  for (const stage of snapshot.stages) {
    const validation = schema.validateStage(stage, new Set(snapshot.patterns.map((pattern) => pattern.id)));
    assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
    assert.ok(stage.events.length >= 4);
    assert.ok(stage.events.some((event) => event.action.type === 'stage_clear'));
    assert.deepEqual(stage.events.map((event) => event.order), [...stage.events].map((event) => event.order).sort((a, b) => a - b));
  }
  for (const stage of snapshot.stages.filter((entry) => entry.id.startsWith('stage-'))) assert.equal(stage.events.filter((event) => event.action.type === 'spawn_boss').length, 1);
  const validation = service.validateSnapshot(snapshot, { projectDir: starterTemplate });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test('affine expression parser folds constants, consumes rand left-to-right, and rejects general expressions', () => {
  const folded = expression.parseExpression('(2 + 3) * 4');
  assert.equal(folded.dynamic, false);
  assert.equal(folded.constant, 20);
  const first = expression.evaluateExpression('$rand+$rand*2+$rank+$1', { seed: 1, rank: 0.5, params: [3] });
  const random1 = expression.nextRandom(1);
  const random2 = expression.nextRandom(random1);
  assert.equal(first.seed, random2);
  assert.equal(first.q16, (random1 + Math.trunc(random2 * 2) + Math.trunc(0.5 * 0xffff) + 3 * 0x10000) | 0);
  assert.throws(() => expression.parseExpression('$rank*$rand'), /動的な値同士/);
  assert.throws(() => expression.parseExpression('1/$rank'), /動的除数/);
  assert.throws(() => expression.parseExpression('$1%2'), /剰余/);
});

test('canonical BulletML XML round-trips type none and sidecar hash without fetching its DTD', () => {
  const pattern = schema.createPatternTemplate('fan', 'generic-fan');
  pattern.sprite.paletteFingerprint = 'same-palette';
  const source = xml.exportXml(pattern);
  assert.match(source, /<!DOCTYPE bulletml SYSTEM/);
  assert.match(source, /<bulletml type="none">/);
  const sidecar = xml.createSidecar(pattern, source);
  assert.equal(xml.verifySidecar(sidecar, source).ok, true);
  const imported = xml.importXml(source, sidecar).pattern;
  assert.equal(imported.id, pattern.id);
  assert.equal(imported.type, 'none');
  assert.equal(xml.exportXml(imported), source);
  assert.equal(xml.verifySidecar(sidecar, source.replace('<wait>50</wait>', '<wait>51</wait>')).stale, true);
});

test('XML import reports line and column and rejects XXE, internal subsets, unknown nodes, and accel', () => {
  for (const source of [
    '<!DOCTYPE bulletml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><bulletml><action label="top"><wait>&xxe;</wait></action></bulletml>',
    '<bulletml><action label="top"><unknown/></action></bulletml>',
    '<bulletml><action label="top"><accel><term>1</term></accel></action></bulletml>',
  ]) {
    assert.throws(() => xml.importXml(source), (error) => Number.isInteger(error.line) && Number.isInteger(error.column) && error.line >= 1 && error.column >= 1);
  }
});

test('validation rejects duplicate labels, unresolved refs, recursive refs, excessive params, and invalid u16 terms', () => {
  const pattern = schema.createPatternTemplate('blank', 'invalid');
  pattern.definitions.push({ kind: 'action', label: 'top', commands: [] });
  pattern.definitions[0].commands.push({ op: 'actionRef', ref: 'top', params: ['1', '2', '3', '4', '5'] });
  pattern.definitions[0].commands.push({ op: 'changeSpeed', speed: { type: 'absolute', value: '1' }, term: '0' });
  const result = schema.validatePattern(pattern);
  const codes = new Set(result.errors.map((item) => item.code));
  for (const code of ['BML_DUPLICATE_LABEL', 'BML_PARAM_LIMIT', 'BML_RECURSION', 'BML_U16_RANGE']) assert.ok(codes.has(code), code);
});

test('BMLB compiler is deterministic, big-endian, and covers all direction and speed types', () => {
  const bullet = { ref: '', params: [], inline: { actions: [] } };
  const pattern = schema.normalizePattern({
    id: 'all-types', type: 'none', rootActions: ['top'], sprite: { ...schema.DEFAULT_SPRITE, paletteFingerprint: 'p' },
    definitions: [{ kind: 'action', label: 'top', commands: [
      ...schema.DIRECTION_TYPES.map((type, index) => ({ op: 'fire', direction: { type, value: String(index * 15) }, speed: { type: schema.SPEED_TYPES[index % 3], value: '1.5' }, bullet })),
      { op: 'changeDirection', direction: { type: 'aim', value: '0' }, term: '2' },
      { op: 'changeSpeed', speed: { type: 'relative', value: '1' }, term: '2' },
    ] }],
  });
  const first = compiler.compilePattern(pattern);
  const second = compiler.compilePattern(schema.deepClone(pattern));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.bytes.toString('ascii', 0, 4), 'BMLB');
  assert.equal(first.bytes[4], 1);
  assert.equal(first.bytes.readUInt16BE(8), first.bytes.length);
  const decoded = compiler.decodeBmlb(first.bytes);
  assert.equal(decoded.type, 0);
  assert.equal(decoded.definitions.length, 1);
});

test('compiled-bytecode VM is deterministic and applies exact term interpolation', () => {
  const pattern = schema.createPatternTemplate('turn', 'turn');
  pattern.sprite.paletteFingerprint = 'p';
  const bytes = compiler.compilePattern(pattern).bytes;
  const traces = [];
  for (let run = 0; run < 2; run += 1) {
    const vm = new simulator.BulletmlVm(bytes, { seed: 0 });
    vm.setPlayer(240, 180);
    vm.startEmitter({ x: 160, y: 24 });
    let crc = 0xffffffff;
    for (let frame = 0; frame < 240; frame += 1) { vm.tick(); vm.applyDisplayBudget(); crc = vm.stateCrc(crc); }
    traces.push({ crc, bullets: vm.getBullets(), metrics: vm.getMetrics() });
  }
  assert.equal(traces[0].crc, traces[1].crc);
  assert.deepEqual(traces[0].bullets, traces[1].bullets);
  assert.equal(traces[0].metrics.seed, 0xace1);
});

test('VM overflow policies reject new fire, resume opcode work, and delete invisible bullets logically', () => {
  const bullet = { ref: '', params: [], inline: { actions: [] } };
  const pattern = schema.normalizePattern({
    id: 'overflow', rootActions: ['top'], sprite: { ...schema.DEFAULT_SPRITE, frameWidth: 32, frameHeight: 32, tileCount: 16, paletteFingerprint: 'p' },
    definitions: [{ kind: 'action', label: 'top', commands: [{ op: 'repeat', times: '100', action: { commands: [{ op: 'fire', direction: { type: 'absolute', value: '180' }, speed: { type: 'absolute', value: '0' }, bullet }] } }] }],
  });
  const vm = new simulator.BulletmlVm(compiler.compilePattern(pattern).bytes, { bullets: 48, spawns: 16, opcodes: 8 });
  vm.startEmitter({ x: 160, y: 112 });
  for (let frame = 0; frame < 20; frame += 1) vm.tick();
  const before = vm.getMetrics();
  assert.ok(before.opcodeExhaustions > 0);
  assert.ok(before.fireDrops > 0);
  const display = vm.applyDisplayBudget({ globalSprites: 79, scanlinePieces: Array(224).fill(19), scanlineDots: Array(224).fill(300) });
  assert.ok(display.removed.length > 0);
  assert.equal(vm.getBullets().some((item) => !item.visible), false);
});

test('draft saves are atomic, revision checked, build compilation rejected, and deleted patterns recover', () => {
  const root = tempProject();
  try {
    assert.equal(service.saveProject(root, { project: schema.DEFAULT_PROJECT, editorState: schema.DEFAULT_EDITOR_STATE }).ok, true);
    const valid = schema.createPatternTemplate('aimed', 'aimed');
    valid.sprite.paletteFingerprint = 'p';
    const saved = service.savePattern(root, { pattern: valid, baseRevision: '' });
    assert.equal(saved.ok, true);
    assert.equal(saved.draftValid, true);
    const invalid = schema.deepClone(valid);
    invalid.definitions[0].commands[0].times = '-1';
    const draft = service.savePattern(root, { pattern: invalid, baseRevision: saved.snapshot.revisions.patterns.aimed });
    assert.equal(draft.ok, true);
    assert.equal(draft.draftValid, false);
    assert.equal(service.compilePattern(root, { id: 'aimed' }).ok, false);
    const stale = service.savePattern(root, { pattern: valid, baseRevision: saved.snapshot.revisions.patterns.aimed });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    const current = service.readSnapshot(root);
    const deleted = service.deletePattern(root, { id: 'aimed', baseRevision: current.revisions.patterns.aimed });
    assert.equal(deleted.ok, true);
    assert.match(deleted.backup, /\.deleted/);
    assert.equal(service.readSnapshot(root).patterns.length, 0);
    const restored = service.restorePattern(root, { fileName: path.basename(deleted.backup) });
    assert.equal(restored.ok, true);
    assert.equal(restored.snapshot.patterns[0].id, 'aimed');
    const leftovers = fs.readdirSync(path.join(root, 'data', 'bulletml', 'patterns')).filter((name) => /\.(?:tmp|bak)$/.test(name));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(root); }
});

test('editor main hooks refuse missing project context', () => {
  const result = editor.loadBulletmlProject({}, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /projectDir is required/);
});

test('structured and graph edits share one reducer, preserve identical IR hashes, and undo 100 steps', async () => {
  const model = await import(pathToFileURL(path.join(editorRoot, 'editor-model.mjs')).href);
  const base = schema.createPatternTemplate('blank', 'model');
  const structured = new model.PatternHistory(base, 100);
  const graph = new model.PatternHistory(base, 100);
  const operations = [
    { type: 'addDefinition', kind: 'bullet', label: 'child' },
    { type: 'addCommand', label: 'top', command: model.defaultCommand('fire') },
    { type: 'connectRef', label: 'top', index: 0, kind: 'bullet', target: 'child' },
    { type: 'addCommand', label: 'top', command: model.defaultCommand('wait') },
    { type: 'moveCommand', label: 'top', index: 1, delta: -1 },
  ];
  for (const operation of operations) { structured.dispatch(operation); graph.dispatch(operation); }
  assert.equal(model.irHash(structured.present), model.irHash(graph.present));
  assert.deepEqual(model.graphEdges(graph.present), [{ from: 'action:top', to: 'bullet:child', kind: 'bullet' }]);
  for (let index = 0; index < 130; index += 1) structured.dispatch({ type: 'set', path: ['name'], value: `Name ${index}` });
  assert.equal(structured.past.length, 100);
  for (let index = 0; index < 100; index += 1) structured.undo();
  assert.equal(structured.past.length, 0);
  assert.equal(structured.future.length, 100);
});

test('studio overhaul keeps filters separate from selection and edits names, nested refs, loop, paths, and phases deterministically', async () => {
  const model = await import(pathToFileURL(path.join(editorRoot, 'editor-model.mjs')).href);
  const reference = schema.createPatternTemplate('reference', 'reference');
  const history = new model.PatternHistory(reference, 100);
  history.dispatch({ type: 'setPatternMetadata', name: 'Renamed Pattern', patternType: 'horizontal' });
  assert.equal(history.present.name, 'Renamed Pattern');
  assert.equal(history.present.id, 'reference');
  assert.equal(history.present.type, 'horizontal');

  history.dispatch({ type: 'updateDefinitionMetadata', kind: 'action', label: 'volley', nextLabel: 'volley-main', root: false });
  assert.equal(history.present.definitions[0].commands[0].action.ref, 'volley-main');
  history.dispatch({ type: 'updateDefinitionMetadata', kind: 'fire', label: 'aimed-fire', nextLabel: 'aimed-shot' });
  assert.equal(history.present.definitions.find((definition) => definition.label === 'volley-main').commands[0].ref, 'aimed-shot');
  const volleyIndex = history.present.definitions.findIndex((definition) => definition.label === 'volley-main');
  history.dispatch({ type: 'connectRefAt', path: ['definitions', volleyIndex, 'commands', 0], kind: 'fire', target: 'aimed-shot' });
  assert.equal(history.present.definitions[volleyIndex].commands[0].ref, 'aimed-shot');

  assert.deepEqual(model.filterPatterns([
    { id: 'one', name: 'Aimed', type: 'none' },
    { id: 'two', name: 'Fan', type: 'vertical' },
  ], 'aim', 'all').map((pattern) => pattern.id), ['one']);
  assert.deepEqual(model.filterPatterns([
    { id: 'one', name: 'Aimed', type: 'none' },
    { id: 'two', name: 'Fan', type: 'vertical' },
  ], '', 'vertical').map((pattern) => pattern.id), ['two']);
  assert.ok(model.filterDefinitions(history.present.definitions, 'fire').every((definition) => definition.kind === 'fire'));

  const events = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(model.stagePathsForMode(events, 1, 'selected').map(({ event }) => event.id), ['b']);
  assert.deepEqual(model.stagePathsForMode(events, 1, 'all').map(({ event }) => event.id), ['a', 'b']);
  const phase1 = { boss: true, patternId: 'p', phases: [{ threshold: 100, patternId: 'p' }] };
  const phase2 = model.addBossPhase(phase1);
  const phase3 = model.addBossPhase(phase2);
  assert.deepEqual(phase3.phases.map((phase) => phase.threshold), [100, 75, 60]);
  const phase8 = Array.from({ length: 5 }).reduce((event) => model.addBossPhase(event), phase3);
  assert.deepEqual(phase8.phases.map((phase) => phase.threshold), [100, 75, 60, 45, 30, 20, 10, 1]);
  assert.equal(model.addBossPhase(phase8).phases.length, 8);
  assert.equal(model.removeBossPhase(phase8).phases.length, 7);

  assert.deepEqual(model.advancePreviewFrame(8, 10, 2, true), { index: 0, playing: true, wrapped: true });
  assert.deepEqual(model.advancePreviewFrame(8, 10, 2, false), { index: 9, playing: false, wrapped: false });
});

test('renderer keeps plugin UI and compiled preview inside its renderer module', async () => {
  const renderer = fs.readFileSync(path.join(editorRoot, 'renderer-app.mjs'), 'utf8');
  const ui = fs.readFileSync(path.join(editorRoot, 'editor-ui.mjs'), 'utf8');
  const uiHtml = (await import(pathToFileURL(path.join(editorRoot, 'editor-ui.mjs')).href)).buildShell();
  assert.match(renderer, /beforeBuild\(\)/);
  assert.match(renderer, /beforeProjectSwitch\(\)/);
  assert.match(renderer, /compileBulletmlPattern/);
  assert.match(renderer, /PatternHistory/);
  assert.match(ui, /data-role="graph"/);
  assert.match(ui, /data-role="preview"/);
  assert.match(ui, /data-section="stages"/);
  assert.match(ui, /data-role="xml"/);
  assert.match(renderer, /startBulletmlStagePreview/);
  assert.match(renderer, /stepBulletmlStagePreview/);
  assert.match(renderer, /preview\?\.bullets/);
  assert.match(renderer, /connectSelectedRef/);
  for (const page of ['project', 'player', 'weapons', 'items', 'effects', 'movement', 'enemies', 'bosses', 'backgrounds', 'stages', 'demos', 'patterns', 'diagnostics']) assert.match(uiHtml, new RegExp(`data-page="${page}"`));
  assert.match(uiHtml, /ステージ間デモ/);
  assert.match(uiHtml, /作品設定/);
  assert.match(uiHtml, /上級者向け：内部JSON/);
  assert.match(uiHtml, /data-role="stage-form"/);
  assert.match(uiHtml, /data-role="command-form"/);
  assert.match(renderer, /renderStructuredForm/);
  assert.match(renderer, /scope: 'pattern-command'/);
  assert.match(ui, /data-action="connect-ref"/);
  assert.match(ui, /data-action="move-command" data-delta="-1"/);
  assert.match(ui, /data-action="delete-command" title="選択命令を削除"/);
  assert.match(ui, /data-role="pattern-filter"/);
  assert.match(ui, /data-action="apply-pattern-metadata"/);
  assert.match(ui, /data-role="preview-loop"/);
  assert.match(ui, /data-path-mode="selected"/);
  assert.match(ui, /data-action="remove-phase"/);
  assert.match(renderer, /renderBulletDefinition/);
  assert.match(renderer, /renderFireDefinition/);
  assert.doesNotMatch(renderer, /formatJson\(definition\)/);
  assert.match(renderer, /connectRefAt/);
  assert.match(renderer, /advancePreviewFrame/);
});

test('stage validation matrix reserves host sprites and executes generic patterns in either orientation', () => {
  const snapshot = service.readSnapshot(starterTemplate);
  const programs = new Map(snapshot.patterns.map((pattern) => [pattern.id, compiler.compilePattern(pattern).bytes]));
  for (const stage of snapshot.stages) {
    const matrix = simulator.runStageValidationMatrix(stage, programs, { frames: 720, ranks: [1], seeds: [0xace1], paths: ['center'] });
    assert.equal(matrix.ok, true, JSON.stringify(matrix.failures));
    assert.equal(matrix.cases.length, 1);
    assert.ok(matrix.maxima.pieces >= 1);
    assert.ok(matrix.maxima.dots >= 8);
    assert.match(matrix.cases[0].crc32, /^[0-9a-f]{8}$/);
  }
});

test('integrated Stage Preview runs BMLB patterns, player shots, boss phases, collision, and display budgets', () => {
  const pattern = schema.createPatternTemplate('aimed', 'stage-aimed');
  pattern.sprite.paletteFingerprint = 'p';
  const programs = new Map([[pattern.id, compiler.compilePattern(pattern).bytes]]);
  const bossStage = schema.normalizeStage({
    orientation: 'vertical',
    durationFrames: 180,
    events: [{
      id: 'boss', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'spawn_boss', bossId: 'test-boss' }, hp: 3, score: 500, patternId: pattern.id,
      path: [{ x: 160, y: 80, frame: 0 }],
      phases: [{ threshold: 100, patternId: pattern.id }, { threshold: 66, patternId: pattern.id }, { threshold: 33, patternId: pattern.id }],
    }],
  }, 'vertical');
  const previewSnapshot = {
    project: { rank: .5, bomb: {} },
    player: { initial: { lives: 3, bombs: 3, weaponId: 'test-shot', speed: 'normal' }, speeds: { slow: 96, normal: 160, fast: 224 }, animation: { vertical: { negative: 0, neutral: 1, positive: 2 }, horizontal: { negative: 3, neutral: 4, positive: 5 } } },
    pools: { playerShots: 24, enemies: 12, items: 8, effects: 20 },
    collections: {
      weapons: { entries: [{ id: 'test-shot', intervalFrames: 1, damage: 1, speed: 8, angle: 0, simultaneous: 24, emitters: [{ x: 0, y: -8, angle: 0 }] }] },
      bosses: { entries: [{ id: 'test-boss', hp: 3, score: 500, patternId: pattern.id, phases: bossStage.events[0].phases }] },
    },
  };
  const session = new StagePreviewSession(bossStage, programs, { snapshot: previewSnapshot, seed: 0xace1 });
  const defeated = session.step({ fire: true }, 80);
  assert.equal(defeated.score, 500);
  assert.equal(defeated.enemies.length, 0);
  assert.equal(defeated.metrics.phaseChanges, 2);
  assert.ok(defeated.metrics.maxima.bullets >= 1);
  assert.ok(defeated.metrics.maxima.globalSprites >= 2);
  assert.ok(defeated.metrics.maxima.pieces >= 1);
  assert.equal(defeated.metrics.hostBudgetOk, true);

  const sought = session.seek(10);
  assert.equal(sought.frame, 10);
  assert.equal(sought.score, 0);
  const dragged = session.step({ player: { x: 123, y: 145 } }, 0);
  assert.deepEqual({ x: dragged.player.x, y: dragged.player.y }, { x: 123, y: 145 });
  assert.equal(dragged.player.weaponId, 'test-shot');

  const collisionStage = schema.normalizeStage({
    orientation: 'vertical',
    durationFrames: 30,
    events: [{
      id: 'contact', order: 0, trigger: { type: 'frame', frame: 0 }, action: { type: 'spawn_enemy', enemyId: 'turret' }, hp: 99, score: 0, patternId: pattern.id,
      path: [{ x: 160, y: 196, frame: 0 }], phases: [],
    }],
  }, 'vertical');
  const collision = new StagePreviewSession(collisionStage, programs, { snapshot: previewSnapshot, seed: 1 }).step({}, 1);
  assert.equal(collision.lives, 2);
  assert.equal(collision.metrics.hits, 1);
  assert.equal(collision.bullets.length, 0);
  assert.equal(collision.invincible, 120);
});

test('Stage Preview service sessions use Project-fixed rank and are project-scoped', () => {
  const started = service.startStagePreview(starterTemplate, { stageId: 'stage-2-horizontal', rank: 1, seed: 0xffff });
  assert.equal(started.ok, true, started.error);
  assert.match(started.sessionId, /^[0-9a-f]{24}$/);
  assert.equal(started.preview.orientation, 'horizontal');
  assert.equal(started.preview.rank, 0.5);
  const stepped = service.stepStagePreview(starterTemplate, { sessionId: started.sessionId, frames: 12, input: { fire: true, right: true } });
  assert.equal(stepped.ok, true, stepped.error);
  assert.equal(stepped.preview.frame, 12);
  assert.ok(stepped.preview.player.x > 48);
  const sought = service.seekStagePreview(starterTemplate, { sessionId: started.sessionId, frame: 24 });
  assert.equal(sought.ok, true, sought.error);
  assert.equal(sought.preview.frame, 24);
  const otherRoot = tempProject();
  try {
    const crossed = service.stepStagePreview(otherRoot, { sessionId: started.sessionId, frames: 1 });
    assert.equal(crossed.ok, false);
    assert.match(crossed.error, /another project/);
  } finally { cleanup(otherRoot); }
  assert.deepEqual(service.stopStagePreview(starterTemplate, { sessionId: started.sessionId }), { ok: true, stopped: true });
  assert.equal(service.stepStagePreview(starterTemplate, { sessionId: started.sessionId, frames: 1 }).ok, false);
});

test('builder generates deterministic BMLB, fixed mini-STG assets, explicit C sources, runtime proof, and preserves rom_head', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-build-'));
  try {
    fs.cpSync(starterTemplate, root, { recursive: true });
    const romHead = path.join(root, 'src', 'boot', 'rom_head.c');
    fs.mkdirSync(path.dirname(romHead), { recursive: true });
    fs.writeFileSync(romHead, '/* keep me */\n');
    {
      const bulletPath = path.join(root, 'res', 'gfx', 'bml_bullet.png');
      const bulletBefore = fs.readFileSync(bulletPath);
      const v2Result = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 180 });
      assert.equal(v2Result.ok, true, v2Result.error);
      assert.equal(fs.readFileSync(romHead, 'utf8'), '/* keep me */\n');
      assert.deepEqual(v2Result.makeVariables.SRC_C.split(' '), builder.SOURCE_FILES);
      assert.equal(new Set(builder.SOURCE_FILES).size, builder.SOURCE_FILES.length);
      assert.equal(builder.SOURCE_FILES.some((source) => /rom_head|sega\.s/.test(source)), false);
      for (const source of builder.SOURCE_FILES) assert.equal(fs.existsSync(path.join(root, source)), true, source);
      assert.deepEqual(fs.readFileSync(bulletPath), bulletBefore, 'Build must preserve registered ResComp assets');

      const proof = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bulletml', 'proof.json'), 'utf8'));
      assert.equal(proof.schemaVersion, 2);
      assert.equal(proof.sgdk, '2.11');
      assert.equal(proof.abi, 'BMLB ABI v1');
      assert.equal(proof.patterns.length, 5);
      assert.equal(proof.stages.length, 4);
      assert.ok(proof.stages.every((stage) => stage.cases.length === 27));
      assert.equal(proof.runtime.loadProbe.ok, true);
      assert.deepEqual(proof.runtime.catalogs, { patterns: 5, stages: 4, weapons: 3, items: 5, effects: 3, explosions: 2, movements: 4, enemies: 3, bosses: 3, backgrounds: 4, materials: 3, collisions: 4, demoScenes: 11, demoFlags: 4 });
      assert.equal(proof.runtime.demo.scenes, 11);
      assert.equal(proof.runtime.demo.glyphs, 179);
      assert.equal(proof.runtime.vram.staticGameplayTiles, 513);
      assert.equal(proof.runtime.vram.demoMaxTiles, 878);
      assert.equal(proof.runtime.vram.withinBudget, true);
      assert.equal(proof.runtime.collision.length, 4);
      assert.ok(proof.runtime.collision.every((entry) => entry.rleBytes < entry.rawBytes));

      const gameRuntime = fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_game.c'), 'utf8');
      for (const contract of [
        /MAP_create/, /MAP_scrollTo/, /PAL_fadeOutAll/, /BML_removeBullet/, /enterHighScoreName/,
        /ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/, /saveCrc/, /SRAM_writeByte/, /checkpointValid/,
        /novelStartScene/, /novelShutdown/, /activePartMask/, /activeWaveStartFrame/,
        /material->mask & 1/, /material->mask & 2/, /material->mask & 4/, /material->mask & 8/,
      ]) assert.match(gameRuntime, contract);
      assert.doesNotMatch(gameRuntime, /EASY|NORMAL RANK|HARD/);
      const runtime = fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_runtime.c'), 'utf8');
      assert.doesNotMatch(runtime, /\b(?:malloc|calloc|realloc|free)\s*\(/);
      assert.doesNotMatch(runtime, /\b(?:float|double)\b/);
      assert.match(runtime, /bool BML_removeBullet\(u16 index\)/);

      for (const relative of ['res/novel.res', 'res/novel/font/generated.png', 'src/generated/novel_data.c', 'src/novel_runtime/novel_runtime.c', 'inc/generated/novel_data.h']) assert.ok(fs.statSync(path.join(root, relative)).size > 32, relative);
      const catalog = fs.readFileSync(path.join(root, 'src', 'generated', 'bulletml_catalog.c'), 'utf8');
      assert.match(catalog, /stage-1-vertical/);
      assert.match(catalog, /stage-2-horizontal/);
      assert.match(catalog, /stage-3-giant/);
      assert.match(catalog, /caravan-abyss/);
      assert.match(catalog, /abyss_tiles/);
      assert.match(catalog, /bml_sfx_hit, sizeof\(bml_sfx_hit\), FALSE \}/);
      assert.match(catalog, /bml_sfx_destroy, sizeof\(bml_sfx_destroy\), \{/);
      return;
    }
    const result = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 180 });
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(romHead, 'utf8'), '/* keep me */\n');
    const sources = result.makeVariables.SRC_C.split(' ');
    assert.deepEqual(sources, builder.SOURCE_FILES);
    assert.equal(new Set(sources).size, sources.length);
    assert.equal(sources.some((source) => /rom_head|sega\.s/.test(source)), false);
    for (const source of sources) assert.equal(fs.existsSync(path.join(root, source)), true, source);

    const generic = fs.readFileSync(path.join(root, 'res', 'bulletml', 'generated', 'generic-aimed.bmlb'));
    assert.equal(generic.toString('ascii', 0, 4), 'BMLB');
    const bulletmlResources = fs.readFileSync(path.join(root, 'res', 'bulletml.res'), 'utf8');
    assert.match(bulletmlResources, /BIN bmlb_generic_aimed/);
    assert.match(bulletmlResources, /BIN bml_internal_diagnostic_burst "bulletml\/internal\/diagnostic-burst-v1\.bmlb"/);
    assert.match(bulletmlResources, /BIN bml_internal_diagnostic_idle "bulletml\/internal\/diagnostic-idle-v1\.bmlb"/);
    for (const resource of builder.DIAGNOSTIC_LOAD_RESOURCES) {
      const bytes = fs.readFileSync(path.join(root, resource.relative));
      assert.equal(bytes.toString('ascii', 0, 4), 'BMLB', resource.relative);
    }
    for (const relative of ['res/gfx/bml_bg_vertical.png', 'res/gfx/bml_bg_horizontal.png', 'res/gfx/bulletml_bullet.png', 'res/gfx/bml_boss.png', 'res/audio/bml_vertical.vgm', 'res/audio/bml_horizontal.vgm', 'res/audio/bml_shot.wav']) {
      assert.ok(fs.statSync(path.join(root, relative)).size > 32, relative);
    }
    const gameResources = fs.readFileSync(path.join(root, 'res', 'bulletml_game.res'), 'utf8');
    assert.match(gameResources, /IMAGE bml_bg_vertical "gfx\/bml_bg_vertical\.png" NONE ALL 0/);
    assert.match(gameResources, /IMAGE bml_bg_horizontal "gfx\/bml_bg_horizontal\.png" NONE ALL 0/);
    const bulletPath = path.join(root, 'res', 'gfx', 'bml_bullet.png');
    const userEditedBullet = builder.staticAssets()['res/gfx/bml_player_shot.png'];
    fs.writeFileSync(bulletPath, userEditedBullet);
    const rebuilt = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 30 });
    assert.equal(rebuilt.ok, true, rebuilt.error);
    assert.deepEqual(fs.readFileSync(bulletPath), userEditedBullet, 'Build must preserve the editable bullet sprite');

    const runtimeHeader = fs.readFileSync(path.join(root, 'inc', 'bulletml', 'bulletml_runtime.h'), 'utf8');
    for (const api of ['BML_init', 'BML_startEmitter', 'BML_updateEmitter', 'BML_stopEmitter', 'BML_setPlayer', 'BML_tick', 'BML_applyDisplayBudget', 'BML_getBullets', 'BML_clearAll', 'BML_getMetrics']) assert.match(runtimeHeader, new RegExp('\\b' + api + '\\b'));
    assert.match(runtimeHeader, /BML_applyDisplayBudget\(u16 reservedGlobalSprites, const u8 \*reservedPiecesByScanline, const u16 \*reservedDotsByScanline\)/);
    const runtime = fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_runtime.c'), 'utf8');
    assert.doesNotMatch(runtime, /\b(?:malloc|calloc|realloc|free)\s*\(/);
    assert.doesNotMatch(runtime, /\b(?:float|double)\b/);
    assert.match(fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_lut.c'), 'utf8'), /BML_sinQ14\[1024\]/);

    const proof = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bulletml', 'proof.json'), 'utf8'));
    assert.equal(proof.sgdk, '2.11');
    assert.equal(proof.abi, 'BMLB ABI v1');
    assert.equal(proof.patterns.length, 5);
    assert.equal(proof.stages.length, 2);
    assert.ok(proof.stages.every((stage) => stage.cases.length === 27));
    assert.equal(proof.runtime.selfTestFrames, 10000);
    assert.match(proof.runtime.selfTestExpectedCrc, /^[0-9a-f]{8}$/);
    assert.equal(proof.runtime.loadProbe.ok, true);
    assert.equal(proof.runtime.loadProbe.frames, 140);
    assert.equal(proof.runtime.vram.backgroundTiles.vertical, 30);
    assert.equal(proof.runtime.vram.backgroundTiles.horizontal, 30);
    assert.equal(proof.runtime.vram.worstCaseHardwareSprites, 62);
    assert.equal(proof.runtime.vram.withinBudget, true);
    assert.deepEqual(
      {
        bullets: proof.runtime.loadProbe.maxima.bullets,
        emitters: proof.runtime.loadProbe.maxima.emitters,
        spawns: proof.runtime.loadProbe.maxima.spawns,
      },
      { bullets: 48, emitters: 5, spawns: 16 },
    );
    assert.deepEqual(proof.runtime.loadProbe.drops, { fire: 0, pool: 0, spawn: 0, context: 0, opcodeExhaustions: 0, displayDeletes: 0 });
    assert.ok(proof.runtime.loadProbe.maxima.globalSprites <= 80);
    assert.ok(proof.runtime.loadProbe.maxima.pieces <= 20);
    assert.ok(proof.runtime.loadProbe.maxima.dots <= 320);
    assert.equal(proof.bulletSprite.paletteFingerprint, 'cce12cad8ccc47caa0c3eca35268bc94e066d3abb926c997913ffec55ec3f170');
    assert.equal(proof.bulletSprite.frameWidth, 8);
    assert.match(proof.bulletSprite.sha256, /^[0-9a-f]{64}$/);
    const catalogHeader = fs.readFileSync(path.join(root, 'inc', 'generated', 'bulletml_catalog.h'), 'utf8');
    assert.match(catalogHeader, /BML_SELF_TEST_EXPECTED_CRC/);
    assert.match(catalogHeader, /BML_BULLET_FRAME_COUNT 1/);
    assert.match(catalogHeader, /BML_DIAGNOSTIC_BURST_SIZE 107/);
    assert.match(catalogHeader, /BML_DIAGNOSTIC_IDLE_SIZE 51/);
    assert.match(catalogHeader, /BML_DIAGNOSTIC_LOAD_FRAMES 140/);
    const catalog = fs.readFileSync(path.join(root, 'src', 'generated', 'bulletml_catalog.c'), 'utf8');
    assert.doesNotMatch(catalog, /sizeof\(bmlb_/);
    assert.match(catalog, /\{ bmlb_generic_aimed, 109,/);
    const gameRuntime = fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_game.c'), 'utf8');
    assert.match(gameRuntime, /runLoadProbe/);
    assert.match(gameRuntime, /C: RUN FULL QA/);
    assert.match(gameRuntime, /RUNNING FULL QA/);
    assert.match(gameRuntime, /pressed & BUTTON_C[\s\S]*runDiagnostics\(\)/);
    const gameRunStart = gameRuntime.indexOf('void BML_gameRun(void)');
    const gameRunLoop = gameRuntime.indexOf('while (TRUE)', gameRunStart);
    assert.ok(gameRunStart >= 0 && gameRunLoop > gameRunStart);
    assert.doesNotMatch(gameRuntime.slice(gameRunStart, gameRunLoop), /runSelfTest\s*\(|runLoadProbe\s*\(/);
    assert.match(gameRuntime, /bmlQaLoadMaxBullets == BML_MAX_BULLETS/);
    assert.match(gameRuntime, /XGM2_play\(bml_bgm_vertical\)/);
    assert.match(gameRuntime, /horizontal \? &bml_bg_horizontal : &bml_bg_vertical/);
    assert.match(gameRuntime, /VDP_drawImageEx\(BG_B, background, TILE_ATTR_FULL\(PAL0/);
    assert.match(gameRuntime, /VDP_loadTileSet\(animationFrame->tileset, nextTile, DMA\)/);
    assert.match(gameRuntime, /SPR_addSpriteEx\(&bml_bullet,[\s\S]*bulletFrameTileIndexes\[0\][\s\S]*, 0\)/);
    assert.match(gameRuntime, /SPR_setVRAMTileIndex\(bulletSprites\[index\], bulletFrameTileIndexes\[frame\]\)/);
    assert.doesNotMatch(gameRuntime, /bulletSprites\[index\] = SPR_addSprite\(&bml_bullet/);
    assert.match(gameRuntime, /BML_applyDisplayBudget\(6, reservedPieces, reservedDots\)/);
    assert.match(gameRuntime, /bmlQaLoadVBlankFrames == BML_DIAGNOSTIC_LOAD_FRAMES/);
    assert.match(gameRuntime, /bmlQaLoadMaxFrameSubticks <= BML_DIAGNOSTIC_NTSC_SUBTICKS_PER_FRAME/);
    const wasmProofScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'verify-bulletml-stg-wasm.js'), 'utf8');
    assert.match(wasmProofScript, /const BUTTON_C = 1 << 5/);
    assert.match(wasmProofScript, /tick\(BUTTON_C\)/);
    assert.match(wasmProofScript, /defaultBootReachedTitleWithinOneSecond/);
    assert.match(wasmProofScript, /game-start-without-qa/);
    assert.match(wasmProofScript, /defaultBootStartedVisibleGameplayWithoutDiagnostics/);
    assert.match(wasmProofScript, /loadMaxFrameSubticks <= buildProof\.runtime\.loadProbe\.expected\.subticksPerFrame/);
    assert.match(wasmProofScript, /runtimeRamVramWithinBudget/);
    assert.match(wasmProofScript, /BulletML WASM proof failed/);
  } finally { cleanup(root); }
});

test('builder derives static RAM headroom from SGDK symbols', () => {
  const proof = builder.parseLinkerRamSymbols('e0ff0044 D _edata\ne0ff0044 B _start\ne0ff8462 B _bend\n');
  assert.equal(proof.initializedBytes, 0x44);
  assert.equal(proof.bssBytes, 0x841e);
  assert.equal(proof.staticBytes, 0x8462);
  assert.equal(proof.stackReserveBytes, 0x0a00);
  assert.equal(proof.heapBytesBeforeRuntimeAllocation, 0x719c);
  assert.equal(proof.withinBudget, true);
});

test('builder rejects malformed or non-indexed editable bullet sprite assets without replacing them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-asset-'));
  try {
    fs.cpSync(starterTemplate, root, { recursive: true });
    const first = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 30 });
    assert.equal(first.ok, true, first.error);
    const bulletPath = path.join(root, 'res', 'gfx', 'bml_bullet.png');
    const malformed = Buffer.from('not-a-png');
    fs.writeFileSync(bulletPath, malformed);
    const rejected = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 30 });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /PNG signature/);
    assert.deepEqual(fs.readFileSync(bulletPath), malformed);
  } finally { cleanup(root); }
});

test('builder accepts a 32px one-piece asset contract while runtime shares its tiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdge-bulletml-shared-vram-'));
  try {
    fs.cpSync(starterTemplate, root, { recursive: true });
    const first = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 30 });
    assert.equal(first.ok, true, first.error);
    const replacement = builder.staticAssets()['res/gfx/bml_boss.png'];
    const sprite = { frameWidth: 32, frameHeight: 32, frameCount: 1, hardwarePieces: 1, tileCount: 16, paletteFingerprint: builder.parseIndexedPng(replacement).paletteFingerprint };
    const projectPath = path.join(root, 'data', 'bulletml', 'project.json');
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    Object.assign(project.defaultSprite, sprite);
    fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    const patternDir = path.join(root, 'data', 'bulletml', 'patterns');
    for (const name of fs.readdirSync(patternDir).filter((entry) => entry.endsWith('.json'))) {
      const target = path.join(patternDir, name);
      const pattern = JSON.parse(fs.readFileSync(target, 'utf8'));
      Object.assign(pattern.sprite, sprite);
      fs.writeFileSync(target, `${JSON.stringify(pattern, null, 2)}\n`);
    }
    fs.writeFileSync(path.join(root, 'res', 'gfx', 'bml_bullet.png'), replacement);
    const loaded = service.loadProject(root);
    assert.equal(loaded.ok, true, loaded.error);
    const config = builder.bulletSpriteConfig(loaded.snapshot, root);
    const asset = builder.validateBulletSpriteAsset(root, loaded.snapshot, config);
    assert.equal(asset.frameWidth, 32);
    assert.equal(asset.frameHeight, 32);
    assert.equal(asset.tileCount, 16);
    const runtime = fs.readFileSync(path.join(root, 'src', 'bulletml', 'bulletml_game.c'), 'utf8');
    assert.match(runtime, /SPR_addSpriteEx\(&BML_BULLET_SPRITE/);
    assert.doesNotMatch(runtime, /bulletSprites\[index\] = SPR_addSprite\(/);
  } finally { cleanup(root); }
});

test('builder rejects an invalid draft before synchronizing runtime files', () => {
  const root = tempProject();
  try {
    service.saveProject(root, { project: schema.DEFAULT_PROJECT, editorState: schema.DEFAULT_EDITOR_STATE });
    const invalid = schema.createPatternTemplate('blank', 'invalid-build');
    invalid.definitions[0].commands.push({ op: 'wait', value: '-1' });
    service.savePattern(root, { pattern: invalid, baseRevision: '' });
    const result = builder.onBuildStart({ projectDir: root }, { projectDir: root, assets: [], bulletmlValidationFrames: 30 });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(root, 'src', 'bulletml', 'bulletml_runtime.c')), false);
  } finally { cleanup(root); }
});
