import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { weightToKg } from "@/utils/nutrition-helpers";

type MetricRow = { weight: number; weight_unit: string | null; recorded_at: string };

function findClosestWeightKg(metrics: MetricRow[], targetDate: string): number | null {
  if (metrics.length === 0) return null;
  const target = new Date(targetDate).getTime();
  let best = metrics[0];
  let bestDiff = Math.abs(new Date(best.recorded_at).getTime() - target);
  for (let i = 1; i < metrics.length; i++) {
    const diff = Math.abs(new Date(metrics[i].recorded_at).getTime() - target);
    if (diff < bestDiff) {
      best = metrics[i];
      bestDiff = diff;
    }
  }
  return weightToKg(best.weight, (best.weight_unit || "kg") as "lbs" | "kg");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await context.params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    // Fetch plans, phases, and body metrics in parallel
    const [plansResult, phasesResult, metricsResult] = await Promise.all([
      supabaseAdmin
        .from("nutrition_plans")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabaseAdmin
        .from("phases")
        .select("id, name, start_date, end_date, status, phase_goal_weight")
        .eq("client_id", clientId),
      supabaseAdmin
        .from("body_metrics")
        .select("weight, weight_unit, recorded_at")
        .eq("client_id", clientId)
        .not("weight", "is", null)
        .order("recorded_at", { ascending: true }),
    ]);

    if (plansResult.error) {
      console.error("Error fetching nutrition plans:", plansResult.error.message);
      return NextResponse.json(
        { success: false, error: "Failed to fetch nutrition history" },
        { status: 500 }
      );
    }

    if (metricsResult.error) {
      console.error("Error fetching body metrics:", metricsResult.error.message);
      // Non-fatal: proceed without weight data
    }

    const metrics = (metricsResult.data || []) as MetricRow[];
    const plans = plansResult.data || [];

    // Build phase lookup
    type PhaseInfo = { id: string; name: string; start_date: string | null; end_date: string | null; status: string; phase_goal_weight: number | null };
    const phaseMap = new Map<string, PhaseInfo>();
    // phase_goal_weight added in migration 068, not in generated types
    for (const p of (phasesResult.data || []) as unknown as PhaseInfo[]) {
      phaseMap.set(p.id, p);
    }

    // Group plans by phase_id
    const groupMap = new Map<string | null, {
      phase: PhaseInfo | null;
      plans: typeof plans;
    }>();

    for (const plan of plans) {
      const phaseId = plan.phase_id ?? null;
      const phase = phaseId ? phaseMap.get(phaseId) ?? null : null;

      if (!groupMap.has(phaseId)) {
        groupMap.set(phaseId, { phase, plans: [] });
      }
      groupMap.get(phaseId)!.plans.push(plan);
    }

    // Build response groups
    const groups = Array.from(groupMap.entries()).map(([phaseId, { phase, plans: groupPlans }]) => {
      let startWeight: number | null = null;
      let endWeight: number | null = null;

      if (phase && metrics.length > 0) {
        if (phase.start_date) {
          startWeight = findClosestWeightKg(metrics, phase.start_date);
        }
        if (phase.status === "completed" && phase.end_date) {
          endWeight = findClosestWeightKg(metrics, phase.end_date);
        } else if (phase.status === "active") {
          // Latest weight for active phase
          const last = metrics[metrics.length - 1];
          endWeight = weightToKg(last.weight, (last.weight_unit || "kg") as "lbs" | "kg");
        }
      }

      return {
        phaseId,
        phaseName: phase?.name ?? null,
        startDate: phase?.start_date ?? null,
        endDate: phase?.end_date ?? null,
        phaseGoalWeight: phase?.phase_goal_weight ?? null,
        phaseStatus: phase?.status ?? null,
        startWeight,
        endWeight,
        // coach_notes and goal_source added in migration 069, not in generated types
        plans: groupPlans.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          createdAt: p.created_at as string,
          status: p.status as string,
          baselineCalories: p.baseline_calories as number,
          proteinTargetG: p.protein_target_g as number,
          carbTargetG: p.carb_target_g as number,
          fatTargetG: p.fat_target_g as number,
          coachNotes: (p.coach_notes as string | null) ?? null,
          goalSource: (p.goal_source as "phase" | "client" | null) ?? null,
        })),
      };
    });

    // Sort: phases by start_date DESC, null-phase group last
    groups.sort((a, b) => {
      if (a.phaseId === null) return 1;
      if (b.phaseId === null) return -1;
      const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
      return bDate - aDate;
    });

    return NextResponse.json({ success: true, data: { groups } });
  } catch (error) {
    console.error("Error in nutrition history route:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
