'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { encodeIndexedPng } = require('../plugins/md-novel-editor/novel-image');

const BUTTON_B = 1 << 4;
const BUTTON_C = 1 << 5;
const BUTTON_A = 1 << 6;
const BUTTON_START = 1 << 7;
const AUDIO_PULL_FRAMES = 800;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadSymbols(symbolPath) {
  const wanted = new Set(['currentScene', 'currentPc', 'runtimeMode', 'inputWatcherCount', 'pressedJoy', 'previousJoy']);
  const result = {};
  for (const line of fs.readFileSync(symbolPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{8})\s+\S\s+(\S+)$/);
    if (!match || !wanted.has(match[2])) continue;
    result[match[2]] = Number.parseInt(match[1], 16) & 0xffffff;
  }
  for (const name of wanted) {
    if (!Number.isInteger(result[name])) throw new Error(`Missing runtime symbol: ${name}`);
  }
  return result;
}

function framebufferBuffer(framebuffer) {
  return Buffer.from(framebuffer.buffer, framebuffer.byteOffset, framebuffer.byteLength);
}

function writeFramebufferPng(filePath, framebuffer) {
  const colors = [];
  const colorIndices = new Map();
  const indices = new Uint8Array(framebuffer.length);
  for (let pixel = 0; pixel < framebuffer.length; pixel += 1) {
    const argb = framebuffer[pixel] >>> 0;
    let index = colorIndices.get(argb);
    if (index === undefined) {
      index = colors.length;
      if (index >= 256) throw new Error('Framebuffer contains more than 256 colors');
      colorIndices.set(argb, index);
      colors.push([(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff, (argb >>> 24) & 0xff]);
    }
    indices[pixel] = index;
  }
  fs.writeFileSync(filePath, encodeIndexedPng(320, 224, indices, colors));
  return colors.length;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const options = parseArguments(process.argv.slice(2));
  const projectDir = path.resolve(root, options.project || 'projects/ishi_no_ura_01_md');
  const templateRomPath = options['template-rom'] ? path.resolve(root, options['template-rom']) : null;
  const outputDir = path.resolve(root, options.output || 'artifacts/md-novel');
  const romPath = path.join(projectDir, 'out', 'rom.bin');
  const symbolPath = path.join(projectDir, 'out', 'symbol.txt');
  const wasmJsPath = path.join(root, 'plugins', 'standard-emulator', 'pkg', 'md_wasm.js');
  const wasmBinaryPath = path.join(root, 'plugins', 'standard-emulator', 'pkg', 'md_wasm_bg.wasm');
  const emulatorMetaPath = path.join(root, 'plugins', 'standard-emulator', 'emulator-build.json');
  fs.mkdirSync(outputDir, { recursive: true });

  const wasmPackage = await import(pathToFileURL(wasmJsPath).href);
  wasmPackage.initSync({ module: fs.readFileSync(wasmBinaryPath) });
  const emulator = new wasmPackage.EmulatorHandle();
  const symbols = loadSymbols(symbolPath);
  const rom = fs.readFileSync(romPath);
  const emulatorMeta = JSON.parse(fs.readFileSync(emulatorMetaPath, 'utf8'));
  let frame = 0;
  let audioNonzero = 0;
  let audioPeak = 0;
  let audioSamples = 0;
  const screenshots = [];

  function readU8(name) {
    return emulator.get_memory(symbols[name], 1)[0];
  }

  function readU16(name) {
    const data = emulator.get_memory(symbols[name], 2);
    return (data[0] << 8) | data[1];
  }

  function readS16(name) {
    const value = readU16(name);
    return value & 0x8000 ? value - 0x10000 : value;
  }

  function readU32(name) {
    const data = emulator.get_memory(symbols[name], 4);
    return ((data[0] * 0x1000000) + (data[1] << 16) + (data[2] << 8) + data[3]) >>> 0;
  }

  function runtimeState() {
    return {
      scene: readS16('currentScene'),
      commandPc: readU16('currentPc'),
      mode: readU32('runtimeMode'),
      inputWatchers: readU8('inputWatcherCount'),
      pressedJoy: readU16('pressedJoy'),
      previousJoy: readU16('previousJoy'),
    };
  }

  function tick(buttons = 0) {
    emulator.set_controller_state(1, buttons);
    emulator.run_frame();
    frame += 1;
    const samples = emulator.take_audio_samples(AUDIO_PULL_FRAMES);
    audioSamples += samples.length;
    for (const sample of samples) {
      const absolute = Math.abs(sample);
      if (absolute > 1e-7) audioNonzero += 1;
      if (absolute > audioPeak) audioPeak = absolute;
    }
  }

  function runFrames(count, buttons = 0) {
    for (let index = 0; index < count; index += 1) tick(buttons);
  }

  function runUntil(predicate, maximumFrames, description) {
    for (let index = 0; index < maximumFrames; index += 1) {
      if (predicate(runtimeState())) return;
      tick(0);
    }
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(runtimeState())}`);
  }

  function hold(buttons, heldFrames = 1, releaseFrames = 30) {
    runFrames(heldFrames, buttons);
    runFrames(releaseFrames, 0);
  }

  function snapshot(label, fileName) {
    const framebuffer = emulator.get_framebuffer_argb();
    const filePath = path.join(outputDir, fileName);
    const uniqueColors = writeFramebufferPng(filePath, framebuffer);
    const cpu = emulator.get_cpu_state();
    const result = {
      label,
      frame,
      file: path.relative(root, filePath).replace(/\\/g, '/'),
      framebufferSha256: sha256(framebufferBuffer(framebuffer)),
      uniqueColors,
      runtime: runtimeState(),
      cpuPc: cpu.m68k.pc,
      z80Pc: cpu.z80_pc,
      audio: { samples: audioSamples, nonzero: audioNonzero, peak: audioPeak },
    };
    screenshots.push(result);
    return result;
  }

  function loadRom(bytes) {
    emulator.load_rom(new Uint8Array(bytes));
    emulator.reset();
    frame = 0;
    audioNonzero = 0;
    audioPeak = 0;
    audioSamples = 0;
  }

  try {
    loadRom(rom);
    runUntil((state) => state.scene === 0 && state.commandPc >= 4, 360, 'logo wait');
    const logo = snapshot('target-logo-ready', 'ishi-no-ura-logo.png');

    hold(BUTTON_START);
    runUntil((state) => state.scene === 1 && state.commandPc >= 6 && state.inputWatchers === 1, 480, 'title input');
    const title = snapshot('target-title-ready', 'ishi-no-ura-title.png');

    hold(BUTTON_START);
    runUntil((state) => state.scene === 2 && state.commandPc >= 3, 720, 'opening message');
    runFrames(50);
    const opening = snapshot('target-opening-message', 'ishi-no-ura-opening-message.png');
    if (opening.audio.nonzero <= title.audio.nonzero) throw new Error('Opening PSG BGM produced no PCM samples');

    hold(BUTTON_B);
    const messageComplete = snapshot('target-message-completed', 'ishi-no-ura-message-complete.png');
    hold(BUTTON_B);
    runUntil((state) => state.scene === 2 && state.commandPc >= 5, 360, 'second opening message');
    runFrames(40);
    const secondMessage = snapshot('target-second-message', 'ishi-no-ura-second-message.png');

    const savedState = emulator.save_state();
    const beforeState = snapshot('target-before-state-run', 'ishi-no-ura-state-before.png');
    runFrames(40);
    const afterState = snapshot('target-after-state-run', 'ishi-no-ura-state-after.png');
    emulator.load_state(savedState);
    const restoredState = snapshot('target-state-restored', 'ishi-no-ura-state-restored.png');
    if (restoredState.framebufferSha256 !== beforeState.framebufferSha256) throw new Error('WASM save-state framebuffer did not restore exactly');

    let template = null;
    if (templateRomPath) {
      const templateRom = fs.readFileSync(templateRomPath);
      loadRom(templateRom);
      runFrames(180);
      template = snapshot('template-loaded', 'md-novel-template.png');
      if (template.audio.nonzero === 0) throw new Error('Template XGM2 output is silent');
      template.rom = { path: path.relative(root, templateRomPath).replace(/\\/g, '/'), bytes: templateRom.length, sha256: sha256(templateRom) };
    }

    loadRom(rom);
    runUntil((state) => state.scene === 0 && state.commandPc >= 4, 360, 'reloaded logo wait');
    const reloaded = snapshot('target-reloaded-logo', 'ishi-no-ura-reloaded-logo.png');
    if (reloaded.framebufferSha256 !== logo.framebufferSha256) throw new Error('Reloaded ROM did not reproduce the initial logo framebuffer');

    const proof = {
      schemaVersion: 1,
      verifiedAt: new Date().toISOString(),
      emulator: {
        version: wasmPackage.EmulatorHandle.build_version(),
        source: emulatorMeta.source,
        wasmSha256: sha256(fs.readFileSync(wasmBinaryPath)),
      },
      targetRom: { path: path.relative(root, romPath).replace(/\\/g, '/'), bytes: rom.length, sha256: sha256(rom) },
      inputMapping: { pceI: 'MD B', pceII: 'MD C', pceRun: 'MD START', pceSelect: 'MD A', masks: { B: BUTTON_B, C: BUTTON_C, START: BUTTON_START, A: BUTTON_A } },
      assertions: {
        logoSkipReachedTitle: title.runtime.scene === 1,
        titleStartReachedOpening: opening.runtime.scene === 2,
        psgProducedAudio: opening.audio.nonzero > title.audio.nonzero,
        messageAdvanceReachedNextMessage: secondMessage.runtime.commandPc >= 5,
        saveStateRestoredFramebuffer: restoredState.framebufferSha256 === beforeState.framebufferSha256,
        romReloadReproducedLogo: reloaded.framebufferSha256 === logo.framebufferSha256,
        templateLoadedWithAudio: template ? template.audio.nonzero > 0 : null,
      },
      state: { bytes: savedState.length, before: beforeState.framebufferSha256, after: afterState.framebufferSha256, restored: restoredState.framebufferSha256 },
      template,
      screenshots,
      messageComplete,
    };
    const proofPath = path.join(outputDir, 'ishi_no_ura_01-wasm-proof.json');
    fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ proofPath, assertions: proof.assertions, snapshots: screenshots, emulator: proof.emulator }, null, 2)}\n`);
  } finally {
    emulator.free();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
