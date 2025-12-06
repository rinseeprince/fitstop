import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById, addSession } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { addSessionSchema } from "@/lib/validations/training";

// POST - Add new session to plan
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = addSessionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const session = await addSession(planId, validation.data);

    return NextResponse.json({ success: true, session }, { status: 201 });
  } catch (error) {
    console.error("Error adding session:", error);
    return NextResponse.json({ error: "Failed to add session" }, { status: 500 });
  }
}
