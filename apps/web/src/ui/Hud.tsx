import { useEffect, useRef, useState } from "react";
import { useHud, minimap } from "../game/hudStore";
import {
  CLASSES, PLAYER_CSS, PS, PHASE, MON, corruption, fmtTime, lootValue, portalsOpen, RARITY_CSS, itemLabel, itemValue, INV_SLOTS, TICKS_PER_SEC,
} from "../game/world";
import { ItemIcon, Sprite, HERO_SPRITES } from "./Sprites";
import type { GameSession } from "../game/session";
import { erExplorer, accountExplorer } from "../chain/config";

function Minimap({ big }: { big: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const c = minimap.canvas;
      if (c && host.current && c.parentElement !== host.current) {
        host.current.innerHTML = "";
        host.current.appendChild(c);
      }
    }, 200);
    return () => clearInterval(t);
  }, []);
  return <div className={`minimap ${big ? "big" : ""}`} ref={host} />;
}

function ChainBox({ session }: { session: GameSession }) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const s = session.stats;
  if (!s) {
    return (
      <div className="chainbox">
        <b>PRACTICE</b> — same rules as on-chain, run locally in WASM
      </div>
    );
  }
  return (
    <div className="chainbox">
      <div>
        <b>MAGICBLOCK ER</b> {new URL(s.endpoint).host}
      </div>
      <div>
        tx {s.txOk}/{s.txSent} · fail {s.txFail} · rtt {Math.round(s.avgLatency)}ms
      </div>
      <div>
        ticks {s.ticksSeen} · {s.crank}
      </div>
      <div>
        room{" "}
        <a href={accountExplorer(s.room, true)} target="_blank" rel="noreferrer">
          {s.room.slice(0, 6)}…
        </a>
        {s.lastSig && (
          <>
            {" "}
            · last{" "}
            <a href={erExplorer(s.lastSig)} target="_blank" rel="noreferrer">
              tx
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export function Hud({ session }: { session: GameSession }) {
  const h = useHud();
  const [bigMap, setBigMap] = useState(false);
  const ghostHp = useRef(1);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") setBigMap((b) => !b);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const w = h.world;
  if (!w) return null;
  const me = w.players[h.me];
  const cls = CLASSES[me.cls];
  const hpPct = Math.max(0, me.hp / me.maxHp);
  ghostHp.current = Math.max(hpPct, ghostHp.current * 0.97);
  const corr = corruption(w);
  const left = w.collapseTick - w.tick;
  const open = portalsOpen(w);
  const nextEvent = w.tick < w.eliteTick ? { label: "ELITES AWAKEN", at: w.eliteTick } : w.tick < w.portalTick ? { label: "PORTALS OPEN", at: w.portalTick } : { label: "COLLAPSE", at: w.collapseTick };
  const spec = me.specReady > w.tick ? (me.specReady - w.tick) / cls.specCd : 0;
  const dodge = me.dodgeReady > w.tick ? (me.dodgeReady - w.tick) / 14 : 0;
  const loot = lootValue(me);
  const boss = w.bossIdx < w.monsters.length ? w.monsters[w.bossIdx] : null;
  const bossNear = !!boss && boss.kind === MON.KING && boss.hp > 0 && boss.hp < boss.maxHp && me.state === PS.ALIVE && Math.hypot(boss.x - me.x, boss.y - me.y) < 256 * 11;
  const hero = HERO_SPRITES[me.cls][h.me % 2];

  return (
    <div className="hud">
      <div className="hud-top">
        <div className={`timer ${left < 300 ? "warn" : ""}`}>{fmtTime(left)}</div>
        <div className="corrupt" title="Corruption">
          <div style={{ width: `${corr}%` }} />
          <div className="marks">
            <span style={{ left: `${(w.eliteTick / w.collapseTick) * 100}%` }} />
            <span style={{ left: `${(w.portalTick / w.collapseTick) * 100}%` }} />
          </div>
        </div>
        <div className="phase-label">
          CORRUPTION {corr}% · {nextEvent.label} {nextEvent.at > w.tick ? `IN ${fmtTime(nextEvent.at - w.tick)}` : ""}
          {open && <span className="violet"> · PORTALS OPEN</span>}
        </div>
      </div>

      {bossNear && boss && (
        <div className="bossbar">
          <div className="n">THE HOLLOW KING</div>
          <div className="bar">
            <div className="fill" style={{ width: `${(boss.hp / boss.maxHp) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="hud-tl">
        {h.feed.map((f) => (
          <div key={f.id} className="feed-line" dangerouslySetInnerHTML={{ __html: f.html }} />
        ))}
      </div>

      <div className="hud-tr">
        <Minimap big={bigMap} />
        <div className="party">
          {w.players.map((p, i) =>
            p.state === PS.EMPTY ? null : (
              <div key={i} className={`pm ${p.state === PS.DEAD ? "dead" : ""}`} style={{ borderColor: PLAYER_CSS[i] }}>
                <span className="nm" style={{ color: PLAYER_CSS[i] }}>
                  {p.name || CLASSES[p.cls].name}
                  {i === h.me ? " (you)" : ""}
                </span>
                {p.state === PS.EXTRACTED ? (
                  <span className="violet mono" style={{ fontSize: 9 }}>
                    ESCAPED
                  </span>
                ) : (
                  <div className="mini">
                    <div style={{ width: `${(p.hp / p.maxHp) * 100}%`, background: PLAYER_CSS[i] }} />
                  </div>
                )}
                <span className="gold mono" style={{ fontSize: 10 }}>
                  {p.state === PS.EXTRACTED ? p.banked : lootValue(p)}
                </span>
              </div>
            ),
          )}
        </div>
        {h.contracts.length > 0 && (
          <div className="contracts">
            <div className="ct-head">CONTRACTS</div>
            {h.contracts.map((c) => {
              const reached = c.value >= c.target;
              const pending = reached && !c.done;
              return (
                <div key={c.id} className={`ct ${c.done ? "done" : pending ? "pending" : ""}`}>
                  <span className="box">{c.done ? "✓" : ""}</span>
                  <span className="nm">{c.title}</span>
                  <span className="pr">{c.done ? `+${c.xp}` : pending ? "escape!" : c.target > 1 ? `${c.value}/${c.target}` : ""}</span>
                </div>
              );
            })}
          </div>
        )}
        <ChainBox session={session} />
      </div>

      <div className="toasts">
        {h.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.big ? "big" : ""}`} style={{ color: t.color || "#fff" }}>
            <div className="t">{t.title}</div>
            {t.sub && <div className="s">{t.sub}</div>}
          </div>
        ))}
      </div>

      {me.state === PS.ALIVE && h.extractPct > 0 && (
        <div className="extract">
          ESCAPING… HOLD POSITION
          <div className="bar">
            <div className="fill" style={{ width: `${h.extractPct * 100}%` }} />
          </div>
        </div>
      )}
      {me.state === PS.ALIVE && h.nearPrompt && <div className="prompt">{h.nearPrompt}</div>}

      {me.state === PS.ALIVE && (
        <div className="hud-bl">
          <div className="portrait px-slot">
            <Sprite base={`${hero}_idle_anim`} scale={2.4} />
          </div>
          <div className="bars">
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 12, color: PLAYER_CSS[h.me] }}>
                {me.name || cls.name}
              </span>
              <span className="mono muted" style={{ fontSize: 10 }}>
                {cls.name.toUpperCase()}
              </span>
            </div>
            <div className="bar hp">
              <div className="ghost" style={{ width: `${ghostHp.current * 100}%` }} />
              <div className="fill" style={{ width: `${hpPct * 100}%`, position: "relative" }} />
              <div className="lbl">
                {me.hp} / {me.maxHp}
              </div>
            </div>
            <div className="skills">
              <Skill k="LMB" glyph={me.cls === 1 ? "✦" : me.cls === 2 ? "🗡" : "⚔"} cd={0} />
              <Skill k="RMB" glyph={me.cls === 0 ? "🛡" : me.cls === 1 ? "🔥" : "👁"} cd={spec} label={cls.special} />
              <Skill k="SPC" glyph="💨" cd={dodge} label="Dodge" />
              <Skill k="Q" glyph="🧪" cd={me.potionReady > w.tick ? (me.potionReady - w.tick) / 30 : 0} count={me.potions} dim={me.potions === 0} />
              <Skill k="KEY" glyph="🗝" cd={0} count={me.keys} dim={me.keys === 0} />
            </div>
          </div>
        </div>
      )}

      {me.state === PS.ALIVE && (
        <div className="hud-br">
          <div className="loot-box">
            UNBANKED LOOT
            <div className="v">{loot}</div>
            {loot > 0 && !open && <div style={{ color: "#ff8a9a" }}>lost if you die</div>}
          </div>
          <div className="hotbar">
            {Array.from({ length: INV_SLOTS }, (_, i) => {
              const it = me.inv[i];
              return (
                <div key={i} className="slot" title={it.kind ? `${itemLabel(it)} — ${itemValue(it)}` : ""} style={{ borderColor: it.kind ? RARITY_CSS[it.rarity] : undefined }}>
                  {it.kind ? <ItemIcon kind={it.kind} rarity={it.rarity} scale={2} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {h.inventoryOpen && me.state === PS.ALIVE && (
        <div className="overlay pe" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="panel" style={{ width: 520 }}>
            <h2>PACK — {loot} UNBANKED</h2>
            <div className="items">
              {me.inv.filter((i) => i.kind).length === 0 && <div className="muted">Empty. Open chests and slay elites.</div>}
              {me.inv
                .filter((i) => i.kind)
                .map((it, i) => (
                  <div key={i} className="item" style={{ borderColor: RARITY_CSS[it.rarity] }}>
                    <ItemIcon kind={it.kind} rarity={it.rarity} scale={2} />
                    <div>
                      <div style={{ color: RARITY_CSS[it.rarity] }}>{itemLabel(it)}</div>
                      <div className="muted small">
                        {itemValue(it)} gold
                        {it.kind === 6 ? ` · +${12 * (it.rarity + 1)}% damage` : it.kind === 7 ? ` · ${6 * (it.rarity + 1)}% armour` : ""}
                        {it.rarity >= 2 ? " · becomes an on-chain relic" : ""}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            <p className="muted small" style={{ marginTop: 14 }}>
              Rare or better items you extract are recorded in the on-chain Relic Vault under your wallet. Press TAB to close.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Skill({ k, glyph, cd, count, label, dim }: { k: string; glyph: string; cd: number; count?: number; label?: string; dim?: boolean }) {
  return (
    <div className={`skill ${cd <= 0 && !dim ? "ready" : ""}`} title={label} style={{ opacity: dim ? 0.45 : 1 }}>
      <span className="key">{k}</span>
      <span className="glyph">{glyph}</span>
      {count !== undefined && <span className="cnt">{count}</span>}
      {cd > 0 && <div className="cd" style={{ height: `${Math.min(1, cd) * 100}%` }} />}
    </div>
  );
}

export { TICKS_PER_SEC, PHASE };
