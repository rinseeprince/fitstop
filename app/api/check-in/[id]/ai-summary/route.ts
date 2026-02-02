import { NextRequest, NextResponse } from "next/server";
import {
  getCheckInById,
  getClientCheckIns,
  updateCheckInAISummary,
} from "@/services/check-in-service";
import { generateCheckInSummary, regenerateAISummary } from "@/services/ai-service";
import type { GenerateAISummaryResponse } from "@/types/check-in";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkInId } = await params;
    const body = await request.json();
    const focus = body.focus as "positive" | "detailed" | "concise" | undefined;

    // Get current check-in
    const currentCheckIn = await getCheckInById(checkInId);
    if (!currentCheckIn) {
      return NextResponse.json(
        { success: false, errorMessage: "Check-in not found" },
        { status: 404 }
      );
    }

    // Get previous check-ins for context
    const { checkIns } = await getClientCheckIns(currentCheckIn.clientId, {
      limit: 5,
    });
    const previousCheckIns = checkIns.filter((ci) => ci.id !== checkInId);

    // Generate or regenerate AI summary
    const aiSummary = focus
      ? await regenerateAISummary(
          currentCheckIn,
          previousCheckIns,
          "Client Name", // TODO: Fetch actual client name
          focus
        )
      : await generateCheckInSummary(
          currentCheckIn,
          previousCheckIns,
          "Client Name"
        );

    // Update check-in with new AI summary
    await updateCheckInAISummary(
      checkInId,
      aiSummary.summary,
      aiSummary.insights,
      aiSummary.recommendations,
      aiSummary.responseDraft
    );

    const response: GenerateAISummaryResponse = {
      success: true,
      summary: aiSummary,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error generating AI summary:", error);
    return NextResponse.json(
      {
        success: false,
        errorMessage: "Failed to generate AI summary",
      },
      { status: 500 }
    );
  }
}
