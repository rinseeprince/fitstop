import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { logTrainingEventSchema } from "@/lib/validations/training";
import {
  clearTrainingEventLog,
  logTrainingEvent,
  TrainingLogOwnershipError,
} from "@/services/training-log-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { EmptyTrainingLogError } from "@/lib/training-log-content";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { eventId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: "Malformed JSON" },
      { status: 400 },
    );
  }

  const parsed = logTrainingEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const { sessionLogId } = await logTrainingEvent({
      eventId,
      clientId: auth.clientId,
      payload: parsed.data,
    });
    return NextResponse.json(
      { success: true, data: { sessionLogId } },
      { status: 201 },
    );
  } catch (error) {
    // Past day already logged (or future) → locked.
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 },
      );
    }
    // A save that records nothing — the client ticked no set. Its own sentence,
    // which the form shows before the tap and the server repeats.
    if (error instanceof EmptyTrainingLogError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    // Body-supplied performedSessionId / trainingExerciseId not owned by this
    // client — collapse to 404 (no existence oracle), same as a foreign event.
    if (error instanceof TrainingLogOwnershipError) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 },
      );
    }
    const message = error instanceof Error ? error.message : "";
    // Service collapses missing-event and wrong-client into one throw.
    // Return 404 for both — the alternative (403 on wrong client) leaks
    // existence and gives an enumeration vector. See ARCHITECTURE.md §IDOR.
    if (message.startsWith("Training event not found")) {
      return NextResponse.json(
        { success: false, error: "Event not found" },
        { status: 404 },
      );
    }
    console.error("Error logging training event:", error);
    return NextResponse.json(
      { success: false, error: "Failed to log training event" },
      { status: 500 },
    );
  }
}

/**
 * Clear this workout's log — "I did not do this after all".
 *
 * Allowed exactly where the day-edit rule allows editing (ARCHITECTURE →
 * "Date-edit permissions"), which is the same rule the POST above obeys, and
 * atomic in the database (`clear_training_event_log`, migration 181). Clearing
 * a workout that carries no log is not an error: the workout ends up scheduled
 * with nothing recorded either way.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { eventId } = await params;

  try {
    const { cleared } = await clearTrainingEventLog({
      eventId,
      clientId: auth.clientId,
    });
    return NextResponse.json({ success: true, data: { cleared } }, { status: 200 });
  } catch (error) {
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "";
    // Missing and wrong-client collapse to one throw, as they do on the POST.
    if (message.startsWith("Training event not found")) {
      return NextResponse.json(
        { success: false, error: "Event not found" },
        { status: 404 },
      );
    }
    console.error("Error clearing training log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to clear training log" },
      { status: 500 },
    );
  }
}
