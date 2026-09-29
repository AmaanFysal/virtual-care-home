import { WingCanvas } from "./canvas/WingCanvas";
import { ClockBar } from "./components/ClockBar";
import { EventLog } from "./components/EventLog";
import { Inspector } from "./components/Inspector";
import { useView } from "./store";

const LEGEND = [
  ["staff", "Staff"],
  ["resident", "Resident"],
  ["visitor", "Visitor"],
  ["agency", "Agency"],
  ["external", "Main building"],
] as const;

export function App() {
  const status = useView((s) => s.status);
  const error = useView((s) => s.error);
  return (
    <div className="app">
      <header className="top">
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
        {error && <span className="error">{error}</span>}
      </header>
      <main>
        <WingCanvas />
      </main>
      <aside>
        <Inspector />
        <EventLog />
      </aside>
    </div>
  );
}
