import type { LogTrainingEventInput } from "@/lib/validations/training";
import type { LoggedQuality } from "@/types/training";
import type {
  ExerciseLog,
  GroupScore,
  ResolvedExerciseGroup,
  SessionLog,
} from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import { expandSetSpecs, TEMPO_PATTERN } from "@/utils/exercise-set-specs";
import {
  buildPrescribedRows,
  MAX_PRESCRIBED_ROWS,
  type PrescribedRow,
} from "@/utils/set-spec-rows";
import {
  summariseCompletion,
  type ScoredExercise,
} from "@/utils/completion-quality";
import { trainingLogRecordsWork } from "@/lib/training-log-content";
import {
  formatDuration,
  formatEntry,
  parseDuration,
  parseEntry,
  type UnitSystem,
} from "@/utils/unit-conversions";
import {
  GROUP_SCORE_FINISH_SCALE,
  GROUP_SCORE_FINISH_SECONDS_MAX,
  GROUP_SCORE_FINISH_SECONDS_MIN,
  GROUP_SCORE_REPS_MAX,
  GROUP_SCORE_ROUNDS_MAX,
  takesScore,
  type GroupScoreValue,
} from "@/utils/group-scores";
import {
  boxEntry,
  boxKey,
  emptyLoggedActuals,
  LOGGED_BOXES,
  pickLoggedActuals,
  SET_LOG_MEASURES,
  type ActualKey,
  type LoggedActuals,
  type LoggedBox,
} from "@/utils/set-log-measures";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetRowValues = {
  /**
   * "I did this set." The ONLY thing that decides completion (locked decision
   * 1): buildLogPayload sends exactly the ticked rows and nothing else, and a
   * ticked row with every box empty is still sent, because doing the work is
   * the claim and recording numbers is a bonus (decision 3).
   */
  completed: boolean;
  /**
   * What is in each box — one per column the coach prescribes — in the
   * viewer's units and the box's own entry grammar ("5.2 km", "4:45 /km",
   * "2:00:00"; utils/unit-conversions.ts). Keyed by the column, so the grid
   * walks the exercise's prescribed columns straight into the form.
   */
  entries: Record<LoggedBox, string>;
  /**
   * The canonical value each box was SEEDED from, kept beside the string it
   * produced — null where nothing was recorded. The string is rounded and
   * reformatted for reading, so re-parsing an untouched box would not land
   * back on its value (a set logged at 100 kg seeds "220.5" for an imperial
   * client and parses back to 100.02). An untouched box resubmits its seed
   * byte-identical — the weight rule (CONVENTIONS section 20), applied to every
   * box — and a value with no box on screen, because the coach has since
   * stopped prescribing that column or the React Native app's timer recorded
   * the rest taken, rides through the seed unchanged. That is what makes a save
   * never erase a value: the write path full-replaces the log's sets.
   */
  seeds: LoggedActuals;
};

export type ExerciseFormValues = {
  trainingExerciseId: string;
  exerciseId?: string;
  exerciseName: string;
  prescribedName?: string;
  isSwapped: boolean;
  notes: string;
  sets: SetRowValues[];
  isUnplanned: boolean;
};

/** The boxes a timed group's score is typed into. */
export type ScoreBox = "rounds" | "reps" | "finishTime";

export const SCORE_BOX_LABELS: Record<ScoreBox, string> = {
  rounds: "Rounds",
  reps: "Reps",
  finishTime: "Finish time",
};

/**
 * A timed group's score as the form holds it (utils/group-scores.ts): one
 * entry per group that takes a score, in session order. An AMRAP's boxes are
 * rounds and reps. A For time's is a finish time, or — `capped`, the client's
 * "Didn't finish" — rounds and reps. The strings are the boxes' own; a finish
 * time is typed as a duration ("8:32", "8:32.5") and reads back at the stored
 * tenth, so re-parsing an untouched box is an exact no-op and it needs no seed
 * (CONVENTIONS section 20's guard exists for a display that rounds).
 */
export type GroupScoreFormValues = {
  groupId: string;
  format: "amrap" | "for_time";
  capped: boolean;
  rounds: string;
  reps: string;
  finishTime: string;
};

// No `completionQuality`. The client no longer claims one — it is derived from
// the ticks (resolveLogOutcome) at the moment the payload is built, so a stored
// form field could only ever be a second answer to a question the ticks have
// already settled.
export type LogFormValues = {
  notes: string;
  exercises: ExerciseFormValues[];
  groupScores: GroupScoreFormValues[];
};

/**
 * The groups that take a score, in session order, each seeded from the log's
 * score for it — by the group's id, which a live group and a group read off a
 * snapshot both carry. A score whose group the workout no longer shows has no
 * entry: nothing on screen could edit it.
 */
export function seedGroupScores(
  groups: ResolvedExerciseGroup[],
  scores: GroupScore[],
): GroupScoreFormValues[] {
  const byGroup = new Map(scores.flatMap((s) => (s.groupId ? [[s.groupId, s] as const] : [])));
  return groups.flatMap((group) => {
    if (!takesScore(group.format)) return [];
    const score = byGroup.get(group.id) ?? null;
    const format = group.format;
    if (score === null) {
      return [{ groupId: group.id, format, capped: false, rounds: "", reps: "", finishTime: "" }];
    }
    if (score.finishSeconds !== null) {
      return [
        {
          groupId: group.id,
          format,
          capped: false,
          rounds: "",
          reps: "",
          finishTime: formatDuration(score.finishSeconds),
        },
      ];
    }
    return [
      {
        groupId: group.id,
        format,
        // Rounds and reps on a For time is the capped shape.
        capped: format === "for_time",
        rounds: String(score.rounds),
        reps: String(score.reps),
        finishTime: "",
      },
    ];
  });
}

/** Whether a score's boxes take rounds and reps (else a finish time). */
export function scoreTakesRounds(score: Pick<GroupScoreFormValues, "format" | "capped">): boolean {
  return score.format === "amrap" || score.capped;
}

/**
 * Does this entry hold a score? Both rounds and reps, or a finish time — the
 * live outcome line asks this; whether the boxes can be READ is the save's
 * question (`parseGroupScore`).
 */
function scoreEntered(score: GroupScoreFormValues): boolean {
  return scoreTakesRounds(score)
    ? score.rounds.trim() !== "" && score.reps.trim() !== ""
    : score.finishTime.trim() !== "";
}

type ParsedScore =
  /** `null` is no score: every box of the shape empty. */
  | { ok: true; score: GroupScoreValue | null }
  | { ok: false; box: ScoreBox };

const WHOLE_NUMBER = /^\d+$/;

function parseCount(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= max ? value : null;
}

/**
 * The boxes as a score: rounds and reps both whole numbers within their limit,
 * or a finish time the duration grammar reads within a day, to a tenth. A box
 * that can't be read is named, so the save can mark and focus it; a shape with
 * one box filled and the other empty names the empty one.
 */
export function parseGroupScore(values: GroupScoreFormValues): ParsedScore {
  if (scoreTakesRounds(values)) {
    const roundsText = values.rounds.trim();
    const repsText = values.reps.trim();
    if (roundsText === "" && repsText === "") return { ok: true, score: null };
    if (roundsText === "") return { ok: false, box: "rounds" };
    if (repsText === "") return { ok: false, box: "reps" };
    const rounds = parseCount(roundsText, GROUP_SCORE_ROUNDS_MAX);
    if (rounds === null) return { ok: false, box: "rounds" };
    const reps = parseCount(repsText, GROUP_SCORE_REPS_MAX);
    if (reps === null) return { ok: false, box: "reps" };
    return { ok: true, score: { rounds, reps, finishSeconds: null } };
  }
  const text = values.finishTime.trim();
  if (text === "") return { ok: true, score: null };
  const seconds = parseDuration(text);
  if (
    seconds === null ||
    seconds < GROUP_SCORE_FINISH_SECONDS_MIN ||
    seconds > GROUP_SCORE_FINISH_SECONDS_MAX
  ) {
    return { ok: false, box: "finishTime" };
  }
  const scaled = seconds * 10 ** GROUP_SCORE_FINISH_SCALE;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return { ok: false, box: "finishTime" };
  return { ok: true, score: { rounds: null, reps: null, finishSeconds: seconds } };
}

function emptyEntries(): Record<LoggedBox, string> {
  return Object.fromEntries(LOGGED_BOXES.map((box) => [box, ""])) as Record<LoggedBox, string>;
}

export function emptySet(): SetRowValues {
  return { completed: false, entries: emptyEntries(), seeds: emptyLoggedActuals() };
}

/** The boxes' strings for a set's canonical values — what a logged set reopens as. */
function entriesFromActuals(
  actuals: LoggedActuals,
  viewer: UnitSystem,
): Record<LoggedBox, string> {
  const entries = emptyEntries();
  for (const box of LOGGED_BOXES) {
    const value = actuals[boxKey(box)];
    entries[box] = value == null ? "" : formatEntry(boxEntry(box), value, viewer);
  }
  return entries;
}

/** Does any box of this row hold something? The auto-tick and Copy previous ask it. */
export function isRowFilled(row: Pick<SetRowValues, "entries"> | undefined): boolean {
  if (!row) return false;
  return LOGGED_BOXES.some((box) => row.entries[box]?.trim());
}

/**
 * A prescription view flattened to the rows the client logs against.
 *
 * The ONE translation from a `PrescribedExerciseView` to `PrescribedRow[]`. The
 * renderer, the seed and the outcome line all ask this question, and a second
 * answer would put the grid's row list, the set numbers on the wire and the
 * count above the button out of step with each other.
 */
export function prescribedRowsForView(
  view: PrescribedExerciseView,
): PrescribedRow[] {
  // expandSetSpecs clamps to a floor of ONE spec, so it cannot represent
  // "nothing prescribed" — that state has to be caught before calling it or a
  // zero-set exercise grows a phantom row.
  if ((view.setSpecs?.length ?? 0) === 0 && view.sets <= 0) return [];
  return buildPrescribedRows(
    expandSetSpecs({
      setSpecs: view.setSpecs ?? null,
      sets: view.sets,
      repsMin: view.repsMin ?? null,
      repsMax: view.repsMax ?? null,
      repsTarget: view.repsTarget ?? null,
      rpeTarget: view.rpeTarget ?? null,
      restSeconds: view.restSeconds ?? null,
    }),
  );
}

/**
 * Prescriptions indexed by the form's exercise position. `null`/absent where
 * there is nothing to score against — an unplanned exercise the client added, or
 * an orphan log sitting past the prescribed prefix.
 */
export type PrescribedRowsByIndex = readonly (
  | PrescribedRow[]
  | null
  | undefined
)[];

/**
 * Pair the form's ticks with the prescription they were ticked against.
 *
 * An unplanned exercise contributes to NEITHER half, matching the server: it has
 * no prescription, so it can neither raise nor lower how much of the session was
 * completed.
 */
function scoreFormExercises(
  exercises: ExerciseFormValues[],
  prescribedRows: PrescribedRowsByIndex,
): ScoredExercise[] {
  return exercises.flatMap((ex, exerciseIndex) => {
    if (ex.isUnplanned) return [];
    const rows = prescribedRows[exerciseIndex];
    if (!rows) return [];
    return [
      {
        prescribedRows: rows,
        completedSetNumbers: ex.sets.flatMap((set, setIndex) =>
          set.completed ? [setIndex + 1] : [],
        ),
      },
    ];
  });
}

type LogOutcome = {
  completedWorkingSets: number;
  prescribedWorkingSets: number;
  /** The groups that take a score, and how many hold one. */
  scoringGroups: number;
  scoredGroups: number;
  /** What this form would be recorded as, or null when it records nothing. */
  quality: LoggedQuality | null;
};

/**
 * What this form will be recorded as, and the count that explains it.
 *
 * ONE function, because the sentence above the button ("9 of 12 working sets
 * logged. Will be recorded as partial.") is a promise about the value
 * buildLogPayload puts on the wire. Two derivations could disagree, and the
 * client would be the one telling the lie.
 *
 * `null` means the form records nothing — no set ticked, no group scored —
 * and the save is refused, on this screen and on the server, by the one rule
 * (`lib/training-log-content.ts`). A client who did not train logs nothing;
 * one who saved by mistake clears the log.
 *
 * The `full` fallback covers a session with nothing scorable prescribed — no
 * exercises at all, only warm-ups, or only timed groups whose rows are left
 * out of the count until commit 15 — where `summariseCompletion` returns null
 * and the server defers to this value: a client who ticked or scored anything
 * there did everything there was to do.
 */
export function resolveLogOutcome(
  exercises: ExerciseFormValues[],
  prescribedRows: PrescribedRowsByIndex,
  groupScores: GroupScoreFormValues[],
): LogOutcome {
  const summary = summariseCompletion(
    scoreFormExercises(exercises, prescribedRows),
  );
  const ticked = exercises.some((ex) => ex.sets.some((set) => set.completed));
  const scoredGroups = groupScores.filter(scoreEntered).length;
  return {
    completedWorkingSets: summary.completedWorkingSets,
    prescribedWorkingSets: summary.prescribedWorkingSets,
    scoringGroups: groupScores.length,
    scoredGroups,
    quality: ticked || scoredGroups > 0 ? (summary.quality ?? "full") : null,
  };
}

export type LogPayloadResult =
  | { ok: true; payload: LogTrainingEventInput }
  /** Nothing ticked: the save is refused with the one sentence. */
  | { ok: false; reason: "nothing" }
  /** A box holds something the grammar can't read, or a value outside its column's limit. */
  | { ok: false; reason: "unreadable"; exerciseIndex: number; setIndex: number; box: LoggedBox }
  /** A score box can't be read, or its partner is empty. */
  | { ok: false; reason: "unreadable-score"; groupIndex: number; box: ScoreBox };

/** Within the column's limit and at its scale — the wire schema's rule, asked here so the box can be named. */
function withinLimit(box: LoggedBox, value: number | string): boolean {
  if (box === "tempo") return typeof value === "string" && TEMPO_PATTERN.test(value);
  if (typeof value !== "number") return false;
  const { floor, ceiling, integer, scale } = SET_LOG_MEASURES[box];
  if (value < floor || value > ceiling) return false;
  if (integer) return Number.isInteger(value);
  const scaled = value * 10 ** scale;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Build the wire payload, converting to canonical units HERE rather than
 * sending the client's display unit and a tag for the server to apply.
 *
 * Refused, rather than stored as a skip, when the form records no work —
 * nothing ticked — and the server refuses the same payload through the same
 * rule, so the screen and the wire agree. Refused with the box named when a
 * box can't be read or its value is outside its column's limit, so the client
 * is sent to the box rather than told "some inputs are invalid".
 *
 * Every box is judged PER BOX, never per row: a row is dirty the moment its
 * reps change, and under a row-level rule its untouched distance would
 * round-trip through the display string. An untouched box resubmits the exact
 * canonical value it was seeded with; a dirty one is parsed from what is in it.
 * A value with no box on screen rides through its seed, so a save never erases
 * one.
 *
 * `weightUnit` therefore leaves as "kg" always. The wire schema still carries it
 * (lib/validations/training.ts) and the writer still applies it, so any other
 * caller — the React Native client — is unaffected.
 *
 * Both lists always travel, empty included: a list that is present replaces
 * what the log holds, so a client who unticks every row and keeps a score has
 * the sets cleared, and one who clears a score box has the score removed.
 */
export function buildLogPayload(
  values: LogFormValues,
  viewer: UnitSystem,
  isDirty: (exerciseIndex: number, setIndex: number, box: LoggedBox) => boolean,
  prescribedRows: PrescribedRowsByIndex,
): LogPayloadResult {
  type WireSet = NonNullable<LogTrainingEventInput["exercises"]>[number]["sets"][number];
  const detailed: NonNullable<LogTrainingEventInput["exercises"]> = [];

  for (const [exIndex, ex] of values.exercises.entries()) {
    const completedSets: WireSet[] = [];
    for (const [setIndex, s] of ex.sets.entries()) {
      // Exactly the ticked sets. The tick is the claim; an unticked row says
      // "not done" and is simply absent from the wire (there is no `completed`
      // flag on the schema — presence IS completion).
      if (!s.completed) continue;
      // The row's position in THIS form's row list, which mirrors the flattened
      // prescription (seedDefaultValues builds it from buildPrescribedRows and
      // restores a log back into the same shape, and a prescribed row cannot be
      // deleted). The server reads it as an index into that list —
      // prescribedRows[n - 1] — to stamp the coach-prescribed set_type. Taken
      // from the ORIGINAL array, never a position among the selected rows.
      const wireSet: WireSet = { setNumber: setIndex + 1 };
      for (const box of LOGGED_BOXES) {
        const key = boxKey(box);
        let value: number | string | null | undefined;
        if (isDirty(exIndex, setIndex, box)) {
          const text = s.entries[box];
          if (!text.trim()) continue;
          const parsed = parseEntry(boxEntry(box), text, viewer);
          if (parsed === null || !withinLimit(box, parsed)) {
            return { ok: false, reason: "unreadable", exerciseIndex: exIndex, setIndex, box };
          }
          value = parsed;
        } else {
          value = s.seeds[key];
        }
        // Typed per key by the schema; the table guarantees a number where one
        // is due and a string for tempo alone.
        if (value != null) (wireSet as Record<ActualKey, number | string | undefined>)[key] = value;
      }
      // Rest taken has no box: only the React Native app's timer records it,
      // and a logged one rides through the seed.
      if (s.seeds.restSeconds != null) wireSet.restSeconds = s.seeds.restSeconds;
      completedSets.push(wireSet);
    }

    if (completedSets.length === 0) continue;

    const trimmedNotes = ex.notes.trim();
    detailed.push({
      ...(UUID_RE.test(ex.trainingExerciseId) && {
        trainingExerciseId: ex.trainingExerciseId,
      }),
      ...(ex.exerciseId &&
        UUID_RE.test(ex.exerciseId) && { exerciseId: ex.exerciseId }),
      exerciseName: ex.exerciseName,
      sets: completedSets,
      // Already canonical — see the note above.
      weightUnit: "kg" as const,
      ...(trimmedNotes && { notes: trimmedNotes }),
    });
  }

  const groupScores: NonNullable<LogTrainingEventInput["groupScores"]> = [];
  for (const [groupIndex, entry] of values.groupScores.entries()) {
    const parsed = parseGroupScore(entry);
    if (!parsed.ok) return { ok: false, reason: "unreadable-score", groupIndex, box: parsed.box };
    if (parsed.score === null) continue;
    groupScores.push(
      parsed.score.finishSeconds !== null
        ? { groupId: entry.groupId, finishSeconds: parsed.score.finishSeconds }
        : { groupId: entry.groupId, rounds: parsed.score.rounds, reps: parsed.score.reps },
    );
  }

  const quality = resolveLogOutcome(values.exercises, prescribedRows, values.groupScores).quality;
  if (quality === null) return { ok: false, reason: "nothing" };

  const trimmedNotes = values.notes.trim();
  const payload: LogTrainingEventInput = {
    // The client no longer selects this. The server ignores it whenever the
    // payload carries `exercises` and derives its own (Phase 1), but the field
    // is required by the schema and IS honoured for an exercise-less payload —
    // so sending the outcome the client was shown keeps the two agreeing on the
    // one path where the client's value still decides.
    completionQuality: quality,
    ...(trimmedNotes && { notes: trimmedNotes }),
    exercises: detailed,
    groupScores,
  };
  // The belt: the outcome above and the rule below answer the same question,
  // and the server asks the rule.
  return trainingLogRecordsWork(payload)
    ? { ok: true, payload }
    : { ok: false, reason: "nothing" };
}

/** `count` empty, unticked rows — never fewer than one to type into. */
function blankRows(count: number): SetRowValues[] {
  return Array.from({ length: Math.max(1, count) }, () => emptySet());
}

/**
 * Rebuild the FULL row list for a logged exercise, with the logged sets dropped
 * back onto the rows they were logged against and ticked, every value restored.
 *
 * The row list is the prescription, not the log. Rebuilding only the logged rows
 * is what made a session logged as sets 3-5 of six reopen as a three-row form
 * and re-save as 1-3 — the same shape of bug as the one this workstream exists
 * to fix, a form sized from an assumption and silently renumbering what didn't
 * fit.
 *
 * The list is sized to hold BOTH ends: the prescription, and the highest set
 * number actually logged. A logged set past the prescription is real and
 * reachable — the client appended rows of their own, or the coach shrank the
 * prescription afterwards — and dropping it would not merely hide it. The write
 * path full-replaces (every exercise_log deleted, set_logs cascaded, re-inserted
 * from the payload), so a row missing from the rebuilt form is deleted from the
 * database on the next save. Reopen, save, gone. The same is true of a VALUE:
 * every measure the row carries goes into its seed, box or no box.
 */
function restoreSetsFromLog(
  log: ExerciseLog,
  viewer: UnitSystem,
  prescribedRowCount: number,
): SetRowValues[] {
  const highestLogged = log.sets.reduce(
    (max, s) => (Number.isInteger(s.setNumber) && s.setNumber > max ? s.setNumber : max),
    0,
  );
  // MAX_PRESCRIBED_ROWS is the wire's own bound on setNumber, so it cannot
  // truncate anything this form could ever send back. It is here so a corrupt
  // stored set_number cannot ask the browser for a billion-row array.
  const rows = blankRows(
    Math.min(Math.max(prescribedRowCount, highestLogged), MAX_PRESCRIBED_ROWS),
  );

  for (const s of log.sets) {
    const index = s.setNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) continue;
    const seeds = pickLoggedActuals(s);
    rows[index] = {
      // Unsnapped seeds, never formatLoad: these fill editable boxes, and a
      // snap would round-trip into the logged value.
      entries: entriesFromActuals(seeds, viewer),
      seeds,
      // It was logged, so it was done. Reopening a session shows the whole
      // prescription with exactly the logged rows banked.
      completed: true,
    };
  }
  return rows;
}

function displayName(log: ExerciseLog): string {
  return (
    log.performedName ??
    (log.prescribedExerciseSnapshot?.name as string | undefined) ??
    "Unplanned exercise"
  );
}

export function seedDefaultValues(args: {
  prescribedViews: PrescribedExerciseView[];
  /** The workout's groups, for the timed groups' score entries. */
  groups: ResolvedExerciseGroup[];
  sessionLog: SessionLog | null;
  exerciseLogs: ExerciseLog[];
  /** The log's scores, dropped into their groups' boxes. */
  groupScores: GroupScore[];
  /** The VIEWER's system. Display seeds convert to it; storage stays canonical. */
  viewer: UnitSystem;
}): LogFormValues {
  const { prescribedViews, groups, sessionLog, exerciseLogs, groupScores, viewer } = args;

  if (sessionLog === null) {
    return {
      notes: "",
      groupScores: seedGroupScores(groups, []),
      exercises: prescribedViews.map((v) => ({
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        notes: "",
        // Flattened, so a drop set contributes its top set PLUS one row per drop
        // — the same expansion training-log-service uses when it stamps
        // set_type. The two must agree or every row after a drop set is typed
        // from the wrong spec.
        sets: blankRows(prescribedRowsForView(v).length),
        isUnplanned: false,
      })),
    };
  }

  const logsByExerciseId = new Map<string, ExerciseLog>();
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null) {
      logsByExerciseId.set(log.trainingExerciseId, log);
    }
  }

  const prescribedExercises: ExerciseFormValues[] = prescribedViews.map((v) => {
    const rowCount = prescribedRowsForView(v).length;
    const log = logsByExerciseId.get(v.id);
    if (!log) {
      return {
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        notes: "",
        sets: blankRows(rowCount),
        isUnplanned: false,
      };
    }
    const performed = displayName(log);
    const isSwapped =
      log.performedName != null &&
      typeof log.prescribedExerciseSnapshot?.name === "string" &&
      log.performedName !== log.prescribedExerciseSnapshot.name;
    return {
      trainingExerciseId: v.id,
      exerciseId: log.exerciseId ?? undefined,
      exerciseName: performed,
      prescribedName: v.name,
      isSwapped,
      notes: log.notes ?? "",
      sets: restoreSetsFromLog(log, viewer, rowCount),
      isUnplanned: false,
    };
  });

  const prescribedIdSet = new Set(prescribedViews.map((v) => v.id));
  const orphanLogs = exerciseLogs.filter(
    (log) =>
      log.trainingExerciseId === null ||
      !prescribedIdSet.has(log.trainingExerciseId),
  );
  const orphanExercises: ExerciseFormValues[] = orphanLogs.map((log) => ({
    trainingExerciseId: log.trainingExerciseId ?? "",
    exerciseId: log.exerciseId ?? undefined,
    exerciseName: displayName(log),
    prescribedName: undefined,
    isSwapped: false,
    notes: log.notes ?? "",
    // Nothing prescribed, so the logged sets alone size the list.
    sets: restoreSetsFromLog(log, viewer, 0),
    isUnplanned: true,
  }));

  return {
    notes: sessionLog.notes ?? "",
    exercises: [...prescribedExercises, ...orphanExercises],
    groupScores: seedGroupScores(groups, groupScores),
  };
}
