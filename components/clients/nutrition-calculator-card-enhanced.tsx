"use client";

import { useState, useEffect } from "react";
import type { Client, ActivityLevel, DietType, UnitPreference } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionWarnings } from "./nutrition-warnings";
import { NutritionDayAccordion } from "./nutrition-day-accordion";
import { UnitToggle } from "./unit-toggle";
import { AlertCircle, RefreshCw, Settings2, ChevronDown, ChevronUp, History, Dumbbell, Flame } from "lucide-react";
import { NutritionPlanHistoryModal } from "./nutrition-plan-history-modal";
import {
  shouldShowRegenerationBanner,
  getWeightChange,
  formatWeight,
  weightToKg,
  kgToLbs,
  getActivityLevelLabel,
  getProteinTargetLabel,
  getWeeklyNutritionTargets,
  getTrainingDays,
} from "@/utils/nutrition-helpers";
import {
  calculateDailyTrainingCalories,
  calculateWeeklyTrainingCalories,
  getTrainingCaloriesByDay,
} from "@/utils/training-calorie-helpers";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import { format, addDays } from "date-fns";

type NutritionCalculatorCardEnhancedProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionCalculatorCardEnhanced({
  client,
  onUpdate,
}: NutritionCalculatorCardEnhancedProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingUnit, setIsSavingUnit] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(!client.calorieTarget);
  const [showCustomMacros, setShowCustomMacros] = useState(false);
  const [settingsChanged, setSettingsChanged] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [customMacrosValidationError, setCustomMacrosValidationError] = useState<string | null>(null);
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [isLoadingTrainingPlan, setIsLoadingTrainingPlan] = useState(true);

  const [unitPreference, setUnitPreference] = useState<UnitPreference>(
    client.unitPreference || "imperial"
  );

  const [settings, setSettings] = useState({
    workActivityLevel: client.workActivityLevel || ("sedentary" as ActivityLevel),
    proteinTargetGPerKg: client.proteinTargetGPerKg || 2.0,
    dietType: client.dietType || ("balanced" as DietType),
    goalDeadline: client.goalDeadline || "",
  });

  const [customMacros, setCustomMacros] = useState({
    protein: client.customProteinG || 0,
    carbs: client.customCarbG || 0,
    fat: client.customFatG || 0,
    calories: client.customCalories || 0,
  });

  // Fetch training plan on mount
  useEffect(() => {
    const fetchTrainingPlan = async () => {
      try {
        const res = await fetch(`/api/clients/${client.id}/training`);
        const data = await res.json();
        if (data.success && data.plan) {
          setTrainingPlan(data.plan);
        }
      } catch (error) {
        console.error("Failed to fetch training plan:", error);
      } finally {
        setIsLoadingTrainingPlan(false);
      }
    };
    fetchTrainingPlan();
  }, [client.id]);

  // Validate custom macros whenever they change
  useEffect(() => {
    if (customMacros.protein > 0 || customMacros.carbs > 0 || customMacros.fat > 0) {
      const calculatedCalories = (customMacros.protein * 4) + (customMacros.carbs * 4) + (customMacros.fat * 9);
      const difference = Math.abs(customMacros.calories - calculatedCalories);

      if (customMacros.calories > 0 && difference > 50) {
        setCustomMacrosValidationError(
          `Calories should be within ±50 of calculated total (${calculatedCalories} cal from macros)`
        );
      } else {
        setCustomMacrosValidationError(null);
      }
    } else {
      setCustomMacrosValidationError(null);
    }
  }, [customMacros]);

  const showBanner =
    client.currentWeight &&
    client.nutritionPlanBaseWeightKg &&
    shouldShowRegenerationBanner(
      weightToKg(client.currentWeight, client.weightUnit || "lbs"),
      client.nutritionPlanBaseWeightKg
    );

  // Calculate auto training calories from plan
  const dailyTrainingCalories = trainingPlan ? calculateDailyTrainingCalories(trainingPlan) : 0;
  const weeklyTrainingCalories = trainingPlan ? calculateWeeklyTrainingCalories(trainingPlan) : 0;
  const trainingCaloriesByDay = trainingPlan ? getTrainingCaloriesByDay(trainingPlan) : null;

  // Calculate weekly nutrition targets with training day distribution
  // Use baselineCalories (TDEE - deficit) as the base, training calories are added per-day
  const baselineCalories = client.baselineCalories || client.calorieTarget;
  const weeklyTargets =
    baselineCalories && client.proteinTargetG
      ? getWeeklyNutritionTargets(
          baselineCalories,
          client.proteinTargetG,
          trainingPlan,
          client.dietType || "balanced"
        )
      : null;

  // Calculate weekly total and training/rest breakdown
  const weeklyTotal = weeklyTargets
    ? weeklyTargets.reduce((sum, day) => sum + day.calories, 0)
    : (client.calorieTarget || 0) * 7;

  const trainingDaysSet = getTrainingDays(trainingPlan);
  const trainingDaysCount = trainingDaysSet.size;
  const restDaysCount = 7 - trainingDaysCount;

  const handleUnitChange = async (newUnit: UnitPreference) => {
    setUnitPreference(newUnit);
    setIsSavingUnit(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/nutrition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitPreference: newUnit }),
      });

      if (!res.ok) throw new Error("Failed to update unit preference");

      onUpdate?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update unit preference",
        variant: "destructive",
      });
      setUnitPreference(client.unitPreference || "imperial");
    } finally {
      setIsSavingUnit(false);
    }
  };

  const handleSettingsChange = (newSettings: {
    workActivityLevel: ActivityLevel;
    proteinTargetGPerKg: number;
    dietType: DietType;
    goalDeadline?: string;
  }) => {
    setSettings({
      ...newSettings,
      goalDeadline: newSettings.goalDeadline || "",
    });
    setSettingsChanged(true);
  };

  const handleGenerate = async (useCustomMacros = false) => {
    const validation = validateClientForNutrition(client);
    if (!validation.valid) {
      toast({
        title: "Missing required data",
        description: validation.errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const body: any = {
        workActivityLevel: settings.workActivityLevel,
        proteinTargetGPerKg: settings.proteinTargetGPerKg,
        dietType: settings.dietType,
        goalDeadline: settings.goalDeadline || undefined,
      };

      if (useCustomMacros) {
        body.customMacrosEnabled = true;
        body.customProteinG = customMacros.protein;
        body.customCarbG = customMacros.carbs;
        body.customFatG = customMacros.fat;
        body.customCalories = customMacros.calories;
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
        setShowSettings(false);
        setSettingsChanged(false);
        onUpdate?.();
      } else {
        throw new Error(data.error || "Failed to generate plan");
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to generate plan",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Calculate pure TDEE (BMR × activity multiplier, no training calories)
  // Training calories are now added per-day in the weekly targets
  const getAdjustedTdee = () => {
    // Use saved TDEE if available (calculated when nutrition settings are configured)
    if (client.tdee) {
      return client.tdee;
    }

    // Fallback calculation if TDEE not saved yet
    if (!client.bmr || !client.workActivityLevel) {
      return null;
    }

    const activityMultipliers = {
      sedentary: 1.2,
      lightly_active: 1.375,
      moderately_active: 1.55,
      very_active: 1.725,
      extremely_active: 1.9,
    };

    const activityMultiplier = activityMultipliers[client.workActivityLevel];
    return Math.round(client.bmr * activityMultiplier);
  };

  // Calculate projected timeline based on baseline calories and TDEE
  const getProjectedDate = () => {
    const baseline = client.baselineCalories || client.calorieTarget;
    if (!client.goalWeight || !client.currentWeight || !baseline) {
      return null;
    }

    const tdee = getAdjustedTdee();
    if (!tdee) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const weightToLoseKg = currentWeightKg - goalWeightKg;

    if (Math.abs(weightToLoseKg) < 0.1) return null;

    // Daily deficit is TDEE - baseline (not including training calories which are extra)
    const dailyDeficit = tdee - baseline;
    const weeklyWeightChangeKg = (dailyDeficit * 7) / 7700;

    if (Math.abs(weeklyWeightChangeKg) < 0.01) return null;

    const weeksNeeded = weightToLoseKg / weeklyWeightChangeKg;
    const daysNeeded = Math.round(weeksNeeded * 7);

    return addDays(new Date(), daysNeeded);
  };

  const projectedDate = getProjectedDate();

  // Calculate weight remaining
  const getWeightRemaining = () => {
    if (!client.goalWeight || !client.currentWeight) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const remainingKg = Math.abs(currentWeightKg - goalWeightKg);
    const isLoss = currentWeightKg > goalWeightKg;

    const value = unitPreference === "imperial" ? kgToLbs(remainingKg) : remainingKg;
    const unit = unitPreference === "imperial" ? "lbs" : "kg";

    return { value: value.toFixed(1), unit, isLoss };
  };

  const weightRemaining = getWeightRemaining();

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nutrition Plan</CardTitle>
          <div className="flex items-center gap-3">
            <UnitToggle
              value={unitPreference}
              onChange={handleUnitChange}
              disabled={isSavingUnit}
            />
            {client.calorieTarget && (
              <>
                <Badge variant="outline">Plan active</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistoryModal(true)}
                  className="gap-2"
                >
                  <History className="h-4 w-4" />
                  History
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Regeneration Banner */}
        {showBanner && client.currentWeight && client.nutritionPlanBaseWeightKg && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    Client weight has changed significantly
                  </p>
                  <p className="text-sm text-amber-800 mt-1">
                    Weight changed by{" "}
                    {(() => {
                      const change = getWeightChange(
                        weightToKg(client.currentWeight, client.weightUnit || "lbs"),
                        client.nutritionPlanBaseWeightKg,
                        unitPreference
                      );
                      return `${change.isLoss ? "-" : "+"}${change.value} ${change.unit}`;
                    })()}{" "}
                    since plan was created (
                    {formatWeight(client.nutritionPlanBaseWeightKg, unitPreference)} →{" "}
                    {formatWeight(
                      weightToKg(client.currentWeight, client.weightUnit || "lbs"),
                      unitPreference
                    )}
                    )
                  </p>
                </div>
                <Button onClick={() => handleGenerate()} size="sm" className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate Nutrition Plan
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Plan Status Bar */}
        {client.nutritionPlanCreatedDate && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm text-muted-foreground border-b pb-4">
            <div>
              Plan created on{" "}
              <span className="font-medium text-foreground">
                {format(new Date(client.nutritionPlanCreatedDate), "MMM d, yyyy")}
              </span>{" "}
              at{" "}
              <span className="font-medium text-foreground">
                {formatWeight(client.nutritionPlanBaseWeightKg || 0, unitPreference)}
              </span>
            </div>
            {client.currentWeight && (
              <div>
                Current:{" "}
                <span className="font-medium text-foreground">
                  {formatWeight(
                    weightToKg(client.currentWeight, client.weightUnit || "lbs"),
                    unitPreference
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Weekly Summary */}
        {client.calorieTarget && (
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Weekly Total</p>
                <p className="text-2xl font-bold">{weeklyTotal.toLocaleString()} cal</p>
              </div>
              {weightRemaining && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-1">Progress</p>
                  <p className="text-lg font-semibold">
                    {weightRemaining.isLoss ? "-" : "+"}
                    {weightRemaining.value} {weightRemaining.unit} to go
                  </p>
                </div>
              )}
              {trainingPlan && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-1">Schedule</p>
                  <p className="text-sm font-medium">
                    {trainingDaysCount} training / {restDaysCount} rest days
                  </p>
                </div>
              )}
            </div>
            {projectedDate && (
              <div className="mt-3 pt-3 border-t border-muted">
                <p className="text-xs text-muted-foreground">
                  Projected goal date:{" "}
                  <span className="font-medium text-foreground">
                    {format(projectedDate, "MMM d, yyyy")}
                  </span>
                  {client.goalDeadline && new Date(client.goalDeadline) < projectedDate && (
                    <span className="text-amber-600 ml-2">
                      ({Math.ceil((projectedDate.getTime() - new Date(client.goalDeadline).getTime()) / (1000 * 60 * 60 * 24))} days past target)
                    </span>
                  )}
                  {client.goalDeadline && new Date(client.goalDeadline) > projectedDate && (
                    <span className="text-green-600 ml-2">
                      ({Math.ceil((new Date(client.goalDeadline).getTime() - projectedDate.getTime()) / (1000 * 60 * 60 * 24))} days ahead)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && <NutritionWarnings warnings={warnings} />}

        {/* Day-based Accordion Display */}
        {weeklyTargets && !client.customMacrosEnabled ? (
          <NutritionDayAccordion targets={weeklyTargets} />
        ) : client.calorieTarget ? (
          // Fallback for custom macros - show same values for all days
          <div className="text-center py-6 border rounded-lg">
            <div className="text-4xl font-bold text-primary">
              {client.calorieTarget.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              calories per day (custom macros)
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t mx-4">
              <div className="text-center">
                <div className="text-xl font-bold text-blue-500">
                  {client.customProteinG || client.proteinTargetG}g
                </div>
                <div className="text-xs text-muted-foreground">Protein</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-green-500">
                  {client.customCarbG || client.carbTargetG}g
                </div>
                <div className="text-xs text-muted-foreground">Carbs</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-amber-500">
                  {client.customFatG || client.fatTargetG}g
                </div>
                <div className="text-xs text-muted-foreground">Fat</div>
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-3">Custom macros active - same targets each day</p>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No nutrition plan generated yet</p>
            <p className="text-sm mt-2">
              Configure settings below and generate a plan
            </p>
          </div>
        )}

        {/* Auto-Calculated Training Calories Display */}
        {trainingPlan && (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Flame className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-orange-900">Training Calories (Auto-calculated)</h4>
                  <Badge variant="outline" className="text-orange-700 border-orange-300">
                    From Training Plan
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-orange-700">+{dailyTrainingCalories}</p>
                    <p className="text-xs text-orange-600">cal/day average</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-orange-700">{weeklyTrainingCalories}</p>
                    <p className="text-xs text-orange-600">cal/week total</p>
                  </div>
                </div>
                {trainingCaloriesByDay && (
                  <div className="mt-3 pt-3 border-t border-orange-200">
                    <p className="text-xs text-orange-700 mb-2">Daily breakdown:</p>
                    <div className="flex flex-wrap gap-2">
                      {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => {
                        const cals = trainingCaloriesByDay[day as keyof typeof trainingCaloriesByDay] || 0;
                        const shortDay = day.slice(0, 3);
                        return (
                          <div
                            key={day}
                            className={`text-xs px-2 py-1 rounded ${
                              cals > 0
                                ? "bg-orange-100 text-orange-800"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {shortDay.charAt(0).toUpperCase() + shortDay.slice(1)}: {cals > 0 ? `+${cals}` : "Rest"}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No Training Plan Message */}
        {!trainingPlan && !isLoadingTrainingPlan && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Dumbbell className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-700">No active training plan</p>
                <p className="text-xs text-gray-500 mt-1">
                  Training calories will be calculated automatically when you create a training plan.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Current Settings Display */}
        {client.calorieTarget && !showSettings && (
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Current Settings</h4>
              <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
                Edit Settings
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Activity Level:</span>
                <p className="font-medium mt-0.5">
                  {client.workActivityLevel ? getActivityLevelLabel(client.workActivityLevel) : "Not set"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Diet Type:</span>
                <p className="font-medium mt-0.5 capitalize">
                  {client.dietType?.replace("_", " ") || "Not set"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Protein Target:</span>
                <p className="font-medium mt-0.5">
                  {client.proteinTargetGPerKg
                    ? getProteinTargetLabel(client.proteinTargetGPerKg, unitPreference)
                    : "Not set"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Training Calories:</span>
                <p className="font-medium mt-0.5">
                  {trainingPlan ? `+${dailyTrainingCalories} cal/day` : "No plan"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Settings Section */}
        {showSettings && (
          <div className="space-y-4 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Plan Settings
              </h3>
              {client.calorieTarget && (
                <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                  Hide Settings
                </Button>
              )}
            </div>

            <NutritionSettingsForm client={client} onSettingsChange={handleSettingsChange} />

            {/* Manual Override Section */}
            <div className="border-t pt-4">
              <button
                onClick={() => setShowCustomMacros(!showCustomMacros)}
                className="flex items-center justify-between w-full text-sm font-medium hover:text-primary transition-colors"
              >
                <span>Advanced: Edit macros manually</span>
                {showCustomMacros ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showCustomMacros && (
                <div className="mt-4 space-y-3 pl-4 border-l-2">
                  <p className="text-xs text-muted-foreground">
                    Override calculated macros with custom values (applies same targets to all days)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="custom-protein" className="text-xs">
                        Protein (g)
                      </Label>
                      <Input
                        id="custom-protein"
                        type="number"
                        value={customMacros.protein}
                        onChange={(e) =>
                          setCustomMacros({ ...customMacros, protein: parseInt(e.target.value) || 0 })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="custom-carbs" className="text-xs">
                        Carbs (g)
                      </Label>
                      <Input
                        id="custom-carbs"
                        type="number"
                        value={customMacros.carbs}
                        onChange={(e) =>
                          setCustomMacros({ ...customMacros, carbs: parseInt(e.target.value) || 0 })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="custom-fat" className="text-xs">
                        Fat (g)
                      </Label>
                      <Input
                        id="custom-fat"
                        type="number"
                        value={customMacros.fat}
                        onChange={(e) =>
                          setCustomMacros({ ...customMacros, fat: parseInt(e.target.value) || 0 })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="custom-calories" className="text-xs">
                        Calories
                      </Label>
                      <Input
                        id="custom-calories"
                        type="number"
                        value={customMacros.calories}
                        onChange={(e) =>
                          setCustomMacros({ ...customMacros, calories: parseInt(e.target.value) || 0 })
                        }
                        className="mt-1"
                        placeholder={`~${(customMacros.protein * 4 + customMacros.carbs * 4 + customMacros.fat * 9).toString()}`}
                      />
                    </div>
                  </div>
                  {customMacrosValidationError && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-800">{customMacrosValidationError}</p>
                    </div>
                  )}
                  <Button
                    onClick={() => handleGenerate(true)}
                    disabled={isGenerating || !!customMacrosValidationError}
                    size="sm"
                    variant="outline"
                    className="w-full"
                  >
                    Save Custom Macros
                  </Button>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={() => handleGenerate(false)}
                disabled={isGenerating}
                className="flex-1"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? "animate-spin" : ""}`} />
                {settingsChanged ? "Save & Regenerate Plan" : client.calorieTarget ? "Regenerate Plan" : "Generate Plan"}
              </Button>
            </div>

            {!client.bmr && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                <p className="font-medium">BMR not calculated</p>
                <p className="text-blue-800 mt-1">
                  Calculate BMR first using the button in the Profile tab.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Nutrition Plan History Modal */}
    <NutritionPlanHistoryModal
      clientId={client.id}
      unitPreference={unitPreference}
      open={showHistoryModal}
      onOpenChange={setShowHistoryModal}
    />
  </>
  );
}
