'use strict';

const schema = require('./bulletml-schema');
const expr = require('./bulletml-expression');
const simulator = require('./bulletml-simulator');

const { BulletmlVm, COORD_SCALE, GLOBAL_SPRITES, SCANLINE_PIECES, SCANLINE_DOTS } = simulator;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

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

function makeDisplayBudget(player, enemies, shots) {
  const budget = { globalSprites: 0, scanlinePieces: Array(224).fill(0), scanlineDots: Array(224).fill(0) };
  let ok = reserveHostSprite(budget, player.x, player.y, 16, 16);
  for (const enemy of enemies) {
    const size = enemy.event.boss ? 32 : 16;
    ok = reserveHostSprite(budget, enemy.x, enemy.y, size, size) && ok;
  }
  for (const shot of shots) ok = reserveHostSprite(budget, shot.x, shot.y, 8, 8) && ok;
  return { budget, ok };
}

class StagePreviewSession {
  constructor(stageInput, compiledPatterns, options = {}) {
    this.stage = schema.normalizeStage(stageInput, stageInput?.orientation);
    this.programs = compiledPatterns instanceof Map ? new Map(compiledPatterns) : new Map(Object.entries(compiledPatterns || {}));
    this.difficulty = clamp(Math.trunc(Number(options.difficulty ?? 1) || 0), 0, 2);
    this.rank = options.rank == null ? [0, 0.5, 1][this.difficulty] : clamp(Number(options.rank) || 0, 0, 1);
    this.baseSeed = expr.normalizeSeed(options.seed ?? 0xace1);
    this.sortedEvents = this.stage.events
      .map((event, sourceIndex) => ({ event, sourceIndex }))
      .sort((left, right) => left.event.spawnFrame - right.event.spawnFrame || left.sourceIndex - right.sourceIndex);
    const references = new Set();
    for (const event of this.stage.events) {
      if (event.patternId) references.add(event.patternId);
      for (const phase of event.phases) if (phase.patternId) references.add(phase.patternId);
    }
    for (const patternId of references) if (!this.programs.has(patternId)) throw new Error('Stage pattern ' + patternId + ' がありません');
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.nextEvent = 0;
    this.nextBulletOrder = 1;
    this.player = this.stage.orientation === 'horizontal' ? { x: 48, y: 112 } : { x: 160, y: 196 };
    this.lives = 3;
    this.score = 0;
    this.invincible = 0;
    this.hitInvincibilityFrames = [1200, 600, 300][this.difficulty];
    this.shots = [];
    this.enemies = [];
    this.runtimes = [];
    this.outcome = 'running';
    this.counters = { hits: 0, phaseChanges: 0, eventDrops: 0 };
    this.maxima = { bullets: 0, emitters: 0, contexts: 0, opcodes: 0, spawns: 0, pieces: 0, dots: 0, globalSprites: 0 };
    this.lastBudget = { globalSprites: 1, scanlinePieces: Array(224).fill(0), scanlineDots: Array(224).fill(0), maxPieces: 0, maxDots: 0, hostOk: true, removed: [] };
    this.lastMetrics = this.collectMetrics();
    return this.snapshot();
  }

  activeCounts() {
    let normal = 0;
    let boss = 0;
    for (const enemy of this.enemies) if (enemy.active) {
      if (enemy.event.boss) boss += 1;
      else normal += 1;
    }
    return { normal, boss, total: normal + boss };
  }

  runtimeTotals() {
    return this.runtimes.reduce((totals, runtime) => {
      totals.bullets += runtime.vm.bullets.length;
      totals.contexts += runtime.vm.contexts.length;
      totals.emitters += runtime.vm.emitters.length;
      return totals;
    }, { bullets: 0, contexts: 0, emitters: 0 });
  }

  startRuntime(enemy, patternId, seed) {
    const program = this.programs.get(patternId);
    if (!program) throw new Error('Stage pattern ' + patternId + ' がありません');
    const totals = this.runtimeTotals();
    if (totals.emitters >= schema.LIMITS.emitters) { this.counters.eventDrops += 1; return null; }
    const vm = new BulletmlVm(program?.bytes || program, { seed });
    vm.limit.emitters = 1;
    vm.limit.contexts = Math.max(0, schema.LIMITS.contexts - totals.contexts);
    vm.setRank(this.rank);
    vm.setPlayer(this.player.x, this.player.y);
    const emitter = vm.startEmitter({ x: enemy.x, y: enemy.y, orientation: this.stage.orientation });
    if (emitter < 0) { this.counters.eventDrops += 1; return null; }
    const runtime = {
      event: enemy.event,
      enemy,
      patternId,
      vm,
      emitter,
      emitterStopped: false,
      retired: false,
      orientation: this.stage.orientation,
      eventAge: Math.max(0, this.frame - enemy.event.spawnFrame),
    };
    this.runtimes.push(runtime);
    enemy.runtime = runtime;
    return runtime;
  }

  spawnEvent(entry, eventOrder) {
    const event = entry.event;
    const counts = this.activeCounts();
    if (counts.total >= 5 || (event.boss ? counts.boss >= 1 : counts.normal >= 4)) {
      this.counters.eventDrops += 1;
      return;
    }
    const position = stagePoint(event, 0, this.stage.orientation);
    const enemy = {
      event,
      sourceIndex: entry.sourceIndex,
      eventOrder,
      active: true,
      hp: event.hp,
      phase: 0,
      x: position.x,
      y: position.y,
      runtime: null,
    };
    this.enemies.push(enemy);
    this.startRuntime(enemy, event.patternId, expr.normalizeSeed((this.baseSeed + eventOrder * 73) & 0xffff));
  }

  stopRuntime(runtime) {
    if (!runtime || runtime.emitterStopped) return;
    runtime.vm.stopEmitter(runtime.emitter);
    runtime.emitterStopped = true;
  }

  clearAllBullets() {
    for (const runtime of this.runtimes) runtime.vm.clearAll();
  }

  stopEnemy(enemy) {
    if (!enemy?.active) return;
    this.stopRuntime(enemy.runtime);
    if (enemy.event.boss) this.clearAllBullets();
    this.score += enemy.event.score;
    enemy.active = false;
  }

  applyInput(input = {}) {
    if (input.player && Number.isFinite(Number(input.player.x)) && Number.isFinite(Number(input.player.y))) {
      this.player.x = Number(input.player.x);
      this.player.y = Number(input.player.y);
    }
    const speed = input.slow ? 1 : 3;
    if (input.left) this.player.x -= speed;
    if (input.right) this.player.x += speed;
    if (input.up) this.player.y -= speed;
    if (input.down) this.player.y += speed;
    this.player.x = clamp(this.player.x, 8, 312);
    this.player.y = clamp(this.player.y, 16, 216);
    if (input.fire && this.frame % 5 === 0 && this.shots.length < 8) this.shots.push({ id: this.frame, x: this.player.x, y: this.player.y - 10 });
  }

  spawnDueEvents() {
    while (this.nextEvent < this.sortedEvents.length && this.sortedEvents[this.nextEvent].event.spawnFrame <= this.frame) {
      this.spawnEvent(this.sortedEvents[this.nextEvent], this.nextEvent);
      this.nextEvent += 1;
    }
  }

  updateEnemies() {
    for (const enemy of this.enemies) if (enemy.active) {
      const age = Math.max(0, this.frame - enemy.event.spawnFrame);
      const position = stagePoint(enemy.event, age, this.stage.orientation);
      enemy.x = position.x;
      enemy.y = position.y;
      if (enemy.runtime && !enemy.runtime.emitterStopped) {
        enemy.runtime.eventAge = age;
        enemy.runtime.vm.updateEmitter(enemy.runtime.emitter, position);
      }
      if (!enemy.event.boss && age >= 660) {
        this.stopEnemy(enemy);
        continue;
      }
      if (enemy.event.boss && enemy.event.phases.length && enemy.phase + 1 < enemy.event.phases.length) {
        const percent = Math.trunc(enemy.hp * 100 / Math.max(1, enemy.event.hp));
        const nextPhase = enemy.event.phases[enemy.phase + 1];
        if (percent <= nextPhase.threshold) {
          this.clearAllBullets();
          this.stopRuntime(enemy.runtime);
          if (enemy.runtime) enemy.runtime.retired = true;
          enemy.phase += 1;
          this.counters.phaseChanges += 1;
          this.startRuntime(enemy, nextPhase.patternId, expr.normalizeSeed((this.baseSeed + enemy.phase) & 0xffff));
        }
      }
    }
  }

  updateShots() {
    const horizontal = this.stage.orientation === 'horizontal';
    for (const shot of this.shots) {
      if (horizontal) shot.x += 7;
      else shot.y -= 7;
      if (shot.x < -8 || shot.x > 328 || shot.y < -8 || shot.y > 232) shot.dead = true;
      for (const enemy of this.enemies) {
        if (shot.dead || !enemy.active) continue;
        const radius = enemy.event.boss ? 20 : 12;
        if (Math.abs(enemy.x - shot.x) < radius && Math.abs(enemy.y - shot.y) < radius) {
          shot.dead = true;
          enemy.hp = Math.max(0, enemy.hp - 1);
          if (!enemy.hp) this.stopEnemy(enemy);
        }
      }
    }
    this.shots = this.shots.filter((shot) => !shot.dead);
  }

  tickRuntimes() {
    let usedOpcodes = 0;
    let usedSpawns = 0;
    for (const runtime of this.runtimes) {
      const totals = this.runtimeTotals();
      runtime.vm.limit.bullets = runtime.vm.bullets.length + Math.max(0, schema.LIMITS.bullets - totals.bullets);
      runtime.vm.limit.contexts = runtime.vm.contexts.length + Math.max(0, schema.LIMITS.contexts - totals.contexts);
      runtime.vm.limit.opcodes = Math.max(0, schema.LIMITS.opcodesPerFrame - usedOpcodes);
      runtime.vm.limit.spawns = Math.max(0, schema.LIMITS.spawnsPerFrame - usedSpawns);
      runtime.vm.setPlayer(this.player.x, this.player.y);
      runtime.vm.tick();
      usedOpcodes += runtime.vm.metrics.opcodesThisFrame;
      usedSpawns += runtime.vm.spawnedThisFrame;
    }
  }

  applyStageDisplayBudget() {
    const host = makeDisplayBudget(this.player, this.enemies.filter((enemy) => enemy.active), this.shots);
    let globalSprites = host.budget.globalSprites;
    const scanlinePieces = host.budget.scanlinePieces.slice();
    const scanlineDots = host.budget.scanlineDots.slice();
    const removed = [];
    const entries = [];
    for (const runtime of this.runtimes) for (const bullet of runtime.vm.bullets) {
      if (!bullet._stageOrder) bullet._stageOrder = this.nextBulletOrder++;
      entries.push({ runtime, bullet });
    }
    entries.sort((left, right) => left.bullet._stageOrder - right.bullet._stageOrder);
    for (const entry of entries) {
      const width = entry.runtime.vm.program.sprite.width;
      const height = entry.runtime.vm.program.sprite.height;
      const top = clamp(Math.floor(entry.bullet.y / COORD_SCALE - height / 2), 0, 223);
      const bottom = clamp(Math.ceil(entry.bullet.y / COORD_SCALE + height / 2) - 1, 0, 223);
      let fits = globalSprites < GLOBAL_SPRITES;
      for (let line = top; fits && line <= bottom; line += 1) fits = scanlinePieces[line] + 1 <= SCANLINE_PIECES && scanlineDots[line] + width <= SCANLINE_DOTS;
      if (!fits) {
        entry.bullet.alive = false;
        entry.bullet.visible = false;
        entry.runtime.vm.metrics.displayDeletes += 1;
        removed.push(entry.bullet._stageOrder);
        continue;
      }
      globalSprites += 1;
      entry.bullet.visible = true;
      for (let line = top; line <= bottom; line += 1) {
        scanlinePieces[line] += 1;
        scanlineDots[line] += width;
      }
    }
    for (const runtime of this.runtimes) {
      runtime.vm.cleanup();
      runtime.vm.metrics.bullets = runtime.vm.bullets.length;
    }
    this.lastBudget = {
      globalSprites,
      scanlinePieces,
      scanlineDots,
      maxPieces: Math.max(0, ...scanlinePieces),
      maxDots: Math.max(0, ...scanlineDots),
      hostOk: host.ok,
      removed,
    };
  }

  collidePlayer() {
    if (this.invincible > 0) {
      this.invincible -= 1;
      return;
    }
    const bullets = [];
    for (const runtime of this.runtimes) for (const bullet of runtime.vm.bullets) bullets.push({ runtime, bullet });
    bullets.sort((left, right) => left.bullet._stageOrder - right.bullet._stageOrder);
    for (const entry of bullets) {
      const hitbox = entry.runtime.vm.program.hitbox;
      const dx = Math.trunc(entry.bullet.x / COORD_SCALE) + hitbox.x - this.player.x;
      const dy = Math.trunc(entry.bullet.y / COORD_SCALE) + hitbox.y - this.player.y;
      const radius = hitbox.radius + 3;
      if (dx * dx + dy * dy <= radius * radius) {
        if (this.lives > 0) this.lives -= 1;
        this.invincible = this.hitInvincibilityFrames;
        this.counters.hits += 1;
        this.clearAllBullets();
        break;
      }
    }
  }

  collectMetrics() {
    const metrics = {
      bullets: 0, emitters: 0, contexts: 0, opcodesThisFrame: 0, spawnedThisFrame: 0, spawned: 0,
      fireDrops: 0, poolDrops: 0, spawnDrops: 0, contextDrops: 0, opcodeExhaustions: 0, displayDeletes: 0, lastOpcode: 0,
      hits: this.counters?.hits || 0, phaseChanges: this.counters?.phaseChanges || 0, eventDrops: this.counters?.eventDrops || 0,
      globalSprites: this.lastBudget?.globalSprites || 0, maxPieces: this.lastBudget?.maxPieces || 0, maxDots: this.lastBudget?.maxDots || 0,
      hostBudgetOk: this.lastBudget?.hostOk !== false,
    };
    for (const runtime of this.runtimes || []) {
      const value = runtime.vm.getMetrics();
      metrics.bullets += runtime.vm.bullets.length;
      metrics.emitters += runtime.vm.emitters.length;
      metrics.contexts += runtime.vm.contexts.length;
      metrics.opcodesThisFrame += value.opcodesThisFrame;
      metrics.spawnedThisFrame += runtime.vm.spawnedThisFrame;
      metrics.spawned += value.spawned;
      metrics.fireDrops += value.fireDrops;
      metrics.poolDrops += value.poolDrops;
      metrics.spawnDrops += value.spawnDrops;
      metrics.contextDrops += value.contextDrops;
      metrics.opcodeExhaustions += value.opcodeExhaustions;
      metrics.displayDeletes += value.displayDeletes;
      if (value.lastOpcode) metrics.lastOpcode = value.lastOpcode;
    }
    return metrics;
  }

  updateMaxima() {
    const metrics = this.lastMetrics;
    this.maxima.bullets = Math.max(this.maxima.bullets, metrics.bullets);
    this.maxima.emitters = Math.max(this.maxima.emitters, metrics.emitters);
    this.maxima.contexts = Math.max(this.maxima.contexts, metrics.contexts);
    this.maxima.opcodes = Math.max(this.maxima.opcodes, metrics.opcodesThisFrame);
    this.maxima.spawns = Math.max(this.maxima.spawns, metrics.spawnedThisFrame);
    this.maxima.pieces = Math.max(this.maxima.pieces, metrics.maxPieces);
    this.maxima.dots = Math.max(this.maxima.dots, metrics.maxDots);
    this.maxima.globalSprites = Math.max(this.maxima.globalSprites, metrics.globalSprites);
  }

  retireEmptyRuntimes() {
    // Keep empty VMs so cumulative drop metrics remain visible for the whole session.
  }

  step(input = {}, frames = 1) {
    const count = clamp(Math.trunc(Number(frames) || 0), 0, 240);
    if (count === 0) {
      this.applyInput({ player: input.player });
      return this.snapshot();
    }
    for (let index = 0; index < count && this.outcome === 'running'; index += 1) {
      this.applyInput(input);
      this.spawnDueEvents();
      this.updateEnemies();
      this.updateShots();
      this.tickRuntimes();
      this.applyStageDisplayBudget();
      this.collidePlayer();
      this.frame += 1;
      if (!this.lives) this.outcome = 'game-over';
      else if (this.frame >= this.stage.durationFrames) this.outcome = 'clear';
      this.lastMetrics = this.collectMetrics();
      this.updateMaxima();
      this.retireEmptyRuntimes();
    }
    return this.snapshot();
  }

  seek(frame) {
    const target = clamp(Math.trunc(Number(frame) || 0), 0, this.stage.durationFrames);
    this.reset();
    while (this.frame < target && this.outcome === 'running') this.step({}, Math.min(240, target - this.frame));
    return this.snapshot();
  }

  snapshot() {
    const bullets = [];
    for (const runtime of this.runtimes) for (const bullet of runtime.vm.bullets) {
      const hitbox = runtime.vm.program.hitbox;
      bullets.push({
        id: bullet._stageOrder, patternId: runtime.patternId, x: bullet.x / COORD_SCALE, y: bullet.y / COORD_SCALE,
        direction: bullet.direction, speed: bullet.speed / COORD_SCALE, age: bullet.age,
        width: runtime.vm.program.sprite.width, height: runtime.vm.program.sprite.height, hitbox,
      });
    }
    bullets.sort((left, right) => left.id - right.id);
    const enemies = this.enemies.filter((enemy) => enemy.active).map((enemy) => ({
      id: enemy.event.id, sourceIndex: enemy.sourceIndex, enemyType: enemy.event.enemyType, boss: enemy.event.boss,
      x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.event.hp, phase: enemy.phase,
      phaseCount: enemy.event.phases.length, patternId: enemy.runtime?.patternId || enemy.event.patternId,
    }));
    return {
      frame: this.frame, durationFrames: this.stage.durationFrames, orientation: this.stage.orientation,
      difficulty: this.difficulty, rank: this.rank, seed: this.baseSeed, player: { ...this.player },
      lives: this.lives, score: this.score, invincible: this.invincible,
      shots: this.shots.map((shot) => ({ id: shot.id, x: shot.x, y: shot.y })), enemies, bullets,
      metrics: {
        ...this.lastMetrics, maxima: { ...this.maxima },
        scanlinePieces: this.lastBudget.scanlinePieces.slice(), scanlineDots: this.lastBudget.scanlineDots.slice(),
      },
      outcome: this.outcome,
      remainingEvents: this.sortedEvents.length - this.nextEvent,
    };
  }
}

module.exports = {
  StagePreviewSession,
  stagePoint,
  makeDisplayBudget,
};
