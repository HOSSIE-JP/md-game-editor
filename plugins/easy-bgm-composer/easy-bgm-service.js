'use strict';

const fs = require('fs');
const path = require('path');
const compose = require('./compose-core');
const vgmRender = require('./vgm-render');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function getSongsDir(projectDir) {
  return path.join(projectDir, 'data', 'easy-bgm', 'songs');
}

function isSafeId(id) {
  return /^[A-Za-z0-9_-]+$/.test(String(id || ''));
}

function ensureProjectPath(projectDir, relPath) {
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('プロジェクト外への書き込みはできません。');
  }
  return abs;
}

function normalizeSymbolName(value, fallback = 'easy_bgm') {
  let symbol = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!symbol) symbol = fallback;
  if (/^[0-9]/.test(symbol)) symbol = `bgm_${symbol}`;
  return symbol;
}

function songSummary(song) {
  return {
    id: song.id,
    name: song.name,
    themeId: song.themeId,
    bars: song.bars,
    tempo: song.tempo,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
    lastExport: song.lastExport,
  };
}

function getDefs() {
  return { ok: true, defs: compose.getDefs() };
}

function listSongs(projectDir) {
  const songsDir = getSongsDir(projectDir);
  if (!fs.existsSync(songsDir)) return { ok: true, songs: [] };
  const songs = fs.readdirSync(songsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson(path.join(songsDir, file), null))
    .filter(Boolean)
    .map((raw) => songSummary(compose.normalizeEasySong(raw)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { ok: true, songs };
}

function loadSong(projectDir, payload = {}) {
  const id = String(payload.id || '');
  if (!isSafeId(id)) return { ok: false, error: '曲IDが不正です。' };
  const filePath = path.join(getSongsDir(projectDir), `${id}.json`);
  if (!fs.existsSync(filePath)) return { ok: false, error: '曲が見つかりません。' };
  const raw = readJson(filePath, null);
  if (!raw) return { ok: false, error: '曲データを読み込めませんでした。' };
  return { ok: true, song: compose.normalizeEasySong({ ...raw, id }) };
}

function saveSong(projectDir, payload = {}) {
  const song = compose.normalizeEasySong(payload.song || {});
  song.updatedAt = new Date().toISOString();
  writeJson(path.join(getSongsDir(projectDir), `${song.id}.json`), song);
  return { ok: true, song };
}

function deleteSong(projectDir, payload = {}) {
  const id = String(payload.id || '');
  if (!isSafeId(id)) return { ok: false, error: '曲IDが不正です。' };
  const filePath = path.join(getSongsDir(projectDir), `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return { ok: true, id };
}

function composeSong(payload = {}) {
  return { ok: true, song: compose.composeEasySong(payload) };
}

function previewSong(payload = {}) {
  const preview = vgmRender.easySongToPreviewDataUrl(payload.song || {}, {
    loop: payload.loop,
  });
  return { ok: true, ...preview };
}

function exportToGame(projectDir, payload = {}) {
  const song = compose.normalizeEasySong(payload.song || {});
  const symbol = normalizeSymbolName(payload.symbol || song.name);
  const subdir = String(payload.targetSubdir || 'music')
    .replace(/\\/g, '/')
    .replace(/[^A-Za-z0-9_./-]+/g, '_')
    .replace(/^\.+\/?/, '') || 'music';

  const vgmRel = `res/${subdir}/${symbol}.vgm`;
  const jsonRel = `res/${subdir}/${symbol}.mdbgm.json`;
  const vgmPath = ensureProjectPath(projectDir, vgmRel);
  const jsonPath = ensureProjectPath(projectDir, jsonRel);
  ensureDir(path.dirname(vgmPath));

  fs.writeFileSync(vgmPath, vgmRender.easySongToVgm(song));
  const trackerSong = vgmRender.easySongToTrackerSong(song, { symbol });
  fs.writeFileSync(jsonPath, `${JSON.stringify(trackerSong, null, 2)}\n`, 'utf-8');

  return {
    ok: true,
    symbol,
    files: { vgm: vgmRel, json: jsonRel },
    asset: {
      type: 'XGM2',
      name: symbol,
      sourcePath: `${subdir}/${symbol}.vgm`,
      files: [`${subdir}/${symbol}.vgm`],
      options: '',
    },
  };
}

module.exports = {
  getSongsDir,
  ensureProjectPath,
  normalizeSymbolName,
  getDefs,
  listSongs,
  loadSong,
  saveSong,
  deleteSong,
  composeSong,
  previewSong,
  exportToGame,
};
