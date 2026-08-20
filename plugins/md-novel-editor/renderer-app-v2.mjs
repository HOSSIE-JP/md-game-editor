import { buildEditorShell } from './editor-shell.mjs';
import {
  CATEGORY_COLORS,
  COMMAND_DEFINITIONS,
  clone,
  commandDefinition,
  commandFromForm,
  commandSummary,
  defaultCommand,
  escapeHtml,
  isCommandSkipped,
  isKnownCommand,
  normalizedSceneName,
  renameSceneReferences,
  sceneReferences,
} from './command-ui.mjs';
import {
  assetsHtml,
  commandDetailHtml,
  commandListHtml,
  commandPaletteHtml,
  diagnosticsHtml,
  fontSettingsHtml,
  sceneListHtml,
  systemFormHtml,
} from './editor-render.mjs';
import { simulateScene } from './preview-core.mjs';
import { collectVisualAssetIds, drawFontPreviews, drawNovelFrame } from './rendering.mjs';
import { openNovelPreview } from './preview-window.mjs';

const STORAGE_PREFIX = 'md-novel-editor.pce-ui.v1';
const HISTORY_LIMIT = 100;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.max(minimum, Math.min(maximum, number(value, fallback)));
}

function sourceDirectory(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/\/project\.json$/i, '');
}

function readStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}.${key}`) || 'null');
    return value == null ? fallback : value;
  } catch (_) { return fallback; }
}

function writeStoredJson(key, value) {
  try { localStorage.setItem(`${STORAGE_PREFIX}.${key}`, JSON.stringify(value)); } catch (_) {}
}

function uniqueSceneId(rawValue, scenes, fallback = 'scene') {
  const base = String(rawValue || fallback).trim().replace(/[^A-Za-z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 32) || fallback;
  const used = new Set(scenes.map((scene) => scene.id));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 32 - String(suffix).length - 1))}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${fallback}_${Date.now().toString(36)}`.slice(0, 32);
}

function selectedScene(state) {
  return state.sceneDocument?.scenes?.find((scene) => scene.id === state.selectedSceneId) || null;
}

function selectedCommand(state) {
  return selectedScene(state)?.commands?.[state.selectedCommandIndex] || null;
}

function collectUsedText(sceneDocument) {
  const chunks = [];
  for (const scene of sceneDocument?.scenes || []) {
    for (const command of scene.commands || []) {
      if (command.type === 'message') chunks.push(command.speaker || '', command.text || '');
      if (command.type === 'spritetext' || command.type === 'comment') chunks.push(command.text || '');
      if (command.type === 'choice') for (const choice of command.choices || []) chunks.push(choice.label || '');
    }
  }
  return chunks.filter(Boolean).join('\n');
}

function stylesheetLink() {
  const href = new URL('./pce-editor.css', import.meta.url).href;
  const existing = document.head.querySelector(`link[data-md-novel-pce-style="${href}"]`);
  if (existing) return { element: existing, owned: false };
  const element = document.createElement('link');
  element.rel = 'stylesheet';
  element.href = href;
  element.dataset.mdNovelPceStyle = href;
  document.head.appendChild(element);
  return { element, owned: true };
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const style = stylesheetLink();
  root.classList.add('md-novel-editor-page');
  root.innerHTML = buildEditorShell();
  const role = (name) => root.querySelector(`[data-role="${name}"]`);
  const elements = Object.fromEntries([
    'dirty', 'status', 'scene-count', 'scene-list', 'command-library', 'command-library-body', 'command-library-chevron',
    'command-search', 'command-palette', 'script-workspace', 'left-column', 'right-column', 'scene-title', 'scene-name',
    'scene-id', 'scene-full-bg', 'command-list-search', 'scene-budget', 'budget-label', 'budget-value', 'budget-fill',
    'budget-metrics', 'command-list', 'scene-json-pane', 'scene-json', 'script-error', 'command-preview-title',
    'preview-label', 'command-preview', 'preview-audio-status', 'command-form', 'system-form', 'font-settings',
    'font-text-preview', 'font-atlas-preview', 'font-glyph-count', 'asset-list', 'diagnostics',
  ].map((name) => [name.replace(/-([a-z])/g, (_match, character) => character.toUpperCase()), role(name)]));

  const state = {
    snapshot: null,
    sceneDocument: null,
    targetProfile: null,
    bindings: null,
    catalog: null,
    pceFont: null,
    selectedSceneId: '',
    selectedCommandIndex: 0,
    tab: 'script',
    editorMode: 'gui',
    sceneJsonDirty: false,
    dirty: false,
    loading: false,
    history: [],
    future: [],
    formEditActive: false,
    formEditTimer: 0,
    commandClipboard: null,
    commandSearch: '',
    commandListSearch: '',
    collapsedGroups: new Set(readStoredJson('collapsedSceneGroups', [])),
    commandLibraryCollapsed: Boolean(readStoredJson('commandLibraryCollapsed', false)),
    leftCollapsed: false,
    rightCollapsed: false,
    columnLayout: { left: 320, right: 440, ...readStoredJson('columnLayout', {}) },
    sceneDragId: '',
    commandDragIndex: null,
    newCommandDragType: '',
    projectDir: '',
    imageCache: new Map(),
    fontImage: null,
    previewGeneration: 0,
    audioPlayer: null,
    audioContext: null,
    psgNodes: [],
    previewWindow: null,
    wasActive: root.classList.contains('active'),
  };

  const decision = api.createModal({
    id: `${plugin.id}-decision`,
    html: `<div class="settings-form compact-form mn-confirm-dialog"><h3 data-decision-title>確認</h3><p data-decision-message></p><pre data-decision-details hidden></pre><div class="mn-confirm-actions"><button type="button" data-decision="save" class="primary" hidden>保存</button><button type="button" data-decision="confirm">実行</button><button type="button" data-decision="cancel">キャンセル</button></div></div>`,
  });
  let decisionResolve = null;

  function askDecision(options = {}) {
    if (decisionResolve) decisionResolve('cancel');
    const panel = decision.panel;
    panel.querySelector('[data-decision-title]').textContent = options.title || '確認';
    panel.querySelector('[data-decision-message]').textContent = options.message || '';
    const details = panel.querySelector('[data-decision-details]');
    details.textContent = options.details || '';
    details.hidden = !options.details;
    const save = panel.querySelector('[data-decision="save"]');
    save.hidden = !options.allowSave;
    const confirm = panel.querySelector('[data-decision="confirm"]');
    confirm.textContent = options.confirmLabel || (options.allowSave ? '破棄' : '実行');
    confirm.classList.toggle('danger', Boolean(options.danger));
    decision.open();
    return new Promise((resolve) => { decisionResolve = resolve; });
  }

  function finishDecision(choice) {
    const resolve = decisionResolve;
    decisionResolve = null;
    decision.close();
    resolve?.(choice);
  }

  function setStatus(message, tone = '') {
    elements.status.textContent = String(message || '');
    elements.status.dataset.tone = tone;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    elements.dirty.textContent = state.dirty ? '● 未保存' : '';
  }

  function contextFor(scene = selectedScene(state)) {
    return { sceneDocument: state.sceneDocument, scene, catalog: state.catalog, bindings: state.bindings };
  }

  function documentState() {
    return clone({ sceneDocument: state.sceneDocument, targetProfile: state.targetProfile, bindings: state.bindings });
  }

  function restoreDocumentState(snapshot) {
    state.sceneDocument = clone(snapshot.sceneDocument);
    state.targetProfile = clone(snapshot.targetProfile);
    state.bindings = clone(snapshot.bindings);
    if (!selectedScene(state)) state.selectedSceneId = state.sceneDocument?.scenes?.[0]?.id || '';
    const scene = selectedScene(state);
    state.selectedCommandIndex = Math.max(0, Math.min(state.selectedCommandIndex, Math.max(0, (scene?.commands?.length || 1) - 1)));
    state.sceneJsonDirty = false;
  }

  function remember(snapshot = documentState()) {
    state.history.push(clone(snapshot));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future = [];
  }

  function beginFormEdit() {
    if (!state.formEditActive) {
      remember();
      state.formEditActive = true;
    }
    clearTimeout(state.formEditTimer);
    state.formEditTimer = window.setTimeout(() => { state.formEditActive = false; }, 650);
  }

  function finishFormEdit() {
    clearTimeout(state.formEditTimer);
    state.formEditActive = false;
  }

  function mutate(action, renderAfter = true) {
    finishFormEdit();
    remember();
    action();
    setDirty(true);
    if (renderAfter) render();
  }

  function undo() {
    finishFormEdit();
    const previous = state.history.pop();
    if (!previous) return;
    state.future.push(documentState());
    restoreDocumentState(previous);
    setDirty(true);
    render();
  }

  function redo() {
    finishFormEdit();
    const next = state.future.pop();
    if (!next) return;
    state.history.push(documentState());
    restoreDocumentState(next);
    setDirty(true);
    render();
  }

  function applyWorkspaceLayout() {
    const left = clamp(state.columnLayout.left, 240, 520, 320);
    const right = clamp(state.columnLayout.right, 320, 720, 440);
    state.columnLayout = { left, right };
    elements.scriptWorkspace.style.setProperty('--mn-left-width', `${left}px`);
    elements.scriptWorkspace.style.setProperty('--mn-right-width', `${right}px`);
    elements.scriptWorkspace.dataset.leftCollapsed = String(state.leftCollapsed);
    elements.scriptWorkspace.dataset.rightCollapsed = String(state.rightCollapsed);
  }

  function renderTabs() {
    root.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.tab));
    root.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.dataset.section === state.tab));
  }

  function renderScenes() {
    const scrollTop = elements.sceneList.scrollTop;
    elements.sceneCount.textContent = String(state.sceneDocument?.scenes?.length || 0);
    elements.sceneList.innerHTML = sceneListHtml(state);
    elements.sceneList.scrollTop = scrollTop;
  }

  function renderPalette() {
    elements.commandLibrary.classList.toggle('collapsed', state.commandLibraryCollapsed);
    elements.commandLibraryChevron.textContent = state.commandLibraryCollapsed ? '▸' : '▾';
    elements.commandLibraryBody.hidden = state.commandLibraryCollapsed;
    elements.commandPalette.innerHTML = commandPaletteHtml(state);
  }

  function renderBudget() {
    const scene = selectedScene(state);
    const global = state.snapshot?.budget || {};
    const budget = global.perScene?.[scene?.id] || global;
    const maximum = number(budget.maxBudget);
    const ratio = Math.max(0, maximum / 1424);
    const hasError = (budget.diagnostics || []).some((entry) => entry.severity === 'error');
    const level = hasError || ratio > 1 ? 'error' : ratio >= .85 ? 'warn' : 'ok';
    elements.sceneBudget.dataset.level = level;
    elements.budgetValue.textContent = `${maximum || 0} / 1424 tiles`;
    elements.budgetFill.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
    elements.budgetMetrics.innerHTML = `<span>states ${budget.states ?? 0}</span><span>overlay ${budget.maxOverlayTiles ?? 0}/192</span><span>sprite tiles ${budget.maxSpriteTiles ?? 0}</span><span>pieces ${budget.maxSpritePieces ?? 0}/80</span><span>scanline ${budget.maxScanlinePieces ?? 0}/20 · ${budget.maxScanlinePixels ?? 0}/320px</span><span>DMA ${state.targetProfile?.runtime?.dmaBytesPerFrame ?? 6144}B/f</span><button type="button" data-action="show-diagnostics">診断を開く</button>`;
  }

  function updateSceneJsonText(force = false) {
    const scene = selectedScene(state);
    if (!scene || (state.sceneJsonDirty && !force)) return;
    elements.sceneJson.value = JSON.stringify(scene, null, 2);
    state.sceneJsonDirty = false;
  }

  function renderCommands() {
    const scene = selectedScene(state);
    const listScroll = elements.commandList.scrollTop;
    const jsonMode = state.editorMode === 'json';
    elements.commandList.hidden = jsonMode;
    elements.sceneJsonPane.hidden = !jsonMode;
    root.querySelectorAll('[data-script-mode]').forEach((button) => button.classList.toggle('active', button.dataset.scriptMode === state.editorMode));
    if (jsonMode) updateSceneJsonText();
    else {
      elements.commandList.innerHTML = commandListHtml(state, scene, contextFor(scene));
      elements.commandList.scrollTop = listScroll;
    }
  }

  function renderDetail() {
    const command = selectedCommand(state);
    elements.commandForm.innerHTML = commandDetailHtml(command, state.selectedCommandIndex, contextFor());
    elements.commandPreviewTitle.textContent = command ? `#${state.selectedCommandIndex + 1} ${commandDefinition(command.type).label}` : 'Command Preview';
  }

  function renderSystem() {
    elements.systemForm.innerHTML = systemFormHtml(state.sceneDocument, state.targetProfile);
  }

  async function loadProjectImage(relativePath, cacheKey = relativePath) {
    const key = String(cacheKey || relativePath || '').replace(/\\/g, '/');
    const cached = state.imageCache.get(key);
    if (cached?.image) return cached.image;
    if (cached?.promise) return cached.promise;
    const record = { image: null, promise: null, error: '' };
    record.promise = (async () => {
      const projectDir = await getProjectDir();
      const path = `${projectDir}/${String(relativePath || '').replace(/^\/+/, '')}`;
      const result = await api.electronAPI.readFileAsDataUrl(path);
      if (!result?.ok || !result.dataUrl) throw new Error(result?.error || `読込失敗: ${relativePath}`);
      const image = new Image();
      image.src = result.dataUrl;
      await image.decode();
      record.image = image;
      record.promise = null;
      return image;
    })().catch((error) => { record.error = error.message; record.promise = null; return null; });
    state.imageCache.set(key, record);
    return record.promise;
  }

  function imageForAsset(assetId) {
    const path = state.bindings?.assets?.[assetId]?.sourcePath;
    if (!path) return null;
    return state.imageCache.get(`asset:${path}`)?.image || null;
  }

  async function ensureAssetImages(assetIds) {
    await Promise.all([...new Set(assetIds || [])].map((assetId) => {
      const path = state.bindings?.assets?.[assetId]?.sourcePath;
      return path ? loadProjectImage(`res/${path}`, `asset:${path}`) : null;
    }));
  }

  async function refreshCommandPreview() {
    const generation = ++state.previewGeneration;
    const scene = selectedScene(state);
    const command = selectedCommand(state);
    const visual = scene ? simulateScene(scene, state.selectedCommandIndex, { columns: 19, rows: 4 }) : {};
    visual.choiceIndex = visual.choice?.defaultIndex || 0;
    visual.autoEnabled = state.sceneDocument?.settings?.messageAdvanceMode === 'auto';
    drawNovelFrame(elements.commandPreview, visual, { coordinateMode: state.targetProfile?.coordinateMode, bindings: state.bindings, imageForAsset });
    elements.previewLabel.textContent = scene && command ? `${scene.id} · #${state.selectedCommandIndex + 1}` : '';
    updateAudioPreviewState(command);
    await ensureAssetImages(collectVisualAssetIds(visual));
    if (generation !== state.previewGeneration) return;
    drawNovelFrame(elements.commandPreview, visual, { coordinateMode: state.targetProfile?.coordinateMode, bindings: state.bindings, imageForAsset });
  }

  async function renderFont() {
    const text = collectUsedText(state.sceneDocument);
    const unique = [...new Set(Array.from(text).filter((character) => !['\r', '\n'].includes(character)))];
    elements.fontSettings.innerHTML = fontSettingsHtml(state.targetProfile, state.pceFont, unique.length);
    elements.fontGlyphCount.textContent = `${unique.length} glyphs`;
    if (!state.fontImage) state.fontImage = await loadProjectImage('res/novel/font/misaki_gothic.png', 'font:misaki');
    const previewText = String(state.pceFont?.previewText || text || 'MDノベルのフォント表示\n19文字x4行').slice(0, 512);
    drawFontPreviews(elements.fontTextPreview, elements.fontAtlasPreview, previewText, state.fontImage, text);
  }

  function renderAssets() { elements.assetList.innerHTML = assetsHtml(state.bindings); }
  function renderDiagnostics() { elements.diagnostics.innerHTML = diagnosticsHtml(state.snapshot?.diagnostics || []); }

  function renderScript() {
    const scene = selectedScene(state);
    elements.sceneTitle.textContent = scene?.name || scene?.id || 'Scene';
    elements.sceneName.value = scene?.name || '';
    elements.sceneId.value = scene?.id || '';
    elements.sceneFullBg.checked = Boolean(scene?.fullScreenBg);
    applyWorkspaceLayout();
    renderScenes();
    renderPalette();
    renderCommands();
    renderDetail();
    renderBudget();
    void refreshCommandPreview();
  }

  function render() {
    if (!state.snapshot) return;
    renderTabs();
    renderScript();
    renderSystem();
    renderAssets();
    renderDiagnostics();
    root.querySelector('[data-action="undo"]').disabled = !state.history.length;
    root.querySelector('[data-action="redo"]').disabled = !state.future.length;
    if (state.tab === 'font') void renderFont();
  }

  async function getProjectDir() {
    if (state.projectDir) return state.projectDir;
    const project = await api.electronAPI.getCurrentProject?.();
    state.projectDir = String(project?.projectDir || project?.dir || project?.currentProjectDir || '').replace(/\\/g, '/');
    return state.projectDir;
  }

  function adoptSnapshot(result, options = {}) {
    const selectedId = options.selectedId || state.selectedSceneId;
    const selectedIndex = options.selectedIndex ?? state.selectedCommandIndex;
    state.snapshot = result;
    state.sceneDocument = clone(result.sceneDocument);
    state.targetProfile = clone(result.targetProfile);
    state.bindings = clone(result.bindings);
    state.catalog = clone(result.catalog);
    state.pceFont = clone(result.pceFont);
    state.selectedSceneId = state.sceneDocument?.scenes?.some((scene) => scene.id === selectedId) ? selectedId : state.sceneDocument?.scenes?.[0]?.id || '';
    state.selectedCommandIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, (selectedScene(state)?.commands?.length || 1) - 1)));
    state.imageCache.clear();
    state.fontImage = null;
    state.sceneJsonDirty = false;
    if (options.resetHistory !== false) { state.history = []; state.future = []; }
    setDirty(false);
  }

  async function loadFromDisk() {
    if (state.loading) return false;
    state.loading = true;
    setStatus('Novelデータを読込中…');
    try {
      state.projectDir = '';
      const result = await api.plugins.invokeHook(plugin.id, 'loadMdNovelProject', {});
      if (!result?.sceneDocument) throw new Error(result?.error || 'Novel projectを読込めません');
      adoptSnapshot(result, { resetHistory: true });
      render();
      setStatus(result.ok ? '読込完了' : `読込完了: ${(result.diagnostics || []).filter((entry) => entry.severity === 'error').length} error`, result.ok ? 'ok' : 'error');
      return result.ok;
    } catch (error) {
      setStatus(error.message, 'error');
      logger.error(error.message);
      return false;
    } finally { state.loading = false; }
  }

  async function reloadWithGuard() {
    if (!state.dirty) return loadFromDisk();
    const choice = await askDecision({ title: '未保存の変更', message: '再読込すると未保存の編集内容が失われます。', allowSave: true, confirmLabel: '破棄' });
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await saveCurrent())) return false;
    return loadFromDisk();
  }

  function applySceneJson() {
    if (state.editorMode !== 'json' || !state.sceneJsonDirty) return true;
    try {
      const parsed = JSON.parse(elements.sceneJson.value || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Scene JSONはobjectである必要があります');
      const index = state.sceneDocument.scenes.findIndex((scene) => scene.id === state.selectedSceneId);
      if (index < 0) return true;
      remember();
      state.sceneDocument.scenes[index] = parsed;
      state.selectedSceneId = String(parsed.id || state.selectedSceneId);
      state.sceneJsonDirty = false;
      setDirty(true);
      elements.scriptError.textContent = '';
      return true;
    } catch (error) {
      elements.scriptError.textContent = `Scene JSONエラー: ${error.message}`;
      elements.sceneJson.focus();
      return false;
    }
  }

  async function saveCurrent() {
    if (!state.snapshot || state.loading) return false;
    if (!applySceneJson()) return false;
    if (!state.dirty) return true;
    finishFormEdit();
    setStatus('保存中…');
    try {
      const selectedId = state.selectedSceneId;
      const selectedIndex = state.selectedCommandIndex;
      const result = await api.plugins.invokeHook(plugin.id, 'saveMdNovelProject', {
        sceneDocument: state.sceneDocument,
        targetProfile: state.targetProfile,
        bindings: state.bindings,
        baseRevisions: state.snapshot.revisions,
      });
      if (!result?.sceneDocument) throw new Error(result?.error || '保存に失敗しました');
      const history = state.history;
      const future = state.future;
      adoptSnapshot(result, { selectedId, selectedIndex, resetHistory: false });
      state.history = history;
      state.future = future;
      render();
      setStatus('保存しました', 'ok');
      return true;
    } catch (error) {
      setStatus(error.message, 'error');
      return false;
    }
  }

  async function importProject() {
    if (state.dirty && !(await saveCurrent())) return;
    const picked = await api.electronAPI.pickFile({ title: 'PCE project.jsonを選択', properties: ['openFile'], filters: [{ name: 'PCE Game Editor project', extensions: ['json'] }] });
    if (picked?.canceled || !picked.sourcePath) return;
    if (!/[/\\]project\.json$/i.test(picked.sourcePath)) { setStatus('PCE project.jsonを選択してください', 'error'); return; }
    setStatus('PCEノベルをMD向けに変換中…');
    try {
      const result = await api.plugins.invokeHook(plugin.id, 'importPceNovelProject', { sourceProjectDir: sourceDirectory(picked.sourcePath) });
      if (!result?.sceneDocument) throw new Error(result?.error || 'PCE importに失敗しました');
      adoptSnapshot(result, { resetHistory: true });
      render();
      setStatus(`取込完了: visual ${result.importReport?.visualAssets || 0}, PSG ${result.importReport?.audioVariants || 0}`, 'ok');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  async function validateProject() {
    if (state.dirty && !(await saveCurrent())) return;
    const result = await api.plugins.invokeHook(plugin.id, 'validateMdNovelProject', {});
    if (!result?.sceneDocument) { setStatus(result?.error || '検証に失敗しました', 'error'); return; }
    adoptSnapshot(result, { selectedId: state.selectedSceneId, selectedIndex: state.selectedCommandIndex, resetHistory: false });
    state.tab = 'diagnostics';
    render();
    setStatus(result.ok ? '検証成功' : '検証エラーがあります', result.ok ? 'ok' : 'error');
  }

  function selectScene(sceneId) {
    if (!applySceneJson()) return;
    finishFormEdit();
    state.selectedSceneId = sceneId;
    state.selectedCommandIndex = 0;
    state.sceneJsonDirty = false;
    render();
  }

  function selectCommand(index) {
    finishFormEdit();
    const maximum = Math.max(0, (selectedScene(state)?.commands?.length || 1) - 1);
    state.selectedCommandIndex = Math.max(0, Math.min(maximum, Number(index) || 0));
    renderCommands();
    renderDetail();
    void refreshCommandPreview();
  }

  function addScene() {
    if (!applySceneJson()) return;
    mutate(() => {
      const scenes = state.sceneDocument.scenes;
      const id = uniqueSceneId(`scene_${scenes.length + 1}`, scenes);
      scenes.push({ id, name: '', fullScreenBg: false, commands: [defaultCommand('message', contextFor())], nextSceneId: '' });
      state.selectedSceneId = id;
      state.selectedCommandIndex = 0;
    });
  }

  async function deleteScene(sceneId) {
    const scenes = state.sceneDocument?.scenes || [];
    if (scenes.length <= 1) return;
    const references = sceneReferences(state.sceneDocument, sceneId);
    const details = references.map((entry) => `${entry.path}: ${entry.sceneId}${entry.commandIndex != null ? ` #${entry.commandIndex + 1}` : ''}`).join('\n');
    const choice = await askDecision({ title: 'Sceneを削除', message: `${sceneId} を削除します。参照先は自動変更されません。`, details, confirmLabel: '削除', danger: true });
    if (choice !== 'confirm') return;
    mutate(() => {
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      state.sceneDocument.scenes = scenes.filter((scene) => scene.id !== sceneId);
      if (state.selectedSceneId === sceneId) state.selectedSceneId = state.sceneDocument.scenes[Math.min(index, state.sceneDocument.scenes.length - 1)]?.id || '';
      state.selectedCommandIndex = 0;
    });
  }

  function renameScene(rawId) {
    const scene = selectedScene(state);
    if (!scene) return;
    const previousId = scene.id;
    const others = state.sceneDocument.scenes.filter((entry) => entry !== scene);
    const nextId = uniqueSceneId(rawId || previousId, others, previousId || 'scene');
    if (nextId === previousId) { elements.sceneId.value = previousId; return; }
    mutate(() => {
      scene.id = nextId;
      renameSceneReferences(state.sceneDocument, previousId, nextId);
      state.selectedSceneId = nextId;
    });
  }

  function addCommand(type, index = state.selectedCommandIndex + 1) {
    const scene = selectedScene(state);
    if (!scene) return;
    mutate(() => {
      const at = Math.max(0, Math.min(scene.commands.length, Number(index) || 0));
      scene.commands.splice(at, 0, defaultCommand(type, contextFor(scene)));
      state.selectedCommandIndex = at;
    });
  }

  function deleteCommand(index) {
    const scene = selectedScene(state);
    if (!scene?.commands?.[index]) return;
    mutate(() => {
      scene.commands.splice(index, 1);
      state.selectedCommandIndex = Math.max(0, Math.min(index, scene.commands.length - 1));
    });
  }

  function copyCommand(index) {
    const command = selectedScene(state)?.commands?.[index];
    if (!command) return;
    state.commandClipboard = clone(command);
    setStatus(`${commandDefinition(command.type).label}をコピーしました`, 'ok');
    renderCommands();
  }

  function pasteCommand(index, after) {
    const scene = selectedScene(state);
    if (!scene || !state.commandClipboard) return;
    mutate(() => {
      const at = Math.max(0, Math.min(scene.commands.length, Number(index) + (after ? 1 : 0)));
      scene.commands.splice(at, 0, clone(state.commandClipboard));
      state.selectedCommandIndex = at;
    });
  }

  function moveCommand(from, to) {
    const scene = selectedScene(state);
    if (!scene || from < 0 || from >= scene.commands.length) return;
    let target = Math.max(0, Math.min(scene.commands.length, to));
    if (from < target) target -= 1;
    if (from === target) return;
    mutate(() => {
      const [command] = scene.commands.splice(from, 1);
      scene.commands.splice(target, 0, command);
      state.selectedCommandIndex = target;
    });
  }

  function moveScene(sceneId, targetId, after) {
    const scenes = state.sceneDocument.scenes;
    const from = scenes.findIndex((scene) => scene.id === sceneId);
    let to = scenes.findIndex((scene) => scene.id === targetId);
    if (from < 0 || to < 0) return;
    if (after) to += 1;
    if (from < to) to -= 1;
    if (from === to) return;
    mutate(() => { const [scene] = scenes.splice(from, 1); scenes.splice(to, 0, scene); });
  }

  function updateKnownCommand(options = {}) {
    const scene = selectedScene(state);
    const current = selectedCommand(state);
    if (!scene || !current || !isKnownCommand(current.type)) return;
    beginFormEdit();
    scene.commands[state.selectedCommandIndex] = commandFromForm(elements.commandForm, current, contextFor(scene));
    setDirty(true);
    if (options.rerenderCommands !== false) renderCommands();
    if (options.rerenderDetail) renderDetail();
    void refreshCommandPreview();
  }

  async function changeCommandType(nextType) {
    const current = selectedCommand(state);
    if (!current || current.type === nextType) return;
    const choice = await askDecision({ title: 'Command typeを変更', message: `${commandDefinition(current.type).label}を${commandDefinition(nextType).label}の既定値へ置換します。未知フィールドを含む旧内容は引き継がれません。`, confirmLabel: '置換' });
    if (choice !== 'confirm') { renderDetail(); return; }
    mutate(() => {
      const replacement = defaultCommand(nextType, contextFor());
      if (isCommandSkipped(current)) replacement.skip = true;
      selectedScene(state).commands[state.selectedCommandIndex] = replacement;
    });
  }

  function applyUnknownCommand() {
    const textarea = elements.commandForm.querySelector('[data-role="unknown-command-json"]');
    if (!textarea) return;
    try {
      const parsed = JSON.parse(textarea.value || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Commandはobjectである必要があります');
      mutate(() => { selectedScene(state).commands[state.selectedCommandIndex] = parsed; });
      elements.scriptError.textContent = '';
    } catch (error) { elements.scriptError.textContent = `Command JSONエラー: ${error.message}`; }
  }

  function stopAudioPreview() {
    if (state.audioPlayer) { try { state.audioPlayer.pause(); } catch (_) {} state.audioPlayer = null; }
    for (const node of state.psgNodes.splice(0)) { try { node.stop(); } catch (_) {} }
  }

  function psgAsset(assetId) { return (state.catalog?.assets || []).find((asset) => asset.id === assetId && (asset.type === 'psg-song' || asset.type === 'psg-sfx')); }

  function playPsgPattern(asset) {
    stopAudioPreview();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio APIを利用できません');
    state.audioContext ||= new AudioContextClass();
    const audioContext = state.audioContext;
    const pattern = Array.isArray(asset?.options?.pattern) ? asset.options.pattern : [];
    const bpm = Math.max(30, number(asset?.options?.bpm, 120));
    const stepSeconds = 60 / bpm / 4;
    const start = audioContext.currentTime + .02;
    const byChannel = new Map();
    for (const event of pattern) {
      const channel = Math.max(0, Math.min(5, Number(event.channel) || 0));
      if (!byChannel.has(channel)) byChannel.set(channel, []);
      byChannel.get(channel).push(event);
    }
    for (const [channel, events] of byChannel) {
      events.sort((a, b) => number(a.step) - number(b.step));
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const volume = Math.max(0, Math.min(31, number(event.volume)));
        const period = Math.max(1, number(event.period));
        if (!volume || !period) continue;
        const next = events.slice(index + 1).find((candidate) => number(candidate.step) > number(event.step));
        const duration = Math.max(.025, ((next ? number(next.step) : number(event.step) + 1) - number(event.step)) * stepSeconds);
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = channel >= 4 ? 'square' : 'sine';
        oscillator.frequency.value = Math.max(40, Math.min(12000, 3579545 / (32 * period)));
        gain.gain.value = (volume / 31) * .08;
        oscillator.connect(gain).connect(audioContext.destination);
        const when = start + number(event.step) * stepSeconds;
        oscillator.start(when);
        oscillator.stop(when + duration);
        state.psgNodes.push(oscillator);
      }
    }
  }

  async function playConvertedWav(path) {
    stopAudioPreview();
    const projectDir = await getProjectDir();
    const result = await api.electronAPI.readFileAsDataUrl(`${projectDir}/res/${path}`);
    if (!result?.ok || !result.dataUrl) throw new Error(result?.error || 'WAVを読込めません');
    const audio = new Audio(result.dataUrl);
    state.audioPlayer = audio;
    audio.addEventListener('ended', () => { if (state.audioPlayer === audio) state.audioPlayer = null; }, { once: true });
    await audio.play();
  }

  async function playAudioCommand(command) {
    if (!command || command.type !== 'audio') return;
    if (command.kind !== 'psg') return;
    if (command.action === 'stop') { stopAudioPreview(); return; }
    const asset = psgAsset(command.assetId);
    if (!asset) throw new Error(`PSG assetがありません: ${command.assetId}`);
    const variant = state.bindings?.audioVariants?.[`${command.assetId}@${Number(command.channel) || 0}`];
    if (asset.type === 'psg-sfx' && variant?.sourcePath?.toLowerCase().endsWith('.wav')) await playConvertedWav(variant.sourcePath);
    else playPsgPattern(asset);
  }

  function updateAudioPreviewState(command) {
    const button = root.querySelector('[data-action="preview-audio"]');
    if (!command) { button.disabled = true; elements.previewAudioStatus.textContent = ''; return; }
    if (command.type === 'message' && command.voiceAssetId) { button.disabled = true; elements.previewAudioStatus.textContent = 'ADPCM voice · MDでは無音'; return; }
    if (command.type !== 'audio') { button.disabled = true; elements.previewAudioStatus.textContent = ''; return; }
    if (command.kind === 'cdda' || command.kind === 'adpcm') { button.disabled = true; elements.previewAudioStatus.textContent = `${command.kind.toUpperCase()} · MDでは無音`; return; }
    if (command.action === 'stop') { button.disabled = true; elements.previewAudioStatus.textContent = 'stop command'; return; }
    const asset = psgAsset(command.assetId);
    button.disabled = !asset;
    elements.previewAudioStatus.textContent = asset ? `${asset.type} · ch${Number(command.channel) || 0}` : 'PSG asset未登録';
  }

  async function openFullPreview() {
    if (!applySceneJson()) return;
    state.previewWindow?.close();
    try {
      state.previewWindow = openNovelPreview({
        sceneDocument: state.sceneDocument,
        startSceneId: state.selectedSceneId,
        coordinateMode: state.targetProfile?.coordinateMode,
        bindings: state.bindings,
        catalog: state.catalog,
        budget: state.snapshot?.budget?.perScene?.[state.selectedSceneId] || state.snapshot?.budget,
        imageForAsset,
        ensureAssetImages,
        onAudioEvent(event) { void playAudioCommand(event.command).catch((error) => logger.warn(error.message)); },
        onClose() { state.previewWindow = null; stopAudioPreview(); },
      });
    } catch (error) { setStatus(error.message, 'error'); }
  }

  function updateSystemFromForm() {
    beginFormEdit();
    const data = new FormData(elements.systemForm);
    state.sceneDocument.settings = {
      ...(state.sceneDocument.settings || {}),
      messageSpeedFrames: Number(data.get('messageSpeedFrames')) || 0,
      messageAdvanceMode: String(data.get('messageAdvanceMode') || 'button'),
      messageAutoWaitFrames: clamp(data.get('messageAutoWaitFrames'), 0, 255, 60),
    };
    state.targetProfile.coordinateMode = String(data.get('coordinateMode') || 'pce-legacy-256');
    state.targetProfile.runtime = { ...(state.targetProfile.runtime || {}), dmaBytesPerFrame: clamp(data.get('dmaBytesPerFrame'), 512, 16384, 6144) };
    state.targetProfile.rom = { ...(state.targetProfile.rom || {}), targetBytes: Math.max(1, Number(data.get('targetBytes')) || 3670016), hardLimitBytes: Math.max(1, Number(data.get('hardLimitBytes')) || 4194304) };
    setDirty(true);
    renderBudget();
  }

  async function flush(reason) {
    const ok = await saveCurrent();
    return ok ? { ok: true } : { ok: false, error: `MD Novel editor could not save before ${reason}.` };
  }

  async function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.tab) {
      if (!applySceneJson()) return;
      state.tab = button.dataset.tab;
      render();
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    if (action === 'reload') await reloadWithGuard();
    else if (action === 'save') await saveCurrent();
    else if (action === 'import') await importProject();
    else if (action === 'validate') await validateProject();
    else if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; applyWorkspaceLayout(); }
    else if (action === 'toggle-right') { state.rightCollapsed = !state.rightCollapsed; applyWorkspaceLayout(); }
    else if (action === 'toggle-command-library') { state.commandLibraryCollapsed = !state.commandLibraryCollapsed; writeStoredJson('commandLibraryCollapsed', state.commandLibraryCollapsed); renderPalette(); }
    else if (action === 'toggle-scene-group') { const path = button.dataset.groupPath; if (state.collapsedGroups.has(path)) state.collapsedGroups.delete(path); else state.collapsedGroups.add(path); writeStoredJson('collapsedSceneGroups', [...state.collapsedGroups]); renderScenes(); }
    else if (action === 'select-scene') selectScene(button.dataset.sceneId);
    else if (action === 'set-start-scene') mutate(() => { state.sceneDocument.startScene = button.dataset.sceneId; });
    else if (action === 'delete-scene') await deleteScene(button.dataset.sceneId);
    else if (action === 'add-scene') addScene();
    else if (action === 'select-command') selectCommand(button.dataset.commandIndex);
    else if (action === 'add-command') addCommand(button.dataset.commandType);
    else if (action === 'delete-command') deleteCommand(Number(button.dataset.commandIndex));
    else if (action === 'copy-command') copyCommand(Number(button.dataset.commandIndex));
    else if (action === 'paste-before') pasteCommand(Number(button.dataset.commandIndex), false);
    else if (action === 'paste-after') pasteCommand(Number(button.dataset.commandIndex), true);
    else if (action === 'apply-scene-json') { if (applySceneJson()) render(); }
    else if (action === 'apply-unknown-command') applyUnknownCommand();
    else if (action === 'add-choice') { updateKnownCommand({ rerenderCommands: false }); const command = selectedCommand(state); if ((command.choices || []).length < 4) { beginFormEdit(); command.choices.push({ label: `選択肢${command.choices.length + 1}`, value: command.choices.length, targetSceneId: '' }); setDirty(true); renderDetail(); renderCommands(); } }
    else if (action === 'remove-choice') { updateKnownCommand({ rerenderCommands: false }); const command = selectedCommand(state); if (command.choices.length > 1) { beginFormEdit(); command.choices.splice(Number(button.dataset.index), 1); command.defaultIndex = Math.min(command.defaultIndex || 0, command.choices.length - 1); setDirty(true); renderDetail(); renderCommands(); } }
    else if (action === 'add-switch') { updateKnownCommand({ rerenderCommands: false }); const command = selectedCommand(state); if ((command.cases || []).length < 16) { beginFormEdit(); command.cases.push({ value: command.cases.length, targetLabel: '' }); setDirty(true); renderDetail(); renderCommands(); } }
    else if (action === 'remove-switch') { updateKnownCommand({ rerenderCommands: false }); const command = selectedCommand(state); if (command.cases.length > 1) { beginFormEdit(); command.cases.splice(Number(button.dataset.index), 1); setDirty(true); renderDetail(); renderCommands(); } }
    else if (action === 'open-preview') await openFullPreview();
    else if (action === 'preview-audio') { try { await playAudioCommand(selectedCommand(state)); } catch (error) { setStatus(error.message, 'error'); } }
    else if (action === 'show-diagnostics') { state.tab = 'diagnostics'; render(); }
  }

  function onInput(event) {
    if (event.target === elements.commandSearch) { state.commandSearch = event.target.value; renderPalette(); return; }
    if (event.target === elements.commandListSearch) { state.commandListSearch = event.target.value; renderCommands(); return; }
    if (event.target === elements.sceneJson) { state.sceneJsonDirty = true; setDirty(true); return; }
    if (event.target === elements.sceneName) {
      const scene = selectedScene(state); if (!scene) return;
      beginFormEdit(); scene.name = String(event.target.value || '').slice(0, 96); setDirty(true); elements.sceneTitle.textContent = scene.name || scene.id; renderScenes(); return;
    }
    if (elements.commandForm.contains(event.target) && event.target.name !== 'type') updateKnownCommand({ rerenderCommands: true, rerenderDetail: false });
  }

  async function onChange(event) {
    if (event.target === elements.sceneId) { renameScene(event.target.value); return; }
    if (event.target === elements.sceneName) { const scene = selectedScene(state); if (!scene) return; beginFormEdit(); scene.name = normalizedSceneName(event.target.value); event.target.value = scene.name || ''; setDirty(true); finishFormEdit(); renderScenes(); return; }
    if (event.target === elements.sceneFullBg) { mutate(() => { selectedScene(state).fullScreenBg = event.target.checked; }); return; }
    if (event.target.matches('[data-action="toggle-command-skip"]')) {
      const command = selectedScene(state)?.commands?.[Number(event.target.dataset.commandIndex)];
      if (!command) return;
      mutate(() => { if (event.target.checked) command.skip = true; else { delete command.skip; delete command.skipped; delete command.debugSkip; } });
      return;
    }
    if (elements.commandForm.contains(event.target)) {
      if (event.target.name === 'type') { await changeCommandType(event.target.value); return; }
      const rerender = ['kind', 'action', 'scope', 'assetId', 'animationAssetId', 'mode', 'textColorEnabled', 'effect'].includes(event.target.name) || Boolean(event.target.dataset.inputButton);
      updateKnownCommand({ rerenderCommands: true, rerenderDetail: rerender });
      return;
    }
    if (elements.systemForm.contains(event.target)) updateSystemFromForm();
  }

  function onDragStart(event) {
    const sceneRow = event.target.closest('[data-scene-row]');
    if (sceneRow) { state.sceneDragId = sceneRow.dataset.sceneRow; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-md-novel-scene', state.sceneDragId); return; }
    const card = event.target.closest('[data-command-index]');
    if (card && elements.commandList.contains(card)) { state.commandDragIndex = Number(card.dataset.commandIndex); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-md-novel-command', String(state.commandDragIndex)); return; }
    const palette = event.target.closest('[data-command-type]');
    if (palette) { state.newCommandDragType = palette.dataset.commandType; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-md-novel-new-command', state.newCommandDragType); }
  }

  function onDragOver(event) {
    const drop = event.target.closest('[data-drop-index]');
    const sceneRow = event.target.closest('[data-scene-row]');
    if (!drop && !sceneRow) return;
    event.preventDefault();
    if (drop) { root.querySelectorAll('.mn-command-dropzone.active').forEach((entry) => entry.classList.remove('active')); drop.classList.add('active'); }
  }

  function onDrop(event) {
    const drop = event.target.closest('[data-drop-index]');
    if (drop) {
      event.preventDefault();
      const index = Number(drop.dataset.dropIndex);
      const newType = event.dataTransfer.getData('application/x-md-novel-new-command') || state.newCommandDragType;
      const commandIndex = event.dataTransfer.getData('application/x-md-novel-command');
      if (newType) addCommand(newType, index);
      else if (commandIndex !== '') moveCommand(Number(commandIndex), index);
    } else {
      const sceneRow = event.target.closest('[data-scene-row]');
      const sceneId = event.dataTransfer.getData('application/x-md-novel-scene') || state.sceneDragId;
      if (sceneRow && sceneId) { event.preventDefault(); const rectangle = sceneRow.getBoundingClientRect(); moveScene(sceneId, sceneRow.dataset.sceneRow, event.clientY > rectangle.top + rectangle.height / 2); }
    }
    root.querySelectorAll('.mn-command-dropzone.active').forEach((entry) => entry.classList.remove('active'));
    state.sceneDragId = ''; state.commandDragIndex = null; state.newCommandDragType = '';
  }

  function startResize(event) {
    const resizer = event.target.closest('[data-resizer]');
    if (!resizer) return;
    const side = resizer.dataset.resizer;
    const startX = event.clientX;
    const start = { ...state.columnLayout };
    resizer.classList.add('dragging');
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === 'left') state.columnLayout.left = clamp(start.left + delta, 240, 520);
      else state.columnLayout.right = clamp(start.right - delta, 320, 720);
      applyWorkspaceLayout();
    };
    const finish = () => { resizer.classList.remove('dragging'); writeStoredJson('columnLayout', state.columnLayout); window.removeEventListener('pointermove', move); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }

  function onKeyDown(event) {
    if (!root.classList.contains('active') || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void saveCurrent(); }
    else if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo(); }
  }

  function onDecisionClick(event) {
    const button = event.target.closest('[data-decision]');
    if (button) finishDecision(button.dataset.decision);
  }

  function onDragEnd() {
    root.querySelectorAll('.mn-command-dropzone.active').forEach((entry) => entry.classList.remove('active'));
  }

  decision.panel.addEventListener('click', onDecisionClick);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('pointerdown', startResize);
  window.addEventListener('keydown', onKeyDown);

  const observer = new MutationObserver(() => {
    const active = root.classList.contains('active');
    if (active && !state.wasActive && !state.loading && !state.dirty) void loadFromDisk();
    state.wasActive = active;
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });

  registerCapability('md-novel-editor', {
    root,
    refresh: reloadWithGuard,
    requestSave: saveCurrent,
    getDirtyState: () => ({ dirty: state.dirty, sceneId: state.selectedSceneId, commandIndex: state.selectedCommandIndex }),
    openScene(sceneId, commandIndex = 0) { selectScene(sceneId); selectCommand(commandIndex); return true; },
  });

  void loadFromDisk();
  return {
    beforeBuild() { return flush('build'); },
    beforeProjectSwitch() { return flush('project switch'); },
    deactivate() {
      observer.disconnect();
      state.previewGeneration += 1;
      state.previewWindow?.close();
      stopAudioPreview();
      try { state.audioContext?.close?.(); } catch (_) {}
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('dragstart', onDragStart);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('drop', onDrop);
      root.removeEventListener('dragend', onDragEnd);
      root.removeEventListener('pointerdown', startResize);
      window.removeEventListener('keydown', onKeyDown);
      decision.panel.removeEventListener('click', onDecisionClick);
      decision.destroy();
      if (style.owned) style.element.remove();
      root.innerHTML = '';
    },
  };
}
