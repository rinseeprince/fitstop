import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import { createCheckInQuestionSchema } from "@/lib/validations/check-in-form";
import {
  createCheckInQuestion,
  listCheckInQuestions,
} from "@/services/check-in-form-service";
import { captureApiError } from "@/lib/error-handler";

/**
 * The coach's bank of custom check-in questions (#4).
 *
 * Coach-owned rather than client-owned, so the chain is `requireCoachAuth` and
 * every service call filters on the resolved `coach_id` — a question is never
 * addressed by id alone.
 */

export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    const questions = await listCheckInQuestions(auth.coachId);

    return NextResponse.json(
      { success: true, data: { questions } },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { action: "check-in-questions-list" });
    return NextResponse.json(
      { success: false, error: "Failed to load your questions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    const body: unknown = await request.json();
    const validation = createCheckInQuestionSchema.safeParse(body);
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

    const question = await createCheckInQuestion(
      auth.coachId,
      validation.data.prompt
    );

    return NextResponse.json({ success: true, data: { question } }, { status: 201 });
  } catch (error) {
    captureApiError(error, { action: "check-in-question-create" });
    return NextResponse.json(
      { success: false, error: "Failed to save the question" },
      { status: 500 }
    );
  }
}
