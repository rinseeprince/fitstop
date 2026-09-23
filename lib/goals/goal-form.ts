import { GOAL_TYPE_SETTINGS, type GoalMetric, type GoalType } from "./goal-types";
import type { GoalOnDay } from "@/types/client-goals";

/**
 * The goal form's rules (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2): which
 * targets it shows, and which writes a save makes. Pure — the goals sheet and
 * the Add-client form share it, and the goal routes enforce the same model.
 */

/** What a goal form holds when it saves. Kilograms and percent, canonical. */
export type GoalDraft = {
  type: GoalType;
  name: string;
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  description: string;
  /** The day it starts. A goal that has started keeps its own. */
  startsOn: string | null;
  deadline: string | null;
};

/** A goal's fields as a route takes them. */
export type GoalBody = {
  type: GoalType;
  name: string;
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  description: string | null;
  deadline: string | null;
};

export type GoalWrite =
  /** A goal from `startsOn` — today's replaces the current one. */
  | { kind: "add"; body: GoalBody & { startsOn: string } }
  /** A planned goal, or today's, rewritten whole. */
  | { kind: "edit"; goalId: string; body: GoalBody & { startsOn: string } }
  | { kind: "deadline"; goalId: string; deadline: string | null }
  | { kind: "rename"; goalId: string; name: string; description: string | null };

/**
 * The targets the form shows: the one the type needs, and any the goal being
 * edited already holds — so a target the type does not ask for is never
 * dropped unseen.
 */
export function goalFormTargets(
  type: GoalType | null,
  stored: Pick<GoalOnDay, "targetWeight" | "targetBodyFatPercentage"> | null
): Record<GoalMetric, boolean> {
  const needed = type ? GOAL_TYPE_SETTINGS[type].target : null;
  return {
    weight: needed === "weight" || stored?.targetWeight != null,
    bodyFat: needed === "bodyFat" || stored?.targetBodyFatPercentage != null,
  };
}

/** The draft as a route takes it: a blank name is the type's, a blank description none. */
export function goalBody(draft: GoalDraft): GoalBody {
  const name = draft.name.trim();
  const description = draft.description.trim();
  return {
    type: draft.type,
    name: name === "" ? GOAL_TYPE_SETTINGS[draft.type].name : name,
    targetWeight: draft.targetWeight,
    targetBodyFatPercentage: draft.targetBodyFatPercentage,
    description: description === "" ? null : description,
    deadline: draft.deadline,
  };
}

/**
 * A goal that has started keeps its type and targets: changing either makes a
 * new goal from today, and the one it replaces ends yesterday.
 */
export function startsNewGoal(
  stored: GoalOnDay,
  draft: Pick<GoalDraft, "type" | "targetWeight" | "targetBodyFatPercentage">,
  today: string
): boolean {
  if (stored.startsOn >= today) return false;
  return (
    draft.type !== stored.type ||
    draft.targetWeight !== stored.targetWeight ||
    draft.targetBodyFatPercentage !== stored.targetBodyFatPercentage
  );
}

/**
 * The writes a save makes, in order — none when nothing changed.
 *
 * A new goal is one add. A planned goal, or today's, is one whole rewrite:
 * today's keeps today as its start. A goal that started before today changes
 * only its deadline and its labels, each its own write — the deadline first,
 * since it is the one a date rule can refuse, so a refusal lands nothing —
 * unless its type or a target changed, which is a new goal from today.
 */
export function goalSaveWrites({
  stored,
  draft,
  today,
}: {
  /** The goal being edited, as it stands today; null for a new one. */
  stored: GoalOnDay | null;
  draft: GoalDraft;
  /** The client's calendar day. */
  today: string;
}): GoalWrite[] {
  const body = goalBody(draft);

  if (!stored) return [{ kind: "add", body: { ...body, startsOn: draft.startsOn ?? today } }];

  if (stored.startsOn >= today) {
    const startsOn = stored.startsOn === today ? today : (draft.startsOn ?? stored.startsOn);
    const unchanged =
      body.type === stored.type &&
      body.name === stored.name &&
      body.targetWeight === stored.targetWeight &&
      body.targetBodyFatPercentage === stored.targetBodyFatPercentage &&
      body.description === stored.description &&
      body.deadline === stored.deadline &&
      startsOn === stored.startsOn;
    return unchanged ? [] : [{ kind: "edit", goalId: stored.id, body: { ...body, startsOn } }];
  }

  if (startsNewGoal(stored, draft, today)) {
    return [{ kind: "add", body: { ...body, startsOn: today } }];
  }

  const writes: GoalWrite[] = [];
  if (body.deadline !== stored.deadline) {
    writes.push({ kind: "deadline", goalId: stored.id, deadline: body.deadline });
  }
  if (body.name !== stored.name || body.description !== stored.description) {
    writes.push({ kind: "rename", goalId: stored.id, name: body.name, description: body.description });
  }
  return writes;
}
