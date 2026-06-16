'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadAppConfig } = require('../app-config');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadCoreManager(userData, home = makeTempDir('md-editor-core-home-')) {
  loadAppConfig(require('../app.config'));
  delete require.cache[require.resolve('../core-manager')];
  delete require.cache[require.resolve('../build-system')];
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../setup-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'core-manager.js'), {
    userData,
    paths: { userData, home },
  });
}

test('MD editor exposes only the Mega Drive core', () => {
  const coreManager = loadCoreManager(makeTempDir('md-editor-core-state-'));
  assert.deepEqual(coreManager.listCores().map((core) => core.id), ['mega-drive']);
});

test('core manager treats legacy and PCE configs as Mega Drive inside the MD app', () => {
  const userData = makeTempDir('md-editor-core-state-');
  const coreManager = loadCoreManager(userData);
  const parent = makeTempDir('md-editor-core-projects-');
  const mdProject = path.join(parent, 'md');
  const pceProject = path.join(parent, 'pce');
  fs.mkdirSync(mdProject, { recursive: true });
  fs.mkdirSync(pceProject, { recursive: true });
  fs.writeFileSync(path.join(mdProject, 'project.json'), JSON.stringify({ title: 'MD' }), 'utf-8');
  fs.writeFileSync(path.join(pceProject, 'project.json'), JSON.stringify({ platform: 'pce', title: 'PCE' }), 'utf-8');

  assert.equal(coreManager.getCoreIdForProjectDir(mdProject), 'mega-drive');
  assert.equal(coreManager.getCoreIdForProjectDir(pceProject), 'mega-drive');
});
