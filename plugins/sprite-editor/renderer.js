import {
  computeFrameGrid,
  deriveRowFrameCounts,
  formatSpriteTileToken,
  getActiveFrameCountForRow,
  normalizeSymbolName,
  parseSpriteSizeToken,
  parseSpriteTime,
  resizeSpriteTimeRow,
  snapSpritePixels,
  updateSpriteTimeCell,
} from './sprite-utils.mjs';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'bmp'] },
  { name: 'All Files', extensions: ['*'] },
];

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  if (!root) return null;

  const state = {
    allFiles: [],
    files: [],
    selectedKey: '',
    expandedFiles: new Set(),
    fileFilter: '',
    keyword: '',
    frameRow: 0,
    frameIndex: 0,
    previewScale: 4,
    sheetScale: 1,
    showGrid: true,
    loop: true,
    playing: false,
    image: null,
    imageDataUrl: '',
    imagePath: '',
    grid: computeFrameGrid(16, 16, '16p', '16p'),
    playbackTimer: 0,
    splitterDrag: null,
    columnResizeStart: null,
    dirty: false,
    wasActive: root.classList.contains('active'),
  };

  root.innerHTML = buildShell();
  const ui = bindUi(root);

  registerCapability('sprite-editor', {
    pluginId: plugin.id,
    root,
    refresh,
    getSelectedSprite: () => getSelectedSprite(),
  });

  bindEvents();
  observePageActivation();
  void refresh();

  logger.debug('sprite-editor renderer activated');
  return {
    deactivate() {
      stopPlayback();
      root.innerHTML = '';
    },
  };

  function bindEvents() {
    ui.add.addEventListener('click', async () => {
      if (await confirmCanReplaceCurrentSprite()) void addSprite();
    });
    ui.fileFilter.addEventListener('change', () => {
      state.fileFilter = ui.fileFilter.value;
      renderTree();
    });
    ui.keyword.addEventListener('input', () => {
      state.keyword = ui.keyword.value.trim().toLowerCase();
      renderTree();
    });
    ui.tree.addEventListener('click', (event) => {
      const fileButton = event.target.closest('[data-file-toggle]');
      if (fileButton) {
        const file = fileButton.dataset.fileToggle;
        if (state.expandedFiles.has(file)) state.expandedFiles.delete(file);
        else state.expandedFiles.add(file);
        renderTree();
        return;
      }
      const action = event.target.closest('[data-sprite-action]');
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.dataset.spriteAction === 'save') void saveProperties();
        if (action.dataset.spriteAction === 'delete') void deleteSelectedSprite();
        return;
      }
      const item = event.target.closest('[data-sprite-key]');
      if (item) {
        void requestSelectSprite(item.dataset.spriteKey);
      }
    });

    ui.previewScale.addEventListener('input', () => {
      state.previewScale = normalizeZoom(ui.previewScale.value, 4, 12);
      ui.previewScale.value = formatZoom(state.previewScale);
      drawPreview();
    });
    ui.previewWrap.addEventListener('wheel', (event) => {
      updateZoomFromWheel(event, 'preview');
    }, { passive: false });
    ui.sheetScale.addEventListener('input', () => {
      state.sheetScale = normalizeZoom(ui.sheetScale.value, 1, 8);
      ui.sheetScale.value = formatZoom(state.sheetScale);
      drawSheet();
    });
    ui.sheetWrap.addEventListener('wheel', (event) => {
      updateZoomFromWheel(event, 'sheet');
    }, { passive: false });
    ui.splitter.addEventListener('pointerdown', (event) => {
      startSplitterDrag(event);
    });
    const startColumnResize = (event, edge) => {
      ui.rootShell.setPointerCapture(event.pointerId);
      state.columnResizeStart = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        leftWidth: ui.leftPane.getBoundingClientRect().width,
        rightWidth: ui.propsPane.getBoundingClientRect().width,
        shellWidth: ui.rootShell.getBoundingClientRect().width,
      };
      event.target.classList.add('active');
    };
    ui.leftColumnResizer.addEventListener('pointerdown', (event) => startColumnResize(event, 'left'));
    ui.rightColumnResizer.addEventListener('pointerdown', (event) => startColumnResize(event, 'right'));
    ui.rootShell.addEventListener('pointermove', (event) => resizeColumns(event));
    ui.rootShell.addEventListener('pointerup', (event) => stopColumnResize(event));
    ui.rootShell.addEventListener('pointercancel', (event) => stopColumnResize(event));
    ui.gridToggle.addEventListener('change', () => {
      state.showGrid = ui.gridToggle.checked;
      drawPreview();
      drawSheet();
    });
    ui.first.addEventListener('click', () => {
      state.frameIndex = 0;
      syncFrameControls();
      drawPreview();
    });
    ui.last.addEventListener('click', () => {
      state.frameIndex = Math.max(0, getActiveFrameCount() - 1);
      syncFrameControls();
      drawPreview();
    });
    ui.play.addEventListener('click', () => {
      if (state.playing) stopPlayback();
      else startPlayback();
    });
    ui.loop.addEventListener('click', () => {
      state.loop = !state.loop;
      syncPlaybackButtons();
    });
    ui.rowInput.addEventListener('change', () => {
      state.frameRow = numberInRange(ui.rowInput.value, 0, Math.max(0, state.grid.rows - 1), 0);
      state.frameIndex = numberInRange(state.frameIndex, 0, Math.max(0, state.grid.columns - 1), 0);
      syncFrameControls();
      drawPreview();
    });
    ui.frameInput.addEventListener('change', () => {
      state.frameIndex = numberInRange(ui.frameInput.value, 0, Math.max(0, state.grid.columns - 1), 0);
      syncFrameControls();
      drawPreview();
    });
    ui.frameTime.addEventListener('change', () => void saveFrameTime());
    ui.time.addEventListener('change', () => {
      syncFrameControls();
      drawPreview();
      drawSheet();
    });
    ui.form.addEventListener('input', (event) => {
      if (event.target.closest('input, textarea')) markDirty();
    });
    ui.form.addEventListener('change', (event) => {
      if (event.target.closest('input, select, textarea')) markDirty();
    });
    ui.rowList.addEventListener('change', (event) => {
      const frameInput = event.target.closest('[data-row-frame-count]');
      if (frameInput) {
        void saveRowFrameCount(frameInput);
        return;
      }
      const fillInput = event.target.closest('[data-row-default-time]');
      if (fillInput) {
        void applyRowDefaultTime(fillInput, { persist: true });
      }
    });
    ui.rowList.addEventListener('input', (event) => {
      const fillInput = event.target.closest('[data-row-default-time]');
      if (fillInput) applyRowDefaultTime(fillInput, { persist: false });
    });
    ui.rowList.addEventListener('click', (event) => {
      const rowButton = event.target.closest('[data-row-select]');
      if (!rowButton) return;
      state.frameRow = numberInRange(rowButton.dataset.rowSelect, 0, Math.max(0, state.grid.rows - 1), 0);
      state.frameIndex = numberInRange(state.frameIndex, 0, getActiveFrameCount() - 1, 0);
      syncFrameControls();
      drawPreview();
      drawSheet();
    });
    ui.collision.addEventListener('change', () => {
      drawPreview();
    });
    ui.frameWidth.addEventListener('change', () => {
      ui.frameWidth.value = String(snapSpritePixels(ui.frameWidth.value));
      markDirty();
      updateGridFromInputs();
    });
    ui.frameHeight.addEventListener('change', () => {
      ui.frameHeight.value = String(snapSpritePixels(ui.frameHeight.value));
      markDirty();
      updateGridFromInputs();
    });
    ui.sheetCanvas.addEventListener('click', (event) => {
      selectFrameFromSheet(event);
    });
  }

  function observePageActivation() {
    const observer = new MutationObserver(() => {
      const active = root.classList.contains('active');
      if (active && !state.wasActive) void refresh({ preserveDirty: state.dirty });
      state.wasActive = active;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  async function refresh(options = {}) {
    stopPlayback();
    setStatus('SPRITE 定義を読み込み中...');
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok) {
      setStatus(`読み込み失敗: ${result?.error || 'unknown'}`);
      return;
    }
    state.allFiles = result.files || [];
    state.files = state.allFiles.map((file) => ({
      ...file,
      entries: (file.entries || []).filter((entry) => String(entry.type || '').toUpperCase() === 'SPRITE'),
    }));
    state.files.forEach((file) => state.expandedFiles.add(file.file));
    if (!state.selectedKey || !findSpriteByKey(state.selectedKey)) {
      const first = state.files.flatMap((file) => file.entries.map((entry) => spriteKey(file.file, entry)))[0] || '';
      state.selectedKey = first;
    }
    renderFileFilter();
    renderTree();
    if (options.preserveDirty && state.dirty && state.selectedKey && findSpriteByKey(state.selectedKey)) {
      renderTree();
    } else {
      await selectSprite(state.selectedKey, { keepTree: true });
    }
    setStatus(`SPRITE ${countSprites()} 件`);
  }

  async function requestSelectSprite(key) {
    if (!key || key === state.selectedKey || !state.dirty) {
      await selectSprite(key);
      return true;
    }
    const ok = await confirmCanReplaceCurrentSprite();
    if (!ok) {
      renderTree();
      return false;
    }
    await selectSprite(key);
    return true;
  }

  async function selectSprite(key, options = {}) {
    state.selectedKey = key || '';
    state.dirty = false;
    if (!options.keepTree) renderTree();
    const selected = getSelectedSprite();
    renderProperties(selected);
    stopPlayback();
    state.frameRow = 0;
    state.frameIndex = 0;
    state.image = null;
    state.imageDataUrl = '';
    state.imagePath = '';
    if (!selected) {
      state.grid = computeFrameGrid(16, 16, '16p', '16p');
      drawPreview();
      drawSheet();
      return;
    }
    await loadSelectedImage(selected.entry);
    syncFrameControls();
    drawPreview();
    drawSheet();
  }

  async function loadSelectedImage(entry) {
    const widthToken = entry.width || '16p';
    const heightToken = entry.height || '16p';
    state.imagePath = entry.sourceAbsolutePath || '';
    if (!entry.sourceAbsolutePath) {
      state.grid = computeFrameGrid(16, 16, widthToken, heightToken);
      return;
    }
    const read = await api.electronAPI.readFileAsDataUrl(entry.sourceAbsolutePath);
    if (!read?.ok || !read.dataUrl) {
      setStatus(`画像読み込み失敗: ${read?.error || 'unknown'}`);
      state.grid = computeFrameGrid(16, 16, widthToken, heightToken);
      return;
    }
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode();
    state.image = img;
    state.imageDataUrl = read.dataUrl;
    state.grid = computeFrameGrid(img.naturalWidth, img.naturalHeight, widthToken, heightToken);
    ui.frameWidth.value = String(state.grid.width);
    ui.frameHeight.value = String(state.grid.height);
  }

  function renderFileFilter() {
    const current = state.fileFilter;
    ui.fileFilter.innerHTML = [
      '<option value="">すべて</option>',
      ...state.files.map((file) => `<option value="${esc(file.file)}">${esc(file.file)}</option>`),
    ].join('');
    ui.fileFilter.value = state.files.some((file) => file.file === current) ? current : '';
    state.fileFilter = ui.fileFilter.value;
  }

  function renderTree() {
    const keyword = state.keyword;
    const selectedKey = state.selectedKey;
    const files = state.files
      .filter((file) => !state.fileFilter || file.file === state.fileFilter)
      .map((file) => ({
        ...file,
        entries: file.entries.filter((entry) => !keyword || String(entry.name || '').toLowerCase().includes(keyword)),
      }));

    if (!files.length || files.every((file) => file.entries.length === 0)) {
      ui.tree.innerHTML = '<div class="sprite-editor-empty">SPRITE 定義がありません</div>';
      return;
    }

    ui.tree.innerHTML = files.map((file) => {
      const expanded = state.expandedFiles.has(file.file);
      const children = expanded ? file.entries.map((entry) => {
        const key = spriteKey(file.file, entry);
        const active = key === selectedKey;
        return `
          <div class="sprite-editor-item ${active ? 'active' : ''}" role="button" tabindex="0" data-sprite-key="${esc(key)}">
            <canvas class="sprite-editor-thumb" width="48" height="40" data-thumb-key="${esc(key)}"></canvas>
            <span>
              <span class="sprite-editor-item-title">${esc(entry.name)}${active && state.dirty ? ' *' : ''}</span>
              <span class="sprite-editor-item-meta">${esc(entry.width || '')} x ${esc(entry.height || '')}</span>
            </span>
            ${active ? `
              <span class="sprite-editor-list-actions">
                <button class="sprite-editor-list-icon sprite-editor-primary" type="button" data-sprite-action="save" title="保存" aria-label="保存"><svg class="icon"><use href="#icon-save"></use></svg></button>
                <button class="sprite-editor-list-icon sprite-editor-danger" type="button" data-sprite-action="delete" title="削除" aria-label="削除"><svg class="icon"><use href="#icon-trash"></use></svg></button>
              </span>
            ` : ''}
          </div>
        `;
      }).join('') : '';
      return `
        <section class="sprite-editor-file">
          <button class="sprite-editor-file-toggle" type="button" data-file-toggle="${esc(file.file)}">
            <span>${expanded ? '▾' : '▸'}</span>
            <span>${esc(file.file)}</span>
            <span class="sprite-editor-file-count">${file.entries.length}</span>
          </button>
          ${children}
        </section>
      `;
    }).join('');
    void renderThumbnails();
  }

  async function renderThumbnails() {
    const canvases = Array.from(ui.tree.querySelectorAll('[data-thumb-key]'));
    for (const canvas of canvases) {
      const item = findSpriteByKey(canvas.dataset.thumbKey);
      if (!item?.entry?.sourceAbsolutePath) continue;
      try {
        const read = await api.electronAPI.readFileAsDataUrl(item.entry.sourceAbsolutePath);
        if (!read?.ok || !read.dataUrl) continue;
        const img = new Image();
        img.src = read.dataUrl;
        await img.decode();
        const grid = computeFrameGrid(img.naturalWidth, img.naturalHeight, item.entry.width, item.entry.height);
        drawContainFrame(canvas, img, { x: 0, y: 0, width: grid.width, height: grid.height });
      } catch (err) {
        logger.warn(`サムネイル生成失敗: ${String(err?.message || err)}`);
      }
    }
  }

  function renderProperties(selected) {
    const entry = selected?.entry;
    ui.propsDisabled.hidden = Boolean(entry);
    ui.form.hidden = !entry;
    if (!entry) return;

    ui.name.value = entry.name || '';
    ui.sourcePath.value = entry.sourcePath || '';
    ui.frameWidth.value = String(parseSpriteSizeToken(entry.width || '16p', state.image?.naturalWidth || 0).pixels);
    ui.frameHeight.value = String(parseSpriteSizeToken(entry.height || '16p', state.image?.naturalHeight || 0).pixels);
    ui.compression.value = normalizeOption(entry.compression, ['NONE', 'BEST', 'AUTO', 'APLIB', 'FAST', 'LZ4W'], 'NONE');
    ui.time.value = entry.time || '0';
    ui.collision.value = normalizeOption(entry.collision, ['NONE', 'CIRCLE', 'BOX'], 'NONE');
    ui.optType.value = normalizeOption(entry.optType, ['BALANCED', 'SPRITE', 'TILE', 'NONE'], 'BALANCED');
    ui.optLevel.value = normalizeOption(entry.optLevel, ['FAST', 'MEDIUM', 'SLOW', 'MAX'], 'FAST');
    ui.optDuplicate.value = normalizeOption(entry.optDuplicate, ['FALSE', 'TRUE'], 'FALSE');
    ui.comment.value = entry.comment || '';
  }

  function syncFrameControls() {
    state.frameRow = numberInRange(state.frameRow, 0, Math.max(0, state.grid.rows - 1), 0);
    const activeFrames = getActiveFrameCount(state.frameRow);
    state.frameIndex = numberInRange(state.frameIndex, 0, Math.max(0, activeFrames - 1), 0);
    ui.rowInput.max = String(Math.max(0, state.grid.rows - 1));
    ui.frameInput.max = String(Math.max(0, activeFrames - 1));
    ui.rowInput.value = String(state.frameRow);
    ui.frameInput.value = String(state.frameIndex);
    const matrix = parseSpriteTime(getTimeValue(), state.grid.rows, state.grid.columns);
    ui.frameTime.value = matrix[state.frameRow]?.[state.frameIndex] || '0';
    const counts = getRowFrameCounts();
    ui.frameInfo.textContent = `${counts.join('/')} active frames x ${state.grid.rows} rows`;
    renderAnimationRows(counts);
    syncPlaybackButtons();
  }

  function syncPlaybackButtons() {
    ui.play.textContent = state.playing ? '⏸' : '▶';
    ui.loop.setAttribute('aria-pressed', String(state.loop));
    ui.loop.classList.toggle('sprite-editor-primary', state.loop);
  }

  function drawPreview() {
    const canvas = ui.previewCanvas;
    const ctx = canvas.getContext('2d');
    const frame = getCurrentFrame();
    const scale = state.previewScale;
    canvas.width = Math.max(1, frame.width * scale);
    canvas.height = Math.max(1, frame.height * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.image) {
      ctx.drawImage(state.image, frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
    }
    drawCollisionOverlay(ctx, frame.width, frame.height, scale);
    if (state.showGrid) drawGrid(ctx, canvas.width, canvas.height, 8 * scale);
  }

  function drawCollisionOverlay(ctx, frameWidth, frameHeight, scale) {
    const collision = normalizeOption(ui.collision?.value, ['NONE', 'CIRCLE', 'BOX'], 'NONE');
    if (collision === 'NONE') return;
    const width = frameWidth * 0.75 * scale;
    const height = frameHeight * 0.75 * scale;
    const x = ((frameWidth * scale) - width) / 2;
    const y = ((frameHeight * scale) - height) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 82, 82, 0.16)';
    ctx.strokeStyle = 'rgba(255, 214, 102, 0.95)';
    ctx.lineWidth = Math.max(1, Math.floor(scale / 2));
    if (collision === 'CIRCLE') {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, width - 1), Math.max(1, height - 1));
    }
    ctx.restore();
  }

  function drawSheet() {
    const canvas = ui.sheetCanvas;
    const ctx = canvas.getContext('2d');
    const img = state.image;
    const scale = state.sheetScale;
    const width = img?.naturalWidth || state.grid.width;
    const height = img?.naturalHeight || state.grid.height;
    canvas.width = Math.max(1, width * scale);
    canvas.height = Math.max(1, height * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (state.showGrid) drawGrid(ctx, canvas.width, canvas.height, 8 * scale);
    drawFrameGrid(ctx, scale);
  }

  function drawFrameGrid(ctx, scale) {
    ctx.save();
    const counts = getRowFrameCounts();
    ctx.fillStyle = 'rgba(11, 15, 23, 0.58)';
    ctx.strokeStyle = 'rgba(255, 82, 82, 0.45)';
    ctx.lineWidth = 1;
    counts.forEach((count, row) => {
      if (count >= state.grid.columns) return;
      const x = count * state.grid.width * scale;
      const y = row * state.grid.height * scale;
      const width = (state.grid.columns - count) * state.grid.width * scale;
      const height = state.grid.height * scale;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, width - 1), Math.max(1, height - 1));
    });
    ctx.strokeStyle = 'rgba(74, 163, 255, 0.85)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= state.grid.columns; x += 1) {
      const px = x * state.grid.width * scale + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, ctx.canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= state.grid.rows; y += 1) {
      const py = y * state.grid.height * scale + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(ctx.canvas.width, py);
      ctx.stroke();
    }
    drawFrameTimeLabels(ctx, scale, counts);
    const frame = getCurrentFrame();
    ctx.strokeStyle = '#d2991e';
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x * scale + 1, frame.y * scale + 1, frame.width * scale - 2, frame.height * scale - 2);
    ctx.restore();
  }

  function drawFrameTimeLabels(ctx, scale, counts = getRowFrameCounts()) {
    const matrix = parseSpriteTime(getTimeValue(), state.grid.rows, state.grid.columns);
    const fontSize = Math.max(10, Math.min(24, Math.floor(10 * Math.max(1, scale))));
    const padX = Math.max(4, Math.floor(3 * Math.max(1, scale)));
    const padY = Math.max(2, Math.floor(2 * Math.max(1, scale)));
    ctx.save();
    ctx.font = `700 ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    counts.forEach((count, row) => {
      for (let frame = 0; frame < Math.min(count, state.grid.columns); frame += 1) {
        const label = String(matrix[row]?.[frame] ?? '0');
        const textWidth = Math.ceil(ctx.measureText(label).width);
        const x = frame * state.grid.width * scale + Math.max(2, state.grid.width * scale - textWidth - padX * 2 - 2);
        const y = row * state.grid.height * scale + 2;
        const boxWidth = textWidth + padX * 2;
        const boxHeight = fontSize + padY * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
        ctx.fillRect(x, y, boxWidth, boxHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + padX, y + padY);
      }
    });
    ctx.restore();
  }

  function drawGrid(ctx, width, height, step) {
    if (step < 4) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 152, 171, 0.35)';
    ctx.lineWidth = 1;
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  async function saveFrameTime() {
    const selected = getSelectedSprite();
    if (!selected) return;
    const nextTime = updateSpriteTimeCell(
      getTimeValue(),
      state.grid.rows,
      state.grid.columns,
      state.frameRow,
      state.frameIndex,
      ui.frameTime.value,
    );
    ui.time.value = nextTime;
    await saveProperties({ silent: true });
    syncFrameControls();
  }

  async function saveProperties(options = {}) {
    const selected = getSelectedSprite();
    if (!selected) return false;
    const frameWidth = snapSpritePixels(ui.frameWidth.value);
    const frameHeight = snapSpritePixels(ui.frameHeight.value);
    const entry = {
      ...selected.entry,
      name: normalizeSymbolName(ui.name.value),
      sourcePath: ui.sourcePath.value.trim(),
      width: formatSpriteTileToken(frameWidth),
      height: formatSpriteTileToken(frameHeight),
      compression: ui.compression.value,
      time: ui.time.value.trim() || '0',
      collision: ui.collision.value,
      optType: ui.optType.value,
      optLevel: ui.optLevel.value,
      optDuplicate: ui.optDuplicate.value,
      comment: ui.comment.value,
    };
    const result = await api.electronAPI.updateResEntry({
      file: selected.file.file,
      lineNumber: selected.entry.lineNumber,
      entry,
    });
    if (!result?.ok) {
      setStatus(`保存失敗: ${result?.error || 'unknown'}`);
      return false;
    }
    if (!options.silent) setStatus(`保存しました: ${entry.name}`);
    state.dirty = false;
    await refreshAfterSave(selected.file.file, selected.entry.lineNumber);
    return true;
  }

  async function refreshAfterSave(fileName, lineNumber) {
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok) return;
    state.allFiles = result.files || [];
    state.files = state.allFiles.map((file) => ({
      ...file,
      entries: (file.entries || []).filter((entry) => String(entry.type || '').toUpperCase() === 'SPRITE'),
    }));
    const file = state.files.find((item) => item.file === fileName);
    const entry = file?.entries.find((item) => Number(item.lineNumber) === Number(lineNumber));
    state.selectedKey = entry ? spriteKey(file.file, entry) : state.selectedKey;
    renderFileFilter();
    renderTree();
    renderProperties(getSelectedSprite());
    await loadSelectedImage(getSelectedSprite()?.entry || {});
    syncFrameControls();
    drawPreview();
    drawSheet();
  }

  async function deleteSelectedSprite() {
    const selected = getSelectedSprite();
    if (!selected) return;
    const ok = await confirmModal(`SPRITE 定義を削除しますか？<br><strong>${esc(selected.entry.name)}</strong>`, '削除');
    if (!ok) return;
    const result = await api.electronAPI.deleteResEntry({ file: selected.file.file, lineNumber: selected.entry.lineNumber });
    if (!result?.ok) {
      setStatus(`削除失敗: ${result?.error || 'unknown'}`);
      return;
    }
    state.selectedKey = '';
    await refresh();
    setStatus(`削除しました: ${selected.entry.name}`);
  }

  async function addSprite() {
    const resFiles = state.files.map((file) => file.file);
    if (!resFiles.length) {
      setStatus('追加先の .res ファイルがありません');
      return;
    }
    const picked = await api.electronAPI.pickFile({
      title: 'スプライトシートを選択',
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    });
    if (picked?.canceled || !picked?.sourcePath) return;

    const pickedName = getFileName(picked.sourcePath);
    const sourceSize = await readImageSize(picked.sourcePath);
    const request = await requestAddInfo({
      resFiles,
      defaultFile: state.fileFilter || getSelectedSprite()?.file?.file || resFiles[0],
      defaultSymbol: normalizeSymbolName(picked.fileName || pickedName),
      pickedName,
      sourceSize,
    });
    if (!request) return;

    const existing = state.allFiles.flatMap((file) => file.entries || []).some((entry) => entry.name === request.symbol);
    if (existing) {
      setStatus(`同名の SPRITE 定義があります: ${request.symbol}`);
      return;
    }

    const targetSize = {
      width: request.targetWidth,
      height: request.targetHeight,
    };
    const imagePipeline = api.capabilities.get('image-import-pipeline');
    if (!imagePipeline?.convertToIndexed16) {
      setStatus('画像リサイズ/減色コンバーターが無効または未インストールです');
      return;
    }
    const converted = await imagePipeline.convertToIndexed16({ sourcePath: picked.sourcePath, targetSize });
    if (converted?.canceled) return;
    const ext = converted.targetExtension || '.png';
    const copyResult = await api.electronAPI.writeAssetFile({
      sourcePath: picked.sourcePath,
      targetSubdir: 'sprite',
      targetFileName: `${request.symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!copyResult?.ok) {
      setStatus(`画像コピー失敗: ${copyResult?.error || 'unknown'}`);
      return;
    }
    const entry = {
      type: 'SPRITE',
      name: request.symbol,
      sourcePath: copyResult.relativePath,
      width: '16p',
      height: '16p',
      compression: 'NONE',
      time: '0',
      collision: 'NONE',
      optType: 'BALANCED',
      optLevel: 'FAST',
      optDuplicate: 'FALSE',
      comment: request.comment,
    };
    const added = await api.electronAPI.addResEntry({ file: request.file, entry });
    if (!added?.ok) {
      setStatus(`SPRITE 定義追加失敗: ${added?.error || 'unknown'}`);
      return;
    }
    await refresh();
    const file = state.files.find((item) => item.file === request.file);
    const created = file?.entries.find((item) => item.name === request.symbol);
    if (created) await selectSprite(spriteKey(file.file, created));
    setStatus(`追加しました: ${request.symbol}`);
  }

  function updateGridFromInputs() {
    const img = state.image;
    state.grid = computeFrameGrid(img?.naturalWidth || 16, img?.naturalHeight || 16, `${ui.frameWidth.value}p`, `${ui.frameHeight.value}p`);
    state.frameRow = 0;
    state.frameIndex = 0;
    syncFrameControls();
    drawPreview();
    drawSheet();
  }

  function selectFrameFromSheet(event) {
    const rect = ui.sheetCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / Math.max(1, rect.width) * ui.sheetCanvas.width / state.sheetScale);
    const y = Math.floor((event.clientY - rect.top) / Math.max(1, rect.height) * ui.sheetCanvas.height / state.sheetScale);
    state.frameRow = numberInRange(Math.floor(y / Math.max(1, state.grid.height)), 0, Math.max(0, state.grid.rows - 1), 0);
    const activeFrames = getActiveFrameCount(state.frameRow);
    state.frameIndex = numberInRange(Math.floor(x / Math.max(1, state.grid.width)), 0, Math.max(0, activeFrames - 1), 0);
    syncFrameControls();
    drawPreview();
    drawSheet();
    setStatus(`ROW ${state.frameRow} / Frame ${state.frameIndex} を選択しました`);
  }

  function startPlayback() {
    if (state.playing) return;
    state.playing = true;
    syncPlaybackButtons();
    scheduleNextFrame();
  }

  function stopPlayback() {
    state.playing = false;
    if (state.playbackTimer) window.clearTimeout(state.playbackTimer);
    state.playbackTimer = 0;
    syncPlaybackButtons();
  }

  function scheduleNextFrame() {
    if (!state.playing) return;
    const time = Number.parseInt(ui.frameTime.value || '0', 10) || 0;
    if (time <= 0) {
      stopPlayback();
      return;
    }
    state.playbackTimer = window.setTimeout(() => {
      const last = Math.max(0, getActiveFrameCount(state.frameRow) - 1);
      if (state.frameIndex >= last) {
        if (!state.loop) {
          stopPlayback();
          return;
        }
        state.frameIndex = 0;
      } else {
        state.frameIndex += 1;
      }
      syncFrameControls();
      drawPreview();
      scheduleNextFrame();
    }, time * (1000 / 60));
  }

  function getCurrentFrame() {
    return {
      x: state.frameIndex * state.grid.width,
      y: state.frameRow * state.grid.height,
      width: state.grid.width,
      height: state.grid.height,
    };
  }

  function getSelectedSprite() {
    return findSpriteByKey(state.selectedKey);
  }

  function findSpriteByKey(key) {
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (spriteKey(file.file, entry) === key) return { file, entry };
      }
    }
    return null;
  }

  function countSprites() {
    return state.files.reduce((sum, file) => sum + file.entries.length, 0);
  }

  function setStatus(message) {
    ui.status.textContent = message || '';
  }

  function getTimeValue() {
    return ui.time?.value?.trim() || getSelectedSprite()?.entry?.time || '0';
  }

  function getRowFrameCounts() {
    return deriveRowFrameCounts(getTimeValue(), state.grid.rows, state.grid.columns);
  }

  function getActiveFrameCount(rowIndex = state.frameRow) {
    return getActiveFrameCountForRow(getTimeValue(), state.grid.rows, state.grid.columns, rowIndex);
  }

  function renderAnimationRows(counts = getRowFrameCounts()) {
    const matrix = parseSpriteTime(getTimeValue(), state.grid.rows, state.grid.columns);
    const rows = counts.map((count, rowIndex) => {
      const rowTime = matrix[rowIndex]?.find((cell) => String(cell).trim() !== '') || matrix[rowIndex]?.[0] || '0';
      const selected = rowIndex === state.frameRow;
      return `
        <div class="sprite-editor-row-config ${selected ? 'is-selected' : ''}">
          <button class="sprite-editor-secondary" type="button" data-row-select="${rowIndex}">ROW ${rowIndex}</button>
          <input class="sprite-editor-input" data-row-frame-count="${rowIndex}" type="number" min="1" max="${state.grid.columns}" value="${count}" aria-label="ROW ${rowIndex} 有効フレーム数" />
          <input class="sprite-editor-input" data-row-default-time="${rowIndex}" type="number" min="0" value="${esc(rowTime)}" aria-label="ROW ${rowIndex} 既定 time" />
          <span class="sprite-editor-status">${selected ? '選択中' : ''}</span>
        </div>
      `;
    }).join('');
    ui.rowList.innerHTML = `
      <div class="sprite-editor-row-header" aria-hidden="true">
        <span>ROW</span>
        <span>有効</span>
        <span>既定 time</span>
        <span>状態</span>
      </div>
      ${rows}
    `;
  }

  async function saveRowFrameCount(input) {
    const selected = getSelectedSprite();
    if (!selected) return;
    const rowIndex = numberInRange(input.dataset.rowFrameCount, 0, Math.max(0, state.grid.rows - 1), 0);
    const frameCount = numberInRange(input.value, 1, state.grid.columns, state.grid.columns);
    input.value = String(frameCount);
    const fillInput = ui.rowList.querySelector(`[data-row-default-time="${rowIndex}"]`);
    const fillTime = fillInput?.value || ui.frameTime.value || '0';
    ui.time.value = resizeSpriteTimeRow(getTimeValue(), state.grid.rows, state.grid.columns, rowIndex, frameCount, fillTime);
    if (rowIndex === state.frameRow) {
      state.frameIndex = numberInRange(state.frameIndex, 0, Math.max(0, frameCount - 1), 0);
    }
    await saveProperties({ silent: true });
    syncFrameControls();
    drawPreview();
    drawSheet();
    setStatus(`ROW ${rowIndex} の有効フレーム数を ${frameCount} にしました`);
  }

  async function applyRowDefaultTime(input, options = {}) {
    const selected = getSelectedSprite();
    if (!selected) return;
    const rowIndex = numberInRange(input.dataset.rowDefaultTime, 0, Math.max(0, state.grid.rows - 1), 0);
    const fillTime = String(Math.max(0, Number.parseInt(input.value, 10) || 0));
    if (options.persist) input.value = fillTime;
    const counts = getRowFrameCounts();
    const frameCount = Math.max(1, Math.min(state.grid.columns, counts[rowIndex] || state.grid.columns));
    let nextTime = resizeSpriteTimeRow(getTimeValue(), state.grid.rows, state.grid.columns, rowIndex, frameCount, fillTime);
    for (let frame = 0; frame < frameCount; frame += 1) {
      nextTime = updateSpriteTimeCell(nextTime, state.grid.rows, state.grid.columns, rowIndex, frame, fillTime);
    }
    ui.time.value = nextTime;
    if (rowIndex === state.frameRow) ui.frameTime.value = fillTime;
    if (!options.persist) state.dirty = true;
    drawPreview();
    drawSheet();
    if (!options.persist) return;
    await saveProperties({ silent: true });
    syncFrameControls();
    setStatus(`ROW ${rowIndex} の time を ${fillTime} にしました`);
  }

  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    renderTree();
  }

  async function confirmCanReplaceCurrentSprite() {
    if (!state.dirty) return true;
    const selected = getSelectedSprite();
    const decision = await confirmUnsavedSpriteSwitch(selected?.entry);
    if (decision === 'cancel') {
      setStatus('操作をキャンセルしました');
      return false;
    }
    if (decision === 'save') {
      await saveProperties();
      return !state.dirty;
    }
    state.dirty = false;
    renderTree();
    return true;
  }

  async function readImageSize(sourcePath) {
    const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
    if (!read?.ok || !read.dataUrl) return { width: 0, height: 0 };
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }

  async function requestAddInfo({ resFiles, defaultFile, defaultSymbol, pickedName, sourceSize }) {
    const sourceWidth = snapUpTo8(sourceSize?.width || 8);
    const sourceHeight = snapUpTo8(sourceSize?.height || 8);
    const options = resFiles.map((file) => `<option value="${esc(file)}" ${file === defaultFile ? 'selected' : ''}>${esc(file)}</option>`).join('');
    return formModal({
      title: 'SPRITE を追加',
      submitText: '追加',
      body: `
        <label class="sprite-editor-field">追加先 .res
          <select class="sprite-editor-select" name="file">${options}</select>
        </label>
        <label class="sprite-editor-field">アセット名
          <input class="sprite-editor-input" name="symbol" value="${esc(defaultSymbol)}" />
        </label>
        <div class="sprite-editor-row">
          <label class="sprite-editor-field">画像幅(px)
            <input class="sprite-editor-input" name="targetWidth" type="number" min="8" step="8" value="${sourceWidth}" />
          </label>
          <label class="sprite-editor-field">画像高さ(px)
            <input class="sprite-editor-input" name="targetHeight" type="number" min="8" step="8" value="${sourceHeight}" />
          </label>
        </div>
        <label class="sprite-editor-field">コメント
          <input class="sprite-editor-input" name="comment" value="${esc(pickedName)}" />
        </label>
      `,
      collect(form) {
        const symbol = normalizeSymbolName(form.elements.symbol.value);
        if (!symbol) return null;
        return {
          file: form.elements.file.value,
          symbol,
          targetWidth: snapUpTo8(form.elements.targetWidth.value),
          targetHeight: snapUpTo8(form.elements.targetHeight.value),
          comment: form.elements.comment.value,
        };
      },
    });
  }

  function updateZoomFromWheel(event, target) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    if (target === 'preview') {
      state.previewScale = nextZoom(state.previewScale, delta, 12);
      ui.previewScale.value = formatZoom(state.previewScale);
      drawPreview();
      return;
    }
    state.sheetScale = nextZoom(state.sheetScale, delta, 8);
    ui.sheetScale.value = formatZoom(state.sheetScale);
    drawSheet();
  }

  function startSplitterDrag(event) {
    const rect = ui.center.getBoundingClientRect();
    const topMin = 160;
    const bottomMin = 180;
    state.splitterDrag = {
      top: rect.top,
      height: rect.height,
      min: topMin,
      max: Math.max(topMin, rect.height - bottomMin),
    };
    ui.splitter.setPointerCapture?.(event.pointerId);
    ui.splitter.classList.add('is-dragging');
    window.addEventListener('pointermove', handleSplitterDrag);
    window.addEventListener('pointerup', stopSplitterDrag, { once: true });
    handleSplitterDrag(event);
  }

  function handleSplitterDrag(event) {
    if (!state.splitterDrag) return;
    const nextTop = numberInRange(
      event.clientY - state.splitterDrag.top,
      state.splitterDrag.min,
      state.splitterDrag.max,
      Math.floor(state.splitterDrag.height * 0.45),
    );
    ui.center.style.gridTemplateRows = `${nextTop}px 6px minmax(0, 1fr)`;
  }

  function stopSplitterDrag() {
    state.splitterDrag = null;
    ui.splitter.classList.remove('is-dragging');
    window.removeEventListener('pointermove', handleSplitterDrag);
  }

  function resizeColumns(event) {
    const drag = state.columnResizeStart;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const minLeft = 220;
    const minCenter = 360;
    const minRight = 260;
    if (drag.edge === 'left') {
      const maxLeft = Math.max(minLeft, drag.shellWidth - drag.rightWidth - minCenter - 12);
      const width = Math.max(minLeft, Math.min(maxLeft, Math.round(drag.leftWidth + dx)));
      ui.rootShell.style.setProperty('--sprite-left-width', `${width}px`);
    } else {
      const maxRight = Math.max(minRight, drag.shellWidth - drag.leftWidth - minCenter - 12);
      const width = Math.max(minRight, Math.min(maxRight, Math.round(drag.rightWidth - dx)));
      ui.rootShell.style.setProperty('--sprite-right-width', `${width}px`);
    }
  }

  function stopColumnResize(event) {
    const drag = state.columnResizeStart;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.columnResizeStart = null;
    ui.leftColumnResizer.classList.remove('active');
    ui.rightColumnResizer.classList.remove('active');
  }

  function confirmModal(message, submitText) {
    return formModal({
      title: '確認',
      submitText,
      danger: true,
      body: `<p class="sprite-editor-status">${message}</p>`,
      collect: () => true,
    });
  }

  function confirmUnsavedSpriteSwitch(entry) {
    return new Promise((resolve) => {
      const title = esc(entry?.name || '選択中のSPRITE');
      const modalHtml = `
        <div class="page-header modal-header">
          <h2>未保存の変更</h2>
          <button class="icon-btn" type="button" data-modal-decision="cancel">✕</button>
        </div>
        <div class="settings-form compact-form sprite-editor-modal-form">
          <p class="sprite-editor-status">${title} に未保存の変更があります。</p>
          <p class="sprite-editor-status">別のアセットを開く前に、変更を保存するか破棄してください。</p>
          <div class="form-actions-inline modal-actions-end">
            <button class="sprite-editor-secondary" type="button" data-modal-decision="cancel">キャンセル</button>
            <button class="sprite-editor-danger" type="button" data-modal-decision="discard">破棄して開く</button>
            <button class="sprite-editor-primary" type="button" data-modal-decision="save">保存して開く</button>
          </div>
        </div>
      `;
      const modal = api.createModal({
        id: `${plugin.id}-unsaved-switch-modal`,
        panelClassName: 'app-panel app-panel-sm',
        html: modalHtml,
      });
      modal.panel.innerHTML = modalHtml;
      modal.panel.querySelectorAll('[data-modal-decision]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.close();
          resolve(button.dataset.modalDecision || 'cancel');
        }, { once: true });
      });
      modal.open();
    });
  }

  function formModal({ title, body, submitText, collect, danger = false }) {
    return new Promise((resolve) => {
      const modalHtml = `
          <div class="page-header modal-header">
            <h2>${esc(title)}</h2>
            <button class="icon-btn" type="button" data-modal-cancel>✕</button>
          </div>
          <form class="settings-form compact-form sprite-editor-modal-form">
            ${body}
            <div class="form-actions-inline modal-actions-end">
              <button class="sprite-editor-secondary" type="button" data-modal-cancel>キャンセル</button>
              <button class="${danger ? 'sprite-editor-danger' : 'sprite-editor-primary'}" type="submit">${esc(submitText)}</button>
            </div>
          </form>
        `;
      const modal = api.createModal({
        id: `${plugin.id}-form-modal`,
        panelClassName: 'app-panel app-panel-sm',
        html: modalHtml,
      });
      modal.panel.innerHTML = modalHtml;
      const form = modal.panel.querySelector('form');
      const close = (value) => {
        modal.close();
        resolve(value);
      };
      modal.panel.querySelectorAll('[data-modal-cancel]').forEach((button) => {
        button.addEventListener('click', () => close(null), { once: true });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        close(collect(form));
      }, { once: true });
      modal.open();
    });
  }
}

function buildShell() {
  return `
    <div class="sprite-editor-root" data-role="root-shell">
      <aside class="sprite-editor-pane" data-role="left-pane">
        <div class="sprite-editor-toolbar">
          <h2>SPRITE</h2>
          <button class="icon-btn" type="button" data-role="add" title="追加">＋</button>
        </div>
        <div class="sprite-editor-filter">
          <label>.res ファイル
            <select class="sprite-editor-select" data-role="file-filter"></select>
          </label>
          <label>アセット名
            <input class="sprite-editor-input" data-role="keyword" type="search" placeholder="keyword" />
          </label>
        </div>
        <div class="sprite-editor-tree" data-role="tree"></div>
      </aside>
      <div class="sprite-editor-column-resizer" data-role="left-column-resizer" title="左列の幅を調整" aria-label="左列の幅を調整"></div>
      <main class="sprite-editor-center">
        <section class="sprite-editor-preview">
          <div class="sprite-editor-subtoolbar">
            <span class="sprite-editor-panel-title">Frame Preview</span>
            <label class="sprite-editor-inline-field">倍率 <input class="sprite-editor-input" data-role="preview-scale" type="number" min="0.25" max="12" step="0.25" value="4" /></label>
            <label class="sprite-editor-inline-field"><input data-role="grid-toggle" type="checkbox" checked /> 8x8</label>
            <button class="icon-btn" data-role="first" type="button" title="先頭">⏮</button>
            <button class="icon-btn" data-role="play" type="button" title="再生">▶</button>
            <button class="icon-btn" data-role="last" type="button" title="末尾">⏭</button>
            <button class="icon-btn sprite-editor-primary" data-role="loop" type="button" title="ループ" aria-pressed="true">↻</button>
            <label class="sprite-editor-inline-field">ROW <input class="sprite-editor-input" data-role="row-input" type="number" min="0" value="0" /></label>
            <label class="sprite-editor-inline-field">Frame <input class="sprite-editor-input" data-role="frame-input" type="number" min="0" value="0" /></label>
            <label class="sprite-editor-inline-field">Time <input class="sprite-editor-input" data-role="frame-time" type="number" min="0" value="0" /></label>
          </div>
          <div class="sprite-editor-canvas-wrap" data-role="preview-wrap"><canvas data-role="preview-canvas" width="64" height="64"></canvas></div>
        </section>
        <div class="sprite-editor-splitter" data-role="splitter" title="表示領域を調整" aria-label="表示領域を調整"></div>
        <section class="sprite-editor-sheet">
          <div class="sprite-editor-subtoolbar">
            <span class="sprite-editor-panel-title">Sprite Sheet</span>
            <span class="sprite-editor-status" data-role="frame-info"></span>
            <label class="sprite-editor-inline-field">倍率 <input class="sprite-editor-input" data-role="sheet-scale" type="number" min="0.25" max="8" step="0.25" value="1" /></label>
            <label class="sprite-editor-inline-field">幅(px) <input class="sprite-editor-input" data-role="frame-width" type="number" min="8" max="248" step="8" value="16" /></label>
            <label class="sprite-editor-inline-field">高さ(px) <input class="sprite-editor-input" data-role="frame-height" type="number" min="8" max="248" step="8" value="16" /></label>
          </div>
          <div class="sprite-editor-canvas-wrap" data-role="sheet-wrap"><canvas data-role="sheet-canvas" width="128" height="128"></canvas></div>
          <div class="sprite-editor-animation-rows">
            <div class="sprite-editor-row-title">Animation Rows</div>
            <div class="sprite-editor-row-list" data-role="row-list"></div>
          </div>
        </section>
      </main>
      <div class="sprite-editor-column-resizer" data-role="right-column-resizer" title="右列の幅を調整" aria-label="右列の幅を調整"></div>
      <aside class="sprite-editor-pane sprite-editor-props" data-role="props-pane">
        <div class="sprite-editor-toolbar">
          <h2>Properties</h2>
        </div>
        <div class="sprite-editor-empty" data-role="props-disabled">SPRITE を選択してください</div>
        <form class="sprite-editor-form-grid" data-role="form" hidden>
          <label class="sprite-editor-field">name <input class="sprite-editor-input" data-role="name" /></label>
          <label class="sprite-editor-field">sourcePath <input class="sprite-editor-input" data-role="source-path" /></label>
          <div class="sprite-editor-row">
            <label class="sprite-editor-field">compression <select class="sprite-editor-select" data-role="compression"><option>NONE</option><option>BEST</option><option>AUTO</option><option>APLIB</option><option>FAST</option><option>LZ4W</option></select></label>
            <label class="sprite-editor-field">collision <select class="sprite-editor-select" data-role="collision"><option>NONE</option><option>CIRCLE</option><option>BOX</option></select></label>
          </div>
          <label class="sprite-editor-field">time <input class="sprite-editor-input" data-role="time" /></label>
          <div class="sprite-editor-row">
            <label class="sprite-editor-field">opt_type <select class="sprite-editor-select" data-role="opt-type"><option>BALANCED</option><option>SPRITE</option><option>TILE</option><option>NONE</option></select></label>
            <label class="sprite-editor-field">opt_level <select class="sprite-editor-select" data-role="opt-level"><option>FAST</option><option>MEDIUM</option><option>SLOW</option><option>MAX</option></select></label>
          </div>
          <label class="sprite-editor-field">opt_duplicate <select class="sprite-editor-select" data-role="opt-duplicate"><option>FALSE</option><option>TRUE</option></select></label>
          <label class="sprite-editor-field">comment <textarea class="sprite-editor-textarea" data-role="comment"></textarea></label>
        </form>
        <p class="sprite-editor-status" data-role="status"></p>
      </aside>
    </div>
  `;
}

function bindUi(root) {
  const pick = (role) => root.querySelector(`[data-role="${role}"]`);
  return {
    rootShell: pick('root-shell'),
    leftPane: pick('left-pane'),
    propsPane: pick('props-pane'),
    leftColumnResizer: pick('left-column-resizer'),
    rightColumnResizer: pick('right-column-resizer'),
    add: pick('add'),
    fileFilter: pick('file-filter'),
    keyword: pick('keyword'),
    tree: pick('tree'),
    center: root.querySelector('.sprite-editor-center'),
    previewScale: pick('preview-scale'),
    sheetScale: pick('sheet-scale'),
    previewWrap: pick('preview-wrap'),
    sheetWrap: pick('sheet-wrap'),
    splitter: pick('splitter'),
    gridToggle: pick('grid-toggle'),
    first: pick('first'),
    play: pick('play'),
    last: pick('last'),
    loop: pick('loop'),
    rowInput: pick('row-input'),
    frameInput: pick('frame-input'),
    frameTime: pick('frame-time'),
    frameInfo: pick('frame-info'),
    rowList: pick('row-list'),
    frameWidth: pick('frame-width'),
    frameHeight: pick('frame-height'),
    previewCanvas: pick('preview-canvas'),
    sheetCanvas: pick('sheet-canvas'),
    propsDisabled: pick('props-disabled'),
    form: pick('form'),
    name: pick('name'),
    sourcePath: pick('source-path'),
    compression: pick('compression'),
    time: pick('time'),
    collision: pick('collision'),
    optType: pick('opt-type'),
    optLevel: pick('opt-level'),
    optDuplicate: pick('opt-duplicate'),
    comment: pick('comment'),
    status: pick('status'),
  };
}

function drawContainFrame(canvas, img, frame) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
  const width = Math.max(1, Math.floor(frame.width * scale));
  const height = Math.max(1, Math.floor(frame.height * scale));
  const x = Math.floor((canvas.width - width) / 2);
  const y = Math.floor((canvas.height - height) / 2);
  ctx.drawImage(img, frame.x, frame.y, frame.width, frame.height, x, y, width, height);
}

function spriteKey(file, entry) {
  return `${file}:${entry.lineNumber}:${entry.name}`;
}

function normalizeOption(value, allowed, fallback) {
  const upper = String(value || '').toUpperCase();
  return allowed.includes(upper) ? upper : fallback;
}

function numberInRange(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeZoom(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.25, Math.min(max, Math.round(n * 4) / 4));
}

function nextZoom(current, direction, max) {
  const zoom = normalizeZoom(current, 1, max);
  if (direction > 0) {
    if (zoom < 0.5) return 0.5;
    if (zoom < 1) return 1;
    return Math.min(max, zoom + 1);
  }
  if (zoom <= 0.25) return 0.25;
  if (zoom <= 0.5) return 0.25;
  if (zoom <= 1) return 0.5;
  return Math.max(1, zoom - 1);
}

function formatZoom(value) {
  return String(Number(value.toFixed(2)));
}

function snapUpTo8(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 8;
  return Math.max(8, Math.ceil(n / 8) * 8);
}

function getFileName(filePath) {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop() || 'sprite.png';
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
