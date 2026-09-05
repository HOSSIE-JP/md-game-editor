export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function stableStringify(value) { return JSON.stringify(stable(value)); }

export function irHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 16777619);
    hash ^= code >>> 8;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getPath(root, path) {
  return pathArray(path).reduce((value, key) => value?.[key], root);
}

export function pathArray(path) {
  return (Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean))
    .map((key) => typeof key === 'number' || /^\d+$/.test(key) ? Number(key) : key);
}

export function pathKey(path) { return pathArray(path).join('.'); }

export function setPath(root, path, value) {
  const keys = pathArray(path);
  if (!keys.length) return clone(value);
  const result = clone(root);
  let target = result;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const nextKey = keys[index + 1];
    if (target[key] == null) target[key] = typeof nextKey === 'number' ? [] : {};
    target = target[key];
  }
  const final = keys[keys.length - 1];
  target[final] = clone(value);
  return result;
}

function updateDefinitionRefs(value, kind, previousLabel, nextLabel) {
  if (!value || typeof value !== 'object') return;
  if (kind === 'action' && value.op === 'actionRef' && value.ref === previousLabel) value.ref = nextLabel;
  if (kind === 'fire' && value.op === 'fireRef' && value.ref === previousLabel) value.ref = nextLabel;
  if (kind === 'action' && value.action?.ref === previousLabel) value.action.ref = nextLabel;
  if (kind === 'bullet' && value.bullet?.ref === previousLabel) value.bullet.ref = nextLabel;
  if (Array.isArray(value)) value.forEach((item) => updateDefinitionRefs(item, kind, previousLabel, nextLabel));
  else Object.values(value).forEach((item) => updateDefinitionRefs(item, kind, previousLabel, nextLabel));
}

function connectCommandRef(command, kind, target) {
  if (!command || !target) return false;
  if (kind === 'action' && (command.op === 'repeat' || command.op === 'actionRef')) {
    if (command.op === 'repeat') command.action = { ref: target, params: [] };
    else {
      command.op = 'actionRef'; command.ref = target; command.params = [];
      Object.keys(command).filter((key) => !['op', 'ref', 'params'].includes(key)).forEach((key) => delete command[key]);
    }
    return true;
  }
  if (kind === 'fire' && command.op === 'fireRef') {
    command.ref = target; command.params = [];
    return true;
  }
  if (kind === 'bullet' && command.op === 'fire') {
    command.bullet = { ref: target, params: [] };
    return true;
  }
  return false;
}

function definitionIndex(pattern, label, kind = '') {
  return (pattern.definitions || []).findIndex((item) => item.label === label && (!kind || item.kind === kind));
}

function definitionCommands(pattern, label) {
  const index = definitionIndex(pattern, label, 'action');
  return index < 0 ? null : pattern.definitions[index].commands;
}

export function defaultCommand(op = 'wait') {
  if (op === 'fire') return { op, direction: { type: 'aim', value: '0' }, speed: { type: 'absolute', value: '1.5' }, bullet: { ref: '', params: [], inline: { direction: null, speed: null, actions: [] } } };
  if (op === 'fireRef') return { op, ref: '', params: [] };
  if (op === 'repeat') return { op, times: '1', action: { commands: [{ op: 'wait', value: '1' }] } };
  if (op === 'vanish') return { op };
  if (op === 'changeDirection') return { op, direction: { type: 'aim', value: '0' }, term: '60' };
  if (op === 'changeSpeed') return { op, speed: { type: 'absolute', value: '1.5' }, term: '60' };
  if (op === 'actionRef') return { op, ref: '', params: [] };
  return { op: 'wait', value: '1' };
}

export function reducePattern(patternInput, operation) {
  let pattern = clone(patternInput);
  const op = operation || {};
  if (op.type === 'replace') return clone(op.pattern);
  if (op.type === 'set') return setPath(pattern, op.path, op.value);
  if (op.type === 'setPatternMetadata') {
    pattern.name = String(op.name ?? pattern.name).trim() || pattern.name;
    if (['none', 'vertical', 'horizontal'].includes(op.patternType)) pattern.type = op.patternType;
    return pattern;
  }
  if (op.type === 'updateDefinitionMetadata') {
    const index = definitionIndex(pattern, op.label, op.kind);
    const nextLabel = String(op.nextLabel || '').trim();
    if (index < 0 || !nextLabel) return pattern;
    if ((pattern.definitions || []).some((item, itemIndex) => itemIndex !== index && item.kind === op.kind && item.label === nextLabel)) return pattern;
    const previousLabel = pattern.definitions[index].label;
    pattern.definitions[index].label = nextLabel;
    updateDefinitionRefs(pattern.definitions, op.kind, previousLabel, nextLabel);
    if (op.kind === 'action') {
      pattern.rootActions = (pattern.rootActions || []).map((label) => label === previousLabel ? nextLabel : label);
      const isRoot = pattern.rootActions.includes(nextLabel);
      if (op.root === true && !isRoot && pattern.rootActions.length < 2) pattern.rootActions.push(nextLabel);
      if (op.root === false && isRoot && pattern.rootActions.length > 1) pattern.rootActions = pattern.rootActions.filter((label) => label !== nextLabel);
    }
    return pattern;
  }
  if (op.type === 'addDefinition') {
    const kind = ['action', 'bullet', 'fire'].includes(op.kind) ? op.kind : 'action';
    const base = String(op.label || kind);
    let label = base;
    let ordinal = 2;
    while ((pattern.definitions || []).some((item) => item.kind === kind && item.label === label)) label = `${base}-${ordinal++}`;
    const definition = kind === 'action' ? { kind, label, commands: [] }
      : kind === 'bullet' ? { kind, label, direction: null, speed: null, actions: [] }
        : { kind, label, direction: { type: 'aim', value: '0' }, speed: { type: 'absolute', value: '1.5' }, bullet: { ref: '', params: [], inline: { direction: null, speed: null, actions: [] } } };
    pattern.definitions = [...(pattern.definitions || []), definition];
    return pattern;
  }
  if (op.type === 'deleteDefinition') {
    pattern.definitions = (pattern.definitions || []).filter((item) => !(item.kind === op.kind && item.label === op.label));
    pattern.rootActions = (pattern.rootActions || []).filter((label) => !(op.kind === 'action' && label === op.label));
    return pattern;
  }
  if (op.type === 'addCommand') {
    const commands = definitionCommands(pattern, op.label);
    if (!commands) return pattern;
    const index = Math.max(0, Math.min(commands.length, Number.isInteger(op.index) ? op.index : commands.length));
    commands.splice(index, 0, clone(op.command || defaultCommand(op.op)));
    return pattern;
  }
  if (op.type === 'insertAt') {
    const list = getPath(pattern, op.path);
    if (!Array.isArray(list)) return pattern;
    const index = Math.max(0, Math.min(list.length, Number.isInteger(op.index) ? op.index : list.length));
    list.splice(index, 0, clone(op.value));
    return pattern;
  }
  if (op.type === 'removeAt') {
    const keys = pathArray(op.path);
    const index = keys.at(-1);
    const list = getPath(pattern, keys.slice(0, -1));
    if (Array.isArray(list) && Number.isInteger(index) && index >= 0 && index < list.length) list.splice(index, 1);
    return pattern;
  }
  if (op.type === 'moveAt') {
    const keys = pathArray(op.path);
    const index = keys.at(-1);
    const list = getPath(pattern, keys.slice(0, -1));
    const next = Number(index) + Number(op.delta);
    if (Array.isArray(list) && Number.isInteger(index) && index >= 0 && index < list.length && next >= 0 && next < list.length) [list[index], list[next]] = [list[next], list[index]];
    return pattern;
  }
  if (op.type === 'deleteCommand') {
    const commands = definitionCommands(pattern, op.label);
    if (commands && op.index >= 0 && op.index < commands.length) commands.splice(op.index, 1);
    return pattern;
  }
  if (op.type === 'moveCommand') {
    const commands = definitionCommands(pattern, op.label);
    const next = Number(op.index) + Number(op.delta);
    if (commands && op.index >= 0 && op.index < commands.length && next >= 0 && next < commands.length) [commands[op.index], commands[next]] = [commands[next], commands[op.index]];
    return pattern;
  }
  if (op.type === 'connectRef') {
    const commands = definitionCommands(pattern, op.label);
    const command = commands?.[op.index];
    if (!command) return pattern;
    if (op.kind === 'action') {
      if (command.op === 'repeat') command.action = { ref: op.target, params: [] };
      else { command.op = 'actionRef'; command.ref = op.target; command.params = []; Object.keys(command).filter((key) => !['op', 'ref', 'params'].includes(key)).forEach((key) => delete command[key]); }
    } else if (op.kind === 'fire') { command.op = 'fireRef'; command.ref = op.target; command.params = []; Object.keys(command).filter((key) => !['op', 'ref', 'params'].includes(key)).forEach((key) => delete command[key]); }
    else if (command.op === 'fire') command.bullet = { ref: op.target, params: [] };
    return pattern;
  }
  if (op.type === 'connectRefAt') {
    connectCommandRef(getPath(pattern, op.path), op.kind, op.target);
    return pattern;
  }
  return pattern;
}

export class PatternHistory {
  constructor(pattern, limit = 100) { this.present = clone(pattern); this.past = []; this.future = []; this.limit = Math.max(1, limit); }
  dispatch(operation) {
    const next = reducePattern(this.present, operation);
    if (stableStringify(next) === stableStringify(this.present)) return this.present;
    this.past.push(clone(this.present));
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    return this.present;
  }
  undo() {
    if (!this.past.length) return this.present;
    this.future.push(clone(this.present));
    this.present = this.past.pop();
    return this.present;
  }
  redo() {
    if (!this.future.length) return this.present;
    this.past.push(clone(this.present));
    this.present = this.future.pop();
    return this.present;
  }
  replace(pattern) { this.present = clone(pattern); this.past = []; this.future = []; return this.present; }
}

function refsFrom(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (value.op === 'actionRef' && value.ref) result.push({ kind: 'action', label: value.ref });
  if (value.op === 'fireRef' && value.ref) result.push({ kind: 'fire', label: value.ref });
  if (value.action?.ref) result.push({ kind: 'action', label: value.action.ref });
  if (value.bullet?.ref) result.push({ kind: 'bullet', label: value.bullet.ref });
  if (Array.isArray(value)) value.forEach((item) => refsFrom(item, result));
  else Object.values(value).forEach((item) => refsFrom(item, result));
  return result;
}

export function graphEdges(pattern) {
  const edges = [];
  for (const definition of pattern?.definitions || []) {
    for (const ref of refsFrom(definition)) edges.push({ from: `${definition.kind}:${definition.label}`, to: `${ref.kind}:${ref.label}`, kind: ref.kind });
  }
  return edges;
}

export function graphLayout(pattern, manual = {}) {
  const columns = { action: 0, fire: 1, bullet: 2 };
  const counts = { action: 0, fire: 0, bullet: 0 };
  const result = {};
  for (const definition of pattern?.definitions || []) {
    const id = `${definition.kind}:${definition.label}`;
    const saved = manual[id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) result[id] = { x: saved.x, y: saved.y, manual: true };
    else result[id] = { x: 50 + columns[definition.kind] * 280, y: 50 + counts[definition.kind]++ * 160, manual: false };
  }
  return result;
}

export function commandSummary(command) {
  if (!command) return '';
  if (command.op === 'wait') return `${command.value} frame`;
  if (command.op === 'fire') return `${command.direction?.type || 'aim'} ${command.direction?.value || 0}° / ${command.speed?.value || 0}`;
  if (command.op === 'repeat') return `× ${command.times}`;
  if (command.op === 'actionRef' || command.op === 'fireRef') return `→ ${command.ref || '(未接続)'}`;
  if (command.op === 'changeDirection') return `${command.direction?.type} ${command.direction?.value} / ${command.term}f`;
  if (command.op === 'changeSpeed') return `${command.speed?.type} ${command.speed?.value} / ${command.term}f`;
  return command.op || '';
}

export function filterPatterns(patterns, query = '', type = 'all') {
  const needle = String(query || '').trim().toLocaleLowerCase();
  return (patterns || []).filter((pattern) => {
    if (type !== 'all' && pattern.type !== type) return false;
    return !needle || ((pattern.name || '') + '\n' + (pattern.id || '')).toLocaleLowerCase().includes(needle);
  });
}

export function filterDefinitions(definitions, kind = 'all') {
  return (definitions || []).filter((definition) => kind === 'all' || definition.kind === kind);
}

export function stagePathsForMode(events, selectedIndex, mode = 'selected') {
  if (mode === 'all') return (events || []).map((event, index) => ({ event, index }));
  const event = events?.[selectedIndex];
  return event ? [{ event, index: selectedIndex }] : [];
}

export function addBossPhase(eventInput) {
  const event = clone(eventInput);
  if (!event?.boss || !Array.isArray(event.phases) || event.phases.length >= 8) return event;
  const defaults = [100, 75, 60, 45, 30, 20, 10, 1];
  const previous = Math.trunc(Number(event.phases.at(-1)?.threshold ?? 100));
  const threshold = Math.max(0, Math.min(defaults[event.phases.length], previous - 1));
  event.phases.push({ threshold, patternId: event.patternId || '' });
  return event;
}

export function removeBossPhase(eventInput) {
  const event = clone(eventInput);
  if (!event?.boss || !Array.isArray(event.phases) || event.phases.length <= 1) return event;
  event.phases.pop();
  return event;
}

export function advancePreviewFrame(index, length, steps = 1, loop = true) {
  const count = Math.max(0, Math.trunc(Number(length) || 0));
  if (count <= 1) return { index: 0, playing: false, wrapped: false };
  const next = Math.max(0, Math.trunc(Number(index) || 0)) + Math.max(1, Math.trunc(Number(steps) || 1));
  if (next < count) return { index: next, playing: true, wrapped: false };
  if (loop) return { index: next % count, playing: true, wrapped: true };
  return { index: count - 1, playing: false, wrapped: false };
}
