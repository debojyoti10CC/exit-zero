import Phaser from "phaser";
import { makeAnims, makeTextures, registerAtlas } from "./textures";
import { sfx } from "./audio";
import { hud, minimap } from "./hudStore";
import { ContractTracker } from "./contracts";
import { heroFrames, hollowFrames, bladeTexture } from "./reaperArt";
import type { GameSession, Snapshot } from "./session";
import {
  World, Player, Monster, Drop, isWall, MAP_W, MAP_H, TILE, U2PX, PX, CLASSES, MON, PROJ, ITEM, CHEST, CHEST_STATE, PS, PHASE, EV, MS,
  ROOM, RARITY_COLORS, RARITY_CSS, PLAYER_COLORS, PLAYER_CSS, MON_NAMES, NOBODY, SRC_MONSTER, SRC_WORLD, ITEM_NAMES, EXTRACT_TICKS,
  INTERACT_RADIUS, PORTAL_RADIUS, DODGE_SPEED_MULT, TICKS_PER_SEC, radToByte, angleRad, itemLabel, itemValue, lootValue, portalsOpen,
  corruption, fmtTime, MON_RANGE, CLASS_ARCANIST, CLASS_ROGUE, CLASS_VANGUARD,
} from "./world";

const VIEW_W = 960;
const VIEW_H = 540;
const ZOOM = 3;
const MAP_PX_W = MAP_W * PX;
const MAP_PX_H = MAP_H * PX;
const SEND_MS = 66;

const HERO = [
  ["knight_m", "knight_f"],
  ["wizzard_m", "wizzard_f"],
  ["elf_m", "elf_f"],
];
const WEAPON = ["weapon_katana", "weapon_green_magic_staff", "weapon_katana"];
/** Black robes: heroes are drawn darkened, like ink silhouettes with bright blades. */
const ROBE_TINT = 0x6c7088;
/** Hollows: bone-white masks; the King keeps a faint crimson. Lost Souls are shadows. */
const HOLLOW_TINT = [0xffffff, 0xf2f4ff, 0xe6ecff, 0xeaeef8, 0xffe4e4, 0x4a4e66];

function px(u: number) {
  return u * U2PX;
}
function hash(a: number, b: number, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface PlayerView {
  sprite: Phaser.GameObjects.Sprite;
  weapon: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  aura: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  cls: number;
  state: number;
  flashUntil: number;
  swingUntil: number;
  swingDir: number;
  lastX: number;
  lastY: number;
}
interface MonsterView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  kind: number;
  dead: boolean;
  flashUntil: number;
  bang?: Phaser.GameObjects.Text;
}
interface ProjView {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  kind: number;
}
interface DropView {
  spark?: Phaser.GameObjects.Particles.ParticleEmitter;
  icon: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  beam?: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  key: string;
  bornAt: number;
  x: number;
  y: number;
}
interface ChestView {
  sprite: Phaser.GameObjects.Sprite;
  glow?: Phaser.GameObjects.Image;
  state: number;
  rolling?: Phaser.GameObjects.Text;
}
interface Light {
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface SceneHooks {
  onEnd: (w: World, me: number) => void;
  onPauseToggle: () => void;
}

export class GameScene extends Phaser.Scene {
  session!: GameSession;
  hooks!: SceneHooks;
  snaps: Snapshot[] = [];
  world: World | null = null;
  built = false;
  lastSeq = -1;

  uiCam!: Phaser.Cameras.Scene2D.Camera;
  mapRT!: Phaser.GameObjects.RenderTexture;
  darkRT!: Phaser.GameObjects.RenderTexture;
  fogRT!: Phaser.GameObjects.RenderTexture;
  lightImg!: Phaser.GameObjects.Image;
  tele!: Phaser.GameObjects.Graphics;
  uiG!: Phaser.GameObjects.Graphics;
  overlay!: Phaser.GameObjects.Rectangle;
  hurtOverlay!: Phaser.GameObjects.Rectangle;

  players: (PlayerView | null)[] = [null, null, null, null];
  monsters: (MonsterView | null)[] = [];
  projs: (ProjView | null)[] = [];
  drops: (DropView | null)[] = [];
  chests: (ChestView | null)[] = [];
  portalViews: { base: Phaser.GameObjects.Image; swirl: Phaser.GameObjects.Image; swirl2: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  door?: Phaser.GameObjects.Image;
  torches: { x: number; y: number; glow: Phaser.GameObjects.Image; seed: number }[] = [];
  explored = new Uint8Array(MAP_W * MAP_H);
  staticLights: Light[] = [];
  dyn: Light[] = [];

  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  pred: { x: number; y: number } | null = null;
  snapNext = false;
  lastSend = 0;
  lastSentX = 0;
  lastSentY = 0;
  lastSentAim = 0;
  lastSentMoving = false;
  aim = 64;
  atkHeld = false;
  nextAtk = 0;
  dodgeUntil = 0;
  hitStop = 0;
  rivalToast: number[] = [0, 0, 0, 0];
  contracts: ContractTracker | null = null;
  lastLoot = 0;
  lastBeat = 0;
  lastPos = { x: 0, y: 0 };
  endNotified = false;
  endTimer = 0;
  lastHud = 0;
  lastFog = 0;
  lastMinimap = 0;
  vignette?: Phaser.FX.Vignette;
  colorFx?: Phaser.FX.ColorMatrix;
  spectate = -1;
  lowHpPulse = 0;
  mmCanvas!: HTMLCanvasElement;
  dmgTexts: { t: Phaser.GameObjects.Text; wx: number; wy: number; born: number; vy: number }[] = [];
  unsub: (() => void) | null = null;

  constructor() {
    super("game");
  }

  init(data: { session: GameSession; hooks: SceneHooks }) {
    this.session = data.session;
    this.hooks = data.hooks;
    this.snaps = [];
    this.world = null;
    this.built = false;
    this.lastSeq = -1;
    this.players = [null, null, null, null];
    this.monsters = [];
    this.projs = [];
    this.drops = [];
    this.chests = [];
    this.portalViews = [];
    this.torches = [];
    this.staticLights = [];
    this.explored = new Uint8Array(MAP_W * MAP_H);
    this.pred = null;
    this.endNotified = false;
    this.endTimer = 0;
    this.dmgTexts = [];
  }

  preload() {
    if (!this.textures.exists("dungeon")) this.load.image("dungeon", `${import.meta.env.BASE_URL}assets/0x72/0x72_DungeonTilesetII_v1.7.png`);
    if (!this.cache.text.exists("tilelist")) this.load.text("tilelist", `${import.meta.env.BASE_URL}assets/0x72/tile_list_v1.7.txt`);
  }

  create() {
    if (!this.textures.get("dungeon").has("floor_1")) registerAtlas(this, this.cache.text.get("tilelist"));
    if (!this.textures.exists("light")) makeTextures(this);
    makeAnims(this);
    this.registerReaperArt();

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBackgroundColor("#050307");
    cam.setRoundPixels(true);
    this.uiCam = this.cameras.add(0, 0, VIEW_W, VIEW_H);
    this.uiCam.setScroll(0, 0);

    this.mapRT = this.w(this.add.renderTexture(0, 0, MAP_PX_W, MAP_PX_H).setOrigin(0).setDepth(0));
    this.tele = this.w(this.add.graphics().setDepth(1));
    this.darkRT = this.w(this.add.renderTexture(0, 0, MAP_PX_W, MAP_PX_H).setOrigin(0).setDepth(9000));
    this.fogRT = this.w(this.add.renderTexture(0, 0, MAP_PX_W, MAP_PX_H).setOrigin(0).setDepth(9500));
    this.fogRT.fill(0x050307, 1);
    this.lightImg = this.add.image(0, 0, "light").setVisible(false);
    this.uiCam.ignore(this.lightImg);
    cam.ignore(this.lightImg);

    this.uiG = this.u(this.add.graphics().setDepth(10));
    this.overlay = this.u(this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x7a0018, 0).setOrigin(0).setDepth(5).setBlendMode(Phaser.BlendModes.ADD));
    this.hurtOverlay = this.u(this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0xff0022, 0).setOrigin(0).setDepth(6));

    try {
      this.vignette = cam.postFX.addVignette(0.5, 0.5, 0.92, 0.42);
      this.colorFx = cam.postFX.addColorMatrix();
    } catch {
      /* canvas renderer: no FX */
    }

    // Input
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,Q,ONE,TAB,M,ESC,SHIFT") as any;
    kb.addCapture("TAB,SPACE,UP,DOWN,LEFT,RIGHT");
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      sfx.ensure();
      if (p.rightButtonDown()) this.doSpecial();
      else {
        this.atkHeld = true;
        this.doAttack();
      }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) this.atkHeld = false;
    });
    this.keys.SPACE.on("down", () => this.doDodge());
    this.keys.SHIFT.on("down", () => this.doDodge());
    this.keys.E.on("down", () => this.session.interact());
    this.keys.Q.on("down", () => this.doPotion());
    this.keys.ONE.on("down", () => this.doPotion());
    this.keys.TAB.on("down", () => hud.set({ inventoryOpen: !hud.get().inventoryOpen }));
    this.keys.ESC.on("down", () => this.hooks.onPauseToggle());

    // Minimap canvas (2px per tile)
    this.mmCanvas = document.createElement("canvas");
    this.mmCanvas.width = MAP_W * 3;
    this.mmCanvas.height = MAP_H * 3;
    minimap.canvas = this.mmCanvas;

    this.unsub = this.session.onSnapshot((s) => this.onSnapshot(s));
    if (this.session.latest) this.onSnapshot(this.session.latest);
    this.events.once("shutdown", () => this.cleanup());
    sfx.startAmbience();
  }

  /** Registers the theme's original reaper and Hollow pixel art as textures + animations. */
  registerReaperArt() {
    const add = (key: string, c: HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
    };
    for (let cls = 0; cls < 3; cls++) {
      heroFrames(cls).forEach((c, i) => add(`rh${cls}_${i}`, c));
      if (!this.anims.exists(`rh${cls}_idle`)) {
        this.anims.create({ key: `rh${cls}_idle`, frames: [0, 1].map((i) => ({ key: `rh${cls}_${i}` })), frameRate: 3, repeat: -1 });
        this.anims.create({ key: `rh${cls}_run`, frames: [2, 3, 4, 5].map((i) => ({ key: `rh${cls}_${i}` })), frameRate: 11, repeat: -1 });
      }
    }
    for (let k = 1; k <= 5; k++) {
      hollowFrames(k).forEach((c, i) => add(`hol${k}_${i}`, c));
      if (!this.anims.exists(`hol${k}_idle`)) {
        this.anims.create({ key: `hol${k}_idle`, frames: [0, 1].map((i) => ({ key: `hol${k}_${i}` })), frameRate: 3, repeat: -1 });
        this.anims.create({ key: `hol${k}_run`, frames: [0, 1].map((i) => ({ key: `hol${k}_${i}` })), frameRate: 8, repeat: -1 });
      }
    }
    add("nodachi", bladeTexture());
  }

  cleanup() {
    this.unsub?.();
    sfx.stopAmbience();
    minimap.canvas = null;
  }

  /** Registers a world-space object (hidden from the UI camera). */
  w<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.uiCam?.ignore(o);
    return o;
  }
  /** Registers a screen-space UI object (hidden from the world camera). */
  u<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.cameras.main.ignore(o);
    return o;
  }

  get me() {
    return this.session.me;
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  onSnapshot(s: Snapshot) {
    this.snaps.push(s);
    if (this.snaps.length > 6) this.snaps.shift();
    const prev = this.world;
    this.world = s.world;
    const w = s.world;
    if (!this.built && w.phase >= PHASE.RUNNING && w.roomCount > 0) {
      this.buildMap(w);
      this.contracts = new ContractTracker(w.seed[0] | (w.seed[1] << 8) | (w.seed[2] << 16) | (w.nonce << 3));
      this.lastSeq = w.eventCount - 1;
      this.built = true;
    }
    if (!this.built) return;
    // Events since last snapshot
    for (const e of w.events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      this.onEvent(e, w, prev);
    }
    // Chest / door state changes
    this.syncChests(w);
    if (this.door && w.door.open) this.door.setFrame("doors_leaf_open");
  }

  // ---------------------------------------------------------------------------
  // Map construction
  // ---------------------------------------------------------------------------

  buildMap(w: World) {
    const seed = w.seed[0] + w.seed[1] * 256;
    const rt = this.mapRT;
    rt.clear();
    const floor = (x: number, y: number) => !isWall(w, x, y);
    const tmp = this.add.image(0, 0, "dungeon", "wall_top_mid").setOrigin(0.5).setVisible(false);
    const g = this.add.graphics().setVisible(false);

    rt.beginDraw();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const X = x * PX;
        const Y = y * PX;
        if (floor(x, y)) {
          const r = hash(x, y, seed);
          const f = r < 0.72 ? "floor_1" : `floor_${2 + Math.floor(hash(y, x, seed) * 7)}`;
          rt.batchDrawFrame("dungeon", f, X, Y);
          continue;
        }
        const S = floor(x, y + 1);
        const N = floor(x, y - 1);
        const E = floor(x + 1, y);
        const Wf = floor(x - 1, y);
        if (S) {
          const r = hash(x, y, seed + 3);
          let f = "wall_mid";
          if (r < 0.05) f = "wall_hole_1";
          else if (r < 0.09) f = "wall_hole_2";
          else if (r < 0.12) f = "wall_goo";
          rt.batchDrawFrame("dungeon", f, X, Y);
          if (!floor(x, y - 1)) rt.batchDrawFrame("dungeon", "wall_top_mid", X, Y - PX);
        } else if (N) {
          rt.batchDrawFrame("dungeon", "wall_top_mid", X, Y);
        }
      }
    }
    rt.endDraw();

    // Side rims (rotated wall caps) where floor is beside the wall.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (floor(x, y) || floor(x, y + 1) || floor(x, y - 1)) continue;
        const E = floor(x + 1, y);
        const Wf = floor(x - 1, y);
        if (E || Wf) {
          tmp.setPosition(x * PX + 8, y * PX + 8).setAngle(E ? 90 : -90);
          rt.draw(tmp);
        }
      }
    }
    // Ambient occlusion under wall faces and beside side walls.
    g.clear();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!floor(x, y)) continue;
        if (!floor(x, y - 1)) {
          g.fillStyle(0x000000, 0.35).fillRect(x * PX, y * PX, PX, 3);
          g.fillStyle(0x000000, 0.18).fillRect(x * PX, y * PX + 3, PX, 3);
        }
        if (!floor(x - 1, y)) g.fillStyle(0x000000, 0.22).fillRect(x * PX, y * PX, 3, PX);
        if (!floor(x + 1, y)) g.fillStyle(0x000000, 0.22).fillRect(x * PX + PX - 3, y * PX, 3, PX);
      }
    }
    // Room tints: boss room blood, vault gold, entrance cool.
    for (let i = 0; i < w.roomCount; i++) {
      const r = w.rooms[i];
      const col = r.kind === ROOM.BOSS ? 0x5a0010 : r.kind === ROOM.VAULT ? 0x4a3500 : r.kind === ROOM.ENTRANCE ? 0x0a1f3a : -1;
      if (col >= 0) g.fillStyle(col, 0.22).fillRect(r.x * PX, r.y * PX, r.w * PX, r.h * PX);
    }
    g.fillStyle(0x0b1a33, 0.22).fillRect(0, 0, MAP_PX_W, MAP_PX_H);
    rt.draw(g);
    tmp.destroy();
    g.destroy();

    this.buildDecor(w, seed);
    this.buildPortals(w);
    this.syncChests(w);

    if (w.door.tx || w.door.ty) {
      const d = w.door;
      const dx = d.vertical ? d.tx * PX + 8 : d.tx * PX + PX;
      const dy = d.vertical ? d.ty * PX + PX : d.ty * PX + 8;
      this.door = this.w(this.add.image(dx, dy + 8, "dungeon", d.open ? "doors_leaf_open" : "doors_leaf_closed").setOrigin(0.5, 1).setDepth(dy + 8));
      if (d.vertical) this.door.setScale(0.9, 1);
      this.staticLights.push({ x: dx, y: dy, r: 40, a: 0.5 });
    }

    // Camera bounds
    const cam = this.cameras.main;
    cam.setBounds(-200, -200, MAP_PX_W + 400, MAP_PX_H + 400);
    const me = w.players[this.me];
    this.pred = { x: me.x, y: me.y };
    cam.centerOn(px(me.x), px(me.y));
    this.revealAround(px(me.x), px(me.y), true);
  }

  buildDecor(w: World, seed: number) {
    const floor = (x: number, y: number) => !isWall(w, x, y);
    for (let i = 0; i < w.roomCount; i++) {
      const r = w.rooms[i];
      // Torches on the top wall of every room, banners between them.
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        const ty = r.y - 1;
        if (!isWall(w, x, ty) || !floor(x, r.y)) continue;
        const h = hash(x, ty, seed + i);
        if ((x - r.x) % 4 === 2) this.addTorch(x * PX + 8, ty * PX + 6, h);
        else if (h < 0.22 && r.kind !== ROOM.BOSS) {
          const banner = ["wall_banner_red", "wall_banner_blue", "wall_banner_green", "wall_banner_yellow"][Math.floor(h * 18) % 4];
          this.w(this.add.image(x * PX, ty * PX, "dungeon", banner).setOrigin(0).setDepth(2));
        }
      }
      if (r.kind === ROOM.BOSS) {
        // Blood fountains flank the throne.
        for (const fx of [r.x + 1, r.x + r.w - 2]) {
          const ty = r.y - 1;
          if (!isWall(w, fx, ty)) continue;
          this.w(this.add.sprite(fx * PX, ty * PX, "dungeon", "wall_fountain_mid_red_anim_f0").setOrigin(0).setDepth(2).play("fountain_red"));
          this.w(this.add.sprite(fx * PX, r.y * PX, "dungeon", "wall_fountain_basin_red_anim_f0").setOrigin(0).setDepth(2).play("basin_red"));
          this.staticLights.push({ x: fx * PX + 8, y: r.y * PX + 4, r: 46, a: 0.7 });
        }
      }
      if (r.kind === ROOM.ENTRANCE) {
        const cx = Math.floor(r.x + r.w / 2);
        const ty = r.y - 1;
        if (isWall(w, cx, ty)) {
          this.w(this.add.sprite(cx * PX, ty * PX, "dungeon", "wall_fountain_mid_blue_anim_f0").setOrigin(0).setDepth(2).play("fountain_blue"));
          this.w(this.add.sprite(cx * PX, r.y * PX, "dungeon", "wall_fountain_basin_blue_anim_f0").setOrigin(0).setDepth(2).play("basin_blue"));
        }
        this.w(this.add.image(r.x * PX + (r.w * PX) / 2, r.y * PX + (r.h * PX) / 2, "dungeon", "floor_ladder").setDepth(1));
        this.staticLights.push({ x: r.x * PX + (r.w * PX) / 2, y: r.y * PX + (r.h * PX) / 2, r: 70, a: 0.6 });
      }
      // Columns in big rooms.
      if (r.w >= 9 && r.h >= 7 && r.kind !== ROOM.ENTRANCE) {
        for (const [cx, cy] of [
          [r.x + 1, r.y + 2],
          [r.x + r.w - 2, r.y + 2],
          [r.x + 1, r.y + r.h - 1],
          [r.x + r.w - 2, r.y + r.h - 1],
        ]) {
          if (hash(cx, cy, seed) < 0.55) continue;
          const ok = floor(cx, cy) && floor(cx, cy - 1);
          if (!ok) continue;
          // Columns are visual only; they sit in floor corners away from chests.
          if (w.chests.some((c) => Math.abs(c.tx - cx) <= 1 && Math.abs(c.ty - cy) <= 1)) continue;
          const col = this.w(this.add.image(cx * PX + 8, cy * PX + 16, "dungeon", "column").setOrigin(0.5, 1));
          col.setDepth(cy * PX + 16).setAlpha(0.95);
        }
      }
      // Bones, skulls and crates scattered on the floor.
      const n = Math.floor(r.w * r.h * 0.06);
      for (let k = 0; k < n; k++) {
        const tx = r.x + 1 + Math.floor(hash(k, i, seed + 11) * (r.w - 2));
        const ty = r.y + 1 + Math.floor(hash(i, k, seed + 13) * (r.h - 2));
        if (!floor(tx, ty)) continue;
        if (w.chests.some((c) => c.tx === tx && c.ty === ty)) continue;
        const h = hash(tx, ty, seed + 17);
        const ox = Math.floor(hash(ty, tx, 5) * 8) - 4;
        const oy = Math.floor(hash(tx, k, 7) * 8) - 4;
        if (h < 0.5) this.w(this.add.image(tx * PX + 8 + ox, ty * PX + 8 + oy, "icon_bone").setAlpha(0.7).setDepth(1).setAngle(h * 720));
        else if (h < 0.75) this.w(this.add.image(tx * PX + 8 + ox, ty * PX + 8 + oy, "dungeon", "skull").setDepth(1).setAlpha(0.85));
        else if (h < 0.85 && (!floor(tx, ty - 1) || !floor(tx - 1, ty) || !floor(tx + 1, ty))) {
          this.w(this.add.image(tx * PX + 8, ty * PX + 16, "dungeon", "crate").setOrigin(0.5, 1).setDepth(ty * PX + 16));
        }
      }
    }
    // Dust motes drifting in the dark.
    const dust = this.w(
      this.add.particles(0, 0, "px1", {
        x: { min: 0, max: MAP_PX_W },
        y: { min: 0, max: MAP_PX_H },
        lifespan: 6000,
        speedX: { min: -3, max: 3 },
        speedY: { min: -4, max: 1 },
        alpha: { start: 0.0, end: 0.5, ease: "Sine.easeInOut" },
        scale: 1,
        tint: 0xbba890,
        frequency: 40,
        quantity: 1,
      }),
    );
    dust.setDepth(8000);
  }

  addTorch(x: number, y: number, seed: number) {
    const glow = this.w(this.add.image(x, y, "glow").setTint(0x5ab8ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(9100).setScale(0.55).setAlpha(0.5));
    this.w(
      this.add
        .particles(x, y, "px", {
          lifespan: { min: 300, max: 600 },
          speedY: { min: -18, max: -8 },
          speedX: { min: -3, max: 3 },
          scale: { start: 1, end: 0 },
          tint: [0xffffff, 0x9fe0ff, 0x3a8ae0],
          alpha: { start: 1, end: 0 },
          frequency: 70,
          blendMode: "ADD",
        })
        .setDepth(9101),
    );
    // Sconce
    const g = this.w(this.add.graphics().setDepth(3));
    g.fillStyle(0x2b1d12, 1).fillRect(x - 2, y + 1, 4, 3);
    g.fillStyle(0x6b4a2a, 1).fillRect(x - 1, y, 2, 1);
    this.torches.push({ x, y, glow, seed });
  }

  buildPortals(w: World) {
    for (const p of w.portals) {
      if (!p.tx && !p.ty) continue;
      const x = p.tx * PX + 8;
      const y = p.ty * PX + 8;
      const base = this.w(this.add.image(x, y, "ring").setScale(0.75, 0.42).setTint(0x4a5470).setAlpha(0.6).setDepth(1));
      const swirl = this.w(this.add.image(x, y - 6, "swirl").setScale(0.5, 0.75).setTint(0xbfe6ff).setAlpha(0.15).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 2));
      const swirl2 = this.w(this.add.image(x, y - 6, "swirl").setScale(0.35, 0.55).setTint(0xffffff).setAlpha(0.0).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 3));
      const glow = this.w(this.add.image(x, y - 4, "glow").setTint(0x7ad0ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(9102).setAlpha(0.15));
      // Rune stones around the pad
      const g = this.w(this.add.graphics().setDepth(1));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.fillStyle(0x2a2f40, 1).fillRect(x + Math.cos(a) * 20 - 1.5, y + Math.sin(a) * 12 - 1.5, 3, 3);
        g.fillStyle(0x9fe0ff, 0.8).fillRect(x + Math.cos(a) * 20 - 0.5, y + Math.sin(a) * 12 - 0.5, 1, 1);
      }
      this.portalViews.push({ base, swirl, swirl2, glow, x, y });
    }
  }

  syncChests(w: World) {
    w.chests.forEach((c, i) => {
      if (!c.tx && !c.ty) return;
      let v = this.chests[i];
      const x = c.tx * PX + 8;
      const y = c.ty * PX + 12;
      if (!v) {
        const s = this.w(this.add.sprite(x, y, "dungeon", c.state === CHEST_STATE.OPEN ? "chest_full_open_anim_f2" : "chest_full_open_anim_f0").setOrigin(0.5, 0.75).setDepth(y));
        if (c.tier === CHEST.GOLD) s.setTint(0xffe08a);
        if (c.tier === CHEST.VAULT) s.setTint(0xd9b3ff);
        if (c.tier === CHEST.BOSS) s.setScale(1.5).setTint(0xff9a9a);
        let glow: Phaser.GameObjects.Image | undefined;
        if (c.tier !== CHEST.NORMAL) {
          const col = c.tier === CHEST.GOLD ? 0xffc040 : c.tier === CHEST.VAULT ? 0xb46bff : 0xff3050;
          glow = this.w(this.add.image(x, y - 4, "glow").setTint(col).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setScale(0.45).setDepth(9103));
        }
        v = { sprite: s, glow, state: c.state };
        this.chests[i] = v;
      }
      if (v.state !== c.state) {
        const near = this.near(c.tx * TILE, c.ty * TILE, 200);
        if (c.state === CHEST_STATE.PENDING) {
          if (near) sfx.chestCreak();
          v.rolling?.destroy();
          v.rolling = this.u(this.add.text(0, 0, "VRF", { fontFamily: "Silkscreen", fontSize: "11px", color: "#c9a7ff", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(20));
        }
        if (c.state === CHEST_STATE.OPEN) {
          v.sprite.play(c.tier === CHEST.BOSS ? "chest_open" : "chest_open");
          v.rolling?.destroy();
          v.rolling = undefined;
          v.glow?.setAlpha(0.12);
          this.burst(x, y - 4, c.tier === CHEST.NORMAL ? 0xffd27a : 0xd0a0ff, 18);
          if (near) sfx.chestOpen();
        }
        v.state = c.state;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Events → FX
  // ---------------------------------------------------------------------------

  pname(i: number, w: World) {
    if (i >= 4) return "?";
    const p = w.players[i];
    const n = p.name || CLASSES[p.cls]?.name || `P${i + 1}`;
    return `<b style="color:${PLAYER_CSS[i]}">${escapeHtml(n)}</b>`;
  }

  pan(x: number) {
    const cam = this.cameras.main;
    const cx = cam.worldView.centerX;
    return Phaser.Math.Clamp((px(x) - cx) / 160, -1, 1);
  }

  near(x: number, y: number, r = 260) {
    const cam = this.cameras.main;
    return Math.abs(px(x) - cam.worldView.centerX) < r && Math.abs(px(y) - cam.worldView.centerY) < r;
  }

  onEvent(e: World["events"][number], w: World, prev: World | null) {
    const me = this.me;
    const X = px(e.x);
    const Y = px(e.y);
    const pan = this.pan(e.x);
    const audible = this.near(e.x, e.y, 220);
    const finished = this.contracts?.onEvent(e, w, me);
    if (finished) {
      sfx.potion();
      hud.toast({ title: "CONTRACT COMPLETE", sub: finished, color: "#5fd16b" }, 2400);
    }
    if (e.kind === EV.MON_DIE && e.b === me && this.contracts) {
      const n = this.contracts.counts.streak;
      if (n >= 2) {
        const names = ["", "", "DOUBLE KILL", "TRIPLE KILL", "RAMPAGE", "MASSACRE", "UNSTOPPABLE"];
        hud.toast({ title: names[Math.min(n, 6)], sub: `${n} in a row`, color: n >= 4 ? "#ff6a3a" : "#ffcf5a" }, 1300);
        sfx.pickup(Math.min(4, n));
      }
      hud.set({ streak: n });
    }
    switch (e.kind) {
      case EV.HIT_MON: {
        const v = this.monsters[e.a];
        if (v) v.flashUntil = performance.now() + 90;
        const mine = e.b === me;
        this.dmgNumber(X, Y - 14, e.c, mine ? "#ffe066" : "#e8e0d0", mine ? 1.15 : 0.9);
        this.burst(X, Y - 6, w.monsters[e.a]?.kind === MON.IMP ? 0xb04aff : 0xeae2c8, mine ? 6 : 3);
        if (mine) {
          sfx.hit(pan);
          if (w.players[me].cls !== CLASS_ARCANIST) this.hitStop = performance.now() + 55;
          this.cameras.main.shake(60, 0.0018);
        } else if (audible) sfx.hit(pan * 0.5);
        break;
      }
      case EV.HIT_PLAYER: {
        const mine = e.a === me;
        this.dmgNumber(X, Y - 20, e.c, mine ? "#ff4d5e" : "#ff9a5a", mine ? 1.2 : 0.9);
        this.burst(X, Y - 8, 0xc01830, mine ? 10 : 5);
        const v = this.players[e.a];
        if (v) v.flashUntil = performance.now() + 90;
        if (mine) {
          sfx.hurt();
          this.cameras.main.shake(140, 0.006);
          this.hurtOverlay.setAlpha(0.28);
          this.tweens.add({ targets: this.hurtOverlay, alpha: 0, duration: 380 });
          if (e.b < 4 && e.b !== me && performance.now() - (this.rivalToast[e.b] || 0) > 3000) {
            this.rivalToast[e.b] = performance.now();
            hud.toast({ title: `${w.players[e.b].name || "A rival"} attacks you!`, color: "#ff5a6a" }, 1400);
          }
        }
        break;
      }
      case EV.MON_DIE: {
        const kind = e.c;
        sfx.monsterDie(pan);
        this.purify(X, Y - 6, kind === MON.KING ? 70 : kind === MON.BRUTE ? 34 : 18);
        if (kind === MON.KING) {
          sfx.gong();
          this.cameras.main.shake(700, 0.012);
          this.cameras.main.flash(300, 255, 80, 80);
          hud.toast({ title: "THE HOLLOW KING IS PURIFIED", sub: "Every blade that struck him is rewarded", color: "#ff6070", big: true }, 4000);
          hud.feed(`${e.b < 4 ? this.pname(e.b, w) : "Someone"} landed the killing blow on <b style="color:#ff6070">The Hollow King</b>`);
        } else if (kind === MON.BRUTE && e.b < 4) {
          hud.feed(`${this.pname(e.b, w)} purified a <b>Great Hollow</b>`);
        }
        break;
      }
      case EV.PLAYER_DIE: {
        const victim = this.pname(e.a, w);
        const by = e.b < 4 ? this.pname(e.b, w) : e.b === SRC_WORLD ? "the sealing gates" : "a Hollow";
        hud.feed(`${victim} was devoured by ${by}`);
        this.burst(X, Y - 8, 0xb01020, 30, 50);
        if (e.a === me) {
          let best = 1e9;
          for (const p of w.portals) if (p.tx || p.ty) best = Math.min(best, Math.hypot(p.tx * TILE + 128 - e.x, p.ty * TILE + 128 - e.y));
          hud.set({ death: { lost: this.lastLoot, portalTiles: Math.round(best / TILE), portalsOpen: portalsOpen(w) } });
          sfx.playerDie();
          this.cameras.main.shake(400, 0.01);
          hud.toast({ title: "YOUR SOUL FADES", sub: "Your unbanked haul lies on the floor", color: "#ff3046", big: true }, 3500);
        } else if (audible) sfx.playerDie();
        break;
      }
      case EV.BETRAYAL: {
        sfx.betrayal();
        const items = e.c;
        hud.toast({ title: "BETRAYAL", sub: `${w.players[e.a].name || "A rival"} cut down ${w.players[e.b].name || "a rival"}${items ? ` — ${items} item${items > 1 ? "s" : ""} spilled` : ""}`, color: "#ff2e4d", big: true }, 3200);
        hud.feed(`<b style="color:#ff2e4d">BETRAYAL</b> ${this.pname(e.a, w)} ✕ ${this.pname(e.b, w)}`);
        break;
      }
      case EV.CHEST_OPEN:
        break;
      case EV.LOOT: {
        const mineChest = e.a < w.chests.length && w.chests[e.a].opener === me;
        if (e.c >= 4 && (audible || mineChest)) {
          sfx.legendary();
          this.cameras.main.flash(180, 120, 90, 30);
          hud.toast({ title: "LEGENDARY DROP", sub: ITEM_NAMES[e.b], color: RARITY_CSS[4], big: true }, 2800);
        } else if (e.c >= 4) {
          hud.feed(`A <b style="color:${RARITY_CSS[4]}">legendary ${ITEM_NAMES[e.b]}</b> was found somewhere in the crypt…`);
        } else if (e.c === 3 && audible) {
          sfx.pickup(3);
        }
        break;
      }
      case EV.PICKUP: {
        const it = { kind: e.b, rarity: e.c };
        if (e.a === me) {
          sfx.pickup(e.c);
          const v = itemValue(it);
          hud.toast({ title: `+ ${itemLabel(it)}`, sub: v ? `${v} gold value — unbanked` : undefined, color: e.b === ITEM.POTION ? "#ff6a7a" : e.b === ITEM.KEY ? "#ffd65a" : RARITY_CSS[e.c] }, 1600);
        }
        break;
      }
      case EV.EXTRACT: {
        sfx.extract();
        this.extractBeam(X, Y);
        const p = w.players[e.a];
        hud.feed(`${this.pname(e.a, w)} <b style="color:#9fe0ff">crossed over</b> with <b style="color:#ffcf5a">${p.banked}</b>`);
        if (e.a === me) hud.toast({ title: "CROSSED OVER", sub: `${p.banked} soul value banked`, color: "#c9a2ff", big: true }, 3500);
        break;
      }
      case EV.DOOR:
        sfx.door();
        this.cameras.main.shake(200, 0.004);
        hud.feed(`${this.pname(e.a, w)} unlocked the <b style="color:#ffd65a">Vault</b>`);
        break;
      case EV.ELITES:
        sfx.alarm();
        hud.toast({ title: "GREAT HOLLOWS RISE", sub: "Their spiritual pressure fills the halls", color: "#ff9a3a", big: true }, 3000);
        break;
      case EV.PORTALS:
        sfx.gong();
        this.cameras.main.flash(400, 150, 90, 255);
        hud.toast({ title: "THE SPIRIT GATES OPEN", sub: "Reach a gate and hold to cross over", color: "#b98bff", big: true }, 3500);
        break;
      case EV.WAVE:
        hud.feed(`<b style="color:#c06bff">Corruption wave ${e.a}</b> — imps spill from the walls`);
        break;
      case EV.COLLAPSE:
        sfx.boom();
        this.cameras.main.shake(1200, 0.02);
        hud.toast({ title: "THE GATES SEAL FOREVER", color: "#ff3046", big: true }, 4000);
        break;
      case EV.BLINK: {
        const p = w.players[e.a];
        this.trail(X, Y, px(p.x), px(p.y), 0x7a5cff);
        if (e.a === me) {
          sfx.blink();
          this.snapNext = true;
        }
        break;
      }
      case EV.SHIELD: {
        if (e.a === me) sfx.shield();
        const ring = this.w(this.add.image(X, Y - 8, "ring").setTint(0x6ac8ff).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(9200));
        this.tweens.add({ targets: ring, scale: 0.9, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
        break;
      }
      case EV.DODGE:
        if (e.a !== me && audible) sfx.dodge();
        this.burst(X, Y, 0x8a7a6a, 6, 20);
        break;
      case EV.BOOM: {
        sfx.boom(pan);
        this.explosion(X, Y);
        if (this.near(e.x, e.y, 120)) this.cameras.main.shake(220, 0.008);
        break;
      }
      case EV.SLAM: {
        if (audible) sfx.slam(pan);
        const r = e.b === MON.KING ? 1.6 : 1.2;
        const ring = this.w(this.add.image(X, Y, "ring").setTint(0xff4040).setScale(0.1, 0.06).setBlendMode(Phaser.BlendModes.ADD).setDepth(2));
        this.tweens.add({ targets: ring, scaleX: r, scaleY: r * 0.6, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
        this.burst(X, Y, 0x6a5040, 20, 60);
        if (this.near(e.x, e.y, 120)) this.cameras.main.shake(260, e.b === MON.KING ? 0.012 : 0.007);
        break;
      }
      case EV.WINDUP: {
        const v = this.monsters[e.a];
        if (v && !v.bang) {
          v.bang = this.u(this.add.text(0, 0, "!", { fontFamily: "Silkscreen", fontSize: "20px", color: "#ff3a3a", stroke: "#000", strokeThickness: 4 }).setOrigin(0.5).setDepth(21));
        }
        if (audible && e.b === me) sfx.windup(pan);
        break;
      }
      case EV.POTION:
        if (e.a === me) sfx.potion();
        this.burst(X, Y - 10, 0x50ff7a, 14, 30);
        break;
      case EV.SPAWN: {
        this.burst(X, Y - 6, e.b === MON.IMP ? 0x9a3aff : 0x6a3aaa, 16, 30);
        break;
      }
      case EV.ATTACK: {
        if (e.a === me) break;
        const v = this.players[e.a];
        if (v) {
          v.swingUntil = this.time.now + 160;
          v.swingDir *= -1;
        }
        if (e.c === CLASS_ARCANIST) audible && sfx.bolt(pan);
        else if (e.c === 10) audible && sfx.fireball(pan);
        else if (audible) (e.c === CLASS_ROGUE ? sfx.stab(pan) : sfx.swing(pan));
        if (e.c !== CLASS_ARCANIST && e.c !== 10) this.slashFx(X, Y, e.b, e.c);
        break;
      }
      case EV.BOSS_RAGE:
        sfx.alarm();
        hud.toast({ title: "THE KING UNMASKS", sub: "Lesser Hollows answer his howl", color: "#ff4060", big: true }, 2600);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // FX helpers
  // ---------------------------------------------------------------------------

  burst(x: number, y: number, tint: number, n = 10, speed = 35) {
    const em = this.w(
      this.add.particles(x, y, "px", {
        speed: { min: speed * 0.3, max: speed },
        angle: { min: 0, max: 360 },
        lifespan: { min: 250, max: 600 },
        scale: { start: 1, end: 0 },
        gravityY: 60,
        tint,
        emitting: false,
      }),
    );
    em.setDepth(9300);
    em.explode(n);
    this.time.delayedCall(800, () => em.destroy());
  }

  /** Spirit particles drifting upward: a Hollow being purified. */
  purify(x: number, y: number, n: number) {
    const em = this.w(
      this.add.particles(x, y, "px", {
        speedX: { min: -14, max: 14 },
        speedY: { min: -46, max: -12 },
        lifespan: { min: 500, max: 1100 },
        scale: { start: 1.2, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0x9fe0ff, 0x4aa8e8],
        blendMode: "ADD",
        emitting: false,
      }),
    );
    em.setDepth(9300);
    em.explode(n);
    const ring = this.w(this.add.image(x, y + 4, "ring").setTint(0x9fe0ff).setScale(0.1, 0.06).setBlendMode(Phaser.BlendModes.ADD).setDepth(9300));
    this.tweens.add({ targets: ring, scaleX: 0.7, scaleY: 0.4, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
    this.dyn.push({ x, y, r: 70, a: 0.9 });
    this.time.delayedCall(1300, () => em.destroy());
  }

  explosion(x: number, y: number) {
    const em = this.w(
      this.add.particles(x, y, "px", {
        speed: { min: 20, max: 90 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 300, max: 700 },
        scale: { start: 2, end: 0 },
        tint: [0xffffff, 0x9fe0ff, 0x3a8ae0, 0x0d2a5a],
        blendMode: "ADD",
        emitting: false,
      }),
    );
    em.setDepth(9300);
    em.explode(60);
    const glow = this.w(this.add.image(x, y, "glow").setTint(0x5ab8ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(9301).setScale(0.3));
    this.tweens.add({ targets: glow, scale: 1.4, alpha: 0, duration: 450, onComplete: () => glow.destroy() });
    const ring = this.w(this.add.image(x, y, "ring").setTint(0x9fe0ff).setScale(0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(9301));
    this.tweens.add({ targets: ring, scale: 0.85, alpha: 0, duration: 350, onComplete: () => ring.destroy() });
    this.dyn.push({ x, y, r: 90, a: 1 });
    this.time.delayedCall(900, () => em.destroy());
  }

  extractBeam(x: number, y: number) {
    const beam = this.w(this.add.image(x, y + 4, "beam").setOrigin(0.5, 1).setTint(0xcfeeff).setBlendMode(Phaser.BlendModes.ADD).setDepth(9302).setScale(2.5, 0.2));
    this.tweens.add({ targets: beam, scaleY: 4, duration: 260, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: beam, alpha: 0, delay: 500, duration: 700, onComplete: () => beam.destroy() });
    this.burst(x, y - 10, 0xd8b8ff, 40, 60);
  }

  trail(x0: number, y0: number, x1: number, y1: number, tint: number) {
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const g = this.w(this.add.image(lerp(x0, x1, t), lerp(y0, y1, t) - 10, "glow").setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(0.18).setAlpha(0.8).setDepth(9200));
      this.tweens.add({ targets: g, alpha: 0, scale: 0.05, duration: 300 + i * 40, onComplete: () => g.destroy() });
    }
  }

  slashFx(x: number, y: number, aim: number, cls: number) {
    const a = angleRad(aim);
    const r = cls === CLASS_VANGUARD ? 15 : 10;
    const s = this.w(this.add.image(x + Math.cos(a) * r, y - 8 + Math.sin(a) * r, "slash").setRotation(a).setBlendMode(Phaser.BlendModes.ADD).setDepth(9250));
    s.setScale(cls === CLASS_VANGUARD ? 1.5 : 1.0).setTint(cls === CLASS_ROGUE ? 0xffffff : 0xcfeaff);
    this.tweens.add({ targets: s, alpha: 0, scale: s.scale * 1.25, duration: 160, onComplete: () => s.destroy() });
  }

  dmgNumber(x: number, y: number, n: number, color: string, scale = 1) {
    const t = this.u(
      this.add
        .text(0, 0, String(n), { fontFamily: "Pixelify Sans", fontStyle: "700", fontSize: `${Math.round(15 * scale)}px`, color, stroke: "#120808", strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(22),
    );
    this.dmgTexts.push({ t, wx: x + (Math.random() * 6 - 3), wy: y, born: this.time.now, vy: -26 });
  }

  // ---------------------------------------------------------------------------
  // Input actions
  // ---------------------------------------------------------------------------

  myPlayer(): Player | null {
    const w = this.world;
    if (!w) return null;
    const p = w.players[this.me];
    return p && p.state === PS.ALIVE ? p : null;
  }

  doAttack() {
    const p = this.myPlayer();
    if (!p || this.time.now < this.nextAtk || hud.get().paused) return;
    this.nextAtk = this.time.now + CLASSES[p.cls].atkCd * 100;
    this.session.combat(0, this.aim);
    const v = this.players[this.me];
    if (v) {
      v.swingUntil = this.time.now + 160;
      v.swingDir *= -1;
    }
    if (p.cls === CLASS_ARCANIST) sfx.bolt();
    else if (p.cls === CLASS_ROGUE) sfx.stab();
    else sfx.swing();
    if (p.cls !== CLASS_ARCANIST && this.pred) this.slashFx(px(this.pred.x), px(this.pred.y), this.aim, p.cls);
  }

  doSpecial() {
    const p = this.myPlayer();
    const w = this.world;
    if (!p || !w || hud.get().paused) return;
    if (w.tick < p.specReady) return;
    this.session.combat(1, this.aim);
    if (p.cls === CLASS_ARCANIST) sfx.fireball();
  }

  doDodge() {
    const p = this.myPlayer();
    const w = this.world;
    if (!p || !w || hud.get().paused) return;
    if (w.tick < p.dodgeReady) return;
    const [mx, my] = this.moveVec();
    const aim = mx || my ? radToByte(Math.atan2(my, mx)) : this.aim;
    this.session.combat(2, aim);
    this.dodgeUntil = this.time.now + 300;
    sfx.dodge();
  }

  doPotion() {
    const p = this.myPlayer();
    if (!p || p.potions === 0 || p.hp >= p.maxHp) return;
    this.session.combat(3, this.aim);
  }

  moveVec(): [number, number] {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.A.isDown || k.LEFT.isDown) x -= 1;
    if (k.D.isDown || k.RIGHT.isDown) x += 1;
    if (k.W.isDown || k.UP.isDown) y -= 1;
    if (k.S.isDown || k.DOWN.isDown) y += 1;
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return [x, y];
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  update(time: number, delta: number) {
    const w = this.world;
    if (!w || !this.built) return;
    const dt = Math.min(delta, 100) / 1000;
    const paused = hud.get().paused;

    // Interpolation pair
    const delay = this.session.mode === "practice" ? 105 : 140;
    const rt = performance.now() - delay;
    let a = this.snaps[this.snaps.length - 1];
    let b = a;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].at <= rt) {
        a = this.snaps[i - 1];
        b = this.snaps[i];
        break;
      }
    }
    const span = b.at - a.at;
    const t = span > 0 ? Phaser.Math.Clamp((rt - a.at) / span, 0, 1) : 1;
    const A = a.world;
    const B = b.world;

    // --- Local player prediction ---
    const meP = w.players[this.me];
    if (this.pred && meP.state === PS.ALIVE && !paused) {
      const [mx, my] = this.moveVec();
      const dodging = time < this.dodgeUntil;
      const speed = CLASSES[meP.cls].speed * TICKS_PER_SEC * (dodging ? DODGE_SPEED_MULT : 1);
      let dx = mx * speed * dt;
      let dy = my * speed * dt;
      if (dodging && !mx && !my) {
        const ar = angleRad(this.aim);
        dx = Math.cos(ar) * speed * dt;
        dy = Math.sin(ar) * speed * dt;
      }
      if (dx || dy) {
        const [nx, ny] = this.session.slide(this.pred.x, this.pred.y, dx, dy);
        this.pred.x = nx;
        this.pred.y = ny;
      }
      // Reconcile with authoritative position.
      const err = Math.hypot(meP.x - this.pred.x, meP.y - this.pred.y);
      if (this.snapNext || err > TILE * 2.5) {
        if (this.snapNext && err < 2) {
          // wait for the blink to land in a snapshot
        } else {
          this.pred.x = meP.x;
          this.pred.y = meP.y;
          this.snapNext = false;
        }
      } else if (!mx && !my && !dodging && err > 24) {
        this.pred.x = lerp(this.pred.x, meP.x, 0.08);
        this.pred.y = lerp(this.pred.y, meP.y, 0.08);
      }
      // Aim from pointer
      const ptr = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      this.aim = radToByte(Math.atan2(wp.y - px(this.pred.y), wp.x - px(this.pred.x)));
      // Send at fixed rate
      if (time - this.lastSend > SEND_MS) {
        const moving = !!(mx || my || dodging);
        const changed = Math.abs(this.pred.x - this.lastSentX) > 2 || Math.abs(this.pred.y - this.lastSentY) > 2 || Math.abs(((this.aim - this.lastSentAim + 384) % 256) - 128) > 4 || moving !== this.lastSentMoving;
        if (changed) {
          this.session.move(this.pred.x, this.pred.y, this.aim, moving);
          this.lastSentX = this.pred.x;
          this.lastSentY = this.pred.y;
          this.lastSentAim = this.aim;
          this.lastSentMoving = moving;
          this.lastSend = time;
        }
      }
      if (this.atkHeld && this.input.activePointer.leftButtonDown()) this.doAttack();
    }

    // --- Entities ---
    this.renderPlayers(A, B, t, time);
    this.renderMonsters(A, B, t, time);
    this.renderProjectiles(A, B, t);
    this.renderDrops(w, time);
    this.renderPortals(w, time);
    this.renderTelegraphs(B, time);

    // --- Camera ---
    const cam = this.cameras.main;
    let fx: number, fy: number;
    if (meP.state === PS.ALIVE && this.pred) {
      fx = px(this.pred.x);
      fy = px(this.pred.y);
      const ptr = this.input.activePointer;
      const lx = (ptr.x - VIEW_W / 2) / ZOOM;
      const ly = (ptr.y - VIEW_H / 2) / ZOOM;
      fx += lx * 0.18;
      fy += ly * 0.18;
    } else {
      // Spectate: follow a living player, else stay.
      const alive = w.players.findIndex((p) => p.state === PS.ALIVE);
      const target = alive >= 0 ? w.players[alive] : meP;
      fx = px(target.x);
      fy = px(target.y);
    }
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    const k = 1 - Math.pow(0.0008, dt);
    cam.centerOn(lerp(cx, fx, k), lerp(cy, fy, k));

    // --- Lighting & fog ---
    this.renderLighting(w, time);
    if (time - this.lastFog > 120) {
      this.lastFog = time;
      const src = meP.state === PS.ALIVE && this.pred ? this.pred : meP;
      this.revealAround(px(src.x), px(src.y));
    }

    // --- Screen-space UI ---
    this.renderUi(B, time);

    // --- Corruption grading ---
    const corr = corruption(w) / 100;
    sfx.setTension(corr);
    if (this.colorFx) {
      this.colorFx.reset();
      this.colorFx.saturate(-0.15 - corr * 0.35, true);
      if (corr > 0.6) this.colorFx.hue((corr - 0.6) * -25, true);
    }
    const timeLeft = w.collapseTick - w.tick;
    const pulse = timeLeft < 300 && w.phase === PHASE.RUNNING ? (Math.sin(time / 180) * 0.5 + 0.5) * 0.18 : 0;
    const low = meP.state === PS.ALIVE && meP.hp < meP.maxHp * 0.3 ? (Math.sin(time / 140) * 0.5 + 0.5) * 0.12 : 0;
    this.overlay.setAlpha(corr * 0.07 + pulse + low);
    if (this.vignette) this.vignette.strength = 0.4 + corr * 0.25 + low;

    // Countdown beeps before the portals open and before the collapse.
    if (w.phase === PHASE.RUNNING && meP.state === PS.ALIVE) {
      const toPortal = Math.ceil((w.portalTick - w.tick) / TICKS_PER_SEC);
      const toCollapse = Math.ceil((w.collapseTick - w.tick) / TICKS_PER_SEC);
      const beat = toPortal > 0 && toPortal <= 5 ? toPortal : toCollapse > 0 && toCollapse <= 10 ? toCollapse : 0;
      if (beat && beat !== this.lastBeat) {
        this.lastBeat = beat;
        sfx.windup();
        hud.toast({ title: String(beat), sub: toPortal > 0 && toPortal <= 5 ? "portals opening" : "the crypt collapses", color: toPortal > 0 && toPortal <= 5 ? "#b98bff" : "#e8364f", big: true }, 800);
      }
    }

    // Portal hum by distance
    if (portalsOpen(w) && this.pred) {
      let best = 9999;
      for (const p of this.portalViews) best = Math.min(best, Math.hypot(p.x - px(this.pred.x), p.y - px(this.pred.y)));
      sfx.setHum(Phaser.Math.Clamp(1 - best / 140, 0, 1));
    }

    // HUD + minimap at ~10Hz
    if (time - this.lastHud > 100) {
      this.lastHud = time;
      this.pushHud(w);
    }
    if (time - this.lastMinimap > 200) {
      this.lastMinimap = time;
      this.drawMinimap(w);
    }

    // End of run
    const done = meP.state === PS.DEAD || meP.state === PS.EXTRACTED || w.phase === PHASE.ENDED;
    if (done && !this.endNotified) {
      if (!this.endTimer) this.endTimer = time + (meP.state === PS.EXTRACTED ? 2200 : 2800);
      if (time > this.endTimer || w.phase === PHASE.ENDED) {
        this.endNotified = true;
        this.hooks.onEnd(w, this.me);
      }
    }
  }

  renderPlayers(A: World, B: World, t: number, time: number) {
    for (let i = 0; i < 4; i++) {
      const p = B.players[i];
      const pa = A.players[i];
      let v = this.players[i];
      if (p.state === PS.EMPTY) {
        if (v) this.destroyPlayer(i);
        continue;
      }
      if (!v || v.cls !== p.cls) {
        if (v) this.destroyPlayer(i);
        v = this.makePlayer(i, p);
      }
      let x: number, y: number;
      if (i === this.me && this.pred && p.state === PS.ALIVE) {
        x = this.pred.x;
        y = this.pred.y;
      } else {
        x = pa.state === p.state ? lerp(pa.x, p.x, t) : p.x;
        y = pa.state === p.state ? lerp(pa.y, p.y, t) : p.y;
      }
      const X = px(x);
      const Y = px(y);
      const moved = Math.hypot(X - v.lastX, Y - v.lastY) > 0.05;
      v.lastX = X;
      v.lastY = Y;
      const hero = HERO[p.cls][i % 2];
      const alive = p.state === PS.ALIVE;
      if (alive) {
        const anim = moved ? `rh${p.cls}_run` : `rh${p.cls}_idle`;
        if (v.sprite.anims.currentAnim?.key !== anim) v.sprite.play(anim, true);
      }
      const aim = i === this.me ? this.aim : p.aim;
      const ar = angleRad(aim);
      const faceLeft = Math.cos(ar) < -0.1;
      v.sprite.setFlipX(faceLeft);
      v.sprite.setPosition(X, Y + 4);
      v.shadow.setPosition(X, Y + 4);
      v.ring.setPosition(X, Y + 3);
      v.sprite.setDepth(Y + 4);
      // Weapon orbiting the hand, swinging on attack.
      let wr = ar + Math.PI / 2;
      const swinging = time < v.swingUntil;
      if (p.cls === CLASS_ARCANIST) {
        v.weapon.setPosition(X + Math.cos(ar) * 6, Y - 6 + Math.sin(ar) * 4).setRotation(ar + Math.PI / 2 + (swinging ? -0.4 : 0));
      } else {
        const sw = swinging ? (1 - (v.swingUntil - time) / 160) * 2.2 - 1.1 : -0.55;
        wr = ar + Math.PI / 2 + sw * v.swingDir;
        v.weapon.setPosition(X + Math.cos(ar) * 5, Y - 6 + Math.sin(ar) * 3).setRotation(wr);
      }
      v.weapon.setDepth(Math.sin(ar) < 0 ? Y + 3 : Y + 5).setVisible(alive);
      // States
      const shield = alive && B.tick <= p.shieldUntil;
      const invuln = alive && B.tick <= p.invulnUntil;
      v.aura.setPosition(X, Y - 6).setVisible(shield);
      if (shield) v.aura.setAlpha(0.45 + Math.sin(time / 80) * 0.15);
      v.sprite.setAlpha(invuln ? 0.55 : 1);
      if (alive) {
        if (performance.now() < v.flashUntil) v.sprite.setTintFill(0xffffff);
        else v.sprite.clearTint();
      }
      if (v.state !== p.state) {
        v.state = p.state;
        if (p.state === PS.DEAD) {
          v.sprite.stop().setTexture(`rh${p.cls}_0`).setTint(0x605060);
          this.tweens.add({ targets: v.sprite, angle: faceLeft ? -90 : 90, y: Y + 8, duration: 350, ease: "Bounce.easeOut" });
          this.w(this.add.image(X, Y + 2, "dungeon", "skull").setDepth(Y));
          v.ring.setVisible(false);
          v.weapon.setVisible(false);
        }
        if (p.state === PS.EXTRACTED) {
          this.tweens.add({ targets: [v.sprite, v.shadow, v.ring], alpha: 0, y: "-=12", duration: 500 });
          v.weapon.setVisible(false);
        }
      }
      if (p.state === PS.DEAD) {
        v.sprite.setPosition(v.sprite.x, v.sprite.y);
      }
      // label
      const cam = this.cameras.main;
      const sx = (X - cam.worldView.x) * cam.zoom;
      const sy = (Y - cam.worldView.y) * cam.zoom;
      v.label.setPosition(sx, sy - 22 * cam.zoom / 1.4).setVisible(p.state === PS.ALIVE && this.isLit(X, Y));
    }
  }

  makePlayer(i: number, p: Player): PlayerView {
    const hero = HERO[p.cls][i % 2];
    const shadow = this.w(this.add.image(0, 0, "shadow").setDepth(2));
    const ring = this.w(this.add.ellipse(0, 0, 14, 5).setStrokeStyle(1, PLAYER_COLORS[i], 0.9).setDepth(2));
    const sprite = this.w(this.add.sprite(0, 0, `rh${p.cls}_0`).setOrigin(0.5, 1).play(`rh${p.cls}_idle`));
    const weapon = this.w((p.cls === CLASS_VANGUARD ? this.add.image(0, 0, "nodachi") : this.add.image(0, 0, "dungeon", WEAPON[p.cls])).setOrigin(0.5, 0.92).setScale(p.cls === CLASS_ROGUE ? 0.7 : p.cls === CLASS_ARCANIST ? 0.7 : 1).setTint(p.cls === CLASS_ARCANIST ? 0x9fe0ff : 0xffffff));
    const aura = this.w(this.add.image(0, 0, "ring").setTint(0x6ac8ff).setScale(0.38).setBlendMode(Phaser.BlendModes.ADD).setDepth(9200).setVisible(false));
    const label = this.u(
      this.add
        .text(0, 0, p.name || CLASSES[p.cls].name, { fontFamily: "Pixelify Sans", fontStyle: "600", fontSize: "13px", color: PLAYER_CSS[i], stroke: "#05030a", strokeThickness: 4 })
        .setOrigin(0.5, 1)
        .setDepth(15),
    );
    const v: PlayerView = { sprite, weapon, shadow, ring, aura, label, cls: p.cls, state: p.state, flashUntil: 0, swingUntil: 0, swingDir: 1, lastX: 0, lastY: 0 };
    this.players[i] = v;
    return v;
  }

  destroyPlayer(i: number) {
    const v = this.players[i];
    if (!v) return;
    [v.sprite, v.weapon, v.shadow, v.ring, v.aura, v.label].forEach((o) => o.destroy());
    this.players[i] = null;
  }

  renderMonsters(A: World, B: World, t: number, time: number) {
    // Hit-stop: monsters freeze for a beat when your melee lands.
    if (performance.now() < this.hitStop) return;
    for (let i = 0; i < B.monsters.length; i++) {
      const m = B.monsters[i];
      const ma = A.monsters[i];
      let v = this.monsters[i];
      if (m.kind === MON.NONE) {
        if (v) this.destroyMonster(i);
        continue;
      }
      if (!v || v.kind !== m.kind) {
        if (v) this.destroyMonster(i);
        v = this.makeMonster(i, m);
      }
      const same = ma.kind === m.kind;
      const X = px(same ? lerp(ma.x, m.x, t) : m.x);
      const Y = px(same ? lerp(ma.y, m.y, t) : m.y);
      const dead = m.hp === 0;
      if (dead && !v.dead) {
        v.dead = true;
        v.sprite.stop();
        v.sprite.setTint(0xffffff);
        v.bang?.destroy();
        v.bang = undefined;
        this.tweens.add({ targets: v.sprite, alpha: 0, scaleY: 0.2, scaleX: v.sprite.scaleX * 1.3, duration: 450, ease: "Cubic.easeIn" });
        this.tweens.add({ targets: [v.shadow, v.glow].filter(Boolean), alpha: 0, duration: 450 });
        continue;
      }
      if (dead) continue;
      const moving = Math.abs(ma.x - m.x) + Math.abs(ma.y - m.y) > 2;
      const base = monsterAnimBase(m.kind);
      const anim = moving ? `hol${m.kind}_run` : `hol${m.kind}_idle`;
      if (v.sprite.anims.currentAnim?.key !== anim) v.sprite.play(anim, true);
      const ar = angleRad(m.aim);
      v.sprite.setFlipX(Math.cos(ar) < 0);
      const windup = m.state === MS.WINDUP;
      const shake = windup ? Math.sin(time / 18) * 0.7 : 0;
      v.sprite.setPosition(X + shake, Y + 5).setDepth(Y + 5);
      v.shadow.setPosition(X, Y + 5);
      v.glow?.setPosition(X, Y - 6);
      if (performance.now() < v.flashUntil) v.sprite.setTintFill(0xffffff);
      else if (windup) v.sprite.setTint(0xff8080);
      else if (B.tick < m.stunUntil) v.sprite.setTint(0x9ab0ff);
      else if (m.elite) v.sprite.setTint(0xffb0b0);
      else v.sprite.clearTint();
      if (!windup && v.bang) {
        v.bang.destroy();
        v.bang = undefined;
      }
      const lit = this.isLit(X, Y);
      v.sprite.setVisible(lit || this.explored[Math.floor(Y / PX) * MAP_W + Math.floor(X / PX)] === 1);
    }
  }

  makeMonster(i: number, m: Monster): MonsterView {
    const base = monsterAnimBase(m.kind);
    const big = m.kind === MON.BRUTE || m.kind === MON.KING;
    const sprite = this.w(this.add.sprite(0, 0, `hol${m.kind}_0`).setOrigin(0.5, 1));
    sprite.play(`hol${m.kind}_idle`);
    if (m.elite && !big) sprite.setScale(1.25);
    if (m.kind === MON.KING) sprite.setScale(1.35);
    const shadow = this.w(this.add.image(0, 0, "shadow").setScale(big ? 2.2 : 1).setDepth(2));
    let glow: Phaser.GameObjects.Image | undefined;
    if (m.elite || m.kind === MON.KING || m.kind === MON.IMP) {
      glow = this.w(this.add.image(0, 0, "glow").setTint(m.kind === MON.IMP ? 0x9a3aff : 0xff3030).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setScale(big ? 0.7 : 0.35).setDepth(9104));
    }
    const v: MonsterView = { sprite, shadow, glow, kind: m.kind, dead: m.hp === 0, flashUntil: 0 };
    this.monsters[i] = v;
    return v;
  }

  destroyMonster(i: number) {
    const v = this.monsters[i];
    if (!v) return;
    v.sprite.destroy();
    v.shadow.destroy();
    v.glow?.destroy();
    v.bang?.destroy();
    this.monsters[i] = null;
  }

  renderProjectiles(A: World, B: World, t: number) {
    for (let i = 0; i < B.projectiles.length; i++) {
      const p = B.projectiles[i];
      const pa = A.projectiles[i];
      let v = this.projs[i];
      if (p.kind === PROJ.NONE) {
        if (v) {
          v.trail.stop();
          const old = v;
          this.time.delayedCall(400, () => old.trail.destroy());
          v.sprite.destroy();
          v.glow.destroy();
          this.projs[i] = null;
        }
        continue;
      }
      if (!v || v.kind !== p.kind) {
        if (v) {
          v.trail.destroy();
          v.sprite.destroy();
          v.glow.destroy();
        }
        v = this.makeProj(p.kind);
        this.projs[i] = v;
      }
      const same = pa.kind === p.kind;
      // Projectiles move in straight lines; extrapolate a little for smoothness.
      const X = px(same ? lerp(pa.x, p.x, t) : p.x);
      const Y = px(same ? lerp(pa.y, p.y, t) : p.y);
      v.sprite.setPosition(X, Y - 8).setDepth(Y + 6);
      v.glow.setPosition(X, Y - 8);
      v.trail.setPosition(X, Y - 8);
      if (p.kind === PROJ.BONE) v.sprite.rotation += 0.4;
      this.dyn.push({ x: X, y: Y - 8, r: p.kind === PROJ.FIREBALL ? 55 : 28, a: 0.8 });
    }
  }

  makeProj(kind: number): ProjView {
    const col = kind === PROJ.BOLT ? 0xe0f4ff : kind === PROJ.FIREBALL ? 0x4ab0ff : kind === PROJ.ORB ? 0xe0283c : 0xe0d8c0;
    const sprite = this.w(kind === PROJ.BONE ? this.add.image(0, 0, "icon_bone") : this.add.image(0, 0, "orb").setTint(col).setScale(kind === PROJ.FIREBALL ? 0.9 : 0.55));
    const glow = this.w(this.add.image(0, 0, "glow").setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(kind === PROJ.FIREBALL ? 0.45 : 0.22).setAlpha(0.8).setDepth(9105));
    const trail = this.w(
      this.add.particles(0, 0, "px", {
        lifespan: kind === PROJ.FIREBALL ? 380 : 220,
        speed: { min: 2, max: 10 },
        scale: { start: kind === PROJ.FIREBALL ? 1.6 : 1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: kind === PROJ.FIREBALL ? [0xffffff, 0x9fe0ff, 0x2a7ae0] : col,
        frequency: kind === PROJ.FIREBALL ? 12 : 24,
        blendMode: "ADD",
      }),
    );
    trail.setDepth(9106);
    return { sprite, glow, trail, kind };
  }

  renderDrops(w: World, time: number) {
    for (let i = 0; i < w.drops.length; i++) {
      const d = w.drops[i];
      let v = this.drops[i];
      const key = d.item.kind ? `${d.item.kind}:${d.item.rarity}:${d.spawnTick}:${d.x}:${d.y}` : "";
      if (v && v.key !== key) {
        // Picked up (or replaced): fly towards nearest player then vanish.
        const old = v;
        let tx = old.x;
        let ty = old.y - 10;
        let best = 1e9;
        for (const p of w.players) {
          if (p.state !== PS.ALIVE) continue;
          const dd = Math.hypot(px(p.x) - old.x, px(p.y) - old.y);
          if (dd < best && dd < 40) {
            best = dd;
            tx = px(p.x);
            ty = px(p.y) - 10;
          }
        }
        this.tweens.add({ targets: [old.icon, old.glow], x: tx, y: ty, alpha: 0, scale: 0.3, duration: 180, onComplete: () => (old.icon.destroy(), old.glow.destroy()) });
        old.beam?.destroy();
        old.spark?.destroy();
        this.drops[i] = null;
        v = null;
      }
      if (!d.item.kind) continue;
      if (!v) v = this.makeDrop(i, d, key, time);
      const bob = Math.sin((time - v.bornAt) / 260 + i) * 1.5;
      if (time - v.bornAt > 420) {
        v.icon.y = v.y - 6 + bob;
      }
      v.glow.setPosition(v.icon.x, v.y - 4).setAlpha(0.35 + Math.sin(time / 300 + i) * 0.1);
      v.icon.setDepth(v.y);
    }
  }

  makeDrop(i: number, d: Drop, key: string, time: number): DropView {
    const X = px(d.x);
    const Y = px(d.y);
    const it = d.item;
    let icon: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    switch (it.kind) {
      case ITEM.COINS:
        icon = this.add.image(X, Y, "icon_coins");
        break;
      case ITEM.GEM:
        icon = this.add.image(X, Y, "icon_gem");
        break;
      case ITEM.CHALICE:
        icon = this.add.image(X, Y, "icon_chalice");
        break;
      case ITEM.IDOL:
        icon = this.add.image(X, Y, "icon_idol");
        break;
      case ITEM.CROWN:
        icon = this.add.image(X, Y, "icon_crown");
        break;
      case ITEM.HEART:
        icon = this.add.image(X, Y, "icon_heart");
        break;
      case ITEM.AEGIS:
        icon = this.add.image(X, Y, "icon_aegis");
        break;
      case ITEM.KEY:
        icon = this.add.image(X, Y, "icon_key");
        break;
      case ITEM.POTION:
        icon = this.add.image(X, Y, "dungeon", "flask_red");
        break;
      case ITEM.BLADE:
        icon = this.add.image(X, Y, "dungeon", ["weapon_rusty_sword", "weapon_regular_sword", "weapon_knight_sword", "weapon_red_gem_sword", "weapon_golden_sword"][it.rarity]).setAngle(45).setScale(0.8);
        break;
      default:
        icon = this.add.image(X, Y, "orb");
    }
    this.w(icon);
    const col = it.kind === ITEM.POTION ? 0xff4060 : it.kind === ITEM.KEY ? 0xffd65a : RARITY_COLORS[it.rarity];
    const glow = this.w(this.add.image(X, Y, "glow").setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(it.rarity >= 3 ? 0.4 : 0.25).setDepth(9107));
    let beam: Phaser.GameObjects.Image | undefined;
    if (it.rarity >= 2 && it.kind !== ITEM.POTION && it.kind !== ITEM.KEY) {
      beam = this.w(this.add.image(X, Y + 2, "beam").setOrigin(0.5, 1).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(it.rarity >= 4 ? 1.6 : 1, it.rarity >= 4 ? 1.6 : it.rarity >= 3 ? 1.1 : 0.7).setAlpha(0.6).setDepth(9108));
      this.tweens.add({ targets: beam, alpha: { from: 0.35, to: 0.7 }, yoyo: true, repeat: -1, duration: 900 });
    }
    // Spill arc
    icon.y = Y - 22;
    icon.setScale(icon.scale * 0.4);
    const sc = it.kind === ITEM.BLADE ? 0.8 : 1;
    this.tweens.add({ targets: icon, y: Y - 6, scale: sc, duration: 420, ease: "Bounce.easeOut" });
    let spark: Phaser.GameObjects.Particles.ParticleEmitter | undefined;
    if (it.rarity >= 4) {
      const sp = this.w(this.add.particles(X, Y - 6, "px1", { lifespan: 900, speedY: { min: -20, max: -6 }, speedX: { min: -6, max: 6 }, tint: [0xffe080, 0xffffff], blendMode: "ADD", frequency: 90, alpha: { start: 1, end: 0 } }).setDepth(9109));
      spark = sp;
    }
    const v: DropView = { icon, beam, glow, spark, key, bornAt: time, x: X, y: Y };
    this.drops[i] = v;
    return v;
  }

  renderPortals(w: World, time: number) {
    const open = portalsOpen(w);
    for (const p of this.portalViews) {
      p.swirl.rotation = time / (open ? 280 : 900);
      p.swirl2.rotation = -time / 200;
      p.swirl.setAlpha(open ? 0.85 : 0.12);
      p.swirl2.setAlpha(open ? 0.5 + Math.sin(time / 150) * 0.2 : 0);
      p.glow.setAlpha(open ? 0.55 + Math.sin(time / 300) * 0.12 : 0.1).setScale(open ? 0.9 : 0.4);
      p.base.setTint(open ? 0xcfeeff : 0x3a4054).setAlpha(open ? 0.9 : 0.5);
    }
  }

  renderTelegraphs(B: World, time: number) {
    const g = this.tele;
    g.clear();
    for (const m of B.monsters) {
      if (!m.kind || m.hp === 0 || m.state !== MS.WINDUP) continue;
      const left = Math.max(0, m.timer - B.tick);
      const total = m.kind === MON.NECRO ? 7 : m.kind === MON.BRUTE ? 8 : m.kind === MON.KING ? 9 : 5;
      const prog = 1 - left / total;
      const X = px(m.x);
      const Y = px(m.y);
      if (m.kind === MON.BRUTE || m.kind === MON.KING) {
        const r = px(MON_RANGE[m.kind] + 80);
        g.fillStyle(0xff2020, 0.12 + prog * 0.18).fillEllipse(X, Y, r * 2, r * 1.3);
        g.lineStyle(1, 0xff4040, 0.8).strokeEllipse(X, Y, r * 2 * prog, r * 1.3 * prog);
      } else if (m.kind === MON.NECRO) {
        const ar = angleRad(m.aim);
        g.lineStyle(1, 0xc060ff, 0.35 + prog * 0.4);
        g.lineBetween(X, Y - 6, X + Math.cos(ar) * 80, Y - 6 + Math.sin(ar) * 80);
      } else {
        const ar = angleRad(m.aim);
        const r = px(MON_RANGE[m.kind] + 110);
        g.fillStyle(0xff2020, 0.15 + prog * 0.25);
        g.slice(X, Y, r, ar - 0.9, ar + 0.9, false).fillPath();
      }
    }
    // Extraction ring for players channelling.
    for (let i = 0; i < 4; i++) {
      const p = B.players[i];
      if (p.state !== PS.ALIVE || !p.extract) continue;
      const X = i === this.me && this.pred ? px(this.pred.x) : px(p.x);
      const Y = i === this.me && this.pred ? px(this.pred.y) : px(p.y);
      g.lineStyle(2, 0x9fe0ff, 0.9);
      g.beginPath();
      g.arc(X, Y - 8, 14, -Math.PI / 2, -Math.PI / 2 + (p.extract / EXTRACT_TICKS) * Math.PI * 2, false);
      g.strokePath();
    }
  }

  isLit(X: number, Y: number) {
    const me = this.world?.players[this.me];
    if (!me) return true;
    const src = this.pred && me.state === PS.ALIVE ? this.pred : me;
    return Math.hypot(px(src.x) - X, px(src.y) - Y) < 120;
  }

  renderLighting(w: World, time: number) {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const corr = corruption(w) / 100;
    const rt = this.darkRT;
    rt.clear();
    rt.fill(0x03050c, Math.min(0.95, 0.88 + corr * 0.06));
    const lights: Light[] = [...this.staticLights];
    // Players carry light; it shrinks as corruption rises.
    for (let i = 0; i < 4; i++) {
      const p = w.players[i];
      if (p.state !== PS.ALIVE) continue;
      const pos = i === this.me && this.pred ? this.pred : p;
      const base = i === this.me ? 96 : 60;
      lights.push({ x: px(pos.x), y: px(pos.y) - 6, r: base * (1 - corr * 0.3) + Math.sin(time / 120 + i) * 2, a: 1 });
    }
    for (const t of this.torches) {
      const f = 0.85 + Math.sin(time / 90 + t.seed * 20) * 0.08 + Math.sin(time / 37 + t.seed * 7) * 0.05;
      lights.push({ x: t.x, y: t.y + 10, r: 62 * f, a: 0.85 });
      t.glow.setAlpha(0.42 * f).setScale(0.5 * f);
    }
    const open = portalsOpen(w);
    for (const p of this.portalViews) lights.push({ x: p.x, y: p.y - 6, r: open ? 80 : 30, a: open ? 0.9 : 0.4 });
    for (const d of this.drops) if (d) lights.push({ x: d.x, y: d.y - 6, r: 22, a: 0.6 });
    for (const c of w.chests) if ((c.tx || c.ty) && c.tier !== CHEST.NORMAL && c.state !== CHEST_STATE.OPEN) lights.push({ x: c.tx * PX + 8, y: c.ty * PX + 8, r: 26, a: 0.5 });
    lights.push(...this.dyn);
    this.dyn = this.dyn.filter((l) => (l.a -= 0.06) > 0.05 && l.r > 60);
    const img = this.lightImg;
    for (const l of lights) {
      if (l.x + l.r < view.x || l.x - l.r > view.right || l.y + l.r < view.y || l.y - l.r > view.bottom) continue;
      img.setPosition(l.x, l.y).setScale((l.r * 2) / 256).setAlpha(l.a);
      rt.erase(img);
    }
  }

  revealAround(x: number, y: number, force = false) {
    const r = 6;
    const tx = Math.floor(x / PX);
    const ty = Math.floor(y / PX);
    let changed = force;
    for (let yy = ty - r; yy <= ty + r; yy++) {
      for (let xx = tx - r; xx <= tx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) continue;
        if ((xx - tx) ** 2 + (yy - ty) ** 2 > r * r) continue;
        const i = yy * MAP_W + xx;
        if (!this.explored[i]) {
          this.explored[i] = 1;
          changed = true;
        }
      }
    }
    if (changed) {
      this.lightImg.setPosition(x, y).setScale((r * PX * 2.6) / 256).setAlpha(1);
      this.fogRT.erase(this.lightImg);
      this.lightImg.setScale((r * PX * 1.8) / 256);
      this.fogRT.erase(this.lightImg);
    }
  }

  renderUi(B: World, time: number) {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const toS = (x: number, y: number): [number, number] => [(x - view.x) * cam.zoom, (y - view.y) * cam.zoom];
    const g = this.uiG;
    g.clear();
    // Monster HP bars
    B.monsters.forEach((m, i) => {
      if (!m.kind || m.hp === 0 || m.hp === m.maxHp || m.kind === MON.KING) return;
      const v = this.monsters[i];
      if (!v || !v.sprite.visible) return;
      const [sx, sy] = toS(v.sprite.x, v.sprite.y - v.sprite.displayHeight - 2);
      const w = m.kind === MON.BRUTE ? 54 : 34;
      g.fillStyle(0x000000, 0.75).fillRect(sx - w / 2 - 1, sy - 1, w + 2, 6);
      g.fillStyle(m.elite ? 0xff7a2a : 0xd63a3a, 1).fillRect(sx - w / 2, sy, (w * m.hp) / m.maxHp, 4);
      if (v.bang) v.bang.setPosition(sx, sy - 12);
    });
    // Player HP bars for others
    B.players.forEach((p, i) => {
      if (i === this.me || p.state !== PS.ALIVE) return;
      const v = this.players[i];
      if (!v || !v.label.visible) return;
      const [sx, sy] = toS(v.sprite.x, v.sprite.y - 30);
      g.fillStyle(0x000000, 0.75).fillRect(sx - 20, sy + 2, 40, 5);
      g.fillStyle(PLAYER_COLORS[i], 1).fillRect(sx - 19, sy + 3, (38 * p.hp) / p.maxHp, 3);
    });
    // Chest VRF badges
    this.chests.forEach((v, i) => {
      if (!v?.rolling) return;
      const [sx, sy] = toS(v.sprite.x, v.sprite.y - 18);
      v.rolling.setPosition(sx, sy + Math.sin(time / 120) * 2).setText(`VRF ${".".repeat(1 + (Math.floor(time / 250) % 3))}`);
      v.sprite.setAngle(Math.sin(time / 40) * 4);
    });
    // Floating damage numbers
    this.dmgTexts = this.dmgTexts.filter((d) => {
      const age = (time - d.born) / 1000;
      if (age > 0.8) {
        d.t.destroy();
        return false;
      }
      const [sx, sy] = toS(d.wx, d.wy - age * 18);
      d.t.setPosition(sx, sy).setAlpha(1 - Math.max(0, age - 0.5) / 0.3);
      d.t.setScale(age < 0.1 ? 1 + (0.1 - age) * 5 : 1);
      return true;
    });
    // Offscreen indicators for open portals
    if (portalsOpen(B)) {
      for (const p of this.portalViews) {
        const [sx, sy] = toS(p.x, p.y);
        if (sx > 20 && sx < VIEW_W - 20 && sy > 20 && sy < VIEW_H - 20) continue;
        const a = Math.atan2(sy - VIEW_H / 2, sx - VIEW_W / 2);
        const ex = VIEW_W / 2 + Math.cos(a) * (VIEW_W / 2 - 34);
        const ey = VIEW_H / 2 + Math.sin(a) * (VIEW_H / 2 - 34);
        g.fillStyle(0xb98bff, 0.85);
        g.fillTriangle(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12, ex + Math.cos(a + 2.4) * 9, ey + Math.sin(a + 2.4) * 9, ex + Math.cos(a - 2.4) * 9, ey + Math.sin(a - 2.4) * 9);
      }
    }
  }

  pushHud(w: World) {
    const me = w.players[this.me];
    let prompt: string | null = null;
    const pos = this.pred && me.state === PS.ALIVE ? this.pred : me;
    if (me.state === PS.ALIVE) {
      const bossAlive = w.bossIdx < w.monsters.length && w.monsters[w.bossIdx].hp > 0;
      let best = 1e9;
      for (const c of w.chests) {
        if (!c.tx && !c.ty) continue;
        const d = Math.hypot(c.tx * TILE + 128 - pos.x, c.ty * TILE + 128 - pos.y);
        if (d > INTERACT_RADIUS || d > best) continue;
        best = d;
        if (c.state === CHEST_STATE.OPEN) prompt = null;
        else if (c.state === CHEST_STATE.PENDING) prompt = "Rolling MagicBlock VRF…";
        else if (c.tier === CHEST.BOSS && bossAlive) prompt = "Sealed — purify The Hollow King";
        else prompt = `[E] Open ${c.tier === CHEST.VAULT ? "vault chest" : c.tier === CHEST.GOLD ? "gilded chest" : c.tier === CHEST.BOSS ? "the King's hoard" : "chest"}`;
      }
      const d = w.door;
      if (!prompt && (d.tx || d.ty) && !d.open) {
        const dx = d.vertical ? d.tx * TILE + 128 : d.tx * TILE + 256;
        const dy = d.vertical ? d.ty * TILE + 256 : d.ty * TILE + 128;
        if (Math.hypot(dx - pos.x, dy - pos.y) < INTERACT_RADIUS + 128) prompt = me.keys > 0 ? "[E] Unlock the Vault" : "The Vault is sealed — find a key";
      }
      if (!prompt) {
        for (const p of w.portals) {
          if (!p.tx && !p.ty) continue;
          if (Math.hypot(p.tx * TILE + 128 - pos.x, p.ty * TILE + 128 - pos.y) < PORTAL_RADIUS + 128) {
            prompt = portalsOpen(w) ? "Hold still in the spirit gate to cross over" : `Spirit gate sealed — opens in ${fmtTime(w.portalTick - w.tick)}`;
          }
        }
      }
    }
    if (me.state === PS.ALIVE) this.lastLoot = lootValue(me);
    hud.set({ world: w, me: this.me, nearPrompt: prompt, extractPct: me.extract / EXTRACT_TICKS, contracts: this.contracts ? this.contracts.results(w, this.me) : [] });
  }

  drawMinimap(w: World) {
    const c = this.mmCanvas;
    const ctx = c.getContext("2d")!;
    const S = 3;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!this.explored[y * MAP_W + x]) continue;
        if (isWall(w, x, y)) {
          const edge = !isWall(w, x, y + 1) || !isWall(w, x, y - 1) || !isWall(w, x + 1, y) || !isWall(w, x - 1, y);
          if (edge) {
            ctx.fillStyle = "#6b5d7a";
            ctx.fillRect(x * S, y * S, S, S);
          }
        } else {
          ctx.fillStyle = "#2a2333";
          ctx.fillRect(x * S, y * S, S, S);
        }
      }
    }
    const seen = (tx: number, ty: number) => this.explored[ty * MAP_W + tx] === 1;
    for (const ch of w.chests) {
      if ((!ch.tx && !ch.ty) || !seen(ch.tx, ch.ty) || ch.state === CHEST_STATE.OPEN) continue;
      ctx.fillStyle = ch.tier === CHEST.NORMAL ? "#c9963a" : ch.tier === CHEST.VAULT ? "#c08bff" : "#ffcf5a";
      ctx.fillRect(ch.tx * S, ch.ty * S, S, S);
    }
    const open = portalsOpen(w);
    for (const p of w.portals) {
      if (!p.tx && !p.ty) continue;
      if (!open && !seen(p.tx, p.ty)) continue;
      ctx.fillStyle = open ? "#c48bff" : "#5a4a6a";
      ctx.beginPath();
      ctx.arc(p.tx * S + 1.5, p.ty * S + 1.5, open ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (w.bossIdx < w.monsters.length) {
      const b = w.monsters[w.bossIdx];
      const bx = Math.floor(b.x / TILE);
      const by = Math.floor(b.y / TILE);
      if (b.hp > 0 && seen(bx, by)) {
        ctx.fillStyle = "#ff3046";
        ctx.fillRect(bx * S - 2, by * S - 2, 5, 5);
      }
    }
    w.players.forEach((p, i) => {
      if (p.state !== PS.ALIVE) return;
      const pos = i === this.me && this.pred ? this.pred : p;
      const x = (pos.x / TILE) * S;
      const y = (pos.y / TILE) * S;
      ctx.fillStyle = i === this.me ? "#ffffff" : PLAYER_CSS[i];
      ctx.fillRect(x - 2, y - 2, 4, 4);
      if (i === this.me) {
        ctx.strokeStyle = PLAYER_CSS[i];
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    });
  }
}

function monsterAnimBase(kind: number) {
  switch (kind) {
    case MON.SKELETON:
      return "skelet";
    case MON.BRUTE:
      return "bigz";
    case MON.KING:
      return "demon";
    case MON.IMP:
      return "imp";
    default:
      return "skelet";
  }
}
function monsterFrameBase(kind: number) {
  switch (kind) {
    case MON.BRUTE:
      return "big_zombie";
    case MON.KING:
      return "big_demon";
    case MON.IMP:
      return "imp";
    default:
      return "skelet";
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function createGame(parent: HTMLElement, session: GameSession, hooks: SceneHooks) {
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#050307",
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60 },
    input: { mouse: { preventDefaultWheel: false } },
    scene: [],
    banner: false,
  });
  game.scene.add("game", GameScene, true, { session, hooks });
  if (import.meta.env.DEV) (window as any).__ez = game;
  return game;
}

export { NOBODY, SRC_MONSTER, MON_NAMES, lootValue };
