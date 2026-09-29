# ADR 0004: Pixel-art rendering with LPC assets

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Amaan (project owner)
- **Affected docs:** docs/00-constitution.md (rule 6), docs/08-realtime-and-ui.md, `.claude/rules/web.md`, CLAUDE.md, CREDITS.md

## Context

Phase 1 drew the wing with plain shapes: labelled rectangles for rooms, coloured circles with initials for people, text badges. Constitution rule 6 required this ("no sprites, tilemaps or animation work") to keep the renderer cheap while the simulation was being built.

With Phase 1 done, that view is hard to read and hard to show to anyone. At 10x or 360x a circle doesn't say who someone is, whether they're sitting, in bed or on the floor, or which way they're going. People who look at the simulation, including care staff, recognise a care home much faster when it looks like one.

The Liberated Pixel Cup (LPC) art on OpenGameArt covers what we need in one consistent style: characters (made with the Universal LPC Spritesheet Character Generator), wall faces, floors, furniture, upholstery, trees and terrain. It's free to use under CC-BY-SA and similar licences, which require attribution and share-alike for the art. That is compatible with the code's licence as long as the art is licensed and credited separately.

The floor plan has walls with no thickness. In a 3/4 (top-down, front-facing) pixel-art view, walls facing us show a face that needs room on screen.

## Decision

We will draw the wing as LPC pixel art. What changes is only how the browser draws. The engine, the event log, the protocol's meaning and the simulation data are unchanged, and the browser still draws server state only.

1. **Manifest-driven.** Every piece of art is named in a manifest, not in code:
   - `data/sprites.json` for characters (from `tools/characters/import.mjs`);
   - `apps/web/src/canvas/tileset.json` for floors by room kind, wall faces, windows, pictures, furniture by kind, decor rules and the garden.

   The map is generated from `data/floorplan.json`: floors per room, wall faces and tops per wall, doorways per door, furniture per furniture item. Nothing is hand-painted, so a different tileset is a manifest change.
2. **Banded wall-face mapping.** Each horizontal wall with a room directly below it gets a 64 px face band in the drawing: an 8 px wall top and a 56 px face. Metres map to pixels at 32 px per metre (one LPC tile). Everything below a band moves down by 64 px. Where a wall has rooms on both sides, the band is blended over ±0.25 m around the wall line, so someone walking through a doorway crosses it smoothly. One pure module (`canvas/banding.ts`) does every screen↔world conversion: drawing, click-to-select, hover, Follow and the camera. Clicks pick people by their drawn figures, because a head drawn over a wall face reads back, through the mapping, as a point in the room behind it.
3. **Render-only decor.** Bedside cabinets and lamps, wardrobes, rugs, pictures, windows, plants, the sofa and the garden are placed by rules from the floor plan. They never block movement and the simulation doesn't know about them. Anything that must block movement or be used by people goes into `floorplan.json` as furniture, as before.
4. **Derived display state only.** Facing comes from the direction of movement. The pose comes from `posture`, and the name-tag icon from `badges`, `posture` and `task`. Seat facings come from the floor plan. All of it is derived from what the server sends; none of it feeds back.
5. **Pixel-perfect.** Nearest-neighbour textures, a whole number of device pixels per art pixel, and camera positions rounded to device pixels.
6. **Licences.** The art keeps its own licences, separate from the code:
   - characters, walls, trees, wooden furniture and simple modern furniture: CC-BY-SA 3.0 (some parts also 4.0 or GPL);
   - floors and terrain: CC-BY-SA 4.0 (terrain also 3.0);
   - upholstery: several licences, including CC-BY-SA.

   Each pack ships with its own credits file. `CREDITS.md` and `/CREDITS.txt` (linked from the app footer) list them. Props drawn for this project (the zimmer frame, TV, book tops, icons, pictures, plants and lamp) are CC0 and come from scripts in `tools/`.

## Consequences

- The wing is readable at a glance: who is who, sitting, in bed, on the floor, and walking which way.
- The browser now loads about 3 MB of art. The static map is painted once to a canvas, so each frame still draws only people, furniture and overlays.
- The drawing is taller than the floor plan (three 64 px bands) and shows a garden strip. Anything that converts between the screen and the world must use `banding.ts`. Tests cover the mapping, its inverse and picking.
- Art licences now matter: new art needs its credits added, and share-alike applies to changed art.
- Constitution rule 6 and `.claude/rules/web.md` change from "simple shapes, no sprites" to "readable pixel art drawn from server state". The engine-side rules (server-authoritative, browser draws state only, no simulation logic in `apps/web`) stay as they are.
- Follow-up: doc 08 describes the renderer; tuning is in the manifest.

## Alternatives considered

- **Keep simple shapes:** cheapest, but not readable enough to show the simulation to people.
- **Draw each wall face over the top of its room instead of banding:** the face would cover the bed heads and half the corridor.
- **A full 96 px LPC face:** more authentic, but makes the drawing taller for little gain. The 64 px face, cut from the 96 px art, keeps its top and skirting.
- **A hand-painted map (e.g. a Tiled map):** looks good once, but drifts from `floorplan.json` whenever the plan changes.
