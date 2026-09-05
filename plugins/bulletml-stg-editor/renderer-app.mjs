import { buildShell, escapeHtml, formatJson, optionList } from './editor-ui.mjs';
import { createV2DocumentEditor } from './v2-document-editor.mjs';
import { mountSharedVnEditor } from '../shared/md-vn/editor-component.mjs';
import { applyStructuredArrayAction, applyStructuredField, renderStructuredForm } from '../shared/structured-form.mjs';
import {
  commandMeta, definitionMeta, japaneseValue, patternArrayTemplate, patternFieldMeta,
  stgArrayTemplate, stgFieldMeta,
} from './ui-localization.mjs';
import {
  PatternHistory, addBossPhase, advancePreviewFrame, clone, commandSummary, defaultCommand,
  filterDefinitions, filterPatterns, getPath, graphEdges, graphLayout, pathArray, pathKey,
  removeBossPhase, stagePathsForMode,
} from './editor-model.mjs';

const COMMANDS = ['fire', 'wait', 'repeat', 'vanish', 'changeDirection', 'changeSpeed', 'actionRef', 'fireRef'];
const DEFINITION_KINDS = ['action', 'fire', 'bullet'];

function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function integerText(value, fallback = 0) {
  const text = String(value ?? '').trim();
  const result = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
  return Number.isFinite(result) ? Math.trunc(result) : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value))); }
function definitionKey(value) { return value ? `${value.kind}:${value.label}` : ''; }
function parseDefinitionKey(value) { const index = String(value || '').indexOf(':'); return index < 0 ? { kind: '', label: '' } : { kind: value.slice(0, index), label: value.slice(index + 1) }; }

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.classList.add('bulletml-stg-editor-page');
  root.tabIndex = 0;
  root.innerHTML = buildShell();
  const role = (name) => root.querySelector(`[data-role="${name}"]`);
  const elements = {
    dirty: role('dirty'), status: role('status'), patternWorkspace: role('pattern-workspace'), template: role('template'),
    patternList: role('pattern-list'), patternFilter: role('pattern-filter'), patternTypeFilter: role('pattern-type-filter'), patternCount: role('pattern-count'),
    patternName: role('pattern-name'), patternType: role('pattern-type'), patternId: role('pattern-id'), patternSettingsForm: role('pattern-settings-form'), patternAssets: role('pattern-assets'), patternAssetPreview: role('pattern-asset-preview'),
    definitionList: role('definition-list'), definitionFilter: role('definition-filter'), definitionCount: role('definition-count'), deletedList: role('deleted-list'),
    editTitle: role('edit-title'), structured: role('structured'), graph: role('graph'), graphSvg: role('graph-svg'), graphEdges: role('graph-edges'), graphNodes: role('graph-nodes'),
    commandKind: role('command-kind'), preview: role('preview'), play: role('play'), previewLoop: role('preview-loop'), rank: role('rank'), seed: role('seed'), orientation: role('orientation'), frame: role('frame'), metrics: role('metrics'), heatmap: role('heatmap'),
    selectionLabel: role('selection-label'), commandForm: role('command-form'), inspector: role('inspector'), expressionPath: role('expression-path'), exprConstant: role('expr-constant'), exprCoefficient: role('expr-coefficient'), exprVariable: role('expr-variable'), exprAdvanced: role('expr-advanced'), exprDiagnostic: role('expr-diagnostic'), refKind: role('ref-kind'), refTarget: role('ref-target'), refDiagnostic: role('ref-diagnostic'),
    diagnostics: role('diagnostics'), xml: role('xml'), sidecar: role('sidecar'),
    eventList: role('event-list'), timeline: role('timeline'), stagePreview: role('stage-preview'), stageFrame: role('stage-frame'), stagePlay: role('stage-play'), stageMetrics: role('stage-metrics'), stageSelect: role('stage-select'), stageOrientationLabel: role('stage-orientation-label'), stageRank: role('stage-rank'), stageSeed: role('stage-seed'), stageDeletedList: role('stage-deleted-list'), stageSettingsForm: role('stage-settings-form'), stageAssets: role('stage-assets'), stageAssetPreview: role('stage-asset-preview'), stageForm: role('stage-form'), stageInspector: role('stage-inspector'), phaseSummary: role('phase-summary'), stageDiagnostics: role('stage-diagnostics'),
    vnEditorMount: role('vn-editor-mount'), projectDiagnostics: role('project-diagnostics'),
  };
  const state = {
    snapshot: null, templates: {}, validation: null, history: null, selectedPatternId: '', selectedDefinitionKey: '', selectedCommandPath: '',
    patternFilter: '', patternTypeFilter: 'all', definitionFilter: 'all',
    page: 'project', side: 'inspector', dirty: false, editorDirty: false, catalogDirty: false, demoDirty: false, loading: false, pendingAction: null, wasActive: root.classList.contains('active'),
    editorState: null, preview: { trace: [], index: 0, playing: false, loop: true, generation: 0, emitter: { x: 160, y: 28 }, player: { x: 160, y: 196 }, drag: '', lastTime: 0, compiledHash: '', crc32: '' },
    xmlSidecar: null, xmlGeneration: 0, compileTimer: null, patternAssetPreviewKey: '',
    stageOrientation: 'vertical', selectedStageId: '', stageDraft: null, stageDirty: false, selectedEventIndex: -1, stagePathMode: 'selected',
    stageRuntime: { playing: false, lastTime: 0, sessionId: '', snapshot: null, generation: 0, pending: false, diagnostics: true, stageHash: '', assetPreviewKey: '' },
    stageSeekTimer: null, stageRestartTimer: null,
    keys: new Set(), graphDrag: null, graphPan: null, resize: null, v2Editor: null, demoEditor: null, demoDraft: null, demoRevisions: null,
  };
  const guard = api.createModal({
    id: `${plugin.id}-dirty-guard`,
    html: `<div class="settings-form compact-form bml-guard"><h3>未保存の変更</h3><p>現在のBulletML draftを保存しますか？ 不完全draftも保存できますがBuildは拒否されます。</p><div><button data-choice="save" class="primary">保存</button><button data-choice="discard">破棄</button><button data-choice="cancel">キャンセル</button></div></div>`,
  });

  function currentPattern() { return state.history?.present || null; }
  function selectedDefinition() { const key = parseDefinitionKey(state.selectedDefinitionKey); return currentPattern()?.definitions?.find((item) => item.kind === key.kind && item.label === key.label) || null; }
  function selectedDefinitionIndex() { const key = parseDefinitionKey(state.selectedDefinitionKey); return currentPattern()?.definitions?.findIndex((item) => item.kind === key.kind && item.label === key.label) ?? -1; }
  function selectedCommand() { return state.selectedCommandPath ? getPath(currentPattern(), state.selectedCommandPath) || null : null; }
  function selectedStage() { return state.snapshot?.stages?.find((item) => item.id === state.selectedStageId) || state.snapshot?.stages?.[0] || null; }
  function selectedEvent() { return state.stageDraft?.events?.[state.selectedEventIndex] || null; }
  function setStatus(message, tone = '') { elements.status.textContent = String(message || ''); elements.status.dataset.tone = tone; }
  function setDirty(value) { state.dirty = Boolean(value); updateDirty(); }
  function setEditorDirty(value) { state.editorDirty = Boolean(value); updateDirty(); }
  function updateDirty() { elements.dirty.textContent = state.dirty || state.stageDirty || state.editorDirty || state.catalogDirty || state.demoDirty ? '● 未保存' : ''; }

  function setCatalogDirty(value) { state.catalogDirty = Boolean(value); updateDirty(); }
  function renderProjectDiagnostics() {
    const diagnostics = state.validation?.diagnostics || [];
    const errors = diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = diagnostics.filter((item) => item.severity === 'warning').length;
    elements.projectDiagnostics.innerHTML = `<header><strong>${errors ? 'ビルドできません' : 'ビルド可能です'}</strong><span>エラー ${errors}件 / 警告 ${warnings}件</span><span>データ形式 v${escapeHtml(state.snapshot?.project?.schemaVersion || 2)}</span><span>固定難度 ${escapeHtml(state.snapshot?.project?.rank ?? .5)}</span></header><div>${diagnostics.map((item) => `<article data-severity="${escapeHtml(item.severity)}"><strong>${escapeHtml(item.code)}</strong><code>${escapeHtml(item.path)}</code><p>${escapeHtml(item.message)}</p></article>`).join('') || '<p class="bml-empty">問題は見つかりませんでした。</p>'}</div>`;
  }

  function adoptV2Snapshot(result) {
    if (!result?.snapshot) return;
    state.snapshot = result.snapshot;
    state.validation = result.validation || state.validation;
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    renderProjectDiagnostics();
  }

  function mountDemoEditor(demoEditor, force = false) {
    if (!demoEditor || (state.demoDirty && !force)) return;
    state.demoEditor?.destroy?.();
    state.demoDraft = clone({ sceneDocument: demoEditor.sceneDocument, bindings: demoEditor.bindings });
    state.demoRevisions = clone(demoEditor.revisions || {});
    state.demoDirty = false;
    state.demoEditor = mountSharedVnEditor({
      root: elements.vnEditorMount,
      sceneDocument: state.demoDraft.sceneDocument,
      bindings: state.demoDraft.bindings,
      onChange(next) { state.demoDraft = clone(next); state.demoDirty = true; updateDirty(); },
    });
  }

  function applyPaneSizes() {
    const panes = state.editorState?.panes || { left: 260, right: 340, preview: 330 };
    elements.patternWorkspace.style.gridTemplateColumns = `${clamp(panes.left, 180, 520)}px 5px minmax(380px,1fr) 5px ${clamp(panes.right, 260, 560)}px`;
    root.querySelector('.bml-center-pane').style.gridTemplateRows = `minmax(220px,1fr) 5px ${clamp(panes.preview, 260, 560)}px`;
  }

  function adoptSnapshot(result, options = {}) {
    state.snapshot = result.snapshot;
    state.validation = result.validation || state.validation;
    state.templates = result.templates || state.templates;
    state.editorState = clone(state.snapshot.editorState);
    state.page = state.editorState.page || state.page;
    if (!root.querySelector(`[data-section="${state.page}"]`)) state.page = 'project';
    const requested = options.patternId || state.selectedPatternId || state.editorState.selectedPatternId;
    const pattern = state.snapshot.patterns.find((item) => item.id === requested) || state.snapshot.patterns[0] || null;
    state.selectedPatternId = pattern?.id || '';
    state.history = pattern ? new PatternHistory(pattern, 100) : null;
    const requestedDefinition = options.definitionKey || state.selectedDefinitionKey;
    state.selectedDefinitionKey = pattern?.definitions?.some((item) => definitionKey(item) === requestedDefinition) ? requestedDefinition : definitionKey(pattern?.definitions?.[0]);
    const requestedCommandPath = options.commandPath || state.editorState.selectedCommandPath || '';
    state.selectedCommandPath = requestedCommandPath && getPath(pattern, requestedCommandPath) ? requestedCommandPath : '';
    state.preview.loop = state.editorState.previewLoop !== false;
    state.stagePathMode = ['selected', 'all'].includes(state.editorState.stagePathMode) ? state.editorState.stagePathMode : 'selected';
    elements.previewLoop.checked = state.preview.loop;
    const requestedStageId = options.stageId || state.editorState.selectedStageId || state.selectedStageId;
    state.selectedStageId = state.snapshot.stages.some((stage) => stage.id === requestedStageId) ? requestedStageId : state.snapshot.stages[0]?.id || '';
    state.stageDraft = clone(selectedStage());
    state.stageOrientation = state.stageDraft?.orientation || 'vertical';
    state.selectedEventIndex = -1;
    state.stageDirty = false;
    state.editorDirty = false;
    setDirty(false);
    applyPaneSizes();
    if (!state.v2Editor) {
      state.v2Editor = createV2DocumentEditor({ root, api, pluginId: plugin.id, snapshot: state.snapshot, validation: state.validation, onSnapshot: adoptV2Snapshot, onDirty: setCatalogDirty, onStatus: setStatus });
    } else state.v2Editor.setSnapshot(state.snapshot, state.validation);
    mountDemoEditor(result.demoEditor, true);
  }

  function renderPatternList() {
    const patterns = state.snapshot?.patterns || [];
    const draft = currentPattern();
    const all = patterns.map((item) => item.id === draft?.id ? draft : item);
    if (state.dirty && draft && !all.some((item) => item.id === draft.id)) all.push(draft);
    const visible = filterPatterns(all, state.patternFilter, state.patternTypeFilter);
    elements.patternList.innerHTML = visible.map((pattern) => `<div class="bml-list-row ${pattern.id === state.selectedPatternId ? 'active' : ''}"><button data-action="select-pattern" data-id="${escapeHtml(pattern.id)}" title="${escapeHtml(pattern.name)}を編集"><strong>${escapeHtml(pattern.name)}</strong><small>${escapeHtml(japaneseValue(pattern.type))} · 安定ID: ${escapeHtml(pattern.id)}</small></button>${pattern.id === state.selectedPatternId ? '<button data-action="delete-pattern" title="復元可能な削除済み領域へ退避">×</button>' : ''}</div>`).join('') || '<p class="bml-empty">条件に一致する弾幕パターンがありません。</p>';
    elements.patternCount.textContent = `${visible.length}/${all.length}`;
    elements.patternName.value = draft?.name || '';
    elements.patternType.value = draft?.type || 'none';
    elements.patternId.textContent = draft?.id || '-';
    elements.patternName.disabled = !draft;
    elements.patternType.disabled = !draft;
    root.querySelector('[data-action="apply-pattern-metadata"]').disabled = !draft;
    elements.deletedList.innerHTML = (state.snapshot?.deleted || []).map((item) => `<button data-action="restore-pattern" data-file="${escapeHtml(item.fileName)}">復元: ${escapeHtml(item.pattern.name)}</button>`).join('') || '<small>削除済みパターンなし</small>';
  }

  function renderPatternSettings() {
    const pattern = currentPattern();
    if (!pattern) {
      elements.patternSettingsForm.innerHTML = '<p class="bml-empty">弾幕パターンを選択してください。</p>';
      elements.patternAssets.innerHTML = '';
      elements.patternAssetPreview.innerHTML = '<p class="bml-empty">弾画像を選択すると、ここへ自動的にプレビューします。</p>';
      return;
    }
    const settings = {
      sprite: pattern.sprite,
      hitbox: pattern.hitbox,
      lifetime: pattern.lifetime,
      margin: pattern.margin,
    };
    elements.patternSettingsForm.innerHTML = renderStructuredForm(settings, {
      scope: 'pattern-settings',
      resolveMeta: (path, value, key) => stgFieldMeta(['pattern', ...path], value, key, { snapshot: state.snapshot }),
    });
    const reference = pattern.sprite?.asset || { symbol: '', type: 'SPRITE', animationRow: 0 };
    elements.patternAssets.innerHTML = `<article class="bml-v2-asset active" title="選択した弾画像を下へ自動プレビューします"><header><strong>敵弾スプライト</strong><span>SPRITE</span></header><code>${escapeHtml(reference.symbol || '未選択')}</code><div><button data-action="pick-pattern-sprite" title="ResComp登録済みスプライトから弾画像を選択">スプライトを選択</button><button data-action="open-pattern-sprite" ${reference.symbol ? '' : 'disabled'} title="選択済みの弾画像をスプライトエディターで開く">スプライトエディターで開く</button></div><label title="スプライトエディターで登録したアニメーション行番号">アニメーション行 <input type="number" min="0" step="1" data-role="pattern-animation-row" value="${escapeHtml(reference.animationRow ?? 0)}"></label></article>`;
    void mountPatternSpritePreview();
  }

  function renderDefinitionList() {
    const pattern = currentPattern();
    const all = pattern?.definitions || [];
    const visible = filterDefinitions(all, state.definitionFilter);
    elements.definitionList.innerHTML = visible.map((definition) => {
      const meta = definitionMeta(definition.kind);
      return `<div class="bml-list-row ${definitionKey(definition) === state.selectedDefinitionKey ? 'active' : ''}"><button data-action="select-definition" data-key="${escapeHtml(definitionKey(definition))}" title="${escapeHtml(meta[1])}"><span class="kind ${definition.kind}">${definition.kind[0].toUpperCase()}</span><strong>${escapeHtml(definition.label)}</strong><small>${definition.kind === 'action' ? `命令 ${definition.commands?.length || 0}件` : escapeHtml(meta[0])}</small></button><button data-action="delete-definition" data-key="${escapeHtml(definitionKey(definition))}" title="この定義を削除">×</button></div>`;
    }).join('') || '<p class="bml-empty">この種別の定義はありません。</p>';
    elements.definitionCount.textContent = `${visible.length}/${all.length}`;
  }

  function renderNestedCommandContent(command, commandPath, depth) {
    if (depth >= 4) return '';
    if (command?.op === 'repeat') {
      if (command.action?.ref) return `<div class="bml-ref-chip">動作参照 → ${escapeHtml(command.action.ref)}</div>`;
      return renderCommandList(command.action?.commands || [], [...commandPath, 'action', 'commands'], depth + 1, '繰り返す内包動作');
    }
    if (command?.op === 'fire') {
      if (command.bullet?.ref) return `<div class="bml-ref-chip">弾定義参照 → ${escapeHtml(command.bullet.ref)}</div>`;
      return (command.bullet?.inline?.actions || []).map((binding, index) => binding.ref
        ? `<div class="bml-ref-chip">弾の動作 ${index + 1} → ${escapeHtml(binding.ref)}</div>`
        : renderCommandList(binding.commands || [], [...commandPath, 'bullet', 'inline', 'actions', index, 'commands'], depth + 1, `弾の動作 ${index + 1}`)).join('');
    }
    return '';
  }

  function renderCommandList(commands, listPath, depth = 0, label = '命令') {
    const listKey = pathKey(listPath);
    const rows = (commands || []).map((command, index) => {
      const commandPath = [...listPath, index]; const commandKey = pathKey(commandPath);
      const meta = commandMeta(command.op);
      return `<article class="bml-command ${commandKey === state.selectedCommandPath ? 'selected' : ''}" data-command-path="${escapeHtml(commandKey)}" style="--bml-depth:${depth}">
        <button data-action="select-command" data-command-path="${escapeHtml(commandKey)}" title="${escapeHtml(meta[1])}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(meta[0])}</strong><small>${escapeHtml(commandSummary(command))}</small></button>
        <div><button data-action="move-command" data-command-path="${escapeHtml(commandKey)}" data-delta="-1" title="上へ">↑</button><button data-action="move-command" data-command-path="${escapeHtml(commandKey)}" data-delta="1" title="下へ">↓</button><button data-action="delete-command" data-command-path="${escapeHtml(commandKey)}" title="削除">×</button></div>
        ${renderNestedCommandContent(command, commandPath, depth)}
      </article>`;
    }).join('');
    return `<section class="bml-command-group" data-list-path="${escapeHtml(listKey)}"><header><strong>${escapeHtml(label)}</strong><button data-action="add-command-to-list" data-list-path="${escapeHtml(listKey)}">命令＋</button></header>${rows || '<p class="bml-empty">命令がありません。</p>'}</section>`;
  }

  function renderDefinitionMetadata(definition) {
    const isRoot = definition.kind === 'action' && (currentPattern()?.rootActions || []).includes(definition.label);
    return `<div class="bml-definition-metadata">
      <span class="kind ${definition.kind}" title="${escapeHtml(definitionMeta(definition.kind)[1])}">${escapeHtml(definitionMeta(definition.kind)[0])}</span>
      <label title="他の定義から参照するときに使う名前です">定義名 <input data-role="definition-label" value="${escapeHtml(definition.label)}"></label>
      ${definition.kind === 'action' ? `<label class="bml-toggle" title="パターン開始時に直接実行する動作です"><input data-role="definition-root" type="checkbox" ${isRoot ? 'checked' : ''}> 開始動作</label>` : ''}
      <button data-action="apply-definition-metadata" title="定義名を変えると参照元も一括更新します">定義名を反映</button>
    </div>`;
  }

  function renderMotionFields(definition) {
    const direction = definition.direction; const speed = definition.speed;
    return `<div class="bml-motion-grid">
      <fieldset><legend title="弾を発射する方向です">発射方向</legend><label class="bml-toggle"><input data-role="definition-direction-enabled" type="checkbox" ${direction ? 'checked' : ''}> 使用</label><label title="狙い／絶対角／相対角／連続差分">基準 <select data-role="definition-direction-type">${optionList(['aim', 'absolute', 'relative', 'sequence'], direction?.type || 'aim', { aim: '自機狙い', absolute: '絶対角', relative: '相対角', sequence: '連続差分' })}</select></label><label title="定数または$rank等を使う式">角度式 <input data-role="definition-direction-value" value="${escapeHtml(direction?.value || '0')}"></label></fieldset>
      <fieldset><legend title="弾の初速です">弾速</legend><label class="bml-toggle"><input data-role="definition-speed-enabled" type="checkbox" ${speed ? 'checked' : ''}> 使用</label><label title="絶対速度／現在値からの相対値／直前値との差分">基準 <select data-role="definition-speed-type">${optionList(['absolute', 'relative', 'sequence'], speed?.type || 'absolute', { absolute: '絶対値', relative: '相対値', sequence: '連続差分' })}</select></label><label title="定数または$rank等を使う式">速度式 <input data-role="definition-speed-value" value="${escapeHtml(speed?.value || '0')}"></label></fieldset>
    </div>`;
  }

  function renderBulletDefinition(definition, definitionIndex) {
    const actionTargets = (currentPattern()?.definitions || []).filter((item) => item.kind === 'action').map((item) => item.label);
    const actions = (definition.actions || []).map((binding, index) => {
      const selected = binding.ref || '__inline__';
      const commands = binding.commands || [];
      return `<article class="bml-binding-card"><header><strong>弾の動作 ${index + 1}</strong><button data-action="remove-bullet-action" data-index="${index}" title="この動作割当を削除">削除</button></header>
        <label title="内包命令または既存の動作定義参照を選びます">実行内容 <select data-role="bullet-action-binding" data-index="${index}">${optionList(['__inline__', ...actionTargets], selected, { __inline__: 'この場で命令を編集' })}</select></label>
        <label title="参照先の動作へ渡す$1〜$4の値">引数（カンマ区切り・最大4）<input data-role="bullet-action-params" data-index="${index}" value="${escapeHtml((binding.params || []).join(', '))}"></label>
        ${binding.ref ? `<div class="bml-ref-chip">動作参照 → ${escapeHtml(binding.ref)}</div>` : renderCommandList(commands, ['definitions', definitionIndex, 'actions', index, 'commands'], 0, `弾の動作 ${index + 1}の命令`)}
      </article>`;
    }).join('');
    return `${renderMotionFields(definition)}<div class="bml-binding-toolbar"><strong>弾が実行する動作</strong><button data-action="add-bullet-action" ${(definition.actions || []).length >= 2 ? 'disabled' : ''} title="弾へ動作を追加（最大2）">動作＋</button><span>${(definition.actions || []).length}/2</span></div>${actions || '<p class="bml-empty">弾へ割り当てた動作はありません。</p>'}<button data-action="apply-definition-properties" class="primary">弾設定を反映</button>`;
  }

  function renderFireDefinition(definition) {
    const bulletTargets = (currentPattern()?.definitions || []).filter((item) => item.kind === 'bullet').map((item) => item.label);
    const selected = definition.bullet?.ref || '__inline__';
    return `${renderMotionFields(definition)}<fieldset class="bml-binding-card"><legend>発射する弾</legend><label title="簡易弾または既存の弾定義を選びます">弾の定義 <select data-role="fire-bullet-binding">${optionList(['__inline__', ...bulletTargets], selected, { __inline__: '簡易弾（追加動作なし）' })}</select></label><label title="参照先の弾定義へ渡す$1〜$4の値">引数（カンマ区切り・最大4）<input data-role="fire-bullet-params" value="${escapeHtml((definition.bullet?.params || []).join(', '))}"></label>${definition.bullet?.ref ? `<div class="bml-ref-chip">弾定義参照 → ${escapeHtml(definition.bullet.ref)}</div>` : '<small>簡易弾は方向・速度の追加指定と実行動作を持ちません。</small>'}</fieldset><button data-action="apply-definition-properties" class="primary">発射設定を反映</button>`;
  }

  function renderStructured() {
    const definition = selectedDefinition(); const definitionIndex = selectedDefinitionIndex();
    elements.editTitle.textContent = definition ? `${definitionMeta(definition.kind)[0]} · ${definition.label}` : '構造化フロー';
    if (!definition) { elements.structured.innerHTML = '<p class="bml-empty">左の弾幕定義を選択してください。</p>'; return; }
    let body = '';
    if (definition.kind === 'action') body = renderCommandList(definition.commands || [], ['definitions', definitionIndex, 'commands'], 0, '動作命令');
    else if (definition.kind === 'bullet') body = renderBulletDefinition(definition, definitionIndex);
    else body = renderFireDefinition(definition);
    elements.structured.innerHTML = `<div class="bml-flow">${renderDefinitionMetadata(definition)}${body}</div>`;
  }

  function graphTransform(position) {
    const graph = state.editorState.graph;
    return { x: graph.panX + position.x * graph.zoom, y: graph.panY + position.y * graph.zoom };
  }

  function renderGraph() {
    const pattern = currentPattern();
    if (!pattern) { elements.graphNodes.innerHTML = ''; elements.graphEdges.innerHTML = ''; return; }
    const positions = graphLayout(pattern, state.editorState.graph.positions);
    const transformed = Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, graphTransform(position)]));
    elements.graphNodes.innerHTML = pattern.definitions.map((definition, definitionIndex) => {
      const id = definitionKey(definition); const point = transformed[id]; const commands = definition.kind === 'action' ? definition.commands || [] : [];
      return `<article class="bml-node ${id === state.selectedDefinitionKey ? 'selected' : ''}" data-node-id="${escapeHtml(id)}" style="transform:translate(${point.x}px,${point.y}px) scale(${state.editorState.graph.zoom})"><header><button data-action="select-definition" data-key="${escapeHtml(id)}" title="${escapeHtml(definitionMeta(definition.kind)[1])}"><span class="kind ${definition.kind}">${escapeHtml(definitionMeta(definition.kind)[0])}</span><strong>${escapeHtml(definition.label)}</strong></button></header><div>${commands.slice(0, 8).map((command, index) => `<button data-action="select-graph-command" data-key="${escapeHtml(id)}" data-command-path="definitions.${definitionIndex}.commands.${index}" title="${escapeHtml(commandMeta(command.op)[1])}">${index + 1}. ${escapeHtml(commandMeta(command.op)[0])}</button>`).join('')}${commands.length > 8 ? `<small>ほか${commands.length - 8}件</small>` : ''}</div></article>`;
    }).join('');
    elements.graphEdges.innerHTML = graphEdges(pattern).map((edge) => {
      const from = transformed[edge.from]; const to = transformed[edge.to]; if (!from || !to) return '';
      const x1 = from.x + 210 * state.editorState.graph.zoom; const y1 = from.y + 36 * state.editorState.graph.zoom; const x2 = to.x; const y2 = to.y + 36 * state.editorState.graph.zoom; const bend = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}" data-kind="${edge.kind}"/>`;
    }).join('');
    elements.graphSvg.setAttribute('viewBox', `0 0 ${Math.max(900, elements.graph.clientWidth)} ${Math.max(600, elements.graph.clientHeight)}`);
  }

  function selectionPath() {
    const definitionIndex = selectedDefinitionIndex();
    if (definitionIndex < 0) return [];
    return state.selectedCommandPath && getPath(currentPattern(), state.selectedCommandPath)
      ? pathArray(state.selectedCommandPath)
      : ['definitions', definitionIndex];
  }

  function collectExpressions(value, path = [], result = []) {
    if (!value || typeof value !== 'object') return result;
    if (Array.isArray(value)) { value.forEach((item, index) => collectExpressions(item, [...path, index], result)); return result; }
    for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (typeof item === 'string' && (['value', 'times', 'term'].includes(key) || path.at(-1) === 'params')) result.push({ path: next, label: next.join('.'), value: item });
      else collectExpressions(item, next, result);
    }
    return result;
  }

  function refKindsFor(command) {
    if (command?.op === 'fire') return ['bullet'];
    if (command?.op === 'fireRef') return ['fire'];
    if (command?.op === 'repeat' || command?.op === 'actionRef') return ['action'];
    return [];
  }

  function renderRefConnector() {
    const command = selectedCommand();
    const kinds = refKindsFor(command);
    const previousKind = elements.refKind.value;
    elements.refKind.innerHTML = optionList(kinds, kinds.includes(previousKind) ? previousKind : kinds[0], { action: '動作', fire: '発射', bullet: '弾' });
    const kind = elements.refKind.value;
    const targets = (currentPattern()?.definitions || [])
      .filter((definition) => definition.kind === kind && !(kind === 'action' && definitionKey(definition) === state.selectedDefinitionKey))
      .map((definition) => definition.label);
    const existing = kind === 'action' ? (command?.op === 'repeat' ? command.action?.ref : command?.ref) : kind === 'bullet' ? command?.bullet?.ref : command?.ref;
    elements.refTarget.innerHTML = optionList(targets, targets.includes(existing) ? existing : targets[0]);
    const enabled = Boolean(command && kinds.length && targets.length);
    elements.refKind.disabled = !enabled;
    elements.refTarget.disabled = !enabled;
    root.querySelector('[data-action="connect-ref"]').disabled = !enabled;
    elements.refDiagnostic.textContent = !command ? '構造化フローまたは接続図で命令を選択してください' : !kinds.length ? '発射／繰り返し／動作参照／発射参照が接続対象です' : !targets.length ? '接続先の定義がありません（左列の＋で追加できます）' : (existing ? '接続中: ' + kind + ':' + existing : '接続可能です');
  }

  function renderInspector() {
    const command = selectedCommand(); const definition = selectedDefinition(); const selected = command || definition;
    elements.selectionLabel.textContent = command ? `${definition.label} / 命令位置 ${state.selectedCommandPath}` : definition ? `${definitionMeta(definition.kind)[0]} / ${definition.label}` : '未選択';
    elements.commandForm.innerHTML = command
      ? `<p class="bml-form-guide">選択命令の詳細をGUIで編集できます。各「？」へマウスを置くと説明を表示します。</p>${renderStructuredForm(command, { scope: 'pattern-command', resolveMeta: patternFieldMeta })}`
      : '<p class="bml-empty">中央の命令を選ぶと、詳細設定をGUIで表示します。</p>';
    elements.inspector.value = selected ? formatJson(selected) : '';
    const base = selectionPath();
    const expressions = collectExpressions(selected).map((entry) => ({ ...entry, absolute: [...base, ...entry.path] }));
    const previous = elements.expressionPath.value;
    elements.expressionPath.innerHTML = expressions.map((entry) => `<option value="${escapeHtml(entry.absolute.join('.'))}">${escapeHtml(entry.label)} = ${escapeHtml(entry.value)}</option>`).join('');
    if (expressions.some((entry) => entry.absolute.join('.') === previous)) elements.expressionPath.value = previous;
    const current = getPath(currentPattern(), elements.expressionPath.value);
    elements.exprAdvanced.value = current ?? '';
    elements.exprDiagnostic.textContent = current == null ? '式を含む要素を選択してください' : '定数、$rank、$rand、$1〜$4を組み合わせた一次式';
    renderRefConnector();
  }

  function renderDiagnostics() {
    const diagnostics = state.validation?.diagnostics || [];
    elements.diagnostics.innerHTML = diagnostics.map((item) => `<article data-severity="${escapeHtml(item.severity)}"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.path)}</span><p>${escapeHtml(item.message)}</p></article>`).join('') || '<p class="bml-empty">診断はありません。</p>';
  }

  function drawPreview() {
    const canvas = elements.preview; const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    context.fillStyle = '#040810'; context.fillRect(0, 0, 320, 224);
    context.strokeStyle = '#10243b'; context.lineWidth = 1;
    for (let x = 0; x <= 320; x += 32) { context.beginPath(); context.moveTo(x + .5, 0); context.lineTo(x + .5, 224); context.stroke(); }
    for (let y = 0; y <= 224; y += 32) { context.beginPath(); context.moveTo(0, y + .5); context.lineTo(320, y + .5); context.stroke(); }
    const frame = state.preview.trace[state.preview.index] || { bullets: [], metrics: {} };
    const heatPieces = Array(224).fill(0); const heatDots = Array(224).fill(0); const sprite = currentPattern()?.sprite || { frameWidth: 8, frameHeight: 8 }; const hitbox = currentPattern()?.hitbox || { radius: 3, x: 0, y: 0 };
    for (const bullet of frame.bullets || []) {
      context.fillStyle = '#ffcc5c'; context.fillRect(Math.round(bullet.x - sprite.frameWidth / 2), Math.round(bullet.y - sprite.frameHeight / 2), sprite.frameWidth, sprite.frameHeight);
      context.strokeStyle = '#ff5470'; context.beginPath(); context.arc(bullet.x + hitbox.x, bullet.y + hitbox.y, hitbox.radius, 0, Math.PI * 2); context.stroke();
      const top = clamp(Math.floor(bullet.y - sprite.frameHeight / 2), 0, 223); const bottom = clamp(Math.ceil(bullet.y + sprite.frameHeight / 2), 0, 223);
      for (let y = top; y <= bottom; y += 1) { heatPieces[y] += 1; heatDots[y] += sprite.frameWidth; }
    }
    context.fillStyle = '#4cc9f0'; context.beginPath(); context.arc(state.preview.emitter.x, state.preview.emitter.y, 5, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#80ed99'; context.beginPath(); context.moveTo(state.preview.player.x - 6, state.preview.player.y); context.lineTo(state.preview.player.x + 6, state.preview.player.y); context.moveTo(state.preview.player.x, state.preview.player.y - 6); context.lineTo(state.preview.player.x, state.preview.player.y + 6); context.stroke();
    const metrics = frame.metrics || {};
    elements.metrics.innerHTML = `<strong>${frame.frame || 0}フレーム</strong><span>敵弾 ${metrics.bullets || 0}/${48}</span><span>実行枠 ${metrics.contexts || 0}/${106}</span><span>命令 ${metrics.lastOpcode ?? 0} / ${metrics.opcodesThisFrame || 0}</span><span>生成 ${metrics.spawned || 0}</span><span class="${metrics.fireDrops ? 'error' : ''}">生成失敗 ${metrics.fireDrops || 0}</span><span>CRC ${escapeHtml(state.preview.crc32 || '-')}</span><span>BMLB ${escapeHtml(state.preview.compiledHash?.slice(0, 12) || '-')}</span>`;
    const heat = elements.heatmap.getContext('2d'); heat.clearRect(0, 0, 224, 54);
    heat.fillStyle = '#778da9'; heat.fillText('走査線 sprite数 / dot数', 2, 9);
    for (let y = 0; y < 224; y += 1) { heat.fillStyle = heatPieces[y] > 20 || heatDots[y] > 320 ? '#ff3355' : `hsl(${200 - Math.min(180, heatPieces[y] * 9)},80%,55%)`; heat.fillRect(y, 14, 1, Math.round(heatPieces[y] / 20 * 18)); heat.fillRect(y, 35, 1, Math.round(heatDots[y] / 320 * 18)); }
    elements.frame.max = String(Math.max(0, state.preview.trace.length - 1)); elements.frame.value = String(state.preview.index);
    elements.play.textContent = state.preview.playing ? 'Ⅱ' : '▶';
  }

  function renderStageList() {
    const stages = [...(state.snapshot?.stages || [])];
    if (state.stageDraft && !stages.some((stage) => stage.id === state.stageDraft.id)) stages.push(state.stageDraft);
    elements.stageSelect.innerHTML = stages.map((stage) => `<option value="${escapeHtml(stage.id)}" ${stage.id === state.selectedStageId ? 'selected' : ''}>${escapeHtml(stage.name || stage.id)} · ${escapeHtml(japaneseValue(stage.orientation))}</option>`).join('');
    elements.stageOrientationLabel.textContent = state.stageDraft ? `${state.stageDraft.orientation === 'horizontal' ? '横' : '縦'} · ${state.stageDraft.id}` : '';
    elements.stageDeletedList.innerHTML = (state.snapshot?.deletedStages || []).map((item) => `<button data-action="restore-stage" data-file="${escapeHtml(item.fileName)}" title="${escapeHtml(item.stage.id)}をステージ一覧へ戻す">復元: ${escapeHtml(item.stage.name || item.stage.id)}</button>`).join('') || '<small>削除済みステージはありません。</small>';
    root.querySelector('[data-action="delete-stage"]').disabled = !state.stageDraft;
    elements.stageRank.textContent = String(state.snapshot?.project?.rank ?? .5);
    const stageSettings = state.stageDraft ? Object.fromEntries(Object.entries(state.stageDraft).filter(([key]) => key !== 'events')) : null;
    elements.stageSettingsForm.innerHTML = stageSettings
      ? renderStructuredForm(stageSettings, { scope: 'stage-settings', resolveMeta: (path, value, key) => stgFieldMeta(['stage', ...path], value, key, { snapshot: state.snapshot }) })
      : '<p class="bml-empty">ステージを選択してください。</p>';
    const collisionMap = state.stageDraft?.collisionMap || { symbol: '', type: 'MAP', collisionLayer: '' };
    elements.stageAssets.innerHTML = `<article class="bml-v2-asset active"><header><strong>衝突マップ</strong><span>${escapeHtml(collisionMap.type || 'MAP')}</span></header><code>${escapeHtml(collisionMap.symbol || '未選択')}</code><div><button data-action="pick-stage-collision" title="ResComp登録済みマップから選択">マップを選択</button><button data-action="open-stage-collision" ${collisionMap.symbol ? '' : 'disabled'} title="選択済みマップをマップエディターで開く">マップエディターで開く</button></div><label title="当たり判定に使うTMXレイヤー名">衝突レイヤー <input data-role="stage-collision-layer" value="${escapeHtml(collisionMap.collisionLayer || '')}" placeholder="Collision:near"></label></article>`;
    void mountStageCollisionPreview();
    elements.eventList.innerHTML = (state.stageDraft?.events || []).map((event, index) => {
      const action = event.action?.type || (event.boss ? 'spawn_boss' : 'spawn_enemy');
      const trigger = event.trigger?.type === 'frame' ? `${event.trigger.frame}f` : `${event.trigger?.type || 'frame'}:${event.trigger?.flag || event.trigger?.bossId || ''}`;
      const target = event.action?.enemyId || event.action?.bossId || event.action?.backgroundId || event.patternId || '';
      return `<button data-action="select-event" data-index="${index}" class="${index === state.selectedEventIndex ? 'active' : ''}" title="このイベントをGUI編集"><strong>${escapeHtml(event.id)}</strong><small>${escapeHtml(trigger)} · ${escapeHtml(japaneseValue(action))}${target ? ` · ${escapeHtml(target)}` : ''}</small></button>`;
    }).join('') || '<p class="bml-empty">イベントなし</p>';
    const duration = state.stageDraft?.durationFrames || 3600;
    elements.timeline.innerHTML = `<div class="bml-timeline-track">${(state.stageDraft?.events || []).map((event, index) => `<button data-action="select-event" data-index="${index}" style="left:${clamp(event.spawnFrame / duration * 100, 0, 100)}%" title="${escapeHtml(event.id)}"><span>${event.boss ? 'B' : 'E'}</span></button>`).join('')}<i style="left:${clamp(number(elements.stageFrame.value) / duration * 100, 0, 100)}%"></i></div>`;
    const selected = selectedEvent();
    elements.stageForm.innerHTML = selected
      ? renderStructuredForm(selected, { scope: 'stage', resolveMeta: (path, value, key) => stgFieldMeta(['stage', 'events', ...path], value, key, { snapshot: state.snapshot }) })
      : '<p class="bml-empty">左のイベントを選択すると、ここへGUI設定を表示します。</p>';
    elements.stageInspector.value = selected ? formatJson(selected) : '';
    elements.stageFrame.max = String(duration);
    const event = selectedEvent(); const phaseCount = event?.boss ? event.phases?.length || 0 : 0;
    const addPhaseButton = root.querySelector('[data-action="add-phase"]');
    const removePhaseButton = root.querySelector('[data-action="remove-phase"]');
    addPhaseButton.disabled = !event?.boss || phaseCount >= 8;
    addPhaseButton.title = !event ? 'イベントを選択してください' : !event.boss ? 'ボスイベントだけが段階を持てます' : phaseCount >= 8 ? '上限8段階です' : '次のボス段階を追加';
    removePhaseButton.disabled = !event?.boss || phaseCount <= 1;
    removePhaseButton.title = !event?.boss ? 'ボスイベントを選択してください' : phaseCount <= 1 ? 'ボスには最低1段階必要です' : '最後のボス段階を削除';
    root.querySelector('[data-action="add-waypoint"]').disabled = !event || (event.path?.length || 0) >= 8;
    root.querySelector('[data-action="delete-event"]').disabled = !event;
    root.querySelector('[data-action="add-boss"]').disabled = !state.stageDraft || state.stageDraft.events.length >= 255;
    elements.phaseSummary.innerHTML = !event ? '<small>イベントを選択すると経路／ボス段階の操作が有効になります。</small>'
      : !event.boss ? '<small>通常敵はボス段階を持ちません。</small>'
        : `<strong>ボス段階 ${phaseCount}/8</strong>${(event.phases || []).map((phase, index) => `<span>段階${index + 1} · 残HP ${phase.threshold}% · ${escapeHtml(phase.patternId || '弾幕なし')}</span>`).join('')}`;
    root.querySelectorAll('[data-path-mode]').forEach((button) => button.classList.toggle('active', button.dataset.pathMode === state.stagePathMode));
    const diagnostics = state.stageDraft ? state.validation?.diagnostics?.filter((item) => item.path.startsWith(`stages.${state.stageDraft.id}`)) || [] : [];
    elements.stageDiagnostics.innerHTML = diagnostics.map((item) => `<p data-severity="${item.severity}">${escapeHtml(item.code)}: ${escapeHtml(item.message)}</p>`).join('');
  }

  function drawStagePreview() {
    const context = elements.stagePreview.getContext('2d'); const preview = state.stageRuntime.snapshot; const frame = preview?.frame ?? number(elements.stageFrame.value); context.fillStyle = '#030a18'; context.fillRect(0, 0, 320, 224);
    const background = preview?.background;
    for (const [planeIndex, plane] of ['BG_B', 'BG_A'].entries()) {
      const bands = background?.definition?.[plane]?.bands || [{ start: 0, end: state.stageOrientation === 'vertical' ? 319 : 223, multiplier: planeIndex ? 1 : .25 }];
      for (const [bandIndex, band] of bands.entries()) {
        context.fillStyle = planeIndex ? `hsla(${205 + bandIndex * 12},55%,${15 + bandIndex * 5}%,.55)` : `hsla(${220 + bandIndex * 9},50%,${8 + bandIndex * 3}%,.9)`;
        if (state.stageOrientation === 'vertical') context.fillRect(band.start, 0, Math.max(1, band.end - band.start + 1), 224);
        else context.fillRect(0, band.start, 320, Math.max(1, band.end - band.start + 1));
      }
      const offsets = background?.waveOffsets?.[plane] || [];
      context.strokeStyle = planeIndex ? '#305c86' : '#1b3659'; context.beginPath();
      offsets.forEach((offset, index) => { const coordinate = index * (state.stageOrientation === 'vertical' ? 319 : 223) / Math.max(1, offsets.length - 1); const x = state.stageOrientation === 'vertical' ? coordinate : 160 + offset * 6; const y = state.stageOrientation === 'vertical' ? 112 + offset * 6 : coordinate; if (!index) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke();
    }
    context.fillStyle = '#2b5580'; for (let index = 0; index < 80; index += 1) { const scroll = Number(background?.scroll ?? frame); const x = (index * 73 + scroll * (state.stageOrientation === 'horizontal' ? -1 : 0)) % 330; const y = (index * 47 + scroll * (state.stageOrientation === 'vertical' ? 1 : 0)) % 234; context.fillRect((x + 330) % 330 - 5, (y + 234) % 234 - 5, 2, 2); }
    for (const { event, index } of stagePathsForMode(state.stageDraft?.events, state.selectedEventIndex, state.stagePathMode)) {
      context.strokeStyle = index === state.selectedEventIndex ? '#69ddff' : '#285479'; context.lineWidth = index === state.selectedEventIndex ? 2 : 1; context.beginPath();
      for (const point of event.path || []) { if (point === event.path[0]) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); }
      context.stroke();
      context.fillStyle = context.strokeStyle;
      for (const point of event.path || []) { context.beginPath(); context.arc(point.x, point.y, index === state.selectedEventIndex ? 3 : 2, 0, Math.PI * 2); context.fill(); }
    }
    context.lineWidth = 1;
    for (const bullet of preview?.bullets || []) {
      context.fillStyle = '#ffcf5c'; context.fillRect(Math.round(bullet.x - bullet.width / 2), Math.round(bullet.y - bullet.height / 2), bullet.width, bullet.height);
      if (state.stageRuntime.diagnostics) { context.strokeStyle = '#ff5470'; context.beginPath(); context.arc(bullet.x + bullet.hitbox.x, bullet.y + bullet.hitbox.y, bullet.hitbox.radius, 0, Math.PI * 2); context.stroke(); }
    }
    for (const enemy of preview?.enemies || []) {
      const size = enemy.boss ? 32 : 16; context.fillStyle = enemy.boss ? '#f72585' : enemy.enemyType === 'turret' ? '#f9c74f' : '#f9844a'; context.fillRect(enemy.x - size / 2, enemy.y - size / 2, size, size);
      context.fillStyle = '#18202c'; context.fillRect(enemy.x - size / 2, enemy.y - size / 2 - 5, size, 3); context.fillStyle = '#80ed99'; context.fillRect(enemy.x - size / 2, enemy.y - size / 2 - 5, size * enemy.hp / Math.max(1, enemy.maxHp), 3);
      if (state.stageRuntime.diagnostics) { context.fillStyle = '#fff'; context.font = '8px monospace'; context.fillText('P' + (enemy.phase + 1) + ' ' + enemy.hp, enemy.x - size / 2, enemy.y + size / 2 + 9); }
      for (const part of enemy.parts || []) { if (!part.active) continue; context.strokeStyle = part.followBackground ? '#f9c74f' : '#fd7bb1'; context.beginPath(); context.arc(part.x, part.y, 6, 0, Math.PI * 2); context.stroke(); }
    }
    context.fillStyle = '#ffe66d'; for (const item of preview?.items || []) { context.save(); context.translate(item.x, item.y); context.rotate(frame * .05); context.fillRect(-4, -4, 8, 8); context.restore(); }
    for (const effect of preview?.effects || []) { const radius = 4 + effect.age * .45; context.strokeStyle = effect.effectId === 'bomb-wave' ? '#80edff' : '#ff9f5a'; context.beginPath(); context.arc(effect.x, effect.y, radius, 0, Math.PI * 2); context.stroke(); }
    const player = preview?.player || (state.stageOrientation === 'horizontal' ? { x: 48, y: 112 } : { x: 160, y: 196 });
    if (!preview?.invincible || !(frame & 2)) {
      context.fillStyle = '#80ed99'; context.beginPath();
      if (state.stageOrientation === 'horizontal') { context.moveTo(player.x + 8, player.y); context.lineTo(player.x - 7, player.y - 7); context.lineTo(player.x - 7, player.y + 7); }
      else { context.moveTo(player.x, player.y - 8); context.lineTo(player.x - 7, player.y + 7); context.lineTo(player.x + 7, player.y + 7); }
      context.closePath(); context.fill();
    }
    context.fillStyle = '#9bf6ff'; for (const shot of preview?.shots || []) {
      if (state.stageOrientation === 'horizontal') context.fillRect(shot.x - 5, shot.y - 1, 8, 3);
      else context.fillRect(shot.x - 1, shot.y - 5, 3, 8);
    }
    const metrics = preview?.metrics || {}; const drop = number(metrics.fireDrops) + number(metrics.displayDeletes) + number(metrics.eventDrops);
    if (state.stageRuntime.diagnostics) {
      for (let line = 0; line < 224; line += 1) {
        const intensity = Math.max(number(metrics.scanlinePieces?.[line]) / 20, number(metrics.scanlineDots?.[line]) / 320);
        if (intensity > 0) { context.fillStyle = intensity > 1 ? '#ff3355' : 'hsla(' + (210 - Math.min(180, intensity * 180)) + ',90%,55%,.8)'; context.fillRect(316, line, 4, 1); }
      }
      context.fillStyle = '#000b'; context.fillRect(3, 204, 250, 17); context.fillStyle = drop ? '#ff7089' : '#9bf6ff'; context.font = '9px monospace'; context.fillText('B' + (metrics.bullets || 0) + '/48 C' + (metrics.contexts || 0) + '/106 OP' + (metrics.opcodesThisFrame || 0) + '/512 SP' + (metrics.spawnedThisFrame || 0) + '/16 DROP' + drop, 6, 216);
    }
    elements.stageMetrics.textContent = Math.trunc(frame) + 'f · 残機 ' + (preview?.lives ?? 3) + ' · ボム ' + (preview?.bombs ?? 0) + ' · 武器 ' + (preview?.weaponId || '-') + '/' + japaneseValue(preview?.speedMode || 'normal') + ' 行' + (preview?.player?.animationRow ?? 0) + ' · 得点 ' + (preview?.score ?? 0) + ' · 敵 ' + (preview?.enemies?.length || 0) + ' · スプライト ' + (metrics.globalSprites || 1) + '/80 · 走査線 ' + (metrics.maxPieces || 0) + '/20 ' + (metrics.maxDots || 0) + '/320 · ' + japaneseValue(preview?.outcome || 'ready');
    elements.stagePlay.textContent = state.stageRuntime.playing ? 'Ⅱ' : '▶';
  }

  async function mountPatternSpritePreview() {
    const reference = currentPattern()?.sprite?.asset;
    if (!reference?.symbol) {
      state.patternAssetPreviewKey = '';
      elements.patternAssetPreview.innerHTML = '<p class="bml-empty">弾画像を選択すると、ここへ自動的にプレビューします。</p>';
      return;
    }
    const key = `${currentPattern().id}:${reference.symbol}:${reference.type}:${reference.animationRow ?? 0}`;
    if (state.patternAssetPreviewKey === key) return;
    state.patternAssetPreviewKey = key;
    try {
      const picker = api.capabilities?.get?.('rescomp-asset-picker') || await api.capabilities?.require?.('rescomp-asset-picker', 1500);
      if (!picker) throw new Error('アセット管理の選択機能が無効です');
      await picker.mountPreview(elements.patternAssetPreview, reference);
    } catch (error) {
      elements.patternAssetPreview.innerHTML = `<p class="bml-empty">${escapeHtml(error?.message || error)}</p>`;
    }
  }

  async function pickPatternSprite() {
    const pattern = currentPattern();
    if (!pattern) return;
    const reference = pattern.sprite?.asset || { symbol: '', type: 'SPRITE', animationRow: 0 };
    const picker = api.capabilities?.get?.('rescomp-asset-picker') || await api.capabilities?.require?.('rescomp-asset-picker', 1500);
    if (!picker) { setStatus('アセット管理の選択機能が無効です', 'error'); return; }
    const picked = await picker.openPicker({ types: ['SPRITE'], selectedSymbol: reference.symbol, allowNone: false, title: '敵弾スプライトを選択' });
    if (!picked?.ok || !picked.selection) return;
    const next = clone(pattern);
    next.sprite ||= {};
    next.sprite.asset = { ...reference, ...picked.selection, animationRow: reference.animationRow ?? 0 };
    state.patternAssetPreviewKey = '';
    dispatch({ type: 'replace', pattern: next });
  }

  async function openPatternSprite() {
    const reference = currentPattern()?.sprite?.asset;
    if (!reference?.symbol) return;
    const editor = api.capabilities?.get?.('sprite-editor') || await api.capabilities?.require?.('sprite-editor', 1500);
    await editor?.openSprite?.({ symbol: reference.symbol });
  }

  async function mountStageCollisionPreview() {
    const reference = state.stageDraft?.collisionMap;
    if (!reference?.symbol) {
      state.stageRuntime.assetPreviewKey = '';
      elements.stageAssetPreview.innerHTML = '<p class="bml-empty">衝突マップを選択すると、ここへ自動的にプレビューします。</p>';
      return;
    }
    const key = `${reference.symbol}:${reference.type}:${reference.collisionLayer || ''}`;
    if (state.stageRuntime.assetPreviewKey === key) return;
    state.stageRuntime.assetPreviewKey = key;
    try {
      const picker = api.capabilities?.get?.('rescomp-asset-picker') || await api.capabilities?.require?.('rescomp-asset-picker', 1500);
      if (!picker) throw new Error('アセット管理の選択機能が無効です');
      await picker.mountPreview(elements.stageAssetPreview, reference);
    } catch (error) {
      elements.stageAssetPreview.innerHTML = `<p class="bml-empty">${escapeHtml(error?.message || error)}</p>`;
    }
  }

  async function pickStageCollision() {
    const reference = state.stageDraft?.collisionMap || { symbol: '', type: 'MAP', collisionLayer: '' };
    const picker = api.capabilities?.get?.('rescomp-asset-picker') || await api.capabilities?.require?.('rescomp-asset-picker', 1500);
    if (!picker) { setStatus('アセット管理の選択機能が無効です', 'error'); return; }
    const picked = await picker.openPicker({ types: ['MAP', 'TILEMAP'], selectedSymbol: reference.symbol, allowNone: false, title: '衝突マップを選択' });
    if (!picked?.ok || !picked.selection) return;
    state.stageDraft.collisionMap = { ...reference, ...picked.selection };
    state.stageRuntime.assetPreviewKey = '';
    state.stageDirty = true;
    updateDirty();
    renderStageList();
    scheduleStagePreviewRefresh();
  }

  async function openStageCollision() {
    const reference = state.stageDraft?.collisionMap;
    if (!reference?.symbol) return;
    const editor = api.capabilities?.get?.('tilemap-editor') || await api.capabilities?.require?.('tilemap-editor', 1500);
    await editor?.openMap?.({ symbol: reference.symbol, collisionLayer: reference.collisionLayer || '' });
  }

  function render() {
    root.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === state.page));
    root.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.dataset.section === state.page));
    root.querySelectorAll('[data-side]').forEach((button) => button.classList.toggle('active', button.dataset.side === state.side));
    root.querySelectorAll('[data-side-section]').forEach((section) => section.classList.toggle('active', section.dataset.sideSection === state.side));
    root.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.editorState?.view));
    elements.structured.classList.toggle('active', state.editorState?.view !== 'graph'); elements.graph.classList.toggle('active', state.editorState?.view === 'graph');
    renderPatternList(); renderPatternSettings(); renderDefinitionList(); renderStructured(); renderGraph(); renderInspector(); renderDiagnostics(); renderStageList(); drawPreview(); drawStagePreview(); updateDirty();
    renderProjectDiagnostics();
    state.v2Editor?.renderPage(state.page);
    if (state.page === 'stages' && state.stageRuntime.stageHash !== JSON.stringify(state.stageDraft)) scheduleStagePreviewRefresh();
    root.querySelector('[data-action="undo"]').disabled = !state.history?.past.length;
    root.querySelector('[data-action="redo"]').disabled = !state.history?.future.length;
    root.querySelectorAll('.bml-view-toolbar [data-action="move-command"], .bml-view-toolbar [data-action="delete-command"]').forEach((button) => { button.disabled = !state.selectedCommandPath; });
    root.querySelector('.bml-view-toolbar [data-action="add-command"]').disabled = !selectedDefinition();
    elements.previewLoop.checked = state.preview.loop;
  }

  function markPatternChanged() {
    setDirty(true); render(); scheduleCompile();
  }

  function dispatch(operation) { if (!state.history) return; state.history.dispatch(operation); state.selectedPatternId = currentPattern().id; markPatternChanged(); }

  async function reload() {
    if (state.loading) return false;
    state.loading = true; setStatus('BulletML作品データを読込中…');
    try {
      const result = await api.plugins.invokeHook(plugin.id, 'loadBulletmlProject', {});
      if (!result?.snapshot) throw new Error(result?.error || 'BulletML作品データを読み込めません');
      adoptSnapshot(result); render(); await compilePreview(); await refreshXml(); if (state.page === 'stages') await startStagePreview({ silent: true }); setStatus('読込完了', 'ok'); return true;
    } catch (error) { setStatus(error.message, 'error'); logger.error(error.message); return false; }
    finally { state.loading = false; }
  }

  async function saveEditorState() {
    state.editorState.page = state.page; state.editorState.selectedPatternId = state.selectedPatternId; state.editorState.selectedDefinition = state.selectedDefinitionKey;
    state.editorState.selectedCommandPath = state.selectedCommandPath;
    state.editorState.selectedStageId = state.selectedStageId;
    state.editorState.previewLoop = state.preview.loop;
    state.editorState.stagePathMode = state.stagePathMode;
    const result = await api.plugins.invokeHook(plugin.id, 'saveBulletmlProject', { editorState: state.editorState, baseRevisions: { editorState: state.snapshot.revisions.editorState } });
    if (!result?.ok) throw new Error(result?.error || 'エディター表示設定を保存できません');
    state.snapshot = result.snapshot; state.editorDirty = false; updateDirty();
    state.v2Editor?.setSnapshot(state.snapshot, result.validation);
  }

  async function savePattern() {
    const pattern = currentPattern(); if (!pattern) return true;
    const baseRevision = state.snapshot.revisions.patterns[pattern.id] || '';
    const result = await api.plugins.invokeHook(plugin.id, 'saveBulletmlPattern', { pattern, baseRevision });
    if (!result?.ok) throw new Error(result?.error || '弾幕パターンを保存できません');
    state.snapshot = result.snapshot; state.validation = result.validation; state.selectedPatternId = pattern.id;
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    const stored = state.snapshot.patterns.find((item) => item.id === pattern.id); state.history.replace(stored); setDirty(false);
    if (result.draftValid) { setStatus('保存しました。プレビューは最新BMLBです', 'ok'); await compilePreview(); }
    else setStatus('不完全な下書きを保存しました。ビルド／テストプレイは実行できません', 'error');
    await saveEditorState(); render(); return true;
  }

  async function saveStage() {
    if (!state.stageDraft) return true;
    const result = await api.plugins.invokeHook(plugin.id, 'saveBulletmlStage', { id: state.selectedStageId, stage: state.stageDraft, baseRevision: state.snapshot.revisions.stages[state.selectedStageId] });
    if (!result?.ok) throw new Error(result?.error || 'ステージを保存できません');
    if (result.snapshot) state.snapshot = result.snapshot;
    else {
      const index = state.snapshot.stages.findIndex((item) => item.id === state.selectedStageId);
      if (index >= 0) state.snapshot.stages[index] = result.stage;
      else state.snapshot.stages.push(result.stage);
      state.snapshot.revisions.stages[state.selectedStageId] = result.revision;
    }
    state.stageDraft = clone(result.stage); state.stageOrientation = result.stage.orientation; state.stageDirty = false;
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    await saveEditorState();
    updateDirty(); render(); setStatus(result.validation?.ok ? 'ステージを保存しました' : 'ステージの下書きを保存しましたが、ビルドを止める診断があります', result.validation?.ok ? 'ok' : 'error'); return true;
  }

  async function saveDemo() {
    if (!state.demoDirty) return true;
    const value = state.demoEditor?.getValue?.() || state.demoDraft;
    const result = await api.plugins.invokeHook(plugin.id, 'saveBulletmlDemo', { ...value, baseRevisions: state.demoRevisions });
    if (!result?.ok) throw new Error(result?.error || 'デモシーンを保存できません');
    state.snapshot = result.snapshot; state.validation = result.validation; state.demoDirty = false;
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    mountDemoEditor(result.demoEditor, true);
    renderProjectDiagnostics(); updateDirty(); setStatus('デモシーンと画面進行への割当を保存しました', 'ok'); return true;
  }

  async function saveCurrent() {
    try {
      if (state.dirty && !(await savePattern())) return false;
      if (state.stageDirty && !(await saveStage())) return false;
      if (state.catalogDirty && !(await state.v2Editor?.saveAll())) return false;
      if (state.demoDirty && !(await saveDemo())) return false;
      if (state.editorDirty) { await saveEditorState(); render(); setStatus('エディター表示設定を保存しました', 'ok'); }
      return true;
    }
    catch (error) { setStatus(error.message, 'error'); return false; }
  }

  async function flush(reason) { const ok = !state.dirty && !state.stageDirty && !state.editorDirty && !state.catalogDirty && !state.demoDirty ? true : await saveCurrent(); return ok ? { ok: true } : { ok: false, error: `BulletML STG editor could not save before ${reason}.` }; }
  function runGuard(action) { if (!state.dirty && !state.stageDirty && !state.catalogDirty && !state.demoDirty) return action(); state.pendingAction = action; guard.open(); return undefined; }
  function discard() { const stored = state.snapshot.patterns.find((item) => item.id === state.selectedPatternId); if (stored) state.history = new PatternHistory(stored, 100); state.editorState = clone(state.snapshot.editorState); state.preview.loop = state.editorState.previewLoop !== false; state.stagePathMode = state.editorState.stagePathMode || 'selected'; state.stageDraft = clone(selectedStage()); state.stageDirty = false; state.editorDirty = false; state.v2Editor?.discard(); state.catalogDirty = false; state.demoDirty = false; setDirty(false); applyPaneSizes(); render(); if (state.page === 'stages') void startStagePreview({ silent: true }); }

  async function compilePreview() {
    const pattern = currentPattern(); if (!pattern) return false;
    const generation = ++state.preview.generation; setStatus('BMLBをコンパイルしてプレビューを生成中…');
    const result = await api.plugins.invokeHook(plugin.id, 'compileBulletmlPattern', { pattern, preview: { frames: 600, rank: elements.rank.value, seed: integerText(elements.seed.value, 0xace1), emitterX: state.preview.emitter.x, emitterY: state.preview.emitter.y, playerX: state.preview.player.x, playerY: state.preview.player.y, orientation: elements.orientation.value } });
    if (generation !== state.preview.generation) return false;
    if (!result?.ok || !result.preview) { state.validation = { diagnostics: [{ severity: 'error', code: 'BML_PREVIEW_COMPILE', path: pattern.id, message: result?.error || 'コンパイルに失敗しました' }] }; renderDiagnostics(); setStatus('プレビューは最後に成功したBMLBを維持しています', 'error'); return false; }
    state.preview.trace = result.preview.trace; state.preview.index = Math.min(state.preview.index, state.preview.trace.length - 1); state.preview.compiledHash = result.sha256; state.preview.crc32 = result.preview.crc32; drawPreview(); setStatus(`BMLB ${result.report.byteLength}バイト / ${state.preview.trace.length}フレーム`, 'ok'); return true;
  }

  function scheduleCompile() { clearTimeout(state.compileTimer); state.compileTimer = setTimeout(() => { void compilePreview(); void refreshXml(); }, 300); }

  async function refreshXml() {
    const pattern = currentPattern(); if (!pattern) return;
    const generation = ++state.xmlGeneration;
    const result = await api.plugins.invokeHook(plugin.id, 'exportBulletmlXml', { pattern, write: false });
    if (generation !== state.xmlGeneration) return;
    if (!result?.ok) { setStatus(result?.error || 'XML生成に失敗しました', 'error'); return; }
    elements.xml.value = result.xml; state.xmlSidecar = result.sidecar; elements.sidecar.textContent = formatJson(result.sidecar);
  }

  async function validate(stress = false) {
    if ((state.dirty || state.stageDirty || state.catalogDirty || state.demoDirty) && !(await saveCurrent())) return;
    setStatus(stress ? '27条件×3600フレームを検証中…' : '検証中…');
    const result = await api.plugins.invokeHook(plugin.id, 'validateBulletmlProject', { stress, frames: 3600 });
    state.validation = result?.validation || { diagnostics: [{ severity: 'error', code: 'BML_VALIDATE', path: '', message: result?.error || '検証失敗' }] };
    state.side = 'diagnostics'; render(); setStatus(result?.ok ? '検証成功' : (result?.error || 'ビルドを止める診断があります'), result?.ok ? 'ok' : 'error');
  }

  function selectPattern(id) { runGuard(() => { const pattern = state.snapshot.patterns.find((item) => item.id === id); if (!pattern) return; state.selectedPatternId = id; state.history = new PatternHistory(pattern, 100); state.selectedDefinitionKey = definitionKey(pattern.definitions[0]); state.selectedCommandPath = ''; setDirty(false); render(); void compilePreview(); void refreshXml(); }); }
  function selectDefinition(key, commandPath = '') { state.selectedDefinitionKey = key; state.selectedCommandPath = commandPath; render(); }

  function newPattern() {
    runGuard(() => {
      const templateId = elements.template.value; const template = clone(state.templates[templateId]); if (!template) return;
      let ordinal = state.snapshot.patterns.length + 1; let id = `pattern-${templateId}`; while (state.snapshot.patterns.some((item) => item.id === id)) id = `pattern-${templateId}-${ordinal++}`;
      template.id = id; template.name = `${template.name} ${ordinal}`; state.selectedPatternId = id; state.history = new PatternHistory(template, 100); state.selectedDefinitionKey = definitionKey(template.definitions[0]); state.selectedCommandPath = ''; setDirty(true); render(); scheduleCompile();
    });
  }

  async function deletePattern() {
    const pattern = currentPattern(); if (!pattern || !state.snapshot.revisions.patterns[pattern.id]) return;
    const result = await api.plugins.invokeHook(plugin.id, 'deleteBulletmlPattern', { id: pattern.id, baseRevision: state.snapshot.revisions.patterns[pattern.id] });
    if (!result?.ok) { setStatus(result?.error || '削除に失敗しました', 'error'); return; }
    state.snapshot = result.snapshot; const next = state.snapshot.patterns[0] || null; state.selectedPatternId = next?.id || ''; state.history = next ? new PatternHistory(next, 100) : null; state.selectedDefinitionKey = definitionKey(next?.definitions?.[0]); state.selectedCommandPath = ''; setDirty(false); render(); setStatus(`${pattern.id}を削除済み領域へ退避しました`, 'ok');
  }

  async function restorePattern(fileName) {
    const result = await api.plugins.invokeHook(plugin.id, 'restoreBulletmlPattern', { fileName }); if (!result?.ok) { setStatus(result?.error || '復元失敗', 'error'); return; }
    state.snapshot = result.snapshot; render(); setStatus('弾幕パターンを復元しました', 'ok');
  }

  function applyPatternMetadata() {
    const pattern = currentPattern(); const name = elements.patternName.value.trim();
    if (!pattern || !name) { setStatus('パターン名を入力してください', 'error'); elements.patternName.focus(); return; }
    dispatch({ type: 'setPatternMetadata', name, patternType: elements.patternType.value });
    setStatus('パターン名と方向を下書きへ反映しました。安定IDは変更していません', 'ok');
  }

  function applyDefinitionMetadata() {
    const definition = selectedDefinition(); if (!definition) return;
    const labelInput = elements.structured.querySelector('[data-role="definition-label"]');
    const rootInput = elements.structured.querySelector('[data-role="definition-root"]');
    const nextLabel = labelInput?.value.trim() || '';
    if (!nextLabel) { setStatus('弾幕定義名を入力してください', 'error'); labelInput?.focus(); return; }
    if ((currentPattern().definitions || []).some((item) => item !== definition && item.kind === definition.kind && item.label === nextLabel)) { setStatus(`${definition.kind}:${nextLabel} は既に存在します`, 'error'); return; }
    if (definition.kind === 'action' && rootInput?.checked && !/^top/i.test(nextLabel)) { setStatus('開始動作の定義名はtopで始めてください', 'error'); return; }
    const roots = currentPattern().rootActions || []; const wasRoot = roots.includes(definition.label);
    if (definition.kind === 'action' && !rootInput?.checked && wasRoot && roots.length <= 1) { setStatus('開始動作は最低1件必要です', 'error'); return; }
    if (definition.kind === 'action' && rootInput?.checked && !wasRoot && roots.length >= 2) { setStatus('開始動作は最大2件です', 'error'); return; }
    state.history.dispatch({ type: 'updateDefinitionMetadata', kind: definition.kind, label: definition.label, nextLabel, root: rootInput?.checked });
    state.selectedDefinitionKey = `${definition.kind}:${nextLabel}`; state.selectedCommandPath = ''; markPatternChanged();
    setStatus('弾幕定義名と参照元を一括更新しました', 'ok');
  }

  function parseParamsInput(input) {
    const params = String(input?.value || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (params.length > 4) throw new Error('paramは最大4個です');
    return params;
  }

  function readMotion(definition) {
    const directionEnabled = elements.structured.querySelector('[data-role="definition-direction-enabled"]')?.checked;
    const speedEnabled = elements.structured.querySelector('[data-role="definition-speed-enabled"]')?.checked;
    return {
      ...definition,
      direction: directionEnabled ? {
        type: elements.structured.querySelector('[data-role="definition-direction-type"]').value,
        value: elements.structured.querySelector('[data-role="definition-direction-value"]').value.trim() || '0',
      } : null,
      speed: speedEnabled ? {
        type: elements.structured.querySelector('[data-role="definition-speed-type"]').value,
        value: elements.structured.querySelector('[data-role="definition-speed-value"]').value.trim() || '0',
      } : null,
    };
  }

  function applyDefinitionProperties() {
    const definition = selectedDefinition(); const definitionIndex = selectedDefinitionIndex(); if (!definition || definition.kind === 'action') return;
    try {
      let next = readMotion(clone(definition));
      if (definition.kind === 'fire') {
        const target = elements.structured.querySelector('[data-role="fire-bullet-binding"]').value;
        const params = parseParamsInput(elements.structured.querySelector('[data-role="fire-bullet-params"]'));
        next.bullet = target === '__inline__'
          ? { ref: '', params, inline: definition.bullet?.inline || { direction: null, speed: null, actions: [] } }
          : { ref: target, params };
      } else {
        next.actions = [...elements.structured.querySelectorAll('[data-role="bullet-action-binding"]')].map((select) => {
          const index = number(select.dataset.index); const params = parseParamsInput(elements.structured.querySelector(`[data-role="bullet-action-params"][data-index="${index}"]`));
          const previous = definition.actions[index] || { commands: [] };
          return select.value === '__inline__' ? { commands: previous.commands || [], params } : { ref: select.value, params };
        });
      }
      state.selectedCommandPath = ''; dispatch({ type: 'set', path: ['definitions', definitionIndex], value: next });
      setStatus(`${definitionMeta(definition.kind)[0]}の設定を下書きへ反映しました`, 'ok');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  function addBulletAction() {
    const definition = selectedDefinition(); if (definition?.kind !== 'bullet' || definition.actions.length >= 2) return;
    const next = clone(definition); next.actions.push({ commands: [] }); state.selectedCommandPath = '';
    dispatch({ type: 'set', path: ['definitions', selectedDefinitionIndex()], value: next });
  }

  function removeBulletAction(index) {
    const definition = selectedDefinition(); if (definition?.kind !== 'bullet' || index < 0 || index >= definition.actions.length) return;
    const next = clone(definition); next.actions.splice(index, 1); state.selectedCommandPath = '';
    dispatch({ type: 'set', path: ['definitions', selectedDefinitionIndex()], value: next });
  }

  function defaultCommandListPath() {
    const definition = selectedDefinition(); const definitionIndex = selectedDefinitionIndex();
    if (!definition || definitionIndex < 0) return [];
    if (state.selectedCommandPath) return pathArray(state.selectedCommandPath).slice(0, -1);
    if (definition.kind === 'action') return ['definitions', definitionIndex, 'commands'];
    if (definition.kind === 'bullet') {
      if (!definition.actions.length) {
        const next = clone(definition); next.actions.push({ commands: [] });
        state.history.dispatch({ type: 'set', path: ['definitions', definitionIndex], value: next });
      }
      const action = currentPattern().definitions[definitionIndex].actions.findIndex((item) => Array.isArray(item.commands));
      return action >= 0 ? ['definitions', definitionIndex, 'actions', action, 'commands'] : [];
    }
    if (!definition.bullet?.inline) {
      const next = clone(definition); next.bullet = { ref: '', params: [], inline: { direction: null, speed: null, actions: [{ commands: [] }] } };
      state.history.dispatch({ type: 'set', path: ['definitions', definitionIndex], value: next });
    } else if (!definition.bullet.inline.actions.length) {
      state.history.dispatch({ type: 'set', path: ['definitions', definitionIndex, 'bullet', 'inline', 'actions'], value: [{ commands: [] }] });
    }
    return ['definitions', definitionIndex, 'bullet', 'inline', 'actions', 0, 'commands'];
  }

  function addCommandToList(listPath = []) {
    const path = pathArray(listPath); if (!path.length || !Array.isArray(getPath(currentPattern(), path))) { setStatus('命令を追加する命令列を選択してください', 'error'); return; }
    let index = getPath(currentPattern(), path).length;
    const selectedPath = pathArray(state.selectedCommandPath);
    if (pathKey(selectedPath.slice(0, -1)) === pathKey(path)) index = selectedPath.at(-1) + 1;
    state.history.dispatch({ type: 'insertAt', path, index, value: defaultCommand(elements.commandKind.value) });
    state.selectedCommandPath = pathKey([...path, index]); markPatternChanged();
  }

  function deleteCommandAt(commandPath = state.selectedCommandPath) {
    const path = pathArray(commandPath); if (!path.length) return;
    state.history.dispatch({ type: 'removeAt', path }); state.selectedCommandPath = ''; markPatternChanged();
  }

  function moveCommandAt(commandPath = state.selectedCommandPath, delta = 0) {
    const path = pathArray(commandPath); const list = getPath(currentPattern(), path.slice(0, -1)); const index = path.at(-1); const nextIndex = index + number(delta);
    if (!Array.isArray(list) || nextIndex < 0 || nextIndex >= list.length) return;
    state.history.dispatch({ type: 'moveAt', path, delta }); state.selectedCommandPath = pathKey([...path.slice(0, -1), nextIndex]); markPatternChanged();
  }

  function applyInspector() {
    try { const value = JSON.parse(elements.inspector.value); const path = selectionPath(); if (!path.length) return; dispatch({ type: 'set', path, value }); }
    catch (error) { setStatus(`選択項目JSON: ${error.message}`, 'error'); elements.inspector.focus(); }
  }

  function applyExpression() {
    const path = elements.expressionPath.value; if (!path) return;
    let value = elements.exprAdvanced.value.trim();
    if (!value) { const constant = number(elements.exprConstant.value); const coefficient = number(elements.exprCoefficient.value, 1); const variable = elements.exprVariable.value; value = variable ? `${constant}${coefficient >= 0 ? '+' : ''}${coefficient}*${variable}` : String(constant); }
    dispatch({ type: 'set', path, value }); elements.exprDiagnostic.textContent = `適用: ${value}`;
  }

  function connectSelectedRef() {
    const kind = elements.refKind.value;
    const target = elements.refTarget.value;
    if (!selectedCommand() || !state.selectedCommandPath || !kind || !target) { setStatus('接続可能な命令と接続先を選択してください', 'error'); return; }
    dispatch({ type: 'connectRefAt', path: state.selectedCommandPath, kind, target });
    elements.refDiagnostic.textContent = '接続しました: ' + kind + ':' + target;
  }

  async function reimportXml() {
    const pattern = currentPattern(); if (!pattern) return;
    const result = await api.plugins.invokeHook(plugin.id, 'importBulletmlXml', { xml: elements.xml.value, sidecar: state.xmlSidecar, patternId: pattern.id, name: pattern.name, baseRevision: state.snapshot.revisions.patterns[pattern.id] || '' });
    if (!result?.ok) { state.validation = { diagnostics: [{ severity: 'error', code: 'BML_XML_IMPORT', path: '', message: result?.error || 'XMLの取り込みに失敗しました' }] }; state.side = 'diagnostics'; render(); setStatus(result?.error || 'XML再取込に失敗しました', 'error'); return; }
    state.snapshot = result.snapshot; state.validation = { diagnostics: result.diagnostics || [] }; const stored = state.snapshot.patterns.find((item) => item.id === pattern.id); state.history = new PatternHistory(stored, 100); setDirty(false); render(); await compilePreview(); await refreshXml(); setStatus(result.sidecarStatus?.stale ? 'XMLを再取込しました。古い補助データは適用していません' : 'XMLを再取込しました', result.sidecarStatus?.stale ? 'error' : 'ok');
  }

  function switchPage(page) { runGuard(() => { state.page = page; state.editorState.page = page; setEditorDirty(true); state.stageDraft = clone(selectedStage()); state.stageOrientation = state.stageDraft?.orientation || state.stageOrientation; state.selectedEventIndex = -1; state.stageDirty = false; render(); if (page === 'stages') void resetStage(); }); }
  function switchStage(stageId) { runGuard(() => { state.selectedStageId = stageId; state.editorState.selectedStageId = stageId; setEditorDirty(true); state.stageDraft = clone(selectedStage()); state.stageOrientation = state.stageDraft?.orientation || 'vertical'; state.selectedEventIndex = -1; state.stageDirty = false; render(); void resetStage(); }); }

  function newStage() {
    runGuard(() => {
      const used = new Set([
        ...(state.snapshot?.stages || []).map((stage) => stage.id),
        ...(state.snapshot?.deletedStages || []).map((item) => item.stage?.id).filter(Boolean),
      ]);
      let ordinal = 1;
      let id = `stage-${ordinal}`;
      while (used.has(id)) id = `stage-${++ordinal}`;
      const durationFrames = 3600;
      const clearFrame = durationFrames - 1;
      state.selectedStageId = id;
      state.editorState.selectedStageId = id;
      state.stageDraft = {
        schemaVersion: 2,
        id,
        name: `ステージ ${ordinal}`,
        orientation: 'vertical',
        durationFrames,
        backgroundId: state.snapshot?.collections?.backgrounds?.entries?.[0]?.id || '',
        collisionMap: { symbol: '', type: 'MAP', collisionLayer: '' },
        mainScroll: { speed: 1, axis: 'y' },
        next: [],
        events: [{
          id: 'stage-clear',
          order: 0,
          trigger: { type: 'frame', frame: clearFrame, scroll: 0, flag: '', operator: 'set', bossId: '' },
          action: { type: 'stage_clear', enemyId: '', bossId: '', backgroundId: '', plane: 'BG_A', value: 0, durationFrames: 0, interpolation: 'step', transition: 'cut', wave: { preset: 'none', start: 0, end: 223, amplitude: 0, wavelength: 32, speed: 0, fadeFrames: 0 }, flag: '' },
          spawnFrame: clearFrame,
          enemyType: 'grunt',
          boss: false,
          hp: 1,
          score: 0,
          patternId: '',
          movementId: '',
          dropItemId: '',
          path: [],
          phases: [],
        }],
      };
      state.stageOrientation = 'vertical';
      state.selectedEventIndex = 0;
      state.stageRuntime.assetPreviewKey = '';
      state.stageDirty = true;
      setEditorDirty(true);
      render();
      scheduleStagePreviewRefresh();
      setStatus(`${id}を追加しました。名前や向きを設定して「ステージ保存」を押してください`, 'ok');
    });
  }

  async function deleteStage() {
    const id = state.selectedStageId;
    if (!id || !state.stageDraft) return;
    if (!state.snapshot.revisions.stages[id]) {
      state.selectedStageId = state.snapshot.stages[0]?.id || '';
      state.editorState.selectedStageId = state.selectedStageId;
      state.stageDraft = clone(selectedStage());
      state.stageOrientation = state.stageDraft?.orientation || 'vertical';
      state.selectedEventIndex = -1;
      state.stageDirty = false;
      setEditorDirty(true);
      render();
      setStatus(`${id}の未保存ステージを破棄しました`, 'ok');
      return;
    }
    await stopStagePreview();
    const result = await api.plugins.invokeHook(plugin.id, 'deleteBulletmlStage', { id, baseRevision: state.snapshot.revisions.stages[id] });
    if (!result?.ok) { setStatus(result?.error || 'ステージを削除できません', 'error'); return; }
    state.snapshot = result.snapshot;
    state.validation = result.validation || state.validation;
    state.selectedStageId = state.snapshot.stages[0]?.id || '';
    state.editorState.selectedStageId = state.selectedStageId;
    state.stageDraft = clone(selectedStage());
    state.stageOrientation = state.stageDraft?.orientation || 'vertical';
    state.selectedEventIndex = -1;
    state.stageDirty = false;
    state.stageRuntime.assetPreviewKey = '';
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    setEditorDirty(true);
    try { await saveEditorState(); }
    catch (error) { setStatus(error?.message || error, 'error'); }
    render();
    if (state.stageDraft) void resetStage();
    setStatus(`${id}を削除済み領域へ退避しました`, 'ok');
  }

  async function restoreStage(fileName) {
    const result = await api.plugins.invokeHook(plugin.id, 'restoreBulletmlStage', { fileName });
    if (!result?.ok) { setStatus(result?.error || 'ステージを復元できません', 'error'); return; }
    state.snapshot = result.snapshot;
    state.validation = result.validation || state.validation;
    state.selectedStageId = result.stage?.id || state.snapshot.stages.at(-1)?.id || '';
    state.editorState.selectedStageId = state.selectedStageId;
    state.stageDraft = clone(selectedStage());
    state.stageOrientation = state.stageDraft?.orientation || 'vertical';
    state.selectedEventIndex = -1;
    state.stageDirty = false;
    state.stageRuntime.assetPreviewKey = '';
    state.v2Editor?.setSnapshot(state.snapshot, state.validation);
    setEditorDirty(true);
    try { await saveEditorState(); }
    catch (error) { setStatus(error?.message || error, 'error'); }
    render();
    void resetStage();
    setStatus(`${state.selectedStageId}を復元しました`, 'ok');
  }

  function defaultPatternFor(boss) { const role = `${state.stageOrientation}${boss ? 'Boss' : 'Normal'}`; return state.snapshot.project.patternRoles[role] || state.snapshot.patterns[0]?.id || ''; }
  function addEvent(boss = false) {
    if (!state.stageDraft || state.stageDraft.events.length >= 255) { setStatus('ステージイベントは最大255件です', 'error'); return; }
    const index = state.stageDraft.events.length; const patternId = defaultPatternFor(boss);
    const targetId = boss ? state.snapshot.collections?.bosses?.entries?.[0]?.id || '' : state.snapshot.collections?.enemies?.entries?.[0]?.id || '';
    const spawnFrame = Math.min(state.stageDraft.durationFrames - 1, index * 180);
    state.stageDraft.events.push({ id: `${boss ? 'boss' : 'enemy'}-${index + 1}`, order: index, trigger: { type: 'frame', frame: spawnFrame, flag: '', operator: 'set', bossId: '' }, action: { type: boss ? 'spawn_boss' : 'spawn_enemy', enemyId: boss ? '' : targetId, bossId: boss ? targetId : '', backgroundId: '', plane: 'BG_A', value: 0, durationFrames: 0, interpolation: 'step', transition: 'cut', flag: '' }, spawnFrame, enemyType: targetId || (boss ? 'boss' : 'grunt'), boss, hp: boss ? 120 : 3, score: boss ? 10000 : 100, patternId, path: [{ x: state.stageOrientation === 'vertical' ? 160 : 288, y: state.stageOrientation === 'vertical' ? 32 : 112, frame: 0 }, { x: state.stageOrientation === 'vertical' ? 160 : 240, y: 112, frame: 120 }], phases: boss ? [{ threshold: 100, patternId }] : [] });
    state.selectedEventIndex = index; state.stageDirty = true; updateDirty(); render(); setStatus(boss ? 'ボスを1段階で追加しました。「段階＋」で最大8まで追加できます' : '敵出現イベントを追加しました', 'ok');
  }
  function applyStageInspector() { const event = selectedEvent(); if (!event) return; try { state.stageDraft.events[state.selectedEventIndex] = JSON.parse(elements.stageInspector.value); state.stageDirty = true; updateDirty(); render(); } catch (error) { setStatus(`イベントJSON: ${error.message}`, 'error'); } }
  function addWaypoint() { const event = selectedEvent(); if (!event || event.path.length >= 8) return; const last = event.path.at(-1) || { x: 160, y: 32, frame: 0 }; event.path.push({ x: clamp(last.x + 24, 0, 319), y: clamp(last.y + 24, 0, 223), frame: last.frame + 120 }); state.stageDirty = true; render(); }
  function addPhase() {
    const event = selectedEvent();
    if (!event?.boss) { setStatus('段階はボスイベントにだけ追加できます', 'error'); return; }
    if (event.phases.length >= 8) { setStatus('ボス段階は上限8件です', 'error'); return; }
    state.stageDraft.events[state.selectedEventIndex] = addBossPhase(event); state.stageDirty = true; render(); setStatus(`ボス段階を追加しました（${selectedEvent().phases.length}/8）`, 'ok');
  }
  function removePhase() {
    const event = selectedEvent();
    if (!event?.boss || event.phases.length <= 1) { setStatus('ボスには最低1段階必要です', 'error'); return; }
    state.stageDraft.events[state.selectedEventIndex] = removeBossPhase(event); state.stageDirty = true; render(); setStatus(`最後のボス段階を削除しました（${selectedEvent().phases.length}/8）`, 'ok');
  }
  function deleteEvent() { if (state.selectedEventIndex < 0) return; state.stageDraft.events.splice(state.selectedEventIndex, 1); state.selectedEventIndex = -1; state.stageDirty = true; render(); }

  function stagePreviewPatterns() {
    const draft = currentPattern();
    const patterns = (state.snapshot?.patterns || []).map((pattern) => pattern.id === draft?.id ? draft : pattern);
    if (draft && !patterns.some((pattern) => pattern.id === draft.id)) patterns.push(draft);
    return patterns;
  }

  function adoptStagePreview(preview) {
    state.stageRuntime.snapshot = preview;
    elements.stageFrame.max = String(preview?.durationFrames || state.stageDraft?.durationFrames || 3600);
    elements.stageFrame.value = String(preview?.frame || 0);
    if (preview?.outcome && preview.outcome !== 'running') state.stageRuntime.playing = false;
    renderStageList();
    drawStagePreview();
  }

  async function stopStagePreview(sessionId = state.stageRuntime.sessionId) {
    if (!sessionId) return;
    if (sessionId === state.stageRuntime.sessionId) state.stageRuntime.sessionId = '';
    await api.plugins.invokeHook(plugin.id, 'stopBulletmlStagePreview', { sessionId });
  }

  async function startStagePreview(options = {}) {
    if (!state.stageDraft) return false;
    const generation = ++state.stageRuntime.generation;
    const previousId = state.stageRuntime.sessionId;
    const requestedStageHash = JSON.stringify(state.stageDraft);
    state.stageRuntime.pending = true;
    if (!options.silent) setStatus('ステージ用BMLBプレビューを初期化中…');
    const result = await api.plugins.invokeHook(plugin.id, 'startBulletmlStagePreview', {
      stage: state.stageDraft,
      stageId: state.selectedStageId,
      orientation: state.stageOrientation,
      patterns: stagePreviewPatterns(),
      rank: state.snapshot.project.rank,
      seed: integerText(elements.stageSeed.value, 0xace1),
      replaceSessionId: previousId,
    });
    if (generation !== state.stageRuntime.generation) {
      if (result?.sessionId) void stopStagePreview(result.sessionId);
      return false;
    }
    state.stageRuntime.pending = false;
    if (!result?.ok || !result.preview) {
      setStatus('ステージプレビューは最後に成功したBMLBを維持しています: ' + (result?.error || 'コンパイルに失敗しました'), 'error');
      return false;
    }
    state.stageRuntime.sessionId = result.sessionId;
    state.stageRuntime.stageHash = requestedStageHash;
    adoptStagePreview(result.preview);
    if (requestedStageHash !== JSON.stringify(state.stageDraft)) scheduleStagePreviewRefresh();
    if (!options.silent) setStatus('ステージプレビューを開始しました', 'ok');
    return true;
  }

  function stageInput() {
    return {
      left: state.keys.has('ArrowLeft'), right: state.keys.has('ArrowRight'),
      up: state.keys.has('ArrowUp'), down: state.keys.has('ArrowDown'),
      fire: state.keys.has('KeyZ'), bomb: state.keys.has('KeyX'), speedShift: state.keys.has('KeyC'),
    };
  }

  async function stepStage(frames = 1, inputOverride = null) {
    if (state.stageRuntime.pending) return false;
    if ((!state.stageRuntime.sessionId || state.stageRuntime.stageHash !== JSON.stringify(state.stageDraft)) && !(await startStagePreview({ silent: true }))) return false;
    state.stageRuntime.pending = true;
    const result = await api.plugins.invokeHook(plugin.id, 'stepBulletmlStagePreview', {
      sessionId: state.stageRuntime.sessionId,
      frames,
      input: inputOverride || stageInput(),
    });
    state.stageRuntime.pending = false;
    if (!result?.ok || !result.preview) {
      state.stageRuntime.playing = false;
      setStatus(result?.error || 'ステージプレビューを進められませんでした', 'error');
      return false;
    }
    adoptStagePreview(result.preview);
    return true;
  }

  async function seekStage(frame) {
    if (state.stageRuntime.pending) return false;
    if ((!state.stageRuntime.sessionId || state.stageRuntime.stageHash !== JSON.stringify(state.stageDraft)) && !(await startStagePreview({ silent: true }))) return false;
    state.stageRuntime.playing = false;
    state.stageRuntime.pending = true;
    const result = await api.plugins.invokeHook(plugin.id, 'seekBulletmlStagePreview', { sessionId: state.stageRuntime.sessionId, frame });
    state.stageRuntime.pending = false;
    if (!result?.ok || !result.preview) { setStatus(result?.error || 'ステージプレビューの位置を変更できませんでした', 'error'); return false; }
    adoptStagePreview(result.preview);
    return true;
  }

  async function resetStage() {
    state.stageRuntime.playing = false;
    state.stageRuntime.lastTime = 0;
    await startStagePreview();
  }

  async function tickStage(now) {
    if (!state.stageRuntime.playing) return;
    if (!state.stageRuntime.lastTime) state.stageRuntime.lastTime = now;
    const steps = Math.max(1, Math.min(4, Math.round((now - state.stageRuntime.lastTime) / (1000 / 60))));
    state.stageRuntime.lastTime = now;
    await stepStage(steps);
    if (state.stageRuntime.playing) requestAnimationFrame(tickStage);
  }

  function toggleStagePlay() {
    state.stageRuntime.playing = !state.stageRuntime.playing;
    state.stageRuntime.lastTime = 0;
    if (state.stageRuntime.playing) requestAnimationFrame(tickStage);
    drawStagePreview();
  }

  function scheduleStagePreviewRefresh() {
    if (!state.stageRuntime.sessionId) return;
    clearTimeout(state.stageRestartTimer);
    state.stageRestartTimer = setTimeout(() => {
      if (state.page === 'stages' && state.stageRuntime.stageHash !== JSON.stringify(state.stageDraft)) void startStagePreview({ silent: true });
    }, 120);
  }
  function tickPreview(now) {
    if (!state.preview.playing) return;
    if (!state.preview.lastTime) state.preview.lastTime = now;
    const steps = Math.max(1, Math.min(4, Math.round((now - state.preview.lastTime) / (1000 / 60))));
    state.preview.lastTime = now;
    const advanced = advancePreviewFrame(state.preview.index, state.preview.trace.length, steps, state.preview.loop);
    state.preview.index = advanced.index; state.preview.playing = advanced.playing;
    drawPreview();
    if (state.preview.playing) requestAnimationFrame(tickPreview);
  }

  function previewPoint(event, canvas) { const rect = canvas.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) / rect.width * 320, 0, 319), y: clamp((event.clientY - rect.top) / rect.height * 224, 0, 223) }; }
  function onPreviewDown(event) { const point = previewPoint(event, elements.preview); const emitterDistance = Math.hypot(point.x - state.preview.emitter.x, point.y - state.preview.emitter.y); const playerDistance = Math.hypot(point.x - state.preview.player.x, point.y - state.preview.player.y); state.preview.drag = emitterDistance < playerDistance ? 'emitter' : 'player'; elements.preview.setPointerCapture(event.pointerId); state.preview[state.preview.drag] = point; drawPreview(); }
  function onPreviewMove(event) { if (!state.preview.drag) return; state.preview[state.preview.drag] = previewPoint(event, elements.preview); drawPreview(); }
  function onPreviewUp(event) { if (!state.preview.drag) return; state.preview.drag = ''; elements.preview.releasePointerCapture(event.pointerId); void compilePreview(); }

  function onGraphDown(event) {
    const node = event.target.closest('[data-node-id]'); const rect = elements.graph.getBoundingClientRect();
    if (node) { const id = node.dataset.nodeId; const position = graphLayout(currentPattern(), state.editorState.graph.positions)[id]; state.graphDrag = { id, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y }; }
    else state.graphPan = { startX: event.clientX, startY: event.clientY, x: state.editorState.graph.panX, y: state.editorState.graph.panY };
    elements.graph.setPointerCapture(event.pointerId);
  }
  function onGraphMove(event) { if (state.graphDrag) { const zoom = state.editorState.graph.zoom; state.editorState.graph.positions[state.graphDrag.id] = { x: state.graphDrag.x + (event.clientX - state.graphDrag.startX) / zoom, y: state.graphDrag.y + (event.clientY - state.graphDrag.startY) / zoom }; setEditorDirty(true); renderGraph(); } else if (state.graphPan) { state.editorState.graph.panX = state.graphPan.x + event.clientX - state.graphPan.startX; state.editorState.graph.panY = state.graphPan.y + event.clientY - state.graphPan.startY; setEditorDirty(true); renderGraph(); } }
  function onGraphUp(event) { state.graphDrag = null; state.graphPan = null; try { elements.graph.releasePointerCapture(event.pointerId); } catch (_) {} }
  function onGraphWheel(event) { event.preventDefault(); state.editorState.graph.zoom = clamp(state.editorState.graph.zoom * (event.deltaY < 0 ? 1.1 : 0.9), .35, 2.5); setEditorDirty(true); renderGraph(); }

  function beginResize(event) { const kind = event.target.dataset.resize; const panes = state.editorState.panes; state.resize = { kind, startX: event.clientX, startY: event.clientY, value: kind === 'left' ? panes.left : kind === 'right' ? panes.right : panes.preview }; event.target.setPointerCapture(event.pointerId); }
  function moveResize(event) { if (!state.resize) return; const delta = state.resize.kind === 'preview' ? state.resize.startY - event.clientY : (state.resize.kind === 'right' ? state.resize.startX - event.clientX : event.clientX - state.resize.startX); state.editorState.panes[state.resize.kind] = state.resize.value + delta; setEditorDirty(true); applyPaneSizes(); }
  function endResize() { state.resize = null; }

  function onClick(event) {
    const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
    if (button.dataset.page) { switchPage(button.dataset.page); return; }
    if (button.dataset.side) { state.side = button.dataset.side; render(); return; }
    if (button.dataset.view) { state.editorState.view = button.dataset.view; setEditorDirty(true); render(); return; }
    if (button.dataset.pathMode) {
      state.stagePathMode = button.dataset.pathMode; state.editorState.stagePathMode = state.stagePathMode; setEditorDirty(true);
      root.querySelectorAll('[data-path-mode]').forEach((item) => item.classList.toggle('active', item.dataset.pathMode === state.stagePathMode));
      drawStagePreview(); return;
    }
    if (button.dataset.structuredScope === 'stage-settings' && button.dataset.structuredAction) {
      if (state.stageDraft && applyStructuredArrayAction(state.stageDraft, button, stgArrayTemplate)) {
        state.stageDirty = true;
        updateDirty();
        renderStageList();
        scheduleStagePreviewRefresh();
      }
      return;
    }
    if (button.dataset.structuredScope === 'pattern-settings' && button.dataset.structuredAction) {
      const pattern = currentPattern();
      if (pattern) {
        const next = clone(pattern);
        if (applyStructuredArrayAction(next, button, stgArrayTemplate)) dispatch({ type: 'replace', pattern: next });
      }
      return;
    }
    if (button.dataset.structuredScope === 'pattern-command' && button.dataset.structuredAction) {
      const command = selectedCommand();
      if (command) {
        const next = clone(command);
        if (applyStructuredArrayAction(next, button, patternArrayTemplate)) dispatch({ type: 'set', path: pathArray(state.selectedCommandPath), value: next });
      }
      return;
    }
    if (button.dataset.structuredScope === 'stage' && button.dataset.structuredAction) {
      const selected = selectedEvent();
      if (selected && applyStructuredArrayAction(selected, button, stgArrayTemplate)) {
        state.stageDirty = true;
        updateDirty();
        renderStageList();
        scheduleStagePreviewRefresh();
      }
      return;
    }
    const action = button.dataset.action;
    if (action === 'save') void saveCurrent(); else if (action === 'validate') void validate(false); else if (action === 'stress') void validate(true);
    else if (action === 'undo') { if (state.history) { state.history.undo(); markPatternChanged(); } } else if (action === 'redo') { if (state.history) { state.history.redo(); markPatternChanged(); } }
    else if (action === 'new-pattern') newPattern(); else if (action === 'select-pattern') selectPattern(button.dataset.id); else if (action === 'delete-pattern') void deletePattern(); else if (action === 'restore-pattern') void restorePattern(button.dataset.file); else if (action === 'apply-pattern-metadata') applyPatternMetadata();
    else if (action === 'select-definition') selectDefinition(button.dataset.key); else if (action === 'select-graph-command') selectDefinition(button.dataset.key, button.dataset.commandPath);
    else if (action === 'add-definition') { state.history.dispatch({ type: 'addDefinition', kind: button.dataset.kind, label: button.dataset.kind }); const definition = currentPattern().definitions.at(-1); state.selectedDefinitionKey = definitionKey(definition); state.selectedCommandPath = ''; markPatternChanged(); }
    else if (action === 'delete-definition') { const key = parseDefinitionKey(button.dataset.key); state.history.dispatch({ type: 'deleteDefinition', ...key }); state.selectedDefinitionKey = definitionKey(currentPattern().definitions[0]); state.selectedCommandPath = ''; markPatternChanged(); }
    else if (action === 'apply-definition-metadata') applyDefinitionMetadata(); else if (action === 'apply-definition-properties') applyDefinitionProperties();
    else if (action === 'add-bullet-action') addBulletAction(); else if (action === 'remove-bullet-action') removeBulletAction(number(button.dataset.index));
    else if (action === 'select-command') { state.selectedCommandPath = button.dataset.commandPath || ''; render(); }
    else if (action === 'add-command') addCommandToList(defaultCommandListPath()); else if (action === 'add-command-to-list') addCommandToList(button.dataset.listPath);
    else if (action === 'delete-command') deleteCommandAt(button.dataset.commandPath || state.selectedCommandPath);
    else if (action === 'move-command') moveCommandAt(button.dataset.commandPath || state.selectedCommandPath, button.dataset.delta);
    else if (action === 'apply-inspector') applyInspector(); else if (action === 'apply-expression') applyExpression(); else if (action === 'connect-ref') connectSelectedRef(); else if (action === 'refresh-xml') void refreshXml(); else if (action === 'copy-xml') void navigator.clipboard.writeText(elements.xml.value).then(() => setStatus('XMLをクリップボードへコピーしました', 'ok')); else if (action === 'reimport-xml') void reimportXml();
    else if (action === 'pick-pattern-sprite') void pickPatternSprite(); else if (action === 'open-pattern-sprite') void openPatternSprite();
    else if (action === 'pick-stage-collision') void pickStageCollision(); else if (action === 'open-stage-collision') void openStageCollision();
    else if (action === 'preview-reset') { state.preview.index = 0; state.preview.playing = false; drawPreview(); }
    else if (action === 'preview-step') { state.preview.index = advancePreviewFrame(state.preview.index, state.preview.trace.length, 1, state.preview.loop).index; drawPreview(); }
    else if (action === 'preview-play') { if (!state.preview.playing && state.preview.index >= state.preview.trace.length - 1) state.preview.index = 0; state.preview.playing = !state.preview.playing; state.preview.lastTime = 0; if (state.preview.playing) requestAnimationFrame(tickPreview); drawPreview(); }
    else if (action === 'new-stage') newStage(); else if (action === 'delete-stage') runGuard(() => void deleteStage()); else if (action === 'restore-stage') runGuard(() => void restoreStage(button.dataset.file));
    else if (action === 'add-event') addEvent(false); else if (action === 'add-boss') addEvent(true); else if (action === 'select-event') { state.selectedEventIndex = number(button.dataset.index); render(); } else if (action === 'save-stage') void saveStage(); else if (action === 'apply-stage-inspector') applyStageInspector(); else if (action === 'add-waypoint') addWaypoint(); else if (action === 'add-phase') addPhase(); else if (action === 'remove-phase') removePhase(); else if (action === 'delete-event') deleteEvent();
    else if (action === 'stage-reset') void resetStage(); else if (action === 'stage-step') void stepStage(1); else if (action === 'stage-play') toggleStagePlay(); else if (action === 'save-demo') void saveDemo();
  }

  async function onGuardClick(event) { const choice = event.target.closest('[data-choice]')?.dataset.choice; if (!choice) return; if (choice === 'cancel') { state.pendingAction = null; guard.close(); return; } if (choice === 'save' && !(await saveCurrent())) return; if (choice === 'discard') discard(); const action = state.pendingAction; state.pendingAction = null; guard.close(); action?.(); }
  function onStructuredChange(event) {
    if (event.target.matches('[data-role="pattern-animation-row"]')) {
      const pattern = currentPattern();
      if (!pattern) return;
      const next = clone(pattern);
      next.sprite ||= {};
      next.sprite.asset ||= { symbol: '', type: 'SPRITE' };
      next.sprite.asset.animationRow = Math.max(0, Math.trunc(number(event.target.value)));
      state.patternAssetPreviewKey = '';
      dispatch({ type: 'replace', pattern: next });
      return;
    }
    if (event.target.matches('[data-role="stage-collision-layer"]') && state.stageDraft) {
      state.stageDraft.collisionMap ||= { symbol: '', type: 'MAP', collisionLayer: '' };
      state.stageDraft.collisionMap.collisionLayer = event.target.value.trim();
      state.stageRuntime.assetPreviewKey = '';
      state.stageDirty = true;
      updateDirty();
      renderStageList();
      scheduleStagePreviewRefresh();
      return;
    }
    const patternSettingsControl = event.target.closest('[data-structured-field][data-structured-scope="pattern-settings"]');
    if (patternSettingsControl) {
      const pattern = currentPattern();
      if (!pattern) return;
      const next = clone(pattern);
      applyStructuredField(next, patternSettingsControl);
      dispatch({ type: 'replace', pattern: next });
      return;
    }
    const commandControl = event.target.closest('[data-structured-field][data-structured-scope="pattern-command"]');
    if (commandControl) {
      const command = selectedCommand();
      if (!command) return;
      const next = clone(command);
      applyStructuredField(next, commandControl);
      dispatch({ type: 'set', path: pathArray(state.selectedCommandPath), value: next });
      return;
    }
    const stageSettingsControl = event.target.closest('[data-structured-field][data-structured-scope="stage-settings"]');
    if (stageSettingsControl && state.stageDraft) {
      applyStructuredField(state.stageDraft, stageSettingsControl);
      state.stageOrientation = state.stageDraft.orientation || state.stageOrientation;
      state.stageDirty = true;
      updateDirty();
      renderStageList();
      scheduleStagePreviewRefresh();
      return;
    }
    const control = event.target.closest('[data-structured-field][data-structured-scope="stage"]');
    const selected = selectedEvent();
    if (!control || !selected) return;
    applyStructuredField(selected, control);
    state.stageDirty = true;
    updateDirty();
    elements.stageInspector.value = formatJson(selected);
    renderStageList();
    scheduleStagePreviewRefresh();
  }
  function onKeyDown(event) { if (event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); void saveCurrent(); return; } if (event.target.matches('input,textarea,select')) return; state.keys.add(event.code); if (state.page === 'stages' && event.code === 'Enter') toggleStagePlay(); if (event.code === 'KeyD') { state.stageRuntime.diagnostics = !state.stageRuntime.diagnostics; drawStagePreview(); } }
  function onKeyUp(event) { state.keys.delete(event.code); }

  root.addEventListener('click', onClick); root.addEventListener('change', onStructuredChange); root.addEventListener('keydown', onKeyDown); root.addEventListener('keyup', onKeyUp);
  elements.patternFilter.addEventListener('input', () => { state.patternFilter = elements.patternFilter.value; renderPatternList(); });
  elements.patternTypeFilter.addEventListener('change', () => { state.patternTypeFilter = elements.patternTypeFilter.value; renderPatternList(); });
  elements.definitionFilter.addEventListener('change', () => { state.definitionFilter = elements.definitionFilter.value; renderDefinitionList(); });
  elements.frame.addEventListener('input', () => { state.preview.index = number(elements.frame.value); drawPreview(); });
  elements.previewLoop.addEventListener('change', () => { state.preview.loop = elements.previewLoop.checked; state.editorState.previewLoop = state.preview.loop; setEditorDirty(true); drawPreview(); });
  for (const control of [elements.rank, elements.seed, elements.orientation]) control.addEventListener('change', () => void compilePreview());
  elements.expressionPath.addEventListener('change', () => { elements.exprAdvanced.value = getPath(currentPattern(), elements.expressionPath.value) ?? ''; });
  elements.refKind.addEventListener('change', renderRefConnector);
  elements.preview.addEventListener('pointerdown', onPreviewDown); elements.preview.addEventListener('pointermove', onPreviewMove); elements.preview.addEventListener('pointerup', onPreviewUp);
  elements.graph.addEventListener('pointerdown', onGraphDown); elements.graph.addEventListener('pointermove', onGraphMove); elements.graph.addEventListener('pointerup', onGraphUp); elements.graph.addEventListener('wheel', onGraphWheel, { passive: false });
  elements.stageFrame.addEventListener('input', () => { const frame = number(elements.stageFrame.value); renderStageList(); clearTimeout(state.stageSeekTimer); state.stageSeekTimer = setTimeout(() => void seekStage(frame), 80); });
  elements.stageSelect.addEventListener('change', () => switchStage(elements.stageSelect.value));
  elements.stagePreview.addEventListener('pointerdown', (event) => { void stepStage(0, { player: previewPoint(event, elements.stagePreview) }); });
  elements.stageSeed.addEventListener('change', () => void resetStage());
  root.querySelectorAll('[data-resize]').forEach((resizer) => { resizer.addEventListener('pointerdown', beginResize); resizer.addEventListener('pointermove', moveResize); resizer.addEventListener('pointerup', endResize); });
  guard.panel?.addEventListener('click', onGuardClick);

  const observer = new MutationObserver(() => { const active = root.classList.contains('active'); if (active && !state.wasActive && !state.loading && !state.dirty && !state.stageDirty && !state.editorDirty && !state.catalogDirty && !state.demoDirty) void reload(); state.wasActive = active; });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  registerCapability('bulletml-stg-editor', { root, refresh: reload, requestSave: saveCurrent, getDirtyState: () => ({ dirty: state.dirty || state.stageDirty || state.editorDirty || state.catalogDirty || state.demoDirty, page: state.page, patternId: state.selectedPatternId, stageId: state.selectedStageId }), openPattern(id) { selectPattern(id); return true; }, openStage(id) { if (!state.snapshot?.stages?.some((stage) => stage.id === id)) return false; switchStage(id); return true; }, setPreviewFrame(frame) { state.preview.index = clamp(frame, 0, state.preview.trace.length - 1); drawPreview(); } });
  void reload();
  return {
    beforeBuild() { return flush('build'); },
    async beforeProjectSwitch() { const result = await flush('project switch'); if (result.ok) await stopStagePreview(); return result; },
    deactivate() { observer.disconnect(); clearTimeout(state.compileTimer); clearTimeout(state.stageSeekTimer); clearTimeout(state.stageRestartTimer); state.preview.playing = false; state.stageRuntime.playing = false; void stopStagePreview(); state.v2Editor?.destroy?.(); state.demoEditor?.destroy?.(); root.removeEventListener('click', onClick); root.removeEventListener('change', onStructuredChange); root.removeEventListener('keydown', onKeyDown); root.removeEventListener('keyup', onKeyUp); elements.preview.removeEventListener('pointerdown', onPreviewDown); elements.preview.removeEventListener('pointermove', onPreviewMove); elements.preview.removeEventListener('pointerup', onPreviewUp); elements.graph.removeEventListener('pointerdown', onGraphDown); elements.graph.removeEventListener('pointermove', onGraphMove); elements.graph.removeEventListener('pointerup', onGraphUp); guard.panel?.removeEventListener('click', onGuardClick); guard.destroy(); root.innerHTML = ''; },
  };
}
