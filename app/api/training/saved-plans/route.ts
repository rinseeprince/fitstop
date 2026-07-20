import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getSavedPlans,
  getSavedPlansPage,
  createSavedPlanManual,
} from "@/services/coach-saved-plan-service";
import { parsePaginationParams } from "@/lib/api-utils";
import { createSavedPlanSchema } from "@/lib/validations/training";
import type { ManualSessionDraft } from "@/types/training";

// GET - List saved plans for the authenticated coach.
// ?status=all additionally returns drafts (the Programs table surfaces them);
// the default stays saved-only for the calendar library panel.
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const includeDrafts = sp.get("status") === "all";

    // Opt-in offset pagination (the Programs table): with ?limit/?offset present
    // return LEAN rows + total (no nested sessions/exercises). Absent → the full
    // nested list (calendar library panel + backward compat).
    if (sp.has("limit") || sp.has("offset")) {
      const pagination = parsePaginationParams(sp);
      if (!pagination.valid) {
        return NextResponse.json(
          { success: false, error: pagination.error },
          { status: 400 },
        );
      }
      const sortParam = sp.get("sort");
      const sourceParam = sp.get("source");
      const { plans, total } = await getSavedPlansPage(coachId, {
        includeDrafts,
        limit: pagination.limit,
        offset: pagination.offset,
        search: sp.get("search") ?? undefined,
        source:
          sourceParam === "ai" || sourceParam === "custom" ? sourceParam : undefined,
        sort: sortParam === "name" || sortParam === "longest" ? sortParam : "updated",
      });
      return NextResponse.json({ success: true, plans, total }, { status: 200 });
    }

    const plans = await getSavedPlans(coachId, { includeDrafts });
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
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const parsed = createSavedPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const planId = await createSavedPlanManual(
      coachId,
      parsed.data.name,
      parsed.data.splitType ?? null,
      parsed.data.sessions as ManualSessionDraft[],
      {
        description: parsed.data.description ?? null,
        defaultSurplusPercentage: parsed.data.defaultSurplusPercentage ?? null,
      }
    );

    return NextResponse.json({ success: true, planId }, { status: 201 });
  } catch (error) {
    console.error("Error creating saved plan:", error);
    return NextResponse.json({ error: "Failed to create saved plan" }, { status: 500 });
  }
}
