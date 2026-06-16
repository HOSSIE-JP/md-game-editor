export function activatePlugin({ plugin, api, logger, registerCapability }) {
  async function convertAudio(payload) {
    const result = await api.plugins.invokeHook(plugin.id, 'convertAudio', {
      sourcePath: payload?.sourcePath,
      options: payload?.options || {},
    });
    if (!result?.ok) return result || { ok: false, error: 'audio conversion failed' };
    const outputPath = String(result?.result?.outputPath || result?.outputPath || '');
    if (!outputPath) return { ok: false, error: 'audio converter did not produce output file' };
    return {
      ok: true,
      outputPath,
      warning: result?.result?.warning || result?.warning || '',
    };
  }

  async function previewAudioDataUrl(payload) {
    const converted = await convertAudio(payload);
    if (!converted?.ok) return converted;
    return api.electronAPI.readTempFileAsDataUrl(converted.outputPath, { deleteAfter: true });
  }

  async function convertAndWriteAsset(payload) {
    let convertedPath = '';
    try {
      const converted = await convertAudio(payload);
      if (!converted?.ok) return converted;
      convertedPath = converted.outputPath;
      const written = await api.electronAPI.writeAssetFile({
        sourcePath: convertedPath,
        targetSubdir: payload?.targetSubdir,
        targetFileName: payload?.targetFileName,
        dataUrl: '',
      });
      return {
        ...written,
        warning: converted.warning || written?.warning || '',
      };
    } finally {
      if (convertedPath && convertedPath !== String(payload?.sourcePath || '')) {
        try { await api.electronAPI.deleteTempFile(convertedPath); } catch (_) {}
      }
    }
  }

  registerCapability('audio-convert-ui', {
    openAudioConvertModal: (pending) => api.openAudioConvertModal({
      ...pending,
      previewAudioDataUrl,
      convertAndWriteAsset,
    }),
  });

  logger.debug('audio-converter renderer activated');
}
