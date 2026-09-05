'use strict';

const manifest = require('./manifest.json');
const service = require('./bulletml-service');

function projectDir(context = {}) {
  if (!context.projectDir) throw new Error('projectDir is required');
  return context.projectDir;
}

function guarded(handler) {
  return function invoke(payload = {}, context = {}) {
    try { return handler(projectDir(context), payload || {}, context); }
    catch (error) { return { ok: false, conflict: Boolean(error?.conflict), error: String(error?.message || error) }; }
  };
}

function getTab() { return manifest.tab; }
function onActivate(_payload, context = {}) { context.logger?.info?.('BulletML STG Studioを有効化しました'); return { ok: true }; }
function onDeactivate(_payload, context = {}) { context.logger?.info?.('BulletML STG Studioを無効化しました'); return { ok: true }; }

const loadBulletmlProject = guarded((root) => service.loadProject(root));
const saveBulletmlProject = guarded((root, payload) => service.saveProject(root, payload));
const saveBulletmlDocument = guarded((root, payload) => service.saveDocument(root, payload));
const saveBulletmlDemo = guarded((root, payload) => service.saveDemo(root, payload));
const deleteBulletmlDocumentEntry = guarded((root, payload) => service.deleteDocumentEntry(root, payload));
const restoreBulletmlDocumentEntry = guarded((root, payload) => service.restoreDocumentEntry(root, payload));
const saveBulletmlPattern = guarded((root, payload) => service.savePattern(root, payload));
const deleteBulletmlPattern = guarded((root, payload) => service.deletePattern(root, payload));
const restoreBulletmlPattern = guarded((root, payload) => service.restorePattern(root, payload));
const importBulletmlXml = guarded((root, payload) => service.importXml(root, payload));
const exportBulletmlXml = guarded((root, payload) => service.exportXml(root, payload));
const validateBulletmlProject = guarded((root, payload) => service.validateProject(root, payload));
const compileBulletmlPattern = guarded((root, payload) => service.compilePattern(root, payload));
const loadBulletmlStage = guarded((root, payload) => service.loadStage(root, payload));
const saveBulletmlStage = guarded((root, payload) => service.saveStage(root, payload));
const deleteBulletmlStage = guarded((root, payload) => service.deleteStage(root, payload));
const restoreBulletmlStage = guarded((root, payload) => service.restoreStage(root, payload));
const startBulletmlStagePreview = guarded((root, payload) => service.startStagePreview(root, payload));
const stepBulletmlStagePreview = guarded((root, payload) => service.stepStagePreview(root, payload));
const seekBulletmlStagePreview = guarded((root, payload) => service.seekStagePreview(root, payload));
const stopBulletmlStagePreview = guarded((root, payload) => service.stopStagePreview(root, payload));

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  loadBulletmlProject,
  saveBulletmlProject,
  saveBulletmlDocument,
  saveBulletmlDemo,
  deleteBulletmlDocumentEntry,
  restoreBulletmlDocumentEntry,
  saveBulletmlPattern,
  deleteBulletmlPattern,
  restoreBulletmlPattern,
  importBulletmlXml,
  exportBulletmlXml,
  validateBulletmlProject,
  compileBulletmlPattern,
  loadBulletmlStage,
  saveBulletmlStage,
  deleteBulletmlStage,
  restoreBulletmlStage,
  startBulletmlStagePreview,
  stepBulletmlStagePreview,
  seekBulletmlStagePreview,
  stopBulletmlStagePreview,
};
