// Mirror of crates/ez-core (consts.rs + codec.rs). Keep in sync with WORLD_VERSION.

export const MAP_W = 64;
export const MAP_H = 48;
export const TILE = 256; // units per tile
export const PX = 16; // pixels per tile
export const U2PX = PX / TILE;
export const MAX_PLAYERS = 4;
export const MAX_MONSTERS = 40;
export const MAX_PROJECTILES = 24;
export const MAX_CHESTS = 20;
export const MAX_DROPS = 40;
export const MAX_PORTALS = 3;
export const MAX_ROOMS = 14;
export const INV_SLOTS = 8;
export const EVENT_CAP = 48;
export const NAME_LEN = 12;
export const WALL_BYTES = (MAP_W * MAP_H) / 8;
export const TICKS_PER_SEC = 10;
export const EXTRACT_TICKS = 40;
export const PORTAL_RADIUS = TILE + 64;
export const INTERACT_RADIUS = (TILE * 3) / 2;
export const PLAYER_RADIUS = 80;
export const DODGE_TICKS = 3;
export const DODGE_SPEED_MULT = 3;

export const CLASS_VANGUARD = 0;
export const CLASS_ARCANIST = 1;
export const CLASS_ROGUE = 2;

export const CLASSES = [
  { name: "Reaper", hp: 150, speed: 128, atkCd: 6, specCd: 110, role: "Spirit Blade / Guard", special: "Spirit Guard", desc: "A great spirit blade that cleaves wide. Spirit Guard blocks 75% damage, stuns and hurls Hollows back." },
  { name: "Spellbinder", hp: 90, speed: 120, atkCd: 5, specCd: 60, role: "Spirit Arts / Ranged", special: "Blue Flame", desc: "Casts bolts of spirit energy. Blue Flame bursts in an area — and burns anyone caught in it." },
  { name: "Shade", hp: 110, speed: 150, atkCd: 3, specCd: 45, role: "Speed / Assassin", special: "Blink Step", desc: "The fastest blade alive. Blink Step vanishes forward, grants a moment of immunity and a double-damage crit." },
];

export const MON = { NONE: 0, SKELETON: 1, NECRO: 2, BRUTE: 3, KING: 4, IMP: 5 } as const;
export const MON_NAMES = ["", "Lesser Hollow", "Howling Hollow", "Great Hollow", "The Hollow King", "Lost Soul"];
export const MON_RANGE = [0, 300, 256 * 6, 380, 460, 260];

export const PROJ = { NONE: 0, BOLT: 1, FIREBALL: 2, BONE: 3, ORB: 4 } as const;

export const ITEM = { NONE: 0, COINS: 1, GEM: 2, CHALICE: 3, IDOL: 4, CROWN: 5, BLADE: 6, AEGIS: 7, POTION: 8, KEY: 9, HEART: 10 } as const;
export const ITEM_NAMES = ["", "Soul Fragments", "Soul Gem", "Spirit Chalice", "Hollow Mask", "Moon Crown", "Spirit Blade", "Spirit Ward", "Spirit Draught", "Gate Seal", "Heart of the Hollow"];
export const ITEM_BASE = [0, 20, 45, 60, 90, 140, 70, 70, 0, 0, 160];
export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
export const RARITY_MULT10 = [10, 15, 30, 60, 120];
export const RARITY_COLORS = [0xc9c2b8, 0x5fd16b, 0x4aa8ff, 0xb46bff, 0xffb02e];
export const RARITY_CSS = ["#c9c2b8", "#5fd16b", "#4aa8ff", "#b46bff", "#ffb02e"];

export const CHEST = { NORMAL: 0, GOLD: 1, VAULT: 2, BOSS: 3 } as const;
export const CHEST_STATE = { CLOSED: 0, PENDING: 1, OPEN: 2 } as const;

export const PS = { EMPTY: 0, ALIVE: 1, DEAD: 2, EXTRACTED: 3 } as const;
export const PHASE = { LOBBY: 0, SEEDING: 1, RUNNING: 2, ENDED: 3 } as const;
export const ROOM = { NORMAL: 0, ENTRANCE: 1, TREASURE: 2, VAULT: 3, BOSS: 4, PORTAL: 5 } as const;
export const MS = { IDLE: 0, CHASE: 1, WINDUP: 2, RECOVER: 3, DEAD: 4 } as const;

export const EV = {
  HIT_MON: 1, HIT_PLAYER: 2, MON_DIE: 3, PLAYER_DIE: 4, CHEST_OPEN: 5, LOOT: 6, PICKUP: 7, EXTRACT: 8, DOOR: 9,
  ELITES: 10, PORTALS: 11, COLLAPSE: 12, BETRAYAL: 13, BLINK: 14, SHIELD: 15, DODGE: 16, BOOM: 17, SLAM: 18,
  WINDUP: 19, POTION: 20, SPAWN: 21, ATTACK: 22, WAVE: 23, JOIN: 24, START: 25, BOSS_RAGE: 26,
} as const;
export const SRC_MONSTER = 100;
export const SRC_WORLD = 250;
export const NOBODY = 255;

export const PLAYER_COLORS = [0xffc14d, 0x4de1ff, 0xff5fa8, 0x9dff5f];
export const PLAYER_CSS = ["#ffc14d", "#4de1ff", "#ff5fa8", "#9dff5f"];

export interface Item { kind: number; rarity: number }
export interface Player {
  state: number; cls: number; hp: number; maxHp: number; x: number; y: number; aim: number; moving: number;
  lastMoveTick: number; atkReady: number; specReady: number; dodgeReady: number; dodgeUntil: number; invulnUntil: number;
  shieldUntil: number; potionReady: number; crit: number; extract: number; lastHitBy: number; lastHitTick: number;
  kills: number; pvpKills: number; potions: number; keys: number; inv: Item[]; dmgDealt: number; activeTick: number;
  banked: number; name: string;
}
export interface Monster { kind: number; hp: number; maxHp: number; x: number; y: number; aim: number; state: number; timer: number; atkReady: number; target: number; room: number; elite: number; stunUntil: number }
export interface Projectile { kind: number; owner: number; x: number; y: number; vx: number; vy: number; dmg: number; ttl: number }
export interface Chest { tx: number; ty: number; tier: number; state: number; opener: number; reqTick: number }
export interface Drop { item: Item; x: number; y: number; spawnTick: number; from: number }
export interface Portal { tx: number; ty: number }
export interface Room { x: number; y: number; w: number; h: number; kind: number }
export interface Door { tx: number; ty: number; vertical: number; open: number }
export interface GameEvent { seq: number; tick: number; kind: number; a: number; b: number; c: number; x: number; y: number }

export interface World {
  version: number; phase: number; nonce: number; seed: Uint8Array; seedSrc: number; tick: number; host: number;
  eliteTick: number; portalTick: number; collapseTick: number; wave: number; settled: number; bossIdx: number;
  bossDmg: number[]; roomCount: number; door: Door; players: Player[]; monsters: Monster[]; projectiles: Projectile[];
  chests: Chest[]; drops: Drop[]; portals: Portal[]; rooms: Room[]; walls: Uint8Array; eventCount: number; events: GameEvent[];
}

export const WORLD_SIZE =
  88 + 99 * MAX_PLAYERS + 30 * MAX_MONSTERS + 21 * MAX_PROJECTILES + 9 * MAX_CHESTS + 15 * MAX_DROPS + 2 * MAX_PORTALS + 5 * MAX_ROOMS + WALL_BYTES + 4 + 16 * EVENT_CAP;

class Reader {
  p = 0;
  dv: DataView;
  constructor(public b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() { return this.dv.getUint8(this.p++); }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  u64() { const lo = this.u32(); const hi = this.u32(); return hi * 2 ** 32 + lo; }
  bytes(n: number) { const s = this.b.slice(this.p, this.p + n); this.p += n; return s; }
  item(): Item { return { kind: this.u8(), rarity: this.u8() }; }
}

const td = new TextDecoder();

export function decodeWorld(b: Uint8Array): World {
  if (b.length < WORLD_SIZE) throw new Error(`world bytes ${b.length} < ${WORLD_SIZE}`);
  const r = new Reader(b);
  const w: any = {};
  w.version = r.u8();
  w.phase = r.u8();
  w.nonce = r.u32();
  w.seed = r.bytes(32);
  w.seedSrc = r.u8();
  w.tick = r.u32();
  w.host = r.u8();
  w.eliteTick = r.u32();
  w.portalTick = r.u32();
  w.collapseTick = r.u32();
  r.u64(); // rng
  w.wave = r.u8();
  w.settled = r.u8();
  w.bossIdx = r.u8();
  w.bossDmg = [r.u32(), r.u32(), r.u32(), r.u32()];
  w.roomCount = r.u8();
  w.door = { tx: r.u8(), ty: r.u8(), vertical: r.u8(), open: r.u8() };
  w.players = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p: any = {};
    p.state = r.u8(); p.cls = r.u8(); p.hp = r.u16(); p.maxHp = r.u16(); p.x = r.i32(); p.y = r.i32();
    p.aim = r.u8(); p.moving = r.u8(); p.lastMoveTick = r.u32(); p.atkReady = r.u32(); p.specReady = r.u32();
    p.dodgeReady = r.u32(); p.dodgeUntil = r.u32(); p.invulnUntil = r.u32(); p.shieldUntil = r.u32(); p.potionReady = r.u32();
    p.crit = r.u8(); p.extract = r.u8(); p.lastHitBy = r.u8(); p.lastHitTick = r.u32();
    p.kills = r.u8(); p.pvpKills = r.u8(); p.potions = r.u8(); p.keys = r.u8();
    p.inv = []; for (let k = 0; k < INV_SLOTS; k++) p.inv.push(r.item());
    p.dmgDealt = r.u32(); p.activeTick = r.u32(); p.banked = r.u32();
    const nb = r.bytes(NAME_LEN); const z = nb.indexOf(0);
    p.name = td.decode(z >= 0 ? nb.slice(0, z) : nb).replace(/_+$/, "").trim();
    w.players.push(p);
  }
  w.monsters = [];
  for (let i = 0; i < MAX_MONSTERS; i++) {
    w.monsters.push({ kind: r.u8(), hp: r.u16(), maxHp: r.u16(), x: r.i32(), y: r.i32(), aim: r.u8(), state: r.u8(), timer: r.u32(), atkReady: r.u32(), target: r.u8(), room: r.u8(), elite: r.u8(), stunUntil: r.u32() });
  }
  w.projectiles = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    w.projectiles.push({ kind: r.u8(), owner: r.u8(), x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32(), dmg: r.u16(), ttl: r.u8() });
  }
  w.chests = [];
  for (let i = 0; i < MAX_CHESTS; i++) w.chests.push({ tx: r.u8(), ty: r.u8(), tier: r.u8(), state: r.u8(), opener: r.u8(), reqTick: r.u32() });
  w.drops = [];
  for (let i = 0; i < MAX_DROPS; i++) w.drops.push({ item: r.item(), x: r.i32(), y: r.i32(), spawnTick: r.u32(), from: r.u8() });
  w.portals = [];
  for (let i = 0; i < MAX_PORTALS; i++) w.portals.push({ tx: r.u8(), ty: r.u8() });
  w.rooms = [];
  for (let i = 0; i < MAX_ROOMS; i++) w.rooms.push({ x: r.u8(), y: r.u8(), w: r.u8(), h: r.u8(), kind: r.u8() });
  w.walls = r.bytes(WALL_BYTES);
  w.eventCount = r.u32();
  const raw: GameEvent[] = [];
  for (let i = 0; i < EVENT_CAP; i++) raw.push({ seq: 0, tick: r.u32(), kind: r.u8(), a: r.u8(), b: r.u8(), c: r.u8(), x: r.i32(), y: r.i32() });
  // Order ring buffer oldest -> newest with absolute sequence numbers.
  const n = Math.min(w.eventCount, EVENT_CAP);
  w.events = [];
  for (let k = w.eventCount - n; k < w.eventCount; k++) {
    const e = raw[k % EVENT_CAP];
    w.events.push({ ...e, seq: k });
  }
  return w as World;
}

export function isWall(w: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  const i = ty * MAP_W + tx;
  return (w.walls[i >> 3] & (1 << (i & 7))) !== 0;
}

export function itemValue(it: Item): number {
  if (!it.kind || it.kind >= ITEM_BASE.length) return 0;
  return Math.floor((ITEM_BASE[it.kind] * RARITY_MULT10[Math.min(it.rarity, 4)]) / 10);
}

export function lootValue(p: Player): number {
  return p.inv.reduce((s, i) => s + itemValue(i), 0);
}

export function itemLabel(it: Item): string {
  if (it.kind === ITEM.POTION || it.kind === ITEM.KEY) return ITEM_NAMES[it.kind];
  return `${RARITY_NAMES[it.rarity]} ${ITEM_NAMES[it.kind]}`;
}

export function portalsOpen(w: World) {
  return w.phase === PHASE.RUNNING && w.tick >= w.portalTick;
}

export function corruption(w: World) {
  if (!w.collapseTick) return 0;
  return Math.floor((Math.min(w.tick, w.collapseTick) * 100) / w.collapseTick);
}

/** Byte-angle trig matching the Rust core closely enough for rendering. */
export function angleRad(a: number) {
  return (a / 256) * Math.PI * 2;
}
export function radToByte(r: number) {
  let a = Math.round((r / (Math.PI * 2)) * 256);
  a %= 256;
  if (a < 0) a += 256;
  return a;
}

export function fmtTime(ticks: number) {
  const s = Math.max(0, Math.floor(ticks / TICKS_PER_SEC));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
