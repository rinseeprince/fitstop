"use client";

import { useToast } from "@/hooks/use-toast";
import {
  PAST_LOCKED,
  canDeleteWeek,
  canDuplicateWeek,
  canInsertAfterWeek,
  canReorderWeeks,
  isSessionLocked,
} from "./program-builder-lock-model";
import type {
  ExerciseDraft,
  SessionDraft,
  WeekDraft,
} from "./program-builder-types";
import type { ProgramBuilderState } from "./use-program-builder-state";
import type { SetSpecEdit } from "./use-set-spec-mutations";

// Single choke point for placed-plan lock enforcement on MANUAL edits: the
// provider swaps its context mutators for these wrappers, so every UI path
// (grid, dnd fall-through, session editor, add-session popover, progression
// dialog) refuses history with one destructive toast. The grid additionally
// disables locked affordances — this is the belt that catches anything that
// slips past the visuals (keyboard paths, future call sites).

type UseLockedMutatorsParams = {
  enabled: boolean;
  lockedSlotUids: ReadonlySet<string>;
  state: ProgramBuilderState;
  editSetSpec: (
    sessionUid: string,
    exercise: ExerciseDraft,
    edit: SetSpecEdit,
  ) => void;
};

export function useLockedMutators({
  enabled,
  lockedSlotUids,
  state,
  editSetSpec,
}: UseLockedMutatorsParams) {
  const { toast } = useToast();

  if (!enabled) {
    return {
      placeSession: state.placeSession,
      clearSlot: state.clearSlot,
      moveSession: state.moveSession,
      updateSession: state.updateSession,
      addExercise: state.addExercise,
      removeExercise: state.removeExercise,
      updateExercise: state.updateExercise,
      reorderExercise: state.reorderExercise,
      deleteWeek: state.deleteWeek,
      duplicateWeek: state.duplicateWeek,
      insertWeekAfter: state.insertWeekAfter,
      reorderWeek: state.reorderWeek,
      editSetSpec,
    };
  }

  const refuse = () => {
    toast({ title: "Day locked", description: PAST_LOCKED, variant: "destructive" });
  };
  const slotLocked = (slotUid: string) => lockedSlotUids.has(slotUid);
  const sessionLocked = (sessionUid: string) => {
    const draft = state.getDraft();
    return draft ? isSessionLocked(draft, lockedSlotUids, sessionUid) : false;
  };
  const sourceSlotLocked = (sessionUid: string) => {
    const draft = state.getDraft();
    if (!draft) return false;
    for (const week of draft.weeks) {
      for (const slot of week.days) {
        if (slot.session?.uid === sessionUid) return lockedSlotUids.has(slot.uid);
      }
    }
    return false;
  };
  const weekAt = (weekUid: string) => {
    const draft = state.getDraft();
    if (!draft) return null;
    const index = draft.weeks.findIndex((w) => w.uid === weekUid);
    return index < 0 ? null : { weeks: draft.weeks, index, week: draft.weeks[index] };
  };

  return {
    placeSession: (slotUid: string, session: SessionDraft) => {
      if (slotLocked(slotUid)) return refuse();
      state.placeSession(slotUid, session);
    },
    clearSlot: (slotUid: string) => {
      if (slotLocked(slotUid)) return refuse();
      state.clearSlot(slotUid);
    },
    moveSession: (sessionUid: string, targetSlotUid: string) => {
      if (slotLocked(targetSlotUid) || sourceSlotLocked(sessionUid)) return refuse();
      state.moveSession(sessionUid, targetSlotUid);
    },
    updateSession: (
      sessionUid: string,
      patch: Partial<Omit<SessionDraft, "uid" | "exercises">>,
    ) => {
      if (sessionLocked(sessionUid)) return refuse();
      state.updateSession(sessionUid, patch);
    },
    addExercise: (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) => {
      if (sessionLocked(sessionUid)) return refuse();
      state.addExercise(sessionUid, exercise);
    },
    removeExercise: (sessionUid: string, exerciseUid: string) => {
      if (sessionLocked(sessionUid)) return refuse();
      state.removeExercise(sessionUid, exerciseUid);
    },
    updateExercise: (
      sessionUid: string,
      exerciseUid: string,
      patchOrFn: Partial<ExerciseDraft> | ((e: ExerciseDraft) => ExerciseDraft),
    ) => {
      if (sessionLocked(sessionUid)) return refuse();
      state.updateExercise(sessionUid, exerciseUid, patchOrFn);
    },
    reorderExercise: (sessionUid: string, activeUid: string, overUid: string) => {
      if (sessionLocked(sessionUid)) return refuse();
      state.reorderExercise(sessionUid, activeUid, overUid);
    },
    deleteWeek: (weekUid: string) => {
      const info = weekAt(weekUid);
      if (info && !canDeleteWeek(info.week, lockedSlotUids)) return refuse();
      state.deleteWeek(weekUid);
    },
    duplicateWeek: (weekUid: string) => {
      const info = weekAt(weekUid);
      if (info && !canDuplicateWeek(info.week, lockedSlotUids)) return refuse();
      state.duplicateWeek(weekUid);
    },
    insertWeekAfter: (weekUid: string, week: WeekDraft) => {
      const info = weekAt(weekUid);
      if (info && !canInsertAfterWeek(info.weeks, lockedSlotUids, info.index)) {
        return refuse();
      }
      state.insertWeekAfter(weekUid, week);
    },
    reorderWeek: (activeUid: string, overUid: string) => {
      const from = weekAt(activeUid);
      const to = weekAt(overUid);
      if (
        from &&
        to &&
        !canReorderWeeks(from.weeks, lockedSlotUids, from.index, to.index)
      ) {
        return refuse();
      }
      state.reorderWeek(activeUid, overUid);
    },
    editSetSpec: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => {
      if (sessionLocked(sessionUid)) return refuse();
      editSetSpec(sessionUid, exercise, edit);
    },
  };
}
