import { SetRow } from "./set-row";

export type PrescribedExerciseView = {
  id: string;
  name: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  repsTarget?: string;
  rpeTarget?: number;
  restSeconds?: number;
  notes?: string;
  isWarmup: boolean;
};

type ExerciseTrackerBlockProps = {
  exercise: PrescribedExerciseView;
  index: number;
};

export function ExerciseTrackerBlock({
  exercise,
  index: _index,
}: ExerciseTrackerBlockProps) {
  const repsHint = formatRepsHint(exercise);
  const rpeHint = exercise.rpeTarget != null ? String(exercise.rpeTarget) : undefined;
  const summary = formatSummary(exercise, repsHint);

  return (
    <div
      data-testid="exercise-tracker-block"
      className="rounded-[6px] bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-[#0c1a1e]">
              {exercise.name}
            </h3>
            {exercise.isWarmup && (
              <span className="rounded-[6px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">
                Warm-up
              </span>
            )}
          </div>
          {summary && (
            <p className="mt-1 text-[12px] text-[#5a7d82]">{summary}</p>
          )}
        </div>
      </div>

      {exercise.notes && (
        <p className="mt-3 text-[12px] text-[#5a7d82]">{exercise.notes}</p>
      )}

      {exercise.sets <= 0 ? (
        <p className="mt-3 text-[12px] text-[#93b0b4]">No sets prescribed</p>
      ) : (
        <div className="mt-3">
          <div className="grid grid-cols-12 gap-2 px-3 pb-1 text-[10px] uppercase tracking-[0.06em] text-[#93b0b4]">
            <div className="col-span-2 text-center">Set</div>
            <div className="col-span-4 text-center">Weight</div>
            <div className="col-span-3 text-center">Reps</div>
            <div className="col-span-3 text-center">RPE</div>
          </div>
          <div className="space-y-1">
            {Array.from({ length: exercise.sets }, (_, i) => (
              <SetRow
                key={i}
                setNumber={i + 1}
                repsPlaceholder={repsHint}
                rpePlaceholder={rpeHint}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRepsHint(e: PrescribedExerciseView): string | undefined {
  if (e.repsTarget) return e.repsTarget;
  if (e.repsMin != null && e.repsMax != null) return `${e.repsMin}-${e.repsMax}`;
  if (e.repsMin != null) return `${e.repsMin}+`;
  return undefined;
}

function formatSummary(
  e: PrescribedExerciseView,
  repsHint: string | undefined,
): string {
  const parts: string[] = [];
  if (e.sets > 0) {
    parts.push(repsHint ? `${e.sets} × ${repsHint}` : `${e.sets} sets`);
  }
  if (e.rpeTarget != null) parts.push(`@ RPE ${e.rpeTarget}`);
  if (e.restSeconds != null) parts.push(formatRest(e.restSeconds));
  return parts.join(" · ");
}

function formatRest(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m}m ${s}s rest` : `${m}m rest`;
  }
  return `${seconds}s rest`;
}
