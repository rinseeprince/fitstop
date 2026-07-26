-- Coach notes about a client (Overview redesign, Session 1).
-- Replaces the single free-text clients.notes blob with individual note rows so
-- the Overview can pin one note and list the rest newest-first. The legacy
-- clients.notes column stays in place (still read by the current UI until the
-- Session 2 rebuild ships); it is seeded below into one unpinned row per client
-- and receives no further writes from the new notes surface.
-- coach_id is SET NULL so deleting a coach never destroys a client's note
-- history (same posture as client_metric_entries.created_by).
-- updated_at is managed in app code (no trigger — matches migrations >= 100).

CREATE TABLE public.client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_id UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves the page's single read ("all notes for this client, newest first").
CREATE INDEX idx_client_notes_client_created
  ON public.client_notes (client_id, created_at DESC);

-- At most one pinned note per client; the pin flow unpins the previous note
-- before pinning the next, and this index backstops any race.
CREATE UNIQUE INDEX idx_client_notes_one_pinned
  ON public.client_notes (client_id)
  WHERE is_pinned;

-- Seed: carry the existing free-text notes over as one unpinned row per client.
INSERT INTO public.client_notes (client_id, coach_id, body)
SELECT id, coach_id, notes
FROM public.clients
WHERE notes IS NOT NULL AND btrim(notes) <> '';

-- CONVENTIONS §8: deny-all RLS (no policies — every app read/write goes through
-- service_role, which bypasses RLS) + explicit grant because auto-expose is off.
ALTER TABLE IF EXISTS public.client_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_notes TO service_role;
