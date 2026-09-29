import fs from "node:fs"; import path from "node:path";
import { chromium } from "./lpc/node_modules/playwright/index.mjs";
const OUT = process.env.VCH_CHARACTERS_DIR ?? new URL("../out/", import.meta.url).pathname; // set VCH_CHARACTERS_DIR to use another folder
const anims = { walk: [8, 9], run: [38, 8], idle: [22, 2], emote: [34, 3] }; // row, frames used
const dirs = fs.readdirSync(OUT).filter(d => /^\d\d_/.test(d)).sort();
const b = await chromium.launch(); const p = await b.newPage();
const bad = [];
for (const d of dirs) {
  const src = "data:image/png;base64," + fs.readFileSync(path.join(OUT, d, "spritesheet.png")).toString("base64");
  const res = await p.evaluate(async ([src, anims]) => {
    const im = new Image(); im.src = src; await im.decode();
    const cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext("2d"); g.drawImage(im, 0, 0);
    const out = {};
    for (const [a, [row, n]] of Object.entries(anims)) for (let dir = 0; dir < 4; dir++) for (let f = 0; f < n; f++) {
      const px = g.getImageData(f * 64, (row + dir) * 64, 64, 64).data; let c = 0;
      for (let k = 3; k < px.length; k += 4) if (px[k]) c++;
      out[`${a}/${"NWSE"[dir]}/${f}`] = c;
    }
    return out;
  }, [src, anims]);
  const empty = Object.entries(res).filter(([, c]) => c < 200).map(([k]) => k);
  const byAnim = {}; for (const [k, c] of Object.entries(res)) { const a = k.split("/")[0]; (byAnim[a] ??= []).push(c); }
  if (empty.length) bad.push(`${d}: ${empty.join(" ")}`);
  if (d.startsWith("01") || d.startsWith("04")) console.log(d, Object.fromEntries(Object.entries(byAnim).map(([a, v]) => [a, Math.min(...v)])));
}
console.log(bad.length ? bad.join("\n") : `all ${dirs.length} characters: every walk/run/idle/emote frame in all 4 directions has art`);
await b.close();
