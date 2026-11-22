//! Rules of play: lobby, player actions, the world tick, combat, loot and extraction.

use crate::consts::*;
use crate::loot;
use crate::map;
use crate::math::*;
use crate::rng::Rng;
use crate::world::*;
use alloc::vec;
use alloc::vec::Vec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimError {
    WrongPhase,
    BadSlot,
    LobbyFull,
    NotAlive,
    BadClass,
    BadChest,
}

/// Side effects the host environment (Solana program or browser) must perform.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Outcome {
    /// Request VRF randomness for this chest index.
    pub request_chest: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Client-reported position (validated and clamped against speed and walls).
    Move { x: i32, y: i32, aim: u8, moving: u8 },
    Attack { aim: u8 },
    Special { aim: u8 },
    Dodge { aim: u8 },
    Interact,
    Potion,
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

pub fn reset_lobby(w: &mut World, nonce: u32) {
    w.reset(nonce);
}

pub fn join(w: &mut World, class: u8, name: [u8; NAME_LEN]) -> Result<u8, SimError> {
    if w.phase != PHASE_LOBBY {
        return Err(SimError::WrongPhase);
    }
    if class as usize >= CLASSES.len() {
        return Err(SimError::BadClass);
    }
    let slot = w.players.iter().position(|p| p.state == PS_EMPTY).ok_or(SimError::LobbyFull)?;
    let st = &CLASSES[class as usize];
    w.players[slot] = Player {
        state: PS_ALIVE,
        class,
        hp: st.hp,
        max_hp: st.hp,
        last_hit_by: NOBODY,
        name,
        ..Player::default()
    };
    if w.host == NOBODY {
        w.host = slot as u8;
    }
    w.push_event(EV_JOIN, slot as u8, class, 0, 0, 0);
    Ok(slot as u8)
}

pub fn set_class(w: &mut World, p: u8, class: u8) -> Result<(), SimError> {
    if w.phase != PHASE_LOBBY {
        return Err(SimError::WrongPhase);
    }
    if class as usize >= CLASSES.len() {
        return Err(SimError::BadClass);
    }
    let pl = w.players.get_mut(p as usize).ok_or(SimError::BadSlot)?;
    if pl.state == PS_EMPTY {
        return Err(SimError::BadSlot);
    }
    pl.class = class;
    pl.hp = CLASSES[class as usize].hp;
    pl.max_hp = pl.hp;
    Ok(())
}

pub fn leave(w: &mut World, p: u8) -> Result<(), SimError> {
    if w.phase != PHASE_LOBBY {
        return Err(SimError::WrongPhase);
    }
    let pl = w.players.get_mut(p as usize).ok_or(SimError::BadSlot)?;
    *pl = Player::default();
    if w.host == p {
        w.host = w.players.iter().position(|q| q.state != PS_EMPTY).map(|i| i as u8).unwrap_or(NOBODY);
    }
    Ok(())
}

/// Stores the verified seed. Generation happens in `begin` so the VRF callback stays cheap.
pub fn set_seed(w: &mut World, seed: [u8; 32], src: u8) {
    w.seed = seed;
    w.seed_src = src;
    if w.phase == PHASE_LOBBY {
        w.phase = PHASE_SEEDING;
    }
}

/// Generates the dungeon from the stored seed and starts the run.
pub fn begin(w: &mut World) -> Result<(), SimError> {
    if w.phase != PHASE_SEEDING || w.seed_src == 0 {
        return Err(SimError::WrongPhase);
    }
    map::generate(w);
    let mut r = Rng::from_seed(&w.seed, 0x5EED);
    w.rng = r.next_u64();
    let (ex, ey) = w.entrance();
    let offs = [(-1, -1), (1, -1), (-1, 1), (1, 1)];
    for (i, p) in w.players.iter_mut().enumerate() {
        if p.state == PS_EMPTY {
            continue;
        }
        let st = &CLASSES[p.class as usize];
        p.state = PS_ALIVE;
        p.hp = st.hp;
        p.max_hp = st.hp;
        p.x = ex + offs[i].0 * TILE;
        p.y = ey + offs[i].1 * TILE;
        p.potions = 1;
        p.aim = 64;
        p.last_hit_by = NOBODY;
    }
    w.tick = 0;
    w.phase = PHASE_RUNNING;
    w.push_event(EV_START, 0, 0, 0, ex, ey);
    Ok(())
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

pub fn act(w: &mut World, p: u8, action: Action) -> Result<Outcome, SimError> {
    if w.phase != PHASE_RUNNING {
        return Err(SimError::WrongPhase);
    }
    let pi = p as usize;
    if pi >= MAX_PLAYERS {
        return Err(SimError::BadSlot);
    }
    if !w.players[pi].alive() {
        return Err(SimError::NotAlive);
    }
    w.players[pi].active_tick = w.tick;
    let mut out = Outcome::default();
    match action {
        Action::Move { x, y, aim, moving } => act_move(w, pi, x, y, aim, moving),
        Action::Attack { aim } => act_attack(w, pi, aim),
        Action::Special { aim } => act_special(w, pi, aim),
        Action::Dodge { aim } => act_dodge(w, pi, aim),
        Action::Interact => out.request_chest = act_interact(w, pi),
        Action::Potion => act_potion(w, pi),
    }
    Ok(out)
}

fn player_speed(w: &World, pi: usize) -> i32 {
    let p = &w.players[pi];
    let base = CLASSES[p.class as usize].speed;
    if w.tick <= p.dodge_until {
        base * DODGE_SPEED_MULT
    } else {
        base
    }
}

/// Moves a circle from (x,y) by (dx,dy) with wall sliding. Returns the new position.
pub fn slide(w: &World, x: i32, y: i32, dx: i32, dy: i32, r: i32) -> (i32, i32) {
    let len = abs_max(dx, dy);
    let steps = (len / 48 + 1).max(1);
    let (mut cx, mut cy) = (x, y);
    for s in 1..=steps {
        let tx = x + dx * s / steps;
        let ty = y + dy * s / steps;
        if w.free_at(tx, cy, r) {
            cx = tx;
        }
        if w.free_at(cx, ty, r) {
            cy = ty;
        }
    }
    (cx, cy)
}

fn abs_max(a: i32, b: i32) -> i32 {
    a.abs().max(b.abs())
}

fn act_move(w: &mut World, pi: usize, x: i32, y: i32, aim: u8, moving: u8) {
    let speed = player_speed(w, pi);
    let now16 = w.tick * 16 + 16;
    let p = w.players[pi];
    // Movement budget: a client can never travel faster than its class speed,
    // with a little slack for network jitter.
    let floor16 = w.tick.saturating_sub(MOVE_SLACK_TICKS as u32) * 16;
    let cursor = p.last_move_tick.max(floor16);
    let avail16 = now16.saturating_sub(cursor) as i64;
    let max_d = speed as i64 * avail16 / 16;
    let mut dx = (x - p.x) as i64;
    let mut dy = (y - p.y) as i64;
    let d = isqrt(dx * dx + dy * dy);
    if d > max_d && d > 0 {
        dx = dx * max_d / d;
        dy = dy * max_d / d;
    }
    let (nx, ny) = slide(w, p.x, p.y, dx as i32, dy as i32, PLAYER_RADIUS);
    let moved = dist(p.x, p.y, nx, ny) as i64;
    let used16 = if speed > 0 { (moved * 16 + speed as i64 - 1) / speed as i64 } else { 0 };
    let pl = &mut w.players[pi];
    pl.x = nx;
    pl.y = ny;
    pl.aim = aim;
    pl.moving = moving;
    pl.last_move_tick = cursor + used16 as u32;
    pickup_for(w, pi);
}

fn blade_mult(p: &Player) -> u32 {
    100 + 12 * p.blade_tier()
}

fn act_attack(w: &mut World, pi: usize, aim: u8) {
    let p = w.players[pi];
    if w.tick < p.atk_ready {
        return;
    }
    let st = &CLASSES[p.class as usize];
    w.players[pi].atk_ready = w.tick + st.atk_cd;
    w.players[pi].aim = aim;
    w.push_event(EV_ATTACK, pi as u8, aim, p.class, p.x, p.y);
    let mut dmg = st.atk_dmg as u32 * blade_mult(&p) / 100;
    if p.class == CLASS_ARCANIST {
        let fx = cos256(aim);
        let fy = sin256(aim);
        spawn_projectile(w, PROJ_BOLT, pi as u8, p.x + fx * 100 / 1024, p.y + fy * 100 / 1024, fx * 330 / 1024, fy * 330 / 1024, dmg as u16, 10);
        return;
    }
    if p.class == CLASS_ROGUE && p.crit == 1 {
        dmg *= 2;
        w.players[pi].crit = 0;
    }
    melee_sweep(w, pi, aim, st.atk_range, st.atk_cos, dmg as u16);
}

fn in_arc(ox: i32, oy: i32, aim: u8, tx: i32, ty: i32, reach: i32, cos_min: i32) -> bool {
    let dx = (tx - ox) as i64;
    let dy = (ty - oy) as i64;
    let d2 = dx * dx + dy * dy;
    if d2 > reach as i64 * reach as i64 {
        return false;
    }
    if d2 < 120 * 120 {
        return true;
    }
    let d = isqrt(d2);
    let dot = dx * cos256(aim) as i64 + dy * sin256(aim) as i64; // scaled 1024
    dot >= cos_min as i64 * d
}

fn melee_sweep(w: &mut World, pi: usize, aim: u8, range: i32, cos_min: i32, dmg: u16) {
    let (ox, oy) = (w.players[pi].x, w.players[pi].y);
    for mi in 0..MAX_MONSTERS {
        let m = w.monsters[mi];
        if !m.alive() {
            continue;
        }
        if in_arc(ox, oy, aim, m.x, m.y, range + MONSTER_RADIUS, cos_min) {
            damage_monster(w, mi, dmg, pi as u8);
        }
    }
    for ti in 0..MAX_PLAYERS {
        if ti == pi || !w.players[ti].alive() {
            continue;
        }
        let t = w.players[ti];
        if in_arc(ox, oy, aim, t.x, t.y, range + PLAYER_RADIUS, cos_min) {
            damage_player(w, ti, dmg, pi as u8);
        }
    }
}

fn act_special(w: &mut World, pi: usize, aim: u8) {
    let p = w.players[pi];
    if w.tick < p.spec_ready {
        return;
    }
    let st = &CLASSES[p.class as usize];
    w.players[pi].spec_ready = w.tick + st.spec_cd;
    w.players[pi].aim = aim;
    match p.class {
        CLASS_VANGUARD => {
            w.players[pi].shield_until = w.tick + SHIELD_TICKS;
            w.push_event(EV_SHIELD, pi as u8, aim, 0, p.x, p.y);
            // Shield bash: short stun and knockback in front.
            for mi in 0..MAX_MONSTERS {
                let m = w.monsters[mi];
                if m.alive() && in_arc(p.x, p.y, aim, m.x, m.y, TILE * 2, 200) {
                    if m.kind != MON_KING {
                        w.monsters[mi].stun_until = w.tick + 12;
                        if w.monsters[mi].state == MS_WINDUP {
                            w.monsters[mi].state = MS_RECOVER;
                            w.monsters[mi].timer = w.tick + 12;
                        }
                        let (nx, ny) = slide(w, m.x, m.y, cos256(aim) * 200 / 1024, sin256(aim) * 200 / 1024, MONSTER_RADIUS);
                        w.monsters[mi].x = nx;
                        w.monsters[mi].y = ny;
                    }
                    damage_monster(w, mi, 10, pi as u8);
                }
            }
        }
        CLASS_ARCANIST => {
            let fx = cos256(aim);
            let fy = sin256(aim);
            let dmg = FIREBALL_DMG as u32 * blade_mult(&p) / 100;
            spawn_projectile(w, PROJ_FIREBALL, pi as u8, p.x + fx * 110 / 1024, p.y + fy * 110 / 1024, fx * 230 / 1024, fy * 230 / 1024, dmg as u16, 16);
            w.push_event(EV_ATTACK, pi as u8, aim, 10, p.x, p.y);
        }
        _ => {
            // Shadow Step: blink along aim until a wall, gain invulnerability and a crit.
            let fx = cos256(aim);
            let fy = sin256(aim);
            let (mut bx, mut by) = (p.x, p.y);
            let mut travelled = 0;
            while travelled < BLINK_DIST {
                let nx = bx + fx * 32 / 1024;
                let ny = by + fy * 32 / 1024;
                if !w.free_at(nx, ny, PLAYER_RADIUS) {
                    break;
                }
                bx = nx;
                by = ny;
                travelled += 32;
            }
            let pl = &mut w.players[pi];
            pl.x = bx;
            pl.y = by;
            pl.crit = 1;
            pl.invuln_until = w.tick + 4;
            pl.last_move_tick = w.tick * 16 + 16;
            w.push_event(EV_BLINK, pi as u8, aim, 0, p.x, p.y);
            pickup_for(w, pi);
        }
    }
}

fn act_dodge(w: &mut World, pi: usize, aim: u8) {
    let p = w.players[pi];
    if w.tick < p.dodge_ready {
        return;
    }
    let pl = &mut w.players[pi];
    pl.dodge_until = w.tick + DODGE_TICKS;
    pl.invuln_until = w.tick + DODGE_TICKS;
    pl.dodge_ready = w.tick + DODGE_COOLDOWN;
    pl.aim = aim;
    w.push_event(EV_DODGE, pi as u8, aim, 0, p.x, p.y);
}

fn act_potion(w: &mut World, pi: usize) {
    let p = w.players[pi];
    if p.potions == 0 || w.tick < p.potion_ready || p.hp >= p.max_hp {
        return;
    }
    let pl = &mut w.players[pi];
    pl.potions -= 1;
    pl.hp = (pl.hp + POTION_HEAL).min(pl.max_hp);
    pl.potion_ready = w.tick + POTION_COOLDOWN;
    w.push_event(EV_POTION, pi as u8, 0, 0, p.x, p.y);
}

fn boss_alive(w: &World) -> bool {
    let b = w.boss_idx as usize;
    b < MAX_MONSTERS && w.monsters[b].alive()
}

fn act_interact(w: &mut World, pi: usize) -> Option<u8> {
    let p = w.players[pi];
    // Vault door
    if map::has_door(w) && w.door.open == 0 {
        let d = w.door;
        let (dx, dy) = if d.vertical == 1 {
            (d.tx as i32 * TILE + TILE / 2, d.ty as i32 * TILE + TILE)
        } else {
            (d.tx as i32 * TILE + TILE, d.ty as i32 * TILE + TILE / 2)
        };
        if dist(p.x, p.y, dx, dy) <= INTERACT_RADIUS + TILE / 2 && p.keys > 0 {
            w.players[pi].keys -= 1;
            w.door.open = 1;
            map::set_door_walls(w, false);
            w.push_event(EV_DOOR, pi as u8, 0, 0, dx, dy);
            return None;
        }
    }
    // Nearest chest
    let mut best: Option<(i32, usize)> = None;
    for (ci, c) in w.chests.iter().enumerate() {
        if c.tx == 0 && c.ty == 0 {
            continue;
        }
        let ready = c.state == CHEST_CLOSED || (c.state == CHEST_PENDING && w.tick >= c.req_tick + CHEST_RETRY_TICKS);
        if !ready {
            continue;
        }
        if c.tier == CHEST_BOSS && boss_alive(w) {
            continue;
        }
        let cx = c.tx as i32 * TILE + TILE / 2;
        let cy = c.ty as i32 * TILE + TILE / 2;
        let d = dist(p.x, p.y, cx, cy);
        if d <= INTERACT_RADIUS && best.map_or(true, |(bd, _)| d < bd) {
            best = Some((d, ci));
        }
    }
    let (_, ci) = best?;
    let c = &mut w.chests[ci];
    c.state = CHEST_PENDING;
    c.opener = pi as u8;
    c.req_tick = w.tick;
    let (cx, cy) = (c.tx as i32 * TILE + TILE / 2, c.ty as i32 * TILE + TILE / 2);
    w.push_event(EV_CHEST_OPEN, ci as u8, pi as u8, 0, cx, cy);
    Some(ci as u8)
}

/// Applies VRF randomness to a pending chest and spills its loot.
pub fn resolve_chest(w: &mut World, ci: u8, randomness: &[u8; 32]) -> Result<(), SimError> {
    let ci = ci as usize;
    if ci >= MAX_CHESTS || w.chests[ci].state != CHEST_PENDING {
        return Err(SimError::BadChest);
    }
    let c = w.chests[ci];
    let key_useful = map::has_door(w) && w.door.open == 0;
    let items = loot::roll_chest(randomness, c.tier, key_useful);
    w.chests[ci].state = CHEST_OPEN;
    let cx = c.tx as i32 * TILE + TILE / 2;
    let cy = c.ty as i32 * TILE + TILE / 2;
    let n = items.len() as i32;
    for (k, it) in items.iter().enumerate() {
        let a = (k as i32 * 256 / n.max(1) + 32) as u8;
        spill(w, *it, cx, cy, a, NOBODY);
        w.push_event(EV_LOOT, ci as u8, it.kind, it.rarity, cx, cy);
    }
    Ok(())
}

/// Places an item on the floor near (x,y) in direction `a`, on a free spot.
fn spill(w: &mut World, item: Item, x: i32, y: i32, a: u8, from: u8) {
    let Some(slot) = w.drops.iter().position(|d| d.item.is_empty()) else { return };
    let mut px = x;
    let mut py = y;
    for r in [220, 160, 100, 40, 0] {
        let tx = x + cos256(a) * r / 1024;
        let ty = y + sin256(a) * r / 1024;
        if w.free_at(tx, ty, 40) {
            px = tx;
            py = ty;
            break;
        }
    }
    w.drops[slot] = Drop { item, x: px, y: py, spawn_tick: w.tick, from };
}

fn pickup_for(w: &mut World, pi: usize) {
    let p = w.players[pi];
    if !p.alive() {
        return;
    }
    for di in 0..MAX_DROPS {
        let d = w.drops[di];
        if d.item.is_empty() {
            continue;
        }
        let delay = if d.from as usize == pi { PICKUP_DELAY * 5 } else { PICKUP_DELAY };
        if w.tick < d.spawn_tick + delay {
            continue;
        }
        if dist2(p.x, p.y, d.x, d.y) > (PICKUP_RADIUS as i64) * (PICKUP_RADIUS as i64) {
            continue;
        }
        let pl = &mut w.players[pi];
        let taken = match d.item.kind {
            ITEM_POTION => {
                if pl.potions < MAX_POTIONS {
                    pl.potions += 1;
                    true
                } else {
                    false
                }
            }
            ITEM_KEY => {
                pl.keys = pl.keys.saturating_add(1);
                true
            }
            _ => match pl.free_slot() {
                Some(s) => {
                    pl.inv[s] = d.item;
                    if d.item.kind == ITEM_AEGIS {
                        // Aegis raises max health by 8 per tier.
                        let bonus = 8 * (d.item.rarity as u16 + 1);
                        pl.max_hp += bonus;
                        pl.hp += bonus;
                    }
                    true
                }
                None => {
                    // Full pack: swap out the least valuable item if this one is worth more.
                    let (s, worst) = pl.inv.iter().enumerate().min_by_key(|(_, i)| i.value()).map(|(s, i)| (s, *i)).unwrap();
                    if d.item.value() > worst.value() {
                        pl.inv[s] = d.item;
                        if worst.kind == ITEM_AEGIS {
                            let bonus = 8 * (worst.rarity as u16 + 1);
                            pl.max_hp = pl.max_hp.saturating_sub(bonus).max(1);
                            pl.hp = pl.hp.min(pl.max_hp);
                        }
                        if d.item.kind == ITEM_AEGIS {
                            let bonus = 8 * (d.item.rarity as u16 + 1);
                            pl.max_hp += bonus;
                            pl.hp += bonus;
                        }
                        // The dropped item stays where the new one was; its owner cannot instantly re-take it.
                        w.drops[di] = Drop { item: worst, x: d.x, y: d.y, spawn_tick: w.tick, from: pi as u8 };
                        w.push_event(EV_PICKUP, pi as u8, d.item.kind, d.item.rarity, d.x, d.y);
                    }
                    false
                }
            },
        };
        if taken {
            w.drops[di] = Drop::default();
            w.push_event(EV_PICKUP, pi as u8, d.item.kind, d.item.rarity, d.x, d.y);
        }
    }
}

fn spawn_projectile(w: &mut World, kind: u8, owner: u8, x: i32, y: i32, vx: i32, vy: i32, dmg: u16, ttl: u8) {
    if let Some(s) = w.projectiles.iter().position(|p| p.kind == PROJ_NONE) {
        w.projectiles[s] = Projectile { kind, owner, x, y, vx, vy, dmg, ttl };
    }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

pub fn damage_player(w: &mut World, ti: usize, amount: u16, src: u8) {
    let t = w.players[ti];
    if !t.alive() || w.tick <= t.invuln_until {
        return;
    }
    let mut a = amount as u32;
    if src >= SRC_MONSTER && src < SRC_WORLD {
        a = a * (100 + w.corruption() / 2) / 100;
    }
    if w.tick <= t.shield_until {
        a = a * 25 / 100;
    }
    a = a * (100 - 6 * t.aegis_tier().min(5)) / 100;
    let a = a.max(1).min(u16::MAX as u32) as u16;
    let pl = &mut w.players[ti];
    pl.hp = pl.hp.saturating_sub(a);
    pl.extract = 0;
    if src < MAX_PLAYERS as u8 {
        pl.last_hit_by = src;
        pl.last_hit_tick = w.tick;
    }
    let dead = pl.hp == 0;
    w.push_event(EV_HIT_PLAYER, ti as u8, src, a.min(255) as u8, t.x, t.y);
    if dead {
        kill_player(w, ti, src);
    }
}

fn kill_player(w: &mut World, ti: usize, src: u8) {
    let t = w.players[ti];
    w.players[ti].state = PS_DEAD;
    // A monster finishing someone recently hit by a player still counts as that player's betrayal.
    let killer = if src < MAX_PLAYERS as u8 {
        src
    } else if t.last_hit_by != NOBODY && w.tick <= t.last_hit_tick + 50 {
        t.last_hit_by
    } else {
        src
    };
    let mut dropped = 0u8;
    let n = t.inv.iter().filter(|i| !i.is_empty()).count() as i32 + t.potions as i32 + t.keys as i32;
    let mut k = 0i32;
    for it in t.inv.iter() {
        if !it.is_empty() {
            spill(w, *it, t.x, t.y, (k * 256 / n.max(1)) as u8, NOBODY);
            k += 1;
            dropped += 1;
        }
    }
    for _ in 0..t.potions {
        spill(w, Item { kind: ITEM_POTION, rarity: 0 }, t.x, t.y, (k * 256 / n.max(1)) as u8, NOBODY);
        k += 1;
    }
    for _ in 0..t.keys {
        spill(w, Item { kind: ITEM_KEY, rarity: 0 }, t.x, t.y, (k * 256 / n.max(1)) as u8, NOBODY);
        k += 1;
    }
    let pl = &mut w.players[ti];
    pl.inv = [Item::EMPTY; INV_SLOTS];
    pl.potions = 0;
    pl.keys = 0;
    pl.extract = 0;
    w.push_event(EV_PLAYER_DIE, ti as u8, killer, 0, t.x, t.y);
    if killer < MAX_PLAYERS as u8 && killer as usize != ti {
        let kp = &mut w.players[killer as usize];
        kp.pvp_kills = kp.pvp_kills.saturating_add(1);
        w.push_event(EV_BETRAYAL, killer, ti as u8, dropped, t.x, t.y);
    }
}

pub fn damage_monster(w: &mut World, mi: usize, amount: u16, src: u8) {
    let m = w.monsters[mi];
    if !m.alive() {
        return;
    }
    let before = m.hp;
    let a = amount.min(m.hp);
    w.monsters[mi].hp -= a;
    if (src as usize) < MAX_PLAYERS {
        let p = &mut w.players[src as usize];
        p.dmg_dealt = p.dmg_dealt.saturating_add(a as u32);
        if mi == w.boss_idx as usize {
            w.boss_dmg[src as usize] = w.boss_dmg[src as usize].saturating_add(a as u32);
        }
        // Being hit pulls aggro.
        w.monsters[mi].target = src;
        if w.monsters[mi].state == MS_IDLE {
            w.monsters[mi].state = MS_CHASE;
        }
    }
    w.push_event(EV_HIT_MON, mi as u8, src, amount.min(255) as u8, m.x, m.y);
    // Boss enrage at half health: summon guards.
    if m.kind == MON_KING && before > m.max_hp / 2 && w.monsters[mi].hp <= m.max_hp / 2 && w.monsters[mi].hp > 0 {
        w.push_event(EV_BOSS_RAGE, mi as u8, 0, 0, m.x, m.y);
        for k in 0..3u8 {
            let a = k.wrapping_mul(85);
            let sx = m.x + cos256(a) * 400 / 1024;
            let sy = m.y + sin256(a) * 400 / 1024;
            if w.free_at(sx, sy, MONSTER_RADIUS) {
                if let Some(s) = map::spawn_monster_pub(w, MON_SKELETON, sx, sy, m.room, true) {
                    w.monsters[s].state = MS_CHASE;
                    w.push_event(EV_SPAWN, s as u8, MON_SKELETON, 0, sx, sy);
                }
            }
        }
    }
    if w.monsters[mi].hp == 0 {
        kill_monster(w, mi, src);
    }
}

fn kill_monster(w: &mut World, mi: usize, src: u8) {
    let m = w.monsters[mi];
    w.monsters[mi].state = MS_DEAD;
    w.monsters[mi].timer = w.tick;
    if (src as usize) < MAX_PLAYERS {
        let p = &mut w.players[src as usize];
        p.kills = p.kills.saturating_add(1);
    }
    w.push_event(EV_MON_DIE, mi as u8, src, m.kind, m.x, m.y);
    let mut rng = Rng::new(w.rng);
    if let Some(it) = loot::roll_monster_drop(&mut rng, m.kind, m.elite == 1) {
        let a = rng.below(256) as u8;
        spill(w, it, m.x, m.y, a, NOBODY);
        w.push_event(EV_LOOT, 255, it.kind, it.rarity, m.x, m.y);
    }
    // Shared boss rewards: every contributor gets an individual drop.
    if m.kind == MON_KING {
        for pi in 0..MAX_PLAYERS {
            if w.boss_dmg[pi] == 0 || w.players[pi].state == PS_EMPTY {
                continue;
            }
            if let Some(it) = loot::roll_monster_drop(&mut rng, MON_KING, true) {
                let a = (pi as u8).wrapping_mul(64).wrapping_add(16);
                spill(w, it, m.x, m.y, a, NOBODY);
                w.push_event(EV_LOOT, 254, it.kind, it.rarity, m.x, m.y);
            }
        }
    }
    w.rng = rng.state;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

pub fn tick(w: &mut World) {
    if w.phase != PHASE_RUNNING {
        return;
    }
    w.tick += 1;
    let t = w.tick;

    if t == w.elite_tick {
        spawn_elites(w);
    }
    if t == w.portal_tick {
        let (x, y) = w.entrance();
        w.push_event(EV_PORTALS, 0, 0, 0, x, y);
    }
    if t > w.portal_tick && (t - w.portal_tick) % WAVE_INTERVAL == 0 && t < w.collapse_tick {
        spawn_wave(w);
    }
    if t >= w.collapse_tick {
        let (x, y) = w.entrance();
        w.push_event(EV_COLLAPSE, 0, 0, 0, x, y);
        for pi in 0..MAX_PLAYERS {
            if w.players[pi].alive() {
                // Unbanked loot is lost with the dungeon.
                w.players[pi].inv = [Item::EMPTY; INV_SLOTS];
                w.players[pi].hp = 0;
                w.players[pi].state = PS_DEAD;
                let (px, py) = (w.players[pi].x, w.players[pi].y);
                w.push_event(EV_PLAYER_DIE, pi as u8, SRC_WORLD, 0, px, py);
            }
        }
        w.phase = PHASE_ENDED;
        return;
    }

    update_projectiles(w);
    update_monsters(w);

    let open = w.portals_open();
    for pi in 0..MAX_PLAYERS {
        if !w.players[pi].alive() {
            continue;
        }
        pickup_for(w, pi);
        if open {
            let (px, py) = (w.players[pi].x, w.players[pi].y);
            let in_portal = w.portals.iter().any(|po| {
                (po.tx != 0 || po.ty != 0) && dist(px, py, po.tx as i32 * TILE + TILE / 2, po.ty as i32 * TILE + TILE / 2) <= PORTAL_RADIUS
            });
            if in_portal {
                w.players[pi].extract += 1;
                if w.players[pi].extract >= EXTRACT_TICKS {
                    let pl = &mut w.players[pi];
                    pl.state = PS_EXTRACTED;
                    pl.banked = pl.loot_value();
                    w.push_event(EV_EXTRACT, pi as u8, 0, 0, px, py);
                }
            } else {
                w.players[pi].extract = 0;
            }
        }
    }

    // Free long-dead monster slots so waves can reuse them.
    for m in w.monsters.iter_mut() {
        if m.kind != MON_NONE && m.hp == 0 && t > m.timer + 60 && m.kind != MON_KING {
            *m = Monster::default();
        }
    }

    let joined = w.players.iter().any(|p| p.state != PS_EMPTY);
    if joined && !w.players.iter().any(|p| p.alive()) {
        w.phase = PHASE_ENDED;
    }
}

fn far_from_players(w: &World, x: i32, y: i32, min_d: i32) -> bool {
    w.players.iter().all(|p| !p.alive() || dist(p.x, p.y, x, y) >= min_d)
}

fn spawn_elites(w: &mut World) {
    let (x, y) = w.entrance();
    w.push_event(EV_ELITES, 0, 0, 0, x, y);
    let mut rng = Rng::new(w.rng);
    let mut spawned = 0;
    let n = w.room_count as usize;
    for _ in 0..12 {
        if spawned >= 3 || n < 2 {
            break;
        }
        let ri = 1 + rng.below((n - 1) as u32) as usize;
        let r = w.rooms[ri];
        if r.kind == ROOM_BOSS || r.kind == ROOM_VAULT {
            continue;
        }
        let (cx, cy) = (r.cx(), r.cy());
        if !far_from_players(w, cx, cy, TILE * 6) || !w.free_at(cx, cy, MONSTER_RADIUS) {
            continue;
        }
        let kind = if spawned == 0 { MON_BRUTE } else if rng.chance(50) { MON_NECRO } else { MON_SKELETON };
        if let Some(s) = map::spawn_monster_pub(w, kind, cx, cy, ri as u8, true) {
            w.push_event(EV_SPAWN, s as u8, kind, 1, cx, cy);
            spawned += 1;
        }
    }
    w.rng = rng.state;
}

fn spawn_wave(w: &mut World) {
    w.wave = w.wave.saturating_add(1);
    let (x, y) = w.entrance();
    w.push_event(EV_WAVE, w.wave, 0, 0, x, y);
    let mut rng = Rng::new(w.rng);
    let want = (2 + w.wave as usize).min(6);
    let n = w.room_count as usize;
    let mut spawned = 0;
    for _ in 0..20 {
        if spawned >= want || n < 2 {
            break;
        }
        let ri = rng.below(n as u32) as usize;
        let r = w.rooms[ri];
        let t = (rng.range(r.x as i32 + 1, (r.x + r.w) as i32 - 2), rng.range(r.y as i32 + 1, (r.y + r.h) as i32 - 2));
        let (sx, sy) = (t.0 * TILE + TILE / 2, t.1 * TILE + TILE / 2);
        if !far_from_players(w, sx, sy, TILE * 5) || !w.free_at(sx, sy, MONSTER_RADIUS) {
            continue;
        }
        if let Some(s) = map::spawn_monster_pub(w, MON_IMP, sx, sy, ri as u8, false) {
            w.monsters[s].state = MS_CHASE;
            w.push_event(EV_SPAWN, s as u8, MON_IMP, 0, sx, sy);
            spawned += 1;
        }
    }
    w.rng = rng.state;
}

fn update_projectiles(w: &mut World) {
    for si in 0..MAX_PROJECTILES {
        let pr = w.projectiles[si];
        if pr.kind == PROJ_NONE {
            continue;
        }
        let steps = (abs_max(pr.vx, pr.vy) / 64 + 1).max(1);
        let mut x = pr.x;
        let mut y = pr.y;
        let mut done = false;
        for s in 1..=steps {
            let nx = pr.x + pr.vx * s / steps;
            let ny = pr.y + pr.vy * s / steps;
            if w.is_wall(nx.div_euclid(TILE), ny.div_euclid(TILE)) {
                done = true;
                break;
            }
            x = nx;
            y = ny;
            if projectile_hit(w, si, x, y) {
                done = true;
                break;
            }
        }
        w.projectiles[si].x = x;
        w.projectiles[si].y = y;
        if !done {
            if pr.ttl <= 1 {
                done = true;
            } else {
                w.projectiles[si].ttl -= 1;
            }
        }
        if done {
            if pr.kind == PROJ_FIREBALL {
                explode(w, x, y, pr.dmg, pr.owner);
            }
            w.projectiles[si] = Projectile::default();
        }
    }
}

/// Direct hit test. Returns true when the projectile is consumed.
fn projectile_hit(w: &mut World, si: usize, x: i32, y: i32) -> bool {
    let pr = w.projectiles[si];
    let from_player = (pr.owner as usize) < MAX_PLAYERS;
    if from_player {
        for mi in 0..MAX_MONSTERS {
            let m = w.monsters[mi];
            if m.alive() && dist2(x, y, m.x, m.y) <= ((MONSTER_RADIUS + 50) as i64).pow(2) {
                if pr.kind != PROJ_FIREBALL {
                    damage_monster(w, mi, pr.dmg, pr.owner);
                }
                return true;
            }
        }
    }
    for ti in 0..MAX_PLAYERS {
        if from_player && ti == pr.owner as usize {
            continue;
        }
        let t = w.players[ti];
        if t.alive() && dist2(x, y, t.x, t.y) <= ((PLAYER_RADIUS + 50) as i64).pow(2) {
            if w.tick <= t.invuln_until {
                continue;
            }
            if pr.kind != PROJ_FIREBALL {
                damage_player(w, ti, pr.dmg, pr.owner);
            }
            return true;
        }
    }
    false
}

fn explode(w: &mut World, x: i32, y: i32, dmg: u16, owner: u8) {
    w.push_event(EV_BOOM, owner, 0, 0, x, y);
    let r2 = (FIREBALL_RADIUS as i64).pow(2);
    for mi in 0..MAX_MONSTERS {
        let m = w.monsters[mi];
        if m.alive() && dist2(x, y, m.x, m.y) <= r2 {
            damage_monster(w, mi, dmg, owner);
        }
    }
    for ti in 0..MAX_PLAYERS {
        if ti == owner as usize {
            continue;
        }
        let t = w.players[ti];
        if t.alive() && dist2(x, y, t.x, t.y) <= r2 {
            damage_player(w, ti, dmg * 3 / 4, owner);
        }
    }
}

/// True when the straight line between two points crosses no wall.
pub fn line_clear(w: &World, ax: i32, ay: i32, bx: i32, by: i32) -> bool {
    let d = dist(ax, ay, bx, by);
    let steps = (d / 96 + 1).max(1);
    for s in 1..steps {
        let x = ax + (bx - ax) * s / steps;
        let y = ay + (by - ay) * s / steps;
        if w.is_wall(x.div_euclid(TILE), y.div_euclid(TILE)) {
            return false;
        }
    }
    true
}

/// Breadth-first distance field from all living players, limited radius.
fn flow_field(w: &World, max_depth: u16) -> Vec<u16> {
    let mut f = vec![u16::MAX; MAP_W * MAP_H];
    let mut q: Vec<u16> = Vec::with_capacity(MAP_W * MAP_H);
    for p in w.players.iter() {
        if !p.alive() {
            continue;
        }
        let (tx, ty) = (p.x.div_euclid(TILE), p.y.div_euclid(TILE));
        if w.is_wall(tx, ty) {
            continue;
        }
        let i = ty as usize * MAP_W + tx as usize;
        if f[i] != 0 {
            f[i] = 0;
            q.push(i as u16);
        }
    }
    let mut head = 0;
    while head < q.len() {
        let c = q[head] as usize;
        let (x, y) = ((c % MAP_W) as i32, (c / MAP_W) as i32);
        head += 1;
        let d = f[y as usize * MAP_W + x as usize];
        if d >= max_depth {
            continue;
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let nx = x + dx;
            let ny = y + dy;
            if w.is_wall(nx, ny) {
                continue;
            }
            let i = ny as usize * MAP_W + nx as usize;
            if f[i] == u16::MAX {
                f[i] = d + 1;
                q.push(i as u16);
            }
        }
    }
    f
}

fn update_monsters(w: &mut World) {
    let any_active = w.monsters.iter().any(|m| m.alive() && m.state != MS_IDLE);
    let flow = if any_active { flow_field(w, 18) } else { Vec::new() };
    let corruption = w.corruption() as i32;
    for mi in 0..MAX_MONSTERS {
        let m = w.monsters[mi];
        if !m.alive() {
            continue;
        }
        if w.tick < m.stun_until {
            continue;
        }
        let st = &MONSTERS[m.kind as usize];

        // Target selection: keep current target while in a leash range, else nearest.
        let mut target = m.target;
        if (target as usize) < MAX_PLAYERS {
            let tp = w.players[target as usize];
            if !tp.alive() || dist(m.x, m.y, tp.x, tp.y) > st.aggro * 3 / 2 {
                target = NOBODY;
            }
        } else {
            target = NOBODY;
        }
        if target == NOBODY {
            let mut best = i32::MAX;
            for (pi, p) in w.players.iter().enumerate() {
                if !p.alive() {
                    continue;
                }
                let d = dist(m.x, m.y, p.x, p.y);
                let aggro = if m.state == MS_IDLE { st.aggro } else { st.aggro * 3 / 2 };
                if d < aggro && d < best && (m.state != MS_IDLE || d < TILE * 3 || line_clear(w, m.x, m.y, p.x, p.y)) {
                    best = d;
                    target = pi as u8;
                }
            }
        }
        w.monsters[mi].target = target;

        match m.state {
            MS_IDLE | MS_CHASE => {
                if target == NOBODY {
                    w.monsters[mi].state = MS_IDLE;
                    continue;
                }
                w.monsters[mi].state = MS_CHASE;
                let tp = w.players[target as usize];
                let d = dist(m.x, m.y, tp.x, tp.y);
                let aim = angle_to(m.x, m.y, tp.x, tp.y);
                w.monsters[mi].aim = aim;
                let can_attack = w.tick >= m.atk_ready
                    && if st.ranged { d <= st.range && line_clear(w, m.x, m.y, tp.x, tp.y) } else { d <= st.range + PLAYER_RADIUS };
                if can_attack {
                    let wind = if m.elite == 1 { st.windup.saturating_sub(1).max(2) } else { st.windup };
                    w.monsters[mi].state = MS_WINDUP;
                    w.monsters[mi].timer = w.tick + wind;
                    w.push_event(EV_WINDUP, mi as u8, target, m.kind, m.x, m.y);
                    continue;
                }
                let mut speed = st.speed * (100 + corruption / 4) / 100;
                if m.elite == 1 {
                    speed = speed * 11 / 10;
                }
                let (mut gx, mut gy) = (tp.x, tp.y);
                let mut away = false;
                if st.ranged && d < TILE * 3 {
                    away = true;
                } else if !line_clear(w, m.x, m.y, tp.x, tp.y) && !flow.is_empty() {
                    // Follow the distance field around corners.
                    let (tx, ty) = (m.x.div_euclid(TILE), m.y.div_euclid(TILE));
                    let mut best = u16::MAX;
                    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                        let nx = tx + dx;
                        let ny = ty + dy;
                        if w.is_wall(nx, ny) {
                            continue;
                        }
                        if dx != 0 && dy != 0 && (w.is_wall(tx + dx, ty) || w.is_wall(tx, ty + dy)) {
                            continue;
                        }
                        let v = flow[ny as usize * MAP_W + nx as usize];
                        if v < best {
                            best = v;
                            gx = nx * TILE + TILE / 2;
                            gy = ny * TILE + TILE / 2;
                        }
                    }
                }
                let ga = angle_to(m.x, m.y, gx, gy);
                let (vx, vy) = if away {
                    (-cos256(aim) * speed / 1024, -sin256(aim) * speed / 1024)
                } else {
                    let gd = dist(m.x, m.y, gx, gy).max(1);
                    let s = speed.min(gd);
                    (cos256(ga) * s / 1024, sin256(ga) * s / 1024)
                };
                let stop = !st.ranged && d <= st.range + PLAYER_RADIUS - 40;
                if !stop {
                    let (nx, ny) = slide(w, m.x, m.y, vx, vy, MONSTER_RADIUS);
                    w.monsters[mi].x = nx;
                    w.monsters[mi].y = ny;
                }
            }
            MS_WINDUP => {
                if w.tick < m.timer {
                    continue;
                }
                monster_strike(w, mi);
                let cd = if m.elite == 1 { st.cd * 3 / 4 } else { st.cd };
                w.monsters[mi].atk_ready = w.tick + cd;
                w.monsters[mi].state = MS_RECOVER;
                w.monsters[mi].timer = w.tick + 4;
            }
            MS_RECOVER => {
                if w.tick >= m.timer {
                    w.monsters[mi].state = MS_CHASE;
                }
            }
            _ => {}
        }
    }
    separate_monsters(w);
}

fn monster_strike(w: &mut World, mi: usize) {
    let m = w.monsters[mi];
    let st = &MONSTERS[m.kind as usize];
    let mut dmg = st.dmg as u32;
    if m.elite == 1 {
        dmg = dmg * 14 / 10;
    }
    let dmg = dmg as u16;
    let src = SRC_MONSTER;
    match m.kind {
        MON_NECRO => {
            let fx = cos256(m.aim);
            let fy = sin256(m.aim);
            spawn_projectile(w, PROJ_BONE, src, m.x + fx * 100 / 1024, m.y + fy * 100 / 1024, fx * 170 / 1024, fy * 170 / 1024, dmg, 24);
        }
        MON_BRUTE | MON_KING => {
            w.push_event(EV_SLAM, mi as u8, m.kind, 0, m.x, m.y);
            let r = st.range + PLAYER_RADIUS;
            for ti in 0..MAX_PLAYERS {
                let t = w.players[ti];
                if t.alive() && dist(m.x, m.y, t.x, t.y) <= r {
                    damage_player(w, ti, dmg, src);
                }
            }
            // The king also fires a ring of orbs every few strikes.
            if m.kind == MON_KING {
                let mut rng = Rng::new(w.rng);
                if rng.chance(45) {
                    let off = rng.below(32) as u8;
                    for k in 0..10u32 {
                        let a = ((k * 256 / 10) as u8).wrapping_add(off);
                        spawn_projectile(w, PROJ_ORB, src, m.x, m.y, cos256(a) * 120 / 1024, sin256(a) * 120 / 1024, 14, 30);
                    }
                }
                w.rng = rng.state;
            }
        }
        _ => {
            for ti in 0..MAX_PLAYERS {
                let t = w.players[ti];
                if t.alive() && in_arc(m.x, m.y, m.aim, t.x, t.y, st.range + PLAYER_RADIUS + 30, 350) {
                    damage_player(w, ti, dmg, src);
                }
            }
        }
    }
}

fn separate_monsters(w: &mut World) {
    let min = MONSTER_RADIUS * 3 / 2;
    for i in 0..MAX_MONSTERS {
        if !w.monsters[i].alive() {
            continue;
        }
        for j in (i + 1)..MAX_MONSTERS {
            if !w.monsters[j].alive() {
                continue;
            }
            let (a, b) = (w.monsters[i], w.monsters[j]);
            let d = dist(a.x, a.y, b.x, b.y);
            if d >= min {
                continue;
            }
            let push = (min - d) / 2 + 1;
            let ang = if d == 0 { (i * 37) as u8 } else { angle_to(b.x, b.y, a.x, a.y) };
            let (px, py) = (cos256(ang) * push / 1024, sin256(ang) * push / 1024);
            let (ax, ay) = slide(w, a.x, a.y, px, py, MONSTER_RADIUS);
            let (bx, by) = slide(w, b.x, b.y, -px, -py, MONSTER_RADIUS);
            w.monsters[i].x = ax;
            w.monsters[i].y = ay;
            w.monsters[j].x = bx;
            w.monsters[j].y = by;
        }
    }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/// Final score for a player: banked loot value for survivors, zero otherwise.
pub fn score(p: &Player) -> u32 {
    if p.state == PS_EXTRACTED {
        p.banked
    } else {
        0
    }
}
