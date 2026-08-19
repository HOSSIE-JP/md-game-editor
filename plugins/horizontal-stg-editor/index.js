'use strict';

const manifest = require('./manifest.json');
const service = require('./horizontal-stg-service');

function projectDir(context = {}) {
  if (!context.projectDir) throw new Error('projectDir is required');
  return context.projectDir;
}

function guarded(handler) {
  return function invoke(payload = {}, context = {}) {
    try {
      return handler(projectDir(context), payload || {}, context);
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  };
}

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('横スクロールSTGエディターを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('横スクロールSTGエディターを無効化しました');
  return { ok: true };
}

const loadHorizontalStgProject = guarded((root) => service.loadProject(root));
const saveHorizontalStgDocument = guarded((root, payload) => service.saveDocument(root, payload));
const deleteHorizontalStgEntity = guarded((root, payload) => service.deleteEntity(root, payload));
const reorderHorizontalStgStages = guarded((root, payload) => service.reorderStages(root, payload));
const validateHorizontalStgProject = guarded((root) => service.validateProject(root));
const exportHorizontalStgData = guarded((root) => service.exportProject(root));

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  loadHorizontalStgProject,
  saveHorizontalStgDocument,
  deleteHorizontalStgEntity,
  reorderHorizontalStgStages,
  validateHorizontalStgProject,
  exportHorizontalStgData,
};
