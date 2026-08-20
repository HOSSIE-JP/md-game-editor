'use strict';

const manifest = require('./manifest.json');
const service = require('./novel-service');

function projectDir(context = {}) {
  if (!context.projectDir) throw new Error('projectDir is required');
  return context.projectDir;
}

function guarded(handler) {
  return async function invoke(payload = {}, context = {}) {
    try {
      return await handler(projectDir(context), payload || {}, context);
    } catch (error) {
      context.logger?.error?.(String(error?.stack || error));
      return { ok: false, error: String(error?.message || error) };
    }
  };
}

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('MDノベルエディターを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('MDノベルエディターを無効化しました');
  return { ok: true };
}

const loadMdNovelProject = guarded((root) => service.loadProject(root));
const saveMdNovelProject = guarded((root, payload) => service.saveProject(root, payload));
const importPceNovelProject = guarded((root, payload, context) => service.importPceProject(root, payload, context));
const validateMdNovelProject = guarded((root) => service.loadProject(root));

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  loadMdNovelProject,
  saveMdNovelProject,
  importPceNovelProject,
  validateMdNovelProject,
};
