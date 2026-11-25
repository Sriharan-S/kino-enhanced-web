import { describe, expect, it } from "vitest";
import { isUsable, probeProblem, TheatreNetwork, type TheatreProbe } from "../src/core/net";
import { PROTOCOL_VERSION } from "../src/core/protocol";
import { engineStep, GAP_MS, startTicker } from "../src/core/ticker";

const theatre = (id: string) => ({ id, name: id, url: `https://${id}.example` });
const probe = (
  id: string,
  info: Partial<TheatreProbe["info"]> | null,
  rttMs: number | null = 20,
  failure: string | null = null,
): TheatreProbe => ({
  theatre: theatre(id),
  info: info ? { id, name: id, protocol: PROTOCOL_VERSION, minProtocol: PROTOCOL_VERSION, status: "ok", time: 0, ...info } : null,
  rttMs,
  failure,
});

describe("theatre probes (C-4.3, C-4.4)", () => {
  it("explains why a theatre can't be used", () => {
    expect(probeProblem(probe("a", {}))).toBeNull();
    expect(probeProblem(probe("a", null, null, "timed out"))).toBe("unavailable (timed out)");
    expect(probeProblem(probe("a", { minProtocol: PROTOCOL_VERSION + 1, protocol: PROTOCOL_VERSION + 1 }))).toMatch(
      /newer version of Kino/,
    );
    expect(probeProblem(probe("a", { protocol: PROTOCOL_VERSION - 1, minProtocol: PROTOCOL_VERSION - 1 }))).toMatch(/out of date/);
    expect(probeProblem(probe("a", { status: "degraded" }))).toBe("unavailable (degraded)");
  });

  it("picks the fastest usable theatre only", () => {
    const probes = [
      probe("slow", {}, 90),
      probe("fast-but-new", { minProtocol: PROTOCOL_VERSION + 1, protocol: PROTOCOL_VERSION + 1 }, 5),
      probe("down", null, null, "x"),
      probe("ok", {}, 30),
    ];
    expect(TheatreNetwork.fastest(probes)?.theatre.id).toBe("ok");
    expect(probes.filter(isUsable).map((p) => p.theatre.id)).toEqual(["slow", "ok"]);
    expect(TheatreNetwork.fastest([probe("down", null, null, "x")])).toBeNull();
  });
});

describe("ticker (C-11.23)", () => {
  it("caps the engine step at one second and never goes negative", () => {
    expect(engineStep(250)).toBe(0.25);
    expect(engineStep(60_000)).toBe(1);
    expect(engineStep(-5)).toBe(0);
    expect(GAP_MS).toBeGreaterThan(1000); // a throttled background tab (1 tick/s) is not a gap
  });

  it("falls back to a normal timer without workers", async () => {
    let n = 0;
    const stop = startTicker(10, () => n++);
    await new Promise((r) => setTimeout(r, 120));
    stop();
    const seen = n;
    expect(seen).toBeGreaterThanOrEqual(5);
    await new Promise((r) => setTimeout(r, 50));
    expect(n).toBe(seen);
  });
});
