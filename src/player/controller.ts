// Which file plays for the screen's current item (spec §13): this viewer's own copies, matched to playlist items by
// duration then name, and loading the right one into the <video>. Port of MainWindow.Playlist.cs.
import { diag } from "../core/diag";
import { autoMap, compare, isMediaFile, type LocalFile, type MatchKind, naturalCompare, probeDuration } from "../core/media";
import { type Item, Permissions } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import type { Html5Playback } from "./html5";

export const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

const TRY_ELSEWHERE = "Try Chrome or Edge, an MP4/WebM copy, or Kino for Windows.";

/** Why a local file didn't play, from the <video> error code. */
export function fileProblem(code: number | null): string {
  if (code === 4) return `This browser can't play this file (format or codec not supported). ${TRY_ELSEWHERE}`;
  if (code === 3) return `This file couldn't be decoded in this browser (damaged, or a codec it doesn't support). ${TRY_ELSEWHERE}`;
  return "The video couldn't be loaded.";
}

/**
 * Why a link didn't play. The browser reports a refused or missing link (403, 404, a web page instead of a video) the
 * same way as an unsupported format, so the message names both; `probeLink` narrows it down when it can.
 */
export function linkProblem(code: number | null): string {
  if (code === 2) return "The link stopped loading (network error). Check the connection and try again.";
  if (code === 3) return `This video couldn't be decoded in this browser. ${TRY_ELSEWHERE}`;
  return (
    "This link didn't play here. The server may refuse it (private, expired, or blocked on your network), it may be a " +
    "web page rather than a video file, or the format isn't supported in this browser."
  );
}

/** Asks the server about a link (HEAD); a reason to show, or null when the browser can't read the answer. */
export async function probeLink(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "HEAD", mode: "cors", signal: ctl.signal, referrerPolicy: "no-referrer" });
    if (res.status >= 400) {
      const what =
        res.status === 404 || res.status === 410
          ? "the video isn't there any more"
          : "it may be private, expired, or blocked on your network";
      return `The link answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}: ${what}.`;
    }
    const type = res.headers.get("content-type") ?? "";
    if (/^text\/html/i.test(type))
      return "That link is a web page, not a video file. Use a direct link to the video itself (for example one ending in .mp4 or .webm).";
    return null;
  } catch {
    return null; // the server doesn't let the page read its answer (CORS), or it's offline
  } finally {
    clearTimeout(timer);
  }
}

export class MediaController {
  private candidates: LocalFile[] = [];
  private manual = new Map<string, LocalFile>();
  mapping = new Map<string, LocalFile>();
  private loadedSource: string | null = null;
  private loadingSource: string | null = null;
  private loadingItemId: string | null = null;
  private objectUrl: string | null = null;
  private failed: { source: string; message: string } | null = null;
  /** The YouTube item this client has already reported as ended. */
  private endedSent: string | null = null;
  private unsubscribe: (() => void)[] = [];
  /** Shown in the UI while files are being read, or when an item can't play here. */
  notice: string | null = null;
  error: string | null = null;
  onChange: () => void = () => {};

  constructor(
    private readonly session: ScreenSession,
    private readonly playback: Html5Playback,
  ) {
    session.engine.requireLoadedItem = true; // never drive the wrong file while the right one loads
    this.unsubscribe.push(
      session.changed.on(() => this.remap()),
      session.itemChanged.on(() => this.remap()),
    );
    const v = playback.video;
    v.addEventListener("loadedmetadata", this.onLoaded);
    v.addEventListener("error", this.onError);
    this.remap();
  }

  dispose() {
    for (const u of this.unsubscribe) u();
    const v = this.playback.video;
    v.removeEventListener("loadedmetadata", this.onLoaded);
    v.removeEventListener("error", this.onError);
    v.pause();
    v.removeAttribute("src");
    v.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  /** The file mapped to an item, and how it compares with the host's. */
  matchFor(item: Item): { file: LocalFile; kind: MatchKind } | null {
    const f = this.mapping.get(item.id);
    return f ? { file: f, kind: compare(item, f) } : null;
  }

  get currentNeedsFile() {
    const item = this.session.currentItem;
    return !!item && item.kind === "local" && !this.mapping.has(item.id);
  }

  private remap() {
    const s = this.session;
    for (const id of [...this.manual.keys()]) if (!s.playlist.some((i) => i.id === id)) this.manual.delete(id);
    this.mapping = autoMap(s.playlist, this.candidates, this.manual);
    const cur = s.currentItem;
    const mine = cur && cur.kind === "local" ? this.mapping.get(cur.id) : undefined;
    s.fileMismatch = !!cur && !!mine && compare(cur, mine) === "mismatch";
    this.ensureCurrentLoaded();
    this.onChange();
  }

  private ensureCurrentLoaded() {
    const s = this.session;
    const item = s.currentItem;
    this.error = null;
    if (!item) {
      s.engine.loadedItemId = null;
      return;
    }
    if (item.kind === "youtube") {
      s.engine.loadedItemId = null;
      // The theatre moves on from a YouTube item when everyone has reached its end (C-14.8). This client can't play
      // it yet, so it counts as finished at once and never holds the others up.
      if (this.endedSent !== item.id) {
        this.endedSent = item.id;
        s.reportEnded(item.id);
      }
      this.error =
        "YouTube videos don't play in the web client yet. The others keep watching, and you'll rejoin on the next item. " +
        "Kino for Windows plays YouTube.";
      return;
    }
    let source: string | null = null;
    let src: () => string = () => "";
    if (item.kind === "local") {
      const f = this.mapping.get(item.id);
      if (f?.file) {
        source = f.key;
        const file = f.file;
        src = () => {
          if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
          this.objectUrl = URL.createObjectURL(file);
          return this.objectUrl;
        };
      }
    } else if (item.url) {
      source = item.url;
      const url = item.url;
      src = () => url;
    }
    if (source === null) {
      s.engine.loadedItemId = null;
      this.loadingItemId = null;
      return; // the UI asks for their copy (NoFile zone)
    }
    if (this.failed?.source === source) {
      s.engine.loadedItemId = null;
      this.error = this.failed.message;
      return; // don't retry a file the browser can't play on every update
    }
    if (this.loadingItemId === item.id && this.loadingSource === source) return; // on its way
    if (this.loadingSource === null && this.loadedSource === source && this.playback.hasMedia) {
      s.engine.loadedItemId = item.id;
      return;
    }
    diag.add(
      "media",
      `load ${item.id} (${item.kind}) — was loaded=${this.loadedSource === source ? "same" : this.loadedSource ? "other" : "none"} ` +
        `loading=${this.loadingSource ? "yes" : "no"} hasMedia=${this.playback.hasMedia}`,
    );
    this.loadingItemId = item.id;
    this.loadingSource = source;
    s.engine.loadedItemId = null;
    const v = this.playback.video;
    v.pause();
    v.src = src();
    v.load();
  }

  private onLoaded = () => {
    diag.add("media", `loaded ${this.loadingItemId ?? "?"} duration=${this.playback.mediaDuration}`);
    if (this.loadingSource !== null) {
      this.loadedSource = this.loadingSource;
      this.loadingSource = null;
    }
    const id = this.loadingItemId;
    this.loadingItemId = null;
    if (id && this.session.currentItem?.id === id) this.session.engine.loadedItemId = id;
    else this.ensureCurrentLoaded();
    this.onChange();
  };

  private onError = () => {
    const v = this.playback.video;
    if (!v.getAttribute("src")) return;
    const item = this.session.currentItem;
    const code = v.error?.code ?? null;
    diag.add("media", `error code=${code} ${v.error?.message ?? ""}`);
    const link = item?.kind === "url" ? item.url : undefined;
    const message = link ? linkProblem(code) : fileProblem(code);
    const source = this.loadingSource;
    if (source) this.failed = { source, message };
    this.error = message;
    this.loadingSource = null;
    this.loadingItemId = null;
    this.loadedSource = null;
    this.onChange();
    if (link && source) void this.explainLink(link, source);
  };

  /** A link that won't play: ask the server why, when it lets the browser read the answer. */
  private async explainLink(url: string, source: string) {
    const reason = await probeLink(url);
    if (!reason || this.failed?.source !== source) return;
    this.failed = { source, message: reason };
    if (this.session.currentItem?.url === url) this.error = reason;
    this.onChange();
  }

  /**
   * Reads durations and offers files for matching. With `addToPlaylist` (and permission), new files are added;
   * `openNow` makes a single file the current item.
   */
  async offerFiles(files: File[], addToPlaylist: boolean, openNow = false) {
    const media = files.filter((f) => isMediaFile(f.name) || f.type.startsWith("video/") || f.type.startsWith("audio/"));
    if (media.length === 0) {
      this.error = "Those aren't video or audio files.";
      this.onChange();
      return;
    }
    media.sort((a, b) => naturalCompare(a.name, b.name));
    const offered: LocalFile[] = [];
    for (let i = 0; i < media.length; i++) {
      const f = media[i]!;
      const key = fileKey(f);
      let known = this.candidates.find((c) => c.key === key);
      if (!known) {
        this.notice = media.length > 1 ? `Reading ${i + 1} of ${media.length}: ${f.name}` : `Reading ${f.name}…`;
        this.onChange();
        known = { key, name: f.name, duration: await probeDuration(f), file: f };
        this.candidates.push(known);
      }
      offered.push(known);
    }
    this.notice = null;
    const s = this.session;
    if (addToPlaylist && s.can(Permissions.PlaylistAdd)) {
      this.mapping = autoMap(s.playlist, this.candidates, this.manual);
      const mapped = new Set([...this.mapping.values()].map((m) => m.key));
      const fresh = offered.filter((f) => !mapped.has(f.key));
      if (openNow && fresh.length === 1) s.load({ kind: "local", name: fresh[0]!.name, duration: fresh[0]!.duration });
      else
        for (let i = 0; i < fresh.length; i += 100)
          s.addToPlaylist(fresh.slice(i, i + 100).map((f) => ({ kind: "local", name: f.name, duration: f.duration })));
    }
    this.remap();
  }

  /** "This is my copy": a manual pick wins over automatic matching. */
  async pickFor(itemId: string, file: File) {
    const key = fileKey(file);
    let known = this.candidates.find((c) => c.key === key);
    if (!known) {
      this.notice = `Reading ${file.name}…`;
      this.onChange();
      known = { key, name: file.name, duration: await probeDuration(file), file };
      this.candidates.push(known);
      this.notice = null;
    }
    this.manual.set(itemId, known);
    this.remap();
  }
}
