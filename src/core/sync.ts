// Sync engine (spec §14): clock sync, smooth rate controller, sync engine, status reporter.
// A line-for-line port of Kino.Core.Sync in the Windows client, with the same constants and tests,
// so every platform makes the same decisions.
import { type Anchor, expectedAt, isPlaying } from "./protocol";

// ---- Settings (§14, §22) -------------------------------------------------------------------

export interface SyncSettings {
  burstSamples: number;
  burstIntervalMs: number;
  resyncSamples: number;
  resyncEveryMs: number;
  tickMs: number;
  driftWindow: number;
  settleMs: number;
  enterCorrection: number;
  exitCorrection: number;
  hardSeek: number;
  pausedSeekTolerance: number;
  minHardSeekIntervalMs: number;
  initialSeekLatency: number;
  maxDeviation: number;
  slewPerSecond: number;
  gain: number;
  minRateStep: number;
  hostReanchor: number;
  minReanchorIntervalMs: number;
}

export const DEFAULT_SETTINGS: SyncSettings = Object.freeze({
  burstSamples: 8,
  burstIntervalMs: 100,
  resyncSamples: 3,
  resyncEveryMs: 120_000,
  tickMs: 250,
  driftWindow: 5,
  settleMs: 1000,
  enterCorrection: 0.25,
  exitCorrection: 0.08,
  hardSeek: 3.0,
  pausedSeekTolerance: 0.05,
  minHardSeekIntervalMs: 5000,
  initialSeekLatency: 0.3,
  maxDeviation: 0.05,
  slewPerSecond: 0.005,
  gain: 0.1,
  minRateStep: 0.0005,
  hostReanchor: 0.25,
  minReanchorIntervalMs: 2000,
});

/** YouTube (§14.13): coarse rates only, so no rate correction; seek past 1.5 s; the host re-anchors later. */
export const YOUTUBE_SETTINGS: SyncSettings = Object.freeze({
  ...DEFAULT_SETTINGS,
  enterCorrection: 0.5,
  exitCorrection: 0.5,
  hardSeek: 1.5,
  maxDeviation: 0,
  pausedSeekTolerance: 0.25,
  initialSeekLatency: 0.5,
  hostReanchor: 0.75,
});

const OFFSET_REPLACE_THRESHOLD_MS = 100;
const OFFSET_BLEND_OLD = 0.8;

export function median(values: readonly number[]): number {
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 0) return NaN;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- Clock sync (§14.3): theatreNow ≈ localNow + offset ------------------------------------

export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  offset = 0;
  rttMs = NaN;
  isSynced = false;

  constructor(private readonly localNow: () => number = () => performance.now()) {}

  get localNowMs() {
    return this.localNow();
  }

  get theatreNowMs() {
    return this.localNow() + this.offset;
  }

  /** One ping/pong: t0/t1 local send/receive times, ts theatre time. */
  addSample(t0: number, ts: number, t1: number) {
    const rtt = t1 - t0;
    if (rtt < 0 || rtt > 10_000) return;
    this.samples.push({ rtt, offset: ts - (t0 + t1) / 2 });
  }

  /** Best 3 by RTT, median offset; blended unless the change is large. */
  commit(): boolean {
    if (this.samples.length === 0) return false;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    const offset = median(best.map((s) => s.offset));
    const rtt = median(best.map((s) => s.rtt));
    this.samples = [];
    this.offset =
      !this.isSynced || Math.abs(offset - this.offset) > OFFSET_REPLACE_THRESHOLD_MS
        ? offset
        : OFFSET_BLEND_OLD * this.offset + (1 - OFFSET_BLEND_OLD) * offset;
    this.rttMs = rtt;
    this.isSynced = true;
    return true;
  }
}

// ---- Smooth rate controller (§14.8) ----------------------------------------------------------

export class RateController {
  deviation = 0;
  correcting = false;

  constructor(private readonly s: SyncSettings) {}

  get rate() {
    return 1 + this.deviation;
  }

  /** drift in seconds (positive = ahead); dt seconds since the last update. */
  update(drift: number, dt: number): number {
    const abs = Math.abs(drift);
    if (!this.correcting && abs >= this.s.enterCorrection) this.correcting = true;
    else if (this.correcting && abs < this.s.exitCorrection) this.correcting = false;

    let want = 0;
    if (this.correcting) {
      const magnitude = Math.min(this.s.gain * abs, Math.min(this.s.maxDeviation, Math.sqrt(2 * this.s.slewPerSecond * abs)));
      want = -Math.sign(drift) * magnitude; // ahead → slow down, behind → speed up
    }
    const maxStep = this.s.slewPerSecond * dt;
    this.deviation += clamp(want - this.deviation, -maxStep, maxStep);
    if (Math.abs(this.deviation) < 1e-9) this.deviation = 0;
    return this.rate;
  }

  reset() {
    this.deviation = 0;
    this.correcting = false;
  }
}

// ---- Sync engine (§14) ---------------------------------------------------------------------------

/** What the engine needs from a player. */
export interface Playback {
  readonly position: number | null;
  readonly mediaDuration: number | null;
  readonly isPaused: boolean;
  readonly isBuffering: boolean;
  setPaused(paused: boolean): void;
  seek(seconds: number): void;
  setSpeed(speed: number): void;
}

export type SyncZone =
  | "idle"
  | "paused"
  | "starting"
  | "settling"
  | "inSync"
  | "correcting"
  | "seeking"
  | "buffering"
  | "host"
  | "waiting"
  | "noFile";

export interface SyncStatus {
  zone: SyncZone;
  drift: number;
  rate: number;
  seekLatency: number;
}

const END_MARGIN = 0.25;

export class SyncEngine {
  private s: SyncSettings;
  private rateCtl: RateController;
  private anchorValue: Anchor | null = null;
  private drifts: number[] = [];
  private lastDisruption = -Infinity;
  private lastHardSeek = -Infinity;
  private lastPausedSeek = -Infinity;
  private lastReanchor = -Infinity;
  private appliedSpeed = 1;
  private scheduledStartSeq = -1;
  private calibrateAfterSeek = false;
  private checkJump = false;
  private anchorJump: number | null = null;
  private seekLatencies: number[] = [];

  /** Off until the session's clock is synced: anchors are stored but not acted on. */
  enabled = true;
  /** Only drive the player when `loadedItemId` is the anchor's item. */
  requireLoadedItem = false;
  loadedItemId: string | null = null;
  /** The timeline authority re-anchors instead of being corrected. */
  isHost = false;
  /** Local nudge in ms; positive = play later. */
  personalOffsetMs = 0;
  seekLatency: number;
  status: SyncStatus = { zone: "idle", drift: 0, rate: 1, seekLatency: 0 };
  onReanchor: ((position: number, theatreTimeMs: number) => void) | null = null;

  constructor(
    private readonly player: Playback,
    private readonly theatreNow: () => number,
    private readonly localNow: () => number,
    settings: SyncSettings = DEFAULT_SETTINGS,
    private readonly schedule: (delayMs: number, action: () => void) => void = (d, a) => void setTimeout(a, Math.max(0, d)),
  ) {
    this.s = settings;
    this.rateCtl = new RateController(settings);
    this.seekLatency = settings.initialSeekLatency;
  }

  get anchor() {
    return this.anchorValue;
  }

  get settings() {
    return this.s;
  }

  set settings(value: SyncSettings) {
    if (value === this.s) return;
    this.resetRate();
    this.s = value;
    this.rateCtl = new RateController(value);
    this.drifts = [];
  }

  /** Applies a new anchor and acts on it at once (a tick is longer than the theatre's minimum start lead). */
  applyAnchor(anchor: Anchor) {
    const prev = this.anchorValue;
    if (prev && anchor.seq < prev.seq) return; // stale
    if (prev && anchor.seq === prev.seq) {
      this.anchorValue = anchor;
      return;
    }
    const now = this.theatreNow();
    this.anchorJump = !prev || prev.itemId !== anchor.itemId ? null : Math.abs(expectedAt(anchor, now) - expectedAt(prev, now));
    this.anchorValue = anchor;
    this.checkJump = true;
    this.lastHardSeek = -Infinity; // the throttle stops seek loops, not deliberate host seeks
    this.disrupt(this.localNow());
    if (this.enabled) this.status = this.step(0);
  }

  tick(dtSeconds: number) {
    if (this.enabled) this.status = this.step(dtSeconds);
  }

  private result(zone: SyncZone, drift: number, rate = this.appliedSpeed): SyncStatus {
    return { zone, drift, rate, seekLatency: this.seekLatency };
  }

  private step(dt: number): SyncStatus {
    const a = this.anchorValue;
    const p = this.player;
    const posOrNull = p.position;
    if (!a) return this.result("idle", 0);
    if (this.requireLoadedItem && a.itemId !== this.loadedItemId) {
      if (posOrNull !== null && !p.isPaused) p.setPaused(true); // don't play the previous file
      this.resetRate();
      return this.result("noFile", 0, 1);
    }
    if (posOrNull === null) return this.result("idle", 0);
    const pos = posOrNull;

    const now = this.theatreNow();
    const local = this.localNow();
    const offset = this.personalOffsetMs / 1000;

    if (p.isBuffering) {
      this.resetRate();
      this.disrupt(local);
      return this.result("buffering", 0, 1);
    }

    // Paused: hold exactly at the anchor position.
    if (!isPlaying(a)) {
      if (!p.isPaused) p.setPaused(true);
      this.resetRate();
      if (Math.abs(pos - a.position) > this.s.pausedSeekTolerance && local - this.lastPausedSeek > 500) {
        p.seek(a.position);
        this.lastPausedSeek = local;
      }
      return this.result("paused", pos - a.position, 1);
    }

    // Scheduled start pending: wait paused at the start position, then start on time.
    if (now < a.at) {
      if (!p.isPaused) p.setPaused(true);
      this.resetRate();
      if (Math.abs(pos - (a.position + offset)) > this.s.pausedSeekTolerance && local - this.lastPausedSeek > 500) {
        p.seek(Math.max(0, a.position + offset));
        this.lastPausedSeek = local;
      }
      const wait = a.at - now;
      if (this.scheduledStartSeq !== a.seq && wait <= this.s.tickMs * 1.5) {
        this.scheduledStartSeq = a.seq;
        const seq = a.seq;
        this.schedule(wait, () => {
          if (this.anchorValue?.seq === seq) {
            p.setPaused(false);
            this.disrupt(this.localNow());
          }
        });
      }
      return this.result("starting", 0, 1);
    }

    const expected = expectedAt(a, now) + offset;

    // This copy is over but the timeline isn't (shorter file): wait for the next anchor.
    const length = p.mediaDuration;
    if (length !== null && expected >= length - END_MARGIN) {
      if (pos < length - END_MARGIN * 2 && !p.isPaused) p.seek(Math.max(0, length - END_MARGIN));
      if (!p.isPaused) p.setPaused(true);
      this.resetRate();
      return this.result("waiting", pos - expected, 1);
    }

    // Should be playing but isn't (late join, missed start): jump in if needed and start.
    if (p.isPaused) {
      if (Math.abs(pos - expected) > this.s.enterCorrection) {
        p.seek(Math.max(0, expected + this.seekLatency));
        this.calibrateAfterSeek = true;
      }
      p.setPaused(false);
      this.disrupt(local);
      this.checkJump = false;
      return this.result("starting", pos - expected);
    }

    // First playing step after an anchor that arrived too late for its scheduled start: obey a real jump now.
    if (this.checkJump) {
      this.checkJump = false;
      const gap = Math.abs(pos - expected);
      const obey =
        gap > this.s.hardSeek ||
        (this.isHost && this.anchorJump !== null && this.anchorJump > this.s.enterCorrection && gap > this.s.enterCorrection);
      if (obey) return this.hardSeekTo(expected, pos - expected, local);
    }

    if (local - this.lastDisruption < this.s.settleMs) return this.result("settling", pos - expected);

    // Drift: median filter.
    this.drifts.push(pos - expected);
    while (this.drifts.length > this.s.driftWindow) this.drifts.shift();
    if (this.drifts.length < Math.min(3, this.s.driftWindow)) return this.result("settling", pos - expected);
    const drift = median(this.drifts);

    if (this.calibrateAfterSeek) {
      this.calibrateAfterSeek = false;
      this.seekLatencies.push(clamp(this.seekLatency - drift, 0, 2));
      while (this.seekLatencies.length > 5) this.seekLatencies.shift();
      this.seekLatency = this.seekLatencies.reduce((x, y) => x + y, 0) / this.seekLatencies.length;
    }

    // Host: never bend its own playback; publish its real position instead.
    if (this.isHost) {
      if (Math.abs(drift) > this.s.hostReanchor && local - this.lastReanchor > this.s.minReanchorIntervalMs) {
        this.lastReanchor = local;
        this.drifts = [];
        this.onReanchor?.(pos - offset, now);
      }
      return this.result("host", drift);
    }

    // Viewer: hard seek when far off, else smooth rate correction.
    if (Math.abs(drift) > this.s.hardSeek) {
      if (local - this.lastHardSeek > this.s.minHardSeekIntervalMs) return this.hardSeekTo(expected, drift, local);
      this.resetRate();
      return this.result("seeking", drift, 1);
    }

    const rate = this.rateCtl.update(drift, dt);
    if (Math.abs(rate - this.appliedSpeed) >= this.s.minRateStep || (rate === 1 && this.appliedSpeed !== 1)) {
      p.setSpeed(rate);
      this.appliedSpeed = rate;
    }
    return this.result(this.rateCtl.correcting ? "correcting" : "inSync", drift);
  }

  private hardSeekTo(expected: number, drift: number, local: number): SyncStatus {
    this.lastHardSeek = local;
    this.resetRate();
    this.player.seek(Math.max(0, expected + this.seekLatency));
    this.calibrateAfterSeek = true;
    this.disrupt(local);
    return this.result("seeking", drift, 1);
  }

  private disrupt(local: number) {
    this.lastDisruption = local;
    this.drifts = [];
  }

  private resetRate() {
    this.rateCtl.reset();
    if (this.appliedSpeed !== 1) {
      this.player.setSpeed(1);
      this.appliedSpeed = 1;
    }
  }
}

// ---- Status reporter (§12): engine zone → reported status, on change only ---------------------

export type ReportedStatus = "sync" | "catching" | "buffering" | "mismatch" | "waiting" | "nofile";

export class StatusReporter {
  static readonly bufferingDelayMs = 2000;
  static readonly debounceMs = 1000;
  private sent: ReportedStatus = "sync";
  private candidate: ReportedStatus | null = null;
  private candidateSince = 0;
  private bufferingSince = NaN;

  get current() {
    return this.sent;
  }

  update(zone: SyncZone, mismatch: boolean, nowMs: number): ReportedStatus | null {
    const buffering = zone === "buffering";
    if (!buffering) this.bufferingSince = NaN;
    else if (Number.isNaN(this.bufferingSince)) this.bufferingSince = nowMs;
    const longBuffering = buffering && nowMs - this.bufferingSince >= StatusReporter.bufferingDelayMs;

    const desired: ReportedStatus = longBuffering
      ? "buffering"
      : zone === "waiting"
        ? "waiting"
        : zone === "noFile"
          ? "nofile"
          : mismatch
            ? "mismatch"
            : zone === "correcting" || zone === "seeking"
              ? "catching"
              : zone === "settling" || zone === "starting" || zone === "buffering" || zone === "idle"
                ? this.sent
                : "sync";

    if (desired === this.sent) {
      this.candidate = null;
      return null;
    }
    if (desired === "buffering" || (this.candidate === desired && nowMs - this.candidateSince >= StatusReporter.debounceMs)) {
      this.sent = desired;
      this.candidate = null;
      return desired;
    }
    if (this.candidate !== desired) {
      this.candidate = desired;
      this.candidateSince = nowMs;
    }
    return null;
  }
}
