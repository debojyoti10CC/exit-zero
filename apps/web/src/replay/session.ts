import { decodeWorld, TICKS_PER_SEC } from "../game/world";
import type { GameSession, Snapshot } from "../game/session";
import type { Frame } from "./loader";

/** Plays verified replay frames through the normal game renderer. */
export class ReplaySession implements GameSession {
  readonly mode = "online" as const;
  readonly replay = true;
  me: number;
  latest: Snapshot | null = null;
  stats = null;
  idx = 0;
  playing = true;
  speed = 1;
  private subs = new Set<(s: Snapshot) => void>();
  private ui = new Set<() => void>();
  private timer = 0;
  private acc = 0;
  private last = performance.now();

  constructor(readonly frames: Frame[], me: number) {
    this.me = me;
    this.publish();
  }

  /** Starts the playback clock (idempotent; the view owns start/stop). */
  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.step(), 1000 / TICKS_PER_SEC / 2);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private step() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.playing) return;
    this.acc += (dt * this.speed * TICKS_PER_SEC) / 1000;
    let moved = false;
    while (this.acc >= 1 && this.idx < this.frames.length - 1) {
      this.acc -= 1;
      this.idx++;
      moved = true;
    }
    if (this.idx >= this.frames.length - 1) this.playing = false;
    if (moved) this.publish();
    this.ui.forEach((f) => f());
  }

  publish() {
    const f = this.frames[this.idx];
    const s: Snapshot = { world: decodeWorld(f.bytes), bytes: f.bytes, at: performance.now() };
    this.latest = s;
    this.subs.forEach((cb) => cb(s));
  }

  seek(i: number) {
    this.idx = Math.max(0, Math.min(this.frames.length - 1, Math.round(i)));
    this.acc = 0;
    this.publish();
    this.ui.forEach((f) => f());
  }

  toggle() {
    if (!this.playing && this.idx >= this.frames.length - 1) this.seek(0);
    this.playing = !this.playing;
    this.ui.forEach((f) => f());
  }

  setSpeed(s: number) {
    this.speed = s;
    this.ui.forEach((f) => f());
  }

  follow(p: number) {
    this.me = p;
    this.publish();
    this.ui.forEach((f) => f());
  }

  onUi(cb: () => void) {
    this.ui.add(cb);
    return () => {
      this.ui.delete(cb);
    };
  }

  onSnapshot(cb: (s: Snapshot) => void) {
    this.subs.add(cb);
    if (this.latest) cb(this.latest);
    return () => {
      this.subs.delete(cb);
    };
  }

  move() {}
  combat() {}
  interact() {}
  slide(x: number, y: number): [number, number] {
    return [x, y];
  }
  destroy() {
    // The renderer calls this when it unmounts; the view decides when playback stops.
  }
}
