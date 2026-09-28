import { useEffect, useRef } from "react";
import { send } from "../net";
import { useView } from "../store";
import { WingRenderer } from "./renderer";

/** Hosts the Pixi canvas and feeds it server state from the store. */
export function WingCanvas() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const select = (id: string) => {
      useView.setState({ selectedId: id, detail: null });
      send({ type: "inspect", personId: id });
    };
    const renderer = new WingRenderer(select);
    const push = (state = useView.getState()) => {
      if (state.floorplan) renderer.setFloorplan(state.floorplan);
      renderer.setPeople(state.people, state.clock);
      renderer.setSelected(state.selectedId);
    };
    let unsubscribe = () => {};
    void renderer.init(host.current!).then(() => {
      push();
      unsubscribe = useView.subscribe((state, prev) => {
        if (state.floorplan !== prev.floorplan) renderer.setFloorplan(state.floorplan!);
        if (state.people !== prev.people || state.clock !== prev.clock) renderer.setPeople(state.people, state.clock);
        if (state.selectedId !== prev.selectedId) renderer.setSelected(state.selectedId);
      });
    });
    return () => {
      unsubscribe();
      renderer.destroy();
    };
  }, []);

  return <div className="canvas-host" ref={host} />;
}
