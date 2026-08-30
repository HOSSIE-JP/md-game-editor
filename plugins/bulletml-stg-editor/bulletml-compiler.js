'use strict';

const crypto = require('node:crypto');
const schema = require('./bulletml-schema');
const expression = require('./bulletml-expression');

const ABI_VERSION = 1;
const HEADER_SIZE = 32;
const DEFINITION_ENTRY_SIZE = 8;

const KIND = Object.freeze({ action: 1, bullet: 2, fire: 3 });
const OPCODE = Object.freeze({
  END: 0x00,
  WAIT: 0x01,
  FIRE: 0x02,
  FIRE_REF: 0x03,
  REPEAT: 0x04,
  VANISH: 0x05,
  CHANGE_DIRECTION: 0x06,
  CHANGE_SPEED: 0x07,
  ACTION_REF: 0x08,
  BULLET_META: 0x20,
});
const DIRECTION = Object.freeze({ aim: 0, absolute: 1, relative: 2, sequence: 3 });
const SPEED = Object.freeze({ absolute: 0, relative: 1, sequence: 2 });

class CompileError extends Error {
  constructor(message, code = 'BML_COMPILE') {
    super(message);
    this.name = 'CompileError';
    this.code = code;
  }
}

function u16(value) {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(Number(value) & 0xffff, 0);
  return result;
}

function i8(value) {
  const result = Buffer.alloc(1);
  result.writeInt8(Math.max(-128, Math.min(127, Math.trunc(Number(value) || 0))), 0);
  return result;
}

function labelHash(label) {
  let value = 0x811c;
  for (const byte of Buffer.from(String(label), 'utf8')) value = Math.imul(value ^ byte, 0x0101) & 0xffff;
  return value;
}

function record(opcode, payload = Buffer.alloc(0)) {
  if (payload.length > 255) throw new CompileError(`opcode ${opcode} payloadが255 byteを超えています`, 'BML_INSTRUCTION_SIZE');
  return Buffer.concat([Buffer.from([opcode, payload.length]), payload]);
}

function expr(value) {
  const compiled = expression.compileExpression(String(value ?? '0')).bytes;
  if (compiled.length > 240) throw new CompileError('式bytecodeが240 byteを超えています', 'BML_EXPRESSION_SIZE');
  return Buffer.concat([Buffer.from([compiled.length]), compiled]);
}

function optionalDirection(value) {
  if (!value) return Buffer.from([0xff]);
  return Buffer.concat([Buffer.from([DIRECTION[value.type]]), expr(value.value)]);
}

function optionalSpeed(value) {
  if (!value) return Buffer.from([0xff]);
  return Buffer.concat([Buffer.from([SPEED[value.type]]), expr(value.value)]);
}

function compilePattern(patternInput, options = {}) {
  const validation = schema.validatePattern(patternInput);
  if (!validation.ok) throw new CompileError(validation.errors.map((item) => `${item.path}: ${item.message}`).join('\n'), 'BML_VALIDATION');
  const pattern = validation.pattern;
  const definitionIndexes = new Map(pattern.definitions.map((definition, index) => [`${definition.kind}:${definition.label}`, index]));

  function indexOf(kind, label) {
    const index = definitionIndexes.get(`${kind}:${label}`);
    if (index == null) throw new CompileError(`${kind} ${label} がありません`, 'BML_UNRESOLVED_REF');
    return index;
  }

  function params(values) {
    const list = Array.isArray(values) ? values : [];
    if (list.length > schema.LIMITS.params) throw new CompileError('paramは4個以下です', 'BML_PARAM_LIMIT');
    return Buffer.concat([Buffer.from([list.length]), ...list.map(expr)]);
  }

  function actionBinding(binding) {
    if (binding?.ref) return Buffer.concat([Buffer.from([0, indexOf('action', binding.ref)]), params(binding.params)]);
    const inline = commands(binding?.commands || []);
    return Buffer.concat([Buffer.from([1]), u16(inline.length), inline]);
  }

  function bulletBinding(binding) {
    if (binding?.ref) return Buffer.concat([Buffer.from([0, indexOf('bullet', binding.ref)]), params(binding.params)]);
    const inline = bullet(binding?.inline || {});
    return Buffer.concat([Buffer.from([1]), u16(inline.length), inline]);
  }

  function fire(value) {
    return Buffer.concat([optionalDirection(value.direction), optionalSpeed(value.speed), bulletBinding(value.bullet)]);
  }

  function bullet(value) {
    const actions = Array.isArray(value.actions) ? value.actions : [];
    return Buffer.concat([
      record(OPCODE.BULLET_META, Buffer.concat([
        optionalDirection(value.direction),
        optionalSpeed(value.speed),
        Buffer.from([actions.length]),
        ...actions.map(actionBinding),
      ])),
      record(OPCODE.END),
    ]);
  }

  function command(value) {
    if (value.op === 'wait') return record(OPCODE.WAIT, expr(value.value));
    if (value.op === 'fire') return record(OPCODE.FIRE, fire(value));
    if (value.op === 'fireRef') return record(OPCODE.FIRE_REF, Buffer.concat([Buffer.from([indexOf('fire', value.ref)]), params(value.params)]));
    if (value.op === 'repeat') return record(OPCODE.REPEAT, Buffer.concat([expr(value.times), actionBinding(value.action)]));
    if (value.op === 'vanish') return record(OPCODE.VANISH);
    if (value.op === 'changeDirection') return record(OPCODE.CHANGE_DIRECTION, Buffer.concat([optionalDirection(value.direction), expr(value.term)]));
    if (value.op === 'changeSpeed') return record(OPCODE.CHANGE_SPEED, Buffer.concat([optionalSpeed(value.speed), expr(value.term)]));
    if (value.op === 'actionRef') return record(OPCODE.ACTION_REF, Buffer.concat([Buffer.from([indexOf('action', value.ref)]), params(value.params)]));
    throw new CompileError(`非対応commandです: ${value.op}`, 'BML_UNKNOWN_COMMAND');
  }

  function commands(values) {
    return Buffer.concat([...(values || []).map(command), record(OPCODE.END)]);
  }

  const blocks = pattern.definitions.map((definition) => {
    if (definition.kind === 'action') return commands(definition.commands);
    if (definition.kind === 'bullet') return bullet(definition);
    return Buffer.concat([record(OPCODE.FIRE, fire(definition)), record(OPCODE.END)]);
  });
  const tableSize = blocks.length * DEFINITION_ENTRY_SIZE;
  let offset = HEADER_SIZE + tableSize;
  const entries = pattern.definitions.map((definition, index) => {
    const block = blocks[index];
    const entry = Buffer.alloc(DEFINITION_ENTRY_SIZE);
    entry[0] = KIND[definition.kind];
    entry[1] = 0;
    entry.writeUInt16BE(offset, 2);
    entry.writeUInt16BE(block.length, 4);
    entry.writeUInt16BE(labelHash(definition.label), 6);
    offset += block.length;
    return entry;
  });
  if (offset >= schema.LIMITS.bytecode) throw new CompileError(`BMLB ${offset} bytesは64KiB未満ではありません`, 'BML_BYTECODE_LIMIT');
  const header = Buffer.alloc(HEADER_SIZE);
  header.write('BMLB', 0, 4, 'ascii');
  header[4] = ABI_VERSION;
  header[5] = { none: 0, vertical: 1, horizontal: 2 }[pattern.type];
  header[6] = blocks.length;
  header[7] = pattern.rootActions.length;
  header.writeUInt16BE(offset, 8);
  header.writeUInt16BE(HEADER_SIZE, 10);
  header.writeUInt16BE(HEADER_SIZE + tableSize, 12);
  header.writeUInt16BE(pattern.lifetime, 14);
  header[16] = pattern.margin;
  header[17] = pattern.hitbox.radius;
  i8(pattern.hitbox.x).copy(header, 18);
  i8(pattern.hitbox.y).copy(header, 19);
  header[20] = Math.max(0, Math.min(255, Number(pattern.sprite.frameWidth) || 8));
  header[21] = Math.max(0, Math.min(255, Number(pattern.sprite.frameHeight) || 8));
  header[22] = Math.max(0, Math.min(255, Number(pattern.sprite.tileCount) || 1));
  header[23] = 0;
  header[24] = pattern.rootActions[0] ? indexOf('action', pattern.rootActions[0]) : 0xff;
  header[25] = pattern.rootActions[1] ? indexOf('action', pattern.rootActions[1]) : 0xff;
  const bytes = Buffer.concat([header, ...entries, ...blocks]);
  const hash = crypto.createHash('sha256').update(bytes).digest();
  hash.copy(bytes, 26, 0, 6);
  return {
    ok: true,
    abi: 'BMLB ABI v1',
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    pattern,
    definitionIndexes: Object.fromEntries(definitionIndexes),
    report: { byteLength: bytes.length, definitions: blocks.length, rootActions: pattern.rootActions.length, expressionFormat: 'Q16.16', endian: 'big' },
  };
}

class Reader {
  constructor(buffer, offset = 0, end = buffer.length) { this.buffer = buffer; this.offset = offset; this.end = end; }
  ensure(length) { if (this.offset + length > this.end) throw new CompileError('BMLBが途中で切れています', 'BMLB_TRUNCATED'); }
  byte() { this.ensure(1); return this.buffer[this.offset++]; }
  word() { this.ensure(2); const value = this.buffer.readUInt16BE(this.offset); this.offset += 2; return value; }
  take(length) { this.ensure(length); const result = this.buffer.subarray(this.offset, this.offset + length); this.offset += length; return result; }
}

function readExpression(reader) {
  const length = reader.byte();
  return reader.take(length);
}

function readDirection(reader) {
  const type = reader.byte();
  if (type === 0xff) return null;
  if (type > 3) throw new CompileError(`direction type ${type} が不正です`, 'BMLB_DIRECTION');
  return { type, expression: readExpression(reader) };
}

function readSpeed(reader) {
  const type = reader.byte();
  if (type === 0xff) return null;
  if (type > 2) throw new CompileError(`speed type ${type} が不正です`, 'BMLB_SPEED');
  return { type, expression: readExpression(reader) };
}

function readParams(reader) {
  const count = reader.byte();
  if (count > schema.LIMITS.params) throw new CompileError('BMLB param数が不正です', 'BMLB_PARAM_LIMIT');
  return Array.from({ length: count }, () => readExpression(reader));
}

function readActionBinding(reader) {
  const mode = reader.byte();
  if (mode === 0) return { mode, definition: reader.byte(), params: readParams(reader) };
  if (mode === 1) { const length = reader.word(); return { mode, block: reader.take(length) }; }
  throw new CompileError('action binding modeが不正です', 'BMLB_BINDING');
}

function readBulletBinding(reader) {
  const mode = reader.byte();
  if (mode === 0) return { mode, definition: reader.byte(), params: readParams(reader) };
  if (mode === 1) { const length = reader.word(); return { mode, block: reader.take(length) }; }
  throw new CompileError('bullet binding modeが不正です', 'BMLB_BINDING');
}

function readFire(reader) {
  return { direction: readDirection(reader), speed: readSpeed(reader), bullet: readBulletBinding(reader) };
}

function decodeBlock(block) {
  const reader = new Reader(block);
  const instructions = [];
  while (reader.offset < reader.end) {
    const start = reader.offset;
    const opcode = reader.byte();
    const length = reader.byte();
    const payload = new Reader(reader.take(length));
    let value = { opcode, start, size: length + 2 };
    if (opcode === OPCODE.WAIT) value.expression = readExpression(payload);
    else if (opcode === OPCODE.FIRE) value.fire = readFire(payload);
    else if (opcode === OPCODE.FIRE_REF) value = { ...value, definition: payload.byte(), params: readParams(payload) };
    else if (opcode === OPCODE.REPEAT) value = { ...value, times: readExpression(payload), action: readActionBinding(payload) };
    else if (opcode === OPCODE.CHANGE_DIRECTION) value = { ...value, direction: readDirection(payload), term: readExpression(payload) };
    else if (opcode === OPCODE.CHANGE_SPEED) value = { ...value, speed: readSpeed(payload), term: readExpression(payload) };
    else if (opcode === OPCODE.ACTION_REF) value = { ...value, definition: payload.byte(), params: readParams(payload) };
    else if (opcode === OPCODE.BULLET_META) {
      const direction = readDirection(payload);
      const speed = readSpeed(payload);
      const count = payload.byte();
      value = { ...value, direction, speed, actions: Array.from({ length: count }, () => readActionBinding(payload)) };
    } else if (![OPCODE.END, OPCODE.VANISH].includes(opcode)) throw new CompileError(`未知のBMLB opcodeです: ${opcode}`, 'BMLB_OPCODE');
    if (payload.offset !== payload.end) throw new CompileError(`opcode ${opcode} payloadに余剰byteがあります`, 'BMLB_PAYLOAD');
    instructions.push(value);
    if (opcode === OPCODE.END) break;
  }
  return instructions;
}

function decodeBmlb(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length < HEADER_SIZE || bytes.toString('ascii', 0, 4) !== 'BMLB') throw new CompileError('BMLB magicがありません', 'BMLB_MAGIC');
  if (bytes[4] !== ABI_VERSION) throw new CompileError(`BMLB ABI ${bytes[4]} は非対応です`, 'BMLB_VERSION');
  const totalSize = bytes.readUInt16BE(8);
  if (totalSize !== bytes.length) throw new CompileError(`BMLB sizeが一致しません: ${totalSize}/${bytes.length}`, 'BMLB_SIZE');
  const count = bytes[6];
  const tableOffset = bytes.readUInt16BE(10);
  const definitions = [];
  for (let index = 0; index < count; index += 1) {
    const entry = tableOffset + index * DEFINITION_ENTRY_SIZE;
    if (entry + DEFINITION_ENTRY_SIZE > bytes.length) throw new CompileError('definition tableが途中で切れています', 'BMLB_TABLE');
    const kind = bytes[entry];
    const offset = bytes.readUInt16BE(entry + 2);
    const length = bytes.readUInt16BE(entry + 4);
    if (offset + length > bytes.length) throw new CompileError('definition blockが範囲外です', 'BMLB_OFFSET');
    const block = bytes.subarray(offset, offset + length);
    definitions.push({ index, kind, offset, length, labelHash: bytes.readUInt16BE(entry + 6), block, instructions: decodeBlock(block) });
  }
  return {
    bytes,
    version: bytes[4],
    type: bytes[5],
    rootCount: bytes[7],
    roots: [bytes[24], bytes[25]].slice(0, bytes[7]),
    lifetime: bytes.readUInt16BE(14),
    margin: bytes[16],
    hitbox: { radius: bytes[17], x: bytes.readInt8(18), y: bytes.readInt8(19) },
    sprite: { width: bytes[20], height: bytes[21], tileCount: bytes[22] },
    hashPrefix: bytes.subarray(26, 32).toString('hex'),
    definitions,
  };
}

module.exports = {
  ABI_VERSION,
  HEADER_SIZE,
  DEFINITION_ENTRY_SIZE,
  KIND,
  OPCODE,
  DIRECTION,
  SPEED,
  CompileError,
  compilePattern,
  decodeBmlb,
  decodeBlock,
  labelHash,
};
