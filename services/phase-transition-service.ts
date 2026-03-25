// Uses supabaseAdmin: system-level atomic write (RLS exception 3)
// Phase transition spans phases, plans, habits, and roadmaps atomically.
import { supabaseAdmin } from "./supabase-admin";
import { mapPhaseRow } from "./roadmap-service";
import { getBodyMetricsHistory, getLatestBodyMetrics } from "./body-metrics-service";
import { getCurrentGoals } from "./client-goals-service";
import type { PhaseRow, PhaseReviewData } from "@/types/roadmap";

const ADHERENCE_SCORES: Record<string, number> = {
  hit: 1.0,
  partial: 0.5,
  missed: 0.0,
};

export const getPhaseReviewData = async (
  phaseId: string,
  clientId: string
): Promise<PhaseReviewData> => {
  // Fetch phase first (required for all other queries)
  const { data: phaseRow, error: phaseError } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .single();

  if (phaseError || !phaseRow) {
    throw new Error(
      `Phase not found: ${phaseError?.message ?? "No data returned"}`
    );
  }

  const phase = mapPhaseRow(phaseRow as unknown as PhaseRow);
  const startDate = phase.startDate ?? phase.createdAt;
  const endDate = phase.endDate ?? new Date().toISOString().split("T")[0];
  const daysInRange = Math.max(
    1,
    Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1
  );

  // Run remaining queries in parallel with allSettled for partial data tolerance
  const results = await Promise.allSettled([
    // 0: Training plan for frequency
    supabaseAdmin
      .from("training_plans")
      .select("frequency_per_week")
      .eq("phase_id", phaseId)
      .in("status", ["active", "archived"])
      .maybeSingle(),
    // 1: Body metrics at phase start
    getBodyMetricsHistory(clientId, {
      from: startDate,
      limit: 1,
      ascending: true,
      requireFields: ["weight"],
    }),
    // 2: Current body metrics
    getLatestBodyMetrics(clientId, { requireFields: ["weight"] }),
    // 3: Session logs count for training adherence
    // session_logs uses completed_at (timestamp), not date
    supabaseAdmin
      .from("session_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("completed_at", startDate)
      .lte("completed_at", endDate),
    // 4: Nutrition logs for adherence
    supabaseAdmin
      .from("nutrition_logs")
      .select("nutrition_adherence")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate),
    // 5: Habit completion data
    (async () => {
      const { data: habits } = await supabaseAdmin
        .from("daily_habits")
        .select("id")
        .eq("phase_id", phaseId)
        .eq("is_active", true);

      if (!habits || habits.length === 0) return null;

      const habitIds = habits.map((h: { id: string }) => h.id);
      const { count } = await supabaseAdmin
        .from("daily_habit_logs")
        .select("id", { count: "exact", head: true })
        .in("daily_habit_id", habitIds)
        .eq("completed", true)
        .gte("date", startDate)
        .lte("date", endDate);

      const total = habits.length * daysInRange;
      return { completed: count ?? 0, total, habitCount: habits.length };
    })(),
    // 6: Current goals
    getCurrentGoals(clientId),
    // 7: Next planned phase
    supabaseAdmin
      .from("phases")
      .select("id, name")
      .eq("roadmap_id", phase.roadmapId)
      .eq("status", "planned")
      .order("order_index", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  // Extract results safely
  const trainingPlanResult =
    results[0].status === "fulfilled" ? results[0].value : null;
  const metricsAtStart =
    results[1].status === "fulfilled" ? results[1].value : null;
  const metricsNow =
    results[2].status === "fulfilled" ? results[2].value : null;
  const sessionLogsResult =
    results[3].status === "fulfilled" ? results[3].value : null;
  const nutritionLogsResult =
    results[4].status === "fulfilled" ? results[4].value : null;
  const habitResult =
    results[5].status === "fulfilled" ? results[5].value : null;
  const goalsNow =
    results[6].status === "fulfilled" ? results[6].value : null;
  const nextPhaseResult =
    results[7].status === "fulfilled" ? results[7].value : null;

  // Build training adherence
  let trainingAdherence: PhaseReviewData["trainingAdherence"] = null;
  const sessionsCompleted = sessionLogsResult?.count ?? 0;
  const frequencyPerWeek =
    trainingPlanResult?.data?.frequency_per_week;
  if (sessionsCompleted > 0 || frequencyPerWeek) {
    const prescribed = frequencyPerWeek
      ? Math.round((daysInRange / 7) * frequencyPerWeek)
      : 0;
    trainingAdherence = {
      completed: sessionsCompleted,
      prescribed,
      percentage:
        prescribed > 0
          ? Math.round((sessionsCompleted / prescribed) * 100)
          : null,
    };
  }

  // Build nutrition adherence
  let nutritionAdherence: PhaseReviewData["nutritionAdherence"] = null;
  const nutritionLogs = nutritionLogsResult?.data as
    | { nutrition_adherence: string | null }[]
    | null;
  if (nutritionLogs && nutritionLogs.length > 0) {
    const scores = nutritionLogs
      .map((l) => ADHERENCE_SCORES[l.nutrition_adherence ?? ""])
      .filter((s) => s !== undefined);
    if (scores.length > 0) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      nutritionAdherence = {
        averageScore: Math.round(avg * 100),
        logsCount: scores.length,
      };
    }
  }

  // Build habit completion
  let habitCompletion: PhaseReviewData["habitCompletion"] = null;
  if (
    habitResult &&
    typeof habitResult === "object" &&
    "total" in habitResult &&
    habitResult.total > 0
  ) {
    habitCompletion = {
      completed: habitResult.completed,
      total: habitResult.total,
      percentage: Math.round((habitResult.completed / habitResult.total) * 100),
    };
  }

  // Build body metrics comparison
  const startMetrics = Array.isArray(metricsAtStart) && metricsAtStart[0]
    ? { weight: metricsAtStart[0].weight, bodyFatPercentage: metricsAtStart[0].bodyFatPercentage }
    : null;
  const currentMetrics = metricsNow
    ? { weight: metricsNow.weight, bodyFatPercentage: metricsNow.bodyFatPercentage }
    : null;

  // Next phase info
  const nextPhaseData = nextPhaseResult?.data as { id: string; name: string } | null;

  return {
    phase,
    trainingAdherence,
    nutritionAdherence,
    habitCompletion,
    bodyMetrics: { start: startMetrics, current: currentMetrics },
    goalsAtStart: phase.phaseGoalsSnapshot ?? null,
    goalsNow: goalsNow
      ? {
          goalWeight: goalsNow.goalWeight,
          goalBodyFatPercentage: goalsNow.goalBodyFatPercentage,
          primaryGoal: goalsNow.primaryGoal,
        }
      : null,
    durationDays: daysInRange,
    hasNextPhase: !!nextPhaseData,
    nextPhaseName: nextPhaseData?.name ?? null,
  };
};

export type TransitionOptions = {
  coachReflection?: string;
  nextAction: "activate_next" | "archive_roadmap";
  planHandling: {
    trainingPlan: "keep" | "archive";
    nutritionPlan: "keep" | "archive";
    habits: "keep" | "archive";
  };
};

export const transitionPhase = async (
  phaseId: string,
  clientId: string,
  options: TransitionOptions
): Promise<{ resultId: string; reviewData: PhaseReviewData }> => {
  const reviewData = await getPhaseReviewData(phaseId, clientId);

  // Build phase_summary snapshot (nextPhaseId is written by the RPC)
  const phaseSummary = {
    completedAt: new Date().toISOString(),
    metricsSnapshot: {
      startWeight: reviewData.bodyMetrics.start?.weight ?? null,
      endWeight: reviewData.bodyMetrics.current?.weight ?? null,
      startBodyFat: reviewData.bodyMetrics.start?.bodyFatPercentage ?? null,
      endBodyFat: reviewData.bodyMetrics.current?.bodyFatPercentage ?? null,
    },
    adherence: {
      training: reviewData.trainingAdherence,
      nutrition: reviewData.nutritionAdherence,
      habits: reviewData.habitCompletion,
    },
  };

  // Uses supabaseAdmin: system-level atomic write (RLS exception 3)
  const { data: resultId, error: rpcError } = (await supabaseAdmin.rpc(
    "transition_phase_atomic" as never,
    {
      p_phase_id: phaseId,
      p_coach_reflection: options.coachReflection ?? null,
      p_phase_summary: phaseSummary,
      p_next_action: options.nextAction,
      p_archive_training: options.planHandling.trainingPlan === "archive",
      p_archive_nutrition: options.planHandling.nutritionPlan === "archive",
      p_archive_habits: options.planHandling.habits === "archive",
    } as never
  )) as unknown as {
    data: string | null;
    error: { message: string } | null;
  };

  if (rpcError || !resultId) {
    throw new Error(
      `Failed to transition phase: ${rpcError?.message ?? "No result returned"}`
    );
  }

  return { resultId, reviewData };
};
