// Tries to recycle every room (anyone may reopen a finished, stuck or abandoned room).
// Usage: node scripts/reopen-rooms.mjs
import fs from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync(new URL("../src/chain/exit_zero.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const er = new Connection(process.env.ER_RPC || "https://devnet-as.magicblock.app", "processed");
const disc = Buffer.from(idl.instructions.find((i) => i.name === "reset").discriminator);
const kp = Keypair.generate();
for (let id = 0; id < Number(process.env.ROOMS || 6); id++) {
  const room = PublicKey.findProgramAddressSync([Buffer.from("room2"), Buffer.from([id])], PROGRAM_ID)[0];
  const d = (await er.getAccountInfo(room)).data.subarray(320);
  const phase = d[1];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys: [{ pubkey: room, isSigner: false, isWritable: true }], data: disc }));
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const res = await er.confirmTransaction(sig, "processed");
  console.log(`room ${id} phase ${phase}: ${res.value.err ? "kept (in use)" : "reopened"}`);
}
