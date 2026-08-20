'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  SCHEMA_VERSION,
  deepClone,
  hashDocument,
  collectCatalog,
  collectReferences,
  validateSceneDocument,
  defaultTargetProfile,
  createAssetBindings,
} = require('./novel-schema');
const {
  hashBuffer,
  convertVisualGroup,
  generatePsgSongVgm,
  generatePsgSfxWav,
} = require('./novel-convert');
const { analyzeNovelBudget } = require('./novel-budget');

const fsp = fs.promises;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const RELATIVE_PATHS = Object.freeze({
  scene: 'assets/pce-vn-scenes.json',
  catalog: 'assets/pce-assets.json',
  pceFont: 'assets/pce-font.json',
  profile: 'data/md-novel/target-profile.json',
  bindings: 'data/md-novel/asset-bindings.json',
  transaction: 'data/md-novel/transaction.json',
});

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelative(value) {
  const source = String(value || '').replace(/\\/g, '/');
  if (!source || path.isAbsolute(source) || /^[a-z]:/i.test(source)) throw new Error(`Unsafe project path: ${value}`);
  const parts = source.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe project path: ${value}`);
  return parts.join(path.sep);
}

async function assertSafePath(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  if (!isInside(rootPath, targetPath)) throw new Error(`Path escapes project root: ${targetPath}`);
  const rootStat = await fsp.lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Unsafe project root: ${rootPath}`);
  const realRoot = await fsp.realpath(rootPath);
  const relative = path.relative(rootPath, targetPath);
  let current = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link or junction is not allowed: ${current}`);
    const realCurrent = await fsp.realpath(current);
    if (!isInside(realRoot, realCurrent)) throw new Error(`Resolved path escapes project root: ${current}`);
  }
  return targetPath;
}

async function ensureProjectRoot(projectDir) {
  const root = path.resolve(String(projectDir || ''));
  if (!projectDir) throw new Error('projectDir is required');
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  await assertSafePath(root, root);
  return root;
}

async function resolveProjectPath(projectDir, relativePath, options = {}) {
  const root = await ensureProjectRoot(projectDir);
  const target = path.join(root, normalizeRelative(relativePath));
  await assertSafePath(root, target);
  if (options.mustExist) {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) throw new Error(`Expected file: ${relativePath}`);
  }
  return target;
}

async function resolveSourcePath(sourceProjectDir, relativePath, options = {}) {
  const root = await ensureProjectRoot(sourceProjectDir);
  const target = path.join(root, normalizeRelative(relativePath));
  await assertSafePath(root, target);
  const stat = await fsp.stat(target);
  if (options.directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Invalid source path: ${relativePath}`);
  return target;
}

function assertSafeJson(value, location = '$', depth = 0) {
  if (depth > 64) throw new Error(`JSON nesting exceeds limit at ${location}`);
  if (typeof value === 'string' && value.length > 1048576) throw new Error(`JSON string exceeds limit at ${location}`);
  if (Array.isArray(value)) {
    if (value.length > 200000) throw new Error(`JSON array exceeds limit at ${location}`);
    value.forEach((item, index) => assertSafeJson(item, `${location}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(`Unsafe JSON key at ${location}.${key}`);
    assertSafeJson(value[key], `${location}.${key}`, depth + 1);
  }
}

async function readJsonFile(filePath, options = {}) {
  const stat = await fsp.stat(filePath);
  const limit = options.maxBytes || MAX_JSON_BYTES;
  if (stat.size > limit) throw new Error(`JSON file is too large: ${filePath}`);
  const text = await fsp.readFile(filePath, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
  assertSafeJson(value);
  return value;
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function recoverAtomicTarget(target) {
  const backup = `${target}.novel-bak`;
  const temp = `${target}.novel-tmp`;
  const targetExists = await exists(target);
  const backupExists = await exists(backup);
  if (!targetExists && backupExists) await fsp.rename(backup, target);
  if (await exists(temp)) await fsp.unlink(temp);
  if (await exists(target) && await exists(backup)) await fsp.unlink(backup);
}

async function writeAtomic(projectRoot, target, data) {
  await assertSafePath(projectRoot, target);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await assertSafePath(projectRoot, path.dirname(target));
  await recoverAtomicTarget(target);
  const temp = `${target}.novel-tmp`;
  const backup = `${target}.novel-bak`;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let handle;
  try {
    handle = await fsp.open(temp, 'wx');
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertSafePath(projectRoot, target);
    if (await exists(target)) await fsp.rename(target, backup);
    await fsp.rename(temp, target);
    if (await exists(backup)) await fsp.unlink(backup);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (await exists(temp)) await fsp.unlink(temp).catch(() => {});
    if (!await exists(target) && await exists(backup)) await fsp.rename(backup, target).catch(() => {});
    throw error;
  }
}

async function commitDocuments(projectDir, documents, metadata = {}) {
  const root = await ensureProjectRoot(projectDir);
  let previousDocuments = {};
  try {
    const previous = await readOptionalJson(root, RELATIVE_PATHS.transaction);
    if (previous?.documents && typeof previous.documents === 'object') previousDocuments = previous.documents;
  } catch (_error) {
    previousDocuments = {};
  }
  const prepared = [];
  for (const [relativePath, value] of Object.entries(documents)) {
    if (relativePath === RELATIVE_PATHS.transaction) continue;
    const data = Buffer.isBuffer(value) ? value : jsonBuffer(value);
    prepared.push({ relativePath: relativePath.replace(/\\/g, '/'), data, hash: hashBuffer(data) });
  }
  prepared.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (const entry of prepared) {
    const target = await resolveProjectPath(root, entry.relativePath);
    await writeAtomic(root, target, entry.data);
  }
  const transaction = {
    schemaVersion: SCHEMA_VERSION,
    transactionId: crypto.randomUUID(),
    committedAt: new Date().toISOString(),
    sourceSceneRevision: metadata.sourceSceneRevision || null,
    documents: {
      ...previousDocuments,
      ...Object.fromEntries(prepared.map((entry) => [entry.relativePath, entry.hash])),
    },
  };
  const target = await resolveProjectPath(root, RELATIVE_PATHS.transaction);
  await writeAtomic(root, target, jsonBuffer(transaction));
  return transaction;
}

async function readOptionalJson(projectDir, relativePath) {
  const target = await resolveProjectPath(projectDir, relativePath);
  if (!await exists(target)) return null;
  await recoverAtomicTarget(target);
  return readJsonFile(target);
}

async function validateTransaction(projectDir, transaction) {
  if (!transaction) return [{ severity: 'warning', code: 'transaction-missing', path: RELATIVE_PATHS.transaction, message: 'Novel transaction manifest is missing.' }];
  const diagnostics = [];
  for (const [relativePath, expected] of Object.entries(transaction.documents || {})) {
    try {
      const target = await resolveProjectPath(projectDir, relativePath, { mustExist: true });
      const actual = hashBuffer(await fsp.readFile(target));
      if (actual !== expected) diagnostics.push({ severity: 'error', code: 'transaction-hash-mismatch', path: relativePath, message: `Committed document hash mismatch: ${relativePath}` });
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'transaction-file-missing', path: relativePath, message: error.message });
    }
  }
  return diagnostics;
}

function validateProfile(profile) {
  const diagnostics = [];
  if (!profile || typeof profile !== 'object') return [{ severity: 'error', code: 'profile-missing', path: RELATIVE_PATHS.profile, message: 'Mega Drive target profile is missing.' }];
  if (profile.schemaVersion !== SCHEMA_VERSION) diagnostics.push({ severity: 'error', code: 'profile-version', path: 'schemaVersion', message: `Unsupported target profile version: ${profile.schemaVersion}` });
  if (profile.target !== 'mega-drive') diagnostics.push({ severity: 'error', code: 'profile-target', path: 'target', message: 'Target profile must select mega-drive.' });
  if (!['pce-legacy-256', 'md-h40'].includes(profile.coordinateMode)) diagnostics.push({ severity: 'error', code: 'coordinate-mode', path: 'coordinateMode', message: 'Unknown coordinate mode.' });
  return diagnostics;
}

function validateBindings(sceneDocument, catalog, bindings) {
  const diagnostics = [];
  if (!bindings || typeof bindings !== 'object') return [{ severity: 'error', code: 'bindings-missing', path: RELATIVE_PATHS.bindings, message: 'Mega Drive asset bindings are missing.' }];
  const sceneRevision = hashDocument(sceneDocument);
  if (bindings.sourceSceneRevision !== sceneRevision) diagnostics.push({ severity: 'error', code: 'bindings-stale', path: 'sourceSceneRevision', message: 'Asset bindings do not match the scene document revision.' });
  const info = collectCatalog(catalog);
  const references = collectReferences(sceneDocument);
  for (const reference of references) {
    const asset = info.byId.get(reference.assetId);
    if (!asset || ['adpcm', 'cdda-track'].includes(asset.type)) continue;
    if (['image', 'sprite'].includes(asset.type)) {
      const binding = bindings.assets?.[reference.assetId];
      if (!binding?.sourcePath || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) diagnostics.push({ severity: 'error', code: 'binding-missing', path: reference.path, message: `Missing visual binding: ${reference.assetId}` });
    }
    if (['psg-song', 'psg-sfx'].includes(asset.type)) {
      const key = `${reference.assetId}@${reference.channel}`;
      const variant = bindings.audioVariants?.[key];
      if (!variant?.sourcePath || variant.status !== 'ready') diagnostics.push({ severity: 'error', code: 'audio-variant-missing', path: reference.path, message: `Missing converted PSG variant: ${key}` });
    }
  }
  const symbols = new Map();
  for (const entry of [...Object.values(bindings.assets || {}), ...Object.values(bindings.audioVariants || {})]) {
    if (!entry?.symbol) continue;
    const key = String(entry.symbol).toLowerCase();
    if (symbols.has(key) && symbols.get(key) !== entry.assetId) diagnostics.push({ severity: 'error', code: 'symbol-duplicate', path: 'bindings', message: `Duplicate ResComp symbol: ${entry.symbol}` });
    symbols.set(key, entry.assetId);
  }
  return diagnostics;
}

async function readProjectDocuments(projectDir) {
  const scenePath = await resolveProjectPath(projectDir, RELATIVE_PATHS.scene, { mustExist: true });
  const catalogPath = await resolveProjectPath(projectDir, RELATIVE_PATHS.catalog, { mustExist: true });
  const [sceneDocument, catalog, pceFont, targetProfile, bindings, transaction] = await Promise.all([
    readJsonFile(scenePath),
    readJsonFile(catalogPath),
    readOptionalJson(projectDir, RELATIVE_PATHS.pceFont),
    readOptionalJson(projectDir, RELATIVE_PATHS.profile),
    readOptionalJson(projectDir, RELATIVE_PATHS.bindings),
    readOptionalJson(projectDir, RELATIVE_PATHS.transaction),
  ]);
  return { sceneDocument, catalog, pceFont, targetProfile, bindings, transaction };
}

async function loadProject(projectDir) {
  const documents = await readProjectDocuments(projectDir);
  const validation = validateSceneDocument(documents.sceneDocument, documents.catalog, { includeDocuments: false });
  const budget = analyzeNovelBudget(documents.sceneDocument, documents.bindings);
  const diagnostics = [
    ...validation.diagnostics,
    ...validateProfile(documents.targetProfile),
    ...validateBindings(documents.sceneDocument, documents.catalog, documents.bindings),
    ...await validateTransaction(projectDir, documents.transaction),
    ...budget.diagnostics,
  ];
  return {
    ok: !diagnostics.some((entry) => entry.severity === 'error'),
    ...deepClone(documents),
    diagnostics,
    budget,
    revisions: {
      scene: hashDocument(documents.sceneDocument),
      catalog: hashDocument(documents.catalog),
      pceFont: hashDocument(documents.pceFont),
      profile: hashDocument(documents.targetProfile),
      bindings: hashDocument(documents.bindings),
    },
  };
}

async function saveProject(projectDir, payload = {}) {
  const current = await loadProject(projectDir);
  const currentTransactionErrors = current.diagnostics.filter((entry) => entry.code?.startsWith('transaction-') && entry.severity === 'error');
  if (currentTransactionErrors.length) throw new Error(`Cannot save an inconsistent Novel transaction: ${currentTransactionErrors[0].message}`);
  for (const key of ['scene', 'profile', 'bindings']) {
    const expected = payload.baseRevisions?.[key];
    if (expected && expected !== current.revisions[key]) throw new Error(`Stale ${key} document; reload before saving.`);
  }
  const sceneDocument = deepClone(payload.sceneDocument ?? current.sceneDocument);
  const targetProfile = deepClone(payload.targetProfile ?? current.targetProfile);
  const bindings = deepClone(payload.bindings ?? current.bindings);
  assertSafeJson(sceneDocument);
  assertSafeJson(targetProfile);
  assertSafeJson(bindings);
  bindings.sourceSceneRevision = hashDocument(sceneDocument);
  const validation = validateSceneDocument(sceneDocument, current.catalog);
  const diagnostics = [...validation.diagnostics, ...validateProfile(targetProfile), ...validateBindings(sceneDocument, current.catalog, bindings)];
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(`Novel save validation failed: ${errors[0].message}`);
  await commitDocuments(projectDir, {
    [RELATIVE_PATHS.scene]: sceneDocument,
    [RELATIVE_PATHS.profile]: targetProfile,
    [RELATIVE_PATHS.bindings]: bindings,
  }, { sourceSceneRevision: bindings.sourceSceneRevision });
  return loadProject(projectDir);
}

function sourceProjectId(projectConfig, sourceRoot) {
  const explicit = projectConfig.id || projectConfig.uuid || projectConfig.serial || projectConfig.romName || projectConfig.title;
  if (explicit) return String(explicit);
  return crypto.createHash('sha256').update(path.resolve(sourceRoot).toLowerCase(), 'utf8').digest('hex').slice(0, 24);
}

async function importPceProject(projectDir, payload = {}, context = {}) {
  const sourceRoot = await ensureProjectRoot(payload.sourceProjectDir);
  const sceneDocument = await readJsonFile(await resolveSourcePath(sourceRoot, RELATIVE_PATHS.scene));
  const catalog = await readJsonFile(await resolveSourcePath(sourceRoot, RELATIVE_PATHS.catalog));
  const projectConfig = await readJsonFile(await resolveSourcePath(sourceRoot, 'project.json'));
  const pceFontPath = path.join(sourceRoot, RELATIVE_PATHS.pceFont.replace(/\//g, path.sep));
  const pceFont = await exists(pceFontPath) ? await readJsonFile(pceFontPath) : null;
  const validation = validateSceneDocument(sceneDocument, catalog);
  const hardErrors = validation.diagnostics.filter((entry) => entry.severity === 'error');
  if (hardErrors.length) throw new Error(`PCE novel import failed: ${hardErrors[0].message}`);
  const importedAt = new Date().toISOString();
  const sceneRevision = hashDocument(sceneDocument);
  const targetProfile = defaultTargetProfile({
    coordinateMode: 'pce-legacy-256',
    sourceProjectDir: sourceRoot,
    sourceProjectId: sourceProjectId(projectConfig, sourceRoot),
    importedAt,
  });
  const bindings = createAssetBindings(sceneDocument, catalog, {
    sceneRevision,
    coordinateMode: targetProfile.coordinateMode,
    portraitPaletteGroups: payload.portraitPaletteGroups,
  });
  const catalogInfo = collectCatalog(catalog);
  const documents = {
    [RELATIVE_PATHS.scene]: sceneDocument,
    [RELATIVE_PATHS.catalog]: catalog,
    [RELATIVE_PATHS.profile]: targetProfile,
    [RELATIVE_PATHS.bindings]: bindings,
  };
  if (pceFont) documents[RELATIVE_PATHS.pceFont] = pceFont;
  const visualEntries = [];
  for (const binding of Object.values(bindings.assets)) {
    if (!['IMAGE', 'SPRITE'].includes(binding.runtimeType)) continue;
    const asset = catalogInfo.byId.get(binding.assetId);
    const sourcePath = await resolveSourcePath(sourceRoot, asset.source);
    const buffer = await fsp.readFile(sourcePath);
    documents[String(asset.source).replace(/\\/g, '/')] = buffer;
    visualEntries.push({ asset, binding, buffer });
  }
  const backgrounds = visualEntries.filter((entry) => entry.asset.type === 'image');
  for (const entry of backgrounds) {
    const output = convertVisualGroup([entry], { reserveTransparent: false }).get(entry.asset.id);
    entry.binding.metadata = output.metadata;
    entry.binding.contentHash = output.contentHash;
    documents[`res/${entry.binding.sourcePath}`] = output.png;
  }
  for (const paletteName of ['PAL2', 'PAL3']) {
    const group = visualEntries.filter((entry) => entry.asset.type === 'sprite' && entry.binding.palette === paletteName);
    if (!group.length) continue;
    const outputs = convertVisualGroup(group, { reserveTransparent: true });
    for (const entry of group) {
      const output = outputs.get(entry.asset.id);
      entry.binding.metadata = output.metadata;
      entry.binding.contentHash = output.contentHash;
      entry.binding.paletteFingerprint = hashDocument(output.palette);
      documents[`res/${entry.binding.sourcePath}`] = output.png;
    }
  }
  for (const variant of Object.values(bindings.audioVariants)) {
    const asset = catalogInfo.byId.get(variant.assetId);
    if (!Array.isArray(asset?.options?.pattern) || !asset.options.pattern.length) throw new Error(`Referenced PSG asset has no inline pattern: ${variant.assetId}`);
    const output = asset.type === 'psg-song'
      ? generatePsgSongVgm(asset, variant.channel)
      : generatePsgSfxWav(asset, variant.channel, targetProfile.audio.sfxRate);
    variant.status = 'ready';
    variant.contentHash = hashBuffer(output);
    variant.metadata = { byteLength: output.length, lossyConversion: true, baseChannel: variant.channel };
    documents[`res/${variant.sourcePath}`] = output;
    if (asset.source) {
      const provenance = await resolveSourcePath(sourceRoot, asset.source);
      documents[String(asset.source).replace(/\\/g, '/')] = await fsp.readFile(provenance);
    }
  }
  if (pceFont) {
    const fontSources = new Set([pceFont.fontPath, ...(pceFont.fonts || []).map((entry) => entry.file)].filter(Boolean));
    for (const relativePath of fontSources) {
      try {
        const source = await resolveSourcePath(sourceRoot, relativePath);
        documents[String(relativePath).replace(/\\/g, '/')] = await fsp.readFile(source);
      } catch (error) {
        context.logger?.warn?.(`Novel font provenance was not copied: ${error.message}`);
      }
    }
  }
  documents[RELATIVE_PATHS.bindings] = bindings;
  await commitDocuments(projectDir, documents, { sourceSceneRevision: sceneRevision });
  const result = await loadProject(projectDir);
  result.importReport = {
    sourceProjectDir: sourceRoot,
    sourceSceneRevision: sceneRevision,
    visualAssets: visualEntries.length,
    audioVariants: Object.keys(bindings.audioVariants).length,
    ignoredAudioReferences: validation.diagnostics.filter((entry) => ['audio-ignored', 'voice-ignored'].includes(entry.code)).length,
  };
  return result;
}

module.exports = {
  MAX_JSON_BYTES,
  RELATIVE_PATHS,
  isInside,
  normalizeRelative,
  assertSafePath,
  ensureProjectRoot,
  resolveProjectPath,
  resolveSourcePath,
  assertSafeJson,
  readJsonFile,
  recoverAtomicTarget,
  writeAtomic,
  commitDocuments,
  validateTransaction,
  validateProfile,
  validateBindings,
  readProjectDocuments,
  loadProject,
  saveProject,
  importPceProject,
};
