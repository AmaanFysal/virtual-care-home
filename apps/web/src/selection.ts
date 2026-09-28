import { send } from "./net";
import { useView } from "./store";

/** Selects a person (or clears the selection) and asks the server for their details. */
export function select(id: string | null): void {
  useView.setState({ selectedId: id, detail: null, following: id ? useView.getState().following : false });
  if (id) send({ type: "inspect", personId: id });
}
