import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { captureApiError } from "@/lib/error-handler";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { getClientById } from "@/services/client-service";
import {
  INVITATION_NOT_SENT,
  readInvitation,
  sendInvitation,
  type InvitationNotSent,
} from "@/services/invitation-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import type { Client } from "@/types/check-in";

/**
 * The coach's Invite box (docs/BETTER-AUTH-PLAN.md 2.12, D43): a client's
 * invitation, read and sent in the coach's own area, on the coach tier. Both
 * answer `{ hasAccount, invitation: { sentOn, expiresOn, linkWorks } | null }`
 * and never the link's token, which sets up the client's account for whoever
 * holds it. The invite link's own two routes stay under /api/invitations/.
 */

/** A send that wrote nothing: each reason's status. A failed email is the email service's failure, not the request's. */
const NOT_SENT_STATUS: Record<InvitationNotSent, number> = {
  not_found: 404,
  has_account: 409,
  no_email: 409,
  email_failed: 502,
  failed: 500,
};

/** The coach's own client, or null for another coach's or none: one answer for both, so a foreign id learns nothing. */
async function ownClient(clientId: string, coachId: string): Promise<Client | null> {
  const client = await getClientById(clientId, true);
  return client && client.coachId === coachId ? client : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await ownClient(clientId, coachId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    const invitation = await readInvitation({ id: clientId, coachId, hasAccount: Boolean(client.userId) });
    return NextResponse.json(
      { success: true, data: invitation },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { route: "GET /api/clients/[id]/invitation" });
    return NextResponse.json(
      { success: false, error: "Couldn't load the invitation." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // No body: the client is the address's, proved the coach's below.
    const { id: clientId } = await params;
    const client = await ownClient(clientId, coachId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    const result = await sendInvitation(clientId);
    if (!result.sent) {
      return NextResponse.json(
        { success: false, error: INVITATION_NOT_SENT[result.reason] },
        { status: NOT_SENT_STATUS[result.reason] }
      );
    }

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.INVITATION_SEND,
      targetTable: "client_invitations",
      clientId,
      request,
    });

    return NextResponse.json({ success: true, data: result.invitation });
  } catch (error) {
    captureApiError(error, { route: "POST /api/clients/[id]/invitation" });
    return NextResponse.json(
      { success: false, error: INVITATION_NOT_SENT.failed },
      { status: 500 }
    );
  }
}
