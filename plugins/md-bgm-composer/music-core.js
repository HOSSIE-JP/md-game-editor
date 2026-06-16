'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mdAudio = require('../shared/md-audio-engine');

const ROWS_PER_PATTERN = 64;
const DEFAULT_TICKS_PER_ROW = 6;
const SAMPLE_RATE_NTSC = 44100;

const CHANNELS = [
  { id: 'FM1', type: 'fm', label: 'FM1' },
  { id: 'FM2', type: 'fm', label: 'FM2' },
  { id: 'FM3', type: 'fm', label: 'FM3' },
  { id: 'FM4', type: 'fm', label: 'FM4' },
  { id: 'FM5', type: 'fm', label: 'FM5' },
  { id: 'PSG1', type: 'psg', label: 'PSG1' },
  { id: 'PSG2', type: 'psg', label: 'PSG2' },
  { id: 'PSG3', type: 'psg', label: 'PSG3' },
  { id: 'NOISE', type: 'noise', label: 'NOISE' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function makeDiagnostic(level, code, message, detail = {}) {
  return { level, code, message, detail };
}

function normalizeSymbolName(value) {
  const base = String(value || 'bgm')
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const safe = base || 'bgm';
  return /^[a-z_]/.test(safe) ? safe : `bgm_${safe}`;
}

function midiNoteToName(note) {
  const n = Number(note);
  if (!Number.isFinite(n)) return '';
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${octave}`;
}

function noteNameToMidi(noteName) {
  const match = String(noteName || '').trim().match(/^([A-G])(#?)(-?\d+)$/i);
  if (!match) return null;
  const name = `${match[1].toUpperCase()}${match[2] || ''}`;
  const index = NOTE_NAMES.indexOf(name);
  if (index < 0) return null;
  return (Number(match[3]) + 1) * 12 + index;
}

function createDefaultFmInstrument(id = 'fm_bell') {
  return mdAudio.normalizeInstrument({
    id,
    name: 'FM Bell',
    type: 'fm',
    algorithm: 4,
    feedback: 2,
    pan: 'center',
    operators: Array.from({ length: 4 }, () => ({
      tl: 32,
      ar: 31,
      dr: 12,
      sr: 0,
      rr: 8,
      sl: 4,
      detune: 0,
      multiple: 1,
      rs: 0,
      am: 0,
      ssgEg: 0,
    })),
  });
}

function createDefaultPsgInstrument(id = 'psg_square') {
  return {
    id,
    name: 'PSG Square',
    type: 'psg',
    volume: 10,
    envelope: 'hold',
    toneMode: 'square',
    noiseFrequency: 'clocked',
  };
}

function createEmptyRows() {
  return Array.from({ length: ROWS_PER_PATTERN }, () => ({ cells: {} }));
}

function createDefaultSong(options = {}) {
  const symbol = normalizeSymbolName(options.symbol || 'bgm_001');
  return {
    version: 2,
    title: String(options.title || 'New BGM'),
    artist: String(options.artist || ''),
    symbol,
    tempo: Number(options.tempo) || 150,
    speed: Number(options.speed) || DEFAULT_TICKS_PER_ROW,
    rowsPerPattern: ROWS_PER_PATTERN,
    channels: CHANNELS,
    order: [0],
    patterns: [{ id: 0, name: 'Pattern 00', rows: createEmptyRows() }],
    instruments: [
      createDefaultFmInstrument('fm_bell'),
      createDefaultPsgInstrument('psg_square'),
      { ...createDefaultPsgInstrument('noise_kit'), name: 'Noise Kit', type: 'noise' },
    ],
    metadata: {
      profile: 'xgm2-safe',
      createdBy: 'md-bgm-composer',
    },
  };
}

class ByteReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  remaining() {
    return this.buffer.length - this.offset;
  }

  readUInt8() {
    if (this.remaining() < 1) throw new Error('Unexpected end of MIDI data');
    return this.buffer[this.offset++];
  }

  readUInt16BE() {
    if (this.remaining() < 2) throw new Error('Unexpected end of MIDI data');
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readUInt32BE() {
    if (this.remaining() < 4) throw new Error('Unexpected end of MIDI data');
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readAscii(length) {
    if (this.remaining() < length) throw new Error('Unexpected end of MIDI data');
    const value = this.buffer.toString('ascii', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readBytes(length) {
    if (this.remaining() < length) throw new Error('Unexpected end of MIDI data');
    const value = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readVarLen() {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.readUInt8();
      value = (value << 7) | (byte & 0x7F);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Invalid MIDI variable length value');
  }
}

function parseMidi(buffer) {
  const reader = new ByteReader(buffer);
  if (reader.readAscii(4) !== 'MThd') {
    throw new Error('MIDI header MThd が見つかりません。');
  }
  const headerLength = reader.readUInt32BE();
  if (headerLength < 6) {
    throw new Error('MIDI header が短すぎます。');
  }
  const format = reader.readUInt16BE();
  const trackCount = reader.readUInt16BE();
  const division = reader.readUInt16BE();
  if (headerLength > 6) reader.readBytes(headerLength - 6);
  if (division & 0x8000) {
    throw new Error('SMPTE time division の MIDI は MVP では未対応です。');
  }

  const ticksPerQuarter = division;
  const tracks = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    const chunkId = reader.readAscii(4);
    const chunkLength = reader.readUInt32BE();
    const data = reader.readBytes(chunkLength);
    if (chunkId !== 'MTrk') continue;
    tracks.push(parseMidiTrack(data, trackIndex));
  }

  return { format, trackCount, ticksPerQuarter, tracks };
}

function parseMidiTrack(data, trackIndex) {
  const reader = new ByteReader(data);
  const events = [];
  let tick = 0;
  let runningStatus = 0;
  let name = `Track ${trackIndex + 1}`;

  while (reader.remaining() > 0) {
    tick += reader.readVarLen();
    let status = reader.readUInt8();
    if (status < 0x80) {
      if (!runningStatus) throw new Error('MIDI running status が不正です。');
      reader.offset -= 1;
      status = runningStatus;
    } else if (status < 0xF0) {
      runningStatus = status;
    }

    if (status === 0xFF) {
      const type = reader.readUInt8();
      const length = reader.readVarLen();
      const payload = reader.readBytes(length);
      if (type === 0x03) {
        name = payload.toString('utf-8') || name;
        events.push({ tick, type: 'trackName', name });
      } else if (type === 0x01) {
        events.push({ tick, type: 'text', text: payload.toString('utf-8') });
      } else if (type === 0x02) {
        events.push({ tick, type: 'copyright', text: payload.toString('utf-8') });
      } else if (type === 0x04) {
        events.push({ tick, type: 'instrumentName', name: payload.toString('utf-8') });
      } else if (type === 0x51 && payload.length === 3) {
        events.push({
          tick,
          type: 'tempo',
          microsecondsPerQuarter: (payload[0] << 16) | (payload[1] << 8) | payload[2],
        });
      } else if (type === 0x2F) {
        events.push({ tick, type: 'endOfTrack' });
        break;
      } else {
        events.push({ tick, type: 'meta', metaType: type, length });
      }
      continue;
    }

    if (status === 0xF0 || status === 0xF7) {
      reader.readBytes(reader.readVarLen());
      events.push({ tick, type: 'sysex' });
      continue;
    }

    const eventType = status & 0xF0;
    const channel = status & 0x0F;
    const data1 = reader.readUInt8();
    const needsData2 = eventType !== 0xC0 && eventType !== 0xD0;
    const data2 = needsData2 ? reader.readUInt8() : 0;

    if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
      events.push({ tick, type: 'noteOff', channel, note: data1, velocity: data2 });
    } else if (eventType === 0x90) {
      events.push({ tick, type: 'noteOn', channel, note: data1, velocity: data2 });
    } else if (eventType === 0xB0) {
      events.push({ tick, type: 'controlChange', channel, controller: data1, value: data2 });
    } else if (eventType === 0xC0) {
      events.push({ tick, type: 'programChange', channel, program: data1 });
    } else if (eventType === 0xE0) {
      events.push({ tick, type: 'pitchBend', channel, value: ((data2 << 7) | data1) - 8192 });
    } else {
      events.push({ tick, type: 'midi', status, channel, data1, data2 });
    }
  }

  return { index: trackIndex, name, events };
}

function extractMidiMetadata(midi, fallbackTitle = 'Imported MIDI') {
  const events = midi.tracks.flatMap((track) => track.events || []);
  const trackNames = events.filter((event) => event.type === 'trackName').map((event) => event.name).filter(Boolean);
  const textEvents = events.filter((event) => event.type === 'text').map((event) => event.text).filter(Boolean);
  const copyright = events.find((event) => event.type === 'copyright')?.text || '';
  const firstMusicTrack = midi.tracks.find((track) => (track.events || []).some((event) => event.type === 'noteOn'));
  const title = trackNames.find((name) => !/^tempo$/i.test(name))
    || firstMusicTrack?.name
    || textEvents[0]
    || fallbackTitle;
  return {
    title,
    artist: copyright.replace(/^copyright\s*/i, '').trim(),
    trackNames,
    text: textEvents,
    copyright,
  };
}

function extractNotes(track, diagnostics) {
  const active = new Map();
  const notes = [];
  const controls = [];
  const programs = new Map();

  for (const event of track.events) {
    if (event.type === 'programChange') {
      programs.set(event.channel, event.program);
    } else if (event.type === 'controlChange') {
      if (event.controller === 7 || event.controller === 10) controls.push(event);
      else diagnostics.push(makeDiagnostic('info', 'midi-cc-ignored', `CC ${event.controller} は import 診断のみ記録しました。`, { track: track.index }));
    } else if (event.type === 'pitchBend' && event.value !== 0) {
      diagnostics.push(makeDiagnostic('warn', 'pitch-bend-ignored', 'Pitch bend は MVP では近似せず破棄します。', { track: track.index, tick: event.tick }));
    } else if (event.type === 'noteOn') {
      const key = `${event.channel}:${event.note}`;
      const stack = active.get(key) || [];
      stack.push(event);
      active.set(key, stack);
    } else if (event.type === 'noteOff') {
      const key = `${event.channel}:${event.note}`;
      const stack = active.get(key) || [];
      const start = stack.shift();
      if (stack.length) active.set(key, stack);
      else active.delete(key);
      if (start) {
        notes.push({
          trackIndex: track.index,
          trackName: track.name,
          channel: event.channel,
          note: event.note,
          velocity: start.velocity,
          startTick: start.tick,
          endTick: Math.max(event.tick, start.tick + 1),
          program: programs.get(event.channel) ?? 0,
        });
      }
    }
  }

  active.forEach((stack) => {
    stack.forEach((event) => {
      diagnostics.push(makeDiagnostic('warn', 'dangling-note', 'Note off が見つからない音を短い音として取り込みました。', { track: track.index, tick: event.tick }));
      notes.push({
        trackIndex: track.index,
        trackName: track.name,
        channel: event.channel,
        note: event.note,
        velocity: event.velocity,
        startTick: event.tick,
        endTick: event.tick + 120,
        program: programs.get(event.channel) ?? 0,
      });
    });
  });

  return { notes, controls };
}

function convertMidiToSong(midi, options = {}) {
  const diagnostics = [];
  const midiMetadata = extractMidiMetadata(midi, options.title || 'Imported MIDI');
  const title = String(options.title || midiMetadata.title || 'Imported MIDI');
  const artist = String(options.artist || midiMetadata.artist || '');
  const symbol = normalizeSymbolName(options.symbol || title);
  const tempoEvent = midi.tracks.flatMap((track) => track.events).find((event) => event.type === 'tempo');
  const tempo = tempoEvent ? Math.round(60000000 / tempoEvent.microsecondsPerQuarter) : 150;
  const ticksPerRow = Math.max(1, Math.round(midi.ticksPerQuarter / 4));
  const grouped = new Map();

  midi.tracks.forEach((track) => {
    const { notes } = extractNotes(track, diagnostics);
    notes.forEach((note) => {
      const key = `${note.trackIndex}:${note.channel}`;
      const current = grouped.get(key) || {
        key,
        trackIndex: note.trackIndex,
        trackName: note.trackName,
        midiChannel: note.channel,
        program: note.program,
        notes: [],
      };
      current.notes.push(note);
      grouped.set(key, current);
    });
  });

  const candidates = Array.from(grouped.values())
    .filter((entry) => entry.notes.length > 0)
    .sort((a, b) => b.notes.length - a.notes.length);
  const allocations = allocateMidiTracks(candidates, diagnostics);
  const overrides = Array.isArray(options.allocations) ? options.allocations : [];
  const overrideMap = new Map(overrides.map((entry) => [entry.key, entry.target]));
  allocations.forEach((allocation) => {
    if (overrideMap.has(allocation.key)) {
      allocation.target = overrideMap.get(allocation.key);
    }
  });
  const maxTick = candidates.reduce((max, entry) => Math.max(max, ...entry.notes.map((note) => note.endTick)), 0);
  const totalRows = Math.max(ROWS_PER_PATTERN, Math.ceil(maxTick / ticksPerRow) + 1);
  const patternCount = Math.max(1, Math.ceil(totalRows / ROWS_PER_PATTERN));
  const song = createDefaultSong({ title, artist, symbol, tempo, speed: DEFAULT_TICKS_PER_ROW });
  song.order = Array.from({ length: patternCount }, (_, index) => index);
  song.patterns = song.order.map((id) => ({ id, name: `Pattern ${String(id).padStart(2, '0')}`, rows: createEmptyRows() }));
  song.metadata.midi = {
    format: midi.format,
    ticksPerQuarter: midi.ticksPerQuarter,
    ticksPerRow,
    title: midiMetadata.title,
    artist: midiMetadata.artist,
    trackNames: midiMetadata.trackNames,
    text: midiMetadata.text,
    copyright: midiMetadata.copyright,
    allocations,
  };

  for (const allocation of allocations) {
    if (allocation.target === 'ignore') continue;
    const entry = candidates.find((candidate) => candidate.key === allocation.key);
    if (!entry) continue;
    const instrumentId = allocation.target.startsWith('FM') ? 'fm_bell' : allocation.target === 'NOISE' ? 'noise_kit' : 'psg_square';
    entry.notes.sort((a, b) => a.startTick - b.startTick).forEach((note) => {
      const absoluteRow = Math.max(0, Math.round(note.startTick / ticksPerRow));
      const pattern = song.patterns[Math.floor(absoluteRow / ROWS_PER_PATTERN)];
      const row = pattern?.rows[absoluteRow % ROWS_PER_PATTERN];
      if (!row) return;
      if (row.cells[allocation.target]?.note) {
        diagnostics.push(makeDiagnostic('warn', 'row-polyphony-trimmed', '同一 row/channel の重複音を 1 音に丸めました。', {
          row: absoluteRow,
          channel: allocation.target,
        }));
        return;
      }
      const volume = Math.max(1, Math.min(15, Math.round((note.velocity / 127) * 15)));
      row.cells[allocation.target] = {
        note: allocation.target === 'NOISE' ? 'N' : midiNoteToName(note.note),
        midiNote: note.note,
        instrument: instrumentId,
        volume,
        effect: '',
      };
    });
  }

  return { song, diagnostics, allocations };
}

function allocateMidiTracks(candidates, diagnostics = []) {
  const melodicTargets = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'PSG1', 'PSG2', 'PSG3'];
  const allocations = [];
  let melodicIndex = 0;
  let noiseUsed = false;

  for (const entry of candidates) {
    const isPercussion = entry.midiChannel === 9;
    if (isPercussion && !noiseUsed) {
      allocations.push({ key: entry.key, target: 'NOISE', trackName: entry.trackName, midiChannel: entry.midiChannel });
      noiseUsed = true;
      continue;
    }
    if (melodicIndex < melodicTargets.length) {
      allocations.push({ key: entry.key, target: melodicTargets[melodicIndex], trackName: entry.trackName, midiChannel: entry.midiChannel });
      melodicIndex += 1;
      continue;
    }
    diagnostics.push(makeDiagnostic('warn', 'midi-track-overflow', 'XGM2-safe profile の同時チャンネル数を超えた track を ignore にしました。', {
      trackName: entry.trackName,
      midiChannel: entry.midiChannel,
    }));
    allocations.push({ key: entry.key, target: 'ignore', trackName: entry.trackName, midiChannel: entry.midiChannel });
  }

  return allocations;
}

function validateSong(song) {
  const diagnostics = [];
  const knownChannels = new Set(CHANNELS.map((channel) => channel.id));
  const supportedEffects = new Set(['', 'volume', 'pan', 'arpeggio', 'portamento', 'vibrato', 'note-cut', 'tempo', 'speed']);

  if (!song || typeof song !== 'object') {
    return [makeDiagnostic('error', 'song-missing', 'song データがありません。')];
  }
  if (!Array.isArray(song.patterns) || song.patterns.length === 0) {
    diagnostics.push(makeDiagnostic('error', 'patterns-missing', 'pattern がありません。'));
  }
  if (!Array.isArray(song.order) || song.order.length === 0) {
    diagnostics.push(makeDiagnostic('error', 'order-missing', 'pattern order がありません。'));
  }

  for (const pattern of song.patterns || []) {
    (pattern.rows || []).forEach((row, rowIndex) => {
      Object.entries(row.cells || {}).forEach(([channelId, cell]) => {
        if (!knownChannels.has(channelId)) {
          diagnostics.push(makeDiagnostic('warn', 'unknown-channel', `未対応 channel ${channelId} は export されません。`, { pattern: pattern.id, row: rowIndex }));
          return;
        }
        const channel = CHANNELS.find((entry) => entry.id === channelId);
        if (channel.type !== 'noise') {
          const midiNote = cell.midiNote ?? noteNameToMidi(cell.note);
          if (midiNote == null) {
            diagnostics.push(makeDiagnostic('warn', 'invalid-note', `不正な note ${cell.note || ''} を無視します。`, { pattern: pattern.id, row: rowIndex, channelId }));
          } else if (midiNote < 24 || midiNote > 96) {
            diagnostics.push(makeDiagnostic('warn', 'note-range', `${channelId} の ${cell.note} は Mega Drive 向けの安全音域外です。`, { pattern: pattern.id, row: rowIndex, channelId }));
          }
        }
        if (!supportedEffects.has(String(cell.effect || ''))) {
          diagnostics.push(makeDiagnostic('warn', 'unsupported-effect', `${cell.effect} は MVP export では無視されます。`, { pattern: pattern.id, row: rowIndex, channelId }));
        }
      });
    });
  }

  return diagnostics;
}

function writeU32LE(buffer, offset, value) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function ymPortForChannel(channelId) {
  const index = Number(String(channelId).replace('FM', '')) - 1;
  if (index < 0 || index > 5) return null;
  return {
    port: index >= 3 ? 1 : 0,
    channel: index % 3,
  };
}

function fmFnumBlock(midiNote) {
  const note = Number(midiNote);
  const semitone = ((note % 12) + 12) % 12;
  const octave = Math.max(0, Math.min(7, Math.floor(note / 12) - 1));
  const base = [617, 654, 693, 734, 778, 824, 873, 925, 980, 1038, 1100, 1165][semitone];
  return { block: octave, fnum: base };
}

function pushYmWrite(commands, port, register, value) {
  commands.push(port ? 0x53 : 0x52, register & 0xFF, value & 0xFF);
}

function pushPsgWrite(commands, value) {
  commands.push(0x50, value & 0xFF);
}

function pushWaitFrame(commands) {
  commands.push(0x62);
}

function rowDurationMs(song) {
  const tempo = Math.max(30, Number(song?.tempo) || 150);
  const speed = Math.max(1, Math.min(31, Number(song?.speed) || DEFAULT_TICKS_PER_ROW));
  return (60000 / tempo / 4) * (speed / DEFAULT_TICKS_PER_ROW);
}

function rowWaitSamples(song) {
  return Math.max(1, Math.round(SAMPLE_RATE_NTSC * rowDurationMs(song) / 1000));
}

function pushWaitSamples(commands, samples) {
  let remaining = Math.max(1, Math.round(Number(samples) || 1));
  while (remaining > 0) {
    const chunk = Math.min(0xFFFF, remaining);
    if (chunk === 735) {
      pushWaitFrame(commands);
    } else {
      commands.push(0x61, chunk & 0xFF, (chunk >> 8) & 0xFF);
    }
    remaining -= chunk;
  }
}

function pushFmNote(commands, channelId, cell) {
  const mapped = ymPortForChannel(channelId);
  const midiNote = cell.midiNote ?? noteNameToMidi(cell.note);
  if (!mapped || midiNote == null) return;
  const { block, fnum } = fmFnumBlock(midiNote);
  const ch = mapped.channel;
  const port = mapped.port;
  const keyChannel = ch + (port ? 4 : 0);
  const panBits = cell.pan === 'left' ? 0x80 : cell.pan === 'right' ? 0x40 : 0xC0;
  pushYmWrite(commands, port, 0xB4 + ch, panBits | 0x30);
  pushYmWrite(commands, port, 0xA4 + ch, ((block & 0x07) << 3) | ((fnum >> 8) & 0x07));
  pushYmWrite(commands, port, 0xA0 + ch, fnum & 0xFF);
  pushYmWrite(commands, 0, 0x28, keyChannel);
  pushYmWrite(commands, 0, 0x28, 0xF0 | keyChannel);
}

function psgTonePeriod(midiNote) {
  const frequency = 440 * (2 ** ((Number(midiNote) - 69) / 12));
  return Math.max(1, Math.min(0x3FF, Math.round(3579545 / (32 * frequency))));
}

function pushPsgNote(commands, channelId, cell) {
  const channelIndex = channelId === 'PSG1' ? 0 : channelId === 'PSG2' ? 1 : channelId === 'PSG3' ? 2 : 3;
  const volume = Math.max(0, Math.min(15, 15 - (Number(cell.volume) || 10)));
  if (channelId === 'NOISE') {
    pushPsgWrite(commands, 0xE0 | 0x04);
    pushPsgWrite(commands, 0xF0 | volume);
    return;
  }
  const midiNote = cell.midiNote ?? noteNameToMidi(cell.note);
  if (midiNote == null) return;
  const period = psgTonePeriod(midiNote);
  pushPsgWrite(commands, 0x80 | (channelIndex << 5) | (period & 0x0F));
  pushPsgWrite(commands, (period >> 4) & 0x3F);
  pushPsgWrite(commands, 0x90 | (channelIndex << 5) | volume);
}

function buildVgmData(song) {
  return mdAudio.buildVgmEvents(song).data;
}

function writeVgm(song) {
  return mdAudio.writeVgm(song);
}

function previewMusic(payload = {}) {
  try {
    const song = mdAudio.normalizeSong(payload.song || payload);
    const symbol = normalizeSymbolName(payload.symbol || song.symbol || 'preview_bgm');
    const vgm = writeVgm({ ...song, symbol });
    return {
      ok: true,
      symbol,
      format: 'VGM',
      dataUrl: `data:audio/vgm;base64,${vgm.toString('base64')}`,
      byteLength: vgm.length,
      diagnostics: validateSong(song),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function ensureProjectPath(projectDir, relPath) {
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('project directory outside path is not allowed');
  }
  return abs;
}

function findXgmTool(extraPath) {
  if (extraPath) {
    return fs.existsSync(extraPath) ? extraPath : '';
  }
  const candidates = [];
  candidates.push('xgmtool.exe', 'xgmtool');
  const sgdk = process.env.GDK || process.env.SGDK;
  if (sgdk) candidates.push(path.join(sgdk, 'bin', 'xgmtool.exe'));
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', 'sgdk', 'current', 'bin', 'xgmtool.exe'));
  candidates.push('D:\\homebrew\\SGDK\\sgdk\\current\\bin\\xgmtool.exe');
  return candidates.find((candidate) => {
    if (!candidate) return false;
    if (candidate.includes(path.sep) || candidate.includes('\\')) return fs.existsSync(candidate);
    const probe = spawnSync(candidate, [], { windowsHide: true, encoding: 'utf-8' });
    return !probe.error || probe.status !== null;
  }) || '';
}

function exportMusic(payload, context = {}) {
  const projectDir = String(context.projectDir || payload?.projectDir || '');
  if (!projectDir) return { ok: false, error: 'projectDir が未設定です。' };
  const song = payload?.song || createDefaultSong();
  const symbol = normalizeSymbolName(payload?.symbol || song.symbol || song.title);
  const outputs = payload?.outputs || {};
  const diagnostics = validateSong(song);
  const targetSourcePath = String(payload?.sourcePath || '').replace(/\\/g, '/');
  const sourceDir = targetSourcePath && targetSourcePath.includes('/')
    ? targetSourcePath.slice(0, targetSourcePath.lastIndexOf('/'))
    : 'music';
  const outputSubdir = String(payload?.targetSubdir || sourceDir || 'music')
    .replace(/\\/g, '/')
    .replace(/[^A-Za-z0-9_./-]+/g, '_')
    .replace(/^\.+\/?/, '') || 'music';
  const sourceBase = targetSourcePath
    ? path.basename(targetSourcePath, path.extname(targetSourcePath))
    : symbol;
  const outputBase = normalizeSymbolName(payload?.targetFileName || sourceBase || symbol);
  const musicDir = ensureProjectPath(projectDir, `res/${outputSubdir}`);
  fs.mkdirSync(musicDir, { recursive: true });

  const jsonRel = `res/${outputSubdir}/${outputBase}.mdbgm.json`;
  const vgmRel = `res/${outputSubdir}/${outputBase}.vgm`;
  const xgmRel = `res/${outputSubdir}/${outputBase}.xgm`;
  const jsonPath = ensureProjectPath(projectDir, jsonRel);
  const vgmPath = ensureProjectPath(projectDir, vgmRel);
  const xgmPath = ensureProjectPath(projectDir, xgmRel);

  fs.writeFileSync(jsonPath, JSON.stringify({ ...mdAudio.normalizeSong(song), symbol }, null, 2), 'utf-8');
  fs.writeFileSync(vgmPath, writeVgm({ ...song, symbol }));

  const result = {
    ok: true,
    symbol,
    files: { json: jsonRel, vgm: vgmRel },
    diagnostics,
    warnings: [],
  };

  if (outputs.xgm !== false) {
    const xgmTool = findXgmTool(payload?.xgmToolPath);
    if (!xgmTool) {
      result.warnings.push('xgmtool が見つからないため XGM 出力をスキップしました。VGM は保存済みです。');
    } else {
      const converted = spawnSync(xgmTool, [vgmPath, xgmPath, '-s'], { windowsHide: true, encoding: 'utf-8' });
      if (converted.error || converted.status !== 0 || !fs.existsSync(xgmPath)) {
        result.warnings.push(`XGM 変換に失敗しました: ${(converted.stderr || converted.stdout || converted.error?.message || '').trim()}`);
      } else {
        result.files.xgm = xgmRel;
      }
    }
  }

  if (outputs.registerAsset !== false) {
    result.asset = {
      type: 'XGM2',
      name: symbol,
      sourcePath: `${outputSubdir}/${outputBase}.vgm`,
      files: [`${outputSubdir}/${outputBase}.vgm`],
      options: '',
    };
  }

  return result;
}

function readU16LE(buffer, offset) {
  return (buffer[offset] || 0) | ((buffer[offset + 1] || 0) << 8);
}

function readU32LE(buffer, offset) {
  return (buffer[offset] || 0)
    | ((buffer[offset + 1] || 0) << 8)
    | ((buffer[offset + 2] || 0) << 16)
    | ((buffer[offset + 3] || 0) << 24);
}

function fnumBlockToMidi(fnum, block) {
  const base = [617, 654, 693, 734, 778, 824, 873, 925, 980, 1038, 1100, 1165];
  let best = 0;
  let bestDistance = Infinity;
  base.forEach((value, index) => {
    const distance = Math.abs(value - fnum);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return Math.max(24, Math.min(96, (Math.max(0, Math.min(7, block)) + 1) * 12 + best));
}

function psgPeriodToMidi(period) {
  const frequency = 3579545 / (32 * Math.max(1, Number(period) || 1));
  return Math.max(24, Math.min(96, Math.round(69 + (12 * Math.log2(frequency / 440)))));
}

function clampInt(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseGd3Tag(buffer) {
  const gd3Offset = readU32LE(buffer, 0x14) >>> 0;
  if (!gd3Offset) return {};
  const offset = 0x14 + gd3Offset;
  if (offset < 0 || offset + 12 > buffer.length || buffer.toString('ascii', offset, offset + 4) !== 'Gd3 ') return {};
  const length = readU32LE(buffer, offset + 8) >>> 0;
  const end = Math.min(buffer.length, offset + 12 + length);
  const strings = buffer.toString('utf16le', offset + 12, end).split('\u0000');
  const [
    titleEn = '',
    titleJp = '',
    gameEn = '',
    gameJp = '',
    systemEn = '',
    systemJp = '',
    artistEn = '',
    artistJp = '',
    date = '',
    creator = '',
    notes = '',
  ] = strings;
  return {
    title: titleEn || titleJp || '',
    titleEn,
    titleJp,
    game: gameEn || gameJp || '',
    gameEn,
    gameJp,
    system: systemEn || systemJp || '',
    systemEn,
    systemJp,
    artist: artistEn || artistJp || '',
    artistEn,
    artistJp,
    date,
    creator,
    notes,
  };
}

function parseVgmHeaderMetadata(buffer, symbol) {
  const totalSamples = readU32LE(buffer, 0x18) >>> 0;
  const loopSamples = readU32LE(buffer, 0x20) >>> 0;
  const rate = readU32LE(buffer, 0x24) >>> 0;
  const sn76489Clock = readU32LE(buffer, 0x0c) >>> 0;
  const ym2612Clock = readU32LE(buffer, 0x2c) >>> 0;
  const version = readU32LE(buffer, 0x08) >>> 0;
  const gd3 = parseGd3Tag(buffer);
  return {
    version,
    title: gd3.title || symbol,
    artist: gd3.artist || '',
    durationSec: totalSamples ? totalSamples / SAMPLE_RATE_NTSC : 0,
    totalSamples,
    loopSamples,
    rate,
    sn76489Clock,
    ym2612Clock,
    gd3,
  };
}

function scanVgmWaits(buffer, startOffset) {
  const waits = [];
  let offset = startOffset;
  while (offset < buffer.length) {
    const command = buffer[offset++];
    if (command === 0x66) break;
    if (command === 0x52 || command === 0x53) {
      offset += 2;
    } else if (command === 0x50) {
      offset += 1;
    } else if (command === 0x61) {
      const wait = readU16LE(buffer, offset);
      offset += 2;
      if (wait >= 16) waits.push(wait);
    } else if (command === 0x62) {
      waits.push(735);
    } else if (command === 0x63) {
      waits.push(882);
    } else if (command === 0x67 && buffer[offset] === 0x66) {
      const size = readU32LE(buffer, offset + 2) >>> 0;
      offset += 6 + size;
    } else if (command >= 0x70 && command <= 0x7F) {
      const wait = (command & 0x0F) + 1;
      if (wait >= 16) waits.push(wait);
    } else {
      break;
    }
  }
  return waits;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function inferGridFromVgm(buffer, startOffset) {
  const rowWaitSamples = Math.max(1, median(scanVgmWaits(buffer, startOffset)) || 735);
  const rowMs = rowWaitSamples * 1000 / SAMPLE_RATE_NTSC;
  let tempo = 150;
  let speed = clampInt(rowMs / 100 * DEFAULT_TICKS_PER_ROW, 1, 31, DEFAULT_TICKS_PER_ROW);
  if (speed === 31 && rowMs > (60000 / tempo / 4) * (31 / DEFAULT_TICKS_PER_ROW)) {
    speed = DEFAULT_TICKS_PER_ROW;
    tempo = clampInt((60000 / 4) * (speed / DEFAULT_TICKS_PER_ROW) / rowMs, 30, 300, 150);
  }
  return { rowWaitSamples, rowMs, tempo, speed };
}

function setSongCellFromVgm(song, absoluteRow, channelId, midiNote, diagnostics, instrument) {
  const patternIndex = Math.floor(absoluteRow / ROWS_PER_PATTERN);
  while (song.patterns.length <= patternIndex) {
    const id = song.patterns.length;
    song.patterns.push({ id, name: `Pattern ${String(id).padStart(2, '0')}`, rows: createEmptyRows() });
    song.order.push(id);
  }
  const row = song.patterns[patternIndex].rows[absoluteRow % ROWS_PER_PATTERN];
  if (row.cells[channelId]) {
    diagnostics.push(makeDiagnostic('warn', 'vgm-polyphony-trimmed', `${channelId} row ${absoluteRow} の重複音を 1 音に丸めました。`, { row: absoluteRow, channelId }));
    return;
  }
  row.cells[channelId] = {
    note: channelId === 'NOISE' ? 'N' : midiNoteToName(midiNote),
    midiNote,
    instrument,
    volume: 12,
    effect: '',
  };
}

function analyzeVgm(payload, context = {}) {
  const sourcePath = String(payload?.sourcePath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'VGM/XGM ファイルが見つかりません。' };
  }
  if (/\.xgm$/i.test(sourcePath) && !payload?.forceVgm) {
    return analyzeXgm(payload, context);
  }
  const symbol = normalizeSymbolName(payload?.symbol || path.basename(sourcePath, path.extname(sourcePath)));
  const buffer = fs.readFileSync(sourcePath);
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 4) !== 'Vgm ') {
    return { ok: false, error: 'VGM header が見つかりません。' };
  }
  let offset = readU32LE(buffer, 0x34) ? 0x34 + readU32LE(buffer, 0x34) : 0x40;
  if (offset < 0x40 || offset >= buffer.length) offset = 0x40;
  const sourceMetadata = parseVgmHeaderMetadata(buffer, symbol);
  const grid = inferGridFromVgm(buffer, offset);
  const song = createDefaultSong({
    title: sourceMetadata.title || symbol,
    artist: sourceMetadata.artist || '',
    symbol,
    tempo: grid.tempo,
    speed: grid.speed,
  });
  song.metadata.source = {
    type: 'VGM',
    path: sourcePath,
    ...sourceMetadata,
    inferredRowWaitSamples: grid.rowWaitSamples,
    inferredRowMs: grid.rowMs,
  };
  const diagnostics = [makeDiagnostic('info', 'vgm-approximation', 'VGM から近似復元しました。音色・長さ・effect は完全再現ではありません。')];
  if (sourceMetadata.gd3?.title || sourceMetadata.gd3?.artist) {
    diagnostics.push(makeDiagnostic('info', 'vgm-gd3-metadata', 'VGM GD3 メタ情報を Song プロパティへ反映しました。'));
  }
  diagnostics.push(makeDiagnostic('info', 'vgm-grid-inferred', `VGM wait から tempo ${grid.tempo} / speed ${grid.speed} を推定しました。`));
  let samples = 0;
  const fm = Array.from({ length: 6 }, () => ({ fnum: 0, block: 4 }));
  const psg = Array.from({ length: 4 }, () => ({ tone: 0, volume: 15 }));
  let psgLatch = { type: 'tone', channel: 0 };
  const sampleToRow = () => Math.max(0, Math.round(samples / grid.rowWaitSamples));

  while (offset < buffer.length) {
    const command = buffer[offset++];
    if (command === 0x66) break;
    if (command === 0x52 || command === 0x53) {
      const port = command === 0x53 ? 1 : 0;
      const address = buffer[offset++];
      const value = buffer[offset++];
      const localChannel = address & 0x03;
      const index = port * 3 + localChannel;
      if (index >= 0 && index < 6 && address >= 0xA0 && address <= 0xA2) {
        fm[index].fnum = (fm[index].fnum & 0x700) | value;
      } else if (index >= 0 && index < 6 && address >= 0xA4 && address <= 0xA6) {
        fm[index].fnum = (fm[index].fnum & 0xFF) | ((value & 0x07) << 8);
        fm[index].block = (value >> 3) & 0x07;
      } else if (address === 0x28 && (value & 0xF0)) {
        const keyChannel = (value & 0x03) + ((value & 0x04) ? 3 : 0);
        const channelId = `FM${keyChannel + 1}`;
        const midiNote = fnumBlockToMidi(fm[keyChannel]?.fnum || 0, fm[keyChannel]?.block || 4);
        setSongCellFromVgm(song, sampleToRow(), channelId, midiNote, diagnostics, 'fm_bell');
      }
      continue;
    }
    if (command === 0x50) {
      const value = buffer[offset++];
      if (value & 0x80) {
        const channel = (value >> 5) & 0x03;
        const isVolume = Boolean(value & 0x10);
        psgLatch = { type: isVolume ? 'volume' : 'tone', channel };
        if (isVolume) {
          psg[channel].volume = value & 0x0F;
        } else {
          psg[channel].tone = (psg[channel].tone & 0x3F0) | (value & 0x0F);
          if (channel === 3) {
            setSongCellFromVgm(song, sampleToRow(), 'NOISE', 60, diagnostics, 'noise_kit');
          } else if (psg[channel].volume < 15) {
            setSongCellFromVgm(song, sampleToRow(), `PSG${channel + 1}`, psgPeriodToMidi(psg[channel].tone), diagnostics, 'psg_square');
          }
        }
      } else if (psgLatch.type === 'tone') {
        const channel = psgLatch.channel;
        psg[channel].tone = (psg[channel].tone & 0x0F) | ((value & 0x3F) << 4);
        if (channel < 3 && psg[channel].volume < 15) {
          setSongCellFromVgm(song, sampleToRow(), `PSG${channel + 1}`, psgPeriodToMidi(psg[channel].tone), diagnostics, 'psg_square');
        }
      }
      continue;
    }
    if (command === 0x61) {
      samples += readU16LE(buffer, offset);
      offset += 2;
      continue;
    }
    if (command === 0x62) {
      samples += 735;
      continue;
    }
    if (command === 0x63) {
      samples += 882;
      continue;
    }
    if (command >= 0x70 && command <= 0x7F) {
      samples += (command & 0x0F) + 1;
      continue;
    }
    if (command === 0x67 && buffer[offset] === 0x66) {
      const size = readU32LE(buffer, offset + 2);
      offset += 6 + size;
      continue;
    }
    diagnostics.push(makeDiagnostic('warn', 'vgm-command-unsupported', `未対応 VGM command 0x${command.toString(16)} で解析を打ち切りました。`));
    break;
  }

  return { ok: true, song, diagnostics };
}

function analyzeXgm(payload, context = {}) {
  const sourcePath = String(payload?.sourcePath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'XGM ファイルが見つかりません。' };
  }
  const symbol = normalizeSymbolName(payload?.symbol || path.basename(sourcePath, path.extname(sourcePath)));
  const buffer = fs.readFileSync(sourcePath);
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'Vgm ') {
    return analyzeVgm({ ...payload, sourcePath, forceVgm: true }, context);
  }
  const song = createDefaultSong({ title: symbol, symbol });
  song.metadata.source = {
    type: 'XGM',
    path: sourcePath,
    byteLength: buffer.length,
    tempo: song.tempo,
    speed: song.speed,
  };
  const diagnostics = [
    makeDiagnostic('warn', 'xgm-approximation', 'XGM から近似復元しました。音色・effect・細かなタイミングは完全再現ではありません。'),
    makeDiagnostic('info', 'xgm-metadata-limited', 'XGM には標準の曲名/作者メタ情報がないため、ファイル名と既定 tempo/speed を使用しました。'),
  ];

  // XGM is a packed command stream, not an editable project format. For now,
  // recover a sparse timing scaffold from byte transitions so the editor can
  // create a sidecar and let the user rebuild the song intentionally.
  let row = 0;
  for (let offset = 0; offset < buffer.length && row < ROWS_PER_PATTERN; offset += 1) {
    const value = buffer[offset];
    if (value === 0 || value === 0xff) continue;
    if ((value & 0xf0) === 0x90 || (value & 0xf0) === 0x80) {
      setSongCellFromVgm(song, row, 'FM1', 60 + (value % 12), diagnostics, 'fm_bell');
      row += 4;
    }
  }
  if (row === 0) {
    diagnostics.push(makeDiagnostic('warn', 'xgm-empty-scaffold', '音程を推定できなかったため、空の編集データとして復元しました。'));
  }
  return { ok: true, song, diagnostics };
}

function importMidi(payload) {
  const sourcePath = String(payload?.sourcePath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'MIDI ファイルが見つかりません。' };
  }
  const midi = parseMidi(fs.readFileSync(sourcePath));
  const imported = convertMidiToSong(midi, {
    title: payload?.title,
    symbol: payload?.symbol || path.basename(sourcePath, path.extname(sourcePath)),
    artist: payload?.artist,
    allocations: payload?.allocations,
  });
  return { ok: true, ...imported };
}

module.exports = {
  CHANNELS,
  ROWS_PER_PATTERN,
  normalizeSymbolName,
  midiNoteToName,
  noteNameToMidi,
  createDefaultSong,
  parseMidi,
  convertMidiToSong,
  allocateMidiTracks,
  validateSong,
  buildVgmData,
  writeVgm,
  previewMusic,
  findXgmTool,
  exportMusic,
  importMidi,
  analyzeVgm,
};
