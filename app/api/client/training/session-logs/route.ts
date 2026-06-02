import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { logSessionForDateSchema } from "@/lib/validations/training";
import {
  resolvePlanContextForDate,
  assertHasActivePlan,
  NoActivePlanError,
} from "@/services/daily-context-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { logTrainingSessionForDate } from "@/services/training-log-service";

/**
 * Event-less training log (Session 5.3/5.4): the client trained on a day with
 * no tapped event (rest-day training / rest-day picker). The service runs the
 * matcher to link a prescribed event when possible, and keeps one log per rest
 * day — a second pick for the same date EDITS the existing log.
 *
 * Uses requireClientAuth (NOT WithCheckInDay): the week math lives in the
 * service, which self-fetches the check-in day like logTrainingEvent — so the
 * route needs only identity. requireClientAuth still applies the mandatory
 * post-auth per-client rate-limit tier (§9 / Session 3.10).
 */
export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: "Malformed JSON" },
      { status: 400 },
    );
  }

  const parsed = logSessionForDateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const { date } = parsed.data;

  try {
    // Orphan-log guard: refuse to write a training log with a null plan link.
    // The date-edit lock (today editable; past+logged or future → 403) is
    // enforced inside logTrainingSessionForDate via assertCanEditTrainingDay,
    // which reads real session_logs state (not the training_logs spine).
    const ctx = await resolvePlanContextForDate(auth.clientId, date);
    assertHasActivePlan(ctx, "training");

    const { sessionLogId } = await logTrainingSessionForDate({
      clientId: auth.clientId,
      date,
      payload: parsed.data,
    });
    return NextResponse.json(
      { success: true, data: { sessionLogId } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 },
      );
    }
    if (error instanceof NoActivePlanError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 },
      );
    }
    console.error("Error logging training session for date:", error);
    return NextResponse.json(
      { success: false, error: "Failed to log training session" },
      { status: 500 },
    );
  }
}
