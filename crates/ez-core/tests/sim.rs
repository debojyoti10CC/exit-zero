use ez_core::codec::WORLD_SIZE;
use ez_core::rng::Rng;
use ez_core::sim::{self, Action};
use ez_core::*;

fn seed(n: u64) -> [u8; 32] {
    let mut r = Rng::new(n);
    let mut s = [0u8; 32];
    for c in s.chunks_mut(8) {
        c.copy_from_slice(&r.next_u64().to_le_bytes());
    }
    s
}

fn new_world(n: u64, players: usize) -> World {
    let mut w = World::default();
    for i in 0..players {
        sim::join(&mut w, (i % 3) as u8, *b"tester______").unwrap();
    }
    sim::set_seed(&mut w, seed(n), 2);
    sim::begin(&mut w).unwrap();
    w
}

#[test]
fn encode_roundtrip_and_size() {
    let w = new_world(7, 4);
    let b = w.encode();
    assert_eq!(b.len(), WORLD_SIZE);
    let d = World::decode(&b).ok().unwrap();
    assert_eq!(d, w);
}

#[test]
fn maps_are_connected_and_deterministic() {
    for n in 0..300u64 {
        let a = new_world(n, 1);
        let b = new_world(n, 1);
        assert_eq!(a.walls, b.walls, "seed {n} not deterministic");
        assert!(a.room_count >= 8, "seed {n} only {} rooms", a.room_count);
        // every room centre reachable from entrance when the vault door is open
        let mut w = a.clone();
        ez_core::map::set_door_walls(&mut w, false);
        let (ex, ey) = (w.rooms[0].cx() / TILE, w.rooms[0].cy() / TILE);
        let mut seen = vec![false; MAP_W * MAP_H];
        let mut q = vec![(ex, ey)];
        seen[ey as usize * MAP_W + ex as usize] = true;
        while let Some((x, y)) = q.pop() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (x + dx, y + dy);
                if !w.is_wall(nx, ny) && !seen[ny as usize * MAP_W + nx as usize] {
                    seen[ny as usize * MAP_W + nx as usize] = true;
                    q.push((nx, ny));
                }
            }
        }
        for r in 0..w.room_count as usize {
            let rm = w.rooms[r];
            let (cx, cy) = (rm.cx() / TILE, rm.cy() / TILE);
            assert!(seen[cy as usize * MAP_W + cx as usize], "seed {n}: room {r} unreachable");
        }
        assert!(w.boss_idx != NOBODY, "seed {n}: no boss");
        assert!(w.portals.iter().filter(|p| p.tx != 0).count() >= 2, "seed {n}: portals");
        for c in w.chests.iter().filter(|c| c.tx != 0) {
            assert!(!a.is_wall(c.tx as i32, c.ty as i32), "seed {n}: chest in wall");
        }
        for m in w.monsters.iter().filter(|m| m.kind != MON_NONE) {
            assert!(w.free_at(m.x, m.y, MONSTER_RADIUS - 10), "seed {n}: monster in wall");
        }
    }
}

#[test]
fn speed_is_capped() {
    let mut w = new_world(3, 1);
    let p = w.players[0];
    // Try to teleport 20 tiles in one message.
    sim::act(&mut w, 0, Action::Move { x: p.x + 20 * TILE, y: p.y, aim: 0, moving: 1 }).unwrap();
    let moved = (w.players[0].x - p.x).abs();
    assert!(moved <= CLASSES[0].speed * (MOVE_SLACK_TICKS + 1) + 4, "moved {moved}");
    // Spamming messages within the same tick cannot exceed the budget either.
    let x0 = w.players[0].x;
    for _ in 0..50 {
        let q = w.players[0];
        sim::act(&mut w, 0, Action::Move { x: q.x + TILE, y: q.y, aim: 0, moving: 1 }).unwrap();
    }
    assert!((w.players[0].x - x0).abs() <= CLASSES[0].speed * 2, "spam moved");
}

/// Plays whole matches with simple bots and checks nothing panics and the match ends.
#[test]
fn bots_play_full_matches() {
    for n in 0..12u64 {
        let mut w = new_world(100 + n, 4);
        let mut r = Rng::new(n);
        let mut opened = 0;
        let mut kills = 0u32;
        for _ in 0..(DEFAULT_COLLAPSE_TICK + 5) {
            for p in 0..4u8 {
                if !w.players[p as usize].alive() {
                    continue;
                }
                let pl = w.players[p as usize];
                // head to nearest live monster or chest, then portal once open
                let mut tx = pl.x;
                let mut ty = pl.y;
                let mut best = i64::MAX;
                if w.portals_open() {
                    for po in w.portals.iter().filter(|p| p.tx != 0) {
                        let (x, y) = (po.tx as i32 * TILE + 128, po.ty as i32 * TILE + 128);
                        let d = ez_core::math::dist2(pl.x, pl.y, x, y);
                        if d < best {
                            best = d;
                            tx = x;
                            ty = y;
                        }
                    }
                } else {
                    for m in w.monsters.iter().filter(|m| m.alive()) {
                        let d = ez_core::math::dist2(pl.x, pl.y, m.x, m.y);
                        if d < best {
                            best = d;
                            tx = m.x;
                            ty = m.y;
                        }
                    }
                    for c in w.chests.iter().filter(|c| c.tx != 0 && c.state == CHEST_CLOSED) {
                        let (x, y) = (c.tx as i32 * TILE + 128, c.ty as i32 * TILE + 128);
                        let d = ez_core::math::dist2(pl.x, pl.y, x, y);
                        if d < best {
                            best = d;
                            tx = x;
                            ty = y;
                        }
                    }
                }
                let aim = ez_core::math::angle_to(pl.x, pl.y, tx, ty);
                let step = CLASSES[pl.class as usize].speed;
                let nx = pl.x + ez_core::math::cos256(aim) * step / 1024;
                let ny = pl.y + ez_core::math::sin256(aim) * step / 1024;
                sim::act(&mut w, p, Action::Move { x: nx, y: ny, aim, moving: 1 }).unwrap();
                sim::act(&mut w, p, Action::Attack { aim }).unwrap();
                if r.chance(5) {
                    sim::act(&mut w, p, Action::Special { aim }).unwrap();
                }
                if r.chance(3) {
                    sim::act(&mut w, p, Action::Dodge { aim }).unwrap();
                }
                if pl.hp < pl.max_hp / 2 {
                    sim::act(&mut w, p, Action::Potion).unwrap();
                }
                let out = sim::act(&mut w, p, Action::Interact).unwrap();
                if let Some(c) = out.request_chest {
                    let mut rnd = [0u8; 32];
                    for b in rnd.iter_mut() {
                        *b = r.below(256) as u8;
                    }
                    sim::resolve_chest(&mut w, c, &rnd).unwrap();
                    opened += 1;
                }
            }
            sim::tick(&mut w);
            if w.phase == PHASE_ENDED {
                break;
            }
            let b = w.encode();
            assert_eq!(b.len(), WORLD_SIZE);
        }
        kills += w.players.iter().map(|p| p.kills as u32).sum::<u32>();
        assert_eq!(w.phase, PHASE_ENDED, "match {n} did not end");


        let ex = w.players.iter().filter(|p| p.state == PS_EXTRACTED).count();
        eprintln!("match {n}: tick {} opened {opened} kills {kills} extracted {ex}", w.tick);
    }
}

#[test]
fn angle_to_matches_trig() {
    for a in (0..=255u8).step_by(7) {
        let x = ez_core::math::cos256(a) * 10;
        let y = ez_core::math::sin256(a) * 10;
        let b = ez_core::math::angle_to(0, 0, x, y);
        assert!(ez_core::math::angle_diff(a, b) <= 2, "a {a} b {b}");
    }
}

/// Regression: the King's orb ring used to overflow a u8 angle and panic.
#[test]
fn boss_fight_does_not_panic() {
    for n in 0..20u64 {
        let mut w = new_world(500 + n, 4);
        let b = w.monsters[w.boss_idx as usize];
        for p in 0..4 {
            w.players[p].x = b.x + (p as i32 - 1) * 200;
            w.players[p].y = b.y + 300;
            w.players[p].hp = 60000;
            w.players[p].max_hp = 60000;
        }
        for _ in 0..800 {
            for p in 0..4u8 {
                let aim = ez_core::math::angle_to(w.players[p as usize].x, w.players[p as usize].y, b.x, b.y);
                let _ = sim::act(&mut w, p, Action::Attack { aim });
            }
            sim::tick(&mut w);
        }
    }
}

/// The raw (zero-copy) layout must be identical on every target and round-trip exactly.
#[test]
fn raw_layout_roundtrip() {
    let w = new_world(42, 3);
    let mut buf = vec![0u8; ez_core::WORLD_RAW_SIZE + 8];
    assert!(w.write_raw(&mut buf));
    let back = ez_core::World::from_raw_copy(&buf).unwrap();
    assert_eq!(*back, w);
    eprintln!("WORLD_RAW_SIZE = {} align {}", ez_core::WORLD_RAW_SIZE, ez_core::WORLD_ALIGN);
}

#[test]
fn isqrt_is_exact_floor() {
    use ez_core::math::isqrt;
    let mut r = Rng::new(9);
    for _ in 0..200_000 {
        let n = (r.next_u64() >> (r.below(60) + 1)) as i64;
        let s = isqrt(n);
        assert!(s * s <= n && (s + 1) * (s + 1) > n, "n {n} s {s}");
    }
    for n in 0..5000i64 {
        let s = isqrt(n);
        assert!(s * s <= n && (s + 1) * (s + 1) > n);
    }
}
