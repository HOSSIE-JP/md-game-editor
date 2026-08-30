export const TARGET_FPS = 60;
export const FRAME_MS = 1000 / TARGET_FPS;
export const FRAME_EARLY_TOLERANCE_MS = 0.5;
export const MAX_CATCH_UP_FRAMES = 1;
export const RAF_FALLBACK_FPS = 50;
export const RAF_FALLBACK_MAX_WORK_MS = FRAME_MS * 0.9;

/**
 * Chromium may report a 60 Hz requestAnimationFrame just before the exact
 * 16.666... ms boundary. The tolerance absorbs that clock jitter. Test Play
 * intentionally executes at most one emulated frame per browser presentation:
 * skipping visible frames to catch up can lock a marginal workload at 30 Hz,
 * while hardware-style slowdown under real load is predictable and visible.
 */
export function planFrameBatch(accumulatorMs, elapsedMs, options = {}) {
  const frameMs = Number(options.frameMs ?? FRAME_MS);
  const earlyToleranceMs = Number(options.earlyToleranceMs ?? FRAME_EARLY_TOLERANCE_MS);
  const maxCatchUpFrames = Math.max(1, Math.trunc(options.maxCatchUpFrames ?? MAX_CATCH_UP_FRAMES));

  if (!Number.isFinite(frameMs) || frameMs <= 0) {
    throw new RangeError('frameMs must be a positive finite number');
  }
  if (!Number.isFinite(earlyToleranceMs) || earlyToleranceMs < 0 || earlyToleranceMs >= frameMs) {
    throw new RangeError('earlyToleranceMs must be finite and smaller than frameMs');
  }

  const previous = Number.isFinite(accumulatorMs) ? accumulatorMs : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  let nextAccumulator = Math.min(previous + elapsed, frameMs * (maxCatchUpFrames + 1));
  const requestedFrames = Math.max(0, Math.floor((nextAccumulator + earlyToleranceMs) / frameMs));
  const framesDue = Math.min(maxCatchUpFrames, requestedFrames);
  nextAccumulator = requestedFrames > maxCatchUpFrames
    ? 0
    : nextAccumulator - framesDue * frameMs;
  if (Math.abs(nextAccumulator) < 1e-9) nextAccumulator = 0;

  return { framesDue, accumulatorMs: nextAccumulator };
}

export function shouldUseTimerFallback(presentedFps, averageWorkMs, options = {}) {
  const minimumRafFps = Number(options.minimumRafFps ?? RAF_FALLBACK_FPS);
  const maximumWorkMs = Number(options.maximumWorkMs ?? RAF_FALLBACK_MAX_WORK_MS);
  return Number.isFinite(presentedFps)
    && Number.isFinite(averageWorkMs)
    && presentedFps > 0
    && presentedFps < minimumRafFps
    && averageWorkMs >= 0
    && averageWorkMs < maximumWorkMs;
}
