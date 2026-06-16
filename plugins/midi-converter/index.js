'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const manifest = require('./manifest.json');
const { convertMidiBufferToVgm } = require('./converter-core');

function sanitizeSymbol(value, fallback = 'midi_bgm') {
  const raw = String(value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const symbol = raw || fallback;
  return /^[A-Za-z_]/.test(symbol) ? symbol : `bgm_${symbol}`;
}

function normalizeBool(value, defaultValue = true) {
  if (value == null) return defaultValue;
  return Boolean(value);
}

function toProjectRelative(projectDir, absolutePath) {
  return path.relative(projectDir, absolutePath).replace(/\\/g, '/');
}

function sanitizeResSubdir(value, fallback = 'music') {
  const parts = String(value || fallback)
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+$/, '').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('/') : fallback;
}

function findBundledXgmTool(payload = {}) {
  const explicit = String(payload.xgmToolPath || '');
  if (explicit) return explicit;

  const toolName = process.platform === 'win32' ? 'xgmtool.exe' : 'xgmtool';
  const roots = [
    path.join(__dirname, '..', '..', 'data', 'tools', 'sgdk', 'SGDK-2.11'),
    process.env.GDK || '',
    process.env.SGDK || '',
    process.platform === 'win32' ? path.join('D:', 'homebrew', 'SGDK', 'sgdk', 'current') : '',
  ].filter(Boolean);

  const candidates = roots.map((root) => path.join(root, 'bin', toolName));
  return candidates.find((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    if (process.platform === 'win32') return true;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  }) || '';
}

function convertMidiMusic(payload = {}, context = {}) {
  const logger = context.logger || console;
  const sourcePath = String(payload.sourcePath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: '入力 MIDI ファイルが見つかりません。' };
  }

  const projectDir = String(context.projectDir || payload.projectDir || '');
  if (!projectDir) {
    return { ok: false, error: 'projectDir が指定されていません。' };
  }

  const symbol = sanitizeSymbol(payload.symbol || path.basename(sourcePath, path.extname(sourcePath)));
  const outputs = payload.outputs || {};
  const writeVgm = normalizeBool(outputs.vgm, true);
  const writeXgm = normalizeBool(outputs.xgm, true);
  const registerAsset = normalizeBool(outputs.registerAsset, false);
  if (!writeVgm && !writeXgm) {
    return { ok: false, error: 'VGM または XGM の出力を少なくとも 1 つ有効にしてください。' };
  }

  const outputSubdir = sanitizeResSubdir(payload.targetSubdir || payload.outputSubdir || 'music');
  const targetBaseName = sanitizeSymbol(payload.targetFileName || payload.outputBaseName || symbol, symbol);
  const musicDir = path.join(projectDir, 'res', outputSubdir);
  fs.mkdirSync(musicDir, { recursive: true });

  const vgmPath = path.join(musicDir, `${targetBaseName}.vgm`);
  const xgmPath = path.join(musicDir, `${targetBaseName}.xgm`);

  logger.info?.(`[${manifest.id}] MIDI 変換開始: ${path.basename(sourcePath)} -> ${symbol}`);
  let converted = null;
  try {
    converted = convertMidiBufferToVgm(fs.readFileSync(sourcePath));
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
  if (!converted?.ok) return converted || { ok: false, error: 'MIDI 変換に失敗しました。' };

  fs.writeFileSync(vgmPath, converted.vgm);

  const warnings = Array.isArray(converted.warnings) ? [...converted.warnings] : [];
  const diagnostics = Array.isArray(converted.diagnostics) ? [...converted.diagnostics] : [];

  if (writeXgm) {
    const xgmTool = findBundledXgmTool(payload);
    if (!xgmTool) {
      const message = 'xgmtool が見つからないため XGM 変換をスキップしました。VGM は保存済みです。';
      warnings.push(message);
      diagnostics.push({ level: 'warn', code: 'midi-converter-xgm', message });
    } else {
      const xgmResult = spawnSync(xgmTool, [vgmPath, xgmPath], {
        windowsHide: true,
        encoding: 'utf-8',
      });
      if (xgmResult.error || xgmResult.status !== 0 || !fs.existsSync(xgmPath)) {
        const detail = (xgmResult.stderr || xgmResult.stdout || xgmResult.error?.message || '').trim();
        const message = `XGM 変換に失敗しました: ${detail || 'xgmtool failed'}`;
        warnings.push(message);
        diagnostics.push({ level: 'warn', code: 'midi-converter-xgm', message });
      }
    }
  }

  const files = {};
  if (fs.existsSync(vgmPath)) files.vgm = toProjectRelative(projectDir, vgmPath);
  if (writeXgm && fs.existsSync(xgmPath)) files.xgm = toProjectRelative(projectDir, xgmPath);

  return {
    ok: true,
    pluginId: manifest.id,
    symbol,
    files,
    absoluteFiles: {
      vgm: fs.existsSync(vgmPath) ? vgmPath : '',
      xgm: fs.existsSync(xgmPath) ? xgmPath : '',
    },
    asset: registerAsset && files.vgm ? {
      type: 'XGM2',
      name: symbol,
      sourcePath: `${outputSubdir}/${targetBaseName}.vgm`,
    } : null,
    diagnostics,
    warnings,
    stats: converted.stats || {},
  };
}

module.exports = {
  convertMidiMusic,
  _private: {
    findBundledXgmTool,
    sanitizeResSubdir,
    sanitizeSymbol,
  },
};
