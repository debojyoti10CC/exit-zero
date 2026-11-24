//! Rival adventurers for practice mode. They explore, loot, fight, sometimes
//! betray, and race for the portals, using the same actions as human players.

use crate::consts::*;
use crate::math::*;
use crate::rng::Rng;
use crate::sim::Action;
use crate::world::*;
use alloc::vec;
use alloc::vec::Vec;

#[derive(Clone, Copy, Default, Debug)]
pub struct BotMemory {
    pub goal_x: i32,
    pub goal_y: i32,
    pub goal_until: u32,
    pub treacherous: bool,
    pub greed: u32,
}

impl BotMemory {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng::new(seed);
        BotMemory { goal_x: 0, goal_y: 0, goal_until: 0, treacherous: r.chance(55), greed: 120 + r.below(260) }
    }
}

/// Next tile to step to on the shortest path from (sx,sy) to (tx,ty), in tile coordinates.
fn next_step(w: &World, sx: i32, sy: i32, tx: i32, ty: i32) -> Option<(i32, i32)> {
    if sx == tx && sy == ty {
        return Some((tx, ty));
    }
    let mut prev = vec![u16::MAX; MAP_W * MAP_H];
    let idx = |x: i32, y: i32| y as usize * MAP_W + x as usize;
    let mut q: Vec<(i32, i32)> = Vec::with_capacity(512);
    q.push((tx, ty));
    prev[idx(tx, ty)] = idx(tx, ty) as u16;
    let mut head = 0;
    while head < q.len() {
        let (x, y) = q[head];
        head += 1;
        if x == sx && y == sy {
            let p = prev[idx(x, y)] as usize;
            return Some(((p % MAP_W) as i32, (p / MAP_W) as i32));
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if w.is_wall(nx, ny) || prev[idx(nx, ny)] != u16::MAX {
                continue;
            }
            prev[idx(nx, ny)] = idx(x, y) as u16;
            q.push((nx, ny));
        }
    }
    None
}

fn tile(v: i32) -> i32 {
    v.div_euclid(TILE)
}

pub fn think(w: &World, p: u8, mem: &mut BotMemory, rng: &mut Rng) -> Vec<Action> {
    let mut out = Vec::new();
    let me = w.players[p as usize];
    if !me.alive() || w.phase != PHASE_RUNNING {
        return out;
    }
    let st = &CLASSES[me.class as usize];
    if (me.hp as u32) * 100 < (me.max_hp as u32) * 40 && me.potions > 0 {
        out.push(Action::Potion);
    }

    // Threat: a monster winding up on us within reach -> dodge sometimes.
    for m in w.monsters.iter() {
        if m.alive() && m.state == crate::world::MS_WINDUP && m.target == p && dist(m.x, m.y, me.x, me.y) < TILE * 2 && rng.chance(35) {
            out.push(Action::Dodge { aim: angle_to(m.x, m.y, me.x, me.y) });
            break;
        }
    }

    let loot = me.loot_value();
    let mut goal: Option<(i32, i32)> = None;
    let mut fight: Option<(i32, i32)> = None;

    // 1. Escape when rich, hurt or late.
    let late = w.tick + 400 > w.collapse_tick;
    if w.portals_open() && (loot >= mem.greed || (me.hp as u32) * 100 < (me.max_hp as u32) * 35 || late || w.tick > w.portal_tick + 700) {
        let mut best = i64::MAX;
        for po in w.portals.iter().filter(|po| po.tx != 0 || po.ty != 0) {
            let (x, y) = (po.tx as i32 * TILE + TILE / 2, po.ty as i32 * TILE + TILE / 2);
            let d = dist2(me.x, me.y, x, y);
            if d < best {
                best = d;
                goal = Some((x, y));
            }
        }
    }

    // 2. Betrayal: a weak, loaded rival close by.
    if mem.treacherous {
        for (qi, q) in w.players.iter().enumerate() {
            if qi == p as usize || !q.alive() {
                continue;
            }
            let d = dist(me.x, me.y, q.x, q.y);
            if d < TILE * 4 && q.loot_value() > 80 && (q.hp as u32) * 100 < (q.max_hp as u32) * 45 && me.hp > q.hp {
                fight = Some((q.x, q.y));
            }
        }
    }

    // 3. Monsters nearby.
    if fight.is_none() {
        let mut best = i64::MAX;
        for m in w.monsters.iter().filter(|m| m.alive()) {
            let d = dist2(me.x, me.y, m.x, m.y);
            let reach = if goal.is_some() { TILE * 2 } else { TILE * 6 };
            if d < (reach as i64).pow(2) && d < best && crate::sim::line_clear(w, me.x, me.y, m.x, m.y) {
                // Avoid the boss unless healthy.
                if m.kind == MON_KING && (me.hp as u32) * 100 < (me.max_hp as u32) * 60 {
                    continue;
                }
                best = d;
                fight = Some((m.x, m.y));
            }
        }
    }

    if goal.is_none() {
        // 4. Loot on the floor.
        let mut best = i64::MAX;
        for d in w.drops.iter().filter(|d| !d.item.is_empty()) {
            let dd = dist2(me.x, me.y, d.x, d.y);
            if dd < ((TILE * 9) as i64).pow(2) && dd < best {
                best = dd;
                goal = Some((d.x, d.y));
            }
        }
    }
    let mut want_interact = false;
    if goal.is_none() {
        // 5. Closed chests.
        let boss_dead = (w.boss_idx as usize) >= MAX_MONSTERS || !w.monsters[w.boss_idx as usize].alive();
        let mut best = i64::MAX;
        for c in w.chests.iter().filter(|c| (c.tx != 0 || c.ty != 0) && c.state == CHEST_CLOSED) {
            if c.tier == CHEST_BOSS && !boss_dead {
                continue;
            }
            let (x, y) = (c.tx as i32 * TILE + TILE / 2, c.ty as i32 * TILE + TILE / 2);
            if w.is_wall(c.tx as i32, c.ty as i32) {
                continue;
            }
            let dd = dist2(me.x, me.y, x, y);
            if dd < best && next_step(w, tile(me.x), tile(me.y), c.tx as i32, c.ty as i32).is_some() {
                best = dd;
                goal = Some((x, y));
            }
        }
        if let Some((gx, gy)) = goal {
            if dist(me.x, me.y, gx, gy) <= INTERACT_RADIUS - 40 {
                want_interact = true;
            }
        }
    }
    if me.keys > 0 && w.door.open == 0 && (w.door.tx != 0 || w.door.ty != 0) && goal.is_none() {
        goal = Some((w.door.tx as i32 * TILE + TILE / 2, w.door.ty as i32 * TILE + TILE / 2));
        want_interact = true;
    }
    if goal.is_none() {
        // 6. Explore a random room for a while.
        if w.tick >= mem.goal_until || dist(me.x, me.y, mem.goal_x, mem.goal_y) < TILE {
            let n = w.room_count.max(1) as u32;
            let r = w.rooms[rng.below(n) as usize];
            mem.goal_x = r.cx();
            mem.goal_y = r.cy();
            mem.goal_until = w.tick + 120;
        }
        goal = Some((mem.goal_x, mem.goal_y));
    }

    // Combat movement takes precedence over travel.
    let (tx, ty, attacking) = match fight {
        Some((fx, fy)) => (fx, fy, true),
        None => {
            let g = goal.unwrap();
            (g.0, g.1, false)
        }
    };
    let d = dist(me.x, me.y, tx, ty);
    let aim = angle_to(me.x, me.y, tx, ty);
    let keep = if attacking {
        if me.class == CLASS_ARCANIST {
            TILE * 3
        } else {
            st.atk_range * 2 / 3
        }
    } else {
        40
    };
    let mut nx = me.x;
    let mut ny = me.y;
    if d > keep {
        // Path around walls.
        let (wx, wy) = match next_step(w, tile(me.x), tile(me.y), tile(tx), tile(ty)) {
            Some((sx, sy)) if !(sx == tile(tx) && sy == tile(ty)) => (sx * TILE + TILE / 2, sy * TILE + TILE / 2),
            _ => (tx, ty),
        };
        let a = angle_to(me.x, me.y, wx, wy);
        let step = st.speed.min(dist(me.x, me.y, wx, wy).max(1));
        nx = me.x + cos256(a) * step / 1024;
        ny = me.y + sin256(a) * step / 1024;
    } else if attacking && me.class == CLASS_ARCANIST && d < TILE * 2 {
        nx = me.x - cos256(aim) * st.speed / 1024;
        ny = me.y - sin256(aim) * st.speed / 1024;
    }
    out.push(Action::Move { x: nx, y: ny, aim, moving: (nx != me.x || ny != me.y) as u8 });
    if attacking {
        let in_range = if me.class == CLASS_ARCANIST { d < TILE * 7 } else { d <= st.atk_range + MONSTER_RADIUS };
        if in_range {
            out.push(Action::Attack { aim });
            if rng.chance(8) {
                out.push(Action::Special { aim });
            }
        }
    }
    if want_interact {
        out.push(Action::Interact);
    }
    out
}
