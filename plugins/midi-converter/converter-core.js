'use strict';

const mdAudio = require('../shared/md-audio-engine');

const VGM_VERSION = 0x00000151;
const VGM_SAMPLE_RATE = 44100;
const YM2612_CLOCK = 7670454;
const SN76489_CLOCK = 3579545;
const FM_CHANNELS = 6;
const FNUMBER_TABLE = [644, 682, 723, 766, 811, 860, 911, 965, 1022, 1083, 1147, 1215];

const FM_PATCHES = {
  bass: {
    name: 'Bass Guitar',
    algorithm: 2,
    feedback: 6,
    operators: [
      { dt1: 3, mul: 0, tl: 35, rs: 1, ar: 31, am: 0, d1r: 10, d2r: 5, d1l: 3, rr: 7 },
      { dt1: 3, mul: 1, tl: 30, rs: 1, ar: 31, am: 0, d1r: 12, d2r: 5, d1l: 3, rr: 7 },
      { dt1: 7, mul: 1, tl: 50, rs: 0, ar: 20, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 6 },
      { dt1: 3, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 8 },
    ],
  },
  strings: {
    name: 'Strings',
    algorithm: 4,
    feedback: 3,
    operators: [
      { dt1: 3, mul: 1, tl: 40, rs: 1, ar: 20, am: 0, d1r: 5, d2r: 2, d1l: 1, rr: 4 },
      { dt1: 4, mul: 2, tl: 35, rs: 0, ar: 18, am: 0, d1r: 4, d2r: 2, d1l: 1, rr: 4 },
      { dt1: 3, mul: 1, tl: 45, rs: 1, ar: 22, am: 0, d1r: 6, d2r: 3, d1l: 2, rr: 5 },
      { dt1: 7, mul: 1, tl: 0, rs: 1, ar: 25, am: 0, d1r: 3, d2r: 2, d1l: 1, rr: 5 },
    ],
  },
  percussion: {
    name: 'Percussion',
    algorithm: 7,
    feedback: 7,
    operators: [
      { dt1: 7, mul: 14, tl: 20, rs: 3, ar: 31, am: 0, d1r: 20, d2r: 15, d1l: 14, rr: 15 },
      { dt1: 0, mul: 0, tl: 10, rs: 3, ar: 31, am: 0, d1r: 18, d2r: 15, d1l: 14, rr: 15 },
      { dt1: 7, mul: 13, tl: 15, rs: 3, ar: 31, am: 0, d1r: 22, d2r: 15, d1l: 14, rr: 15 },
      { dt1: 0, mul: 0, tl: 0, rs: 3, ar: 31, am: 0, d1r: 25, d2r: 15, d1l: 15, rr: 15 },
    ],
  },
  piano: {
    name: 'Piano',
    algorithm: 0,
    feedback: 5,
    operators: [
      { dt1: 7, mul: 1, tl: 27, rs: 2, ar: 31, am: 0, d1r: 7, d2r: 3, d1l: 1, rr: 7 },
      { dt1: 0, mul: 2, tl: 20, rs: 1, ar: 31, am: 0, d1r: 5, d2r: 3, d1l: 1, rr: 7 },
      { dt1: 3, mul: 3, tl: 30, rs: 1, ar: 28, am: 0, d1r: 8, d2r: 4, d1l: 2, rr: 6 },
      { dt1: 0, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 9, d2r: 5, d1l: 3, rr: 8 },
    ],
  },
  brass: {
    name: 'Brass',
    algorithm: 3,
    feedback: 5,
    operators: [
      { dt1: 3, mul: 1, tl: 30, rs: 2, ar: 28, am: 0, d1r: 6, d2r: 3, d1l: 2, rr: 5 },
      { dt1: 7, mul: 2, tl: 25, rs: 1, ar: 25, am: 0, d1r: 5, d2r: 3, d1l: 2, rr: 5 },
      { dt1: 0, mul: 1, tl: 0, rs: 2, ar: 31, am: 0, d1r: 4, d2r: 2, d1l: 1, rr: 6 },
      { dt1: 3, mul: 4, tl: 35, rs: 1, ar: 20, am: 0, d1r: 7, d2r: 4, d1l: 3, rr: 5 },
    ],
  },
};

const PROGRAM_TO_PATCH = Array.from({ length: 128 }, (_, program) => {
  if (program < 16) return 'piano';
  if (program < 32) return 'strings';
  if (program < 40) return 'bass';
  if (program < 56) return 'strings';
  if (program < 72) return 'brass';
  return 'strings';
});

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
  if (reader.readAscii(4) !== 'MThd') throw new Error('MIDI header MThd が見つかりません。');
  const headerLength = reader.readUInt32BE();
  if (headerLength < 6) throw new Error('MIDI header が短すぎます。');
  const format = reader.readUInt16BE();
  const trackCount = reader.readUInt16BE();
  const division = reader.readUInt16BE();
  if (headerLength > 6) reader.readBytes(headerLength - 6);
  if (division & 0x8000) throw new Error('SMPTE time division の MIDI は未対応です。');

  const tracks = [];
  for (let trackIndex = 0; trackIndex < trackCount && reader.remaining() >= 8; trackIndex += 1) {
    const chunkId = reader.readAscii(4);
    const chunkLength = reader.readUInt32BE();
    const data = reader.readBytes(chunkLength);
    if (chunkId === 'MTrk') tracks.push(parseMidiTrack(data, trackIndex));
  }

  return { format, trackCount, division, tracks };
}

function parseMidiTrack(data, trackIndex) {
  const reader = new ByteReader(data);
  const events = [];
  let tick = 0;
  let runningStatus = 0;

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
      const metaType = reader.readUInt8();
      const length = reader.readVarLen();
      const payload = reader.readBytes(length);
      if (metaType === 0x51 && payload.length === 3) {
        events.push({ tick, type: 'tempo', tempo: (payload[0] << 16) | (payload[1] << 8) | payload[2] });
      } else if (metaType === 0x2F) {
        break;
      }
      continue;
    }

    if (status === 0xF0 || status === 0xF7) {
      reader.readBytes(reader.readVarLen());
      continue;
    }

    const eventType = status & 0xF0;
    const channel = status & 0x0F;
    const data1 = reader.readUInt8();
    const data2 = eventType === 0xC0 || eventType === 0xD0 ? 0 : reader.readUInt8();

    if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
      events.push({ tick, type: 'noteOff', channel, note: data1, velocity: data2 });
    } else if (eventType === 0x90) {
      events.push({ tick, type: 'noteOn', channel, note: data1, velocity: data2 });
    } else if (eventType === 0xB0) {
      events.push({ tick, type: 'control', channel, controller: data1, value: data2 });
    } else if (eventType === 0xC0) {
      events.push({ tick, type: 'program', channel, program: data1 });
    } else if (eventType === 0xE0) {
      events.push({ tick, type: 'pitchBend', channel });
    }
  }

  return { index: trackIndex, events };
}

class YmChannel {
  constructor(index) {
    this.index = index;
    this.port = index < 3 ? 0 : 1;
    this.regOffset = index % 3;
    this.active = false;
    this.currentNote = -1;
    this.midiChannel = -1;
    this.patchName = '';
    this.noteOnTick = 0;
  }

  keyValue(slotMask = 0xF0) {
    const channelBits = this.index < 3 ? this.index : this.index - 3 + 4;
    return slotMask | channelBits;
  }
}

class MidiChannelState {
  constructor(channel) {
    this.channel = channel;
    this.program = 0;
    this.volume = 127;
  }

  get patchName() {
    return this.channel === 9 ? 'percussion' : PROGRAM_TO_PATCH[this.program] || 'strings';
  }
}

class VgmWriter {
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
    this.data.push(port ? 0x53 : 0x52, register & 0xFF, value & 0xFF);
  }

  wait(samples) {
    let remaining = Math.max(0, Math.floor(samples));
    this.totalSamples += remaining;
    while (remaining > 0) {
      if (remaining >= 65535) {
        this.data.push(0x61, 0xFF, 0xFF);
        remaining -= 65535;
      } else if (remaining > 16) {
        this.data.push(0x61, remaining & 0xFF, (remaining >> 8) & 0xFF);
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
    this.ymWrite(0, 0x2B, 0x00);
    this.fmChannels.forEach((channel) => this.ymWrite(0, 0x28, channel.keyValue(0x00)));
  }

  markLoopPoint() {
    this.loopOffset = this.data.length;
    this.samplesAtLoopPoint = this.totalSamples;
  }

  loadPatch(fmIndex, patch) {
    const channel = this.fmChannels[fmIndex];
    const slotOffsets = [0x00, 0x08, 0x04, 0x0C];
    patch.operators.forEach((op, opIndex) => {
      const slot = slotOffsets[opIndex];
      this.ymWrite(channel.port, 0x30 + channel.regOffset + slot, ((op.dt1 & 7) << 4) | (op.mul & 15));
      this.ymWrite(channel.port, 0x40 + channel.regOffset + slot, op.tl & 0x7F);
      this.ymWrite(channel.port, 0x50 + channel.regOffset + slot, ((op.rs & 3) << 6) | (op.ar & 0x1F));
      this.ymWrite(channel.port, 0x60 + channel.regOffset + slot, ((op.am & 1) << 7) | (op.d1r & 0x1F));
      this.ymWrite(channel.port, 0x70 + channel.regOffset + slot, op.d2r & 0x1F);
      this.ymWrite(channel.port, 0x80 + channel.regOffset + slot, ((op.d1l & 15) << 4) | (op.rr & 15));
      this.ymWrite(channel.port, 0x90 + channel.regOffset + slot, 0);
    });
    this.ymWrite(channel.port, 0xB0 + channel.regOffset, ((patch.feedback & 7) << 3) | (patch.algorithm & 7));
    this.ymWrite(channel.port, 0xB4 + channel.regOffset, 0xC0);
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
    const clamped = Math.max(0, Math.min(127, Number(note) || 0));
    return {
      fnum: FNUMBER_TABLE[clamped % 12],
      block: Math.max(0, Math.min(7, Math.floor(clamped / 12) - 1)),
    };
  }

  velocityToTl(velocity, baseTl = 0) {
    if (velocity <= 0) return 127;
    return Math.min(127, baseTl + Math.floor((127 - velocity) * 48 / 127));
  }

  carrierSlots(algorithm) {
    return {
      0: [3],
      1: [3],
      2: [3],
      3: [3],
      4: [1, 3],
      5: [1, 2, 3],
      6: [1, 2, 3],
      7: [0, 1, 2, 3],
    }[algorithm] || [3];
  }

  noteOn(fmIndex, note, velocity, patch, currentTick) {
    const channel = this.fmChannels[fmIndex];
    const slotOffsets = [0x00, 0x08, 0x04, 0x0C];
    this.ymWrite(0, 0x28, channel.keyValue(0x00));
    const carriers = new Set(this.carrierSlots(patch.algorithm));
    patch.operators.forEach((op, opIndex) => {
      if (carriers.has(opIndex)) {
        this.ymWrite(channel.port, 0x40 + channel.regOffset + slotOffsets[opIndex], this.velocityToTl(velocity, op.tl));
      }
    });
    const { fnum, block } = this.noteToFnumBlock(note);
    this.ymWrite(channel.port, 0xA4 + channel.regOffset, ((fnum >> 8) & 7) | ((block & 7) << 3));
    this.ymWrite(channel.port, 0xA0 + channel.regOffset, fnum & 0xFF);
    this.ymWrite(0, 0x28, channel.keyValue(0xF0));
    channel.active = true;
    channel.currentNote = note;
    channel.noteOnTick = currentTick;
  }

  noteOff(fmIndex) {
    const channel = this.fmChannels[fmIndex];
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

  end() {
    this.data.push(0x66);
  }

  buildVgm() {
    const header = Buffer.alloc(0x100, 0);
    const body = Buffer.from(this.data);
    header.write('Vgm ', 0, 'ascii');
    header.writeUInt32LE(header.length + body.length - 4, 0x04);
    header.writeUInt32LE(VGM_VERSION, 0x08);
    header.writeUInt32LE(SN76489_CLOCK, 0x0C);
    header.writeUInt32LE(this.totalSamples, 0x18);
    if (this.loopOffset >= 0) {
      const loopAbs = header.length + this.loopOffset;
      header.writeUInt32LE(loopAbs - 0x1C, 0x1C);
      header.writeUInt32LE(this.totalSamples - this.samplesAtLoopPoint, 0x20);
    }
    header.writeUInt16LE(0x0009, 0x28);
    header[0x2A] = 16;
    header.writeUInt32LE(YM2612_CLOCK, 0x2C);
    header.writeUInt32LE(header.length - 0x34, 0x34);
    return Buffer.concat([header, body]);
  }
}

function mergeEvents(midi) {
  const events = midi.tracks.flatMap((track) => track.events);
  const priority = { tempo: 0, program: 1, control: 2, noteOff: 3, noteOn: 4, pitchBend: 5 };
  events.sort((a, b) => (a.tick - b.tick) || ((priority[a.type] ?? 9) - (priority[b.type] ?? 9)));
  return events;
}

function analyzeMidiChannels(events) {
  const info = new Map();
  const active = new Map();
  let maxGlobalPolyphony = 0;

  function ensure(channel) {
    if (!info.has(channel)) {
      info.set(channel, {
        noteCount: 0,
        minNote: 127,
        maxNote: 0,
        maxPolyphony: 0,
        isPercussion: channel === 9,
        program: 0,
        maxGlobalPolyphony: 0,
      });
    }
    if (!active.has(channel)) active.set(channel, new Set());
    return info.get(channel);
  }

  events.forEach((event) => {
    if (event.type === 'program') ensure(event.channel).program = event.program;
    if (event.type === 'noteOn') {
      const entry = ensure(event.channel);
      entry.noteCount += 1;
      entry.minNote = Math.min(entry.minNote, event.note);
      entry.maxNote = Math.max(entry.maxNote, event.note);
      active.get(event.channel).add(event.note);
      entry.maxPolyphony = Math.max(entry.maxPolyphony, active.get(event.channel).size);
      maxGlobalPolyphony = Math.max(maxGlobalPolyphony, Array.from(active.values()).reduce((sum, set) => sum + set.size, 0));
    } else if (event.type === 'noteOff') {
      ensure(event.channel);
      active.get(event.channel).delete(event.note);
    }
  });

  info.forEach((entry) => {
    entry.maxGlobalPolyphony = maxGlobalPolyphony;
  });
  return Array.from(info.entries()).map(([channel, entry]) => ({ channel, ...entry }));
}

function convertMidiBufferToVgm(buffer) {
  const midi = parseMidi(buffer);
  const events = mergeEvents(midi);
  const channelInfo = analyzeMidiChannels(events);
  if (channelInfo.length === 0) {
    return { ok: false, error: '変換対象のMIDIチャンネルがありません', warnings: [], diagnostics: [] };
  }

  const writer = new mdAudio.MdVgmWriter();
  writer.initYm2612();
  for (let index = 0; index < FM_CHANNELS; index += 1) {
    writer.loadPatch(index, mdAudio.FM_PATCHES.strings);
    writer.fmChannels[index].patchName = 'strings';
  }
  writer.markLoopPoint();

  let tempoUs = 500000;
  let currentTick = 0;
  let accumulatedSamples = 0;
  let noteOn = 0;
  let noteOff = 0;
  let voiceSteal = 0;
  let patchSwitch = 0;
  let pitchBendIgnored = 0;

  events.forEach((event) => {
    const deltaTicks = event.tick - currentTick;
    if (deltaTicks > 0) {
      const deltaSamples = deltaTicks * tempoUs * VGM_SAMPLE_RATE / (midi.division * 1000000);
      accumulatedSamples += deltaSamples;
      const intSamples = Math.floor(accumulatedSamples);
      if (intSamples > 0) {
        writer.wait(intSamples);
        accumulatedSamples -= intSamples;
      }
      currentTick = event.tick;
    }

    if (event.type === 'tempo') {
      tempoUs = event.tempo;
    } else if (event.type === 'program') {
      writer.midiState(event.channel).program = event.program;
    } else if (event.type === 'control' && event.controller === 7) {
      writer.midiState(event.channel).volume = event.value;
    } else if (event.type === 'pitchBend') {
      pitchBendIgnored += 1;
    } else if (event.type === 'noteOn') {
      const midiState = writer.midiState(event.channel);
      const effectiveVelocity = Math.max(1, Math.min(127, Math.floor(event.velocity * midiState.volume / 127)));
      const fmIndex = writer.allocateFmChannel(event.channel, currentTick);
      const fmChannel = writer.fmChannels[fmIndex];
      if (fmChannel.active) {
        writer.noteChannelMap.delete(`${fmChannel.midiChannel}:${fmChannel.currentNote}`);
        writer.noteOff(fmIndex);
        voiceSteal += 1;
      }
      const patchName = midiState.patchName;
      if (fmChannel.patchName !== patchName) {
        writer.loadPatch(fmIndex, mdAudio.FM_PATCHES[patchName] || mdAudio.FM_PATCHES.strings);
        fmChannel.patchName = patchName;
        patchSwitch += 1;
      }
      writer.noteOn(fmIndex, event.note, effectiveVelocity, mdAudio.FM_PATCHES[patchName] || mdAudio.FM_PATCHES.strings, currentTick);
      fmChannel.midiChannel = event.channel;
      writer.noteChannelMap.set(`${event.channel}:${event.note}`, fmIndex);
      noteOn += 1;
    } else if (event.type === 'noteOff') {
      const fmIndex = writer.releaseFmChannel(event.channel, event.note);
      if (fmIndex != null) {
        writer.noteOff(fmIndex);
        noteOff += 1;
      }
    }
  });

  writer.fmChannels.forEach((channel, index) => {
    if (channel.active) writer.noteOff(index);
  });
  writer.end();

  const warnings = [];
  const diagnostics = [];
  const maxGlobalPolyphony = Math.max(...channelInfo.map((entry) => entry.maxGlobalPolyphony), 0);
  if (maxGlobalPolyphony > FM_CHANNELS) {
    const message = `最大同時発音数 ${maxGlobalPolyphony} が FM ${FM_CHANNELS}ch を超えたため voice steal が発生します。`;
    warnings.push(message);
    diagnostics.push({ level: 'warn', code: 'voice-steal', message });
  }
  if (pitchBendIgnored > 0) {
    const message = `Pitch bend ${pitchBendIgnored} 件は VGM direct 変換では無視しました。`;
    warnings.push(message);
    diagnostics.push({ level: 'info', code: 'pitch-bend-ignored', message });
  }

  return {
    ok: true,
    vgm: writer.buildVgm(),
    warnings,
    diagnostics,
    stats: {
      midi_format: midi.format,
      tracks: midi.tracks.length,
      division: midi.division,
      events: events.length,
      midi_channels: channelInfo.length,
      max_global_polyphony: maxGlobalPolyphony,
      note_on: noteOn,
      note_off: noteOff,
      voice_steal: voiceSteal,
      patch_switch: patchSwitch,
      total_samples: writer.totalSamples,
      duration_sec: writer.totalSamples / VGM_SAMPLE_RATE,
      loop_offset: writer.loopOffset,
    },
  };
}

module.exports = {
  FM_CHANNELS,
  FM_PATCHES,
  parseMidi,
  analyzeMidiChannels,
  convertMidiBufferToVgm,
};
