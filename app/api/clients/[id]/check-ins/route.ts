import { NextRequest, NextResponse } from "next/server";
import { getClientCheckIns } from "@/services/check-in-service";
import type { GetCheckInsResponse } from "@/types/check-in";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : 20;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!)
      : 0;
    const status = searchParams.get("status") || undefined;

    // Get check-ins
    const result = await getClientCheckIns(clientId, {
      limit,
      offset,
      status,
    });

    const response: GetCheckInsResponse = {
      checkIns: result.checkIns,
      total: result.total,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching check-ins:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-ins" },
      { status: 500 }
    );
  }
}
