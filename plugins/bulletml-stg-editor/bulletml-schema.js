'use strict';

const crypto = require('node:crypto');
const expression = require('./bulletml-expression');
const hostSchema = require('./stg-schema-v2');

const SCHEMA_VERSION = hostSchema.SCHEMA_VERSION;
const PATTERN_TYPES = Object.freeze(['none', 'vertical', 'horizontal']);
const DEFINITION_KINDS = Object.freeze(['action', 'bullet', 'fire']);
const DIRECTION_TYPES = Object.freeze(['aim', 'absolute', 'relative', 'sequence']);
const SPEED_TYPES = Object.freeze(['absolute', 'relative', 'sequence']);
const COMMANDS = Object.freeze(['fire', 'fireRef', 'wait', 'repeat', 'vanish', 'changeDirection', 'changeSpeed', 'actionRef']);
const PATTERN_ROLES = Object.freeze(['verticalNormal', 'verticalBoss', 'horizontalNormal', 'horizontalBoss']);

const LIMITS = Object.freeze({
  topActions: 2,
  bulletActions: 2,
  params: 4,
  referenceDepth: 4,
  repeatDepth: 4,
  definitions: 255,
  bytecode: 65535,
  bullets: 48,
  emitters: 5,
  contexts: 106,
  spawnsPerFrame: 16,
  opcodesPerFrame: 512,
  stages: Object.freeze({ events: 255, activeNormalEnemies: 12, activeBosses: 1, waypoints: 32, bossPhases: 8 }),
});

const DEFAULT_SPRITE = Object.freeze({
  asset: Object.freeze({ symbol: 'bml_bullet', type: 'SPRITE', animationRow: 0 }),
  palette: 'PAL3',
  paletteFingerprint: '',
  frameWidth: 8,
  frameHeight: 8,
  frameCount: 1,
  hardwarePieces: 1,
  tileCount: 1,
});

const DEFAULT_PROJECT = Object.freeze({
  ...hostSchema.DEFAULT_PROJECT,
  profile: Object.freeze({
    coordinateScale: 64,
    expressionFormat: 'Q16.16',
    angleFormat: 'u16-turn-clockwise-up',
    trigEntries: 1024,
    bulletLimit: LIMITS.bullets,
    emitterLimit: LIMITS.emitters,
    contextLimit: LIMITS.contexts,
    spawnLimitPerFrame: LIMITS.spawnsPerFrame,
    opcodeLimitPerFrame: LIMITS.opcodesPerFrame,
    defaultLifetimeFrames: 600,
    defaultCullMargin: 32,
  }),
  defaultSprite: DEFAULT_SPRITE,
  patternOrder: Object.freeze([]),
  patternRoles: Object.freeze(Object.fromEntries(PATTERN_ROLES.map((role) => [role, '']))),
});

const DEFAULT_EDITOR_STATE = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  page: 'project',
  selectedPatternId: '',
  selectedDefinition: '',
  selectedCommandPath: '',
  view: 'structured',
  previewLoop: true,
  stagePathMode: 'selected',
  panes: Object.freeze({ left: 260, right: 340, preview: 330 }),
  graph: Object.freeze({ zoom: 1, panX: 0, panY: 0, positions: Object.freeze({}) }),
});

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function revisionFor(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function safeId(value, fallback = '') {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return id || fallback;
}

function normalizeBinding(value, kind) {
  if (!value || typeof value !== 'object') return { ref: '', params: [] };
  return {
    ref: String(value.ref || ''),
    params: (Array.isArray(value.params) ? value.params : []).map((item) => String(item ?? '0')),
    ...(kind === 'bullet' && value.inline ? { inline: normalizeBullet(value.inline) } : {}),
    ...(kind === 'action' && Array.isArray(value.commands) ? { commands: normalizeCommands(value.commands) } : {}),
  };
}

function normalizeDirection(value, fallbackType = 'aim') {
  if (!value || typeof value !== 'object') return null;
  return { type: DIRECTION_TYPES.includes(value.type) ? value.type : fallbackType, value: String(value.value ?? '0') };
}

function normalizeSpeed(value) {
  if (!value || typeof value !== 'object') return null;
  return { type: SPEED_TYPES.includes(value.type) ? value.type : 'absolute', value: String(value.value ?? '0') };
}

function normalizeBullet(value = {}) {
  return {
    direction: normalizeDirection(value.direction, 'aim'),
    speed: normalizeSpeed(value.speed),
    actions: (Array.isArray(value.actions) ? value.actions : []).map((item) => normalizeBinding(item, 'action')),
  };
}

function normalizeFire(value = {}) {
  return {
    direction: normalizeDirection(value.direction, 'aim'),
    speed: normalizeSpeed(value.speed),
    bullet: normalizeBinding(value.bullet, 'bullet'),
  };
}

function normalizeCommand(command = {}) {
  const op = COMMANDS.includes(command.op) ? command.op : String(command.op || 'wait');
  if (op === 'fire') return { op, ...normalizeFire(command) };
  if (op === 'fireRef') return { op, ref: String(command.ref || ''), params: (command.params || []).map(String) };
  if (op === 'wait') return { op, value: String(command.value ?? '1') };
  if (op === 'repeat') return { op, times: String(command.times ?? '1'), action: normalizeBinding(command.action, 'action') };
  if (op === 'vanish') return { op };
  if (op === 'changeDirection') return { op, direction: normalizeDirection(command.direction, 'aim'), term: String(command.term ?? '1') };
  if (op === 'changeSpeed') return { op, speed: normalizeSpeed(command.speed), term: String(command.term ?? '1') };
  if (op === 'actionRef') return { op, ref: String(command.ref || ''), params: (command.params || []).map(String) };
  return { ...deepClone(command), op };
}

function normalizeCommands(commands) {
  return (Array.isArray(commands) ? commands : []).map(normalizeCommand);
}

function normalizeDefinition(value = {}, index = 0) {
  const kind = DEFINITION_KINDS.includes(value.kind) ? value.kind : 'action';
  const definition = { kind, label: String(value.label || `${kind}-${index + 1}`) };
  if (kind === 'action') definition.commands = normalizeCommands(value.commands);
  if (kind === 'bullet') Object.assign(definition, normalizeBullet(value));
  if (kind === 'fire') Object.assign(definition, normalizeFire(value));
  return definition;
}

function normalizePattern(value = {}, fallbackId = 'pattern') {
  const id = safeId(value.id, fallbackId);
  const sprite = {
    ...deepClone(DEFAULT_SPRITE),
    ...(value.sprite || {}),
    asset: hostSchema.normalizeAssetRef(value.sprite?.asset || DEFAULT_SPRITE.asset, 'SPRITE', { animationRow: Math.max(0, Math.trunc(Number(value.sprite?.asset?.animationRow) || 0)) }),
  };
  delete sprite.source;
  delete sprite.sourcePath;
  delete sprite.assetId;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: String(value.name || id),
    type: PATTERN_TYPES.includes(value.type) ? value.type : 'none',
    rootActions: (Array.isArray(value.rootActions) ? value.rootActions : ['top']).map(String),
    definitions: (Array.isArray(value.definitions) ? value.definitions : []).map(normalizeDefinition),
    sprite,
    hitbox: { x: Math.trunc(Number(value.hitbox?.x) || 0), y: Math.trunc(Number(value.hitbox?.y) || 0), radius: Math.trunc(Number(value.hitbox?.radius) || 3) },
    lifetime: Math.trunc(Number(value.lifetime) || 600),
    margin: Math.trunc(Number(value.margin) || 32),
  };
}

function normalizeProject(value = {}) {
  const project = { ...hostSchema.normalizeProject(value), ...deepClone(DEFAULT_PROJECT), ...deepClone(value || {}) };
  project.schemaVersion = SCHEMA_VERSION;
  project.target = { ...deepClone(DEFAULT_PROJECT.target), ...(value.target || {}) };
  project.modes = { ...deepClone(hostSchema.DEFAULT_PROJECT.modes), ...(value.modes || {}) };
  project.campaign = { ...deepClone(hostSchema.DEFAULT_PROJECT.campaign), ...(value.campaign || {}) };
  project.caravan = { ...deepClone(hostSchema.DEFAULT_PROJECT.caravan), ...(value.caravan || {}) };
  project.resetOnHit = { ...deepClone(hostSchema.DEFAULT_PROJECT.resetOnHit), ...(value.resetOnHit || {}) };
  project.palettes = { ...deepClone(hostSchema.DEFAULT_PROJECT.palettes), ...(value.palettes || {}) };
  project.rank = Math.max(0, Math.min(1, Number(value.rank ?? hostSchema.DEFAULT_PROJECT.rank)));
  project.profile = { ...deepClone(DEFAULT_PROJECT.profile), ...(value.profile || {}) };
  project.defaultSprite = { ...deepClone(DEFAULT_SPRITE), ...(value.defaultSprite || {}) };
  project.patternOrder = [...new Set((Array.isArray(value.patternOrder) ? value.patternOrder : []).map(String))];
  project.patternRoles = { ...deepClone(DEFAULT_PROJECT.patternRoles), ...(value.patternRoles || {}) };
  return project;
}

function normalizeEditorState(value = {}) {
  return {
    ...deepClone(DEFAULT_EDITOR_STATE),
    ...(value || {}),
    panes: { ...deepClone(DEFAULT_EDITOR_STATE.panes), ...(value.panes || {}) },
    graph: { ...deepClone(DEFAULT_EDITOR_STATE.graph), ...(value.graph || {}), positions: { ...(value.graph?.positions || {}) } },
  };
}

function normalizeWaypoint(value = {}, index = 0) {
  return { x: Number(value.x ?? 160), y: Number(value.y ?? 32 + index * 24), frame: Math.max(0, Math.trunc(Number(value.frame) || index * 60)) };
}

function normalizeStageEvent(value = {}, index = 0) {
  const event = hostSchema.normalizeStageEvent(value, index);
  event.path = (Array.isArray(value.path) ? value.path : event.path || []).map(normalizeWaypoint);
  event.phases = (Array.isArray(value.phases) ? value.phases : event.phases || []).map((phase, phaseIndex) => ({
    ...phase,
    threshold: Math.max(0, Math.min(100, Math.trunc(Number(phase.threshold) || Math.max(0, 100 - phaseIndex * 20)))),
    patternId: String(phase.patternId || value.patternId || ''),
  }));
  return event;
}

function normalizeStage(value = {}, orientationOrId = 'stage') {
  const fallback = value.id || (['vertical', 'horizontal'].includes(orientationOrId) ? `stage-${orientationOrId}` : orientationOrId);
  const orientation = value.orientation || (['vertical', 'horizontal'].includes(orientationOrId) ? orientationOrId : undefined);
  const normalized = hostSchema.normalizeStage({ ...value, orientation }, fallback);
  normalized.events = normalized.events.map(normalizeStageEvent);
  return normalized;
}

function makeAction(label, commands) {
  return { kind: 'action', label, commands };
}

function fire(direction, speed = '1.5', bulletRef = '') {
  return {
    op: 'fire',
    direction: { type: direction.type || 'aim', value: String(direction.value ?? '0') },
    speed: { type: 'absolute', value: String(speed) },
    bullet: bulletRef ? { ref: bulletRef, params: [] } : { ref: '', params: [], inline: { actions: [] } },
  };
}

function createPatternTemplate(templateId = 'blank', requestedId = '') {
  const id = safeId(requestedId, `pattern-${templateId}`);
  const patterns = {
    blank: [makeAction('top', [])],
    aimed: [makeAction('top', [{ op: 'repeat', times: '999', action: { commands: [fire({ type: 'aim', value: '0' }), { op: 'wait', value: '30' }] } }])],
    fan: [makeAction('top', [{ op: 'repeat', times: '999', action: { commands: [
      fire({ type: 'aim', value: '-24' }), fire({ type: 'sequence', value: '8' }), fire({ type: 'sequence', value: '8' }), fire({ type: 'sequence', value: '8' }), fire({ type: 'sequence', value: '8' }), fire({ type: 'sequence', value: '8' }), fire({ type: 'sequence', value: '8' }), { op: 'wait', value: '50' },
    ] } }])],
    rotation: [makeAction('top', [{ op: 'repeat', times: '999', action: { commands: [fire({ type: 'absolute', value: '$1' }), { op: 'wait', value: '4' }, { op: 'actionRef', ref: 'spin', params: ['$1+13'] }] } }]), makeAction('spin', [fire({ type: 'absolute', value: '$1' })])],
    rank: [makeAction('top', [{ op: 'repeat', times: '999', action: { commands: [fire({ type: 'aim', value: '-20*$rank' }, '1.2+1.2*$rank'), fire({ type: 'sequence', value: '10*$rank' }, '1.2+1.2*$rank'), { op: 'wait', value: '50-25*$rank' }] } }])],
    rand: [makeAction('top', [{ op: 'repeat', times: '999', action: { commands: [fire({ type: 'absolute', value: '360*$rand' }, '1+2*$rand'), { op: 'wait', value: '5' }] } }])],
    speed: [makeAction('top', [fire({ type: 'aim', value: '0' }, '0.5', 'speed-bullet')]), { kind: 'bullet', label: 'speed-bullet', actions: [{ commands: [{ op: 'wait', value: '30' }, { op: 'changeSpeed', speed: { type: 'absolute', value: '3' }, term: '60' }, { op: 'wait', value: '120' }, { op: 'vanish' }] }] }],
    turn: [makeAction('top', [fire({ type: 'absolute', value: '0' }, '1.5', 'turn-bullet')]), { kind: 'bullet', label: 'turn-bullet', actions: [{ commands: [{ op: 'wait', value: '30' }, { op: 'changeDirection', direction: { type: 'aim', value: '0' }, term: '90' }, { op: 'wait', value: '180' }, { op: 'vanish' }] }] }],
    split: [makeAction('top', [fire({ type: 'aim', value: '0' }, '1.1', 'split-parent')]), { kind: 'bullet', label: 'split-parent', actions: [{ commands: [{ op: 'wait', value: '70' }, fire({ type: 'absolute', value: '-70' }, '1.8'), fire({ type: 'sequence', value: '35' }, '1.8'), fire({ type: 'sequence', value: '35' }, '1.8'), fire({ type: 'sequence', value: '35' }, '1.8'), fire({ type: 'sequence', value: '35' }, '1.8'), { op: 'vanish' }] }] }],
    reference: [
      makeAction('top', [{ op: 'repeat', times: '999', action: { ref: 'volley', params: [] } }]),
      makeAction('volley', [{ op: 'fireRef', ref: 'aimed-fire', params: [] }, { op: 'wait', value: '45-15*$rank' }]),
      { kind: 'fire', label: 'aimed-fire', direction: { type: 'aim', value: '0' }, speed: { type: 'absolute', value: '1.5+0.7*$rank' }, bullet: { ref: 'payload', params: [] } },
      { kind: 'bullet', label: 'payload', direction: null, speed: null, actions: [{ commands: [{ op: 'wait', value: '180' }, { op: 'vanish' }] }] },
    ],
  };
  return normalizePattern({ id, name: templateId === 'blank' ? 'New Pattern' : `Template: ${templateId}`, type: 'none', rootActions: ['top'], definitions: deepClone(patterns[templateId] || patterns.blank) }, id);
}

function diagnostic(severity, code, path, message) {
  return { severity, code, path, message };
}

function validatePattern(patternInput, options = {}) {
  const pattern = normalizePattern(patternInput, 'pattern');
  const diagnostics = [];
  const error = (code, path, message) => diagnostics.push(diagnostic('error', code, path, message));
  const warning = (code, path, message) => diagnostics.push(diagnostic('warning', code, path, message));
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(pattern.id)) error('BML_ID', 'id', 'pattern IDは英小文字・数字・_・-で指定してください');
  if (!PATTERN_TYPES.includes(pattern.type)) error('BML_TYPE', 'type', 'typeはnone/vertical/horizontalです');
  if (pattern.definitions.length > LIMITS.definitions) error('BML_DEFINITION_LIMIT', 'definitions', `定義は${LIMITS.definitions}件以下です`);
  const byKey = new Map();
  pattern.definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`;
    if (!definition.label) error('BML_LABEL_REQUIRED', `${path}.label`, 'labelが必要です');
    const key = `${definition.kind}:${definition.label}`;
    if (byKey.has(key)) error('BML_DUPLICATE_LABEL', `${path}.label`, `${definition.kind} labelが重複しています: ${definition.label}`);
    else byKey.set(key, definition);
    if (definition.kind === 'bullet' && definition.actions.length > LIMITS.bulletActions) error('BML_BULLET_ACTION_LIMIT', `${path}.actions`, `bullet内actionは${LIMITS.bulletActions}個以下です`);
  });
  if (pattern.rootActions.length < 1 || pattern.rootActions.length > LIMITS.topActions) error('BML_TOP_LIMIT', 'rootActions', `top actionは1..${LIMITS.topActions}個です`);
  pattern.rootActions.forEach((label, index) => {
    if (!/^top/i.test(label)) error('BML_TOP_LABEL', `rootActions[${index}]`, 'top action labelはtopで始めてください');
    if (!byKey.has(`action:${label}`)) error('BML_TOP_REF', `rootActions[${index}]`, `action ${label} がありません`);
  });
  function checkExpr(value, path, rule = '') {
    try {
      const parsed = expression.parseExpression(String(value ?? '0'));
      expression.compileExpression(parsed.ast);
      if (!parsed.dynamic) {
        const truncated = Math.trunc(parsed.constant);
        if ((rule === 'nonnegative' && truncated < 0) || (rule === 'positive' && truncated < 1) || truncated > 65535) {
          error('BML_U16_RANGE', path, `${rule === 'positive' ? '1..65535' : '0..65535'}へ切り捨て可能な式が必要です`);
        }
      }
    } catch (cause) {
      error('BML_EXPRESSION', path, cause.message);
    }
  }
  function checkParams(params, path) {
    if ((params || []).length > LIMITS.params) error('BML_PARAM_LIMIT', path, `paramは${LIMITS.params}個以下です`);
    (params || []).forEach((param, index) => checkExpr(param, `${path}[${index}]`));
  }
  function checkDirection(value, path) {
    if (!value) return;
    if (!DIRECTION_TYPES.includes(value.type)) error('BML_DIRECTION_TYPE', `${path}.type`, 'direction typeが不正です');
    checkExpr(value.value, `${path}.value`);
  }
  function checkSpeed(value, path) {
    if (!value) return;
    if (!SPEED_TYPES.includes(value.type)) error('BML_SPEED_TYPE', `${path}.type`, 'speed typeが不正です');
    checkExpr(value.value, `${path}.value`);
  }
  const edges = [];
  function checkBinding(binding, kind, path, repeatDepth) {
    checkParams(binding?.params, `${path}.params`);
    if (binding?.ref) {
      if (!byKey.has(`${kind}:${binding.ref}`)) error('BML_UNRESOLVED_REF', `${path}.ref`, `${kind} ${binding.ref} がありません`);
      edges.push({ from: path.split('.')[0], to: `${kind}:${binding.ref}`, path });
    } else if (kind === 'action' && Array.isArray(binding?.commands)) {
      checkCommands(binding.commands, `${path}.commands`, repeatDepth);
    } else if (kind === 'bullet' && binding?.inline) {
      checkBullet(binding.inline, `${path}.inline`, repeatDepth);
    } else error('BML_BINDING_REQUIRED', path, `${kind} refまたはinline定義が必要です`);
  }
  function checkFire(value, path, repeatDepth) {
    checkDirection(value.direction, `${path}.direction`);
    checkSpeed(value.speed, `${path}.speed`);
    checkBinding(value.bullet, 'bullet', `${path}.bullet`, repeatDepth);
  }
  function checkBullet(value, path, repeatDepth) {
    checkDirection(value.direction, `${path}.direction`);
    checkSpeed(value.speed, `${path}.speed`);
    if ((value.actions || []).length > LIMITS.bulletActions) error('BML_BULLET_ACTION_LIMIT', `${path}.actions`, `bullet内actionは${LIMITS.bulletActions}個以下です`);
    (value.actions || []).forEach((binding, index) => checkBinding(binding, 'action', `${path}.actions[${index}]`, repeatDepth));
  }
  function checkCommands(commands, basePath, repeatDepth = 0) {
    (commands || []).forEach((command, index) => {
      const path = `${basePath}[${index}]`;
      if (!COMMANDS.includes(command.op)) { error('BML_UNKNOWN_COMMAND', `${path}.op`, `非対応commandです: ${command.op}`); return; }
      if (command.op === 'fire') checkFire(command, path, repeatDepth);
      else if (command.op === 'fireRef') { checkParams(command.params, `${path}.params`); if (!byKey.has(`fire:${command.ref}`)) error('BML_UNRESOLVED_REF', `${path}.ref`, `fire ${command.ref} がありません`); }
      else if (command.op === 'wait') checkExpr(command.value, `${path}.value`, 'nonnegative');
      else if (command.op === 'repeat') {
        checkExpr(command.times, `${path}.times`, 'nonnegative');
        if (repeatDepth + 1 > LIMITS.repeatDepth) error('BML_REPEAT_DEPTH', path, `repeat深さは${LIMITS.repeatDepth}以下です`);
        checkBinding(command.action, 'action', `${path}.action`, repeatDepth + 1);
      } else if (command.op === 'changeDirection') {
        checkDirection(command.direction, `${path}.direction`);
        checkExpr(command.term, `${path}.term`, 'positive');
      } else if (command.op === 'changeSpeed') {
        checkSpeed(command.speed, `${path}.speed`);
        checkExpr(command.term, `${path}.term`, 'positive');
      } else if (command.op === 'actionRef') {
        checkParams(command.params, `${path}.params`);
        if (!byKey.has(`action:${command.ref}`)) error('BML_UNRESOLVED_REF', `${path}.ref`, `action ${command.ref} がありません`);
      }
    });
  }
  pattern.definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`;
    if (definition.kind === 'action') checkCommands(definition.commands, `${path}.commands`);
    else if (definition.kind === 'bullet') checkBullet(definition, path, 0);
    else checkFire(definition, path, 0);
  });
  const adjacency = new Map();
  pattern.definitions.forEach((definition, index) => adjacency.set(`${definition.kind}:${definition.label}`, []));
  function collectRefs(value, owner) {
    if (!value || typeof value !== 'object') return;
    if (value.ref && value.kindHint) adjacency.get(owner)?.push(`${value.kindHint}:${value.ref}`);
    if (Array.isArray(value)) value.forEach((item) => collectRefs(item, owner));
    else Object.values(value).forEach((item) => collectRefs(item, owner));
  }
  function annotate(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(annotate);
    const next = { ...value };
    if (next.op === 'actionRef' || next.action) {
      if (next.op === 'actionRef') next.kindHint = 'action';
      if (next.action?.ref) next.action = { ...next.action, kindHint: 'action' };
    }
    if (next.op === 'fireRef') next.kindHint = 'fire';
    if (next.bullet?.ref) next.bullet = { ...next.bullet, kindHint: 'bullet' };
    Object.keys(next).forEach((key) => { if (key !== 'kindHint') next[key] = annotate(next[key]); });
    return next;
  }
  pattern.definitions.forEach((definition) => collectRefs(annotate(definition), `${definition.kind}:${definition.label}`));
  const visiting = new Set();
  const visited = new Set();
  function visit(key, depth, chain) {
    if (visiting.has(key)) { error('BML_RECURSION', key, `再帰参照は禁止です: ${[...chain, key].join(' -> ')}`); return; }
    if (depth > LIMITS.referenceDepth) { error('BML_REF_DEPTH', key, `参照深さは${LIMITS.referenceDepth}以下です`); return; }
    if (visited.has(`${key}:${depth}`)) return;
    visiting.add(key);
    (adjacency.get(key) || []).forEach((next) => visit(next, depth + 1, [...chain, key]));
    visiting.delete(key);
    visited.add(`${key}:${depth}`);
  }
  pattern.rootActions.forEach((label) => visit(`action:${label}`, 0, []));
  const width = Number(pattern.sprite.frameWidth);
  const height = Number(pattern.sprite.frameHeight);
  const frameCount = Number(pattern.sprite.frameCount);
  if (![8, 16, 24, 32].includes(width) || ![8, 16, 24, 32].includes(height)) error('BML_SPRITE_SIZE', 'sprite', '全frameは8/16/24/32pxの範囲・8px単位で指定してください');
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 255) error('BML_SPRITE_FRAME_COUNT', 'sprite.frameCount', 'frameCountは1..255です');
  if (Number(pattern.sprite.hardwarePieces) !== 1) error('BML_SPRITE_PIECE', 'sprite.hardwarePieces', '弾spriteは1 hardware pieceだけ使用できます');
  if (String(pattern.sprite.palette) !== 'PAL3') error('BML_SPRITE_PALETTE', 'sprite.palette', 'Sampleと弾spriteはPAL3を使用します');
  hostSchema.validateAssetReference(pattern.sprite.asset, 'sprite.asset', diagnostics, 'SPRITE');
  const expectedTileCount = width * height / 64 * frameCount;
  if (Number(pattern.sprite.tileCount) !== expectedTileCount) error('BML_TILE_COUNT', 'sprite.tileCount', `frame寸法とframeCountから計算した${expectedTileCount} tileを指定してください`);
  if (expectedTileCount > 128) error('BML_TILE_LIMIT', 'sprite.tileCount', '全弾tile総量は128以下です');
  if (!Number.isInteger(pattern.hitbox.radius) || pattern.hitbox.radius < 1) error('BML_HITBOX', 'hitbox.radius', 'hitboxは半径1以上の整数円です');
  if (pattern.lifetime < 1 || pattern.lifetime > 65535) error('BML_LIFETIME', 'lifetime', '寿命は1..65535 frameです');
  if (pattern.margin < 0 || pattern.margin > 255) error('BML_MARGIN', 'margin', '画面外余白は0..255pxです');
  if (!pattern.sprite.paletteFingerprint) warning('BML_PALETTE_FINGERPRINT', 'sprite.paletteFingerprint', 'palette fingerprintはBuilderでasset検査時に確定します');
  if (options.byteLength >= LIMITS.bytecode) error('BML_BYTECODE_LIMIT', 'definitions', `BMLBは${LIMITS.bytecode} byte未満である必要があります`);
  return { ok: !diagnostics.some((item) => item.severity === 'error'), pattern, diagnostics, errors: diagnostics.filter((item) => item.severity === 'error'), warnings: diagnostics.filter((item) => item.severity === 'warning') };
}

function validateStage(stageInput, patternIds = new Set()) {
  const stage = normalizeStage(stageInput, stageInput?.id || stageInput?.orientation);
  const diagnostics = [];
  const error = (code, path, message) => diagnostics.push(diagnostic('error', code, path, message));
  const eventIds = new Set();
  let stageClearCount = 0;
  if (stage.durationFrames > 65535) error('BML_STAGE_DURATION', 'durationFrames', 'stage durationは1..65535 frameです');
  if (stage.events.length > LIMITS.stages.events) error('BML_STAGE_EVENT_LIMIT', 'events', `eventは${LIMITS.stages.events}件以下です`);
  stage.events.forEach((event, index) => {
    const path = `events[${index}]`;
    const actionType = event.action?.type || (event.boss ? 'spawn_boss' : 'spawn_enemy');
    const isSpawn = actionType === 'spawn_enemy' || actionType === 'spawn_boss' || actionType === 'spawn_destructible';
    if (eventIds.has(event.id)) error('BML_STAGE_EVENT_DUPLICATE', `${path}.id`, `event ID ${event.id} が重複しています`);
    eventIds.add(event.id);
    if (event.spawnFrame >= stage.durationFrames || event.spawnFrame > 65535) error('BML_STAGE_SPAWN_FRAME', `${path}.spawnFrame`, '出現frameはstage duration内のu16で指定してください');
    if (actionType === 'stage_clear') stageClearCount += 1;
    if (!hostSchema.EVENT_ACTION_TYPES.includes(actionType)) error('BML_STAGE_ACTION_TYPE', `${path}.action.type`, `非対応stage actionです: ${actionType}`);
    if (!isSpawn) return;
    if (!event.path.length) error('BML_STAGE_PATH_EMPTY', `${path}.path`, 'waypointを1点以上指定してください');
    if (event.path.length > LIMITS.stages.waypoints) error('BML_STAGE_PATH_LIMIT', `${path}.path`, `waypointは${LIMITS.stages.waypoints}点以下です`);
    for (let point = 1; point < event.path.length; point += 1) if (event.path[point].frame <= event.path[point - 1].frame) error('BML_STAGE_PATH_FRAME', `${path}.path[${point}].frame`, '到達frameは昇順にしてください');
    if (event.patternId && !patternIds.has(event.patternId)) error('BML_STAGE_PATTERN_REF', `${path}.patternId`, `pattern ${event.patternId} がありません`);
    if (event.boss && (event.phases.length < 1 || event.phases.length > LIMITS.stages.bossPhases)) error('BML_STAGE_BOSS_PHASES', `${path}.phases`, `Boss phaseは1..${LIMITS.stages.bossPhases}件です`);
    if (!event.boss && event.phases.length) error('BML_STAGE_NORMAL_PHASES', `${path}.phases`, '通常敵にはBoss phaseを指定できません');
    for (let phaseIndex = 1; phaseIndex < event.phases.length; phaseIndex += 1) if (event.phases[phaseIndex].threshold >= event.phases[phaseIndex - 1].threshold) error('BML_STAGE_PHASE_THRESHOLD', `${path}.phases[${phaseIndex}].threshold`, 'Boss HP閾値はphase順に降順で指定してください');
    event.phases.forEach((phase, phaseIndex) => { if (phase.patternId && !patternIds.has(phase.patternId)) error('BML_STAGE_PHASE_PATTERN_REF', `${path}.phases[${phaseIndex}].patternId`, `pattern ${phase.patternId} がありません`); });
  });
  if (stageClearCount !== 1) error('BML_STAGE_CLEAR_REQUIRED', 'events', 'stage_clear eventをちょうど1件指定してください');
  for (const frame of stage.events.map((event) => event.spawnFrame)) {
    const normalCount = stage.events.filter((event) => event.action?.type === 'spawn_enemy' && !event.boss && event.spawnFrame <= frame && frame < event.spawnFrame + 660).length;
    const bossCount = stage.events.filter((event) => event.action?.type === 'spawn_boss' && event.boss && event.spawnFrame <= frame && frame < stage.durationFrames).length;
    if (normalCount > LIMITS.stages.activeNormalEnemies) error('BML_STAGE_NORMAL_ACTIVE', 'events', `frame ${frame} の通常敵同時数 ${normalCount} は${LIMITS.stages.activeNormalEnemies}を超えています`);
    if (bossCount > LIMITS.stages.activeBosses) error('BML_STAGE_BOSS_ACTIVE', 'events', `frame ${frame} のBoss同時数 ${bossCount} は${LIMITS.stages.activeBosses}を超えています`);
  }
  return { ok: !diagnostics.length, stage, diagnostics, errors: diagnostics };
}

function validateProject(projectInput, patternsInput = [], stagesInput = []) {
  const project = normalizeProject(projectInput);
  const patterns = patternsInput.map((item) => normalizePattern(item, item?.id));
  const diagnostics = [];
  const ids = new Set();
  patterns.forEach((pattern) => {
    if (ids.has(pattern.id)) diagnostics.push(diagnostic('error', 'BML_PATTERN_DUPLICATE', `patterns.${pattern.id}`, 'pattern IDが重複しています'));
    ids.add(pattern.id);
    validatePattern(pattern).diagnostics.forEach((item) => diagnostics.push({ ...item, path: `patterns.${pattern.id}.${item.path}` }));
  });
  PATTERN_ROLES.forEach((role) => {
    const id = project.patternRoles[role];
    if (id && !ids.has(id)) diagnostics.push(diagnostic('error', 'BML_ROLE_REF', `project.patternRoles.${role}`, `pattern ${id} がありません`));
  });
  const fingerprints = new Set(patterns.map((pattern) => pattern.sprite.paletteFingerprint).filter(Boolean));
  if (fingerprints.size > 1) diagnostics.push(diagnostic('error', 'BML_PALETTE_SHARED', 'patterns', '全弾spriteは同じ16色palette fingerprintを共有する必要があります'));
  const uniqueSprites = new Map();
  patterns.forEach((pattern) => {
    const sprite = pattern.sprite;
    const key = [sprite.asset?.symbol, sprite.asset?.type, sprite.asset?.animationRow, sprite.frameWidth, sprite.frameHeight, sprite.frameCount, sprite.paletteFingerprint].join(':');
    if (!uniqueSprites.has(key)) uniqueSprites.set(key, Math.max(0, Number(sprite.tileCount) || 0));
  });
  const tileTotal = [...uniqueSprites.values()].reduce((sum, count) => sum + count, 0);
  if (tileTotal > 128) diagnostics.push(diagnostic('error', 'BML_TILE_TOTAL', 'patterns', `弾tile総量 ${tileTotal} は128を超えています`));
  stagesInput.forEach((stage) => validateStage(stage, ids).diagnostics.forEach((item) => diagnostics.push({ ...item, path: `stages.${stage.orientation}.${item.path}` })));
  return { ok: !diagnostics.some((item) => item.severity === 'error'), project, patterns, diagnostics, errors: diagnostics.filter((item) => item.severity === 'error'), warnings: diagnostics.filter((item) => item.severity === 'warning') };
}

module.exports = {
  SCHEMA_VERSION,
  PATTERN_TYPES,
  DEFINITION_KINDS,
  DIRECTION_TYPES,
  SPEED_TYPES,
  COMMANDS,
  PATTERN_ROLES,
  LIMITS,
  DEFAULT_SPRITE,
  DEFAULT_PROJECT,
  DEFAULT_EDITOR_STATE,
  deepClone,
  stableStringify,
  revisionFor,
  safeId,
  normalizePattern,
  normalizeProject,
  normalizeEditorState,
  normalizeStage,
  normalizeStageEvent,
  createPatternTemplate,
  validatePattern,
  validateStage,
  validateProject,
  hostSchema,
};
