'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const args = process.argv.slice(2);
const showWindow = args.includes('--show');
const useHighestRefreshDisplay = args.includes('--highest-refresh');
const startGame = args.includes('--start');
const positional = args.filter((arg) => !arg.startsWith('--'));
const romPath = positional[0] ? path.resolve(positional[0]) : '';
const sampleDurationMs = Math.max(2500, Number(positional[1] || 5000));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPerformanceBridge(window, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await window.webContents.executeJavaScript(
      'window.__mdDebugBridge?.getPerformanceSnapshot?.() || { ok: false }',
      true,
    );
    if (snapshot?.ok && snapshot.totalEmulatedFrames > 0) return snapshot;
    await delay(100);
  }
  throw new Error('Test Play did not start within the timeout');
}

async function verify() {
  if (!romPath || !fs.existsSync(romPath)) {
    throw new Error('Usage: npm run verify:standard-emulator-fps -- <rom.bin> [durationMs] [--show]');
  }

  ipcMain.handle('fs:readRomFile', async (_event, filePath) => {
    const resolved = path.resolve(String(filePath || ''));
    if (resolved !== romPath) throw new Error('Unexpected ROM path');
    return fs.readFileSync(resolved);
  });
  ipcMain.handle('testplay:getSettings', async () => ({}));
  ipcMain.handle('window:openDebug', async () => ({ opened: false }));
  ipcMain.handle('window:openTestPlaySettings', async () => ({ opened: false }));

  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-emulator');
  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    displayFrequency: display.displayFrequency,
    scaleFactor: display.scaleFactor,
  }));
  const targetDisplay = useHighestRefreshDisplay
    ? displays.reduce((best, display) => (
      Number(display.displayFrequency || 0) > Number(best?.displayFrequency || 0) ? display : best
    ), null)
    : null;
  const targetBounds = targetDisplay?.workArea;
  const window = new BrowserWindow({
    show: showWindow,
    width: 800,
    height: 720,
    ...(targetBounds ? {
      x: Math.round(targetBounds.x + Math.max(0, (targetBounds.width - 800) / 2)),
      y: Math.round(targetBounds.y + Math.max(0, (targetBounds.height - 720) / 2)),
    } : {}),
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(pluginDir, 'testplay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const rendererErrors = [];
  window.webContents.on('console-message', (event) => {
    if (Number(event.level) >= 3) rendererErrors.push(String(event.message || 'renderer error'));
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push(`render process gone: ${details.reason}`);
  });

  try {
    await window.loadFile(path.join(pluginDir, 'testplay.html'), {
      search: `?romPath=${encodeURIComponent(romPath)}`,
    });
    await waitForPerformanceBridge(window);
    if (startGame) {
      await window.webContents.executeJavaScript(
        `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))`,
        true,
      );
      await delay(250);
      await window.webContents.executeJavaScript(
        `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter' }))`,
        true,
      );
      await delay(500);
    }
    await delay(sampleDurationMs);
    const snapshot = await window.webContents.executeJavaScript(
      'window.__mdDebugBridge.getPerformanceSnapshot()',
      true,
    );
    const result = {
      romPath,
      sampleDurationMs,
      visibleWindow: showWindow,
      startedGame: startGame,
      displays,
      targetDisplay,
      ...snapshot,
      rendererErrors,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (!snapshot.ok) throw new Error(snapshot.error || 'FPS snapshot failed');
    if (snapshot.emulatedFps < 55 || snapshot.emulatedFps > 65) {
      throw new Error(`Emulation rate outside 60fps tolerance: ${snapshot.emulatedFps}`);
    }
    if (snapshot.presentedFps < 55 || snapshot.presentedFps > 65) {
      throw new Error(`Presentation rate outside 60fps tolerance: ${snapshot.presentedFps}`);
    }
    if (rendererErrors.length > 0) {
      throw new Error(`Renderer errors: ${rendererErrors.join('; ')}`);
    }

  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

app.whenReady()
  .then(verify)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
