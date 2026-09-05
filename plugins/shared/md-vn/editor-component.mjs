import { simulateScene } from './preview.mjs';
import {
  applyStructuredArrayAction, applyStructuredField, decodeStructuredPath,
  renderStructuredForm, setStructuredValue,
} from '../structured-form.mjs';

const BINDING_GROUPS = Object.freeze([
  ['opening', 'オープニング'],
  ['endingRescue', '救済エンディング'],
  ['endingDestroy', '破壊エンディング'],
]);

const VN_COMMAND_TEMPLATES = Object.freeze({
  background: { type: 'background', assetId: '', transition: 'cut', fadeOutFrames: 0, fadeInFrames: 0, x: 0, y: 0, palette: 'PAL0' },
  sprite: { type: 'sprite', slot: 0, assetId: '', x: 0, y: 0, animationId: '', flipX: false, flipY: false, visible: true, palette: 'PAL2' },
  audio: { type: 'audio', kind: 'bgm', action: 'play', assetId: '', channel: 0, target: '' },
  message: { type: 'message', speaker: '', text: '', textColor: 0, voiceAssetId: '', mouthSlot: -1 },
  wait: { type: 'wait', frames: 60 },
  spritemove: { type: 'spritemove', slot: 0, x: 0, y: 0, frames: 30 },
  variable: { type: 'variable', variableName: '', operation: 'set', value: 0, min: 0, max: 1 },
  choice: { type: 'choice', variableName: '', defaultIndex: 0, choices: [{ label: '選択肢1', value: 0, targetSceneId: '' }] },
});

const VN_FIELD_META = Object.freeze({
  type: ['命令の種類', 'この行で実行する演出・文章・待機・分岐の種類です。'],
  assetId: ['アセットID', 'MD Novelの登録済み画像・スプライト・BGM・効果音を指定します。'],
  transition: ['切替方法', '即時切替、または暗転を挟むフェード切替を指定します。'],
  fadeOutFrames: ['暗転時間', '現在の画像を暗転させるフレーム数です。'],
  fadeInFrames: ['復帰時間', '新しい画像を表示へ戻すフレーム数です。'],
  x: ['X位置', '画面左端を基準にした横位置です。'],
  y: ['Y位置', '画面上端を基準にした縦位置です。'],
  palette: ['パレット', '画像・スプライトで使用するPAL0〜PAL3です。'],
  slot: ['スプライト表示枠', '表示・移動・非表示の対象を識別するスプライト番号です。'],
  animationId: ['アニメーション', 'スプライトエディターで登録したアニメーション識別子です。'],
  flipX: ['左右反転', 'スプライトを左右反転して表示します。'],
  flipY: ['上下反転', 'スプライトを上下反転して表示します。'],
  visible: ['表示する', '無効にすると指定した表示枠のスプライトを非表示にします。'],
  kind: ['音声種類', 'BGMまたはSEのどちらを操作するか指定します。'],
  action: ['音声操作', '再生・停止・フェード停止などの操作です。'],
  channel: ['再生チャンネル', '同時再生時に使用する音声チャンネル番号です。'],
  target: ['停止対象', '停止・フェード対象となるBGM／効果音の識別子です。'],
  speaker: ['話者名', 'メッセージ欄へ表示する話者名です。'],
  text: ['本文', '一文字ずつ表示する短い文章です。'],
  textColor: ['文字色', 'メッセージ本文に使用するパレット内の色番号です。'],
  voiceAssetId: ['音声・文字送りSE', '台詞再生または文字送りに使う音声アセットです。'],
  mouthSlot: ['口パク表示枠', '台詞中に口パクさせるスプライト表示枠です。-1は無効です。'],
  frames: ['所要時間', '待機または移動に使うフレーム数です。60フレームで約1秒です。'],
  variableName: ['フラグ・変数名', '分岐や次ステージ選択へ渡す変数名です。'],
  operation: ['変数操作', '代入・加算・減算など、変数へ行う処理です。'],
  value: ['値', '変数へ設定する値、または選択肢が返す値です。'],
  min: ['最小値', '変数操作後に許可する最小値です。'],
  max: ['最大値', '変数操作後に許可する最大値です。'],
  defaultIndex: ['初期選択', '選択肢を開いたとき最初に選ばれている行番号です。'],
  choices: ['選択肢', '表示文・保存値・遷移先シーンの一覧です。'],
  label: ['表示文', 'プレイヤーへ表示する選択肢の文章です。'],
  targetSceneId: ['遷移先シーン', 'この選択肢を決定した直後に移動するシーンIDです。空なら通常進行します。'],
});

const VN_BINDING_FIELD_META = Object.freeze({
  flags: ['キャンペーンフラグ', 'シーン分岐、次ステージ選択、ステージイベント条件へ渡せるフラグ名の一覧です。'],
  font: ['日本語フォント', 'デモで使う16×16フォントと使用文字だけの部分生成を設定します。'],
  kind: ['フォント種類', '同梱フォントまたはプロジェクトに登録したフォントを使用します。'],
  size: ['文字サイズ', 'フォントから字形を生成するときのピクセルサイズです。通常は16です。'],
  subset: ['使用文字だけ生成', '有効にすると全シーンで使う文字だけを抽出し、ROM使用量を抑えます。'],
  includeAscii: ['英数字を含める', '日本語に加えてASCII英数字・記号もフォントへ含めます。'],
});

function vnFieldMeta(path, value, key, scenes = []) {
  if (!path.length) return { label: 'シーン命令', help: '上から順に実行する背景・スプライト・音声・文章・待機・分岐命令です。', itemLabel: '命令' };
  const name = String(key ?? path.at(-1) ?? '設定');
  const base = VN_FIELD_META[name] || [name, `${name}の設定です。`];
  const meta = { label: base[0], help: base[1] };
  if (name === 'type') meta.options = Object.keys(VN_COMMAND_TEMPLATES).map((type) => ({
    value: type,
    label: ({ background: '背景表示', sprite: 'スプライト表示', audio: 'BGM・効果音', message: 'メッセージ', wait: '待機', spritemove: 'スプライト移動', variable: 'フラグ・変数', choice: '選択肢' })[type],
  }));
  if (name === 'transition') meta.options = [['cut', '即時切替'], ['fade', 'フェード切替']].map(([value, label]) => ({ value, label }));
  if (name === 'palette') meta.options = ['PAL0', 'PAL1', 'PAL2', 'PAL3'];
  if (name === 'kind') meta.options = [{ value: 'bgm', label: 'BGM' }, { value: 'se', label: '効果音' }];
  if (name === 'action') meta.options = [{ value: 'play', label: '再生' }, { value: 'stop', label: '停止' }, { value: 'fade', label: 'フェード停止' }];
  if (name === 'operation') meta.options = [{ value: 'set', label: '代入' }, { value: 'add', label: '加算' }, { value: 'sub', label: '減算' }, { value: 'toggle', label: '0/1反転' }];
  if (name === 'targetSceneId') meta.options = [{ value: '', label: '通常進行' }, ...scenes.map((scene) => ({ value: scene.id, label: scene.name || scene.id }))];
  if (name === 'text') meta.multiline = true;
  if (Array.isArray(value)) meta.itemLabel = name === 'choices' ? '選択肢' : '命令';
  return meta;
}

function commandArrayTemplate(path, array) {
  if (!path.length) return VN_COMMAND_TEMPLATES.message;
  if (path.at(-1) === 'choices') return { label: `選択肢${array.length + 1}`, value: array.length, targetSceneId: '' };
  return undefined;
}

function vnBindingFieldMeta(path, value, key) {
  const name = String(key ?? path.at(-1) ?? '設定');
  const parent = String(path.at(-2) ?? '');
  const base = typeof key === 'number' && parent === 'flags'
    ? ['フラグ名', '分岐やステージイベント条件で使用する重複しない名前です。']
    : VN_BINDING_FIELD_META[name] || [name, `${name}の設定です。`];
  const meta = { label: base[0], help: base[1] };
  if (name === 'kind') meta.options = [{ value: 'bundled', label: '同梱フォント' }, { value: 'project', label: 'プロジェクト登録フォント' }];
  if (name === 'size') { meta.min = 8; meta.max = 32; meta.step = 1; meta.suffix = 'px'; }
  if (name === 'flags') meta.itemLabel = 'フラグ';
  return meta;
}

function vnBindingArrayTemplate(path, array) {
  if (String(path.at(-1) || '') === 'flags') return `flag-${array.length + 1}`;
  return undefined;
}

export function mountSharedVnEditor({ root, sceneDocument, bindings = {}, onChange = () => {}, onPreview = null, readOnly = false } = {}) {
  if (!root) throw new Error('shared VN editor root is required');
  const state = {
    document: clone(sceneDocument || { version: 2, startScene: '', scenes: [] }),
    bindings: clone(bindings || {}),
    selectedId: String(sceneDocument?.startScene || sceneDocument?.scenes?.[0]?.id || ''),
  };

  root.classList.add('shared-vn-editor');
  root.innerHTML = `
    <aside class="shared-vn-library"><header><strong>共通シーン一覧</strong><button type="button" data-vn-add ${readOnly ? 'hidden' : ''} title="新しいシーンを追加">＋</button></header><div data-vn-scenes></div></aside>
    <main class="shared-vn-main"><div data-vn-binding></div><div data-vn-scene></div><div class="shared-vn-preview" data-vn-preview></div></main>`;
  const elements = {
    list: root.querySelector('[data-vn-scenes]'),
    binding: root.querySelector('[data-vn-binding]'),
    scene: root.querySelector('[data-vn-scene]'),
    preview: root.querySelector('[data-vn-preview]'),
  };

  function selectedScene() { return state.document.scenes.find((scene) => scene.id === state.selectedId) || null; }
  function emit() { onChange({ sceneDocument: clone(state.document), bindings: clone(state.bindings) }); }
  function sceneOptions(selected) {
    return ['<option value="">なし</option>', ...state.document.scenes.map((scene) => `<option value="${escapeHtml(scene.id)}" ${scene.id === selected ? 'selected' : ''}>${escapeHtml(scene.name || scene.id)}</option>`)].join('');
  }
  function renderList() {
    elements.list.innerHTML = state.document.scenes.map((scene) => `<button type="button" data-vn-scene-id="${escapeHtml(scene.id)}" class="${scene.id === state.selectedId ? 'active' : ''}" title="${escapeHtml(scene.name || scene.id)}を編集"><strong>${escapeHtml(scene.name || scene.id)}</strong><small>${escapeHtml(scene.id)} · 命令${(scene.commands || []).length}件</small></button>`).join('') || '<p>シーンはありません</p>';
  }
  function renderBindings() {
    const stageRows = Object.entries(state.bindings.stages || {}).map(([stageId, binding]) => `<label><span>${escapeHtml(stageId)} 前</span><select data-vn-bind-stage="${escapeHtml(stageId)}" data-vn-bind-slot="pre">${sceneOptions(binding.pre || '')}</select><span>後</span><select data-vn-bind-stage="${escapeHtml(stageId)}" data-vn-bind-slot="post">${sceneOptions(binding.post || '')}</select></label>`).join('');
    const caravan = state.bindings.caravan || {};
    const bindingExtras = { flags: state.bindings.flags || [], font: state.bindings.font || { kind: 'bundled', size: 16, subset: true, includeAscii: true } };
    elements.binding.innerHTML = `<section class="shared-vn-bindings"><h3 title="画面進行の各地点で再生するシーンを割り当てます">画面進行への割当</h3>${BINDING_GROUPS.map(([key, label]) => `<label title="${escapeHtml(label)}で再生するシーン"><span>${escapeHtml(label)}</span><select data-vn-binding="${key}">${sceneOptions(state.bindings[key] || state.bindings.endings?.[key === 'endingRescue' ? 'rescue' : 'destroy'] || '')}</select></label>`).join('')}<label title="救済／破壊エンディングを選ぶフラグと真偽条件"><span>エンディング分岐フラグ</span><input data-vn-ending-flag value="${escapeHtml(state.bindings.endingSelector?.flag || '')}"><span>救済になる値</span><select data-vn-ending-rescue><option value="true" ${state.bindings.endingSelector?.rescueWhen !== false ? 'selected' : ''}>有効 / 1</option><option value="false" ${state.bindings.endingSelector?.rescueWhen === false ? 'selected' : ''}>無効 / 0</option></select></label>${stageRows}<label title="キャラバン開始前と時間切れ後に再生するシーン"><span>キャラバン開始前</span><select data-vn-caravan="pre">${sceneOptions(caravan.pre || '')}</select><span>結果</span><select data-vn-caravan="result">${sceneOptions(caravan.result || '')}</select></label><p class="shared-vn-canonical" title="MD NovelとBulletML Studioが共有するシーン正本です">シーン正本: <code>${escapeHtml(state.bindings.canonicalSceneDocument || 'assets/pce-vn-scenes.json')}</code></p><div data-vn-binding-gui>${renderStructuredForm(bindingExtras, { scope: 'vn-bindings', resolveMeta: vnBindingFieldMeta })}</div></section>`;
    if (readOnly) elements.binding.querySelectorAll('select,input,button').forEach((control) => { control.disabled = true; });
  }
  function renderScene() {
    const scene = selectedScene();
    if (!scene) { elements.scene.innerHTML = '<p>シーンを選択してください。</p>'; renderPreview(); return; }
    elements.scene.innerHTML = `<section class="shared-vn-scene-form"><div class="shared-vn-scene-basics"><label title="シーン一覧へ表示する名前">シーン名<input data-vn-name value="${escapeHtml(scene.name || '')}" ${readOnly ? 'readonly' : ''}></label><label title="参照と遷移に使う安定ID">安定ID<input data-vn-id value="${escapeHtml(scene.id)}" ${readOnly ? 'readonly' : ''}></label><label title="このシーン終了後に自動で進むシーン">次のシーン<select data-vn-next ${readOnly ? 'disabled' : ''}>${sceneOptions(scene.nextSceneId || '')}</select></label></div><h3 title="上から順に実行するVN命令です">シーン命令</h3><p class="shared-vn-guide">命令はGUIで追加・削除・並べ替えできます。各「？」へマウスを置くと説明を表示します。</p><div data-vn-commands-gui>${renderStructuredForm(scene.commands || [], { scope: 'vn-commands', resolveMeta: (path, value, key) => vnFieldMeta(path, value, key, state.document.scenes) })}</div><details class="shared-vn-advanced"><summary title="通常は開く必要がありません">上級者向け：命令JSON</summary><textarea data-vn-commands-json ${readOnly ? 'readonly' : ''}>${escapeHtml(JSON.stringify(scene.commands || [], null, 2))}</textarea><button type="button" data-vn-apply-json ${readOnly ? 'hidden' : ''}>JSONをGUIへ反映</button></details><div><button type="button" data-vn-apply ${readOnly ? 'hidden' : ''} title="シーン名・ID・次のシーンを反映">シーン基本設定を反映</button><button type="button" data-vn-delete ${readOnly ? 'hidden' : ''} title="このシーンを削除">削除</button><button type="button" data-vn-run title="現在のシーンを簡易再生">プレビュー</button></div><p data-vn-error></p></section>`;
    if (readOnly) elements.scene.querySelectorAll('[data-structured-field],[data-structured-action]').forEach((control) => { control.disabled = true; });
    renderPreview();
  }
  function renderPreview(frame = null) {
    const scene = selectedScene();
    if (!scene) { elements.preview.innerHTML = ''; return; }
    let trace = null;
    try { trace = simulateScene({ ...state.document, startScene: scene.id }, {}, { maxSteps: 128 }); } catch (_error) { trace = null; }
    const commands = trace?.commands || scene.commands || [];
    elements.preview.innerHTML = `<header><strong>VNプレビュー</strong><span>${commands.length}手順</span></header><div class="shared-vn-preview-screen"><p>${escapeHtml(previewText(commands, frame))}</p></div>`;
    onPreview?.({ scene: clone(scene), trace, root: elements.preview });
  }
  function render() { renderList(); renderBindings(); renderScene(); }

  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vn-scene-id]');
    if (!button) return;
    state.selectedId = button.dataset.vnSceneId;
    render();
  });
  root.querySelector('[data-vn-add]')?.addEventListener('click', () => {
    let index = state.document.scenes.length + 1;
    while (state.document.scenes.some((scene) => scene.id === `scene-${index}`)) index += 1;
    const scene = { id: `scene-${index}`, name: `シーン ${index}`, commands: [], nextSceneId: '' };
    state.document.scenes.push(scene);
    state.document.startScene ||= scene.id;
    state.selectedId = scene.id;
    emit(); render();
  });
  elements.binding.addEventListener('click', (event) => {
    if (readOnly) return;
    const button = event.target.closest('[data-structured-action][data-structured-scope="vn-bindings"]');
    if (!button) return;
    if (applyStructuredArrayAction(state.bindings, button, vnBindingArrayTemplate)) {
      emit();
      renderBindings();
    }
  });
  elements.binding.addEventListener('change', (event) => {
    if (readOnly) return;
    const structured = event.target.closest('[data-structured-field][data-structured-scope="vn-bindings"]');
    if (structured) {
      applyStructuredField(state.bindings, structured);
      emit();
      renderBindings();
      return;
    }
    const control = event.target.closest('select,input');
    if (!control) return;
    if (control.dataset.vnEndingFlag !== undefined) {
      state.bindings.endingSelector ||= { flag: '', rescueWhen: true };
      state.bindings.endingSelector.flag = control.value.trim();
    } else if (control.dataset.vnEndingRescue !== undefined) {
      state.bindings.endingSelector ||= { flag: '', rescueWhen: true };
      state.bindings.endingSelector.rescueWhen = control.value === 'true';
    } else if (control.dataset.vnBinding) {
      const key = control.dataset.vnBinding;
      if (key === 'endingRescue' || key === 'endingDestroy') {
        state.bindings.endings ||= {};
        state.bindings.endings[key === 'endingRescue' ? 'rescue' : 'destroy'] = control.value;
      } else state.bindings[key] = control.value;
    } else if (control.dataset.vnBindStage) {
      state.bindings.stages ||= {};
      state.bindings.stages[control.dataset.vnBindStage] ||= {};
      state.bindings.stages[control.dataset.vnBindStage][control.dataset.vnBindSlot] = control.value;
    } else if (control.dataset.vnCaravan) {
      state.bindings.caravan ||= {};
      state.bindings.caravan[control.dataset.vnCaravan] = control.value;
    }
    emit();
  });
  elements.scene.addEventListener('click', (event) => {
    const scene = selectedScene();
    if (!scene) return;
    if (event.target.closest('[data-vn-run]')) { renderPreview(0); return; }
    if (readOnly) return;
    const structuredButton = event.target.closest('[data-structured-action][data-structured-scope="vn-commands"]');
    if (structuredButton) {
      if (applyStructuredArrayAction(scene.commands, structuredButton, commandArrayTemplate)) {
        emit();
        renderScene();
      }
      return;
    }
    if (event.target.closest('[data-vn-delete]')) {
      state.document.scenes = state.document.scenes.filter((entry) => entry.id !== scene.id);
      if (state.document.startScene === scene.id) state.document.startScene = state.document.scenes[0]?.id || '';
      state.selectedId = state.document.scenes[0]?.id || '';
      emit(); render(); return;
    }
    if (event.target.closest('[data-vn-apply-json]')) {
      const error = elements.scene.querySelector('[data-vn-error]');
      try {
        const commands = JSON.parse(elements.scene.querySelector('[data-vn-commands-json]').value || '[]');
        if (!Array.isArray(commands)) throw new Error('命令データは配列で指定してください');
        scene.commands = commands;
        error.textContent = '';
        emit(); renderScene();
      } catch (cause) { error.textContent = String(cause?.message || cause); }
      return;
    }
    if (!event.target.closest('[data-vn-apply]')) return;
    const error = elements.scene.querySelector('[data-vn-error]');
    try {
      const nextId = String(elements.scene.querySelector('[data-vn-id]').value || '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(nextId)) throw new Error('シーンIDが不正です');
      if (nextId !== scene.id && state.document.scenes.some((entry) => entry.id === nextId)) throw new Error('シーンIDが重複しています');
      const oldId = scene.id;
      scene.id = nextId;
      scene.name = elements.scene.querySelector('[data-vn-name]').value;
      scene.nextSceneId = elements.scene.querySelector('[data-vn-next]').value;
      if (state.document.startScene === oldId) state.document.startScene = nextId;
      state.selectedId = nextId;
      error.textContent = '';
      emit(); render();
    } catch (cause) { error.textContent = String(cause?.message || cause); }
  });
  elements.scene.addEventListener('change', (event) => {
    const control = event.target.closest('[data-structured-field][data-structured-scope="vn-commands"]');
    const scene = selectedScene();
    if (!control || !scene || readOnly) return;
    const path = decodeStructuredPath(control.dataset.structuredField);
    if (path.length === 2 && path[1] === 'type' && VN_COMMAND_TEMPLATES[control.value]) {
      setStructuredValue(scene.commands, [path[0]], clone(VN_COMMAND_TEMPLATES[control.value]));
    } else applyStructuredField(scene.commands, control);
    emit();
    renderScene();
  });

  render();
  return {
    getValue: () => ({ sceneDocument: clone(state.document), bindings: clone(state.bindings) }),
    setValue(next = {}) { state.document = clone(next.sceneDocument || state.document); state.bindings = clone(next.bindings || state.bindings); state.selectedId = state.document.startScene || state.document.scenes[0]?.id || ''; render(); },
    destroy() { root.innerHTML = ''; root.classList.remove('shared-vn-editor'); },
  };
}

function previewText(commands, frame) {
  const source = frame == null ? commands : commands.slice(0, Math.max(1, Number(frame) + 1));
  const messages = source.filter((command) => ['message', 'text'].includes(command.type)).map((command) => command.text || command.message || '');
  return messages.at(-1) || source.at(-1)?.text || 'シーンプレビュー';
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
