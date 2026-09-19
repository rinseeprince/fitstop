import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import {
  newUid,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import { findSession } from "@/components/clients/training/program-builder/program-builder-model";
import type {
  GroupSettingsPatch,
  LinkFormat,
} from "@/components/clients/training/program-builder/program-builder-groups";
import {
  DEFAULT_AMRAP_TIME_CAP_SECONDS,
  DEFAULT_EMOM_INTERVAL_SECONDS,
  GROUP_INTERVAL_SECONDS_MAX,
  GROUP_TIME_CAP_SECONDS_MAX,
  sessionExercises,
  type GroupFormat,
} from "@/utils/exercise-groups";
import { groupName, readsAsGroup } from "@/utils/exercise-group-display";
import { MAX_SET_SPECS } from "@/utils/exercise-set-specs";
import {
  COLUMN_PRESET_FIELDS,
  COLUMN_PRESETS,
  type ColumnsPreset,
} from "@/utils/column-presets";
import { PRESCRIBED_FIELD_LABELS } from "@/utils/prescribed-fields";
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

// Group WRITE tools: supersets, circuits, linked straight sets and the timed
// groups — AMRAP, EMOM, For time — the coach's own gestures in the session
// editor: link, add to a group, take out, move a whole group, change its
// settings. Every edit is an op through the shared module
// (program-builder-groups.ts via applyDraftOp), so the rules are the coach's:
// where rounds are a setting every exercise has one set per round, an AMRAP's
// exercises have one set each, a group keeps only the settings its format uses,
// and a straight-sets group of one is a plain exercise while a timed group of
// one reads as a group.

const MAX_POSITION = 50;

// The model names a format in these words; `superset_or_circuit` is the
// builder's `circuit`, named by the count.
const FORMAT_INPUTS = ["superset_or_circuit", "straight_sets", "amrap", "emom", "for_time"] as const;
type FormatInput = (typeof FORMAT_INPUTS)[number];

const toFormat = (input: FormatInput): GroupFormat =>
  input === "superset_or_circuit" ? "circuit" : input;

const groupSettingsProperties = {
  rounds: {
    type: "integer",
    minimum: 1,
    maximum: MAX_SET_SPECS,
    description:
      "Superset/circuit, EMOM and For time: every exercise gets exactly one set per round (an EMOM's rounds are its intervals). Not for straight sets or an AMRAP",
  },
  timeCapSeconds: {
    type: ["integer", "null"],
    minimum: 1,
    maximum: GROUP_TIME_CAP_SECONDS_MAX,
    description: `AMRAP (required; a new one starts at ${DEFAULT_AMRAP_TIME_CAP_SECONDS}) and For time (optional): the time cap in seconds`,
  },
  intervalSeconds: {
    type: ["integer", "null"],
    minimum: 1,
    maximum: GROUP_INTERVAL_SECONDS_MAX,
    description: `EMOM only: the interval in seconds (${DEFAULT_EMOM_INTERVAL_SECONDS} = every minute, the default); work starts on each interval and what is left of it is rest`,
  },
  restBetweenExercisesSeconds: {
    type: ["integer", "null"],
    minimum: 0,
    maximum: 3600,
    description: "Superset/circuit, straight sets and For time; an AMRAP and an EMOM have no rests",
  },
  restBetweenRoundsSeconds: {
    type: ["integer", "null"],
    minimum: 0,
    maximum: 3600,
    description: "Superset/circuit and For time only",
  },
  notes: { type: ["string", "null"], maxLength: 1000 },
  columnsPreset: {
    type: "string",
    enum: [...COLUMN_PRESETS],
    description: `Set every exercise in the group to a column preset's columns: ${COLUMN_PRESETS.map(
      (preset) =>
        `${preset} = ${COLUMN_PRESET_FIELDS[preset].map((f) => PRESCRIBED_FIELD_LABELS[f]).join(", ")}`,
    ).join("; ")}. Where the rows are rounds each exercise keeps its own Rest choice (the group's rests apply).`,
  },
} as const;

type SettingsInput = {
  format?: FormatInput;
  rounds?: number;
  timeCapSeconds?: number | null;
  intervalSeconds?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
  columnsPreset?: ColumnsPreset;
};

function settingsPatch(input: SettingsInput): GroupSettingsPatch {
  const patch: GroupSettingsPatch = {};
  if (input.format !== undefined) patch.format = toFormat(input.format);
  if (input.rounds !== undefined) patch.rounds = input.rounds;
  if (input.timeCapSeconds !== undefined) patch.timeCapSeconds = input.timeCapSeconds;
  if (input.intervalSeconds !== undefined) patch.intervalSeconds = input.intervalSeconds;
  if (input.restBetweenExercisesSeconds !== undefined) {
    patch.restBetweenExercisesSeconds = input.restBetweenExercisesSeconds;
  }
  if (input.restBetweenRoundsSeconds !== undefined) {
    patch.restBetweenRoundsSeconds = input.restBetweenRoundsSeconds;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.columnsPreset !== undefined) patch.columnsPreset = input.columnsPreset;
  return patch;
}

/** The group now holding `exerciseUid`, as the model reads it. */
function describeGroupOf(ws: DraftWorkspace, sessionUid: string, exerciseUid: string): string {
  const session = findSession(ws.draft, sessionUid);
  const at = session && exerciseGroupAt(session, exerciseUid);
  if (!session || !at) return "";
  const first = sessionExercises({ groups: session.groups.slice(0, at.groupIndex) }).length + 1;
  const last = first + at.group.exercises.length - 1;
  return `${groupLine(at.group)} (${first === last ? `position ${first}` : `positions ${first}-${last}`})`;
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

const NOT_IN_A_GROUP =
  "link the exercises with link_exercises (one exercise on its own can be an AMRAP, EMOM or For time).";

export function buildGroupTools(ws: DraftWorkspace) {
  const linkExercises = betaTool({
    name: "link_exercises",
    description:
      "Link exercises into ONE new group, placed where the first of them is, in session order. Formats: superset_or_circuit — a Superset (2 exercises) or Circuit (3+) loops through them for a number of rounds; straight_sets — each one's sets in turn with a rest between exercises; amrap — as many rounds as possible inside timeCapSeconds, one exercise or more, each with ONE set (the work of a round; the client scores rounds + reps); emom — work starts every intervalSeconds for `rounds` intervals, one exercise or more, one set per round, no rests and no cap; for_time — a fixed amount of work, `rounds` rounds with one set per round, as fast as possible, usually with timeCapSeconds (the client scores their finish time). Where rounds are a setting the group gets as many as the exercise with the most sets, the others gaining copies of their last set; an AMRAP fits every exercise to one set. A new AMRAP starts with a 10-minute cap and a new EMOM at every minute unless you pass them. Pass rounds, timeCapSeconds, intervalSeconds, rests and notes to set them in the same call. An exercise already in a group leaves it. To add to an existing group, use add_to_group instead.",
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
          description: "Two or more for a superset, circuit or straight sets; one or more for an AMRAP, EMOM or For time",
        },
        format: { type: "string", enum: [...FORMAT_INPUTS] },
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
      const format = toFormat(input.format ?? "superset_or_circuit");
      const linkFormat: LinkFormat = format === "straight_sets" ? "circuit" : format;
      if (linkFormat === "circuit" && picked.uids.length < 2) {
        return "Name at least two different exercises for a superset, circuit or straight sets — one exercise on its own can be an AMRAP, EMOM or For time (format).";
      }
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
        format: linkFormat,
        label: `W${input.week} D${input.day}: linked ${picked.names.join(", ")}`,
      });
      if (err) return err;
      const patch = settingsPatch(input);
      // The link already made the format; the patch carries the rest.
      if (patch.format === linkFormat) delete patch.format;
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
      "Move an exercise into the group that groupExercisePosition belongs to — a superset, circuit, straight-sets group, AMRAP, EMOM or For time — at the end of it. Where the rows are rounds it takes the group's rounds (copies of its last set are added, or its last sets removed); in an AMRAP it is fitted to one set.",
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
      if (!target || !readsAsGroup(target.group)) {
        return `Position ${input.groupExercisePosition} isn't in a group — ${NOT_IN_A_GROUP}`;
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
      "Take exercises out of their group; each becomes a standalone exercise keeping its sets — the group's first exercise goes just before the group, any other just after it. Name every exercise of a group to break the whole group up. A group left with one exercise becomes a plain exercise; a timed group of one (an AMRAP, EMOM or For time) taken out becomes a plain exercise in place.",
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
      const inGroup = (s: SessionDraft, uid: string) => {
        const at = exerciseGroupAt(s, uid);
        return at && readsAsGroup(at.group) ? at : null;
      };
      const standalone = picked.uids.filter((uid) => inGroup(session.value, uid) === null);
      if (standalone.length === picked.uids.length) {
        return "None of those exercises is in a group.";
      }
      for (const [i, uid] of picked.uids.entries()) {
        if (standalone.includes(uid)) continue;
        // Worked out on the working copy as it now stands: an earlier exercise
        // this call took out may have changed the group, or dissolved it.
        const now = findSession(ws.draft, session.value.uid);
        const at = now && inGroup(now, uid);
        if (!at) continue;
        const err =
          at.group.exercises.length < 2
            ? // A timed group of one: back to a plain exercise, in place.
              commitOp(ws, {
                type: "update_group",
                sessionUid: session.value.uid,
                groupUid: at.group.uid,
                patch: { format: "straight_sets" },
                label: `W${input.week} D${input.day}: ${picked.names[i]} out of its ${groupName(at.group.format, 1).toLowerCase()}`,
              })
            : commitOp(ws, {
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
      "Move a whole group — a superset, circuit, straight-sets group, AMRAP, EMOM or For time (name any exercise in it) — so it starts at toPosition. It goes to the nearest place that splits no other group. A standalone exercise moves the same way.",
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
        label: `W${input.week} D${input.day}: moved ${readsAsGroup(at.group) ? `the ${groupName(at.group.format, at.group.exercises.length).toLowerCase()}` : first.name} to position ${input.toPosition}`,
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
      "Change a group's settings (name any exercise in it): format (superset_or_circuit, straight_sets, amrap, emom or for_time), rounds, timeCapSeconds, intervalSeconds, rest between exercises, rest between rounds, notes, or a column preset for every exercise in it (columnsPreset). Changing rounds adds a copy of every exercise's last set or removes every exercise's last set. Each format keeps only the settings it uses and refuses the others: straight sets have no rounds, cap or interval (switching to them keeps every exercise's sets); a superset or circuit has no cap or interval; an AMRAP has its cap and notes only, every exercise fitted to one set; an EMOM has its interval, rounds and notes; a For time has rounds, an optional cap, rests and notes.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        exercisePosition: { type: "integer", minimum: 1 },
        format: { type: "string", enum: [...FORMAT_INPUTS] },
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
      if (!at || !readsAsGroup(at.group)) {
        return `"${ref.value.exercise.name}" isn't in a group — ${NOT_IN_A_GROUP}`;
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
