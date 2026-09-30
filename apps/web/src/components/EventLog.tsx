import { useMemo, useState } from "react";
import { formatSimTime, type AnySimEvent } from "@vch/shared-types";
import { select } from "../selection";
import { useView } from "../store";

type Category = "all" | "care" | "meds" | "falls" | "health" | "staff" | "visitors" | "director" | "alerts" | "movement";
type SourceFilter = "any" | "engine" | "director" | "user";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "care", label: "Care" },
  { id: "meds", label: "Meds" },
  { id: "falls", label: "Falls" },
  { id: "health", label: "Health" },
  { id: "staff", label: "Staff" },
  { id: "visitors", label: "Visitors" },
  { id: "director", label: "Director" },
  { id: "alerts", label: "Alerts" },
  { id: "movement", label: "Movement" },
];

/** The category an event is coloured by (from its type). */
export function categoryOf(type: string): Exclude<Category, "all"> {
  if (type.startsWith("invariant.") || type.startsWith("sla.")) return "alerts";
  if (type.startsWith("director.") || type === "input.skipped") return "director";
  if (type.startsWith("med")) return "meds";
  if (/^(ambulance|paramedics|resident\.conveyed|illness|infection|outbreak|hospital|end_of_life|resident\.died|resident\.returned|admission)/.test(type)) return "health";
  if (/^(resident\.fell|fall\.|cqc|incident|family|on_call_rn|main_carer)/.test(type)) return "falls";
  if (/^(shift|break|handover|rn\.|agency|second_carer|sim\.|staff\.|rota\.)/.test(type)) return "staff";
  if (/^(visit|celebration)/.test(type)) return "visitors";
  if (/^person\./.test(type)) return "movement";
  return "care";
}

/** Whether an event belongs under a category filter: "Director" is everything the director did or planned. */
export function inCategory(e: AnySimEvent, category: Category): boolean {
  const cat = categoryOf(e.type);
  if (category === "all") return cat !== "movement";
  if (category === "director") return cat === "director" || e.source === "director";
  return cat === category;
}

/** One-line human description of an event. */
export function describeEvent(e: AnySimEvent): string {
  const p = e.payload as Record<string, unknown>;
  const bits = Object.entries(p)
    .filter(([k, v]) => !["taskId", "staffId", "staffIds", "residentId", "visitorId", "summary", "personId"].includes(k) && v !== null && v !== "")
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") : String(v)}`);
  return `${e.type}${bits.length ? ": " + bits.join(", ") : ""}`;
}

/** Filterable event log; click a person to select them. */
export function EventLog() {
  const events = useView((s) => s.events);
  const people = useView((s) => s.people);
  const selectedId = useView((s) => s.selectedId);
  const [category, setCategory] = useState<Category>("all");
  const [source, setSource] = useState<SourceFilter>("any");
  const [text, setText] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return events
      .filter((e) => {
        if (!inCategory(e, category)) return false;
        if (source !== "any" && e.source !== source) return false;
        if (onlySelected && selectedId && !e.actors.includes(selectedId)) return false;
        if (needle && !describeEvent(e).toLowerCase().includes(needle) && !e.actors.some((a) => (people[a]?.name ?? a).toLowerCase().includes(needle))) return false;
        return true;
      })
      .slice(-200)
      .reverse();
  }, [events, category, source, text, onlySelected, selectedId, people]);

  return (
    <section className="eventlog">
      <div className="filters">
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="Source">
          <option value="any">Any source</option>
          <option value="engine">Engine</option>
          <option value="director">Director</option>
          <option value="user">User</option>
        </select>
        <input type="search" placeholder="Search" value={text} onChange={(e) => setText(e.target.value)} />
        <label title="Only events involving the selected person">
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} disabled={!selectedId} /> selected
        </label>
      </div>
      <ol className="rows">
        {rows.map((e) => (
          <li key={e.id} className={`cat-${categoryOf(e.type)} src-${e.source}`}>
            <time>{formatSimTime(e.t).slice(11)}</time>
            <span className="actors">
              {e.actors.map((a) => (
                <button key={a} className={`chip ${people[a]?.kind ?? ""}`} onClick={() => select(a)} title={people[a]?.name ?? a}>
                  {people[a]?.initials ?? a.replace(/^[a-z]+_/, "")}
                </button>
              ))}
            </span>
            <span className="what">{describeEvent(e)}</span>
            {e.source !== "engine" && <span className="source">{e.source}</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No events match.</li>}
      </ol>
    </section>
  );
}
