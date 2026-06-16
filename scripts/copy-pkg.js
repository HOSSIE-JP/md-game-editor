'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const standardEmulatorRoot = path.join(appRoot, 'plugins', 'standard-emulator');
const toPkg = path.join(standardEmulatorRoot, 'pkg');
const toWrapper = path.join(standardEmulatorRoot, 'md-emulator.js');
const toTypes = path.join(standardEmulatorRoot, 'md-emulator.d.ts');
const toPlayer = path.join(standardEmulatorRoot, 'wasm-player.js');
const metadataPath = path.join(standardEmulatorRoot, 'emulator-build.json');

const REQUIRED_ASSETS = [
  ['pkg/md_wasm.js', path.join(toPkg, 'md_wasm.js')],
  ['pkg/md_wasm_bg.wasm', path.join(toPkg, 'md_wasm_bg.wasm')],
  ['pkg/package.json', path.join(toPkg, 'package.json')],
  ['pkg/build_meta.js', path.join(toPkg, 'build_meta.js')],
  ['md-emulator.js', toWrapper],
  ['wasm-player.js', toPlayer],
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

function parseBuildMeta(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const match = text.match(/__BUILD_META_VERSION\s*=\s*"([^"]+)"/);
    return match?.[1] || 'unknown';
  } catch (_err) {
    return 'unknown';
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function gitOutput(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function resolveSourceRepo() {
  const source = process.env.MD_EMULATOR_REPO;
  if (!source) return null;
  const repoRoot = path.resolve(source);
  const pkgDir = path.join(repoRoot, 'frontend', 'pkg');
  if (!fs.existsSync(pkgDir)) {
    throw new Error(`MD_EMULATOR_REPO does not contain frontend/pkg: ${repoRoot}`);
  }
  return repoRoot;
}

function copyFromSourceRepo(repoRoot) {
  const fromPkg = path.join(repoRoot, 'frontend', 'pkg');
  const fromWrapper = path.join(repoRoot, 'frontend', 'md-emulator.js');
  const fromTypes = path.join(repoRoot, 'frontend', 'md-emulator.d.ts');
  const fromPlayer = path.join(repoRoot, 'frontend', 'wasm-player.js');

  for (const required of [fromPkg, fromWrapper, fromPlayer]) {
    if (!fs.existsSync(required)) {
      throw new Error(`missing source WASM asset: ${required}`);
    }
  }

  copyRecursive(fromPkg, toPkg);
  copyRecursive(fromWrapper, toWrapper);
  if (fs.existsSync(fromTypes)) {
    copyRecursive(fromTypes, toTypes);
  }
  copyRecursive(fromPlayer, toPlayer);
}

function writeTrackedPkgIgnore() {
  const ignorePath = path.join(toPkg, '.gitignore');
  const text = [
    '*',
    '!.gitignore',
    '!README.md',
    '!build_meta.js',
    '!md_wasm.d.ts',
    '!md_wasm.js',
    '!md_wasm_bg.wasm',
    '!md_wasm_bg.wasm.d.ts',
    '!package.json',
    '',
  ].join('\n');
  fs.writeFileSync(ignorePath, text, 'utf-8');
}

function ensureBundledAssets() {
  const missing = REQUIRED_ASSETS
    .filter(([, filePath]) => !fs.existsSync(filePath))
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(
      `missing bundled WASM assets: ${missing.join(', ')}. ` +
      'Set MD_EMULATOR_REPO=/path/to/md_emulator and run npm run copy-pkg to refresh them.',
    );
  }
}

function buildSourceInfo(repoRoot, previous) {
  if (!repoRoot) {
    return previous?.source || {
      type: 'bundled',
      note: 'No source repository was supplied when this metadata was written.',
    };
  }

  const commit = gitOutput(repoRoot, ['rev-parse', 'HEAD']) || 'unknown';
  const shortCommit = gitOutput(repoRoot, ['rev-parse', '--short=12', 'HEAD']) || 'unknown';
  const remote = gitOutput(repoRoot, ['remote', 'get-url', 'origin']) || '';
  const dirty = Boolean(gitOutput(repoRoot, ['status', '--porcelain', '--untracked-files=no']));

  return {
    type: 'git',
    repositoryPath: repoRoot,
    remote,
    commit,
    shortCommit,
    dirty,
  };
}

function buildMetadata(repoRoot) {
  const previous = readJson(metadataPath);
  const pkgJson = readJson(path.join(toPkg, 'package.json')) || {};
  const files = {};

  for (const [label, filePath] of REQUIRED_ASSETS) {
    files[label] = {
      sha256: sha256File(filePath),
    };
  }

  return {
    schemaVersion: 1,
    component: 'md-emulator-wasm',
    packageVersion: String(pkgJson.version || 'unknown'),
    buildMetaVersion: parseBuildMeta(path.join(toPkg, 'build_meta.js')),
    capturedAt: repoRoot ? new Date().toISOString() : (previous?.capturedAt || new Date().toISOString()),
    source: buildSourceInfo(repoRoot, previous),
    files,
  };
}

function writeMetadata(repoRoot) {
  const shouldWrite = Boolean(repoRoot) || !fs.existsSync(metadataPath);
  if (!shouldWrite) return;

  const metadata = buildMetadata(repoRoot);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
}

function main() {
  const sourceRepo = resolveSourceRepo();
  if (sourceRepo) {
    copyFromSourceRepo(sourceRepo);
  }

  writeTrackedPkgIgnore();
  ensureBundledAssets();
  writeMetadata(sourceRepo);

  if (sourceRepo) {
    console.log(`Copied MD emulator WASM assets from ${sourceRepo}.`);
  } else {
    console.log('Bundled MD emulator WASM assets verified.');
  }
}

main();
