'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const schema = require('./horizontal-stg-schema');

const DATA_ROOT = path.join('data', 'horizontal-stg');
const DEFINITIONS_ROOT = path.join(DATA_ROOT, 'definitions');

const DOCUMENT_PATHS = Object.freeze({
  project: path.join(DATA_ROOT, 'project.json'),
  flow: path.join(DATA_ROOT, 'flow.json'),
  enemies: path.join(DEFINITIONS_ROOT, 'enemies.json'),
  bosses: path.join(DEFINITIONS_ROOT, 'bosses.json'),
  weapons: path.join(DEFINITIONS_ROOT, 'weapons.json'),
  items: path.join(DEFINITIONS_ROOT, 'items.json'),
  effects: path.join(DEFINITIONS_ROOT, 'effects.json'),
  audio: path.join(DEFINITIONS_ROOT, 'audio.json'),
  id_registry: path.join(DATA_ROOT, 'id-registry.json'),
});

const COLLECTION_WRAPPERS = Object.freeze({
  enemies: 'enemies',
  bosses: 'bosses',
  weapons: 'weapons',
  items: 'items',
  effects: 'effects',
  audio: 'cues',
});

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
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('project-relative path is required');
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => part === '..')) throw new Error(`path traversal is not allowed: ${relativePath}`);
  const resolved = path.resolve(root, normalized);
  if (!isInside(root, resolved)) throw new Error(`path escapes project: ${relativePath}`);
  return resolved;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return schema.deepClone(fallback);
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath}: JSONの解析に失敗しました: ${error.message}`);
  }
}

function atomicWriteFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const tempPath = `${filePath}.${suffix}.tmp`;
  const backupPath = `${filePath}.${suffix}.bak`;
  fs.writeFileSync(tempPath, contents, 'utf8');
  let movedOriginal = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupPath);
      movedOriginal = true;
    }
    fs.renameSync(tempPath, filePath);
    if (movedOriginal && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (movedOriginal && fs.existsSync(backupPath) && !fs.existsSync(filePath)) fs.renameSync(backupPath, filePath);
    throw error;
  }
}

function writeJsonFile(filePath, value) {
  atomicWriteFile(filePath, schema.stableStringify(value));
}

function stageDirectory(projectDir) {
  return resolveProjectPath(projectDir, path.join(DATA_ROOT, 'stages'));
}

function listStageFiles(projectDir) {
  const dir = stageDirectory(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function readCollection(projectDir, kind) {
  const wrapper = COLLECTION_WRAPPERS[kind];
  const filePath = resolveProjectPath(projectDir, DOCUMENT_PATHS[kind]);
  const raw = readJsonFile(filePath, { schema_version: schema.SCHEMA_VERSION, [wrapper]: [] });
  return schema.normalizeCollection(raw, wrapper);
}

function readSnapshot(projectDir) {
  const root = assertProjectDir(projectDir);
  const project = readJsonFile(resolveProjectPath(root, DOCUMENT_PATHS.project), schema.DEFAULT_PROJECT);
  const flow = readJsonFile(resolveProjectPath(root, DOCUMENT_PATHS.flow), { schema_version: schema.SCHEMA_VERSION, screens: [] });
  const idRegistry = readJsonFile(resolveProjectPath(root, DOCUMENT_PATHS.id_registry), { schema_version: schema.SCHEMA_VERSION, namespaces: {} });
  const stages = listStageFiles(root).map((filePath, index) => schema.normalizeStage(readJsonFile(filePath, {}), `stage-${String(index + 1).padStart(2, '0')}`));
  return schema.normalizeSnapshot({
    project,
    flow,
    enemies: readCollection(root, 'enemies'),
    bosses: readCollection(root, 'bosses'),
    weapons: readCollection(root, 'weapons'),
    items: readCollection(root, 'items'),
    effects: readCollection(root, 'effects'),
    audio: readCollection(root, 'audio'),
    stages,
    id_registry: idRegistry,
  });
}

function documentRevision(snapshot, kind, id = '') {
  if (kind === 'stage') {
    const stage = snapshot.stages.find((entry) => entry.id === schema.safeId(id));
    return stage ? schema.revisionFor(stage) : '';
  }
  return schema.revisionFor(snapshot[kind]);
}

function revisionsFor(snapshot) {
  const revisions = {};
  schema.DOCUMENT_KINDS.filter((kind) => kind !== 'stage').forEach((kind) => {
    revisions[kind] = documentRevision(snapshot, kind);
  });
  revisions.stages = Object.fromEntries(snapshot.stages.map((stage) => [stage.id, schema.revisionFor(stage)]));
  revisions.id_registry = schema.revisionFor(snapshot.id_registry);
  return revisions;
}

function publicSnapshot(snapshot) {
  return {
    ...schema.deepClone(snapshot),
    revisions: revisionsFor(snapshot),
  };
}

function loadProject(projectDir) {
  try {
    const snapshot = readSnapshot(projectDir);
    const assigned = schema.assignRuntimeIds(snapshot);
    const validation = schema.validateSnapshot(assigned);
    return {
      ok: true,
      snapshot: publicSnapshot(assigned),
      validation: {
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
        diagnostics: validation.diagnostics,
      },
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function documentFile(projectDir, kind, id = '') {
  if (kind === 'stage') {
    const safeStageId = schema.safeId(id);
    if (!safeStageId) throw new Error('stage id is required');
    return resolveProjectPath(projectDir, path.join(DATA_ROOT, 'stages', `${safeStageId}.json`));
  }
  if (!DOCUMENT_PATHS[kind]) throw new Error(`unsupported document kind: ${kind}`);
  return resolveProjectPath(projectDir, DOCUMENT_PATHS[kind]);
}

function serializeDocument(kind, data) {
  if (kind === 'project') return schema.normalizeProject(data);
  if (kind === 'flow') return { ...(data && typeof data === 'object' ? schema.deepClone(data) : {}), schema_version: schema.SCHEMA_VERSION };
  if (kind === 'stage') return schema.normalizeStage(data, data?.id);
  const wrapper = COLLECTION_WRAPPERS[kind];
  if (!wrapper) throw new Error(`unsupported document kind: ${kind}`);
  return { schema_version: schema.SCHEMA_VERSION, [wrapper]: schema.normalizeCollection(data, wrapper) };
}

function applyDocument(snapshot, kind, id, data) {
  const next = schema.deepClone(snapshot);
  if (kind === 'stage') {
    const normalized = schema.normalizeStage(data, id);
    const existingIndex = next.stages.findIndex((entry) => entry.id === schema.safeId(id || normalized.id));
    if (existingIndex >= 0) next.stages[existingIndex] = normalized;
    else next.stages.push(normalized);
    if (!next.project.stage_order.includes(normalized.id)) next.project.stage_order.push(normalized.id);
    if (!next.project.first_stage_id) next.project.first_stage_id = normalized.id;
  } else if (kind === 'project') {
    next.project = schema.normalizeProject(data);
  } else if (kind === 'flow') {
    next.flow = serializeDocument(kind, data);
  } else {
    const wrapper = COLLECTION_WRAPPERS[kind];
    next[kind] = schema.normalizeCollection(data, wrapper);
  }
  return schema.assignRuntimeIds(next);
}

function writeRegistry(projectDir, registry) {
  writeJsonFile(documentFile(projectDir, 'id_registry'), registry);
}

function saveDocument(projectDir, payload = {}) {
  try {
    const kind = String(payload.kind || '');
    if (!schema.DOCUMENT_KINDS.includes(kind)) throw new Error(`unsupported document kind: ${kind}`);
    const id = schema.safeId(payload.id || payload.data?.id);
    const current = readSnapshot(projectDir);
    const currentRevision = documentRevision(current, kind, id);
    if (payload.baseRevision && payload.baseRevision !== currentRevision) {
      return {
        ok: false,
        conflict: true,
        error: '別の変更が保存されています。再読込してからやり直してください。',
        currentRevision,
      };
    }
    const next = applyDocument(current, kind, id, payload.data);
    const validation = schema.validateSnapshot(next);
    if (!validation.ok) {
      return { ok: false, error: '横STGデータにエラーがあります', errors: validation.errors, warnings: validation.warnings };
    }
    const stored = serializeDocument(kind, kind === 'stage' ? next.stages.find((stage) => stage.id === schema.safeId(payload.data?.id || id)) : next[kind]);
    writeJsonFile(documentFile(projectDir, kind, kind === 'stage' ? stored.id : id), stored);
    writeRegistry(projectDir, next.id_registry);
    if (kind === 'stage' && current.project.stage_order.join('\0') !== next.project.stage_order.join('\0')) {
      writeJsonFile(documentFile(projectDir, 'project'), next.project);
    }
    const reloaded = schema.assignRuntimeIds(readSnapshot(projectDir));
    return {
      ok: true,
      kind,
      id: kind === 'stage' ? stored.id : '',
      revision: documentRevision(reloaded, kind, kind === 'stage' ? stored.id : ''),
      snapshot: publicSnapshot(reloaded),
      warnings: validation.warnings,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function deleteEntity(projectDir, payload = {}) {
  try {
    const kind = String(payload.kind || '');
    const id = schema.safeId(payload.id);
    if (!id) throw new Error('id is required');
    const current = readSnapshot(projectDir);
    const currentRevision = documentRevision(current, kind === 'stage' ? 'stage' : kind, id);
    if (payload.baseRevision && payload.baseRevision !== currentRevision) {
      return { ok: false, conflict: true, error: '別の変更が保存されています。再読込してください。', currentRevision };
    }
    const next = schema.deepClone(current);
    if (kind === 'stage') {
      if (next.stages.length <= 1) throw new Error('最後のstageは削除できません');
      const index = next.stages.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error(`stage '${id}' が見つかりません`);
      next.stages.splice(index, 1);
      next.project.stage_order = next.project.stage_order.filter((stageId) => stageId !== id);
      if (next.project.first_stage_id === id) next.project.first_stage_id = next.project.stage_order[0] || next.stages[0].id;
    } else if (COLLECTION_WRAPPERS[kind]) {
      const index = next[kind].findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error(`${kind} '${id}' が見つかりません`);
      next[kind].splice(index, 1);
    } else {
      throw new Error(`unsupported entity kind: ${kind}`);
    }
    const validation = schema.validateSnapshot(schema.assignRuntimeIds(next));
    if (!validation.ok) return { ok: false, error: '参照中のentityは削除できません', errors: validation.errors };
    if (kind === 'stage') {
      const filePath = documentFile(projectDir, 'stage', id);
      const deletedPath = `${filePath}.deleted`;
      if (fs.existsSync(deletedPath)) fs.unlinkSync(deletedPath);
      fs.renameSync(filePath, deletedPath);
      writeJsonFile(documentFile(projectDir, 'project'), next.project);
    } else {
      writeJsonFile(documentFile(projectDir, kind), serializeDocument(kind, next[kind]));
    }
    return { ok: true, snapshot: publicSnapshot(schema.assignRuntimeIds(readSnapshot(projectDir))) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function reorderStages(projectDir, payload = {}) {
  try {
    const current = readSnapshot(projectDir);
    const currentRevision = documentRevision(current, 'project');
    if (payload.baseRevision && payload.baseRevision !== currentRevision) {
      return { ok: false, conflict: true, error: 'stage順序が別の変更と競合しました', currentRevision };
    }
    const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => schema.safeId(id)).filter(Boolean) : [];
    const expected = current.stages.map((stage) => stage.id).sort();
    if (ids.length !== expected.length || ids.slice().sort().join('\0') !== expected.join('\0')) {
      throw new Error('ids must contain every stage exactly once');
    }
    current.project.stage_order = ids;
    current.project.first_stage_id = ids[0];
    writeJsonFile(documentFile(projectDir, 'project'), current.project);
    return { ok: true, stage_order: ids, revision: schema.revisionFor(current.project) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function inspectIndexedPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 33 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('PNGではありません');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let paletteEntries = 0;
  let hasTransparency = false;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length + 4 > buffer.length) throw new Error('PNG chunkが破損しています');
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === 'PLTE') {
      paletteEntries = Math.floor(length / 3);
    } else if (type === 'tRNS') {
      hasTransparency = length > 0;
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }
  const usedIndices = new Set();
  let raw = null;
  if (colorType === 3 && bitDepth === 8 && width > 0 && height > 0 && idat.length) {
    const inflated = zlib.inflateSync(Buffer.concat(idat));
    const stride = width;
    raw = Buffer.alloc(height * stride);
    let inputOffset = 0;
    for (let y = 0; y < height; y++) {
      const filter = inflated[inputOffset++];
      const rowStart = y * stride;
      const previousStart = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const source = inflated[inputOffset++];
        const a = x > 0 ? raw[rowStart + x - 1] : 0;
        const b = y > 0 ? raw[previousStart + x] : 0;
        const c = y > 0 && x > 0 ? raw[previousStart + x - 1] : 0;
        let value = source;
        if (filter === 1) value += a;
        else if (filter === 2) value += b;
        else if (filter === 3) value += Math.floor((a + b) / 2);
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        } else if (filter !== 0) throw new Error(`未対応PNG filterです: ${filter}`);
        raw[rowStart + x] = value & 0xFF;
        usedIndices.add(raw[rowStart + x]);
      }
    }
  }
  let fourByFourBlockCount = 0;
  let uniformFourByFourBlockCount = 0;
  if (raw && (width % 4) === 0 && (height % 4) === 0) {
    for (let blockY = 0; blockY < height; blockY += 4) {
      for (let blockX = 0; blockX < width; blockX += 4) {
        const expected = raw[(blockY * width) + blockX];
        let uniform = true;
        fourByFourBlockCount++;
        for (let y = 0; y < 4 && uniform; y++) {
          for (let x = 0; x < 4; x++) {
            if (raw[((blockY + y) * width) + blockX + x] !== expected) {
              uniform = false;
              break;
            }
          }
        }
        if (uniform) uniformFourByFourBlockCount++;
      }
    }
  }
  let totalTileCount = 0;
  let detailedTileCount = 0;
  const tilePatterns = new Set();
  const optimizedTilePatterns = new Set();
  if (raw && (width % 8) === 0 && (height % 8) === 0) {
    totalTileCount = (width / 8) * (height / 8);
    for (let tileY = 0; tileY < height; tileY += 8) {
      for (let tileX = 0; tileX < width; tileX += 8) {
        const tile = Buffer.alloc(64);
        const tileIndices = new Set();
        let tileOffset = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const value = raw[((tileY + y) * width) + tileX + x];
            tile[tileOffset++] = value;
            tileIndices.add(value);
          }
        }
        tilePatterns.add(tile.toString('hex'));
        const flipVariants = [Buffer.alloc(64), Buffer.alloc(64), Buffer.alloc(64), Buffer.alloc(64)];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const destination = (y * 8) + x;
            flipVariants[0][destination] = tile[(y * 8) + x];
            flipVariants[1][destination] = tile[(y * 8) + (7 - x)];
            flipVariants[2][destination] = tile[((7 - y) * 8) + x];
            flipVariants[3][destination] = tile[((7 - y) * 8) + (7 - x)];
          }
        }
        optimizedTilePatterns.add(flipVariants.map((variant) => variant.toString('hex')).sort()[0]);
        if (tileIndices.size >= 3) detailedTileCount++;
      }
    }
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    paletteEntries,
    usedPaletteEntries: usedIndices.size,
    maxPaletteIndex: usedIndices.size ? Math.max(...usedIndices) : -1,
    hasTransparency,
    fourByFourBlockCount,
    uniformFourByFourBlockCount,
    uniformFourByFourRatio: fourByFourBlockCount ? uniformFourByFourBlockCount / fourByFourBlockCount : 0,
    totalTileCount,
    uniqueTilePatterns: tilePatterns.size,
    optimizedTilePatterns: optimizedTilePatterns.size,
    detailedTileCount,
    detailedTileRatio: totalTileCount ? detailedTileCount / totalTileCount : 0,
  };
}

function validateAssets(projectDir, snapshot) {
  const diagnostics = [];
  const checked = new Map();
  function checkImage(relativePath, logicalPath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    if (!normalized) return;
    if (checked.has(normalized)) return;
    try {
      const filePath = resolveProjectPath(projectDir, path.join('res', normalized));
      if (!fs.existsSync(filePath)) throw new Error('ファイルがありません');
      const inspection = inspectIndexedPng(filePath);
      if (inspection.colorType !== 3) throw new Error('indexed PNG (color type 3) ではありません');
      if (inspection.bitDepth !== 8) throw new Error('8bit indexed PNGではありません');
      if (inspection.interlace !== 0) throw new Error('interlace PNGには対応していません');
      if (inspection.usedPaletteEntries < 1 || inspection.usedPaletteEntries > 16) throw new Error(`実使用色数が${inspection.usedPaletteEntries}色です (1～16色必須)`);
      if ((inspection.width % 8) !== 0 || (inspection.height % 8) !== 0) throw new Error('幅と高さは8pxの倍数にしてください');
      checked.set(normalized, inspection);
    } catch (error) {
      diagnostics.push({ code: 'STG_ASSET_IMAGE_INVALID', path: logicalPath, message: `${normalized}: ${error.message}`, severity: 'error' });
    }
  }
  snapshot.stages.forEach((stage, index) => {
    checkImage(stage.assets.bg_a, `stages[${index}].assets.bg_a`);
    checkImage(stage.assets.bg_b, `stages[${index}].assets.bg_b`);
  });
  Object.entries(snapshot.project.assets || {}).forEach(([key, relativePath]) => {
    checkImage(relativePath, `project.assets.${key}`);
  });
  snapshot.stages.forEach((stage, index) => {
    const bgAPath = String(stage.assets.bg_a || '').replace(/\\/g, '/');
    const bgBPath = String(stage.assets.bg_b || '').replace(/\\/g, '/');
    const bgA = checked.get(bgAPath);
    const bgB = checked.get(bgBPath);
    if (!bgA || !bgB) return;
    const requiredTiles = 18 + bgA.optimizedTilePatterns + bgB.optimizedTilePatterns;
    if (requiredTiles > 1500) {
      diagnostics.push({
        code: 'STG_ASSET_BACKGROUND_VRAM',
        path: `stages[${index}].assets`,
        message: `HUDを含む背景タイルが${requiredTiles}枚です (安全上限1500枚)`,
        severity: 'error',
      });
    }
    const backgroundPatterns = bgA.optimizedTilePatterns + bgB.optimizedTilePatterns;
    if (backgroundPatterns < 160) {
      diagnostics.push({
        code: 'STG_ASSET_BACKGROUND_LOW_VARIETY',
        path: `stages[${index}].assets`,
        message: `背景の実効タイルパターンが${backgroundPatterns}枚です (MD完成版の目安160枚以上)`,
        severity: 'warning',
      });
    }
    const totalTiles = bgA.totalTileCount + bgB.totalTileCount;
    const detailRatio = totalTiles ? (bgA.detailedTileCount + bgB.detailedTileCount) / totalTiles : 0;
    if (detailRatio < 0.18) {
      diagnostics.push({
        code: 'STG_ASSET_BACKGROUND_LOW_DETAIL',
        path: `stages[${index}].assets`,
        message: `3色以上を使う背景タイルが${Math.round(detailRatio * 100)}%です (目安18%以上)`,
        severity: 'warning',
      });
    }
  });
  snapshot.enemies.forEach((enemy, index) => {
    if (enemy.sprite) checkImage(enemy.sprite, `enemies[${index}].sprite`);
  });
  snapshot.bosses.forEach((boss, index) => {
    if (boss.sprite) checkImage(boss.sprite, `bosses[${index}].sprite`);
  });
  snapshot.audio.filter((cue) => cue.path).forEach((cue, index) => {
    try {
      const filePath = resolveProjectPath(projectDir, path.join('res', cue.path));
      if (!fs.existsSync(filePath)) throw new Error('ファイルがありません');
    } catch (error) {
      diagnostics.push({ code: 'STG_ASSET_AUDIO_INVALID', path: `audio[${index}].path`, message: `${cue.path}: ${error.message}`, severity: 'error' });
    }
  });
  return { diagnostics, inspectedImages: Object.fromEntries(checked) };
}

function validateProject(projectDir) {
  try {
    const snapshot = schema.assignRuntimeIds(readSnapshot(projectDir));
    const validation = schema.validateSnapshot(snapshot);
    const assets = validateAssets(projectDir, snapshot);
    const diagnostics = [...validation.diagnostics, ...assets.diagnostics];
    return {
      ok: diagnostics.every((entry) => entry.severity !== 'error'),
      errors: diagnostics.filter((entry) => entry.severity === 'error'),
      warnings: diagnostics.filter((entry) => entry.severity === 'warning'),
      diagnostics,
      report: {
        counts: {
          stages: snapshot.stages.length,
          enemies: snapshot.enemies.length,
          bosses: snapshot.bosses.length,
          events: snapshot.stages.reduce((sum, stage) => sum + stage.events.length, 0),
        },
        inspected_images: assets.inspectedImages,
        pools: snapshot.project.pools,
        rom: snapshot.project.rom,
      },
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), errors: [{ code: 'STG_VALIDATE_EXCEPTION', path: '', message: String(error?.message || error), severity: 'error' }], warnings: [], diagnostics: [] };
  }
}

function exportProject(projectDir) {
  try {
    const snapshot = schema.assignRuntimeIds(readSnapshot(projectDir));
    const validation = validateProject(projectDir);
    if (!validation.ok) {
      return { ok: false, error: '横STGプロジェクトの検証に失敗しました', errors: validation.errors, warnings: validation.warnings };
    }
    const generated = schema.generateFiles(snapshot);
    if (!generated.ok) return generated;
    Object.entries(generated.files).forEach(([relativePath, contents]) => {
      atomicWriteFile(resolveProjectPath(projectDir, relativePath), contents);
    });
    writeRegistry(projectDir, generated.snapshot.id_registry);
    return {
      ok: true,
      generated_files: Object.keys(generated.files).sort(),
      source_files: Object.keys(generated.files).filter((file) => file.startsWith('src/') && file.endsWith('.c')).sort(),
      report: generated.report,
      warnings: validation.warnings,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

module.exports = {
  DATA_ROOT,
  DOCUMENT_PATHS,
  COLLECTION_WRAPPERS,
  resolveProjectPath,
  inspectIndexedPng,
  readSnapshot,
  loadProject,
  saveDocument,
  deleteEntity,
  reorderStages,
  validateProject,
  exportProject,
  atomicWriteFile,
};
