// End-to-end check against the live rollup with throwaway 0-SOL keys:
// join → start (VRF seed) → begin (dungeon gen) → crank → move/attack → chest VRF.
// Usage: node scripts/smoke-online.mjs [roomId]
import fs from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync(new URL("../src/chain/exit_zero.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const ER = process.env.ER_RPC || "https://devnet-as.magicblock.app";
const er = new Connection(ER, { commitment: "processed", wsEndpoint: ER.replace("https", "wss") });
const ROOM = Number(process.argv[2] ?? 5);
const disc = Object.fromEntries(idl.instructions.map((i) => [i.name, Buffer.from(i.discriminator)]));
const enc = (s) => Buffer.from(s);
const pda = (seeds, prog = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const room = pda([enc("room2"), Buffer.from([ROOM])]);
const identity = pda([enc("identity")]);
const VRF = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const MAGIC = new PublicKey("Magic11111111111111111111111111111111111111");
const w = (k, s = false) => ({ pubkey: k, isSigner: s, isWritable: true });
const r = (k, s = false) => ({ pubkey: k, isSigner: s, isWritable: false });
const ix = (keys, name, data = Buffer.alloc(0)) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc[name], data]) });
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };

async function send(ixs, signer, label, confirm = true) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  const t0 = Date.now();
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  if (confirm) {
    const res = await er.confirmTransaction(sig, "processed");
    const logs = (await er.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null))?.meta?.logMessages;
    if (res.value.err) {
      console.log(`  ✗ ${label} ${JSON.stringify(res.value.err)} ${sig}`);
      if (logs) console.log("    " + logs.slice(-8).join("\n    "));
      return null;
    }
    console.log(`  ✓ ${label} ${Date.now() - t0}ms ${sig.slice(0, 16)}…`);
  }
  return sig;
}

const WORLD_OFFSET = 320;
async function world() {
  const a = await er.getAccountInfo(room, "processed");
  const d = a.data.subarray(WORLD_OFFSET);
  // repr(C) offsets: phase@1 seed@8 seed_src@40 tick@44 players@100 (x@+8, y@+12)
  return { phase: d[1], seedSrc: d[40], tick: d.readUInt32LE(44), seed: d.subarray(8, 40).toString("hex").slice(0, 16), raw: d, header: a.data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wallet = Keypair.generate();
const session = Keypair.generate();
console.log(`Room ${ROOM} ${room.toBase58()}  wallet ${wallet.publicKey.toBase58().slice(0, 8)} (0 SOL)`);
let W = await world();
console.log(`  phase ${W.phase} tick ${W.tick}`);
if (W.phase !== 0) {
  console.log("  room busy — resetting");
  await send([ix([w(room)], "reset")], session, "reset");
}
const name = Buffer.alloc(12);
name.write("smoketest");
const exp = Math.floor(Date.now() / 1000) + 3600;
await send([ix([r(wallet.publicKey, true), w(room)], "join", Buffer.concat([Buffer.from([0]), name, session.publicKey.toBuffer(), i64(exp)]))], wallet, "join (wallet signs once, 0 SOL)");
const vrfKeys = [w(session.publicKey, true), w(room), w(QUEUE), r(identity), r(VRF), r(SLOT_HASHES), r(SystemProgram.programId)];
await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ix(vrfKeys, "start", Buffer.from([7]))], session, "start → VRF seed request");
for (let i = 0; i < 40; i++) {
  W = await world();
  if (W.seedSrc === 1) break;
  await sleep(500);
}
console.log(`  seed: src ${W.seedSrc} phase ${W.phase} seed ${W.seed}…`);
if (W.seedSrc !== 1) process.exit(1);
await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), ix([r(session.publicKey, true), w(room)], "begin")], session, "begin (generate dungeon on-chain)");
W = await world();
console.log(`  phase ${W.phase} (2=running)`);
await send([ix([w(session.publicKey, true), w(room), r(MAGIC)], "schedule_ticks", Buffer.concat([i64(Date.now() % 1e9), i64(100), i64(3000)]))], session, "schedule crank ticks");
const t0 = (await world()).tick;
await sleep(2000);
const t1 = (await world()).tick;
console.log(`  crank: ${t1 - t0} ticks in 2s`);
if (t1 === t0) {
  await send([ix([w(room)], "tick")], session, "manual tick");
}
// move a bit, attack
const raw = (await world()).raw;
const px = raw.readInt32LE(108), py = raw.readInt32LE(112);
for (let k = 0; k < 5; k++) await send([ix([r(session.publicKey, true), w(room)], "move_to", Buffer.concat([i32(px + 120 * (k + 1)), i32(py), Buffer.from([0, 1])]))], session, `move ${k}`, k === 4);
await send([ix([r(session.publicKey, true), w(room)], "combat", Buffer.from([0, 0]))], session, "attack");
await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ix(vrfKeys, "interact", Buffer.from([3]))], session, "interact (chest VRF if near)");
const t2 = (await world()).tick;
await sleep(3000);
const t3 = (await world()).tick;
console.log(`  ticks: ${t3 - t2} in 3s · tick ${t3}`);
// measure tick CU
const sigs = await er.getSignaturesForAddress(room, { limit: 15 }, "confirmed").catch(() => []);
for (const s of sigs.slice(0, 15)) {
  const tx = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
  const l = tx?.meta?.logMessages?.find((m) => m.includes("consumed"));
  const name = tx?.meta?.logMessages?.find((m) => m.startsWith("Program log: Instruction:"));
  if (l) console.log(`   ${(name || "").replace("Program log: Instruction: ", "").padEnd(14)} ${l.replace(/.*consumed/, "consumed")}`);
}
console.log("done");
process.exit(0);
