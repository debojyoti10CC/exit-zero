//! Match state. One `World` lives inside one delegated match account.

use crate::consts::*;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Item {
    pub kind: u8,
    pub rarity: u8,
}

impl Item {
    pub const EMPTY: Item = Item { kind: ITEM_NONE, rarity: 0 };
    pub fn is_empty(&self) -> bool {
        self.kind == ITEM_NONE
    }
    pub fn value(&self) -> u32 {
        let k = self.kind as usize;
        if k >= ITEM_BASE_VALUE.len() {
            return 0;
        }
        ITEM_BASE_VALUE[k] * RARITY_MULT10[(self.rarity as usize).min(4)] / 10
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Player {
    pub state: u8,
    pub class: u8,
    pub hp: u16,
    pub max_hp: u16,
    pub x: i32,
    pub y: i32,
    pub aim: u8,
    pub moving: u8,
    pub last_move_tick: u32,
    pub atk_ready: u32,
    pub spec_ready: u32,
    pub dodge_ready: u32,
    pub dodge_until: u32,
    pub invuln_until: u32,
    pub shield_until: u32,
    pub potion_ready: u32,
    pub crit: u8,
    pub extract: u8,
    pub last_hit_by: u8,
    pub last_hit_tick: u32,
    pub kills: u8,
    pub pvp_kills: u8,
    pub potions: u8,
    pub keys: u8,
    pub inv: [Item; INV_SLOTS],
    pub dmg_dealt: u32,
    pub active_tick: u32,
    pub banked: u32,
    pub name: [u8; NAME_LEN],
}

impl Player {
    pub fn alive(&self) -> bool {
        self.state == PS_ALIVE
    }
    pub fn loot_value(&self) -> u32 {
        self.inv.iter().map(|i| i.value()).sum()
    }
    pub fn free_slot(&self) -> Option<usize> {
        self.inv.iter().position(|i| i.is_empty())
    }
    /// Best equipped blade rarity + 1 (0 when none). Each tier adds +12% damage.
    pub fn blade_tier(&self) -> u32 {
        self.inv.iter().filter(|i| i.kind == ITEM_BLADE).map(|i| i.rarity as u32 + 1).max().unwrap_or(0)
    }
    /// Best aegis rarity + 1. Each tier blocks 6% damage.
    pub fn aegis_tier(&self) -> u32 {
        self.inv.iter().filter(|i| i.kind == ITEM_AEGIS).map(|i| i.rarity as u32 + 1).max().unwrap_or(0)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Monster {
    pub kind: u8,
    pub hp: u16,
    pub max_hp: u16,
    pub x: i32,
    pub y: i32,
    pub aim: u8,
    pub state: u8,
    pub timer: u32,
    pub atk_ready: u32,
    pub target: u8,
    pub room: u8,
    pub elite: u8,
    pub stun_until: u32,
}

pub const MS_IDLE: u8 = 0;
pub const MS_CHASE: u8 = 1;
pub const MS_WINDUP: u8 = 2;
pub const MS_RECOVER: u8 = 3;
pub const MS_DEAD: u8 = 4;

impl Monster {
    pub fn alive(&self) -> bool {
        self.kind != MON_NONE && self.hp > 0
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Projectile {
    pub kind: u8,
    pub owner: u8,
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
    pub dmg: u16,
    pub ttl: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Chest {
    pub tx: u8,
    pub ty: u8,
    pub tier: u8,
    pub state: u8,
    pub opener: u8,
    pub req_tick: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Drop {
    pub item: Item,
    pub x: i32,
    pub y: i32,
    pub spawn_tick: u32,
    /// Player who dropped it (cannot re-pick for a moment), or NOBODY.
    pub from: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Portal {
    pub tx: u8,
    pub ty: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Room {
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
    pub kind: u8,
}

impl Room {
    pub fn cx(&self) -> i32 {
        (self.x as i32 * 2 + self.w as i32) * TILE / 2
    }
    pub fn cy(&self) -> i32 {
        (self.y as i32 * 2 + self.h as i32) * TILE / 2
    }
    pub fn contains_tile(&self, tx: i32, ty: i32) -> bool {
        tx >= self.x as i32 && ty >= self.y as i32 && tx < (self.x + self.w) as i32 && ty < (self.y + self.h) as i32
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Door {
    pub tx: u8,
    pub ty: u8,
    /// 0 = door spans 2 tiles horizontally, 1 = vertically.
    pub vertical: u8,
    pub open: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Event {
    pub tick: u32,
    pub kind: u8,
    pub a: u8,
    pub b: u8,
    pub c: u8,
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct World {
    pub version: u8,
    pub phase: u8,
    pub nonce: u32,
    pub seed: [u8; 32],
    /// 0 = none, 1 = MagicBlock VRF, 2 = local practice seed.
    pub seed_src: u8,
    pub tick: u32,
    pub host: u8,
    pub elite_tick: u32,
    pub portal_tick: u32,
    pub collapse_tick: u32,
    pub rng: u64,
    pub wave: u8,
    pub settled: u8,
    pub boss_idx: u8,
    pub boss_dmg: [u32; MAX_PLAYERS],
    pub room_count: u8,
    pub door: Door,
    pub players: [Player; MAX_PLAYERS],
    pub monsters: [Monster; MAX_MONSTERS],
    pub projectiles: [Projectile; MAX_PROJECTILES],
    pub chests: [Chest; MAX_CHESTS],
    pub drops: [Drop; MAX_DROPS],
    pub portals: [Portal; MAX_PORTALS],
    pub rooms: [Room; MAX_ROOMS],
    pub walls: [u8; WALL_BYTES],
    pub event_count: u32,
    pub events: [Event; EVENT_CAP],
}

pub const WORLD_VERSION: u8 = 1;

impl Default for World {
    fn default() -> Self {
        World {
            version: WORLD_VERSION,
            phase: PHASE_LOBBY,
            nonce: 0,
            seed: [0; 32],
            seed_src: 0,
            tick: 0,
            host: NOBODY,
            elite_tick: DEFAULT_ELITE_TICK,
            portal_tick: DEFAULT_PORTAL_TICK,
            collapse_tick: DEFAULT_COLLAPSE_TICK,
            rng: 0,
            wave: 0,
            settled: 0,
            boss_idx: NOBODY,
            boss_dmg: [0; MAX_PLAYERS],
            room_count: 0,
            door: Door::default(),
            players: [Player::default(); MAX_PLAYERS],
            monsters: [Monster::default(); MAX_MONSTERS],
            projectiles: [Projectile::default(); MAX_PROJECTILES],
            chests: [Chest::default(); MAX_CHESTS],
            drops: [Drop::default(); MAX_DROPS],
            portals: [Portal::default(); MAX_PORTALS],
            rooms: [Room::default(); MAX_ROOMS],
            walls: [0xFF; WALL_BYTES],
            event_count: 0,
            events: [Event::default(); EVENT_CAP],
        }
    }
}

impl World {
    /// Heap-allocates a zeroed World without building it on the stack first
    /// (Solana programs have a 4KB stack frame; a World is larger than that).
    pub fn new_boxed() -> alloc::boxed::Box<World> {
        use alloc::alloc::{alloc_zeroed, handle_alloc_error, Layout};
        let layout = Layout::new::<World>();
        // SAFETY: every field of World is a plain integer (or array/struct of
        // integers), so the all-zero bit pattern is a valid value.
        unsafe {
            let p = alloc_zeroed(layout) as *mut World;
            if p.is_null() {
                handle_alloc_error(layout);
            }
            let mut b = alloc::boxed::Box::from_raw(p);
            b.reset(0);
            b
        }
    }

    /// Resets to a fresh lobby in place.
    pub fn reset(&mut self, nonce: u32) {
        self.version = WORLD_VERSION;
        self.phase = PHASE_LOBBY;
        self.nonce = nonce;
        self.seed = [0; 32];
        self.seed_src = 0;
        self.tick = 0;
        self.host = NOBODY;
        self.elite_tick = DEFAULT_ELITE_TICK;
        self.portal_tick = DEFAULT_PORTAL_TICK;
        self.collapse_tick = DEFAULT_COLLAPSE_TICK;
        self.rng = 0;
        self.wave = 0;
        self.settled = 0;
        self.boss_idx = NOBODY;
        self.boss_dmg = [0; MAX_PLAYERS];
        self.room_count = 0;
        self.door = Door::default();
        for p in self.players.iter_mut() {
            *p = Player::default();
        }
        self.clear_entities();
        for r in self.rooms.iter_mut() {
            *r = Room::default();
        }
        for b in self.walls.iter_mut() {
            *b = 0xFF;
        }
        self.event_count = 0;
        for e in self.events.iter_mut() {
            *e = Event::default();
        }
    }

    pub fn clear_entities(&mut self) {
        for m in self.monsters.iter_mut() {
            *m = Monster::default();
        }
        for p in self.projectiles.iter_mut() {
            *p = Projectile::default();
        }
        for c in self.chests.iter_mut() {
            *c = Chest::default();
        }
        for d in self.drops.iter_mut() {
            *d = Drop::default();
        }
        for p in self.portals.iter_mut() {
            *p = Portal::default();
        }
    }

    pub fn is_wall(&self, tx: i32, ty: i32) -> bool {
        if tx < 0 || ty < 0 || tx >= MAP_W as i32 || ty >= MAP_H as i32 {
            return true;
        }
        let i = ty as usize * MAP_W + tx as usize;
        self.walls[i >> 3] & (1 << (i & 7)) != 0
    }

    pub fn set_wall(&mut self, tx: i32, ty: i32, wall: bool) {
        if tx < 0 || ty < 0 || tx >= MAP_W as i32 || ty >= MAP_H as i32 {
            return;
        }
        let i = ty as usize * MAP_W + tx as usize;
        if wall {
            self.walls[i >> 3] |= 1 << (i & 7);
        } else {
            self.walls[i >> 3] &= !(1 << (i & 7));
        }
    }

    /// True when a circle of radius `r` at (x,y) overlaps no wall tile.
    pub fn free_at(&self, x: i32, y: i32, r: i32) -> bool {
        let x0 = (x - r).div_euclid(TILE);
        let x1 = (x + r).div_euclid(TILE);
        let y0 = (y - r).div_euclid(TILE);
        let y1 = (y + r).div_euclid(TILE);
        for ty in y0..=y1 {
            for tx in x0..=x1 {
                if self.is_wall(tx, ty) {
                    return false;
                }
            }
        }
        true
    }

    pub fn push_event(&mut self, kind: u8, a: u8, b: u8, c: u8, x: i32, y: i32) {
        let i = (self.event_count as usize) % EVENT_CAP;
        self.events[i] = Event { tick: self.tick, kind, a, b, c, x, y };
        self.event_count = self.event_count.wrapping_add(1);
    }

    pub fn player_count(&self) -> usize {
        self.players.iter().filter(|p| p.state != PS_EMPTY).count()
    }

    pub fn portals_open(&self) -> bool {
        self.phase == PHASE_RUNNING && self.tick >= self.portal_tick
    }

    /// Corruption 0..=100, rises linearly to the collapse.
    pub fn corruption(&self) -> u32 {
        if self.collapse_tick == 0 {
            return 0;
        }
        (self.tick.min(self.collapse_tick) as u64 * 100 / self.collapse_tick as u64) as u32
    }

    pub fn entrance(&self) -> (i32, i32) {
        let r = self.rooms[0];
        (r.cx(), r.cy())
    }
}

// ---------------------------------------------------------------------------
// Zero-copy access. On-chain, the World lives directly in the account data
// (`#[repr(C)]`, little-endian, 8-byte aligned) and is edited in place, so no
// instruction pays to decode or encode it. Every field is a plain integer, so
// any byte pattern is a valid World.
// ---------------------------------------------------------------------------

/// Bytes a World occupies in account data.
pub const WORLD_RAW_SIZE: usize = core::mem::size_of::<World>();
pub const WORLD_ALIGN: usize = core::mem::align_of::<World>();

impl World {
    /// Views raw account bytes as a World. Returns None if too short or misaligned.
    pub fn from_raw_mut(bytes: &mut [u8]) -> Option<&mut World> {
        if bytes.len() < WORLD_RAW_SIZE || (bytes.as_ptr() as usize) % WORLD_ALIGN != 0 {
            return None;
        }
        // SAFETY: length and alignment checked; World is repr(C) of integers only,
        // so every bit pattern is valid and there are no invariants to uphold.
        Some(unsafe { &mut *(bytes.as_mut_ptr() as *mut World) })
    }

    /// Copies raw bytes (any alignment) into a heap World.
    pub fn from_raw_copy(bytes: &[u8]) -> Option<alloc::boxed::Box<World>> {
        if bytes.len() < WORLD_RAW_SIZE {
            return None;
        }
        let mut w = World::new_boxed();
        // SAFETY: same reasoning as above; we write exactly WORLD_RAW_SIZE bytes.
        unsafe {
            core::ptr::copy_nonoverlapping(bytes.as_ptr(), (&mut *w as *mut World) as *mut u8, WORLD_RAW_SIZE);
        }
        Some(w)
    }

    /// Writes this World's raw representation into `out`.
    pub fn write_raw(&self, out: &mut [u8]) -> bool {
        if out.len() < WORLD_RAW_SIZE {
            return false;
        }
        // SAFETY: World is plain old data; we read exactly its size.
        let src = unsafe { core::slice::from_raw_parts((self as *const World) as *const u8, WORLD_RAW_SIZE) };
        out[..WORLD_RAW_SIZE].copy_from_slice(src);
        true
    }
}
