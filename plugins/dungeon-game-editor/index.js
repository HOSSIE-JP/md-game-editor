'use strict';

const manifest = require('./manifest.json');
const dungeonService = require('./dungeon-service');

function getProjectDir(context) {
  const projectDir = context?.projectDir;
  if (!projectDir) throw new Error('projectDir is required');
  return projectDir;
}

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('ダンジョンゲームエディターを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('ダンジョンゲームエディターを無効化しました');
  return { ok: true };
}

function listDungeonFloors(_payload, context = {}) {
  try {
    return dungeonService.listFloors(getProjectDir(context));
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function saveDungeonFloor(payload, context = {}) {
  try {
    return dungeonService.saveFloor(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function deleteDungeonFloor(payload, context = {}) {
  try {
    return dungeonService.deleteFloor(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function moveDungeonFloor(payload, context = {}) {
  try {
    return dungeonService.moveFloor(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function generateDungeonFloor(payload, context = {}) {
  try {
    return dungeonService.generateFloor(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function exportDungeonData(payload, context = {}) {
  try {
    return dungeonService.exportDungeonData(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function listDungeonSettings(_payload, context = {}) {
  try {
    return dungeonService.listSettings(getProjectDir(context));
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function saveDungeonSettings(payload, context = {}) {
  try {
    return dungeonService.saveSettings(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  listDungeonFloors,
  saveDungeonFloor,
  deleteDungeonFloor,
  moveDungeonFloor,
  generateDungeonFloor,
  exportDungeonData,
  listDungeonSettings,
  saveDungeonSettings,
};
