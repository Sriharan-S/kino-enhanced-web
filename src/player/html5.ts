// The sync engine's view of an HTML5 <video>. Smooth correction uses playbackRate with pitch preserved.
import type { Playback } from "../core/sync";

export class Html5Playback implements Playback {
  /** Called when the browser blocks play() (autoplay policy) so the UI can ask for a click. */
  onPlayBlocked: (() => void) | null = null;
  private wantPlaying = false;

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
    this.wantPlaying = !paused;
    if (paused) {
      this.video.pause();
      return;
    }
    this.video.play().catch((e: unknown) => {
      if (this.wantPlaying && e instanceof DOMException && e.name === "NotAllowedError") this.onPlayBlocked?.();
    });
  }

  seek(seconds: number) {
    const d = this.mediaDuration;
    this.video.currentTime = d === null ? seconds : Math.min(seconds, d);
  }

  setSpeed(speed: number) {
    this.video.playbackRate = speed;
  }
}
