'use strict';

const crypto = require('crypto');
const {
  MdVgmWriter,
  FM_PATCHES,
} = require('../shared/md-audio-engine');
const {
  decodePng,
  quantizeImages,
  countUniqueTiles,
} = require('./novel-image');

const VGM_SAMPLE_RATE = 44100;

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function hashBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function noteToMidi(value) {
  const match = String(value || '').trim().match(/^([A-G])(#?)(-?\d+)$/i);
  if (!match) return null;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = `${match[1].toUpperCase()}${match[2] || ''}`;
  return (Number(match[3]) + 1) * 12 + names.indexOf(name);
}

function periodToFrequency(period) {
  return 3579545 / (32 * (clamp(period, 0, 4095, 428) + 1));
}

function eventMidi(event) {
  const named = noteToMidi(event?.note);
  if (named != null) return clamp(named, 0, 127, 60);
  const frequency = periodToFrequency(event?.period);
  return clamp(69 + 12 * Math.log2(frequency / 440), 0, 127, 60);
}

function shiftedChannel(event, baseChannel) {
  return clamp(Number(event?.channel) + Number(baseChannel || 0), 0, 5, 0);
}

function stepSamples(asset, sampleRate = VGM_SAMPLE_RATE) {
  const bpm = clamp(asset?.options?.bpm, 30, 300, 120);
  return Math.max(1, Math.round(sampleRate * 60 / bpm / 4));
}

function groupedEvents(asset, baseChannel) {
  const result = new Map();
  for (const source of asset?.options?.pattern || []) {
    const event = { ...source, channel: shiftedChannel(source, baseChannel) };
    const step = clamp(source?.step, 0, 4095, 0);
    if (!result.has(step)) result.set(step, []);
    result.get(step).push(event);
  }
  return result;
}

function generatePsgSongVgm(asset, baseChannel = 0) {
  const writer = new MdVgmWriter();
  const events = groupedEvents(asset, baseChannel);
  const maxEventStep = events.size ? Math.max(...events.keys()) + 1 : 1;
  const steps = clamp(asset?.options?.steps, 1, 4096, maxEventStep);
  const wait = stepSamples(asset);
  const activeFm = new Set();
  let noiseActive = false;
  writer.initYm2612();
  writer.markLoopPoint();
  for (let step = 0; step < steps; step += 1) {
    for (const event of events.get(step) || []) {
      const channel = event.channel;
      const volume = clamp(event.volume, 0, 31, 0);
      if (channel < 4) {
        if (activeFm.has(channel)) writer.noteOff(channel);
        activeFm.delete(channel);
        if (volume > 0) {
          const patch = [FM_PATCHES.bell, FM_PATCHES.bass, FM_PATCHES.strings, FM_PATCHES.bass][channel];
          writer.noteOn(channel, eventMidi(event), Math.max(1, Math.round(volume * 127 / 31)), patch, step);
          activeFm.add(channel);
        }
      } else {
        if (noiseActive) writer.psgOff('NOISE');
        noiseActive = false;
        if (volume > 0) {
          writer.psgNoiseOn({ noiseFrequency: Number(event.noise) ? 'periodic' : 'clocked' }, Math.max(1, Math.round(volume * 15 / 31)));
          noiseActive = true;
        }
      }
    }
    writer.wait(wait);
  }
  activeFm.forEach((channel) => writer.noteOff(channel));
  if (noiseActive) writer.psgOff('NOISE');
  writer.end();
  return writer.buildVgm();
}

function writeWav16(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataLength, 4);
  output.write('WAVEfmt ', 8, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataLength, 40);
  samples.forEach((sample, index) => output.writeInt16LE(clamp(sample, -32768, 32767, 0), 44 + index * 2));
  return output;
}

function generatePsgSfxWav(asset, baseChannel = 0, sampleRate = 6650) {
  const events = groupedEvents(asset, baseChannel);
  const maxEventStep = events.size ? Math.max(...events.keys()) + 1 : 1;
  const steps = clamp(asset?.options?.steps, 1, 4096, maxEventStep);
  const perStep = stepSamples(asset, sampleRate);
  const samples = [];
  let current = { period: asset?.options?.period || 428, volume: 0, channel: 0, noise: 0 };
  let phase = 0;
  let noiseState = 0x13579bdf;
  for (let step = 0; step < steps; step += 1) {
    const stepEvents = events.get(step) || [];
    if (stepEvents.length) current = stepEvents[stepEvents.length - 1];
    const volume = clamp(current.volume, 0, 31, 0) / 31;
    const frequency = Math.min(sampleRate / 2 - 1, periodToFrequency(current.period));
    for (let index = 0; index < perStep; index += 1) {
      let wave;
      if (current.channel >= 4 || Number(current.noise)) {
        noiseState ^= noiseState << 13;
        noiseState ^= noiseState >>> 17;
        noiseState ^= noiseState << 5;
        wave = noiseState & 1 ? 1 : -1;
      } else {
        phase += frequency / sampleRate;
        phase -= Math.floor(phase);
        wave = Math.sin(phase * Math.PI * 2);
      }
      samples.push(Math.round(wave * volume * 24575));
    }
  }
  return writeWav16(samples, sampleRate);
}

function spriteTiming(asset) {
  const editor = asset?.options?.spriteEditor || {};
  const raw = String(editor.time || '').trim();
  if (/^\[\[(?:\d+,?)+\](?:\[(?:\d+,?)+\])*\]$/.test(raw)) return raw;
  const animations = Array.isArray(asset?.options?.animations) ? asset.options.animations : [];
  if (!animations.length) return '1';
  return `[${animations.map((animation) => {
    const count = clamp(animation.frameCount, 1, 64, 1);
    const delays = Array.isArray(animation.frameDelays) ? animation.frameDelays : [];
    const values = Array.from({ length: count }, (_, index) => clamp(delays[index] ?? animation.frameDelay, 1, 255, 8));
    return `[${values.join(',')}]`;
  }).join('')}]`;
}

function visualMetadata(asset, image, converted, options = {}) {
  const sprite = asset.type === 'sprite';
  const animation = asset?.options?.animations?.[0] || {};
  const editor = asset?.options?.spriteEditor || {};
  const frameWidth = sprite ? clamp(editor.frameWidth ?? animation.frameWidth, 8, 248, image.width) : image.width;
  const frameHeight = sprite ? clamp(editor.frameHeight ?? animation.frameHeight, 8, 248, image.height) : image.height;
  const used = [...new Set(converted.indices)].sort((left, right) => left - right);
  return {
    width: image.width,
    height: image.height,
    uniqueTiles: countUniqueTiles(converted.indices, image.width, image.height),
    paletteEntries: converted.palette.length,
    paletteIndicesUsed: used,
    usesPaletteIndex1: used.includes(1),
    transparent: Boolean(options.reserveTransparent),
    paletteProfile: options.paletteProfile || 'general',
    quality: {
      meanDeltaE: Number(converted.quality?.meanDeltaE || 0),
      p95DeltaE: Number(converted.quality?.p95DeltaE || 0),
    },
    frameWidth,
    frameHeight,
    maxNumTile: sprite ? frameWidth * frameHeight / 64 : 0,
    maxNumSprite: sprite ? Math.ceil(frameWidth / 32) * Math.ceil(frameHeight / 32) : 0,
    timing: sprite ? spriteTiming(asset) : '',
    collision: sprite ? String(editor.collision || 'NONE') : '',
  };
}

function convertVisualGroup(entries, options = {}) {
  const requestedProfile = String(options.paletteProfile || 'general');
  const paletteProfile = ['pal0-reserved', 'shadow-safe-pal012', 'shadow-safe-pal3'].includes(requestedProfile) ? requestedProfile : 'general';
  const reserveTransparent = Boolean(options.reserveTransparent);
  const decoded = entries.map((entry) => ({
    ...(entry.decoded || decodePng(entry.buffer)),
    assetId: entry.asset.id,
    transparentIndex: entry.asset?.options?.transparentIndex,
    reserveTransparent: entry.asset.type === 'sprite',
  }));
  const result = quantizeImages(decoded, {
    reserveTransparent,
    transparentIndex: options.transparentIndex,
    fixedPalette: ['pal0-reserved', 'shadow-safe-pal012'].includes(paletteProfile)
      ? [[0, 0, 0, 255], [255, 255, 255, 255]]
      : [],
    forbiddenPaletteIndices: paletteProfile === 'shadow-safe-pal3' ? [14, 15]
      : paletteProfile === 'shadow-safe-pal012' ? [14] : [],
  });
  const physicalPalette = result.palette.map((color) => color.slice(0, 3));
  const paletteFingerprint = hashBuffer(Buffer.from(JSON.stringify(physicalPalette), 'utf8'));
  const outputs = new Map();
  result.images.forEach((converted, index) => {
    const entry = entries[index];
    outputs.set(entry.asset.id, {
      png: converted.png,
      palette: result.palette,
      paletteRgb333: physicalPalette,
      paletteFingerprint,
      metadata: visualMetadata(entry.asset, decoded[index], converted, { ...options, paletteProfile, reserveTransparent: entry.asset.type === 'sprite' }),
      contentHash: hashBuffer(converted.png),
    });
  });
  return outputs;
}

module.exports = {
  clamp,
  hashBuffer,
  noteToMidi,
  periodToFrequency,
  stepSamples,
  generatePsgSongVgm,
  generatePsgSfxWav,
  spriteTiming,
  visualMetadata,
  convertVisualGroup,
};
