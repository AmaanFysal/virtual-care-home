// Imports generated LPC character sheets into the app (see tools/characters/README.md).
//
//   node tools/characters/import.mjs [charactersDir]
//
// charactersDir defaults to $VCH_CHARACTERS_DIR, then tools/characters/out. The folder is only read.
// For every NN_<personId>/ folder it copies:
//   spritesheet.png -> apps/web/public/sprites/characters/<personId>.png
//   credits.txt     -> apps/web/public/sprites/characters/<personId>.credits.txt (the licences ask
//                      for each character's credits to ship with it)
//   character.json, info.json -> tools/characters/specs/<personId>/
// and writes data/sprites.json (layout, people, runtime roles, render workarounds), CREDITS.md
// and apps/web/public/CREDITS.txt (linked from the app footer).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = new URL("../../", import.meta.url).pathname;
const src = process.argv[2] || process.env.VCH_CHARACTERS_DIR || join(repo, "tools/characters/out");
if (!existsSync(src)) throw new Error(`No characters folder at ${src}`);

const sheetsDir = join(repo, "apps/web/public/sprites/characters");
mkdirSync(sheetsDir, { recursive: true });
const folders = readdirSync(src).filter((d) => /^\d\d_/.test(d)).sort();

// ---------------------------------------------------------------- CSV (quoted fields)
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------------- copy
const people = {};
const credits = new Map(); // asset + authors -> credit row, with who uses it
for (const folder of folders) {
  const id = folder.slice(3);
  const dir = join(src, folder);
  const info = JSON.parse(readFileSync(join(dir, "info.json"), "utf8"));
  copyFileSync(join(dir, "spritesheet.png"), join(sheetsDir, `${id}.png`));
  copyFileSync(join(dir, "credits.txt"), join(sheetsDir, `${id}.credits.txt`));
  const specs = join(repo, "tools/characters/specs", id);
  mkdirSync(specs, { recursive: true });
  for (const f of ["character.json", "info.json"]) copyFileSync(join(dir, f), join(specs, f));
  people[id] = { name: info.name, group: info.group, sheet: `sprites/characters/${id}.png`, poses: posesFor(id, info.group) };
  if (id === "res_raj") people[id].sit = "wheelchair";
  if (id === "res_peggy") people[id].overlay = "zimmer";
  if (id === "vis_arjun" || id === "vis_priya") people[id].scale = 0.8;
  for (const r of parseCsv(readFileSync(join(dir, "credits.csv"), "utf8"))) {
    const asset = r.filename.replace(/ \(eye colour: \w+\)$/, "");
    const key = `${asset}|${r.authors}`;
    const entry = credits.get(key) ?? { asset, notes: r.notes, authors: r.authors, licenses: r.licenses, urls: r.urls, usedBy: new Set() };
    if (!entry.urls && r.urls) entry.urls = r.urls;
    entry.usedBy.add(id);
    credits.set(key, entry);
  }
}

/** Which poses the renderer uses for each person. */
function posesFor(id, group) {
  if (id === "res_dennis") return ["bed", "floor"]; // bed-bound
  if (id === "res_raj") return ["sit", "bed", "floor"]; // hoisted; never walks
  if (group === "resident") return ["walk", "stand", "sit", "bed", "floor"];
  return ["walk", "stand", "sit"];
}

// ---------------------------------------------------------------- data/sprites.json
const animations = JSON.parse(readFileSync(join(src, "animations.json"), "utf8"));
const sprites = {
  $comment: "Written by tools/characters/import.mjs; don't edit by hand. Character art: LPC, CC-BY-SA 3.0 (see CREDITS.md).",
  frame: animations.frameSize,
  columns: animations.sheetWidth / animations.frameSize,
  directions: animations.directions,
  layout: {
    walk: { row: animations.animations.walk.firstRow, frames: animations.animations.walk.frames, cycle: animations.animations.walk.cycle, perDirection: true },
    stand: { row: animations.animations.walk.firstRow, frame: animations.animations.walk.standingFrame, perDirection: true },
    idle: { row: animations.animations.idle.firstRow, frames: animations.animations.idle.frames, cycle: animations.animations.idle.cycle, perDirection: true },
    run: { row: animations.animations.run.firstRow, frames: animations.animations.run.frames, cycle: animations.animations.run.cycle, perDirection: true },
    emote: { row: animations.animations.emote.firstRow, frames: animations.animations.emote.frames, cycle: animations.animations.emote.cycle, perDirection: true },
    sit: { row: 30, frame: 2, perDirection: true, note: "sit rows 30-33 hold three poses: legs out, cross-legged, on a chair (frame 2)" },
    floor: { row: 20, frame: 5, perDirection: false, note: "last frame of the hurt row: lying on the floor after a fall" },
    bed: { row: animations.animations.walk.firstRow + 2, frame: 0, head: { x: 16, y: 6, w: 32, h: 30 }, note: "a head on the pillow, cut from the front-facing standing frame" },
    wheelchair: { y: animations.wheelchair.firstY, frames: animations.wheelchair.frames, perDirection: true, note: "Raj only: below the standard sheet, rows N, W, S, E" },
  },
  overlays: {
    zimmer: {
      image: "sprites/overlays/zimmer.png",
      poses: ["walk", "stand"],
      frames: { north: { index: 0, under: true }, west: { index: 1 }, south: { index: 2 }, east: { index: 3 } },
      note: "drawn by tools/characters/zimmer.mjs; the generator has no walking frames",
    },
  },
  roles: {
    $comment: "People without a sheet of their own, chosen at runtime by staff role and gender (agency ids are made up when they're booked)",
    agency_carer: { female: "ext_agency_carer", male: "ext_agency_carer_m" },
    agency_nurse: { female: "ext_agency_nurse", male: "ext_agency_nurse" },
    paramedic: { female: "ext_paramedic_f", male: "ext_paramedic_m" },
  },
  people,
};
writeFileSync(join(repo, "data/sprites.json"), `${JSON.stringify(sprites, null, 2)}\n`);

// ---------------------------------------------------------------- CREDITS.md
const rows = [...credits.values()].sort((a, b) => a.asset.localeCompare(b.asset) || a.authors.localeCompare(b.authors));
const authors = new Set(rows.flatMap((r) => r.authors.split(",").map((a) => a.trim()).filter(Boolean)));
const md = [
  "# Credits",
  "",
  "## Character art",
  "",
  "The character sprites in `apps/web/public/sprites/characters/` were made with the [Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator) from Liberated Pixel Cup (LPC) art.",
  "",
  "**Licence.** Each part of the art is offered under one or more of CC0, OGA-BY 3.0, CC-BY 3.0, CC-BY-SA 3.0 and GPL 2.0/3.0. Some parts are only available under CC-BY-SA 3.0 or GPL, so the character sprites as a whole are distributed under **[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)**. Any changed versions of the sprites must use the same licence.",
  "",
  "**The art is licensed separately from the code.** The simulation and app source code are not covered by these art licences. Each character's full credits also ship next to its sheet as `<personId>.credits.txt`.",
  "",
  "Peggy's zimmer frame overlay (`apps/web/public/sprites/overlays/zimmer.png`) was drawn for this project by `tools/characters/zimmer.mjs` and is released under CC0.",
  "",
  `**Artists (${authors.size}):** ${[...authors].sort((a, b) => a.localeCompare(b)).join(", ")}.`,
  "",
  `### Parts used (${rows.length}, one row per part and author list)`,
  "",
  "| Part | Authors | Licences | Sources | Notes | Used by |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const links = r.urls.split(",").map((u) => u.trim()).filter(Boolean).map((u) => `<${u}>`).join(" ");
    const used = [...r.usedBy].sort();
    return `| \`${cell(r.asset)}\` | ${cell(r.authors)} | ${cell(r.licenses)} | ${links || "(none given)"} | ${cell(r.notes)} | ${used.length > 6 ? `${used.length} characters` : used.join(", ")} |`;
  }),
  "",
];
writeFileSync(join(repo, "CREDITS.md"), md.join("\n"));

// A plain-text copy the browser can open from the footer.
const txt = [
  "Virtual Care Home: credits",
  "",
  "Character art: Liberated Pixel Cup (LPC) contributors, made with the Universal LPC Spritesheet Character Generator.",
  "Licence: CC-BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). The art is licensed separately from the code.",
  "Zimmer frame overlay: drawn for this project, CC0.",
  "",
  `Artists: ${[...authors].sort((a, b) => a.localeCompare(b)).join(", ")}.`,
  "",
  "Parts used:",
  ...rows.map((r) => `- ${r.asset}\n    by ${r.authors}\n    licences: ${r.licenses}${r.urls ? `\n    ${r.urls}` : ""}`),
  "",
  "Each character's full credits: /sprites/characters/<personId>.credits.txt",
  "",
];
writeFileSync(join(repo, "apps/web/public/CREDITS.txt"), txt.join("\n"));

console.log(`imported ${folders.length} characters; ${rows.length} credited parts by ${authors.size} artists`);
