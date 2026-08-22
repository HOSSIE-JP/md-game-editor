import {
  CATEGORY_COLORS,
  COMMAND_DEFINITIONS,
  buildSceneRows,
  commandDefinition,
  commandSearchText,
  commandSummary,
  escapeHtml,
  isCommandSkipped,
  isKnownCommand,
  renderCommandFields,
} from './command-ui.mjs';
import { diagnosticHtml, formatJson } from './editor-ui.mjs';

export function sceneListHtml(state) {
  const rows = buildSceneRows(state.sceneDocument?.scenes || [], state.collapsedGroups || new Set());
  const budget = state.snapshot?.budget || {};
  return rows.map((row) => {
    if (row.type === 'group') return `<button type="button" class="mn-scene-group" data-action="toggle-scene-group" data-group-path="${escapeHtml(row.path)}" style="--scene-depth:${Math.min(4, row.depth)}"><span>${row.collapsed ? '▸' : '▾'}</span><span>${escapeHtml(row.name)}</span></button>`;
    const scene = row.scene;
    const firstMessage = (scene.commands || []).find((command) => command.type === 'message');
    const sceneBudget = budget.perScene?.[scene.id];
    const level = sceneBudget?.diagnostics?.some((entry) => entry.severity === 'error') ? 'error' : sceneBudget?.diagnostics?.some((entry) => entry.severity === 'warning') ? 'warn' : 'ok';
    const badge = level === 'ok' ? '' : `<span class="mn-mode-badge">${level === 'error' ? '⚠ 超過' : '警告'}</span>`;
    return `<div class="mn-scene-row ${scene.id === state.selectedSceneId ? 'active' : ''}" draggable="true" data-scene-row="${escapeHtml(scene.id)}" style="--scene-depth:${Math.min(4, row.depth)}"><button type="button" class="mn-scene-select" data-action="select-scene" data-scene-id="${escapeHtml(scene.id)}"><span class="mn-drag-handle">::</span><span class="mn-scene-label"><strong>${escapeHtml(row.leaf)}${scene.fullScreenBg ? '<span class="mn-mode-badge">Full BG</span>' : ''}${badge}</strong>${scene.name ? `<small>ID ${escapeHtml(scene.id)}</small>` : ''}<span>${escapeHtml(firstMessage?.text || `${scene.commands?.length || 0} commands`)}</span></span></button><button type="button" class="mn-scene-start ${scene.id === state.sceneDocument.startScene ? 'active' : ''}" data-action="set-start-scene" data-scene-id="${escapeHtml(scene.id)}" title="開始Scene">${scene.id === state.sceneDocument.startScene ? '★' : '☆'}</button><button type="button" class="mn-scene-delete danger" data-action="delete-scene" data-scene-id="${escapeHtml(scene.id)}" ${state.sceneDocument.scenes.length <= 1 ? 'disabled' : ''}>×</button></div>`;
  }).join('') || '<div class="mn-empty">Sceneがありません。</div>';
}

export function commandPaletteHtml(state) {
  const query = String(state.commandSearch || '').trim().toLowerCase();
  const matches = COMMAND_DEFINITIONS.filter((definition) => !query || `${definition.type} ${definition.label} ${definition.category} ${definition.description}`.toLowerCase().includes(query));
  if (!matches.length) return '<div class="mn-empty">該当Commandがありません。</div>';
  const categories = [...new Set(matches.map((definition) => definition.category))];
  return categories.map((category) => `<div class="mn-palette-group"><div class="mn-palette-heading">${escapeHtml(category)}</div>${matches.filter((definition) => definition.category === category).map((definition) => `<button type="button" draggable="true" class="mn-palette-command" data-action="add-command" data-command-type="${definition.type}" style="--command-color:${CATEGORY_COLORS[definition.category]}"><span class="mn-palette-color"></span><span><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(definition.description)}</small></span><span>＋</span></button>`).join('')}</div>`).join('');
}

export function commandListHtml(state, scene, context) {
  const query = String(state.commandListSearch || '').trim().toLowerCase();
  const rows = (scene?.commands || []).map((command, index) => ({ command, index })).filter(({ command }) => !query || commandSearchText(command, context).includes(query));
  if (!rows.length) return '<div class="mn-empty">該当Commandがありません。</div>';
  const pieces = [`<div class="mn-command-dropzone" data-drop-index="${rows[0].index}"></div>`];
  for (const { command, index } of rows) {
    const definition = commandDefinition(command.type);
    const known = isKnownCommand(command.type);
    const skipped = isCommandSkipped(command);
    const color = skipped ? '#4a525e' : CATEGORY_COLORS[definition.category] || CATEGORY_COLORS['不明'];
    pieces.push(`<article class="mn-command-card ${index === state.selectedCommandIndex ? 'active' : ''} ${skipped ? 'skipped' : ''} ${known ? '' : 'unknown'}" draggable="true" data-command-index="${index}" style="--command-color:${color}"><label class="mn-command-skip" title="BuildとPreviewから除外"><input type="checkbox" data-action="toggle-command-skip" data-command-index="${index}" ${skipped ? 'checked' : ''}></label><button type="button" class="mn-command-select" data-action="select-command" data-command-index="${index}"><span class="mn-drag-handle">::</span><span class="mn-command-index">#${index + 1}</span><span class="mn-command-text"><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(commandSummary(command, context))}</small></span></button><div class="mn-command-actions"><button type="button" data-action="paste-before" data-command-index="${index}" title="前に貼付" ${state.commandClipboard ? '' : 'disabled'}>↥</button><button type="button" data-action="paste-after" data-command-index="${index}" title="後に貼付" ${state.commandClipboard ? '' : 'disabled'}>↧</button><button type="button" data-action="copy-command" data-command-index="${index}" title="コピー">⧉</button><button type="button" data-action="delete-command" data-command-index="${index}" title="削除">×</button></div></article><div class="mn-command-dropzone" data-drop-index="${index + 1}"></div>`);
  }
  return pieces.join('');
}

export function commandDetailHtml(command, index, context) {
  if (!command) return '<div class="mn-empty">Commandを選択してください。</div>';
  const definition = commandDefinition(command.type);
  const typeOptions = COMMAND_DEFINITIONS.map((entry) => `<option value="${entry.type}" ${entry.type === command.type ? 'selected' : ''}>${escapeHtml(entry.label)} — ${escapeHtml(entry.category)}</option>`).join('');
  const typeControl = isKnownCommand(command.type) ? `<label class="mn-field"><span>Type</span><select name="type" data-role="command-type">${typeOptions}</select></label>` : '<p class="mn-warning-note">未知typeはJSONだけで編集できます。</p>';
  return `<div class="mn-detail-heading"><span>#${index + 1}</span><strong>${escapeHtml(definition.label)}</strong></div>${typeControl}${renderCommandFields(command, context)}`;
}

export function systemFormHtml(sceneDocument, profile) {
  const settings = sceneDocument?.settings || {};
  const speed = Number(settings.messageSpeedFrames ?? 10);
  const runtime = profile?.runtime || {};
  const rom = profile?.rom || {};
  return `<section class="mn-settings-section"><h2>メッセージ</h2><p>PCE VN互換の全体設定です。</p><div class="mn-settings-grid"><label class="mn-field"><span>メッセージ速度（MSG_SPEED=0）</span><select name="messageSpeedFrames">${[0,10,20,30,40,50].map((value,index) => `<option value="${value}" ${speed === value ? 'selected' : ''}>速度${index + 1}${index === 0 ? '（速い）' : index === 5 ? '（遅い）' : ''}: ${value}</option>`).join('')}</select><small>MSG_SPEED=1..6で速度1..6を直接指定します。</small></label><label class="mn-field"><span>Advance（AUTO_ENABLE初期値）</span><select name="messageAdvanceMode"><option value="button" ${settings.messageAdvanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${settings.messageAdvanceMode === 'auto' ? 'selected' : ''}>auto</option></select><small>SELECT / MD Aで再生中に切替できます。</small></label><label class="mn-field"><span>Auto wait</span><input name="messageAutoWaitFrames" type="number" min="0" max="255" value="${Number(settings.messageAutoWaitFrames ?? 60)}"></label></div></section><section class="mn-settings-section"><h2>Mega Drive target</h2><p>H40、palette、DMA、ROM制約です。</p><div class="mn-settings-grid"><label class="mn-field"><span>座標モード</span><select name="coordinateMode"><option value="pce-legacy-256" ${profile?.coordinateMode !== 'md-h40' ? 'selected' : ''}>PCE legacy 256 → H40</option><option value="md-h40" ${profile?.coordinateMode === 'md-h40' ? 'selected' : ''}>MD H40 native</option></select></label><label class="mn-field"><span>DMA上限 bytes/frame</span><input name="dmaBytesPerFrame" type="number" min="512" max="16384" step="256" value="${Number(runtime.dmaBytesPerFrame ?? 6144)}"></label><label class="mn-field"><span>ROM警告 bytes</span><input name="targetBytes" type="number" value="${Number(rom.targetBytes ?? 3670016)}"></label><label class="mn-field"><span>ROM hard limit bytes</span><input name="hardLimitBytes" type="number" value="${Number(rom.hardLimitBytes ?? 4194304)}"></label></div><p class="mn-hint">各BG / Sprite CommandでPAL0-PAL3を指定できます。PAL0 index 0=黒、index 1=白（message / choice / SpriteText）を予約します。SpriteはH/S安全化のためPAL0-PAL2 index 14、PAL3 index 14/15も予約します。CDDA/ADPCM/voiceは互換JSONに保持し、MDでは無音です。</p></section>`;
}

export function fontSettingsHtml(profile, pceFont, glyphCount) {
  const font = profile?.font || {};
  const active = font.kind === 'project' ? String(font.source || '') : 'bundled';
  const library = Array.isArray(font.library) ? font.library : [];
  const options = [
    `<option value="bundled" ${active === 'bundled' ? 'selected' : ''}>同梱 JF-Dot-Shinonome16.ttf</option>`,
    ...library.map((entry) => `<option value="${escapeHtml(entry.file)}" ${active === entry.file ? 'selected' : ''}>${escapeHtml(entry.label || entry.file)}</option>`),
  ].join('');
  const generation = font.generation || {};
  const generated = generation.inputHash
    ? `${Number(generation.glyphCount || glyphCount)} glyph / ${Number(generation.width || 0)}×${Number(generation.height || 0)}`
    : '未生成';
  return `<h2>フォント</h2>
    <p>既定は JF-Dot-Shinonome16.ttf（サイズ16 / しきい値190）。任意のTTF / OTF / TTCも登録し、ゲームで使う文字だけを16×16 indexed bitmapへ生成します。</p>
    <section class="mn-settings-section">
      <h3>MD runtime font</h3>
      <div class="mn-font-toolbar">
        <button type="button" data-action="font-import">フォント登録</button>
        <button type="button" data-action="font-delete" class="danger" ${active === 'bundled' ? 'disabled' : ''}>選択フォントを削除</button>
      </div>
      <div class="mn-settings-grid mn-font-control-grid">
        <label class="mn-field mn-font-source-field"><span>使用フォント</span><select data-font-field="source">${options}</select><small>OSフォントへの直接参照は行わず、projectへコピーします。</small></label>
        <label class="mn-field"><span>サイズ</span><input data-font-field="fontSize" type="number" min="8" max="32" value="${Number(font.fontSize || 16)}"></label>
        <label class="mn-field"><span>しきい値</span><input data-font-field="threshold" type="number" min="1" max="254" value="${Number(font.threshold || 190)}"></label>
        <label class="mn-field"><span>X offset</span><input data-font-field="xOffset" type="number" min="-8" max="8" value="${Number(font.xOffset || 0)}"></label>
        <label class="mn-field"><span>Y offset</span><input data-font-field="yOffset" type="number" min="-8" max="8" value="${Number(font.yOffset || 0)}"></label>
      </div>
      <label class="mn-field"><span>Preview text</span><textarea data-font-field="previewText" rows="5" maxlength="512">${escapeHtml(font.previewText || '')}</textarea></label>
      <div class="mn-font-generate-row"><button type="button" data-action="font-generate" class="primary">ビットマップフォント生成</button><span data-role="font-generation-status">${escapeHtml(generated)}</span></div>
      <p class="mn-hint">固定cell 16×16 / 使用glyph subset / Shift-JIS。欠落glyphや未生成atlasは保存・ビルドを停止します。</p>
    </section>
    <section class="mn-settings-section"><h3>PCE移植元情報（読取専用）</h3><textarea class="mn-json-editor mn-font-provenance" readonly>${escapeHtml(formatJson(pceFont || {}))}</textarea></section>`;
}

export function assetsHtml(bindings = {}, sceneDocument = {}) {
  const entries = Object.values(bindings.assets || {});
  const visuals = entries.filter((entry) => ['IMAGE', 'SPRITE'].includes(entry.runtimeType));
  const variants = Object.values(bindings.audioVariants || {});
  const usage = new Map();
  const paletteFor = (command, binding) => {
    const explicit = String(command?.palette || '').toUpperCase();
    if (/^PAL[0-3]$/.test(explicit)) return explicit;
    const legacy = String(binding?.legacyPalette || binding?.palette || '').toUpperCase();
    if (/^PAL[0-3]$/.test(legacy)) return legacy;
    return command?.type === 'background' ? 'PAL1' : 'PAL2';
  };
  for (const scene of sceneDocument?.scenes || []) {
    for (const command of scene.commands || []) {
      if (!['background', 'sprite'].includes(command?.type) || !command.assetId || command.skip === true) continue;
      const values = usage.get(command.assetId) || new Set();
      values.add(paletteFor(command, bindings.assets?.[command.assetId]));
      usage.set(command.assetId, values);
    }
  }
  const swatches = (palette) => Array.isArray(palette)
    ? `<span class="mn-palette-swatches">${palette.slice(0, 16).map((color, index) => `<i title="index ${index}: ${escapeHtml((color || []).join(','))}" style="--swatch:rgb(${(color || [0,0,0]).slice(0,3).map((value) => Math.max(0, Math.min(255, Number(value) || 0))).join(',')})"></i>`).join('')}</span>`
    : '<span class="mn-muted">未変換</span>';
  const memberChecks = (members = []) => visuals.map((entry) => `<label><input type="checkbox" data-palette-member value="${escapeHtml(entry.assetId)}" ${members.includes(entry.assetId) ? 'checked' : ''}><span>${escapeHtml(entry.assetId)}</span><small>${escapeHtml((usage.get(entry.assetId) ? [...usage.get(entry.assetId)].join('/') : '未使用'))}</small></label>`).join('');
  const groups = Object.values(bindings.paletteGroups || {}).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const groupCards = groups.map((group) => `<section class="mn-palette-group-card" data-palette-group-form><div class="mn-palette-group-heading"><strong>${escapeHtml(group.id)}</strong><span>${escapeHtml(group.profile || '-')} · ${escapeHtml(String(group.paletteFingerprint || '').slice(0, 10))}</span></div>${swatches(group.paletteRgb333)}<div class="mn-palette-quality">ΔE mean ${Number(group.quality?.meanDeltaE || 0).toFixed(2)} / p95 ${Number(group.quality?.p95DeltaE || 0).toFixed(2)}</div><div class="mn-palette-members">${memberChecks(group.members || [])}</div><button type="button" class="primary" data-action="quantize-palette-group" data-group-id="${escapeHtml(group.id)}">共同減色して保存</button></section>`).join('');
  const createCard = `<section class="mn-palette-group-card" data-palette-group-form><div class="mn-palette-group-heading"><strong>新規palette group</strong><label>Group ID <input data-palette-group-id maxlength="40" value="group_${groups.length + 1}"></label></div><p>同じprofileの画像だけを選択してください。shadow-safe-pal012、shadow-safe-pal3、背景用profileは混在できません。</p><div class="mn-palette-members">${memberChecks([])}</div><button type="button" class="primary" data-action="quantize-palette-group">共同減色して保存</button></section>`;
  const rows = entries.map((entry) => {
    const quality = entry.metadata?.quality || {};
    const poor = Number(quality.meanDeltaE || 0) > 8 || Number(quality.p95DeltaE || 0) > 20;
    const paletteUsage = usage.get(entry.assetId) ? [...usage.get(entry.assetId)].sort().join(', ') : '-';
    const budget = entry.metadata ? `${entry.metadata.uniqueTiles || 0} tiles / ${entry.metadata.maxNumSprite || 0} pieces` : escapeHtml(entry.status || '-');
    return `<tr><td>${escapeHtml(entry.assetId)}</td><td>${escapeHtml(entry.runtimeType)}</td><td><strong>${escapeHtml(paletteUsage)}</strong><small>${escapeHtml(entry.conversion?.paletteProfile || '-')}</small></td><td>${escapeHtml(entry.paletteGroup || '-')}</td><td>${swatches(entry.paletteRgb333)}<small class="${poor ? 'mn-quality-warning' : ''}">ΔE ${Number(quality.meanDeltaE || 0).toFixed(2)} / ${Number(quality.p95DeltaE || 0).toFixed(2)}</small></td><td>${escapeHtml(entry.sourcePath || '(ignored)')}<small>${budget}</small></td></tr>`;
  }).join('');
  const audioRows = variants.map((entry) => `<tr><td>${escapeHtml(entry.key)}</td><td>${escapeHtml(entry.runtimeType)}</td><td>-</td><td>-</td><td>-</td><td>${escapeHtml(entry.sourcePath || '(ignored)')}<small>${entry.metadata?.byteLength || 0} bytes / ${escapeHtml(entry.status || '-')}</small></td></tr>`).join('');
  return `<section class="mn-palette-guide"><strong>物理Palette</strong><span>PAL0背景: index 0 黒 / index 1 白を予約</span><span>Sprite PAL0-PAL2: index 0透明 / index 1白 / index 14 H/S予約</span><span>Sprite PAL3: index 0透明 / index 14,15 H/S予約</span><span>同じPALへ同時表示する画像は、同じordered palette fingerprintが必要です。</span></section><div class="mn-palette-group-grid">${groupCards}${createCard}</div><table><thead><tr><th>assetId</th><th>MD type</th><th>使用PAL / profile</th><th>group</th><th>palette / quality</th><th>resource / budget</th></tr></thead><tbody>${rows}${audioRows}</tbody></table>`;
}
export function diagnosticsHtml(diagnostics) { return diagnosticHtml(diagnostics); }
