import Phaser from "phaser";

/** Hand-drawn pixel icons for treasure the tileset does not include. */
export const ICONS: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  coins: {
    rows: [
      "....aaa.....",
      "...abbba....",
      "..abcbbba...",
      "..abbbbba.aa",
      "...abbba.abb",
      ".aaaaaaaabcb",
      "abbbbbbbbaba",
      "abcbbbcbbbba",
      ".aaaaaaaaaa.",
    ],
    pal: { a: "#4a2a10", b: "#f2b63c", c: "#fff2a8" },
  },
  gem: {
    rows: [
      "....aaaa....",
      "...abbbba...",
      "..abbccbba..",
      ".abbccccbba.",
      "abbbccccbbba",
      ".abbbccbbba.",
      "..abbbbbba..",
      "...abbbba...",
      "....abba....",
      ".....aa.....",
    ],
    pal: { a: "#1b1030", b: "#7f5cff", c: "#d8c8ff" },
  },
  chalice: {
    rows: [
      ".aaaaaaaaaa.",
      ".abbbbbbbba.",
      ".abccbbbbba.",
      "..abbbbbba..",
      "...abbbba...",
      "....abba....",
      "....abba....",
      "...abbbba...",
      "..abbbbbba..",
      "..aaaaaaaa..",
    ],
    pal: { a: "#3d2410", b: "#e0a63a", c: "#fff0b0" },
  },
  idol: {
    rows: [
      "....aaaa....",
      "...abbbba...",
      "...acbcba...",
      "...abbbba...",
      "....abba....",
      "..aabbbbaa..",
      "..abbccbba..",
      "...abbbba...",
      "...abbbba...",
      "..aaaaaaaa..",
    ],
    pal: { a: "#10241a", b: "#3fae7a", c: "#b6ffd8" },
  },
  crown: {
    rows: [
      "a....aa....a",
      "ab..abba..ab",
      "abaabbbbaaba",
      "abbbbbbbbbba",
      "abdbbdbbdbba",
      "abbbbbbbbbba",
      "accccccccca.",
      "aaaaaaaaaaaa",
    ],
    pal: { a: "#3a2108", b: "#ffcc33", c: "#fff4c0", d: "#ff3b5c" },
  },
  heart: {
    rows: [
      ".aa....aa.",
      "abba..abba",
      "abccbabbba",
      "abcbbbbbba",
      "abbbbbbbba",
      ".abbbbbba.",
      "..abbbba..",
      "...abba...",
      "....aa....",
    ],
    pal: { a: "#2a0610", b: "#e8264f", c: "#ffb3c4" },
  },
  aegis: {
    rows: [
      "aaaaaaaaaa",
      "abbbbbbbba",
      "abccbddbba",
      "abcbbddbba",
      "abbddddbba",
      ".abbddbba.",
      ".abbddbba.",
      "..abbbba..",
      "...abba...",
      "....aa....",
    ],
    pal: { a: "#16202e", b: "#6c8fb8", c: "#d4e6ff", d: "#e8c35a" },
  },
  key: {
    rows: [
      ".aaa........",
      "abbba.......",
      "ab.ba.......",
      "abbbaaaaaaaa",
      ".aaabbbbbbba",
      ".......ab.ba",
      ".......a..a.",
    ],
    pal: { a: "#3a2a08", b: "#ffd65a" },
  },
  bone: {
    rows: ["aa....aa", "abaaaaba", ".abbbba.", "abaaaaba", "aa....aa"],
    pal: { a: "#2a2420", b: "#efe6d2" },
  },
  skullmark: {
    rows: [".aaaaa.", "abbbbba", "abaabaa", "abbbbba", ".ababa.", ".aaaaa."],
    pal: { a: "#200808", b: "#ff4d4d" },
  },
};

function drawIcon(scene: Phaser.Scene, key: string, rows: string[], pal: Record<string, string>) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  tex.refresh();
}

function radial(scene: Phaser.Scene, key: string, size: number, stops: [number, string][]) {
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export function makeTextures(scene: Phaser.Scene) {
  for (const [k, v] of Object.entries(ICONS)) drawIcon(scene, `icon_${k}`, v.rows, v.pal);

  // Light mask (erased from darkness) — smooth falloff.
  radial(scene, "light", 256, [
    [0, "rgba(255,255,255,1)"],
    [0.35, "rgba(255,255,255,0.85)"],
    [0.7, "rgba(255,255,255,0.3)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  // Additive coloured glow.
  radial(scene, "glow", 128, [
    [0, "rgba(255,255,255,0.9)"],
    [0.25, "rgba(255,255,255,0.45)"],
    [0.6, "rgba(255,255,255,0.12)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  radial(scene, "orb", 16, [
    [0, "rgba(255,255,255,1)"],
    [0.4, "rgba(255,255,255,0.9)"],
    [1, "rgba(255,255,255,0)"],
  ]);

  // Soft contact shadow.
  {
    const t = scene.textures.createCanvas("shadow", 16, 6)!;
    const c = t.getContext();
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.ellipse(8, 3, 7, 2.6, 0, 0, Math.PI * 2);
    c.fill();
    t.refresh();
  }
  // 1-2px particles.
  {
    const t = scene.textures.createCanvas("px", 2, 2)!;
    const c = t.getContext();
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 2, 2);
    t.refresh();
    const t1 = scene.textures.createCanvas("px1", 1, 1)!;
    t1.getContext().fillStyle = "#fff";
    t1.getContext().fillRect(0, 0, 1, 1);
    t1.refresh();
  }
  // Loot beam: vertical gradient pillar.
  {
    const t = scene.textures.createCanvas("beam", 8, 64)!;
    const c = t.getContext();
    const g = c.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 64);
    const g2 = c.createLinearGradient(0, 0, 8, 0);
    g2.addColorStop(0, "rgba(0,0,0,0.6)");
    g2.addColorStop(0.5, "rgba(0,0,0,0)");
    g2.addColorStop(1, "rgba(0,0,0,0.6)");
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = g2;
    c.fillRect(0, 0, 8, 64);
    t.refresh();
  }
  // Rings for shockwaves / portal.
  {
    const t = scene.textures.createCanvas("ring", 64, 64)!;
    const c = t.getContext();
    c.strokeStyle = "#fff";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(32, 32, 29, 0, Math.PI * 2);
    c.stroke();
    t.refresh();
  }
  // Portal swirl (spiral arms).
  {
    const s = 48;
    const t = scene.textures.createCanvas("swirl", s, s)!;
    const c = t.getContext();
    c.translate(s / 2, s / 2);
    for (let arm = 0; arm < 3; arm++) {
      c.rotate((Math.PI * 2) / 3);
      for (let i = 0; i < 40; i++) {
        const a = i * 0.16;
        const r = i * 0.55;
        c.fillStyle = `rgba(255,255,255,${0.9 - i / 48})`;
        c.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2);
      }
    }
    t.refresh();
  }
  // Slash arc.
  {
    const t = scene.textures.createCanvas("slash", 32, 32)!;
    const c = t.getContext();
    c.translate(16, 16);
    for (let i = 0; i < 14; i++) {
      const a = -0.95 + i * 0.14;
      c.strokeStyle = `rgba(255,255,255,${0.25 + (i / 14) * 0.75})`;
      c.lineWidth = 1 + (i / 14) * 2;
      c.beginPath();
      c.arc(0, 0, 13, a, a + 0.16);
      c.stroke();
    }
    t.refresh();
  }
  // Vignette-style danger wedge is drawn with Graphics at runtime.
}

/** Registers every frame from tile_list_v1.7 on the tileset texture. */
export function registerAtlas(scene: Phaser.Scene, list: string) {
  const tex = scene.textures.get("dungeon");
  for (const line of list.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [name, x, y, w, h] = [parts[0], +parts[1], +parts[2], +parts[3], +parts[4]];
    if (!tex.has(name)) tex.add(name, 0, x, y, w, h);
  }
}

export function makeAnims(scene: Phaser.Scene) {
  const mk = (key: string, base: string, n: number, rate: number, repeat = -1) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({
      key,
      frames: Array.from({ length: n }, (_, i) => ({ key: "dungeon", frame: `${base}_f${i}` })),
      frameRate: rate,
      repeat,
    });
  };
  for (const hero of ["knight_m", "wizzard_m", "elf_m", "knight_f", "wizzard_f", "elf_f"]) {
    mk(`${hero}_idle`, `${hero}_idle_anim`, 4, 6);
    mk(`${hero}_run`, `${hero}_run_anim`, 4, 12);
  }
  mk("skelet_idle", "skelet_idle_anim", 4, 6);
  mk("skelet_run", "skelet_run_anim", 4, 10);
  mk("necro", "necromancer_anim", 4, 6);
  mk("bigz_idle", "big_zombie_idle_anim", 4, 5);
  mk("bigz_run", "big_zombie_run_anim", 4, 8);
  mk("demon_idle", "big_demon_idle_anim", 4, 5);
  mk("demon_run", "big_demon_run_anim", 4, 8);
  mk("imp_idle", "imp_idle_anim", 4, 8);
  mk("imp_run", "imp_run_anim", 4, 12);
  mk("chest_open", "chest_full_open_anim", 3, 10, 0);
  mk("chest_mimic", "chest_mimic_open_anim", 3, 10, 0);
  mk("coin", "coin_anim", 4, 8);
  mk("fountain_red", "wall_fountain_mid_red_anim", 3, 6);
  mk("basin_red", "wall_fountain_basin_red_anim", 3, 6);
  mk("fountain_blue", "wall_fountain_mid_blue_anim", 3, 6);
  mk("basin_blue", "wall_fountain_basin_blue_anim", 3, 6);
}
