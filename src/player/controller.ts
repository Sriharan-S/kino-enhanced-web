// Which file plays for the screen's current item (spec §13): this viewer's own copies, matched to playlist items by
// duration then name, and loading the right one into the <video>. Port of MainWindow.Playlist.cs.
import { autoMap, compare, isMediaFile, type LocalFile, type MatchKind, naturalCompare, probeDuration } from "../core/media";
import { type Item, Permissions } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import type { Html5Playback } from "./html5";

export const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export class MediaController {
  private candidates: LocalFile[] = [];
  private manual = new Map<string, LocalFile>();
  mapping = new Map<string, LocalFile>();
  private loadedSource: string | null = null;
  private loadingSource: string | null = null;
  private loadingItemId: string | null = null;
  private objectUrl: string | null = null;
  private failed: { source: string; message: string } | null = null;
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
      this.error = "YouTube items don't play in the web client yet. Use Kino for Windows for this one.";
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
    this.loadingItemId = item.id;
    this.loadingSource = source;
    s.engine.loadedItemId = null;
    const v = this.playback.video;
    v.pause();
    v.src = src();
    v.load();
  }

  private onLoaded = () => {
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
    const code = v.error?.code;
    const message =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? `This browser can't play ${item?.kind === "url" ? "this link" : "this file"} (format or codec not supported). Try Chrome or Edge, an MP4/WebM copy, or Kino for Windows.`
        : "The video couldn't be loaded.";
    if (this.loadingSource) this.failed = { source: this.loadingSource, message };
    this.error = message;
    this.loadingSource = null;
    this.loadingItemId = null;
    this.loadedSource = null;
    this.onChange();
  };

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
