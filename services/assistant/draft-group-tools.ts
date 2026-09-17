import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import {
  newUid,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import { findSession } from "@/components/clients/training/program-builder/program-builder-model";
import type { GroupSettingsPatch } from "@/components/clients/training/program-builder/program-builder-groups";
import { sessionExercises } from "@/utils/exercise-groups";
import { groupName } from "@/utils/exercise-group-display";
import { MAX_SET_SPECS } from "@/utils/exercise-set-specs";
import type { DraftWorkspace } from "./draft-workspace";
import {
  boundaryIndex,
  commitOp,
  exerciseGroupAt,
  exercisePositionNow,
  groupLine,
  resolveExerciseRef,
  resolveSession,
  sessionPlaceProperty,
} from "./draft-tool-helpers";

// Group WRITE tools: supersets, circuits and linked straight sets, the coach's
// own gestures in the session editor — link, add to a group, take out, move a
// whole group, change its settings. Every edit is an op through the shared
// module (program-builder-groups.ts via applyDraftOp), so the rules are the
// coach's: in a superset or circuit every exercise has one set per round, and
// a group of one is a plain exercise.

const MAX_POSITION = 50;

const groupSettingsProperties = {
  rounds: {
    type: "integer",
    minimum: 1,
    maximum: MAX_SET_SPECS,
    description: "Superset/circuit only: every exercise gets exactly one set per round",
  },
  restBetweenExercisesSeconds: { type: ["integer", "null"], minimum: 0, maximum: 3600 },
  restBetweenRoundsSeconds: {
    type: ["integer", "null"],
    minimum: 0,
    maximum: 3600,
    description: "Superset/circuit only",
  },
  notes: { type: ["string", "null"], maxLength: 1000 },
} as const;

type SettingsInput = {
  format?: "superset_or_circuit" | "straight_sets";
  rounds?: number;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
};

function settingsPatch(input: SettingsInput): GroupSettingsPatch {
  const patch: GroupSettingsPatch = {};
  if (input.format !== undefined) {
    patch.format = input.format === "straight_sets" ? "straight_sets" : "circuit";
  }
  if (input.rounds !== undefined) patch.rounds = input.rounds;
  if (input.restBetweenExercisesSeconds !== undefined) {
    patch.restBetweenExercisesSeconds = input.restBetweenExercisesSeconds;
  }
  if (input.restBetweenRoundsSeconds !== undefined) {
    patch.restBetweenRoundsSeconds = input.restBetweenRoundsSeconds;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  return patch;
}

/** The group now holding `exerciseUid`, as the model reads it. */
function describeGroupOf(ws: DraftWorkspace, sessionUid: string, exerciseUid: string): string {
  const session = findSession(ws.draft, sessionUid);
  const at = session && exerciseGroupAt(session, exerciseUid);
  if (!session || !at) return "";
  const first = sessionExercises({ groups: session.groups.slice(0, at.groupIndex) }).length + 1;
  const last = first + at.group.exercises.length - 1;
  return `${groupLine(at.group)} (positions ${first}-${last})`;
}

/** Resolve 1-based positions to distinct exercises of the session, or an error. */
function resolvePositions(
  session: SessionDraft,
  positions: number[],
): { ok: true; uids: string[]; names: string[] } | { ok: false; error: string } {
  const exercises = sessionExercises(session);
  const uids: string[] = [];
  const names: string[] = [];
  for (const position of positions) {
    const exercise = exercises[position - 1];
    if (!exercise) {
      return {
        ok: false,
        error: `"${session.name}" has ${exercises.length} exercise(s) — position ${position} doesn't exist.`,
      };
    }
    if (uids.includes(exercise.uid)) continue;
    uids.push(exercise.uid);
    names.push(exercise.name);
  }
  return { ok: true, uids, names };
}

export function buildGroupTools(ws: DraftWorkspace) {
  const linkExercises = betaTool({
    name: "link_exercises",
    description:
      "Link exercises into ONE new group, placed where the first of them is, in session order: a Superset (2 exercises) or Circuit (3+) loops through them for a number of rounds; straight sets does each one's sets in turn with a rest between exercises. The group gets as many rounds as the exercise with the most sets, the others gaining copies of their last set; pass rounds, rests and notes to set them in the same call. An exercise already in a group leaves it. To add to an existing group, use add_to_group instead.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePositions: {
          type: "array",
          minItems: 2,
          maxItems: MAX_POSITION,
          items: { type: "integer", minimum: 1, maximum: MAX_POSITION },
        },
        format: { type: "string", enum: ["superset_or_circuit", "straight_sets"] },
        ...groupSettingsProperties,
      },
      required: ["week", "day", "exercisePositions"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const picked = resolvePositions(session.value, input.exercisePositions);
      if (!picked.ok) return picked.error;
      if (picked.uids.length < 2) return "Name at least two different exercises to link.";
      if (
        input.format === "straight_sets" &&
        (input.rounds !== undefined || input.restBetweenRoundsSeconds != null)
      ) {
        return "Straight sets have no rounds and no rest between rounds — leave those out, or link them as a superset or circuit.";
      }
      const groupUid = newUid("grp");
      const err = commitOp(ws, {
        type: "link_exercises",
        sessionUid: session.value.uid,
        exerciseUids: picked.uids,
        groupUid,
        label: `W${input.week} D${input.day}: linked ${picked.names.join(", ")}`,
      });
      if (err) return err;
      const patch = settingsPatch(input);
      if (Object.keys(patch).length > 0) {
        const settingsErr = commitOp(ws, {
          type: "update_group",
          sessionUid: session.value.uid,
          groupUid,
          patch,
          label: `W${input.week} D${input.day}: set the new group's settings`,
        });
        if (settingsErr) {
          return `Linked ${picked.names.join(", ")}, but couldn't set the group's settings: ${settingsErr}`;
        }
      }
      return `Linked them: ${describeGroupOf(ws, session.value.uid, picked.uids[0])}.`;
    },
  });

  const addToGroup = betaTool({
    name: "add_to_group",
    description:
      "Move an exercise into the superset, circuit or straight-sets group that groupExercisePosition belongs to, at the end of it. In a superset or circuit it takes the group's rounds: copies of its last set are added, or its last sets removed.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePosition: { type: "integer", minimum: 1, description: "The exercise to move" },
        exerciseName: { type: "string", maxLength: 200 },
        groupExercisePosition: {
          type: "integer",
          minimum: 1,
          description: "Any exercise already in the target group",
        },
      },
      required: ["week", "day", "groupExercisePosition"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const anchor = resolveExerciseRef(session.value, { exercisePosition: input.groupExercisePosition });
      if (!anchor.ok) return anchor.error;
      const target = exerciseGroupAt(session.value, anchor.value.exercise.uid);
      if (!target || target.group.exercises.length < 2) {
        return `Position ${input.groupExercisePosition} isn't in a superset, circuit or straight-sets group — link the exercises with link_exercises instead.`;
      }
      if (target.group.exercises.some((e) => e.uid === ref.value.exercise.uid)) {
        return `"${ref.value.exercise.name}" is already in that group.`;
      }
      const err = commitOp(ws, {
        type: "move_exercise",
        sessionUid: session.value.uid,
        exerciseUid: ref.value.exercise.uid,
        to: { kind: "group", groupUid: target.group.uid, index: target.group.exercises.length },
        groupUid: newUid("grp"),
        label: `W${input.week} D${input.day}: ${ref.value.exercise.name} into the ${groupName(target.group.format, target.group.exercises.length + 1).toLowerCase()}`,
      });
      if (err) return err;
      return `Added "${ref.value.exercise.name}": ${describeGroupOf(ws, session.value.uid, ref.value.exercise.uid)}.`;
    },
  });

  const unlinkExercises = betaTool({
    name: "unlink_exercises",
    description:
      "Take exercises out of their superset, circuit or straight-sets group; each becomes a standalone exercise keeping its sets — the group's first exercise goes just before the group, any other just after it. Name every exercise of a group to break the whole group up. A group left with one exercise becomes a plain exercise.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePositions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_POSITION,
          items: { type: "integer", minimum: 1, maximum: MAX_POSITION },
        },
      },
      required: ["week", "day", "exercisePositions"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const picked = resolvePositions(session.value, input.exercisePositions);
      if (!picked.ok) return picked.error;
      const standalone = picked.uids.filter(
        (uid) => (exerciseGroupAt(session.value, uid)?.group.exercises.length ?? 0) < 2,
      );
      if (standalone.length === picked.uids.length) {
        return "None of those exercises is in a group.";
      }
      for (const [i, uid] of picked.uids.entries()) {
        if (standalone.includes(uid)) continue;
        // Worked out on the working copy as it now stands: an earlier exercise
        // this call took out may have changed the group, or dissolved it.
        const now = findSession(ws.draft, session.value.uid);
        const at = now && exerciseGroupAt(now, uid);
        if (!at || at.group.exercises.length < 2) continue;
        const err = commitOp(ws, {
          type: "move_exercise",
          sessionUid: session.value.uid,
          exerciseUid: uid,
          to: { kind: "session", index: at.index === 0 ? at.groupIndex : at.groupIndex + 1 },
          groupUid: newUid("grp"),
          label: `W${input.week} D${input.day}: ${picked.names[i]} out of its group`,
        });
        if (err) return err;
      }
      const skipped =
        standalone.length > 0
          ? ` (${standalone.length} named exercise(s) weren't in a group.)`
          : "";
      return `Took ${picked.names.filter((_, i) => !standalone.includes(picked.uids[i])).join(", ")} out of their group.${skipped}`;
    },
  });

  const moveGroup = betaTool({
    name: "move_group",
    description:
      "Move a whole superset, circuit or straight-sets group (name any exercise in it) so it starts at toPosition. It goes to the nearest place that splits no other group. A standalone exercise moves the same way.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePosition: { type: "integer", minimum: 1 },
        toPosition: { type: "integer", minimum: 1, maximum: MAX_POSITION },
      },
      required: ["week", "day", "exercisePosition", "toPosition"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, { exercisePosition: input.exercisePosition });
      if (!ref.ok) return ref.error;
      const at = exerciseGroupAt(session.value, ref.value.exercise.uid);
      if (!at) return "That exercise no longer exists.";
      const first = at.group.exercises[0];
      const err = commitOp(ws, {
        type: "move_group",
        sessionUid: session.value.uid,
        groupUid: at.group.uid,
        toIndex: boundaryIndex(session.value, at.groupIndex, input.toPosition),
        label: `W${input.week} D${input.day}: moved ${at.group.exercises.length > 1 ? `the ${groupName(at.group.format, at.group.exercises.length).toLowerCase()}` : first.name} to position ${input.toPosition}`,
      });
      if (err) return err;
      const landed = exercisePositionNow(ws, session.value.uid, first.uid);
      return landed === input.toPosition
        ? `Moved it to start at position ${landed}.`
        : `It starts at position ${landed ?? "?"}, not ${input.toPosition}: groups stay whole, so it went to the nearest place that splits none.`;
    },
  });

  const updateGroup = betaTool({
    name: "update_group",
    description:
      "Change a linked group's settings (name any exercise in it): format (superset_or_circuit or straight_sets), rounds, rest between exercises, rest between rounds, notes. Changing rounds adds a copy of every exercise's last set or removes every exercise's last set. Straight sets have no rounds and no rest between rounds; switching to them keeps every exercise's sets.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePosition: { type: "integer", minimum: 1 },
        format: { type: "string", enum: ["superset_or_circuit", "straight_sets"] },
        ...groupSettingsProperties,
      },
      required: ["week", "day", "exercisePosition"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, { exercisePosition: input.exercisePosition });
      if (!ref.ok) return ref.error;
      const at = exerciseGroupAt(session.value, ref.value.exercise.uid);
      if (!at || at.group.exercises.length < 2) {
        return `"${ref.value.exercise.name}" isn't in a group — link it first with link_exercises.`;
      }
      const patch = settingsPatch(input);
      if (Object.keys(patch).length === 0) return "Nothing to change — pass at least one setting.";
      const err = commitOp(ws, {
        type: "update_group",
        sessionUid: session.value.uid,
        groupUid: at.group.uid,
        patch,
        label: `W${input.week} D${input.day}: changed the ${groupName(at.group.format, at.group.exercises.length).toLowerCase()}`,
      });
      if (err) return err;
      return `Updated: ${describeGroupOf(ws, session.value.uid, ref.value.exercise.uid)}.`;
    },
  });

  return [linkExercises, addToGroup, unlinkExercises, moveGroup, updateGroup];
}
