# Kino for the web roadmap

The web checklist for [Kino Enhanced](https://github.com/Sriharan-S/kino-enhanced). It follows the
**[master roadmap](https://github.com/Sriharan-S/kino-enhanced/blob/main/ROADMAP.md)**, which holds every common task's description and acceptance criteria; this file adds where
each one lives in this repo, what tests cover it, the web-only work, and the plan for catching up with Windows.

- Spec: [wiki docs](https://github.com/Sriharan-S/kino-enhanced/wiki/docs) (cited as §n; the web client is §21.1).
- Live: <https://kino-web.srie.workers.dev>.
- This file replaces section 18 of the old main README checklist; the mapping is at the end.

## How to use this roadmap

- **IDs.** `WEB-x.y` is the web side of common task `C-x.y` (same numbers). `WEB-x.Pn` is **platform-only**: web
  work with no common task (the Common column says "Platform-only", or names the common task it serves). IDs are never
  renumbered or reused.
- **Status.** ✅ done · 🟨 partial · ⬜ not started · ⏸ on hold. A row is ✅ only when it meets the master roadmap's
  [definition of done](https://github.com/Sriharan-S/kino-enhanced/blob/main/ROADMAP.md#definition-of-done): implemented, covered by automated tests (or "UI: manual" for purely
  presentational criteria until WEB-21.5 adds UI tests), and verified by hand in a real browser.
- **Updating.** Change a status only after looking at the code and tests. Change the same row's Web column in the
  master roadmap in the same piece of work; for common tasks the master is the authority. The tables below were
  generated from the master on the audit date, so they match it.
- **Where.** Paths are relative to `src/` unless they start with `test/`, `scripts/` or `public/`; `file.ts:12` is
  a line at the audit commit. "API only" means `core/session.ts` or `core/net.ts` can do it but no UI calls it.
- **Tests.** "unit" is Vitest in `test/`; "live" is `test/live.test.ts` against a theatre (`KINO_THEATRE`); "e2e" is
  `scripts/e2e.mjs` (two headless Chrome profiles); "UI: manual" means checked by hand only.

Rows: ✅ 122 · 🟨 41 · ⬜ 124 · ⏸ 3 (every row below, platform-only items and the design phase included).

Audited on 2026-11-25 at commit `298c94b`.

## Gap audit

The web build was checked against every spec section and every feature of the Windows app, UI included (not only
`session.ts`). Known before the audit:

| Gap | Rows |
|---|---|
| YouTube doesn't play (`player/controller.ts` says "Use Kino for Windows") | WEB-14.5 to WEB-14.10, WEB-14.P1 |
| No chat, GIF or reaction UI (reactions only appear as toasts) | WEB-18.1 to WEB-18.7 |
| No roles or permissions UI | WEB-8.2, WEB-8.5 to WEB-8.7 |
| No moderation UI (mute, kick, ban, overrides) | WEB-9.1 to WEB-9.4, WEB-8.7 |
| No co-host management or host transfer | WEB-7.1, WEB-7.2, WEB-7.8 |
| No close-screen action | WEB-5.13.1 |
| Screen settings: only auto-advance | WEB-5.11.1 to WEB-5.11.5, WEB-5.11.7 |
| No button to start a ready check | WEB-11.19.1 |
| No buffering-policy setting | WEB-5.11.7 |
| No subtitles (the upload and download APIs exist, unused) | WEB-17.x, WEB-17.P1 |
| No personal offset control (the engine supports it) | WEB-11.20 |
| No zoom, aspect or fit options | WEB-16.1 to WEB-16.3 |
| Volume and preferences not remembered | WEB-16.6 |
| Playlist reorder is "Move up" only | WEB-13.7 |
| No "Match my files" or folder matching | WEB-13.2, WEB-13.14, WEB-13.P1 |

Found in this audit:

| # | Gap | Rows |
|---|---|---|
| 1 | **A web viewer blocks every YouTube item.** The theatre leaves a YouTube item only when every connected viewer has sent `item.ended`; the web client can't play YouTube and never sends it, so the screen sits at the end until someone presses Next. | WEB-14.8 |
| 2 | URL items are added with `duration: null`, so the theatre never ends them and auto-advance stops after a link (Windows has the same gap). | WEB-14.3 |
| 3 | Ready check: besides the missing start button, there is no live tally, no countdown and no result (the result is posted only to chat). | WEB-11.19.3 to WEB-11.19.5 |
| 4 | System messages (joins, leaves, now playing, handover, kicks, subtitle shares, hold and ready results) are received but never shown; chat history is stored in the session and never shown. | WEB-18.2, WEB-18.6 |
| 5 | Away co-hosts aren't listed (the `cohosts` message is ignored by the UI). | WEB-7.3 |
| 6 | Acting-host takeover works in the engine but has no automated test. | WEB-7.4 |
| 7 | Your own RTT isn't shown anywhere; others' RTT has no colour bands; devices are words, not icons. | WEB-10.5, WEB-10.6, WEB-10.3 |
| 8 | Unreachable or protocol-incompatible theatres can still be chosen in Create, with no "needs a newer Kino" hint. | WEB-4.3, WEB-4.4 |
| 9 | The manual Refresh doesn't re-measure pings; `/info` and `/lobby` time out after 5 s instead of 3 s; probing and choosing the fastest theatre have no tests. | WEB-4.10, WEB-4.11, WEB-4.2 |
| 10 | The code box takes 6 characters only, so a pasted invite link can't be used there. | WEB-6.2 |
| 11 | The invite panel has no "Copy code", and "New code" acts without confirmation. | WEB-6.9, WEB-6.10 |
| 12 | The display name can be changed only in the lobby, and applies on the next join. | WEB-3.2 |
| 13 | After a reconnect the clock re-syncs with 3 samples, not the 8-sample burst; the reconnect loop has no automated test. | WEB-3.7 |
| 14 | No immediate re-sync on an RTT jump (Windows has the same gap). | WEB-11.4 |
| 15 | The engine ticks on `setInterval`, which browsers throttle in background tabs (to once a second, and in Chrome to once a minute for silent tabs after 5 minutes), so a muted background tab drifts. | WEB-11.23, WEB-11.P1 |
| 16 | The seek bar has no hover preview time. | WEB-12.4 |
| 17 | Shortcuts ↑/↓ (volume), N/P (next, previous) and Home (restart) are missing. | WEB-12.7 |
| 18 | No audio track selection. | WEB-12.5, WEB-12.P4 |
| 19 | Hardware media keys act on the `<video>` directly, so the engine immediately undoes them; there is no Media Session integration. | WEB-12.10 |
| 20 | No Screen Wake Lock, so a phone or laptop may dim or sleep mid-film. | WEB-12.11 |
| 21 | "Open now" works only when nothing is playing; otherwise files and links are appended. | WEB-13.10 |
| 22 | No resume positions and no playback outside a screen. | WEB-13.21, WEB-13.22 |
| 23 | YouTube items are named "YouTube {id}" instead of their title. | WEB-14.9 |
| 24 | Playback errors say "format or codec not supported" without naming the codec, and there is no check when a file is added. | WEB-15.2, WEB-15.3 |
| 25 | No volume boost above 100%. | WEB-16.5, WEB-16.P1 |
| 26 | The Content-Security-Policy allows the YouTube frame but its `script-src 'self'` blocks the IFrame API script, so YouTube work must change it. | WEB-14.P1, WEB-20.P2 |
| 27 | No contract test reads `protocol/examples`. | WEB-2.3 |
| 28 | No linter, although the old checklist (18.1) said "lint". | WEB-0.7, WEB-0.P1 |
| 29 | Deploys run by hand (`npm run deploy`); CI has no deploy job, so "deployed from main" (main README) can't be confirmed from this repo. | WEB-20.2 |
| 30 | No new-version prompt, no About or version display, no changelog. | WEB-20.4, WEB-20.7, WEB-0.11 |
| 31 | The browser test runs on Chrome only (README claims Chrome, Edge, Firefox and Safari). | WEB-21.4, WEB-21.P1, WEB-20.P5 |
| 32 | After `pagehide` the session is disposed; if the browser restores the page from its back/forward cache, it shows a dead screen. | WEB-5.P1 |
| 33 | If storage is blocked (some private modes), a new device secret is made on every load, so a host loses the screen on reload, silently. | WEB-3.P2 |
| 34 | A second tab of the same profile silently replaces the first (the first is told only afterwards). | WEB-3.P1 |
| 35 | Phone browsers aren't designed for: on iOS Safari `volume` is read-only and only the `<video>` element can go fullscreen; one breakpoint at 820 px. | WEB-12.P2, WEB-12.8 |
| 36 | Files must be chosen again after every reload (object URLs), with no explanation. | WEB-13.P2 |

Shared gaps that need theatre or spec work first (C-3.2 rename, C-4.8 now playing, C-6.11 who sees the code) are in the
tables too.

## Order of work for the web

Each step is shippable on its own; the cross-platform test (WEB-21.7) runs after step 9.

1. **Stop harming others' screens:** WEB-14.8 (until YouTube plays, send `item.ended` at once and tell the viewer),
   WEB-12.10 (media keys), WEB-11.P1 (background tabs), WEB-4.4 and WEB-4.3, WEB-4.11, WEB-3.7 (8-sample burst).
2. **Chat, reactions and system messages:** WEB-18.1 to WEB-18.7, WEB-18.3.1, WEB-18.3.2 (this also makes ready-check
   results, handover and subtitle-share messages visible).
3. **Running a screen:** WEB-5.11.1 to WEB-5.11.7, WEB-5.13.1, WEB-11.19.1, WEB-11.19.3 to WEB-11.19.5, WEB-11.20,
   WEB-6.2, WEB-6.9, WEB-6.10.
4. **People:** WEB-10.3, WEB-10.5, WEB-10.6, WEB-9.4 (viewer menu), WEB-7.1 to WEB-7.4, WEB-7.8, WEB-9.1 to WEB-9.3,
   WEB-8.2, WEB-8.5 to WEB-8.7.
5. **Playlist parity:** WEB-13.2, WEB-13.P1, WEB-13.14, WEB-13.7, WEB-13.10, WEB-14.3, WEB-13.P2.
6. **YouTube:** WEB-14.P1, WEB-14.5 to WEB-14.10.
7. **Subtitles:** WEB-17.P1, WEB-17.1 to WEB-17.12.
8. **Picture and sound:** WEB-16.1 to WEB-16.6, WEB-16.P1, WEB-12.4, WEB-12.5, WEB-12.7, WEB-12.11.
9. **Formats:** WEB-15.2 to WEB-15.5.
10. **Platform:** WEB-12.P2, WEB-12.8, WEB-20.2, WEB-20.4, WEB-20.7, WEB-20.P4, WEB-20.P5, WEB-0.P1, WEB-0.11,
    WEB-2.3, WEB-21.P1, WEB-3.P1, WEB-3.P2, WEB-5.P1, WEB-13.21, WEB-13.22.


## WEB-0. Foundation and governance

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-0.1 | Repositories set up | C-0.1 | ✅ | repo, `.gitignore` |  |
| WEB-0.2 | READMEs | C-0.2 | ✅ | `README.md` |  |
| WEB-0.6 | Licence: GPL-3.0-or-later in every repo | C-0.6 | ✅ | `LICENSE`, `package.json` |  |
| WEB-0.7 | Lint, format and test tooling | C-0.7 | 🟨 | `package.json` scripts, `.prettierrc.json` | Typecheck, Prettier, Vitest; no linter (WEB-0.P1) |
| WEB-0.8 | CI on every push and pull request | C-0.8 | ✅ | `.github/workflows/ci.yml` | Typecheck, format, unit, build; then live and e2e against `wrangler dev` from the main repo |
| WEB-0.9 | Roadmaps: this file and one per platform repo | C-0.9 | ✅ | this file |  |
| WEB-0.11 | Changelog per released client | C-0.11 | ⬜ |  | No `CHANGELOG.md` |
| WEB-0.P1 | Linter: ESLint with the React hooks rules, in `npm run check` and CI | Platform-only (C-0.7) | ⬜ | `package.json` | The old checklist (18.1) said "lint"; only typecheck and Prettier exist |

## WEB-2. Protocol and contract tests

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-2.2 | Compatibility policy | C-2.2 | ✅ | `core/protocol.ts:152-181`, `core/net.ts:199-200` | unit (`parseServerMessage` ignores unknown types); `isUsable` checks the protocol range |
| WEB-2.3 | Contract tests against `protocol/examples` | C-2.3 | ⬜ |  | No test reads `protocol/examples` |
| WEB-2.5 | Error envelope and fatal closes | C-2.5 | ✅ | `core/session.ts:263-270`, `ui/common.tsx:37-62` | `describeError`; close 4000 → "replaced" |

## WEB-3. Identity and connection

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-3.1 | Display name, 1–32 characters, saved locally | C-3.1 | ✅ | `ui/App.tsx:12,195-200,258-282` | `kino.name` in local storage; asked before the first create or join; trimmed, at most 32 |
| WEB-3.2 | Change the display name at any time | C-3.2 | 🟨 | `ui/Lobby.tsx:72` | Rename only in the lobby; applies on the next join |
| WEB-3.3 | Device secret | C-3.3 | ✅ | `core/identity.ts:15-23` | UI: manual. `kino.device` (or `kino.device.<profile>`) in local storage |
| WEB-3.4 | Per-screen token | C-3.4 | ✅ | `core/identity.ts:31-33` | live (every session joins with it) |
| WEB-3.5 | Reconnect restores everything | C-3.5 | ✅ | `core/session.ts:273-308` | live (`private screens need the password; members rejoin without it`) |
| WEB-3.6 | Host ownership by owner token (one-time claim) | C-3.6 | ✅ | `core/session.ts:161-166` | live |
| WEB-3.7 | Automatic reconnect after a network drop | C-3.7 | ✅ | `core/session.ts` (`reconnectLoop`) | Delays 300 ms, 1 s, 2 s, 3 s, 5 s for 60 s; asks `/resolve` to tell a closed screen from a network failure; full 8-sample clock burst after the reconnect. Live test: `reconnects silently after a network drop` |
| WEB-3.8 | One live session per viewer | C-3.8 | ✅ | `core/session.ts:265-267` | "You joined this screen from another tab or device" |
| WEB-3.9 | Profiles: separate identities on one device | C-3.9 | ✅ | `ui/App.tsx:14`, `core/identity.ts:15` | `?profile=<name>`; UI: manual |
| WEB-3.P1 | Warn before a second tab of the same profile replaces the first | Platform-only | ⬜ |  | `BroadcastChannel`; offer "Use this tab instead" or a new profile |
| WEB-3.P2 | Blocked storage: say that identity won't persist | Platform-only | ⬜ | `core/net.ts:346-361` | `load` and `store` swallow errors, so a new device secret is made on every load |

## WEB-4. Theatre discovery and lobby

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-4.1 | Theatre list: live, then cached, then bundled | C-4.1 | ✅ | `core/net.ts:20-79` | unit (`theatre directory`). Cache `kino.servers`; 4 s directory timeout |
| WEB-4.2 | Parallel `/info` probes and theatre latency | C-4.2 | 🟨 | `core/net.ts:228-246` | No automated test of `probeAll` or `fastest` |
| WEB-4.3 | Incompatible theatres are unusable, and say why | C-4.3 | 🟨 | `core/net.ts` (`probeProblem`), `ui/Lobby.tsx` | Lobby strip and Create say "needs a newer version of Kino (reload the page)"; unit-tested. UI not yet checked by hand |
| WEB-4.4 | Unavailable theatres greyed out and not usable for create | C-4.4 | 🟨 | `ui/Lobby.tsx` | Unusable theatres are disabled in Create with the reason; Create is blocked with "No theatre is available right now" when none is usable; Refresh re-measures pings. UI not yet checked by hand |
| WEB-4.5 | Create suggests the fastest usable theatre | C-4.5 | ✅ | `ui/Lobby.tsx:239,291` | "Automatic (name, ping)" preselected; UI: manual |
| WEB-4.6 | Unified lobby across theatres | C-4.6 | ✅ | `core/net.ts:248-316` | unit (`mergeLobbies`) |
| WEB-4.7 | Listing fields | C-4.7 | ✅ | `ui/Lobby.tsx:174-191` | Theatre name as text; UI: manual |
| WEB-4.8 | "Now playing" in the listing (host setting) | C-4.8 | ⬜ |  | Not in the protocol yet |
| WEB-4.10 | Refresh and ping cadence | C-4.10 | 🟨 | `ui/Lobby.tsx:37-49,144` | Refresh fetches `/lobby` only; pings are measured once, when the lobby mounts |
| WEB-4.11 | Partial results with a 3 s per-theatre timeout | C-4.11 | ✅ | `core/net.ts` (`THEATRE_TIMEOUT_MS`) | 3 s for `/info`, `/lobby` and `/resolve` |
| WEB-4.12 | Sort, filter and search | C-4.12 | ✅ | `core/net.ts:320-342` | unit (`unified lobby`) |
| WEB-4.13 | Loading and empty states | C-4.13 | ✅ | `ui/Lobby.tsx:164-172` | UI: manual |
| WEB-4.14 | Full screens shown as full and not joinable | C-4.14 | ✅ | `ui/Lobby.tsx:175-177` | unit (full screens sort last); full rows are disabled |

## WEB-5. Screens: create, join, leave, settings, lifecycle

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-5.1 | Terminology in the UI | C-5.1 | ✅ |  | Theatre, Screen, Host, Co-host, Viewer |
| WEB-5.2 | Create a screen | C-5.2 | ✅ | `ui/Lobby.tsx:222-314` | e2e (create), live |
| WEB-5.2.1 | Name required, 1–64 | C-5.2.1 | ✅ |  | UI: manual |
| WEB-5.2.2 | Public or private, password required for private | C-5.2.2 | ✅ |  | live |
| WEB-5.2.3 | "Hide from lobby" shown only when private | C-5.2.3 | ✅ |  | UI: manual |
| WEB-5.2.4 | Max viewers 2–25, default 10 | C-5.2.4 | ✅ |  | UI: manual |
| WEB-5.3 | Internal screen ID never shown | C-5.3 | ✅ |  | UI: manual |
| WEB-5.5 | Join from the lobby | C-5.5 | ✅ | `ui/Lobby.tsx:54-59` | Resolves first; refreshes the lobby if the screen is gone |
| WEB-5.7 | Snapshot on join | C-5.7 | ✅ | `core/session.ts:244-261` | live |
| WEB-5.8 | Leave frees the seat at once | C-5.8 | ✅ | `core/session.ts:475-486`, `ui/App.tsx:188-193` | e2e (viewer leaves; the host's list updates); `pagehide` also leaves |
| WEB-5.9 | 60 s reconnect grace, shown to others | C-5.9 | ✅ | `ui/ScreenView.tsx:477,496-497` | "reconnecting…", dimmed; UI: manual |
| WEB-5.11 | Screen settings | C-5.11 | 🟨 | `ui/Settings.tsx` | Settings dialog (top bar): only changed fields are sent; follows `screen` while open; read-only with the reason without `screen.settings`; errors shown in the dialog. Unit (`settingsChanges`) and browser test; by-hand check pending |
| WEB-5.11.1 | Rename the screen | C-5.11.1 | 🟨 | `ui/Settings.tsx` | 1–64 characters. browser test: the new name reaches the viewer; by-hand check pending |
| WEB-5.11.2 | Visibility and password | C-5.11.2 | 🟨 | `ui/Settings.tsx` | Going private needs a password; an already private screen keeps its password unless a new one is given. Unit; by-hand check pending |
| WEB-5.11.3 | Hide from lobby | C-5.11.3 | 🟨 | `ui/Settings.tsx` | Only when private; going public clears it. Unit; by-hand check pending |
| WEB-5.11.4 | Max viewers | C-5.11.4 | 🟨 | `ui/Settings.tsx` | 2–25. Unit and browser test; by-hand check pending |
| WEB-5.11.5 | Show devices | C-5.11.5 | 🟨 | `ui/Settings.tsx` | Unit; by-hand check pending |
| WEB-5.11.6 | Auto-advance | C-5.11.6 | ✅ | `ui/ScreenView.tsx:538-547` | Checkbox in the Playlist tab; UI: manual |
| WEB-5.11.7 | Buffering policy | C-5.11.7 | 🟨 | `ui/Settings.tsx` | Keep playing or Wait for everyone. Unit; by-hand check pending |
| WEB-5.13 | Close the screen | C-5.13 | 🟨 | `ui/Settings.tsx` | See WEB-5.13.1 and WEB-5.13.2; by-hand check pending |
| WEB-5.13.1 | Host closes, with confirmation | C-5.13.1 | 🟨 | `ui/Settings.tsx` | "Close screen…" for the host only (not the acting host); asks "Close the screen for everyone?". browser test; by-hand check pending |
| WEB-5.13.2 | Everyone else returns to the lobby with the reason | C-5.13.2 | ✅ | `ui/App.tsx`, `core/session.ts` (`finalMessage`) | Live test; shows the theatre's own reason ("The host closed the screen."); browser test |
| WEB-5.P1 | Back/forward cache: a restored page rejoins or shows the lobby | Platform-only | ⬜ | `ui/App.tsx:188-193` | `pagehide` disposes the session; `pageshow` with `persisted` isn't handled |

## WEB-6. Invites and private screens

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-6.2 | Code entry: normalised, and accepts a pasted link | C-6.2 | 🟨 | `ui/Lobby.tsx`, `ui/App.tsx` | Spaces and dashes ignored; a pasted invite link joins that screen on that theatre. browser test; by-hand check pending |
| WEB-6.3 | Invite link formats | C-6.3 | ✅ | `core/media.ts:113-125` | unit (`invite links`) |
| WEB-6.5 | Join by code across every theatre | C-6.5 | ✅ | `core/net.ts:263-284`, `ui/App.tsx:106-141` | Parallel, first match wins, counts unreachable theatres; the parallel search has no test |
| WEB-6.6 | Private join: password prompt in place | C-6.6 | ✅ | `ui/App.tsx:77-104,284-325` | live |
| WEB-6.8 | Members rejoin without the password | C-6.8 | ✅ | `ui/App.tsx:16-31` | live; `kino.member` remembers joined screens so the password isn't asked again |
| WEB-6.9 | Invite panel: code and links with copy | C-6.9 | 🟨 | `ui/ScreenView.tsx` (`InviteDialog`) | Code with Copy code; invite link (app or browser) and browser-only link with Copy; sharing sentence. browser test; by-hand check pending |
| WEB-6.10 | Regenerate the code | C-6.10 | 🟨 | `ui/ScreenView.tsx` (`InviteDialog`) | Asks "Make a new code? The old code and links stop working." browser test: the new code reaches every client and the old one stops resolving; by-hand check pending |
| WEB-6.11 | `screen.invite` controls who sees the code | C-6.11 | ⬜ |  | Spec and code disagree (Appendix B 8) · decide first |
| WEB-6.12 | Opening invite links on each platform | C-6.12 | ✅ | `ui/App.tsx:171-186` | `#<theatre>/<code>` on load and on `hashchange`; UI: manual |

## WEB-7. Host, co-hosts and handover

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-7.1 | Appoint and remove co-hosts | C-7.1 | ⬜ | `core/session.ts:451-455` (API only) | No UI |
| WEB-7.2 | Co-host priority order | C-7.2 | ⬜ | `core/session.ts:457-464` (API only) | No UI |
| WEB-7.3 | Away co-hosts listed | C-7.3 | ⬜ |  | The `cohosts` list isn't shown |
| WEB-7.4 | Acting host takes over the timeline | C-7.4 | 🟨 | `ui/ScreenView.tsx:483`, `core/session.ts:316-321` | "acting host" badge; the engine becomes timeline authority; no automated test |
| WEB-7.5 | Acting host limits | C-7.5 | ⬜ |  | No host-only controls exist yet |
| WEB-7.8 | Transfer ownership | C-7.8 | ⬜ | `core/session.ts:447` (API only) | No UI |

## WEB-8. Roles and permissions

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-8.1 | Permission catalogue (19 permissions) | C-8.1 | ✅ | `core/protocol.ts:226-246` | Constants match the theatre |
| WEB-8.2 | Role model and limits | C-8.2 | ⬜ |  | No roles UI |
| WEB-8.4 | Resolution order; effective permissions from the theatre | C-8.4 | ✅ | `core/protocol.ts:50` | Uses `ViewerInfo.permissions` only |
| WEB-8.5 | Roles page | C-8.5 | ⬜ | `core/session.ts:436-440` (API only) | No roles page |
| WEB-8.5.1 | List roles by rank, with colour | C-8.5.1 | ⬜ |  | Not built |
| WEB-8.5.2 | Create a role | C-8.5.2 | ⬜ |  | Not built |
| WEB-8.5.3 | Edit a role | C-8.5.3 | ⬜ |  | Not built |
| WEB-8.5.4 | Delete a role | C-8.5.4 | ⬜ |  | Not built |
| WEB-8.5.5 | Built-in roles: Viewer permissions only; Co-host read-only | C-8.5.5 | ⬜ |  | Not built |
| WEB-8.6 | Assign roles to viewers | C-8.6 | ⬜ | `core/session.ts:441` (API only) | No UI |
| WEB-8.7 | Per-viewer overrides: Inherit, Allow, Deny | C-8.7 | ⬜ | `core/session.ts:442` (API only) | No UI |
| WEB-8.9 | Permission-aware UI | C-8.9 | 🟨 | `ui/ScreenView.tsx:75-78,524-527` | Playback, playlist, auto-advance and "New code" follow permissions; nothing else has UI |
| WEB-8.10 | Roles shown in the viewer list | C-8.10 | ✅ | `ui/ScreenView.tsx:486-493` | Coloured chips (role colour on text and border); UI: manual |

## WEB-9. Moderation

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-9.1 | Chat mute and unmute | C-9.1 | ⬜ | `core/session.ts:443` (API only) | "muted" badge shown; no action |
| WEB-9.2 | Kick | C-9.2 | ⬜ | `core/session.ts:444` (API only) | No action |
| WEB-9.3 | Ban | C-9.3 | ⬜ | `core/session.ts:445` (API only) | No action |
| WEB-9.4 | Viewer actions menu, filtered by rank and permission | C-9.4 | ⬜ |  | No viewer menu |
| WEB-9.5 | Being kicked or banned | C-9.5 | ✅ | `ui/common.tsx:43-50` | Back to the lobby: "You were removed from the screen" / "You can't join this screen"; UI: manual |

## WEB-10. Viewers panel: devices, latency and sync status

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-10.1 | Viewer rows: name, you, host, acting host, co-host #n | C-10.1 | ✅ | `ui/ScreenView.tsx:469-509` | UI: manual |
| WEB-10.2 | Device reported in `hello` | C-10.2 | ✅ | `core/session.ts:235` | `windows`, `web` (`linux`, `android` later) |
| WEB-10.3 | Device icon per viewer | C-10.3 | 🟨 | `ui/ScreenView.tsx:501` | Words ("web", "windows") |
| WEB-10.4 | Show devices off: no devices sent or shown | C-10.4 | ✅ | `ui/ScreenView.tsx:501` | UI: manual |
| WEB-10.5 | Own latency, updated live | C-10.5 | ⬜ | `ui/ScreenView.tsx:413-417` | The readout shows zone, drift and rate, not RTT |
| WEB-10.6 | Others' latency with colour bands | C-10.6 | 🟨 | `ui/ScreenView.tsx:502` | "45 ms" with no colour band |
| WEB-10.7 | RTT reported after every clock sync | C-10.7 | ✅ | `core/session.ts:377-384` | live (after every burst) |
| WEB-10.8 | Sync status per viewer (six states) | C-10.8 | ✅ | `ui/ScreenView.tsx:17-24,499` | Coloured words; UI: manual |
| WEB-10.9 | Status reporter: on change only, buffering after 2 s | C-10.9 | ✅ | `core/sync.ts:426-473` | unit (`StatusReporter`) |
| WEB-10.10 | Reconnecting viewers dimmed | C-10.10 | ✅ | `ui/ScreenView.tsx:477,496` | UI: manual |
| WEB-10.11 | Chat-mute icon | C-10.11 | ✅ | `ui/ScreenView.tsx:485` | UI: manual |

## WEB-11. Sync engine

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-11.1 | Sync only, never stream | C-11.1 | ✅ |  | By design: files play from memory, nothing is uploaded |
| WEB-11.2 | Clock sync burst on join | C-11.2 | ✅ | `core/sync.ts:78-116`, `core/session.ts:377-384` | unit (`ClockSync`) |
| WEB-11.3 | Periodic re-sync and smoothing | C-11.3 | ✅ | `core/session.ts:393-396`, `core/sync.ts:102-115` | unit (`blends small changes and replaces large jumps`) |
| WEB-11.4 | Immediate re-sync when RTT jumps by more than 50% | C-11.4 | ⬜ |  | Not built |
| WEB-11.5 | Anchors and `seq` ordering | C-11.5 | ✅ | `core/sync.ts:246-260` | unit (`ignores stale anchors`) |
| WEB-11.6 | Expected position (latency compensation) | C-11.6 | ✅ | `core/protocol.ts:18-20` | unit (`expected position`) |
| WEB-11.7 | Scheduled start | C-11.7 | ✅ | `core/sync.ts:304-324` | unit (`starts a scheduled start on time`) |
| WEB-11.8 | Anchors applied on arrival | C-11.8 | ✅ | `core/sync.ts:246-260` | unit (`applies a new anchor on arrival, not on the next tick`) |
| WEB-11.9 | Drift measurement | C-11.9 | ✅ | `core/sync.ts:359-365` | unit |
| WEB-11.10 | Green zone with hysteresis | C-11.10 | ✅ | `core/sync.ts:131-145` | unit (`keeps correcting until the exit threshold`) |
| WEB-11.11 | Exact seek while paused | C-11.11 | ✅ | `core/sync.ts:293-302` | unit (`pauses exactly at a paused anchor`); ignores the personal offset while paused |
| WEB-11.12 | Smooth rate controller with pitch correction | C-11.12 | ✅ | `core/sync.ts:120-151`, `player/html5.ts:10` | unit (`RateController`), e2e; `preservesPitch` |
| WEB-11.13 | Hard seek with learned seek latency | C-11.13 | ✅ | `core/sync.ts:384-406` | unit (`hard-seeks when far off, then learns the seek latency`, throttle tests) |
| WEB-11.14 | Late anchors | C-11.14 | ✅ | `core/sync.ts:349-357` | unit (`host obeys a seek that arrives after its start time`) |
| WEB-11.15 | Host re-anchor | C-11.15 | ✅ | `core/sync.ts:374-382` | unit (`host re-anchors instead of bending playback`) |
| WEB-11.16 | Late join and reconnect catch-up | C-11.16 | ✅ | `core/sync.ts:337-347` | live, e2e (within 100 ms after play and seek) |
| WEB-11.17 | Buffering policy "Wait for everyone" | C-11.17 | ✅ | `ui/ScreenView.tsx:197-206` | Banner "Waiting for …" with Resume anyway for `playback.toggle` holders; UI: manual |
| WEB-11.18 | Playlist transitions | C-11.18 | ✅ | `core/sync.ts:328-335` | unit (`a shorter copy waits at its end without seek loops`) |
| WEB-11.19 | Ready check | C-11.19 | 🟨 | `ui/Ready.tsx` | See sub-tasks; by-hand check pending |
| WEB-11.19.1 | Start a ready check | C-11.19.1 | 🟨 | `ui/ScreenView.tsx` | "Ready check" in the top bar with `screen.ready_check`. browser test; by-hand check pending |
| WEB-11.19.2 | Prompt with Ready and Not yet | C-11.19.2 | ✅ | `ui/ScreenView.tsx:207-217` | Banner with Ready and Not yet; UI: manual |
| WEB-11.19.3 | Live tally | C-11.19.3 | 🟨 | `ui/Ready.tsx` (`readyTally`) | Among connected viewers. Unit and browser test; by-hand check pending |
| WEB-11.19.4 | 30 s countdown | C-11.19.4 | 🟨 | `ui/Ready.tsx` | From the theatre's deadline. browser test; by-hand check pending |
| WEB-11.19.5 | Result shown | C-11.19.5 | 🟨 | `ui/Ready.tsx` | For 5 s over the video; also in chat (from the theatre). browser test; by-hand check pending |
| WEB-11.20 | Personal sync offset | C-11.20 | 🟨 | `ui/ScreenView.tsx` (`OffsetControl`) | ⏱ in the player bar, −2000 to +2000 ms, local only, remembered. browser test; by-hand check pending |
| WEB-11.21 | Sync readout for the viewer | C-11.21 | ✅ | `ui/ScreenView.tsx:413-417,442-467` | Zone, drift and rate in the controls bar; UI: manual |
| WEB-11.22 | Shared sync test vectors across engines | C-11.22 | ⬜ |  |  |
| WEB-11.23 | Sleep, lock and background behaviour | C-11.23 | ⬜ | `core/session.ts:191` | `setInterval` ticks are throttled in background tabs (WEB-11.P1) |
| WEB-11.P1 | Keep the engine ticking in background tabs | Platform-only (C-11.23) | ✅ | `core/ticker.ts`, `core/ticker.worker.ts`, `core/session.ts` (`tick`) | Ticks come from a dedicated worker (falls back to `setInterval`); the engine step is capped at 1 s; a gap over 3 s runs a full clock burst (live test `a long gap between ticks`). Worker loads under the production CSP. 30 minutes hidden checked by hand |

## WEB-12. Media player

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-12.1 | Playback engine integration | C-12.1 | ✅ | `player/html5.ts`, `player/controller.ts` | e2e (a real `<video>`) |
| WEB-12.2 | Core playback controls | C-12.2 | ✅ | `ui/ScreenView.tsx:358-440` | e2e (play, seek, pause) |
| WEB-12.3 | Fine playback rate with pitch correction | C-12.3 | ✅ | `player/html5.ts:10` | `preservesPitch = true` |
| WEB-12.4 | Seek bar with hover preview time | C-12.4 | ⬜ | `ui/ScreenView.tsx:380-398` | A plain range input |
| WEB-12.5 | Audio track selection | C-12.5 | ⬜ |  | Not built (WEB-12.P4) |
| WEB-12.6 | Fullscreen | C-12.6 | ✅ | `ui/ScreenView.tsx:106-109` | Button, F, double-click on the video; UI: manual |
| WEB-12.7 | Keyboard shortcuts | C-12.7 | 🟨 | `ui/ScreenView.tsx:111-130` | Space/K, ←/→, J/L, M, F; missing ↑/↓, N/P and Home; ignored while typing or with Ctrl, Alt or Meta |
| WEB-12.8 | Touch gestures | C-12.8 | ⬜ |  | Not built |
| WEB-12.9 | Buffering and end-of-file detection | C-12.9 | ✅ | `player/html5.ts:30-33` | `seeking`, or `readyState < HAVE_FUTURE_DATA` while playing |
| WEB-12.10 | System media controls go through the screen | C-12.10 | ✅ | `ui/mediaSession.ts` | Media Session: play, pause, stop, next, previous, seek forward/back and seek-to go through the screen with the same permissions; metadata shows the item and screen. Browser test checks the metadata; media keys checked by hand |
| WEB-12.11 | Keep the display awake while playing | C-12.11 | ⬜ |  | No Wake Lock |
| WEB-12.P1 | Autoplay policy: "Click to start" when the browser blocks playback | Platform-only | ✅ | `player/html5.ts:41-43`, `ui/ScreenView.tsx:274-280` | UI: manual |
| WEB-12.P2 | Phone and tablet browsers | Platform-only | ⬜ | `ui/styles.css:535-550` | iOS Safari: `volume` is read-only (hide the slider), only the `<video>` can go fullscreen (`webkitEnterFullscreen`), a tap is needed for sound; Android Chrome; layouts from 320 px |
| WEB-12.P3 | Picture-in-picture keeps sync (optional) | Platform-only | ⬜ |  | The engine keeps driving the same `<video>`; check controls and the hold state |
| WEB-12.P4 | Audio tracks where the browser exposes them | Platform-only (C-12.5) | ⬜ |  | `HTMLMediaElement.audioTracks` (Safari; behind a flag in Chromium); otherwise through the remux pipeline (WEB-15.4) |

## WEB-13. Local media, playlists and file matching

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-13.1 | Pick a single local file | C-13.1 | ✅ | `ui/ScreenView.tsx:141-148`, `player/controller.ts:161-194` | e2e |
| WEB-13.2 | Add a folder | C-13.2 | ⬜ |  | Not built (WEB-13.P1) |
| WEB-13.3 | Multi-select files | C-13.3 | ✅ | `ui/ScreenView.tsx:141-148` | `input multiple`; UI: manual |
| WEB-13.4 | Natural A–Z order, ignoring case | C-13.4 | ✅ | `core/media.ts:73` | unit (`natural sort orders numbers by value`) |
| WEB-13.5 | The same media file types on every platform | C-13.5 | ✅ | `core/media.ts:75-84` | The same 26 extensions as Windows |
| WEB-13.6 | Drag files in from the system | C-13.6 | ✅ | `ui/ScreenView.tsx:132-139` | Drop on the player; the highlight says what will happen; UI: manual |
| WEB-13.7 | Host-defined order: drag and drop, Move up and Move down | C-13.7 | 🟨 | `ui/ScreenView.tsx:587-591` | "Move up" only: no drag, no Move down |
| WEB-13.8 | Remove an item | C-13.8 | ✅ | `ui/ScreenView.tsx:597-601` | UI: manual |
| WEB-13.9 | Play an item now | C-13.9 | ✅ | `ui/ScreenView.tsx:592-596` | UI: manual |
| WEB-13.10 | "Open now" for a file or a link | C-13.10 | 🟨 | `player/controller.ts:188`, `ui/ScreenView.tsx:347-351` | `load` only when nothing is current; otherwise files and links are appended |
| WEB-13.11 | Playlist limits and chunked adds | C-13.11 | ✅ | `player/controller.ts:190-191` | Chunks of 100 |
| WEB-13.12 | Automatic matching: duration first, then name | C-13.12 | ✅ | `core/media.ts:41-70` | unit (`auto-maps duration then name, each file once`, `keeps manual mappings`) |
| WEB-13.13 | "Choose my file…" per item | C-13.13 | ✅ | `player/controller.ts:197-209` | e2e (📁 per item, "Choose file…") |
| WEB-13.14 | "Match my files…" (folder or several files) | C-13.14 | 🟨 | `ui/ScreenView.tsx:132-139` | Dropping files matches them; no button and no folder |
| WEB-13.15 | "Pick your file" when an unmapped item comes up | C-13.15 | ✅ | `ui/ScreenView.tsx:260-273` | unit (`holds while the current item has no file loaded`), e2e |
| WEB-13.16 | Duration tolerance max(2 s, 0.5%) | C-13.16 | ✅ | `core/media.ts:15-18` | unit |
| WEB-13.17 | Name comparison | C-13.17 | ✅ | `core/media.ts:21-32` | unit |
| WEB-13.18 | Mismatch indicator and "different name" note | C-13.18 | ✅ | `ui/ScreenView.tsx:288-292,566-578` | unit; banner over the video; UI: manual |
| WEB-13.19 | Only name and duration leave the device | C-13.19 | ✅ | `player/controller.ts:88-98` | Files play from object URLs; only name and duration are sent |
| WEB-13.20 | Mixed playlists | C-13.20 | 🟨 | `player/controller.ts:81-85` | YouTube items show "Can't play here" |
| WEB-13.21 | Resume position | C-13.21 | ⬜ |  | Not built |
| WEB-13.22 | Watch alone, outside a screen | C-13.22 | ⬜ |  | Not built: nothing plays outside a screen |
| WEB-13.P1 | Folders: `webkitdirectory` picker and dropped folders | Platform-only (C-13.2, C-13.14) | ⬜ | `ui/ScreenView.tsx:132-148` | `DataTransferItem.webkitGetAsEntry()` to walk dropped folders |
| WEB-13.P2 | After a reload, files must be chosen again: say so | Platform-only | ⬜ | `player/controller.ts` | Optionally remember File System Access handles (Chromium) and ask for permission once |

## WEB-14. External media: links and YouTube

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-14.1 | Add a link: direct URL or YouTube, detected | C-14.1 | ✅ | `ui/ScreenView.tsx:663-705`, `core/media.ts:89-99` | unit (`YouTube ids`) |
| WEB-14.2 | Direct URL items play on every viewer | C-14.2 | ✅ | `player/controller.ts:99-103` | Limited to the browser's codecs; UI: manual |
| WEB-14.3 | URL items get a duration, so they end and auto-advance | C-14.3 | ⬜ | `ui/ScreenView.tsx:683-687` | Links are added with `duration: null` |
| WEB-14.5 | YouTube player | C-14.5 | ⬜ | `player/controller.ts:81-85` | "YouTube items don't play in the web client yet. Use Kino for Windows for this one." |
| WEB-14.6 | YouTube sync rules | C-14.6 | 🟨 | `core/sync.ts:53-62` | `YOUTUBE_SETTINGS` exists in `core/sync.ts`, unused |
| WEB-14.7 | Ads and YouTube buffering count as buffering | C-14.7 | ⬜ |  | Not built |
| WEB-14.8 | End of a YouTube item: wait for everyone, host can skip | C-14.8 | 🟨 | `player/controller.ts` | Until YouTube plays (WEB-14.P1), the client sends `item.ended` at once and tells the viewer, so it never blocks the screen. Live test and browser test cover it. ✅ once `item.ended` is sent at the real end |
| WEB-14.9 | YouTube titles | C-14.9 | ⬜ | `ui/ScreenView.tsx:683` | Named "YouTube {id}" |
| WEB-14.10 | YouTube errors explained | C-14.10 | ⬜ |  | Not built |
| WEB-14.P1 | YouTube IFrame API in the browser | Platform-only (C-14.5) | ⬜ | `public/_headers`, `player/` | CSP needs `script-src https://www.youtube.com` (today `'self'`), or embed the directory's `/yt` page in a frame and talk to it with `postMessage`; sound needs a tap first |

## WEB-15. Codecs and formats

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-15.2 | Unsupported formats: a message that names the codec | C-15.2 | 🟨 | `player/controller.ts:140-155` | "This browser can't play this file (format or codec not supported)"; doesn't name the codec |
| WEB-15.3 | Web: know what this browser can play | C-15.3 | ⬜ |  |  |
| WEB-15.4 | Web: remux unsupported containers (MKV → fragmented MP4) | C-15.4 | ⬜ |  |  |
| WEB-15.5 | Web: decode unsupported audio (AC-3, E-AC-3, DTS) | C-15.5 | ⬜ |  |  |

## WEB-16. Viewer customisation (local only)

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-16.1 | Zoom 50–400% with pan | C-16.1 | ⬜ |  |  |
| WEB-16.2 | Aspect ratio override | C-16.2 | ⬜ |  |  |
| WEB-16.3 | Fit modes | C-16.3 | ⬜ |  |  |
| WEB-16.4 | Volume 0–100% and mute | C-16.4 | ✅ | `ui/ScreenView.tsx:418-433` | Slider and M; not remembered; UI: manual |
| WEB-16.5 | Volume boost to 200% with a one-time disclaimer | C-16.5 | ⬜ |  |  |
| WEB-16.6 | Remember preferences: defaults and per file | C-16.6 | ⬜ |  |  |
| WEB-16.7 | Local-only guarantee | C-16.7 | ✅ |  | Nothing personal is sent (no such settings exist yet) |
| WEB-16.P1 | Volume boost with Web Audio | Platform-only (C-16.5) | ⬜ |  | A `GainNode` after `createMediaElementSource`; links without CORS would play silent through it, so boost only local files and CORS-enabled links |

## WEB-17. Subtitles

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-17.1 | Load an external subtitle file | C-17.1 | ⬜ |  |  |
| WEB-17.2 | A same-named file next to the video | C-17.2 | ⬜ |  | Needs folder access |
| WEB-17.3 | Formats: SRT, WebVTT, ASS/SSA | C-17.3 | ⬜ |  |  |
| WEB-17.4 | Embedded tracks ("In the file") | C-17.4 | ⬜ |  |  |
| WEB-17.6 | "Also share with viewers" (upload) | C-17.6 | 🟨 | `core/net.ts:159-169` (API only) | Upload with gzip and the 1 MB check exists; no UI |
| WEB-17.7 | Stop sharing (unshare) | C-17.7 | ⬜ |  |  |
| WEB-17.8 | Download shared subtitles | C-17.8 | 🟨 | `core/net.ts:171-180` (API only) | Download with gunzip exists; no UI |
| WEB-17.9 | Viewer's choice per item | C-17.9 | ⬜ |  |  |
| WEB-17.10 | Timing offset per file, ±10 s | C-17.10 | ⬜ |  |  |
| WEB-17.11 | Style | C-17.11 | ⬜ |  |  |
| WEB-17.12 | "{name} shared subtitles" announcement | C-17.12 | ⬜ |  | No chat to show it in |
| WEB-17.P1 | Subtitle rendering in the browser | Platform-only (C-17.3) | ⬜ |  | VTT through `<track>`; SRT converted to VTT; ASS/SSA with a WebAssembly renderer (for example JASSUB) or converted with styles lost; style and offset applied locally |

## WEB-18. Chat, reactions and GIFs

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-18.1 | Text chat with an unread count | C-18.1 | ✅ | `ui/Chat.tsx`, `ui/ScreenView.tsx` | Chat tab; 500-character input; unread badge; links shown as text. Browser test; checked by hand |
| WEB-18.2 | Chat history for late joiners | C-18.2 | ✅ | `core/session.ts`, `ui/Chat.tsx` | Shown on join, de-duplicated by id. Browser test; checked by hand |
| WEB-18.3 | Emoji reactions | C-18.3 | ✅ | `ui/Chat.tsx`, `ui/ScreenView.tsx` | Browser test; checked by hand |
| WEB-18.3.1 | Send a reaction | C-18.3.1 | ✅ | `ui/Chat.tsx` | Reaction bar, follows `chat.react` and mute. Browser test; checked by hand |
| WEB-18.3.2 | Reactions float over the video for 3 s | C-18.3.2 | ✅ | `ui/ScreenView.tsx`, `ui/styles.css` | 3 s with the sender's name, at most 6, never stored. Browser test; checked by hand |
| WEB-18.4 | GIF search (GIPHY, key kept on the device) | C-18.4 | ✅ | `core/chat.ts`, `ui/Chat.tsx` | User's own GIPHY key in local storage only. Unit (parse); browser test with `KINO_GIPHY_KEY` (not in CI); checked by hand |
| WEB-18.5 | Pasted GIF links | C-18.5 | ✅ | `core/chat.ts` (`isGifLink`) | Same allow list as the theatre. Unit and browser test; checked by hand |
| WEB-18.6 | System messages | C-18.6 | ✅ | `ui/Chat.tsx` | Browser test; checked by hand |
| WEB-18.7 | Chat permissions and muted state | C-18.7 | 🟨 | `ui/Chat.tsx` | Input, GIF button and reactions follow permissions and mute, with "You can't chat in this screen" / "You are muted in this screen"; "Slow down a little" next to the input (browser test (`scripts/e2e.mjs`)). Mute can be exercised once moderation lands (WEB-9.1) |

## WEB-19. Notices, errors and resilience

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-19.1 | Plain-language text for every error code | C-19.1 | ✅ | `ui/common.tsx:37-62` | `describeError` covers every code |
| WEB-19.2 | Kicked, banned, closed or replaced: back to the lobby with the reason | C-19.2 | ✅ | `ui/App.tsx:161-169` | Back to the lobby with the reason; UI: manual |
| WEB-19.3 | Reconnecting indicator, visible everywhere | C-19.3 | ✅ | `ui/ScreenView.tsx:182-186` | "Reconnecting…" badge in the top bar, which is inside the fullscreen stage; UI: manual |
| WEB-19.4 | Errors and notices stay long enough to read | C-19.4 | ✅ | `ui/ScreenView.tsx:53-57,298-304` | Toasts for 5 s, at most 4; UI: manual |
| WEB-19.5 | `update_required` tells people to update | C-19.5 | ✅ | `ui/common.tsx:53-54` | "Reload the page" |
| WEB-19.6 | Form errors shown where the form is | C-19.6 | ✅ | `ui/App.tsx:258-325`, `ui/Lobby.tsx:222-314` | Create, join, name and password dialogs; UI: manual |
| WEB-19.7 | Progress for slow actions | C-19.7 | ✅ | `ui/App.tsx:225-231`, `player/controller.ts:175` | Busy dialog; "Reading n of m: name"; UI: manual |

## WEB-20. Builds, distribution and updates

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-20.1 | Release packages | C-20.1 | ✅ | `wrangler.jsonc`, `vite.config.ts` | `vite build` served by the `kino-web` static-assets Worker (SPA fallback) |
| WEB-20.2 | Release pipeline in each repo's CI | C-20.2 | 🟨 | `package.json` (`deploy`) | `npm run deploy` by hand; no deploy job in CI |
| WEB-20.4 | Update notice | C-20.4 | ⬜ |  | No new-version detection |
| WEB-20.6 | Bundled theatre list matches `servers.json` | C-20.6 | ✅ | `core/net.ts:23-26` | Aurora and Nova |
| WEB-20.7 | About: version, licence, credits, privacy | C-20.7 | ⬜ |  | No About, no version shown |
| WEB-20.P1 | Hosting: `kino-web` static-assets Worker, SPA fallback | Platform-only (C-20.1) | ✅ | `wrangler.jsonc` | Free plan; `/join` links on the directory offer it |
| WEB-20.P2 | Content-Security-Policy and security headers | Platform-only | ✅ | `public/_headers` | `default-src 'self'`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`; must change for WEB-14.P1 |
| WEB-20.P3 | Cache policy: hashed assets immutable for a year | Platform-only | ✅ | `public/_headers` |  |
| WEB-20.P4 | Installable app (PWA): manifest, icons, app-shell service worker | Platform-only | ⬜ |  | Offline shows "You're offline"; nothing else is cached (screens need the network) |
| WEB-20.P5 | Browser support matrix, documented and checked | Platform-only | ⬜ | `README.md` | Chrome, Edge, Firefox, Safari (current and previous major), desktop and mobile; codec notes per browser |

## WEB-21. Quality and the cross-platform test

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-21.2 | Client core unit tests in CI | C-21.2 | ✅ | `test/` | Vitest: sync, matching, invites, lobby, directory |
| WEB-21.3 | Live tests against a real theatre in CI | C-21.3 | ✅ | `test/live.test.ts`, `.github/workflows/ci.yml` | CI starts `wrangler dev` from the main repo and sets `KINO_THEATRE` |
| WEB-21.4 | Browser end-to-end test in CI | C-21.4 | ✅ | `scripts/e2e.mjs` | Chrome only (WEB-21.P1) |
| WEB-21.5 | UI test suite per client | C-21.5 | 🟨 | `scripts/e2e.mjs` | e2e covers create, open, join, play, seek, pause and leave only |
| WEB-21.6 | Release test checklist per platform | C-21.6 | ⬜ |  | The manual part of the definition of done, written down |
| WEB-21.7 | Cross-platform sync test | C-21.7 | ⬜ |  | Sub-tasks below |
| WEB-21.7.1 | Test plan and matrix | C-21.7.1 | ⬜ |  |  |
| WEB-21.7.2 | Windows and Web in one screen: sync | C-21.7.2 | ⬜ |  |  |
| WEB-21.7.3 | Roles, permissions and moderation across platforms | C-21.7.3 | ⬜ |  |  |
| WEB-21.7.4 | Chat, GIFs and reactions across platforms | C-21.7.4 | ⬜ |  |  |
| WEB-21.7.5 | Shared subtitles across platforms | C-21.7.5 | ⬜ |  |  |
| WEB-21.7.6 | YouTube across platforms | C-21.7.6 | ⬜ |  | Needs C-14.5 on the web |
| WEB-21.7.7 | Handover across platforms | C-21.7.7 | ⬜ |  |  |
| WEB-21.7.8 | Network faults across platforms | C-21.7.8 | ⬜ |  |  |
| WEB-21.7.9 | Every platform in the same screen | C-21.7.9 | ⬜ |  | The gate for Phase 23 |
| WEB-21.7.10 | Automated Windows + Web live test | C-21.7.10 | ⬜ |  |  |
| WEB-21.8 | Soak and scale | C-21.8 | ⬜ |  | 25 viewers, 3 hours |
| WEB-21.P1 | Browser test on Firefox and WebKit too | Platform-only (C-21.4) | ⬜ | `scripts/e2e.mjs` | Playwright's `firefox` and `webkit`; the generated clip needs a VP8 decoder in each |

## WEB-22. Later / to be planned

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-22.1 | User-added theatres | C-22.1 | ⏸ |  |  |
| WEB-22.3 | Compact binary encoding | C-22.3 | ⏸ |  | Only if budgets require it |
| WEB-22.4 | Own YouTube player | C-22.4 | ⏸ |  | **Not yet planned**, and not feasible in a browser (CORS, IP-bound stream URLs; would need Kino to proxy video). The web plan is the official IFrame player (WEB-14.5) |

## WEB-23. Layout and Design Language rework (gated)

**Gated.** Nothing here starts until the master roadmap's Phase 23 gate passes (every feature complete and tested on Windows, Web, Android and Linux). The common tasks are specified in the master; the platform-only tasks are specified below the table.

| ID | Task | Common | Status | Where | Tests / notes |
|---|---|---|---|---|---|
| WEB-23.0 | Gate check | C-23.0 | ⬜ |  | Record the date and the commit of every repo when the gate passes |
| WEB-23.1 | UI/UX audit of every current screen | C-23.1 | ⬜ |  |  |
| WEB-23.1.1 | Screen inventory with screenshots | C-23.1.1 | ⬜ |  |  |
| WEB-23.1.2 | Heuristic review with severities | C-23.1.2 | ⬜ |  |  |
| WEB-23.1.3 | Accessibility audit (automated and manual) | C-23.1.3 | ⬜ |  |  |
| WEB-23.1.4 | Cross-platform consistency audit | C-23.1.4 | ⬜ |  |  |
| WEB-23.1.5 | Task-time baseline for the core tasks | C-23.1.5 | ⬜ |  |  |
| WEB-23.3 | Design language and tokens | C-23.3 | ⬜ |  | Columns = tokens wired into that platform |
| WEB-23.3.1 | Colour, "Sky & stars", light and dark | C-23.3.1 | ⬜ |  |  |
| WEB-23.3.2 | Typography | C-23.3.2 | ⬜ |  |  |
| WEB-23.3.3 | Spacing and sizing | C-23.3.3 | ⬜ |  |  |
| WEB-23.3.4 | Corner radius | C-23.3.4 | ⬜ |  |  |
| WEB-23.3.5 | Elevation | C-23.3.5 | ⬜ |  |  |
| WEB-23.3.6 | Motion | C-23.3.6 | ⬜ |  |  |
| WEB-23.3.7 | Token pipeline (one source, generated per platform) | C-23.3.7 | ⬜ |  |  |
| WEB-23.4 | Iconography and app icon | C-23.4 | ⬜ |  |  |
| WEB-23.5 | Component library specification | C-23.5 | ⬜ |  | Sub-tasks C-23.5.1 to C-23.5.18 below |
| WEB-23.6 | Layouts per form factor | C-23.6 | ⬜ |  |  |
| WEB-23.6.2 | Responsive browser | C-23.6.2 | ⬜ |  |  |
| WEB-23.6.3 | Phone | C-23.6.3 | ⬜ |  | = phone browsers |
| WEB-23.6.4 | Tablet | C-23.6.4 | ⬜ |  | = tablet browsers |
| WEB-23.7 | Screen-by-screen redesign | C-23.7 | ⬜ |  | Sub-tasks C-23.7.1 to C-23.7.22 below |
| WEB-23.8 | Accessibility, WCAG 2.2 AA | C-23.8 | ⬜ |  |  |
| WEB-23.9 | Localisation readiness | C-23.9 | ⬜ |  |  |
| WEB-23.10 | Per-platform implementation | C-23.10 | ⬜ |  | Detail in each platform roadmap (WIN-23, WEB-23) |
| WEB-23.11 | Visual regression testing | C-23.11 | ⬜ |  |  |
| WEB-23.12 | Usability testing | C-23.12 | ⬜ |  |  |
| WEB-23.13 | Rollout | C-23.13 | ⬜ |  |  |
| WEB-23.P1 | CSS tokens generated from `design/tokens.json`; theme choice | C-23.10.2 | ⬜ | `ui/styles.css:2-40` |  |
| WEB-23.P2 | Icons: an SVG sprite of Fluent System Icons instead of emoji | C-23.4 | ⬜ | `ui/*.tsx` |  |
| WEB-23.P3 | Component library in React, with a development-only gallery | C-23.5 | ⬜ | `ui/` |  |
| WEB-23.P4 | Responsive layouts | C-23.6.2 to C-23.6.4 | ⬜ | `ui/styles.css` | One breakpoint (820 px) today |
| WEB-23.P5 | Touch: targets, gestures and bottom sheets | C-23.6.3 | ⬜ |  |  |
| WEB-23.P6 | Accessibility in the browser | C-23.8 | ⬜ | `ui/common.tsx:9-25`, `ui/ScreenView.tsx:319-326` |  |
| WEB-23.P7 | Localisation: message catalogues | C-23.9 | ⬜ |  |  |
| WEB-23.P8 | Performance budget | C-23.10.2 | ⬜ |  |  |
| WEB-23.P9 | Installable-app surfaces | C-23.10.2 | ⬜ |  | If WEB-20.P4 is done |
| WEB-23.P10 | Screenshot and accessibility tests in CI | C-23.11.1, C-23.11.5 | ⬜ |  |  |
| WEB-23.P11 | Preview deployment and rollout | C-23.13 | ⬜ | `wrangler.jsonc` |  |

### WEB-23 platform tasks in detail

- **WEB-23.P1 CSS tokens and theme choice.** Custom properties generated from `design/tokens.json` (C-23.3.7) replace
  the hand-written ones in `ui/styles.css`; a Follow system / Light / Dark choice stored locally; `color-scheme` set to
  match; `forced-colors: active` and `prefers-contrast: more` handled. AC: no colour literal left in `ui/` outside the
  generated file.
- **WEB-23.P2 Icons.** One inline SVG sprite (Fluent System Icons, MIT), `currentColor`, sizes 16/20/24; every button
  now showing ⏮ ⏭ ▶ ⏸ 🔇 🔊 ⛶ 🔒 📁 ✕ ↑ ↻ ＋ 👤 uses it. AC: C-23.4 AC 1–3.
- **WEB-23.P3 Components.** Every C-23.5 component in `ui/components/`, accessible by default (native elements first;
  dialogs on `<dialog>` with focus trap and return), and a `/__gallery` route compiled only in development builds.
- **WEB-23.P4 Responsive layouts.** C-23.6.2 to C-23.6.4 with container queries; `dvh` units; safe-area insets;
  phone landscape is immersive video with the panel as a drawer; no horizontal scroll at 320 px or at 400% zoom.
- **WEB-23.P5 Touch.** 44×44 px targets; the C-23.6.3 gestures (permission-aware); bottom sheets for menus on phones;
  no hover-only information.
- **WEB-23.P6 Accessibility.** Tabs with `role="tab"`, `aria-selected` and arrow keys; roving tab index in lists;
  live regions for chat (polite) and hold or ready prompts; a "Skip to player" link; `:focus-visible` rings; reduced
  motion honoured; screen-reader passes with VoiceOver (macOS, iOS) and NVDA (Chrome, Firefox).
- **WEB-23.P7 Localisation.** ICU MessageFormat catalogues (`messages/en-GB.json`), `lang` and `dir` on `<html>`,
  `Intl` for numbers and times, a pseudo-locale in development.
- **WEB-23.P8 Performance budget.** First-load JavaScript at most 200 KB gzipped (heavy parts such as the GIF picker,
  subtitle renderer and remuxer load on demand); Largest Contentful Paint ≤ 2.5 s and Interaction to Next Paint
  ≤ 200 ms on a mid-range phone over 4G; Cumulative Layout Shift ≤ 0.1; the 250 ms sync tick causes no React re-render
  of anything but the readout and the seek bar.
- **WEB-23.P9 Installable-app surfaces.** Manifest icons (192, 512, maskable) from C-23.4; `theme-color` per theme;
  splash colours from the tokens.
- **WEB-23.P10 Tests.** Playwright screenshots of every screen at 360, 768, 1280 and 1920 px, light and dark, reduced
  motion (C-23.11.1); axe-core with zero serious or critical findings (C-23.11.5); both run in CI.
- **WEB-23.P11 Rollout.** A `kino-web-next` static-assets Worker deployed from a branch for the preview (C-23.13.1);
  the switch is a normal deploy of `main`; the previous build stays one command away (C-23.13.5).


## Old README section 18 → new IDs

| Old | What | Now |
|---|---|---|
| 18.1 | Repo, tooling, CI | WEB-0.1, WEB-0.7 (🟨, no linter: WEB-0.P1), WEB-0.8 |
| 18.2 | Hosting | WEB-20.1, WEB-20.P1, WEB-20.P2, WEB-20.P3 |
| 18.3 | Protocol client and theatres | WEB-2.2, WEB-4.1, WEB-4.2, WEB-3.7 |
| 18.4 | Clock sync and sync engine | WEB-11.2 to WEB-11.18 |
| 18.5 | Video player | WEB-12.1, WEB-12.2, WEB-13.1, WEB-13.6, WEB-14.2 |
| 18.6 | Lobby, create, join, invites | WEB-4.6, WEB-5.2, WEB-6.3, WEB-6.5, WEB-6.6, WEB-6.12 |
| 18.7 | Playlist and file matching | WEB-13.12 to WEB-13.18 |
| 18.8 | YouTube | WEB-14.5 to WEB-14.10, WEB-14.P1 |
| 18.9 | Chat, GIFs, reactions | WEB-18.1 to WEB-18.7 |
| 18.10 | Roles, moderation, settings | WEB-5.11, WEB-7.x, WEB-8.x, WEB-9.x |
| 18.11 | Subtitles | WEB-17.x, WEB-17.P1 |
| 18.12 | Picture, sound, shortcuts | WEB-11.20, WEB-12.4 to WEB-12.7, WEB-16.x, WEB-16.P1 |
| 18.13 | Formats beyond the browser | WEB-15.2 to WEB-15.5 |

## Later / to be planned

The master's C-22.4 "Own YouTube player" (⏸, not yet planned) appears above as WEB-22.4. For the web the plan stays
the official YouTube IFrame player with Kino's own controls (WEB-14.5); a Kino-owned player isn't feasible in a browser.

## Changelog of this roadmap

- 2026-11-25: first version, generated from the master roadmap after a full audit of the code and tests at `298c94b`.
- 2026-11-25: order-of-work step 1 ("stop harming others' screens"): WEB-3.7 ✅, WEB-4.11 ✅; WEB-4.3, WEB-4.4, WEB-11.P1, WEB-12.10 and WEB-14.8 to 🟨 (implemented and tested automatically; the notes say what is left). Theatre fix found on the way: closes without a code are now answered with 1000, so clients no longer wait about 10 s for the closing handshake.
- 2026-11-25: step 1 checked by hand (media keys, 30 minutes in a hidden tab): WEB-11.P1 ✅, WEB-12.10 ✅. Step 2 (chat, reactions, GIFs, system messages): WEB-18.1 to WEB-18.7 implemented with automated browser tests; 🟨 until checked by hand.
- 2026-11-25: chat checked by hand (WEB-18.1 to WEB-18.6 ✅; WEB-18.7 waits for moderation). Step 3 (running a screen: settings, close, ready check, personal offset, invite panel, pasted links): implemented with unit and browser tests; 🟨 until checked by hand.
