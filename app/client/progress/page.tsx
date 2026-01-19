"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

export default function ClientProgressPage() {
  const router = useRouter();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [progressRes, checkInsRes] = await Promise.all([
          fetch("/api/client/progress?days=90"),
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
  }, []);

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

      {/* Weight Progress */}
      {weightHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weight Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {lastWeight?.toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    lbs
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">Current weight</p>
              </div>
              {weightChange !== null && (
                <WeightChangeBadge change={weightChange} />
              )}
            </div>

            {/* Simple progress visualization */}
            <div className="mt-4 flex items-end gap-1">
              {weightHistory.slice(-14).map((point, idx) => {
                const minWeight = Math.min(...weightHistory.map(p => p.weight || 0));
                const maxWeight = Math.max(...weightHistory.map(p => p.weight || 0));
                const range = maxWeight - minWeight || 1;
                const height = ((point.weight || 0) - minWeight) / range * 60 + 20;

                return (
                  <div
                    key={idx}
                    className="flex-1 rounded-t bg-primary/80"
                    style={{ height: `${height}px` }}
                    title={`${point.date}: ${point.weight} lbs`}
                  />
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Last 14 check-ins
            </p>
          </CardContent>
        </Card>
      )}

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

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{formattedDate}</p>
              <Badge variant="outline" className="capitalize">
                {checkIn.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              {checkIn.weight && (
                <span>Weight: {checkIn.weight} {checkIn.weightUnit || "lbs"}</span>
              )}
              {checkIn.mood && <span>Mood: {checkIn.mood}/5</span>}
              {checkIn.energy && <span>Energy: {checkIn.energy}/10</span>}
            </div>
            {checkIn.coachResponse && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm">{checkIn.coachResponse}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
