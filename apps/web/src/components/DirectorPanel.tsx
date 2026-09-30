import { useState } from "react";
import { COVER_CHOICES, DISEASES, ROTA_SLOTS, type CoverChoice, type Disease, type FallSeverity } from "@vch/shared-types";
import { send } from "../net";
import { useView } from "../store";

const MODE_LABEL = { off: "Off", random: "Random events from base rates", scenario: "Scripted scenario", both: "Scenario plus random events" } as const;

/**
 * The admin panel (docs/08, docs/10): how this run uses the director, and a trigger for every
 * director event. Triggered events are sent as `inject` commands and applied by the server with
 * source "user"; nothing changes here until the server's events arrive.
 */
export function DirectorPanel() {
  const director = useView((s) => s.director);
  const people = useView((s) => s.people);
  const residents = Object.values(people).filter((p) => p.kind === "resident").sort((a, b) => a.name.localeCompare(b.name));
  const staff = Object.values(people).filter((p) => p.kind === "staff" && p.id.startsWith("stf_")).sort((a, b) => a.name.localeCompare(b.name));

  const [residentId, setResidentId] = useState("");
  const [severity, setSeverity] = useState<FallSeverity>("minor");
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<string>(ROTA_SLOTS[0]);
  const [cover, setCover] = useState<CoverChoice>("auto");
  const [patientId, setPatientId] = useState("");
  const [disease, setDisease] = useState<Disease>("norovirus");

  const resident = residentId || residents[0]?.id || "";
  const worker = staffId || staff[0]?.id || "";
  const patient = patientId || residents[0]?.id || "";
  const coverSelect = (
    <select value={cover} onChange={(e) => setCover(e.target.value as CoverChoice)} aria-label="Cover">
      {COVER_CHOICES.map((c) => (
        <option key={c} value={c}>
          cover: {c}
        </option>
      ))}
    </select>
  );

  return (
    <section className="director">
      <p>
        <strong>Director:</strong> {director ? MODE_LABEL[director.mode] : "…"}
        {director?.scenario && (
          <>
            <br />
            <strong>{director.scenario.name}</strong> <span className="muted">{director.scenario.description}</span>
          </>
        )}
        {director && !director.deaths && (
          <>
            <br />
            <span className="muted">Deaths and end-of-life decline are off.</span>
          </>
        )}
      </p>
      <h3>Trigger now</h3>
      <div className="trigger">
        <span>Fall</span>
        <select value={resident} onChange={(e) => setResidentId(e.target.value)} aria-label="Resident">
          {residents.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.onMap}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as FallSeverity)} aria-label="Severity">
          <option value="minor">minor</option>
          <option value="serious">serious</option>
        </select>
        <button onClick={() => send({ type: "inject", input: "inject_fall", params: { residentId: resident, severity } })}>Trigger</button>
      </div>
      <div className="trigger">
        <span>Sick call</span>
        <select value={worker} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {coverSelect}
        <button onClick={() => send({ type: "inject", input: "staff_sick", params: { staffId: worker, cover } })}>Trigger</button>
      </div>
      <div className="trigger">
        <span>No-show</span>
        <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Rota slot">
          {ROTA_SLOTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {coverSelect}
        <button onClick={() => send({ type: "inject", input: "shift_no_show", params: { slot, cover } })}>Trigger</button>
      </div>
      <div className="trigger">
        <span>Infection</span>
        <select value={patient} onChange={(e) => setPatientId(e.target.value)} aria-label="Who falls ill">
          {[...residents, ...staff].map((p) => (
            <option key={p.id} value={p.id} disabled={p.kind === "resident" && !p.onMap}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={disease} onChange={(e) => setDisease(e.target.value as Disease)} aria-label="Disease">
          {DISEASES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button onClick={() => send({ type: "inject", input: "infection_case", params: { personId: patient, disease } })}>Trigger</button>
      </div>
      <p className="muted small">A sick call hits the person's next shift that hasn't started; a no-show hits the slot's next shift. An infection case is someone brought in ill; it may spread. Illness, hospital and visitors' weeks arrive in later sub-milestones.</p>
    </section>
  );
}
