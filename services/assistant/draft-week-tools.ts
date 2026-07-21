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
import { matchExerciseInRows } from "@/services/exercise-catalog-service";
import type { DraftWorkspace } from "./draft-workspace";
import { commitOp, resolveWeek } from "./draft-tool-helpers";

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
      return { kind: "load", unit: "kg", amount: rule.amount };
    case "load_percent":
      return { kind: "load", unit: "percent", amount: rule.amount };
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
      "Duplicate a week one or more times, optionally progressing each copy with rules. Copies insert right after the source; rules COMPOUND week over week (load_kg +2 = source+2, source+4, ...). everyNWeeks makes a rule fire only on those steps (2 = every other generated week). Progression touches WORKING sets only; load_kg only moves absolute-kg loads (percent-loaded sets need load_percent). scope 'compounds' uses the catalog's compound category; 'selected' progresses only scopeExercises.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1, description: "1-based source week" },
        count: { type: "integer", minimum: 1, maximum: 12, description: "How many copies (default 1)" },
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
    run: ({ week, count, rules, scope, scopeExercises }) => {
      const source = resolveWeek(ws, week);
      if (!source.ok) return source.error;
      const wireRules = (rules ?? []) as WireRule[];
      const scopeResult = buildScope(ws, scope ?? "all", scopeExercises);
      if ("error" in scopeResult) return scopeResult.error;
      const predicate = buildScopePredicate(scopeResult.value, ws.isCompound);

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
          afterWeekUid: prev.uid,
          week: generated,
          label,
        });
        if (err) {
          return reports.length > 0
            ? `Stopped after ${reports.length} copies: ${err}\n${reports.join("\n")}`
            : err;
        }
        reports.push(
          due.length > 0
            ? `Copy ${step}: ${due.map(ruleSummary).join(", ")} — ${changedCount}/${inScope} in-scope exercises changed${changedCount < inScope ? " (unchanged ones have no absolute-kg load for load_kg, or the rule was a no-op)" : ""}`
            : `Copy ${step}: exact duplicate`,
        );
        prev = generated;
      }
      return `Inserted ${copies} week(s) after week ${week}. The program now has ${ws.draft.weeks.length} weeks.\n${reports.join("\n")}`;
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
