import { NextRequest, NextResponse } from "next/server";
import { CreateClientInputError, createClient, getClientsForCoach } from "@/services/client-service";
import { createClientSchema } from "@/lib/validations/client";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// GET /api/clients - List all clients for authenticated coach
export async function GET(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;
  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Opt-in: only the roster (?includeInactive=true) wants deactivated clients
    // so its "Inactive" tab + reactivation work. The content-assignment and
    // apply-to-client pickers share this endpoint and must stay active-only.
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true";
    const clients = await getClientsForCoach(coachId, includeInactive);

    return NextResponse.json({ clients, total: clients.length });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json(
      { error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}

// POST /api/clients - Create a new client
export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate request body
    const validationResult = createClientSchema.safeParse(body);
    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const client = await createClient(coachId, validationResult.data);
    const { inviteSent, goalId, ...clientData } = client;

    // CONVENTIONS §8 "when to log": goals. Fire-and-forget, after the write —
    // it records, never gates.
    if (goalId) {
      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.GOAL_CREATE,
        targetTable: "client_goals",
        targetId: goalId,
        clientId: clientData.id,
        request,
      });
    }

    return NextResponse.json({ client: clientData, inviteSent }, { status: 201 });
  } catch (error) {
    // A value the request itself carries that can't stand — said, and nothing written.
    if (error instanceof CreateClientInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Error creating client:", error);

    // Handle duplicate email error
    if (error instanceof Error && error.message.includes("already exists")) {
      return NextResponse.json(
        { error: "A client with this email already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create client" },
      { status: 500 }
    );
  }
}
