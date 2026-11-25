// Ported from the Windows client's SyncTests.cs and StatusReporterTests.cs: same scenarios, same bounds.
import { describe, expect, it } from "vitest";
import { type Anchor, expectedAt, parseServerMessage } from "../src/core/protocol";
import { ClockSync, DEFAULT_SETTINGS as S, RateController, StatusReporter, type SyncZone } from "../src/core/sync";
import { SimHarness } from "./sim";

describe("RateController", () => {
  function simulate(drift0: number) {
    const c = new RateController(S);
    let d = drift0,
      t = 0,
      prev = 1,
      maxDev = 0,
      maxStep = 0,
      overshoot = 0;
    const dt = 0.25;
    let reached: number | null = null;
    while (t < 300) {
      const rate = c.update(d, dt);
      maxDev = Math.max(maxDev, Math.abs(rate - 1));
      maxStep = Math.max(maxStep, Math.abs(rate - prev));
      prev = rate;
      d += (rate - 1) * dt;
      t += dt;
      if (Math.sign(d) !== Math.sign(drift0)) overshoot = Math.max(overshoot, Math.abs(d));
      if (reached === null && !c.correcting) reached = t;
      if (reached !== null && rate === 1) break;
    }
    return { time: reached ?? NaN, maxDev, maxStep, overshoot, finalDrift: d };
  }

  it.each([
    [0.3, 25],
    [-1.0, 40],
    [3.0, 85],
    [-3.0, 85],
  ])("converges smoothly without overshoot from %f s", (drift0, maxSeconds) => {
    const r = simulate(drift0);
    expect(r.time).toBeLessThanOrEqual(maxSeconds);
    expect(r.maxDev).toBeLessThanOrEqual(S.maxDeviation + 1e-9);
    expect(r.maxStep).toBeLessThanOrEqual(S.slewPerSecond * 0.25 + 1e-9);
    expect(r.overshoot).toBeLessThan(0.02);
    expect(Math.abs(r.finalDrift)).toBeLessThan(S.exitCorrection + 0.01);
  });

  it("ignores drift inside the green zone", () => {
    const c = new RateController(S);
    for (let i = 0; i < 100; i++) expect(c.update(0.2, 0.25)).toBe(1);
  });

  it("keeps correcting until the exit threshold (hysteresis)", () => {
    const c = new RateController(S);
    c.update(0.3, 0.25);
    expect(c.correcting).toBe(true);
    c.update(0.15, 0.25);
    expect(c.correcting).toBe(true);
    c.update(0.05, 0.25);
    expect(c.correcting).toBe(false);
  });
});

describe("ClockSync", () => {
  it("estimates the offset from the lowest-RTT samples", () => {
    let local = 0;
    const clock = new ClockSync(() => local);
    const trueOffset = 5000;
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 8; i++) {
      let up = 20 + rnd() * 5;
      const down = 20 + rnd() * 5;
      if (i % 3 === 0) up += 150; // congested, asymmetric samples should be discarded
      const t0 = local;
      const ts = t0 + up + trueOffset;
      const t1 = t0 + up + down;
      clock.addSample(t0, ts, t1);
      local = t1 + 100;
    }
    expect(clock.commit()).toBe(true);
    expect(Math.abs(clock.offset - trueOffset)).toBeLessThanOrEqual(3);
    expect(clock.rttMs).toBeGreaterThanOrEqual(40);
    expect(clock.rttMs).toBeLessThanOrEqual(50);
  });

  it("blends small changes and replaces large jumps", () => {
    const clock = new ClockSync(() => 0);
    clock.addSample(0, 1000, 0);
    clock.commit();
    clock.addSample(0, 1050, 0);
    clock.commit();
    expect(clock.offset).toBeCloseTo(1010, 3);
    clock.addSample(0, 9000, 0);
    clock.commit();
    expect(clock.offset).toBeCloseTo(9000, 3);
  });
});

const playing = (position: number, at: number, seq = 1): Anchor => ({ itemId: "i1", state: "playing", position, rate: 1, at, seq });
const within = (v: number, lo: number, hi: number) => {
  expect(v).toBeGreaterThanOrEqual(lo);
  expect(v).toBeLessThanOrEqual(hi);
};

describe("SyncEngine", () => {
  it("catches up 1.5 s behind with rate only", () => {
    const h = new SimHarness();
    h.player.pos = 8.5;
    h.player.paused = false;
    h.engine.applyAnchor(playing(10, h.theatreMs));
    h.run(50);
    expect(h.player.seeks).toBe(0);
    within(h.trueDrift, -0.1, 0.1);
    for (const s of h.player.speedHistory) within(s, 0.95, 1.05);
    expect(h.player.speed).toBe(1);
  });

  it("hard-seeks when far off, then learns the seek latency", () => {
    const h = new SimHarness();
    h.player.pos = 30;
    h.player.paused = false;
    h.player.seekLatencyS = 0.4;
    h.engine.applyAnchor(playing(100, h.theatreMs));
    h.run(20);
    expect(h.player.seeks).toBe(1);
    within(h.trueDrift, -S.enterCorrection, S.enterCorrection);
    within(h.engine.seekLatency, 0.35, 0.45);
  });

  it("pauses exactly at a paused anchor", () => {
    const h = new SimHarness();
    h.player.pos = 12;
    h.player.paused = false;
    h.engine.applyAnchor({ itemId: "i1", state: "paused", position: 42.5, rate: 1, at: h.theatreMs, seq: 1 });
    h.run(2);
    expect(h.player.paused).toBe(true);
    expect(h.player.pos).toBeCloseTo(42.5, 3);
  });

  it("starts a scheduled start on time", () => {
    const h = new SimHarness();
    h.engine.applyAnchor(playing(0, h.theatreMs + 600));
    h.run(0.5);
    expect(h.player.paused).toBe(true);
    h.run(5);
    expect(h.player.paused).toBe(false);
    within(h.trueDrift, -0.03, 0.03);
  });

  it("host re-anchors instead of bending playback", () => {
    const h = new SimHarness();
    h.engine.isHost = true;
    let reported: number | null = null;
    h.engine.onReanchor = (pos) => (reported = pos);
    h.player.pos = 20.6;
    h.player.paused = false;
    h.engine.applyAnchor(playing(20, h.theatreMs));
    h.run(3);
    expect(reported).not.toBeNull();
    expect(h.player.speedHistory).toHaveLength(0);
  });

  it("applies a new anchor on arrival, not on the next tick", () => {
    const h = new SimHarness();
    h.player.pos = 10;
    h.player.paused = false;
    h.engine.applyAnchor(playing(10, h.theatreMs));
    h.run(2);
    h.engine.applyAnchor(playing(50, h.theatreMs + 200, 2));
    expect(h.player.paused).toBe(true);
    expect(h.player.pos).toBeCloseTo(50, 3);
    h.run(2);
    within(h.trueDrift, -0.03, 0.03);
  });

  it("host obeys a seek that arrives after its start time", () => {
    const h = new SimHarness();
    h.engine.isHost = true;
    const reanchors: number[] = [];
    h.engine.onReanchor = (pos) => reanchors.push(pos);
    h.player.pos = 104;
    h.player.paused = false;
    h.engine.applyAnchor(playing(104, h.theatreMs));
    h.run(2);
    h.engine.applyAnchor(playing(165.6, h.theatreMs - 100, 2));
    h.run(4);
    within(h.trueDrift, -0.25, 0.25);
    expect(reanchors.some((p) => p < 160)).toBe(false);
  });

  it("viewer follows back-to-back seeks without waiting for the throttle", () => {
    const h = new SimHarness();
    h.player.pos = 104;
    h.player.paused = false;
    h.engine.applyAnchor(playing(104, h.theatreMs));
    h.run(2);
    h.engine.applyAnchor(playing(165.6, h.theatreMs - 50, 2));
    h.run(1.5);
    h.engine.applyAnchor(playing(106.2, h.theatreMs - 50, 3));
    h.run(2);
    within(h.trueDrift, -0.25, 0.25);
    for (const s of h.player.speedHistory) within(s, 0.99, 1.01);
  });

  it("does not rate-correct while hard seeks are throttled", () => {
    const h = new SimHarness();
    h.player.pos = 10;
    h.player.paused = false;
    h.engine.applyAnchor(playing(10, h.theatreMs));
    h.run(3);
    h.player.seek(h.player.pos + 60);
    h.run(2);
    expect(h.player.seeks).toBe(2);
    h.player.seek(h.player.pos + 60);
    h.run(8);
    within(h.trueDrift, -0.25, 0.25);
    for (const s of h.player.speedHistory) within(s, 0.998, 1.002);
  });

  it("ignores stale anchors", () => {
    const h = new SimHarness();
    h.engine.applyAnchor(playing(10, 0, 5));
    h.engine.applyAnchor(playing(99, 0, 4));
    expect(h.engine.anchor?.position).toBe(10);
  });

  it("shifts the target by the personal offset", () => {
    const h = new SimHarness();
    h.engine.personalOffsetMs = 500;
    h.player.pos = 10;
    h.player.paused = false;
    h.engine.applyAnchor(playing(10, h.theatreMs));
    h.run(40);
    within(h.trueDrift, 0.4, 0.6);
  });

  it("waits at the end of a shorter copy instead of re-anchoring the host back", () => {
    const h = new SimHarness();
    h.engine.isHost = true;
    const reanchors: number[] = [];
    h.engine.onReanchor = (pos) => reanchors.push(pos);
    h.player.length = 20;
    h.player.pos = 18;
    h.player.paused = false;
    h.engine.applyAnchor(playing(18, h.theatreMs));
    h.run(6);
    expect(h.engine.status.zone).toBe("waiting");
    expect(reanchors).toHaveLength(0);
  });

  it("holds paused while its file isn't loaded", () => {
    const h = new SimHarness();
    h.engine.requireLoadedItem = true;
    h.engine.loadedItemId = "i0";
    h.player.pos = 5;
    h.player.paused = false;
    h.engine.applyAnchor(playing(5, h.theatreMs));
    h.run(1);
    expect(h.engine.status.zone).toBe("noFile");
    expect(h.player.paused).toBe(true);
    h.engine.loadedItemId = "i1";
    h.run(3);
    expect(h.player.paused).toBe(false);
  });

  it("does nothing until enabled", () => {
    const h = new SimHarness();
    h.engine.enabled = false;
    h.player.pos = 0;
    h.player.paused = false;
    h.engine.applyAnchor(playing(100, h.theatreMs));
    h.run(2);
    expect(h.player.seeks).toBe(0);
  });
});

describe("Anchor", () => {
  it("expected position", () => {
    const a: Anchor = { itemId: "i1", state: "playing", position: 10, rate: 1, at: 1000, seq: 1 };
    expect(expectedAt(a, 500)).toBe(10);
    expect(expectedAt(a, 3000)).toBeCloseTo(12, 6);
    expect(expectedAt({ ...a, state: "paused" }, 9000)).toBe(10);
  });
});

describe("StatusReporter", () => {
  function run(r: StatusReporter, zone: SyncZone, seconds: number, clock: { t: number }, mismatch = false) {
    const sent: string[] = [];
    for (const end = clock.t + seconds * 1000; clock.t < end; clock.t += 250) {
      const s = r.update(zone, mismatch, clock.t);
      if (s) sent.push(s);
    }
    return sent;
  }

  it("ignores short buffering but reports two seconds", () => {
    const r = new StatusReporter();
    const c = { t: 0 };
    expect(run(r, "buffering", 1.5, c)).toEqual([]);
    expect(run(r, "inSync", 3, c)).toEqual([]);
    expect(run(r, "buffering", 3, c)).toEqual(["buffering"]);
    expect(run(r, "inSync", 3, c)).toEqual(["sync"]);
  });

  it("debounces flaps; transients keep the last status", () => {
    const r = new StatusReporter();
    const c = { t: 0 };
    expect(run(r, "correcting", 0.5, c)).toEqual([]);
    expect(run(r, "inSync", 2, c)).toEqual([]);
    expect(run(r, "correcting", 2, c)).toEqual(["catching"]);
    expect(run(r, "settling", 3, c)).toEqual([]);
    expect(run(r, "inSync", 2, c)).toEqual(["sync"]);
  });

  it("reports waiting, no file and mismatch", () => {
    const r = new StatusReporter();
    const c = { t: 0 };
    expect(run(r, "inSync", 2, c, true)).toEqual(["mismatch"]);
    expect(run(r, "waiting", 2, c, true)).toEqual(["waiting"]);
    expect(run(r, "noFile", 2, c)).toEqual(["nofile"]);
  });
});

describe("parseServerMessage", () => {
  it("parses known types and ignores the rest", () => {
    const m = parseServerMessage('{"type":"hold","data":["Bob"]}');
    expect(m).toEqual({ type: "hold", data: ["Bob"] });
    expect(parseServerMessage('{"type":"future.thing","data":{}}')).toBeNull();
    expect(parseServerMessage("not json")).toBeNull();
  });
});
