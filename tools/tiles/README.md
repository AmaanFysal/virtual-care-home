# Map art

The wing's rooms, furniture and garden are LPC pixel art (docs/adr/0004). The renderer paints the
map from `data/floorplan.json` using `apps/web/src/canvas/tileset.json`, which names every tile and
sprite by its source rect. To change the look, edit the manifest; no code or map needs repainting.

## Packs (`apps/web/public/tiles/`)

Downloaded from OpenGameArt and copied unmodified, each with its credits file:
[LPC] Walls, Floors, Wooden Furniture, Upholstery, Simple Modern Furniture, Trees and Terrains.
`credits.json` lists them with their licences; `node tools/tiles/credits.mjs` writes that into
`CREDITS.md` and `apps/web/public/CREDITS.txt` (the character import runs it too).

To add a pack: copy its image and credits file into `apps/web/public/tiles/<pack>/`, add it to
`credits.json` and the manifest's `images`, and run `credits.mjs`.

## Props drawn for this project (CC0)

`node tools/tiles/props.mjs` draws what LPC doesn't have, into `apps/web/public/tiles/props/`:
the flat-screen TV (turned towards us, with a lit screen), book tops for the bookshelf, the
name-tag icons, framed pictures, potted plants and a bedside lamp. No dependencies.
