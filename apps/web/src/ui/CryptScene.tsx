import { useEffect, useRef } from "react";
import { FRAMES } from "./Sprites";

// A living crypt drawn from the game's own tileset at 480x270 and scaled up by
// whole pixels. Used behind every menu so all screens share one world.

const W = 480;
const H = 270;
const WALL_Y = 56; // top of wall caps
const FLOOR_Y = 104;

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface CryptSceneProps {
  /** Which hero (0..2) stands in the spotlight; -1 shows the whole party. */
  focus?: number;
  dim?: number;
  heroes?: boolean;
}

export function CryptScene({ focus = -1, dim = 0, heroes = true }: CryptSceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ focus, dim, heroes });
  props.current = { focus, dim, heroes };

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}assets/0x72/0x72_DungeonTilesetII_v1.7.png`;

    // Static layer: walls, floor, gate, decor.
    const stat = document.createElement("canvas");
    stat.width = W;
    stat.height = H;
    const sx = stat.getContext("2d")!;
    const dark = document.createElement("canvas");
    dark.width = W;
    dark.height = H;
    const dx = dark.getContext("2d")!;

    const draw = (g: CanvasRenderingContext2D, name: string, x: number, y: number, flip = false) => {
      const f = FRAMES[name];
      if (!f) return;
      const [fx, fy, fw, fh] = f;
      if (flip) {
        g.save();
        g.translate(x + fw, y);
        g.scale(-1, 1);
        g.drawImage(img, fx, fy, fw, fh, 0, 0, fw, fh);
        g.restore();
      } else g.drawImage(img, fx, fy, fw, fh, x, y, fw, fh);
    };

    const buildStatic = () => {
      sx.fillStyle = "#07040b";
      sx.fillRect(0, 0, W, H);
      for (let y = FLOOR_Y; y < H; y += 16) {
        for (let x = 0; x < W; x += 16) {
          const r = hash(x, y);
          draw(sx, r < 0.7 ? "floor_1" : `floor_${2 + Math.floor(hash(y, x) * 7)}`, x, y);
        }
      }
      for (let x = 0; x < W; x += 16) {
        draw(sx, "wall_top_mid", x, WALL_Y);
        const r = hash(x, 3);
        draw(sx, r < 0.08 ? "wall_hole_1" : r < 0.14 ? "wall_hole_2" : "wall_mid", x, WALL_Y + 16);
        draw(sx, hash(x, 9) < 0.1 ? "wall_goo" : "wall_mid", x, WALL_Y + 32);
      }
      // floor shading under the wall
      sx.fillStyle = "rgba(0,0,0,0.35)";
      sx.fillRect(0, FLOOR_Y, W, 3);
      sx.fillStyle = "rgba(0,0,0,0.18)";
      sx.fillRect(0, FLOOR_Y + 3, W, 3);
      // The crypt gate
      draw(sx, "doors_frame_top", 224, WALL_Y + 8);
      draw(sx, "doors_frame_left", 208, WALL_Y + 16);
      draw(sx, "doors_frame_right", 256, WALL_Y + 16);
      draw(sx, "doors_leaf_closed", 224, WALL_Y + 16);
      // banners
      for (const [x, b] of [
        [128, "wall_banner_red"],
        [336, "wall_banner_red"],
        [64, "wall_banner_blue"],
        [400, "wall_banner_blue"],
      ] as const)
        draw(sx, b, x, WALL_Y + 16);
      // bones and skulls
      for (let k = 0; k < 26; k++) {
        const x = Math.floor(hash(k, 1) * (W - 16));
        const y = FLOOR_Y + 12 + Math.floor(hash(1, k) * (H - FLOOR_Y - 30));
        if (x > 170 && x < 300 && y > 170) continue;
        draw(sx, "skull", x, y);
      }
      draw(sx, "crate", 20, FLOOR_Y + 4);
      draw(sx, "crate", 36, FLOOR_Y + 10);
      draw(sx, "crate", 440, FLOOR_Y + 6);
      draw(sx, "floor_ladder", 232, 200);
    };

    const torches = [
      { x: 184, y: WALL_Y + 24 },
      { x: 296, y: WALL_Y + 24 },
      { x: 96, y: WALL_Y + 24 },
      { x: 384, y: WALL_Y + 24 },
    ];
    const embers = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.1 + Math.random() * 0.35, ph: Math.random() * 6 }));

    let raf = 0;
    let t0 = performance.now();
    let built = false;
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30fps is plenty for a backdrop
      last = now;
      if (!img.complete) return;
      if (!built) {
        buildStatic();
        built = true;
      }
      const t = (now - t0) / 1000;
      const f4 = Math.floor(t * 6) % 4;
      const f4r = Math.floor(t * 10) % 4;
      const f3 = Math.floor(t * 6) % 3;
      ctx.drawImage(stat, 0, 0);

      // animated fountains
      draw(ctx, `wall_fountain_mid_red_anim_f${f3}`, 160, WALL_Y + 32);
      draw(ctx, `wall_fountain_basin_red_anim_f${f3}`, 160, FLOOR_Y);
      draw(ctx, `wall_fountain_mid_red_anim_f${f3}`, 304, WALL_Y + 32);
      draw(ctx, `wall_fountain_basin_red_anim_f${f3}`, 304, FLOOR_Y);

      // columns frame the hall
      draw(ctx, "column", 8, FLOOR_Y + 24);
      draw(ctx, "column", W - 24, FLOOR_Y + 24);

      // skeleton guards lurking by the gate
      draw(ctx, `skelet_idle_anim_f${f4}`, 188, FLOOR_Y + 10);
      draw(ctx, `skelet_idle_anim_f${(f4 + 2) % 4}`, 278, FLOOR_Y + 10, true);
      draw(ctx, `necromancer_anim_f${f4}`, 360, FLOOR_Y + 30, true);
      draw(ctx, `big_zombie_idle_anim_f${f4}`, 40, FLOOR_Y + 40);

      const { focus: fo, heroes: showHeroes, dim: dm } = props.current;
      if (showHeroes) {
        const party = [
          { base: "knight_m", x: 196, y: 222, flip: false },
          { base: "wizzard_m", x: 232, y: 226, flip: false },
          { base: "elf_m", x: 268, y: 222, flip: true },
        ];
        party.forEach((h, i) => {
          if (fo >= 0 && fo !== i) return;
          const run = fo === i;
          const fr = FRAMES[`${h.base}_${run ? "run" : "idle"}_anim_f${run ? f4r : f4}`];
          if (!fr) return;
          const x = fo >= 0 ? 232 : h.x;
          const y = fo >= 0 ? 226 : h.y;
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(x + 2, y - 2, 12, 2);
          ctx.fillRect(x + 4, y - 1, 8, 2);
          draw(ctx, `${h.base}_${run ? "run" : "idle"}_anim_f${run ? f4r : f4}`, x, y - fr[3], h.flip);
        });
      }

      // Darkness with banded (posterised) light pools.
      dx.globalCompositeOperation = "source-over";
      dx.clearRect(0, 0, W, H);
      dx.fillStyle = `rgba(6,3,12,${0.82 + dm * 0.12})`;
      dx.fillRect(0, 0, W, H);
      dx.globalCompositeOperation = "destination-out";
      const pool = (x: number, y: number, r: number, a: number) => {
        for (const [k, al] of [
          [1, 0.16],
          [0.86, 0.16],
          [0.72, 0.16],
          [0.58, 0.16],
          [0.44, 0.18],
          [0.3, 0.18],
        ] as const) {
          dx.fillStyle = `rgba(0,0,0,${al * a})`;
          dx.beginPath();
          dx.arc(x, y, Math.round(r * k), 0, Math.PI * 2);
          dx.fill();
        }
      };
      for (const tch of torches) {
        const fl = 1 + Math.sin(t * 9 + tch.x) * 0.05 + Math.sin(t * 23 + tch.x) * 0.03;
        pool(tch.x, tch.y + 12, 58 * fl, 1);
      }
      pool(240, 214, 82 + Math.sin(t * 2) * 2, 1); // the party's own light
      pool(240, WALL_Y + 40, 40, 0.6);
      ctx.drawImage(dark, 0, 0);

      // torch flames + warm glow (drawn after darkness, additive feel)
      ctx.globalCompositeOperation = "lighter";
      for (const tch of torches) {
        const fl = Math.sin(t * 11 + tch.x);
        for (const [r, a] of [
          [44, 0.025],
          [30, 0.035],
          [18, 0.05],
        ] as const) {
          ctx.fillStyle = `rgba(255,110,30,${a})`;
          ctx.beginPath();
          ctx.arc(tch.x, tch.y + 10, r + fl, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,120,30,0.10)";
        ctx.beginPath();
        ctx.arc(tch.x, tch.y + 2, 14 + fl, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,170,60,0.12)";
        ctx.beginPath();
        ctx.arc(tch.x, tch.y + 2, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      for (const tch of torches) {
        const fl = Math.floor(t * 12 + tch.x) % 3;
        ctx.fillStyle = "#2b1d12";
        ctx.fillRect(tch.x - 2, tch.y + 3, 4, 3);
        ctx.fillStyle = "#ff6a1a";
        ctx.fillRect(tch.x - 1, tch.y - 1 - fl, 3, 4 + fl);
        ctx.fillStyle = "#ffd25a";
        ctx.fillRect(tch.x, tch.y, 1, 2 + (fl % 2));
      }
      // embers
      for (const e of embers) {
        e.y -= e.v;
        e.x += Math.sin(t + e.ph) * 0.15;
        if (e.y < 0) {
          e.y = H;
          e.x = Math.random() * W;
        }
        const a = 0.35 + 0.35 * Math.sin(t * 3 + e.ph);
        ctx.fillStyle = e.ph > 4.5 ? `rgba(185,139,255,${a})` : `rgba(255,140,50,${a})`;
        ctx.fillRect(Math.floor(e.x), Math.floor(e.y), 1, 1);
      }
      // Stepped vignette.
      ctx.fillStyle = "rgba(4,2,8,0.5)";
      ctx.fillRect(0, 0, W, 6);
      ctx.fillRect(0, H - 6, W, 6);
      ctx.fillRect(0, 0, 6, H);
      ctx.fillRect(W - 6, 0, 6, H);
      if (dm > 0) {
        ctx.fillStyle = `rgba(4,2,8,${dm})`;
        ctx.fillRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(frame);

    // Integer "cover" scaling keeps every pixel square.
    const fit = () => {
      const s = Math.max(1, Math.ceil(Math.max(window.innerWidth / W, window.innerHeight / H)));
      c.style.width = `${W * s}px`;
      c.style.height = `${H * s}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div className="crypt-bg">
      <canvas ref={ref} width={W} height={H} />
    </div>
  );
}
