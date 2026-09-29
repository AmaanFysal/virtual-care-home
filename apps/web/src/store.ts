// Dashboard state: a pure mirror of what the server sends (docs/08). No simulation logic.

import { create } from "zustand";
import type { AnySimEvent, ClockView, FloorPlan, PersonDetail, PersonView, ServerMessage } from "@vch/shared-types";

const MAX_EVENTS = 500;

export interface ViewState {
  status: "connecting" | "open" | "closed";
  clock: ClockView | null;
  floorplan: FloorPlan | null;
  people: Record<string, PersonView>;
  events: AnySimEvent[];
  selectedId: string | null;
  detail: PersonDetail | null;
  /** Camera follows the selected person. */
  following: boolean;
  /** Name tags over everyone (otherwise only the selected and hovered person). */
  showTags: boolean;
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
  following: false,
  showTags: true,
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
        error: null,
      };
    case "delta": {
      const people = message.people.length > 0 ? { ...state.people } : state.people;
      for (const p of message.people) people[p.id] = p;
      const events = message.events.length > 0 ? [...state.events, ...message.events].slice(-MAX_EVENTS) : state.events;
      return { clock: message.clock, people, events };
    }
    case "clock":
      return { clock: message.clock };
    case "detail":
      // Ignore a late reply for someone who is no longer selected.
      return message.detail.person.id === state.selectedId ? { detail: message.detail } : {};
    case "error":
      return { error: message.message };
  }
}

export const useView = create<ViewState>(() => initialState);

export function applyMessage(message: ServerMessage): void {
  useView.setState((state) => reduce(state, message));
}
