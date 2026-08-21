'use strict';

const crypto = require('crypto');
const { normalizeFontSettings } = require('./novel-font');

const SCHEMA_VERSION = 1;
const PCE_SCENE_VERSION = 2;
const VISUAL_CONVERTER_VERSION = 3;
const RESERVED_VARIABLES = Object.freeze(['AUTO_ENABLE', 'MSG_SPEED']);
const PALETTE_NAMES = Object.freeze(['PAL0', 'PAL1', 'PAL2', 'PAL3']);
const NEW_SPRITE_PALETTES = Object.freeze(['PAL1', 'PAL2', 'PAL3', 'PAL3']);
const KNOWN_COMMANDS = new Set([
  'background',
  'sprite',
  'spritemove',
  'message',
  'audio',
  'cache',
  'variable',
  'choice',
  'if',
  'switch',
  'label',
  'goto',
  'inputcheck',
  'jump',
  'wait',
  'effect',
  'spritetext',
  'comment',
]);

const ASSET_REFERENCE_FIELDS = Object.freeze({
  background: [['assetId', 'image']],
  sprite: [['assetId', 'sprite']],
  spritemove: [['animationAssetId', 'sprite']],
  message: [['voiceAssetId', 'voice']],
  audio: [['assetId', 'audio']],
  cache: [['assetId', 'cache']],
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    result[key] = stableValue(value[key]);
  });
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashDocument(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stringValue(value) {
  return value == null ? '' : String(value);
}

function glyphLength(value) {
  return Array.from(stringValue(value)).length;
}

function makeDiagnostic(severity, code, path, message, details = {}) {
  return { severity, code, path, message, ...details };
}

function commandPath(sceneIndex, commandIndex, field = '') {
  return `scenes[${sceneIndex}].commands[${commandIndex}]${field ? `.${field}` : ''}`;
}

function isSkippedCommand(command) {
  return Boolean(command?.skip) || command?.type === 'comment';
}

function normalizedPalette(value) {
  const palette = stringValue(value).trim().toUpperCase();
  return PALETTE_NAMES.includes(palette) ? palette : '';
}

function paletteIndex(value) {
  const palette = normalizedPalette(value);
  return palette ? PALETTE_NAMES.indexOf(palette) : -1;
}

function paletteProfile(value) {
  return normalizedPalette(value) === 'PAL0' ? 'pal0-reserved' : 'general';
}

function newCommandPalette(commandType, slot = 0) {
  if (commandType === 'background') return 'PAL0';
  if (commandType === 'sprite') return NEW_SPRITE_PALETTES[Math.max(0, Math.min(3, Number(slot) || 0))];
  return '';
}

function resolveCommandPalette(command, binding = null) {
  const explicit = normalizedPalette(command?.palette);
  if (explicit) return explicit;
  const legacy = normalizedPalette(binding?.legacyPalette || binding?.palette);
  if (legacy) return legacy;
  if (command?.type === 'background') return 'PAL1';
  if (command?.type === 'sprite') return 'PAL2';
  return '';
}

function collectVisualPaletteRequirements(sceneDocument, bindings = null) {
  const assets = new Map();
  for (const [sceneIndex, scene] of (sceneDocument?.scenes || []).entries()) {
    for (const [commandIndex, command] of (scene?.commands || []).entries()) {
      if (!command || isSkippedCommand(command) || !['background', 'sprite'].includes(command.type)) continue;
      const assetId = stringValue(command.assetId).trim();
      if (!assetId) continue;
      const palette = resolveCommandPalette(command, bindings?.assets?.[assetId]);
      if (!assets.has(assetId)) assets.set(assetId, { assetId, palettes: new Set(), profiles: new Set(), references: [] });
      const requirement = assets.get(assetId);
      requirement.palettes.add(palette);
      requirement.profiles.add(paletteProfile(palette));
      requirement.references.push({ sceneId: stringValue(scene.id), sceneIndex, commandIndex, commandType: command.type, palette });
    }
  }
  return assets;
}
function assetTypeMatches(assetType, expected) {
  if (expected === 'image') return assetType === 'image';
  if (expected === 'sprite') return assetType === 'sprite';
  if (expected === 'voice') return assetType === 'adpcm';
  if (expected === 'audio') return ['psg-song', 'psg-sfx', 'adpcm', 'cdda-track'].includes(assetType);
  return true;
}

function collectCatalog(catalog) {
  const assets = Array.isArray(catalog?.assets) ? catalog.assets : [];
  const byId = new Map();
  const duplicates = [];
  assets.forEach((asset, index) => {
    const id = stringValue(asset?.id).trim();
    if (!id) return;
    if (byId.has(id)) duplicates.push({ id, first: byId.get(id).index, second: index });
    else byId.set(id, { ...asset, index });
  });
  return { assets, byId, duplicates };
}

function collectReferences(sceneDocument) {
  const references = [];
  for (const [sceneIndex, scene] of (sceneDocument?.scenes || []).entries()) {
    for (const [commandIndex, command] of (scene?.commands || []).entries()) {
      if (!isPlainObject(command) || command.skip === true) continue;
      const fields = ASSET_REFERENCE_FIELDS[command.type] || [];
      for (const [field, expectedType] of fields) {
        const assetId = stringValue(command[field]).trim();
        if (!assetId) continue;
        if (command.type === 'audio' && stringValue(command.action || 'play') === 'stop') continue;
        if (command.type === 'cache' && stringValue(command.action || 'load') !== 'load') continue;
        references.push({
          sceneId: stringValue(scene.id),
          sceneIndex,
          commandIndex,
          commandType: command.type,
          field,
          expectedType,
          assetId,
          path: commandPath(sceneIndex, commandIndex, field),
          channel: Math.max(0, Math.min(5, Number(command.channel) || 0)),
        });
      }
    }
  }
  return references;
}

function collectPsgVariants(sceneDocument, catalogById) {
  const variants = new Map();
  for (const ref of collectReferences(sceneDocument)) {
    if (ref.commandType !== 'audio') continue;
    const asset = catalogById.get(ref.assetId);
    if (!asset || !['psg-song', 'psg-sfx'].includes(asset.type)) continue;
    const key = `${ref.assetId}@${ref.channel}`;
    if (!variants.has(key)) {
      variants.set(key, {
        key,
        assetId: ref.assetId,
        channel: ref.channel,
        sourceType: asset.type,
        references: [],
      });
    }
    variants.get(key).references.push({ sceneId: ref.sceneId, commandIndex: ref.commandIndex });
  }
  return variants;
}

function collectVariables(sceneDocument) {
  const names = [...RESERVED_VARIABLES];
  const seen = new Set(names);
  const add = (value) => {
    const name = stringValue(value).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const scene of sceneDocument?.scenes || []) {
    for (const command of scene?.commands || []) {
      if (!command || command.skip === true) continue;
      if (command.type === 'variable' || command.type === 'choice' || command.type === 'if') {
        add(command.variableName || command.name || command.variable);
      }
      if (command.type === 'switch') add(command.variableName || command.name || command.variable);
    }
  }
  return names;
}

function validateSceneDocument(sceneDocument, catalog = null, options = {}) {
  const errors = [];
  const warnings = [];
  const diagnostics = [];
  const push = (severity, code, path, message, details) => {
    const entry = makeDiagnostic(severity, code, path, message, details);
    diagnostics.push(entry);
    (severity === 'error' ? errors : warnings).push(entry);
  };

  if (!isPlainObject(sceneDocument)) {
    push('error', 'scene-document-invalid', '', 'scene document must be an object');
    return { ok: false, errors, warnings, diagnostics, references: [], variables: [...RESERVED_VARIABLES] };
  }

  const version = Number(sceneDocument.version);
  if (!Number.isInteger(version) || version < 1) {
    push('error', 'scene-version-invalid', 'version', 'scene version must be a positive integer');
  } else if (version > PCE_SCENE_VERSION) {
    push('error', 'scene-version-newer', 'version', `scene version ${version} is newer than supported version ${PCE_SCENE_VERSION}`);
  }

  const scenes = Array.isArray(sceneDocument.scenes) ? sceneDocument.scenes : [];
  if (!Array.isArray(sceneDocument.scenes)) {
    push('error', 'scenes-missing', 'scenes', 'scenes must be an array');
  }
  if (scenes.length < 1) push('error', 'scenes-empty', 'scenes', 'at least one scene is required');
  if (scenes.length > 255) push('error', 'scene-count-overflow', 'scenes', 'scene count exceeds 255');

  const sceneIds = new Map();
  scenes.forEach((scene, sceneIndex) => {
    if (!isPlainObject(scene)) {
      push('error', 'scene-invalid', `scenes[${sceneIndex}]`, 'scene must be an object');
      return;
    }
    const id = stringValue(scene.id).trim();
    if (!id) push('error', 'scene-id-empty', `scenes[${sceneIndex}].id`, 'scene id is required');
    else if (sceneIds.has(id)) {
      push('error', 'scene-id-duplicate', `scenes[${sceneIndex}].id`, `duplicate scene id: ${id}`);
    } else sceneIds.set(id, sceneIndex);

    const commands = Array.isArray(scene.commands) ? scene.commands : [];
    if (!Array.isArray(scene.commands)) {
      push('error', 'commands-invalid', `scenes[${sceneIndex}].commands`, 'commands must be an array');
      return;
    }
    const emittedCount = commands.filter((command) => !isSkippedCommand(command)).length;
    if (emittedCount > 255) {
      push('error', 'command-count-overflow', `scenes[${sceneIndex}].commands`, `${id || sceneIndex} emits ${emittedCount} commands; maximum is 255`);
    }

    const labels = new Map();
    commands.forEach((command, commandIndex) => {
      const path = commandPath(sceneIndex, commandIndex);
      if (!isPlainObject(command)) {
        push('error', 'command-invalid', path, 'command must be an object');
        return;
      }
      const type = stringValue(command.type).trim();
      if (!KNOWN_COMMANDS.has(type)) {
        push('error', 'command-unknown', `${path}.type`, `unknown command type: ${type || '(empty)'}`);
        return;
      }
      if (type === 'label') {
        const name = stringValue(command.name || command.label || command.labelId).trim();
        if (!name) push('error', 'label-empty', path, 'label name is required');
        else if (labels.has(name)) push('warning', 'label-duplicate', path, `duplicate label uses first definition: ${name}`);
        else labels.set(name, commandIndex);
      }

      if (type === 'background' || type === 'sprite') {
        const rawPalette = stringValue(command.palette).trim();
        if (rawPalette && !normalizedPalette(rawPalette)) push('error', 'palette-invalid', `${path}.palette`, 'palette must be PAL0, PAL1, PAL2, or PAL3');
      }
      if (type === 'background' || type === 'sprite' || type === 'spritemove' || type === 'spritetext') {
        const x = Number(command.x);
        const y = Number(command.y);
        if (Number.isFinite(x) && (x < 0 || x > 319)) push('error', 'coordinate-x-range', `${path}.x`, 'x must be in range 0..319');
        if (Number.isFinite(y) && (y < 0 || y > 223)) push('error', 'coordinate-y-range', `${path}.y`, 'y must be in range 0..223');
      }
      if (['sprite', 'spritemove', 'spritetext'].includes(type)) {
        const slot = Number(command.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot > 3) push('error', 'slot-range', `${path}.slot`, 'slot must be in range 0..3');
      }
      if (type === 'message') {
        if (glyphLength(command.text) > 96) push('error', 'message-text-overflow', `${path}.text`, 'message text exceeds 96 Unicode characters');
        if (glyphLength(command.speaker) > 16) push('error', 'message-speaker-overflow', `${path}.speaker`, 'speaker exceeds 16 Unicode characters');
        if (stringValue(command.voiceAssetId).trim()) {
          push('warning', 'voice-ignored', `${path}.voiceAssetId`, 'ADPCM voice is preserved but ignored by the Mega Drive profile');
        }
      }
      if (type === 'choice') {
        const choices = Array.isArray(command.choices) ? command.choices : [];
        if (choices.length < 1 || choices.length > 4) push('error', 'choice-count', `${path}.choices`, 'choice requires 1..4 options');
        choices.forEach((choice, choiceIndex) => {
          if (glyphLength(choice?.label) > 24) push('error', 'choice-label-overflow', `${path}.choices[${choiceIndex}].label`, 'choice label exceeds 24 Unicode characters');
          if (glyphLength(choice?.label) > 17) push('warning', 'choice-label-clipped', `${path}.choices[${choiceIndex}].label`, 'Mega Drive window displays the first 17 characters');
        });
      }
      if (type === 'switch') {
        const cases = Array.isArray(command.cases) ? command.cases : [];
        if (cases.length > 16) push('error', 'switch-case-overflow', `${path}.cases`, 'switch supports at most 16 cases');
      }
      if (type === 'wait' || type === 'spritemove') {
        const frames = Number(command.frames);
        if (Number.isFinite(frames) && (frames < 0 || frames > 65535)) push('error', 'frame-range', `${path}.frames`, 'frames must be in range 0..65535');
      }
      if (type === 'spritetext' && glyphLength(command.text) > 32) {
        push('warning', 'spritetext-clipped', `${path}.text`, 'SpriteText preserves the raw text but the Mega Drive renderer uses the first 32 characters');
      }
      if (type === 'spritetext' && stringValue(command.color).trim() && stringValue(command.color).toLowerCase() !== '#ffffff') {
        push('warning', 'spritetext-color-ignored', `${path}.color`, 'SpriteText color is preserved but the Mega Drive renderer always uses PAL0 index 1 (white)');
      }
      if (type === 'cache') {
        push('warning', 'cache-noop', path, 'PCE cache command is a zero-time no-op on Mega Drive');
      }
      if (type === 'audio') {
        const kind = stringValue(command.kind || 'psg').toLowerCase();
        if (['cdda', 'adpcm'].includes(kind)) {
          push('warning', 'audio-ignored', path, `${kind.toUpperCase()} command is preserved but ignored by the Mega Drive profile`);
        } else if (kind !== 'psg') {
          push('error', 'audio-kind-unknown', `${path}.kind`, `unsupported audio kind: ${kind}`);
        }
      }
      if (type === 'inputcheck') {
        const mode = stringValue(command.mode || 'sync').toLowerCase();
        if (!['sync', 'async', 'cancel'].includes(mode)) push('error', 'input-mode-unknown', `${path}.mode`, `unknown input mode: ${mode}`);
        const allowed = new Set(['up', 'down', 'left', 'right', 'run', 'i', 'ii']);
        for (const [buttonIndex, button] of (Array.isArray(command.buttons) ? command.buttons : []).entries()) {
          if (!allowed.has(stringValue(button).toLowerCase())) {
            push('error', 'input-button-unknown', `${path}.buttons[${buttonIndex}]`, `unknown input button: ${button}`);
          }
        }
      }
    });
  });

  const startScene = stringValue(sceneDocument.startScene).trim();
  if (!startScene || !sceneIds.has(startScene)) {
    push('error', 'start-scene-missing', 'startScene', `startScene does not resolve: ${startScene || '(empty)'}`);
  }

  scenes.forEach((scene, sceneIndex) => {
    const nextSceneId = stringValue(scene?.nextSceneId).trim();
    if (nextSceneId && !sceneIds.has(nextSceneId)) {
      push('error', 'scene-next-missing', `scenes[${sceneIndex}].nextSceneId`, `next scene does not exist: ${nextSceneId}`);
    }
    const labels = new Set();
    (scene?.commands || []).forEach((command) => {
      if (!command || command.skip === true || command.type !== 'label') return;
      const name = stringValue(command.name || command.label || command.labelId).trim();
      if (name) labels.add(name);
    });
    (scene?.commands || []).forEach((command, commandIndex) => {
      if (!command || command.skip === true) return;
      const path = commandPath(sceneIndex, commandIndex);
      const targets = [];
      if (command.type === 'jump') targets.push(['sceneId', command.sceneId]);
      if (command.type === 'choice') {
        for (const [choiceIndex, choice] of (command.choices || []).entries()) {
          const id = stringValue(choice?.targetSceneId).trim();
          if (id && !sceneIds.has(id)) push('error', 'choice-target-missing', `${path}.choices[${choiceIndex}].targetSceneId`, `choice target does not exist: ${id}`);
        }
      }
      for (const [field, value] of targets) {
        const id = stringValue(value).trim();
        if (!id || !sceneIds.has(id)) push('error', 'scene-target-missing', `${path}.${field}`, `scene target does not exist: ${id || '(empty)'}`);
      }
      const labelTargets = [];
      if (command.type === 'goto') labelTargets.push(['targetLabel', command.targetLabel]);
      if (command.type === 'if') {
        labelTargets.push(['targetLabel', command.targetLabel]);
        labelTargets.push(['elseLabel', command.elseLabel]);
      }
      if (command.type === 'switch') {
        for (const [caseIndex, branch] of (command.cases || []).entries()) {
          labelTargets.push([`cases[${caseIndex}].targetLabel`, branch?.targetLabel]);
        }
        labelTargets.push(['defaultLabel', command.defaultLabel]);
      }
      if (command.type === 'inputcheck' && stringValue(command.mode || 'sync').toLowerCase() !== 'cancel') {
        labelTargets.push(['targetLabel', command.targetLabel]);
      }
      for (const [field, value] of labelTargets) {
        const label = stringValue(value).trim();
        if (label && !labels.has(label)) push('error', 'label-target-missing', `${path}.${field}`, `label target does not exist in scene ${scene?.id}: ${label}`);
      }
    });
  });

  const references = collectReferences(sceneDocument);
  let catalogInfo = null;
  if (catalog) {
    catalogInfo = collectCatalog(catalog);
    catalogInfo.duplicates.forEach((duplicate) => {
      push('error', 'asset-id-duplicate', `assets[${duplicate.second}].id`, `duplicate asset id: ${duplicate.id}`);
    });
    for (const ref of references) {
      const asset = catalogInfo.byId.get(ref.assetId);
      if (!asset) {
        push('error', 'asset-reference-missing', ref.path, `asset does not exist: ${ref.assetId}`);
      } else if (!assetTypeMatches(asset.type, ref.expectedType)) {
        push('error', 'asset-type-mismatch', ref.path, `${ref.assetId} has type ${asset.type}; expected ${ref.expectedType}`);
      }
    }
  }

  const variables = collectVariables(sceneDocument);
  if (variables.length > 255) push('error', 'variable-count-overflow', 'scenes', `variable count ${variables.length} exceeds 255`);

  const result = {
    ok: errors.length === 0,
    errors,
    warnings,
    diagnostics,
    references,
    variables,
    sceneIds: Array.from(sceneIds.keys()),
    catalogInfo,
  };
  if (catalogInfo) result.psgVariants = Array.from(collectPsgVariants(sceneDocument, catalogInfo.byId).values());
  if (options.includeDocuments) {
    result.sceneDocument = deepClone(sceneDocument);
    result.catalog = deepClone(catalog);
  }
  return result;
}

function sanitizeSymbol(value, prefix = 'nov') {
  const source = stringValue(value).normalize('NFKD').toLowerCase();
  let slug = source.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  if (!slug) slug = 'asset';
  if (/^[0-9]/.test(slug)) slug = `a_${slug}`;
  const digest = crypto.createHash('sha256').update(stringValue(value), 'utf8').digest('hex').slice(0, 8);
  const base = `${prefix}_${slug}`.slice(0, 52).replace(/_+$/g, '');
  return `${base}_${digest}`;
}

function defaultTargetProfile(options = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    target: 'mega-drive',
    coordinateMode: options.coordinateMode || 'pce-legacy-256',
    video: {
      width: 320,
      height: 224,
      refreshHz: 60,
      legacyViewportX: 32,
      backgroundPlane: 'BG_B',
      overlayPlane: 'BG_A',
      messagePlane: 'WINDOW',
    },
    window: {
      heightPixels: 96,
      columns: 19,
      bodyRows: 4,
      bodyPageCells: 75,
      speakerRows: 1,
      choiceVisibleCharacters: 17,
      opaque: true,
    },
    palettes: {
      system: 0,
      selectable: [0, 1, 2, 3],
      pal0Reserved: {
        0: '#000000',
        1: '#ffffff',
      },
    },
    font: normalizeFontSettings(),
    audio: {
      driver: 'XGM2',
      cdda: 'ignore',
      adpcm: 'ignore',
      voice: 'ignore',
      psgSong: 'require-xgm2-binding',
      psgSfx: 'require-wav-binding',
      sfxRate: 6650,
      sfxChannel: 2,
    },
    input: {
      up: 'UP',
      down: 'DOWN',
      left: 'LEFT',
      right: 'RIGHT',
      i: 'B',
      ii: 'C',
      run: 'START',
      select: 'A',
    },
    runtime: {
      spriteSlots: 4,
      spriteTextSlots: 4,
      spriteTextCharacters: 32,
      dmaBytesPerFrame: 6144,
    },
    rom: {
      targetBytes: 3670016,
      hardLimitBytes: 4194304,
      mapper: false,
    },
    import: {
      sourceProjectDir: stringValue(options.sourceProjectDir),
      sourceProjectId: stringValue(options.sourceProjectId),
      importedAt: options.importedAt || null,
    },
  };
}

function characterGroup(assetId) {
  const match = stringValue(assetId).match(/^sp_([^_]+)/i);
  return match ? match[1].toLowerCase() : stringValue(assetId).toLowerCase();
}

function paletteAssignment(assetId, options = {}) {
  const group = characterGroup(assetId);
  const explicit = options.portraitPaletteGroups || {};
  if ((explicit.PAL1 || []).map(String).map((item) => item.toLowerCase()).includes(group)) return 'PAL1';
  if ((explicit.PAL2 || []).map(String).map((item) => item.toLowerCase()).includes(group)) return 'PAL2';
  if ((explicit.PAL3 || []).map(String).map((item) => item.toLowerCase()).includes(group)) return 'PAL3';
  return 'PAL2';
}
function createAssetBindings(sceneDocument, catalog, options = {}) {
  const sceneRevision = options.sceneRevision || hashDocument(sceneDocument);
  const catalogInfo = collectCatalog(catalog);
  const validation = validateSceneDocument(sceneDocument, catalog);
  const referencedIds = new Set(validation.references.map((reference) => reference.assetId));
  const paletteRequirements = collectVisualPaletteRequirements(sceneDocument);

  const assets = {};
  for (const asset of catalogInfo.assets) {
    const assetId = stringValue(asset.id).trim();
    if (!assetId || !referencedIds.has(assetId)) continue;
    const sourceType = stringValue(asset.type);
    let runtimeType = 'IGNORED';
    let legacyPalette = null;
    let paletteProfileName = null;
    let subdir = 'ignored';
    let extension = '';
    if (sourceType === 'image') {
      runtimeType = 'IMAGE';
      legacyPalette = Array.from(paletteRequirements.get(assetId)?.palettes || [])[0] || 'PAL1';
      paletteProfileName = paletteProfile(legacyPalette);
      subdir = 'backgrounds';
      extension = '.png';
    } else if (sourceType === 'sprite') {
      runtimeType = 'SPRITE';
      legacyPalette = Array.from(paletteRequirements.get(assetId)?.palettes || [])[0]
        || paletteAssignment(assetId, options);
      paletteProfileName = paletteProfile(legacyPalette);
      subdir = 'sprites';
      extension = '.png';
    } else if (sourceType === 'psg-song') {
      runtimeType = 'XGM2';
      subdir = 'music';
      extension = '.vgm';
    } else if (sourceType === 'psg-sfx') {
      runtimeType = 'WAV';
      subdir = 'sfx';
      extension = '.wav';
    }
    const symbol = sanitizeSymbol(assetId, runtimeType === 'SPRITE' ? 'nov_spr' : runtimeType === 'IMAGE' ? 'nov_bg' : 'nov_audio');
    assets[assetId] = {
      assetId,
      sourceType,
      runtimeType,
      symbol,
      palette: legacyPalette,
      legacyPalette,
      paletteGroup: null,
      sourcePath: runtimeType === 'IGNORED' ? '' : 'novel/' + subdir + '/' + symbol + extension,
      originalSource: stringValue(asset.source),
      conversion: {
        converterVersion: VISUAL_CONVERTER_VERSION,
        coordinateMode: options.coordinateMode || 'pce-legacy-256',
        paletteProfile: paletteProfileName,
        inputHash: '',
      },
    };
  }

  const audioVariants = {};
  for (const variant of collectPsgVariants(sceneDocument, catalogInfo.byId).values()) {
    const asset = catalogInfo.byId.get(variant.assetId);
    const runtimeType = asset.type === 'psg-song' ? 'XGM2' : 'WAV';
    const symbol = sanitizeSymbol(String(variant.assetId) + '_ch' + variant.channel, runtimeType === 'XGM2' ? 'nov_bgm' : 'nov_sfx');
    audioVariants[variant.key] = {
      ...variant,
      runtimeType,
      symbol,
      sourcePath: 'novel/' + (runtimeType === 'XGM2' ? 'music' : 'sfx') + '/' + symbol + '.' + (runtimeType === 'XGM2' ? 'vgm' : 'wav'),
      status: 'pending',
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceSceneRevision: sceneRevision,
    assets,
    audioVariants,
    paletteGroups: {},
  };
}
module.exports = {
  SCHEMA_VERSION,
  PCE_SCENE_VERSION,
  VISUAL_CONVERTER_VERSION,
  RESERVED_VARIABLES,
  PALETTE_NAMES,
  NEW_SPRITE_PALETTES,
  KNOWN_COMMANDS,
  isPlainObject,
  deepClone,
  stableStringify,
  hashDocument,
  glyphLength,
  makeDiagnostic,
  isSkippedCommand,
  normalizedPalette,
  paletteIndex,
  paletteProfile,
  newCommandPalette,
  resolveCommandPalette,
  collectVisualPaletteRequirements,
  collectCatalog,
  collectReferences,
  collectPsgVariants,
  collectVariables,
  validateSceneDocument,
  sanitizeSymbol,
  defaultTargetProfile,
  characterGroup,
  paletteAssignment,
  createAssetBindings,
};
