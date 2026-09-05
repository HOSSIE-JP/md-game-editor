'use strict';

const schema = require('./bulletml-schema');
const expr = require('./bulletml-expression');
const simulator = require('./bulletml-simulator');
const runtimeCore = require('./stg-runtime-core');

const { BulletmlVm, COORD_SCALE, GLOBAL_SPRITES, SCANLINE_PIECES, SCANLINE_DOTS } = simulator;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function stagePoint(event, age, orientation) {
  return runtimeCore.pathPoint(event.path || [], age, orientation);
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

function makeDisplayBudget(player, enemies, shots, items = [], effects = []) {
  const budget = { globalSprites: 0, scanlinePieces: Array(224).fill(0), scanlineDots: Array(224).fill(0) };
  let ok = reserveHostSprite(budget, player.x, player.y, 16, 16);
  for (const enemy of enemies) {
    const size = enemy.event.boss ? 32 : 16;
    ok = reserveHostSprite(budget, enemy.x, enemy.y, size, size) && ok;
  }
  for (const shot of shots) ok = reserveHostSprite(budget, shot.x, shot.y, 8, 8) && ok;
  for (const item of items) ok = reserveHostSprite(budget, item.x, item.y, 8, 8) && ok;
  for (const effect of effects) if (effect.startFrame == null || effect.startFrame <= effect.frame) ok = reserveHostSprite(budget, effect.x, effect.y, 16, 16) && ok;
  return { budget, ok };
}

class StagePreviewSession {
  constructor(stageInput, compiledPatterns, options = {}) {
    this.stage = schema.normalizeStage(stageInput, stageInput?.orientation);
    this.programs = compiledPatterns instanceof Map ? new Map(compiledPatterns) : new Map(Object.entries(compiledPatterns || {}));
    this.host = options.snapshot || {};
    this.project = this.host.project || { rank: options.rank ?? .5, bomb: {} };
    this.playerDefinition = this.host.player || { initial: { lives: 3, bombs: 3, weaponId: '', speed: 'normal' }, speeds: { slow: 96, normal: 160, fast: 224 }, hitbox: { radius: 3 }, animation: { vertical: { negative: 0, neutral: 1, positive: 2 }, horizontal: { negative: 3, neutral: 4, positive: 5 } } };
    this.pools = this.host.pools || { playerShots: 24, enemies: 12, items: 8, effects: 20, bossParts: 24 };
    this.catalogs = Object.fromEntries(Object.entries(this.host.collections || {}).map(([kind, document]) => [kind, new Map((document?.entries || []).map((entry) => [entry.id, entry]))]));
    this.catalogs.weapons ||= new Map(); this.catalogs.items ||= new Map(); this.catalogs.movements ||= new Map(); this.catalogs.enemies ||= new Map(); this.catalogs.bosses ||= new Map(); this.catalogs.effects ||= new Map(); this.catalogs.explosions ||= new Map(); this.catalogs.backgrounds ||= new Map();
    this.fixedRank = clamp(Number(this.project.rank ?? options.rank ?? .5), 0, 1);
    this.rank = this.fixedRank;
    this.baseSeed = expr.normalizeSeed(options.seed ?? 0xace1);
    this.mode = options.mode === 'caravan' ? 'caravan' : 'campaign';
    this.collisionSampler = typeof options.collisionSampler === 'function' ? options.collisionSampler : null;
    this.timeLimitFrames = this.mode === 'caravan' ? Math.max(1, Number(this.project.caravan?.timeLimitFrames || this.stage.durationFrames)) : 0;
    this.sortedEvents = this.stage.events
      .map((event, sourceIndex) => ({ event, sourceIndex }))
      .sort((left, right) => Number(left.event.order) - Number(right.event.order) || left.sourceIndex - right.sourceIndex);
    const references = new Set();
    for (const event of this.stage.events) {
      const actionType = event.action?.type;
      if (!['spawn_enemy', 'spawn_boss', 'spawn_destructible'].includes(actionType)) continue;
      const catalog = actionType === 'spawn_boss' ? this.catalogs.bosses.get(event.action?.bossId) : this.catalogs.enemies.get(event.action?.enemyId);
      if (event.patternId || catalog?.patternId) references.add(event.patternId || catalog.patternId);
      for (const phase of event.phases?.length ? event.phases : catalog?.phases || []) if (phase.patternId) references.add(phase.patternId);
    }
    for (const patternId of references) if (!this.programs.has(patternId)) throw new Error('Stage pattern ' + patternId + ' がありません');
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.nextEvent = 0;
    this.firedEvents = new Set();
    this.nextBulletOrder = 1;
    this.player = this.stage.orientation === 'horizontal' ? { x: 48, y: 112 } : { x: 160, y: 196 };
    this.lives = Number(this.playerDefinition.initial?.lives || 3);
    this.bombs = Number(this.playerDefinition.initial?.bombs ?? this.project.bomb?.initialStock ?? 3);
    this.weaponId = String(this.playerDefinition.initial?.weaponId || this.catalogs.weapons.keys().next().value || '');
    this.speedMode = ['slow', 'normal', 'fast'].includes(this.playerDefinition.initial?.speed) ? this.playerDefinition.initial.speed : 'normal';
    this.animationRow = Number(this.playerDefinition.animation?.[this.stage.orientation]?.neutral || 0);
    this.score = 0;
    this.invincible = 0;
    this.hitInvincibilityFrames = Math.max(1, Number(this.playerDefinition.hitInvincibilityFrames || 120));
    this.previousInput = { fire: false, bomb: false, speedShift: false };
    this.shots = [];
    this.items = [];
    this.effects = [];
    this.enemies = [];
    this.runtimes = [];
    this.flags = {};
    this.defeatedBosses = new Set();
    this.background = { id: this.stage.backgroundId || '', transition: 'cut', transitionFrame: 0, scroll: 0, speed: Number(this.stage.mainScroll?.speed || 0), tween: null, waves: { BG_A: null, BG_B: null }, waveStartFrames: { BG_A: 0, BG_B: 0 } };
    const initialBackground = this.catalogs.backgrounds.get(this.background.id);
    if (initialBackground) this.background.waves = { BG_A: initialBackground.BG_A?.wave || null, BG_B: initialBackground.BG_B?.wave || null };
    this.outcome = 'running';
    this.counters = { hits: 0, phaseChanges: 0, eventDrops: 0, bombs: 0, items: 0, collisionHits: 0 };
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
    if (!patternId) return null;
    const program = this.programs.get(patternId);
    if (!program) throw new Error('Stage pattern ' + patternId + ' がありません');
    const totals = this.runtimeTotals();
    if (totals.emitters >= schema.LIMITS.emitters) { this.counters.eventDrops += 1; return null; }
    const vm = new BulletmlVm(program?.bytes || program, { seed });
    vm.limit.emitters = 1;
    vm.limit.contexts = Math.max(0, schema.LIMITS.contexts - totals.contexts);
    const phase = enemy.event.phases?.[enemy.phase] || {};
    const effectiveRank = phase.rankOverride == null ? this.fixedRank : clamp(Number(phase.rankOverride), 0, 1);
    vm.setRank(effectiveRank);
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
      rank: effectiveRank,
    };
    this.runtimes.push(runtime);
    enemy.runtime = runtime;
    return runtime;
  }

  spawnEvent(entry, eventOrder) {
    const source = entry.event;
    const actionType = source.action?.type || (source.boss ? 'spawn_boss' : 'spawn_enemy');
    const boss = actionType === 'spawn_boss';
    const definitionId = boss ? source.action?.bossId : source.action?.enemyId;
    const definition = (boss ? this.catalogs.bosses : this.catalogs.enemies).get(definitionId) || {};
    const event = {
      ...source,
      enemyType: definitionId || source.enemyType,
      boss,
      hp: Number(definition.hp || source.hp || (boss ? 120 : 3)),
      score: Number(definition.score ?? source.score ?? (boss ? 10000 : 100)),
      patternId: String(source.patternId || definition.patternId || ''),
      movementId: String(source.movementId || definition.movementId || ''),
      phases: (source.phases?.length ? source.phases : definition.phases || []).map((phase) => ({ ...phase })),
      drop: definition.drop || (source.dropItemId ? { itemId: source.dropItemId } : null),
      explosionId: String(definition.explosionId || ''),
      hitbox: definition.hitbox || { radius: boss ? 20 : 10 },
      parts: (definition.parts || []).map((part) => ({ ...part })),
      giantBackground: Boolean(definition.giantBackground),
    };
    const counts = this.activeCounts();
    if (counts.total >= Number(this.pools.enemies || 12)) {
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
      definition,
      parts: event.parts.map((part) => ({ ...part, hp: part.hp, active: true })),
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

  stopEnemy(enemy, destroyed = true) {
    if (!enemy?.active) return;
    this.stopRuntime(enemy.runtime);
    if (destroyed) {
      if (enemy.event.boss) { this.clearAllBullets(); this.defeatedBosses.add(enemy.event.enemyType); }
      this.score += enemy.event.score;
      this.spawnExplosion(enemy);
      if (enemy.event.drop?.itemId && this.items.length < Number(this.pools.items || 8)) this.items.push({ id: `${enemy.event.id}-${this.frame}`, itemId: enemy.event.drop.itemId, x: enemy.x, y: enemy.y, age: 0 });
    }
    enemy.active = false;
  }

  spawnExplosion(enemy) {
    const explosion = this.catalogs.explosions.get(enemy.event.explosionId);
    for (const placement of explosion?.placements || []) {
      if (this.effects.length >= Number(this.pools.effects || 20)) break;
      const effect = this.catalogs.effects.get(placement.effectId) || {};
      this.effects.push({ id: `${enemy.event.id}-${this.frame}-${this.effects.length}`, effectId: placement.effectId, startFrame: this.frame + Number(placement.frame || 0), x: enemy.x + Number(placement.x || 0), y: enemy.y + Number(placement.y || 0), durationFrames: Number(effect.durationFrames || 30) });
    }
  }

  applyInput(input = {}) {
    this.previousPlayerPosition = { ...this.player };
    if (input.player && Number.isFinite(Number(input.player.x)) && Number.isFinite(Number(input.player.y))) {
      this.player.x = Number(input.player.x);
      this.player.y = Number(input.player.y);
    }
    if (input.speedShift && !this.previousInput.speedShift) this.speedMode = runtimeCore.cycleSpeed(this.speedMode);
    if (input.bomb && !this.previousInput.bomb) this.useBomb();
    const speed = Number(this.playerDefinition.speeds?.[this.speedMode] || 160) / 256;
    if (input.left) this.player.x -= speed;
    if (input.right) this.player.x += speed;
    if (input.up) this.player.y -= speed;
    if (input.down) this.player.y += speed;
    this.player.x = clamp(this.player.x, 8, 312);
    this.player.y = clamp(this.player.y, 16, 216);
    const axis = this.stage.orientation === 'horizontal' ? (input.up ? 'negative' : input.down ? 'positive' : 'neutral') : (input.left ? 'negative' : input.right ? 'positive' : 'neutral');
    this.animationRow = Number(this.playerDefinition.animation?.[this.stage.orientation]?.[axis] || 0);
    const weapon = this.catalogs.weapons.get(this.weaponId);
    if (input.fire && weapon && this.frame % Math.max(1, Number(weapon.intervalFrames || 1)) === 0) this.spawnPlayerShots(weapon);
    this.previousInput = { fire: Boolean(input.fire), bomb: Boolean(input.bomb), speedShift: Boolean(input.speedShift) };
  }

  spawnPlayerShots(weapon) {
    const poolLimit = Math.min(Number(this.pools.playerShots || 24), Number(weapon.simultaneous || 1));
    for (const emitter of weapon.emitters || [{ x: 0, y: -8, angle: 0 }]) {
      if (this.shots.length >= poolLimit) break;
      const velocity = runtimeCore.shotVelocity(this.stage.orientation, Number(weapon.speed || 4), Number(weapon.angle || 0) + Number(emitter.angle || 0));
      this.shots.push({ id: `${this.frame}-${this.shots.length}`, weaponId: weapon.id, x: this.player.x + Number(emitter.x || 0), y: this.player.y + Number(emitter.y || 0), vx: velocity.x, vy: velocity.y, damage: Number(weapon.damage || 1) });
    }
  }

  useBomb() {
    if (this.bombs <= 0) return false;
    this.bombs -= 1;
    this.counters.bombs += 1;
    const bomb = this.project.bomb || {};
    if (bomb.clearEnemyBullets !== false) this.clearAllBullets();
    this.invincible = Math.max(this.invincible, Number(bomb.invincibleFrames || 180));
    for (const enemy of this.enemies) if (enemy.active) {
      enemy.hp = Math.max(0, enemy.hp - Number(bomb.damage || 0));
      if (!enemy.hp) this.stopEnemy(enemy);
    }
    const effect = this.catalogs.effects.get(bomb.effectId);
    if (effect && this.effects.length < Number(this.pools.effects || 20)) this.effects.push({ id: `bomb-${this.frame}`, effectId: effect.id, startFrame: this.frame, x: this.player.x, y: this.player.y, durationFrames: Number(effect.durationFrames || 60) });
    return true;
  }

  triggerReady(event) {
    const trigger = event.trigger || { type: 'frame', frame: event.spawnFrame || 0 };
    if (trigger.type === 'frame') return this.frame >= Number(trigger.frame || 0);
    if (trigger.type === 'scroll') return Math.abs(this.background.scroll) >= Math.abs(Number(trigger.scroll || 0));
    if (trigger.bossId) return this.defeatedBosses.has(trigger.bossId);
    if (trigger.flag) return trigger.operator === 'clear' ? !this.flags[trigger.flag] : Boolean(this.flags[trigger.flag]);
    return false;
  }

  dispatchEvent(entry, eventOrder) {
    const action = entry.event.action || {};
    if (['spawn_enemy', 'spawn_boss', 'spawn_destructible'].includes(action.type)) this.spawnEvent(entry, eventOrder);
    else if (action.type === 'set_scroll') {
      this.background.tween = { startFrame: this.frame, durationFrames: Number(action.durationFrames || 0), from: this.background.speed, to: Number(action.value || 0), interpolation: action.interpolation || 'step' };
      if (!this.background.tween.durationFrames) { this.background.speed = this.background.tween.to; this.background.tween = null; }
    } else if (action.type === 'set_background') {
      this.background.id = action.backgroundId || this.background.id;
      this.background.transition = action.transition || 'cut';
      this.background.transitionFrame = this.frame;
      const background = this.catalogs.backgrounds.get(this.background.id);
      if (background) {
        this.background.waves = { BG_A: background.BG_A?.wave || null, BG_B: background.BG_B?.wave || null };
        this.background.waveStartFrames = { BG_A: this.frame, BG_B: this.frame };
      }
    } else if (action.type === 'set_wave') {
      const plane = action.plane || 'BG_A';
      this.background.waves[plane] = { ...(action.wave || {}) };
      this.background.waveStartFrames[plane] = this.frame;
    }
    else if (action.type === 'set_flag') this.flags[action.flag] = action.value == null ? true : Boolean(action.value);
    else if (action.type === 'clear_bullets') this.clearAllBullets();
    else if (action.type === 'stage_clear') this.outcome = 'clear';
  }

  spawnDueEvents() {
    for (let index = 0; index < this.sortedEvents.length; index += 1) {
      if (this.firedEvents.has(index) || !this.triggerReady(this.sortedEvents[index].event)) continue;
      this.firedEvents.add(index);
      this.dispatchEvent(this.sortedEvents[index], index);
      if (this.outcome !== 'running') break;
    }
    this.nextEvent = this.firedEvents.size;
  }

  updateBackground() {
    const tween = this.background.tween;
    if (tween) {
      const ratio = runtimeCore.interpolationRatio(tween.interpolation, (this.frame - tween.startFrame) / Math.max(1, tween.durationFrames));
      this.background.speed = tween.from + (tween.to - tween.from) * ratio;
      if (this.frame >= tween.startFrame + tween.durationFrames) { this.background.speed = tween.to; this.background.tween = null; }
    }
    this.background.scroll += this.background.speed;
  }

  updateEnemies() {
    for (const enemy of this.enemies) if (enemy.active) {
      const age = Math.max(0, this.frame - enemy.event.spawnFrame);
      const movement = this.catalogs.movements.get(enemy.event.phases?.[enemy.phase]?.movementId || enemy.event.movementId);
      const position = enemy.event.path?.length ? stagePoint(enemy.event, age, this.stage.orientation) : runtimeCore.movementPoint(movement, age) || stagePoint(enemy.event, age, this.stage.orientation);
      enemy.x = position.x;
      enemy.y = position.y;
      if (enemy.runtime && !enemy.runtime.emitterStopped) {
        enemy.runtime.eventAge = age;
        enemy.runtime.vm.updateEmitter(enemy.runtime.emitter, position);
      }
      if (!enemy.event.boss && !enemy.definition?.destructibleBackground && age >= 660) {
        this.stopEnemy(enemy, false);
        continue;
      }
      if (enemy.event.boss && enemy.event.phases.length && enemy.phase + 1 < enemy.event.phases.length) {
        const percent = Math.trunc(enemy.hp * 100 / Math.max(1, enemy.event.hp));
        const nextPhase = enemy.event.phases[enemy.phase + 1];
        if (percent <= nextPhase.threshold) {
          if (nextPhase.clearBullets) this.clearAllBullets();
          this.stopRuntime(enemy.runtime);
          if (enemy.runtime) enemy.runtime.retired = true;
          enemy.phase += 1;
          this.counters.phaseChanges += 1;
          if (nextPhase.backgroundId) {
            this.background.id = nextPhase.backgroundId;
            const phaseBackground = this.catalogs.backgrounds.get(nextPhase.backgroundId);
            if (phaseBackground) this.background.waves = { BG_A: phaseBackground.BG_A?.wave || null, BG_B: phaseBackground.BG_B?.wave || null };
            this.background.waveStartFrames = { BG_A: this.frame, BG_B: this.frame };
          }
          if (nextPhase.wave?.preset && nextPhase.wave.preset !== 'none') { this.background.waves.BG_A = { ...nextPhase.wave }; this.background.waveStartFrames.BG_A = this.frame; }
          this.startRuntime(enemy, nextPhase.patternId, expr.normalizeSeed((this.baseSeed + enemy.phase) & 0xffff));
        }
      }
    }
  }

  updateShots() {
    for (const shot of this.shots) {
      shot.x += Number(shot.vx || 0);
      shot.y += Number(shot.vy || 0);
      if (shot.x < -8 || shot.x > 328 || shot.y < -8 || shot.y > 232) shot.dead = true;
      for (const enemy of this.enemies) {
        if (shot.dead || !enemy.active) continue;
        const parts = enemy.parts.filter((part) => part.active && (!enemy.event.phases?.[enemy.phase]?.activeParts?.length || enemy.event.phases[enemy.phase].activeParts.includes(part.id)));
        const hitPart = parts.find((part) => {
          const radius = Number(part.hitbox?.radius || 0) + 2;
          const dx = enemy.x + Number(part.hitbox?.x || 0) - shot.x; const dy = enemy.y + Number(part.hitbox?.y || 0) - shot.y;
          return dx * dx + dy * dy <= radius * radius;
        });
        const radius = Number(enemy.event.hitbox?.radius || (enemy.event.boss ? 20 : 12)) + 2;
        const dx = enemy.x + Number(enemy.event.hitbox?.x || 0) - shot.x; const dy = enemy.y + Number(enemy.event.hitbox?.y || 0) - shot.y;
        if (hitPart || dx * dx + dy * dy <= radius * radius) {
          shot.dead = true;
          const damage = Number(shot.damage || 1);
          if (hitPart) {
            hitPart.hp = Math.max(0, hitPart.hp - damage);
            enemy.hp = Math.max(0, enemy.hp - Math.round(damage * Number(hitPart.globalHpTransfer ?? 1)));
            if (!hitPart.hp) { hitPart.active = false; this.flags[hitPart.disableEventId] = true; this.spawnExplosion({ event: { id: `${enemy.event.id}-${hitPart.id}`, explosionId: hitPart.explosionId }, x: enemy.x + Number(hitPart.hitbox?.x || 0), y: enemy.y + Number(hitPart.hitbox?.y || 0) }); }
          } else enemy.hp = Math.max(0, enemy.hp - damage);
          if (!enemy.hp) this.stopEnemy(enemy);
        }
      }
    }
    this.shots = this.shots.filter((shot) => !shot.dead);
  }

  updateItemsAndEffects() {
    const horizontal = this.stage.orientation === 'horizontal';
    for (const item of this.items) {
      item.age += 1;
      if (horizontal) item.x -= .75; else item.y += .75;
      if (Math.hypot(item.x - this.player.x, item.y - this.player.y) <= 12) {
        const definition = this.catalogs.items.get(item.itemId);
        const next = runtimeCore.applyItem({ weaponId: this.weaponId, bombs: this.bombs, score: this.score }, definition, this.catalogs.weapons, this.project.bomb || {});
        this.weaponId = next.weaponId; this.bombs = next.bombs; this.score = next.score; item.dead = true; this.counters.items += 1;
      }
      if (item.x < -16 || item.x > 336 || item.y < -16 || item.y > 240) item.dead = true;
    }
    this.items = this.items.filter((item) => !item.dead);
    this.effects = this.effects.filter((effect) => this.frame < effect.startFrame + effect.durationFrames);
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
    const host = makeDisplayBudget(this.player, this.enemies.filter((enemy) => enemy.active), this.shots, this.items, this.effects.map((effect) => ({ ...effect, frame: this.frame })));
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
      const radius = hitbox.radius + Number(this.playerDefinition.hitbox?.radius || 3);
      if (dx * dx + dy * dy <= radius * radius) {
        this.applyPlayerHit();
        break;
      }
    }
  }

  applyPlayerHit() {
    if (this.invincible > 0) return;
    if (this.lives > 0) this.lives -= 1;
    this.invincible = this.hitInvincibilityFrames;
    this.counters.hits += 1;
    this.clearAllBullets();
    const reset = this.project.resetOnHit || {};
    if (reset.weapon === 'initial') this.weaponId = String(this.playerDefinition.initial?.weaponId || this.weaponId);
    if (reset.speed === 'normal') this.speedMode = 'normal';
    else if (reset.speed === 'initial') this.speedMode = this.playerDefinition.initial?.speed || 'normal';
    if (reset.bombs === 'initial') this.bombs = Number(this.playerDefinition.initial?.bombs ?? this.project.bomb?.initialStock ?? this.bombs);
  }

  materialAt(x, y, actor) {
    if (!this.collisionSampler) return null;
    const sampled = this.collisionSampler({ x, y, actor, scroll: this.background.scroll, orientation: this.stage.orientation, frame: this.frame });
    if (!sampled) return null;
    return typeof sampled === 'string' ? this.catalogs['collision-materials']?.get(sampled) || null : sampled;
  }

  collideWorld() {
    const playerMaterial = this.materialAt(this.player.x, this.player.y, 'player');
    if (runtimeCore.materialAffects(playerMaterial, 'player')) {
      if (playerMaterial.solid && this.previousPlayerPosition) this.player = { ...this.previousPlayerPosition };
      if (Number(playerMaterial.damage || 0) > 0) { this.counters.collisionHits += 1; this.applyPlayerHit(); }
    }
    for (const shot of this.shots) if (runtimeCore.materialAffects(this.materialAt(shot.x, shot.y, 'playerShot'), 'playerShot')) shot.dead = true;
    this.shots = this.shots.filter((shot) => !shot.dead);
    for (const runtime of this.runtimes) for (const bullet of runtime.vm.bullets) {
      const x = bullet.x / COORD_SCALE; const y = bullet.y / COORD_SCALE;
      if (runtimeCore.materialAffects(this.materialAt(x, y, 'enemyShot'), 'enemyShot')) bullet.alive = false;
    }
  }

  collectMetrics() {
    const metrics = {
      bullets: 0, emitters: 0, contexts: 0, opcodesThisFrame: 0, spawnedThisFrame: 0, spawned: 0,
      fireDrops: 0, poolDrops: 0, spawnDrops: 0, contextDrops: 0, opcodeExhaustions: 0, displayDeletes: 0, lastOpcode: 0,
      hits: this.counters?.hits || 0, phaseChanges: this.counters?.phaseChanges || 0, eventDrops: this.counters?.eventDrops || 0,
      bombsUsed: this.counters?.bombs || 0, itemsCollected: this.counters?.items || 0, collisionHits: this.counters?.collisionHits || 0,
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
      this.updateBackground();
      this.spawnDueEvents();
      if (this.outcome !== 'running') break;
      this.updateEnemies();
      this.updateShots();
      this.updateItemsAndEffects();
      this.tickRuntimes();
      this.applyStageDisplayBudget();
      this.collideWorld();
      this.collidePlayer();
      this.frame += 1;
      if (!this.lives) this.outcome = 'game-over';
      else if (this.mode === 'caravan' && this.frame >= this.timeLimitFrames) this.outcome = 'time-up';
      else if (this.frame >= this.stage.durationFrames) this.outcome = 'stage-timeout';
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
      parts: enemy.parts.map((part) => ({ id: part.id, hp: part.hp, active: part.active, x: enemy.x + Number(part.hitbox?.x || 0), y: enemy.y + Number(part.hitbox?.y || 0), followBackground: Boolean(part.followBackground) })), giantBackground: enemy.event.giantBackground,
    }));
    const backgroundDefinition = this.catalogs.backgrounds.get(this.background.id) || null;
    const waveOffsets = Object.fromEntries(['BG_A', 'BG_B'].map((plane) => [plane, Array.from({ length: 9 }, (_, index) => {
      const coordinate = Math.round(index * (this.stage.orientation === 'vertical' ? 319 : 223) / 8);
      return runtimeCore.waveOffset(this.background.waves[plane] || backgroundDefinition?.[plane]?.wave, coordinate, this.frame, this.baseSeed, this.background.waveStartFrames[plane] || 0);
    })]));
    return {
      frame: this.frame, durationFrames: this.stage.durationFrames, orientation: this.stage.orientation,
      rank: this.fixedRank, seed: this.baseSeed, player: { ...this.player, animationRow: this.animationRow, speedMode: this.speedMode, weaponId: this.weaponId },
      lives: this.lives, bombs: this.bombs, weaponId: this.weaponId, speedMode: this.speedMode, score: this.score, invincible: this.invincible,
      shots: this.shots.map((shot) => ({ id: shot.id, weaponId: shot.weaponId, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, damage: shot.damage })), enemies, bullets,
      items: this.items.map((item) => ({ ...item })), effects: this.effects.filter((effect) => effect.startFrame <= this.frame).map((effect) => ({ ...effect, age: this.frame - effect.startFrame })),
      background: { ...this.background, tween: this.background.tween ? { ...this.background.tween } : null, definition: backgroundDefinition ? { id: backgroundDefinition.id, BG_A: { bands: backgroundDefinition.BG_A?.bands || [] }, BG_B: { bands: backgroundDefinition.BG_B?.bands || [] } } : null, waveOffsets }, flags: { ...this.flags },
      metrics: {
        ...this.lastMetrics, maxima: { ...this.maxima },
        scanlinePieces: this.lastBudget.scanlinePieces.slice(), scanlineDots: this.lastBudget.scanlineDots.slice(),
      },
      outcome: this.outcome,
      remainingEvents: this.sortedEvents.length - this.firedEvents.size,
    };
  }
}

module.exports = {
  StagePreviewSession,
  stagePoint,
  makeDisplayBudget,
};
