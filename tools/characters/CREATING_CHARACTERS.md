# Creating characters

How to add or change characters in this folder with the [Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator). This guide is written for a person or for Claude. Follow it top to bottom. Each rule under [Rules](#rules) comes from a mistake made while building the first 50 characters.

## How it works

Every character is a set of generator selections, stored as the generator's URL hash in `_scripts/characters.mjs`. `generate.mjs` runs the generator locally and opens each hash in headless Chromium. It clicks the generator's own buttons: "Spritesheet (PNG)", "Credits (TXT)" and "Credits (CSV)" to download files, and "Export to Clipboard (JSON)" to read the JSON back. The generator does all the drawing; the scripts only drive it. If you need to change a character's look, edit `characters.mjs` and regenerate. Don't edit the PNG files.

## One-time setup

You need Node 22.19 or later. The generator clone takes about 1 GB, and you can delete it when you're finished.

```sh
cd /Users/amaanfy/Documents/virtual-care-home-characters/_scripts
git clone --depth 1 https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator.git lpc
(cd lpc && npm ci && npx playwright install chromium)
```

Before each session, start the generator in a separate terminal and leave it running:

```sh
cd /Users/amaanfy/Documents/virtual-care-home-characters/_scripts/lpc && npx vite --port 5199 --strictPort
```

The first start creates `lpc/dist/`, which `catalog.mjs` and `audit.mjs` read.

## Scripts (run from `_scripts/`)

| Script | What it does |
|---|---|
| `characters.mjs` | The list of all characters. Edit this file. |
| `generate.mjs [outDir] [id,id]` | Exports the listed characters, or all of them if you give no ids. For each one it prints `ok` or `PROBLEMS: …`. |
| `catalog.mjs <type>[,<type>] [--ok]` | Searches the catalogue. It shows hash names, body types and colours. `--ok` keeps only items with walk, run, idle and emote art. `--types` lists every type. |
| `audit.mjs` | Lists every item, on any character, that has no art for walk, run, idle or emote. The output must be empty. |
| `anicheck.mjs` | Checks that every walk, run, idle and emote frame in all 4 directions has pixels. |
| `strip.mjs <folder>,<folder>` | Writes `strip.png`, which shows walk, run, idle and emote frames side by side so you can check them by eye. |
| `contact.mjs` | Rebuilds `contact_sheet.png`. |
| `readme.mjs` | Rebuilds `README.md`. Edit this script, not the README, because the README is overwritten. |

## Adding or changing a character

1. **Choose the items.** Use `node catalog.mjs clothes,legs,shoes,hair --ok` and pick only rows marked `anims ok` that support the character's body type.
2. **Add an entry at the end of `characters` in `characters.mjs`.** Folder numbers come from each character's position in the list, so inserting in the middle renumbers every folder after it.
   ```js
   { id: "stf_new", name: "Full Name", group: "staff", note: "care assistant",
     hash: { ...F("brown"), hair: "Bob_black", ...carer } },
   ```
   - **`id`:** use the persona id from `virtual-care-home/data/personas/` if one exists. The prefixes are `res_`, `stf_`, `vis_` and `ext_`.
   - **`group`:** one of `resident`, `staff`, `visitor` or `extra`. It controls the label colour on the contact sheet only.
   - **`agency: true`:** a label for agency workers. It doesn't change their clothes.
   - **Head and body:** `F`, `M`, `OldF`, `OldM` and `Girl` each set the body, head, face, eye colour and, for the elderly helpers, wrinkles.
   - **Uniforms:** `carer`, `senior` and `paramedic` are ready-made uniforms. See [House style](#house-style) for which role wears what.
3. **Generate.** Run `node generate.mjs "" stf_new`, where `""` keeps the default output folder. Every line must say `ok`. A `PROBLEMS` line means the generator didn't recognise a name, and that layer was silently left off.
4. **Check the animations.** Run `node audit.mjs`, which must print nothing, then `node anicheck.mjs`. Then run `node strip.mjs NN_stf_new` and look at `strip.png`. The pixel checks can't catch a layer that is present but looks wrong.
5. **Look at the result.** Open the new `preview.png`, then run `node contact.mjs` and check the contact sheet. Colours often come out differently from what their names suggest.
6. **Update the docs.** Run `node readme.mjs`.

For a bulk change, such as a new uniform colour, change the code in `characters.mjs` and regenerate only the affected ids. `generate.mjs` merges its results into `_report.json`.

## Hash format

Each entry is `type_name` = `Item_Name_colour`, for example `clothes=Shortsleeve_Polo_white`.

- **Item names:** the item name has spaces replaced by underscores, and the colour goes last. Names are case-insensitive.
- **Colours:** two kinds exist.
  - Palette colours: `white`, `navy` and the other `cloth` palette names. You can also use the extended palette with the `all.lpcr.` prefix, for example `Pants_all.lpcr.pink`.
  - Fixed variants: some items list their own colours, which `catalog.mjs` shows as `variants:`.
- **Body type:** `sex` is `male`, `female`, `teen` or `child`. An item whose body-type list doesn't include that body is dropped.
- **Eye colour:** `eyes=Eye_Color_brown`. The key is `eyes`, not `head`.
- **Useful keys:** `body`, `head`, `expression`, `wrinkles`, `hair`, `beard`, `mustache`, `clothes`, `legs`, `shoes`, `neck`, `necklace`, `facial_eyes` (glasses), `hat`, `headcover`, `overalls` (includes braces) and `wheelchair`.
- **Copying from the website:** the easiest way to find an exact hash value is to build the look on the generator website and copy the part of the URL after `#`.

## Rules

**Animations**
- **Every item must have walk, run, idle and emote art**, or it disappears mid-animation. These items don't, so never use them:
  - every skirt except `Legion skirt`, which is Roman armour, and the `Overskirt`
  - every dress and kimono
  - `Tunic`, `Sara Tunic`, `Blouse` and `Longsleeve blouse`
  - `Vest`, `Vest open`, `Bodice` and `Corset`
  - every apron
  - `Simple Necklace`, `Chain Necklace` and `Necklace`. Use `Small_Beaded_Necklace` or `Large_Beaded_Necklace` instead.

  If you're unsure about an item, run `catalog.mjs --ok`.
- **Never use the `child` body.** None of its clothes have run, idle or emote art. For children, use `Girl("bronze")` or `base("teen", "bronze", "Human_Male_Small")`, changing the skin tone as needed.

**Items that look wrong**
- **`Formal Pants` draws dark green** whatever colour you give it. Use `Pants`.
- **`Leather Cap` is a feathered cavalier-style hat,** not a flat cap.

**Names**
- **Avoid names that contain `/`,** such as `Collared/Formal Longsleeve`.
- **Check names in `catalog.mjs`.** Some are easy to get wrong: it's `Longsleeve_Polo`, not `Longsleeve_2_Polo`.

**Faces and features**
- **Elderly heads ignore eye colour.** They always have the default blue eyes.
- **There is no turban or patka.** The Sikh characters use `Short_Topknot`, which spikes in some run frames.

**Mobility aids**
- **The wheelchair is the only mobility aid.** There's no zimmer frame, walking stick or rollator.
- **Wheelchair users' sheets are taller.** They are 3712 px tall, with the wheelchair frames below the standard sheet. `generate.mjs` takes their preview from there.

## House style

| Group | Look |
|---|---|
| Residents | Elderly heads (`OldF` or `OldM`, which add wrinkles), white or grey hair, cardigans and long-sleeved tops, trousers, slippers or plain shoes. |
| Care assistants, including bank staff and night cover | The `carer` preset: lavender polo, navy trousers and black shoes. |
| Senior carers | The `senior` preset: blue polo and navy trousers. |
| Registered nurses (in-house and on-call) | Navy polo and navy trousers. |
| Manager | Smart navy shirt (`Longsleeve_2_Buttoned_navy`), charcoal trousers and a small necklace. |
| Receptionist | White shirt, navy tie and charcoal trousers. |
| Activities coordinator | Her own colourful clothes: purple cardigan, beads and red glasses. |
| Paramedics | The `paramedic` preset: UK ambulance bottle green (`forest`) polo and trousers, and black boots. |
| Agency workers | Their agency's uniform, not the home's. That's a light pink polo (`Shortsleeve_Polo_all.lpcr.pink`), and carers also wear pink trousers (`Pants_all.lpcr.pink`). Agency nurses wear navy trousers (`Pants_navy`) instead, so they still read as nurses. Set these in the character's own entry: `agency: true` is only a label and doesn't change the clothes. |
| Visitors and other extras | Their own everyday clothes, suited to their age. |

Each role's colours are set in the character's own entry or in a preset at the top of `characters.mjs`. No loop recolours characters afterwards, so what an entry says is what gets drawn. Staff wore all white for a while (2026-09-29) before the role colours above replaced it.

- **Skin tones** use the `body` palette: `light`, `olive`, `amber`, `taupe`, `bronze`, `brown` and `black`. Pass one to the helper, as in `F("olive")`. The same value colours the head, face and wrinkles.
- **Clothing colours** use the `cloth` palette:
  - neutrals: `white`, `gray`, `slate`, `charcoal`, `black`
  - browns: `brown`, `leather`, `walnut`, `tan`
  - reds, pinks and purples: `rose`, `maroon`, `red`, `pink`, `lavender`, `purple`
  - blues: `blue`, `navy`, `sky`, `bluegray`, `teal`
  - greens and yellows: `forest`, `green`, `yellow`
  - orange: `orange`

  The generator's `white` comes out slightly warm, not pure white.

## Output

Each `NN_id/` folder holds these files:

| File | What it is |
|---|---|
| `spritesheet.png` | The full 832 × 3456 sheet, with 64 × 64 frames. |
| `preview.png` | A south-facing preview at 4× size. |
| `character.json` | The generator's own JSON export. Load it back with the generator's "Import from Clipboard (JSON)" button. |
| `credits.txt` and `credits.csv` | Attribution for every layer. `generate.mjs` also adds an explicit "(eye colour: …)" entry after the head, because the generator folds the eye colour into the head's credit. The eye colour is a recolour of the head sprite, not separate artwork. |
| `info.json` | The hash and a link that opens the character on the generator website. |

`animations.json` gives the rows and frame cycles for walk (rows 8–11), run (38–41), idle (22–25) and emote (34–37). Directions within each animation go north, west, south, east.

## Licence

The LPC art is under a mix of CC-BY-SA 3.0, GPL 3.0, OGA-BY 3.0 and CC0, which varies by layer. Any build that uses a sprite must ship that character's `credits.txt`. Never remove or skip the credits files.
