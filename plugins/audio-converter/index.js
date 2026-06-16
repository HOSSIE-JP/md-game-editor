'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function runFfmpeg(args) {
  return spawnSync('ffmpeg', args, {
    windowsHide: true,
    encoding: 'utf-8',
  });
}

function ensureFfmpegAvailable() {
  const probe = runFfmpeg(['-version']);
  if (probe.error) {
    throw new Error('ffmpeg が見つかりません。ffmpeg をインストールして PATH に追加してください。');
  }
  if (probe.status !== 0) {
    throw new Error((probe.stderr || probe.stdout || 'ffmpeg の起動に失敗しました').trim());
  }
}

function buildFilterOptions(options) {
  const filters = [];
  const normalize = Boolean(options.normalize);
  if (normalize) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  const volumeDb = toNumberOrNull(options.volumeDb);
  if (volumeDb != null && volumeDb !== 0) {
    filters.push(`volume=${volumeDb}dB`);
  }

  return filters;
}

function convertAudio(payload, context = {}) {
  const logger = context.logger || console;
  const sourcePath = String(payload?.sourcePath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: '入力音声ファイルが見つかりません。' };
  }

  const options = payload?.options || {};
  const trimStartSec = toNumberOrNull(options.trimStartSec);
  const trimEndSec = toNumberOrNull(options.trimEndSec);
  const mono = Boolean(options.mono);
  const sampleRate = toNumberOrNull(options.sampleRate);

  if (trimStartSec != null && trimStartSec < 0) {
    return { ok: false, error: '開始位置は 0 以上にしてください。' };
  }
  if (trimEndSec != null && trimEndSec <= 0) {
    return { ok: false, error: '終了位置は 0 より大きくしてください。' };
  }
  if (trimStartSec != null && trimEndSec != null && trimEndSec <= trimStartSec) {
    return { ok: false, error: '終了位置は開始位置より後にしてください。' };
  }

  try {
    ensureFfmpegAvailable();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  const outPath = path.join(
    os.tmpdir(),
    `md-audio-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );

  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (trimStartSec != null && trimStartSec > 0) {
    args.push('-ss', String(trimStartSec));
  }
  args.push('-i', sourcePath);

  if (trimEndSec != null) {
    if (trimStartSec != null && trimStartSec > 0) {
      args.push('-t', String(trimEndSec - trimStartSec));
    } else {
      args.push('-to', String(trimEndSec));
    }
  }

  const filters = buildFilterOptions(options);
  if (filters.length > 0) {
    args.push('-af', filters.join(','));
  }
  if (mono) {
    args.push('-ac', '1');
  }
  if (sampleRate != null && sampleRate > 0) {
    args.push('-ar', String(Math.round(sampleRate)));
  }

  args.push('-vn', '-c:a', 'pcm_s16le', outPath);

  logger.info(`[audio-converter] 変換開始: ${path.basename(sourcePath)}`);
  const result = runFfmpeg(args);
  if (result.error) {
    return { ok: false, error: String(result.error.message || result.error) };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || '音声変換に失敗しました').trim() };
  }
  if (!fs.existsSync(outPath)) {
    return { ok: false, error: '音声変換後ファイルが生成されませんでした。' };
  }

  logger.info(`[audio-converter] 変換完了: ${path.basename(outPath)}`);
  return { ok: true, outputPath: outPath };
}

module.exports = {
  convertAudio,
};
