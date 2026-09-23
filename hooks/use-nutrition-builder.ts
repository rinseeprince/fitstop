"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import {
  useClearBlockFacts,
  useClientBlocks,
} from "@/components/clients/metrics/hooks/use-client-blocks";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearNutritionGoal, useNutritionGoalForDay } from "@/hooks/use-nutrition-goal";
import {
  buildBlockStartOptions,
  selectBlockStartOption,
  NO_BLOCK_OPTION,
} from "@/lib/blocks/block-start-options";
import type {
  Client,
  DietType,
  NutritionWarning,
} from "@/types/check-in";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import { useManualTargets, type MacroTargets } from "@/hooks/use-manual-targets";
import { DEFAULT_SURPLUS_SETTINGS, type SurplusSettings } from "@/lib/nutrition/surplus-settings";
// A PURE module (types + one arithmetic helper, no DB imports), so the browser
// runs the identical calculator the server does. That is what makes the preview
// authoritative rather than an approximation.
import { generateNutritionPlan } from "@/services/nutrition-service";

type UseNutritionBuilderProps = {
  client: Client;
  onUpdate?: () => void;
  /** The Journey block the coach came from ("set targets" on its card), or
   *  null. Captured on arrival by the host's `useJourneyRoundTrip` — the URL
   *  is stripped of the trip in the same effect — and preselected in the Block
   *  field below; never a binding. */
  roundTripBlockId?: string | null;
  /** The day an arrival asked the drawer to start on ("Set nutrition from
   *  19 Oct" on the Overview), or null. Captured on arrival with the trip and
   *  cleared with it; the coach's own pick and a chosen block both win. */
  roundTripStartsOn?: string | null;
  /** Whether the drawer is open. The day's goal is read only then — nothing
   *  outside the drawer shows it, so a visit to the tab never pays for it. */
  drawerOpen: boolean;
};

type NutritionSettings = {
  proteinTargetGPerKg: number;
  dietType: DietType;
};

export function useNutritionBuilder({
  client,
  onUpdate,
  roundTripBlockId = null,
  roundTripStartsOn = null,
  drawerOpen,
}: UseNutritionBuilderProps) {
  const nutritionPlan = useNutritionPlan({ client });
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearBlockFacts = useClearBlockFacts();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const clearNutritionGoal = useClearNutritionGoal();

  const [settings, setSettings] = useState<NutritionSettings>({
    proteinTargetGPerKg: 2.0,
    dietType: "balanced",
  });
  const [settingsChanged, setSettingsChanged] = useState(false);

  // Seed the pickers from the ACTIVE PLAN, once per plan load.
  //
  // Without this the three settings sat on their hardcoded defaults forever:
  // opening a keto plan showed "Balanced", and pressing Regenerate without
  // touching anything silently rewrote the plan to sedentary/2.0/balanced. It
  // was a quiet bug while the numbers only appeared after saving; with a live
  // preview it becomes a visible clobber the moment the drawer opens.
  //
  // Keyed on the plan's own values so a background refetch cannot overwrite
  // edits the coach has already made in this session.
  const nd = nutritionPlan.nutritionData;
  const settingsSeedKey =
    nd?.proteinTargetGPerKg && nd?.dietType
      ? `${nd.proteinTargetGPerKg}|${nd.dietType}`
      : null;
  const settingsSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsSeedKey || settingsSeededRef.current === settingsSeedKey) return;
    const [proteinTargetGPerKg, dietType] = settingsSeedKey.split("|");
    setSettings({
      proteinTargetGPerKg: Number(proteinTargetGPerKg),
      dietType: dietType as DietType,
    });
    setSettingsChanged(false);
    settingsSeededRef.current = settingsSeedKey;
  }, [settingsSeedKey]);

  // The day the plan takes effect — the coach's pick, else the client's today
  // (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D27). Derived rather than seeded
  // so the default follows the client's day across their midnight, and taken
  // from the server's answer — the day its past-date belt judges — never from
  // the coach's browser clock.
  const [effectiveFromPick, setEffectiveFromPick] = useState<string | null>(null);
  const clientToday = nd?.clientToday ?? null;
  // The earliest day targets may START is the client's own today (owner,
  // 2026-09-11): today is the coach's to replace whatever the client has
  // eaten — a today they have already logged is re-recorded onto their log by
  // the save — so nothing on this track asks the deletion floor, which is
  // training's (a workout logged today moves a program's start, never the
  // targets'). The blocks payload is read for its blocks alone. Null until the
  // plan read has answered, like everything here; the server's own belt
  // refuses a past start either way.
  const { blocks } = useClientBlocks(client.id);
  // The Block field over the date: the dash (no block) first, then the client's
  // blocks whose end is on or after today. The coach's own pick wins; with
  // none, the block they came from is preselected; else the dash. A chosen
  // block FIXES the start on its first available day (today for a block
  // already under way, never the day it began) and the form disables the date;
  // with the dash the date is the coach's own, else the day an arrival asked
  // for, else today. A derivation, never a second copy of the date, so the two
  // cannot disagree. No options, and so nothing fixed, until the client's today
  // is known.
  const blockOptions = useMemo(
    () => (clientToday ? buildBlockStartOptions(blocks, clientToday) : []),
    [blocks, clientToday]
  );
  const [blockPick, setBlockPick] = useState<string | null>(null);
  const selectedBlock =
    blockOptions.length > 0
      ? selectBlockStartOption(blockOptions, blockPick, roundTripBlockId)
      : null;
  const fixedStart =
    selectedBlock && selectedBlock.value !== NO_BLOCK_OPTION ? selectedBlock.startsOn : null;
  const effectiveFrom = fixedStart ?? effectiveFromPick ?? roundTripStartsOn ?? clientToday;

  // The goal in force on that day and the calculator's inputs for it
  // (docs/MEASUREMENT-LOG-PLAN.md commit 8d1): the drawer prices a plan for the
  // goal on its Starts on, as the save does — one resolver on the server — so
  // preview and save agree even inside a planned goal. A new day is a new read:
  // until it lands the numbers are pending, never another day's.
  const dayRead = useNutritionGoalForDay(client.id, drawerOpen ? effectiveFrom : null);
  const dayGoal = dayRead.goalForDay?.goal ?? null;
  // The plan read failing leaves no client's today and no plan to seed from,
  // so nothing can be priced: the drawer says it failed, as for a failed day
  // read, and Try again retries whichever failed.
  const isDayError = dayRead.isError || nutritionPlan.isNutritionError;
  const isDayPending = !isDayError && !dayRead.goalForDay;
  const retryDay = () => {
    if (nutritionPlan.isNutritionError) nutritionPlan.refetchNutrition();
    if (dayRead.isError) dayRead.retry();
  };

  // The live preview. Recomputes on every picker change REGARDLESS of manual
  // mode — that is what powers the "Auto suggests …" hint without ever writing
  // into the coach's typed numbers.
  //
  // The `status === "ready"` gate is load-bearing, not defensive. The server
  // asserts `bmr!` because validateClientForNutrition ran first; the browser
  // has no such guarantee, and an undefined bmr makes Math.round(bmr * mult)
  // NaN — which the minimum-calorie floor does NOT catch, so the field would
  // render the literal string "NaN". A null bmr is worse: it yields 0, which
  // looks like a number.
  const calcInputs = dayRead.goalForDay?.calcInputs ?? null;

  const autoPlan = useMemo(
    () =>
      calcInputs?.status === "ready" && effectiveFrom
        ? // The deficit's window starts at the picked date — the same override
          // the save makes — so the numbers move the moment the date does.
          generateNutritionPlan({ ...calcInputs, ...settings, startDate: effectiveFrom })
        : null,
    [calcInputs, settings, effectiveFrom]
  );

  const autoTargets: MacroTargets | null = useMemo(
    () =>
      autoPlan
        ? {
            calories: autoPlan.baselineCalories,
            proteinG: autoPlan.proteinTargetG,
            carbG: autoPlan.carbTargetG,
            fatG: autoPlan.fatTargetG,
          }
        : null,
    [autoPlan]
  );

  const manual = useManualTargets(nutritionPlan.nutritionData);

  // The two surplus settings (migration 196): fields of the save, like the
  // pickers above and seeded the same way — once per saved value, from the
  // latest-saved version, so a background refetch cannot undo a flip and a
  // new save shows what it saved; with no plan, the defaults a first plan
  // starts from. A flip writes nothing: Regenerate / Generate saves it with the
  // version, from its Starts on. Until then it is a draft like every other
  // field here — it survives closing and reopening the drawer, so an
  // accidental click outside loses nothing, and goes when the coach leaves the
  // Nutrition tab (owner, 2026-09-23).
  const [surplus, setSurplus] = useState<SurplusSettings>(DEFAULT_SURPLUS_SETTINGS);
  const surplusSeedKey =
    nd?.includeActivityBurn !== undefined && nd?.surplusAsCarbs !== undefined
      ? `${nd.includeActivityBurn}|${nd.surplusAsCarbs}`
      : null;
  const surplusSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!surplusSeedKey || surplusSeededRef.current === surplusSeedKey) return;
    const [includeActivityBurn, surplusAsCarbs] = surplusSeedKey.split("|");
    setSurplus({
      includeActivityBurn: includeActivityBurn === "true",
      surplusAsCarbs: surplusAsCarbs === "true",
    });
    surplusSeededRef.current = surplusSeedKey;
  }, [surplusSeedKey]);

  const handleToggleActivityBurn = useCallback((value: boolean) => {
    setSurplus((current) => ({ ...current, includeActivityBurn: value }));
  }, []);

  // "Add training calories as": false keeps the plan's carb:fat split on a
  // training-day surplus; true adds the whole surplus as carbs.
  const handleToggleSurplusAsCarbs = useCallback((value: boolean) => {
    setSurplus((current) => ({ ...current, surplusAsCarbs: value }));
  }, []);

  const [coachNotes, setCoachNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<NutritionWarning[]>([]);

  // Settings change handler. Only fired by a coach picker interaction — the
  // seed effect above writes setSettings directly, so this never runs on open.
  const { manualEnabled, recomposeManualMacros } = manual;
  const handleSettingsChange = useCallback(
    (newSettings: Partial<NutritionSettings>) => {
      // The pickers above the target boxes have no editable box of their own
      // (diet type is only a split, protein-per-kg is only a protein figure),
      // so in manual mode they were inert. A GENUINE change to either now
      // recomposes the manual macros — holding the coach's calorie target,
      // which is the point of the override. Guarded to manual mode; auto mode
      // already recomputes autoTargets from the pickers. Activity-level changes
      // resend the same diet/protein and are ignored (each Select sends the
      // full object, so a real change is detected by comparing to `settings`).
      if (manualEnabled && calcInputs?.status === "ready") {
        const dietChanged =
          newSettings.dietType !== undefined && newSettings.dietType !== settings.dietType;
        const proteinChanged =
          newSettings.proteinTargetGPerKg !== undefined &&
          newSettings.proteinTargetGPerKg !== settings.proteinTargetGPerKg;
        if (dietChanged || proteinChanged) {
          const merged = { ...settings, ...newSettings };
          // Reuse the calculator so the re-derived protein figure matches the
          // auto path EXACTLY (protein-per-kg × body weight), rather than
          // duplicating that formula here. Only needed when protein changed.
          const proteinG = proteinChanged
            ? generateNutritionPlan({ ...calcInputs, ...merged }).proteinTargetG
            : undefined;
          recomposeManualMacros({ proteinG, dietType: merged.dietType });
        }
      }
      setSettings((prev) => ({ ...prev, ...newSettings }));
      setSettingsChanged(true);
    },
    [manualEnabled, recomposeManualMacros, settings, calcInputs]
  );

  const handleEffectiveFromChange = useCallback((date: string) => {
    // An emptied picker means the client's today again, not an empty string.
    setEffectiveFromPick(date || null);
    setSettingsChanged(true);
  }, []);

  const handleBlockChange = useCallback((value: string) => {
    setBlockPick(value);
    // A block change discards a typed date: the dash then reads the client's
    // today again, not a day picked for a different block.
    setEffectiveFromPick(null);
    setSettingsChanged(true);
  }, []);

  // "Set nutrition from 19 Oct": the dash and that day, in one update, so the
  // date field and the numbers under it move together.
  const setStartsOn = useCallback((day: string) => {
    setBlockPick(NO_BLOCK_OPTION);
    setEffectiveFromPick(day);
    setSettingsChanged(true);
  }, []);

  // Generate nutrition plan. `useManual` posts the coach's typed targets as the
  // custom-macro override; otherwise the server recalculates from the same
  // pickers the preview used, so the saved numbers match what was on screen.
  const generatePlan = useCallback(
    async (useManual = false) => {
      const validation = validateClientForNutrition(client);
      if (!validation.valid) {
        toast.error("Missing required data", {
          description: validation.errors.join(", "),
        });
        return false;
      }
      // The footer holds the button while the day's goal is loading or failed;
      // this is the belt, so a save can never price a day the drawer has not
      // shown.
      if (isDayPending || isDayError) {
        toast.error("Save failed", {
          description: "The goal for the Starts on day hasn't loaded yet.",
        });
        return false;
      }

      setIsGenerating(true);
      try {
        const body: Record<string, unknown> = {
          proteinTargetGPerKg: settings.proteinTargetGPerKg,
          dietType: settings.dietType,
          // goalDeadline is no longer sent: the deadline is owned by
          // client_goals, resolved server-side. The builder's dead deadline
          // input was replaced by a read-only Goal line.
          ...(coachNotes.trim() ? { coachNotes: coachNotes.trim() } : {}),
          // The day the plan takes effect and the deficit is spread from — the
          // day the preview computed from, today included, on the client's calendar.
          ...(effectiveFrom ? { effectiveFrom } : {}),
          // Saved with the version and pricing only its days (migration 196).
          includeActivityBurn: surplus.includeActivityBurn,
          surplusAsCarbs: surplus.surplusAsCarbs,
        };

        if (useManual) {
          // Null here means no calorie target yet. The footer gates on the
          // same condition before calling, so this is a belt: never post an
          // empty override.
          const t = manual.manualTargets;
          if (!t) throw new Error(manual.manualBlockingError ?? "Enter a calorie target");
          body.customMacrosEnabled = true;
          body.customProteinG = t.proteinG;
          body.customCarbG = t.carbG;
          body.customFatG = t.fatG;
          // The coach's typed target, with the grams the balancer derives from
          // it — within one carb rounding of each other by construction, so
          // the server's tolerance belt cannot trip on a save from here.
          body.customCalories = t.calories;
        }

        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (data.success && data.plan) {
          setWarnings(data.plan.warnings || []);
          toast.success("Nutrition plan generated", {
            description: `${data.plan.calorieTarget} cal/day with ${data.plan.proteinTargetG}g protein`,
          });
          setSettingsChanged(false);
          setCoachNotes("");
          // The next save defaults to today again (D27) — and to the dash,
          // unless a round trip is still preselecting a block.
          setEffectiveFromPick(null);
          setBlockPick(null);
          onUpdate?.();
          nutritionPlan.refetchNutrition();
          // The calendar renders from its own SWR events cache — revalidate it
          // or the regenerated days only appear after a page refresh.
          void invalidateNutritionCalendar(client.id);
          // And the Journey block cards, which are DERIVED from the plan
          // versions this just wrote — the area that owes an invalidator is the
          // one that READS what you wrote, not the one you wrote
          // (CONVENTIONS §7). Cleared rather than revalidated: they render a
          // definite "Not set", so a stale entry states something false.
          void clearBlockFacts(client.id);
          void clearClientOverview(client.id);
          void clearAttentionFeed();
          // Whether the versions still fit the goal is derived from the ones
          // this just wrote: cleared, so the old notice never shows again.
          void clearNutritionGoal(client.id);
          return true;
        } else {
          throw new Error(data.error || "Failed to generate plan");
        }
      } catch (error) {
        toast.error("Error", {
          description: error instanceof Error ? error.message : "Failed to generate plan",
        });
        return false;
      } finally {
        setIsGenerating(false);
      }
    },
    [
      client,
      isDayPending,
      isDayError,
      settings,
      effectiveFrom,
      surplus,
      manual.manualTargets,
      manual.manualBlockingError,
      coachNotes,
      onUpdate,
      nutritionPlan,
      invalidateNutritionCalendar,
      clearBlockFacts,
      clearClientOverview,
      clearAttentionFeed,
      clearNutritionGoal,
    ]
  );

  return {
    // Spread base nutrition plan state
    ...nutritionPlan,

    // Settings pickers (seeded from the active plan)
    settings,
    settingsChanged,
    handleSettingsChange,

    // The day the plan takes effect: a chosen block's first available day —
    // the client's today for a block under way, a future block's own start —
    // else the coach's pick, else the client's today. Null until the resolved
    // inputs have loaded.
    effectiveFrom,
    clientToday,
    handleEffectiveFromChange,
    setStartsOn,

    // The goal in force on that day — the Goal line's — and the day read's
    // state: while it is pending the numbers are, and Generate waits.
    dayGoal,
    isDayPending,
    isDayError,
    retryDay,

    // The Block field: its options, the selected value, and whether a block is
    // chosen — the form disables the date field while one is.
    blockOptions,
    blockValue: selectedBlock?.value ?? NO_BLOCK_OPTION,
    blockSelected: fixedStart != null,
    handleBlockChange,

    // Live preview + manual override. `autoTargets` is what auto mode shows and
    // what "Edit manually" seeds the balancer from; `manualBalance` (spread from
    // the hook below) is the coach's target and split once they have taken over.
    // `autoTargets` stays available alongside it so manual mode can show what
    // auto would have suggested WITHOUT overwriting the coach's numbers.
    autoPlan,
    autoTargets,
    /** null while the resolver could not run — the UI renders `missing`. */
    calcInputs,
    ...manual,

    // The two surplus settings — fields of the save (migration 196)
    includeActivityBurn: surplus.includeActivityBurn,
    handleToggleActivityBurn,
    surplusAsCarbs: surplus.surplusAsCarbs,
    handleToggleSurplusAsCarbs,

    // Coach notes on the generated plan
    coachNotes,
    setCoachNotes,

    // Loading states
    isGenerating,
    warnings,

    // Actions
    generatePlan,
  };
}
