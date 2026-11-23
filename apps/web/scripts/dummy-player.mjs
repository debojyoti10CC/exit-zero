// Joins a room as an extra player and wanders/attacks for a while (multiplayer testing).
// Usage: node scripts/dummy-player.mjs <roomId> [seconds]
import fs from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync(new URL("../src/chain/exit_zero.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const er = new Connection(process.env.ER_RPC || "https://devnet-as.magicblock.app", "processed");
const ROOM = Number(process.argv[2] ?? 0);
const SECS = Number(process.argv[3] ?? 90);
const disc = Object.fromEntries(idl.instructions.map((i) => [i.name, Buffer.from(i.discriminator)]));
const room = PublicKey.findProgramAddressSync([Buffer.from("room2"), Buffer.from([ROOM])], PROGRAM_ID)[0];
const wallet = Keypair.generate();
const session = Keypair.generate();
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
let bh = null, bhAt = 0;
async function send(keys, name, data, signer) {
  if (!bh || Date.now() - bhAt > 15000) { bh = (await er.getLatestBlockhash()).blockhash; bhAt = Date.now(); }
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc[name], data]) }));
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = bh;
  tx.sign(signer);
  return er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
}
const name = Buffer.alloc(12);
name.write("Rival");
const sig = await send([{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }, { pubkey: room, isSigner: false, isWritable: true }], "join", Buffer.concat([Buffer.from([2]), name, session.publicKey.toBuffer(), i64(Math.floor(Date.now() / 1000) + 3600)]), wallet);
await er.confirmTransaction(sig, "processed");
console.log("joined room", ROOM, "as Rival (Rogue)");
const end = Date.now() + SECS * 1000;
let me = -1;
while (Date.now() < end) {
  const d = (await er.getAccountInfo(room)).data;
  const w = d.subarray(320);
  if (me < 0) for (let i = 0; i < 4; i++) if (new PublicKey(d.subarray(10 + 128 + i * 32, 10 + 128 + i * 32 + 32)).equals(session.publicKey)) me = i;
  if (w[1] === 2 && me >= 0) {
    // Player struct is 104 bytes in repr(C), players start at 100; x@+8 y@+12 state@+0
    const base = 100 + me * 104;
    const x = w.readInt32LE(base + 8), y = w.readInt32LE(base + 12);
    if (w[base] !== 1) { console.log("Rival is", w[base] === 3 ? "extracted" : "dead"); break; }
    const a = Math.random() * Math.PI * 2;
    const k = { pubkey: session.publicKey, isSigner: true, isWritable: false };
    send([k, { pubkey: room, isSigner: false, isWritable: true }], "move_to", Buffer.concat([i32(x + Math.round(Math.cos(a) * 140)), i32(y + Math.round(Math.sin(a) * 140)), Buffer.from([Math.floor((a / (2 * Math.PI)) * 256) & 255, 1])]), session).catch(() => {});
    send([k, { pubkey: room, isSigner: false, isWritable: true }], "combat", Buffer.from([0, Math.floor(Math.random() * 256)]), session).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log("done");
process.exit(0);
