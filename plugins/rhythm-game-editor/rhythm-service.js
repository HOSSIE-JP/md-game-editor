'use strict';

const fs = require('fs');
const path = require('path');

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const NOTE_TYPE_ORDER = ['LEFT', 'UP', 'DOWN', 'RIGHT', 'A', 'B', 'C'];
const VALID_NOTE_TYPES = new Set(NOTE_TYPE_ORDER);
const VALID_PATTERNS = new Set(['TAP', 'HOLD', 'RAPID']);
const NOTE_TYPE_MAP = {
  UP: 'NOTE_UP',
  DOWN: 'NOTE_DOWN',
  LEFT: 'NOTE_LEFT',
  RIGHT: 'NOTE_RIGHT',
  A: 'NOTE_A',
  B: 'NOTE_B',
  C: 'NOTE_C',
};
const PATTERN_MAP = {
  TAP: 'PATTERN_TAP',
  HOLD: 'PATTERN_HOLD',
  RAPID: 'PATTERN_RAPID',
};

const DEFAULT_SELECT_EFFECTS = {
  wobble_amplitude: 0.625,
  wobble_speed: 1.0,
  wobble_angular_velocity: 4.0,
  diag_scroll_x_speed: 0.5,
  diag_scroll_y_speed: 0.5,
};

const SAMPLE_SYMBOLS = {
  note_sheet: 'rhythm_spr_note',
  judge_text: 'rhythm_spr_judge_text',
  gauge_fill: 'rhythm_spr_gauge_fill',
  icon_diff: 'rhythm_spr_icon_diff',
  bg_logo: 'rhythm_bg_logo',
  bg_logo2: 'rhythm_bg_logo2',
  bg_title: 'rhythm_bg_title',
  bg_select: 'rhythm_bg_select',
  bg_result: 'rhythm_bg_result',
  gameplay_ui: 'rhythm_img_gameplay_ui',
  se_tap: 'rhythm_sfx_se_tap',
  album_art: 'rhythm_img_sample_album_art',
  mood_sprite: 'rhythm_spr_sample_mood_sprite',
  sample_bgm: 'rhythm_snd_sample_song_bgm',
};

const SYSTEM_ASSET_SLOTS = {
  sprites: [
    { id: 'note_sheet', label: 'ノートシート', required: true, type: 'SPRITE', width: 6, height: 16, palette: 'PAL1', defaultPath: 'rhythm/sprites/note.png' },
    { id: 'judge_text', label: '判定テキスト', required: true, type: 'SPRITE', width: 8, height: 2, palette: 'PAL2', defaultPath: 'rhythm/sprites/spr_judge_text.png' },
  ],
  backgrounds: [
    { id: 'bg_logo', label: 'ロゴ画面', required: false, type: 'IMAGE', width: 320, height: 224, palette: 'PAL3', defaultPath: 'rhythm/images/bg_logo.png' },
    { id: 'bg_logo2', label: 'ロゴ画面2', required: false, type: 'IMAGE', width: 320, height: 224, palette: 'PAL3', defaultPath: 'rhythm/images/bg_logo.png' },
    { id: 'bg_title', label: 'タイトル画面', required: true, type: 'IMAGE', width: 320, height: 224, palette: 'PAL0', defaultPath: 'rhythm/images/bg_title.png' },
    { id: 'bg_select', label: '選曲画面', required: true, type: 'IMAGE', width: 320, height: 224, palette: 'PAL0', defaultPath: 'rhythm/images/bg_select.png' },
    { id: 'bg_result', label: 'リザルト画面', required: true, type: 'IMAGE', width: 320, height: 224, palette: 'PAL0', defaultPath: 'rhythm/images/bg_result.png' },
  ],
  ui: [
    { id: 'gameplay_ui', label: 'ゲームプレイUI', required: true, type: 'IMAGE', width: 320, height: 224, palette: 'PAL0', defaultPath: 'rhythm/images/gameplay_ui.png' },
    { id: 'gauge_fill', label: 'ゲージ塗り', required: true, type: 'SPRITE', width: 1, height: 1, palette: 'PAL2', defaultPath: 'rhythm/sprites/spr_gauge_fill.png' },
    { id: 'icon_diff', label: '難易度アイコン', required: false, type: 'SPRITE', width: 3, height: 3, palette: 'PAL2', defaultPath: 'rhythm/sprites/difficulty.png' },
  ],
  se: [
    { id: 'se_tap', label: 'タップSE', required: true, type: 'WAV', defaultPath: 'rhythm/se/tap.wav' },
  ],
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

function rhythmDataDir(projectDir) {
  return path.join(projectDir, 'data', 'rhythm');
}

function chartsDir(projectDir) {
  return path.join(rhythmDataDir(projectDir), 'charts');
}

function settingsPath(projectDir) {
  return path.join(rhythmDataDir(projectDir), 'game-assets.json');
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function sanitizeId(value, fallback = 'song') {
  const raw = String(value || fallback)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[A-Za-z_]/.test(raw) ? raw : `song_${raw || 'song'}`;
}

function safeFilePart(value) {
  return sanitizeId(value, 'song').slice(0, 48);
}

function escapeCString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function jisToSjis(ku, ten) {
  let c;
  let c2;
  if (ku % 2 === 1) {
    c = Math.floor((ku + 1) / 2) + (ku <= 62 ? 0x80 : 0xc0);
    c2 = ten + 0x3f;
    if (c2 >= 0x7f) c2 += 1;
  } else {
    c = Math.floor(ku / 2) + (ku <= 62 ? 0x80 : 0xc0);
    c2 = ten + 0x9e;
  }
  return [c, c2];
}

let unicodeToSjisMap = null;

function getUnicodeToSjisMap() {
  if (unicodeToSjisMap) return unicodeToSjisMap;
  unicodeToSjisMap = new Map();
  try {
    const decoder = new TextDecoder('shift_jis');
    [[0x81, 0x9f], [0xe0, 0xef]].forEach(([start, end]) => {
      for (let hi = start; hi <= end; hi += 1) {
        for (let lo = 0x40; lo <= 0xfc; lo += 1) {
          if (lo === 0x7f) continue;
          const ch = decoder.decode(new Uint8Array([hi, lo]));
          if (ch.length === 1 && ch.charCodeAt(0) !== 0xfffd) {
            unicodeToSjisMap.set(ch, [hi, lo]);
          }
        }
      }
    });
  } catch (_) {
    for (let cp = 0x30a1; cp <= 0x30f6; cp += 1) unicodeToSjisMap.set(String.fromCodePoint(cp), jisToSjis(5, cp - 0x30a0));
    for (let cp = 0x3041; cp <= 0x3093; cp += 1) unicodeToSjisMap.set(String.fromCodePoint(cp), jisToSjis(4, cp - 0x3040));
  }
  return unicodeToSjisMap;
}

function toSjisLiteral(value) {
  const str = String(value || '');
  if (/^[\x20-\x7e]*$/.test(str)) return escapeCString(str);
  const map = getUnicodeToSjisMap();
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) {
      out += `\\x${cp.toString(16).padStart(2, '0')}`;
      continue;
    }
    const bytes = map.get(ch);
    if (bytes) bytes.forEach((b) => { out += `\\x${b.toString(16).padStart(2, '0')}`; });
  }
  return out || escapeCString(str.replace(/[^\x20-\x7e]/g, '?'));
}

function normalizeSelectEffects(raw = {}) {
  return {
    wobble_amplitude: clampNumber(raw.wobble_amplitude, DEFAULT_SELECT_EFFECTS.wobble_amplitude, 0, 4),
    wobble_speed: clampNumber(raw.wobble_speed, DEFAULT_SELECT_EFFECTS.wobble_speed, 0, 16),
    wobble_angular_velocity: clampNumber(raw.wobble_angular_velocity, DEFAULT_SELECT_EFFECTS.wobble_angular_velocity, 0, 32),
    diag_scroll_x_speed: clampNumber(raw.diag_scroll_x_speed, DEFAULT_SELECT_EFFECTS.diag_scroll_x_speed, -8, 8),
    diag_scroll_y_speed: clampNumber(raw.diag_scroll_y_speed, DEFAULT_SELECT_EFFECTS.diag_scroll_y_speed, -8, 8),
  };
}

function defaultSettings() {
  return {
    sprites: {},
    backgrounds: {},
    ui: {},
    se: {},
    select_effects: { ...DEFAULT_SELECT_EFFECTS },
  };
}

function normalizeSettings(settings = {}) {
  const next = defaultSettings();
  ['sprites', 'backgrounds', 'ui', 'se'].forEach((bucket) => {
    next[bucket] = settings[bucket] && typeof settings[bucket] === 'object' ? { ...settings[bucket] } : {};
  });
  next.select_effects = normalizeSelectEffects(settings.select_effects);
  return next;
}

function normalizeNote(note = {}) {
  const type = String(note.type || 'LEFT').toUpperCase();
  const pattern = String(note.pattern || 'TAP').toUpperCase();
  return {
    time: Math.max(0, Number(note.time) || 0),
    type: VALID_NOTE_TYPES.has(type) ? type : 'LEFT',
    pattern: VALID_PATTERNS.has(pattern) ? pattern : 'TAP',
    duration: Math.max(0, Number(note.duration) || 0),
  };
}

function normalizeSong(song = {}, fallbackOrder = 1) {
  const songId = sanitizeId(song.song_id || song.id || song.title || `song_${fallbackOrder}`);
  const charts = {};
  DIFFICULTIES.forEach((diff) => {
    const notes = Array.isArray(song.charts?.[diff]?.notes) ? song.charts[diff].notes : [];
    charts[diff] = { notes: notes.map(normalizeNote).sort((a, b) => a.time - b.time) };
  });
  const order = clampInt(song.order, fallbackOrder, 1, 9999);
  const songImages = song.song_images && typeof song.song_images === 'object' ? { ...song.song_images } : {};
  return {
    song_id: songId,
    title: String(song.title || song.display_name || songId),
    display_name: String(song.display_name || song.title || songId),
    artist: String(song.artist || ''),
    bpm: clampNumber(song.bpm, 120, 30, 300),
    offset: clampNumber(song.offset, 0, -60, 60),
    order,
    audio_symbol: String(song.audio_symbol || ''),
    song_images: {
      album_art: songImages.album_art || '',
      mood_sprite: songImages.mood_sprite && typeof songImages.mood_sprite === 'object'
        ? {
          symbol: String(songImages.mood_sprite.symbol || songImages.mood_sprite.path || ''),
          frame_w: clampInt(songImages.mood_sprite.frame_w, 128, 8, 320),
          frame_h: clampInt(songImages.mood_sprite.frame_h, 96, 8, 224),
          fps: clampInt(songImages.mood_sprite.fps, 8, 1, 60),
        }
        : {
          symbol: String(songImages.mood_sprite || ''),
          frame_w: 128,
          frame_h: 96,
          fps: 8,
        },
    },
    charts,
  };
}

function chartFilePath(projectDir, song, existingPath = '') {
  if (existingPath) return existingPath;
  return path.join(chartsDir(projectDir), `${String(song.order || 1).padStart(3, '0')}_${safeFilePart(song.song_id)}.json`);
}

function loadSongFiles(projectDir) {
  const dir = chartsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b));
}

function loadSongs(projectDir) {
  return loadSongFiles(projectDir)
    .map((filePath, index) => ({ filePath, song: normalizeSong(readJson(filePath, {}), index + 1) }))
    .sort((left, right) => left.song.order - right.song.order || left.song.title.localeCompare(right.song.title));
}

function saveSongFile(projectDir, song, existingPath = '') {
  ensureDir(chartsDir(projectDir));
  const filePath = chartFilePath(projectDir, song, existingPath);
  writeJson(filePath, song);
  return filePath;
}

function normalizeAsset(asset = {}) {
  return {
    ...asset,
    type: String(asset.type || '').toUpperCase(),
    name: String(asset.name || ''),
    sourcePath: String(asset.sourcePath || '').replace(/\\/g, '/').replace(/^res\//, ''),
    sourceAbsolutePath: String(asset.sourceAbsolutePath || ''),
    width: asset.width,
    height: asset.height,
    outRate: asset.outRate,
    driver: asset.driver,
    resFileAbsolutePath: asset.resFileAbsolutePath,
    lineNumber: asset.lineNumber,
  };
}

function isBgmAsset(asset) {
  if (asset.type !== 'WAV') return false;
  const source = asset.sourcePath.toLowerCase();
  const name = asset.name.toLowerCase();
  return source.startsWith('songs/') || source.startsWith('bgm/') || name.includes('bgm') || name.includes('song');
}

function getResources(_projectDir, assets = []) {
  const all = (Array.isArray(assets) ? assets : [])
    .map(normalizeAsset)
    .filter((asset) => asset.name);
  return {
    all,
    images: all.filter((asset) => asset.type === 'IMAGE'),
    sprites: all.filter((asset) => asset.type === 'SPRITE'),
    songs: all.filter(isBgmAsset),
    ses: all.filter((asset) => asset.type === 'WAV' && !isBgmAsset(asset)),
    projectDir: _projectDir || '',
  };
}

function findAsset(resources, symbol) {
  const name = String(symbol || '').trim();
  if (!name) return null;
  return (resources.all || []).find((asset) => asset.name === name) || null;
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
    .map(([name, entries]) => ({ name, entries }));
}

function formatResourceLocation(entry) {
  const file = entry.resFileAbsolutePath ? path.basename(entry.resFileAbsolutePath) : 'resources.res';
  const line = Number(entry.lineNumber);
  return Number.isFinite(line) && line > 0 ? `${file}:${line}` : file;
}

function fallbackAsset(defaultPath, type = '') {
  return { type, name: '', sourcePath: defaultPath, sourceAbsolutePath: '' };
}

function sourceForSlot(resources, settings, bucket, slotId, fallbackPath, type) {
  const symbol = String(settings?.[bucket]?.[slotId] || '').trim();
  return findAsset(resources, symbol) || fallbackAsset(fallbackPath, type);
}

function resQuote(value) {
  const s = String(value || '').replace(/\\/g, '/').replace(/^res\//, '');
  return `"${s.replace(/"/g, '\\"')}"`;
}

function copyTree(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  fs.readdirSync(src, { withFileTypes: true }).forEach((entry) => {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  });
}

function syncTemplateAssets(projectDir, templateRoot) {
  if (!templateRoot) return;
  copyTree(path.join(templateRoot, 'res', 'rhythm'), path.join(projectDir, 'res', 'rhythm'));
}

function writeStaticResFiles(projectDir) {
  const resRoot = path.join(projectDir, 'res');
  ensureDir(resRoot);
  fs.writeFileSync(path.join(resRoot, 'font.res'), [
    '// Generated by rhythm-game-builder',
    'TILESET rhythm_sjis_font "rhythm/font/misaki_gothic.png" NONE NONE',
    'TILESET rhythm_tileset_Font_Gradient "rhythm/gfx/Font_Gradient.png"',
    'PALETTE rhythm_palette_Font_Gradient "rhythm/gfx/Font_Gradient.png"',
    '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(resRoot, 'wobble.res'), [
    '// Generated by rhythm-game-builder',
    'IMAGE rhythm_image_sgdk_logo "rhythm/gfx/sgdk_logo.png"',
    'SPRITE rhythm_sprite_MenuBackdrop_Corner "rhythm/gfx/MenuBackdrop_Corner.png" 4 4 NONE 0 NONE NONE',
    'SPRITE rhythm_sprite_MenuBackdrop_EdgeH "rhythm/gfx/MenuBackdrop_EdgeH.png" 4 4 NONE 0 NONE NONE',
    'SPRITE rhythm_sprite_MenuBackdrop_EdgeV "rhythm/gfx/MenuBackdrop_EdgeV.png" 4 4 NONE 0 NONE NONE',
    'SPRITE rhythm_sprite_MenuBackdrop_Center "rhythm/gfx/MenuBackdrop_Center.png" 4 4 NONE 0 NONE NONE',
    '',
  ].join('\n'), 'utf-8');
}

function spriteLine(symbol, sourcePath, width, height, time = '0') {
  return `SPRITE ${symbol} ${resQuote(sourcePath)} ${width} ${height} NONE ${time} NONE`;
}

function imageLine(symbol, sourcePath) {
  return `IMAGE ${symbol} ${resQuote(sourcePath)} BEST`;
}

function wavLine(symbol, sourcePath, outRate = '') {
  const rate = outRate ? ` ${outRate}` : '';
  return `WAV ${symbol} ${resQuote(sourcePath)} XGM2${rate} TRUE`;
}

function buildExportSongs(projectDir) {
  const songs = loadSongs(projectDir).map((entry) => entry.song);
  if (songs.length > 0) return songs;
  return [normalizeSong({
    song_id: 'sample_song',
    title: 'Sample Song',
    display_name: 'Sample Song',
    bpm: 120,
    offset: 0,
    order: 1,
    audio_symbol: '',
    song_images: {},
    charts: {
      easy: { notes: [{ time: 1, type: 'A', pattern: 'TAP' }, { time: 2, type: 'B', pattern: 'TAP' }, { time: 3, type: 'C', pattern: 'TAP' }] },
      normal: { notes: [{ time: 1, type: 'LEFT', pattern: 'TAP' }, { time: 1.5, type: 'UP', pattern: 'TAP' }, { time: 2, type: 'DOWN', pattern: 'TAP' }, { time: 2.5, type: 'RIGHT', pattern: 'TAP' }] },
      hard: { notes: [{ time: 1, type: 'LEFT', pattern: 'TAP' }, { time: 1.25, type: 'A', pattern: 'TAP' }, { time: 1.5, type: 'DOWN', pattern: 'TAP' }, { time: 1.75, type: 'B', pattern: 'TAP' }, { time: 2, type: 'C', pattern: 'TAP' }] },
    },
  })];
}

function rhythmSymbol(base) {
  return `rhythm_${sanitizeId(base, 'asset')}`;
}

function buildRhythmRes(projectDir, assets = []) {
  const settings = readSettings(projectDir);
  const resources = getResources(projectDir, assets);
  const songs = buildExportSongs(projectDir);
  const lines = [
    '// ============================================================',
    '// rhythm.res - Generated by rhythm-game-builder',
    '// ============================================================',
    '',
    '// System sprites',
  ];

  const note = sourceForSlot(resources, settings, 'sprites', 'note_sheet', 'rhythm/sprites/note.png', 'SPRITE');
  const judge = sourceForSlot(resources, settings, 'sprites', 'judge_text', 'rhythm/sprites/spr_judge_text.png', 'SPRITE');
  const gauge = sourceForSlot(resources, settings, 'ui', 'gauge_fill', 'rhythm/sprites/spr_gauge_fill.png', 'SPRITE');
  const diff = sourceForSlot(resources, settings, 'ui', 'icon_diff', 'rhythm/sprites/difficulty.png', 'SPRITE');
  lines.push(spriteLine('rhythm_spr_note', note.sourcePath, 2, 2, '4'));
  lines.push(spriteLine('rhythm_spr_judge_text', judge.sourcePath, 8, 2, '0'));
  lines.push(spriteLine('rhythm_spr_gauge_fill', gauge.sourcePath, 1, 1, '0'));
  lines.push(spriteLine('rhythm_spr_icon_diff', diff.sourcePath, 3, 3, '0'));

  lines.push('', '// Backgrounds and UI images');
  SYSTEM_ASSET_SLOTS.backgrounds.forEach((slot) => {
    const asset = sourceForSlot(resources, settings, 'backgrounds', slot.id, slot.defaultPath, 'IMAGE');
    lines.push(imageLine(`rhythm_${slot.id}`, asset.sourcePath));
  });
  const gameplay = sourceForSlot(resources, settings, 'ui', 'gameplay_ui', 'rhythm/images/gameplay_ui.png', 'IMAGE');
  lines.push(imageLine('rhythm_img_gameplay_ui', gameplay.sourcePath));

  lines.push('', '// Sound effects');
  const tap = sourceForSlot(resources, settings, 'se', 'se_tap', 'rhythm/se/tap.wav', 'WAV');
  lines.push(wavLine('rhythm_sfx_se_tap', tap.sourcePath));

  lines.push('', '// Songs');
  songs.forEach((song) => {
    const audioAsset = findAsset(resources, song.audio_symbol);
    const bgmSource = audioAsset && audioAsset.type === 'WAV' ? audioAsset.sourcePath : 'rhythm/se/sample_song.wav';
    lines.push(wavLine(`rhythm_snd_${song.song_id}_bgm`, bgmSource, '6650'));
  });

  lines.push('', '// Song images');
  songs.forEach((song) => {
    const albumAsset = findAsset(resources, song.song_images.album_art);
    const albumSource = albumAsset && albumAsset.type === 'IMAGE' ? albumAsset.sourcePath : 'rhythm/images/album_art.png';
    lines.push(imageLine(`rhythm_img_${song.song_id}_album_art`, albumSource));

    const moodSymbol = song.song_images.mood_sprite?.symbol || '';
    const moodAsset = findAsset(resources, moodSymbol);
    const moodSource = moodAsset && moodAsset.type === 'SPRITE' ? moodAsset.sourcePath : 'rhythm/sprites/mood_sprite.png';
    const frameW = clampInt(song.song_images.mood_sprite?.frame_w, 128, 8, 320);
    const frameH = clampInt(song.song_images.mood_sprite?.frame_h, 96, 8, 224);
    const fps = clampInt(song.song_images.mood_sprite?.fps, 8, 1, 60);
    lines.push(spriteLine(`rhythm_spr_${song.song_id}_mood_sprite`, moodSource, Math.max(1, Math.ceil(frameW / 8)), Math.max(1, Math.ceil(frameH / 8)), String(Math.max(1, Math.round(60 / fps)))));
  });

  fs.writeFileSync(path.join(projectDir, 'res', 'rhythm.res'), `${lines.join('\n')}\n`, 'utf-8');
  return { songs, settings, resources };
}

function writeRhythmAliasHeader(projectDir) {
  const header = [
    '/* Generated by rhythm-game-builder */',
    '#ifndef _RHYTHM_RESOURCES_ALIAS_H_',
    '#define _RHYTHM_RESOURCES_ALIAS_H_',
    '',
    '#define spr_note rhythm_spr_note',
    '#define spr_judge_text rhythm_spr_judge_text',
    '#define spr_gauge_fill rhythm_spr_gauge_fill',
    '#define spr_icon_diff rhythm_spr_icon_diff',
    '#define bg_logo rhythm_bg_logo',
    '#define bg_logo2 rhythm_bg_logo2',
    '#define bg_title rhythm_bg_title',
    '#define bg_select rhythm_bg_select',
    '#define bg_result rhythm_bg_result',
    '#define img_gameplay_ui rhythm_img_gameplay_ui',
    '#define sfx_se_tap rhythm_sfx_se_tap',
    '#define image_sgdk_logo rhythm_image_sgdk_logo',
    '#define sprite_MenuBackdrop_Corner rhythm_sprite_MenuBackdrop_Corner',
    '#define sprite_MenuBackdrop_EdgeH rhythm_sprite_MenuBackdrop_EdgeH',
    '#define sprite_MenuBackdrop_EdgeV rhythm_sprite_MenuBackdrop_EdgeV',
    '#define sprite_MenuBackdrop_Center rhythm_sprite_MenuBackdrop_Center',
    '#define sjis_font rhythm_sjis_font',
    '#define tileset_Font_Gradient rhythm_tileset_Font_Gradient',
    '#define palette_Font_Gradient rhythm_palette_Font_Gradient',
    '',
    '#endif /* _RHYTHM_RESOURCES_ALIAS_H_ */',
    '',
  ].join('\n');
  ensureDir(path.join(projectDir, 'inc'));
  fs.writeFileSync(path.join(projectDir, 'inc', 'rhythm_resources.h'), header, 'utf-8');
}

function generateSongDataH() {
  return [
    '#ifndef _SONG_DATA_H_',
    '#define _SONG_DATA_H_',
    '',
    '/* Generated by rhythm-game-builder */',
    '',
    '#include <genesis.h>',
    '#include "game_def.h"',
    '#include "note.h"',
    '',
    'typedef struct {',
    '    const ChartInfo* chart;',
    '    const u8*        bgm;',
    '    u32              bgm_len;',
    '    const char*      asset_filename;',
    '    const char*      display_name;',
    '    const Image*     album_art;',
    '    const SpriteDefinition* mood_sprite;',
    '} SongEntry;',
    '',
    'extern const SongEntry song_database[];',
    'extern const u16 song_count;',
    '',
    '#endif /* _SONG_DATA_H_ */',
    '',
  ].join('\n');
}

function fixedLiteral(value, fallback) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return safe.toFixed(4);
}

function generateGameDefH(songs, settings = defaultSettings()) {
  const maxSongs = Math.max(1, songs.length);
  const effects = normalizeSelectEffects(settings.select_effects || {});
  return [
    '#ifndef _GAME_DEF_H_',
    '#define _GAME_DEF_H_',
    '',
    '/* Generated by rhythm-game-builder */',
    '',
    '#define SCREEN_W            320',
    '#define SCREEN_H            224',
    '',
    '#define STATE_TITLE         0',
    '#define STATE_SELECT        1',
    '#define STATE_GAMEPLAY      2',
    '#define STATE_RESULT        3',
    '#define STATE_LOGO          4',
    '',
    `#define MAX_SONGS           ${maxSongs}`,
    '',
    '#define NOTE_LEFT           0',
    '#define NOTE_UP             1',
    '#define NOTE_DOWN           2',
    '#define NOTE_RIGHT          3',
    '#define NOTE_A              4',
    '#define NOTE_B              5',
    '#define NOTE_C              6',
    '#define NOTE_TYPE_COUNT     7',
    '',
    '#define PATTERN_TAP         0',
    '#define PATTERN_HOLD        1',
    '#define PATTERN_RAPID       2',
    '',
    '#define DIFF_EASY           0',
    '#define DIFF_NORMAL         1',
    '#define DIFF_HARD           2',
    '#define DIFF_COUNT          3',
    '',
    '#define JUDGE_PERFECT       0',
    '#define JUDGE_GREAT         1',
    '#define JUDGE_GOOD          2',
    '#define JUDGE_MISS          3',
    '#define JUDGE_WINDOW_PERFECT    2',
    '#define JUDGE_WINDOW_GREAT      4',
    '#define JUDGE_WINDOW_GOOD       7',
    '',
    '#define SCORE_PERFECT       300',
    '#define SCORE_GREAT         200',
    '#define SCORE_GOOD          100',
    '#define SCORE_MISS          0',
    '#define SCORE_HOLD_TICK     10',
    '#define SCORE_RAPID_HIT     50',
    '',
    '#define JUDGE_LINE_Y        184',
    '#define NOTE_SPEED          2',
    '#define LANE_COUNT          7',
    '#define LANE_X_START        16',
    '#define LANE_WIDTH          20',
    '#define HUD_HEIGHT          32',
    '#define NOTE_SPAWN_Y        -16',
    '',
    '#define MAX_VISIBLE_NOTES   32',
    '#define MAX_CHART_NOTES     1024',
    '',
    '#define MOOD_EXCELLENT_THRESHOLD    90',
    '#define MOOD_GOOD_THRESHOLD         70',
    '#define MOOD_NORMAL_THRESHOLD       40',
    '',
    '#define NOTE_ANIM_NORMAL    0',
    '#define NOTE_ANIM_HIT       1',
    '#define NOTE_ANIM_MISS      2',
    '#define NOTE_HIT_ANIM_FRAMES  12',
    '#define NOTE_MISS_ANIM_FRAMES 8',
    '',
    `#define SELECT_WOBBLE_AMPLITUDE_DEF  FIX16(${fixedLiteral(effects.wobble_amplitude, DEFAULT_SELECT_EFFECTS.wobble_amplitude)})`,
    `#define SELECT_WOBBLE_SPEED_DEF      FIX16(${fixedLiteral(effects.wobble_speed, DEFAULT_SELECT_EFFECTS.wobble_speed)})`,
    `#define SELECT_WOBBLE_ANGVEL_DEF     FIX16(${fixedLiteral(effects.wobble_angular_velocity, DEFAULT_SELECT_EFFECTS.wobble_angular_velocity)})`,
    `#define SELECT_DIAG_SCROLL_X_SPEED   FIX16(${fixedLiteral(effects.diag_scroll_x_speed, DEFAULT_SELECT_EFFECTS.diag_scroll_x_speed)})`,
    `#define SELECT_DIAG_SCROLL_Y_SPEED   FIX16(${fixedLiteral(effects.diag_scroll_y_speed, DEFAULT_SELECT_EFFECTS.diag_scroll_y_speed)})`,
    '',
    '#define GAUGE_MAX               1000',
    '#define GAUGE_GAIN_PERFECT      50',
    '#define GAUGE_GAIN_GREAT        30',
    '#define GAUGE_GAIN_GOOD         10',
    '#define GAUGE_DRAIN_MISS        20',
    '#define GAUGE_SEGMENTS          6',
    '',
    '#endif /* _GAME_DEF_H_ */',
    '',
  ].join('\n');
}

function generateSongDataC(songs) {
  const lines = [
    '/* Generated by rhythm-game-builder */',
    '#include "song_data.h"',
    '#include "rhythm.h"',
    '',
  ];

  songs.forEach((song, index) => {
    lines.push(`/* Song ${index}: ${escapeCString(song.title || song.song_id)} */`);
    DIFFICULTIES.forEach((diff) => {
      const notes = song.charts?.[diff]?.notes || [];
      lines.push(`static const NoteData notes_${song.song_id}_${diff}[] = {`);
      if (notes.length === 0) {
        lines.push('    { 0, NOTE_LEFT, PATTERN_TAP, 0 }');
      } else {
        notes.forEach((note, noteIndex) => {
          const frame = Math.max(0, Math.round(Number(note.time || 0) * 60));
          const duration = Math.max(0, Math.round(Number(note.duration || 0) * 60));
          const comma = noteIndex < notes.length - 1 ? ',' : '';
          lines.push(`    { ${frame}, ${NOTE_TYPE_MAP[note.type] || 'NOTE_LEFT'}, ${PATTERN_MAP[note.pattern] || 'PATTERN_TAP'}, ${duration} }${comma}`);
        });
      }
      lines.push('};', '');
    });

    const counts = DIFFICULTIES.map((diff) => Math.max(1, (song.charts?.[diff]?.notes || []).length));
    lines.push(`static const ChartInfo chart_${song.song_id} = {`);
    lines.push(`    "${escapeCString(song.title || song.song_id)}",`);
    lines.push(`    ${Math.round(song.bpm || 120)},`);
    lines.push(`    ${Math.round(Number(song.offset || 0) * 1000)},`);
    lines.push(`    { ${counts.join(', ')} },`);
    lines.push(`    { notes_${song.song_id}_easy, notes_${song.song_id}_normal, notes_${song.song_id}_hard }`);
    lines.push('};', '');
  });

  lines.push(`const SongEntry song_database[${Math.max(1, songs.length)}] = {`);
  songs.forEach((song, index) => {
    const comma = index < songs.length - 1 ? ',' : '';
    const bgmSymbol = `rhythm_snd_${song.song_id}_bgm`;
    const albumSymbol = `rhythm_img_${song.song_id}_album_art`;
    const moodSymbol = `rhythm_spr_${song.song_id}_mood_sprite`;
    const displayName = song.display_name || song.title || song.song_id;
    lines.push(`    { &chart_${song.song_id}, ${bgmSymbol}, sizeof(${bgmSymbol}), "${escapeCString(`${song.song_id}.wav`)}",`);
    lines.push(`      "${toSjisLiteral(displayName)}", &${albumSymbol}, &${moodSymbol} }${comma}`);
  });
  lines.push('};', '');
  lines.push(`const u16 song_count = ${songs.length};`, '');
  return lines.join('\n');
}

function writeGeneratedSources(projectDir, songs, settings) {
  ensureDir(path.join(projectDir, 'inc'));
  ensureDir(path.join(projectDir, 'src'));
  fs.writeFileSync(path.join(projectDir, 'inc', 'song_data.h'), generateSongDataH(songs), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'inc', 'game_def.h'), generateGameDefH(songs, settings), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'src', 'song_data.c'), generateSongDataC(songs), 'utf-8');
}

function readSettings(projectDir) {
  return normalizeSettings(readJson(settingsPath(projectDir), defaultSettings()));
}

function saveSettings(payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const settings = normalizeSettings(payload.settings || payload);
  writeJson(settingsPath(projectDir), settings);
  return { ok: true, settings, resources: getResources(projectDir, context.assets || []) };
}

function listSettings(_payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  return { ok: true, settings: readSettings(projectDir), resources: getResources(projectDir, context.assets || []) };
}

function listSongs(_payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  return {
    ok: true,
    songs: loadSongs(projectDir).map((entry) => entry.song),
    settings: readSettings(projectDir),
    resources: getResources(projectDir, context.assets || []),
    assetSlots: SYSTEM_ASSET_SLOTS,
  };
}

function saveSong(payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const existing = loadSongs(projectDir);
  const incoming = payload.song || {};
  const previousId = sanitizeId(payload.previous_song_id || incoming.previous_song_id || incoming.song_id || '');
  const current = existing.find((entry) => entry.song.song_id === incoming.song_id)
    || existing.find((entry) => previousId && entry.song.song_id === previousId);
  const order = payload.create
    ? existing.reduce((max, entry) => Math.max(max, entry.song.order || 0), 0) + 1
    : (current?.song.order || incoming.order || existing.length + 1);
  const song = normalizeSong({ ...incoming, order }, order);
  const filePath = saveSongFile(projectDir, song, current?.filePath || '');
  return { ok: true, song, filePath, songs: loadSongs(projectDir).map((entry) => entry.song) };
}

function deleteSong(payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const id = sanitizeId(payload.song_id || payload.id || '');
  const entries = loadSongs(projectDir);
  const target = entries.find((entry) => entry.song.song_id === id);
  if (!target) return { ok: false, error: 'song not found' };
  fs.unlinkSync(target.filePath);
  loadSongs(projectDir).forEach((entry, index) => {
    entry.song.order = index + 1;
    saveSongFile(projectDir, entry.song, entry.filePath);
  });
  return { ok: true, songs: loadSongs(projectDir).map((entry) => entry.song) };
}

function moveSong(payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const id = sanitizeId(payload.song_id || payload.id || '');
  const direction = String(payload.direction || '').toLowerCase();
  const entries = loadSongs(projectDir);
  const index = entries.findIndex((entry) => entry.song.song_id === id);
  if (index < 0) return { ok: false, error: 'song not found' };
  const nextIndex = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index;
  if (nextIndex < 0 || nextIndex >= entries.length || nextIndex === index) {
    return { ok: true, moved: false, songs: entries.map((entry) => entry.song) };
  }
  const reordered = entries.slice();
  const [entry] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, entry);
  reordered.forEach((item, orderIndex) => {
    item.song.order = orderIndex + 1;
    saveSongFile(projectDir, item.song, item.filePath);
  });
  return { ok: true, moved: true, song: entry.song, songs: loadSongs(projectDir).map((item) => item.song) };
}

function validateRhythmProject(payload = {}, context = {}) {
  const projectDir = context.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const resources = getResources(projectDir, context.assets || payload.assets || []);
  const songs = buildExportSongs(projectDir);
  const errors = [];
  const warnings = [];
  duplicateResourceNames(resources).forEach((duplicate) => {
    errors.push(`resources.res に重複したアセット名があります: ${duplicate.name} (${duplicate.entries.map(formatResourceLocation).join(', ')})`);
  });

  songs.forEach((song) => {
    if (!song.song_id) errors.push('song_id が空の楽曲があります。');
    if (song.bpm < 30 || song.bpm > 300) warnings.push(`[${song.title}] BPM が通常範囲外です。`);
    DIFFICULTIES.forEach((diff) => {
      const notes = song.charts?.[diff]?.notes || [];
      if (notes.length > 1024) errors.push(`[${song.title}/${diff}] ノーツ数が 1024 を超えています。`);
      notes.forEach((note, index) => {
        if (!VALID_NOTE_TYPES.has(note.type)) errors.push(`[${song.title}/${diff}] ノーツ${index}: type が不正です。`);
        if (!VALID_PATTERNS.has(note.pattern)) errors.push(`[${song.title}/${diff}] ノーツ${index}: pattern が不正です。`);
        if ((note.pattern === 'HOLD' || note.pattern === 'RAPID') && note.duration <= 0) {
          warnings.push(`[${song.title}/${diff}] ノーツ${index}: ${note.pattern} の duration が 0 です。`);
        }
      });
    });
    const audioAsset = findAsset(resources, song.audio_symbol);
    if (song.audio_symbol && (!audioAsset || audioAsset.type !== 'WAV')) {
      warnings.push(`[${song.title}] audio_symbol は WAV ではありません。ビルドではサンプル曲にフォールバックします。`);
    }
  });

  return { ok: errors.length === 0, errors, warnings, songCount: songs.length };
}

function exportRhythmData(payload = {}, context = {}) {
  const projectDir = context.projectDir || payload.projectDir;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  const templateRoot = payload.templateRoot || context.templateRoot || '';
  try {
    syncTemplateAssets(projectDir, templateRoot);
    writeStaticResFiles(projectDir);
    const { songs, settings } = buildRhythmRes(projectDir, context.assets || payload.assets || []);
    writeRhythmAliasHeader(projectDir);
    writeGeneratedSources(projectDir, songs, settings);
    return {
      ok: true,
      songs,
      files: [
        'res/font.res',
        'res/wobble.res',
        'res/rhythm.res',
        'inc/rhythm_resources.h',
        'inc/song_data.h',
        'inc/game_def.h',
        'src/song_data.c',
      ],
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = {
  DIFFICULTIES,
  SYSTEM_ASSET_SLOTS,
  SAMPLE_SYMBOLS,
  normalizeSong,
  readSettings,
  listSongs,
  saveSong,
  deleteSong,
  moveSong,
  listSettings,
  saveSettings,
  validateRhythmProject,
  exportRhythmData,
  getResources,
};
