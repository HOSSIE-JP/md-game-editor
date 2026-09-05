'use strict';

const fs = require('node:fs');
const path = require('node:path');
const host = require('./stg-schema-v2');

let rescompManager;

function loadRescompManager() {
  if (rescompManager) return rescompManager;
  const candidates = [path.resolve(__dirname, '..', '..', 'rescomp-manager.js')];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'app.asar', 'rescomp-manager.js'));
  let firstError;
  for (const candidate of candidates) {
    try {
      rescompManager = require(candidate);
      return rescompManager;
    } catch (error) {
      firstError ||= error;
    }
  }
  const error = new Error(`ResComp managerを読み込めません: ${candidates.join(' / ')}`);
  error.cause = firstError;
  throw error;
}

const DOCUMENT_PATHS = Object.freeze({
  project: 'project.json',
  pools: 'pools.json',
  'game-flow': 'game-flow.json',
  input: 'input.json',
  save: 'save.json',
  player: 'player.json',
  'demo-bindings': 'demo-bindings.json',
  'runtime-ids': 'runtime-ids.json',
  'editor-state': 'editor-state.json',
  ...Object.fromEntries(host.COLLECTION_KINDS.map((kind) => [kind, `${kind}.json`])),
});

const DEFAULTS = Object.freeze({
  project: host.DEFAULT_PROJECT,
  pools: host.DEFAULT_POOLS,
  'game-flow': host.DEFAULT_GAME_FLOW,
  input: host.DEFAULT_INPUT,
  save: host.DEFAULT_SAVE,
  player: host.DEFAULT_PLAYER,
  'demo-bindings': host.DEFAULT_DEMO_BINDINGS,
  'runtime-ids': host.DEFAULT_RUNTIME_IDS,
  ...host.DEFAULT_COLLECTIONS,
});

function assertVersion(value, label) {
  const version = Number(value?.schemaVersion);
  if (version === 1) {
    const error = new Error(`${label}: BulletML STG schema v1は2.0で非対応です。v2 Showcaseを新規作成してください`);
    error.code = 'BML_SCHEMA_V1_UNSUPPORTED';
    throw error;
  }
  if (version !== host.SCHEMA_VERSION) {
    const error = new Error(`${label}: schemaVersion ${Number.isFinite(version) ? version : '(missing)'} は非対応です。要求version: ${host.SCHEMA_VERSION}`);
    error.code = 'BML_SCHEMA_VERSION';
    throw error;
  }
  return value;
}

function readVersionedJson(filePath, fallback, readJsonFile) {
  if (!fs.existsSync(filePath)) return host.clone(fallback);
  return assertVersion(readJsonFile(filePath, fallback), filePath);
}

function listJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function readDocuments(projectDir, io, editorDefault) {
  const dataRoot = io.resolveProjectPath(projectDir, path.join('data', 'bulletml'));
  const raw = {};
  for (const [kind, relative] of Object.entries(DOCUMENT_PATHS)) {
    if (kind === 'editor-state') {
      const fallback = editorDefault;
      raw[kind] = readVersionedJson(path.join(dataRoot, relative), fallback, io.readJsonFile);
      continue;
    }
    raw[kind] = readVersionedJson(path.join(dataRoot, relative), DEFAULTS[kind], io.readJsonFile);
  }
  const collections = Object.fromEntries(host.COLLECTION_KINDS.map((kind) => [kind, host.normalizeCollection(kind, raw[kind])]));
  return {
    project: host.normalizeProject(raw.project),
    pools: host.normalizePools(raw.pools),
    gameFlow: host.normalizeGameFlow(raw['game-flow']),
    input: host.normalizeInput(raw.input),
    save: host.normalizeSave(raw.save),
    player: host.normalizePlayer(raw.player),
    demoBindings: host.normalizeDemoBindings(raw['demo-bindings']),
    runtimeIds: host.normalizeRuntimeIds(raw['runtime-ids']),
    collections,
    editorState: raw['editor-state'],
  };
}

function readStages(projectDir, io) {
  const stageRoot = io.resolveProjectPath(projectDir, path.join('data', 'bulletml', 'stages'));
  return listJsonFiles(stageRoot).map((filePath) => {
    const raw = assertVersion(io.readJsonFile(filePath, {}), filePath);
    return host.normalizeStage(raw, path.basename(filePath, '.json'));
  });
}

function readPatterns(projectDir, io, normalizePattern) {
  const patternRoot = io.resolveProjectPath(projectDir, path.join('data', 'bulletml', 'patterns'));
  return listJsonFiles(patternRoot).map((filePath) => {
    const raw = assertVersion(io.readJsonFile(filePath, {}), filePath);
    return normalizePattern(raw, path.basename(filePath, '.json'));
  });
}

function documentRevisionMap(documents, revisionFor) {
  const result = {
    project: revisionFor(documents.project),
    pools: revisionFor(documents.pools),
    gameFlow: revisionFor(documents.gameFlow),
    input: revisionFor(documents.input),
    save: revisionFor(documents.save),
    player: revisionFor(documents.player),
    demoBindings: revisionFor(documents.demoBindings),
    runtimeIds: revisionFor(documents.runtimeIds),
    editorState: revisionFor(documents.editorState),
  };
  for (const kind of host.COLLECTION_KINDS) result[kind] = revisionFor(documents.collections[kind]);
  return result;
}

function writeDocument(projectDir, kind, value, io) {
  const relative = DOCUMENT_PATHS[kind];
  if (!relative || kind === 'editor-state') throw new Error(`Unsupported v2 document: ${kind}`);
  const normalized = host.normalizeDocument(kind, value);
  io.writeJsonFile(io.resolveProjectPath(projectDir, path.join('data', 'bulletml', relative)), normalized);
  return normalized;
}

function writeRuntimeIds(projectDir, snapshot, io) {
  const registry = host.reconcileRuntimeIds(snapshot, snapshot.runtimeIds);
  io.writeJsonFile(io.resolveProjectPath(projectDir, path.join('data', 'bulletml', DOCUMENT_PATHS['runtime-ids'])), registry);
  return registry;
}

function deletedRoot(projectDir, kind, io) {
  return io.resolveProjectPath(projectDir, path.join('data', 'bulletml', '.deleted', kind));
}

function backupDeletedEntry(projectDir, kind, entry, io) {
  const root = deletedRoot(projectDir, kind, io);
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${host.safeId(entry.id, 'entry')}-${stamp}.json`;
  io.writeJsonFile(path.join(root, fileName), { schemaVersion: host.SCHEMA_VERSION, kind, entry });
  return { fileName, relativePath: path.relative(projectDir, path.join(root, fileName)).replace(/\\/g, '/') };
}

function readDeletedEntries(projectDir, io) {
  const result = {};
  for (const kind of host.COLLECTION_KINDS) {
    const root = deletedRoot(projectDir, kind, io);
    result[kind] = listJsonFiles(root).map((filePath) => {
      const raw = assertVersion(io.readJsonFile(filePath, {}), filePath);
      return { fileName: path.basename(filePath), kind, entry: raw.entry, deletedAt: fs.statSync(filePath).mtime.toISOString() };
    });
  }
  return result;
}

function buildAssetIndex(projectDir) {
  const listed = loadRescompManager().listResDefinitions(projectDir);
  const index = new Map();
  for (const file of listed.files || []) {
    for (const entry of file.entries || []) {
      const item = { ...entry, file: file.file };
      if (!index.has(item.name)) index.set(item.name, []);
      index.get(item.name).push(item);
    }
  }
  return { index, listed };
}

module.exports = {
  DOCUMENT_PATHS,
  DEFAULTS,
  assertVersion,
  readVersionedJson,
  readDocuments,
  readStages,
  readPatterns,
  documentRevisionMap,
  writeDocument,
  writeRuntimeIds,
  backupDeletedEntry,
  readDeletedEntries,
  buildAssetIndex,
  loadRescompManager,
};
