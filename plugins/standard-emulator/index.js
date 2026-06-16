'use strict';

/**
 * 標準エミュレーター（WASM）プラグイン
 * TestPlay 実行時のフックを提供します。
 * エミュレーターウィンドウ本体はこのプラグイン内の HTML / preload から起動します。
 */

/**
 * @param {{ romPath: string }} payload
 * @param {{ testPlay?: { openWasmWindow?: Function } }} context
 */
async function onTestPlay(payload, context = {}) {
  if (!context.testPlay || typeof context.testPlay.openWasmWindow !== 'function') {
    return { ok: false, error: 'Test Play host API is unavailable' };
  }

  const result = await context.testPlay.openWasmWindow({
    romPath: payload?.romPath || null,
    pluginId: 'standard-emulator',
  });
  return { ok: true, handled: true, result };
}

module.exports = { onTestPlay };
