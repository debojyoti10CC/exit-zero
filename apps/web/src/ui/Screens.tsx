import { useEffect, useRef, useState } from "react";
import { Sprite, ItemIcon, HERO_SPRITES } from "./Sprites";
import { sfx } from "../game/audio";
import {
  World, CLASSES, PS, PHASE, PLAYER_CSS, RARITY_CSS, INV_SLOTS, itemLabel, itemValue, lootValue, fmtTime,
} from "../game/world";
import type { GameSession } from "../game/session";
import { erExplorer, accountExplorer } from "../chain/config";
import { levelInfo, loadProgress, type RunAward } from "../game/progress";
import type { ContractResult } from "../game/contracts";

/** Keyboard + mouse driven vertical menu with a ▶ cursor. */
export function RpgMenu({ items, onPick, autoFocus = true }: { items: { label: string; hint?: string; disabled?: boolean }[]; onPick: (i: number) => void; autoFocus?: boolean }) {
  const [sel, setSel] = useState(0);
  const selRef = useRef(0);
  selRef.current = sel;
  useEffect(() => {
    if (!autoFocus) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "s") {
        e.preventDefault();
        setSel((s) => (s + 1) % items.length);
        sfx.hover();
      } else if (e.key === "ArrowUp" || e.key === "w") {
        e.preventDefault();
        setSel((s) => (s - 1 + items.length) % items.length);
        sfx.hover();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!items[selRef.current].disabled) {
          sfx.click();
          onPick(selRef.current);
        }
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [items, onPick, autoFocus]);
  return (
    <div className="rpg-menu">
      {items.map((it, i) => (
        <button
          key={it.label}
          className={`rpg-item ${sel === i ? "sel" : ""}`}
          disabled={it.disabled}
          onMouseEnter={() => {
            if (sel !== i) sfx.hover();
            setSel(i);
          }}
          onClick={() => {
            sfx.ensure();
            sfx.click();
            onPick(i);
          }}
        >
          {it.label}
          {it.hint && <span className="hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <div className="logo">
      EXIT<span className="slash">//</span>
      <span className="zero">ZERO</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

export type TitlePick = "online" | "practice" | "hero" | "hall" | "vault" | "howto";

export function Title({ name, cls, onPick }: { name: string; cls: number; onPick: (p: TitlePick) => void }) {
  const items: { label: string; hint?: string; id: TitlePick }[] = [
    { label: "Enter the Crypt", hint: "online · 4 players", id: "online" },
    { label: "Practice", hint: "vs rival bots", id: "practice" },
    { label: "Adventurer", hint: CLASSES[cls].name, id: "hero" },
    { label: "Hall of Fame", id: "hall" },
    { label: "Relic Vault", id: "vault" },
    { label: "How to Play", id: "howto" },
  ];
  return (
    <div className="title-wrap">
      <div>
        <Logo />
        <div className="subtitle">Loot · Betray · Escape — before the crypt collapses</div>
      </div>
      <div />
      <div className="title-bottom">
        <div className="panel">
          <RpgMenu items={items} onPick={(i) => onPick(items[i].id)} />
        </div>
        <div className="foot">
          <div>
            <span className="press">▲▼ select · enter confirm</span>
          </div>
          <div style={{ marginTop: 8 }}>Fully on-chain · MagicBlock Ephemeral Rollups · VRF · Session keys</div>
        </div>
        <div className="panel hero-card" onClick={() => onPick("hero")} style={{ cursor: "pointer" }}>
          <div className="px-title" style={{ fontSize: 8 }}>
            Your adventurer
          </div>
          <div className="who">
            <div className="pedestal" style={{ height: 80, width: 64 }}>
              <Sprite base={`${HERO_SPRITES[cls][0]}_idle_anim`} scale={3} />
            </div>
            <div className="col" style={{ gap: 4 }}>
              <div className="mono gold" style={{ fontSize: 16, textShadow: "var(--sh)" }}>
                {name || "Nameless"}
              </div>
              <div className="hero-role">{CLASSES[cls].name}</div>
              <LevelBadge />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero select hall
// ---------------------------------------------------------------------------

const STATS = [
  // hp, speed, power, range, difficulty (out of 5)
  { HP: 5, SPEED: 3, POWER: 4, RANGE: 1, diff: 1 },
  { HP: 2, SPEED: 2, POWER: 5, RANGE: 5, diff: 2 },
  { HP: 3, SPEED: 5, POWER: 3, RANGE: 1, diff: 3 },
];
const ABILITIES = [
  ["Cleave", "Wide sword arc that hits everything in front of you."],
  ["Arcane Bolt", "Fast ranged bolt. Keep your distance."],
  ["Twin Stab", "The quickest attack in the crypt."],
];

export function HeroSelect({ cls, setCls, name, setName, onDone }: { cls: number; setCls: (n: number) => void; name: string; setName: (s: string) => void; onDone: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" && e.key !== "Enter") return;
      if (e.key === "ArrowLeft" || e.key === "a") {
        setCls((cls + 2) % 3);
        sfx.hover();
      } else if (e.key === "ArrowRight" || e.key === "d") {
        setCls((cls + 1) % 3);
        sfx.hover();
      } else if (e.key === "Enter" || e.key === "Escape") {
        sfx.click();
        onDone();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [cls]);
  const c = CLASSES[cls];
  const s = STATS[cls];
  return (
    <div className="screen mid">
      <div className="hero-hall">
        <div className="panel">
          <div className="px-title">Attributes</div>
          {(["HP", "SPEED", "POWER", "RANGE"] as const).map((k) => (
            <div className="statbar" key={k}>
              <span>{k}</span>
              <div className="track">
                <div style={{ width: `${(s[k] / 5) * 100}%` }} />
              </div>
              <span className="v">{k === "HP" ? c.hp : k === "SPEED" ? c.speed : s[k]}</span>
            </div>
          ))}
          <div className="rule" />
          <div className="statbar">
            <span>DIFFICULTY</span>
            <div className="pips">
              {[1, 2, 3].map((n) => (
                <div key={n} className={`pip ${n <= s.diff ? "on" : ""}`} />
              ))}
            </div>
            <span />
          </div>
        </div>

        <div className="hero-stage">
          <div className="row" style={{ gap: 4 }}>
            <button className="arrow-btn" onClick={() => (sfx.hover(), setCls((cls + 2) % 3))}>
              ◀
            </button>
            <div className="pedestal" style={{ height: 200, width: 140 }}>
              <Sprite base={`${HERO_SPRITES[cls][0]}_run_anim`} scale={7} />
            </div>
            <button className="arrow-btn" onClick={() => (sfx.hover(), setCls((cls + 1) % 3))}>
              ▶
            </button>
          </div>
          <div className="hero-name">{c.name.toUpperCase()}</div>
          <div className="hero-role">{c.role}</div>
          <div className="pips">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`pip ${i === cls ? "on" : ""}`} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="px-title">Abilities</div>
          <div className="row" style={{ alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
            <span className="kbd">LMB</span>
            <div>
              <div className="gold mono" style={{ fontSize: 8, marginBottom: 2 }}>
                {ABILITIES[cls][0].toUpperCase()}
              </div>
              <div className="small">{ABILITIES[cls][1]}</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
            <span className="kbd">RMB</span>
            <div>
              <div className="gold mono" style={{ fontSize: 8, marginBottom: 2 }}>
                {c.special.toUpperCase()}
              </div>
              <div className="small">{c.desc}</div>
            </div>
          </div>
          <div className="rule" />
          <div className="px-title" style={{ fontSize: 8 }}>
            Name
          </div>
          <input className="field" maxLength={12} placeholder="12 characters" value={name} onChange={(e) => setName(e.target.value.replace(/[^\x20-\x7e]/g, ""))} />
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={() => (sfx.click(), onDone())}>
              Confirm
            </button>
          </div>
        </div>
      </div>
      <div className="foot" style={{ marginTop: 16 }}>
        ◀ ▶ choose · enter confirm
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Practice setup
// ---------------------------------------------------------------------------

export function PracticeSetup({ cls, onBack, onStart }: { cls: number; onBack: () => void; onStart: (bots: number, quick: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const opts = [
    { label: "Quick run", hint: "3 rivals · 4 min", bots: 3, quick: true },
    { label: "Full run", hint: "3 rivals · 6 min", bots: 3, quick: false },
    { label: "Duel", hint: "1 rival · 4 min", bots: 1, quick: true },
    { label: "Solo", hint: "no rivals · 4 min", bots: 0, quick: true },
    { label: "Back", hint: "", bots: -1, quick: true },
  ];
  return (
    <div className="screen mid">
      <div className="panel" style={{ width: "min(560px, 100%)" }}>
        <div className="px-title">Practice</div>
        <div className="row" style={{ alignItems: "flex-end", marginBottom: 8 }}>
          <div className="pedestal" style={{ height: 80, width: 56 }}>
            <Sprite base={`${HERO_SPRITES[cls][0]}_idle_anim`} scale={3} />
          </div>
          <div className="small muted grow">
            The same on-chain rules, run locally in WASM, against rival adventurers who loot, fight and betray. Chest rolls here are local; online they come from MagicBlock VRF.
          </div>
        </div>
        <div className="rule" />
        {busy ? (
          <div className="loading" style={{ padding: 12 }}>
            Carving the crypt
          </div>
        ) : (
          <RpgMenu
            items={opts}
            onPick={(i) => {
              const o = opts[i];
              if (o.bots < 0) return onBack();
              setBusy(true);
              onStart(o.bots, o.quick);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results scroll
// ---------------------------------------------------------------------------

function useCountUp(target: number, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    let lastTick = 0;
    const f = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const val = Math.round(target * (1 - Math.pow(1 - k, 3)));
      setV(val);
      if (now - lastTick > 70 && k < 1 && target > 0) {
        lastTick = now;
        sfx.pickup(0);
      }
      if (k < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export function ResultsScroll({
  world, me, session, settle, onExit, onAgain, award, contracts, death,
}: {
  world: World;
  me: number;
  session: GameSession;
  settle: { sig: string | null; err: string | null };
  onExit: () => void;
  onAgain?: () => void;
  award: RunAward | null;
  contracts: ContractResult[];
  death: { lost: number; portalTiles: number; portalsOpen: boolean } | null;
}) {
  const p = world.players[me];
  const extracted = p.state === PS.EXTRACTED;
  const banked = extracted ? p.banked : 0;
  const shown = useCountUp(banked);

  const hero = HERO_SPRITES[p.cls][me % 2];
  const ranking = world.players
    .map((q, i) => ({ q, i }))
    .filter((x) => x.q.state !== PS.EMPTY)
    .sort((a, b) => (b.q.state === PS.EXTRACTED ? b.q.banked : -1) - (a.q.state === PS.EXTRACTED ? a.q.banked : -1));
  const seedHex = Array.from(world.seed)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const survived = fmtTime(Math.min(world.tick, world.collapseTick));

  useEffect(() => {
    sfx.stopAmbience();
    if (extracted) sfx.extract();
    else sfx.playerDie();
  }, []);

  return (
    <div className="overlay">
      <div className={`panel results ${extracted ? "gold" : "blood"}`}>
        <div className="result-banner">
          <h1 className="result-title" style={{ color: extracted ? "var(--gold)" : "var(--red)" }}>
            {extracted ? "EXTRACTED" : "ELIMINATED"}
          </h1>
          <div className="result-sub">{extracted ? "You escaped the Forgotten Crypt with your haul." : "Your pack spilled on the crypt floor. Someone else may carry it out."}</div>
          {!extracted && death && death.lost > 0 && (
            <div className="recap">
              {death.portalsOpen
                ? `You fell ${death.portalTiles} tiles from a portal, carrying ${death.lost} gold.`
                : `You fell carrying ${death.lost} gold. The portals had not opened yet.`}
            </div>
          )}
          {award?.newRecord && (
            <div style={{ marginTop: 8 }}>
              <span className="record">NEW PERSONAL BEST</span>
            </div>
          )}
        </div>

        <div className="res-grid">
          <div className="res-hero">
            <div className="pedestal" style={{ height: 140, width: 120 }}>
              {extracted ? (
                <Sprite base={`${hero}_idle_anim`} scale={5} />
              ) : (
                <span style={{ filter: "grayscale(1) brightness(0.6)", transform: "rotate(90deg)", display: "inline-block", marginBottom: 10 }}>
                  <Sprite base={`${hero}_idle_anim`} frames={1} scale={5} />
                </span>
              )}
            </div>
            <div className="gold-count">{shown}</div>
            <div className="gold-label">GOLD SECURED</div>
          </div>

          <div>
            <div className="ledger">
              <div>
                <span>Monsters slain</span>
                <b>{p.kills}</b>
              </div>
              <div>
                <span>Betrayals</span>
                <b className="red">{p.pvpKills}</b>
              </div>
              <div>
                <span>Damage dealt</span>
                <b>{p.dmgDealt}</b>
              </div>
              <div>
                <span>{extracted ? "Escaped at" : "Fell at"}</span>
                <b>{survived}</b>
              </div>
            </div>
            <div className="panel-sub mono muted" style={{ fontSize: 8, letterSpacing: 2, margin: "10px 0 6px" }}>
              {extracted ? "PACK — BANKED" : "PACK — LOST"}
            </div>
            <div className="slots">
              {Array.from({ length: INV_SLOTS }, (_, i) => {
                const it = extracted ? p.inv[i] : { kind: 0, rarity: 0 };
                return (
                  <div key={i} className="slot" title={it.kind ? `${itemLabel(it)} — ${itemValue(it)}${it.rarity >= 2 && session.mode === "online" ? " · relic" : ""}` : ""}>
                    {it.kind ? <ItemIcon kind={it.kind} rarity={it.rarity} scale={2} /> : null}
                  </div>
                );
              })}
            </div>
            {extracted && session.mode === "online" && p.inv.some((i) => i.kind && i.rarity >= 2) && (
              <div className="small violet" style={{ marginTop: 6 }}>
                ◆ Rare and better items are recorded as relics under your wallet.
              </div>
            )}
          </div>
        </div>

        {award && <XpPanel award={award} contracts={contracts} />}
        <div className="rule" />
        <table className="t">
          <thead>
            <tr>
              <th>#</th>
              <th>Adventurer</th>
              <th>Fate</th>
              <th className="num">Kills</th>
              <th className="num">Betrayals</th>
              <th className="num">Gold</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map(({ q, i }, k) => (
              <tr key={i} className={i === me ? "me" : ""}>
                <td className="mono" style={{ fontSize: 8 }}>
                  {k + 1}
                </td>
                <td style={{ color: PLAYER_CSS[i] }}>
                  {q.name || CLASSES[q.cls].name} <span className="muted small">{CLASSES[q.cls].name}</span>
                </td>
                <td>
                  {q.state === PS.EXTRACTED ? <span className="tag arcane">Escaped</span> : q.state === PS.ALIVE ? <span className="tag gold">Inside · {lootValue(q)}</span> : <span className="tag blood">Fallen</span>}
                </td>
                <td className="num">{q.kills}</td>
                <td className="num red">{q.pvpKills}</td>
                <td className="num gold">{q.state === PS.EXTRACTED ? q.banked : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="proof" style={{ marginTop: 10 }}>
          <div>
            <b>SEED</b> {seedHex} · {world.seedSrc === 1 ? "MagicBlock VRF (verified on-chain)" : "local practice seed"}
          </div>
          {session.mode === "online" && session.stats && (
            <>
              <div>
                <b>MATCH</b>{" "}
                <a href={accountExplorer(session.stats.room, true)} target="_blank" rel="noreferrer">
                  {session.stats.room.slice(0, 20)}…
                </a>{" "}
                · {session.stats.txOk} rollup tx
              </div>
              <div>
                <b>SETTLEMENT</b>{" "}
                {world.phase !== PHASE.ENDED ? (
                  "waiting for the run to end"
                ) : world.settled || settle.sig ? (
                  <>
                    Hall + Vault committed to Solana{" "}
                    {settle.sig && (
                      <a href={erExplorer(settle.sig)} target="_blank" rel="noreferrer">
                        view tx
                      </a>
                    )}
                  </>
                ) : settle.err ? (
                  <span className="red">{settle.err}</span>
                ) : (
                  "settling…"
                )}
              </div>
            </>
          )}
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          {session.mode === "online" && world.phase !== PHASE.ENDED && <span className="muted small grow">Others are still inside. Standings update live.</span>}
          <button className={`btn ${onAgain ? "" : "primary"}`} onClick={onExit}>
            {session.mode === "practice" ? "Menu" : "Crypt list"}
          </button>
          {onAgain && (
            <button className="btn primary" onClick={onAgain} autoFocus>
              Descend again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}



/** Level, title and XP bar for the title-screen card. */
export function LevelBadge() {
  const p = loadProgress();
  const li = levelInfo(p.xp);
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="small muted">{li.title}</div>
      <div className="lvl">
        <span className="n">LV {li.level}</span>
        <div className="xpbar">
          <div style={{ width: `${Math.round(li.pct * 100)}%` }} />
        </div>
      </div>
      <div className="mono" style={{ fontSize: 8, color: "var(--stone3)" }}>
        BEST {p.bestBank} · RUNS {p.runs}
        {p.streak > 1 ? ` · STREAK ${p.streak}` : ""}
      </div>
    </div>
  );
}

function XpPanel({ award, contracts }: { award: RunAward; contracts: ContractResult[] }) {
  const before = levelInfo(award.before);
  const after = levelInfo(award.after);
  const [pct, setPct] = useState(before.pct);
  const [lv, setLv] = useState(before.level);
  useEffect(() => {
    // Fill the bar; if we levelled, fill to the end first, then restart.
    const t1 = setTimeout(() => setPct(award.levelsGained > 0 ? 1 : after.pct), 400);
    const t2 =
      award.levelsGained > 0
        ? setTimeout(() => {
            setLv(after.level);
            setPct(0);
            sfx.legendary();
            setTimeout(() => setPct(after.pct), 120);
          }, 1300)
        : 0;
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, []);
  return (
    <div className="xp-panel">
      <div className="rule" />
      <div className="res-grid" style={{ marginTop: 0 }}>
        <div>
          <div className="gold-label" style={{ marginBottom: 6 }}>
            CONTRACTS
          </div>
          {contracts.map((c) => (
            <div key={c.id} className={`ct ${c.done ? "done" : ""}`}>
              <span className="box">{c.done ? "✓" : ""}</span>
              <span className="nm">{c.title}</span>
            </div>
          ))}
        </div>
        <div>
          {award.lines.map((l, i) => (
            <div key={i} className="xp-line" style={{ animationDelay: `${i * 90}ms` }}>
              <span>{l.label}</span>
              <b>+{l.xp} XP</b>
            </div>
          ))}
          <div className="lvl" style={{ marginTop: 8 }}>
            <span className="n">LV {lv}</span>
            <div className="xpbar">
              <div style={{ width: `${Math.round(pct * 100)}%`, transition: "width 0.8s steps(12)" }} />
            </div>
            <span className="mono violet" style={{ fontSize: 8 }}>
              +{award.total} XP
            </span>
          </div>
          {award.levelsGained > 0 && lv === after.level && (
            <div className="levelup" style={{ marginTop: 6 }}>
              LEVEL UP — {after.title.toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
