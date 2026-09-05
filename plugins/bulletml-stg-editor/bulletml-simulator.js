'use strict';

const schema = require('./bulletml-schema');
const expr = require('./bulletml-expression');
const compiler = require('./bulletml-compiler');

const TURN = 0x10000;
const COORD_SCALE = 64;
const GLOBAL_SPRITES = 80;
const SCANLINE_PIECES = 20;
const SCANLINE_DOTS = 320;
const TRIG_Q14 = Object.freeze(Array.from({ length: 1024 }, (_, index) => Math.round(Math.sin(index * Math.PI * 2 / 1024) * 16384)));
const ATAN_TURN = Object.freeze(Array.from({ length: 256 }, (_, index) => Math.round(Math.atan(index / 255) * TURN / (Math.PI * 2))));

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function signedTurn(value) { let result = value & 0xffff; if (result >= 0x8000) result -= TURN; return result; }
function normalizeTurn(value) { return value & 0xffff; }
function qMul(a, b) { return Number((BigInt(a) * BigInt(b)) / 65536n) | 0; }
function qDiv(a, b) { if (!b) return 0; return Number((BigInt(a) * 65536n) / BigInt(b)) | 0; }

function evaluateBytecode(bytes, runtime, params = []) {
  const stack = [];
  let offset = 0;
  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode === expr.EXPR_OP.END) break;
    if (opcode === expr.EXPR_OP.CONST) { stack.push(bytes.readInt32BE(offset)); offset += 4; }
    else if (opcode === expr.EXPR_OP.RANK) stack.push(runtime.rankQ16);
    else if (opcode === expr.EXPR_OP.RAND) { runtime.seed = expr.nextRandom(runtime.seed); stack.push(runtime.seed); }
    else if (opcode >= expr.EXPR_OP.PARAM1 && opcode < expr.EXPR_OP.PARAM1 + 4) stack.push(params[opcode - expr.EXPR_OP.PARAM1] || 0);
    else if (opcode === expr.EXPR_OP.NEG) stack.push(-(stack.pop() || 0) | 0);
    else {
      const right = stack.pop() || 0;
      const left = stack.pop() || 0;
      if (opcode === expr.EXPR_OP.ADD) stack.push(left + right | 0);
      else if (opcode === expr.EXPR_OP.SUB) stack.push(left - right | 0);
      else if (opcode === expr.EXPR_OP.MUL) stack.push(qMul(left, right));
      else if (opcode === expr.EXPR_OP.DIV) stack.push(qDiv(left, right));
      else throw new Error(`未知の式opcodeです: ${opcode}`);
    }
    if (stack.length > 16) throw new Error('式stack overflow');
  }
  return stack.pop() || 0;
}

function crc32(bytes, initial = 0xffffffff) {
  let crc = initial >>> 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}

class BulletmlVm {
  constructor(programInput, options = {}) {
    this.program = programInput?.definitions ? programInput : compiler.decodeBmlb(programInput?.bytes || programInput);
    this.limit = {
      bullets: Number(options.bullets || schema.LIMITS.bullets),
      emitters: Number(options.emitters || schema.LIMITS.emitters),
      contexts: Number(options.contexts || schema.LIMITS.contexts),
      spawns: Number(options.spawns || schema.LIMITS.spawnsPerFrame),
      opcodes: Number(options.opcodes || schema.LIMITS.opcodesPerFrame),
    };
    this.rankQ16 = 0;
    this.seed = expr.normalizeSeed(options.seed ?? 0xace1);
    this.player = { x: 160 * COORD_SCALE, y: 196 * COORD_SCALE };
    this.emitters = [];
    this.bullets = [];
    this.contexts = [];
    this.frame = 0;
    this.nextEmitterId = 1;
    this.nextBulletId = 1;
    this.nextContextId = 1;
    this.spawnedThisFrame = 0;
    this.metrics = {
      frame: 0, bullets: 0, emitters: 0, contexts: 0, maxBullets: 0, maxEmitters: 0, maxContexts: 0,
      maxOpcodesPerFrame: 0, maxSpawnedPerFrame: 0, spawned: 0, fireDrops: 0, poolDrops: 0, spawnDrops: 0, contextDrops: 0,
      opcodeExhaustions: 0, opcodesThisFrame: 0, displayDeletes: 0, culled: 0, expired: 0,
    };
    this.lastOpcode = 0;
  }

  reset(options = {}) {
    const fresh = new BulletmlVm(this.program, { ...this.limit, seed: options.seed ?? this.seed });
    fresh.setRank(options.rank ?? this.rankQ16 / 65535);
    fresh.setPlayer(options.playerX ?? this.player.x / COORD_SCALE, options.playerY ?? this.player.y / COORD_SCALE);
    Object.assign(this, fresh);
    return this;
  }

  setRank(value) { this.rankQ16 = clamp(Math.trunc(Number(value || 0) * 65535), 0, 65535); }
  setPlayer(x, y) { this.player.x = Math.trunc(Number(x) * COORD_SCALE); this.player.y = Math.trunc(Number(y) * COORD_SCALE); }

  startEmitter(options = {}) {
    if (this.emitters.length >= this.limit.emitters) return -1;
    const emitter = {
      id: this.nextEmitterId++,
      x: Math.trunc(Number(options.x ?? 160) * COORD_SCALE),
      y: Math.trunc(Number(options.y ?? 32) * COORD_SCALE),
      direction: normalizeTurn(options.direction || 0),
      speed: 0,
      orientation: options.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      active: true,
    };
    const required = this.program.roots.length;
    if (this.contexts.length + required > this.limit.contexts) { this.metrics.contextDrops += required; return -1; }
    this.emitters.push(emitter);
    for (const definition of this.program.roots) this.createContext('emitter', emitter.id, this.definitionBlock(definition), []);
    this.updateHighWater();
    return emitter.id;
  }

  updateEmitter(id, options = {}) {
    const emitter = this.emitters.find((item) => item.id === id);
    if (!emitter) return false;
    if (options.x != null) emitter.x = Math.trunc(Number(options.x) * COORD_SCALE);
    if (options.y != null) emitter.y = Math.trunc(Number(options.y) * COORD_SCALE);
    if (options.direction != null) emitter.direction = normalizeTurn(options.direction);
    return true;
  }

  stopEmitter(id) {
    const emitter = this.emitters.find((item) => item.id === id);
    if (!emitter) return false;
    emitter.active = false;
    this.contexts = this.contexts.filter((context) => !(context.ownerType === 'emitter' && context.ownerId === id));
    this.emitters = this.emitters.filter((item) => item.active);
    return true;
  }

  definitionBlock(index) {
    const definition = this.program.definitions[index];
    if (!definition) throw new Error(`definition index ${index} がありません`);
    return definition.block;
  }

  decode(block) { return compiler.decodeBlock(block); }

  createContext(ownerType, ownerId, block, params = []) {
    if (this.contexts.length >= this.limit.contexts) { this.metrics.contextDrops += 1; return null; }
    const context = {
      id: this.nextContextId++, ownerType, ownerId, wait: 0, dead: false,
      frames: [{ instructions: this.decode(block), index: 0, params: params.slice(0, 4), repeat: null }],
      sequenceDirection: null, sequenceSpeed: null, currentOpcode: 0,
    };
    this.contexts.push(context);
    return context;
  }

  owner(context) {
    return context.ownerType === 'emitter'
      ? this.emitters.find((item) => item.id === context.ownerId)
      : this.bullets.find((item) => item.id === context.ownerId);
  }

  eval(bytes, params) { return evaluateBytecode(bytes, this, params); }
  evalParams(values, params) { return (values || []).map((value) => this.eval(value, params)); }

  pushAction(context, binding, parentParams, repeat = null) {
    let block;
    let params = parentParams;
    if (binding.mode === 0) { block = this.definitionBlock(binding.definition); params = this.evalParams(binding.params, parentParams); }
    else block = binding.block;
    context.frames.push({ instructions: this.decode(block), index: 0, params, repeat });
  }

  finishFrame(context) {
    const finished = context.frames.pop();
    if (finished?.repeat && finished.repeat.remaining > 1) {
      const next = { ...finished.repeat, remaining: finished.repeat.remaining - 1 };
      this.pushAction(context, next.binding, next.parentParams, next);
    }
    if (!context.frames.length) context.dead = true;
  }

  aimTurn(owner) {
    const dx = this.player.x - owner.x;
    const dy = this.player.y - owner.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (!ax && !ay) return 0;
    let angle;
    if (ay >= ax) angle = ATAN_TURN[Math.trunc(ax * 255 / Math.max(1, ay))];
    else angle = 0x4000 - ATAN_TURN[Math.trunc(ay * 255 / Math.max(1, ax))];
    if (dy < 0) return normalizeTurn(dx >= 0 ? angle : TURN - angle);
    return normalizeTurn(dx >= 0 ? 0x8000 - angle : 0x8000 + angle);
  }

  directionValue(spec, context, owner, params, forChange = false) {
    if (!spec) return owner.direction || 0;
    const degreesQ16 = this.eval(spec.expression, params);
    const delta = Math.trunc(degreesQ16 / 360);
    let value;
    if (spec.type === compiler.DIRECTION.aim) value = this.aimTurn(owner) + delta;
    else if (spec.type === compiler.DIRECTION.absolute) value = delta;
    else if (spec.type === compiler.DIRECTION.relative) value = (owner.direction || 0) + delta;
    else {
      const base = context.sequenceDirection == null ? (owner.direction || 0) : context.sequenceDirection;
      value = base + delta;
      context.sequenceDirection = normalizeTurn(value);
    }
    if (forChange && spec.type === compiler.DIRECTION.aim) return normalizeTurn(value);
    return normalizeTurn(value);
  }

  speedValue(spec, context, owner, params) {
    if (!spec) return owner.speed || 0;
    const unitsQ16 = this.eval(spec.expression, params);
    const delta = Math.trunc((unitsQ16 * COORD_SCALE) / 65536);
    let value;
    if (spec.type === compiler.SPEED.absolute) value = delta;
    else if (spec.type === compiler.SPEED.relative) value = (owner.speed || 0) + delta;
    else {
      const base = context.sequenceSpeed == null ? (owner.speed || 0) : context.sequenceSpeed;
      value = base + delta;
      context.sequenceSpeed = value;
    }
    return clamp(value, -32768, 32767);
  }

  bulletMeta(binding, parentParams) {
    let block;
    let params = parentParams;
    if (binding.mode === 0) { block = this.definitionBlock(binding.definition); params = this.evalParams(binding.params, parentParams); }
    else block = binding.block;
    const meta = this.decode(block).find((item) => item.opcode === compiler.OPCODE.BULLET_META);
    if (!meta) throw new Error('bullet definitionにBULLET_METAがありません');
    return { ...meta, params };
  }

  resolveFireReference(definition, params) {
    const block = this.definitionBlock(definition);
    const fire = this.decode(block).find((item) => item.opcode === compiler.OPCODE.FIRE)?.fire;
    if (!fire) throw new Error('fire definitionにFIREがありません');
    return { fire, params };
  }

  spawn(context, fire, params) {
    const owner = this.owner(context);
    if (!owner) return false;
    if (this.spawnedThisFrame >= this.limit.spawns) { this.metrics.spawnDrops += 1; this.metrics.fireDrops += 1; return false; }
    if (this.bullets.length >= this.limit.bullets) { this.metrics.poolDrops += 1; this.metrics.fireDrops += 1; return false; }
    const meta = this.bulletMeta(fire.bullet, params);
    if (this.contexts.length + meta.actions.length > this.limit.contexts) { this.metrics.contextDrops += meta.actions.length; this.metrics.fireDrops += 1; return false; }
    const direction = this.directionValue(fire.direction || meta.direction, context, owner, fire.direction ? params : meta.params);
    const speed = this.speedValue(fire.speed || meta.speed, context, owner, fire.speed ? params : meta.params);
    const bullet = {
      id: this.nextBulletId++, order: this.nextBulletId, x: owner.x, y: owner.y, direction, speed,
      age: 0, alive: true, visible: true, directionChange: null, speedChange: null,
    };
    this.bullets.push(bullet);
    for (const action of meta.actions) {
      let block;
      let actionParams = meta.params;
      if (action.mode === 0) { block = this.definitionBlock(action.definition); actionParams = this.evalParams(action.params, meta.params); }
      else block = action.block;
      this.createContext('bullet', bullet.id, block, actionParams);
    }
    this.spawnedThisFrame += 1;
    this.metrics.spawned += 1;
    this.updateHighWater();
    return true;
  }

  interpolateStart(current, target, term, angular = false) {
    let delta = angular ? signedTurn(target - current) : target - current;
    const quotient = Math.trunc(delta / term);
    const remainder = delta - quotient * term;
    return { remaining: term, term, quotient, remainder, error: 0, target, angular };
  }

  processContext(context) {
    const owner = this.owner(context);
    if (!owner || owner.alive === false || owner.active === false) { context.dead = true; return; }
    if (context.wait > 0) { context.wait -= 1; return; }
    while (!context.dead && this.metrics.opcodesThisFrame < this.limit.opcodes) {
      const frame = context.frames[context.frames.length - 1];
      if (!frame) { context.dead = true; break; }
      const instruction = frame.instructions[frame.index++];
      if (!instruction || instruction.opcode === compiler.OPCODE.END) { this.finishFrame(context); continue; }
      this.metrics.opcodesThisFrame += 1;
      this.lastOpcode = instruction.opcode;
      context.currentOpcode = instruction.opcode;
      if (instruction.opcode === compiler.OPCODE.WAIT) {
        context.wait = clamp(Math.trunc(this.eval(instruction.expression, frame.params) / 65536), 0, 65535);
        if (context.wait > 0) break;
      } else if (instruction.opcode === compiler.OPCODE.FIRE) this.spawn(context, instruction.fire, frame.params);
      else if (instruction.opcode === compiler.OPCODE.FIRE_REF) {
        const params = this.evalParams(instruction.params, frame.params);
        const referenced = this.resolveFireReference(instruction.definition, params);
        this.spawn(context, referenced.fire, referenced.params);
      } else if (instruction.opcode === compiler.OPCODE.REPEAT) {
        const times = clamp(Math.trunc(this.eval(instruction.times, frame.params) / 65536), 0, 65535);
        if (times > 0) this.pushAction(context, instruction.action, frame.params, { remaining: times, binding: instruction.action, parentParams: frame.params });
      } else if (instruction.opcode === compiler.OPCODE.ACTION_REF) {
        this.pushAction(context, { mode: 0, definition: instruction.definition, params: instruction.params }, frame.params);
      } else if (instruction.opcode === compiler.OPCODE.VANISH) {
        if (context.ownerType === 'bullet') owner.alive = false;
        context.dead = true;
      } else if (instruction.opcode === compiler.OPCODE.CHANGE_DIRECTION && context.ownerType === 'bullet') {
        const term = clamp(Math.trunc(this.eval(instruction.term, frame.params) / 65536), 1, 65535);
        const target = this.directionValue(instruction.direction, context, owner, frame.params, true);
        owner.directionChange = this.interpolateStart(owner.direction, target, term, true);
      } else if (instruction.opcode === compiler.OPCODE.CHANGE_SPEED && context.ownerType === 'bullet') {
        const term = clamp(Math.trunc(this.eval(instruction.term, frame.params) / 65536), 1, 65535);
        const target = this.speedValue(instruction.speed, context, owner, frame.params);
        owner.speedChange = this.interpolateStart(owner.speed, target, term, false);
      }
    }
  }

  applyInterpolation(bullet, key, targetKey) {
    const change = bullet[key];
    if (!change || change.remaining <= 0) return;
    let step = change.quotient;
    change.error += Math.abs(change.remainder);
    if (change.error >= change.term) { step += Math.sign(change.remainder); change.error -= change.term; }
    bullet[targetKey] = change.angular ? normalizeTurn(bullet[targetKey] + step) : bullet[targetKey] + step;
    change.remaining -= 1;
    if (change.remaining === 0) { bullet[targetKey] = change.target; bullet[key] = null; }
  }

  moveBullets() {
    for (const bullet of this.bullets) {
      if (!bullet.alive) continue;
      this.applyInterpolation(bullet, 'directionChange', 'direction');
      this.applyInterpolation(bullet, 'speedChange', 'speed');
      const trigIndex = bullet.direction >>> 6;
      bullet.x += Math.trunc(TRIG_Q14[trigIndex] * bullet.speed / 16384);
      bullet.y -= Math.trunc(TRIG_Q14[(trigIndex + 256) & 1023] * bullet.speed / 16384);
      bullet.age += 1;
      const halfWidth = Math.ceil(this.program.sprite.width / 2) * COORD_SCALE;
      const halfHeight = Math.ceil(this.program.sprite.height / 2) * COORD_SCALE;
      const margin = this.program.margin * COORD_SCALE;
      if (bullet.age >= this.program.lifetime) { bullet.alive = false; this.metrics.expired += 1; }
      else if (bullet.x + halfWidth < -margin || bullet.y + halfHeight < -margin || bullet.x - halfWidth > 320 * COORD_SCALE + margin || bullet.y - halfHeight > 224 * COORD_SCALE + margin) {
        bullet.alive = false; this.metrics.culled += 1;
      }
    }
  }

  cleanup() {
    const live = new Set(this.bullets.filter((item) => item.alive).map((item) => item.id));
    this.bullets = this.bullets.filter((item) => item.alive);
    this.contexts = this.contexts.filter((context) => !context.dead && (context.ownerType === 'emitter' || live.has(context.ownerId)));
  }

  tick() {
    this.frame += 1;
    this.spawnedThisFrame = 0;
    this.metrics.opcodesThisFrame = 0;
    const contexts = this.contexts.slice();
    for (const context of contexts) {
      if (this.metrics.opcodesThisFrame >= this.limit.opcodes) break;
      this.processContext(context);
    }
    if (this.metrics.opcodesThisFrame >= this.limit.opcodes && this.contexts.some((item) => !item.dead && item.wait === 0)) this.metrics.opcodeExhaustions += 1;
    this.moveBullets();
    this.cleanup();
    this.metrics.frame = this.frame;
    this.metrics.bullets = this.bullets.length;
    this.metrics.emitters = this.emitters.length;
    this.metrics.contexts = this.contexts.length;
    this.metrics.maxOpcodesPerFrame = Math.max(this.metrics.maxOpcodesPerFrame, this.metrics.opcodesThisFrame);
    this.metrics.maxSpawnedPerFrame = Math.max(this.metrics.maxSpawnedPerFrame, this.spawnedThisFrame);
    this.updateHighWater();
    return this.getMetrics();
  }

  applyDisplayBudget(input = {}) {
    let global = clamp(Math.trunc(Number(input.globalSprites) || 0), 0, GLOBAL_SPRITES);
    const pieces = Array.from({ length: 224 }, (_, y) => clamp(Math.trunc(Number(input.scanlinePieces?.[y]) || 0), 0, SCANLINE_PIECES));
    const dots = Array.from({ length: 224 }, (_, y) => clamp(Math.trunc(Number(input.scanlineDots?.[y]) || 0), 0, SCANLINE_DOTS));
    const removed = [];
    const width = this.program.sprite.width;
    const height = this.program.sprite.height;
    for (const bullet of this.bullets.sort((a, b) => a.id - b.id)) {
      const top = clamp(Math.floor(bullet.y / COORD_SCALE - height / 2), 0, 223);
      const bottom = clamp(Math.ceil(bullet.y / COORD_SCALE + height / 2) - 1, 0, 223);
      let fits = global < GLOBAL_SPRITES;
      for (let y = top; fits && y <= bottom; y += 1) fits = pieces[y] + 1 <= SCANLINE_PIECES && dots[y] + width <= SCANLINE_DOTS;
      if (!fits) { bullet.alive = false; bullet.visible = false; removed.push(bullet.id); this.metrics.displayDeletes += 1; continue; }
      global += 1;
      for (let y = top; y <= bottom; y += 1) { pieces[y] += 1; dots[y] += width; }
      bullet.visible = true;
    }
    this.cleanup();
    return { removed, globalSprites: global, scanlinePieces: pieces, scanlineDots: dots, maxPieces: Math.max(...pieces), maxDots: Math.max(...dots) };
  }

  clearAll() {
    this.bullets = [];
    this.contexts = this.contexts.filter((context) => context.ownerType === 'emitter');
  }

  getBullets() {
    return this.bullets.map((bullet) => ({ id: bullet.id, x: bullet.x / COORD_SCALE, y: bullet.y / COORD_SCALE, direction: bullet.direction, speed: bullet.speed / COORD_SCALE, age: bullet.age, visible: bullet.visible }));
  }

  updateHighWater() {
    this.metrics.maxBullets = Math.max(this.metrics.maxBullets, this.bullets.length);
    this.metrics.maxEmitters = Math.max(this.metrics.maxEmitters, this.emitters.length);
    this.metrics.maxContexts = Math.max(this.metrics.maxContexts, this.contexts.length);
  }

  getMetrics() { return { ...this.metrics, seed: this.seed, rankQ16: this.rankQ16, lastOpcode: this.lastOpcode }; }

  stateCrc(previous = 0xffffffff) {
    const bytes = Buffer.alloc(12 + this.bullets.length * 14);
    bytes.writeUInt32BE(this.frame >>> 0, 0);
    bytes.writeUInt16BE(this.seed, 4);
    bytes.writeUInt16BE(this.bullets.length, 6);
    bytes.writeUInt16BE(this.contexts.length, 8);
    bytes.writeUInt16BE(this.lastOpcode, 10);
    let offset = 12;
    for (const bullet of this.bullets.slice().sort((a, b) => a.id - b.id)) {
      bytes.writeUInt16BE(bullet.id & 0xffff, offset); offset += 2;
      bytes.writeInt32BE(bullet.x | 0, offset); offset += 4;
      bytes.writeInt32BE(bullet.y | 0, offset); offset += 4;
      bytes.writeUInt16BE(bullet.direction, offset); offset += 2;
      bytes.writeInt16BE(clamp(bullet.speed, -32768, 32767), offset); offset += 2;
    }
    return crc32(bytes, previous);
  }
}

function playerPosition(pathId, frame, orientation = 'vertical') {
  if (pathId === 'horizontal') return { x: 40 + ((frame % 480) < 240 ? (frame % 240) : 239 - (frame % 240)) * 240 / 239, y: orientation === 'horizontal' ? 170 : 196 };
  if (pathId === 'vertical') return { x: orientation === 'horizontal' ? 56 : 160, y: 40 + ((frame % 360) < 180 ? (frame % 180) : 179 - (frame % 180)) * 156 / 179 };
  return { x: orientation === 'horizontal' ? 56 : 160, y: orientation === 'horizontal' ? 112 : 196 };
}

function runValidationMatrix(compiled, options = {}) {
  const program = compiled?.bytes || compiled;
  const decoded = compiler.decodeBmlb(program);
  const ranks = options.ranks || [0, 0.5, 1];
  const seeds = options.seeds || [0x0001, 0xace1, 0xffff];
  const paths = options.paths || ['center', 'horizontal', 'vertical'];
  const orientations = decoded.type === 0 ? ['vertical', 'horizontal'] : [decoded.type === 2 ? 'horizontal' : 'vertical'];
  const frames = options.frames || 3600;
  const cases = [];
  for (const orientation of orientations) for (const rank of ranks) for (const seed of seeds) for (const pathId of paths) {
    const vm = new BulletmlVm(program, { seed });
    vm.setRank(rank);
    const emitter = vm.startEmitter({ x: orientation === 'horizontal' ? 280 : 160, y: orientation === 'horizontal' ? 112 : 28, orientation });
    let crc = 0xffffffff;
    for (let frame = 0; frame < frames; frame += 1) {
      const player = playerPosition(pathId, frame, orientation);
      vm.setPlayer(player.x, player.y);
      vm.tick();
      vm.applyDisplayBudget();
      crc = vm.stateCrc(crc);
    }
    const metrics = vm.getMetrics();
    const failed = metrics.fireDrops || metrics.opcodeExhaustions || metrics.contextDrops || metrics.displayDeletes;
    cases.push({ orientation, rank, seed, path: pathId, frames, crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'), metrics, ok: !failed, emitterStarted: emitter >= 0 });
  }
  return {
    ok: cases.every((item) => item.ok && item.emitterStarted),
    cases,
    failures: cases.filter((item) => !item.ok || !item.emitterStarted),
    maxima: {
      bullets: Math.max(0, ...cases.map((item) => item.metrics.maxBullets)),
      emitters: Math.max(0, ...cases.map((item) => item.metrics.maxEmitters)),
      contexts: Math.max(0, ...cases.map((item) => item.metrics.maxContexts)),
      opcodes: Math.max(0, ...cases.map((item) => item.metrics.maxOpcodesPerFrame)),
      spawns: Math.max(0, ...cases.map((item) => item.metrics.maxSpawnedPerFrame)),
    },
  };
}

function stagePoint(event, age, orientation) {
  const points = event.path || [];
  if (!points.length) return orientation === 'horizontal' ? { x: 288, y: 112 } : { x: 160, y: 28 };
  if (age <= points[0].frame) return points[0];
  for (let index = 1; index < points.length; index += 1) {
    if (age <= points[index].frame) {
      const previous = points[index - 1];
      const next = points[index];
      const ratio = (age - previous.frame) / Math.max(1, next.frame - previous.frame);
      return { x: previous.x + (next.x - previous.x) * ratio, y: previous.y + (next.y - previous.y) * ratio };
    }
  }
  return points.at(-1);
}

function reserveHostSprite(budget, x, y, width, height) {
  const top = clamp(Math.floor(y - height / 2), 0, 223);
  const bottom = clamp(Math.ceil(y + height / 2) - 1, 0, 223);
  if (budget.globalSprites >= GLOBAL_SPRITES) return false;
  for (let line = top; line <= bottom; line += 1) {
    if (budget.scanlinePieces[line] + 1 > SCANLINE_PIECES || budget.scanlineDots[line] + width > SCANLINE_DOTS) return false;
  }
  budget.globalSprites += 1;
  for (let line = top; line <= bottom; line += 1) {
    budget.scanlinePieces[line] += 1;
    budget.scanlineDots[line] += width;
  }
  return true;
}

function makeStageDisplayBudget(player, runtimes, playerShots) {
  const budget = { globalSprites: 0, scanlinePieces: Array(224).fill(0), scanlineDots: Array(224).fill(0) };
  let ok = reserveHostSprite(budget, player.x, player.y, 16, 16);
  for (const runtime of runtimes) {
    if (runtime.retired || runtime.emitterStopped) continue;
    const point = stagePoint(runtime.event, runtime.eventAge, runtime.orientation);
    const size = runtime.event.boss ? 32 : 16;
    ok = reserveHostSprite(budget, point.x, point.y, size, size) && ok;
  }
  for (const shot of playerShots) ok = reserveHostSprite(budget, shot.x, shot.y, 8, 8) && ok;
  return { budget, ok };
}

function runStageValidationMatrix(stageInput, compiledPatterns, options = {}) {
  const stage = schema.normalizeStage(stageInput, stageInput?.orientation);
  const programs = compiledPatterns instanceof Map ? compiledPatterns : new Map(Object.entries(compiledPatterns || {}));
  const ranks = options.ranks || [0, 0.5, 1];
  const seeds = options.seeds || [0x0001, 0xace1, 0xffff];
  const paths = options.paths || ['center', 'horizontal', 'vertical'];
  const frames = options.frames || stage.durationFrames;
  const cases = [];
  for (const rank of ranks) for (const seed of seeds) for (const pathId of paths) {
    let runtimes = [];
    let playerShots = [];
    let nextEvent = 0;
    let failure = '';
    let crc = 0xffffffff;
    const maxima = { bullets: 0, emitters: 0, contexts: 0, opcodes: 0, spawns: 0, pieces: 0, dots: 0 };
    const sorted = stage.events
      .filter((event) => ['spawn_enemy', 'spawn_boss', 'spawn_destructible'].includes(event.action?.type))
      .sort((left, right) => (left.spawnFrame - right.spawnFrame) || (left.order - right.order) || String(left.id).localeCompare(String(right.id)));
    function startRuntime(event, patternId, frame, phase = 0) {
      if (!patternId) return;
      const program = programs.get(patternId);
      if (!program) { failure ||= `missing pattern ${patternId}`; return; }
      const vm = new BulletmlVm(program.bytes || program, { seed: normalizeStageSeed(seed, event.id, phase) });
      vm.setRank(rank);
      const position = stagePoint(event, 0, stage.orientation);
      const emitter = vm.startEmitter({ x: position.x, y: position.y, orientation: stage.orientation });
      if (emitter < 0) { failure ||= 'emitter allocation failed'; return; }
      runtimes.push({ event, vm, emitter, phaseStartedFrame: frame, phase, orientation: stage.orientation, eventAge: Math.max(0, frame - event.spawnFrame), emitterStopped: false, retired: false, lastSpawned: 0, lastDisplayDeletes: 0, lastFireDrops: 0, lastOpcodeExhaustions: 0, lastContextDrops: 0 });
    }
    for (let frame = 0; frame < frames; frame += 1) {
      while (nextEvent < sorted.length && sorted[nextEvent].spawnFrame <= frame) { startRuntime(sorted[nextEvent], sorted[nextEvent].patternId, frame, 0); nextEvent += 1; }
      const player = playerPosition(pathId, frame, stage.orientation);
      if (frame % 6 === 0 && playerShots.length < 12) playerShots.push({ x: player.x, y: player.y, orientation: stage.orientation });
      for (const shot of playerShots) {
        if (stage.orientation === 'horizontal') shot.x += 7;
        else shot.y -= 7;
      }
      playerShots = playerShots.filter((shot) => shot.x >= -8 && shot.x <= 328 && shot.y >= -8 && shot.y <= 232);
      for (const runtime of runtimes.slice()) {
        if (runtime.retired) continue;
        const age = frame - runtime.event.spawnFrame;
        runtime.eventAge = Math.max(0, age);
        if (!runtime.event.boss && age >= 660 && !runtime.emitterStopped) {
          runtime.vm.stopEmitter(runtime.emitter);
          runtime.emitterStopped = true;
        }
        if (runtime.event.boss && runtime.event.phases.length > 1 && !runtime.emitterStopped) {
          const phaseLength = Math.max(1, Math.trunc((frames - runtime.event.spawnFrame) / runtime.event.phases.length));
          const desired = Math.min(runtime.event.phases.length - 1, Math.trunc((frame - runtime.event.spawnFrame) / phaseLength));
          if (desired > runtime.phase) {
            for (const active of runtimes) active.vm.clearAll();
            runtime.vm.stopEmitter(runtime.emitter);
            runtime.emitterStopped = true;
            runtime.retired = true;
            startRuntime(runtime.event, runtime.event.phases[desired].patternId, frame, desired);
            continue;
          }
        }
        const position = stagePoint(runtime.event, age, stage.orientation);
        if (!runtime.emitterStopped) runtime.vm.updateEmitter(runtime.emitter, position);
        runtime.vm.setPlayer(player.x, player.y);
        runtime.vm.tick();
        crc = runtime.vm.stateCrc(crc);
      }
      const host = makeStageDisplayBudget(player, runtimes, playerShots);
      let budget = host.budget;
      if (!host.ok) failure ||= 'host sprite budget exceeded';
      let bulletTotal = 0; let contextTotal = 0; let opcodeTotal = 0; let spawnTotal = 0; let emitterTotal = 0;
      for (const runtime of runtimes) {
        if (runtime.retired && !runtime.vm.getBullets().length) continue;
        const before = runtime.vm.getMetrics();
        bulletTotal += before.bullets;
        contextTotal += before.contexts;
        opcodeTotal += before.opcodesThisFrame;
        spawnTotal += before.spawned - runtime.lastSpawned;
        emitterTotal += before.emitters;
        const display = runtime.vm.applyDisplayBudget(budget);
        budget = { globalSprites: display.globalSprites, scanlinePieces: display.scanlinePieces, scanlineDots: display.scanlineDots };
        const metrics = runtime.vm.getMetrics();
        runtime.lastSpawned = metrics.spawned;
        if (metrics.fireDrops > runtime.lastFireDrops) failure ||= `${runtime.event.id}: fire drop`;
        if (metrics.opcodeExhaustions > runtime.lastOpcodeExhaustions) failure ||= `${runtime.event.id}: opcode exhaustion`;
        if (metrics.contextDrops > runtime.lastContextDrops) failure ||= `${runtime.event.id}: context drop`;
        if (metrics.displayDeletes > runtime.lastDisplayDeletes) failure ||= `${runtime.event.id}: display deletion`;
        runtime.lastFireDrops = metrics.fireDrops;
        runtime.lastOpcodeExhaustions = metrics.opcodeExhaustions;
        runtime.lastContextDrops = metrics.contextDrops;
        runtime.lastDisplayDeletes = metrics.displayDeletes;
      }
      maxima.bullets = Math.max(maxima.bullets, bulletTotal); maxima.contexts = Math.max(maxima.contexts, contextTotal); maxima.opcodes = Math.max(maxima.opcodes, opcodeTotal); maxima.spawns = Math.max(maxima.spawns, spawnTotal); maxima.emitters = Math.max(maxima.emitters, emitterTotal); maxima.pieces = Math.max(maxima.pieces, ...budget.scanlinePieces); maxima.dots = Math.max(maxima.dots, ...budget.scanlineDots);
      if (bulletTotal > schema.LIMITS.bullets) failure ||= `global bullets ${bulletTotal}/${schema.LIMITS.bullets}`;
      if (contextTotal > schema.LIMITS.contexts) failure ||= `global contexts ${contextTotal}/${schema.LIMITS.contexts}`;
      if (emitterTotal > schema.LIMITS.emitters) failure ||= `global emitters ${emitterTotal}/${schema.LIMITS.emitters}`;
      if (opcodeTotal > schema.LIMITS.opcodesPerFrame) failure ||= `global opcodes ${opcodeTotal}/${schema.LIMITS.opcodesPerFrame}`;
      if (spawnTotal > schema.LIMITS.spawnsPerFrame) failure ||= `global spawns ${spawnTotal}/${schema.LIMITS.spawnsPerFrame}`;
      runtimes = runtimes.filter((runtime) => !(runtime.emitterStopped && runtime.vm.getMetrics().bullets === 0 && runtime.vm.getMetrics().contexts === 0));
    }
    cases.push({ orientation: stage.orientation, rank, seed, path: pathId, frames, outcome: failure ? 'timeout-failed' : 'timeout', ok: !failure, failure, crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'), maxima });
  }
  return {
    ok: cases.every((item) => item.ok),
    cases,
    failures: cases.filter((item) => !item.ok),
    maxima: {
      bullets: Math.max(0, ...cases.map((item) => item.maxima.bullets)), emitters: Math.max(0, ...cases.map((item) => item.maxima.emitters)), contexts: Math.max(0, ...cases.map((item) => item.maxima.contexts)),
      opcodes: Math.max(0, ...cases.map((item) => item.maxima.opcodes)), spawns: Math.max(0, ...cases.map((item) => item.maxima.spawns)), pieces: Math.max(0, ...cases.map((item) => item.maxima.pieces)), dots: Math.max(0, ...cases.map((item) => item.maxima.dots)),
    },
  };
}

function normalizeStageSeed(seed, id, phase) {
  let value = expr.normalizeSeed(seed);
  for (const char of String(id || '')) value = expr.nextRandom(value ^ char.charCodeAt(0));
  return expr.normalizeSeed(value ^ Number(phase || 0));
}

module.exports = {
  TURN,
  COORD_SCALE,
  GLOBAL_SPRITES,
  SCANLINE_PIECES,
  SCANLINE_DOTS,
  TRIG_Q14,
  ATAN_TURN,
  BulletmlVm,
  evaluateBytecode,
  crc32,
  playerPosition,
  runValidationMatrix,
  runStageValidationMatrix,
};
