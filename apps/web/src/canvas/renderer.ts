// Draws the wing with plain shapes (constitution rule 6): labelled rectangles for rooms,
// wall lines with door gaps, grey furniture, and coloured circles with initials for people.
// It only interpolates between positions the server sent; it never invents state.

import { Application, Container, Graphics, Text } from "pixi.js";
import { timeOfDay, type Badge, type ClockView, type FloorPlan, type PersonKind, type PersonView, type RoomKind } from "@vch/shared-types";

export const PERSON_COLOURS: Record<PersonKind, number> = {
  staff: 0x2f6fdb,
  resident: 0x2e9d5b,
  visitor: 0xe8862a,
  agency: 0x8a8f98,
  external: 0x8e5bd6,
};

const ROOM_FILL: Record<RoomKind, number> = {
  bedroom: 0xfbf7ee,
  corridor: 0xeceae4,
  lounge: 0xf4efe2,
  reception: 0xeef1f4,
  staff: 0xf1ebe4,
};

const BADGE_TEXT: Record<Badge, string> = {
  pill: "meds",
  tray: "meal",
  cup: "drink",
  towel: "care",
  hoist: "hoist",
  asleep: "zz",
  confused: "?",
  break: "break",
  handover: "handover",
  phone: "phone",
  alert: "!",
};

const PERSON_RADIUS_M = 0.3;
const WALL_M = 0.12;
const NIGHT_LIGHTS_X = [2, 6, 10, 14, 18];

interface PersonSprite {
  view: PersonView;
  root: Container;
  ring: Graphics;
  body: Graphics;
  label: Text;
  badge: Text;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startMs: number;
  durationMs: number;
}

/** 0 by day, 1 in the dead of night, ramping at dusk (20:00-22:00) and dawn (06:00-07:30). */
export function nightFactor(t: number): number {
  const h = timeOfDay(t) / 3600;
  if (h >= 22 || h < 6) return 1;
  if (h >= 20) return (h - 20) / 2;
  if (h < 7.5) return 1 - (h - 6) / 1.5;
  return 0;
}

export class WingRenderer {
  private app = new Application();
  private floor = new Container();
  private peopleLayer = new Container();
  private night = new Graphics();
  private nightLights = new Graphics();
  /** "In hospital" labels on the beds of residents who are away. */
  private awayLayer = new Container();
  private sprites = new Map<string, PersonSprite>();
  private plan: FloorPlan | null = null;
  private clock: ClockView | null = null;
  private selectedId: string | null = null;
  private ppm = 40;
  private offset = { x: 0, y: 0 };
  private destroyed = false;
  private initialised = false;

  constructor(private onSelect: (id: string) => void) {}

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0xe7e3da, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.initialised = true;
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.floor, this.awayLayer, this.peopleLayer, this.night, this.nightLights);
    this.app.ticker.add(() => this.frame());
    this.app.renderer.on("resize", () => this.layout());
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.initialised) this.app.destroy(true, { children: true });
  }

  setFloorplan(plan: FloorPlan): void {
    this.plan = plan;
    this.layout();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const sprite of this.sprites.values()) this.drawPerson(sprite);
  }

  /** Takes the latest people from the server and starts interpolating towards them. */
  setPeople(people: Record<string, PersonView>, clock: ClockView | null): void {
    this.clock = clock;
    if (!this.initialised) return;
    const now = performance.now();
    // Spread each move over the real time until the next position is expected.
    const duration = clock && !clock.paused ? Math.max(100, Math.min(5000, 5000 / clock.speed)) : 250;
    for (const view of Object.values(people)) {
      let sprite = this.sprites.get(view.id);
      if (!sprite) {
        sprite = this.createSprite(view);
        this.sprites.set(view.id, sprite);
      }
      const prev = sprite.view;
      sprite.view = view;
      if (view.x !== prev.x || view.y !== prev.y || view.onMap !== prev.onMap) {
        const snap = !prev.onMap && view.onMap;
        sprite.from = snap ? { x: view.x, y: view.y } : this.currentPos(sprite, now);
        sprite.to = { x: view.x, y: view.y };
        sprite.startMs = now;
        sprite.durationMs = snap ? 0 : duration;
      }
      this.drawPerson(sprite);
    }
    this.drawAway(people);
  }

  /** Labels the bed of any resident who is away from the wing (e.g. taken to hospital). */
  private drawAway(people: Record<string, PersonView>): void {
    for (const child of this.awayLayer.removeChildren()) child.destroy();
    if (!this.plan) return;
    for (const p of Object.values(people)) {
      if (p.onMap || !p.away || !p.bedId) continue;
      const bed = this.plan.points.find((pt) => pt.id === p.bedId);
      if (!bed) continue;
      const label = new Text({
        text: `${p.initials}\nIN HOSPITAL`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: Math.max(8, this.ppm * 0.2), fontWeight: "700", fill: 0xb23b3b, align: "center" },
      });
      label.anchor.set(0.5);
      label.position.set(this.offset.x + bed.x * this.ppm, this.offset.y + bed.y * this.ppm);
      this.awayLayer.addChild(label);
    }
  }

  private createSprite(view: PersonView): PersonSprite {
    const root = new Container();
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", () => this.onSelect(view.id));
    const ring = new Graphics();
    const body = new Graphics();
    const label = new Text({ text: view.initials, style: { fontFamily: "system-ui, sans-serif", fontWeight: "700", fill: 0xffffff, fontSize: 12 } });
    label.anchor.set(0.5);
    const badge = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontWeight: "600", fill: 0x333333, fontSize: 10 } });
    badge.anchor.set(0.5, 1);
    root.addChild(ring, body, label, badge);
    this.peopleLayer.addChild(root);
    return { view, root, ring, body, label, badge, from: { x: view.x, y: view.y }, to: { x: view.x, y: view.y }, startMs: 0, durationMs: 0 };
  }

  private drawPerson(sprite: PersonSprite): void {
    const { view } = sprite;
    const r = PERSON_RADIUS_M * this.ppm;
    sprite.root.visible = view.onMap;
    sprite.body.clear().circle(0, 0, r).fill({ color: PERSON_COLOURS[view.kind], alpha: view.posture === "in_bed" ? 0.75 : 1 });
    sprite.ring.clear();
    if (view.posture === "on_floor") sprite.ring.circle(0, 0, r * 1.6).stroke({ width: Math.max(2, r * 0.3), color: 0xd62828 });
    if (view.id === this.selectedId) sprite.ring.circle(0, 0, r * 1.3).stroke({ width: 2, color: 0x111111 });
    sprite.label.text = view.initials;
    sprite.label.style.fontSize = Math.max(8, r * 0.95);
    const badges = view.badges.map((b) => BADGE_TEXT[b]).join(" ");
    sprite.badge.text = badges;
    sprite.badge.style.fontSize = Math.max(8, r * 0.75);
    sprite.badge.position.set(0, -r * 1.15);
  }

  private currentPos(sprite: PersonSprite, now: number): { x: number; y: number } {
    const k = sprite.durationMs <= 0 ? 1 : Math.min(1, (now - sprite.startMs) / sprite.durationMs);
    return { x: sprite.from.x + (sprite.to.x - sprite.from.x) * k, y: sprite.from.y + (sprite.to.y - sprite.from.y) * k };
  }

  private frame(): void {
    const now = performance.now();
    for (const sprite of this.sprites.values()) {
      const pos = this.currentPos(sprite, now);
      sprite.root.position.set(this.offset.x + pos.x * this.ppm, this.offset.y + pos.y * this.ppm);
    }
    this.drawNight();
  }

  private drawNight(): void {
    if (!this.plan || !this.clock) return;
    const k = nightFactor(this.clock.t);
    const { w, h } = this.plan.size;
    this.night.clear();
    this.nightLights.clear();
    if (k <= 0) return;
    this.night.rect(this.offset.x, this.offset.y, w * this.ppm, h * this.ppm).fill({ color: 0x0b1a33, alpha: 0.45 * k });
    const corridor = this.plan.rooms.find((r) => r.kind === "corridor");
    if (!corridor) return;
    const y = this.offset.y + (corridor.rect.y + corridor.rect.h / 2) * this.ppm;
    for (const x of NIGHT_LIGHTS_X) {
      const cx = this.offset.x + x * this.ppm;
      this.nightLights.circle(cx, y, 0.6 * this.ppm).fill({ color: 0xffd98a, alpha: 0.18 * k });
      this.nightLights.circle(cx, y, 0.1 * this.ppm).fill({ color: 0xffe7b0, alpha: 0.9 * k });
    }
  }

  private layout(): void {
    if (!this.initialised || !this.plan) return;
    const { width, height } = this.app.screen;
    const margin = 24;
    this.ppm = Math.min((width - 2 * margin) / this.plan.size.w, (height - 2 * margin) / this.plan.size.h);
    this.offset = { x: (width - this.plan.size.w * this.ppm) / 2, y: (height - this.plan.size.h * this.ppm) / 2 };
    this.drawFloor(this.plan);
    for (const sprite of this.sprites.values()) this.drawPerson(sprite);
  }

  private drawFloor(plan: FloorPlan): void {
    const px = (m: number) => m * this.ppm;
    const X = (m: number) => this.offset.x + m * this.ppm;
    const Y = (m: number) => this.offset.y + m * this.ppm;
    for (const child of this.floor.removeChildren()) child.destroy();
    const g = new Graphics();
    this.floor.addChild(g);

    for (const room of plan.rooms) {
      g.rect(X(room.rect.x), Y(room.rect.y), px(room.rect.w), px(room.rect.h)).fill(ROOM_FILL[room.kind]);
    }
    for (const f of plan.furniture) {
      const colour = f.kind === "bed" ? 0xd9d5cc : f.kind === "wc" ? 0xd8e6ee : f.kind === "chair" ? 0xcfc8bb : 0xcbbba6;
      g.rect(X(f.rect.x), Y(f.rect.y), px(f.rect.w), px(f.rect.h)).fill(colour).stroke({ width: 1, color: 0xa9a397 });
    }
    // Walls minus their door gaps.
    for (const wall of plan.walls) {
      const horizontal = wall.y1 === wall.y2;
      const [a0, a1] = horizontal ? [Math.min(wall.x1, wall.x2), Math.max(wall.x1, wall.x2)] : [Math.min(wall.y1, wall.y2), Math.max(wall.y1, wall.y2)];
      const gaps = plan.doors
        .filter((d) => d.wall === wall.id)
        .map((d) => (horizontal ? [Math.min(d.x1, d.x2), Math.max(d.x1, d.x2)] : [Math.min(d.y1, d.y2), Math.max(d.y1, d.y2)]) as [number, number])
        .sort((p, q) => p[0] - q[0]);
      let cursor = a0;
      const segments: [number, number][] = [];
      for (const [g0, g1] of gaps) {
        if (g0 > cursor) segments.push([cursor, g0]);
        cursor = Math.max(cursor, g1);
      }
      if (cursor < a1) segments.push([cursor, a1]);
      for (const [s0, s1] of segments) {
        if (horizontal) g.moveTo(X(s0), Y(wall.y1)).lineTo(X(s1), Y(wall.y1));
        else g.moveTo(X(wall.x1), Y(s0)).lineTo(X(wall.x1), Y(s1));
      }
    }
    g.stroke({ width: Math.max(2, px(WALL_M)), color: 0x3b3a36, cap: "square" });

    const text = (s: string, x: number, y: number, size: number, colour = 0x6b675f, weight: "400" | "600" = "600") => {
      const t = new Text({ text: s, style: { fontFamily: "system-ui, sans-serif", fontSize: size, fill: colour, fontWeight: weight } });
      t.position.set(x, y);
      this.floor.addChild(t);
      return t;
    };
    const roomSize = Math.max(10, px(0.38));
    // Room names sit bottom-left, clear of the beds along the top walls; the corridor's sits
    // top-left, clear of the waypoints along its lower half.
    for (const room of plan.rooms) {
      const top = room.kind === "corridor";
      const t = text(room.name.toUpperCase(), X(room.rect.x + 0.2), Y(top ? room.rect.y + 0.1 : room.rect.y + room.rect.h - 0.12), roomSize);
      t.anchor.set(0, top ? 0 : 1);
    }
    for (const f of plan.furniture) {
      if (!f.label) continue;
      const t = text(f.label, X(f.rect.x + f.rect.w / 2), Y(f.rect.y + f.rect.h / 2), Math.max(7, px(0.22)), 0x7a756b, "400");
      t.anchor.set(0.5);
    }
    const exit = plan.doors.find((d) => d.rooms.includes("Outside"));
    if (exit) {
      const t = text("EXIT", X((exit.x1 + exit.x2) / 2), Y(exit.y1) + 4, Math.max(8, px(0.25)), 0x3b3a36);
      t.anchor.set(0.5, 0);
    }
  }
}
