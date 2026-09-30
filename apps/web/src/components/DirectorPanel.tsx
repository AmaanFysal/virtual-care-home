import { useState } from "react";
import { COVER_CHOICES, DISEASES, ILLNESS_KINDS, ROTA_SLOTS, type CoverChoice, type Disease, type FallSeverity, type IllnessKind } from "@vch/shared-types";
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
  const [ill, setIll] = useState("");
  const [kind, setKind] = useState<IllnessKind>("chest_infection");
  const [illSeverity, setIllSeverity] = useState<"mild" | "severe">("mild");
  const [eol, setEol] = useState("");
  const [eolDays, setEolDays] = useState(14);
  const [cardId, setCardId] = useState("");

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
      <div className="trigger">
        <span>Illness</span>
        <select value={ill || resident} onChange={(e) => setIll(e.target.value)} aria-label="Resident who is ill">
          {residents.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.onMap}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={`${kind}/${illSeverity}`} onChange={(e) => {
          const [k, sev] = e.target.value.split("/") as [IllnessKind, "mild" | "severe"];
          setKind(k);
          setIllSeverity(sev);
        }} aria-label="Illness">
          {ILLNESS_KINDS.flatMap((k) => (["mild", "severe"] as const).map((sev) => (
            <option key={`${k}/${sev}`} value={`${k}/${sev}`}>
              {k.replace(/_/g, " ")}, {sev}
            </option>
          )))}
        </select>
        <button onClick={() => send({ type: "inject", input: "resident_illness", params: { residentId: ill || resident, kind, severity: illSeverity } })}>Trigger</button>
      </div>
      {director?.deaths !== false && (
        <div className="trigger">
          <span>End of life</span>
          <select value={eol || resident} onChange={(e) => setEol(e.target.value)} aria-label="Resident">
            {residents.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.onMap}>
                {r.name}
              </option>
            ))}
          </select>
          <select value={eolDays} onChange={(e) => setEolDays(Number(e.target.value))} aria-label="Expected days">
            {[3, 7, 14, 28].map((d) => (
              <option key={d} value={d}>
                about {d} days
              </option>
            ))}
          </select>
          <button onClick={() => send({ type: "inject", input: "end_of_life_start", params: { residentId: eol || resident, expectedDays: eolDays } })}>Start</button>
        </div>
      )}
      {!!director?.admissions?.length && (
        <div className="trigger">
          <span>Admission</span>
          <select value={cardId || director.admissions[0]!.id} onChange={(e) => setCardId(e.target.value)} aria-label="New resident">
            {director.admissions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span />
          <button onClick={() => send({ type: "inject", input: "admission", params: { cardId: cardId || director.admissions![0]!.id } })}>Move in</button>
        </div>
      )}
      <p className="muted small">A sick call hits the person's next shift that hasn't started; a no-show hits the slot's next shift. An infection case is someone brought in ill; it may spread. A mild illness is looked after in their room; a severe one gets the GP, then hospital. A new resident moves into the first empty room. Visitors' weeks and celebrations arrive in a later sub-milestone.</p>
    </section>
  );
}
