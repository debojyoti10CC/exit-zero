import { useEffect, useMemo, useRef, useState } from "react";
import type Phaser from "phaser";
import { createGame } from "../game/GameScene";
import { hud } from "../game/hudStore";
import { sfx } from "../game/audio";
import { decodeWorld, CLASSES, PS, PLAYER_CSS, fmtTime } from "../game/world";
import { erExplorer } from "../chain/config";
import { listMatches, loadReplay, type MatchRef, type ReplayResult } from "./loader";
import { ReplaySession } from "./session";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

/** Lists recently settled matches; picking one downloads, verifies and plays it. */
export function Replays({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<MatchRef[] | null | undefined>(undefined);
  const [pick, setPick] = useState<MatchRef | null>(null);
  useEffect(() => {
    listMatches().then(setList).catch(() => setList(null));
  }, []);
  if (pick) return <ReplayLoader match={pick} onBack={() => setPick(null)} />;
  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(820px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            VERIFIED REPLAYS
          </h2>
          <button className="btn ghost small" onClick={onBack}>
            Back
          </button>
        </div>
        <p className="muted small">
          Every match is a sequence of transactions on the MagicBlock rollup. A replay downloads all of them, re-runs every tick in your browser with the same Rust core the
          program runs (compiled to WASM), and checks the world hash the program logged after each tick. If one byte differs, the replay fails.
        </p>
        {list === undefined && <div className="loading">READING SETTLED MATCHES…</div>}
        {list === null && <div className="muted">Could not reach the rollup. Try again in a moment.</div>}
        {list && list.length === 0 && <div className="muted">No settled matches with replay receipts yet. Finish an online run to create one.</div>}
        <div className="replay-list">
          {(list || []).map((m) => (
            <button key={m.settleSig} className="replay-row" onClick={() => (sfx.click(), setPick(m))}>
              <span className="gold">CRYPT {m.room + 1}</span>
              <span>run #{m.nonce}</span>
              <span className="muted">{m.time ? new Date(m.time * 1000).toLocaleString() : `slot ${m.slot}`}</span>
              <span className="mono muted">{m.finalHash}</span>
              <span className="violet">▶ Verify &amp; watch</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReplayLoader({ match, onBack }: { match: MatchRef; onBack: () => void }) {
  const [stage, setStage] = useState({ text: "Starting", frac: 0 });
  const [res, setRes] = useState<ReplayResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadReplay(match, (text, frac) => live && setStage({ text, frac }))
      .then((r) => live && setRes(r))
      .catch((e) => live && setErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [match]);
  if (res && res.frames.length) return <ReplayPlayer res={res} onBack={onBack} />;
  return (
    <div className="screen" style={{ justifyContent: "center" }}>
      <div className="panel" style={{ width: "min(520px, 100%)" }}>
        <h2 style={{ marginTop: 0 }}>VERIFYING CRYPT {match.room + 1} · RUN #{match.nonce}</h2>
        {!err && !res && (
          <>
            <div className="small">{stage.text}…</div>
            <div className="replay-bar">
              <div style={{ width: `${Math.round(stage.frac * 100)}%` }} />
            </div>
          </>
        )}
        {res && !res.frames.length && <div className="muted">This match has no recorded ticks.</div>}
        {err && <div className="claim-note err">{err}</div>}
        <button className="btn ghost small" style={{ marginTop: 12 }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function ReplayPlayer({ res, onBack }: { res: ReplayResult; onBack: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const first = useMemo(() => decodeWorld(res.frames[0].bytes), [res]);
  const session = useMemo(() => new ReplaySession(res.frames, Math.max(0, first.players.findIndex((p) => p.state !== PS.EMPTY))), [res, first]);
  const [, force] = useState(0);
  useEffect(() => session.onUi(() => force((n) => n + 1)), [session]);
  useEffect(() => {
    hud.reset();
    session.start();
    const game: Phaser.Game = createGame(host.current!, session, { onEnd: () => {}, onPauseToggle: () => session.toggle() });
    return () => {
      game.destroy(true);
      session.stop();
    };
  }, [session]);
  const f = res.frames[session.idx];
  const w = session.latest?.world;
  const verdict = res.verified;
  return (
    <div className="game-wrap" onContextMenu={(e) => e.preventDefault()}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      <div className="replay-panel panel">
        <div className="row" style={{ gap: 8 }}>
          <span className={`replay-badge ${verdict ? "ok" : "bad"}`}>{verdict ? "✔ REPLAY = ON-CHAIN" : "✖ MISMATCH"}</span>
          <span className="grow" />
          <button className="btn ghost small" onClick={onBack}>
            Exit
          </button>
        </div>
        <div className="small" style={{ marginTop: 6, lineHeight: 1.6 }}>
          <b className={verdict ? "green" : "red"}>
            {res.ticksMatched.toLocaleString()}/{res.ticksChecked.toLocaleString()}
          </b>{" "}
          ticks re-simulated byte-exact in WASM · dungeon from VRF seed {res.beginOk ? "✔" : "✖"} · settle receipt {res.settleOk ? "✔" : "✖"}
          {res.firstMismatch !== null && <span className="red"> · first mismatch at tick {res.firstMismatch}</span>}
          <br />
          <span className="muted">
            {res.txCount.toLocaleString()} rollup transactions · {res.ops.toLocaleString()} program instructions replayed ·{" "}
            <a href={erExplorer(res.match.settleSig)} target="_blank" rel="noreferrer">
              settle tx ↗
            </a>
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn small primary" style={{ minWidth: 64 }} onClick={() => session.toggle()}>
            {session.playing ? "❚❚" : "▶"}
          </button>
          <input
            className="grow"
            type="range"
            min={0}
            max={res.frames.length - 1}
            value={session.idx}
            onChange={(e) => session.seek(+e.target.value)}
          />
          <span className="mono small" style={{ width: 150, textAlign: "right", whiteSpace: "nowrap" }}>
            tick {f.tick} · {fmtTime(f.tick)}
          </span>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {[1, 2, 4, 8].map((s) => (
            <button key={s} className={`btn small ${session.speed === s ? "primary" : ""}`} onClick={() => session.setSpeed(s)}>
              {s}×
            </button>
          ))}
          <span className="grow" />
          {w?.players.map((p, i) =>
            p.state === PS.EMPTY ? null : (
              <button
                key={i}
                className={`btn small ${session.me === i ? "primary" : ""}`}
                style={{ color: PLAYER_CSS[i] }}
                title={res.wallets[i] || ""}
                onClick={() => session.follow(i)}
              >
                {p.name || CLASSES[p.cls].name}
                {res.wallets[i] ? ` · ${short(res.wallets[i])}` : ""}
              </button>
            ),
          )}
        </div>
        {!f.ok && <div className="small red">This tick's hash does not match the on-chain receipt.</div>}
      </div>
    </div>
  );
}
