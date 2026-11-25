// A steady tick for the sync engine. Browsers throttle main-thread timers in background tabs (to once a second, and
// to once a minute for silent tabs after a few minutes), which would stop the engine. A dedicated worker's timer
// keeps running, so the engine is driven from there when workers are available (C-11.23, WEB-11.P1).

export function startTicker(intervalMs: number, onTick: () => void): () => void {
  if (typeof Worker !== "undefined" && typeof document !== "undefined") {
    try {
      const worker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = () => onTick();
      worker.postMessage(intervalMs);
      return () => worker.terminate();
    } catch {
      // workers blocked: fall back to a normal timer
    }
  }
  const id = setInterval(onTick, intervalMs);
  return () => clearInterval(id);
}

/** A gap this long between ticks means the device slept or the tab was frozen: re-sync the clock fully. */
export const GAP_MS = 3000;

/** The time step the engine should use: real elapsed time, but never more than a second (keeps rate slew smooth). */
export const engineStep = (elapsedMs: number) => Math.min(Math.max(elapsedMs, 0), 1000) / 1000;
