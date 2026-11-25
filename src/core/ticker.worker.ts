// Runs in a dedicated worker: posts a message every N ms (N is the first message received).
const scope = self as unknown as { onmessage: ((e: MessageEvent<number>) => void) | null; postMessage(m: unknown): void };
let timer: ReturnType<typeof setInterval> | null = null;
scope.onmessage = (e) => {
  if (timer !== null) clearInterval(timer);
  timer = setInterval(() => scope.postMessage(0), e.data);
};
