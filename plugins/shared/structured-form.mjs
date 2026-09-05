function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function encodeStructuredPath(path) {
  return encodeURIComponent(JSON.stringify(path || []));
}

export function decodeStructuredPath(value) {
  try {
    const path = JSON.parse(decodeURIComponent(String(value || '')));
    return Array.isArray(path) ? path : [];
  } catch (_error) {
    return [];
  }
}

export function getStructuredValue(root, path) {
  return (path || []).reduce((value, key) => value?.[key], root);
}

export function setStructuredValue(root, path, value) {
  if (!path?.length) return value;
  const parent = getStructuredValue(root, path.slice(0, -1));
  if (parent && typeof parent === 'object') parent[path.at(-1)] = value;
  return root;
}

export function cloneStructuredValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function defaultArrayItem(array = []) {
  if (array.length) {
    const item = cloneStructuredValue(array.at(-1));
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (typeof item.id === 'string') item.id = `${item.id || 'item'}-copy`;
      if (typeof item.name === 'string') item.name = `${item.name || '項目'} コピー`;
    }
    return item;
  }
  return {};
}

function helpMarkup(meta) {
  if (!meta?.help) return '';
  const text = escapeHtml(meta.help);
  return `<span class="structured-help" title="${text}" aria-label="${text}" tabindex="0">?</span>`;
}

function normalizedOptions(options, current) {
  const list = (options || []).map((option) => typeof option === 'object'
    ? { value: String(option.value ?? ''), label: String(option.label ?? option.value ?? '') }
    : { value: String(option), label: String(option) });
  const value = String(current ?? '');
  if (!list.some((option) => option.value === value)) list.unshift({ value, label: value || 'なし' });
  return list;
}

function renderPrimitive(value, path, meta, scope) {
  const token = encodeStructuredPath(path);
  const title = escapeHtml(meta.help || meta.label || String(path.at(-1) ?? ''));
  const common = `data-structured-field="${token}" data-structured-scope="${escapeHtml(scope)}" title="${title}"`;
  let control = '';
  if (typeof value === 'boolean' || meta.type === 'boolean') {
    control = `<input type="checkbox" ${common} ${value ? 'checked' : ''} ${meta.readonly ? 'disabled' : ''}>`;
  } else if (meta.options?.length) {
    control = `<select ${common} ${meta.readonly ? 'disabled' : ''}>${normalizedOptions(meta.options, value).map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(value ?? '') ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  } else if (typeof value === 'number' || meta.type === 'number') {
    control = `<input type="number" ${common} value="${escapeHtml(value ?? '')}" step="${escapeHtml(meta.step ?? 'any')}" ${meta.allowNull ? 'data-structured-nullable="true"' : ''} ${meta.min != null ? `min="${escapeHtml(meta.min)}"` : ''} ${meta.max != null ? `max="${escapeHtml(meta.max)}"` : ''} ${meta.readonly ? 'readonly' : ''}>`;
  } else if (meta.multiline || String(value ?? '').length > 100) {
    control = `<textarea ${common} ${meta.readonly ? 'readonly' : ''}>${escapeHtml(value ?? '')}</textarea>`;
  } else {
    control = `<input type="text" ${common} value="${escapeHtml(value ?? '')}" ${meta.readonly ? 'readonly' : ''}>`;
  }
  return `<label class="structured-field ${typeof value === 'boolean' ? 'toggle' : ''}" title="${title}"><span>${escapeHtml(meta.label)}${helpMarkup(meta)}</span>${control}${meta.suffix ? `<small>${escapeHtml(meta.suffix)}</small>` : ''}</label>`;
}

function renderNode(value, path, key, options, depth) {
  const meta = options.resolveMeta?.(path, value, key) || { label: String(key ?? '設定'), help: '' };
  if (meta.hidden) return '';
  if (value && typeof value === 'object' && !Array.isArray(value) && 'symbol' in value && 'type' in value) {
    return `<div class="structured-asset-note" title="${escapeHtml(meta.help || '同じ画面のアセット欄から選択します')}"><strong>${escapeHtml(meta.label)}</strong>${helpMarkup(meta)}<span>${escapeHtml(value.symbol || '未選択')}（${escapeHtml(value.type || '?')}）</span><small>同じ画面のアセット欄から選択してください。</small></div>`;
  }
  if (value == null && meta.nullable) {
    const token = encodeStructuredPath(path);
    return `<section class="structured-optional" title="${escapeHtml(meta.help || '')}"><header><div><strong>${escapeHtml(meta.label)}</strong>${helpMarkup(meta)}<small>未設定</small></div><button type="button" data-structured-action="enable" data-structured-path="${token}" data-structured-scope="${escapeHtml(options.scope)}" title="${escapeHtml(meta.label)}を有効にする">＋ 設定する</button></header></section>`;
  }
  if (Array.isArray(value)) {
    const token = encodeStructuredPath(path);
    const itemLabel = meta.itemLabel || '項目';
    const rows = value.map((item, index) => `<article class="structured-array-item"><header><strong>${escapeHtml(itemLabel)} ${index + 1}</strong><div><button type="button" data-structured-action="up" data-structured-path="${token}" data-structured-index="${index}" data-structured-scope="${escapeHtml(options.scope)}" title="この項目を1つ上へ移動">↑</button><button type="button" data-structured-action="down" data-structured-path="${token}" data-structured-index="${index}" data-structured-scope="${escapeHtml(options.scope)}" title="この項目を1つ下へ移動">↓</button><button type="button" data-structured-action="remove" data-structured-path="${token}" data-structured-index="${index}" data-structured-scope="${escapeHtml(options.scope)}" title="この項目を削除">削除</button></div></header><div class="structured-array-body">${renderNode(item, [...path, index], index, options, depth + 1)}</div></article>`).join('');
    return `<section class="structured-array" title="${escapeHtml(meta.help || '')}"><header><div><strong>${escapeHtml(meta.label)}</strong>${helpMarkup(meta)}<small>${value.length}件</small></div><button type="button" data-structured-action="add" data-structured-path="${token}" data-structured-scope="${escapeHtml(options.scope)}" title="${escapeHtml(itemLabel)}を追加">＋ ${escapeHtml(itemLabel)}を追加</button></header>${rows || '<p class="structured-empty">項目はありません。「追加」から作成できます。</p>'}</section>`;
  }
  if (value && typeof value === 'object') {
    const children = Object.entries(value).map(([childKey, child]) => renderNode(child, [...path, childKey], childKey, options, depth + 1)).join('');
    if (depth === 0) return `<div class="structured-root">${children}</div>`;
    if (typeof key === 'number') return `<div class="structured-object-inline">${children || '<p class="structured-empty">設定項目はありません。</p>'}</div>`;
    const clear = meta.nullable
      ? `<button type="button" data-structured-action="clear" data-structured-path="${encodeStructuredPath(path)}" data-structured-scope="${escapeHtml(options.scope)}" title="${escapeHtml(meta.label)}を未設定へ戻す">設定を外す</button>`
      : '';
    return `<details class="structured-group" open title="${escapeHtml(meta.help || '')}"><summary><strong>${escapeHtml(meta.label)}</strong>${helpMarkup(meta)}${clear}</summary><div>${children || '<p class="structured-empty">設定項目はありません。</p>'}</div></details>`;
  }
  return renderPrimitive(value, path, meta, options.scope);
}

export function renderStructuredForm(value, {
  scope = 'default',
  rootPath = [],
  resolveMeta = (_path, _value, key) => ({ label: String(key ?? '設定'), help: '' }),
} = {}) {
  return `<div class="structured-form" data-structured-form="${escapeHtml(scope)}">${renderNode(value, rootPath, rootPath.at(-1) || 'root', { scope, resolveMeta }, 0)}</div>`;
}

export function applyStructuredField(root, control) {
  const path = decodeStructuredPath(control?.dataset?.structuredField);
  const original = getStructuredValue(root, path);
  let value;
  if (typeof original === 'boolean' || control.type === 'checkbox') value = Boolean(control.checked);
  else if (typeof original === 'number' || control.type === 'number') value = control.dataset.structuredNullable === 'true' && control.value === '' ? null : Number(control.value);
  else value = control.value;
  return setStructuredValue(root, path, value);
}

export function applyStructuredArrayAction(root, button, getTemplate = () => undefined) {
  const action = button?.dataset?.structuredAction;
  const path = decodeStructuredPath(button?.dataset?.structuredPath);
  if (action === 'enable') {
    const provided = getTemplate(path, null);
    if (provided === undefined) return false;
    setStructuredValue(root, path, cloneStructuredValue(provided));
    return true;
  }
  if (action === 'clear') {
    setStructuredValue(root, path, null);
    return true;
  }
  const array = getStructuredValue(root, path);
  if (!Array.isArray(array)) return false;
  const index = Number(button.dataset.structuredIndex);
  if (action === 'add') {
    const provided = getTemplate(path, array);
    array.push(cloneStructuredValue(provided === undefined ? defaultArrayItem(array) : provided));
  } else if (action === 'remove' && Number.isInteger(index)) {
    array.splice(index, 1);
  } else if (action === 'up' && index > 0 && index < array.length) {
    [array[index - 1], array[index]] = [array[index], array[index - 1]];
  } else if (action === 'down' && index >= 0 && index < array.length - 1) {
    [array[index + 1], array[index]] = [array[index], array[index + 1]];
  } else return false;
  return true;
}
