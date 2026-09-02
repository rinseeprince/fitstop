"use client";

import { useState, useMemo } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import Link from "next/link";
import { LineChart, Plus, Repeat, Trash2, Video, X } from "lucide-react";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PrescribedSetGrid } from "./prescribed-set-grid";
import { ExerciseSearchInput } from "./exercise-search-input";
import {
  emptySet,
  prescribedRowsForView,
  type LogFormValues,
} from "./log-form-types";
import type { PrescribedRow } from "@/utils/set-spec-rows";
import {
  resolvePrescribedFields,
  type PrescribedField,
} from "@/utils/prescribed-fields";

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
  // Per-set prescription (seeds the log form's set rows) + optional demo video.
  setSpecs?: SetSpec[];
  videoUrl?: string;
  // Which prescription columns the coach uses (migration 149). Absent/null =
  // all of them, which is every exercise authored before the picker existed.
  prescribedFields?: string[] | null;
};

// Small coach-demo video link, shown wherever a prescription is surfaced.
function PrescriptionVideoLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#0d9488] hover:underline"
    >
      <Video className="h-3.5 w-3.5" strokeWidth={1.5} />
      Watch demo
    </a>
  );
}

export type ExerciseFormContext = {
  control: Control<LogFormValues>;
  register: UseFormRegister<LogFormValues>;
  setValue: UseFormSetValue<LogFormValues>;
  getValues: UseFormGetValues<LogFormValues>;
  isUnplanned?: boolean;
  onRemove?: () => void;
};

type ExerciseTrackerBlockProps = {
  exercise: PrescribedExerciseView;
  index: number;
  formContext?: ExerciseFormContext;
};

export function ExerciseTrackerBlock({
  exercise,
  index,
  formContext,
}: ExerciseTrackerBlockProps) {
  // The prescription, per set. This used to collapse to ONE exercise-level reps
  // hint reused on every row, which is why a session prescribed 15-20 / 10-12 /
  // 8-10 rendered as "8-12" three times.
  const prescribedRows = useMemo(
    () => prescribedRowsForView(exercise),
    [exercise],
  );
  const fields = resolvePrescribedFields(exercise.prescribedFields);
  const summary = formatSummary(exercise, formatRepsHint(exercise));

  if (!formContext) {
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
              {exercise.isWarmup && <WarmupBadge />}
            </div>
            {summary && (
              <p className="mt-1 text-[12px] text-[#5a7d82]">{summary}</p>
            )}
            <PrescriptionVideoLink url={exercise.videoUrl} />
          </div>
        </div>

        {exercise.notes && (
          <p className="mt-3 text-[12px] text-[#5a7d82]">{exercise.notes}</p>
        )}

        {prescribedRows.length === 0 ? (
          <p className="mt-3 text-[12px] text-[#93b0b4]">No sets prescribed</p>
        ) : (
          <div className="mt-3">
            <PrescribedSetGrid
              rows={prescribedRows}
              fields={fields}
              fieldIds={null}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <FormModeBlock
      exercise={exercise}
      index={index}
      formContext={formContext}
      prescribedRows={prescribedRows}
      fields={fields}
      summary={summary}
    />
  );
}

function FormModeBlock({
  exercise,
  index,
  formContext,
  prescribedRows,
  fields,
  summary,
}: {
  exercise: PrescribedExerciseView;
  index: number;
  formContext: ExerciseFormContext;
  prescribedRows: PrescribedRow[];
  fields: ReadonlySet<PrescribedField>;
  summary: string;
}) {
  const {
    control,
    register,
    setValue,
    getValues,
    isUnplanned,
    onRemove,
  } = formContext;

  const {
    fields: setFields,
    append,
    remove,
  } = useFieldArray({
    control,
    name: `exercises.${index}.sets`,
  });

  const initialNotes = getValues(`exercises.${index}.notes`) ?? "";
  const [notesOpen, setNotesOpen] = useState(initialNotes.trim().length > 0);
  const [swapping, setSwapping] = useState(false);

  const liveName =
    useWatch({ control, name: `exercises.${index}.exerciseName` }) ??
    exercise.name;
  const isSwapped =
    useWatch({ control, name: `exercises.${index}.isSwapped` }) ?? false;
  const prescribedName = getValues(`exercises.${index}.prescribedName`);

  const applySwap = (next: { name: string; exerciseId: string | undefined }) => {
    setValue(`exercises.${index}.exerciseName`, next.name, { shouldDirty: true });
    setValue(`exercises.${index}.exerciseId`, next.exerciseId, {
      shouldDirty: true,
    });
    if (next.name.trim()) {
      setValue(`exercises.${index}.isSwapped`, true, { shouldDirty: true });
    }
    // Close the picker only when the user actually picks a catalog item.
    // Free typing keeps the picker open so they can keep searching/select.
    if (next.exerciseId !== undefined) {
      setSwapping(false);
    }
  };

  const resetSwap = () => {
    if (!prescribedName) return;
    setValue(`exercises.${index}.exerciseName`, prescribedName, {
      shouldDirty: true,
    });
    setValue(`exercises.${index}.exerciseId`, undefined, { shouldDirty: true });
    setValue(`exercises.${index}.isSwapped`, false, { shouldDirty: true });
    setSwapping(false);
  };

  const watchedSets =
    useWatch({ control, name: `exercises.${index}.sets` }) ?? [];

  const setCompleted = (row: number, next: boolean) => {
    setValue(`exercises.${index}.sets.${row}.completed`, next, {
      shouldDirty: true,
    });
  };

  const isCompleted = (row: number): boolean =>
    watchedSets[row]?.completed === true;

  const handleCopyPrevious = (rowIndex: number) => {
    const sets = getValues(`exercises.${index}.sets`);
    for (let m = rowIndex - 1; m >= 0; m--) {
      const s = sets[m];
      if (!s) continue;
      if (s.reps.trim() || s.weight.trim() || s.rpe.trim()) {
        setValue(`exercises.${index}.sets.${rowIndex}.reps`, s.reps, {
          shouldDirty: true,
        });
        setValue(`exercises.${index}.sets.${rowIndex}.weight`, s.weight, {
          shouldDirty: true,
        });
        setValue(`exercises.${index}.sets.${rowIndex}.rpe`, s.rpe, {
          shouldDirty: true,
        });
        // Copying IS entering a value — it fills the row without ever firing a
        // blur, so without this the commonest gesture in the form leaves rows
        // full of numbers and unticked, which is precisely what the auto-tick
        // exists to prevent.
        setCompleted(rowIndex, true);
        return;
      }
    }
  };

  // Auto-tick (locked decision 2): entering a value and moving on banks that
  // set, so a client recording numbers never touches a tick. Only ever ticks —
  // clearing a field does NOT untick, because a banked set with empty fields is
  // a legitimate record (decision 3).
  const handleRowBlur = (row: number) => {
    const s = getValues(`exercises.${index}.sets.${row}`);
    if (!s || s.completed) return;
    if (s.reps.trim() || s.weight.trim() || s.rpe.trim()) {
      setCompleted(row, true);
    }
  };

  const completedCount = watchedSets.filter((s) => s?.completed === true).length;
  const allCompleted = setFields.length > 0 && completedCount === setFields.length;

  const bankEveryRow = (next: boolean) => {
    for (let row = 0; row < setFields.length; row++) setCompleted(row, next);
  };

  function isSetFilled(row: number): boolean {
    const s = watchedSets[row];
    if (!s) return false;
    return Boolean(s.reps?.trim() || s.weight?.trim() || s.rpe?.trim());
  }

  function canCopyAt(row: number): boolean {
    for (let m = row - 1; m >= 0; m--) {
      if (isSetFilled(m)) return true;
    }
    return false;
  }

  return (
    <div
      data-testid="exercise-tracker-block"
      className="rounded-[6px] bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-[#0c1a1e]">
              {liveName}
            </h3>
            {exercise.isWarmup && <WarmupBadge />}
            {isUnplanned && <UnplannedBadge />}
          </div>
          {summary && (
            <p className="mt-1 text-[12px] text-[#5a7d82]">{summary}</p>
          )}
          {!isUnplanned && isSwapped && prescribedName && !swapping && (
            <p className="mt-1 text-[11px] text-[#5a7d82]">
              Swapped from {prescribedName}
              <button
                type="button"
                onClick={resetSwap}
                data-testid={`swap-reset-${index}`}
                className="ml-2 font-medium text-[#0d9488] transition-colors hover:text-[#0a766b]"
              >
                Reset
              </button>
            </p>
          )}
          {!isUnplanned && !swapping && !isSwapped && (
            <button
              type="button"
              onClick={() => setSwapping(true)}
              data-testid={`swap-${index}`}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#5a7d82] transition-colors hover:text-[#0d9488] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Repeat className="h-3 w-3" />
              Swap
            </button>
          )}
          {!isUnplanned && swapping && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                <ExerciseSearchInput
                  value={liveName}
                  onChange={applySwap}
                  placeholder="Search a replacement exercise..."
                  ariaLabel={`Swap ${prescribedName ?? exercise.name}`}
                  testId={`swap-picker-${index}`}
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => setSwapping(false)}
                data-testid={`swap-cancel-${index}`}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#5a7d82] transition-colors hover:bg-[rgba(13,148,136,0.06)] hover:text-[#0d9488]"
                aria-label="Cancel swap"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Link
            href={`/client/metrics?tab=performance&exerciseName=${encodeURIComponent(liveName)}`}
            prefetch={false}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#5a7d82] transition-colors hover:text-[#0d9488]"
          >
            <LineChart className="h-3 w-3" />
            View history
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Banks every set of this exercise in one tap. Indeterminate while
              only some are ticked, so it reports the exercise's state as well as
              acting on it. */}
          <label className="flex items-center gap-2 whitespace-nowrap text-[12px] text-[#5a7d82]">
            <span>Done</span>
            <Checkbox
              checked={
                allCompleted
                  ? true
                  : completedCount > 0
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={() => bankEveryRow(!allCompleted)}
              aria-label={`Mark every set of ${exercise.name} complete`}
              data-testid={`complete-exercise-${index}`}
              className="size-5 border-[#93b0b4] data-[state=checked]:border-[#0d9488] data-[state=checked]:bg-[#0d9488] data-[state=indeterminate]:border-[#0d9488] data-[state=indeterminate]:bg-[rgba(13,148,136,0.25)]"
            />
          </label>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Delete ${exercise.name}`}
              data-testid={`delete-exercise-${index}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[#5a7d82] transition-colors hover:bg-[rgba(220,38,38,0.06)] hover:text-[#dc2626]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {exercise.notes && (
        <p className="mt-3 text-[12px] text-[#5a7d82]">{exercise.notes}</p>
      )}

      <div className="mt-3">
        <PrescribedSetGrid
          rows={prescribedRows}
          fields={fields}
          fieldIds={setFields.map((f) => f.id)}
          register={register}
          exerciseIndex={index}
          isCompleted={isCompleted}
          onToggleComplete={(row) => setCompleted(row, !isCompleted(row))}
          onRowBlur={handleRowBlur}
          onRemove={remove}
          // Only rows the client appended PAST the prescription. Removing a
          // prescribed row shifts every later row down and stamps it from the
          // wrong spec — delete the warm-up and a working set is stored as
          // `warmup`, excluded from volume, PRs and compliance. An unticked row
          // already says "not done", so there is nothing left for deletion to
          // express (locked decision 7's reasoning, applied to rows).
          canRemove={(row) => row >= prescribedRows.length}
          onCopyPrevious={handleCopyPrevious}
          canCopyPrevious={canCopyAt}
        />
        <button
          type="button"
          onClick={() => append(emptySet())}
          data-testid={`add-set-${index}`}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#0d9488] transition-colors hover:text-[#0a766b] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add set
        </button>
      </div>

      <div className="mt-3">
        {notesOpen ? (
          <div className="space-y-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNotesOpen(false)}
              data-testid={`exercise-notes-hide-${index}`}
              className="h-auto justify-start px-0 text-[12px] font-medium text-[#5a7d82] hover:bg-transparent hover:text-[#0d9488]"
            >
              <X className="h-3.5 w-3.5" />
              Hide notes
            </Button>
            <Textarea
              {...register(`exercises.${index}.notes`)}
              placeholder="Notes for this exercise (optional)"
              rows={2}
              aria-label={`Notes for ${exercise.name}`}
              data-testid={`exercise-notes-${index}`}
              className="text-[13px]"
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNotesOpen(true)}
            data-testid={`exercise-notes-toggle-${index}`}
            className="h-auto justify-start px-0 text-[12px] font-medium text-[#5a7d82] hover:bg-transparent hover:text-[#0d9488]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add notes
          </Button>
        )}
      </div>
    </div>
  );
}

function WarmupBadge() {
  return (
    <span className="rounded-[6px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">
      Warm-up
    </span>
  );
}

function UnplannedBadge() {
  return (
    <span className="rounded-[6px] bg-[rgba(245,158,11,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#b07520]">
      Unplanned
    </span>
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
