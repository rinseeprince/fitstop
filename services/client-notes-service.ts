import { supabaseAdmin } from "./supabase-admin";
import type { ClientNote } from "@/types/coach-overview";

/**
 * Coach notes about a client (client_notes, migration 134). At most one note
 * per client is pinned — pinning unpins the previous note first, and the
 * partial unique index backstops any race. Shape B: routes verify the coach
 * owns the client; every query here filters on the passed clientId.
 */

type ClientNoteRow = {
  id: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
};

const NOTE_COLUMNS = "id, body, is_pinned, created_at";

function mapNoteRow(row: ClientNoteRow): ClientNote {
  return {
    id: row.id,
    body: row.body,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
  };
}

/** Pinned first, then newest-first. */
export const listClientNotes = async (clientId: string): Promise<ClientNote[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_notes")
    .select(NOTE_COLUMNS)
    .eq("client_id", clientId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch client notes:", error);
    throw new Error(`Failed to fetch notes: ${error.message}`);
  }
  return (data ?? []).map(mapNoteRow);
};

export const createClientNote = async (
  clientId: string,
  coachId: string,
  body: string
): Promise<ClientNote> => {
  const { data, error } = await supabaseAdmin
    .from("client_notes")
    .insert({ client_id: clientId, coach_id: coachId, body })
    .select(NOTE_COLUMNS)
    .single();

  if (error) {
    console.error("Failed to create client note:", error);
    throw new Error(`Failed to create note: ${error.message}`);
  }
  return mapNoteRow(data);
};

/**
 * Pin or unpin a note. Returns null when the note doesn't belong to this
 * client (the route 404s). Pinning unpins any other pinned note first so the
 * one-pinned-per-client unique index is never violated.
 */
export const setClientNotePinned = async (
  clientId: string,
  noteId: string,
  isPinned: boolean
): Promise<ClientNote | null> => {
  // Verify the note exists and belongs to this client BEFORE the unpin sweep:
  // the two writes are separate PostgREST requests with no transaction, so
  // sweeping first would clear the client's existing pin even when the request
  // ends in 404 (stale/foreign noteId).
  const { data: existing, error: readError } = await supabaseAdmin
    .from("client_notes")
    .select("id")
    .eq("id", noteId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (readError) {
    console.error("Failed to read client note:", readError);
    throw new Error(`Failed to update note: ${readError.message}`);
  }
  if (!existing) return null;

  if (isPinned) {
    const { error: unpinError } = await supabaseAdmin
      .from("client_notes")
      .update({ is_pinned: false, updated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("is_pinned", true)
      .neq("id", noteId);

    if (unpinError) {
      console.error("Failed to unpin previous client note:", unpinError);
      throw new Error(`Failed to update note: ${unpinError.message}`);
    }
  }

  const { data, error } = await supabaseAdmin
    .from("client_notes")
    .update({ is_pinned: isPinned, updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .eq("client_id", clientId)
    .select(NOTE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("Failed to update client note:", error);
    throw new Error(`Failed to update note: ${error.message}`);
  }
  return data ? mapNoteRow(data) : null;
};
