import MdEmulator from './md-emulator.js';
import {
  FRAME_MS,
  MAX_CATCH_UP_FRAMES,
  planFrameBatch,
  shouldUseTimerFallback,
} from './testplay-frame-pacer.mjs';

const PERFORMANCE_WINDOW_MS = 1000;
const TIMER_EARLY_TOLERANCE_MS = 0.5;

/**
 * Local Test Play adapter around the tracked md_emulator snapshot.
 * It prevents multi-frame catch-up from creating a permanent missed-vsync
 * feedback loop. One browser presentation always means at most one MD frame.
 */
export default class TestPlayEmulator extends MdEmulator {
  constructor(options = {}) {
    super(options);
    this._presentedFrameCount = 0;
    this._performanceWindowStartedAt = 0;
    this._performanceWindowEmulated = 0;
    this._performanceWindowPresented = 0;
    this._performanceWindowMaxBatch = 0;
    this._performanceWindowWorkMs = 0;
    this._performanceWindowMaxWorkMs = 0;
    this._clockMode = 'raf';
    this._detectedVsyncFps = 0;
    this._timerId = null;
    this._nextTimerFrameAt = 0;
    this._performanceSnapshot = {
      emulatedFps: 0,
      presentedFps: 0,
      averageBatch: 0,
      maxBatch: 0,
      sampleMs: 0,
    };
  }

  get performanceSnapshot() {
    return {
      ...this._performanceSnapshot,
      clockMode: this._clockMode,
      detectedVsyncFps: this._detectedVsyncFps,
      totalEmulatedFrames: this._frameCount,
      totalPresentedFrames: this._presentedFrameCount,
    };
  }

  _startLoop() {
    this._clockMode = 'raf';
    this._detectedVsyncFps = 0;
    this._clearTimer();
    this._performanceWindowStartedAt = performance.now();
    this._performanceWindowEmulated = 0;
    this._performanceWindowPresented = 0;
    this._performanceWindowMaxBatch = 0;
    this._performanceWindowWorkMs = 0;
    this._performanceWindowMaxWorkMs = 0;
    super._startLoop();
  }

  _stopLoop() {
    this._clearTimer();
    super._stopLoop();
  }

  _frameTick(ts) {
    if (!this._running) return;

    const elapsedMs = this._lastTs ? Math.max(0, ts - this._lastTs) : FRAME_MS;
    this._lastTs = ts;
    const batch = planFrameBatch(this._accumulator, elapsedMs, {
      maxCatchUpFrames: MAX_CATCH_UP_FRAMES,
    });
    this._accumulator = batch.accumulatorMs;

    if (batch.framesDue > 0) {
      const previousFrame = this._frameCount;
      const workStartedAt = performance.now();
      super._runOneFrame();
      const workMs = performance.now() - workStartedAt;
      if (this._frameCount > previousFrame) this._recordPerformance(ts, workMs);
    }

    if (this._clockMode === 'timer') {
      this._scheduleTimerFrame();
    } else {
      this._rafId = requestAnimationFrame((nextTs) => this._frameTick(nextTs));
    }
  }

  _activateTimerClock(now) {
    this._clockMode = 'timer';
    this._nextTimerFrameAt = now + FRAME_MS;
  }

  _scheduleTimerFrame() {
    if (!this._running || this._clockMode !== 'timer') return;
    const delayMs = Math.max(0, this._nextTimerFrameAt - performance.now() - TIMER_EARLY_TOLERANCE_MS);
    this._timerId = setTimeout(() => this._timerTick(), delayMs);
  }

  _timerTick() {
    this._timerId = null;
    if (!this._running || this._clockMode !== 'timer') return;

    const now = performance.now();
    if (now + TIMER_EARLY_TOLERANCE_MS < this._nextTimerFrameAt) {
      this._scheduleTimerFrame();
      return;
    }

    const previousFrame = this._frameCount;
    const workStartedAt = performance.now();
    super._runOneFrame();
    const finishedAt = performance.now();
    if (this._frameCount > previousFrame) {
      this._recordPerformance(finishedAt, finishedAt - workStartedAt);
    }

    this._nextTimerFrameAt += FRAME_MS;
    if (this._nextTimerFrameAt < finishedAt) {
      // Do not skip MD frames. If one frame exceeds its budget, the emulator
      // slows down naturally instead of executing hidden catch-up frames.
      this._nextTimerFrameAt = finishedAt;
    }
    this._scheduleTimerFrame();
  }

  _clearTimer() {
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _recordPerformance(ts, workMs) {
    this._presentedFrameCount += 1;
    this._performanceWindowEmulated += 1;
    this._performanceWindowPresented += 1;
    this._performanceWindowMaxBatch = 1;
    this._performanceWindowWorkMs += workMs;
    this._performanceWindowMaxWorkMs = Math.max(this._performanceWindowMaxWorkMs, workMs);

    const sampleMs = ts - this._performanceWindowStartedAt;
    if (sampleMs < PERFORMANCE_WINDOW_MS) return;

    const emulatedFps = this._performanceWindowEmulated * 1000 / sampleMs;
    const presentedFps = this._performanceWindowPresented * 1000 / sampleMs;
    const averageWorkMs = this._performanceWindowWorkMs / this._performanceWindowPresented;
    this._performanceSnapshot = {
      emulatedFps,
      presentedFps,
      averageBatch: this._performanceWindowEmulated / this._performanceWindowPresented,
      maxBatch: this._performanceWindowMaxBatch,
      averageWorkMs,
      maxWorkMs: this._performanceWindowMaxWorkMs,
      sampleMs,
    };
    if (this._clockMode === 'raf') {
      this._detectedVsyncFps = presentedFps;
      if (shouldUseTimerFallback(presentedFps, averageWorkMs)) {
        this._activateTimerClock(ts);
      }
    }
    this.dispatchEvent(new CustomEvent('performance', { detail: this.performanceSnapshot }));
    this._performanceWindowStartedAt = ts;
    this._performanceWindowEmulated = 0;
    this._performanceWindowPresented = 0;
    this._performanceWindowMaxBatch = 0;
    this._performanceWindowWorkMs = 0;
    this._performanceWindowMaxWorkMs = 0;
  }
}
