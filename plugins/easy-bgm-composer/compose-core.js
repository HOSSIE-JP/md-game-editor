'use strict';

// かんたん作曲エンジン(ルールベース・依存ゼロ)。
// 生成の「音楽らしさ」を調整する定数はこのファイル冒頭に集約しています。

const STEPS_PER_BAR = 16;
const BAR_CHOICES = [2, 4, 8, 16, 32];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ATTRIBUTE_KEYS = ['melodyDensity', 'rhythmDensity', 'speed', 'drama', 'brightness', 'hook', 'smoothness'];
const TRACK_IDS = ['lead', 'harmony', 'bass'];
const DRUM_IDS = ['kick', 'snare', 'hat'];
const MIDI_MIN = 36;
const MIDI_MAX = 96;
const HARMONY_LOW = 52;
const BASS_REGISTER = [40, 55];
const TEMPO_UI_MIN = 60;
const TEMPO_UI_MAX = 240;

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  miyakobushi: [0, 1, 5, 7, 8],
  wholetone: [0, 2, 4, 6, 8, 10],
};

// トライアド導出用の7音スケール(5音・6音音階のフォールバック)
const CHORD_SCALE_FALLBACK = { miyakobushi: 'phrygian', wholetone: 'lydian' };

const QUALITY_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
};
const QUALITY_SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus4' };

const SECTION_LABELS = { A: 'メロ', A2: 'メロ2', dev: '展開', chorus: 'サビ' };

const ATTRIBUTE_DEFS = [
  { key: 'melodyDensity', label: 'にぎやかさ(メロディ)', lowLabel: '静か', highLabel: '密' },
  { key: 'rhythmDensity', label: 'にぎやかさ(リズム)', lowLabel: 'ゆったり', highLabel: '刻む' },
  { key: 'speed', label: 'スピード', lowLabel: '遅い', highLabel: '速い' },
  { key: 'drama', label: 'ドラマ', lowLabel: '安定', highLabel: '展開' },
  { key: 'brightness', label: '明暗', lowLabel: '暗い', highLabel: '明るい' },
  { key: 'hook', label: 'フック', lowLabel: '変化', highLabel: 'くり返し' },
  { key: 'smoothness', label: 'なめらかさ', lowLabel: '跳ねる', highLabel: '歌う' },
];

// テーマ定義: attrs は 50 からの上書きのみ記述
const THEMES = [
  { id: 'bright', label: '明るい', mode: 'major', tonics: [0, 7, 5], tempo: [120, 160], drumStyle: 'rock',
    patches: { lead: 'brass', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { brightness: 70 },
    chordPool: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'V', 'I'], ['I', 'vi', 'IV', 'V']] },
  { id: 'sad', label: '悲しい', mode: 'minor', tonics: [9, 4, 2], tempo: [70, 100], drumStyle: 'sparse',
    patches: { lead: 'strings', harmony: 'strings', bass: 'bass' }, register: [57, 81],
    attrs: { brightness: 25, melodyDensity: 40, smoothness: 70 },
    chordPool: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'VII']] },
  { id: 'battle', label: '戦い', mode: 'minor', tonics: [9, 4, 7], tempo: [150, 185], drumStyle: 'rock',
    patches: { lead: 'brass', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { melodyDensity: 65, rhythmDensity: 75, brightness: 35, smoothness: 35 },
    chordPool: [['i', 'VI', 'VII', 'i'], ['i', 'iv', 'VII', 'III'], ['i', 'VII', 'i', 'V']] },
  { id: 'lastboss', label: 'ラスボス', mode: 'phrygian', tonics: [4, 9, 2], tempo: [140, 180], drumStyle: 'dance',
    patches: { lead: 'brass', harmony: 'strings', bass: 'bass' }, register: [58, 82],
    attrs: { melodyDensity: 70, rhythmDensity: 85, brightness: 10, drama: 70, smoothness: 25 },
    chordPool: [['i', 'II', 'i', 'II'], ['i', 'vii', 'II', 'i'], ['i', 'II', 'vii', 'i']] },
  { id: 'temple', label: '神殿', mode: 'dorian', tonics: [2, 7, 4], tempo: [80, 110], drumStyle: 'sparse',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [62, 86],
    attrs: { melodyDensity: 30, rhythmDensity: 25, smoothness: 65 },
    chordPool: [['i', 'IV', 'i', 'IV'], ['i', 'VII', 'IV', 'i'], ['i', 'IV', 'VII', 'i']] },
  { id: 'comedy', label: 'コメディ', mode: 'major', tonics: [0, 5, 7], tempo: [130, 170], drumStyle: 'march',
    patches: { lead: 'piano', harmony: 'bell', bass: 'bass' }, register: [62, 86],
    attrs: { brightness: 80, smoothness: 20, speed: 60, melodyDensity: 60 },
    chordPool: [['I', 'IV', 'V', 'I'], ['I', 'V', 'I', 'V'], ['I', 'IV', 'I', 'V']] },
  { id: 'haunted', label: 'おばけ屋敷', mode: 'harmonicMinor', tonics: [2, 9, 7], tempo: [90, 120], drumStyle: 'sparse',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [57, 81],
    attrs: { brightness: 15, smoothness: 30, melodyDensity: 40, drama: 60 },
    chordPool: [['i', 'V', 'i', 'V'], ['i', 'iv', 'V', 'i'], ['i', 'vii', 'i', 'V']] },
  { id: 'coast', label: '海岸', mode: 'major', tonics: [5, 0, 10], tempo: [100, 130], drumStyle: 'dance',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { brightness: 65, smoothness: 70, rhythmDensity: 40 },
    chordPool: [['I', 'IV', 'I', 'V'], ['I', 'ii', 'IV', 'V'], ['IV', 'V', 'iii', 'vi']] },
  { id: 'desert', label: '砂漠', mode: 'harmonicMinor', tonics: [2, 7, 4], tempo: [110, 140], drumStyle: 'dance',
    patches: { lead: 'strings', harmony: 'bell', bass: 'bass' }, register: [59, 83],
    attrs: { brightness: 35, smoothness: 55 },
    chordPool: [['i', 'V', 'i', 'V'], ['i', 'iv', 'i', 'V'], ['i', 'VI', 'V', 'i']] },
  { id: 'wafu', label: '和風', mode: 'miyakobushi', tonics: [4, 9, 2], tempo: [90, 130], drumStyle: 'wafu',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { melodyDensity: 40, rhythmDensity: 35, smoothness: 60 },
    chordPool: [['i', 'II', 'i', 'II'], ['i', 'II', 'vii', 'i'], ['i', 'vii', 'II', 'i']] },
  { id: 'space', label: 'スペース', mode: 'lydian', tonics: [0, 7, 2], tempo: [100, 140], drumStyle: 'dance',
    patches: { lead: 'bell', harmony: 'bell', bass: 'bass' }, register: [62, 86],
    attrs: { smoothness: 60, brightness: 55, drama: 60 },
    chordPool: [['I', 'II', 'I', 'II'], ['I', 'II', 'vii', 'I'], ['I', 'V', 'II', 'I']] },
  { id: 'chase', label: 'チェイス', mode: 'minor', tonics: [9, 4, 11], tempo: [160, 200], drumStyle: 'dance',
    patches: { lead: 'brass', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { melodyDensity: 70, rhythmDensity: 85, speed: 80, smoothness: 30 },
    chordPool: [['i', 'VII', 'VI', 'VII'], ['i', 'iv', 'VII', 'i'], ['i', 'VI', 'VII', 'i']] },
  { id: 'ending', label: 'エンディング', mode: 'major', tonics: [0, 5, 7], tempo: [70, 95], drumStyle: 'sparse',
    patches: { lead: 'strings', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { melodyDensity: 35, rhythmDensity: 25, smoothness: 80, brightness: 60 },
    chordPool: [['I', 'V', 'vi', 'IV'], ['IV', 'V', 'I', 'I'], ['I', 'vi', 'ii', 'V']] },
  { id: 'cave', label: '洞窟', mode: 'minor', tonics: [2, 7, 0], tempo: [85, 115], drumStyle: 'sparse',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [55, 79],
    attrs: { melodyDensity: 25, rhythmDensity: 20, brightness: 20 },
    chordPool: [['i', 'VI', 'i', 'VII'], ['i', 'i', 'iv', 'i'], ['i', 'iv', 'VII', 'i']] },
  { id: 'snow', label: '雪原', mode: 'major', tonics: [7, 0, 2], tempo: [90, 120], drumStyle: 'sparse',
    patches: { lead: 'bell', harmony: 'strings', bass: 'bass' }, register: [62, 86],
    attrs: { smoothness: 75, melodyDensity: 40, brightness: 55 },
    chordPool: [['I', 'IV', 'I', 'IV'], ['I', 'iii', 'IV', 'V'], ['I', 'V', 'vi', 'IV']] },
  { id: 'victory', label: '勝利', mode: 'major', tonics: [0, 7], tempo: [120, 140], drumStyle: 'march',
    patches: { lead: 'brass', harmony: 'brass', bass: 'bass' }, register: [62, 86],
    attrs: { brightness: 85, melodyDensity: 55, smoothness: 40 }, loopDefault: false,
    chordPool: [['I', 'IV', 'V', 'I'], ['I', 'V', 'IV', 'I']] },
  { id: 'gameover', label: 'ゲームオーバー', mode: 'harmonicMinor', tonics: [9, 2], tempo: [60, 85], drumStyle: 'none',
    patches: { lead: 'strings', harmony: 'strings', bass: 'bass' }, register: [55, 79],
    attrs: { brightness: 10, melodyDensity: 25, smoothness: 70 }, loopDefault: false,
    chordPool: [['i', 'iv', 'V', 'i'], ['i', 'VI', 'iv', 'i'], ['i', 'iv', 'i', 'V']] },
  { id: 'title', label: 'タイトル画面', mode: 'major', tonics: [0, 5, 7], tempo: [100, 135], drumStyle: 'rock',
    patches: { lead: 'brass', harmony: 'strings', bass: 'bass' }, register: [60, 84],
    attrs: { brightness: 60, drama: 55 },
    chordPool: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'vi', 'V']] },
];
const THEME_MAP = new Map(THEMES.map((theme) => [theme.id, theme]));
const KNOWN_PATCHES = new Set(['bell', 'bass', 'strings', 'percussion', 'piano', 'brass']);

// 作曲のたびに音色を少し変え、同じテーマでも音自体が単調にならないようにする候補群
const LEAD_PATCH_VARIANTS = {
  brass: ['brass', 'piano'],
  strings: ['strings', 'bell'],
  bell: ['bell', 'piano'],
  piano: ['piano', 'brass'],
};
const HARMONY_PATCH_VARIANTS = {
  strings: ['strings', 'bell'],
  bell: ['bell', 'strings'],
  brass: ['brass', 'strings'],
  piano: ['piano', 'strings'],
};

// コード進行プリセット。mode があればキーのモードをそちらへ寄せる。
const CHORD_PRESETS = [
  { id: 'canon', label: 'カノン進行', mode: 'major', degrees: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
  { id: 'royal', label: '王道進行', mode: 'major', degrees: ['IV', 'V', 'iii', 'vi'] },
  { id: 'komuro', label: '小室進行', mode: 'major', degrees: ['vi', 'IV', 'V', 'I'] },
  { id: 'poppunk', label: 'ポップパンク進行', mode: 'major', degrees: ['I', 'V', 'vi', 'IV'] },
  { id: 'marusa', label: '丸サ進行', mode: 'major', degrees: ['IV', 'III', 'vi', 'I'] },
  { id: 'fifties', label: '50s進行', mode: 'major', degrees: ['I', 'vi', 'IV', 'V'] },
  { id: 'sentimental', label: 'センチメンタル', mode: 'major', degrees: ['vi', 'IV', 'I', 'V'] },
  { id: 'andalusia', label: 'アンダルシア進行', mode: 'minor', degrees: ['i', 'VII', 'VI', 'V'] },
  { id: 'folk', label: 'フォーク', mode: 'major', degrees: ['I', 'IV', 'I', 'V'] },
  { id: 'blues', label: 'ブルース(8小節)', mode: 'major', degrees: ['I', 'IV', 'I', 'I', 'IV', 'IV', 'V', 'I'] },
  { id: 'epic', label: '壮大(マイナー)', mode: 'minor', degrees: ['i', 'VI', 'III', 'VII'] },
  { id: 'drone', label: 'ドローン', mode: 'minor', degrees: ['i', 'i', 'VII', 'i'] },
  { id: 'fantasy', label: '幻想(IV→iv)', mode: 'major', degrees: ['I', 'iii', 'IV', 'iv'] },
];
const CHORD_PRESET_MAP = new Map(CHORD_PRESETS.map((preset) => [preset.id, preset]));

// ドラム1小節テンプレ(16分ステップ)
const DRUM_STYLES = {
  rock: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  dance: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  march: { kick: [0, 8], snare: [4, 6, 12, 14], hat: [0, 4, 8, 12] },
  sparse: { kick: [0], snare: [8], hat: [0, 4, 8, 12] },
  wafu: { kick: [0, 10], snare: [6, 14], hat: [0, 8] },
  none: { kick: [], snare: [], hat: [] },
};

// ============================ ユーティリティ ============================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

function rollPct(rng, pct) {
  return rng() * 100 < pct;
}

function rangeInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function lerp(min, max, t) {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}

function newSongId() {
  return `song_${randomSeed().toString(16).padStart(8, '0')}`;
}

function midiToName(midi) {
  const value = clamp(midi, 0, 127, 60);
  return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12) - 1}`;
}

// ============================ コード進行 ============================

const ROMAN_VALUES = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

function parseDegree(text) {
  const match = String(text || '').trim().match(/^(b?)([ivIV]+)$/);
  if (!match) return { flat: false, index: 0, upper: true };
  const roman = match[2];
  const value = ROMAN_VALUES[roman.toLowerCase()] || 1;
  return { flat: match[1] === 'b', index: value - 1, upper: roman === roman.toUpperCase() };
}

function chordScaleFor(mode) {
  const resolved = CHORD_SCALE_FALLBACK[mode] || mode;
  const scale = SCALES[resolved] || SCALES.major;
  return scale.length === 7 ? scale : SCALES.minor;
}

function qualityFromIntervals(third, fifth) {
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'min';
  if (third === 3 && fifth === 6) return 'dim';
  if (third === 4 && fifth === 8) return 'aug';
  return 'maj';
}

function resolveDegree(degreeText, key, options = {}) {
  const { flat, index, upper } = parseDegree(degreeText);
  const scale = chordScaleFor(key.mode);
  const rootOffset = scale[index % 7] + (flat ? -1 : 0);
  const rootPc = ((key.tonicPc + rootOffset) % 12 + 12) % 12;
  let quality;
  if (options.forceQuality) {
    quality = options.forceQuality;
  } else if (flat) {
    quality = 'maj'; // 借用コード(bVI/bVII など)はメジャー扱い
  } else {
    const third = (scale[(index + 2) % 7] - scale[index % 7] + 12) % 12;
    const fifth = (scale[(index + 4) % 7] - scale[index % 7] + 12) % 12;
    const diatonic = qualityFromIntervals(third, fifth);
    // 大文字はメジャー志向(dim はそのまま)、小文字はダイアトニック優先
    quality = upper ? (diatonic === 'dim' ? 'dim' : 'maj') : diatonic;
  }
  const intervals = QUALITY_INTERVALS[quality] || QUALITY_INTERVALS.maj;
  return {
    degree: String(degreeText),
    rootPc,
    quality,
    symbol: `${NOTE_NAMES[rootPc]}${QUALITY_SUFFIX[quality] ?? ''}`,
    tones: intervals.map((interval) => (rootPc + interval) % 12),
  };
}

function buildSections(bars) {
  if (bars === 16) {
    return [
      { role: 'A', startBar: 0, bars: 8 },
      { role: 'chorus', startBar: 8, bars: 8 },
    ];
  }
  if (bars === 32) {
    return [
      { role: 'A', startBar: 0, bars: 8 },
      { role: 'A2', startBar: 8, bars: 8 },
      { role: 'dev', startBar: 16, bars: 8 },
      { role: 'chorus', startBar: 24, bars: 8 },
    ];
  }
  return [{ role: 'A', startBar: 0, bars }];
}

function tonicDegreeFor(mode) {
  const scale = chordScaleFor(mode);
  const third = (scale[2] - scale[0] + 12) % 12;
  return third === 3 ? 'i' : 'I';
}

function generateChords(rng, { theme, key, bars, sections, preset, cadence, drama }) {
  const degreesByBar = new Array(bars).fill(null);
  const overrides = new Map(); // bar -> {degree, forceQuality}
  const pool = theme.chordPool || [['I', 'IV', 'V', 'I']];
  let previousProgression = null;

  sections.forEach((section, sectionIndex) => {
    let degrees;
    if (preset) {
      degrees = preset.degrees;
      // サビはプリセットの進行を回転させ、ヴァースと違う入り方にする
      if (section.role === 'chorus' && preset.degrees.length > 2) {
        const rotate = Math.floor(preset.degrees.length / 2);
        degrees = [...preset.degrees.slice(rotate), ...preset.degrees.slice(0, rotate)];
      }
    } else {
      degrees = pick(rng, pool);
      if (section.role === 'chorus' && pool.length > 1) {
        const others = pool.filter((entry) => entry !== previousProgression);
        degrees = pick(rng, others.length ? others : pool);
      }
      previousProgression = degrees;
    }
    for (let offset = 0; offset < section.bars; offset += 1) {
      degreesByBar[section.startBar + offset] = degrees[offset % degrees.length];
    }
    // 展開セクションは借用コードで揺らす(メジャー系のみ、プリセット指定時も適用)
    if (section.role === 'dev' && chordScaleFor(key.mode) === SCALES.major && rollPct(rng, drama * 0.5)) {
      const swapOffset = rangeInt(rng, 1, section.bars - 2);
      degreesByBar[section.startBar + swapOffset] = pick(rng, ['bVII', 'bVI']);
    }
    if (cadence) {
      const isLast = sectionIndex === sections.length - 1;
      const endBar = section.startBar + section.bars - 1;
      if (isLast) {
        if (section.bars >= 2) overrides.set(endBar - 1, { degree: 'V', forceQuality: 'maj' });
        overrides.set(endBar, { degree: tonicDegreeFor(key.mode) });
      } else {
        overrides.set(endBar, { degree: 'V', forceQuality: 'maj' });
      }
    }
  });

  return degreesByBar.map((degreeText, bar) => {
    const override = overrides.get(bar);
    const resolved = override
      ? resolveDegree(override.degree, key, { forceQuality: override.forceQuality })
      : resolveDegree(degreeText || tonicDegreeFor(key.mode), key);
    return { bar, ...resolved };
  });
}

// ============================ メロディ ============================

function scalePitchesFor(key, low, high) {
  const pcs = new Set((SCALES[key.mode] || SCALES.major).map((offset) => (key.tonicPc + offset) % 12));
  const pitches = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (pcs.has(midi % 12)) pitches.push(midi);
  }
  return pitches;
}

function chordPitchesFor(chord, low, high) {
  const pcs = new Set(chord.tones);
  const pitches = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (pcs.has(midi % 12)) pitches.push(midi);
  }
  return pitches;
}

function nearestPitch(candidates, target) {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const midi of candidates) {
    const dist = Math.abs(midi - target);
    if (dist < bestDist) {
      best = midi;
      bestDist = dist;
    }
  }
  return best;
}

const ONSET_CANDIDATES = [0, 8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];

function pickOnsets(rng, count, speed) {
  const chosen = new Set([0]);
  const weights = ONSET_CANDIDATES.map((step) => {
    if (step % 4 === 0) return 4;
    if (step % 2 === 0) return 2.2;
    return speed > 60 ? 1.4 : speed > 30 ? 0.5 : 0.1;
  });
  let guard = 0;
  while (chosen.size < count && guard < 200) {
    guard += 1;
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = rng() * total;
    for (let i = 0; i < ONSET_CANDIDATES.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        chosen.add(ONSET_CANDIDATES[i]);
        break;
      }
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

function noteLengthFor(rng, gap, speed) {
  if (speed > 70) return rollPct(rng, 60) ? 1 : Math.min(gap, 2);
  if (speed < 35) return gap;
  return Math.min(gap, rollPct(rng, 50) ? 2 : 1 + rangeInt(rng, 0, 2));
}

function pickMelodyPitch(rng, { prev, chord, scalePitches, register, smoothness, strong, center }) {
  const [low, high] = register;
  const chordPitches = chordPitchesFor(chord, low, high);
  const candidates = strong && chordPitches.length ? chordPitches : scalePitches;
  if (!candidates.length) return clamp(center, low, high, low);
  if (prev == null) return nearestPitch(chordPitches.length ? chordPitches : candidates, center);
  const stepwiseP = 35 + smoothness * 0.6;
  if (rollPct(rng, stepwiseP)) {
    // 順次進行: 直前の音の上下いずれかの最近傍(中心へ弱いドリフト)
    const upward = prev < center ? rollPct(rng, 65) : rollPct(rng, 35);
    const pool = candidates.filter((midi) => (upward ? midi > prev : midi < prev));
    if (pool.length) return upward ? pool[0] : pool[pool.length - 1];
    return nearestPitch(candidates, prev);
  }
  const maxLeap = smoothness < 50 ? 10 : 6;
  const pool = candidates.filter((midi) => midi !== prev && Math.abs(midi - prev) <= maxLeap);
  if (!pool.length) return nearestPitch(candidates, prev);
  const weights = pool.map((midi) => 1 / Math.abs(midi - prev));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function sectionTransformFor(rng, section, attrs) {
  const drama = attrs.drama;
  if (section.role === 'chorus') {
    return { registerShift: drama > 55 ? 12 : 4, densityMul: 1.2, halftime: false };
  }
  if (section.role === 'dev') {
    if (drama > 50) {
      return rollPct(rng, 50)
        ? { registerShift: -12, densityMul: 1, halftime: false }
        : { registerShift: 0, densityMul: 0.6, halftime: true };
    }
    return { registerShift: 0, densityMul: 0.85, halftime: false };
  }
  if (section.role === 'A2') {
    return { registerShift: 0, densityMul: 1.05, halftime: false };
  }
  return { registerShift: 0, densityMul: 1, halftime: false };
}

function generatePhraseRhythm(rng, { phraseBars, attrs, transform, cadence, isFinalPhrase }) {
  const onsets = [];
  for (let bar = 0; bar < phraseBars; bar += 1) {
    const baseCount = Math.round(lerp(2, 10, attrs.melodyDensity / 100) * transform.densityMul);
    let count = clamp(baseCount + rangeInt(rng, -1, 1), 1, 12, 4);
    if (transform.halftime) count = Math.max(1, Math.round(count / 2));
    const lastBar = bar === phraseBars - 1;
    if (cadence && lastBar) count = Math.min(count, 3);
    let steps = pickOnsets(rng, count, transform.halftime ? Math.max(0, attrs.speed - 30) : attrs.speed);
    if (cadence && lastBar && isFinalPhrase) steps = steps.filter((step) => step <= 8);
    steps.forEach((step, index) => {
      const gap = (index + 1 < steps.length ? steps[index + 1] : STEPS_PER_BAR) - step;
      let length = noteLengthFor(rng, gap, attrs.speed);
      if (transform.halftime) length = Math.min(gap, length * 2);
      if (cadence && lastBar && index === steps.length - 1) {
        length = Math.max(length, Math.min(4, STEPS_PER_BAR - step - 2));
      }
      onsets.push({ offset: bar * STEPS_PER_BAR + step, length: Math.max(1, length) });
    });
  }
  return onsets;
}

function generateMelody(rng, ctx) {
  const { chords, sections, attrs, options, key, theme, bars } = ctx;
  const notes = [];
  const scaleCache = new Map();
  const scaleFor = (low, high) => {
    const cacheKey = `${low}:${high}`;
    if (!scaleCache.has(cacheKey)) scaleCache.set(cacheKey, scalePitchesFor(key, low, high));
    return scaleCache.get(cacheKey);
  };
  // モチーフはセクションの「役割」ごとに独立させる(A2はAのモチーフを継承して
  // 一体感を出しつつ、dev/サビは自分専用のモチーフを持つことで曲全体が
  // 冒頭2小節の変形だけにならないようにする)
  const motifsByRole = new Map(); // roleKey -> { rhythm, pitches, rootPc, registerShift }
  const motifRoleKey = (role) => (role === 'A2' ? 'A' : role);
  let prev = null;

  for (const section of sections) {
    const transform = sectionTransformFor(rng, section, attrs);
    const register = [
      clamp(theme.register[0] + transform.registerShift, MIDI_MIN, MIDI_MAX, theme.register[0]),
      clamp(theme.register[1] + transform.registerShift, MIDI_MIN, MIDI_MAX, theme.register[1]),
    ];
    const center = Math.round((register[0] + register[1]) / 2);
    const scalePitches = scaleFor(register[0], register[1]);
    const roleKey = motifRoleKey(section.role);
    let phraseInSection = 0;
    for (let phraseStart = section.startBar; phraseStart < section.startBar + section.bars; phraseStart += 2) {
      const phraseBars = Math.min(2, section.startBar + section.bars - phraseStart);
      const isFinalPhrase = phraseStart + phraseBars >= bars;
      const baseStep = phraseStart * STEPS_PER_BAR;
      const chordAt = (offset) => chords[Math.min(bars - 1, phraseStart + Math.floor(offset / STEPS_PER_BAR))];

      const motif = motifsByRole.get(roleKey) || null;
      let phraseNotes = null;
      const restateMotif = motif
        && ((options.sequence && phraseInSection === 1)
          || ((phraseInSection === 0 || phraseInSection === 2) && rollPct(rng, attrs.hook)));
      if (restateMotif) {
        // モチーフ再現: リズム維持、ピッチは現行コードへ再スナップ(移調反復)
        const shift = chordAt(0).rootPc - motif.rootPc;
        const delta = ((shift + 6) % 12 + 12) % 12 - 6 + transform.registerShift - motif.registerShift;
        phraseNotes = motif.rhythm.map((slot, index) => {
          const chord = chordAt(slot.offset);
          const strong = slot.offset % 4 === 0;
          const target = motif.pitches[index] + delta;
          const candidates = strong ? chordPitchesFor(chord, register[0], register[1]) : scalePitches;
          const midi = candidates.length ? nearestPitch(candidates, target) : clamp(target, register[0], register[1], center);
          return { step: baseStep + slot.offset, length: slot.length, midiNote: midi };
        });
      } else {
        const rhythm = generatePhraseRhythm(rng, {
          phraseBars, attrs, transform, cadence: options.cadence, isFinalPhrase,
        });
        phraseNotes = rhythm.map((slot) => {
          const chord = chordAt(slot.offset);
          const strong = slot.offset % 4 === 0;
          const midi = pickMelodyPitch(rng, {
            prev, chord, scalePitches, register, smoothness: attrs.smoothness, strong, center,
          });
          prev = midi;
          return { step: baseStep + slot.offset, length: slot.length, midiNote: midi };
        });
        if (!motif && phraseNotes.length) {
          motifsByRole.set(roleKey, {
            rhythm: phraseNotes.map((note) => ({ offset: note.step - baseStep, length: note.length })),
            pitches: phraseNotes.map((note) => note.midiNote),
            rootPc: chordAt(0).rootPc,
            registerShift: transform.registerShift,
          });
        }
      }
      if (phraseNotes.length) prev = phraseNotes[phraseNotes.length - 1].midiNote;
      notes.push(...phraseNotes);
      phraseInSection += 1;
    }
  }

  // カデンツ: 最後の音を最終コードのルート/5度へ着地させる
  if (options.cadence && notes.length) {
    const finalChord = chords[bars - 1];
    const last = notes[notes.length - 1];
    const targets = [finalChord.tones[0], finalChord.tones[2] ?? finalChord.tones[0]];
    const candidates = [];
    for (let midi = theme.register[0]; midi <= theme.register[1]; midi += 1) {
      if (targets.includes(midi % 12)) candidates.push(midi);
    }
    if (candidates.length) last.midiNote = nearestPitch(candidates, last.midiNote);
    const remaining = bars * STEPS_PER_BAR - last.step;
    last.length = Math.max(last.length, Math.min(4, remaining));
  }
  return notes;
}

// ============================ ハモリ・ベース・ドラム ============================

function generateHarmony(rng, { lead, chords, bars }) {
  const notes = [];
  for (const note of lead) {
    const strong = note.step % 4 === 0;
    if (note.length < 2 && !strong) continue;
    if (!rollPct(rng, 85)) continue;
    const chord = chords[Math.min(bars - 1, Math.floor(note.step / STEPS_PER_BAR))];
    const candidates = chordPitchesFor(chord, HARMONY_LOW, note.midiNote - 3)
      .filter((midi) => note.midiNote - midi <= 9);
    if (!candidates.length) continue;
    notes.push({ step: note.step, length: note.length, midiNote: candidates[candidates.length - 1] });
  }
  return notes;
}

function bassPitchFor(pc, center = 46) {
  let midi = pc + 36;
  while (midi < BASS_REGISTER[0]) midi += 12;
  while (midi > BASS_REGISTER[1]) midi -= 12;
  if (midi < BASS_REGISTER[0]) midi = BASS_REGISTER[0];
  return Math.abs(midi - center) > Math.abs(midi + 12 - center) && midi + 12 <= BASS_REGISTER[1] ? midi + 12 : midi;
}

function generateBass(rng, { chords, attrs, bars }) {
  const notes = [];
  const density = attrs.rhythmDensity;
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = chords[bar];
    const base = bar * STEPS_PER_BAR;
    const root = bassPitchFor(chord.rootPc);
    const fifth = root + 7 <= BASS_REGISTER[1] ? root + 7 : root - 5;
    if (density < 33) {
      if (rollPct(rng, 50)) {
        notes.push({ step: base, length: 14, midiNote: root });
      } else {
        notes.push({ step: base, length: 7, midiNote: root });
        notes.push({ step: base + 8, length: 6, midiNote: root });
      }
    } else if (density < 67) {
      const pattern = pick(rng, [
        [root, root, fifth, root],
        [root, fifth, root, fifth],
        [root, root, root, fifth],
      ]);
      pattern.forEach((midi, index) => {
        notes.push({ step: base + index * 4, length: 3, midiNote: midi });
      });
    } else {
      const octave = root + 12 <= BASS_REGISTER[1] + 4 ? root + 12 : root;
      const pattern = pick(rng, [
        [root, root, fifth, root, octave, root, fifth, root],
        [root, root, root, fifth, root, root, octave, fifth],
      ]);
      pattern.forEach((midi, index) => {
        notes.push({ step: base + index * 2, length: 1, midiNote: clamp(midi, MIDI_MIN, BASS_REGISTER[1] + 4, root) });
      });
      // 次の小節への経過音
      if (bar + 1 < bars && rollPct(rng, 45)) {
        const nextRoot = bassPitchFor(chords[bar + 1].rootPc);
        const approach = nextRoot + (nextRoot > root ? -1 : 1);
        notes[notes.length - 1].midiNote = clamp(approach, BASS_REGISTER[0] - 2, BASS_REGISTER[1] + 4, nextRoot);
      }
    }
  }
  return notes;
}

function generateDrums(rng, { theme, attrs, bars, sections }) {
  const style = DRUM_STYLES[theme.drumStyle] || DRUM_STYLES.rock;
  const kick = new Set();
  const snare = new Set();
  const hat = new Set();
  const density = attrs.rhythmDensity;
  const sectionEnds = new Set(sections.map((section) => section.startBar + section.bars - 1));

  for (let bar = 0; bar < bars; bar += 1) {
    const base = bar * STEPS_PER_BAR;
    const isFill = sectionEnds.has(bar) && theme.drumStyle !== 'none' && rollPct(rng, attrs.drama * 0.8);
    style.kick.forEach((step) => kick.add(base + step));
    style.snare.forEach((step) => snare.add(base + step));
    if (density > 60 && theme.drumStyle !== 'none' && rollPct(rng, 40)) {
      kick.add(base + pick(rng, [7, 10]));
    }
    let hatSteps = style.hat;
    if (theme.drumStyle === 'rock' || theme.drumStyle === 'march' || theme.drumStyle === 'sparse') {
      if (density < 30) hatSteps = [0, 4, 8, 12];
      else if (density < 70) hatSteps = [0, 2, 4, 6, 8, 10, 12, 14];
      else hatSteps = Array.from({ length: 16 }, (_, i) => i);
    } else if (theme.drumStyle === 'dance' && density > 70) {
      hatSteps = [2, 3, 6, 7, 10, 11, 14, 15];
    }
    hatSteps.forEach((step) => hat.add(base + step));
    if (isFill) {
      [12, 13, 14, 15].forEach((step) => {
        if (step >= 13 || rollPct(rng, 50)) snare.add(base + step);
        hat.delete(base + step);
      });
    }
  }
  // NOISE ch 共有のためスネアと同stepのハットは置かない
  for (const step of snare) hat.delete(step);
  const sorted = (set) => [...set].sort((a, b) => a - b);
  return { kick: sorted(kick), snare: sorted(snare), hat: sorted(hat) };
}

// ============================ 正規化 ============================

function normalizeAttributes(attributes = {}) {
  const next = {};
  for (const key of ATTRIBUTE_KEYS) {
    next[key] = clamp(attributes[key], 0, 100, 50);
  }
  return next;
}

function normalizeNotes(list, { maxStep }) {
  const valid = (Array.isArray(list) ? list : [])
    .map((note) => ({
      step: clamp(note?.step, 0, maxStep - 1, 0),
      length: clamp(note?.length, 1, maxStep, 1),
      midiNote: clamp(note?.midiNote, MIDI_MIN - 12, MIDI_MAX + 12, 60),
    }))
    .sort((a, b) => a.step - b.step || a.midiNote - b.midiNote);
  const result = [];
  for (const note of valid) {
    const prev = result[result.length - 1];
    if (prev && prev.step === note.step) {
      result[result.length - 1] = note; // 同stepは後勝ち
      continue;
    }
    if (prev && prev.step + prev.length > note.step) {
      prev.length = note.step - prev.step; // 重複は前の音を詰める
      if (prev.length < 1) result.pop();
    }
    note.length = Math.min(note.length, maxStep - note.step);
    result.push(note);
  }
  return result;
}

function normalizeDrumSteps(list, { maxStep }) {
  const steps = (Array.isArray(list) ? list : [])
    .map((step) => clamp(step, 0, maxStep - 1, 0));
  return [...new Set(steps)].sort((a, b) => a - b);
}

function normalizeMixer(mixer = {}) {
  const defaults = {
    lead: { volume: 12 },
    harmony: { volume: 10 },
    bass: { volume: 11 },
    drums: { volume: 11 },
  };
  const next = {};
  for (const [track, base] of Object.entries(defaults)) {
    const entry = mixer?.[track] || {};
    next[track] = {
      volume: clamp(entry.volume, 0, 15, base.volume),
      mute: Boolean(entry.mute),
      solo: Boolean(entry.solo),
    };
  }
  return next;
}

function normalizeInstruments(instruments, theme) {
  const base = theme.patches || {};
  const resolve = (value, fallback) => (KNOWN_PATCHES.has(value) ? value : (KNOWN_PATCHES.has(fallback) ? fallback : 'brass'));
  return {
    lead: resolve(instruments?.lead, base.lead),
    harmony: resolve(instruments?.harmony, base.harmony),
    bass: resolve(instruments?.bass, base.bass || 'bass'),
  };
}

function normalizeChords(chords, { bars, key }) {
  const fallback = resolveDegree(tonicDegreeFor(key.mode), key);
  const result = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const entry = Array.isArray(chords) ? chords[bar] : null;
    if (entry && Array.isArray(entry.tones) && entry.tones.length) {
      const rootPc = clamp(entry.rootPc, 0, 11, fallback.rootPc);
      const quality = QUALITY_INTERVALS[entry.quality] ? entry.quality : 'maj';
      result.push({
        bar,
        degree: String(entry.degree || ''),
        rootPc,
        quality,
        symbol: String(entry.symbol || `${NOTE_NAMES[rootPc]}${QUALITY_SUFFIX[quality] ?? ''}`),
        tones: QUALITY_INTERVALS[quality].map((interval) => (rootPc + interval) % 12),
      });
    } else {
      result.push({ bar, ...fallback });
    }
  }
  return result;
}

function normalizeEasySong(song = {}) {
  const bars = BAR_CHOICES.includes(Number(song.bars)) ? Number(song.bars) : 8;
  const maxStep = bars * STEPS_PER_BAR;
  const theme = THEME_MAP.get(song.themeId) || THEMES[0];
  const mode = SCALES[song.key?.mode] ? song.key.mode : theme.mode;
  const key = { tonicPc: clamp(song.key?.tonicPc, 0, 11, theme.tonics[0]), mode };
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: /^[A-Za-z0-9_-]+$/.test(String(song.id || '')) ? String(song.id) : newSongId(),
    name: String(song.name || '').trim() || '新しいBGM',
    themeId: theme.id,
    bars,
    tempo: clamp(song.tempo, 30, 300, 140),
    loop: song.loop !== false,
    attributes: normalizeAttributes(song.attributes),
    options: {
      sequence: song.options?.sequence !== false,
      cadence: song.options?.cadence !== false,
      chordPresetId: CHORD_PRESET_MAP.has(song.options?.chordPresetId) ? song.options.chordPresetId : null,
      seed: (Number(song.options?.seed) >>> 0) || randomSeed(),
    },
    key,
    instruments: normalizeInstruments(song.instruments, theme),
    sections: buildSections(bars),
    chords: normalizeChords(song.chords, { bars, key }),
    tracks: {
      lead: normalizeNotes(song.tracks?.lead, { maxStep }),
      harmony: normalizeNotes(song.tracks?.harmony, { maxStep }),
      bass: normalizeNotes(song.tracks?.bass, { maxStep }),
    },
    drums: {
      kick: normalizeDrumSteps(song.drums?.kick, { maxStep }),
      snare: normalizeDrumSteps(song.drums?.snare, { maxStep }),
      hat: normalizeDrumSteps(song.drums?.hat, { maxStep }),
    },
    mixer: normalizeMixer(song.mixer),
    createdAt: String(song.createdAt || now),
    updatedAt: String(song.updatedAt || now),
    lastExport: song.lastExport && typeof song.lastExport === 'object' ? song.lastExport : null,
  };
}

// ============================ 作曲エントリポイント ============================

function createDefaultEasySong(options = {}) {
  return normalizeEasySong({
    name: options.name,
    themeId: options.themeId || 'bright',
    bars: options.bars || 4,
    tempo: options.tempo,
  });
}

function composeEasySong(payload = {}) {
  const existing = payload.existing && typeof payload.existing === 'object' ? payload.existing : null;
  const theme = THEME_MAP.get(payload.themeId || existing?.themeId) || THEMES[0];
  const bars = BAR_CHOICES.includes(Number(payload.bars))
    ? Number(payload.bars)
    : (existing?.bars || 8);
  const seedInput = payload.options?.seed;
  const seed = seedInput == null ? randomSeed() : (Number(seedInput) >>> 0);
  const rng = mulberry32(seed);

  const attrs = normalizeAttributes({ ...theme.attrs, ...(payload.attributes || {}) });
  const presetId = payload.options?.chordPresetId ?? null;
  const preset = CHORD_PRESET_MAP.get(presetId) || null;

  // キー決定: プリセットのモード指定 > テーマ、明暗による平行調フリップ
  let mode = preset?.mode && SCALES[preset.mode] ? preset.mode : theme.mode;
  let tonicPc = pick(rng, theme.tonics);
  if (mode === 'major' && attrs.brightness < 25) {
    mode = 'minor';
    tonicPc = (tonicPc + 9) % 12;
  } else if (mode === 'minor' && attrs.brightness > 75) {
    mode = 'major';
    tonicPc = (tonicPc + 3) % 12;
  }
  const key = { tonicPc, mode };

  // 音色もSHUFFLE/おまかせ作曲のたびに候補群から選び直し、テーマが同じでも
  // 毎回まったく同じ音色にならないようにする
  const patchDefaults = theme.patches || {};
  const instruments = {
    lead: pick(rng, LEAD_PATCH_VARIANTS[patchDefaults.lead] || [patchDefaults.lead || 'brass']),
    harmony: pick(rng, HARMONY_PATCH_VARIANTS[patchDefaults.harmony] || [patchDefaults.harmony || 'strings']),
    bass: patchDefaults.bass || 'bass',
  };

  const tempo = clamp(
    payload.tempo ?? Math.round(lerp(theme.tempo[0], theme.tempo[1], attrs.speed / 100)),
    30, 300, 140,
  );
  const options = {
    sequence: payload.options?.sequence !== false,
    cadence: payload.options?.cadence !== false,
    chordPresetId: preset ? preset.id : null,
    seed,
  };
  const sections = buildSections(bars);
  const chords = generateChords(rng, {
    theme, key, bars, sections, preset, cadence: options.cadence, drama: attrs.drama,
  });
  const lead = generateMelody(rng, { chords, sections, attrs, options, key, theme, bars });
  const harmony = generateHarmony(rng, { lead, chords, bars });
  const bass = generateBass(rng, { chords, attrs, bars });
  const drums = generateDrums(rng, { theme, attrs, bars, sections });

  return normalizeEasySong({
    id: existing?.id,
    name: existing?.name || `${theme.label}のBGM`,
    themeId: theme.id,
    bars,
    tempo,
    loop: payload.loop ?? existing?.loop ?? theme.loopDefault ?? true,
    attributes: attrs,
    options,
    key,
    instruments,
    chords,
    tracks: { lead, harmony, bass },
    drums,
    mixer: existing?.mixer,
    createdAt: existing?.createdAt,
    lastExport: existing?.lastExport,
  });
}

function getDefs() {
  return {
    schemaVersion: 1,
    stepsPerBar: STEPS_PER_BAR,
    barChoices: [...BAR_CHOICES],
    themes: THEMES.map((theme) => ({
      id: theme.id,
      label: theme.label,
      mode: theme.mode,
      tempoRange: [...theme.tempo],
      loopDefault: theme.loopDefault !== false,
      defaultAttributes: normalizeAttributes(theme.attrs),
    })),
    chordPresets: CHORD_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, mode: preset.mode })),
    qualityIntervals: { ...QUALITY_INTERVALS },
    scales: { ...SCALES },
    sectionLabels: { ...SECTION_LABELS },
    attributeDefs: ATTRIBUTE_DEFS.map((def) => ({ ...def })),
    trackLabels: { lead: 'リード', harmony: 'ハモリ', bass: 'ベース' },
    drumLabels: { kick: 'キック', snare: 'スネア', hat: 'ハット' },
    noteNames: [...NOTE_NAMES],
    limits: {
      tempoMin: TEMPO_UI_MIN,
      tempoMax: TEMPO_UI_MAX,
      volumeMax: 15,
      midiMin: MIDI_MIN,
      midiMax: MIDI_MAX,
    },
  };
}

module.exports = {
  STEPS_PER_BAR,
  BAR_CHOICES,
  TRACK_IDS,
  DRUM_IDS,
  MIDI_MIN,
  MIDI_MAX,
  NOTE_NAMES,
  SCALES,
  QUALITY_INTERVALS,
  THEMES,
  CHORD_PRESETS,
  DRUM_STYLES,
  SECTION_LABELS,
  mulberry32,
  randomSeed,
  midiToName,
  resolveDegree,
  buildSections,
  normalizeEasySong,
  createDefaultEasySong,
  composeEasySong,
  getDefs,
};
