const PREVIEW_TYPES = new Set(['SPRITE', 'IMAGE', 'MAP', 'TILEMAP', 'VGM', 'XGM', 'XGM2', 'WAV']);

export function flattenResDefinitions(result = {}) {
  return (result.files || []).flatMap((file) => (file.entries || []).map((entry) => ({
    ...entry,
    type: String(entry.type || '').toUpperCase(),
    symbol: String(entry.name || ''),
    resFile: String(file.file || ''),
  }))).sort((left, right) => left.symbol.localeCompare(right.symbol, 'ja', { numeric: true }) || left.type.localeCompare(right.type));
}

export function filterAssets(entries, types = []) {
  const allowed = new Set((Array.isArray(types) ? types : [types]).filter(Boolean).map((type) => String(type).toUpperCase()));
  return entries.filter((entry) => (!allowed.size || allowed.has(entry.type)) && PREVIEW_TYPES.has(entry.type));
}

export function resolveAsset(entries, { symbol, type } = {}) {
  const requested = String(symbol || '');
  const expectedType = String(type || '').toUpperCase();
  const matches = entries.filter((entry) => entry.symbol === requested);
  if (!requested) return { ok: false, code: 'ASSET_SYMBOL_REQUIRED', error: 'アセットの登録名が必要です', matches: [] };
  if (!matches.length) return { ok: false, code: 'ASSET_MISSING', error: `ResComp symbolがありません: ${requested}`, matches: [] };
  if (matches.length > 1) return { ok: false, code: 'ASSET_DUPLICATE', error: `ResComp symbolが重複しています: ${requested}`, matches };
  if (expectedType && matches[0].type !== expectedType) return { ok: false, code: 'ASSET_TYPE_MISMATCH', error: `${requested} は ${matches[0].type} です（要求: ${expectedType}）`, matches };
  return { ok: true, asset: matches[0], reference: { symbol: matches[0].symbol, type: matches[0].type }, matches };
}

export function duplicateSymbolDiagnostics(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.symbol)) groups.set(entry.symbol, []);
    groups.get(entry.symbol).push(entry);
  }
  return [...groups.entries()].filter(([, matches]) => matches.length > 1).map(([symbol, matches]) => ({
    severity: 'error', code: 'ASSET_DUPLICATE', symbol, matches,
    message: `ResComp symbolが${matches.length}件あります: ${symbol}`,
  }));
}

export function spriteAnimationPlan(asset = {}, imageWidth = 0, imageHeight = 0, requestedRow = 0) {
  const size = (token, dimension) => {
    const raw = String(token || '').trim().toUpperCase();
    const numeric = Number.parseInt(raw, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) return 16;
    if (raw.endsWith('P')) return Math.max(8, Math.min(248, Math.round(numeric / 8) * 8));
    if (raw.endsWith('F')) return Math.max(8, Math.min(248, Math.round((dimension / numeric) / 8) * 8));
    return Math.max(8, Math.min(248, numeric * 8));
  };
  const frameWidth = size(asset.width, imageWidth);
  const frameHeight = size(asset.height, imageHeight);
  const columns = Math.max(1, Math.floor(imageWidth / frameWidth));
  const rows = Math.max(1, Math.floor(imageHeight / frameHeight));
  const row = Math.max(0, Math.min(rows - 1, Math.trunc(Number(requestedRow) || 0)));
  const rawTime = String(asset.time ?? '0').trim();
  let timeRows;
  if (rawTime.startsWith('[')) {
    const matches = [...rawTime.matchAll(/\[([^\[\]]*)\]/g)].map((match) => match[1]);
    timeRows = (matches.length ? matches : [rawTime.replace(/^\[+|\]+$/g, '')]).map((text) => text === '' ? ['0'] : text.split(',').map((cell) => cell.trim()));
  } else {
    timeRows = Array.from({ length: rows }, () => Array.from({ length: columns }, () => rawTime || '0'));
  }
  const source = timeRows[row] || Array.from({ length: columns }, () => '0');
  const frameCount = Math.max(1, Math.min(columns, source.length || columns));
  const durations = Array.from({ length: frameCount }, (_, index) => Math.max(0, Math.trunc(Number(source[index]) || 0)));
  return { frameWidth, frameHeight, columns, rows, row, frameCount, durations };
}

export function createRescompAssetPicker({ plugin, api, logger }) {
  let generation = 0;
  let activeAudio = null;
  let activeVgm = null;
  let activeAnimationTimer = 0;

  async function readAll({ reload = true } = {}) {
    if (reload) await api.assets?.reloadResources?.({ keepSelection: true });
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok) throw new Error(result?.error || 'ResComp定義を読めません');
    const assets = flattenResDefinitions(result);
    return { assets, diagnostics: duplicateSymbolDiagnostics(assets), resRoot: result.resRoot || '' };
  }

  async function list({ types } = {}) {
    const result = await readAll({ reload: true });
    return { ok: true, assets: filterAssets(result.assets, types), diagnostics: result.diagnostics };
  }

  async function resolve(request = {}) {
    const result = await readAll({ reload: true });
    return { ...resolveAsset(result.assets, request), diagnostics: result.diagnostics };
  }

  function stopPreview() {
    if (activeAnimationTimer) {
      clearTimeout(activeAnimationTimer);
      activeAnimationTimer = 0;
    }
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    if (activeVgm) {
      activeVgm.stop?.();
      activeVgm = null;
    }
  }

  async function mountPreview(container, request = {}, options = {}) {
    if (!container) return { ok: false, error: 'preview containerが必要です' };
    const token = ++generation;
    stopPreview();
    container.innerHTML = '<p class="rescomp-picker-empty">プレビューを読み込み中…</p>';
    let asset = request?.sourceAbsolutePath ? request : null;
    if (!asset) {
      const found = await resolve(request);
      if (!found.ok) {
        container.innerHTML = `<p class="rescomp-picker-error">${escapeHtml(found.error)}</p>`;
        return found;
      }
      asset = found.asset;
    }
    if (token !== generation) return { ok: false, canceled: true };
    const type = String(asset.type || '').toUpperCase();
    const heading = `<header><strong>${escapeHtml(asset.symbol || asset.name)}</strong><span>${escapeHtml(type)}</span></header>`;
    const sourcePath = asset.sourceAbsolutePath || asset.sourcePath || '';
    try {
      if (['IMAGE', 'SPRITE'].includes(type) || (['MAP', 'TILEMAP'].includes(type) && /\.(?:png|bmp)$/i.test(sourcePath))) {
        const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
        if (!read?.ok || !read.dataUrl) throw new Error(read?.error || '画像を読めません');
        if (type === 'SPRITE') {
          container.innerHTML = `${heading}<div class="rescomp-picker-image"><canvas aria-label="${escapeHtml(asset.symbol)} アニメーションプレビュー"></canvas></div><div class="rescomp-picker-sprite-controls"><label title="スプライトエディターで定義したアニメーション行">アニメーション行 <select data-sprite-row></select></label><button type="button" data-sprite-play title="アニメーションを再生">▶</button><button type="button" data-sprite-stop title="停止して先頭コマへ戻す">■</button><span data-sprite-frame></span></div>${spriteMeta(asset)}`;
          const image = new Image();
          image.src = read.dataUrl;
          await image.decode();
          let plan = spriteAnimationPlan(asset, image.naturalWidth, image.naturalHeight, request.animationRow ?? options.animationRow ?? 0);
          const canvas = container.querySelector('canvas');
          const rowSelect = container.querySelector('[data-sprite-row]');
          const frameLabel = container.querySelector('[data-sprite-frame]');
          let frame = 0;
          const draw = () => {
            const scale = Math.max(1, Math.min(6, Math.floor(Math.min(256 / plan.frameWidth, 160 / plan.frameHeight))));
            canvas.width = plan.frameWidth * scale;
            canvas.height = plan.frameHeight * scale;
            const context = canvas.getContext('2d');
            context.imageSmoothingEnabled = false;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, frame * plan.frameWidth, plan.row * plan.frameHeight, plan.frameWidth, plan.frameHeight, 0, 0, canvas.width, canvas.height);
            frameLabel.textContent = `コマ ${frame + 1}/${plan.frameCount}`;
          };
          const schedule = () => {
            if (token !== generation) return;
            const duration = plan.durations[frame] || 0;
            if (duration <= 0) return;
            activeAnimationTimer = setTimeout(() => {
              activeAnimationTimer = 0;
              frame = (frame + 1) % plan.frameCount;
              draw();
              schedule();
            }, duration * (1000 / 60));
          };
          rowSelect.innerHTML = Array.from({ length: plan.rows }, (_, row) => `<option value="${row}" ${row === plan.row ? 'selected' : ''}>${row}</option>`).join('');
          rowSelect.addEventListener('change', () => {
            if (activeAnimationTimer) clearTimeout(activeAnimationTimer);
            activeAnimationTimer = 0;
            plan = spriteAnimationPlan(asset, image.naturalWidth, image.naturalHeight, rowSelect.value);
            frame = 0;
            draw();
            schedule();
          });
          container.querySelector('[data-sprite-play]').addEventListener('click', () => { if (!activeAnimationTimer) schedule(); });
          container.querySelector('[data-sprite-stop]').addEventListener('click', () => { if (activeAnimationTimer) clearTimeout(activeAnimationTimer); activeAnimationTimer = 0; frame = 0; draw(); });
          draw();
          schedule();
          return { ok: true, asset, kind: 'sprite-animation', image, canvas, plan };
        }
        container.innerHTML = `${heading}<div class="rescomp-picker-image"><img alt="${escapeHtml(asset.symbol)} preview"></div>`;
        const image = container.querySelector('img');
        image.src = read.dataUrl;
        await image.decode();
        return { ok: true, asset, kind: 'image', image };
      }
      if (['MAP', 'TILEMAP'].includes(type)) {
        const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
        if (!read?.ok || !read.dataUrl) throw new Error(read?.error || 'TMXを読めません');
        const text = decodeDataUrl(read.dataUrl);
        const info = tmxInfo(text);
        container.innerHTML = `${heading}<div class="rescomp-picker-map"><canvas width="256" height="160"></canvas></div><p>${escapeHtml(info.label)}</p>`;
        drawTmxPreview(container.querySelector('canvas'), info);
        return { ok: true, asset, kind: 'map', info };
      }
      if (type === 'WAV') {
        const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
        if (!read?.ok || !read.dataUrl) throw new Error(read?.error || 'WAVを読めません');
        container.innerHTML = `${heading}<audio controls title="選択したWAVを試聴"></audio><p>再生方式: ${escapeHtml(asset.driver || '既定')} / 出力レート: ${escapeHtml(asset.outRate || '元データ')}</p>`;
        activeAudio = container.querySelector('audio');
        activeAudio.src = read.dataUrl;
        if (options.autoplay) await activeAudio.play();
        return { ok: true, asset, kind: 'audio', audio: activeAudio };
      }
      if (['VGM', 'XGM', 'XGM2'].includes(type)) {
        const previewSource = vgmSource(asset);
        const read = await api.electronAPI.readFileAsDataUrl(previewSource);
        if (!read?.ok || !read.dataUrl) throw new Error(read?.error || 'VGMを読めません');
        const player = api.capabilities.get('vgm-preview-player') || await api.capabilities.require?.('vgm-preview-player', 1000);
        container.innerHTML = `${heading}<button type="button" data-preview-play title="BGMを試聴">▶ BGM試聴</button><button type="button" data-preview-stop title="試聴を停止">■ 停止</button><p data-preview-position>0.0秒</p>`;
        if (!player) throw new Error('VGM試聴機能が無効です');
        const loaded = player.load({ dataUrl: read.dataUrl });
        if (!loaded?.ok) throw new Error(loaded?.error || 'VGM解析に失敗しました');
        activeVgm = player;
        container.querySelector('[data-preview-play]').addEventListener('click', () => player.play({ onTime(seconds) { const label = container.querySelector('[data-preview-position]'); if (label) label.textContent = `${Number(seconds).toFixed(1)}秒`; } }));
        container.querySelector('[data-preview-stop]').addEventListener('click', () => player.stop());
        return { ok: true, asset, kind: 'vgm', player };
      }
      container.innerHTML = `${heading}<p class="rescomp-picker-empty">この種類はプレビューに対応していません。</p>`;
      return { ok: true, asset, kind: 'none' };
    } catch (error) {
      logger?.warn?.(`Asset preview failed: ${String(error?.message || error)}`);
      container.innerHTML = `${heading}<p class="rescomp-picker-error">${escapeHtml(error?.message || error)}</p>`;
      return { ok: false, asset, error: String(error?.message || error) };
    }
  }

  async function openPicker({ types = [], selectedSymbol = '', allowNone = false, title = 'ResCompアセットを選択' } = {}) {
    const result = await readAll({ reload: true });
    const assets = filterAssets(result.assets, types);
    return new Promise((resolvePromise) => {
      const html = `
        <div class="rescomp-picker-shell">
          <header class="rescomp-picker-header"><h2>${escapeHtml(title)}</h2><button type="button" data-picker-cancel>✕</button></header>
          <div class="rescomp-picker-toolbar"><input type="search" placeholder="登録名・種類・ファイル名で絞り込み" title="候補を登録名、ResComp種類、元ファイル名で絞り込みます"><span data-picker-count></span></div>
          <div class="rescomp-picker-body"><div class="rescomp-picker-list" data-picker-list></div><div class="rescomp-picker-preview" data-picker-preview></div></div>
          <footer class="rescomp-picker-footer"><span data-picker-status></span>${allowNone ? '<button type="button" data-picker-none>なし</button>' : ''}<button type="button" data-picker-cancel>キャンセル</button><button type="button" class="primary" data-picker-select disabled>選択</button></footer>
        </div>`;
      const modal = api.createModal({ id: `${plugin.id}-rescomp-asset-picker`, panelClassName: 'app-panel rescomp-picker-panel', html });
      modal.panel.innerHTML = html;
      const listElement = modal.panel.querySelector('[data-picker-list]');
      const preview = modal.panel.querySelector('[data-picker-preview]');
      const search = modal.panel.querySelector('input[type="search"]');
      const count = modal.panel.querySelector('[data-picker-count]');
      const status = modal.panel.querySelector('[data-picker-status]');
      const select = modal.panel.querySelector('[data-picker-select]');
      let selected = assets.find((entry) => entry.symbol === selectedSymbol) || null;
      const finish = (value) => { stopPreview(); modal.close(); resolvePromise(value); };
      const render = () => {
        const query = search.value.trim().toLowerCase();
        const visible = assets.filter((entry) => !query || `${entry.symbol} ${entry.type} ${entry.sourcePath}`.toLowerCase().includes(query));
        count.textContent = `${visible.length}件`;
        listElement.innerHTML = visible.map((entry) => `<button type="button" class="rescomp-picker-row ${entry === selected ? 'active' : ''}" data-picker-symbol="${escapeHtml(entry.symbol)}"><strong>${escapeHtml(entry.symbol)}</strong><span>${escapeHtml(entry.type)}</span><small>${escapeHtml(entry.sourcePath || '')}</small></button>`).join('') || '<p class="rescomp-picker-empty">該当するアセットはありません</p>';
        select.disabled = !selected;
        status.textContent = result.diagnostics.length ? `エラー: 登録名が重複しています ${result.diagnostics.map((item) => item.symbol).join(', ')}` : '';
        status.classList.toggle('error', result.diagnostics.length > 0);
      };
      listElement.addEventListener('click', (event) => {
        const button = event.target.closest('[data-picker-symbol]');
        if (!button) return;
        selected = assets.find((entry) => entry.symbol === button.dataset.pickerSymbol) || null;
        render();
        if (selected) void mountPreview(preview, selected);
      });
      search.addEventListener('input', render);
      modal.panel.querySelectorAll('[data-picker-cancel]').forEach((button) => button.addEventListener('click', () => finish({ ok: false, canceled: true, selection: null }), { once: true }));
      modal.panel.querySelector('[data-picker-none]')?.addEventListener('click', () => finish({ ok: true, selection: null }), { once: true });
      select.addEventListener('click', () => {
        if (!selected) return;
        const resolved = resolveAsset(result.assets, { symbol: selected.symbol, type: selected.type });
        if (!resolved.ok || result.diagnostics.some((item) => item.symbol === selected.symbol)) { status.textContent = resolved.error || `登録名が重複しています: ${selected.symbol}`; status.classList.add('error'); return; }
        finish({ ok: true, selection: resolved.reference, asset: resolved.asset });
      });
      render();
      if (selected) void mountPreview(preview, selected);
      else preview.innerHTML = '<p class="rescomp-picker-empty">左の候補を選択すると、ここへ自動的にプレビューします。</p>';
      modal.open();
      search.focus();
    });
  }

  return { list, resolve, openPicker, mountPreview, stopPreview };
}

function vgmSource(asset) {
  if (/\.vgm$/i.test(asset.sourceAbsolutePath || asset.sourcePath || '')) return asset.sourceAbsolutePath || asset.sourcePath;
  const candidate = (asset.files || []).find((file) => /\.vgm$/i.test(file));
  if (!candidate) return asset.sourceAbsolutePath || asset.sourcePath || '';
  const base = String(asset.sourceAbsolutePath || '').replace(/\\/g, '/');
  return base.includes('/') ? `${base.slice(0, base.lastIndexOf('/') + 1)}${candidate}` : candidate;
}

function spriteMeta(asset) {
  if (String(asset.type).toUpperCase() !== 'SPRITE') return '';
  return `<p>大きさ: ${escapeHtml(asset.width || '?')}×${escapeHtml(asset.height || '?')}タイル / アニメーション時間: ${escapeHtml(asset.time || '0')}</p>`;
}

function decodeDataUrl(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return '';
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const bytes = meta.includes(';base64') ? Uint8Array.from(atob(body), (char) => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
  return new TextDecoder('utf-8').decode(bytes);
}

function tmxInfo(source) {
  const width = Number(source.match(/<map[^>]*\bwidth="(\d+)"/)?.[1] || 0);
  const height = Number(source.match(/<map[^>]*\bheight="(\d+)"/)?.[1] || 0);
  const layers = [...source.matchAll(/<layer[^>]*\bname="([^"]+)"[^>]*>[\s\S]*?<data[^>]*encoding="csv"[^>]*>([\s\S]*?)<\/data>/g)].map((match) => ({ name: match[1], data: match[2].split(/[\s,]+/).filter(Boolean).map(Number) }));
  return { width, height, layers, label: `${width}×${height} / ${layers.length}レイヤー` };
}

function drawTmxPreview(canvas, info) {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  context.fillStyle = '#08101a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!info.width || !info.height) return;
  const scale = Math.min(canvas.width / info.width, canvas.height / info.height);
  for (const [layerIndex, layer] of info.layers.entries()) {
    for (let index = 0; index < layer.data.length; index += 1) {
      if (!layer.data[index]) continue;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      context.fillStyle = layerIndex % 2 ? 'rgba(255,192,64,.55)' : 'rgba(54,151,211,.72)';
      context.fillRect(Math.floor(x * scale), Math.floor(y * scale), Math.ceil(scale), Math.ceil(scale));
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
