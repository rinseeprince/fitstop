import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import { captureApiError } from "@/lib/error-handler";

/**
 * Audit logging — an append-only trail of security-relevant actions on
 * client-owned data (see migration 108 + ARCHITECTURE "Audit log").
 *
 * Design notes:
 * - NON-BLOCKING: recordAuditEvent never throws into the request path. A failed
 *   audit write must not fail the user's action; failures go to Sentry instead.
 * - Writes via supabaseAdmin (service_role); audit_logs is RLS deny-all otherwise.
 * - actor_id is a coaches.id for trainer actions / clients.id for client actions,
 *   disambiguated by actor_role (no FK — avoids an auth.users lookup per write).
 */

export type AuditActorRole = "trainer" | "client" | "system";

export interface AuditEventInput {
  /** coaches.id for trainer actions, clients.id for client actions, null for system */
  actorId?: string | null;
  actorRole?: AuditActorRole;
  /** dotted action key, e.g. "goal.create" — use the AUDIT_ACTIONS constants */
  action: string;
  /** the primary entity table touched, e.g. "client_goals" */
  targetTable?: string | null;
  /** id of the primary entity touched */
  targetId?: string | null;
  /** the tenant (client) the action pertains to */
  clientId?: string | null;
  /** small, non-sensitive contextual detail (never health PII). JSON-scalar
   *  values only so it is assignable to the jsonb column's generated Json type. */
  metadata?: Record<string, string | number | boolean | null>;
  /** request, used only to derive a hashed IP (never stored raw) */
  request?: NextRequest;
}

function hashIp(request?: NextRequest): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  if (!ip) return null;
  // Match the auth-failure logger: SHA-256 prefix, never the raw address.
  return createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

/**
 * Append one row to audit_logs. Fire-and-forget friendly: callers may `void` this
 * (it swallows its own errors). Always pass a caller-verified clientId/actorId —
 * this records what the route already authorized, it does not authorize anything.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      actor_id: input.actorId ?? null,
      actor_role: input.actorRole ?? null,
      action: input.action,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      client_id: input.clientId ?? null,
      metadata: input.metadata ?? {},
      ip_hash: hashIp(input.request),
    });
    if (error) {
      captureApiError(error, { action: "audit-log-write", auditAction: input.action });
    }
  } catch (err) {
    captureApiError(err, { action: "audit-log-write", auditAction: input.action });
  }
}
