/*
 * enemy-model-render.js — glTF/GLB 3Dモデル+モーションからエネミースプライトシート
 * (192x96、4方向列×歩行2フレーム行、48x48セル) をラスタライズするエディター専用モジュール。
 *
 * ES module。vendor/three (Three.js r160 サブセット、plugins/dungeon-game-editor/vendor/three/
 * README.md 参照) を静的 import する。renderer.js はモーダルを開いた時だけ
 *   await import(new URL('./enemy-model-render.js', import.meta.url))
 * で遅延ロードする (render-core.js の兄弟importと同じ規約。~1MBのライブラリを起動時に読まない)。
 *
 * ROM/エクスポート側 (dungeon-service.js) や render-core.js からは一切参照されない。
 * このモジュールが生成するのは既存の enemy_texture PNG (192x96, indexed, <=16色) の
 * "中身" だけであり、焼き込み・スプライトシート寸法・Cテンプレートは不変。
 *
 * 方向→列マッピング・座標ヘルパー (viewYaw/cellOrigin) は依存フリーな
 * enemy-model-geometry.js (UMD, render-core.js と同じ規約) に分離してある。
 * これは Node のテストハーネスが DOM/WebGL を持たず、この ES module 自体を
 * (bare `import`/`export` 構文のため) require() できないための構成であり、
 * 純関数のテストは enemy-model-geometry.js を直接 require() して行う。
 */
import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';

await import(new URL('./enemy-model-geometry.js', import.meta.url));
const geometry = globalThis.DungeonEnemyModelGeometry;
const { VIEWS, WALK_FRAMES, CELL, SOURCE_W, SOURCE_H, viewYaw, cellOrigin } = geometry;

/* glTF extensionsRequired のうち、vendorしていない (=非対応) 圧縮形式。
 * GLTFLoader 自体もDRACOLoader/KTX2Loader/meshoptDecoderが未設定なら遅延段階で
 * 失敗しうるが、そのエラーは分かりにくい(あるいはmeshoptは無圧縮として誤読される
 * リスクがある)ため、parse前に明示的な日本語メッセージで弾く。 */
const UNSUPPORTED_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'KHR_texture_basisu',
  'EXT_meshopt_compression',
]);

const GLB_MAGIC = 0x46546c67; // 'glTF' (little-endian uint32)
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'

/*
 * arrayBuffer から extensionsRequired を覗き見する (GLTFLoaderを通す前の軽量プリチェック)。
 * .glb (バイナリ) / .gltf (JSONテキスト) どちらも対応。解析に失敗した場合は空配列を返し、
 * 実際のエラーは後続の GLTFLoader.parse に委ねる。
 */
function detectRequiredExtensions(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    const isGlb = arrayBuffer.byteLength >= 12 && view.getUint32(0, true) === GLB_MAGIC;
    let jsonText;
    if (isGlb) {
      if (arrayBuffer.byteLength < 20) return [];
      const chunkLength = view.getUint32(12, true);
      const chunkType = view.getUint32(16, true);
      if (chunkType !== GLB_JSON_CHUNK_TYPE) return [];
      const jsonBytes = new Uint8Array(arrayBuffer, 20, Math.min(chunkLength, arrayBuffer.byteLength - 20));
      jsonText = new TextDecoder('utf-8').decode(jsonBytes);
    } else {
      jsonText = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
    }
    const json = JSON.parse(jsonText);
    return Array.isArray(json.extensionsRequired) ? json.extensionsRequired.slice() : [];
  } catch (_err) {
    return [];
  }
}

/*
 * glTF/GLB の ArrayBuffer を解析する。DRACO/KTX2/meshopt必須のモデルは
 * parse前に明示的にrejectする。戻り値の scene は GLTFLoader が生成した Three.js
 * シーングラフそのもの (再利用可能、renderGrid が Group へ再親付けする)。
 */
async function parseModel(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error('glTF/GLBデータの読み込みに失敗しました (ArrayBufferが必要です)');
  }
  const requiredExtensions = detectRequiredExtensions(arrayBuffer);
  const unsupported = requiredExtensions.filter((name) => UNSUPPORTED_EXTENSIONS.has(name));
  if (unsupported.length) {
    throw new Error(`非対応の圧縮形式です (${unsupported.join(', ')})。DRACO/KTX2/meshopt圧縮を使わないglTF/GLBを使用してください`);
  }

  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    try {
      loader.parse(arrayBuffer, '', resolve, (err) => {
        reject(err instanceof Error ? err : new Error(String(err?.message || err || 'glTF解析エラー')));
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err?.message || err)));
    }
  });

  const scene = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
  if (!scene) throw new Error('モデルにシーンが含まれていません');
  const animations = Array.isArray(gltf.animations) ? gltf.animations : [];
  const clipNames = animations.map((clip, index) => clip.name || `clip_${index}`);
  return { scene, animations, clipNames, requiredExtensions };
}

/*
 * オフスクリーン (DOMツリーに追加しない) canvas + WebGLRenderer + Scene + ライトの
 * レンダーセッションを作る。ライトはワールド固定でモデルGroupには親子付けしない
 * (回転する各ビューが均等に照らされフラット黒を防ぐため)。
 */
function createSession({ superSampleSize = 256 } = {}) {
  const size = Math.max(16, Math.min(256, Math.floor(superSampleSize)));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (err) {
    throw new Error(`WebGL初期化に失敗しました: ${String(err?.message || err)}`);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const directional = new THREE.DirectionalLight(0xffffff, 0.85);
  directional.target.position.set(0, 0, 0);
  scene.add(ambient, directional, directional.target);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

  const readCanvas = document.createElement('canvas');
  readCanvas.width = size;
  readCanvas.height = size;

  const session = {
    canvas,
    readCanvas,
    renderer,
    scene,
    camera,
    ambient,
    directional,
    root: null,
    superSampleSize: size,
    disposed: false,
  };
  session.dispose = () => disposeSession(session);
  return session;
}

function disposeSession(session) {
  if (!session || session.disposed) return;
  session.disposed = true;
  if (session.root) {
    session.scene.remove(session.root);
    session.root = null;
  }
  try { session.renderer.dispose(); } catch (_err) { /* noop */ }
  try { session.renderer.forceContextLoss(); } catch (_err) { /* noop */ }
}

function makeImageData(width, height) {
  if (typeof ImageData !== 'undefined') return new ImageData(width, height);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/* superSize x superSize の描画結果を ImageData として読み出す (preserveDrawingBuffer:true 前提)。
 * WebGLキャンバスから直接ではなく2Dキャンバスへ drawImage することで、gl.readPixelsの
 * Y反転処理を自前で書かずに済ませる。 */
function readSessionPixels(session) {
  const { canvas, readCanvas, superSampleSize } = session;
  const ctx = readCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, superSampleSize, superSampleSize);
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, superSampleSize, superSampleSize);
}

/* supersample画像 (srcW x srcH) を dstW x dstH へボックスフィルタ平均で縮小する。
 * (計画メモの「bilinear縮小」に相当。~256px→48pxのような大きい縮小比では
 * 単純bilinearよりボックス平均の方がエイリアシングが少なく安定するためこちらを採用。) */
function downsampleBox(src, srcW, srcH, dstW, dstH) {
  const dst = makeImageData(dstW, dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let yy = y0; yy < y1 && yy < srcH; yy++) {
        for (let xx = x0; xx < x1 && xx < srcW; xx++) {
          const i = ((yy * srcW) + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          count++;
        }
      }
      if (count === 0) count = 1;
      const di = ((y * dstW) + x) * 4;
      dst.data[di] = r / count;
      dst.data[di + 1] = g / count;
      dst.data[di + 2] = b / count;
      dst.data[di + 3] = a / count;
    }
  }
  return dst;
}

function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = ((y * src.width) + x) * 4;
      const di = (((oy + y) * dst.width) + (ox + x)) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/*
 * model (parseModelの戻り値) を params に従って 4方向×2歩行フレームへラスタライズし、
 * 192x96 の RGBA ImageData を返す (cellOrigin(view,walk) の位置に48x48セルを合成)。
 *
 * params:
 *   frontYawOffset (度, 既定0) — モデルの正面補正 (0 or 180 トグル想定)
 *   elevationDeg (-30..30, 既定0) — カメラ仰角
 *   zoom (既定1) — 大きいほどズームイン
 *   clipName (既定'') — アニメーションクリップ名。空なら静止ポーズ
 *   sampleFractionA / sampleFractionB (0..1, 既定0/0.5) — walk行0/1のクリップ内サンプル時刻(割合)
 */
async function renderGrid(session, model, params = {}) {
  if (!session || session.disposed) throw new Error('レンダーセッションが無効です');
  if (!model || !model.scene) throw new Error('モデルが読み込まれていません');

  const frontYawOffset = Number(params.frontYawOffset) || 0;
  const elevationDeg = clamp(Number(params.elevationDeg) || 0, -30, 30);
  const zoom = Math.max(0.05, Number(params.zoom) || 1);
  const clipName = String(params.clipName || '');
  const fractions = [
    clamp(Number(params.sampleFractionA) || 0, 0, 1),
    clamp(Number(params.sampleFractionB) || 0, 0, 1),
  ];

  if (session.root) {
    session.scene.remove(session.root);
    session.root = null;
  }
  const root = new THREE.Group();
  root.add(model.scene);
  session.scene.add(root);
  session.root = root;

  const clip = clipName ? (model.animations || []).find((item) => (item.name || '') === clipName) || null : null;
  const mixer = clip ? new THREE.AnimationMixer(model.scene) : null;
  if (mixer && clip) mixer.clipAction(clip).play();

  const applyPose = (fraction) => {
    if (!mixer || !clip) return;
    mixer.setTime(0);
    const duration = Math.max(0, Number(clip.duration) || 0);
    mixer.setTime(fraction * duration);
  };

  try {
    /* 1) 4ビュー×2フレーム全ポーズの Box3 の和でカメラフレーミングを決める
     *    (セルごとにフレーミングが変わるとスケールがポップするため、全セル共通の
     *    frustumを1回だけ計算する)。 */
    const union = new THREE.Box3();
    for (let view = 0; view < VIEWS; view++) {
      root.rotation.y = THREE.MathUtils.degToRad(viewYaw(view, frontYawOffset));
      for (let walk = 0; walk < WALK_FRAMES; walk++) {
        applyPose(fractions[walk]);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model.scene);
        if (!box.isEmpty()) union.union(box);
      }
    }
    if (union.isEmpty()) {
      union.min.set(-0.5, -0.5, -0.5);
      union.max.set(0.5, 0.5, 0.5);
    }
    const size = union.getSize(new THREE.Vector3());
    const center = union.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;

    /* 2) Orthographic カメラ: 水平正面 + 仰角スライダー。ワールド固定 (モデルGroupが回転する)。 */
    const dist = (radius * 4) + 1;
    const elevRad = THREE.MathUtils.degToRad(elevationDeg);
    session.camera.position.set(
      center.x,
      center.y + (Math.sin(elevRad) * dist),
      center.z + (Math.cos(elevRad) * dist),
    );
    session.camera.up.set(0, 1, 0);
    session.camera.lookAt(center.x, center.y, center.z);
    const half = radius / zoom;
    session.camera.left = -half;
    session.camera.right = half;
    session.camera.top = half;
    session.camera.bottom = -half;
    session.camera.near = 0.01;
    session.camera.far = dist + (radius * 4) + 1;
    session.camera.updateProjectionMatrix();

    /* カメラ追従ライト (モデルGroupには親子付けしない)。カメラは4ビュー間で動かないため、
     * 実質ワールド固定であり、回転するモデルのどの面が正面を向いても均等に照らされる。 */
    session.directional.position.set(
      session.camera.position.x,
      session.camera.position.y + radius,
      session.camera.position.z,
    );
    session.directional.target.position.set(center.x, center.y, center.z);
    session.directional.target.updateMatrixWorld();

    /* 3) 各セルをスーパーサンプル解像度で描画→ボックスフィルタで48x48へ縮小→合成 */
    const out = makeImageData(SOURCE_W, SOURCE_H);
    const superSize = session.superSampleSize;
    for (let view = 0; view < VIEWS; view++) {
      root.rotation.y = THREE.MathUtils.degToRad(viewYaw(view, frontYawOffset));
      for (let walk = 0; walk < WALK_FRAMES; walk++) {
        applyPose(fractions[walk]);
        root.updateMatrixWorld(true);
        session.renderer.clear();
        session.renderer.render(session.scene, session.camera);
        const superPixels = readSessionPixels(session);
        const cellPixels = downsampleBox(superPixels, superSize, superSize, CELL, CELL);
        const { x: ox, y: oy } = cellOrigin(view, walk);
        blit(out, cellPixels, ox, oy);
      }
    }
    return out;
  } finally {
    if (mixer) mixer.stopAllAction();
  }
}

/* MDの3bit/chマスク値 (paletteToVdpColors の /36 量子化と同じ規約) へスナップする。 */
function snapChannelTo3Bit(value) {
  const level = clamp(Math.round(value / 36), 0, 7);
  return level * 36;
}

/*
 * ローカル16色量子化 (人気色法)。不透明ピクセル(alpha>=128)だけを対象にMD 3bit/chへ
 * スナップし、出現頻度上位 maxOpaqueColors 色をパレットとして採用、それ以外は最近傍色へ
 * マップする。alpha<128 のピクセルは透過 (index=-1) として扱う。
 * imageDataToIndexedPng が透過時にindex 0を1枠自動確保するため、maxOpaqueColors の既定値は
 * 15 (15+1=16 <= 検証の16色上限)。
 */
function quantizeLocal16(imageData, maxOpaqueColors = 15) {
  const { data, width, height } = imageData;
  const total = width * height;
  const keys = new Array(total);
  const counts = new Map();
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) {
      keys[p] = null;
      continue;
    }
    const key = `${snapChannelTo3Bit(data[i])},${snapChannelTo3Bit(data[i + 1])},${snapChannelTo3Bit(data[i + 2])}`;
    keys[p] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const palette = ranked.slice(0, maxOpaqueColors).map(([key]) => {
    const [r, g, b] = key.split(',').map(Number);
    return { r, g, b };
  });
  if (palette.length === 0) palette.push({ r: 0, g: 0, b: 0 });
  const paletteIndexByKey = new Map(palette.map((c, idx) => [`${c.r},${c.g},${c.b}`, idx]));

  const nearestIndex = (r, g, b) => {
    let best = 0;
    let bestDist = Infinity;
    for (let idx = 0; idx < palette.length; idx++) {
      const c = palette[idx];
      const dr = c.r - r;
      const dg = c.g - g;
      const db = c.b - b;
      const dist = (dr * dr) + (dg * dg) + (db * db);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  };

  const indices = new Int16Array(total).fill(-1);
  for (let p = 0; p < total; p++) {
    const key = keys[p];
    if (key === null) continue;
    let idx = paletteIndexByKey.get(key);
    if (idx === undefined) {
      const [r, g, b] = key.split(',').map(Number);
      idx = nearestIndex(r, g, b);
    }
    indices[p] = idx;
  }
  return { indices, palette };
}

/* {indices,palette} からクリーンな RGBA ImageData を再構成する。各不透明ピクセルは
 * パレット色そのものをalpha=255で、透過ピクセルはalpha=0 (rgbは0) で書き出すため、
 * AA端の混色やハーフトーンが一切残らない (imageDataToIndexedPng へ渡す直前の状態)。 */
function reconstructRgba(width, height, indices, palette) {
  const out = makeImageData(width, height);
  const total = width * height;
  for (let p = 0; p < total; p++) {
    const di = p * 4;
    const idx = indices[p];
    if (idx < 0) {
      out.data[di] = 0;
      out.data[di + 1] = 0;
      out.data[di + 2] = 0;
      out.data[di + 3] = 0;
      continue;
    }
    const c = palette[idx];
    out.data[di] = c.r;
    out.data[di + 1] = c.g;
    out.data[di + 2] = c.b;
    out.data[di + 3] = 255;
  }
  return out;
}

/*
 * renderGrid の生RGBA ImageData を、既存の image-quantize capability が要求する
 * 「既に<=16色」な入力へ変換してから imageDataToIndexedPng へ渡し、dataURLを返す。
 * imageDataToIndexedPng 自体は減色しない (ユニーク色を256まで収集するだけ) ため、
 * リット済み3D描画をそのまま渡すと数百色になり validateAssetInspection (<=16色) に落ちる。
 */
async function toIndexedEnemyPng(imageData, api) {
  const { indices, palette } = quantizeLocal16(imageData);
  const clean = reconstructRgba(imageData.width, imageData.height, indices, palette);
  const quantize = api?.capabilities?.get?.('image-quantize');
  const encode = quantize?.imageDataToIndexedPng || api?.imageDataToIndexedPng;
  if (typeof encode !== 'function') {
    throw new Error('画像量子化機能が無効です (image-quantize-converter を確認してください)');
  }
  return encode(clean);
}

export {
  parseModel,
  createSession,
  disposeSession,
  renderGrid,
  toIndexedEnemyPng,
  quantizeLocal16,
  reconstructRgba,
  snapChannelTo3Bit,
  detectRequiredExtensions,
  viewYaw,
  cellOrigin,
  VIEWS,
  WALK_FRAMES,
  CELL,
  SOURCE_W,
  SOURCE_H,
};
