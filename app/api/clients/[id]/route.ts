import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_OWNS_EMAIL,
  ClientEmailLockedError,
  getClientById,
  updateClient,
  deleteClient,
} from "@/services/client-service";
import { updateClientSchema } from "@/lib/validations/client";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { ReadingRemovalUnavailableError } from "@/services/measurements-service";
import type { Client } from "@/types/check-in";

// The client, when it is this coach's; null when it is not (or is not there).
async function findOwnedClient(
  clientId: string,
  coachId: string
): Promise<Client | null> {
  const client = await getClientById(clientId);
  return client !== null && client.coachId === coachId ? client : null;
}

// GET /api/clients/[id] - Get a single client
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify ownership
    const owned = await findOwnedClient(id, coachId);
    if (!owned) {
      return NextResponse.json(
        { error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const client = await getClientById(id);

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ client });
  } catch (error) {
    console.error("Error fetching client:", error);
    return NextResponse.json(
      { error: "Failed to fetch client" },
      { status: 500 }
    );
  }
}

// PATCH /api/clients/[id] - Update a client
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify ownership
    const owned = await findOwnedClient(id, coachId);
    if (!owned) {
      return NextResponse.json(
        { error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Validate request body
    const validationResult = updateClientSchema.safeParse(body);
    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    // A client with an account changes the address they sign in with from
    // their own Settings (D38, rule 18): the coach's write would move only the
    // copy. An address a save carries unchanged passes and writes nothing, for
    // every client. Another one is a pending client's alone to be given, and
    // written only while they still have no login (updateClient), in case they
    // accept their invite meanwhile.
    const { email, ...withoutEmail } = validationResult.data;
    const changesAddress = email !== undefined && email !== owned.email.toLowerCase();
    if (changesAddress && owned.userId !== undefined) {
      return NextResponse.json({ error: CLIENT_OWNS_EMAIL }, { status: 409 });
    }

    const client = await updateClient(id, changesAddress ? validationResult.data : withoutEmail, coachId);

    return NextResponse.json({ client });
  } catch (error) {
    console.error("Error updating client:", error);

    // A reading is not withdrawn through the profile (the Journey's measurement
    // log removes it, row by row) — the sentence the coach reads, not a
    // generic failure.
    if (error instanceof ReadingRemovalUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // The client accepted their invite between the ownership read and the write.
    if (error instanceof ClientEmailLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    // Handle duplicate email error
    if (error instanceof Error && error.message.includes("already exists")) {
      return NextResponse.json(
        { error: "A client with this email already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update client" },
      { status: 500 }
    );
  }
}

// DELETE /api/clients/[id] - Delete (deactivate) a client
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify ownership
    const owned = await findOwnedClient(id, coachId);
    if (!owned) {
      return NextResponse.json(
        { error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    await deleteClient(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting client:", error);
    return NextResponse.json(
      { error: "Failed to delete client" },
      { status: 500 }
    );
  }
}
