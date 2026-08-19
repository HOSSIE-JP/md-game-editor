import {
  backgroundSourceX,
  bulletVectors,
  clamp,
  collectUniqueTiles,
  eventMarkerPercent,
  eventReferenceKey,
  simulateSpawnPosition,
} from './preview-core.mjs';
import {
  COLLECTION_TABS,
  ENTITY_TABS,
  SYSTEM_ASSETS,
  SYSTEM_ASSET_BY_ID,
  buildShell,
  clone,
  escapeHtml,
  formatJson,
  itemAssetId,
  listLabel,
  projectAssets,
  renderFormHtml,
  safeFileName,
  safeId,
  upsertCollectionEntity,
} from './editor-ui.mjs';

function pathParts(relativePath, fallbackName) {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const slash = clean.lastIndexOf('/');
  return { subdir: slash >= 0 ? clean.slice(0, slash) : 'gfx', fileName: slash >= 0 ? clean.slice(slash + 1) : (clean || fallbackName) };
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.classList.add('horizontal-stg-editor-page');
  root.innerHTML = buildShell();

  const elements = Object.fromEntries([
    'game-title', 'list-title', 'list', 'form-title', 'form', 'dirty', 'preview', 'screen-shell', 'preview-status',
    'play-button', 'preview-zoom', 'playhead', 'playhead-label', 'timeline', 'tile-tools', 'tile-layer',
    'tile-palette', 'tile-status', 'json-preview', 'status',
  ].map((role) => [role.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), root.querySelector(`[data-role="${role}"]`)]));

  const state = {
    snapshot: null, validation: null, tab: 'stages', selectedId: '', draft: null, dirty: false, loading: false,
    pendingAction: null, projectDir: '', imageCache: new Map(), assetGeneration: 0,
    backgroundLayers: { a: null, b: null }, tileLayer: 'a', tileTool: 'stamp', selectedTileIndex: 0,
    selectedEventIndex: -1, previewPlaying: false, playhead: 0, lastFrameTime: 0, wasActive: root.classList.contains('active'),
    audioPlayer: null, audioTime: 0,
  };

  const guard = api.createModal({
    id: `${plugin.id}-dirty-guard`,
    html: `<div class="settings-form compact-form hstg-guard"><h3>未保存の変更</h3><p>JSONまたは背景タイルに未保存の変更があります。</p><div class="hstg-guard-actions"><button type="button" data-choice="save" class="primary">保存</button><button type="button" data-choice="discard">破棄</button><button type="button" data-choice="cancel">キャンセル</button></div></div>`,
  });

  function setStatus(message, tone = '') {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    elements.dirty.textContent = state.dirty ? '● 未保存' : '';
    renderList();
  }

  function currentEntries() {
    if (!state.snapshot) return [];
    if (state.tab === 'stages') return state.snapshot.stages || [];
    if (state.tab === 'sprites') {
      const assets = projectAssets(state.snapshot.project);
      return SYSTEM_ASSETS.map((asset) => ({ ...asset, name: asset.label, value: assets[asset.id] }));
    }
    return COLLECTION_TABS.includes(state.tab) ? state.snapshot[state.tab] || [] : [];
  }

  function currentRevision() {
    if (!state.snapshot?.revisions) return '';
    if (state.tab === 'stages') return state.snapshot.revisions.stages?.[state.selectedId] || '';
    if (state.tab === 'sprites') return state.snapshot.revisions.project || '';
    return state.snapshot.revisions[state.tab] || '';
  }

  function selectDefault() {
    if (['project', 'flow', 'validation'].includes(state.tab)) {
      state.selectedId = '';
      state.draft = state.tab === 'validation' ? null : clone(state.snapshot?.[state.tab]);
      return;
    }
    const entries = currentEntries();
    if (!entries.some((entry) => entry.id === state.selectedId)) state.selectedId = entries[0]?.id || '';
    state.draft = state.tab === 'sprites'
      ? clone(state.snapshot?.project || null)
      : clone(entries.find((entry) => entry.id === state.selectedId) || null);
  }

  function renderList() {
    elements.listTitle.textContent = listLabel(state.tab);
    root.querySelector('[data-action="add"]').hidden = !ENTITY_TABS.includes(state.tab);
    if (['project', 'flow', 'validation'].includes(state.tab)) {
      elements.list.innerHTML = `<div class="hstg-empty">${escapeHtml(listLabel(state.tab))}</div>`;
      return;
    }
    let lastGroup = '';
    elements.list.innerHTML = currentEntries().map((entry, index, entries) => {
      const selected = entry.id === state.selectedId;
      const group = state.tab === 'sprites' && entry.group !== lastGroup ? `<div class="hstg-list-group">${escapeHtml(entry.group)}</div>` : '';
      lastGroup = entry.group || lastGroup;
      return `${group}<div class="hstg-list-row ${selected ? 'selected' : ''}"><button type="button" class="hstg-list-select" data-action="select" data-id="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.name || entry.label || entry.id)}${selected && state.dirty ? ' *' : ''}</strong><small>${escapeHtml(state.tab === 'sprites' ? entry.value : entry.id)}</small></button><div class="hstg-list-actions">${state.tab === 'stages' ? `<button type="button" data-action="move-up" data-id="${escapeHtml(entry.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="move-down" data-id="${escapeHtml(entry.id)}" ${index === entries.length - 1 ? 'disabled' : ''}>↓</button>` : ''}${selected ? `<button type="button" data-action="save">保存</button>${state.tab !== 'sprites' ? `<button type="button" data-action="delete" data-id="${escapeHtml(entry.id)}">削除</button>` : ''}` : ''}</div></div>`;
    }).join('') || '<div class="hstg-empty">項目がありません</div>';
  }

  function renderForm() {
    elements.formTitle.textContent = listLabel(state.tab);
    elements.form.innerHTML = renderFormHtml(state);
  }

  function renderTimeline() {
    if (state.tab !== 'stages' || !state.draft) {
      elements.timeline.innerHTML = '<div class="hstg-timeline-empty">stage timeline</div>';
      elements.playhead.max = '1'; elements.playhead.value = '0'; elements.playheadLabel.textContent = '';
      return;
    }
    const events = state.draft.events || [];
    const length = Math.max(1, Number(state.draft.length_px || 1));
    const markers = events.map((event, index) => `<button type="button" class="hstg-marker command-${escapeHtml(event.command)} ${index === state.selectedEventIndex ? 'selected' : ''}" data-action="select-event" data-event-index="${index}" title="${escapeHtml(event.command)} @ ${escapeHtml(event.trigger?.at || 0)}" style="left:${eventMarkerPercent(event, length)}%"></button>`).join('');
    elements.timeline.innerHTML = `<div class="hstg-timeline-ruler"><span>0</span><span>${Math.round(length * 0.25)}</span><span>${Math.round(length * 0.5)}</span><span>${Math.round(length * 0.75)}</span><span>${length}</span></div><div class="hstg-timeline-track" data-action="place-event">${markers}<i style="left:${clamp((state.playhead / length) * 100, 0, 100)}%"></i></div>`;
    elements.playhead.max = String(Math.max(0, length - 1));
    elements.playhead.value = String(Math.round(clamp(state.playhead, 0, length - 1)));
    elements.playheadLabel.textContent = `${Math.round(state.playhead)} px`;
  }

  function renderTilePalette() {
    const visible = state.tab === 'stages' && Boolean(state.draft);
    elements.tileTools.hidden = !visible;
    if (!visible) return;
    elements.tileLayer.value = state.tileLayer;
    const layer = state.backgroundLayers[state.tileLayer];
    if (!layer) {
      elements.tilePalette.innerHTML = '<div class="hstg-empty">背景PNGを読込中です。</div>';
      elements.tileStatus.textContent = '';
      return;
    }
    elements.tileStatus.textContent = `${layer.tiles.length} pattern${layer.dirty ? ' / 未保存' : ''}`;
    elements.tilePalette.innerHTML = layer.tiles.map((_tile, index) => `<button type="button" data-action="select-tile" data-tile-index="${index}" class="${index === state.selectedTileIndex ? 'selected' : ''}" title="pattern ${index}"><canvas width="8" height="8" data-tile-canvas="${index}"></canvas><span>${index}</span></button>`).join('');
    elements.tilePalette.querySelectorAll('[data-tile-canvas]').forEach((canvas) => {
      const tile = layer.tiles[Number(canvas.dataset.tileCanvas)];
      const context = canvas.getContext('2d');
      const image = context.createImageData(8, 8);
      image.data.set(tile.data);
      context.putImageData(image, 0, 0);
    });
    root.querySelector('[data-action="tile-stamp"]')?.classList.toggle('active', state.tileTool === 'stamp');
    root.querySelector('[data-action="tile-eyedropper"]')?.classList.toggle('active', state.tileTool === 'eyedropper');
  }

  function setPreviewGrid(context) {
    context.fillStyle = '#03101c'; context.fillRect(0, 0, 320, 224);
    context.strokeStyle = 'rgba(73,140,174,.16)';
    for (let x = 0; x <= 320; x += 16) { context.beginPath(); context.moveTo(x + 0.5, 0); context.lineTo(x + 0.5, 224); context.stroke(); }
    for (let y = 0; y <= 224; y += 16) { context.beginPath(); context.moveTo(0, y + 0.5); context.lineTo(320, y + 0.5); context.stroke(); }
  }

  function cachedImage(path) {
    return state.imageCache.get(String(path || '').replace(/\\/g, '/'))?.image || null;
  }

  function drawCentered(context, image, cx, cy, maxWidth = 160, maxHeight = 120, crop = false) {
    if (!image) return false;
    let sourceWidth = image.naturalWidth || image.width;
    let sourceHeight = image.naturalHeight || image.height;
    let width = sourceWidth; let height = sourceHeight;
    if (crop) { sourceWidth = Math.min(sourceWidth, maxWidth); sourceHeight = Math.min(sourceHeight, maxHeight); width = sourceWidth; height = sourceHeight; }
    else { const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height), 6); width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale)); }
    context.drawImage(image, 0, 0, sourceWidth, sourceHeight, Math.round(cx - width / 2), Math.round(cy - height / 2), width, height);
    return true;
  }

  function drawBulletPattern(context, definition, kind, originX, originY, phase) {
    const vectors = bulletVectors(definition?.fire_pattern, phase, kind);
    const bullet = cachedImage(projectAssets(state.snapshot?.project)[kind === 'player' ? 'player_bullet' : 'enemy_bullet']);
    for (let ring = 1; ring <= 3; ring += 1) {
      vectors.forEach((vector, index) => {
        const distance = ((phase * 42) + (ring * 36) + (index % 3) * 4) % 116;
        const x = originX + vector.vx * distance * 0.55; const y = originY + vector.vy * distance * 0.55;
        if (x < 4 || x > 316 || y < 12 || y > 220) return;
        if (bullet) context.drawImage(bullet, 0, 0, Math.min(8, bullet.naturalWidth), Math.min(8, bullet.naturalHeight), Math.round(x - 4), Math.round(y - 4), 8, 8);
        else { context.fillStyle = kind === 'player' ? '#7ef2ff' : '#ff6a8b'; context.fillRect(Math.round(x - 2), Math.round(y - 2), 5, 5); }
      });
    }
  }

  function drawHud(context) {
    context.fillStyle = 'rgba(0,8,16,.9)'; context.fillRect(0, 0, 320, 10);
    context.font = '7px monospace'; context.fillStyle = '#d9f7ff'; context.fillText('1P 00012800', 4, 7); context.fillText('L 3  P 2  S 1  B 2', 190, 7);
    for (let index = 0; index < 12; index += 1) { context.fillStyle = index < 8 ? (index < 5 ? '#4fd6f2' : '#f2cc58') : '#21364a'; context.fillRect(80 + index * 8, 2, 6, 5); }
  }

  function drawStagePreview(context) {
    const stage = state.draft; const layerB = state.backgroundLayers.b; const layerA = state.backgroundLayers.a;
    if (layerB?.canvas) { const sx = backgroundSourceX(state.playhead, layerB.canvas.width, 320, Number(stage.parallax_shift_b || 0)); context.drawImage(layerB.canvas, sx, 0, 320, 224, 0, 0, 320, 224); } else setPreviewGrid(context);
    if (layerA?.canvas) { const sx = backgroundSourceX(state.playhead, layerA.canvas.width, 320, 0); context.drawImage(layerA.canvas, sx, 0, 320, 224, 0, 0, 320, 224); }
    const assets = projectAssets(state.snapshot?.project);
    if (!drawCentered(context, cachedImage(assets.player), 54, 116, 48, 32, true)) { context.fillStyle = '#57c9f4'; context.beginPath(); context.moveTo(28, 116); context.lineTo(68, 102); context.lineTo(82, 116); context.lineTo(68, 130); context.closePath(); context.fill(); }
    const speed = Math.max(1, Number(stage.scroll_speed_256 || 256));
    (stage.events || []).forEach((event) => {
      if (event.trigger?.type !== 'scroll') return;
      const at = Number(event.trigger.at || 0);
      if (state.playhead < at || state.playhead > at + 520) return;
      if (event.command === 'spawn_enemy') {
        const definition = (state.snapshot?.enemies || []).find((entry) => entry.id === event.payload?.enemy_id) || {};
        const position = simulateSpawnPosition(event, definition, state.playhead, speed);
        if (position.x < -40 || position.x > 360 || position.y < -32 || position.y > 244) return;
        const image = cachedImage(definition.sprite) || cachedImage(assets.enemy_fallback);
        if (!drawCentered(context, image, position.x, position.y, 48, 32, true)) { context.fillStyle = '#f05d75'; context.fillRect(position.x - 10, position.y - 7, 20, 14); }
        if (definition.fire_pattern && definition.fire_pattern !== 'none') drawBulletPattern(context, definition, 'enemy', position.x - 8, position.y, (performance.now() / 650) % 8);
      } else if (event.command === 'spawn_item') drawCentered(context, cachedImage(assets[itemAssetId(event.payload?.item_id)]), Number(event.payload?.x ?? 300), Number(event.payload?.y ?? 112), 16, 16, true);
      else if (event.command === 'start_boss') {
        const definition = (state.snapshot?.bosses || []).find((entry) => entry.id === event.payload?.boss_id) || {};
        const x = Math.max(Number(definition.active_x ?? 256), Number(definition.entry_x ?? 344) - (state.playhead - at) * 0.4); const y = Number(definition.y ?? 112);
        drawCentered(context, cachedImage(definition.sprite) || cachedImage(assets.boss_part), x, y, 64, 64, true); drawBulletPattern(context, definition, 'boss', x - 12, y, (performance.now() / 550) % 8);
      }
    });
    drawHud(context);
    context.fillStyle = 'rgba(0,0,0,.72)'; context.fillRect(4, 198, 165, 20); context.fillStyle = '#dff8ff'; context.font = '9px monospace'; context.fillText(stage.name || stage.id, 8, 207); context.fillText(`SCROLL ${Math.round(state.playhead)} / ${stage.length_px}`, 8, 216);
    context.strokeStyle = 'rgba(126,242,255,.2)';
    for (let x = 0; x <= 320; x += 8) { context.beginPath(); context.moveTo(x + .5, 0); context.lineTo(x + .5, 224); context.stroke(); }
    for (let y = 0; y <= 224; y += 8) { context.beginPath(); context.moveTo(0, y + .5); context.lineTo(320, y + .5); context.stroke(); }
  }

  function drawDefinitionPreview(context, definition, kind) {
    setPreviewGrid(context);
    if (state.backgroundLayers.b?.canvas) context.drawImage(state.backgroundLayers.b.canvas, 0, 0, 320, 224, 0, 0, 320, 224);
    context.fillStyle = 'rgba(2,10,18,.55)'; context.fillRect(0, 0, 320, 224);
    const assets = projectAssets(state.snapshot?.project); const x = kind === 'boss' ? 248 : 244; const y = 112;
    drawCentered(context, cachedImage(definition.sprite) || cachedImage(assets[kind === 'boss' ? 'boss_part' : 'enemy_fallback']), x, y, kind === 'boss' ? 96 : 72, kind === 'boss' ? 96 : 56, true);
    drawCentered(context, cachedImage(assets.player), 58, 112, 48, 32, true);
    drawBulletPattern(context, definition, kind, x - 12, y, (performance.now() / 650) % 10);
    context.fillStyle = '#e6f8ff'; context.font = '11px monospace'; context.fillText(definition.name || definition.id, 8, 18); context.fillStyle = '#81dff6'; context.fillText(`${definition.fire_pattern || 'none'} / interval ${definition.fire_interval ?? 0}f`, 8, 34); context.fillText(kind === 'boss' ? `${definition.movement || 'stationary'} / HP ${(definition.part_hp || []).join('+')}` : `${definition.behavior || 'straight'} / vx ${definition.vx256 ?? 0}`, 8, 48);
  }

  function drawWeaponPreview(context, weapon) {
    setPreviewGrid(context); drawCentered(context, cachedImage(projectAssets(state.snapshot?.project).player), 48, 112, 48, 32, true);
    const pattern = weapon.pattern || 'burst_laser'; const lanes = pattern === 'plasma_spread' ? 5 : (pattern === 'abyss_wave' ? 3 : 1);
    context.fillStyle = weapon.color === 'red' ? '#ff5b65' : (weapon.color === 'green' ? '#64f29a' : '#62c8ff');
    for (let lane = 0; lane < lanes; lane += 1) for (let shot = 0; shot < 7; shot += 1) { const x = 82 + ((shot * 42 + performance.now() / 12) % 245); const y = 112 + (lane - (lanes - 1) / 2) * 12 + (pattern === 'abyss_wave' ? Math.sin((x + lane * 20) / 22) * 10 : 0); context.fillRect(Math.round(x), Math.round(y), pattern === 'burst_laser' ? 18 : 8, 4); }
    context.fillStyle = '#e6f8ff'; context.font = '11px monospace'; context.fillText(`${weapon.name || weapon.id} / ${pattern}`, 8, 18);
  }

  function drawAssetPreview(context, path, label) {
    setPreviewGrid(context); const image = cachedImage(path);
    if (!drawCentered(context, image, 160, 112, 288, 190)) { context.fillStyle = '#7890a0'; context.font = '12px monospace'; context.fillText('画像を読込中 / 未設定', 84, 112); }
    context.fillStyle = 'rgba(0,0,0,.76)'; context.fillRect(0, 198, 320, 26); context.fillStyle = '#e6f8ff'; context.font = '10px monospace'; context.fillText(label || path || '', 8, 210); context.fillText(path || '', 8, 220);
  }

  function drawAudioPreview(context, cue) {
    setPreviewGrid(context); context.fillStyle = '#0a2131'; context.fillRect(12, 50, 296, 124); const phase = state.audioPlayer?.isPlaying?.() ? performance.now() / 150 : 0;
    for (let index = 0; index < 28; index += 1) { const height = 10 + (Math.sin(index * .71 + phase) + 1) * 35 + (index * 17) % 20; context.fillStyle = index < 18 ? '#42ccea' : '#f3b455'; context.fillRect(18 + index * 10, 162 - height, 6, height); }
    context.fillStyle = '#e6f8ff'; context.font = '13px monospace'; context.fillText(cue.name || cue.id, 18, 28); context.font = '10px monospace'; context.fillText(`${cue.type || 'XGM2'}  ${cue.path || '未設定'}`, 18, 43); context.fillText(`YM2612 FM1-6 | PSG1-3+NOISE | ${state.audioTime.toFixed(1)} sec`, 18, 190);
  }

  function renderPreview() {
    const context = elements.preview.getContext('2d'); context.imageSmoothingEnabled = false; context.clearRect(0, 0, 320, 224);
    if (state.tab === 'stages' && state.draft) drawStagePreview(context);
    else if (state.tab === 'sprites' && state.draft) { const meta = SYSTEM_ASSET_BY_ID.get(state.selectedId) || SYSTEM_ASSETS[0]; drawAssetPreview(context, projectAssets(state.draft)[meta.id], meta.label); }
    else if (state.tab === 'enemies' && state.draft) drawDefinitionPreview(context, state.draft, 'enemy');
    else if (state.tab === 'bosses' && state.draft) drawDefinitionPreview(context, state.draft, 'boss');
    else if (state.tab === 'weapons' && state.draft) drawWeaponPreview(context, state.draft);
    else if (state.tab === 'items' && state.draft) drawAssetPreview(context, projectAssets(state.snapshot?.project)[itemAssetId(state.draft.id)], state.draft.name);
    else if (state.tab === 'effects' && state.draft) drawAssetPreview(context, projectAssets(state.snapshot?.project).explosion, state.draft.name);
    else if (state.tab === 'audio' && state.draft) drawAudioPreview(context, state.draft);
    else setPreviewGrid(context);
    elements.previewStatus.textContent = state.tab === 'stages' ? `${state.draft?.events?.length || 0} events` : (state.draft?.id || '');
    elements.jsonPreview.textContent = state.draft ? formatJson(state.draft) : '';
    elements.playButton.textContent = state.previewPlaying ? 'Ⅱ' : '▶';
    renderTimeline();
  }

  function render() {
    elements.gameTitle.textContent = state.snapshot?.project?.title || '';
    root.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.tab));
    renderList(); renderForm(); renderPreview(); renderTilePalette(); void refreshPreviewAssets();
  }

  async function getProjectDir() {
    if (state.projectDir) return state.projectDir;
    const project = await api.electronAPI.getCurrentProject?.();
    state.projectDir = String(project?.projectDir || project?.dir || project?.currentProjectDir || '').replace(/\\/g, '/');
    return state.projectDir;
  }

  async function loadAssetImage(path) {
    const rel = String(path || '').replace(/\\/g, '/').replace(/^res\//, ''); if (!rel) return null;
    const existing = state.imageCache.get(rel); if (existing?.image) return existing.image; if (existing?.promise) return existing.promise;
    const record = { image: null, promise: null, error: '' };
    record.promise = (async () => { const projectDir = await getProjectDir(); if (!projectDir) throw new Error('プロジェクトパスがありません'); const read = await api.electronAPI.readFileAsDataUrl(`${projectDir}/res/${rel}`); if (!read?.ok || !read.dataUrl) throw new Error(read?.error || `${rel}を読めません`); const image = new Image(); image.src = read.dataUrl; await image.decode(); record.image = image; record.promise = null; return image; })().catch((error) => { record.error = String(error?.message || error); record.promise = null; return null; });
    state.imageCache.set(rel, record); return record.promise;
  }

  async function loadBackgroundLayer(key, path, generation) {
    const rel = String(path || '').replace(/\\/g, '/'); if (!rel) { state.backgroundLayers[key] = null; return; }
    if (state.backgroundLayers[key]?.path === rel) return;
    const image = await loadAssetImage(rel); if (!image || generation !== state.assetGeneration) return;
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.imageSmoothingEnabled = false; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
    const tiles = collectUniqueTiles(context.getImageData(0, 0, canvas.width, canvas.height), 8, 768);
    state.backgroundLayers[key] = { path: rel, canvas, context, tiles, dirty: false, undo: [] };
  }

  async function refreshPreviewAssets() {
    if (!state.snapshot) return;
    const generation = ++state.assetGeneration; const loads = []; const assets = projectAssets(state.tab === 'sprites' ? state.draft : state.snapshot.project);
    for (const key of ['player', 'player_bullet', 'enemy_bullet', 'enemy_fallback', 'boss_part', 'explosion']) loads.push(loadAssetImage(assets[key]));
    if (state.tab === 'stages' && state.draft) {
      loads.push(loadBackgroundLayer('a', state.draft.assets?.bg_a, generation), loadBackgroundLayer('b', state.draft.assets?.bg_b, generation));
      for (const event of state.draft.events || []) {
        if (event.command === 'spawn_enemy') { const enemy = state.snapshot.enemies?.find((entry) => entry.id === event.payload?.enemy_id); if (enemy?.sprite) loads.push(loadAssetImage(enemy.sprite)); }
        else if (event.command === 'start_boss') { const boss = state.snapshot.bosses?.find((entry) => entry.id === event.payload?.boss_id); if (boss?.sprite) loads.push(loadAssetImage(boss.sprite)); }
        else if (event.command === 'spawn_item') loads.push(loadAssetImage(assets[itemAssetId(event.payload?.item_id)]));
      }
    } else if (state.tab === 'sprites' && state.draft) { const meta = SYSTEM_ASSET_BY_ID.get(state.selectedId); if (meta) loads.push(loadAssetImage(projectAssets(state.draft)[meta.id])); }
    else if (['enemies', 'bosses'].includes(state.tab) && state.draft?.sprite) loads.push(loadAssetImage(state.draft.sprite));
    else if (state.tab === 'items' && state.draft) loads.push(loadAssetImage(assets[itemAssetId(state.draft.id)]));
    await Promise.all(loads); if (generation !== state.assetGeneration) return; renderPreview(); renderTilePalette();
  }

  async function reload() {
    if (state.loading) return; state.loading = true; stopAudio(); setStatus('横STGデータを読込中…');
    try {
      state.projectDir = ''; state.imageCache.clear(); state.backgroundLayers = { a: null, b: null };
      const result = await api.plugins.invokeHook(plugin.id, 'loadHorizontalStgProject', {}); if (!result?.ok) throw new Error(result?.error || '読込に失敗しました');
      state.snapshot = result.snapshot; state.validation = result.validation; state.playhead = 0; state.selectedEventIndex = -1; setDirty(false); selectDefault(); render();
      setStatus(result.validation?.ok ? '読込完了' : `読込完了: ${result.validation?.errors?.length || 0} error`, result.validation?.ok ? 'ok' : 'error');
    } catch (error) { setStatus(error.message, 'error'); logger.error(error.message); } finally { state.loading = false; }
  }

  function parseEvents() {
    return Array.from(elements.form.querySelectorAll('.hstg-event-row[data-event-index]')).map((row, order) => {
      const original = clone(state.draft.events?.[Number(row.dataset.eventIndex)] || {}); const get = (name) => row.querySelector(`[data-event-field="${name}"]`);
      const command = String(get('command')?.value || original.command || 'spawn_enemy'); const type = String(get('trigger')?.value || 'scroll'); const at = Number(get('at')?.value || 0); const payload = { ...(original.payload || {}) };
      delete payload.enemy_id; delete payload.item_id; delete payload.boss_id; const refKey = eventReferenceKey(command); if (refKey) payload[refKey] = String(get('reference')?.value || '');
      if (['spawn_enemy', 'spawn_item'].includes(command)) { payload.x = Number(get('x')?.value ?? 336); payload.y = Number(get('y')?.value ?? 112); } else { delete payload.x; delete payload.y; }
      if (command === 'set_flag') payload.flag = Number(get('y')?.value ?? 0); else delete payload.flag;
      return { ...original, id: safeId(original.id, `${state.draft.id}-event-${order + 1}`), trigger: { ...(original.trigger || {}), type, at, condition: type === 'condition' ? at : Number(original.trigger?.condition || 0) }, order, command, payload };
    });
  }

  function numberValue(data, key, fallback = 0) { const value = Number(data.get(key)); return Number.isFinite(value) ? value : fallback; }

  function parseForm() {
    const data = new FormData(elements.form);
    if (state.tab === 'stages') {
      const next = clone(state.draft); next.id = safeId(data.get('id'), next.id); next.name = String(data.get('name') || next.name); next.length_px = numberValue(data, 'length_px', next.length_px); next.scroll_speed_256 = numberValue(data, 'scroll_speed_256', next.scroll_speed_256); next.parallax_shift_b = numberValue(data, 'parallax_shift_b', next.parallax_shift_b); next.assets = { ...(next.assets || {}), bg_a: String(data.get('bg_a') || ''), bg_b: String(data.get('bg_b') || '') }; next.music_id = safeId(data.get('music_id')); next.midboss_id = safeId(data.get('midboss_id')); next.boss_id = safeId(data.get('boss_id')); next.events = parseEvents(); return next;
    }
    if (state.tab === 'sprites') { const next = clone(state.draft); next.assets = { ...projectAssets(next), [state.selectedId]: String(data.get('asset_path') || SYSTEM_ASSET_BY_ID.get(state.selectedId)?.path || '') }; return next; }
    if (state.tab === 'project' || state.tab === 'flow') return JSON.parse(String(data.get('document') || '{}'));
    const next = clone(state.draft); next.id = safeId(data.get('id'), next.id); next.name = String(data.get('name') || next.name);
    if (state.tab === 'enemies') { for (const key of ['hp', 'score', 'vx256', 'vy256', 'fire_interval', 'flags']) next[key] = numberValue(data, key, next[key]); next.behavior = String(data.get('behavior') || 'straight'); next.fire_pattern = String(data.get('fire_pattern') || 'none'); next.sprite = String(data.get('sprite') || ''); }
    else if (state.tab === 'bosses') { for (const key of ['entry_x', 'active_x', 'y', 'entry_vx256', 'score', 'fire_interval', 'death_frames', 'bomb_damage', 'forms']) next[key] = numberValue(data, key, next[key]); next.part_hp = [0, 1, 2].map((index) => numberValue(data, `part_hp_${index}`, next.part_hp?.[index] || 1)); next.movement = String(data.get('movement') || 'stationary'); next.fire_pattern = String(data.get('fire_pattern') || 'aimed'); next.sprite = String(data.get('sprite') || ''); }
    else if (state.tab === 'weapons') { next.color = String(data.get('color') || next.id); next.pattern = String(data.get('pattern') || 'burst_laser'); next.levels = [0, 1, 2].map((index) => ({ ...(next.levels?.[index] || {}), damage: numberValue(data, `level_${index}_damage`, index + 1), speed256: numberValue(data, `level_${index}_speed`, 1024), lanes: numberValue(data, `level_${index}_lanes`, 1) })); }
    else if (state.tab === 'items') next.duplicate_score = numberValue(data, 'duplicate_score', 500);
    else if (state.tab === 'effects') { next.frames = numberValue(data, 'frames', 4); next.frame_time = numberValue(data, 'frame_time', 4); }
    else if (state.tab === 'audio') { next.type = String(data.get('type') || 'XGM2'); next.path = String(data.get('path') || ''); next.loop = data.get('loop') === 'on'; next.rate = numberValue(data, 'rate', 2); }
    return next;
  }

  async function saveEditedBackgrounds() {
    const layers = Object.values(state.backgroundLayers).filter((layer) => layer?.dirty); if (!layers.length) return true;
    const encoder = api.capabilities.get('image-quantize')?.imageDataToIndexedPng || api.imageDataToIndexedPng; if (!encoder) { setStatus('indexed PNG encoderが無効です', 'error'); return false; }
    const projectDir = await getProjectDir();
    for (const layer of layers) {
      try { const dataUrl = await encoder(layer.context.getImageData(0, 0, layer.canvas.width, layer.canvas.height)); const parts = pathParts(layer.path, 'background.png'); const written = await api.electronAPI.writeAssetFile({ sourcePath: `${projectDir}/res/${layer.path}`, targetSubdir: parts.subdir, targetFileName: parts.fileName, dataUrl }); if (!written?.ok) throw new Error(written?.error || '背景PNGを保存できません'); layer.dirty = false; layer.undo = []; state.imageCache.delete(layer.path); }
      catch (error) { setStatus(`背景保存失敗: ${error.message}`, 'error'); return false; }
    }
    return true;
  }

  async function saveCurrent() {
    if (!state.draft || state.tab === 'validation') return false;
    try {
      const next = parseForm(); if (!(await saveEditedBackgrounds())) return false; const kind = state.tab === 'stages' ? 'stage' : (state.tab === 'sprites' ? 'project' : state.tab);
      const data = COLLECTION_TABS.includes(state.tab)
        ? upsertCollectionEntity(state.snapshot?.[state.tab], state.selectedId, next)
        : next;
      const result = await api.plugins.invokeHook(plugin.id, 'saveHorizontalStgDocument', { kind, id: state.tab === 'stages' ? state.selectedId : '', baseRevision: currentRevision(), data });
      if (!result?.ok) { const details = (result?.errors || []).map((entry) => `${entry.path}: ${entry.message}`).join('\n'); throw new Error(`${result?.error || '保存に失敗しました'}${details ? `\n${details}` : ''}`); }
      state.snapshot = result.snapshot;
      if (kind === 'stage') state.selectedId = result.id;
      else if (COLLECTION_TABS.includes(kind)) state.selectedId = next.id;
      setDirty(false); selectDefault(); render(); setStatus('保存しました', 'ok'); return true;
    } catch (error) { setStatus(error.message, 'error'); return false; }
  }

  async function validate() { setStatus('検証中…'); if (state.dirty && !(await saveCurrent())) return; const result = await api.plugins.invokeHook(plugin.id, 'validateHorizontalStgProject', {}); state.validation = result; setStatus(result?.ok ? `検証成功: ${result.warnings?.length || 0} warning` : `検証失敗: ${result?.errors?.length || 1} error`, result?.ok ? 'ok' : 'error'); if (state.tab === 'validation') render(); }
  async function exportData() { if (state.dirty && !(await saveCurrent())) return; setStatus('SGDKデータを生成中…'); const result = await api.plugins.invokeHook(plugin.id, 'exportHorizontalStgData', {}); setStatus(result?.ok ? `${result.generated_files?.length || 0}ファイルを生成しました` : (result?.error || '生成に失敗しました'), result?.ok ? 'ok' : 'error'); }

  function runGuard(action) { if (!state.dirty) return action(); state.pendingAction = action; guard.open(); return undefined; }
  function discardDraft() { setDirty(false); state.backgroundLayers = { a: null, b: null }; state.imageCache.clear(); selectDefault(); }
  function switchTab(tab) { runGuard(() => { stopAudio(); state.tab = tab; state.selectedId = ''; state.selectedEventIndex = -1; state.playhead = 0; setDirty(false); selectDefault(); render(); }); }
  function selectEntity(id) { runGuard(() => { stopAudio(); state.selectedId = id; state.selectedEventIndex = -1; state.playhead = 0; state.backgroundLayers = { a: null, b: null }; setDirty(false); selectDefault(); render(); }); }

  function addEntity() {
    runGuard(() => {
      const entries = currentEntries(); const base = state.tab === 'stages' ? 'stage' : state.tab.slice(0, -1); let ordinal = entries.length + 1; let id = `${base}-${String(ordinal).padStart(2, '0')}`; while (entries.some((entry) => entry.id === id)) id = `${base}-${String(++ordinal).padStart(2, '0')}`; state.selectedId = id;
      if (state.tab === 'stages') state.draft = { id, name: `Stage ${ordinal}`, length_px: 4096, scroll_speed_256: 256, parallax_shift_b: 1, assets: { bg_a: '', bg_b: '' }, music_id: '', midboss_id: '', boss_id: '', events: [] };
      else if (state.tab === 'enemies') state.draft = { id, name: id, hp: 3, score: 100, vx256: -256, vy256: 0, behavior: 'straight', fire_pattern: 'none', fire_interval: 120, sprite: '' };
      else if (state.tab === 'bosses') state.draft = { id, name: id, entry_x: 344, active_x: 264, y: 112, entry_vx256: -256, part_hp: [24, 24, 70], fire_interval: 90, death_frames: 120, bomb_damage: 3, movement: 'stationary', fire_pattern: 'aimed', forms: 1, sprite: '' };
      else if (state.tab === 'weapons') state.draft = { id, name: id, color: 'red', pattern: 'burst_laser', levels: [{ damage: 1, speed256: 1024 }, { damage: 2, speed256: 1152 }, { damage: 3, speed256: 1280 }] };
      else if (state.tab === 'items') state.draft = { id, name: id, duplicate_score: 500 }; else if (state.tab === 'effects') state.draft = { id, name: id, frames: 4, frame_time: 4 }; else if (state.tab === 'audio') state.draft = { id, name: id, type: 'XGM2', path: '', loop: true }; else state.draft = { id, name: id };
      setDirty(true); render();
    });
  }

  async function deleteEntity(id) { if (!id) return; const kind = state.tab === 'stages' ? 'stage' : state.tab; const result = await api.plugins.invokeHook(plugin.id, 'deleteHorizontalStgEntity', { kind, id, baseRevision: currentRevision() }); if (!result?.ok) { setStatus(result?.error || '削除に失敗しました', 'error'); return; } state.snapshot = result.snapshot; state.selectedId = ''; setDirty(false); selectDefault(); render(); setStatus(`${id} を削除しました (.deletedへ退避)`, 'ok'); }
  async function moveStage(id, direction) { const ids = currentEntries().map((entry) => entry.id); const index = ids.indexOf(id); const next = direction === 'up' ? index - 1 : index + 1; if (index < 0 || next < 0 || next >= ids.length) return; [ids[index], ids[next]] = [ids[next], ids[index]]; const result = await api.plugins.invokeHook(plugin.id, 'reorderHorizontalStgStages', { ids, baseRevision: state.snapshot.revisions.project }); if (!result?.ok) { setStatus(result?.error || '並び替えに失敗しました', 'error'); return; } await reload(); }

  function addEvent(command) { if (state.tab !== 'stages' || !state.draft) return; const index = state.draft.events.length; const payload = command === 'spawn_enemy' ? { enemy_id: state.snapshot.enemies?.[0]?.id || '', x: 336, y: 112 } : command === 'spawn_item' ? { item_id: state.snapshot.items?.[0]?.id || '', x: 300, y: 112 } : { boss_id: state.snapshot.bosses?.[0]?.id || '' }; state.draft.events.push({ id: `${state.draft.id}-event-${index + 1}`, trigger: { type: 'scroll', at: Math.round(state.playhead) }, order: index, command, payload }); state.selectedEventIndex = index; setDirty(true); renderForm(); renderPreview(); }
  function deleteEvent(index) { state.draft.events.splice(index, 1); state.selectedEventIndex = Math.min(state.selectedEventIndex, state.draft.events.length - 1); setDirty(true); renderForm(); renderPreview(); }
  function sortEvents() { state.draft.events.sort((a, b) => Number(a.trigger?.at) - Number(b.trigger?.at) || Number(a.order) - Number(b.order)); state.draft.events.forEach((entry, index) => { entry.order = index; }); state.selectedEventIndex = -1; setDirty(true); renderForm(); renderPreview(); }
  function selectEvent(index) { state.selectedEventIndex = index; state.playhead = Number(state.draft?.events?.[index]?.trigger?.at || 0); renderForm(); renderPreview(); }
  function placeEvent(event) { if (state.selectedEventIndex < 0 || !state.draft) return; const rect = elements.timeline.querySelector('.hstg-timeline-track')?.getBoundingClientRect(); if (!rect?.width) return; const at = Math.round((clamp((event.clientX - rect.left) / rect.width, 0, 1) * Number(state.draft.length_px || 1)) / 8) * 8; state.draft.events[state.selectedEventIndex].trigger.at = at; state.playhead = at; setDirty(true); renderForm(); renderPreview(); }

  async function importImage(kind, button) {
    if (!state.draft) return; const picked = await api.electronAPI.pickFile({ title: 'PNG / BMP画像を選択', properties: ['openFile'], filters: [{ name: 'PNG / BMP', extensions: ['png', 'bmp'] }] }); if (picked?.canceled || !picked?.sourcePath) return;
    const pipeline = api.capabilities.get('image-import-pipeline') || await api.capabilities.require?.('image-import-pipeline', 1200); if (!pipeline?.convertToIndexed16) { setStatus('画像import pipelineが無効です', 'error'); return; }
    const width = Number(button?.dataset.targetWidth) || undefined; const height = Number(button?.dataset.targetHeight) || undefined; setStatus('画像を8bit indexed / 16色へ変換中…'); const converted = await pipeline.convertToIndexed16({ sourcePath: picked.sourcePath, targetSize: width && height ? { width, height } : undefined }); if (converted?.canceled) { setStatus(converted.warning || '画像変換をキャンセルしました'); return; }
    let relativePath;
    if (kind === 'stage-a' || kind === 'stage-b') { const key = kind.endsWith('a') ? 'bg_a' : 'bg_b'; relativePath = state.draft.assets?.[key] || `gfx/${safeFileName(state.draft.id, 'stage')}_${key}.png`; }
    else if (kind.startsWith('system:')) { const meta = SYSTEM_ASSET_BY_ID.get(kind.slice(7)); relativePath = projectAssets(state.draft)[meta.id] || meta.path; }
    else { const folder = state.tab === 'bosses' ? 'bosses' : 'enemies'; relativePath = state.draft.sprite || `gfx/${folder}/${safeFileName(state.draft.id, folder.slice(0, -1))}.png`; }
    const parts = pathParts(relativePath, `${safeFileName(state.draft.id)}.png`); const targetFileName = parts.fileName.replace(/\.[^.]+$/, '.png'); const written = await api.electronAPI.writeAssetFile({ sourcePath: picked.sourcePath, targetSubdir: parts.subdir, targetFileName, dataUrl: converted.convertedDataUrl || converted.originalDataUrl || '' }); if (!written?.ok) { setStatus(written?.error || '画像を保存できません', 'error'); return; }
    relativePath = String(written.relativePath || `${parts.subdir}/${targetFileName}`).replace(/\\/g, '/');
    if (kind === 'stage-a' || kind === 'stage-b') { const key = kind.endsWith('a') ? 'bg_a' : 'bg_b'; state.draft.assets = { ...(state.draft.assets || {}), [key]: relativePath }; state.backgroundLayers[kind.endsWith('a') ? 'a' : 'b'] = null; }
    else if (kind.startsWith('system:')) state.draft.assets = { ...projectAssets(state.draft), [kind.slice(7)]: relativePath }; else state.draft.sprite = relativePath;
    state.imageCache.delete(relativePath); setDirty(true); render(); setStatus(`${relativePath} を取り込みました`, 'ok');
  }

  async function importAudio() { if (state.tab !== 'audio' || !state.draft) return; const picked = await api.electronAPI.pickFile({ title: 'VGM / XGM / WAVを選択', properties: ['openFile'], filters: [{ name: 'Mega Drive audio', extensions: ['vgm', 'xgm', 'wav'] }] }); if (picked?.canceled || !picked?.sourcePath) return; const ext = String(picked.fileName || picked.sourcePath).toLowerCase().match(/\.(vgm|xgm|wav)$/)?.[1] || 'vgm'; const name = `${safeFileName(state.draft.id, 'music')}.${ext}`; const written = await api.electronAPI.writeAssetFile({ sourcePath: picked.sourcePath, targetSubdir: 'music', targetFileName: name, dataUrl: '' }); if (!written?.ok) { setStatus(written?.error || '音声を保存できません', 'error'); return; } state.draft.path = String(written.relativePath || `music/${name}`).replace(/\\/g, '/'); state.draft.type = ext === 'wav' ? 'WAV' : 'XGM2'; setDirty(true); renderForm(); renderPreview(); setStatus(`${state.draft.path} を取り込みました`, 'ok'); }
  async function playAudio() { stopAudio(); if (!state.draft?.path || !String(state.draft.path).toLowerCase().endsWith('.vgm')) { setStatus('BGMプレビューはVGMソースを選択してください', 'error'); return; } const player = api.capabilities.get('vgm-preview-player') || await api.capabilities.require?.('vgm-preview-player', 1200); if (!player) { setStatus('VGM preview playerが無効です', 'error'); return; } const read = await api.electronAPI.readFileAsDataUrl(`${await getProjectDir()}/res/${state.draft.path}`); if (!read?.ok) { setStatus(read?.error || 'VGMを読めません', 'error'); return; } const loaded = player.load({ dataUrl: read.dataUrl }); if (!loaded?.ok) { setStatus(loaded?.error || 'VGM解析に失敗しました', 'error'); return; } state.audioPlayer = player; const result = await player.play({ onTime: (seconds) => { state.audioTime = seconds; const label = elements.form.querySelector('[data-role="audio-position"]'); if (label) label.textContent = `${seconds.toFixed(1)} sec`; renderPreview(); }, onEnded: () => { state.audioTime = 0; renderPreview(); } }); setStatus(result?.ok ? `BGM再生: ${Number(result.durationSec || 0).toFixed(1)}秒` : (result?.error || '再生失敗'), result?.ok ? 'ok' : 'error'); }
  function stopAudio() { state.audioPlayer?.stop?.(); state.audioPlayer = null; state.audioTime = 0; }

  function openPage(page) { const result = api.pages?.open?.(page); if (!result?.ok) setStatus(`${page}ページを開けません。pluginが有効か確認してください。`, 'error'); }
  function openSystemAsset(id) { runGuard(() => { state.tab = 'sprites'; state.selectedId = id; setDirty(false); selectDefault(); render(); }); }
  function activateTileLayer(layer) { state.tileLayer = layer; state.selectedTileIndex = 0; renderTilePalette(); elements.tileTools.scrollIntoView({ block: 'nearest' }); }

  function previewPoint(event) { const rect = elements.preview.getBoundingClientRect(); return { x: clamp(Math.floor((event.clientX - rect.left) / rect.width * 320), 0, 319), y: clamp(Math.floor((event.clientY - rect.top) / rect.height * 224), 0, 223) }; }
  function editBackgroundAt(event) {
    if (state.tab !== 'stages') return; const layer = state.backgroundLayers[state.tileLayer]; if (!layer?.canvas || !layer.tiles.length) return; const point = previewPoint(event); const shift = state.tileLayer === 'b' ? Number(state.draft.parallax_shift_b || 0) : 0; const sourceX = backgroundSourceX(state.playhead, layer.canvas.width, 320, shift) + point.x; const x = clamp(Math.floor(sourceX / 8) * 8, 0, layer.canvas.width - 8); const y = clamp(Math.floor(point.y / 8) * 8, 0, layer.canvas.height - 8); const current = layer.context.getImageData(x, y, 8, 8);
    if (state.tileTool === 'eyedropper') { const index = layer.tiles.findIndex((tile) => tile.data.every((value, offset) => value === current.data[offset])); if (index >= 0) state.selectedTileIndex = index; state.tileTool = 'stamp'; renderTilePalette(); return; }
    const tile = layer.tiles[state.selectedTileIndex]; if (!tile) return; const image = layer.context.createImageData(8, 8); image.data.set(tile.data); layer.undo.push({ x, y, image: current }); if (layer.undo.length > 64) layer.undo.shift(); layer.context.putImageData(image, x, y); layer.dirty = true; setDirty(true); renderPreview(); renderTilePalette();
  }
  function undoTile() { const layer = state.backgroundLayers[state.tileLayer]; const entry = layer?.undo.pop(); if (!entry) return; layer.context.putImageData(entry.image, entry.x, entry.y); layer.dirty = true; setDirty(true); renderPreview(); renderTilePalette(); }
  async function saveTilesOnly() { if (!(await saveEditedBackgrounds())) return; renderTilePalette(); await validate(); }

  function togglePreview() { state.previewPlaying = !state.previewPlaying; state.lastFrameTime = performance.now(); if (state.previewPlaying) requestAnimationFrame(tickPreview); renderPreview(); }
  function tickPreview(now) { if (!state.previewPlaying) return; const delta = Math.min(.1, Math.max(0, (now - state.lastFrameTime) / 1000)); state.lastFrameTime = now; if (state.tab === 'stages' && state.draft) { state.playhead += Number(state.draft.scroll_speed_256 || 256) / 256 * 60 * delta; const max = Math.max(0, Number(state.draft.length_px || 320) - 1); if (state.playhead >= max) { state.playhead = max; state.previewPlaying = false; } } renderPreview(); if (state.previewPlaying) requestAnimationFrame(tickPreview); }

  function onInput(event) { if (!state.draft) return; try { const old = state.tab === 'stages' ? { ...state.draft.assets } : null; state.draft = parseForm(); setDirty(true); if (state.tab === 'stages' && (old?.bg_a !== state.draft.assets.bg_a || old?.bg_b !== state.draft.assets.bg_b)) { state.backgroundLayers = { a: null, b: null }; void refreshPreviewAssets(); } else if (['sprites', 'enemies', 'bosses'].includes(state.tab) && /asset_path|sprite/.test(event.target?.name || '')) void refreshPreviewAssets(); renderPreview(); } catch (_error) { setDirty(true); } }
  function onChange(event) { if (event.target.matches('[data-event-field="command"]')) { try { state.draft = parseForm(); setDirty(true); renderForm(); renderPreview(); } catch (_) {} } }

  function onClick(event) {
    const button = event.target.closest('button'); if (!button || !root.contains(button)) return; if (button.dataset.tab) { switchTab(button.dataset.tab); return; } const action = button.dataset.action;
    if (action === 'reload') runGuard(reload); else if (action === 'validate') validate(); else if (action === 'export') exportData(); else if (action === 'add') addEntity(); else if (action === 'select') selectEntity(button.dataset.id); else if (action === 'save') saveCurrent(); else if (action === 'delete') runGuard(() => deleteEntity(button.dataset.id)); else if (action === 'move-up') runGuard(() => moveStage(button.dataset.id, 'up')); else if (action === 'move-down') runGuard(() => moveStage(button.dataset.id, 'down'));
    else if (action === 'add-event') addEvent(button.dataset.command); else if (action === 'delete-event') deleteEvent(Number(button.dataset.eventIndex)); else if (action === 'select-event') selectEvent(Number(button.dataset.eventIndex)); else if (action === 'sort-events') sortEvents(); else if (action === 'import-image') importImage(button.dataset.imageKind, button); else if (action === 'import-audio') importAudio(); else if (action === 'audio-play') playAudio(); else if (action === 'audio-stop') { stopAudio(); renderPreview(); }
    else if (action === 'open-page') openPage(button.dataset.page); else if (action === 'open-system-asset') openSystemAsset(button.dataset.assetId); else if (action === 'activate-tile-layer') activateTileLayer(button.dataset.layer); else if (action === 'tile-stamp') { state.tileTool = 'stamp'; renderTilePalette(); } else if (action === 'tile-eyedropper') { state.tileTool = 'eyedropper'; renderTilePalette(); } else if (action === 'tile-undo') undoTile(); else if (action === 'tile-save') saveTilesOnly(); else if (action === 'select-tile') { state.selectedTileIndex = Number(button.dataset.tileIndex); state.tileTool = 'stamp'; renderTilePalette(); } else if (action === 'preview-play') togglePreview(); else if (action === 'preview-rewind') { state.playhead = 0; renderPreview(); }
  }

  async function onGuardClick(event) { const choice = event.target.closest('[data-choice]')?.dataset.choice; if (!choice) return; if (choice === 'cancel') { state.pendingAction = null; guard.close(); return; } if (choice === 'save' && !(await saveCurrent())) return; if (choice === 'discard') discardDraft(); const action = state.pendingAction; state.pendingAction = null; guard.close(); action?.(); }

  root.addEventListener('click', onClick); elements.form.addEventListener('input', onInput); elements.form.addEventListener('change', onChange); elements.form.addEventListener('submit', (event) => { event.preventDefault(); saveCurrent(); }); elements.preview.addEventListener('click', editBackgroundAt);
  elements.playhead.addEventListener('input', () => { state.playhead = Number(elements.playhead.value); renderPreview(); }); elements.previewZoom.addEventListener('change', () => { elements.screenShell.dataset.zoom = elements.previewZoom.value; }); elements.tileLayer.addEventListener('change', () => { state.tileLayer = elements.tileLayer.value; state.selectedTileIndex = 0; renderTilePalette(); renderPreview(); }); elements.timeline.addEventListener('click', (event) => { if (!event.target.closest('[data-action="select-event"]') && event.target.closest('[data-action="place-event"]')) placeEvent(event); }); guard.panel?.addEventListener('click', onGuardClick);

  const observer = new MutationObserver(() => { const active = root.classList.contains('active'); if (active && !state.wasActive && !state.loading) runGuard(reload); state.wasActive = active; }); observer.observe(root, { attributes: true, attributeFilter: ['class'] });

  registerCapability('horizontal-stg-editor', {
    root, refresh: reload, requestSave: saveCurrent,
    getDirtyState: () => ({ dirty: state.dirty, tab: state.tab, id: state.selectedId, backgroundDirty: Object.values(state.backgroundLayers).some((layer) => layer?.dirty) }),
    openEntity(kind, id) { const tab = kind === 'stage' ? 'stages' : kind; if (![...ENTITY_TABS, 'sprites'].includes(tab)) return false; runGuard(() => { state.tab = tab; state.selectedId = id; setDirty(false); selectDefault(); render(); }); return true; },
    setPlayhead(value) { state.playhead = Number(value) || 0; renderPreview(); },
  });

  elements.screenShell.dataset.zoom = elements.previewZoom.value; reload();
  return { deactivate() { observer.disconnect(); state.previewPlaying = false; stopAudio(); root.removeEventListener('click', onClick); elements.form.removeEventListener('input', onInput); elements.form.removeEventListener('change', onChange); elements.preview.removeEventListener('click', editBackgroundAt); guard.panel?.removeEventListener('click', onGuardClick); guard.destroy(); root.innerHTML = ''; } };
}
