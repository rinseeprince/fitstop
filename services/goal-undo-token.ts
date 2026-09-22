import { createHmac, timingSafeEqual } from "node:crypto";
import { GOAL_UNDO_WINDOW_MS } from "@/lib/constants";
import type { Json } from "@/types/database";

/**
 * The undo of a goal's delete (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d). A
 * delete is a hard delete, so the undo cannot be a flag in the database: the
 * delete hands the coach a SIGNED copy of exactly what it removed, valid for
 * `GOAL_UNDO_WINDOW_MS`, and the restore puts back only a copy this server
 * signed, for this client, in time. Nothing lingers in the database, and the
 * restore — which re-inserts a goal as it was, past dates included — can never
 * be handed a goal the date rules would refuse to write.
 *
 * HMAC-SHA256 under a key derived from the server's own secret (the
 * service-role key), so there is nothing extra to configure; rotating that
 * secret only voids the undos in flight.
 */

type UndoPayload = { v: 1; clientId: string; exp: number; copy: Json };

type GoalUndoReading =
  | { ok: true; copy: Json }
  | { ok: false; reason: "invalid" | "expired" | "foreign" };

function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  // A key of its own, so this signature can never stand for anything else.
  return createHmac("sha256", secret).update("goal-undo-token:v1").digest();
}

function signatureOf(payload: string): Buffer {
  return createHmac("sha256", signingKey()).update(payload).digest();
}

/** Sign a deleted goal's copy for its client, valid for the undo window. */
export function signGoalUndo(
  clientId: string,
  copy: Json,
  now: number = Date.now()
): { token: string; expiresAt: string } {
  const exp = now + GOAL_UNDO_WINDOW_MS;
  const body: UndoPayload = { v: 1, clientId, exp, copy };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return {
    token: `${payload}.${signatureOf(payload).toString("base64url")}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/** The copy inside a token, if this server signed it for this client and it is in time. */
export function readGoalUndo(
  token: string,
  clientId: string,
  now: number = Date.now()
): GoalUndoReading {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: "invalid" };

  const given = Buffer.from(signature, "base64url");
  const expected = signatureOf(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }

  let body: UndoPayload;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UndoPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (body.v !== 1 || typeof body.exp !== "number") return { ok: false, reason: "invalid" };
  if (body.clientId !== clientId) return { ok: false, reason: "foreign" };
  if (body.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, copy: body.copy };
}
