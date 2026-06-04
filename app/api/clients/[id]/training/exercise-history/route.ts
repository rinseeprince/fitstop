import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "@/services/exercise-analytics-service";

const VALID_METRICS = new Set(["list", "progression", "prs"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const { searchParams } = new URL(request.url);
    const metric = searchParams.get("metric");

    if (!metric || !VALID_METRICS.has(metric)) {
      return NextResponse.json(
        { success: false, error: "metric query param is required (list | progression | prs)" },
        { status: 400 }
      );
    }

    // Optional date window (Session 7.7) — applies to list + progression, ignored
    // for prs (PRs stay all-time). Drives the coach metrics-tab time-scope charts.
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    for (const [name, value] of [
      ["startDate", startDate],
      ["endDate", endDate],
    ] as const) {
      if (value !== undefined && !ISO_DATE.test(value)) {
        return NextResponse.json(
          { success: false, error: `${name} must be an ISO date (YYYY-MM-DD)` },
          { status: 400 }
        );
      }
    }

    if (metric === "list") {
      const data = await getClientExerciseList(clientId, { startDate, endDate });
      return NextResponse.json(
        { success: true, data },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // progression and prs require an exercise identifier
    const exerciseId = searchParams.get("exerciseId") ?? undefined;
    const exerciseName = searchParams.get("exerciseName") ?? undefined;

    if (!exerciseId && !exerciseName) {
      return NextResponse.json(
        { success: false, error: "exerciseId or exerciseName is required for progression/prs" },
        { status: 400 }
      );
    }

    if (metric === "prs") {
      const data = await getExercisePRs(clientId, { exerciseId, exerciseName });
      return NextResponse.json(
        { success: true, data },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // metric === "progression"
    const sessionCountParam = searchParams.get("sessionCount");
    let sessionCount: number | undefined;
    if (sessionCountParam) {
      sessionCount = parseInt(sessionCountParam, 10);
      if (isNaN(sessionCount) || sessionCount < 1 || sessionCount > 100) {
        return NextResponse.json(
          { success: false, error: "sessionCount must be between 1 and 100" },
          { status: 400 }
        );
      }
    }

    const data = await getExerciseProgressionSeries(clientId, {
      exerciseId,
      exerciseName,
      sessionCount,
      startDate,
      endDate,
    });
    return NextResponse.json(
      { success: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching exercise history:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exercise history" },
      { status: 500 }
    );
  }
}
