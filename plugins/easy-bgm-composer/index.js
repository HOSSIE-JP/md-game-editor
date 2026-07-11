'use strict';

const manifest = require('./manifest.json');
const service = require('./easy-bgm-service');

function getProjectDir(context) {
  const projectDir = context?.projectDir;
  if (!projectDir) throw new Error('projectDir is required');
  return projectDir;
}

function getTab() {
  return manifest.tab;
}

function onActivate(_payload, context = {}) {
  context.logger?.info?.('かんたん作曲プラグインを有効化しました');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context.logger?.info?.('かんたん作曲プラグインを無効化しました');
  return { ok: true };
}

function listEasyDefs(_payload, _context = {}) {
  try {
    return service.getDefs();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function listEasySongs(_payload, context = {}) {
  try {
    return service.listSongs(getProjectDir(context));
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function loadEasySong(payload, context = {}) {
  try {
    return service.loadSong(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function saveEasySong(payload, context = {}) {
  try {
    return service.saveSong(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function deleteEasySong(payload, context = {}) {
  try {
    return service.deleteSong(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function composeEasySong(payload, _context = {}) {
  try {
    return service.composeSong(payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function previewEasySong(payload, _context = {}) {
  try {
    return service.previewSong(payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function exportEasySongToGame(payload, context = {}) {
  try {
    return service.exportToGame(getProjectDir(context), payload || {});
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
  listEasyDefs,
  listEasySongs,
  loadEasySong,
  saveEasySong,
  deleteEasySong,
  composeEasySong,
  previewEasySong,
  exportEasySongToGame,
};
