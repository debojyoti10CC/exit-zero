// Verifiable on-chain replay.
//
// A match lives in its room account on the MagicBlock rollup. Every change to it
// is a transaction: joins, the VRF seed callback, `begin`, every crank `tick`,
// every move/attack/interact, every chest VRF callback and finally `settle`.
// The program logs a receipt after `begin`, after every `tick` and at `settle`:
// the first 8 bytes of sha256 of the world. This loader downloads all of the
// match's transactions from the rollup, re-applies them in order with the same
// Rust core compiled to WASM, and checks every receipt byte-exact.
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import idl from "../chain/exit_zero.json";
import { er } from "../chain/online";
import * as P from "../chain/program";
import { PROGRAM_ID, ROOM_COUNT } from "../chain/config";
import { loadWasm } from "../game/session";
import { decodeWorld, PS } from "../game/world";
import { Replay } from "../wasm/ez_wasm.js";

const NAMES: Record<string, string> = {};
for (const ix of (idl as any).instructions) NAMES[Buffer.from(ix.discriminator).toString("hex")] = ix.name;
const ROOMS = Array.from({ length: ROOM_COUNT }, (_, i) => P.roomPda(i).toBase58());
const PID = PROGRAM_ID.toBase58();

export interface MatchRef {
  room: number;
  settleSig: string;
  slot: number;
  time: number | null;
  nonce: number;
  finalHash: string;
}

interface Receipt {
  tag: "b" | "t" | "s";
  n: number;
  hash: string;
}

/** One program instruction applied to the room, in execution order. */
interface Op {
  name: string;
  keys: string[];
  data: Uint8Array;
  receipt?: Receipt;
  sig: string;
  slot: number;
}

function receiptsOf(logs: string[] | null | undefined): Receipt[] {
  const out: Receipt[] = [];
  for (const l of logs || []) {
    const m = /^Program log: xz:([bts]) (\d+) ([0-9a-f]{16})$/.exec(l);
    if (m) out.push({ tag: m[1] as Receipt["tag"], n: Number(m[2]), hash: m[3] });
  }
  return out;
}

/** Our program's instructions in a transaction (top level and CPI), in execution order. */
function opsOf(tx: VersionedTransactionResponse, sig: string): Op[] {
  const msg: any = tx.transaction.message;
  const keys: string[] = (msg.staticAccountKeys || msg.accountKeys).map((k: PublicKey) => k.toBase58());
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) keys.push(...loaded.writable.map((k) => k.toBase58()), ...loaded.readonly.map((k) => k.toBase58()));
  const inner = new Map<number, any[]>();
  for (const g of tx.meta?.innerInstructions || []) inner.set(g.index, g.instructions as any[]);
  const out: Op[] = [];
  const push = (programIdIndex: number, accounts: number[], data: Uint8Array) => {
    if (keys[programIdIndex] !== PID || data.length < 8) return;
    const name = NAMES[Buffer.from(data.subarray(0, 8)).toString("hex")];
    if (name) out.push({ name, keys: accounts.map((a) => keys[a]), data: data.subarray(8), sig, slot: tx.slot });
  };
  msg.compiledInstructions.forEach((c: any, i: number) => {
    push(c.programIdIndex, c.accountKeyIndexes, c.data);
    for (const ic of inner.get(i) || []) push(ic.programIdIndex, ic.accounts, bs58.decode(ic.data));
  });
  // Attach receipts in log order to the ops that emit them.
  const rs = receiptsOf(tx.meta?.logMessages);
  for (const op of out) {
    const want = op.name === "begin" ? "b" : op.name === "tick" ? "t" : op.name === "settle" ? "s" : null;
    if (want && rs[0]?.tag === want) op.receipt = rs.shift();
  }
  return out;
}

async function fetchTxs(sigs: string[], onBatch?: (n: number) => void) {
  const out: (VersionedTransactionResponse | null)[] = new Array(sigs.length).fill(null);
  const B = 50;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < sigs.length) {
      const i = next;
      next += B;
      const chunk = sigs.slice(i, i + B);
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await er.getTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
          res.forEach((t, j) => (out[i + j] = t as VersionedTransactionResponse | null));
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      done += chunk.length;
      onBatch?.(done);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

/** Recently settled matches (every settle touches the Hall), newest first. */
export async function listMatches(limit = 40): Promise<MatchRef[]> {
  const sigs = (await er.getSignaturesForAddress(P.hallPda(), { limit }, "confirmed")).filter((s) => !s.err);
  const txs = await fetchTxs(sigs.map((s) => s.signature));
  const out: MatchRef[] = [];
  txs.forEach((tx, i) => {
    if (!tx || tx.meta?.err) return;
    for (const op of opsOf(tx, sigs[i].signature)) {
      if (op.name !== "settle" || !op.receipt) continue;
      const room = ROOMS.indexOf(op.keys[1]);
      if (room < 0) continue;
      out.push({ room, settleSig: op.sig, slot: tx.slot, time: tx.blockTime ?? null, nonce: op.receipt.n, finalHash: op.receipt.hash });
    }
  });
  return out;
}

export interface Frame {
  tick: number;
  bytes: Uint8Array;
  ok: boolean;
}

export interface ReplayResult {
  match: MatchRef;
  frames: Frame[];
  txCount: number;
  ops: number;
  ticksChecked: number;
  ticksMatched: number;
  firstMismatch: number | null;
  beginOk: boolean;
  settleOk: boolean;
  verified: boolean;
  wallets: string[];
}

async function hash8(bytes: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Downloads every transaction of a match from the rollup, newest to oldest
 * until the reset that opened its lobby, then re-simulates and verifies it.
 */
export async function loadReplay(m: MatchRef, progress: (stage: string, frac: number) => void): Promise<ReplayResult> {
  await loadWasm();
  const room = P.roomPda(m.room);
  // 1. Signatures from the settle back to the lobby reset.
  progress("Finding the match on the rollup", 0);
  const sigs: string[] = [];
  let before: string | undefined = m.settleSig;
  sigs.push(m.settleSig);
  const ops: Op[] = [];
  let fetched = 0;
  let foundBegin = false;
  let done = false;
  while (!done) {
    const page = await er.getSignaturesForAddress(room, { before, limit: 1000 }, "confirmed");
    if (!page.length) break;
    before = page[page.length - 1].signature;
    const ok = page.filter((s) => !s.err).map((s) => s.signature);
    const list = fetched === 0 ? [m.settleSig, ...ok] : ok;
    const txs = await fetchTxs(list, (n) =>
      progress(`Downloading transactions (${(fetched + n).toLocaleString()})`, Math.min(0.9, (fetched + n) / 8000)),
    );
    fetched += txs.length;
    // Newest first: collect ops until the reset that opened this match's lobby.
    const pageOps: Op[][] = [];
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx || tx.meta?.err) continue;
      const sig = list[i];
      const o = opsOf(tx, sig).filter((op) => op.keys.includes(room.toBase58()));
      if (o.some((op) => op.name === "begin")) foundBegin = true;
      if (foundBegin && o.some((op) => op.name === "reset" || op.name === "create_room")) {
        // Keep anything after the reset inside this same transaction (none in practice).
        done = true;
        break;
      }
      if (foundBegin && o.some((op) => op.name === "settle") && sig !== m.settleSig) {
        done = true; // previous match ended without a reset in between
        break;
      }
      pageOps.push(o);
    }
    for (const o of pageOps) ops.push(...o.reverse());
    if (page.length < 1000) break;
  }
  ops.reverse();

  // 2. Re-simulate from the reset, checking every receipt.
  progress("Re-simulating every tick in WASM", 0.92);
  const r = new Replay(m.nonce);
  const frames: Frame[] = [];
  let ticksChecked = 0;
  let ticksMatched = 0;
  let firstMismatch: number | null = null;
  let beginOk = false;
  let settleOk = false;
  const wallets: string[] = ["", "", "", ""];
  const k = (s: string) => new PublicKey(s).toBytes();
  for (const op of ops) {
    const d = op.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    switch (op.name) {
      case "join": {
        const before = decodeWorld(r.bytes()).players.map((p) => p.state);
        if (r.join(k(op.keys[0]), d[0], d.subarray(1, 13), d.subarray(13, 45))) {
          // Record which wallet took which slot (for the player picker).
          decodeWorld(r.bytes()).players.forEach((p, s) => {
            if (p.state !== PS.EMPTY && before[s] === PS.EMPTY) wallets[s] = op.keys[0];
          });
        }
        break;
      }
      case "set_class":
        r.set_class(k(op.keys[0]), d[0]);
        break;
      case "leave":
        r.leave(k(op.keys[0]));
        break;
      case "start":
        r.start(k(op.keys[0]));
        break;
      case "seed_callback":
        r.seed(d.subarray(0, 32));
        break;
      case "begin":
        r.begin(k(op.keys[0]));
        if (op.receipt) beginOk = (await hash8(r.bytes())) === op.receipt.hash;
        frames.push({ tick: r.tick_count(), bytes: r.bytes(), ok: beginOk });
        break;
      case "tick":
        if (op.receipt) {
          r.tick();
          const b = r.bytes();
          const ok = (await hash8(b)) === op.receipt.hash && r.tick_count() === op.receipt.n;
          ticksChecked++;
          if (ok) ticksMatched++;
          else if (firstMismatch === null) firstMismatch = op.receipt.n;
          frames.push({ tick: r.tick_count(), bytes: b, ok });
        }
        break;
      case "move_to":
        r.act_move(k(op.keys[0]), dv.getInt32(0, true), dv.getInt32(4, true), d[8], d[9]);
        break;
      case "combat":
        r.combat(k(op.keys[0]), d[0], d[1]);
        break;
      case "interact":
        r.interact(k(op.keys[0]));
        break;
      case "chest_callback":
        r.chest(d.subarray(0, 32), d[32]);
        break;
      case "settle":
        r.settle();
        if (op.receipt) settleOk = (await hash8(r.bytes())) === op.receipt.hash;
        break;
    }
  }
  r.free();
  progress("Done", 1);
  return {
    match: m,
    frames,
    txCount: fetched,
    ops: ops.length,
    ticksChecked,
    ticksMatched,
    firstMismatch,
    beginOk,
    settleOk,
    verified: beginOk && settleOk && ticksChecked > 0 && ticksMatched === ticksChecked,
    wallets,
  };
}
