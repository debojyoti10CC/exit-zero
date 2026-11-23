import { useEffect, useRef, useState } from "react";
import tileList from "../../public/assets/0x72/tile_list_v1.7.txt?raw";
import { ICONS } from "../game/textures";
import { ITEM, RARITY_CSS } from "../game/world";

export const FRAMES: Record<string, [number, number, number, number]> = {};
for (const line of tileList.split(/\r?\n/)) {
  const p = line.trim().split(/\s+/);
  if (p.length >= 5) FRAMES[p[0]] = [+p[1], +p[2], +p[3], +p[4]];
}

let tick = 0;
const listeners = new Set<() => void>();
setInterval(() => {
  tick++;
  listeners.forEach((l) => l());
}, 140);
function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return tick;
}

/** Animated sprite from the 0x72 atlas, e.g. base="knight_m_run_anim". */
export function Sprite({ base, frames = 4, scale = 4, flip = false, style }: { base: string; frames?: number; scale?: number; flip?: boolean; style?: React.CSSProperties }) {
  const t = useTick();
  const name = frames > 1 ? `${base}_f${t % frames}` : base;
  const f = FRAMES[name] || FRAMES[`${base}_f0`];
  if (!f) return null;
  const [x, y, w, h] = f;
  return (
    <span
      className="sprite"
      style={{
        width: w * scale,
        height: h * scale,
        backgroundPosition: `${-x * scale}px ${-y * scale}px`,
        backgroundSize: `${512 * scale}px ${512 * scale}px`,
        transform: flip ? "scaleX(-1)" : undefined,
        ...style,
      }}
    />
  );
}

const ICON_FOR: Record<number, string> = {
  [ITEM.COINS]: "coins",
  [ITEM.GEM]: "gem",
  [ITEM.CHALICE]: "chalice",
  [ITEM.IDOL]: "idol",
  [ITEM.CROWN]: "crown",
  [ITEM.HEART]: "heart",
  [ITEM.AEGIS]: "aegis",
  [ITEM.KEY]: "key",
};
const BLADES = ["weapon_rusty_sword", "weapon_regular_sword", "weapon_knight_sword", "weapon_red_gem_sword", "weapon_golden_sword"];

let atlas: HTMLImageElement | null = null;
function atlasImg() {
  if (!atlas) {
    atlas = new Image();
    atlas.src = `${import.meta.env.BASE_URL}assets/0x72/0x72_DungeonTilesetII_v1.7.png`;
  }
  return atlas;
}

/** Item icon drawn to a crisp canvas (same pixel art as in-game). */
export function ItemIcon({ kind, rarity = 0, scale = 3, glow = true }: { kind: number; rarity?: number; scale?: number; glow?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const icon = ICON_FOR[kind];
    if (icon) {
      const { rows, pal } = ICONS[icon];
      const h = rows.length;
      const w = Math.max(...rows.map((r) => r.length));
      const ox = Math.floor((16 - w) / 2);
      const oy = Math.floor((16 - h) / 2);
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = pal[row[x]];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect((ox + x) * scale, (oy + y) * scale, scale, scale);
        }
      });
    } else {
      const frame = kind === ITEM.POTION ? "flask_red" : kind === ITEM.BLADE ? BLADES[rarity] : null;
      if (!frame) return;
      const f = FRAMES[frame];
      const img = atlasImg();
      const draw = () => {
        ctx.clearRect(0, 0, c.width, c.height);
        const [x, y, w, h] = f;
        const s = Math.min(16 / w, 16 / h);
        ctx.drawImage(img, x, y, w, h, ((16 - w * s) / 2) * scale, ((16 - h * s) / 2) * scale, w * s * scale, h * s * scale);
      };
      if (img.complete) draw();
      else img.addEventListener("load", draw, { once: true });
    }
  }, [kind, rarity, scale]);
  const col = kind === ITEM.POTION ? "#ff4060" : kind === ITEM.KEY ? "#ffd65a" : RARITY_CSS[rarity];
  return <canvas ref={ref} width={16 * scale} height={16 * scale} style={{ filter: glow ? `drop-shadow(0 0 ${scale * 2}px ${col}88)` : undefined }} />;
}

export const HERO_SPRITES = [
  ["knight_m", "knight_f"],
  ["wizzard_m", "wizzard_f"],
  ["elf_m", "elf_f"],
];
