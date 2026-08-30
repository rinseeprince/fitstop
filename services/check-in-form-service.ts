import { supabaseAdmin } from "./supabase-admin";
import {
  DEFAULT_CHECK_IN_FORM_FIELDS,
  isCheckInFormFieldKey,
} from "@/lib/check-in/form-fields";
import type {
  CheckInFormConfig,
  CheckInFormEditorConfig,
  CheckInFormEditorQuestion,
  CheckInFormTemplate,
  CheckInQuestion,
} from "@/types/check-in";
import type { SaveCheckInFormInput } from "@/lib/validations/check-in-form";

/**
 * The customisable check-in form (#4 of the coach check-ins workstream).
 *
 * Shape B (CONVENTIONS §8): `supabaseAdmin` with an explicit caller-verified
 * scope. Every read and write here filters on the `coachId` or `clientId` the
 * ROUTE proved — with one thing the route cannot prove, which is why the write
 * goes through an RPC: that every referenced question belongs to this coach.
 * `check_in_form_write_children` re-checks it in SQL.
 */

/** The embedded read both resolvers share. One round trip, not four. */
const FORM_SELECT = `
  id,
  name,
  created_at,
  check_in_form_fields ( field_key ),
  check_in_form_questions (
    position,
    enabled,
    check_in_questions ( id, prompt, archived_at )
  )
`;

type FormRow = {
  id: string;
  name: string | null;
  created_at: string;
  check_in_form_fields: { field_key: string }[] | null;
  check_in_form_questions:
    | {
        position: number;
        enabled: boolean;
        check_in_questions: { id: string; prompt: string; archived_at: string | null } | null;
      }[]
    | null;
};

/**
 * Questions a form asks, newest schema-order first.
 *
 * An ARCHIVED question is dropped from both audiences, not just the client's.
 * A coach who archived one has retired it; leaving it on the editor as a row
 * they cannot un-archive would be a control that does nothing. The join row
 * survives and is inert — the next save simply stops writing it.
 */
function mapQuestions(row: FormRow): CheckInFormEditorQuestion[] {
  return (row.check_in_form_questions ?? [])
    .filter((q) => q.check_in_questions !== null && q.check_in_questions.archived_at === null)
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      // Non-null asserted by the filter above; narrowed here for the compiler.
      id: q.check_in_questions!.id,
      prompt: q.check_in_questions!.prompt,
      enabled: q.enabled,
    }));
}

function mapFields(row: FormRow): string[] {
  return (row.check_in_form_fields ?? [])
    .map((f) => f.field_key)
    .filter(isCheckInFormFieldKey);
}

async function readClientFormRow(clientId: string): Promise<FormRow | null> {
  const { data, error } = await supabaseAdmin
    .from("check_in_forms")
    .select(FORM_SELECT)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    // Never impersonate "no form": a failed read would silently hand the
    // client the full default form and strip nothing on the write path.
    throw new Error(`Failed to read check-in form: ${error.message}`);
  }
  return (data as FormRow | null) ?? null;
}

/**
 * The CLIENT's resolved form — what the wizard renders and what the submit
 * path strips against.
 *
 * `fields` is always resolved and never null: **no form row means all 14
 * keys**, which is the entire backward-compatibility story for this feature
 * (no backfill exists, and none is needed). `questions` is enabled and
 * unarchived, in position order.
 */
export async function getClientCheckInForm(clientId: string): Promise<CheckInFormConfig> {
  const row = await readClientFormRow(clientId);
  if (!row) {
    return { fields: [...DEFAULT_CHECK_IN_FORM_FIELDS], questions: [] };
  }
  return {
    fields: mapFields(row),
    questions: mapQuestions(row)
      .filter((q) => q.enabled)
      .map(({ id, prompt }) => ({ id, prompt })),
  };
}

/**
 * The COACH's editor view of a client's form: the same rows, but carrying
 * `enabled` so a disabled question renders as a row that is off rather than
 * vanishing. A client with no form row seeds the editor with the full default.
 */
export async function getCoachClientCheckInForm(
  clientId: string
): Promise<CheckInFormEditorConfig> {
  const row = await readClientFormRow(clientId);
  if (!row) {
    return { fields: [...DEFAULT_CHECK_IN_FORM_FIELDS], questions: [] };
  }
  return { fields: mapFields(row), questions: mapQuestions(row) };
}

/** The coach's saved templates, each carrying its own fields and questions. */
export async function listCheckInFormTemplates(
  coachId: string
): Promise<CheckInFormTemplate[]> {
  const { data, error } = await supabaseAdmin
    .from("check_in_forms")
    .select(FORM_SELECT)
    .eq("coach_id", coachId)
    .is("client_id", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list check-in form templates: ${error.message}`);

  return ((data ?? []) as FormRow[]).map((row) => ({
    id: row.id,
    // The CHECK constraint makes a template's name non-null; the fallback is
    // for the compiler, not for a row that can exist.
    name: row.name ?? "Untitled",
    createdAt: row.created_at,
    fields: mapFields(row),
    questions: mapQuestions(row),
  }));
}

/**
 * Save a client's form — three tables in one transaction (migration 157).
 *
 * Nothing here touches a `clients` column. `updateClientCheckInConfig` is a
 * FULL REPLACE of the four scheduling columns, so routing a form save through
 * it would clear the client's `next_check_in_due` (ARCHITECTURE: "Two writers,
 * and only two"). This is why the form lives in its own tables.
 */
export async function saveClientCheckInForm(
  coachId: string,
  clientId: string,
  input: SaveCheckInFormInput
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("save_check_in_form_atomic", {
    p_coach_id: coachId,
    p_client_id: clientId,
    p_fields: input.fields,
    p_questions: input.questions.map((q) => ({
      question_id: q.questionId,
      enabled: q.enabled,
    })),
  });

  if (error) throw translateFormRpcError(error);
  return data;
}

/** Save the editor's current state as a named template in the coach's library. */
export async function createCheckInFormTemplate(
  coachId: string,
  name: string,
  input: SaveCheckInFormInput
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc(
    "create_check_in_form_template_atomic",
    {
      p_coach_id: coachId,
      p_name: name,
      p_fields: input.fields,
      p_questions: input.questions.map((q) => ({
        question_id: q.questionId,
        enabled: q.enabled,
      })),
    }
  );

  if (error) throw translateFormRpcError(error);
  return data;
}

/**
 * The RPCs' message prefixes are a contract (the `move_training_events_atomic`
 * shape). Translated here so a coach never sees Postgres text.
 */
export class CheckInFormError extends Error {}

function translateFormRpcError(error: { message: string }): Error {
  if (error.message.includes("foreign_question")) {
    return new CheckInFormError("A question on this form is not one of yours.");
  }
  if (error.message.includes("template_needs_name")) {
    return new CheckInFormError("Give the template a name.");
  }
  return new Error(`Failed to save check-in form: ${error.message}`);
}

/** The coach's question bank, newest first. Archived questions are excluded. */
export async function listCheckInQuestions(coachId: string): Promise<CheckInQuestion[]> {
  const { data, error } = await supabaseAdmin
    .from("check_in_questions")
    .select("id, prompt, created_at")
    .eq("coach_id", coachId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list check-in questions: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
  }));
}

export async function createCheckInQuestion(
  coachId: string,
  prompt: string
): Promise<CheckInQuestion> {
  const { data, error } = await supabaseAdmin
    .from("check_in_questions")
    .insert({ coach_id: coachId, prompt })
    .select("id, prompt, created_at")
    .single();

  if (error) throw new Error(`Failed to create check-in question: ${error.message}`);
  return { id: data.id, prompt: data.prompt, createdAt: data.created_at };
}

/**
 * Reword or archive one question.
 *
 * Scoped on BOTH `id` and `coach_id` — that filter is the entire safety story
 * for a guessed id (the `deleteClientNote` precedent). Never widen it. A
 * rewording changes the question everywhere it is asked, including the label
 * above every past answer, because it is the same question.
 */
export async function updateCheckInQuestion(
  coachId: string,
  questionId: string,
  changes: { prompt?: string; archived?: boolean }
): Promise<CheckInQuestion | null> {
  const patch: { prompt?: string; archived_at?: string | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (changes.prompt !== undefined) patch.prompt = changes.prompt;
  if (changes.archived !== undefined) {
    patch.archived_at = changes.archived ? new Date().toISOString() : null;
  }

  const { data, error } = await supabaseAdmin
    .from("check_in_questions")
    .update(patch)
    .eq("id", questionId)
    .eq("coach_id", coachId)
    .select("id, prompt, created_at")
    .maybeSingle();

  if (error) throw new Error(`Failed to update check-in question: ${error.message}`);
  if (!data) return null;
  return { id: data.id, prompt: data.prompt, createdAt: data.created_at };
}
