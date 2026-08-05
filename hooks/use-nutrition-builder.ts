"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import {
  weightToKg,
  getActivityMultiplier,
} from "@/utils/nutrition-helpers";
import { addDays } from "date-fns";
import { useManualTargets, macroCalories, type MacroTargets } from "@/hooks/use-manual-targets";
// A PURE module (types + one arithmetic helper, no DB imports), so the browser
// runs the identical calculator the server does. That is what makes the preview
// authoritative rather than an approximation.
import { generateNutritionPlan } from "@/services/nutrition-service";

type UseNutritionBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export type NutritionSettings = {
  workActivityLevel: ActivityLevel;
  proteinTargetGPerKg: number;
  dietType: DietType;
};

export function useNutritionBuilder({ client, onUpdate }: UseNutritionBuilderProps) {
  const { toast } = useToast();
  const nutritionPlan = useNutritionPlan({ client, onUpdate });
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();

  const [settings, setSettings] = useState<NutritionSettings>({
    workActivityLevel: "sedentary",
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
    nd?.workActivityLevel && nd?.proteinTargetGPerKg && nd?.dietType
      ? `${nd.workActivityLevel}|${nd.proteinTargetGPerKg}|${nd.dietType}`
      : null;
  const settingsSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsSeedKey || settingsSeededRef.current === settingsSeedKey) return;
    const [workActivityLevel, proteinTargetGPerKg, dietType] = settingsSeedKey.split("|");
    setSettings({
      workActivityLevel: workActivityLevel as ActivityLevel,
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
  const autoPlan = useMemo(
    () =>
      calcInputs?.status === "ready"
        ? generateNutritionPlan({ ...calcInputs, ...settings })
        : null,
    [calcInputs, settings]
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

  /** What the drawer displays and what Generate posts. */
  const displayTargets: MacroTargets | null = manual.manualEnabled
    ? manual.manualTargets
    : autoTargets;

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
  const [warnings, setWarnings] = useState<string[]>([]);

  // Settings change handler
  const handleSettingsChange = useCallback((newSettings: Partial<NutritionSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    setSettingsChanged(true);
  }, []);

  // Generate nutrition plan. `useManual` posts the coach's typed targets as the
  // custom-macro override; otherwise the server recalculates from the same
  // pickers the preview used, so the saved numbers match what was on screen.
  const generatePlan = useCallback(
    async (useManual = false, effectiveFrom?: string | null) => {
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
          workActivityLevel: settings.workActivityLevel,
          proteinTargetGPerKg: settings.proteinTargetGPerKg,
          dietType: settings.dietType,
          // goalDeadline is no longer sent: the deadline is owned by
          // client_goals, resolved server-side. The builder's dead deadline
          // input was replaced by a read-only Goal line.
          ...(coachNotes.trim() ? { coachNotes: coachNotes.trim() } : {}),
          ...(effectiveFrom ? { effectiveFrom } : {}),
        };

        if (useManual) {
          const t = manual.manualTargets;
          body.customMacrosEnabled = true;
          body.customProteinG = t.proteinG;
          body.customCarbG = t.carbG;
          body.customFatG = t.fatG;
          // Always the re-totaled 4/4/9 figure, never a separately-typed
          // number, so the server's ±50 kcal tolerance cannot trip on rounding.
          body.customCalories = macroCalories(t);
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
          onUpdate?.();
          nutritionPlan.refetchNutrition();
          // The calendar renders from its own SWR events cache — revalidate it
          // or the regenerated days only appear after a page refresh.
          void invalidateNutritionCalendar(client.id);
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
      manual.manualTargets,
      coachNotes,
      onUpdate,
      toast,
      nutritionPlan,
      invalidateNutritionCalendar,
    ]
  );

  // Calculate projected goal date
  // 7700 calories = approximately 1kg of body weight
  const CALORIES_PER_KG = 7700;

  const getProjectedDate = useCallback(() => {
    const nd = nutritionPlan.nutritionData;
    const baseline = nd?.baselineCalories ?? nd?.calorieTarget;
    if (!client.goalWeight || !client.currentWeight || !baseline) return null;

    const tdee = client.tdee || (client.bmr ? Math.round(client.bmr * getActivityMultiplier(settings.workActivityLevel)) : null);
    if (!tdee) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const weightToLoseKg = currentWeightKg - goalWeightKg;

    if (Math.abs(weightToLoseKg) < 0.1) return null;

    const dailyDeficit = tdee - baseline;
    const weeklyWeightChangeKg = (dailyDeficit * 7) / CALORIES_PER_KG;
    if (Math.abs(weeklyWeightChangeKg) < 0.01) return null;

    const weeksNeeded = weightToLoseKg / weeklyWeightChangeKg;
    return addDays(new Date(), Math.round(weeksNeeded * 7));
  }, [client, nutritionPlan.nutritionData, settings.workActivityLevel]);

  return {
    // Spread base nutrition plan state
    ...nutritionPlan,

    // Settings pickers (seeded from the active plan)
    settings,
    settingsChanged,
    handleSettingsChange,

    // Live preview + manual override. `displayTargets` is the single thing the
    // UI renders and Generate posts — manual when the coach has taken over,
    // otherwise the live auto result. `autoTargets` stays available alongside
    // it so the manual mode can show what auto would have suggested WITHOUT
    // overwriting the typed numbers.
    autoPlan,
    autoTargets,
    displayTargets,
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

    // Computed
    projectedDate: getProjectedDate(),

    // Actions
    generatePlan,
  };
}
