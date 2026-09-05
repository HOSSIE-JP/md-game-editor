'use strict';

const TRIG_Q14 = Object.freeze(Array.from({ length: 1024 }, (_, index) => Math.round(Math.sin(index * Math.PI * 2 / 1024) * 16384)));

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

function interpolationRatio(kind, value) {
  const ratio = clamp(value, 0, 1);
  if (kind === 'step') return ratio >= 1 ? 1 : 0;
  if (kind === 'smoothstep') return ratio * ratio * (3 - 2 * ratio);
  return ratio;
}

function movementPoint(movement, age) {
  const points = movement?.waypoints || [];
  if (!points.length) return null;
  if (points.length === 1) return { x: Number(points[0].x) || 0, y: Number(points[0].y) || 0 };
  const total = points.slice(1).reduce((sum, point) => sum + Math.max(1, Math.trunc(Number(point.durationFrames) || 0)), 0);
  let elapsed = Math.max(0, Math.trunc(Number(age) || 0));
  if (movement.loop && total > 0) elapsed %= total;
  for (let index = 1, start = 0; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const duration = Math.max(1, Math.trunc(Number(next.durationFrames) || 0));
    if (elapsed <= start + duration) {
      const ratio = interpolationRatio(next.interpolation, (elapsed - start) / duration);
      return { x: Number(previous.x) + (Number(next.x) - Number(previous.x)) * ratio, y: Number(previous.y) + (Number(next.y) - Number(previous.y)) * ratio };
    }
    start += duration;
  }
  return { x: Number(points.at(-1).x) || 0, y: Number(points.at(-1).y) || 0 };
}

function pathPoint(points, age, orientation = 'vertical') {
  if (!Array.isArray(points) || !points.length) return orientation === 'horizontal' ? { x: 288, y: 112 } : { x: 160, y: 28 };
  if (age <= Number(points[0].frame || 0)) return { x: Number(points[0].x), y: Number(points[0].y) };
  for (let index = 1; index < points.length; index += 1) {
    if (age <= Number(points[index].frame || 0)) {
      const previous = points[index - 1];
      const next = points[index];
      const duration = Math.max(1, Number(next.frame || 0) - Number(previous.frame || 0));
      const ratio = interpolationRatio(next.interpolation, (age - Number(previous.frame || 0)) / duration);
      return { x: Number(previous.x) + (Number(next.x) - Number(previous.x)) * ratio, y: Number(previous.y) + (Number(next.y) - Number(previous.y)) * ratio };
    }
  }
  return { x: Number(points.at(-1).x), y: Number(points.at(-1).y) };
}

function waveOffset(wave, coordinate, frame, seed = 0, startFrame = 0) {
  void seed;
  const preset = wave?.preset || 'none';
  if (preset === 'none' || coordinate < Number(wave.start || 0) || coordinate > Number(wave.end ?? 319)) return 0;
  const fadeFrames = Math.max(0, Math.trunc(Number(wave.fadeFrames) || 0));
  const age = Math.max(0, Math.trunc(Number(frame) || 0) - Math.trunc(Number(startFrame) || 0));
  const fadeQ8 = fadeFrames && age < fadeFrames ? Math.trunc(age * 256 / fadeFrames) : 256;
  const amplitudeQ8 = Math.round((Number(wave.amplitude) || 0) * 256) * fadeQ8 >> 8;
  const wavelength = Math.max(1, Number(wave.wavelength) || 64);
  const speedQ8 = Math.round((Number(wave.speed) || 0) * 256);
  const phase = (Math.trunc(Number(coordinate) * 1024 / wavelength) + (Math.trunc(Number(frame)) * speedQ8 >> 8)) & 1023;
  const first = (TRIG_Q14[phase] * amplitudeQ8) >> 22;
  if (preset === 'sine') return first;
  if (preset === 'dual-sine') return first + ((TRIG_Q14[(phase * 2 + 127) & 1023] * amplitudeQ8) >> 23);
  if (preset === 'ripple') return Math.abs(first);
  if (preset === 'shear') return Math.trunc((Number(coordinate) - Number(wave.start || 0)) * amplitudeQ8 / ((Number(wave.end ?? 319) - Number(wave.start || 0) + 1) * 256));
  if (preset === 'jitter') {
    const noise = (Math.trunc(coordinate) * 37 + Math.trunc(frame) * 17) & 3;
    return Math.trunc((noise === 0 ? -1 : noise === 3 ? 1 : 0) * amplitudeQ8 / 256) || 0;
  }
  return first;
}

function shotVelocity(orientation, speed, angle = 0) {
  const radians = Number(angle || 0) * Math.PI / 180;
  if (orientation === 'horizontal') return { x: Math.cos(radians) * speed, y: Math.sin(radians) * speed };
  return { x: Math.sin(radians) * speed, y: -Math.cos(radians) * speed };
}

function cycleSpeed(current) {
  const order = ['slow', 'normal', 'fast'];
  const index = order.indexOf(current);
  return order[(index + 1 + order.length) % order.length];
}

function applyItem(state, item, weaponById, bomb) {
  const result = { ...state };
  if (!item) return result;
  if (item.type === 'weapon') {
    if (result.weaponId === item.weaponId) result.score += Number(weaponById.get(item.weaponId)?.duplicateScore ?? item.score ?? 0);
    else result.weaponId = item.weaponId;
  } else if (item.type === 'bomb') result.bombs = Math.min(Number(bomb?.maxStock || 9), result.bombs + Number(item.amount || 1));
  else result.score += Number(item.score || 0);
  return result;
}

function materialAffects(material, actor) { return Boolean(material?.masks?.[actor]); }

function crc32Words(words) {
  let crc = 0xffffffff;
  for (const raw of words || []) {
    let value = Number(raw) >>> 0;
    for (let byte = 0; byte < 4; byte += 1) {
      crc ^= value & 0xff;
      value >>>= 8;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc16Ccitt(bytes, length = bytes?.length || 0) {
  let crc = 0xffff;
  const limit = Math.max(0, Math.min(Math.trunc(Number(length) || 0), bytes?.length || 0));
  for (let index = 0; index < limit; index += 1) {
    crc ^= (Number(bytes[index]) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

module.exports = {
  applyItem,
  clamp,
  crc16Ccitt,
  crc32Words,
  cycleSpeed,
  interpolationRatio,
  materialAffects,
  movementPoint,
  pathPoint,
  shotVelocity,
  waveOffset,
};
