"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import {
  useClearBlockFacts,
  useClientBlocks,
} from "@/components/clients/metrics/hooks/use-client-blocks";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
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
};

type NutritionSettings = {
  proteinTargetGPerKg: number;
  dietType: DietType;
};

export function useNutritionBuilder({
  client,
  onUpdate,
  roundTripBlockId = null,
}: UseNutritionBuilderProps) {
  const { toast } = useToast();
  const nutritionPlan = useNutritionPlan({ client });
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearBlockFacts = useClearBlockFacts();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();

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
  const calcInputs = nutritionPlan.nutritionData?.calcInputs ?? null;

  // The day the plan takes effect — the coach's pick, else the client's today
  // (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D27). Derived rather than seeded
  // so the default follows the client's day across their midnight, and taken
  // from the resolved inputs — the day the server's past-date belt judges —
  // never from the coach's browser clock.
  const [effectiveFromPick, setEffectiveFromPick] = useState<string | null>(null);
  const clientToday = calcInputs?.today ?? null;
  // The earliest day targets may START: the shared deletion floor — the
  // client's today, or tomorrow once they have logged anything today. A server
  // answer, so it rides the blocks payload beside the blocks themselves. Null
  // until the resolved inputs have loaded, like everything here; today until
  // the payload lands, and never before today whatever it says. The server's
  // own belt refuses a start before it either way.
  const { blocks, planStartFloor } = useClientBlocks(client.id);
  const startFloor = clientToday
    ? planStartFloor && planStartFloor > clientToday
      ? planStartFloor
      : clientToday
    : null;
  // The Block field over the date: the client's blocks whose end is on or after
  // the floor, then No block. The coach's own pick wins; with none, the block
  // they came from is preselected; else No block. The selected option's window
  // bounds the date field AND seeds the start — a derivation, never a second
  // copy of the date, so the two cannot disagree; a block already under way
  // seeds the floor, not the day it began. Empty, and so no window, until the
  // floor is known.
  const blockOptions = useMemo(
    () => (startFloor ? buildBlockStartOptions(blocks, startFloor) : []),
    [blocks, startFloor]
  );
  const [blockPick, setBlockPick] = useState<string | null>(null);
  const selectedBlock =
    blockOptions.length > 0
      ? selectBlockStartOption(blockOptions, blockPick, roundTripBlockId)
      : null;
  const startWindow = selectedBlock?.window ?? null;
  const effectiveFrom = effectiveFromPick ?? startWindow?.min ?? null;

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

  // Activity burn toggle
  const [includeActivityBurn, setIncludeActivityBurn] = useState(client.includeActivityBurn);
  const [isSavingBurnToggle, setIsSavingBurnToggle] = useState(false);

  const handleToggleActivityBurn = useCallback(
    async (value: boolean) => {
      setIncludeActivityBurn(value);
      setIsSavingBurnToggle(true);
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeActivityBurn: value }),
        });
        if (!res.ok) throw new Error("Failed to update");
        onUpdate?.();
      } catch {
        toast({
          title: "Error",
          description: "Failed to update activity burn setting",
          variant: "destructive",
        });
        setIncludeActivityBurn(!value);
      } finally {
        setIsSavingBurnToggle(false);
      }
    },
    [client.id, onUpdate, toast]
  );

  // Surplus distribution toggle (mig 117): false = keep the plan's carb:fat ratio
  // on a training-day surplus; true = add the whole surplus as carbs.
  const [surplusAsCarbs, setSurplusAsCarbs] = useState(client.surplusAsCarbs);
  const [isSavingSurplusToggle, setIsSavingSurplusToggle] = useState(false);

  const handleToggleSurplusAsCarbs = useCallback(
    async (value: boolean) => {
      setSurplusAsCarbs(value);
      setIsSavingSurplusToggle(true);
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surplusAsCarbs: value }),
        });
        if (!res.ok) throw new Error("Failed to update");
        onUpdate?.();
      } catch {
        toast({
          title: "Error",
          description: "Failed to update surplus setting",
          variant: "destructive",
        });
        setSurplusAsCarbs(!value);
      } finally {
        setIsSavingSurplusToggle(false);
      }
    },
    [client.id, onUpdate, toast]
  );

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
    // An emptied picker means the block's first available day again, not an
    // empty string.
    setEffectiveFromPick(date || null);
    setSettingsChanged(true);
  }, []);

  const handleBlockChange = useCallback((value: string) => {
    setBlockPick(value);
    // Choosing a block SETS the start: the date re-seeds from the block's
    // window, and the coach moves it inside the window from there.
    setEffectiveFromPick(null);
    setSettingsChanged(true);
  }, []);

  // Generate nutrition plan. `useManual` posts the coach's typed targets as the
  // custom-macro override; otherwise the server recalculates from the same
  // pickers the preview used, so the saved numbers match what was on screen.
  const generatePlan = useCallback(
    async (useManual = false) => {
      const validation = validateClientForNutrition(client);
      if (!validation.valid) {
        toast({
          title: "Missing required data",
          description: validation.errors.join(", "),
          variant: "destructive",
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
          toast({
            title: "Nutrition plan generated",
            description: `${data.plan.calorieTarget} cal/day with ${data.plan.proteinTargetG}g protein`,
          });
          setSettingsChanged(false);
          setCoachNotes("");
          // The next save defaults to today again (D27) — and to No block,
          // unless a round trip is still preselecting one.
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
          return true;
        } else {
          throw new Error(data.error || "Failed to generate plan");
        }
      } catch (error) {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to generate plan",
          variant: "destructive",
        });
        return false;
      } finally {
        setIsGenerating(false);
      }
    },
    [
      client,
      settings,
      effectiveFrom,
      manual.manualTargets,
      manual.manualBlockingError,
      coachNotes,
      onUpdate,
      toast,
      nutritionPlan,
      invalidateNutritionCalendar,
      clearBlockFacts,
      clearClientOverview,
      clearAttentionFeed,
    ]
  );

  return {
    // Spread base nutrition plan state
    ...nutritionPlan,

    // Settings pickers (seeded from the active plan)
    settings,
    settingsChanged,
    handleSettingsChange,

    // The day the plan takes effect: the coach's pick, else the selected
    // block's first available day — the floor (the client's today, or tomorrow
    // once they have logged today) for No block or a block under way, a future
    // block's start otherwise. Null until the resolved inputs have loaded.
    effectiveFrom,
    clientToday,
    startFloor,
    handleEffectiveFromChange,

    // The Block field: its options, the selected value, and the window that
    // bounds the date field — `min`/`max` on the input.
    blockOptions,
    blockValue: selectedBlock?.value ?? NO_BLOCK_OPTION,
    startWindow,
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

    // Activity burn toggle
    includeActivityBurn,
    isSavingBurnToggle,
    handleToggleActivityBurn,

    // Surplus distribution toggle
    surplusAsCarbs,
    isSavingSurplusToggle,
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
