'use strict';

const crypto = require('node:crypto');
const schema = require('./bulletml-schema');
const expression = require('./bulletml-expression');

const OFFICIAL_DTD = 'http://www.asahi-net.or.jp/~cs8k-cyu/bulletml/bulletml.dtd';

class BulletmlXmlError extends Error {
  constructor(message, line = 1, column = 1, code = 'BML_XML') {
    super(`${line}:${column}: ${message}`);
    this.name = 'BulletmlXmlError';
    this.line = line;
    this.column = column;
    this.code = code;
  }
}

function location(text, index) {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function xmlError(text, index, message, code) {
  const loc = location(text, index);
  throw new BulletmlXmlError(message, loc.line, loc.column, code);
}

function decodeEntities(value, text, index) {
  return String(value).replace(/&([^;]+);/g, (whole, entity, offset) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
    if (/^#\d+$/.test(entity)) {
      const code = Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    if (/^#x[0-9a-f]+$/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    xmlError(text, index + offset, `外部または未知のEntityは使用できません: &${entity};`, 'BML_XML_ENTITY');
  });
}

function parseAttributes(raw, text, absoluteIndex) {
  const attrs = {};
  let cursor = 0;
  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] || '')) cursor += 1;
    if (cursor >= raw.length) break;
    const name = raw.slice(cursor).match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if (!name) xmlError(text, absoluteIndex + cursor, '属性名が不正です');
    cursor += name[0].length;
    while (/\s/.test(raw[cursor] || '')) cursor += 1;
    if (raw[cursor] !== '=') xmlError(text, absoluteIndex + cursor, `${name[1]} 属性に=が必要です`);
    cursor += 1;
    while (/\s/.test(raw[cursor] || '')) cursor += 1;
    const quote = raw[cursor];
    if (quote !== '"' && quote !== "'") xmlError(text, absoluteIndex + cursor, `${name[1]} 属性値を引用符で囲んでください`);
    cursor += 1;
    const end = raw.indexOf(quote, cursor);
    if (end < 0) xmlError(text, absoluteIndex + cursor, `${name[1]} 属性値が閉じられていません`);
    if (Object.prototype.hasOwnProperty.call(attrs, name[1])) xmlError(text, absoluteIndex + cursor, `属性が重複しています: ${name[1]}`);
    attrs[name[1]] = decodeEntities(raw.slice(cursor, end), text, absoluteIndex + cursor);
    cursor = end + 1;
  }
  return attrs;
}

function parseXmlTree(source) {
  const text = String(source || '').replace(/^\uFEFF/, '');
  if (/<!ENTITY\b/i.test(text)) xmlError(text, text.search(/<!ENTITY\b/i), 'Entity宣言は禁止されています', 'BML_XML_XXE');
  const doctypeAt = text.search(/<!DOCTYPE\b/i);
  if (doctypeAt >= 0) {
    const end = text.indexOf('>', doctypeAt);
    if (end < 0) xmlError(text, doctypeAt, 'DOCTYPEが閉じられていません');
    const declaration = text.slice(doctypeAt, end + 1);
    if (/\[/.test(declaration)) xmlError(text, doctypeAt, 'DOCTYPEのinternal subsetは禁止されています', 'BML_XML_XXE');
    if (!/^<!DOCTYPE\s+bulletml(?:\s+(?:SYSTEM\s+["'][^"']+["']|PUBLIC\s+["'][^"']+["']\s+["'][^"']+["']))?\s*>$/i.test(declaration)) {
      xmlError(text, doctypeAt, 'BulletML以外のDOCTYPEは使用できません', 'BML_XML_DOCTYPE');
    }
  }
  const document = { name: '#document', attrs: {}, children: [], text: '', index: 0, line: 1, column: 1 };
  const stack = [document];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open < 0) {
      stack[stack.length - 1].text += decodeEntities(text.slice(cursor), text, cursor);
      break;
    }
    if (open > cursor) stack[stack.length - 1].text += decodeEntities(text.slice(cursor, open), text, cursor);
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0) xmlError(text, open, 'コメントが閉じられていません');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end < 0) xmlError(text, open, '処理命令が閉じられていません');
      cursor = end + 2;
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(text.slice(open))) {
      const end = text.indexOf('>', open + 2);
      cursor = end + 1;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) xmlError(text, open, 'CDATAはBulletML交換形式で使用できません');
    const close = text.indexOf('>', open + 1);
    if (close < 0) xmlError(text, open, '要素が閉じられていません');
    let raw = text.slice(open + 1, close).trim();
    if (raw.startsWith('!')) xmlError(text, open, '許可されていない宣言です', 'BML_XML_XXE');
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) xmlError(text, open, '閉じ要素名が不正です');
      const node = stack.pop();
      if (stack.length < 1 || node.name !== name) xmlError(text, open, `閉じ要素が一致しません: ${name}`);
      cursor = close + 1;
      continue;
    }
    const selfClosing = /\/\s*$/.test(raw);
    if (selfClosing) raw = raw.replace(/\/\s*$/, '').trimEnd();
    const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    if (!nameMatch) xmlError(text, open, '要素名が不正です');
    const name = nameMatch[1];
    const loc = location(text, open);
    const attrsIndex = open + 1 + nameMatch[0].length;
    const node = { name, attrs: parseAttributes(raw.slice(nameMatch[0].length), text, attrsIndex), children: [], text: '', index: open, ...loc };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    cursor = close + 1;
  }
  if (stack.length !== 1) {
    const node = stack[stack.length - 1];
    throw new BulletmlXmlError(`要素が閉じられていません: ${node.name}`, node.line, node.column);
  }
  const roots = document.children.filter((node) => node.name !== '#text');
  if (roots.length !== 1) throw new BulletmlXmlError('bulletml root要素が1つ必要です');
  if (document.text.trim()) throw new BulletmlXmlError('root要素外に文字列があります');
  return { root: roots[0], source: text };
}

function rejectUnknownAttributes(node, allowed) {
  Object.keys(node.attrs).forEach((name) => {
    if (!allowed.includes(name) && !name.startsWith('xmlns')) throw new BulletmlXmlError(`未知の属性です: ${name}`, node.line, node.column, 'BML_XML_ATTRIBUTE');
  });
}

function onlyChildren(node, allowed, allowText = false) {
  node.children.forEach((child) => {
    if (!allowed.includes(child.name)) throw new BulletmlXmlError(`${node.name}内の未知または非対応要素です: ${child.name}`, child.line, child.column, 'BML_XML_ELEMENT');
  });
  if (!allowText && node.text.trim()) throw new BulletmlXmlError(`${node.name}内に直接文字列を置けません`, node.line, node.column);
}

function elementText(node, fallback = '') {
  if (node.children.length) throw new BulletmlXmlError(`${node.name}内に要素を置けません`, node.line, node.column);
  const value = node.text.trim();
  return value || fallback;
}

function checkedExpression(node, fallback = '0') {
  const value = elementText(node, fallback);
  try { expression.parseExpression(value); } catch (error) { throw new BulletmlXmlError(error.message, node.line, node.column, 'BML_EXPRESSION'); }
  return value;
}

function child(node, name) {
  return node.children.find((item) => item.name === name) || null;
}

function children(node, name) {
  return node.children.filter((item) => item.name === name);
}

function paramsFrom(node) {
  const params = children(node, 'param');
  if (params.length > 4) throw new BulletmlXmlError('paramは4個以下です', node.line, node.column, 'BML_PARAM_LIMIT');
  return params.map((item) => checkedExpression(item));
}

function directionFrom(node, fallbackType = 'aim') {
  if (!node) return null;
  rejectUnknownAttributes(node, ['type']);
  onlyChildren(node, [], true);
  const type = node.attrs.type || fallbackType;
  if (!schema.DIRECTION_TYPES.includes(type)) throw new BulletmlXmlError(`direction typeが不正です: ${type}`, node.line, node.column);
  return { type, value: checkedExpression(node) };
}

function speedFrom(node) {
  if (!node) return null;
  rejectUnknownAttributes(node, ['type']);
  onlyChildren(node, [], true);
  const type = node.attrs.type || 'absolute';
  if (!schema.SPEED_TYPES.includes(type)) throw new BulletmlXmlError(`speed typeが不正です: ${type}`, node.line, node.column);
  return { type, value: checkedExpression(node) };
}

function parseActionBinding(node) {
  if (node.name === 'actionRef') {
    rejectUnknownAttributes(node, ['label']);
    onlyChildren(node, ['param']);
    if (!node.attrs.label) throw new BulletmlXmlError('actionRef labelが必要です', node.line, node.column);
    return { ref: node.attrs.label, params: paramsFrom(node) };
  }
  rejectUnknownAttributes(node, ['label']);
  const commands = parseActionCommands(node);
  return node.attrs.label ? { ref: node.attrs.label, params: [] } : { commands };
}

function parseBulletNode(node) {
  rejectUnknownAttributes(node, ['label']);
  onlyChildren(node, ['direction', 'speed', 'action', 'actionRef']);
  return {
    direction: directionFrom(child(node, 'direction'), 'aim'),
    speed: speedFrom(child(node, 'speed')),
    actions: node.children.filter((item) => item.name === 'action' || item.name === 'actionRef').map(parseActionBinding),
  };
}

function parseBulletBinding(node) {
  if (node.name === 'bulletRef') {
    rejectUnknownAttributes(node, ['label']);
    onlyChildren(node, ['param']);
    if (!node.attrs.label) throw new BulletmlXmlError('bulletRef labelが必要です', node.line, node.column);
    return { ref: node.attrs.label, params: paramsFrom(node) };
  }
  const bullet = parseBulletNode(node);
  return node.attrs.label ? { ref: node.attrs.label, params: [] } : { ref: '', params: [], inline: bullet };
}

function parseFireNode(node) {
  rejectUnknownAttributes(node, ['label']);
  onlyChildren(node, ['direction', 'speed', 'bullet', 'bulletRef']);
  const bulletNode = node.children.find((item) => item.name === 'bullet' || item.name === 'bulletRef');
  if (!bulletNode) throw new BulletmlXmlError('fireにはbulletまたはbulletRefが必要です', node.line, node.column);
  return {
    direction: directionFrom(child(node, 'direction'), 'aim'),
    speed: speedFrom(child(node, 'speed')),
    bullet: parseBulletBinding(bulletNode),
  };
}

function parseCommand(node) {
  if (node.name === 'fire') return { op: 'fire', ...parseFireNode(node) };
  if (node.name === 'fireRef') {
    rejectUnknownAttributes(node, ['label']); onlyChildren(node, ['param']);
    if (!node.attrs.label) throw new BulletmlXmlError('fireRef labelが必要です', node.line, node.column);
    return { op: 'fireRef', ref: node.attrs.label, params: paramsFrom(node) };
  }
  if (node.name === 'wait') { rejectUnknownAttributes(node, []); onlyChildren(node, [], true); return { op: 'wait', value: checkedExpression(node, '0') }; }
  if (node.name === 'vanish') { rejectUnknownAttributes(node, []); onlyChildren(node, []); return { op: 'vanish' }; }
  if (node.name === 'actionRef') {
    const binding = parseActionBinding(node);
    return { op: 'actionRef', ref: binding.ref, params: binding.params };
  }
  if (node.name === 'repeat') {
    rejectUnknownAttributes(node, []); onlyChildren(node, ['times', 'action', 'actionRef']);
    const times = child(node, 'times');
    const action = node.children.find((item) => item.name === 'action' || item.name === 'actionRef');
    if (!times || !action) throw new BulletmlXmlError('repeatにはtimesとaction/actionRefが必要です', node.line, node.column);
    return { op: 'repeat', times: checkedExpression(times, '0'), action: parseActionBinding(action) };
  }
  if (node.name === 'changeDirection') {
    rejectUnknownAttributes(node, []); onlyChildren(node, ['direction', 'term']);
    if (!child(node, 'direction') || !child(node, 'term')) throw new BulletmlXmlError('changeDirectionにはdirectionとtermが必要です', node.line, node.column);
    return { op: 'changeDirection', direction: directionFrom(child(node, 'direction'), 'aim'), term: checkedExpression(child(node, 'term'), '1') };
  }
  if (node.name === 'changeSpeed') {
    rejectUnknownAttributes(node, []); onlyChildren(node, ['speed', 'term']);
    if (!child(node, 'speed') || !child(node, 'term')) throw new BulletmlXmlError('changeSpeedにはspeedとtermが必要です', node.line, node.column);
    return { op: 'changeSpeed', speed: speedFrom(child(node, 'speed')), term: checkedExpression(child(node, 'term'), '1') };
  }
  if (node.name === 'accel') throw new BulletmlXmlError('accelはv1 subsetの対象外です', node.line, node.column, 'BML_UNSUPPORTED_ACCEL');
  throw new BulletmlXmlError(`未知または非対応commandです: ${node.name}`, node.line, node.column, 'BML_XML_ELEMENT');
}

function parseActionCommands(node) {
  const allowed = ['fire', 'fireRef', 'wait', 'repeat', 'vanish', 'changeDirection', 'changeSpeed', 'action', 'actionRef', 'accel'];
  onlyChildren(node, allowed);
  return node.children.map((item) => item.name === 'action' ? { op: 'repeat', times: '1', action: { commands: parseActionCommands(item) } } : parseCommand(item));
}

function importXml(source, sidecar = null, options = {}) {
  const { root } = parseXmlTree(source);
  if (root.name !== 'bulletml') throw new BulletmlXmlError('root要素はbulletmlである必要があります', root.line, root.column);
  rejectUnknownAttributes(root, ['type']);
  onlyChildren(root, ['action', 'bullet', 'fire']);
  const type = root.attrs.type || 'none';
  if (!schema.PATTERN_TYPES.includes(type)) throw new BulletmlXmlError(`bulletml typeが不正です: ${type}`, root.line, root.column);
  const definitions = root.children.map((node) => {
    if (!node.attrs.label) throw new BulletmlXmlError(`${node.name} definitionにはlabelが必要です`, node.line, node.column);
    if (node.name === 'action') return { kind: 'action', label: node.attrs.label, commands: parseActionCommands(node) };
    if (node.name === 'bullet') return { kind: 'bullet', label: node.attrs.label, ...parseBulletNode(node) };
    return { kind: 'fire', label: node.attrs.label, ...parseFireNode(node) };
  });
  const rawId = sidecar?.patternId || options.patternId || 'imported-pattern';
  const pattern = schema.normalizePattern({
    id: schema.safeId(rawId, 'imported-pattern'),
    name: sidecar?.name || options.name || rawId,
    type,
    rootActions: definitions.filter((item) => item.kind === 'action' && /^top/i.test(item.label)).map((item) => item.label).slice(0, 2),
    definitions,
    sprite: sidecar?.sprite,
    hitbox: sidecar?.hitbox,
    lifetime: sidecar?.lifetime,
    margin: sidecar?.margin,
  }, rawId);
  const validation = schema.validatePattern(pattern);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new BulletmlXmlError(`${first.path}: ${first.message}`, root.line, root.column, first.code);
  }
  return { pattern: validation.pattern, diagnostics: validation.diagnostics };
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function tag(name, attrs, content, level) {
  const indent = '  '.repeat(level);
  const attributes = Object.entries(attrs || {}).filter(([, value]) => value !== '' && value != null).map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  if (content == null) return `${indent}<${name}${attributes}/>`;
  if (!Array.isArray(content)) return `${indent}<${name}${attributes}>${escapeXml(content)}</${name}>`;
  if (!content.length) return `${indent}<${name}${attributes}/>`;
  return `${indent}<${name}${attributes}>\n${content.join('\n')}\n${indent}</${name}>`;
}

function directionXml(value, level) { return value ? tag('direction', { type: value.type }, value.value, level) : null; }
function speedXml(value, level) { return value ? tag('speed', { type: value.type }, value.value, level) : null; }

function actionBindingXml(binding, level) {
  if (binding.ref) return tag('actionRef', { label: binding.ref }, (binding.params || []).map((param) => tag('param', {}, param, level + 1)), level);
  return tag('action', {}, commandsXml(binding.commands || [], level + 1), level);
}

function bulletBindingXml(binding, level) {
  if (binding.ref) return tag('bulletRef', { label: binding.ref }, (binding.params || []).map((param) => tag('param', {}, param, level + 1)), level);
  return bulletXml(binding.inline || {}, {}, level);
}

function fireXml(value, attrs, level) {
  return tag('fire', attrs, [directionXml(value.direction, level + 1), speedXml(value.speed, level + 1), bulletBindingXml(value.bullet || {}, level + 1)].filter(Boolean), level);
}

function bulletXml(value, attrs, level) {
  return tag('bullet', attrs, [directionXml(value.direction, level + 1), speedXml(value.speed, level + 1), ...(value.actions || []).map((item) => actionBindingXml(item, level + 1))].filter(Boolean), level);
}

function commandXml(command, level) {
  if (command.op === 'fire') return fireXml(command, {}, level);
  if (command.op === 'fireRef') return tag('fireRef', { label: command.ref }, (command.params || []).map((param) => tag('param', {}, param, level + 1)), level);
  if (command.op === 'wait') return tag('wait', {}, command.value, level);
  if (command.op === 'vanish') return tag('vanish', {}, null, level);
  if (command.op === 'actionRef') return tag('actionRef', { label: command.ref }, (command.params || []).map((param) => tag('param', {}, param, level + 1)), level);
  if (command.op === 'repeat') return tag('repeat', {}, [tag('times', {}, command.times, level + 1), actionBindingXml(command.action || {}, level + 1)], level);
  if (command.op === 'changeDirection') return tag('changeDirection', {}, [directionXml(command.direction, level + 1), tag('term', {}, command.term, level + 1)].filter(Boolean), level);
  if (command.op === 'changeSpeed') return tag('changeSpeed', {}, [speedXml(command.speed, level + 1), tag('term', {}, command.term, level + 1)].filter(Boolean), level);
  throw new Error(`Cannot export unsupported command: ${command.op}`);
}

function commandsXml(commands, level) { return (commands || []).map((command) => commandXml(command, level)); }

function exportXml(patternInput) {
  const validation = schema.validatePattern(patternInput);
  if (!validation.ok) throw new Error(validation.errors.map((item) => `${item.path}: ${item.message}`).join('\n'));
  const pattern = validation.pattern;
  const definitions = pattern.definitions.map((definition) => {
    if (definition.kind === 'action') return tag('action', { label: definition.label }, commandsXml(definition.commands, 2), 1);
    if (definition.kind === 'bullet') return bulletXml(definition, { label: definition.label }, 1);
    return fireXml(definition, { label: definition.label }, 1);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE bulletml SYSTEM "${OFFICIAL_DTD}">\n${tag('bulletml', { type: pattern.type }, definitions, 0)}\n`;
}

function canonicalHash(xml) {
  return crypto.createHash('sha256').update(String(xml), 'utf8').digest('hex');
}

function createSidecar(patternInput, xml) {
  const pattern = schema.normalizePattern(patternInput, patternInput?.id);
  return {
    schemaVersion: 1,
    canonicalXmlSha256: canonicalHash(xml),
    patternId: pattern.id,
    name: pattern.name,
    sprite: pattern.sprite,
    hitbox: pattern.hitbox,
    lifetime: pattern.lifetime,
    margin: pattern.margin,
  };
}

function verifySidecar(sidecar, xml) {
  if (!sidecar || typeof sidecar !== 'object') return { ok: false, stale: false, diagnostic: 'MD sidecarがないため既定bindingを使用します' };
  const actual = canonicalHash(xml);
  if (sidecar.canonicalXmlSha256 !== actual) return { ok: false, stale: true, actual, expected: sidecar.canonicalXmlSha256, diagnostic: 'MD sidecarのXML hashが一致しないため適用しません' };
  return { ok: true, stale: false, actual };
}

module.exports = {
  OFFICIAL_DTD,
  BulletmlXmlError,
  parseXmlTree,
  importXml,
  exportXml,
  canonicalHash,
  createSidecar,
  verifySidecar,
};
