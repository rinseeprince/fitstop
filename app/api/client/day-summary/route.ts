import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { validateDateParameter } from "@/lib/validation-helpers";
import { getDaySummary } from "@/services/client-day-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      { success: false, error: "Missing required date parameter" },
      { status: 400 }
    );
  }

  const dateValidation = validateDateParameter(date);
  if (dateValidation) return dateValidation;

  try {
    const data = await getDaySummary(auth.clientId, date);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching day summary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch day summary" },
      { status: 500 }
    );
  }
}
