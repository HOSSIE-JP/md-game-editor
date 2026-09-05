'use strict';

// Host-game schema for BulletML STG Studio 2.0. BMLB remains ABI v1; this
// module describes everything around the enemy-bullet VM.

const SCHEMA_VERSION = 2;
const NONE_RUNTIME_ID = 0;
const MAX_RUNTIME_ID = 255;
const COLLECTION_KINDS = Object.freeze([
  'weapons',
  'items',
  'effects',
  'explosions',
  'movements',
  'enemies',
  'bosses',
  'backgrounds',
  'collision-materials',
]);
const SINGLETON_KINDS = Object.freeze([
  'project',
  'pools',
  'game-flow',
  'input',
  'save',
  'player',
  'demo-bindings',
  'runtime-ids',
  'editor-state',
]);
const RUNTIME_CATALOGS = Object.freeze([...COLLECTION_KINDS, 'patterns', 'stages']);
const ASSET_TYPES = Object.freeze(['SPRITE', 'IMAGE', 'MAP', 'TILEMAP', 'VGM', 'XGM', 'XGM2', 'WAV']);
const STAGE_ORIENTATIONS = Object.freeze(['vertical', 'horizontal']);
const EVENT_TRIGGER_TYPES = Object.freeze(['frame', 'scroll', 'condition']);
const EVENT_ACTION_TYPES = Object.freeze([
  'spawn_enemy',
  'spawn_boss',
  'spawn_destructible',
  'set_scroll',
  'set_background',
  'set_wave',
  'set_flag',
  'clear_bullets',
  'stage_clear',
]);
const INTERPOLATIONS = Object.freeze(['step', 'linear', 'smoothstep']);
const WAVE_PRESETS = Object.freeze(['none', 'sine', 'dual-sine', 'ripple', 'shear', 'jitter']);
const DEMO_SLOTS = Object.freeze(['opening', 'preStage', 'postStage', 'endingRescue', 'endingDestroy']);
const PALETTE_SLOTS = Object.freeze({ PAL0: 'BG_B/HUD', PAL1: 'BG_A', PAL2: 'PLAYER/ITEM', PAL3: 'ENEMY/BULLET/EFFECT' });

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeId(value, fallback = '') {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return id || fallback;
}

function integer(value, fallback, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function number(value, fallback, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function bool(value, fallback = false) {
  return value == null ? fallback : Boolean(value);
}

function assetRef(symbol = '', type = 'SPRITE', extras = {}) {
  const normalizedType = String(type || '').toUpperCase();
  return {
    symbol: String(symbol || '').trim(),
    type: ASSET_TYPES.includes(normalizedType) ? normalizedType : normalizedType,
    ...clone(extras),
  };
}

function normalizeAssetRef(value, types, extras = {}) {
  const allowed = (Array.isArray(types) ? types : [types]).map((type) => String(type).toUpperCase());
  const source = value && typeof value === 'object' ? value : {};
  const type = String(source.type || allowed[0] || '').toUpperCase();
  const result = assetRef(source.symbol, type, extras);
  for (const [key, item] of Object.entries(source)) {
    if (!['path', 'source', 'sourcePath', 'sourceAbsolutePath', 'lineNumber'].includes(key)) result[key] = clone(item);
  }
  return result;
}

const DEFAULT_PROJECT = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  id: 'geroneko-abyss-strike',
  title: 'GERONEKO -ABYSS STRIKE-',
  target: Object.freeze({ platform: 'mega-drive', sgdk: '2.11', video: 'NTSC', width: 320, height: 224, hMode: 'H40', players: 1, romBytes: 4194304 }),
  rank: 0.5,
  modes: Object.freeze({ campaign: true, caravan: true }),
  campaign: Object.freeze({ startStageId: 'stage-1-vertical', continues: 3, carry: Object.freeze(['score', 'lives', 'bombs', 'weapon', 'speed']), continueScore: 0 }),
  caravan: Object.freeze({ stageId: 'caravan-abyss', timeLimitFrames: 7200 }),
  resetOnHit: Object.freeze({ weapon: 'retain', speed: 'normal', bombs: 'initial' }),
  palettes: Object.freeze({ PAL0: 'bg-b-hud', PAL1: 'bg-a', PAL2: 'player-item', PAL3: 'enemy-bullet-effect' }),
  patternOrder: Object.freeze([]),
  patternRoles: Object.freeze({ verticalNormal: '', verticalBoss: '', horizontalNormal: '', horizontalBoss: '' }),
});

const DEFAULT_POOLS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enemyBullets: 48,
  emitters: 5,
  vmContexts: 106,
  opcodesPerFrame: 512,
  bulletSpawnsPerFrame: 16,
  playerShots: 24,
  enemies: 12,
  items: 8,
  effects: 20,
  bossParts: 24,
  dmaWordsPerFrame: 7168,
  pcmChannels: 4,
});

const DEFAULT_GAME_FLOW = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  screens: Object.freeze(['title', 'mode-select', 'options', 'gameplay', 'pause', 'result', 'continue', 'game-over', 'name-entry', 'ranking']),
  titleFrames: 180,
  continueFrames: 600,
  nameLength: 3,
  autoSave: 'after-post-stage-demo-before-next-stage',
});

const DEFAULT_INPUT = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  defaults: Object.freeze({ shot: 'A', bomb: 'B', speedShift: 'C' }),
  remappable: Object.freeze(['shot', 'bomb', 'speedShift']),
  buttons: Object.freeze(['A', 'B', 'C']),
  rejectDuplicates: true,
  persistInSram: true,
});

const DEFAULT_SAVE = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  magic: 'GNAS',
  version: 1,
  checksum: 'crc16-ccitt',
  nameLength: 3,
  topCount: 10,
  campaignRanking: Object.freeze(['score', 'stagesCleared', 'playFrames']),
  caravanRanking: Object.freeze(['score', 'remainingFrames']),
  checkpoint: Object.freeze(['nextStageId', 'score', 'lives', 'bombs', 'weaponId', 'speed', 'flags', 'stagesCleared']),
  resumeRankingEligible: true,
});

const DEFAULT_PLAYER = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  id: 'player',
  name: 'GERONEKO',
  sprite: Object.freeze({ symbol: 'player_ship', type: 'SPRITE', animationRow: 1 }),
  animation: Object.freeze({
    axis: 'stage',
    vertical: Object.freeze({ negative: 0, neutral: 1, positive: 2 }),
    horizontal: Object.freeze({ negative: 3, neutral: 4, positive: 5 }),
  }),
  hitbox: Object.freeze({ x: 0, y: 0, radius: 3 }),
  speeds: Object.freeze({ slow: 96, normal: 160, fast: 224, unit: 'q8-pixels-per-frame' }),
  initial: Object.freeze({ lives: 3, bombs: 3, weaponId: 'needle', speed: 'normal' }),
});

const DEFAULT_COLLECTIONS = Object.freeze({
  weapons: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'weapons', entries: Object.freeze([]) }),
  items: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'items', entries: Object.freeze([]) }),
  effects: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'effects', entries: Object.freeze([]) }),
  explosions: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'explosions', entries: Object.freeze([]) }),
  movements: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'movements', entries: Object.freeze([]) }),
  enemies: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'enemies', entries: Object.freeze([]) }),
  bosses: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'bosses', entries: Object.freeze([]) }),
  backgrounds: Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'backgrounds', entries: Object.freeze([]) }),
  'collision-materials': Object.freeze({ schemaVersion: SCHEMA_VERSION, kind: 'collision-materials', entries: Object.freeze([]) }),
});

const DEFAULT_DEMO_BINDINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  canonicalSceneDocument: 'assets/pce-vn-scenes.json',
  opening: '',
  stages: Object.freeze({}),
  endings: Object.freeze({ rescue: '', destroy: '' }),
  endingSelector: Object.freeze({ flag: '', rescueWhen: true }),
  flags: Object.freeze([]),
  font: Object.freeze({ kind: 'bundled', size: 16, subset: true, includeAscii: true }),
});

const DEFAULT_RUNTIME_IDS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  none: NONE_RUNTIME_ID,
  catalogs: Object.freeze(Object.fromEntries(RUNTIME_CATALOGS.map((kind) => [kind, Object.freeze({})]))),
  retired: Object.freeze(Object.fromEntries(RUNTIME_CATALOGS.map((kind) => [kind, Object.freeze({})]))),
});

function normalizeProject(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...clone(DEFAULT_PROJECT),
    ...clone(source),
    schemaVersion: SCHEMA_VERSION,
    target: { ...clone(DEFAULT_PROJECT.target), ...(source.target || {}) },
    modes: { ...clone(DEFAULT_PROJECT.modes), ...(source.modes || {}) },
    campaign: { ...clone(DEFAULT_PROJECT.campaign), ...(source.campaign || {}) },
    caravan: { ...clone(DEFAULT_PROJECT.caravan), ...(source.caravan || {}) },
    resetOnHit: { ...clone(DEFAULT_PROJECT.resetOnHit), ...(source.resetOnHit || {}) },
    palettes: { ...clone(DEFAULT_PROJECT.palettes), ...(source.palettes || {}) },
    rank: number(source.rank, DEFAULT_PROJECT.rank, 0, 1),
    patternOrder: [...new Set((Array.isArray(source.patternOrder) ? source.patternOrder : []).map(String))],
    patternRoles: { ...clone(DEFAULT_PROJECT.patternRoles), ...(source.patternRoles || {}) },
  };
}

function normalizePools(value = {}) {
  const result = { ...clone(DEFAULT_POOLS), ...(value || {}), schemaVersion: SCHEMA_VERSION };
  for (const key of Object.keys(DEFAULT_POOLS).filter((key) => key !== 'schemaVersion')) result[key] = integer(result[key], DEFAULT_POOLS[key], 1, 65535);
  return result;
}

function normalizeGameFlow(value = {}) {
  return { ...clone(DEFAULT_GAME_FLOW), ...(value || {}), schemaVersion: SCHEMA_VERSION };
}

function normalizeInput(value = {}) {
  return {
    ...clone(DEFAULT_INPUT),
    ...(value || {}),
    schemaVersion: SCHEMA_VERSION,
    defaults: { ...clone(DEFAULT_INPUT.defaults), ...(value.defaults || {}) },
    remappable: [...(Array.isArray(value.remappable) ? value.remappable : DEFAULT_INPUT.remappable)].map(String),
    buttons: [...(Array.isArray(value.buttons) ? value.buttons : DEFAULT_INPUT.buttons)].map(String),
  };
}

function normalizeSave(value = {}) {
  return { ...clone(DEFAULT_SAVE), ...(value || {}), schemaVersion: SCHEMA_VERSION };
}

function normalizePlayer(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...clone(DEFAULT_PLAYER),
    ...clone(source),
    schemaVersion: SCHEMA_VERSION,
    sprite: normalizeAssetRef(source.sprite || DEFAULT_PLAYER.sprite, 'SPRITE', { animationRow: integer(source.sprite?.animationRow, 1, 0, 255) }),
    animation: {
      ...clone(DEFAULT_PLAYER.animation),
      ...(source.animation || {}),
      vertical: { ...clone(DEFAULT_PLAYER.animation.vertical), ...(source.animation?.vertical || {}) },
      horizontal: { ...clone(DEFAULT_PLAYER.animation.horizontal), ...(source.animation?.horizontal || {}) },
    },
    hitbox: { ...clone(DEFAULT_PLAYER.hitbox), ...(source.hitbox || {}) },
    speeds: { ...clone(DEFAULT_PLAYER.speeds), ...(source.speeds || {}) },
    initial: { ...clone(DEFAULT_PLAYER.initial), ...(source.initial || {}) },
  };
}

function normalizeWaypoint(value = {}, index = 0) {
  return {
    x: number(value.x, 160),
    y: number(value.y, 32),
    durationFrames: integer(value.durationFrames ?? value.frame, index ? 60 : 0, 0, 65535),
    interpolation: INTERPOLATIONS.includes(value.interpolation) ? value.interpolation : 'linear',
  };
}

function normalizeWeapon(value = {}, index = 0) {
  const id = safeId(value.id, `weapon-${index + 1}`);
  return {
    ...clone(value),
    id,
    name: String(value.name || id),
    sprite: normalizeAssetRef(value.sprite, 'SPRITE'),
    intervalFrames: integer(value.intervalFrames, 6, 1, 600),
    damage: integer(value.damage, 1, 1, 65535),
    speed: number(value.speed, 4, -32, 32),
    angle: number(value.angle, 0, -360, 360),
    simultaneous: integer(value.simultaneous, 1, 1, 24),
    duplicateScore: integer(value.duplicateScore, 1000, 0, 99999999),
    emitters: (Array.isArray(value.emitters) ? value.emitters : [{ x: 0, y: -8, angle: 0 }]).map((item) => ({ x: number(item.x, 0), y: number(item.y, -8), angle: number(item.angle, 0, -360, 360) })),
  };
}

function normalizeItem(value = {}, index = 0) {
  const id = safeId(value.id, `item-${index + 1}`);
  const type = ['weapon', 'bomb', 'score'].includes(value.type) ? value.type : 'score';
  return {
    ...clone(value), id, type, name: String(value.name || id),
    sprite: normalizeAssetRef(value.sprite, 'SPRITE'),
    weaponId: type === 'weapon' ? String(value.weaponId || '') : '',
    amount: integer(value.amount, 1, 1, 65535),
    score: integer(value.score, type === 'score' ? 1000 : 0, 0, 99999999),
  };
}

function normalizeEffect(value = {}, index = 0) {
  const id = safeId(value.id, `effect-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id),
    sprite: normalizeAssetRef(value.sprite, 'SPRITE', { animationRow: integer(value.sprite?.animationRow, 0, 0, 255) }),
    durationFrames: integer(value.durationFrames, 30, 1, 65535),
    se: normalizeAssetRef(value.se, 'WAV'),
  };
}

function normalizeExplosion(value = {}, index = 0) {
  const id = safeId(value.id, `explosion-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id),
    placements: (Array.isArray(value.placements) ? value.placements : []).map((item) => ({
      frame: integer(item.frame, 0, 0, 65535), effectId: String(item.effectId || ''), x: number(item.x, 0), y: number(item.y, 0),
    })).sort((left, right) => left.frame - right.frame),
  };
}

function normalizeMovement(value = {}, index = 0) {
  const id = safeId(value.id, `movement-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id), loop: bool(value.loop),
    waypoints: (Array.isArray(value.waypoints) ? value.waypoints : []).map(normalizeWaypoint),
  };
}

function normalizeDrop(value) {
  if (!value || typeof value !== 'object' || !value.itemId) return null;
  return { itemId: String(value.itemId), chance: 1 };
}

function normalizeEnemy(value = {}, index = 0) {
  const id = safeId(value.id, `enemy-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id),
    sprite: normalizeAssetRef(value.sprite, 'SPRITE', { animationRow: integer(value.sprite?.animationRow, 0, 0, 255) }),
    hp: integer(value.hp, 3, 1, 65535), score: integer(value.score, 100, 0, 99999999),
    hitbox: { x: number(value.hitbox?.x, 0), y: number(value.hitbox?.y, 0), radius: integer(value.hitbox?.radius, 6, 1, 255) },
    movementId: String(value.movementId || ''), patternId: String(value.patternId || ''),
    drop: normalizeDrop(value.drop), explosionId: String(value.explosionId || ''),
    se: normalizeAssetRef(value.se, 'WAV'), destructibleBackground: bool(value.destructibleBackground),
  };
}

function normalizeBossPart(value = {}, index = 0) {
  return {
    ...clone(value), id: safeId(value.id, `part-${index + 1}`),
    hp: integer(value.hp, 30, 1, 65535),
    globalHpTransfer: number(value.globalHpTransfer, 1, 0, 1),
    hitbox: { x: number(value.hitbox?.x, 0), y: number(value.hitbox?.y, 0), radius: integer(value.hitbox?.radius, 12, 1, 255) },
    explosionId: String(value.explosionId || ''), disableEventId: String(value.disableEventId || ''),
    followBackground: bool(value.followBackground),
  };
}

function normalizeBossPhase(value = {}, index = 0) {
  return {
    ...clone(value), threshold: integer(value.threshold, Math.max(0, 100 - index * 20), 0, 100),
    patternId: String(value.patternId || ''), movementId: String(value.movementId || ''),
    rankOverride: value.rankOverride == null ? null : number(value.rankOverride, 0.5, 0, 1),
    activeParts: (Array.isArray(value.activeParts) ? value.activeParts : []).map(String),
    backgroundId: String(value.backgroundId || ''), wave: normalizeWave(value.wave), clearBullets: bool(value.clearBullets),
  };
}

function normalizeBoss(value = {}, index = 0) {
  const base = normalizeEnemy(value, index);
  return {
    ...base,
    id: safeId(value.id, `boss-${index + 1}`),
    phases: (Array.isArray(value.phases) ? value.phases : []).map(normalizeBossPhase),
    parts: (Array.isArray(value.parts) ? value.parts : []).map(normalizeBossPart),
    giantBackground: bool(value.giantBackground), arenaPlane: 'BG_B', bossPlane: 'BG_A',
  };
}

function normalizeBand(value = {}, index = 0) {
  return {
    start: integer(value.start, index * 28, 0, 319), end: integer(value.end, index * 28 + 27, 0, 319),
    multiplier: number(value.multiplier, 1, -8, 8),
  };
}

function normalizeWave(value) {
  if (!value || typeof value !== 'object') return { preset: 'none', start: 0, end: 223, amplitude: 0, wavelength: 64, speed: 0, fadeFrames: 0 };
  return {
    preset: WAVE_PRESETS.includes(value.preset) ? value.preset : 'none',
    start: integer(value.start, 0, 0, 319), end: integer(value.end, 223, 0, 319),
    amplitude: number(value.amplitude, 0, -64, 64), wavelength: number(value.wavelength, 64, 1, 1024),
    speed: number(value.speed, 0, -32, 32), fadeFrames: integer(value.fadeFrames, 0, 0, 65535),
  };
}

function normalizePlane(value = {}, plane = 'BG_A') {
  return {
    map: normalizeAssetRef(value.map, ['MAP', 'TILEMAP'], { collisionLayer: String(value.map?.collisionLayer || '') }),
    bands: (Array.isArray(value.bands) ? value.bands : [{ start: 0, end: plane === 'BG_A' ? 223 : 223, multiplier: 1 }]).map(normalizeBand),
    wave: normalizeWave(value.wave),
  };
}

function normalizeBackground(value = {}, index = 0) {
  const id = safeId(value.id, `background-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id),
    BG_A: normalizePlane(value.BG_A, 'BG_A'), BG_B: normalizePlane(value.BG_B, 'BG_B'),
    transition: ['cut', 'fade'].includes(value.transition) ? value.transition : 'cut',
    fadeFrames: integer(value.fadeFrames, 16, 0, 255),
  };
}

function normalizeCollisionMaterial(value = {}, index = 0) {
  const id = safeId(value.id, `material-${index + 1}`);
  return {
    ...clone(value), id, name: String(value.name || id), solid: bool(value.solid), damage: integer(value.damage, 0, 0, 255),
    masks: {
      player: bool(value.masks?.player, true), enemy: bool(value.masks?.enemy),
      playerShot: bool(value.masks?.playerShot), enemyShot: bool(value.masks?.enemyShot),
    },
  };
}

const COLLECTION_NORMALIZERS = Object.freeze({
  weapons: normalizeWeapon, items: normalizeItem, effects: normalizeEffect, explosions: normalizeExplosion,
  movements: normalizeMovement, enemies: normalizeEnemy, bosses: normalizeBoss,
  backgrounds: normalizeBackground, 'collision-materials': normalizeCollisionMaterial,
});

function normalizeCollection(kind, value = {}) {
  if (!COLLECTION_KINDS.includes(kind)) throw new Error(`Unknown BulletML collection: ${kind}`);
  const entries = Array.isArray(value) ? value : (Array.isArray(value.entries) ? value.entries : []);
  return { schemaVersion: SCHEMA_VERSION, kind, entries: entries.map(COLLECTION_NORMALIZERS[kind]) };
}

function normalizeDemoBindings(value = {}) {
  return {
    ...clone(DEFAULT_DEMO_BINDINGS), ...(value || {}), schemaVersion: SCHEMA_VERSION,
    stages: { ...(value.stages || {}) }, endings: { ...clone(DEFAULT_DEMO_BINDINGS.endings), ...(value.endings || {}) },
    endingSelector: { ...clone(DEFAULT_DEMO_BINDINGS.endingSelector), ...(value.endingSelector || {}) },
    flags: [...(Array.isArray(value.flags) ? value.flags : [])].map(String),
    font: { ...clone(DEFAULT_DEMO_BINDINGS.font), ...(value.font || {}) },
  };
}

function normalizeRuntimeIds(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION, none: NONE_RUNTIME_ID,
    catalogs: Object.fromEntries(RUNTIME_CATALOGS.map((kind) => [kind, { ...(source.catalogs?.[kind] || {}) }])),
    retired: Object.fromEntries(RUNTIME_CATALOGS.map((kind) => [kind, { ...(source.retired?.[kind] || {}) }])),
  };
}

function normalizeTrigger(value = {}, legacyFrame = 0) {
  const type = EVENT_TRIGGER_TYPES.includes(value.type) ? value.type : 'frame';
  return {
    type,
    frame: integer(value.frame ?? legacyFrame, legacyFrame, 0, 65535),
    scroll: number(value.scroll, 0, 0, 0x7fffffff),
    flag: String(value.flag || ''), operator: ['set', 'clear'].includes(value.operator) ? value.operator : 'set',
    bossId: String(value.bossId || ''),
  };
}

function normalizeStageAction(value = {}, legacy = {}) {
  let type = EVENT_ACTION_TYPES.includes(value.type) ? value.type : '';
  if (!type) type = legacy.boss ? 'spawn_boss' : 'spawn_enemy';
  return {
    ...clone(value), type,
    enemyId: String(value.enemyId || legacy.enemyId || legacy.enemyType || ''),
    bossId: String(value.bossId || legacy.bossId || (legacy.boss ? legacy.enemyType : '') || ''),
    backgroundId: String(value.backgroundId || ''), plane: ['BG_A', 'BG_B'].includes(value.plane) ? value.plane : 'BG_A',
    value: number(value.value, 0), durationFrames: integer(value.durationFrames, 0, 0, 65535),
    interpolation: INTERPOLATIONS.includes(value.interpolation) ? value.interpolation : 'step',
    transition: ['cut', 'fade'].includes(value.transition) ? value.transition : 'cut',
    wave: normalizeWave(value.wave), flag: String(value.flag || ''),
  };
}

function normalizeStageEvent(value = {}, index = 0) {
  const boss = bool(value.boss || value.action?.type === 'spawn_boss');
  const trigger = normalizeTrigger(value.trigger, integer(value.spawnFrame, 0, 0, 65535));
  const action = normalizeStageAction(value.action, { ...value, boss });
  return {
    ...clone(value), schemaVersion: undefined,
    id: safeId(value.id, `event-${index + 1}`), order: integer(value.order, index, 0, 65535),
    trigger, action,
    // Compatibility projection consumed by the existing ABI-v1 stage simulator.
    spawnFrame: trigger.frame, enemyType: String(value.enemyType || action.enemyId || action.bossId || (boss ? 'boss' : 'grunt')),
    boss, hp: integer(value.hp, boss ? 120 : 3, 1, 65535), score: integer(value.score, boss ? 10000 : 100, 0, 99999999),
    patternId: String(value.patternId || ''), movementId: String(value.movementId || ''), dropItemId: String(value.dropItemId || ''),
    path: (Array.isArray(value.path) ? value.path : []).map((point, pointIndex) => ({
      x: number(point.x, 160), y: number(point.y, 32 + pointIndex * 24), frame: integer(point.frame, pointIndex * 60, 0, 65535),
      interpolation: INTERPOLATIONS.includes(point.interpolation) ? point.interpolation : 'linear',
    })),
    phases: (Array.isArray(value.phases) ? value.phases : []).map(normalizeBossPhase),
  };
}

function normalizeStage(value = {}, fallbackId = 'stage') {
  const id = safeId(value.id, safeId(fallbackId, 'stage'));
  const orientation = STAGE_ORIENTATIONS.includes(value.orientation) ? value.orientation : 'vertical';
  return {
    ...clone(value), schemaVersion: SCHEMA_VERSION, id, name: String(value.name || id), orientation,
    durationFrames: integer(value.durationFrames, 3600, 1, 65535),
    backgroundId: String(value.backgroundId || ''), collisionMap: normalizeAssetRef(value.collisionMap, ['MAP', 'TILEMAP'], { collisionLayer: String(value.collisionMap?.collisionLayer || '') }),
    mainScroll: { speed: number(value.mainScroll?.speed, orientation === 'vertical' ? 1 : 0.75, -32, 32), axis: orientation === 'vertical' ? 'y' : 'x' },
    next: (Array.isArray(value.next) ? value.next : []).map((edge) => ({ stageId: String(edge.stageId || ''), flag: String(edge.flag || ''), equals: edge.equals == null ? true : Boolean(edge.equals) })),
    events: (Array.isArray(value.events) ? value.events : []).map(normalizeStageEvent).sort((left, right) => (left.order - right.order) || (left.trigger.frame - right.trigger.frame) || left.id.localeCompare(right.id, 'en')),
  };
}

function liveIds(snapshot, kind) {
  if (kind === 'patterns') return (snapshot.patterns || []).map((entry) => entry.id);
  if (kind === 'stages') return (snapshot.stages || []).map((entry) => entry.id);
  return (snapshot.collections?.[kind]?.entries || snapshot[kind]?.entries || []).map((entry) => entry.id);
}

function reconcileRuntimeIds(snapshot, registryInput = snapshot.runtimeIds) {
  const registry = normalizeRuntimeIds(registryInput);
  for (const kind of RUNTIME_CATALOGS) {
    const current = registry.catalogs[kind];
    const retired = registry.retired[kind];
    const ids = new Set(liveIds(snapshot, kind));
    for (const [id, runtimeId] of Object.entries(current)) {
      if (!ids.has(id)) { retired[id] = runtimeId; delete current[id]; }
    }
    const reserved = new Set([
      ...Object.values(current).map(Number),
      ...Object.values(retired).map(Number),
      NONE_RUNTIME_ID,
    ]);
    for (const id of [...ids].sort((left, right) => left.localeCompare(right, 'en'))) {
      if (current[id] != null) continue;
      if (retired[id] != null) { current[id] = retired[id]; delete retired[id]; continue; }
      let next = 1;
      while (next <= MAX_RUNTIME_ID && reserved.has(next)) next += 1;
      if (next > MAX_RUNTIME_ID) throw new Error(`${kind} runtime ID catalog exceeds ${MAX_RUNTIME_ID}`);
      current[id] = next;
      reserved.add(next);
    }
  }
  return registry;
}

function diagnostic(severity, code, path, message) {
  return { severity, code, path, message };
}

function validateAssetReference(reference, path, diagnostics, types = null, allowNone = false) {
  if (!reference || typeof reference !== 'object') {
    diagnostics.push(diagnostic('error', 'STG_ASSET_REF_REQUIRED', path, 'asset reference must be { symbol, type }'));
    return;
  }
  const forbidden = ['path', 'source', 'sourcePath', 'sourceAbsolutePath', 'lineNumber'].find((key) => reference[key] != null && reference[key] !== '');
  if (forbidden) diagnostics.push(diagnostic('error', 'STG_ASSET_PHYSICAL_REF', `${path}.${forbidden}`, 'physical path/line references are not persisted in schema v2'));
  if (!reference.symbol && !allowNone) diagnostics.push(diagnostic('error', 'STG_ASSET_SYMBOL_REQUIRED', `${path}.symbol`, 'asset symbol is required'));
  const type = String(reference.type || '').toUpperCase();
  const allowed = types ? (Array.isArray(types) ? types : [types]).map((item) => String(item).toUpperCase()) : ASSET_TYPES;
  if (reference.symbol && !allowed.includes(type)) diagnostics.push(diagnostic('error', 'STG_ASSET_TYPE', `${path}.type`, `${type || '(empty)'} is not one of ${allowed.join('/')}`));
}

function validateCollection(collection, kind, diagnostics, indexes) {
  const ids = new Set();
  const entries = collection?.entries || [];
  if (entries.length > MAX_RUNTIME_ID) diagnostics.push(diagnostic('error', 'STG_CATALOG_LIMIT', kind, `${kind} has more than 255 entries`));
  entries.forEach((entry, index) => {
    const path = `${kind}.entries[${index}]`;
    if (!entry.id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.id)) diagnostics.push(diagnostic('error', 'STG_ID', `${path}.id`, 'stable ID is required'));
    if (ids.has(entry.id)) diagnostics.push(diagnostic('error', 'STG_ID_DUPLICATE', `${path}.id`, `duplicate stable ID: ${entry.id}`));
    ids.add(entry.id);
    if (['weapons', 'items', 'effects', 'enemies', 'bosses'].includes(kind)) validateAssetReference(entry.sprite, `${path}.sprite`, diagnostics, 'SPRITE');
    if (['effects', 'enemies', 'bosses'].includes(kind) && entry.se?.symbol) validateAssetReference(entry.se, `${path}.se`, diagnostics, 'WAV', true);
    if (kind === 'weapons' && entry.simultaneous > indexes.pools.playerShots) diagnostics.push(diagnostic('error', 'STG_PLAYER_SHOT_POOL', `${path}.simultaneous`, 'weapon simultaneous count exceeds player shot pool'));
    if (kind === 'items' && entry.type === 'weapon' && !indexes.weapons.has(entry.weaponId)) diagnostics.push(diagnostic('error', 'STG_WEAPON_REF', `${path}.weaponId`, `weapon does not exist: ${entry.weaponId}`));
    if (kind === 'explosions') entry.placements.forEach((placement, placementIndex) => {
      if (!indexes.effects.has(placement.effectId)) diagnostics.push(diagnostic('error', 'STG_EFFECT_REF', `${path}.placements[${placementIndex}].effectId`, `effect does not exist: ${placement.effectId}`));
    });
    if (kind === 'movements') {
      if (!entry.waypoints.length) diagnostics.push(diagnostic('error', 'STG_MOVEMENT_EMPTY', `${path}.waypoints`, 'movement needs at least one waypoint'));
      if (entry.waypoints.length > 32) diagnostics.push(diagnostic('error', 'STG_MOVEMENT_LIMIT', `${path}.waypoints`, 'movement has more than 32 waypoints'));
    }
    if (['enemies', 'bosses'].includes(kind)) {
      if (entry.movementId && !indexes.movements.has(entry.movementId)) diagnostics.push(diagnostic('error', 'STG_MOVEMENT_REF', `${path}.movementId`, `movement does not exist: ${entry.movementId}`));
      if (entry.patternId && !indexes.patterns.has(entry.patternId)) diagnostics.push(diagnostic('error', 'STG_PATTERN_REF', `${path}.patternId`, `pattern does not exist: ${entry.patternId}`));
      if (entry.drop?.itemId && !indexes.items.has(entry.drop.itemId)) diagnostics.push(diagnostic('error', 'STG_ITEM_REF', `${path}.drop.itemId`, `item does not exist: ${entry.drop.itemId}`));
      if (entry.explosionId && !indexes.explosions.has(entry.explosionId)) diagnostics.push(diagnostic('error', 'STG_EXPLOSION_REF', `${path}.explosionId`, `explosion does not exist: ${entry.explosionId}`));
    }
    if (kind === 'bosses') {
      if (entry.phases.length < 1 || entry.phases.length > 8) diagnostics.push(diagnostic('error', 'STG_BOSS_PHASE_LIMIT', `${path}.phases`, 'boss needs 1..8 phases'));
      entry.phases.forEach((phase, phaseIndex) => {
        if (phaseIndex && phase.threshold >= entry.phases[phaseIndex - 1].threshold) diagnostics.push(diagnostic('error', 'STG_BOSS_PHASE_ORDER', `${path}.phases[${phaseIndex}].threshold`, 'phase thresholds must descend'));
        if (phase.patternId && !indexes.patterns.has(phase.patternId)) diagnostics.push(diagnostic('error', 'STG_PATTERN_REF', `${path}.phases[${phaseIndex}].patternId`, `pattern does not exist: ${phase.patternId}`));
        if (phase.movementId && !indexes.movements.has(phase.movementId)) diagnostics.push(diagnostic('error', 'STG_MOVEMENT_REF', `${path}.phases[${phaseIndex}].movementId`, `movement does not exist: ${phase.movementId}`));
      });
    }
    if (kind === 'backgrounds') {
      for (const plane of ['BG_A', 'BG_B']) {
        validateAssetReference(entry[plane].map, `${path}.${plane}.map`, diagnostics, ['MAP', 'TILEMAP'], true);
        const bands = entry[plane].bands;
        if (bands.length > 8) diagnostics.push(diagnostic('error', 'STG_BACKGROUND_BAND_LIMIT', `${path}.${plane}.bands`, 'plane has more than 8 bands'));
        const sorted = [...bands].sort((left, right) => left.start - right.start);
        sorted.forEach((band, bandIndex) => {
          if (band.end < band.start) diagnostics.push(diagnostic('error', 'STG_BACKGROUND_BAND_RANGE', `${path}.${plane}.bands[${bandIndex}]`, 'band end precedes start'));
          if (bandIndex && band.start <= sorted[bandIndex - 1].end) diagnostics.push(diagnostic('error', 'STG_BACKGROUND_BAND_OVERLAP', `${path}.${plane}.bands[${bandIndex}]`, 'bands overlap'));
        });
      }
    }
  });
}

function stageGraphDiagnostics(stages, project) {
  const diagnostics = [];
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  for (const stage of stages) {
    stage.next.forEach((edge, index) => {
      if (!byId.has(edge.stageId)) diagnostics.push(diagnostic('error', 'STG_STAGE_EDGE_MISSING', `stages.${stage.id}.next[${index}]`, `stage does not exist: ${edge.stageId}`));
    });
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, chain = []) {
    if (visiting.has(id)) { diagnostics.push(diagnostic('error', 'STG_STAGE_GRAPH_CYCLE', `stages.${id}.next`, `campaign graph must be a DAG: ${[...chain, id].join(' -> ')}`)); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    byId.get(id).next.forEach((edge) => visit(edge.stageId, [...chain, id]));
    visiting.delete(id);
    visited.add(id);
  }
  visit(project.campaign.startStageId);
  if (!byId.has(project.campaign.startStageId)) diagnostics.push(diagnostic('error', 'STG_CAMPAIGN_START', 'project.campaign.startStageId', 'campaign start stage does not exist'));
  if (!byId.has(project.caravan.stageId)) diagnostics.push(diagnostic('error', 'STG_CARAVAN_STAGE', 'project.caravan.stageId', 'caravan stage does not exist'));
  for (const stage of stages.filter((entry) => entry.id !== project.caravan.stageId)) if (!visited.has(stage.id)) diagnostics.push(diagnostic('warning', 'STG_STAGE_UNREACHABLE', `stages.${stage.id}`, 'stage is unreachable from campaign start'));
  return diagnostics;
}

function validateStage(stage, indexes) {
  const diagnostics = [];
  const eventIds = new Set();
  let clearCount = 0;
  stage.events.forEach((event, index) => {
    const path = `stages.${stage.id}.events[${index}]`;
    if (eventIds.has(event.id)) diagnostics.push(diagnostic('error', 'STG_EVENT_DUPLICATE', `${path}.id`, `duplicate event ID: ${event.id}`));
    eventIds.add(event.id);
    if (!EVENT_TRIGGER_TYPES.includes(event.trigger.type)) diagnostics.push(diagnostic('error', 'STG_EVENT_TRIGGER', `${path}.trigger.type`, 'unknown trigger type'));
    if (!EVENT_ACTION_TYPES.includes(event.action.type)) diagnostics.push(diagnostic('error', 'STG_EVENT_ACTION', `${path}.action.type`, 'unknown action type'));
    if (event.trigger.type === 'frame' && event.trigger.frame >= stage.durationFrames) diagnostics.push(diagnostic('error', 'STG_EVENT_FRAME', `${path}.trigger.frame`, 'event is outside stage duration'));
    if (event.action.type === 'spawn_enemy' && !indexes.enemies.has(event.action.enemyId)) diagnostics.push(diagnostic('error', 'STG_ENEMY_REF', `${path}.action.enemyId`, `enemy does not exist: ${event.action.enemyId}`));
    if (event.action.type === 'spawn_boss' && !indexes.bosses.has(event.action.bossId)) diagnostics.push(diagnostic('error', 'STG_BOSS_REF', `${path}.action.bossId`, `boss does not exist: ${event.action.bossId}`));
    if (event.action.type === 'set_background' && !indexes.backgrounds.has(event.action.backgroundId)) diagnostics.push(diagnostic('error', 'STG_BACKGROUND_REF', `${path}.action.backgroundId`, `background does not exist: ${event.action.backgroundId}`));
    if (event.action.type === 'stage_clear') clearCount += 1;
  });
  if (clearCount !== 1) diagnostics.push(diagnostic('error', 'STG_STAGE_CLEAR', `stages.${stage.id}.events`, 'each stage needs exactly one explicit stage_clear event'));
  if (stage.backgroundId && !indexes.backgrounds.has(stage.backgroundId)) diagnostics.push(diagnostic('error', 'STG_BACKGROUND_REF', `stages.${stage.id}.backgroundId`, `background does not exist: ${stage.backgroundId}`));
  if (stage.collisionMap?.symbol) validateAssetReference(stage.collisionMap, `stages.${stage.id}.collisionMap`, diagnostics, ['MAP', 'TILEMAP'], true);
  return diagnostics;
}

function validateRuntimeIds(snapshot, registry, diagnostics) {
  for (const kind of RUNTIME_CATALOGS) {
    const expected = new Set(liveIds(snapshot, kind));
    const assigned = registry.catalogs[kind] || {};
    const values = new Set();
    for (const id of expected) {
      const value = Number(assigned[id]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_RUNTIME_ID) diagnostics.push(diagnostic('error', 'STG_RUNTIME_ID_MISSING', `runtimeIds.catalogs.${kind}.${id}`, 'live entry needs stable runtime ID 1..255'));
      if (values.has(value)) diagnostics.push(diagnostic('error', 'STG_RUNTIME_ID_DUPLICATE', `runtimeIds.catalogs.${kind}.${id}`, `runtime ID ${value} is duplicated`));
      values.add(value);
    }
    for (const id of Object.keys(assigned)) if (!expected.has(id)) diagnostics.push(diagnostic('error', 'STG_RUNTIME_ID_STALE', `runtimeIds.catalogs.${kind}.${id}`, 'deleted entry must be moved to retired IDs'));
  }
}

function validateSnapshot(snapshot, assetIndex = null) {
  const diagnostics = [];
  const project = normalizeProject(snapshot.project);
  const collections = Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind, normalizeCollection(kind, snapshot.collections?.[kind] || snapshot[kind] || {})]));
  const indexes = {
    pools: normalizePools(snapshot.pools),
    patterns: new Set((snapshot.patterns || []).map((entry) => entry.id)),
    stages: new Set((snapshot.stages || []).map((entry) => entry.id)),
    ...Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind.replace('collision-materials', 'collisionMaterials'), new Set(collections[kind].entries.map((entry) => entry.id))])),
  };
  // Keep hyphenated and common aliases available to validators.
  indexes.backgrounds = new Set(collections.backgrounds.entries.map((entry) => entry.id));
  indexes.movements = new Set(collections.movements.entries.map((entry) => entry.id));
  indexes.explosions = new Set(collections.explosions.entries.map((entry) => entry.id));
  indexes.effects = new Set(collections.effects.entries.map((entry) => entry.id));
  indexes.enemies = new Set(collections.enemies.entries.map((entry) => entry.id));
  indexes.bosses = new Set(collections.bosses.entries.map((entry) => entry.id));
  indexes.items = new Set(collections.items.entries.map((entry) => entry.id));
  indexes.weapons = new Set(collections.weapons.entries.map((entry) => entry.id));

  if (project.target.sgdk !== '2.11' || project.target.video !== 'NTSC' || project.target.width !== 320 || project.target.height !== 224 || project.target.hMode !== 'H40' || project.target.players !== 1) diagnostics.push(diagnostic('error', 'STG_TARGET_FIXED', 'project.target', 'target must be SGDK 2.11 / NTSC / H40 320x224 / 1P'));
  if (project.target.romBytes > 4194304) diagnostics.push(diagnostic('error', 'STG_ROM_LIMIT', 'project.target.romBytes', 'ROM limit is 4 MiB'));
  if (new Set(Object.values(normalizeInput(snapshot.input).defaults)).size !== 3) diagnostics.push(diagnostic('error', 'STG_INPUT_DUPLICATE', 'input.defaults', 'shot/bomb/speedShift buttons must not overlap'));
  if (normalizeSave(snapshot.save).nameLength !== 3 || normalizeSave(snapshot.save).topCount !== 10) diagnostics.push(diagnostic('error', 'STG_SAVE_CONTRACT', 'save', 'rankings require Top10 and a 3-character name'));
  validateAssetReference(normalizePlayer(snapshot.player).sprite, 'player.sprite', diagnostics, 'SPRITE');
  for (const kind of COLLECTION_KINDS) validateCollection(collections[kind], kind, diagnostics, indexes);
  const stages = (snapshot.stages || []).map((entry) => normalizeStage(entry, entry.id));
  stages.forEach((stage) => diagnostics.push(...validateStage(stage, indexes)));
  diagnostics.push(...stageGraphDiagnostics(stages, project));
  validateRuntimeIds({ ...snapshot, collections, stages }, normalizeRuntimeIds(snapshot.runtimeIds), diagnostics);

  if (assetIndex) {
    const refs = collectAssetRefs({ project, player: normalizePlayer(snapshot.player), collections, stages });
    for (const ref of refs) {
      if (!ref.value.symbol) continue;
      const matches = assetIndex.get(ref.value.symbol) || [];
      if (!matches.length) diagnostics.push(diagnostic('error', 'STG_ASSET_MISSING', ref.path, `ResComp symbol does not exist: ${ref.value.symbol}`));
      else if (matches.length > 1) diagnostics.push(diagnostic('error', 'STG_ASSET_DUPLICATE', ref.path, `ResComp symbol is duplicated: ${ref.value.symbol}`));
      else if (String(matches[0].type).toUpperCase() !== String(ref.value.type).toUpperCase()) diagnostics.push(diagnostic('error', 'STG_ASSET_TYPE_MISMATCH', `${ref.path}.type`, `${ref.value.symbol} is ${matches[0].type}, not ${ref.value.type}`));
    }
  }
  return { ok: !diagnostics.some((item) => item.severity === 'error'), diagnostics, errors: diagnostics.filter((item) => item.severity === 'error'), warnings: diagnostics.filter((item) => item.severity === 'warning') };
}

function collectAssetRefs(value, basePath = '', result = []) {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'symbol') && Object.prototype.hasOwnProperty.call(value, 'type')) {
    result.push({ path: basePath || 'asset', value });
    return result;
  }
  if (Array.isArray(value)) value.forEach((item, index) => collectAssetRefs(item, `${basePath}[${index}]`, result));
  else Object.entries(value).forEach(([key, item]) => collectAssetRefs(item, basePath ? `${basePath}.${key}` : key, result));
  return result;
}

function normalizeDocument(kind, value) {
  if (kind === 'project') return normalizeProject(value);
  if (kind === 'pools') return normalizePools(value);
  if (kind === 'game-flow') return normalizeGameFlow(value);
  if (kind === 'input') return normalizeInput(value);
  if (kind === 'save') return normalizeSave(value);
  if (kind === 'player') return normalizePlayer(value);
  if (kind === 'demo-bindings') return normalizeDemoBindings(value);
  if (kind === 'runtime-ids') return normalizeRuntimeIds(value);
  if (COLLECTION_KINDS.includes(kind)) return normalizeCollection(kind, value);
  throw new Error(`Unknown BulletML document: ${kind}`);
}

module.exports = {
  SCHEMA_VERSION,
  NONE_RUNTIME_ID,
  MAX_RUNTIME_ID,
  COLLECTION_KINDS,
  SINGLETON_KINDS,
  RUNTIME_CATALOGS,
  ASSET_TYPES,
  STAGE_ORIENTATIONS,
  EVENT_TRIGGER_TYPES,
  EVENT_ACTION_TYPES,
  INTERPOLATIONS,
  WAVE_PRESETS,
  DEMO_SLOTS,
  PALETTE_SLOTS,
  DEFAULT_PROJECT,
  DEFAULT_POOLS,
  DEFAULT_GAME_FLOW,
  DEFAULT_INPUT,
  DEFAULT_SAVE,
  DEFAULT_PLAYER,
  DEFAULT_COLLECTIONS,
  DEFAULT_DEMO_BINDINGS,
  DEFAULT_RUNTIME_IDS,
  clone,
  safeId,
  assetRef,
  normalizeAssetRef,
  normalizeProject,
  normalizePools,
  normalizeGameFlow,
  normalizeInput,
  normalizeSave,
  normalizePlayer,
  normalizeCollection,
  normalizeDemoBindings,
  normalizeRuntimeIds,
  normalizeStageEvent,
  normalizeStage,
  reconcileRuntimeIds,
  collectAssetRefs,
  validateAssetReference,
  validateSnapshot,
  normalizeDocument,
};
