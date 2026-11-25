// Browser end-to-end test: two headless browser profiles (host and viewer) in one screen, playing a generated video.
//   npm run build && npx vite preview --port 4173   (in one terminal)
//   npx wrangler dev                                 (theatre, in the main repo's theatre/)
//   node scripts/e2e.mjs [appUrl] [theatreUrl] [screenshotDir]
// Uses the installed Microsoft Edge (or Chrome with KINO_BROWSER=chrome); nothing is downloaded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const app = process.argv[2] ?? "http://localhost:4173";
const theatre = process.argv[3] ?? "http://127.0.0.1:8787";
const shots = process.argv[4] ?? null;
const channel = process.env.KINO_BROWSER === "chrome" ? "chrome" : "msedge";
const muxer = readFileSync(new URL("../node_modules/webm-muxer/build/webm-muxer.js", import.meta.url), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, bypassCSP: true }); // the test injects its video encoder
    await ctx.addInitScript((n) => localStorage.setItem("kino.name", n), name);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] page error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && console.log(`[${name}] console: ${m.text()}`));
    return page;
  };
  const host = await open("Host");
  const viewer = await open("Viewer");
  const q = `?theatre=${encodeURIComponent(theatre)}`;
  await host.goto(`${app}/${q}`);

  // A 90 s VP8 test video with a burned-in timecode, encoded in the page (WebCodecs) and muxed with webm-muxer.
  await host.addScriptTag({ content: muxer });
  const b64 = await host.evaluate(async () => {
    const W = 320,
      H = 180,
      FPS = 25,
      SECONDS = 90;
    const { Muxer, ArrayBufferTarget } = window.WebMMuxer;
    const target = new ArrayBufferTarget();
    const mux = new Muxer({ target, video: { codec: "V_VP8", width: W, height: H, frameRate: FPS } });
    const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => console.error(e) });
    enc.configure({ codec: "vp8", width: W, height: H, bitrate: 200_000, framerate: FPS });
    const canvas = new OffscreenCanvas(W, H);
    const g = canvas.getContext("2d");
    for (let i = 0; i < FPS * SECONDS; i++) {
      g.fillStyle = `hsl(${(i * 3) % 360} 60% 30%)`;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#fff";
      g.font = "bold 48px monospace";
      g.fillText((i / FPS).toFixed(2), 40, 110);
      const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(f, { keyFrame: i % FPS === 0 });
      f.close();
      if (enc.encodeQueueSize > 30) await new Promise((r) => setTimeout(r, 0));
    }
    await enc.flush();
    mux.finalize();
    const bytes = new Uint8Array(target.buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const video = Buffer.from(b64, "base64");
  check(video.length > 10_000, `generated test video (${(video.length / 1024).toFixed(0)} KB)`);

  // Host creates a screen and opens the file.
  await host.getByRole("button", { name: /Create a screen/ }).click();
  await host.getByPlaceholder("Movie night").fill("Browser e2e");
  await host.locator(".dialog .actions .primary").click();
  await host
    .locator(".topbar")
    .waitFor()
    .catch(async (e) => {
      throw new Error(`no screen view; page says: ${await host.locator("#root").innerText()}`, { cause: e });
    });
  const code = (await host.locator(".topbar .badge.mono").textContent()).trim();
  check(/^[0-9A-Z]{6}$/.test(code), `host created screen ${code}`);

  const [chooser] = await Promise.all([host.waitForEvent("filechooser"), host.getByRole("button", { name: "Open files…" }).click()]);
  await chooser.setFiles({ name: "Test Clip.webm", mimeType: "video/webm", buffer: video });
  await host.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 15_000 });
  check(true, "host's file loaded");

  // Viewer joins by invite link and picks their copy (different name, same length → likely match).
  await viewer.goto(`${app}/${q}#local/${code}`);
  await viewer.getByText("Choose your copy").waitFor({ timeout: 15_000 });
  const [vc] = await Promise.all([viewer.waitForEvent("filechooser"), viewer.getByRole("button", { name: "Choose file…" }).click()]);
  await vc.setFiles({ name: "my copy.webm", mimeType: "video/webm", buffer: video });
  await viewer.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 15_000 });
  check(true, "viewer joined and loaded their copy");

  const state = (p) =>
    p.evaluate(() => ({ t: document.querySelector("video").currentTime, paused: document.querySelector("video").paused }));
  const both = async () => {
    const [h, v] = await Promise.all([state(host), state(viewer)]);
    return { h, v, gap: Math.abs(h.t - v.t) };
  };

  // Play.
  await host.locator("body").press(" ");
  await sleep(5000);
  let s = await both();
  check(!s.h.paused && !s.v.paused, `both playing (host ${s.h.t.toFixed(2)} s, viewer ${s.v.t.toFixed(2)} s)`);
  check(s.gap < 0.1, `in sync after play: ${(s.gap * 1000).toFixed(0)} ms apart`);

  // Seek +20 s (4 × →).
  for (let i = 0; i < 4; i++) await host.locator("body").press("ArrowRight");
  await sleep(4000);
  s = await both();
  check(s.h.t > 25, `host jumped ahead (${s.h.t.toFixed(2)} s)`);
  check(s.gap < 0.1, `in sync after seek: ${(s.gap * 1000).toFixed(0)} ms apart`);

  // Watch for a while: drift stays small.
  await sleep(8000);
  s = await both();
  check(s.gap < 0.08, `still in sync 8 s later: ${(s.gap * 1000).toFixed(0)} ms apart`);
  const readout = await viewer.locator(".sync-readout").textContent();
  console.log(`     viewer readout: ${readout}`);

  // Statuses reach the host.
  const statuses = await host.locator(".side .list-item").allTextContents();
  console.log(`     host's viewer list: ${statuses.join(" | ")}`);
  check(
    statuses.some((t) => t.includes("Viewer") && t.includes("in sync")),
    "viewer shows as in sync for the host",
  );

  // Pause.
  await host.locator("body").press(" ");
  await sleep(1500);
  s = await both();
  check(s.h.paused && s.v.paused, "both paused");
  check(s.gap < 0.06, `paused at the same frame: ${(s.gap * 1000).toFixed(0)} ms apart`);

  if (shots) {
    await host.screenshot({ path: join(shots, "e2e-host.png") });
    await viewer.screenshot({ path: join(shots, "e2e-viewer.png") });
  }

  // Viewer leaves; host sees it.
  await viewer.getByRole("button", { name: "Leave" }).click();
  await viewer.locator(".lobby").waitFor();
  await host.waitForFunction(() => document.querySelectorAll(".side .list-item").length === 1, null, { timeout: 10_000 });
  check(true, "viewer left and the host's list updated");
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
