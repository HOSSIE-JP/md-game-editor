'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  SCHEMA_VERSION,
  TARGET_PROFILE_SCHEMA_VERSION,
  VISUAL_CONVERTER_VERSION,
  deepClone,
  hashDocument,
  collectCatalog,
  collectReferences,
  validateSceneDocument,
  defaultTargetProfile,
  migrateTargetProfile,
  createAssetBindings,
  collectVisualPaletteRequirements,
  paletteProfile,
  compatiblePaletteProfile,
  paletteProfileSatisfies,
  resolveCommandPalette,
} = require('./novel-schema');
const {
  hashBuffer,
  convertVisualGroup,
  generatePsgSongVgm,
  generatePsgSfxWav,
} = require('./novel-convert');
const { decodePng } = require('./novel-image');
const { analyzeNovelBudget } = require('./novel-budget');
const {
  FONT_OUTPUT_PATH,
  BUNDLED_FONT_SOURCE,
  BUNDLED_FONT_ATLAS_SOURCE,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_THRESHOLD,
  normalizeFontSettings,
  createFontPlan,
  generateBundledAtlas,
  canonicalizeGeneratedAtlas,
  generationMetadata,
  validateGeneration,
  validateProjectFontCoverage,
} = require('./novel-font');

const fsp = fs.promises;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_FONT_BYTES = 32 * 1024 * 1024;
const FONT_EXTENSION = /\.(?:ttf|otf|ttc)$/i;
const BUNDLED_FONT_ROOT = path.join(__dirname, '..', 'md-novel-builder', 'template', 'res', 'novel', 'font');
const BUNDLED_FONT_PATH = path.join(BUNDLED_FONT_ROOT, path.basename(BUNDLED_FONT_SOURCE));
const BUNDLED_FONT_ATLAS_PATH = path.join(BUNDLED_FONT_ROOT, path.basename(BUNDLED_FONT_ATLAS_SOURCE));
const BUNDLED_FONT_AUXILIARY = Object.freeze([
  'JF-Dot-Shinonome16-README.txt',
  'JF-Dot-Shinonome16-LICENSE',
]);
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

async function writeAtomicIfChanged(projectRoot, target, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (await exists(target)) {
    const current = await fsp.readFile(target);
    if (current.length === payload.length && current.equals(payload)) return false;
  }
  await writeAtomic(projectRoot, target, payload);
  return true;
}

async function commitDocuments(projectDir, documents, metadata = {}) {
  const root = await ensureProjectRoot(projectDir);
  let previousDocuments = {};
  let previousSourceSceneRevision = null;
  try {
    const previous = await readOptionalJson(root, RELATIVE_PATHS.transaction);
    if (previous?.documents && typeof previous.documents === 'object') previousDocuments = previous.documents;
    previousSourceSceneRevision = previous?.sourceSceneRevision || null;
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
    await writeAtomicIfChanged(root, target, entry.data);
  }
  const transaction = {
    schemaVersion: SCHEMA_VERSION,
    transactionId: crypto.randomUUID(),
    committedAt: new Date().toISOString(),
    sourceSceneRevision: metadata.sourceSceneRevision ?? previousSourceSceneRevision,
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
  if (profile.schemaVersion !== TARGET_PROFILE_SCHEMA_VERSION) diagnostics.push({ severity: 'error', code: 'profile-version', path: 'schemaVersion', message: `Unsupported target profile version: ${profile.schemaVersion}` });
  if (profile.target !== 'mega-drive') diagnostics.push({ severity: 'error', code: 'profile-target', path: 'target', message: 'Target profile must select mega-drive.' });
  if (!['pce-legacy-256', 'md-h40'].includes(profile.coordinateMode)) diagnostics.push({ severity: 'error', code: 'coordinate-mode', path: 'coordinateMode', message: 'Unknown coordinate mode.' });
  if (profile.video?.messagePlane !== 'SPRITE') diagnostics.push({ severity: 'error', code: 'message-plane', path: 'video.messagePlane', message: 'Message plane must use hardware sprites.' });
  if (profile.window?.renderer !== 'shadow-highlight-sprite-2x2') diagnostics.push({ severity: 'error', code: 'message-renderer', path: 'window.renderer', message: 'Message renderer must use shadow-highlight-sprite-2x2.' });
  if (Object.prototype.hasOwnProperty.call(profile.window || {}, 'opaque')) diagnostics.push({ severity: 'error', code: 'opaque-window-removed', path: 'window.opaque', message: 'Opaque WINDOW rendering was removed; save the project to migrate it.' });
  return diagnostics;
}

const DEFAULT_PCE_PALETTE_ASSIGNMENTS = Object.freeze({
  background: 'PAL0',
  slots: Object.freeze(['PAL1', 'PAL2', 'PAL3', 'PAL3']),
});

function normalizePcePaletteAssignments(value = {}) {
  const palettes = new Set(['PAL0', 'PAL1', 'PAL2', 'PAL3']);
  const background = value.background ?? DEFAULT_PCE_PALETTE_ASSIGNMENTS.background;
  const sourceSlots = Array.isArray(value.slots) ? value.slots : [];
  const slots = DEFAULT_PCE_PALETTE_ASSIGNMENTS.slots.map((fallback, index) => sourceSlots[index] ?? fallback);
  if (!palettes.has(background) || slots.some((palette) => !palettes.has(palette))) {
    throw new Error('PCE palette assignments must use PAL0, PAL1, PAL2, or PAL3');
  }
  return { background, slots };
}

function pcePaletteForCommand(command, paletteAssignments = DEFAULT_PCE_PALETTE_ASSIGNMENTS) {
  if (command?.type === 'background') return paletteAssignments.background;
  if (command?.type === 'sprite') {
    const slot = Math.max(0, Math.min(3, Number(command.slot) || 0));
    return paletteAssignments.slots[slot];
  }
  return '';
}

function injectPcePalettes(sceneDocument, value = {}) {
  const paletteAssignments = normalizePcePaletteAssignments(value);
  const result = deepClone(sceneDocument);
  for (const scene of result?.scenes || []) {
    for (const command of scene?.commands || []) {
      const palette = pcePaletteForCommand(command, paletteAssignments);
      if (palette) command.palette = palette;
    }
  }
  return result;
}

function visualProfileRequirements(sceneDocument, bindings) {
  const requirements = collectVisualPaletteRequirements(sceneDocument, bindings);
  const result = new Map();
  for (const [assetId, entry] of requirements) {
    result.set(assetId, {
      ...entry,
      palettes: Array.from(entry.palettes),
      profiles: Array.from(entry.profiles),
    });
  }
  return result;
}

function paletteGroups(bindings) {
  const groups = [];
  for (const [id, value] of Object.entries(bindings?.paletteGroups || {})) {
    if (!value || Array.isArray(value) || typeof value !== 'object') continue;
    groups.push({ id, ...value, members: [...new Set((value.members || []).map(String).filter(Boolean))] });
  }
  return groups;
}

function validateBindings(sceneDocument, catalog, bindings) {
  const diagnostics = [];
  if (!bindings || typeof bindings !== 'object') return [{ severity: 'error', code: 'bindings-missing', path: RELATIVE_PATHS.bindings, message: 'Mega Drive asset bindings are missing.' }];
  const sceneRevision = hashDocument(sceneDocument);
  if (bindings.sourceSceneRevision !== sceneRevision) diagnostics.push({ severity: 'error', code: 'bindings-stale', path: 'sourceSceneRevision', message: 'Asset bindings do not match the scene document revision.' });
  const info = collectCatalog(catalog);
  const references = collectReferences(sceneDocument);
  const requirements = visualProfileRequirements(sceneDocument, bindings);
  for (const reference of references) {
    const asset = info.byId.get(reference.assetId);
    if (!asset || ['adpcm', 'cdda-track'].includes(asset.type)) continue;
    if (['image', 'sprite'].includes(asset.type)) {
      const binding = bindings.assets?.[reference.assetId];
      if (!binding?.sourcePath || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) diagnostics.push({ severity: 'error', code: 'binding-missing', path: reference.path, message: 'Missing visual binding: ' + reference.assetId });
    }
    if (['psg-song', 'psg-sfx'].includes(asset.type)) {
      const key = reference.assetId + '@' + reference.channel;
      const variant = bindings.audioVariants?.[key];
      if (!variant?.sourcePath || variant.status !== 'ready') diagnostics.push({ severity: 'error', code: 'audio-variant-missing', path: reference.path, message: 'Missing converted PSG variant: ' + key });
    }
  }

  for (const [assetId, requirement] of requirements) {
    const binding = bindings.assets?.[assetId];
    if (!binding) continue;
    const expected = compatiblePaletteProfile(requirement.profiles);
    if (!expected) {
      diagnostics.push({
        severity: 'error',
        code: 'asset-palette-profile-conflict',
        path: 'bindings.assets.' + assetId,
        message: assetId + ' is used by incompatible palette conversion profiles; duplicate the source asset before assigning both profiles.',
        assetId,
        references: requirement.references,
      });
      continue;
    }
    const actual = binding.conversion?.paletteProfile || paletteProfile(binding.legacyPalette || binding.palette, { sprite: binding.runtimeType === 'SPRITE' });
    if (!paletteProfileSatisfies(actual, expected)) diagnostics.push({
      severity: 'error',
      code: 'visual-conversion-stale',
      path: 'bindings.assets.' + assetId + '.conversion.paletteProfile',
      message: assetId + ' requires ' + expected + ' conversion but has ' + actual + '. Save the editor project to reconvert it.',
      assetId,
      expectedProfile: expected,
      actualProfile: actual,
    });
    if (!binding.paletteFingerprint || !Array.isArray(binding.paletteRgb333) || binding.paletteRgb333.length !== 16) {
      diagnostics.push({ severity: 'error', code: 'visual-palette-metadata-missing', path: 'bindings.assets.' + assetId, message: 'Converted palette metadata is missing: ' + assetId });
    }
    const quality = binding.metadata?.quality || {};
    if (Number(quality.meanDeltaE) > 8 || Number(quality.p95DeltaE) > 20) {
      diagnostics.push({
        severity: 'warning',
        code: 'palette-quality-loss',
        path: 'bindings.assets.' + assetId + '.metadata.quality',
        message: assetId + ' palette conversion quality is low (mean ΔE ' + Number(quality.meanDeltaE || 0).toFixed(2) + ', p95 ' + Number(quality.p95DeltaE || 0).toFixed(2) + ').',
      });
    }
  }

  const groupIds = new Set();
  for (const group of paletteGroups(bindings)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(group.id)) diagnostics.push({ severity: 'error', code: 'palette-group-id-invalid', path: 'paletteGroups.' + group.id, message: 'Invalid palette group id: ' + group.id });
    if (groupIds.has(group.id)) diagnostics.push({ severity: 'error', code: 'palette-group-duplicate', path: 'paletteGroups.' + group.id, message: 'Duplicate palette group: ' + group.id });
    groupIds.add(group.id);
    const profiles = new Set();
    const fingerprints = new Set();
    for (const assetId of group.members) {
      const binding = bindings.assets?.[assetId];
      if (!binding || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) {
        diagnostics.push({ severity: 'error', code: 'palette-group-member-missing', path: 'paletteGroups.' + group.id, message: 'Palette group member is missing: ' + assetId });
        continue;
      }
      if (binding.paletteGroup !== group.id) diagnostics.push({ severity: 'error', code: 'palette-group-backref', path: 'bindings.assets.' + assetId + '.paletteGroup', message: assetId + ' does not reference palette group ' + group.id });
      profiles.add(binding.conversion?.paletteProfile || paletteProfile(binding.legacyPalette || binding.palette, { sprite: binding.runtimeType === 'SPRITE' }));
      if (binding.paletteFingerprint) fingerprints.add(binding.paletteFingerprint);
    }
    if (profiles.size && !compatiblePaletteProfile(profiles)) diagnostics.push({ severity: 'error', code: 'palette-group-profile-conflict', path: 'paletteGroups.' + group.id, message: 'Incompatible conversion profiles cannot share palette group ' + group.id });
    if (fingerprints.size > 1 || (group.paletteFingerprint && fingerprints.size && !fingerprints.has(group.paletteFingerprint))) diagnostics.push({ severity: 'error', code: 'palette-group-fingerprint-conflict', path: 'paletteGroups.' + group.id, message: 'Palette group members were not converted with one ordered palette: ' + group.id });
  }
  for (const binding of Object.values(bindings.assets || {})) {
    if (binding?.paletteGroup && !groupIds.has(binding.paletteGroup)) diagnostics.push({ severity: 'error', code: 'palette-group-missing', path: 'bindings.assets.' + binding.assetId + '.paletteGroup', message: 'Palette group does not exist: ' + binding.paletteGroup });
  }

  const symbols = new Map();
  for (const entry of [...Object.values(bindings.assets || {}), ...Object.values(bindings.audioVariants || {})]) {
    if (!entry?.symbol) continue;
    const key = String(entry.symbol).toLowerCase();
    if (symbols.has(key) && symbols.get(key) !== entry.assetId) diagnostics.push({ severity: 'error', code: 'symbol-duplicate', path: 'bindings', message: 'Duplicate ResComp symbol: ' + entry.symbol });
    symbols.set(key, entry.assetId);
  }
  return diagnostics;
}
function validateFontSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error('Font file is empty or truncated');
  const tag = buffer.subarray(0, 4).toString('ascii');
  const scalar = buffer.readUInt32BE(0);
  const valid = extension === '.ttc'
    ? tag === 'ttcf'
    : extension === '.otf'
      ? tag === 'OTTO'
      : scalar === 0x00010000 || tag === 'true' || tag === 'typ1';
  if (!valid) throw new Error(`Font file signature does not match ${extension}`);
}

async function readFontSource(projectDir, profileFont) {
  const font = normalizeFontSettings(profileFont);
  if (font.kind === 'bundled') {
    const buffer = await fsp.readFile(BUNDLED_FONT_PATH);
    validateFontSignature(buffer, '.ttf');
    return { font, buffer, relativePath: `res/novel/${BUNDLED_FONT_SOURCE}` };
  }
  if (!/^assets\/fonts\/[A-Za-z0-9._-]+\.(?:ttf|otf|ttc)$/i.test(font.source)) {
    throw new Error(`Unsafe project font path: ${font.source}`);
  }
  const target = await resolveProjectPath(projectDir, font.source, { mustExist: true });
  const stat = await fsp.stat(target);
  if (stat.size > MAX_FONT_BYTES) throw new Error('Font file is too large');
  const buffer = await fsp.readFile(target);
  validateFontSignature(buffer, path.extname(target).toLowerCase());
  return { font, buffer, relativePath: font.source };
}

async function buildFontPlan(projectDir, sceneDocument, targetProfile) {
  assertSafeJson(sceneDocument);
  assertSafeJson(targetProfile);
  const source = await readFontSource(projectDir, targetProfile?.font);
  const plan = {
    ...createFontPlan(sceneDocument, source.font, source.buffer),
    sourceBuffer: source.buffer,
    sourceRelativePath: source.relativePath,
  };
  if (source.font.kind === 'project') validateProjectFontCoverage(source.buffer, plan.entries);
  return plan;
}

function publicFontPlan(plan, currentValid = false, validationError = '') {
  return {
    font: deepClone(plan.font),
    entries: plan.entries.map((entry) => ({ character: entry.character, code: entry.code, bytes: entry.bytes })),
    previewEntries: plan.previewEntries.map((entry) => ({ character: entry.character, code: entry.code, bytes: entry.bytes })),
    width: plan.width,
    height: plan.height,
    sourceHash: plan.sourceHash,
    inputHash: plan.inputHash,
    outputPath: plan.outputPath,
    sourceRelativePath: plan.sourceRelativePath,
    currentValid,
    validationError,
  };
}

function fontBufferFromDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || match[1].length > 48 * 1024 * 1024) throw new Error('Generated font PNG data is invalid or too large');
  return Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
}

async function provisionBundledFontPreviewFiles(projectDir, plan) {
  if (plan.font.kind !== 'bundled') return;
  const root = await ensureProjectRoot(projectDir);
  const files = {
    [plan.sourceRelativePath]: plan.sourceBuffer,
  };
  for (const fileName of BUNDLED_FONT_AUXILIARY) {
    files[`res/novel/font/${fileName}`] = await fsp.readFile(path.join(BUNDLED_FONT_ROOT, fileName));
  }
  for (const [relativePath, buffer] of Object.entries(files)) {
    const target = await resolveProjectPath(root, relativePath);
    await writeAtomicIfChanged(root, target, buffer);
  }
}

async function prepareFontGeneration(projectDir, payload = {}) {
  const current = await readProjectDocuments(projectDir);
  const sceneDocument = deepClone(payload.sceneDocument ?? current.sceneDocument);
  const targetProfile = deepClone(payload.targetProfile ?? current.targetProfile);
  targetProfile.font = normalizeFontSettings(targetProfile.font);
  const plan = await buildFontPlan(projectDir, sceneDocument, targetProfile);
  await provisionBundledFontPreviewFiles(projectDir, plan);
  let currentValid = false;
  let validationError = '';
  try {
    const output = await resolveProjectPath(projectDir, FONT_OUTPUT_PATH, { mustExist: true });
    const png = await fsp.readFile(output);
    validateGeneration(plan, targetProfile.font.generation, png);
    currentValid = true;
  } catch (error) {
    validationError = String(error?.message || error);
  }
  return { ok: true, ...publicFontPlan(plan, currentValid, validationError) };
}

function isBundledDefaultPreset(font) {
  return font?.kind === 'bundled'
    && font.source === BUNDLED_FONT_SOURCE
    && font.fontSize === DEFAULT_FONT_SIZE
    && font.threshold === DEFAULT_FONT_THRESHOLD
    && font.xOffset === 0
    && font.yOffset === 0;
}

async function commitFontGeneration(projectDir, payload = {}) {
  const current = await readProjectDocuments(projectDir);
  const sceneDocument = deepClone(payload.sceneDocument ?? current.sceneDocument);
  const targetProfile = deepClone(payload.targetProfile ?? current.targetProfile);
  targetProfile.font = normalizeFontSettings(targetProfile.font);
  const plan = await buildFontPlan(projectDir, sceneDocument, targetProfile);
  if (payload.inputHash !== plan.inputHash) throw new Error('Font generation plan changed; regenerate the preview');
  let png;
  if (payload.pngDataUrl) {
    png = canonicalizeGeneratedAtlas(plan, fontBufferFromDataUrl(payload.pngDataUrl));
  } else if (isBundledDefaultPreset(plan.font)) {
    png = generateBundledAtlas(plan, await fsp.readFile(BUNDLED_FONT_ATLAS_PATH));
  } else {
    throw new Error('Adjusted bundled font settings require renderer-generated PNG data');
  }
  const generation = generationMetadata(plan, png);
  const changed = Boolean((await commitDocuments(projectDir, { [FONT_OUTPUT_PATH]: png }))?.documents?.[FONT_OUTPUT_PATH]);
  return { ok: true, generation, changed, ...publicFontPlan(plan, true, '') };
}

async function ensureFontDocuments(projectDir, sceneDocument, targetProfile, documents) {
  targetProfile.font = normalizeFontSettings(targetProfile.font);
  const plan = await buildFontPlan(projectDir, sceneDocument, targetProfile);
  let png;
  if (plan.font.kind === 'bundled') {
    if (isBundledDefaultPreset(plan.font)) {
      png = generateBundledAtlas(plan, await fsp.readFile(BUNDLED_FONT_ATLAS_PATH));
      targetProfile.font.generation = generationMetadata(plan, png);
    } else {
      const output = await resolveProjectPath(projectDir, FONT_OUTPUT_PATH, { mustExist: true });
      png = await fsp.readFile(output);
      validateGeneration(plan, targetProfile.font.generation, png);
    }
    documents[plan.sourceRelativePath] = plan.sourceBuffer;
    for (const fileName of BUNDLED_FONT_AUXILIARY) {
      documents[`res/novel/font/${fileName}`] = await fsp.readFile(path.join(BUNDLED_FONT_ROOT, fileName));
    }
  } else {
    const output = await resolveProjectPath(projectDir, FONT_OUTPUT_PATH, { mustExist: true });
    png = await fsp.readFile(output);
    validateGeneration(plan, targetProfile.font.generation, png);
  }
  documents[FONT_OUTPUT_PATH] = png;
  return plan;
}

async function validateFontProject(projectDir, sceneDocument, targetProfile) {
  const plan = await buildFontPlan(projectDir, sceneDocument, targetProfile);
  const output = await resolveProjectPath(projectDir, FONT_OUTPUT_PATH, { mustExist: true });
  const png = await fsp.readFile(output);
  validateGeneration(plan, normalizeFontSettings(targetProfile?.font).generation, png);
  return { plan, png };
}

async function fontDiagnostics(projectDir, sceneDocument, targetProfile) {
  try {
    await validateFontProject(projectDir, sceneDocument, targetProfile);
    return [];
  } catch (error) {
    const message = String(error?.message || error);
    const missingSource = /project font path|Expected file|Font file|signature/i.test(message);
    return [{
      severity: missingSource ? 'error' : 'warning',
      code: missingSource ? 'font-source-invalid' : 'font-generation-stale',
      path: 'font',
      message,
    }];
  }
}

async function importFont(projectDir, payload = {}) {
  const sourcePath = path.resolve(String(payload.sourcePath || ''));
  const extension = path.extname(sourcePath).toLowerCase();
  if (!FONT_EXTENSION.test(extension)) throw new Error('TTF / OTF / TTC fontを選択してください');
  const stat = await fsp.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Font source must be a regular file');
  if (stat.size > MAX_FONT_BYTES) throw new Error('Font file is too large');
  const buffer = await fsp.readFile(sourcePath);
  validateFontSignature(buffer, extension);
  validateProjectFontCoverage(buffer);
  const digest = hashBuffer(buffer);
  const relativePath = `assets/fonts/${digest.slice(0, 20)}${extension}`;
  const label = String(payload.label || path.basename(sourcePath, extension)).slice(0, 120) || path.basename(relativePath);
  const target = await resolveProjectPath(projectDir, relativePath);
  const deduplicated = await exists(target);
  await commitDocuments(projectDir, { [relativePath]: buffer });
  return { ok: true, entry: { file: relativePath, label }, sha256: digest, deduplicated };
}

async function deleteFont(projectDir, payload = {}) {
  const relativePath = String(payload.relativePath || '').replace(/\\/g, '/');
  if (!/^assets\/fonts\/[A-Za-z0-9._-]+\.(?:ttf|otf|ttc)$/i.test(relativePath)) throw new Error('Unsafe project font path');
  const current = await readProjectDocuments(projectDir);
  const active = normalizeFontSettings(current.targetProfile?.font);
  if (active.kind === 'project' && active.source.toLowerCase() === relativePath.toLowerCase()) {
    throw new Error('Active font must be changed and saved before deletion');
  }
  const target = await resolveProjectPath(projectDir, relativePath);
  const transaction = current.transaction ? deepClone(current.transaction) : null;
  if (transaction?.documents) {
    delete transaction.documents[relativePath];
    transaction.transactionId = crypto.randomUUID();
    transaction.committedAt = new Date().toISOString();
    const manifestPath = await resolveProjectPath(projectDir, RELATIVE_PATHS.transaction);
    await writeAtomic(await ensureProjectRoot(projectDir), manifestPath, jsonBuffer(transaction));
  }
  if (await exists(target)) await fsp.unlink(target);
  return { ok: true, relativePath };
}

function visualAssetCatalogEntry(catalogInfo, binding) {
  const asset = catalogInfo.byId.get(String(binding?.assetId || ''));
  if (!asset || !['image', 'sprite'].includes(asset.type)) throw new Error('Visual asset is missing from catalog: ' + String(binding?.assetId || ''));
  return asset;
}

async function readVisualSource(projectDir, catalogInfo, binding) {
  const asset = visualAssetCatalogEntry(catalogInfo, binding);
  const relativePath = String(binding.originalSource || asset.source || '').split(String.fromCharCode(92)).join('/');
  if (!relativePath) throw new Error('Visual source is missing: ' + asset.id);
  const sourcePath = await resolveProjectPath(projectDir, relativePath, { mustExist: true });
  return { asset, buffer: await fsp.readFile(sourcePath), relativePath };
}

async function conversionFreshnessDiagnostics(projectDir, sceneDocument, catalog, bindings) {
  const diagnostics = [];
  const catalogInfo = collectCatalog(catalog);
  const requirements = visualProfileRequirements(sceneDocument, bindings);
  const groupedAssets = new Set();
  for (const group of paletteGroups(bindings)) {
    const entries = [];
    let complete = true;
    for (const assetId of group.members) {
      groupedAssets.add(assetId);
      const binding = bindings.assets?.[assetId];
      if (!binding || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) {
        complete = false;
        continue;
      }
      try {
        entries.push({ ...(await readVisualSource(projectDir, catalogInfo, binding)), binding });
      } catch (error) {
        complete = false;
        diagnostics.push({ severity: 'error', code: 'visual-source-missing', path: 'bindings.assets.' + assetId, message: error.message, assetId });
      }
    }
    if (!complete || !entries.length) continue;
    const profile = group.profile || entries[0].binding.conversion?.paletteProfile || 'general';
    const reserveTransparent = Boolean(group.reserveTransparent);
    const actualHash = conversionInputHash(entries, { paletteProfile: profile, reserveTransparent, paletteGroup: group.id });
    const staleMember = entries.some((entry) => entry.binding.conversion?.converterVersion !== VISUAL_CONVERTER_VERSION || entry.binding.conversion?.inputHash !== actualHash);
    if (group.inputHash !== actualHash || staleMember) {
      diagnostics.push({
        severity: 'error',
        code: 'palette-group-conversion-stale',
        path: 'paletteGroups.' + group.id,
        message: 'Palette group source changed or uses an old converter. Run 共同減色して保存: ' + group.id,
        groupId: group.id,
      });
    }
  }
  for (const [assetId, binding] of Object.entries(bindings.assets || {})) {
    if (groupedAssets.has(assetId) || !['IMAGE', 'SPRITE'].includes(binding?.runtimeType)) continue;
    try {
      const source = await readVisualSource(projectDir, catalogInfo, binding);
      const requirement = requirements.get(assetId);
      const requiredProfile = compatiblePaletteProfile(requirement?.profiles);
      const currentProfile = binding.conversion?.paletteProfile;
      const profile = (paletteProfileSatisfies(currentProfile, requiredProfile) && currentProfile)
        || requiredProfile
        || currentProfile
        || paletteProfile(binding.legacyPalette || binding.palette, { sprite: binding.runtimeType === 'SPRITE' });
      const reserveTransparent = source.asset.type === 'sprite';
      const actualHash = conversionInputHash([source], { paletteProfile: profile, reserveTransparent });
      if (binding.conversion?.converterVersion !== VISUAL_CONVERTER_VERSION || binding.conversion?.inputHash !== actualHash) {
        diagnostics.push({
          severity: 'error',
          code: 'visual-conversion-source-stale',
          path: 'bindings.assets.' + assetId + '.conversion.inputHash',
          message: assetId + ' source changed or uses an old converter. Save the Novel project to reconvert it.',
          assetId,
        });
      }
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'visual-source-missing', path: 'bindings.assets.' + assetId, message: error.message, assetId });
    }
  }
  return diagnostics;
}

function conversionInputHash(entries, options = {}) {
  return hashDocument({
    converterVersion: VISUAL_CONVERTER_VERSION,
    paletteProfile: options.paletteProfile || 'general',
    reserveTransparent: Boolean(options.reserveTransparent),
    paletteGroup: options.paletteGroup || null,
    sources: entries.map((entry) => ({ assetId: entry.asset.id, sha256: hashBuffer(entry.buffer) })).sort((left, right) => left.assetId.localeCompare(right.assetId)),
  });
}

function applyVisualOutput(binding, output, options = {}) {
  binding.metadata = output.metadata;
  binding.contentHash = output.contentHash;
  binding.paletteFingerprint = output.paletteFingerprint;
  binding.paletteRgb333 = output.paletteRgb333;
  binding.paletteGroup = options.paletteGroup || null;
  binding.conversion = {
    ...(binding.conversion || {}),
    converterVersion: VISUAL_CONVERTER_VERSION,
    coordinateMode: options.coordinateMode || binding.conversion?.coordinateMode || 'pce-legacy-256',
    paletteProfile: options.paletteProfile || 'general',
    reserveTransparent: Boolean(options.reserveTransparent),
    inputHash: options.inputHash || '',
  };
}

async function reconvertChangedVisualProfiles(projectDir, sceneDocument, catalog, bindings, targetProfile, documents) {
  const catalogInfo = collectCatalog(catalog);
  const requirements = visualProfileRequirements(sceneDocument, bindings);
  for (const [assetId, binding] of Object.entries(bindings.assets || {})) {
    if (!['IMAGE', 'SPRITE'].includes(binding?.runtimeType)) continue;
    const requirement = requirements.get(assetId);
    const requiredProfile = compatiblePaletteProfile(requirement?.profiles);
    if (requirement && !requiredProfile) throw new Error(assetId + ' cannot be converted for incompatible palette profiles at the same time');
    const currentProfile = binding.conversion?.paletteProfile;
    const expectedProfile = (paletteProfileSatisfies(currentProfile, requiredProfile) && currentProfile)
      || requiredProfile
      || currentProfile
      || paletteProfile(binding.legacyPalette || binding.palette, { sprite: binding.runtimeType === 'SPRITE' });
    if (binding.paletteGroup) {
      if (!paletteProfileSatisfies(binding.conversion?.paletteProfile, requiredProfile)) throw new Error('Palette group ' + binding.paletteGroup + ' does not satisfy the required palette profile');
      continue;
    }
    const source = await readVisualSource(projectDir, catalogInfo, binding);
    const reserveTransparent = source.asset.type === 'sprite';
    const inputHash = conversionInputHash([source], { paletteProfile: expectedProfile, reserveTransparent });
    const missingMetadata = !binding.paletteFingerprint || !Array.isArray(binding.paletteRgb333) || !binding.metadata;
    const currentConversion = binding.conversion || {};
    if (!missingMetadata && currentConversion.converterVersion === VISUAL_CONVERTER_VERSION && currentConversion.paletteProfile === expectedProfile && currentConversion.inputHash === inputHash) continue;
    const output = convertVisualGroup([source], { paletteProfile: expectedProfile, reserveTransparent }).get(assetId);
    applyVisualOutput(binding, output, {
      paletteProfile: expectedProfile,
      reserveTransparent,
      coordinateMode: targetProfile.coordinateMode,
      inputHash,
    });
    documents['res/' + binding.sourcePath] = output.png;
  }
}

async function quantizePaletteGroup(projectDir, payload = {}) {
  const current = await loadProject(projectDir);
  if (current.diagnostics.some((entry) => entry.code?.startsWith('transaction-') && entry.severity === 'error')) throw new Error('Cannot edit palette groups while the Novel transaction is inconsistent');
  for (const key of ['scene', 'bindings']) {
    const expected = payload.baseRevisions?.[key];
    if (expected && expected !== current.revisions[key]) throw new Error('Stale ' + key + ' document; reload before quantizing.');
  }
  const groupId = String(payload.groupId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(groupId)) throw new Error('Palette group id must use 1..40 ASCII letters, digits, _ or -');
  const members = [...new Set((Array.isArray(payload.members) ? payload.members : []).map(String).filter(Boolean))].sort();
  if (!members.length) throw new Error('Palette group requires at least one visual asset');
  const bindings = deepClone(current.bindings);
  const requirements = visualProfileRequirements(current.sceneDocument, bindings);
  const catalogInfo = collectCatalog(current.catalog);
  const entries = [];
  const profiles = new Set();
  for (const assetId of members) {
    const binding = bindings.assets?.[assetId];
    if (!binding || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) throw new Error('Palette group visual asset is missing: ' + assetId);
    const requirement = requirements.get(assetId);
    const requiredProfile = compatiblePaletteProfile(requirement?.profiles);
    if (requirement && !requiredProfile) throw new Error(assetId + ' is used by incompatible palette profiles');
    const profile = requiredProfile || binding.conversion?.paletteProfile || paletteProfile(binding.legacyPalette || binding.palette, { sprite: binding.runtimeType === 'SPRITE' });
    profiles.add(profile);
    entries.push({ ...(await readVisualSource(projectDir, catalogInfo, binding)), binding });
  }
  const paletteProfileName = compatiblePaletteProfile(profiles);
  if (!paletteProfileName) throw new Error('Incompatible conversion profiles cannot share one palette group');
  const reserveTransparent = entries.some((entry) => entry.asset.type === 'sprite');
  const inputHash = conversionInputHash(entries, { paletteProfile: paletteProfileName, reserveTransparent, paletteGroup: groupId });
  const outputs = convertVisualGroup(entries, { paletteProfile: paletteProfileName, reserveTransparent });
  const documents = {};
  for (const entry of entries) {
    const output = outputs.get(entry.asset.id);
    applyVisualOutput(entry.binding, output, {
      paletteProfile: paletteProfileName,
      reserveTransparent,
      paletteGroup: groupId,
      coordinateMode: current.targetProfile.coordinateMode,
      inputHash,
    });
    documents['res/' + entry.binding.sourcePath] = output.png;
  }
  for (const binding of Object.values(bindings.assets || {})) {
    if (binding.paletteGroup === groupId && !members.includes(binding.assetId)) binding.paletteGroup = null;
  }
  const retainedGroups = {};
  for (const group of paletteGroups(bindings)) {
    if (group.id === groupId) continue;
    const remainingMembers = (group.members || []).filter((assetId) => !members.includes(assetId));
    if (remainingMembers.length) retainedGroups[group.id] = { ...group, members: remainingMembers };
  }
  const firstOutput = outputs.get(entries[0].asset.id);
  retainedGroups[groupId] = {
    id: groupId,
    members,
    profile: paletteProfileName,
    reserveTransparent,
    paletteFingerprint: firstOutput.paletteFingerprint,
    paletteRgb333: firstOutput.paletteRgb333,
    quality: {
      meanDeltaE: Math.max(...entries.map((entry) => Number(outputs.get(entry.asset.id).metadata.quality.meanDeltaE || 0))),
      p95DeltaE: Math.max(...entries.map((entry) => Number(outputs.get(entry.asset.id).metadata.quality.p95DeltaE || 0))),
    },
    inputHash,
    convertedAt: new Date().toISOString(),
  };
  bindings.paletteGroups = retainedGroups;
  bindings.sourceSceneRevision = hashDocument(current.sceneDocument);
  documents[RELATIVE_PATHS.bindings] = bindings;
  await commitDocuments(projectDir, documents, { sourceSceneRevision: bindings.sourceSceneRevision });
  return loadProject(projectDir);
}

async function readIndexedAssets(projectDir, payload = {}) {
  const current = await readProjectDocuments(projectDir);
  const requested = [...new Set((Array.isArray(payload.assetIds) ? payload.assetIds : []).map(String).filter(Boolean))];
  if (requested.length > 16) throw new Error('Indexed preview request is limited to 16 assets');
  const assets = {};
  for (const assetId of requested) {
    const binding = current.bindings?.assets?.[assetId];
    if (!binding?.sourcePath || !['IMAGE', 'SPRITE'].includes(binding.runtimeType)) continue;
    const target = await resolveProjectPath(projectDir, 'res/' + binding.sourcePath, { mustExist: true });
    const decoded = decodePng(await fsp.readFile(target));
    if (!decoded.sourceIndices) throw new Error('Converted visual is not indexed: ' + assetId);
    assets[assetId] = {
      width: decoded.width,
      height: decoded.height,
      indicesBase64: Buffer.from(decoded.sourceIndices).toString('base64'),
      paletteRgb333: binding.paletteRgb333 || decoded.palette.map((color) => color.slice(0, 3)),
      paletteFingerprint: binding.paletteFingerprint || '',
    };
  }
  return { ok: true, assets };
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
  const persistedProfileRevision = hashDocument(documents.targetProfile);
  if (documents.targetProfile && typeof documents.targetProfile === 'object') {
    documents.targetProfile = migrateTargetProfile(documents.targetProfile);
  }
  const validation = validateSceneDocument(documents.sceneDocument, documents.catalog, { includeDocuments: false });
  const budget = analyzeNovelBudget(documents.sceneDocument, documents.bindings);
  const diagnostics = [
    ...validation.diagnostics,
    ...validateProfile(documents.targetProfile),
    ...validateBindings(documents.sceneDocument, documents.catalog, documents.bindings),
    ...await conversionFreshnessDiagnostics(projectDir, documents.sceneDocument, documents.catalog, documents.bindings),
    ...await validateTransaction(projectDir, documents.transaction),
    ...await fontDiagnostics(projectDir, documents.sceneDocument, documents.targetProfile),
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
      profile: persistedProfileRevision,
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
  const targetProfile = migrateTargetProfile(payload.targetProfile ?? current.targetProfile);
  const bindings = deepClone(payload.bindings ?? current.bindings);
  assertSafeJson(sceneDocument);
  assertSafeJson(targetProfile);
  assertSafeJson(bindings);
  bindings.sourceSceneRevision = hashDocument(sceneDocument);
  const documents = {};
  await reconvertChangedVisualProfiles(projectDir, sceneDocument, current.catalog, bindings, targetProfile, documents);
  const validation = validateSceneDocument(sceneDocument, current.catalog);
  const diagnostics = [
    ...validation.diagnostics,
    ...validateProfile(targetProfile),
    ...validateBindings(sceneDocument, current.catalog, bindings),
    ...await conversionFreshnessDiagnostics(projectDir, sceneDocument, current.catalog, bindings),
  ];
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error('Novel save validation failed: ' + errors[0].message);
  documents[RELATIVE_PATHS.scene] = sceneDocument;
  documents[RELATIVE_PATHS.profile] = targetProfile;
  documents[RELATIVE_PATHS.bindings] = bindings;
  await ensureFontDocuments(projectDir, sceneDocument, targetProfile, documents);
  await commitDocuments(projectDir, documents, { sourceSceneRevision: bindings.sourceSceneRevision });
  return loadProject(projectDir);
}

function sourceProjectId(projectConfig, sourceRoot) {
  const explicit = projectConfig.id || projectConfig.uuid || projectConfig.serial || projectConfig.romName || projectConfig.title;
  if (explicit) return String(explicit);
  return crypto.createHash('sha256').update(path.resolve(sourceRoot).toLowerCase(), 'utf8').digest('hex').slice(0, 24);
}

async function importPceProject(projectDir, payload = {}, context = {}) {
  const sourceRoot = await ensureProjectRoot(payload.sourceProjectDir);
  const sourceSceneDocument = await readJsonFile(await resolveSourcePath(sourceRoot, RELATIVE_PATHS.scene));
  const paletteAssignments = normalizePcePaletteAssignments(payload.paletteAssignments);
  const sceneDocument = injectPcePalettes(sourceSceneDocument, paletteAssignments);
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
  const requirements = visualProfileRequirements(sceneDocument, bindings);
  for (const entry of visualEntries) {
    const requirement = requirements.get(entry.asset.id);
    const requiredProfile = compatiblePaletteProfile(requirement?.profiles);
    if (requirement && !requiredProfile) throw new Error(entry.asset.id + ' is used by incompatible palette profiles in the imported script');
    const paletteProfileName = requiredProfile || paletteProfile(entry.binding.legacyPalette || entry.binding.palette, { sprite: entry.binding.runtimeType === 'SPRITE' });
    const reserveTransparent = entry.asset.type === 'sprite';
    const inputHash = conversionInputHash([entry], { paletteProfile: paletteProfileName, reserveTransparent });
    const output = convertVisualGroup([entry], { paletteProfile: paletteProfileName, reserveTransparent }).get(entry.asset.id);
    applyVisualOutput(entry.binding, output, {
      paletteProfile: paletteProfileName,
      reserveTransparent,
      coordinateMode: targetProfile.coordinateMode,
      inputHash,
    });
    documents['res/' + entry.binding.sourcePath] = output.png;
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
  await ensureFontDocuments(projectDir, sceneDocument, targetProfile, documents);
  await commitDocuments(projectDir, documents, { sourceSceneRevision: sceneRevision });
  const result = await loadProject(projectDir);
  result.importReport = {
    sourceProjectDir: sourceRoot,
    paletteAssignments,
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
  writeAtomicIfChanged,
  commitDocuments,
  readFontSource,
  buildFontPlan,
  prepareFontGeneration,
  commitFontGeneration,
  ensureFontDocuments,
  validateFontProject,
  fontDiagnostics,
  importFont,
  deleteFont,
  validateTransaction,
  validateProfile,
  migrateTargetProfile,
  normalizePcePaletteAssignments,
  validateBindings,
  injectPcePalettes,
  visualProfileRequirements,
  conversionFreshnessDiagnostics,
  quantizePaletteGroup,
  readIndexedAssets,
  readProjectDocuments,
  loadProject,
  saveProject,
  importPceProject,
};
