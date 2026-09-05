export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function effectiveX(commandType, value, coordinateMode = 'pce-legacy-256') {
  const x = Number(value) || 0;
  if (coordinateMode !== 'pce-legacy-256') return x;
  return commandType === 'background' ? 32 + x * 8 : 32 + x;
}

export function backgroundPosition(command, binding, coordinateMode = 'pce-legacy-256') {
  if (binding?.placementMode === 'md-native-tiles') {
    return { x: (Number(command?.x) || 0) * 8, y: (Number(command?.y) || 0) * 8 };
  }
  return {
    x: effectiveX('background', command?.x, coordinateMode),
    y: coordinateMode === 'pce-legacy-256' ? (Number(command?.y) || 0) * 8 : (Number(command?.y) || 0),
  };
}

export function paginateMessage(text, columns = 19, rows = 4) {
  const widths = Array.from({ length: rows }, (_, index) => index === rows - 1 ? columns - 1 : columns);
  const pages = [];
  let page = [];
  let row = '';
  let rowIndex = 0;
  const commitRow = () => {
    page.push(row);
    row = '';
    rowIndex += 1;
    if (rowIndex >= rows) {
      pages.push(page);
      page = [];
      rowIndex = 0;
    }
  };
  for (const character of Array.from(String(text ?? ''))) {
    if (character === '\r') continue;
    if (character === '\n') {
      commitRow();
      continue;
    }
    if (Array.from(row).length >= widths[rowIndex]) commitRow();
    row += character;
  }
  if (row || page.length || !pages.length) commitRow();
  if (page.length) {
    while (page.length < rows) page.push('');
    pages.push(page);
  }
  return pages.map((entry) => {
    const lines = entry.slice(0, rows);
    while (lines.length < rows) lines.push('');
    return lines;
  });
}

function spriteState(command, previous = null, paletteLoadOrder = 0) {
  if (command.visible === false || !command.assetId) return null;
  return {
    ...(previous || {}),
    assetId: String(command.assetId || previous?.assetId || ''),
    animationId: String(command.animationId || previous?.animationId || 'default'),
    palette: String(command.palette || previous?.palette || ''),
    _paletteLoadOrder: paletteLoadOrder,
    x: Number(command.x) || 0,
    y: Number(command.y) || 0,
    flipX: Boolean(command.flipX),
    flipY: Boolean(command.flipY),
    visible: true,
  };
}

export function simulateScene(scene, commandIndex, options = {}) {
  const state = {
    fullScreenBg: Boolean(scene?.fullScreenBg),
    background: null,
    sprites: [null, null, null, null],
    spriteTexts: [null, null, null, null],
    message: null,
    choice: null,
    variables: {},
  };
  const commands = Array.isArray(scene?.commands) ? scene.commands : [];
  const end = Math.min(commands.length - 1, Math.max(-1, Number(commandIndex)));
  for (let index = 0; index <= end; index += 1) {
    const command = commands[index];
    if (!command || command.skip === true || command.skipped === true || command.debugSkip === true || command.type === 'comment') continue;
    if (command.type === 'background') {
      state.background = { ...clone(command), _paletteLoadOrder: index + 1 };
      state.message = null;
      state.choice = null;
    } else if (command.type === 'sprite') {
      const slot = Math.max(0, Math.min(3, Number(command.slot) || 0));
      state.sprites[slot] = spriteState(command, state.sprites[slot], index + 1);
    } else if (command.type === 'spritemove') {
      const slot = Math.max(0, Math.min(3, Number(command.slot) || 0));
      if (state.sprites[slot]) {
        state.sprites[slot].x = Number(command.x) || 0;
        state.sprites[slot].y = Number(command.y) || 0;
        if (command.animationAssetId) state.sprites[slot].assetId = String(command.animationAssetId);
        if (command.animationId) state.sprites[slot].animationId = String(command.animationId);
      }
    } else if (command.type === 'spritetext') {
      const slot = Math.max(0, Math.min(3, Number(command.slot) || 0));
      state.spriteTexts[slot] = command.visible === false ? null : clone(command);
    } else if (command.type === 'message') {
      state.choice = null;
      state.message = {
        ...clone(command),
        pages: paginateMessage(command.text, options.columns || 19, options.rows || 4),
        pageIndex: 0,
      };
    } else if (command.type === 'choice') {
      state.message = null;
      state.choice = clone(command);
    } else if (command.type === 'variable') {
      const name = String(command.variableName || command.name || command.variable || '');
      if (name) state.variables[name] = Number(command.value) || 0;
    }
  }
  return state;
}

export function commandSummary(command) {
  if (!command) return '';
  if (command.type === 'message') return `${command.speaker ? `${command.speaker}: ` : ''}${String(command.text || '').slice(0, 24)}`;
  if (command.type === 'background' || command.type === 'sprite' || command.type === 'audio') return String(command.assetId || command.action || '');
  if (command.type === 'choice') return `${command.choices?.length || 0} choices`;
  if (command.type === 'jump') return String(command.targetSceneId || '');
  if (command.type === 'label' || command.type === 'goto') return String(command.label || command.name || command.targetLabel || '');
  return '';
}

export const INPUT_MAPPING = Object.freeze({
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', i: 'B', ii: 'C', run: 'START', select: 'A',
});
