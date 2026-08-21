'use strict';

const crypto = require('crypto');
const iconv = require('iconv-lite');
const {
  KNOWN_COMMANDS,
  collectCatalog,
  collectVariables,
  glyphLength,
  hashDocument,
  isSkippedCommand,
  sanitizeSymbol,
  paletteIndex,
  resolveCommandPalette,
  validateSceneDocument,
} = require('../md-novel-editor/novel-schema');

const COMMAND_TYPES = Object.freeze({
  background: 'NOV_CMD_BACKGROUND',
  sprite: 'NOV_CMD_SPRITE',
  spritemove: 'NOV_CMD_MOVE',
  message: 'NOV_CMD_MESSAGE',
  audio: 'NOV_CMD_AUDIO',
  cache: 'NOV_CMD_NOP',
  variable: 'NOV_CMD_VARIABLE',
  choice: 'NOV_CMD_CHOICE',
  if: 'NOV_CMD_IF',
  switch: 'NOV_CMD_SWITCH',
  goto: 'NOV_CMD_GOTO',
  inputcheck: 'NOV_CMD_INPUT',
  jump: 'NOV_CMD_JUMP',
  wait: 'NOV_CMD_WAIT',
  effect: 'NOV_CMD_EFFECT',
  spritetext: 'NOV_CMD_SPRITETEXT',
});

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function cIdentifier(value, prefix = 'nov') {
  return sanitizeSymbol(value, prefix).replace(/[^a-zA-Z0-9_]/g, '_');
}

function fullWidthAscii(value) {
  return Array.from(String(value ?? '')).map((character) => {
    const code = character.codePointAt(0);
    if (code === 0x20) return '\u3000';
    if (code >= 0x21 && code <= 0x7e) return String.fromCodePoint(code + 0xfee0);
    return character;
  }).join('');
}

function encodeShiftJis(value, location = 'text') {
  const source = fullWidthAscii(value);
  const encoded = iconv.encode(source, 'shift_jis');
  const decoded = iconv.decode(encoded, 'shift_jis');
  if (decoded !== source) throw new Error(`Shift-JISに変換できない文字があります: ${location}`);
  return encoded;
}

function bytesInitializer(buffer) {
  return [...buffer, 0].map((value) => `0x${value.toString(16).padStart(2, '0')}`).join(', ');
}

function paginateText(value, columns = 19, rows = 4) {
  const widths = Array.from({ length: rows }, (_, index) => index === rows - 1 ? columns - 1 : columns);
  const pages = [];
  let lines = [];
  let line = '';
  let row = 0;
  const commit = () => {
    lines.push(line);
    line = '';
    row += 1;
    if (row >= rows) {
      pages.push(lines);
      lines = [];
      row = 0;
    }
  };
  for (const character of Array.from(String(value ?? ''))) {
    if (character === '\r') continue;
    if (character === '\n') { commit(); continue; }
    if (Array.from(line).length >= widths[row]) commit();
    line += character;
  }
  if (line || lines.length || !pages.length) commit();
  if (lines.length) pages.push(lines);
  return pages.map((page) => page.join('\n'));
}

function mdColor(value, fallback = 0x0eee) {
  const match = String(value || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return fallback;
  const red = Math.round(parseInt(match[1], 16) * 7 / 255);
  const green = Math.round(parseInt(match[2], 16) * 7 / 255);
  const blue = Math.round(parseInt(match[3], 16) * 7 / 255);
  return (blue << 9) | (green << 5) | (red << 1);
}

function inputMask(buttons) {
  const mapping = { up: 'BUTTON_UP', down: 'BUTTON_DOWN', left: 'BUTTON_LEFT', right: 'BUTTON_RIGHT', i: 'BUTTON_B', ii: 'BUTTON_C', run: 'BUTTON_START', select: 'BUTTON_A' };
  const values = (Array.isArray(buttons) ? buttons : []).map((button) => mapping[String(button)]).filter(Boolean);
  return values.length ? values.join(' | ') : '0';
}

class StringPool {
  constructor() {
    this.entries = [];
    this.byHash = new Map();
  }

  add(value, location) {
    const buffer = encodeShiftJis(value, location);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (this.byHash.has(hash)) return this.byHash.get(hash);
    const symbol = `nov_text_${this.entries.length}`;
    this.entries.push({ symbol, buffer });
    this.byHash.set(hash, symbol);
    return symbol;
  }

  source() {
    return this.entries.map((entry) => `static const u8 ${entry.symbol}[] = { ${bytesInitializer(entry.buffer)} };`).join('\n');
  }
}

function resourceEntries(bindings) {
  const backgrounds = Object.values(bindings.assets || {}).filter((entry) => entry.runtimeType === 'IMAGE').sort((a, b) => a.assetId.localeCompare(b.assetId));
  const sprites = Object.values(bindings.assets || {}).filter((entry) => entry.runtimeType === 'SPRITE').sort((a, b) => a.assetId.localeCompare(b.assetId));
  const audio = Object.values(bindings.audioVariants || {}).filter((entry) => entry.status === 'ready').sort((a, b) => a.key.localeCompare(b.key));
  return {
    backgrounds,
    sprites,
    bgIndex: new Map(backgrounds.map((entry, index) => [entry.assetId, index])),
    spriteIndex: new Map(sprites.map((entry, index) => [entry.assetId, index])),
    bgm: audio.filter((entry) => entry.runtimeType === 'XGM2'),
    sfx: audio.filter((entry) => entry.runtimeType === 'WAV'),
  };
}

function quoteResourcePath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  if (!/^novel\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) throw new Error(`Unsafe ResComp path: ${value}`);
  return `"${path}"`;
}

function generateResFile(resources) {
  const lines = ['# Generated by md-novel-builder', 'TILESET novel_font_subset "novel/font/generated.png" NONE NONE'];
  resources.backgrounds.forEach((entry) => lines.push(`IMAGE ${entry.symbol} ${quoteResourcePath(entry.sourcePath)} NONE ALL 0`));
  resources.sprites.forEach((entry) => {
    const meta = entry.metadata || {};
    const width = clamp(meta.frameWidth, 8, 248, 64) / 8;
    const height = clamp(meta.frameHeight, 8, 248, 128) / 8;
    const timing = String(meta.timing || '1');
    if (!/^\d+$|^\[\[[0-9,\]\[]+\]$/.test(timing)) throw new Error(`Unsafe SPRITE timing: ${entry.assetId}`);
    lines.push(`SPRITE ${entry.symbol} ${quoteResourcePath(entry.sourcePath)} ${width} ${height} NONE ${timing} NONE BALANCED FAST FALSE`);
  });
  resources.bgm.forEach((entry) => lines.push(`XGM2 ${entry.symbol} ${quoteResourcePath(entry.sourcePath)}`));
  resources.sfx.forEach((entry) => lines.push(`WAV ${entry.symbol} ${quoteResourcePath(entry.sourcePath)} XGM2 6650 FALSE`));
  return `${lines.join('\n')}\n`;
}

function sceneIdMap(sceneDocument) {
  return new Map((sceneDocument.scenes || []).map((scene, index) => [String(scene.id), index]));
}

function emittedScene(scene) {
  const commands = [];
  const labels = new Map();
  for (const command of scene.commands || []) {
    if (!command || command.skip === true || command.type === 'comment') continue;
    if (command.type === 'label' && !labels.has(String(command.name || ''))) {
      labels.set(String(command.name || ''), commands.length);
    }
    commands.push(command);
  }
  return { commands, labels };
}

function audioFlags(command, asset) {
  if (command.action === 'stop') {
    if (String(command.kind || 'psg') !== 'psg') return 'NOV_FLAG_AUDIO_IGNORED';
    if (command.target === 'bgm') return 'NOV_FLAG_AUDIO_STOP | NOV_FLAG_AUDIO_BGM';
    if (command.target === 'sfx') return 'NOV_FLAG_AUDIO_STOP | NOV_FLAG_AUDIO_SFX';
    return 'NOV_FLAG_AUDIO_STOP | NOV_FLAG_AUDIO_BGM | NOV_FLAG_AUDIO_SFX';
  }
  if (asset?.type === 'psg-song') return 'NOV_FLAG_AUDIO_PLAY | NOV_FLAG_AUDIO_BGM';
  if (asset?.type === 'psg-sfx') return 'NOV_FLAG_AUDIO_PLAY | NOV_FLAG_AUDIO_SFX';
  return 'NOV_FLAG_AUDIO_IGNORED';
}

function variableOperationFlag(operation) {
  if (operation === 'define') return 'NOV_VAR_DEFINE';
  if (operation === 'add') return 'NOV_VAR_ADD';
  if (operation === 'sub') return 'NOV_VAR_SUB';
  if (operation === 'random') return 'NOV_VAR_RANDOM';
  return 'NOV_VAR_SET';
}

function compareFlag(operator) {
  if (operator === 'ne') return 'NOV_COMPARE_NE';
  if (operator === 'lt') return 'NOV_COMPARE_LT';
  if (operator === 'lte') return 'NOV_COMPARE_LTE';
  if (operator === 'gt') return 'NOV_COMPARE_GT';
  if (operator === 'gte') return 'NOV_COMPARE_GTE';
  return 'NOV_COMPARE_EQ';
}

function effectFlag(effect) {
  if (effect === 'fadeIn') return 'NOV_EFFECT_FADE_IN';
  if (effect === 'blank') return 'NOV_EFFECT_BLANK';
  if (effect === 'shake') return 'NOV_EFFECT_SHAKE';
  if (effect === 'flash') return 'NOV_EFFECT_FLASH';
  return 'NOV_EFFECT_FADE_OUT';
}

function animationIndex(asset, requested = 'default') {
  const animations = Array.isArray(asset?.options?.animations) ? asset.options.animations : [];
  if (!animations.length) return requested && requested !== 'default' ? -1 : 0;
  const exact = animations.findIndex((animation) => String(animation?.id || '') === String(requested || 'default'));
  if (exact >= 0) return exact;
  if (!requested || requested === 'default') {
    const fallback = animations.findIndex((animation) => String(animation?.id || '') === 'default');
    return fallback >= 0 ? fallback : 0;
  }
  return -1;
}

function collectVariableTable(sceneDocument) {
  const names = collectVariables(sceneDocument);
  const index = new Map(names.map((name, variableIndex) => [String(name), variableIndex]));
  const settings = sceneDocument.settings || {};
  const initialValues = names.map(() => 0);
  initialValues[0] = settings.messageAdvanceMode === 'auto' ? 1 : 0;
  const defined = new Set(['AUTO_ENABLE', 'MSG_SPEED']);
  for (const scene of sceneDocument.scenes || []) {
    for (const command of scene.commands || []) {
      if (!command || command.skip === true || command.type !== 'variable' || command.operation !== 'define') continue;
      const name = String(command.variableName || command.name || command.variable || '');
      if (!index.has(name) || defined.has(name)) continue;
      initialValues[index.get(name)] = clamp(command.value, -32768, 32767, 0);
      defined.add(name);
    }
  }
  return { names, index, initialValues };
}
function compileScenes(sceneDocument, catalog, bindings, resources, pool, warnings, variables, options = {}) {
  const ids = sceneIdMap(sceneDocument);
  const catalogInfo = collectCatalog(catalog);
  const messageColorFallbacks = new Set(options.messageColorFallbacks || []);
  const messages = [];
  const textCommands = [];
  const choices = [];
  const switches = [];
  const compiled = [];
  for (const [sceneIndex, scene] of sceneDocument.scenes.entries()) {
    const emitted = emittedScene(scene);
    const rows = [];
    const slotSpriteAssets = [null, null, null, null];
    for (const [commandIndex, command] of emitted.commands.entries()) {
      if (!KNOWN_COMMANDS.has(command.type)) throw new Error(`Unknown command: ${command.type}`);
      let type = COMMAND_TYPES[command.type] || 'NOV_CMD_NOP';
      let flags = '0';
      let slot = clamp(command.slot, 0, 3, 0);
      let count = 0;
      let x = clamp(command.x, -32768, 32767, 0);
      let y = clamp(command.y, -32768, 32767, 0);
      let frames = clamp(command.frames, 0, 65535, 0);
      let target = -1;
      let aux = '0';
      let data = 'NULL';
      if (command.type === 'background') {
        target = resources.bgIndex.get(String(command.assetId));
        if (target == null) throw new Error(`Missing background binding: ${command.assetId}`);
        count = paletteIndex(resolveCommandPalette(command, bindings.assets?.[String(command.assetId)]));
        if (count < 0) throw new Error('Invalid background palette: ' + command.palette);
        if (command.transition === 'fade') flags = 'NOV_FLAG_FADE';
        frames = clamp(command.fadeOutFrames, 0, 65535, 0);
        aux = String(clamp(command.fadeInFrames, 0, 65535, 0));
      } else if (command.type === 'sprite') {
        flags = `${command.visible === false ? '0' : 'NOV_FLAG_VISIBLE'}${command.flipX ? ' | NOV_FLAG_FLIP_X' : ''}${command.flipY ? ' | NOV_FLAG_FLIP_Y' : ''}`;
        target = command.assetId ? resources.spriteIndex.get(String(command.assetId)) : -1;
        if (command.assetId && target == null) throw new Error(`Missing sprite binding: ${command.assetId}`);
        count = paletteIndex(resolveCommandPalette(command, bindings.assets?.[String(command.assetId)]));
        if (count < 0) throw new Error('Invalid sprite palette: ' + command.palette);
        if (command.visible === false) {
          target = -1;
          slotSpriteAssets[slot] = null;
        } else {
          const asset = catalogInfo.byId.get(String(command.assetId));
          const animation = animationIndex(asset, command.animationId || 'default');
          if (animation < 0) throw new Error(`Unknown sprite animation: ${command.assetId}:${command.animationId}`);
          aux = String(animation);
          slotSpriteAssets[slot] = String(command.assetId);
        }
      } else if (command.type === 'spritemove') {
        flags = command.async ? 'NOV_FLAG_ASYNC' : '0';
        if (command.animationId) {
          const assetId = String(command.animationAssetId || slotSpriteAssets[slot] || '');
          if (!assetId) throw new Error(`Sprite move animation has no asset in scene ${scene.id}`);
          if (slotSpriteAssets[slot] && slotSpriteAssets[slot] !== assetId) throw new Error(`Sprite move animation asset does not match slot ${slot}`);
          target = resources.spriteIndex.get(assetId);
          if (target == null) throw new Error(`Missing sprite binding: ${assetId}`);
          const animation = animationIndex(catalogInfo.byId.get(assetId), command.animationId);
          if (animation < 0) throw new Error(`Unknown sprite animation: ${assetId}:${command.animationId}`);
          aux = String(animation);
        }
      } else if (command.type === 'message') {
        const pages = paginateText(command.text);
        const pageSymbols = pages.map((page, pageIndex) => pool.add(page, `scene ${scene.id} message ${commandIndex} page ${pageIndex}`));
        const speaker = pool.add(command.speaker || '', `scene ${scene.id} speaker ${commandIndex}`);
        const symbol = `nov_message_${messages.length}`;
        const array = `${symbol}_pages`;
        const textColor = messageColorFallbacks.has(`${sceneIndex}:${commandIndex}`) ? '#ffffff' : command.textColor;
        messages.push({ symbol, array, pageSymbols, speaker, color: mdColor(textColor), mouthSlot: command.mouthSlot == null ? -1 : clamp(command.mouthSlot, 0, 3, 0) });
        data = `&${symbol}`;
      } else if (command.type === 'spritetext') {
        let value = String(command.text || '');
        if (glyphLength(value) > 32) {
          warnings.push({ code: 'spritetext-truncated', message: `${scene.id}[${commandIndex}] SpriteText is limited to 32 characters` });
          value = Array.from(value).slice(0, 32).join('');
        }
        const symbol = `nov_sprite_text_${textCommands.length}`;
        textCommands.push({ symbol, text: pool.add(value, `scene ${scene.id} spritetext ${commandIndex}`), color: mdColor(command.color), blinkFrames: clamp(command.blinkFrames, 0, 65535, 0) });
        data = `&${symbol}`;
        flags = command.visible === false ? '0' : 'NOV_FLAG_VISIBLE';
      } else if (command.type === 'audio') {
        const asset = catalogInfo.byId.get(String(command.assetId));
        flags = audioFlags(command, asset);
        if (asset?.type === 'psg-song') target = resources.bgm.findIndex((entry) => entry.key === `${asset.id}@${clamp(command.channel, 0, 5, 0)}`);
        else if (asset?.type === 'psg-sfx') target = resources.sfx.findIndex((entry) => entry.key === `${asset.id}@${clamp(command.channel, 0, 5, 0)}`);
        if (command.action !== 'stop' && asset && ['psg-song', 'psg-sfx'].includes(asset.type) && target < 0) throw new Error(`Missing PSG variant binding: ${asset.id}@${clamp(command.channel, 0, 5, 0)}`);
      } else if (command.type === 'wait') {
        frames = clamp(command.frames, 0, 65535, 0);
      } else if (command.type === 'jump') {
        target = ids.get(String(command.sceneId || command.targetSceneId));
        if (target == null) throw new Error(`Unknown jump scene: ${command.sceneId || command.targetSceneId}`);
      } else if (command.type === 'inputcheck') {
        if (command.mode === 'cancel') flags = 'NOV_FLAG_INPUT_CANCEL';
        else flags = command.mode === 'async' ? 'NOV_FLAG_ASYNC' : '0';
        target = emitted.labels.has(String(command.targetLabel || '')) ? emitted.labels.get(String(command.targetLabel || '')) : -1;
        aux = inputMask(command.buttons);
      } else if (command.type === 'choice') {
        const options = (command.choices || []).slice(0, 4).map((option, optionIndex) => {
          if (glyphLength(option.label) > 17) warnings.push({ code: 'choice-label-clipped', message: `${scene.id}[${commandIndex}].choices[${optionIndex}] is clipped to 17 characters` });
          const targetId = String(option.targetSceneId || '');
          const targetScene = targetId ? ids.get(targetId) : -1;
          if (targetId && targetScene == null) throw new Error(`Unknown choice scene: ${targetId}`);
          return { label: pool.add(Array.from(String(option.label || '')).slice(0, 17).join(''), `choice ${scene.id} ${optionIndex}`), targetScene: targetScene == null ? -1 : targetScene, value: clamp(option.value, -32768, 32767, optionIndex) };
        });
        const symbol = `nov_choice_${choices.length}`;
        const variableName = String(command.variableName || command.variable || command.resultVariable || '');
        const variableIndex = variableName && variables.index.has(variableName) ? variables.index.get(variableName) : -1;
        choices.push({ symbol, options, variableIndex, defaultIndex: clamp(command.defaultIndex, 0, Math.max(0, options.length - 1), 0) });
        data = `&${symbol}`;
        count = options.length;
      } else if (command.type === 'variable') {
        const variableName = String(command.variableName || command.name || command.variable || '');
        target = variables.index.has(variableName) ? variables.index.get(variableName) : -1;
        flags = variableOperationFlag(command.operation);
        if (command.operation === 'random') {
          x = clamp(command.min, -32768, 32767, 0);
          y = clamp(command.max, -32768, 32767, 9);
          if (x > y) [x, y] = [y, x];
        } else {
          x = clamp(command.value, -32768, 32767, 0);
          y = 0;
        }
      } else if (command.type === 'if') {
        const variableName = String(command.variableName || command.name || command.variable || '');
        target = variables.index.has(variableName) ? variables.index.get(variableName) : -1;
        flags = compareFlag(command.operator);
        aux = String(clamp(command.value, -32768, 32767, 0) & 0xffff);
        x = emitted.labels.has(String(command.targetLabel || '')) ? emitted.labels.get(String(command.targetLabel || '')) : -1;
        y = emitted.labels.has(String(command.elseLabel || '')) ? emitted.labels.get(String(command.elseLabel || '')) : -1;
      } else if (command.type === 'switch') {
        const variableName = String(command.variableName || command.name || command.variable || '');
        target = variables.index.has(variableName) ? variables.index.get(variableName) : -1;
        const symbol = `nov_switch_${switches.length}`;
        const cases = (command.cases || []).slice(0, 16).map((branch) => ({
          value: clamp(branch?.value, -32768, 32767, 0),
          targetPc: emitted.labels.has(String(branch?.targetLabel || '')) ? emitted.labels.get(String(branch?.targetLabel || '')) : -1,
        }));
        const defaultPc = emitted.labels.has(String(command.defaultLabel || '')) ? emitted.labels.get(String(command.defaultLabel || '')) : -1;
        switches.push({ symbol, cases, defaultPc });
        data = `&${symbol}`;
      } else if (command.type === 'goto') {
        target = emitted.labels.has(String(command.targetLabel || '')) ? emitted.labels.get(String(command.targetLabel || '')) : -1;
      } else if (command.type === 'effect') {
        flags = effectFlag(command.effect);
        x = clamp(command.intensity, 0, 64, 0);
        frames = clamp(command.frames, 0, 255, 0);
        aux = String(mdColor(command.color, command.effect === 'flash' ? 0x0eee : 0));
      } else if (command.type === 'cache' || command.type === 'label') {
        type = 'NOV_CMD_NOP';
      }
      rows.push(`    { ${type}, ${flags}, ${slot}, ${count}, ${x}, ${y}, ${frames}, ${target}, ${aux}, ${data} }`);
    }
    compiled.push({
      symbol: `nov_scene_${sceneIndex}`,
      id: String(scene.id),
      rows,
      nextScene: ids.has(String(scene.nextSceneId || '')) ? ids.get(String(scene.nextSceneId || '')) : -1,
      fullScreen: Boolean(scene.fullScreenBg),
    });
  }
  return { compiled, messages, textCommands, choices, switches, startScene: ids.get(String(sceneDocument.startScene)) ?? 0 };
}
function dataHeader() {
  return `#ifndef MD_NOVEL_GENERATED_DATA_H\n#define MD_NOVEL_GENERATED_DATA_H\n\n#include "novel_runtime/novel_runtime.h"\n\nextern const NovelProject gNovelProject;\nconst Image* novelDataBackground(u16 index);\nconst SpriteDefinition* novelDataSprite(u16 index);\nu16 novelDataBackgroundPaletteId(u16 index);\nu16 novelDataSpritePaletteId(u16 index);\nvoid novelDataPlayBgm(u16 index);\nvoid novelDataPlaySfx(u16 index);\n\n#endif\n`;
}

function generateDataSource(resources, compiled, pool, settings, profile, budget, variables, fontPlan) {
  const messageSource = compiled.messages.map((message) => `static const u8* const ${message.array}[] = { ${message.pageSymbols.join(', ')} };\nstatic const NovelMessage ${message.symbol} = { ${message.speaker}, ${message.array}, ${message.pageSymbols.length}, ${message.mouthSlot}, 0x${message.color.toString(16).padStart(4, '0')} };`).join('\n');
  const textSource = compiled.textCommands.map((entry) => `static const NovelSpriteText ${entry.symbol} = { ${entry.text}, 0x${entry.color.toString(16).padStart(4, '0')}, ${entry.blinkFrames} };`).join('\n');
  const choiceSource = compiled.choices.map((choice) => `static const NovelChoice ${choice.symbol} = { ${choice.options.length}, ${choice.defaultIndex}, ${choice.variableIndex}, { ${choice.options.map((option) => `{ ${option.label}, ${option.targetScene}, ${option.value} }`).join(', ')} } };`).join('\n');
  const switchSource = compiled.switches.map((branch) => {
    const caseSource = branch.cases.length
      ? branch.cases.map((entry) => `{ ${entry.value}, ${entry.targetPc} }`).join(', ')
      : '{ 0, -1 }';
    return `static const NovelSwitch ${branch.symbol} = { ${branch.cases.length}, ${branch.defaultPc}, { ${caseSource} } };`;
  }).join('\n');
  const sceneSource = compiled.compiled.map((scene) => `static const NovelCommand ${scene.symbol}_commands[] = {\n${scene.rows.join(',\n')}\n};`).join('\n\n');
  const projectScenes = compiled.compiled.map((scene) => `    { ${scene.symbol}_commands, ${scene.rows.length}, ${scene.nextScene}, ${scene.fullScreen ? 'TRUE' : 'FALSE'} }`).join(',\n');
  const initialVariables = `static const s16 nov_initial_variables[] = { ${variables.initialValues.join(', ')} };\nconst u16 nov_font_codes[] = { ${fontPlan.entries.map((entry) => `0x${Number(entry.code).toString(16).padStart(4, '0')}`).join(', ')} };\nconst u16 nov_font_glyph_count = ${fontPlan.entries.length};`;
  const bgSwitch = resources.backgrounds.map((entry, index) => `        case ${index}: return &${entry.symbol};`).join('\n');
  const sprSwitch = resources.sprites.map((entry, index) => `        case ${index}: return &${entry.symbol};`).join('\n');
  const paletteFingerprints = [...new Set([...resources.backgrounds, ...resources.sprites].map((entry) => String(entry.paletteFingerprint || entry.assetId)))].sort();
  const paletteId = (entry) => Math.max(1, paletteFingerprints.indexOf(String(entry.paletteFingerprint || entry.assetId)) + 1);
  const bgPalIdSwitch = resources.backgrounds.map((entry, index) => '        case ' + index + ': return ' + paletteId(entry) + ';').join('\n');
  const sprPalIdSwitch = resources.sprites.map((entry, index) => '        case ' + index + ': return ' + paletteId(entry) + ';').join('\n');
  const bgmSwitch = resources.bgm.map((entry, index) => `        case ${index}: XGM2_setLoopNumber(-1); XGM2_play(${entry.symbol}); break;`).join('\n');
  const sfxSwitch = resources.sfx.map((entry, index) => `        case ${index}: XGM2_stopPCM(SOUND_PCM_CH2); XGM2_playPCMEx(${entry.symbol}, sizeof(${entry.symbol}), SOUND_PCM_CH2, 6, TRUE, FALSE); break;`).join('\n');
  return `#include <genesis.h>\n#include "novel.h"\n#include "generated/novel_data.h"\n\n${pool.source()}\n\n${messageSource}\n${textSource}\n${choiceSource}\n${switchSource}\n${initialVariables}\n\n${sceneSource}\n\nstatic const NovelScene nov_scenes[] = {\n${projectScenes}\n};\n\nconst NovelProject gNovelProject = { nov_scenes, ${compiled.compiled.length}, ${compiled.startScene}, ${clamp(settings.messageSpeedFrames, 0, 50, 10)}, ${settings.messageAdvanceMode === 'auto' ? 'TRUE' : 'FALSE'}, ${clamp(settings.messageAutoWaitFrames, 0, 255, 60)}, ${Math.max(1, budget.maxSpriteTiles)}, ${budget.maxOverlayTiles}, ${profile.coordinateMode === 'pce-legacy-256' ? 'TRUE' : 'FALSE'}, nov_initial_variables, ${variables.names.length} };\n\nconst Image* novelDataBackground(u16 index)\n{\n    switch (index)\n    {\n${bgSwitch}\n        default: return NULL;\n    }\n}\n\nconst SpriteDefinition* novelDataSprite(u16 index)\n{\n    switch (index)\n    {\n${sprSwitch}\n        default: return NULL;\n    }\n}\n\nu16 novelDataBackgroundPaletteId(u16 index)\n{\n    switch (index)\n    {\n${bgPalIdSwitch}\n        default: return 0xFFFF;\n    }\n}\n\nu16 novelDataSpritePaletteId(u16 index)\n{\n    switch (index)\n    {\n${sprPalIdSwitch}\n        default: return 0xFFFF;\n    }\n}\n\nvoid novelDataPlayBgm(u16 index)\n{\n    switch (index)\n    {\n${bgmSwitch}\n        default: break;\n    }\n}\n\nvoid novelDataPlaySfx(u16 index)\n{\n    switch (index)\n    {\n${sfxSwitch}\n        default: break;\n    }\n}\n`;
}
const NOVEL_WINDOW_VRAM_TILES = 381;
const NOVEL_OVERLAY_MAX_TILES = 192;
const NOVEL_VISUAL_STATE_LIMIT = 100000;

function visualInputMask(buttons) {
  const mapping = { up: 1, down: 2, left: 4, right: 8, i: 16, ii: 32, run: 64, select: 128 };
  return (Array.isArray(buttons) ? buttons : []).reduce((mask, button) => mask | (mapping[String(button).toLowerCase()] || 0), 0);
}

function cloneVisualState(state) {
  return {
    sceneIndex: state.sceneIndex,
    pc: state.pc,
    backgroundTiles: state.backgroundTiles,
    background: state.background ? { ...state.background } : null,
    windowVisible: state.windowVisible,
    messageColor: state.messageColor || '',
    slots: state.slots.map((slot) => slot ? { ...slot } : null),
    spriteTexts: state.spriteTexts.map((entry) => entry ? { ...entry } : null),
    watchers: state.watchers.map((watcher) => ({ ...watcher })),
  };
}

function visualStateKey(state) {
  return JSON.stringify([
    state.sceneIndex,
    state.pc,
    state.backgroundTiles,
    state.background ? [state.background.assetId, state.background.palette, state.background.paletteFingerprint] : null,
    state.windowVisible ? 1 : 0,
    state.messageColor || '',
    state.slots.map((slot) => slot ? [slot.assetId, slot.palette, slot.paletteFingerprint, slot.x, slot.yMin, slot.yMax] : null),
    state.spriteTexts.map((entry) => entry ? [entry.text, entry.x, entry.y] : null),
    state.watchers.map((watcher) => [watcher.mask, watcher.targetPc]),
  ]);
}

function enterVisualScene(state, sceneIndex, scenes) {
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) return null;
  const entered = cloneVisualState(state);
  entered.sceneIndex = sceneIndex;
  entered.pc = 0;
  entered.windowVisible = false;
  entered.messageColor = '';
  entered.spriteTexts = [null, null, null, null];
  entered.watchers = [];
  if (scenes[sceneIndex].scene.fullScreenBg) entered.slots = [null, null, null, null];
  return entered;
}
function updateAsyncWatchers(watchers, mask, targetPc) {
  if (mask === 0) return watchers.map((watcher) => ({ ...watcher }));
  const updated = [];
  for (const watcher of watchers) {
    const remaining = watcher.mask & ~mask;
    if (remaining !== 0) updated.push({ mask: remaining, targetPc: watcher.targetPc });
  }
  if (updated.length < 7) updated.push({ mask, targetPc });
  return updated;
}

function spriteTextTileCells(spriteTexts) {
  const cells = new Set();
  for (const entry of spriteTexts) {
    if (!entry) continue;
    const originX = numberOrZero(entry.x);
    let x = originX;
    let y = numberOrZero(entry.y);
    let glyphs = 0;
    for (const character of Array.from(String(entry.text || ''))) {
      if (character === '\r') continue;
      if (character === '\n') {
        x = originX;
        y += 16;
        continue;
      }
      if (glyphs >= 32) break;
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(319, x + 15);
      const bottom = Math.min(223, y + 15);
      if (left <= right && top <= bottom) {
        for (let tileY = Math.floor(top / 8); tileY <= Math.floor(bottom / 8); tileY += 1) {
          for (let tileX = Math.floor(left / 8); tileX <= Math.floor(right / 8); tileX += 1) {
            cells.add(`${tileX},${tileY}`);
          }
        }
      }
      x += 16;
      glyphs += 1;
    }
  }
  return cells;
}

function visibleBudget(sceneDocument, bindings) {
  const diagnostics = [];
  const messageColorFallbacks = new Set();
  const rawScenes = Array.isArray(sceneDocument.scenes) ? sceneDocument.scenes : [];
  if (!rawScenes.length) {
    return {
      maxSpriteTiles: 0,
      maxSpritePieces: 0,
      maxScanlinePieces: 0,
      maxScanlinePixels: 0,
      maxOverlayTiles: 0,
      maxBudget: 0,
      states: 0,
      messageColorFallbacks: [],
      diagnostics,
    };
  }
  const ids = new Map(rawScenes.map((scene, index) => [String(scene.id || ''), index]));
  const scenes = rawScenes.map((scene) => ({ scene, ...emittedScene(scene) }));
  const startScene = ids.get(String(sceneDocument.startScene || '')) ?? 0;
  const measurements = [];
  let maxSpriteTiles = 0;
  let maxSpritePieces = 0;
  let maxScanlinePieces = 0;
  let maxScanlinePixels = 0;

  const paletteDiagnosticKeys = new Set();
  const recordPaletteDiagnostic = (entry, state, keySuffix) => {
    const key = `${entry.code}:${state.sceneIndex}:${keySuffix}`;
    if (paletteDiagnosticKeys.has(key)) return;
    paletteDiagnosticKeys.add(key);
    diagnostics.push({
      ...entry,
      sceneId: String(rawScenes[state.sceneIndex]?.id || ''),
      commandIndex: Math.max(0, state.pc - 1),
    });
  };
  const measure = (state) => {
    const metas = state.slots.filter(Boolean).map((slot) => ({
      ...slot,
      ...(bindings.assets?.[slot.assetId]?.metadata || {}),
    }));
    const owners = [];
    if (state.background) owners.push({ type: 'background', ...state.background });
    for (let slot = 0; slot < state.slots.length; slot += 1) {
      if (state.slots[slot]) owners.push({ type: 'sprite', slot, ...state.slots[slot] });
    }
    const ownersByPalette = new Map();
    for (const owner of owners) {
      const list = ownersByPalette.get(owner.palette) || [];
      list.push(owner);
      ownersByPalette.set(owner.palette, list);
    }
    for (const [palette, paletteOwners] of ownersByPalette) {
      const fingerprints = [...new Set(paletteOwners.map((owner) => String(owner.paletteFingerprint || owner.assetId)))];
      if (fingerprints.length > 1) {
        const assetIds = [...new Set(paletteOwners.map((owner) => owner.assetId))].sort();
        recordPaletteDiagnostic({
          severity: 'error',
          code: 'palette-runtime-conflict',
          palette,
          assetIds,
          message: `${palette} is occupied by incompatible visible palettes (${assetIds.join(', ')}). Jointly quantize the assets into one palette group or assign different palette IDs.`,
        }, state, `${palette}:${fingerprints.sort().join(',')}`);
      }
    }
    if (state.messageColor && mdColor(state.messageColor) !== 0x0eee) {
      const indexOneOwners = (ownersByPalette.get('PAL0') || []).filter((owner) => owner.usesPaletteIndex1);
      if (indexOneOwners.length) {
        const assetIds = [...new Set(indexOneOwners.map((owner) => owner.assetId))].sort();
        messageColorFallbacks.add(`${state.sceneIndex}:${Math.max(0, state.pc - 1)}`);
        recordPaletteDiagnostic({
          severity: 'warning',
          code: 'pal0-message-index1-conflict',
          palette: 'PAL0',
          assetIds,
          message: `Non-white message text is rendered white because visible PAL0 assets use index 1 (${assetIds.join(', ')}). The source textColor is preserved.`,
        }, state, assetIds.join(','));
      }
      if (state.spriteTexts.some(Boolean)) {
        messageColorFallbacks.add(`${state.sceneIndex}:${Math.max(0, state.pc - 1)}`);
        recordPaletteDiagnostic({
          severity: 'warning',
          code: 'pal0-message-spritetext-conflict',
          palette: 'PAL0',
          message: 'Non-white message text is rendered white because visible SpriteText shares PAL0 index 1. The source textColor is preserved.',
        }, state, 'spritetext');
      }
    }
    const spriteTiles = metas.reduce((sum, meta) => sum + (meta.maxNumTile || 0), 0);
    const spritePieces = metas.reduce((sum, meta) => sum + (meta.maxNumSprite || 0), 0);
    const overlayTiles = spriteTextTileCells(state.spriteTexts).size;
    maxSpriteTiles = Math.max(maxSpriteTiles, spriteTiles);
    maxSpritePieces = Math.max(maxSpritePieces, spritePieces);
    for (let line = 0; line < 224; line += 1) {
      let pieces = 0;
      let pixels = 0;
      for (const meta of metas) {
        const height = meta.frameHeight || 0;
        const width = meta.frameWidth || 0;
        if (line < meta.yMin || line >= meta.yMax + height) continue;
        pieces += Math.ceil(width / 32);
        pixels += width;
      }
      maxScanlinePieces = Math.max(maxScanlinePieces, pieces);
      maxScanlinePixels = Math.max(maxScanlinePixels, pixels);
    }
    measurements.push({
      backgroundTiles: state.backgroundTiles,
      spriteTiles,
      overlayTiles,
      windowVisible: state.windowVisible,
    });
  };
  const blank = {
    sceneIndex: startScene,
    pc: 0,
    backgroundTiles: 0,
    background: null,
    windowVisible: false,
    messageColor: '',
    slots: [null, null, null, null],
    spriteTexts: [null, null, null, null],
    watchers: [],
  };
  const queue = [];
  const visited = new Set();
  let overflow = false;
  const enqueue = (state) => {
    if (!state || overflow) return;
    const key = visualStateKey(state);
    if (visited.has(key)) return;
    if (visited.size >= NOVEL_VISUAL_STATE_LIMIT) {
      overflow = true;
      return;
    }
    visited.add(key);
    queue.push(state);
  };
  const enqueueWatcherTransitions = (state) => {
    for (const watcher of state.watchers) {
      const fired = cloneVisualState(state);
      fired.watchers = [];
      fired.windowVisible = false;
      if (watcher.targetPc >= 0) fired.pc = watcher.targetPc;
      enqueue(fired);
    }
  };
  const enqueueScene = (state, sceneIndex) => enqueue(enterVisualScene(state, sceneIndex, scenes));
  enqueueScene(blank, startScene);

  for (let head = 0; head < queue.length && !overflow; head += 1) {
    const state = queue[head];
    const sceneInfo = scenes[state.sceneIndex];
    measure(state);
    enqueueWatcherTransitions(state);
    if (state.pc >= sceneInfo.commands.length) {
      const nextScene = ids.get(String(sceneInfo.scene.nextSceneId || ''));
      if (nextScene == null) enqueueScene(state, startScene);
      else enqueueScene(state, nextScene);
      continue;
    }

    const command = sceneInfo.commands[state.pc];
    const next = cloneVisualState(state);
    next.pc += 1;
    if (command.type === 'background') {
      const assetId = String(command.assetId || '');
      const binding = bindings.assets?.[assetId] || {};
      next.backgroundTiles = binding.metadata?.uniqueTiles || 0;
      next.background = {
        assetId,
        palette: resolveCommandPalette(command, binding),
        paletteFingerprint: String(binding.paletteFingerprint || assetId),
        usesPaletteIndex1: Boolean(binding.metadata?.usesPaletteIndex1),
      };
      next.windowVisible = false;
      next.messageColor = '';
      enqueue(next);
    } else if (command.type === 'sprite') {
      const slot = clamp(command.slot, 0, 3, 0);
      const y = numberOrZero(command.y);
      const assetId = String(command.assetId || '');
      const binding = bindings.assets?.[assetId] || {};
      next.slots[slot] = command.visible === false ? null : {
        assetId,
        palette: resolveCommandPalette(command, binding),
        paletteFingerprint: String(binding.paletteFingerprint || assetId),
        usesPaletteIndex1: Boolean(binding.metadata?.usesPaletteIndex1),
        x: numberOrZero(command.x),
        yMin: y,
        yMax: y,
      };
      enqueue(next);
    } else if (command.type === 'spritemove') {
      const slotIndex = clamp(command.slot, 0, 3, 0);
      const actor = next.slots[slotIndex];
      if (actor) {
        const targetY = numberOrZero(command.y);
        const moved = {
          ...actor,
          x: numberOrZero(command.x),
          yMin: Math.min(actor.yMin, targetY),
          yMax: Math.max(actor.yMax, targetY),
        };
        const swept = cloneVisualState(next);
        swept.slots[slotIndex] = moved;
        measure(swept);
        if (command.async) next.slots[slotIndex] = moved;
        else next.slots[slotIndex] = { ...moved, yMin: targetY, yMax: targetY };
      }
      enqueue(next);
    } else if (command.type === 'spritetext') {
      const slot = clamp(command.slot, 0, 3, 0);
      next.spriteTexts[slot] = command.visible === false ? null : {
        text: Array.from(String(command.text || '')).slice(0, 32).join(''),
        x: numberOrZero(command.x),
        y: numberOrZero(command.y),
      };
      enqueue(next);
    } else if (command.type === 'message') {
      const displayed = cloneVisualState(next);
      displayed.windowVisible = true;
      displayed.messageColor = String(command.textColor || '');
      measure(displayed);
      next.windowVisible = true;
      next.messageColor = '';
      enqueue(next);
    } else if (command.type === 'choice') {
      next.windowVisible = true;
      measure(next);
      enqueueWatcherTransitions(next);
      for (const option of (command.choices || []).slice(0, 4)) {
        const selected = cloneVisualState(next);
        selected.windowVisible = false;
        const target = ids.get(String(option?.targetSceneId || ''));
        if (target == null) enqueue(selected);
        else enqueueScene(selected, target);
      }
    } else if (command.type === 'jump') {
      enqueueScene(next, ids.get(String(command.sceneId || command.targetSceneId || '')));
    } else if (command.type === 'goto') {
      const target = sceneInfo.labels.get(String(command.targetLabel || ''));
      if (target != null) next.pc = target;
      enqueue(next);
    } else if (command.type === 'if') {
      const targets = [command.targetLabel, command.elseLabel];
      for (const label of targets) {
        const branch = cloneVisualState(next);
        const target = sceneInfo.labels.get(String(label || ''));
        if (target != null) branch.pc = target;
        enqueue(branch);
      }
    } else if (command.type === 'switch') {
      const labels = [...(command.cases || []).slice(0, 16).map((entry) => entry?.targetLabel), command.defaultLabel];
      if (!labels.length) labels.push('');
      for (const label of labels) {
        const branch = cloneVisualState(next);
        const target = sceneInfo.labels.get(String(label || ''));
        if (target != null) branch.pc = target;
        enqueue(branch);
      }
    } else if (command.type === 'inputcheck') {
      const mode = String(command.mode || 'sync').toLowerCase();
      const target = sceneInfo.labels.get(String(command.targetLabel || ''));
      const targetPc = target == null ? -1 : target;
      if (mode === 'cancel') {
        next.watchers = [];
        enqueue(next);
      } else if (mode === 'async') {
        next.watchers = updateAsyncWatchers(next.watchers, visualInputMask(command.buttons), targetPc);
        enqueue(next);
      } else {
        enqueueWatcherTransitions(next);
        const mask = visualInputMask(command.buttons);
        if (mask !== 0) {
          next.watchers = [];
          next.windowVisible = false;
          if (targetPc >= 0) next.pc = targetPc;
          enqueue(next);
        }
      }
    } else if (command.type === 'effect' && command.effect === 'blank') {
      next.backgroundTiles = 0;
      next.background = null;
      next.windowVisible = false;
      next.messageColor = '';
      next.slots = [null, null, null, null];
      next.spriteTexts = [null, null, null, null];
      enqueue(next);
    } else {
      enqueue(next);
    }
  }

  const maxOverlayTiles = measurements.reduce((maximum, entry) => Math.max(maximum, entry.overlayTiles), 0);
  const maxBudget = measurements.reduce((maximum, entry) => Math.max(maximum,
    entry.backgroundTiles + entry.spriteTiles + (entry.windowVisible
      ? maxOverlayTiles + NOVEL_WINDOW_VRAM_TILES
      : entry.overlayTiles)), 0);
  if (overflow) diagnostics.push({ severity: 'error', code: 'visual-state-overflow', message: `reachable visual state count exceeds ${NOVEL_VISUAL_STATE_LIMIT}` });
  if (maxOverlayTiles > NOVEL_OVERLAY_MAX_TILES) diagnostics.push({ severity: 'error', code: 'overlay-tile-budget', message: `SpriteText overlay ${maxOverlayTiles} tiles > ${NOVEL_OVERLAY_MAX_TILES}` });
  if (maxSpritePieces > 80) diagnostics.push({ severity: 'error', code: 'sprite-piece-budget', message: `hardware sprite count ${maxSpritePieces} > 80` });
  if (maxScanlinePieces > 20) diagnostics.push({ severity: 'error', code: 'sprite-scanline-pieces', message: `scanline sprite pieces ${maxScanlinePieces} > 20` });
  if (maxScanlinePixels > 320) diagnostics.push({ severity: 'error', code: 'sprite-scanline-pixels', message: `scanline sprite pixels ${maxScanlinePixels} > 320` });
  if (maxBudget > 1424) diagnostics.push({ severity: 'error', code: 'vram-budget', message: `scene VRAM budget ${maxBudget} tiles > 1424` });
  return {
    maxSpriteTiles,
    maxSpritePieces,
    maxScanlinePieces,
    maxScanlinePixels,
    maxOverlayTiles,
    maxBudget,
    states: visited.size,
    messageColorFallbacks: [...messageColorFallbacks].sort(),
    diagnostics,
  };
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function generateProject(snapshot) {
  const validation = validateSceneDocument(snapshot.sceneDocument, snapshot.catalog);
  if (validation.errors.length) throw new Error(`Novel validation failed: ${validation.errors[0].message}`);
  if (snapshot.bindings.sourceSceneRevision !== hashDocument(snapshot.sceneDocument)) throw new Error('Asset bindings are stale');
  const fontPlan = snapshot.fontPlan;
  if (!fontPlan || !Array.isArray(fontPlan.entries) || !fontPlan.entries.length) throw new Error('Validated subset font plan is missing');
  const resources = resourceEntries(snapshot.bindings);
  const warnings = validation.warnings.slice();
  const pool = new StringPool();
  const variables = collectVariableTable(snapshot.sceneDocument);
  const budget = visibleBudget(snapshot.sceneDocument, snapshot.bindings);
  const errors = budget.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(`Novel preflight failed: ${errors[0].message}`);
  warnings.push(...budget.diagnostics.filter((entry) => entry.severity === 'warning'));
  const compiled = compileScenes(snapshot.sceneDocument, snapshot.catalog, snapshot.bindings, resources, pool, warnings, variables, {
    messageColorFallbacks: budget.messageColorFallbacks,
  });
  return {
    files: {
      'res/novel.res': generateResFile(resources),
      'inc/generated/novel_data.h': dataHeader(),
      'src/generated/novel_data.c': generateDataSource(resources, compiled, pool, snapshot.sceneDocument.settings || {}, snapshot.targetProfile, budget, variables, fontPlan),
    },
    warnings,
    report: {
      scenes: compiled.compiled.length,
      commands: compiled.compiled.reduce((sum, scene) => sum + scene.rows.length, 0),
      messages: compiled.messages.length,
      backgrounds: resources.backgrounds.length,
      sprites: resources.sprites.length,
      bgm: resources.bgm.length,
      sfx: resources.sfx.length,
      strings: pool.entries.length,
      glyphs: fontPlan.entries.length,
      variables: variables.names.length,
      switches: compiled.switches.length,
      budget,
    },
  };
}

module.exports = {
  COMMAND_TYPES,
  clamp,
  fullWidthAscii,
  encodeShiftJis,
  paginateText,
  mdColor,
  inputMask,
  variableOperationFlag,
  compareFlag,
  effectFlag,
  animationIndex,
  collectVariableTable,
  StringPool,
  resourceEntries,
  generateResFile,
  emittedScene,
  visibleBudget,
  generateProject,
};
