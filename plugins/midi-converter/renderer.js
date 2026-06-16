import { createVgmPreviewPlayer } from './vgm-preview-player.mjs';

export function activatePlugin({ plugin, api, logger, registerCapability }) {
  let modal = null;
  let sourcePath = '';
  const vgmPreviewPlayer = createVgmPreviewPlayer();

  function normalizeSymbol(value) {
    const raw = String(value || 'midi_bgm')
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    return /^[A-Za-z_]/.test(raw) ? raw : `bgm_${raw || 'midi'}`;
  }

  async function convertMidiMusic(payload = {}) {
    const result = await api.plugins.invokeHook(plugin.id, 'convertMidiMusic', {
      ...payload,
      outputs: {
        vgm: payload.outputs?.vgm !== false,
        xgm: payload.outputs?.xgm !== false,
        registerAsset: Boolean(payload.outputs?.registerAsset),
      },
    });
    const body = result?.result || result;
    return body || { ok: false, error: 'MIDI 変換に失敗しました。' };
  }

  async function pickMidiFile() {
    const result = await api.electronAPI.pickFile({
      properties: ['openFile'],
      filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    });
    if (result?.canceled || !result?.sourcePath) return '';
    return result.sourcePath;
  }

  async function registerAsset(asset, statusEl = null, resFile = 'resources.res') {
    if (!asset) return { ok: false, error: '登録するアセットがありません。' };
    const defs = await api.electronAPI.listResDefinitions();
    const entries = (defs?.files || []).flatMap((file) => file.entries || []);
    if (entries.some((entry) => entry.name === asset.name)) {
      const duplicate = { ok: false, error: `${asset.name} は既に resources.res に登録済みです。` };
      if (statusEl) statusEl.textContent = duplicate.error;
      return duplicate;
    }
    const add = await api.electronAPI.addResEntry({
      file: resFile || 'resources.res',
      entry: asset,
    });
    const message = add?.ok
      ? `${asset.name} を ${asset.type} アセットとして登録しました。`
      : (add?.error || `${asset.type || 'music'} アセット登録に失敗しました。`);
    if (statusEl) statusEl.textContent = message;
    if (add?.ok) await api.assets?.reloadResources?.({ keepSelection: true });
    return add;
  }

  function sourcePathForRes(resultPath) {
    return String(resultPath || '').replace(/^res[\\/]/, '').replace(/\\/g, '/');
  }

  function isMidiPending(payload = {}) {
    const ext = String(payload.picked?.ext || '').toLowerCase();
    const type = String(payload.normalizedType || '').toUpperCase();
    return ['.mid', '.midi'].includes(ext) && (type === 'XGM' || type === 'XGM2');
  }

  function buildAssetFromResult(result, options = {}) {
    const name = normalizeSymbol(options.symbol || result.symbol || 'midi_bgm');
    const targetType = String(options.targetType || 'XGM2').toUpperCase();
    if (targetType === 'XGM') {
      if (!result.files?.xgm) return null;
      return {
        type: 'XGM',
        name,
        sourcePath: sourcePathForRes(result.files.xgm),
        timing: options.timing || 'AUTO',
        options: options.options || '',
      };
    }
    return {
      type: 'XGM2',
      name,
      sourcePath: sourcePathForRes(result.files?.vgm),
      files: [sourcePathForRes(result.files?.vgm)],
      options: options.options || '',
    };
  }

  function createModal() {
    if (modal) return modal;
    modal = api.createModal({
      id: `${plugin.id}-modal`,
      html: `
        <div class="midi-converter-modal">
          <div class="midi-converter-head">
            <h2>MIDI Converter</h2>
            <button type="button" class="midi-converter-icon" data-action="close" title="Close" aria-label="Close">x</button>
          </div>
          <div class="midi-converter-grid">
            <label>
              MIDI
              <span class="midi-converter-file" data-role="source">未選択</span>
            </label>
            <button type="button" class="midi-converter-btn" data-action="pick-midi">Select</button>
            <label>
              Symbol
              <input type="text" data-role="symbol" value="midi_bgm">
            </label>
            <label>
              Target
              <select data-role="target-type">
                <option value="XGM2">XGM2 (VGM source)</option>
                <option value="XGM">XGM</option>
              </select>
            </label>
            <label>
              XGM timing
              <select data-role="timing">
                <option value="AUTO">AUTO</option>
                <option value="NTSC">NTSC</option>
                <option value="PAL">PAL</option>
              </select>
            </label>
            <label>
              Options
              <input type="text" data-role="options" value="">
            </label>
            <div class="midi-converter-options">
              <label><input type="checkbox" data-role="vgm" checked> VGM</label>
              <label><input type="checkbox" data-role="xgm" checked> XGM</label>
              <label><input type="checkbox" data-role="asset" checked> XGM2 asset</label>
            </div>
          </div>
          <div class="midi-converter-actions">
            <button type="button" class="midi-converter-btn primary" data-action="convert">Convert</button>
          </div>
          <pre class="midi-converter-status" data-role="status"></pre>
        </div>
      `,
    });

    const root = modal.panel || modal.modal || null;
    const $ = (selector) => root?.querySelector(selector);
    $('[data-action="close"]')?.addEventListener('click', () => modal.close());
    $('[data-action="pick-midi"]')?.addEventListener('click', async () => {
      sourcePath = await pickMidiFile();
      if (!sourcePath) return;
      $('[data-role="source"]').textContent = sourcePath;
      $('[data-role="symbol"]').value = normalizeSymbol(sourcePath.split(/[\\/]/).pop() || 'midi_bgm');
    });
    $('[data-action="convert"]')?.addEventListener('click', async () => {
      const status = $('[data-role="status"]');
      if (!sourcePath) {
        status.textContent = 'MIDI ファイルを選択してください。';
        return;
      }
      const targetType = String($('[data-role="target-type"]').value || 'XGM2').toUpperCase();
      const symbol = normalizeSymbol($('[data-role="symbol"]').value);
      status.textContent = '変換中...';
      const result = await convertMidiMusic({
        sourcePath,
        symbol,
        outputs: {
          vgm: $('[data-role="vgm"]').checked,
          xgm: targetType === 'XGM' || $('[data-role="xgm"]').checked,
          registerAsset: false,
        },
      });
      if (!result?.ok) {
        status.textContent = result?.error || '変換に失敗しました。';
        return;
      }
      const asset = buildAssetFromResult(result, {
        targetType,
        symbol,
        timing: $('[data-role="timing"]').value,
        options: $('[data-role="options"]').value,
      });
      status.textContent = [
        `VGM: ${result.files?.vgm || 'なし'}`,
        `XGM: ${result.files?.xgm || 'なし'}`,
        `Asset: ${asset ? `${asset.type} ${asset.name}` : '登録可能な出力がありません'}`,
        result.stats ? `Notes: ${result.stats.note_on || 0}, Voice steal: ${result.stats.voice_steal || 0}` : '',
        ...(result.warnings || []),
      ].filter(Boolean).join('\n');
      if ($('[data-role="asset"]').checked) {
        if (!asset) {
          status.textContent += '\nXGM アセット登録には .xgm 生成が必要です。';
          return;
        }
        await registerAsset(asset, status);
      }
    });
    return modal;
  }

  function openMidiConvertModal(pending = {}) {
    const instance = createModal();
    configureModal(pending);
    instance.open();
    return pending;
  }

  function configureModal(pending = {}) {
    sourcePath = String(pending.sourcePath || pending.picked?.sourcePath || '');
    const root = modal?.panel || modal?.modal || null;
    const $ = (selector) => root?.querySelector(selector);
    const targetType = String(pending.normalizedType || pending.targetType || 'XGM2').toUpperCase();
    const symbol = normalizeSymbol(pending.symbol || sourcePath.split(/[\\/]/).pop() || 'midi_bgm');
    $('[data-role="source"]').textContent = sourcePath || '未選択';
    $('[data-role="symbol"]').value = symbol;
    $('[data-role="target-type"]').value = targetType === 'XGM' ? 'XGM' : 'XGM2';
    $('[data-role="timing"]').value = pending.timing || 'AUTO';
    $('[data-role="options"]').value = pending.options || '';
    $('[data-role="asset"]').checked = pending.registerAsset !== false;
    $('[data-role="xgm"]').checked = targetType === 'XGM';
    $('[data-role="status"]').textContent = '';
  }

  async function handleImport(payload = {}) {
    if (!isMidiPending(payload)) return { handled: false };
    const targetType = String(payload.normalizedType || 'XGM2').toUpperCase();
    const symbol = normalizeSymbol(payload.symbol || payload.targetFileName || payload.picked?.fileName || 'midi_bgm');
    const result = await convertMidiMusic({
      sourcePath: payload.picked?.sourcePath,
      symbol,
      targetSubdir: payload.targetSubdir || 'music',
      targetFileName: payload.targetFileName || `${symbol}.mid`,
      outputs: {
        vgm: true,
        xgm: targetType === 'XGM',
        registerAsset: false,
      },
    });
    if (!result?.ok) {
      return { handled: false, error: result?.error || 'MIDI 変換に失敗しました。' };
    }
    const asset = buildAssetFromResult(result, {
      targetType,
      symbol,
      timing: 'AUTO',
      options: '',
    });
    if (!asset) {
      const warning = (result.warnings || []).join('\n');
      return {
        handled: false,
        error: warning || 'XGM アセット登録には .xgm 生成が必要です。',
      };
    }
    const add = await registerAsset(asset, null, payload.resFile || 'resources.res');
    if (!add?.ok) {
      return { handled: false, error: add?.error || `${asset.type} アセット登録に失敗しました。` };
    }
    const warnings = (result.warnings || []).filter(Boolean);
    return {
      handled: true,
      message: [
        `${asset.name} を ${asset.type} アセットとして登録しました。`,
        result.files?.vgm ? `VGM: ${result.files.vgm}` : '',
        result.files?.xgm ? `XGM: ${result.files.xgm}` : '',
        result.stats ? `Notes: ${result.stats.note_on || 0}, Voice steal: ${result.stats.voice_steal || 0}` : '',
        ...warnings,
      ].filter(Boolean).join('\n'),
    };
  }

  registerCapability('midi-convert-ui', {
    convertMidiMusic,
    openMidiConvertModal,
  });

  registerCapability('asset-import-handler', {
    priority: 20,
    canHandle: isMidiPending,
    handleImport,
  });

  registerCapability('vgm-preview-player', vgmPreviewPlayer);

  logger.debug('midi-converter renderer activated');
  return {
    deactivate() {
      vgmPreviewPlayer.stop();
      modal?.destroy?.();
      modal = null;
    },
  };
}
