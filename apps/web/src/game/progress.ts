// Meta progression kept in the browser: XP, levels, titles, personal bests and a
// daily streak. Pure presentation — it never changes match rules, so practice and
// on-chain runs stay identical.

import type { World } from "./world";
import { PS } from "./world";
import type { ContractResult } from "./contracts";

export interface Progress {
  xp: number;
  runs: number;
  extractions: number;
  deaths: number;
  kills: number;
  betrayals: number;
  bestBank: number;
  totalGold: number;
  lastDay: string;
  streak: number;
}

export const TITLES = [
  "Grave Robber",
  "Tomb Scavenger",
  "Crypt Runner",
  "Relic Hunter",
  "Bone Breaker",
  "Vault Breaker",
  "Hollow Stalker",
  "King's Bane",
  "Corruption Walker",
  "Lord of the Hollow",
];

const KEY = "exitzero.progress.v1";
const blank: Progress = { xp: 0, runs: 0, extractions: 0, deaths: 0, kills: 0, betrayals: 0, bestBank: 0, totalGold: 0, lastDay: "", streak: 0 };

export function loadProgress(): Progress {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...blank, ...JSON.parse(s) };
  } catch {
    /* ignore */
  }
  return { ...blank };
}

function save(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number) {
  return Math.round(120 * Math.pow(level - 1, 1.6));
}

export function levelOf(xp: number) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
}

export function levelInfo(xp: number) {
  const level = levelOf(xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  return { level, into: xp - lo, need: hi - lo, pct: (xp - lo) / (hi - lo), title: TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))] };
}

export interface XpLine {
  label: string;
  xp: number;
}

export interface RunAward {
  lines: XpLine[];
  total: number;
  before: number;
  after: number;
  levelsGained: number;
  newRecord: boolean;
  streak: number;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Scores a finished run, saves progress and returns the breakdown for the results screen. */
export function awardRun(w: World, me: number, contracts: ContractResult[]): RunAward {
  const p = loadProgress();
  const pl = w.players[me];
  const extracted = pl.state === PS.EXTRACTED;
  const lines: XpLine[] = [];
  if (pl.kills) lines.push({ label: `${pl.kills} monsters slain`, xp: pl.kills * 6 });
  if (extracted) {
    lines.push({ label: "Escaped alive", xp: 80 });
    if (pl.banked) lines.push({ label: `${pl.banked} gold banked`, xp: Math.round(pl.banked / 8) });
  } else {
    lines.push({ label: "Fell in the crypt", xp: 10 });
  }
  if (pl.pvpKills) lines.push({ label: `${pl.pvpKills} betrayal${pl.pvpKills > 1 ? "s" : ""}`, xp: pl.pvpKills * 35 });
  if (w.bossDmg[me] > 0 && w.monsters[w.bossIdx]?.hp === 0) lines.push({ label: "Fought the Hollow King", xp: 120 });
  for (const c of contracts) if (c.done) lines.push({ label: `Contract: ${c.title}`, xp: c.xp });

  // Daily streak: first run each day adds a bonus that grows with the streak.
  const d = today();
  let streak = p.streak;
  if (p.lastDay !== d) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yd = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
    streak = p.lastDay === yd ? p.streak + 1 : 1;
    lines.push({ label: `Daily descent · streak ${streak}`, xp: 40 + Math.min(streak, 7) * 15 });
  }

  const total = lines.reduce((s, l) => s + l.xp, 0);
  const before = p.xp;
  const after = before + total;
  const newRecord = extracted && pl.banked > p.bestBank;
  const next: Progress = {
    ...p,
    xp: after,
    runs: p.runs + 1,
    extractions: p.extractions + (extracted ? 1 : 0),
    deaths: p.deaths + (pl.state === PS.DEAD ? 1 : 0),
    kills: p.kills + pl.kills,
    betrayals: p.betrayals + pl.pvpKills,
    bestBank: Math.max(p.bestBank, extracted ? pl.banked : 0),
    totalGold: p.totalGold + (extracted ? pl.banked : 0),
    lastDay: d,
    streak,
  };
  save(next);
  return { lines, total, before, after, levelsGained: levelOf(after) - levelOf(before), newRecord, streak };
}
