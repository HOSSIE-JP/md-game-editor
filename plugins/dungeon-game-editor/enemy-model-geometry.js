/*
 * DungeonEnemyModelGeometry — pure, dependency-free geometry helpers for the
 * "3Dモデルから生成" エネミースプライトジェネレーター (enemy-model-render.js から使う)。
 *
 * render-core.js と同じ UMD 規約: import文/export文/requireの呼び出しを書かず、
 * module.exports と globalThis.DungeonEnemyModelGeometry の両方へ代入する。
 * これにより Node (テスト、CommonJSのrequireで読み込み) と ブラウザ (enemy-model-render.js の
 * `await import(new URL('./enemy-model-geometry.js', import.meta.url))` +
 * globalThis 参照、render-core.js を renderer.js が読む方式と同一) の両方から
 * 依存なしで読み込める。Three.js / DOM / WebGL には一切触れない。
 *
 * 列の並び (view 0..3) = [背面, 右, 前, 左]。C engine の
 * rel = (enemyDir - camDir) & 3 (rel0=背, rel2=前) と同じ規約であり、
 * render-core.js の paintFallbackEnemyCell (view2=両目中央/正面、
 * view1=目がスプライト右端、view3=目がスプライト左端、view0=目なし/背面) が
 * 検証アンカー。この対応を誤るとエネミーの向きが実機で反転する。
 */
(function () {
  'use strict';

  const VIEWS = 4;
  const WALK_FRAMES = 2;
  const CELL = 48;
  const SOURCE_W = CELL * VIEWS; // 192
  const SOURCE_H = CELL * WALK_FRAMES; // 96

  /* view index -> モデルGroupを world +Y 周りに回転させる基準ヨー(度)。
   * 背=180 右=+90 前=0 左=-90。frontYawOffset(φ)はユーザーの正面補正 (既定0、0/180トグル)。 */
  const VIEW_YAW_DEG = [180, 90, 0, -90];

  function viewYaw(view, frontYawOffset) {
    const index = ((Number(view) % VIEWS) + VIEWS) % VIEWS;
    const base = VIEW_YAW_DEG[index];
    const offset = Number(frontYawOffset);
    return base + (Number.isFinite(offset) ? offset : 0);
  }

  function cellOrigin(view, walk) {
    return { x: Number(view) * CELL, y: Number(walk) * CELL };
  }

  const api = {
    VIEWS,
    WALK_FRAMES,
    CELL,
    SOURCE_W,
    SOURCE_H,
    VIEW_YAW_DEG,
    viewYaw,
    cellOrigin,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.DungeonEnemyModelGeometry = api;
  }
})();
