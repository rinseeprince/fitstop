"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ClipboardCheck,
  Flame,
  MessageSquare,
} from "lucide-react";
import type { CheckIn } from "@/types/check-in";
import type { ProgressData } from "@/services/client-portal-service";
import { GoalsSection } from "@/components/client/progress/goals-section";
import { DateRangeSelector } from "@/components/client/progress/date-range-selector";
import { MetricChartCard } from "@/components/clients/metrics/metric-chart-card";
import { useClientProgressMetrics } from "@/hooks/use-client-progress-metrics";

export default function ClientProgressPage() {
  const router = useRouter();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState("90");
  const [activeTab, setActiveTab] = useState("body");

  // Process metrics data for charts
  const { bodyMetrics, wellnessMetrics } = useClientProgressMetrics(progressData);

  useEffect(() => {
    async function fetchData() {
      try {
        const days = dateRange === "all" ? 365 : parseInt(dateRange);
        const [progressRes, checkInsRes] = await Promise.all([
          fetch(`/api/client/progress?days=${days}`),
          fetch("/api/client/check-ins?limit=10"),
        ]);

        if (!progressRes.ok) throw new Error("Failed to fetch progress");
        if (!checkInsRes.ok) throw new Error("Failed to fetch check-ins");

        const progressJson = await progressRes.json();
        const checkInsJson = await checkInsRes.json();

        setProgressData(progressJson.data);
        setCheckIns(checkInsJson.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
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

  // Calculate weight change
  const weightHistory = progressData?.weightHistory || [];
  const firstWeight = weightHistory[0]?.weight;
  const lastWeight = weightHistory[weightHistory.length - 1]?.weight;
  const weightChange = firstWeight && lastWeight ? lastWeight - firstWeight : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Progress</h1>
        <Button onClick={() => router.push("/client/check-in")}>
          <ClipboardCheck className="mr-2 h-4 w-4" />
          New Check-in
        </Button>
      </div>

      {/* Date Range Selector */}
      <div className="flex justify-end">
        <DateRangeSelector value={dateRange} onChange={setDateRange} />
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Current Streak"
          value={progressData?.currentStreak || 0}
          suffix="weeks"
          icon={Flame}
        />
        <StatCard
          label="Adherence"
          value={Math.round(progressData?.adherenceRate || 0)}
          suffix="%"
          icon={TrendingUp}
        />
        <StatCard
          label="Check-ins"
          value={progressData?.checkInCount || 0}
          suffix="total"
          icon={Calendar}
        />
      </div>

      {/* Goals Section */}
      {progressData && (
        <GoalsSection 
          client={progressData.client} 
          latestWeight={lastWeight}
          latestBodyFat={progressData.bodyFatHistory[progressData.bodyFatHistory.length - 1]?.bodyFatPercentage}
        />
      )}

      {/* Metrics with Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="body">Body Metrics</TabsTrigger>
              <TabsTrigger value="wellness">Wellness</TabsTrigger>
            </TabsList>
            
            <TabsContent value="body" className="mt-6">
              <div className="max-h-[600px] overflow-y-auto space-y-4 pr-2">
                {bodyMetrics.map((metric) => (
                  <MetricChartCard
                    key={metric.id}
                    id={metric.id}
                    name={metric.name}
                    currentValue={metric.currentValue}
                    unit={metric.unit}
                    percentChange={metric.percentChange}
                    trend={metric.trend}
                    chartData={metric.chartData}
                  />
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="wellness" className="mt-6">
              <div className="max-h-[600px] overflow-y-auto space-y-4 pr-2">
                {wellnessMetrics.map((metric) => (
                  <MetricChartCard
                    key={metric.id}
                    id={metric.id}
                    name={metric.name}
                    currentValue={metric.currentValue}
                    unit={metric.unit}
                    percentChange={metric.percentChange}
                    trend={metric.trend}
                    chartData={metric.chartData}
                  />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Check-in History */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Check-ins</h2>
        {checkIns.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <ClipboardCheck className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No Check-ins Yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Submit your first check-in to start tracking your progress.
              </p>
              <Button
                className="mt-4"
                onClick={() => router.push("/client/check-in")}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Submit Check-in
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {checkIns.map((checkIn) => (
              <CheckInCard key={checkIn.id} checkIn={checkIn} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  suffix: string;
  icon: React.ComponentType<{ className?: string }>;
}

function StatCard({ label, value, suffix, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">
              {value}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {suffix}
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeightChangeBadge({ change }: { change: number }) {
  const isGain = change > 0;
  const isLoss = change < 0;

  return (
    <Badge
      variant={isLoss ? "default" : isGain ? "secondary" : "outline"}
      className="flex items-center gap-1"
    >
      {isGain ? (
        <TrendingUp className="h-3 w-3" />
      ) : isLoss ? (
        <TrendingDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      {isGain ? "+" : ""}
      {change.toFixed(1)} lbs
    </Badge>
  );
}

function CheckInCard({ checkIn }: { checkIn: CheckIn }) {
  const date = new Date(checkIn.createdAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const bodyMetrics = [];
  if (checkIn.weight) bodyMetrics.push(`Weight: ${checkIn.weight} ${checkIn.weightUnit || "lbs"}`);
  if (checkIn.bodyFatPercentage) bodyMetrics.push(`Body Fat: ${checkIn.bodyFatPercentage}%`);
  if (checkIn.waist) bodyMetrics.push(`Waist: ${checkIn.waist} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.hips) bodyMetrics.push(`Hips: ${checkIn.hips} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.chest) bodyMetrics.push(`Chest: ${checkIn.chest} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.arms) bodyMetrics.push(`Arms: ${checkIn.arms} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.thighs) bodyMetrics.push(`Thighs: ${checkIn.thighs} ${checkIn.measurementUnit || "in"}`);

  const wellnessMetrics = [];
  if (checkIn.mood) wellnessMetrics.push(`Mood: ${checkIn.mood}/5`);
  if (checkIn.energy) wellnessMetrics.push(`Energy: ${checkIn.energy}/10`);
  if (checkIn.sleep) wellnessMetrics.push(`Sleep: ${checkIn.sleep}/10`);
  if (checkIn.stress) wellnessMetrics.push(`Stress: ${checkIn.stress}/10`);

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => window.location.href = `/client/progress/check-in/${checkIn.id}`}
    >
      <CardContent className="py-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="font-medium">{formattedDate}</p>
            <Badge variant="outline" className="capitalize">
              {checkIn.status.replace(/_/g, " ")}
            </Badge>
          </div>
          
          {/* Body Metrics */}
          {bodyMetrics.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Body Measurements</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {bodyMetrics.map((metric, idx) => (
                  <span key={idx} className="bg-muted/50 px-2 py-1 rounded text-xs">
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Wellness Metrics */}
          {wellnessMetrics.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Wellness</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {wellnessMetrics.map((metric, idx) => (
                  <span key={idx} className="bg-muted/50 px-2 py-1 rounded text-xs">
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Training & Nutrition */}
          {(checkIn.workoutsCompleted || checkIn.adherencePercentage || checkIn.nutritionDaysOnTarget) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Training & Nutrition</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {checkIn.workoutsCompleted && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Workouts: {checkIn.workoutsCompleted}
                  </span>
                )}
                {checkIn.adherencePercentage && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Adherence: {checkIn.adherencePercentage}%
                  </span>
                )}
                {checkIn.nutritionDaysOnTarget && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Nutrition: {checkIn.nutritionDaysOnTarget}/7 days
                  </span>
                )}
              </div>
            </div>
          )}
          
          {/* Coach Response */}
          {checkIn.coachResponse && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm">{checkIn.coachResponse}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
