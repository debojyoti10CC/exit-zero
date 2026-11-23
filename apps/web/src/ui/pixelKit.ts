// Pixel-art UI kit: 9-slice frames are painted pixel-by-pixel into tiny canvases and
// used as CSS border-images scaled by whole numbers, so every UI edge matches the
// 16px tileset (no gradients, blurs or rounded corners anywhere).

export const PAL = {
  ink: "#0b0710",
  void: "#140c1c",
  deep: "#1c1526",
  stone0: "#2a2036",
  stone1: "#3b2d4a",
  stone2: "#5b4a70",
  stone3: "#8a7a9e",
  gold0: "#7a4a12",
  gold1: "#c9963a",
  gold2: "#f4c95d",
  gold3: "#fff2b0",
  blood0: "#4a0a14",
  blood1: "#a01830",
  blood2: "#e8364f",
  arcane1: "#6b3fd6",
  arcane2: "#b98bff",
  bone: "#ece4d6",
};

type Painter = (px: (x: number, y: number, c: string) => void, s: number) => void;

function paint(size: number, fn: Painter) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  fn((x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }, size);
  return c.toDataURL();
}

function rect(px: (x: number, y: number, c: string) => void, x0: number, y0: number, w: number, h: number, c: string) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c);
}

/** Bevelled stone frame, 24x24, slice 8. Gold rivets in the corners. */
function stoneFrame(fill: string, light: string, dark: string, rivet = true): string {
  return paint(24, (px, s) => {
    rect(px, 0, 0, s, s, PAL.ink);
    // bevel
    rect(px, 1, 1, s - 2, 2, light);
    rect(px, 1, 1, 2, s - 2, light);
    rect(px, 1, s - 3, s - 2, 2, dark);
    rect(px, s - 3, 1, 2, s - 2, dark);
    // inner line
    rect(px, 3, 3, s - 6, 1, PAL.ink);
    rect(px, 3, 3, 1, s - 6, PAL.ink);
    rect(px, 3, s - 4, s - 6, 1, PAL.ink);
    rect(px, s - 4, 3, 1, s - 6, PAL.ink);
    // fill
    rect(px, 4, 4, s - 8, s - 8, fill);
    // edge mortar ticks (repeat-friendly at 8px)
    px(12, 1, dark);
    px(1, 12, dark);
    px(12, s - 2, PAL.ink);
    px(s - 2, 12, PAL.ink);
    if (rivet) {
      for (const [cx, cy] of [
        [1, 1],
        [s - 4, 1],
        [1, s - 4],
        [s - 4, s - 4],
      ]) {
        rect(px, cx, cy, 3, 3, PAL.gold0);
        px(cx, cy, PAL.gold2);
        px(cx + 1, cy, PAL.gold1);
        px(cx, cy + 1, PAL.gold1);
        px(cx + 1, cy + 1, PAL.gold1);
      }
    }
  });
}

/** Small raised button frame, 12x12, slice 4. */
function buttonFrame(fill: string, top: string, bottom: string, outline: string): string {
  return paint(12, (px, s) => {
    rect(px, 0, 0, s, s, outline);
    // knock out the corners for a pixel-rounded look
    px(0, 0, "rgba(0,0,0,0)");
    rect(px, 1, 1, s - 2, s - 2, fill);
    rect(px, 1, 1, s - 2, 1, top);
    rect(px, 1, s - 3, s - 2, 2, bottom);
  });
}

/** Sunken slot, 12x12, slice 4. */
function slotFrame(): string {
  return paint(12, (px, s) => {
    rect(px, 0, 0, s, s, PAL.ink);
    rect(px, 1, 1, s - 2, s - 2, PAL.void);
    rect(px, 1, 1, s - 2, 1, "#07040b");
    rect(px, 1, 1, 1, s - 2, "#07040b");
    rect(px, 1, s - 2, s - 2, 1, PAL.stone1);
    rect(px, s - 2, 1, 1, s - 2, PAL.stone1);
  });
}

/** Tiny 1px-bordered tag, 6x6 slice 2. */
function tagFrame(col: string): string {
  return paint(6, (px, s) => {
    rect(px, 0, 0, s, s, col);
    rect(px, 1, 1, s - 2, s - 2, PAL.void);
  });
}

let installed = false;
export function installPixelKit() {
  if (installed) return;
  installed = true;
  const root = document.documentElement.style;
  const set = (k: string, v: string) => root.setProperty(k, `url(${v})`);
  set("--px-panel", stoneFrame(PAL.deep, PAL.stone2, PAL.stone0));
  set("--px-panel-gold", stoneFrame(PAL.deep, PAL.gold1, PAL.gold0));
  set("--px-panel-blood", stoneFrame(PAL.deep, PAL.blood1, PAL.blood0));
  set("--px-panel-arcane", stoneFrame(PAL.deep, PAL.arcane2, PAL.arcane1));
  set("--px-btn", buttonFrame(PAL.stone1, PAL.stone2, PAL.stone0, PAL.ink));
  set("--px-btn-hover", buttonFrame(PAL.stone2, PAL.stone3, PAL.stone1, PAL.gold2));
  set("--px-btn-down", buttonFrame(PAL.stone0, PAL.stone0, PAL.stone1, PAL.gold1));
  set("--px-btn-gold", buttonFrame(PAL.gold1, PAL.gold3, PAL.gold0, PAL.ink));
  set("--px-btn-gold-hover", buttonFrame(PAL.gold2, PAL.gold3, PAL.gold1, PAL.bone));
  set("--px-btn-blood", buttonFrame(PAL.blood1, PAL.blood2, PAL.blood0, PAL.ink));
  set("--px-slot", slotFrame());
  set("--px-tag-gold", tagFrame(PAL.gold1));
  set("--px-tag-arcane", tagFrame(PAL.arcane2));
  set("--px-tag-green", tagFrame("#5fd16b"));
  set("--px-tag-blood", tagFrame(PAL.blood2));
  set("--px-tag-stone", tagFrame(PAL.stone2));
  set("--atlas-url", `${import.meta.env.BASE_URL}assets/0x72/0x72_DungeonTilesetII_v1.7.png`);
}
