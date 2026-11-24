//! WASM bindings: practice mode runs the full simulation in the browser, and
//! online mode uses the same collision code to predict the local player's movement.

use ez_core::bots::{self, BotMemory};
use ez_core::rng::Rng;
use ez_core::sim::{self, Action};
use ez_core::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Sim {
    w: World,
    bots: [Option<BotMemory>; MAX_PLAYERS],
    rng: Rng,
}

fn name_bytes(s: &str) -> [u8; NAME_LEN] {
    let mut n = [0u8; NAME_LEN];
    for (i, b) in s.bytes().filter(|b| (b' '..=b'~').contains(b)).take(NAME_LEN).enumerate() {
        n[i] = b;
    }
    n
}

#[wasm_bindgen]
impl Sim {
    /// Practice run: the local player is slot 0, `bots` rival adventurers fill the rest.
    #[wasm_bindgen]
    pub fn practice(seed: &[u8], class: u8, name: &str, bots: u8, quick: bool) -> Result<Sim, JsValue> {
        if seed.len() != 32 {
            return Err(JsValue::from_str("seed must be 32 bytes"));
        }
        let mut s = [0u8; 32];
        s.copy_from_slice(seed);
        let mut w = World::default();
        if quick {
            w.elite_tick = 60 * TICKS_PER_SEC;
            w.portal_tick = 120 * TICKS_PER_SEC;
            w.collapse_tick = 240 * TICKS_PER_SEC;
        }
        sim::join(&mut w, class.min(2), name_bytes(name)).map_err(|_| JsValue::from_str("join failed"))?;
        let names = ["Morrow", "Vesk", "Ilsa", "Brand", "Quill"];
        let mut mem = [None; MAX_PLAYERS];
        let mut rng = Rng::from_seed(&s, 77);
        let first = rng.below(5) as usize;
        for i in 0..bots.min(3) as usize {
            let c = rng.below(3) as u8;
            let slot = sim::join(&mut w, c, name_bytes(names[(i + first) % 5])).map_err(|_| JsValue::from_str("bot join failed"))?;
            mem[slot as usize] = Some(BotMemory::new(rng.next_u64()));
        }
        sim::set_seed(&mut w, s, 2);
        sim::begin(&mut w).map_err(|_| JsValue::from_str("begin failed"))?;
        Ok(Sim { w, bots: mem, rng })
    }

    /// Wraps world bytes read from the rollup (for prediction and decoding helpers).
    #[wasm_bindgen]
    pub fn load(bytes: &[u8]) -> Result<Sim, JsValue> {
        let w = World::decode(bytes).map_err(|_| JsValue::from_str("bad world bytes"))?;
        Ok(Sim { w, bots: [None; MAX_PLAYERS], rng: Rng::new(1) })
    }

    /// Loads the zero-copy layout read straight from the room account.
    #[wasm_bindgen]
    pub fn load_raw(raw: &[u8]) -> Result<Sim, JsValue> {
        let w = World::from_raw_copy(raw).ok_or_else(|| JsValue::from_str("bad raw world"))?;
        Ok(Sim { w: *w, bots: [None; MAX_PLAYERS], rng: Rng::new(1) })
    }

    pub fn replace_raw(&mut self, raw: &[u8]) -> bool {
        match World::from_raw_copy(raw) {
            Some(w) => {
                self.w = *w;
                true
            }
            None => false,
        }
    }

    pub fn raw_size() -> usize {
        WORLD_RAW_SIZE
    }

    pub fn replace(&mut self, bytes: &[u8]) -> bool {
        match World::decode(bytes) {
            Ok(w) => {
                self.w = w;
                true
            }
            Err(_) => false,
        }
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.w.encode()
    }

    pub fn world_size() -> usize {
        codec::WORLD_SIZE
    }

    pub fn act_move(&mut self, p: u8, x: i32, y: i32, aim: u8, moving: u8) {
        let _ = sim::act(&mut self.w, p, Action::Move { x, y, aim, moving });
    }

    /// kind: 0 attack, 1 special, 2 dodge, 3 potion
    pub fn act_combat(&mut self, p: u8, kind: u8, aim: u8) {
        let a = match kind {
            0 => Action::Attack { aim },
            1 => Action::Special { aim },
            2 => Action::Dodge { aim },
            _ => Action::Potion,
        };
        let _ = sim::act(&mut self.w, p, a);
    }

    /// Returns the chest index waiting for randomness, or -1.
    pub fn interact(&mut self, p: u8) -> i32 {
        match sim::act(&mut self.w, p, Action::Interact) {
            Ok(o) => o.request_chest.map(|c| c as i32).unwrap_or(-1),
            Err(_) => -1,
        }
    }

    pub fn resolve_chest(&mut self, chest: u8, rnd: &[u8]) -> bool {
        if rnd.len() != 32 {
            return false;
        }
        let mut r = [0u8; 32];
        r.copy_from_slice(rnd);
        sim::resolve_chest(&mut self.w, chest, &r).is_ok()
    }

    /// Advances one world tick, letting bots act first. Returns chest indices bots opened.
    pub fn tick(&mut self) -> Vec<u8> {
        let mut chests = Vec::new();
        for p in 0..MAX_PLAYERS {
            if let Some(mut mem) = self.bots[p] {
                let acts = bots::think(&self.w, p as u8, &mut mem, &mut self.rng);
                for a in acts {
                    if let Ok(o) = sim::act(&mut self.w, p as u8, a) {
                        if let Some(c) = o.request_chest {
                            chests.push(c);
                        }
                    }
                }
                self.bots[p] = Some(mem);
            }
        }
        sim::tick(&mut self.w);
        chests
    }

    pub fn tick_only(&mut self) {
        sim::tick(&mut self.w);
    }

    pub fn is_bot(&self, p: u8) -> bool {
        (p as usize) < MAX_PLAYERS && self.bots[p as usize].is_some()
    }

    /// Collision-aware movement for client prediction: returns [x, y].
    pub fn slide(&self, x: i32, y: i32, dx: i32, dy: i32) -> Vec<i32> {
        let (nx, ny) = sim::slide(&self.w, x, y, dx, dy, PLAYER_RADIUS);
        vec![nx, ny]
    }

    // ---- Trailer staging helpers (used only by the trailer renderer) ----

    /// Teleports a player (and resets its movement budget).
    pub fn t_place(&mut self, p: u8, x: i32, y: i32) {
        let t = self.w.tick;
        if let Some(pl) = self.w.players.get_mut(p as usize) {
            pl.x = x;
            pl.y = y;
            pl.last_move_tick = t * 16 + 16;
        }
    }

    pub fn t_hp(&mut self, p: u8, hp: u16, max: u16) {
        if let Some(pl) = self.w.players.get_mut(p as usize) {
            pl.max_hp = max;
            pl.hp = hp.min(max);
        }
    }

    pub fn t_set_tick(&mut self, t: u32) {
        self.w.tick = t;
    }

    /// Removes every monster within `r` units of (x, y) (r < 0 removes all).
    pub fn t_clear_monsters(&mut self, x: i32, y: i32, r: i32) {
        let r2 = r as i64 * r as i64;
        for m in self.w.monsters.iter_mut() {
            if m.kind == MON_NONE || m.kind == MON_KING {
                continue;
            }
            if r < 0 || ez_core::math::dist2(m.x, m.y, x, y) <= r2 {
                *m = Monster::default();
            }
        }
    }

    /// Spawns a monster; returns its slot or -1.
    pub fn t_spawn(&mut self, kind: u8, x: i32, y: i32, chase: bool, target: u8) -> i32 {
        match ez_core::map::spawn_monster_pub(&mut self.w, kind, x, y, 0, false) {
            Some(s) => {
                if chase {
                    self.w.monsters[s].state = ez_core::world::MS_CHASE;
                    self.w.monsters[s].target = target;
                }
                s as i32
            }
            None => -1,
        }
    }

    /// Places an item on the floor with the usual loot fanfare.
    pub fn t_drop(&mut self, kind: u8, rarity: u8, x: i32, y: i32) {
        if let Some(slot) = self.w.drops.iter().position(|d| d.item.is_empty()) {
            self.w.drops[slot] = Drop { item: Item { kind, rarity }, x, y, spawn_tick: self.w.tick, from: NOBODY };
            self.w.push_event(EV_LOOT, 0, kind, rarity, x, y);
        }
    }

    /// Moves a monster (e.g. to frame the boss).
    pub fn t_move_monster(&mut self, mi: u8, x: i32, y: i32) {
        if let Some(m) = self.w.monsters.get_mut(mi as usize) {
            m.x = x;
            m.y = y;
        }
    }

    pub fn tick_count(&self) -> u32 {
        self.w.tick
    }

    pub fn phase(&self) -> u8 {
        self.w.phase
    }
}

/// Byte angle from a to b (matches the on-chain math exactly).
#[wasm_bindgen]
pub fn angle_to(ax: i32, ay: i32, bx: i32, by: i32) -> u8 {
    ez_core::math::angle_to(ax, ay, bx, by)
}

/// Converts the on-chain raw layout into the compact layout the UI decoder reads.
#[wasm_bindgen]
pub fn raw_to_compact(raw: &[u8]) -> Result<Vec<u8>, JsValue> {
    let w = World::from_raw_copy(raw).ok_or_else(|| JsValue::from_str("bad raw world"))?;
    Ok(w.encode())
}

/// Value of an item, for UI.
#[wasm_bindgen]
pub fn item_value(kind: u8, rarity: u8) -> u32 {
    Item { kind, rarity }.value()
}
