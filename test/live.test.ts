// End-to-end against a real theatre: KINO_THEATRE=http://127.0.0.1:8787 npm test
// (start one with `npx wrangler dev` in the main repo's theatre/). Skipped when KINO_THEATRE isn't set.
import { describe, expect, it, vi } from "vitest";
import { DeviceIdentity } from "../src/core/identity";
import { TheatreApi, TheatreError } from "../src/core/net";
import { expectedAt } from "../src/core/protocol";
import { ScreenSession } from "../src/core/session";
import { DEFAULT_SETTINGS } from "../src/core/sync";
import { SimPlayer } from "./sim";

const url = process.env.KINO_THEATRE;
const api = url ? new TheatreApi({ id: "local", name: "Local", url }) : null;

/** A sim player advanced in real time, so the engine sees real clock behaviour. */
function livePlayer() {
  const p = new SimPlayer();
  p.seekLatencyS = 0.05;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    p.advance((now - last) / 1000);
    last = now;
  }, 10);
  return { p, stop: () => clearInterval(timer) };
}

const identity = () => DeviceIdentity.fromSecret(crypto.getRandomValues(new Uint8Array(32)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(50);
  }
}

/** Both players end up within the engine's green zone (it leaves drift under 0.25 s alone; larger drift is corrected). */
async function converges(a: SimPlayer, b: SimPlayer, ms = 20_000) {
  await waitFor(() => Math.abs(a.pos - b.pos) < DEFAULT_SETTINGS.enterCorrection, ms).catch(() => {
    throw new Error(`players stayed ${Math.abs(a.pos - b.pos).toFixed(3)} s apart`);
  });
}

describe.skipIf(!api)("live theatre", () => {
  it("host and viewer stay in sync through play, seek and pause", { timeout: 60_000 }, async () => {
    const hp = livePlayer();
    const vp = livePlayer();
    const { session: host, created } = await ScreenSession.create(
      api!,
      await identity(),
      hp.p,
      { name: "web live test", visibility: "public" },
      "Host",
    );
    try {
      expect(host.isHost).toBe(true);
      const resolved = await api!.resolve(created.code);
      const viewer = await ScreenSession.joinResolved(api!, await identity(), vp.p, resolved!, "Viewer", null);
      try {
        expect(viewer.self?.device).toBe("web");
        await waitFor(() => host.viewers.length === 2);

        host.load({ kind: "local", name: "Test.mkv", duration: 600 });
        await waitFor(() => viewer.currentItem?.name === "Test.mkv" && host.currentItem !== null);
        const itemId = host.currentItem!.id;
        for (const [s, p] of [
          [host, hp.p],
          [viewer, vp.p],
        ] as const) {
          s.engine.requireLoadedItem = true;
          s.engine.loadedItemId = itemId;
          p.length = 600;
        }

        host.play();
        await waitFor(() => viewer.engine.anchor?.state === "playing");
        await sleep(3000);
        expect(hp.p.paused).toBe(false);
        expect(vp.p.paused).toBe(false);
        await converges(hp.p, vp.p);

        host.seek(120);
        await waitFor(() => (host.engine.anchor?.position ?? 0) >= 120);
        await sleep(2500);
        await converges(hp.p, vp.p);
        expect(hp.p.pos).toBeGreaterThan(120);

        host.pause();
        await waitFor(() => viewer.engine.anchor?.state === "paused");
        await sleep(800);
        const a = viewer.engine.anchor!;
        expect(vp.p.paused).toBe(true);
        expect(Math.abs(vp.p.pos - expectedAt(a, 0))).toBeLessThan(0.06);

        // Statuses reach everyone.
        await waitFor(() => host.viewers.every((v) => v.status === "sync")).catch((e) => {
          throw new Error(
            `${e} ${JSON.stringify(host.viewers.map((v) => [v.name, v.status]))} ${viewer.engine.status.zone} ${host.engine.status.zone}`,
          );
        });

        // Chat round trip.
        let got = "";
        viewer.chatReceived.on((m) => (got = m.text ?? ""));
        host.sendChat("hello from the host");
        await waitFor(() => got === "hello from the host");
      } finally {
        viewer.dispose();
      }
      await waitFor(() => host.viewers.length === 1);
    } finally {
      host.dispose();
      hp.stop();
      vp.stop();
    }
  });

  it("private screens need the password; members rejoin without it", { timeout: 30_000 }, async () => {
    const hp = livePlayer();
    const { session: host, created } = await ScreenSession.create(
      api!,
      await identity(),
      hp.p,
      { name: "web private test", visibility: "private", password: "pw1" },
      "Host",
    );
    try {
      const resolved = (await api!.resolve(created.code))!;
      expect(resolved.requiresPassword).toBe(true);
      const id = await identity();
      await expect(ScreenSession.joinResolved(api!, id, new SimPlayer(), resolved, "Guest", "nope")).rejects.toMatchObject({
        code: "wrong_password",
      });
      const guest = await ScreenSession.joinResolved(api!, id, new SimPlayer(), resolved, "Guest", "pw1");
      guest.dispose();
      await sleep(300);
      const again = await ScreenSession.joinResolved(api!, id, new SimPlayer(), resolved, "Guest", null);
      expect(again.self?.name).toBe("Guest");
      again.dispose();
    } finally {
      host.dispose();
      hp.stop();
    }
  });

  it("reconnects silently after a network drop and keeps playing in sync (C-3.7)", { timeout: 60_000 }, async () => {
    const hp = livePlayer();
    const vp = livePlayer();
    const { session: host, created } = await ScreenSession.create(
      api!,
      await identity(),
      hp.p,
      { name: "web reconnect test", visibility: "public" },
      "Host",
    );
    const viewer = await ScreenSession.joinResolved(api!, await identity(), vp.p, (await api!.resolve(created.code))!, "Viewer", null);
    try {
      host.load({ kind: "local", name: "Test.mkv", duration: 600 });
      await waitFor(() => viewer.currentItem !== null && host.currentItem !== null);
      for (const p of [hp.p, vp.p]) p.length = 600;
      host.play();
      await waitFor(() => viewer.engine.anchor?.state === "playing");
      await sleep(2000);

      let closed = "";
      viewer.closed.on((r) => (closed = r));
      const selfId = viewer.self!.id;
      viewer.simulateNetworkDrop();
      await waitFor(() => viewer.reconnecting);
      await sleep(1000);
      expect(vp.p.paused).toBe(false); // keeps playing on the last anchor while offline
      await waitFor(() => !viewer.reconnecting, 20_000);
      expect(closed).toBe("");
      expect(viewer.self?.id).toBe(selfId); // same seat, same viewer
      expect(host.viewers.filter((v) => v.name === "Viewer")).toHaveLength(1);

      host.seek(200); // anchors still reach the reconnected viewer
      await waitFor(() => (viewer.engine.anchor?.position ?? 0) >= 200);
      await sleep(2500);
      await converges(hp.p, vp.p);
    } finally {
      viewer.dispose();
      host.dispose();
      hp.stop();
      vp.stop();
    }
  });

  it("a long gap between ticks (sleep, frozen tab) runs a full clock burst (C-11.23)", { timeout: 30_000 }, async () => {
    const { session: host } = await ScreenSession.create(
      api!,
      await identity(),
      new SimPlayer(),
      { name: "web gap test", visibility: "public" },
      "Host",
    );
    try {
      const internals = host as unknown as { lastTick: number; pingBurst(n: number): Promise<void> };
      const burst = vi.spyOn(internals, "pingBurst");
      internals.lastTick -= 10_000; // as if the device slept for 10 s
      await waitFor(() => burst.mock.calls.length > 0, 3000);
      expect(burst.mock.calls[0]![0]).toBe(8);
      await sleep(1500);
      expect(host.clock.isSynced).toBe(true);
    } finally {
      host.dispose();
    }
  });

  it("YouTube items end once every viewer reports the end (C-14.8)", { timeout: 30_000 }, async () => {
    const { session: host, created } = await ScreenSession.create(
      api!,
      await identity(),
      new SimPlayer(),
      { name: "web yt end test", visibility: "public" },
      "Host",
    );
    const viewer = await ScreenSession.joinResolved(
      api!,
      await identity(),
      new SimPlayer(),
      (await api!.resolve(created.code))!,
      "Viewer",
      null,
    );
    try {
      host.addToPlaylist([
        { kind: "youtube", name: "A video", duration: null, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { kind: "local", name: "Next.mkv", duration: 60 },
      ]);
      await waitFor(() => viewer.currentItem?.kind === "youtube");
      const yt = viewer.currentItem!.id;
      host.reportEnded(yt);
      await sleep(800);
      expect(viewer.currentItem?.id).toBe(yt); // still waiting for the viewer
      viewer.reportEnded(yt);
      await waitFor(() => viewer.currentItem?.name === "Next.mkv");
    } finally {
      viewer.dispose();
      host.dispose();
    }
  });

  it("a co-host stands in while the host is away and hands back when they return (C-7.4, C-7.7)", { timeout: 60_000 }, async () => {
    const hostId = await identity();
    const { session: host, created } = await ScreenSession.create(
      api!,
      hostId,
      new SimPlayer(),
      { name: "web acting host test", visibility: "public" },
      "Host",
    );
    const resolved = (await api!.resolve(created.code))!;
    const co = await ScreenSession.joinResolved(api!, await identity(), new SimPlayer(), resolved, "Co", null);
    let back: ScreenSession | null = null;
    try {
      await waitFor(() => host.viewers.length === 2);
      host.setCoHost(co.self!.id, true);
      await waitFor(() => co.self?.coHost === 1);
      expect(co.engine.isHost).toBe(false);

      host.dispose(); // the host leaves
      await waitFor(() => !!co.self?.actingHost);
      expect(co.engine.isHost).toBe(true); // the acting host now leads the timeline
      await waitFor(() => co.chat.some((m) => m.kind === "system" && /standing in/i.test(m.text ?? "")));

      back = await ScreenSession.joinResolved(api!, hostId, new SimPlayer(), resolved, "Host", null); // same device: the owner
      expect(back.isHost).toBe(true);
      await waitFor(() => co.self?.actingHost === false);
      expect(co.engine.isHost).toBe(false);
      expect(co.self?.coHost).toBe(1);
    } finally {
      co.dispose();
      back?.dispose();
      host.dispose();
    }
  });

  it("reports a closed screen to its viewers", { timeout: 30_000 }, async () => {
    const { session: host, created } = await ScreenSession.create(
      api!,
      await identity(),
      new SimPlayer(),
      { name: "web close test", visibility: "public" },
      "Host",
    );
    const viewer = await ScreenSession.joinResolved(
      api!,
      await identity(),
      new SimPlayer(),
      (await api!.resolve(created.code))!,
      "Viewer",
      null,
    );
    let reason = "";
    viewer.closed.on((r) => (reason = r));
    host.closeScreen();
    await waitFor(() => reason !== "");
    expect(reason).toBe("closed");
    host.dispose();
    expect(await api!.resolve(created.code)).toBeNull();
    await expect(api!.createScreen({ name: "", visibility: "public" })).rejects.toBeInstanceOf(TheatreError);
  });
});
