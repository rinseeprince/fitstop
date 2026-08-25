import {
  MAX_WEEKS,
  type BuilderTarget,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import {
  mapSession,
  mapSlots,
  normalizeDraft,
  patchChanges,
} from "./program-builder-model";
import {
  PAST_LOCKED,
  canDeleteWeek,
  canInsertAfterWeek,
  canReorderWeeks,
  isSessionLocked,
} from "./program-builder-lock-model";

// AI-assistant operation layer (builder S6a). The server's tool executors and
// the client's replay both apply edits through applyDraftOp — ONE pure module,
// so the two sides can never drift semantically. Rules that make replay safe:
// - Ops carry FULLY MATERIALIZED payloads with server-minted uids. applyDraftOp
//   never mints a uid: a random uid minted at replay time would differ between
//   the server's working copy and the client's draft, breaking every later op
//   in the same turn that references it.
// - Ops address targets by uid. A vanished target (the coach edited mid-turn)
//   is a SKIP with a reason — never a clobber, never a throw.
// - Template identity in client-draft mode (program name/focus, session
//   name/focus — the b2b970f rule) is enforced HERE as well as at the tool
//   layer, so a future bulk tool cannot bypass it.
// - React-free and side-effect-free: importable from API routes and appliable
//   inside the state hook.

export type DraftOp =
  | {
      type: "set_program_meta";
      patch: Partial<
        Pick<
          ProgramDraft,
          "name" | "description" | "splitType" | "defaultSurplusPercentage"
        >
      >;
      label?: string;
    }
  | {
      // afterWeekUid null = append at the end.
      type: "insert_week";
      afterWeekUid: string | null;
      week: WeekDraft;
      label?: string;
    }
  | { type: "remove_week"; weekUid: string; label?: string }
  | { type: "move_week"; weekUid: string; toIndex: number; label?: string }
  | { type: "place_session"; slotUid: string; session: SessionDraft; label?: string }
  | { type: "clear_slot"; slotUid: string; label?: string }
  | { type: "move_session"; sessionUid: string; targetSlotUid: string; label?: string }
  | {
      type: "update_session";
      sessionUid: string;
      patch: Partial<Omit<SessionDraft, "uid" | "exercises">>;
      label?: string;
    }
  | { type: "add_exercise"; sessionUid: string; exercise: ExerciseDraft; label?: string }
  | {
      type: "update_exercise";
      sessionUid: string;
      exerciseUid: string;
      patch: Partial<Omit<ExerciseDraft, "uid">>;
      label?: string;
    }
  | { type: "remove_exercise"; sessionUid: string; exerciseUid: string; label?: string }
  | {
      type: "reorder_exercise";
      sessionUid: string;
      exerciseUid: string;
      toIndex: number;
      label?: string;
    };

// lockedSlotUids (placed-plan target): slots whose calendar day is history —
// see program-builder-lock-model. Server executor and client replay build the
// same Set from the same serialized array, so their skip decisions agree.
export type DraftOpContext = {
  target: BuilderTarget;
  lockedSlotUids?: ReadonlySet<string>;
};

type DraftOpOutcome = { draft: ProgramDraft; skipped?: string };

// Destructive ops never auto-apply on the client — they render as preview
// chips (Apply all / Dismiss). remove_exercise stays auto-apply: it is small,
// visible in the chip ledger, and covered by undo.
export function isDestructiveOp(op: DraftOp): boolean {
  return op.type === "remove_week" || op.type === "clear_slot";
}

const IDENTITY_LOCKED =
  "Program and session names/focus are template identity — locked in the client editor";

// Local arrayMove (dnd-kit's is client-side; this module runs on the server).
function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function findSlotSession(
  draft: ProgramDraft,
  sessionUid: string,
): SessionDraft | null {
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (slot.session?.uid === sessionUid) return slot.session;
    }
  }
  return null;
}

function findSlotUidForSession(
  draft: ProgramDraft,
  sessionUid: string,
): string | null {
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (slot.session?.uid === sessionUid) return slot.uid;
    }
  }
  return null;
}

const hasUid = (draft: ProgramDraft, uid: string): boolean =>
  draft.weeks.some(
    (w) =>
      w.uid === uid ||
      w.days.some(
        (s) =>
          s.uid === uid ||
          s.session?.uid === uid ||
          s.session?.exercises.some((e) => e.uid === uid),
      ),
  );

/**
 * Apply ONE op. Returns the input draft (same reference) with a `skipped`
 * reason when the op cannot apply — the caller decides whether that is a tool
 * error (server) or a ledger entry (client replay).
 */
export function applyDraftOp(
  draft: ProgramDraft,
  op: DraftOp,
  ctx: DraftOpContext,
): DraftOpOutcome {
  const clientDraft = ctx.target === "client-draft";
  // Lock checks run FIRST in every case that has one — a locked slot's other
  // failure modes (occupied, vanished) must not mask that it is history.
  const locked = ctx.lockedSlotUids;

  switch (op.type) {
    case "set_program_meta": {
      if (clientDraft && (op.patch.name !== undefined || op.patch.splitType !== undefined)) {
        return { draft, skipped: IDENTITY_LOCKED };
      }
      if (!patchChanges(draft, op.patch)) return { draft };
      return { draft: { ...draft, ...op.patch } };
    }

    case "insert_week": {
      if (draft.weeks.length >= MAX_WEEKS) {
        return { draft, skipped: `Programs cap at ${MAX_WEEKS} weeks` };
      }
      if (hasUid(draft, op.week.uid)) {
        return { draft, skipped: "Week already inserted" };
      }
      if (op.afterWeekUid === null) {
        return { draft: { ...draft, weeks: [...draft.weeks, op.week] } };
      }
      const index = draft.weeks.findIndex((w) => w.uid === op.afterWeekUid);
      if (index < 0) {
        return { draft, skipped: "The source week no longer exists" };
      }
      if (locked && !canInsertAfterWeek(draft.weeks, locked, index)) {
        return { draft, skipped: PAST_LOCKED };
      }
      const weeks = [...draft.weeks];
      weeks.splice(index + 1, 0, op.week);
      return { draft: { ...draft, weeks } };
    }

    case "remove_week": {
      if (draft.weeks.length <= 1) {
        return { draft, skipped: "A program keeps at least one week" };
      }
      const target = draft.weeks.find((w) => w.uid === op.weekUid);
      if (locked && target && !canDeleteWeek(target, locked)) {
        return { draft, skipped: PAST_LOCKED };
      }
      const weeks = draft.weeks.filter((w) => w.uid !== op.weekUid);
      if (weeks.length === draft.weeks.length) {
        return { draft, skipped: "That week no longer exists" };
      }
      return { draft: { ...draft, weeks } };
    }

    case "move_week": {
      const from = draft.weeks.findIndex((w) => w.uid === op.weekUid);
      if (from < 0) return { draft, skipped: "That week no longer exists" };
      const to = Math.max(0, Math.min(draft.weeks.length - 1, op.toIndex));
      if (from === to) return { draft };
      if (locked && !canReorderWeeks(draft.weeks, locked, from, to)) {
        return { draft, skipped: PAST_LOCKED };
      }
      return { draft: { ...draft, weeks: arrayMove(draft.weeks, from, to) } };
    }

    case "place_session": {
      if (locked?.has(op.slotUid)) return { draft, skipped: PAST_LOCKED };
      let placed = false;
      let occupied = false;
      const next = mapSlots(draft, (slot) => {
        if (slot.uid !== op.slotUid) return slot;
        if (slot.session) {
          occupied = true;
          return slot;
        }
        placed = true;
        return { ...slot, session: op.session };
      });
      if (occupied) {
        return { draft, skipped: "That day already has a session (one per day)" };
      }
      if (!placed) return { draft, skipped: "That day no longer exists" };
      return { draft: next };
    }

    case "clear_slot": {
      if (locked?.has(op.slotUid)) return { draft, skipped: PAST_LOCKED };
      let cleared = false;
      const next = mapSlots(draft, (slot) => {
        if (slot.uid !== op.slotUid || !slot.session) return slot;
        cleared = true;
        return { ...slot, session: null };
      });
      if (!cleared) return { draft, skipped: "That day is already a rest day" };
      return { draft: next };
    }

    case "move_session": {
      if (locked?.has(op.targetSlotUid)) return { draft, skipped: PAST_LOCKED };
      const sourceSlotUid = findSlotUidForSession(draft, op.sessionUid);
      if (sourceSlotUid && locked?.has(sourceSlotUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      const moving = findSlotSession(draft, op.sessionUid);
      if (!moving) return { draft, skipped: "That session no longer exists" };
      let displaced: SessionDraft | null = null;
      let targetFound = false;
      for (const week of draft.weeks) {
        for (const slot of week.days) {
          if (slot.uid === op.targetSlotUid) {
            targetFound = true;
            displaced = slot.session;
          }
        }
      }
      if (!targetFound) return { draft, skipped: "The target day no longer exists" };
      if (displaced?.uid === op.sessionUid) return { draft };
      return {
        draft: mapSlots(draft, (slot) => {
          if (slot.uid === op.targetSlotUid) return { ...slot, session: moving };
          if (slot.session?.uid === op.sessionUid) {
            return { ...slot, session: displaced };
          }
          return slot;
        }),
      };
    }

    case "update_session": {
      if (locked && isSessionLocked(draft, locked, op.sessionUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      if (
        clientDraft &&
        (op.patch.name !== undefined || op.patch.focus !== undefined)
      ) {
        return { draft, skipped: IDENTITY_LOCKED };
      }
      let found = false;
      let changed = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        found = true;
        if (!patchChanges(s, op.patch)) return s;
        changed = true;
        return { ...s, ...op.patch };
      });
      if (!found) return { draft, skipped: "That session no longer exists" };
      return { draft: changed ? next : draft };
    }

    case "add_exercise": {
      if (locked && isSessionLocked(draft, locked, op.sessionUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      if (hasUid(draft, op.exercise.uid)) {
        return { draft, skipped: "Exercise already added" };
      }
      let found = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        found = true;
        return { ...s, exercises: [...s.exercises, op.exercise] };
      });
      if (!found) return { draft, skipped: "That session no longer exists" };
      return { draft: next };
    }

    case "update_exercise": {
      if (locked && isSessionLocked(draft, locked, op.sessionUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      let found = false;
      let changed = false;
      const next = mapSession(draft, op.sessionUid, (s) => ({
        ...s,
        exercises: s.exercises.map((e) => {
          if (e.uid !== op.exerciseUid) return e;
          found = true;
          if (!patchChanges(e, op.patch)) return e;
          changed = true;
          return { ...e, ...op.patch };
        }),
      }));
      if (!found) return { draft, skipped: "That exercise no longer exists" };
      return { draft: changed ? next : draft };
    }

    case "remove_exercise": {
      if (locked && isSessionLocked(draft, locked, op.sessionUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      let found = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        const exercises = s.exercises.filter((e) => e.uid !== op.exerciseUid);
        if (exercises.length === s.exercises.length) return s;
        found = true;
        return { ...s, exercises };
      });
      if (!found) return { draft, skipped: "That exercise no longer exists" };
      return { draft: next };
    }

    case "reorder_exercise": {
      if (locked && isSessionLocked(draft, locked, op.sessionUid)) {
        return { draft, skipped: PAST_LOCKED };
      }
      let found = false;
      let changed = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        const from = s.exercises.findIndex((e) => e.uid === op.exerciseUid);
        if (from < 0) return s;
        found = true;
        const to = Math.max(0, Math.min(s.exercises.length - 1, op.toIndex));
        if (from === to) return s;
        changed = true;
        return { ...s, exercises: arrayMove(s.exercises, from, to) };
      });
      if (!found) return { draft, skipped: "That exercise no longer exists" };
      return { draft: changed ? next : draft };
    }
  }
}

export type DraftOpsResult = {
  draft: ProgramDraft;
  applied: number;
  skipped: Array<{ index: number; type: DraftOp["type"]; reason: string }>;
};

/**
 * Apply a whole op list sequentially, normalizing after every applied op so
 * weekIndex/orderIndex mirrors stay true for later ops in the same turn.
 * Pure — callers commit the returned tree themselves (the client via ONE
 * apply(() => result.draft); the server by replacing its working copy).
 * normalizeDraft never mints uids on schema-valid payloads (weeks are always
 * exactly 7 slots), which keeps server and client replays byte-identical.
 */
export function applyDraftOps(
  draft: ProgramDraft,
  ops: DraftOp[],
  ctx: DraftOpContext,
): DraftOpsResult {
  let current = draft;
  let applied = 0;
  const skipped: DraftOpsResult["skipped"] = [];
  ops.forEach((op, index) => {
    const outcome = applyDraftOp(current, op, ctx);
    if (outcome.skipped) {
      skipped.push({ index, type: op.type, reason: outcome.skipped });
      return;
    }
    applied += 1;
    if (outcome.draft !== current) current = normalizeDraft(outcome.draft);
  });
  return { draft: current, applied, skipped };
}
