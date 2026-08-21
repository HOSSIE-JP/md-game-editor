'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readPackageConfig() {
  return fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf-8');
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
}

test('packaging declares main-process runtime dependencies', () => {
  const pkg = readPackageJson();

  assert.equal(pkg.dependencies?.['iconv-lite'], '0.6.3');
  assert.equal(pkg.devDependencies?.['iconv-lite'], undefined);
});

test('packaging exposes iconv-lite to external built-in plugins', () => {
  const config = readPackageConfig();
  const root = path.join(__dirname, '..');

  assert.match(config, /from:\s*node_modules\/iconv-lite[\s\S]*to:\s*node_modules\/iconv-lite/);
  assert.match(config, /from:\s*node_modules\/safer-buffer[\s\S]*to:\s*node_modules\/safer-buffer/);
  assert.equal(fs.existsSync(path.join(root, 'node_modules/iconv-lite/lib/index.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'node_modules/safer-buffer/safer.js')), true);
});
test('development start script forwards stop signals to Electron', () => {
  const pkg = readPackageJson();
  const scriptPath = path.join(__dirname, '..', 'scripts', 'start-electron.js');
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.equal(pkg.scripts?.start, 'node scripts/start-electron.js');
  assert.match(script, /SIGTERM/);
  assert.match(script, /child\.kill\(signal\)/);
  assert.match(script, /child\.kill\('SIGKILL'\)/);
});

test('packaging includes the bundled game editor template projects', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*template/);
  assert.match(config, /to:\s*template/);
  assert.match(config, /!\*\*\/out\/\*\*/);
  assert.doesNotMatch(config, /from:\s*projects\/sample_block_game/);
  assert.doesNotMatch(config, /from:\s*projects\/sample_slideshow/);
  assert.doesNotMatch(config, /from:\s*projects\/sample\s/);
  assert.doesNotMatch(config, /to:\s*projects\/sample\s/);
});

test('packaging source contains the MD novel plugins and clean starter template', () => {
  const root = path.join(__dirname, '..');
  const requiredFiles = [
    'plugins/md-novel-editor/manifest.json',
    'plugins/md-novel-editor/renderer-app.mjs',
    'plugins/md-novel-editor/novel-font.js',
    'plugins/md-novel-builder/template/res/novel/font/JF-Dot-Shinonome16.ttf',
    'plugins/md-novel-builder/template/res/novel/font/JF-Dot-Shinonome16-atlas.png',
    'plugins/md-novel-builder/template/res/novel/font/JF-Dot-Shinonome16-README.txt',
    'plugins/md-novel-builder/template/res/novel/font/JF-Dot-Shinonome16-LICENSE',
    'plugins/md-novel-builder/manifest.json',
    'plugins/md-novel-builder/template/src/novel_runtime/novel_runtime.c',
    'template/template_md_novel/project.json',
    'template/template_md_novel/assets/pce-vn-scenes.json',
    'template/template_md_novel/data/md-novel/asset-bindings.json',
    'template/template_md_novel/data/md-novel/target-profile.json',
    'template/template_md_novel/res/novel/font/generated.png',
    'template/template_md_novel/res/novel/font/JF-Dot-Shinonome16.ttf',
    'template/template_md_novel/res/novel/font/JF-Dot-Shinonome16-README.txt',
    'template/template_md_novel/res/novel/font/JF-Dot-Shinonome16-LICENSE',
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }

  const project = JSON.parse(fs.readFileSync(path.join(root, 'template/template_md_novel/project.json'), 'utf-8'));
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'template/template_md_novel/data/md-novel/target-profile.json'), 'utf-8'));
  assert.deepEqual(project.pluginRoles, { builder: 'md-novel-builder', testplay: 'standard-emulator' });
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'import'), false);
});

test('packaging keeps WASM runtime assets inside the standard emulator plugin', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  assert.doesNotMatch(config, /^\s*-\s*pkg\/\*\*/m);
  assert.doesNotMatch(config, /^\s*-\s*md-emulator\.js/m);
  assert.doesNotMatch(config, /^\s*-\s*md-emulator\.d\.ts/m);
});

test('packaging keeps md-api binary inside the standard API emulator plugin', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  assert.doesNotMatch(config, /from:\s*bin/);
  assert.doesNotMatch(config, /to:\s*bin/);
});

test('distribution preparation uses bundled emulator assets without parent repo builds', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-dist.js'), 'utf-8');

  assert.match(script, /copy-pkg\.js/);
  assert.doesNotMatch(script, /build-wasm-package/);
  assert.doesNotMatch(script, /cargo/);
  assert.doesNotMatch(script, /md-api/);
});
