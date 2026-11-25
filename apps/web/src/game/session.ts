import init, { Sim } from "../wasm/ez_wasm.js";
import { decodeWorld, World, TICKS_PER_SEC } from "./world";

let wasmReady: Promise<unknown> | null = null;
export function loadWasm() {
  if (!wasmReady) wasmReady = init();
  return wasmReady;
}

export interface ChainStats {
  txSent: number;
  txOk: number;
  txFail: number;
  lastLatency: number;
  avgLatency: number;
  vrfRequests: number;
  vrfFulfilled: number;
  ticksSeen: number;
  endpoint: string;
  room: string;
  lastSig: string;
  crank: string;
}

export interface Snapshot {
  world: World;
  bytes: Uint8Array;
  at: number;
}

/** Common interface for local practice and on-chain sessions. */
export interface GameSession {
  readonly mode: "practice" | "online";
  readonly me: number;
  /** Replays play back recorded snapshots: no prediction, no input. */
  readonly replay?: boolean;
  latest: Snapshot | null;
  stats: ChainStats | null;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  move(x: number, y: number, aim: number, moving: boolean): void;
  combat(kind: 0 | 1 | 2 | 3, aim: number): void;
  interact(): void;
  /** Collision-aware slide for prediction, using current walls. */
  slide(x: number, y: number, dx: number, dy: number): [number, number];
  destroy(): void;
}

function randomBytes(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * Practice: the exact on-chain rules run locally in WASM against rival bots.
 * Chest loot uses browser randomness here; online, it comes from MagicBlock VRF.
 */
export class PracticeSession implements GameSession {
  readonly mode = "practice" as const;
  readonly me = 0;
  latest: Snapshot | null = null;
  stats = null;
  private sim: Sim;
  private subs = new Set<(s: Snapshot) => void>();
  private timer: number;
  private paused = false;

  private constructor(sim: Sim) {
    this.sim = sim;
    this.publish();
    this.timer = window.setInterval(() => this.step(), 1000 / TICKS_PER_SEC);
  }

  static async create(cls: number, name: string, bots: number, quick: boolean) {
    await loadWasm();
    const sim = Sim.practice(randomBytes(32), cls, name || "Adventurer", bots, quick);
    return new PracticeSession(sim);
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  private step() {
    if (this.paused) return;
    const opened = this.sim.tick();
    for (const c of opened) this.rollChest(c);
    this.publish();
  }

  private rollChest(c: number) {
    // Mimic oracle latency so chest opening feels the same as online.
    setTimeout(() => {
      this.sim.resolve_chest(c, randomBytes(32));
      this.publish();
    }, 450 + Math.random() * 350);
  }

  private publish() {
    const bytes = this.sim.bytes();
    const snap = { world: decodeWorld(bytes), bytes, at: performance.now() };
    this.latest = snap;
    this.subs.forEach((cb) => cb(snap));
  }

  onSnapshot(cb: (s: Snapshot) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  move(x: number, y: number, aim: number, moving: boolean) {
    this.sim.act_move(0, Math.round(x), Math.round(y), aim, moving ? 1 : 0);
  }
  combat(kind: 0 | 1 | 2 | 3, aim: number) {
    this.sim.act_combat(0, kind, aim);
  }
  interact() {
    const c = this.sim.interact(0);
    if (c >= 0) this.rollChest(c);
  }
  slide(x: number, y: number, dx: number, dy: number): [number, number] {
    const r = this.sim.slide(Math.round(x), Math.round(y), Math.round(dx), Math.round(dy));
    return [r[0], r[1]];
  }
  destroy() {
    clearInterval(this.timer);
    this.subs.clear();
    this.sim.free();
  }
}
