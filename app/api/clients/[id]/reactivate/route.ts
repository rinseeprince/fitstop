import { NextRequest, NextResponse } from "next/server";
import { getClientById, reactivateClient } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

// POST /api/clients/[id]/reactivate - Undo a soft-delete (set active = true).
// Symmetric to DELETE /api/clients/[id] (deactivate). Ownership is verified with
// includeInactive=true — the client is inactive by definition, so the normal
// active-filtered lookup would 404 before we could reactivate it.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id } = await params;
    const coachId = await getAuthenticatedCoachId(request);

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = await getClientById(id, true);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    await reactivateClient(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reactivating client:", error);
    return NextResponse.json(
      { error: "Failed to reactivate client" },
      { status: 500 }
    );
  }
}
