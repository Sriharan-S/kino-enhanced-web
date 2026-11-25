import { type ReactNode, useEffect, useReducer, useRef } from "react";

/** Re-renders whenever the emitter fires. */
export function useSubscribe(emitter: { on(cb: () => void): () => void }) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => emitter.on(bump), [emitter]);
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, button.primary")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Plain-language text for theatre error codes. */
export function describeError(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case "wrong_password":
      return "Wrong password.";
    case "full":
      return "This screen is full.";
    case "banned":
      return "You can't join this screen.";
    case "not_found":
      return "That screen doesn't exist (any more).";
    case "closed":
      return "The screen has closed.";
    case "kicked":
      return "You were removed from the screen.";
    case "replaced":
      return "You joined this screen from another tab or device.";
    case "update_required":
      return "This theatre needs a newer version of Kino. Reload the page.";
    case "rate_limited":
      return fallback || "Too many attempts. Try again in a minute.";
    case "forbidden":
      return fallback || "You don't have permission to do that.";
    default:
      return fallback;
  }
}

/** A yes/no question with a danger-styled confirm button. */
export function ConfirmDialog(props: { title: string; text: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog title={props.title} onClose={props.onCancel}>
      <p>{props.text}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary danger-fill"
          onClick={() => {
            props.onConfirm();
            props.onCancel();
          }}
        >
          {props.confirm}
        </button>
      </div>
    </Dialog>
  );
}
