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

    pub fn tick_count(&self) -> u32 {
        self.w.tick
    }

    pub fn phase(&self) -> u8 {
        self.w.phase
    }
}

/// Re-runs a recorded on-chain match: every instruction the program applied to
/// the room's world, in order, with the program's own bookkeeping (wallets and
/// session keys). Each method mirrors one instruction handler and returns false
/// where the program would have rejected the transaction.
#[wasm_bindgen]
pub struct Replay {
    w: World,
    wallets: [[u8; 32]; MAX_PLAYERS],
    sessions: [[u8; 32]; MAX_PLAYERS],
}

fn key32(b: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 32];
    if b.len() == 32 {
        k.copy_from_slice(b);
    }
    k
}

#[wasm_bindgen]
impl Replay {
    /// World right after `reset` with this nonce (or room creation for nonce 0).
    #[wasm_bindgen(constructor)]
    pub fn new(nonce: u32) -> Replay {
        let mut w = World::default();
        w.reset(nonce);
        Replay { w, wallets: [[0; 32]; MAX_PLAYERS], sessions: [[0; 32]; MAX_PLAYERS] }
    }

    fn slot(&self, session: &[u8]) -> Option<u8> {
        let s = key32(session);
        (0..MAX_PLAYERS).find(|&i| self.sessions[i] == s && self.wallets[i] != [0; 32]).map(|i| i as u8)
    }

    pub fn join(&mut self, wallet: &[u8], class: u8, name: &[u8], session: &[u8]) -> bool {
        let wk = key32(wallet);
        if let Some(i) = self.wallets.iter().position(|w| *w == wk) {
            self.sessions[i] = key32(session);
            if self.w.phase == PHASE_LOBBY {
                return sim::set_class(&mut self.w, i as u8, class).is_ok();
            }
            return true;
        }
        let mut n = [0u8; NAME_LEN];
        for (i, b) in name.iter().take(NAME_LEN).enumerate() {
            n[i] = if (b' '..=b'~').contains(b) { *b } else { 0 };
        }
        match sim::join(&mut self.w, class, n) {
            Ok(slot) => {
                self.wallets[slot as usize] = wk;
                self.sessions[slot as usize] = key32(session);
                true
            }
            Err(_) => false,
        }
    }

    pub fn set_class(&mut self, session: &[u8], class: u8) -> bool {
        match self.slot(session) {
            Some(p) => sim::set_class(&mut self.w, p, class).is_ok(),
            None => false,
        }
    }

    pub fn leave(&mut self, session: &[u8]) -> bool {
        let Some(p) = self.slot(session) else { return false };
        if sim::leave(&mut self.w, p).is_err() {
            return false;
        }
        self.wallets[p as usize] = [0; 32];
        self.sessions[p as usize] = [0; 32];
        true
    }

    pub fn start(&mut self, session: &[u8]) -> bool {
        let Some(p) = self.slot(session) else { return false };
        let w = &mut self.w;
        if !(w.phase == PHASE_LOBBY || (w.phase == PHASE_SEEDING && w.seed_src == 0)) || w.host != p {
            return false;
        }
        w.phase = PHASE_SEEDING;
        w.seed_src = 0;
        true
    }

    pub fn seed(&mut self, randomness: &[u8]) -> bool {
        if self.w.phase != PHASE_SEEDING || randomness.len() != 32 {
            return false;
        }
        sim::set_seed(&mut self.w, key32(randomness), 1);
        true
    }

    pub fn begin(&mut self, session: &[u8]) -> bool {
        self.slot(session).is_some() && sim::begin(&mut self.w).is_ok()
    }

    /// Steps the world when the program did (its receipt log says so).
    pub fn tick(&mut self) -> bool {
        if self.w.phase != PHASE_RUNNING {
            return false;
        }
        sim::tick(&mut self.w);
        true
    }

    pub fn act_move(&mut self, session: &[u8], x: i32, y: i32, aim: u8, moving: u8) -> bool {
        let Some(p) = self.slot(session) else { return false };
        sim::act(&mut self.w, p, Action::Move { x, y, aim, moving }).is_ok()
    }

    pub fn combat(&mut self, session: &[u8], kind: u8, aim: u8) -> bool {
        let Some(p) = self.slot(session) else { return false };
        let a = match kind {
            0 => Action::Attack { aim },
            1 => Action::Special { aim },
            2 => Action::Dodge { aim },
            3 => Action::Potion,
            _ => return false,
        };
        sim::act(&mut self.w, p, a).is_ok()
    }

    pub fn interact(&mut self, session: &[u8]) -> bool {
        let Some(p) = self.slot(session) else { return false };
        sim::act(&mut self.w, p, Action::Interact).is_ok()
    }

    pub fn chest(&mut self, randomness: &[u8], chest: u8) -> bool {
        randomness.len() == 32 && sim::resolve_chest(&mut self.w, chest, &key32(randomness)).is_ok()
    }

    pub fn settle(&mut self) -> bool {
        if self.w.phase != PHASE_ENDED || self.w.settled != 0 {
            return false;
        }
        self.w.settled = 1;
        true
    }

    /// Compact encoding: hashed for receipts and decoded by the renderer.
    pub fn bytes(&self) -> Vec<u8> {
        self.w.encode()
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
