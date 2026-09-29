import fs from "node:fs";
const { itemMetadata: I } = await import("./lpc/dist/item-metadata.js");
const OUT = process.env.VCH_CHARACTERS_DIR ?? new URL("../out/", import.meta.url).pathname; // set VCH_CHARACTERS_DIR to use another folder
const need = ["walk", "run", "idle", "emote"];
const bad = {};
for (const d of fs.readdirSync(OUT).filter(d => /^\d\d_/.test(d)).sort()) {
  const j = JSON.parse(fs.readFileSync(`${OUT}/${d}/character.json`));
  for (const s of Object.values(j.selections)) {
    const m = I[s.itemId]; if (!m) { console.log("?", d, s.itemId); continue; }
    if (s.itemId === "wheelchair") continue;
    const miss = need.filter(a => !m.animations.includes(a));
    if (miss.length) (bad[`${s.itemId} (${m.name})`] ??= { miss, who: [] }).who.push(d.slice(3));
  }
}
for (const [k, v] of Object.entries(bad)) console.log(k, "missing:", v.miss.join(","), "->", v.who.join(" "));
