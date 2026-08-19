export const ENEMY_FIRE_PATTERNS = Object.freeze(['none', 'cycle', 'aimed', 'spread']);

export const BOSS_FIRE_PATTERNS = Object.freeze([
  'aimed', 'fan', 'wall', 'spiral', 'lance', 'lure', 'cross', 'web', 'core',
]);

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function backgroundSourceX(playhead, imageWidth, viewportWidth = 320, parallaxShift = 0) {
  const width = Math.max(viewportWidth, Number(imageWidth) || viewportWidth);
  const shift = clamp(Math.trunc(parallaxShift), 0, 7);
  const camera = Math.max(0, Math.trunc(Number(playhead) || 0)) >> shift;
  return clamp(camera, 0, width - viewportWidth);
}

export function eventReferenceKey(command) {
  if (command === 'spawn_enemy') return 'enemy_id';
  if (command === 'spawn_item') return 'item_id';
  if (command === 'start_boss') return 'boss_id';
  return '';
}

export function simulateSpawnPosition(event, definition, playhead, scrollSpeed256) {
  const triggerAt = Number(event?.trigger?.at) || 0;
  const camera = Number(playhead) || 0;
  const scrollPerFrame = Math.max(1 / 256, (Number(scrollSpeed256) || 256) / 256);
  const ageFrames = Math.max(0, (camera - triggerAt) / scrollPerFrame);
  const baseX = Number(event?.payload?.x ?? 336);
  const baseY = Number(event?.payload?.y ?? 112);
  const vx = (Number(definition?.vx256) || -256) / 256;
  const vy = (Number(definition?.vy256) || 0) / 256;
  let x = baseX + (vx * ageFrames);
  let y = baseY + (vy * ageFrames);
  const behavior = String(definition?.behavior || 'straight');
  if (behavior === 'sine') y += Math.sin(ageFrames / 13) * 22;
  else if (behavior === 'zigzag') y += ((Math.floor(ageFrames / 30) & 1) ? 1 : -1) * (ageFrames % 30) * 0.6;
  else if (behavior === 'hover') y += Math.sin(ageFrames / 24) * 10;
  else if (behavior === 'dive') y += Math.sin(Math.min(1, ageFrames / 100) * Math.PI) * 48;
  else if (behavior === 'anchor') x = baseX + Math.max(-42, vx * ageFrames);
  return { x, y, ageFrames };
}

function radial(count, start, span, speed) {
  if (count <= 1) return [{ vx: -speed, vy: 0 }];
  return Array.from({ length: count }, (_, index) => {
    const angle = start + ((span * index) / (count - 1));
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  });
}

export function bulletVectors(pattern, phase = 0, kind = 'enemy') {
  const id = String(pattern || (kind === 'boss' ? 'aimed' : 'none')).toLowerCase();
  const spin = Number(phase) || 0;
  if (id === 'none') return [];
  if (id === 'aimed') return radial(1, Math.PI, 0, 2.2);
  if (id === 'cycle') return radial(1, Math.PI + (Math.sin(spin) * 0.62), 0, 2.0);
  if (id === 'spread') return radial(3, Math.PI - 0.46, 0.92, 2.0);
  if (id === 'fan') return radial(7, Math.PI - 0.76, 1.52, 2.0);
  if (id === 'wall') return radial(9, Math.PI - 0.22, 0.44, 1.75);
  if (id === 'spiral') return radial(4, spin, Math.PI * 1.5, 2.0);
  if (id === 'lance') return [
    { vx: -3.0, vy: 0 }, { vx: -2.6, vy: -0.16 }, { vx: -2.6, vy: 0.16 },
  ];
  if (id === 'lure') return radial(5, Math.PI - 0.38 + (Math.sin(spin) * 0.25), 0.76, 1.8);
  if (id === 'cross') return [
    { vx: -2.2, vy: 0 }, { vx: 2.2, vy: 0 }, { vx: 0, vy: -2.2 }, { vx: 0, vy: 2.2 },
  ];
  if (id === 'web') return radial(12, 0, Math.PI * 2, 1.6);
  if (id === 'core') {
    return [
      ...radial(8, spin, Math.PI * 2, 1.55),
      ...radial(8, -spin * 0.7 + 0.28, Math.PI * 2, 2.25),
    ];
  }
  return radial(1, Math.PI, 0, 2.0);
}

function hashTile(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function collectUniqueTiles(imageData, tileSize = 8, limit = 768) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const source = imageData?.data;
  if (!source || width < tileSize || height < tileSize) return [];
  const byHash = new Map();
  for (let top = 0; top + tileSize <= height; top += tileSize) {
    for (let left = 0; left + tileSize <= width; left += tileSize) {
      const bytes = new Uint8ClampedArray(tileSize * tileSize * 4);
      let offset = 0;
      for (let y = 0; y < tileSize; y += 1) {
        const start = (((top + y) * width) + left) * 4;
        bytes.set(source.subarray(start, start + (tileSize * 4)), offset);
        offset += tileSize * 4;
      }
      const hash = hashTile(bytes);
      let duplicate = false;
      const candidates = byHash.get(hash) || [];
      for (const candidate of candidates) {
        duplicate = candidate.data.every((value, index) => value === bytes[index]);
        if (duplicate) break;
      }
      if (!duplicate) {
        const tile = { x: left, y: top, data: bytes, hash };
        candidates.push(tile);
        byHash.set(hash, candidates);
        if (Array.from(byHash.values()).reduce((sum, entries) => sum + entries.length, 0) >= limit) {
          return Array.from(byHash.values()).flat();
        }
      }
    }
  }
  return Array.from(byHash.values()).flat();
}

export function eventMarkerPercent(event, stageLength) {
  const length = Math.max(1, Number(stageLength) || 1);
  return clamp(((Number(event?.trigger?.at) || 0) / length) * 100, 0, 100);
}
