import { useEffect, useRef } from "react";
import { select, selectRoom } from "../selection";
import { useView } from "../store";
import { WingRenderer } from "./renderer";

/** Hosts the Pixi canvas and feeds it server state from the store. */
export function WingCanvas() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderer = new WingRenderer(select, selectRoom);
    const push = (state = useView.getState()) => {
      if (state.floorplan) renderer.setFloorplan(state.floorplan);
      renderer.setPeople(state.people, state.clock);
      renderer.setSelected(state.selectedId);
      renderer.setFollowing(state.following);
      renderer.setShowTags(state.showTags);
      renderer.setBuilding(state.building);
      renderer.setSelectedRoom(state.selectedRoomId);
    };
    let unsubscribe = () => {};
    void renderer.init(host.current!).then(() => {
      push();
      unsubscribe = useView.subscribe((state, prev) => {
        if (state.floorplan !== prev.floorplan) renderer.setFloorplan(state.floorplan!);
        if (state.people !== prev.people || state.clock !== prev.clock) renderer.setPeople(state.people, state.clock);
        if (state.selectedId !== prev.selectedId) renderer.setSelected(state.selectedId);
        if (state.following !== prev.following) renderer.setFollowing(state.following);
        if (state.showTags !== prev.showTags) renderer.setShowTags(state.showTags);
        if (state.building !== prev.building) renderer.setBuilding(state.building);
        if (state.selectedRoomId !== prev.selectedRoomId) renderer.setSelectedRoom(state.selectedRoomId);
      });
    });
    return () => {
      unsubscribe();
      renderer.destroy();
    };
  }, []);

  return <div className="canvas-host" ref={host} />;
}
