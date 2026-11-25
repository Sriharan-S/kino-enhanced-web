// Deterministic player model and harness, ported from the Windows tests (SimPlayer.cs).
import { type Anchor, expectedAt } from "../src/core/protocol";
import { type Playback, type SyncSettings, type SyncStatus, SyncEngine } from "../src/core/sync";

export class SimPlayer implements Playback {
  private frozenUntil = -Infinity;
  pos = 0;
  speed = 1;
  paused = true;
  buffering = false;
  seekLatencyS = 0.2;
  seeks = 0;
  nowSeconds = 0;
  length: number | null = null;
  speedHistory: number[] = [];

  get position() {
    return this.pos;
  }
  get mediaDuration() {
    return this.length;
  }
  get isPaused() {
    return this.paused;
  }
  get isBuffering() {
    return this.buffering;
  }
  setPaused(paused: boolean) {
    this.paused = paused;
  }
  seek(seconds: number) {
    this.pos = seconds;
    this.seeks++;
    this.frozenUntil = this.nowSeconds + this.seekLatencyS;
  }
  setSpeed(speed: number) {
    this.speed = speed;
    this.speedHistory.push(speed);
  }
  advance(dt: number) {
    const start = this.nowSeconds;
    this.nowSeconds += dt;
    if (this.paused || this.buffering) return;
    const playable = Math.max(0, this.nowSeconds - Math.max(start, this.frozenUntil));
    this.pos += this.speed * Math.min(dt, playable);
    if (this.length !== null && this.pos >= this.length) {
      this.pos = this.length;
      this.paused = true;
    }
  }
}

export class SimHarness {
  private scheduled: { atMs: number; action: () => void }[] = [];
  readonly player = new SimPlayer();
  readonly engine: SyncEngine;
  readonly log: { t: number; s: SyncStatus }[] = [];

  get theatreMs() {
    return this.player.nowSeconds * 1000 + 1_000_000;
  }

  constructor(settings?: SyncSettings) {
    this.engine = new SyncEngine(
      this.player,
      () => this.theatreMs,
      () => this.player.nowSeconds * 1000,
      settings,
      (delayMs, action) => this.scheduled.push({ atMs: this.theatreMs + delayMs, action }),
    );
  }

  run(seconds: number, tick = 0.25, step = 0.005) {
    let untilTick = 0;
    for (let t = 0; t < seconds; t += step) {
      this.player.advance(step);
      for (let i = this.scheduled.length - 1; i >= 0; i--) {
        if (this.scheduled[i]!.atMs <= this.theatreMs) {
          const { action } = this.scheduled[i]!;
          this.scheduled.splice(i, 1);
          action();
        }
      }
      untilTick -= step;
      if (untilTick <= 0) {
        this.engine.tick(tick);
        this.log.push({ t: this.player.nowSeconds, s: this.engine.status });
        untilTick += tick;
      }
    }
  }

  get trueDrift() {
    return this.player.pos - expectedAt(this.engine.anchor as Anchor, this.theatreMs);
  }
}
