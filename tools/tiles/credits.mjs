// Writes the map art credits (tools/tiles/credits.json) into CREDITS.md and
// apps/web/public/CREDITS.txt, replacing any earlier "Map art" section. Run on its own, or by
// tools/characters/import.mjs after it rewrites the character credits.
//
//   node tools/tiles/credits.mjs

import { readFileSync, writeFileSync } from "node:fs";

const repo = new URL("../../", import.meta.url);
const { packs, cc0 } = JSON.parse(readFileSync(new URL("tools/tiles/credits.json", repo), "utf8"));
const MD_HEAD = "## Map art";
const TXT_HEAD = "Map art (rooms, furniture, garden):";

const md = [
  MD_HEAD,
  "",
  "The rooms, furniture and garden in `apps/web/public/tiles/` come from these Liberated Pixel Cup packs on OpenGameArt. **Each pack keeps its own licence**, and all of them are licensed separately from the code. Each pack's full credits file ships next to its image and must stay with it.",
  "",
  "| Pack | Authors | Licence | Used for | Files |",
  "|---|---|---|---|---|",
  ...packs.map((p) => `| [${p.name}](${p.url}) | ${p.authors} | ${p.licence} | ${p.use} | \`${p.files}\`, \`${p.credits}\` |`),
  "",
  cc0,
  "",
].join("\n");
const txt = [
  TXT_HEAD,
  ...packs.map((p) => `- ${p.name} by ${p.authors}\n    licence: ${p.licence}\n    ${p.url}\n    full credits: /tiles/${p.credits}`),
  "",
  cc0,
  "",
].join("\n");

function replaceSection(file, head, body, nextHead) {
  const path = new URL(file, repo);
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(head);
  const before = start >= 0 ? text.slice(0, start) : `${text.trimEnd()}\n\n`;
  const rest = start >= 0 ? text.slice(start + head.length) : "";
  const next = nextHead ? rest.search(nextHead) : -1;
  const after = next >= 0 ? rest.slice(next) : "";
  writeFileSync(path, `${before}${body}${after ? `\n${after}` : ""}`);
}
// The map section goes right after the title, before the character art.
const mdPath = new URL("CREDITS.md", repo);
let text = readFileSync(mdPath, "utf8");
const old = text.indexOf(MD_HEAD);
if (old >= 0) {
  const next = text.indexOf("\n## ", old + MD_HEAD.length);
  text = text.slice(0, old) + (next >= 0 ? text.slice(next + 1) : "");
}
text = text.replace("## Character art", `${md}\n## Character art`);
writeFileSync(mdPath, text);
replaceSection("apps/web/public/CREDITS.txt", TXT_HEAD, txt, null);
console.log(`credited ${packs.length} map art packs in CREDITS.md and apps/web/public/CREDITS.txt`);
