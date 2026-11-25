# Kino for the web

The browser client for [Kino Enhanced](https://github.com/Sriharan-S/kino-enhanced): join a screen and watch in sync
without installing anything. Everyone plays their own copy of the video; Kino only keeps playback in step. Video never
leaves your device.

**Open it: <https://kino-web.srie.workers.dev>**

Web and Windows viewers can share a screen: it's the same protocol, theatres and sync engine.

## Status

Early but working. The full checklist, the gaps against the Windows app and the order of work are in
**[`ROADMAP.md`](ROADMAP.md)**, which follows the
[master roadmap](https://github.com/Sriharan-S/kino-enhanced/blob/main/ROADMAP.md). Done:

- Theatre list (live, cached or bundled), parallel probes and the unified lobby with search, filters and sort
- Create screens (public or private, hidden, max viewers, automatic or chosen theatre); join by lobby, code or invite link
- Clock sync, smooth rate correction and the sync engine: a line-for-line port of the Windows engine, with the same tests
- HTML5 player: local files (picker or drag and drop) and direct links; reconnect after network drops
- Playlist with duration-then-name matching to your own copies and a mismatch warning
- Viewers list with live sync statuses; hold ("wait for everyone") and ready checks; keyboard shortcuts

Next: YouTube, chat and GIFs, roles and moderation, screen settings, subtitles, picture and sound options, and formats
browsers can't play natively (MKV with AC-3/DTS audio and similar).

Browser support: current Chrome, Edge, Firefox and Safari. What plays depends on the browser's codecs: MP4 (H.264/AAC)
and WebM play everywhere. For MKV and other formats, use Chrome or Edge, or [Kino for Windows](https://kino-directory.srie.workers.dev/download).

## Develop

Requires Node.js 22 or later.

```sh
npm ci
npm run dev        # http://localhost:5173
npm run check      # typecheck, formatting, unit tests
```

Point the app at a local theatre (from the main repo: `cd theatre && npx wrangler dev`) with
`http://localhost:5173/?theatre=http://127.0.0.1:8787`. Add `&profile=b` to join as a second viewer from another tab.

### Tests

| Command | What |
| --- | --- |
| `npm test` | Unit tests: sync engine, rate controller, clock sync, status reporter, matching, invites, lobby, directory (ported from the Windows tests) |
| `KINO_THEATRE=http://127.0.0.1:8787 npm test` | Also runs the live tests: real sessions against a theatre (sync through play/seek/pause, passwords, closing) |
| `node scripts/e2e.mjs [app] [theatre]` | Browser test: two headless browsers (system Edge or Chrome) in one screen playing a generated video |

### Deploy

`npm run deploy` builds and deploys to Cloudflare as the `kino-web` static-assets Worker (free; requests for static
files are unlimited). It uses whichever account `wrangler login` is signed in to.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | No UI: protocol types, sync engine, theatre network, identity, session, matching |
| `src/player/` | The `<video>` adapter and which file plays for the current item |
| `src/ui/` | React components: lobby, screen view |
| `test/` | Vitest tests and the simulated player |

## Privacy

The web client stores your display name, a random device secret (for per-screen tokens) and the last theatre list in
your browser's local storage. File names and lengths of the files you add are shared with the screen; the files are not.

## Licence

[GNU GPL v3.0 or later](LICENSE).
