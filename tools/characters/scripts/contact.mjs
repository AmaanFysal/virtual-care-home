import fs from "node:fs"; import path from "node:path";
import { chromium } from "./lpc/node_modules/playwright/index.mjs";
const OUT = process.env.VCH_CHARACTERS_DIR ?? new URL("../out/", import.meta.url).pathname; // set VCH_CHARACTERS_DIR to use another folder
const dirs = fs.readdirSync(OUT).filter(d => /^\d\d_/.test(d)).sort();
const items = dirs.map(d => { const info = JSON.parse(fs.readFileSync(path.join(OUT, d, "info.json"))); return { n: d.slice(0, 2), name: info.name, group: info.group, img: "data:image/png;base64," + fs.readFileSync(path.join(OUT, d, "preview.png")).toString("base64") }; });
const b = await chromium.launch(); const p = await b.newPage();
const png = await p.evaluate(async (items) => {
  const cols = 10, cw = 160, ch = 190, cv = document.createElement("canvas");
  cv.width = cols * cw; cv.height = Math.ceil(items.length / cols) * ch;
  const g = cv.getContext("2d"); g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
  const colour = { resident: "#8a5a00", staff: "#1f5fa8", visitor: "#2e7d32", extra: "#7b3fa0" };
  for (const [i, it] of items.entries()) {
    const im = new Image(); im.src = it.img; await im.decode();
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    g.drawImage(im, x + 8, y + 4, 144, 144);
    g.fillStyle = colour[it.group]; g.font = "bold 12px sans-serif"; g.textAlign = "center";
    g.fillText(`${it.n} ${it.group}`, x + cw / 2, y + 160);
    g.fillStyle = "#222"; g.font = "12px sans-serif"; g.fillText(it.name.length > 24 ? it.name.slice(0, 23) + "…" : it.name, x + cw / 2, y + 177);
  }
  return cv.toDataURL("image/png").split(",")[1];
}, items);
fs.writeFileSync(path.join(OUT, "contact_sheet.png"), Buffer.from(png, "base64"));
await b.close();
