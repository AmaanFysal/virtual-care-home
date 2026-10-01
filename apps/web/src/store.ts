// Dashboard state: a pure mirror of what the server sends (docs/08). No simulation logic.

import { create } from "zustand";
import type { AnySimEvent, BuildingView, ClockView, DirectorView, FloorPlan, PersonDetail, PersonView, Role, RoomDetail, ServerMessage } from "@vch/shared-types";

const MAX_EVENTS = 500;

export interface ViewState {
  status: "connecting" | "open" | "closed";
  clock: ClockView | null;
  floorplan: FloorPlan | null;
  people: Record<string, PersonView>;
  events: AnySimEvent[];
  selectedId: string | null;
  detail: PersonDetail | null;
  /** Doors, windows and the weather (v1.0-testbed). */
  building: BuildingView | null;
  /** A room selected by clicking its floor, and its slice of the world description. */
  selectedRoomId: string | null;
  roomDetail: RoomDetail | null;
  /** Camera follows the selected person. */
  following: boolean;
  /** Name tags over everyone (otherwise only the selected and hovered person). */
  showTags: boolean;
  /** How the run uses the scenario director (from the snapshot). */
  director: DirectorView | null;
  /** Which panel shows above the event log. */
  sideTab: "inspector" | "director";
  /**
   * What the server lets this connection do: controls show only for admins (docs/08). Locally the
   * server says admin; on the public server, viewer until the admin page's token is accepted.
   */
  role: Role;
  /** The hidden admin page (#/admin) is open. */
  adminPage: boolean;
  /** The answer to the last admin token sent, when it wasn't accepted. */
  authMessage: string | null;
  error: string | null;
}

export const initialState: ViewState = {
  status: "connecting",
  clock: null,
  floorplan: null,
  people: {},
  events: [],
  selectedId: null,
  detail: null,
  building: null,
  selectedRoomId: null,
  roomDetail: null,
  following: false,
  showTags: true,
  director: null,
  sideTab: "inspector",
  role: "viewer",
  adminPage: false,
  authMessage: null,
  error: null,
};

/** Folds one server message into the view state. */
export function reduce(state: ViewState, message: ServerMessage): Partial<ViewState> {
  switch (message.type) {
    case "snapshot":
      return {
        clock: message.clock,
        floorplan: message.floorplan,
        people: Object.fromEntries(message.people.map((p) => [p.id, p])),
        events: message.events.slice(-MAX_EVENTS),
        director: message.director,
        building: message.building,
        role: message.role,
        error: null,
      };
    case "delta": {
      const people = message.people.length > 0 ? { ...state.people } : state.people;
      for (const p of message.people) people[p.id] = p;
      const events = message.events.length > 0 ? [...state.events, ...message.events].slice(-MAX_EVENTS) : state.events;
      return { clock: message.clock, people, events, ...(message.building && state.building ? { building: mergeBuilding(state.building, message.building) } : {}) };
    }
    case "clock":
      return { clock: message.clock };
    case "detail":
      // Ignore a late reply for someone who is no longer selected.
      return message.detail.person.id === state.selectedId ? { detail: message.detail } : {};
    case "room":
      return message.room.roomId === state.selectedRoomId ? { roomDetail: message.room } : {};
    case "auth":
      return { role: message.role, authMessage: message.ok ? null : (message.message ?? "Not accepted") };
    case "error":
      return { error: message.message };
  }
}

/** Applies a delta's changed doors and windows (by id) and new weather. */
function mergeBuilding(current: BuildingView, change: Partial<BuildingView>): BuildingView {
  const byId = <T,>(list: T[], changed: T[] | undefined, id: (x: T) => string): T[] => {
    if (!changed?.length) return list;
    const next = new Map(changed.map((x) => [id(x), x]));
    return list.map((x) => next.get(id(x)) ?? x);
  };
  return {
    doors: byId(current.doors, change.doors, (d) => d.doorId),
    windows: byId(current.windows, change.windows, (w) => w.windowId),
    equipment: byId(current.equipment, change.equipment, (e) => e.equipmentId),
    weather: change.weather !== undefined ? change.weather : current.weather,
  };
}

export const useView = create<ViewState>(() => initialState);

export function applyMessage(message: ServerMessage): void {
  useView.setState((state) => reduce(state, message));
}
