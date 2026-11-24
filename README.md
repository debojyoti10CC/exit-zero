# EXIT//ZERO

A multiplayer, top-down, dark-fantasy **extraction dungeon crawler** that runs entirely on a
**MagicBlock Ephemeral Rollup**. Up to four adventurers enter a crypt generated from a VRF seed,
loot relics, fight the undead and each other, and race for the portals before the crypt collapses.
Anything you carry is at risk until you escape.

> Built for Solana Blitz v10 (Entertainment Finance). No game server: the rollup *is* the server.

**▶ Play now: https://exitzero.djyo.tech/** — no wallet or SOL needed (a guest key is created in your browser; Phantom and other Solana wallets also work). Online matches run on Solana devnet + the MagicBlock devnet-as rollup; *Practice* runs the same rules locally against bots.

Program: [`3gPCvP9DviVCg4MAwA1xcKFbvzPNubVf6rBkJFtnQ9Zi`](https://explorer.solana.com/address/3gPCvP9DviVCg4MAwA1xcKFbvzPNubVf6rBkJFtnQ9Zi?cluster=devnet) (devnet)

Measured on devnet: world tick ~26k CU (crank-driven, ~10/s), move ~15k CU, attack ~9k CU, chest VRF request ~129k CU, ~190 ms round trip.

## What happens on-chain

| Piece | How |
| --- | --- |
| **Match state** | Each room is a PDA (`GameRoom`) delegated once to the MagicBlock ER (devnet-as). The full world (players, monsters, projectiles, chests, loot, map, event log) lives in the account. |
| **Gameplay** | Every move, attack, dodge, potion and chest interaction is a zero-fee ER transaction validated by the program: movement speed caps, wall collision, cooldowns, damage, loot ownership. |
| **Session keys** | The wallet signs **once** (`join`) to authorise a browser session key with an expiry. All gameplay is signed by that key, so there are no wallet pop-ups mid-fight. Players need **0 SOL**. |
| **World tick** | `tick` is permissionless and rate-limited to one step per rollup slot. It is scheduled by the **MagicBlock crank** (`schedule_ticks`), with clients as a fallback. |
| **VRF** | The dungeon seed (`start` → `seed_callback`) and **every chest roll** (`interact` → `chest_callback`) use MagicBlock VRF. Callbacks are restricted to the VRF program's identity. |
| **Determinism** | The dungeon is generated on-chain from the verified seed by `ez-core`. The same crate compiles to WASM, so anyone can re-derive the exact layout. |
| **Settlement** | `settle` writes results to the delegated **Hall** (leaderboard) and **Vault** (relic ownership ledger), then commits all three accounts back to Solana. |
| **Relics** | Rare, Epic and Legendary items you extract become relic records owned by your wallet (with the run's seed). `transfer_relic` moves them. |

## Repository layout

```
crates/ez-core      Deterministic game rules (no_std, integer-only): map gen, combat, AI, loot, bots
crates/ez-wasm      WASM bindings (practice mode + client-side movement prediction)
programs/exit-zero  Anchor 1.0 program (MagicBlock SDK 0.18: delegation, VRF, crank, commit)
apps/web            Vite + React + Phaser 3 client
scripts/            WSL build/deploy helpers
```

## The game

- **Classes**: Vanguard (cleave, Shield Bash), Arcanist (bolts, Fireball), Rogue (stabs, Shadow Step blink + crit).
- **Enemies**: Skeletons, Bone Callers (ranged), Crypt Brutes (elite slams), Corruption Imps (waves), and **The Hollow King** (boss: slam, orb rings, summons at half health).
- **Timeline** (6 min): elites at 1:30, portals open at 3:00, corruption waves every 30 s, collapse at 6:00.
- **Cooperate or betray**: all attacks hit players too. Killing a rival spills their loot ("BETRAYAL"). Everyone who damaged the King gets their own drop.
- **Vault**: a sealed room behind a door; keys drop from chests.
- **Telegraphs**: every monster attack is wound up with a visible danger zone. Dodge-roll grants brief invulnerability.
- **Practice mode**: the same rules in WASM against rival bots that loot, fight, betray and extract.

## Run locally

Requirements: Node 20+. Program builds need Linux/WSL with Solana 3.1.9, Anchor 1.0.2, Rust 1.89.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173 — Practice works offline
```

Online play reads `VITE_PROGRAM_ID`, `VITE_ER_RPC` (default `https://devnet-as.magicblock.app`) and
`VITE_ER_VALIDATOR`.

### Build & deploy (WSL)

```bash
bash scripts/setup-wsl.sh            # toolchain (once)
bash scripts/wsl-sync.sh             # mirror sources into WSL
bash scripts/wsl-build.sh all        # program + IDL + WASM (copied into apps/web/src)
bash scripts/wsl-deploy.sh           # needs ~9 devnet SOL in ~/.config/solana/id.json
cd apps/web && node scripts/setup-devnet.mjs   # create + delegate rooms, Hall, Vault
```

Core tests: `cargo test -p ez-core --release` (300 seeds checked for connectivity, speed-hack
clamping, full bot matches).

## Credits

- Art: [16x16 DungeonTileset II by 0x72](https://0x72.itch.io/dungeontileset-ii) (CC0). Treasure icons hand-drawn in code.
- Sound: synthesised at runtime with WebAudio.
- Fonts: Pixelify Sans, Silkscreen (Google Fonts, OFL).
