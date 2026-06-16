const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const imageData = ctx.createImageData(canvas.width, canvas.height);

const ui = {
  buildVersion: document.getElementById("buildVersion"),
  status: document.getElementById("status"),
  meta: document.getElementById("meta"),
  devPanel: document.getElementById("devPanel"),
  toggleDev: document.getElementById("toggleDev"),
  installPwa: document.getElementById("installPwa"),
  gamepadStatus: document.getElementById("gamepadStatus"),

  romFile: document.getElementById("romFile"),
  bundledRom: document.getElementById("bundledRom"),
  loadRom: document.getElementById("loadRom"),
  loadBundled: document.getElementById("loadBundled"),

  toggleRun: document.getElementById("toggleRun"),
  stepFrame: document.getElementById("stepFrame"),
  reset: document.getElementById("reset"),
  toggleAudio: document.getElementById("toggleAudio"),
  fullscreen: document.getElementById("fullscreen"),

  saveState: document.getElementById("saveState"),
  loadState: document.getElementById("loadState"),
  downloadState: document.getElementById("downloadState"),
  uploadState: document.getElementById("uploadState"),
  stateFile: document.getElementById("stateFile"),
  dropZone: document.getElementById("dropZone"),
};

const TARGET_FPS = 60;
const FRAME_MS = 1000 / TARGET_FPS;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_PULL_FRAMES = Math.ceil(AUDIO_SAMPLE_RATE / TARGET_FPS);

const BTN_UP = 1 << 0;
const BTN_DOWN = 1 << 1;
const BTN_LEFT = 1 << 2;
const BTN_RIGHT = 1 << 3;
const BTN_B = 1 << 4;
const BTN_C = 1 << 5;
const BTN_A = 1 << 6;
const BTN_START = 1 << 7;

const BUNDLED_ROMS_LIST_URL = "./roms/index.json";

const pressed = new Set();
const touchPressed = new Set();
const gamepadPressed = new Set();

let wasmReady = false;
let wasmModule = null;
let emulator = null;
let loadedRomBytes = null;
let loadedRomInfo = null;
let running = false;
let rafId = null;
let lastTs = 0;
let accumulator = 0;
let renderedFrames = 0;
let audioContext = null;
let audioEnabled = true;
let audioNextTime = 0;
let savedStateData = null;
let devModeEnabled = false;
let deferredInstallPrompt = null;
let devAutoRefreshId = null;
const DEV_REFRESH_INTERVAL_MS = 500;

// ── SRAM persistence via IndexedDB ──
const SRAM_DB_NAME = "md-emulator-sram";
const SRAM_DB_VERSION = 1;
const SRAM_STORE_NAME = "saves";
const SRAM_AUTO_SAVE_FRAMES = 300; // ~5 seconds at 60fps
let sramRomKey = null;
let sramFrameCounter = 0;

function openSramDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SRAM_DB_NAME, SRAM_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SRAM_STORE_NAME)) {
        db.createObjectStore(SRAM_STORE_NAME);
      }
    };
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(event.target.error);
  });
}

async function saveSramToDb(key, data) {
  if (!key || !data || data.length === 0) return;
  try {
    const db = await openSramDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SRAM_STORE_NAME, "readwrite");
      tx.objectStore(SRAM_STORE_NAME).put(new Uint8Array(data), key);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (e) {
    console.warn("[SRAM] save failed:", e);
  }
}

async function loadSramFromDb(key) {
  if (!key) return null;
  try {
    const db = await openSramDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SRAM_STORE_NAME, "readonly");
      const req = tx.objectStore(SRAM_STORE_NAME).get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (e) {
    console.warn("[SRAM] load failed:", e);
    return null;
  }
}

function computeRomKey(romBytes, label) {
  // Simple FNV-1a hash of first 512 bytes + file size for stable identification
  let hash = 0x811c9dc5;
  const limit = Math.min(romBytes.length, 512);
  for (let i = 0; i < limit; i++) {
    hash ^= romBytes[i];
    hash = (Math.imul(hash, 0x01000193)) >>> 0;
  }
  return `sram_${label.replace(/[^a-zA-Z0-9._-]/g, "_")}_${romBytes.length}_${hash.toString(16)}`;
}

async function autoSaveSram() {
  if (!emulator || !sramRomKey) return;
  try {
    if (!emulator.has_sram()) return;
    const data = emulator.get_sram();
    if (data && data.length > 0) {
      await saveSramToDb(sramRomKey, data);
    }
  } catch (e) {
    console.warn("[SRAM] auto-save failed:", e);
  }
}

function toByteArray(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  return new Uint8Array(data.buffer ?? data);
}

function triggerDownload(bytes, filename, mimeType = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setStatus(text) {
  if (ui.status) ui.status.textContent = text;
}

function setMeta(text) {
  if (ui.meta) ui.meta.textContent = text;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmtBytes(n) {
  const num = Number(n || 0);
  if (!num) return "N/A";
  return `${(num / (1024 * 1024)).toFixed(2)} MB (${num} bytes)`;
}

function parseRomHeaderInfo(romBytes, label = "ROM") {
  const readAscii = (offset, length) => {
    if (!romBytes || romBytes.length <= offset) return "";
    const end = Math.min(romBytes.length, offset + length);
    let text = "";
    for (let i = offset; i < end; i += 1) {
      const b = romBytes[i] || 0;
      text += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : " ";
    }
    return text.replace(/\s+/g, " ").trim();
  };
  const readU16 = (offset) => (
    romBytes && romBytes.length >= offset + 2
      ? ((romBytes[offset] << 8) | romBytes[offset + 1]) >>> 0
      : null
  );
  const readU32 = (offset) => (
    romBytes && romBytes.length >= offset + 4
      ? (((romBytes[offset] << 24) >>> 0) | (romBytes[offset + 1] << 16) | (romBytes[offset + 2] << 8) | romBytes[offset + 3]) >>> 0
      : null
  );

  const checksum = readU16(0x18e);
  const romStart = readU32(0x1a0);
  const romEnd = readU32(0x1a4);
  const fileName = String(label || "ROM").replace(/^bundled:/, "");

  return {
    fileName,
    fileSize: romBytes?.length || 0,
    consoleName: readAscii(0x100, 16),
    domesticTitle: readAscii(0x120, 48),
    overseasTitle: readAscii(0x150, 48),
    serial: readAscii(0x180, 14),
    ioSupport: readAscii(0x190, 16),
    region: readAscii(0x1f0, 3),
    checksum: checksum == null ? "N/A" : `0x${checksum.toString(16).padStart(4, "0").toUpperCase()}`,
    romRange: (romStart == null || romEnd == null)
      ? "N/A"
      : `0x${romStart.toString(16).padStart(8, "0").toUpperCase()} - 0x${romEnd.toString(16).padStart(8, "0").toUpperCase()}`,
  };
}

function updateRomInfoPanel(info = loadedRomInfo) {
  const value = (v) => v || "N/A";
  setText("romFileName", value(info?.fileName));
  setText("romFileSize", fmtBytes(info?.fileSize));
  setText("romConsoleName", value(info?.consoleName));
  setText("romDomesticTitle", value(info?.domesticTitle));
  setText("romOverseasTitle", value(info?.overseasTitle));
  setText("romSerial", value(info?.serial));
  setText("romRegion", value(info?.region));
  setText("romChecksum", value(info?.checksum));
  setText("romRange", value(info?.romRange));
  setText("romIoSupport", value(info?.ioSupport));
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function computeButtons() {
  let buttons = 0;
  if (pressed.has("ArrowUp") || pressed.has("KeyW") || touchPressed.has("up") || gamepadPressed.has("up")) buttons |= BTN_UP;
  if (pressed.has("ArrowDown") || pressed.has("KeyS") || touchPressed.has("down") || gamepadPressed.has("down")) buttons |= BTN_DOWN;
  if (pressed.has("ArrowLeft") || pressed.has("KeyA") || touchPressed.has("left") || gamepadPressed.has("left")) buttons |= BTN_LEFT;
  if (pressed.has("ArrowRight") || pressed.has("KeyD") || touchPressed.has("right") || gamepadPressed.has("right")) buttons |= BTN_RIGHT;
  if (pressed.has("KeyJ") || touchPressed.has("b") || gamepadPressed.has("b")) buttons |= BTN_B;
  if (pressed.has("KeyK") || touchPressed.has("c") || gamepadPressed.has("c")) buttons |= BTN_C;
  if (pressed.has("KeyU") || touchPressed.has("a") || gamepadPressed.has("a")) buttons |= BTN_A;
  if (pressed.has("Enter") || touchPressed.has("start") || gamepadPressed.has("start")) buttons |= BTN_START;
  return buttons;
}

function drawFrame(pixelsArgb) {
  const dst = imageData.data;
  const limit = Math.min(pixelsArgb.length, canvas.width * canvas.height);
  for (let i = 0; i < limit; i += 1) {
    const color = pixelsArgb[i] >>> 0;
    const offset = i * 4;
    dst[offset] = (color >> 16) & 0xff;
    dst[offset + 1] = (color >> 8) & 0xff;
    dst[offset + 2] = color & 0xff;
    dst[offset + 3] = (color >> 24) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0);
}

function updateMeta() {
  const rows = [
    `wasm_ready=${wasmReady}`,
    `rom_loaded=${loadedRomBytes ? "yes" : "no"}`,
    `running=${running}`,
    `audio=${audioEnabled ? "on" : "off"}`,
    `frames=${renderedFrames}`,
    `dev_mode=${devModeEnabled}`,
  ];
  setMeta(rows.join("\n"));
}

function syncAudioToggleLabel() {
  if (ui.toggleAudio) {
    ui.toggleAudio.textContent = audioEnabled ? "\ud83d\udd0a" : "\ud83d\udd07";
    ui.toggleAudio.title = audioEnabled ? "Mute" : "Unmute";
  }
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
  }
}

async function ensureAudioDefaultPlayback() {
  if (!audioEnabled) {
    syncAudioToggleLabel();
    return;
  }
  ensureAudio();
  try {
    await audioContext.resume();
  } catch {
    // Browser autoplay policy may still block resume without a direct user gesture.
  }
  audioNextTime = 0;
  syncAudioToggleLabel();
  updateMeta();
}

function drainAudio() {
  if (!audioEnabled || !audioContext || !emulator) return;
  const rawSamples = emulator.take_audio_samples(AUDIO_PULL_FRAMES);
  const samples = Array.from(rawSamples || []);
  if (samples.length < 2) return;

  const frameCount = Math.floor(samples.length / 2);
  const buffer = audioContext.createBuffer(2, frameCount, AUDIO_SAMPLE_RATE);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < frameCount; i += 1) {
    left[i] = samples[i * 2] ?? 0;
    right[i] = samples[i * 2 + 1] ?? 0;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  const now = audioContext.currentTime;
  if (audioNextTime < now) audioNextTime = now;
  // Prevent audio scheduling from drifting too far ahead (~50ms max)
  if (audioNextTime > now + 0.05) audioNextTime = now + 0.02;
  source.start(audioNextTime);
  audioNextTime += buffer.duration;
}

function updateGamepadState() {
  gamepadPressed.clear();
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads || []).find(Boolean);

  if (!pad) {
    if (ui.gamepadStatus) ui.gamepadStatus.textContent = "Gamepad: disconnected";
    return;
  }

  if (ui.gamepadStatus) ui.gamepadStatus.textContent = `Gamepad: ${pad.id}`;

  const axis0 = pad.axes[0] ?? 0;
  const axis1 = pad.axes[1] ?? 0;
  if (pad.buttons[12]?.pressed || axis1 < -0.4) gamepadPressed.add("up");
  if (pad.buttons[13]?.pressed || axis1 > 0.4) gamepadPressed.add("down");
  if (pad.buttons[14]?.pressed || axis0 < -0.4) gamepadPressed.add("left");
  if (pad.buttons[15]?.pressed || axis0 > 0.4) gamepadPressed.add("right");

  if (pad.buttons[0]?.pressed) gamepadPressed.add("b");
  if (pad.buttons[1]?.pressed) gamepadPressed.add("a");
  if (pad.buttons[2]?.pressed) gamepadPressed.add("c");
  if (pad.buttons[9]?.pressed) gamepadPressed.add("start");
}

function setButtons() {
  if (!emulator) return;
  emulator.set_controller_state(1, computeButtons());
}

function runOneFrame() {
  if (!emulator) return;
  updateGamepadState();
  setButtons();
  emulator.run_frame();
  drawFrame(emulator.get_framebuffer_argb());
  drainAudio();
  renderedFrames += 1;
  // SRAM 自動保存 (約5秒ごと)
  if (emulator.has_sram && emulator.has_sram()) {
    sramFrameCounter += 1;
    if (sramFrameCounter >= SRAM_AUTO_SAVE_FRAMES) {
      sramFrameCounter = 0;
      autoSaveSram().catch(() => {});
    }
  }
  updateMeta();
}

function stopLoop() {
  running = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (ui.toggleRun) { ui.toggleRun.textContent = "\u25b6"; ui.toggleRun.title = "Run"; }
  updateMeta();
}

function frameTick(ts) {
  if (!running) return;
  if (!lastTs) lastTs = ts;
  accumulator += ts - lastTs;
  lastTs = ts;

  // Cap accumulator to prevent burst-scheduling many frames of audio
  // after a browser pause or slow frame (max 3 frames = ~50ms).
  if (accumulator > FRAME_MS * 3) accumulator = FRAME_MS * 3;

  while (accumulator >= FRAME_MS) {
    accumulator -= FRAME_MS;
    runOneFrame();
  }
  rafId = requestAnimationFrame(frameTick);
}

function enableRuntimeButtons() {
  [ui.toggleRun, ui.stepFrame, ui.reset, ui.toggleAudio, ui.saveState, ui.downloadState, ui.uploadState].forEach((el) => {
    if (el) el.disabled = false;
  });
  const rd = document.getElementById("refreshDev");
  if (rd) rd.disabled = false;
  if (ui.loadState && !savedStateData) {
    ui.loadState.disabled = true;
  }
  syncAudioToggleLabel();
}

function startRunLoop() {
  running = true;
  lastTs = 0;
  accumulator = 0;
  if (ui.toggleRun) { ui.toggleRun.textContent = "\u23f8"; ui.toggleRun.title = "Pause"; }
  rafId = requestAnimationFrame(frameTick);
}

async function loadRomBytes(romBytes, label = "ROM") {
  if (!emulator) {
    setStatus("wasm not ready");
    return;
  }
  stopLoop();
  loadedRomBytes = romBytes;
  loadedRomInfo = parseRomHeaderInfo(romBytes, label);
  emulator.load_rom(loadedRomBytes);
  emulator.reset();
  renderedFrames = 0;
  savedStateData = null;
  sramRomKey = computeRomKey(romBytes, label);
  sramFrameCounter = 0;

  // SRAM が存在する場合、IndexedDB から保存済みデータを復元する
  if (emulator.has_sram && emulator.has_sram()) {
    const savedSram = await loadSramFromDb(sramRomKey);
    if (savedSram && savedSram.length > 0) {
      emulator.load_sram(Array.from(savedSram));
      setStatus(`${label} loaded (SRAM restored, ${savedSram.length} bytes)`);
    }
  }

  drawFrame(emulator.get_framebuffer_argb());
  updateRomInfoPanel();
  enableRuntimeButtons();
  if (emulator.has_sram && emulator.has_sram()) {
    setStatus(`${label} loaded (SRAM: ${emulator.get_sram().length} bytes)`);
  } else {
    setStatus(`${label} loaded (${loadedRomBytes.length} bytes)`);
  }
  await ensureAudioDefaultPlayback();
  startRunLoop();
  updateMeta();
}

async function initializeWasm() {
  try {
    const cacheBust = Date.now();
    wasmModule = await import(`./pkg/md_wasm.js?v=${cacheBust}`);
    await wasmModule.default(`./pkg/md_wasm_bg.wasm?v=${cacheBust}`);
    emulator = new wasmModule.EmulatorHandle();
    wasmReady = true;

    if (ui.loadRom) ui.loadRom.disabled = false;
    if (ui.loadBundled) ui.loadBundled.disabled = false;
    if (ui.uploadState) ui.uploadState.disabled = false;

    if (ui.buildVersion && wasmModule.EmulatorHandle.build_version) {
      try {
        ui.buildVersion.textContent = `build: ${wasmModule.EmulatorHandle.build_version()} (WASM)`;
      } catch {
        ui.buildVersion.textContent = "build: unknown";
      }
    }

    setStatus("wasm ready");
    updateMeta();

    // ── エクスポートされたスタンドアロン HTML 向けオートスタート ──
    // HTML 生成時に window.__AUTOSTART_ROM_B64 = { data: "<base64>", label: "<name>" }
    // をセットしておくと、WASM 初期化後に自動的に ROM を読み込んで起動する。
    if (window.__AUTOSTART_ROM_B64 && window.__AUTOSTART_ROM_B64.data) {
      try {
        const b64 = window.__AUTOSTART_ROM_B64.data;
        const romLabel = window.__AUTOSTART_ROM_B64.label || "ROM";
        const bstr = atob(b64);
        const romBytes = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) romBytes[i] = bstr.charCodeAt(i);
        await loadRomBytes(romBytes, romLabel);
      } catch (autostartErr) {
        setStatus(`autostart failed: ${autostartErr}`);
      }
    }
  } catch (error) {
    setStatus(`wasm init failed: ${error}`);
    setMeta("build frontend/pkg first: wasm-pack build crates/md-wasm --target web --out-dir ../../frontend/pkg");
  }
}

async function loadSelectedRom() {
  const file = ui.romFile?.files?.[0];
  if (!file) {
    setStatus("select a ROM file first");
    return;
  }
  await ensureAudioDefaultPlayback();
  const arrayBuffer = await file.arrayBuffer();
  await loadRomBytes(new Uint8Array(arrayBuffer), file.name);
}

async function loadBundledRom() {
  const selected = ui.bundledRom?.value;
  if (!selected) {
    setStatus("bundled ROM is not selected");
    return;
  }
  await ensureAudioDefaultPlayback();
  const response = await fetch(selected);
  if (!response.ok) {
    throw new Error(`failed to fetch bundled ROM: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const label = selected.split("/").pop() || "bundled";
  await loadRomBytes(bytes, `bundled:${label}`);
}

async function setupBundledRomList() {
  if (!ui.bundledRom) return;
  ui.bundledRom.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Bundled ROM...";
  ui.bundledRom.appendChild(placeholder);

  try {
    const response = await fetch(BUNDLED_ROMS_LIST_URL, { cache: "no-cache" });
    if (!response.ok) {
      setStatus("bundled ROM list is not available (roms/index.json not found)");
      return;
    }
    const list = await response.json();
    const files = Array.isArray(list?.files) ? list.files : [];
    for (const file of files) {
      const opt = document.createElement("option");
      opt.value = `./roms/${file}`;
      opt.textContent = file;
      ui.bundledRom.appendChild(opt);
    }
    ui.bundledRom.value = "";
  } catch (error) {
    setStatus(`bundled ROM list load skipped: ${error}`);
  }
}

function resetEmulator() {
  if (!emulator || !loadedRomBytes) return;
  stopLoop();
  // load_rom は SRAM を 0xFF に再初期化するため、リセット前に保存して復元する
  let sramData = null;
  if (emulator.has_sram && emulator.has_sram()) {
    sramData = emulator.get_sram();
  }
  emulator.load_rom(loadedRomBytes);
  emulator.reset();
  // SRAM はバッテリーバックアップなのでリセット後も内容を保持する
  if (sramData && sramData.length > 0) {
    emulator.load_sram(Array.from(sramData));
  }
  renderedFrames = 0;
  sramFrameCounter = 0;
  drawFrame(emulator.get_framebuffer_argb());
  audioNextTime = 0;
  setStatus("emulator reset");
  updateMeta();
}

function toggleRun() {
  if (!emulator || !loadedRomBytes) return;
  running = !running;
  if (running) {
    startRunLoop();
    setStatus("running");
  } else {
    stopLoop();
    setStatus("paused");
  }
  updateMeta();
}

async function toggleAudio() {
  if (!emulator) return;
  audioEnabled = !audioEnabled;
  if (audioEnabled) {
    ensureAudio();
    await audioContext.resume();
    audioNextTime = 0;
    setStatus("audio enabled");
  } else {
    setStatus("audio muted");
  }
  syncAudioToggleLabel();
  updateMeta();
}

// ── Developer Mode: VDP debug rendering ──

function drawArgbToCanvas(canvasEl, pixelsArgb, width, height) {
  if (!canvasEl) return;
  canvasEl.width = width;
  canvasEl.height = height;
  const dctx = canvasEl.getContext("2d");
  const img = dctx.createImageData(width, height);
  const dst = img.data;
  const len = Math.min(pixelsArgb.length, width * height);
  for (let i = 0; i < len; i++) {
    const c = pixelsArgb[i] >>> 0;
    const o = i * 4;
    dst[o] = (c >> 16) & 0xff;
    dst[o + 1] = (c >> 8) & 0xff;
    dst[o + 2] = c & 0xff;
    dst[o + 3] = (c >> 24) & 0xff;
  }
  dctx.putImageData(img, 0, 0);
}

function refreshDevRegisters() {
  if (!emulator) return;
  const el = document.getElementById("devRegistersText");
  if (!el) return;
  try {
    const reg = emulator.get_vdp_registers_json();
    const lines = [];
    if (reg.registers) {
      lines.push("VDP Registers:");
      const regs = reg.registers;
      for (let i = 0; i < regs.length; i++) {
        lines.push(`  R${String(i).padStart(2, "0")}: 0x${(regs[i] & 0xff).toString(16).padStart(2, "0").toUpperCase()} (${regs[i]})`);
      }
    }
    if (reg.address !== undefined) lines.push(`Address:   0x${reg.address.toString(16).padStart(4, "0").toUpperCase()}`);
    if (reg.code !== undefined) lines.push(`Code:      ${reg.code}`);
    if (reg.status !== undefined) lines.push(`Status:    0x${reg.status.toString(16).padStart(4, "0").toUpperCase()}`);
    if (reg.frame !== undefined) lines.push(`Frame #:   ${reg.frame}`);
    if (reg.data_writes !== undefined) lines.push(`Data Wr:   ${reg.data_writes}`);
    if (reg.ctrl_writes !== undefined) lines.push(`Ctrl Wr:   ${reg.ctrl_writes}`);
    if (reg.dma) {
      const d = reg.dma;
      lines.push(`DMA:       mode=${d.mode ?? "?"} len=${d.length ?? "?"} src=0x${(d.source_address ?? 0).toString(16).toUpperCase()} active=${d.active ?? false}`);
    }
    el.textContent = lines.join("\n");
  } catch (e) {
    el.textContent = `error: ${e}`;
  }
}

function refreshDevPlanes() {
  if (!emulator) return;
  try {
    for (const [name, canvasId] of [["A", "devPlaneA"], ["B", "devPlaneB"], ["W", "devPlaneW"]]) {
      const result = emulator.debug_render_plane(name);
      if (result && result.pixels_argb) {
        drawArgbToCanvas(document.getElementById(canvasId), result.pixels_argb, result.width, result.height);
      }
    }
  } catch (e) {
    setStatus(`plane render error: ${e}`);
  }
}

function refreshDevTiles() {
  if (!emulator) return;
  try {
    const palSelect = document.getElementById("devTilePalette");
    const palette = palSelect ? parseInt(palSelect.value, 10) : 0;
    const result = emulator.debug_render_tiles(palette);
    if (result && result.pixels_argb) {
      drawArgbToCanvas(document.getElementById("devTilesCanvas"), result.pixels_argb, result.width, result.height);
    }
  } catch (e) {
    setStatus(`tile render error: ${e}`);
  }
}

function refreshDevCram() {
  if (!emulator) return;
  const grid = document.getElementById("devCramGrid");
  if (!grid) return;
  try {
    const result = emulator.debug_cram_colors_json();
    const colors = result?.colors_argb ?? [];
    grid.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement("div");
      cell.className = "cram-cell";
      if (i < colors.length) {
        const c = colors[i] >>> 0;
        const r = (c >> 16) & 0xff;
        const g = (c >> 8) & 0xff;
        const b = c & 0xff;
        cell.style.background = `rgb(${r},${g},${b})`;
        cell.title = `#${i}: rgb(${r},${g},${b}) 0x${(c & 0xffffff).toString(16).padStart(6, "0")}`;
      } else {
        cell.style.background = "#000";
      }
      grid.appendChild(cell);
    }
  } catch (e) {
    grid.textContent = `error: ${e}`;
  }
}

function refreshDevSprites() {
  if (!emulator) return;
  const tbody = document.getElementById("devSpriteBody");
  if (!tbody) return;
  try {
    const result = emulator.debug_sprites_json();
    const sprites = result?.sprites ?? [];
    tbody.innerHTML = "";
    for (const s of sprites) {
      if (s.link === 0 && s.index !== 0) continue;
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${s.index}</td><td>${s.x}</td><td>${s.y}</td>` +
        `<td>${s.width}</td><td>${s.height}</td><td>0x${(s.tile ?? 0).toString(16).toUpperCase()}</td>` +
        `<td>${s.palette}</td><td>${s.priority ? "Y" : ""}</td>` +
        `<td>${s.hflip ? "Y" : ""}</td><td>${s.vflip ? "Y" : ""}</td><td>${s.link}</td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11">error: ${e}</td></tr>`;
  }
}

function refreshActiveDevTab() {
  const activeTab = document.querySelector(".dev-tab.active");
  if (!activeTab) return;
  const tab = activeTab.dataset.devTab;
  switch (tab) {
    case "registers": refreshDevRegisters(); break;
    case "planes": refreshDevPlanes(); break;
    case "tiles": refreshDevTiles(); break;
    case "cram": refreshDevCram(); break;
    case "sprites": refreshDevSprites(); break;
  }
}

function startDevAutoRefresh() {
  stopDevAutoRefresh();
  devAutoRefreshId = setInterval(refreshActiveDevTab, DEV_REFRESH_INTERVAL_MS);
}

function stopDevAutoRefresh() {
  if (devAutoRefreshId !== null) {
    clearInterval(devAutoRefreshId);
    devAutoRefreshId = null;
  }
}

function toggleDevMode() {
  devModeEnabled = !devModeEnabled;
  if (ui.devPanel) {
    ui.devPanel.classList.toggle("visible", devModeEnabled);
  }
  if (ui.toggleDev) {
    ui.toggleDev.textContent = "\ud83d\udee0";
    ui.toggleDev.title = `Developer Mode: ${devModeEnabled ? "ON" : "OFF"}`;
    ui.toggleDev.style.opacity = devModeEnabled ? "1" : "0.5";
  }
  if (devModeEnabled && emulator) {
    refreshActiveDevTab();
    startDevAutoRefresh();
  } else {
    stopDevAutoRefresh();
  }
  updateMeta();
}

function setupDragAndDrop() {
  if (!ui.dropZone) return;

  ui.dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("dragover");
  });
  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("dragover");
  });
  ui.dropZone.addEventListener("dragleave", () => {
    ui.dropZone.classList.remove("dragover");
  });
  ui.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await ensureAudioDefaultPlayback();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadRomBytes(bytes, file.name);
  });
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      // Check for SW updates periodically (every 60s in dev)
      setInterval(() => reg.update().catch(() => {}), 60_000);
      // When a new SW is found, activate immediately
      reg.addEventListener("updatefound", () => {
        const newSw = reg.installing;
        if (!newSw) return;
        newSw.addEventListener("statechange", () => {
          if (newSw.state === "activated") {
            console.log("[PWA] new service worker activated — clearing caches");
          }
        });
      });
    }).catch((error) => {
      setStatus(`service worker registration failed: ${error}`);
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (ui.installPwa) ui.installPwa.classList.remove("hide");
  });

  if (ui.installPwa) {
    ui.installPwa.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      ui.installPwa.classList.add("hide");
    });
  }
}

if (ui.loadRom) {
  ui.loadRom.addEventListener("click", () => {
    loadSelectedRom().catch((error) => setStatus(`load failed: ${error}`));
  });
}

if (ui.romFile) {
  ui.romFile.addEventListener("change", () => {
    loadSelectedRom().catch((error) => setStatus(`load failed: ${error}`));
  });
}

if (ui.loadBundled) {
  ui.loadBundled.addEventListener("click", () => {
    loadBundledRom().catch((error) => setStatus(`bundled load failed: ${error}`));
  });
}

if (ui.bundledRom) {
  ui.bundledRom.addEventListener("change", () => {
    if (!ui.bundledRom.value) return;
    loadBundledRom().catch((error) => setStatus(`bundled load failed: ${error}`));
  });
}

if (ui.toggleRun) ui.toggleRun.addEventListener("click", toggleRun);
if (ui.stepFrame) {
  ui.stepFrame.addEventListener("click", () => {
    runOneFrame();
    setStatus("stepped one frame");
  });
}
if (ui.reset) ui.reset.addEventListener("click", resetEmulator);
if (ui.toggleAudio) {
  ui.toggleAudio.addEventListener("click", () => {
    toggleAudio().catch((error) => setStatus(`audio failed: ${error}`));
  });
}

// ── Fullscreen orientation state ──
const SCREEN_ASPECT = 320 / 224;
const ROTATED_SCREEN_ASPECT = 224 / 320;
let screenRotation = 0; // 0 or 90 while fullscreen

function applyStageRotation(rotation) {
  const stage = document.querySelector(".screen-stage");
  const rotator = document.querySelector(".screen-rotator");
  if (!stage || !rotator) return;

  screenRotation = rotation;
  if (document.fullscreenElement === stage && rotation === 90) {
    rotator.style.width = "100vh";
    rotator.style.height = "100vw";
    rotator.style.transform = "translate(-50%, -50%) rotate(90deg)";
  } else {
    rotator.style.width = "";
    rotator.style.height = "";
    rotator.style.transform = "";
  }
}

function chooseFullscreenRotation() {
  const viewportAspect = window.innerWidth / Math.max(1, window.innerHeight);
  const normalDelta = Math.abs(Math.log(viewportAspect / SCREEN_ASPECT));
  const rotatedDelta = Math.abs(Math.log(viewportAspect / ROTATED_SCREEN_ASPECT));
  return rotatedDelta < normalDelta ? 90 : 0;
}

function syncFullscreenRotation() {
  const stage = document.querySelector(".screen-stage");
  if (document.fullscreenElement === stage) {
    applyStageRotation(chooseFullscreenRotation());
  } else {
    applyStageRotation(0);
  }
}

const fsFullscreenBtn = document.getElementById("fsFullscreen");

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      const stage = document.querySelector(".screen-stage");
      await (stage || canvas).requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    setStatus(`fullscreen failed: ${error}`);
  }
}

function syncFullscreenButtons() {
  const isFullscreen = !!document.fullscreenElement;
  if (ui.fullscreen) {
    ui.fullscreen.textContent = isFullscreen ? "↙" : "⛶";
    ui.fullscreen.title = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
  }
  if (fsFullscreenBtn) {
    fsFullscreenBtn.textContent = isFullscreen ? "↙" : "⛶";
    fsFullscreenBtn.title = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
  }
}

if (ui.fullscreen) ui.fullscreen.addEventListener("click", toggleFullscreen);
if (fsFullscreenBtn) fsFullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncFullscreenButtons);
document.addEventListener("fullscreenchange", syncFullscreenRotation);
window.addEventListener("resize", syncFullscreenRotation);
window.addEventListener("orientationchange", syncFullscreenRotation);
syncFullscreenButtons();
syncFullscreenRotation();

if (ui.toggleDev) ui.toggleDev.addEventListener("click", toggleDevMode);

// Dev tab switching
document.querySelectorAll(".dev-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dev-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".dev-section").forEach((s) => s.classList.remove("active"));
    tab.classList.add("active");
    const target = document.getElementById(`dev${tab.dataset.devTab.charAt(0).toUpperCase() + tab.dataset.devTab.slice(1)}`);
    if (target) target.classList.add("active");
    if (devModeEnabled && emulator) refreshActiveDevTab();
  });
});

// Dev refresh button
const refreshDevBtn = document.getElementById("refreshDev");
if (refreshDevBtn) {
  refreshDevBtn.addEventListener("click", () => {
    if (emulator) refreshActiveDevTab();
  });
}

// Tile palette selector triggers re-render
const devTilePalette = document.getElementById("devTilePalette");
if (devTilePalette) {
  devTilePalette.addEventListener("change", () => {
    if (devModeEnabled && emulator) refreshDevTiles();
  });
}

if (ui.saveState) {
  ui.saveState.addEventListener("click", () => {
    if (!emulator) return;
    try {
      savedStateData = toByteArray(emulator.save_state());
      if (ui.loadState) ui.loadState.disabled = false;
      if (ui.downloadState) ui.downloadState.disabled = false;
      setStatus(`state saved (${savedStateData.length} bytes)`);
    } catch (error) {
      setStatus(`save failed: ${error}`);
    }
  });
}

if (ui.loadState) {
  ui.loadState.addEventListener("click", () => {
    if (!emulator || !savedStateData) return;
    try {
      emulator.load_state(Array.from(savedStateData));
      drawFrame(emulator.get_framebuffer_argb());
      setStatus("state loaded");
    } catch (error) {
      setStatus(`load failed: ${error}`);
    }
  });
}

if (ui.downloadState) {
  ui.downloadState.addEventListener("click", () => {
    if (!emulator) return;
    try {
      const stateBytes = savedStateData ?? toByteArray(emulator.save_state());
      if (!stateBytes) {
        setStatus("no state available");
        return;
      }
      savedStateData = stateBytes;
      if (ui.loadState) ui.loadState.disabled = false;
      triggerDownload(stateBytes, "wasm-save.mdstate", "application/octet-stream");
      setStatus(`state downloaded (${stateBytes.length} bytes)`);
    } catch (error) {
      setStatus(`download failed: ${error}`);
    }
  });
}

if (ui.uploadState) {
  ui.uploadState.addEventListener("click", async () => {
    if (!emulator) return;
    const file = ui.stateFile?.files?.[0];
    if (!file) {
      setStatus("select a state file first");
      return;
    }
    try {
      const stateBytes = new Uint8Array(await file.arrayBuffer());
      emulator.load_state(Array.from(stateBytes));
      savedStateData = stateBytes;
      if (ui.loadState) ui.loadState.disabled = false;
      drawFrame(emulator.get_framebuffer_argb());
      setStatus(`state uploaded: ${file.name}`);
    } catch (error) {
      setStatus(`upload failed: ${error}`);
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target) || event.repeat) return;
  pressed.add(event.code);
  event.preventDefault();
  setButtons();
});

window.addEventListener("keyup", (event) => {
  if (isEditableTarget(event.target)) return;
  pressed.delete(event.code);
  event.preventDefault();
  setButtons();
});

window.addEventListener("blur", () => {
  pressed.clear();
  touchPressed.clear();
  gamepadPressed.clear();
  setButtons();
});

window.addEventListener("gamepadconnected", (event) => {
  if (ui.gamepadStatus) ui.gamepadStatus.textContent = `Gamepad: connected (${event.gamepad.id})`;
});

window.addEventListener("gamepaddisconnected", () => {
  if (ui.gamepadStatus) ui.gamepadStatus.textContent = "Gamepad: disconnected";
});

document.querySelectorAll("[data-btn]").forEach((btn) => {
  const name = btn.dataset.btn;
  const down = () => {
    touchPressed.add(name);
    setButtons();
  };
  const up = () => {
    touchPressed.delete(name);
    setButtons();
  };

  btn.addEventListener("mousedown", down);
  btn.addEventListener("mouseup", up);
  btn.addEventListener("mouseleave", up);
  btn.addEventListener("touchstart", (event) => {
    event.preventDefault();
    down();
  }, { passive: false });
  btn.addEventListener("touchend", (event) => {
    event.preventDefault();
    up();
  }, { passive: false });
  btn.addEventListener("touchcancel", (event) => {
    event.preventDefault();
    up();
  }, { passive: false });
});

document.querySelectorAll("[data-stick='direction']").forEach((stick) => {
  const thumb = stick.querySelector(".stick-thumb");
  const stickDirections = new Set();
  let activePointerId = null;

  const setStickDirections = (nextDirections) => {
    for (const direction of stickDirections) {
      if (!nextDirections.has(direction)) touchPressed.delete(direction);
    }
    for (const direction of nextDirections) {
      touchPressed.add(direction);
    }
    stickDirections.clear();
    nextDirections.forEach((direction) => stickDirections.add(direction));
    setButtons();
  };

  const resetStick = () => {
    activePointerId = null;
    setStickDirections(new Set());
    stick.classList.remove("active");
    if (thumb) thumb.style.transform = "translate(-50%, -50%)";
  };

  const updateStick = (event) => {
    const rect = stick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const threshold = radius * 0.16;
    const inputX = screenRotation === 90 ? rawY : rawX;
    const inputY = screenRotation === 90 ? -rawX : rawY;
    const distance = Math.hypot(inputX, inputY);
    const maxTravel = radius * 0.46;
    const scale = distance > maxTravel ? maxTravel / distance : 1;
    const x = inputX * scale;
    const y = inputY * scale;
    const nextDirections = new Set();

    if (inputX < -threshold) nextDirections.add("left");
    if (inputX > threshold) nextDirections.add("right");
    if (inputY < -threshold) nextDirections.add("up");
    if (inputY > threshold) nextDirections.add("down");

    stick.classList.add("active");
    if (thumb) thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    setStickDirections(nextDirections);
  };

  stick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activePointerId = event.pointerId;
    stick.setPointerCapture?.(event.pointerId);
    updateStick(event);
  });
  stick.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    updateStick(event);
  });
  stick.addEventListener("pointerup", (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    resetStick();
  });
  stick.addEventListener("pointercancel", (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    resetStick();
  });
});

setupDragAndDrop();
setupPwa();
updateRomInfoPanel();
initializeWasm().finally(() => {
  setupBundledRomList();
});

// ページ離脱前に SRAM を保存する
window.addEventListener("beforeunload", () => {
  if (emulator && sramRomKey && emulator.has_sram && emulator.has_sram()) {
    autoSaveSram().catch(() => {});
  }
});
