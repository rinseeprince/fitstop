"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { useInvalidateClientPhases } from "@/hooks/use-client-phases";
import { weightFromKg, weightToKg } from "@/utils/nutrition-helpers";
import {
  MAX_ABS_RATE_KG_PER_WEEK,
  MAX_CHAIN_WEEKS,
  MAX_PHASE_WEEKS,
  MAX_PHASES,
} from "@/lib/validations/client-phases";
import {
  buildWrites,
  deadlineForRate,
  parseBlockRows,
  parseNumber,
  projectPlan,
  rateForDeadline,
  seedGoalPlan,
  type GoalPlanFormValues,
  type WeightUnit,
} from "./goal-plan-model";
import type { ClientGoal } from "@/types/client-goals";
import type { ClientPhase } from "@/services/client-phases-service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How the coach is expressing the destination's pace. Never stored — the goal
 * holds a deadline, and Task 1.4 decided against a stored rate column. */
export type DestinationMode = "deadline" | "rate";

/**
 * The form's coercing schema, mirroring the two API schemas it feeds.
 *
 * A factory rather than a constant because two of its bounds are not constants:
 *
 * - **The rate bound is a kg bound.** `MAX_ABS_RATE_KG_PER_WEEK` is 5 kg per week,
 *   which is 11.02 lb/wk — so a flat ±5 check against a display-unit field would
 *   reject a perfectly legal 8 lb/wk. The rate is converted and compared in kg,
 *   exactly as the server does it; only the message is in display units.
 * - **A stored target weight cannot be removed.** `updateGoalsSchema.goalWeight`
 *   is `.optional()` but deliberately NOT `.nullable()`, so an emptied field is
 *   omitted and the stored value carries forward. Rather than ship a field that
 *   silently ignores being emptied, it becomes REQUIRED once one is stored. A
 *   client with no weight keeps it optional — a null weight is maintenance, which
 *   is a legitimate state (invariant 4/5).
 */
export function makeGoalPlanFormSchema(unit: WeightUnit, requireGoalWeight: boolean) {
  const maxDisplayRate = weightFromKg(MAX_ABS_RATE_KG_PER_WEEK, unit);

  const optionalNumber = (min: number, max: number, message: string) =>
    z
      .string()
      .trim()
      .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), {
        message,
      });

  return z.object({
    startDate: z
      .string()
      .refine((v) => v === "" || DATE_RE.test(v), { message: "Use a valid date" }),
    goalWeight: optionalNumber(20, 700, `Enter a target weight between 20 and 700`).refine(
      (v) => !requireGoalWeight || v !== "",
      { message: "Enter a target weight — it cannot be removed once set" }
    ),
    goalBodyFat: optionalNumber(3, 60, "Enter a body fat between 3 and 60%"),
    deadline: z
      .string()
      .refine((v) => v === "" || DATE_RE.test(v), { message: "Use a valid date" }),
    blocks: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z
            .string()
            .trim()
            .min(1, "Name this block")
            .max(60, "Keep the name to 60 characters"),
          // Whole weeks only. parseBlockRows rounds, so an un-constrained "2.5"
          // would preview AND save as 3 with no error to surface — the server
          // never sees a fraction to reject.
          weeks: z
            .string()
            .trim()
            .regex(/^\d+$/, "Whole weeks only")
            .refine((v) => Number(v) >= 1 && Number(v) <= MAX_PHASE_WEEKS, {
              message: `Between 1 and ${MAX_PHASE_WEEKS} weeks`,
            }),
          // REQUIRED. parseBlockRows falls back to 0 for an empty field, and 0 is
          // explicit maintenance (invariant 5) — so a cleared field would write a
          // coaching decision the coach never made.
          ratePerWeek: z
            .string()
            .trim()
            .min(1, "Enter a rate — use 0 for maintenance")
            .refine((v) => Number.isFinite(Number(v)), { message: "Rate must be a number" })
            .refine(
              (v) => Math.abs(weightToKg(Number(v), unit)) <= MAX_ABS_RATE_KG_PER_WEEK,
              { message: `Keep the rate within ±${maxDisplayRate.toFixed(2)} ${unit}/wk` }
            ),
        })
      )
      .max(MAX_PHASES, `A plan cannot have more than ${MAX_PHASES} blocks`)
      .superRefine((blocks, ctx) => {
        const total = blocks.reduce((sum, b) => sum + (parseNumber(b.weeks) ?? 0), 0);
        if (total > MAX_CHAIN_WEEKS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Blocks total ${total} weeks; the maximum is ${MAX_CHAIN_WEEKS}`,
          });
        }
      }),
  });
}

async function putJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save");
  }
}

type UseGoalPlanFormInput = {
  clientId: string;
  goal: ClientGoal | null;
  phases: ClientPhase[];
  unit: WeightUnit;
  /** The CLIENT's today — the goal's dates sit on their calendar, not the coach's. */
  clientToday: string;
  currentWeight?: number;
  open: boolean;
  onSaved: () => void;
};

/** What the form was seeded FROM. The diff runs against these rather than the
 * live props, so it stays internally consistent with what the coach is looking
 * at even if a background revalidation lands mid-edit. */
type SeedSnapshot = {
  goal: ClientGoal | null;
  phases: ClientPhase[];
  conforming: boolean;
};

export function useGoalPlanForm({
  clientId,
  goal,
  phases,
  unit,
  clientToday,
  currentWeight,
  open,
  onSaved,
}: UseGoalPlanFormInput) {
  const { toast } = useToast();
  const invalidateGoals = useInvalidateClientGoals();
  const invalidatePhases = useInvalidateClientPhases();
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<DestinationMode>("deadline");
  const [rateInput, setRateInput] = useState("");

  const initial = useMemo(
    () => seedGoalPlan({ goal, phases, unit, clientToday }),
    // Seed once per mount from whatever is current; the effect below re-seeds on
    // each open. Deliberately not reactive — see the effect's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [seeded, setSeeded] = useState<SeedSnapshot>({
    goal,
    phases,
    conforming: initial.conforming,
  });

  const schema = useMemo(
    () => makeGoalPlanFormSchema(unit, seeded.goal?.goalWeight != null),
    [unit, seeded.goal?.goalWeight]
  );

  const form = useForm<GoalPlanFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial.values,
    // Validate on BLUR, not only on submit. Save is gated on outstanding WRITES,
    // and some invalid edits produce none — emptying a stored target weight is
    // deliberately not a change (see `buildWrites`), so on submit-only
    // validation the coach would clear the field, find Save disabled, and be
    // told nothing. The rule that a weight cannot be removed has to surface at
    // the field that refuses it.
    mode: "onBlur",
  });
  const { reset, control } = form;
  const blocks = useFieldArray({ control, name: "blocks" });

  // Re-seed on OPEN only, reading the records through a ref.
  //
  // Deliberately NOT keyed on `goal`/`phases`: `data?.phases` is a fresh array
  // identity on every SWR revalidation, so depending on it would wipe a coach's
  // in-progress edits the moment any other consumer of the /goals key writes.
  // The ref keeps the seed current without making the reset reactive.
  const latest = useRef({ goal, phases });
  latest.current = { goal, phases };

  useEffect(() => {
    if (!open) return;
    const next = seedGoalPlan({ ...latest.current, unit, clientToday });
    setSeeded({ ...latest.current, conforming: next.conforming });
    setMode("deadline");
    setRateInput("");
    reset(next.values);
  }, [open, unit, clientToday, reset]);

  const values = form.watch();

  // `values` is a fresh object every render, so its serialization is the real
  // dependency — without this the diff would rebuild two payloads and stringify
  // both on every keystroke.
  const valuesKey = JSON.stringify(values);
  const writes = useMemo(
    () =>
      buildWrites({
        goal: seeded.goal,
        phases: seeded.phases,
        values,
        unit,
        conforming: seeded.conforming,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valuesKey, seeded, unit]
  );

  const projection = useMemo(
    () =>
      projectPlan({
        rows: parseBlockRows(values.blocks),
        startDate: values.startDate || clientToday,
        currentWeight,
        goalWeight: parseNumber(values.goalWeight),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valuesKey, clientToday, currentWeight]
  );

  /** The rate the typed deadline implies — the read-only half of the widget. */
  const derivedRate = useMemo(
    () =>
      rateForDeadline({
        currentWeight,
        goalWeight: parseNumber(values.goalWeight),
        deadline: values.deadline,
        today: clientToday,
        startDate: values.startDate || null,
        unit,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valuesKey, currentWeight, clientToday, unit]
  );

  /** Rate mode writes a DEADLINE, because that is what the goal stores. */
  const applyRate = useCallback(
    (next: string) => {
      setRateInput(next);
      const parsed = parseNumber(next);
      if (parsed == null) return;
      const derived = deadlineForRate({
        currentWeight,
        goalWeight: parseNumber(form.getValues("goalWeight")),
        ratePerWeek: parsed,
        today: clientToday,
        startDate: form.getValues("startDate") || null,
        unit,
      });
      if (derived) form.setValue("deadline", derived, { shouldDirty: true });
    },
    [currentWeight, clientToday, unit, form]
  );

  const addBlock = useCallback(() => {
    blocks.append({ name: "", weeks: "4", ratePerWeek: "" });
  }, [blocks]);

  const hasOutstandingWrites = writes.goal != null || writes.phases != null;

  const save = useCallback(async () => {
    const valid = await form.trigger();
    if (!valid) return;
    if (!hasOutstandingWrites) return;

    setIsSaving(true);
    let phasesSaved = false;
    try {
      // BLOCKS FIRST. If the goal write then fails, the next open re-seeds the
      // start date FROM the blocks and `buildWrites` still reports the goal as
      // outstanding, so saving again converges on what the coach asked for.
      // Goal-first fails the other way: the untouched blocks would drag the goal
      // column back on the next open and the edit would vanish silently.
      if (writes.phases) {
        await putJson(`/api/clients/${clientId}/phases`, writes.phases);
        phasesSaved = true;
      }
      if (writes.goal) {
        await putJson(`/api/clients/${clientId}/goals`, writes.goal);
      }
      toast({ title: "Goal & plan saved" });
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      // Two writes, no transaction (CONVENTIONS §2 #13): name what landed.
      toast({
        title: phasesSaved ? "Blocks saved, goal did not" : "Save failed",
        description: phasesSaved
          ? `${message}. Save again to retry the goal.`
          : message,
        variant: "destructive",
      });
    } finally {
      // The phases PUT is served by TWO areas (CONVENTIONS §7), and a partial
      // failure still moved the blocks, so both invalidate either way.
      if (phasesSaved) void invalidatePhases(clientId);
      void invalidateGoals(clientId);
      setIsSaving(false);
    }
  }, [
    clientId,
    form,
    hasOutstandingWrites,
    invalidateGoals,
    invalidatePhases,
    onSaved,
    toast,
    writes,
  ]);

  return {
    form,
    blocks,
    addBlock,
    /** Seed-time snapshot — the sheet reads `conforming` to lock the Route section. */
    seeded,
    mode,
    setMode,
    rateInput,
    applyRate,
    derivedRate,
    projection,
    isSaving,
    hasOutstandingWrites,
    save,
  };
}
