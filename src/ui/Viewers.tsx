// The Viewers tab (spec §12, §7–§9): who is here, on what, how far away, whether they are in sync, and what you may do
// to each of them.
import { useEffect, useRef, useState } from "react";
import type { ViewerInfo } from "../core/protocol";
import { latencyBand, type ViewerAction, viewerActions } from "../core/rbac";
import type { ScreenSession } from "../core/session";
import { ConfirmDialog, useSubscribe } from "./common";
import { OverridesDialog } from "./Roles";

const STATUS: Record<string, { icon: string; text: string }> = {
  sync: { icon: "🟢", text: "in sync" },
  catching: { icon: "🟡", text: "catching up" },
  buffering: { icon: "🔵", text: "buffering" },
  mismatch: { icon: "⚠", text: "file differs" },
  waiting: { icon: "⏳", text: "waiting" },
  nofile: { icon: "⛔", text: "no file" },
};

const DEVICE_NAMES: Record<string, string> = { windows: "Windows", linux: "Linux", android: "Android", web: "Web browser" };

/** Small monochrome platform icons (C-10.3); the platform name is the accessible name and tooltip. */
export function DeviceIcon({ device }: { device: string }) {
  const name = DEVICE_NAMES[device] ?? device;
  const path =
    device === "windows"
      ? "M1 2.5 6.5 1.7v5.6H1zm6.5-.9L15 .5v6.8H7.5zM1 8.7h5.5v5.6L1 13.5zm6.5 0H15v6.8l-7.5-1.1z"
      : device === "android"
        ? "M4.6 5.4h6.8v6.1a.9.9 0 0 1-.9.9H10v2a.9.9 0 0 1-1.8 0v-2H7.8v2a.9.9 0 0 1-1.8 0v-2h-.5a.9.9 0 0 1-.9-.9zM3 5.6a.8.8 0 0 1 1.6 0v3.8a.8.8 0 0 1-1.6 0zm9.4 0a.8.8 0 0 1 1.6 0v3.8a.8.8 0 0 1-1.6 0zM4.7 4.8a3.4 3.4 0 0 1 6.6 0zM5.2 1l.9 1.5M10.8 1l-.9 1.5"
        : device === "linux"
          ? "M8 1c1.7 0 2.6 1.4 2.6 3.2 0 1 .3 1.6.9 2.5.8 1.2 1.6 2.6 1.6 4.3 0 .5-.1.9-.4 1.2l.9 1.1c.3.4 0 .9-.5.9H10.6a2.7 2.7 0 0 1-5.2 0H2.9c-.5 0-.8-.5-.5-.9l.9-1.1c-.3-.3-.4-.7-.4-1.2 0-1.7.8-3.1 1.6-4.3.6-.9.9-1.5.9-2.5C5.4 2.4 6.3 1 8 1zm-1 3.2a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2zm2 0a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2z"
          : "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm4.9 6.3h-2.3a11 11 0 0 0-.8-3.9 5.6 5.6 0 0 1 3.1 3.9zM8 2.5c.6.8 1.1 2.4 1.2 4.8H6.8C6.9 4.9 7.4 3.3 8 2.5zM6.2 3.4a11 11 0 0 0-.8 3.9H3.1a5.6 5.6 0 0 1 3.1-3.9zM3.1 8.7h2.3c.1 1.5.4 2.9.8 3.9a5.6 5.6 0 0 1-3.1-3.9zM8 13.5c-.6-.8-1.1-2.4-1.2-4.8h2.4c-.1 2.4-.6 4-1.2 4.8zm1.8-.9c.4-1 .7-2.4.8-3.9h2.3a5.6 5.6 0 0 1-3.1 3.9z";
  return (
    <svg className="device-icon" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={name}>
      <title>{name}</title>
      <path
        d={path}
        fill={device === "android" || device === "windows" || device === "linux" || device === "web" ? "currentColor" : "none"}
        stroke={device === "android" ? "currentColor" : "none"}
        strokeWidth={device === "android" ? 0.4 : 0}
      />
    </svg>
  );
}

/** "45 ms" with its band (C-10.6), or "–". */
export function Ping({ rtt }: { rtt: number | null | undefined }) {
  const band = latencyBand(rtt);
  if (!band) return <span className="ping muted">–</span>;
  return (
    <span
      className={`ping ping-${band}`}
      title={band === "good" ? "Good connection" : band === "fair" ? "Fair connection" : "Slow connection"}
    >
      <span className="ping-dot" aria-hidden="true" />
      {Math.round(rtt!)} ms
    </span>
  );
}

type Pending = { kind: "ban" | "makeHost"; viewer: ViewerInfo } | { kind: "permissions"; viewer: ViewerInfo } | null;

export function Viewers({ session: s, onOpenRoles }: { session: ScreenSession; onOpenRoles: () => void }) {
  useSubscribe(s.changed);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const sorted = [...s.viewers].sort(
    (a, b) => Number(b.isHost) - Number(a.isHost) || (a.coHost ?? 99) - (b.coHost ?? 99) || a.name.localeCompare(b.name),
  );
  const present = new Set(s.viewers.map((v) => v.id));
  const away = s.coHosts.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => !present.has(c.id));

  const run = (a: ViewerAction, v: ViewerInfo) => {
    setMenuFor(null);
    switch (a.kind) {
      case "mute":
      case "unmute":
        return s.mute(v.id, a.kind === "mute");
      case "kick":
        return s.kick(v.id);
      case "ban":
      case "makeHost":
      case "permissions":
        return setPending({ kind: a.kind, viewer: v });
      case "role":
        return s.assignRole(v.id, a.role.id, !a.assigned);
      case "makeCoHost":
        return s.setCoHost(v.id, true);
      case "removeCoHost":
        return s.setCoHost(v.id, false);
      case "moveUp":
        return s.moveCoHost(v.id, -1);
      case "moveDown":
        return s.moveCoHost(v.id, 1);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted small">
          Your ping: <Ping rtt={Number.isFinite(s.clock.rttMs) ? s.clock.rttMs : null} />
        </span>
        <span className="spacer" />
        <button className="btn small" onClick={onOpenRoles}>
          Roles
        </button>
      </div>
      <div className="list">
        {sorted.map((v) => {
          const actions = viewerActions(s.self, v, s.roles, s.coHosts);
          const reconnecting = v.connected === false;
          const st = STATUS[v.status ?? "sync"]!;
          return (
            <div key={v.id} className={`list-item viewer ${reconnecting ? "away" : ""}`}>
              <div style={{ minWidth: 0 }}>
                <div className="name">
                  {s.screen?.showDevices && v.device && <DeviceIcon device={v.device} />}
                  {v.name}
                  {v.id === s.self?.id && <span className="badge">you</span>}
                  {v.isHost && <span className="badge host">host</span>}
                  {v.actingHost && <span className="badge host">acting host</span>}
                  {v.coHost != null && <span className="badge">co-host #{v.coHost}</span>}
                  {v.muted && (
                    <span className="badge" title="Chat-muted" aria-label="Chat-muted">
                      🔇
                    </span>
                  )}
                  {(v.roles ?? []).map((id) => {
                    const r = s.roles.find((x) => x.id === id);
                    return r ? (
                      <span key={id} className="badge role">
                        <span className="role-dot" style={{ background: r.colour ?? "var(--muted)" }} aria-hidden="true" />
                        {r.name}
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="small muted">
                  {reconnecting ? (
                    "reconnecting…"
                  ) : (
                    <>
                      <span className={`st-${v.status ?? "sync"}`}>
                        <span aria-hidden="true">{st.icon}</span> {st.text}
                      </span>
                      {" · "}
                      <Ping rtt={v.rtt} />
                    </>
                  )}
                </div>
              </div>
              {v.id !== s.self?.id && (
                <ViewerMenu
                  open={menuFor === v.id}
                  onToggle={(o) => setMenuFor(o ? v.id : null)}
                  viewer={v}
                  actions={actions}
                  onRun={(a) => run(a, v)}
                />
              )}
            </div>
          );
        })}
        {away.map((c) => {
          const v: ViewerInfo = {
            id: c.id,
            name: c.name,
            device: null,
            isHost: false,
            rtt: null,
            buffering: false,
            coHost: c.n,
            connected: false,
          };
          const actions = viewerActions(s.self, v, s.roles, s.coHosts).filter((a) =>
            ["removeCoHost", "moveUp", "moveDown"].includes(a.kind),
          );
          return (
            <div key={`away-${c.id}`} className="list-item viewer away">
              <div className="name">
                Away: {c.name} <span className="badge">co-host #{c.n}</span>
              </div>
              <ViewerMenu
                open={menuFor === `away-${c.id}`}
                onToggle={(o) => setMenuFor(o ? `away-${c.id}` : null)}
                viewer={v}
                actions={actions}
                onRun={(a) => run(a, v)}
              />
            </div>
          );
        })}
      </div>

      {pending?.kind === "ban" && (
        <ConfirmDialog
          title="Ban"
          text={`Ban ${pending.viewer.name} from this screen? They can't come back.`}
          confirm="Ban"
          onConfirm={() => s.ban(pending.viewer.id)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === "makeHost" && (
        <ConfirmDialog
          title="Make host"
          text={`Make ${pending.viewer.name} the host? You become co-host #1.`}
          confirm="Make host"
          onConfirm={() => s.transferHost(pending.viewer.id)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === "permissions" && <OverridesDialog session={s} viewerId={pending.viewer.id} onClose={() => setPending(null)} />}
    </>
  );
}

const LABELS: Record<string, string> = {
  mute: "Chat-mute",
  unmute: "Unmute chat",
  kick: "Kick",
  ban: "Ban…",
  permissions: "Permissions…",
  makeCoHost: "Make co-host",
  removeCoHost: "Remove co-host",
  moveUp: "Move up (takes over sooner)",
  moveDown: "Move down",
  makeHost: "Make host…",
};

function ViewerMenu(props: {
  open: boolean;
  onToggle: (open: boolean) => void;
  viewer: ViewerInfo;
  actions: ViewerAction[];
  onRun: (a: ViewerAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { open, onToggle } = props;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onToggle(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onToggle(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open, onToggle]);

  const plain = props.actions.filter((a) => a.kind !== "role");
  const roles = props.actions.filter((a): a is Extract<ViewerAction, { kind: "role" }> => a.kind === "role");
  const danger = new Set(["kick", "ban"]);
  return (
    <div className="viewer-menu" ref={ref}>
      <button
        className="btn small ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${props.viewer.name}`}
        onClick={() => onToggle(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu card" role="menu">
          {props.actions.length === 0 && <div className="menu-note">No actions available</div>}
          {plain.map((a) => (
            <button
              key={a.kind}
              role="menuitem"
              className={`menu-item ${danger.has(a.kind) ? "danger" : ""}`}
              onClick={() => props.onRun(a)}
            >
              {LABELS[a.kind]}
            </button>
          ))}
          {roles.length > 0 && (
            <>
              <div className="menu-head">Roles</div>
              {roles.map((a) => (
                <button
                  key={a.role.id}
                  role="menuitemcheckbox"
                  aria-checked={a.assigned}
                  className="menu-item"
                  onClick={() => props.onRun(a)}
                >
                  <span className="menu-check">{a.assigned ? "✓" : ""}</span>
                  <span className="role-dot" style={{ background: a.role.colour ?? "var(--muted)" }} aria-hidden="true" />
                  {a.role.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
