"use client";

import { useCallback, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  MAX_WEEKS,
  makeRestWeek,
  newUid,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import {
  cloneWeek,
  mapSession,
  mapSlots,
  normalizeDraft,
  patchChanges,
} from "./program-builder-model";

export { findSession } from "./program-builder-model";

// Working-tree state for the Program builder. Every mutation is a pure
// reducer piped through normalizeDraft. Two invariants live here:
// 1. A reducer that returns the draft UNCHANGED (same reference) is a no-op —
//    it must not dirty the tree or arm the leave guards, so blur-without-change
//    commits and self-drops stay clean. Patch mutators use patchChanges to
//    short-circuit into that path.
// 2. Every real mutation bumps a revision counter. A save snapshots the
//    revision before the request; markSaved(revision) only clears the dirty
//    flag when nothing mutated mid-flight — otherwise edits made during the
//    save window would be silently marked clean and lost on the next load.
export function useProgramBuilderState() {
  const [draft, setDraft] = useState<ProgramDraft | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  // Mutations originate from event handlers and from post-await continuations
  // of handler-initiated flows (saves, dialog commits) — never from render —
  // so a synchronous ref mirror of the draft is safe and lets apply() detect
  // no-ops outside the React updater (updaters must stay side-effect free).
  const draftRef = useRef<ProgramDraft | null>(null);
  const isDirtyRef = useRef(false);
  const revisionRef = useRef(0);

  const apply = useCallback(
    (reducer: (current: ProgramDraft) => ProgramDraft) => {
      const current = draftRef.current;
      if (!current) return;
      const reduced = reducer(current);
      if (reduced === current) return; // no-op: don't dirty, don't re-render
      const next = normalizeDraft(reduced);
      draftRef.current = next;
      revisionRef.current += 1;
      setDraft(next);
      isDirtyRef.current = true;
      setIsDirty(true);
    },
    [],
  );

  const seed = useCallback((next: ProgramDraft) => {
    const normalized = normalizeDraft(next);
    draftRef.current = normalized;
    setDraft(normalized);
    isDirtyRef.current = false;
    setIsDirty(false);
  }, []);

  /** Synchronous dirty read for flows that snapshot-and-restore (below). */
  const getDirty = useCallback(() => isDirtyRef.current, []);

  /**
   * Restore a snapshotted dirty flag after a flow that fully unwound its own
   * mutations (the create-blank slide-over adds a card then discards it on
   * cancel — a previously-clean program must not stay flagged dirty). Leaves
   * the revision counter alone, mirroring markSaved.
   */
  const restoreDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  /** Snapshot the mutation counter right before a save request. */
  const getRevision = useCallback(() => revisionRef.current, []);

  /**
   * Commit a successful save. Returns true when the tree is clean (no
   * mutation landed since `savedRevision`); when false, dirty stays set and
   * the caller should keep the builder in edit mode.
   */
  const markSaved = useCallback((savedRevision: number): boolean => {
    const clean = revisionRef.current === savedRevision;
    if (draftRef.current) {
      draftRef.current = { ...draftRef.current, status: "saved" };
      setDraft(draftRef.current);
    }
    if (clean) {
      isDirtyRef.current = false;
      setIsDirty(false);
    }
    return clean;
  }, []);

  // --- program meta ---
  const setName = useCallback(
    (name: string) => apply((d) => (d.name === name ? d : { ...d, name })),
    [apply],
  );
  const setSplitType = useCallback(
    (splitType: string | null) =>
      apply((d) => (d.splitType === splitType ? d : { ...d, splitType })),
    [apply],
  );
  const setDefaultSurplus = useCallback(
    (pct: number | null) =>
      apply((d) =>
        d.defaultSurplusPercentage === pct
          ? d
          : { ...d, defaultSurplusPercentage: pct },
      ),
    [apply],
  );

  // --- weeks ---
  const addWeek = useCallback(
    () =>
      apply((d) =>
        d.weeks.length >= MAX_WEEKS
          ? d
          : { ...d, weeks: [...d.weeks, makeRestWeek(d.weeks.length)] },
      ),
    [apply],
  );

  const duplicateWeek = useCallback(
    (weekUid: string) =>
      apply((d) => {
        if (d.weeks.length >= MAX_WEEKS) return d;
        const index = d.weeks.findIndex((w) => w.uid === weekUid);
        if (index < 0) return d;
        const weeks = [...d.weeks];
        weeks.splice(index + 1, 0, cloneWeek(d.weeks[index]));
        return { ...d, weeks };
      }),
    [apply],
  );

  // Insert a pre-built week right after the source week (the progression
  // dialog commits its previewed clone this way). The week must carry fresh
  // uids — produce it via cloneWeek()/progressWeek(). Belts: MAX_WEEKS cap,
  // vanished source uid, and an already-present week uid all no-op.
  const insertWeekAfter = useCallback(
    (weekUid: string, week: WeekDraft) =>
      apply((d) => {
        if (d.weeks.length >= MAX_WEEKS) return d;
        const index = d.weeks.findIndex((w) => w.uid === weekUid);
        if (index < 0 || d.weeks.some((w) => w.uid === week.uid)) return d;
        const weeks = [...d.weeks];
        weeks.splice(index + 1, 0, week);
        return { ...d, weeks };
      }),
    [apply],
  );

  const deleteWeek = useCallback(
    (weekUid: string) =>
      apply((d) =>
        // Min one week — the delete affordance is also disabled in the UI.
        d.weeks.length <= 1
          ? d
          : { ...d, weeks: d.weeks.filter((w) => w.uid !== weekUid) },
      ),
    [apply],
  );

  const reorderWeek = useCallback(
    (activeUid: string, overUid: string) =>
      apply((d) => {
        const from = d.weeks.findIndex((w) => w.uid === activeUid);
        const to = d.weeks.findIndex((w) => w.uid === overUid);
        if (from < 0 || to < 0 || from === to) return d;
        return { ...d, weeks: arrayMove(d.weeks, from, to) };
      }),
    [apply],
  );

  // --- day slots (slots never move; only their session payloads do) ---
  const addSessionToSlot = useCallback(
    (slotUid: string, name?: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSlots(d, (slot) => {
          if (slot.uid !== slotUid || slot.session) return slot;
          changed = true;
          const session: SessionDraft = {
            uid: newUid("sess"),
            name: name ?? `Day ${slot.orderIndex + 1}`,
            focus: null,
            estimatedDurationMinutes: null,
            calorieSurplusPercentage: null,
            notes: null,
            sessionType: "training",
            exercises: [],
          };
          return { ...slot, session };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  // Insert a pre-built SessionDraft (a clone of a library session) into an
  // EMPTY slot. Occupied slots are a same-ref no-op — belt under the dnd
  // collision filter that already keeps library drags off occupied cells
  // (one session per day-cell is a locked invariant).
  const placeSession = useCallback(
    (slotUid: string, session: SessionDraft) =>
      apply((d) => {
        let changed = false;
        const next = mapSlots(d, (slot) => {
          if (slot.uid !== slotUid || slot.session) return slot;
          changed = true;
          return { ...slot, session };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  const clearSlot = useCallback(
    (slotUid: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSlots(d, (slot) => {
          if (slot.uid !== slotUid || !slot.session) return slot;
          changed = true;
          return { ...slot, session: null };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  // Drop onto a rest slot = move (source becomes rest); onto an occupied slot
  // = swap the two session payloads. Self-drops fall out as no-ops.
  const moveSession = useCallback(
    (sessionUid: string, targetSlotUid: string) =>
      apply((d) => {
        let moving: SessionDraft | null = null;
        let displaced: SessionDraft | null = null;
        for (const week of d.weeks) {
          for (const slot of week.days) {
            if (slot.session?.uid === sessionUid) moving = slot.session;
            if (slot.uid === targetSlotUid) displaced = slot.session;
          }
        }
        if (!moving || displaced?.uid === sessionUid) return d;
        return mapSlots(d, (slot) => {
          if (slot.uid === targetSlotUid) return { ...slot, session: moving };
          if (slot.session?.uid === sessionUid) return { ...slot, session: displaced };
          return slot;
        });
      }),
    [apply],
  );

  // --- sessions / exercises ---
  const updateSession = useCallback(
    (sessionUid: string, patch: Partial<Omit<SessionDraft, "uid" | "exercises">>) =>
      apply((d) => {
        let changed = false;
        const next = mapSession(d, sessionUid, (s) => {
          if (!patchChanges(s, patch)) return s;
          changed = true;
          return { ...s, ...patch };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  const addExercise = useCallback(
    (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) =>
      apply((d) =>
        mapSession(d, sessionUid, (s) => ({
          ...s,
          exercises: [...s.exercises, { ...exercise, uid: newUid("ex") }],
        })),
      ),
    [apply],
  );

  const removeExercise = useCallback(
    (sessionUid: string, exerciseUid: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSession(d, sessionUid, (s) => {
          const exercises = s.exercises.filter((e) => e.uid !== exerciseUid);
          if (exercises.length === s.exercises.length) return s;
          changed = true;
          return { ...s, exercises };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  const updateExercise = useCallback(
    (
      sessionUid: string,
      exerciseUid: string,
      patchOrFn: Partial<ExerciseDraft> | ((e: ExerciseDraft) => ExerciseDraft),
    ) =>
      apply((d) => {
        let changed = false;
        const next = mapSession(d, sessionUid, (s) => ({
          ...s,
          exercises: s.exercises.map((e) => {
            if (e.uid !== exerciseUid) return e;
            if (typeof patchOrFn === "function") {
              const result = patchOrFn(e);
              if (result === e) return e;
              changed = true;
              return result;
            }
            if (!patchChanges(e, patchOrFn)) return e;
            changed = true;
            return { ...e, ...patchOrFn };
          }),
        }));
        return changed ? next : d;
      }),
    [apply],
  );

  const reorderExercise = useCallback(
    (sessionUid: string, activeUid: string, overUid: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSession(d, sessionUid, (s) => {
          const from = s.exercises.findIndex((e) => e.uid === activeUid);
          const to = s.exercises.findIndex((e) => e.uid === overUid);
          if (from < 0 || to < 0 || from === to) return s;
          changed = true;
          return { ...s, exercises: arrayMove(s.exercises, from, to) };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  return {
    draft,
    isDirty,
    seed,
    getRevision,
    getDirty,
    restoreDirty,
    markSaved,
    setName,
    setSplitType,
    setDefaultSurplus,
    addWeek,
    duplicateWeek,
    insertWeekAfter,
    deleteWeek,
    reorderWeek,
    addSessionToSlot,
    placeSession,
    clearSlot,
    moveSession,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    reorderExercise,
  };
}

export type ProgramBuilderState = ReturnType<typeof useProgramBuilderState>;
