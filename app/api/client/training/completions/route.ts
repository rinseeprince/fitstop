import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getWeeklyCompletions,
  markSessionComplete,
  removeSessionCompletion,
  getCurrentWeekStart,
} from "@/services/client-portal-service";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { z } from "zod";

// Validation schema for marking session complete
const markCompleteSchema = z.object({
  trainingSessionId: z.string().uuid(),
  weekStartDate: z.string().optional(),
  quality: z.enum(["full", "partial", "skipped"]).optional().default("full"),
  notes: z.string().optional(),
});

// GET /api/client/training/completions - Get weekly completions
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const weekStartDate = searchParams.get("weekStartDate") || getCurrentWeekStart();

    const completions = await getWeeklyCompletions(clientId, weekStartDate);

    return NextResponse.json({
      success: true,
      data: completions,
      weekStartDate,
    });
  } catch (error) {
    console.error("Error fetching completions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch completions",
      },
      { status: 500 }
    );
  }
}

// POST /api/client/training/completions - Mark session complete
export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = markCompleteSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { trainingSessionId, quality, notes } = validationResult.data;
    const weekStartDate = validationResult.data.weekStartDate || getCurrentWeekStart();

    const completion = await markSessionComplete(
      clientId,
      trainingSessionId,
      weekStartDate,
      quality,
      notes
    );

    if (!completion) {
      return NextResponse.json(
        { success: false, error: "Failed to mark session complete" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: completion,
    }, { status: 201 });
  } catch (error) {
    console.error("Error marking session complete:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to mark complete",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/client/training/completions - Remove session completion
export async function DELETE(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const trainingSessionId = searchParams.get("trainingSessionId");
    const weekStartDate = searchParams.get("weekStartDate") || getCurrentWeekStart();

    if (!trainingSessionId) {
      return NextResponse.json(
        { success: false, error: "trainingSessionId is required" },
        { status: 400 }
      );
    }

    const success = await removeSessionCompletion(clientId, trainingSessionId, weekStartDate);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Failed to remove completion" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing completion:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to remove completion",
      },
      { status: 500 }
    );
  }
}
