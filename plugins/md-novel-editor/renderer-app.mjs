import { buildShell, diagnosticHtml, escapeHtml, formatJson } from './editor-ui.mjs';
import { clone, commandSummary, effectiveX, simulateScene } from './preview-core.mjs';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function selectedScene(state) {
  return state.sceneDocument?.scenes?.find((scene) => scene.id === state.selectedSceneId) || null;
}

function safeColor(value, fallback = '#ffffff') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function sourceDirectory(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/\/project\.json$/i, '');
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.classList.add('md-novel-editor-page');
  root.innerHTML = buildShell();
  const role = (name) => root.querySelector(`[data-role="${name}"]`);
  const elements = {
    dirty: role('dirty'), status: role('status'), sceneCount: role('scene-count'), sceneList: role('scene-list'),
    commandList: role('command-list'), commandForm: role('command-form'), commandTitle: role('command-title'),
    commandIndex: role('command-index'), commandJson: role('command-json'), systemForm: role('system-form'),
    fontForm: role('font-form'), assetList: role('asset-list'), diagnostics: role('diagnostics'),
    preview: role('preview'), previewLabel: role('preview-label'), previewIndex: role('preview-index'),
  };
  const state = {
    snapshot: null,
    sceneDocument: null,
    targetProfile: null,
    bindings: null,
    pceFont: null,
    selectedSceneId: '',
    selectedCommandIndex: 0,
    tab: 'script',
    dirty: false,
    commandEditorDirty: false,
    history: [],
    future: [],
    loading: false,
    projectDir: '',
    imageCache: new Map(),
    previewGeneration: 0,
    wasActive: root.classList.contains('active'),
  };

  function setStatus(message, tone = '') {
    elements.status.textContent = String(message || '');
    elements.status.dataset.tone = tone;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    elements.dirty.textContent = state.dirty ? '● 未保存' : '';
  }

  function currentDocumentState() {
    return clone({ sceneDocument: state.sceneDocument, targetProfile: state.targetProfile, bindings: state.bindings });
  }

  function restoreDocumentState(value) {
    state.sceneDocument = clone(value.sceneDocument);
    state.targetProfile = clone(value.targetProfile);
    state.bindings = clone(value.bindings);
    if (!selectedScene(state)) state.selectedSceneId = state.sceneDocument?.scenes?.[0]?.id || '';
    const scene = selectedScene(state);
    state.selectedCommandIndex = Math.max(0, Math.min(state.selectedCommandIndex, (scene?.commands?.length || 1) - 1));
    state.commandEditorDirty = false;
  }

  function remember() {
    state.history.push(currentDocumentState());
    if (state.history.length > 50) state.history.shift();
    state.future = [];
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    state.future.push(currentDocumentState());
    restoreDocumentState(previous);
    setDirty(true);
    render();
  }

  function redo() {
    const next = state.future.pop();
    if (!next) return;
    state.history.push(currentDocumentState());
    restoreDocumentState(next);
    setDirty(true);
    render();
  }

  function applyCommandEditor(options = {}) {
    if (!state.commandEditorDirty) return true;
    const scene = selectedScene(state);
    const current = scene?.commands?.[state.selectedCommandIndex];
    if (!current) return true;
    try {
      const value = JSON.parse(elements.commandJson.value);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('command must be a JSON object');
      if (options.remember !== false) remember();
      scene.commands[state.selectedCommandIndex] = value;
      state.commandEditorDirty = false;
      setDirty(true);
      return true;
    } catch (error) {
      setStatus(`Command JSONエラー: ${error.message}`, 'error');
      elements.commandJson.focus();
      return false;
    }
  }

  function renderScenes() {
    const scenes = state.sceneDocument?.scenes || [];
    elements.sceneCount.textContent = `${scenes.length}`;
    elements.sceneList.innerHTML = scenes.map((scene, index) => `<button type="button" data-action="select-scene" data-scene-id="${escapeHtml(scene.id)}" class="${scene.id === state.selectedSceneId ? 'active' : ''}"><strong>${escapeHtml(scene.name || scene.id)}</strong><small>${String(index + 1).padStart(2, '0')} · ${escapeHtml(scene.id)} · ${scene.commands?.length || 0} commands</small></button>`).join('') || '<div class="mn-empty">Sceneがありません。</div>';
  }

  function renderCommands() {
    const scene = selectedScene(state);
    const commands = scene?.commands || [];
    elements.commandList.innerHTML = commands.map((command, index) => `<button type="button" data-action="select-command" data-command-index="${index}" class="${index === state.selectedCommandIndex ? 'active' : ''}"><strong>${String(index).padStart(3, '0')} · ${escapeHtml(command?.type || 'unknown')}</strong><small>${escapeHtml(commandSummary(command))}</small></button>`).join('') || '<div class="mn-empty">Commandがありません。</div>';
    const command = commands[state.selectedCommandIndex] || null;
    elements.commandTitle.textContent = command?.type || 'Command';
    elements.commandIndex.textContent = command ? `${state.selectedCommandIndex + 1} / ${commands.length}` : '';
    elements.commandJson.value = command ? formatJson(command) : '';
    elements.commandJson.disabled = !command;
    elements.commandForm.querySelector('button[type="submit"]').disabled = !command;
    state.commandEditorDirty = false;
  }

  function renderSystem() {
    const settings = state.sceneDocument?.settings || {};
    const profile = state.targetProfile || {};
    elements.systemForm.innerHTML = `
      <fieldset><legend>PCE互換System</legend>
        <label>文字速度 (frames)<select name="messageSpeedFrames">${[0, 10, 20, 30, 40, 50].map((value) => `<option value="${value}" ${number(settings.messageSpeedFrames, 10) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>送りモード<select name="messageAdvanceMode"><option value="button" ${settings.messageAdvanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${settings.messageAdvanceMode === 'auto' ? 'selected' : ''}>auto</option></select></label>
        <label>AUTO待ち (frames)<input name="messageAutoWaitFrames" type="number" min="0" max="255" value="${number(settings.messageAutoWaitFrames, 60)}"></label>
      </fieldset>
      <fieldset><legend>Mega Drive target</legend>
        <label>座標モード<select name="coordinateMode"><option value="pce-legacy-256" ${profile.coordinateMode === 'pce-legacy-256' ? 'selected' : ''}>PCE legacy 256</option><option value="md-h40" ${profile.coordinateMode === 'md-h40' ? 'selected' : ''}>MD H40 native</option></select></label>
        <label>DMA上限 bytes/frame<input name="dmaBytesPerFrame" type="number" min="512" max="16384" step="256" value="${number(profile.runtime?.dmaBytesPerFrame, 6144)}"></label>
        <label>ROM警告 bytes<input name="targetBytes" type="number" value="${number(profile.rom?.targetBytes, 3670016)}"></label>
        <label>ROM hard limit bytes<input name="hardLimitBytes" type="number" value="${number(profile.rom?.hardLimitBytes, 4194304)}"></label>
        <p>PAL0=WINDOW/font/BG_A、PAL1=背景、PAL2/PAL3=立ち絵。CDDA/ADPCM/voiceはJSONに保持したままMD runtimeでは無音NOPです。</p>
      </fieldset>`;
  }

  function renderFont() {
    const font = state.targetProfile?.font || {};
    const source = state.pceFont || {};
    elements.fontForm.innerHTML = `
      <fieldset><legend>MD runtime font</legend>
        <label>Renderer<input name="renderer" value="${escapeHtml(font.renderer || '')}"></label>
        <label>Glyph width<input name="glyphWidth" type="number" min="8" max="16" value="${number(font.glyphWidth, 16)}"></label>
        <label>Glyph height<input name="glyphHeight" type="number" min="8" max="16" value="${number(font.glyphHeight, 16)}"></label>
        <label>Bundled source<input name="source" value="${escapeHtml(font.source || '')}"></label>
        <p>Unicode JSONを正本とし、ビルド時に使用glyphだけをShift-JIS/Misaki atlasから16×16へ展開します。</p>
      </fieldset>
      <fieldset><legend>PCE font provenance (read only)</legend><textarea rows="12" readonly>${escapeHtml(formatJson(source))}</textarea></fieldset>`;
  }

  function renderAssets() {
    const entries = Object.values(state.bindings?.assets || {});
    const variants = Object.values(state.bindings?.audioVariants || {});
    elements.assetList.innerHTML = `<table><thead><tr><th>assetId</th><th>MD type</th><th>palette</th><th>resource</th><th>budget</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${escapeHtml(entry.assetId)}</td><td>${escapeHtml(entry.runtimeType)}</td><td>${escapeHtml(entry.palette || '-')}</td><td>${escapeHtml(entry.sourcePath || '(ignored)')}</td><td>${entry.metadata ? `${entry.metadata.uniqueTiles || 0} tiles / ${entry.metadata.maxNumSprite || 0} pieces` : '-'}</td></tr>`).join('')}${variants.map((entry) => `<tr><td>${escapeHtml(entry.key)}</td><td>${escapeHtml(entry.runtimeType)}</td><td>-</td><td>${escapeHtml(entry.sourcePath)}</td><td>${entry.metadata?.byteLength || 0} bytes</td></tr>`).join('')}</tbody></table>`;
  }

  function renderDiagnostics() {
    elements.diagnostics.innerHTML = diagnosticHtml(state.snapshot?.diagnostics || []);
  }

  async function getProjectDir() {
    if (state.projectDir) return state.projectDir;
    const project = await api.electronAPI.getCurrentProject?.();
    state.projectDir = String(project?.projectDir || project?.dir || project?.currentProjectDir || '').replace(/\\/g, '/');
    return state.projectDir;
  }

  async function loadAssetImage(assetId) {
    const binding = state.bindings?.assets?.[assetId];
    if (!binding?.sourcePath) return null;
    const key = binding.sourcePath.replace(/\\/g, '/');
    const cached = state.imageCache.get(key);
    if (cached?.image) return cached.image;
    if (cached?.promise) return cached.promise;
    const record = { image: null, promise: null, error: '' };
    record.promise = (async () => {
      const projectDir = await getProjectDir();
      const result = await api.electronAPI.readFileAsDataUrl(`${projectDir}/res/${key}`);
      if (!result?.ok || !result.dataUrl) throw new Error(result?.error || `Cannot read ${key}`);
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

  function cachedAsset(assetId) {
    const key = state.bindings?.assets?.[assetId]?.sourcePath?.replace(/\\/g, '/');
    return key ? state.imageCache.get(key)?.image || null : null;
  }

  function drawPreviewNow(scene, simulated) {
    const context = elements.preview.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#000';
    context.fillRect(0, 0, 320, 224);
    const coordinateMode = state.targetProfile?.coordinateMode || 'pce-legacy-256';
    if (simulated.background) {
      const image = cachedAsset(simulated.background.assetId);
      if (image) context.drawImage(image, effectiveX('background', simulated.background.x, coordinateMode), coordinateMode === 'pce-legacy-256' ? number(simulated.background.y) * 8 : number(simulated.background.y));
    }
    simulated.sprites.forEach((sprite) => {
      if (!sprite) return;
      const image = cachedAsset(sprite.assetId);
      if (!image) return;
      const meta = state.bindings?.assets?.[sprite.assetId]?.metadata || {};
      const width = number(meta.frameWidth, image.naturalWidth);
      const height = number(meta.frameHeight, image.naturalHeight);
      const x = effectiveX('sprite', sprite.x, coordinateMode);
      const y = number(sprite.y);
      context.save();
      context.translate(x + (sprite.flipX ? width : 0), y + (sprite.flipY ? height : 0));
      context.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
      context.drawImage(image, 0, 0, width, height, 0, 0, width, height);
      context.restore();
    });
    context.font = '16px monospace';
    context.textBaseline = 'top';
    simulated.spriteTexts.forEach((entry) => {
      if (!entry) return;
      context.fillStyle = safeColor(entry.color);
      const lines = String(entry.text || '').split('\n');
      lines.forEach((line, row) => context.fillText(line.slice(0, 32), effectiveX('spritetext', entry.x, coordinateMode), number(entry.y) + row * 16));
    });
    if (simulated.message || simulated.choice) {
      context.fillStyle = '#080c12';
      context.fillRect(0, 128, 320, 96);
      context.strokeStyle = '#8ca0ba';
      context.strokeRect(.5, 128.5, 319, 95);
      context.fillStyle = safeColor(simulated.message?.textColor);
      context.font = '14px sans-serif';
      if (simulated.message) {
        context.fillText(String(simulated.message.speaker || ''), 8, 144);
        simulated.message.pages[0].forEach((line, row) => context.fillText(line, 8, 164 + row * 16));
      } else {
        (simulated.choice.choices || []).slice(0, 4).forEach((choice, row) => context.fillText(`${row === number(simulated.choice.defaultIndex) ? '▶' : ' '} ${Array.from(String(choice.label || '')).slice(0, 17).join('')}`, 8, 148 + row * 18));
      }
    }
    elements.previewLabel.textContent = `${scene?.id || ''} · ${state.selectedCommandIndex}`;
  }

  async function refreshPreview() {
    const scene = selectedScene(state);
    if (!scene) return;
    const simulated = simulateScene(scene, state.selectedCommandIndex, { columns: 19, rows: 4 });
    drawPreviewNow(scene, simulated);
    const ids = new Set([simulated.background?.assetId, ...simulated.sprites.map((entry) => entry?.assetId)].filter(Boolean));
    const generation = ++state.previewGeneration;
    await Promise.all([...ids].map(loadAssetImage));
    if (generation === state.previewGeneration) drawPreviewNow(scene, simulated);
  }

  function render() {
    root.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.tab));
    root.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.dataset.section === state.tab));
    renderScenes();
    renderCommands();
    renderSystem();
    renderFont();
    renderAssets();
    renderDiagnostics();
    const scene = selectedScene(state);
    elements.previewIndex.max = String(Math.max(0, (scene?.commands?.length || 1) - 1));
    elements.previewIndex.value = String(state.selectedCommandIndex);
    root.querySelector('[data-action="undo"]').disabled = !state.history.length;
    root.querySelector('[data-action="redo"]').disabled = !state.future.length;
    void refreshPreview();
  }

  function adoptSnapshot(result) {
    state.snapshot = result;
    state.sceneDocument = clone(result.sceneDocument);
    state.targetProfile = clone(result.targetProfile);
    state.bindings = clone(result.bindings);
    state.pceFont = clone(result.pceFont);
    state.selectedSceneId = selectedScene(state)?.id || state.sceneDocument?.scenes?.[0]?.id || '';
    state.selectedCommandIndex = 0;
    state.history = [];
    state.future = [];
    state.commandEditorDirty = false;
    state.imageCache.clear();
    setDirty(false);
  }

  async function reload() {
    if (state.loading) return false;
    if (state.dirty && !(await saveCurrent())) return false;
    state.loading = true;
    setStatus('Novelデータを読込中…');
    try {
      state.projectDir = '';
      const result = await api.plugins.invokeHook(plugin.id, 'loadMdNovelProject', {});
      if (!result?.sceneDocument) throw new Error(result?.error || 'Novel projectを読込めません');
      adoptSnapshot(result);
      render();
      setStatus(result.ok ? '読込完了' : `読込完了: ${result.diagnostics?.filter((entry) => entry.severity === 'error').length || 0} error`, result.ok ? 'ok' : 'error');
      return result.ok;
    } catch (error) {
      setStatus(error.message, 'error');
      logger.error(error.message);
      return false;
    } finally {
      state.loading = false;
    }
  }

  async function saveCurrent() {
    if (!state.snapshot) return false;
    if (!applyCommandEditor()) return false;
    if (!state.dirty) return true;
    setStatus('保存中…');
    try {
      const result = await api.plugins.invokeHook(plugin.id, 'saveMdNovelProject', {
        sceneDocument: state.sceneDocument,
        targetProfile: state.targetProfile,
        bindings: state.bindings,
        baseRevisions: state.snapshot.revisions,
      });
      if (!result?.sceneDocument) throw new Error(result?.error || '保存に失敗しました');
      const sceneId = state.selectedSceneId;
      const commandIndex = state.selectedCommandIndex;
      adoptSnapshot(result);
      state.selectedSceneId = sceneId;
      state.selectedCommandIndex = commandIndex;
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
    if (!/[/\\]project\.json$/i.test(picked.sourcePath)) { setStatus('PCEプロジェクトのproject.jsonを選択してください', 'error'); return; }
    setStatus('PCEノベルをMD向けに変換中…');
    try {
      const result = await api.plugins.invokeHook(plugin.id, 'importPceNovelProject', {
        sourceProjectDir: sourceDirectory(picked.sourcePath),
      });
      if (!result?.sceneDocument) throw new Error(result?.error || 'PCE importに失敗しました');
      adoptSnapshot(result);
      render();
      setStatus(`取込完了: visual ${result.importReport?.visualAssets || 0}, PSG ${result.importReport?.audioVariants || 0}`, 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function validate() {
    if (state.dirty && !(await saveCurrent())) return;
    const result = await api.plugins.invokeHook(plugin.id, 'validateMdNovelProject', {});
    if (!result?.sceneDocument) { setStatus(result?.error || '検証に失敗しました', 'error'); return; }
    adoptSnapshot(result);
    state.tab = 'diagnostics';
    render();
    setStatus(result.ok ? '検証成功' : '検証エラーがあります', result.ok ? 'ok' : 'error');
  }

  function selectScene(id) {
    if (!applyCommandEditor()) return;
    state.selectedSceneId = id;
    state.selectedCommandIndex = 0;
    render();
  }

  function selectCommand(index) {
    if (!applyCommandEditor()) return;
    state.selectedCommandIndex = Math.max(0, Math.min(number(index), (selectedScene(state)?.commands?.length || 1) - 1));
    renderCommands();
    elements.previewIndex.value = String(state.selectedCommandIndex);
    void refreshPreview();
  }

  function addCommand() {
    if (!applyCommandEditor()) return;
    const scene = selectedScene(state);
    if (!scene) return;
    remember();
    const index = Math.min(scene.commands.length, state.selectedCommandIndex + 1);
    scene.commands.splice(index, 0, { type: 'comment', text: '' });
    state.selectedCommandIndex = index;
    setDirty(true);
    render();
  }

  function deleteCommand() {
    if (!applyCommandEditor()) return;
    const scene = selectedScene(state);
    if (!scene?.commands?.length) return;
    remember();
    scene.commands.splice(state.selectedCommandIndex, 1);
    state.selectedCommandIndex = Math.max(0, Math.min(state.selectedCommandIndex, scene.commands.length - 1));
    setDirty(true);
    render();
  }

  function moveCommand(delta) {
    if (!applyCommandEditor()) return;
    const scene = selectedScene(state);
    const next = state.selectedCommandIndex + delta;
    if (!scene || next < 0 || next >= scene.commands.length) return;
    remember();
    [scene.commands[state.selectedCommandIndex], scene.commands[next]] = [scene.commands[next], scene.commands[state.selectedCommandIndex]];
    state.selectedCommandIndex = next;
    setDirty(true);
    render();
  }

  function updateSystem() {
    remember();
    const data = new FormData(elements.systemForm);
    state.sceneDocument.settings = {
      ...(state.sceneDocument.settings || {}),
      messageSpeedFrames: number(data.get('messageSpeedFrames'), 10),
      messageAdvanceMode: String(data.get('messageAdvanceMode') || 'button'),
      messageAutoWaitFrames: number(data.get('messageAutoWaitFrames'), 60),
    };
    state.targetProfile.coordinateMode = String(data.get('coordinateMode') || 'pce-legacy-256');
    state.targetProfile.runtime = { ...(state.targetProfile.runtime || {}), dmaBytesPerFrame: number(data.get('dmaBytesPerFrame'), 6144) };
    state.targetProfile.rom = { ...(state.targetProfile.rom || {}), targetBytes: number(data.get('targetBytes'), 3670016), hardLimitBytes: number(data.get('hardLimitBytes'), 4194304) };
    setDirty(true);
    renderSystem();
    void refreshPreview();
  }

  function updateFont() {
    remember();
    const data = new FormData(elements.fontForm);
    state.targetProfile.font = {
      ...(state.targetProfile.font || {}),
      renderer: String(data.get('renderer') || ''),
      glyphWidth: number(data.get('glyphWidth'), 16),
      glyphHeight: number(data.get('glyphHeight'), 16),
      source: String(data.get('source') || ''),
    };
    setDirty(true);
    renderFont();
  }

  async function flush(reason) {
    const ok = await saveCurrent();
    return ok ? { ok: true } : { ok: false, error: `MD Novel editor could not save before ${reason}.` };
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.tab) { if (!applyCommandEditor()) return; state.tab = button.dataset.tab; render(); return; }
    const action = button.dataset.action;
    if (action === 'reload') void reload();
    else if (action === 'save') void saveCurrent();
    else if (action === 'import') void importProject();
    else if (action === 'validate') void validate();
    else if (action === 'select-scene') selectScene(button.dataset.sceneId);
    else if (action === 'select-command') selectCommand(button.dataset.commandIndex);
    else if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'add-command') addCommand();
    else if (action === 'delete-command') deleteCommand();
    else if (action === 'move-up') moveCommand(-1);
    else if (action === 'move-down') moveCommand(1);
    else if (action === 'preview-prev') selectCommand(state.selectedCommandIndex - 1);
    else if (action === 'preview-next') selectCommand(state.selectedCommandIndex + 1);
  }

  function onCommandInput() {
    state.commandEditorDirty = true;
    setDirty(true);
  }

  function onCommandSubmit(event) {
    event.preventDefault();
    if (applyCommandEditor()) render();
  }

  root.addEventListener('click', onClick);
  elements.commandJson.addEventListener('input', onCommandInput);
  elements.commandForm.addEventListener('submit', onCommandSubmit);
  elements.systemForm.addEventListener('change', updateSystem);
  elements.fontForm.addEventListener('change', updateFont);
  elements.previewIndex.addEventListener('input', () => selectCommand(elements.previewIndex.value));

  const observer = new MutationObserver(() => {
    const active = root.classList.contains('active');
    if (active && !state.wasActive && !state.loading && !state.dirty) void reload();
    state.wasActive = active;
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });

  registerCapability('md-novel-editor', {
    root,
    refresh: reload,
    requestSave: saveCurrent,
    getDirtyState: () => ({ dirty: state.dirty, sceneId: state.selectedSceneId, commandIndex: state.selectedCommandIndex }),
    openScene(sceneId, commandIndex = 0) { selectScene(sceneId); selectCommand(commandIndex); return true; },
  });

  void reload();
  return {
    beforeBuild() { return flush('build'); },
    beforeProjectSwitch() { return flush('project switch'); },
    deactivate() {
      observer.disconnect();
      root.removeEventListener('click', onClick);
      elements.commandJson.removeEventListener('input', onCommandInput);
      elements.commandForm.removeEventListener('submit', onCommandSubmit);
      elements.systemForm.removeEventListener('change', updateSystem);
      elements.fontForm.removeEventListener('change', updateFont);
      state.previewGeneration += 1;
      state.imageCache.clear();
      root.innerHTML = '';
    },
  };
}
