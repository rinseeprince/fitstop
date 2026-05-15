"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import type {
  ClientTrainingExercise,
  ClientTrainingSessionEntry,
} from "@/types/client-training-plan";

type Props = {
  session: ClientTrainingSessionEntry;
};

function formatReps(ex: ClientTrainingExercise): string | null {
  if (ex.repsTarget) return ex.repsTarget;
  if (ex.repsMin != null && ex.repsMax != null) {
    return ex.repsMin === ex.repsMax
      ? String(ex.repsMin)
      : `${ex.repsMin}-${ex.repsMax}`;
  }
  if (ex.repsMin != null) return String(ex.repsMin);
  if (ex.repsMax != null) return String(ex.repsMax);
  return null;
}

function formatPrescription(ex: ClientTrainingExercise): string {
  const reps = formatReps(ex);
  const setsReps = reps ? `${ex.sets} x ${reps}` : `${ex.sets} sets`;
  return ex.rpeTarget != null ? `${setsReps} @ RPE ${ex.rpeTarget}` : setsReps;
}

export function TrainingSessionRow({ session }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayName = session.isRest ? "Rest" : session.name;

  const containerClass = [
    "rounded-md border border-border bg-card",
    session.isRest ? "opacity-70" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <span className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </span>
        </div>
        {!session.isRest && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {session.focus && <span>{session.focus}</span>}
            {session.estimatedDurationMinutes != null && (
              <span className="font-mono-display">
                {session.estimatedDurationMinutes} min
              </span>
            )}
            <span className="font-mono-display">
              {session.exercises.length} exercise
              {session.exercises.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 pb-3 pt-3">
          {session.isRest ? (
            <p className="text-sm italic text-muted-foreground">
              Rest day - no training prescribed.
            </p>
          ) : session.exercises.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No exercises prescribed yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {session.exercises.map((ex) => (
                <li key={ex.id} className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">
                    {ex.name}
                  </p>
                  <p className="font-mono-display text-xs text-muted-foreground">
                    {formatPrescription(ex)}
                  </p>
                  {(ex.tempo || ex.restSeconds != null) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {ex.tempo && (
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono-display text-[11px] text-muted-foreground">
                          Tempo {ex.tempo}
                        </span>
                      )}
                      {ex.restSeconds != null && (
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono-display text-[11px] text-muted-foreground">
                          Rest {ex.restSeconds}s
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
