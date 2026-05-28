import { isValidUUID } from "@/lib/api-utils";

/**
 * Opaque keyset cursor for client list pagination.
 *
 * The wire form is a base64url string the client treats as opaque and echoes back
 * verbatim — never parsed client-side. Established by session 3.7 as the cursor
 * contract that the native client and later client history lists follow.
 */
export type CheckInCursor = {
  createdAt: string;
  id: string;
};

// PostgREST-safe ISO-8601 timestamptz shape. Crucially this charset contains none
// of `,` `(` `)` — the structural characters of a PostgREST `.or()` filter string —
// so a *validated* cursor cannot smuggle filter syntax into the keyset predicate.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

export function encodeCursor(cursor: CheckInCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decode and STRICTLY validate a cursor string. Returns null for anything
 * malformed: non-base64, non-JSON, wrong shape, a non-UUID `id`, or a `createdAt`
 * that is not a safe ISO timestamp.
 *
 * Strict validation is a security boundary, not just hygiene: the decoded values
 * are interpolated into a PostgREST `.or()` keyset filter, so the route must reject
 * (HTTP 400) anything that fails here rather than pass it through.
 */
export function decodeCursor(raw: string): CheckInCursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as CheckInCursor).createdAt !== "string" ||
      typeof (parsed as CheckInCursor).id !== "string"
    ) {
      return null;
    }
    const { createdAt, id } = parsed as CheckInCursor;
    if (!isValidUUID(id) || !ISO_TIMESTAMP.test(createdAt)) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
