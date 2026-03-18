import { NextRequest, NextResponse } from "next/server";
import { createClient, getClientsForCoach } from "@/services/client-service";
import { createClientSchema } from "@/lib/validations/client";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

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

    const clients = await getClientsForCoach(coachId);

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
    const { inviteSent, ...clientData } = client;

    return NextResponse.json({ client: clientData, inviteSent }, { status: 201 });
  } catch (error) {
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
