import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getHabitLogs } from "@/services/daily-habits-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);

    // Default to last 30 days if not provided
    const endDate = searchParams.get("endDate") || new Date().toISOString().split('T')[0];
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    const startDate = searchParams.get("startDate") || defaultStartDate.toISOString().split('T')[0];

    const logs = await getHabitLogs(auth.clientId, startDate, endDate);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching habit logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch habit logs",
      },
      { status: 500 }
    );
  }
}