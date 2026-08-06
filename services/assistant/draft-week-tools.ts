import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import {
  makeRestWeek,
  type WeekDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import {
  cloneWeek,
  progressWeek,
} from "@/components/clients/training/program-builder/program-builder-model";
import {
  buildScopePredicate,
  type ProgressionRule,
  type ProgressionScope,
} from "@/utils/progression-rules";
import { formatLoads } from "@/components/clients/training/program-builder/progression-preview-model";
import { matchExerciseInRows } from "@/services/exercise-catalog-service";
import type { DraftWorkspace } from "./draft-workspace";
import { commitOp, resolveWeek } from "./draft-tool-helpers";

/**
 * Actual before → after loads for the exercises a step changed.
 *
 * Without this the model narrates progressions from its OWN arithmetic
 * (80 x 1.05^n) and drifts from what was really stored: the engine snaps
 * percentage moves to the nearest 0.5kg as plate math, so a chat message
 * saying "88.2kg" describes a grid that holds 88kg. Feeding the stored values
 * back means the assistant reports the program that exists, not the one it
 * calculated.
 *
 * Positional pairing is safe — progressWeek never adds, removes, or reorders
 * exercises. Capped so a 12-week fan-out can't flood the tool result.
 */
const MAX_REPORTED_EXERCISES = 5;

function loadChanges(before: WeekDraft, after: WeekDraft): string[] {
  const seen = new Map<string, string>();
  before.days.forEach((slot, d) => {
    const afterSession = after.days[d]?.session;
    if (!slot.session || !afterSession) return;
    slot.session.exercises.forEach((ex, i) => {
      const next = afterSession.exercises[i];
      if (!next || seen.has(ex.name)) return;
      // Pinned to metric, NOT the coach's preference: the assistant speaks
      // canonical kilograms everywhere (this file's own WireRule "load_kg",
      // draft-agent-service's prompt, draft-exercise-tools' loadKg field). An
      // lbs string reaching the model would corrupt its arithmetic silently.
      const from = formatLoads(ex, "metric");
      const to = formatLoads(next, "metric");
      if (from !== to) seen.set(ex.name, `${ex.name} ${from} → ${to}`);
    });
  });
  const all = [...seen.values()];
  return all.length > MAX_REPORTED_EXERCISES
    ? [...all.slice(0, MAX_REPORTED_EXERCISES), `+${all.length - MAX_REPORTED_EXERCISES} more`]
    : all;
}

// Week-level WRITE tools, including the headline duplicate_week with
// progression rules — a thin orchestration over the tested S4 engine
// (cloneWeek + progressWeek + progression-rules): clone the PREVIOUS generated
// week each step so per-step rules accumulate ("2kg per week" = source+2,
// source+4, ...), applying only the rules due at that step (everyNWeeks
// cadence: "an extra set every other week" fires at steps 2, 4, ...).

type WireRule = {
  kind: "load_kg" | "load_percent" | "reps" | "sets";
  amount: number;
  everyNWeeks?: number;
};

const toEngineRule = (rule: WireRule): ProgressionRule => {
  switch (rule.kind) {
    case "load_kg":
      return { kind: "load", mode: "absolute", amount: rule.amount };
    case "load_percent":
      return { kind: "load", mode: "percent", amount: rule.amount };
    case "reps":
      return { kind: "reps", amount: rule.amount };
    case "sets":
      return { kind: "sets", amount: rule.amount };
  }
};

const ruleSummary = (rule: WireRule): string => {
  const sign = rule.amount > 0 ? "+" : "";
  const base =
    rule.kind === "load_kg"
      ? `${sign}${rule.amount}kg`
      : rule.kind === "load_percent"
        ? `${sign}${rule.amount}% load`
        : rule.kind === "reps"
          ? `${sign}${rule.amount} reps`
          : `${sign}${rule.amount} set(s)`;
  const cadence = rule.everyNWeeks && rule.everyNWeeks > 1 ? ` every ${rule.everyNWeeks} weeks` : "";
  return base + cadence;
};

function buildScope(
  ws: DraftWorkspace,
  scope: "all" | "compounds" | "selected",
  scopeExercises: string[] | undefined,
): { value: ProgressionScope } | { error: string } {
  if (scope === "all") return { value: { kind: "all" } };
  if (scope === "compounds") return { value: { kind: "compounds" } };
  if (!scopeExercises || scopeExercises.length === 0) {
    return { error: "scope 'selected' needs scopeExercises (the exercise names to progress)." };
  }
  // Scope keys match exerciseScopeKey: catalog id when resolvable, else the
  // lowercased name — include both so free-text and linked rows both match.
  const keys = new Set<string>();
  for (const name of scopeExercises) {
    keys.add(name.trim().toLowerCase());
    const row = matchExerciseInRows(ws.catalog, name);
    if (row) keys.add(row.id);
  }
  return { value: { kind: "selected", keys } };
}

export function buildWeekTools(ws: DraftWorkspace) {
  const addWeek = betaTool({
    name: "add_week",
    description: "Append a new empty week (7 rest days) at the end of the program.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const,
    run: () => {
      const week = makeRestWeek(ws.draft.weeks.length);
      const err = commitOp(ws, {
        type: "insert_week",
        afterWeekUid: null,
        week,
        label: `Added week ${ws.draft.weeks.length + 1} (rest)`,
      });
      return err ?? `Added empty week ${ws.draft.weeks.length}.`;
    },
  });

  const duplicateWeek = betaTool({
    name: "duplicate_week",
    description:
      "Duplicate a week one or more times, optionally progressing each copy with rules. Rules COMPOUND week over week (load_kg +2 = source+2, source+4, ...). everyNWeeks makes a rule fire only on those steps (2 = every other generated week). Progression touches WORKING sets only; load_kg only moves absolute-kg loads (percent-loaded sets need load_percent). scope 'compounds' uses the catalog's compound category; 'selected' progresses only scopeExercises. Copies land after the source week unless insertAfterWeek says otherwise — use that to resume a progression PAST a deload: e.g. weeks 2-5 from week 1 (+5%), then week 6 as a deload off week 5, then the rest cloned from week 5 again with insertAfterWeek:6 so they continue from pre-deload loads instead of the deload's. Build a long program in a FEW calls like that, never one week per call.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1, description: "1-based source week — what gets cloned" },
        count: { type: "integer", minimum: 1, maximum: 12, description: "How many copies (default 1)" },
        insertAfterWeek: {
          type: "integer",
          minimum: 1,
          description:
            "1-based week the copies are placed AFTER (default: the source week). Lets you clone one week's content but position the copies elsewhere.",
        },
        rules: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["load_kg", "load_percent", "reps", "sets"] },
              amount: { type: "number", description: "Per-step amount; negative = deload" },
              everyNWeeks: { type: "integer", minimum: 1, maximum: 12 },
            },
            required: ["kind", "amount"],
            additionalProperties: false,
          },
        },
        scope: { type: "string", enum: ["all", "compounds", "selected"] },
        scopeExercises: {
          type: "array",
          maxItems: 30,
          items: { type: "string", maxLength: 200 },
        },
      },
      required: ["week"],
      additionalProperties: false,
    } as const,
    run: ({ week, count, insertAfterWeek, rules, scope, scopeExercises }) => {
      const source = resolveWeek(ws, week);
      if (!source.ok) return source.error;
      const wireRules = (rules ?? []) as WireRule[];
      const scopeResult = buildScope(ws, scope ?? "all", scopeExercises);
      if ("error" in scopeResult) return scopeResult.error;
      const predicate = buildScopePredicate(scopeResult.value, ws.isCompound);

      // Two independent chains: `prev` is what each copy is CLONED from
      // (so rules compound), `anchorUid` is where it's PLACED. They diverge
      // only on the first copy when insertAfterWeek is given — after that,
      // copies stack in order behind the one before them.
      let anchorUid = source.value.uid;
      if (insertAfterWeek != null) {
        const anchor = resolveWeek(ws, insertAfterWeek);
        if (!anchor.ok) return anchor.error;
        anchorUid = anchor.value.uid;
      }

      const copies = count ?? 1;
      let prev: WeekDraft = source.value;
      const reports: string[] = [];
      for (let step = 1; step <= copies; step++) {
        let generated = cloneWeek(prev);
        const due = wireRules.filter((r) => step % (r.everyNWeeks ?? 1) === 0);
        let changedCount = 0;
        for (const rule of due) {
          const result = progressWeek(generated, toEngineRule(rule), predicate);
          generated = result.week;
          changedCount = Math.max(changedCount, result.changedExerciseUids.size);
        }
        const inScope = generated.days.reduce(
          (sum, slot) =>
            sum +
            (slot.session?.exercises.filter((e) => !e.isWarmup && predicate(e)).length ?? 0),
          0,
        );
        const label =
          due.length > 0
            ? `Week ${week} duplicated (${due.map(ruleSummary).join(", ")})`
            : `Week ${week} duplicated`;
        const err = commitOp(ws, {
          type: "insert_week",
          afterWeekUid: anchorUid,
          week: generated,
          label,
        });
        if (err) {
          return reports.length > 0
            ? `Stopped after ${reports.length} copies: ${err}\n${reports.join("\n")}`
            : err;
        }
        if (due.length > 0) {
          const changes = loadChanges(prev, generated);
          reports.push(
            `Copy ${step} (week ${ws.draft.weeks.length}): ${due.map(ruleSummary).join(", ")} — ${changedCount}/${inScope} in-scope exercises changed${changedCount < inScope ? " (unchanged ones have no absolute-kg load for load_kg, or the rule was a no-op)" : ""}` +
              // The RESULTING loads, so the reply quotes real stored values
              // (plate-rounded) instead of recomputed arithmetic.
              (changes.length > 0 ? `\n    Resulting loads: ${changes.join("; ")}` : ""),
          );
        } else {
          reports.push(`Copy ${step} (week ${ws.draft.weeks.length}): exact duplicate`);
        }
        prev = generated;
        anchorUid = generated.uid;
      }
      const placedAfter = insertAfterWeek ?? week;
      return `Inserted ${copies} week(s) after week ${placedAfter}${insertAfterWeek != null && insertAfterWeek !== week ? ` (cloned from week ${week})` : ""}. The program now has ${ws.draft.weeks.length} weeks.\n${reports.join("\n")}`;
    },
  });

  const deleteWeek = betaTool({
    name: "delete_week",
    description: "Delete a whole week and everything in it. The program keeps at least one week.",
    inputSchema: {
      type: "object",
      properties: { week: { type: "integer", minimum: 1 } },
      required: ["week"],
      additionalProperties: false,
    } as const,
    run: ({ week }) => {
      const w = resolveWeek(ws, week);
      if (!w.ok) return w.error;
      const err = commitOp(ws, {
        type: "remove_week",
        weekUid: w.value.uid,
        label: `Deleted week ${week}`,
      });
      return err ?? `Deleted week ${week}. The program now has ${ws.draft.weeks.length} weeks.`;
    },
  });

  const moveWeek = betaTool({
    name: "move_week",
    description: "Move a week to a different position (weeks renumber automatically).",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        toPosition: { type: "integer", minimum: 1 },
      },
      required: ["week", "toPosition"],
      additionalProperties: false,
    } as const,
    run: ({ week, toPosition }) => {
      const w = resolveWeek(ws, week);
      if (!w.ok) return w.error;
      // Clamp HERE, not just in applyDraftOp: an out-of-range toIndex is
      // schema-invalid on the client, which would discard the entire turn
      // while this tool reported success.
      const target = Math.min(Math.max(toPosition, 1), ws.draft.weeks.length);
      const err = commitOp(ws, {
        type: "move_week",
        weekUid: w.value.uid,
        toIndex: target - 1,
        label: `Moved week ${week} to position ${target}`,
      });
      return err ?? `Moved week ${week} to position ${target}.`;
    },
  });

  return [addWeek, duplicateWeek, deleteWeek, moveWeek];
}
