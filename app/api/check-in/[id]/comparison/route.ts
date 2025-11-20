import { NextRequest, NextResponse } from "next/server";
import { getCheckInComparison } from "@/services/comparison-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkInId } = await params;
    const response = await getCheckInComparison(checkInId);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching check-in comparison:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
