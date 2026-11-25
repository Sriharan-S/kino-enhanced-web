import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeviceIdentity } from "../core/identity";
import { normaliseCode, parseInvite } from "../core/media";
import { load, loadTheatres, type TheatreApi, type TheatreEntry, TheatreError, TheatreNetwork, store } from "../core/net";
import type { CreateScreenRequest, ResolveResponse } from "../core/protocol";
import { ScreenSession } from "../core/session";
import { Html5Playback } from "../player/html5";
import { describeError, Dialog } from "./common";
import { Lobby } from "./Lobby";
import { ScreenView } from "./ScreenView";

const NAME_KEY = "kino.name";
const MEMBER_KEY = "kino.member";
const profile = new URLSearchParams(location.search).get("profile") ?? "default";

/** Screens this browser has joined before: the theatre remembers members, so no password is needed again. */
function isMember(screenId: string) {
  try {
    return (JSON.parse(load(MEMBER_KEY) ?? "[]") as string[]).includes(screenId);
  } catch {
    return false;
  }
}
function rememberMember(screenId: string) {
  try {
    const list = (JSON.parse(load(MEMBER_KEY) ?? "[]") as string[]).filter((s) => s !== screenId);
    store(MEMBER_KEY, JSON.stringify([screenId, ...list].slice(0, 100)));
  } catch {
    store(MEMBER_KEY, JSON.stringify([screenId]));
  }
}

type Pending =
  | { kind: "name"; then: (name: string) => void }
  | { kind: "password"; api: TheatreApi; screen: ResolveResponse; error: string | null }
  | null;

export function App() {
  const [network, setNetwork] = useState<TheatreNetwork | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [name, setName] = useState(() => load(NAME_KEY) ?? "");
  const [session, setSession] = useState<{ s: ScreenSession; theatre: TheatreEntry } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const video = useMemo(() => {
    const v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    return v;
  }, []);
  const playback = useMemo(() => new Html5Playback(video), [video]);
  const handledHash = useRef(false);

  useEffect(() => {
    void (async () => {
      const [{ theatres }, id] = await Promise.all([loadTheatres(), DeviceIdentity.loadOrCreate(profile)]);
      setNetwork(new TheatreNetwork(theatres));
      setIdentity(id);
    })();
  }, []);

  const withName = useCallback(
    (then: (n: string) => void) => {
      if (name.trim()) then(name.trim());
      else setPending({ kind: "name", then });
    },
    [name],
  );

  const enter = useCallback((s: ScreenSession, theatre: TheatreEntry) => {
    setSession({ s, theatre });
    setMessage(null);
    history.replaceState(null, "", `${location.pathname}${location.search}#${theatre.id}/${s.code}`);
  }, []);

  const joinResolved = useCallback(
    (api: TheatreApi, screen: ResolveResponse, password: string | null) =>
      withName(async (displayName) => {
        if (!identity) return;
        if (screen.requiresPassword && password === null && !isMember(screen.screenId)) {
          setPending({ kind: "password", api, screen, error: null });
          return;
        }
        setBusy(`Joining ${screen.name}…`);
        try {
          const s = await ScreenSession.joinResolved(api, identity, playback, screen, displayName, password);
          rememberMember(screen.screenId);
          setPending(null);
          enter(s, api.theatre);
        } catch (e) {
          const code = e instanceof TheatreError ? e.code : null;
          if (code === "wrong_password" || (code === null && screen.requiresPassword && password === null)) {
            setPending({ kind: "password", api, screen, error: password === null ? null : "Wrong password." });
          } else {
            setPending(null);
            setMessage(describeError(code, e instanceof Error ? e.message : String(e)));
          }
        } finally {
          setBusy(null);
        }
      }),
    [identity, playback, withName, enter],
  );

  const joinCode = useCallback(
    async (raw: string, theatreId?: string) => {
      if (!network) return;
      const code = normaliseCode(raw);
      if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(code)) {
        setMessage("Screen codes are 6 letters and digits.");
        return;
      }
      setBusy(`Looking for ${code}…`);
      try {
        const api = theatreId ? network.api(theatreId) : undefined;
        let found: { api: TheatreApi; screen: ResolveResponse } | null = null;
        if (api) {
          const screen = await api.resolve(code).catch(() => null);
          found = screen ? { api, screen } : null;
        }
        if (!found) {
          const r = await network.resolve(code);
          found = r.found;
          if (!found) {
            setMessage(
              r.unreachable > 0
                ? `No screen ${code} found. ${r.unreachable} theatre${r.unreachable > 1 ? "s" : ""} didn't answer; try again in a moment.`
                : `No screen with code ${code}.`,
            );
            return;
          }
        }
        setBusy(null);
        joinResolved(found.api, found.screen, null);
      } finally {
        setBusy(null);
      }
    },
    [network, joinResolved],
  );

  const create = useCallback(
    (theatre: TheatreApi, req: CreateScreenRequest) =>
      withName(async (displayName) => {
        if (!identity) return;
        setBusy("Creating your screen…");
        try {
          const { session: s, created } = await ScreenSession.create(theatre, identity, playback, req, displayName);
          rememberMember(created.screenId);
          enter(s, theatre.theatre);
        } catch (e) {
          setMessage(describeError(e instanceof TheatreError ? e.code : null, e instanceof Error ? e.message : String(e)));
        } finally {
          setBusy(null);
        }
      }),
    [identity, playback, withName, enter],
  );

  const leave = useCallback(
    (reason?: string) => {
      session?.s.dispose();
      setSession(null);
      if (reason) setMessage(describeError(reason, reason));
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    },
    [session],
  );

  // Invite in the address (#aurora/7K3QXM): join it once everything is ready.
  useEffect(() => {
    if (!network || !identity || handledHash.current) return;
    handledHash.current = true;
    const invite = parseInvite(location.hash);
    if (invite) void joinCode(invite.code, invite.theatreId);
  }, [network, identity, joinCode]);

  useEffect(() => {
    const onHash = () => {
      const invite = parseInvite(location.hash);
      if (invite && !session) void joinCode(invite.code, invite.theatreId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [joinCode, session]);

  // Closing the tab frees the seat at once.
  useEffect(() => {
    const onHide = () => session?.s.dispose();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [session]);

  const saveName = (n: string) => {
    const clean = n.trim().slice(0, 32);
    setName(clean);
    store(NAME_KEY, clean);
    return clean;
  };

  return (
    <>
      {session ? (
        <ScreenView
          key={session.s.code + session.theatre.id}
          session={session.s}
          theatre={session.theatre}
          playback={playback}
          onLeave={leave}
        />
      ) : (
        <Lobby
          network={network}
          name={name}
          onRename={() => setPending({ kind: "name", then: () => {} })}
          onJoin={(api, screen) => joinResolved(api, screen, null)}
          onJoinCode={(code) => void joinCode(code)}
          onCreate={create}
          message={message}
          onDismissMessage={() => setMessage(null)}
        />
      )}

      {busy && (
        <div className="backdrop">
          <div className="dialog card">
            <p>{busy}</p>
          </div>
        </div>
      )}

      {pending?.kind === "name" && (
        <NameDialog
          initial={name}
          onCancel={() => setPending(null)}
          onSave={(n) => {
            const clean = saveName(n);
            const then = pending.then;
            setPending(null);
            then(clean);
          }}
        />
      )}

      {pending?.kind === "password" && (
        <PasswordDialog
          screenName={pending.screen.name}
          error={pending.error}
          onCancel={() => setPending(null)}
          onSubmit={(pw) => joinResolved(pending.api, pending.screen, pw)}
        />
      )}
    </>
  );
}

function NameDialog({ initial, onSave, onCancel }: { initial: string; onSave: (n: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ok = value.trim().length > 0;
  return (
    <Dialog title="Your name" onClose={onCancel}>
      <p className="muted small">Shown to others in the screen. Up to 32 characters.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(value);
        }}
      >
        <input className="input" value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} placeholder="Name" />
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordDialog({
  screenName,
  error,
  onSubmit,
  onCancel,
}: {
  screenName: string;
  error: string | null;
  onSubmit: (pw: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Dialog title={`Join ${screenName}`} onClose={onCancel}>
      <p className="muted small">This screen is private. Enter its password.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSubmit(value);
        }}
      >
        <input
          className="input"
          type="password"
          value={value}
          maxLength={128}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
        />
        {error && <p className="error-text small">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value}>
            Join
          </button>
        </div>
      </form>
    </Dialog>
  );
}
