import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import idl from "./exit_zero.json";
import {
  PROGRAM_ID, DELEGATION_PROGRAM, MAGIC_CONTEXT, MAGIC_PROGRAM, VRF_PROGRAM, VRF_EPHEMERAL_QUEUE, SLOT_HASHES,
} from "./config";
import { NAME_LEN, MAX_PLAYERS, WORLD_SIZE } from "../game/world";

const DISC: Record<string, Uint8Array> = {};
for (const ix of (idl as any).instructions) DISC[ix.name] = Uint8Array.from(ix.discriminator);
const ACC_DISC: Record<string, Uint8Array> = {};
for (const a of (idl as any).accounts) ACC_DISC[a.name] = Uint8Array.from(a.discriminator);

const enc = new TextEncoder();

export const roomPda = (id: number) => PublicKey.findProgramAddressSync([enc.encode("room"), Uint8Array.of(id)], PROGRAM_ID)[0];
export const hallPda = () => PublicKey.findProgramAddressSync([enc.encode("hall")], PROGRAM_ID)[0];
export const vaultPda = (page: number) => PublicKey.findProgramAddressSync([enc.encode("vault"), Uint8Array.of(page)], PROGRAM_ID)[0];
export const programIdentity = () => PublicKey.findProgramAddressSync([enc.encode("identity")], PROGRAM_ID)[0];
export const bufferPda = (pda: PublicKey) => PublicKey.findProgramAddressSync([enc.encode("buffer"), pda.toBytes()], PROGRAM_ID)[0];
export const delegationRecord = (pda: PublicKey) => PublicKey.findProgramAddressSync([enc.encode("delegation"), pda.toBytes()], DELEGATION_PROGRAM)[0];
export const delegationMetadata = (pda: PublicKey) => PublicKey.findProgramAddressSync([enc.encode("delegation-metadata"), pda.toBytes()], DELEGATION_PROGRAM)[0];

// --- tiny borsh writer ------------------------------------------------------
class Buf {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 255); return this; }
  u16(v: number) { this.b.push(v & 255, (v >> 8) & 255); return this; }
  i32(v: number) { const d = new DataView(new ArrayBuffer(4)); d.setInt32(0, v, true); this.b.push(...new Uint8Array(d.buffer)); return this; }
  i64(v: number | bigint) { const d = new DataView(new ArrayBuffer(8)); d.setBigInt64(0, BigInt(v), true); this.b.push(...new Uint8Array(d.buffer)); return this; }
  bool(v: boolean) { return this.u8(v ? 1 : 0); }
  bytes(v: Uint8Array) { this.b.push(...v); return this; }
  done(name: string) { return Buffer.from([...DISC[name], ...this.b]); }
}

const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const ix = (keys: any[], data: Buffer) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

export function nameBytes(name: string) {
  const out = new Uint8Array(NAME_LEN);
  const clean = name.replace(/[^\x20-\x7e]/g, "").slice(0, NAME_LEN);
  out.set(enc.encode(clean));
  return out;
}

// --- setup (base layer) -----------------------------------------------------
export const ixCreateRoom = (payer: PublicKey, id: number) => ix([w(payer, true), w(roomPda(id)), r(SystemProgram.programId)], new Buf().u8(id).done("create_room"));
export const ixCreateHall = (payer: PublicKey) => ix([w(payer, true), w(hallPda()), r(SystemProgram.programId)], new Buf().done("create_hall"));
export const ixCreateVault = (payer: PublicKey, page: number) => ix([w(payer, true), w(vaultPda(page)), r(SystemProgram.programId)], new Buf().u8(page).done("create_vault"));

function delegateKeys(payer: PublicKey, pda: PublicKey, validator: PublicKey) {
  return [
    w(payer, true),
    w(bufferPda(pda)),
    w(delegationRecord(pda)),
    w(delegationMetadata(pda)),
    w(pda),
    r(PROGRAM_ID),
    r(DELEGATION_PROGRAM),
    r(SystemProgram.programId),
    r(validator),
  ];
}
export const ixDelegateRoom = (payer: PublicKey, id: number, validator: PublicKey) => ix(delegateKeys(payer, roomPda(id), validator), new Buf().u8(id).done("delegate_room"));
export const ixDelegateHall = (payer: PublicKey, validator: PublicKey) => ix(delegateKeys(payer, hallPda(), validator), new Buf().done("delegate_hall"));
export const ixDelegateVault = (payer: PublicKey, page: number, validator: PublicKey) => ix(delegateKeys(payer, vaultPda(page), validator), new Buf().u8(page).done("delegate_vault"));

// --- lobby & gameplay (Ephemeral Rollup) ------------------------------------
export const ixJoin = (wallet: PublicKey, room: number, cls: number, name: string, session: PublicKey, exp: number) =>
  ix([r(wallet, true), w(roomPda(room))], new Buf().u8(cls).bytes(nameBytes(name)).bytes(session.toBytes()).i64(exp).done("join"));
export const ixSetClass = (signer: PublicKey, room: number, cls: number) => ix([r(signer, true), w(roomPda(room))], new Buf().u8(cls).done("set_class"));
export const ixLeave = (signer: PublicKey, room: number) => ix([r(signer, true), w(roomPda(room))], new Buf().done("leave"));
export const ixBegin = (signer: PublicKey, room: number) => ix([r(signer, true), w(roomPda(room))], new Buf().done("begin"));
export const ixTick = (room: number) => ix([w(roomPda(room))], new Buf().done("tick"));
export const ixReset = (room: number) => ix([w(roomPda(room))], new Buf().done("reset"));
export const ixMove = (signer: PublicKey, room: number, x: number, y: number, aim: number, moving: boolean) =>
  ix([r(signer, true), w(roomPda(room))], new Buf().i32(x).i32(y).u8(aim).u8(moving ? 1 : 0).done("move_to"));
export const ixCombat = (signer: PublicKey, room: number, kind: number, aim: number) => ix([r(signer, true), w(roomPda(room))], new Buf().u8(kind).u8(aim).done("combat"));

function vrfKeys(signer: PublicKey, room: number) {
  return [w(signer, true), w(roomPda(room)), w(VRF_EPHEMERAL_QUEUE), r(programIdentity()), r(VRF_PROGRAM), r(SLOT_HASHES), r(SystemProgram.programId)];
}
export const ixStart = (signer: PublicKey, room: number, seed: number) => ix(vrfKeys(signer, room), new Buf().u8(seed).done("start"));
export const ixInteract = (signer: PublicKey, room: number, seed: number) => ix(vrfKeys(signer, room), new Buf().u8(seed).done("interact"));
export const ixScheduleTicks = (payer: PublicKey, room: number, taskId: number, intervalMs: number, iterations: number) =>
  ix([w(payer, true), w(roomPda(room)), r(MAGIC_PROGRAM)], new Buf().i64(taskId).i64(intervalMs).i64(iterations).done("schedule_ticks"));
export const ixSettle = (payer: PublicKey, room: number, page: number) =>
  ix([w(payer, true), w(roomPda(room)), w(hallPda()), w(vaultPda(page)), r(MAGIC_PROGRAM), w(MAGIC_CONTEXT)], new Buf().done("settle"));
export const ixCommitRoom = (payer: PublicKey, room: number, undelegate: boolean) =>
  ix([w(payer, true), w(roomPda(room)), r(MAGIC_PROGRAM), w(MAGIC_CONTEXT)], new Buf().bool(undelegate).done("commit_room"));
export const ixTransferRelic = (owner: PublicKey, page: number, index: number, to: PublicKey) =>
  ix([r(owner, true), w(vaultPda(page))], new Buf().u16(index).bytes(to.toBytes()).done("transfer_relic"));

// --- account decoding -------------------------------------------------------
export interface RoomHeader {
  roomId: number;
  wallets: PublicKey[];
  sessions: PublicKey[];
  sessionExp: number[];
  lastTickSlot: number;
  crankTask: number;
}
const ROOM_HEADER = 1 + 1 + 32 * MAX_PLAYERS + 32 * MAX_PLAYERS + 8 * MAX_PLAYERS + 8 + 8;
export const WORLD_OFFSET = 8 + ROOM_HEADER;

function eq(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function decodeRoom(data: Uint8Array): { header: RoomHeader; world: Uint8Array } | null {
  if (data.length < WORLD_OFFSET + WORLD_SIZE || !eq(data.slice(0, 8), ACC_DISC.GameRoom)) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 8;
  const roomId = data[p++];
  p++; // bump
  const wallets: PublicKey[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++, p += 32) wallets.push(new PublicKey(data.slice(p, p + 32)));
  const sessions: PublicKey[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++, p += 32) sessions.push(new PublicKey(data.slice(p, p + 32)));
  const sessionExp: number[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++, p += 8) sessionExp.push(Number(dv.getBigInt64(p, true)));
  const lastTickSlot = Number(dv.getBigUint64(p, true));
  p += 8;
  const crankTask = Number(dv.getBigInt64(p, true));
  return { header: { roomId, wallets, sessions, sessionExp, lastTickSlot, crankTask }, world: data.slice(WORLD_OFFSET, WORLD_OFFSET + WORLD_SIZE) };
}

export interface HallEntry {
  wallet: string;
  name: string;
  runs: number;
  extractions: number;
  kills: number;
  pvpKills: number;
  best: number;
  total: number;
}
export function decodeHall(data: Uint8Array): { totalRuns: number; totalExtracted: number; entries: HallEntry[] } | null {
  if (!eq(data.slice(0, 8), ACC_DISC.Hall)) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 8;
  const totalRuns = Number(dv.getBigUint64(p, true));
  p += 8;
  const totalExtracted = Number(dv.getBigUint64(p, true));
  p += 8;
  const n = dv.getUint32(p, true);
  p += 4;
  const entries: HallEntry[] = [];
  const td = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const wallet = new PublicKey(data.slice(p, p + 32)).toBase58();
    p += 32;
    const nb = data.slice(p, p + NAME_LEN);
    p += NAME_LEN;
    const z = nb.indexOf(0);
    const name = td.decode(z >= 0 ? nb.slice(0, z) : nb);
    const runs = dv.getUint32(p, true);
    const extractions = dv.getUint32(p + 4, true);
    const kills = dv.getUint32(p + 8, true);
    const pvpKills = dv.getUint32(p + 12, true);
    const best = dv.getUint32(p + 16, true);
    p += 20;
    const total = Number(dv.getBigUint64(p, true));
    p += 8;
    entries.push({ wallet, name, runs, extractions, kills, pvpKills, best, total });
  }
  return { totalRuns, totalExtracted, entries };
}

export interface Relic {
  index: number;
  page: number;
  owner: string;
  kind: number;
  rarity: number;
  room: number;
  nonce: number;
  tick: number;
  seed8: string;
  value: number;
  ts: number;
}
export function decodeVault(data: Uint8Array): { page: number; relics: Relic[] } | null {
  if (!eq(data.slice(0, 8), ACC_DISC.VaultPage)) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 8;
  const page = data[p++];
  const n = dv.getUint32(p, true);
  p += 4;
  const relics: Relic[] = [];
  for (let i = 0; i < n; i++) {
    const owner = new PublicKey(data.slice(p, p + 32)).toBase58();
    p += 32;
    const kind = data[p++];
    const rarity = data[p++];
    const room = data[p++];
    const nonce = dv.getUint32(p, true);
    const tick = dv.getUint32(p + 4, true);
    p += 8;
    const seed8 = Array.from(data.slice(p, p + 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
    p += 8;
    const value = dv.getUint32(p, true);
    p += 4;
    const ts = Number(dv.getBigInt64(p, true));
    p += 8;
    relics.push({ index: i, page, owner, kind, rarity, room, nonce, tick, seed8, value, ts });
  }
  return { page, relics };
}
