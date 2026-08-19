import { BOSS_FIRE_PATTERNS, ENEMY_FIRE_PATTERNS } from './preview-core.mjs';

export const COLLECTION_TABS = Object.freeze(['enemies', 'bosses', 'weapons', 'items', 'effects', 'audio']);
export const ENTITY_TABS = Object.freeze(['stages', ...COLLECTION_TABS]);
export const STAGE_COMMANDS = Object.freeze(['spawn_enemy', 'spawn_item', 'start_boss', 'stage_clear', 'set_flag']);
export const ENEMY_BEHAVIORS = Object.freeze(['straight', 'sine', 'zigzag', 'hover', 'dive', 'anchor']);
export const BOSS_MOVEMENTS = Object.freeze(['stationary', 'wave', 'dash', 'orbit', 'anchor', 'hunt', 'spiral']);
export const WEAPON_PATTERNS = Object.freeze(['burst_laser', 'abyss_wave', 'plasma_spread']);

export const SYSTEM_ASSETS = Object.freeze([
  { id: 'title_background', label: 'タイトル背景', group: '画面', path: 'gfx/title_background.png', width: 320, height: 224, editor: 'tilemap-editor' },
  { id: 'title_logo', label: 'タイトルロゴ', group: '画面', path: 'gfx/title_logo.png', width: 256, height: 64, editor: 'sprite-editor' },
  { id: 'hud_icons', label: 'HUDアイコン', group: '画面', path: 'gfx/hud_icons.png', width: 144, height: 8, editor: 'tilemap-editor' },
  { id: 'player', label: 'プレイヤー機', group: '機体・弾', path: 'gfx/player_test.png', width: 24, height: 16, editor: 'sprite-editor' },
  { id: 'player_bullet', label: '自機弾', group: '機体・弾', path: 'gfx/player_bullet_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'enemy_bullet', label: '敵弾', group: '機体・弾', path: 'gfx/enemy_bullet_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'charge', label: 'チャージ弾', group: '機体・弾', path: 'gfx/charge_test.png', width: 16, height: 8, editor: 'sprite-editor' },
  { id: 'core', label: 'ABYSS CORE', group: '機体・弾', path: 'gfx/core_test.png', width: 16, height: 8, editor: 'sprite-editor' },
  { id: 'enemy_fallback', label: '敵フォールバック', group: '敵・ボス', path: 'gfx/enemy_test.png', width: 16, height: 16, editor: 'sprite-editor' },
  { id: 'boss_part', label: 'ボスパーツ', group: '敵・ボス', path: 'gfx/boss_part_test.png', width: 16, height: 16, editor: 'sprite-editor' },
  { id: 'explosion', label: '爆発シート', group: '敵・ボス', path: 'gfx/explosion_test.png', width: 64, height: 16, editor: 'sprite-editor' },
  { id: 'item_red', label: '赤カプセル', group: 'アイテム', path: 'gfx/item_red_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_blue', label: '青カプセル', group: 'アイテム', path: 'gfx/item_blue_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_green', label: '緑カプセル', group: 'アイテム', path: 'gfx/item_green_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_power', label: 'パワー', group: 'アイテム', path: 'gfx/item_power_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_speed', label: 'スピード', group: 'アイテム', path: 'gfx/item_speed_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_core', label: 'コア', group: 'アイテム', path: 'gfx/item_core_test.png', width: 8, height: 8, editor: 'sprite-editor' },
  { id: 'item_bomb', label: 'ボム', group: 'アイテム', path: 'gfx/item_bomb_test.png', width: 8, height: 8, editor: 'sprite-editor' },
]);

export const SYSTEM_ASSET_BY_ID = new Map(SYSTEM_ASSETS.map((asset) => [asset.id, asset]));

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function upsertCollectionEntity(entries, selectedId, next) {
  const result = clone(Array.isArray(entries) ? entries : []);
  const normalizedId = String(selectedId || '');
  const index = result.findIndex((entry) => String(entry?.id || '') === normalizedId);
  if (index >= 0) result[index] = clone(next);
  else result.push(clone(next));
  return result;
}

export function safeId(value, fallback = '') {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return id || fallback;
}

export function safeFileName(value, fallback = 'asset') {
  return safeId(String(value || '').replace(/\.[^.]+$/, ''), fallback).replace(/-/g, '_');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export function optionList(values, selected, labels = {}) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

export function itemAssetId(itemId) {
  return ({
    'red-capsule': 'item_red', 'blue-capsule': 'item_blue', 'green-capsule': 'item_green',
    power: 'item_power', speed: 'item_speed', 'abyss-core': 'item_core', bomb: 'item_bomb',
  })[String(itemId || '')] || 'item_power';
}

export function projectAssets(project = {}) {
  return { ...Object.fromEntries(SYSTEM_ASSETS.map((asset) => [asset.id, asset.path])), ...(project.assets || {}) };
}

export function listLabel(tab) {
  return {
    stages: 'ステージ / 敵配置', sprites: 'システムスプライト', enemies: '敵 / 弾幕', bosses: 'ボス / 弾幕',
    weapons: '武器', items: 'アイテム', effects: 'エフェクト', audio: 'BGM / 音声',
    flow: '画面フロー', project: 'プロジェクト設定', validation: '診断',
  }[tab] || tab;
}

function field(label, name, value, type = 'text', attrs = '') {
  return `<label class="hstg-field"><span>${escapeHtml(label)}</span><input type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${attrs}></label>`;
}

function selectField(label, name, values, selected, labels = {}) {
  return `<label class="hstg-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${optionList(values, selected, labels)}</select></label>`;
}

function relationOptions(entries, selected, empty = 'なし') {
  return `<option value="">${escapeHtml(empty)}</option>${entries.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${escapeHtml(entry.name || entry.id)} (${escapeHtml(entry.id)})</option>`).join('')}`;
}

function assetField(label, name, value, kind, target = {}) {
  const isBackground = kind === 'stage-a' || kind === 'stage-b';
  return `<div class="hstg-asset-field">
    <label class="hstg-field"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" value="${escapeHtml(value || '')}"></label>
    <div class="hstg-inline-actions">
      <button type="button" data-action="import-image" data-image-kind="${escapeHtml(kind)}" data-target-width="${target.width || ''}" data-target-height="${target.height || ''}">画像を選択 / 16色化</button>
      ${isBackground ? `<button type="button" data-action="activate-tile-layer" data-layer="${kind.endsWith('a') ? 'a' : 'b'}">8×8編集</button>` : '<button type="button" data-action="open-page" data-page="sprite-editor">Sprite Editor</button>'}
    </div>
  </div>`;
}

function eventReferenceKey(command) {
  if (command === 'spawn_enemy') return 'enemy_id';
  if (command === 'spawn_item') return 'item_id';
  if (command === 'start_boss') return 'boss_id';
  return '';
}

function eventReferenceOptions(state, event) {
  const selected = event.payload?.[eventReferenceKey(event.command)] || '';
  if (event.command === 'spawn_enemy') return relationOptions(state.snapshot?.enemies || [], selected, '敵を選択');
  if (event.command === 'spawn_item') return relationOptions(state.snapshot?.items || [], selected, 'アイテムを選択');
  if (event.command === 'start_boss') return relationOptions(state.snapshot?.bosses || [], selected, 'ボスを選択');
  return '<option value="">参照なし</option>';
}

function renderStageEvents(state, document) {
  return `<section class="hstg-section hstg-event-editor">
    <div class="hstg-section-title"><strong>敵・アイテム・ボス配置</strong><span>マーカー選択後、中央タイムラインをクリックしてscroll位置を移動</span></div>
    <div class="hstg-event-head"><span>位置</span><span>trigger</span><span>command</span><span>参照</span><span>X</span><span>Y / flag</span><span></span></div>
    <div class="hstg-event-list">${(document.events || []).map((event, index) => `
      <div class="hstg-event-row ${index === state.selectedEventIndex ? 'selected' : ''}" data-event-index="${index}">
        <input type="number" min="0" max="65535" data-event-field="at" value="${escapeHtml(event.trigger?.at || 0)}" aria-label="trigger位置">
        <select data-event-field="trigger">${optionList(['scroll', 'frame', 'condition'], event.trigger?.type || 'scroll')}</select>
        <select data-event-field="command">${optionList(STAGE_COMMANDS, event.command)}</select>
        <select data-event-field="reference">${eventReferenceOptions(state, event)}</select>
        <input type="number" data-event-field="x" value="${escapeHtml(event.payload?.x ?? 336)}" ${['spawn_enemy', 'spawn_item'].includes(event.command) ? '' : 'disabled'} aria-label="X">
        <input type="number" data-event-field="y" value="${escapeHtml(event.command === 'set_flag' ? (event.payload?.flag ?? 0) : (event.payload?.y ?? 112))}" ${['spawn_enemy', 'spawn_item', 'set_flag'].includes(event.command) ? '' : 'disabled'} aria-label="Yまたはflag">
        <div class="hstg-event-actions"><button type="button" data-action="select-event" data-event-index="${index}" title="選択">◎</button><button type="button" data-action="delete-event" data-event-index="${index}" title="削除">×</button></div>
      </div>`).join('')}</div>
    <div class="hstg-inline-actions"><button type="button" data-action="add-event" data-command="spawn_enemy">＋ 敵</button><button type="button" data-action="add-event" data-command="spawn_item">＋ アイテム</button><button type="button" data-action="add-event" data-command="start_boss">＋ ボス</button><button type="button" data-action="sort-events">位置順に整列</button></div>
  </section>`;
}

function renderStageForm(state, document) {
  const widthA = Number(document.length_px || 4096);
  const widthB = 320 + (widthA >> Number(document.parallax_shift_b || 0));
  return `<section class="hstg-form-grid">
      ${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}
      ${field('長さ (px)', 'length_px', document.length_px, 'number', 'min="320" max="65535" step="8"')}${field('scroll (1/256 px/f)', 'scroll_speed_256', document.scroll_speed_256, 'number', 'min="0" max="4096"')}
      ${field('BG_B parallax shift', 'parallax_shift_b', document.parallax_shift_b, 'number', 'min="0" max="7"')}
      <label class="hstg-field"><span>BGM</span><select name="music_id">${relationOptions(state.snapshot?.audio || [], document.music_id, 'BGMなし')}</select></label>
      <label class="hstg-field"><span>中ボス</span><select name="midboss_id">${relationOptions(state.snapshot?.bosses || [], document.midboss_id)}</select></label>
      <label class="hstg-field"><span>最終ボス</span><select name="boss_id">${relationOptions(state.snapshot?.bosses || [], document.boss_id)}</select></label>
    </section>
    <section class="hstg-section"><div class="hstg-section-title"><strong>背景タイルマップ</strong><span>8bit indexed / 16色 / 8×8 / 1:1 pixel</span></div>
      ${assetField(`BG_A 前景 (${widthA}×224)`, 'bg_a', document.assets?.bg_a || '', 'stage-a', { width: widthA, height: 224 })}
      ${assetField(`BG_B 遠景 (${widthB}×224)`, 'bg_b', document.assets?.bg_b || '', 'stage-b', { width: widthB, height: 224 })}
    </section>${renderStageEvents(state, document)}
    <div class="hstg-form-actions"><button type="submit" class="primary">ステージを保存</button><button type="button" data-action="validate">検証</button></div>`;
}

function renderSystemAssetForm(state, document) {
  const meta = SYSTEM_ASSET_BY_ID.get(state.selectedId) || SYSTEM_ASSETS[0];
  const value = projectAssets(document)[meta.id] || meta.path;
  return `<div class="hstg-asset-summary"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.group)} / ${meta.width}×${meta.height}px / 16色indexed PNG</span></div>
    ${assetField('プロジェクト相対パス', 'asset_path', value, `system:${meta.id}`, { width: meta.width, height: meta.height })}
    <p class="hstg-help">このパスが次回SGDK生成のResComp定義へ反映されます。</p>
    <div class="hstg-form-actions"><button type="submit" class="primary">スプライト設定を保存</button><button type="button" data-action="open-page" data-page="${escapeHtml(meta.editor)}">詳細エディターを開く</button></div>`;
}

function renderEnemyForm(document) {
  return `<section class="hstg-form-grid">
      ${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${field('HP', 'hp', document.hp ?? 3, 'number', 'min="1"')}${field('Score', 'score', document.score ?? 100, 'number', 'min="0"')}
      ${field('速度 X (1/256)', 'vx256', document.vx256 ?? -256, 'number')}${field('速度 Y (1/256)', 'vy256', document.vy256 ?? 0, 'number')}
      ${selectField('移動パターン', 'behavior', ENEMY_BEHAVIORS, document.behavior || 'straight')}${selectField('弾幕パターン', 'fire_pattern', ENEMY_FIRE_PATTERNS, document.fire_pattern || 'none')}
      ${field('発射間隔 (frame)', 'fire_interval', document.fire_interval ?? 120, 'number', 'min="0"')}${field('flags', 'flags', document.flags ?? 0, 'number', 'min="0" max="255"')}
    </section>${assetField('敵スプライト (24×16)', 'sprite', document.sprite || '', 'entity-sprite', { width: 24, height: 16 })}
    <p class="hstg-help">中央プレビューは移動と弾幕を同時に再生します。選択値はSGDK runtime enumへ直接生成されます。</p>
    <div class="hstg-form-actions"><button type="submit" class="primary">敵を保存</button><button type="button" data-action="open-page" data-page="sprite-editor">Sprite Editor</button></div>`;
}

function renderBossForm(document) {
  const hp = Array.isArray(document.part_hp) ? document.part_hp : [24, 24, 70];
  return `<section class="hstg-form-grid">
      ${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${field('entry X', 'entry_x', document.entry_x ?? 344, 'number')}${field('active X', 'active_x', document.active_x ?? 264, 'number')}
      ${field('Y', 'y', document.y ?? 112, 'number')}${field('entry速度 X', 'entry_vx256', document.entry_vx256 ?? -256, 'number')}${field('左パーツHP', 'part_hp_0', hp[0] ?? 24, 'number')}${field('右パーツHP', 'part_hp_1', hp[1] ?? 24, 'number')}
      ${field('コアHP', 'part_hp_2', hp[2] ?? 70, 'number')}${field('Score', 'score', document.score ?? ((hp[2] || 70) * 100), 'number')}${selectField('移動パターン', 'movement', BOSS_MOVEMENTS, document.movement || 'stationary')}${selectField('弾幕パターン', 'fire_pattern', BOSS_FIRE_PATTERNS, document.fire_pattern || 'aimed')}
      ${field('発射間隔', 'fire_interval', document.fire_interval ?? 90, 'number')}${field('撃破演出frame', 'death_frames', document.death_frames ?? 120, 'number')}${field('Bomb damage', 'bomb_damage', document.bomb_damage ?? 3, 'number')}${field('形態数', 'forms', document.forms ?? 1, 'number', 'min="1" max="2"')}
    </section>${assetField('ボススプライト (32×32)', 'sprite', document.sprite || '', 'entity-sprite', { width: 32, height: 32 })}
    <p class="hstg-help">fan / wall / spiral / lance / lure / cross / web / coreを可視化し、実機enumへ生成します。</p>
    <div class="hstg-form-actions"><button type="submit" class="primary">ボスを保存</button><button type="button" data-action="open-page" data-page="sprite-editor">Sprite Editor</button></div>`;
}

function renderWeaponForm(document) {
  const levels = Array.isArray(document.levels) ? document.levels : [];
  return `<section class="hstg-form-grid">${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${selectField('色', 'color', ['red', 'blue', 'green'], document.color || document.id)}${selectField('ショットパターン', 'pattern', WEAPON_PATTERNS, document.pattern || 'burst_laser')}</section>
    <section class="hstg-section"><div class="hstg-section-title"><strong>Power level</strong><span>damage / speed / lanes</span></div><div class="hstg-level-head"><span>Lv</span><span>Damage</span><span>Speed</span><span>Lanes</span></div>
      ${[0, 1, 2].map((index) => { const level = levels[index] || {}; return `<div class="hstg-level-row"><strong>${index + 1}</strong><input name="level_${index}_damage" type="number" min="1" value="${escapeHtml(level.damage ?? index + 1)}"><input name="level_${index}_speed" type="number" value="${escapeHtml(level.speed256 ?? 1024)}"><input name="level_${index}_lanes" type="number" min="1" max="9" value="${escapeHtml(level.lanes ?? 1)}"></div>`; }).join('')}
    </section><div class="hstg-form-actions"><button type="submit" class="primary">武器を保存</button></div>`;
}

function renderSimpleForm(state, document) {
  if (state.tab === 'items') {
    const asset = SYSTEM_ASSET_BY_ID.get(itemAssetId(document.id));
    return `<section class="hstg-form-grid">${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${field('重複取得Score', 'duplicate_score', document.duplicate_score ?? 500, 'number')}</section><div class="hstg-asset-summary"><strong>表示スプライト</strong><span>${escapeHtml(asset?.label || 'project.assetsで設定')}</span></div><div class="hstg-form-actions"><button type="submit" class="primary">保存</button><button type="button" data-action="open-system-asset" data-asset-id="${escapeHtml(asset?.id || 'item_power')}">対応スプライト</button></div>`;
  }
  return `<section class="hstg-form-grid">${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${field('フレーム数', 'frames', document.frames ?? 4, 'number')}${field('1frame時間', 'frame_time', document.frame_time ?? 4, 'number')}</section><p class="hstg-help">共通爆発シートはスプライトタブから差し替えます。</p><div class="hstg-form-actions"><button type="submit" class="primary">保存</button><button type="button" data-action="open-system-asset" data-asset-id="explosion">爆発シート</button></div>`;
}

function renderAudioForm(state, document) {
  return `<section class="hstg-form-grid">${field('安定ID', 'id', document.id, 'text', 'readonly')}${field('表示名', 'name', document.name)}${selectField('形式', 'type', ['XGM2', 'WAV', 'DISABLED'], String(document.type || 'XGM2').toUpperCase())}${field('パス', 'path', document.path || '')}<label class="hstg-field hstg-checkbox"><span>Loop</span><input name="loop" type="checkbox" ${document.loop !== false ? 'checked' : ''}></label>${field('WAV rate', 'rate', document.rate ?? 2, 'number', 'min="1" max="4"')}</section>
    <div class="hstg-audio-tools"><button type="button" data-action="import-audio">VGM / XGM / WAVを選択</button><button type="button" data-action="audio-play">▶ プレビュー</button><button type="button" data-action="audio-stop">■ 停止</button><button type="button" data-action="open-page" data-page="md-bgm-composer">BGM作曲エディター</button><span data-role="audio-position">${Number(state.audioTime || 0).toFixed(1)} sec</span></div>
    <p class="hstg-help">VGMはYM2612 + PSG previewを利用します。作曲・MIDI取込・VGM/XGM出力は専用エディターへ引き継げます。</p><div class="hstg-form-actions"><button type="submit" class="primary">音声キューを保存</button></div>`;
}

export function renderFormHtml(state) {
  const document = state.draft;
  if (state.tab === 'validation') {
    const diagnostics = state.validation?.diagnostics || [];
    const inspected = state.validation?.report?.inspected_images || {};
    return `<div class="hstg-diagnostics">${diagnostics.map((entry) => `<article data-severity="${escapeHtml(entry.severity)}"><strong>${escapeHtml(entry.code)}</strong><span>${escapeHtml(entry.path)}</span><p>${escapeHtml(entry.message)}</p></article>`).join('') || '<p>診断結果はありません。</p>'}</div><details><summary>画像タイル診断</summary><pre>${escapeHtml(formatJson(inspected))}</pre></details>`;
  }
  if (!document) return '<div class="hstg-empty">左の一覧から項目を選択してください。</div>';
  if (state.tab === 'stages') return renderStageForm(state, document);
  if (state.tab === 'sprites') return renderSystemAssetForm(state, document);
  if (state.tab === 'enemies') return renderEnemyForm(document);
  if (state.tab === 'bosses') return renderBossForm(document);
  if (state.tab === 'weapons') return renderWeaponForm(document);
  if (state.tab === 'items' || state.tab === 'effects') return renderSimpleForm(state, document);
  if (state.tab === 'audio') return renderAudioForm(state, document);
  if (state.tab === 'project' || state.tab === 'flow') return `<label class="hstg-field hstg-field-grow"><span>${escapeHtml(listLabel(state.tab))} JSON</span><textarea name="document">${escapeHtml(formatJson(document))}</textarea></label><div class="hstg-form-actions"><button type="submit" class="primary">保存</button></div>`;
  return '<div class="hstg-empty">未対応の定義です。</div>';
}

export function buildShell() {
  return `<div class="hstg-layout">
    <header class="hstg-toolbar"><div class="hstg-title"><strong>横スクロールSTG Studio</strong><span data-role="game-title"></span><em>v1.3</em></div><div class="hstg-toolbar-actions"><button type="button" data-action="reload">再読込</button><button type="button" data-action="validate">検証</button><button type="button" data-action="export" class="primary">SGDK生成</button></div></header>
    <nav class="hstg-tabs" aria-label="横STG編集カテゴリ"><button type="button" data-tab="stages" class="active">ステージ / 配置</button><button type="button" data-tab="sprites">スプライト</button><button type="button" data-tab="enemies">敵 / 弾幕</button><button type="button" data-tab="bosses">ボス / 弾幕</button><button type="button" data-tab="weapons">武器</button><button type="button" data-tab="items">アイテム</button><button type="button" data-tab="effects">エフェクト</button><button type="button" data-tab="audio">BGM / 音声</button><button type="button" data-tab="flow">画面フロー</button><button type="button" data-tab="project">設定</button><button type="button" data-tab="validation">診断</button></nav>
    <div class="hstg-workspace"><aside class="hstg-pane hstg-list-pane"><div class="hstg-pane-header"><span data-role="list-title">ステージ</span><button type="button" data-action="add" title="追加">＋</button></div><div class="hstg-list" data-role="list"></div></aside>
      <main class="hstg-pane hstg-preview-pane"><div class="hstg-pane-header hstg-preview-header"><span>実データ 320×224 プレビュー</span><div class="hstg-preview-actions"><button type="button" data-action="preview-rewind">|◀</button><button type="button" data-action="preview-play" data-role="play-button">▶</button><label>表示 <select data-role="preview-zoom"><option value="1">1×</option><option value="2" selected>2×</option></select></label><span data-role="preview-status"></span></div></div>
        <div class="hstg-preview-wrap"><div class="hstg-screen-shell" data-role="screen-shell"><canvas width="320" height="224" data-role="preview"></canvas><span class="hstg-native-badge">native 320×224 / nearest</span></div><div class="hstg-playhead-row"><span data-role="playhead-label">0 px</span><input type="range" min="0" max="1" value="0" step="1" data-role="playhead"></div><div class="hstg-timeline" data-role="timeline"></div>
          <section class="hstg-tile-tools" data-role="tile-tools" hidden><div class="hstg-tile-toolbar"><strong>8×8 背景タイル編集</strong><label>レイヤー <select data-role="tile-layer"><option value="a">BG_A 前景</option><option value="b">BG_B 遠景</option></select></label><button type="button" data-action="tile-stamp" class="active">スタンプ</button><button type="button" data-action="tile-eyedropper">スポイト</button><button type="button" data-action="tile-undo">元に戻す</button><button type="button" data-action="tile-save" class="primary">背景PNG保存</button><button type="button" data-action="open-page" data-page="tilemap-editor">TMXエディター</button><span data-role="tile-status"></span></div><div class="hstg-tile-palette" data-role="tile-palette"></div></section>
          <details class="hstg-json-details"><summary>現在のJSONを確認</summary><pre class="hstg-json-preview" data-role="json-preview"></pre></details></div></main>
      <aside class="hstg-pane hstg-form-pane"><div class="hstg-pane-header"><span data-role="form-title">プロパティ</span><span class="hstg-dirty" data-role="dirty"></span></div><form data-role="form" class="hstg-form"></form></aside></div>
    <footer class="hstg-status" data-role="status">読込待ち</footer></div>`;
}
