import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { EXERCISE_HISTORY_MAX_SESSIONS } from "@/lib/training-constants";
import {
  getClientExerciseBests,
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "@/services/exercise-analytics-service";

const VALID_METRICS = new Set(["list", "bests", "progression", "prs"]);

// Client-owned route: the authed client can only read their own exercise
// history. requireClientAuth bundles rate-limit + CSRF + auth and yields the
// clientId we scope every service call to (the service has no built-in auth).
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const metric = searchParams.get("metric");

    if (!metric || !VALID_METRICS.has(metric)) {
      return NextResponse.json(
        { success: false, error: "metric query param is required (list | bests | progression | prs)" },
        { status: 400 },
      );
    }

    if (metric === "list") {
      const data = await getClientExerciseList(auth.clientId);
      return NextResponse.json(
        { success: true, data },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Every exercise the client has logged with its bests: one read, all-time
    if (metric === "bests") {
      const data = await getClientExerciseBests(auth.clientId);
      return NextResponse.json(
        { success: true, data },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    // progression and prs require an exercise identifier
    const exerciseId = searchParams.get("exerciseId") ?? undefined;
    const exerciseName = searchParams.get("exerciseName") ?? undefined;

    if (!exerciseId && !exerciseName) {
      return NextResponse.json(
        { success: false, error: "exerciseId or exerciseName is required for progression/prs" },
        { status: 400 },
      );
    }

    if (metric === "prs") {
      const data = await getExercisePRs(auth.clientId, { exerciseId, exerciseName });
      return NextResponse.json(
        { success: true, data },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    // metric === "progression"
    // Capped at the one bound the session window's "All" asks for
    // (EXERCISE_HISTORY_MAX_SESSIONS), the coach's route alike.
    const sessionCountParam = searchParams.get("sessionCount");
    let sessionCount: number | undefined;
    if (sessionCountParam) {
      sessionCount = parseInt(sessionCountParam, 10);
      if (isNaN(sessionCount) || sessionCount < 1 || sessionCount > EXERCISE_HISTORY_MAX_SESSIONS) {
        return NextResponse.json(
          {
            success: false,
            error: `sessionCount must be between 1 and ${EXERCISE_HISTORY_MAX_SESSIONS}`,
          },
          { status: 400 },
        );
      }
    }

    const data = await getExerciseProgressionSeries(auth.clientId, {
      exerciseId,
      exerciseName,
      sessionCount,
    });
    return NextResponse.json(
      { success: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error fetching client exercise history:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exercise history" },
      { status: 500 },
    );
  }
}
