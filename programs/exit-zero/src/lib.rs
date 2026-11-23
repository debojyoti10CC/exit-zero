//! EXIT//ZERO on-chain program.
//!
//! Every match room is a PDA that is delegated once to a MagicBlock Ephemeral
//! Rollup. All gameplay (joining, moving, fighting, opening chests, extracting)
//! runs on the rollup with zero fees, signed by a short-lived session key that
//! the player's wallet authorises once per match. The world advances through a
//! permissionless `tick`, scheduled by the MagicBlock crank (no game server).
//! Randomness for the dungeon seed and for every chest comes from MagicBlock VRF.
//! Results are written to the delegated Hall (leaderboard) and Vault (relic
//! ownership ledger) and committed back to Solana.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
#[allow(deprecated)]
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::consts::program_identity_pubkey;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_randomness_ix_const, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

use ez_core::sim::{self, Action};
use ez_core::{World, WORLD_RAW_SIZE, MAX_PLAYERS, NAME_LEN, PHASE_ENDED, PHASE_LOBBY, PHASE_RUNNING, PHASE_SEEDING, PS_EMPTY, PS_EXTRACTED, RARITY_RARE};

declare_id!("3gPCvP9DviVCg4MAwA1xcKFbvzPNubVf6rBkJFtnQ9Zi");

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);

/// v2: zero-copy world layout (rooms are re-created under this seed).
pub const ROOM_SEED: &[u8] = b"room2";
pub const HALL_SEED: &[u8] = b"hall";
pub const VAULT_SEED: &[u8] = b"vault";

pub const HALL_MAX: usize = 64;
pub const VAULT_PAGE_MAX: usize = 96;
pub const MAX_SESSION_SECS: i64 = 4 * 60 * 60;
/// Rollup slots (~50ms each) of inactivity before a stuck room may be recycled.
pub const RECYCLE_SLOTS: u64 = 1200;

#[ephemeral]
#[program]
pub mod exit_zero {
    use super::*;

    // ------------------------------------------------------------------
    // Base-layer setup (paid once by the deployer)
    // ------------------------------------------------------------------

    pub fn create_room(ctx: Context<CreateRoom>, room_id: u8) -> Result<()> {
        let room = &mut ctx.accounts.room;
        room.room_id = room_id;
        room.bump = ctx.bumps.room;
        room.wallets = [Pubkey::default(); MAX_PLAYERS];
        room.sessions = [Pubkey::default(); MAX_PLAYERS];
        room.session_exp = [0; MAX_PLAYERS];
        room.last_tick_slot = 0;
        room.crank_task = 0;
        room._pad = [0; 6];
        let world = World::new_boxed();
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        require!(world.write_raw(&mut data[GameRoom::WORLD_OFFSET..]), GameError::Corrupt);
        Ok(())
    }

    pub fn create_hall(ctx: Context<CreateHall>) -> Result<()> {
        let hall = &mut ctx.accounts.hall;
        hall.total_runs = 0;
        hall.total_extracted = 0;
        hall.entries = Vec::new();
        Ok(())
    }

    pub fn create_vault(ctx: Context<CreateVault>, page: u8) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        v.page = page;
        v.relics = Vec::new();
        Ok(())
    }

    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id: u8) -> Result<()> {
        ctx.accounts.delegate_room(
            &ctx.accounts.payer,
            &[ROOM_SEED, &[room_id]],
            DelegateConfig { validator: ctx.remaining_accounts.first().map(|a| a.key()), ..Default::default() },
        )?;
        Ok(())
    }

    pub fn delegate_hall(ctx: Context<DelegateHall>) -> Result<()> {
        ctx.accounts.delegate_hall(
            &ctx.accounts.payer,
            &[HALL_SEED],
            DelegateConfig { validator: ctx.remaining_accounts.first().map(|a| a.key()), ..Default::default() },
        )?;
        Ok(())
    }

    pub fn delegate_vault(ctx: Context<DelegateVault>, page: u8) -> Result<()> {
        ctx.accounts.delegate_vault(
            &ctx.accounts.payer,
            &[VAULT_SEED, &[page]],
            DelegateConfig { validator: ctx.remaining_accounts.first().map(|a| a.key()), ..Default::default() },
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Lobby (Ephemeral Rollup, zero fees)
    // ------------------------------------------------------------------

    /// Wallet joins the room and authorises a session key for gameplay.
    /// Re-joining with the same wallet during a run rotates the session key (reconnect).
    pub fn join(ctx: Context<Join>, class: u8, name: [u8; NAME_LEN], session: Pubkey, session_exp: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(session_exp > now && session_exp <= now + MAX_SESSION_SECS, GameError::BadSession);
        require!(session != Pubkey::default(), GameError::BadSession);
        let wallet = ctx.accounts.wallet.key();
        let room = &mut ctx.accounts.room;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        if let Some(i) = room.wallets.iter().position(|w| *w == wallet) {
            room.sessions[i] = session;
            room.session_exp[i] = session_exp;
            if world.phase == PHASE_LOBBY {
                sim::set_class(&mut *world, i as u8, class).map_err(sim_err)?;
            }
            return Ok(());
        }
        let slot = sim::join(&mut *world, class, sanitize_name(name)).map_err(sim_err)? as usize;
        room.wallets[slot] = wallet;
        room.sessions[slot] = session;
        room.session_exp[slot] = session_exp;
        Ok(())
    }

    pub fn set_class(ctx: Context<SessionAct>, class: u8) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let p = session_slot(room, &ctx.accounts.signer.key())?;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        sim::set_class(&mut *world, p, class).map_err(sim_err)?;
        Ok(())
    }

    pub fn leave(ctx: Context<SessionAct>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let p = session_slot(room, &ctx.accounts.signer.key())?;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        sim::leave(&mut *world, p).map_err(sim_err)?;
        room.wallets[p as usize] = Pubkey::default();
        room.sessions[p as usize] = Pubkey::default();
        room.session_exp[p as usize] = 0;
        Ok(())
    }

    /// Host locks the lobby and requests the dungeon seed from MagicBlock VRF.
    /// Can be called again while waiting if the oracle is slow.
    pub fn start(ctx: Context<Start>, client_seed: u8) -> Result<()> {
        let room_key = ctx.accounts.room.key();
        {
            let room = &mut ctx.accounts.room;
            let p = session_slot(room, &ctx.accounts.signer.key())?;
            let info = room.to_account_info();
            let mut data = info.try_borrow_mut_data()?;
            let world = world_of(&mut data)?;
            require!(world.phase == PHASE_LOBBY || (world.phase == PHASE_SEEDING && world.seed_src == 0), GameError::WrongPhase);
            require!(world.host == p, GameError::NotHost);
            world.phase = PHASE_SEEDING;
            world.seed_src = 0;
            drop(data);
            // Remember when the seed was requested so an abandoned request can be recycled.
            room.last_tick_slot = Clock::get()?.slot;
        }
        let ix = create_request_randomness_ix_const(
            RequestRandomnessParams {
                payer: ctx.accounts.signer.key(),
                oracle_queue: ctx.accounts.oracle_queue.key(),
                callback_program_id: ID,
                callback_discriminator: instruction::SeedCallback::DISCRIMINATOR.to_vec(),
                caller_seed: [client_seed; 32],
                accounts_metas: Some(vec![SerializableAccountMeta { pubkey: room_key, is_signer: false, is_writable: true }]),
                callback_args: None,
                ..Default::default()
            },
            PROGRAM_IDENTITY,
        );
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback: stores the verified dungeon seed.
    pub fn seed_callback(ctx: Context<RoomCallback>, randomness: [u8; 32]) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        require!(world.phase == PHASE_SEEDING, GameError::WrongPhase);
        sim::set_seed(&mut *world, randomness, 1);
        Ok(())
    }

    /// Generates the dungeon deterministically from the verified seed and opens it.
    pub fn begin(ctx: Context<SessionAct>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let _ = session_slot(room, &ctx.accounts.signer.key())?;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        sim::begin(&mut *world).map_err(sim_err)?;
        room.last_tick_slot = Clock::get()?.slot;
        Ok(())
    }

    /// Schedules the world tick on the MagicBlock crank so the dungeon runs without a server.
    pub fn schedule_ticks<'info>(ctx: Context<'info, ScheduleTicks<'info>>, task_id: i64, interval_ms: i64, iterations: i64) -> Result<()> {
        let tick_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(ctx.accounts.room.key(), false)],
            data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}),
        };
        #[allow(deprecated)]
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &ctx.accounts.magic_program,
            instruction_accounts: &[ctx.accounts.payer.to_account_info(), ctx.accounts.room.to_account_info()],
            args: ScheduleTaskArgs { task_id, execution_interval_millis: interval_ms, iterations, instructions: vec![tick_ix] },
        }
        .invoke()?;
        ctx.accounts.room.crank_task = task_id;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Gameplay (Ephemeral Rollup, session-key signed)
    // ------------------------------------------------------------------

    /// Permissionless world step. At most one step per rollup slot, so the crank
    /// and fallback client tickers can never speed the game up.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let slot = Clock::get()?.slot;
        if slot <= room.last_tick_slot {
            return Ok(());
        }
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        if world.phase != PHASE_RUNNING {
            return Ok(());
        }
        room.last_tick_slot = slot;
        sim::tick(&mut *world);
        Ok(())
    }

    pub fn move_to(ctx: Context<SessionAct>, x: i32, y: i32, aim: u8, moving: u8) -> Result<()> {
        act(ctx, Action::Move { x, y, aim, moving })
    }

    /// kind: 0 attack, 1 special, 2 dodge, 3 potion
    pub fn combat(ctx: Context<SessionAct>, kind: u8, aim: u8) -> Result<()> {
        let action = match kind {
            0 => Action::Attack { aim },
            1 => Action::Special { aim },
            2 => Action::Dodge { aim },
            3 => Action::Potion,
            _ => return err!(GameError::BadAction),
        };
        act(ctx, action)
    }

    /// Opens doors and chests. Opening a chest requests VRF; loot arrives in `chest_callback`.
    pub fn interact(ctx: Context<Interact>, client_seed: u8) -> Result<()> {
        let room_key = ctx.accounts.room.key();
        let request = {
            let room = &mut ctx.accounts.room;
            let p = session_slot(room, &ctx.accounts.signer.key())?;
            let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
            let out = sim::act(&mut *world, p, Action::Interact).map_err(sim_err)?;
                        out.request_chest
        };
        if let Some(chest) = request {
            let ix = create_request_randomness_ix_const(
                RequestRandomnessParams {
                    payer: ctx.accounts.signer.key(),
                    oracle_queue: ctx.accounts.oracle_queue.key(),
                    callback_program_id: ID,
                    callback_discriminator: instruction::ChestCallback::DISCRIMINATOR.to_vec(),
                    caller_seed: [client_seed ^ chest; 32],
                    accounts_metas: Some(vec![SerializableAccountMeta { pubkey: room_key, is_signer: false, is_writable: true }]),
                    callback_args: Some(vec![chest]),
                    ..Default::default()
                },
                PROGRAM_IDENTITY,
            );
            ctx.accounts.invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
        }
        Ok(())
    }

    /// VRF callback: rolls the chest's loot from verified randomness.
    pub fn chest_callback(ctx: Context<RoomCallback>, randomness: [u8; 32], chest: u8) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        // A late callback for a chest that was re-requested is ignored, not an error.
        if sim::resolve_chest(&mut *world, chest, &randomness).is_ok() {
                    }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    /// Records results in the Hall and relics in the Vault, then commits all
    /// three accounts to Solana. Callable by anyone once the run has ended.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        require!(world.phase == PHASE_ENDED, GameError::WrongPhase);
        require!(world.settled == 0, GameError::AlreadySettled);
        let now = Clock::get()?.unix_timestamp;
        let hall = &mut ctx.accounts.hall;
        let vault = &mut ctx.accounts.vault;
        hall.total_runs = hall.total_runs.saturating_add(1);
        let mut seed8 = [0u8; 8];
        seed8.copy_from_slice(&world.seed[..8]);
        for i in 0..MAX_PLAYERS {
            let p = world.players[i];
            let wallet = room.wallets[i];
            if p.state == PS_EMPTY || wallet == Pubkey::default() {
                continue;
            }
            let extracted = p.state == PS_EXTRACTED;
            let value = sim::score(&p);
            hall.total_extracted = hall.total_extracted.saturating_add(value as u64);
            hall.record(wallet, p.name, extracted, value, p.kills as u32, p.pvp_kills as u32);
            if extracted {
                for it in p.inv.iter() {
                    if it.kind != 0 && it.rarity >= RARITY_RARE && vault.relics.len() < VAULT_PAGE_MAX {
                        vault.relics.push(Relic {
                            owner: wallet,
                            kind: it.kind,
                            rarity: it.rarity,
                            room: room.room_id,
                            nonce: world.nonce,
                            tick: world.tick,
                            seed8,
                            value: it.value(),
                            ts: now,
                        });
                    }
                }
            }
        }
        world.settled = 1;
        drop(data);

        // Serialize before handing the accounts to the commit intent.
        ctx.accounts.room.exit(&crate::ID)?;
        ctx.accounts.hall.exit(&crate::ID)?;
        ctx.accounts.vault.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[
            ctx.accounts.room.to_account_info(),
            ctx.accounts.hall.to_account_info(),
            ctx.accounts.vault.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }

    /// Re-opens a settled room for the next lobby.
    pub fn reset(ctx: Context<Tick>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
        let ended = world.phase == PHASE_ENDED && world.settled == 1;
        let empty_lobby = world.phase == PHASE_LOBBY && world.player_count() == 0;
        // A lobby or seeding room that everyone abandoned can also be recycled after its sessions expire.
        let now = Clock::get()?.unix_timestamp;
        let stale = world.phase != PHASE_RUNNING && room.session_exp.iter().all(|e| *e < now);
        // ~1 minute of rollup slots with no progress: a seed that never arrived, or a
        // finished run nobody settled, can be recycled by anyone.
        let idle = Clock::get()?.slot > room.last_tick_slot.saturating_add(RECYCLE_SLOTS);
        let seed_lost = world.phase == PHASE_SEEDING && world.seed_src == 0 && idle;
        let ended_unsettled = world.phase == PHASE_ENDED && idle;
        // A run whose world stopped ticking (no crank, everyone gone) is abandoned.
        let abandoned = world.phase == PHASE_RUNNING && idle;
        require!(ended || empty_lobby || stale || seed_lost || ended_unsettled || abandoned, GameError::WrongPhase);
        let nonce = world.nonce.wrapping_add(1);
        sim::reset_lobby(&mut *world, nonce);
        room.wallets = [Pubkey::default(); MAX_PLAYERS];
        room.sessions = [Pubkey::default(); MAX_PLAYERS];
        room.session_exp = [0; MAX_PLAYERS];
        Ok(())
    }

    /// Transfers ownership of a relic recorded in the Vault.
    pub fn transfer_relic(ctx: Context<TransferRelic>, index: u16, to: Pubkey) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        let r = v.relics.get_mut(index as usize).ok_or(GameError::BadRelic)?;
        require_keys_eq!(r.owner, ctx.accounts.owner.key(), GameError::NotOwner);
        r.owner = to;
        Ok(())
    }

    /// Commits the room to Solana mid-run (snapshots for verification) or
    /// commits and undelegates it (admin maintenance).
    pub fn commit_room(ctx: Context<CommitRoom>, undelegate: bool) -> Result<()> {
        let b = MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        );
        if undelegate {
            b.commit_and_undelegate(&[ctx.accounts.room.to_account_info()]).build_and_invoke()?;
        } else {
            b.commit(&[ctx.accounts.room.to_account_info()]).build_and_invoke()?;
        }
        Ok(())
    }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/// Zero-copy view of the match world inside the room account.
fn world_of(data: &mut [u8]) -> Result<&mut World> {
    World::from_raw_mut(&mut data[GameRoom::WORLD_OFFSET..]).ok_or_else(|| error!(GameError::Corrupt))
}

fn session_slot(room: &GameRoom, signer: &Pubkey) -> Result<u8> {
    let now = Clock::get()?.unix_timestamp;
    for i in 0..MAX_PLAYERS {
        if room.sessions[i] == *signer && room.wallets[i] != Pubkey::default() {
            require!(room.session_exp[i] > now, GameError::SessionExpired);
            return Ok(i as u8);
        }
    }
    err!(GameError::BadSession)
}

fn act(ctx: Context<SessionAct>, action: Action) -> Result<()> {
    let room = &mut ctx.accounts.room;
    let p = session_slot(room, &ctx.accounts.signer.key())?;
    let info = room.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let world = world_of(&mut data)?;
    sim::act(&mut *world, p, action).map_err(sim_err)?;
    Ok(())
}

fn sanitize_name(mut n: [u8; NAME_LEN]) -> [u8; NAME_LEN] {
    for b in n.iter_mut() {
        if !(b' '..=b'~').contains(b) {
            *b = 0;
        }
    }
    n
}

fn sim_err(e: sim::SimError) -> Error {
    match e {
        sim::SimError::WrongPhase => error!(GameError::WrongPhase),
        sim::SimError::BadSlot => error!(GameError::BadSession),
        sim::SimError::LobbyFull => error!(GameError::LobbyFull),
        sim::SimError::NotAlive => error!(GameError::NotAlive),
        sim::SimError::BadClass => error!(GameError::BadAction),
        sim::SimError::BadChest => error!(GameError::BadAction),
    }
}

// ----------------------------------------------------------------------
// Accounts
// ----------------------------------------------------------------------

/// Match room. The encoded `ez_core::World` (`WORLD_SIZE` bytes) is stored right
/// after these fields, at `WORLD_OFFSET`, and is read/written in place so the
/// program never holds two copies of the world in its 32KB heap.
#[account]
pub struct GameRoom {
    pub room_id: u8,
    pub bump: u8,
    pub wallets: [Pubkey; MAX_PLAYERS],
    pub sessions: [Pubkey; MAX_PLAYERS],
    pub session_exp: [i64; MAX_PLAYERS],
    pub last_tick_slot: u64,
    pub crank_task: i64,
    /// Pads the header so the world starts 8-byte aligned.
    pub _pad: [u8; 6],
}

impl GameRoom {
    pub const HEADER: usize = 1 + 1 + 32 * MAX_PLAYERS + 32 * MAX_PLAYERS + 8 * MAX_PLAYERS + 8 + 8 + 6;
    pub const WORLD_OFFSET: usize = 8 + Self::HEADER;
    pub const SPACE: usize = Self::WORLD_OFFSET + WORLD_RAW_SIZE;
}

const _: () = assert!(GameRoom::WORLD_OFFSET % 8 == 0);

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct HallEntry {
    pub wallet: Pubkey,
    pub name: [u8; NAME_LEN],
    pub runs: u32,
    pub extractions: u32,
    pub kills: u32,
    pub pvp_kills: u32,
    pub best_value: u32,
    pub total_value: u64,
}

#[account]
pub struct Hall {
    pub total_runs: u64,
    pub total_extracted: u64,
    pub entries: Vec<HallEntry>,
}

impl Hall {
    pub const ENTRY_SIZE: usize = 32 + NAME_LEN + 4 * 5 + 8;
    pub const SPACE: usize = 8 + 8 + 8 + 4 + Self::ENTRY_SIZE * HALL_MAX;

    fn record(&mut self, wallet: Pubkey, name: [u8; NAME_LEN], extracted: bool, value: u32, kills: u32, pvp: u32) {
        let idx = match self.entries.iter().position(|e| e.wallet == wallet) {
            Some(i) => i,
            None => {
                if self.entries.len() < HALL_MAX {
                    self.entries.push(HallEntry { wallet, ..Default::default() });
                    self.entries.len() - 1
                } else {
                    // Replace the weakest entry only if this run beats it.
                    let (wi, weakest) = self.entries.iter().enumerate().min_by_key(|(_, e)| e.total_value).map(|(i, e)| (i, e.total_value)).unwrap();
                    if (value as u64) <= weakest {
                        return;
                    }
                    self.entries[wi] = HallEntry { wallet, ..Default::default() };
                    wi
                }
            }
        };
        let e = &mut self.entries[idx];
        e.name = name;
        e.runs = e.runs.saturating_add(1);
        if extracted {
            e.extractions = e.extractions.saturating_add(1);
        }
        e.kills = e.kills.saturating_add(kills);
        e.pvp_kills = e.pvp_kills.saturating_add(pvp);
        e.best_value = e.best_value.max(value);
        e.total_value = e.total_value.saturating_add(value as u64);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Relic {
    pub owner: Pubkey,
    pub kind: u8,
    pub rarity: u8,
    pub room: u8,
    pub nonce: u32,
    pub tick: u32,
    pub seed8: [u8; 8],
    pub value: u32,
    pub ts: i64,
}

#[account]
pub struct VaultPage {
    pub page: u8,
    pub relics: Vec<Relic>,
}

impl VaultPage {
    pub const RELIC_SIZE: usize = 32 + 1 + 1 + 1 + 4 + 4 + 8 + 4 + 8;
    pub const SPACE: usize = 8 + 1 + 4 + Self::RELIC_SIZE * VAULT_PAGE_MAX;
}

// ----------------------------------------------------------------------
// Contexts
// ----------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(room_id: u8)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = GameRoom::SPACE, seeds = [ROOM_SEED, &[room_id]], bump)]
    pub room: Account<'info, GameRoom>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateHall<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = Hall::SPACE, seeds = [HALL_SEED], bump)]
    pub hall: Account<'info, Hall>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page: u8)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = VaultPage::SPACE, seeds = [VAULT_SEED, &[page]], bump)]
    pub vault: Account<'info, VaultPage>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(room_id: u8)]
pub struct DelegateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA checked by seeds; untyped because delegation changes its owner.
    #[account(mut, del, seeds = [ROOM_SEED, &[room_id]], bump)]
    pub room: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateHall<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA checked by seeds.
    #[account(mut, del, seeds = [HALL_SEED], bump)]
    pub hall: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(page: u8)]
pub struct DelegateVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA checked by seeds.
    #[account(mut, del, seeds = [VAULT_SEED, &[page]], bump)]
    pub vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Join<'info> {
    /// The player's wallet. Signs once per match; pays nothing on the rollup.
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
}

#[derive(Accounts)]
pub struct SessionAct<'info> {
    /// Session key authorised in `join`.
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
}

#[vrf]
#[derive(Accounts)]
pub struct Start<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
    /// CHECK: must be a MagicBlock VRF queue.
    #[account(mut, constraint = is_vrf_queue(&oracle_queue.key()) @ GameError::BadQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct Interact<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
    /// CHECK: must be a MagicBlock VRF queue.
    #[account(mut, constraint = is_vrf_queue(&oracle_queue.key()) @ GameError::BadQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
}

fn is_vrf_queue(k: &Pubkey) -> bool {
    use ephemeral_rollups_sdk::vrf::consts as c;
    *k == c::DEFAULT_QUEUE || *k == c::DEFAULT_EPHEMERAL_QUEUE || *k == c::DEFAULT_TEST_QUEUE || *k == c::DEFAULT_EPHEMERAL_TEST_QUEUE
}

/// Scoped VRF identity for this program, computed at compile time. (`#[vrf_callback]`
/// derives it inside the constraint, which runs the PDA search on-chain — ~270k CU.)
const VRF_IDENTITY: Pubkey = Pubkey::new_from_array(ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity_const(&crate::ID).0);

/// Only the VRF program can sign as our scoped identity, so only it can call these callbacks.
#[derive(Accounts)]
pub struct RoomCallback<'info> {
    #[account(address = VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub room: Account<'info, GameRoom>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
}

#[derive(Accounts)]
pub struct ScheduleTicks<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
    /// CHECK: MagicBlock magic program.
    pub magic_program: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
    #[account(mut, seeds = [HALL_SEED], bump)]
    pub hall: Account<'info, Hall>,
    #[account(mut, seeds = [VAULT_SEED, &[vault.page]], bump)]
    pub vault: Account<'info, VaultPage>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &[room.room_id]], bump = room.bump)]
    pub room: Account<'info, GameRoom>,
}

#[derive(Accounts)]
pub struct TransferRelic<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, &[vault.page]], bump)]
    pub vault: Account<'info, VaultPage>,
}

#[error_code]
pub enum GameError {
    #[msg("Action not allowed in the current match phase")]
    WrongPhase,
    #[msg("Session key is not authorised for this room")]
    BadSession,
    #[msg("Session key has expired; rejoin to renew it")]
    SessionExpired,
    #[msg("The room is full")]
    LobbyFull,
    #[msg("Player is not alive")]
    NotAlive,
    #[msg("Only the host can do this")]
    NotHost,
    #[msg("Invalid action")]
    BadAction,
    #[msg("Oracle queue is not a MagicBlock VRF queue")]
    BadQueue,
    #[msg("Room state is corrupt")]
    Corrupt,
    #[msg("Match already settled")]
    AlreadySettled,
    #[msg("Relic not found")]
    BadRelic,
    #[msg("Only the relic owner can transfer it")]
    NotOwner,
}

// Keep unused-import lints quiet for phase constants used only in some cfgs.
#[allow(dead_code)]
const _PHASES: [u8; 2] = [PHASE_LOBBY, PHASE_SEEDING];
