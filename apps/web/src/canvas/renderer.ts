// Draws the wing as LPC pixel art (docs/08 "Pixel-art map"): a map painted from the floor plan,
// furniture and people y-sorted together, name tags, and night lighting. It only interpolates
// between positions the server sent and derives poses from them; it never invents state.
//
// Pixel-perfect: nearest-neighbour textures and a whole number of device pixels per art pixel.
// Every screen <-> world conversion goes through one Banding (banding.ts): drawing, click to
// select, hover, Follow and the camera.

import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureSource } from "pixi.js";
import { timeOfDay, type BuildingView, type ClockView, type FloorPlan, type PersonKind, type PersonView } from "@vch/shared-types";
import { spriteFor, sprites, type SpriteEntry } from "../sprites";
import { makeBanding, type Banding } from "./banding";
import { SIT_DY, activityIcon, directionOf, facingFixture, figureBox, makeSlide, pickPerson, seatAt, seatFacings, slideAt, slideRest, type Dir, type FigureBox, type IconName, type Slide } from "./figures";
import { drawBuilding } from "./buildingLayer";
import { paintMap, type Images } from "./mapPainter";
import tileset from "./tileset.json";

export const PERSON_COLOURS: Record<PersonKind, number> = {
  staff: 0x2f6fdb,
  resident: 0x2e9d5b,
  visitor: 0xe8862a,
  agency: 0x8a8f98,
  external: 0x8e5bd6,
};

const FRAME = sprites.frame;
/** Where the feet are in a character frame. */
const FEET = { x: 32, y: 62 };
/** Walking frames advance once per this many world pixels walked. */
const STRIDE_PX = 5;
const FOLLOW_EXTRA_ZOOM = 1;
const MAX_ZOOM = 6;
/** A press that moves further than this (screen px) is a drag, not a click. */
const DRAG_PX = 5;

/** 0 by day, 1 in the dead of night, ramping at dusk (20:00-22:00) and dawn (06:00-07:30). */
export function nightFactor(t: number): number {
  const h = timeOfDay(t) / 3600;
  if (h >= 22 || h < 6) return 1;
  if (h >= 20) return (h - 20) / 2;
  if (h < 7.5) return 1 - (h - 6) / 1.5;
  return 0;
}

interface Figure {
  view: PersonView;
  entry: SpriteEntry | null;
  root: Container;
  ring: Graphics;
  under: Sprite;
  body: Sprite;
  over: Sprite;
  blanket: Sprite;
  tag: Container;
  tagBg: Graphics;
  tagText: Text;
  tagIcon: Sprite;
  tagW: number;
  /** The slide being drawn: from where they were, through turning points, to the latest position. */
  slide: Slide;
  startMs: number;
  durationMs: number;
  dir: Dir;
  walked: number;
  last: { x: number; y: number };
  box: FigureBox | null;
}

export class WingRenderer {
  private app = new Application();
  /** Everything in world pixels, scaled by a whole-number zoom. */
  private camera = new Container();
  private mapLayer = new Container();
  /** Door leaves and open windows, from the server's building view (v1.0-testbed). */
  private buildingLayer = new Graphics();
  /** An outline round the selected room. */
  private roomOutline = new Graphics();
  private building: BuildingView | null = null;
  private selectedRoomId: string | null = null;
  private sorted = new Container();
  private night = new Graphics();
  private lights = new Graphics();
  private labels = new Container();
  private tags = new Container();
  private figures = new Map<string, Figure>();
  private plan: FloorPlan | null = null;
  private banding: Banding | null = null;
  private facings = new Map<string, Dir>();
  /** The painted map, building and garden, in world pixels. */
  private mapSize = { w: 1, h: 1 };
  private lampSpots: { x: number; y: number }[] = [];
  private clock: ClockView | null = null;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private following = false;
  private showTags = true;
  private images: Images | null = null;
  private sheets = new Map<string, Texture>();
  private frames = new Map<string, Texture>();
  private icons = new Map<IconName, Texture>();
  /** Device pixels per art pixel: always a whole number. */
  private zoom = 1;
  private userZoom: number | null = null;
  private centre = { x: 0, y: 0 };
  private panned = false;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private destroyed = false;
  private initialised = false;

  constructor(
    private onSelect: (id: string | null) => void,
    /** A click on empty floor selects the room under it (v1.0-testbed). */
    private onSelectRoom: (roomId: string | null) => void = () => {},
  ) {}

  async init(host: HTMLElement): Promise<void> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    // Decode images on the main thread: simpler, and headless screenshots don't wait on workers.
    Assets.setPreferences({ preferWorkers: false });
    await this.app.init({ resizeTo: host, background: 0x23201f, antialias: false, roundPixels: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    const images = await this.loadImages().catch((e: unknown) => {
      console.error("Could not load the tile art", e);
      return null;
    });
    if (this.destroyed || !images) {
      this.app.destroy(true);
      return;
    }
    this.images = images;
    this.initialised = true;
    host.appendChild(this.app.canvas);
    this.sorted.sortableChildren = true;
    this.camera.addChild(this.mapLayer, this.buildingLayer, this.roomOutline, this.sorted, this.night, this.lights, this.labels, this.tags);
    this.app.stage.addChild(this.camera);
    // Picking is done here, on the drawn figures (figures.pickPerson), not by Pixi's hit testing.
    this.camera.eventMode = "none";
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointerdown", (e) => (this.drag = { x: e.global.x, y: e.global.y, cx: this.centre.x, cy: this.centre.y, moved: false }));
    stage.on("pointermove", (e) => this.pointerMove(e.global.x, e.global.y));
    stage.on("pointerup", (e) => this.pointerUp(e.global.x, e.global.y));
    stage.on("pointerupoutside", () => (this.drag = null));
    this.app.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.app.ticker.add(() => this.frame());
    this.app.renderer.on("resize", () => this.fit());
    this.readUrl();
    if (this.plan) this.buildMap();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.initialised) this.app.destroy(true, { children: true });
  }

  setFollowing(on: boolean): void {
    // Stopping following goes back to the whole wing.
    if (this.following && !on) {
      this.userZoom = null;
      this.panned = false;
    }
    this.following = on;
  }

  setShowTags(on: boolean): void {
    this.showTags = on;
  }

  setFloorplan(plan: FloorPlan): void {
    if (plan === this.plan) return;
    this.plan = plan;
    this.banding = makeBanding(plan);
    this.facings = seatFacings(plan);
    if (this.initialised) this.buildMap();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  /** Doors and windows as the server last sent them. */
  setBuilding(building: BuildingView | null): void {
    this.building = building;
    this.drawBuildingLayer();
  }

  setSelectedRoom(roomId: string | null): void {
    this.selectedRoomId = roomId;
    this.drawRoomOutline();
  }

  private drawBuildingLayer(): void {
    if (!this.initialised || !this.plan || !this.banding || !this.building) return;
    drawBuilding(this.buildingLayer, this.plan, this.banding, this.building);
  }

  private drawRoomOutline(): void {
    this.roomOutline.clear();
    const room = this.plan?.rooms.find((r) => r.id === this.selectedRoomId);
    if (!room || !this.banding) return;
    const b = this.banding;
    const x0 = b.x(room.rect.x), x1 = b.x(room.rect.x + room.rect.w);
    // The room's floor as the painter draws it: shifted by the wall bands above, not stretched.
    const y0 = room.rect.y * 32 + b.offsetAt(room.rect.y);
    const y1 = (room.rect.y + room.rect.h) * 32 + b.offsetAt(room.rect.y + room.rect.h - 1e-6);
    this.roomOutline.rect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2).stroke({ width: 2, color: 0xffd43b, alpha: 0.9 });
  }

  /** The room under a point on the map: an en-suite before the bedroom round it. */
  private roomAt(sx: number, sy: number): string | null {
    if (!this.plan || !this.banding) return null;
    const m = this.banding.toWorld(this.toWorldPx(sx, sy));
    const hits = this.plan.rooms.filter((r) => m.x >= r.rect.x && m.x <= r.rect.x + r.rect.w && m.y >= r.rect.y && m.y <= r.rect.y + r.rect.h);
    hits.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
    return hits[0]?.id ?? null;
  }

  /** Takes the latest people from the server and starts interpolating towards them. */
  setPeople(people: Record<string, PersonView>, clock: ClockView | null): void {
    this.clock = clock;
    if (!this.initialised) return;
    const now = performance.now();
    // Spread each move over the real time until the next position is expected.
    const duration = clock && !clock.paused ? Math.max(100, Math.min(5000, 5000 / clock.speed)) : 250;
    for (const view of Object.values(people)) {
      let fig = this.figures.get(view.id);
      const fresh = !fig;
      if (!fig) {
        fig = this.createFigure(view);
        this.figures.set(view.id, fig);
      } else if (fig.view === view) continue; // unchanged since the last update (its `via` is already used)
      const prev = fig.view;
      fig.view = view;
      const via = view.via ?? [];
      if (!fresh && view.x === prev.x && view.y === prev.y && view.onMap === prev.onMap && via.length === 0) continue;
      // Slide from where they're drawn now, through the turning points they passed (path corners
      // and doorways), to the new position, so a turn between two updates doesn't cut a wall.
      const appear = fresh || (!prev.onMap && view.onMap);
      const to = { x: view.x, y: view.y };
      fig.slide = makeSlide(appear ? [...via, to] : [...slideRest(fig.slide, this.progress(fig, now)), ...via, to]);
      fig.startMs = now;
      fig.durationMs = appear && via.length === 0 ? 0 : duration;
      if (appear) fig.last = { ...fig.slide.points[0]! };
    }
    this.drawAway(people);
  }

  // ------------------------------------------------------------------ assets

  private async loadImages(): Promise<Images> {
    const entries = Object.entries(tileset.images) as [keyof Images, string][];
    const loaded = await Promise.all(entries.map(([, url]) => Assets.load<Texture>(`/${url}`)));
    const images = {} as Images;
    entries.forEach(([key], i) => (images[key] = loaded[i]!.source.resource as CanvasImageSource));
    const icons = loaded[entries.findIndex(([k]) => k === "icons")]!;
    tileset.icons.order.forEach((name, i) => {
      const s = tileset.icons.size;
      this.icons.set(name as IconName, new Texture({ source: icons.source, frame: new Rectangle(i * s, 0, s, s) }));
    });
    // Walking aids the generator has no frames for: Peggy's zimmer, Win's and Kamala's sticks.
    for (const [name, o] of Object.entries(sprites.overlays)) this.sheets.set(`overlay:${name}`, await Assets.load<Texture>(`/${o.image}`));
    return images;
  }

  private sheet(entry: SpriteEntry): Texture | null {
    const tex = this.sheets.get(entry.sheet);
    if (tex) return tex;
    if (!this.sheets.has(`loading:${entry.sheet}`)) {
      this.sheets.set(`loading:${entry.sheet}`, Texture.EMPTY);
      void Assets.load<Texture>(`/${entry.sheet}`).then((t) => this.sheets.set(entry.sheet, t));
    }
    return null;
  }

  private frameTexture(source: Texture, x: number, y: number, w = FRAME, h = FRAME): Texture {
    const key = `${source.uid}:${x},${y},${w},${h}`;
    let t = this.frames.get(key);
    if (!t) {
      t = new Texture({ source: source.source, frame: new Rectangle(x, y, w, h) });
      this.frames.set(key, t);
    }
    return t;
  }

  // ------------------------------------------------------------------ the map

  private buildMap(): void {
    if (!this.plan || !this.banding || !this.images) return;
    for (const child of this.mapLayer.removeChildren()) child.destroy({ texture: true, textureSource: true });
    for (const child of [...this.sorted.children]) if (child.label === "furniture") child.destroy({ texture: true, textureSource: true });
    const { base, furniture, size, lamps } = paintMap(this.plan, this.banding, this.images, this.facings);
    this.mapSize = size;
    this.lampSpots = lamps;
    this.mapLayer.addChild(new Sprite(Texture.from(base)));
    for (const piece of furniture) {
      const s = new Sprite(Texture.from(piece.canvas));
      s.label = "furniture";
      s.position.set(piece.x, piece.y);
      s.zIndex = piece.z;
      this.sorted.addChild(s);
    }
    this.drawRoomLabels();
    this.drawBuildingLayer();
    this.drawRoomOutline();
    this.fit();
    this.applyPendingView();
  }

  private drawRoomLabels(): void {
    for (const child of this.labels.removeChildren()) child.destroy();
    const plan = this.plan!;
    const b = this.banding!;
    // Dark letters with a pale edge, so they read on light lino and dark carpet alike.
    const style = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 9, fill: 0x3b3530, fontWeight: "700" as const, letterSpacing: 1, stroke: { color: 0xfffaf0, width: 3 } };
    for (const room of plan.rooms) {
      if (room.kind === "ensuite") continue;
      const t = new Text({ text: room.name.toUpperCase(), style, resolution: 4 });
      t.alpha = 0.8;
      const top = room.rect.y * 32 + b.offsetAt(room.rect.y);
      // Clear of an en-suite in the bottom-left corner.
      const ensuite = plan.rooms.find((r) => r.kind === "ensuite" && r.rect.x === room.rect.x && r.rect.y + r.rect.h === room.rect.y + room.rect.h);
      t.position.set(Math.round(b.x(room.rect.x + (ensuite ? ensuite.rect.w : 0)) + 6), Math.round(top + 4));
      if (room.kind === "bedroom" || room.kind === "lounge") t.position.y = Math.round(room.rect.y * 32 + b.offsetAt(room.rect.y + room.rect.h - 1e-6) + room.rect.h * 32 - 14);
      this.labels.addChild(t);
    }
    const exit = plan.doors.find((d) => d.rooms.includes("Outside"));
    if (exit) {
      const t = new Text({ text: "EXIT", style: { ...style, fill: 0x9a2f1f }, resolution: 4 });
      t.anchor.set(0.5, 0);
      // On the path, below the front wall.
      t.position.set(Math.round(b.x((exit.x1 + exit.x2) / 2)), Math.round(b.y(plan.size.h) + 8 + tileset.walls.exterior.southHeight + 4));
      this.labels.addChild(t);
    }
  }

  /** Labels the bed of any resident who is away from the wing (e.g. taken to hospital). */
  private drawAway(people: Record<string, PersonView>): void {
    if (!this.plan || !this.banding) return;
    for (const child of [...this.labels.children]) if (child.label === "away") child.destroy();
    for (const p of Object.values(people)) {
      // Only a stay in hospital is labelled; after a death the room is simply empty.
      if (p.onMap || p.away !== "hospital" || !p.bedId) continue;
      const bed = this.plan.points.find((pt) => pt.id === p.bedId);
      if (!bed) continue;
      const label = new Text({ text: `${p.initials}\nIN HOSPITAL`, style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 8, fontWeight: "700", fill: 0xffffff, align: "center", stroke: { color: 0xb23b3b, width: 3 } }, resolution: 4 });
      label.label = "away";
      label.anchor.set(0.5);
      const at = this.banding.toScreen(bed);
      label.position.set(Math.round(at.x), Math.round(at.y));
      this.labels.addChild(label);
    }
  }

  // ------------------------------------------------------------------ people

  private createFigure(view: PersonView): Figure {
    const root = new Container();
    const ring = new Graphics();
    const under = new Sprite();
    const body = new Sprite();
    const over = new Sprite();
    const blanket = new Sprite();
    for (const s of [under, body, over]) s.anchor.set(FEET.x / FRAME, FEET.y / FRAME);
    root.addChild(ring, under, body, over, blanket);
    this.sorted.addChild(root);
    const tag = new Container();
    const tagBg = new Graphics();
    const tagText = new Text({ text: view.initials, style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 8, fontWeight: "700", fill: 0xffffff }, resolution: 4 });
    tagText.anchor.set(0, 0.5);
    const tagIcon = new Sprite();
    tagIcon.anchor.set(0, 0.5);
    tag.addChild(tagBg, tagText, tagIcon);
    this.tags.addChild(tag);
    return {
      view,
      entry: spriteFor(view),
      root,
      ring,
      under,
      body,
      over,
      blanket,
      tag,
      tagBg,
      tagText,
      tagIcon,
      tagW: 0,
      slide: makeSlide([{ x: view.x, y: view.y }]),
      startMs: 0,
      durationMs: 0,
      dir: "south",
      walked: 0,
      last: { x: view.x, y: view.y },
      box: null,
    };
  }

  private progress(fig: Figure, now: number): number {
    return fig.durationMs <= 0 ? 1 : Math.min(1, (now - fig.startMs) / fig.durationMs);
  }

  private currentPos(fig: Figure, now: number): { x: number; y: number } {
    return slideAt(fig.slide, this.progress(fig, now));
  }

  private drawFigure(fig: Figure, now: number): void {
    const b = this.banding!;
    const { view, entry } = fig;
    fig.root.visible = view.onMap;
    fig.tag.visible = view.onMap && (this.showTags || view.id === this.selectedId || view.id === this.hoverId);
    if (!view.onMap) {
      fig.box = null;
      return;
    }
    const pos = this.currentPos(fig, now);
    const moved = Math.hypot(pos.x - fig.last.x, pos.y - fig.last.y);
    const moving = moved > 1e-4;
    if (moving) {
      fig.dir = directionOf(pos.x - fig.last.x, pos.y - fig.last.y, fig.dir);
      fig.walked += moved * 32;
    }
    fig.last = pos;
    const posture = view.posture;
    const seated = posture === "sitting" || posture === "dozing";
    if (seated && !moving) {
      const seat = seatAt(this.plan!, pos.x, pos.y);
      // No chair there (Raj in his wheelchair by the bed): face the camera.
      fig.dir = seat ? (this.facings.get(seat.id) ?? fig.dir) : "south";
    }
    if (posture === "standing" && !moving) fig.dir = facingFixture(this.plan!, pos.x, pos.y) ?? fig.dir;
    const scale = entry?.scale ?? 1;
    const box = figureBox(view, pos, b, scale);
    fig.box = box;
    const { x, y } = box.anchor;
    fig.root.position.set(Math.round(x), Math.round(y));
    fig.root.zIndex = y + 0.5;

    const sheet = entry ? this.sheet(entry) : null;
    const dirRow = sprites.directions.indexOf(fig.dir);
    const L = sprites.layout;
    fig.under.visible = false;
    fig.over.visible = false;
    fig.blanket.visible = false;
    fig.body.visible = !!sheet;
    fig.body.scale.set(scale);
    fig.body.position.set(0, 0);
    fig.body.anchor.set(FEET.x / FRAME, FEET.y / FRAME);
    if (sheet && entry) {
      if (posture === "in_bed") {
        // A head on the pillow, the sheet pulled up over the shoulders.
        const head = L.bed!.head!;
        fig.body.texture = this.frameTexture(sheet, (L.bed!.frame ?? 0) * FRAME + head.x, L.bed!.row! * FRAME + head.y, head.w, head.h);
        fig.body.anchor.set(0.5, 0.5);
        fig.body.position.set(0, -2);
        const bed = tileset.furniture.bed;
        fig.blanket.texture = this.bedBlanket();
        fig.blanket.visible = true;
        fig.blanket.position.set(-bed.pillow.x, bed.blanketFrom - bed.pillow.y);
      } else if (posture === "on_floor") {
        fig.body.texture = this.frameTexture(sheet, L.floor!.frame! * FRAME, L.floor!.row! * FRAME);
      } else if (entry.sit === "wheelchair") {
        const wf = moving ? Math.floor(fig.walked / (STRIDE_PX * 2)) % L.wheelchair!.frames! : 0;
        fig.body.texture = this.frameTexture(sheet, wf * FRAME, L.wheelchair!.y! + dirRow * FRAME);
      } else if (seated && !moving) {
        fig.body.texture = this.frameTexture(sheet, L.sit!.frame! * FRAME, (L.sit!.row! + dirRow) * FRAME);
        fig.body.position.set(0, SIT_DY);
      } else {
        const cycle = L.walk!.cycle!;
        const frame = moving ? cycle[Math.floor(fig.walked / STRIDE_PX) % cycle.length]! : L.stand!.frame!;
        fig.body.texture = this.frameTexture(sheet, frame * FRAME, (L.walk!.row! + dirRow) * FRAME);
        // A walking aid on every walk and stand frame: Peggy's zimmer (under her when she faces
        // away), or a stick for anyone whose card says they use one.
        const overlay = entry.overlay ? sprites.overlays[entry.overlay] : undefined;
        const tex = this.sheets.get(`overlay:${entry.overlay}`);
        if (overlay && tex) {
          const f = overlay.frames[fig.dir]!;
          const s = f.under ? fig.under : fig.over;
          s.texture = this.frameTexture(tex, f.index * FRAME, 0);
          s.scale.set(scale);
          s.visible = true;
        }
      }
    }

    // A soft shadow, and a ring for the selected, hovered or fallen person.
    const r = fig.ring.clear();
    if (posture !== "in_bed") r.ellipse(0, 0, 9 * scale, 3.5 * scale).fill({ color: 0x000000, alpha: 0.25 });
    const ringAt = posture === "in_bed" ? { y: 0, rx: 13, ry: 13 } : { y: 0, rx: 12 * scale, ry: 5 * scale };
    if (posture === "on_floor") r.ellipse(0, -8, 24, 10).stroke({ width: 2, color: 0xe03131, alpha: 0.6 + 0.4 * Math.sin(now / 150) });
    if (view.id === this.selectedId) r.ellipse(0, ringAt.y, ringAt.rx, ringAt.ry).stroke({ width: 1.5, color: 0xffd43b });
    else if (view.id === this.hoverId) r.ellipse(0, ringAt.y, ringAt.rx, ringAt.ry).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });

    if (fig.tag.visible) this.drawTag(fig, x, posture === "in_bed" ? y - 14 : posture === "on_floor" ? y - 34 : y - 52 * scale + (seated ? SIT_DY + 6 : 0));
  }

  private blanketTexture: Texture | null = null;
  private bedBlanket(): Texture {
    if (!this.blanketTexture) {
      const bed = tileset.furniture.bed;
      const wood = Assets.get<Texture>(`/${tileset.images.wood}`);
      this.blanketTexture = new Texture({ source: wood.source, frame: new Rectangle(bed.x, bed.y + bed.blanketFrom, bed.w, bed.h - bed.blanketFrom) });
    }
    return this.blanketTexture;
  }

  private drawTag(fig: Figure, x: number, y: number): void {
    const { view } = fig;
    const icon = activityIcon(view);
    fig.tagText.text = view.initials;
    fig.tagIcon.visible = !!icon;
    if (icon) fig.tagIcon.texture = this.icons.get(icon)!;
    const textW = Math.ceil(fig.tagText.width);
    const w = 4 + textW + (icon ? 13 : 0) + 3;
    const h = 11;
    const left = -Math.round(w / 2);
    fig.tagBg
      .clear()
      .roundRect(left, -h / 2, w, h, 2)
      .fill({ color: PERSON_COLOURS[view.kind], alpha: 0.92 })
      .stroke({ width: 1, color: view.id === this.selectedId ? 0xffd43b : 0x1d1b1f });
    fig.tagText.position.set(left + 4, 0);
    fig.tagIcon.position.set(left + 4 + textW + 2, 0);
    fig.tag.position.set(Math.round(x), Math.round(y));
    fig.tagW = w;
  }

  /** Moves overlapping name tags apart: the front-most keeps its place, the others rise above it. */
  private separateTags(): void {
    const tags = [...this.figures.values()].filter((f) => f.tag.visible).sort((p, q) => q.tag.y - p.tag.y);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const H = 11;
    for (const f of tags) {
      const x0 = f.tag.x - f.tagW / 2 - 1, x1 = f.tag.x + f.tagW / 2 + 1;
      let y = f.tag.y;
      for (let i = 0; i < 8; i++) {
        const hit = placed.find((p) => x0 < p.x1 && x1 > p.x0 && y - H / 2 < p.y1 && y + H / 2 > p.y0);
        if (!hit) break;
        y = hit.y0 - H / 2;
      }
      f.tag.y = Math.round(y);
      placed.push({ x0, x1, y0: y - H / 2, y1: y + H / 2 });
    }
  }

  // ------------------------------------------------------------------ frame, night, camera

  private frame(): void {
    if (!this.banding) return;
    const now = performance.now();
    for (const fig of this.figures.values()) this.drawFigure(fig, now);
    this.separateTags();
    this.drawNight();
    this.moveCamera();
  }

  private drawNight(): void {
    const plan = this.plan!;
    const b = this.banding!;
    this.night.clear();
    this.lights.clear();
    const k = this.clock ? nightFactor(this.clock.t) : 0;
    if (k <= 0) return;
    this.night.rect(0, 0, this.mapSize.w, this.mapSize.h).fill({ color: 0x0b1a33, alpha: 0.55 * k });
    // Bedside lamps.
    for (const l of this.lampSpots) {
      for (const [rad, a] of [[20, 0.1], [11, 0.16], [5, 0.3]] as const) this.lights.circle(l.x, l.y, rad).fill({ color: 0xffd98a, alpha: a * k });
    }
    const corridor = plan.rooms.find((r) => r.kind === "corridor");
    if (!corridor) return;
    const y = b.y(corridor.rect.y + corridor.rect.h / 2);
    for (let x = corridor.rect.x + 2; x < corridor.rect.x + corridor.rect.w; x += 4) {
      const cx = b.x(x);
      for (const [rad, a] of [[40, 0.06], [26, 0.07], [14, 0.09]] as const) this.lights.ellipse(cx, y, rad, rad * 0.6).fill({ color: 0xffd98a, alpha: a * k });
      this.lights.rect(cx - 3, y - 1, 6, 2).fill({ color: 0xfff1c9, alpha: 0.9 * k });
    }
  }

  /** The zoom that fits the whole wing, in device pixels per art pixel (at least 1). */
  private fitZoom(): number {
    const dpr = this.app.renderer.resolution;
    const { width, height } = this.app.screen;
    if (!this.banding) return 1;
    return Math.max(1, Math.floor(Math.min((width * dpr) / this.mapSize.w, (height * dpr) / this.mapSize.h)));
  }

  private fit(): void {
    if (!this.banding) return;
    if (!this.panned) this.centre = { x: this.mapSize.w / 2, y: this.mapSize.h / 2 };
  }

  private moveCamera(): void {
    if (!this.banding) return;
    const dpr = this.app.renderer.resolution;
    const target = this.selectedId ? this.figures.get(this.selectedId) : undefined;
    const follow = this.following && target?.box;
    const base = this.fitZoom();
    this.zoom = Math.min(MAX_ZOOM, this.userZoom ?? (follow ? base + FOLLOW_EXTRA_ZOOM : base));
    if (follow) {
      const to = { x: target.box!.anchor.x, y: target.box!.anchor.y - 24 };
      this.centre.x += (to.x - this.centre.x) * 0.15;
      this.centre.y += (to.y - this.centre.y) * 0.15;
    } else if (!this.panned) this.fit();
    const scale = this.zoom / dpr;
    const { width, height } = this.app.screen;
    this.camera.scale.set(scale);
    // Whole device pixels, so the art never lands between pixels.
    this.camera.position.set(Math.round((width / 2 - this.centre.x * scale) * dpr) / dpr, Math.round((height / 2 - this.centre.y * scale) * dpr) / dpr);
  }

  /** Screen (CSS px on the canvas) -> world pixels, through the camera. */
  private toWorldPx(sx: number, sy: number): { x: number; y: number } {
    const s = this.camera.scale.x;
    return { x: (sx - this.camera.x) / s, y: (sy - this.camera.y) / s };
  }

  private pick(sx: number, sy: number): string | null {
    const boxes = [...this.figures.values()].map((f) => f.box).filter((b): b is FigureBox => !!b);
    return pickPerson(boxes, this.toWorldPx(sx, sy));
  }

  private pointerMove(sx: number, sy: number): void {
    if (this.drag) {
      const dx = sx - this.drag.x, dy = sy - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > DRAG_PX) this.drag.moved = true;
      // Drag to pan, except while the camera is following someone.
      if (this.drag.moved && !this.following) {
        const s = this.camera.scale.x;
        this.panned = true;
        this.centre = { x: this.drag.cx - dx / s, y: this.drag.cy - dy / s };
        return;
      }
    }
    this.hoverId = this.pick(sx, sy);
    this.app.canvas.style.cursor = this.hoverId ? "pointer" : this.drag ? "grabbing" : "grab";
  }

  private pointerUp(sx: number, sy: number): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) return;
    const person = this.pick(sx, sy);
    if (person) this.onSelect(person);
    else {
      const room = this.roomAt(sx, sy);
      if (room) this.onSelectRoom(room);
      else this.onSelect(null);
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = this.toWorldPx(sx, sy);
    const next = Math.max(1, Math.min(MAX_ZOOM, this.zoom + (e.deltaY < 0 ? 1 : -1)));
    if (next === this.zoom) return;
    this.userZoom = next;
    this.zoom = next;
    // Keep the point under the cursor where it is.
    const scale = next / this.app.renderer.resolution;
    const { width, height } = this.app.screen;
    this.centre = { x: before.x - (sx - width / 2) / scale, y: before.y - (sy - height / 2) / scale };
    this.panned = next !== this.fitZoom();
    if (!this.panned) this.userZoom = null;
  }

  /** ?view=Room2&zoom=3 opens on a room at a zoom (for screenshots). */
  private readUrl(): void {
    const q = new URLSearchParams(window.location.search);
    const zoom = Number(q.get("zoom"));
    if (zoom >= 1) this.userZoom = Math.min(MAX_ZOOM, Math.round(zoom));
    const view = q.get("view");
    if (view) this.pendingView = view;
  }

  private pendingView: string | null = null;

  /** Centres on a room (from ?view=). */
  private centreOnRoom(roomId: string): void {
    const room = this.plan?.rooms.find((r) => r.id === roomId);
    if (!room || !this.banding) return;
    const b = this.banding;
    this.centre = { x: b.x(room.rect.x + room.rect.w / 2), y: (b.y(room.rect.y) + b.y(room.rect.y + room.rect.h)) / 2 - 16 };
    this.panned = true;
  }

  private applyPendingView(): void {
    if (this.pendingView && this.plan) {
      this.centreOnRoom(this.pendingView);
      this.pendingView = null;
    }
  }
}
