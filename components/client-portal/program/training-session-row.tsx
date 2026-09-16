"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import type {
  ClientTrainingExercise,
  ClientTrainingExerciseGroup,
  ClientTrainingSessionEntry,
} from "@/types/client-training-plan";
import { sessionExercises } from "@/utils/exercise-groups";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows } from "@/utils/set-spec-rows";
import {
  exerciseGroupPlace,
  formatRoundReps,
  groupHeading,
  groupHeadingText,
  isLinkedGroup,
} from "@/utils/exercise-group-display";

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

// Where an exercise's rows are a group's rounds, "4 x …" would read as sets:
// its reps read round by round instead ("21-15-9 reps").
function formatRoundsPrescription(ex: ClientTrainingExercise): string {
  const reps = formatRoundReps(
    buildPrescribedRows(
      expandSetSpecs({
        setSpecs: ex.setSpecs,
        sets: ex.sets,
        repsMin: ex.repsMin,
        repsMax: ex.repsMax,
        repsTarget: ex.repsTarget,
        rpeTarget: ex.rpeTarget,
        tempo: ex.tempo,
        restSeconds: ex.restSeconds,
      }),
    ),
  );
  const rpe = ex.rpeTarget != null ? `@ RPE ${ex.rpeTarget}` : null;
  return [reps, rpe].filter(Boolean).join(" ");
}

// A superset or circuit reads its exercises' rests off the group's heading, so
// an exercise in one shows no rest of its own.
function ExerciseItem({
  ex,
  roundsAreRows,
}: {
  ex: ClientTrainingExercise;
  roundsAreRows: boolean;
}) {
  const prescription = roundsAreRows
    ? formatRoundsPrescription(ex)
    : formatPrescription(ex);
  const showRest = !roundsAreRows && ex.restSeconds != null;
  return (
    <li className="space-y-0.5">
      <p className="text-sm font-semibold text-foreground">{ex.name}</p>
      {prescription && (
        <p className="font-mono-display text-xs text-muted-foreground">
          {prescription}
        </p>
      )}
      {(ex.tempo || showRest) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {ex.tempo && (
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono-display text-[11px] text-muted-foreground">
              Tempo {ex.tempo}
            </span>
          )}
          {showRest && (
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono-display text-[11px] text-muted-foreground">
              Rest {ex.restSeconds}s
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// A linked group: its heading, then its exercises beneath it.
function GroupItem({ group }: { group: ClientTrainingExerciseGroup }) {
  const heading = groupHeading(group);
  const { title, rests } = groupHeadingText(heading);
  return (
    <li aria-label={title} className="space-y-2">
      <div className="space-y-0.5">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {rests && <p className="text-xs text-muted-foreground">{rests}</p>}
        {heading.notes && (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {heading.notes}
          </p>
        )}
      </div>
      <ul className="space-y-2 border-l border-border pl-3">
        {group.exercises.map((ex, position) => (
          <ExerciseItem
            key={ex.id}
            ex={ex}
            roundsAreRows={exerciseGroupPlace(group, position).roundsAreRows}
          />
        ))}
      </ul>
    </li>
  );
}

export function TrainingSessionRow({ session }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayName = session.isRest ? "Rest" : session.name;
  // Every exercise of the day in order, group by group.
  const exercises = sessionExercises(session);

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
              {exercises.length} exercise
              {exercises.length === 1 ? "" : "s"}
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
          ) : exercises.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No exercises prescribed yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {session.groups.flatMap((group) =>
                isLinkedGroup(group)
                  ? [<GroupItem key={group.id} group={group} />]
                  : group.exercises.map((ex) => (
                      <ExerciseItem key={ex.id} ex={ex} roundsAreRows={false} />
                    )),
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
