/*
 * DungeonRenderCore — 疑似3Dダンジョンの共有レンダリングコア (UMD)
 *
 * エディタの3Dプレビュー(browser)と SGDK エクスポータ(Node)の両方から
 * 同一のコードで使用する。プレビュー描画とタイルパターン焼き込みが
 * 同じ関数を通るため、プレビュー出力と実機出力はピクセル単位で一致する。
 *
 * - import / export / require を書かない (Node は module.exports、
 *   browser は globalThis.DungeonRenderCore で参照する)
 * - 相対座標系: プレイヤーセル中心を原点、前方 +d、右 +l、上 +z(0..1)
 * - デシジョンテーブル: 画面タイル(8x8)ごとに「周囲エッジ状態→タイル実体」
 *   の三分木を焼き込み、実機側はこれを辿って画面を合成する
 */
(function () {
  'use strict';

  const VIEW_W = 200;
  const VIEW_H = 128;
  const VIEW_TILE_W = 25;
  const VIEW_TILE_H = 16;
  const VIEW_HORIZON = 64;
  const VIEW_PROJECT = 100;
  const VIEW_EYE_Z = 0.42;
  const VIEW_NEAR_CLIP = 0.045;
  const VIEW_CAMERA_BACKSTEP = 0.18;
  const VIEW_DEPTH_EPSILON = 0.002;
  const VIEW_DEPTH_CELLS = 4;
  const EDGE_STATE_OPEN = 0;
  const EDGE_STATE_WALL = 1;
  const EDGE_STATE_DOOR = 2;
  const MOVE_EDGE_LIMIT = 64;
  const TURN_EDGE_LIMIT = 127;
  const LEAF_FLAG = 0x8000;
  const TILE_INDEX_LIMIT = 0x7fff;
  const TILE_DROP_MIN_COVER = 3;
  const TILE_DROP_MIN_DEPTH = 3.25;
  const TILE_PARTIAL_CAP = 8;
  const DOOR_DETAIL_DEPTH = 4.75;
  const DOOR_PANEL_U0 = 0.22;
  const DOOR_PANEL_U1 = 0.78;
  const DOOR_PANEL_V0 = 0.18;
  const SHADE_QUANT = 16;
  const BAND_SHADE_BASE = 0.95;
  const BAND_SHADE_FALLOFF = 0.3;
  const BAND_SHADE_FLOOR = 0.05;
  const WALL_SHADE_FLOOR = 0.24;
  const WALL_SHADE_FALLOFF = 0.08;
  const BB_FRAME_SIZE = 48;
  const BB_FRAME_TILES = 6;
  const BB_WORLD_HEIGHT = 0.55;
  const BB_BUCKET_HEIGHTS = [48, 40, 33, 27, 22, 18, 14, 11];
  const BB_MAX_HEIGHT = 54;
  const BB_MIN_HEIGHT = 9;
  const BB_MIN_DEPTH = 0.55;
  const SPRITE_TRANSPARENT = { r: 255, g: 0, b: 255 };
  const DIR_DX = [0, 1, 0, -1];
  const DIR_DY = [-1, 0, 1, 0];
  const EDGE_BITS = [1, 2, 4, 8];
  const TEXTURE_KINDS = ['wall', 'door', 'floor', 'ceiling', 'chest', 'stairs_up', 'stairs_down'];
  const ATLAS_LAYOUT_LEGACY = {
    columns: 3,
    rows: 2,
    rects: {
      wall: [0, 0],
      floor: [1, 0],
      ceiling: [2, 0],
      chest: [0, 1],
      stairs_up: [1, 1],
      stairs_down: [2, 1],
    },
  };
  const ATLAS_LAYOUT_DOOR = {
    columns: 4,
    rows: 2,
    rects: {
      wall: [0, 0],
      floor: [1, 0],
      ceiling: [2, 0],
      door: [3, 0],
      chest: [0, 1],
      stairs_up: [1, 1],
      stairs_down: [2, 1],
    },
  };
  const FALLBACK_COLORS = {
    wall: [[117, 105, 87], [74, 67, 56], [164, 150, 120]],
    door: [[138, 85, 44], [76, 47, 29], [210, 162, 91]],
    floor: [[75, 56, 41], [42, 33, 27], [106, 80, 58]],
    ceiling: [[43, 43, 56], [21, 21, 31], [78, 78, 98]],
    chest: [[196, 132, 51], [91, 53, 28], [241, 196, 108]],
    stairs_up: [[130, 186, 219], [49, 92, 115], [197, 232, 244]],
    stairs_down: [[148, 121, 209], [62, 46, 101], [213, 198, 255]],
  };
  const PALETTE_SHADES = [0.28, 0.36, 0.46, 0.56, 0.68, 0.82, 0.96];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeSmooth(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function fractional(value) {
    return value - Math.floor(value);
  }

  /* ------------------------------------------------------------------
   * フォールバックテクスチャ (canvas 不要の純粋ピクセル生成)
   * ------------------------------------------------------------------ */

  function makeFallbackTexture(kind) {
    const size = 32;
    const colors = FALLBACK_COLORS[kind] || FALLBACK_COLORS.wall;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const block = ((x + y) & 8) ? colors[0] : colors[1];
        const border = (x % 8) === 0 || (y % 8) === 0;
        const color = border ? colors[2] : block;
        const i = ((y * size) + x) * 4;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 255;
      }
    }
    if (kind === 'door') paintFallbackDoor(data, size, colors);
    return { width: size, height: size, data };
  }

  function paintFallbackDoor(data, size, colors) {
    const wall = FALLBACK_COLORS.wall;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = ((y * size) + x) * 4;
        const base = ((x + y) & 8) ? wall[0] : wall[1];
        data[i] = base[0];
        data[i + 1] = base[1];
        data[i + 2] = base[2];
        const inDoor = x >= 7 && x <= 24 && y >= 6;
        if (!inDoor) continue;
        const frame = x === 7 || x === 24 || y === 6;
        const plank = ((x - 7) % 5) === 0;
        const color = frame ? colors[2] : (plank ? colors[1] : colors[0]);
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
      }
    }
    for (let y = 18; y <= 20; y++) {
      for (let x = 20; x <= 22; x++) {
        const i = ((y * size) + x) * 4;
        data[i] = colors[2][0];
        data[i + 1] = colors[2][1];
        data[i + 2] = colors[2][2];
      }
    }
  }

  function normalizeTextures(input) {
    const out = {};
    TEXTURE_KINDS.forEach((kind) => {
      const texture = input && input[kind];
      out[kind] = texture && texture.width > 0 && texture.height > 0 && texture.data
        ? texture
        : makeFallbackTexture(kind);
    });
    return out;
  }

  function atlasLayoutFor(meta) {
    const columns = Number(meta && meta.columns);
    const rows = Number(meta && meta.rows);
    if (columns === ATLAS_LAYOUT_DOOR.columns && rows === ATLAS_LAYOUT_DOOR.rows) return ATLAS_LAYOUT_DOOR;
    return ATLAS_LAYOUT_LEGACY;
  }

  /* ------------------------------------------------------------------
   * パレット (16色, index 0 = 黒背景) と量子化
   * ------------------------------------------------------------------ */

  function averageTextureColor(texture) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const stepX = Math.max(1, Math.floor(texture.width / 24));
    const stepY = Math.max(1, Math.floor(texture.height / 24));
    for (let y = 0; y < texture.height; y += stepY) {
      for (let x = 0; x < texture.width; x += stepX) {
        const i = ((y * texture.width) + x) * 4;
        if (texture.data[i + 3] < 16) continue;
        r += texture.data[i];
        g += texture.data[i + 1];
        b += texture.data[i + 2];
        count++;
      }
    }
    const total = Math.max(1, count);
    return { r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total) };
  }

  function sampleTextureColors(texture, colors) {
    const stepX = Math.max(1, Math.floor(texture.width / 32));
    const stepY = Math.max(1, Math.floor(texture.height / 32));
    for (let y = 0; y < texture.height; y += stepY) {
      for (let x = 0; x < texture.width; x += stepX) {
        const i = ((y * texture.width) + x) * 4;
        if (texture.data[i + 3] < 16) continue;
        PALETTE_SHADES.forEach((shade) => {
          colors.push({
            r: clamp(Math.round(texture.data[i] * shade), 0, 255),
            g: clamp(Math.round(texture.data[i + 1] * shade), 0, 255),
            b: clamp(Math.round(texture.data[i + 2] * shade), 0, 255),
          });
        });
      }
    }
  }

  function colorRange(colors) {
    const min = { r: 255, g: 255, b: 255 };
    const max = { r: 0, g: 0, b: 0 };
    colors.forEach((color) => {
      min.r = Math.min(min.r, color.r);
      min.g = Math.min(min.g, color.g);
      min.b = Math.min(min.b, color.b);
      max.r = Math.max(max.r, color.r);
      max.g = Math.max(max.g, color.g);
      max.b = Math.max(max.b, color.b);
    });
    return [
      { channel: 'r', value: max.r - min.r },
      { channel: 'g', value: max.g - min.g },
      { channel: 'b', value: max.b - min.b },
    ].sort((a, b) => b.value - a.value)[0];
  }

  function averageColor(colors) {
    const total = colors.reduce((sum, color) => ({
      r: sum.r + color.r,
      g: sum.g + color.g,
      b: sum.b + color.b,
    }), { r: 0, g: 0, b: 0 });
    const count = Math.max(1, colors.length);
    const r = Math.round(total.r / count);
    const g = Math.round(total.g / count);
    const b = Math.round(total.b / count);
    return { value: ((r << 16) | (g << 8) | b) >>> 0, r, g, b };
  }

  function colorLuma(color) {
    return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  }

  function quantizeColors(colors, count) {
    if (!colors.length) {
      return Array.from({ length: count }, (_, i) => {
        const v = Math.round(((i + 1) / count) * 255);
        return { value: ((v << 16) | (v << 8) | v) >>> 0, r: v, g: v, b: v };
      });
    }
    let buckets = [colors.slice()];
    while (buckets.length < count) {
      let bestIndex = -1;
      let bestRange = -1;
      buckets.forEach((bucket, index) => {
        if (bucket.length < 2) return;
        const range = colorRange(bucket);
        if (range.value > bestRange) {
          bestRange = range.value;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) break;
      const bucket = buckets.splice(bestIndex, 1)[0];
      const channel = colorRange(bucket).channel;
      bucket.sort((a, b) => a[channel] - b[channel] || a.r - b.r || a.g - b.g || a.b - b.b);
      const mid = Math.max(1, Math.floor(bucket.length / 2));
      buckets.push(bucket.slice(0, mid), bucket.slice(mid));
    }
    const out = buckets.map(averageColor).sort((a, b) => colorLuma(a) - colorLuma(b) || a.value - b.value);
    while (out.length < count) out.push(out[out.length - 1] || { value: 0, r: 0, g: 0, b: 0 });
    return out.slice(0, count);
  }

  function bandShade(depth) {
    return Math.max(BAND_SHADE_FLOOR, BAND_SHADE_BASE / (1 + depth * BAND_SHADE_FALLOFF));
  }

  function bandDepthForRow(y) {
    if (y < VIEW_HORIZON) return ((1 - VIEW_EYE_Z) * VIEW_PROJECT) / (VIEW_HORIZON - (y + 0.5));
    return (VIEW_EYE_Z * VIEW_PROJECT) / ((y + 0.5) - VIEW_HORIZON);
  }

  function buildViewPalette(texturesInput) {
    const textures = normalizeTextures(texturesInput);
    const colors = [];
    sampleTextureColors(textures.wall, colors);
    sampleTextureColors(textures.door, colors);
    const floorAvg = averageTextureColor(textures.floor);
    const ceilingAvg = averageTextureColor(textures.ceiling);
    for (let y = 0; y < VIEW_H; y++) {
      const avg = y < VIEW_HORIZON ? ceilingAvg : floorAvg;
      const shade = bandShade(bandDepthForRow(y));
      colors.push({
        r: clamp(Math.round(avg.r * shade), 0, 255),
        g: clamp(Math.round(avg.g * shade), 0, 255),
        b: clamp(Math.round(avg.b * shade), 0, 255),
      });
    }
    const quantized = quantizeColors(colors, 15);
    return [{ value: 0, r: 0, g: 0, b: 0 }, ...quantized];
  }

  function buildSpritePalette(texturesInput) {
    const textures = normalizeTextures(texturesInput);
    const colors = [];
    sampleTextureColors(textures.chest, colors);
    sampleTextureColors(textures.stairs_up, colors);
    sampleTextureColors(textures.stairs_down, colors);
    const quantized = quantizeColors(colors, 15);
    const key = SPRITE_TRANSPARENT;
    return [{ value: ((key.r << 16) | (key.g << 8) | key.b) >>> 0, ...key }, ...quantized];
  }

  function nearestPalette(palette, r, g, b) {
    let best = 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 1; index < palette.length; index++) {
      const color = palette[index];
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      const score = dr * dr + dg * dg + db * db;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    return best;
  }

  function buildBandTables(palette, texturesInput) {
    const textures = normalizeTextures(texturesInput);
    const floorAvg = averageTextureColor(textures.floor);
    const ceilingAvg = averageTextureColor(textures.ceiling);
    const rows = new Uint8Array(VIEW_H);
    for (let y = 0; y < VIEW_H; y++) {
      const avg = y < VIEW_HORIZON ? ceilingAvg : floorAvg;
      const shade = bandShade(bandDepthForRow(y));
      rows[y] = nearestPalette(palette, avg.r * shade, avg.g * shade, avg.b * shade);
    }
    return rows;
  }

  function buildBackground(bandRows) {
    const out = new Uint8Array(VIEW_W * VIEW_H);
    for (let y = 0; y < VIEW_H; y++) {
      out.fill(bandRows[y], y * VIEW_W, (y + 1) * VIEW_W);
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * ポーズ (カメラ位置は相対座標 {l, d, angle}、バックステップ込み)
   * ------------------------------------------------------------------ */

  function poseStatic() {
    return { l: 0, d: -VIEW_CAMERA_BACKSTEP, angle: 0 };
  }

  function poseForward(t) {
    return { l: 0, d: -VIEW_CAMERA_BACKSTEP + easeSmooth(t), angle: 0 };
  }

  function poseTurnRight(t) {
    const angle = easeSmooth(t) * (Math.PI / 2);
    return {
      l: -VIEW_CAMERA_BACKSTEP * Math.sin(angle),
      d: -VIEW_CAMERA_BACKSTEP * Math.cos(angle),
      angle,
    };
  }

  function buildFrames(settings) {
    const moveFrames = clamp(Number(settings && settings.animation_frames) || 8, 2, 8);
    const turnFrames = clamp(Number(settings && settings.turn_frames) || moveFrames, 2, 8);
    const fwdPoses = [];
    for (let k = 1; k < moveFrames; k++) fwdPoses.push(poseForward(k / moveFrames));
    const turnPoses = [];
    for (let k = 1; k < turnFrames; k++) turnPoses.push(poseTurnRight(k / turnFrames));
    return {
      moveFrames,
      turnFrames,
      staticPose: poseStatic(),
      fwdPoses,
      turnPoses,
    };
  }

  /* ------------------------------------------------------------------
   * 透視投影 + 三角形ラスタライザ
   * ------------------------------------------------------------------ */

  function toCameraPoint(pose, point) {
    const sinA = Math.sin(pose.angle);
    const cosA = Math.cos(pose.angle);
    const dl = point.l - pose.l;
    const dd = point.d - pose.d;
    return {
      x: dl * cosA - dd * sinA,
      y: point.z - VIEW_EYE_Z,
      z: dl * sinA + dd * cosA,
      u: point.u,
      v: point.v,
    };
  }

  function interpolateCameraPoint(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: VIEW_NEAR_CLIP,
      u: lerp(a.u, b.u, t),
      v: lerp(a.v, b.v, t),
    };
  }

  function clipCameraPolygon(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const aIn = a.z >= VIEW_NEAR_CLIP;
      const bIn = b.z >= VIEW_NEAR_CLIP;
      if (aIn && bIn) {
        out.push(b);
      } else if (aIn && !bIn) {
        out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)));
      } else if (!aIn && bIn) {
        out.push(interpolateCameraPoint(a, b, (VIEW_NEAR_CLIP - a.z) / (b.z - a.z)), b);
      }
    }
    return out;
  }

  function projectCameraPoint(point) {
    if (point.z < VIEW_NEAR_CLIP) return null;
    const invZ = 1 / point.z;
    return {
      x: VIEW_W / 2 + point.x * VIEW_PROJECT * invZ,
      y: VIEW_HORIZON - point.y * VIEW_PROJECT * invZ,
      invZ,
      uOverZ: point.u * invZ,
      vOverZ: point.v * invZ,
    };
  }

  function edgeFunction(a, b, x, y) {
    return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
  }

  function edgeWorldQuad(def) {
    if (def.face === 0) {
      const d = def.dd + 0.5;
      return [
        { l: def.dl - 0.5, d, z: 0, u: 0, v: 1 },
        { l: def.dl + 0.5, d, z: 0, u: 1, v: 1 },
        { l: def.dl + 0.5, d, z: 1, u: 1, v: 0 },
        { l: def.dl - 0.5, d, z: 1, u: 0, v: 0 },
      ];
    }
    const l = def.dl + 0.5;
    return [
      { l, d: def.dd - 0.5, z: 0, u: 0, v: 1 },
      { l, d: def.dd + 0.5, z: 0, u: 1, v: 1 },
      { l, d: def.dd + 0.5, z: 1, u: 1, v: 0 },
      { l, d: def.dd - 0.5, z: 1, u: 0, v: 0 },
    ];
  }

  function edgeFaceShade(pose, def) {
    const alignment = def.face === 0 ? Math.abs(Math.cos(pose.angle)) : Math.abs(Math.sin(pose.angle));
    return 0.52 + alignment * 0.42;
  }

  function sampleTexel(texture, u, v) {
    const x = Math.abs(Math.floor(fractional(u) * texture.width)) % texture.width;
    const y = Math.abs(Math.floor(fractional(v) * texture.height)) % texture.height;
    const i = ((y * texture.width) + x) * 4;
    return { r: texture.data[i], g: texture.data[i + 1], b: texture.data[i + 2] };
  }

  /*
   * 扉は「壁テクスチャ + 中央の扉パネル」として描く。パネル外のピクセルは
   * 壁と完全一致するため、焼き込みタイルが壁バリアントと共有される。
   */
  function sampleDoorTexel(textures, u, v) {
    const uf = fractional(u);
    if (uf >= DOOR_PANEL_U0 && uf <= DOOR_PANEL_U1 && v >= DOOR_PANEL_V0) {
      const pu = (uf - DOOR_PANEL_U0) / (DOOR_PANEL_U1 - DOOR_PANEL_U0);
      const pv = (v - DOOR_PANEL_V0) / (1 - DOOR_PANEL_V0);
      return sampleTexel(textures.door, pu, pv);
    }
    return sampleTexel(textures.wall, u, v);
  }

  function quantizeShade(shade) {
    return Math.round(shade * SHADE_QUANT) / SHADE_QUANT;
  }

  /*
   * エッジ 1 枚の壁クアッドをラスタライズし、カバーするピクセルごとに
   * plot(pixelIndex, depth, u, v, shade) を呼ぶ。plot 側が z 比較・書き込みを
   * 行うことで「ソロバッファへの記録」と「直接合成」を同一コードにする。
   */
  function rasterizeEdge(pose, def, scissor, plot) {
    const shadeBase = edgeFaceShade(pose, def);
    const world = edgeWorldQuad(def);
    const clipped = clipCameraPolygon(world.map((point) => toCameraPoint(pose, point)));
    if (clipped.length < 3) return;
    const projected = clipped.map(projectCameraPoint).filter(Boolean);
    if (projected.length < 3) return;
    const x0 = scissor ? scissor.x0 : 0;
    const y0 = scissor ? scissor.y0 : 0;
    const x1 = scissor ? scissor.x1 : VIEW_W - 1;
    const y1 = scissor ? scissor.y1 : VIEW_H - 1;
    for (let i = 1; i < projected.length - 1; i++) {
      rasterizeTriangle(projected[0], projected[i], projected[i + 1], shadeBase, x0, y0, x1, y1, plot);
    }
  }

  function rasterizeTriangle(a, b, c, shadeBase, sx0, sy0, sx1, sy1, plot) {
    const area = edgeFunction(a, b, c.x, c.y);
    if (Math.abs(area) < 0.0001) return;
    const minX = Math.max(sx0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(sx1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(sy0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(sy1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;
        const w0 = edgeFunction(b, c, sampleX, sampleY) / area;
        const w1 = edgeFunction(c, a, sampleX, sampleY) / area;
        const w2 = edgeFunction(a, b, sampleX, sampleY) / area;
        if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
        const invZ = (a.invZ * w0) + (b.invZ * w1) + (c.invZ * w2);
        const depth = 1 / invZ;
        const u = ((a.uOverZ * w0) + (b.uOverZ * w1) + (c.uOverZ * w2)) / invZ;
        const v = ((a.vOverZ * w0) + (b.vOverZ * w1) + (c.vOverZ * w2)) / invZ;
        const shade = quantizeShade(Math.max(WALL_SHADE_FLOOR, shadeBase / (1 + depth * WALL_SHADE_FALLOFF)));
        plot((py * VIEW_W) + px, depth, u, v, shade);
      }
    }
  }

  /* ------------------------------------------------------------------
   * エッジ定義・列挙・状態サンプリング
   * ------------------------------------------------------------------ */

  function edgeKey(def) {
    return `${def.face}:${def.dd}:${def.dl}`;
  }

  function mirrorEdgeDef(def) {
    if (def.face === 0) return { dd: def.dd, dl: -def.dl, face: 0 };
    return { dd: def.dd, dl: -def.dl - 1, face: 1 };
  }

  function lateralLimit(depth) {
    return depth <= 1 ? 1 : 2;
  }

  function baseWindowCells() {
    const cells = [];
    for (let d = 0; d <= VIEW_DEPTH_CELLS; d++) {
      const cap = lateralLimit(d);
      for (let l = -cap; l <= cap; l++) cells.push({ dd: d, dl: l });
    }
    return cells;
  }

  function candidateCellsMove() {
    const map = new Map();
    baseWindowCells().forEach((cell) => {
      map.set(`${cell.dd}:${cell.dl}`, cell);
      const shifted = { dd: cell.dd + 1, dl: cell.dl };
      map.set(`${shifted.dd}:${shifted.dl}`, shifted);
    });
    return Array.from(map.values());
  }

  function candidateCellsTurn() {
    const map = new Map();
    baseWindowCells().forEach((cell) => {
      map.set(`${cell.dd}:${cell.dl}`, cell);
      /* 右90°回転後の窓: 終端フレーム座標 (d', l') → 開始フレーム (d=-l', l=d') */
      const rotated = { dd: -cell.dl, dl: cell.dd };
      map.set(`${rotated.dd}:${rotated.dl}`, rotated);
    });
    return Array.from(map.values());
  }

  function edgesOfCells(cells) {
    const map = new Map();
    cells.forEach((cell) => {
      [
        { dd: cell.dd, dl: cell.dl, face: 0 },
        { dd: cell.dd - 1, dl: cell.dl, face: 0 },
        { dd: cell.dd, dl: cell.dl, face: 1 },
        { dd: cell.dd, dl: cell.dl - 1, face: 1 },
      ].forEach((def) => {
        map.set(edgeKey(def), def);
      });
    });
    return Array.from(map.values());
  }

  function edgeTouchesView(pose, def) {
    let touched = false;
    rasterizeEdge(pose, def, null, () => {
      touched = true;
    });
    return touched;
  }

  function enumerateEdges(poses, candidates, limit, label) {
    const defs = candidates
      .filter((def) => poses.some((pose) => edgeTouchesView(pose, def)))
      .sort((a, b) => a.face - b.face || a.dd - b.dd || a.dl - b.dl);
    if (defs.length > limit) {
      throw new Error(`dungeon edge set overflow (${label}): ${defs.length} > ${limit}`);
    }
    return defs;
  }

  function buildEdgeSpaces(settings) {
    const frames = buildFrames(settings);
    const movePoses = [frames.staticPose, ...frames.fwdPoses, poseForward(1)];
    const turnPoses = [frames.staticPose, ...frames.turnPoses, poseTurnRight(1)];
    const move = enumerateEdges(movePoses, edgesOfCells(candidateCellsMove()), MOVE_EDGE_LIMIT, 'move');
    const turn = enumerateEdges(turnPoses, edgesOfCells(candidateCellsTurn()), TURN_EDGE_LIMIT, 'turn');
    const turnMirrored = turn.map(mirrorEdgeDef);
    return { frames, move, turn, turnMirrored };
  }

  /*
   * フロアデータから各エッジの状態 (0=開/1=壁/2=扉) を読み取る。
   * player (x, y, dirIndex 0..3=N/E/S/W) から見た相対エッジ defs を評価する。
   * MD エンジン側 (dungeon_view.c) の evaluateEdgeStates と同一仕様。
   */
  function sampleEdgeStates(floor, x, y, dirIndex, defs, out) {
    const dir = dirIndex & 3;
    const rightDir = (dir + 1) & 3;
    const states = out || new Uint8Array(defs.length);
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const ax = x + def.dd * DIR_DX[dir] + def.dl * DIR_DX[rightDir];
      const ay = y + def.dd * DIR_DY[dir] + def.dl * DIR_DY[rightDir];
      const crossDir = def.face === 0 ? dir : rightDir;
      states[i] = edgeStateBetween(floor, ax, ay, crossDir);
    }
    return states;
  }

  function cellInBounds(floor, x, y) {
    return x >= 0 && y >= 0 && x < floor.width && y < floor.height;
  }

  function edgeStateBetween(floor, x, y, crossDir) {
    const nx = x + DIR_DX[crossDir];
    const ny = y + DIR_DY[crossDir];
    const opposite = (crossDir + 2) & 3;
    const bit = EDGE_BITS[crossDir];
    const oppositeBit = EDGE_BITS[opposite];
    const aIn = cellInBounds(floor, x, y);
    const bIn = cellInBounds(floor, nx, ny);
    const cellA = aIn ? floor.cells[y][x] : null;
    const cellB = bIn ? floor.cells[ny][nx] : null;
    const door = (cellA && (cellA.doors & bit)) || (cellB && (cellB.doors & oppositeBit));
    if (door) return EDGE_STATE_DOOR;
    const wall = !aIn || !bIn || (cellA.walls & bit) || (cellB.walls & oppositeBit);
    return wall ? EDGE_STATE_WALL : EDGE_STATE_OPEN;
  }

  /* ------------------------------------------------------------------
   * 直接レンダリング (プレビュー用 / 焼き込み検証のリファレンス)
   * ------------------------------------------------------------------ */

  function renderView(pose, defs, states, texturesInput, palette, bandRows, out) {
    const textures = normalizeTextures(texturesInput);
    const pixels = out || new Uint8Array(VIEW_W * VIEW_H);
    for (let y = 0; y < VIEW_H; y++) {
      pixels.fill(bandRows[y], y * VIEW_W, (y + 1) * VIEW_W);
    }
    const zBuffer = new Float32Array(VIEW_W * VIEW_H);
    zBuffer.fill(Number.POSITIVE_INFINITY);
    for (let i = 0; i < defs.length; i++) {
      const state = states[i];
      if (state === EDGE_STATE_OPEN) continue;
      const isDoor = state === EDGE_STATE_DOOR;
      rasterizeEdge(pose, defs[i], null, (p, depth, u, v, shade) => {
        if (depth > zBuffer[p] + VIEW_DEPTH_EPSILON) return;
        const texel = isDoor ? sampleDoorTexel(textures, u, v) : sampleTexel(textures.wall, u, v);
        pixels[p] = nearestPalette(palette, texel.r * shade, texel.g * shade, texel.b * shade);
        zBuffer[p] = Math.min(zBuffer[p], depth);
      });
    }
    return pixels;
  }

  /* ------------------------------------------------------------------
   * デシジョンテーブル焼き込み
   * ------------------------------------------------------------------ */

  function renderEdgeSolo(pose, def, textures, palette) {
    const z = new Float32Array(VIEW_W * VIEW_H);
    const wall = new Uint8Array(VIEW_W * VIEW_H);
    const door = new Uint8Array(VIEW_W * VIEW_H);
    const cover = new Uint8Array(VIEW_W * VIEW_H);
    z.fill(Number.POSITIVE_INFINITY);
    rasterizeEdge(pose, def, null, (p, depth, u, v, shade) => {
      if (depth > z[p] + VIEW_DEPTH_EPSILON) return;
      const wallTexel = sampleTexel(textures.wall, u, v);
      const doorTexel = sampleDoorTexel(textures, u, v);
      wall[p] = nearestPalette(palette, wallTexel.r * shade, wallTexel.g * shade, wallTexel.b * shade);
      door[p] = nearestPalette(palette, doorTexel.r * shade, doorTexel.g * shade, doorTexel.b * shade);
      cover[p] = 1;
      z[p] = Math.min(z[p], depth);
    });
    return { z, wall, door, cover };
  }

  function soloTileStats(solo) {
    const tileCount = VIEW_TILE_W * VIEW_TILE_H;
    const count = new Uint16Array(tileCount);
    const minZ = new Float32Array(tileCount);
    const maxZ = new Float32Array(tileCount);
    minZ.fill(Number.POSITIVE_INFINITY);
    for (let ty = 0; ty < VIEW_TILE_H; ty++) {
      for (let tx = 0; tx < VIEW_TILE_W; tx++) {
        const tile = (ty * VIEW_TILE_W) + tx;
        for (let py = 0; py < 8; py++) {
          const rowStart = (((ty * 8) + py) * VIEW_W) + (tx * 8);
          for (let px = 0; px < 8; px++) {
            const p = rowStart + px;
            if (!solo.cover[p]) continue;
            count[tile]++;
            if (solo.z[p] < minZ[tile]) minZ[tile] = solo.z[p];
            if (solo.z[p] > maxZ[tile]) maxZ[tile] = solo.z[p];
          }
        }
      }
    }
    return { count, minZ, maxZ };
  }

  function tileRowsFromPixels(pixels, tx, ty) {
    const rows = [];
    for (let py = 0; py < 8; py++) {
      let row = 0;
      const rowStart = (((ty * 8) + py) * VIEW_W) + (tx * 8);
      for (let px = 0; px < 8; px++) {
        row = ((row << 4) | (pixels[rowStart + px] & 15)) >>> 0;
      }
      rows.push(row >>> 0);
    }
    return rows;
  }

  function tileRowsKey(rows) {
    return rows.map((row) => row.toString(16).padStart(8, '0')).join(',');
  }

  function hflipTileRows(rows) {
    return rows.map((row) => {
      let out = 0;
      for (let px = 0; px < 8; px++) {
        out = ((out << 4) | ((row >>> (px * 4)) & 15)) >>> 0;
      }
      return out >>> 0;
    });
  }

  function vflipTileRows(rows) {
    return rows.slice().reverse();
  }

  /*
   * タイルプール: H/V フリップで一致するタイルは正規形 1 枚に集約する。
   * add() は { index, flips } を返す (flips: bit0=H, bit1=V)。
   * MD 側はタイルマップ属性の HFLIP/VFLIP で復元する。
   */
  function makeTilePool() {
    const rows = [];
    const lookup = new Map();
    return {
      rows,
      add(tileRows) {
        const variants = [
          { rows: tileRows, flips: 0 },
          { rows: hflipTileRows(tileRows), flips: 1 },
          { rows: vflipTileRows(tileRows), flips: 2 },
          { rows: vflipTileRows(hflipTileRows(tileRows)), flips: 3 },
        ];
        for (const variant of variants) {
          const found = lookup.get(tileRowsKey(variant.rows));
          if (found != null) return { index: found, flips: variant.flips };
        }
        const index = rows.length;
        if (index >= 0xffff) {
          throw new Error('dungeon tile pool overflow: > 65534');
        }
        rows.push(tileRows);
        lookup.set(tileRowsKey(tileRows), index);
        return { index, flips: 0 };
      },
      get count() {
        return rows.length;
      },
    };
  }

  function bakeFrame(pose, defs, texturesInput, palette, bandRows, tilePool, options) {
    const textures = normalizeTextures(texturesInput);
    const debug = Boolean(options && options.debug);
    const solos = defs.map((def) => renderEdgeSolo(pose, def, textures, palette));
    const stats = solos.map(soloTileStats);
    const tileCount = VIEW_TILE_W * VIEW_TILE_H;
    const offsets = new Uint16Array(tileCount);
    const nodes = [];
    const nodeIntern = new Map();
    const frameStats = { leafRenders: 0, droppedEdges: 0, nodeWords: 0 };
    const debugInvolved = debug ? [] : null;
    const leafPixels = new Uint8Array(64);
    const leafZ = new Float32Array(64);
    /* フレームローカルなタイルID → グローバルタイル {index, flips} の対応表 */
    const tileMap = [];
    const localLookup = new Map();
    const localTileId = (globalRef) => {
      const key = `${globalRef.index}:${globalRef.flips}`;
      let local = localLookup.get(key);
      if (local == null) {
        local = tileMap.length;
        if (local > TILE_INDEX_LIMIT) throw new Error('dungeon frame tile map overflow');
        tileMap.push(globalRef);
        localLookup.set(key, local);
      }
      return local;
    };

    const internNode = (edgeId, c0, c1, c2) => {
      const key = `${edgeId},${c0},${c1},${c2}`;
      let ref = nodeIntern.get(key);
      if (ref == null) {
        ref = nodes.length;
        if (ref + 4 > 0x8000) throw new Error('dungeon decision stream overflow');
        nodes.push(edgeId, c0, c1, c2);
        nodeIntern.set(key, ref);
      }
      return ref;
    };

    const renderLeaf = (tile, involved, chosen) => {
      frameStats.leafRenders++;
      const tx = tile % VIEW_TILE_W;
      const ty = Math.floor(tile / VIEW_TILE_W);
      const band = bandRows;
      for (let py = 0; py < 8; py++) {
        const rowValue = band[(ty * 8) + py];
        for (let px = 0; px < 8; px++) {
          leafPixels[(py * 8) + px] = rowValue;
          leafZ[(py * 8) + px] = Number.POSITIVE_INFINITY;
        }
      }
      /* defs の並び順で合成する (renderView と同一の順序規則) */
      const ordered = involved
        .map((entry, position) => ({ entry, state: chosen[position] }))
        .filter((item) => item.state > EDGE_STATE_OPEN)
        .sort((a, b) => a.entry.defIndex - b.entry.defIndex);
      ordered.forEach(({ entry, state }) => {
        const solo = solos[entry.defIndex];
        /* 遠方の扉は壁と同一視 (パネルが視認できないため分岐を潰して共有) */
        const useDoor = state === EDGE_STATE_DOOR && entry.minZ <= DOOR_DETAIL_DEPTH;
        const source = useDoor ? solo.door : solo.wall;
        for (let py = 0; py < 8; py++) {
          const rowStart = (((ty * 8) + py) * VIEW_W) + (tx * 8);
          for (let px = 0; px < 8; px++) {
            const p = rowStart + px;
            if (!solo.cover[p]) continue;
            const local = (py * 8) + px;
            if (solo.z[p] > leafZ[local] + VIEW_DEPTH_EPSILON) continue;
            leafPixels[local] = source[p];
            leafZ[local] = Math.min(leafZ[local], solo.z[p]);
          }
        }
      });
      const rows = [];
      for (let py = 0; py < 8; py++) {
        let row = 0;
        for (let px = 0; px < 8; px++) {
          row = ((row << 4) | (leafPixels[(py * 8) + px] & 15)) >>> 0;
        }
        rows.push(row >>> 0);
      }
      return LEAF_FLAG | localTileId(tilePool.add(rows));
    };

    for (let tile = 0; tile < tileCount; tile++) {
      let involved = [];
      for (let defIndex = 0; defIndex < defs.length; defIndex++) {
        const stat = stats[defIndex];
        if (!stat.count[tile]) continue;
        involved.push({
          defIndex,
          count: stat.count[tile],
          minZ: stat.minZ[tile],
          maxZ: stat.maxZ[tile],
          full: stat.count[tile] === 64,
        });
      }
      /* 遠距離の極小カバーは切り捨て (実機出力とプレビューの差は 1-2px 未満) */
      const kept = involved.filter((entry) => entry.count >= TILE_DROP_MIN_COVER || entry.minZ <= TILE_DROP_MIN_DEPTH);
      frameStats.droppedEdges += involved.length - kept.length;
      involved = kept.sort((a, b) => a.minZ - b.minZ || a.defIndex - b.defIndex);
      /*
       * 分岐爆発 (3^k) を防ぐため部分カバーのエッジ数に上限を設ける。
       * 全面カバーのエッジは遮蔽枝刈りで木が連鎖するため無制限に許容し、
       * かつ「手前が全開のとき唯一タイルを描く背景壁」になり得るので
       * 決して捨てない。部分カバーは遠いものから捨てる。
       */
      const partials = involved.filter((entry) => !entry.full);
      if (partials.length > TILE_PARTIAL_CAP) {
        /* 超過分は被覆ピクセルが最小のものから捨てる (最大誤差 = そのピクセル数) */
        const removable = partials.sort((a, b) => a.count - b.count || b.minZ - a.minZ);
        const toRemove = new Set(removable.slice(0, partials.length - TILE_PARTIAL_CAP));
        frameStats.droppedEdges += toRemove.size;
        involved = involved.filter((entry) => !toRemove.has(entry));
      }
      if (debugInvolved) debugInvolved.push(involved.map((entry) => ({ ...entry })));

      const chosen = new Uint8Array(involved.length);
      const build = (index) => {
        if (index >= involved.length) return renderLeaf(tile, involved, chosen);
        const entry = involved[index];
        let occludesRest = entry.full;
        if (occludesRest) {
          for (let rest = index + 1; rest < involved.length; rest++) {
            if (entry.maxZ > involved[rest].minZ + 0.0001) {
              occludesRest = false;
              break;
            }
          }
        }
        const children = [];
        for (let state = 0; state <= 2; state++) {
          chosen[index] = state;
          if (state > EDGE_STATE_OPEN && occludesRest) {
            /* このエッジがタイル全体を覆い残りは全て背後 → 打ち切り */
            const saved = chosen.slice(index + 1);
            chosen.fill(EDGE_STATE_OPEN, index + 1);
            children.push(renderLeaf(tile, involved, chosen));
            chosen.set(saved, index + 1);
          } else {
            children.push(build(index + 1));
          }
        }
        chosen[index] = EDGE_STATE_OPEN;
        if (children[0] === children[1] && children[1] === children[2]) return children[0];
        return internNode(involved[index].defIndex, children[0], children[1], children[2]);
      };
      offsets[tile] = build(0);
    }

    frameStats.nodeWords = nodes.length;
    frameStats.localTiles = tileMap.length;
    const result = {
      offsets,
      nodes: Uint16Array.from(nodes),
      tileMap,
      stats: frameStats,
    };
    if (debug) {
      result.debug = { solos, involved: debugInvolved };
    }
    return result;
  }

  /* MD エンジンと同じ手順でデシジョンテーブルからフレームローカルIDを解決する */
  function composeFromFrame(frame, states, out) {
    const tileCount = VIEW_TILE_W * VIEW_TILE_H;
    const tiles = out || new Uint16Array(tileCount);
    for (let tile = 0; tile < tileCount; tile++) {
      let ref = frame.offsets[tile];
      while (!(ref & LEAF_FLAG)) {
        const state = states[frame.nodes[ref]];
        ref = frame.nodes[ref + 1 + state];
      }
      tiles[tile] = ref & TILE_INDEX_LIMIT;
    }
    return tiles;
  }

  function tileRowsWithFlips(tilePool, ref) {
    let rows = tilePool.rows[ref.index] || [0, 0, 0, 0, 0, 0, 0, 0];
    if (ref.flips & 1) rows = hflipTileRows(rows);
    if (ref.flips & 2) rows = vflipTileRows(rows);
    return rows;
  }

  /* composeFromFrame のローカルIDを frame.tileMap 経由で実ピクセルへ展開する */
  function assembleTiles(frame, localTiles, tilePool, out) {
    const pixels = out || new Uint8Array(VIEW_W * VIEW_H);
    for (let ty = 0; ty < VIEW_TILE_H; ty++) {
      for (let tx = 0; tx < VIEW_TILE_W; tx++) {
        const ref = frame.tileMap[localTiles[(ty * VIEW_TILE_W) + tx]] || { index: -1, flips: 0 };
        const rows = tileRowsWithFlips(tilePool, ref);
        for (let py = 0; py < 8; py++) {
          const row = rows[py];
          const rowStart = (((ty * 8) + py) * VIEW_W) + (tx * 8);
          for (let px = 0; px < 8; px++) {
            pixels[rowStart + px] = (row >>> ((7 - px) * 4)) & 15;
          }
        }
      }
    }
    return pixels;
  }

  /* ------------------------------------------------------------------
   * ビルボード (宝箱・階段) — スプライトシートと座標テーブル
   * ------------------------------------------------------------------ */

  function buildBillboardCells() {
    const map = new Map();
    candidateCellsMove().concat(candidateCellsTurn()).forEach((cell) => {
      map.set(`${cell.dd}:${cell.dl}`, cell);
    });
    return Array.from(map.values()).sort((a, b) => a.dd - b.dd || a.dl - b.dl);
  }

  function billboardPose(pose, cell) {
    const cam = toCameraPoint(pose, { l: cell.dl, d: cell.dd, z: 0, u: 0, v: 0 });
    if (cam.z < BB_MIN_DEPTH) return { x: 0, y: 0, frame: -1 };
    const height = (BB_WORLD_HEIGHT * VIEW_PROJECT) / cam.z;
    if (height < BB_MIN_HEIGHT || height > BB_MAX_HEIGHT) return { x: 0, y: 0, frame: -1 };
    let frame = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    BB_BUCKET_HEIGHTS.forEach((bucket, index) => {
      const diff = Math.abs(bucket - height);
      if (diff < bestDiff) {
        bestDiff = diff;
        frame = index;
      }
    });
    const screenX = (VIEW_W / 2) + ((cam.x * VIEW_PROJECT) / cam.z);
    const bottomY = VIEW_HORIZON + ((VIEW_EYE_Z * VIEW_PROJECT) / cam.z);
    const x = Math.round(screenX) - (BB_FRAME_SIZE / 2);
    const y = Math.round(bottomY) - BB_FRAME_SIZE;
    if (x + BB_FRAME_SIZE <= 0 || x >= VIEW_W || y + BB_FRAME_SIZE <= 0 || y >= VIEW_H) {
      return { x: 0, y: 0, frame: -1 };
    }
    return { x, y, frame };
  }

  function buildBillboardTables(settings) {
    const frames = buildFrames(settings);
    const cells = buildBillboardCells();
    const forPose = (pose) => cells.map((cell) => billboardPose(pose, cell));
    return {
      cells,
      staticPoses: forPose(frames.staticPose),
      fwdPoses: frames.fwdPoses.map(forPose),
      turnPoses: frames.turnPoses.map(forPose),
    };
  }

  function billboardBucketDepth(height) {
    return (BB_WORLD_HEIGHT * VIEW_PROJECT) / height;
  }

  function renderBillboardSheet(texture, palette) {
    const sheetW = BB_FRAME_SIZE * BB_BUCKET_HEIGHTS.length;
    const pixels = new Uint8Array(sheetW * BB_FRAME_SIZE);
    BB_BUCKET_HEIGHTS.forEach((height, frame) => {
      const depth = billboardBucketDepth(height);
      const shade = Math.max(0.3, 0.95 / (1 + depth * 0.1));
      const size = height;
      const originX = (frame * BB_FRAME_SIZE) + Math.floor((BB_FRAME_SIZE - size) / 2);
      const originY = BB_FRAME_SIZE - size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sx = Math.min(texture.width - 1, Math.floor((x / size) * texture.width));
          const sy = Math.min(texture.height - 1, Math.floor((y / size) * texture.height));
          const i = ((sy * texture.width) + sx) * 4;
          if (texture.data[i + 3] < 16) continue;
          if (texture.data[i] > 240 && texture.data[i + 1] < 16 && texture.data[i + 2] > 240) continue;
          const dest = ((originY + y) * sheetW) + originX + x;
          pixels[dest] = nearestPalette(
            palette,
            texture.data[i] * shade,
            texture.data[i + 1] * shade,
            texture.data[i + 2] * shade,
          );
        }
      }
    });
    return { width: sheetW, height: BB_FRAME_SIZE, pixels };
  }

  /*
   * 簡易 LOS: 前進→横移動 または 横移動→前進 のどちらかの経路が
   * 壁・扉に遮られなければ可視。MD エンジン側と同一仕様。
   */
  function losVisible(floor, x, y, dirIndex, dd, dl) {
    if (dd === 0 && dl === 0) return true;
    return losPathClear(floor, x, y, dirIndex, dd, dl, true)
      || losPathClear(floor, x, y, dirIndex, dd, dl, false);
  }

  function losPathClear(floor, x, y, dirIndex, dd, dl, depthFirst) {
    const dir = dirIndex & 3;
    const rightDir = (dir + 1) & 3;
    let cx = x;
    let cy = y;
    const stepDepth = () => {
      const sign = dd >= 0 ? 1 : -1;
      const crossDir = sign > 0 ? dir : (dir + 2) & 3;
      for (let i = 0; i < Math.abs(dd); i++) {
        if (edgeStateBetween(floor, cx, cy, crossDir) !== EDGE_STATE_OPEN) return false;
        cx += DIR_DX[crossDir];
        cy += DIR_DY[crossDir];
      }
      return true;
    };
    const stepLateral = () => {
      const sign = dl >= 0 ? 1 : -1;
      const crossDir = sign > 0 ? rightDir : (rightDir + 2) & 3;
      for (let i = 0; i < Math.abs(dl); i++) {
        if (edgeStateBetween(floor, cx, cy, crossDir) !== EDGE_STATE_OPEN) return false;
        cx += DIR_DX[crossDir];
        cy += DIR_DY[crossDir];
      }
      return true;
    };
    if (depthFirst) return stepDepth() && stepLateral();
    return stepLateral() && stepDepth();
  }

  /* ------------------------------------------------------------------
   * 補助: パレット変換
   * ------------------------------------------------------------------ */

  function indicesToRgba(indices, palette, out) {
    const rgba = out || new Uint8ClampedArray(indices.length * 4);
    for (let i = 0; i < indices.length; i++) {
      const color = palette[indices[i]] || palette[0];
      const dest = i * 4;
      rgba[dest] = color.r;
      rgba[dest + 1] = color.g;
      rgba[dest + 2] = color.b;
      rgba[dest + 3] = 255;
    }
    return rgba;
  }

  function darkenPalette(palette, factor) {
    const scale = typeof factor === 'number' ? factor : 0.35;
    return palette.map((color, index) => {
      if (index === 0) return { ...color };
      const r = Math.round(color.r * scale);
      const g = Math.round(color.g * scale);
      const b = Math.round(color.b * scale);
      return { value: ((r << 16) | (g << 8) | b) >>> 0, r, g, b };
    });
  }

  function paletteToVdpColors(palette) {
    return palette.map((color) => {
      const r = Math.round(color.r / 36) & 7;
      const g = Math.round(color.g / 36) & 7;
      const b = Math.round(color.b / 36) & 7;
      return ((b << 9) | (g << 5) | (r << 1)) & 0x0eee;
    });
  }

  const core = {
    version: '2.0.0',
    VIEW_W,
    VIEW_H,
    VIEW_TILE_W,
    VIEW_TILE_H,
    VIEW_HORIZON,
    VIEW_PROJECT,
    VIEW_EYE_Z,
    VIEW_NEAR_CLIP,
    VIEW_CAMERA_BACKSTEP,
    VIEW_DEPTH_EPSILON,
    VIEW_DEPTH_CELLS,
    EDGE_STATE_OPEN,
    EDGE_STATE_WALL,
    EDGE_STATE_DOOR,
    MOVE_EDGE_LIMIT,
    TURN_EDGE_LIMIT,
    LEAF_FLAG,
    TILE_INDEX_LIMIT,
    BB_FRAME_SIZE,
    BB_FRAME_TILES,
    BB_BUCKET_HEIGHTS,
    TEXTURE_KINDS,
    ATLAS_LAYOUT_LEGACY,
    ATLAS_LAYOUT_DOOR,
    atlasLayoutFor,
    makeFallbackTexture,
    normalizeTextures,
    buildViewPalette,
    buildSpritePalette,
    buildBandTables,
    buildBackground,
    nearestPalette,
    easeSmooth,
    poseStatic,
    poseForward,
    poseTurnRight,
    buildFrames,
    buildEdgeSpaces,
    mirrorEdgeDef,
    lateralLimit,
    sampleEdgeStates,
    edgeStateBetween,
    renderView,
    bakeFrame,
    makeTilePool,
    composeFromFrame,
    assembleTiles,
    tileRowsFromPixels,
    tileRowsKey,
    hflipTileRows,
    vflipTileRows,
    tileRowsWithFlips,
    buildBillboardCells,
    billboardPose,
    buildBillboardTables,
    renderBillboardSheet,
    losVisible,
    indicesToRgba,
    darkenPalette,
    paletteToVdpColors,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.DungeonRenderCore = core;
  }
})();
