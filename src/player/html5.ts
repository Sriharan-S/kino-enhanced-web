// The sync engine's view of an HTML5 <video>. Smooth correction uses playbackRate with pitch preserved.
import { diag } from "../core/diag";
import type { Playback } from "../core/sync";

export class Html5Playback implements Playback {
  /** Called when the browser blocks play() (autoplay policy) so the UI can ask for a click. */
  onPlayBlocked: (() => void) | null = null;
  private wantPlaying = false;
  private loggedSpeed = 1;

  constructor(readonly video: HTMLVideoElement) {
    video.preservesPitch = true;
  }

  get hasMedia() {
    return !!this.video.currentSrc && this.video.readyState >= HTMLMediaElement.HAVE_METADATA;
  }

  get position() {
    return this.hasMedia ? this.video.currentTime : null;
  }

  get mediaDuration() {
    const d = this.video.duration;
    return this.hasMedia && Number.isFinite(d) && d > 0 ? d : null;
  }

  get isPaused() {
    return this.video.paused;
  }

  /** Seeking, or playing without enough data to continue. */
  get isBuffering() {
    return this.hasMedia && (this.video.seeking || (!this.video.paused && this.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA));
  }

  setPaused(paused: boolean) {
    diag.add("player", `${paused ? "pause" : "play"} at ${this.video.currentTime.toFixed(3)}`);
    this.wantPlaying = !paused;
    if (paused) {
      this.video.pause();
      return;
    }
    this.video.play().catch((e: unknown) => {
      diag.add("player", `play() refused: ${e instanceof DOMException ? e.name : String(e)}`);
      if (this.wantPlaying && e instanceof DOMException && e.name === "NotAllowedError") this.onPlayBlocked?.();
    });
  }

  seek(seconds: number) {
    const d = this.mediaDuration;
    const to = d === null ? seconds : Math.min(seconds, d);
    diag.add("player", `seek ${this.video.currentTime.toFixed(3)} → ${to.toFixed(3)}`);
    this.video.currentTime = to;
  }

  setSpeed(speed: number) {
    // Rate correction changes the speed a little on most ticks: log the bigger steps only.
    if (Math.abs(speed - this.loggedSpeed) >= 0.005 || (speed === 1 && this.loggedSpeed !== 1)) {
      diag.add("player", `speed ${speed.toFixed(4)}`);
      this.loggedSpeed = speed;
    }
    this.video.playbackRate = speed;
  }
}
