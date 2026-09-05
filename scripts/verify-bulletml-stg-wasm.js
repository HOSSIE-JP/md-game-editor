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
  'bmlQaShotButton', 'bmlQaBombButton', 'bmlQaSpeedButton', 'bmlQaSramLoaded', 'bmlQaCheckpointValid',
  'bmlQaGameplayBgmStarted', 'bmlQaPcmWhileBgm',
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
  const projectDir = path.resolve(repoRoot, options.project || 'template/template_bulletml_stg');
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
    const cpu = emulator.get_cpu_state();
    if (cpu?.m68k?.last_exception?.IllegalInstruction) {
      const trace = emulator.trace_execution();
      throw new Error('68000 illegal instruction during WASM proof: ' + JSON.stringify({ hostFrame, cpu, trace: Array.isArray(trace) ? trace.slice(-64) : trace }));
    }
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

  function runUntilAdvancing(predicate, maximumFrames, label) {
    for (let count = 0; count < maximumFrames; count += 1) {
      const state = qaState();
      if (predicate(state)) return state;
      tick(count % 6 === 0 ? BUTTON_B : 0);
    }
    const debug = snapshot('timeout-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    throw new Error('Timed out while advancing ' + label + ': ' + JSON.stringify({ qa: qaState(), cpu: emulator.get_cpu_state(), framebuffer: debug.file }));
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

  function exerciseGameplay(label, shotButton, horizontal) {
    const audioStart = audioNonzero;
    const hostStart = hostFrame;
    for (let count = 0; count < 180; count += 1) {
      const state = qaState();
      if (state.screen !== 2) throw new Error(label + ' left gameplay unexpectedly: ' + JSON.stringify(state));
      const sweep = Math.trunc(state.stageFrame / 120) & 1;
      const movement = horizontal ? (sweep ? BUTTON_UP : BUTTON_DOWN) : (sweep ? BUTTON_LEFT : BUTTON_RIGHT);
      tick(shotButton | movement);
    }
    return { frame: snapshot(label), audioDelta: audioNonzero - audioStart, hostFrames: hostFrame - hostStart };
  }

  try {
    emulator.load_rom(new Uint8Array(rom));
    emulator.reset();
    const readyState = runUntil((state) => state.screen === 1, 120, 'immediate BulletML title');
    for (let count = 0; count < 3; count += 1) tick(0);
    const titleReady = snapshot('title-ready');
    if (readyState.selfTest !== 0 || readyState.loadProbe !== 0) throw new Error('Full QA ran before it was requested');

    press(BUTTON_A);
    runUntilAdvancing((state) => state.screen === 2 && state.orientation === 0 && state.selfTest === 0 && state.loadProbe === 0, 3600, 'Campaign opening and pre-stage demo');
    const campaignStart = snapshot('campaign-start');
    const campaign = exerciseGameplay('campaign-gameplay', BUTTON_A, false);

    emulator.reset();
    runUntil((state) => state.screen === 1 && state.selfTest === 0 && state.loadProbe === 0, 120, 'BulletML title before Caravan');
    press(BUTTON_DOWN);
    runUntil((state) => state.screen === 1 && state.orientation === 1, 120, 'Caravan selection');
    const caravanTitle = snapshot('title-caravan');
    press(BUTTON_A);
    runUntilAdvancing((state) => state.screen === 2 && state.selfTest === 0 && state.loadProbe === 0, 3600, 'Caravan pre-stage demo');
    const caravanStart = snapshot('caravan-start');
    const caravan = exerciseGameplay('caravan-gameplay', BUTTON_A, caravanStart.qa.orientation === 1);

    emulator.reset();
    runUntil((state) => state.screen === 1, 120, 'BulletML title before Options');
    press(BUTTON_B);
    const optionsReady = runUntil((state) => state.screen === 5, 120, 'Options screen');
    const optionsBefore = snapshot('options-before');
    press(BUTTON_RIGHT);
    const optionsChanged = runUntil((state) => state.screen === 5 && state.shotButton !== optionsReady.shotButton, 120, 'changed shot assignment');
    const optionsAfter = snapshot('options-after');
    press(BUTTON_A);
    const savedAtTitle = runUntil((state) => state.screen === 1 && state.sramLoaded === 1, 120, 'saved Options title');

    emulator.reset();
    const reloadedAtTitle = runUntil((state) => state.screen === 1, 120, 'title after SRAM reboot');
    const sramReloaded = snapshot('title-after-sram-reset');
    if (reloadedAtTitle.sramLoaded !== 1
      || reloadedAtTitle.shotButton !== savedAtTitle.shotButton
      || reloadedAtTitle.bombButton !== savedAtTitle.bombButton
      || reloadedAtTitle.speedButton !== savedAtTitle.speedButton) {
      throw new Error('Options did not survive SRAM reboot: ' + JSON.stringify({ savedAtTitle, reloadedAtTitle }));
    }

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

    const emulatorMeta = JSON.parse(fs.readFileSync(emulatorMetaPath, 'utf8'));
    const buildProof = JSON.parse(fs.readFileSync(buildProofPath, 'utf8'));
    const campaignQa = campaign.frame.qa;
    const caravanQa = caravan.frame.qa;
    const hasNoRuntimeDrops = (state) => !state.fireDrops && !state.poolDrops && !state.spawnDrops && !state.contextDrops && !state.opcodeExhaustions && !state.displayDeletes;
    const proof = {
      schemaVersion: 2,
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
        visibleTitleColors: titleReady.uniqueColors,
        visibleTitlePixels: titleReady.nonBlackPixels,
        visibleDiagnosticsColors: diagnosticsRunning.uniqueColors,
        visibleDiagnosticsPixels: diagnosticsRunning.nonBlackPixels,
      },
      modes: {
        campaign: {
          titleSelection: titleReady.qa.orientation,
          started: campaignStart.qa.screen === 2,
          orientation: campaignStart.qa.orientation,
          hostFrames: campaign.hostFrames,
          audioNonzero: campaign.audioDelta,
          qa: campaignQa,
        },
        caravan: {
          titleSelection: caravanTitle.qa.orientation,
          started: caravanStart.qa.screen === 2,
          orientation: caravanStart.qa.orientation,
          hostFrames: caravan.hostFrames,
          audioNonzero: caravan.audioDelta,
          qa: caravanQa,
        },
      },
      sram: {
        before: { shot: optionsReady.shotButton, bomb: optionsReady.bombButton, speed: optionsReady.speedButton },
        changed: { shot: optionsChanged.shotButton, bomb: optionsChanged.bombButton, speed: optionsChanged.speedButton },
        saved: { shot: savedAtTitle.shotButton, bomb: savedAtTitle.bombButton, speed: savedAtTitle.speedButton, checksumAccepted: savedAtTitle.sramLoaded === 1 },
        afterReset: { shot: reloadedAtTitle.shotButton, bomb: reloadedAtTitle.bombButton, speed: reloadedAtTitle.speedButton, checksumAccepted: reloadedAtTitle.sramLoaded === 1 },
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
      resources: {
        ram: {
          linker: buildProof.runtime.ram,
          minimumFreeBytes: Math.min(campaignQa.minFreeRam, caravanQa.minFreeRam),
          maximumAllocatedBytes: Math.max(campaignQa.maxAllocatedRam, caravanQa.maxAllocatedRam),
        },
        vram: {
          build: buildProof.runtime.vram,
          minimumFreeSpriteTiles: Math.min(campaignQa.minFreeSpriteTiles, caravanQa.minFreeSpriteTiles),
        },
      },
      assertions: {
        defaultBootReachedTitleWithinOneSecond: titleReady.hostFrame <= 60 && titleReady.qa.screen === 1,
        defaultBootDeferredDiagnostics: titleReady.qa.selfTest === 0 && titleReady.qa.loadProbe === 0,
        defaultBootRenderedVisibleTitle: titleReady.uniqueColors > 1 && titleReady.nonBlackPixels > 500,
        modeSelectContainsCampaignAndCaravan: titleReady.qa.orientation === 0 && caravanTitle.qa.orientation === 1,
        campaignStartedVisibleGameplayWithoutDiagnostics: campaignStart.qa.screen === 2 && campaignStart.qa.selfTest === 0 && campaignStart.qa.loadProbe === 0 && campaignStart.uniqueColors > 1 && campaignStart.nonBlackPixels > 500,
        caravanStartedVisibleGameplayWithoutDiagnostics: caravanStart.qa.screen === 2 && caravanStart.qa.selfTest === 0 && caravanStart.qa.loadProbe === 0 && caravanStart.uniqueColors > 1 && caravanStart.nonBlackPixels > 500,
        optionsChangedWithoutDuplicateButtons: new Set([optionsChanged.shotButton, optionsChanged.bombButton, optionsChanged.speedButton]).size === 3,
        optionsSavedWithValidChecksum: savedAtTitle.sramLoaded === 1,
        optionsPersistedAfterSramReset: reloadedAtTitle.sramLoaded === 1 && reloadedAtTitle.shotButton === savedAtTitle.shotButton && reloadedAtTitle.bombButton === savedAtTitle.bombButton && reloadedAtTitle.speedButton === savedAtTitle.speedButton,
        requestedDiagnosticsRenderedProgress: diagnosticsRunning.qa.screen === 4 && diagnosticsRunning.uniqueColors > 1 && diagnosticsRunning.nonBlackPixels > 500,
        cRuntimeMatchesJsCrc10000: title.qa.selfTest === 1,
        loadProbePassed: title.qa.loadProbe === 1,
        loadProbeReached48Bullets5Emitters16Spawns: title.qa.loadMaxBullets === 48 && title.qa.loadMaxEmitters === 5 && title.qa.loadMaxSpawns === 16,
        loadProbeStayedWithinH40: title.qa.loadMaxGlobalSprites <= 80 && title.qa.loadMaxPieces <= 20 && title.qa.loadMaxDots <= 320,
        loadProbeNoDrops: !title.qa.loadFireDrops && !title.qa.loadContextDrops && !title.qa.loadOpcodeExhaustions && !title.qa.loadDisplayDeletes,
        loadProbeMaintained60Hz: title.qa.loadVBlankFrames === buildProof.runtime.loadProbe.frames && title.qa.loadMaxFrameSubticks <= buildProof.runtime.loadProbe.expected.subticksPerFrame && title.qa.loadMaxCpuLoad < 100,
        loadProbeAudioNonzero: title.audio.nonzero - diagnosticsAudioStart > 0,
        campaignXgm2AndWavSimultaneous: campaignQa.gameplayBgmStarted === 1 && campaignQa.pcmWhileBgm === 1 && campaign.audioDelta > 0,
        caravanXgm2AndWavSimultaneous: caravanQa.gameplayBgmStarted === 1 && caravanQa.pcmWhileBgm === 1 && caravan.audioDelta > 0,
        gameplayMaintained60Hz: campaignQa.maxCpuLoad < 100 && caravanQa.maxCpuLoad < 100,
        noRuntimeDrops: !title.qa.loadFireDrops && !title.qa.loadContextDrops && !title.qa.loadOpcodeExhaustions && !title.qa.loadDisplayDeletes && hasNoRuntimeDrops(campaignQa) && hasNoRuntimeDrops(caravanQa),
        romWithin4MiB: rom.length <= 4 * 1024 * 1024,
        runtimeRamVramWithinBudget: buildProof.runtime.ram?.withinBudget === true && buildProof.runtime.vram?.withinBudget === true && campaignQa.minFreeRam >= 4096 && caravanQa.minFreeRam >= 4096 && campaignQa.minFreeSpriteTiles > 0 && caravanQa.minFreeSpriteTiles > 0,
      },
      snapshots,
    };
    const proofPath = path.join(outputDir, 'bulletml-stg-wasm-proof.json');
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
    buildProof.wasm = proof;
    fs.writeFileSync(buildProofPath, JSON.stringify(buildProof, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ proofPath, assertions: proof.assertions, emulator: proof.emulator, loadProbe: proof.loadProbe, modes: proof.modes, sram: proof.sram }, null, 2) + '\n');
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
