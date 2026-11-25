// The Chat tab (spec §18): messages, history, system messages, reactions, GIFs and pasted GIF links.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHAT_MAX_CHARS, cleanChatText, type GifResult, gifFromLink, isGifLink, REACTIONS, searchGiphy } from "../core/chat";
import { load, store } from "../core/net";
import { type ChatMessage, Permissions } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import { describeError, useSubscribe } from "./common";

const GIPHY_KEY = "kino.giphyKey";

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ session: s, active }: { session: ScreenSession; active: boolean }) {
  useSubscribe(s.changed);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastAction = useRef(0);

  const muted = !!s.self?.muted;
  const canSend = s.can(Permissions.ChatSend) && !muted;
  const canGif = s.can(Permissions.ChatGif) && !muted;
  const canReact = s.can(Permissions.ChatReact) && !muted;
  const blocked = muted ? "You are muted in this screen." : !s.can(Permissions.ChatSend) ? "You can't chat in this screen." : null;

  // Keep the newest message in view unless the viewer has scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    if (active && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [active]);

  // Rate limits and permission errors right after a chat action are shown here, where they can be read (C-18.7).
  useEffect(
    () =>
      s.error.on((e) => {
        if (performance.now() - lastAction.current > 3000) return;
        setNotice(e.code === "rate_limited" ? "Slow down a little." : describeError(e.code, e.message));
        setTimeout(() => setNotice(null), 4000);
      }),
    [s],
  );

  const send = () => {
    const text = cleanChatText(input);
    if (!text || !canSend) return;
    lastAction.current = performance.now();
    if (isGifLink(text) && canGif) s.sendGif(gifFromLink(text));
    else s.sendChat(text);
    setInput("");
    stick.current = true;
  };

  const react = (emoji: string) => {
    lastAction.current = performance.now();
    s.react(emoji);
  };

  return (
    <div className="chat">
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {s.chat.length === 0 && <p className="muted small">No messages yet. Say hello!</p>}
        {s.chat.map((m) => (
          <Message key={m.id} m={m} mine={m.from === s.self?.id} />
        ))}
      </div>

      <div className="reaction-bar" aria-label="Reactions">
        {REACTIONS.map((e) => (
          <button
            key={e}
            className="btn ghost small"
            disabled={!canReact}
            onClick={() => react(e)}
            title={canReact ? `React ${e}` : "You can't react here"}
          >
            {e}
          </button>
        ))}
      </div>

      {notice && <p className="error-text small chat-notice">{notice}</p>}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          className="input"
          rows={2}
          maxLength={CHAT_MAX_CHARS}
          value={input}
          disabled={!canSend}
          placeholder={blocked ?? "Message (Enter to send, Shift+Enter for a new line)"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Chat message"
        />
        <div className="row">
          <button
            type="button"
            className="btn small"
            disabled={!canGif}
            onClick={() => setPicker(true)}
            title={canGif ? "Send a GIF" : "You can't send GIFs here"}
          >
            GIF
          </button>
          <span className="muted small">{input.length > CHAT_MAX_CHARS - 100 ? `${CHAT_MAX_CHARS - input.length} left` : ""}</span>
          <span className="spacer" />
          <button className="btn small primary" disabled={!canSend || !cleanChatText(input)}>
            Send
          </button>
        </div>
      </form>

      {picker && (
        <GifPicker
          onClose={() => setPicker(false)}
          onPick={(r) => {
            setPicker(false);
            lastAction.current = performance.now();
            s.sendGif(r.gif);
            stick.current = true;
          }}
        />
      )}
    </div>
  );
}

function Message({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (m.kind === "system") {
    return (
      <div className="msg system">
        <span>{m.text}</span> <span className="time">{clock(m.at)}</span>
      </div>
    );
  }
  const gif = m.kind === "gif" && m.gif && isGifLink(m.gif.url) ? m.gif : null;
  const scale = gif?.width && gif.height ? Math.min(1, 220 / gif.width, 180 / gif.height) : 1;
  return (
    <div className={`msg ${mine ? "mine" : ""}`}>
      <div className="meta">
        <strong>{m.name}</strong> <span className="time">{clock(m.at)}</span>
      </div>
      {gif ? (
        <img
          className="gif"
          src={gif.url}
          alt={gif.title ?? "GIF"}
          title={gif.title ?? undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          width={gif.width ? Math.round(gif.width * scale) : undefined}
          height={gif.height ? Math.round(gif.height * scale) : undefined}
        />
      ) : (
        <div className="text">{m.kind === "gif" ? "(a GIF from a host Kino doesn't show)" : m.text}</div>
      )}
    </div>
  );
}

function GifPicker({ onPick, onClose }: { onPick: (r: GifResult) => void; onClose: () => void }) {
  const [key, setKey] = useState(() => load(GIPHY_KEY) ?? "");
  const [editingKey, setEditingKey] = useState(() => !load(GIPHY_KEY));
  const [draftKey, setDraftKey] = useState(key);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (q: string, signal: AbortSignal) => {
      setError(null);
      searchGiphy(key, q, signal).then(setResults, (e: unknown) => {
        if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    },
    [key],
  );

  useEffect(() => {
    if (!key || editingKey) return;
    const ctl = new AbortController();
    const t = setTimeout(() => run(query, ctl.signal), query ? 350 : 0);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [key, editingKey, query, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="gif-picker card" role="dialog" aria-label="Send a GIF">
      <div className="row">
        <strong>GIFs</strong>
        <span className="spacer" />
        {!editingKey && (
          <button className="btn small ghost" onClick={() => setEditingKey(true)}>
            API key
          </button>
        )}
        <button className="btn small ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {editingKey ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const k = draftKey.trim();
            if (!k) return;
            store(GIPHY_KEY, k);
            setKey(k);
            setEditingKey(false);
          }}
        >
          <p className="small muted">
            GIF search uses GIPHY with your own free API key (from{" "}
            <a href="https://developers.giphy.com/dashboard/" target="_blank" rel="noreferrer">
              developers.giphy.com
            </a>
            ). It is stored only in this browser. Pasting a GIPHY or Tenor GIF link into chat works without a key.
          </p>
          <input className="input" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="GIPHY API key" autoFocus />
          <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
            {key && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  store(GIPHY_KEY, null);
                  setKey("");
                  setDraftKey("");
                }}
              >
                Remove key
              </button>
            )}
            <button className="btn small primary" disabled={!draftKey.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIPHY (trending when empty)"
            autoFocus
          />
          {error && <p className="error-text small">{error}</p>}
          <div className="gif-grid">
            {results === null && !error && <p className="muted small">Loading…</p>}
            {results?.length === 0 && <p className="muted small">No GIFs found.</p>}
            {results?.map((r) => (
              <button key={r.gif.url} className="gif-cell" onClick={() => onPick(r)} title={r.gif.title ?? "GIF"}>
                <img src={r.previewUrl} alt={r.gif.title ?? "GIF"} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Powered by GIPHY
          </p>
        </>
      )}
    </div>
  );
}
