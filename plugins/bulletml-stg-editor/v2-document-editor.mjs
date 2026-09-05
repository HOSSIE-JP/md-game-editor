import { escapeHtml, formatJson } from './editor-ui.mjs';
import {
  applyStructuredArrayAction, applyStructuredField, renderStructuredForm,
} from '../shared/structured-form.mjs';
import { kindMeta, stgArrayTemplate, stgFieldMeta } from './ui-localization.mjs';

const COLLECTION_KINDS = new Set(['weapons', 'items', 'effects', 'explosions', 'movements', 'enemies', 'bosses', 'backgrounds', 'collision-materials']);
const SNAPSHOT_KEYS = Object.freeze({ 'game-flow': 'gameFlow', 'demo-bindings': 'demoBindings', 'runtime-ids': 'runtimeIds' });

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function snapshotValue(snapshot, kind) {
  if (COLLECTION_KINDS.has(kind)) return snapshot?.collections?.[kind] || snapshot?.[kind] || { schemaVersion: 2, entries: [] };
  return snapshot?.[SNAPSHOT_KEYS[kind] || kind] || { schemaVersion: 2 };
}
function revision(snapshot, kind) { return snapshot?.revisions?.[SNAPSHOT_KEYS[kind] || kind] || ''; }
function safeId(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
function labelFor(entry) { return entry?.name || entry?.id || '名前なし'; }
function pathToken(path) { return encodeURIComponent(JSON.stringify(path)); }
function decodePath(value) { try { return JSON.parse(decodeURIComponent(value)); } catch (_) { return []; } }
function getAtPath(value, path) { return path.reduce((current, key) => current?.[key], value); }
function setAtPath(value, path, next) {
  if (!path.length) return next;
  let current = value;
  path.slice(0, -1).forEach((key) => { current = current[key]; });
  current[path.at(-1)] = next;
  return value;
}
function collectAssets(value, path = [], result = []) {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'symbol') && Object.prototype.hasOwnProperty.call(value, 'type')) {
    result.push({ path, reference: value });
    return result;
  }
  if (Array.isArray(value)) value.forEach((item, index) => collectAssets(item, [...path, index], result));
  else Object.entries(value).forEach(([key, item]) => collectAssets(item, [...path, key], result));
  return result;
}
export function createV2DocumentEditor({ root, api, pluginId, snapshot, validation = null, onSnapshot = () => {}, onDirty = () => {}, onStatus = () => {} } = {}) {
  const pageRoots = [...root.querySelectorAll('[data-v2-page]')];
  const state = {
    snapshot,
    validation,
    drafts: new Map(),
    dirtyKinds: new Set(),
    invalidKinds: new Map(),
    selectedKinds: new Map(),
    selectedIds: new Map(),
    previewPaths: new Map(),
    previewKeys: new Map(),
    destroyed: false,
  };

  function kindsFor(pageRoot) { return String(pageRoot.dataset.v2Kinds || '').split(',').filter(Boolean); }
  function kindFor(pageRoot) { return state.selectedKinds.get(pageRoot.dataset.v2Page) || kindsFor(pageRoot)[0]; }
  function documentFor(kind) {
    if (!state.drafts.has(kind)) state.drafts.set(kind, clone(snapshotValue(state.snapshot, kind)));
    return state.drafts.get(kind);
  }
  function entryFor(pageRoot) {
    const kind = kindFor(pageRoot);
    if (!COLLECTION_KINDS.has(kind)) return documentFor(kind);
    const entries = documentFor(kind).entries || [];
    const selected = state.selectedIds.get(kind);
    const entry = entries.find((item) => item.id === selected) || entries[0] || null;
    if (entry) state.selectedIds.set(kind, entry.id);
    return entry;
  }
  function markDirty(kind) {
    state.dirtyKinds.add(kind);
    onDirty(true);
  }
  function updateParentDirty() { onDirty(state.dirtyKinds.size > 0 || state.invalidKinds.size > 0); }

  function assetHtml(asset, selectedPath) {
    const reference = asset.reference || {};
    const token = pathToken(asset.path);
    const type = String(reference.type || '').toUpperCase();
    const direct = type === 'SPRITE' ? 'sprite' : ['MAP', 'TILEMAP'].includes(type) ? 'map' : '';
    const meta = stgFieldMeta(asset.path, reference, asset.path.at(-1), { snapshot: state.snapshot });
    const options = type === 'SPRITE'
      ? `<label title="スプライトエディターで登録したアニメーション行番号">アニメーション行 <input type="number" min="0" step="1" data-v2-asset-option="animationRow" data-v2-asset-path="${token}" value="${escapeHtml(reference.animationRow ?? 0)}"></label>`
      : ['MAP', 'TILEMAP'].includes(type)
        ? `<label title="当たり判定に使うTMXレイヤー名。衝突を使わない場合は空欄">衝突レイヤー <input type="text" data-v2-asset-option="collisionLayer" data-v2-asset-path="${token}" value="${escapeHtml(reference.collisionLayer || '')}" placeholder="Collision:near"></label>`
        : '';
    return `<article class="bml-v2-asset ${token === selectedPath ? 'active' : ''}" data-v2-asset-card="${token}" title="このカードを選ぶと自動的にプレビューします"><header><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(type || '?')}</span></header><code>${escapeHtml(reference.symbol || '未選択')}</code><div><button data-v2-asset-action="pick" data-v2-asset-path="${token}" title="ResComp登録済みアセットから選択">アセットを選択</button>${direct ? `<button data-v2-asset-action="open-${direct}" data-v2-asset-path="${token}" ${reference.symbol ? '' : 'disabled'} title="選択済みアセットを${direct === 'sprite' ? 'スプライト' : 'マップ'}エディターで開く">${direct === 'sprite' ? 'スプライト' : 'マップ'}エディターで開く</button>` : ''}</div>${options}</article>`;
  }

  async function mountAutomaticPreview(pageRoot, assets, preferredPath = '') {
    const page = pageRoot.dataset.v2Page;
    const selected = assets.find((asset) => pathToken(asset.path) === preferredPath) || assets.find((asset) => asset.reference?.symbol);
    const preview = pageRoot.querySelector('[data-v2-preview]');
    if (!selected?.reference?.symbol) {
      state.previewKeys.delete(page);
      preview.innerHTML = '<p class="bml-empty">アセットを選択すると、ここへ自動的にプレビューします。</p>';
      return;
    }
    const token = pathToken(selected.path);
    state.previewPaths.set(page, token);
    const key = `${token}:${selected.reference.symbol}:${selected.reference.animationRow ?? ''}:${selected.reference.collisionLayer ?? ''}`;
    if (state.previewKeys.get(page) === key) return;
    state.previewKeys.set(page, key);
    const picker = api.capabilities.get('rescomp-asset-picker') || await api.capabilities.require?.('rescomp-asset-picker', 1500);
    if (picker) await picker.mountPreview(preview, selected.reference);
  }

  function renderPage(pageRoot) {
    if (state.destroyed) return;
    const page = pageRoot.dataset.v2Page;
    const kinds = kindsFor(pageRoot);
    const kind = kindFor(pageRoot);
    const collection = COLLECTION_KINDS.has(kind);
    const document = documentFor(kind);
    const entry = entryFor(pageRoot);
    const kindSelect = pageRoot.querySelector('[data-v2-kind]');
    kindSelect.innerHTML = kinds.map((item) => `<option value="${escapeHtml(item)}" ${item === kind ? 'selected' : ''}>${escapeHtml(kindMeta(item)[0])}</option>`).join('');
    kindSelect.closest('label').hidden = kinds.length < 2;
    pageRoot.querySelectorAll('[data-v2-action="add"], [data-v2-action="delete"]').forEach((button) => { button.hidden = !collection; });
    const entries = collection ? document.entries || [] : kinds;
    const list = pageRoot.querySelector('[data-v2-list]');
    if (collection) {
      list.innerHTML = entries.map((item) => `<button data-v2-select-id="${escapeHtml(item.id)}" class="${item.id === entry?.id ? 'active' : ''}" title="${escapeHtml(labelFor(item))}を編集"><strong>${escapeHtml(labelFor(item))}</strong><small>安定ID: ${escapeHtml(item.id)}</small></button>`).join('') || '<p class="bml-empty">登録項目がありません。「追加」から作成してください。</p>';
    } else {
      list.innerHTML = kinds.map((item) => `<button data-v2-select-kind="${escapeHtml(item)}" class="${item === kind ? 'active' : ''}" title="${escapeHtml(kindMeta(item)[1])}"><strong>${escapeHtml(kindMeta(item)[0])}</strong><small>改訂: ${escapeHtml(revision(state.snapshot, item).slice(0, 10) || '新規')}</small></button>`).join('');
    }
    pageRoot.querySelector('[data-v2-count]').textContent = collection ? `${entries.length}/255件` : `${kinds.length}分類`;
    const runtimeId = collection && entry ? state.snapshot?.runtimeIds?.catalogs?.[kind]?.[entry.id] : null;
    pageRoot.querySelector('[data-v2-summary]').innerHTML = `<strong>${escapeHtml(collection ? labelFor(entry) : kindMeta(kind)[0])}</strong><span>データ形式 v${escapeHtml(document.schemaVersion || 2)}</span>${runtimeId ? `<span>実行時ID ${runtimeId}</span>` : ''}<span>改訂 ${escapeHtml(revision(state.snapshot, kind).slice(0, 12) || '新規')}</span>${state.dirtyKinds.has(kind) ? '<em>編集中</em>' : ''}`;
    pageRoot.querySelector('[data-v2-fields]').innerHTML = entry
      ? renderStructuredForm(entry, { scope: `v2:${page}`, resolveMeta: (path, value, key) => stgFieldMeta([kind, ...path], value, key, { snapshot: state.snapshot }) })
      : '<p class="bml-empty">編集対象がありません。</p>';
    const textarea = pageRoot.querySelector('[data-v2-json]');
    textarea.value = entry ? formatJson(entry) : '';
    textarea.disabled = !entry;
    const assets = entry ? collectAssets(entry) : [];
    const selectedAssetPath = state.previewPaths.get(page) || pathToken(assets[0]?.path || []);
    pageRoot.querySelector('[data-v2-assets]').innerHTML = assets.map((asset) => assetHtml(asset, selectedAssetPath)).join('') || '<p class="bml-empty">この設定ではアセットを使用しません。</p>';
    void mountAutomaticPreview(pageRoot, assets, selectedAssetPath);
    const deleted = state.snapshot?.deletedDocuments?.[kind] || [];
    pageRoot.querySelector('[data-v2-deleted]').innerHTML = collection ? deleted.map((item) => `<button data-v2-restore="${escapeHtml(item.fileName)}" title="削除済み項目を元へ戻す"><strong>${escapeHtml(labelFor(item.entry))}</strong><small>${escapeHtml(item.fileName)}</small></button>`).join('') || '<small>削除済み項目はありません</small>' : '<small>単一設定は削除できません</small>';
    pageRoot.querySelector('[data-v2-error]').textContent = state.invalidKinds.get(kind) || '';
  }

  function renderAll() { pageRoots.forEach(renderPage); }

  function replaceCurrent(pageRoot, value) {
    const kind = kindFor(pageRoot);
    if (COLLECTION_KINDS.has(kind)) {
      const document = documentFor(kind);
      const selectedId = state.selectedIds.get(kind);
      const index = (document.entries || []).findIndex((item) => item.id === selectedId);
      if (index < 0) throw new Error('登録項目を選択してください');
      document.entries[index] = value;
      state.selectedIds.set(kind, value.id || selectedId);
    } else state.drafts.set(kind, value);
    state.invalidKinds.delete(kind);
    markDirty(kind);
  }

  function applyJson(pageRoot, { render = true } = {}) {
    const kind = kindFor(pageRoot);
    const textarea = pageRoot.querySelector('[data-v2-json]');
    if (textarea.disabled) return true;
    try {
      const value = JSON.parse(textarea.value || '{}');
      replaceCurrent(pageRoot, value);
      if (render) renderPage(pageRoot);
      return true;
    } catch (error) {
      state.invalidKinds.set(kind, `JSON: ${error.message}`);
      pageRoot.querySelector('[data-v2-error]').textContent = state.invalidKinds.get(kind);
      updateParentDirty();
      return false;
    }
  }

  async function saveKind(kind) {
    if (!state.dirtyKinds.has(kind)) return true;
    const document = documentFor(kind);
    const payload = kind === 'project'
      ? { project: document, baseRevisions: { project: revision(state.snapshot, kind) } }
      : { kind, document, baseRevision: revision(state.snapshot, kind) };
    const hook = kind === 'project' ? 'saveBulletmlProject' : 'saveBulletmlDocument';
    const result = await api.plugins.invokeHook(pluginId, hook, payload);
    if (!result?.ok) throw new Error(result?.error || `${kind}を保存できません`);
    state.snapshot = result.snapshot;
    state.validation = result.validation || state.validation;
    state.drafts.set(kind, clone(snapshotValue(state.snapshot, kind)));
    state.dirtyKinds.delete(kind);
    state.invalidKinds.delete(kind);
    onSnapshot(result);
    renderAll();
    updateParentDirty();
    return true;
  }

  async function saveAll() {
    try {
      if (state.invalidKinds.size) throw new Error([...state.invalidKinds.values()][0]);
      for (const kind of [...state.dirtyKinds]) await saveKind(kind);
      onStatus('設定を保存しました', 'ok');
      return true;
    } catch (error) {
      onStatus(error.message, 'error');
      return false;
    }
  }

  function addEntry(pageRoot) {
    const kind = kindFor(pageRoot);
    if (!COLLECTION_KINDS.has(kind)) return;
    const document = documentFor(kind);
    let index = (document.entries || []).length + 1;
    let id = safeId(`${kind.replace(/s$/, '')}-${index}`);
    while (document.entries.some((entry) => entry.id === id)) id = safeId(`${kind.replace(/s$/, '')}-${++index}`);
    const entry = clone(document.entries?.[0] || { id, name: '' });
    entry.id = id;
    entry.name = `新規${kindMeta(kind)[0]} ${index}`;
    document.entries.push(entry);
    state.selectedIds.set(kind, id);
    markDirty(kind);
    renderPage(pageRoot);
  }

  async function deleteEntry(pageRoot) {
    const kind = kindFor(pageRoot);
    const entry = entryFor(pageRoot);
    if (!entry || !COLLECTION_KINDS.has(kind)) return;
    if (state.dirtyKinds.has(kind) && !(await saveKind(kind))) return;
    const result = await api.plugins.invokeHook(pluginId, 'deleteBulletmlDocumentEntry', { kind, id: entry.id, baseRevision: revision(state.snapshot, kind) });
    if (!result?.ok) { onStatus(result?.error || '登録項目を削除できません', 'error'); return; }
    state.snapshot = result.snapshot;
    state.drafts.set(kind, clone(snapshotValue(state.snapshot, kind)));
    state.selectedIds.delete(kind);
    onSnapshot(result); renderAll(); updateParentDirty(); onStatus(`${entry.id}を.deletedへ退避しました`, 'ok');
  }

  async function restoreEntry(pageRoot, fileName) {
    const kind = kindFor(pageRoot);
    const result = await api.plugins.invokeHook(pluginId, 'restoreBulletmlDocumentEntry', { kind, fileName, baseRevision: revision(state.snapshot, kind) });
    if (!result?.ok) { onStatus(result?.error || '登録項目を復元できません', 'error'); return; }
    state.snapshot = result.snapshot;
    state.drafts.set(kind, clone(snapshotValue(state.snapshot, kind)));
    state.selectedIds.set(kind, result.entry?.id || '');
    onSnapshot(result); renderAll(); onStatus(`${result.entry?.id || fileName}を復元しました`, 'ok');
  }

  async function assetAction(pageRoot, button) {
    const kind = kindFor(pageRoot);
    const target = entryFor(pageRoot);
    const path = decodePath(button.dataset.v2AssetPath);
    const reference = getAtPath(target, path);
    if (!reference) return;
    const action = button.dataset.v2AssetAction;
    if (action === 'pick') {
      const picker = api.capabilities.get('rescomp-asset-picker') || await api.capabilities.require?.('rescomp-asset-picker', 1500);
      if (!picker) { onStatus('アセット管理の選択機能が無効です', 'error'); return; }
      const field = stgFieldMeta([kind, ...path], reference, path.at(-1), { snapshot: state.snapshot });
      const picked = await picker.openPicker({ types: [reference.type], selectedSymbol: reference.symbol, allowNone: false, title: `${field.label}を選択` });
      if (!picked?.ok || !picked.selection) return;
      const nextReference = { ...reference, ...picked.selection };
      setAtPath(target, path, nextReference);
      state.previewPaths.set(pageRoot.dataset.v2Page, pathToken(path));
      markDirty(kind); renderPage(pageRoot);
      return;
    }
    if (action === 'open-sprite') {
      const editor = api.capabilities.get('sprite-editor') || await api.capabilities.require?.('sprite-editor', 1500);
      await editor?.openSprite?.({ symbol: reference.symbol });
    } else if (action === 'open-map') {
      const editor = api.capabilities.get('tilemap-editor') || await api.capabilities.require?.('tilemap-editor', 1500);
      await editor?.openMap?.({ symbol: reference.symbol, collisionLayer: reference.collisionLayer || '' });
    }
  }

  function onClick(event) {
    const pageRoot = event.target.closest('[data-v2-page]');
    if (!pageRoot) return;
    const selectId = event.target.closest('[data-v2-select-id]');
    if (selectId) { state.selectedIds.set(kindFor(pageRoot), selectId.dataset.v2SelectId); renderPage(pageRoot); return; }
    const selectKind = event.target.closest('[data-v2-select-kind]');
    if (selectKind) { state.selectedKinds.set(pageRoot.dataset.v2Page, selectKind.dataset.v2SelectKind); renderPage(pageRoot); return; }
    const restore = event.target.closest('[data-v2-restore]');
    if (restore) { void restoreEntry(pageRoot, restore.dataset.v2Restore); return; }
    const assetButton = event.target.closest('[data-v2-asset-action]');
    if (assetButton) { void assetAction(pageRoot, assetButton); return; }
    if (event.target.matches('[data-v2-asset-option]')) return;
    const assetCard = event.target.closest('[data-v2-asset-card]');
    if (assetCard) {
      state.previewPaths.set(pageRoot.dataset.v2Page, assetCard.dataset.v2AssetCard);
      renderPage(pageRoot);
      return;
    }
    const structuredButton = event.target.closest('[data-structured-action][data-structured-scope^="v2:"]');
    if (structuredButton) {
      const target = entryFor(pageRoot);
      if (target && applyStructuredArrayAction(target, structuredButton, stgArrayTemplate)) {
        markDirty(kindFor(pageRoot));
        renderPage(pageRoot);
      }
      return;
    }
    const action = event.target.closest('[data-v2-action]')?.dataset.v2Action;
    if (action === 'add') addEntry(pageRoot);
    else if (action === 'delete') void deleteEntry(pageRoot);
    else if (action === 'apply') applyJson(pageRoot);
    else if (action === 'save') void saveKind(kindFor(pageRoot)).catch((error) => onStatus(error.message, 'error'));
  }

  function onChange(event) {
    const pageRoot = event.target.closest('[data-v2-page]');
    if (!pageRoot) return;
    if (event.target.matches('[data-v2-kind]')) { state.selectedKinds.set(pageRoot.dataset.v2Page, event.target.value); renderPage(pageRoot); return; }
    if (event.target.matches('[data-v2-asset-option]')) {
      const target = entryFor(pageRoot);
      const path = decodePath(event.target.dataset.v2AssetPath);
      const reference = getAtPath(target, path);
      if (!reference) return;
      const option = event.target.dataset.v2AssetOption;
      reference[option] = option === 'animationRow' ? Math.max(0, Math.trunc(Number(event.target.value) || 0)) : event.target.value.trim();
      state.previewPaths.set(pageRoot.dataset.v2Page, event.target.dataset.v2AssetPath);
      markDirty(kindFor(pageRoot));
      renderPage(pageRoot);
      return;
    }
    if (event.target.matches('[data-structured-field][data-structured-scope^="v2:"]')) {
      const target = entryFor(pageRoot);
      applyStructuredField(target, event.target);
      markDirty(kindFor(pageRoot));
      pageRoot.querySelector('[data-v2-json]').value = formatJson(target);
    }
  }

  function onInput(event) {
    const pageRoot = event.target.closest('[data-v2-page]');
    if (!pageRoot || !event.target.matches('[data-v2-json]')) return;
    const kind = kindFor(pageRoot);
    try {
      JSON.parse(event.target.value || '{}');
      state.invalidKinds.delete(kind);
      pageRoot.querySelector('[data-v2-error]').textContent = '';
    } catch (error) {
      state.invalidKinds.set(kind, `JSON: ${error.message}`);
      pageRoot.querySelector('[data-v2-error]').textContent = state.invalidKinds.get(kind);
      updateParentDirty();
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  renderAll();

  return {
    get dirty() { return state.dirtyKinds.size > 0 || state.invalidKinds.size > 0; },
    saveAll,
    setSnapshot(nextSnapshot, nextValidation = null) {
      state.snapshot = nextSnapshot;
      state.validation = nextValidation || state.validation;
      for (const kind of [...state.drafts.keys()]) if (!state.dirtyKinds.has(kind)) state.drafts.set(kind, clone(snapshotValue(nextSnapshot, kind)));
      renderAll();
    },
    discard() { state.drafts.clear(); state.dirtyKinds.clear(); state.invalidKinds.clear(); renderAll(); updateParentDirty(); },
    renderPage(page) { const pageRoot = pageRoots.find((item) => item.dataset.v2Page === page); if (pageRoot) renderPage(pageRoot); },
    destroy() { state.destroyed = true; root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); api.capabilities?.get?.('rescomp-asset-picker')?.stopPreview?.(); },
  };
}
