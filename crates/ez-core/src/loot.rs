//! Loot tables. Rolls consume 32 bytes of VRF randomness per chest.

use crate::consts::*;
use crate::rng::Rng;
use crate::world::Item;
use alloc::vec::Vec;

/// Rarity weights (Common, Uncommon, Rare, Epic, Legendary) per chest tier.
const RARITY_WEIGHTS: [[u32; 5]; 4] = [
    [52, 29, 14, 4, 1],  // normal
    [18, 34, 31, 13, 4], // gold (dead-end rooms)
    [0, 0, 45, 38, 17],  // vault (needs a key)
    [0, 0, 0, 62, 38],   // boss
];

fn roll_rarity(rng: &mut Rng, tier: u8) -> u8 {
    let w = &RARITY_WEIGHTS[(tier as usize).min(3)];
    let total: u32 = w.iter().sum();
    let mut r = rng.below(total);
    for (i, &wt) in w.iter().enumerate() {
        if r < wt {
            return i as u8;
        }
        r -= wt;
    }
    0
}

fn roll_kind(rng: &mut Rng, rarity: u8) -> u8 {
    // Higher rarity skews towards relics with high base value.
    let r = rng.below(100);
    match rarity {
        RARITY_LEGENDARY => match r {
            0..=24 => ITEM_CROWN,
            25..=49 => ITEM_HEART,
            50..=64 => ITEM_IDOL,
            65..=82 => ITEM_BLADE,
            _ => ITEM_AEGIS,
        },
        RARITY_EPIC => match r {
            0..=19 => ITEM_IDOL,
            20..=34 => ITEM_CROWN,
            35..=49 => ITEM_CHALICE,
            50..=69 => ITEM_BLADE,
            70..=89 => ITEM_AEGIS,
            _ => ITEM_HEART,
        },
        _ => match r {
            0..=29 => ITEM_COINS,
            30..=49 => ITEM_GEM,
            50..=64 => ITEM_CHALICE,
            65..=72 => ITEM_IDOL,
            73..=86 => ITEM_BLADE,
            _ => ITEM_AEGIS,
        },
    }
}

/// Converts verified randomness into the items a chest spills on the floor.
pub fn roll_chest(randomness: &[u8; 32], tier: u8, has_key_room: bool) -> Vec<Item> {
    let mut rng = Rng::from_seed(randomness, 0x10_07 + tier as u64);
    let mut out = Vec::new();
    let n = match tier {
        CHEST_NORMAL => 1 + rng.below(2) as usize,
        CHEST_GOLD => 2 + rng.below(2) as usize,
        CHEST_VAULT => 3,
        _ => 2,
    };
    for _ in 0..n {
        let rarity = roll_rarity(&mut rng, tier);
        let kind = roll_kind(&mut rng, rarity);
        out.push(Item { kind, rarity });
    }
    // Consumables: potions are common, keys only exist when a vault exists.
    if rng.chance(match tier {
        CHEST_NORMAL => 45,
        CHEST_GOLD => 60,
        _ => 35,
    }) {
        out.push(Item { kind: ITEM_POTION, rarity: 0 });
    }
    if has_key_room && tier != CHEST_VAULT && rng.chance(if tier == CHEST_GOLD { 55 } else { 18 }) {
        out.push(Item { kind: ITEM_KEY, rarity: 0 });
    }
    out
}

/// Loot dropped by an elite or boss on death, rolled from the match RNG.
pub fn roll_monster_drop(rng: &mut Rng, kind: u8, elite: bool) -> Option<Item> {
    let pct = match kind {
        MON_BRUTE => 70,
        MON_KING => 100,
        _ if elite => 50,
        MON_NECRO => 14,
        _ => 9,
    };
    if !rng.chance(pct) {
        return None;
    }
    if kind != MON_KING && kind != MON_BRUTE && rng.chance(55) {
        return Some(Item { kind: ITEM_POTION, rarity: 0 });
    }
    let tier = match kind {
        MON_KING => CHEST_BOSS,
        MON_BRUTE => CHEST_GOLD,
        _ => CHEST_NORMAL,
    };
    let rarity = roll_rarity(rng, tier);
    Some(Item { kind: roll_kind(rng, rarity), rarity })
}
