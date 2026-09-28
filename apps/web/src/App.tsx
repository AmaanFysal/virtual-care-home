import { WingCanvas } from "./canvas/WingCanvas";
import { send } from "./net";
import { ClockBar } from "./components/ClockBar";
import { useView } from "./store";

const LEGEND = [
  ["staff", "Staff"],
  ["resident", "Resident"],
  ["visitor", "Visitor"],
  ["agency", "Agency"],
] as const;

export function App() {
  const status = useView((s) => s.status);
  const error = useView((s) => s.error);
  const selected = useView((s) => (s.selectedId ? s.people[s.selectedId] : undefined));
  return (
    <div className="app">
      <header>
        <h1>Virtual Care Home</h1>
        <ClockBar />
        <ul className="legend">
          {LEGEND.map(([kind, label]) => (
            <li key={kind}>
              <span className={`dot ${kind}`} />
              {label}
            </li>
          ))}
        </ul>
        <span className={`status ${status}`}>{status}</span>
      </header>
      <main>
        <WingCanvas />
      </main>
      <footer>
        {selected
          ? [selected.name, selected.posture.replace("_", " "), selected.roomId ?? "off the map", selected.task].filter(Boolean).join(" · ")
          : "Click a person to select them."}
        {selected?.kind === "resident" && selected.onMap && selected.posture !== "on_floor" && (
          <span className="inject">
            Inject a fall:
            <button onClick={() => send({ type: "inject_fall", residentId: selected.id, severity: "minor" })}>minor</button>
            <button onClick={() => send({ type: "inject_fall", residentId: selected.id, severity: "serious" })}>serious</button>
          </span>
        )}
        {error && <span className="error"> · {error}</span>}
      </footer>
    </div>
  );
}
