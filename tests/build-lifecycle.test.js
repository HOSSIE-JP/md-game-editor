'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-build-lifecycle-'));
}

function loadMain() {
  [
    '../main',
    '../core-manager',
    '../build-system',
    '../pce-build-system',
    '../setup-manager',
    '../pce-setup-manager',
    '../plugin-manager',
  ].forEach((request) => {
    try { delete require.cache[require.resolve(request)]; } catch (_) {}
  });
  return loadWithMockedElectron(path.join(__dirname, '..', 'main.js'), {
    userData: makeTempUserData(),
    app: {
      whenReady() {
        return { then() {} };
      },
    },
  }).__test;
}

function installBuildFakes(main, coreId) {
  const buildSystem = main.buildSystem;
  const setupManager = require('../setup-manager');
  const pluginManager = require('../plugin-manager');
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-build-project-'));
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });

  const originals = new Map();
  const patch = (object, key, value) => {
    if (!originals.has(object)) originals.set(object, new Map());
    originals.get(object).set(key, object[key]);
    object[key] = value;
  };
  const restore = () => {
    for (const [object, entries] of originals) {
      for (const [key, value] of entries) object[key] = value;
    }
  };

  const pluginId = coreId === 'pc-engine' ? 'fake-pce-builder' : 'fake-md-builder';
  const hookCalls = [];
  let buildCalls = 0;
  const sent = [];

  patch(buildSystem, 'getProjectDir', () => projectDir);
  patch(buildSystem, 'getActiveCoreId', () => coreId);
  patch(buildSystem, 'getPluginRole', (roleId) => roleId === 'builder' ? pluginId : null);
  patch(buildSystem, 'loadProjectConfig', () => ({
    coreId,
    platform: coreId === 'pc-engine' ? 'pce' : 'md',
    toolchain: 'test',
    pluginRoles: { builder: pluginId },
  }));
  patch(buildSystem, 'getPceSetupManager', () => ({
    getToolchainPath: () => path.join(projectDir, 'toolchain'),
  }));
  patch(buildSystem, 'buildProject', async () => {
    buildCalls += 1;
    return { success: true };
  });
  patch(setupManager, 'getToolchainDir', () => path.join(projectDir, 'sgdk'));
  patch(setupManager, 'getJavaExePath', () => null);
  patch(pluginManager, 'isPluginEnabled', () => true);
  patch(pluginManager, 'pluginSupportsCore', () => true);
  patch(pluginManager, 'listPlugins', () => [{
    id: pluginId,
    enabled: true,
    supportedCores: [coreId],
    roles: [{ id: 'builder', exclusive: true, order: 1 }],
  }]);
  patch(pluginManager, 'invokeHook', async (_id, hookName, payload) => {
    hookCalls.push({ hookName, payload });
    if (hookName === 'onBuildStart') return { ok: false, error: 'preflight rejected' };
    return { ok: true };
  });

  main.setMainWindowForTest({
    isDestroyed: () => false,
    webContents: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
    },
  });

  return {
    buildSystem,
    hookCalls,
    pluginId,
    projectDir,
    restore,
    sent,
    getBuildCalls: () => buildCalls,
  };
}

for (const coreId of ['mega-drive', 'pc-engine']) {
  test(coreId + ' onBuildStart failure aborts before the toolchain', async () => {
    const main = loadMain();
    const fake = installBuildFakes(main, coreId);
    try {
      const result = coreId === 'pc-engine'
        ? await main.runPceBuildFull()
        : await main.runBuildFull();

      assert.deepEqual(result, { success: false, error: 'preflight rejected' });
      assert.equal(fake.getBuildCalls(), 0);
      assert.equal(fake.hookCalls.filter((call) => call.hookName === 'onBuildStart').length, 1);
      assert.equal(fake.hookCalls.filter((call) => call.hookName === 'onBuildError').length, 1);
      assert.equal(fake.hookCalls.filter((call) => call.hookName === 'onBuildEnd').length, 0);
      const errorCall = fake.hookCalls.find((call) => call.hookName === 'onBuildError');
      assert.equal(errorCall.payload.phase, 'onBuildStart');
      assert.equal(fake.sent.filter((entry) => entry.channel === 'build-end').length, 1);
    } finally {
      main.setMainWindowForTest(null);
      fake.restore();
    }
  });
}

test('existing standard WASM Test Play window reloads every requested ROM', async () => {
  const main = loadMain();
  const loads = [];
  let focusCalls = 0;
  const fakeWindow = {
    isDestroyed: () => false,
    focus() {
      focusCalls += 1;
    },
    async loadFile(filePath, options) {
      loads.push({ filePath, options });
    },
  };
  main.setTestPlayWindowForTest(fakeWindow);
  try {
    const first = await main.openWasmTestPlayWindow({
      pluginId: 'standard-emulator',
      romPath: 'C:\\roms\\first.bin',
    });
    const second = await main.openWasmTestPlayWindow({
      pluginId: 'standard-emulator',
      romPath: 'C:\\roms\\second.bin',
    });

    assert.equal(first.reused, true);
    assert.equal(first.reloaded, true);
    assert.equal(second.reused, true);
    assert.equal(second.reloaded, true);
    assert.equal(focusCalls, 2);
    assert.equal(loads.length, 2);
    assert.match(loads[0].options.search, /first\.bin/);
    assert.match(loads[1].options.search, /second\.bin/);
    assert.notEqual(loads[0].options.search, loads[1].options.search);
  } finally {
    main.setTestPlayWindowForTest(null);
  }
});

test('flattened handled result from an emulator hook prevents fallback launch', async () => {
  const main = loadMain();
  const buildSystem = main.buildSystem;
  const pluginManager = require('../plugin-manager');
  const originals = {
    getPluginRole: buildSystem.getPluginRole,
    getActiveCoreId: buildSystem.getActiveCoreId,
    getProjectDir: buildSystem.getProjectDir,
    isPluginEnabled: pluginManager.isPluginEnabled,
    pluginSupportsCore: pluginManager.pluginSupportsCore,
    listPlugins: pluginManager.listPlugins,
    invokeHook: pluginManager.invokeHook,
  };
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-testplay-project-'));
  let fallbackCalls = 0;
  try {
    buildSystem.getPluginRole = () => 'fake-emulator';
    buildSystem.getActiveCoreId = () => 'mega-drive';
    buildSystem.getProjectDir = () => projectDir;
    pluginManager.isPluginEnabled = () => true;
    pluginManager.pluginSupportsCore = () => true;
    pluginManager.listPlugins = () => [{
      id: 'fake-emulator',
      enabled: true,
      supportedCores: ['mega-drive'],
      roles: [{ id: 'testplay', exclusive: true, order: 1 }],
    }];
    pluginManager.invokeHook = async () => ({
      ok: true,
      handled: true,
      result: { opened: true, reused: true, reloaded: true },
    });
    main.setTestPlayWindowForTest({
      isDestroyed: () => false,
      focus() {},
      async loadFile() {
        fallbackCalls += 1;
      },
    });

    const result = await main.openTestPlayWithPlugin('C:\\roms\\handled.bin');

    assert.equal(result.opened, true);
    assert.equal(result.reused, true);
    assert.equal(result.reloaded, true);
    assert.equal(result.handledByPlugin, 'fake-emulator');
    assert.equal(fallbackCalls, 0);
  } finally {
    buildSystem.getPluginRole = originals.getPluginRole;
    buildSystem.getActiveCoreId = originals.getActiveCoreId;
    buildSystem.getProjectDir = originals.getProjectDir;
    pluginManager.isPluginEnabled = originals.isPluginEnabled;
    pluginManager.pluginSupportsCore = originals.pluginSupportsCore;
    pluginManager.listPlugins = originals.listPlugins;
    pluginManager.invokeHook = originals.invokeHook;
    main.setTestPlayWindowForTest(null);
  }
});
