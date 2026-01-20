import { NextRequest, NextResponse } from "next/server";
import {
  getCheckInById,
  updateCheckInResponse,
  markResponseAsSent,
} from "@/services/check-in-service";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import type { ReviewCheckInRequest, ReviewCheckInResponse } from "@/types/check-in";

/**
 * Verifies coach owns the client associated with a check-in
 * @returns Object with checkIn if authorized, or error response
 */
async function verifyCoachOwnership(checkInId: string) {
  const coachId = await getAuthenticatedCoachId();
  if (!coachId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, errorMessage: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const checkIn = await getCheckInById(checkInId);
  if (!checkIn) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, errorMessage: "Check-in not found" },
        { status: 404 }
      ),
    };
  }

  const client = await getClientById(checkIn.clientId);
  if (!client || client.coachId !== coachId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, errorMessage: "Forbidden" },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, checkIn, coachId };
}

// POST - Submit coach response for a check-in
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkInId } = await params;

    // Verify authorization
    const authResult = await verifyCoachOwnership(checkInId);
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body: ReviewCheckInRequest = await request.json();
    const { coachResponse } = body;

    if (!coachResponse) {
      return NextResponse.json(
        { success: false, errorMessage: "Coach response is required" },
        { status: 400 }
      );
    }

    // Update check-in with coach response
    await updateCheckInResponse(checkInId, coachResponse);
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

    // Verify authorization
    const authResult = await verifyCoachOwnership(checkInId);
    if (!authResult.authorized) {
      return authResult.response;
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
