import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getSavedPlans,
  createSavedPlanManual,
} from "@/services/coach-saved-plan-service";

// GET - List saved plans for the authenticated coach
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const plans = await getSavedPlans(coachId);
    return NextResponse.json({ success: true, plans }, { status: 200 });
  } catch (error) {
    console.error("Error fetching saved plans:", error);
    return NextResponse.json({ error: "Failed to fetch saved plans" }, { status: 500 });
  }
}

// POST - Create a manual draft plan
export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Plan name is required" }, { status: 400 });
    }
    if (!body.splitType || typeof body.splitType !== "string") {
      return NextResponse.json({ error: "Split type is required" }, { status: 400 });
    }
    if (!Array.isArray(body.sessions) || body.sessions.length === 0) {
      return NextResponse.json({ error: "At least one session is required" }, { status: 400 });
    }

    const planId = await createSavedPlanManual(
      coachId,
      body.name.trim(),
      body.splitType,
      body.sessions
    );

    return NextResponse.json({ success: true, planId }, { status: 201 });
  } catch (error) {
    console.error("Error creating saved plan:", error);
    return NextResponse.json({ error: "Failed to create saved plan" }, { status: 500 });
  }
}
