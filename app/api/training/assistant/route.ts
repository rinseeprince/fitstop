import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { assistantRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { assistantChatRequestSchema } from "@/lib/validations/assistant";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { runAssistantTurn } from "@/services/assistant/draft-agent-service";
import type { ProgramDraft } from "@/components/clients/training/program-builder/program-builder-types";

// AI draft assistant — one chat turn (builder S6a). Stateless by design: the
// body carries the coach's command + a snapshot of the in-memory builder
// draft; the response carries the assistant's reply + the DraftOps the client
// replays through the shared op module. NO database writes happen here — the
// blast radius of a bad turn is the returned op list, which the client
// re-validates and replays through the same guarded applyDraftOp.

// Tool-loop turns with adaptive thinking can run several minutes.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Dedicated assistant tier (20 / 5 min per coach — owner-approved), keyed
    // on the authenticated account so IP rotation can't bypass it.
    const rateLimitResult = await assistantRateLimit(request, coachId);
    if (rateLimitResult) return rateLimitResult;

    const body = await request.json();
    const parsed = assistantChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // IDOR: the client-scoped editors name a client — prove ownership before
    // doing any work on their behalf (the schema already requires clientId
    // there).
    if (parsed.data.clientId) {
      const client = await getClientById(parsed.data.clientId);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      if (client.coachId !== coachId) {
        return NextResponse.json(
          { error: "Forbidden: You don't have access to this client" },
          { status: 403 }
        );
      }
    }

    // Placed-plan: the named plan must belong to that (already-verified)
    // client — 404 rather than 403 to avoid leaking a foreign plan's
    // existence. Still zero DB writes anywhere in a turn.
    if (parsed.data.target === "placed-plan" && parsed.data.planId) {
      const plan = await getTrainingPlanById(parsed.data.planId);
      if (!plan || plan.clientId !== parsed.data.clientId) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }
    }

    const data = await runAssistantTurn({
      coachId,
      target: parsed.data.target,
      // The snapshot schema mirrors ProgramDraft field-for-field (parity is
      // fixture-tested); the cast bridges zod's inferred shape to the type.
      draft: parsed.data.draft as ProgramDraft,
      command: parsed.data.command,
      transcript: parsed.data.transcript,
      lockedSlotUids: parsed.data.lockedSlotUids,
    });

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ANTHROPIC_API_KEY is not configured") {
      console.error("Assistant route: missing ANTHROPIC_API_KEY");
      return NextResponse.json(
        { error: "The assistant isn't configured on this server yet" },
        { status: 500 }
      );
    }
    console.error("Error running assistant turn:", error);
    return NextResponse.json(
      { error: "The assistant couldn't complete that request" },
      { status: 500 }
    );
  }
}
