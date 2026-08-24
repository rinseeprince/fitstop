"use client";

import { useState } from "react";
import { CheckCheck, Loader2, Plus, X } from "lucide-react";
import {
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import type { SessionCompletionQuality } from "@/types/check-in";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveLogOutcome,
  type LogFormValues,
  type PrescribedRowsByIndex,
} from "./log-form-types";

// The commit surface: session notes, the one-tap bank, what will be recorded,
// and the single primary action.
//
// It replaces the quick-log card, whose complete/partial/skipped buttons asked
// the client to claim an outcome the ticks now answer. What survives from it is
// the session notes field, unchanged.
type CompleteWorkoutFooterProps = {
  control: Control<LogFormValues>;
  register: UseFormRegister<LogFormValues>;
  setValue: UseFormSetValue<LogFormValues>;
  getValues: UseFormGetValues<LogFormValues>;
  /** Index-aligned with the form's exercises. See PrescribedRowsByIndex. */
  prescribedRows: PrescribedRowsByIndex;
  editable: boolean;
  isSubmitting: boolean;
};

// Named for the client, not the column. `full` is "complete" in every other
// sentence they read.
const OUTCOME_LABEL: Record<SessionCompletionQuality, string> = {
  full: "complete",
  partial: "partial",
  skipped: "skipped",
};

export function CompleteWorkoutFooter({
  control,
  register,
  setValue,
  getValues,
  prescribedRows,
  editable,
  isSubmitting,
}: CompleteWorkoutFooterProps) {
  const initialNotes = getValues("notes") ?? "";
  const [notesOpen, setNotesOpen] = useState(initialNotes.trim().length > 0);

  // Subscribed here rather than in the form so a keystroke re-renders this block
  // alone. The outcome has to be live: it is what the client is agreeing to.
  const exercises = useWatch({ control, name: "exercises" }) ?? [];
  const outcome = resolveLogOutcome(exercises, prescribedRows);

  const markAllComplete = () => {
    getValues("exercises").forEach((exercise, exerciseIndex) => {
      exercise.sets.forEach((_set, setIndex) => {
        setValue(
          `exercises.${exerciseIndex}.sets.${setIndex}.completed`,
          true,
          { shouldDirty: true },
        );
      });
    });
  };

  const label = OUTCOME_LABEL[outcome.quality];
  const sentence =
    outcome.prescribedWorkingSets === 0
      ? `No working sets prescribed. Will be recorded as ${label}.`
      : `${outcome.completedWorkingSets} of ${outcome.prescribedWorkingSets} working sets logged. Will be recorded as ${label}.`;

  return (
    <section className="space-y-3 rounded-[6px] bg-white p-4">
      {notesOpen ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNotesOpen(false)}
            data-testid="session-notes-hide"
            className="h-auto justify-start px-0 text-[12px] font-medium text-[#5a7d82] hover:bg-transparent hover:text-[#0d9488]"
          >
            <X className="h-3.5 w-3.5" />
            Hide notes
          </Button>
          <Textarea
            {...register("notes")}
            placeholder="Notes for this session (optional)"
            rows={3}
            aria-label="Session notes"
            data-testid="session-notes"
            className="text-[13px]"
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setNotesOpen(true)}
          data-testid="session-notes-toggle"
          className="h-auto justify-start px-0 text-[12px] font-medium text-[#5a7d82] hover:bg-transparent hover:text-[#0d9488]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add notes
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="completion-outcome" className="text-[12px] text-[#5a7d82]">
          {sentence}
        </p>
        {editable && (
          <button
            type="button"
            onClick={markAllComplete}
            data-testid="mark-all-complete"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0d9488] transition-colors hover:text-[#0a766b]"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all complete
          </button>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={!editable || isSubmitting}
        data-testid="save-button"
        className="w-full"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Complete workout
      </Button>
    </section>
  );
}
