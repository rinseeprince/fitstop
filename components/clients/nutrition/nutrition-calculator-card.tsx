"use client";

import { useState } from "react";
import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { NutritionTargetsDisplay } from "./display/nutrition-targets-display";
import { NutritionSettingsForm } from "./builder/nutrition-settings-form";
import { NutritionWarnings } from "./nutrition-warnings";
import { RefreshCw, Settings2 } from "lucide-react";
import { validateClientForNutrition } from "@/lib/validations/nutrition";

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
  const [showSettings, setShowSettings] = useState(true);
  const [hasPlan, setHasPlan] = useState(false);

  const [settings, setSettings] = useState({
    workActivityLevel: "sedentary" as ActivityLevel,
    proteinTargetGPerKg: 2.0,
    dietType: "balanced" as DietType,
    goalDeadline: client.goalDeadline || "",
  });

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
            {hasPlan && (
              <Badge variant="outline">
                Plan active
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* Warnings */}
        {warnings.length > 0 && <NutritionWarnings warnings={warnings} />}

        {/* Targets Display */}
        <NutritionTargetsDisplay unitPreference={unitPreference} />

        {/* Settings Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Plan Settings
            </h3>
            {hasPlan && (
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
                  {hasPlan
                    ? "Regenerate Nutrition Plan"
                    : "Generate Nutrition Plan"}
                </Button>
              </div>

              {!client.bmr && (
                <div className="bg-primary/10 border border-primary/30 rounded-xs p-3 text-sm text-foreground">
                  <p className="font-medium">BMR not calculated</p>
                  <p className="text-muted-foreground mt-1">
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
