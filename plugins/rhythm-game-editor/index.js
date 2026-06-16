'use strict';

const path = require('path');
const manifest = require('./manifest.json');
const rhythmService = require('./rhythm-service');

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('リズムゲームエディターを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('リズムゲームエディターを無効化しました');
  return { ok: true };
}

function listRhythmSongs(payload, context = {}) {
  return rhythmService.listSongs(payload || {}, context);
}

function saveRhythmSong(payload, context = {}) {
  return rhythmService.saveSong(payload || {}, context);
}

function deleteRhythmSong(payload, context = {}) {
  return rhythmService.deleteSong(payload || {}, context);
}

function moveRhythmSong(payload, context = {}) {
  return rhythmService.moveSong(payload || {}, context);
}

function listRhythmSettings(payload, context = {}) {
  return rhythmService.listSettings(payload || {}, context);
}

function saveRhythmSettings(payload, context = {}) {
  return rhythmService.saveSettings(payload || {}, context);
}

function exportRhythmData(payload, context = {}) {
  return rhythmService.exportRhythmData({
    templateRoot: path.join(__dirname, '..', 'rhythm-game-builder', 'template'),
    ...(payload || {}),
  }, context);
}

function validateRhythmProject(payload, context = {}) {
  return rhythmService.validateRhythmProject(payload || {}, context);
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  listRhythmSongs,
  saveRhythmSong,
  deleteRhythmSong,
  moveRhythmSong,
  listRhythmSettings,
  saveRhythmSettings,
  exportRhythmData,
  validateRhythmProject,
};
