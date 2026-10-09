-- =============================================================================
-- 215_invitation_dates_decide.sql -- an invitation's state is its dates
-- (docs/BETTER-AUTH-PLAN.md section 2.12, D40; commit 10, owner 2026-10-10).
--
-- client_invitations.status said the wrong thing twice: 'pending' was written
-- only when an invitation's email failed, and 'expired' never (a link's expiry
-- is expires_at, read when the link is opened). The coach's Invite box, built
-- on it, offered no button for a 'pending' row, so a client whose email had
-- failed could not be sent another. From this migration a row exists only once
-- its email has gone: invited_at says when, expires_at until when its link
-- works, accepted_at that it was used, and whether the client has an account
-- is clients.user_id. The app judges a link by one predicate on those dates
-- (invitationLinkWorks, services/invitation-service.ts), for the Invite box and
-- the invite page alike.
--
-- 1. A refusal: an 'accepted' row with no accepted_at, whose link the drop
--    would make live again, stops the migration with nothing changed.
-- 2. The column goes, and with it its CHECK, its default and
--    idx_client_invitations_status. The rows a failed email left 'pending'
--    (6 on DEV on 2026-10-10, every one past its expires_at) read from here
--    as links that expired, which is what they are, and are left as they are.
-- 3. The table's COMMENT says what each date means.
-- 4. A closing check, in migration 201's shape: no status column, no
--    idx_client_invitations_status, and the UNIQUE (client_id) key the send's
--    upsert names still there and valid. It prints how many invitations there
--    are, by what their dates say.
--
-- Re-runnable. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The refusal.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'client_invitations' AND column_name = 'status'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.client_invitations WHERE status = 'accepted' AND accepted_at IS NULL) THEN
      RAISE EXCEPTION 'Migration 215: an accepted invitation has no accepted_at: dropping status would make its link live again';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_invitations DROP COLUMN IF EXISTS status;   -- its CHECK, its default and idx_client_invitations_status go with it

-- ---------------------------------------------------------------------------
-- 3. The table's COMMENT.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.client_invitations IS
  'One invitation per client, written only once its email has gone: invited_at when, expires_at until when its link works, accepted_at when it was used. Whether the client has an account is clients.user_id.';

-- ---------------------------------------------------------------------------
-- 4. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  live    integer;
  used    integer;
  expired integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.client_invitations'::regclass
       AND a.attname = 'status'
       AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration 215: client_invitations.status is still there';
  END IF;

  IF to_regclass('public.idx_client_invitations_status') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 215: idx_client_invitations_status is still there';
  END IF;

  -- The key the send's upsert names (ON CONFLICT (client_id)): a UNIQUE
  -- constraint on client_id alone, validated, its index valid.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_index i ON i.indexrelid = c.conindid
     WHERE c.conrelid = 'public.client_invitations'::regclass
       AND c.contype = 'u'
       AND c.convalidated
       AND i.indisvalid
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = 'public.client_invitations'::regclass AND a.attname = 'client_id')]::int2[]
  ) THEN
    RAISE EXCEPTION 'Migration 215: client_invitations has no valid UNIQUE (client_id) key';
  END IF;

  SELECT count(*) FILTER (WHERE accepted_at IS NULL AND (expires_at IS NULL OR expires_at > now())),
         count(*) FILTER (WHERE accepted_at IS NOT NULL),
         count(*) FILTER (WHERE accepted_at IS NULL AND expires_at <= now())
    INTO live, used, expired
    FROM public.client_invitations;
  RAISE NOTICE 'Migration 215: % invitations whose link works, % used, % whose link expired', live, used, expired;
END $$;
