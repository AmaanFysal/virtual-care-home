import { formatSimTime, type ClockSpeed } from "@vch/shared-types";
import { send } from "../net";
import { useView } from "../store";

const SPEEDS: ClockSpeed[] = [1, 10, 60, 360];

/** Pause, step and speed controls. Buttons reflect the server's clock, not local guesses. */
export function ClockBar() {
  const clock = useView((s) => s.clock);
  const status = useView((s) => s.status);
  if (!clock) return <div className="clock">{status === "open" ? "Waiting for the sim..." : "Connecting to the sim server..."}</div>;
  return (
    <div className="clock">
      <span className="time">{formatSimTime(clock.t)}</span>
      {clock.paused ? (
        <button onClick={() => send({ type: "resume" })} title="Play">
          ▶ Play
        </button>
      ) : (
        <button onClick={() => send({ type: "pause" })} title="Pause">
          ❚❚ Pause
        </button>
      )}
      <button onClick={() => send({ type: "step" })} disabled={!clock.paused} title="Advance one 5-second tick">
        Step
      </button>
      <span className="speeds">
        {SPEEDS.map((speed) => (
          <button key={speed} className={speed === clock.speed ? "active" : ""} onClick={() => send({ type: "set_speed", speed })}>
            {speed}x
          </button>
        ))}
      </span>
      <span className="tick">tick {clock.tick}</span>
    </div>
  );
}
