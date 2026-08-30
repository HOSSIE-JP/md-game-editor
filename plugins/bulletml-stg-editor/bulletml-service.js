'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('./bulletml-schema');
const xml = require('./bulletml-xml');
const compiler = require('./bulletml-compiler');
const simulator = require('./bulletml-simulator');
const { StagePreviewSession } = require('./bulletml-stage-preview');

const DATA_ROOT = path.join('data', 'bulletml');
const PATTERN_ROOT = path.join(DATA_ROOT, 'patterns');
const STAGE_ROOT = path.join(DATA_ROOT, 'stages');
const PROJECT_PATH = path.join(DATA_ROOT, 'project.json');
const EDITOR_STATE_PATH = path.join(DATA_ROOT, 'editor-state.json');
const stagePreviewSessions = new Map();
const MAX_STAGE_PREVIEW_SESSIONS = 8;

function assertProjectDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') throw new Error('projectDir is required');
  return path.resolve(projectDir);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProjectPath(projectDir, relativePath) {
  const root = assertProjectDir(projectDir);
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) throw new Error('project-relative path is required');
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => part === '..')) throw new Error(`path traversal is not allowed: ${relativePath}`);
  const resolved = path.resolve(root, normalized);
  if (!isInside(root, resolved)) throw new Error(`path escapes project: ${relativePath}`);
  return resolved;
}

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return schema.deepClone(fallback);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw new Error(`${filePath}: JSONの解析に失敗しました: ${error.message}`); }
}

function atomicWriteFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  const nonce = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const tempPath = `${filePath}.${nonce}.tmp`;
  const backupPath = `${filePath}.${nonce}.bak`;
  fs.writeFileSync(tempPath, contents);
  const descriptor = fs.openSync(tempPath, 'r');
  try {
    try { fs.fsyncSync(descriptor); }
    catch (error) {
      if (!['EPERM', 'EINVAL', 'ENOTSUP'].includes(error?.code)) throw error;
    }
  } finally { fs.closeSync(descriptor); }
  let movedOriginal = false;
  try {
    if (fs.existsSync(filePath)) { fs.renameSync(filePath, backupPath); movedOriginal = true; }
    fs.renameSync(tempPath, filePath);
    if (movedOriginal && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (movedOriginal && fs.existsSync(backupPath) && !fs.existsSync(filePath)) fs.renameSync(backupPath, filePath);
    throw error;
  }
}

function writeJsonFile(filePath, value) { atomicWriteFile(filePath, schema.stableStringify(value)); }

function listPatternFiles(projectDir) {
  const root = resolveProjectPath(projectDir, PATTERN_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function readDeleted(projectDir) {
  const root = resolveProjectPath(projectDir, path.join(PATTERN_ROOT, '.deleted'));
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      const pattern = schema.normalizePattern(readJsonFile(filePath, {}), entry.name.replace(/-\d{8}T\d{6}.*$/, '').replace(/\.json$/, ''));
      return { fileName: entry.name, pattern, deletedAt: fs.statSync(filePath).mtime.toISOString() };
    });
}

function readSnapshot(projectDir) {
  const root = assertProjectDir(projectDir);
  const project = schema.normalizeProject(readJsonFile(resolveProjectPath(root, PROJECT_PATH), schema.DEFAULT_PROJECT));
  const editorState = schema.normalizeEditorState(readJsonFile(resolveProjectPath(root, EDITOR_STATE_PATH), schema.DEFAULT_EDITOR_STATE));
  const patterns = listPatternFiles(root).map((filePath) => schema.normalizePattern(readJsonFile(filePath, {}), path.basename(filePath, '.json')));
  const byId = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  const ordered = [
    ...project.patternOrder.map((id) => byId.get(id)).filter(Boolean),
    ...patterns.filter((pattern) => !project.patternOrder.includes(pattern.id)).sort((left, right) => left.id.localeCompare(right.id, 'en')),
  ];
  const stages = ['vertical', 'horizontal'].map((orientation) => schema.normalizeStage(readJsonFile(resolveProjectPath(root, path.join(STAGE_ROOT, `${orientation}.json`)), {}), orientation));
  const revisions = {
    project: schema.revisionFor(project),
    editorState: schema.revisionFor(editorState),
    patterns: Object.fromEntries(ordered.map((pattern) => [pattern.id, schema.revisionFor(pattern)])),
    stages: Object.fromEntries(stages.map((stage) => [stage.orientation, schema.revisionFor(stage)])),
  };
  return { project, editorState, patterns: ordered, stages, deleted: readDeleted(root), revisions };
}

function loadProject(projectDir) {
  try {
    const snapshot = readSnapshot(projectDir);
    const validation = schema.validateProject(snapshot.project, snapshot.patterns, snapshot.stages);
    const templates = Object.fromEntries(['blank', 'aimed', 'fan', 'rotation', 'rank', 'rand', 'speed', 'turn', 'split', 'reference'].map((id) => [id, schema.createPatternTemplate(id, `pattern-${id}`)]));
    return { ok: true, snapshot, validation, templates };
  } catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

function checkRevision(current, expected, label) {
  if (expected == null || expected === '') return;
  if (current !== expected) {
    const error = new Error(`${label}は別の操作で更新されています。再読込してください`);
    error.conflict = true;
    throw error;
  }
}

function withConflict(handler) {
  try { return handler(); }
  catch (error) { return { ok: false, conflict: Boolean(error?.conflict), error: String(error?.message || error) }; }
}

function saveProject(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const current = readSnapshot(root);
    if (payload.project) checkRevision(current.revisions.project, payload.baseRevisions?.project ?? payload.baseRevision, 'project.json');
    if (payload.editorState) checkRevision(current.revisions.editorState, payload.baseRevisions?.editorState, 'editor-state.json');
    const project = payload.project ? schema.normalizeProject(payload.project) : current.project;
    const editorState = payload.editorState ? schema.normalizeEditorState(payload.editorState) : current.editorState;
    if (payload.project) writeJsonFile(resolveProjectPath(root, PROJECT_PATH), project);
    if (payload.editorState) writeJsonFile(resolveProjectPath(root, EDITOR_STATE_PATH), editorState);
    const snapshot = readSnapshot(root);
    return { ok: true, snapshot, validation: schema.validateProject(snapshot.project, snapshot.patterns, snapshot.stages) };
  });
}

function savePattern(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const pattern = schema.normalizePattern(payload.pattern || payload.data, payload.id || 'pattern');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(pattern.id)) throw new Error('pattern IDが不正です');
    const current = readSnapshot(root);
    const existing = current.patterns.find((item) => item.id === pattern.id);
    checkRevision(existing ? current.revisions.patterns[pattern.id] : '', payload.baseRevision, `${pattern.id}.json`);
    writeJsonFile(resolveProjectPath(root, path.join(PATTERN_ROOT, `${pattern.id}.json`)), pattern);
    if (!current.project.patternOrder.includes(pattern.id)) {
      current.project.patternOrder.push(pattern.id);
      writeJsonFile(resolveProjectPath(root, PROJECT_PATH), current.project);
    }
    const snapshot = readSnapshot(root);
    const validation = schema.validatePattern(pattern);
    let compiled = null;
    if (validation.ok) {
      const result = compiler.compilePattern(pattern);
      compiled = { base64: result.bytes.toString('base64'), sha256: result.sha256, report: result.report };
    }
    return { ok: true, draftValid: validation.ok, snapshot, validation, compiled };
  });
}

function deletePattern(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const id = schema.safeId(payload.id);
    if (!id || id !== payload.id) throw new Error('pattern IDが不正です');
    const current = readSnapshot(root);
    const pattern = current.patterns.find((item) => item.id === id);
    if (!pattern) throw new Error(`pattern ${id} がありません`);
    checkRevision(current.revisions.patterns[id], payload.baseRevision, `${id}.json`);
    const source = resolveProjectPath(root, path.join(PATTERN_ROOT, `${id}.json`));
    const deletedRoot = resolveProjectPath(root, path.join(PATTERN_ROOT, '.deleted'));
    ensureDir(deletedRoot);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const destination = path.join(deletedRoot, `${id}-${stamp}.json`);
    if (fs.existsSync(destination)) throw new Error('同名の削除backupが既にあります');
    fs.renameSync(source, destination);
    current.project.patternOrder = current.project.patternOrder.filter((item) => item !== id);
    for (const role of schema.PATTERN_ROLES) if (current.project.patternRoles[role] === id) current.project.patternRoles[role] = '';
    writeJsonFile(resolveProjectPath(root, PROJECT_PATH), current.project);
    const snapshot = readSnapshot(root);
    return { ok: true, backup: path.relative(root, destination).replace(/\\/g, '/'), snapshot };
  });
}

function restorePattern(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const fileName = path.basename(String(payload.fileName || ''));
    if (!fileName.endsWith('.json') || fileName !== payload.fileName) throw new Error('deleted file名が不正です');
    const source = resolveProjectPath(root, path.join(PATTERN_ROOT, '.deleted', fileName));
    if (!fs.existsSync(source)) throw new Error(`${fileName} がありません`);
    const pattern = schema.normalizePattern(readJsonFile(source, {}), 'restored-pattern');
    const destination = resolveProjectPath(root, path.join(PATTERN_ROOT, `${pattern.id}.json`));
    if (fs.existsSync(destination)) throw new Error(`pattern ${pattern.id} は既に存在します`);
    fs.renameSync(source, destination);
    const current = readSnapshot(root);
    if (!current.project.patternOrder.includes(pattern.id)) { current.project.patternOrder.push(pattern.id); writeJsonFile(resolveProjectPath(root, PROJECT_PATH), current.project); }
    return { ok: true, snapshot: readSnapshot(root) };
  });
}

function importXml(projectDir, payload = {}) {
  return withConflict(() => {
    const source = String(payload.xml || '');
    let sidecar = payload.sidecar || null;
    const sidecarStatus = xml.verifySidecar(sidecar, source);
    if (!sidecarStatus.ok) sidecar = null;
    const imported = xml.importXml(source, sidecar, { patternId: payload.patternId, name: payload.name });
    const current = readSnapshot(projectDir);
    const existing = current.patterns.find((item) => item.id === imported.pattern.id);
    checkRevision(existing ? current.revisions.patterns[existing.id] : '', payload.baseRevision, `${imported.pattern.id}.json`);
    const saved = savePattern(projectDir, { pattern: imported.pattern, baseRevision: existing ? current.revisions.patterns[existing.id] : '' });
    if (!saved.ok) return saved;
    return { ...saved, sidecarStatus, diagnostics: [...imported.diagnostics, ...(!sidecarStatus.ok ? [{ severity: 'warning', code: sidecarStatus.stale ? 'BML_SIDECAR_STALE' : 'BML_SIDECAR_MISSING', path: 'sidecar', message: sidecarStatus.diagnostic }] : [])] };
  });
}

function exportXml(projectDir, payload = {}) {
  return withConflict(() => {
    const snapshot = readSnapshot(projectDir);
    const pattern = payload.pattern ? schema.normalizePattern(payload.pattern, payload.id) : snapshot.patterns.find((item) => item.id === payload.id);
    if (!pattern) throw new Error(`pattern ${payload.id} がありません`);
    const source = xml.exportXml(pattern);
    const sidecar = xml.createSidecar(pattern, source);
    if (payload.write !== false) {
      const exportRoot = path.join(DATA_ROOT, 'exports');
      atomicWriteFile(resolveProjectPath(projectDir, path.join(exportRoot, `${pattern.id}.xml`)), source);
      writeJsonFile(resolveProjectPath(projectDir, path.join(exportRoot, `${pattern.id}.md-bullet.json`)), sidecar);
    }
    return { ok: true, xml: source, sidecar, xmlSha256: sidecar.canonicalXmlSha256 };
  });
}

function compilePattern(projectDir, payload = {}) {
  return withConflict(() => {
    const snapshot = readSnapshot(projectDir);
    const pattern = payload.pattern ? schema.normalizePattern(payload.pattern, payload.id) : snapshot.patterns.find((item) => item.id === payload.id);
    if (!pattern) throw new Error(`pattern ${payload.id} がありません`);
    const result = compiler.compilePattern(pattern);
    const matrix = payload.stress ? simulator.runValidationMatrix(result.bytes, { frames: payload.frames || 3600 }) : null;
    let preview = null;
    if (payload.preview) {
      const settings = payload.preview;
      const frames = Math.max(1, Math.min(1200, Math.trunc(Number(settings.frames) || 600)));
      const vm = new simulator.BulletmlVm(result.bytes, { seed: settings.seed });
      vm.setRank(settings.rank);
      vm.setPlayer(Number(settings.playerX ?? 160), Number(settings.playerY ?? 196));
      vm.startEmitter({
        x: Number(settings.emitterX ?? 160),
        y: Number(settings.emitterY ?? 28),
        orientation: settings.orientation,
        direction: Number(settings.direction || 0),
      });
      const trace = [];
      let crc = 0xffffffff;
      for (let frame = 0; frame < frames; frame += 1) {
        if (settings.playerPath) {
          const position = simulator.playerPosition(settings.playerPath, frame, settings.orientation);
          vm.setPlayer(position.x, position.y);
        }
        vm.tick();
        vm.applyDisplayBudget(settings.displayBudget || {});
        crc = vm.stateCrc(crc);
        trace.push({ frame: frame + 1, bullets: vm.getBullets(), metrics: vm.getMetrics() });
      }
      preview = { trace, crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0') };
    }
    return { ok: !matrix || matrix.ok, base64: result.bytes.toString('base64'), sha256: result.sha256, report: result.report, matrix, preview, error: matrix && !matrix.ok ? '自動負荷検証でresource dropが発生しました' : undefined };
  });
}

function validateProject(projectDir, payload = {}) {
  return withConflict(() => {
    const snapshot = readSnapshot(projectDir);
    const validation = schema.validateProject(snapshot.project, snapshot.patterns, snapshot.stages);
    const compiled = [];
    const programs = new Map();
    const stageMatrices = [];
    if (validation.ok) {
      for (const pattern of snapshot.patterns) {
        const result = compiler.compilePattern(pattern);
        programs.set(pattern.id, result.bytes);
        const matrix = payload.stress ? simulator.runValidationMatrix(result.bytes, { frames: payload.frames || 3600 }) : null;
        compiled.push({ id: pattern.id, sha256: result.sha256, byteLength: result.bytes.length, matrix });
        if (matrix && !matrix.ok) validation.diagnostics.push({ severity: 'error', code: 'BML_STRESS_DROP', path: `patterns.${pattern.id}`, message: `${matrix.failures.length}ケースでresource dropが発生しました` });
      }
      if (payload.stress && !validation.diagnostics.some((item) => item.severity === 'error')) {
        for (const stage of snapshot.stages) {
          const matrix = simulator.runStageValidationMatrix(stage, programs, { frames: payload.frames || stage.durationFrames });
          stageMatrices.push({ orientation: stage.orientation, ...matrix });
          if (!matrix.ok) validation.diagnostics.push({ severity: 'error', code: 'BML_STAGE_STRESS_DROP', path: `stages.${stage.orientation}`, message: `${matrix.failures.length}ケースでstage resource dropが発生しました` });
        }
      }
    }
    validation.ok = !validation.diagnostics.some((item) => item.severity === 'error');
    validation.errors = validation.diagnostics.filter((item) => item.severity === 'error');
    return { ok: validation.ok, snapshot, validation, compiled, stageMatrices, error: validation.ok ? undefined : 'BulletML projectにBuildを拒否する診断があります' };
  });
}

function loadStage(projectDir, payload = {}) {
  return withConflict(() => {
    const orientation = payload.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const snapshot = readSnapshot(projectDir);
    const stage = snapshot.stages.find((item) => item.orientation === orientation);
    return { ok: true, stage, revision: snapshot.revisions.stages[orientation], validation: schema.validateStage(stage, new Set(snapshot.patterns.map((item) => item.id))) };
  });
}

function saveStage(projectDir, payload = {}) {
  return withConflict(() => {
    const orientation = payload.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const current = readSnapshot(projectDir);
    checkRevision(current.revisions.stages[orientation], payload.baseRevision, `${orientation}.json`);
    const stage = schema.normalizeStage(payload.stage || payload.data, orientation);
    writeJsonFile(resolveProjectPath(projectDir, path.join(STAGE_ROOT, `${orientation}.json`)), stage);
    const snapshot = readSnapshot(projectDir);
    return { ok: true, stage: snapshot.stages.find((item) => item.orientation === orientation), revision: snapshot.revisions.stages[orientation], validation: schema.validateStage(stage, new Set(snapshot.patterns.map((item) => item.id))) };
  });
}

function stagePreviewSession(projectDir, sessionId) {
  const root = assertProjectDir(projectDir);
  const record = stagePreviewSessions.get(String(sessionId || ''));
  if (!record || record.projectDir !== root) throw new Error('Stage Preview session is missing or belongs to another project');
  return record.session;
}

function startStagePreview(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const snapshot = readSnapshot(root);
    const byId = new Map(snapshot.patterns.map((pattern) => [pattern.id, pattern]));
    for (const input of Array.isArray(payload.patterns) ? payload.patterns : []) {
      const pattern = schema.normalizePattern(input, input?.id);
      byId.set(pattern.id, pattern);
    }
    const orientation = payload.orientation === 'horizontal' || payload.stage?.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const stored = snapshot.stages.find((item) => item.orientation === orientation);
    const stage = schema.normalizeStage(payload.stage || stored || {}, orientation);
    const firstPatternId = snapshot.project.patternOrder.find((id) => byId.has(id)) || byId.keys().next().value || '';
    const normalRole = snapshot.project.patternRoles[orientation + 'Normal'] || firstPatternId;
    const bossRole = snapshot.project.patternRoles[orientation + 'Boss'] || normalRole;
    for (const event of stage.events) {
      event.patternId ||= event.boss ? bossRole : normalRole;
      for (const phase of event.phases) phase.patternId ||= event.patternId;
    }
    const validation = schema.validateStage(stage, new Set(byId.keys()));
    if (!validation.ok) throw new Error(validation.diagnostics[0]?.message || 'Stage Preview validation failed');
    const referenced = new Set();
    for (const event of stage.events) {
      if (event.patternId) referenced.add(event.patternId);
      for (const phase of event.phases) if (phase.patternId) referenced.add(phase.patternId);
    }
    const programs = new Map();
    for (const id of referenced) {
      const pattern = byId.get(id);
      if (!pattern) throw new Error('Stage pattern ' + id + ' is missing');
      const patternValidation = schema.validatePattern(pattern);
      if (!patternValidation.ok) throw new Error(id + ': ' + (patternValidation.errors[0]?.message || 'pattern validation failed'));
      programs.set(id, compiler.compilePattern(pattern).bytes);
    }
    const session = new StagePreviewSession(stage, programs, {
      difficulty: payload.difficulty,
      rank: payload.rank,
      seed: payload.seed,
    });
    const sessionId = crypto.randomBytes(12).toString('hex');
    stagePreviewSessions.set(sessionId, { projectDir: root, session });
    if (payload.replaceSessionId) {
      const previous = stagePreviewSessions.get(String(payload.replaceSessionId));
      if (previous?.projectDir === root) stagePreviewSessions.delete(String(payload.replaceSessionId));
    }
    while (stagePreviewSessions.size > MAX_STAGE_PREVIEW_SESSIONS) stagePreviewSessions.delete(stagePreviewSessions.keys().next().value);
    return { ok: true, sessionId, preview: session.snapshot(), validation };
  });
}

function stepStagePreview(projectDir, payload = {}) {
  return withConflict(() => {
    const session = stagePreviewSession(projectDir, payload.sessionId);
    const preview = session.step(payload.input || {}, payload.frames);
    return { ok: true, sessionId: payload.sessionId, preview };
  });
}

function seekStagePreview(projectDir, payload = {}) {
  return withConflict(() => {
    const session = stagePreviewSession(projectDir, payload.sessionId);
    const preview = session.seek(payload.frame);
    return { ok: true, sessionId: payload.sessionId, preview };
  });
}

function stopStagePreview(projectDir, payload = {}) {
  return withConflict(() => {
    const root = assertProjectDir(projectDir);
    const sessionId = String(payload.sessionId || '');
    const record = stagePreviewSessions.get(sessionId);
    if (record && record.projectDir !== root) throw new Error('Stage Preview session belongs to another project');
    return { ok: true, stopped: stagePreviewSessions.delete(sessionId) };
  });
}

function exportBuild(projectDir, options = {}) {
  const snapshot = readSnapshot(projectDir);
  const validation = schema.validateProject(snapshot.project, snapshot.patterns, snapshot.stages);
  if (!validation.ok) return { ok: false, error: 'BulletML project validation failed', diagnostics: validation.diagnostics };
  const generated = {};
  const proofPatterns = [];
  const matrices = [];
  const programs = new Map();
  for (const pattern of snapshot.patterns) {
    const result = compiler.compilePattern(pattern);
    programs.set(pattern.id, result.bytes);
    const matrix = simulator.runValidationMatrix(result.bytes, { frames: options.frames || 3600 });
    matrices.push({ id: pattern.id, ...matrix });
    if (!matrix.ok) return { ok: false, error: `${pattern.id}: 自動負荷検証でresource dropが発生しました`, diagnostics: matrix.failures };
    const relative = `res/bulletml/generated/${pattern.id}.bmlb`;
    generated[relative] = result.bytes;
    proofPatterns.push({ id: pattern.id, irSha256: schema.revisionFor(pattern), bmlbSha256: result.sha256, bytes: result.bytes.length, maxima: matrix.maxima, cases: matrix.cases.map((item) => ({ orientation: item.orientation, rank: item.rank, seed: item.seed, path: item.path, crc32: item.crc32 })) });
  }
  const stageMatrices = [];
  for (const stage of snapshot.stages) {
    const matrix = simulator.runStageValidationMatrix(stage, programs, { frames: options.frames || stage.durationFrames });
    stageMatrices.push({ orientation: stage.orientation, ...matrix });
    if (!matrix.ok) return { ok: false, error: `${stage.orientation} stage: 自動負荷検証でresource dropが発生しました`, diagnostics: matrix.failures };
  }
  const symbols = snapshot.patterns.map((pattern) => `BIN bmlb_${pattern.id.replace(/-/g, '_')} "bulletml/generated/${pattern.id}.bmlb"`).join('\n');
  generated['res/bulletml.res'] = `${symbols}\n`;
  const proof = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sgdk: '2.11',
    abi: 'BMLB ABI v1',
    profile: snapshot.project.profile,
    projectSha256: schema.revisionFor(snapshot.project),
    patterns: proofPatterns,
    stages: snapshot.stages.map((stage) => {
      const matrix = stageMatrices.find((item) => item.orientation === stage.orientation);
      return {
        orientation: stage.orientation,
        sha256: schema.revisionFor(stage),
        events: stage.events.length,
        maxima: matrix.maxima,
        cases: matrix.cases.map((item) => ({ rank: item.rank, seed: item.seed, path: item.path, outcome: item.outcome, crc32: item.crc32 })),
      };
    }),
  };
  generated['data/bulletml/proof.json'] = schema.stableStringify(proof);
  for (const [relative, contents] of Object.entries(generated)) atomicWriteFile(resolveProjectPath(projectDir, relative), contents);
  return { ok: true, generatedFiles: Object.keys(generated), proof, matrices, stageMatrices, snapshot };
}

module.exports = {
  DATA_ROOT,
  PATTERN_ROOT,
  STAGE_ROOT,
  PROJECT_PATH,
  EDITOR_STATE_PATH,
  resolveProjectPath,
  atomicWriteFile,
  readJsonFile,
  readSnapshot,
  loadProject,
  saveProject,
  savePattern,
  deletePattern,
  restorePattern,
  importXml,
  exportXml,
  compilePattern,
  validateProject,
  loadStage,
  saveStage,
  startStagePreview,
  stepStagePreview,
  seekStagePreview,
  stopStagePreview,
  exportBuild,
};
