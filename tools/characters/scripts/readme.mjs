import fs from "node:fs";
import { characters } from "./characters.mjs";
const OUT = process.env.VCH_CHARACTERS_DIR ?? new URL("../out/", import.meta.url).pathname; // set VCH_CHARACTERS_DIR to use another folder
const rows = characters.map((c, i) => {
  const n = String(i + 1).padStart(2, "0");
  const url = JSON.parse(fs.readFileSync(`${OUT}/${n}_${c.id}/info.json`)).generatorUrl;
  return `| ${n} | [${c.name}](${n}_${c.id}/) | ${c.group} | ${c.note} | [open](${url}) |`;
});
fs.writeFileSync(`${OUT}/README.md`, `# Virtual Care Home characters

See [CREATING_CHARACTERS.md](CREATING_CHARACTERS.md) to add or change characters.

${characters.length} characters made with the [Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator). The generator ran locally and headless Chromium drove its own export buttons.

![All ${characters.length} characters](contact_sheet.png)

## Each folder has

- \`spritesheet.png\`: the full universal LPC sheet, 832 × 3456 px of 64 × 64 frames (walk, run, sit, idle, emote, hurt and more). Raj's sheet is 3712 px tall because the wheelchair frames are added below the standard sheet at y = 3456, with 4 directions × 2 frames.
- \`preview.png\`: a 4× preview facing south. It comes from the walk row, or from the wheelchair block for Raj.
- \`character.json\`: the generator's own JSON export. Use the generator's "Import from Clipboard (JSON)" button to load it back.
- \`credits.txt\` / \`credits.csv\`: attribution for every layer used, plus an explicit eye-colour entry. The generator folds the eye colour into the head's credit because it is a recolour of the head sprite, not separate artwork.
- \`info.json\`: the selection hash and a link that opens the character in the online generator.

## Animation

Every \`spritesheet.png\` already contains all the animations, so each character is a single file. [\`animations.json\`](animations.json) gives the rows and frame cycles for walk, run, idle and emote in all four directions. For every character, every clothing and hair layer has been checked for art in all four of those animations.

Some generator items have no run, idle or emote art and would vanish mid-animation: skirts, dresses, tunics, blouses, aprons, waistcoats, the simple necklace and child-body clothes. None of the ${characters.length} characters use them. Skirts became trousers, blouses and tunics became long-sleeved tops, and Priya uses the teen body instead of the child body.

## Characters

Numbers 1–43 match \`data/personas/\` (residents, staff and visitors). Numbers 44–${characters.length} are extras that are not in the persona files: visiting professionals, agency staff, night cover and paramedics.

| # | Name | Group | Note | Generator |
|---|---|---|---|---|
${rows.join("\n")}

## Licence

The LPC art is under CC-BY-SA 3.0, GPL 3.0, OGA-BY 3.0 and CC0, and the licence differs from layer to layer. If you use these sprites, you must include the attribution in each character's \`credits.txt\`.

## Regenerating

\`_scripts/characters.mjs\` holds every selection. To regenerate, clone the generator, run \`npm ci\` and \`npx vite --port 5199\`, then run \`node generate.mjs <outDir> [id,id]\` from a folder that contains the generator clone as \`./lpc\`. After that, \`node contact.mjs\` rebuilds the contact sheet.
`);
