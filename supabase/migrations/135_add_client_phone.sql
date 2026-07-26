-- Client phone number (Overview redesign, locked decision 3).
-- Coach-entered contact field surfaced on the redesigned Overview's
-- Client & Schedule card and editable via the client-settings dialog
-- (PATCH /api/clients/[id]). Nullable free text — phone formats vary too much
-- for a DB-level constraint; the zod layer caps length.
ALTER TABLE public.clients ADD COLUMN phone TEXT;
