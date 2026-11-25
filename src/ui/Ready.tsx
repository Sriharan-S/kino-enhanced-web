// Ready check (C-11.19): the prompt, a live "n of m ready" tally, the countdown, and the result for 5 s.
import { useEffect, useRef, useState } from "react";
import type { ReadyCheck } from "../core/protocol";
import type { ScreenSession } from "../core/session";
import { useSubscribe } from "./common";

const RESULT_MS = 5000;

/** n of m: ready answers among the viewers who are connected now (a viewer who left no longer counts). */
export function readyTally(r: ReadyCheck, connectedIds: string[]) {
  const n = connectedIds.filter((id) => r.answers[id] === true).length;
  return { n, m: connectedIds.length, everyone: connectedIds.length > 0 && n === connectedIds.length };
}

export function ReadyBanner({ session: s, top }: { session: ScreenSession; top: number }) {
  useSubscribe(s.ticked); // countdown
  useSubscribe(s.changed);
  const r = s.ready;
  const [result, setResult] = useState<{ id: number; text: string } | null>(null);
  // A check that finished before this view opened (e.g. in the welcome) isn't announced again.
  const seen = useRef<number | null>(s.ready?.done ? s.ready.id : null);

  const connected = s.viewers.filter((v) => v.connected !== false).map((v) => v.id);

  // When a check finishes, show its result for 5 s (the theatre also posts it to chat).
  useEffect(() => {
    if (!r || !r.done || seen.current === r.id) return;
    seen.current = r.id;
    const t = readyTally(
      r,
      s.viewers.filter((v) => v.connected !== false).map((v) => v.id),
    );
    setResult({ id: r.id, text: t.everyone ? "Everyone is ready" : `Ready check: ${t.n} of ${t.m} ready` });
  }, [r, s]);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  if (r && !r.done) {
    const mine = s.self ? r.answers[s.self.id] : undefined;
    const t = readyTally(r, connected);
    const left = Math.max(0, Math.ceil((r.deadline - s.clock.theatreNowMs) / 1000));
    return (
      <div className="banner" style={{ top }} role="status">
        <span>
          <strong>{r.by}</strong> asks: ready?{" "}
          <span className="muted">
            {t.n} of {t.m} ready · {left} s
          </span>
        </span>
        <button
          className={`btn small ${mine === true ? "primary" : ""}`}
          aria-pressed={mine === true}
          onClick={() => s.answerReady(r.id, true)}
        >
          Ready
        </button>
        <button
          className={`btn small ${mine === false ? "primary" : ""}`}
          aria-pressed={mine === false}
          onClick={() => s.answerReady(r.id, false)}
        >
          Not yet
        </button>
      </div>
    );
  }
  if (result) {
    return (
      <div className="banner" style={{ top }} role="status">
        {result.text}
      </div>
    );
  }
  return null;
}
