'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

function readManifest(pluginId) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', pluginId, 'manifest.json'),
    'utf-8',
  ));
}

test('standard WASM emulator owns its bundled testplay assets and handles launch', async () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-emulator');
  const manifest = readManifest('standard-emulator');
  const plugin = require(path.join(pluginDir, 'index.js'));

  assert.ok(manifest.permissions.includes('testplay.launch'));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay.html')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay-preload.js')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay-emulator.js')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay-frame-pacer.mjs')));
  const html = fs.readFileSync(path.join(pluginDir, 'testplay.html'), 'utf-8');
  assert.match(html, /import MdEmulator from ['"]\.\/testplay-emulator\.js['"]/);
  assert.match(html, /new URL\(['"]\.\/pkg\/md_wasm\.js['"],\s*import\.meta\.url\)/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/pkg\/md_wasm\.js/);
  assert.match(html, /getPerformanceSnapshot/);

  let received = null;
  const result = await plugin.onTestPlay({ romPath: 'game.bin' }, {
    testPlay: {
      openWasmWindow: async (options) => {
        received = options;
        return { opened: true };
      },
    },
  });

  assert.deepEqual(received, { romPath: 'game.bin', pluginId: 'standard-emulator' });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});

test('standard WASM testplay keeps near-60Hz callbacks from collapsing to 30Hz', async () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-emulator');
  const pacer = await import(pathToFileURL(path.join(pluginDir, 'testplay-frame-pacer.mjs')).href);
  let accumulatorMs = 0;
  let emulatedFrames = 0;
  let presentationCallbacks = 0;

  for (let callback = 0; callback < 600; callback += 1) {
    const elapsedMs = callback === 0 ? pacer.FRAME_MS : pacer.FRAME_MS - 0.05;
    const batch = pacer.planFrameBatch(accumulatorMs, elapsedMs);
    accumulatorMs = batch.accumulatorMs;
    emulatedFrames += batch.framesDue;
    if (batch.framesDue > 0) presentationCallbacks += 1;
  }

  assert.ok(emulatedFrames >= 597 && emulatedFrames <= 600, `unexpected emulated frame count: ${emulatedFrames}`);
  assert.ok(presentationCallbacks >= 595, `unexpected presentation callback count: ${presentationCallbacks}`);

  const catchUp = pacer.planFrameBatch(0, pacer.FRAME_MS * 20);
  assert.equal(catchUp.framesDue, 1);
  assert.equal(pacer.shouldUseTimerFallback(32, 3.5), true);
  assert.equal(pacer.shouldUseTimerFallback(60, 3.5), false);
  assert.equal(pacer.shouldUseTimerFallback(32, 14), true);
  assert.equal(pacer.shouldUseTimerFallback(32, 15.5), false);

  const adapter = fs.readFileSync(path.join(pluginDir, 'testplay-emulator.js'), 'utf-8');
  assert.match(adapter, /maxCatchUpFrames:\s*MAX_CATCH_UP_FRAMES/);
  assert.match(adapter, /super\._runOneFrame\(\)/);
  assert.match(adapter, /shouldUseTimerFallback\(presentedFps, averageWorkMs\)/);
  assert.doesNotMatch(adapter, /for \(let i = 0; i < batch\.framesDue/);

  const html = fs.readFileSync(path.join(pluginDir, 'testplay.html'), 'utf-8');
  assert.match(html, /setInterval\(tickInput, INPUT_POLL_MS\)/);
  assert.doesNotMatch(html, /requestAnimationFrame\(tickInput\)/);
});

test('WASM Test Play disables Chromium background frame throttling', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const start = source.indexOf('async function openWasmTestPlayWindow');
  const end = source.indexOf('async function openApiTestPlayWindow', start);
  const openWasmSource = source.slice(start, end);
  assert.match(openWasmSource, /backgroundThrottling:\s*false/);
});

test('standard API emulator declares testplay role and opens API-backed testplay window', async () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-api-emulator');
  const manifest = readManifest('standard-api-emulator');
  const plugin = require(path.join(pluginDir, 'index.js'));
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const prepareDistSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-dist.js'), 'utf-8');

  assert.equal(manifest.tab, undefined);
  assert.equal(manifest.renderer, undefined);
  assert.deepEqual(manifest.roles, [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 21 }]);
  assert.ok(manifest.permissions.includes('api.start'));
  assert.ok(fs.existsSync(path.join(pluginDir, 'api-testplay.html')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'api-testplay-preload.js')));
  assert.doesNotMatch(prepareDistSource, /standard-api-emulator/);
  assert.doesNotMatch(prepareDistSource, /md-api/);
  assert.match(mainSource, /getPluginDirectory\('standard-api-emulator'\)/);
  assert.match(mainSource, /path\.join\(standardApiEmulatorDir,\s*'bin',\s*binName\)/);
  assert.match(mainSource, /does not build md-api/);
  assert.doesNotMatch(mainSource, /process\.resourcesPath,\s*'bin'/);

  let received = null;
  const result = await plugin.onTestPlay({ romPath: 'game.bin' }, {
    testPlay: {
      openApiWindow: async (options) => {
        received = options;
        return { opened: true, port: 8080 };
      },
    },
    logger: { info() {} },
  });

  assert.deepEqual(received, { romPath: 'game.bin', pluginId: 'standard-api-emulator' });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});
