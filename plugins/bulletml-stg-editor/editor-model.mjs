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
  return (Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean)).reduce((value, key) => value?.[key], root);
}

export function setPath(root, path, value) {
  const keys = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);
  if (!keys.length) return clone(value);
  const result = clone(root);
  let target = result;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = /^\d+$/.test(keys[index]) ? Number(keys[index]) : keys[index];
    const nextKey = keys[index + 1];
    if (target[key] == null) target[key] = /^\d+$/.test(nextKey) ? [] : {};
    target = target[key];
  }
  const final = /^\d+$/.test(keys[keys.length - 1]) ? Number(keys[keys.length - 1]) : keys[keys.length - 1];
  target[final] = clone(value);
  return result;
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
