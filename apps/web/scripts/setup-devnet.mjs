// One-time devnet setup, paid by the deployer wallet:
//   creates the match rooms, the Hall (leaderboard) and Vault pages (relic ledger),
//   then delegates every account to the MagicBlock Ephemeral Rollup (devnet-as).
// After this, players need no SOL at all: all gameplay runs on the rollup.
//
// Usage (from apps/web):  node scripts/setup-devnet.mjs [path-to-keypair.json]
import fs from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync(new URL("../src/chain/exit_zero.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const BASE = process.env.BASE_RPC || "https://api.devnet.solana.com";
const ER = process.env.ER_RPC || "https://devnet-as.magicblock.app";
const VALIDATOR = new PublicKey(process.env.ER_VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const DELEGATION = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const ROOMS = Number(process.env.ROOMS || 6);
const PAGES = Number(process.env.PAGES || 2);

const keyPath = process.argv[2] || "\\\\wsl.localhost\\Ubuntu-24.04\\root\\.config\\solana\\id.json";
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const base = new Connection(BASE, "confirmed");
const er = new Connection(ER, "confirmed");

const disc = Object.fromEntries(idl.instructions.map((i) => [i.name, Buffer.from(i.discriminator)]));
const enc = (s) => Buffer.from(s);
const pda = (seeds, prog = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const roomPda = (id) => pda([enc("room"), Buffer.from([id])]);
const hallPda = () => pda([enc("hall")]);
const vaultPda = (p) => pda([enc("vault"), Buffer.from([p])]);
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const ix = (keys, name, args = []) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc[name], Buffer.from(args)]) });

async function send(conn, ixs, label) {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed", skipPreflight: false });
  console.log(`  ✓ ${label}  ${sig}`);
  return sig;
}

async function exists(conn, key) {
  return !!(await conn.getAccountInfo(key));
}

function delegateKeys(acc) {
  return [
    w(payer.publicKey, true),
    w(pda([enc("buffer"), acc.toBuffer()])),
    w(pda([enc("delegation"), acc.toBuffer()], DELEGATION)),
    w(pda([enc("delegation-metadata"), acc.toBuffer()], DELEGATION)),
    w(acc),
    r(PROGRAM_ID),
    r(DELEGATION),
    r(SystemProgram.programId),
    r(VALIDATOR),
  ];
}

async function ensure(acc, label, createIx, delegateIx) {
  const info = await base.getAccountInfo(acc);
  if (!info) await send(base, [createIx], `create ${label}`);
  const now = await base.getAccountInfo(acc);
  if (now && now.owner.equals(DELEGATION)) {
    console.log(`  • ${label} already delegated`);
    return;
  }
  await send(base, [delegateIx], `delegate ${label}`);
}

console.log(`Program ${PROGRAM_ID.toBase58()}`);
console.log(`Payer   ${payer.publicKey.toBase58()}  balance ${(await base.getBalance(payer.publicKey)) / 1e9} SOL`);
console.log(`Rollup  ${ER}  validator ${VALIDATOR.toBase58()}`);

await ensure(hallPda(), "hall", ix([w(payer.publicKey, true), w(hallPda()), r(SystemProgram.programId)], "create_hall"), ix(delegateKeys(hallPda()), "delegate_hall"));
for (let p = 0; p < PAGES; p++) {
  await ensure(vaultPda(p), `vault ${p}`, ix([w(payer.publicKey, true), w(vaultPda(p)), r(SystemProgram.programId)], "create_vault", [p]), ix(delegateKeys(vaultPda(p)), "delegate_vault", [p]));
}
for (let id = 0; id < ROOMS; id++) {
  await ensure(roomPda(id), `room ${id}`, ix([w(payer.publicKey, true), w(roomPda(id)), r(SystemProgram.programId)], "create_room", [id]), ix(delegateKeys(roomPda(id)), "delegate_room", [id]));
}

// Touch each account on the rollup so it is cloned and ready.
console.log("Waiting for the rollup to clone the accounts…");
for (let i = 0; i < 20; i++) {
  const infos = await er.getMultipleAccountsInfo([hallPda(), ...Array.from({ length: ROOMS }, (_, k) => roomPda(k))]);
  const ready = infos.filter(Boolean).length;
  process.stdout.write(`  ${ready}/${ROOMS + 1} visible on ER\r`);
  if (ready === ROOMS + 1) break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("\nDone. Rooms are live on the Ephemeral Rollup.");
