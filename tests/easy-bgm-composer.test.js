'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.join(__dirname, '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'easy-bgm-composer');
const manifest = require(path.join(pluginRoot, 'manifest.json'));
const plugin = require(pluginRoot);
const composeCore = require(path.join(pluginRoot, 'compose-core'));
const vgmRender = require(path.join(pluginRoot, 'vgm-render'));
const service = require(path.join(pluginRoot, 'easy-bgm-service'));
const mdAudio = require(path.join(repoRoot, 'plugins', 'shared', 'md-audio-engine'));

const rendererPath = path.join(pluginRoot, manifest.renderer.entry);

function stripVolatile(song) {
  const data = JSON.parse(JSON.stringify(song));
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  return data;
}

function validateNotes(notes, maxStep, label) {
  assert.ok(Array.isArray(notes), `${label} must be an array`);
  let prevEnd = -1;
  let prevStep = -1;
  for (const note of notes) {
    assert.ok(note && typeof note === 'object', `${label} note must be object`);
    assert.ok(Number.isInteger(note.step), `${label} step must be integer`);
    assert.ok(note.step >= 0 && note.step < maxStep, `${label} step in range`);
    assert.ok(Number.isInteger(note.length) && note.length >= 1, `${label} length >= 1`);
    assert.ok(note.step + note.length <= maxStep, `${label} note fits in song`);
    assert.ok(note.step > prevStep, `${label} sorted, unique steps`);
    assert.ok(note.step >= prevEnd, `${label} no time overlap`);
    assert.ok(Number.isInteger(note.midiNote), `${label} midiNote integer`);
    prevStep = note.step;
    prevEnd = note.step + note.length;
  }
}

function validateDrumSteps(steps, maxStep, label) {
  assert.ok(Array.isArray(steps), `${label} must be an array`);
  let prev = -1;
  for (const step of steps) {
    assert.ok(Number.isInteger(step), `${label} step must be integer`);
    assert.ok(step >= 0 && step < maxStep, `${label} step in range`);
    assert.ok(step > prev, `${label} sorted unique`);
    prev = step;
  }
}

test('manifest and renderer consistency', () => {
  assert.deepStrictEqual(manifest.types, ['editor']);
  assert.ok(Array.isArray(manifest.supportedCores));
  assert.ok(manifest.supportedCores.includes('mega-drive'));
  assert.ok(Array.isArray(manifest.dependencies));
  assert.ok(manifest.dependencies.includes('midi-converter'));

  assert.ok(Array.isArray(manifest.mainApi?.hooks));
  assert.ok(manifest.mainApi.hooks.every((hook) => manifest.hooks.includes(hook)));

  const exportNames = Object.keys(plugin);
  manifest.hooks.forEach((hook) => {
    assert.ok(exportNames.includes(hook), `index.js should export hook ${hook}`);
    assert.strictEqual(typeof plugin[hook], 'function', `${hook} must be a function`);
  });

  assert.strictEqual(typeof manifest.renderer?.entry, 'string');
  assert.ok(fs.existsSync(rendererPath));
  for (const style of manifest.renderer.styles || []) {
    assert.ok(fs.existsSync(path.join(pluginRoot, style)), `missing renderer style: ${style}`);
  }
  assert.strictEqual(manifest.renderer.page, manifest.tab.page);

  const rendererSource = fs.readFileSync(rendererPath, 'utf8');
  assert.ok(
    rendererSource.includes("registerCapability('easy-bgm-composer'")
      || rendererSource.includes('registerCapability("easy-bgm-composer"'),
  );
  assert.ok(rendererSource.includes('MutationObserver'));
});

test('composeEasySong is deterministic by seed', () => {
  const payload = { themeId: 'bright', bars: 16, options: { seed: 202406 } };
  const a = plugin.composeEasySong(payload, {});
  const b = plugin.composeEasySong(payload, {});
  assert.ok(a.ok && b.ok);
  assert.deepStrictEqual(stripVolatile(a.song), stripVolatile(b.song));

  const c = plugin.composeEasySong({ ...payload, options: { seed: 202407 } }, {});
  assert.ok(c.ok);
  assert.notDeepStrictEqual(stripVolatile(a.song), stripVolatile(c.song));
});

test('composed song validity across themes and bars', () => {
  const themes = ['bright', 'sad', 'wafu', 'lastboss'];
  const barsList = [2, 8, 16, 32];

  for (const themeId of themes) {
    for (const bars of barsList) {
      const result = plugin.composeEasySong({ themeId, bars, options: { seed: 1234 + bars } }, {});
      assert.ok(result.ok, `compose ok for ${themeId}/${bars}`);
      const song = result.song;
      const maxStep = bars * composeCore.STEPS_PER_BAR;

      assert.strictEqual(song.themeId, themeId);
      assert.strictEqual(song.bars, bars);
      assert.strictEqual(typeof song.tempo, 'number');
      assert.strictEqual(song.chords.length, bars);
      song.chords.forEach((chord, index) => {
        assert.strictEqual(chord.bar, index);
        assert.ok(Array.isArray(chord.tones) && chord.tones.length >= 3);
        assert.strictEqual(typeof chord.symbol, 'string');
      });

      const sectionSum = song.sections.reduce((sum, section) => sum + section.bars, 0);
      assert.strictEqual(sectionSum, bars, `sections tile ${themeId}/${bars}`);
      assert.strictEqual(song.sections[0].startBar, 0);

      validateNotes(song.tracks.lead, maxStep, `${themeId}/${bars} lead`);
      validateNotes(song.tracks.harmony, maxStep, `${themeId}/${bars} harmony`);
      validateNotes(song.tracks.bass, maxStep, `${themeId}/${bars} bass`);
      assert.ok(song.tracks.lead.length > 0, 'lead should not be empty');
      assert.ok(song.tracks.bass.length > 0, 'bass should not be empty');

      validateDrumSteps(song.drums.kick, maxStep, `${themeId}/${bars} kick`);
      validateDrumSteps(song.drums.snare, maxStep, `${themeId}/${bars} snare`);
      validateDrumSteps(song.drums.hat, maxStep, `${themeId}/${bars} hat`);
      const snareSet = new Set(song.drums.snare);
      song.drums.hat.forEach((step) => {
        assert.ok(!snareSet.has(step), `hat/snare share step ${step} (${themeId}/${bars})`);
      });
    }
  }
});

test('vgm rendering and tracker conversion', () => {
  const result = plugin.composeEasySong({ themeId: 'wafu', bars: 32, tempo: 145, options: { seed: 707 } }, {});
  assert.ok(result.ok);
  const song = { ...result.song, loop: true };

  const loopOn = vgmRender.easySongToVgm(song);
  assert.ok(Buffer.isBuffer(loopOn));
  assert.strictEqual(loopOn.subarray(0, 4).toString('ascii'), 'Vgm ');
  const expectedSamples = Math.round(song.bars * 16 * ((44100 * 60) / song.tempo / 4));
  const diff = Math.abs(loopOn.readUInt32LE(0x18) - expectedSamples);
  assert.ok(diff <= Math.ceil(expectedSamples * 0.01), `total samples ${loopOn.readUInt32LE(0x18)} ~ ${expectedSamples}`);
  assert.notStrictEqual(loopOn.readUInt32LE(0x1c), 0, 'loop offset set when loop=true');

  const loopOff = vgmRender.easySongToVgm({ ...song, loop: false });
  assert.strictEqual(loopOff.readUInt32LE(0x1c), 0, 'no loop offset when loop=false');

  const preview = vgmRender.easySongToPreviewDataUrl(song);
  assert.ok(String(preview.dataUrl).startsWith('data:audio/vgm;base64,'));
  assert.strictEqual(preview.totalSteps, song.bars * 16);
  assert.ok(preview.stepMs > 0);

  const trackerSong = vgmRender.easySongToTrackerSong(song, { symbol: 'test_easy' });
  assert.ok(Array.isArray(trackerSong.patterns));
  assert.strictEqual(trackerSong.patterns.length, Math.max(1, Math.ceil((song.bars * 16) / 64)));
  assert.strictEqual(trackerSong.symbol, 'test_easy');
  assert.strictEqual(trackerSong.metadata.createdBy, 'easy-bgm-composer');

  const normalized = mdAudio.normalizeSong(trackerSong);
  const rendered = mdAudio.writeVgm(normalized);
  assert.ok(Buffer.isBuffer(rendered));
  assert.strictEqual(rendered.subarray(0, 4).toString('ascii'), 'Vgm ');
});

test('mute and solo affect rendered events', () => {
  const result = plugin.composeEasySong({ themeId: 'bright', bars: 4, options: { seed: 55 } }, {});
  assert.ok(result.ok);
  const song = result.song;

  const full = vgmRender.buildTickEvents(song);
  const muted = vgmRender.buildTickEvents({
    ...song,
    mixer: { ...song.mixer, lead: { ...song.mixer.lead, mute: true } },
  });
  const soloBass = vgmRender.buildTickEvents({
    ...song,
    mixer: { ...song.mixer, bass: { ...song.mixer.bass, solo: true } },
  });
  const countOns = (events) => [...events.ons.values()].reduce((sum, list) => sum + list.length, 0);
  assert.ok(countOns(muted) < countOns(full), 'muting lead removes events');
  const soloOnly = [...soloBass.ons.values()].flat();
  assert.ok(soloOnly.every((event) => event.kind === 'fm' && event.fmIndex === vgmRender.TRACK_FM_INDEX.bass));
});

test('easy-bgm-service CRUD roundtrip and export', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-bgm-composer-test-'));
  try {
    const composed = plugin.composeEasySong({ themeId: 'sad', bars: 8, options: { seed: 4001 } }, {});
    assert.ok(composed.ok);
    const song = composed.song;

    const saved = service.saveSong(projectDir, { song });
    assert.ok(saved.ok);
    assert.strictEqual(saved.song.id, song.id);
    assert.ok(fs.existsSync(path.join(projectDir, 'data', 'easy-bgm', 'songs', `${song.id}.json`)));

    const listed = service.listSongs(projectDir);
    assert.ok(listed.ok);
    assert.ok(listed.songs.some((entry) => entry.id === song.id));

    const loaded = service.loadSong(projectDir, { id: song.id });
    assert.ok(loaded.ok);
    assert.strictEqual(loaded.song.bars, song.bars);
    assert.strictEqual(loaded.song.themeId, song.themeId);
    assert.deepStrictEqual(loaded.song.tracks, song.tracks);

    const exported = service.exportToGame(projectDir, { song, symbol: 'Easy BGM Test!' });
    assert.ok(exported.ok);
    assert.strictEqual(exported.symbol, 'easy_bgm_test');
    assert.strictEqual(exported.asset.type, 'XGM2');
    assert.strictEqual(exported.asset.name, exported.symbol);
    assert.strictEqual(exported.asset.sourcePath, `music/${exported.symbol}.vgm`);
    const vgmPath = path.join(projectDir, 'res', 'music', `${exported.symbol}.vgm`);
    const jsonPath = path.join(projectDir, 'res', 'music', `${exported.symbol}.mdbgm.json`);
    assert.ok(fs.existsSync(vgmPath));
    assert.ok(fs.existsSync(jsonPath));
    assert.strictEqual(fs.readFileSync(vgmPath).subarray(0, 4).toString('ascii'), 'Vgm ');
    const sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    assert.strictEqual(sidecar.metadata.createdBy, 'easy-bgm-composer');

    const deleted = service.deleteSong(projectDir, { id: song.id });
    assert.ok(deleted.ok);
    const listedAfter = service.listSongs(projectDir);
    assert.ok(listedAfter.ok);
    assert.ok(!listedAfter.songs.some((entry) => entry.id === song.id));

    assert.throws(() => service.ensureProjectPath(projectDir, '../evil'));
    const badId = service.loadSong(projectDir, { id: '../evil' });
    assert.strictEqual(badId.ok, false);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('compose-core exports and defs', () => {
  assert.strictEqual(typeof composeCore.composeEasySong, 'function');
  assert.ok(Array.isArray(composeCore.TRACK_IDS));
  assert.ok(Array.isArray(composeCore.DRUM_IDS));

  const defs = composeCore.getDefs();
  assert.ok(Array.isArray(defs.themes) && defs.themes.length >= 18);
  assert.ok(defs.themes.every((theme) => theme.id && theme.label && theme.defaultAttributes));
  assert.ok(Array.isArray(defs.chordPresets) && defs.chordPresets.length >= 10);
  assert.ok(Array.isArray(defs.attributeDefs) && defs.attributeDefs.length === 7);
  assert.deepStrictEqual(defs.barChoices, [2, 4, 8, 16, 32]);
  assert.ok(defs.qualityIntervals.maj && defs.qualityIntervals.min);

  const victory = plugin.composeEasySong({ themeId: 'victory', bars: 2, options: { seed: 9 } }, {});
  assert.ok(victory.ok);
  assert.strictEqual(victory.song.loop, false, 'jingle themes default to loop=false');
});
