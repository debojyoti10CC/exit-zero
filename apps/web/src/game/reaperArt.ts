// Original pixel art for the spirit-reaper theme: chibi reapers (16x24) and
// masked Hollows. Drawn from text maps into canvases; used by Phaser (as
// textures) and by the React UI (as <canvas> sprites). Facing right.

type Pal = Record<string, string>;

const OUT = "#0b0b12";

/** Reaper body. h/H hair, s/S skin, e eye, r/R robe, w white collar, b sash, f feet, m scarf. */
const HERO_TOP = [
  "....h..h.h......",
  "...hhhhhhhh.h...",
  "..hhHhhhhhhhh...",
  ".hhhhHhhhhhhhh..",
  "..ohhhhhhhhhho..",
  "..ohhsssssshho..",
  "..ohsesssesso...",
  "..osssssssso....",
  "...osSSSSSo.....",
  "....mmwwmm......",
  "...orrrwrrro....",
  "..orrRrwrRrro...",
  "..orRrrwrrRro...",
  "..osorbbbbros...",
  "...orrrrrrro....",
  "...orrRrrrRro...",
  "..orrrrrrrrro...",
  "..orRrrrrrrRro..",
];
const LEGS_STAND = [
  "..orrrrorrrrro..",
  "...orrro.orrro..",
  "...orrro.orrro..",
  "...offo...offo..",
  "..offfo..offfo..",
  "................",
];
const LEGS_STRIDE_A = [
  "..orrrrrrrrro...",
  "..orrro..orro...",
  ".orrro....orro..",
  ".offo......offo.",
  ".ofo.......ofo..",
  "................",
];
const LEGS_STRIDE_B = [
  "..orrrrrrrrro...",
  "...orrro.orro...",
  "...orro..orrro..",
  "...offo...offfo.",
  "...offo....oo...",
  "................",
];

export interface HeroLook {
  hair: string;
  hairHi: string;
  sash: string;
  scarf: string;
}
export const HERO_LOOKS: HeroLook[] = [
  { hair: "#dfe6f2", hairHi: "#ffffff", sash: "#c0182e", scarf: "#e8ecf4" }, // Reaper: silver hair, crimson sash
  { hair: "#2c5aa0", hairHi: "#5a8ad8", sash: "#9fe0ff", scarf: "#e8ecf4" }, // Spellbinder: deep blue, ice sash
  { hair: "#1a1b26", hairHi: "#3a3f55", sash: "#7a3fd6", scarf: "#5a1830" }, // Shade: black hair, violet sash, dark scarf
];

function heroPal(look: HeroLook): Pal {
  return {
    o: OUT,
    h: look.hair,
    H: look.hairHi,
    s: "#f2c9a0",
    S: "#d39a72",
    e: "#1a1a2a",
    r: "#16171f",
    R: "#2e3246",
    w: "#e8ecf4",
    b: look.sash,
    f: "#07070a",
    m: look.scarf,
  };
}

function paint(rows: string[], pal: Pal, scale = 1, dy = 0, w = 16, h = rows.length) {
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d")!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, (y + dy) * scale, scale, scale);
    }
  });
  return c;
}

/** Composes a 16x24 frame: torso (optionally bobbed down 1px) + legs. */
function heroFrame(look: HeroLook, legs: string[], bob: number) {
  const pal = heroPal(look);
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 24;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(paint(LEGS_STAND.map(() => "".padEnd(16, ".")), pal), 0, 0);
  ctx.drawImage(paint(legs, pal), 0, 18);
  ctx.drawImage(paint(HERO_TOP, pal), 0, bob);
  return c;
}

const heroCache = new Map<number, HTMLCanvasElement[]>();
/** Frames: [idle0, idle1, run0, run1, run2, run3]. */
export function heroFrames(cls: number): HTMLCanvasElement[] {
  const k = Math.max(0, Math.min(2, cls));
  let f = heroCache.get(k);
  if (!f) {
    const look = HERO_LOOKS[k];
    f = [
      heroFrame(look, LEGS_STAND, 0),
      heroFrame(look, LEGS_STAND, 1),
      heroFrame(look, LEGS_STRIDE_A, 0),
      heroFrame(look, LEGS_STAND, 1),
      heroFrame(look, LEGS_STRIDE_B, 0),
      heroFrame(look, LEGS_STAND, 1),
    ];
    heroCache.set(k, f);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Hollows: white bone masks, black bodies, crimson markings.
// ---------------------------------------------------------------------------

const HOLLOW_PAL: Pal = {
  o: OUT,
  w: "#f2f4f8",
  W: "#c9d0dc",
  d: "#16171f",
  D: "#2a2d3c",
  r: "#c0182e",
  y: "#ffde5a",
  x: "#000000",
};

const LESSER = [
  [
    "................",
    ".....oooooo.....",
    "....owwwwwwo....",
    "...owwwwwwWwo...",
    "...owxxwwxxwo...",
    "...owxywwxywo...",
    "...owwwwwwwWo...",
    "...owrwrwrwwo...",
    "....owwwwwwo....",
    "...oddddddddo...",
    "..oddDddddDddo..",
    ".oddoddddddoddo.",
    ".odo.oddddo.odo.",
    ".oo..oddddo..oo.",
    "....odo..odo....",
    "....oo....oo....",
  ],
  [
    "................",
    "................",
    ".....oooooo.....",
    "....owwwwwwo....",
    "...owwwwwwWwo...",
    "...owxxwwxxwo...",
    "...owxywwxywo...",
    "...owrwrwrwwo...",
    "....owwwwwwo....",
    "...oddddddddo...",
    "..oddDddddDddo..",
    ".oddoddddddoddo.",
    "odo..oddddo..odo",
    "oo...oddddo...oo",
    "....odo..odo....",
    "...oo......oo...",
  ],
];

const HOWLER = [
  [
    "................",
    "....ooooo.......",
    "...owwwwwoooo...",
    "..owxxwwwwwwwo..",
    "..owxywwwwwwwwo.",
    "..owwwwwrrrrwo..",
    "...owwwwwwwoo...",
    "....oddddddo....",
    "...oddDDddddo...",
    "..oddddddddddo..",
    "..ododdddddodo..",
    "..oo.oddddo.oo..",
    ".....odddo......",
    "....oddo.do.....",
    "....oo...oo.....",
    "................",
  ],
  [
    "................",
    "................",
    "....ooooo.......",
    "...owwwwwoooo...",
    "..owxxwwwwwwwo..",
    "..owxywwwwwwwwo.",
    "..owwwwwrrrrwo..",
    "...owwwwwwwoo...",
    "....oddddddo....",
    "...oddDDddddo...",
    "..oddddddddddo..",
    ".ododdddddddodo.",
    ".oo..oddddo..oo.",
    ".....odo.do.....",
    "....oo....oo....",
    "................",
  ],
];

/** Great Hollow / King: drawn from a 16x16 map at 2x for a heavy, chunky silhouette. */
const GREAT = [
  [
    "...o........o...",
    "..owo.oooo.owo..",
    "..owwowwwwowwo..",
    "...owwwwwwwwo...",
    "..owxxwwwwxxwo..",
    "..owxywwwwxywo..",
    "..owwwwwwwwwwo..",
    "..owrwrwrwrwwo..",
    ".oddowwwwwwoddo.",
    "odddddddddddddo.",
    "oddDddddddddDddo",
    "odd.oddddddo.ddo",
    "odo.oddddddo.odo",
    ".o..oddoodddo.o.",
    "....oddo..oddo..",
    "....ooo....ooo..",
  ],
  [
    "................",
    "...o........o...",
    "..owo.oooo.owo..",
    "..owwowwwwowwo..",
    "...owwwwwwwwo...",
    "..owxxwwwwxxwo..",
    "..owxywwwwxywo..",
    "..owrwrwrwrwwo..",
    ".oddowwwwwwoddo.",
    "odddddddddddddo.",
    "oddDddddddddDddo",
    "odd.oddddddo.ddo",
    "odo.oddddddo.odo",
    "....oddoodddo...",
    "....oddo..oddo..",
    "...ooo......ooo.",
  ],
];

const KING_PAL: Pal = { ...HOLLOW_PAL, d: "#1a0a10", D: "#4a0a18", w: "#fff4f0", W: "#e8c8c0" };

const SOUL = [
  [
    "................",
    "................",
    "......oooo......",
    ".....oDDDDo.....",
    "....oDdddDDo....",
    "....oDxdxdDo....",
    "....oDdddddo....",
    ".....oDdddo.....",
    "......oDdo......",
    ".......oo.......",
    "................",
  ],
  [
    "................",
    "......oooo......",
    ".....oDDDDo.....",
    "....oDdddDDo....",
    "....oDxdxdDo....",
    "....oDdddddo....",
    ".....oDddddo....",
    "......oDddo.....",
    ".......oDo......",
    "........o.......",
    "................",
  ],
];

const hollowCache = new Map<number, HTMLCanvasElement[]>();
/** Frames for monster kinds 1..5 (skeleton, necro, brute, king, imp). */
export function hollowFrames(kind: number): HTMLCanvasElement[] {
  let f = hollowCache.get(kind);
  if (f) return f;
  switch (kind) {
    case 2:
      f = HOWLER.map((r) => paint(r, HOLLOW_PAL));
      break;
    case 3:
      f = GREAT.map((r) => paint(r, HOLLOW_PAL, 2));
      break;
    case 4:
      f = GREAT.map((r) => paint(r, KING_PAL, 2));
      break;
    case 5:
      f = SOUL.map((r) => paint(r, HOLLOW_PAL));
      break;
    default:
      f = LESSER.map((r) => paint(r, HOLLOW_PAL));
  }
  hollowCache.set(kind, f);
  return f;
}

/** A long nodachi with a crimson-wrapped hilt (points up; origin near the hilt). */
export function bladeTexture(): HTMLCanvasElement {
  const rows = [
    "..l..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    ".lL..",
    "ggggg",
    ".kk..",
    ".kr..",
    ".kk..",
    ".kr..",
    ".oo..",
  ];
  return paint(rows, { l: "#f2f8ff", L: "#9fb8d8", g: "#c9963a", k: "#2a1a1a", r: "#c0182e", o: OUT }, 1, 0, 5, rows.length);
}
