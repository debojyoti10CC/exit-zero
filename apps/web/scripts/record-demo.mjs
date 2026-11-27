// Records a full EXIT//ZERO demo in a real Chrome window:
// title → join a crypt (online, devnet rollup) → VRF seed → play → extract → settle
// → Relic Vault → mint the relic as a Metaplex Core NFT.
// Usage: node scripts/record-demo.mjs [url] [outDir] [mode=online|practice]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const URL = process.argv[2] || "http://localhost:5180/";
const OUT = process.argv[3] || "recordings";
const MODE = process.argv[4] || "online";
const GUEST = process.env.GUEST_KEY || ""; // optional JSON secret key array for the guest identity
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--window-size=1296,820", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
if (GUEST) await context.addInitScript((k) => localStorage.setItem("exitzero.guest.v1", k), GUEST);
await context.addInitScript(() => {
  localStorage.setItem("exitzero.name", "Debo");
  localStorage.setItem("exitzero.class", "0");
});
const page = await context.newPage();

// Capture every rendered frame via the DevTools screencast; ffmpeg stitches them at the end.
const FR = path.join(OUT, `frames-${Date.now()}`);
fs.mkdirSync(FR, { recursive: true });
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", async (f) => {
  const file = path.join(FR, `${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, "base64"));
  frames.push({ file, ts: f.metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
page.on("console", (m) => {
  if (m.type() === "error") log("page error:", m.text().slice(0, 160));
});
const sleep = (ms) => page.waitForTimeout(ms);
const clickText = async (t, timeout = 15000) => {
  const b = page.locator("button", { hasText: t }).first();
  await b.waitFor({ state: "visible", timeout });
  await b.hover();
  await sleep(250);
  await b.click();
};

log("open", URL);
await page.goto(URL);
await sleep(4500); // title screen

if (MODE === "practice") {
  await clickText("Practice");
  await sleep(1200);
  await clickText("Quick run");
} else {
  await clickText("Enter the Crypt");
  await page.locator(".room-card").first().waitFor({ timeout: 20000 });
  await sleep(2500);
  // Join the first gathering crypt (reopen a stuck one if needed).
  const joined = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".room-card")];
    const c = cards.find((c) => /GATHERING 0\/4/i.test(c.innerText));
    if (!c) return false;
    c.querySelector("button").click();
    return true;
  });
  if (!joined) throw new Error("no free crypt");
  await page.locator("button", { hasText: "Open the Crypt" }).waitFor({ timeout: 30000 });
  await sleep(2500);
  await clickText("Open the Crypt");
}
await page.locator(".hud").waitFor({ timeout: 60000 });
log("in game");

// ---------------------------------------------------------------- autopilot
await page.evaluate(() => {
  const sc = window.__ez.scene.getScene("game");
  const TILE = 256;
  const W = () => sc.world;
  const isWall = (tx, ty) => {
    const w = W();
    if (tx < 0 || ty < 0 || tx >= 64 || ty >= 48) return true;
    const i = ty * 64 + tx;
    return (w.walls[i >> 3] & (1 << (i & 7))) !== 0;
  };
  const step = (sx, sy, tx, ty) => {
    const prev = new Int32Array(64 * 48).fill(-1);
    const q = [ty * 64 + tx];
    prev[ty * 64 + tx] = ty * 64 + tx;
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      const x = c % 64, y = (c / 64) | 0;
      if (x === sx && y === sy) return prev[c];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (isWall(nx, ny) || prev[ny * 64 + nx] !== -1) continue;
        prev[ny * 64 + nx] = c;
        q.push(ny * 64 + nx);
      }
    }
    return -1;
  };
  const value = (it) => [0, 20, 45, 60, 90, 140, 70, 70, 0, 0, 160][it.kind] * [10, 15, 30, 60, 120][it.rarity] / 10;
  const keys = ["W", "A", "S", "D"];
  const st = { goal: null, lastInteract: 0, visited: new Set(), wander: null, wanderUntil: 0 };
  window.__pilot = st;
  const aimAt = (wx, wy) => {
    const cam = sc.cameras.main;
    const z = cam.zoom;
    const sx = (wx / 16 - cam.worldView.x) * z;
    const sy = (wy / 16 - cam.worldView.y) * z;
    const p = sc.input.activePointer;
    p.x = sx;
    p.y = sy;
    p.worldX = wx / 16;
    p.worldY = wy / 16;
  };
  setInterval(() => {
    const w = W();
    if (!w || !sc.pred) return;
    const me = w.players[sc.me];
    keys.forEach((k) => (sc.keys[k].isDown = false));
    if (me.state !== 1) return;
    const p = sc.pred;
    const d2 = (x, y) => (x - p.x) ** 2 + (y - p.y) ** 2;
    const boss = w.monsters[w.bossIdx];
    const nearBoss = (x, y) => boss && boss.hp > 0 && (boss.x - x) ** 2 + (boss.y - y) ** 2 < (TILE * 7) ** 2;
    const portalsOpen = w.tick >= w.portalTick;
    const rare = me.inv.some((i) => i.kind && i.rarity >= 2);
    const loot = me.inv.reduce((s, i) => s + (i.kind ? value(i) : 0), 0);
    const full = me.inv.every((i) => i.kind);
    const lowHp = me.hp < me.maxHp * 0.4;

    // potion / dodge / fight
    if (me.hp < me.maxHp * 0.5 && me.potions > 0 && me.potionReady <= w.tick) sc.doPotion();
    const foes = w.monsters
      .filter((m) => m.kind && m.hp > 0)
      .map((m) => ({ m, d: Math.sqrt(d2(m.x, m.y)) }))
      .sort((a, b) => a.d - b.d);
    const foe = foes[0];
    if (foe && foe.m.state === 2 && foe.d < 520 && me.dodgeReady <= w.tick && Math.random() < 0.6) {
      const a = Math.atan2(p.y - foe.m.y, p.x - foe.m.x);
      sc.aim = Math.round((a / (2 * Math.PI)) * 256) & 255;
      if (Math.abs(Math.cos(a)) > 0.4) sc.keys[Math.cos(a) > 0 ? "D" : "A"].isDown = true;
      if (Math.abs(Math.sin(a)) > 0.4) sc.keys[Math.sin(a) > 0 ? "S" : "W"].isDown = true;
      sc.doDodge();
      return;
    }

    // choose goal
    let goal = null;
    let interact = false;
    if (portalsOpen && (rare || loot >= 250 || w.tick > w.portalTick + 450 || lowHp)) {
      const ps = w.portals.filter((q) => q.tx || q.ty).map((q) => ({ x: q.tx * TILE + 128, y: q.ty * TILE + 128 })).filter((q) => !nearBoss(q.x, q.y));
      ps.sort((a, b) => d2(a.x, a.y) - d2(b.x, b.y));
      goal = ps[0] ? { ...ps[0], r: 60 } : null;
    }
    if (!goal && !full) {
      const drop = w.drops.filter((d) => d.item.kind && !nearBoss(d.x, d.y)).map((d) => ({ x: d.x, y: d.y, dd: d2(d.x, d.y) })).filter((d) => d.dd < (TILE * 10) ** 2).sort((a, b) => a.dd - b.dd)[0];
      if (drop) goal = { x: drop.x, y: drop.y, r: 60 };
    }
    if (!goal) {
      const ch = w.chests
        .filter((c) => (c.tx || c.ty) && c.state === 0 && c.tier < 2 && !nearBoss(c.tx * TILE + 128, c.ty * TILE + 128))
        .map((c) => ({ x: c.tx * TILE + 128, y: c.ty * TILE + 128 }))
        .sort((a, b) => d2(a.x, a.y) - d2(b.x, b.y))[0];
      if (ch) {
        goal = { ...ch, r: 200 };
        if (d2(ch.x, ch.y) < 330 ** 2) interact = true;
      }
    }
    if (!goal) {
      if (!st.wander || performance.now() > st.wanderUntil || d2(st.wander.x, st.wander.y) < TILE ** 2) {
        const rooms = w.rooms.slice(0, w.roomCount).filter((r) => r.kind !== 4);
        const r = rooms[Math.floor(Math.random() * rooms.length)];
        st.wander = { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE, r: TILE };
        st.wanderUntil = performance.now() + 9000;
      }
      goal = st.wander;
    }
    // Low HP and no potions: back away from the nearest foe.
    if (lowHp && me.potions === 0 && foe && foe.d < 700 && !(portalsOpen && goal)) {
      goal = { x: p.x + (p.x - foe.m.x) * 2, y: p.y + (p.y - foe.m.y) * 2, r: 60 };
    }
    st.goal = goal;

    // fight what is close
    if (foe && foe.d < 470 && foe.m.kind !== 4) {
      aimAt(foe.m.x, foe.m.y);
      sc.aim = Math.round((Math.atan2(foe.m.y - p.y, foe.m.x - p.x) / (2 * Math.PI)) * 256) & 255;
      sc.doAttack();
      if (Math.random() < 0.05) sc.doSpecial();
    } else if (goal) aimAt(goal.x, goal.y);

    if (interact && performance.now() - st.lastInteract > 1500) {
      st.lastInteract = performance.now();
      sc.session.interact();
    }
    // move towards goal along the grid path
    if (goal && d2(goal.x, goal.y) > goal.r ** 2) {
      let wx = goal.x, wy = goal.y;
      const n = step(Math.floor(p.x / TILE), Math.floor(p.y / TILE), Math.floor(goal.x / TILE), Math.floor(goal.y / TILE));
      if (n >= 0) {
        const nx = n % 64, ny = (n / 64) | 0;
        if (!(nx === Math.floor(goal.x / TILE) && ny === Math.floor(goal.y / TILE))) {
          wx = nx * TILE + 128;
          wy = ny * TILE + 128;
        }
      }
      const dx = wx - p.x, dy = wy - p.y;
      if (dx > 30) sc.keys.D.isDown = true;
      if (dx < -30) sc.keys.A.isDown = true;
      if (dy > 30) sc.keys.S.isDown = true;
      if (dy < -30) sc.keys.W.isDown = true;
    }
  }, 50);
});

// ---------------------------------------------------------------- watch the run
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 8 * 60_000) {
  const s = await page.evaluate(() => {
    const sc = window.__ez?.scene.getScene("game");
    const w = sc?.world;
    if (!w) return null;
    const me = w.players[sc.me];
    return { tick: w.tick, hp: me.hp, state: me.state, items: me.inv.filter((i) => i.kind).map((i) => i.rarity).join(""), kills: me.kills, results: !!document.querySelector(".result-title") };
  });
  if (s) {
    const line = `tick ${s.tick} hp ${s.hp} state ${s.state} kills ${s.kills} items[${s.items}]`;
    if (line !== last) log(line);
    last = line;
    if (s.results) break;
  }
  await sleep(5000);
}
log("results");
const outcome = await page.evaluate(() => document.querySelector(".result-title")?.textContent);
log("outcome", outcome);
await sleep(14000); // XP ledger, standings, settlement

if (MODE !== "practice" && outcome === "EXTRACTED") {
  // Settlement must land on Solana before the relic can be minted.
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => /committed/i.test(document.querySelector(".proof")?.innerText || ""));
    if (done) break;
    await sleep(2000);
  }
  await sleep(3000);
  await clickText("Crypt list");
  await sleep(2500);
  await clickText("Back");
  await sleep(2000);
  await clickText("Relic Vault");
  await sleep(4000);
  let minted = false;
  for (let i = 0; i < 24 && !minted; i++) {
    const claim = page.locator("button", { hasText: "Claim NFT" }).first();
    if (await claim.isVisible().catch(() => false)) {
      await claim.hover();
      await sleep(700);
      await claim.click();
      log("claim clicked");
      await page.locator(".claim-note").first().waitFor({ timeout: 60000 }).catch(() => {});
      await sleep(1500);
      const note = await page.evaluate(() => document.querySelector(".claim-note")?.innerText || "");
      log("claim note:", note.replace(/\n/g, " | "));
      minted = /minted/i.test(note);
      if (!minted) await sleep(4000);
    } else {
      // Relic not yet committed to Solana: refresh the vault.
      await sleep(5000);
      await clickText("Back");
      await sleep(1200);
      await clickText("Relic Vault");
      await sleep(3500);
    }
  }
  await sleep(6000);
  log(minted ? "NFT minted" : "NFT not minted");
}

await sleep(1500);
await cdp.send("Page.stopScreencast").catch(() => {});
await context.close();
await browser.close();
const final = path.join(OUT, `exitzero-${MODE}-${outcome === "EXTRACTED" ? "extracted" : "run"}-${Date.now()}.mp4`);
const list = path.join(FR, "list.txt");
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].ts - frames[i].ts) : 0.5;
  lines.push(`file '${frames[i].file.split(path.sep).join("/")}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file.split(path.sep).join("/")}'`);
fs.writeFileSync(list, lines.join(String.fromCharCode(10)));
log(`frames ${frames.length}, encoding…`);
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,scale=1280:720:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", final], { stdio: "inherit" });
log("saved", final);
