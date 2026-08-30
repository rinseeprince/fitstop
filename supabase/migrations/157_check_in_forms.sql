-- =============================================================================
-- 157_check_in_forms.sql -- customisable check-ins (#4 of the coach check-ins
-- workstream). Five tables + two atomic RPCs (plus one internal helper).
-- Additive: no column is added to `clients` or `check_ins`, and no existing
-- object is altered.
--
-- WHY FIVE TABLES AND NOT A JSONB COLUMN (CONVENTIONS section 1 / section 8
-- "Data modelling"). The draft this replaces put the coach's questions on
-- `clients` as a JSONB array and snapshotted each prompt onto the answer, to
-- hide that nothing could reference a question. Every line of the section 8
-- test comes back "yes" here:
--   * an answer REFERENCES a question           -> a FK, not an id inside JSON
--   * a question is EDITED IN PLACE (reworded)  -> one row, not N copies
--   * a form's questions are ORDERED and toggled per owner
--                                               -> a join row with position/enabled
--   * "how did answers to Q3 change"            -> an index on question_id
--   * the 14 built-ins are a fixed enum with presence semantics
--                                               -> a (form_id, field_key) join table
-- JSONB here is for value-bags with no identity. This has identity everywhere.
--
-- NO SNAPSHOT COLUMN ON THE ANSWER, deliberately. The prompt lives on the
-- question row and is read through the FK, so rewording a question relabels
-- every past answer -- which is the point: it is the same question. If wording
-- HISTORY is ever wanted it is a check_in_question_versions table, not a text
-- column copied onto N answers.
--
-- NO answer_type COLUMN. An earlier draft carried one, NOT NULL DEFAULT 'text'
-- with a single-value CHECK, as "the seam for scale/yes-no later". It was
-- dropped before this file was written: nothing would read or write it, and
-- client_goals.primary_goal is the standing evidence that an inert column
-- acquires an unconditional writer and becomes undroppable. A second answer
-- type arrives as ALTER TABLE ADD COLUMN in the migration that needs it --
-- additive, defaulted, no backfill.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The coach's question bank. One row per question, edited in place.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 300),
  -- Curation, not deletion: a question that has been answered cannot be
  -- deleted on its own (see check_in_answers below), so archiving is the only
  -- way to retire one. An archived question leaves every form's client-facing
  -- view while its past answers keep resolving their prompt through the FK.
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.check_in_questions IS
  'A coach''s bank of custom check-in questions. Edited IN PLACE -- rewording changes the question everywhere it is asked and relabels every past answer, because it is the same question. Retired by setting archived_at, never deleted once answered.';

CREATE INDEX IF NOT EXISTS idx_check_in_questions_coach
  ON public.check_in_questions (coach_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. A form. client_id NULL = a named reusable template in the coach's
--    library; NOT NULL = that client's own form (at most one). NO ROW for a
--    client means today's full form -- that default is what lets every
--    existing client keep working with no backfill.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_forms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_in_forms_template_named CHECK (client_id IS NOT NULL OR name IS NOT NULL)
);

COMMENT ON TABLE public.check_in_forms IS
  'One check-in form. client_id NOT NULL = that client''s own form (at most one, see check_in_forms_one_per_client); client_id NULL = a named template in the coach''s library. NO ROW for a client = the full default form, which is why this feature needs no backfill. Templates are COPIED onto a client, never referenced live (ARCHITECTURE: the library model is copy-based) -- the join rows are copied, the questions are shared.';

CREATE UNIQUE INDEX IF NOT EXISTS check_in_forms_one_per_client
  ON public.check_in_forms (client_id) WHERE client_id IS NOT NULL;

-- The template list. Partial, because client-form rows are reached by the
-- unique index above and would only bloat this one.
CREATE INDEX IF NOT EXISTS idx_check_in_forms_templates
  ON public.check_in_forms (coach_id, created_at DESC) WHERE client_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Which BUILT-IN client-populated fields a form asks. Row present = asked.
--    Presence in a join table is the normal form for a fixed enum of keys.
--
--    Fourteen keys, and that is the COMPLETE set of fields the client fills
--    in. mood/energy/sleep/stress/soreness are absent because they are not
--    collected: Session 6.4 removed the pickers and sliders, and submitCheckIn
--    derives those five from wellness_logs over the period. The Feeling step's
--    weekly summary and the Training step's session checklist are read-only
--    viewers of the client's own week (the checklist is a fill-gap logger
--    writing to training_events), not questions -- suppressing those is a
--    different feature, filed in TECHNICAL-DEBT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_form_fields (
  form_id    UUID NOT NULL REFERENCES public.check_in_forms(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL CHECK (field_key IN (
    'notes','weight','body_fat','waist','hips','chest','arms','thighs',
    'photo_front','photo_side','photo_back','exercise_highlights','prs','challenges')),
  PRIMARY KEY (form_id, field_key)
);

COMMENT ON TABLE public.check_in_form_fields IS
  'Which of the 14 built-in client-populated check-in fields a form asks. Row present = enabled; the CHECK is the enum. These keys are the storage half of lib/check-in/form-fields.ts -- adding one means a new CHECK value AND a new entry there.';

-- ---------------------------------------------------------------------------
-- 4. Which questions a form asks, in what order, and whether each is on.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_form_questions (
  form_id      UUID NOT NULL REFERENCES public.check_in_forms(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES public.check_in_questions(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL CHECK (position >= 0),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (form_id, question_id),
  UNIQUE (form_id, position)
);

COMMENT ON TABLE public.check_in_form_questions IS
  'Membership, order and on/off of a question on one form. UNIQUE(form_id, position) is safe because the only writer replaces every row of a form inside one transaction (check_in_form_write_children) -- it never renumbers in place. question_id is deliberately NOT indexed: nothing queries by it and questions are archived rather than deleted, so the CASCADE carries no traffic (same call as nutrition_plan_notes.coach_id, migration 147).';

-- ---------------------------------------------------------------------------
-- 5. The client's answers. One row per (check-in, question).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id  UUID NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,
  -- NO ACTION, not RESTRICT, and the difference is load-bearing. Both refuse a
  -- bare "delete this answered question", which is what forces archive-instead-
  -- of-delete. But RESTRICT is checked IMMEDIATELY and is not deferrable, so a
  -- DELETE FROM coaches -- which cascades to clients -> check_ins -> these rows
  -- AND to check_in_questions in the same statement -- would abort or not
  -- depending on which branch of the cascade tree Postgres walked first.
  -- NO ACTION defers to end-of-statement, by which time the answers are gone,
  -- so a full teardown succeeds in any order. There IS a live coach-delete
  -- path: scripts/seed-scale-client.ts --fullReset.
  question_id  UUID NOT NULL REFERENCES public.check_in_questions(id) ON DELETE NO ACTION,
  answer       TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (check_in_id, question_id)
  -- No updated_at: an answer is an immutable submission event (CONVENTIONS
  -- section 8, body_metrics precedent). A submitted check-in has no edit path.
);

COMMENT ON TABLE public.check_in_answers IS
  'A client''s answer to one custom question on one check-in. The question_id FK is ON DELETE NO ACTION: deleting an answered question on its own fails (23503), which is what forces archive-instead-of-delete, while a full coach/client teardown that removes the answers in the same statement still succeeds. Prompts are resolved through the FK, never snapshotted here.';

-- "How did answers to Q trend", and the FK check on a question delete.
CREATE INDEX IF NOT EXISTS idx_check_in_answers_question
  ON public.check_in_answers (question_id);

-- ---------------------------------------------------------------------------
-- CONVENTIONS section 8: deny-all RLS (no policies -- every read and write
-- goes through supabaseAdmin, which bypasses RLS) plus an explicit grant,
-- because "automatically expose new tables" is OFF and PostgREST cannot see a
-- table without one. service_role only; anon and authenticated need nothing.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.check_in_questions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.check_in_forms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.check_in_form_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.check_in_form_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.check_in_answers        ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.check_in_questions      TO service_role;
GRANT ALL ON TABLE public.check_in_forms          TO service_role;
GRANT ALL ON TABLE public.check_in_form_fields    TO service_role;
GRANT ALL ON TABLE public.check_in_form_questions TO service_role;
GRANT ALL ON TABLE public.check_in_answers        TO service_role;

-- ---------------------------------------------------------------------------
-- Shared child-writer. NOT a public RPC: the two writers below call it as the
-- definer, so it needs no service_role grant. It exists because both replace
-- the same two child tables under the same coach-ownership rule, and two
-- copies of that rule is exactly the drift CONVENTIONS section 2 forbids.
--
-- The ownership check is load-bearing. The ROUTE proves the coach owns the
-- CLIENT; nothing outside this function proves they own the QUESTIONS, and a
-- form row pointing at another coach's question would put that coach's wording
-- in front of this coach's client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_in_form_write_children(
  p_form_id   UUID,
  p_coach_id  UUID,
  p_fields    TEXT[],
  p_questions JSONB
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'invalid_questions: p_questions must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_questions) AS q
     WHERE NOT EXISTS (
       SELECT 1 FROM check_in_questions cq
        WHERE cq.id = (q->>'question_id')::uuid
          AND cq.coach_id = p_coach_id
     )
  ) THEN
    RAISE EXCEPTION 'foreign_question: a question does not belong to this coach';
  END IF;

  DELETE FROM check_in_form_fields    WHERE form_id = p_form_id;
  DELETE FROM check_in_form_questions WHERE form_id = p_form_id;

  IF p_fields IS NOT NULL AND array_length(p_fields, 1) > 0 THEN
    INSERT INTO check_in_form_fields (form_id, field_key)
    SELECT p_form_id, f FROM unnest(p_fields) AS f;
  END IF;

  INSERT INTO check_in_form_questions (form_id, question_id, position, enabled)
  SELECT p_form_id,
         (q.value->>'question_id')::uuid,
         (q.ordinality - 1)::int,
         COALESCE((q.value->>'enabled')::boolean, true)
    FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS q(value, ordinality);
END;
$$;

REVOKE EXECUTE ON FUNCTION check_in_form_write_children(UUID, UUID, TEXT[], JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC 1 -- save a CLIENT's form. Three tables in one transaction.
--
-- No optional parameters anywhere in this file: the generated Args type never
-- emits `| null`, so a DEFAULT NULL parameter forces an `as never` cast at the
-- call site (the landmine still live on create_training_plan_atomic).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_check_in_form_atomic(
  p_coach_id  UUID,
  p_client_id UUID,
  p_fields    TEXT[],
  p_questions JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form_id UUID;
BEGIN
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_client: p_client_id is required';
  END IF;

  -- At most one form per client (check_in_forms_one_per_client). FOR UPDATE
  -- serialises two concurrent saves onto one row instead of racing the index.
  SELECT id INTO v_form_id FROM check_in_forms WHERE client_id = p_client_id FOR UPDATE;

  IF v_form_id IS NULL THEN
    INSERT INTO check_in_forms (coach_id, client_id)
         VALUES (p_coach_id, p_client_id)
      RETURNING id INTO v_form_id;
  ELSE
    UPDATE check_in_forms SET updated_at = NOW() WHERE id = v_form_id;
  END IF;

  PERFORM check_in_form_write_children(v_form_id, p_coach_id, p_fields, p_questions);
  RETURN v_form_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_check_in_form_atomic(UUID, UUID, TEXT[], JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_check_in_form_atomic(UUID, UUID, TEXT[], JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- RPC 2 -- save the editor's current state as a named TEMPLATE. Same three
-- tables, one transaction. A template is a COPY: the join rows are new, the
-- questions are shared with the client form it came from.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_check_in_form_template_atomic(
  p_coach_id  UUID,
  p_name      TEXT,
  p_fields    TEXT[],
  p_questions JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form_id UUID;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'template_needs_name: a template must be named';
  END IF;

  INSERT INTO check_in_forms (coach_id, client_id, name)
       VALUES (p_coach_id, NULL, btrim(p_name))
    RETURNING id INTO v_form_id;

  PERFORM check_in_form_write_children(v_form_id, p_coach_id, p_fields, p_questions);
  RETURN v_form_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_check_in_form_template_atomic(UUID, TEXT, TEXT[], JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_check_in_form_template_atomic(UUID, TEXT, TEXT[], JSONB)
  TO service_role;
