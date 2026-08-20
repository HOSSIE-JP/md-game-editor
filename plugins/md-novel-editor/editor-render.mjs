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
  return `<section class="mn-settings-section"><h2>メッセージ</h2><p>PCE VN互換の全体設定です。</p><div class="mn-settings-grid"><label class="mn-field"><span>メッセージ速度（MSG_SPEED=0）</span><select name="messageSpeedFrames">${[0,10,20,30,40,50].map((value,index) => `<option value="${value}" ${speed === value ? 'selected' : ''}>速度${index + 1}${index === 0 ? '（速い）' : index === 5 ? '（遅い）' : ''}: ${value}</option>`).join('')}</select><small>MSG_SPEED=1..6で速度1..6を直接指定します。</small></label><label class="mn-field"><span>Advance（AUTO_ENABLE初期値）</span><select name="messageAdvanceMode"><option value="button" ${settings.messageAdvanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${settings.messageAdvanceMode === 'auto' ? 'selected' : ''}>auto</option></select><small>SELECT / MD Aで再生中に切替できます。</small></label><label class="mn-field"><span>Auto wait</span><input name="messageAutoWaitFrames" type="number" min="0" max="255" value="${Number(settings.messageAutoWaitFrames ?? 60)}"></label></div></section><section class="mn-settings-section"><h2>Mega Drive target</h2><p>H40、palette、DMA、ROM制約です。</p><div class="mn-settings-grid"><label class="mn-field"><span>座標モード</span><select name="coordinateMode"><option value="pce-legacy-256" ${profile?.coordinateMode !== 'md-h40' ? 'selected' : ''}>PCE legacy 256 → H40</option><option value="md-h40" ${profile?.coordinateMode === 'md-h40' ? 'selected' : ''}>MD H40 native</option></select></label><label class="mn-field"><span>DMA上限 bytes/frame</span><input name="dmaBytesPerFrame" type="number" min="512" max="16384" step="256" value="${Number(runtime.dmaBytesPerFrame ?? 6144)}"></label><label class="mn-field"><span>ROM警告 bytes</span><input name="targetBytes" type="number" value="${Number(rom.targetBytes ?? 3670016)}"></label><label class="mn-field"><span>ROM hard limit bytes</span><input name="hardLimitBytes" type="number" value="${Number(rom.hardLimitBytes ?? 4194304)}"></label></div><p class="mn-hint">PAL0=WINDOW/font/BG_A、PAL1=背景、PAL2/PAL3=立ち絵。CDDA/ADPCM/voiceは互換JSONに保持し、MDでは無音です。</p></section>`;
}

export function fontSettingsHtml(profile, pceFont, glyphCount) {
  const font = profile?.font || {};
  return `<h2>フォント</h2><p>MD runtimeは同梱Misaki Gothicを16×16へ拡大し、使用glyphだけをVRAMへ転送します。</p><section class="mn-settings-section"><h3>MD runtime font</h3><dl><dt>Renderer</dt><dd>${escapeHtml(font.renderer || 'misaki-gothic-scaled-16x16')}</dd><dt>Cell</dt><dd>${Number(font.glyphWidth || 16)} × ${Number(font.glyphHeight || 16)}</dd><dt>Source</dt><dd>${escapeHtml(font.source || 'font/misaki_gothic.png')}</dd><dt>使用glyph</dt><dd>${glyphCount}</dd></dl><p class="mn-hint">このversionではfontは固定です。効果のない編集欄は表示しません。</p></section><section class="mn-settings-section"><h3>PCE移植元情報（読取専用）</h3><textarea class="mn-json-editor mn-font-provenance" readonly>${escapeHtml(formatJson(pceFont || {}))}</textarea></section>`;
}

export function assetsHtml(bindings = {}) {
  const entries = Object.values(bindings.assets || {});
  const variants = Object.values(bindings.audioVariants || {});
  return `<table><thead><tr><th>assetId</th><th>MD type</th><th>palette</th><th>resource</th><th>budget/status</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${escapeHtml(entry.assetId)}</td><td>${escapeHtml(entry.runtimeType)}</td><td>${escapeHtml(entry.palette || '-')}</td><td>${escapeHtml(entry.sourcePath || '(ignored)')}</td><td>${entry.metadata ? `${entry.metadata.uniqueTiles || 0} tiles / ${entry.metadata.maxNumSprite || 0} pieces` : escapeHtml(entry.status || '-')}</td></tr>`).join('')}${variants.map((entry) => `<tr><td>${escapeHtml(entry.key)}</td><td>${escapeHtml(entry.runtimeType)}</td><td>-</td><td>${escapeHtml(entry.sourcePath || '(ignored)')}</td><td>${entry.metadata?.byteLength || 0} bytes / ${escapeHtml(entry.status || '-')}</td></tr>`).join('')}</tbody></table>`;
}

export function diagnosticsHtml(diagnostics) { return diagnosticHtml(diagnostics); }
