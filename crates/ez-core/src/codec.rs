//! Fixed-size little-endian binary layout for `World`.
//!
//! The layout is mirrored by `apps/web/src/chain/decode.ts`. Any change here
//! must be reflected there (and `WORLD_VERSION` bumped).

use crate::consts::*;
use crate::world::*;
use alloc::vec::Vec;

pub const ITEM_SIZE: usize = 2;
pub const PLAYER_SIZE: usize = 99;
pub const MONSTER_SIZE: usize = 30;
pub const PROJECTILE_SIZE: usize = 21;
pub const CHEST_SIZE: usize = 9;
pub const DROP_SIZE: usize = 15;
pub const PORTAL_SIZE: usize = 2;
pub const ROOM_SIZE: usize = 5;
pub const EVENT_SIZE: usize = 16;
pub const HEADER_SIZE: usize = 88;

pub const WORLD_SIZE: usize = HEADER_SIZE
    + PLAYER_SIZE * MAX_PLAYERS
    + MONSTER_SIZE * MAX_MONSTERS
    + PROJECTILE_SIZE * MAX_PROJECTILES
    + CHEST_SIZE * MAX_CHESTS
    + DROP_SIZE * MAX_DROPS
    + PORTAL_SIZE * MAX_PORTALS
    + ROOM_SIZE * MAX_ROOMS
    + WALL_BYTES
    + 4
    + EVENT_SIZE * EVENT_CAP;

/// Writes into a caller-provided buffer (no heap use: the on-chain program
/// encodes straight into account data).
struct W<'a> {
    b: &'a mut [u8],
    p: usize,
}

impl<'a> W<'a> {
    fn bytes(&mut self, v: &[u8]) {
        self.b[self.p..self.p + v.len()].copy_from_slice(v);
        self.p += v.len();
    }
    fn u8(&mut self, v: u8) {
        self.b[self.p] = v;
        self.p += 1;
    }
    fn u16(&mut self, v: u16) {
        self.bytes(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.bytes(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    fn item(&mut self, i: &Item) {
        self.u8(i.kind);
        self.u8(i.rarity);
    }
}

pub struct DecodeError;

struct R<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> R<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        if self.p + n > self.b.len() {
            return Err(DecodeError);
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, DecodeError> {
        let s = self.take(2)?;
        Ok(u16::from_le_bytes([s[0], s[1]]))
    }
    fn u32(&mut self) -> Result<u32, DecodeError> {
        let s = self.take(4)?;
        Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn i32(&mut self) -> Result<i32, DecodeError> {
        let s = self.take(4)?;
        Ok(i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn u64(&mut self) -> Result<u64, DecodeError> {
        let s = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Ok(u64::from_le_bytes(a))
    }
    fn arr<const N: usize>(&mut self) -> Result<[u8; N], DecodeError> {
        let s = self.take(N)?;
        let mut a = [0u8; N];
        a.copy_from_slice(s);
        Ok(a)
    }
    fn item(&mut self) -> Result<Item, DecodeError> {
        Ok(Item { kind: self.u8()?, rarity: self.u8()? })
    }
}

impl World {
    pub fn encode(&self) -> Vec<u8> {
        let mut v = alloc::vec![0u8; WORLD_SIZE];
        self.write_to(&mut v);
        v
    }

    /// Writes the encoded world into `out` (at least `WORLD_SIZE` bytes).
    pub fn write_to(&self, out: &mut [u8]) -> bool {
        if out.len() < WORLD_SIZE {
            return false;
        }
        let mut w = W { b: out, p: 0 };
        self.encode_fields(&mut w);
        debug_assert_eq!(w.p, WORLD_SIZE);
        true
    }

    fn encode_fields(&self, w: &mut W) {
        w.u8(self.version);
        w.u8(self.phase);
        w.u32(self.nonce);
        w.bytes(&self.seed);
        w.u8(self.seed_src);
        w.u32(self.tick);
        w.u8(self.host);
        w.u32(self.elite_tick);
        w.u32(self.portal_tick);
        w.u32(self.collapse_tick);
        w.u64(self.rng);
        w.u8(self.wave);
        w.u8(self.settled);
        w.u8(self.boss_idx);
        for d in self.boss_dmg {
            w.u32(d);
        }
        w.u8(self.room_count);
        w.u8(self.door.tx);
        w.u8(self.door.ty);
        w.u8(self.door.vertical);
        w.u8(self.door.open);

        for p in &self.players {
            w.u8(p.state);
            w.u8(p.class);
            w.u16(p.hp);
            w.u16(p.max_hp);
            w.i32(p.x);
            w.i32(p.y);
            w.u8(p.aim);
            w.u8(p.moving);
            w.u32(p.last_move_tick);
            w.u32(p.atk_ready);
            w.u32(p.spec_ready);
            w.u32(p.dodge_ready);
            w.u32(p.dodge_until);
            w.u32(p.invuln_until);
            w.u32(p.shield_until);
            w.u32(p.potion_ready);
            w.u8(p.crit);
            w.u8(p.extract);
            w.u8(p.last_hit_by);
            w.u32(p.last_hit_tick);
            w.u8(p.kills);
            w.u8(p.pvp_kills);
            w.u8(p.potions);
            w.u8(p.keys);
            for i in &p.inv {
                w.item(i);
            }
            w.u32(p.dmg_dealt);
            w.u32(p.active_tick);
            w.u32(p.banked);
            w.bytes(&p.name);
        }
        for m in &self.monsters {
            w.u8(m.kind);
            w.u16(m.hp);
            w.u16(m.max_hp);
            w.i32(m.x);
            w.i32(m.y);
            w.u8(m.aim);
            w.u8(m.state);
            w.u32(m.timer);
            w.u32(m.atk_ready);
            w.u8(m.target);
            w.u8(m.room);
            w.u8(m.elite);
            w.u32(m.stun_until);
        }
        for p in &self.projectiles {
            w.u8(p.kind);
            w.u8(p.owner);
            w.i32(p.x);
            w.i32(p.y);
            w.i32(p.vx);
            w.i32(p.vy);
            w.u16(p.dmg);
            w.u8(p.ttl);
        }
        for c in &self.chests {
            w.u8(c.tx);
            w.u8(c.ty);
            w.u8(c.tier);
            w.u8(c.state);
            w.u8(c.opener);
            w.u32(c.req_tick);
        }
        for d in &self.drops {
            w.item(&d.item);
            w.i32(d.x);
            w.i32(d.y);
            w.u32(d.spawn_tick);
            w.u8(d.from);
        }
        for p in &self.portals {
            w.u8(p.tx);
            w.u8(p.ty);
        }
        for r in &self.rooms {
            w.u8(r.x);
            w.u8(r.y);
            w.u8(r.w);
            w.u8(r.h);
            w.u8(r.kind);
        }
        w.bytes(&self.walls);
        w.u32(self.event_count);
        for e in &self.events {
            w.u32(e.tick);
            w.u8(e.kind);
            w.u8(e.a);
            w.u8(e.b);
            w.u8(e.c);
            w.i32(e.x);
            w.i32(e.y);
        }
    }

    /// Convenience for tests and WASM; not compiled for Solana (World exceeds the 4KB stack).
    #[cfg(not(target_os = "solana"))]
    pub fn decode(b: &[u8]) -> Result<World, DecodeError> {
        let mut w = World::default();
        w.decode_into(b)?;
        Ok(w)
    }

    /// Decodes in place (no large stack temporaries; used on-chain with a boxed World).
    pub fn decode_into(&mut self, b: &[u8]) -> Result<(), DecodeError> {
        let mut r = R { b, p: 0 };
        let w = self;
        w.version = r.u8()?;
        w.phase = r.u8()?;
        w.nonce = r.u32()?;
        w.seed = r.arr::<32>()?;
        w.seed_src = r.u8()?;
        w.tick = r.u32()?;
        w.host = r.u8()?;
        w.elite_tick = r.u32()?;
        w.portal_tick = r.u32()?;
        w.collapse_tick = r.u32()?;
        w.rng = r.u64()?;
        w.wave = r.u8()?;
        w.settled = r.u8()?;
        w.boss_idx = r.u8()?;
        for d in w.boss_dmg.iter_mut() {
            *d = r.u32()?;
        }
        w.room_count = r.u8()?;
        w.door = Door { tx: r.u8()?, ty: r.u8()?, vertical: r.u8()?, open: r.u8()? };

        for p in w.players.iter_mut() {
            p.state = r.u8()?;
            p.class = r.u8()?;
            p.hp = r.u16()?;
            p.max_hp = r.u16()?;
            p.x = r.i32()?;
            p.y = r.i32()?;
            p.aim = r.u8()?;
            p.moving = r.u8()?;
            p.last_move_tick = r.u32()?;
            p.atk_ready = r.u32()?;
            p.spec_ready = r.u32()?;
            p.dodge_ready = r.u32()?;
            p.dodge_until = r.u32()?;
            p.invuln_until = r.u32()?;
            p.shield_until = r.u32()?;
            p.potion_ready = r.u32()?;
            p.crit = r.u8()?;
            p.extract = r.u8()?;
            p.last_hit_by = r.u8()?;
            p.last_hit_tick = r.u32()?;
            p.kills = r.u8()?;
            p.pvp_kills = r.u8()?;
            p.potions = r.u8()?;
            p.keys = r.u8()?;
            for i in p.inv.iter_mut() {
                *i = r.item()?;
            }
            p.dmg_dealt = r.u32()?;
            p.active_tick = r.u32()?;
            p.banked = r.u32()?;
            p.name = r.arr::<NAME_LEN>()?;
        }
        for m in w.monsters.iter_mut() {
            m.kind = r.u8()?;
            m.hp = r.u16()?;
            m.max_hp = r.u16()?;
            m.x = r.i32()?;
            m.y = r.i32()?;
            m.aim = r.u8()?;
            m.state = r.u8()?;
            m.timer = r.u32()?;
            m.atk_ready = r.u32()?;
            m.target = r.u8()?;
            m.room = r.u8()?;
            m.elite = r.u8()?;
            m.stun_until = r.u32()?;
        }
        for p in w.projectiles.iter_mut() {
            p.kind = r.u8()?;
            p.owner = r.u8()?;
            p.x = r.i32()?;
            p.y = r.i32()?;
            p.vx = r.i32()?;
            p.vy = r.i32()?;
            p.dmg = r.u16()?;
            p.ttl = r.u8()?;
        }
        for c in w.chests.iter_mut() {
            c.tx = r.u8()?;
            c.ty = r.u8()?;
            c.tier = r.u8()?;
            c.state = r.u8()?;
            c.opener = r.u8()?;
            c.req_tick = r.u32()?;
        }
        for d in w.drops.iter_mut() {
            d.item = r.item()?;
            d.x = r.i32()?;
            d.y = r.i32()?;
            d.spawn_tick = r.u32()?;
            d.from = r.u8()?;
        }
        for p in w.portals.iter_mut() {
            p.tx = r.u8()?;
            p.ty = r.u8()?;
        }
        for rm in w.rooms.iter_mut() {
            *rm = Room { x: r.u8()?, y: r.u8()?, w: r.u8()?, h: r.u8()?, kind: r.u8()? };
        }
        w.walls = r.arr::<WALL_BYTES>()?;
        w.event_count = r.u32()?;
        for e in w.events.iter_mut() {
            e.tick = r.u32()?;
            e.kind = r.u8()?;
            e.a = r.u8()?;
            e.b = r.u8()?;
            e.c = r.u8()?;
            e.x = r.i32()?;
            e.y = r.i32()?;
        }
        Ok(())
    }
}
