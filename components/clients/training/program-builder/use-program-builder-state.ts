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
} from "./program-builder-types";
import { toast } from "sonner";
import {
  addSessionToDay,
  cloneWeek,
  findSession,
  findSlot,
  mapSession,
  mapSessionExercises,
  mapSlots,
  moveSessionToDay,
  normalizeDraft,
  patchChanges,
  removeSessionExercise,
  removeSessionFromDay,
  reorderSessionInDay,
  straightSetsGroup,
} from "./program-builder-model";
import {
  linkExercises as linkSessionExercises,
  moveExercise as moveSessionExercise,
  moveGroup as moveSessionGroup,
  unlinkGroup as unlinkSessionGroup,
  updateGroup as updateSessionGroup,
  type ExerciseDestination,
  type GroupEditResult,
  type GroupSettingsPatch,
  type LinkFormat,
} from "./program-builder-groups";
import {
  applyDraftOps,
  type DraftOp,
  type DraftOpContext,
  type DraftOpsResult,
} from "./program-builder-ops";

export { findSession };

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
  // One per seed: a seed is a new document even when it is the same program
  // (the plan editor's discard and reload re-seed without leaving edit mode),
  // so inputs that hold their own text key on it to start again from the seed.
  const [seedCount, setSeedCount] = useState(0);

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
    setSeedCount((count) => count + 1);
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
   * Synchronous read of the current tree for flows that snapshot it (the
   * assistant's undo stack). The tree is immutable — every mutation builds new
   * objects — so holding the returned reference IS the snapshot; no clone.
   */
  const getDraft = useCallback(() => draftRef.current, []);

  /**
   * Wholesale tree replacement through the NORMAL mutation path (assistant
   * undo). Unlike seed(), this bumps the revision counter and dirties the
   * tree — an undo landing while a save is in flight must make
   * markSaved(savedRevision) see a moved counter, or the reverted tree would
   * be silently stamped clean/saved (the exact race the counter exists to
   * prevent). Callers that restored to a known-clean snapshot follow up with
   * restoreDirty(false).
   */
  const replaceDraft = useCallback(
    (next: ProgramDraft) => apply(() => next),
    [apply],
  );

  /**
   * Replay an assistant turn's ops through the SAME pure module the server
   * executed them with (program-builder-ops) — one apply() commit, so the
   * whole turn is a single revision bump / re-render / dirty transition, with
   * identical semantics to a hand edit. The reduction runs OUT HERE, not
   * inside a reducer: skip-collection is a result we return, and reducers
   * must stay side-effect free. Vanished-target ops skip loudly in the result.
   */
  const applyAssistantOps = useCallback(
    (ops: DraftOp[], ctx: DraftOpContext): DraftOpsResult | null => {
      const current = draftRef.current;
      if (!current) return null;
      const result = applyDraftOps(current, ops, ctx);
      if (result.draft !== current) apply(() => result.draft);
      return result;
    },
    [apply],
  );

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
  const setDescription = useCallback(
    (description: string | null) =>
      apply((d) =>
        d.description === description ? d : { ...d, description },
      ),
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

  // --- day slots (slots never move; only the sessions they hold do) ---
  // The day rules are the model's (program-builder-model.ts): a session added
  // to or moved onto a day joins it, last, and a full day refuses it — a same-
  // reference no-op here, since the grid never offers a full day.

  // Adds a new empty session to a day, after its sessions. Returns the new
  // session's uid, or null when the day refused it. Worked out against the
  // draft as it stands, OUT HERE rather than inside a reducer, so the answer is
  // a return value and the reducer stays pure.
  const addSessionToSlot = useCallback(
    (slotUid: string, name?: string): string | null => {
      const current = draftRef.current;
      const slot = findSlot(current, slotUid);
      if (!current || !slot) return null;
      const session: SessionDraft = {
        uid: newUid("sess"),
        name: name ?? `Day ${slot.orderIndex + 1}`,
        focus: null,
        estimatedDurationMinutes: null,
        calorieSurplusPercentage: null,
        notes: null,
        sessionType: "training",
        groups: [],
      };
      const result = addSessionToDay(current, slotUid, session);
      if (!result.ok) return null;
      apply(() => result.draft);
      return session.uid;
    },
    [apply],
  );

  // Adds a pre-built SessionDraft (a clone of a library session, or a blank
  // built by the caller) to a day, after its sessions.
  const placeSession = useCallback(
    (slotUid: string, session: SessionDraft) =>
      apply((d) => {
        const result = addSessionToDay(d, slotUid, session);
        return result.ok ? result.draft : d;
      }),
    [apply],
  );

  // Empties the whole day, every session on it.
  const clearSlot = useCallback(
    (slotUid: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSlots(d, (slot) => {
          if (slot.uid !== slotUid || slot.sessions.length === 0) return slot;
          changed = true;
          return { ...slot, sessions: [] };
        });
        return changed ? next : d;
      }),
    [apply],
  );

  // One session off its day; the day is rest once it holds none.
  const removeSession = useCallback(
    (sessionUid: string) => apply((d) => removeSessionFromDay(d, sessionUid)),
    [apply],
  );

  // Onto another day it joins that day, last; onto its own day it stays put.
  const moveSession = useCallback(
    (sessionUid: string, targetSlotUid: string) =>
      apply((d) => {
        const moved = moveSessionToDay(d, sessionUid, targetSlotUid);
        return moved.ok ? moved.draft : d;
      }),
    [apply],
  );

  // A session's place among its day's sessions (0 first).
  const reorderSession = useCallback(
    (sessionUid: string, toIndex: number) =>
      apply((d) => reorderSessionInDay(d, sessionUid, toIndex)),
    [apply],
  );

  // --- sessions / exercises ---
  const updateSession = useCallback(
    (sessionUid: string, patch: Partial<Omit<SessionDraft, "uid" | "groups">>) =>
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

  // A picked exercise joins the session as a straight-sets group of one.
  const addExercise = useCallback(
    (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) =>
      apply((d) =>
        mapSession(d, sessionUid, (s) => ({
          ...s,
          groups: [
            ...s.groups,
            straightSetsGroup(newUid("grp"), { ...exercise, uid: newUid("ex") }),
          ],
        })),
      ),
    [apply],
  );

  const removeExercise = useCallback(
    (sessionUid: string, exerciseUid: string) =>
      apply((d) => {
        let changed = false;
        const next = mapSession(d, sessionUid, (s) => {
          const removed = removeSessionExercise(s, exerciseUid);
          if (removed !== s) changed = true;
          return removed;
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
        const next = mapSession(d, sessionUid, (s) =>
          mapSessionExercises(s, (e) => {
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
        );
        return changed ? next : d;
      }),
    [apply],
  );

  // --- groups (program-builder-groups.ts) ---
  // Each edit is worked out against the session as it stands, OUT HERE rather
  // than inside a reducer: a refusal is a toast, and reducers stay side-effect
  // free. The group edits never mint a uid themselves; these mint the uids new
  // groups take.
  const editGroups = useCallback(
    (sessionUid: string, edit: (session: SessionDraft) => GroupEditResult) => {
      const current = draftRef.current;
      const session = findSession(current, sessionUid);
      if (!session) return;
      const result = edit(session);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      if (result.session === session) return;
      apply((d) => mapSession(d, sessionUid, () => result.session));
    },
    [apply],
  );

  const linkExercises = useCallback(
    (sessionUid: string, exerciseUids: string[], format?: LinkFormat) =>
      editGroups(sessionUid, (s) => linkSessionExercises(s, exerciseUids, newUid("grp"), format)),
    [editGroups],
  );

  const unlinkGroup = useCallback(
    (sessionUid: string, groupUid: string) =>
      editGroups(sessionUid, (s) => {
        const size = s.groups.find((g) => g.uid === groupUid)?.exercises.length ?? 0;
        return unlinkSessionGroup(
          s,
          groupUid,
          Array.from({ length: size }, () => newUid("grp")),
        );
      }),
    [editGroups],
  );

  const moveExercise = useCallback(
    (sessionUid: string, exerciseUid: string, to: ExerciseDestination) =>
      editGroups(sessionUid, (s) => moveSessionExercise(s, exerciseUid, to, newUid("grp"))),
    [editGroups],
  );

  const moveGroup = useCallback(
    (sessionUid: string, groupUid: string, index: number) =>
      editGroups(sessionUid, (s) => moveSessionGroup(s, groupUid, index)),
    [editGroups],
  );

  const updateGroup = useCallback(
    (sessionUid: string, groupUid: string, patch: GroupSettingsPatch) =>
      editGroups(sessionUid, (s) => updateSessionGroup(s, groupUid, patch)),
    [editGroups],
  );

  return {
    draft,
    isDirty,
    seed,
    seedCount,
    getRevision,
    getDraft,
    getDirty,
    restoreDirty,
    replaceDraft,
    applyAssistantOps,
    markSaved,
    setName,
    setSplitType,
    setDescription,
    setDefaultSurplus,
    addWeek,
    duplicateWeek,
    deleteWeek,
    reorderWeek,
    addSessionToSlot,
    placeSession,
    clearSlot,
    removeSession,
    moveSession,
    reorderSession,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    linkExercises,
    unlinkGroup,
    moveExercise,
    moveGroup,
    updateGroup,
  };
}

export type ProgramBuilderState = ReturnType<typeof useProgramBuilderState>;
