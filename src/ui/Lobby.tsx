import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyLobbyQuery,
  type LobbyQuery,
  type LobbySort,
  mergeLobbies,
  type TheatreApi,
  type TheatreLobby,
  type TheatreNetwork,
  TheatreNetwork as Net,
  probeProblem,
  type TheatreProbe,
} from "../core/net";
import type { CreateScreenRequest, LobbyScreen, ResolveResponse } from "../core/protocol";
import { Dialog } from "./common";

const REFRESH_MS = 15_000;

interface Props {
  network: TheatreNetwork | null;
  name: string;
  onRename: () => void;
  onJoin: (api: TheatreApi, screen: ResolveResponse) => void;
  onJoinCode: (code: string) => void;
  onCreate: (api: TheatreApi, req: CreateScreenRequest) => void;
  message: string | null;
  onDismissMessage: () => void;
}

export function Lobby({ network, name, onRename, onJoin, onJoinCode, onCreate, message, onDismissMessage }: Props) {
  const [lobbies, setLobbies] = useState<TheatreLobby[]>([]);
  const [probes, setProbes] = useState<TheatreProbe[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState<LobbyQuery>({ search: "", visibility: "all", theatreId: null, sort: "viewers" });
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!network) return;
    setLobbies(await network.lobbyAll());
    setLoading(false);
  }, [network]);

  useEffect(() => {
    if (!network) return;
    void network.probeAll().then(setProbes);
    void refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [network, refresh]);

  const pings = useMemo(() => Object.fromEntries(probes.filter((p) => p.rttMs !== null).map((p) => [p.theatre.id, p.rttMs!])), [probes]);
  const entries = useMemo(() => applyLobbyQuery(mergeLobbies(lobbies, pings), query), [lobbies, pings, query]);

  const join = (theatreId: string, s: LobbyScreen) => {
    const api = network?.api(theatreId);
    if (!api) return;
    // The lobby already tells us enough to skip a resolve round trip, except the internal screen id.
    void api.resolve(s.code).then((r) => (r ? onJoin(api, r) : void refresh()));
  };

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div className="brand">
          <img src="/kino.png" alt="" />
          <div>
            <h1>Kino</h1>
            <div className="tag">Watch together, in sync. Everyone plays their own copy.</div>
          </div>
        </div>
        <div className="spacer" />
        <button className="btn ghost" onClick={onRename} title="Change your name">
          {name ? `👤 ${name}` : "Set your name"}
        </button>
      </header>

      {message && (
        <div className="card row" style={{ padding: "10px 14px", marginBottom: 14, borderColor: "var(--warn)" }}>
          <span>{message}</span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={onDismissMessage}>
            Dismiss
          </button>
        </div>
      )}

      <section className="card lobby-actions">
        <button className="btn primary" disabled={!network} onClick={() => setCreating(true)}>
          ＋ Create a screen
        </button>
        <span className="muted small" style={{ margin: "0 6px" }}>
          or
        </span>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onJoinCode(code);
          }}
        >
          <input
            className="input code-input"
            placeholder="CODE"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9a-z]/gi, ""))}
            aria-label="Screen code"
          />
          <button className="btn" disabled={!network || code.length !== 6}>
            Join
          </button>
        </form>
      </section>

      <div className="filters">
        <input
          className="input search"
          placeholder="Search screens, hosts or codes"
          value={query.search}
          onChange={(e) => setQuery({ ...query, search: e.target.value })}
        />
        <select
          className="input"
          value={query.visibility}
          onChange={(e) => setQuery({ ...query, visibility: e.target.value as LobbyQuery["visibility"] })}
        >
          <option value="all">All screens</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <select className="input" value={query.theatreId ?? ""} onChange={(e) => setQuery({ ...query, theatreId: e.target.value || null })}>
          <option value="">All theatres</option>
          {network?.theatres.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="input" value={query.sort} onChange={(e) => setQuery({ ...query, sort: e.target.value as LobbySort })}>
          <option value="viewers">Most viewers</option>
          <option value="ping">Lowest ping</option>
          <option value="name">Name</option>
        </select>
        <button
          className="btn"
          onClick={() => {
            void refresh();
            if (network) void network.probeAll().then(setProbes);
          }}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="theatres">
        {(network?.theatres ?? []).map((t) => {
          const l = lobbies.find((x) => x.theatre.id === t.id);
          const p = probes.find((x) => x.theatre.id === t.id);
          const problem = p ? probeProblem(p) : l?.failure ? `unavailable (${l.failure})` : null;
          const known = !!(l || p);
          return (
            <span key={t.id} title={problem ?? ""}>
              <span className={`dot ${known ? (problem ? "bad" : "ok") : ""}`} />
              {t.name}
              {problem ? ` · ${problem}` : pings[t.id] !== undefined ? ` · ${Math.round(pings[t.id]!)} ms` : ""}
            </span>
          );
        })}
      </div>

      <div className="screens">
        {loading ? (
          <div className="empty card">Looking for screens…</div>
        ) : entries.length === 0 ? (
          <div className="empty card">
            {query.search || query.visibility !== "all" || query.theatreId
              ? "No screens match."
              : "No public screens right now. Create one!"}
          </div>
        ) : (
          entries.map((e) => {
            const full = e.screen.viewers >= e.screen.maxViewers;
            return (
              <button key={e.key} className="card screen-row" disabled={full} onClick={() => join(e.theatre.id, e.screen)}>
                <div>
                  <div className="name">
                    {e.screen.visibility === "private" && "🔒 "}
                    {e.screen.name}
                  </div>
                  <div className="meta">
                    {e.screen.host ? `Hosted by ${e.screen.host} · ` : ""}
                    {e.theatre.name}
                    {e.pingMs !== null ? ` · ${Math.round(e.pingMs)} ms` : ""}
                  </div>
                </div>
                <div className="meta">{full ? "Full" : `${e.screen.viewers}/${e.screen.maxViewers}`}</div>
              </button>
            );
          })
        )}
      </div>

      <footer className="footer">
        Kino syncs playback only; video never leaves your device. Prefer an app?{" "}
        <a href="https://kino-directory.srie.workers.dev/download" target="_blank" rel="noreferrer">
          Download Kino for Windows
        </a>
        {" · "}
        <a href="https://github.com/Sriharan-S/kino-enhanced" target="_blank" rel="noreferrer">
          Source
        </a>
      </footer>

      {creating && network && (
        <CreateDialog
          network={network}
          probes={probes}
          onCancel={() => setCreating(false)}
          onCreate={(api, req) => {
            setCreating(false);
            onCreate(api, req);
          }}
        />
      )}
    </div>
  );
}

function CreateDialog({
  network,
  probes,
  onCreate,
  onCancel,
}: {
  network: TheatreNetwork;
  probes: TheatreProbe[];
  onCreate: (api: TheatreApi, req: CreateScreenRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [password, setPassword] = useState("");
  const [hidden, setHidden] = useState(false);
  const [maxViewers, setMaxViewers] = useState(10);
  const [theatreId, setTheatreId] = useState("");
  const fastest = Net.fastest(probes);
  const probed = probes.length === network.theatres.length;
  const noneUsable = probed && !fastest;
  const chosen = theatreId ? probes.find((x) => x.theatre.id === theatreId) : undefined;
  const ok = name.trim().length > 0 && (!priv || password.length > 0) && !noneUsable && !(chosen && probeProblem(chosen));

  return (
    <Dialog title="Create a screen" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          const api = network.api(theatreId || fastest?.theatre.id || network.theatres[0]!.id);
          if (!api) return;
          onCreate(api, {
            name: name.trim(),
            visibility: priv ? "private" : "public",
            ...(priv ? { password, hidden } : {}),
            maxViewers,
          });
        }}
      >
        <label className="field">
          Name
          <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Movie night" />
        </label>
        <label className="check">
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private (needs a password)
        </label>
        {priv && (
          <>
            <label className="field">
              Password
              <input className="input" type="password" value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from the lobby (join by code or
              link only)
            </label>
          </>
        )}
        <label className="field">
          Max viewers
          <input
            className="input"
            type="number"
            min={2}
            max={25}
            value={maxViewers}
            onChange={(e) => setMaxViewers(Math.min(25, Math.max(2, Number(e.target.value) || 2)))}
          />
        </label>
        <label className="field">
          Theatre
          <select className="input" value={theatreId} onChange={(e) => setTheatreId(e.target.value)}>
            <option value="">
              Automatic
              {fastest ? ` (${fastest.theatre.name}, ${Math.round(fastest.rttMs ?? 0)} ms)` : probed ? "" : " (checking theatres…)"}
            </option>
            {network.theatres.map((t) => {
              const p = probes.find((x) => x.theatre.id === t.id);
              const problem = p ? probeProblem(p) : null;
              return (
                <option key={t.id} value={t.id} disabled={!!problem}>
                  {t.name}
                  {problem ? ` (${problem})` : p?.rttMs != null ? ` (${Math.round(p.rttMs)} ms)` : ""}
                </option>
              );
            })}
          </select>
        </label>
        {noneUsable && <p className="error-text small">No theatre is available right now; try again in a moment.</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
