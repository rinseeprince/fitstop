"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientSessionCard } from "@/components/client-portal/training/client-session-card";
import { WeeklyCompletionProgress } from "@/components/client-portal/training/weekly-completion-progress";
import { Calendar, Dumbbell } from "lucide-react";
import type { TrainingPlan } from "@/types/training";
import type { SessionCompletion } from "@/services/client-portal-training";

export default function ClientTrainingPage() {
  const { user: _user } = useAuth();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [completions, setCompletions] = useState<SessionCompletion[]>([]);
  const [weekStartDate, setWeekStartDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch completions without weekStartDate param; server computes it
        // from the client's check-in day
        const [planRes, completionsRes] = await Promise.all([
          fetch("/api/client/training"),
          fetch("/api/client/training/completions"),
        ]);

        if (!planRes.ok) throw new Error("Failed to fetch training plan");
        if (!completionsRes.ok) throw new Error("Failed to fetch completions");

        const planData = await planRes.json();
        const completionsData = await completionsRes.json();

        setPlan(planData.data);
        setCompletions(completionsData.data || []);
        setWeekStartDate(completionsData.weekStartDate || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleToggleComplete = async (sessionId: string, isComplete: boolean) => {
    if (isComplete) {
      // Mark complete (server computes weekStartDate from check-in day)
      const res = await fetch("/api/client/training/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingSessionId: sessionId,
          quality: "full",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCompletions((prev) => [...prev, data.data]);
      }
    } else {
      // Remove completion (server computes weekStartDate from check-in day)
      const res = await fetch(
        `/api/client/training/completions?trainingSessionId=${sessionId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setCompletions((prev) =>
          prev.filter((c) => c.trainingSessionId !== sessionId)
        );
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
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

  if (!plan) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Training Plan</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <Dumbbell className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No Training Plan Yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Your coach hasn&apos;t created a training plan for you yet.
              Check back soon!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completedSessionIds = new Set(completions.map((c) => c.trainingSessionId));
  const trainingSessions = plan.sessions;

  return (
    <div className="space-y-6">
      {/* Plan Header */}
      <div>
        <h1 className="text-2xl font-semibold">{plan.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <Calendar className="mr-1 h-3 w-3" />
            {plan.frequencyPerWeek}x per week
          </Badge>
          {plan.programDurationWeeks && (
            <Badge variant="outline">{plan.programDurationWeeks} weeks</Badge>
          )}
          <Badge variant="outline" className="capitalize">
            {plan.splitType.replace(/_/g, " ")}
          </Badge>
        </div>
        {plan.description && (
          <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>
        )}
      </div>

      {/* Weekly Progress */}
      <WeeklyCompletionProgress
        totalSessions={trainingSessions.length}
        completedSessions={completions.length}
      />

      {/* Sessions */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">This Week&apos;s Sessions</h2>
        {trainingSessions.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No training sessions in this plan
            </CardContent>
          </Card>
        ) : (
          trainingSessions.map((session) => (
            <ClientSessionCard
              key={session.id}
              session={session}
              isCompleted={completedSessionIds.has(session.id)}
              onToggleComplete={(isComplete) =>
                handleToggleComplete(session.id, isComplete)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
