# Bundled Mega Drive Emulator

MD Game Editor ships a snapshot of the Mega Drive WASM emulator inside the
`standard-emulator` plugin. The editor repository does not build the emulator
core by default.

## Tracked Files

The bundled runtime lives in:

- `plugins/standard-emulator/pkg/`
- `plugins/standard-emulator/md-emulator.js`
- `plugins/standard-emulator/md-emulator.d.ts`
- `plugins/standard-emulator/wasm-player.js`
- `plugins/standard-emulator/emulator-build.json`

`emulator-build.json` records:

- source repository path and remote
- source Git commit and dirty state at capture time
- WASM package version
- `build_meta.js` version
- SHA-256 for the bundled WASM, generated JS, and wrapper files

The About dialog shows the package version, build version, source revision, and
WASM binary SHA-256 so packaged builds remain traceable.

## Test Play Frame Pacing

The editor's Test Play page uses
`plugins/standard-emulator/testplay-emulator.js` as a local adapter around the
tracked `md-emulator.js` snapshot. It does not modify the captured wrapper or
its hash:

- a normal 60 Hz display uses `requestAnimationFrame`
- each display update executes at most one Mega Drive frame, so missed frames
  do not create a permanent multi-frame catch-up loop
- if browser VSync remains below 50 Hz while one emulator frame is comfortably
  below budget, Test Play switches to a drift-corrected 60 Hz timer
- if emulator work itself exceeds the frame budget, frames are not skipped and
  normal hardware-style slowdown remains visible
- keyboard and gamepad state are sampled independently at 60 Hz

The Test Play status bar reports update fps, emulation fps, and the detected
VSync rate when the timer fallback is active. A physical display or remote
desktop session below 60 Hz still cannot show 60 distinct scanouts, even though
the game clock and canvas updates continue at 60 fps.

Run the Electron/WASM pacing check against a built ROM with:

```bash
npm run verify:standard-emulator-fps -- path/to/rom.bin 5000
npm run verify:standard-emulator-fps -- path/to/rom.bin 5000 --start
```

## Refreshing The Bundle

Build the emulator in the MD emulator repository first:

```bash
cd /path/to/md_emulator
npm run wasm:build:release
```

Then refresh the editor bundle:

```bash
cd /path/to/md-game-editor
MD_EMULATOR_REPO=/path/to/md_emulator npm run copy-pkg
```

Without `MD_EMULATOR_REPO`, `npm run copy-pkg` only verifies that the bundled
runtime files are present. This keeps `npm start` and `npm run prepare:dist`
usable even when the emulator repository is not checked out next to the editor.

## API Emulator

The split editor repository does not build `md-api`. The `standard-api-emulator`
plugin can still be used if a platform-specific `md-api` binary is placed under:

```text
plugins/standard-api-emulator/bin/md-api
plugins/standard-api-emulator/bin/md-api.exe
```

For the default Test Play path, use the bundled `standard-emulator` WASM plugin.
