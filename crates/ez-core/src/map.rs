//! Seeded dungeon generator for Zone 01, The Forgotten Crypt.
//!
//! Given the same 32-byte seed this always produces the same layout, so anyone
//! can re-derive the dungeon from the VRF output and check that nothing was
//! moved, added or removed.

use crate::consts::*;
use crate::rng::Rng;
use crate::world::*;
use alloc::vec;
use alloc::vec::Vec;

const SALT_MAP: u64 = 0xC0FFEE_01;

#[derive(Clone, Copy)]
struct Edge {
    a: usize,
    b: usize,
}

fn overlaps(a: &Room, b: &Room, pad: i32) -> bool {
    let ax0 = a.x as i32 - pad;
    let ay0 = a.y as i32 - pad;
    let ax1 = (a.x + a.w) as i32 + pad;
    let ay1 = (a.y + a.h) as i32 + pad;
    let bx0 = b.x as i32;
    let by0 = b.y as i32;
    let bx1 = (b.x + b.w) as i32;
    let by1 = (b.y + b.h) as i32;
    ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1
}

fn room_center_tile(r: &Room) -> (i32, i32) {
    (r.x as i32 + r.w as i32 / 2, r.y as i32 + r.h as i32 / 2)
}

fn carve_rect(w: &mut World, r: &Room) {
    for ty in r.y as i32..(r.y + r.h) as i32 {
        for tx in r.x as i32..(r.x + r.w) as i32 {
            w.set_wall(tx, ty, false);
        }
    }
}

/// Walks a 2-wide L corridor from a to b, calling `f(x, y, moving_horizontally)` per tile.
/// (No allocation: the on-chain bump allocator never frees memory.)
fn walk_corridor(a: (i32, i32), b: (i32, i32), horizontal_first: bool, mut f: impl FnMut(i32, i32, bool)) {
    let (mut x, mut y) = a;
    let step = |v: i32, t: i32| if t > v { 1 } else { -1 };
    if horizontal_first {
        while x != b.0 {
            f(x, y, true);
            x += step(x, b.0);
        }
        while y != b.1 {
            f(x, y, false);
            y += step(y, b.1);
        }
    } else {
        while y != b.1 {
            f(x, y, false);
            y += step(y, b.1);
        }
        while x != b.0 {
            f(x, y, true);
            x += step(x, b.0);
        }
    }
    f(x, y, horizontal_first);
}

fn carve_tile(w: &mut World, x: i32, y: i32, horiz: bool) {
    w.set_wall(x, y, false);
    if horiz {
        w.set_wall(x, y + 1, false);
    } else {
        w.set_wall(x + 1, y, false);
    }
}

/// Breadth-first reachability from a tile, treating walls as blocked.
fn reachable(w: &World, sx: i32, sy: i32) -> Vec<bool> {
    let mut seen = vec![false; MAP_W * MAP_H];
    let mut queue: Vec<u16> = Vec::with_capacity(MAP_W * MAP_H);
    if w.is_wall(sx, sy) {
        return seen;
    }
    seen[sy as usize * MAP_W + sx as usize] = true;
    queue.push((sy as usize * MAP_W + sx as usize) as u16);
    let mut head = 0;
    while head < queue.len() {
        let c = queue[head] as usize;
        let (x, y) = ((c % MAP_W) as i32, (c / MAP_W) as i32);
        head += 1;
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let nx = x + dx;
            let ny = y + dy;
            if w.is_wall(nx, ny) {
                continue;
            }
            let i = ny as usize * MAP_W + nx as usize;
            if !seen[i] {
                seen[i] = true;
                queue.push(i as u16);
            }
        }
    }
    seen
}

fn spawn_monster(w: &mut World, kind: u8, x: i32, y: i32, room: u8, elite: bool) -> Option<usize> {
    let slot = w.monsters.iter().position(|m| m.kind == MON_NONE)?;
    let st = &MONSTERS[kind as usize];
    let mut hp = st.hp;
    if elite {
        hp = hp * 3 / 2;
    }
    w.monsters[slot] = Monster {
        kind,
        hp,
        max_hp: hp,
        x,
        y,
        aim: 64,
        state: MS_IDLE,
        timer: 0,
        atk_ready: 0,
        target: NOBODY,
        room,
        elite: elite as u8,
        stun_until: 0,
    };
    Some(slot)
}

pub fn spawn_monster_pub(w: &mut World, kind: u8, x: i32, y: i32, room: u8, elite: bool) -> Option<usize> {
    spawn_monster(w, kind, x, y, room, elite)
}

/// Random free interior tile of a room (1 tile away from its walls).
fn interior_tile(rng: &mut Rng, r: &Room) -> (i32, i32) {
    let x = rng.range(r.x as i32 + 1, (r.x + r.w) as i32 - 2);
    let y = rng.range(r.y as i32 + 1, (r.y + r.h) as i32 - 2);
    (x, y)
}

fn tile_center(t: (i32, i32)) -> (i32, i32) {
    (t.0 * TILE + TILE / 2, t.1 * TILE + TILE / 2)
}

pub fn generate(w: &mut World) {
    let mut rng = Rng::from_seed(&w.seed, SALT_MAP);
    for b in w.walls.iter_mut() {
        *b = 0xFF;
    }
    for r in w.rooms.iter_mut() {
        *r = Room::default();
    }
    w.clear_entities();
    w.door = Door::default();
    w.boss_idx = NOBODY;

    // --- Rooms ---------------------------------------------------------
    let mut rooms: Vec<Room> = Vec::with_capacity(MAX_ROOMS);
    let ew = 8u8;
    let eh = 7u8;
    rooms.push(Room { x: (MAP_W as u8 - ew) / 2, y: (MAP_H as u8 - eh) / 2, w: ew, h: eh, kind: ROOM_ENTRANCE });
    let target = 12 + rng.below(2) as usize;
    let mut attempts = 0;
    while rooms.len() < target.min(MAX_ROOMS) && attempts < 600 {
        attempts += 1;
        let rw = rng.range(6, 11) as u8;
        let rh = rng.range(5, 9) as u8;
        let rx = rng.range(2, MAP_W as i32 - rw as i32 - 3) as u8;
        let ry = rng.range(2, MAP_H as i32 - rh as i32 - 3) as u8;
        let cand = Room { x: rx, y: ry, w: rw, h: rh, kind: ROOM_NORMAL };
        if rooms.iter().any(|r| overlaps(r, &cand, 3)) {
            continue;
        }
        rooms.push(cand);
    }
    for r in &rooms {
        carve_rect(w, r);
    }

    // --- Connect: minimum spanning tree + a couple of loops -------------
    let n = rooms.len();
    let centers: Vec<(i32, i32)> = rooms.iter().map(room_center_tile).collect();
    let d2 = |a: usize, b: usize| -> i64 {
        let dx = (centers[a].0 - centers[b].0) as i64;
        let dy = (centers[a].1 - centers[b].1) as i64;
        dx * dx + dy * dy
    };
    let mut in_tree = vec![false; n];
    in_tree[0] = true;
    let mut edges: Vec<Edge> = Vec::new();
    for _ in 1..n {
        let mut best: Option<(i64, usize, usize)> = None;
        for a in 0..n {
            if !in_tree[a] {
                continue;
            }
            for b in 0..n {
                if in_tree[b] {
                    continue;
                }
                let d = d2(a, b);
                if best.map_or(true, |(bd, _, _)| d < bd) {
                    best = Some((d, a, b));
                }
            }
        }
        if let Some((_, a, b)) = best {
            in_tree[b] = true;
            edges.push(Edge { a, b });
        }
    }
    let mut degree = vec![0u8; n];
    for e in &edges {
        degree[e.a] += 1;
        degree[e.b] += 1;
    }

    // Pick the vault before adding loops: a leaf room away from the entrance.
    let mut vault: Option<usize> = None;
    {
        let mut best = 0i64;
        for i in 1..n {
            if degree[i] == 1 {
                let d = d2(0, i);
                if d > best && rooms[i].w <= 9 {
                    best = d;
                    vault = Some(i);
                }
            }
        }
    }
    // Loops make PvP routes and escapes; never attach them to the vault.
    let extra = 2 + rng.below(2) as usize;
    let mut added = 0;
    let mut tries = 0;
    while added < extra && tries < 60 && n > 3 {
        tries += 1;
        let a = rng.below(n as u32) as usize;
        let b = rng.below(n as u32) as usize;
        if a == b || Some(a) == vault || Some(b) == vault {
            continue;
        }
        if edges.iter().any(|e| (e.a == a && e.b == b) || (e.a == b && e.b == a)) {
            continue;
        }
        if d2(a, b) > 26 * 26 {
            continue;
        }
        edges.push(Edge { a, b });
        degree[a] += 1;
        degree[b] += 1;
        added += 1;
    }

    // The vault's single corridor (ends and orientation), for placing its door.
    let mut vault_edge: Option<((i32, i32), (i32, i32), bool)> = None;
    for e in &edges {
        let hf = rng.chance(50);
        walk_corridor(centers[e.a], centers[e.b], hf, |x, y, h| carve_tile(w, x, y, h));
        if Some(e.a) == vault || Some(e.b) == vault {
            vault_edge = Some((centers[e.a], centers[e.b], hf));
        }
    }

    // --- Room roles ------------------------------------------------------
    // Boss: farthest sizeable room from the entrance.
    let mut boss = 1.min(n - 1);
    {
        let mut best = -1i64;
        for i in 1..n {
            if Some(i) == vault {
                continue;
            }
            let big = rooms[i].w >= 8 && rooms[i].h >= 6;
            let d = d2(0, i) + if big { 400 } else { 0 };
            if d > best {
                best = d;
                boss = i;
            }
        }
    }
    rooms[boss].kind = ROOM_BOSS;

    // Vault door: first corridor tile outside the vault room along its only corridor.
    if let Some(v) = vault {
        let vr = rooms[v];
        let mut placed = false;
        if let Some((a, b, hf)) = vault_edge {
            // The door is the corridor tile right outside the vault: the first outside
            // tile when walking from the vault, or the last one when walking towards it.
            let vault_first = vr.contains_tile(a.0, a.1);
            let mut first_outside: Option<(i32, i32, bool)> = None;
            let mut last_outside: Option<(i32, i32, bool)> = None;
            walk_corridor(a, b, hf, |x, y, horiz| {
                let inside = vr.contains_tile(x, y) || (horiz && vr.contains_tile(x, y + 1)) || (!horiz && vr.contains_tile(x + 1, y));
                if !inside {
                    if first_outside.is_none() {
                        first_outside = Some((x, y, horiz));
                    }
                    last_outside = Some((x, y, horiz));
                }
            });
            if let Some((x, y, horiz)) = if vault_first { first_outside } else { last_outside } {
                w.door = Door { tx: x as u8, ty: y as u8, vertical: horiz as u8, open: 0 };
                placed = true;
            }
        }
        if placed {
            set_door_walls(w, true);
            // Verify the vault is really sealed; otherwise demote it.
            let seen = reachable(w, centers[0].0, centers[0].1);
            let (vx, vy) = centers[v];
            if seen[vy as usize * MAP_W + vx as usize] {
                set_door_walls(w, false);
                w.door = Door::default();
                vault = None;
            } else {
                rooms[v].kind = ROOM_VAULT;
            }
        } else {
            vault = None;
        }
    }

    // Treasure rooms: other dead ends.
    for i in 1..n {
        if rooms[i].kind == ROOM_NORMAL && degree[i] == 1 {
            rooms[i].kind = ROOM_TREASURE;
        }
    }

    // Portals: three rooms spread out (farthest-first from entrance), not boss/vault.
    let mut portal_rooms: Vec<usize> = Vec::new();
    for _ in 0..MAX_PORTALS {
        let mut best: Option<(i64, usize)> = None;
        for i in 1..n {
            let k = rooms[i].kind;
            if k == ROOM_BOSS || k == ROOM_VAULT || portal_rooms.contains(&i) {
                continue;
            }
            let mut d = d2(0, i);
            for &p in &portal_rooms {
                d = d.min(d2(p, i));
            }
            // small jitter keeps layouts varied
            d += rng.below(30) as i64;
            if best.map_or(true, |(bd, _)| d > bd) {
                best = Some((d, i));
            }
        }
        if let Some((_, i)) = best {
            portal_rooms.push(i);
        }
    }
    for (pi, &ri) in portal_rooms.iter().enumerate() {
        let (cx, cy) = room_center_tile(&rooms[ri]);
        w.portals[pi] = Portal { tx: cx as u8, ty: cy as u8 };
        if rooms[ri].kind == ROOM_NORMAL {
            rooms[ri].kind = ROOM_PORTAL;
        }
    }

    // --- Chests ------------------------------------------------------------
    let mut chest_n = 0usize;
    let mut used: Vec<(i32, i32)> = Vec::new();
    for p in w.portals.iter() {
        used.push((p.tx as i32, p.ty as i32));
    }
    fn place_chest(w: &mut World, rng: &mut Rng, r: &Room, tier: u8, used: &mut Vec<(i32, i32)>, chest_n: &mut usize) {
        if *chest_n >= MAX_CHESTS {
            return;
        }
        for _ in 0..20 {
            let t = interior_tile(rng, r);
            if used.iter().any(|u| (u.0 - t.0).abs() <= 1 && (u.1 - t.1).abs() <= 1) {
                continue;
            }
            used.push(t);
            w.chests[*chest_n] = Chest { tx: t.0 as u8, ty: t.1 as u8, tier, state: CHEST_CLOSED, opener: NOBODY, req_tick: 0 };
            *chest_n += 1;
            return;
        }
    }
    for i in 0..n {
        let r = rooms[i];
        match r.kind {
            ROOM_ENTRANCE => {}
            ROOM_BOSS => {
                // Boss chest sits in the middle and only opens once the king falls.
                let c = room_center_tile(&r);
                if chest_n < MAX_CHESTS {
                    used.push(c);
                    w.chests[chest_n] = Chest { tx: c.0 as u8, ty: (c.1 - 1) as u8, tier: CHEST_BOSS, state: CHEST_CLOSED, opener: NOBODY, req_tick: 0 };
                    chest_n += 1;
                }
            }
            ROOM_VAULT => {
                place_chest(w, &mut rng, &r, CHEST_VAULT, &mut used, &mut chest_n);
                place_chest(w, &mut rng, &r, CHEST_VAULT, &mut used, &mut chest_n);
            }
            ROOM_TREASURE => {
                place_chest(w, &mut rng, &r, CHEST_GOLD, &mut used, &mut chest_n);
                if rng.chance(50) {
                    place_chest(w, &mut rng, &r, CHEST_NORMAL, &mut used, &mut chest_n);
                }
            }
            _ => {
                place_chest(w, &mut rng, &r, CHEST_NORMAL, &mut used, &mut chest_n);
                if r.w as u32 * r.h as u32 >= 60 && rng.chance(45) {
                    place_chest(w, &mut rng, &r, CHEST_NORMAL, &mut used, &mut chest_n);
                }
            }
        }
    }

    // --- Monsters ------------------------------------------------------------
    for i in 0..n {
        let r = rooms[i];
        let count = match r.kind {
            ROOM_ENTRANCE => 0,
            ROOM_BOSS => 2,
            ROOM_VAULT => 2,
            ROOM_TREASURE => 3,
            ROOM_PORTAL => 2,
            _ => rng.range(2, 3) as usize,
        };
        for _ in 0..count {
            let t = interior_tile(&mut rng, &r);
            let (x, y) = tile_center(t);
            let kind = if r.kind == ROOM_VAULT {
                MON_BRUTE
            } else if rng.chance(28) {
                MON_NECRO
            } else {
                MON_SKELETON
            };
            spawn_monster(w, kind, x, y, i as u8, false);
        }
        if r.kind == ROOM_BOSS {
            let (x, y) = (r.cx(), r.cy() + TILE);
            if let Some(slot) = spawn_monster(w, MON_KING, x, y, i as u8, false) {
                w.boss_idx = slot as u8;
            }
        }
    }

    // --- Commit rooms ----------------------------------------------------
    w.room_count = n as u8;
    for (i, r) in rooms.iter().enumerate() {
        w.rooms[i] = *r;
    }
    let _ = vault;
}

pub fn set_door_walls(w: &mut World, closed: bool) {
    let d = w.door;
    if d.tx == 0 && d.ty == 0 {
        return;
    }
    let (x, y) = (d.tx as i32, d.ty as i32);
    w.set_wall(x, y, closed);
    if d.vertical == 1 {
        w.set_wall(x, y + 1, closed);
    } else {
        w.set_wall(x + 1, y, closed);
    }
}

pub fn has_door(w: &World) -> bool {
    !(w.door.tx == 0 && w.door.ty == 0)
}
