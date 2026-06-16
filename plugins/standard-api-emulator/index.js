'use strict';

/**
 * 標準エミュレーター（API）プラグイン
 * Test Play 開始時に REST API サーバーを起動し、API 操作用サブウィンドウを開きます。
 */

/**
 * @param {{ romPath?: string }} payload
 * @param {{ testPlay?: { openApiWindow?: Function }, logger?: { info?: Function } }} context
 */
async function onTestPlay(payload, context = {}) {
  if (!context.testPlay || typeof context.testPlay.openApiWindow !== 'function') {
    return { ok: false, error: 'Test Play host API is unavailable' };
  }

  const result = await context.testPlay.openApiWindow({
    romPath: payload?.romPath || null,
    pluginId: 'standard-api-emulator',
  });
  context.logger?.info?.(`API Test Play window opened on port ${result?.port || 'unknown'}`);
  return { ok: true, handled: true, result };
}

module.exports = { onTestPlay };
