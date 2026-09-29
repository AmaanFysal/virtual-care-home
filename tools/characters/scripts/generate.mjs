// Drive the LPC generator (running on localhost:5199) to export each character.
// Usage: node generate.mjs [outDir] [onlyIds,comma,separated]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./lpc/node_modules/playwright/index.mjs";
import { characters } from "./characters.mjs";

const OUT = process.argv[2] || process.env.VCH_CHARACTERS_DIR || new URL("../out/", import.meta.url).pathname;
const ONLY = process.argv[3]?.split(",");
const APP = "http://localhost:5199/";

const enc = (p) => Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const dec = (h) => Object.fromEntries(h.replace(/^#/, "").split("&").filter(Boolean).map((kv) => kv.split("=").map(decodeURIComponent)));

// The eye colour is a palette recolour of the head sprite, stored as a second selection on the
// same head item, so the generator dedupes it into the head's credit and it never appears by name.
// Add an explicit "eye colour" entry, copied from the head's credit, to both credit files.
function addEyeColourCredit(dir, character) {
  const eyes = character.selections?.eyes;
  if (!eyes) return;
  const colour = eyes.recolor || "default";
  const note = `Eye colour (${colour}) is a palette recolour of the head sprite above; no separate artwork, same artists and licences as the head.`;

  const csvPath = path.join(dir, "credits.csv");
  const rows = fs.readFileSync(csvPath, "utf8").split("\n");
  const headRow = rows.find((r) => r.startsWith('"head/heads/'));
  if (headRow && !rows.some((r) => r.includes("(eye colour"))) {
    const fields = [...headRow.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]);
    fields[0] = `${fields[0]} (eye colour: ${colour})`;
    fields[1] = note;
    rows.splice(rows.indexOf(headRow) + 1, 0, fields.map((f) => `"${f}"`).join(","));
    fs.writeFileSync(csvPath, rows.join("\n"));
  }

  const txtPath = path.join(dir, "credits.txt");
  const blocks = fs.readFileSync(txtPath, "utf8").split("\n\n");
  const i = blocks.findIndex((b) => b.startsWith("head/heads/"));
  if (i >= 0 && !blocks.some((b) => b.includes("(eye colour"))) {
    const lines = blocks[i].split("\n");
    lines[0] = `${lines[0]} (eye colour: ${colour})`;
    const n = lines.findIndex((l) => l.startsWith("\t- Note:"));
    if (n >= 0) lines[n] = `\t- Note: ${note}`; else lines.splice(1, 0, `\t- Note: ${note}`);
    blocks.splice(i + 1, 0, lines.join("\n"));
    fs.writeFileSync(txtPath, blocks.join("\n\n"));
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
fs.mkdirSync(OUT, { recursive: true });

const report = [];
for (const [i, c] of characters.entries()) {
  if (ONLY && !ONLY.includes(c.id)) continue;
  const dir = path.join(OUT, `${String(i + 1).padStart(2, "0")}_${c.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const page = await context.newPage();
  await page.goto(APP + "#" + enc(c.hash));
  await page.waitForFunction(() => typeof window.__LPC_waitCatalogAllReady === "function");
  await page.evaluate(() => window.__LPC_waitCatalogAllReady());

  // Wait until the offscreen canvas stops changing.
  let last = "", stable = 0;
  for (let t = 0; t < 80 && stable < 3; t++) {
    await page.waitForTimeout(500);
    const sig = await page.evaluate(() => {
      const cv = window.canvasRenderer?.canvas;
      if (!cv) return "";
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, Math.min(cv.height, 1400)).data;
      let s = 0; for (let k = 0; k < d.length; k += 7) s = (s * 31 + d[k]) >>> 0;
      return `${cv.width}x${cv.height}:${s}`;
    });
    if (sig && sig === last) stable++; else stable = 0;
    last = sig;
  }

  // Check every requested layer survived the app's own hash round-trip.
  const got = dec(await page.evaluate(() => location.hash));
  const problems = Object.entries(c.hash)
    .filter(([k, v]) => (got[k] ?? "").toLowerCase() !== v.toLowerCase())
    .map(([k, v]) => `${k}: wanted ${v}, got ${got[k] ?? "(none)"}`);

  // Use the generator's own download buttons.
  const grab = async (label, file) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label, exact: true }).click()]);
    await dl.saveAs(path.join(dir, file));
  };
  await grab("Spritesheet (PNG)", "spritesheet.png");
  await grab("Credits (TXT)", "credits.txt");
  await grab("Credits (CSV)", "credits.csv");
  await page.getByRole("button", { name: "Export to Clipboard (JSON)" }).click();
  await page.waitForTimeout(300);
  const json = await page.evaluate(() => navigator.clipboard.readText());
  fs.writeFileSync(path.join(dir, "character.json"), json);
  addEyeColourCredit(dir, JSON.parse(json));

  // 4x preview of the walk-down frame (row 10, col 0).
  // Wheelchair users: south-facing frame of the wheelchair block below the standard sheet.
  const [sx, sy] = c.hash.wheelchair ? [0, 3456 + 128] : [0, 640];
  const preview = await page.evaluate(([sx, sy]) => {
    const src = window.canvasRenderer.canvas;
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    g.drawImage(src, sx, sy, 64, 64, 0, 0, 256, 256);
    return cv.toDataURL("image/png").split(",")[1];
  }, [sx, sy]);
  fs.writeFileSync(path.join(dir, "preview.png"), Buffer.from(preview, "base64"));

  const url = APP.replace("http://localhost:5199/", "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/") + "#" + enc(c.hash);
  fs.writeFileSync(path.join(dir, "info.json"), JSON.stringify({ ...c, generatorUrl: url }, null, 2));
  report.push({ n: i + 1, id: c.id, dir: path.basename(dir), problems, size: last.split(":")[0] });
  console.log(`${i + 1} ${c.id} ${last.split(":")[0]} ${problems.length ? "PROBLEMS: " + problems.join("; ") : "ok"}`);
  await page.close();
}
// Merge into the existing report so a partial re-run keeps the other characters' rows.
const reportPath = path.join(OUT, "_report.json");
const merged = Object.fromEntries((fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)) : []).map((r) => [r.id, r]));
for (const r of report) merged[r.id] = r;
const order = characters.map((c) => c.id);
fs.writeFileSync(reportPath, JSON.stringify(Object.values(merged).filter((r) => order.includes(r.id)).sort((a, b) => a.n - b.n), null, 2));
await browser.close();
