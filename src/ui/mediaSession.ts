// Hardware media keys and the OS media overlay go through the screen (C-12.10), never straight to the <video>:
// with handlers registered, the browser no longer plays or pauses the element itself, so the engine isn't fought.
import { expectedAt, Permissions } from "../core/protocol";
import type { ScreenSession } from "../core/session";

type Handler = (details: MediaSessionActionDetails) => void;

export function bindMediaSession(s: ScreenSession, screenName: () => string): () => void {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return () => {};

  const position = () => (s.engine.anchor ? expectedAt(s.engine.anchor, s.clock.theatreNowMs) : 0);
  const handlers: [MediaSessionAction, Handler][] = [
    ["play", () => s.can(Permissions.PlaybackToggle) && s.currentItem && s.play()],
    ["pause", () => s.can(Permissions.PlaybackToggle) && s.currentItem && s.pause()],
    ["stop", () => s.can(Permissions.PlaybackToggle) && s.currentItem && s.pause()],
    ["nexttrack", () => s.can(Permissions.PlaybackSkip) && s.skip(true)],
    ["previoustrack", () => s.can(Permissions.PlaybackSkip) && s.skip(false)],
    ["seekforward", (d) => s.can(Permissions.PlaybackSeek) && s.seek(position() + (d.seekOffset ?? 10))],
    ["seekbackward", (d) => s.can(Permissions.PlaybackSeek) && s.seek(position() - (d.seekOffset ?? 10))],
    ["seekto", (d) => s.can(Permissions.PlaybackSeek) && d.seekTime !== undefined && s.seek(d.seekTime)],
  ];
  for (const [action, h] of handlers) {
    try {
      ms.setActionHandler(action, h);
    } catch {
      // action not supported by this browser
    }
  }

  let shownItem: string | null | undefined;
  const update = () => {
    const item = s.currentItem;
    if (item?.id !== shownItem) {
      shownItem = item?.id ?? null;
      ms.metadata = item
        ? new MediaMetadata({ title: item.name, artist: screenName(), album: "Kino", artwork: [{ src: "/kino.png" }] })
        : null;
    }
    ms.playbackState = !item ? "none" : s.engine.anchor?.state === "playing" ? "playing" : "paused";
  };
  update();
  const offs = [s.changed.on(update), s.itemChanged.on(update), s.ticked.on(update)];

  return () => {
    offs.forEach((o) => o());
    for (const [action] of handlers) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
    ms.metadata = null;
    ms.playbackState = "none";
  };
}
