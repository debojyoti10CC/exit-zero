//! Tunable game constants. All distances are in "units": 1 tile = 256 units.

pub const MAP_W: usize = 64;
pub const MAP_H: usize = 48;
pub const TILE: i32 = 256;
pub const WALL_BYTES: usize = MAP_W * MAP_H / 8;

pub const MAX_PLAYERS: usize = 4;
pub const MAX_MONSTERS: usize = 40;
pub const MAX_PROJECTILES: usize = 24;
pub const MAX_CHESTS: usize = 20;
pub const MAX_DROPS: usize = 40;
pub const MAX_PORTALS: usize = 3;
pub const MAX_ROOMS: usize = 14;
pub const INV_SLOTS: usize = 8;
pub const EVENT_CAP: usize = 48;
pub const NAME_LEN: usize = 12;

pub const TICKS_PER_SEC: u32 = 10;

/// Default match schedule (ticks). Shorter than the design doc's 12 minutes:
/// playtests showed 6 minutes keeps the tension high for a 4-player run.
pub const DEFAULT_ELITE_TICK: u32 = 90 * TICKS_PER_SEC;
pub const DEFAULT_PORTAL_TICK: u32 = 180 * TICKS_PER_SEC;
pub const DEFAULT_COLLAPSE_TICK: u32 = 360 * TICKS_PER_SEC;
/// Corruption waves spawn this often once portals are open.
pub const WAVE_INTERVAL: u32 = 30 * TICKS_PER_SEC;

pub const PLAYER_RADIUS: i32 = 80;
pub const MONSTER_RADIUS: i32 = 90;

/// Ticks a player must stand in an open portal to escape.
pub const EXTRACT_TICKS: u8 = 40;
pub const PORTAL_RADIUS: i32 = TILE + 64;
pub const PICKUP_RADIUS: i32 = 260;
pub const INTERACT_RADIUS: i32 = TILE * 3 / 2;
pub const PICKUP_DELAY: u32 = 6;

pub const POTION_HEAL: u16 = 60;
pub const POTION_COOLDOWN: u32 = 30;
pub const MAX_POTIONS: u8 = 5;

pub const DODGE_TICKS: u32 = 3;
pub const DODGE_COOLDOWN: u32 = 14;
pub const DODGE_SPEED_MULT: i32 = 3;

/// Movement validation slack: a client may report up to this many extra
/// ticks of travel to absorb network jitter.
pub const MOVE_SLACK_TICKS: i32 = 3;

// Player classes
pub const CLASS_VANGUARD: u8 = 0;
pub const CLASS_ARCANIST: u8 = 1;
pub const CLASS_ROGUE: u8 = 2;

pub struct ClassStats {
    pub hp: u16,
    /// Units per tick.
    pub speed: i32,
    pub atk_dmg: u16,
    pub atk_cd: u32,
    pub atk_range: i32,
    /// Half-arc as a cosine threshold scaled by 1024.
    pub atk_cos: i32,
    pub spec_cd: u32,
}

pub const CLASSES: [ClassStats; 3] = [
    // Vanguard: tanky melee, wide cleave, Shield special.
    ClassStats { hp: 150, speed: 128, atk_dmg: 20, atk_cd: 6, atk_range: 430, atk_cos: 300, spec_cd: 110 },
    // Arcanist: ranged bolts, Fireball special.
    ClassStats { hp: 90, speed: 120, atk_dmg: 15, atk_cd: 5, atk_range: 0, atk_cos: 0, spec_cd: 60 },
    // Rogue: fast stabs, Shadow Step special (blink + crit).
    ClassStats { hp: 110, speed: 150, atk_dmg: 14, atk_cd: 3, atk_range: 360, atk_cos: 560, spec_cd: 45 },
];

pub const SHIELD_TICKS: u32 = 30;
pub const BLINK_DIST: i32 = TILE * 3;
pub const FIREBALL_DMG: u16 = 42;
pub const FIREBALL_RADIUS: i32 = TILE * 3 / 2;

// Monster kinds
pub const MON_NONE: u8 = 0;
pub const MON_SKELETON: u8 = 1;
pub const MON_NECRO: u8 = 2;
pub const MON_BRUTE: u8 = 3;
pub const MON_KING: u8 = 4;
pub const MON_IMP: u8 = 5;

pub struct MonsterStats {
    pub hp: u16,
    pub speed: i32,
    pub dmg: u16,
    pub range: i32,
    pub windup: u32,
    pub cd: u32,
    pub aggro: i32,
    pub ranged: bool,
}

pub const MONSTERS: [MonsterStats; 6] = [
    MonsterStats { hp: 0, speed: 0, dmg: 0, range: 0, windup: 0, cd: 0, aggro: 0, ranged: false },
    MonsterStats { hp: 45, speed: 82, dmg: 9, range: 300, windup: 5, cd: 12, aggro: TILE * 7, ranged: false },
    MonsterStats { hp: 32, speed: 70, dmg: 11, range: TILE * 6, windup: 7, cd: 24, aggro: TILE * 8, ranged: true },
    MonsterStats { hp: 170, speed: 66, dmg: 22, range: 380, windup: 8, cd: 18, aggro: TILE * 8, ranged: false },
    MonsterStats { hp: 1100, speed: 60, dmg: 28, range: 460, windup: 9, cd: 16, aggro: TILE * 10, ranged: false },
    MonsterStats { hp: 24, speed: 120, dmg: 7, range: 260, windup: 3, cd: 9, aggro: TILE * 12, ranged: false },
];

// Projectile kinds
pub const PROJ_NONE: u8 = 0;
pub const PROJ_BOLT: u8 = 1;
pub const PROJ_FIREBALL: u8 = 2;
pub const PROJ_BONE: u8 = 3;
pub const PROJ_ORB: u8 = 4;

// Item kinds
pub const ITEM_NONE: u8 = 0;
pub const ITEM_COINS: u8 = 1;
pub const ITEM_GEM: u8 = 2;
pub const ITEM_CHALICE: u8 = 3;
pub const ITEM_IDOL: u8 = 4;
pub const ITEM_CROWN: u8 = 5;
pub const ITEM_BLADE: u8 = 6;
pub const ITEM_AEGIS: u8 = 7;
pub const ITEM_POTION: u8 = 8;
pub const ITEM_KEY: u8 = 9;
pub const ITEM_HEART: u8 = 10;

pub const ITEM_BASE_VALUE: [u32; 11] = [0, 20, 45, 60, 90, 140, 70, 70, 0, 0, 160];

// Rarity
pub const RARITY_COMMON: u8 = 0;
pub const RARITY_UNCOMMON: u8 = 1;
pub const RARITY_RARE: u8 = 2;
pub const RARITY_EPIC: u8 = 3;
pub const RARITY_LEGENDARY: u8 = 4;
/// Value multiplier x10: 1x, 1.5x, 3x, 6x, 12x.
pub const RARITY_MULT10: [u32; 5] = [10, 15, 30, 60, 120];

// Chest tiers
pub const CHEST_NORMAL: u8 = 0;
pub const CHEST_GOLD: u8 = 1;
pub const CHEST_VAULT: u8 = 2;
pub const CHEST_BOSS: u8 = 3;

pub const CHEST_CLOSED: u8 = 0;
pub const CHEST_PENDING: u8 = 1;
pub const CHEST_OPEN: u8 = 2;
/// A chest waiting for VRF this long may be re-requested.
pub const CHEST_RETRY_TICKS: u32 = 60;

// Player states
pub const PS_EMPTY: u8 = 0;
pub const PS_ALIVE: u8 = 1;
pub const PS_DEAD: u8 = 2;
pub const PS_EXTRACTED: u8 = 3;

// Match phases
pub const PHASE_LOBBY: u8 = 0;
pub const PHASE_SEEDING: u8 = 1;
pub const PHASE_RUNNING: u8 = 2;
pub const PHASE_ENDED: u8 = 3;

// Room kinds
pub const ROOM_NORMAL: u8 = 0;
pub const ROOM_ENTRANCE: u8 = 1;
pub const ROOM_TREASURE: u8 = 2;
pub const ROOM_VAULT: u8 = 3;
pub const ROOM_BOSS: u8 = 4;
pub const ROOM_PORTAL: u8 = 5;

// Event kinds (client FX + match event log)
pub const EV_HIT_MON: u8 = 1;
pub const EV_HIT_PLAYER: u8 = 2;
pub const EV_MON_DIE: u8 = 3;
pub const EV_PLAYER_DIE: u8 = 4;
pub const EV_CHEST_OPEN: u8 = 5;
pub const EV_LOOT: u8 = 6;
pub const EV_PICKUP: u8 = 7;
pub const EV_EXTRACT: u8 = 8;
pub const EV_DOOR: u8 = 9;
pub const EV_ELITES: u8 = 10;
pub const EV_PORTALS: u8 = 11;
pub const EV_COLLAPSE: u8 = 12;
pub const EV_BETRAYAL: u8 = 13;
pub const EV_BLINK: u8 = 14;
pub const EV_SHIELD: u8 = 15;
pub const EV_DODGE: u8 = 16;
pub const EV_BOOM: u8 = 17;
pub const EV_SLAM: u8 = 18;
pub const EV_WINDUP: u8 = 19;
pub const EV_POTION: u8 = 20;
pub const EV_SPAWN: u8 = 21;
pub const EV_ATTACK: u8 = 22;
pub const EV_WAVE: u8 = 23;
pub const EV_JOIN: u8 = 24;
pub const EV_START: u8 = 25;
pub const EV_BOSS_RAGE: u8 = 26;

/// Source id used in events when a monster (not a player) caused damage.
pub const SRC_MONSTER: u8 = 100;
pub const SRC_WORLD: u8 = 250;
pub const NOBODY: u8 = 255;
