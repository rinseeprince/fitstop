import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { logTrainingEventSchema } from "@/lib/validations/training";
import { logTrainingEvent } from "@/services/training-log-service";

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
