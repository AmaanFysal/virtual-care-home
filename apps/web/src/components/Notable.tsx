import { useMemo } from "react";
import { formatSimTime, type AnySimEvent, type PersonView } from "@vch/shared-types";
import { select } from "../selection";
import { useView } from "../store";

/**
 * The few things that matter (docs/08, docs/10): falls, sick calls and cover, hospital, anything
 * the director or a user triggered, missed service targets and hard violations. The director's
 * plans for later in the day stay out of it, so the feed never gives away what's coming.
 */
export function notableText(e: AnySimEvent, people: Record<string, PersonView>): string | null {
  const first = (id: string) => (people[id]?.name ?? id).split(" ")[0];
  switch (e.type) {
    case "resident.fell":
      return `${first(e.payload.residentId)} fell (${e.payload.severity})`;
    case "ambulance.called":
      return `999 called for ${first(e.payload.residentId)}`;
    case "resident.conveyed_to_hospital":
      return `${first(e.payload.residentId)} taken to hospital`;
    case "resident.returned_from_hospital":
      return `${first(e.payload.residentId)} back from hospital after ${e.payload.daysAway} days`;
    case "staff.absent":
      return `${e.payload.name.split(" ")[0]} ${e.payload.reason === "sick" ? "off sick" : e.payload.reason === "went_home_sick" ? "went home ill" : "didn't turn up"} (${e.payload.slot}, ${formatSimTime(e.payload.shiftStartT).slice(-5)})`;
    case "rota.cover_booked":
      return e.payload.cover === "stay_on"
        ? `${first(e.payload.staffId)} stays on until cover arrives at ${formatSimTime(e.payload.untilT ?? e.payload.arriveT).slice(-5)}`
        : `Cover: ${e.payload.cover} ${people[e.payload.staffId]?.name ?? "worker"}, from ${formatSimTime(e.payload.arriveT).slice(-5)}`;
    case "rota.no_cover":
      return `No cover: ${e.payload.slot} runs short (${e.payload.reason})`;
    case "med_round.no_giver":
      return `${e.payload.round} medication round missed: nobody meds-trained on the wing`;
    case "infection.symptomatic":
      return `${first(e.payload.personId)} ill with ${e.payload.disease}${e.payload.personId.startsWith("res_") ? ", isolated in their room" : ""}`;
    case "outbreak.declared":
      return `${e.payload.disease} outbreak declared (${e.payload.cases.map(first).join(", ")}): Lounge closed, essential visits only`;
    case "outbreak.over":
      return `${e.payload.disease} outbreak over after ${e.payload.days} days (${e.payload.cases.length} cases)`;
    case "input.skipped":
      return `${e.payload.inputType.replace(/_/g, " ")} not applied: ${e.payload.reason}`;
    case "sla.breached":
      return `Missed ${e.payload.target.replace(/_/g, " ")}: ${e.payload.details} [${e.payload.cause}]`;
    case "invariant.violated":
      return `SAFETY RULE BROKEN: ${e.payload.rule} (${e.payload.details})`;
    default:
      return null;
  }
}

const NOTABLE_MAX = 40;

export function Notable() {
  const events = useView((s) => s.events);
  const people = useView((s) => s.people);
  const rows = useMemo(
    () =>
      events
        .map((e) => ({ e, text: notableText(e, people) }))
        .filter((r): r is { e: AnySimEvent; text: string } => r.text !== null)
        .slice(-NOTABLE_MAX)
        .reverse(),
    [events, people],
  );
  return (
    <section className="notable">
      <h3>Notable</h3>
      <ol>
        {rows.map(({ e, text }) => (
          <li key={e.id} className={`n-${e.type.split(".")[0]} src-${e.source}`}>
            <time>{formatSimTime(e.t).slice(4, 16)}</time>
            <button className="link" onClick={() => e.actors[0] && select(e.actors[0])} disabled={!e.actors[0]}>
              {text}
            </button>
            {e.source !== "engine" && <span className="source">{e.source}</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="muted">Nothing notable yet.</li>}
      </ol>
    </section>
  );
}
