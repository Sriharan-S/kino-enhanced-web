// Screen settings (C-5.11) and closing the screen (C-5.13). Only changed fields are sent; every client follows `screen`.
import { useEffect, useRef, useState } from "react";
import { downloadDiagnostics } from "../core/diag";
import { Permissions, type ScreenInfo } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import { Dialog, describeError, useSubscribe } from "./common";

type Draft = {
  name: string;
  visibility: "public" | "private";
  password: string;
  hidden: boolean;
  maxViewers: number;
  showDevices: boolean;
  autoAdvance: boolean;
  bufferingPolicy: "keep" | "wait";
};

const fromScreen = (sc: ScreenInfo): Draft => ({
  name: sc.name,
  visibility: sc.visibility,
  password: "",
  hidden: !!sc.hidden,
  maxViewers: sc.maxViewers,
  showDevices: sc.showDevices,
  autoAdvance: sc.autoAdvance ?? true,
  bufferingPolicy: sc.bufferingPolicy ?? "keep",
});

/** The fields that differ from the screen, as `settings.update` wants them, or an error to show. */
export function settingsChanges(screen: ScreenInfo, d: Draft): { changes: Record<string, unknown> } | { error: string } {
  const name = d.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 64) return { error: "The screen needs a name (1 to 64 characters)." };
  if (!Number.isInteger(d.maxViewers) || d.maxViewers < 2 || d.maxViewers > 25) return { error: "Max viewers must be 2 to 25." };
  const goingPrivate = d.visibility === "private" && screen.visibility !== "private";
  if (goingPrivate && !d.password) return { error: "Set a password to make the screen private." };
  if (d.password.length > 128) return { error: "The password can be at most 128 characters." };
  const c: Record<string, unknown> = {};
  if (name !== screen.name) c.name = name;
  if (d.visibility !== screen.visibility) c.visibility = d.visibility;
  if (d.visibility === "private" && d.password) c.password = d.password;
  const hidden = d.visibility === "private" && d.hidden;
  if (hidden !== !!screen.hidden) c.hidden = hidden;
  if (d.maxViewers !== screen.maxViewers) c.maxViewers = d.maxViewers;
  if (d.showDevices !== screen.showDevices) c.showDevices = d.showDevices;
  if (d.autoAdvance !== (screen.autoAdvance ?? true)) c.autoAdvance = d.autoAdvance;
  if (d.bufferingPolicy !== (screen.bufferingPolicy ?? "keep")) c.bufferingPolicy = d.bufferingPolicy;
  return { changes: c };
}

export function SettingsDialog({ session: s, onClose }: { session: ScreenSession; onClose: () => void }) {
  useSubscribe(s.changed);
  const screen = s.screen!;
  const canEdit = s.can(Permissions.ScreenSettings);
  const [draft, setDraft] = useState<Draft>(() => fromScreen(screen));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const saving = useRef(0);

  // New settings arrived (ours after Save, or someone else's): follow them unless there are unsaved edits.
  const shown = useRef(screen);
  useEffect(() => {
    if (screen === shown.current) return;
    shown.current = screen;
    if (!dirty) setDraft(fromScreen(screen));
  }, [screen, dirty]);

  useEffect(
    () =>
      s.error.on((e) => {
        if (performance.now() - saving.current < 4000) setMessage({ text: describeError(e.code, e.message), bad: true });
      }),
    [s],
  );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
    setMessage(null);
  };

  const save = () => {
    const r = settingsChanges(screen, draft);
    if ("error" in r) {
      setMessage({ text: r.error, bad: true });
      return;
    }
    if (Object.keys(r.changes).length === 0) {
      setMessage({ text: "Nothing changed.", bad: false });
      return;
    }
    saving.current = performance.now();
    s.updateSettings(r.changes);
    setDirty(false);
    setDraft((d) => ({ ...d, password: "" }));
    setMessage({ text: "Saved.", bad: false });
  };

  const isOwner = !!s.self?.isHost; // the acting host can't close the screen (C-5.13.1)
  const ro = !canEdit;

  return (
    <Dialog title="Screen settings" onClose={onClose}>
      {ro && <p className="muted small">Only the host or someone with permission can change these.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canEdit) save();
        }}
      >
        <fieldset disabled={ro} className="plain">
          <label className="field">
            Name
            <input className="input" value={draft.name} maxLength={64} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.visibility === "private"}
              onChange={(e) => set("visibility", e.target.checked ? "private" : "public")}
            />
            Private (needs a password)
          </label>
          {draft.visibility === "private" && (
            <>
              <label className="field">
                {screen.visibility === "private" ? "New password (leave empty to keep the current one)" : "Password"}
                <input
                  className="input"
                  type="password"
                  value={draft.password}
                  maxLength={128}
                  onChange={(e) => set("password", e.target.value)}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.hidden} onChange={(e) => set("hidden", e.target.checked)} />
                Hide from the lobby (join by code or link only)
              </label>
            </>
          )}
          <label className="field">
            Max viewers (2 to 25; nobody already in is removed)
            <input
              className="input"
              type="number"
              min={2}
              max={25}
              value={draft.maxViewers}
              onChange={(e) => set("maxViewers", Math.round(Number(e.target.value)))}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.showDevices} onChange={(e) => set("showDevices", e.target.checked)} />
            Show everyone's device type
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.autoAdvance} onChange={(e) => set("autoAdvance", e.target.checked)} />
            Play the next item when one ends
          </label>
          <div className="field">
            When someone is buffering
            <label className="check">
              <input
                type="radio"
                name="buffering"
                checked={draft.bufferingPolicy === "keep"}
                onChange={() => set("bufferingPolicy", "keep")}
              />
              Keep playing (they catch up)
            </label>
            <label className="check">
              <input
                type="radio"
                name="buffering"
                checked={draft.bufferingPolicy === "wait"}
                onChange={() => set("bufferingPolicy", "wait")}
              />
              Wait for everyone
            </label>
          </div>
        </fieldset>
        {message && (
          <p className={`small ${message.bad ? "error-text" : "muted"}`} role="status">
            {message.text}
          </p>
        )}
        <div className="field">
          Diagnostics
          <span className="muted small">
            A log of what this device received, sent and did with the video, for reporting a sync problem. It stays on this device until you
            download it, and doesn't include file names.
          </span>
          <span>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadDiagnostics(`kino-diagnostics-${s.code}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`, [
                  `Kino web (${document.querySelector<HTMLScriptElement>("script[type=module]")?.src.split("/").pop() ?? "dev"}) · ${navigator.userAgent}`,
                  `screen ${s.code} · me ${s.self?.id.slice(0, 6)} (${s.isHost ? "host" : s.isTimelineAuthority ? "acting host" : "viewer"})`,
                  `clock offset ${s.clock.offset.toFixed(1)} ms · rtt ${s.clock.rttMs.toFixed(1)} ms · personal offset ${s.engine.personalOffsetMs} ms`,
                ])
              }
            >
              Download diagnostics
            </button>
          </span>
        </div>
        <div className="actions">
          {isOwner &&
            (confirmClose ? (
              <>
                <span className="small">Close the screen for everyone?</span>
                <button type="button" className="btn danger" onClick={s.closeScreen}>
                  Close it
                </button>
                <button type="button" className="btn" onClick={() => setConfirmClose(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmClose(true)}>
                Close screen…
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {canEdit && dirty ? "Cancel" : "Done"}
          </button>
          {canEdit && (
            <button className="btn primary" disabled={!dirty}>
              Save
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
