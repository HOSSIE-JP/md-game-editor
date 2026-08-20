'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const runtimeModuleUrl = pathToFileURL(
  path.join(__dirname, '..', 'renderer', 'plugin-runtime.mjs'),
).href;

async function loadRuntimeModule() {
  return import(runtimeModuleUrl);
}

test('renderer plugin lifecycle awaits active plugins in activation order', async () => {
  const { createPluginRuntime, runPluginRuntimeLifecycle } = await loadRuntimeModule();
  const runtime = createPluginRuntime();
  const calls = [];

  runtime.activations.set('first', {
    async beforeBuild(payload) {
      await Promise.resolve();
      calls.push(['first', payload.pluginId, payload.lifecycle, payload.marker]);
      return { ok: true };
    },
  });
  runtime.activations.set('second', {
    beforeBuild(payload) {
      calls.push(['second', payload.pluginId, payload.lifecycle, payload.marker]);
      return true;
    },
  });

  const result = await runPluginRuntimeLifecycle(runtime, 'beforeBuild', { marker: 7 });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['first', 'first', 'beforeBuild', 7],
    ['second', 'second', 'beforeBuild', 7],
  ]);
});

test('renderer plugin lifecycle stops at an explicit veto', async () => {
  const { createPluginRuntime, runPluginRuntimeLifecycle } = await loadRuntimeModule();
  const runtime = createPluginRuntime();
  let secondCalled = false;

  runtime.activations.set('editor', {
    beforeProjectSwitch() {
      return { ok: false, error: 'save failed', canceled: true };
    },
  });
  runtime.activations.set('later', {
    beforeProjectSwitch() {
      secondCalled = true;
    },
  });

  const result = await runPluginRuntimeLifecycle(runtime, 'beforeProjectSwitch');

  assert.equal(result.ok, false);
  assert.equal(result.pluginId, 'editor');
  assert.equal(result.error, 'save failed');
  assert.equal(result.canceled, true);
  assert.equal(secondCalled, false);
});

test('renderer plugin lifecycle converts thrown errors into a veto', async () => {
  const { createPluginRuntime, runPluginRuntimeLifecycle } = await loadRuntimeModule();
  const runtime = createPluginRuntime();
  const reported = [];

  runtime.activations.set('broken', {
    async beforeBuild() {
      throw new Error('flush exploded');
    },
  });

  const result = await runPluginRuntimeLifecycle(
    runtime,
    'beforeBuild',
    {},
    (error, pluginId) => reported.push([pluginId, error.message]),
  );

  assert.equal(result.ok, false);
  assert.equal(result.pluginId, 'broken');
  assert.equal(result.error, 'flush exploded');
  assert.deepEqual(reported, [['broken', 'flush exploded']]);
});
