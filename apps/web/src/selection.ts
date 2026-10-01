import { send } from "./net";
import { useView } from "./store";

/** Selects a person (or clears the selection) and asks the server for their details. */
export function select(id: string | null): void {
  useView.setState({ selectedId: id, detail: null, selectedRoomId: null, roomDetail: null, following: id ? useView.getState().following : false });
  if (id) send({ type: "inspect", personId: id });
}

/** Selects a room (clicking its floor) and asks for its slice of the world description (v1.0-testbed). */
export function selectRoom(roomId: string | null): void {
  useView.setState({ selectedRoomId: roomId, roomDetail: null, selectedId: null, detail: null, following: false, sideTab: "inspector" });
  if (roomId) send({ type: "inspect_room", roomId });
}
