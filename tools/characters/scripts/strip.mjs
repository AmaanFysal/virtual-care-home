// Render south-facing walk, run, idle and emote frames (plus walk west/east) for a few characters,
// so you can check by eye that no layer vanishes mid-animation.
// Usage: node strip.mjs 26_vis_grace,15_stf_bev   -> writes strip.png next to this script
import fs from "node:fs"; import { chromium } from "./lpc/node_modules/playwright/index.mjs";
const OUT = process.env.VCH_CHARACTERS_DIR ?? new URL("../out/", import.meta.url).pathname; // set VCH_CHARACTERS_DIR to use another folder
const who = (process.argv[2] ?? "").split(",").filter(Boolean);
if (!who.length) { console.error("usage: node strip.mjs <folder>,<folder>"); process.exit(1); }
// [row, frame]: walk row 10 (frames 1-8), run row 40 (0-7), idle row 24 (0-1), emote row 36 (0-2), walk W row 9, walk E row 11
const seq = [[10,1],[10,3],[10,5],[10,7],[40,0],[40,2],[40,4],[40,6],[24,0],[24,1],[36,0],[36,1],[36,2],[9,2],[11,2]];
const b = await chromium.launch(); const p = await b.newPage();
const srcs = who.map(d => "data:image/png;base64," + fs.readFileSync(`${OUT}/${d}/spritesheet.png`).toString("base64"));
const png = await p.evaluate(async ([srcs, seq]) => {
  const s = 2, cv = document.createElement("canvas"); cv.width = seq.length * 64 * s; cv.height = srcs.length * 64 * s;
  const g = cv.getContext("2d"); g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
  for (const [r, src] of srcs.entries()) { const im = new Image(); im.src = src; await im.decode();
    for (const [i, [row, f]] of seq.entries()) g.drawImage(im, f * 64, row * 64, 64, 64, i * 64 * s, r * 64 * s, 64 * s, 64 * s); }
  return cv.toDataURL().split(",")[1];
}, [srcs, seq]);
fs.writeFileSync(new URL("./strip.png", import.meta.url), Buffer.from(png, "base64")); await b.close();
console.log("wrote strip.png");
