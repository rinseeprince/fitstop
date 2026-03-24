import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyHabitSchema } from "@/lib/validations/daily-habit";
import { getClientHabits, createHabit } from "@/services/daily-habits-service";
import { getClientById } from "@/services/client-service";
import { requirePhaseSelection } from "@/lib/require-phase-selection";

async function verifyClientOwnership(
  clientId: string,
  coachId: string
): Promise<boolean> {
  const client = await getClientById(clientId);
  return client !== null && client.coachId === coachId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyClientOwnership(clientId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const habits = await getClientHabits(clientId, includeInactive);

    return NextResponse.json({
      success: true,
      data: habits,
    });
  } catch (error) {
    console.error("Error fetching client habits:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch client habits",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyClientOwnership(clientId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      targetValue: rawBody.targetValue ?? rawBody.target_value,
      targetUnit: rawBody.targetUnit ?? rawBody.target_unit,
      isBoolean: rawBody.isBoolean ?? rawBody.is_boolean,
    };
    
    const validationResult = dailyHabitSchema.safeParse(normalizedBody);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
        },
        { status: 400 }
      );
    }

    // Enforce phase selection when client has an active roadmap
    const phaseCheck = await requirePhaseSelection(clientId, validationResult.data.phaseId);
    if (!phaseCheck.ok) return phaseCheck.response;

    const habit = await createHabit(coachId, clientId, {
      ...validationResult.data,
      phaseId: phaseCheck.phaseId,
    });

    return NextResponse.json({
      success: true,
      data: habit,
    });
  } catch (error) {
    console.error("Error creating habit:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create habit",
      },
      { status: 500 }
    );
  }
}