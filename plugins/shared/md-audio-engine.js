'use strict';

const VGM_VERSION = 0x00000170;
const VGM_SAMPLE_RATE = 44100;
const YM2612_CLOCK = 7670454;
const SN76489_CLOCK = 3579545;
const DEFAULT_TICKS_PER_ROW = 6;
const ROWS_PER_PATTERN = 64;
const FM_CHANNELS = 6;
const FNUMBER_TABLE = [644, 682, 723, 766, 811, 860, 911, 965, 1022, 1083, 1147, 1215];
const YM_SLOT_OFFSETS = [0x00, 0x08, 0x04, 0x0C];

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

const FM_PATCHES = {
  bell: {
    name: 'FM Bell',
    algorithm: 4,
    feedback: 2,
    operators: Array.from({ length: 4 }, () => ({
      dt1: 0, mul: 1, tl: 32, rs: 0, ar: 31, am: 0, d1r: 12, d2r: 0, d1l: 4, rr: 8, ssgEg: 0,
    })),
  },
  bass: {
    name: 'Bass Guitar',
    algorithm: 2,
    feedback: 6,
    operators: [
      { dt1: 3, mul: 0, tl: 35, rs: 1, ar: 31, am: 0, d1r: 10, d2r: 5, d1l: 3, rr: 7, ssgEg: 0 },
      { dt1: 3, mul: 1, tl: 30, rs: 1, ar: 31, am: 0, d1r: 12, d2r: 5, d1l: 3, rr: 7, ssgEg: 0 },
      { dt1: 7, mul: 1, tl: 50, rs: 0, ar: 20, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 6, ssgEg: 0 },
      { dt1: 3, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 8, ssgEg: 0 },
    ],
  },
  strings: {
    name: 'Strings',
    algorithm: 4,
    feedback: 3,
    operators: [
      { dt1: 3, mul: 1, tl: 40, rs: 1, ar: 20, am: 0, d1r: 5, d2r: 2, d1l: 1, rr: 4, ssgEg: 0 },
      { dt1: 4, mul: 2, tl: 35, rs: 0, ar: 18, am: 0, d1r: 4, d2r: 2, d1l: 1, rr: 4, ssgEg: 0 },
      { dt1: 3, mul: 1, tl: 45, rs: 1, ar: 22, am: 0, d1r: 6, d2r: 3, d1l: 2, rr: 5, ssgEg: 0 },
      { dt1: 7, mul: 1, tl: 0, rs: 1, ar: 25, am: 0, d1r: 3, d2r: 2, d1l: 1, rr: 5, ssgEg: 0 },
    ],
  },
  percussion: {
    name: 'Percussion',
    algorithm: 7,
    feedback: 7,
    operators: [
      { dt1: 7, mul: 14, tl: 20, rs: 3, ar: 31, am: 0, d1r: 20, d2r: 15, d1l: 14, rr: 15, ssgEg: 0 },
      { dt1: 0, mul: 0, tl: 10, rs: 3, ar: 31, am: 0, d1r: 18, d2r: 15, d1l: 14, rr: 15, ssgEg: 0 },
      { dt1: 7, mul: 13, tl: 15, rs: 3, ar: 31, am: 0, d1r: 22, d2r: 15, d1l: 14, rr: 15, ssgEg: 0 },
      { dt1: 0, mul: 0, tl: 0, rs: 3, ar: 31, am: 0, d1r: 25, d2r: 15, d1l: 15, rr: 15, ssgEg: 0 },
    ],
  },
  piano: {
    name: 'Piano',
    algorithm: 0,
    feedback: 5,
    operators: [
      { dt1: 7, mul: 1, tl: 27, rs: 2, ar: 31, am: 0, d1r: 7, d2r: 3, d1l: 1, rr: 7, ssgEg: 0 },
      { dt1: 0, mul: 2, tl: 20, rs: 1, ar: 31, am: 0, d1r: 5, d2r: 3, d1l: 1, rr: 7, ssgEg: 0 },
      { dt1: 3, mul: 3, tl: 30, rs: 1, ar: 28, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 6, ssgEg: 0 },
      { dt1: 0, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 9, d2r: 5, d1l: 3, rr: 8, ssgEg: 0 },
    ],
  },
  brass: {
    name: 'Brass',
    algorithm: 3,
    feedback: 5,
    operators: [
      { dt1: 3, mul: 1, tl: 30, rs: 2, ar: 28, am: 0, d1r: 6, d2r: 3, d1l: 2, rr: 5, ssgEg: 0 },
      { dt1: 7, mul: 2, tl: 25, rs: 1, ar: 25, am: 0, d1r: 5, d2r: 3, d1l: 2, rr: 5, ssgEg: 0 },
      { dt1: 0, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 4, d2r: 2, d1l: 1, rr: 6, ssgEg: 0 },
      { dt1: 3, mul: 4, tl: 35, rs: 1, ar: 20, am: 0, d1r: 7, d2r: 4, d1l: 3, rr: 5, ssgEg: 0 },
    ],
  },
};

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeFmOperator(op = {}) {
  const d1r = op.d1r ?? op.dr;
  const d2r = op.d2r ?? op.sr;
  const d1l = op.d1l ?? op.sl;
  const dt1 = op.dt1 ?? op.detune;
  const mul = op.mul ?? op.multiple;
  return {
    dt1: clamp(dt1, 0, 7, 0),
    mul: clamp(mul, 0, 15, 1),
    tl: clamp(op.tl, 0, 127, 32),
    rs: clamp(op.rs, 0, 3, 0),
    ar: clamp(op.ar, 0, 31, 31),
    am: clamp(op.am, 0, 1, 0),
    d1r: clamp(d1r, 0, 31, 12),
    d2r: clamp(d2r, 0, 31, 0),
    d1l: clamp(d1l, 0, 15, 4),
    rr: clamp(op.rr, 0, 15, 8),
    ssgEg: clamp(op.ssgEg, 0, 15, 0),
    detune: clamp(dt1, 0, 7, 0),
    multiple: clamp(mul, 0, 15, 1),
    dr: clamp(d1r, 0, 31, 12),
    sr: clamp(d2r, 0, 31, 0),
    sl: clamp(d1l, 0, 15, 4),
  };
}

function normalizeInstrument(instrument = {}) {
  const type = String(instrument.type || 'fm').toLowerCase();
  if (type === 'fm') {
    const fallback = FM_PATCHES.bell;
    const ops = Array.isArray(instrument.operators) ? instrument.operators : fallback.operators;
    return {
      id: String(instrument.id || 'fm_bell'),
      name: String(instrument.name || fallback.name),
      type: 'fm',
      volume: clamp(instrument.volume, 0, 15, 12),
      pan: ['left', 'right', 'center'].includes(instrument.pan) ? instrument.pan : 'center',
      algorithm: clamp(instrument.algorithm, 0, 7, fallback.algorithm),
      feedback: clamp(instrument.feedback, 0, 7, fallback.feedback),
      ams: clamp(instrument.ams, 0, 3, 0),
      fms: clamp(instrument.fms, 0, 7, 0),
      operators: Array.from({ length: 4 }, (_, index) => normalizeFmOperator(ops[index] || fallback.operators[index])),
    };
  }
  return {
    id: String(instrument.id || (type === 'noise' ? 'noise_kit' : 'psg_square')),
    name: String(instrument.name || (type === 'noise' ? 'Noise Kit' : 'PSG Square')),
    type: type === 'noise' ? 'noise' : 'psg',
    volume: clamp(instrument.volume, 0, 15, 10),
    pan: ['left', 'right', 'center'].includes(instrument.pan) ? instrument.pan : 'center',
    envelope: String(instrument.envelope || 'hold'),
    toneMode: String(instrument.toneMode || 'square'),
    noiseFrequency: String(instrument.noiseFrequency || 'clocked'),
  };
}

function normalizeSong(song = {}) {
  const next = { ...song };
  next.version = Math.max(2, Number(next.version) || 2);
  next.speed = clamp(next.speed, 1, 31, DEFAULT_TICKS_PER_ROW);
  next.tempo = clamp(next.tempo, 30, 300, 150);
  next.rowsPerPattern = Number(next.rowsPerPattern) || ROWS_PER_PATTERN;
  next.instruments = Array.isArray(next.instruments) && next.instruments.length
    ? next.instruments.map(normalizeInstrument)
    : [normalizeInstrument({ id: 'fm_bell' }), normalizeInstrument({ type: 'psg' }), normalizeInstrument({ type: 'noise' })];
  return next;
}

function carrierSlots(algorithm) {
  return {
    0: [3],
    1: [3],
    2: [3],
    3: [3],
    4: [1, 3],
    5: [1, 2, 3],
    6: [1, 2, 3],
    7: [0, 1, 2, 3],
  }[clamp(algorithm, 0, 7, 0)] || [3];
}

function fmFnumBlock(midiNote) {
  const clamped = clamp(midiNote, 0, 127, 60);
  return {
    fnum: FNUMBER_TABLE[((clamped % 12) + 12) % 12],
    block: clamp(Math.floor(clamped / 12) - 1, 0, 7, 4),
  };
}

function psgTonePeriod(midiNote) {
  const note = clamp(midiNote, 0, 127, 60);
  const frequency = 440 * (2 ** ((note - 69) / 12));
  return clamp(3579545 / (32 * frequency), 1, 0x3ff, 1);
}

function rowDurationMs(song) {
  const normalized = normalizeSong(song);
  return (60000 / normalized.tempo / 4) * (normalized.speed / DEFAULT_TICKS_PER_ROW);
}

function rowWaitSamples(song) {
  return Math.max(1, Math.round(VGM_SAMPLE_RATE * rowDurationMs(song) / 1000));
}

function channelIndex(channelId) {
  const fm = String(channelId || '').match(/^FM([1-6])$/);
  return fm ? Number(fm[1]) - 1 : -1;
}

function ymPortForIndex(index) {
  if (index < 0 || index > 5) return null;
  return { port: index >= 3 ? 1 : 0, regOffset: index % 3, keyBits: index < 3 ? index : index - 3 + 4 };
}

function channelType(channelId) {
  if (/^FM[1-6]$/.test(String(channelId || ''))) return 'fm';
  return channelId === 'NOISE' ? 'noise' : 'psg';
}

function psgChannelIndex(channelId) {
  if (channelId === 'PSG1') return 0;
  if (channelId === 'PSG2') return 1;
  if (channelId === 'PSG3') return 2;
  return 3;
}

class YmChannel {
  constructor(index) {
    this.index = index;
    const mapped = ymPortForIndex(index);
    this.port = mapped.port;
    this.regOffset = mapped.regOffset;
    this.keyBits = mapped.keyBits;
    this.active = false;
    this.currentNote = -1;
    this.midiChannel = -1;
    this.patchName = '';
    this.noteOnTick = 0;
  }

  keyValue(mask = 0xf0) {
    return mask | this.keyBits;
  }
}

class MidiChannelState {
  constructor(channel) {
    this.channel = channel;
    this.program = 0;
    this.volume = 127;
  }

  get patchName() {
    if (this.channel === 9) return 'percussion';
    if (this.program < 16) return 'piano';
    if (this.program < 32) return 'strings';
    if (this.program < 40) return 'bass';
    if (this.program < 56) return 'strings';
    if (this.program < 72) return 'brass';
    return 'strings';
  }
}

class MdVgmWriter {
  constructor() {
    this.data = [];
    this.totalSamples = 0;
    this.loopOffset = -1;
    this.samplesAtLoopPoint = 0;
    this.fmChannels = Array.from({ length: FM_CHANNELS }, (_, index) => new YmChannel(index));
    this.noteChannelMap = new Map();
    this.midiStates = new Map();
  }

  midiState(channel) {
    if (!this.midiStates.has(channel)) this.midiStates.set(channel, new MidiChannelState(channel));
    return this.midiStates.get(channel);
  }

  ymWrite(port, register, value) {
    this.data.push(port ? 0x53 : 0x52, register & 0xff, value & 0xff);
  }

  psgWrite(value) {
    this.data.push(0x50, value & 0xff);
  }

  wait(samples) {
    let remaining = Math.max(0, Math.floor(samples));
    this.totalSamples += remaining;
    while (remaining > 0) {
      if (remaining >= 65535) {
        this.data.push(0x61, 0xff, 0xff);
        remaining -= 65535;
      } else if (remaining === 735) {
        this.data.push(0x62);
        remaining = 0;
      } else if (remaining > 16) {
        this.data.push(0x61, remaining & 0xff, (remaining >> 8) & 0xff);
        remaining = 0;
      } else {
        this.data.push(0x70 + remaining - 1);
        remaining = 0;
      }
    }
  }

  initYm2612() {
    this.ymWrite(0, 0x22, 0x00);
    this.ymWrite(0, 0x27, 0x00);
    this.ymWrite(0, 0x2b, 0x00);
    this.fmChannels.forEach((channel) => this.ymWrite(0, 0x28, channel.keyValue(0x00)));
  }

  markLoopPoint() {
    this.loopOffset = this.data.length;
    this.samplesAtLoopPoint = this.totalSamples;
  }

  velocityToTl(velocity, baseTl = 0) {
    const vel = clamp(velocity, 0, 127, 127);
    if (vel <= 0) return 127;
    return clamp(baseTl + Math.floor((127 - vel) * 48 / 127), 0, 127, baseTl);
  }

  loadPatch(fmIndex, patch, options = {}) {
    const instrument = normalizeInstrument({ type: 'fm', ...(patch || {}) });
    const channel = this.fmChannels[fmIndex];
    if (!channel) return null;
    const carriers = new Set(carrierSlots(instrument.algorithm));
    const velocity = options.velocity == null ? 127 : options.velocity;
    instrument.operators.forEach((op, opIndex) => {
      const slot = YM_SLOT_OFFSETS[opIndex];
      const tl = carriers.has(opIndex) ? this.velocityToTl(velocity, op.tl) : op.tl;
      this.ymWrite(channel.port, 0x30 + channel.regOffset + slot, ((op.dt1 & 7) << 4) | (op.mul & 15));
      this.ymWrite(channel.port, 0x40 + channel.regOffset + slot, tl & 0x7f);
      this.ymWrite(channel.port, 0x50 + channel.regOffset + slot, ((op.rs & 3) << 6) | (op.ar & 0x1f));
      this.ymWrite(channel.port, 0x60 + channel.regOffset + slot, ((op.am & 1) << 7) | (op.d1r & 0x1f));
      this.ymWrite(channel.port, 0x70 + channel.regOffset + slot, op.d2r & 0x1f);
      this.ymWrite(channel.port, 0x80 + channel.regOffset + slot, ((op.d1l & 15) << 4) | (op.rr & 15));
      this.ymWrite(channel.port, 0x90 + channel.regOffset + slot, op.ssgEg & 0x0f);
    });
    this.ymWrite(channel.port, 0xb0 + channel.regOffset, ((instrument.feedback & 7) << 3) | (instrument.algorithm & 7));
    this.ymWrite(channel.port, 0xb4 + channel.regOffset, panBits(instrument.pan) | ((instrument.ams & 3) << 4) | (instrument.fms & 7));
    return instrument;
  }

  allocateFmChannel(midiChannel, currentTick) {
    const requiredPatch = this.midiState(midiChannel).patchName;
    let firstFree = -1;
    for (let index = 0; index < FM_CHANNELS; index += 1) {
      const channel = this.fmChannels[index];
      if (!channel.active) {
        if (channel.patchName === requiredPatch) return index;
        if (firstFree < 0) firstFree = index;
      }
    }
    if (firstFree >= 0) return firstFree;
    let sameChannelOldest = -1;
    let sameChannelTick = currentTick + 1;
    for (let index = 0; index < FM_CHANNELS; index += 1) {
      const channel = this.fmChannels[index];
      if (channel.midiChannel === midiChannel && channel.noteOnTick < sameChannelTick) {
        sameChannelOldest = index;
        sameChannelTick = channel.noteOnTick;
      }
    }
    if (sameChannelOldest >= 0) return sameChannelOldest;
    let oldest = 0;
    for (let index = 1; index < FM_CHANNELS; index += 1) {
      if (this.fmChannels[index].noteOnTick < this.fmChannels[oldest].noteOnTick) oldest = index;
    }
    return oldest;
  }

  noteToFnumBlock(note) {
    return fmFnumBlock(note);
  }

  noteOn(fmIndex, note, velocity = 127, patch = null, currentTick = 0) {
    const channel = this.fmChannels[fmIndex];
    if (!channel) return;
    this.ymWrite(0, 0x28, channel.keyValue(0x00));
    if (patch) this.loadPatch(fmIndex, patch, { velocity });
    const { fnum, block } = fmFnumBlock(note);
    this.ymWrite(channel.port, 0xa4 + channel.regOffset, ((fnum >> 8) & 7) | ((block & 7) << 3));
    this.ymWrite(channel.port, 0xa0 + channel.regOffset, fnum & 0xff);
    this.ymWrite(0, 0x28, channel.keyValue(0xf0));
    channel.active = true;
    channel.currentNote = note;
    channel.noteOnTick = currentTick;
  }

  noteOff(fmIndex) {
    const channel = this.fmChannels[fmIndex];
    if (!channel) return;
    this.ymWrite(0, 0x28, channel.keyValue(0x00));
    channel.active = false;
    channel.currentNote = -1;
  }

  releaseFmChannel(midiChannel, note) {
    const key = `${midiChannel}:${note}`;
    if (this.noteChannelMap.has(key)) {
      const fmIndex = this.noteChannelMap.get(key);
      this.noteChannelMap.delete(key);
      return fmIndex;
    }
    const index = this.fmChannels.findIndex((channel) => channel.midiChannel === midiChannel && channel.currentNote === note);
    return index >= 0 ? index : null;
  }

  psgToneOn(channelId, midiNote, volume = 10) {
    const ch = psgChannelIndex(channelId);
    const period = psgTonePeriod(midiNote);
    const attenuation = clamp(15 - volume, 0, 15, 5);
    this.psgWrite(0x80 | (ch << 5) | (period & 0x0f));
    this.psgWrite((period >> 4) & 0x3f);
    this.psgWrite(0x90 | (ch << 5) | attenuation);
  }

  psgNoiseOn(instrument = {}, volume = 10) {
    const mode = instrument.noiseFrequency === 'periodic' ? 0x00 : 0x04;
    const clock = instrument.noiseFrequency === 'clocked' ? 0x03 : 0x00;
    const attenuation = clamp(15 - volume, 0, 15, 5);
    this.psgWrite(0xe0 | mode | clock);
    this.psgWrite(0xf0 | attenuation);
  }

  psgOff(channelId) {
    const ch = psgChannelIndex(channelId);
    this.psgWrite(0x90 | (ch << 5) | 0x0f);
  }

  end() {
    this.data.push(0x66);
  }

  buildVgm() {
    const header = Buffer.alloc(0x100, 0);
    const body = Buffer.from(this.data);
    header.write('Vgm ', 0, 'ascii');
    header.writeUInt32LE(header.length + body.length - 4, 0x04);
    header.writeUInt32LE(VGM_VERSION, 0x08);
    header.writeUInt32LE(SN76489_CLOCK, 0x0c);
    header.writeUInt32LE(this.totalSamples, 0x18);
    if (this.loopOffset >= 0) {
      const loopAbs = header.length + this.loopOffset;
      header.writeUInt32LE(loopAbs - 0x1c, 0x1c);
      header.writeUInt32LE(this.totalSamples - this.samplesAtLoopPoint, 0x20);
    }
    header.writeUInt16LE(0x0009, 0x28);
    header[0x2a] = 16;
    header.writeUInt32LE(YM2612_CLOCK, 0x2c);
    header.writeUInt32LE(header.length - 0x34, 0x34);
    return Buffer.concat([header, body]);
  }
}

function panBits(pan) {
  if (pan === 'left') return 0x80;
  if (pan === 'right') return 0x40;
  return 0xc0;
}

function findInstrument(song, instrumentId, type) {
  const normalized = normalizeSong(song);
  const instruments = normalized.instruments || [];
  const exact = instruments.find((entry) => entry.id === instrumentId);
  if (exact && (!type || exact.type === type)) return exact;
  return instruments.find((entry) => entry.type === type) || normalizeInstrument({ type });
}

function noteNameToMidi(noteName) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const match = String(noteName || '').trim().match(/^([A-G])(#?)(-?\d+)$/i);
  if (!match) return null;
  const index = names.indexOf(`${match[1].toUpperCase()}${match[2] || ''}`);
  if (index < 0) return null;
  return (Number(match[3]) + 1) * 12 + index;
}

function cellMidiNote(cell) {
  if (cell?.midiNote != null) return cell.midiNote;
  return noteNameToMidi(cell?.note);
}

function buildVgmEvents(song, options = {}) {
  const normalized = normalizeSong(song);
  const writer = new MdVgmWriter();
  const diagnostics = [];
  const stats = { fmNotes: 0, psgNotes: 0, waits: 0 };
  const waitSamples = rowWaitSamples(normalized);
  writer.initYm2612();
  if (options.loop !== false) writer.markLoopPoint();

  const patternMap = new Map((normalized.patterns || []).map((pattern) => [pattern.id, pattern]));
  for (const patternId of normalized.order || []) {
    const pattern = patternMap.get(patternId);
    for (const row of pattern?.rows || []) {
      const activeOffs = [];
      for (const channel of CHANNELS) {
        const cell = row.cells?.[channel.id];
        if (!cell?.note) continue;
        const type = channelType(channel.id);
        const instrument = findInstrument(normalized, cell.instrument, type);
        const volume = clamp(cell.volume ?? instrument.volume, 0, 15, instrument.volume || 10);
        if (type === 'fm') {
          const midi = cellMidiNote(cell);
          const index = channelIndex(channel.id);
          if (midi == null || index < 0) continue;
          const patched = { ...instrument, pan: cell.pan || instrument.pan };
          writer.noteOn(index, midi, Math.max(1, Math.round(volume * 127 / 15)), patched, stats.waits);
          activeOffs.push(() => writer.noteOff(index));
          stats.fmNotes += 1;
        } else if (type === 'noise') {
          writer.psgNoiseOn(instrument, volume);
          activeOffs.push(() => writer.psgOff('NOISE'));
          stats.psgNotes += 1;
        } else {
          const midi = cellMidiNote(cell);
          if (midi == null) continue;
          writer.psgToneOn(channel.id, midi, volume);
          activeOffs.push(() => writer.psgOff(channel.id));
          stats.psgNotes += 1;
        }
      }
      writer.wait(waitSamples);
      activeOffs.forEach((fn) => fn());
      stats.waits += 1;
    }
  }
  writer.end();
  return { writer, data: Buffer.from(writer.data), diagnostics, stats };
}

function writeVgm(song, options = {}) {
  return buildVgmEvents(song, options).writer.buildVgm();
}

function renderPreviewPcm(events, options = {}) {
  return {
    ok: false,
    warnings: ['高精度WASMプレビューエンジンが読み込まれていないため、簡易プレビューへフォールバックします。'],
    events,
    options,
  };
}

module.exports = {
  VGM_VERSION,
  VGM_SAMPLE_RATE,
  YM2612_CLOCK,
  SN76489_CLOCK,
  FM_CHANNELS,
  CHANNELS,
  FM_PATCHES,
  YM_SLOT_OFFSETS,
  MdVgmWriter,
  normalizeInstrument,
  normalizeSong,
  normalizeFmOperator,
  carrierSlots,
  fmFnumBlock,
  psgTonePeriod,
  rowDurationMs,
  rowWaitSamples,
  buildVgmEvents,
  writeVgm,
  renderPreviewPcm,
};
