# Character sprites

The residents', staff's and visitors' sprites are Liberated Pixel Cup (LPC) characters made with the [Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator). The art is licensed under CC-BY-SA 3.0, separately from the code; see [CREDITS.md](../../CREDITS.md).

This folder has everything needed to regenerate the set from the repo:

| Path | What it is |
|---|---|
| `CREATING_CHARACTERS.md` | How to add or change a character, and the generator's pitfalls. Read it first. It was written for the original folder: run the scripts from `tools/characters/scripts/`. |
| `scripts/characters.mjs` | Every character's generator selections. This is the source of truth. |
| `scripts/*.mjs` | Generate, audit, check animations, catalogue, contact sheet (from the original set). |
| `specs/<personId>/` | Each character's generator JSON export (`character.json`) and selection hash (`info.json`). |
| `animations.json` | Frame size, rows and cycles for walk, run, idle and emote. |
| `zimmer.mjs` | Draws Peggy's zimmer frame overlay (the generator has none). |
| `stick.mjs` | Draws the walking-stick overlay for everyone whose card says they use one (Win, Kamala). |
| `png.mjs` | The PNG writer both overlays use. |
| `import.mjs` | Copies generated sheets into the app and rebuilds `data/sprites.json` and `CREDITS.md`. |

## Regenerating

```sh
cd tools/characters/scripts
git clone --depth 1 https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator.git lpc   # ignored by git
(cd lpc && npm ci && npx playwright install chromium)
(cd lpc && npx vite --port 5199 --strictPort) &   # leave it running
node generate.mjs              # writes tools/characters/out/NN_<personId>/ (ignored by git)
node audit.mjs && node anicheck.mjs
cd ../../..
node tools/characters/import.mjs   # or: node tools/characters/import.mjs /path/to/characters
node tools/characters/zimmer.mjs   # only if an overlay changes
node tools/characters/stick.mjs
```

The scripts write to `tools/characters/out/` unless `VCH_CHARACTERS_DIR` is set.

## How the app uses them

`data/sprites.json` gives the sheet layout (64 × 64 frames, rows north, west, south, east), each person's sheet and poses, and the render workarounds:
- Peggy's zimmer overlay on her walk and stand frames, and a walking stick for everyone whose card's `mobility.aid` says so (Win, Kamala);
- Arjun and Priya drawn at 80% (the generator's child body lacks run, idle and emote art);
- Raj's wheelchair block for sitting only;
- the hurt row's last frame for a resident on the floor after a fall.

Agency staff and paramedics have no sheet of their own. The app picks one by staff role and gender (`roles`), because agency ids are only made up when they're booked.
