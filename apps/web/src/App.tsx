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
  const showTags = useView((s) => s.showTags);
  return (
    <div className="app">
      <header className="top">
        <h1>Virtual Care Home</h1>
        <ClockBar />
        <label className="toggle" title="Name tags with initials and what each person is doing">
          <input type="checkbox" checked={showTags} onChange={(e) => useView.setState({ showTags: e.target.checked })} />
          Name tags
        </label>
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
      <footer className="credits">
        Art: Liberated Pixel Cup contributors, CC-BY-SA 3.0 and 4.0 (licensed separately from the code).{" "}
        <a href="/CREDITS.txt" target="_blank" rel="noreferrer">
          Credits
        </a>
      </footer>
    </div>
  );
}
