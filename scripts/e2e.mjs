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
  const readout = await viewer.locator(".sync-readout").first().textContent();
  console.log(`     viewer readout: ${readout}`);

  // Personal offset (C-11.20): +500 ms makes this viewer's target 0.5 s later; it is remembered locally.
  await viewer.getByTitle("Personal sync offset").click();
  for (let i = 0; i < 10; i++) await viewer.getByRole("button", { name: "+50", exact: true }).click();
  await sleep(1500);
  const offsetDrift = await viewer.locator(".sync-readout").first().textContent();
  const stored = await viewer.evaluate(() => localStorage.getItem("kino.offsetMs"));
  check(stored === "500", `offset remembered locally (${stored})`);
  const driftMs = Number(/([+-]\d+) ms/.exec(offsetDrift ?? "")?.[1] ?? "0");
  check(
    Math.abs(driftMs + 500) < 150 || /Catching|Jumping|Settling/.test(offsetDrift ?? ""),
    `offset applied to the target (${offsetDrift})`,
  );
  await viewer.getByRole("button", { name: "Reset", exact: true }).click();
  await viewer.getByTitle("Personal sync offset").click();
  await sleep(4000);

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

  // Playback commands the host sends, to check that one action sends exactly one.
  await host.evaluate(() => {
    window.__sent = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      const m = /"type":"(play|pause)"/.exec(typeof d === "string" ? d : "");
      if (m) window.__sent.push(m[1]);
      return orig.call(this, d);
    };
  });
  const hostSent = () => host.evaluate(() => window.__sent.splice(0));

  // A double-click on the picture is fullscreen only: it doesn't play and pause for everyone.
  await host.locator("video").dblclick();
  await sleep(1500);
  if (await host.evaluate(() => !!document.fullscreenElement)) await host.evaluate(() => document.exitFullscreen());
  check((await hostSent()).length === 0, "a double-click on the video sends no play or pause");
  // A single click plays.
  await host.locator("video").click();
  await sleep(1500);
  check((await hostSent()).join(",") === "play", "a single click on the video plays");
  // Space while the play button has focus presses it once (not the button and the shortcut both).
  await host.getByTitle("Pause (space)").click();
  await sleep(1000);
  await host.getByTitle("Play (space)").press(" ");
  await sleep(1500);
  const pressed = (await hostSent()).join(",");
  check(pressed === "pause,play", `clicking the play button, then Space on it, toggles twice in all (${pressed})`);
  await host.locator("body").press(" ");
  await sleep(1500);
  check((await hostSent()).join(",") === "pause", "Space elsewhere toggles once");

  // Diagnostics (screen settings): a log of anchors, commands and player actions, downloaded as a text file.
  await viewer.getByRole("button", { name: "Settings" }).click();
  const [dl] = await Promise.all([viewer.waitForEvent("download"), viewer.getByRole("button", { name: "Download diagnostics" }).click()]);
  const logText = readFileSync(await dl.path(), "utf8");
  check(
    /^# Kino web/m.test(logText) &&
      /recv\s+anchor \{/.test(logText) &&
      /player\s+(seek|play|pause)/.test(logText) &&
      /video\s+seeked/.test(logText),
    `diagnostics download has anchors, player actions and video events (${logText.split("\n").length} lines)`,
  );
  check(!logText.includes("my copy.webm"), "diagnostics don't contain local file names");
  await viewer.locator(".dialog").getByRole("button", { name: "Done" }).click();

  // Media keys go through the screen: the OS media overlay shows the current item (C-12.10).
  const title = await host.evaluate(() => navigator.mediaSession?.metadata?.title ?? null);
  check(title === "Test Clip.webm", `media session shows the current item (${title})`);

  // Chat (C-18): a message from the host shows as unread for the viewer, then in their Chat tab.
  await host.getByRole("button", { name: /^Chat/ }).click();
  await host.getByLabel("Chat message").fill("hello from the host");
  await host.getByLabel("Chat message").press("Enter");
  const badge = await viewer
    .locator(".tabs .unread")
    .textContent({ timeout: 10_000 })
    .catch(() => null);
  check(badge === "1", `viewer's Chat tab shows 1 unread (${badge})`);
  await viewer.getByRole("button", { name: /^Chat/ }).click();
  const got = await viewer
    .locator(".msg .text", { hasText: "hello from the host" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(got, "viewer sees the host's message");
  check((await viewer.locator(".tabs .unread").count()) === 0, "opening Chat clears the unread count");
  const history = await viewer.locator(".msg.system", { hasText: "Now playing" }).count();
  check(history > 0, "a late joiner sees messages from before they joined (history)");
  const systemCount = await host.locator(".msg.system").count();
  check(systemCount > 0, `system messages are shown (${systemCount})`);

  // A pasted GIF link is sent as a GIF, without a GIPHY key (C-18.5).
  await viewer.getByLabel("Chat message").fill("https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif");
  await viewer.getByLabel("Chat message").press("Enter");
  const gifShown = await host
    .locator(".msg img.gif")
    .waitFor({ state: "attached", timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(gifShown, "a pasted GIF link arrives as a GIF");

  // A reaction floats over everyone's video (C-18.3).
  await viewer.getByTitle("React 🎉").click();
  const floated = await host
    .locator(".float-reaction", { hasText: "🎉" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(floated, "a reaction floats over the host's video");
  if (shots) await host.screenshot({ path: join(shots, "e2e-chat.png") });

  // Over the chat limit (5 messages per 5 s), the notice shows next to the input (C-18.7).
  for (let i = 1; i <= 6; i++) {
    await host.getByLabel("Chat message").fill(`quick ${i}`);
    await host.getByLabel("Chat message").press("Enter");
  }
  const slow = await host
    .locator(".chat-notice", { hasText: "Slow down" })
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  check(slow, 'going over the chat limit shows "Slow down a little" in the chat panel');
  await sleep(5500); // let the window pass before the next chat action

  // GIF search with the user's own GIPHY key (C-18.4); only when a key is provided.
  if (process.env.KINO_GIPHY_KEY) {
    await host.getByRole("button", { name: "GIF", exact: true }).click();
    await host.getByPlaceholder("GIPHY API key").fill(process.env.KINO_GIPHY_KEY);
    await host.locator(".gif-picker").getByRole("button", { name: "Save" }).click();
    const first = host.locator(".gif-cell").first();
    const found = await first.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    check(found, "GIPHY trending results appear in the picker");
    if (found) {
      await first.click();
      const two = await viewer
        .waitForFunction(() => document.querySelectorAll(".msg img.gif").length >= 2, null, { timeout: 10_000 })
        .then(
          () => true,
          () => false,
        );
      check(two, "a GIF picked from search reaches the viewer");
    }
  } else console.log("     (GIF search skipped: set KINO_GIPHY_KEY to test it)");

  // A link the server refuses says so, instead of blaming the format.
  await host.getByRole("button", { name: /^Playlist/ }).click();
  await host.getByRole("button", { name: "＋ Link" }).click();
  await host.getByPlaceholder("https://…").fill(`${theatre}/no-such-video.mp4`);
  await host.locator(".dialog .actions .primary").click();
  const badRow = host.locator(".side .list-item", { hasText: "no-such-video" });
  await badRow.waitFor();
  await badRow.getByTitle("Play now").click();
  const refusedText = await host
    .getByText(/The link answered 404/)
    .first()
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );
  check(refusedText, 'a refused link says "The link answered 404…"');
  await badRow.getByTitle("Remove").click();
  await badRow.waitFor({ state: "detached" });
  const clipRow = host.locator(".side .list-item", { hasText: "Test Clip" });
  if (!(await clipRow.evaluate((e) => e.classList.contains("current")))) await clipRow.getByTitle("Play now").click();
  await host.waitForFunction(() => document.querySelector(".side .list-item.current")?.textContent?.includes("Test Clip"), null, {
    timeout: 10_000,
  });

  // YouTube doesn't play in the web client yet, so web viewers report it ended at once and the screen moves on to the
  // next item by itself instead of waiting forever (C-14.8).
  await host.getByRole("button", { name: "＋ Link" }).click();
  await host.getByPlaceholder("https://…").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await host.locator(".dialog .actions .primary").click();
  const ytRow = host.locator(".side .list-item", { hasText: "YouTube" });
  await ytRow.waitFor();
  await ytRow.getByTitle("Move up").click();
  await host.waitForFunction(() => document.querySelector(".side .list-item")?.textContent?.includes("YouTube"), null, { timeout: 10_000 });
  await ytRow.getByTitle("Play now").click();
  const advanced = await host
    .waitForFunction(
      () => {
        const cur = document.querySelector(".side .list-item.current")?.textContent ?? "";
        return cur.includes("Test Clip") && document.querySelector("video").currentTime < 3;
      },
      null,
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(advanced, "a YouTube item doesn't hold up a screen of web viewers: it moved on to the next item");
  await host.getByRole("button", { name: /^Viewers/ }).click();

  // Screen settings (C-5.11): the host renames and limits the screen; every client follows; viewers see them read-only.
  await host.getByRole("button", { name: "Settings", exact: true }).click();
  await host.locator(".dialog label.field", { hasText: "Name" }).locator("input").fill("Browser e2e renamed");
  await host.locator(".dialog label.field", { hasText: "Max viewers" }).locator("input").fill("5");
  await host.locator(".dialog").getByRole("button", { name: "Save" }).click();
  const renamed = await viewer
    .locator(".topbar .title", { hasText: "Browser e2e renamed" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(renamed, "a renamed screen shows the new name for the viewer");
  await host.locator(".dialog").getByRole("button", { name: "Done" }).click();
  await viewer.getByRole("button", { name: "Settings", exact: true }).click();
  const readOnly = (await viewer.getByText("Only the host or someone with permission can change these.").count()) > 0;
  const nameEditable = await viewer.locator(".dialog label.field", { hasText: "Name" }).locator("input").isEditable();
  check(readOnly && !nameEditable, "viewers without permission see the settings read-only");
  await viewer.locator(".dialog").getByRole("button", { name: "Done" }).click();

  // Ready check (C-11.19): the host asks, the viewer sees the tally and answers, the result shows.
  await host.getByRole("button", { name: "Ready check" }).click();
  const prompt = await viewer
    .locator(".banner", { hasText: "asks: ready?" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  const tally = prompt ? await viewer.locator(".banner", { hasText: "asks: ready?" }).textContent() : "";
  check(prompt && /1 of 2 ready · \d+ s/.test(tally ?? ""), `viewer sees the prompt with a tally and countdown (${tally?.trim()})`);
  await viewer.locator(".banner").getByRole("button", { name: "Ready", exact: true }).click();
  const everyone = await host
    .locator(".banner", { hasText: "Everyone is ready" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(everyone, 'the result "Everyone is ready" shows when all have answered');

  // Invite (C-6.9, C-6.10): copy code and a sharing sentence; a new code needs confirming and reaches every client.
  const oldCode = (await host.locator(".topbar .badge.mono").textContent()).trim();
  await host.getByRole("button", { name: "Invite" }).click();
  const sentence = await host.locator(".dialog label.field", { hasText: "Message to share" }).locator("input").inputValue();
  check(
    sentence.includes(oldCode) && sentence.startsWith("Join my screen on Kino:"),
    "the invite panel has a sharing sentence with the code",
  );
  check((await host.getByRole("button", { name: "Copy code" }).count()) === 1, "the invite panel can copy the code");
  await host.getByRole("button", { name: "New code…" }).click();
  check((await host.getByText("The old code and links stop working").count()) === 1, "a new code asks for confirmation first");
  await host.locator(".dialog .actions").getByRole("button", { name: "New code", exact: true }).click();
  const newCodeShown = await viewer
    .waitForFunction((old) => (document.querySelector(".topbar .badge.mono")?.textContent ?? old).trim() !== old, oldCode, {
      timeout: 10_000,
    })
    .then(
      () => true,
      () => false,
    );
  check(newCodeShown, "the new code reaches the viewer");
  await host.waitForFunction((old) => document.querySelector(".topbar .badge.mono")?.textContent?.trim() !== old, oldCode, {
    timeout: 10_000,
  });
  const code2 = (await host.locator(".topbar .badge.mono").textContent()).trim();
  const oldGone = (await fetch(`${theatre}/resolve/${oldCode}`)).status === 404;
  check(oldGone && code2 !== oldCode, `the old code stops working (${oldCode} → ${code2})`);
  await host.locator(".dialog").getByRole("button", { name: "Done" }).click();

  // People (step 4): the actions menu, roles, overrides, co-hosts and handing over the host role.
  const menuFor = async (page, name) => {
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    return page.locator(".menu");
  };
  await host.getByRole("button", { name: /^Viewers/ }).click();
  check((await host.locator(".viewer", { hasText: "Viewer" }).locator(".device-icon").count()) === 1, "viewer rows show a device icon");
  check((await host.locator(".viewer .ping-good, .viewer .ping-fair, .viewer .ping-poor").count()) >= 1, "pings have colour bands");

  // Chat mute (C-9.1, C-18.7).
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Chat-mute" }).click();
  const mutedInput = await viewer
    .waitForFunction(
      () => document.querySelector("textarea[aria-label='Chat message']")?.placeholder === "You are muted in this screen.",
      null,
      { timeout: 10_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(mutedInput, 'a muted viewer\'s chat input says "You are muted in this screen."');
  const muteIcon = await host
    .locator(".viewer", { hasText: "Viewer" })
    .getByTitle("Chat-muted")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(muteIcon, "the muted viewer shows the chat-muted icon");
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Unmute chat" }).click();
  const unmuted = await viewer
    .waitForFunction(() => !document.querySelector("textarea[aria-label='Chat message']")?.disabled, null, { timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(unmuted, "unmuting gives the input back");

  // A new role with one permission, assigned from the menu (C-8.5.2, C-8.6).
  await host.getByRole("button", { name: "Roles", exact: true }).click();
  await host.getByRole("button", { name: "＋ New role" }).click();
  await host.locator(".dialog label.field", { hasText: "Name" }).locator("input").fill("DJ");
  await host.getByLabel("Add local files").check();
  await host.locator(".dialog").getByRole("button", { name: "Create" }).click();
  const listed = await host
    .locator(".dialog .list-item", { hasText: "DJ" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(listed, "a new role appears on the roles page");
  if (shots) await host.screenshot({ path: join(shots, "e2e-roles.png") });
  await host.locator(".dialog").getByRole("button", { name: "Done" }).click();
  await viewer.getByRole("button", { name: /^Playlist/ }).click();
  check(await viewer.getByRole("button", { name: "＋ Files" }).isDisabled(), "a viewer can't add files by default");
  await (await menuFor(host, "Viewer")).getByRole("menuitemcheckbox", { name: "DJ" }).click();
  const canAdd = await viewer
    .getByRole("button", { name: "＋ Files" })
    .isEnabled({ timeout: 10_000 })
    .then(async (e) => e || (await sleep(1500), viewer.getByRole("button", { name: "＋ Files" }).isEnabled()));
  check(canAdd, "the assigned role's permission reaches the viewer (＋ Files enabled)");
  check(
    (await host.locator(".viewer", { hasText: "Viewer" }).locator(".badge.role", { hasText: "DJ" }).count()) === 1,
    "the role shows on the viewer's row",
  );

  // A per-viewer override (C-8.7): deny chat.
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Permissions…" }).click();
  await host.locator(".dialog").getByLabel("Send messages").selectOption("deny");
  await host.locator(".dialog").getByRole("button", { name: "Save" }).click();
  await viewer.getByRole("button", { name: /^Chat/ }).click();
  const denied = await viewer
    .waitForFunction(
      () => document.querySelector("textarea[aria-label='Chat message']")?.placeholder === "You can't chat in this screen.",
      null,
      { timeout: 10_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(denied, 'a Deny override takes chat away ("You can\'t chat in this screen.")');
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Permissions…" }).click();
  await host.locator(".dialog").getByLabel("Send messages").selectOption("inherit");
  await host.locator(".dialog").getByRole("button", { name: "Save" }).click();

  // Co-host, then hand the host role over and back (C-7.1, C-7.8).
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Make co-host" }).click();
  const co = await host
    .locator(".viewer", { hasText: "Viewer" })
    .locator(".badge", { hasText: "co-host #1" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(co, 'Make co-host shows "co-host #1"');
  if (shots) {
    await menuFor(host, "Viewer");
    await host.screenshot({ path: join(shots, "e2e-viewers.png") });
    await host.keyboard.press("Escape");
  }
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Make host…" }).click();
  check((await host.getByText("Make Viewer the host? You become co-host #1.").count()) === 1, "handing over asks first");
  await host.locator(".dialog").getByRole("button", { name: "Make host", exact: true }).click();
  await viewer.getByRole("button", { name: /^Viewers/ }).click();
  const viewerIsHost = await viewer
    .locator(".viewer", { hasText: "you" })
    .locator(".badge.host", { hasText: "host" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(viewerIsHost, "the viewer is now the host");
  await (await menuFor(viewer, "Host")).getByRole("menuitem", { name: "Make host…" }).click();
  await viewer.locator(".dialog").getByRole("button", { name: "Make host", exact: true }).click();
  const hostBack = await host
    .locator(".viewer", { hasText: "you" })
    .locator(".badge.host", { hasText: "host" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(hostBack, "and hands it back");
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Remove co-host" }).click();
  await viewer.getByRole("button", { name: /^Chat/ }).click();

  // Viewer leaves; host sees it.
  await viewer.getByRole("button", { name: "Leave" }).click();
  await viewer.locator(".lobby").waitFor();
  await host.waitForFunction(() => document.querySelectorAll(".side .list-item").length === 1, null, { timeout: 10_000 });
  check(true, "viewer left and the host's list updated");

  // Pasting an invite link into the code box joins that screen (C-6.2).
  await viewer.getByLabel("Screen code or invite link").fill(`https://kino-directory.srie.workers.dev/join#local/${code2.toLowerCase()}`);
  await viewer.getByRole("button", { name: "Join", exact: true }).click();
  const rejoined = await viewer
    .locator(".topbar")
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );
  check(rejoined, "a pasted invite link in the code box joins the screen");

  // Kick (C-9.2): back to the lobby with the reason; they can come back.
  await host.getByRole("button", { name: /^Viewers/ }).click();
  await (await menuFor(host, "Viewer")).getByRole("menuitem", { name: "Kick" }).click();
  const kicked = await viewer
    .getByText("You were removed from the screen.")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(kicked, 'a kicked viewer returns to the lobby with "You were removed from the screen."');
  await viewer.getByLabel("Screen code or invite link").fill(`local/${code2}`);
  await viewer.getByRole("button", { name: "Join", exact: true }).click();
  check(
    await viewer
      .locator(".topbar")
      .waitFor({ timeout: 15_000 })
      .then(
        () => true,
        () => false,
      ),
    "a kicked viewer can rejoin",
  );

  // Ban (C-9.3), with a third browser: confirmed first, removed, and can't come back.
  const guest = await open("Guest");
  await guest.goto(`${app}/${q}#local/${code2}`);
  await guest.locator(".topbar").waitFor({ timeout: 15_000 });
  await (await menuFor(host, "Guest")).getByRole("menuitem", { name: "Ban…" }).click();
  check((await host.getByText("Ban Guest from this screen? They can't come back.").count()) === 1, "banning asks first");
  await host.locator(".dialog").getByRole("button", { name: "Ban", exact: true }).click();
  const banned = await guest
    .getByText("You are banned from this screen.")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(banned, "a banned viewer is removed with the reason");
  await guest.getByLabel("Screen code or invite link").fill(`local/${code2}`);
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  const refused = await guest
    .getByText("You can't join this screen.")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(refused, "and can't rejoin");

  // The host closes the screen (C-5.13): it asks first; the viewer returns to the lobby with the reason.
  await host.getByRole("button", { name: "Settings", exact: true }).click();
  await host.getByRole("button", { name: "Close screen…" }).click();
  check((await host.getByText("Close the screen for everyone?").count()) === 1, "closing asks first");
  await host.getByRole("button", { name: "Close it" }).click();
  const told = await viewer
    .getByText("The host closed the screen.")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(told, 'the viewer returns to the lobby with "The host closed the screen."');
  check((await fetch(`${theatre}/resolve/${code2}`)).status === 404, "a closed screen's code no longer resolves");
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
