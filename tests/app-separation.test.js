'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeAppConfig } = require('../app-config');

test('MD app config is Mega Drive only and uses a separate app id', () => {
  const config = normalizeAppConfig(require('../app.config'));
  assert.equal(config.appId, 'jp.co.geroneko.md.editor.desktop');
  assert.deepEqual(config.allowedCoreIds, ['mega-drive']);
  assert.equal(config.defaultCoreId, 'mega-drive');
});

test('MD plugin tree excludes PCE-only built-ins after split', () => {
  const pluginsRoot = path.join(__dirname, '..', 'plugins');
  assert.equal(fs.existsSync(path.join(pluginsRoot, 'mega-drive-core')), true);
  assert.equal(fs.existsSync(path.join(pluginsRoot, 'pc-engine-core')), false);
  assert.equal(fs.existsSync(path.join(pluginsRoot, 'pce-asset-manager')), false);
  assert.equal(fs.existsSync(path.join(pluginsRoot, 'code-editor')), true);
});
