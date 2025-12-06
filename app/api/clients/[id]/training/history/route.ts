import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanHistory } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";

// GET - Get training plan history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const history = await getTrainingPlanHistory(clientId);

    return NextResponse.json({ success: true, history }, { status: 200 });
  } catch (error) {
    console.error("Error fetching training plan history:", error);
    return NextResponse.json(
      { error: "Failed to fetch training plan history" },
      { status: 500 }
    );
  }
}
