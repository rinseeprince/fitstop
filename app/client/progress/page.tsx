"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp,
  Calendar,
  ClipboardCheck,
  Flame,
} from "lucide-react";
import type { CheckIn } from "@/types/check-in";
import type { ProgressData } from "@/services/client-portal-progress";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import { GoalsSection } from "@/components/client/progress/goals-section";
import { DateRangeSelector } from "@/components/client/progress/date-range-selector";
import { MetricChartCard } from "@/components/clients/metrics/metric-chart-card";
import { useClientProgressMetrics } from "@/hooks/use-client-progress-metrics";
import { HabitsSection } from "@/components/client/progress/habits-section";
import { CheckInCard } from "@/components/client-portal/check-in/check-in-card";
import { getDateString, getTodayDateString } from "@/lib/date-helpers";

export default function ClientProgressPage() {
  const router = useRouter();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [habits, setHabits] = useState<DailyHabit[]>([]);
  const [habitLogs, setHabitLogs] = useState<DailyHabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState("90");
  const [activeTab, setActiveTab] = useState("body");

  // Process metrics data for charts
  const { bodyMetrics, wellnessMetrics } = useClientProgressMetrics(progressData);

  useEffect(() => {
    const abortController = new AbortController();
    
    async function fetchData() {
      try {
        const days = dateRange === "all" ? 365 : parseInt(dateRange);
        
        // Calculate date range for habit logs (last 28 days)
        const endDate = getTodayDateString();
        const startDate = getDateString(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000));
        
        const [progressRes, checkInsRes, habitsRes, habitLogsRes] = await Promise.all([
          fetch(`/api/client/progress?days=${days}`, { 
            cache: 'no-store',
            signal: abortController.signal 
          }),
          fetch("/api/client/check-ins?limit=10", { 
            cache: 'no-store',
            signal: abortController.signal 
          }),
          fetch('/api/client/habits', { 
            cache: 'no-store',
            signal: abortController.signal 
          }),
          fetch(`/api/client/habits/logs?startDate=${startDate}&endDate=${endDate}`, { 
            cache: 'no-store',
            signal: abortController.signal 
          })
        ]);

        if (!progressRes.ok) throw new Error("Failed to fetch progress");
        if (!checkInsRes.ok) throw new Error("Failed to fetch check-ins");
        
        const progressJson = await progressRes.json();
        const checkInsJson = await checkInsRes.json();
        const habitsJson = habitsRes.ok ? await habitsRes.json() : { data: [] };
        const habitLogsJson = habitLogsRes.ok ? await habitLogsRes.json() : { data: [] };

        setProgressData(progressJson.data);
        setCheckIns(checkInsJson.data || []);
        setHabits(habitsJson.data || []);
        setHabitLogs(habitLogsJson.data || []);
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    
    // Cleanup: cancel the request if the component unmounts or dateRange changes
    return () => {
      abortController.abort();
    };
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
  const _weightChange = firstWeight && lastWeight ? lastWeight - firstWeight : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Progress</h1>
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

      {/* My Habits Section */}
      <HabitsSection habits={habits} habitLogs={habitLogs} />

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
            <p className="text-xl font-semibold">
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

