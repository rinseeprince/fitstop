import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getTrainingEventDetail } from "@/services/training-log-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { eventId } = await params;

  try {
    const detail = await getTrainingEventDetail(eventId, auth.clientId);
    if (detail === null) {
      return NextResponse.json(
        { success: false, error: "Event not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: true, data: detail },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error loading training event:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load training event" },
      { status: 500 },
    );
  }
}
