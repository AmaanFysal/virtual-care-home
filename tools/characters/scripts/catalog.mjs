// Search the generator's item catalogue: hash key, hash name, body types, colours,
// and whether the item has art for walk, run, idle and emote.
// Needs ./lpc/dist, which Vite creates the first time the generator runs.
// Usage: node catalog.mjs <type_name>[,<type_name>] [--ok]      e.g. node catalog.mjs legs,clothes --ok
//        node catalog.mjs --types                               lists every type_name
const idx = await import("./lpc/dist/index-metadata.js");
const { itemMetadata: I } = await import("./lpc/dist/item-metadata.js");
const mi = idx.metadataIndexes;
const NEED = ["walk", "run", "idle", "emote"];

if (process.argv[2] === "--types") {
  console.log([...new Set(Object.values(I).map((m) => m.type_name))].sort().join(" "));
  process.exit(0);
}
const types = (process.argv[2] ?? "").split(",").filter(Boolean);
const onlyOk = process.argv.includes("--ok");
if (!types.length) { console.error("usage: node catalog.mjs <type_name>[,...] [--ok] | --types"); process.exit(1); }

for (const [id, m] of Object.entries(I)) {
  if (!types.includes(m.type_name)) continue;
  const missing = NEED.filter((a) => !m.animations.includes(a));
  if (onlyOk && missing.length) continue;
  const variants = mi.variantArrays[m.v] ?? [];
  const recolors = (m.recolors ?? []).map((r) => r.material + (r.type_name ? `(${r.type_name} key)` : ""));
  const colours = variants.length ? `variants: ${variants.join(" ")}` : `palette: ${recolors.join(", ")}`;
  console.log(
    `${m.type_name}=${m.name.replaceAll(" ", "_")}_<colour>`.padEnd(52),
    `[${(m.required ?? []).join("/")}]`.padEnd(42),
    missing.length ? `MISSING ${missing.join(",")}` : "anims ok",
    `| ${colours}`, `| ${id}`,
  );
}
