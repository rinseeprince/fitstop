import {
  progressExercise,
  type ProgressionRule,
} from "@/utils/progression-rules";
import {
  DAYS_PER_WEEK,
  makeRestSlot,
  newUid,
  type DaySlotDraft,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
import {
  isSupersetOrCircuit,
  normalizeGroups,
  progressGroupRounds,
} from "./program-builder-groups";

// Pure model helpers for the builder draft tree — normalization, cloning, and
// lookups. Kept free of React so the state hook stays thin and these are unit
// testable without a render.

// =============================================================================
// normalize — runs after EVERY mutation; idempotent
// =============================================================================

function normalizeExercise(e: ExerciseDraft): ExerciseDraft {
  // An empty spec array reverts to null: [] fails the API's ≥1-non-warmup
  // refine and would 400 the whole save (the exercise falls back to its
  // compact columns instead). Non-empty specs get set_number renumbered.
  if (!e.setSpecs || e.setSpecs.length === 0) {
    return e.setSpecs === null ? e : { ...e, setSpecs: null };
  }
  return {
    ...e,
    setSpecs: e.setSpecs.map((s, i) => ({ ...s, set_number: i + 1 })),
  };
}

function normalizeSession(session: SessionDraft): SessionDraft {
  return {
    ...session,
    // Every exercise sits in a group and a group holds at least one; a group of
    // one is a plain exercise, and no group keeps a setting its format doesn't
    // use (program-builder-groups.ts).
    groups: normalizeGroups(
      session.groups.map((group) => ({ ...group, exercises: group.exercises.map(normalizeExercise) })),
    ),
  };
}

function normalizeSlot(slot: DaySlotDraft, orderIndex: number): DaySlotDraft {
  return {
    ...slot,
    orderIndex,
    isRest: slot.sessions.length === 0,
    sessions: slot.sessions.map(normalizeSession),
  };
}

export function normalizeDraft(draft: ProgramDraft): ProgramDraft {
  return {
    ...draft,
    weeks: draft.weeks.map((week, w) => {
      // Defensive: a week is ALWAYS exactly 7 slots (the placement date-walk
      // relies on it). No mutator changes day counts; this pad is a backstop.
      const days = week.days.slice(0, DAYS_PER_WEEK);
      while (days.length < DAYS_PER_WEEK) days.push(makeRestSlot(days.length));
      return { ...week, weekIndex: w, days: days.map(normalizeSlot) };
    }),
  };
}

// =============================================================================
// clone helpers (fresh uids at every level — duplicated weeks must not share
// identity with their source for React keys / dnd)
// =============================================================================

function cloneExercise(e: ExerciseDraft): ExerciseDraft {
  return {
    ...e,
    uid: newUid("ex"),
    setSpecs: e.setSpecs
      ? e.setSpecs.map((s) => ({
          ...s,
          drops: s.drops ? s.drops.map((d) => ({ ...d })) : s.drops,
        }))
      : null,
  };
}

function cloneSession(s: SessionDraft): SessionDraft {
  return {
    ...s,
    uid: newUid("sess"),
    groups: s.groups.map((group) => ({
      ...group,
      uid: newUid("grp"),
      exercises: group.exercises.map(cloneExercise),
    })),
  };
}

export function cloneWeek(w: WeekDraft): WeekDraft {
  return {
    ...w,
    uid: newUid("wk"),
    days: w.days.map((slot) => ({
      ...slot,
      uid: newUid("slot"),
      sessions: slot.sessions.map(cloneSession),
    })),
  };
}

// =============================================================================
// progression (builder S4)
// =============================================================================

/**
 * Apply a progression rule across a week — the WeekDraft-typed walk over the
 * pure engine in utils/progression-rules.ts (which cannot import component
 * types). Call it on a cloneWeek()'d copy and commit THAT returned week:
 * clone-then-progress, never re-clone after, or changedExerciseUids (the
 * clone's uids, used for preview rows) go stale. Progresses every session of
 * every day, and never adds/removes/reorders sessions or exercises — the
 * preview pairs source↔progressed positionally. Rest slots, out-of-scope
 * exercises, and rule no-ops keep their references; a week the rule doesn't
 * touch returns the INPUT reference so callers can detect "this rule changes
 * nothing".
 */
export function progressWeek(
  week: WeekDraft,
  rule: ProgressionRule,
  inScope: (ex: ExerciseDraft) => boolean,
): { week: WeekDraft; changedExerciseUids: ReadonlySet<string> } {
  const changedExerciseUids = new Set<string>();
  let weekChanged = false;
  const days = week.days.map((slot) => {
    let slotChanged = false;
    const sessions = slot.sessions.map((session) => {
      const next = progressSession(session, rule, inScope, changedExerciseUids);
      if (next !== session) slotChanged = true;
      return next;
    });
    if (!slotChanged) return slot;
    weekChanged = true;
    return { ...slot, sessions };
  });
  return {
    week: weekChanged ? { ...week, days } : week,
    changedExerciseUids,
  };
}

// A group walk: in a superset or circuit the Sets rule changes the group's
// rounds, every exercise together, when any of its exercises is in scope — so
// its exercises stay one set per round. Every other rule, and every exercise
// outside one, progresses exercise by exercise.
function progressSession(
  session: SessionDraft,
  rule: ProgressionRule,
  inScope: (ex: ExerciseDraft) => boolean,
  changed: Set<string>,
): SessionDraft {
  let sessionChanged = false;
  const groups = session.groups.map((group) => {
    if (rule.kind === "sets" && isSupersetOrCircuit(group)) {
      if (!group.exercises.some(inScope)) return group;
      const next = progressGroupRounds(group, rule.amount);
      if (!next) return group;
      next.exercises.forEach((ex, i) => {
        if (ex !== group.exercises[i]) changed.add(ex.uid);
      });
      sessionChanged = true;
      return next;
    }
    let groupChanged = false;
    const exercises = group.exercises.map((ex) => {
      if (!inScope(ex)) return ex;
      const result = progressExercise(ex, rule);
      if (!result) return ex;
      changed.add(ex.uid);
      groupChanged = true;
      return { ...ex, ...result };
    });
    if (!groupChanged) return group;
    sessionChanged = true;
    return { ...group, exercises };
  });
  return sessionChanged ? { ...session, groups } : session;
}

// =============================================================================
// lookup + map helpers (a day holds its sessions in order)
// =============================================================================

/** The day slot with `slotUid`; null when it is gone. */
export function findSlot(draft: ProgramDraft | null, slotUid: string): DaySlotDraft | null {
  if (!draft) return null;
  for (const week of draft.weeks) {
    const slot = week.days.find((s) => s.uid === slotUid);
    if (slot) return slot;
  }
  return null;
}

/** The day holding a session and the session's place in it; null when no day does. */
export function findSessionPlace(
  draft: ProgramDraft | null,
  sessionUid: string | null,
): { slot: DaySlotDraft; index: number } | null {
  if (!draft || !sessionUid) return null;
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      const index = slot.sessions.findIndex((s) => s.uid === sessionUid);
      if (index >= 0) return { slot, index };
    }
  }
  return null;
}

export function findSession(
  draft: ProgramDraft | null,
  sessionUid: string | null,
): SessionDraft | null {
  const at = findSessionPlace(draft, sessionUid);
  return at ? at.slot.sessions[at.index] : null;
}

/** A week's sessions, day by day, each day's in its order. */
export function weekSessions(week: WeekDraft): SessionDraft[] {
  return week.days.flatMap((slot) => slot.sessions);
}

export function mapSlots(
  draft: ProgramDraft,
  fn: (slot: DaySlotDraft) => DaySlotDraft,
): ProgramDraft {
  return {
    ...draft,
    weeks: draft.weeks.map((w) => ({ ...w, days: w.days.map(fn) })),
  };
}

export function mapSession(
  draft: ProgramDraft,
  sessionUid: string,
  fn: (session: SessionDraft) => SessionDraft,
): ProgramDraft {
  return mapSlots(draft, (slot) =>
    slot.sessions.some((s) => s.uid === sessionUid)
      ? { ...slot, sessions: slot.sessions.map((s) => (s.uid === sessionUid ? fn(s) : s)) }
      : slot,
  );
}

// =============================================================================
// a day's sessions — shared by the coach's gestures and the assistant's ops, so
// both follow one rule: a session added to or moved onto a day joins it, last;
// its place within the day changes only by reordering the day
// =============================================================================

/** Why a day won't take another session. */
export const DAY_IS_FULL = `A day holds at most ${MAX_SESSIONS_PER_DAY} sessions`;

type DayEdit = { ok: true; draft: ProgramDraft } | { ok: false; reason: string };

/** Whether a day has room for one more session. */
export function dayHasRoom(slot: DaySlotDraft): boolean {
  return slot.sessions.length < MAX_SESSIONS_PER_DAY;
}

/**
 * Add a session to a day, after the sessions already on it; on a rest day it
 * is the day's first. Refused when the day is full or gone.
 */
export function addSessionToDay(
  draft: ProgramDraft,
  slotUid: string,
  session: SessionDraft,
): DayEdit {
  const slot = findSlot(draft, slotUid);
  if (!slot) return { ok: false, reason: "That day no longer exists" };
  if (!dayHasRoom(slot)) return { ok: false, reason: DAY_IS_FULL };
  return {
    ok: true,
    draft: mapSlots(draft, (s) =>
      s.uid === slotUid ? { ...s, sessions: [...s.sessions, session] } : s,
    ),
  };
}

/**
 * Remove one session from its day; a day left with none is a rest day. The
 * same draft when no day holds the session.
 */
export function removeSessionFromDay(draft: ProgramDraft, sessionUid: string): ProgramDraft {
  const at = findSessionPlace(draft, sessionUid);
  if (!at) return draft;
  return mapSlots(draft, (slot) =>
    slot.uid === at.slot.uid
      ? { ...slot, sessions: slot.sessions.filter((s) => s.uid !== sessionUid) }
      : slot,
  );
}

/**
 * Move a session onto another day, where it joins the sessions already there,
 * last; the day it left keeps its other sessions, in order. Onto its own day
 * nothing changes (the same draft) — a day's order changes by reordering it.
 * Refused when the other day is full.
 */
export function moveSessionToDay(
  draft: ProgramDraft,
  sessionUid: string,
  targetSlotUid: string,
): DayEdit {
  const from = findSessionPlace(draft, sessionUid);
  if (!from) return { ok: false, reason: "That session no longer exists" };
  const target = findSlot(draft, targetSlotUid);
  if (!target) return { ok: false, reason: "The target day no longer exists" };
  if (target.uid === from.slot.uid) return { ok: true, draft };
  if (!dayHasRoom(target)) return { ok: false, reason: DAY_IS_FULL };
  const moving = from.slot.sessions[from.index];
  return {
    ok: true,
    draft: mapSlots(draft, (slot) => {
      if (slot.uid === target.uid) return { ...slot, sessions: [...slot.sessions, moving] };
      if (slot.uid !== from.slot.uid) return slot;
      return { ...slot, sessions: slot.sessions.filter((s) => s.uid !== sessionUid) };
    }),
  };
}

/**
 * Put a session at `toIndex` among its day's sessions (0 first; clamped to the
 * day), the others keeping their order around it. The same draft when it is
 * already there or no day holds it.
 */
export function reorderSessionInDay(
  draft: ProgramDraft,
  sessionUid: string,
  toIndex: number,
): ProgramDraft {
  const at = findSessionPlace(draft, sessionUid);
  if (!at) return draft;
  const to = Math.max(0, Math.min(at.slot.sessions.length - 1, toIndex));
  if (to === at.index) return draft;
  const sessions = [...at.slot.sessions];
  const [moving] = sessions.splice(at.index, 1);
  sessions.splice(to, 0, moving);
  return mapSlots(draft, (slot) => (slot.uid === at.slot.uid ? { ...slot, sessions } : slot));
}

// =============================================================================
// exercises within a session's groups
// =============================================================================

/** A lone exercise's group: straight sets, holding just `exercise`. */
export function straightSetsGroup(uid: string, exercise: ExerciseDraft): ExerciseGroupDraft {
  return { uid, ...STRAIGHT_SETS, exercises: [exercise] };
}

/**
 * Apply `fn` to every exercise of a session, wherever its group. A group none
 * of whose exercises changed keeps its reference, and a session nothing
 * changed in comes back as the same reference.
 */
export function mapSessionExercises(
  session: SessionDraft,
  fn: (exercise: ExerciseDraft) => ExerciseDraft,
): SessionDraft {
  let changed = false;
  const groups = session.groups.map((group) => {
    let groupChanged = false;
    const exercises = group.exercises.map((exercise) => {
      const next = fn(exercise);
      if (next !== exercise) groupChanged = true;
      return next;
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, exercises };
  });
  return changed ? { ...session, groups } : session;
}

/**
 * Remove one exercise from its group; a group left empty goes with it. The
 * same reference when the session holds no such exercise.
 */
export function removeSessionExercise(session: SessionDraft, exerciseUid: string): SessionDraft {
  let found = false;
  const groups = session.groups.flatMap((group) => {
    const exercises = group.exercises.filter((e) => e.uid !== exerciseUid);
    if (exercises.length === group.exercises.length) return [group];
    found = true;
    return exercises.length > 0 ? [{ ...group, exercises }] : [];
  });
  return found ? { ...session, groups } : session;
}

/** True when applying `patch` to `obj` would change at least one field. */
export function patchChanges<T extends object>(obj: T, patch: Partial<T>): boolean {
  return Object.entries(patch).some(
    ([key, value]) => obj[key as keyof T] !== value,
  );
}

// =============================================================================
// exercise-draft factory
// =============================================================================

/**
 * The ONE default shape a catalog pick becomes when added to a session — a
 * compact-only exercise (3 working sets, 8–12 reps). Shared by the in-editor
 * ExercisePicker and the S4.5 drag-an-exercise-onto-a-session gesture so both
 * entry points produce byte-identical drafts. `exerciseId` may be null (free
 * text); the server resolves/creates the catalog row on save.
 */
export function defaultExerciseDraftFromCatalog({
  name,
  exerciseId,
}: {
  name: string;
  exerciseId: string | null;
}): Omit<ExerciseDraft, "uid"> {
  return {
    exerciseId,
    name,
    setSpecs: null,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    // null, never [] — a fresh exercise prescribes everything until the coach
    // narrows it.
    prescribedFields: null,
  };
}
