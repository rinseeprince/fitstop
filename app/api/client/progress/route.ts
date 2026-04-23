import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientProgressData } from "@/services/client-portal-progress";

// GET /api/client/progress - Get client's progress data for charts
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days") || "90", 10) || 90, 1), 365);

    const progressData = await getClientProgressData(auth.clientId, days);

    return NextResponse.json({
      success: true,
      data: progressData,
    });
  } catch (error) {
    console.error("Error fetching progress data:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch progress",
      },
      { status: 500 }
    );
  }
}
