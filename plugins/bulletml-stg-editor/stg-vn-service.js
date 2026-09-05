'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharedVn = require('../shared/md-vn');

function resolveInside(projectDir, relativePath) {
  const root = path.resolve(projectDir);
  const target = path.resolve(root, String(relativePath || '').replace(/\\/g, '/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return target;
    throw new Error(`VN scene path escapes project: ${relativePath}`);
  }
  return target;
}

function readCanonicalSceneDocument(projectDir, demoBindings) {
  const relativePath = String(demoBindings?.canonicalSceneDocument || 'assets/pce-vn-scenes.json');
  if (relativePath !== 'assets/pce-vn-scenes.json') throw new Error('BulletML Demos canonical sceneはassets/pce-vn-scenes.json固定です');
  const target = resolveInside(projectDir, relativePath);
  if (!fs.existsSync(target)) throw new Error(`${relativePath} がありません`);
  let sceneDocument;
  try { sceneDocument = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { throw new Error(`${relativePath}: JSON parse error: ${error.message}`); }
  return { sceneDocument, relativePath, target };
}

function validateDemoBindings(projectDir, snapshot) {
  const diagnostics = [];
  let canonical = null;
  try { canonical = readCanonicalSceneDocument(projectDir, snapshot.demoBindings); }
  catch (error) {
    diagnostics.push({ severity: 'error', code: 'STG_VN_SCENE_DOCUMENT', path: 'demoBindings.canonicalSceneDocument', message: error.message });
    return { ok: false, diagnostics, canonical: null };
  }
  const validation = sharedVn.validateCanonicalSceneDocument(canonical.sceneDocument, null);
  diagnostics.push(...validation.diagnostics.map((item) => ({ ...item, code: `STG_VN_${String(item.code || 'INVALID').toUpperCase().replace(/-/g, '_')}`, path: `assets/pce-vn-scenes.json.${item.path || ''}` })));
  const sceneIds = new Set((canonical.sceneDocument.scenes || []).map((scene) => String(scene.id || '')));
  const requireScene = (id, pathLabel, required = true) => {
    if (!id && required) diagnostics.push({ severity: 'error', code: 'STG_VN_BINDING_REQUIRED', path: pathLabel, message: 'Demo scene bindingが必要です' });
    else if (id && !sceneIds.has(id)) diagnostics.push({ severity: 'error', code: 'STG_VN_BINDING_MISSING', path: pathLabel, message: `sceneがありません: ${id}` });
  };
  requireScene(snapshot.demoBindings.opening, 'demoBindings.opening');
  requireScene(snapshot.demoBindings.endings?.rescue, 'demoBindings.endings.rescue');
  requireScene(snapshot.demoBindings.endings?.destroy, 'demoBindings.endings.destroy');
  const endingFlag = String(snapshot.demoBindings.endingSelector?.flag || '');
  if (!endingFlag) diagnostics.push({ severity: 'error', code: 'STG_VN_ENDING_SELECTOR', path: 'demoBindings.endingSelector.flag', message: 'Ending分岐に使うflagが必要です' });
  else if (!(snapshot.demoBindings.flags || []).includes(endingFlag)) diagnostics.push({ severity: 'error', code: 'STG_VN_ENDING_SELECTOR_FLAG', path: 'demoBindings.endingSelector.flag', message: `flagsに登録されていません: ${endingFlag}` });
  const campaignIds = new Set((snapshot.stages || []).filter((stage) => stage.id !== snapshot.project.caravan.stageId).map((stage) => stage.id));
  for (const stageId of campaignIds) {
    const binding = snapshot.demoBindings.stages?.[stageId];
    if (!binding) diagnostics.push({ severity: 'error', code: 'STG_VN_STAGE_BINDING', path: `demoBindings.stages.${stageId}`, message: 'Campaign stageのpre/post Demo bindingが必要です' });
    else {
      requireScene(binding.pre, `demoBindings.stages.${stageId}.pre`);
      requireScene(binding.post, `demoBindings.stages.${stageId}.post`);
    }
  }
  for (const [stageId, binding] of Object.entries(snapshot.demoBindings.stages || {})) {
    if (!campaignIds.has(stageId)) diagnostics.push({ severity: 'warning', code: 'STG_VN_STAGE_UNUSED', path: `demoBindings.stages.${stageId}`, message: `存在しない/Caravan stageへのDemo bindingです: ${stageId}` });
    requireScene(binding?.pre, `demoBindings.stages.${stageId}.pre`, false);
    requireScene(binding?.post, `demoBindings.stages.${stageId}.post`, false);
  }
  return { ok: !diagnostics.some((item) => item.severity === 'error'), diagnostics, canonical, validation };
}

function validateSceneDocument(sceneDocument) {
  const validation = sharedVn.validateCanonicalSceneDocument(sceneDocument, null);
  const diagnostics = (validation.diagnostics || []).map((item) => ({
    ...item,
    code: `STG_VN_${String(item.code || 'INVALID').toUpperCase().replace(/-/g, '_')}`,
    path: `assets/pce-vn-scenes.json.${item.path || ''}`,
  }));
  return {
    ...validation,
    ok: !diagnostics.some((item) => item.severity === 'error'),
    diagnostics,
  };
}

module.exports = {
  resolveInside,
  readCanonicalSceneDocument,
  validateSceneDocument,
  validateDemoBindings,
};
