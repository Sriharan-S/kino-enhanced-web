// A viewer's live session in one screen: connection with automatic reconnect, clock sync, and the sync engine loop.
// Port of ScreenSession.cs. Single-threaded, so state is plain fields; the UI subscribes to `changed`.
import type { DeviceIdentity } from "./identity";
import { type TheatreApi, TheatreError } from "./net";
import {
  type ChatMessage,
  type CoHostInfo,
  type CreateScreenRequest,
  type CreateScreenResponse,
  type Gif,
  type Item,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ReadyCheck,
  type ResolveResponse,
  type Role,
  type ScreenInfo,
  type ServerError,
  type ServerMessage,
  type SubMeta,
  type ViewerInfo,
  type Welcome,
  can,
  isTimelineAuthority,
} from "./protocol";
import { diag, short } from "./diag";
import { engineStep, GAP_MS, startTicker } from "./ticker";
import { ClockSync, DEFAULT_SETTINGS, type Playback, StatusReporter, SyncEngine, type SyncSettings } from "./sync";

export const RECONNECT_WINDOW_MS = 60_000;
const RECONNECT_DELAYS = [300, 1000, 2000, 3000, 5000];
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

export interface NewItem {
  kind: "local" | "url" | "youtube";
  name: string;
  duration: number | null;
  url?: string;
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(l: Listener<T>) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  emit(v: T) {
    for (const l of [...this.listeners]) l(v);
  }
}

/** One WebSocket. Rejections close with 4001 and the error code as the reason; 4000 means replaced by a newer one. */
class Connection {
  readonly ws: WebSocket;
  onMessage: (m: ServerMessage) => void = () => {};
  onClosed: (code: number, reason: string) => void = () => {};

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = parseServerMessage(e.data);
      if (m) this.onMessage(m);
    };
    this.ws.onclose = (e) => this.onClosed(e.code, e.reason || "closed");
  }

  opened(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("close", () => reject(new TheatreError(0, "couldn't connect")), { once: true });
    });
  }

  get isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(type: string, data: unknown = {}) {
    if (this.isOpen) this.ws.send(JSON.stringify({ type, data }));
  }

  close() {
    try {
      this.ws.close(1000, "bye");
    } catch {
      // already closed
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ScreenSession {
  readonly clock = new ClockSync();
  readonly engine: SyncEngine;
  private conn: Connection | null = null;
  /** Stops the engine's ticker; null while joining and after leaving. */
  private loop: (() => void) | null = null;
  private bursting = false;
  private status = new StatusReporter();
  private disposed = false;
  private token = "";
  private name = "";
  private lastTick = 0;
  private lastResync = 0;
  private lastZone = "";

  code = "";
  joined: Welcome | null = null;
  screen: ScreenInfo | null = null;
  currentItem: Item | null = null;
  playlist: Item[] = [];
  subs: SubMeta[] = [];
  hold: string[] | null = null;
  ready: ReadyCheck | null = null;
  chat: ChatMessage[] = [];
  viewers: ViewerInfo[] = [];
  roles: Role[] = [];
  coHosts: CoHostInfo[] = [];
  self: ViewerInfo | null = null;
  reconnecting = false;
  /** Why the theatre ended the session, in its words, when it said (shown in the lobby). */
  finalMessage: string | null = null;
  /** Set by the app when this viewer's file differs from the host's; reported as "mismatch". */
  fileMismatch = false;

  /** Any state above changed. */
  readonly changed = new Emitter<void>();
  readonly itemChanged = new Emitter<Item | null>();
  readonly chatReceived = new Emitter<ChatMessage>();
  readonly reaction = new Emitter<{ from: string; name: string; emoji: string }>();
  readonly error = new Emitter<ServerError>();
  readonly closed = new Emitter<string>();
  /** Every engine tick (4 per second): for the sync readout. */
  readonly ticked = new Emitter<void>();

  private constructor(
    readonly api: TheatreApi,
    private readonly identity: DeviceIdentity,
    player: Playback,
    private readonly settings: SyncSettings = DEFAULT_SETTINGS,
  ) {
    this.engine = new SyncEngine(
      player,
      () => this.clock.theatreNowMs,
      () => this.clock.localNowMs,
      settings,
    );
    this.engine.enabled = false;
    this.engine.onReanchor = (position, at) => this.send("reanchor", { position, at });
  }

  get isHost() {
    return !!this.self?.isHost;
  }
  get isTimelineAuthority() {
    return isTimelineAuthority(this.self);
  }
  can(permission: string) {
    return can(this.self, permission);
  }

  /** Creates a screen and joins it as host. */
  static async create(api: TheatreApi, identity: DeviceIdentity, player: Playback, req: CreateScreenRequest, displayName: string) {
    const created: CreateScreenResponse = await api.createScreen(req);
    const s = new ScreenSession(api, identity, player);
    await s.join(created.code, created.screenId, displayName, null, created.claim);
    return { session: s, created };
  }

  static async joinResolved(
    api: TheatreApi,
    identity: DeviceIdentity,
    player: Playback,
    r: ResolveResponse,
    displayName: string,
    password: string | null,
  ) {
    const s = new ScreenSession(api, identity, player);
    await s.join(r.code, r.screenId, displayName, password, null);
    return s;
  }

  private async join(code: string, screenId: string, name: string, password: string | null, claim: string | null) {
    try {
      this.code = code;
      this.name = name;
      this.token = await this.identity.tokenFor(screenId);
      const welcome = await this.connect(password, claim);
      this.applyWelcome(welcome);
      await this.pingBurst(this.settings.burstSamples);
      this.engine.enabled = true;
      this.lastTick = this.lastResync = this.clock.localNowMs;
      this.loop = startTicker(this.settings.tickMs, () => this.tick());
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  /** Opens a fresh connection, sends hello and waits for the welcome. Rejections throw with their error code. */
  private connect(password: string | null, claim: string | null): Promise<Welcome> {
    const conn = new Connection(this.api.webSocketUrl(this.code));
    const old = this.conn;
    this.conn = conn;
    old?.close();

    return new Promise<Welcome>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new TheatreError(0, "the theatre didn't answer")), 10_000);
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      };
      conn.onMessage = (m) => {
        if (!settled && m.type === "welcome") {
          settled = true;
          clearTimeout(timer);
          resolve(m.data);
          return;
        }
        if (!settled && m.type === "error") fail(new TheatreError(0, m.data.message, m.data.code));
        if (conn === this.conn && settled) this.onMessage(m);
      };
      conn.onClosed = (code, reason) => {
        fail(new TheatreError(0, `connection closed (${reason})`, code === 4001 ? reason : null));
        this.onConnectionClosed(conn, code, reason);
      };
      conn
        .opened()
        .then(() =>
          conn.send("hello", {
            protocol: PROTOCOL_VERSION,
            token: this.token,
            name: this.name,
            device: "web",
            ...(password ? { password } : {}),
            ...(claim ? { claim } : {}),
          }),
        )
        .catch(fail);
    });
  }

  private applyWelcome(w: Welcome) {
    diag.add(
      "conn",
      `welcome self=${w.self.id.slice(0, 6)} host=${w.self.isHost} item=${w.item?.id ?? "none"} anchor ${short(w.anchor)} ` +
        `autoAdvance=${w.screen.autoAdvance} buffering=${w.screen.bufferingPolicy}`,
    );
    this.joined = w;
    this.screen = w.screen;
    this.code = w.screen.code;
    this.currentItem = w.item;
    this.playlist = w.playlist ?? [];
    this.subs = w.subs ?? [];
    this.hold = w.hold ?? null;
    this.ready = w.ready ?? null;
    this.status = new StatusReporter();
    this.chat = [...(w.chat ?? [])];
    this.roles = w.roles ?? [];
    this.coHosts = w.coHosts ?? [];
    this.setViewers(w.viewers, w.self);
    this.engine.applyAnchor(w.anchor);
    this.itemChanged.emit(w.item);
    this.changed.emit();
  }

  private onConnectionClosed(conn: Connection, code: number, reason: string) {
    if (conn !== this.conn || this.disposed || this.loop === null) return; // stale, leaving or still joining
    diag.add("conn", `closed ${code} ${reason}`);
    if (code === 4000 || code === 4001) {
      this.end(code === 4000 ? "replaced" : reason);
      return;
    }
    if (!this.reconnecting) void this.reconnectLoop(reason);
  }

  /** Network drop: keep playing on the last anchor and rejoin with the same token (no password needed). */
  private async reconnectLoop(reason: string) {
    this.reconnecting = true;
    this.changed.emit();
    const started = performance.now();
    for (let attempt = 0; !this.disposed && performance.now() - started < RECONNECT_WINDOW_MS; attempt++) {
      await sleep(RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]!);
      if (this.disposed) return;
      try {
        const welcome = await this.connect(null, null);
        this.reconnecting = false;
        this.applyWelcome(welcome);
        void this.pingBurst(this.settings.burstSamples); // full burst after a reconnect (§14.3)
        return;
      } catch (e) {
        if (this.disposed) return;
        if (e instanceof TheatreError && e.code) {
          this.reconnecting = false;
          this.end(e.code); // banned, closed, full…
          return;
        }
        // Browsers hide the HTTP status of a refused upgrade: ask whether the screen still exists.
        try {
          if ((await this.api.resolve(this.code)) === null) {
            this.reconnecting = false;
            this.end("closed");
            return;
          }
        } catch {
          // still offline
        }
        reason = e instanceof Error ? e.message : String(e);
      }
    }
    this.reconnecting = false;
    if (!this.disposed) this.end(`couldn't reconnect (${reason})`);
  }

  private end(reason: string) {
    if (this.disposed) return;
    this.dispose(false);
    this.closed.emit(reason);
  }

  private setViewers(viewers: ViewerInfo[], self: ViewerInfo | null) {
    this.viewers = viewers;
    const myId = self?.id ?? this.joined?.self.id;
    this.self = viewers.find((v) => v.id === myId) ?? self ?? this.self;
    this.engine.isHost = isTimelineAuthority(this.self);
  }

  private lastViewersLog = "";

  /** Diagnostics: everything that can move playback, and viewer statuses when they change. */
  private logMessage(m: ServerMessage) {
    switch (m.type) {
      case "pong":
      case "chat":
      case "react":
      case "roles":
        return;
      case "anchor":
        diag.add("recv", `anchor ${short(m.data)} (theatre now ${Math.round(this.clock.theatreNowMs)})`);
        return;
      case "item":
        diag.add("recv", `item ${m.data ? `${m.data.id} ${m.data.kind} duration=${m.data.duration}` : "none"}`);
        return;
      case "playlist":
        diag.add("recv", `playlist ${m.data.map((i) => `${i.id}:${i.kind}:${i.duration}`).join(" ")}`);
        return;
      case "viewers": {
        const line = m.data
          .map(
            (v) =>
              `${v.id.slice(0, 6)}${v.isHost ? "(host)" : v.actingHost ? "(acting)" : ""}:${v.device}:${v.status ?? "?"}:${v.connected ? "on" : "away"}`,
          )
          .join(" ");
        if (line !== this.lastViewersLog) diag.add("recv", `viewers ${line}`);
        this.lastViewersLog = line;
        return;
      }
      case "screen":
        diag.add("recv", `screen autoAdvance=${m.data.autoAdvance} buffering=${m.data.bufferingPolicy}`);
        return;
      case "subs":
        diag.add("recv", `subs ${m.data.length}`); // their names are file names
        return;
      default:
        diag.add("recv", `${m.type} ${short(m.data, 200)}`);
    }
  }

  private onMessage(m: ServerMessage) {
    this.logMessage(m);
    switch (m.type) {
      case "pong":
        this.clock.addSample(m.data.t0, m.data.ts, this.clock.localNowMs);
        return;
      case "anchor":
        this.engine.applyAnchor(m.data);
        return;
      case "playlist":
        this.playlist = m.data;
        break;
      case "chat":
        if (this.chat.some((c) => c.id === m.data.id)) return;
        this.chat = [...this.chat, m.data].slice(-100);
        this.chatReceived.emit(m.data);
        break;
      case "subs":
        this.subs = m.data;
        break;
      case "hold":
        this.hold = m.data;
        break;
      case "ready":
        this.ready = m.data;
        break;
      case "react":
        this.reaction.emit(m.data);
        return;
      case "item":
        this.currentItem = m.data;
        this.itemChanged.emit(m.data);
        break;
      case "viewers":
        this.setViewers(m.data, null);
        break;
      case "roles":
        this.roles = m.data;
        break;
      case "cohosts":
        this.coHosts = m.data;
        break;
      case "screen":
        this.screen = m.data;
        this.code = m.data.code;
        break;
      case "error":
        // The theatre explains a final rejection just before closing (e.g. "the host closed the screen").
        if (["closed", "kicked", "banned"].includes(m.data.code)) this.finalMessage = m.data.message;
        else this.error.emit(m.data);
        return;
      default:
        return;
    }
    this.changed.emit();
  }

  private async pingBurst(samples: number) {
    if (this.bursting) return;
    this.bursting = true;
    try {
      await this.runBurst(samples);
    } finally {
      this.bursting = false;
    }
  }

  private async runBurst(samples: number) {
    for (let i = 0; i < samples; i++) {
      this.send("ping", { t0: this.clock.localNowMs });
      await sleep(this.settings.burstIntervalMs);
    }
    await sleep(500); // let the last pongs arrive
    if (this.clock.commit()) {
      diag.add("clock", `offset=${this.clock.offset.toFixed(1)} ms rtt=${this.clock.rttMs.toFixed(1)} ms (${samples} samples)`);
      this.send("rtt", { value: Math.round(this.clock.rttMs * 10) / 10 });
    }
  }

  private tick() {
    const now = this.clock.localNowMs;
    const elapsed = now - this.lastTick;
    this.engine.tick(engineStep(elapsed));
    this.lastTick = now;
    const st = this.engine.status;
    if (st.zone !== this.lastZone) {
      diag.add(
        "sync",
        `zone ${this.lastZone} → ${st.zone} drift=${st.drift.toFixed(3)} rate=${st.rate.toFixed(4)} host=${this.engine.isHost}`,
      );
      this.lastZone = st.zone;
    }
    if (elapsed > GAP_MS) diag.add("sync", `tick gap ${Math.round(elapsed)} ms`);
    if (!this.reconnecting) {
      // The device slept or the tab was frozen: the clock may have jumped, so re-sync it fully (§14.11).
      if (elapsed > GAP_MS) {
        this.lastResync = now;
        void this.pingBurst(this.settings.burstSamples);
      }
      const status = this.status.update(this.engine.status.zone, this.fileMismatch, now);
      if (status) this.send("status", { value: status });
      if (now - this.lastResync >= this.settings.resyncEveryMs) {
        this.lastResync = now;
        void this.pingBurst(this.settings.resyncSamples);
      }
    }
    this.ticked.emit();
  }

  private send(type: string, data: unknown = {}) {
    if (type !== "ping" && type !== "chat.send" && type !== "chat.gif") diag.add("send", `${type} ${short(data, 200)}`);
    this.conn?.send(type, data);
  }

  // ---- Commands (the theatre checks permissions) ----------------------------------------------

  play = () => this.send("play");
  pause = () => this.send("pause");
  seek = (to: number) => this.send("seek", { to: Math.max(0, to) });
  load = (item: NewItem) => this.send("load", item);
  addToPlaylist = (items: NewItem[], at?: number) => this.send("playlist.add", { items, ...(at === undefined ? {} : { at }) });
  removeItem = (id: string) => this.send("playlist.remove", { id });
  moveItem = (id: string, to: number) => this.send("playlist.move", { id, to });
  playItem = (id: string) => this.send("playlist.play", { id });
  skip = (next: boolean) => this.send("skip", { direction: next ? "next" : "previous" });
  reportEnded = (id: string) => this.send("item.ended", { id });
  sendChat = (text: string) => this.send("chat.send", { text });
  sendGif = (gif: Gif) => this.send("chat.gif", gif);
  react = (emoji: string) => this.send("react", { emoji });
  releaseHold = () => this.send("hold.release");
  startReadyCheck = () => this.send("ready.start");
  answerReady = (id: number, ready: boolean) => this.send("ready.answer", { id, ready });
  updateSettings = (
    s: Partial<{
      name: string;
      visibility: "public" | "private";
      password: string;
      hidden: boolean;
      maxViewers: number;
      showDevices: boolean;
      autoAdvance: boolean;
      bufferingPolicy: "keep" | "wait";
    }>,
  ) => this.send("settings.update", s);
  regenerateCode = () => this.send("code.regenerate");
  createRole = (name: string, colour: string | null, permissions: string[], position?: number) =>
    this.send("roles.create", { name, colour, permissions, ...(position === undefined ? {} : { position }) });
  updateRole = (id: string, fields: { name?: string; colour?: string | null; permissions?: string[]; position?: number }) =>
    this.send("roles.update", { id, ...fields });
  deleteRole = (id: string) => this.send("roles.delete", { id });
  assignRole = (viewer: string, role: string, assigned: boolean) => this.send("roles.assign", { viewer, role, assigned });
  setOverrides = (viewer: string, allow: string[], deny: string[]) => this.send("viewer.overrides", { viewer, allow, deny });
  mute = (viewer: string, muted: boolean) => this.send("viewer.mute", { viewer, muted });
  kick = (viewer: string) => this.send("viewer.kick", { viewer });
  ban = (viewer: string) => this.send("viewer.ban", { viewer });
  setCoHosts = (viewers: string[]) => this.send("cohosts.set", { viewers });
  transferHost = (viewer: string) => this.send("host.transfer", { viewer });
  closeScreen = () => this.send("screen.close");
  unshareSubtitle = (id: string) => this.send("subs.unshare", { id });

  setCoHost(viewer: string, coHost: boolean) {
    const ids = this.coHosts.map((c) => c.id).filter((id) => id !== viewer);
    if (coHost) ids.push(viewer);
    this.setCoHosts(ids);
  }

  moveCoHost(viewer: string, delta: number) {
    const ids = this.coHosts.map((c) => c.id);
    const i = ids.indexOf(viewer);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    this.setCoHosts(ids);
  }

  shareSubtitle(itemId: string, name: string, format: string, content: Uint8Array) {
    return this.api.uploadSubtitle(this.code, this.token, itemId, name, format, content);
  }

  downloadSubtitle(sub: SubMeta) {
    return this.api.downloadSubtitle(this.code, this.token, sub.id);
  }

  /** Test hook: drops the connection the way a network failure would, which should trigger a silent reconnect. */
  simulateNetworkDrop() {
    const c = this.conn;
    if (!c) return;
    const closed = c.onClosed;
    c.onClosed = () => {};
    c.onMessage = () => {};
    c.close();
    closed(1006, "network drop (simulated)");
  }

  /** Leaves the screen; `leave` first so the theatre frees the seat at once (no reconnect grace). */
  dispose(sendLeave = true) {
    if (this.disposed) return;
    this.disposed = true;
    if (sendLeave && this.loop !== null) this.send("leave");
    this.loop?.();
    this.loop = null;
    this.engine.enabled = false;
    const c = this.conn;
    this.conn = null;
    // Let `leave` go out before closing.
    if (c) setTimeout(() => c.close(), 50);
  }
}
