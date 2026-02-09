"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Utensils, Flame, Beef, Wheat, Droplets } from "lucide-react";
import type { NutritionTargets } from "@/services/client-portal-service";
import { VerticalNutritionView } from "@/components/client-portal/nutrition/vertical-nutrition-view";

export default function ClientNutritionPage() {
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/client/nutrition");
        if (!res.ok) throw new Error("Failed to fetch nutrition data");

        const data = await res.json();
        setTargets(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const hasNutritionPlan = targets && (targets.calorieTarget || targets.customCalories);
  const hasDailyTargets = targets?.dailyTargets && targets.dailyTargets.length > 0;

  if (!hasNutritionPlan) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Nutrition Plan</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <Utensils className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No Nutrition Plan Yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Your coach hasn&apos;t set up your nutrition targets yet.
              Check back soon!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nutrition Plan</h1>
        <p className="mt-1 text-muted-foreground">
          Your daily macro targets set by your coach
        </p>
        {targets.dietType && (
          <Badge variant="secondary" className="capitalize mt-2">
            {targets.dietType.replace(/_/g, " ")} diet
          </Badge>
        )}
        {targets.customMacrosEnabled && (
          <Badge variant="outline" className="ml-2 mt-2">
            Custom macros
          </Badge>
        )}
      </div>

      {hasDailyTargets ? (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Your calories vary based on training days. Expand each day for detailed breakdown.
            </p>
          </div>
          <VerticalNutritionView targets={targets.dailyTargets!} />
        </div>
      ) : (
        // Fallback to single daily view if no training plan is available
        <SingleDayFallback targets={targets} />
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to Hit Your Targets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            These are your daily nutrition targets. Focus on hitting your
            protein goal first, then fill in the rest with carbs and fats.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>Track your meals using a food tracking app</li>
            <li>Aim to be within 10% of each target</li>
            <li>Consistency matters more than perfection</li>
            {hasDailyTargets && (
              <li>Your calories are higher on training days to fuel your workouts</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// Fallback component when no daily targets are available
function SingleDayFallback({ targets }: { targets: NutritionTargets }) {
  // Use custom macros if enabled, otherwise use calculated values
  const calories = targets.customMacrosEnabled && targets.customCalories
    ? targets.customCalories
    : targets.calorieTarget;
  const protein = targets.customMacrosEnabled && targets.customProteinG
    ? targets.customProteinG
    : targets.proteinTargetG;
  const carbs = targets.customMacrosEnabled && targets.customCarbG
    ? targets.customCarbG
    : targets.carbTargetG;
  const fat = targets.customMacrosEnabled && targets.customFatG
    ? targets.customFatG
    : targets.fatTargetG;

  return (
    <>
      {/* Calories Card */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                <Flame className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Daily Calories</p>
                <p className="text-3xl font-bold">{calories?.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Macros Grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MacroCard
          label="Protein"
          value={protein}
          unit="g"
          icon={Beef}
          color="text-red-500"
          bgColor="bg-red-500/10"
        />
        <MacroCard
          label="Carbs"
          value={carbs}
          unit="g"
          icon={Wheat}
          color="text-amber-500"
          bgColor="bg-amber-500/10"
        />
        <MacroCard
          label="Fat"
          value={fat}
          unit="g"
          icon={Droplets}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
        />
      </div>
    </>
  );
}

interface MacroCardProps {
  label: string;
  value?: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}

function MacroCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  bgColor,
}: MacroCardProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bgColor}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">
              {value ?? "-"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {unit}
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
