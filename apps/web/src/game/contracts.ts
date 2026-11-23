// Three random contracts per run: short goals that give every descent a reason
// to take one more risk. Tracked from the world state and event log on the client.

import { CHEST, EV, ITEM, PS, World, GameEvent, TICKS_PER_SEC } from "./world";

export interface ContractDef {
  id: string;
  title: string;
  xp: number;
  target: number;
  /** Progress value from the current state (monotonic counters come from `counts`). */
  progress: (w: World, me: number, c: Counts) => number;
  /** Only counts once you are out alive. */
  needsExtract?: boolean;
}

export interface Counts {
  chests: number;
  epics: number;
  door: number;
  potions: number;
  streak: number;
  bestStreak: number;
  elites: number;
}

export interface ContractResult {
  id: string;
  title: string;
  xp: number;
  value: number;
  target: number;
  done: boolean;
  needsExtract?: boolean;
}

const POOL: ContractDef[] = [
  { id: "bank500", title: "Cross over with 500+ souls", xp: 90, target: 500, needsExtract: true, progress: (w, me) => (w.players[me].state === PS.EXTRACTED ? w.players[me].banked : lootValue(w, me)) },
  { id: "bank1200", title: "Cross over with 1200+ souls", xp: 180, target: 1200, needsExtract: true, progress: (w, me) => (w.players[me].state === PS.EXTRACTED ? w.players[me].banked : lootValue(w, me)) },
  { id: "kills8", title: "Purify 8 Hollows", xp: 60, target: 8, progress: (w, me) => w.players[me].kills },
  { id: "kills15", title: "Purify 15 Hollows", xp: 110, target: 15, progress: (w, me) => w.players[me].kills },
  { id: "chests4", title: "Open 4 chests", xp: 70, target: 4, progress: (_w, _me, c) => c.chests },
  { id: "epic", title: "Find an Epic or better", xp: 100, target: 1, progress: (_w, _me, c) => c.epics },
  { id: "vault", title: "Break the gate seal", xp: 120, target: 1, progress: (_w, _me, c) => c.door },
  { id: "king", title: "Wound the Hollow King", xp: 90, target: 1, progress: (w, me) => (w.bossDmg[me] > 0 ? 1 : 0) },
  { id: "betray", title: "Betray a rival", xp: 110, target: 1, progress: (w, me) => w.players[me].pvpKills },
  { id: "streak3", title: "Kill 3 in a streak", xp: 70, target: 3, progress: (_w, _me, c) => c.bestStreak },
  { id: "early", title: "Cross within 60s of the gates", xp: 80, target: 1, needsExtract: true, progress: () => 0 },
  { id: "dry", title: "Cross over without a draught", xp: 90, target: 1, needsExtract: true, progress: (w, me, c) => (w.players[me].state === PS.EXTRACTED && c.potions === 0 ? 1 : 0) },
];

function lootValue(w: World, me: number) {
  const base = [0, 20, 45, 60, 90, 140, 70, 70, 0, 0, 160];
  const mult = [10, 15, 30, 60, 120];
  return w.players[me].inv.reduce((s, i) => s + (i.kind ? Math.floor((base[i.kind] * mult[Math.min(4, i.rarity)]) / 10) : 0), 0);
}

export class ContractTracker {
  defs: ContractDef[];
  counts: Counts = { chests: 0, epics: 0, door: 0, potions: 0, streak: 0, bestStreak: 0, elites: 0 };
  lastKillAt = 0;
  earlyEscape = false;
  completed = new Set<string>();

  constructor(seed: number) {
    // Deterministic pick per run seed, never two of the same family.
    const pool = POOL.slice();
    const out: ContractDef[] = [];
    let s = seed >>> 0 || 1;
    const families = new Set<string>();
    while (out.length < 3 && pool.length) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const i = s % pool.length;
      const c = pool.splice(i, 1)[0];
      const fam = c.id.replace(/\d+$/, "");
      if (families.has(fam)) continue;
      families.add(fam);
      out.push(c);
    }
    this.defs = out;
  }

  onEvent(e: GameEvent, w: World, me: number): string | null {
    switch (e.kind) {
      case EV.CHEST_OPEN:
        if (e.b === me) this.counts.chests++;
        break;
      case EV.PICKUP:
        if (e.a === me && e.c >= 3 && e.b !== ITEM.POTION && e.b !== ITEM.KEY) this.counts.epics++;
        break;
      case EV.DOOR:
        if (e.a === me) this.counts.door++;
        break;
      case EV.POTION:
        if (e.a === me) this.counts.potions++;
        break;
      case EV.MON_DIE:
        if (e.b === me) {
          const now = e.tick;
          this.counts.streak = now - this.lastKillAt <= 3 * TICKS_PER_SEC ? this.counts.streak + 1 : 1;
          this.lastKillAt = now;
          this.counts.bestStreak = Math.max(this.counts.bestStreak, this.counts.streak);
        }
        break;
      case EV.EXTRACT:
        if (e.a === me && e.tick <= w.portalTick + 60 * TICKS_PER_SEC) this.earlyEscape = true;
        break;
    }
    // Report a newly completed contract (once).
    for (const r of this.results(w, me)) {
      if (r.done && !this.completed.has(r.id)) {
        this.completed.add(r.id);
        return r.title;
      }
    }
    return null;
  }

  results(w: World, me: number): ContractResult[] {
    const extracted = w.players[me].state === PS.EXTRACTED;
    return this.defs.map((d) => {
      let value = d.id === "early" ? (this.earlyEscape ? 1 : 0) : d.progress(w, me, this.counts);
      value = Math.min(value, d.target);
      const reached = value >= d.target;
      const done = reached && (!d.needsExtract || extracted);
      return { id: d.id, title: d.title, xp: d.xp, value, target: d.target, done, needsExtract: d.needsExtract };
    });
  }
}

export { CHEST };
