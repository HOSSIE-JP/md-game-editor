import {
  buildTmx,
  buildCollisionHeader,
  buildCollisionSource,
  COLLISION_TYPES,
  buildTsx,
  createBlankTilemap,
  extractCollisionMaps,
  normalizeLayerData,
  normalizeSymbolName,
  parseTmx,
  parseTsx,
  repeatedBrushGid,
  sourceBaseName,
} from './tilemap-core.mjs';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'bmp'] },
  { name: 'All Files', extensions: ['*'] },
];

const MAP_TYPES = new Set(['MAP', 'TILEMAP']);
const TILE_TYPES = new Set(['TILESET']);
const EDITOR_TYPES = new Set(['TILESET', 'MAP', 'TILEMAP']);
const TOOL_LABELS = {
  pen: 'ペン',
  eraser: '消しゴム',
  fill: '塗りつぶし',
  rect: '矩形',
  select: '範囲選択',
  eyedropper: 'スポイト',
};

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  if (!root) return null;
  root.classList.add('tilemap-editor-page');

  const state = {
    allFiles: [],
    files: [],
    selectedAssetKey: '',
    selectedMapKey: '',
    selectedTilesetKey: '',
    expandedAssets: new Set(),
    expandedTilesets: new Set(),
    assetFileFilter: '',
    assetKeyword: '',
    tilesetFileFilter: '',
    tilesetKeyword: '',
    map: createBlankTilemap(),
    mapEntry: null,
    selectedLayer: 0,
    selectedBrush: { x: 0, y: 0, w: 1, h: 1, gid: 1 },
    tool: 'pen',
    showGrid: true,
    showPriority: true,
    inactiveLayerOpacity: 0.45,
    collisionValue: 1,
    zoom: 2,
    paletteZoom: 2,
    tilesetImage: null,
    activeTileset: null,
    loadedTilesets: [],
    tilesetDataUrl: '',
    tilesetImageAbsolutePath: '',
    dirty: false,
    dragStart: null,
    paletteDragStart: null,
    panelResizeStart: null,
    columnResizeStart: null,
    rightPanelResizeManual: false,
    rightAccordion: { tiles: true, palette: true, layers: true },
    browserPanelHeight: 0,
    palettePanelHeight: 0,
    hoverCell: null,
    selection: null,
    selectionDrag: null,
    warnings: [],
    mapResourceType: 'MAP',
    wasActive: root.classList.contains('active'),
  };

  root.tabIndex = 0;
  root.innerHTML = buildShell();
  const ui = bindUi(root);
  bindEvents();
  observePageActivation();
  void refresh();

  registerCapability('tilemap-editor', {
    pluginId: plugin.id,
    root,
    refresh,
    getMap: () => structuredCloneSafe(state.map),
    save: () => saveMap(),
    registerResources: () => registerMapResource(),
  });

  logger.debug('tilemap-editor renderer activated');
  return {
    deactivate() {
      root.innerHTML = '';
      root.classList.remove('tilemap-editor-page');
    },
  };

  function bindEvents() {
    ui.addMap.addEventListener('click', async () => {
      if (await confirmCanReplaceCurrentMap()) void addMapAsset();
    });
    ui.assetFileFilter.addEventListener('change', () => {
      state.assetFileFilter = ui.assetFileFilter.value;
      renderAssetTree();
    });
    ui.assetKeyword.addEventListener('input', () => {
      state.assetKeyword = ui.assetKeyword.value.trim().toLowerCase();
      renderAssetTree();
    });
    ui.assetTree.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-asset-file-toggle]');
      if (toggle) {
        toggleExpanded(state.expandedAssets, toggle.dataset.assetFileToggle);
        renderAssetTree();
        return;
      }
      const action = event.target.closest('[data-tilemap-action]');
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.dataset.tilemapAction === 'save') void registerMapResource();
        if (action.dataset.tilemapAction === 'delete') void deleteSelectedAsset();
        return;
      }
      const item = event.target.closest('[data-asset-key]');
      if (item) void requestSelectAsset(item.dataset.assetKey);
    });

    ui.tilesetAdd.addEventListener('click', async () => {
      if (await confirmCanReplaceCurrentMap()) void addTilesetAsset();
    });
    ui.tilesetFileFilter.addEventListener('change', () => {
      state.tilesetFileFilter = ui.tilesetFileFilter.value;
      renderTilesetTree();
    });
    ui.tilesetKeyword.addEventListener('input', () => {
      state.tilesetKeyword = ui.tilesetKeyword.value.trim().toLowerCase();
      renderTilesetTree();
    });
    ui.tilesetTree.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-tileset-file-toggle]');
      if (toggle) {
        toggleExpanded(state.expandedTilesets, toggle.dataset.tilesetFileToggle);
        renderTilesetTree();
        return;
      }
      const action = event.target.closest('[data-tilemap-action]');
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.dataset.tilemapAction === 'delete') void deleteSelectedTileset();
        return;
      }
      const item = event.target.closest('[data-tileset-key]');
      if (item) void requestSelectTileset(item.dataset.tilesetKey, { updateMapReference: true });
    });
    const startRightPanelResize = (event, kind, resizer, target) => {
      resizer.setPointerCapture(event.pointerId);
      state.rightPanelResizeManual = true;
      state.panelResizeStart = {
        kind,
        pointerId: event.pointerId,
        resizer,
        startY: event.clientY,
        startHeight: target.getBoundingClientRect().height,
      };
      resizer.classList.add('active');
    };
    const moveRightPanelResize = (event) => {
      if (!state.panelResizeStart || state.panelResizeStart.pointerId !== event.pointerId) return;
      const nextHeight = state.panelResizeStart.startHeight + event.clientY - state.panelResizeStart.startY;
      if (state.panelResizeStart.kind === 'browser') {
        resizeTilesetBrowser(nextHeight);
        resizeRightPanels(state.palettePanelHeight);
      } else {
        resizeRightPanels(nextHeight);
      }
    };
    const stopRightPanelResize = (event) => {
      if (state.panelResizeStart?.pointerId !== event.pointerId) return;
      state.panelResizeStart.resizer?.classList.remove('active');
      state.panelResizeStart = null;
    };
    ui.paletteTopResizer.addEventListener('pointerdown', (event) => startRightPanelResize(event, 'browser', ui.paletteTopResizer, ui.tilesetBrowser));
    ui.paletteTopResizer.addEventListener('pointermove', moveRightPanelResize);
    ui.paletteTopResizer.addEventListener('pointerup', stopRightPanelResize);
    ui.paletteTopResizer.addEventListener('pointercancel', stopRightPanelResize);
    ui.rightPanelResizer.addEventListener('pointerdown', (event) => startRightPanelResize(event, 'palette', ui.rightPanelResizer, ui.paletteSection));
    ui.rightPanelResizer.addEventListener('pointermove', moveRightPanelResize);
    ui.rightPanelResizer.addEventListener('pointerup', stopRightPanelResize);
    ui.rightPanelResizer.addEventListener('pointercancel', stopRightPanelResize);
    const startColumnResize = (event, edge) => {
      ui.shell.setPointerCapture(event.pointerId);
      state.columnResizeStart = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        leftWidth: ui.sidebar.getBoundingClientRect().width,
        rightWidth: ui.rightPane.getBoundingClientRect().width,
        shellWidth: ui.shell.getBoundingClientRect().width,
      };
      event.target.classList.add('active');
    };
    ui.leftColumnResizer.addEventListener('pointerdown', (event) => startColumnResize(event, 'left'));
    ui.rightColumnResizer.addEventListener('pointerdown', (event) => startColumnResize(event, 'right'));
    ui.shell.addEventListener('pointermove', (event) => resizeColumns(event));
    ui.shell.addEventListener('pointerup', (event) => stopColumnResize(event));
    ui.shell.addEventListener('pointercancel', (event) => stopColumnResize(event));
    ui.rightPane.addEventListener('click', (event) => {
      const button = event.target.closest('[data-toggle-right-section]');
      if (!button) return;
      toggleRightSection(button.dataset.toggleRightSection);
    });

    ui.paletteZoom.addEventListener('input', () => setPaletteZoom(Number(ui.paletteZoom.value) || state.paletteZoom));
    ui.tilesetWrap.addEventListener('wheel', (event) => handlePaletteWheelZoom(event), { passive: false });
    ui.tilesetCanvas.addEventListener('pointerdown', (event) => {
      ui.tilesetCanvas.setPointerCapture(event.pointerId);
      const tile = eventToTilesetTile(event);
      if (!tile) return;
      state.paletteDragStart = tile;
      setBrushFromTileRange(tile, tile);
    });
    ui.tilesetCanvas.addEventListener('pointermove', (event) => {
      if (!state.paletteDragStart || event.buttons !== 1) return;
      const tile = eventToTilesetTile(event);
      if (tile) setBrushFromTileRange(state.paletteDragStart, tile);
    });
    ui.tilesetCanvas.addEventListener('pointerup', () => {
      state.paletteDragStart = null;
      renderTilesetPalette();
    });

    ui.mapWidth.addEventListener('change', () => updateMapSizeFromInputs());
    ui.mapHeight.addEventListener('change', () => updateMapSizeFromInputs());
    ui.gridToggle.addEventListener('change', () => {
      state.showGrid = ui.gridToggle.checked;
      drawMap();
    });
    ui.priorityToggle.addEventListener('change', () => {
      state.showPriority = ui.priorityToggle.checked;
      drawMap();
    });
    ui.inactiveOpacity.addEventListener('input', () => {
      state.inactiveLayerOpacity = clamp(Number(ui.inactiveOpacity.value) || state.inactiveLayerOpacity, 0.1, 1);
      drawMap();
    });
    ui.zoom.addEventListener('input', () => setZoom(Number(ui.zoom.value) || state.zoom));
    ui.mapCanvasWrap.addEventListener('wheel', (event) => handleWheelZoom(event), { passive: false });

    ui.toolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.tool = button.dataset.tool;
        state.dragStart = null;
        state.selectionDrag = null;
        syncToolButtons();
        syncStatus();
      });
    });

    ui.mapCanvas.addEventListener('pointerdown', (event) => {
      root.focus({ preventScroll: true });
      if (!hasSelectedMap()) {
        setStatus('左列で編集する MAP/TILEMAP 定義を選択してください。');
        return;
      }
      ui.mapCanvas.setPointerCapture(event.pointerId);
      const cell = eventToMapCell(event);
      if (!cell) return;
      state.dragStart = cell;
      if (state.tool === 'select') {
        beginSelection(cell);
        drawMap();
        return;
      }
      state.selection = null;
      applyTool(cell, cell);
    });
    ui.mapCanvas.addEventListener('pointermove', (event) => {
      const cell = eventToMapCell(event);
      state.hoverCell = cell;
      if (!hasSelectedMap()) {
        syncStatus();
      } else if (cell && state.selectionDrag && state.tool === 'select') {
        updateSelection(cell);
        drawMap();
      } else if (cell && state.dragStart && state.tool === 'rect') {
        drawMap({ rectEnd: cell });
      } else if (cell && event.buttons === 1 && state.dragStart && ['pen', 'eraser'].includes(state.tool)) {
        applyTool(cell, state.dragStart);
      } else {
        syncStatus();
      }
    });
    ui.mapCanvas.addEventListener('pointerup', (event) => {
      const cell = eventToMapCell(event);
      if (cell && state.selectionDrag && state.tool === 'select') {
        finishSelection(cell);
      } else if (cell && state.dragStart && state.tool === 'rect') {
        applyTool(cell, state.dragStart);
      }
      state.dragStart = null;
      drawMap();
    });
    ui.mapCanvas.addEventListener('pointerleave', () => {
      state.hoverCell = null;
      syncStatus();
    });

    ui.addLayer.addEventListener('click', () => void addLayer(false));
    ui.addPriorityLayer.addEventListener('click', () => void addLayer(true));
    ui.addCollisionLayer.addEventListener('click', () => void addCollisionLayer());
    ui.deleteLayer.addEventListener('click', () => void deleteLayer());
    ui.layerUp.addEventListener('click', () => moveLayer(-1));
    ui.layerDown.addEventListener('click', () => moveLayer(1));
    ui.layerList.addEventListener('click', (event) => {
      if (event.target.closest('[data-layer-name]')) return;
      const visibility = event.target.closest('[data-layer-visible]');
      if (visibility) {
        const index = Number(visibility.dataset.layerVisible);
        const layer = state.map.layers[index];
        if (layer) {
          layer.visible = layer.visible === false;
          state.dirty = true;
          renderLayers();
          drawMap();
        }
        return;
      }
      const item = event.target.closest('[data-layer-select]');
      if (item) {
        state.selectedLayer = clamp(Number(item.dataset.layerSelect) || 0, 0, state.map.layers.length - 1);
        state.selection = null;
        state.selectionDrag = null;
        renderLayers();
        drawMap();
      }
    });
    ui.layerList.addEventListener('change', (event) => {
      const input = event.target.closest('[data-layer-name]');
      if (!input) return;
      const index = Number(input.dataset.layerName);
      const layer = state.map.layers[index];
      if (!layer) return;
      layer.name = input.value.trim() || layer.name;
      layer.priority = /\s(priority|prio)$/i.test(layer.name);
      layer.collision = /^collision(?::|$)/i.test(layer.name);
      state.dirty = true;
      renderLayers();
      drawMap();
    });
    ui.collisionPalette.addEventListener('click', (event) => {
      const button = event.target.closest('[data-collision-value]');
      if (!button) return;
      state.collisionValue = clamp(Number(button.dataset.collisionValue) || 0, 0, 255);
      ensureCollisionLayerSelected();
      renderCollisionPalette();
      syncStatus();
    });
    root.addEventListener('keydown', (event) => {
      if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) {
        event.preventDefault();
        clearSelection();
      } else if (event.key === 'Escape') {
        state.selection = null;
        state.selectionDrag = null;
        drawMap();
      }
    });
  }

  function observePageActivation() {
    const observer = new MutationObserver(() => {
      const active = root.classList.contains('active');
      if (active && !state.wasActive) {
        if (state.dirty) setStatus('未保存の変更があるため、自動リロードを保留しました。');
        else void refresh();
      }
      state.wasActive = active;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  async function refresh() {
    setStatus('TILESET / MAP 定義を読み込み中...');
    const result = await api.electronAPI.listResDefinitions();
    if (!result?.ok) {
      setStatus(`読み込み失敗: ${result?.error || 'unknown'}`);
      return;
    }
    state.allFiles = result.files || [];
    state.files = state.allFiles.map((file) => ({
      ...file,
      entries: (file.entries || []).filter((entry) => EDITOR_TYPES.has(String(entry.type || '').toUpperCase())),
    }));
    state.files.forEach((file) => {
      state.expandedAssets.add(file.file);
      state.expandedTilesets.add(file.file);
    });
    if (!state.selectedTilesetKey || !findAssetByKey(state.selectedTilesetKey, TILE_TYPES)) {
      state.selectedTilesetKey = firstKeyForTypes(TILE_TYPES);
    }
    if (!state.selectedMapKey || !findAssetByKey(state.selectedMapKey, MAP_TYPES)) {
      state.selectedMapKey = findAssetByKey(state.selectedAssetKey, MAP_TYPES) ? state.selectedAssetKey : '';
    }
    if (!state.selectedAssetKey || !findAssetByKey(state.selectedAssetKey, MAP_TYPES)) state.selectedAssetKey = state.selectedMapKey || '';
    renderFilters();
    renderAssetTree();
    renderTilesetTree();
    await loadSelectedTileset();
    if (state.selectedMapKey) await loadSelectedMap();
    else {
      state.mapEntry = null;
      state.map = createBlankTilemap();
      state.loadedTilesets = [];
    }
    renderAll();
    scheduleInitialRightPanelHeights();
    syncRightAccordion();
    setStatus(`TILESET ${countEntries(TILE_TYPES)} 件 / MAP ${countEntries(MAP_TYPES)} 件`);
  }

  async function selectAsset(key) {
    const item = findAssetByKey(key);
    if (!item) return;
    const type = String(item.entry.type || '').toUpperCase();
    if (MAP_TYPES.has(type)) {
      state.selectedAssetKey = key;
      state.selectedMapKey = key;
      await loadSelectedMap();
    }
    renderAll();
  }

  async function requestSelectAsset(key) {
    if (!key || key === state.selectedAssetKey || !state.dirty) {
      await selectAsset(key);
      return true;
    }
    const ok = await confirmCanReplaceCurrentMap();
    if (!ok) {
      renderAssetTree();
      return false;
    }
    await selectAsset(key);
    return true;
  }

  async function selectTileset(key, options = {}) {
    if (!findAssetByKey(key, TILE_TYPES)) return;
    state.selectedTilesetKey = key;
    await loadSelectedTileset(options);
    renderAll();
  }

  async function requestSelectTileset(key, options = {}) {
    if (!state.dirty || key === state.selectedTilesetKey) {
      await selectTileset(key, options);
      return true;
    }
    const ok = await confirmCanReplaceCurrentMap();
    if (!ok) {
      renderTilesetTree();
      return false;
    }
    await selectTileset(key, options);
    return true;
  }

  async function confirmCanReplaceCurrentMap() {
    if (!state.dirty) return true;
    const item = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    const decision = await confirmUnsavedMapSwitch(item?.entry);
    if (decision === 'cancel') {
      setStatus('操作をキャンセルしました。');
      return false;
    }
    if (decision === 'save') {
      const saved = await registerMapResource();
      return Boolean(saved) && !state.dirty;
    }
    state.dirty = false;
    await loadSelectedMap();
    renderAll();
    return true;
  }

  async function loadSelectedMap() {
    const item = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    state.mapEntry = item || null;
    if (!item?.entry?.sourcePath) {
      if (!state.map) state.map = createBlankTilemap();
      return;
    }
    const path = resPath(item.entry.sourcePath);
    const read = await api.electronAPI.readCodeFile({ path });
    if (!read?.ok) {
      setStatus(`MAP 読み込み失敗: ${read?.error || item.entry.sourcePath}`);
      return;
    }
    try {
      const parsed = parseTmx(read.content);
      parsed.name = normalizeSymbolName(item.entry.name || item.entry.sourcePath, state.map.name);
      state.map = { ...state.map, ...parsed };
      state.warnings = parsed.warnings || [];
      state.mapResourceType = String(item.entry.type || 'MAP').toUpperCase() === 'TILEMAP' ? 'TILEMAP' : 'MAP';
      state.selectedLayer = findLayerIndex(item.entry.tileset) || 0;
      state.selection = null;
      state.selectionDrag = null;
      state.dirty = false;
      syncMapInputs();
      const tmxDir = dirname(item.entry.sourcePath);
      const pruneResult = await loadMapTilesets(item.entry.sourcePath, { pruneMissing: true });
      if (pruneResult.missing.length) {
        const names = pruneResult.missing.map((missing) => missing.source).join('\n');
        state.dirty = true;
        state.warnings.push(`存在しない TILESET 参照を削除しました: ${pruneResult.missing.map((missing) => missing.source).join(', ')}`);
        await messageModal({
          title: 'TILESET 参照を削除しました',
          message: `この MAP が参照している TILESET が見つかりませんでした。該当参照を MAP から削除しました。\n\n${names}`,
        });
      }
      const tsxSource = parsed.tilesetSource ? normalizeMapTileSource(parsed.tilesetSource) : '';
      const tsxRel = tsxSource ? normalizeRelPath(`${tmxDir}/${tsxSource}`) : '';
      const referenced = tsxRel ? findTilesetBySourcePath(tsxRel) : null;
      if (referenced) {
        state.selectedTilesetKey = assetKey(referenced.file.file, referenced.entry);
        await loadSelectedTileset({ updateMapReference: false });
      }
    } catch (err) {
      setStatus(`TMX parse 失敗: ${String(err?.message || err)}`);
    }
  }

  function hasSelectedMap() {
    return Boolean(findAssetByKey(state.selectedMapKey, MAP_TYPES));
  }

  async function loadSelectedTileset(options = {}) {
    const item = findAssetByKey(state.selectedTilesetKey, TILE_TYPES);
    if (!item?.entry?.sourcePath) {
      state.tilesetImage = null;
      state.activeTileset = null;
      state.tilesetImageAbsolutePath = '';
      renderTilesetPalette();
      return;
    }
    const read = await api.electronAPI.readCodeFile({ path: resPath(item.entry.sourcePath) });
    if (!read?.ok) {
      setStatus(`TILESET 読み込み失敗: ${read?.error || item.entry.sourcePath}`);
      return;
    }
    try {
      const tsx = parseTsx(read.content);
      const imageRel = normalizeRelPath(`${dirname(item.entry.sourcePath)}/${tsx.tilesetImage}`);
      const projectDir = await getProjectDir();
      const source = `../${item.entry.sourcePath}`;
      const tileWidth = snapTileSize(tsx.tileWidth || state.map.tileWidth);
      const tileHeight = snapTileSize(tsx.tileHeight || state.map.tileHeight);
      if (state.map.tileWidth && state.map.tileWidth !== tileWidth) {
        setStatus(`TILESET の tilewidth が MAP と一致しません: ${tileWidth}`);
        return;
      }
      if (state.map.tileHeight && state.map.tileHeight !== tileHeight) {
        setStatus(`TILESET の tileheight が MAP と一致しません: ${tileHeight}`);
        return;
      }
      const selectedMap = hasSelectedMap();
      const firstgid = options.updateMapReference && selectedMap
        ? ensureMapTilesetReference(source, tsx)
        : (getMapTilesetReference(source)?.firstgid || 1);
      state.activeTileset = {
        firstgid,
        source,
        name: item.entry.name || tsx.tilesetName,
        tileWidth,
        tileHeight,
        columns: Math.max(1, Number(tsx.tilesetColumns) || 1),
        tileCount: Math.max(1, Number(tsx.tilesetTileCount) || 1),
        imageWidth: tsx.tilesetImageWidth,
        imageHeight: tsx.tilesetImageHeight,
      };
      state.map.tilesetName = state.activeTileset.name;
      state.map.tilesetImage = tsx.tilesetImage;
      state.map.tilesetImageWidth = tsx.tilesetImageWidth;
      state.map.tilesetImageHeight = tsx.tilesetImageHeight;
      state.map.tilesetColumns = state.activeTileset.columns;
      state.map.tilesetTileCount = state.activeTileset.tileCount;
      state.map.tileWidth = tileWidth;
      state.map.tileHeight = tileHeight;
      state.map.tilesetSource = source;
      state.selectedBrush = { x: 0, y: 0, w: 1, h: 1, gid: firstgid };
      if (projectDir) await loadTilesetImage(`${projectDir}/res/${imageRel}`, state.activeTileset);
      if (options.updateMapReference && selectedMap) {
        state.dirty = true;
        await loadMapTilesets(state.mapEntry?.entry?.sourcePath || '');
      } else if (options.updateMapReference && !selectedMap) {
        setStatus('MAP/TILEMAP 未選択のため、描画先には追加していません。');
      }
      syncMapInputs();
    } catch (err) {
      setStatus(`TSX parse 失敗: ${String(err?.message || err)}`);
    }
  }

  async function loadTilesetImage(absPath, tileset = null) {
    const read = await api.electronAPI.readFileAsDataUrl(absPath);
    if (!read?.ok || !read.dataUrl) {
      state.tilesetImage = null;
      state.tilesetImageAbsolutePath = '';
      setStatus(`tileset image を読めません: ${read?.error || absPath}`);
      return;
    }
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode();
    const renderImage = makePaletteZeroTransparentImage(img, read.dataUrl);
    state.tilesetImage = renderImage;
    state.tilesetDataUrl = read.dataUrl;
    state.tilesetImageAbsolutePath = absPath;
    if (tileset) {
      const existing = state.loadedTilesets.find((candidate) => candidate.source === tileset.source);
      const loaded = { ...tileset, image: renderImage, rawImage: img, dataUrl: read.dataUrl, absolutePath: absPath };
      if (existing) Object.assign(existing, loaded);
      else state.loadedTilesets.push(loaded);
    }
    state.map.tilesetImageWidth = img.naturalWidth || img.width;
    state.map.tilesetImageHeight = img.naturalHeight || img.height;
    updateTilesetMetrics();
  }

  async function addMapAsset() {
    if (countEntries(TILE_TYPES) <= 0) {
      await messageModal({
        title: 'TILESET が必要です',
        message: 'TileMap/MAP を作成するには、先に右列の + から TILESET を登録してください。',
      });
      setStatus('先に TILESET を登録してください。');
      return;
    }
    const tileset = findAssetByKey(state.selectedTilesetKey, TILE_TYPES);
    if (!tileset) {
      await messageModal({
        title: 'TILESET を選択してください',
        message: 'TileMap/MAP を作成するには、右列で描画に使う TILESET を選択してください。',
      });
      setStatus('先に右列で TILESET を選択または登録してください。');
      return;
    }
    const resFiles = state.allFiles.map((file) => file.file);
    const request = await requestMapAddInfo({
      resFiles,
      defaultFile: state.assetFileFilter || state.tilesetFileFilter || firstResFile(),
      defaultSymbol: uniqueSymbol('map001', MAP_TYPES),
    });
    if (!request) return;
    const name = request.symbol;
    const layerName = request.layerName;
    state.map = createBlankTilemap({
      name,
      width: request.width,
      height: request.height,
      tileWidth: state.map.tileWidth || 8,
      tileHeight: state.map.tileHeight || 8,
      tilesetName: tileset.entry.name,
      layerName,
    });
    const sourcePath = `maps/${name}.tmx`;
    const tsx = await readTilesetInfo(tileset.entry);
    state.map.tilesets = [{ firstgid: 1, source: mapRelativeTilesetSource(tileset.entry.sourcePath) }];
    state.map.tilesetSource = mapRelativeTilesetSource(tileset.entry.sourcePath);
    state.map.tilesetColumns = Math.max(1, Number(tsx?.tilesetColumns) || state.map.tilesetColumns || 1);
    state.map.tilesetTileCount = Math.max(1, Number(tsx?.tilesetTileCount) || state.map.tilesetTileCount || 1);
    const write = await api.electronAPI.writeCodeFile({ path: resPath(sourcePath), content: buildTmx(state.map) });
    if (!write?.ok) {
      setStatus(`空MAP作成失敗: ${write?.error || 'unknown'}`);
      return;
    }
    const add = await api.electronAPI.addResEntry({
      file: request.file,
      entry: {
        type: request.type,
        name,
        sourcePath,
        tileset: layerName,
        compression: 'NONE',
        mapCompression: 'NONE',
        mapBase: '0',
        ordering: 'ROW',
        comment: 'Generated by tilemap-editor',
      },
    });
    if (!add?.ok) {
      setStatus(`MAP 定義追加失敗: ${add?.error || 'unknown'}`);
      return;
    }
    await refresh();
    const created = findMapBySourcePath(sourcePath);
    if (created) {
      state.selectedAssetKey = assetKey(created.file.file, created.entry);
      state.selectedMapKey = state.selectedAssetKey;
      await loadSelectedMap();
      renderAll();
    }
    setStatus(`空MAPを追加しました: ${sourcePath}`);
  }

  async function addTilesetAsset() {
    const resFiles = state.allFiles.map((file) => file.file);
    if (!resFiles.length) {
      setStatus('追加先の .res ファイルがありません');
      return;
    }
    const picked = await api.electronAPI.pickFile({
      title: 'TILESET 画像を選択',
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    });
    const sourcePath = picked?.sourcePath || picked?.filePath;
    if (picked?.canceled || !sourcePath) return;
    const pickedInfo = await readImageInfo(sourcePath);
    const defaultSymbol = uniqueSymbol(fileBaseName(sourcePath) || 'tileset', TILE_TYPES);
    const request = await requestTilesetAddInfo({
      resFiles,
      defaultFile: state.tilesetFileFilter || state.assetFileFilter || resFiles[0],
      defaultSymbol,
      sourceSize: pickedInfo,
    });
    if (!request) return;
    const duplicate = state.allFiles.flatMap((file) => file.entries || []).some((entry) => entry.name === request.symbol);
    if (duplicate) {
      setStatus(`同名のアセット定義があります: ${request.symbol}`);
      return;
    }
    const paletteName = `${request.symbol}_palette`;
    const duplicatePalette = state.allFiles.flatMap((file) => file.entries || []).some((entry) => entry.name === paletteName);
    if (duplicatePalette) {
      setStatus(`同名の PALETTE 定義があります: ${paletteName}`);
      return;
    }
    const pipeline = api.capabilities.get('image-import-pipeline');
    if (!pipeline?.convertToIndexed16) {
      setStatus('image-import-pipeline が無効です。asset-manager と converter を有効にしてください。');
      return;
    }
    const targetSize = { width: request.imageWidth, height: request.imageHeight };
    const converted = await pipeline.convertToIndexed16({ sourcePath, targetSize });
    if (converted?.canceled) {
      setStatus(converted.warning || 'TILESET 登録をキャンセルしました');
      return;
    }
    const ext = converted.targetExtension || '.png';
    const copy = await api.electronAPI.writeAssetFile({
      sourcePath,
      targetSubdir: 'tilesets',
      targetFileName: `${request.symbol}${ext}`,
      dataUrl: converted.convertedDataUrl || '',
    });
    if (!copy?.ok) {
      setStatus(`TILESET 画像コピー失敗: ${copy?.error || 'unknown'}`);
      return;
    }
    const imageInfo = await readImageInfo(copy.absolutePath);
    const tileWidth = request.tileWidth;
    const tileHeight = request.tileHeight;
    const tsx = buildTsx({
      tilesetName: request.symbol,
      tileWidth,
      tileHeight,
      tilesetImage: `${request.symbol}${ext}`,
      tilesetImageWidth: imageInfo.width,
      tilesetImageHeight: imageInfo.height,
      tilesetColumns: Math.max(1, Math.floor(imageInfo.width / tileWidth)),
      tilesetTileCount: Math.max(1, Math.floor(imageInfo.width / tileWidth) * Math.floor(imageInfo.height / tileHeight)),
    });
    const tsxPath = `tilesets/${request.symbol}.tsx`;
    const write = await api.electronAPI.writeCodeFile({ path: resPath(tsxPath), content: tsx });
    if (!write?.ok) {
      setStatus(`TSX 保存失敗: ${write?.error || 'unknown'}`);
      return;
    }
    const add = await api.electronAPI.addResEntry({
      file: request.file,
      entry: {
        type: 'TILESET',
        name: request.symbol,
        sourcePath: tsxPath,
        compression: 'NONE',
        opt: 'NONE',
        ordering: 'ROW',
        export: 'FALSE',
        comment: request.comment,
      },
    });
    if (!add?.ok) {
      setStatus(`TILESET 定義追加失敗: ${add?.error || 'unknown'}`);
      return;
    }
    const addPalette = await api.electronAPI.addResEntry({
      file: request.file,
      entry: {
        type: 'PALETTE',
        name: paletteName,
        sourcePath: copy.relativePath,
        comment: `Palette for ${request.symbol}`,
      },
    });
    if (!addPalette?.ok) {
      setStatus(`PALETTE 定義追加失敗: ${addPalette?.error || 'unknown'}`);
      return;
    }
    await refresh();
    const found = findTilesetBySourcePath(tsxPath);
    if (found) {
      state.selectedTilesetKey = assetKey(found.file.file, found.entry);
      await loadSelectedTileset({ updateMapReference: true });
      renderAll();
    }
    setStatus(converted.warning || `TILESET を追加しました: ${tsxPath}`);
  }

  async function deleteSelectedAsset() {
    const item = findAssetByKey(state.selectedAssetKey);
    if (!item) return;
    await deleteResourceEntry(item);
  }

  async function deleteSelectedTileset() {
    const item = findAssetByKey(state.selectedTilesetKey, TILE_TYPES);
    if (!item) return;
    await deleteResourceEntry(item);
  }

  async function deleteResourceEntry(item) {
    const type = String(item.entry?.type || '').toUpperCase();
    if (MAP_TYPES.has(type)) {
      const synced = await deleteMapLayerForEntry(item);
      if (!synced) return;
    }
    const result = await api.electronAPI.deleteResEntry({ file: item.file.file, lineNumber: item.entry.lineNumber });
    if (!result?.ok) {
      setStatus(`定義削除失敗: ${result?.error || 'unknown'}`);
      return;
    }
    if (assetKey(item.file.file, item.entry) === state.selectedMapKey) state.selectedMapKey = '';
    if (assetKey(item.file.file, item.entry) === state.selectedTilesetKey) state.selectedTilesetKey = '';
    if (assetKey(item.file.file, item.entry) === state.selectedAssetKey) state.selectedAssetKey = '';
    await refresh();
    setStatus(`定義のみ削除しました: ${item.entry.type} ${item.entry.name}`);
  }

  async function deleteMapLayerForEntry(item) {
    const sourcePath = normalizeRelPath(item?.entry?.sourcePath || '');
    const layerName = String(item?.entry?.tileset || '');
    if (!sourcePath || !layerName) return true;
    const selected = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    if (!selected || normalizeRelPath(selected.entry.sourcePath) !== sourcePath) {
      const read = await api.electronAPI.readCodeFile({ path: resPath(sourcePath) });
      if (!read?.ok) return true;
      try {
        state.map = parseTmx(read.content);
      } catch (_) {
        return true;
      }
    }
    const layerIndex = state.map.layers.findIndex((layer) => String(layer.name || '') === layerName);
    if (layerIndex < 0) return true;
    if (state.map.layers.length <= 1) {
      setStatus('最後の layer は TMX から削除できません。MAP 定義だけ削除します。');
      return true;
    }
    state.map.layers.splice(layerIndex, 1);
    state.selectedLayer = clamp(state.selectedLayer, 0, state.map.layers.length - 1);
    state.dirty = true;
    const write = await api.electronAPI.writeCodeFile({ path: resPath(sourcePath), content: buildTmx(state.map) });
    if (!write?.ok) {
      setStatus(`TMX layer 削除保存失敗: ${write?.error || 'unknown'}`);
      return false;
    }
    return true;
  }

  async function saveMap() {
    const mapItem = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    if (!mapItem) {
      setStatus('保存する MAP/TILEMAP 定義を左列で選択してください。');
      return false;
    }
    updateMapSizeFromInputs({ silent: true });
    state.map.name = sourceBaseName(mapItem.entry.sourcePath || mapItem.entry.name || state.map.name);
    state.map.tilesets = normalizeMapTilesetRefs(state.map);
    state.map.tilesetSource = state.map.tilesets[0]?.source || state.map.tilesetSource;
    state.map.layers = state.map.layers.map((layer) => ({ ...layer, collision: isCollisionLayer(layer) }));
    const write = await api.electronAPI.writeCodeFile({
      path: resPath(mapItem.entry.sourcePath),
      content: buildTmx(state.map),
    });
    if (!write?.ok) {
      setStatus(`TMX 保存失敗: ${write?.error || 'unknown'}`);
      return false;
    }
    const collisionWritten = await writeCollisionSourceFiles();
    if (!collisionWritten) return false;
    state.dirty = false;
    setStatus(`保存しました: ${mapItem.entry.sourcePath}`);
    return true;
  }

  async function registerMapResource() {
    const tilesetItem = findAssetByKey(state.selectedTilesetKey, TILE_TYPES);
    if (tilesetItem) await ensurePaletteForTileset(tilesetItem);
    return saveAndSyncLayerResources(getRescompLayer()?.name || findAssetByKey(state.selectedMapKey, MAP_TYPES)?.entry?.tileset || '');
  }

  async function saveAndSyncLayerResources(activeLayerName = '') {
    const saved = await saveMap();
    if (!saved) return false;
    const item = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    if (!item) {
      await api.assets?.reloadResources?.({ keepSelection: true });
      return true;
    }
    activeLayerName = activeLayerName || getRescompLayer()?.name || item.entry.tileset || '';
    const stableTilesets = await ensureStableTilesetIndexingForMap();
    const sync = await syncMapLayerResources(item, activeLayerName);
    if (!sync) return false;
    await refresh();
    const next = findMapBySourceAndLayer(sync.file, sync.sourcePath, activeLayerName) || findMapBySourcePath(sync.sourcePath);
    if (next) {
      state.selectedAssetKey = assetKey(next.file.file, next.entry);
      state.selectedMapKey = state.selectedAssetKey;
      await loadSelectedMap();
      renderAll();
    }
    await api.assets?.reloadResources?.({ keepSelection: true });
    const tilesetNote = stableTilesets ? ` / TILESET ${stableTilesets} 件を gid 安定化` : '';
    setStatus(`MAP layer 定義を同期しました: ${sync.updated} 更新 / ${sync.added} 追加 / ${sync.removed} 削除${tilesetNote}`);
    return true;
  }

  async function ensureStableTilesetIndexingForMap() {
    const mapItem = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    const mapSourcePath = mapItem?.entry?.sourcePath || 'maps/map.tmx';
    const mapDir = dirname(mapSourcePath);
    const refs = new Set((state.map?.tilesets || [])
      .map((tileset) => normalizeRelPath(`${mapDir}/${tileset.source || tileset.sourcePath || ''}`))
      .filter(Boolean));
    if (!refs.size) return 0;

    let updated = 0;
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (String(entry.type || '').toUpperCase() !== 'TILESET') continue;
        if (!refs.has(normalizeRelPath(entry.sourcePath))) continue;
        if (String(entry.opt || '').toUpperCase() === 'NONE') continue;
        const result = await api.electronAPI.updateResEntry({
          file: file.file,
          lineNumber: entry.lineNumber,
          entry: {
            ...entry,
            opt: 'NONE',
            comment: entry.comment || 'TileMap requires stable Tiled gid indexing',
          },
        });
        if (!result?.ok) {
          setStatus(`TILESET gid 安定化失敗: ${result?.error || 'unknown'}`);
          return updated;
        }
        updated += 1;
      }
    }
    return updated;
  }

  async function syncMapLayerResources(item, activeLayerName = '') {
    const sourcePath = normalizeRelPath(item?.entry?.sourcePath || '');
    const fileName = item?.file?.file || firstResFile();
    const layers = getRescompLayers();
    if (!sourcePath || !layers.length) {
      setStatus('ResComp に登録できる layer がありません。');
      return null;
    }

    const currentEntries = findMapEntriesBySource(fileName, sourcePath);
    const targetNames = new Set(layers.map((layer) => layer.name));
    const parentName = sourceBaseName(sourcePath || item.entry.name || 'map');
    let added = 0;
    let updated = 0;
    let removed = 0;

    const obsolete = currentEntries
      .filter((entry) => !targetNames.has(entry.tileset))
      .sort((left, right) => (Number(right.lineNumber) || 0) - (Number(left.lineNumber) || 0));
    for (const entry of obsolete) {
      const result = await api.electronAPI.deleteResEntry({ file: fileName, lineNumber: entry.lineNumber });
      if (!result?.ok) {
        setStatus(`MAP layer 定義削除失敗: ${result?.error || 'unknown'}`);
        return null;
      }
      removed += 1;
    }

    for (const layer of layers) {
      const symbol = layerResourceSymbol(parentName, layer.name);
      const existing = currentEntries.find((entry) => entry.tileset === layer.name);
      const nextEntry = {
        ...(existing || item.entry),
        type: state.mapResourceType || item.entry.type || 'MAP',
        name: symbol,
        sourcePath,
        tileset: layer.name,
        compression: item.entry.compression || 'NONE',
        mapCompression: item.entry.mapCompression || 'NONE',
        mapBase: item.entry.mapBase || '0',
        ordering: item.entry.ordering || 'ROW',
        comment: existing?.comment || item.entry.comment || 'Generated by tilemap-editor',
      };
      if (existing) {
        if (
          existing.name !== nextEntry.name
          || existing.type !== nextEntry.type
          || normalizeRelPath(existing.sourcePath) !== sourcePath
          || existing.tileset !== nextEntry.tileset
        ) {
          const result = await api.electronAPI.updateResEntry({
            file: fileName,
            lineNumber: existing.lineNumber,
            entry: nextEntry,
          });
          if (!result?.ok) {
            setStatus(`MAP layer 定義更新失敗: ${result?.error || 'unknown'}`);
            return null;
          }
          updated += 1;
        }
      } else {
        const add = await api.electronAPI.addResEntry({
          file: fileName,
          entry: nextEntry,
        });
        if (!add?.ok) {
          setStatus(`MAP layer 定義追加失敗: ${add?.error || 'unknown'}`);
          return null;
        }
        added += 1;
      }
    }

    return { file: fileName, sourcePath, added, updated, removed };
  }

  function getRescompLayers() {
    return state.map.layers.filter((layer) => layer?.name);
  }

  function isPriorityLayer(layer) {
    return !!layer?.priority || /\s(priority|prio)$/i.test(String(layer?.name || '').trim());
  }

  function findMapEntriesBySource(fileName, sourcePath) {
    const normalized = normalizeRelPath(sourcePath);
    const file = state.files.find((entry) => entry.file === fileName);
    return (file?.entries || []).filter((entry) => (
      MAP_TYPES.has(String(entry.type || '').toUpperCase())
      && normalizeRelPath(entry.sourcePath) === normalized
    ));
  }

  function layerResourceSymbol(parentName, layerName) {
    const base = normalizeSymbolName(parentName || 'map', 'map');
    const layer = normalizeSymbolName(layerName, 'layer');
    return `${base}_${layer}`;
  }

  function findMapBySourceAndLayer(fileName, sourcePath, layerName) {
    const normalized = normalizeRelPath(String(sourcePath || '').replace(/^res\//, ''));
    for (const file of state.files) {
      if (fileName && file.file !== fileName) continue;
      for (const entry of file.entries) {
        if (!MAP_TYPES.has(String(entry.type || '').toUpperCase())) continue;
        if (normalizeRelPath(entry.sourcePath) === normalized && String(entry.tileset || '') === String(layerName || '')) {
          return { file, entry };
        }
      }
    }
    return null;
  }

  async function addLayer(priority) {
    if (!hasSelectedMap()) {
      setStatus('左列で編集する MAP/TILEMAP 定義を選択してください。');
      return;
    }
    const base = priority ? `${getActiveLayer()?.name || 'Ground'} priority` : `Layer ${state.map.layers.length + 1}`;
    const layer = {
      name: uniqueLayerName(base),
      visible: true,
      opacity: 1,
      priority,
      collision: false,
      data: new Array(state.map.width * state.map.height).fill(0),
    };
    state.map.layers.push(layer);
    state.selectedLayer = state.map.layers.length - 1;
    state.dirty = true;
    renderLayers();
    drawMap();
    await saveAndSyncLayerResources(layer.name);
  }

  async function addCollisionLayer() {
    if (!hasSelectedMap()) {
      setStatus('左列で編集する MAP/TILEMAP 定義を選択してください。');
      return;
    }
    const layer = {
      name: uniqueLayerName('Collision'),
      visible: true,
      opacity: 1,
      priority: false,
      collision: true,
      data: new Array(state.map.width * state.map.height).fill(0),
    };
    state.map.layers.push(layer);
    state.selectedLayer = state.map.layers.length - 1;
    state.dirty = true;
    renderLayers();
    drawMap();
    await saveAndSyncLayerResources(layer.name);
  }

  function ensureCollisionLayerSelected() {
    if (!hasSelectedMap()) {
      setStatus('Collision を塗るには、先に左列で MAP/TILEMAP 定義を選択してください。');
      return false;
    }
    let index = state.map.layers.findIndex((layer) => isCollisionLayer(layer));
    if (index < 0) {
      state.map.layers.push({
        name: uniqueLayerName('Collision'),
        visible: true,
        opacity: 1,
        priority: false,
        collision: true,
        data: new Array(state.map.width * state.map.height).fill(0),
      });
      index = state.map.layers.length - 1;
      state.dirty = true;
      setStatus('Collision layer を追加しました。');
    }
    state.selectedLayer = index;
    renderLayers();
    syncToolButtons();
    drawMap();
    return true;
  }

  async function deleteLayer() {
    if (!hasSelectedMap()) {
      setStatus('左列で編集する MAP/TILEMAP 定義を選択してください。');
      return;
    }
    if (state.map.layers.length <= 1) {
      setStatus('layer は最低 1 つ必要です。');
      return;
    }
    state.map.layers.splice(state.selectedLayer, 1);
    state.selectedLayer = clamp(state.selectedLayer, 0, state.map.layers.length - 1);
    state.dirty = true;
    renderLayers();
    drawMap();
    const activeLayerName = getActiveLayer()?.name || '';
    await saveAndSyncLayerResources(activeLayerName);
  }

  function moveLayer(delta) {
    if (!hasSelectedMap()) return;
    const next = state.selectedLayer + delta;
    if (next < 0 || next >= state.map.layers.length) return;
    const [layer] = state.map.layers.splice(state.selectedLayer, 1);
    state.map.layers.splice(next, 0, layer);
    state.selectedLayer = next;
    state.dirty = true;
    renderLayers();
    drawMap();
  }

  function applyTool(cell, startCell) {
    if (!hasSelectedMap()) {
      setStatus('左列で編集する MAP/TILEMAP 定義を選択してください。');
      return;
    }
    const layer = getActiveLayer();
    if (!layer || layer.visible === false) return;
    const index = cell.y * state.map.width + cell.x;
    if (state.tool === 'eyedropper') {
      if (isCollisionLayer(layer)) {
        state.collisionValue = clamp(layer.data[index] || 0, 0, 255);
        renderCollisionPalette();
      } else {
        const gid = layer.data[index] || 1;
        state.selectedBrush = brushFromGid(gid);
        renderTilesetPalette();
      }
      syncStatus();
      return;
    }
    if (isCollisionLayer(layer)) {
      if (state.tool === 'fill') {
        floodFill(layer, cell.x, cell.y, layer.data[index], state.collisionValue);
      } else if (state.tool === 'rect') {
        fillCollisionRect(layer, startCell, cell);
      } else {
        stampCollision(layer, cell.x, cell.y, state.tool === 'eraser');
      }
      state.dirty = true;
      drawMap();
      return;
    }
    if (state.tool === 'fill') {
      floodFill(layer, cell.x, cell.y, layer.data[index], state.selectedBrush.gid);
    } else if (state.tool === 'rect') {
      fillPatternRect(layer, startCell, cell);
    } else {
      stampBrush(layer, cell.x, cell.y, state.tool === 'eraser');
    }
    state.dirty = true;
    drawMap();
  }

  function beginSelection(cell) {
    const layer = getActiveLayer();
    if (!layer || layer.visible === false) return;
    if (state.selection && state.selection.layerIndex === state.selectedLayer && isInsideSelection(cell, state.selection)) {
      state.selectionDrag = {
        mode: 'move',
        startCell: cell,
        currentCell: cell,
        original: { ...state.selection, data: [...state.selection.data] },
      };
      return;
    }
    state.selectionDrag = { mode: 'select', startCell: cell, currentCell: cell };
    state.selection = null;
  }

  function updateSelection(cell) {
    if (!state.selectionDrag) return;
    state.selectionDrag.currentCell = cell;
  }

  function finishSelection(cell) {
    if (!state.selectionDrag) return;
    updateSelection(cell);
    const drag = state.selectionDrag;
    if (drag.mode === 'move') commitSelectionMove(drag);
    else setSelectionFromCells(drag.startCell, drag.currentCell);
    state.selectionDrag = null;
  }

  function setSelectionFromCells(startCell, endCell) {
    const minX = Math.min(startCell.x, endCell.x);
    const maxX = Math.max(startCell.x, endCell.x);
    const minY = Math.min(startCell.y, endCell.y);
    const maxY = Math.max(startCell.y, endCell.y);
    const selection = {
      layerIndex: state.selectedLayer,
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      data: [],
    };
    selection.data = copyLayerRect(getActiveLayer(), selection);
    state.selection = selection;
  }

  function commitSelectionMove(drag) {
    const layer = getActiveLayer();
    const original = drag.original;
    if (!layer || !original || original.layerIndex !== state.selectedLayer) return;
    const dx = drag.currentCell.x - drag.startCell.x;
    const dy = drag.currentCell.y - drag.startCell.y;
    const nextX = clamp(original.x + dx, 0, Math.max(0, state.map.width - original.w));
    const nextY = clamp(original.y + dy, 0, Math.max(0, state.map.height - original.h));
    writeLayerRect(layer, original, 0);
    writeLayerRect(layer, { ...original, x: nextX, y: nextY }, original.data);
    state.selection = { ...original, x: nextX, y: nextY, data: [...original.data] };
    state.dirty = true;
  }

  function clearSelection() {
    const selection = state.selection;
    const layer = state.map.layers[selection.layerIndex];
    if (!layer) return;
    writeLayerRect(layer, selection, 0);
    state.selection = null;
    state.dirty = true;
    drawMap();
  }

  function copyLayerRect(layer, rect) {
    const data = [];
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        data.push(layer?.data?.[(rect.y + y) * state.map.width + rect.x + x] || 0);
      }
    }
    return data;
  }

  function writeLayerRect(layer, rect, valueOrData) {
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        const dx = rect.x + x;
        const dy = rect.y + y;
        if (dx < 0 || dy < 0 || dx >= state.map.width || dy >= state.map.height) continue;
        const value = Array.isArray(valueOrData) ? (valueOrData[y * rect.w + x] || 0) : valueOrData;
        layer.data[dy * state.map.width + dx] = value;
      }
    }
  }

  function isInsideSelection(cell, selection) {
    return cell.x >= selection.x && cell.y >= selection.y && cell.x < selection.x + selection.w && cell.y < selection.y + selection.h;
  }

  function stampBrush(layer, startX, startY, erase = false) {
    const columns = activeTilesetColumns();
    const firstgid = activeTilesetFirstGid();
    for (let by = 0; by < state.selectedBrush.h; by += 1) {
      for (let bx = 0; bx < state.selectedBrush.w; bx += 1) {
        const x = startX + bx;
        const y = startY + by;
        if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
        const gid = erase ? 0 : (firstgid + ((state.selectedBrush.y + by) * columns + state.selectedBrush.x + bx));
        layer.data[y * state.map.width + x] = gid;
      }
    }
  }

  function fillPatternRect(layer, startCell, endCell) {
    const minX = Math.min(startCell.x, endCell.x);
    const maxX = Math.max(startCell.x, endCell.x);
    const minY = Math.min(startCell.y, endCell.y);
    const maxY = Math.max(startCell.y, endCell.y);
    const columns = activeTilesetColumns();
    const firstgid = activeTilesetFirstGid();
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        layer.data[y * state.map.width + x] = repeatedBrushGid(state.selectedBrush, columns, firstgid, x - minX, y - minY);
      }
    }
  }

  function stampCollision(layer, startX, startY, erase = false) {
    const value = erase ? 0 : state.collisionValue;
    for (let by = 0; by < state.selectedBrush.h; by += 1) {
      for (let bx = 0; bx < state.selectedBrush.w; bx += 1) {
        const x = startX + bx;
        const y = startY + by;
        if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
        layer.data[y * state.map.width + x] = value;
      }
    }
  }

  function fillCollisionRect(layer, startCell, endCell) {
    const minX = Math.min(startCell.x, endCell.x);
    const maxX = Math.max(startCell.x, endCell.x);
    const minY = Math.min(startCell.y, endCell.y);
    const maxY = Math.max(startCell.y, endCell.y);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) layer.data[y * state.map.width + x] = state.collisionValue;
    }
  }

  function floodFill(layer, x, y, fromTile, toTile) {
    if (fromTile === toTile) return;
    const queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.pop();
      if (cx < 0 || cy < 0 || cx >= state.map.width || cy >= state.map.height) continue;
      const idx = cy * state.map.width + cx;
      if (layer.data[idx] !== fromTile) continue;
      layer.data[idx] = toTile;
      queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  function renderAll() {
    renderFilters();
    renderAssetTree();
    renderTilesetTree();
    renderWarnings();
    renderTilesetPalette();
    renderCollisionPalette();
    renderLayers();
    drawMap();
    syncMapInputs();
    syncToolButtons();
    syncRightAccordion();
    syncStatus();
  }

  function renderFilters() {
    renderFileFilter(ui.assetFileFilter, state.assetFileFilter, state.files, '.res ファイル');
    renderFileFilter(ui.tilesetFileFilter, state.tilesetFileFilter, state.files, '.res ファイル');
  }

  function renderAssetTree() {
    renderMapResourceTree({
      target: ui.assetTree,
      types: MAP_TYPES,
      expanded: state.expandedAssets,
      fileFilter: state.assetFileFilter,
      keyword: state.assetKeyword,
      selectedKey: state.selectedAssetKey,
      fileToggleAttr: 'asset-file-toggle',
      itemAttr: 'asset-key',
      emptyText: 'MAP / TILEMAP 定義がありません',
    });
  }

  function renderTilesetTree() {
    renderResourceTree({
      target: ui.tilesetTree,
      types: TILE_TYPES,
      expanded: state.expandedTilesets,
      fileFilter: state.tilesetFileFilter,
      keyword: state.tilesetKeyword,
      selectedKey: state.selectedTilesetKey,
      fileToggleAttr: 'tileset-file-toggle',
      itemAttr: 'tileset-key',
      emptyText: 'TILESET 定義がありません',
    });
  }

  function renderMapResourceTree({ target, types, expanded, fileFilter, keyword, selectedKey, fileToggleAttr, itemAttr, emptyText }) {
    const files = state.files
      .filter((file) => !fileFilter || file.file === fileFilter)
      .map((file) => ({
        ...file,
        entries: file.entries.filter((entry) => {
          const type = String(entry.type || '').toUpperCase();
          if (!types.has(type)) return false;
          const haystack = `${entry.name || ''} ${entry.sourcePath || ''} ${type}`.toLowerCase();
          return !keyword || haystack.includes(keyword);
        }),
      }))
      .filter((file) => file.entries.length > 0);

    if (!files.length) {
      target.innerHTML = `<div class="tilemap-empty">${emptyText}</div>`;
      return;
    }

    target.innerHTML = files.map((file) => {
      const isOpen = expanded.has(file.file);
      const groups = groupMapEntries(file.entries);
      const children = isOpen ? groups.map((group) => mapResourceGroupHtml(file.file, group, selectedKey, itemAttr)).join('') : '';
      return `
        <section class="tilemap-resource-file">
          <button class="tilemap-resource-file-toggle" type="button" data-${fileToggleAttr}="${esc(file.file)}">
            <span>${isOpen ? '▾' : '▸'}</span>
            <span>${esc(file.file)}</span>
            <span class="tilemap-resource-count">${groups.length}</span>
          </button>
          ${children}
        </section>
      `;
    }).join('');
    void renderResourceThumbs(target, itemAttr);
  }

  function renderResourceTree({ target, types, expanded, fileFilter, keyword, selectedKey, fileToggleAttr, itemAttr, emptyText }) {
    const files = state.files
      .filter((file) => !fileFilter || file.file === fileFilter)
      .map((file) => ({
        ...file,
        entries: file.entries.filter((entry) => {
          const type = String(entry.type || '').toUpperCase();
          if (!types.has(type)) return false;
          const haystack = `${entry.name || ''} ${entry.sourcePath || ''} ${type}`.toLowerCase();
          return !keyword || haystack.includes(keyword);
        }),
      }))
      .filter((file) => file.entries.length > 0);

    if (!files.length) {
      target.innerHTML = `<div class="tilemap-empty">${emptyText}</div>`;
      return;
    }

    target.innerHTML = files.map((file) => {
      const isOpen = expanded.has(file.file);
      const children = isOpen ? file.entries.map((entry) => resourceItemHtml(file.file, entry, selectedKey, itemAttr)).join('') : '';
      return `
        <section class="tilemap-resource-file">
          <button class="tilemap-resource-file-toggle" type="button" data-${fileToggleAttr}="${esc(file.file)}">
            <span>${isOpen ? '▾' : '▸'}</span>
            <span>${esc(file.file)}</span>
            <span class="tilemap-resource-count">${file.entries.length}</span>
          </button>
          ${children}
        </section>
      `;
    }).join('');
    void renderResourceThumbs(target, itemAttr);
  }

  function groupMapEntries(entries) {
    const groups = new Map();
    entries.forEach((entry) => {
      const source = normalizeRelPath(entry.sourcePath || '');
      if (!groups.has(source)) groups.set(source, { sourcePath: source, entries: [] });
      groups.get(source).entries.push(entry);
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: group.entries.slice().sort((left, right) => String(left.tileset || left.name).localeCompare(String(right.tileset || right.name), undefined, { numeric: true })),
      }))
      .sort((left, right) => String(left.sourcePath).localeCompare(String(right.sourcePath), undefined, { numeric: true }));
  }

  function mapResourceGroupHtml(file, group, selectedKey, itemAttr) {
    if (group.entries.length <= 1) {
      return resourceItemHtml(file, group.entries[0], selectedKey, itemAttr);
    }
    const first = group.entries[0];
    const parentKey = assetKey(file, first);
    const active = group.entries.some((entry) => assetKey(file, entry) === selectedKey);
    const title = sourceBaseName(group.sourcePath || first.name || 'map');
    const layerCount = group.entries.length;
    const children = group.entries.map((entry) => resourceItemHtml(file, entry, selectedKey, itemAttr, { child: true })).join('');
    return `
      <div class="tilemap-resource-group ${active ? 'active' : ''}">
        <div class="tilemap-resource-item tilemap-resource-parent ${active ? 'active' : ''}" role="button" tabindex="0" data-${itemAttr}="${esc(parentKey)}">
          <canvas class="tilemap-resource-thumb" width="48" height="40" data-thumb-key="${esc(parentKey)}"></canvas>
          <span class="tilemap-resource-main">
            <span class="tilemap-resource-title">${esc(title)}</span>
            <span class="tilemap-resource-meta">${esc(group.sourcePath)} / ${layerCount} layers</span>
          </span>
        </div>
        <div class="tilemap-resource-children">
          ${children}
        </div>
      </div>
    `;
  }

  function resourceItemHtml(file, entry, selectedKey, itemAttr, options = {}) {
    const key = assetKey(file, entry);
    const type = String(entry.type || '').toUpperCase();
    const active = key === selectedKey;
    const meta = type === 'TILESET'
      ? entry.sourcePath || ''
      : `${entry.sourcePath || ''}${entry.tileset ? ` / ${entry.tileset}` : ''}`;
    const actions = active ? resourceItemActions(type) : '';
    return `
      <div class="tilemap-resource-item ${options.child ? 'tilemap-resource-child' : ''} ${active ? 'active' : ''}" role="button" tabindex="0" data-${itemAttr}="${esc(key)}">
        <canvas class="tilemap-resource-thumb" width="48" height="40" data-thumb-key="${esc(key)}"></canvas>
        <span class="tilemap-resource-main">
          <span class="tilemap-resource-title">${esc(entry.name)}${active && state.dirty && MAP_TYPES.has(type) ? ' *' : ''}</span>
          <span class="tilemap-resource-meta">${esc(type)} ${esc(meta)}</span>
          ${type === 'TILESET' ? `<span class="tilemap-resource-palette" data-palette-key="${esc(key)}" aria-label="TILESET palette preview"></span>` : ''}
        </span>
        ${actions}
      </div>
    `;
  }

  function resourceItemActions(type) {
    if (MAP_TYPES.has(type)) {
      return `
        <span class="tilemap-resource-actions">
          <button class="tilemap-resource-icon tilemap-resource-primary" type="button" data-tilemap-action="save" title="保存" aria-label="保存"><svg class="icon"><use href="#icon-save"></use></svg></button>
          <button class="tilemap-resource-icon tilemap-resource-danger" type="button" data-tilemap-action="delete" title="削除" aria-label="削除"><svg class="icon"><use href="#icon-trash"></use></svg></button>
        </span>
      `;
    }
    if (TILE_TYPES.has(type)) {
      return `
        <span class="tilemap-resource-actions">
          <button class="tilemap-resource-icon tilemap-resource-danger" type="button" data-tilemap-action="delete" title="削除" aria-label="削除"><svg class="icon"><use href="#icon-trash"></use></svg></button>
        </span>
      `;
    }
    return '';
  }

  async function renderResourceThumbs(target) {
    const canvases = Array.from(target.querySelectorAll('[data-thumb-key]'));
    for (const canvas of canvases) {
      const item = findAssetByKey(canvas.dataset.thumbKey);
      if (!item) continue;
      try {
        if (String(item.entry.type).toUpperCase() === 'TILESET') {
          await drawTilesetThumb(canvas, item.entry);
        } else {
          await drawMapThumb(canvas, item.entry);
        }
      } catch (err) {
        logger.warn(`TileMap thumbnail failed: ${String(err?.message || err)}`);
      }
    }
    const palettes = Array.from(target.querySelectorAll('[data-palette-key]'));
    for (const palette of palettes) {
      const item = findAssetByKey(palette.dataset.paletteKey);
      if (!item || String(item.entry.type || '').toUpperCase() !== 'TILESET') continue;
      try {
        await renderTilesetPalettePreview(palette, item.entry);
      } catch (err) {
        logger.warn(`TileMap palette preview failed: ${String(err?.message || err)}`);
      }
    }
  }

  async function drawTilesetThumb(canvas, entry) {
    const loaded = await loadTilesetPreviewImage(entry);
    if (!loaded?.img) return;
    const { img } = loaded;
    drawContainImage(canvas, img);
  }

  async function renderTilesetPalettePreview(target, entry) {
    const loaded = await loadTilesetPreviewImage(entry);
    if (!loaded?.img) {
      target.innerHTML = '';
      return;
    }
    const colors = sampleImagePaletteColors(loaded.img, 16);
    target.innerHTML = Array.from({ length: 16 }, (_unused, index) => {
      const color = colors[index] || (index === 0 ? 'rgba(0,0,0,0)' : '#000000');
      return `<span class="tilemap-resource-palette-swatch ${index === 0 ? 'transparent' : ''}" style="background:${esc(color)}" title="${index}: ${esc(color)}"></span>`;
    }).join('');
  }

  function sampleImagePaletteColors(img, limit = 16) {
    const canvas = document.createElement('canvas');
    const width = Math.max(1, img.naturalWidth || img.width || 1);
    const height = Math.max(1, img.naturalHeight || img.height || 1);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const colors = ['rgba(0,0,0,0)'];
    const seen = new Set(colors);
    for (let i = 0; i < data.length && colors.length < limit; i += 4) {
      const color = rgbaString(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (seen.has(color)) continue;
      seen.add(color);
      colors.push(color);
    }
    return colors;
  }

  function rgbaString(r, g, b, a) {
    if (a <= 0) return 'rgba(0,0,0,0)';
    return `rgba(${r},${g},${b},${Number((a / 255).toFixed(3))})`;
  }

  async function drawMapThumb(canvas, entry) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#101722';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const mapRead = await api.electronAPI.readCodeFile({ path: resPath(entry.sourcePath) });
    if (!mapRead?.ok) {
      drawMapThumbFallback(canvas, entry);
      return;
    }
    const parsed = parseTmx(mapRead.content);
    const mapDir = dirname(entry.sourcePath);
    const tsxSource = parsed.tilesetSource ? normalizeMapTileSource(parsed.tilesetSource) : '';
    const tsxRel = tsxSource ? normalizeRelPath(`${mapDir}/${tsxSource}`) : '';
    const tilesetEntry = tsxRel ? findTilesetBySourcePath(tsxRel)?.entry : null;
    const loaded = tilesetEntry ? await loadTilesetPreviewImage(tilesetEntry) : null;
    if (!loaded?.img) {
      drawMapThumbFallback(canvas, entry);
      return;
    }
    drawMapPreview(canvas, parsed, loaded.img, loaded.tsx);
  }

  function drawMapThumbFallback(canvas, entry) {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#4aa3ff';
    ctx.strokeRect(8.5, 8.5, 31, 23);
    ctx.fillStyle = '#4aa3ff';
    ctx.fillText(String(entry.type || 'MAP'), 8, 34);
  }

  function drawMapPreview(canvas, map, tilesetImage, tsx) {
    const ctx = canvas.getContext('2d');
    const layer = map.layers.find((candidate) => candidate.visible !== false && !isCollisionLayer(candidate)) || map.layers[0];
    if (!layer) return;
    const tw = Math.max(1, Number(tsx?.tileWidth || map.tileWidth) || 8);
    const th = Math.max(1, Number(tsx?.tileHeight || map.tileHeight) || 8);
    const columns = Math.max(1, Number(tsx?.tilesetColumns) || Math.floor(tilesetImage.naturalWidth / tw) || 1);
    const scale = Math.min(canvas.width / Math.max(1, map.width * tw), canvas.height / Math.max(1, map.height * th));
    const ox = Math.floor((canvas.width - map.width * tw * scale) / 2);
    const oy = Math.floor((canvas.height - map.height * th * scale) / 2);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const gid = layer.data[y * map.width + x] || 0;
        if (gid <= 0) continue;
        const tile = gid - 1;
        const sx = (tile % columns) * tw;
        const sy = Math.floor(tile / columns) * th;
        ctx.drawImage(tilesetImage, sx, sy, tw, th, ox + x * tw * scale, oy + y * th * scale, Math.max(1, tw * scale), Math.max(1, th * scale));
      }
    }
  }

  function activeTileset() {
    return state.activeTileset || state.loadedTilesets[0] || null;
  }

  function activeTileWidth() {
    return Math.max(1, Number(activeTileset()?.tileWidth || state.map.tileWidth) || 8);
  }

  function activeTileHeight() {
    return Math.max(1, Number(activeTileset()?.tileHeight || state.map.tileHeight) || 8);
  }

  function activeTilesetColumns() {
    return Math.max(1, Number(activeTileset()?.columns || state.map.tilesetColumns) || 1);
  }

  function activeTilesetTileCount() {
    return Math.max(1, Number(activeTileset()?.tileCount || state.map.tilesetTileCount) || 1);
  }

  function activeTilesetFirstGid() {
    return Math.max(1, Number(activeTileset()?.firstgid) || 1);
  }

  function findLoadedTilesetForGid(gid) {
    const tileGid = Number(gid) || 0;
    const sorted = [...state.loadedTilesets].sort((left, right) => right.firstgid - left.firstgid);
    return sorted.find((tileset) => {
      const firstgid = Math.max(1, Number(tileset.firstgid) || 1);
      const tileCount = Math.max(1, Number(tileset.tileCount) || 1);
      return tileGid >= firstgid && tileGid < firstgid + tileCount;
    }) || sorted.find((tileset) => tileGid >= tileset.firstgid) || null;
  }

  function renderWarnings() {
    ui.warningList.hidden = !state.warnings.length;
    ui.warningList.innerHTML = state.warnings.map((warning) => `<div>${esc(warning)}</div>`).join('');
  }

  function renderTilesetPalette() {
    const canvas = ui.tilesetCanvas;
    const ctx = canvas.getContext('2d');
    updateTilesetMetrics();
    const tw = activeTileWidth();
    const th = activeTileHeight();
    const columns = activeTilesetColumns();
    const rows = Math.max(1, Math.ceil(activeTilesetTileCount() / columns));
    canvas.width = Math.max(tw, columns * tw);
    canvas.height = Math.max(th, rows * th);
    canvas.style.width = `${Math.max(1, canvas.width * state.paletteZoom)}px`;
    canvas.style.height = `${Math.max(1, canvas.height * state.paletteZoom)}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#101722';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.tilesetImage) ctx.drawImage(state.tilesetImage, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    for (let x = 0; x <= canvas.width; x += tw) line(ctx, x, 0, x, canvas.height);
    for (let y = 0; y <= canvas.height; y += th) line(ctx, 0, y, canvas.width, y);
    const sx = state.selectedBrush.x * tw;
    const sy = state.selectedBrush.y * th;
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, Math.max(1, state.selectedBrush.w * tw - 2), Math.max(1, state.selectedBrush.h * th - 2));
    ui.brushInfo.textContent = `${state.selectedBrush.w} x ${state.selectedBrush.h} / gid ${state.selectedBrush.gid}`;
  }

  function renderLayers() {
    ui.layerList.innerHTML = state.map.layers.map((layer, index) => `
      <div class="tilemap-layer-item ${index === state.selectedLayer ? 'active' : ''} ${isCollisionLayer(layer) ? 'collision' : layer.priority ? 'priority' : ''}" data-layer-select="${index}">
        <button class="icon-btn icon-btn-xs" type="button" data-layer-visible="${index}" title="${layer.visible === false ? '表示' : '非表示'}" aria-pressed="${layer.visible !== false}">
          <svg class="icon"><use href="#icon-eye"></use></svg>
        </button>
        <input class="tilemap-input" data-layer-name="${index}" value="${esc(layer.name)}">
        <span class="tilemap-layer-meta">${isCollisionLayer(layer) ? 'collision' : layer.priority ? 'priority' : `${state.map.width}x${state.map.height}`}</span>
      </div>
    `).join('');
  }

  function renderCollisionPalette() {
    ui.collisionPalette.innerHTML = COLLISION_TYPES.map((type) => `
      <button class="tilemap-collision-chip ${Number(state.collisionValue) === type.value ? 'active' : ''}" type="button" data-collision-value="${type.value}" title="${esc(type.label)}: ${esc(type.description || '')}">
        <span class="tilemap-collision-swatch" style="background:${collisionColor(type.value)}"></span>
        <span>${esc(type.label)}</span>
      </button>
    `).join('');
  }

  function drawMap(options = {}) {
    const canvas = ui.mapCanvas;
    const ctx = canvas.getContext('2d');
    const scale = state.zoom;
    const tw = state.map.tileWidth;
    const th = state.map.tileHeight;
    const w = state.map.width;
    const h = state.map.height;
    canvas.width = Math.max(1, w * tw * scale);
    canvas.height = Math.max(1, h * th * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.map.layers.forEach((layer, index) => {
      if (layer.visible === false) return;
      drawLayer(ctx, layer, scale, index === state.selectedLayer);
    });
    if (state.showGrid) drawGrid(ctx, w * tw * scale, h * th * scale, tw * scale, th * scale);
    if (options.rectEnd && state.dragStart) {
      const minX = Math.min(state.dragStart.x, options.rectEnd.x);
      const maxX = Math.max(state.dragStart.x, options.rectEnd.x);
      const minY = Math.min(state.dragStart.y, options.rectEnd.y);
      const maxY = Math.max(state.dragStart.y, options.rectEnd.y);
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = 2;
      ctx.strokeRect(minX * tw * scale + 1, minY * th * scale + 1, (maxX - minX + 1) * tw * scale - 2, (maxY - minY + 1) * th * scale - 2);
    }
    drawSelectionOverlay(ctx, scale);
    syncStatus();
  }

  function drawSelectionOverlay(ctx, scale) {
    const tw = state.map.tileWidth;
    const th = state.map.tileHeight;
    let rect = state.selection;
    if (state.selectionDrag?.mode === 'select') {
      const start = state.selectionDrag.startCell;
      const current = state.selectionDrag.currentCell;
      rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x) + 1,
        h: Math.abs(current.y - start.y) + 1,
        layerIndex: state.selectedLayer,
      };
    } else if (state.selectionDrag?.mode === 'move') {
      const original = state.selectionDrag.original;
      const dx = state.selectionDrag.currentCell.x - state.selectionDrag.startCell.x;
      const dy = state.selectionDrag.currentCell.y - state.selectionDrag.startCell.y;
      rect = {
        ...original,
        x: clamp(original.x + dx, 0, Math.max(0, state.map.width - original.w)),
        y: clamp(original.y + dy, 0, Math.max(0, state.map.height - original.h)),
      };
    }
    if (!rect || rect.layerIndex !== state.selectedLayer) return;
    ctx.save();
    ctx.strokeStyle = '#f2c94c';
    ctx.fillStyle = 'rgba(242,201,76,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(rect.x * tw * scale, rect.y * th * scale, rect.w * tw * scale, rect.h * th * scale);
    ctx.strokeRect(rect.x * tw * scale + 1, rect.y * th * scale + 1, rect.w * tw * scale - 2, rect.h * th * scale - 2);
    ctx.restore();
  }

  function drawLayer(ctx, layer, scale, selectedLayer) {
    const tw = state.map.tileWidth;
    const th = state.map.tileHeight;
    ctx.save();
    if (!selectedLayer) ctx.globalAlpha = state.inactiveLayerOpacity;
    if (isCollisionLayer(layer)) {
      drawCollisionLayer(ctx, layer, scale, selectedLayer);
      ctx.restore();
      return;
    }
    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        const gid = layer.data[y * state.map.width + x] || 0;
        if (gid <= 0) continue;
        const dx = x * tw * scale;
        const dy = y * th * scale;
        const tileset = findLoadedTilesetForGid(gid);
        const columns = Math.max(1, Number(tileset?.columns || state.map.tilesetColumns) || 1);
        const localTile = Math.max(0, gid - Math.max(1, Number(tileset?.firstgid) || 1));
        const sx = (localTile % columns) * tw;
        const sy = Math.floor(localTile / columns) * th;
        if (tileset?.image) {
          ctx.drawImage(tileset.image, sx, sy, tw, th, dx, dy, tw * scale, th * scale);
        } else {
          ctx.strokeStyle = 'rgba(242,201,76,0.45)';
          ctx.strokeRect(dx + 1, dy + 1, Math.max(1, tw * scale - 2), Math.max(1, th * scale - 2));
        }
        if (state.showPriority && layer.priority) {
          ctx.fillStyle = 'rgba(242,201,76,0.28)';
          ctx.fillRect(dx, dy, tw * scale, th * scale);
        }
        if (selectedLayer) {
          ctx.strokeStyle = 'rgba(74,163,255,0.22)';
          ctx.strokeRect(dx + 0.5, dy + 0.5, tw * scale - 1, th * scale - 1);
        }
      }
    }
    ctx.restore();
  }

  function drawCollisionLayer(ctx, layer, scale, selectedLayer) {
    const tw = state.map.tileWidth;
    const th = state.map.tileHeight;
    ctx.save();
    ctx.font = `${Math.max(8, Math.floor(th * scale * 0.65))}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        const value = layer.data[y * state.map.width + x] || 0;
        if (!value) continue;
        const dx = x * tw * scale;
        const dy = y * th * scale;
        ctx.fillStyle = collisionColor(value, 0.38);
        ctx.fillRect(dx, dy, tw * scale, th * scale);
        ctx.strokeStyle = collisionColor(value, 0.82);
        ctx.strokeRect(dx + 0.5, dy + 0.5, tw * scale - 1, th * scale - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        ctx.fillText(collisionGlyph(value), dx + (tw * scale) / 2, dy + (th * scale) / 2);
        if (selectedLayer) {
          ctx.strokeStyle = 'rgba(74,163,255,0.35)';
          ctx.strokeRect(dx + 2.5, dy + 2.5, tw * scale - 5, th * scale - 5);
        }
      }
    }
    ctx.restore();
  }

  function updateMapSizeFromInputs(options = {}) {
    const oldW = state.map.width;
    const oldH = state.map.height;
    const nextW = snapMapSize(ui.mapWidth.value || oldW);
    const nextH = snapMapSize(ui.mapHeight.value || oldH);
    ui.mapWidth.value = String(nextW);
    ui.mapHeight.value = String(nextH);
    if (nextW === oldW && nextH === oldH) return;
    state.map.layers = state.map.layers.map((layer) => ({
      ...layer,
      data: resizeLayerData(layer.data, oldW, oldH, nextW, nextH),
    }));
    state.map.width = nextW;
    state.map.height = nextH;
    state.dirty = true;
    if (!options.silent) renderAll();
  }

  function updateTilesetMetrics() {
    const tw = Math.max(1, state.map.tileWidth);
    const th = Math.max(1, state.map.tileHeight);
    const imageW = Math.max(tw, Number(state.map.tilesetImageWidth) || tw);
    const imageH = Math.max(th, Number(state.map.tilesetImageHeight) || th);
    state.map.tilesetColumns = Math.max(1, Math.floor(imageW / tw));
    state.map.tilesetTileCount = Math.max(1, state.map.tilesetColumns * Math.floor(imageH / th));
  }

  function setBrushFromTileRange(start, end) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const columns = activeTilesetColumns();
    const firstgid = activeTilesetFirstGid();
    state.selectedBrush = {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      gid: firstgid + minY * columns + minX,
    };
    renderTilesetPalette();
    syncStatus();
  }

  function brushFromGid(gid) {
    const tileset = findLoadedTilesetForGid(gid) || activeTileset();
    const firstgid = Math.max(1, Number(tileset?.firstgid) || 1);
    const tile = Math.max(0, Number(gid || firstgid) - firstgid);
    const columns = Math.max(1, Number(tileset?.columns || activeTilesetColumns()) || 1);
    if (tileset?.source) {
      const found = findTilesetByMapSource(tileset.source);
      if (found) state.selectedTilesetKey = assetKey(found.file.file, found.entry);
      state.activeTileset = tileset;
      state.tilesetImage = tileset.image || state.tilesetImage;
    }
    return { x: tile % columns, y: Math.floor(tile / columns), w: 1, h: 1, gid: tile + firstgid };
  }

  function eventToTilesetTile(event) {
    const pos = canvasPoint(event, ui.tilesetCanvas);
    const x = Math.floor(pos.x / activeTileWidth());
    const y = Math.floor(pos.y / activeTileHeight());
    const columns = activeTilesetColumns();
    const rows = Math.max(1, Math.ceil(activeTilesetTileCount() / columns));
    if (x < 0 || y < 0 || x >= columns || y >= rows) return null;
    return { x, y };
  }

  function eventToMapCell(event) {
    const pos = canvasPoint(event, ui.mapCanvas);
    const x = Math.floor(pos.x / (state.map.tileWidth * state.zoom));
    const y = Math.floor(pos.y / (state.map.tileHeight * state.zoom));
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
    return { x, y };
  }

  function handleWheelZoom(event) {
    event.preventDefault();
    const wrap = ui.mapCanvasWrap;
    const rect = wrap.getBoundingClientRect();
    const anchorX = event.clientX - rect.left + wrap.scrollLeft;
    const anchorY = event.clientY - rect.top + wrap.scrollTop;
    const oldZoom = state.zoom;
    const nextZoom = wheelZoomValue(oldZoom, event.deltaY);
    if (nextZoom === oldZoom) return;
    setZoom(nextZoom, { silent: true });
    const ratio = nextZoom / oldZoom;
    wrap.scrollLeft = anchorX * ratio - (event.clientX - rect.left);
    wrap.scrollTop = anchorY * ratio - (event.clientY - rect.top);
    drawMap();
  }

  function handlePaletteWheelZoom(event) {
    event.preventDefault();
    const wrap = ui.tilesetWrap;
    const rect = wrap.getBoundingClientRect();
    const anchorX = event.clientX - rect.left + wrap.scrollLeft;
    const anchorY = event.clientY - rect.top + wrap.scrollTop;
    const oldZoom = state.paletteZoom;
    const nextZoom = wheelZoomValue(oldZoom, event.deltaY);
    if (nextZoom === oldZoom) return;
    setPaletteZoom(nextZoom, { silent: true });
    const ratio = nextZoom / oldZoom;
    wrap.scrollLeft = anchorX * ratio - (event.clientX - rect.left);
    wrap.scrollTop = anchorY * ratio - (event.clientY - rect.top);
    renderTilesetPalette();
  }

  function setZoom(value, options = {}) {
    state.zoom = clamp(Number(value) || 2, 0.5, 8);
    ui.zoom.value = String(state.zoom);
    if (!options.silent) drawMap();
  }

  function setPaletteZoom(value, options = {}) {
    state.paletteZoom = clamp(Number(value) || 2, 0.5, 8);
    ui.paletteZoom.value = String(state.paletteZoom);
    if (!options.silent) renderTilesetPalette();
  }

  function syncMapInputs() {
    ui.mapWidth.value = String(state.map.width || 40);
    ui.mapHeight.value = String(state.map.height || 28);
    ui.gridToggle.checked = state.showGrid;
    ui.priorityToggle.checked = state.showPriority;
    ui.inactiveOpacity.value = String(state.inactiveLayerOpacity);
    ui.zoom.value = String(state.zoom);
    ui.paletteZoom.value = String(state.paletteZoom);
  }

  function syncToolButtons() {
    ui.toolButtons.forEach((button) => {
      const active = button.dataset.tool === state.tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function syncStatus() {
    const mapItem = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    const tilesetItem = findAssetByKey(state.selectedTilesetKey, TILE_TYPES);
    const cell = state.hoverCell ? ` x:${state.hoverCell.x} y:${state.hoverCell.y}` : '';
    const selection = state.selection ? ` / selection ${state.selection.w}x${state.selection.h}` : '';
    const dirty = state.dirty ? ' / 未保存' : '';
    ui.status.textContent = `${mapItem?.entry?.name || 'MAP未選択'} / ${tilesetItem?.entry?.name || 'TILESET未選択'} / ${TOOL_LABELS[state.tool]} / brush ${state.selectedBrush.w}x${state.selectedBrush.h}${cell}${selection}${dirty}`;
  }

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function getActiveLayer() {
    return state.map.layers[state.selectedLayer] || null;
  }

  function findLayerIndex(name) {
    const index = state.map.layers.findIndex((layer) => layer.name === name);
    return index >= 0 ? index : 0;
  }

  function uniqueLayerName(base) {
    const names = new Set(state.map.layers.map((layer) => layer.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  function isCollisionLayer(layer) {
    return !!layer?.collision || /^collision(?::|$)/i.test(String(layer?.name || '').trim());
  }

  function getRescompLayer() {
    const active = getActiveLayer();
    if (active && !isPriorityLayer(active) && !isCollisionLayer(active)) return active;
    return state.map.layers.find((layer) => !isPriorityLayer(layer) && !isCollisionLayer(layer)) || state.map.layers[0];
  }

  async function writeCollisionSourceFiles() {
    const maps = await collectProjectCollisionMaps();
    const header = buildCollisionHeader(maps);
    const source = buildCollisionSource(maps);
    const headerWrite = await api.electronAPI.writeCodeFile({ path: 'inc/tilemap_collision.h', content: header });
    if (!headerWrite?.ok) {
      setStatus(`collision header 生成失敗: ${headerWrite?.error || 'unknown'}`);
      return false;
    }
    const sourceWrite = await api.electronAPI.writeCodeFile({ path: 'src/tilemap_collision.c', content: source });
    if (!sourceWrite?.ok) {
      setStatus(`collision source 生成失敗: ${sourceWrite?.error || 'unknown'}`);
      return false;
    }
    return true;
  }

  async function collectProjectCollisionMaps() {
    const out = [];
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (!MAP_TYPES.has(String(entry.type || '').toUpperCase()) || !entry.sourcePath) continue;
        let map = null;
        if (assetKey(file.file, entry) === state.selectedMapKey) {
          map = { ...state.map, name: entry.name || state.map.name };
        } else {
          const read = await api.electronAPI.readCodeFile({ path: resPath(entry.sourcePath) });
          if (!read?.ok) continue;
          try {
            map = { ...parseTmx(read.content), name: entry.name || 'map' };
          } catch {
            map = null;
          }
        }
        if (!map) continue;
        out.push(...extractCollisionMaps(map, entry.name || map.name));
      }
    }
    return out;
  }

  function firstResFile() {
    return state.files.find((file) => file.file)?.file || 'resources.res';
  }

  async function getProjectDir() {
    const project = await api.electronAPI.getCurrentProject?.();
    const dir = project?.projectDir || project?.dir || project?.currentProjectDir || '';
    return dir ? String(dir).replace(/\\/g, '/') : '';
  }

  async function loadTilesetPreviewImage(entry) {
    if (!entry?.sourcePath) return null;
    const tsxRead = await api.electronAPI.readCodeFile({ path: resPath(entry.sourcePath) });
    if (!tsxRead?.ok) return null;
    const tsx = parseTsx(tsxRead.content);
    const projectDir = await getProjectDir();
    if (!projectDir || !tsx.tilesetImage) return null;
    const imageRel = normalizeRelPath(`${dirname(entry.sourcePath)}/${tsx.tilesetImage}`);
    const read = await api.electronAPI.readFileAsDataUrl(`${projectDir}/res/${imageRel}`);
    if (!read?.ok || !read.dataUrl) return null;
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode();
    return { img: makePaletteZeroTransparentImage(img, read.dataUrl), rawImage: img, tsx, absolutePath: `${projectDir}/res/${imageRel}` };
  }

  async function loadMapTilesets(mapSourcePath, options = {}) {
    const refs = normalizeMapTilesetRefs(state.map);
    state.map.tilesets = refs;
    state.loadedTilesets = [];
    const kept = [];
    const missing = [];
    for (const ref of refs) {
      const loaded = await loadMapTilesetRef(ref, mapSourcePath);
      if (loaded) {
        state.loadedTilesets.push(loaded);
        kept.push(ref);
      } else {
        missing.push(ref);
      }
    }
    if (options.pruneMissing && missing.length) {
      state.map.tilesets = kept;
      state.map.tilesetSource = kept[0]?.source || '';
      if (!kept.length) state.map.tilesetName = '';
    }
    return { loaded: state.loadedTilesets, missing };
  }

  async function loadMapTilesetRef(ref, mapSourcePath) {
    const projectDir = await getProjectDir();
    if (!projectDir || !ref?.source) return null;
    const mapDir = dirname(mapSourcePath || 'maps/map.tmx');
    const tsxRel = normalizeRelPath(`${mapDir}/${ref.source}`);
    const tsxRead = await api.electronAPI.readCodeFile({ path: resPath(tsxRel) });
    if (!tsxRead?.ok) return null;
    const tsx = parseTsx(tsxRead.content);
    const imageRel = normalizeRelPath(`${dirname(tsxRel)}/${tsx.tilesetImage}`);
    const imageRead = await api.electronAPI.readFileAsDataUrl(`${projectDir}/res/${imageRel}`);
    if (!imageRead?.ok || !imageRead.dataUrl) return null;
    const img = new Image();
    img.src = imageRead.dataUrl;
    await img.decode();
    const renderImage = makePaletteZeroTransparentImage(img, imageRead.dataUrl);
    return {
      firstgid: Math.max(1, Number(ref.firstgid) || 1),
      source: ref.source,
      name: tsx.tilesetName || sourceBaseName(ref.source),
      tileWidth: snapTileSize(tsx.tileWidth || state.map.tileWidth),
      tileHeight: snapTileSize(tsx.tileHeight || state.map.tileHeight),
      columns: Math.max(1, Number(tsx.tilesetColumns) || 1),
      tileCount: Math.max(1, Number(tsx.tilesetTileCount) || 1),
      image: renderImage,
      rawImage: img,
      dataUrl: imageRead.dataUrl,
      absolutePath: `${projectDir}/res/${imageRel}`,
    };
  }

  function normalizeMapTileSource(source) {
    const normalized = normalizeRelPath(String(source || '').replace(/^res[\\/]/, ''));
    if (normalized.startsWith('maps/tilesets/')) return `../${normalized.slice(5)}`;
    if (normalized.startsWith('tilesets/')) return `../${normalized}`;
    return normalized;
  }

  function normalizeMapTilesetRefs(map) {
    const refs = Array.isArray(map.tilesets)
      ? map.tilesets
      : [{ firstgid: 1, source: map.tilesetSource || `../tilesets/${map.tilesetName || 'tileset001'}.tsx` }];
    const seen = new Set();
    return refs
      .map((ref, index) => ({
        firstgid: Math.max(1, Number(ref?.firstgid) || index + 1),
        source: normalizeMapTileSource(ref?.source || ''),
      }))
      .filter((ref) => {
        if (!ref.source || seen.has(ref.source)) return false;
        seen.add(ref.source);
        return true;
      })
      .sort((left, right) => left.firstgid - right.firstgid);
  }

  function getMapTilesetReference(source) {
    const normalized = normalizeMapTileSource(source);
    return normalizeMapTilesetRefs(state.map).find((ref) => ref.source === normalized) || null;
  }

  function ensureMapTilesetReference(source, tsx) {
    const normalized = normalizeMapTileSource(source);
    state.map.tilesets = normalizeMapTilesetRefs(state.map);
    const existing = state.map.tilesets.find((ref) => ref.source === normalized);
    if (existing) return existing.firstgid;
    const firstgid = nextTilesetFirstGid(tsx);
    state.map.tilesets.push({ firstgid, source: normalized });
    state.map.tilesets.sort((left, right) => left.firstgid - right.firstgid);
    return firstgid;
  }

  function mapRelativeTilesetSource(sourcePath) {
    return normalizeMapTileSource(sourcePath);
  }

  async function readTilesetInfo(entry) {
    if (!entry?.sourcePath) return null;
    const read = await api.electronAPI.readCodeFile({ path: resPath(entry.sourcePath) });
    if (!read?.ok) return null;
    try {
      return parseTsx(read.content);
    } catch {
      return null;
    }
  }

  function nextTilesetFirstGid(nextTsx) {
    const refs = normalizeMapTilesetRefs(state.map);
    const loadedBySource = new Map(state.loadedTilesets.map((tileset) => [tileset.source, tileset]));
    let maxGid = 1;
    refs.forEach((ref) => {
      const loaded = loadedBySource.get(ref.source);
      const count = Math.max(1, Number(loaded?.tileCount || nextTsx?.tilesetTileCount) || 1);
      maxGid = Math.max(maxGid, ref.firstgid + count);
    });
    return maxGid;
  }

  async function requestTilesetAddInfo({ resFiles, defaultFile, defaultSymbol, sourceSize }) {
    const sourceWidth = snapTileSize(sourceSize?.width || 8);
    const sourceHeight = snapTileSize(sourceSize?.height || 8);
    const tileWidth = snapTileSize(state.map.tileWidth || 8);
    const tileHeight = snapTileSize(state.map.tileHeight || 8);
    const options = resFiles.map((file) => `<option value="${esc(file)}" ${file === defaultFile ? 'selected' : ''}>${esc(file)}</option>`).join('');
    return formModal({
      title: 'TILESET を登録',
      submitText: '登録',
      body: `
        <label class="tilemap-modal-field">追加先 .res
          <select class="tilemap-input" name="file">${options}</select>
        </label>
        <label class="tilemap-modal-field">アセット名
          <input class="tilemap-input" name="symbol" value="${esc(defaultSymbol)}">
        </label>
        <div class="tilemap-modal-row">
          <label class="tilemap-modal-field">画像幅(px)
            <input class="tilemap-input tilemap-number" name="imageWidth" type="number" min="8" step="8" value="${sourceWidth}">
          </label>
          <label class="tilemap-modal-field">画像高さ(px)
            <input class="tilemap-input tilemap-number" name="imageHeight" type="number" min="8" step="8" value="${sourceHeight}">
          </label>
        </div>
        <div class="tilemap-modal-row">
          <label class="tilemap-modal-field">Tile W
            <input class="tilemap-input tilemap-number" name="tileWidth" type="number" min="8" step="8" value="${tileWidth}">
          </label>
          <label class="tilemap-modal-field">Tile H
            <input class="tilemap-input tilemap-number" name="tileHeight" type="number" min="8" step="8" value="${tileHeight}">
          </label>
        </div>
        <label class="tilemap-modal-field">コメント
          <input class="tilemap-input" name="comment" value="Generated by tilemap-editor">
        </label>
      `,
      collect(form) {
        const symbol = normalizeSymbolName(form.elements.symbol.value, 'tileset');
        if (!symbol) return null;
        return {
          file: form.elements.file.value,
          symbol,
          imageWidth: snapTileSize(form.elements.imageWidth.value),
          imageHeight: snapTileSize(form.elements.imageHeight.value),
          tileWidth: snapTileSize(form.elements.tileWidth.value),
          tileHeight: snapTileSize(form.elements.tileHeight.value),
          comment: form.elements.comment.value,
        };
      },
    });
  }

  async function requestMapAddInfo({ resFiles, defaultFile, defaultSymbol }) {
    const files = resFiles.length ? resFiles : ['resources.res'];
    const selectedFile = files.includes(defaultFile) ? defaultFile : files[0];
    const options = files.map((file) => `<option value="${esc(file)}" ${file === selectedFile ? 'selected' : ''}>${esc(file)}</option>`).join('');
    return formModal({
      title: 'MAP/TILEMAP を追加',
      submitText: '作成',
      body: `
        <label class="tilemap-modal-field">追加先 .res
          <select class="tilemap-input" name="file">${options}</select>
        </label>
        <div class="tilemap-modal-row">
          <label class="tilemap-modal-field">種類
            <select class="tilemap-input" name="type">
              <option value="MAP" selected>MAP</option>
              <option value="TILEMAP">TILEMAP</option>
            </select>
          </label>
          <label class="tilemap-modal-field">layer_id
            <input class="tilemap-input" name="layerName" value="Ground">
          </label>
        </div>
        <label class="tilemap-modal-field">アセット名
          <input class="tilemap-input" name="symbol" value="${esc(defaultSymbol)}">
        </label>
        <div class="tilemap-modal-row">
          <label class="tilemap-modal-field">Map W
            <input class="tilemap-input tilemap-number" name="width" type="number" min="8" step="8" value="${snapMapSize(state.map.width || 40)}">
          </label>
          <label class="tilemap-modal-field">Map H
            <input class="tilemap-input tilemap-number" name="height" type="number" min="8" step="8" value="${snapMapSize(state.map.height || 28)}">
          </label>
        </div>
      `,
      collect(form) {
        const symbol = normalizeSymbolName(form.elements.symbol.value, 'map');
        const layerName = form.elements.layerName.value.trim() || 'Ground';
        if (!symbol) return null;
        return {
          file: form.elements.file.value,
          type: String(form.elements.type.value || 'MAP').toUpperCase() === 'TILEMAP' ? 'TILEMAP' : 'MAP',
          symbol,
          layerName,
          width: snapMapSize(form.elements.width.value),
          height: snapMapSize(form.elements.height.value),
        };
      },
    });
  }

  function resizeRightPanels(nextHeight) {
    if (!ui.rightPane || !ui.paletteSection) return;
    const rightRect = ui.rightPane.getBoundingClientRect();
    const browserHeight = ui.tilesetBrowser?.getBoundingClientRect().height || 0;
    const minPalette = 120;
    const minLayers = 118;
    const resizerHeight = ui.rightPanelResizer?.getBoundingClientRect().height || 7;
    const available = Math.max(minPalette, rightRect.height - browserHeight - resizerHeight - minLayers);
    const fallback = state.palettePanelHeight || defaultRightPanelHeight();
    const height = clamp(Math.round(Number(nextHeight) || fallback), minPalette, available);
    state.palettePanelHeight = height;
    ui.rightPane.style.setProperty('--tilemap-palette-height', `${height}px`);
  }

  function resizeTilesetBrowser(nextHeight) {
    if (!ui.rightPane || !ui.tilesetBrowser) return;
    const rightRect = ui.rightPane.getBoundingClientRect();
    const minBrowser = 108;
    const minPalette = 120;
    const minLayers = 118;
    const topResizerHeight = ui.paletteTopResizer?.getBoundingClientRect().height || 7;
    const bottomResizerHeight = ui.rightPanelResizer?.getBoundingClientRect().height || 7;
    const available = Math.max(minBrowser, rightRect.height - topResizerHeight - bottomResizerHeight - minPalette - minLayers);
    const fallback = state.browserPanelHeight || defaultRightPanelHeight();
    const height = clamp(Math.round(Number(nextHeight) || fallback), minBrowser, available);
    state.browserPanelHeight = height;
    ui.rightPane.style.setProperty('--tilemap-browser-height', `${height}px`);
  }

  function scheduleInitialRightPanelHeights() {
    if (state.rightPanelResizeManual) return;
    requestAnimationFrame(() => {
      if (state.rightPanelResizeManual) return;
      if (!setInitialRightPanelHeights()) {
        requestAnimationFrame(() => setInitialRightPanelHeights());
      }
    });
  }

  function setInitialRightPanelHeights() {
    if (state.rightPanelResizeManual) return true;
    const rightHeight = ui.rightPane?.getBoundingClientRect().height || 0;
    if (!rightHeight) return false;
    const third = defaultRightPanelHeight();
    state.browserPanelHeight = third;
    state.palettePanelHeight = third;
    ui.rightPane.style.setProperty('--tilemap-browser-height', `${third}px`);
    ui.rightPane.style.setProperty('--tilemap-palette-height', `${third}px`);
    return true;
  }

  function defaultRightPanelHeight() {
    const rightHeight = ui.rightPane?.getBoundingClientRect().height || 0;
    const resizerTotal = (ui.paletteTopResizer?.getBoundingClientRect().height || 7) + (ui.rightPanelResizer?.getBoundingClientRect().height || 7);
    return Math.max(140, Math.floor((Math.max(0, rightHeight - resizerTotal)) / 3));
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
      const width = clamp(Math.round(drag.leftWidth + dx), minLeft, maxLeft);
      ui.shell.style.setProperty('--tilemap-left-width', `${width}px`);
    } else {
      const maxRight = Math.max(minRight, drag.shellWidth - drag.leftWidth - minCenter - 12);
      const width = clamp(Math.round(drag.rightWidth - dx), minRight, maxRight);
      ui.shell.style.setProperty('--tilemap-right-width', `${width}px`);
    }
  }

  function stopColumnResize(event) {
    const drag = state.columnResizeStart;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.columnResizeStart = null;
    ui.leftColumnResizer.classList.remove('active');
    ui.rightColumnResizer.classList.remove('active');
  }

  function toggleRightSection(name) {
    if (!Object.prototype.hasOwnProperty.call(state.rightAccordion, name)) return;
    state.rightAccordion[name] = !state.rightAccordion[name];
    syncRightAccordion();
  }

  function syncRightAccordion() {
    const sections = [
      ['tiles', ui.tilesetBrowser, ui.tilesetBrowserBody],
      ['palette', ui.paletteSection, ui.paletteBody],
      ['layers', ui.layerSection, ui.layerBody],
    ];
    sections.forEach(([name, section, body]) => {
      const open = state.rightAccordion[name] !== false;
      section?.classList.toggle('collapsed', !open);
      if (body) body.hidden = !open;
      const button = section?.querySelector(`[data-toggle-right-section="${name}"]`);
      if (button) {
        button.setAttribute('aria-expanded', String(open));
      }
    });
    if (ui.paletteTopResizer) ui.paletteTopResizer.hidden = state.rightAccordion.tiles === false || state.rightAccordion.palette === false;
    if (ui.rightPanelResizer) ui.rightPanelResizer.hidden = state.rightAccordion.palette === false || state.rightAccordion.layers === false;
  }

  function wheelZoomValue(current, deltaY) {
    const value = clamp(Number(current) || 2, 0.5, 8);
    const direction = deltaY < 0 ? 1 : -1;
    const step = 0.25;
    return clamp(Math.round((value + direction * step) / step) * step, 0.5, 8);
  }

  async function ensurePaletteForTileset(item) {
    const paletteName = `${item.entry.name}_palette`;
    const existing = state.allFiles.flatMap((file) => file.entries || []).find((entry) => entry.name === paletteName);
    if (existing) return true;
    const read = await api.electronAPI.readCodeFile({ path: resPath(item.entry.sourcePath) });
    if (!read?.ok) {
      setStatus(`PALETTE 補完用 TSX を読めません: ${read?.error || item.entry.sourcePath}`);
      return false;
    }
    const tsx = parseTsx(read.content);
    if (!tsx.tilesetImage) {
      setStatus(`PALETTE 補完用画像が TSX にありません: ${item.entry.sourcePath}`);
      return false;
    }
    const imageRel = normalizeRelPath(`${dirname(item.entry.sourcePath)}/${tsx.tilesetImage}`);
    const addPalette = await api.electronAPI.addResEntry({
      file: item.file.file,
      entry: {
        type: 'PALETTE',
        name: paletteName,
        sourcePath: imageRel,
        comment: `Palette for ${item.entry.name}`,
      },
    });
    if (!addPalette?.ok) {
      setStatus(`PALETTE 定義追加失敗: ${addPalette?.error || 'unknown'}`);
      return false;
    }
    const file = state.allFiles.find((candidate) => candidate.file === item.file.file);
    if (file) file.entries.push({ type: 'PALETTE', name: paletteName, sourcePath: imageRel });
    setStatus(`PALETTE を補完しました: ${paletteName}`);
    return true;
  }

  function formModal({ title, body, submitText, collect }) {
    return new Promise((resolve) => {
      const modalHtml = `
        <div class="page-header modal-header">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" type="button" data-modal-cancel>✕</button>
        </div>
        <form class="settings-form compact-form tilemap-modal-form">
          ${body}
          <div class="form-actions-inline modal-actions-end">
            <button class="secondary-btn" type="button" data-modal-cancel>キャンセル</button>
            <button class="primary-btn" type="submit">${esc(submitText)}</button>
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

  function messageModal({ title, message }) {
    return new Promise((resolve) => {
      const modalHtml = `
        <div class="page-header modal-header">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" type="button" data-modal-ok>✕</button>
        </div>
        <div class="settings-form compact-form tilemap-modal-form">
          <p class="tilemap-modal-message">${esc(message)}</p>
          <div class="form-actions-inline modal-actions-end">
            <button class="primary-btn" type="button" data-modal-ok>OK</button>
          </div>
        </div>
      `;
      const modal = api.createModal({
        id: `${plugin.id}-message-modal`,
        panelClassName: 'app-panel app-panel-sm',
        html: modalHtml,
      });
      modal.panel.innerHTML = modalHtml;
      modal.panel.querySelectorAll('[data-modal-ok]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.close();
          resolve();
        }, { once: true });
      });
      modal.open();
    });
  }

  function confirmUnsavedMapSwitch(entry) {
    return new Promise((resolve) => {
      const modalHtml = `
        <div class="page-header modal-header">
          <h2>未保存の変更</h2>
          <button class="icon-btn" type="button" data-modal-decision="cancel">✕</button>
        </div>
        <div class="settings-form compact-form tilemap-modal-form">
          <p class="tilemap-modal-message">${esc(entry?.name || '選択中のMAP')} に未保存の変更があります。</p>
          <p class="tilemap-modal-message">別のアセットを開く前に、変更を保存するか破棄してください。</p>
          <div class="form-actions-inline modal-actions-end">
            <button class="secondary-btn" type="button" data-modal-decision="cancel">キャンセル</button>
            <button class="tilemap-danger-button" type="button" data-modal-decision="discard">破棄して開く</button>
            <button class="primary-btn" type="button" data-modal-decision="save">保存して開く</button>
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

  function firstKeyForTypes(types) {
    const item = state.files.flatMap((file) => file.entries.map((entry) => ({ file, entry })))
      .find((item) => types.has(String(item.entry.type || '').toUpperCase()));
    return item ? assetKey(item.file.file, item.entry) : '';
  }

  function findAssetByKey(key, types = EDITOR_TYPES) {
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (assetKey(file.file, entry) === key && types.has(String(entry.type || '').toUpperCase())) {
          return { file, entry };
        }
      }
    }
    return null;
  }

  function findTilesetBySourcePath(sourcePath) {
    const normalized = normalizeRelPath(String(sourcePath || '').replace(/^res\//, ''));
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (String(entry.type || '').toUpperCase() === 'TILESET' && normalizeRelPath(entry.sourcePath) === normalized) {
          return { file, entry };
        }
      }
    }
    return null;
  }

  function findTilesetByMapSource(source) {
    const mapItem = findAssetByKey(state.selectedMapKey, MAP_TYPES);
    const mapDir = dirname(mapItem?.entry?.sourcePath || 'maps/map.tmx');
    return findTilesetBySourcePath(normalizeRelPath(`${mapDir}/${source}`));
  }

  function findMapBySourcePath(sourcePath) {
    const normalized = normalizeRelPath(String(sourcePath || '').replace(/^res\//, ''));
    for (const file of state.files) {
      for (const entry of file.entries) {
        if (MAP_TYPES.has(String(entry.type || '').toUpperCase()) && normalizeRelPath(entry.sourcePath) === normalized) {
          return { file, entry };
        }
      }
    }
    return null;
  }

  function uniqueSymbol(seed, types) {
    const base = normalizeSymbolName(seed, 'asset');
    const names = new Set(state.files.flatMap((file) => file.entries)
      .filter((entry) => types.has(String(entry.type || '').toUpperCase()))
      .map((entry) => entry.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base}_${index}`)) index += 1;
    return `${base}_${index}`;
  }

  function countEntries(types) {
    return state.files.flatMap((file) => file.entries)
      .filter((entry) => types.has(String(entry.type || '').toUpperCase())).length;
  }

  function findLineByName(fileName, name, types) {
    const file = state.files.find((entry) => entry.file === fileName);
    const entry = file?.entries.find((candidate) => candidate.name === name && types.has(String(candidate.type || '').toUpperCase()));
    return entry?.lineNumber || '';
  }
}

function buildShell() {
  return `
    <div class="tilemap-editor-shell" data-ui="shell">
      <aside class="tilemap-sidebar">
        <div class="tilemap-toolbar">
          <h2>TileMap</h2>
          <button class="icon-btn" type="button" data-action="add-map" title="空MAPを追加"><svg class="icon"><use href="#icon-add"></use></svg></button>
        </div>
        <div class="tilemap-filter">
          <label><span>.res ファイル</span><select class="tilemap-input" data-ui="assetFileFilter"></select></label>
          <label><span>アセット名</span><input class="tilemap-input" data-ui="assetKeyword" placeholder="keyword"></label>
        </div>
        <div class="tilemap-resource-tree" data-ui="assetTree"></div>
        <div class="tilemap-warnings" data-ui="warningList" hidden></div>
      </aside>
      <div class="tilemap-column-resizer" data-ui="leftColumnResizer" role="separator" aria-orientation="vertical" title="左列の幅を調整"></div>
      <main class="tilemap-main">
        <div class="tilemap-toolbar tilemap-map-toolbar">
          <div class="tilemap-tool-group">
            ${toolButton('pen', '鉛筆', 'icon-pencil')}
            ${toolButton('eraser', '消去', 'icon-eraser')}
            ${toolButton('fill', '塗りつぶし', 'icon-fill')}
            ${toolButton('rect', '矩形', 'icon-square')}
            ${toolButton('select', '矩形範囲選択', 'icon-selection')}
            ${toolButton('eyedropper', 'スポイト', 'icon-eyedropper')}
          </div>
          <label class="tilemap-inline-field"><span>W</span><input class="tilemap-input tilemap-number" type="number" min="8" step="8" data-ui="mapWidth" value="40"></label>
          <label class="tilemap-inline-field"><span>H</span><input class="tilemap-input tilemap-number" type="number" min="8" step="8" data-ui="mapHeight" value="28"></label>
          <label class="tilemap-check"><input type="checkbox" data-ui="gridToggle" checked> Grid</label>
          <label class="tilemap-check" title="VDP priority layer の表示"><input type="checkbox" data-ui="priorityToggle" checked> Priority Preview</label>
          <label class="tilemap-zoom">Zoom <input type="range" min="0.5" max="8" step="0.25" value="2" data-ui="zoom"></label>
        </div>
        <div class="tilemap-canvas-wrap" data-ui="mapCanvasWrap">
          <canvas data-ui="mapCanvas"></canvas>
        </div>
        <div class="tilemap-status" data-ui="status"></div>
      </main>
      <div class="tilemap-column-resizer" data-ui="rightColumnResizer" role="separator" aria-orientation="vertical" title="右列の幅を調整"></div>
      <aside class="tilemap-right">
        <section class="tilemap-right-section tilemap-tileset-browser">
          <div class="tilemap-accordion-head">
            <button class="tilemap-accordion-header" type="button" data-toggle-right-section="tiles" title="Tiles を開閉" aria-expanded="true">
              <span class="tilemap-accordion-title">Tiles</span>
              <svg class="icon tilemap-accordion-chevron"><use href="#icon-chevron-up"></use></svg>
            </button>
            <div class="tilemap-accordion-actions">
              <button class="icon-btn" type="button" data-action="tileset-add" title="TILESETを登録"><svg class="icon"><use href="#icon-file-plus"></use></svg></button>
            </div>
          </div>
          <div class="tilemap-section-body" data-ui="tilesetBrowserBody">
            <div class="tilemap-filter">
              <label><span>.res ファイル</span><select class="tilemap-input" data-ui="tilesetFileFilter"></select></label>
              <label><span>TILESET名</span><input class="tilemap-input" data-ui="tilesetKeyword" placeholder="keyword"></label>
            </div>
            <div class="tilemap-resource-tree tilemap-tileset-tree" data-ui="tilesetTree"></div>
          </div>
        </section>
        <div class="tilemap-panel-resizer" data-ui="paletteTopResizer" role="separator" aria-orientation="horizontal" title="Tiles / Tile Palette の境界をドラッグ"></div>
        <section class="tilemap-right-section tilemap-palette-section">
          <div class="tilemap-accordion-head tilemap-palette-header">
            <button class="tilemap-accordion-header" type="button" data-toggle-right-section="palette" title="Tile Palette を開閉" aria-expanded="true">
              <span class="tilemap-accordion-title">Tile Palette</span>
              <svg class="icon tilemap-accordion-chevron"><use href="#icon-chevron-up"></use></svg>
            </button>
            <div class="tilemap-accordion-actions">
              <label class="tilemap-zoom">Zoom <input type="range" min="0.5" max="8" step="0.25" value="2" data-ui="paletteZoom"></label>
            </div>
          </div>
          <div class="tilemap-section-body" data-ui="paletteBody">
            <div class="tilemap-brush-info" data-ui="brushInfo">1 x 1 / gid 1</div>
            <div class="tilemap-collision-palette" data-ui="collisionPalette"></div>
            <div class="tilemap-tileset-wrap" data-ui="tilesetWrap"><canvas data-ui="tilesetCanvas"></canvas></div>
          </div>
        </section>
        <div class="tilemap-panel-resizer" data-ui="rightPanelResizer" role="separator" aria-orientation="horizontal" title="Tile Palette / Layers の境界をドラッグ"></div>
        <section class="tilemap-right-section tilemap-layer-section">
          <div class="tilemap-accordion-head">
            <button class="tilemap-accordion-header" type="button" data-toggle-right-section="layers" title="Layers を開閉" aria-expanded="true">
              <span class="tilemap-accordion-title">Layers</span>
              <svg class="icon tilemap-accordion-chevron"><use href="#icon-chevron-up"></use></svg>
            </button>
            <div class="tilemap-accordion-actions">
              <button class="icon-btn" type="button" data-action="add-layer" title="Layer 追加"><svg class="icon"><use href="#icon-add"></use></svg></button>
              <button class="icon-btn" type="button" data-action="add-priority-layer" title="Priority layer 追加"><svg class="icon"><use href="#icon-grid"></use></svg></button>
              <button class="icon-btn" type="button" data-action="add-collision-layer" title="Collision layer 追加"><svg class="icon"><use href="#icon-square"></use></svg></button>
              <button class="icon-btn" type="button" data-action="layer-up" title="上へ"><svg class="icon"><use href="#icon-chevron-up"></use></svg></button>
              <button class="icon-btn" type="button" data-action="layer-down" title="下へ"><svg class="icon"><use href="#icon-chevron-down"></use></svg></button>
              <button class="icon-btn danger-icon-btn" type="button" data-action="delete-layer" title="Layer削除"><svg class="icon"><use href="#icon-trash"></use></svg></button>
            </div>
          </div>
          <div class="tilemap-layer-controls">
            <label class="tilemap-zoom tilemap-layer-opacity" title="選択していない layer の透明度">レイヤ透明度 <input type="range" min="0.1" max="1" step="0.05" value="0.45" data-ui="inactiveOpacity"></label>
          </div>
          <div class="tilemap-section-body" data-ui="layerBody">
            <div class="tilemap-layer-list" data-ui="layerList"></div>
          </div>
        </section>
      </aside>
    </div>
  `;
}

function toolButton(tool, label, icon) {
  return `<button class="tilemap-tool icon-btn" type="button" data-tool="${tool}" title="${label}" aria-label="${label}" aria-pressed="false">${toolIcon(icon)}</button>`;
}

function toolIcon(icon) {
  const paths = {
    'icon-pencil': '<path d="M16.6 3.4 20.6 7.4 8.8 19.2 4 20 4.8 15.2 16.6 3.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.5 5.5 18.5 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'icon-eraser': '<path d="M3.5 14.5 12.5 5.5a2.1 2.1 0 0 1 3 0l3 3a2.1 2.1 0 0 1 0 3l-8 8H5.6l-2.1-2.1a2.1 2.1 0 0 1 0-2.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9 15 15M11 19.5H21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'icon-fill': '<path d="M4 13 11 6l7 7-7 7-7-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M11 6 8 3M18 17s2 2.2 2 3.2a2 2 0 0 1-4 0c0-1 2-3.2 2-3.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    'icon-square': '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    'icon-selection': '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="4 3"/><path d="M15 15 21 21M21 21h-4M21 21v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'icon-eyedropper': '<path d="M14.5 4.5 19.5 9.5M13 6l5 5-8.5 8.5H5v-4.5L13 6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 18h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[icon] || paths['icon-pencil']}</svg>`;
}

function bindUi(root) {
  const byAction = (name) => root.querySelector(`[data-action="${name}"]`);
  const byUi = (name) => root.querySelector(`[data-ui="${name}"]`);
  return {
    shell: byUi('shell'),
    sidebar: root.querySelector('.tilemap-sidebar'),
    leftColumnResizer: byUi('leftColumnResizer'),
    rightColumnResizer: byUi('rightColumnResizer'),
    addMap: byAction('add-map'),
    assetFileFilter: byUi('assetFileFilter'),
    assetKeyword: byUi('assetKeyword'),
    assetTree: byUi('assetTree'),
    tilesetAdd: byAction('tileset-add'),
    tilesetFileFilter: byUi('tilesetFileFilter'),
    tilesetKeyword: byUi('tilesetKeyword'),
    tilesetTree: byUi('tilesetTree'),
    rightPane: root.querySelector('.tilemap-right'),
    tilesetBrowser: root.querySelector('.tilemap-tileset-browser'),
    paletteSection: root.querySelector('.tilemap-palette-section'),
    layerSection: root.querySelector('.tilemap-layer-section'),
    tilesetBrowserBody: byUi('tilesetBrowserBody'),
    paletteBody: byUi('paletteBody'),
    layerBody: byUi('layerBody'),
    paletteTopResizer: byUi('paletteTopResizer'),
    rightPanelResizer: byUi('rightPanelResizer'),
    paletteZoom: byUi('paletteZoom'),
    tilesetWrap: byUi('tilesetWrap'),
    tilesetCanvas: byUi('tilesetCanvas'),
    brushInfo: byUi('brushInfo'),
    mapWidth: byUi('mapWidth'),
    mapHeight: byUi('mapHeight'),
    gridToggle: byUi('gridToggle'),
    priorityToggle: byUi('priorityToggle'),
    inactiveOpacity: byUi('inactiveOpacity'),
    zoom: byUi('zoom'),
    mapCanvasWrap: byUi('mapCanvasWrap'),
    mapCanvas: byUi('mapCanvas'),
    status: byUi('status'),
    warningList: byUi('warningList'),
    addLayer: byAction('add-layer'),
    addPriorityLayer: byAction('add-priority-layer'),
    addCollisionLayer: byAction('add-collision-layer'),
    deleteLayer: byAction('delete-layer'),
    layerUp: byAction('layer-up'),
    layerDown: byAction('layer-down'),
    layerList: byUi('layerList'),
    collisionPalette: byUi('collisionPalette'),
    toolButtons: Array.from(root.querySelectorAll('[data-tool]')),
  };
}

function renderFileFilter(select, current, files) {
  select.innerHTML = [
    '<option value="">すべて</option>',
    ...files.filter((file) => file.entries.length > 0).map((file) => `<option value="${esc(file.file)}">${esc(file.file)}</option>`),
  ].join('');
  select.value = files.some((file) => file.file === current) ? current : '';
}

function assetKey(file, entry) {
  return `${file}::${entry.lineNumber || entry.name || entry.sourcePath}`;
}

function toggleExpanded(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function resPath(sourcePath) {
  return `res/${String(sourcePath || '').replace(/^[/\\]+/, '').replace(/^res[\\/]/, '')}`;
}

function dirname(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const idx = text.lastIndexOf('/');
  return idx >= 0 ? text.slice(0, idx) : '';
}

function normalizeRelPath(path) {
  const parts = [];
  String(path || '').replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push(part);
    } else {
      parts.push(part);
    }
  });
  return parts.join('/');
}

function fileBaseName(path) {
  return normalizeSymbolName(String(path || '').split(/[\\/]/).pop() || '', 'tileset');
}

async function readImageInfo(absPath) {
  const img = new Image();
  const readApi = window.electronAPI;
  const read = await readApi.readFileAsDataUrl(absPath);
  if (!read?.ok || !read.dataUrl) return { width: 8, height: 8 };
  img.src = read.dataUrl;
  await img.decode();
  return { width: img.naturalWidth || img.width || 8, height: img.naturalHeight || img.height || 8 };
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

function resizeLayerData(data, oldW, oldH, nextW, nextH) {
  const next = new Array(nextW * nextH).fill(0);
  const source = normalizeLayerData(data, oldW, oldH);
  for (let y = 0; y < Math.min(oldH, nextH); y += 1) {
    for (let x = 0; x < Math.min(oldW, nextW); x += 1) next[y * nextW + x] = source[y * oldW + x] || 0;
  }
  return next;
}

function snapTileSize(value) {
  const n = Number(value) || 8;
  return Math.max(8, Math.min(256, Math.round(n / 8) * 8));
}

function snapMapSize(value) {
  const n = Number(value) || 8;
  return Math.max(8, Math.min(512, Math.round(n / 8) * 8));
}

function drawGrid(ctx, width, height, tileW, tileH) {
  ctx.strokeStyle = 'rgba(255,255,255,0.11)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += tileW) line(ctx, x, 0, x, height);
  for (let y = 0; y <= height; y += tileH) line(ctx, 0, y, width, y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}

function colorForTile(gid) {
  const hue = (gid * 47) % 360;
  return `hsl(${hue} 52% 46%)`;
}

function collisionColor(value, alpha = 1) {
  const colors = {
    0: [96, 110, 130],
    1: [240, 84, 84],
    2: [242, 201, 76],
    3: [64, 190, 132],
    4: [178, 91, 255],
  };
  const rgb = colors[Number(value) || 0] || [74, 163, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function collisionGlyph(value) {
  return ({ 1: 'S', 2: 'P', 3: 'L', 4: 'D' })[Number(value) || 0] || '';
}

function drawContainImage(canvas, img) {
  const ctx = canvas.getContext('2d');
  const sourceW = img.naturalWidth || img.width || 1;
  const sourceH = img.naturalHeight || img.height || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101722';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / sourceW, canvas.height / sourceH);
  const w = Math.max(1, Math.floor(sourceW * scale));
  const h = Math.max(1, Math.floor(sourceH * scale));
  const x = Math.floor((canvas.width - w) / 2);
  const y = Math.floor((canvas.height - h) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h);
}

function makePaletteZeroTransparentImage(img, dataUrl) {
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;
  if (!width || !height) return img;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const transparent = pngPaletteZeroColor(dataUrl) || [
    imageData.data[0],
    imageData.data[1],
    imageData.data[2],
  ];
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (
      imageData.data[index] === transparent[0]
      && imageData.data[index + 1] === transparent[1]
      && imageData.data[index + 2] === transparent[2]
    ) {
      imageData.data[index + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function pngPaletteZeroColor(dataUrl) {
  const bytes = dataUrlBytes(dataUrl);
  if (!bytes || bytes.length < 16) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'PLTE' && length >= 3 && dataStart + 3 <= bytes.length) {
      return [bytes[dataStart], bytes[dataStart + 1], bytes[dataStart + 2]];
    }
    offset = dataStart + length + 4;
  }
  return null;
}

function dataUrlBytes(dataUrl) {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) return null;
  try {
    if (/;base64/i.test(text.slice(0, comma))) {
      const binary = atob(text.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    const decoded = decodeURIComponent(text.slice(comma + 1));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch (_) {
    return JSON.parse(JSON.stringify(value));
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
