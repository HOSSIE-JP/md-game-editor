'use strict';

const fs = require('fs');
const path = require('path');

const GRID_ROWS = 24;
const GRID_COLS = 15;
const BLOCK_NAMES = [
  'BLOCK_EMPTY',
  'BLOCK_WHITE',
  'BLOCK_YELLOW',
  'BLOCK_GREEN',
  'BLOCK_BLUE',
  'BLOCK_GRAY',
];
const POWERUP_NAMES = {
  0: 'POWERUP_NONE',
  1: 'POWERUP_MULTI_BALL',
  2: 'POWERUP_STRONG',
  3: 'POWERUP_SPEED_UP',
  4: 'POWERUP_BARRIER',
  multi_ball: 'POWERUP_MULTI_BALL',
  strong: 'POWERUP_STRONG',
  speed_up: 'POWERUP_SPEED_UP',
  barrier: 'POWERUP_BARRIER',
};
const SE_EVENTS = [
  'ball_hit_paddle',
  'ball_hit_wall',
  'block_break',
  'block_hit',
  'powerup_appear',
  'powerup_get',
  'ball_lose',
  'game_over',
  'stage_clear',
  'bonus_count',
  'game_start',
  'pause',
];
const SPRITE_ROLES = [
  'ball',
  'paddle',
  'powerup_multi_ball',
  'powerup_strong',
  'powerup_speed_up',
  'powerup_barrier',
  'block_white',
  'block_yellow',
  'block_green',
  'block_blue',
  'block_gray',
];
const SYSTEM_IMAGE_ROLES = [
  'logo_screen_1',
  'logo_screen_2',
  'title_screen',
  'game_over_screen',
  'high_score_screen',
  'game_clear_screen',
];
const SCREEN_WAIT_ROLES = [
  'logo_screen_1',
  'logo_screen_2',
  'title_screen',
  'high_score_screen',
  'game_over_screen',
  'game_clear_screen',
];
const SCREEN_BGM_ROLES = [
  'title_screen',
  'game_clear_screen',
  'high_score_screen',
];
const DEFAULT_SETTINGS = {
  se_bindings: {},
  sprite_bindings: {},
  image_usage_bindings: {},
  game_settings: {
    ball_speed: 2,
    paddle_speed: 3,
    initial_lives: 3,
    bgm_volume: 100,
    system_font_symbol: '',
    screen_wait_seconds: {},
    screen_bgm_symbols: {},
  },
};
const REQUIRED_SE_ROLES = new Set(['ball_hit_paddle', 'ball_hit_wall', 'block_break', 'block_hit']);
const SPRITE_SPECS = {
  ball: { width: 8, height: 8, required: true },
  paddle: { width: 32, height: 8, required: true },
  powerup_multi_ball: { width: 16, height: 8, required: true },
  powerup_strong: { width: 16, height: 8, required: true },
  powerup_speed_up: { width: 16, height: 8, required: true },
  powerup_barrier: { width: 16, height: 8, required: true },
  block_white: { width: 16, height: 8, required: true },
  block_yellow: { width: 16, height: 8, required: true },
  block_green: { width: 16, height: 8, required: true },
  block_blue: { width: 16, height: 8, required: true },
  block_gray: { width: 16, height: 8, required: true },
};

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

function getStagesDir(projectDir) {
  return path.join(projectDir, 'data', 'stages');
}

function getSettingsPath(projectDir) {
  return path.join(projectDir, 'data', 'game-settings.json');
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSettings(settings = {}) {
  const game = settings.game_settings && typeof settings.game_settings === 'object' ? settings.game_settings : settings;
  const incomingWaits = game.screen_wait_seconds && typeof game.screen_wait_seconds === 'object'
    ? game.screen_wait_seconds
    : {};
  const screenWaitSeconds = {};
  SCREEN_WAIT_ROLES.forEach((role) => {
    screenWaitSeconds[role] = clampInt(incomingWaits[role], 0, 999, 0);
  });
  const incomingScreenBgms = game.screen_bgm_symbols && typeof game.screen_bgm_symbols === 'object'
    ? game.screen_bgm_symbols
    : {};
  const screenBgmSymbols = {};
  SCREEN_BGM_ROLES.forEach((role) => {
    screenBgmSymbols[role] = String(incomingScreenBgms[role] || '');
  });
  return {
    se_bindings: settings.se_bindings && typeof settings.se_bindings === 'object' ? { ...settings.se_bindings } : {},
    sprite_bindings: settings.sprite_bindings && typeof settings.sprite_bindings === 'object' ? { ...settings.sprite_bindings } : {},
    image_usage_bindings: settings.image_usage_bindings && typeof settings.image_usage_bindings === 'object' ? { ...settings.image_usage_bindings } : {},
    game_settings: {
      ball_speed: clampInt(game.ball_speed, 1, 5, DEFAULT_SETTINGS.game_settings.ball_speed),
      paddle_speed: clampInt(game.paddle_speed, 1, 5, DEFAULT_SETTINGS.game_settings.paddle_speed),
      initial_lives: clampInt(game.initial_lives, 1, 99, DEFAULT_SETTINGS.game_settings.initial_lives),
      bgm_volume: clampInt(game.bgm_volume, 0, 100, DEFAULT_SETTINGS.game_settings.bgm_volume),
      system_font_symbol: String(game.system_font_symbol || ''),
      screen_wait_seconds: screenWaitSeconds,
      screen_bgm_symbols: screenBgmSymbols,
    },
  };
}

function readPngDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } catch (_) {}
  return null;
}

function readBmpDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
    }
  } catch (_) {}
  return null;
}

function imageDimensions(asset) {
  const filePath = asset?.sourceAbsolutePath;
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return readPngDimensions(filePath);
  if (ext === '.bmp') return readBmpDimensions(filePath);
  return null;
}

function spritePixelSize(asset) {
  const tileW = Number.parseInt(String(asset?.width || ''), 10);
  const tileH = Number.parseInt(String(asset?.height || ''), 10);
  if (Number.isFinite(tileW) && tileW > 0 && Number.isFinite(tileH) && tileH > 0) {
    return { width: tileW * 8, height: tileH * 8 };
  }
  return imageDimensions(asset);
}

function readSettings(projectDir) {
  return normalizeSettings(readJson(getSettingsPath(projectDir), DEFAULT_SETTINGS));
}

function normalizeId(value) {
  const text = String(value || '').trim();
  return text || `stage-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeFilePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'stage';
}

function normalizeGrid(source) {
  return Array.from({ length: GRID_ROWS }, (_, row) => (
    Array.from({ length: GRID_COLS }, (_, col) => {
      const raw = Array.isArray(source?.[row]) ? source[row][col] : 0;
      const value = Number.parseInt(String(raw ?? 0), 10);
      if (value === 6) return 5;
      return Number.isFinite(value) && value >= 0 && value < BLOCK_NAMES.length ? value : 0;
    })
  ));
}

function normalizePowerups(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  Object.entries(source).forEach(([key, value]) => {
    const match = /^(\d+)[,:-](\d+)$/.exec(String(key));
    if (!match) return;
    const row = Number(match[1]);
    const col = Number(match[2]);
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return;
    if (value == null || value === '' || value === 0 || value === '0') return;
    out[`${row},${col}`] = value;
  });
  return out;
}

function normalizeStage(stage, fallbackOrder, fallbackName) {
  const order = Number.parseInt(String(stage?.order ?? fallbackOrder), 10);
  return {
    id: normalizeId(stage?.id),
    name: String(stage?.name || fallbackName || `Stage ${order || 1}`),
    order: Number.isFinite(order) && order > 0 ? order : fallbackOrder,
    bgm_symbol: String(stage?.bgm_symbol || ''),
    background_image_symbol: String(stage?.background_image_symbol || ''),
    clear_image_symbol: String(stage?.clear_image_symbol || ''),
    blocks: normalizeGrid(stage?.blocks),
    power_ups: normalizePowerups(stage?.power_ups || stage?.powerups),
  };
}

function listStageFiles(projectDir) {
  const stagesDir = getStagesDir(projectDir);
  if (!fs.existsSync(stagesDir)) return [];
  return fs.readdirSync(stagesDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(stagesDir, name))
    .sort((a, b) => a.localeCompare(b));
}

function loadStages(projectDir) {
  return listStageFiles(projectDir)
    .map((filePath) => ({ filePath, stage: readJson(filePath, null) }))
    .filter((entry) => entry.stage && typeof entry.stage === 'object')
    .map((entry, index) => ({
      filePath: entry.filePath,
      stage: normalizeStage(entry.stage, index + 1, `Stage ${index + 1}`),
    }))
    .sort((left, right) => left.stage.order - right.stage.order || left.stage.name.localeCompare(right.stage.name));
}

function getResources(projectDir, assets = []) {
  const normalized = (Array.isArray(assets) ? assets : []).map((asset) => ({
    name: String(asset?.name || ''),
    type: String(asset?.type || '').toUpperCase(),
    sourcePath: String(asset?.sourcePath || ''),
    sourceAbsolutePath: String(asset?.sourceAbsolutePath || ''),
    resFileAbsolutePath: String(asset?.resFileAbsolutePath || ''),
    lineNumber: asset?.lineNumber,
    width: asset?.width,
    height: asset?.height,
    driver: asset?.driver,
    outRate: asset?.outRate,
  })).filter((asset) => asset.name);
  return {
    images: normalized.filter((asset) => asset.type === 'IMAGE'),
    stageImages: normalized.filter((asset) => asset.type === 'IMAGE' && isStageImageAsset(asset)),
    bgms: normalized.filter(isBgmAsset),
    sprites: normalized.filter((asset) => asset.type === 'SPRITE'),
    ses: normalized.filter((asset) => asset.type === 'WAV'),
    tilesets: normalized.filter((asset) => asset.type === 'TILESET'),
    palettes: normalized.filter((asset) => asset.type === 'PALETTE'),
    all: normalized,
    projectDir,
  };
}

function isBgmAsset(asset) {
  const type = String(asset?.type || '').toUpperCase();
  const sourcePath = String(asset?.sourcePath || '').replace(/\\/g, '/').toLowerCase();
  return type === 'XGM' || type === 'XGM2' || (type === 'WAV' && sourcePath.startsWith('bgm/'));
}

function isStageImageAsset(asset) {
  const sourcePath = String(asset?.sourcePath || '').replace(/\\/g, '/').toLowerCase();
  return sourcePath.startsWith('stage/');
}

function duplicateResourceNames(resources) {
  const groups = new Map();
  (resources.all || []).forEach((entry) => {
    const name = String(entry?.name || '').trim();
    if (!name) return;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  });
  return Array.from(groups.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatResourceLocation(entry) {
  const file = entry.resFileAbsolutePath ? path.basename(entry.resFileAbsolutePath) : 'resources.res';
  const line = Number(entry.lineNumber);
  return Number.isFinite(line) && line > 0 ? `${file}:${line}` : file;
}

function makeNextStageName(stages) {
  const max = stages.reduce((highest, stage) => {
    const match = /(\d+)\s*$/.exec(String(stage.name || ''));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `Stage ${max + 1}`;
}

function stageFilePath(projectDir, stage, existingFilePath) {
  if (existingFilePath) return existingFilePath;
  const order = String(stage.order || 1).padStart(3, '0');
  return path.join(getStagesDir(projectDir), `stage_${order}_${safeFilePart(stage.id)}.json`);
}

function findStageFile(projectDir, id) {
  return loadStages(projectDir).find((entry) => entry.stage.id === id)?.filePath || '';
}

function cGridRows(rows) {
  return rows.map((row) => `    { ${row.join(', ')} }`).join(',\n');
}

function blockRowsForC(blocks) {
  return normalizeGrid(blocks).map((row) => row.map((value) => BLOCK_NAMES[value] || BLOCK_NAMES[0]));
}

function powerRowsForC(powerups) {
  const rows = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill('POWERUP_NONE'));
  Object.entries(normalizePowerups(powerups)).forEach(([key, value]) => {
    const [row, col] = key.split(',').map((part) => Number(part));
    rows[row][col] = POWERUP_NAMES[value] || 'POWERUP_NONE';
  });
  return rows;
}

function imagePointer(symbol) {
  const value = String(symbol || '').trim();
  return value ? `&${value}` : 'NULL';
}

function makeDefaultStage(assets) {
  const resources = getResources('', assets);
  const blocks = Array.from({ length: GRID_ROWS }, (_, row) => (
    Array.from({ length: GRID_COLS }, (_, col) => (row === 5 && col >= 2 && col <= 12 ? 1 : 0))
  ));
  return normalizeStage({
    id: 'stage-default',
    name: 'Stage 1',
    order: 1,
    blocks,
    clear_image_symbol: resources.stageImages?.[0]?.name || '',
    background_image_symbol: resources.stageImages?.[0]?.name || '',
    bgm_symbol: resources.bgms[0]?.name || '',
    power_ups: {},
  }, 1, 'Stage 1');
}

function exportStagesHeader(projectDir, stages, assets = []) {
  const stageList = stages.length > 0 ? stages : [makeDefaultStage(assets)];
  const resources = getResources(projectDir, assets);
  const outPath = path.join(projectDir, 'inc', 'stages.h');
  const blockDefs = [];
  const powerupDefs = [];
  const tableRows = [];

  stageList.forEach((stage, index) => {
    const stageNo = index + 1;
    blockDefs.push(`/* Stage ${stageNo}: ${stage.name || `Stage ${stageNo}`} */\nstatic const u8 stage_${stageNo}_blocks[GRID_ROWS][GRID_COLS] = {\n${cGridRows(blockRowsForC(stage.blocks))}\n};`);
    powerupDefs.push(`static const u8 stage_${stageNo}_powerups[GRID_ROWS][GRID_COLS] = {\n${cGridRows(powerRowsForC(stage.power_ups))}\n};`);
    tableRows.push(`    { stage_${stageNo}_blocks, stage_${stageNo}_powerups, ${bgmPointer(stage.bgm_symbol)}, ${bgmLength(stage.bgm_symbol)}, ${bgmHalfRate(stage.bgm_symbol, resources)}, ${imagePointer(stage.background_image_symbol)}, ${imagePointer(stage.clear_image_symbol)} }`);
  });

  const header = `/* Generated by block-stage-exporter */\n#ifndef _STAGES_H_\n#define _STAGES_H_\n\n#include "game.h"\n#include "game_resources.h"\n\n#define STAGE_COUNT ${stageList.length}\n\n${blockDefs.join('\n\n')}\n\n${powerupDefs.join('\n\n')}\n\nstatic const StageInfo stage_table[STAGE_COUNT] = {\n${tableRows.join(',\n')}\n};\n\n#endif /* _STAGES_H_ */\n`;

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, header, 'utf-8');
  return outPath;
}

function upperRole(role) {
  return String(role || '').toUpperCase();
}

function bgmPointer(symbol) {
  return symbol ? symbol : 'NULL';
}

function bgmLength(symbol) {
  return symbol ? `sizeof(${symbol})` : '0';
}

function resourceByName(resources, symbol) {
  const name = String(symbol || '').trim();
  if (!name) return null;
  return (resources.all || []).find((entry) => entry.name === name) || null;
}

function isHalfRatePcmBgm(entry) {
  if (!entry || String(entry.type || '').toUpperCase() !== 'WAV') return false;
  const outRate = Number.parseInt(String(entry.outRate || ''), 10);
  return Number.isFinite(outRate) && outRate > 0 && outRate <= 6650;
}

function bgmHalfRate(symbol, resources) {
  return isHalfRatePcmBgm(resourceByName(resources, symbol)) ? 'TRUE' : 'FALSE';
}

function macroRole(role) {
  return upperRole(role).replace(/[^A-Z0-9]+/g, '_');
}

function findByNeedle(entries, needles) {
  const lowered = needles.map((needle) => String(needle).toLowerCase());
  return entries.find((entry) => lowered.some((needle) => entry.name.toLowerCase().includes(needle)));
}

function findPaletteForSymbol(resources, symbol) {
  const base = String(symbol || '').trim();
  if (!base) return null;
  const lowered = base.toLowerCase();
  return resources.palettes.find((entry) => {
    const name = entry.name.toLowerCase();
    return name === `${lowered}_palette`
      || name === `${lowered}_pal`
      || name === `pal_${lowered}`
      || name === `palette_${lowered}`;
  }) || null;
}

function exportGameResourcesHeader(projectDir, stages, assets = []) {
  const resources = getResources(projectDir, assets);
  const settings = readSettings(projectDir);
  const game = settings.game_settings;
  const outPath = path.join(projectDir, 'inc', 'game_resources.h');
  const lines = [
    '/* Generated by block-stage-exporter */',
    '#ifndef _GAME_RESOURCES_H_',
    '#define _GAME_RESOURCES_H_',
    '',
    '#include "resources.h"',
    '',
  ];

  const spriteBindings = settings.sprite_bindings && typeof settings.sprite_bindings === 'object' ? settings.sprite_bindings : {};
  const spriteLines = [];
  SPRITE_ROLES.forEach((role) => {
    const explicit = spriteBindings[role];
    const match = explicit
      ? resources.sprites.find((entry) => entry.name === explicit)
      : findByNeedle(resources.sprites, role.split('_'));
    if (match) spriteLines.push(`#define RES_SPR_${upperRole(role)} ${match.name}`);
  });
  if (spriteLines.length) lines.push('/* --- Sprite bindings --- */', ...spriteLines, '');

  const imageBindings = settings.image_usage_bindings && typeof settings.image_usage_bindings === 'object' ? settings.image_usage_bindings : {};
  const imageLines = [];
  SYSTEM_IMAGE_ROLES.forEach((role) => {
    const explicit = imageBindings[role];
    const match = explicit ? resources.images.find((entry) => entry.name === explicit) : null;
    if (match) imageLines.push(`#define RES_IMG_${macroRole(role)} ${match.name}`);
  });
  if (imageLines.length) {
    lines.push('/* --- Image bindings --- */');
    lines.push(...imageLines, '');
  }

  const seBindings = settings.se_bindings && typeof settings.se_bindings === 'object' ? settings.se_bindings : {};
  const seLines = [];
  SE_EVENTS.forEach((event) => {
    const explicit = seBindings[event];
    const match = explicit ? resources.ses.find((entry) => entry.name === explicit) : null;
    if (match) seLines.push(`#define RES_SE_${upperRole(event)} ${match.name}`);
  });
  if (seLines.length) lines.push('/* --- SE bindings --- */', ...seLines, '');

  const screenBgms = Object.values(game.screen_bgm_symbols || {}).filter(Boolean);
  const selectedBgms = Array.from(new Set([...stages.map((stage) => stage.bgm_symbol).filter(Boolean), ...screenBgms]));
  const bgmEntries = (selectedBgms.length ? selectedBgms : resources.bgms.map((entry) => entry.name))
    .map((name) => resources.bgms.find((entry) => entry.name === name))
    .filter(Boolean);
  if (bgmEntries.length) {
    lines.push('/* --- BGM bindings --- */');
    bgmEntries.forEach((entry, index) => lines.push(`#define RES_BGM_${index} ${entry.name}`));
    SCREEN_BGM_ROLES.forEach((role) => {
      const symbol = String(game.screen_bgm_symbols?.[role] || '');
      if (bgmEntries.find((entry) => entry.name === symbol)) {
        lines.push(`#define RES_BGM_${macroRole(role)} ${symbol}`);
        lines.push(`#define RES_BGM_${macroRole(role)}_HALF_RATE ${bgmHalfRate(symbol, resources)}`);
      }
    });
    lines.push('');
    const firstType = bgmEntries[0].type;
    lines.push(firstType === 'WAV' ? '#define BGM_IS_PCM 1' : '#define BGM_IS_XGM2 1', '');
  }

  const initialLives = Number.parseInt(String(game.initial_lives ?? 3), 10);
  const ballSpeed = Number.parseInt(String(game.ball_speed ?? 2), 10);
  const paddleSpeed = Number.parseInt(String(game.paddle_speed ?? 3), 10);
  const bgmVolume = Number.parseInt(String(game.bgm_volume ?? 100), 10);
  const systemFont = String(game.system_font_symbol || '').trim();
  const fontMatch = systemFont ? resources.tilesets.find((entry) => entry.name === systemFont) : null;
  if (fontMatch) {
    const fontPalette = findPaletteForSymbol(resources, fontMatch.name);
    lines.push(
      '/* --- Font binding --- */',
      `#define RES_SYSTEM_FONT ${fontMatch.name}`,
      ...(fontPalette ? [`#define RES_SYSTEM_FONT_PALETTE ${fontPalette.name}`] : []),
      '',
    );
  }
  lines.push(
    '/* --- Game settings --- */',
    '#undef INITIAL_LIVES',
    `#define INITIAL_LIVES ${Number.isFinite(initialLives) ? initialLives : 3}`,
    '#undef BALL_BASE_SPEED',
    `#define BALL_BASE_SPEED FIX16(${Number.isFinite(ballSpeed) ? ballSpeed : 2})`,
    '#undef PADDLE_SPEED',
    `#define PADDLE_SPEED FIX16(${Number.isFinite(paddleSpeed) ? paddleSpeed : 3})`,
    '#undef BGM_VOLUME',
    `#define BGM_VOLUME ${Number.isFinite(bgmVolume) ? bgmVolume : 100}`,
    '',
    '/* --- Screen wait settings --- */',
    ...SCREEN_WAIT_ROLES.flatMap((role) => {
      const value = Number.parseInt(String(game.screen_wait_seconds?.[role] ?? 0), 10);
      return [`#undef SCREEN_WAIT_${macroRole(role)}_SECONDS`, `#define SCREEN_WAIT_${macroRole(role)}_SECONDS ${Number.isFinite(value) ? value : 0}`];
    }),
    '',
    '#endif /* _GAME_RESOURCES_H_ */',
    '',
  );

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${lines.join('\n')}`, 'utf-8');
  return outPath;
}

function ensureResourcesFile(projectDir) {
  const resPath = path.join(projectDir, 'res', 'resources.res');
  ensureDir(path.dirname(resPath));
  if (!fs.existsSync(resPath)) fs.writeFileSync(resPath, '', 'utf-8');
  return resPath;
}

function exportStageData(projectDir, assets = []) {
  ensureResourcesFile(projectDir);
  const stages = loadStages(projectDir).map((entry) => entry.stage);
  const stageList = stages.length > 0 ? stages : [makeDefaultStage(assets)];
  const headerPath = exportStagesHeader(projectDir, stageList, assets);
  const gameResourcesPath = exportGameResourcesHeader(projectDir, stageList, assets);
  return {
    ok: true,
    stageCount: stageList.length,
    headerPath,
    gameResourcesPath,
    resourcePath: ensureResourcesFile(projectDir),
  };
}

function validateBlockSettings(projectDir, assets = []) {
  const resources = getResources(projectDir, assets);
  const settings = readSettings(projectDir);
  const errors = [];
  const duplicates = duplicateResourceNames(resources);
  const stages = loadStages(projectDir).map((entry) => entry.stage);
  const screenBgms = Object.values(settings.game_settings?.screen_bgm_symbols || {}).filter(Boolean);
  const selectedBgmSymbols = Array.from(new Set([...stages.map((stage) => stage.bgm_symbol).filter(Boolean), ...screenBgms]));
  const selectedBgmEntries = selectedBgmSymbols
    .map((symbol) => resources.bgms.find((entry) => entry.name === symbol))
    .filter(Boolean);
  const selectedBgmTypes = new Set(selectedBgmEntries.map((entry) => (String(entry.type || '').toUpperCase() === 'WAV' ? 'WAV' : 'XGM2')));

  if (duplicates.length) {
    duplicates.forEach((duplicate) => {
      const locations = duplicate.entries.map(formatResourceLocation).join(', ');
      errors.push(`resources.res に重複したアセット名があります: ${duplicate.name} (${locations})`);
    });
  }

  if (selectedBgmTypes.size > 1) {
    errors.push('BGM に WAV(PCM) と XGM/XGM2 が混在しています。ブロック崩しゲームビルダーでは、BGM はどちらか一方の形式に統一してください。');
  }

  SE_EVENTS.forEach((role) => {
    if (!REQUIRED_SE_ROLES.has(role)) return;
    const symbol = settings.se_bindings[role];
    if (!symbol) {
      errors.push(`必須効果音が未設定です: ${role}`);
      return;
    }
    if (!resources.ses.find((entry) => entry.name === symbol)) {
      errors.push(`効果音アセットが見つかりません: ${role} -> ${symbol}`);
    }
  });

  SPRITE_ROLES.forEach((role) => {
    const spec = SPRITE_SPECS[role];
    if (!spec?.required) return;
    const symbol = settings.sprite_bindings[role];
    if (!symbol) {
      errors.push(`必須スプライトが未設定です: ${role}`);
      return;
    }
    const asset = resources.sprites.find((entry) => entry.name === symbol);
    if (!asset) {
      errors.push(`スプライトアセットが見つかりません: ${role} -> ${symbol}`);
      return;
    }
    const size = spritePixelSize(asset);
    if (size && (size.width !== spec.width || size.height !== spec.height)) {
      errors.push(`スプライトサイズが不一致です: ${role} は ${spec.width}x${spec.height} が必要ですが ${symbol} は ${size.width}x${size.height} です`);
    }
  });

  const systemFont = settings.game_settings?.system_font_symbol;
  if (systemFont && !resources.tilesets.find((entry) => entry.name === systemFont)) {
    errors.push(`システムフォントTILESETが見つかりません: ${systemFont}`);
  }

  return { ok: errors.length === 0, errors };
}

function listStages(projectDir, assets = []) {
  ensureDir(getStagesDir(projectDir));
  ensureResourcesFile(projectDir);
  return {
    ok: true,
    stages: loadStages(projectDir).map((entry) => entry.stage),
    resources: getResources(projectDir, assets),
    settings: readSettings(projectDir),
  };
}

function saveStage(projectDir, payload = {}, assets = []) {
  ensureDir(getStagesDir(projectDir));
  const current = loadStages(projectDir).map((entry) => entry.stage);
  const isCreate = Boolean(payload.create) || !payload.stage?.id;
  const nextOrder = current.length + 1;
  const fallbackName = isCreate ? makeNextStageName(current) : `Stage ${payload.stage?.order || nextOrder}`;
  const stage = normalizeStage(payload.stage || {}, payload.stage?.order || nextOrder, fallbackName);
  if (isCreate && (!payload.stage?.name || /Stage\s*\d+$/i.test(String(payload.stage.name)))) {
    stage.name = fallbackName;
  }
  if (isCreate && !payload.stage?.order) stage.order = nextOrder;

  const existing = findStageFile(projectDir, stage.id);
  const filePath = stageFilePath(projectDir, stage, existing);
  writeJson(filePath, stage);
  const exported = exportStageData(projectDir, assets);
  return { ok: true, stage, filePath, export: exported };
}

function deleteStage(projectDir, payload = {}, assets = []) {
  const id = String(payload.id || payload.stageId || '').trim();
  if (!id) return { ok: false, error: 'stage id is required' };
  const entries = loadStages(projectDir);
  const target = entries.find((entry) => entry.stage.id === id);
  if (!target) return { ok: false, error: `stage not found: ${id}` };
  fs.unlinkSync(target.filePath);

  loadStages(projectDir).forEach((entry, index) => {
    const next = { ...entry.stage, order: index + 1 };
    writeJson(entry.filePath, next);
  });
  const exported = exportStageData(projectDir, assets);
  return { ok: true, deletedId: id, export: exported };
}

function moveStage(projectDir, payload = {}, assets = []) {
  const id = String(payload.id || payload.stageId || '').trim();
  const direction = String(payload.direction || '').toLowerCase();
  if (!id) return { ok: false, error: 'stage id is required' };
  if (direction !== 'up' && direction !== 'down') return { ok: false, error: 'direction must be up or down' };

  const entries = loadStages(projectDir);
  const fromIndex = entries.findIndex((entry) => entry.stage.id === id);
  if (fromIndex < 0) return { ok: false, error: `stage not found: ${id}` };
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= entries.length) {
    return { ok: true, moved: false, stage: entries[fromIndex].stage, export: exportStageData(projectDir, assets) };
  }

  const nextEntries = entries.slice();
  const [movedEntry] = nextEntries.splice(fromIndex, 1);
  nextEntries.splice(toIndex, 0, movedEntry);
  let movedStage = movedEntry.stage;
  nextEntries.forEach((entry, index) => {
    const nextStage = { ...entry.stage, order: index + 1 };
    if (entry.stage.id === id) movedStage = nextStage;
    writeJson(entry.filePath, nextStage);
  });
  const exported = exportStageData(projectDir, assets);
  return { ok: true, moved: true, stage: movedStage, export: exported };
}

function listBlockSettings(projectDir, assets = []) {
  ensureDir(path.dirname(getSettingsPath(projectDir)));
  ensureResourcesFile(projectDir);
  return {
    ok: true,
    settings: readSettings(projectDir),
    resources: getResources(projectDir, assets),
  };
}

function saveBlockSettings(projectDir, payload = {}, assets = []) {
  const current = readSettings(projectDir);
  const incoming = payload.settings && typeof payload.settings === 'object' ? payload.settings : payload;
  const next = normalizeSettings({
    ...current,
    ...incoming,
    se_bindings: incoming.se_bindings && typeof incoming.se_bindings === 'object' ? incoming.se_bindings : current.se_bindings,
    sprite_bindings: incoming.sprite_bindings && typeof incoming.sprite_bindings === 'object' ? incoming.sprite_bindings : current.sprite_bindings,
    image_usage_bindings: incoming.image_usage_bindings && typeof incoming.image_usage_bindings === 'object' ? incoming.image_usage_bindings : current.image_usage_bindings,
    game_settings: {
      ...current.game_settings,
      ...(incoming.game_settings && typeof incoming.game_settings === 'object' ? incoming.game_settings : {}),
    },
  });
  writeJson(getSettingsPath(projectDir), next);
  const exported = exportStageData(projectDir, assets);
  return { ok: true, settings: next, export: exported };
}

module.exports = {
  GRID_ROWS,
  GRID_COLS,
  listStages,
  saveStage,
  deleteStage,
  moveStage,
  exportStageData,
  listBlockSettings,
  saveBlockSettings,
  validateBlockSettings,
  normalizeStage,
  normalizeSettings,
};
