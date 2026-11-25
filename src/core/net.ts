// Theatres: the directory list, HTTP calls to one theatre, and parallel operations across all of them (spec §4, §8, §10).
import {
  type CreateScreenRequest,
  type CreateScreenResponse,
  type LobbyScreen,
  PROTOCOL_VERSION,
  type ResolveResponse,
  type SubMeta,
  type TheatreInfo,
} from "./protocol";

export interface TheatreEntry {
  id: string;
  name: string;
  url: string;
}

export type DirectorySource = "live" | "cached" | "bundled";

export const DIRECTORY_URL = "https://kino-directory.srie.workers.dev/servers.json";

/** Used when the directory has never been reachable from this browser. */
export const BUNDLED: TheatreEntry[] = [
  { id: "aurora", name: "Aurora", url: "https://kino-aurora.srie.workers.dev" },
  { id: "nova", name: "Nova", url: "https://kino-nova.sri-me.workers.dev" },
];

const CACHE_KEY = "kino.servers";

/** HTTPS only, except loopback for local development. */
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Parses and validates a directory file; null if unusable. */
export function parseDirectory(json: string): TheatreEntry[] | null {
  let f: unknown;
  try {
    f = JSON.parse(json);
  } catch {
    return null;
  }
  const file = f as { version?: unknown; theatres?: unknown };
  if (!file || file.version !== 1 || !Array.isArray(file.theatres)) return null;
  const seen = new Set<string>();
  const valid: TheatreEntry[] = [];
  for (const t of file.theatres as Partial<TheatreEntry>[]) {
    if (!t || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || !t.name || typeof t.url !== "string") continue;
    if (!isAllowedUrl(t.url) || seen.has(t.id)) continue;
    seen.add(t.id);
    valid.push({ id: t.id, name: t.name, url: t.url });
  }
  return valid.length ? valid : null;
}

/** Live servers.json, else the last good copy, else the bundled list. `?theatre=<url>` overrides it (local testing). */
export async function loadTheatres(): Promise<{ theatres: TheatreEntry[]; source: DirectorySource }> {
  const override = new URLSearchParams(location.search).get("theatre");
  if (override && isAllowedUrl(override)) return { theatres: [{ id: "local", name: "Local", url: override }], source: "live" };
  try {
    const res = await fetchWithTimeout(DIRECTORY_URL, {}, 4000);
    const text = await res.text();
    const live = res.ok ? parseDirectory(text) : null;
    if (live) {
      store(CACHE_KEY, text);
      return { theatres: live, source: "live" };
    }
  } catch {
    // offline or blocked: fall through
  }
  const cached = load(CACHE_KEY);
  const parsed = cached ? parseDirectory(cached) : null;
  return parsed ? { theatres: parsed, source: "cached" } : { theatres: BUNDLED, source: "bundled" };
}

export class TheatreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timed out", "TimeoutError")), ms);
  const onAbort = () => ctl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `${res.status}`;
  let code: string | null = null;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    message = body.error?.message ?? message;
    code = body.error?.code ?? null;
  } catch {
    // not JSON
  }
  throw new TheatreError(res.status, message, code);
}

/** HTTP calls to one theatre (protocol §2). */
export class TheatreApi {
  constructor(readonly theatre: TheatreEntry) {}

  private url(path: string) {
    return new URL(path, this.theatre.url).toString();
  }

  async info(signal?: AbortSignal): Promise<TheatreInfo> {
    return (await ensureOk(await fetchWithTimeout(this.url("/info"), {}, 5000, signal))).json();
  }

  async lobby(signal?: AbortSignal): Promise<LobbyScreen[]> {
    const body = (await (await ensureOk(await fetchWithTimeout(this.url("/lobby"), {}, 5000, signal))).json()) as {
      screens?: LobbyScreen[];
    };
    return body.screens ?? [];
  }

  async createScreen(req: CreateScreenRequest): Promise<CreateScreenResponse> {
    const res = await fetchWithTimeout(
      this.url("/screens"),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
      10_000,
    );
    return (await ensureOk(res)).json();
  }

  async resolve(code: string, signal?: AbortSignal): Promise<ResolveResponse | null> {
    const res = await fetchWithTimeout(this.url(`/resolve/${encodeURIComponent(code)}`), {}, 5000, signal);
    if (res.status === 404) return null;
    return (await ensureOk(res)).json();
  }

  webSocketUrl(code: string): string {
    const u = new URL(`/screens/${encodeURIComponent(code)}/ws`, this.theatre.url);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }

  /** Shares a subtitle file: gzip-compressed, at most 1 MB (spec §17.2). */
  async uploadSubtitle(code: string, token: string, itemId: string, name: string, format: string, content: Uint8Array): Promise<SubMeta> {
    const gz = await gzip(content);
    if (gz.byteLength > MAX_SUBTITLE_BYTES) throw new TheatreError(413, "subtitle file is too big (over 1 MB compressed)");
    const q = new URLSearchParams({ item: itemId, format, name });
    const res = await fetchWithTimeout(
      this.url(`/screens/${encodeURIComponent(code)}/subs?${q}`),
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new Blob([gz as BlobPart]) },
      20_000,
    );
    return (await ensureOk(res)).json();
  }

  async downloadSubtitle(code: string, token: string, id: string): Promise<Uint8Array> {
    const res = await fetchWithTimeout(
      this.url(`/screens/${encodeURIComponent(code)}/subs/${encodeURIComponent(id)}`),
      { headers: { Authorization: `Bearer ${token}` } },
      20_000,
    );
    await ensureOk(res);
    const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

export const MAX_SUBTITLE_BYTES = 1024 * 1024;

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- Across every theatre ------------------------------------------------------------------------

export interface TheatreProbe {
  theatre: TheatreEntry;
  info: TheatreInfo | null;
  rttMs: number | null;
  failure: string | null;
}

export const isUsable = (p: TheatreProbe) =>
  !!p.info && p.info.status === "ok" && p.info.minProtocol <= PROTOCOL_VERSION && PROTOCOL_VERSION <= p.info.protocol;

export interface TheatreLobby {
  theatre: TheatreEntry;
  screens: LobbyScreen[];
  requestMs: number | null;
  failure: string | null;
}

const failureText = (e: unknown) =>
  e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")
    ? "timed out"
    : e instanceof Error
      ? e.message
      : String(e);

export class TheatreNetwork {
  private apis = new Map<string, TheatreApi>();

  constructor(readonly theatres: TheatreEntry[]) {
    for (const t of theatres) this.apis.set(t.id, new TheatreApi(t));
  }

  api(theatreId: string): TheatreApi | undefined {
    return this.apis.get(theatreId);
  }

  /** The first request warms up the connection, so the second one is timed. */
  probeAll(): Promise<TheatreProbe[]> {
    return Promise.all(
      this.theatres.map(async (theatre) => {
        try {
          const api = this.apis.get(theatre.id)!;
          await api.info();
          const start = performance.now();
          const info = await api.info();
          return { theatre, info, rttMs: performance.now() - start, failure: null };
        } catch (e) {
          return { theatre, info: null, rttMs: null, failure: failureText(e) };
        }
      }),
    );
  }

  static fastest(probes: TheatreProbe[]): TheatreProbe | null {
    return probes.filter(isUsable).sort((a, b) => (a.rttMs ?? Infinity) - (b.rttMs ?? Infinity))[0] ?? null;
  }

  lobbyAll(): Promise<TheatreLobby[]> {
    return Promise.all(
      this.theatres.map(async (theatre) => {
        const start = performance.now();
        try {
          const screens = await this.apis.get(theatre.id)!.lobby();
          return { theatre, screens, requestMs: performance.now() - start, failure: null };
        } catch (e) {
          return { theatre, screens: [], requestMs: null, failure: failureText(e) };
        }
      }),
    );
  }

  /** Looks a code up on every theatre in parallel; the first match wins. */
  async resolve(code: string): Promise<{ found: { api: TheatreApi; screen: ResolveResponse } | null; unreachable: number }> {
    const ctl = new AbortController();
    let unreachable = 0;
    const found = await new Promise<{ api: TheatreApi; screen: ResolveResponse } | null>((resolve) => {
      let pending = this.theatres.length;
      if (pending === 0) resolve(null);
      for (const t of this.theatres) {
        const api = this.apis.get(t.id)!;
        api
          .resolve(code, ctl.signal)
          .then((screen) => {
            if (screen) resolve({ api, screen });
          })
          .catch(() => unreachable++)
          .finally(() => {
            if (--pending === 0) resolve(null);
          });
      }
    });
    ctl.abort();
    return { found, unreachable };
  }
}

// ---- Unified lobby (spec §10.2): pure, so it is unit tested ---------------------------------------

export interface LobbyEntry {
  theatre: TheatreEntry;
  screen: LobbyScreen;
  pingMs: number | null;
  key: string;
}

export type LobbySort = "viewers" | "ping" | "name";

export interface LobbyQuery {
  search: string;
  visibility: "all" | "public" | "private";
  theatreId: string | null;
  sort: LobbySort;
}

export function mergeLobbies(lobbies: TheatreLobby[], pings: Record<string, number> = {}): LobbyEntry[] {
  return lobbies
    .filter((l) => !l.failure)
    .flatMap((l) =>
      l.screens.map((screen) => ({
        theatre: l.theatre,
        screen,
        pingMs: pings[l.theatre.id] ?? l.requestMs,
        key: `${l.theatre.id}/${screen.code}`,
      })),
    );
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function applyLobbyQuery(entries: LobbyEntry[], q: LobbyQuery): LobbyEntry[] {
  const search = q.search.trim().toLowerCase();
  const isFull = (e: LobbyEntry) => e.screen.viewers >= e.screen.maxViewers;
  return entries
    .filter(
      (e) =>
        (q.visibility === "all" || e.screen.visibility === q.visibility) &&
        (q.theatreId === null || e.theatre.id === q.theatreId) &&
        (!search ||
          e.screen.name.toLowerCase().includes(search) ||
          !!e.screen.host?.toLowerCase().includes(search) ||
          e.screen.code.toLowerCase() === search),
    )
    .sort((a, b) => {
      const primary =
        q.sort === "ping"
          ? (a.pingMs ?? Infinity) - (b.pingMs ?? Infinity)
          : q.sort === "name"
            ? collator.compare(a.screen.name, b.screen.name)
            : Number(isFull(a)) - Number(isFull(b)) || b.screen.viewers - a.screen.viewers;
      return primary || collator.compare(a.screen.name, b.screen.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
}

// ---- Small storage helpers (storage can be blocked; never let that break the app) ----------------

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
