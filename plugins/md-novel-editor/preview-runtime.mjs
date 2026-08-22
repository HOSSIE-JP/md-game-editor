import { clone, paginateMessage } from './preview-core.mjs';

const ADVANCE_BUTTONS = new Set(['i', 'ii', 'run', 'right', 'down']);
const CONFIRM_BUTTONS = new Set(['i', 'ii', 'run']);
const VALID_INPUT_BUTTONS = new Set(['up', 'down', 'left', 'right', 'run', 'i', 'ii']);
const MAX_INPUT_WATCHERS = 7;

function isSkipped(command = {}) {
  return command.skip === true || command.skipped === true || command.debugSkip === true;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function signed16(value) {
  return Math.max(-32768, Math.min(32767, integer(value)));
}

function reservedValue(name, value) {
  if (name === 'AUTO_ENABLE') return Math.max(0, Math.min(1, integer(value)));
  if (name === 'MSG_SPEED') return Math.max(0, Math.min(6, integer(value)));
  return signed16(value);
}

function comparison(operator, left, right) {
  if (operator === 'ne') return left !== right;
  if (operator === 'lt') return left < right;
  if (operator === 'lte') return left <= right;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  return left === right;
}

function sceneTable(document) {
  const scenes = Array.isArray(document?.scenes) ? document.scenes : [];
  return new Map(scenes.map((scene, index) => [String(scene.id || `scene_${index}`), scene]));
}

function labelTable(scene) {
  const labels = new Map();
  for (let index = 0; index < (scene?.commands || []).length; index += 1) {
    const command = scene.commands[index];
    if (command?.type !== 'label') continue;
    const name = String(command.name || '');
    if (name && !labels.has(name)) labels.set(name, index);
  }
  return labels;
}

function initialVariables(document) {
  const auto = String(document?.settings?.messageAdvanceMode || '').toLowerCase() === 'auto' ? 1 : 0;
  return { AUTO_ENABLE: auto, MSG_SPEED: 0 };
}

function runtimeSprite(command, previous, paletteLoadOrder) {
  if (command.visible === false || !command.assetId) return null;
  return {
    ...(previous || {}),
    assetId: String(command.assetId || previous?.assetId || ''),
    animationId: String(command.animationId || previous?.animationId || 'default'),
    palette: String(command.palette || previous?.palette || ''),
    _paletteLoadOrder: paletteLoadOrder,
    x: integer(command.x),
    y: integer(command.y),
    flipX: Boolean(command.flipX),
    flipY: Boolean(command.flipY),
    visible: true,
  };
}

function messageGlyphCount(page) {
  return (Array.isArray(page) ? page : []).reduce((total, line) => total + Array.from(String(line || '')).length, 0);
}

function inputButtons(command) {
  return [...new Set((Array.isArray(command?.buttons) ? command.buttons : [])
    .map((button) => String(button || '').toLowerCase())
    .filter((button) => VALID_INPUT_BUTTONS.has(button)))];
}

export function createScriptRuntime(document, options = {}) {
  const source = clone(document) || { settings: {}, scenes: [] };
  const scenes = sceneTable(source);
  const configuredStart = String(options.startSceneId || source.startScene || scenes.keys().next().value || '');
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const runawayLimit = Math.max(100, integer(options.runawayLimit, 100000));
  const columns = Math.max(1, integer(options.columns, 19));
  const rows = Math.max(1, integer(options.rows, 4));
  const events = [];
  const state = {
    sceneId: '', pc: 0, frame: 0, fullScreenBg: false, background: null, backgroundTransition: null, fadeAlpha: 0,
    sprites: [null, null, null, null], moves: [null, null, null, null], spriteTexts: [null, null, null, null],
    message: null, choice: null, choiceIndex: 0, waiting: null, watchers: [],
    variables: initialVariables(source), autoEnabled: false, audio: { bgm: null, sfx: null }, effect: null,
    stopped: false, error: null, fastForward: false, executed: 0, paletteLoadSequence: 0,
  };
  state.autoEnabled = Boolean(state.variables.AUTO_ENABLE);

  function emit(type, detail = {}) {
    events.push({ type, sceneId: state.sceneId, commandIndex: state.pc, ...clone(detail) });
  }

  function currentScene() { return scenes.get(state.sceneId) || null; }

  function setScene(sceneId, reason = 'jump') {
    const requested = String(sceneId || '');
    const fallback = scenes.get(configuredStart) ? configuredStart : scenes.keys().next().value;
    const resolved = scenes.has(requested) ? requested : (requested ? '' : fallback);
    if (!resolved || !scenes.has(resolved)) {
      state.error = `Sceneがありません: ${requested || '(empty)'}`;
      state.stopped = true;
      emit('error', { message: state.error });
      return false;
    }
    state.sceneId = resolved;
    state.pc = 0;
    state.fullScreenBg = Boolean(currentScene()?.fullScreenBg);
    state.message = null;
    state.choice = null;
    state.waiting = null;
    state.watchers = [];
    state.moves = [null, null, null, null];
    state.spriteTexts = [null, null, null, null];
    state.effect = null;
    state.backgroundTransition = null;
    state.fadeAlpha = 0;
    if (state.fullScreenBg) state.sprites = [null, null, null, null];
    emit('scene', { reason });
    return true;
  }

  function gotoLabel(name) {
    const target = labelTable(currentScene()).get(String(name || ''));
    if (target == null) return false;
    state.pc = target;
    return true;
  }

  function variableValue(name) { return signed16(state.variables[String(name || '')] ?? 0); }

  function setVariable(name, value) {
    const key = String(name || '').slice(0, 31);
    if (!key) return;
    state.variables[key] = reservedValue(key, value);
    if (key === 'AUTO_ENABLE') state.autoEnabled = Boolean(state.variables[key]);
    emit('variable', { name: key, value: state.variables[key] });
  }

  function applyVariable(command) {
    const name = String(command.variableName || command.name || command.variable || '');
    if (!name) return;
    const operation = String(command.operation || 'set');
    const previous = variableValue(name);
    if (operation === 'add') setVariable(name, previous + integer(command.value));
    else if (operation === 'sub') setVariable(name, previous - integer(command.value));
    else if (operation === 'random') {
      const minimum = Math.min(integer(command.min), integer(command.max));
      const maximum = Math.max(integer(command.min), integer(command.max));
      const unit = Math.max(0, Math.min(.999999999, Number(random()) || 0));
      setVariable(name, minimum + Math.floor(unit * ((maximum - minimum) + 1)));
    } else setVariable(name, command.value);
  }

  function blockForFrames(kind, frames, detail = {}) {
    const remaining = Math.max(0, integer(frames));
    if (!remaining) return false;
    state.waiting = { kind, frames: remaining, totalFrames: remaining, ...clone(detail) };
    return true;
  }

  function currentMessageSpeed() {
    const override = variableValue('MSG_SPEED');
    if (override >= 1 && override <= 6) return (override - 1) * 10;
    return Math.max(0, integer(source.settings?.messageSpeedFrames, 10));
  }

  function prepareMessagePage(message, pageIndex) {
    const page = message.pages[pageIndex] || [];
    message.pageIndex = pageIndex;
    message.revealedGlyphs = 0;
    message.totalGlyphs = messageGlyphCount(page);
    message.messageTimer = 0;
    message.autoCounter = 0;
    message.complete = message.totalGlyphs === 0 || currentMessageSpeed() === 0;
    if (message.complete) message.revealedGlyphs = message.totalGlyphs;
  }

  function beginMessage(command) {
    const message = { ...clone(command), pages: paginateMessage(command.text, columns, rows), pageIndex: 0 };
    prepareMessagePage(message, 0);
    state.message = message;
    state.choice = null;
    emit('message', { command });
  }

  function startBackground(command) {
    const nextBackground = { ...clone(command), _paletteLoadOrder: ++state.paletteLoadSequence };
    const faded = command.transition === 'fade';
    const fadeOutFrames = faded ? Math.max(0, integer(command.fadeOutFrames)) : 0;
    const fadeInFrames = faded ? Math.max(0, integer(command.fadeInFrames)) : 0;
    state.message = null;
    state.choice = null;
    if (!fadeOutFrames && !fadeInFrames) {
      state.background = nextBackground;
      state.fadeAlpha = 0;
      emit('background', { command });
      return;
    }
    state.backgroundTransition = {
      nextBackground,
      phase: fadeOutFrames ? 'out' : 'in',
      remaining: fadeOutFrames || fadeInFrames,
      total: fadeOutFrames || fadeInFrames,
      fadeInFrames,
    };
    if (!fadeOutFrames) {
      state.background = nextBackground;
      emit('background', { command });
      state.fadeAlpha = 1;
    }
    state.waiting = { kind: 'background' };
  }

  function startMove(command) {
    const slot = Math.max(0, Math.min(3, integer(command.slot)));
    const actor = state.sprites[slot];
    if (actor) {
      if (command.animationAssetId) actor.assetId = String(command.animationAssetId);
      if (command.animationId) actor.animationId = String(command.animationId);
      const frames = Math.max(1, integer(command.frames, 1));
      state.moves[slot] = {
        slot, startX: integer(actor.x), startY: integer(actor.y), targetX: integer(command.x), targetY: integer(command.y),
        frames, elapsed: 0,
      };
    }
    if (!command.async) state.waiting = { kind: 'spritemove', slot };
    emit('spritemove', { slot, command });
  }

  function installWatcher(buttons, targetLabel) {
    const incoming = new Set(buttons);
    const next = [];
    for (const watcher of state.watchers) {
      const remaining = watcher.buttons.filter((button) => !incoming.has(button));
      if (remaining.length) next.push({ ...watcher, buttons: remaining });
    }
    if (next.length < MAX_INPUT_WATCHERS) next.push({ buttons: [...incoming], targetLabel: String(targetLabel || '') });
    state.watchers = next;
  }

  function run() {
    if (state.stopped || state.message || state.choice || state.waiting) return snapshot();
    let executedWithoutYield = 0;
    while (!state.stopped && !state.message && !state.choice && !state.waiting) {
      if (executedWithoutYield >= runawayLimit) {
        state.error = `入力待ちなしで${runawayLimit} Commandを実行したためPreviewを停止しました`;
        state.stopped = true;
        emit('runaway', { message: state.error });
        break;
      }
      const scene = currentScene();
      if (!scene) {
        state.error = `Sceneがありません: ${state.sceneId}`;
        state.stopped = true;
        emit('error', { message: state.error });
        break;
      }
      const commands = Array.isArray(scene.commands) ? scene.commands : [];
      if (state.pc >= commands.length) {
        if (!setScene(String(scene.nextSceneId || configuredStart), 'next')) break;
        executedWithoutYield += 1;
        continue;
      }
      const command = commands[state.pc];
      state.executed += 1;
      executedWithoutYield += 1;
      if (!command || isSkipped(command) || command.type === 'comment') { state.pc += 1; continue; }
      const advancePc = () => { state.pc += 1; };
      switch (command.type) {
        case 'background': advancePc(); startBackground(command); break;
        case 'sprite': {
          const slot = Math.max(0, Math.min(3, integer(command.slot)));
          state.sprites[slot] = runtimeSprite(command, state.sprites[slot], ++state.paletteLoadSequence);
          state.moves[slot] = null;
          emit('sprite', { slot, command }); advancePc(); break;
        }
        case 'spritemove': advancePc(); startMove(command); break;
        case 'spritetext': {
          const slot = Math.max(0, Math.min(3, integer(command.slot)));
          state.spriteTexts[slot] = command.visible === false ? null : { ...clone(command), blinkOn: true, blinkTimer: 0 };
          emit('spritetext', { slot, command }); advancePc(); break;
        }
        case 'message':
          advancePc();
          if (!state.fullScreenBg) beginMessage(command);
          break;
        case 'choice':
          advancePc();
          if (!state.fullScreenBg) {
            state.choice = clone(command);
            state.choiceIndex = Math.max(0, Math.min((command.choices || []).length - 1, integer(command.defaultIndex)));
            state.message = null;
            emit('choice', { command });
          }
          break;
        case 'variable': applyVariable(command); advancePc(); break;
        case 'if': {
          const matches = comparison(String(command.operator || 'eq'), variableValue(command.variableName), signed16(command.value));
          advancePc();
          const label = matches ? command.targetLabel : command.elseLabel;
          if (label) gotoLabel(label);
          break;
        }
        case 'switch': {
          const value = variableValue(command.variableName);
          const branch = (command.cases || []).find((entry) => signed16(entry?.value) === value);
          advancePc();
          const label = branch?.targetLabel || command.defaultLabel;
          if (label) gotoLabel(label);
          break;
        }
        case 'label': advancePc(); break;
        case 'goto': if (!gotoLabel(command.targetLabel)) advancePc(); break;
        case 'inputcheck': {
          const mode = String(command.mode || 'sync').toLowerCase();
          const buttons = inputButtons(command);
          advancePc();
          if (mode === 'cancel') state.watchers = [];
          else if (!buttons.length) emit('input-empty', { mode });
          else if (mode === 'async') installWatcher(buttons, command.targetLabel);
          else state.waiting = { kind: 'input', buttons, targetLabel: String(command.targetLabel || '') };
          break;
        }
        case 'jump': if (!setScene(command.sceneId || command.targetSceneId, 'jump')) state.stopped = true; break;
        case 'wait': advancePc(); blockForFrames('wait', command.frames); break;
        case 'effect': {
          const frames = Math.max(0, integer(command.frames));
          state.effect = { effect: String(command.effect || 'shake'), frames, remaining: frames, intensity: integer(command.intensity, 4), color: String(command.color || '') };
          if (state.effect.effect === 'blank') {
            state.background = null;
            state.sprites = [null, null, null, null];
            state.moves = [null, null, null, null];
            state.spriteTexts = [null, null, null, null];
            state.message = null;
            state.choice = null;
          }
          emit('effect', { command }); advancePc(); blockForFrames('effect', frames); break;
        }
        case 'audio': {
          const event = { command: clone(command), ignored: command.kind === 'cdda' || command.kind === 'adpcm' };
          if (command.kind === 'psg') {
            const assetId = String(command.assetId || '');
            const target = command.target === 'bgm' || command.target === 'sfx' ? command.target : 'all';
            if (command.action === 'stop') {
              if (target === 'all' || target === 'bgm') state.audio.bgm = null;
              if (target === 'all' || target === 'sfx') state.audio.sfx = null;
            } else {
              const kind = options.assetKind?.(assetId) || 'sfx';
              state.audio[kind === 'bgm' ? 'bgm' : 'sfx'] = { assetId, channel: integer(command.channel) };
            }
          }
          emit('audio', event); advancePc(); break;
        }
        case 'cache': emit('cache', { command, noOp: true }); advancePc(); break;
        default: emit('unknown', { command }); advancePc(); break;
      }
    }
    return snapshot();
  }

  function revealMessage() {
    if (!state.message) return;
    state.message.revealedGlyphs = state.message.totalGlyphs;
    state.message.complete = true;
    state.message.autoCounter = 0;
  }

  function advanceMessage() {
    if (!state.message) return snapshot();
    if (!state.message.complete) {
      revealMessage();
      return snapshot();
    }
    if (state.message.pageIndex + 1 < state.message.pages.length) {
      prepareMessagePage(state.message, state.message.pageIndex + 1);
      emit('message-page', { pageIndex: state.message.pageIndex });
      return snapshot();
    }
    state.message = null;
    return run();
  }

  function choose(index) {
    if (!state.choice) return snapshot();
    const choices = Array.isArray(state.choice.choices) ? state.choice.choices : [];
    const selected = choices[Math.max(0, Math.min(choices.length - 1, integer(index, state.choiceIndex)))];
    if (!selected) return snapshot();
    if (state.choice.variableName) setVariable(state.choice.variableName, selected.value);
    state.choice = null;
    if (selected.targetSceneId) setScene(selected.targetSceneId, 'choice');
    return run();
  }

  function cancelBlockingForWatcher() {
    state.message = null;
    state.choice = null;
    state.waiting = null;
    state.moves = [null, null, null, null];
    state.effect = null;
    state.backgroundTransition = null;
    state.fadeAlpha = 0;
  }

  function fireWatcher(button) {
    const watcher = state.watchers.find((entry) => entry.buttons.includes(button));
    if (!watcher) return false;
    state.watchers = [];
    cancelBlockingForWatcher();
    if (watcher.targetLabel) gotoLabel(watcher.targetLabel);
    emit('input', { button, mode: 'async' });
    return true;
  }

  function press(buttonName) {
    const button = String(buttonName || '').toLowerCase();
    if (button === 'select') {
      setVariable('AUTO_ENABLE', state.variables.AUTO_ENABLE ? 0 : 1);
      emit('auto', { enabled: state.autoEnabled });
      return snapshot();
    }
    if (fireWatcher(button)) return run();
    if (state.waiting?.kind === 'input') {
      if (!state.waiting.buttons.includes(button)) return snapshot();
      const targetLabel = state.waiting.targetLabel;
      state.waiting = null;
      if (targetLabel) gotoLabel(targetLabel);
      emit('input', { button, mode: 'sync' });
      return run();
    }
    if (state.choice) {
      const count = Math.max(1, (state.choice.choices || []).length);
      if (button === 'up') state.choiceIndex = (state.choiceIndex + count - 1) % count;
      else if (button === 'down') state.choiceIndex = (state.choiceIndex + 1) % count;
      else if (CONFIRM_BUTTONS.has(button)) return choose(state.choiceIndex);
      return snapshot();
    }
    if (state.message && ADVANCE_BUTTONS.has(button)) return advanceMessage();
    return snapshot();
  }

  function updateMoves() {
    for (let slot = 0; slot < state.moves.length; slot += 1) {
      const move = state.moves[slot];
      const actor = state.sprites[slot];
      if (!move || !actor) { state.moves[slot] = null; continue; }
      move.elapsed += 1;
      const elapsed = Math.min(move.elapsed, move.frames);
      actor.x = move.startX + Math.trunc((move.targetX - move.startX) * elapsed / move.frames);
      actor.y = move.startY + Math.trunc((move.targetY - move.startY) * elapsed / move.frames);
      if (move.elapsed >= move.frames) state.moves[slot] = null;
    }
  }

  function updateSpriteTexts() {
    for (const entry of state.spriteTexts) {
      if (!entry || !entry.blinkFrames) continue;
      entry.blinkTimer += 1;
      if (entry.blinkTimer >= Math.max(1, integer(entry.blinkFrames))) {
        entry.blinkTimer = 0;
        entry.blinkOn = !entry.blinkOn;
      }
    }
  }

  function updateBackgroundTransition() {
    const transition = state.backgroundTransition;
    if (!transition) return false;
    transition.remaining -= 1;
    if (transition.phase === 'out') {
      state.fadeAlpha = 1 - Math.max(0, transition.remaining) / Math.max(1, transition.total);
      if (transition.remaining <= 0) {
        state.background = transition.nextBackground;
        emit('background', { command: transition.nextBackground });
        if (transition.fadeInFrames > 0) {
          transition.phase = 'in';
          transition.remaining = transition.fadeInFrames;
          transition.total = transition.fadeInFrames;
          state.fadeAlpha = 1;
        } else {
          state.backgroundTransition = null;
          state.fadeAlpha = 0;
          return true;
        }
      }
    } else {
      state.fadeAlpha = Math.max(0, transition.remaining) / Math.max(1, transition.total);
      if (transition.remaining <= 0) {
        state.backgroundTransition = null;
        state.fadeAlpha = 0;
        return true;
      }
    }
    return false;
  }

  function updateMessageFrame() {
    const message = state.message;
    if (!message) return false;
    if (!message.complete) {
      const speed = currentMessageSpeed();
      if (speed === 0) revealMessage();
      else {
        message.messageTimer += 1;
        if (message.messageTimer >= speed) {
          message.messageTimer = 0;
          message.revealedGlyphs = Math.min(message.totalGlyphs, message.revealedGlyphs + 1);
          if (message.revealedGlyphs >= message.totalGlyphs) revealMessage();
        }
      }
      return false;
    }
    if (!state.autoEnabled) return false;
    message.autoCounter += 1;
    if (message.autoCounter < Math.max(0, integer(source.settings?.messageAutoWaitFrames, 60))) return false;
    advanceMessage();
    return true;
  }

  function elapseFrames(frames = 1) {
    const count = Math.max(1, integer(frames, 1));
    for (let index = 0; index < count; index += 1) {
      state.frame += 1;
      updateMoves();
      updateSpriteTexts();
      let completedBlock = false;
      if (state.waiting?.kind === 'background') completedBlock = updateBackgroundTransition();
      else if (state.waiting?.kind === 'spritemove') completedBlock = !state.moves[state.waiting.slot];
      else if (state.waiting && state.waiting.kind !== 'input') {
        state.waiting.frames -= 1;
        if (state.effect) state.effect.remaining = Math.max(0, state.waiting.frames);
        completedBlock = state.waiting.frames <= 0;
      }
      if (completedBlock) {
        const kind = state.waiting?.kind;
        state.waiting = null;
        if (kind === 'effect') state.effect = null;
        run();
        continue;
      }
      updateMessageFrame();
    }
    return snapshot();
  }

  function snapshot() { return clone(state); }
  function consumeEvents() { return events.splice(0, events.length); }

  function restart(sceneId = configuredStart) {
    const variables = initialVariables(source);
    Object.assign(state, {
      sceneId: '', pc: 0, frame: 0, fullScreenBg: false, background: null, backgroundTransition: null, fadeAlpha: 0,
      sprites: [null, null, null, null], moves: [null, null, null, null], spriteTexts: [null, null, null, null],
      message: null, choice: null, choiceIndex: 0, waiting: null, watchers: [],
      variables, autoEnabled: Boolean(variables.AUTO_ENABLE), audio: { bgm: null, sfx: null }, effect: null,
      stopped: false, error: null, executed: 0, paletteLoadSequence: 0,
    });
    events.length = 0;
    setScene(sceneId, 'restart');
    return run();
  }

  function setFastForward(enabled) { state.fastForward = Boolean(enabled); return snapshot(); }

  return { run, press, choose, advanceMessage, elapseFrames, restart, setFastForward, snapshot, consumeEvents, currentScene };
}
