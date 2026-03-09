"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DailyPulse } from "@/components/daily-pulse/daily-pulse";
import {
  Dumbbell,
  ClipboardCheck,
  TrendingUp,
  Utensils,
  Flame,
  Scale,
  Target,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import type { TrainingPlan } from "@/types/training";
import type { NutritionTargets, ProgressData } from "@/services/client-portal-service";

export default function ClientDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [nutrition, setNutrition] = useState<NutritionTargets | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  const firstName =
    user?.user_metadata?.name?.split(" ")[0] || "there";

  useEffect(() => {
    async function fetchData() {
      try {
        const [planRes, nutritionRes, progressRes] = await Promise.all([
          fetch("/api/client/training"),
          fetch("/api/client/nutrition"),
          fetch("/api/client/progress?days=30"),
        ]);

        if (planRes.ok) {
          const data = await planRes.json();
          setPlan(data.data);
        }
        if (nutritionRes.ok) {
          const data = await nutritionRes.json();
          setNutrition(data.data);
        }
        if (progressRes.ok) {
          const data = await progressRes.json();
          setProgress(data.data);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  const hasActivePlan = plan !== null;
  const hasNutrition = nutrition?.calorieTarget || nutrition?.customCalories;
  const currentStreak = progress?.currentStreak || 0;
  const adherenceRate = progress?.adherenceRate || 0;

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {firstName}!</h1>
        <p className="text-muted-foreground">
          Track your progress and stay connected with your coach.
        </p>
      </div>

      {/* Daily Pulse */}
      <DailyPulse />

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/10">
              <Flame className="h-6 w-6 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Streak</p>
              <p className="text-2xl font-semibold">{currentStreak} weeks</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
              <Target className="h-6 w-6 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Adherence</p>
              <p className="text-2xl font-semibold">{Math.round(adherenceRate)}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Current Metrics - Temporarily disabled while updating auth flow */}
      {/*{clientData && (clientData.currentWeight || clientData.goalWeight) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" />
              Your Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {clientData.currentWeight && (
                <div>
                  <p className="text-sm text-muted-foreground">Current Weight</p>
                  <p className="text-xl font-bold">
                    {clientData.currentWeight} {clientData.weightUnit || "lbs"}
                  </p>
                </div>
              )}
              {clientData.goalWeight && (
                <div>
                  <p className="text-sm text-muted-foreground">Goal Weight</p>
                  <p className="text-xl font-bold">
                    {clientData.goalWeight} {clientData.weightUnit || "lbs"}
                  </p>
                </div>
              )}
              {clientData.currentWeight && clientData.goalWeight && (
                <div>
                  <p className="text-sm text-muted-foreground">To Go</p>
                  <p className="text-xl font-bold">
                    {Math.abs(clientData.currentWeight - clientData.goalWeight).toFixed(1)}{" "}
                    {clientData.weightUnit || "lbs"}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}*/}

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Training Plan Card */}
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push("/client/training")}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Dumbbell className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Training Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {hasActivePlan ? (
              <div>
                <p className="font-medium">{plan.name}</p>
                <p className="text-sm text-muted-foreground">
                  {plan.frequencyPerWeek}x per week
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active training plan yet
              </p>
            )}
            <div className="mt-3 flex items-center text-sm text-primary">
              View plan
              <ArrowRight className="ml-1 h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        {/* Nutrition Card */}
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push("/client/nutrition")}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
              <Utensils className="h-5 w-5 text-warning" />
            </div>
            <CardTitle className="text-base">Nutrition</CardTitle>
          </CardHeader>
          <CardContent>
            {hasNutrition ? (
              <div>
                <p className="font-medium">
                  {nutrition.customMacrosEnabled && nutrition.customCalories
                    ? nutrition.customCalories
                    : nutrition.calorieTarget}{" "}
                  calories
                </p>
                <p className="text-sm text-muted-foreground">
                  {nutrition.proteinTargetG || nutrition.customProteinG}g protein
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No nutrition plan yet
              </p>
            )}
            <div className="mt-3 flex items-center text-sm text-primary">
              View nutrition
              <ArrowRight className="ml-1 h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        {/* Check-in Card */}
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push("/client/check-in")}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
              <ClipboardCheck className="h-5 w-5 text-success" />
            </div>
            <CardTitle className="text-base">Check-in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Submit your weekly check-in to keep your coach updated
            </p>
            <div className="mt-3 flex items-center text-sm text-primary">
              Start check-in
              <ArrowRight className="ml-1 h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        {/* Progress Card */}
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push("/client/progress")}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {progress?.checkInCount || 0} check-ins recorded
            </p>
            <div className="mt-3 flex items-center text-sm text-primary">
              View progress
              <ArrowRight className="ml-1 h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        {/* Resources Card */}
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push("/client/resources")}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Access videos, guides, and materials from your coach
            </p>
            <div className="mt-3 flex items-center text-sm text-primary">
              View resources
              <ArrowRight className="ml-1 h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
