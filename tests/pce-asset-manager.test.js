'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadAssetManager(userData = makeTempDir('pce-assets-user-data-')) {
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-asset-manager.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-assets-home-') },
  });
}

function makePngDataUrl(width = 16, height = 16) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(16);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return `data:image/png;base64,${Buffer.concat([signature, ihdr, Buffer.alloc(8)]).toString('base64')}`;
}

function makeWavBuffer(sampleRate = 8000, frames = 32) {
  const dataSize = frames * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(i % 2 ? 12000 : -12000, 44 + (i * 2));
  }
  return buffer;
}

function writeFile(projectDir, relativePath, bytes) {
  const absPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

test('PCE asset schema supports BG image, sprite, generated metadata, and legacy mosaic', () => {
  const assetManager = loadAssetManager();
  const image = assetManager.normalizeAsset({
    id: 'title-bg',
    type: 'image',
    name: 'Title BG',
    source: 'assets/images/title.png',
    options: { paletteBank: 2, tileBase: 64 },
    data: {
      generated: {
        paletteFile: 'assets/generated/title-bg/palette.bin',
        tilesFile: 'assets/generated/title-bg/tiles.bin',
        mapFile: 'assets/generated/title-bg/map.bin',
        previewFile: 'assets/generated/title-bg/preview.json',
        tileCount: 12,
        paletteCount: 2,
        vramBytes: 512,
        warnings: ['ok'],
      },
    },
  });
  const sprite = assetManager.normalizeAsset({
    id: 'hero',
    type: 'sprite',
    source: 'assets/sprites/hero.png',
    options: { cellWidth: 32, cellHeight: 64, paletteBank: 1 },
  });
  const psg = assetManager.normalizeAsset({ id: 'old-beep', type: 'psg-sequence', options: { period: 384 } });
  const adpcm = assetManager.normalizeAsset({ id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', options: { sampleRate: 12000 } });
  const cdda = assetManager.normalizeAsset({ id: 'track', type: 'cdda-track', source: 'assets/cdda/track.wav', options: { track: 3 } });

  assert.equal(image.options.kind, 'background');
  assert.equal(image.options.cellWidth, 8);
  assert.equal(image.data.generated.tileCount, 12);
  assert.equal(sprite.options.kind, 'sprite');
  assert.equal(sprite.options.cellWidth, 32);
  assert.equal(sprite.options.cellHeight, 64);
  assert.equal(psg.type, 'psg-sfx');
  assert.equal(psg.options.period, 384);
  assert.equal(adpcm.options.sampleRate, 12000);
  assert.equal(cdda.options.track, 3);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: '/tmp/bad.png' }), /project relative/);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: 'C:\\bad\\asset.png' }), /project relative/);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: '../bad.png' }), /project relative/);
});

test('PCE audio import converts WAV into ADPCM and CD-DA assets', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-audio-');
  const source = path.join(makeTempDir('pce-assets-audio-source-'), 'voice.wav');
  fs.writeFileSync(source, makeWavBuffer());

  const adpcm = assetManager.importAudio(projectDir, {
    sourcePath: source,
    sourceFileName: 'voice.wav',
    kind: 'adpcm',
    id: 'voice',
    sampleRate: 12000,
  });
  const cdda = assetManager.importAudio(projectDir, {
    sourcePath: source,
    sourceFileName: 'track.wav',
    kind: 'cdda-track',
    id: 'track',
    track: 4,
  });

  assert.equal(adpcm.asset.type, 'adpcm');
  assert.equal(adpcm.asset.options.sampleRate, 12000);
  assert.match(adpcm.asset.data.generated.outputFile, /adpcm\.bin$/);
  assert.equal(fs.existsSync(path.join(projectDir, adpcm.asset.data.generated.outputFile)), true);
  assert.equal(cdda.asset.type, 'cdda-track');
  assert.equal(cdda.asset.options.track, 4);
  assert.match(cdda.asset.data.generated.outputFile, /cdda\.wav$/);
  assert.equal(fs.existsSync(path.join(projectDir, cdda.asset.data.generated.outputFile)), true);
});

test('PCE image import constructs SuperFamiconv commands for BG and sprites', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-import-');
  const bg = assetManager.importImage(projectDir, {
    sourceFileName: 'title.png',
    convertedDataUrl: makePngDataUrl(32, 16),
    kind: 'background',
    id: 'title',
    tileBase: 48,
  }, { dryRun: true, superfamiconvPath: '/tools/superfamiconv' });
  const sprite = assetManager.importImage(projectDir, {
    sourceFileName: 'hero.bmp',
    convertedDataUrl: makePngDataUrl(32, 32),
    kind: 'sprite',
    id: 'hero',
    cellWidth: 32,
    cellHeight: 32,
  }, { dryRun: true, superfamiconvPath: '/tools/superfamiconv' });

  assert.equal(bg.asset.type, 'image');
  assert.equal(bg.commandInfo.mode, 'pce');
  assert.ok(bg.commandInfo.args.includes('-M'));
  assert.ok(bg.commandInfo.args.includes('pce'));
  assert.ok(bg.commandInfo.args.includes('--out-map'));
  assert.ok(bg.commandInfo.args.includes('-P'));
  assert.equal(sprite.asset.type, 'sprite');
  assert.equal(sprite.commandInfo.mode, 'pce_sprite');
  assert.ok(sprite.commandInfo.args.includes('pce_sprite'));
  assert.notEqual(sprite.commandInfo.args.indexOf('-S'), -1);
  assert.match(sprite.asset.source, /^assets\/sprites\/hero\.png$/);
});

test('PCE asset manager rejects missing SuperFamiconv for real imports', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-missing-tool-');

  assert.throws(() => assetManager.importImage(projectDir, {
    sourceFileName: 'title.png',
    convertedDataUrl: makePngDataUrl(16, 16),
    kind: 'background',
    id: 'title',
  }), /SuperFamiconv/);
});

test('PCE asset preview and reorder stay inside project root', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-safety-');
  writeFile(projectDir, 'assets/images/title.png', Buffer.from([137, 80, 78, 71]));
  assetManager.writeAssetDocument(projectDir, {
    version: 1,
    assets: [
      { id: 'a', type: 'image', source: 'assets/images/title.png' },
      { id: 'b', type: 'sprite', source: 'assets/images/title.png' },
    ],
  });

  assert.equal(assetManager.previewSource(projectDir, 'assets/images/title.png').mime, 'image/png');
  assert.throws(() => assetManager.previewSource(projectDir, '../outside.png'), /project/);
  assert.throws(() => assetManager.previewSource(projectDir, '/tmp/outside.png'), /project/);

  const outsideDir = makeTempDir('pce-assets-outside-');
  const outsideFile = path.join(outsideDir, 'outside.png');
  fs.writeFileSync(outsideFile, Buffer.from([1, 2, 3]));
  fs.mkdirSync(path.join(projectDir, 'assets', 'links'), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(projectDir, 'assets', 'links', 'outside.png'));
    assert.throws(() => assetManager.previewSource(projectDir, 'assets/links/outside.png'), /escapes root/);
  } catch (err) {
    if (!['EPERM', 'EACCES'].includes(err.code)) throw err;
  }

  const reordered = assetManager.reorderAssets(projectDir, ['b', 'a']);
  assert.deepEqual(reordered.assets.map((asset) => asset.id), ['b', 'a']);
});

test('PCE generated assets emit BG and sprite C arrays plus legacy fallback', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-generate-');
  writeFile(projectDir, 'assets/generated/bg/palette.bin', Buffer.alloc(32, 0x07));
  writeFile(projectDir, 'assets/generated/bg/tiles.bin', Buffer.alloc(64, 0x11));
  writeFile(projectDir, 'assets/generated/bg/map.bin', Buffer.alloc(8, 0x22));
  writeFile(projectDir, 'assets/generated/spr/palette.bin', Buffer.alloc(32, 0x03));
  writeFile(projectDir, 'assets/generated/spr/patterns.bin', Buffer.alloc(128, 0x44));
  assetManager.writeAssetDocument(projectDir, {
    version: 1,
    assets: [
      {
        id: 'bg',
        type: 'image',
        source: 'assets/images/bg.png',
        options: { width: 16, height: 16, tileBase: 32, mapBase: 0 },
        data: {
          generated: {
            paletteFile: 'assets/generated/bg/palette.bin',
            tilesFile: 'assets/generated/bg/tiles.bin',
            mapFile: 'assets/generated/bg/map.bin',
            tileCount: 2,
            paletteCount: 1,
            vramBytes: 72,
          },
        },
      },
      {
        id: 'spr',
        type: 'sprite',
        source: 'assets/sprites/spr.png',
        options: { width: 16, height: 16, cellWidth: 16, cellHeight: 16, tileBase: 384 },
        data: {
          generated: {
            paletteFile: 'assets/generated/spr/palette.bin',
            tilesFile: 'assets/generated/spr/patterns.bin',
            tileCount: 1,
            paletteCount: 1,
            vramBytes: 128,
          },
        },
      },
      {
        id: 'beep',
        type: 'psg-sfx',
        source: '',
        options: {
          period: 512,
          bpm: 150,
          steps: 16,
          pattern: [
            { step: 0, channel: 0, period: 512, volume: 20 },
            { step: 2, channel: 1, period: 1024, volume: 12 },
          ],
        },
      },
      {
        id: 'voice',
        type: 'adpcm',
        source: 'assets/adpcm/voice.wav',
        options: { sampleRate: 16000 },
        data: {
          generated: {
            outputFile: 'assets/generated/voice/adpcm.bin',
            byteLength: 4,
            sampleRate: 16000,
          },
        },
      },
      {
        id: 'track',
        type: 'cdda-track',
        source: 'assets/cdda/track.wav',
        options: { track: 2 },
      },
    ],
  });
  writeFile(projectDir, 'assets/generated/voice/adpcm.bin', Buffer.from([1, 2, 3, 4]));

  const result = assetManager.generateAssetSources(projectDir);
  const header = fs.readFileSync(result.headerPath, 'utf-8');
  const source = fs.readFileSync(result.sourcePath, 'utf-8');

  assert.equal(result.bgCount, 1);
  assert.equal(result.spriteCount, 1);
  assert.match(header, /pce_editor_bg_asset_t/);
  assert.match(header, /pce_editor_sprite_asset_t/);
  assert.match(header, /pce_editor_psg_asset_t/);
  assert.match(header, /pce_editor_adpcm_asset_t/);
  assert.match(header, /pce_editor_cdda_asset_t/);
  assert.match(source, /static const unsigned char pce_editor_image_bg_palette\[\]/);
  assert.match(source, /static const unsigned char pce_editor_sprite_spr_patterns\[\]/);
  assert.match(source, /static const pce_editor_psg_step_t pce_editor_psg_beep_pattern\[\]/);
  assert.match(source, /static const unsigned char pce_editor_adpcm_voice_data\[\]/);
  assert.match(source, /const unsigned char pce_editor_bg_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_sprite_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_psg_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_adpcm_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_cdda_asset_count = 1/);
  assert.match(source, /pce_editor_image_rows/);
});

test('PCE sample template registers slideshow images and PSG BGM assets', () => {
  const templateDir = path.join(__dirname, '..', 'template', 'template_pce_sample');
  const doc = JSON.parse(fs.readFileSync(path.join(templateDir, 'assets', 'pce-assets.json'), 'utf-8'));
  const slides = doc.assets.filter((entry) => entry.type === 'image' && entry.id.startsWith('slide_'));
  const bgm = doc.assets.find((entry) => entry.id === 'slideshow_bgm');

  assert.equal(doc.version, 2);
  assert.equal(slides.length, 5);
  assert.ok(slides.every((asset) => asset.options.kind === 'background'));
  assert.ok(slides.every((asset) => asset.options.width === 256 && asset.options.height === 224));
  assert.ok(slides.every((asset) => asset.options.tileBase === 64 && asset.options.mapBase === 0));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.source))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.paletteFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.tilesFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.mapFile))));
  assert.ok(bgm);
  assert.equal(bgm.type, 'psg-song');
  assert.equal(bgm.options.kind, 'song');
  assert.ok(bgm.options.pattern.length >= 32);
  const sampleMain = fs.readFileSync(path.join(templateDir, 'src', 'main.c'), 'utf-8');
  assert.match(sampleMain, /show_slide/);
  assert.match(sampleMain, /apply_bg_palette_level/);
  assert.match(sampleMain, /bgm_tick/);
  assert.match(sampleMain, /PCE_VDC_CR_VRAM_ADD_1/);
  assert.match(sampleMain, /pce_editor_vdc_write\(5,\s*PCE_VDC_CR_BG_ENABLE \| PCE_VDC_CR_DRAM_REFRESH \| PCE_VDC_CR_VRAM_ADD_1\)/);

  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-slideshow-template-');
  fs.cpSync(templateDir, projectDir, { recursive: true });
  const generated = assetManager.generateAssetSources(projectDir);
  const generatedSource = fs.readFileSync(generated.sourcePath, 'utf-8');
  const generatedHeader = fs.readFileSync(generated.headerPath, 'utf-8');
  assert.equal(generated.bgCount, 5);
  assert.match(generatedHeader, /pce_editor_data_ref_t/);
  assert.match(generatedSource, /PCE_ROM_BANK_AT\(1, 6\)/);
  assert.ok(generatedSource.includes('PCE_EDITOR_BANKED_SECTION(".rom_bank1")'));
  assert.match(generatedSource, /pce_editor_image_slide_01_seaside_tiles_chunks/);
  assert.match(generatedSource, /pce_editor_map_asset_bank/);
});
