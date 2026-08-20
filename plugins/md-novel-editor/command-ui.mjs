const htmlEscapes = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

export const COMMAND_DEFINITIONS = Object.freeze([
  { type: 'background', label: 'BG', category: '表示', description: '背景画像と切替' },
  { type: 'sprite', label: 'Sprite', category: '表示', description: '立ち絵の表示と非表示' },
  { type: 'spritemove', label: 'Sprite Move', category: '表示', description: '立ち絵を指定フレームで移動' },
  { type: 'message', label: 'Message', category: 'テキスト', description: '話者と本文' },
  { type: 'variable', label: 'Variable', category: '変数', description: '変数の定義と演算' },
  { type: 'choice', label: 'Choice', category: '分岐', description: '選択肢とScene分岐' },
  { type: 'if', label: 'IF', category: '分岐', description: '変数条件でLabel分岐' },
  { type: 'switch', label: 'Switch', category: '分岐', description: '変数値で複数Label分岐' },
  { type: 'label', label: 'Label', category: '分岐', description: 'GOTOの移動先' },
  { type: 'goto', label: 'GOTO', category: '分岐', description: '指定Labelへ移動' },
  { type: 'inputcheck', label: 'Input', category: '分岐', description: '入力待ちとLabel分岐' },
  { type: 'jump', label: 'Jump', category: '分岐', description: '別Sceneへ移動' },
  { type: 'wait', label: 'Wait', category: '制御', description: '指定フレーム待機' },
  { type: 'cache', label: 'Cache', category: '制御', description: '互換cache hint' },
  { type: 'audio', label: 'Audio', category: '音声', description: 'BGMとSFXの再生停止' },
  { type: 'effect', label: 'Effect', category: '演出', description: 'フェード、フラッシュ、揺れ' },
  { type: 'spritetext', label: 'SpriteText', category: '演出', description: '画面上へ短い文字を重ねる' },
  { type: 'comment', label: 'Comment', category: 'メモ', description: 'エディタ専用メモ' },
]);

export const CATEGORY_COLORS = Object.freeze({
  '表示': '#74c8ef',
  'テキスト': '#7de0a7',
  '変数': '#c9a7ef',
  '分岐': '#f2b06e',
  '制御': '#8fa1b7',
  '音声': '#ee9bc5',
  '演出': '#ef9a98',
  'メモ': '#e8cf78',
  '不明': '#66717f',
});

export const INPUT_BUTTONS = Object.freeze([
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'left', label: '←' },
  { key: 'right', label: '→' },
  { key: 'i', label: 'I / B' },
  { key: 'ii', label: 'II / C' },
  { key: 'run', label: 'RUN / START' },
]);

export const CACHE_SCOPES = Object.freeze(['visual', 'bg', 'sprite', 'adpcm', 'psg', 'all']);

export function commandDefinition(type) {
  return COMMAND_DEFINITIONS.find((entry) => entry.type === type)
    || { type: String(type || 'unknown'), label: 'Unknown', category: '不明', description: '未対応Command' };
}

export function isKnownCommand(type) {
  return COMMAND_DEFINITIONS.some((entry) => entry.type === type);
}

export function isCommandSkipped(command = {}) {
  return command.skip === true || command.skipped === true || command.debugSkip === true;
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.max(minimum, Math.min(maximum, number(value, fallback)));
}

function sceneAssets(context = {}) {
  return Array.isArray(context.catalog?.assets) ? context.catalog.assets : [];
}

function assetsByType(context, types) {
  const accepted = new Set(types);
  return sceneAssets(context).filter((asset) => accepted.has(asset.type));
}

function firstAssetId(context, types) {
  return assetsByType(context, types)[0]?.id || '';
}

export function defaultCommand(type, context = {}) {
  switch (type) {
    case 'background':
      return { type, assetId: firstAssetId(context, ['image']), transition: 'fade', fadeOutFrames: 30, fadeInFrames: 30, x: 2, y: 1 };
    case 'sprite':
      return { type, slot: 0, assetId: firstAssetId(context, ['sprite']), x: 128, y: 24, animationId: 'default', flipX: false, flipY: false, visible: true };
    case 'spritemove':
      return { type, slot: 0, x: 128, y: 24, frames: 30, async: false, animationAssetId: '', animationId: '' };
    case 'message':
      return { type, speaker: '', text: 'メッセージを入力してください。', textColor: '', voiceAssetId: '', mouthSlot: null };
    case 'audio':
      return { type, kind: 'psg', action: 'play', assetId: firstAssetId(context, ['psg-song', 'psg-sfx']), channel: 0 };
    case 'cache':
      return { type, action: 'clear', scope: 'visual', assetId: '', slot: 0, x: 0, y: 0 };
    case 'effect':
      return { type, effect: 'shake', frames: 16, intensity: 4, color: '' };
    case 'spritetext':
      return { type, slot: 0, text: 'PRESS RUN BUTTON', x: 64, y: 184, color: '#ffffff', blinkFrames: 30, visible: true };
    case 'variable':
      return { type, variableName: 'flag_1', operation: 'set', value: 0, min: 0, max: 9 };
    case 'choice':
      return { type, variableName: 'choice_1', defaultIndex: 0, choices: [{ label: '進む', value: 0, targetSceneId: '' }] };
    case 'if':
      return { type, variableName: 'flag_1', operator: 'eq', value: 1, targetLabel: '', elseLabel: '' };
    case 'switch':
      return { type, variableName: 'choice_1', cases: [{ value: 0, targetLabel: '' }, { value: 1, targetLabel: '' }], defaultLabel: '' };
    case 'label':
      return { type, name: 'label_1' };
    case 'goto':
      return { type, targetLabel: '' };
    case 'inputcheck':
      return { type, buttons: ['i'], mode: 'sync', targetLabel: '' };
    case 'jump':
      return { type, sceneId: '' };
    case 'wait':
      return { type, frames: 30 };
    case 'comment':
      return { type, text: '' };
    default:
      return { type: String(type || 'comment'), text: '' };
  }
}

function assetLabel(context, assetId) {
  const asset = sceneAssets(context).find((entry) => entry.id === assetId);
  return asset?.name || asset?.id || assetId || 'なし';
}

export function commandSummary(command = {}, context = {}) {
  switch (command.type) {
    case 'background': return `${assetLabel(context, command.assetId)} @ ${number(command.x)},${number(command.y)}`;
    case 'sprite': return `${assetLabel(context, command.assetId)} slot ${number(command.slot)} (${number(command.x)}, ${number(command.y)})`;
    case 'spritemove': return `slot ${number(command.slot)} → (${number(command.x)}, ${number(command.y)}) ${number(command.frames)}f ${command.async ? 'async' : 'sync'}`;
    case 'message': return `${command.speaker ? `${command.speaker}: ` : ''}${command.text || '本文なし'}`;
    case 'audio': return `${command.kind || 'psg'}:${command.action || 'play'}${command.assetId ? ` ${assetLabel(context, command.assetId)}` : ''}${command.kind === 'psg' && command.action !== 'stop' ? ` ch${number(command.channel)}` : ''}`;
    case 'cache': return `${command.action || 'clear'} ${command.scope || 'visual'}${command.assetId ? ` ${assetLabel(context, command.assetId)}` : ''}`;
    case 'effect': return `${command.effect || 'shake'} ${number(command.frames)}f${command.effect === 'shake' ? ` / ${number(command.intensity, 4)}` : ''}`;
    case 'spritetext': return command.visible === false ? `slot ${number(command.slot)} 消去` : `“${command.text || ''}” slot ${number(command.slot)} (${number(command.x)}, ${number(command.y)})`;
    case 'variable': return command.operation === 'random' ? `${command.variableName} = random(${number(command.min)}..${number(command.max)})` : `${command.variableName} ${command.operation || 'set'} ${number(command.value)}`;
    case 'choice': return `${command.variableName ? `${command.variableName} ← ` : ''}${(command.choices || []).map((entry) => entry.label).join(' / ') || '選択肢なし'}`;
    case 'if': return `${command.variableName} ${command.operator || 'eq'} ${number(command.value)} → ${command.targetLabel || '未指定'}`;
    case 'switch': return `${command.variableName || ''} / ${(command.cases || []).length} branches`;
    case 'label': return command.name || 'label未指定';
    case 'goto': return command.targetLabel ? `label ${command.targetLabel}` : 'label未指定';
    case 'inputcheck': return command.mode === 'cancel' ? '入力待ち終了' : `${command.mode || 'sync'} ${(command.buttons || []).join('+')} → ${command.targetLabel || '未指定'}`;
    case 'jump': return command.sceneId ? `scene ${command.sceneId}` : 'scene未指定';
    case 'wait': return `${number(command.frames)} frames`;
    case 'comment': return command.text || '(コメント)';
    default: return `未対応type: ${String(command.type || '(missing)')}`;
  }
}

export function commandSearchText(command, context = {}) {
  const definition = commandDefinition(command?.type);
  const values = [command?.type, definition.label, definition.category, definition.description, commandSummary(command, context)];
  for (const key of ['assetId', 'animationAssetId', 'voiceAssetId']) {
    const id = String(command?.[key] || '');
    if (id) values.push(id, assetLabel(context, id));
  }
  if (command?.type === 'choice') for (const entry of command.choices || []) values.push(entry.label, entry.targetSceneId);
  if (command?.type === 'switch') for (const entry of command.cases || []) values.push(entry.value, entry.targetLabel);
  for (const key of ['speaker', 'text', 'variableName', 'targetLabel', 'elseLabel', 'defaultLabel', 'name', 'sceneId']) values.push(command?.[key]);
  return values.filter((value) => value != null).join(' ').toLowerCase();
}

function option(value, label, current, disabled = false) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(current ?? '') ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</option>`;
}

function assetOptions(context, types, current, emptyLabel = 'なし') {
  const rows = [option('', emptyLabel, current)];
  const assets = assetsByType(context, types);
  for (const asset of assets) {
    const binding = context.bindings?.assets?.[asset.id];
    const status = binding?.status && binding.status !== 'ready' ? ` [${binding.status}]` : '';
    rows.push(option(asset.id, `${asset.name || asset.id}${status}`, current));
  }
  if (current && !assets.some((asset) => asset.id === current)) rows.push(option(current, `${current} [未登録]`, current));
  return rows.join('');
}

function sceneOptions(context, current, emptyLabel = 'なし') {
  const rows = [option('', emptyLabel, current)];
  for (const scene of context.sceneDocument?.scenes || []) rows.push(option(scene.id, scene.name ? `${scene.name} (${scene.id})` : scene.id, current));
  if (current && !(context.sceneDocument?.scenes || []).some((scene) => scene.id === current)) rows.push(option(current, `${current} [未解決]`, current));
  return rows.join('');
}

function labelOptions(context, current, emptyLabel = 'なし') {
  const labels = (context.scene?.commands || []).filter((command) => command.type === 'label').map((command) => String(command.name || '')).filter(Boolean);
  const rows = [option('', emptyLabel, current), ...labels.map((label) => option(label, label, current))];
  if (current && !labels.includes(String(current))) rows.push(option(current, `${current} [未解決]`, current));
  return rows.join('');
}

function animationOptions(context, assetId, current) {
  const asset = sceneAssets(context).find((entry) => entry.id === assetId);
  const animations = Array.isArray(asset?.options?.animations) ? asset.options.animations : [];
  const rows = [option('default', 'default', current || 'default')];
  for (const animation of animations) rows.push(option(animation.id, animation.name || animation.id, current));
  if (current && current !== 'default' && !animations.some((animation) => animation.id === current)) rows.push(option(current, `${current} [未登録]`, current));
  return rows.join('');
}

function colorField(name, label, value, options = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : (options.fallback || '#ffffff');
  return `<label class="mn-field"><span>${escapeHtml(label)}</span><span class="mn-color-row">${options.toggle ? `<label class="mn-check"><input type="checkbox" name="${name}Enabled" ${value ? 'checked' : ''}><span>指定</span></label>` : ''}<input type="color" name="${name}" value="${escapeHtml(color)}" ${options.toggle && !value ? 'disabled' : ''}><input class="mn-input mn-mono" name="${name}Hex" value="${escapeHtml(value || '')}" placeholder="#rrggbb" ${options.toggle && !value ? 'disabled' : ''}></span></label>`;
}

export function renderCommandFields(command, context = {}) {
  const type = command?.type;
  if (!isKnownCommand(type)) {
    return `<div class="mn-unknown-command"><p>このCommand typeは現在のMDエディタでは未対応です。JSONを保持したまま表示しています。</p><textarea data-role="unknown-command-json" class="mn-json-editor" spellcheck="false">${escapeHtml(JSON.stringify(command, null, 2))}</textarea><button type="button" data-action="apply-unknown-command" class="primary">JSONを適用</button></div>`;
  }
  if (type === 'background') return `<div class="mn-form-grid"><label class="mn-field"><span>背景</span><select name="assetId">${assetOptions(context, ['image'], command.assetId)}</select></label></div><div class="mn-form-grid compact"><label class="mn-field"><span>X tile</span><input name="x" type="number" min="0" max="63" value="${number(command.x)}"></label><label class="mn-field"><span>Y tile</span><input name="y" type="number" min="0" max="31" value="${number(command.y)}"></label><label class="mn-field"><span>Fade out</span><select name="fadeOutFrames">${[0, 15, 30, 60].map((value) => option(value, `${value}f`, command.fadeOutFrames)).join('')}</select></label><label class="mn-field"><span>Fade in</span><select name="fadeInFrames">${[0, 15, 30, 60].map((value) => option(value, `${value}f`, command.fadeInFrames)).join('')}</select></label></div>`;
  if (type === 'sprite') return `<div class="mn-form-grid"><label class="mn-field"><span>Sprite</span><select name="assetId">${assetOptions(context, ['sprite'], command.assetId)}</select></label><label class="mn-field"><span>Animation</span><select name="animationId">${animationOptions(context, command.assetId, command.animationId)}</select></label></div><div class="mn-form-grid compact"><label class="mn-field"><span>Slot</span><input name="slot" type="number" min="0" max="3" value="${number(command.slot)}"></label><label class="mn-field"><span>X</span><input name="x" type="number" min="0" max="319" value="${number(command.x)}"></label><label class="mn-field"><span>Y</span><input name="y" type="number" min="0" max="223" value="${number(command.y)}"></label></div><div class="mn-check-row"><label class="mn-check"><input name="flipX" type="checkbox" ${command.flipX ? 'checked' : ''}><span>flip X</span></label><label class="mn-check"><input name="flipY" type="checkbox" ${command.flipY ? 'checked' : ''}><span>flip Y</span></label><label class="mn-check"><input name="visible" type="checkbox" ${command.visible !== false ? 'checked' : ''}><span>visible</span></label></div>`;
  if (type === 'spritemove') return `<div class="mn-form-grid compact"><label class="mn-field"><span>Slot</span><input name="slot" type="number" min="0" max="3" value="${number(command.slot)}"></label><label class="mn-field"><span>Target X</span><input name="x" type="number" min="0" max="319" value="${number(command.x)}"></label><label class="mn-field"><span>Target Y</span><input name="y" type="number" min="0" max="223" value="${number(command.y)}"></label><label class="mn-field"><span>Frames</span><input name="frames" type="number" min="1" max="65535" value="${number(command.frames, 30)}"></label></div><label class="mn-check"><input name="async" type="checkbox" ${command.async ? 'checked' : ''}><span>async（同時移動）</span></label><div class="mn-form-grid"><label class="mn-field"><span>Animation sprite</span><select name="animationAssetId">${assetOptions(context, ['sprite'], command.animationAssetId, 'slotの表示中sprite')}</select></label><label class="mn-field"><span>Animation</span><input name="animationId" value="${escapeHtml(command.animationId || '')}" placeholder="変更なし"></label></div>`;
  if (type === 'message') return `<div class="mn-form-grid"><label class="mn-field"><span>話者</span><input name="speaker" value="${escapeHtml(command.speaker || '')}"></label><label class="mn-field"><span>ADPCM voice <em>MDでは無音</em></span><select name="voiceAssetId">${assetOptions(context, ['adpcm'], command.voiceAssetId)}</select></label></div><label class="mn-field"><span>本文</span><textarea name="text" rows="4" placeholder="空欄でメッセージをクリア">${escapeHtml(command.text || '')}</textarea></label>${colorField('textColor', '文字色', command.textColor, { toggle: true })}<label class="mn-field"><span>Mouth slot <em>voice無音時は本文表示中のみ</em></span><select name="mouthSlot">${option('', 'なし（ナレーション）', command.mouthSlot == null ? '' : command.mouthSlot)}${[0, 1, 2, 3].map((slot) => option(slot, `slot ${slot}`, command.mouthSlot)).join('')}</select></label>`;
  if (type === 'audio') {
    const ignored = command.kind === 'cdda' || command.kind === 'adpcm';
    const types = command.kind === 'adpcm' ? ['adpcm'] : command.kind === 'cdda' ? ['cdda-track'] : ['psg-song', 'psg-sfx'];
    return `<div class="mn-form-grid"><label class="mn-field"><span>Kind</span><select name="kind">${option('psg', 'PSG → XGM2/PCM', command.kind)}${option('cdda', 'CD-DA [MDでは無音]', command.kind)}${option('adpcm', 'ADPCM [MDでは無音]', command.kind)}</select></label><label class="mn-field"><span>Action</span><select name="action">${option('play', 'play', command.action)}${option('stop', 'stop', command.action)}</select></label></div><div class="mn-form-grid"><label class="mn-field"><span>Asset</span><select name="assetId">${assetOptions(context, types, command.assetId)}</select></label>${command.kind === 'psg' && command.action !== 'stop' ? `<label class="mn-field"><span>基準ch</span><input name="channel" type="number" min="0" max="5" value="${number(command.channel)}"></label>` : ''}${command.kind === 'psg' && command.action === 'stop' ? `<label class="mn-field"><span>停止対象</span><select name="target">${option('all', 'all', command.target)}${option('bgm', 'BGM', command.target)}${option('sfx', 'SFX', command.target)}</select></label>` : ''}</div>${ignored ? '<p class="mn-warning-note">互換JSONには保持されますが、MD runtimeでは無音NOPです。</p>' : ''}`;
  }
  if (type === 'variable') return `<div class="mn-form-grid"><label class="mn-field"><span>Variable</span><input class="mn-mono" name="variableName" value="${escapeHtml(command.variableName || '')}" list="mn-reserved-variables"></label><label class="mn-field"><span>Operation</span><select name="operation">${['define', 'set', 'add', 'sub', 'random'].map((entry) => option(entry, entry, command.operation)).join('')}</select></label></div><div class="mn-form-grid compact"><label class="mn-field"><span>Value</span><input name="value" type="number" min="-32768" max="32767" value="${number(command.value)}"></label><label class="mn-field"><span>Random min</span><input name="min" type="number" min="-32768" max="32767" value="${number(command.min)}"></label><label class="mn-field"><span>Random max</span><input name="max" type="number" min="-32768" max="32767" value="${number(command.max)}"></label></div><datalist id="mn-reserved-variables"><option value="AUTO_ENABLE"><option value="MSG_SPEED"></datalist><p class="mn-hint">予約変数: AUTO_ENABLE=0..1、MSG_SPEED=0..6</p>`;
  if (type === 'choice') return `<label class="mn-field"><span>Result variable</span><input class="mn-mono" name="variableName" value="${escapeHtml(command.variableName || '')}"></label><label class="mn-field"><span>Default</span><input name="defaultIndex" type="number" min="0" max="${Math.max(0, (command.choices || []).length - 1)}" value="${number(command.defaultIndex)}"></label><div class="mn-choice-list">${(command.choices || []).map((entry, index) => `<div class="mn-choice-row" data-choice-row><label class="mn-field"><span>Label ${index + 1}</span><input data-choice-field="label" value="${escapeHtml(entry.label || '')}"></label><label class="mn-field"><span>Value</span><input data-choice-field="value" type="number" min="-32768" max="32767" value="${number(entry.value, index)}"></label><label class="mn-field"><span>Target</span><select data-choice-field="targetSceneId">${sceneOptions(context, entry.targetSceneId)}</select></label><button type="button" class="icon danger" data-action="remove-choice" data-index="${index}">×</button></div>`).join('')}</div><button type="button" data-action="add-choice">選択肢追加</button>`;
  if (type === 'if') return `<div class="mn-form-grid"><label class="mn-field"><span>Variable</span><input class="mn-mono" name="variableName" value="${escapeHtml(command.variableName || '')}"></label><label class="mn-field"><span>Operator</span><select name="operator">${[['eq', '=='], ['ne', '!='], ['lt', '<'], ['lte', '<='], ['gt', '>'], ['gte', '>=']].map(([value, label]) => option(value, label, command.operator)).join('')}</select></label></div><div class="mn-form-grid compact"><label class="mn-field"><span>Value</span><input name="value" type="number" min="-32768" max="32767" value="${number(command.value)}"></label><label class="mn-field"><span>True label</span><select name="targetLabel">${labelOptions(context, command.targetLabel)}</select></label><label class="mn-field"><span>False label</span><select name="elseLabel">${labelOptions(context, command.elseLabel, '続行')}</select></label></div>`;
  if (type === 'switch') return `<div class="mn-form-grid"><label class="mn-field"><span>Variable</span><input class="mn-mono" name="variableName" value="${escapeHtml(command.variableName || '')}"></label><label class="mn-field"><span>Default</span><select name="defaultLabel">${labelOptions(context, command.defaultLabel, '続行')}</select></label></div><div class="mn-switch-list">${(command.cases || []).map((entry, index) => `<div class="mn-switch-row" data-switch-row><label class="mn-field"><span>Value ${index + 1}</span><input data-switch-field="value" type="number" min="-32768" max="32767" value="${number(entry.value)}"></label><label class="mn-field"><span>Label</span><select data-switch-field="targetLabel">${labelOptions(context, entry.targetLabel)}</select></label><button type="button" class="icon danger" data-action="remove-switch" data-index="${index}">×</button></div>`).join('')}</div><button type="button" data-action="add-switch">分岐追加</button>`;
  if (type === 'label') return `<label class="mn-field"><span>Label</span><input class="mn-mono" name="name" value="${escapeHtml(command.name || '')}"></label>`;
  if (type === 'goto') return `<label class="mn-field"><span>Label</span><select name="targetLabel">${labelOptions(context, command.targetLabel)}</select></label>`;
  if (type === 'inputcheck') {
    const selected = new Set(command.buttons || []);
    const mode = command.mode || 'sync';
    return `<label class="mn-field"><span>Mode</span><select name="mode">${option('sync', 'sync（同期待機）', mode)}${option('async', 'async（監視開始）', mode)}${option('cancel', 'cancel（監視終了）', mode)}</select></label>${mode === 'cancel' ? '' : `<div class="mn-field"><span>ボタン（OR）</span><div class="mn-input-buttons">${INPUT_BUTTONS.map((button) => `<label class="mn-input-toggle ${selected.has(button.key) ? 'active' : ''}"><input type="checkbox" data-input-button="${button.key}" ${selected.has(button.key) ? 'checked' : ''}><span>${escapeHtml(button.label)}</span></label>`).join('')}</div></div><label class="mn-field"><span>移動先Label</span><select name="targetLabel">${labelOptions(context, command.targetLabel)}</select></label>`}`;
  }
  if (type === 'jump') return `<label class="mn-field"><span>Scene</span><select name="sceneId">${sceneOptions(context, command.sceneId)}</select></label>`;
  if (type === 'wait') return `<label class="mn-field"><span>Frames</span><input name="frames" type="number" min="0" max="65535" value="${number(command.frames)}"></label>`;
  if (type === 'comment') return `<label class="mn-field"><span>コメント</span><textarea name="text" rows="4" placeholder="ビルドとPreviewには含まれません">${escapeHtml(command.text || '')}</textarea></label>`;
  if (type === 'cache') {
    const action = command.action === 'load' ? 'load' : 'clear';
    const scope = CACHE_SCOPES.includes(command.scope) ? command.scope : 'visual';
    const types = scope === 'sprite' ? ['sprite'] : scope === 'adpcm' ? ['adpcm'] : scope === 'psg' ? ['psg-song', 'psg-sfx'] : ['image'];
    return `<div class="mn-form-grid"><label class="mn-field"><span>Action</span><select name="action">${option('clear', 'clear', action)}${option('load', 'load', action)}</select></label><label class="mn-field"><span>Scope</span><select name="scope">${CACHE_SCOPES.map((entry) => option(entry, entry, scope)).join('')}</select></label></div>${action === 'load' ? `<label class="mn-field"><span>Asset</span><select name="assetId">${assetOptions(context, types, command.assetId)}</select></label>${scope === 'sprite' ? `<label class="mn-field"><span>Slot</span><input name="slot" type="number" min="0" max="3" value="${number(command.slot)}"></label>` : ''}${scope === 'bg' || scope === 'visual' ? `<div class="mn-form-grid compact"><label class="mn-field"><span>Tile X</span><input name="x" type="number" min="0" max="63" value="${number(command.x)}"></label><label class="mn-field"><span>Tile Y</span><input name="y" type="number" min="0" max="31" value="${number(command.y)}"></label></div>` : ''}` : ''}<p class="mn-hint">MDでは常駐resourceへの互換hintとして扱います。</p>`;
  }
  if (type === 'effect') return `<div class="mn-form-grid compact"><label class="mn-field"><span>Effect</span><select name="effect">${['fadeOut', 'fadeIn', 'blank', 'shake', 'flash'].map((entry) => option(entry, entry, command.effect)).join('')}</select></label><label class="mn-field"><span>Frames</span><input name="frames" type="number" min="0" max="255" value="${number(command.frames)}"></label><label class="mn-field"><span>Power</span><input name="intensity" type="number" min="1" max="16" value="${number(command.intensity, 4)}"></label></div>${colorField('color', '色', command.color, { fallback: command.effect === 'fadeOut' ? '#000000' : '#ffffff' })}`;
  if (type === 'spritetext') return `<label class="mn-field"><span>文字（最大32glyph）</span><input class="mn-mono" name="text" value="${escapeHtml(command.text || '')}"></label><div class="mn-form-grid compact"><label class="mn-field"><span>Slot</span><input name="slot" type="number" min="0" max="3" value="${number(command.slot)}"></label><label class="mn-field"><span>X</span><input name="x" type="number" min="0" max="319" value="${number(command.x)}"></label><label class="mn-field"><span>Y</span><input name="y" type="number" min="0" max="223" value="${number(command.y)}"></label><label class="mn-field"><span>Blink</span><input name="blinkFrames" type="number" min="0" max="255" value="${number(command.blinkFrames)}"></label></div>${colorField('color', '文字色', command.color)}<label class="mn-check"><input name="visible" type="checkbox" ${command.visible !== false ? 'checked' : ''}><span>visible</span></label>`;
  return '';
}

function formNumber(data, name, fallback = 0) {
  return number(data.get(name), fallback);
}

function formString(data, name, fallback = '') {
  const value = data.get(name);
  return value == null ? fallback : String(value);
}

function normalizedColor(data, name, enabled = true) {
  if (!enabled) return '';
  const hex = formString(data, `${name}Hex`).trim();
  const picker = formString(data, name).trim();
  const candidate = /^#[0-9a-f]{6}$/i.test(hex) ? hex : picker;
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : '';
}

export function commandFromForm(form, current, context = {}) {
  if (!form || !isKnownCommand(current?.type)) return clone(current);
  const data = new FormData(form);
  const next = { ...clone(current), type: current.type };
  switch (current.type) {
    case 'background': Object.assign(next, { assetId: formString(data, 'assetId'), transition: 'fade', x: clamp(formNumber(data, 'x'), 0, 63), y: clamp(formNumber(data, 'y'), 0, 31), fadeOutFrames: clamp(formNumber(data, 'fadeOutFrames', 30), 0, 255), fadeInFrames: clamp(formNumber(data, 'fadeInFrames', 30), 0, 255) }); break;
    case 'sprite': Object.assign(next, { assetId: formString(data, 'assetId'), animationId: formString(data, 'animationId', 'default') || 'default', slot: clamp(formNumber(data, 'slot'), 0, 3), x: clamp(formNumber(data, 'x'), 0, 319), y: clamp(formNumber(data, 'y'), 0, 223), flipX: data.has('flipX'), flipY: data.has('flipY'), visible: data.has('visible') }); break;
    case 'spritemove': Object.assign(next, { slot: clamp(formNumber(data, 'slot'), 0, 3), x: clamp(formNumber(data, 'x'), 0, 319), y: clamp(formNumber(data, 'y'), 0, 223), frames: clamp(formNumber(data, 'frames', 30), 1, 65535), async: data.has('async'), animationAssetId: formString(data, 'animationAssetId'), animationId: formString(data, 'animationId') }); break;
    case 'message': Object.assign(next, { speaker: formString(data, 'speaker').slice(0, 16), text: formString(data, 'text').slice(0, 96), voiceAssetId: formString(data, 'voiceAssetId'), mouthSlot: formString(data, 'mouthSlot') === '' ? null : clamp(formNumber(data, 'mouthSlot'), 0, 3), textColor: normalizedColor(data, 'textColor', data.has('textColorEnabled')) }); break;
    case 'audio': {
      Object.assign(next, { kind: ['psg', 'cdda', 'adpcm'].includes(formString(data, 'kind')) ? formString(data, 'kind') : 'psg', action: formString(data, 'action') === 'stop' ? 'stop' : 'play', assetId: formString(data, 'assetId') });
      if (next.kind === 'psg' && next.action !== 'stop') next.channel = clamp(formNumber(data, 'channel'), 0, 5); else delete next.channel;
      if (next.kind === 'psg' && next.action === 'stop') next.target = ['bgm', 'sfx'].includes(formString(data, 'target')) ? formString(data, 'target') : 'all'; else delete next.target;
      break;
    }
    case 'variable': Object.assign(next, { variableName: formString(data, 'variableName').slice(0, 31), operation: ['define', 'set', 'add', 'sub', 'random'].includes(formString(data, 'operation')) ? formString(data, 'operation') : 'set', value: clamp(formNumber(data, 'value'), -32768, 32767), min: clamp(formNumber(data, 'min'), -32768, 32767), max: clamp(formNumber(data, 'max'), -32768, 32767) }); break;
    case 'choice': {
      next.variableName = formString(data, 'variableName').slice(0, 31);
      next.choices = [...form.querySelectorAll('[data-choice-row]')].slice(0, 4).map((row, index) => ({ label: String(row.querySelector('[data-choice-field="label"]')?.value || '').slice(0, 24), value: clamp(row.querySelector('[data-choice-field="value"]')?.value, -32768, 32767, index), targetSceneId: String(row.querySelector('[data-choice-field="targetSceneId"]')?.value || '') }));
      if (!next.choices.length) next.choices = [{ label: '進む', value: 0, targetSceneId: '' }];
      next.defaultIndex = clamp(formNumber(data, 'defaultIndex'), 0, next.choices.length - 1);
      break;
    }
    case 'if': Object.assign(next, { variableName: formString(data, 'variableName').slice(0, 31), operator: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(formString(data, 'operator')) ? formString(data, 'operator') : 'eq', value: clamp(formNumber(data, 'value'), -32768, 32767), targetLabel: formString(data, 'targetLabel').slice(0, 31), elseLabel: formString(data, 'elseLabel').slice(0, 31) }); break;
    case 'switch': next.variableName = formString(data, 'variableName').slice(0, 31); next.defaultLabel = formString(data, 'defaultLabel').slice(0, 31); next.cases = [...form.querySelectorAll('[data-switch-row]')].slice(0, 16).map((row) => ({ value: clamp(row.querySelector('[data-switch-field="value"]')?.value, -32768, 32767), targetLabel: String(row.querySelector('[data-switch-field="targetLabel"]')?.value || '').slice(0, 31) })); if (!next.cases.length) next.cases = [{ value: 0, targetLabel: '' }]; break;
    case 'label': next.name = formString(data, 'name').slice(0, 31); break;
    case 'goto': next.targetLabel = formString(data, 'targetLabel').slice(0, 31); break;
    case 'inputcheck': next.mode = ['async', 'cancel'].includes(formString(data, 'mode')) ? formString(data, 'mode') : 'sync'; next.buttons = next.mode === 'cancel' ? [] : [...form.querySelectorAll('[data-input-button]:checked')].map((input) => input.dataset.inputButton).filter(Boolean); next.targetLabel = next.mode === 'cancel' ? '' : formString(data, 'targetLabel').slice(0, 31); break;
    case 'jump': next.sceneId = formString(data, 'sceneId'); break;
    case 'wait': next.frames = clamp(formNumber(data, 'frames'), 0, 65535); break;
    case 'comment': next.text = formString(data, 'text').slice(0, 2048); break;
    case 'cache': {
      next.action = formString(data, 'action') === 'load' ? 'load' : 'clear';
      next.scope = CACHE_SCOPES.includes(formString(data, 'scope')) ? formString(data, 'scope') : 'visual';
      if (next.action === 'load') {
        next.assetId = formString(data, 'assetId');
        if (next.scope === 'sprite') next.slot = clamp(formNumber(data, 'slot'), 0, 3); else delete next.slot;
        if (next.scope === 'visual' || next.scope === 'bg') { next.x = clamp(formNumber(data, 'x'), 0, 63); next.y = clamp(formNumber(data, 'y'), 0, 31); } else { delete next.x; delete next.y; }
      } else { delete next.assetId; delete next.slot; delete next.x; delete next.y; }
      break;
    }
    case 'effect': Object.assign(next, { effect: ['fadeOut', 'fadeIn', 'blank', 'shake', 'flash'].includes(formString(data, 'effect')) ? formString(data, 'effect') : 'shake', frames: clamp(formNumber(data, 'frames'), 0, 255), intensity: clamp(formNumber(data, 'intensity', 4), 1, 16), color: normalizedColor(data, 'color') }); break;
    case 'spritetext': Object.assign(next, { text: Array.from(formString(data, 'text')).slice(0, 32).join(''), slot: clamp(formNumber(data, 'slot'), 0, 3), x: clamp(formNumber(data, 'x'), 0, 319), y: clamp(formNumber(data, 'y'), 0, 223), blinkFrames: clamp(formNumber(data, 'blinkFrames'), 0, 255), color: normalizedColor(data, 'color') || '#ffffff', visible: data.has('visible') }); break;
    default: break;
  }
  return next;
}

export function normalizedSceneName(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').split('/').map((part) => part.trim()).filter(Boolean).join('/').slice(0, 96);
}

export function scenePathParts(scene = {}) {
  const name = String(scene.name || '').trim();
  const parts = name ? name.split('/').map((part) => part.trim()).filter(Boolean) : [];
  return parts.length ? parts : [String(scene.id || 'scene')];
}

export function buildSceneRows(scenes = [], collapsedPaths = new Set()) {
  const rows = [];
  let previousDirectories = [];
  for (const scene of scenes) {
    const parts = scenePathParts(scene);
    const directories = String(scene.name || '').trim() && parts.length > 1 ? parts.slice(0, -1) : [];
    let shared = 0;
    while (shared < directories.length && directories[shared] === previousDirectories[shared]) shared += 1;
    let hidden = false;
    for (let index = 0; index < directories.length; index += 1) {
      const path = directories.slice(0, index + 1).join('/');
      if (index >= shared && !hidden) rows.push({ type: 'group', name: directories[index], path, depth: index, collapsed: collapsedPaths.has(path) });
      if (collapsedPaths.has(path)) hidden = true;
    }
    if (!hidden) rows.push({ type: 'scene', scene, depth: directories.length, leaf: parts[parts.length - 1] || scene.id });
    previousDirectories = directories;
  }
  return rows;
}

export function sceneReferences(sceneDocument, targetId) {
  const references = [];
  for (const scene of sceneDocument?.scenes || []) {
    if (scene.nextSceneId === targetId) references.push({ sceneId: scene.id, path: 'nextSceneId' });
    for (let index = 0; index < (scene.commands || []).length; index += 1) {
      const command = scene.commands[index];
      if (command.type === 'jump' && (command.sceneId === targetId || command.targetSceneId === targetId)) references.push({ sceneId: scene.id, commandIndex: index, path: 'jump' });
      if (command.type === 'choice') for (let optionIndex = 0; optionIndex < (command.choices || []).length; optionIndex += 1) if (command.choices[optionIndex]?.targetSceneId === targetId) references.push({ sceneId: scene.id, commandIndex: index, optionIndex, path: 'choice' });
    }
  }
  if (sceneDocument?.startScene === targetId) references.push({ sceneId: targetId, path: 'startScene' });
  return references;
}

export function renameSceneReferences(sceneDocument, previousId, nextId) {
  if (!sceneDocument || !previousId || !nextId || previousId === nextId) return;
  if (sceneDocument.startScene === previousId) sceneDocument.startScene = nextId;
  for (const scene of sceneDocument.scenes || []) {
    if (scene.nextSceneId === previousId) scene.nextSceneId = nextId;
    for (const command of scene.commands || []) {
      if (command.type === 'jump') {
        if (command.sceneId === previousId) command.sceneId = nextId;
        if (command.targetSceneId === previousId) command.targetSceneId = nextId;
      }
      if (command.type === 'choice') for (const choice of command.choices || []) if (choice.targetSceneId === previousId) choice.targetSceneId = nextId;
    }
  }
}
