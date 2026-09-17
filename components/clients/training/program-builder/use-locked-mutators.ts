"use client";

import { toast } from "sonner";
import {
  insertWeekRefusal,
  moveWeekRefusal,
  planDayRules,
  sessionRefusal,
  slotRefusal,
  LIMIT_LOCKED,
  PAST_LOCKED,
  type EditableDays,
} from "./program-builder-lock-model";
import type {
  ExerciseDraft,
  SessionDraft,
  WeekDraft,
} from "./program-builder-types";
import type { ExerciseDestination, GroupSettingsPatch } from "./program-builder-groups";
import type { ProgramBuilderState } from "./use-program-builder-state";
import type { SetSpecEdit } from "./use-set-spec-mutations";

// The plan editor's single choke point for MANUAL edits: the provider swaps
// its context mutators for these wrappers, so every UI path (grid, dnd, session
// editor, add-session popover, progression dialog) refuses a locked or greyed
// day with one toast. The grid also disables those affordances; this is the
// belt for anything that slips past them (keyboard paths, future call sites).
// The rule is read from the grid as it stands at the moment of the edit.

type UseLockedMutatorsParams = {
  /** The plan editor's editable days; null leaves every mutator untouched. */
  editableDays: EditableDays | null;
  state: ProgramBuilderState;
  editSetSpec: (
    sessionUid: string,
    exercise: ExerciseDraft,
    edit: SetSpecEdit,
  ) => void;
};

export function useLockedMutators({
  editableDays,
  state,
  editSetSpec,
}: UseLockedMutatorsParams) {
  if (!editableDays) {
    return {
      addWeek: state.addWeek,
      placeSession: state.placeSession,
      clearSlot: state.clearSlot,
      removeSession: state.removeSession,
      moveSession: state.moveSession,
      reorderSession: state.reorderSession,
      updateSession: state.updateSession,
      addExercise: state.addExercise,
      removeExercise: state.removeExercise,
      updateExercise: state.updateExercise,
      linkExercises: state.linkExercises,
      unlinkGroup: state.unlinkGroup,
      moveExercise: state.moveExercise,
      moveGroup: state.moveGroup,
      updateGroup: state.updateGroup,
      deleteWeek: state.deleteWeek,
      duplicateWeek: state.duplicateWeek,
      insertWeekAfter: state.insertWeekAfter,
      reorderWeek: state.reorderWeek,
      editSetSpec,
    };
  }

  // Shows the refusal and reports whether there was one.
  const refused = (reason: string | null) => {
    if (reason) toast.error("Day locked", { description: reason });
    return reason != null;
  };
  const weeksNow = () => state.getDraft()?.weeks ?? [];
  const rulesNow = () => planDayRules(weeksNow(), editableDays, null);
  const slotRefused = (slotUid: string) => refused(slotRefusal(rulesNow(), slotUid));
  const sessionRefused = (sessionUid: string) => {
    const draft = state.getDraft();
    return draft
      ? refused(sessionRefusal(draft, planDayRules(draft.weeks, editableDays, null), sessionUid))
      : false;
  };
  const weekIndex = (weekUid: string) => weeksNow().findIndex((w) => w.uid === weekUid);

  return {
    addWeek: () => {
      if (refused(rulesNow().canAddWeek ? null : LIMIT_LOCKED)) return;
      state.addWeek();
    },
    placeSession: (slotUid: string, session: SessionDraft) => {
      if (slotRefused(slotUid)) return;
      state.placeSession(slotUid, session);
    },
    clearSlot: (slotUid: string) => {
      if (slotRefused(slotUid)) return;
      state.clearSlot(slotUid);
    },
    removeSession: (sessionUid: string) => {
      if (sessionRefused(sessionUid)) return;
      state.removeSession(sessionUid);
    },
    moveSession: (sessionUid: string, targetSlotUid: string) => {
      if (slotRefused(targetSlotUid) || sessionRefused(sessionUid)) return;
      state.moveSession(sessionUid, targetSlotUid);
    },
    reorderSession: (sessionUid: string, toIndex: number) => {
      if (sessionRefused(sessionUid)) return;
      state.reorderSession(sessionUid, toIndex);
    },
    updateSession: (
      sessionUid: string,
      patch: Partial<Omit<SessionDraft, "uid" | "groups">>,
    ) => {
      if (sessionRefused(sessionUid)) return;
      state.updateSession(sessionUid, patch);
    },
    addExercise: (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) => {
      if (sessionRefused(sessionUid)) return;
      state.addExercise(sessionUid, exercise);
    },
    removeExercise: (sessionUid: string, exerciseUid: string) => {
      if (sessionRefused(sessionUid)) return;
      state.removeExercise(sessionUid, exerciseUid);
    },
    updateExercise: (
      sessionUid: string,
      exerciseUid: string,
      patchOrFn: Partial<ExerciseDraft> | ((e: ExerciseDraft) => ExerciseDraft),
    ) => {
      if (sessionRefused(sessionUid)) return;
      state.updateExercise(sessionUid, exerciseUid, patchOrFn);
    },
    linkExercises: (sessionUid: string, exerciseUids: string[]) => {
      if (sessionRefused(sessionUid)) return;
      state.linkExercises(sessionUid, exerciseUids);
    },
    unlinkGroup: (sessionUid: string, groupUid: string) => {
      if (sessionRefused(sessionUid)) return;
      state.unlinkGroup(sessionUid, groupUid);
    },
    moveExercise: (sessionUid: string, exerciseUid: string, to: ExerciseDestination) => {
      if (sessionRefused(sessionUid)) return;
      state.moveExercise(sessionUid, exerciseUid, to);
    },
    moveGroup: (sessionUid: string, groupUid: string, index: number) => {
      if (sessionRefused(sessionUid)) return;
      state.moveGroup(sessionUid, groupUid, index);
    },
    updateGroup: (sessionUid: string, groupUid: string, patch: GroupSettingsPatch) => {
      if (sessionRefused(sessionUid)) return;
      state.updateGroup(sessionUid, groupUid, patch);
    },
    deleteWeek: (weekUid: string) => {
      if (refused(rulesNow().weeks.get(weekUid)?.canDelete === false ? PAST_LOCKED : null)) {
        return;
      }
      state.deleteWeek(weekUid);
    },
    duplicateWeek: (weekUid: string) => {
      const index = weekIndex(weekUid);
      const week = weeksNow()[index];
      if (week && refused(insertWeekRefusal(weeksNow(), editableDays, index, week))) return;
      state.duplicateWeek(weekUid);
    },
    insertWeekAfter: (weekUid: string, week: WeekDraft) => {
      const index = weekIndex(weekUid);
      if (index >= 0 && refused(insertWeekRefusal(weeksNow(), editableDays, index, week))) {
        return;
      }
      state.insertWeekAfter(weekUid, week);
    },
    reorderWeek: (activeUid: string, overUid: string) => {
      const from = weekIndex(activeUid);
      const to = weekIndex(overUid);
      if (from >= 0 && to >= 0 && refused(moveWeekRefusal(weeksNow(), editableDays, from, to))) {
        return;
      }
      state.reorderWeek(activeUid, overUid);
    },
    editSetSpec: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => {
      if (sessionRefused(sessionUid)) return;
      editSetSpec(sessionUid, exercise, edit);
    },
  };
}
