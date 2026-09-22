import type {
  DaySlotDraft,
  ExerciseDraft,
  SessionDraft,
  WeekDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import type { ProgramDraft } from "@/components/clients/training/program-builder/program-builder-types";
import {
  findSession,
  normalizeDraft,
} from "@/components/clients/training/program-builder/program-builder-model";
import {
  applyDraftOp,
  type DraftOp,
} from "@/components/clients/training/program-builder/program-builder-ops";
import { formatLoads, formatReps, formatSetCount } from "./draft-exercise-summary";
import {
  SET_SPEC_MEASURE_KEYS,
  setSpecCount,
  specRange,
  type SetSpec,
  type SetSpecMeasure,
} from "@/utils/exercise-set-specs";
import { formatTargetRange } from "@/utils/target-range";
import { presetOf } from "@/utils/column-presets";
import { PRESCRIBED_FIELD_LABELS, type PrescribedField } from "@/utils/prescribed-fields";
import { countSessionExercises, sessionExercises } from "@/utils/exercise-groups";
import { groupHeading, groupHeadingText, readsAsGroup } from "@/utils/exercise-group-display";
import {
  rowsAreRounds,
  type ExerciseDestination,
} from "@/components/clients/training/program-builder/program-builder-groups";
import type { ExerciseGroupDraft } from "@/components/clients/training/program-builder/program-builder-types";
import type { DraftWorkspace } from "./draft-workspace";

// Shared plumbing for the assistant's tool executors: 1-based week/day/session/
// exercise addressing (the model speaks "week 3, day 5"), compact draft
// rendering for read tools, and the single commit path every write tool goes
// through.

/**
 * Execute one op against the workspace. Returns the skip reason (the executor
 * turns it into a tool error the model must relay — silent no-ops are a bug
 * class) or null on success. Mirrors the client replay exactly: applyDraftOp
 * then normalizeDraft, so the server's working copy and the client's draft
 * stay byte-identical.
 */
/**
 * CONCURRENCY INVARIANT — tool `run` functions must stay SYNCHRONOUS.
 *
 * The SDK executes a response's tool_use blocks via Promise.all, and the
 * system prompt actively encourages the model to batch independent calls into
 * one response (each response is a ~10-30s round trip the coach waits on).
 * That is safe only because every executor's body runs to completion before the
 * next one starts: a sync body has no await point for the event loop to
 * interleave at, so ws.draft mutations stay serialized. An `await` inside an
 * executor would let two batched calls read the same ws.draft and overwrite
 * each other — the coach asks for three edits, two land, and the assistant
 * reports three.
 *
 * This is currently UNREACHABLE by design, not by luck: the assistant is
 * scoped to the program in the builder and never reads client logs, history,
 * or metrics (owner decision 2026-07-21), and the exercise catalog is
 * preloaded once per turn — so no tool has anything to await. Serialization
 * was designed and deliberately not built on that basis.
 *
 * THEREFORE: adding a tool that needs a DB read (e.g. "what did this client
 * lift last week", "use their current 1RM") is not a drop-in change. Either
 * serialize execution at the tool-composition point first, or keep the tool
 * synchronous by preloading its data into the workspace like the catalog.
 */
export function commitOp(ws: DraftWorkspace, op: DraftOp): string | null {
  const outcome = applyDraftOp(ws.draft, op, {
    target: ws.target,
    editableDays: ws.editableDays ?? undefined,
  });
  if (outcome.skipped) return outcome.skipped;
  if (outcome.draft !== ws.draft) ws.draft = normalizeDraft(outcome.draft);
  // Labels interpolate session/exercise names (schema-legal up to 200 chars),
  // so a long name can push a label past draftOpSchema's 200-char cap — which
  // would make the CLIENT reject the whole turn after the server already
  // applied it and the model told the coach it landed. Clamp centrally: every
  // op passes through here, so no label template can reopen this.
  ws.ops.push(
    op.label && op.label.length > MAX_OP_LABEL
      ? { ...op, label: `${op.label.slice(0, MAX_OP_LABEL - 1)}…` }
      : op,
  );
  return null;
}

// Mirrors opLabel's .max(200) in lib/validations/assistant.ts.
const MAX_OP_LABEL = 200;

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export function resolveWeek(ws: DraftWorkspace, week: number): Resolved<WeekDraft> {
  const found = ws.draft.weeks[week - 1];
  if (!found) {
    return {
      ok: false,
      error: `Week ${week} doesn't exist — the program has ${ws.draft.weeks.length} week(s).`,
    };
  }
  return { ok: true, value: found };
}

export function resolveSlot(
  ws: DraftWorkspace,
  week: number,
  day: number,
): Resolved<DaySlotDraft> {
  const w = resolveWeek(ws, week);
  if (!w.ok) return w;
  const slot = w.value.days[day - 1];
  if (!slot) return { ok: false, error: `Day ${day} is out of range (days are 1-7).` };
  return { ok: true, value: slot };
}

/**
 * Every tool that addresses a session by its day takes this: a day on a
 * client's calendar can hold several sessions, named by their place in it.
 */
export const sessionPlaceProperty = {
  type: "integer",
  minimum: 1,
  description: "1-based place of the session within its day, when the day holds several (default 1)",
} as const;

/** The session at 1-based place `session` on a day (the day's first by default). */
export function resolveSession(
  ws: DraftWorkspace,
  week: number,
  day: number,
  session = 1,
): Resolved<SessionDraft> {
  const slot = resolveSlot(ws, week, day);
  if (!slot.ok) return slot;
  const { sessions } = slot.value;
  if (sessions.length === 0) {
    return {
      ok: false,
      error: `Week ${week} day ${day} is a rest day — add a session there first.`,
    };
  }
  const found = sessions[session - 1];
  if (!found) {
    return {
      ok: false,
      error: `Week ${week} day ${day} has only ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}.`,
    };
  }
  return { ok: true, value: found };
}

/** " · session 2" for a session on a day holding several; "" for a day's only one. */
export function sessionPlaceLabel(place: number, sessionsOnDay: number): string {
  return sessionsOnDay > 1 ? ` · session ${place}` : "";
}

export function resolveExerciseRef(
  session: SessionDraft,
  ref: { exercisePosition?: number; exerciseName?: string },
): Resolved<{ exercise: ExerciseDraft; index: number }> {
  // Positions count the session's exercises in order, group by group.
  const exercises = sessionExercises(session);
  if (ref.exercisePosition != null) {
    const index = ref.exercisePosition - 1;
    const exercise = exercises[index];
    if (!exercise) {
      return {
        ok: false,
        error: `"${session.name}" has ${exercises.length} exercise(s) — position ${ref.exercisePosition} doesn't exist.`,
      };
    }
    return { ok: true, value: { exercise, index } };
  }
  const query = ref.exerciseName?.trim().toLowerCase();
  if (!query) {
    return { ok: false, error: "Provide exercisePosition or exerciseName." };
  }
  const exact = exercises.findIndex((e) => e.name.trim().toLowerCase() === query);
  if (exact >= 0) return { ok: true, value: { exercise: exercises[exact], index: exact } };
  const partial = exercises
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.name.toLowerCase().includes(query));
  if (partial.length === 1) {
    return { ok: true, value: { exercise: partial[0].e, index: partial[0].index } };
  }
  const names = exercises.map((e, i) => `${i + 1}. ${e.name}`).join(", ");
  return {
    ok: false,
    error:
      partial.length === 0
        ? `No exercise matching "${ref.exerciseName}" in "${session.name}". It has: ${names}`
        : `"${ref.exerciseName}" matches several exercises in "${session.name}": ${names}. Use exercisePosition.`,
  };
}

/**
 * An exercise's 1-based position in its session as the working copy now
 * stands — group by group, each group's exercises in turn, the order the model
 * speaks — or null when it is gone. A move never splits a linked group, so a
 * tool that moved an exercise reports where it landed, not where it was sent.
 */
export function exercisePositionNow(
  ws: DraftWorkspace,
  sessionUid: string,
  exerciseUid: string,
): number | null {
  const session = findSession(ws.draft, sessionUid);
  if (!session) return null;
  const index = sessionExercises(session).findIndex((e) => e.uid === exerciseUid);
  return index < 0 ? null : index + 1;
}

/** The sentence for an exercise that could not go where it was sent. */
export function linkedGroupNote(name: string, landed: number | null, asked: number): string {
  return `"${name}" is at position ${landed ?? "?"}, not ${asked}: exercises linked in a group stay together, so it went to the nearest place that keeps every group whole.`;
}

/** The group an exercise sits in: the group, its place in the session and the exercise's place in it. */
export function exerciseGroupAt(
  session: SessionDraft,
  exerciseUid: string,
): { group: ExerciseGroupDraft; groupIndex: number; index: number } | null {
  for (const [groupIndex, group] of session.groups.entries()) {
    const index = group.exercises.findIndex((e) => e.uid === exerciseUid);
    if (index >= 0) return { group, groupIndex, index };
  }
  return null;
}

/**
 * Where the group at `groupIndex` goes when asked to start at 1-based
 * `position`: the first group boundary at or after it, so no group is split —
 * as a place counted before the move (ExerciseDestination's convention).
 */
export function boundaryIndex(session: SessionDraft, groupIndex: number, position: number): number {
  const target = position - 1;
  const others = session.groups.filter((_, i) => i !== groupIndex);
  let start = 0;
  let insertAt = others.length;
  for (let i = 0; i < others.length; i++) {
    if (start >= target) {
      insertAt = i;
      break;
    }
    start += others[i].exercises.length;
  }
  return insertAt >= groupIndex ? insertAt + 1 : insertAt;
}

/**
 * Where reorder_exercise sends an exercise asked to stand at 1-based
 * `position`: inside its own linked group, clamped to it; a standalone exercise
 * never lands inside a group — it goes to the first group boundary at or after
 * the position.
 */
export function reorderDestination(
  session: SessionDraft,
  exerciseUid: string,
  position: number,
): ExerciseDestination | null {
  const at = exerciseGroupAt(session, exerciseUid);
  if (!at) return null;
  const { group, groupIndex, index } = at;
  if (group.exercises.length < 2) {
    return { kind: "session", index: boundaryIndex(session, groupIndex, position) };
  }
  const start = countSessionExercises({ groups: session.groups.slice(0, groupIndex) });
  const place = Math.max(0, Math.min(group.exercises.length - 1, position - 1 - start));
  return { kind: "group", groupUid: group.uid, index: place > index ? place + 1 : place };
}

// --- Compact rendering for read tools ---

// Every measure a set can carry, as the model reads it: its name and the
// canonical storage unit (metres, seconds, seconds per km…), never the
// viewer's — the model speaks canonical units in every tool it calls.
type PrintedMeasure = Exclude<SetSpecMeasure, "reps" | "load">;
const MEASURE_PRINT: Record<PrintedMeasure, { label: string; unit: string }> = {
  rpe: { label: "RPE", unit: "" },
  rir: { label: "RIR", unit: "" },
  distance: { label: "distance", unit: "m" },
  duration: { label: "duration", unit: "s" },
  pace: { label: "pace", unit: "s/km" },
  split: { label: "split", unit: "s/500m" },
  calories: { label: "calories", unit: "kcal" },
  cadence: { label: "cadence", unit: "rpm" },
  stroke_rate: { label: "stroke rate", unit: "spm" },
  resistance: { label: "resistance", unit: "" },
  heart_rate_zone: { label: "HR zone", unit: "" },
  heart_rate: { label: "HR", unit: "bpm" },
  power: { label: "power", unit: "W" },
  ftp_percent: { label: "FTP", unit: "%" },
};

// A set's line prints every target it carries — reps, load, then each other
// measure by name — each one value or a range ("7-8").
const specLine = (s: SetSpec): string => {
  const repsRange = formatTargetRange(specRange(s, "reps"));
  const reps = repsRange ? `${repsRange} reps` : (s.reps_target ?? "reps —");
  const loadRange = formatTargetRange(specRange(s, "load"));
  const load =
    loadRange && s.load_type != null
      ? s.load_type === "absolute"
        ? ` @ ${loadRange}kg`
        : ` @ ${loadRange}% (${s.load_type})`
      : "";
  const others = SET_SPEC_MEASURE_KEYS.filter(
    (m): m is PrintedMeasure => m !== "reps" && m !== "load",
  )
    .map((measure) => {
      const range = formatTargetRange(specRange(s, measure));
      if (!range) return "";
      const { label, unit } = MEASURE_PRINT[measure];
      return ` ${label} ${range}${unit}`;
    })
    .join("");
  const tempo = s.tempo ? ` tempo ${s.tempo}` : "";
  const rest = s.rest_seconds != null ? ` rest ${s.rest_seconds}s` : "";
  const drops = s.drops?.length ? ` +${s.drops.length} drop(s)` : "";
  return `S${s.set_number} ${s.set_type}: ${reps}${load}${others}${tempo}${rest}${drops}`;
};

// An exercise's measurement columns as the model reads them: named only when
// they aren't the strength ones every exercise starts on — as their preset
// when they are exactly one, else the list — so the common case costs no
// budget and a run still prints what its client fills in.
function columnsNote(fields: readonly PrescribedField[]): string | null {
  const preset = presetOf(fields);
  if (preset === "strength") return null;
  if (preset) return `columns: ${preset} preset`;
  return `columns: ${fields.map((field) => PRESCRIBED_FIELD_LABELS[field]).join(", ")}`;
}

// `inRounds`: the exercise is in a superset or circuit, so its sets are the
// group's rounds and its own rest isn't used.
function exerciseLine(ex: ExerciseDraft, position: number, inRounds = false): string {
  const bits = [
    `${position}. ${ex.name}`,
    inRounds ? `${setSpecCount(ex)} rounds` : formatSetCount(ex),
    `reps ${formatReps(ex)}`,
    `load ${formatLoads(ex)}`,
  ];
  if (ex.rpeTarget != null) bits.push(`RPE ${ex.rpeTarget}`);
  if (ex.restSeconds != null && !inRounds) bits.push(`rest ${ex.restSeconds}s`);
  const columns = columnsNote(ex.prescribedFields);
  if (columns) bits.push(columns);
  if (ex.exerciseId == null) bits.push("(no catalog link)");
  return bits.join(" — ");
}

/** A linked group's heading for the model, in the words coaches and clients read. */
export function groupLine(group: ExerciseGroupDraft): string {
  const heading = groupHeading(group);
  const { title, rests } = groupHeadingText(heading);
  return [title, rests, heading.notes ? `notes: ${heading.notes}` : null]
    .filter(Boolean)
    .join(" — ");
}

/**
 * A session's exercises as the model reads them: numbered straight through the
 * session, a linked group's heading above its exercises, which are indented
 * beneath it. `detail` adds each exercise's per-set lines.
 */
export function sessionExerciseLines(
  session: SessionDraft,
  indent: string,
  detail: (ex: ExerciseDraft) => string[] = () => [],
): string[] {
  const lines: string[] = [];
  let position = 0;
  for (const group of session.groups) {
    // A linked group, or a timed group of any size, prints its heading.
    const linked = readsAsGroup(group);
    if (linked) lines.push(`${indent}${groupLine(group)}`);
    const inRounds = rowsAreRounds(group);
    for (const ex of group.exercises) {
      position += 1;
      const pad = linked ? `${indent}  ` : indent;
      lines.push(`${pad}${exerciseLine(ex, position, inRounds)}`);
      lines.push(...detail(ex).map((line) => `${pad}${line}`));
    }
  }
  return lines;
}

/** `placeLabel` names the session's place on a day holding several (sessionPlaceLabel). */
export function sessionDetail(
  session: SessionDraft,
  week: number,
  day: number,
  placeLabel = "",
): string {
  const header = [
    `Week ${week} day ${day}${placeLabel}: "${session.name}"`,
    session.focus ? `focus ${session.focus}` : null,
    session.estimatedDurationMinutes != null
      ? `${session.estimatedDurationMinutes}min`
      : null,
    session.calorieSurplusPercentage != null
      ? `surplus ${session.calorieSurplusPercentage}%`
      : "surplus inherits program default",
  ]
    .filter(Boolean)
    .join(" — ");
  const lines = sessionExerciseLines(session, "", (ex) =>
    ex.setSpecs ? ex.setSpecs.map((s) => `   ${specLine(s)}`) : [],
  );
  const notes = session.notes ? [`Notes: ${session.notes}`] : [];
  return [header, ...lines, ...notes].join("\n") || header;
}

function weekOneLiner(week: WeekDraft): string {
  const days = week.days
    .map((slot, i) =>
      slot.sessions.length > 0
        ? `D${i + 1} ${slot.sessions.map((s) => `${s.name}(${countSessionExercises(s)}ex)`).join(" + ")}`
        : `D${i + 1} rest`,
    )
    .join(" | ");
  return `W${week.weekIndex + 1}: ${days}`;
}

// Front-loading budget, in characters (~3.4k tokens). Every read tool call the
// model has to make is a FULL sequential round trip — tens of seconds of the
// coach staring at a spinner. Shipping the whole program up front instead costs
// a fraction of a cent in input tokens, so the trade is lopsided: pay tokens,
// buy latency. Only genuinely large programs fall back to the skeleton.
const FULL_DETAIL_BUDGET_CHARS = 12_000;

/**
 * The program state the model receives with the command. Returns the FULL
 * prescription when it fits the budget (`complete: true` — the model can plan
 * every edit without a single read call), otherwise the per-week skeleton it
 * must drill into with get_week / get_session.
 */
export function programContext(draft: ProgramDraft): {
  text: string;
  complete: boolean;
} {
  const full = programFullDetail(draft);
  if (full.length <= FULL_DETAIL_BUDGET_CHARS) {
    return { text: full, complete: true };
  }
  return { text: programSkeleton(draft), complete: false };
}

function programFullDetail(draft: ProgramDraft): string {
  const lines: string[] = [programHeader(draft)];
  draft.weeks.forEach((week, w) => {
    lines.push(`Week ${w + 1}:`);
    week.days.forEach((slot, d) => {
      if (slot.sessions.length === 0) {
        lines.push(`  Day ${d + 1}: rest`);
        return;
      }
      slot.sessions.forEach((s, p) => {
        const meta = [
          s.focus ? s.focus : null,
          s.calorieSurplusPercentage != null ? `surplus ${s.calorieSurplusPercentage}%` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const place = sessionPlaceLabel(p + 1, slot.sessions.length);
        lines.push(`  Day ${d + 1}${place}: "${s.name}"${meta ? ` (${meta})` : ""}`);
        lines.push(...sessionExerciseLines(s, "    "));
      });
    });
  });
  return lines.join("\n");
}

function programHeader(draft: ProgramDraft): string {
  return [
    `Program "${draft.name}"`,
    draft.splitType ? `focus: ${draft.splitType}` : null,
    `${draft.weeks.length} week(s)`,
    draft.defaultSurplusPercentage != null
      ? `default surplus ${draft.defaultSurplusPercentage}%`
      : "no default surplus",
  ]
    .filter(Boolean)
    .join(" — ");
}

export function programSkeleton(draft: ProgramDraft): string {
  const header = [
    `Program "${draft.name}"`,
    draft.splitType ? `focus: ${draft.splitType}` : null,
    `${draft.weeks.length} week(s)`,
    draft.defaultSurplusPercentage != null
      ? `default surplus ${draft.defaultSurplusPercentage}%`
      : "no default surplus",
  ]
    .filter(Boolean)
    .join(" — ");
  return [header, ...draft.weeks.map(weekOneLiner)].join("\n");
}
