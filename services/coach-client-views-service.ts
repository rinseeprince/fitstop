import { supabaseAdmin } from "./supabase-admin";

/**
 * Tracks when a coach last opened a client's overview tab — the anchor for the
 * "since your last visit" section of the pre-session brief (Session 7.6).
 *
 * Shape B: callers (the overview-brief route) verify the coach owns the client
 * before invoking these; the service trusts and filters on the passed scope.
 */

/** The coach's last view timestamp for this client, or null if never viewed. */
export const getLastViewedAt = async (
  coachId: string,
  clientId: string
): Promise<string | null> => {
  const { data, error } = await supabaseAdmin
    .from("coach_client_views")
    .select("last_viewed_at")
    .eq("coach_id", coachId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error("Failed to read coach_client_views:", error);
    throw new Error(`Failed to read last viewed: ${error.message}`);
  }

  return data?.last_viewed_at ?? null;
};

/**
 * Records "the coach just viewed this client" (last-write-wins upsert).
 * Returns the timestamp written so the seen route can echo it back.
 */
export const upsertLastViewed = async (
  coachId: string,
  clientId: string
): Promise<string> => {
  const lastViewedAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from("coach_client_views").upsert(
    {
      coach_id: coachId,
      client_id: clientId,
      last_viewed_at: lastViewedAt,
    },
    { onConflict: "coach_id,client_id" }
  );

  if (error) {
    console.error("Failed to upsert coach_client_views:", error);
    throw new Error(`Failed to record view: ${error.message}`);
  }

  return lastViewedAt;
};

/**
 * Starts the anchor on the coach's first visit and returns it. Written only
 * when the coach has none for this client (INSERT … ON CONFLICT DO NOTHING on
 * the primary key), so it never moves an anchor the coach already has — only
 * Mark seen does that — and a page load can never clear an unread feed. The
 * row carries no time of its own: the column's default stamps it with the
 * database's clock, the one every row the feed compares it with is stamped by.
 * When another request started it first, the anchor that one wrote is returned.
 */
export const startLastViewed = async (coachId: string, clientId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("coach_client_views")
    .upsert(
      { coach_id: coachId, client_id: clientId },
      { onConflict: "coach_id,client_id", ignoreDuplicates: true }
    )
    .select("last_viewed_at");

  if (error) {
    console.error("Failed to start coach_client_views:", error);
    throw new Error(`Failed to start the view anchor: ${error.message}`);
  }

  const started = data?.[0]?.last_viewed_at;
  if (started) return started;

  // Nothing inserted: another request started it between our read and our insert.
  const existing = await getLastViewedAt(coachId, clientId);
  if (!existing) throw new Error("Failed to start the view anchor: no anchor after the insert");
  return existing;
};
