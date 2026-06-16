const VGM_SAMPLE_RATE = 44100;
const YM2612_CHANNELS = 6;

export function canPreviewVgmEntry(entry = {}) {
  const source = String(entry.sourcePath || '').toLowerCase();
  const files = Array.isArray(entry.files) ? entry.files : [];
  const firstFile = String(files[0] || '').toLowerCase();
  const type = String(entry.type || '').toUpperCase();
  return source.endsWith('.vgm') || (['XGM', 'XGM2'].includes(type) && firstFile.endsWith('.vgm'));
}

export function dataUrlToBytes(dataUrl = '') {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  const body = comma >= 0 ? text.slice(comma + 1) : text;
  const binary = typeof atob === 'function'
    ? atob(body)
    : Buffer.from(body, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function readAscii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] || 0);
  return out;
}

function u16(bytes, offset) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] || 0)
    | ((bytes[offset + 1] || 0) << 8)
    | ((bytes[offset + 2] || 0) << 16)
    | ((bytes[offset + 3] || 0) << 24);
}

function hexBytes(bytes, offset, length) {
  return Array.from(bytes.slice(offset, offset + length))
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function skipDataBlock(bytes, offset, warnings) {
  if (bytes[offset] !== 0x66) {
    warnings.push(`Unsupported VGM data block at 0x${Math.max(0, offset - 1).toString(16)}.`);
    return bytes.length;
  }
  const size = u32(bytes, offset + 2) >>> 0;
  return Math.min(bytes.length, offset + 6 + size);
}

export function parseVgmBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const warnings = [];
  if (bytes.length < 0x40 || readAscii(bytes, 0, 4) !== 'Vgm ') {
    return { ok: false, error: 'VGM header が見つかりません。' };
  }

  const version = u32(bytes, 0x08) >>> 0;
  const sn76489Clock = u32(bytes, 0x0c) >>> 0;
  const ym2612Clock = u32(bytes, 0x2c) >>> 0;
  const dataOffsetValue = u32(bytes, 0x34) >>> 0;
  let offset = dataOffsetValue ? 0x34 + dataOffsetValue : 0x40;
  if (offset < 0x40 || offset >= bytes.length) offset = 0x40;
  const dataOffset = offset;

  const events = [];
  let waitSamples = 0;
  let ym2612Writes = 0;
  let psgWrites = 0;

  while (offset < bytes.length) {
    const commandOffset = offset;
    const command = bytes[offset];
    offset += 1;

    if (command === 0x66) break;
    if (command === 0x50) {
      if (offset >= bytes.length) break;
      events.push({ timeSamples: waitSamples, type: 'psg', value: bytes[offset], offset: commandOffset });
      offset += 1;
      psgWrites += 1;
      continue;
    }
    if (command === 0x52 || command === 0x53) {
      if (offset + 1 >= bytes.length) break;
      events.push({
        timeSamples: waitSamples,
        type: 'ym2612',
        port: command === 0x52 ? 0 : 1,
        address: bytes[offset],
        value: bytes[offset + 1],
        offset: commandOffset,
      });
      offset += 2;
      ym2612Writes += 1;
      continue;
    }
    if (command === 0x61) {
      waitSamples += u16(bytes, offset);
      offset += 2;
      continue;
    }
    if (command === 0x62) {
      waitSamples += 735;
      continue;
    }
    if (command === 0x63) {
      waitSamples += 882;
      continue;
    }
    if (command >= 0x70 && command <= 0x7f) {
      waitSamples += (command & 0x0f) + 1;
      continue;
    }
    if (command === 0x67) {
      offset = skipDataBlock(bytes, offset, warnings);
      continue;
    }

    warnings.push(`Unsupported VGM command 0x${command.toString(16).padStart(2, '0')} at 0x${commandOffset.toString(16)}.`);
    break;
  }

  return {
    ok: true,
    version,
    ym2612Clock,
    sn76489Clock,
    events,
    warnings,
    meta: {
      format: 'VGM',
      version,
      fileSizeBytes: bytes.length,
      dataOffset,
      ym2612Clock,
      sn76489Clock,
      durationSec: waitSamples / VGM_SAMPLE_RATE,
      ym2612Writes,
      psgWrites,
      waitSamples,
      warnings,
    },
  };
}

function xgmCommandSize(command) {
  const count = (command & 0x0f) + 1;
  switch (command & 0xf0) {
    case 0x10:
    case 0x40:
      return 1 + count;
    case 0x20:
    case 0x30:
      return 1 + (count * 2);
    case 0x50:
      return 2;
    case 0x70:
      return command === 0x7e ? 4 : 1;
    default:
      return 1;
  }
}

export function parseXgmBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const warnings = [];
  if (bytes.length < 0x108 || readAscii(bytes, 0, 4) !== 'XGM ') {
    return { ok: false, error: 'XGM header が見つかりません。' };
  }

  const sampleBlockSize = (u16(bytes, 0x100) << 8) >>> 0;
  const version = bytes[0x102] || 0;
  const flags = bytes[0x103] || 0;
  const pal = !!(flags & 0x01);
  const hasGd3 = !!(flags & 0x02);
  const multiTrack = !!(flags & 0x04);
  let sampleCount = 0;
  for (let index = 1; index < 0x40; index += 1) {
    const sampleOffset = u16(bytes, index * 4);
    const sampleLength = u16(bytes, (index * 4) + 2);
    if (sampleOffset !== 0xffff && sampleLength !== 0x0100) sampleCount += 1;
  }

  const musicSizeOffset = 0x104 + sampleBlockSize;
  if (musicSizeOffset + 4 > bytes.length) {
    return { ok: false, error: 'XGM music data offset がファイルサイズを超えています。' };
  }
  const musicDataSize = u32(bytes, musicSizeOffset) >>> 0;
  const musicDataOffset = musicSizeOffset + 4;
  const musicEnd = Math.min(bytes.length, musicDataOffset + musicDataSize);
  let offset = musicDataOffset;
  let frames = 0;
  let ym2612Writes = 0;
  let psgWrites = 0;
  let pcmCommands = 0;
  let loopOffset = null;
  let ended = false;

  while (offset < musicEnd) {
    const commandOffset = offset;
    const command = bytes[offset];
    const size = xgmCommandSize(command);
    if (offset + size > musicEnd) {
      warnings.push(`XGM command at 0x${commandOffset.toString(16)} exceeds music data size.`);
      break;
    }

    if (command === 0x00) frames += 1;
    else if (command === 0x7f) {
      ended = true;
      offset += size;
      break;
    } else if (command === 0x7e) {
      loopOffset = (bytes[offset + 1] || 0) | ((bytes[offset + 2] || 0) << 8) | ((bytes[offset + 3] || 0) << 16);
    } else if ((command & 0xf0) === 0x10) {
      psgWrites += (command & 0x0f) + 1;
    } else if ((command & 0xf0) === 0x20 || (command & 0xf0) === 0x30 || (command & 0xf0) === 0x40) {
      ym2612Writes += (command & 0x0f) + 1;
    } else if ((command & 0xf0) === 0x50) {
      pcmCommands += 1;
    }
    offset += size;
  }

  if (!ended) warnings.push('XGM end command が見つからないため、music data size の末尾まで解析しました。');
  const frameRate = pal ? 50 : 60;
  return {
    ok: true,
    warnings,
    meta: {
      format: 'XGM',
      version,
      flags,
      timing: pal ? 'PAL' : 'NTSC',
      frameRate,
      hasGd3,
      multiTrack,
      fileSizeBytes: bytes.length,
      sampleBlockSize,
      sampleCount,
      musicDataOffset,
      musicDataSize,
      durationFrames: frames,
      durationSec: frames / frameRate,
      ym2612Writes,
      psgWrites,
      pcmCommands,
      loopOffset,
      headerHex: hexBytes(bytes, 0, Math.min(32, bytes.length)),
      warnings,
    },
  };
}

function fmFrequency(channel) {
  const fnum = ((channel.fnumMsb || 0) << 8) | (channel.fnumLsb || 0);
  const block = channel.block || 4;
  if (!fnum) return 0;
  return Math.max(20, Math.min(12000, (fnum / 144) * (2 ** (block - 4)) * 440));
}

function fmGain(channel) {
  const tl = Math.min(127, Math.max(0, channel.totalLevel ?? 36));
  return Math.max(0.015, (127 - tl) / 127) * 0.14;
}

function scheduleOscillator(ctx, destination, start, stop, frequency, type, gainValue) {
  if (!frequency || stop <= start || start < ctx.currentTime - 0.05) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), start + 0.01);
  gain.gain.setValueAtTime(Math.max(0.0001, gainValue), Math.max(start + 0.011, stop - 0.03));
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(stop + 0.02);
}

function makeNoiseBuffer(ctx, durationSec) {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2) - 1;
  return buffer;
}

function scheduleNoise(ctx, destination, start, stop, gainValue) {
  if (stop <= start) return;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = makeNoiseBuffer(ctx, stop - start);
  gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);
  source.connect(gain).connect(destination);
  source.start(start);
  source.stop(stop + 0.02);
}

function audioBufferFromRendered(ctx, rendered) {
  if (rendered?.audioBuffer?.numberOfChannels && rendered.audioBuffer?.sampleRate) return rendered.audioBuffer;
  const pcm = rendered?.pcm || rendered?.samples;
  if (!pcm) return null;
  const channels = Math.max(1, Math.min(2, Number(rendered.channels || (Array.isArray(pcm) ? pcm.length : 1)) || 1));
  const sampleRate = Math.max(8000, Number(rendered.sampleRate || ctx.sampleRate) || ctx.sampleRate);
  const channelData = Array.isArray(pcm) ? pcm : [pcm];
  const length = Math.max(1, channelData.reduce((max, data) => Math.max(max, data?.length || 0), 0));
  const buffer = ctx.createBuffer(channels, length, sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const source = channelData[channel] || channelData[0];
    const target = buffer.getChannelData(channel);
    for (let i = 0; i < target.length; i += 1) {
      const sample = source?.[i] ?? 0;
      target[i] = source instanceof Int16Array ? Math.max(-1, Math.min(1, sample / 32768)) : Math.max(-1, Math.min(1, sample));
    }
  }
  return buffer;
}

async function createNukedOpn2Engine(moduleFactory, wasmDataUrl, metadata = {}) {
  const module = await moduleFactory({
    locateFile: (file) => (String(file).endsWith('.wasm') ? wasmDataUrl : file),
  });
  if (module?.renderVgmEvents) return module;
  if (!module?.cwrap || !module?._malloc || !module?._free || !module?.HEAP16) {
    throw new Error('Nuked-OPN2 WASM module does not expose the expected runtime API.');
  }
  const nukeInit = module.cwrap('nuke_init', null, ['number', 'number']);
  const nukeReset = module.cwrap('nuke_reset', null, []);
  const nukeWrite = module.cwrap('nuke_write', null, ['number', 'number', 'number']);
  const nukeRender = module.cwrap('nuke_render', null, ['number', 'number']);

  function createPsgState() {
    return {
      latched: { type: 'tone', channel: 0 },
      channels: Array.from({ length: 4 }, () => ({ tone: 0, volume: 15, phase: 0, noise: false, lfsr: 0x4000 })),
    };
  }

  function handlePsgWrite(state, value) {
    if (value & 0x80) {
      const channel = (value >> 5) & 0x03;
      const isVolume = !!(value & 0x10);
      state.latched = { type: isVolume ? 'volume' : 'tone', channel };
      if (isVolume) {
        state.channels[channel].volume = value & 0x0f;
      } else {
        state.channels[channel].tone = (state.channels[channel].tone & 0x3f0) | (value & 0x0f);
        state.channels[channel].noise = channel === 3;
      }
      return;
    }
    const channel = state.latched.channel;
    if (state.latched.type === 'tone') {
      state.channels[channel].tone = (state.channels[channel].tone & 0x0f) | ((value & 0x3f) << 4);
    }
  }

  function renderPsgSample(state, sampleRate) {
    let mixed = 0;
    for (let index = 0; index < state.channels.length; index += 1) {
      const channel = state.channels[index];
      if (channel.volume >= 15) continue;
      const gain = ((15 - channel.volume) / 15) * 0.08;
      if (index === 3 || channel.noise) {
        channel.lfsr ^= channel.lfsr << 7;
        channel.lfsr ^= channel.lfsr >> 9;
        mixed += (channel.lfsr & 1 ? 1 : -1) * gain;
        continue;
      }
      const period = Math.max(1, channel.tone || 1);
      const freq = Math.max(20, Math.min(12000, 3579545 / (32 * period)));
      channel.phase = (channel.phase + (freq / sampleRate)) % 1;
      mixed += (channel.phase < 0.5 ? 1 : -1) * gain;
    }
    return mixed;
  }

  return {
    metadata,
    async renderVgmEvents({ events, meta, sampleRate = 44100 }) {
      const durationSamples = Math.max(1, Math.ceil((meta?.durationSec || 0.1) * sampleRate) + 1);
      const left = new Float32Array(durationSamples);
      const right = new Float32Array(durationSamples);
      const chunkSamples = 1024;
      const ptr = module._malloc(chunkSamples * 2 * 2);
      const psg = createPsgState();
      let cursor = 0;

      function renderUntil(targetSample) {
        const clampedTarget = Math.max(cursor, Math.min(durationSamples, targetSample));
        while (cursor < clampedTarget) {
          const count = Math.min(chunkSamples, clampedTarget - cursor);
          nukeRender(count, ptr);
          const base = ptr >> 1;
          for (let i = 0; i < count; i += 1) {
            const psgSample = renderPsgSample(psg, sampleRate);
            left[cursor + i] = Math.max(-1, Math.min(1, (module.HEAP16[base + i * 2] / 32768) + psgSample));
            right[cursor + i] = Math.max(-1, Math.min(1, (module.HEAP16[base + i * 2 + 1] / 32768) + psgSample));
          }
          cursor += count;
        }
      }

      try {
        nukeInit(sampleRate, 1);
        nukeReset();
        for (const event of events || []) {
          const targetSample = Math.round((event.timeSamples || 0) * sampleRate / VGM_SAMPLE_RATE);
          renderUntil(targetSample);
          if (event.type === 'ym2612') {
            nukeWrite(event.port || 0, event.address & 0xff, event.value & 0xff);
          } else if (event.type === 'psg') {
            handlePsgWrite(psg, event.value & 0xff);
          }
        }
        renderUntil(durationSamples);
      } finally {
        module._free(ptr);
      }
      return { ok: true, pcm: [left, right], channels: 2, sampleRate, warnings: [] };
    },
  };
}

export function createVgmPreviewPlayer() {
  let parsed = null;
  let audioContext = null;
  let stopTimer = 0;
  let timeTimer = 0;
  let startedAt = 0;
  let playing = false;
  let highAccuracyEngine = null;
  let highAccuracyWarning = '高精度WASMプレビューエンジンが読み込まれていないため、簡易プレビューへフォールバックします。';
  let engineStatus = {
    id: 'web-audio-approx',
    label: '簡易 Web Audio',
    state: 'fallback',
    highAccuracyAvailable: false,
    message: highAccuracyWarning,
    buildInfo: null,
  };

  function setEngineStatus(patch = {}) {
    engineStatus = {
      ...engineStatus,
      ...patch,
      buildInfo: patch.buildInfo === undefined ? engineStatus.buildInfo : patch.buildInfo,
    };
    return getEngineStatus();
  }

  function getEngineStatus() {
    return {
      ...engineStatus,
      buildInfo: engineStatus.buildInfo && typeof engineStatus.buildInfo === 'object'
        ? { ...engineStatus.buildInfo }
        : engineStatus.buildInfo,
    };
  }

  async function loadHighAccuracyEngine() {
    if (highAccuracyEngine) return { ok: true, engine: highAccuracyEngine, status: getEngineStatus() };
    setEngineStatus({
      id: 'nuked-opn2',
      label: 'Nuked-OPN2 WASM',
      state: 'loading',
      highAccuracyAvailable: false,
      message: 'Nuked-OPN2 WASM を読み込み中...',
    });
    const candidate = globalThis.__MD_NUKED_OPN2_PREVIEW__;
    if (candidate?.renderVgmEvents) {
      highAccuracyEngine = candidate;
      highAccuracyWarning = '';
      const status = setEngineStatus({
        id: 'nuked-opn2',
        label: 'Nuked-OPN2 WASM',
        state: 'ready',
        highAccuracyAvailable: true,
        message: '高精度 YM2612 プレビューが有効です。',
        buildInfo: candidate.metadata || null,
      });
      return { ok: true, engine: highAccuracyEngine, status };
    }
    const loader = globalThis.electronAPI?.loadOptionalAudioEngine;
    if (loader) {
      try {
        const result = await loader('nuked-opn2');
        if (result?.ok && result.jsDataUrl && result.wasmDataUrl) {
          const imported = await import(result.jsDataUrl);
          const factory = imported.default || imported.createNukedOpn2Module;
          if (typeof factory !== 'function') throw new Error('Nuked-OPN2 JS module does not export a module factory.');
          highAccuracyEngine = await createNukedOpn2Engine(factory, result.wasmDataUrl, result.buildInfo || {});
          highAccuracyWarning = '';
          const status = setEngineStatus({
            id: 'nuked-opn2',
            label: 'Nuked-OPN2 WASM',
            state: 'ready',
            highAccuracyAvailable: true,
            message: '高精度 YM2612 プレビューが有効です。',
            buildInfo: result.buildInfo || null,
            source: result.source || result.buildInfo?.source || '',
            license: result.license || result.buildInfo?.license || '',
          });
          return { ok: true, engine: highAccuracyEngine, status };
        }
        if (result?.error) highAccuracyWarning = `高精度WASMプレビュー不可: ${result.error}`;
      } catch (error) {
        highAccuracyWarning = `高精度WASMプレビュー不可: ${error?.message || error}`;
      }
    }
    const status = setEngineStatus({
      id: 'web-audio-approx',
      label: '簡易 Web Audio',
      state: 'fallback',
      highAccuracyAvailable: false,
      message: highAccuracyWarning,
      buildInfo: null,
    });
    return { ok: false, warning: highAccuracyWarning, status };
  }

  function stop() {
    if (stopTimer) clearTimeout(stopTimer);
    if (timeTimer) clearInterval(timeTimer);
    stopTimer = 0;
    timeTimer = 0;
    playing = false;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
  }

  function load({ dataUrl } = {}) {
    stop();
    const result = parseVgmBytes(dataUrlToBytes(dataUrl));
    if (!result.ok) {
      parsed = null;
      return result;
    }
    parsed = result;
    return {
      ok: true,
      meta: { ...result.meta, previewEngine: getEngineStatus() },
      warnings: [highAccuracyWarning, ...result.warnings].filter(Boolean),
      previewEngine: getEngineStatus(),
    };
  }

  function parseVgm({ dataUrl } = {}) {
    return parseVgmBytes(dataUrlToBytes(dataUrl));
  }

  function parseXgm({ dataUrl } = {}) {
    return parseXgmBytes(dataUrlToBytes(dataUrl));
  }

  async function play({ onTime, onEnded, onError } = {}) {
    if (!parsed?.ok) return { ok: false, error: 'VGM が読み込まれていません。' };
    stop();
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return { ok: false, error: 'Web Audio が利用できません。' };

    try {
      const highAccuracy = await loadHighAccuracyEngine();
      audioContext = new Ctor();
      const master = audioContext.createGain();
      master.gain.value = 0.55;
      master.connect(audioContext.destination);
      const startAt = audioContext.currentTime + 0.08;
      if (highAccuracy.ok) {
        const rendered = await highAccuracy.engine.renderVgmEvents({
          events: parsed.events,
          meta: parsed.meta,
          sampleRate: audioContext.sampleRate,
          audioContext,
        });
        const renderedBuffer = rendered?.ok === false ? null : audioBufferFromRendered(audioContext, rendered);
        if (renderedBuffer) {
          const source = audioContext.createBufferSource();
          source.buffer = renderedBuffer;
          source.connect(master);
          source.start(startAt);
          const duration = renderedBuffer.duration;
          startedAt = startAt;
          playing = true;
          if (audioContext.state === 'suspended') await audioContext.resume();
          timeTimer = setInterval(() => {
            if (!playing) return;
            onTime?.(Math.min(duration, Math.max(0, audioContext.currentTime - startedAt)));
          }, 100);
          stopTimer = setTimeout(() => {
            stop();
            onTime?.(0);
            onEnded?.();
          }, Math.ceil((duration + 0.15) * 1000));
          return {
            ok: true,
            durationSec: duration,
            warnings: [...(rendered?.warnings || []), ...parsed.warnings].filter(Boolean),
            previewEngine: getEngineStatus(),
          };
        }
        highAccuracyWarning = rendered?.warning || rendered?.error || '高精度WASMプレビューに失敗したため、簡易プレビューへフォールバックします。';
        setEngineStatus({
          id: 'web-audio-approx',
          label: '簡易 Web Audio',
          state: 'fallback',
          highAccuracyAvailable: false,
          message: highAccuracyWarning,
          buildInfo: null,
        });
      }
      const fm = Array.from({ length: YM2612_CHANNELS }, () => ({
        fnumLsb: 0,
        fnumMsb: 0,
        block: 4,
        totalLevel: 36,
        keyStart: null,
      }));
      const psg = Array.from({ length: 4 }, () => ({
        tone: 0,
        volume: 15,
        start: null,
        noise: false,
      }));
      let psgLatched = { type: 'tone', channel: 0 };

      function closeFm(index, time) {
        const channel = fm[index];
        if (channel.keyStart == null) return;
        scheduleOscillator(audioContext, master, startAt + channel.keyStart, startAt + time, fmFrequency(channel), 'sine', fmGain(channel));
        channel.keyStart = null;
      }

      function closePsg(index, time) {
        const channel = psg[index];
        if (channel.start == null) return;
        const gain = Math.max(0, (15 - channel.volume) / 15) * 0.10;
        if (index === 3 || channel.noise) {
          scheduleNoise(audioContext, master, startAt + channel.start, startAt + time, gain);
        } else {
          const freq = Math.max(40, Math.min(8000, 3579545 / (32 * Math.max(1, channel.tone || 1))));
          scheduleOscillator(audioContext, master, startAt + channel.start, startAt + time, freq, 'square', gain);
        }
        channel.start = null;
      }

      function handlePsg(value, time) {
        if (value & 0x80) {
          const channel = (value >> 5) & 0x03;
          const isVolume = !!(value & 0x10);
          psgLatched = { type: isVolume ? 'volume' : 'tone', channel };
          if (isVolume) {
            closePsg(channel, time);
            psg[channel].volume = value & 0x0f;
            if (psg[channel].volume < 15) psg[channel].start = time;
            return;
          }
          closePsg(channel, time);
          psg[channel].tone = (psg[channel].tone & 0x3f0) | (value & 0x0f);
          psg[channel].noise = channel === 3;
          if (psg[channel].volume < 15) psg[channel].start = time;
          return;
        }
        const channel = psgLatched.channel;
        if (psgLatched.type === 'tone') {
          closePsg(channel, time);
          psg[channel].tone = (psg[channel].tone & 0x0f) | ((value & 0x3f) << 4);
          if (psg[channel].volume < 15) psg[channel].start = time;
        }
      }

      parsed.events.forEach((event) => {
        const time = event.timeSamples / VGM_SAMPLE_RATE;
        if (event.type === 'psg') {
          handlePsg(event.value, time);
          return;
        }
        const channelIndex = event.port * 3 + (event.address & 0x03);
        if (channelIndex < 0 || channelIndex >= YM2612_CHANNELS) return;
        const channel = fm[channelIndex];
        if (event.address >= 0x40 && event.address <= 0x4e) {
          const opChannel = event.address & 0x03;
          if (opChannel < 3) fm[event.port * 3 + opChannel].totalLevel = event.value & 0x7f;
        } else if (event.address >= 0xa0 && event.address <= 0xa2) {
          closeFm(channelIndex, time);
          channel.fnumLsb = event.value;
          if (channel.keyStart != null) channel.keyStart = time;
        } else if (event.address >= 0xa4 && event.address <= 0xa6) {
          closeFm(channelIndex, time);
          channel.fnumMsb = event.value & 0x07;
          channel.block = (event.value >> 3) & 0x07;
          if (channel.keyStart != null) channel.keyStart = time;
        } else if (event.address === 0x28) {
          const keyChannel = (event.value & 0x03) + ((event.value & 0x04) ? 3 : 0);
          if (keyChannel >= 0 && keyChannel < YM2612_CHANNELS) {
            if (event.value & 0xf0) {
              if (fm[keyChannel].keyStart == null) fm[keyChannel].keyStart = time;
            } else {
              closeFm(keyChannel, time);
            }
          }
        }
      });

      const duration = Math.max(0.1, parsed.meta.durationSec);
      for (let i = 0; i < fm.length; i += 1) closeFm(i, duration);
      for (let i = 0; i < psg.length; i += 1) closePsg(i, duration);

      startedAt = startAt;
      playing = true;
      if (audioContext.state === 'suspended') await audioContext.resume();
      timeTimer = setInterval(() => {
        if (!playing) return;
        onTime?.(Math.min(duration, Math.max(0, audioContext.currentTime - startedAt)));
      }, 100);
      stopTimer = setTimeout(() => {
        stop();
        onTime?.(0);
        onEnded?.();
      }, Math.ceil((duration + 0.15) * 1000));
      return {
        ok: true,
        durationSec: duration,
        warnings: [highAccuracyWarning, ...parsed.warnings].filter(Boolean),
        previewEngine: getEngineStatus(),
      };
    } catch (error) {
      stop();
      onError?.(error);
      return { ok: false, error: String(error?.message || error) };
    }
  }

  return {
    canPreview: canPreviewVgmEntry,
    load,
    parseVgm,
    parseXgm,
    loadHighAccuracyEngine,
    getEngineStatus,
    play,
    stop,
    isPlaying: () => playing,
  };
}
