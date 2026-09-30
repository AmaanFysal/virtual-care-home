import { useEffect } from "react";
import { formatSimTime, type NeedName, type PersonView } from "@vch/shared-types";
import { send } from "../net";
import { select } from "../selection";
import { useView } from "../store";
import { describeEvent } from "./EventLog";

const NEEDS: NeedName[] = ["hunger", "thirst", "toileting", "fatigue", "social"];
const KIND_LABEL: Record<PersonView["kind"], string> = { resident: "Resident", staff: "Staff", visitor: "Visitor", agency: "Agency", external: "From the main building" };

function Bar({ label, value }: { label: string; value: number }) {
  const level = value >= 0.75 ? "high" : value >= 0.5 ? "mid" : "low";
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${level}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="bar-value">{value.toFixed(2)}</span>
    </div>
  );
}

/** Age on the sim's start date, 3 November 2026 (close enough for a sim week). */
function ageOn(dob: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  return 2026 - y! - (m! > 11 || (m === 11 && d! > 3) ? 1 : 0);
}

/** Key facts from the persona card, by kind of person. */
function Persona({ persona }: { persona: Record<string, unknown> }) {
  const facts: [string, string][] = [];
  const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  if (persona.dob) {
    const care = persona.care as Record<string, unknown>;
    const mobility = persona.mobility as Record<string, unknown>;
    facts.push(["Age", String(ageOn(String(persona.dob)))]);
    facts.push(["Conditions", str(persona.conditions)]);
    facts.push(["Mobility", `${mobility.aid}, ${mobility.falls_risk} falls risk`]);
    facts.push(["Personal care", `${care.personal_care_staff} staff${care.female_carers_only ? ", women only" : ""}`]);
    facts.push(["Checks", `every ${(care.check_interval_mins as { day: number }).day} min by day, ${(care.check_interval_mins as { night: number }).night} at night`]);
    facts.push(["Likes", str((persona.preferences as string[]).slice(0, 3))]);
  } else if (persona.role) {
    facts.push(["Role", str(persona.role).replace(/_/g, " ")]);
    facts.push(["Competencies", str(persona.competencies).replace(/_/g, " ")]);
    facts.push(["Style", str(persona.care_style)]);
  } else if (persona.relation_to_resident) {
    const rel = (persona.relation_to_resident as { resident: string; type: string }[])[0]!;
    const pattern = persona.visit_pattern as Record<string, unknown>;
    facts.push(["Visits", `${rel.resident.replace("res_", "")} (${rel.type})`]);
    facts.push(["Pattern", `${str(pattern.days)}, ${pattern.time_window}`]);
    facts.push(["Brings", str((persona.visit_behaviours as string[]).slice(0, 2))]);
  } else if (persona.note) {
    facts.push(["", str(persona.note)]);
  }
  return (
    <dl className="facts">
      {facts.map(([k, v]) => (
        <div key={k + v}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Details of the selected person, refreshed from the server every second. */
export function Inspector() {
  const selectedId = useView((s) => s.selectedId);
  const person = useView((s) => (s.selectedId ? s.people[s.selectedId] : undefined));
  const detail = useView((s) => s.detail);
  const following = useView((s) => s.following);
  const events = useView((s) => s.events);
  const clock = useView((s) => s.clock);

  useEffect(() => {
    if (!selectedId) return;
    const timer = setInterval(() => send({ type: "inspect", personId: selectedId }), 1000);
    return () => clearInterval(timer);
  }, [selectedId]);

  if (!person) return <section className="inspector empty">Click a person on the plan to inspect them.</section>;
  const recent = events.filter((e) => e.actors.includes(person.id)).slice(-10).reverse();
  return (
    <section className="inspector">
      <header>
        <span className={`dot ${person.kind}`} />
        <div>
          <h2>{person.name}</h2>
          <span className="muted">{KIND_LABEL[person.kind]}</span>
        </div>
        <button className={following ? "active" : ""} onClick={() => useView.setState({ following: !following })} title="Keep the camera on this person">
          {following ? "Following" : "Follow"}
        </button>
        <button onClick={() => select(null)} title="Close">
          ✕
        </button>
      </header>
      <p className="status">
        {person.onMap ? `${person.posture.replace("_", " ")} in ${person.roomId ?? "the wing"}` : person.away === "hospital" ? "In hospital" : "Not on the wing"}
        {detail?.currentTask && <> · {detail.currentTask}</>}
        {detail?.btNode && <span className="muted"> ({detail.btNode})</span>}
      </p>
      {person.infection && (
        <p className="infection">
          {person.infection.disease === "flu" ? "Flu" : "Norovirus"}: {person.infection.status}
          {person.infection.isolated && (person.kind === "resident" ? ", isolated in their room" : ", off work")}
        </p>
      )}
      {detail?.needs && (
        <div className="bars">
          {NEEDS.map((n) => (
            <Bar key={n} label={n} value={detail.needs![n] ?? 0} />
          ))}
        </div>
      )}
      {detail?.workload !== null && detail?.workload !== undefined && (
        <div className="bars">
          <Bar label="workload" value={detail.workload} />
        </div>
      )}
      {detail && <Persona persona={detail.persona as Record<string, unknown>} />}
      {detail && detail.schedule.length > 0 && (
        <>
          <h3>Schedule</h3>
          <ul className="schedule">
            {detail.schedule.map((s) => (
              <li key={s.t + s.label} className={clock && s.t < clock.t ? "past" : ""}>
                <time>{formatSimTime(s.t).slice(11)}</time> {s.label}
              </li>
            ))}
          </ul>
        </>
      )}
      {person.kind === "resident" && person.onMap && person.posture !== "on_floor" && (
        <p className="inject">
          Inject a fall:
          <button onClick={() => send({ type: "inject_fall", residentId: person.id, severity: "minor" })}>minor</button>
          <button onClick={() => send({ type: "inject_fall", residentId: person.id, severity: "serious" })}>serious</button>
        </p>
      )}
      <h3>Recent</h3>
      <ul className="recent">
        {recent.map((e) => (
          <li key={e.id}>
            <time>{formatSimTime(e.t).slice(11)}</time> {describeEvent(e)}
          </li>
        ))}
        {recent.length === 0 && <li className="muted">Nothing yet.</li>}
      </ul>
    </section>
  );
}
