"use client";

import { useState, useEffect } from "react";
import type { Client, ActivityLevel, TrainingVolume, DietType } from "@/types/check-in";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { NutritionTargetsDisplay } from "./nutrition-targets-display";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionWarnings } from "./nutrition-warnings";
import { AlertCircle, RefreshCw, Settings2 } from "lucide-react";
import {
  shouldShowRegenerationBanner,
  getWeightChange,
  formatWeight,
  weightToKg,
} from "@/utils/nutrition-helpers";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import { format } from "date-fns";

type NutritionCalculatorCardProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionCalculatorCard({
  client,
  onUpdate,
}: NutritionCalculatorCardProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(!client.calorieTarget);

  const [settings, setSettings] = useState({
    workActivityLevel: client.workActivityLevel || ("sedentary" as ActivityLevel),
    trainingVolumeHours: client.trainingVolumeHours || ("0-1" as TrainingVolume),
    proteinTargetGPerKg: client.proteinTargetGPerKg || 2.0,
    dietType: client.dietType || ("balanced" as DietType),
    goalDeadline: client.goalDeadline || "",
  });

  // Check if regeneration banner should show
  const showBanner =
    client.currentWeight &&
    client.nutritionPlanBaseWeightKg &&
    shouldShowRegenerationBanner(
      weightToKg(client.currentWeight, client.weightUnit || "lbs"),
      client.nutritionPlanBaseWeightKg
    );

  const handleGenerate = async () => {
    // Validate client has required data
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
      const res = await fetch(`/api/clients/${client.id}/nutrition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workActivityLevel: settings.workActivityLevel,
          trainingVolumeHours: settings.trainingVolumeHours,
          proteinTargetGPerKg: settings.proteinTargetGPerKg,
          dietType: settings.dietType,
          goalDeadline: settings.goalDeadline || undefined,
        }),
      });

      const data = await res.json();

      if (data.success && data.plan) {
        setWarnings(data.plan.warnings || []);
        toast({
          title: "Nutrition plan generated",
          description: `${data.plan.calorieTarget} cal/day with ${data.plan.proteinTargetG}g protein`,
        });
        setShowSettings(false);
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

  const unitPreference = client.unitPreference || "imperial";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nutrition Calculator</CardTitle>
          <div className="flex items-center gap-2">
            {client.calorieTarget && (
              <Badge variant="outline">
                Plan active
              </Badge>
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
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-amber-900">
                  Client weight has changed significantly
                </p>
                <p className="text-sm text-amber-800">
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
                  {formatWeight(
                    client.nutritionPlanBaseWeightKg,
                    unitPreference
                  )}{" "}
                  →{" "}
                  {formatWeight(
                    weightToKg(client.currentWeight, client.weightUnit || "lbs"),
                    unitPreference
                  )}
                  )
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Plan Status */}
        {client.nutritionPlanCreatedDate && (
          <div className="flex items-center justify-between text-sm text-muted-foreground border-b pb-4">
            <div>
              Plan created on{" "}
              <span className="font-medium">
                {format(new Date(client.nutritionPlanCreatedDate), "MMM d, yyyy")}
              </span>{" "}
              at{" "}
              <span className="font-medium">
                {formatWeight(
                  client.nutritionPlanBaseWeightKg || 0,
                  unitPreference
                )}
              </span>
            </div>
            {client.currentWeight && (
              <div>
                Current:{" "}
                <span className="font-medium">
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

        {/* Settings Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Plan Settings
            </h3>
            {client.calorieTarget && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
              >
                {showSettings ? "Hide" : "Show"} Settings
              </Button>
            )}
          </div>

          {showSettings && (
            <div className="space-y-4">
              <NutritionSettingsForm
                client={client}
                onSettingsChange={(newSettings) => setSettings({
                  ...newSettings,
                  goalDeadline: newSettings.goalDeadline || "",
                })}
              />

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex-1"
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${isGenerating ? "animate-spin" : ""}`}
                  />
                  {client.calorieTarget
                    ? "Regenerate Nutrition Plan"
                    : "Generate Nutrition Plan"}
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
        </div>
      </CardContent>
    </Card>
  );
}
