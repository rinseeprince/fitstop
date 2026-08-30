import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import { updateCheckInQuestionSchema } from "@/lib/validations/check-in-form";
import { updateCheckInQuestion } from "@/services/check-in-form-service";
import { captureApiError } from "@/lib/error-handler";

/**
 * Reword or archive one bank question (#4).
 *
 * **Rewording changes the question everywhere it is asked**, including the
 * label above every past answer — that is the point of a question being a row
 * rather than a string copied onto each form.
 *
 * Archiving is the only retirement gesture: an answered question cannot be
 * deleted (migration 157's FK), and its answers keep resolving their prompt
 * through it. The service scopes the UPDATE on BOTH `id` and `coach_id`, so a
 * guessed id from another coach matches zero rows and reads as 404.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    const { questionId } = await params;

    const body: unknown = await request.json();
    const validation = updateCheckInQuestionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    const question = await updateCheckInQuestion(
      auth.coachId,
      questionId,
      validation.data
    );

    if (!question) {
      return NextResponse.json(
        { success: false, error: "Question not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { question } }, { status: 200 });
  } catch (error) {
    captureApiError(error, { action: "check-in-question-update" });
    return NextResponse.json(
      { success: false, error: "Failed to update the question" },
      { status: 500 }
    );
  }
}
