import { useEffect, useRef } from "react";
import { heroFrames, hollowFrames } from "../game/reaperArt";

// Spirit-reaper theme backdrop: a Japanese town at night under a full moon,
// a torii gate, stone lanterns with spirit flames, drifting petals, and
// Hollows creeping in from the dark. 480x270, integer-scaled to cover.

const W = 480;
const H = 270;
const GROUND = 196;

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface SceneProps {
  focus?: number;
  dim?: number;
  heroes?: boolean;
}

export function SpiritTownScene({ focus = -1, dim = 0, heroes = true }: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ focus, dim, heroes });
  props.current = { focus, dim, heroes };

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // ---- static layer -----------------------------------------------------
    const stat = document.createElement("canvas");
    stat.width = W;
    stat.height = H;
    const g = stat.getContext("2d")!;
    const rect = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    // Sky: stepped bands.
    const bands = ["#05070f", "#070a16", "#0a0e1e", "#0d1328", "#111a33", "#16213d"];
    bands.forEach((col, i) => rect(0, (i * GROUND) / bands.length, W, GROUND / bands.length + 1, col));

    // Moon halo (banded) + full moon.
    const MX = 240,
      MY = 78,
      MR = 46;
    [
      [MR + 34, "rgba(159,224,255,0.05)"],
      [MR + 20, "rgba(159,224,255,0.07)"],
      [MR + 9, "rgba(207,232,255,0.10)"],
    ].forEach(([r, col]) => {
      g.fillStyle = col as string;
      g.beginPath();
      g.arc(MX, MY, r as number, 0, Math.PI * 2);
      g.fill();
    });
    for (let y = -MR; y <= MR; y++) {
      const half = Math.floor(Math.sqrt(MR * MR - y * y));
      for (let x = -half; x <= half; x++) {
        const edge = x * x + y * y > (MR - 2) * (MR - 2);
        const crater = hash(Math.floor((x + 60) / 6), Math.floor((y + 60) / 6)) < 0.16 && !edge;
        g.fillStyle = edge ? "#cfe0f2" : crater ? "#dfe8f4" : "#f4f7fc";
        g.fillRect(MX + x, MY + y, 1, 1);
      }
    }

    // Far mountains.
    g.fillStyle = "#0b1124";
    g.beginPath();
    g.moveTo(0, 150);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, 132 + Math.sin(x / 37) * 10 + Math.sin(x / 13) * 4 + hash(x, 3) * 4);
    g.lineTo(W, GROUND);
    g.lineTo(0, GROUND);
    g.fill();

    // Town rooftops with upturned eaves and warm windows.
    const roof = (x: number, w: number, top: number, col: string) => {
      rect(x + 4, top + 8, w - 8, GROUND - top - 8, col);
      // eave: wide slab with tips flicked upward
      rect(x - 4, top + 4, w + 8, 4, "#05060c");
      rect(x - 6, top + 2, 3, 3, "#05060c");
      rect(x + w + 3, top + 2, 3, 3, "#05060c");
      rect(x + 2, top, w - 4, 4, "#05060c");
      for (let k = 0; k < Math.floor(w / 10); k++) {
        if (hash(x, k) < 0.45) rect(x + 8 + k * 9, top + 14 + (k % 2) * 8, 4, 4, hash(k, x) < 0.5 ? "#ffcf6a" : "#e8a040");
      }
    };
    roof(-4, 54, 150, "#080a14");
    roof(56, 46, 160, "#0a0c18");
    roof(330, 50, 156, "#0a0c18");
    roof(388, 64, 146, "#080a14");
    roof(452, 40, 162, "#0a0c18");

    // Five-tier pagoda on the left.
    const PX = 112;
    for (let t = 0; t < 5; t++) {
      const w = 54 - t * 8;
      const y = 176 - t * 18;
      rect(PX - w / 2 + 6, y - 10, w - 12, 12, "#080a14");
      rect(PX - w / 2, y - 12, w, 3, "#05060c");
      rect(PX - w / 2 - 3, y - 14, 3, 3, "#05060c");
      rect(PX + w / 2, y - 14, 3, 3, "#05060c");
      if (t % 2 === 0) rect(PX - 2, y - 7, 4, 4, "#ffcf6a");
    }
    rect(PX - 1, 176 - 5 * 18 - 14, 2, 14, "#05060c");

    // Ground: stone courtyard.
    rect(0, GROUND, W, H - GROUND, "#0d1020");
    for (let y = GROUND; y < H; y += 8) {
      const off = ((y - GROUND) / 8) % 2 ? 0 : 8;
      for (let x = -off; x < W; x += 16) {
        const shade = 0.4 + hash(x, y) * 0.25;
        g.fillStyle = `rgba(${Math.round(40 * shade)},${Math.round(46 * shade)},${Math.round(70 * shade)},1)`;
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    // Stone path to the gate.
    for (let y = GROUND + 2; y < H; y += 6) {
      const w = 44 + (y - GROUND) * 0.9;
      rect(MX - w / 2, y, w, 4, "#2a2f45");
      rect(MX - w / 2, y + 4, w, 1, "#1a1e30");
    }

    // Torii gate.
    const TL = MX - 62,
      TR = MX + 50;
    rect(TL, 120, 12, GROUND - 120, "#a0142a");
    rect(TR, 120, 12, GROUND - 120, "#a0142a");
    rect(TL + 2, 120, 3, GROUND - 120, "#c8283c");
    rect(TR + 2, 120, 3, GROUND - 120, "#c8283c");
    rect(TL - 4, GROUND - 6, 20, 6, "#16171f");
    rect(TR - 4, GROUND - 6, 20, 6, "#16171f");
    rect(TL - 10, 132, TR - TL + 32, 6, "#a0142a"); // nuki
    rect(TL - 18, 112, TR - TL + 48, 8, "#05060c"); // kasagi
    rect(TL - 22, 108, 6, 6, "#05060c");
    rect(TR + 28, 108, 6, 6, "#05060c");
    rect(TL - 14, 120, TR - TL + 40, 5, "#c0182e"); // shimaki
    rect(MX - 6, 120, 12, 12, "#a0142a"); // gakuzuka

    // Stone lanterns (toro).
    const lantern = (x: number) => {
      rect(x - 8, GROUND - 4, 16, 4, "#2a2f45");
      rect(x - 2, GROUND - 22, 4, 18, "#2a2f45");
      rect(x - 8, GROUND - 28, 16, 6, "#3a4058");
      rect(x - 6, GROUND - 36, 12, 8, "#2a2f45");
      rect(x - 10, GROUND - 40, 20, 4, "#3a4058");
      rect(x - 3, GROUND - 44, 6, 4, "#3a4058");
    };
    lantern(150);
    lantern(330);

    // ---- animation ----------------------------------------------------------
    const petals = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.15 + Math.random() * 0.35, ph: Math.random() * 6 }));
    const stars = Array.from({ length: 50 }, (_, k) => ({ x: Math.floor(hash(k, 9) * W), y: Math.floor(hash(9, k) * 120), k }));
    const dark = document.createElement("canvas");
    dark.width = W;
    dark.height = H;
    const dx = dark.getContext("2d")!;

    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;
      last = now;
      const t = (now - t0) / 1000;
      ctx.drawImage(stat, 0, 0);
      for (const s of stars) {
        if (Math.hypot(s.x - MX, s.y - MY) < MR + 30) continue;
        if (Math.floor(t * 1.5 + s.k) % 9 === 0) continue;
        ctx.fillStyle = s.k % 6 === 0 ? "#cfe8ff" : "#3a4566";
        ctx.fillRect(s.x, s.y, 1, 1);
      }

      // Hollows lurking at the edges (white masks, glowing eyes).
      const f2 = Math.floor(t * 3) % 2;
      const big = hollowFrames(3)[f2];
      ctx.drawImage(big, 18, GROUND - 26);
      const lesser = hollowFrames(1);
      ctx.drawImage(lesser[f2], 400, GROUND + 4);
      ctx.save();
      ctx.translate(446 + 16, GROUND + 14);
      ctx.scale(-1, 1);
      ctx.drawImage(lesser[(f2 + 1) % 2], 0, 0);
      ctx.restore();
      ctx.drawImage(hollowFrames(2)[f2], 60, GROUND + 22);

      // Reapers on the path, drawn at 2x.
      const { focus: fo, heroes: show, dim: dm } = props.current;
      if (show || fo >= 0) {
        const party = [
          { cls: 0, x: MX - 52, y: GROUND + 60, flip: false },
          { cls: 1, x: MX - 16, y: GROUND + 66, flip: false },
          { cls: 2, x: MX + 22, y: GROUND + 60, flip: true },
        ];
        party.forEach((h) => {
          if (fo >= 0 && fo !== h.cls) return;
          const fr = heroFrames(h.cls);
          const idx = fo === h.cls ? 2 + (Math.floor(t * 10) % 4) : Math.floor(t * 2.5) % 2;
          const x = fo >= 0 ? MX - 16 : h.x;
          const y = fo >= 0 ? GROUND + 66 : h.y;
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(x + 6, y - 3, 20, 3);
          ctx.save();
          if (h.flip) {
            ctx.translate(x + 32, y - 48);
            ctx.scale(-1, 1);
            ctx.drawImage(fr[idx], 0, 0, 32, 48);
          } else ctx.drawImage(fr[idx], x, y - 48, 32, 48);
          ctx.restore();
        });
      }

      // Darkness with moon, window and spirit-flame light pools (banded).
      dx.globalCompositeOperation = "source-over";
      dx.clearRect(0, 0, W, H);
      dx.fillStyle = `rgba(2,4,12,${0.45 + dm * 0.35})`;
      dx.fillRect(0, 0, W, H);
      dx.globalCompositeOperation = "destination-out";
      const pool = (x: number, y: number, r: number, a: number) => {
        for (const [k, al] of [
          [1, 0.2],
          [0.75, 0.25],
          [0.5, 0.3],
        ] as const) {
          dx.fillStyle = `rgba(0,0,0,${al * a})`;
          dx.beginPath();
          dx.arc(x, y, Math.round(r * k), 0, Math.PI * 2);
          dx.fill();
        }
      };
      pool(MX, MY, 120, 1);
      pool(MX, GROUND + 40, 90, 0.9);
      const fl = 1 + Math.sin(t * 8) * 0.05;
      pool(150, GROUND - 32, 40 * fl, 1);
      pool(330, GROUND - 32, 40 * fl, 1);
      ctx.drawImage(dark, 0, 0);

      // Spirit flames in the lanterns.
      for (const lx of [150, 330]) {
        const k = Math.floor(t * 12 + lx) % 3;
        ctx.fillStyle = "rgba(90,170,255,0.18)";
        ctx.beginPath();
        ctx.arc(lx, GROUND - 32, 10 + k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a9cff";
        ctx.fillRect(lx - 2, GROUND - 34 - k, 4, 5 + k);
        ctx.fillStyle = "#e8f6ff";
        ctx.fillRect(lx - 1, GROUND - 33, 2, 3);
      }

      // Hollow eyes glow in the dark.
      if (Math.floor(t * 2) % 5 !== 0) {
        ctx.fillStyle = "#ffde5a";
        ctx.fillRect(18 + 10, GROUND - 26 + 10 + (f2 ? 2 : 0), 2, 2);
        ctx.fillRect(18 + 20, GROUND - 26 + 10 + (f2 ? 2 : 0), 2, 2);
      }

      // Drifting petals and spirit motes.
      for (const p of petals) {
        p.y += p.v;
        p.x += 0.35 + Math.sin(t * 1.3 + p.ph) * 0.3;
        if (p.y > H) {
          p.y = -2;
          p.x = Math.random() * W;
        }
        if (p.x > W) p.x = 0;
        ctx.fillStyle = p.ph > 4.6 ? "rgba(159,224,255,0.8)" : p.ph > 2.2 ? "#f2a0b8" : "#ffd0dc";
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.ph > 4.6 ? 1 : 2, 1);
      }

      // Ground mist.
      ctx.fillStyle = "rgba(159,190,230,0.05)";
      ctx.fillRect(0, GROUND - 6 + Math.sin(t) * 2, W, 10);
      if (dm > 0) {
        ctx.fillStyle = `rgba(3,4,10,${dm})`;
        ctx.fillRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(frame);

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
