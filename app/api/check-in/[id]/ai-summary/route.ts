import { NextRequest, NextResponse } from "next/server";
import { updateCheckInAISummary } from "@/services/check-in-service";
import { generateCheckInReview } from "@/services/ai-service";
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";
import type { GenerateAISummaryResponse } from "@/types/check-in";
import { aiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import { aiSummaryRequestSchema } from "@/lib/validations/check-in";

// The model call alone may run to CHECK_IN_REVIEW_TIMEOUT_MS; the reads before
// it need the rest. Without this the platform's default would cut a long
// review off before our own timeout could report it.
export const maxDuration = 90;

/**
 * Regenerate: the coach asks for the review of one check-in to be written
 * again. The input is the same one the client's submit builds
 * (`getCheckInReviewInput`), so the two paths cannot hand the model different
 * weeks.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: checkInId } = await params;

    // Verify coach owns this check-in's client
    const auth = await requireCoachOwnsCheckIn(checkInId);
    if (!auth.authorized) return auth.response;

    // Rate limit by coach account to prevent cost abuse across IPs
    const rateLimitResult = await aiRateLimit(request, auth.coachId);
    if (rateLimitResult) return rateLimitResult;

    const body = await request.json();
    const parsed = aiSummaryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request data" },
        { status: 400 }
      );
    }

    const input = await getCheckInReviewInput(checkInId);
    if (!input) {
      return NextResponse.json(
        { success: false, error: "Check-in not found" },
        { status: 404 }
      );
    }

    const review = await generateCheckInReview(input);
    await updateCheckInAISummary(checkInId, review);

    const response: GenerateAISummaryResponse = {
      success: true,
      summary: review,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error generating AI summary:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate AI summary",
      },
      { status: 500 }
    );
  }
}
