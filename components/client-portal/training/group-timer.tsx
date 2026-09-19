"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square, Timer } from "lucide-react";

// The simple timers a timed group runs on (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md
// section 4.5): a countdown to an AMRAP's cap, an interval cue for an EMOM, a
// stopwatch for a For time. Local state only — nothing is persisted, and the
// React Native app builds the real ones. A For time's stopwatch can hand its
// time to the finish box; nothing else it shows is recorded.

type ClockProps =
  /** An AMRAP: counts down from its cap and reads "Time" at zero. */
  | { kind: "countdown"; seconds: number }
  /**
   * An EMOM: every interval starts on its 0-second mark, the work is done,
   * and what is left of the interval is rest. A round is one interval
   * (owner, 2026-09-19), so the cue counts "Minute 3 of 8".
   */
  | { kind: "intervals"; intervalSeconds: number; rounds: number }
  /** A For time: elapsed time to a tenth, with the cap beside it when one is set. */
  | { kind: "stopwatch"; capSeconds: number | null; onUseTime: (seconds: number) => void };

const TICK_MS = 100;

/**
 * Elapsed milliseconds since Start, held across Pause. Time comes from the
 * clock, not from counting ticks, so a throttled tab still reads true.
 */
function useElapsed() {
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);
  const banked = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () =>
      setElapsedMs(banked.current + (Date.now() - (startedAt.current ?? Date.now())));
    const id = setInterval(tick, TICK_MS);
    // Unmounting mid-run (collapsing the list, leaving the page) must not leave
    // the interval running against dead state.
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    startedAt.current = Date.now();
    setRunning(true);
  };
  const pause = () => {
    banked.current += Date.now() - (startedAt.current ?? Date.now());
    startedAt.current = null;
    setElapsedMs(banked.current);
    setRunning(false);
  };
  const reset = () => {
    banked.current = 0;
    startedAt.current = null;
    setElapsedMs(0);
    setRunning(false);
  };
  return { running, elapsedMs, start, pause, reset };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "12:00", "0:45" — whole seconds, as a countdown and an interval read. */
function clock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
}

/** "8:32.4" — a stopwatch reads tenths. */
function stopwatch(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}.${tenths % 10}`;
}

const CONTROL_CLASS =
  "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] font-medium text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.06)] hover:text-[#0a766b] disabled:cursor-not-allowed disabled:opacity-40";

export function GroupTimer(props: ClockProps) {
  const { running, elapsedMs, start, pause, reset } = useElapsed();

  const totalMs =
    props.kind === "countdown"
      ? props.seconds * 1000
      : props.kind === "intervals"
        ? props.intervalSeconds * props.rounds * 1000
        : null;
  const done = totalMs !== null && elapsedMs >= totalMs;

  // A countdown and an interval cue stop themselves at the end; a stopwatch
  // runs on past its cap, since the client may still finish.
  useEffect(() => {
    if (running && done) pause();
    // pause is a fresh closure each render; the effect keys on the two facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, done]);

  let readout: string;
  let cue: string | null = null;
  if (props.kind === "countdown") {
    readout = done ? "Time" : clock(props.seconds - elapsedMs / 1000);
  } else if (props.kind === "intervals") {
    const intervalMs = props.intervalSeconds * 1000;
    const index = Math.min(props.rounds - 1, Math.floor(elapsedMs / intervalMs));
    const noun = props.intervalSeconds === 60 ? "Minute" : "Interval";
    cue = `${noun} ${index + 1} of ${props.rounds}`;
    readout = done ? "Done" : clock((intervalMs - (elapsedMs - index * intervalMs)) / 1000);
  } else {
    readout = stopwatch(elapsedMs);
    if (props.capSeconds !== null) {
      cue =
        elapsedMs >= props.capSeconds * 1000
          ? `Past the ${clock(props.capSeconds)} cap`
          : `${clock(props.capSeconds)} cap`;
    }
  }

  const stoppable = props.kind === "stopwatch";
  const useTime =
    props.kind === "stopwatch"
      ? () => props.onUseTime(Math.round(elapsedMs / 100) / 10)
      : null;

  return (
    <div
      data-testid="group-timer"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] bg-[rgba(13,148,136,0.04)] px-3 py-2"
    >
      <Timer className="h-3.5 w-3.5 text-[#93b0b4]" strokeWidth={1.5} />
      <span
        data-testid="group-timer-readout"
        className={`text-[18px] font-mono-display ${running ? "text-[#0d9488]" : "text-[#0c1a1e]"}`}
      >
        {readout}
      </span>
      {cue && (
        <span data-testid="group-timer-cue" className="text-[12px] text-[#5a7d82]">
          {cue}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {running ? (
          <button type="button" onClick={pause} className={CONTROL_CLASS}>
            {stoppable ? <Square className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {stoppable ? "Stop" : "Pause"}
          </button>
        ) : (
          <button type="button" onClick={start} disabled={done} className={CONTROL_CLASS}>
            <Play className="h-3.5 w-3.5" />
            Start
          </button>
        )}
        <button
          type="button"
          onClick={reset}
          disabled={elapsedMs === 0 && !running}
          className={CONTROL_CLASS}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
        {useTime && (
          <button
            type="button"
            onClick={useTime}
            disabled={running || elapsedMs === 0}
            className={CONTROL_CLASS}
          >
            Use this time
          </button>
        )}
      </span>
    </div>
  );
}
