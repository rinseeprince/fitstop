"use client";

import { useState } from "react";
import type { Client, ActivityLevel, TrainingVolume, DietType, UnitPreference } from "@/types/check-in";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { NutritionTargetsDisplay } from "./nutrition-targets-display";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionWarnings } from "./nutrition-warnings";
import { UnitToggle } from "./unit-toggle";
import { AlertCircle, RefreshCw, Settings2, ChevronDown, ChevronUp, History } from "lucide-react";
import { NutritionPlanHistoryModal } from "./nutrition-plan-history-modal";
import {
  shouldShowRegenerationBanner,
  getWeightChange,
  formatWeight,
  weightToKg,
  kgToLbs,
  getActivityLevelLabel,
  getTrainingVolumeLabel,
  getProteinTargetLabel,
} from "@/utils/nutrition-helpers";
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

  const [unitPreference, setUnitPreference] = useState<UnitPreference>(
    client.unitPreference || "imperial"
  );

  const [settings, setSettings] = useState({
    workActivityLevel: client.workActivityLevel || ("sedentary" as ActivityLevel),
    trainingVolumeHours: client.trainingVolumeHours || ("0-1" as TrainingVolume),
    proteinTargetGPerKg: client.proteinTargetGPerKg || 2.0,
    dietType: client.dietType || ("balanced" as DietType),
    goalDeadline: client.goalDeadline || "",
  });

  const [customMacros, setCustomMacros] = useState({
    protein: client.customProteinG || 0,
    carbs: client.customCarbG || 0,
    fat: client.customFatG || 0,
  });

  const showBanner =
    client.currentWeight &&
    client.nutritionPlanBaseWeightKg &&
    shouldShowRegenerationBanner(
      weightToKg(client.currentWeight, client.weightUnit || "lbs"),
      client.nutritionPlanBaseWeightKg
    );

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
    trainingVolumeHours: TrainingVolume;
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
        trainingVolumeHours: settings.trainingVolumeHours,
        proteinTargetGPerKg: settings.proteinTargetGPerKg,
        dietType: settings.dietType,
        goalDeadline: settings.goalDeadline || undefined,
      };

      if (useCustomMacros) {
        body.customMacrosEnabled = true;
        body.customProteinG = customMacros.protein;
        body.customCarbG = customMacros.carbs;
        body.customFatG = customMacros.fat;
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

  // Calculate adjusted TDEE (BMR × activity + training calories)
  const getAdjustedTdee = () => {
    if (!client.bmr || !client.workActivityLevel || !client.trainingVolumeHours) {
      return client.tdee || null;
    }

    const activityMultipliers = {
      sedentary: 1.2,
      lightly_active: 1.375,
      moderately_active: 1.55,
      very_active: 1.725,
      extremely_active: 1.9,
    };

    const trainingCalories = {
      "0-1": 0,
      "2-3": 250,
      "4-5": 400,
      "6-7": 550,
      "8+": 700,
    };

    const activityMultiplier = activityMultipliers[client.workActivityLevel];
    const trainingCals = trainingCalories[client.trainingVolumeHours];

    return Math.round(client.bmr * activityMultiplier + trainingCals);
  };

  // Calculate projected timeline
  const getProjectedDate = () => {
    if (!client.goalWeight || !client.currentWeight || !client.calorieTarget) {
      return null;
    }

    const adjustedTdee = getAdjustedTdee();
    if (!adjustedTdee) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const weightToLoseKg = currentWeightKg - goalWeightKg;

    if (Math.abs(weightToLoseKg) < 0.1) return null;

    const dailyDeficit = adjustedTdee - client.calorieTarget;
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
          <CardTitle>Nutrition Calculator</CardTitle>
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
          <div className="bg-amber-50 border border-amber-200 rounded-xs p-4">
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

        {/* Warnings */}
        {warnings.length > 0 && <NutritionWarnings warnings={warnings} />}

        {/* Targets Display */}
        <NutritionTargetsDisplay client={client} />

        {/* Additional Info */}
        {client.calorieTarget && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-xs">
              {projectedDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Projected Timeline (at current deficit)</p>
                  <p className="text-sm font-medium">
                    Goal weight by {format(projectedDate, "MMM d, yyyy")}
                  </p>
                  {(() => {
                    const adjustedTdee = getAdjustedTdee();
                    const dailyDeficit = adjustedTdee ? adjustedTdee - client.calorieTarget! : 0;
                    const weeklyWeightLoss = (dailyDeficit * 7) / 7700;
                    return (
                      <p className="text-xs text-muted-foreground mt-1">
                        ~{weeklyWeightLoss.toFixed(2)}kg/week loss ({dailyDeficit} cal deficit)
                      </p>
                    );
                  })()}
                  {client.goalDeadline && new Date(client.goalDeadline) < projectedDate && (
                    <p className="text-xs text-amber-600 mt-1">
                      {Math.ceil((projectedDate.getTime() - new Date(client.goalDeadline).getTime()) / (1000 * 60 * 60 * 24))} days past target deadline
                    </p>
                  )}
                  {client.goalDeadline && new Date(client.goalDeadline) > projectedDate && (
                    <p className="text-xs text-green-600 mt-1">
                      {Math.ceil((new Date(client.goalDeadline).getTime() - projectedDate.getTime()) / (1000 * 60 * 60 * 24))} days ahead of target
                    </p>
                  )}
                </div>
              )}
              {weightRemaining && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Weight Progress</p>
                  <p className="text-sm font-medium">
                    {weightRemaining.isLoss ? "-" : "+"}
                    {weightRemaining.value} {weightRemaining.unit} to go
                  </p>
                </div>
              )}
            </div>
            {client.goalDeadline && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xs">
                <p className="text-xs text-muted-foreground mb-1">Target Deadline</p>
                <p className="text-sm font-medium text-blue-900">
                  {format(new Date(client.goalDeadline), "MMM d, yyyy")}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Current Settings Display */}
        {client.calorieTarget && !showSettings && (
          <div className="border rounded-xs p-4 space-y-3">
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
                <span className="text-muted-foreground">Training Volume:</span>
                <p className="font-medium mt-0.5">
                  {client.trainingVolumeHours ? getTrainingVolumeLabel(client.trainingVolumeHours) : "Not set"}
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
            </div>
          </div>
        )}

        {/* Settings Section */}
        {showSettings && (
          <div className="space-y-4 border rounded-xs p-4">
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
                    Override calculated macros with custom values
                  </p>
                  <div className="grid grid-cols-3 gap-3">
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
                  </div>
                  <Button
                    onClick={() => handleGenerate(true)}
                    disabled={isGenerating}
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
              <div className="bg-blue-50 border border-blue-200 rounded-xs p-3 text-sm text-blue-900">
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
