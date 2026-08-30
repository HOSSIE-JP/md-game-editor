'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { encodeIndexedPng } = require('../plugins/md-novel-editor/novel-image');

const BUTTON_UP = 1 << 0;
const BUTTON_DOWN = 1 << 1;
const BUTTON_LEFT = 1 << 2;
const BUTTON_RIGHT = 1 << 3;
const BUTTON_B = 1 << 4;
const BUTTON_C = 1 << 5;
const BUTTON_A = 1 << 6;
const BUTTON_START = 1 << 7;
const QA_SYMBOLS = [
  'bmlQaScreen', 'bmlQaSelfTest', 'bmlQaSelfTestCrcHigh', 'bmlQaSelfTestCrcLow', 'bmlQaSelfTestFrame', 'bmlQaOrientation', 'bmlQaDifficulty',
  'bmlQaStageFrame', 'bmlQaCompletedStages', 'bmlQaStageOutcome',
  'bmlQaMaxBullets', 'bmlQaMaxEmitters', 'bmlQaMaxContexts',
  'bmlQaMaxOpcodes', 'bmlQaMaxSpawns', 'bmlQaFireDrops', 'bmlQaPoolDrops', 'bmlQaSpawnDrops', 'bmlQaContextDrops', 'bmlQaOpcodeExhaustions', 'bmlQaDisplayDeletes',
  'bmlQaMaxCpuLoad', 'bmlQaMinFreeRam', 'bmlQaMaxAllocatedRam', 'bmlQaMinFreeSpriteTiles', 'bmlQaLives',
  'bmlQaHits',
  'bmlQaLoadProbe', 'bmlQaLoadFrame',
  'bmlQaLoadMaxBullets', 'bmlQaLoadMaxEmitters', 'bmlQaLoadMaxContexts',
  'bmlQaLoadMaxOpcodes', 'bmlQaLoadMaxSpawns',
  'bmlQaLoadFireDrops', 'bmlQaLoadContextDrops', 'bmlQaLoadOpcodeExhaustions', 'bmlQaLoadDisplayDeletes',
  'bmlQaLoadMaxGlobalSprites', 'bmlQaLoadMaxPieces', 'bmlQaLoadMaxDots', 'bmlQaLoadMaxCpuLoad', 'bmlQaLoadMaxCpuFrame', 'bmlQaLoadVBlankFrames',
  'bmlQaLoadMaxTickSubticks', 'bmlQaLoadMaxBudgetSubticks', 'bmlQaLoadMaxFrameSubticks', 'bmlQaLoadMaxFrameFrame',
  'bmlQaLoadTickSubticks', 'bmlQaLoadBudgetSubticks', 'bmlQaLoadFrameSubticks',
];

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadSymbols(symbolPath) {
  const wanted = new Set(QA_SYMBOLS);
  const symbols = {};
  for (const line of fs.readFileSync(symbolPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{8})\s+\S\s+(\S+)$/);
    if (match && wanted.has(match[2])) symbols[match[2]] = Number.parseInt(match[1], 16) & 0xffffff;
  }
  for (const name of wanted) if (!Number.isInteger(symbols[name])) throw new Error('Missing runtime symbol: ' + name);
  return symbols;
}

function framebufferBytes(framebuffer) {
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
      colors.push([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, (argb >>> 24) & 255]);
    }
    indices[pixel] = index;
  }
  fs.writeFileSync(filePath, encodeIndexedPng(320, 224, indices, colors));
  return colors.length;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const options = parseArguments(process.argv.slice(2));
  const projectDir = path.resolve(repoRoot, options.project || 'artifacts/bulletml-stg-verification');
  const outputDir = path.resolve(repoRoot, options.output || path.join(projectDir, 'wasm-proof'));
  const romPath = path.join(projectDir, 'out', 'rom.bin');
  const symbolPath = path.join(projectDir, 'out', 'symbol.txt');
  const buildProofPath = path.join(projectDir, 'data', 'bulletml', 'proof.json');
  const wasmJsPath = path.join(repoRoot, 'plugins', 'standard-emulator', 'pkg', 'md_wasm.js');
  const wasmPath = path.join(repoRoot, 'plugins', 'standard-emulator', 'pkg', 'md_wasm_bg.wasm');
  const emulatorMetaPath = path.join(repoRoot, 'plugins', 'standard-emulator', 'emulator-build.json');
  for (const required of [romPath, symbolPath, buildProofPath, wasmJsPath, wasmPath, emulatorMetaPath]) if (!fs.existsSync(required)) throw new Error('Missing verification input: ' + required);
  fs.mkdirSync(outputDir, { recursive: true });

  const wasmPackage = await import(pathToFileURL(wasmJsPath).href);
  wasmPackage.initSync({ module: fs.readFileSync(wasmPath) });
  const emulator = new wasmPackage.EmulatorHandle();
  const symbols = loadSymbols(symbolPath);
  const rom = fs.readFileSync(romPath);
  const snapshots = [];
  let hostFrame = 0;
  let audioNonzero = 0;
  let audioPeak = 0;

  function readU16(name) {
    const bytes = emulator.get_memory(symbols[name], 2);
    return (bytes[0] << 8) | bytes[1];
  }

  function qaState() {
    return Object.fromEntries(QA_SYMBOLS.map((name) => [name.replace(/^bmlQa/, '').replace(/^./, (letter) => letter.toLowerCase()), readU16(name)]));
  }

  function tick(buttons = 0) {
    emulator.set_controller_state(1, buttons);
    emulator.run_frame();
    hostFrame += 1;
    const samples = emulator.take_audio_samples(800);
    for (const sample of samples) {
      const absolute = Math.abs(sample);
      if (absolute > 1e-7) audioNonzero += 1;
      if (absolute > audioPeak) audioPeak = absolute;
    }
  }

  function runUntil(predicate, maximumFrames, label) {
    for (let count = 0; count < maximumFrames; count += 1) {
      const state = qaState();
      if (predicate(state)) return state;
      tick(0);
    }
    throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify({ qa: qaState(), cpu: emulator.get_cpu_state() }));
  }

  function press(button, releaseFrames = 2) {
    tick(button);
    for (let count = 0; count < releaseFrames; count += 1) tick(0);
  }

  function snapshot(label) {
    const framebuffer = emulator.get_framebuffer_argb();
    const filePath = path.join(outputDir, label + '.png');
    let nonBlackPixels = 0;
    for (const pixel of framebuffer) if ((pixel & 0x00ffffff) !== 0) nonBlackPixels += 1;
    const entry = {
      label,
      hostFrame,
      file: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
      framebufferSha256: sha256(framebufferBytes(framebuffer)),
      uniqueColors: writeFramebufferPng(filePath, framebuffer),
      nonBlackPixels,
      qa: qaState(),
      audio: { nonzero: audioNonzero, peak: audioPeak },
    };
    snapshots.push(entry);
    return entry;
  }

  function driveStage(orientation) {
    let middle = null;
    const audioStart = audioNonzero;
    const hostStart = hostFrame;
    for (let count = 0; count < 6000; count += 1) {
      const state = qaState();
      if (state.screen === 3) return { end: snapshot(orientation + '-stage-end'), middle, audioDelta: audioNonzero - audioStart, hostFrames: hostFrame - hostStart };
      if (state.screen !== 2) throw new Error(orientation + ' stage left gameplay unexpectedly: ' + JSON.stringify(state));
      if (!middle && state.stageFrame >= 1800) middle = snapshot(orientation + '-stage-middle');
      const sweep = Math.trunc(state.stageFrame / 120) & 1;
      const movement = orientation === 'vertical' ? (sweep ? BUTTON_LEFT : BUTTON_RIGHT) : (sweep ? BUTTON_UP : BUTTON_DOWN);
      tick(BUTTON_A | BUTTON_B | movement);
    }
    throw new Error(orientation + ' stage did not clear or time out: ' + JSON.stringify({ hostFrames: hostFrame - hostStart, qa: qaState() }));
  }

  try {
    emulator.load_rom(new Uint8Array(rom));
    emulator.reset();
    const readyState = runUntil((state) => state.screen === 1, 120, 'immediate BulletML title');
    for (let count = 0; count < 3; count += 1) tick(0);
    const titleReady = snapshot('title-ready');
    if (readyState.selfTest !== 0 || readyState.loadProbe !== 0) throw new Error('Full QA ran before it was requested');

    press(BUTTON_A);
    runUntil((state) => state.screen === 2 && state.selfTest === 0 && state.loadProbe === 0, 120, 'gameplay without full QA');
    for (let count = 0; count < 2; count += 1) tick(0);
    const directGameStart = snapshot('game-start-without-qa');

    emulator.reset();
    runUntil((state) => state.screen === 1 && state.selfTest === 0 && state.loadProbe === 0, 120, 'BulletML title after reset');
    for (let count = 0; count < 3; count += 1) tick(0);
    const diagnosticsAudioStart = audioNonzero;
    tick(BUTTON_C);
    runUntil((state) => state.screen === 4, 120, 'visible full QA screen');
    tick(0);
    if (qaState().screen !== 4) throw new Error('Full QA progress screen did not remain visible');
    const diagnosticsRunning = snapshot('diagnostics-running');
    const titleState = runUntil((state) => state.screen === 1 && state.selfTest !== 0 && state.loadProbe !== 0, 9000, 'requested BulletML self-test/load-probe');
    for (let count = 0; count < 3; count += 1) tick(0);
    const title = snapshot('title');
    const initialBuildProof = JSON.parse(fs.readFileSync(buildProofPath, 'utf8'));
    if (titleState.selfTest !== 1) {
      const actual = ((titleState.selfTestCrcHigh * 0x10000) + titleState.selfTestCrcLow) >>> 0;
      throw new Error('C runtime 10,000-frame CRC self-test failed: actual=' + actual.toString(16).padStart(8, '0') + ' expected=' + initialBuildProof.runtime.selfTestExpectedCrc);
    }
    if (titleState.loadProbe !== 1) {
      throw new Error('C runtime 48/5/16 load probe failed: ' + JSON.stringify({
        frame: titleState.loadFrame,
        bullets: titleState.loadMaxBullets,
        emitters: titleState.loadMaxEmitters,
        contexts: titleState.loadMaxContexts,
        opcodes: titleState.loadMaxOpcodes,
        spawns: titleState.loadMaxSpawns,
        fireDrops: titleState.loadFireDrops,
        contextDrops: titleState.loadContextDrops,
        opcodeExhaustions: titleState.loadOpcodeExhaustions,
        displayDeletes: titleState.loadDisplayDeletes,
        globalSprites: titleState.loadMaxGlobalSprites,
        pieces: titleState.loadMaxPieces,
        dots: titleState.loadMaxDots,
        cpu: titleState.loadMaxCpuLoad,
        cpuFrame: titleState.loadMaxCpuFrame,
        vblankFrames: titleState.loadVBlankFrames,
        tickSubticks: titleState.loadMaxTickSubticks,
        budgetSubticks: titleState.loadMaxBudgetSubticks,
        frameSubticks: titleState.loadMaxFrameSubticks,
        maxFrame: titleState.loadMaxFrameFrame,
        steadyTickSubticks: titleState.loadTickSubticks,
        steadyBudgetSubticks: titleState.loadBudgetSubticks,
        steadyFrameSubticks: titleState.loadFrameSubticks,
      }));
    }

    press(BUTTON_LEFT);
    runUntil((state) => state.screen === 1 && state.difficulty === 0, 120, 'Easy difficulty selection');
    press(BUTTON_A);
    runUntil((state) => state.screen === 2 && state.orientation === 0, 120, 'vertical stage start');
    const vertical = driveStage('vertical');
    if (vertical.end.qa.stageOutcome !== 1 || vertical.end.qa.stageFrame !== 3600) throw new Error('vertical stage did not reach the 3600-frame clear: ' + JSON.stringify({ hostFrames: vertical.hostFrames, qa: vertical.end.qa }));
    if (vertical.end.qa.fireDrops || vertical.end.qa.displayDeletes) throw new Error('vertical stage reported a resource drop');
    if (vertical.audioDelta <= 0) throw new Error('vertical BGM/SFX produced no audio');

    press(BUTTON_START);
    runUntil((state) => state.screen === 1, 120, 'return to title');
    press(BUTTON_DOWN);
    const horizontalTitle = runUntil((state) => state.screen === 1 && state.orientation === 1, 120, 'horizontal selection');
    if (horizontalTitle.difficulty !== 0) throw new Error('difficulty changed while selecting horizontal mode');
    snapshot('title-horizontal');
    press(BUTTON_A);
    runUntil((state) => state.screen === 2 && state.orientation === 1, 120, 'horizontal stage start');
    const horizontal = driveStage('horizontal');
    if (horizontal.end.qa.stageOutcome !== 1 || horizontal.end.qa.stageFrame !== 3600) throw new Error('horizontal stage did not reach the 3600-frame clear: ' + JSON.stringify({ hostFrames: horizontal.hostFrames, qa: horizontal.end.qa }));
    if (horizontal.end.qa.fireDrops || horizontal.end.qa.displayDeletes) throw new Error('horizontal stage reported a resource drop');
    if (horizontal.audioDelta <= 0) throw new Error('horizontal BGM/SFX produced no audio');

    const emulatorMeta = JSON.parse(fs.readFileSync(emulatorMetaPath, 'utf8'));
    const buildProof = JSON.parse(fs.readFileSync(buildProofPath, 'utf8'));
    const proof = {
      schemaVersion: 1,
      verifiedAt: new Date().toISOString(),
      emulator: {
        version: wasmPackage.EmulatorHandle.build_version(),
        source: emulatorMeta.source,
        wasmSha256: sha256(fs.readFileSync(wasmPath)),
      },
      rom: { path: path.relative(repoRoot, romPath).replace(/\\/g, '/'), bytes: rom.length, sha256: sha256(rom) },
      inputMasks: { up: BUTTON_UP, down: BUTTON_DOWN, left: BUTTON_LEFT, right: BUTTON_RIGHT, b: BUTTON_B, c: BUTTON_C, a: BUTTON_A, start: BUTTON_START },
      boot: {
        titleHostFrames: titleReady.hostFrame,
        deferredDiagnostics: titleReady.qa.selfTest === 0 && titleReady.qa.loadProbe === 0,
        startedGameplayWithoutDiagnostics: directGameStart.qa.screen === 2 && directGameStart.qa.selfTest === 0 && directGameStart.qa.loadProbe === 0,
        visibleTitleColors: titleReady.uniqueColors,
        visibleTitlePixels: titleReady.nonBlackPixels,
        visibleGameplayColors: directGameStart.uniqueColors,
        visibleGameplayPixels: directGameStart.nonBlackPixels,
        visibleDiagnosticsColors: diagnosticsRunning.uniqueColors,
        visibleDiagnosticsPixels: diagnosticsRunning.nonBlackPixels,
      },
      selfTest: { frames: buildProof.runtime.selfTestFrames, expectedCrc: buildProof.runtime.selfTestExpectedCrc, passed: title.qa.selfTest === 1 },
      loadProbe: {
        frames: title.qa.loadFrame,
        expected: buildProof.runtime.loadProbe.expected,
        maxima: {
          bullets: title.qa.loadMaxBullets,
          emitters: title.qa.loadMaxEmitters,
          contexts: title.qa.loadMaxContexts,
          opcodes: title.qa.loadMaxOpcodes,
          spawns: title.qa.loadMaxSpawns,
          globalSprites: title.qa.loadMaxGlobalSprites,
          pieces: title.qa.loadMaxPieces,
          dots: title.qa.loadMaxDots,
          cpuLoad: title.qa.loadMaxCpuLoad,
          cpuLoadFrame: title.qa.loadMaxCpuFrame,
          vblankFrames: title.qa.loadVBlankFrames,
          tickSubticks: title.qa.loadMaxTickSubticks,
          budgetSubticks: title.qa.loadMaxBudgetSubticks,
          frameSubticks: title.qa.loadMaxFrameSubticks,
          frame: title.qa.loadMaxFrameFrame,
        },
        steadyAtFrame140: {
          tickSubticks: title.qa.loadTickSubticks,
          budgetSubticks: title.qa.loadBudgetSubticks,
          frameSubticks: title.qa.loadFrameSubticks,
        },
        drops: {
          fire: title.qa.loadFireDrops,
          context: title.qa.loadContextDrops,
          opcodeExhaustions: title.qa.loadOpcodeExhaustions,
          displayDeletes: title.qa.loadDisplayDeletes,
        },
        audio: { nonzero: title.audio.nonzero - diagnosticsAudioStart, peak: title.audio.peak },
        passed: title.qa.loadProbe === 1,
      },
      stages: {
        vertical: { completed: true, hostFrames: vertical.hostFrames, audio: vertical.audioDelta, maxima: vertical.end.qa },
        horizontal: { completed: true, hostFrames: horizontal.hostFrames, audio: horizontal.audioDelta, maxima: horizontal.end.qa },
      },
      resources: {
        ram: {
          linker: buildProof.runtime.ram,
          minimumFreeBytes: Math.min(vertical.end.qa.minFreeRam, horizontal.end.qa.minFreeRam),
          maximumAllocatedBytes: Math.max(vertical.end.qa.maxAllocatedRam, horizontal.end.qa.maxAllocatedRam),
        },
        vram: {
          build: buildProof.runtime.vram,
          minimumFreeSpriteTiles: Math.min(vertical.end.qa.minFreeSpriteTiles, horizontal.end.qa.minFreeSpriteTiles),
        },
      },
      assertions: {
        defaultBootReachedTitleWithinOneSecond: titleReady.hostFrame <= 60 && titleReady.qa.screen === 1,
        defaultBootDeferredDiagnostics: titleReady.qa.selfTest === 0 && titleReady.qa.loadProbe === 0,
        defaultBootRenderedVisibleTitle: titleReady.uniqueColors > 1 && titleReady.nonBlackPixels > 500,
        defaultBootStartedVisibleGameplayWithoutDiagnostics: directGameStart.qa.screen === 2 && directGameStart.qa.selfTest === 0 && directGameStart.qa.loadProbe === 0 && directGameStart.uniqueColors > 1 && directGameStart.nonBlackPixels > 500,
        requestedDiagnosticsRenderedProgress: diagnosticsRunning.qa.screen === 4 && diagnosticsRunning.uniqueColors > 1 && diagnosticsRunning.nonBlackPixels > 500,
        cRuntimeMatchesJsCrc10000: title.qa.selfTest === 1,
        loadProbePassed: title.qa.loadProbe === 1,
        loadProbeReached48Bullets5Emitters16Spawns: title.qa.loadMaxBullets === 48 && title.qa.loadMaxEmitters === 5 && title.qa.loadMaxSpawns === 16,
        loadProbeStayedWithinH40: title.qa.loadMaxGlobalSprites <= 80 && title.qa.loadMaxPieces <= 20 && title.qa.loadMaxDots <= 320,
        loadProbeNoDrops: !title.qa.loadFireDrops && !title.qa.loadContextDrops && !title.qa.loadOpcodeExhaustions && !title.qa.loadDisplayDeletes,
        loadProbeMaintained60Hz: title.qa.loadVBlankFrames === buildProof.runtime.loadProbe.frames && title.qa.loadMaxFrameSubticks <= buildProof.runtime.loadProbe.expected.subticksPerFrame && title.qa.loadMaxCpuLoad < 100,
        loadProbeAudioNonzero: title.audio.nonzero - diagnosticsAudioStart > 0,
        verticalStageReached3600: vertical.end.qa.stageFrame === 3600 && vertical.end.qa.stageOutcome === 1,
        horizontalStageReached3600: horizontal.end.qa.stageFrame === 3600 && horizontal.end.qa.stageOutcome === 1,
        stagesMaintained60Hz: vertical.end.qa.maxCpuLoad < 100 && horizontal.end.qa.maxCpuLoad < 100,
        verticalAudioNonzero: vertical.audioDelta > 0,
        horizontalAudioNonzero: horizontal.audioDelta > 0,
        noRuntimeDrops: !title.qa.loadFireDrops && !title.qa.loadContextDrops && !title.qa.loadOpcodeExhaustions && !title.qa.loadDisplayDeletes && !vertical.end.qa.fireDrops && !vertical.end.qa.poolDrops && !vertical.end.qa.spawnDrops && !vertical.end.qa.contextDrops && !vertical.end.qa.opcodeExhaustions && !vertical.end.qa.displayDeletes && !horizontal.end.qa.fireDrops && !horizontal.end.qa.poolDrops && !horizontal.end.qa.spawnDrops && !horizontal.end.qa.contextDrops && !horizontal.end.qa.opcodeExhaustions && !horizontal.end.qa.displayDeletes,
        runtimeRamVramWithinBudget: buildProof.runtime.ram?.withinBudget === true && buildProof.runtime.vram?.withinBudget === true && vertical.end.qa.minFreeRam >= 4096 && horizontal.end.qa.minFreeRam >= 4096 && vertical.end.qa.minFreeSpriteTiles > 0 && horizontal.end.qa.minFreeSpriteTiles > 0,
      },
      snapshots,
    };
    const proofPath = path.join(outputDir, 'bulletml-stg-wasm-proof.json');
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
    buildProof.wasm = proof;
    fs.writeFileSync(buildProofPath, JSON.stringify(buildProof, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ proofPath, assertions: proof.assertions, emulator: proof.emulator, loadProbe: proof.loadProbe, stages: proof.stages }, null, 2) + '\n');
    const failures = Object.entries(proof.assertions).filter(([, passed]) => !passed).map(([name]) => name);
    if (failures.length) throw new Error('BulletML WASM proof failed: ' + failures.join(', '));
  } finally {
    emulator.free();
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
