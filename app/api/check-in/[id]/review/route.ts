import { NextRequest, NextResponse } from "next/server";
import {
  getCheckInById,
  updateCheckInResponse,
  markResponseAsSent,
} from "@/services/check-in-service";
import type { ReviewCheckInRequest, ReviewCheckInResponse } from "@/types/check-in";

// POST - Submit coach response for a check-in
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkInId } = await params;
    const body: ReviewCheckInRequest = await request.json();

    const { coachResponse } = body;

    if (!coachResponse) {
      return NextResponse.json(
        { success: false, errorMessage: "Coach response is required" },
        { status: 400 }
      );
    }

    // Verify check-in exists
    const checkIn = await getCheckInById(checkInId);
    if (!checkIn) {
      return NextResponse.json(
        { success: false, errorMessage: "Check-in not found" },
        { status: 404 }
      );
    }

    // Update check-in with coach response
    await updateCheckInResponse(checkInId, coachResponse);

    // TODO: Send email/SMS notification to client with response
    // For now, just mark as sent
    await markResponseAsSent(checkInId);

    const response: ReviewCheckInResponse = {
      success: true,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error submitting coach response:", error);
    return NextResponse.json(
      {
        success: false,
        errorMessage: "Failed to submit response",
      },
      { status: 500 }
    );
  }
}

// PATCH - Mark check-in as reviewed without sending response
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkInId } = await params;

    // Verify check-in exists
    const checkIn = await getCheckInById(checkInId);
    if (!checkIn) {
      return NextResponse.json(
        { success: false, errorMessage: "Check-in not found" },
        { status: 404 }
      );
    }

    // Mark as reviewed with empty response
    await updateCheckInResponse(checkInId, "");

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error marking check-in as reviewed:", error);
    return NextResponse.json(
      {
        success: false,
        errorMessage: "Failed to mark as reviewed",
      },
      { status: 500 }
    );
  }
}
