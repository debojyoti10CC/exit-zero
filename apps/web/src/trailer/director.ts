// Trailer renderer. Open /?trailer and drive window.__trailer.frame(i) for i in
// 0..FRAMES-1 (scripts/render-trailer.mjs does this headless). Every frame is
// real gameplay rendered by the game itself, stepped on a virtual clock.

import type Phaser from "phaser";
import { createGame, GameScene } from "../game/GameScene";
import { PracticeSession, loadWasm } from "../game/session";
import { sfx } from "../game/audio";
import { installPixelKit } from "../ui/pixelKit";
import { makeTown, TOWN_W, TOWN_H } from "../ui/SpiritTownScene";
import { TILE, World, CHEST, CHEST_STATE, ROOM, MON, ITEM } from "../game/world";
import { renderSoundtrack } from "./soundtrack";

export const FPS = 30;
export const DURATION = 20;
export const FRAMES = FPS * DURATION;
const CW = 960;
const CH = 540;
const BAR = 46;

// ---------------------------------------------------------------------------
// Virtual clock: the game, its tweens and interpolation all read this.
// ---------------------------------------------------------------------------
// Starts far above real time: each shot boots Phaser on the real clock first, and
// timers set then must never look like they are in the future.
let vt = 1e9;
const realNow = performance.now.bind(performance);
(performance as any).now = () => vt;

interface Caption {
  text: string;
  from: number;
  to: number;
  color?: string;
  size?: number;
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
  zoom?: number;
}

interface Stage {
  session: PracticeSession;
  sim: any;
  game: Phaser.Game;
  scene: GameScene;
  w: () => World;
  vars: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Helpers for staging
// ---------------------------------------------------------------------------
function roomFor(w: World, pick: (r: World["rooms"][number]) => boolean) {
  for (let i = 0; i < w.roomCount; i++) if (pick(w.rooms[i])) return w.rooms[i];
  return w.rooms[1];
}
const center = (r: World["rooms"][number]) => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

function aimAt(s: Stage, wx: number, wy: number) {
  const cam = s.scene.cameras.main;
  const v = cam.worldView;
  const px = ((wx / 16) - v.x) * cam.zoom;
  const py = ((wy / 16) - v.y) * cam.zoom;
  s.scene.input.activePointer.position.set(px, py);
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
  const sc = s.scene;
  const p = sc.pred!;
  (["W", "A", "S", "D"] as const).forEach((k) => (sc.keys[k].isDown = false));
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (Math.hypot(dx, dy) < stop) return;
  if (dx > 30) sc.keys.D.isDown = true;
  if (dx < -30) sc.keys.A.isDown = true;
  if (dy > 30) sc.keys.S.isDown = true;
  if (dy < -30) sc.keys.W.isDown = true;
}

function attack(s: Stage) {
  s.scene.nextAtk = 0;
  s.scene.doAttack();
}

// ---------------------------------------------------------------------------
// The edit (20s)
// ---------------------------------------------------------------------------
const SHOTS: Shot[] = [
  { start: 0, end: 2.0, kind: "town", caption: { text: "THE DEAD HUNGER", from: 0.35, to: 1.95 } },
  {
    start: 2.0,
    end: 5.0,
    kind: "game",
    cls: 0,
    zoom: 3.4,
    caption: { text: "CUT THEM DOWN", from: 2.25, to: 4.9 },
    setup: (s) => {
      const w = s.w();
      const r = roomFor(w, (r) => r.kind === ROOM.NORMAL && r.w >= 8 && r.h >= 6);
      const c = center(r);
      s.sim.t_clear_monsters(0, 0, -1);
      s.sim.t_place(0, c.x - TILE * 2, c.y);
      s.sim.t_hp(0, 999, 999);
      for (const [dx, dy] of [[1.6, -1.2], [2.4, 0.6], [1.2, 1.6], [3.4, -0.4]]) s.sim.t_spawn(MON.SKELETON, c.x + dx * TILE, c.y + dy * TILE, true, 0);
      s.sim.t_spawn(MON.NECRO, c.x + TILE * 4.5, c.y - TILE * 1.5, true, 0);
      s.vars.c = c;
    },
    direct: (s, lt) => {
      const n = nearestMonster(s);
      if (n) {
        aimAt(s, n.m.x, n.m.y);
        walk(s, n.m.x, n.m.y, 330);
        attack(s);
        if (lt > 1.4 && !s.vars.spec) {
          s.vars.spec = true;
          s.scene.doSpecial();
        }
      } else walk(s, s.vars.c.x + TILE * 3, s.vars.c.y);
    },
  },
  {
    start: 5.0,
    end: 7.0,
    kind: "game",
    cls: 1,
    zoom: 3.2,
    setup: (s) => {
      const w = s.w();
      const r = roomFor(w, (r) => r.kind !== ROOM.ENTRANCE && r.kind !== ROOM.BOSS && r.w >= 8);
      const c = center(r);
      s.sim.t_clear_monsters(0, 0, -1);
      s.sim.t_place(0, c.x - TILE * 3, c.y);
      s.sim.t_hp(0, 999, 999);
      for (const [dx, dy] of [[1.0, 0], [1.6, -0.8], [1.6, 0.8], [2.2, 0]]) s.sim.t_spawn(MON.SKELETON, c.x + dx * TILE, c.y + dy * TILE, false, 255);
      s.vars.c = c;
    },
    direct: (s, lt) => {
      const c = s.vars.c;
      aimAt(s, c.x + TILE * 1.5, c.y);
      if (lt > 0.15 && !s.vars.fb) {
        s.vars.fb = true;
        s.scene.doSpecial();
      }
      if (lt > 0.9) {
        const n = nearestMonster(s);
        if (n) aimAt(s, n.m.x, n.m.y);
        attack(s);
      }
    },
  },
  {
    start: 7.0,
    end: 9.0,
    kind: "game",
    cls: 2,
    zoom: 3.8,
    caption: { text: "CLAIM LEGENDARY RELICS", from: 7.3, to: 8.95, color: "#ffcf5a" },
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
      if (lt > 0.3 && !(s.vars.chest >= 0)) s.vars.chest = s.sim.interact(0);
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
    start: 9.0,
    end: 11.5,
    kind: "game",
    cls: 2,
    bots: 1,
    zoom: 3.6,
    caption: { text: "TRUST NO ONE", from: 9.9, to: 11.45, color: "#e0283c", size: 52 },
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
      if (lt > 0.55 && !s.vars.blink) {
        s.vars.blink = true;
        s.scene.doSpecial();
      }
      if (lt > 0.75) attack(s);
    },
  },
  {
    start: 11.5,
    end: 14.0,
    kind: "game",
    cls: 0,
    zoom: 2.6,
    caption: { text: "FACE THE HOLLOW KING", from: 11.8, to: 13.95 },
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
    start: 14.0,
    end: 16.0,
    kind: "game",
    cls: 0,
    zoom: 3.4,
    caption: { text: "CROSS OVER ALIVE", from: 14.25, to: 15.85, color: "#9fe0ff" },
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
      for (let i = 0; i < 24; i++) (s.session as any).step();
      s.vars.px = px;
      s.vars.py = py;
    },
    direct: (s) => aimAt(s, s.vars.px + 300, s.vars.py - 100),
  },
  { start: 16.0, end: 20.0, kind: "title" },
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

async function waitFor(cond: () => boolean, ms = 20000) {
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
  const game = createGame(gameHost, session, { onEnd: () => {}, onPauseToggle: () => {} });
  // Let Phaser boot and build the map with the real loop, then freeze it.
  await waitFor(() => {
    const sc = game.scene.getScene("game") as GameScene | null;
    return !!sc && (sc as any).built;
  });
  game.loop.sleep();
  const scene = game.scene.getScene("game") as GameScene;
  const sim = (session as any).sim;
  stage = { session, sim, game, scene, w: () => scene.world!, vars: {} };
  shot.setup?.(stage);
  // Publish the staged world, settle the camera on the hero.
  (session as any).publish();
  scene.pred = { x: scene.world!.players[0].x, y: scene.world!.players[0].y };
  scene.cameras.main.setZoom(shot.zoom ?? 3);
  const me = scene.world!.players[0];
  scene.cameras.main.centerOn(me.x / 16, me.y / 16);
  for (let i = 0; i < 3; i++) {
    vt += 1000 / FPS;
    game.step(vt, 1000 / FPS);
  }
  simAcc = 0;
}

function stopGame() {
  if (!stage) return;
  stage.session.destroy();
  stage.game.destroy(true);
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
  s.game.step(vt, 1000 / FPS);
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
  // Crimson slash behind the words.
  cx2d.save();
  cx2d.globalAlpha = a * 0.9;
  cx2d.fillStyle = "#a0142a";
  const w = cap.text.length * size * 0.72 + 60;
  cx2d.fillRect(CW / 2 - w / 2 - slide, CH - BAR - 74, w, 6);
  cx2d.restore();
  outlinedText(cap.text, CW / 2 + slide, CH - BAR - 42, size, cap.color ?? "#f2f6ff", "center", a);
}

function letterbox() {
  cx2d.fillStyle = "#000";
  cx2d.fillRect(0, 0, CW, BAR);
  cx2d.fillRect(0, CH - BAR, CW, BAR);
}

function punch(t: number, shot: Shot) {
  // Short zoom punch + flash on every cut.
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
  const lt = t - 16;
  const z = 1 + lt * 0.015;
  const w = TOWN_W / z;
  const h = TOWN_H / z;
  drawTownCrop(t, (TOWN_W - w) / 2, (TOWN_H - h) / 2, w, h, 0.5);
  cx2d.fillStyle = "rgba(3,4,10,0.35)";
  cx2d.fillRect(0, 0, CW, CH);
  // Logo slam.
  const slam = Math.min(1, Math.max(0, (lt - 0.12) / 0.14));
  if (lt > 0.12) {
    const scale = 1 + (1 - slam) * 0.8;
    const shake = lt < 0.45 ? (Math.sin(lt * 90) * 6 * (0.45 - lt)) / 0.45 : 0;
    cx2d.save();
    cx2d.translate(CW / 2 + shake, CH / 2 - 60);
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
  if (lt > 0.75) outlinedText("CUT DOWN HOLLOWS · BETRAY RIVALS · CROSS OVER", CW / 2, CH / 2 + 22, 18, "#cfe8ff", "center", Math.min(1, (lt - 0.75) / 0.25));
  if (lt > 1.3) {
    const a = Math.min(1, (lt - 1.3) / 0.15);
    const blink = lt < 1.8 && Math.floor(lt * 12) % 2 === 0 ? 0.4 : 1;
    cx2d.fillStyle = `rgba(160,20,42,${0.92 * a})`;
    cx2d.fillRect(CW / 2 - 190, CH / 2 + 62, 380, 56);
    outlinedText("RELEASING SOON", CW / 2, CH / 2 + 90, 34, "#ffffff", "center", a * blink);
  }
  if (lt > 2.0) outlinedText("FULLY ON-CHAIN  ·  SOLANA × MAGICBLOCK EPHEMERAL ROLLUPS", CW / 2, CH - 46, 14, "#8a95b0", "center", Math.min(1, (lt - 2) / 0.3));
  if (lt > 3.4) {
    cx2d.fillStyle = `rgba(0,0,0,${Math.min(1, (lt - 3.4) / 0.6)})`;
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
  cx2d.clearRect(0, 0, CW, CH);
  if (shot.kind === "town") {
    // Slow push from the whole town to the moon behind the torii.
    const k = (t - shot.start) / (shot.end - shot.start);
    const e = 1 - Math.pow(1 - k, 2);
    const w = TOWN_W * (1 - e * 0.45);
    const h = TOWN_H * (1 - e * 0.45);
    drawTownCrop(t, (TOWN_W - w) / 2, (TOWN_H - h) * 0.25, w, h);
    letterbox();
  } else if (shot.kind === "game") {
    stepGame(shot, t - shot.start);
    cx2d.imageSmoothingEnabled = false;
    cx2d.drawImage(stage!.game.canvas, 0, 0, CW, CH);
    // Cold grade + vignette for a cinematic finish.
    cx2d.fillStyle = "rgba(10,20,45,0.10)";
    cx2d.fillRect(0, 0, CW, CH);
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
  comp.width = CW;
  comp.height = CH;
  comp.style.cssText = "position:fixed;left:0;top:0;width:960px;height:540px;z-index:10;image-rendering:pixelated";
  document.body.appendChild(comp);
  cx2d = comp.getContext("2d")!;
  townCanvas = document.createElement("canvas");
  townCanvas.width = TOWN_W;
  townCanvas.height = TOWN_H;
  town = makeTown(townCanvas.getContext("2d")!);
  gameHost = document.createElement("div");
  gameHost.style.cssText = "position:fixed;left:0;top:0;width:960px;height:540px;z-index:1";
  document.body.appendChild(gameHost);
  // Make sure the tileset is loaded before the town renders.
  await new Promise((r) => setTimeout(r, 400));
  (window as any).__trailer = { frame, FRAMES, FPS, audio: () => renderSoundtrack(DURATION, SHOTS.map((s) => s.start)) };
  (window as any).__trailerReady = true;
}
