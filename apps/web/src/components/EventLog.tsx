import { useMemo, useState } from "react";
import { formatSimTime, type AnySimEvent } from "@vch/shared-types";
import { select } from "../selection";
import { useView } from "../store";

type Category = "all" | "care" | "meds" | "falls" | "staff" | "visitors" | "alerts" | "movement";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "care", label: "Care" },
  { id: "meds", label: "Meds" },
  { id: "falls", label: "Falls" },
  { id: "staff", label: "Staff" },
  { id: "visitors", label: "Visitors" },
  { id: "alerts", label: "Alerts" },
  { id: "movement", label: "Movement" },
];

export function categoryOf(type: string): Exclude<Category, "all"> {
  if (type.startsWith("invariant.") || type.startsWith("sla.")) return "alerts";
  if (type.startsWith("med")) return "meds";
  if (/^(resident\.fell|fall\.|ambulance|paramedics|resident\.conveyed|cqc|incident|family|on_call_rn)/.test(type)) return "falls";
  if (/^(shift|break|handover|rn\.|agency|second_carer|sim\.)/.test(type)) return "staff";
  if (/^visit/.test(type)) return "visitors";
  if (/^person\./.test(type)) return "movement";
  return "care";
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
  const [text, setText] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return events
      .filter((e) => {
        const cat = categoryOf(e.type);
        if (category === "all" ? cat === "movement" : cat !== category) return false;
        if (onlySelected && selectedId && !e.actors.includes(selectedId)) return false;
        if (needle && !describeEvent(e).toLowerCase().includes(needle) && !e.actors.some((a) => (people[a]?.name ?? a).toLowerCase().includes(needle))) return false;
        return true;
      })
      .slice(-200)
      .reverse();
  }, [events, category, text, onlySelected, selectedId, people]);

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
