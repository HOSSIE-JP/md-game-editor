'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.json');
const codegen = require('./codegen');
const service = require('../md-novel-editor/novel-service');

const STATIC_FILES = Object.freeze({
  'src/main.c': 'src/main.c',
  'src/novel_runtime/novel_runtime.c': 'src/novel_runtime/novel_runtime.c',
  'inc/novel_runtime/novel_runtime.h': 'inc/novel_runtime/novel_runtime.h',
  'src/boot/sega.s': 'src/boot/sega.s',
  'res/novel/font/misaki_gothic.png': 'res/novel/font/misaki_gothic.png',
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
  return Object.fromEntries(Object.entries(STATIC_FILES).map(([target, source]) => [target, fs.readFileSync(path.join(templateRoot(), source))]));
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

async function commitGeneratedFiles(projectDir, files, report) {
  const root = await service.ensureProjectRoot(projectDir);
  const buildId = `${Date.now()}-${crypto.randomUUID()}`;
  const stageRelative = `data/md-novel/.staging/${buildId}`;
  const stageRoot = await service.resolveProjectPath(root, stageRelative);
  fs.mkdirSync(stageRoot, { recursive: true });
  const hashes = {};
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
    for (const [relativePath] of Object.entries(files)) {
      const target = await service.resolveProjectPath(root, relativePath);
      const source = path.join(stageRoot, relativePath.replace(/\//g, path.sep));
      await service.writeAtomic(root, target, fs.readFileSync(source));
    }
    const manifestData = {
      schemaVersion: 1,
      buildId,
      generatedAt: new Date().toISOString(),
      files: hashes,
      report,
    };
    const manifestPath = await service.resolveProjectPath(root, 'data/md-novel/generated-manifest.json');
    await service.writeAtomic(root, manifestPath, Buffer.from(`${JSON.stringify(manifestData, null, 2)}\n`, 'utf8'));
    return manifestData;
  } finally {
    const normalized = path.resolve(stageRoot);
    const expectedRoot = path.resolve(root, 'data', 'md-novel', '.staging') + path.sep;
    if (normalized.startsWith(expectedRoot)) fs.rmSync(normalized, { recursive: true, force: true });
  }
}

async function prepareProject(projectDir, context = {}) {
  const snapshot = await service.loadProject(projectDir);
  const errors = snapshot.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(`Novel project validation failed: ${errors[0].path || '-'}: ${errors[0].message}`);
  const generated = codegen.generateProject(snapshot);
  validateResSymbols(projectDir, generated.files['res/novel.res']);
  const files = { ...collectStaticFiles(), ...generated.files };
  const manifestData = await commitGeneratedFiles(projectDir, files, generated.report);
  groupedWarnings(generated.warnings).forEach((warning) => context.logger?.warn?.(`MD Novel: ${warning}`));
  context.logger?.info?.(`MD Novel: ${generated.report.scenes} scene / ${generated.report.commands} command / sprite VRAM ${generated.report.budget.maxSpriteTiles} tiles / total ${generated.report.budget.maxBudget} tiles`);
  return { snapshot, generated, manifestData };
}

async function onBuildStart(payload = {}, context = {}) {
  const projectDir = payload.projectDir || context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  try {
    const prepared = await prepareProject(projectDir, context);
    return {
      ok: true,
      makeVariables: { SRC_C: SOURCE_FILES.join(' ') },
      report: prepared.generated.report,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function onBuildLog() {
  return { ok: true };
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
    if (bytes > hardLimit) return { ok: false, error: `${message}: hard limitを超えています` };
    if (bytes > target) context.logger?.warn?.(message); else context.logger?.info?.(message);
    return { ok: true, romBytes: bytes };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function onBuildError(payload = {}, context = {}) {
  context.logger?.error?.(`MD Novelビルドエラー: ${payload.error || 'unknown error'}`);
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
