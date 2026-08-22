import { createScriptRuntime } from './preview-runtime.mjs';
import { collectVisualAssetIds, drawNovelFrame } from './rendering.mjs';

const BUTTON_BY_CODE = Object.freeze({
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyZ: 'i', KeyX: 'ii', Enter: 'run', Space: 'run', KeyA: 'select', ShiftLeft: 'select', ShiftRight: 'select',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function popupHtml() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>MD Novel Preview</title><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080d13;color:#e7eef7;font:12px/1.4 system-ui,sans-serif}
    #shell{height:100%;display:grid;grid-template-rows:minmax(0,1fr) 44px}#stage-wrap{min-height:0;display:grid;place-items:center;position:relative;overflow:hidden;background:#030609}
    #stage{width:min(960px,calc(100vw - 24px));aspect-ratio:320/224;max-height:calc(100vh - 68px);image-rendering:pixelated;background:#000;border:1px solid #3d4c60;box-shadow:0 10px 34px #000}
    #choices{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:6px;min-width:230px}#choices:empty{display:none}
    #choices button{padding:8px 12px;border:1px solid #52677f;border-radius:5px;background:rgba(10,17,27,.95);color:#eaf2fb;text-align:left}#choices button.active{border-color:#43b5ff;background:#1c557a}
    #debug{position:absolute;right:12px;top:12px;width:260px;max-height:calc(100% - 24px);overflow:auto;border:1px solid #42536a;border-radius:6px;background:rgba(6,12,20,.9);padding:9px;font:11px/1.45 Consolas,monospace}#debug.hidden{display:none}#debug h3{margin:0 0 6px;font:12px system-ui}
    #bar{display:flex;align-items:center;gap:10px;padding:7px 12px;border-top:1px solid #293749;background:#111a25}#bar button{border:1px solid #3f526a;border-radius:5px;background:#1b2a3b;color:#edf5ff;padding:5px 9px}#scene{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9eb0c4}label{display:flex;align-items:center;gap:4px;margin-left:auto}#status{color:#e9b967}
  </style></head><body><div id="shell"><div id="stage-wrap"><canvas id="stage" width="320" height="224"></canvas><div id="choices"></div><aside id="debug" class="hidden"></aside></div><div id="bar"><button id="restart">最初から</button><span id="scene"></span><span id="status"></span><label><input id="fast" type="checkbox">早送り</label><label><input id="debug-toggle" type="checkbox">Debug</label></div></div></body></html>`;
}

export function openNovelPreview(options = {}) {
  const popup = window.open('', `md-novel-preview-${Date.now().toString(36)}`, 'width=920,height=720');
  if (!popup) throw new Error('Preview windowを開けませんでした');
  popup.document.open();
  popup.document.write(popupHtml());
  popup.document.close();
  const canvas = popup.document.querySelector('#stage');
  const choices = popup.document.querySelector('#choices');
  const debug = popup.document.querySelector('#debug');
  const sceneLabel = popup.document.querySelector('#scene');
  const status = popup.document.querySelector('#status');
  const fast = popup.document.querySelector('#fast');
  const debugToggle = popup.document.querySelector('#debug-toggle');
  let closed = false;
  let lastTimestamp = performance.now();
  let frameRemainder = 0;

  const assetKind = (assetId) => {
    const asset = (options.catalog?.assets || []).find((entry) => entry.id === assetId);
    return asset?.type === 'psg-song' ? 'bgm' : 'sfx';
  };
  const runtime = createScriptRuntime(options.sceneDocument, {
    startSceneId: options.startSceneId,
    assetKind,
    runawayLimit: 100000,
  });
  const requestedAssets = new Set();

  async function refreshAssets(snapshot) {
    const visible = collectVisualAssetIds(snapshot);
    const missing = visible.filter((assetId) => {
      const ready = Boolean(options.imageForAsset?.(assetId)) && Boolean(options.indexedForAsset?.(assetId));
      if (ready || requestedAssets.has(assetId)) return false;
      requestedAssets.add(assetId);
      return true;
    });
    if (!missing.length) return;
    await Promise.all([
      options.ensureAssetImages?.(missing),
      options.ensureIndexedAssets?.(missing),
    ]);
    if (!closed && !popup.closed) render();
  }
  function renderChoices() {
    choices.innerHTML = '';
  }

  function renderDebug(snapshot) {
    debug.classList.toggle('hidden', !debugToggle.checked);
    if (!debugToggle.checked) return;
    const variables = Object.entries(snapshot.variables || {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `<div>${escapeHtml(name)} = ${value}</div>`).join('') || '<div>変数なし</div>';
    const sprites = (snapshot.sprites || []).map((entry, index) => `<div>slot${index}: ${entry ? `${escapeHtml(entry.assetId)} (${entry.x},${entry.y})` : '-'}</div>`).join('');
    const budget = options.budget || {};
    debug.innerHTML = `<h3>Runtime</h3><div>Scene: ${escapeHtml(snapshot.sceneId)}</div><div>Command: #${snapshot.pc + 1}</div><div>Frame: ${snapshot.frame}</div><div>Executed: ${snapshot.executed}</div><div>Wait: ${escapeHtml(snapshot.waiting?.kind || '-')} ${snapshot.waiting?.frames ?? ''}</div><div>BG fade: ${escapeHtml(snapshot.backgroundTransition?.phase || '-')} ${Math.round((snapshot.fadeAlpha || 0) * 100)}%</div><div>Message: ${snapshot.message ? `${snapshot.message.revealedGlyphs}/${snapshot.message.totalGlyphs}` : '-'}</div><div>AUTO: ${snapshot.autoEnabled ? 'ON' : 'OFF'}</div><div>BGM: ${escapeHtml(snapshot.audio?.bgm?.assetId || '-')}</div><div>SFX: ${escapeHtml(snapshot.audio?.sfx?.assetId || '-')}</div><h3>Sprites</h3>${sprites}<h3>Variables</h3>${variables}<h3>MD Budget</h3><div>states ${budget.states ?? '-'}</div><div>VRAM ${budget.maxBudget ?? '-'} / 1424</div><div>overlay ${budget.maxOverlayTiles ?? '-'} / 192</div><div>pieces ${budget.maxSpritePieces ?? '-'} / 80</div>`;
  }

  function handleEvents() {
    const events = runtime.consumeEvents();
    for (const event of events) {
      if (event.type === 'audio') options.onAudioEvent?.(event);
      if (event.type === 'runaway' || event.type === 'error') status.textContent = event.message || event.type;
    }
  }

  function render() {
    if (closed || popup.closed) return;
    const snapshot = runtime.snapshot();
    drawNovelFrame(canvas, snapshot, {
      coordinateMode: options.coordinateMode,
      bindings: options.bindings,
      catalog: options.catalog,
      imageForAsset: options.imageForAsset,
      indexedForAsset: options.indexedForAsset,
      paletteCanvasCache: options.paletteCanvasCache,
      fontImage: options.fontImage,
      fontEntries: options.fontEntries,
      time: performance.now(),
    });
    renderChoices(snapshot);
    renderDebug(snapshot);
    sceneLabel.textContent = `${snapshot.sceneId} · #${snapshot.pc + 1}`;
    if (!snapshot.error) status.textContent = snapshot.waiting?.kind === 'input' ? `入力待ち: ${(snapshot.waiting.buttons || []).join(' / ')}` : snapshot.waiting ? `${snapshot.waiting.kind}待機中` : '';
    void refreshAssets(snapshot);
  }

  function apply(action) {
    action();
    handleEvents();
    render();
  }

  function press(button) { apply(() => runtime.press(button)); }

  function tick(timestamp) {
    if (closed || popup.closed) { close(); return; }
    const elapsed = Math.max(0, Math.min(250, timestamp - lastTimestamp));
    lastTimestamp = timestamp;
    frameRemainder += elapsed / (1000 / 60);
    const frames = Math.floor(frameRemainder);
    frameRemainder -= frames;
    if (frames > 0) {
      const multiplier = fast.checked ? 8 : 1;
      apply(() => runtime.elapseFrames(frames * multiplier));
    } else {
      render();
    }
    popup.requestAnimationFrame(tick);
  }

  function onKeyDown(event) {
    const button = BUTTON_BY_CODE[event.code];
    if (!button) return;
    event.preventDefault();
    press(button);
  }

  function onChoiceClick(event) {
    const button = event.target.closest('[data-choice]');
    if (!button) return;
    apply(() => runtime.choose(Number(button.dataset.choice)));
  }

  function onCanvasClick() {
    press('i');
  }

  function onBeforeUnload() {
    if (closed) return;
    closed = true;
    options.onClose?.();
  }

  function close() {
    if (closed) return;
    closed = true;
    popup.removeEventListener('keydown', onKeyDown);
    popup.removeEventListener('beforeunload', onBeforeUnload);
    choices.removeEventListener('click', onChoiceClick);
    canvas.removeEventListener('click', onCanvasClick);
    try { if (!popup.closed) popup.close(); } catch (_) {}
    options.onClose?.();
  }

  popup.addEventListener('keydown', onKeyDown);
  choices.addEventListener('click', onChoiceClick);
  canvas.addEventListener('click', onCanvasClick);
  popup.addEventListener('beforeunload', onBeforeUnload, { once: true });
  popup.document.querySelector('#restart').addEventListener('click', () => apply(() => runtime.restart(options.startSceneId)));
  fast.addEventListener('change', () => { runtime.setFastForward(fast.checked); render(); });
  debugToggle.addEventListener('change', render);
  runtime.restart(options.startSceneId);
  handleEvents();
  render();
  popup.requestAnimationFrame(tick);
  popup.focus();
  return { popup, runtime, close, render };
}
