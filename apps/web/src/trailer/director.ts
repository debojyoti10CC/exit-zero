// 3D trailer renderer. Open /?trailer and drive window.__trailer.frame(i) for i in
// 0..FRAMES-1 (scripts/render-trailer.mjs does this headless). Every frame is real
// gameplay: the practice simulation (the same Rust core the chain runs) rendered by
// the 3D renderer, stepped on a virtual clock, filmed with scripted camera moves.

import { createGame, Game3D } from "../game/Game3D";
import { PracticeSession, loadWasm } from "../game/session";
import { sfx } from "../game/audio";
import { installPixelKit } from "../ui/pixelKit";
import { makeTown, TOWN_W, TOWN_H } from "../ui/SpiritTownScene";
import { TILE, World, CHEST, CHEST_STATE, ROOM, MON, ITEM } from "../game/world";
import { renderSoundtrack } from "./soundtrack";

export const FPS = 30;
export const DURATION = 20;
export const FRAMES = FPS * DURATION;
// Logical 960x540 layout, composited at 2x (true 1080p output).
const CW = 960;
const CH = 540;
const SCALE = 2;
const BAR = 46;
const U = 1 / TILE;
const PITCH = (56 * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Virtual clock: the renderer, its effects and interpolation all read this.
// ---------------------------------------------------------------------------
let vt = 1e9;
const realNow = performance.now.bind(performance);
(performance as any).now = () => vt;

interface Caption {
  text: string;
  sub?: string;
  from: number;
  to: number;
  color?: string;
  size?: number;
}

/** Camera rig for a shot at local time lt: distance, tilt offset and target offset (tiles). */
interface Rig {
  dist: number;
  tilt?: number;
  ox?: number;
  oz?: number;
}

interface Shot {
  start: number;
  end: number;
  kind: "town" | "game" | "title";
  caption?: Caption;
  cls?: number;
  bots?: number;
  setup?: (s: Stage) => void;
  direct?: (s: Stage, lt: number) => void;
  rig?: (lt: number, len: number) => Rig;
}

interface Stage {
  session: PracticeSession;
  sim: any;
  g: Game3D;
  w: () => World;
  vars: Record<string, any>;
}

const ease = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));

// ---------------------------------------------------------------------------
// Staging helpers
// ---------------------------------------------------------------------------
function roomFor(w: World, pick: (r: World["rooms"][number]) => boolean) {
  for (let i = 0; i < w.roomCount; i++) if (pick(w.rooms[i])) return w.rooms[i];
  return w.rooms[1];
}
const center = (r: World["rooms"][number]) => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

/** Points the hero's aim at a world position (units) through the renderer's own mouse ray. */
function aimAt(s: Stage, wx: number, wy: number) {
  const [sx, sy] = s.g.toScreen(wx * U, 0.5, wy * U);
  s.g.mouse.x = sx;
  s.g.mouse.y = sy;
}

function nearestMonster(s: Stage) {
  const w = s.w();
  const me = w.players[0];
  let best: any = null;
  let bd = 1e12;
  w.monsters.forEach((m, i) => {
    if (!m.kind || m.hp <= 0) return;
    const d = (m.x - me.x) ** 2 + (m.y - me.y) ** 2;
    if (d < bd) {
      bd = d;
      best = { m, i, d: Math.sqrt(d) };
    }
  });
  return best;
}

function walk(s: Stage, tx: number, ty: number, stop = 120) {
  const g = s.g;
  const p = g.pred!;
  for (const k of ["KeyW", "KeyA", "KeyS", "KeyD"]) g.keys.delete(k);
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (Math.hypot(dx, dy) < stop) return;
  if (dx > 30) g.keys.add("KeyD");
  if (dx < -30) g.keys.add("KeyA");
  if (dy > 30) g.keys.add("KeyS");
  if (dy < -30) g.keys.add("KeyW");
}

function attack(s: Stage) {
  s.g.nextAtk = 0;
  s.g.doAttack();
}

// ---------------------------------------------------------------------------
// The edit (20 s)
// ---------------------------------------------------------------------------
const SHOTS: Shot[] = [
  { start: 0, end: 1.6, kind: "town", caption: { text: "THE DEAD HUNGER", from: 0.3, to: 1.55 } },
  {
    // Reaper carves through a skeleton pack: slow push-in from high to low.
    start: 1.6,
    end: 4.4,
    kind: "game",
    cls: 0,
    caption: { text: "CUT THEM DOWN", sub: "3 classes · real-time combat · every hit runs on-chain", from: 1.85, to: 4.3 },
    rig: (lt, len) => ({ dist: 14.5 - ease(lt / len) * 3, tilt: -0.05 * ease(lt / len), ox: 0.8 }),
    setup: (s) => {
      const w = s.w();
      const r = roomFor(w, (r) => r.kind === ROOM.NORMAL && r.w >= 8 && r.h >= 6);
      const c = center(r);
      s.sim.t_clear_monsters(0, 0, -1);
      s.sim.t_place(0, c.x - TILE * 2, c.y);
      s.sim.t_hp(0, 999, 999);
      for (const [dx, dy] of [[1.6, -1.2], [2.4, 0.6], [1.2, 1.6], [3.4, -0.4], [2.8, 1.8]]) s.sim.t_spawn(MON.SKELETON, c.x + dx * TILE, c.y + dy * TILE, true, 0);
      s.sim.t_spawn(MON.NECRO, c.x + TILE * 4.5, c.y - TILE * 1.5, true, 0);
      s.vars.c = c;
    },
    direct: (s, lt) => {
      const n = nearestMonster(s);
      if (n) {
        aimAt(s, n.m.x, n.m.y);
        walk(s, n.m.x, n.m.y, 330);
        attack(s);
        if (lt > 1.2 && !s.vars.spec) {
          s.vars.spec = true;
          s.g.doSpecial();
        }
      } else walk(s, s.vars.c.x + TILE * 3, s.vars.c.y);
    },
  },
  {
    // Spellbinder's blue-flame orb detonates in a pack: wide, then a crash zoom.
    start: 4.4,
    end: 6.4,
    kind: "game",
    cls: 1,
    caption: { text: "BURN THE HORDE", sub: "spells, blinks and bloom-lit 3D crypts", from: 4.6, to: 6.3, color: "#9fe0ff" },
    rig: (lt) => ({ dist: lt < 0.55 ? 15 : 15 - ease((lt - 0.55) / 0.35) * 4, ox: 1.2 }),
    setup: (s) => {
      const w = s.w();
      const r = roomFor(w, (r) => r.kind !== ROOM.ENTRANCE && r.kind !== ROOM.BOSS && r.w >= 8);
      const c = center(r);
      s.sim.t_clear_monsters(0, 0, -1);
      s.sim.t_place(0, c.x - TILE * 3, c.y);
      s.sim.t_hp(0, 999, 999);
      for (const [dx, dy] of [[1.0, 0], [1.6, -0.8], [1.6, 0.8], [2.2, 0], [2.6, -0.6]]) s.sim.t_spawn(MON.SKELETON, c.x + dx * TILE, c.y + dy * TILE, false, 255);
      s.vars.c = c;
    },
    direct: (s, lt) => {
      const c = s.vars.c;
      aimAt(s, c.x + TILE * 1.6, c.y);
      if (lt > 0.15 && !s.vars.fb) {
        s.vars.fb = true;
        s.g.doSpecial();
      }
      if (lt > 0.95) {
        const n = nearestMonster(s);
        if (n) aimAt(s, n.m.x, n.m.y);
        attack(s);
      }
    },
  },
  {
    // Shade cracks a gold chest: close crane down onto the legendary drop.
    start: 6.4,
    end: 8.6,
    kind: "game",
    cls: 2,
    caption: { text: "LOOT LEGENDARY RELICS", sub: "every chest roll is MagicBlock VRF · relics mint as NFTs", from: 6.65, to: 8.5, color: "#ffcf5a" },
    rig: (lt, len) => ({ dist: 11 - ease(lt / len) * 3, tilt: 0.05 - ease(lt / len) * 0.08, ox: 0.6, oz: -0.4 }),
    setup: (s) => {
      const w = s.w();
      let ci = w.chests.findIndex((c) => (c.tx || c.ty) && c.tier === CHEST.GOLD && c.state === CHEST_STATE.CLOSED);
      if (ci < 0) ci = w.chests.findIndex((c) => (c.tx || c.ty) && c.tier === CHEST.NORMAL);
      const ch = w.chests[ci];
      const cx = ch.tx * TILE + 128;
      const cy = ch.ty * TILE + 128;
      s.sim.t_clear_monsters(cx, cy, TILE * 12);
      s.sim.t_place(0, cx - TILE * 1.05, cy + 30);
      s.sim.t_hp(0, 999, 999);
      s.vars.cx = cx;
      s.vars.cy = cy;
    },
    direct: (s, lt) => {
      walk(s, s.vars.cx - 230, s.vars.cy + 30, 60);
      aimAt(s, s.vars.cx, s.vars.cy);
      if (lt > 0.3 && !(s.vars.chest >= 0)) {
        const c = s.sim.interact(0);
        if (c >= 0) s.vars.chest = c;
      }
      if (lt > 0.75 && !s.vars.open && s.vars.chest >= 0) {
        s.vars.open = true;
        const r = new Uint8Array(32);
        for (let i = 0; i < 32; i++) r[i] = (i * 73 + 41) & 255;
        s.sim.resolve_chest(s.vars.chest, r);
        s.sim.t_drop(ITEM.CROWN, 4, s.vars.cx + 120, s.vars.cy - 60);
        s.sim.t_drop(ITEM.HEART, 3, s.vars.cx - 30, s.vars.cy - 150);
      }
    },
  },
  {
    // A rival grabs for the idol; the Shade blinks behind him.
    start: 8.6,
    end: 10.8,
    kind: "game",
    cls: 2,
    bots: 1,
    caption: { text: "TRUST NO ONE", sub: "4-player PvP · kill a rival, take everything", from: 9.3, to: 10.75, color: "#e0283c", size: 52 },
    rig: (lt) => ({ dist: 11.5 - ease(lt / 0.9) * 1.5, ox: -1.1 }),
    setup: (s) => {
      const w = s.w();
      const r = roomFor(w, (r) => r.kind === ROOM.NORMAL && r.w >= 7);
      const c = center(r);
      s.sim.t_clear_monsters(0, 0, -1);
      s.sim.t_place(0, c.x - TILE * 2.2, c.y);
      s.sim.t_place(1, c.x + TILE * 0.6, c.y + 20);
      s.sim.t_hp(0, 999, 999);
      s.sim.t_hp(1, 24, 110);
      s.sim.t_drop(ITEM.IDOL, 3, c.x + TILE * 0.9, c.y - 60);
      s.vars.c = c;
    },
    direct: (s, lt) => {
      const rival = s.w().players[1];
      aimAt(s, rival.x, rival.y);
      if (lt > 0.5 && !s.vars.blink) {
        s.vars.blink = true;
        s.g.doSpecial();
      }
      if (lt > 0.7) attack(s);
    },
  },
  {
    // The Hollow King: low push toward the boss, then a crane pull-back.
    start: 10.8,
    end: 13.4,
    kind: "game",
    cls: 0,
    caption: { text: "FACE THE HOLLOW KING", sub: "elites, a boss and a crypt that collapses", from: 11.05, to: 13.3 },
    rig: (lt, len) => ({ dist: 9 + ease(lt / len) * 6, tilt: -0.08 + ease(lt / len) * 0.1, oz: -1.2 }),
    setup: (s) => {
      const w = s.w();
      const bi = w.bossIdx;
      const b = w.monsters[bi];
      s.sim.t_clear_monsters(b.x, b.y, TILE * 14);
      s.sim.t_place(0, b.x - TILE * 0.4, b.y + TILE * 2.3);
      s.sim.t_hp(0, 999, 999);
      s.sim.t_spawn(MON.SKELETON, b.x - TILE * 2.2, b.y + TILE * 1.2, true, 0);
      s.sim.t_spawn(MON.SKELETON, b.x + TILE * 2.4, b.y + TILE * 1.6, true, 0);
      s.vars.bi = bi;
    },
    direct: (s) => {
      const b = s.w().monsters[s.vars.bi];
      aimAt(s, b.x, b.y);
      walk(s, b.x, b.y + TILE * 1.4, 280);
      attack(s);
    },
  },
  {
    // Extraction: crane up as the beam takes the hero.
    start: 13.4,
    end: 15.6,
    kind: "game",
    cls: 0,
    caption: { text: "ESCAPE ALIVE", sub: "only what you carry out is yours", from: 13.6, to: 15.5, color: "#9fe0ff" },
    rig: (lt, len) => ({ dist: 8 + ease(lt / len) * 8, tilt: 0.08 * ease(lt / len) }),
    setup: (s) => {
      const w = s.w();
      const po = w.portals.find((p) => p.tx || p.ty)!;
      const px = po.tx * TILE + 128;
      const py = po.ty * TILE + 128;
      s.sim.t_clear_monsters(px, py, TILE * 10);
      s.sim.t_set_tick(w.portalTick - 2);
      s.sim.t_place(0, px, py + 40);
      s.sim.t_hp(0, 999, 999);
      // Channel most of the escape before the cut so the beam lands on screen.
      for (let i = 0; i < 22; i++) (s.session as any).step();
      s.vars.px = px;
      s.vars.py = py;
    },
    direct: (s) => aimAt(s, s.vars.px + 300, s.vars.py - 100),
  },
  { start: 15.6, end: 20.0, kind: "title" },
];

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
let comp: HTMLCanvasElement;
let cx2d: CanvasRenderingContext2D;
let townCanvas: HTMLCanvasElement;
let town: ReturnType<typeof makeTown>;
let gameHost: HTMLDivElement;
let stage: Stage | null = null;
let current = -1;
let simAcc = 0;
let flash: { color: string; alpha: number; ms: number; at: number } | null = null;

async function waitFor(cond: () => boolean, ms = 30000) {
  const t0 = realNow();
  while (!cond()) {
    if (realNow() - t0 > ms) throw new Error("trailer: timed out waiting");
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function startGameShot(shot: Shot) {
  stopGame();
  const session = await PracticeSession.create(shot.cls ?? 0, ["Reaper", "Spellbinder", "Shade"][shot.cls ?? 0], shot.bots ?? 0, true);
  clearInterval((session as any).timer); // we step the simulation ourselves
  const g = createGame(gameHost, session, { onEnd: () => {}, onPauseToggle: () => {} });
  // Render the 3D layer at 1280x720 for a crisp 1080p master.
  g.renderer.setSize(1280, 720, false);
  g.composer.setSize(1280, 720);
  // Let the renderer load its atlas and build the map, then take over its clock.
  await waitFor(() => g.built);
  cancelAnimationFrame(g.raf);
  g.loop = () => {};
  // Screen flashes are CSS transitions on real time: replay them on the virtual clock.
  g.screenFlash = (color: string, alpha: number, ms: number) => {
    flash = { color, alpha, ms, at: vt };
  };
  const sim = (session as any).sim;
  stage = { session, sim, g, w: () => g.world!, vars: {} };
  shot.setup?.(stage);
  (session as any).publish();
  const me = g.world!.players[0];
  g.pred = { x: me.x, y: me.y };
  g.camTarget.set(me.x * U, 0, me.y * U);
  // Camera rig for this shot.
  const rig = shot.rig;
  const len = shot.end - shot.start;
  g.placeCamera = (tx: number, tz: number, sx: number, sz: number) => {
    const lt = Math.max(0, (vt - stage!.vars.t0) / 1000);
    const r = rig ? rig(lt, len) : { dist: 13 };
    const p = PITCH + (r.tilt ?? 0);
    const x = tx + (r.ox ?? 0) + sx;
    const z = tz + (r.oz ?? 0) + sz;
    g.camera.position.set(x, Math.sin(p) * r.dist, z + Math.cos(p) * r.dist);
    g.camera.lookAt(x, 0, z);
  };
  stage.vars.t0 = vt;
  for (let i = 0; i < 3; i++) {
    vt += 1000 / FPS;
    g.update(vt, 1000 / FPS);
  }
  stage.vars.t0 = vt;
  simAcc = 0;
  flash = null;
}

function stopGame() {
  if (!stage) return;
  stage.session.destroy();
  stage.g.destroy();
  stage = null;
}

function stepGame(shot: Shot, lt: number) {
  const s = stage!;
  shot.direct?.(s, lt);
  vt += 1000 / FPS;
  simAcc += 1000 / FPS;
  while (simAcc >= 100) {
    simAcc -= 100;
    (s.session as any).step();
  }
  s.g.update(vt, 1000 / FPS);
}

// ---- drawing helpers --------------------------------------------------------
function outlinedText(text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", alpha = 1) {
  const c = cx2d;
  c.save();
  c.globalAlpha = alpha;
  c.font = `${size}px Silkscreen`;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.lineJoin = "miter";
  c.lineWidth = Math.max(4, size / 6);
  c.strokeStyle = "#05050a";
  c.strokeText(text, x, y);
  c.fillStyle = "#05050a";
  c.fillText(text, x + size / 10, y + size / 10);
  c.fillStyle = color;
  c.fillText(text, x, y);
  c.restore();
}

function drawCaption(cap: Caption, t: number) {
  if (t < cap.from || t > cap.to) return;
  const k = (t - cap.from) / 0.12;
  const out = (cap.to - t) / 0.15;
  const a = Math.max(0, Math.min(1, Math.min(k, out)));
  const size = cap.size ?? 42;
  const slide = Math.max(0, 1 - k) * 24;
  const y = CH - BAR - (cap.sub ? 58 : 42);
  cx2d.save();
  cx2d.globalAlpha = a * 0.9;
  cx2d.fillStyle = "#a0142a";
  const w = cap.text.length * size * 0.72 + 60;
  cx2d.fillRect(CW / 2 - w / 2 - slide, y - 32, w, 6);
  cx2d.restore();
  outlinedText(cap.text, CW / 2 + slide, y, size, cap.color ?? "#f2f6ff", "center", a);
  if (cap.sub) {
    const sa = Math.max(0, Math.min(1, (t - cap.from - 0.2) / 0.2, out));
    outlinedText(cap.sub.toUpperCase(), CW / 2, y + 38, 14, "#cfe8ff", "center", sa);
  }
}

function letterbox() {
  cx2d.fillStyle = "#000";
  cx2d.fillRect(0, 0, CW, BAR);
  cx2d.fillRect(0, CH - BAR, CW, BAR);
}

function vignette() {
  const g = cx2d.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CH * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(2,1,8,0.8)");
  cx2d.fillStyle = g;
  cx2d.fillRect(0, 0, CW, CH);
}

function punch(t: number, shot: Shot) {
  const lt = t - shot.start;
  if (lt < 0.1 && shot.start > 0) {
    cx2d.fillStyle = `rgba(255,255,255,${0.55 * (1 - lt / 0.1)})`;
    cx2d.fillRect(0, 0, CW, CH);
  }
}

function drawTownCrop(t: number, x: number, y: number, w: number, h: number, dim = 0) {
  town.draw(t, -1, true, dim);
  cx2d.imageSmoothingEnabled = false;
  cx2d.drawImage(townCanvas, x, y, w, h, 0, 0, CW, CH);
}

function drawTitle(t: number) {
  const lt = t - 15.6;
  const z = 1 + lt * 0.015;
  const w = TOWN_W / z;
  const h = TOWN_H / z;
  drawTownCrop(t, (TOWN_W - w) / 2, (TOWN_H - h) / 2, w, h, 0.5);
  cx2d.fillStyle = "rgba(3,4,10,0.35)";
  cx2d.fillRect(0, 0, CW, CH);
  const slam = Math.min(1, Math.max(0, (lt - 0.12) / 0.14));
  if (lt > 0.12) {
    const scale = 1 + (1 - slam) * 0.8;
    const shake = lt < 0.45 ? (Math.sin(lt * 90) * 6 * (0.45 - lt)) / 0.45 : 0;
    cx2d.save();
    cx2d.translate(CW / 2 + shake, CH / 2 - 78);
    cx2d.scale(scale, scale);
    const size = 96;
    cx2d.font = `${size}px Silkscreen`;
    const parts: [string, string][] = [
      ["EXIT", "#f2f6ff"],
      ["//", "#e0283c"],
      ["ZERO", "#9fe0ff"],
    ];
    const total = parts.reduce((s2, [p]) => s2 + cx2d.measureText(p).width, 0);
    let x = -total / 2;
    for (const [p, col] of parts) {
      const pw = cx2d.measureText(p).width;
      cx2d.textAlign = "left";
      cx2d.textBaseline = "middle";
      cx2d.lineWidth = 12;
      cx2d.strokeStyle = "#05050a";
      cx2d.strokeText(p, x, 0);
      cx2d.fillStyle = "#0d1c33";
      cx2d.fillText(p, x + 8, 8);
      cx2d.fillStyle = col;
      cx2d.fillText(p, x, 0);
      x += pw;
    }
    cx2d.restore();
  }
  if (lt > 0.12 && lt < 0.3) {
    cx2d.fillStyle = `rgba(255,255,255,${0.8 * (1 - (lt - 0.12) / 0.18)})`;
    cx2d.fillRect(0, 0, CW, CH);
  }
  if (lt > 0.7) outlinedText("A 4-PLAYER 3D EXTRACTION CRAWLER", CW / 2, CH / 2 - 6, 20, "#cfe8ff", "center", Math.min(1, (lt - 0.7) / 0.25));
  if (lt > 1.05) outlinedText("LOOT · BETRAY · ESCAPE BEFORE THE CRYPT COLLAPSES", CW / 2, CH / 2 + 22, 14, "#8a95b0", "center", Math.min(1, (lt - 1.05) / 0.25));
  if (lt > 1.4) {
    const a = Math.min(1, (lt - 1.4) / 0.15);
    const blink = lt < 1.9 && Math.floor(lt * 12) % 2 === 0 ? 0.4 : 1;
    cx2d.fillStyle = `rgba(160,20,42,${0.92 * a})`;
    cx2d.fillRect(CW / 2 - 190, CH / 2 + 50, 380, 56);
    outlinedText("RELEASING SOON", CW / 2, CH / 2 + 78, 34, "#ffffff", "center", a * blink);
  }
  if (lt > 2.0) {
    const a = Math.min(1, (lt - 2) / 0.3);
    outlinedText("FULLY ON-CHAIN · SOLANA × MAGICBLOCK EPHEMERAL ROLLUPS", CW / 2, CH - 64, 14, "#cfe8ff", "center", a);
    outlinedText("VRF LOOT · RELIC NFTs · VERIFIED ON-CHAIN REPLAYS", CW / 2, CH - 42, 13, "#8a95b0", "center", a);
  }
  if (lt > 3.75) {
    cx2d.fillStyle = `rgba(0,0,0,${Math.min(1, (lt - 3.75) / 0.6)})`;
    cx2d.fillRect(0, 0, CW, CH);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function frame(i: number): Promise<string> {
  const t = i / FPS;
  const si = SHOTS.findIndex((s) => t >= s.start && t < s.end);
  const shot = SHOTS[si < 0 ? SHOTS.length - 1 : si];
  if (si !== current) {
    current = si;
    if (shot.kind === "game") await startGameShot(shot);
    else stopGame();
  }
  cx2d.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  cx2d.clearRect(0, 0, CW, CH);
  if (shot.kind === "town") {
    const k = (t - shot.start) / (shot.end - shot.start);
    const e = 1 - Math.pow(1 - k, 2);
    const w = TOWN_W * (1 - e * 0.45);
    const h = TOWN_H * (1 - e * 0.45);
    drawTownCrop(t, (TOWN_W - w) / 2, (TOWN_H - h) * 0.25, w, h);
    letterbox();
  } else if (shot.kind === "game") {
    stepGame(shot, t - shot.start);
    const g = stage!.g;
    cx2d.imageSmoothingEnabled = true;
    cx2d.filter = "saturate(0.95) contrast(1.06)";
    cx2d.drawImage(g.renderer.domElement, 0, 0, CW, CH);
    cx2d.filter = "none";
    cx2d.imageSmoothingEnabled = false;
    cx2d.drawImage(g.overlay, 0, 0, CW, CH);
    if (flash) {
      const k = (vt - flash.at) / flash.ms;
      if (k < 1) {
        cx2d.save();
        cx2d.globalCompositeOperation = "screen";
        cx2d.globalAlpha = flash.alpha * (1 - k);
        cx2d.fillStyle = flash.color;
        cx2d.fillRect(0, 0, CW, CH);
        cx2d.restore();
      } else flash = null;
    }
    vignette();
    letterbox();
  } else {
    drawTitle(t);
  }
  if (shot.caption) drawCaption(shot.caption, t);
  if (shot.kind !== "title") punch(t, shot);
  return comp.toDataURL("image/png");
}

export async function bootTrailer() {
  document.body.style.margin = "0";
  document.body.style.background = "#000";
  sfx.toggleMute();
  installPixelKit();
  await loadWasm();
  await Promise.all([document.fonts.load("32px Silkscreen"), document.fonts.load("16px 'Pixelify Sans'")]);
  comp = document.createElement("canvas");
  comp.width = CW * SCALE;
  comp.height = CH * SCALE;
  comp.style.cssText = "position:fixed;left:0;top:0;width:960px;height:540px;z-index:10";
  document.body.appendChild(comp);
  cx2d = comp.getContext("2d")!;
  townCanvas = document.createElement("canvas");
  townCanvas.width = TOWN_W;
  townCanvas.height = TOWN_H;
  town = makeTown(townCanvas.getContext("2d")!);
  gameHost = document.createElement("div");
  gameHost.style.cssText = "position:fixed;left:0;top:0;width:960px;height:540px;z-index:1";
  document.body.appendChild(gameHost);
  await new Promise((r) => setTimeout(r, 400));
  (window as any).__trailer = { frame, FRAMES, FPS, audio: () => renderSoundtrack(DURATION, SHOTS.map((s) => s.start)) };
  (window as any).__trailerReady = true;
}
