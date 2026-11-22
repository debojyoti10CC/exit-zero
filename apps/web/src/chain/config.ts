import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(import.meta.env.VITE_PROGRAM_ID || "3gPCvP9DviVCg4MAwA1xcKFbvzPNubVf6rBkJFtnQ9Zi");
export const BASE_RPC = import.meta.env.VITE_BASE_RPC || "https://api.devnet.solana.com";
export const ER_RPC = import.meta.env.VITE_ER_RPC || "https://devnet-as.magicblock.app";
export const ER_WS = import.meta.env.VITE_ER_WS || "wss://devnet-as.magicblock.app";
/** Devnet Asia ER validator identity (matches ER_RPC). */
export const ER_VALIDATOR = new PublicKey(import.meta.env.VITE_ER_VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
export const ROOM_COUNT = Number(import.meta.env.VITE_ROOM_COUNT || 6);
export const VAULT_PAGES = Number(import.meta.env.VITE_VAULT_PAGES || 2);

export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
export const VRF_PROGRAM = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

export function erExplorer(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`;
}
export function baseExplorer(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function accountExplorer(addr: string, er = false) {
  return er
    ? `https://explorer.solana.com/address/${addr}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`
    : `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
