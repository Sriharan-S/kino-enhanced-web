// Diagnostics log: what this client received, sent and did to the player, with timestamps, kept in memory only.
// "Download diagnostics" (screen settings) saves it as a text file so a sync problem can be traced afterwards.
// Nothing is uploaded; local file names never appear (items are referred to by id).

export const DIAG_MAX = 3000;

export interface DiagEntry {
  /** performance.now() in ms. */
  t: number;
  kind: string;
  text: string;
}

class DiagLog {
  private entries: DiagEntry[] = [];
  private readonly started = Date.now() - performance.now();

  add(kind: string, text: string) {
    this.entries.push({ t: performance.now(), kind, text });
    if (this.entries.length > DIAG_MAX) this.entries.splice(0, this.entries.length - DIAG_MAX);
  }

  get size() {
    return this.entries.length;
  }

  clear() {
    this.entries = [];
  }

  /** One line per entry: wall clock, seconds since the page opened, kind, text. */
  text(header: string[] = []): string {
    const lines = header.map((h) => `# ${h}`);
    for (const e of this.entries) {
      const wall = new Date(this.started + e.t).toISOString().slice(11, 23);
      lines.push(`${wall} ${(e.t / 1000).toFixed(3).padStart(9)} ${e.kind.padEnd(7)} ${e.text}`);
    }
    return lines.join("\n") + "\n";
  }
}

export const diag = new DiagLog();

/** Compact JSON for a log line. */
export function short(v: unknown, max = 300): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Logs a <video>'s own events (seeks, stalls, reloads, pauses) with its position and state. */
export function watchVideo(v: HTMLVideoElement): () => void {
  const events = [
    "loadstart",
    "emptied",
    "loadedmetadata",
    "canplay",
    "play",
    "playing",
    "pause",
    "seeking",
    "seeked",
    "waiting",
    "stalled",
    "ended",
    "error",
  ];
  const on = (e: Event) =>
    diag.add(
      "video",
      `${e.type} t=${v.currentTime.toFixed(3)} paused=${v.paused} rs=${v.readyState} ns=${v.networkState}` +
        (e.type === "error" ? ` code=${v.error?.code ?? "?"}` : ""),
    );
  for (const e of events) v.addEventListener(e, on);
  const vis = () => diag.add("page", `visibility ${document.visibilityState}`);
  document.addEventListener("visibilitychange", vis);
  return () => {
    for (const e of events) v.removeEventListener(e, on);
    document.removeEventListener("visibilitychange", vis);
  };
}

/** Saves the log as a text file. */
export function downloadDiagnostics(name: string, header: string[]) {
  const blob = new Blob([diag.text(header)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
