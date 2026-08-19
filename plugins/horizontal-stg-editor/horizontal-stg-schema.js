'use strict';

const crypto = require('crypto');
const iconv = require('iconv-lite');

const SCHEMA_VERSION = 1;
const RUNTIME_ID_MIN = 1;
const RUNTIME_ID_MAX = 255;

const DEFAULT_SYSTEM_ASSETS = Object.freeze({
  title_background: 'gfx/title_background.png',
  title_logo: 'gfx/title_logo.png',
  hud_icons: 'gfx/hud_icons.png',
  player: 'gfx/player_test.png',
  player_bullet: 'gfx/player_bullet_test.png',
  enemy_bullet: 'gfx/enemy_bullet_test.png',
  charge: 'gfx/charge_test.png',
  core: 'gfx/core_test.png',
  enemy_fallback: 'gfx/enemy_test.png',
  boss_part: 'gfx/boss_part_test.png',
  explosion: 'gfx/explosion_test.png',
  item_red: 'gfx/item_red_test.png',
  item_blue: 'gfx/item_blue_test.png',
  item_green: 'gfx/item_green_test.png',
  item_power: 'gfx/item_power_test.png',
  item_speed: 'gfx/item_speed_test.png',
  item_core: 'gfx/item_core_test.png',
  item_bomb: 'gfx/item_bomb_test.png',
});

const DOCUMENT_KINDS = Object.freeze([
  'project',
  'flow',
  'enemies',
  'bosses',
  'weapons',
  'items',
  'effects',
  'audio',
  'stage',
]);

const ENTITY_COLLECTIONS = Object.freeze({
  enemies: 'enemies',
  bosses: 'bosses',
  weapons: 'weapons',
  items: 'items',
  effects: 'effects',
  audio: 'cues',
});

const DEFAULT_PROJECT = Object.freeze({
  schema_version: SCHEMA_VERSION,
  game_id: 'horizontal-stg',
  title: 'HORIZONTAL STG',
  orientation: 'horizontal',
  screen: { width: 320, height: 224, refresh_hz: 60 },
  rom: { target_bytes: 3670016, hard_limit_bytes: 4194304 },
  pools: {
    enemies: 16,
    player_bullets: 32,
    enemy_bullets: 64,
    charge_shots: 4,
    items: 16,
    effects: 16,
    physical_sprites_target: 64,
  },
  rules: {
    start_lives: 3,
    start_bombs: 2,
    max_bombs: 3,
    continues: 3,
    extend_scores: [200000, 700000],
    charge_mid_frames: 36,
    charge_max_frames: 84,
    respawn_invincible_frames: 90,
    bomb_invincible_frames: 120,
  },
  input: {
    shot: 'A',
    core: 'B',
    bomb: 'C',
    pause: 'START',
    remappable: ['A', 'B', 'C'],
  },
  assets: DEFAULT_SYSTEM_ASSETS,
  difficulty: {
    default: 'normal',
    easy: { bullet_count_percent: 80, bullet_speed_percent: 90 },
    normal: { bullet_count_percent: 100, bullet_speed_percent: 100 },
    hard: { bullet_count_percent: 120, bullet_speed_percent: 120 },
  },
  stage_order: [],
  first_stage_id: '',
});

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value, spaces = 2) {
  return `${JSON.stringify(stableValue(value), null, spaces)}\n`;
}

function revisionFor(value) {
  return crypto.createHash('sha256').update(stableStringify(value, 0)).digest('hex');
}

function safeId(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function cSymbol(value, prefix = 'stg') {
  const symbol = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const safe = symbol && /^[A-Za-z_]/.test(symbol) ? symbol : `${prefix}_${symbol || 'item'}`;
  return safe.slice(0, 63);
}

function cEnum(value, prefix) {
  return `${prefix}_${cSymbol(value, 'ID').toUpperCase()}`;
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeProject(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = deepClone(DEFAULT_PROJECT);
  result.game_id = safeId(source.game_id, result.game_id);
  result.title = String(source.title || result.title).trim().slice(0, 48) || result.title;
  result.screen = { ...result.screen, ...(isPlainObject(source.screen) ? source.screen : {}) };
  result.rom = { ...result.rom, ...(isPlainObject(source.rom) ? source.rom : {}) };
  result.pools = { ...result.pools, ...(isPlainObject(source.pools) ? source.pools : {}) };
  result.rules = { ...result.rules, ...(isPlainObject(source.rules) ? source.rules : {}) };
  result.input = { ...result.input, ...(isPlainObject(source.input) ? source.input : {}) };
  result.difficulty = { ...result.difficulty, ...(isPlainObject(source.difficulty) ? source.difficulty : {}) };
  result.assets = { ...DEFAULT_SYSTEM_ASSETS, ...(isPlainObject(source.assets) ? source.assets : {}) };
  result.stage_order = Array.isArray(source.stage_order)
    ? [...new Set(source.stage_order.map((id) => safeId(id)).filter(Boolean))]
    : [];
  result.first_stage_id = safeId(source.first_stage_id, result.stage_order[0] || '');
  result.schema_version = SCHEMA_VERSION;
  result.orientation = 'horizontal';
  result.screen.width = 320;
  result.screen.height = 224;
  result.screen.refresh_hz = 60;
  result.rom.target_bytes = integer(result.rom.target_bytes, 3670016, 1, 4194304);
  result.rom.hard_limit_bytes = integer(result.rom.hard_limit_bytes, 4194304, 1, 4194304);
  Object.keys(DEFAULT_PROJECT.pools).forEach((key) => {
    result.pools[key] = integer(result.pools[key], DEFAULT_PROJECT.pools[key], 1, 255);
  });
  result.rules.start_lives = integer(result.rules.start_lives, 3, 1, 9);
  result.rules.start_bombs = integer(result.rules.start_bombs, 2, 0, 3);
  result.rules.max_bombs = integer(result.rules.max_bombs, 3, 1, 9);
  result.rules.continues = integer(result.rules.continues, 3, 0, 9);
  result.rules.charge_mid_frames = integer(result.rules.charge_mid_frames, 36, 1, 600);
  result.rules.charge_max_frames = integer(result.rules.charge_max_frames, 84, 1, 600);
  result.rules.respawn_invincible_frames = integer(result.rules.respawn_invincible_frames, 90, 0, 600);
  result.rules.bomb_invincible_frames = integer(result.rules.bomb_invincible_frames, 120, 0, 600);
  result.rules.same_attribute_score = integer(result.rules.same_attribute_score, 500, 0, 65535);
  result.rules.max_power_score = integer(result.rules.max_power_score, 1000, 0, 65535);
  result.rules.max_speed_score = integer(result.rules.max_speed_score, 1000, 0, 65535);
  result.rules.max_bomb_score = integer(result.rules.max_bomb_score, 2000, 0, 65535);
  result.rules.duplicate_core_score = integer(result.rules.duplicate_core_score, 3000, 0, 65535);
  for (const key of ['easy', 'normal', 'hard']) {
    const entry = isPlainObject(result.difficulty[key]) ? result.difficulty[key] : {};
    result.difficulty[key] = {
      bullet_count_percent: integer(entry.bullet_count_percent, key === 'easy' ? 80 : (key === 'hard' ? 120 : 100), 25, 200),
      bullet_speed_percent: integer(entry.bullet_speed_percent, key === 'easy' ? 90 : (key === 'hard' ? 120 : 100), 25, 200),
    };
  }
  result.rules.extend_scores = Array.isArray(result.rules.extend_scores)
    ? result.rules.extend_scores.map((score) => integer(score, 0, 1, 99999999)).slice(0, 8)
    : [200000, 700000];
  return result;
}

function normalizeEntity(entity = {}, fallbackId = '') {
  const result = deepClone(isPlainObject(entity) ? entity : {});
  result.id = safeId(result.id, fallbackId);
  result.name = String(result.name || result.id || 'Untitled').trim().slice(0, 64);
  return result;
}

function normalizeCollection(input, key) {
  const raw = Array.isArray(input) ? input : (Array.isArray(input?.[key]) ? input[key] : []);
  return raw.map((entry, index) => normalizeEntity(entry, `${key.slice(0, -1)}-${index + 1}`));
}

function normalizeStage(input = {}, fallbackId = '') {
  const result = normalizeEntity(input, fallbackId || 'stage-01');
  result.length_px = integer(result.length_px, 4096, 320, 65535);
  result.scroll_speed_256 = integer(result.scroll_speed_256, 256, 0, 4096);
  result.parallax_shift_b = integer(result.parallax_shift_b, 1, 0, 7);
  result.palette = {
    bg_b_hud: 0,
    bg_a: 1,
    player_items: 2,
    enemies_boss_effects: 3,
    ...(isPlainObject(result.palette) ? result.palette : {}),
  };
  result.assets = {
    bg_a: '',
    bg_b: '',
    ...(isPlainObject(result.assets) ? result.assets : {}),
  };
  result.music_id = safeId(result.music_id);
  result.midboss_id = safeId(result.midboss_id);
  result.boss_id = safeId(result.boss_id);
  result.events = Array.isArray(result.events) ? result.events.map((event, index) => {
    const normalized = deepClone(isPlainObject(event) ? event : {});
    normalized.id = safeId(normalized.id, `${result.id}-event-${index + 1}`);
    normalized.trigger = isPlainObject(normalized.trigger) ? normalized.trigger : {};
    normalized.trigger.type = ['frame', 'scroll', 'condition'].includes(normalized.trigger.type)
      ? normalized.trigger.type
      : 'scroll';
    normalized.trigger.at = integer(normalized.trigger.at, 0, 0, 0xFFFFFFFF);
    normalized.trigger.condition = integer(normalized.trigger.condition, 0, 0, 254);
    normalized.order = integer(normalized.order, index, 0, 65535);
    normalized.command = String(normalized.command || 'spawn_enemy').trim().toLowerCase();
    normalized.payload = isPlainObject(normalized.payload) ? normalized.payload : {};
    return normalized;
  }) : [];
  return result;
}

function normalizeSnapshot(input = {}) {
  const snapshot = {
    project: normalizeProject(input.project),
    flow: isPlainObject(input.flow) ? deepClone(input.flow) : { schema_version: SCHEMA_VERSION, screens: [] },
    enemies: normalizeCollection(input.enemies, 'enemies'),
    bosses: normalizeCollection(input.bosses, 'bosses'),
    weapons: normalizeCollection(input.weapons, 'weapons'),
    items: normalizeCollection(input.items, 'items'),
    effects: normalizeCollection(input.effects, 'effects'),
    audio: normalizeCollection(input.audio, 'cues'),
    stages: Array.isArray(input.stages) ? input.stages.map((stage, index) => normalizeStage(stage, `stage-${String(index + 1).padStart(2, '0')}`)) : [],
    id_registry: isPlainObject(input.id_registry) ? deepClone(input.id_registry) : { schema_version: SCHEMA_VERSION, namespaces: {} },
  };
  snapshot.flow.schema_version = SCHEMA_VERSION;
  snapshot.id_registry.schema_version = SCHEMA_VERSION;
  snapshot.id_registry.namespaces = isPlainObject(snapshot.id_registry.namespaces) ? snapshot.id_registry.namespaces : {};
  return snapshot;
}

function collectionIds(collection) {
  return new Set((collection || []).map((entry) => entry.id));
}

function addDiagnostic(list, code, path, message, severity = 'error') {
  list.push({ code, path, message, severity });
}

function validateUniqueIds(entries, namespace, diagnostics) {
  const seen = new Map();
  entries.forEach((entry, index) => {
    if (!entry.id) {
      addDiagnostic(diagnostics, 'STG_ID_REQUIRED', `${namespace}[${index}].id`, 'IDは必須です');
      return;
    }
    if (seen.has(entry.id)) {
      addDiagnostic(diagnostics, 'STG_ID_DUPLICATE', `${namespace}[${index}].id`, `ID '${entry.id}' が重複しています`);
      return;
    }
    seen.set(entry.id, index);
  });
}

function validateSnapshot(input) {
  const snapshot = normalizeSnapshot(input);
  const diagnostics = [];
  if (snapshot.project.rom.target_bytes > snapshot.project.rom.hard_limit_bytes) {
    addDiagnostic(diagnostics, 'STG_ROM_TARGET_OVER_HARD_LIMIT', 'project.rom.target_bytes', 'ROM目標値はhard limit以下にしてください');
  }
  if (snapshot.project.rules.charge_mid_frames >= snapshot.project.rules.charge_max_frames) {
    addDiagnostic(diagnostics, 'STG_CHARGE_ORDER', 'project.rules', '中charge閾値は最大charge閾値より小さくしてください');
  }
  if (snapshot.stages.length === 0) {
    addDiagnostic(diagnostics, 'STG_STAGE_REQUIRED', 'stages', '少なくとも1面が必要です');
  }
  Object.entries(ENTITY_COLLECTIONS).forEach(([snapshotKey]) => validateUniqueIds(snapshot[snapshotKey], snapshotKey, diagnostics));
  validateUniqueIds(snapshot.stages, 'stages', diagnostics);

  const stageIds = collectionIds(snapshot.stages);
  const enemyIds = collectionIds(snapshot.enemies);
  const bossIds = collectionIds(snapshot.bosses);
  const itemIds = collectionIds(snapshot.items);
  const audioIds = collectionIds(snapshot.audio);
  snapshot.project.stage_order.forEach((id, index) => {
    if (!stageIds.has(id)) addDiagnostic(diagnostics, 'STG_STAGE_ORDER_REF', `project.stage_order[${index}]`, `存在しないstage '${id}' です`);
  });
  if (snapshot.project.first_stage_id && !stageIds.has(snapshot.project.first_stage_id)) {
    addDiagnostic(diagnostics, 'STG_FIRST_STAGE_REF', 'project.first_stage_id', `存在しないstage '${snapshot.project.first_stage_id}' です`);
  }

  snapshot.stages.forEach((stage, stageIndex) => {
    if (!stage.assets.bg_a || !stage.assets.bg_b) {
      addDiagnostic(diagnostics, 'STG_STAGE_BG_REQUIRED', `stages[${stageIndex}].assets`, 'BG_AとBG_Bの両方を指定してください');
    }
    if (stage.boss_id && !bossIds.has(stage.boss_id)) {
      addDiagnostic(diagnostics, 'STG_STAGE_BOSS_REF', `stages[${stageIndex}].boss_id`, `存在しないboss '${stage.boss_id}' です`);
    }
    if (stage.midboss_id && !bossIds.has(stage.midboss_id)) {
      addDiagnostic(diagnostics, 'STG_STAGE_MIDBOSS_REF', `stages[${stageIndex}].midboss_id`, `存在しないboss '${stage.midboss_id}' です`);
    }
    if (stage.music_id && !audioIds.has(stage.music_id)) {
      addDiagnostic(diagnostics, 'STG_STAGE_AUDIO_REF', `stages[${stageIndex}].music_id`, `存在しないaudio cue '${stage.music_id}' です`);
    }
    const eventIds = new Set();
    stage.events.forEach((event, eventIndex) => {
      const eventPath = `stages[${stageIndex}].events[${eventIndex}]`;
      if (eventIds.has(event.id)) addDiagnostic(diagnostics, 'STG_EVENT_ID_DUPLICATE', `${eventPath}.id`, `event ID '${event.id}' が重複しています`);
      eventIds.add(event.id);
      if (event.trigger.type !== 'condition' && event.trigger.at > 65535) {
        addDiagnostic(diagnostics, 'STG_EVENT_TRIGGER_RANGE', `${eventPath}.trigger.at`, 'frame/scroll triggerは65535以下にしてください');
      }
      if (event.command === 'spawn_enemy' && !enemyIds.has(safeId(event.payload.enemy_id))) {
        addDiagnostic(diagnostics, 'STG_EVENT_ENEMY_REF', `${eventPath}.payload.enemy_id`, `存在しないenemy '${event.payload.enemy_id || ''}' です`);
      }
      if (event.command === 'start_boss' && !bossIds.has(safeId(event.payload.boss_id))) {
        addDiagnostic(diagnostics, 'STG_EVENT_BOSS_REF', `${eventPath}.payload.boss_id`, `存在しないboss '${event.payload.boss_id || ''}' です`);
      }
      if (event.command === 'spawn_item' && !itemIds.has(safeId(event.payload.item_id))) {
        addDiagnostic(diagnostics, 'STG_EVENT_ITEM_REF', `${eventPath}.payload.item_id`, `存在しないitem '${event.payload.item_id || ''}' です`);
      }
      if (!['spawn_enemy', 'spawn_item', 'start_boss', 'stage_clear', 'set_flag'].includes(event.command)) {
        addDiagnostic(diagnostics, 'STG_EVENT_COMMAND_UNKNOWN', `${eventPath}.command`, `未対応command '${event.command}' です`);
      }
    });
  });

  const namespaceNames = [...Object.keys(ENTITY_COLLECTIONS), 'stages'];
  namespaceNames.forEach((namespace) => {
    const entries = namespace === 'stages' ? snapshot.stages : snapshot[namespace];
    const registry = snapshot.id_registry.namespaces[namespace] || {};
    const used = new Map();
    entries.forEach((entry, index) => {
      const runtimeId = registry[entry.id];
      if (!Number.isInteger(runtimeId) || runtimeId < RUNTIME_ID_MIN || runtimeId > RUNTIME_ID_MAX) {
        addDiagnostic(diagnostics, 'STG_RUNTIME_ID_MISSING', `${namespace}[${index}].id`, `runtime IDが未割当です: '${entry.id}'`);
      } else if (used.has(runtimeId)) {
        addDiagnostic(diagnostics, 'STG_RUNTIME_ID_DUPLICATE', `${namespace}[${index}].id`, `runtime ID ${runtimeId} が '${used.get(runtimeId)}' と重複しています`);
      } else {
        used.set(runtimeId, entry.id);
      }
    });
  });

  return {
    ok: diagnostics.every((entry) => entry.severity !== 'error'),
    errors: diagnostics.filter((entry) => entry.severity === 'error'),
    warnings: diagnostics.filter((entry) => entry.severity === 'warning'),
    diagnostics,
    snapshot,
  };
}

function assignRuntimeIds(input) {
  const snapshot = normalizeSnapshot(input);
  const namespaces = snapshot.id_registry.namespaces;
  [...Object.keys(ENTITY_COLLECTIONS), 'stages'].forEach((namespace) => {
    const entries = namespace === 'stages' ? snapshot.stages : snapshot[namespace];
    const registry = isPlainObject(namespaces[namespace]) ? { ...namespaces[namespace] } : {};
    const used = new Set(Object.values(registry).filter((value) => Number.isInteger(value) && value >= RUNTIME_ID_MIN && value <= RUNTIME_ID_MAX));
    entries.forEach((entry) => {
      if (Number.isInteger(registry[entry.id]) && registry[entry.id] >= RUNTIME_ID_MIN && registry[entry.id] <= RUNTIME_ID_MAX) return;
      let candidate = RUNTIME_ID_MIN;
      while (used.has(candidate) && candidate <= RUNTIME_ID_MAX) candidate++;
      if (candidate > RUNTIME_ID_MAX) throw new Error(`runtime ID namespace '${namespace}' が255件を超えました`);
      registry[entry.id] = candidate;
      used.add(candidate);
    });
    namespaces[namespace] = registry;
  });
  return snapshot;
}

function orderedStages(snapshot) {
  const byId = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const ordered = [];
  snapshot.project.stage_order.forEach((id) => {
    const stage = byId.get(id);
    if (stage) {
      ordered.push(stage);
      byId.delete(id);
    }
  });
  [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).forEach((stage) => ordered.push(stage));
  return ordered;
}

function bytesU16(value) {
  const safe = integer(value, 0, 0, 65535);
  return [safe & 0xFF, (safe >> 8) & 0xFF];
}

function bytesS16(value) {
  return bytesU16(integer(value, 0, -32768, 32767) & 0xFFFF);
}

function commandBytes(event, ids) {
  switch (event.command) {
    case 'spawn_enemy':
      return [1, ids.enemies[safeId(event.payload.enemy_id)] || 0, ...bytesS16(event.payload.x), ...bytesS16(event.payload.y)];
    case 'stage_clear':
      return [2];
    case 'set_flag':
      return [3, integer(event.payload.flag, 0xFF, 0, 0xFF)];
    case 'spawn_item':
      return [4, runtimeItemType(event.payload.item_id), ...bytesS16(event.payload.x), ...bytesS16(event.payload.y)];
    case 'start_boss':
      return [5, ids.bosses[safeId(event.payload.boss_id)] || 0];
    default:
      return [0];
  }
}

function runtimeItemType(itemId) {
  const runtimeTypes = {
    'red-capsule': 0,
    'blue-capsule': 1,
    'green-capsule': 2,
    power: 3,
    'abyss-core': 4,
    speed: 5,
    bomb: 6,
  };
  return runtimeTypes[safeId(itemId)] ?? 0;
}

function sortEvents(events, triggerType) {
  return events.filter((event) => event.trigger.type === triggerType).sort((a, b) => {
    const av = triggerType === 'condition' ? a.trigger.condition : a.trigger.at;
    const bv = triggerType === 'condition' ? b.trigger.condition : b.trigger.at;
    return (av - bv) || (a.order - b.order) || a.id.localeCompare(b.id);
  });
}

function deltaStream(events, ids) {
  if (!events.length) return [0, 0, 0];
  const bytes = [...bytesU16(events[0].trigger.at)];
  events.forEach((event, index) => {
    bytes.push(...commandBytes(event, ids));
    const current = event.trigger.at;
    const next = events[index + 1]?.trigger.at ?? current;
    bytes.push(...bytesU16(next - current));
  });
  bytes.push(0);
  return bytes;
}

function conditionStream(events, ids) {
  const bytes = [];
  events.forEach((event) => {
    bytes.push(integer(event.trigger.condition, 0, 0, 254), ...commandBytes(event, ids));
  });
  bytes.push(0xFF, 0);
  return bytes;
}

function formatByteArray(bytes) {
  const lines = [];
  for (let index = 0; index < bytes.length; index += 16) {
    lines.push(`    ${bytes.slice(index, index + 16).map((value) => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')},`);
  }
  return lines.join('\n');
}

function enumBlock(prefix, entries, registry, countName) {
  const sorted = [...entries].sort((a, b) => registry[a.id] - registry[b.id]);
  const max = sorted.reduce((value, entry) => Math.max(value, registry[entry.id] || 0), 0);
  const rows = [`    ${prefix}_NONE = 0,`];
  sorted.forEach((entry) => rows.push(`    ${cEnum(entry.id, prefix)} = ${registry[entry.id]},`));
  rows.push(`    ${countName} = ${max + 1}`);
  return rows.join('\n');
}

function buildIdMaps(snapshot) {
  const result = {};
  [...Object.keys(ENTITY_COLLECTIONS), 'stages'].forEach((namespace) => {
    result[namespace] = { ...(snapshot.id_registry.namespaces[namespace] || {}) };
  });
  return result;
}

function generateIdsHeader(snapshot) {
  const ids = buildIdMaps(snapshot);
  const audioEnum = enumBlock('AUDIO', snapshot.audio, ids.audio, 'AUDIO_TYPE_COUNT');
  const audioMacro = (id) => ids.audio[id] ? cEnum(id, 'AUDIO') : 'AUDIO_NONE';
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef HORIZONTAL_STG_GENERATED_IDS_H\n#define HORIZONTAL_STG_GENERATED_IDS_H\n\n#include <genesis.h>\n\ntypedef enum\n{\n${enumBlock('ENEMY', snapshot.enemies, ids.enemies, 'ENEMY_TYPE_COUNT')}\n} GeneratedEnemyId;\n\ntypedef enum\n{\n${enumBlock('BOSS', snapshot.bosses, ids.bosses, 'BOSS_TYPE_COUNT')}\n} GeneratedBossId;\n\ntypedef enum\n{\n${enumBlock('STAGE', snapshot.stages, ids.stages, 'STAGE_TYPE_COUNT')}\n} GeneratedStageId;\n\ntypedef enum\n{\n${audioEnum}\n} GeneratedAudioId;\n\n#define STG_FIRST_STAGE_ID ${cEnum(snapshot.project.first_stage_id || orderedStages(snapshot)[0]?.id || 'none', 'STAGE')}\n#define STG_AUDIO_TITLE ${audioMacro('title')}\n#define STG_AUDIO_MIDBOSS ${audioMacro('midboss')}\n#define STG_AUDIO_BOSS ${audioMacro('boss')}\n#define STG_AUDIO_FINAL_BOSS ${audioMacro('final-boss')}\n#define STG_AUDIO_STAGE_CLEAR ${audioMacro('stage-clear')}\n#define STG_AUDIO_GAME_OVER_CONTINUE ${audioMacro('game-over-continue')}\n#define STG_AUDIO_ENDING ${audioMacro('ending')}\n#define STG_AUDIO_NAME_ENTRY ${audioMacro('name-entry')}\n#define STG_AUDIO_STAFF_ROLL ${audioMacro('staff-roll')}\n\n#endif\n`;
}

function generateGameConfigHeader(snapshot) {
  const p = snapshot.project;
  const r = p.rules;
  const difficulty = p.difficulty;
  const defaultDifficulty = ({ easy: 0, normal: 1, hard: 2 })[String(difficulty.default || '').toLowerCase()] ?? 1;
  const flow = snapshot.flow || {};
  const continueScreen = (flow.screens || []).find((screen) => safeId(screen.id) === 'continue') || {};
  const staffRoll = (flow.screens || []).find((screen) => safeId(screen.id) === 'staff-roll') || {};
  const extendScores = r.extend_scores.length ? r.extend_scores : [200000, 700000];
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef HORIZONTAL_STG_GAME_CONFIG_H\n#define HORIZONTAL_STG_GAME_CONFIG_H\n\n#define STG_MAX_ENEMIES ${p.pools.enemies}\n#define STG_MAX_PLAYER_BULLETS ${p.pools.player_bullets}\n#define STG_MAX_ENEMY_BULLETS ${p.pools.enemy_bullets}\n#define STG_MAX_CHARGE_SHOTS ${p.pools.charge_shots}\n#define STG_MAX_ITEMS ${p.pools.items}\n#define STG_MAX_EFFECTS ${p.pools.effects}\n#define STG_PHYSICAL_SPRITES_TARGET ${p.pools.physical_sprites_target}\n\n#define STG_START_LIVES ${r.start_lives}\n#define STG_START_BOMBS ${r.start_bombs}\n#define STG_MAX_BOMBS ${r.max_bombs}\n#define STG_CONTINUE_COUNT ${r.continues}\n#define STG_CHARGE_MID_FRAMES ${r.charge_mid_frames}\n#define STG_CHARGE_MAX_FRAMES ${r.charge_max_frames}\n#define STG_RESPAWN_INVINCIBLE_FRAMES ${r.respawn_invincible_frames}\n#define STG_BOMB_ACTIVE_FRAMES ${r.bomb_invincible_frames}\n#define STG_SAME_ATTRIBUTE_SCORE ${r.same_attribute_score}\n#define STG_MAX_POWER_SCORE ${r.max_power_score}\n#define STG_MAX_SPEED_SCORE ${r.max_speed_score}\n#define STG_MAX_BOMB_SCORE ${r.max_bomb_score}\n#define STG_DUPLICATE_CORE_SCORE ${r.duplicate_core_score}\n\n#define STG_DEFAULT_DIFFICULTY ${defaultDifficulty}\n#define STG_EASY_BULLET_COUNT_PERCENT ${difficulty.easy.bullet_count_percent}\n#define STG_EASY_BULLET_SPEED_PERCENT ${difficulty.easy.bullet_speed_percent}\n#define STG_NORMAL_BULLET_COUNT_PERCENT ${difficulty.normal.bullet_count_percent}\n#define STG_NORMAL_BULLET_SPEED_PERCENT ${difficulty.normal.bullet_speed_percent}\n#define STG_HARD_BULLET_COUNT_PERCENT ${difficulty.hard.bullet_count_percent}\n#define STG_HARD_BULLET_SPEED_PERCENT ${difficulty.hard.bullet_speed_percent}\n\n#define STG_EXTEND_COUNT ${extendScores.length}\n#define STG_NAME_ENTRY_LENGTH ${integer(flow.name_entry_length, 3, 1, 3)}\n#define STG_HIGHSCORE_ROWS ${integer(flow.highscore_rows_per_difficulty, 10, 1, 10)}\n#define STG_CONTINUE_SECONDS ${integer(continueScreen.seconds, 10, 1, 99)}\n#define STG_STAFF_ROLL_FRAMES ${integer(staffRoll.duration_seconds, 60, 1, 600) * 60}\n\n#endif\n`;
}

function screenById(snapshot, id) {
  return (Array.isArray(snapshot.flow?.screens) ? snapshot.flow.screens : [])
    .find((screen) => safeId(screen?.id) === id) || {};
}

function encodeSjis(text) {
  return [...iconv.encode(String(text ?? ''), 'shift_jis')];
}

function textArray(symbol, text) {
  const bytes = [...encodeSjis(text), 0];
  return `const u8 ${symbol}[] =\n{\n${formatByteArray(bytes)}\n};`;
}

function normalizeTextList(value, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source.map((entry) => String(entry ?? ''));
}

function generateGameDataFiles(snapshot) {
  const ids = buildIdMaps(snapshot);
  const project = snapshot.project;
  const title = screenById(snapshot, 'title');
  const mainMenu = normalizeTextList(screenById(snapshot, 'main-menu').items, ['ゲームスタート', 'オプション', 'ハイスコア', 'サウンドテスト', 'あそびかた']);
  const options = normalizeTextList(screenById(snapshot, 'options').items, ['なんいど', 'ショット', 'コア', 'ボム', 'サウンド']);
  const howTo = normalizeTextList(screenById(snapshot, 'how-to').lines, ['Aでショット', 'Aをおしつづけてチャージ', 'Bでコア', 'Cでボム']);
  const openings = ['opening-1', 'opening-2', 'opening-3'].map((id) => String(screenById(snapshot, id).caption || ''));
  const pause = screenById(snapshot, 'pause');
  const result = screenById(snapshot, 'stage-result');
  const ending = ['ending-1', 'ending-2', 'epilogue'].map((id) => String(screenById(snapshot, id).caption || ''));
  const namedTexts = [
    ['gStgTextTitle', title.title || project.title],
    ['gStgTextStartPrompt', title.prompt || 'スタートボタンをおしてください'],
    ['gStgTextPauseTitle', pause.title || 'ポーズ'],
    ['gStgTextContinueTitle', screenById(snapshot, 'continue').title || 'コンティニュー?'],
    ['gStgTextGameOverTitle', screenById(snapshot, 'game-over').title || 'ゲームオーバー'],
    ['gStgTextNameEntryTitle', screenById(snapshot, 'name-entry').title || 'なまえをいれてください'],
    ['gStgTextStageClear', 'ステージクリア'],
    ['gStgTextStaffRoll', 'スタッフロール'],
  ];
  const groups = [
    ['gStgMainMenuItems', 'gStgMainMenuText', 'STG_MAIN_MENU_COUNT', mainMenu],
    ['gStgOptionItems', 'gStgOptionText', 'STG_OPTION_ITEM_COUNT', options],
    ['gStgHowToLines', 'gStgHowToText', 'STG_HOW_TO_LINE_COUNT', howTo],
    ['gStgOpeningLines', 'gStgOpeningText', 'STG_OPENING_LINE_COUNT', openings],
    ['gStgPauseItems', 'gStgPauseText', 'STG_PAUSE_ITEM_COUNT', normalizeTextList(pause.items, ['つづける', 'タイトルへ'])],
    ['gStgResultItems', 'gStgResultText', 'STG_RESULT_ITEM_COUNT', normalizeTextList(result.items, ['クリアタイム', 'ノーミス', 'コアボーナス', 'ボムボーナス'])],
    ['gStgEndingLines', 'gStgEndingText', 'STG_ENDING_LINE_COUNT', ending],
  ];
  const declarations = namedTexts.map(([symbol]) => `extern const u8 ${symbol}[];`);
  const definitions = namedTexts.map(([symbol, text]) => textArray(symbol, text));
  groups.forEach(([arraySymbol, prefix, countMacro, values]) => {
    values.forEach((text, index) => {
      const symbol = `${prefix}${index}`;
      declarations.push(`extern const u8 ${symbol}[];`);
      definitions.push(textArray(symbol, text));
    });
    declarations.push(`#define ${countMacro} ${values.length}`);
    declarations.push(`extern const u8* const ${arraySymbol}[${values.length}];`);
    definitions.push(`const u8* const ${arraySymbol}[${values.length}] =\n{\n${values.map((_text, index) => `    ${prefix}${index},`).join('\n')}\n};`);
  });
  const stageRows = snapshot.stages.map((stage) => `    [${cEnum(stage.id, 'STAGE')}] = gStgStageName_${cSymbol(stage.id)},`).join('\n');
  snapshot.stages.forEach((stage) => {
    const symbol = `gStgStageName_${cSymbol(stage.id)}`;
    declarations.push(`extern const u8 ${symbol}[];`);
    definitions.push(textArray(symbol, stage.name));
  });
  const bossRows = snapshot.bosses.map((boss) => `    [${cEnum(boss.id, 'BOSS')}] = gStgBossName_${cSymbol(boss.id)},`).join('\n');
  snapshot.bosses.forEach((boss) => {
    const symbol = `gStgBossName_${cSymbol(boss.id)}`;
    declarations.push(`extern const u8 ${symbol}[];`);
    definitions.push(textArray(symbol, boss.name));
  });
  const stageOrder = orderedStages(snapshot).map((stage) => cEnum(stage.id, 'STAGE'));
  const extendScores = project.rules.extend_scores.length ? project.rules.extend_scores : [200000, 700000];
  declarations.push(`#define STG_STAGE_ORDER_COUNT ${stageOrder.length}`);
  declarations.push(`extern const u8 gStgStageOrder[${stageOrder.length}];`);
  declarations.push('extern const u8* const gStgStageNames[STAGE_TYPE_COUNT];');
  declarations.push('extern const u8* const gStgBossNames[BOSS_TYPE_COUNT];');
  declarations.push('extern const u32 gStgExtendScores[STG_EXTEND_COUNT];');
  definitions.push(`const u8 gStgStageOrder[${stageOrder.length}] = { ${stageOrder.join(', ')} };`);
  definitions.push(`const u8* const gStgStageNames[STAGE_TYPE_COUNT] =\n{\n${stageRows}\n};`);
  definitions.push(`const u8* const gStgBossNames[BOSS_TYPE_COUNT] =\n{\n${bossRows}\n};`);
  definitions.push(`const u32 gStgExtendScores[STG_EXTEND_COUNT] = { ${extendScores.map((value) => `${value}u`).join(', ')} };`);
  const header = `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef HORIZONTAL_STG_GAME_DATA_H\n#define HORIZONTAL_STG_GAME_DATA_H\n\n#include <genesis.h>\n#include "generated/generated_ids.h"\n#include "generated/game_config.h"\n\n${declarations.join('\n')}\n\n#endif\n`;
  const source = `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "generated/game_data.h"\n\n${definitions.join('\n\n')}\n`;
  return { 'inc/generated/game_data.h': header, 'src/generated/game_data.c': source };
}

function generateAudioDataFiles(snapshot) {
  const enabledCues = snapshot.audio.filter((cue) => cue.path && String(cue.type || '').toUpperCase() !== 'DISABLED');
  const rows = enabledCues.map((cue) => `    [${cEnum(cue.id, 'AUDIO')}] = ${cSymbol(cue.symbol || cue.id, 'audio')},`).join('\n');
  const loops = snapshot.audio.map((cue) => `    [${cEnum(cue.id, 'AUDIO')}] = ${cue.loop === false ? 'FALSE' : 'TRUE'},`).join('\n');
  return {
    'inc/generated/audio_data.h': `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef HORIZONTAL_STG_AUDIO_DATA_H\n#define HORIZONTAL_STG_AUDIO_DATA_H\n#include <genesis.h>\n#include "generated/generated_ids.h"\nextern const u8* const gStgAudioData[AUDIO_TYPE_COUNT];\nextern const bool gStgAudioLoops[AUDIO_TYPE_COUNT];\n#endif\n`,
    'src/generated/audio_data.c': `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "common.h"\n#include "generated/audio_data.h"\nconst u8* const gStgAudioData[AUDIO_TYPE_COUNT] =\n{\n${rows}\n};\nconst bool gStgAudioLoops[AUDIO_TYPE_COUNT] =\n{\n${loops}\n};\n`,
  };
}

function generateRenderDataFiles(snapshot) {
  const enemyRows = snapshot.enemies.map((enemy) => {
    const symbol = enemy.sprite ? `spr_enemy_${cSymbol(enemy.id, 'type')}` : 'spr_enemy_test';
    return `    [${cEnum(enemy.id, 'ENEMY')}] = &${symbol},`;
  }).join('\n');
  const bossRows = snapshot.bosses.map((boss) => {
    const symbol = boss.sprite ? `spr_boss_${cSymbol(boss.id, 'type')}` : 'spr_boss_part_test';
    return `    [${cEnum(boss.id, 'BOSS')}] = &${symbol},`;
  }).join('\n');
  return {
    'inc/generated/render_data.h': `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef HORIZONTAL_STG_RENDER_DATA_H\n#define HORIZONTAL_STG_RENDER_DATA_H\n#include <genesis.h>\n#include "generated/generated_ids.h"\nextern const SpriteDefinition* const gStgEnemySprites[ENEMY_TYPE_COUNT];\nextern const SpriteDefinition* const gStgBossSprites[BOSS_TYPE_COUNT];\n#endif\n`,
    'src/generated/render_data.c': `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "common.h"\n#include "generated/render_data.h"\nconst SpriteDefinition* const gStgEnemySprites[ENEMY_TYPE_COUNT] =\n{\n${enemyRows}\n};\nconst SpriteDefinition* const gStgBossSprites[BOSS_TYPE_COUNT] =\n{\n${bossRows}\n};\n`,
  };
}

function behaviorConstant(value) {
  const map = {
    straight: 'ENEMY_BEHAVIOR_STRAIGHT',
    sine: 'ENEMY_BEHAVIOR_SINE',
    zigzag: 'ENEMY_BEHAVIOR_ZIGZAG',
    hover: 'ENEMY_BEHAVIOR_HOVER',
    dive: 'ENEMY_BEHAVIOR_DIVE',
    anchor: 'ENEMY_BEHAVIOR_ANCHOR',
  };
  return map[String(value || '').toLowerCase()] || 'ENEMY_BEHAVIOR_STRAIGHT';
}

function fireConstant(value) {
  const map = { none: 'ENEMY_FIRE_NONE', cycle: 'ENEMY_FIRE_CYCLE', aimed: 'ENEMY_FIRE_AIMED', spread: 'ENEMY_FIRE_SPREAD' };
  return map[String(value || '').toLowerCase()] || 'ENEMY_FIRE_NONE';
}

function generateEnemySource(snapshot) {
  const registry = snapshot.id_registry.namespaces.enemies || {};
  const rows = snapshot.enemies.map((enemy) => `    [${cEnum(enemy.id, 'ENEMY')}] =\n    {\n        ${integer(enemy.hp, 3, 1, 32767)},\n        ${integer(enemy.vx256, -256, -32768, 32767)},\n        ${integer(enemy.vy256, 0, -32768, 32767)},\n        ${integer(enemy.score, 100, 0, 65535)},\n        ${integer(enemy.fire_interval, 120, 0, 65535)},\n        ${behaviorConstant(enemy.behavior)},\n        ${fireConstant(enemy.fire_pattern)},\n        ${integer(enemy.flags, 0, 0, 255)}\n    },`).join('\n');
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "generated/enemy_defs.h"\n\nconst EnemyDefinition gEnemyDefinitions[ENEMY_TYPE_COUNT] =\n{\n${rows}\n};\n`;
}

function bossMovementConstant(value) {
  const map = {
    stationary: 'BOSS_MOVE_STATIONARY', wave: 'BOSS_MOVE_WAVE', dash: 'BOSS_MOVE_DASH',
    orbit: 'BOSS_MOVE_ORBIT', anchor: 'BOSS_MOVE_ANCHOR', hunt: 'BOSS_MOVE_HUNT', spiral: 'BOSS_MOVE_SPIRAL',
  };
  return map[String(value || '').toLowerCase()] || 'BOSS_MOVE_STATIONARY';
}

function bossFireConstant(value) {
  const map = {
    aimed: 'BOSS_FIRE_AIMED', fan: 'BOSS_FIRE_FAN', wall: 'BOSS_FIRE_WALL',
    spiral: 'BOSS_FIRE_SPIRAL', lance: 'BOSS_FIRE_LANCE', lure: 'BOSS_FIRE_LURE',
    cross: 'BOSS_FIRE_CROSS', web: 'BOSS_FIRE_WEB', core: 'BOSS_FIRE_CORE',
  };
  return map[String(value || '').toLowerCase()] || 'BOSS_FIRE_AIMED';
}

function generateBossSource(snapshot) {
  const rows = snapshot.bosses.map((boss) => {
    const hp = Array.isArray(boss.part_hp) ? boss.part_hp.slice(0, 3) : [boss.hp || 20, boss.hp || 20, boss.core_hp || boss.hp || 60];
    while (hp.length < 3) hp.push(0);
    return `    [${cEnum(boss.id, 'BOSS')}] =\n    {\n        ${integer(boss.entry_x, 344, -32768, 32767)},\n        ${integer(boss.active_x, 272, -32768, 32767)},\n        ${integer(boss.y, 112, -32768, 32767)},\n        ${integer(boss.entry_vx256, -256, -32768, 32767)},\n        { ${hp.map((value) => integer(value, 1, 0, 32767)).join(', ')} },\n        ${integer(boss.score, integer(hp[2], 60, 1, 32767) * 100, 0, 9999999)}u,\n        ${integer(boss.fire_interval, 90, 1, 65535)},\n        ${integer(boss.death_frames, 120, 1, 65535)},\n        ${integer(boss.bomb_damage, 3, 0, 255)},\n        ${bossMovementConstant(boss.movement)},\n        ${bossFireConstant(boss.fire_pattern)},\n        ${integer(boss.forms, 1, 1, 2)}\n    },`;
  }).join('\n');
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "generated/boss_defs.h"\n\nconst BossDefinition gBossDefinitions[BOSS_TYPE_COUNT] =\n{\n${rows}\n};\n`;
}

function weaponPattern(value) {
  const map = {
    burst_laser: 'WEAPON_PATTERN_BURST_LASER',
    abyss_wave: 'WEAPON_PATTERN_ABYSS_WAVE',
    plasma_spread: 'WEAPON_PATTERN_PLASMA_SPREAD',
  };
  return map[String(value || '').toLowerCase()] || 'WEAPON_PATTERN_BURST_LASER';
}

function generateWeaponSource(snapshot) {
  const byColor = new Map(snapshot.weapons.map((weapon) => [String(weapon.color || weapon.id).toLowerCase(), weapon]));
  const colors = ['red', 'blue', 'green'];
  const rows = colors.map((color) => {
    const weapon = byColor.get(color) || {};
    const levels = Array.isArray(weapon.levels) ? weapon.levels : [];
    const levelRows = [0, 1, 2].map((index) => {
      const level = levels[index] || {};
      return `        { ${integer(level.damage, index + 1, 1, 255)}, ${weaponPattern(weapon.pattern)}, ${integer(level.speed256, 1024, -32768, 32767)}, ${integer(level.flags, 0, 0, 255)} },`;
    }).join('\n');
    return `    /* ${color.toUpperCase()} */\n    {\n${levelRows}\n    },`;
  }).join('\n');
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "generated/weapon_defs.h"\n\nconst WeaponDefinition gWeaponDefinitions[WEAPON_COLOR_COUNT][3] =\n{\n${rows}\n};\n`;
}

function generateStageEventFiles(snapshot) {
  const ids = buildIdMaps(snapshot);
  const files = {};
  orderedStages(snapshot).forEach((stage) => {
    const symbol = cSymbol(stage.id, 'stage');
    const frame = deltaStream(sortEvents(stage.events, 'frame'), ids);
    const scroll = deltaStream(sortEvents(stage.events, 'scroll'), ids);
    const condition = conditionStream(sortEvents(stage.events, 'condition'), ids);
    files[`inc/generated/${symbol}_events.h`] = `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#ifndef ${cEnum(`${symbol}_events_h`, 'GENERATED')}\n#define ${cEnum(`${symbol}_events_h`, 'GENERATED')}\n#include <genesis.h>\nextern const u8 ${symbol}_frame_stream[];\nextern const u8 ${symbol}_scroll_stream[];\nextern const u8 ${symbol}_condition_stream[];\n#endif\n`;
    files[`src/generated/${symbol}_events.c`] = `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include <genesis.h>\n#include "generated/${symbol}_events.h"\nconst u8 ${symbol}_frame_stream[] =\n{\n${formatByteArray(frame)}\n};\nconst u8 ${symbol}_scroll_stream[] =\n{\n${formatByteArray(scroll)}\n};\nconst u8 ${symbol}_condition_stream[] =\n{\n${formatByteArray(condition)}\n};\n`;
  });
  return files;
}

function generateStageSource(snapshot) {
  const ids = buildIdMaps(snapshot);
  const includes = orderedStages(snapshot).map((stage) => `#include "generated/${cSymbol(stage.id, 'stage')}_events.h"`).join('\n');
  const rows = orderedStages(snapshot).map((stage) => {
    const symbol = cSymbol(stage.id, 'stage');
    return `    [${cEnum(stage.id, 'STAGE')}] =\n    {\n        &ts_${symbol}_a, &map_${symbol}_a, &pal_${symbol}_a,\n        &ts_${symbol}_b, &map_${symbol}_b, &pal_${symbol}_b,\n        ${symbol}_frame_stream, ${symbol}_scroll_stream, ${symbol}_condition_stream,\n        ${stage.scroll_speed_256}, ${stage.length_px}u, ${stage.parallax_shift_b}, ${ids.audio[stage.music_id] || 0}, ${ids.bosses[stage.midboss_id] || 0}, ${ids.bosses[stage.boss_id] || 0}, 0\n    },`;
  }).join('\n');
  return `/* AUTO-GENERATED BY horizontal-stg-editor - DO NOT EDIT */\n#include "common.h"\n${includes}\n#include "generated/stage_defs.h"\n\nconst StageDefinition gStageDefinitions[STAGE_TYPE_COUNT] =\n{\n${rows}\n};\n`;
}

function quoteResPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/"/g, '');
}

function generateRes(snapshot) {
  const assets = { ...DEFAULT_SYSTEM_ASSETS, ...(snapshot.project.assets || {}) };
  const lines = [
    `IMAGE img_title_background "${quoteResPath(assets.title_background)}" NONE ALL 0`,
    `IMAGE img_title_logo "${quoteResPath(assets.title_logo)}" NONE ALL 0`,
    `TILESET ts_hud_icons "${quoteResPath(assets.hud_icons)}" NONE NONE`,
    '',
  ];
  orderedStages(snapshot).forEach((stage) => {
    const symbol = cSymbol(stage.id, 'stage');
    const bgA = quoteResPath(stage.assets.bg_a);
    const bgB = quoteResPath(stage.assets.bg_b);
    lines.push(`PALETTE pal_${symbol}_b "${bgB}"`);
    lines.push(`PALETTE pal_${symbol}_a "${bgA}"`);
    lines.push(`TILESET ts_${symbol}_b "${bgB}" BEST ALL`);
    lines.push(`MAP map_${symbol}_b "${bgB}" ts_${symbol}_b BEST 0`);
    lines.push(`TILESET ts_${symbol}_a "${bgA}" BEST ALL`);
    lines.push(`MAP map_${symbol}_a "${bgA}" ts_${symbol}_a BEST 0`);
    lines.push('');
  });
  const spriteLines = [
    'TILESET stg_sjis_font "font/misaki_gothic.png" NONE NONE',
    `SPRITE spr_player_test "${quoteResPath(assets.player)}" 3 2 NONE 5`,
    `SPRITE spr_enemy_test "${quoteResPath(assets.enemy_fallback)}" 2 2 NONE 5`,
    `SPRITE spr_player_bullet_test "${quoteResPath(assets.player_bullet)}" 1 1 NONE 1`,
    `SPRITE spr_enemy_bullet_test "${quoteResPath(assets.enemy_bullet)}" 1 1 NONE 1`,
    `SPRITE spr_charge_test "${quoteResPath(assets.charge)}" 2 1 NONE 4`,
    `SPRITE spr_core_test "${quoteResPath(assets.core)}" 2 1 NONE 4`,
    `SPRITE spr_item_red_test "${quoteResPath(assets.item_red)}" 1 1 NONE 4`,
    `SPRITE spr_item_blue_test "${quoteResPath(assets.item_blue)}" 1 1 NONE 4`,
    `SPRITE spr_item_green_test "${quoteResPath(assets.item_green)}" 1 1 NONE 4`,
    `SPRITE spr_item_power_test "${quoteResPath(assets.item_power)}" 1 1 NONE 4`,
    `SPRITE spr_item_speed_test "${quoteResPath(assets.item_speed)}" 1 1 NONE 4`,
    `SPRITE spr_item_core_test "${quoteResPath(assets.item_core)}" 1 1 NONE 4`,
    `SPRITE spr_item_bomb_test "${quoteResPath(assets.item_bomb)}" 1 1 NONE 4`,
    `SPRITE spr_boss_part_test "${quoteResPath(assets.boss_part)}" 2 2 NONE 8`,
    `SPRITE spr_explosion_test "${quoteResPath(assets.explosion)}" 2 2 NONE 4`,
  ];
  lines.push(...spriteLines, '');
  snapshot.enemies.filter((enemy) => enemy.sprite).forEach((enemy) => {
    const symbol = `spr_enemy_${cSymbol(enemy.id, 'type')}`;
    lines.push(`SPRITE ${symbol} "${quoteResPath(enemy.sprite)}" 3 2 NONE 5`);
  });
  snapshot.bosses.filter((boss) => boss.sprite).forEach((boss) => {
    const symbol = `spr_boss_${cSymbol(boss.id, 'type')}`;
    lines.push(`SPRITE ${symbol} "${quoteResPath(boss.sprite)}" 4 4 NONE 8`);
  });
  lines.push('');
  snapshot.audio.filter((cue) => cue.path).forEach((cue) => {
    if (String(cue.type || 'XGM2').toUpperCase() === 'DISABLED') return;
    const symbol = cSymbol(cue.symbol || cue.id, 'audio');
    const source = quoteResPath(cue.path);
    const type = String(cue.type || 'XGM2').toUpperCase();
    if (type === 'WAV') lines.push(`WAV ${symbol} "${source}" ${integer(cue.rate, 2, 1, 4)}`);
    else lines.push(`XGM2 ${symbol} "${source}"`);
  });
  return `${lines.join('\n')}\n`;
}

function generateFiles(input) {
  const snapshot = assignRuntimeIds(input);
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) return { ok: false, ...validation, files: {} };
  const gameDataFiles = generateGameDataFiles(snapshot);
  const audioDataFiles = generateAudioDataFiles(snapshot);
  const renderDataFiles = generateRenderDataFiles(snapshot);
  const files = {
    'inc/generated/generated_ids.h': generateIdsHeader(snapshot),
    'inc/generated/game_config.h': generateGameConfigHeader(snapshot),
    'src/generated/enemy_defs.c': generateEnemySource(snapshot),
    'src/generated/boss_defs.c': generateBossSource(snapshot),
    'src/generated/weapon_defs.c': generateWeaponSource(snapshot),
    'src/generated/stage_defs.c': generateStageSource(snapshot),
    'res/common.res': generateRes(snapshot),
    ...gameDataFiles,
    ...audioDataFiles,
    ...renderDataFiles,
    ...generateStageEventFiles(snapshot),
  };
  const report = {
    schema_version: SCHEMA_VERSION,
    title: snapshot.project.title,
    counts: {
      stages: snapshot.stages.length,
      enemies: snapshot.enemies.length,
      bosses: snapshot.bosses.length,
      weapons: snapshot.weapons.length,
      items: snapshot.items.length,
      effects: snapshot.effects.length,
      audio: snapshot.audio.length,
      events: snapshot.stages.reduce((sum, stage) => sum + stage.events.length, 0),
    },
    budgets: {
      rom_target_bytes: snapshot.project.rom.target_bytes,
      rom_hard_limit_bytes: snapshot.project.rom.hard_limit_bytes,
      pools: snapshot.project.pools,
    },
    generated_files: Object.keys(files).sort(),
    source_revision: revisionFor(snapshot),
  };
  files['out/reports/horizontal-stg-report.json'] = stableStringify(report);
  return { ok: true, snapshot, files, report, errors: [], warnings: validation.warnings };
}

module.exports = {
  SCHEMA_VERSION,
  RUNTIME_ID_MIN,
  RUNTIME_ID_MAX,
  DOCUMENT_KINDS,
  ENTITY_COLLECTIONS,
  DEFAULT_PROJECT,
  DEFAULT_SYSTEM_ASSETS,
  deepClone,
  stableStringify,
  revisionFor,
  safeId,
  cSymbol,
  normalizeProject,
  normalizeEntity,
  normalizeCollection,
  normalizeStage,
  normalizeSnapshot,
  assignRuntimeIds,
  validateSnapshot,
  orderedStages,
  generateFiles,
};
