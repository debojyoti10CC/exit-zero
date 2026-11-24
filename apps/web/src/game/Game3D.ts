// HD-2D renderer: the same game (same session, rules, HUD and audio) drawn as a lit 3D
// crypt with pixel-art billboards. The scene renders at a low internal resolution and is
// upscaled with nearest-neighbour filtering, so geometry, light and sprites all share one
// chunky pixel grid. Bloom makes spirit energy, flames and loot beams glow.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { sfx } from "./audio";
import { hud, minimap } from "./hudStore";
import { ContractTracker } from "./contracts";
import { heroFrames, hollowFrames, bladeTexture } from "./reaperArt";
import { ICONS } from "./textures";
import { FRAMES } from "../ui/Sprites";
import type { GameSession, Snapshot } from "./session";
import {
  World, Player, isWall, MAP_W, MAP_H, TILE, CLASSES, MON, PROJ, ITEM, CHEST, CHEST_STATE, PS, PHASE, EV, MS, ROOM, RARITY_COLORS,
  RARITY_CSS, PLAYER_COLORS, PLAYER_CSS, NOBODY, SRC_MONSTER, SRC_WORLD, MON_NAMES, ITEM_NAMES, EXTRACT_TICKS, INTERACT_RADIUS,
  PORTAL_RADIUS, DODGE_SPEED_MULT, TICKS_PER_SEC, radToByte, angleRad, itemLabel, itemValue, lootValue, portalsOpen, corruption,
  fmtTime, MON_RANGE, CLASS_ARCANIST, CLASS_ROGUE, CLASS_VANGUARD,
} from "./world";

/** Internal render resolution (upscaled with nearest filtering). */
const RW = 640;
const RH = 360;
/** Overlay (labels, numbers) resolution, matching the 2D build's UI space. */
const VIEW_W = 960;
const VIEW_H = 540;
const SEND_MS = 66;
/** World units → tiles (1 three.js unit = 1 tile). */
const U = 1 / TILE;
/** Pixel-art texels per tile. */
const TPX = 16;
const SPRITE_SCALE = 1.3;
const WALL_H = 1.5;
const LOW_WALL_H = 0.42;
const CAM_DIST = 14;
const CAM_PITCH = (56 * Math.PI) / 180;
const LIGHT_POOL = 14;
/** Upright billboards are stretched so they project at their true pixel height. */
const BB_K = 1 / Math.cos(CAM_PITCH);

function hash(a: number, b: number, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// -----------------------------------------------------------------------------
// Textures
// -----------------------------------------------------------------------------

const texCache = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
function pixTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  let t = texCache.get(c);
  if (!t) {
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(c, t);
  }
  return t;
}

let atlasPromise: Promise<HTMLImageElement> | null = null;
function loadAtlas() {
  if (!atlasPromise) {
    atlasPromise = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = `${import.meta.env.BASE_URL}assets/0x72/0x72_DungeonTilesetII_v1.7.png`;
    });
  }
  return atlasPromise;
}

const frameCache = new Map<string, HTMLCanvasElement>();
function atlasFrame(img: HTMLImageElement, name: string, tint?: string): HTMLCanvasElement {
  const key = `${name}|${tint ?? ""}`;
  let c = frameCache.get(key);
  if (c) return c;
  const f = FRAMES[name] || FRAMES[`${name}_f0`];
  const [x, y, w, h] = f || [0, 0, 16, 16];
  c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  if (tint) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  }
  frameCache.set(key, c);
  return c;
}

function iconCanvas(name: string): HTMLCanvasElement {
  const key = `icon:${name}`;
  let c = frameCache.get(key);
  if (c) return c;
  const { rows, pal } = ICONS[name];
  const w = Math.max(...rows.map((r) => r.length));
  c = canvas(16, 16);
  const ctx = c.getContext("2d")!;
  const ox = Math.floor((16 - w) / 2);
  const oy = Math.floor((16 - rows.length) / 2);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
  frameCache.set(key, c);
  return c;
}

/** Soft radial blob (shadows, glows). */
function radial(size: number, inner: string, outer: string) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pixel ring with rune ticks (portals, shields, shockwaves). */
function ringCanvas(size: number, thick: number, runes = false) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d")!;
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      if (d <= r - 0.5 && d >= r - thick) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, 1, 1);
      } else if (runes && d < r - thick - 2 && d > r - thick - 5) {
        const a = Math.atan2(y - r, x - r);
        if (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 3 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  return c;
}

/** Crescent slash (white, points right). */
function slashCanvas() {
  const c = canvas(32, 32);
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d1 = Math.hypot(x - 8, y - 16);
      const d2 = Math.hypot(x - 3, y - 16);
      if (d1 < 15 && d2 > 15 && x > 8) {
        const a = 1 - Math.abs(y - 16) / 16;
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + a * 0.65).toFixed(2)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

/** Vertical beam gradient. */
function beamCanvas() {
  const c = canvas(8, 64);
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 64; y++) {
    const a = Math.pow(y / 63, 1.6);
    for (let x = 0; x < 8; x++) {
      const e = 1 - Math.abs(x - 3.5) / 4;
      ctx.fillStyle = `rgba(255,255,255,${(a * e).toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Hand-painted flame frames (blue spirit fire). */
function flameFrames(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < 4; f++) {
    const c = canvas(8, 12);
    const ctx = c.getContext("2d")!;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 8; x++) {
        const cx = 3.5 + Math.sin(y * 0.9 + f * 1.7) * 0.8 * (1 - y / 12);
        const w = (y / 11) * 3.6;
        const d = Math.abs(x - cx);
        if (d > w) continue;
        const core = d < w * 0.45 && y > 5;
        ctx.fillStyle = core ? "#ffffff" : y > 7 ? "#7fd0ff" : "#2a7ae0";
        if (y < 2 && (x + f) % 2) continue;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    out.push(c);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Sprite material: unlit pixel art, CPU-lit tint + hit flash, alpha-tested.
// -----------------------------------------------------------------------------

function spriteMaterial(map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      tint: { value: new THREE.Color(1, 1, 1) },
      flash: { value: 0 },
      opacity: { value: 1 },
      texel: { value: new THREE.Vector2(1 / 16, 1 / 16) },
      outline: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; uniform float flash; uniform float opacity; uniform vec2 texel; uniform vec4 outline; varying vec2 vUv;
      void main(){ vec4 t = texture2D(map, vUv);
      if (t.a < 0.5) {
        if (outline.a <= 0.0) discard;
        float n = texture2D(map, vUv + vec2(texel.x, 0.0)).a + texture2D(map, vUv - vec2(texel.x, 0.0)).a + texture2D(map, vUv + vec2(0.0, texel.y)).a + texture2D(map, vUv - vec2(0.0, texel.y)).a;
        if (n < 0.5) discard;
        gl_FragColor = vec4(outline.rgb * outline.a, 1.0); return;
      }
      vec3 c = mix(t.rgb * tint, vec3(1.0), flash);
      if (opacity < 0.999 && fract((gl_FragCoord.x + gl_FragCoord.y) * 0.5) < 0.5 && opacity < 0.75) discard;
      gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.DoubleSide,
  });
}
type SpriteMat = ReturnType<typeof spriteMaterial>;

/** A billboard quad anchored at its bottom-centre. */
function billboard(c: HTMLCanvasElement, scale = 1, anchorY = 0) {
  const w = (c.width / TPX) * SPRITE_SCALE * scale;
  const h = (c.height / TPX) * SPRITE_SCALE * scale;
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2 - anchorY * h, 0);
  const m = spriteMaterial(pixTex(c));
  m.uniforms.texel.value.set(1 / c.width, 1 / c.height);
  return new THREE.Mesh(g, m);
}

// -----------------------------------------------------------------------------
// Particles: square pixels, per-particle colour/alpha, two blend modes.
// -----------------------------------------------------------------------------

class Particles {
  max: number;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  ttl: Float32Array;
  grav: Float32Array;
  base: Float32Array;
  n = 0;
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("psize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: RH * 0.62 } },
      vertexShader: `attribute vec4 color; attribute float psize; uniform float scale; varying vec4 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.0, floor(psize * scale / -mv.z + 0.5)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ if (vC.a < 0.02) discard; gl_FragColor = vec4(vC.rgb * ${additive ? "vC.a" : "1.0"}, ${additive ? "1.0" : "vC.a"}); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, ttl: number, color: number, size: number, grav = 0, alpha = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = ttl;
    this.ttl[i] = ttl;
    this.grav[i] = grav;
    this.size[i] = size;
    const c = new THREE.Color(color).convertSRGBToLinear();
    this.base[i * 4] = c.r;
    this.base[i * 4 + 1] = c.g;
    this.base[i * 4 + 2] = c.b;
    this.base[i * 4 + 3] = alpha;
  }
  update(dt: number) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      if (j !== i) {
        for (let k = 0; k < 3; k++) {
          this.pos[j * 3 + k] = this.pos[i * 3 + k];
          this.vel[j * 3 + k] = this.vel[i * 3 + k];
        }
        for (let k = 0; k < 4; k++) this.base[j * 4 + k] = this.base[i * 4 + k];
        this.ttl[j] = this.ttl[i];
        this.grav[j] = this.grav[i];
        this.size[j] = this.size[i];
      }
      this.life[j] = l;
      this.vel[j * 3 + 1] -= this.grav[j] * dt;
      this.pos[j * 3] += this.vel[j * 3] * dt;
      this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt;
      this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      if (this.pos[j * 3 + 1] < 0.02) {
        this.pos[j * 3 + 1] = 0.02;
        this.vel[j * 3 + 1] *= -0.3;
        this.vel[j * 3] *= 0.6;
        this.vel[j * 3 + 2] *= 0.6;
      }
      const f = l / this.ttl[j];
      this.col[j * 4] = this.base[j * 4];
      this.col[j * 4 + 1] = this.base[j * 4 + 1];
      this.col[j * 4 + 2] = this.base[j * 4 + 2];
      this.col[j * 4 + 3] = this.base[j * 4 + 3] * Math.min(1, f * 1.6);
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}

// -----------------------------------------------------------------------------
// Views
// -----------------------------------------------------------------------------

interface Ent {
  root: THREE.Group; // at feet, on the floor
  bb: THREE.Group; // faces the camera
  body: THREE.Mesh;
  mat: SpriteMat;
  shadow: THREE.Mesh;
  frames: HTMLCanvasElement[];
  frame: number;
}
interface PlayerView extends Ent {
  weapon: THREE.Mesh;
  ring: THREE.Mesh;
  aura: THREE.Mesh;
  cls: number;
  state: number;
  flashUntil: number;
  swingUntil: number;
  swingDir: number;
  lastX: number;
  lastY: number;
  deadAt: number;
  sx: number;
  sy: number;
  lit: boolean;
}
interface MonsterView extends Ent {
  kind: number;
  dead: boolean;
  deadAt: number;
  flashUntil: number;
  bang: boolean;
  scale: number;
  sx: number;
  sy: number;
  topY: number;
  lit: boolean;
}
interface ProjView {
  mesh: THREE.Mesh;
  kind: number;
  col: number;
}
interface DropView {
  root: THREE.Group;
  icon: THREE.Mesh;
  beam?: THREE.Mesh;
  key: string;
  bornAt: number;
  x: number;
  z: number;
  col: number;
  rarity: number;
}
interface ChestView {
  root: THREE.Group;
  lid: THREE.Group;
  glow: THREE.Mesh;
  state: number;
  tier: number;
  openAt: number;
  x: number;
  z: number;
}
interface LightSrc {
  x: number;
  y: number;
  z: number;
  color: number;
  i: number;
  r: number;
}
interface Fx {
  update: (now: number) => boolean;
}

export interface SceneHooks {
  onEnd: (w: World, me: number) => void;
  onPauseToggle: () => void;
}

// -----------------------------------------------------------------------------
// The game
// -----------------------------------------------------------------------------

export class Game3D {
  session: GameSession;
  hooks: SceneHooks;
  host: HTMLElement;
  wrap: HTMLDivElement;
  frameEl: HTMLDivElement;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  overlay: HTMLCanvasElement;
  octx: CanvasRenderingContext2D;
  vignette: HTMLDivElement;
  tintEl: HTMLDivElement;
  hurtEl: HTMLDivElement;
  flashEl: HTMLDivElement;
  atlas: HTMLImageElement | null = null;
  raf = 0;
  dead = false;

  snaps: Snapshot[] = [];
  world: World | null = null;
  built = false;
  lastSeq = -1;

  players: (PlayerView | null)[] = [null, null, null, null];
  monsters: (MonsterView | null)[] = [];
  projs: (ProjView | null)[] = [];
  drops: (DropView | null)[] = [];
  chests: (ChestView | null)[] = [];
  portals: { x: number; z: number; ring: THREE.Mesh; inner: THREE.Mesh; swirl: THREE.Mesh; swirl2: THREE.Mesh; pillar: THREE.Mesh }[] = [];
  door?: THREE.Mesh;
  doorOpenAt = 0;
  torches: { x: number; z: number; y: number; seed: number; flame: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  flames: HTMLCanvasElement[] = flameFrames();
  staticLights: LightSrc[] = [];
  dyn: (LightSrc & { until: number; born: number })[] = [];
  pool: THREE.PointLight[] = [];
  frameLights: LightSrc[] = [];
  ambient!: THREE.AmbientLight;
  hemi!: THREE.HemisphereLight;
  sparks = new Particles(2600, true);
  debris = new Particles(1400, false);
  fx: Fx[] = [];
  teleGroup = new THREE.Group();
  explored = new Uint8Array(MAP_W * MAP_H);

  keys = new Set<string>();
  mouse = { x: VIEW_W / 2, y: VIEW_H / 2, left: false };
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
  endNotified = false;
  endTimer = 0;
  lastHud = 0;
  lastFog = 0;
  lastMinimap = 0;
  lastFrame = performance.now();
  mmCanvas: HTMLCanvasElement;
  dmgTexts: { text: string; color: string; scale: number; x: number; y: number; z: number; born: number }[] = [];
  unsub: (() => void) | null = null;
  shake = { until: 0, amp: 0, dur: 1 };
  camPos = new THREE.Vector3();
  camTarget = new THREE.Vector3();
  lastFilter = "";
  tex: Record<string, THREE.Texture> = {};
  listeners: [EventTarget, string, EventListener, any?][] = [];

  constructor(parent: HTMLElement, session: GameSession, hooks: SceneHooks) {
    this.session = session;
    this.hooks = hooks;
    this.host = parent;

    // DOM: a 16:9 frame that fits the host; canvas + overlay + post layers inside.
    this.wrap = document.createElement("div");
    Object.assign(this.wrap.style, { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", background: "#030208", overflow: "hidden" });
    this.frameEl = document.createElement("div");
    Object.assign(this.frameEl.style, { position: "relative", aspectRatio: "16 / 9", cursor: "crosshair" });
    this.wrap.appendChild(this.frameEl);
    parent.appendChild(this.wrap);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RW, RH, false);
    this.renderer.setClearColor(0x030208, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const cv = this.renderer.domElement;
    Object.assign(cv.style, { position: "absolute", inset: "0", width: "100%", height: "100%", imageRendering: "pixelated" });
    this.frameEl.appendChild(cv);

    const layer = (bg: string, blend?: string) => {
      const d = document.createElement("div");
      Object.assign(d.style, { position: "absolute", inset: "0", pointerEvents: "none", background: bg, opacity: "0", mixBlendMode: blend || "normal" });
      this.frameEl.appendChild(d);
      return d;
    };
    this.tintEl = layer("#7a0018", "screen");
    this.hurtEl = layer("radial-gradient(ellipse at center, rgba(255,0,34,0) 35%, rgba(255,0,34,0.9) 100%)");
    this.flashEl = layer("#ffffff", "screen");
    this.vignette = layer("radial-gradient(ellipse at center, rgba(0,0,0,0) 48%, rgba(2,1,8,0.85) 100%)");
    this.vignette.style.opacity = "1";

    this.overlay = canvas(VIEW_W, VIEW_H);
    Object.assign(this.overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", imageRendering: "pixelated" });
    this.frameEl.appendChild(this.overlay);
    this.octx = this.overlay.getContext("2d")!;
    this.octx.imageSmoothingEnabled = false;

    this.camera = new THREE.PerspectiveCamera(34, RW / RH, 0.5, 80);
    this.scene.background = new THREE.Color(0x030208);
    this.scene.fog = new THREE.Fog(0x030208, 16, 30);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(1);
    this.composer.setSize(RW, RH);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(RW, RH), 0.75, 0.3, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ambient = new THREE.AmbientLight(0x6a7cc0, 0.7);
    this.hemi = new THREE.HemisphereLight(0x4a6ab8, 0x0a0410, 0.6);
    this.scene.add(this.ambient, this.hemi);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 1.4);
      this.pool.push(l);
      this.scene.add(l);
    }
    this.scene.add(this.sparks.points, this.debris.points, this.teleGroup);

    this.tex.shadow = radial(64, "rgba(0,0,0,0.75)", "rgba(0,0,0,0)");
    this.tex.glow = radial(64, "rgba(255,255,255,1)", "rgba(255,255,255,0)");
    this.tex.ring = pixTex(ringCanvas(48, 3));
    this.tex.rune = pixTex(ringCanvas(64, 3, true));
    this.tex.slash = pixTex(slashCanvas());
    const beam = new THREE.CanvasTexture(beamCanvas());
    beam.colorSpace = THREE.SRGBColorSpace;
    this.tex.beam = beam;

    this.mmCanvas = canvas(MAP_W * 3, MAP_H * 3);
    minimap.canvas = this.mmCanvas;

    this.bindInput();
    this.fit();
    const ro = new ResizeObserver(() => this.fit());
    ro.observe(parent);
    this.listeners.push([window, "__ro", (() => ro.disconnect()) as any]);

    loadAtlas().then((img) => {
      if (this.dead) return;
      this.atlas = img;
      this.unsub = this.session.onSnapshot((s) => this.onSnapshot(s));
      if (this.session.latest) this.onSnapshot(this.session.latest);
    });
    sfx.startAmbience();
    this.raf = requestAnimationFrame(this.loop);
    if (import.meta.env.DEV) (window as any).__ez3d = this;
  }

  fit() {
    const r = this.host.getBoundingClientRect();
    const w = Math.min(r.width, (r.height * 16) / 9);
    this.frameEl.style.width = `${Math.floor(w)}px`;
  }

  on(t: EventTarget, ev: string, fn: EventListener, opt?: any) {
    t.addEventListener(ev, fn, opt);
    this.listeners.push([t, ev, fn, opt]);
  }

  bindInput() {
    const typing = (e: Event) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    this.on(window, "keydown", ((e: KeyboardEvent) => {
      if (typing(e)) return;
      if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case "Space":
        case "ShiftLeft":
        case "ShiftRight":
          this.doDodge();
          break;
        case "KeyE":
          this.session.interact();
          break;
        case "KeyQ":
        case "Digit1":
          this.doPotion();
          break;
        case "Tab":
          hud.set({ inventoryOpen: !hud.get().inventoryOpen });
          break;
        case "Escape":
          this.hooks.onPauseToggle();
          break;
      }
    }) as EventListener);
    this.on(window, "keyup", ((e: KeyboardEvent) => void this.keys.delete(e.code)) as EventListener);
    this.on(window, "blur", (() => this.keys.clear()) as EventListener);
    const el = this.frameEl;
    this.on(el, "pointermove", ((e: PointerEvent) => this.setMouse(e)) as EventListener);
    this.on(el, "pointerdown", ((e: PointerEvent) => {
      sfx.ensure();
      this.setMouse(e);
      if (e.button === 2) this.doSpecial();
      else if (e.button === 0) {
        this.atkHeld = true;
        this.mouse.left = true;
        this.doAttack();
      }
    }) as EventListener);
    this.on(window, "pointerup", ((e: PointerEvent) => {
      if (e.button === 0) {
        this.atkHeld = false;
        this.mouse.left = false;
      }
    }) as EventListener);
    this.on(el, "contextmenu", ((e: Event) => e.preventDefault()) as EventListener);
  }

  setMouse(e: PointerEvent) {
    const r = this.frameEl.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * VIEW_W;
    this.mouse.y = ((e.clientY - r.top) / r.height) * VIEW_H;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.unsub?.();
    sfx.stopAmbience();
    minimap.canvas = null;
    for (const [t, ev, fn, opt] of this.listeners) {
      if (ev === "__ro") (fn as any)();
      else t.removeEventListener(ev, fn, opt);
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.wrap.remove();
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
    for (const e of w.events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      this.onEvent(e, w, prev);
    }
    this.syncChests(w);
    if (this.door && w.door.open && !this.doorOpenAt) this.doorOpenAt = performance.now();
  }

  // ---------------------------------------------------------------------------
  // Map construction
  // ---------------------------------------------------------------------------

  doorTiles(w: World): Set<number> {
    const s = new Set<number>();
    const d = w.door;
    if (!d.tx && !d.ty) return s;
    s.add(d.ty * MAP_W + d.tx);
    s.add(d.vertical ? (d.ty + 1) * MAP_W + d.tx : d.ty * MAP_W + d.tx + 1);
    return s;
  }

  buildMap(w: World) {
    const img = this.atlas!;
    const seed = w.seed[0] + w.seed[1] * 256;
    const doorSet = this.doorTiles(w);
    const solid = (x: number, y: number) => isWall(w, x, y) && !doorSet.has(y * MAP_W + x);
    const floor = (x: number, y: number) => !solid(x, y);

    // --- Floor: one big pixel canvas (tiles, decals, AO, room tints) on a plane.
    const fc = canvas(MAP_W * TPX, MAP_H * TPX);
    const ctx = fc.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#020104";
    ctx.fillRect(0, 0, fc.width, fc.height);
    const draw = (name: string, x: number, y: number) => {
      const f = FRAMES[name];
      if (f) ctx.drawImage(img, f[0], f[1], f[2], f[3], x, y, f[2], f[3]);
    };
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!floor(x, y)) continue;
        const r = hash(x, y, seed);
        draw(r < 0.72 ? "floor_1" : `floor_${2 + Math.floor(hash(y, x, seed) * 7)}`, x * TPX, y * TPX);
      }
    }
    // Cool, desaturated stone: multiply a blue-grey grade over the warm tileset.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#8a96c0";
    ctx.fillRect(0, 0, fc.width, fc.height);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < w.roomCount; i++) {
      const r = w.rooms[i];
      const col = r.kind === ROOM.BOSS ? "rgba(110,0,24,0.30)" : r.kind === ROOM.VAULT ? "rgba(90,70,0,0.25)" : r.kind === ROOM.ENTRANCE ? "rgba(20,60,120,0.25)" : "";
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(r.x * TPX, r.y * TPX, r.w * TPX, r.h * TPX);
      }
      // Scattered bones and skulls.
      const n = Math.floor(r.w * r.h * 0.06);
      for (let k = 0; k < n; k++) {
        const tx = r.x + 1 + Math.floor(hash(k, i, seed + 11) * (r.w - 2));
        const ty = r.y + 1 + Math.floor(hash(i, k, seed + 13) * (r.h - 2));
        if (!floor(tx, ty) || w.chests.some((c) => c.tx === tx && c.ty === ty)) continue;
        const h = hash(tx, ty, seed + 17);
        const ox = Math.floor(hash(ty, tx, 5) * 8) - 4;
        const oy = Math.floor(hash(tx, k, 7) * 8) - 4;
        ctx.globalAlpha = 0.8;
        if (h < 0.5) {
          ctx.drawImage(iconCanvas("bone"), tx * TPX + ox, ty * TPX + oy);
        } else if (h < 0.75) draw("skull", tx * TPX + ox, ty * TPX + oy);
        ctx.globalAlpha = 1;
      }
      if (r.kind === ROOM.ENTRANCE) {
        // Senkaimon-style seal on the entrance floor.
        const cx = (r.x + r.w / 2) * TPX;
        const cy = (r.y + r.h / 2) * TPX;
        ctx.strokeStyle = "rgba(140,210,255,0.55)";
        ctx.lineWidth = 1;
        for (const rad of [22, 28]) {
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.fillStyle = "rgba(200,235,255,0.7)";
          ctx.fillRect(Math.round(cx + Math.cos(a) * 25) - 1, Math.round(cy + Math.sin(a) * 25) - 1, 2, 2);
        }
      }
    }
    // Contact shadows along walls.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!floor(x, y)) continue;
        const X = x * TPX;
        const Y = y * TPX;
        if (!floor(x, y - 1)) {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(X, Y, TPX, 3);
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.fillRect(X, Y + 3, TPX, 3);
        }
        if (!floor(x - 1, y)) {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.fillRect(X, Y, 3, TPX);
        }
        if (!floor(x + 1, y)) {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.fillRect(X + TPX - 3, Y, 3, TPX);
        }
      }
    }
    const floorTex = pixTex(fc);
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), new THREE.MeshLambertMaterial({ map: floorTex }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(MAP_W / 2, 0, MAP_H / 2);
    this.scene.add(floorMesh);

    // --- Walls: merged geometry, only faces that border floor.
    const SLOT_W = 16;
    const SLOT_H = 24;
    const SLOTS = 6;
    const wc = canvas(SLOT_W * SLOTS, SLOT_H);
    const wctx = wc.getContext("2d")!;
    const wdraw = (name: string, sx: number, sy: number, crop = 0) => {
      const f = FRAMES[name];
      if (f) wctx.drawImage(img, f[0], f[1] + crop, f[2], f[3] - crop, sx, sy, f[2], f[3] - crop);
    };
    ["wall_mid", "wall_hole_1", "wall_hole_2", "wall_goo"].forEach((n, i) => {
      wdraw("wall_mid", i * SLOT_W, 0, 8);
      wdraw(n, i * SLOT_W, 8);
    });
    for (let y = 0; y < SLOT_H; y++) {
      for (let x = 0; x < SLOT_W; x++) {
        const n = hash(x, y, 91);
        wctx.fillStyle = n < 0.12 ? "#3a4058" : n < 0.3 ? "#30354a" : n > 0.94 ? "#1c2030" : "#2b3044";
        wctx.fillRect(4 * SLOT_W + x, y, 1, 1);
      }
    }
    wdraw("wall_mid", 5 * SLOT_W, 0);
    wdraw("wall_mid", 5 * SLOT_W, 8);
    wctx.globalCompositeOperation = "multiply";
    wctx.fillStyle = "#7d88b4";
    wctx.fillRect(0, 0, wc.width, wc.height);
    wctx.globalCompositeOperation = "source-over";
    const wallTex = pixTex(wc);

    const P: number[] = [];
    const N: number[] = [];
    const UV: number[] = [];
    const quad = (v: number[][], n: number[], uv: number[][]) => {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        P.push(...v[k]);
        N.push(...n);
        UV.push(...uv[k]);
      }
    };
    const sideUV = (slot: number, h: number): number[][] => {
      const u0 = (slot * SLOT_W) / wc.width;
      const u1 = ((slot + 1) * SLOT_W) / wc.width;
      const vt = h / WALL_H;
      return [
        [u0, 0],
        [u1, 0],
        [u1, vt],
        [u0, vt],
      ];
    };
    const topUV = (): number[][] => {
      const u0 = (4 * SLOT_W) / wc.width;
      const u1 = (5 * SLOT_W) / wc.width;
      const v1 = 1;
      const v0 = 1 - 16 / SLOT_H;
      return [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
    };
    const heightAt = (x: number, y: number) => {
      if (!solid(x, y)) return 0;
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (floor(x + dx, y + dy) && x + dx >= 0 && y + dy >= 0 && x + dx < MAP_W && y + dy < MAP_H) near = true;
      void near;
      // Rock on the camera side of a room (up to two tiles south of floor) is low, so it
      // never hides the floor; everything else is a solid mass at full height.
      for (let dx = -1; dx <= 1; dx++) for (let dy = 1; dy <= 2; dy++) if (y - dy >= 0 && x + dx >= 0 && x + dx < MAP_W && floor(x + dx, y - dy) && !(dx !== 0 && dy === 1 && !floor(x, y - 1) && solid(x + dx, y))) return LOW_WALL_H;
      return WALL_H;
    };
    const H: number[] = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) H.push(heightAt(x, y));
    const hAt = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? -1 : H[y * MAP_W + x]);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const h = hAt(x, y);
        if (h <= 0) continue;
        const slot = h === LOW_WALL_H ? 5 : (() => {
          const r = hash(x, y, seed + 3);
          return r < 0.05 ? 1 : r < 0.09 ? 2 : r < 0.12 ? 3 : 0;
        })();
        // Top cap
        quad(
          [
            [x, h, y + 1],
            [x + 1, h, y + 1],
            [x + 1, h, y],
            [x, h, y],
          ],
          [0, 1, 0],
          topUV(),
        );
        // Sides toward lower neighbours (floor = 0, void = -1 is skipped except at the map edge).
        const side = (nx: number, ny: number, v: number[][], n: number[]) => {
          const nh = hAt(nx, ny);
          if (nh < 0 || nh >= h) return;
          quad(v.map(([a, b, c]) => [a, b === 1 ? h : nh, c]), n, sideUV(slot, h).map(([u, vv], i) => [u, i < 2 ? nh / WALL_H : vv]));
        };
        side(x, y + 1, [[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 1, y + 1], [x, 1, y + 1]], [0, 0, 1]);
        side(x, y - 1, [[x + 1, 0, y], [x, 0, y], [x, 1, y], [x + 1, 1, y]], [0, 0, -1]);
        side(x + 1, y, [[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, 1, y], [x + 1, 1, y + 1]], [1, 0, 0]);
        side(x - 1, y, [[x, 0, y], [x, 0, y + 1], [x, 1, y + 1], [x, 1, y]], [-1, 0, 0]);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    wg.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    wg.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    const walls = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide }));
    this.scene.add(walls);

    this.buildDecor(w, seed, hAt);
    this.buildPortals(w);
    this.syncChests(w);

    // Vault door: a slab that sinks into the floor when unlocked.
    const d = w.door;
    if (d.tx || d.ty) {
      const dc = atlasFrame(img, d.open ? "doors_leaf_open" : "doors_leaf_closed", "#a8b4e0");
      const mat = new THREE.MeshLambertMaterial({ map: pixTex(dc), transparent: true, alphaTest: 0.5 });
      const geo = d.vertical ? new THREE.BoxGeometry(0.3, WALL_H, 2) : new THREE.BoxGeometry(2, WALL_H, 0.3);
      geo.translate(0, WALL_H / 2, 0);
      this.door = new THREE.Mesh(geo, mat);
      this.door.position.set(d.vertical ? d.tx + 0.5 : d.tx + 1, 0, d.vertical ? d.ty + 1 : d.ty + 0.5);
      this.scene.add(this.door);
      this.staticLights.push({ x: this.door.position.x, y: 1.2, z: this.door.position.z + 0.6, color: 0xffd65a, i: 0.8, r: 3.5 });
      if (d.open) this.door.visible = false;
    }

    const me = w.players[this.me];
    this.pred = { x: me.x, y: me.y };
    const tx = me.x * U;
    const tz = me.y * U;
    this.camTarget.set(tx, 0, tz);
    this.placeCamera(tx, tz, 0, 0);
    this.revealAround(me.x, me.y, true);
  }

  buildDecor(w: World, seed: number, hAt: (x: number, y: number) => number) {
    const img = this.atlas!;
    const floor = (x: number, y: number) => hAt(x, y) === 0;
    const colTex = pixTex(atlasFrame(img, "wall_mid", "#8a94bc"));
    const colMat = new THREE.MeshLambertMaterial({ map: colTex, emissive: 0x141a2c });
    const capMat = new THREE.MeshLambertMaterial({ map: pixTex(atlasFrame(img, "wall_top_mid", "#9aa4cc")) });
    const crateMat = new THREE.MeshLambertMaterial({ map: pixTex(atlasFrame(img, "crate")) });
    for (let i = 0; i < w.roomCount; i++) {
      const r = w.rooms[i];
      // Spirit torches on the back wall of every room, banners between them.
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        const ty = r.y - 1;
        if (hAt(x, ty) !== WALL_H || !floor(x, r.y)) continue;
        const h = hash(x, ty, seed + i);
        if ((x - r.x) % 4 === 2) this.addTorch(x + 0.5, 1.05, ty + 1.02, h);
        else if (h < 0.22 && r.kind !== ROOM.BOSS) {
          const banner = ["wall_banner_red", "wall_banner_blue", "wall_banner_blue", "wall_banner_red"][Math.floor(h * 18) % 4];
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: pixTex(atlasFrame(img, banner)), transparent: true, alphaTest: 0.5 }));
          m.position.set(x + 0.5, WALL_H - 0.55, ty + 1.01);
          this.scene.add(m);
        }
      }
      if (r.kind === ROOM.BOSS || r.kind === ROOM.ENTRANCE) {
        const red = r.kind === ROOM.BOSS;
        const xs = red ? [r.x + 1, r.x + r.w - 2] : [Math.floor(r.x + r.w / 2)];
        for (const fx of xs) {
          const ty = r.y - 1;
          if (hAt(fx, ty) !== WALL_H) continue;
          const name = red ? "wall_fountain_mid_red_anim_f0" : "wall_fountain_mid_blue_anim_f0";
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: pixTex(atlasFrame(img, name)), transparent: true, alphaTest: 0.5 }));
          m.position.set(fx + 0.5, 0.8, ty + 1.01);
          this.scene.add(m);
          this.staticLights.push({ x: fx + 0.5, y: 0.8, z: ty + 1.6, color: red ? 0xff2040 : 0x4ab0ff, i: 1.0, r: 4 });
        }
        if (!red) this.staticLights.push({ x: r.x + r.w / 2, y: 1.5, z: r.y + r.h / 2, color: 0x6ac8ff, i: 1.0, r: 6 });
      }
      // Stone pillars in big rooms.
      if (r.w >= 9 && r.h >= 7 && r.kind !== ROOM.ENTRANCE) {
        for (const [cx, cy] of [
          [r.x + 1, r.y + 2],
          [r.x + r.w - 2, r.y + 2],
          [r.x + 1, r.y + r.h - 1],
          [r.x + r.w - 2, r.y + r.h - 1],
        ]) {
          if (hash(cx, cy, seed) < 0.55) continue;
          if (!floor(cx, cy) || !floor(cx, cy - 1)) continue;
          if (w.chests.some((c) => Math.abs(c.tx - cx) <= 1 && Math.abs(c.ty - cy) <= 1)) continue;
          const g = new THREE.BoxGeometry(0.62, 1.9, 0.62);
          g.translate(0, 0.95, 0);
          const pillar = new THREE.Mesh(g, colMat);
          pillar.position.set(cx + 0.5, 0, cy + 0.5);
          const cg = new THREE.BoxGeometry(0.82, 0.18, 0.82);
          cg.translate(0, 1.95, 0);
          const cap = new THREE.Mesh(cg, capMat);
          cap.position.copy(pillar.position);
          const bg = new THREE.BoxGeometry(0.82, 0.16, 0.82);
          bg.translate(0, 0.08, 0);
          const base = new THREE.Mesh(bg, capMat);
          base.position.copy(pillar.position);
          this.scene.add(pillar, cap, base);
        }
      }
      // Crates against walls.
      const n = Math.floor(r.w * r.h * 0.06);
      for (let k = 0; k < n; k++) {
        const tx = r.x + 1 + Math.floor(hash(k, i, seed + 11) * (r.w - 2));
        const ty = r.y + 1 + Math.floor(hash(i, k, seed + 13) * (r.h - 2));
        if (!floor(tx, ty) || w.chests.some((c) => c.tx === tx && c.ty === ty)) continue;
        const h = hash(tx, ty, seed + 17);
        if (h >= 0.75 && h < 0.85 && (!floor(tx, ty - 1) || !floor(tx - 1, ty) || !floor(tx + 1, ty))) {
          const g = new THREE.BoxGeometry(0.62, 0.62, 0.62);
          g.translate(0, 0.31, 0);
          const c = new THREE.Mesh(g, crateMat);
          c.position.set(tx + 0.5, 0, ty + 0.5);
          c.rotation.y = (h - 0.8) * 2;
          this.scene.add(c);
        }
      }
    }
  }

  addTorch(x: number, y: number, z: number, seed: number) {
    const mat = new THREE.MeshBasicMaterial({ map: pixTex(this.flames[0]), transparent: true, alphaTest: 0.4, color: 0xffffff });
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), mat);
    flame.position.set(x, y + 0.28, z + 0.06);
    const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.18), new THREE.MeshLambertMaterial({ color: 0x2a2030 }));
    sconce.position.set(x, y - 0.05, z + 0.06);
    this.scene.add(flame, sconce);
    this.torches.push({ x, y: y + 0.3, z: z + 0.2, seed, flame, mat });
  }

  buildPortals(w: World) {
    for (const p of w.portals) {
      if (!p.tx && !p.ty) continue;
      const x = p.tx + 0.5;
      const z = p.ty + 0.5;
      const add = (tex: THREE.Texture, size: number, y: number, color: number, flat: boolean) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        if (flat) m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, z);
        this.scene.add(m);
        return m;
      };
      const ring = add(this.tex.rune, 3.2, 0.03, 0x3a4a6a, true);
      const inner = add(this.tex.ring, 2.0, 0.04, 0x2a3450, true);
      const swirl = add(this.tex.glow, 1.6, 1.1, 0x9fe0ff, false);
      const swirl2 = add(this.tex.ring, 1.3, 1.1, 0xffffff, false);
      const pg = new THREE.CylinderGeometry(0.9, 0.9, 3.2, 16, 1, true);
      pg.translate(0, 1.6, 0);
      const pillar = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: this.tex.beam, color: 0x9fe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      pillar.position.set(x, 0, z);
      this.scene.add(pillar);
      this.portals.push({ x, z, ring, inner, swirl, swirl2, pillar });
    }
  }

  /** Pixel textures for a chest: wood planks with metal bands, tinted per tier. */
  chestTextures(tier: number) {
    const pal =
      tier === CHEST.GOLD
        ? { wood: ["#4a2a18", "#5e3820", "#3a2012"], band: ["#ffd65a", "#c9963a", "#7a5418"] }
        : tier === CHEST.VAULT
          ? { wood: ["#2e1f48", "#3c2a5e", "#22163a"], band: ["#e0c0ff", "#b46bff", "#6a3aa0"] }
          : tier === CHEST.BOSS
            ? { wood: ["#4a0e18", "#5e1422", "#360a12"], band: ["#ffd65a", "#e0283c", "#7a1020"] }
            : { wood: ["#5a3a22", "#6e4a2c", "#422816"], band: ["#b8c0d8", "#7a849c", "#3a4054"] };
    const face = (front: boolean, top: boolean) => {
      const c = canvas(16, 16);
      const ctx = c.getContext("2d")!;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const plank = top ? Math.floor(x / 4) : Math.floor(y / 4);
          const seam = top ? x % 4 === 3 : y % 4 === 3;
          const n = hash(x, y, tier * 7 + plank);
          ctx.fillStyle = seam ? pal.wood[2] : n < 0.15 ? pal.wood[1] : n > 0.9 ? pal.wood[2] : pal.wood[0];
          ctx.fillRect(x, y, 1, 1);
        }
      }
      for (const bx of [1, 2, 13, 14]) {
        ctx.fillStyle = bx === 1 || bx === 13 ? pal.band[0] : pal.band[1];
        ctx.fillRect(bx, 0, 1, 16);
      }
      ctx.fillStyle = pal.band[2];
      ctx.fillRect(0, 0, 16, 1);
      ctx.fillRect(0, 15, 16, 1);
      ctx.fillRect(0, 0, 1, 16);
      ctx.fillRect(15, 0, 1, 16);
      if (front) {
        ctx.fillStyle = pal.band[2];
        ctx.fillRect(6, 1, 4, 6);
        ctx.fillStyle = pal.band[0];
        ctx.fillRect(6, 1, 4, 5);
        ctx.fillStyle = pal.band[1];
        ctx.fillRect(7, 3, 2, 2);
        ctx.fillStyle = "#0b0b12";
        ctx.fillRect(7, 4, 2, 1);
      }
      return pixTex(c);
    };
    return { side: face(false, false), front: face(true, false), top: face(false, true) };
  }

  makeChest(tier: number, open: boolean, x: number, z: number): ChestView {
    const t = this.chestTextures(tier);
    const s = tier === CHEST.BOSS ? 1.35 : 1;
    const W = 0.86 * s;
    const D = 0.6 * s;
    const BH = 0.46 * s;
    const LH = 0.22 * s;
    const lam = (m: THREE.Texture) => new THREE.MeshLambertMaterial({ map: m, emissive: 0x0c0a14 });
    const inside = new THREE.MeshBasicMaterial({ color: 0x0a0608 });
    // Body: box with a dark interior top; the front face carries the lock.
    const bg = new THREE.BoxGeometry(W, BH, D);
    bg.translate(0, BH / 2, 0);
    const body = new THREE.Mesh(bg, [lam(t.side), lam(t.side), inside, lam(t.side), lam(t.front), lam(t.side)]);
    // Lid hinged on the back edge.
    const lid = new THREE.Group();
    lid.position.set(0, BH, -D / 2);
    const lg = new THREE.BoxGeometry(W * 1.04, LH, D * 1.04);
    lg.translate(0, LH / 2, D / 2);
    const lidMesh = new THREE.Mesh(lg, [lam(t.side), lam(t.side), lam(t.top), inside, lam(t.side), lam(t.side)]);
    lid.add(lidMesh);
    // Treasure glow inside, visible once the lid lifts.
    const col = tier === CHEST.NORMAL ? 0xffc860 : tier === CHEST.GOLD ? 0xffd65a : tier === CHEST.VAULT ? 0xc08bff : 0xff5060;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, D * 0.9), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = BH + 0.01;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.add(body, lid, glow, this.shadowMesh(1.3 * s));
    this.scene.add(root);
    if (open) {
      lid.rotation.x = -1.95;
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.3;
    }
    return { root, lid, glow, state: open ? CHEST_STATE.OPEN : CHEST_STATE.CLOSED, tier, openAt: open ? 1 : 0, x, z };
  }

  syncChests(w: World) {
    if (!this.atlas) return;
    w.chests.forEach((c, i) => {
      if (!c.tx && !c.ty) return;
      let v = this.chests[i];
      const x = c.tx + 0.5;
      const z = c.ty + 0.5;
      if (!v) {
        v = this.makeChest(c.tier, c.state === CHEST_STATE.OPEN, x, z);
        v.state = c.state;
        this.chests[i] = v;
      }
      if (v.state !== c.state) {
        const near = this.near(c.tx * TILE, c.ty * TILE, 12);
        if (c.state === CHEST_STATE.PENDING && near) sfx.chestCreak();
        if (c.state === CHEST_STATE.OPEN) {
          v.openAt = performance.now();
          this.burst(x, 0.6, z, c.tier === CHEST.NORMAL ? 0xffd27a : 0xd0a0ff, 30, 3);
          this.flashLight(x, 1, z, c.tier === CHEST.NORMAL ? 0xffd27a : 0xd0a0ff, 2.2, 5, 600);
          if (near) sfx.chestOpen();
        }
        v.state = c.state;
      }
    });
  }

  shadowMesh(size: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.6), new THREE.MeshBasicMaterial({ map: this.tex.shadow, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = 1;
    return m;
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

  focus() {
    return this.camTarget;
  }

  pan(x: number) {
    return clamp((x * U - this.camTarget.x) / 10, -1, 1);
  }

  /** Is a world-unit position within `r` tiles of the camera focus? */
  near(x: number, y: number, r = 16) {
    return Math.abs(x * U - this.camTarget.x) < r && Math.abs(y * U - this.camTarget.z) < r;
  }

  cameraShake(ms: number, amp: number) {
    const now = performance.now();
    if (now + ms > this.shake.until || amp > this.shake.amp) {
      this.shake = { until: now + ms, amp: Math.max(amp, now < this.shake.until ? this.shake.amp : 0), dur: ms };
    }
  }

  screenFlash(color: string, alpha: number, ms: number) {
    const el = this.flashEl;
    el.style.background = color;
    el.style.transition = "none";
    el.style.opacity = String(alpha);
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms ease-out`;
      el.style.opacity = "0";
    });
  }

  onEvent(e: World["events"][number], w: World, prev: World | null) {
    void prev;
    const me = this.me;
    const X = e.x * U;
    const Z = e.y * U;
    const pan = this.pan(e.x);
    const audible = this.near(e.x, e.y, 13);
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
        this.dmgNumber(X, 1.2, Z, e.c, mine ? "#ffe066" : "#e8e0d0", mine ? 1.15 : 0.9);
        this.burst(X, 0.6, Z, w.monsters[e.a]?.kind === MON.IMP ? 0xb04aff : 0xeae2c8, mine ? 8 : 4, 3, false);
        if (mine) {
          sfx.hit(pan);
          if (w.players[me].cls !== CLASS_ARCANIST) this.hitStop = performance.now() + 55;
          this.cameraShake(60, 0.05);
        } else if (audible) sfx.hit(pan * 0.5);
        break;
      }
      case EV.HIT_PLAYER: {
        const mine = e.a === me;
        this.dmgNumber(X, 1.6, Z, e.c, mine ? "#ff4d5e" : "#ff9a5a", mine ? 1.2 : 0.9);
        this.burst(X, 0.7, Z, 0xc01830, mine ? 14 : 6, 3, false);
        const v = this.players[e.a];
        if (v) v.flashUntil = performance.now() + 90;
        if (mine) {
          sfx.hurt();
          this.cameraShake(140, 0.14);
          this.hurtEl.style.transition = "none";
          this.hurtEl.style.opacity = "0.55";
          requestAnimationFrame(() => {
            this.hurtEl.style.transition = "opacity 380ms ease-out";
            this.hurtEl.style.opacity = "0";
          });
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
        this.purify(X, Z, kind === MON.KING ? 90 : kind === MON.BRUTE ? 44 : 24, kind === MON.KING || kind === MON.BRUTE ? 1.6 : 1);
        if (kind === MON.KING) {
          sfx.gong();
          this.cameraShake(700, 0.3);
          this.screenFlash("#ff5050", 0.6, 300);
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
        this.burst(X, 0.8, Z, 0xb01020, 40, 4.5, false);
        if (e.a === me) {
          let best = 1e9;
          for (const p of w.portals) if (p.tx || p.ty) best = Math.min(best, Math.hypot(p.tx * TILE + 128 - e.x, p.ty * TILE + 128 - e.y));
          hud.set({ death: { lost: this.lastLoot, portalTiles: Math.round(best / TILE), portalsOpen: portalsOpen(w) } });
          sfx.playerDie();
          this.cameraShake(400, 0.25);
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
      case EV.LOOT: {
        const mineChest = e.a < w.chests.length && w.chests[e.a].opener === me;
        if (e.c >= 4 && (audible || mineChest)) {
          sfx.legendary();
          this.screenFlash("#ffb040", 0.35, 400);
          hud.toast({ title: "LEGENDARY DROP", sub: ITEM_NAMES[e.b], color: RARITY_CSS[4], big: true }, 2800);
        } else if (e.c >= 4) {
          hud.feed(`A <b style="color:${RARITY_CSS[4]}">legendary ${ITEM_NAMES[e.b]}</b> was found somewhere in the crypt…`);
        } else if (e.c === 3 && audible) sfx.pickup(3);
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
        this.extractBeam(X, Z);
        const p = w.players[e.a];
        hud.feed(`${this.pname(e.a, w)} <b style="color:#9fe0ff">crossed over</b> with <b style="color:#ffcf5a">${p.banked}</b>`);
        if (e.a === me) hud.toast({ title: "CROSSED OVER", sub: `${p.banked} soul value banked`, color: "#c9a2ff", big: true }, 3500);
        break;
      }
      case EV.DOOR:
        sfx.door();
        this.cameraShake(200, 0.1);
        hud.feed(`${this.pname(e.a, w)} unlocked the <b style="color:#ffd65a">Vault</b>`);
        break;
      case EV.ELITES:
        sfx.alarm();
        hud.toast({ title: "GREAT HOLLOWS RISE", sub: "Their spiritual pressure fills the halls", color: "#ff9a3a", big: true }, 3000);
        break;
      case EV.PORTALS:
        sfx.gong();
        this.screenFlash("#9a5aff", 0.5, 400);
        hud.toast({ title: "THE SPIRIT GATES OPEN", sub: "Reach a gate and hold to cross over", color: "#b98bff", big: true }, 3500);
        break;
      case EV.WAVE:
        hud.feed(`<b style="color:#c06bff">Corruption wave ${e.a}</b> — imps spill from the walls`);
        break;
      case EV.COLLAPSE:
        sfx.boom();
        this.cameraShake(1200, 0.4);
        hud.toast({ title: "THE GATES SEAL FOREVER", color: "#ff3046", big: true }, 4000);
        break;
      case EV.BLINK: {
        const p = w.players[e.a];
        this.trail(X, Z, p.x * U, p.y * U, 0x9a7cff);
        if (e.a === me) {
          sfx.blink();
          this.snapNext = true;
        }
        break;
      }
      case EV.SHIELD: {
        if (e.a === me) sfx.shield();
        this.groundRing(X, Z, 0x6ac8ff, 0.3, 2.2, 380, 0.9);
        this.flashLight(X, 1, Z, 0x6ac8ff, 1.6, 4, 400);
        break;
      }
      case EV.DODGE:
        if (e.a !== me && audible) sfx.dodge();
        this.burst(X, 0.15, Z, 0x8a8aa0, 8, 1.6, false);
        break;
      case EV.BOOM: {
        sfx.boom(pan);
        this.explosion(X, Z);
        if (this.near(e.x, e.y, 8)) this.cameraShake(220, 0.18);
        break;
      }
      case EV.SLAM: {
        if (audible) sfx.slam(pan);
        const r = e.b === MON.KING ? 5.5 : 4;
        this.groundRing(X, Z, 0xff4040, 0.3, r, 420, 1);
        this.burst(X, 0.2, Z, 0x6a5a70, 26, 4, false);
        if (this.near(e.x, e.y, 8)) this.cameraShake(260, e.b === MON.KING ? 0.3 : 0.18);
        break;
      }
      case EV.WINDUP: {
        const v = this.monsters[e.a];
        if (v) v.bang = true;
        if (audible && e.b === me) sfx.windup(pan);
        break;
      }
      case EV.POTION:
        if (e.a === me) sfx.potion();
        this.burst(X, 1, Z, 0x50ff7a, 18, 2);
        this.flashLight(X, 1, Z, 0x50ff7a, 1.2, 3, 400);
        break;
      case EV.SPAWN:
        this.burst(X, 0.6, Z, e.b === MON.IMP ? 0x9a3aff : 0x6a3aaa, 20, 2.5);
        break;
      case EV.ATTACK: {
        if (e.a === me) break;
        const v = this.players[e.a];
        if (v) {
          v.swingUntil = performance.now() + 160;
          v.swingDir *= -1;
        }
        if (e.c === CLASS_ARCANIST) audible && sfx.bolt(pan);
        else if (e.c === 10) audible && sfx.fireball(pan);
        else if (audible) (e.c === CLASS_ROGUE ? sfx.stab(pan) : sfx.swing(pan));
        if (e.c !== CLASS_ARCANIST && e.c !== 10) this.slashFx(X, Z, e.b, e.c);
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

  burst(x: number, y: number, z: number, color: number, n = 10, speed = 2.5, glow = true) {
    const ps = glow ? this.sparks : this.debris;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      ps.emit(x, y, z, Math.cos(a) * s, 1 + Math.random() * speed, Math.sin(a) * s, 0.3 + Math.random() * 0.4, color, 0.07 + Math.random() * 0.05, 9);
    }
  }

  /** Spirit particles rising: a Hollow dissolving into reishi. */
  purify(x: number, z: number, n: number, big = 1) {
    for (let i = 0; i < n; i++) {
      const c = [0xffffff, 0x9fe0ff, 0x4aa8e8][i % 3];
      ps(this.sparks, x + (Math.random() - 0.5) * 0.7 * big, 0.3 + Math.random() * 1.2 * big, z + (Math.random() - 0.5) * 0.5 * big, (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 2.2, (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.7, c, 0.09, -0.4);
    }
    this.groundRing(x, z, 0x9fe0ff, 0.3, 2.4 * big, 400, 0.9);
    this.flashLight(x, 1, z, 0x9fe0ff, 2.5, 5 * big, 600);
    function ps(p: Particles, ...a: Parameters<Particles["emit"]>) {
      p.emit(...a);
    }
  }

  explosion(x: number, z: number) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 4.5;
      this.sparks.emit(x, 0.6, z, Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s, 0.3 + Math.random() * 0.4, [0xffffff, 0x9fe0ff, 0x3a8ae0][i % 3], 0.12, 4);
    }
    this.groundRing(x, z, 0x9fe0ff, 0.3, 3.6, 350, 1);
    this.sphereFlash(x, 0.6, z, 0x9fe0ff, 1.8, 420);
    this.flashLight(x, 1, z, 0x7ad0ff, 4, 7, 450);
  }

  extractBeam(x: number, z: number) {
    const g = new THREE.CylinderGeometry(0.55, 0.55, 12, 12, 1, true);
    g.translate(0, 6, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.tex.beam, color: 0xcfeeff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, 0, z);
    m.scale.set(1, 0.05, 1);
    this.scene.add(m);
    const t0 = performance.now();
    this.fx.push({
      update: (now) => {
        const t = (now - t0) / 1200;
        m.scale.y = Math.min(1, t * 4);
        m.scale.x = m.scale.z = 1 + t * 0.6;
        (m.material as THREE.MeshBasicMaterial).opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
        if (t >= 1) {
          this.scene.remove(m);
          g.dispose();
          return false;
        }
        return true;
      },
    });
    this.burst(x, 0.8, z, 0xd8b8ff, 50, 3.5);
    this.flashLight(x, 2, z, 0xcfeeff, 4, 8, 900);
  }

  trail(x0: number, z0: number, x1: number, z1: number, color: number) {
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      this.sparks.emit(lerp(x0, x1, t), 0.7 + Math.random() * 0.4, lerp(z0, z1, t), 0, 0.3, 0, 0.25 + t * 0.25, color, 0.14, 0);
    }
  }

  slashFx(x: number, z: number, aim: number, cls: number) {
    const a = angleRad(aim);
    const r = cls === CLASS_VANGUARD ? 0.95 : 0.65;
    const size = cls === CLASS_VANGUARD ? 1.9 : 1.2;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: this.tex.slash, color: cls === CLASS_ROGUE ? 0xffffff : 0xbfe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -a;
    m.position.set(x + Math.cos(a) * r, 0.55, z + Math.sin(a) * r);
    this.scene.add(m);
    const t0 = performance.now();
    this.fx.push({
      update: (now) => {
        const t = (now - t0) / 170;
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        m.scale.setScalar(1 + t * 0.3);
        if (t >= 1) {
          this.scene.remove(m);
          m.geometry.dispose();
          return false;
        }
        return true;
      },
    });
  }

  groundRing(x: number, z: number, color: number, r0: number, r1: number, ms: number, alpha: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.05, z);
    this.scene.add(m);
    const t0 = performance.now();
    this.fx.push({
      update: (now) => {
        const t = (now - t0) / ms;
        const r = lerp(r0, r1, 1 - Math.pow(1 - Math.min(1, t), 2));
        m.scale.set(r, r, 1);
        (m.material as THREE.MeshBasicMaterial).opacity = alpha * (1 - t);
        if (t >= 1) {
          this.scene.remove(m);
          m.geometry.dispose();
          return false;
        }
        return true;
      },
    });
  }

  sphereFlash(x: number, y: number, z: number, color: number, r: number, ms: number) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    const t0 = performance.now();
    this.fx.push({
      update: (now) => {
        const t = (now - t0) / ms;
        m.scale.setScalar(0.2 + t * r);
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        if (t >= 1) {
          this.scene.remove(m);
          m.geometry.dispose();
          return false;
        }
        return true;
      },
    });
  }

  flashLight(x: number, y: number, z: number, color: number, i: number, r: number, ms: number) {
    const now = performance.now();
    this.dyn.push({ x, y, z, color, i, r, born: now, until: now + ms });
  }

  dmgNumber(x: number, y: number, z: number, n: number, color: string, scale = 1) {
    this.dmgTexts.push({ text: String(n), color, scale, x: x + (Math.random() - 0.5) * 0.4, y, z, born: performance.now() });
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
    const now = performance.now();
    if (!p || now < this.nextAtk || hud.get().paused) return;
    this.nextAtk = now + CLASSES[p.cls].atkCd * 100;
    this.session.combat(0, this.aim);
    const v = this.players[this.me];
    if (v) {
      v.swingUntil = now + 160;
      v.swingDir *= -1;
    }
    if (p.cls === CLASS_ARCANIST) sfx.bolt();
    else if (p.cls === CLASS_ROGUE) sfx.stab();
    else sfx.swing();
    if (p.cls !== CLASS_ARCANIST && this.pred) this.slashFx(this.pred.x * U, this.pred.y * U, this.aim, p.cls);
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
    this.dodgeUntil = performance.now() + 300;
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
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return [x, y];
  }

  /** Mouse → point on the floor plane (tiles). */
  pointerGround(): THREE.Vector3 | null {
    const nx = (this.mouse.x / VIEW_W) * 2 - 1;
    const ny = -((this.mouse.y / VIEW_H) * 2 - 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const out = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
    return ray.ray.intersectPlane(plane, out);
  }

  placeCamera(tx: number, tz: number, ox: number, oz: number) {
    const dist = CAM_DIST;
    this.camera.position.set(tx + ox, Math.sin(CAM_PITCH) * dist, tz + Math.cos(CAM_PITCH) * dist + oz);
    this.camera.lookAt(tx + ox, 0, tz + oz);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  loop = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const delta = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    try {
      this.update(now, delta);
    } catch (err) {
      console.error(err);
    }
  };

  update(time: number, delta: number) {
    const w = this.world;
    const dt = delta / 1000;
    if (!w || !this.built) {
      this.composer.render();
      return;
    }
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
    const t = span > 0 ? clamp((rt - a.at) / span, 0, 1) : 1;
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
      const err = Math.hypot(meP.x - this.pred.x, meP.y - this.pred.y);
      if (this.snapNext || err > TILE * 2.5) {
        if (!(this.snapNext && err < 2)) {
          this.pred.x = meP.x;
          this.pred.y = meP.y;
          this.snapNext = false;
        }
      } else if (!mx && !my && !dodging && err > 24) {
        this.pred.x = lerp(this.pred.x, meP.x, 0.08);
        this.pred.y = lerp(this.pred.y, meP.y, 0.08);
      }
      const gp = this.pointerGround();
      if (gp) this.aim = radToByte(Math.atan2(gp.z - this.pred.y * U, gp.x - this.pred.x * U));
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
      if (this.atkHeld && this.mouse.left) this.doAttack();
    }

    // --- Camera ---
    let fx: number, fz: number;
    if (meP.state === PS.ALIVE && this.pred) {
      fx = this.pred.x * U;
      fz = this.pred.y * U;
      const lx = (this.mouse.x - VIEW_W / 2) / VIEW_W;
      const ly = (this.mouse.y - VIEW_H / 2) / VIEW_H;
      fx += lx * 3.2;
      fz += ly * 2.4;
    } else {
      const alive = w.players.findIndex((p) => p.state === PS.ALIVE);
      const target = alive >= 0 ? w.players[alive] : meP;
      fx = target.x * U;
      fz = target.y * U;
    }
    const k = 1 - Math.pow(0.0008, dt);
    this.camTarget.x = lerp(this.camTarget.x, fx, k);
    this.camTarget.z = lerp(this.camTarget.z, fz, k);
    let sx = 0;
    let sz = 0;
    if (time < this.shake.until) {
      const f = (this.shake.until - time) / this.shake.dur;
      sx = (Math.random() - 0.5) * 2 * this.shake.amp * f;
      sz = (Math.random() - 0.5) * 2 * this.shake.amp * f;
    }
    this.placeCamera(this.camTarget.x, this.camTarget.z, sx, sz);
    this.camera.updateMatrixWorld();

    // --- Lights (gathered before sprites so they can be CPU-lit) ---
    this.gatherLights(w, time);

    // --- Entities ---
    this.renderPlayers(A, B, t, time);
    this.renderMonsters(A, B, t, time);
    this.renderProjectiles(A, B, t, time);
    this.renderDrops(w, time);
    this.renderChests(time);
    this.renderPortals(w, time);
    this.renderTorches(time);
    this.renderTelegraphs(B, time);
    this.ambientMotes(dt);
    if (this.door && this.doorOpenAt) {
      const f = Math.min(1, (performance.now() - this.doorOpenAt) / 700);
      this.door.position.y = -WALL_H * f;
      if (f >= 1) this.door.visible = false;
    }

    this.fx = this.fx.filter((f) => f.update(performance.now()));
    this.sparks.update(dt);
    this.debris.update(dt);

    if (time - this.lastFog > 120) {
      this.lastFog = time;
      const src = meP.state === PS.ALIVE && this.pred ? this.pred : meP;
      this.revealAround(src.x, src.y);
    }

    // --- Grading ---
    const corr = corruption(w) / 100;
    sfx.setTension(corr);
    const timeLeft = w.collapseTick - w.tick;
    const pulse = timeLeft < 300 && w.phase === PHASE.RUNNING ? (Math.sin(time / 180) * 0.5 + 0.5) * 0.18 : 0;
    const low = meP.state === PS.ALIVE && meP.hp < meP.maxHp * 0.3 ? (Math.sin(time / 140) * 0.5 + 0.5) * 0.12 : 0;
    this.tintEl.style.opacity = (corr * 0.1 + pulse + low).toFixed(3);
    const filter = `saturate(${(0.95 - corr * 0.35).toFixed(2)}) contrast(1.06)`;
    if (filter !== this.lastFilter) {
      this.lastFilter = filter;
      this.renderer.domElement.style.filter = filter;
    }
    this.ambient.intensity = 0.7 - corr * 0.3;

    this.composer.render();
    this.renderOverlay(B, time);

    // Countdown beeps
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
    if (portalsOpen(w) && this.pred) {
      let best = 9999;
      for (const p of this.portals) best = Math.min(best, Math.hypot(p.x - this.pred.x * U, p.z - this.pred.y * U));
      sfx.setHum(clamp(1 - best / 9, 0, 1));
    }
    if (time - this.lastHud > 100) {
      this.lastHud = time;
      this.pushHud(w);
    }
    if (time - this.lastMinimap > 200) {
      this.lastMinimap = time;
      this.drawMinimap(w);
    }
    const done = meP.state === PS.DEAD || meP.state === PS.EXTRACTED || w.phase === PHASE.ENDED;
    if (done && !this.endNotified) {
      if (!this.endTimer) this.endTimer = time + (meP.state === PS.EXTRACTED ? 2200 : 2800);
      if (time > this.endTimer || w.phase === PHASE.ENDED) {
        this.endNotified = true;
        this.hooks.onEnd(w, this.me);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lighting
  // ---------------------------------------------------------------------------

  gatherLights(w: World, time: number) {
    const corr = corruption(w) / 100;
    const L: LightSrc[] = [...this.staticLights];
    for (let i = 0; i < 4; i++) {
      const p = w.players[i];
      if (p.state !== PS.ALIVE) continue;
      const pos = i === this.me && this.pred ? this.pred : p;
      const mine = i === this.me;
      L.push({ x: pos.x * U, y: 2.2, z: pos.y * U + 0.9, color: mine ? 0xcfe4ff : PLAYER_COLORS[i], i: (mine ? 2.6 : 1.3) * (1 - corr * 0.3) * (1 + Math.sin(time / 120 + i) * 0.03), r: mine ? 8.5 : 5 });
    }
    for (const t of this.torches) {
      const f = 0.85 + Math.sin(time / 90 + t.seed * 20) * 0.08 + Math.sin(time / 37 + t.seed * 7) * 0.05;
      L.push({ x: t.x, y: t.y, z: t.z + 0.3, color: 0x4aa8ff, i: 1.5 * f, r: 5.5 });
    }
    const open = portalsOpen(w);
    for (const p of this.portals) L.push({ x: p.x, y: 1.2, z: p.z, color: open ? 0xa8e4ff : 0x4a5a8a, i: open ? 2.8 : 0.7, r: open ? 8 : 3.5 });
    for (const d of this.drops) if (d && d.rarity >= 2) L.push({ x: d.x, y: 0.8, z: d.z, color: d.col, i: 0.6 + d.rarity * 0.2, r: 2.5 });
    for (const c of w.chests) if ((c.tx || c.ty) && c.tier !== CHEST.NORMAL && c.state !== CHEST_STATE.OPEN) L.push({ x: c.tx + 0.5, y: 0.9, z: c.ty + 0.9, color: c.tier === CHEST.GOLD ? 0xffc040 : c.tier === CHEST.VAULT ? 0xb46bff : 0xff3050, i: 0.8, r: 2.6 });
    for (const p of this.projs) if (p) L.push({ x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, color: p.col, i: p.kind === PROJ.FIREBALL ? 2.4 : 1.1, r: p.kind === PROJ.FIREBALL ? 5 : 2.8 });
    const now = performance.now();
    this.dyn = this.dyn.filter((d) => d.until > now);
    for (const d of this.dyn) {
      const f = 1 - (now - d.born) / (d.until - d.born);
      L.push({ x: d.x, y: d.y, z: d.z, color: d.color, i: d.i * f, r: d.r });
    }
    // Pick the strongest lights near the focus for the GPU pool.
    const cx = this.camTarget.x;
    const cz = this.camTarget.z;
    const scored = L.map((l) => ({ l, s: l.i / (1 + Math.hypot(l.x - cx, l.z - cz) * 0.25) })).filter((o) => Math.abs(o.l.x - cx) < 16 && Math.abs(o.l.z - cz) < 12);
    scored.sort((p, q) => q.s - p.s);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const pl = this.pool[i];
      const o = scored[i];
      if (!o) {
        pl.intensity = 0;
        continue;
      }
      pl.position.set(o.l.x, o.l.y, o.l.z);
      pl.color.setHex(o.l.color);
      pl.intensity = o.l.i * 3;
      pl.distance = o.l.r;
    }
    this.frameLights = L;
  }

  /** CPU light estimate for billboards (they face the camera, so GPU lambert would be flat). */
  lightAt(x: number, z: number, out: THREE.Color, base = 0.16) {
    let r = base * 0.75;
    let g = base * 0.82;
    let b = base * 1.15;
    for (const l of this.frameLights) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d >= l.r) continue;
      const f = Math.pow(1 - d / l.r, 1.8) * l.i * 0.42;
      const c = (l.color >>> 0) & 0xffffff;
      r += ((c >> 16) / 255) * f;
      g += (((c >> 8) & 255) / 255) * f;
      b += ((c & 255) / 255) * f;
    }
    const m = Math.max(r, g, b);
    if (m > 1.0) {
      r /= m;
      g /= m;
      b /= m;
    }
    out.setRGB(r, g, b);
    return Math.max(r, g, b);
  }

  // ---------------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------------

  makeEnt(frames: HTMLCanvasElement[], scale: number, shadow: number): Ent {
    const root = new THREE.Group();
    const bb = new THREE.Group();
    const body = billboard(frames[0], scale);
    bb.add(body);
    const sh = this.shadowMesh(shadow);
    root.add(sh, bb);
    this.scene.add(root);
    return { root, bb, body, mat: body.material as SpriteMat, shadow: sh, frames, frame: 0 };
  }

  setFrame(e: Ent, i: number) {
    if (e.frame === i) return;
    e.frame = i;
    e.mat.uniforms.map.value = pixTex(e.frames[i]);
  }

  faceCamera(e: { bb: THREE.Group }) {
    e.bb.scale.y = BB_K;
  }

  toScreen(x: number, y: number, z: number): [number, number, boolean] {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [((v.x + 1) / 2) * VIEW_W, ((1 - v.y) / 2) * VIEW_H, v.z < 1];
  }

  renderPlayers(A: World, B: World, t: number, time: number) {
    const tmp = new THREE.Color();
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
      const X = x * U;
      const Z = y * U;
      const moved = Math.hypot(X - v.lastX, Z - v.lastY) > 0.003;
      v.lastX = X;
      v.lastY = Z;
      const alive = p.state === PS.ALIVE;
      v.root.position.set(X, 0, Z);
      this.faceCamera(v);
      if (alive) {
        const f = moved ? 2 + (Math.floor(time / 90) % 4) : Math.floor(time / 330) % 2;
        this.setFrame(v, f);
      }
      const aim = i === this.me ? this.aim : p.aim;
      const ar = angleRad(aim);
      const faceLeft = Math.cos(ar) < -0.1;
      v.body.scale.x = faceLeft ? -1 : 1;
      // Weapon in the hand, swinging on attack (screen-space rotation).
      const swinging = time < v.swingUntil;
      let wr: number;
      const hand = 0.62 * SPRITE_SCALE;
      if (p.cls === CLASS_ARCANIST) {
        wr = ar + Math.PI / 2 + (swinging ? -0.4 : 0);
        v.weapon.position.set(Math.cos(ar) * 0.36, hand - Math.sin(ar) * 0.12, Math.sin(ar) < 0 ? -0.02 : 0.02);
      } else {
        const sw = swinging ? (1 - (v.swingUntil - time) / 160) * 2.2 - 1.1 : -0.55;
        wr = ar + Math.PI / 2 + sw * v.swingDir;
        v.weapon.position.set(Math.cos(ar) * 0.3, hand - Math.sin(ar) * 0.1, Math.sin(ar) < 0 ? -0.02 : 0.02);
      }
      v.weapon.rotation.z = -wr;
      v.weapon.visible = alive;
      const shield = alive && B.tick <= p.shieldUntil;
      const invuln = alive && B.tick <= p.invulnUntil;
      v.aura.visible = shield;
      if (shield) {
        (v.aura.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time / 80) * 0.2;
        v.aura.rotation.z = time / 300;
      }
      v.ring.visible = alive;
      // Light + states
      const lum = this.lightAt(X, Z + 0.4, tmp, i === this.me ? 0.45 : 0.2);
      v.lit = i === this.me || lum > 0.35;
      v.mat.uniforms.tint.value.copy(tmp);
      (v.weapon.material as SpriteMat).uniforms.tint.value.copy(tmp);
      v.mat.uniforms.opacity.value = invuln ? 0.55 : 1;
      v.mat.uniforms.flash.value = alive && performance.now() < v.flashUntil ? 1 : 0;
      if (v.state !== p.state) {
        v.state = p.state;
        if (p.state === PS.DEAD) {
          v.deadAt = time;
          this.setFrame(v, 0);
          v.weapon.visible = false;
          // A grave marker where the reaper fell.
          const sk = billboard(atlasFrame(this.atlas!, "skull"), 0.8);
          sk.position.set(0.3, 0, 0.1);
          v.bb.add(sk);
        }
      }
      if (p.state === PS.DEAD) {
        const f = Math.min(1, (time - v.deadAt) / 350);
        v.body.rotation.z = (faceLeft ? 1 : -1) * (Math.PI / 2) * f;
        v.mat.uniforms.tint.value.multiplyScalar(0.55);
      }
      if (p.state === PS.EXTRACTED) {
        v.root.position.y = Math.min(3, (v.root.position.y || 0) + 0.06);
        v.mat.uniforms.opacity.value = 0.5;
        v.weapon.visible = false;
        v.shadow.visible = false;
        v.ring.visible = false;
      }
      const [sx, sy] = this.toScreen(X, 1.6 * SPRITE_SCALE * BB_K, Z);
      v.sx = sx;
      v.sy = sy;
    }
  }

  makePlayer(i: number, p: Player): PlayerView {
    const e = this.makeEnt(heroFrames(p.cls), 1, 0.85);
    const wc = p.cls === CLASS_VANGUARD ? bladeTexture() : atlasFrame(this.atlas!, p.cls === CLASS_ARCANIST ? "weapon_green_magic_staff" : "weapon_katana", p.cls === CLASS_ARCANIST ? "#9fe0ff" : undefined);
    const pc = new THREE.Color(PLAYER_COLORS[i]);
    e.mat.uniforms.outline.value.set(pc.r, pc.g, pc.b, i === this.me ? 0.35 : 0.6);
    const weapon = billboard(wc, p.cls === CLASS_VANGUARD ? 1 : 0.7, 0.08);
    e.bb.add(weapon);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: this.tex.ring, color: PLAYER_COLORS[i], transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    e.root.add(ring);
    const aura = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: this.tex.rune, color: 0x6ac8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.position.set(0, 0.9, 0.05);
    aura.visible = false;
    e.bb.add(aura);
    const v: PlayerView = { ...e, weapon, ring, aura, cls: p.cls, state: p.state, flashUntil: 0, swingUntil: 0, swingDir: 1, lastX: 0, lastY: 0, deadAt: 0, sx: 0, sy: 0, lit: true };
    this.players[i] = v;
    return v;
  }

  destroyPlayer(i: number) {
    const v = this.players[i];
    if (!v) return;
    this.scene.remove(v.root);
    this.players[i] = null;
  }

  renderMonsters(A: World, B: World, t: number, time: number) {
    const frozen = performance.now() < this.hitStop;
    const tmp = new THREE.Color();
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
        v = this.makeMonster(i, m.kind, !!m.elite, m.hp === 0);
      }
      this.faceCamera(v);
      if (v.dead) {
        const f = Math.min(1, (time - v.deadAt) / 450);
        v.body.scale.y = 1 - f * 0.85;
        v.body.scale.x = Math.sign(v.body.scale.x || 1) * (1 + f * 0.3);
        v.mat.uniforms.flash.value = 1 - f * 0.3;
        v.mat.uniforms.opacity.value = 1 - f;
        v.root.visible = f < 1;
        continue;
      }
      if (m.hp === 0) {
        v.dead = true;
        v.deadAt = time;
        v.bang = false;
        continue;
      }
      if (frozen) continue;
      const same = ma.kind === m.kind;
      const X = (same ? lerp(ma.x, m.x, t) : m.x) * U;
      const Z = (same ? lerp(ma.y, m.y, t) : m.y) * U;
      const moving = Math.abs(ma.x - m.x) + Math.abs(ma.y - m.y) > 2;
      this.setFrame(v, Math.floor(time / (moving ? 125 : 330)) % 2);
      const ar = angleRad(m.aim);
      v.body.scale.x = Math.cos(ar) < 0 ? -1 : 1;
      const windup = m.state === MS.WINDUP;
      const shake = windup ? Math.sin(time / 18) * 0.05 : 0;
      v.root.position.set(X + shake, 0, Z);
      // Floating Hollows bob; the King looms.
      v.body.position.y = m.kind === MON.NECRO || m.kind === MON.IMP ? 0.12 + Math.sin(time / 260 + i) * 0.08 : 0;
      const lum = this.lightAt(X, Z + 0.3, tmp, 0.5);
      v.lit = lum > 0.62 || Math.hypot(X - this.camTarget.x, Z - this.camTarget.z) < 7;
      if (windup) tmp.lerp(new THREE.Color(1, 0.35, 0.35), 0.6);
      else if (B.tick < m.stunUntil) tmp.lerp(new THREE.Color(0.6, 0.7, 1), 0.5);
      else if (m.elite) tmp.multiply(new THREE.Color(1.2, 0.8, 0.8));
      v.mat.uniforms.tint.value.copy(tmp);
      v.mat.uniforms.flash.value = performance.now() < v.flashUntil ? 1 : 0;
      if (!windup) v.bang = false;
      const [sx, sy] = this.toScreen(X, (v.topY + 0.1) * BB_K, Z);
      v.sx = sx;
      v.sy = sy;
    }
  }

  makeMonster(i: number, kind: number, elite: boolean, dead: boolean): MonsterView {
    const big = kind === MON.BRUTE || kind === MON.KING;
    const scale = kind === MON.KING ? 1.35 : elite && !big ? 1.25 : 1;
    const frames = hollowFrames(kind);
    const e = this.makeEnt(frames, scale, big ? 2.2 : 0.9);
    if (elite || kind === MON.KING || kind === MON.IMP) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(big ? 3 : 1.4, big ? 3 : 1.4), new THREE.MeshBasicMaterial({ map: this.tex.glow, color: kind === MON.IMP ? 0x9a3aff : 0xff3030, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.set(0, ((frames[0].height / TPX) * SPRITE_SCALE * scale) / 2, -0.05);
      e.bb.add(glow);
    }
    const topY = (frames[0].height / TPX) * SPRITE_SCALE * scale;
    // A spirit-pressure rim so dark-robed Hollows read against the dark floor.
    const rim = kind === MON.KING ? [1, 0.2, 0.3, 1] : elite ? [1, 0.55, 0.2, 1] : kind === MON.IMP ? [0.65, 0.3, 1, 0.9] : [0.75, 0.1, 0.2, 0.7];
    e.mat.uniforms.outline.value.set(rim[0], rim[1], rim[2], rim[3]);
    const v: MonsterView = { ...e, kind, dead, deadAt: dead ? -1e9 : 0, flashUntil: 0, bang: false, scale, sx: 0, sy: 0, topY, lit: false };
    this.monsters[i] = v;
    return v;
  }

  destroyMonster(i: number) {
    const v = this.monsters[i];
    if (!v) return;
    this.scene.remove(v.root);
    this.monsters[i] = null;
  }

  renderProjectiles(A: World, B: World, t: number, time: number) {
    for (let i = 0; i < B.projectiles.length; i++) {
      const p = B.projectiles[i];
      const pa = A.projectiles[i];
      let v = this.projs[i];
      if (p.kind === PROJ.NONE) {
        if (v) {
          this.scene.remove(v.mesh);
          this.projs[i] = null;
        }
        continue;
      }
      if (!v || v.kind !== p.kind) {
        if (v) this.scene.remove(v.mesh);
        v = this.makeProj(p.kind);
        this.projs[i] = v;
      }
      const same = pa.kind === p.kind;
      const X = (same ? lerp(pa.x, p.x, t) : p.x) * U;
      const Z = (same ? lerp(pa.y, p.y, t) : p.y) * U;
      v.mesh.position.set(X, 0.75, Z);
      if (p.kind === PROJ.BONE) v.mesh.rotation.z += 0.4;
      else v.mesh.scale.setScalar(1 + Math.sin(time / 40 + i) * 0.12);
      const n = p.kind === PROJ.FIREBALL ? 3 : 1;
      for (let k = 0; k < n; k++) this.sparks.emit(X + (Math.random() - 0.5) * 0.15, 0.75 + (Math.random() - 0.5) * 0.15, Z + (Math.random() - 0.5) * 0.15, 0, 0.3, 0, p.kind === PROJ.FIREBALL ? 0.35 : 0.2, p.kind === PROJ.FIREBALL ? [0xffffff, 0x9fe0ff, 0x2a7ae0][k % 3] : v.col, p.kind === PROJ.FIREBALL ? 0.16 : 0.09, 0);
    }
  }

  makeProj(kind: number): ProjView {
    const col = kind === PROJ.BOLT ? 0xe0f4ff : kind === PROJ.FIREBALL ? 0x4ab0ff : kind === PROJ.ORB ? 0xe0283c : 0xe0d8c0;
    let mesh: THREE.Mesh;
    if (kind === PROJ.BONE) {
      mesh = billboard(iconCanvas("bone"), 0.9, 0.5);
      mesh.scale.y = BB_K;
    } else {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(kind === PROJ.FIREBALL ? 0.28 : 0.13, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.6) }));
    }
    this.scene.add(mesh);
    return { mesh, kind, col };
  }

  itemCanvas(kind: number, rarity: number): HTMLCanvasElement {
    const img = this.atlas!;
    switch (kind) {
      case ITEM.COINS:
        return iconCanvas("coins");
      case ITEM.GEM:
        return iconCanvas("gem");
      case ITEM.CHALICE:
        return iconCanvas("chalice");
      case ITEM.IDOL:
        return iconCanvas("idol");
      case ITEM.CROWN:
        return iconCanvas("crown");
      case ITEM.HEART:
        return iconCanvas("heart");
      case ITEM.AEGIS:
        return iconCanvas("aegis");
      case ITEM.KEY:
        return iconCanvas("key");
      case ITEM.POTION:
        return atlasFrame(img, "flask_red");
      case ITEM.BLADE:
        return atlasFrame(img, ["weapon_rusty_sword", "weapon_regular_sword", "weapon_knight_sword", "weapon_red_gem_sword", "weapon_golden_sword"][rarity]);
      default:
        return iconCanvas("gem");
    }
  }

  renderDrops(w: World, time: number) {
    for (let i = 0; i < w.drops.length; i++) {
      const d = w.drops[i];
      let v = this.drops[i];
      const key = d.item.kind ? `${d.item.kind}:${d.item.rarity}:${d.spawnTick}:${d.x}:${d.y}` : "";
      if (v && v.key !== key) {
        // Picked up: zip toward the nearest player and vanish.
        const old = v;
        let tx = old.x;
        let tz = old.z;
        let best = 1e9;
        for (const p of w.players) {
          if (p.state !== PS.ALIVE) continue;
          const dd = Math.hypot(p.x * U - old.x, p.y * U - old.z);
          if (dd < best && dd < 2.5) {
            best = dd;
            tx = p.x * U;
            tz = p.y * U;
          }
        }
        const t0 = performance.now();
        const sx = old.root.position.x;
        const sz = old.root.position.z;
        old.beam && old.root.remove(old.beam);
        this.fx.push({
          update: (now) => {
            const f = (now - t0) / 180;
            old.root.position.set(lerp(sx, tx, f), f * 0.6, lerp(sz, tz, f));
            old.root.scale.setScalar(1 - f * 0.7);
            if (f >= 1) {
              this.scene.remove(old.root);
              return false;
            }
            return true;
          },
        });
        this.drops[i] = null;
        v = null;
      }
      if (!d.item.kind) continue;
      if (!v) v = this.makeDrop(i, d.item.kind, d.item.rarity, d.x * U, d.y * U, key, time);
      const age = time - v.bornAt;
      const bob = Math.sin((time - v.bornAt) / 260 + i) * 0.06;
      if (age < 420) {
        // Spill arc
        const f = age / 420;
        v.icon.position.y = 0.25 + Math.abs(Math.sin(f * Math.PI * 1.5)) * (1 - f) * 0.9;
        v.icon.scale.setScalar(0.4 + f * 0.6);
      } else {
        v.icon.position.y = 0.25 + bob;
        v.icon.scale.setScalar(1);
      }
      v.icon.scale.y *= BB_K;
      const tmp = new THREE.Color();
      this.lightAt(v.x, v.z + 0.3, tmp, 0.55);
      (v.icon.material as SpriteMat).uniforms.tint.value.copy(tmp).multiplyScalar(1.25);
      if (v.beam) (v.beam.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time / 300 + i) * 0.2;
      if (v.rarity >= 4 && Math.random() < 0.25) this.sparks.emit(v.x + (Math.random() - 0.5) * 0.4, 0.3, v.z + (Math.random() - 0.5) * 0.4, 0, 1.2, 0, 0.8, Math.random() < 0.5 ? 0xffe080 : 0xffffff, 0.08, 0);
    }
  }

  makeDrop(i: number, kind: number, rarity: number, x: number, z: number, key: string, time: number): DropView {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const icon = billboard(this.itemCanvas(kind, rarity), kind === ITEM.BLADE ? 0.8 : 0.72, 0);
    root.add(icon, this.shadowMesh(0.5));
    const col = kind === ITEM.POTION ? 0xff4060 : kind === ITEM.KEY ? 0xffd65a : RARITY_COLORS[rarity];
    let beam: THREE.Mesh | undefined;
    if (rarity >= 2 && kind !== ITEM.POTION && kind !== ITEM.KEY) {
      const h = rarity >= 4 ? 7 : rarity >= 3 ? 4.5 : 2.8;
      const g = new THREE.CylinderGeometry(rarity >= 4 ? 0.22 : 0.15, rarity >= 4 ? 0.3 : 0.2, h, 8, 1, true);
      g.translate(0, h / 2, 0);
      beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.tex.beam, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      root.add(beam);
    }
    this.scene.add(root);
    const v: DropView = { root, icon, beam, key, bornAt: time, x, z, col, rarity };
    this.drops[i] = v;
    return v;
  }


  renderChests(time: number) {
    const now = performance.now();
    this.chests.forEach((v) => {
      if (!v) return;
      const gm = v.glow.material as THREE.MeshBasicMaterial;
      if (v.state === CHEST_STATE.OPEN) {
        const f = v.openAt === 1 ? 1 : Math.min(1, (now - v.openAt) / 320);
        const e = 1 - Math.pow(1 - f, 3);
        v.lid.rotation.x = -1.95 * e;
        gm.opacity = f < 1 ? 0.9 : 0.25 + Math.sin(time / 400) * 0.08;
        v.root.rotation.z = 0;
      } else if (v.state === CHEST_STATE.PENDING) {
        // VRF roll: the lid rattles while randomness is fetched.
        v.lid.rotation.x = -0.12 - Math.abs(Math.sin(time / 70)) * 0.18;
        v.root.rotation.z = Math.sin(time / 45) * 0.04;
        gm.opacity = 0.5 + Math.sin(time / 90) * 0.3;
        if (Math.random() < 0.3) this.sparks.emit(v.x + (Math.random() - 0.5) * 0.5, 0.5, v.z, 0, 1.2, 0, 0.5, 0xc9a7ff, 0.07, 0);
      } else {
        v.lid.rotation.x = 0;
        gm.opacity = 0;
      }
    });
  }

  renderPortals(w: World, time: number) {
    const open = portalsOpen(w);
    for (const p of this.portals) {
      const set = (m: THREE.Mesh, c: number, o: number) => {
        const mm = m.material as THREE.MeshBasicMaterial;
        mm.color.setHex(c);
        mm.opacity = o;
      };
      p.ring.rotation.z = time / (open ? 1400 : 5000);
      p.inner.rotation.z = -time / 900;
      set(p.ring, open ? 0xbfe6ff : 0x3a4a6a, open ? 1 : 0.6);
      set(p.inner, open ? 0xffffff : 0x2a3450, open ? 0.8 : 0.4);
      p.swirl.scale.y = BB_K;
      p.swirl2.rotation.z = time / 200;
      set(p.swirl, 0x9fe0ff, open ? 0.55 + Math.sin(time / 300) * 0.12 : 0.06);
      set(p.swirl2, 0xffffff, open ? 0.6 + Math.sin(time / 150) * 0.2 : 0);
      p.pillar.visible = open;
      set(p.pillar, 0x9fe0ff, 0.5 + Math.sin(time / 220) * 0.15);
      if (open && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        this.sparks.emit(p.x + Math.cos(a) * 1.1, 0.1, p.z + Math.sin(a) * 1.1, -Math.cos(a) * 0.4, 1.6 + Math.random(), -Math.sin(a) * 0.4, 1.2, Math.random() < 0.5 ? 0xcfeeff : 0x9a7cff, 0.08, 0);
      }
    }
  }

  renderTorches(time: number) {
    for (const t of this.torches) {
      const f = Math.floor(time / 110 + t.seed * 10) % 4;
      t.mat.map = pixTex(this.flames[f]);
      if (Math.random() < 0.08) this.sparks.emit(t.x + (Math.random() - 0.5) * 0.1, t.y + 0.2, t.z - 0.1, (Math.random() - 0.5) * 0.2, 0.8 + Math.random() * 0.6, 0.05, 0.6, Math.random() < 0.5 ? 0x9fe0ff : 0xffffff, 0.06, 0);
    }
  }

  /** Drifting reishi motes and dust around the camera focus. */
  ambientMotes(dt: number) {
    const n = Math.random() < dt * 30 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const x = this.camTarget.x + (Math.random() - 0.5) * 22;
      const z = this.camTarget.z + (Math.random() - 0.5) * 14;
      if (Math.random() < 0.5) this.sparks.emit(x, Math.random() * 1.5, z, (Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.25, (Math.random() - 0.5) * 0.15, 4 + Math.random() * 3, 0x6ab8ff, 0.06, 0, 0.6);
      else this.debris.emit(x, Math.random() * 2, z, (Math.random() - 0.5) * 0.1, -0.05, (Math.random() - 0.5) * 0.1, 5, 0x8a8aa8, 0.05, 0, 0.35);
    }
  }

  renderTelegraphs(B: World, time: number) {
    const g = this.teleGroup;
    for (const c of [...g.children]) {
      g.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const mat = (col: number, op: number) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
    const flat = (m: THREE.Mesh, x: number, z: number, y = 0.03) => {
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      g.add(m);
    };
    for (const m of B.monsters) {
      if (!m.kind || m.hp === 0 || m.state !== MS.WINDUP) continue;
      const left = Math.max(0, m.timer - B.tick);
      const total = m.kind === MON.NECRO ? 7 : m.kind === MON.BRUTE ? 8 : m.kind === MON.KING ? 9 : 5;
      const prog = 1 - left / total;
      const X = m.x * U;
      const Z = m.y * U;
      const ar = angleRad(m.aim);
      if (m.kind === MON.BRUTE || m.kind === MON.KING) {
        const r = (MON_RANGE[m.kind] + 80) * U;
        flat(new THREE.Mesh(new THREE.CircleGeometry(r, 32), mat(0xff2020, 0.15 + prog * 0.2)), X, Z);
        flat(new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r * prog - 0.06), r * prog, 32), mat(0xff5050, 0.9)), X, Z, 0.035);
      } else if (m.kind === MON.NECRO) {
        const len = 5;
        const pg = new THREE.PlaneGeometry(len, 0.18);
        pg.translate(len / 2, 0, 0);
        const line = new THREE.Mesh(pg, mat(0xc060ff, 0.35 + prog * 0.4));
        line.rotation.x = -Math.PI / 2;
        line.rotation.z = -ar;
        line.position.set(X, 0.04, Z);
        g.add(line);
      } else {
        const r = (MON_RANGE[m.kind] + 110) * U;
        flat(new THREE.Mesh(new THREE.CircleGeometry(r, 24, -ar - 0.9, 1.8), mat(0xff2020, 0.18 + prog * 0.3)), X, Z);
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = B.players[i];
      if (p.state !== PS.ALIVE || !p.extract) continue;
      const X = (i === this.me && this.pred ? this.pred.x : p.x) * U;
      const Z = (i === this.me && this.pred ? this.pred.y : p.y) * U;
      const f = p.extract / EXTRACT_TICKS;
      flat(new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40, 1, Math.PI / 2, -f * Math.PI * 2), mat(0x9fe0ff, 0.95)), X, Z, 0.04);
      if (Math.random() < 0.7) this.sparks.emit(X + (Math.random() - 0.5) * 1.2, 0.1, Z + (Math.random() - 0.5) * 1.2, 0, 2 + Math.random() * 2, 0, 0.6, 0xcfeeff, 0.07, 0);
    }
    void time;
  }

  revealAround(ux: number, uy: number, force = false) {
    void force;
    const r = 6;
    const tx = Math.floor(ux / TILE);
    const ty = Math.floor(uy / TILE);
    for (let yy = ty - r; yy <= ty + r; yy++) {
      for (let xx = tx - r; xx <= tx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) continue;
        if ((xx - tx) ** 2 + (yy - ty) ** 2 > r * r) continue;
        this.explored[yy * MAP_W + xx] = 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Screen-space overlay
  // ---------------------------------------------------------------------------

  renderOverlay(B: World, time: number) {
    const g = this.octx;
    g.clearRect(0, 0, VIEW_W, VIEW_H);
    const text = (s: string, x: number, y: number, color: string, size: number, weight = 700) => {
      g.font = `${weight} ${size}px "Pixelify Sans", monospace`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.lineJoin = "round";
      g.lineWidth = 4;
      g.strokeStyle = "#05030a";
      g.strokeText(s, x, y);
      g.fillStyle = color;
      g.fillText(s, x, y);
    };
    // Monster HP bars + windup bangs
    B.monsters.forEach((m, i) => {
      const v = this.monsters[i];
      if (!v || v.dead || !m.kind || m.hp === 0 || !v.lit) return;
      if (m.hp !== m.maxHp && m.kind !== MON.KING) {
        const w = m.kind === MON.BRUTE ? 54 : 34;
        g.fillStyle = "rgba(0,0,0,0.75)";
        g.fillRect(Math.round(v.sx - w / 2 - 1), Math.round(v.sy - 1), w + 2, 6);
        g.fillStyle = m.elite ? "#ff7a2a" : "#d63a3a";
        g.fillRect(Math.round(v.sx - w / 2), Math.round(v.sy), Math.round((w * m.hp) / m.maxHp), 4);
      }
      if (v.bang) text("!", v.sx, v.sy - 4 + Math.sin(time / 60) * 2, "#ff3a3a", 22);
    });
    // Player names + HP
    B.players.forEach((p, i) => {
      const v = this.players[i];
      if (!v || p.state !== PS.ALIVE || !v.lit) return;
      text(p.name || CLASSES[p.cls].name, v.sx, v.sy - 6, PLAYER_CSS[i], 13, 600);
      if (i !== this.me) {
        g.fillStyle = "rgba(0,0,0,0.75)";
        g.fillRect(Math.round(v.sx - 20), Math.round(v.sy - 4), 40, 5);
        g.fillStyle = PLAYER_CSS[i];
        g.fillRect(Math.round(v.sx - 19), Math.round(v.sy - 3), Math.round((38 * p.hp) / p.maxHp), 3);
      }
    });
    // Chest VRF badges
    this.chests.forEach((v) => {
      if (!v || v.state !== CHEST_STATE.PENDING) return;
      const [sx, sy] = this.toScreen(v.x, 1.1 * BB_K, v.z);
      text(`VRF ${".".repeat(1 + (Math.floor(time / 250) % 3))}`, sx, sy + Math.sin(time / 120) * 2, "#c9a7ff", 12);
    });
    // Damage numbers
    const now = performance.now();
    this.dmgTexts = this.dmgTexts.filter((d) => {
      const age = (now - d.born) / 1000;
      if (age > 0.8) return false;
      const [sx, sy] = this.toScreen(d.x, d.y + age * 1.1, d.z);
      g.globalAlpha = 1 - Math.max(0, age - 0.5) / 0.3;
      const pop = age < 0.1 ? 1 + (0.1 - age) * 5 : 1;
      text(d.text, sx, sy, d.color, Math.round(16 * d.scale * pop));
      g.globalAlpha = 1;
      return true;
    });
    // Offscreen arrows to open gates
    if (portalsOpen(B)) {
      for (const p of this.portals) {
        const [sx, sy] = this.toScreen(p.x, 0.5, p.z);
        if (sx > 20 && sx < VIEW_W - 20 && sy > 20 && sy < VIEW_H - 20) continue;
        const a = Math.atan2(sy - VIEW_H / 2, sx - VIEW_W / 2);
        const ex = VIEW_W / 2 + Math.cos(a) * (VIEW_W / 2 - 34);
        const ey = VIEW_H / 2 + Math.sin(a) * (VIEW_H / 2 - 34);
        g.fillStyle = "rgba(185,139,255,0.9)";
        g.beginPath();
        g.moveTo(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12);
        g.lineTo(ex + Math.cos(a + 2.4) * 9, ey + Math.sin(a + 2.4) * 9);
        g.lineTo(ex + Math.cos(a - 2.4) * 9, ey + Math.sin(a - 2.4) * 9);
        g.fill();
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
            ctx.fillStyle = "#5d6a8a";
            ctx.fillRect(x * S, y * S, S, S);
          }
        } else {
          ctx.fillStyle = "#1e2333";
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
      ctx.fillStyle = open ? "#9fe0ff" : "#4a5a7a";
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

export function createGame(parent: HTMLElement, session: GameSession, hooks: SceneHooks) {
  return new Game3D(parent, session, hooks);
}

export { NOBODY, SRC_MONSTER, MON_NAMES, lootValue };
