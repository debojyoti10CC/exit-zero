import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton as WMB } from "@solana/wallet-adapter-react-ui";
const WalletMultiButton = WMB as any;
import type { Keypair } from "@solana/web3.js";
import Phaser from "phaser";
import { SpiritTownScene as CryptScene } from "./ui/SpiritTownScene";
import { Title, HeroSelect, PracticeSetup, ResultsScroll, type TitlePick } from "./ui/Screens";
import { awardRun, type RunAward } from "./game/progress";
import type { ContractResult } from "./game/contracts";
import { Sprite, ItemIcon, HERO_SPRITES } from "./ui/Sprites";
import { Hud } from "./ui/Hud";
import { Replays } from "./replay/ReplayView";
import { createGame } from "./game/GameScene";
import { PracticeSession, loadWasm, type GameSession } from "./game/session";
import { hud } from "./game/hudStore";
import { sfx } from "./game/audio";
import {
  World, CLASSES, PS, PHASE, PLAYER_CSS, RARITY_CSS, RARITY_NAMES, ITEM_NAMES, itemLabel, itemValue, lootValue, fmtTime,
} from "./game/world";
import {
  ChainSession, RoomWatcher, fetchRooms, fetchHall, fetchRelics, joinRoom, restoreSession, guestKeypair, keypairSigner, startMatch,
  beginMatch, scheduleCrank, settleMatch, resetRoom, setClass as setClassTx, leaveRoom, fetchRelicChainState, claimRelic, type RoomInfo, type Signer,
  type RelicChainState,
} from "./chain/online";
import { erExplorer, accountExplorer, ER_RPC, PROGRAM_ID } from "./chain/config";
import { relicAssetPda, type HallEntry, type Relic } from "./chain/program";

type Screen = "menu" | "hero" | "practice" | "online" | "lobby" | "game" | "hall" | "vault" | "replays" | "howto";

const LS = {
  get: (k: string, d: string) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

interface Membership {
  room: number;
  session: Keypair;
  watcher: RoomWatcher;
  wallet: string;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [name, setName] = useState(() => LS.get("exitzero.name", ""));
  const [cls, setCls] = useState(() => Number(LS.get("exitzero.class", "0")));
  const [session, setSessionRaw] = useState<GameSession | null>(null);
  const [runId, setRunId] = useState(0);
  const setSession = (s: GameSession | null) => {
    setSessionRaw(s);
    if (s) setRunId((n) => n + 1);
  };
  const [member, setMember] = useState<Membership | null>(null);
  const wallet = useWallet();
  const guest = useMemo(() => guestKeypair(), []);

  useEffect(() => LS.set("exitzero.name", name), [name]);
  useEffect(() => LS.set("exitzero.class", String(cls)), [cls]);
  // Night-town theme on the menus; browsers only allow audio after a gesture.
  useEffect(() => {
    if (screen === "game") {
      sfx.stopMenuMusic();
      return;
    }
    if (sfx.menu) return;
    const start = () => sfx.startMenuMusic();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [screen]);
  useEffect(() => {
    loadWasm();
  }, []);

  const signer: Signer = useMemo(() => {
    if (wallet.publicKey && wallet.signTransaction) return { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction as any };
    return keypairSigner(guest);
  }, [wallet.publicKey, wallet.signTransaction, guest]);
  const identity = signer.publicKey.toBase58();
  const usingGuest = !wallet.publicKey;

  const go = (s: Screen) => {
    sfx.click();
    setScreen(s);
  };

  const lastPractice = useRef<{ bots: number; quick: boolean }>({ bots: 3, quick: true });
  const startPractice = async (bots: number, quick: boolean) => {
    lastPractice.current = { bots, quick };
    session?.destroy();
    const s = await PracticeSession.create(cls, name || CLASSES[cls].name, bots, quick);
    hud.reset();
    setSession(s);
    setScreen("game");
  };

  const leaveGame = useCallback(() => {
    const ended = session?.latest?.world.phase === PHASE.ENDED;
    session?.destroy();
    setSession(null);
    hud.reset();
    if (member) {
      // A finished room is reopened for the next party; a live one keeps running.
      if (ended) resetRoom(member.room, guestKeypair()).catch(() => {});
      member.watcher.stop();
      setMember(null);
      setScreen("online");
    } else setScreen("menu");
  }, [session, member]);

  return (
    <>
      {screen !== "game" && <CryptScene focus={screen === "hero" ? cls : -1} heroes={screen === "menu"} dim={screen === "menu" ? 0 : screen === "hero" ? 0.25 : 0.45} />}
      {screen !== "game" && (
        <div className="topbar">
          <div className="chip">
            <span className="dot" /> SOLANA DEVNET · MAGICBLOCK ER
          </div>
          <div className="row" style={{ gap: 8 }}>
            {usingGuest && (
              <span className="chip" title={identity}>
                GUEST {identity.slice(0, 4)}…{identity.slice(-4)}
              </span>
            )}
            <WalletMultiButton />
          </div>
        </div>
      )}
      {screen === "menu" && <Title name={name} cls={cls} onPick={(p: TitlePick) => go(p === "online" ? "online" : p === "practice" ? "practice" : p === "hero" ? "hero" : p)} />}
      {screen === "hero" && <HeroSelect cls={cls} setCls={setCls} name={name} setName={setName} onDone={() => go("menu")} />}
      {screen === "practice" && <PracticeSetup cls={cls} onBack={() => go("menu")} onStart={startPractice} />}
      {screen === "online" && (
        <Online
          go={go}
          signer={signer}
          cls={cls}
          name={name}
          onJoined={(m) => {
            setMember(m);
            setScreen("lobby");
          }}
        />
      )}
      {screen === "lobby" && member && (
        <Lobby
          member={member}
          identity={identity}
          cls={cls}
          setCls={setCls}
          onLeave={() => {
            member.watcher.stop();
            setMember(null);
            setScreen("online");
          }}
          onEnter={(s) => {
            hud.reset();
            setSession(s);
            setScreen("game");
          }}
        />
      )}
      {screen === "game" && session && (
        <GameView
          key={runId}
          session={session}
          onExit={leaveGame}
          member={member}
          onAgain={session.mode === "practice" ? () => startPractice(lastPractice.current.bots, lastPractice.current.quick) : undefined}
        />
      )}
      {screen === "hall" && <Hall go={go} identity={identity} />}
      {screen === "vault" && <Vault go={go} identity={identity} signer={signer} />}
      {screen === "replays" && <Replays onBack={() => go("menu")} />}
      {screen === "howto" && <HowTo go={go} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function phaseBadge(r: RoomInfo) {
  if (!r.ok) return <span className="tag">Sealed</span>;
  const w = r.world!;
  if (w.phase === PHASE.LOBBY) return <span className="tag green">Gathering {r.players.length}/4</span>;
  if (w.phase === PHASE.SEEDING) return <span className="tag arcane">Rolling VRF</span>;
  if (w.phase === PHASE.RUNNING) return <span className="tag gold">In run · {fmtTime(w.collapseTick - w.tick)}</span>;
  return <span className="tag blood">Ended{w.settled ? " · settled" : ""}</span>;
}

function Online({ go, signer, cls, name, onJoined }: { go: (s: Screen) => void; signer: Signer; cls: number; name: string; onJoined: (m: Membership) => void }) {
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const me = signer.publicKey.toBase58();
  const seen = useRef<Record<number, { tick: number; at: number }>>({});

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchRooms()
        .then((r) => {
          if (!alive) return;
          for (const room of r) {
            const t = room.world?.tick ?? -1;
            if (seen.current[room.id]?.tick !== t) seen.current[room.id] = { tick: t, at: Date.now() };
          }
          setRooms(r);
          setErr(null);
        })
        .catch((e) => alive && setErr(`Could not reach ${ER_RPC}: ${e.message || e}`));
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const join = async (r: RoomInfo) => {
    setBusy(r.id);
    setErr(null);
    sfx.ensure();
    try {
      // Rejoin an in-progress run with a stored session if we have one.
      let session = r.wallets.includes(me) ? restoreSession(r.id, me) : null;
      if (!session) session = await joinRoom(r.id, signer, cls, name || CLASSES[cls].name);
      const watcher = new RoomWatcher(r.id);
      watcher.start();
      onJoined({ room: r.id, session, watcher, wallet: me });
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const recycle = async (r: RoomInfo) => {
    setBusy(r.id);
    try {
      await resetRoom(r.id, guestKeypair());
    } catch (e: any) {
      const m = String(e.message || e);
      setErr(m.includes("WrongPhase") || m.includes("0x1770") ? `Crypt ${r.id + 1} is still in use — try again in a minute.` : m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(760px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            CRYPT ENTRANCES
          </h2>
          <button className="btn ghost small" onClick={() => go("menu")}>
            Back
          </button>
        </div>
        <p className="muted small">
          Each room is a match account delegated to a MagicBlock Ephemeral Rollup. Joining costs nothing: your wallet signs once to authorise a session key, and every move after
          that is a zero-fee rollup transaction. No wallet? You play as a local guest key.
        </p>
        {err && <div className="err">{err}</div>}
        {!rooms && !err && <div className="loading">CONTACTING THE ROLLUP…</div>}
        {rooms?.map((r) => {
          const w = r.world;
          const mine = r.wallets.includes(me);
          const canJoin = r.ok && w && ((w.phase === PHASE.LOBBY && r.players.length < 4) || mine);
          const frozen = !!w && w.phase === PHASE.RUNNING && seen.current[r.id]?.tick === w.tick && Date.now() - seen.current[r.id].at > 5000;
          const canRecycle = r.ok && w && (w.phase === PHASE.ENDED || (w.phase === PHASE.SEEDING && w.seedSrc === 0) || frozen);
          return (
            <div key={r.id} className="room-card px-slot">
              <div className="mono gold" style={{ width: 92, fontSize: 16, textShadow: "var(--sh)" }}>
                CRYPT {r.id + 1}
              </div>
              <div className="grow">
                {phaseBadge(r)}
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {r.players.map((p, i) => (
                    <span key={i} className="small" style={{ color: PLAYER_CSS[i] }}>
                      {p.name || CLASSES[p.cls].name}
                    </span>
                  ))}
                </div>
              </div>
              <a className="small" href={accountExplorer(r.pda, true)} target="_blank" rel="noreferrer">
                account
              </a>
              {canRecycle && (!mine || w!.phase === PHASE.ENDED || frozen) ? (
                <button className="btn small" disabled={busy !== null} onClick={() => recycle(r)}>
                  Reopen
                </button>
              ) : (
                <button className="btn small primary" disabled={!canJoin || busy !== null} onClick={() => join(r)}>
                  {busy === r.id ? "Signing…" : mine ? "Rejoin" : "Join"}
                </button>
              )}
            </div>
          );
        })}
        <div className="muted small" style={{ marginTop: 14 }}>
          Program{" "}
          <a href={accountExplorer(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            {PROGRAM_ID.toBase58().slice(0, 8)}…
          </a>{" "}
          · Rollup {new URL(ER_RPC).host}
        </div>
      </div>
    </div>
  );
}

function Lobby({ member, identity, cls, setCls, onLeave, onEnter }: { member: Membership; identity: string; cls: number; setCls: (n: number) => void; onLeave: () => void; onEnter: (s: GameSession) => void }) {
  const [snap, setSnap] = useState<RoomWatcher["latest"]>(member.watcher.latest);
  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const begun = useRef(false);
  const entered = useRef(false);
  useEffect(() => {
    const off = member.watcher.on((s) => setSnap({ ...s }));
    return () => {
      off();
    };
  }, [member]);

  const w = snap?.world;
  const slot = snap ? snap.header.wallets.findIndex((x) => x.toBase58() === identity) : -1;
  const isHost = w && slot >= 0 && w.host === slot;

  // Phase transitions
  useEffect(() => {
    if (!w || slot < 0) return;
    if (w.phase === PHASE.SEEDING && w.seedSrc === 1 && !begun.current) {
      begun.current = true;
      setStatus("Verified seed received — generating the dungeon from it…");
      const delay = isHost ? 0 : 1800;
      setTimeout(async () => {
        try {
          const live = member.watcher.latest?.world;
          if (live && live.phase === PHASE.SEEDING) await beginMatch(member.room, member.session);
          if (isHost) scheduleCrank(member.room, member.session).catch((e) => console.warn("crank schedule failed, clients will tick", e));
        } catch (e: any) {
          begun.current = false;
          if (!String(e.message).includes("WrongPhase")) setErr(e.message || String(e));
        }
      }, delay);
    }
    if ((w.phase === PHASE.RUNNING || w.phase === PHASE.ENDED) && !entered.current) {
      entered.current = true;
      ChainSession.create(member.room, slot, member.session, member.watcher).then(onEnter);
    }
  }, [w?.phase, w?.seedSrc, slot]);

  const start = async () => {
    setErr(null);
    setStatus("Requesting dungeon seed from MagicBlock VRF…");
    try {
      await startMatch(member.room, member.session);
    } catch (e: any) {
      setErr(e.message || String(e));
      setStatus("");
    }
  };

  if (!w) return <div className="screen loading" style={{ justifyContent: "center" }}>JOINING…</div>;
  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(780px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            CRYPT {member.room + 1} — {w.phase === PHASE.LOBBY ? "GATHERING" : w.phase === PHASE.SEEDING ? "ROLLING THE DUNGEON" : "IN PROGRESS"}
          </h2>
          {w.phase === PHASE.LOBBY && (
            <button
              className="btn ghost small"
              onClick={async () => {
                try {
                  await leaveRoom(member.room, member.session);
                } catch {
                  /* ignore */
                }
                onLeave();
              }}
            >
              Leave
            </button>
          )}
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: "stretch" }}>
          {[0, 1, 2, 3].map((i) => {
            const p = w.players[i];
            const empty = p.state === PS.EMPTY;
            return (
              <div key={i} className="class-card grow" style={{ cursor: "default", borderColor: empty ? undefined : PLAYER_CSS[i], minWidth: 150 }}>
                <div className="pedestal" style={{ height: 100 }}>
                  {empty ? <span className="muted mono small">EMPTY</span> : <Sprite base={`${HERO_SPRITES[p.cls][i % 2]}_idle_anim`} scale={3.5} />}
                </div>
                <div className="name" style={{ color: empty ? "#555" : PLAYER_CSS[i] }}>
                  {empty ? "—" : p.name || CLASSES[p.cls].name}
                </div>
                <div className="role">{empty ? "waiting…" : `${CLASSES[p.cls].name}${w.host === i ? " · HOST" : ""}${i === slot ? " · YOU" : ""}`}</div>
              </div>
            );
          })}
        </div>
        {w.phase === PHASE.LOBBY && slot >= 0 && (
          <>
            <h3>YOUR CLASS</h3>
            <div className="row">
              {CLASSES.map((c, i) => (
                <button
                  key={i}
                  className={`btn small ${w.players[slot].cls === i ? "primary" : ""}`}
                  onClick={async () => {
                    setCls(i);
                    try {
                      await setClassTx(member.room, member.session, i);
                    } catch (e: any) {
                      setErr(e.message);
                    }
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 20 }}>
          <div className="grow muted small">
            {status ||
              (w.phase === PHASE.LOBBY
                ? isHost
                  ? "You are the host. Start when your party is ready (1–4 players)."
                  : "Waiting for the host to start…"
                : w.phase === PHASE.SEEDING
                  ? "Waiting for the VRF oracle to deliver a verified seed…"
                  : "")}
            {err && <div className="err">{err}</div>}
          </div>
          {w.phase === PHASE.LOBBY && isHost && (
            <button className="btn primary big" onClick={start}>
              Open the Crypt
            </button>
          )}
          {w.phase === PHASE.SEEDING && isHost && w.seedSrc === 0 && (
            <button className="btn small" onClick={start}>
              Re-request VRF
            </button>
          )}
        </div>
        <div className="proof" style={{ marginTop: 16 }}>
          <b>CRYPT</b> {member.room + 1} · <b>NONCE</b> {w.nonce} · <b>SESSION KEY</b> {member.session.publicKey.toBase58().slice(0, 10)}… (signs
          gameplay; wallet signed once)
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GameView({ session, onExit, member, onAgain }: { session: GameSession; onExit: () => void; member: Membership | null; onAgain?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ w: World; me: number; award: RunAward; contracts: ContractResult[]; death: ReturnType<typeof hud.get>["death"] } | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const game: Phaser.Game = createGame(host.current!, session, {
      onEnd: (w, me) => {
        const contracts = hud.get().contracts;
        setResult({ w, me, award: awardRun(w, me, contracts), contracts, death: hud.get().death });
      },
      onPauseToggle: () => setPaused((p) => !p),
    });
    return () => game.destroy(true);
  }, [session]);

  useEffect(() => {
    if (session instanceof PracticeSession) session.setPaused(paused);
    hud.set({ paused });
  }, [paused, session]);

  // Online: once the run ends, the first client to notice settles on-chain.
  const [settle, setSettle] = useState<{ sig: string | null; err: string | null }>({ sig: null, err: null });
  const tried = useRef(false);
  const liveWorld = session.latest?.world;
  useEffect(() => {
    const w = liveWorld;
    if (!result || session.mode !== "online" || !member || !w || w.phase !== PHASE.ENDED || w.settled || tried.current) return;
    tried.current = true;
    setTimeout(() => {
      settleMatch(member.room, member.session)
        .then((sig) => setSettle({ sig, err: null }))
        .catch((e) => {
          const m = String(e.message || e);
          if (!m.includes("AlreadySettled") && !m.includes("0x1779")) setSettle({ sig: null, err: m });
        });
    }, 500 + result.me * 1200);
  }, [result, liveWorld?.phase, liveWorld?.settled]);

  // Keep results live (other players may still be in the run).
  const [live, setLive] = useState<World | null>(null);
  useEffect(() => {
    const off = session.onSnapshot((s) => setLive(s.world));
    return () => {
      off();
    };
  }, [session]);

  return (
    <div className="game-wrap" onContextMenu={(e) => e.preventDefault()}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {!result && <Hud session={session} />}
      {paused && !result && (
        <div className="overlay">
          <div className="panel" style={{ width: 380 }}>
            <h2>{session.mode === "practice" ? "PAUSED" : "MENU"}</h2>
            {session.mode === "online" && <p className="muted small">The run continues on-chain while this menu is open.</p>}
            <Settings />
            <div className="menu" style={{ marginTop: 16, width: "100%" }}>
              <button className="btn primary" onClick={() => setPaused(false)}>
                Resume
              </button>
              <button className="btn danger" onClick={onExit}>
                {session.mode === "practice" ? "Abandon run" : "Leave match"}
              </button>
            </div>
          </div>
        </div>
      )}
      {result && <ResultsScroll world={live || result.w} me={result.me} session={session} settle={settle} onExit={onExit} onAgain={onAgain} award={result.award} contracts={result.contracts} death={result.death} />}
    </div>
  );
}

function Settings() {
  const [v, setV] = useState(sfx.volume);
  const [m, setM] = useState(sfx.musicVolume);
  return (
    <div>
      <h3>AUDIO</h3>
      <div className="row small">
        <span style={{ width: 70 }}>Effects</span>
        <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => (setV(+e.target.value), sfx.setVolume(+e.target.value))} className="grow" />
      </div>
      <div className="row small">
        <span style={{ width: 70 }}>Ambience</span>
        <input type="range" min={0} max={1} step={0.05} value={m} onChange={(e) => (setM(+e.target.value), sfx.setMusic(+e.target.value))} className="grow" />
      </div>
      <h3>CONTROLS</h3>
      <div className="small muted" style={{ lineHeight: 1.9 }}>
        <span className="kbd">WASD</span>move <span className="kbd">LMB</span>attack <span className="kbd">RMB</span>special <span className="kbd">SPACE</span>dodge <span className="kbd">E</span>
        interact <span className="kbd">Q</span>potion <span className="kbd">TAB</span>pack <span className="kbd">M</span>map
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hall({ go, identity }: { go: (s: Screen) => void; identity: string }) {
  const [data, setData] = useState<{ totalRuns: number; totalExtracted: number; entries: HallEntry[] } | null | undefined>(undefined);
  const [sort, setSort] = useState<"total" | "best" | "extractions" | "pvpKills">("total");
  useEffect(() => {
    fetchHall().then(setData).catch(() => setData(null));
  }, []);
  const rows = (data?.entries || []).slice().sort((a, b) => (b as any)[sort] - (a as any)[sort]);
  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(820px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            HALL OF FAME
          </h2>
          <button className="btn ghost small" onClick={() => go("menu")}>
            Back
          </button>
        </div>
        <p className="muted small">Read live from the on-chain Hall account. Every settled match writes here and commits to Solana.</p>
        {data === undefined && <div className="loading">READING THE HALL…</div>}
        {data === null && <div className="muted">The Hall is empty or unreachable. Be the first to escape.</div>}
        {data && (
          <>
            <div className="row small muted" style={{ marginBottom: 10 }}>
              <span>
                Runs settled: <b className="gold">{data.totalRuns}</b>
              </span>
              <span>
                Total gold extracted: <b className="gold">{data.totalExtracted}</b>
              </span>
            </div>
            <div className="tabs">
              {(
                [
                  ["total", "Total gold"],
                  ["best", "Best run"],
                  ["extractions", "Escapes"],
                  ["pvpKills", "Betrayals"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={`btn small ${sort === k ? "primary" : ""}`} onClick={() => setSort(k)}>
                  {l}
                </button>
              ))}
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>#</th>
                  <th>NAME</th>
                  <th>WALLET</th>
                  <th className="num">RUNS</th>
                  <th className="num">ESCAPES</th>
                  <th className="num">KILLS</th>
                  <th className="num">BETRAYALS</th>
                  <th className="num">BEST</th>
                  <th className="num">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={e.wallet} className={e.wallet === identity ? "me" : ""}>
                    <td>{i + 1}</td>
                    <td className="gold">{e.name || "—"}</td>
                    <td className="mono small muted">
                      <a href={accountExplorer(e.wallet)} target="_blank" rel="noreferrer">
                        {e.wallet.slice(0, 4)}…{e.wallet.slice(-4)}
                      </a>
                    </td>
                    <td className="num">{e.runs}</td>
                    <td className="num">{e.extractions}</td>
                    <td className="num">{e.kills}</td>
                    <td className="num red">{e.pvpKills}</td>
                    <td className="num">{e.best}</td>
                    <td className="num gold">{e.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function Vault({ go, identity, signer }: { go: (s: Screen) => void; identity: string; signer: Signer }) {
  const [relics, setRelics] = useState<Relic[] | null>(null);
  const [all, setAll] = useState(false);
  const [chain, setChain] = useState<RelicChainState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; asset?: string } | null>(null);
  const refresh = useCallback(async () => {
    const rs = await fetchRelics().catch(() => [] as Relic[]);
    setRelics(rs);
    setChain(await fetchRelicChainState(rs).catch(() => null));
  }, []);
  useEffect(() => {
    refresh();
    // Settled relics reach Solana a few seconds after the rollup commit.
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);
  const claim = async (r: Relic) => {
    const key = `${r.page}-${r.index}`;
    sfx.click();
    setBusy(key);
    setNote(null);
    try {
      const [, asset] = await claimRelic(r, signer);
      sfx.legendary();
      setNote({ ok: true, text: `${RARITY_NAMES[r.rarity]} ${ITEM_NAMES[r.kind]} minted to your wallet.`, asset });
      await refresh();
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message || e).slice(0, 180) });
    } finally {
      setBusy(null);
    }
  };
  const list = (relics || []).filter((r) => all || r.owner === identity).sort((a, b) => b.rarity - a.rarity || b.value - a.value);
  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(820px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            RELIC VAULT
          </h2>
          <button className={`btn small ${!all ? "primary" : ""}`} onClick={() => setAll(false)}>
            Mine
          </button>
          <button className={`btn small ${all ? "primary" : ""}`} onClick={() => setAll(true)}>
            All
          </button>
          <button className="btn ghost small" onClick={() => go("menu")}>
            Back
          </button>
        </div>
        <p className="muted small">
          Rare, Epic and Legendary items you carry out of the crypt become relics recorded on-chain under your wallet, with the VRF seed of the run that produced them. Claim
          one to mint it as a Metaplex Core NFT in your wallet, free: the game sponsors the mint.
        </p>
        {note && (
          <div className={`claim-note ${note.ok ? "ok" : "err"}`}>
            {note.text}{" "}
            {note.asset && (
              <a href={accountExplorer(note.asset)} target="_blank" rel="noreferrer">
                View NFT ↗
              </a>
            )}
          </div>
        )}
        {!relics && <div className="loading">OPENING THE VAULT…</div>}
        {relics && list.length === 0 && <div className="muted">{all ? "No relics have been extracted yet." : "You own no relics yet. Extract a Rare or better item."}</div>}
        <div className="items" style={{ marginTop: 10 }}>
          {list.map((r) => (
            <div key={`${r.page}-${r.index}`} className="item" style={{ borderColor: RARITY_CSS[r.rarity], minWidth: 250 }}>
              <ItemIcon kind={r.kind} rarity={r.rarity} scale={3} />
              <div>
                <div style={{ color: RARITY_CSS[r.rarity] }}>
                  {RARITY_NAMES[r.rarity]} {ITEM_NAMES[r.kind]}
                </div>
                <div className="muted small">
                  {r.value} gold · crypt {r.room + 1} · run #{r.nonce}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "#6f6480" }}>
                  seed {r.seed8}… · owner {r.owner.slice(0, 4)}…{r.owner.slice(-4)}
                </div>
                <RelicClaim r={r} chain={chain} mine={r.owner === identity} busy={busy} onClaim={claim} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RelicClaim({ r, chain, mine, busy, onClaim }: { r: Relic; chain: RelicChainState | null; mine: boolean; busy: string | null; onClaim: (r: Relic) => void }) {
  const key = `${r.page}-${r.index}`;
  if (!chain) return null;
  if (chain.minted.has(key))
    return (
      <a className="nft-tag" href={accountExplorer(relicAssetPda(r.page, r.index).toBase58())} target="_blank" rel="noreferrer">
        ◆ NFT ON SOLANA ↗
      </a>
    );
  if (!mine) return null;
  if (!chain.synced.has(key)) return <div className="muted small">Syncing to Solana…</div>;
  return (
    <button className="btn small primary" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => onClaim(r)}>
      {busy === key ? "Minting…" : "Claim NFT"}
    </button>
  );
}

function HowTo({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="screen" style={{ paddingTop: 70 }}>
      <div className="panel" style={{ width: "min(900px, 100%)" }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            HOW TO SURVIVE THE HOLLOW
          </h2>
          <button className="btn ghost small" onClick={() => go("menu")}>
            Back
          </button>
        </div>
        <div className="howto" style={{ marginTop: 10 }}>
          <div>
            <h3>THE RUN</h3>
            <ul>
              <li>Up to four adventurers enter a crypt generated from a MagicBlock VRF seed.</li>
              <li>Open chests (each roll is its own VRF request), slay monsters, find the vault key.</li>
              <li>
                Everything you carry is <b className="gold">unbanked</b>. Die and it spills on the floor for anyone to take.
              </li>
              <li>
                At <b className="violet">3:00</b> the portals open. Stand in one for 4 seconds to escape. Taking damage interrupts you.
              </li>
              <li>
                At <b className="red">6:00</b> the crypt collapses. Anyone still inside loses everything.
              </li>
            </ul>
            <h3>COOPERATE OR BETRAY</h3>
            <ul>
              <li>Attacks hit everyone — monsters and players. Fireballs burn friends too.</li>
              <li>Everyone who damages the Hollow King gets their own reward from his hoard.</li>
              <li>Killing a rival spills their loot. The crypt calls it betrayal and announces it.</li>
            </ul>
          </div>
          <div>
            <h3>CONTROLS</h3>
            <div style={{ lineHeight: 2.2 }}>
              <div>
                <span className="kbd">W A S D</span> move
              </div>
              <div>
                <span className="kbd">MOUSE</span> aim · <span className="kbd">LMB</span> attack (hold)
              </div>
              <div>
                <span className="kbd">RMB</span> class special
              </div>
              <div>
                <span className="kbd">SPACE</span> dodge roll (brief invulnerability)
              </div>
              <div>
                <span className="kbd">E</span> open chest / unlock vault
              </div>
              <div>
                <span className="kbd">Q</span> drink potion · <span className="kbd">TAB</span> pack · <span className="kbd">M</span> big map
              </div>
            </div>
            <h3>READ THE DANGER</h3>
            <ul>
              <li>Red wedges and rings on the floor are incoming attacks. Dodge out of them.</li>
              <li>Purple lines are Bone Caller shots. Brutes and the King slam in a circle.</li>
              <li>Corruption rises over time: monsters hit harder and your light shrinks.</li>
            </ul>
            <h3>ON-CHAIN</h3>
            <ul>
              <li>Each match is a delegated account on a MagicBlock Ephemeral Rollup: zero-fee, real-time.</li>
              <li>Your wallet signs once; a session key signs every move.</li>
              <li>The world tick runs on a MagicBlock crank — no game server.</li>
              <li>Results and relics are committed back to Solana.</li>
              <li>Claim any relic in the Relic Vault to mint it as a Metaplex Core NFT. The game sponsors the mint.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
