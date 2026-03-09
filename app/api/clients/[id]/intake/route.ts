import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { getIntake } from "@/services/client-intake-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const intake = await getIntake(clientId);
    if (!intake) {
      return NextResponse.json({ error: "No intake found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: intake });
  } catch (error) {
    console.error("Error fetching client intake:", error);
    return NextResponse.json(
      { error: "Failed to fetch intake" },
      { status: 500 }
    );
  }
}
