'use strict';

const manifest = require('./manifest.json');
const stageService = require('./stage-service');

function getProjectDir(context) {
  const projectDir = context?.projectDir;
  if (!projectDir) {
    throw new Error('projectDir is required');
  }
  return projectDir;
}

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('ブロック崩しステージエディタを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('ブロック崩しステージエディタを無効化しました');
  return { ok: true };
}

function listStages(_payload, context = {}) {
  try {
    return stageService.listStages(getProjectDir(context), context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function saveStage(payload, context = {}) {
  try {
    return stageService.saveStage(getProjectDir(context), payload || {}, context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function deleteStage(payload, context = {}) {
  try {
    return stageService.deleteStage(getProjectDir(context), payload || {}, context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function moveStage(payload, context = {}) {
  try {
    return stageService.moveStage(getProjectDir(context), payload || {}, context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function exportStageData(_payload, context = {}) {
  try {
    return stageService.exportStageData(getProjectDir(context), context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function listBlockSettings(_payload, context = {}) {
  try {
    return stageService.listBlockSettings(getProjectDir(context), context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function saveBlockSettings(payload, context = {}) {
  try {
    return stageService.saveBlockSettings(getProjectDir(context), payload || {}, context.assets || []);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  listStages,
  saveStage,
  deleteStage,
  moveStage,
  exportStageData,
  listBlockSettings,
  saveBlockSettings,
};
