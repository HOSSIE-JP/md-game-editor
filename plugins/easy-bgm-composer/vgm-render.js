'use strict';

// easy-song → VGM 変換。
// 共有エンジン(md-audio-engine)の buildVgmEvents は全ノートを1行で
// 即ノートオフするためロングノートを表現できない。ここでは MdVgmWriter の
// プリミティブを直接使い、半ステップ(32分)分解能でキーオン/オフを制御する。

const mdAudio = require('../shared/md-audio-engine');
const compose = require('./compose-core');

const VGM_SAMPLE_RATE = 44100;
const TICKS_PER_STEP = 2; // 1ステップ=16分、tick=32分
const TRACK_FM_INDEX = { lead: 0, harmony: 1, bass: 2 };
const KICK_FM_INDEX = 3;
const KICK_MIDI = 36;
const SNARE_NF = 0x01; // ホワイトノイズ N/1024
const HAT_NF = 0x00;   // ホワイトノイズ N/512(明るめ)

// FM4 キック用カスタムパッチ(速いアタック+急減衰の低音)
const KICK_PATCH = {
  name: 'Easy Kick',
  algorithm: 4,
  feedback: 6,
  operators: [
    { dt1: 0, mul: 0, tl: 25, rs: 2, ar: 31, am: 0, d1r: 18, d2r: 8, d1l: 15, rr: 12, ssgEg: 0 },
    { dt1: 0, mul: 0, tl: 6, rs: 2, ar: 31, am: 0, d1r: 16, d2r: 6, d1l: 15, rr: 12, ssgEg: 0 },
    { dt1: 0, mul: 1, tl: 40, rs: 2, ar: 31, am: 0, d1r: 20, d2r: 10, d1l: 15, rr: 15, ssgEg: 0 },
    { dt1: 0, mul: 0, tl: 4, rs: 2, ar: 31, am: 0, d1r: 14, d2r: 8, d1l: 15, rr: 12, ssgEg: 0 },
  ],
};

function themeFor(themeId) {
  return compose.THEMES.find((theme) => theme.id === themeId) || compose.THEMES[0];
}

function patchFor(name) {
  if (name === 'kick') return KICK_PATCH;
  return mdAudio.FM_PATCHES[name] || mdAudio.FM_PATCHES.bell;
}

// 曲に保存された instruments(作曲時に選ばれた音色)を優先し、
// 無ければテーマの既定音色にフォールバックする
function patchNamesFor(song, theme) {
  const base = theme.patches || {};
  return {
    lead: song.instruments?.lead || base.lead || 'brass',
    harmony: song.instruments?.harmony || base.harmony || 'strings',
    bass: song.instruments?.bass || base.bass || 'bass',
  };
}

function volumeToVelocity(volume) {
  return Math.max(1, Math.round((volume * 127) / 15));
}

function resolveAudibleTracks(song) {
  const mixer = song.mixer || {};
  const solos = Object.entries(mixer).filter(([, entry]) => entry?.solo).map(([track]) => track);
  const audible = {};
  for (const track of ['lead', 'harmony', 'bass', 'drums']) {
    audible[track] = solos.length ? solos.includes(track) : !mixer[track]?.mute;
  }
  return audible;
}

function buildTickEvents(song) {
  const audible = resolveAudibleTracks(song);
  const totalTicks = song.bars * compose.STEPS_PER_BAR * TICKS_PER_STEP;
  const ons = new Map();
  const offs = new Map();
  const push = (map, tick, event) => {
    if (!map.has(tick)) map.set(tick, []);
    map.get(tick).push(event);
  };

  for (const [track, fmIndex] of Object.entries(TRACK_FM_INDEX)) {
    if (!audible[track]) continue;
    for (const note of song.tracks[track] || []) {
      const onTick = note.step * TICKS_PER_STEP;
      const offTick = Math.min((note.step + note.length) * TICKS_PER_STEP, totalTicks);
      if (onTick >= totalTicks) continue;
      push(ons, onTick, { kind: 'fm', fmIndex, midi: note.midiNote });
      push(offs, offTick, { kind: 'fm', fmIndex });
    }
  }

  if (audible.drums) {
    for (const step of song.drums.kick || []) {
      const onTick = step * TICKS_PER_STEP;
      if (onTick >= totalTicks) continue;
      push(ons, onTick, { kind: 'fm', fmIndex: KICK_FM_INDEX, midi: KICK_MIDI });
      push(offs, Math.min(onTick + 2, totalTicks), { kind: 'fm', fmIndex: KICK_FM_INDEX });
    }
    // NOISE ch はスネア優先で共有。後着音があるときはオフを書かない。
    const drumVolume = song.mixer?.drums?.volume ?? 11;
    const noiseEvents = [];
    for (const step of song.drums.snare || []) {
      noiseEvents.push({ tick: step * TICKS_PER_STEP, nf: SNARE_NF, volume: drumVolume, duration: 2, priority: 1 });
    }
    for (const step of song.drums.hat || []) {
      noiseEvents.push({ tick: step * TICKS_PER_STEP, nf: HAT_NF, volume: Math.max(0, drumVolume - 3), duration: 1, priority: 0 });
    }
    noiseEvents.sort((a, b) => a.tick - b.tick || b.priority - a.priority);
    const merged = noiseEvents.filter((event, index) => {
      const prev = noiseEvents[index - 1];
      return !(prev && prev.tick === event.tick); // 同tickはスネア優先(先頭のみ)
    });
    merged.forEach((event, index) => {
      if (event.tick >= totalTicks) return;
      push(ons, event.tick, { kind: 'noise', nf: event.nf, volume: event.volume });
      const offTick = Math.min(event.tick + event.duration, totalTicks);
      const next = merged[index + 1];
      if (!next || next.tick >= offTick) push(offs, offTick, { kind: 'noise' });
    });
  }

  return { ons, offs, totalTicks };
}

function samplesPerStep(tempo) {
  return (VGM_SAMPLE_RATE * 60) / tempo / 4;
}

function easySongToVgm(input, options = {}) {
  const song = compose.normalizeEasySong(input);
  const loop = options.loop ?? song.loop;
  const theme = themeFor(song.themeId);
  const writer = new mdAudio.MdVgmWriter();
  writer.initYm2612();

  const patchNames = patchNamesFor(song, theme);
  writer.loadPatch(TRACK_FM_INDEX.lead, patchFor(patchNames.lead || 'brass'), {
    velocity: volumeToVelocity(song.mixer.lead.volume),
  });
  writer.loadPatch(TRACK_FM_INDEX.harmony, patchFor(patchNames.harmony || 'strings'), {
    velocity: volumeToVelocity(song.mixer.harmony.volume),
  });
  writer.loadPatch(TRACK_FM_INDEX.bass, patchFor(patchNames.bass || 'bass'), {
    velocity: volumeToVelocity(song.mixer.bass.volume),
  });
  writer.loadPatch(KICK_FM_INDEX, KICK_PATCH, {
    velocity: volumeToVelocity(song.mixer.drums.volume),
  });
  // PSG 全消音
  [0x9f, 0xbf, 0xdf, 0xff].forEach((value) => writer.psgWrite(value));

  if (loop) writer.markLoopPoint();

  const { ons, offs, totalTicks } = buildTickEvents(song);
  const stepSamples = samplesPerStep(song.tempo);
  const samplesAt = (tick) => Math.round((tick * stepSamples) / TICKS_PER_STEP);
  const apply = (event) => {
    if (event.kind === 'fm') {
      if (event.midi != null) writer.noteOn(event.fmIndex, event.midi);
      else writer.noteOff(event.fmIndex);
    } else if (event.kind === 'noise') {
      if (event.nf != null) {
        writer.psgWrite(0xe0 | 0x04 | event.nf);
        writer.psgWrite(0xf0 | (15 - Math.max(0, Math.min(15, event.volume))));
      } else {
        writer.psgWrite(0xff);
      }
    }
  };

  for (let tick = 0; tick < totalTicks; tick += 1) {
    (offs.get(tick) || []).forEach((event) => apply({ ...event, midi: null, nf: null }));
    (ons.get(tick) || []).forEach(apply);
    writer.wait(samplesAt(tick + 1) - samplesAt(tick));
  }
  // 終端の消音(ループ復帰時に音が残らないように)
  for (let fmIndex = 0; fmIndex <= KICK_FM_INDEX; fmIndex += 1) writer.noteOff(fmIndex);
  [0x9f, 0xbf, 0xdf, 0xff].forEach((value) => writer.psgWrite(value));
  writer.end();
  return writer.buildVgm();
}

function easySongToPreviewDataUrl(input, options = {}) {
  const song = compose.normalizeEasySong(input);
  const vgm = easySongToVgm(song, options);
  return {
    dataUrl: `data:audio/vgm;base64,${vgm.toString('base64')}`,
    byteLength: vgm.length,
    stepMs: 60000 / song.tempo / 4,
    totalSteps: song.bars * compose.STEPS_PER_BAR,
    loop: options.loop ?? song.loop,
  };
}

// MD BGM Composer 互換の tracker Song 形式へ変換(.mdbgm.json サイドカー用)。
// tracker 形式は1行スタッカート再生のため、ロングノートは開始行のみ保持される。
function easySongToTrackerSong(input, options = {}) {
  const song = compose.normalizeEasySong(input);
  const theme = themeFor(song.themeId);
  const totalRows = song.bars * compose.STEPS_PER_BAR;
  const rowsPerPattern = 64;
  const patternCount = Math.max(1, Math.ceil(totalRows / rowsPerPattern));
  const patterns = Array.from({ length: patternCount }, (_, index) => ({
    id: index,
    name: `Pattern ${index + 1}`,
    rows: Array.from({ length: rowsPerPattern }, () => ({ cells: {} })),
  }));

  const putCell = (row, channelId, cell) => {
    const pattern = patterns[Math.floor(row / rowsPerPattern)];
    if (!pattern) return;
    pattern.rows[row % rowsPerPattern].cells[channelId] = cell;
  };
  const trackChannel = { lead: 'FM1', harmony: 'FM2', bass: 'FM3' };
  const trackInstrument = { lead: 'easy_lead', harmony: 'easy_harmony', bass: 'easy_bass' };

  for (const [track, channelId] of Object.entries(trackChannel)) {
    for (const note of song.tracks[track] || []) {
      putCell(note.step, channelId, {
        note: compose.midiToName(note.midiNote),
        midiNote: note.midiNote,
        instrument: trackInstrument[track],
        volume: song.mixer[track].volume,
        effect: '',
      });
    }
  }
  for (const step of song.drums.kick || []) {
    putCell(step, 'FM4', {
      note: compose.midiToName(KICK_MIDI),
      midiNote: KICK_MIDI,
      instrument: 'easy_kick',
      volume: song.mixer.drums.volume,
      effect: '',
    });
  }
  const noiseSteps = new Map();
  for (const step of song.drums.hat || []) noiseSteps.set(step, Math.max(0, song.mixer.drums.volume - 3));
  for (const step of song.drums.snare || []) noiseSteps.set(step, song.mixer.drums.volume);
  for (const [step, volume] of noiseSteps) {
    putCell(step, 'NOISE', { note: 'N', midiNote: null, instrument: 'easy_noise', volume, effect: '' });
  }

  // 64行未満の曲(2小節)はパターンを埋めるために繰り返す
  if (totalRows < rowsPerPattern) {
    for (let row = totalRows; row < rowsPerPattern; row += 1) {
      const source = patterns[0].rows[row % totalRows];
      patterns[0].rows[row] = { cells: structuredClone(source.cells) };
    }
  }

  const patchNames = patchNamesFor(song, theme);
  const fmInstrument = (id, name, patchName, volume) => ({
    id,
    name,
    type: 'fm',
    volume,
    pan: 'center',
    ...structuredClone(patchFor(patchName)),
  });

  return {
    version: 2,
    title: song.name,
    artist: '',
    symbol: String(options.symbol || 'easy_bgm'),
    tempo: song.tempo,
    speed: 6,
    rowsPerPattern,
    channels: structuredClone(mdAudio.CHANNELS),
    order: patterns.map((pattern) => pattern.id),
    patterns,
    instruments: [
      fmInstrument('easy_lead', 'Easy Lead', patchNames.lead || 'brass', song.mixer.lead.volume),
      fmInstrument('easy_harmony', 'Easy Harmony', patchNames.harmony || 'strings', song.mixer.harmony.volume),
      fmInstrument('easy_bass', 'Easy Bass', patchNames.bass || 'bass', song.mixer.bass.volume),
      fmInstrument('easy_kick', 'Easy Kick', 'kick', song.mixer.drums.volume),
      {
        id: 'easy_noise',
        name: 'Easy Noise',
        type: 'noise',
        volume: song.mixer.drums.volume,
        pan: 'center',
        envelope: 'hold',
        toneMode: 'square',
        noiseFrequency: 'clocked',
      },
    ],
    metadata: {
      profile: 'xgm2-safe',
      createdBy: 'easy-bgm-composer',
      note: 'かんたん作曲プラグインで生成。ロングノートは1行(16分)のスタッカートに変換されています。',
      easyBgm: { id: song.id, themeId: song.themeId, bars: song.bars, seed: song.options.seed },
    },
  };
}

module.exports = {
  KICK_PATCH,
  KICK_MIDI,
  TICKS_PER_STEP,
  TRACK_FM_INDEX,
  KICK_FM_INDEX,
  resolveAudibleTracks,
  buildTickEvents,
  easySongToVgm,
  easySongToPreviewDataUrl,
  easySongToTrackerSong,
};
