// Renders the gameplay trailer: drives /?trailer in headless Edge/Chrome frame by
// frame, captures every frame + the synthesised soundtrack, then ffmpeg makes a
// 1080p MP4. Usage: (dev server running) node scripts/render-trailer.mjs [outDir] [from] [to]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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
  const name = process.env.TRAILER_NAME || "exit-zero-trailer";
  const mp4 = path.join(OUT, `${name}.mp4`);
  const wavIn = path.join(OUT, "soundtrack.wav");
  // Two-pass loudness normalisation: -14 LUFS integrated, true peak under -1 dBTP.
  const target = "I=-14:TP=-1.5:LRA=11";
  const r = (() => {
    const res = loudnormReport(["-hide_banner", "-nostats", "-i", wavIn, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
    return JSON.parse(res.slice(res.lastIndexOf("{"), res.lastIndexOf("}") + 1));
  })();
  const af = `loudnorm=${target}:measured_I=${r.input_i}:measured_TP=${r.input_tp}:measured_LRA=${r.input_lra}:measured_thresh=${r.input_thresh}:offset=${r.target_offset}:linear=true,alimiter=limit=0.8:attack=1:release=50:level=false,aresample=48000`;
  console.log("Loudness in:", r.input_i, "LUFS,", r.input_tp, "dBTP");
  console.log("Encoding", mp4);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(FRAMES_DIR, "f%04d.png"),
      "-i", wavIn,
      "-vf", "scale=1920:1080:flags=neighbor",
      "-af", af,
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-tune", "animation",
      "-c:a", "aac", "-b:a", "192k",
      "-t", String(total / fps),
      "-movflags", "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  console.log("Done:", mp4);
}

// ffmpeg prints its loudnorm report on stderr.
function loudnormReport(args) {
  const res = spawnSync("ffmpeg", args, { encoding: "utf8" });
  return res.stderr;
}
