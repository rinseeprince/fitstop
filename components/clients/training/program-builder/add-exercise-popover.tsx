"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useSWRConfig } from "swr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ExerciseFormDialog } from "@/components/programs/exercise-form-dialog";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { EXERCISE_CATALOG_KEY } from "@/hooks/use-exercise-catalog";
import { cn } from "@/lib/utils";
import { ExercisePicker } from "./exercise-picker";
import type { CatalogPick } from "./program-builder-model";
import { MONO_LABEL_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "./builder-tokens";

// The catalog picker, hung off the Exercises rail's "+" instead of sitting
// permanently at the bottom of the list. One affordance rather than two, and
// the list is no longer pushed down by a search field nobody is using.
//
// The picker keeps its multi-add flow inside here: picking does not close the
// popover, and the input re-focuses, so a coach can type-enter-type-enter their
// way through a session exactly as before.
//
// A name the catalog doesn't have ("Use …") opens the New exercise form on it,
// closing the popover in the same click so one surface is open at a time. The
// form is this component's sibling of the popover, not its content, so it
// outlives the popover's close; the exercise it creates joins the catalog and
// the session, like any pick.
type AddExercisePopoverProps = {
  onPick: (pick: CatalogPick) => void;
};

export function AddExercisePopover({ onPick }: AddExercisePopoverProps) {
  const [open, setOpen] = useState(false);
  const createDialog = useDialogSubject<string>();
  const { mutate } = useSWRConfig();

  const create = (name: string) => {
    setOpen(false);
    createDialog.show(name);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Add exercise"
            title="Add exercise"
            className={cn(
              "rounded p-1 transition-colors hover:text-[#0d9488] data-[state=open]:text-[#0d9488]",
              TEXT_MUTED,
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
          // The picker manages its own focus (it re-focuses the input after every
          // pick); letting Radix grab it on open would fight that.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-3.5 pb-2 pt-3">
            <div className={cn("text-sm font-semibold", TEXT_PRIMARY)}>
              Add exercise
            </div>
            <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
              Search your catalogue
            </div>
          </div>
          <div className="px-3.5 pb-3">
            <ExercisePicker onPick={onPick} onCreate={create} />
          </div>
        </PopoverContent>
      </Popover>
      <ExerciseFormDialog
        key={`exercise-create-${createDialog.openKey}`}
        open={createDialog.open}
        onOpenChange={(next) => {
          if (!next) createDialog.close();
        }}
        initialName={createDialog.subject ?? ""}
        onSaved={(exercise) => {
          void mutate(EXERCISE_CATALOG_KEY);
          onPick({ name: exercise.name, exerciseId: exercise.id, exerciseType: exercise.exerciseType });
        }}
      />
    </>
  );
}
