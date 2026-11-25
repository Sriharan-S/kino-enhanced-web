import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIRECTORY_JOIN, youTubeId, youTubeWatchUrl } from "../core/media";
import type { TheatreEntry } from "../core/net";
import { expectedAt, type Item, Permissions, type ServerError, type ViewerInfo } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import { MediaController } from "../player/controller";
import type { Html5Playback } from "../player/html5";
import { Dialog, describeError, formatTime, useSubscribe } from "./common";

interface Props {
  session: ScreenSession;
  theatre: TheatreEntry;
  playback: Html5Playback;
  onLeave: (reason?: string) => void;
}

const STATUS_TEXT: Record<string, string> = {
  sync: "in sync",
  catching: "catching up",
  buffering: "buffering",
  mismatch: "different file",
  waiting: "waiting",
  nofile: "no file",
};

export function ScreenView({ session: s, theatre, playback, onLeave }: Props) {
  const controller = useMemo(() => new MediaController(s, playback), [s, playback]);
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<"viewers" | "playlist">("viewers");
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useSubscribe(s.changed);

  useEffect(() => {
    controller.onChange = () => setVersion((v) => v + 1);
    return () => controller.dispose();
  }, [controller]);

  // Mount the shared <video> element.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.prepend(playback.video);
    return () => playback.video.remove();
  }, [playback]);

  const toast = useCallback((text: string) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    playback.onPlayBlocked = () => setBlocked(true);
    const offs = [
      s.closed.on((reason) => onLeave(reason)),
      s.error.on((e: ServerError) => toast(describeError(e.code, e.message))),
      s.reaction.on((r) => toast(`${r.name} ${r.emoji}`)),
    ];
    const onPlaying = () => setBlocked(false);
    playback.video.addEventListener("playing", onPlaying);
    return () => {
      offs.forEach((o) => o());
      playback.onPlayBlocked = null;
      playback.video.removeEventListener("playing", onPlaying);
    };
  }, [s, playback, onLeave, toast]);

  const canToggle = s.can(Permissions.PlaybackToggle);
  const canSeek = s.can(Permissions.PlaybackSeek);
  const canAdd = s.can(Permissions.PlaylistAdd);
  const canSkip = s.can(Permissions.PlaybackSkip);
  const item = s.currentItem;

  const togglePlay = useCallback(() => {
    if (!s.can(Permissions.PlaybackToggle) || !s.currentItem) return;
    if (s.engine.anchor?.state === "playing") s.pause();
    else s.play();
  }, [s]);

  // Repeated presses add up even before the theatre's new anchor arrives.
  const pendingSeek = useRef<{ target: number; seq: number; at: number } | null>(null);
  const seekBy = useCallback(
    (delta: number) => {
      const a = s.engine.anchor;
      if (!s.can(Permissions.PlaybackSeek) || !a) return;
      const now = performance.now();
      const p = pendingSeek.current;
      const base =
        p && p.seq === a.seq && now - p.at < 2000
          ? p.target + (a.state === "playing" ? (now - p.at) / 1000 : 0)
          : expectedAt(a, s.clock.theatreNowMs);
      const target = Math.max(0, base + delta);
      pendingSeek.current = { target, seq: a.seq, at: now };
      s.seek(target);
    },
    [s],
  );

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }, []);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "f") fullscreen();
      else if (e.key === "m") playback.video.muted = !playback.video.muted;
      else if (e.key === "ArrowLeft") seekBy(-5);
      else if (e.key === "ArrowRight") seekBy(5);
      else if (e.key === "j") seekBy(-10);
      else if (e.key === "l") seekBy(10);
      else return;
      setVersion((v) => v + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, fullscreen, playback]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    if (item?.kind === "local" && controller.currentNeedsFile && files.length === 1) void controller.pickFor(item.id, files[0]!);
    else void controller.offerFiles(files, canAdd, !item);
  };

  const pickFiles = (multiple: boolean, then: (files: File[]) => void) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = "video/*,audio/*,.mkv,.mov,.avi,.ts,.m2ts,.flac,.opus";
    input.onchange = () => then([...(input.files ?? [])]);
    input.click();
  };

  const startClick = () => {
    setBlocked(false);
    void playback.video.play().catch(() => setBlocked(true));
  };

  const hold = s.hold;
  const ready = s.ready;
  const self = s.self;
  const myReady = ready && self ? ready.answers[self.id] : undefined;

  return (
    <div className="screen">
      <div
        className="stage"
        ref={stageRef}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        <div className="topbar">
          <img src="/kino.png" alt="" width={22} height={22} />
          <div className="title" title={s.screen?.name}>
            {s.screen?.visibility === "private" && "🔒 "}
            {s.screen?.name}
          </div>
          <span className="badge mono" title="Screen code">
            {s.code}
          </span>
          <span className="muted small">{theatre.name}</span>
          {s.reconnecting && (
            <span className="badge" style={{ color: "var(--warn)" }}>
              Reconnecting…
            </span>
          )}
          <span className="spacer" />
          <button className="btn small" onClick={() => setInviteOpen(true)}>
            Invite
          </button>
          <button className="btn small danger" onClick={() => onLeave()}>
            Leave
          </button>
        </div>

        <div className="video-box" ref={boxRef} onDoubleClick={fullscreen} onClick={(e) => e.target === playback.video && togglePlay()}>
          {hold && hold.length > 0 && (
            <div className="banner">
              <span>⏸ Waiting for {hold.join(", ")}</span>
              {canToggle && (
                <button className="btn small" onClick={s.releaseHold}>
                  Resume anyway
                </button>
              )}
            </div>
          )}
          {ready && !ready.done && (
            <div className="banner" style={{ top: hold?.length ? 60 : 12 }}>
              <span>Ready check from {ready.by}</span>
              <button className={`btn small ${myReady === true ? "primary" : ""}`} onClick={() => s.answerReady(ready.id, true)}>
                Ready
              </button>
              <button className={`btn small ${myReady === false ? "primary" : ""}`} onClick={() => s.answerReady(ready.id, false)}>
                Not yet
              </button>
            </div>
          )}

          {!item ? (
            <div className="overlay">
              <div className="box">
                {canAdd ? (
                  <>
                    <h3>Pick something to watch</h3>
                    <p className="muted">
                      Open a video file from this device (or drop it here), or paste a link. Everyone plays their own copy.
                    </p>
                    <div className="row" style={{ justifyContent: "center" }}>
                      <button
                        className="btn primary"
                        onClick={() => pickFiles(true, (f) => void controller.offerFiles(f, true, f.length === 1))}
                      >
                        Open files…
                      </button>
                      <button className="btn" onClick={() => setLinkOpen(true)}>
                        Add a link…
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Waiting for the host</h3>
                    <p className="muted">Nothing is playing yet.</p>
                  </>
                )}
              </div>
            </div>
          ) : controller.error ? (
            <div className="overlay">
              <div className="box">
                <h3>Can't play here</h3>
                <p>{controller.error}</p>
                {item.kind === "local" && (
                  <button className="btn" onClick={() => pickFiles(false, (f) => f[0] && void controller.pickFor(item.id, f[0]))}>
                    Choose another copy…
                  </button>
                )}
              </div>
            </div>
          ) : controller.currentNeedsFile ? (
            <div className="overlay">
              <div className="box">
                <h3>Choose your copy</h3>
                <p>
                  <strong>{item.name}</strong>
                  {item.duration !== null && <span className="muted"> · {formatTime(item.duration)}</span>}
                </p>
                <p className="muted small">Kino never sends video. Pick your own copy of this file, or drop it here.</p>
                <button className="btn primary" onClick={() => pickFiles(false, (f) => f[0] && void controller.pickFor(item.id, f[0]))}>
                  Choose file…
                </button>
              </div>
            </div>
          ) : blocked ? (
            <div className="overlay" style={{ cursor: "pointer" }} onClick={startClick}>
              <div className="box">
                <h3>▶ Click to start</h3>
                <p className="muted">Your browser needs a click before it plays sound.</p>
              </div>
            </div>
          ) : null}

          {controller.notice && (
            <div className="banner" style={{ top: "auto", bottom: 12 }}>
              {controller.notice}
            </div>
          )}
          {s.fileMismatch && !controller.error && (
            <div className="banner" style={{ top: "auto", bottom: 12, borderColor: "var(--warn)" }}>
              ⚠ Your file's length differs from the host's; it may not line up.
            </div>
          )}
          {dragging && (
            <div className="overlay drop">
              <h3>Drop to {controller.currentNeedsFile ? "use as your copy" : canAdd ? "add to the playlist" : "match files"}</h3>
            </div>
          )}
          <div className="toast-stack">
            {toasts.map((t) => (
              <div key={t.id} className="toast">
                {t.text}
              </div>
            ))}
          </div>
        </div>

        <Controls
          session={s}
          playback={playback}
          canToggle={canToggle && !!item}
          canSeek={canSeek && !!item}
          canSkip={canSkip}
          onToggle={togglePlay}
          onFullscreen={fullscreen}
        />
      </div>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button className={tab === "viewers" ? "active" : ""} onClick={() => setTab("viewers")}>
            Viewers ({s.viewers.filter((v) => v.connected !== false).length})
          </button>
          <button className={tab === "playlist" ? "active" : ""} onClick={() => setTab("playlist")}>
            Playlist ({s.playlist.length})
          </button>
        </div>
        <div className="side-body">
          {tab === "viewers" ? (
            <Viewers session={s} />
          ) : (
            <Playlist
              session={s}
              controller={controller}
              onAddFiles={() => pickFiles(true, (f) => void controller.offerFiles(f, true))}
              onAddLink={() => setLinkOpen(true)}
              onPickFor={(it) => pickFiles(false, (f) => f[0] && void controller.pickFor(it.id, f[0]))}
            />
          )}
        </div>
      </aside>

      {inviteOpen && <InviteDialog session={s} theatre={theatre} onClose={() => setInviteOpen(false)} />}
      {linkOpen && (
        <LinkDialog
          canExternal={s.can(Permissions.PlaylistAddExternal)}
          onClose={() => setLinkOpen(false)}
          onAdd={(it) => {
            setLinkOpen(false);
            if (s.currentItem) s.addToPlaylist([it]);
            else s.load(it);
          }}
        />
      )}
    </div>
  );
}

function Controls(props: {
  session: ScreenSession;
  playback: Html5Playback;
  canToggle: boolean;
  canSeek: boolean;
  canSkip: boolean;
  onToggle: () => void;
  onFullscreen: () => void;
}) {
  const { session: s, playback, canToggle, canSeek, canSkip } = props;
  useSubscribe(s.ticked);
  const [scrub, setScrub] = useState<number | null>(null);
  const v = playback.video;
  const duration = playback.mediaDuration ?? s.currentItem?.duration ?? null;
  const anchor = s.engine.anchor;
  const playing = anchor?.state === "playing";
  const pos = playback.position ?? (anchor ? expectedAt(anchor, s.clock.theatreNowMs) : 0);
  const st = s.engine.status;
  const driftMs = Math.round(st.drift * 1000);

  return (
    <div className="controls">
      <input
        className="seek"
        type="range"
        min={0}
        max={duration ?? 0}
        step={0.1}
        value={scrub ?? pos}
        disabled={!canSeek || !duration}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub !== null) s.seek(scrub);
          setScrub(null);
        }}
        onKeyUp={() => {
          if (scrub !== null) s.seek(scrub);
          setScrub(null);
        }}
        aria-label="Seek"
      />
      <div className="bar">
        <button className="btn icon ghost" disabled={!canSkip} onClick={() => s.skip(false)} title="Previous">
          ⏮
        </button>
        <button className="btn icon" disabled={!canToggle} onClick={props.onToggle} title={playing ? "Pause (space)" : "Play (space)"}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="btn icon ghost" disabled={!canSkip} onClick={() => s.skip(true)} title="Next">
          ⏭
        </button>
        <span className="time">
          {formatTime(scrub ?? pos)} / {formatTime(duration)}
        </span>
        <span className="spacer" />
        <span className="sync-readout" title="Sync status: drift from the shared timeline and current speed">
          {zoneText(st.zone)}
          {["inSync", "correcting", "host", "settling"].includes(st.zone) ? ` · ${driftMs >= 0 ? "+" : ""}${driftMs} ms` : ""}
          {st.rate !== 1 ? ` · ${(st.rate * 100).toFixed(1)}%` : ""}
        </span>
        <button className="btn icon ghost" onClick={() => (v.muted = !v.muted)} title="Mute (m)">
          {v.muted || v.volume === 0 ? "🔇" : "🔊"}
        </button>
        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={v.muted ? 0 : v.volume}
          onChange={(e) => {
            v.volume = Number(e.target.value);
            v.muted = v.volume === 0;
          }}
          aria-label="Volume"
        />
        <button className="btn icon ghost" onClick={props.onFullscreen} title="Fullscreen (f)">
          ⛶
        </button>
      </div>
    </div>
  );
}

function zoneText(zone: string) {
  switch (zone) {
    case "inSync":
      return "● In sync";
    case "correcting":
      return "◐ Catching up";
    case "seeking":
      return "↷ Jumping";
    case "buffering":
      return "… Buffering";
    case "host":
      return "● Leading";
    case "paused":
      return "Paused";
    case "starting":
      return "Starting…";
    case "settling":
      return "Settling";
    case "waiting":
      return "Waiting for others";
    case "noFile":
      return "No file";
    default:
      return "";
  }
}

function Viewers({ session: s }: { session: ScreenSession }) {
  const sorted = [...s.viewers].sort(
    (a, b) => Number(b.isHost) - Number(a.isHost) || (a.coHost ?? 99) - (b.coHost ?? 99) || a.name.localeCompare(b.name),
  );
  const roleName = (id: string) => s.roles.find((r) => r.id === id);
  return (
    <div className="list">
      {sorted.map((v: ViewerInfo) => (
        <div key={v.id} className="list-item" style={{ opacity: v.connected === false ? 0.5 : 1 }}>
          <div style={{ minWidth: 0 }}>
            <div className="name">
              {v.name}
              {v.id === s.self?.id && <span className="badge">you</span>}
              {v.isHost && <span className="badge host">host</span>}
              {v.actingHost && <span className="badge host">acting host</span>}
              {v.coHost != null && <span className="badge">co-host {v.coHost}</span>}
              {v.muted && <span className="badge">muted</span>}
              {(v.roles ?? []).map((id) => {
                const r = roleName(id);
                return r ? (
                  <span key={id} className="badge" style={r.colour ? { color: r.colour, borderColor: r.colour } : undefined}>
                    {r.name}
                  </span>
                ) : null;
              })}
            </div>
            <div className="small muted">
              {v.connected === false ? (
                "reconnecting…"
              ) : (
                <span className={`st-${v.status ?? "sync"}`}>{STATUS_TEXT[v.status ?? "sync"]}</span>
              )}
              {s.screen?.showDevices && v.device ? ` · ${v.device}` : ""}
              {v.rtt != null ? ` · ${Math.round(v.rtt)} ms` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Playlist({
  session: s,
  controller,
  onAddFiles,
  onAddLink,
  onPickFor,
}: {
  session: ScreenSession;
  controller: MediaController;
  onAddFiles: () => void;
  onAddLink: () => void;
  onPickFor: (item: Item) => void;
}) {
  const canAdd = s.can(Permissions.PlaylistAdd);
  const canRemove = s.can(Permissions.PlaylistRemove);
  const canPlay = s.can(Permissions.PlaybackSkip);
  const canReorder = s.can(Permissions.PlaylistReorder);
  return (
    <>
      <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <button className="btn small" disabled={!canAdd} onClick={onAddFiles}>
          ＋ Files
        </button>
        <button className="btn small" disabled={!canAdd} onClick={onAddLink}>
          ＋ Link
        </button>
        <span className="spacer" />
        {s.can(Permissions.ScreenSettings) && (
          <label className="check small" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={s.screen?.autoAdvance ?? true}
              onChange={(e) => s.updateSettings({ autoAdvance: e.target.checked })}
            />
            Auto-advance
          </label>
        )}
      </div>
      {s.playlist.length === 0 ? (
        <p className="muted small">The playlist is empty.</p>
      ) : (
        <div className="list">
          {s.playlist.map((it, i) => {
            const m = it.kind === "local" ? controller.matchFor(it) : null;
            const current = s.currentItem?.id === it.id;
            return (
              <div key={it.id} className={`list-item ${current ? "current" : ""}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="name" title={it.name}>
                    {current && "▶ "}
                    {it.kind === "youtube" ? "▷ " : it.kind === "url" ? "🔗 " : ""}
                    {it.name}
                  </div>
                  <div className="small muted">
                    {formatTime(it.duration)}
                    {it.kind === "local" &&
                      (m ? (
                        <span className={m.kind === "mismatch" ? "st-mismatch" : "st-sync"}>
                          {" · "}
                          {m.kind === "match"
                            ? "your copy ✓"
                            : m.kind === "likelyMatch"
                              ? `matched: ${m.file.name}`
                              : `length differs: ${m.file.name}`}
                        </span>
                      ) : (
                        <span className="st-nofile"> · no file</span>
                      ))}
                  </div>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  {it.kind === "local" && (
                    <button className="btn small ghost" title="Choose your copy" onClick={() => onPickFor(it)}>
                      📁
                    </button>
                  )}
                  {canReorder && i > 0 && (
                    <button className="btn small ghost" title="Move up" onClick={() => s.moveItem(it.id, i - 1)}>
                      ↑
                    </button>
                  )}
                  {canPlay && !current && (
                    <button className="btn small ghost" title="Play now" onClick={() => s.playItem(it.id)}>
                      ▶
                    </button>
                  )}
                  {canRemove && (
                    <button className="btn small ghost" title="Remove" onClick={() => s.removeItem(it.id)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 14 }}>
        Local files are matched to your own copies by length, then name. Only names and lengths are shared.
      </p>
    </>
  );
}

function InviteDialog({ session: s, theatre, onClose }: { session: ScreenSession; theatre: TheatreEntry; onClose: () => void }) {
  const link = `${location.origin}/#${theatre.id}/${s.code}`;
  const appLink = `${DIRECTORY_JOIN}#${theatre.id}/${s.code}`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null),
    );
  return (
    <Dialog title="Invite people" onClose={onClose}>
      <p className="muted small">Screen code</p>
      <p className="mono" style={{ fontSize: "2rem", letterSpacing: "0.14em", margin: "0 0 8px" }}>
        {s.code}
      </p>
      <label className="field">
        Watch in the browser
        <div className="row">
          <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => copy(link)}>
            {copied === link ? "Copied" : "Copy"}
          </button>
        </div>
      </label>
      <label className="field">
        Open in the Kino app
        <div className="row">
          <input className="input" readOnly value={appLink} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => copy(appLink)}>
            {copied === appLink ? "Copied" : "Copy"}
          </button>
        </div>
      </label>
      {s.screen?.visibility === "private" && <p className="muted small">This screen is private: people also need its password.</p>}
      <div className="actions">
        {s.can(Permissions.ScreenInvite) && (
          <button className="btn" onClick={s.regenerateCode} title="Old links stop working">
            New code
          </button>
        )}
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function LinkDialog({
  canExternal,
  onAdd,
  onClose,
}: {
  canExternal: boolean;
  onAdd: (item: { kind: "url" | "youtube"; name: string; duration: null; url: string }) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const yt = youTubeId(url);
  const direct = /^https?:\/\/\S+$/i.test(url.trim());
  const ok = canExternal && (yt !== null || direct);
  return (
    <Dialog title="Add a link" onClose={onClose}>
      <p className="muted small">A direct video link (MP4, WebM…) or a YouTube video. Everyone streams it from the source.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          if (yt) onAdd({ kind: "youtube", name: `YouTube ${yt}`, duration: null, url: youTubeWatchUrl(yt) });
          else {
            const u = new URL(url.trim());
            const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname);
            onAdd({ kind: "url", name: name.slice(0, 200) || u.hostname, duration: null, url: u.toString() });
          }
        }}
      >
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        {!canExternal && <p className="error-text small">You don't have permission to add links in this screen.</p>}
        {yt && <p className="muted small">YouTube plays in Kino for Windows; web support is coming.</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok}>
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
