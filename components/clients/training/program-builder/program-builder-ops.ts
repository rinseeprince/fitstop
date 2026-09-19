import {
  MAX_WEEKS,
  type BuilderTarget,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import {
  addSessionToDay,
  findSession,
  findSessionPlace,
  mapSession,
  mapSessionExercises,
  mapSlots,
  moveSessionToDay,
  normalizeDraft,
  patchChanges,
  removeSessionExercise,
  removeSessionFromDay,
  reorderSessionInDay,
} from "./program-builder-model";
import {
  linkExercises,
  moveExercise,
  moveGroup,
  rowsAreRounds,
  updateGroup,
  type ExerciseDestination,
  type GroupEditResult,
  type GroupSettingsPatch,
  type LinkFormat,
} from "./program-builder-groups";
import { setSpecCount } from "@/utils/exercise-set-specs";
import type { GroupFormat } from "@/utils/exercise-groups";
import {
  PAST_LOCKED,
  insertWeekRefusal,
  moveWeekRefusal,
  planDayRules,
  sessionRefusal,
  slotRefusal,
  type EditableDays,
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
  // Joins the day, after any sessions already on it.
  | { type: "place_session"; slotUid: string; session: SessionDraft; label?: string }
  // Empties the whole day, every session on it.
  | { type: "clear_slot"; slotUid: string; label?: string }
  // One session off its day; the day is rest once it holds none.
  | { type: "remove_session"; sessionUid: string; label?: string }
  // The coach's move rule (moveSessionToDay): onto another day it joins that
  // day, last.
  | { type: "move_session"; sessionUid: string; targetSlotUid: string; label?: string }
  // A session's place among its day's sessions, 0 first (reorderSessionInDay).
  | { type: "reorder_session"; sessionUid: string; toIndex: number; label?: string }
  | {
      type: "update_session";
      sessionUid: string;
      patch: Partial<Omit<SessionDraft, "uid" | "groups">>;
      label?: string;
    }
  // Appends a group to the session: an exercise the assistant adds arrives as
  // a straight-sets group of one, fully materialized with its own uid.
  | { type: "add_exercise"; sessionUid: string; group: ExerciseGroupDraft; label?: string }
  | {
      type: "update_exercise";
      sessionUid: string;
      exerciseUid: string;
      patch: Partial<Omit<ExerciseDraft, "uid">>;
      label?: string;
    }
  | { type: "remove_exercise"; sessionUid: string; exerciseUid: string; label?: string }
  // The group edits (program-builder-groups.ts). Every uid a new group takes
  // rides on the op, minted by the server.
  | {
      // `format` is the group Link makes — a superset or circuit when absent,
      // or a timed format, which takes one exercise or more.
      type: "link_exercises";
      sessionUid: string;
      exerciseUids: string[];
      groupUid: string;
      format?: LinkFormat;
      label?: string;
    }
  | {
      // `to` counts places in the session as it stands before the move;
      // `groupUid` names the group the exercise stands alone in, when it
      // leaves a linked group for a place of its own.
      type: "move_exercise";
      sessionUid: string;
      exerciseUid: string;
      to: ExerciseDestination;
      groupUid: string;
      label?: string;
    }
  | { type: "move_group"; sessionUid: string; groupUid: string; toIndex: number; label?: string }
  | {
      type: "update_group";
      sessionUid: string;
      groupUid: string;
      patch: GroupSettingsPatch;
      label?: string;
    };

// editableDays (the plan editor): the days a coach may change, as positions —
// see program-builder-lock-model. Every op asks the rule of the draft as it
// stands, so the server executor and the client replay, holding the same
// draft and the same two numbers, make the same skip decisions.
export type DraftOpContext = {
  target: BuilderTarget;
  editableDays?: EditableDays;
};

type DraftOpOutcome = { draft: ProgramDraft; skipped?: string };

// Destructive ops never auto-apply on the client — they render as preview
// chips (Apply all / Dismiss). remove_exercise stays auto-apply: it is small,
// visible in the chip ledger, and covered by undo.
export function isDestructiveOp(op: DraftOp): boolean {
  return op.type === "remove_week" || op.type === "clear_slot" || op.type === "remove_session";
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

const hasUid = (draft: ProgramDraft, uid: string): boolean =>
  draft.weeks.some(
    (w) =>
      w.uid === uid ||
      w.days.some(
        (slot) =>
          slot.uid === uid ||
          slot.sessions.some(
            (s) =>
              s.uid === uid ||
              s.groups.some((g) => g.uid === uid || g.exercises.some((e) => e.uid === uid)),
          ),
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
  // failure modes (occupied, vanished) must not mask that it is locked.
  const days = ctx.editableDays;
  const rules = days ? planDayRules(draft.weeks, days, null) : null;
  const slotLocked = (slotUid: string) => (rules ? slotRefusal(rules, slotUid) : null);
  const sessionLocked = (sessionUid: string) =>
    rules ? sessionRefusal(draft, rules, sessionUid) : null;

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
      const index =
        op.afterWeekUid === null
          ? draft.weeks.length - 1
          : draft.weeks.findIndex((w) => w.uid === op.afterWeekUid);
      if (index < 0) {
        return { draft, skipped: "The source week no longer exists" };
      }
      const insertRefused = days && insertWeekRefusal(draft.weeks, days, index, op.week);
      if (insertRefused) return { draft, skipped: insertRefused };
      if (op.afterWeekUid === null) {
        return { draft: { ...draft, weeks: [...draft.weeks, op.week] } };
      }
      const weeks = [...draft.weeks];
      weeks.splice(index + 1, 0, op.week);
      return { draft: { ...draft, weeks } };
    }

    case "remove_week": {
      if (draft.weeks.length <= 1) {
        return { draft, skipped: "A program keeps at least one week" };
      }
      if (rules?.weeks.get(op.weekUid)?.canDelete === false) {
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
      const moveRefused = days && moveWeekRefusal(draft.weeks, days, from, to);
      if (moveRefused) return { draft, skipped: moveRefused };
      return { draft: { ...draft, weeks: arrayMove(draft.weeks, from, to) } };
    }

    case "place_session": {
      const refused = slotLocked(op.slotUid);
      if (refused) return { draft, skipped: refused };
      if (hasUid(draft, op.session.uid)) return { draft, skipped: "Session already added" };
      const placed = addSessionToDay(draft, op.slotUid, op.session);
      return placed.ok ? { draft: placed.draft } : { draft, skipped: placed.reason };
    }

    case "clear_slot": {
      const refused = slotLocked(op.slotUid);
      if (refused) return { draft, skipped: refused };
      let cleared = false;
      const next = mapSlots(draft, (slot) => {
        if (slot.uid !== op.slotUid || slot.sessions.length === 0) return slot;
        cleared = true;
        return { ...slot, sessions: [] };
      });
      if (!cleared) return { draft, skipped: "That day is already a rest day" };
      return { draft: next };
    }

    case "remove_session": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      const next = removeSessionFromDay(draft, op.sessionUid);
      if (next === draft) return { draft, skipped: "That session no longer exists" };
      return { draft: next };
    }

    case "move_session": {
      const refused = slotLocked(op.targetSlotUid) ?? sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      const moved = moveSessionToDay(draft, op.sessionUid, op.targetSlotUid);
      return moved.ok ? { draft: moved.draft } : { draft, skipped: moved.reason };
    }

    case "reorder_session": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      if (!findSessionPlace(draft, op.sessionUid)) {
        return { draft, skipped: "That session no longer exists" };
      }
      return { draft: reorderSessionInDay(draft, op.sessionUid, op.toIndex) };
    }

    case "update_session": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
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
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      if (
        hasUid(draft, op.group.uid) ||
        op.group.exercises.some((e) => hasUid(draft, e.uid))
      ) {
        return { draft, skipped: "Exercise already added" };
      }
      let found = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        found = true;
        return { ...s, groups: [...s.groups, op.group] };
      });
      if (!found) return { draft, skipped: "That session no longer exists" };
      return { draft: next };
    }

    case "update_exercise": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      // Where an exercise's rows are its group's rounds, only the group changes
      // how many there are; an AMRAP's exercise has its one row.
      const group = findSession(draft, op.sessionUid)?.groups.find((g) =>
        g.exercises.some((e) => e.uid === op.exerciseUid),
      );
      const exercise = group?.exercises.find((e) => e.uid === op.exerciseUid);
      if (
        group &&
        exercise &&
        rowsAreRounds(group) &&
        setSpecCount({ ...exercise, ...op.patch }) !== setSpecCount(exercise)
      ) {
        return { draft, skipped: roundsOnGroup(group.format) };
      }
      let found = false;
      let changed = false;
      const next = mapSession(draft, op.sessionUid, (s) =>
        mapSessionExercises(s, (e) => {
          if (e.uid !== op.exerciseUid) return e;
          found = true;
          if (!patchChanges(e, op.patch)) return e;
          changed = true;
          return { ...e, ...op.patch };
        }),
      );
      if (!found) return { draft, skipped: "That exercise no longer exists" };
      return { draft: changed ? next : draft };
    }

    case "remove_exercise": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      let found = false;
      const next = mapSession(draft, op.sessionUid, (s) => {
        const removed = removeSessionExercise(s, op.exerciseUid);
        if (removed !== s) found = true;
        return removed;
      });
      if (!found) return { draft, skipped: "That exercise no longer exists" };
      return { draft: next };
    }

    case "link_exercises": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      if (hasUid(draft, op.groupUid)) return { draft, skipped: "Those exercises are already linked" };
      return editGroups(draft, op.sessionUid, (s) =>
        linkExercises(s, op.exerciseUids, op.groupUid, op.format),
      );
    }

    case "move_exercise": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      if (hasUid(draft, op.groupUid)) return { draft, skipped: "That exercise has already moved" };
      return editGroups(draft, op.sessionUid, (s) =>
        moveExercise(s, op.exerciseUid, op.to, op.groupUid),
      );
    }

    case "move_group": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      return editGroups(draft, op.sessionUid, (s) => moveGroup(s, op.groupUid, op.toIndex));
    }

    case "update_group": {
      const refused = sessionLocked(op.sessionUid);
      if (refused) return { draft, skipped: refused };
      return editGroups(draft, op.sessionUid, (s) => updateGroup(s, op.groupUid, op.patch));
    }
  }
}

const roundsOnGroup = (format: GroupFormat) =>
  format === "amrap"
    ? "That exercise is in an AMRAP — it has one row, the work of one round"
    : "That exercise's rows are its group's rounds, so change the group's rounds instead";

// One group edit on one session: a refusal is the skip reason, and a session
// the edit leaves as it is leaves the draft as it is.
function editGroups(
  draft: ProgramDraft,
  sessionUid: string,
  edit: (session: SessionDraft) => GroupEditResult,
): DraftOpOutcome {
  const session = findSession(draft, sessionUid);
  if (!session) return { draft, skipped: "That session no longer exists" };
  const result = edit(session);
  if (!result.ok) return { draft, skipped: result.reason };
  if (result.session === session) return { draft };
  return { draft: mapSession(draft, sessionUid, () => result.session) };
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
