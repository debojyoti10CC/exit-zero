// Renders the gameplay trailer: drives /?trailer in headless Edge/Chrome frame by
// frame, captures every frame + the synthesised soundtrack, then ffmpeg makes a
// 1080p MP4. Usage: (dev server running) node scripts/render-trailer.mjs [outDir] [from] [to]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const URL = process.env.TRAILER_URL || "http://localhost:5173/?trailer";
const OUT = path.resolve(process.argv[2] || "../../trailer");
const FROM = Number(process.argv[3] ?? 0);
const TO = process.argv[4] ? Number(process.argv[4]) : undefined;
const FRAMES_DIR = path.join(OUT, "frames");
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[page]", m.text());
});
page.on("pageerror", (e) => console.log("[page error]", e.message));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__trailerReady === true, null, { timeout: 60000 });
const total = await page.evaluate(() => window.__trailer.FRAMES);
const fps = await page.evaluate(() => window.__trailer.FPS);
const end = TO ?? total;
console.log(`Rendering frames ${FROM}..${end - 1} of ${total} @ ${fps}fps with ${path.basename(executablePath)}`);

const t0 = Date.now();
for (let i = 0; i < end; i++) {
  const url = await page.evaluate((n) => window.__trailer.frame(n), i);
  if (i < FROM) continue;
  fs.writeFileSync(path.join(FRAMES_DIR, `f${String(i).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
  if (i % 30 === 0) console.log(`  frame ${i}/${end}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

console.log("Rendering soundtrack…");
const wav = await page.evaluate(() => window.__trailer.audio());
fs.writeFileSync(path.join(OUT, "soundtrack.wav"), Buffer.from(wav, "base64"));
await browser.close();

if (FROM === 0 && end === total) {
  const mp4 = path.join(OUT, "exit-zero-trailer.mp4");
  console.log("Encoding", mp4);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(FRAMES_DIR, "f%04d.png"),
      "-i", path.join(OUT, "soundtrack.wav"),
      "-vf", "scale=1920:1080:flags=neighbor",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-tune", "animation",
      "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  console.log("Done:", mp4);
}
