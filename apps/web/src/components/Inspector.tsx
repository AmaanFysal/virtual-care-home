import { useEffect } from "react";
import { formatSimTime, type NeedName, type PersonActivity, type PersonView, type RoomDetail } from "@vch/shared-types";
import { send } from "../net";
import { select, selectRoom } from "../selection";
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

/** "personal care · 3.0 MET, moderate". */
function activityLine(a: PersonActivity): string {
  return `${a.activity.replace(/_/g, " ")} · ${a.met.toFixed(1)} MET, ${a.intensity}`;
}

/** Outdoor weather in a few words: "13 °C, overcast, light rain". */
export function weatherLine(w: NonNullable<RoomDetail["weather"]>): string {
  const sky = w.cloudPct >= 80 ? "overcast" : w.cloudPct >= 40 ? "cloudy" : w.isDay ? "clear" : "clear night";
  const rain = w.precipMm >= 2.5 ? ", heavy rain" : w.precipMm > 0 ? ", light rain" : "";
  return `${Math.round(w.tempC)} °C, ${sky}${rain}, wind ${w.windMps.toFixed(1)} m/s`;
}

/** A room's slice of the world description (v1.0-testbed), refreshed every second. */
function RoomInspector({ roomId }: { roomId: string }) {
  const room = useView((s) => s.roomDetail);
  const floorplan = useView((s) => s.floorplan);
  const people = useView((s) => s.people);
  useEffect(() => {
    const timer = setInterval(() => send({ type: "inspect_room", roomId }), 1000);
    return () => clearInterval(timer);
  }, [roomId]);
  const name = (id: string) => floorplan?.rooms.find((r) => r.id === id)?.name ?? (id === "Outside" ? "outside" : id);
  if (!room) return <section className="inspector empty">Loading {name(roomId)}...</section>;
  return (
    <section className="inspector room">
      <header>
        <span className="dot room" />
        <div>
          <h2>{room.name}</h2>
          <span className="muted">
            {room.kind} · {room.areaM2} m² · ceiling {room.ceilingM} m
          </span>
        </div>
        <button onClick={() => selectRoom(null)} title="Close">
          ✕
        </button>
      </header>
      <h3>Doors</h3>
      <ul className="building">
        {room.doors.map((d) => (
          <li key={d.doorId}>
            <span className={`state ${d.state}`}>{d.state}</span> to {name(d.rooms.find((r) => r !== roomId)!)}
            {d.heldBy && <span className="muted"> · held by {people[d.heldBy]?.name ?? d.heldBy}</span>}
          </li>
        ))}
      </ul>
      <h3>Windows</h3>
      <ul className="building">
        {room.windows.map((w) => (
          <li key={w.windowId}>
            <span className={`state ${w.state}`}>{w.state}</span> {w.state === "open" ? `${w.openingMm} mm (restrictor)` : ""}
          </li>
        ))}
        {room.windows.length === 0 && <li className="muted">None.</li>}
      </ul>
      <h3>People</h3>
      <ul className="building">
        {room.people.map((p) => (
          <li key={p.personId}>
            <button className="link" onClick={() => select(p.personId)}>
              {p.name}
            </button>{" "}
            <span className="muted">
              {activityLine(p)}
              {p.roomId !== room.roomId && ` (in the ${name(p.roomId!).replace(`${room.name} `, "")})`}
            </span>
          </li>
        ))}
        {room.people.length === 0 && <li className="muted">Nobody.</li>}
      </ul>
      {room.weather && (
        <p className="status">
          Outside: {weatherLine(room.weather)} <span className="muted">({room.weather.time} GMT data)</span>
        </p>
      )}
      <details className="json">
        <summary>World description (JSON)</summary>
        <pre>{JSON.stringify(room, null, 2)}</pre>
      </details>
    </section>
  );
}

/** Details of the selected person or room, refreshed from the server every second. */
export function Inspector() {
  const selectedRoomId = useView((s) => s.selectedRoomId);
  return selectedRoomId ? <RoomInspector roomId={selectedRoomId} /> : <PersonInspector />;
}

function PersonInspector() {
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

  if (!person) return <section className="inspector empty">Click a person on the plan to inspect them, or a room's floor to see its doors, windows and who is there.</section>;
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
        {person.onMap ? `${person.posture.replace("_", " ")} in ${person.roomId ?? "the wing"}` : person.away === "hospital" ? "In hospital" : person.away === "died" ? "Died" : "Not on the wing"}
        {detail?.currentTask && <> · {detail.currentTask}</>}
        {detail?.btNode && <span className="muted"> ({detail.btNode})</span>}
      </p>
      {detail?.activity && (
        <p className="status activity" title={`Compendium of Physical Activities 2024 (${detail.activity.book === "older" ? "Older Adult" : "Adult"}), code ${detail.activity.code}`}>
          {activityLine(detail.activity)}
        </p>
      )}
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
