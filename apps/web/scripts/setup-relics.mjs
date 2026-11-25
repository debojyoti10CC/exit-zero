// One-time setup for relic NFTs (Metaplex Core), paid by the deployer wallet:
//   1. funds the sponsor PDA that pays rent for every relic mint,
//   2. creates the "EXIT//ZERO Relics" collection (a PDA owned by the program),
//   3. creates/funds a small devnet fee relayer so guests with 0 SOL can claim.
//      Its secret is written to apps/web/.env.local (gitignored) as VITE_RELAYER_KEY.
// Optional: `--mint <page> <index>` mints one relic as an end-to-end test.
//
// Usage (from apps/web):  node scripts/setup-relics.mjs [--mint 0 3]
import fs from "node:fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync(new URL("../src/chain/exit_zero.json", import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const BASE = process.env.BASE_RPC || "https://api.devnet.solana.com";
const SPONSOR_SOL = Number(process.env.SPONSOR_SOL || 1);
const RELAYER_SOL = Number(process.env.RELAYER_SOL || 0.3);
const WSL_ROOT = "\\\\wsl.localhost\\Ubuntu-24.04\\root";
const keyPath = process.env.DEPLOYER || `${WSL_ROOT}\\.config\\solana\\id.json`;
const relayerPath = process.env.RELAYER || `${WSL_ROOT}\\keys\\relayer.json`;
const envPath = new URL("../.env.local", import.meta.url);

const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const payer = load(keyPath);
const base = new Connection(BASE, "confirmed");
const disc = Object.fromEntries(idl.instructions.map((i) => [i.name, Buffer.from(i.discriminator)]));
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const sponsor = pda([Buffer.from("sponsor")]);
const collection = pda([Buffer.from("relics")]);
const vaultPda = (p) => pda([Buffer.from("vault"), Buffer.from([p])]);
const assetPda = (p, i) => pda([Buffer.from("relic"), Buffer.from([p]), Buffer.from([i & 255, i >> 8])]);
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });

async function send(ixs, label, signers = [payer]) {
  const sig = await sendAndConfirmTransaction(base, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  console.log(`  ✓ ${label}  ${sig}`);
  return sig;
}

async function topUp(to, sol, label) {
  const have = await base.getBalance(to);
  const want = Math.round(sol * LAMPORTS_PER_SOL);
  if (have >= want * 0.8) return console.log(`  · ${label} has ${(have / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: want - have })], `fund ${label} to ${sol} SOL`);
}

console.log(`Deployer ${payer.publicKey.toBase58()}  ${(await base.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);
console.log(`Sponsor  ${sponsor.toBase58()}\nCollection ${collection.toBase58()}`);

await topUp(sponsor, SPONSOR_SOL, "sponsor");

if (!(await base.getAccountInfo(collection))) {
  await send(
    [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(payer.publicKey, true), w(collection), r(sponsor), r(MPL_CORE), r(SystemProgram.programId)],
      data: disc.create_relic_collection,
    })],
    "create relic collection",
  );
} else console.log("  · collection exists");

let relayer;
if (fs.existsSync(relayerPath)) relayer = load(relayerPath);
else {
  relayer = Keypair.generate();
  fs.writeFileSync(relayerPath, JSON.stringify(Array.from(relayer.secretKey)));
  console.log(`  ✓ new relayer key saved to ${relayerPath}`);
}
console.log(`Relayer  ${relayer.publicKey.toBase58()}`);
await topUp(relayer.publicKey, RELAYER_SOL, "relayer");
if (!process.env.NO_ENV) {
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  env = env.split(/\r?\n/).filter((l) => l && !l.startsWith("VITE_RELAYER_KEY=")).join("\n");
  env += `${env ? "\n" : ""}VITE_RELAYER_KEY=${JSON.stringify(Array.from(relayer.secretKey))}\n`;
  fs.writeFileSync(envPath, env);
  console.log("  ✓ wrote VITE_RELAYER_KEY to apps/web/.env.local");
}

const mi = process.argv.indexOf("--mint");
if (mi > 0) {
  const page = Number(process.argv[mi + 1] || 0);
  const index = Number(process.argv[mi + 2] || 0);
  const v = await base.getAccountInfo(vaultPda(page));
  if (!v) throw new Error("vault page missing");
  const off = 13 + index * 63;
  const owner = new PublicKey(v.data.subarray(off, off + 32));
  const asset = assetPda(page, index);
  console.log(`Minting relic ${page}/${index} for ${owner.toBase58()} → ${asset.toBase58()}`);
  const data = Buffer.concat([disc.mint_relic, Buffer.from([page, index & 255, index >> 8])]);
  await send(
    [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [r(vaultPda(page)), w(asset), w(collection), w(sponsor), r(owner), r(MPL_CORE), r(SystemProgram.programId)],
      data,
    })],
    "mint relic",
    [relayer],
  );
  console.log(`  https://explorer.solana.com/address/${asset.toBase58()}?cluster=devnet`);
}
