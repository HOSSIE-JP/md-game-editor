export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="api-emulator-page">
      <div class="api-emulator-header">
        <div>
          <h2>REST API Emulator</h2>
          <p>md-api サーバーを起動して、外部クライアントや API Test Play から操作できます。</p>
        </div>
        <div class="api-emulator-status" data-status>確認中...</div>
      </div>
      <div class="api-emulator-controls">
        <label>
          Port
          <input data-port type="number" min="1024" max="65535" value="8080" />
        </label>
        <button data-start>Start API</button>
        <button data-stop>Stop API</button>
        <button data-refresh>Refresh</button>
      </div>
      <div class="api-emulator-info" data-info></div>
      <pre class="api-emulator-log" data-log></pre>
    </div>
  `;

  const ui = {
    port: root.querySelector('[data-port]'),
    start: root.querySelector('[data-start]'),
    stop: root.querySelector('[data-stop]'),
    refresh: root.querySelector('[data-refresh]'),
    status: root.querySelector('[data-status]'),
    info: root.querySelector('[data-info]'),
    log: root.querySelector('[data-log]'),
  };

  function appendLog(text) {
    ui.log.textContent = `${ui.log.textContent}\n${text}`.trim().slice(-12000);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function setStatus(running, port) {
    ui.status.textContent = running ? `Running : ${port}` : 'Stopped';
    ui.status.dataset.running = running ? 'true' : 'false';
    ui.stop.disabled = !running;
  }

  async function refresh() {
    const state = await api.electronAPI.isApiServerRunning();
    setStatus(Boolean(state?.running), state?.port || '-');
    ui.info.textContent = state?.running
      ? `Base URL: http://127.0.0.1:${state.port}`
      : 'API サーバーは停止しています。';
  }

  ui.start.addEventListener('click', async () => {
    const port = Number(ui.port.value) || 8080;
    const result = await api.electronAPI.startApiServer({ port });
    appendLog(`start: ${JSON.stringify(result)}`);
    await refresh();
  });

  ui.stop.addEventListener('click', async () => {
    const result = await api.electronAPI.stopApiServer();
    appendLog(`stop: ${JSON.stringify(result)}`);
    await refresh();
  });

  ui.refresh.addEventListener('click', refresh);

  api.electronAPI.onApiLog((payload) => {
    const message = String(payload?.message || payload?.text || '').trim();
    if (message) appendLog(message);
  });
  api.electronAPI.onApiExit((payload) => {
    appendLog(`exit: ${JSON.stringify(payload)}`);
    refresh().catch(() => {});
  });

  registerCapability('api-emulator-control', {
    refresh,
    start: (options = {}) => api.electronAPI.startApiServer(options),
    stop: () => api.electronAPI.stopApiServer(),
  });

  refresh().catch((err) => {
    ui.status.textContent = `確認失敗: ${err?.message || err}`;
  });

  return {
    deactivate() {
      root.innerHTML = '';
    },
  };
}
