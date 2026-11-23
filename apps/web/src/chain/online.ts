import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { ER_RPC, ER_WS, BASE_RPC, ROOM_COUNT, VAULT_PAGES } from "./config";
import * as P from "./program";
import { decodeWorld, World, PHASE, PS } from "../game/world";
import { loadWasm, type ChainStats, type GameSession, type Snapshot } from "../game/session";
import { Sim } from "../wasm/ez_wasm.js";

export const er = new Connection(ER_RPC, { wsEndpoint: ER_WS, commitment: "processed" });
export const base = new Connection(BASE_RPC, { commitment: "confirmed" });

/** Anything that can sign a transaction: a guest keypair or a wallet adapter. */
export interface Signer {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export function keypairSigner(kp: Keypair): Signer {
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(kp);
      return tx;
    },
  };
}

const GUEST_KEY = "exitzero.guest.v1";
export function guestKeypair(): Keypair {
  try {
    const s = localStorage.getItem(GUEST_KEY);
    if (s) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  } catch {
    /* ignore */
  }
  const kp = Keypair.generate();
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(Array.from(kp.secretKey)));
  } catch {
    /* private mode: session-only guest */
  }
  return kp;
}

let bh: { hash: string; at: number } | null = null;
async function blockhash() {
  if (!bh || Date.now() - bh.at > 20_000) {
    const r = await er.getLatestBlockhash("processed");
    bh = { hash: r.blockhash, at: Date.now() };
  }
  return bh.hash;
}

let uniq = 0;
export async function sendEr(ixs: TransactionInstruction[], payer: PublicKey, sign: (tx: Transaction) => Promise<Transaction>, confirm = false) {
  const tx = new Transaction();
  // Identical actions within one blockhash would produce identical signatures and be
  // dropped as duplicates; a varying compute limit makes every transaction unique.
  const hasBudget = ixs.some((i) => i.programId.equals(ComputeBudgetProgram.programId));
  if (!hasBudget) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + (uniq++ % 50_000) }));
  else {
    ixs = ixs.map((i) => {
      if (!i.programId.equals(ComputeBudgetProgram.programId)) return i;
      const units = i.data.readUInt32LE(1) - (uniq++ % 5_000);
      return ComputeBudgetProgram.setComputeUnitLimit({ units });
    });
  }
  tx.add(...ixs);
  tx.feePayer = payer;
  tx.recentBlockhash = await blockhash();
  const signed = await sign(tx);
  const sig = await er.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 });
  if (confirm) {
    const res = await er.confirmTransaction(sig, "processed");
    if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)} (${sig})`);
  }
  return sig;
}

export interface RoomInfo {
  id: number;
  pda: string;
  ok: boolean;
  world: World | null;
  wallets: string[];
  players: { name: string; cls: number; state: number; wallet: string }[];
}

export async function fetchRooms(): Promise<RoomInfo[]> {
  await loadWasm();
  const pdas = Array.from({ length: ROOM_COUNT }, (_, i) => P.roomPda(i));
  const infos = await er.getMultipleAccountsInfo(pdas, "processed");
  return infos.map((info, id) => {
    const dec = info ? P.decodeRoom(info.data) : null;
    if (!dec) return { id, pda: pdas[id].toBase58(), ok: false, world: null, wallets: [], players: [] };
    const world = decodeWorld(dec.world);
    const wallets = dec.header.wallets.map((w) => w.toBase58());
    return {
      id,
      pda: pdas[id].toBase58(),
      ok: true,
      world,
      wallets,
      players: world.players.map((p, i) => ({ name: p.name, cls: p.cls, state: p.state, wallet: wallets[i] })).filter((p) => p.state !== PS.EMPTY),
    };
  });
}

export async function fetchHall() {
  const info = await er.getAccountInfo(P.hallPda(), "processed").catch(() => null);
  const fromEr = info ? P.decodeHall(info.data) : null;
  if (fromEr) return fromEr;
  const b = await base.getAccountInfo(P.hallPda()).catch(() => null);
  return b ? P.decodeHall(b.data) : null;
}

export async function fetchRelics() {
  const pdas = Array.from({ length: VAULT_PAGES }, (_, i) => P.vaultPda(i));
  const infos = await er.getMultipleAccountsInfo(pdas, "processed").catch(() => [] as any[]);
  const out: P.Relic[] = [];
  for (const i of infos) {
    const v = i ? P.decodeVault(i.data) : null;
    if (v) out.push(...v.relics);
  }
  return out;
}

/** Live room subscription used by both the lobby and the match. */
export class RoomWatcher {
  latest: { world: World; bytes: Uint8Array; header: P.RoomHeader; at: number } | null = null;
  private subs = new Set<(s: NonNullable<RoomWatcher["latest"]>) => void>();
  private subId: number | null = null;
  private poll: number | null = null;
  private lastUpdate = 0;
  constructor(public room: number) {}

  async start() {
    await loadWasm();
    const pda = P.roomPda(this.room);
    this.subId = er.onAccountChange(pda, (acc) => this.ingest(acc.data), { commitment: "processed" });
    const refresh = async () => {
      if (Date.now() - this.lastUpdate < 600) return;
      const acc = await er.getAccountInfo(pda, "processed").catch(() => null);
      if (acc) this.ingest(acc.data);
    };
    refresh();
    this.poll = window.setInterval(refresh, 300);
  }

  private ingest(data: Uint8Array) {
    const dec = P.decodeRoom(data);
    if (!dec) return;
    const world = decodeWorld(dec.world);
    // Ignore out-of-order updates.
    if (this.latest && this.latest.world.nonce === world.nonce && world.phase === this.latest.world.phase && world.tick < this.latest.world.tick) return;
    this.lastUpdate = Date.now();
    this.latest = { world, bytes: dec.world, header: dec.header, at: performance.now() };
    this.subs.forEach((cb) => cb(this.latest!));
  }

  on(cb: (s: NonNullable<RoomWatcher["latest"]>) => void) {
    this.subs.add(cb);
    if (this.latest) cb(this.latest);
    return () => this.subs.delete(cb);
  }

  stop() {
    if (this.subId !== null) er.removeAccountChangeListener(this.subId).catch(() => {});
    if (this.poll) clearInterval(this.poll);
    this.subs.clear();
  }
}

export interface Membership {
  room: number;
  wallet: Signer;
  session: Keypair;
  slot: number;
}

const SESSION_KEY = (room: number, wallet: string) => `exitzero.session.${room}.${wallet}`;

/** Wallet signs once: joins the room and authorises a fresh session key for 2 hours. */
export async function joinRoom(room: number, wallet: Signer, cls: number, name: string): Promise<Keypair> {
  const session = Keypair.generate();
  const exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const sig = await sendEr([P.ixJoin(wallet.publicKey, room, cls, name, session.publicKey, exp)], wallet.publicKey, wallet.signTransaction, true);
  try {
    sessionStorage.setItem(SESSION_KEY(room, wallet.publicKey.toBase58()), JSON.stringify(Array.from(session.secretKey)));
  } catch {
    /* ignore */
  }
  console.info("joined", room, sig);
  return session;
}

export function restoreSession(room: number, wallet: string): Keypair | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY(room, wallet));
    return s ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s))) : null;
  } catch {
    return null;
  }
}

export const sessionSigner = (kp: Keypair) => keypairSigner(kp);

export async function sessionTx(session: Keypair, ixs: TransactionInstruction[], confirm = false) {
  return sendEr(ixs, session.publicKey, keypairSigner(session).signTransaction, confirm);
}

/**
 * On-chain match session. Inputs are sent as session-key-signed transactions to
 * the Ephemeral Rollup; the room account subscription streams the world back.
 */
export class ChainSession implements GameSession {
  readonly mode = "online" as const;
  latest: Snapshot | null = null;
  stats: ChainStats;
  private subs = new Set<(s: Snapshot) => void>();
  private sim: Sim | null = null;
  private unwatch: () => void;
  private tickTimer: number;
  private lastTickSeen = { tick: -1, at: 0 };
  private sentSamples = 0;

  constructor(public readonly room: number, public readonly me: number, private session: Keypair, private watcher: RoomWatcher) {
    this.stats = {
      txSent: 0, txOk: 0, txFail: 0, lastLatency: 0, avgLatency: 0, vrfRequests: 0, vrfFulfilled: 0, ticksSeen: 0,
      endpoint: ER_RPC, room: P.roomPda(room).toBase58(), lastSig: "", crank: "starting",
    };
    this.unwatch = watcher.on((s) => this.ingest(s.world, s.bytes, s.at));
    this.tickTimer = window.setInterval(() => this.fallbackTick(), 120);
  }

  static async create(room: number, me: number, session: Keypair, watcher: RoomWatcher) {
    await loadWasm();
    return new ChainSession(room, me, session, watcher);
  }

  private ingest(world: World, bytes: Uint8Array, at: number) {
    if (!this.sim) this.sim = Sim.load(bytes);
    else this.sim.replace(bytes);
    if (world.tick !== this.lastTickSeen.tick) {
      this.lastTickSeen = { tick: world.tick, at: performance.now() };
      this.stats.ticksSeen++;
    }
    // Count VRF fulfilments from the event log.
    const snap = { world, bytes, at };
    this.latest = snap;
    this.subs.forEach((cb) => cb(snap));
  }

  /** If the crank stalls, the lowest-index living player nudges the world forward. */
  private fallbackTick() {
    const w = this.latest?.world;
    if (!w || w.phase !== PHASE.RUNNING) return;
    const stalled = performance.now() - this.lastTickSeen.at > 260;
    this.stats.crank = stalled ? "client fallback" : "MagicBlock crank / peers";
    if (!stalled) return;
    const leader = w.players.findIndex((p) => p.state === PS.ALIVE);
    const myTurn = leader === this.me || performance.now() - this.lastTickSeen.at > 900;
    if (myTurn) this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), P.ixTick(this.room)], false);
  }

  private send(ixs: TransactionInstruction[], measure = true) {
    this.stats.txSent++;
    const t0 = performance.now();
    const sample = measure && this.sentSamples++ % 8 === 0;
    sendEr(ixs, this.session.publicKey, keypairSigner(this.session).signTransaction, sample)
      .then((sig) => {
        this.stats.txOk++;
        this.stats.lastSig = sig;
        if (sample) {
          const ms = performance.now() - t0;
          this.stats.lastLatency = ms;
          this.stats.avgLatency = this.stats.avgLatency ? this.stats.avgLatency * 0.8 + ms * 0.2 : ms;
        }
      })
      .catch((e) => {
        this.stats.txFail++;
        console.warn("tx failed", e);
      });
  }

  onSnapshot(cb: (s: Snapshot) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  move(x: number, y: number, aim: number, moving: boolean) {
    this.send([P.ixMove(this.session.publicKey, this.room, Math.round(x), Math.round(y), aim, moving)]);
  }
  combat(kind: 0 | 1 | 2 | 3, aim: number) {
    this.send([P.ixCombat(this.session.publicKey, this.room, kind, aim)]);
  }
  interact() {
    this.stats.vrfRequests++;
    this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), P.ixInteract(this.session.publicKey, this.room, Math.floor(Math.random() * 256))]);
  }
  slide(x: number, y: number, dx: number, dy: number): [number, number] {
    if (!this.sim) return [x + dx, y + dy];
    const r = this.sim.slide(Math.round(x), Math.round(y), Math.round(dx), Math.round(dy));
    return [r[0], r[1]];
  }
  destroy() {
    clearInterval(this.tickTimer);
    this.unwatch();
    this.subs.clear();
    this.sim?.free();
  }
}

/** Host: lock lobby and request the VRF dungeon seed. */
export async function startMatch(room: number, session: Keypair) {
  return sessionTx(session, [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), P.ixStart(session.publicKey, room, Math.floor(Math.random() * 256))], true);
}

/** Generate the dungeon from the verified seed (heavy: full compute budget). */
export async function beginMatch(room: number, session: Keypair) {
  return sessionTx(session, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), P.ixBegin(session.publicKey, room)], true);
}

export async function scheduleCrank(room: number, session: Keypair) {
  const task = Math.floor(Math.random() * 2 ** 40);
  return sessionTx(session, [P.ixScheduleTicks(session.publicKey, room, task, 100, 6000)], true);
}

export async function settleMatch(room: number, session: Keypair) {
  // Pick a vault page with space (best effort: page 0 first).
  const relics = await fetchRelics().catch(() => []);
  const counts = new Map<number, number>();
  for (const r of relics) counts.set(r.page, (counts.get(r.page) || 0) + 1);
  let page = 0;
  for (let p = 0; p < VAULT_PAGES; p++) {
    if ((counts.get(p) || 0) < 90) {
      page = p;
      break;
    }
  }
  return sessionTx(session, [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), P.ixSettle(session.publicKey, room, page)], true);
}

export async function resetRoom(room: number, payer: Keypair) {
  return sessionTx(payer, [P.ixReset(room)], true);
}

export async function setClass(room: number, session: Keypair, cls: number) {
  return sessionTx(session, [P.ixSetClass(session.publicKey, room, cls)], true);
}

export async function leaveRoom(room: number, session: Keypair) {
  return sessionTx(session, [P.ixLeave(session.publicKey, room)], true);
}
