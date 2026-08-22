'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.json');
const codegen = require('./codegen');
const service = require('../md-novel-editor/novel-service');
const { FONT_FORMAT_VERSION } = require('../md-novel-editor/novel-font');

const GENERATED_MANIFEST = 'data/md-novel/generated-manifest.json';
const GENERATED_MANIFEST_VERSION = 4;
const MESSAGE_SHAPE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABlBMVEUAAAD///+l2Z/dAAAAAnRSTlMA/1uRIrUAAAAWSURBVHjaY2AkABhGFYwqGFUwUhUAAESYBAF9lrJwAAAAAElFTkSuQmCC', 'base64');


const STATIC_FILES = Object.freeze({
  'src/main.c': 'src/main.c',
  'src/novel_runtime/novel_runtime.c': 'src/novel_runtime/novel_runtime.c',
  'inc/novel_runtime/novel_runtime.h': 'inc/novel_runtime/novel_runtime.h',
  'src/boot/sega.s': 'src/boot/sega.s',
  'res/novel/font/JF-Dot-Shinonome16.ttf': 'res/novel/font/JF-Dot-Shinonome16.ttf',
  'res/novel/font/JF-Dot-Shinonome16-README.txt': 'res/novel/font/JF-Dot-Shinonome16-README.txt',
  'res/novel/font/JF-Dot-Shinonome16-LICENSE': 'res/novel/font/JF-Dot-Shinonome16-LICENSE',
});

const SOURCE_FILES = Object.freeze([
  'src/main.c',
  'src/novel_runtime/novel_runtime.c',
  'src/generated/novel_data.c',
]);

function templateRoot() {
  return path.join(__dirname, 'template');
}

function fileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function collectStaticFiles() {
  return {
    ...Object.fromEntries(Object.entries(STATIC_FILES).map(([target, source]) => [target, fs.readFileSync(path.join(templateRoot(), source))])),
    'res/novel/system/message-shapes.png': MESSAGE_SHAPE_PNG,
  };
}

function resSymbols(text) {
  const symbols = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(?:IMAGE|SPRITE|TILESET|MAP|BITMAP|PALETTE|XGM2|WAV|BIN)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (match) symbols.push(match[1]);
  }
  return symbols;
}

function collectOtherResSymbols(projectDir) {
  const root = path.join(projectDir, 'res');
  const result = new Map();
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name.endsWith('.res') && path.resolve(target) !== path.resolve(root, 'novel.res')) {
        for (const symbol of resSymbols(fs.readFileSync(target, 'utf8'))) result.set(symbol.toLowerCase(), target);
      }
    }
  }
  walk(root);
  return result;
}

function validateResSymbols(projectDir, novelRes) {
  const other = collectOtherResSymbols(projectDir);
  const seen = new Set();
  for (const symbol of resSymbols(novelRes)) {
    const key = symbol.toLowerCase();
    if (seen.has(key)) throw new Error(`Novel ResComp symbol is duplicated: ${symbol}`);
    if (other.has(key)) throw new Error(`ResComp symbol conflicts with ${other.get(key)}: ${symbol}`);
    seen.add(key);
  }
}

function groupedWarnings(warnings) {
  const groups = new Map();
  for (const warning of warnings || []) {
    const code = warning.code || 'warning';
    if (!groups.has(code)) groups.set(code, { count: 0, example: warning.message || String(warning) });
    groups.get(code).count++;
  }
  return [...groups.entries()].map(([code, value]) => `${code}: ${value.count}件 (${value.example})`);
}
async function readGeneratedManifest(projectDir) {
  try {
    const target = await service.resolveProjectPath(projectDir, GENERATED_MANIFEST, { mustExist: true });
    return await service.readJsonFile(target, { maxBytes: 4 * 1024 * 1024 });
  } catch (_error) {
    return null;
  }
}

function toolchainIdentity(toolchainPath) {
  const root = path.resolve(String(toolchainPath || ''));
  const candidates = ['makefile.gen', 'bin/rescomp.jar', 'bin/rescomp.exe', 'bin/rescomp'];
  return {
    root,
    files: candidates.map((relativePath) => {
      const target = path.join(root, relativePath);
      if (!fs.existsSync(target)) return [relativePath, null];
      const stat = fs.statSync(target);
      return [relativePath, stat.size, Math.round(stat.mtimeMs), fileHash(fs.readFileSync(target))];
    }),
  };
}

function buildContractHash(payload, staticFiles) {
  const contract = {
    schemaVersion: GENERATED_MANIFEST_VERSION,
    runtimeAbi: 4,
    fontFormatVersion: FONT_FORMAT_VERSION,
    sourceFiles: SOURCE_FILES,
    staticFiles: Object.fromEntries(Object.entries(staticFiles).map(([relativePath, value]) => [relativePath, fileHash(value)])),
    builder: fileHash(fs.readFileSync(__filename)),
    codegen: fileHash(fs.readFileSync(path.join(__dirname, 'codegen.js'))),
    rescomp: 'TILESET:subset-16x16;IMAGE:NONE-ALL;SPRITE:BALANCED-FAST+message-shapes-NONE;XGM2;WAV:XGM2-6650',
    toolchain: toolchainIdentity(payload.toolchainPath),
  };
  return fileHash(Buffer.from(JSON.stringify(contract), 'utf8'));
}

async function inspectBuildCache(projectDir, previous, contractHash) {
  if (!previous) return { valid: false, reason: 'generated manifest missing' };
  if (previous.schemaVersion !== GENERATED_MANIFEST_VERSION) return { valid: false, reason: 'generated manifest version changed' };
  if (!previous.lastBuildSuccess) return { valid: false, reason: 'previous build did not complete successfully' };
  if (previous.contractHash !== contractHash) return { valid: false, reason: 'toolchain, SRC_C, runtime ABI, font format, or ResComp contract changed' };
  for (const [relativePath, expectedHash] of Object.entries(previous.files || {})) {
    try {
      const target = await service.resolveProjectPath(projectDir, relativePath, { mustExist: true });
      if (fileHash(fs.readFileSync(target)) !== expectedHash) return { valid: false, reason: `generated file cache mismatch: ${relativePath}` };
    } catch (_error) {
      return { valid: false, reason: `generated file cache missing: ${relativePath}` };
    }
  }
  const romRelative = String(previous.romPath || 'out/rom.bin').replace(/\\/g, '/');
  try {
    const target = await service.resolveProjectPath(projectDir, romRelative, { mustExist: true });
    if (!previous.romSha256) return { valid: false, reason: 'previous ROM hash is missing' };
    if (fileHash(fs.readFileSync(target)) !== previous.romSha256) return { valid: false, reason: 'previous ROM cache mismatch' };
  } catch (_error) {
    return { valid: false, reason: 'previous ROM is missing' };
  }
  if (!Array.isArray(previous.objectFiles) || previous.objectFiles.length === 0) return { valid: false, reason: 'previous object list is missing' };
  for (const relativePath of previous.objectFiles) {
    try {
      const target = await service.resolveProjectPath(projectDir, relativePath, { mustExist: true });
      const expected = previous.objectHashes?.[relativePath];
      if (!expected) return { valid: false, reason: `previous object hash is missing: ${relativePath}` };
      if (fileHash(fs.readFileSync(target)) !== expected) return { valid: false, reason: `previous object cache mismatch: ${relativePath}` };
    } catch (_error) {
      return { valid: false, reason: `previous object is missing: ${relativePath}` };
    }
  }
  return { valid: true, reason: 'previous ROM, objects, generated files, and build contract verified' };
}

function collectObjectFiles(projectDir) {
  const root = path.join(projectDir, 'out');
  const result = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && /\.(?:o|a)$/i.test(entry.name)) result.push(path.relative(projectDir, target).replace(/\\/g, '/'));
    }
  }
  walk(root);
  return result.sort();
}

async function writeGeneratedManifest(projectDir, value) {
  const root = await service.ensureProjectRoot(projectDir);
  const target = await service.resolveProjectPath(root, GENERATED_MANIFEST);
  await service.writeAtomicIfChanged(root, target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
  return value;
}


async function commitGeneratedFiles(projectDir, files, report, metadata = {}) {
  const root = await service.ensureProjectRoot(projectDir);
  const buildId = `${Date.now()}-${crypto.randomUUID()}`;
  const stageRelative = `data/md-novel/.staging/${buildId}`;
  const stageRoot = await service.resolveProjectPath(root, stageRelative);
  fs.mkdirSync(stageRoot, { recursive: true });
  const hashes = {};
  const changedFiles = [];
  const unchangedFiles = [];
  try {
    for (const [relativePath, value] of Object.entries(files)) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      const stageTarget = path.join(stageRoot, relativePath.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(stageTarget), { recursive: true });
      fs.writeFileSync(stageTarget, buffer);
      hashes[relativePath] = fileHash(buffer);
    }
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const actual = fileHash(fs.readFileSync(path.join(stageRoot, relativePath.replace(/\//g, path.sep))));
      if (actual !== expected) throw new Error(`Staging hash mismatch: ${relativePath}`);
    }
    for (const relativePath of Object.keys(files)) {
      const target = await service.resolveProjectPath(root, relativePath);
      const source = path.join(stageRoot, relativePath.replace(/\//g, path.sep));
      const changed = await service.writeAtomicIfChanged(root, target, fs.readFileSync(source));
      (changed ? changedFiles : unchangedFiles).push(relativePath);
    }
    const previous = metadata.previous || {};
    const preserve = Boolean(metadata.preservePreviousBuild && previous.contractHash === metadata.contractHash && previous.lastBuildSuccess);
    const manifestData = {
      schemaVersion: GENERATED_MANIFEST_VERSION,
      buildId,
      generatedAt: new Date().toISOString(),
      contractHash: metadata.contractHash || null,
      lastBuildSuccess: preserve,
      lastBuildAt: preserve ? previous.lastBuildAt || null : null,
      romPath: preserve ? previous.romPath || null : null,
      romSha256: preserve ? previous.romSha256 || null : null,
      objectFiles: preserve ? previous.objectFiles || [] : [],
      objectHashes: preserve ? previous.objectHashes || {} : {},
      files: hashes,
      fileStats: { changed: changedFiles.length, unchanged: unchangedFiles.length, changedFiles, unchangedFiles },
      report,
    };
    await writeGeneratedManifest(root, manifestData);
    return manifestData;
  } finally {
    const normalized = path.resolve(stageRoot);
    const expectedRoot = path.resolve(root, 'data', 'md-novel', '.staging') + path.sep;
    if (normalized.startsWith(expectedRoot)) fs.rmSync(normalized, { recursive: true, force: true });
  }
}

async function prepareProject(projectDir, context = {}, payload = {}) {
  const previous = await readGeneratedManifest(projectDir);
  const snapshot = await service.loadProject(projectDir);
  const errors = snapshot.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(`Novel project validation failed: ${errors[0].path || '-'}: ${errors[0].message}`);
  const validatedFont = await service.validateFontProject(projectDir, snapshot.sceneDocument, snapshot.targetProfile);
  snapshot.fontPlan = {
    entries: validatedFont.plan.entries.map((entry) => ({ character: entry.character, code: entry.code })),
    width: validatedFont.plan.width,
    height: validatedFont.plan.height,
    inputHash: validatedFont.plan.inputHash,
  };
  const generated = codegen.generateProject(snapshot);
  validateResSymbols(projectDir, generated.files['res/novel.res']);
  const staticFiles = collectStaticFiles();
  const files = { ...staticFiles, ...generated.files };
  const contractHash = buildContractHash(payload, staticFiles);
  const cache = await inspectBuildCache(projectDir, previous, contractHash);
  const manifestData = await commitGeneratedFiles(projectDir, files, generated.report, {
    previous,
    contractHash,
    preservePreviousBuild: cache.valid,
  });
  groupedWarnings(generated.warnings).forEach((warning) => context.logger?.warn?.(`MD Novel: ${warning}`));
  context.logger?.info?.(`MD Novel: ${generated.report.scenes} scene / ${generated.report.commands} command / sprite VRAM ${generated.report.budget.maxSpriteTiles} tiles / total ${generated.report.budget.maxBudget} tiles`);
  context.logger?.info?.(`MD Novel generated: changed ${manifestData.fileStats.changed}, unchanged ${manifestData.fileStats.unchanged}`);
  const requestedIncremental = Boolean(payload.skipClean);
  const skipClean = requestedIncremental && cache.valid;
  context.logger?.info?.(`MD Novel build cache: ${skipClean ? 'hit' : 'miss'} - ${requestedIncremental ? cache.reason : 'clean build requested'}`);
  if (skipClean && manifestData.fileStats.changed === 0) {
    context.logger?.info?.('MD Novel: input unchanged/object reused; make releaseで差分を確認します');
  } else if (skipClean) {
    context.logger?.info?.(`MD Novel: generated input changed (${manifestData.fileStats.changed} files); unchanged objects are reusable where make dependencies permit`);
  }
  return { snapshot, generated, manifestData, cache, skipClean };
}

async function onBuildStart(payload = {}, context = {}) {
  const projectDir = payload.projectDir || context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  try {
    const prepared = await prepareProject(projectDir, context, payload);
    return {
      ok: true,
      makeVariables: { SRC_C: SOURCE_FILES.join(' ') },
      report: prepared.generated.report,
      skipClean: prepared.skipClean,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function onBuildLog() {
  return { ok: true };
}
async function recordBuildState(projectDir, patch) {
  if (!projectDir) return null;
  const previous = await readGeneratedManifest(projectDir);
  if (!previous) return null;
  return writeGeneratedManifest(projectDir, {
    ...previous,
    ...patch,
    buildStateUpdatedAt: new Date().toISOString(),
  });
}


async function onBuildEnd(payload = {}, context = {}) {
  try {
    const projectDir = payload.projectDir || context.projectDir;
    const romPath = payload.romPath || payload.outputPath;
    if (!projectDir || !romPath || !fs.existsSync(romPath)) return { ok: true };
    const snapshot = await service.loadProject(projectDir);
    const bytes = fs.statSync(romPath).size;
    const target = snapshot.targetProfile.rom.targetBytes;
    const hardLimit = snapshot.targetProfile.rom.hardLimitBytes;
    const message = `MD Novel ROM: ${bytes} bytes (target ${target}, hard ${hardLimit})`;
    if (bytes > hardLimit) {
      await recordBuildState(projectDir, { lastBuildSuccess: false, lastBuildError: 'ROM hard limit exceeded' });
      return { ok: false, error: `${message}: hard limitを超えています` };
    }
    const relativeRom = path.relative(projectDir, path.resolve(romPath));
    if (!relativeRom || relativeRom.startsWith('..') || path.isAbsolute(relativeRom)) throw new Error('Build ROM path escapes project root');
    const objectFiles = collectObjectFiles(projectDir);
    const objectHashes = Object.fromEntries(objectFiles.map((relativePath) => [relativePath, fileHash(fs.readFileSync(path.join(projectDir, relativePath)))]));
    await recordBuildState(projectDir, {
      lastBuildSuccess: true,
      lastBuildError: null,
      lastBuildAt: new Date().toISOString(),
      romPath: relativeRom.replace(/\\/g, '/'),
      romSha256: fileHash(fs.readFileSync(romPath)),
      objectFiles,
      objectHashes,
    });
    if (bytes > target) context.logger?.warn?.(message); else context.logger?.info?.(message);
    return { ok: true, romBytes: bytes };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function onBuildError(payload = {}, context = {}) {
  context.logger?.error?.(`MD Novelビルドエラー: ${payload.error || 'unknown error'}`);
  const projectDir = payload.projectDir || context.projectDir;
  try {
    await recordBuildState(projectDir, { lastBuildSuccess: false, lastBuildError: String(payload.error || 'unknown error') });
  } catch (error) {
    context.logger?.warn?.(`MD Novel build cache update failed: ${error.message}`);
  }
  return { ok: true };
}

module.exports = {
  manifest,
  STATIC_FILES,
  SOURCE_FILES,
  resSymbols,
  collectOtherResSymbols,
  validateResSymbols,
  groupedWarnings,
  commitGeneratedFiles,
  prepareProject,
  onBuildStart,
  onBuildLog,
  onBuildEnd,
  onBuildError,
};
