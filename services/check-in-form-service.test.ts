import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  CheckInFormError,
  createCheckInFormTemplate,
  createCheckInQuestion,
  getClientCheckInForm,
  getCoachClientCheckInForm,
  listCheckInFormTemplates,
  listCheckInQuestions,
  saveClientCheckInForm,
  updateCheckInQuestion,
} from "./check-in-form-service";
import { DEFAULT_CHECK_IN_FORM_FIELDS } from "@/lib/check-in/form-fields";

/** A `check_in_forms` builder whose `.maybeSingle()` resolves to `row`. */
function wireFormRead(row: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn().mockResolvedValue({ data: row, error });
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);
  return builder;
}

const questionRow = (id: string, prompt: string, archivedAt: string | null = null) => ({
  id,
  prompt,
  archived_at: archivedAt,
});

const formRow = (over: Record<string, unknown> = {}) => ({
  id: "form-1",
  name: null,
  created_at: "2026-08-01T00:00:00Z",
  check_in_form_fields: [{ field_key: "weight" }, { field_key: "notes" }],
  check_in_form_questions: [
    { position: 1, enabled: true, check_in_questions: questionRow("q-b", "Second") },
    { position: 0, enabled: true, check_in_questions: questionRow("q-a", "First") },
  ],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("getClientCheckInForm — the client's resolved form", () => {
  it("resolves NO FORM ROW to all 14 fields and no questions", () => {
    // The whole backward-compatibility story: absence means the full form, so
    // this feature needs no backfill and every existing client is unaffected.
    wireFormRead(null);
    return getClientCheckInForm("client-1").then((form) => {
      expect(form.fields).toEqual([...DEFAULT_CHECK_IN_FORM_FIELDS]);
      expect(form.questions).toEqual([]);
    });
  });

  it("returns the form's fields and its enabled questions in position order", async () => {
    wireFormRead(formRow());
    const form = await getClientCheckInForm("client-1");
    expect(form.fields).toEqual(["weight", "notes"]);
    expect(form.questions).toEqual([
      { id: "q-a", prompt: "First" },
      { id: "q-b", prompt: "Second" },
    ]);
  });

  it("hides a DISABLED question from the client", async () => {
    wireFormRead(
      formRow({
        check_in_form_questions: [
          { position: 0, enabled: false, check_in_questions: questionRow("q-a", "Off") },
          { position: 1, enabled: true, check_in_questions: questionRow("q-b", "On") },
        ],
      })
    );
    const form = await getClientCheckInForm("client-1");
    expect(form.questions).toEqual([{ id: "q-b", prompt: "On" }]);
  });

  it("hides an ARCHIVED question even while it is still enabled on the form", async () => {
    wireFormRead(
      formRow({
        check_in_form_questions: [
          {
            position: 0,
            enabled: true,
            check_in_questions: questionRow("q-a", "Retired", "2026-08-20T00:00:00Z"),
          },
        ],
      })
    );
    const form = await getClientCheckInForm("client-1");
    expect(form.questions).toEqual([]);
  });

  it("drops a field key the enum does not know", async () => {
    wireFormRead(formRow({ check_in_form_fields: [{ field_key: "mood" }, { field_key: "weight" }] }));
    const form = await getClientCheckInForm("client-1");
    expect(form.fields).toEqual(["weight"]);
  });

  it("THROWS on a read error rather than impersonating 'no form'", async () => {
    // A swallowed failure would hand the client the full default form and
    // strip nothing on the write path — a silent widening of the form.
    wireFormRead(null, { message: "connection reset" });
    await expect(getClientCheckInForm("client-1")).rejects.toThrow(/connection reset/);
  });
});

describe("getCoachClientCheckInForm — the editor's view", () => {
  it("keeps a disabled question as a row that is OFF", async () => {
    wireFormRead(
      formRow({
        check_in_form_questions: [
          { position: 0, enabled: false, check_in_questions: questionRow("q-a", "Off") },
        ],
      })
    );
    const form = await getCoachClientCheckInForm("client-1");
    expect(form.questions).toEqual([{ id: "q-a", prompt: "Off", enabled: false }]);
  });

  it("seeds a client with no form row from the full default", async () => {
    wireFormRead(null);
    const form = await getCoachClientCheckInForm("client-1");
    expect(form.fields).toEqual([...DEFAULT_CHECK_IN_FORM_FIELDS]);
  });
});

describe("listCheckInFormTemplates", () => {
  it("reads only the coach's client-less rows", async () => {
    const builder = wireFormRead([formRow({ name: "Fortnightly" })]);
    const templates = await listCheckInFormTemplates("coach-1");

    expect(builder.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    expect(builder.is).toHaveBeenCalledWith("client_id", null);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ id: "form-1", name: "Fortnightly" });
    // A template carries its whole content, because applying one replaces the
    // editor's state in the browser — there is no server-side apply.
    expect(templates[0].fields).toEqual(["weight", "notes"]);
    expect(templates[0].questions.map((q) => q.id)).toEqual(["q-a", "q-b"]);
  });
});

describe("saveClientCheckInForm", () => {
  it("passes position as the array index and snake_cases the question payload", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "form-1", error: null } as never);

    await saveClientCheckInForm("coach-1", "client-1", {
      fields: ["weight"],
      questions: [
        { questionId: "q-a", enabled: true },
        { questionId: "q-b", enabled: false },
      ],
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("save_check_in_form_atomic", {
      p_coach_id: "coach-1",
      p_client_id: "client-1",
      p_fields: ["weight"],
      p_questions: [
        { question_id: "q-a", enabled: true },
        { question_id: "q-b", enabled: false },
      ],
    });
  });

  it("translates the RPC's foreign_question refusal into coach-readable text", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: 'foreign_question: a question does not belong to this coach' },
    } as never);

    await expect(
      saveClientCheckInForm("coach-1", "client-1", { fields: [], questions: [] })
    ).rejects.toBeInstanceOf(CheckInFormError);
  });

  it("does not disguise an unrecognised database error as a coach mistake", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "deadlock detected" },
    } as never);

    const err = await saveClientCheckInForm("coach-1", "client-1", {
      fields: [],
      questions: [],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CheckInFormError);
  });
});

describe("createCheckInFormTemplate", () => {
  it("calls the template RPC with the name", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "form-2", error: null } as never);

    const id = await createCheckInFormTemplate("coach-1", "Fortnightly", {
      fields: ["notes"],
      questions: [],
    });

    expect(id).toBe("form-2");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("create_check_in_form_template_atomic", {
      p_coach_id: "coach-1",
      p_name: "Fortnightly",
      p_fields: ["notes"],
      p_questions: [],
    });
  });
});

describe("the question bank", () => {
  it("lists only the coach's unarchived questions", async () => {
    const builder = wireFormRead([
      { id: "q-a", prompt: "How was sleep?", created_at: "2026-08-01T00:00:00Z" },
    ]);
    const questions = await listCheckInQuestions("coach-1");

    expect(builder.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    expect(builder.is).toHaveBeenCalledWith("archived_at", null);
    expect(questions).toEqual([
      { id: "q-a", prompt: "How was sleep?", createdAt: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("creates a question scoped to the coach", async () => {
    const builder: Record<string, unknown> = {};
    builder.insert = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.single = vi.fn().mockResolvedValue({
      data: { id: "q-new", prompt: "New?", created_at: "2026-08-30T00:00:00Z" },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);

    const q = await createCheckInQuestion("coach-1", "New?");

    expect(builder.insert).toHaveBeenCalledWith({ coach_id: "coach-1", prompt: "New?" });
    expect(q.id).toBe("q-new");
  });

  it("scopes an update on BOTH id and coach_id, and reads a foreign id as not found", async () => {
    const builder: Record<string, unknown> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);

    const result = await updateCheckInQuestion("coach-1", "q-foreign", { prompt: "x" });

    expect(result).toBeNull();
    const eqCalls = (builder.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(["id", "q-foreign"]);
    expect(eqCalls).toContainEqual(["coach_id", "coach-1"]);
  });

  it("archives by stamping archived_at, and restores by nulling it", async () => {
    const builder: Record<string, unknown> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "q-a", prompt: "p", created_at: "2026-08-01T00:00:00Z" },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);

    await updateCheckInQuestion("coach-1", "q-a", { archived: true });
    const archivePatch = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(archivePatch.archived_at).toEqual(expect.any(String));

    await updateCheckInQuestion("coach-1", "q-a", { archived: false });
    const restorePatch = (builder.update as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(restorePatch.archived_at).toBeNull();
  });

  it("leaves the prompt alone when only the archive flag is sent", async () => {
    const builder: Record<string, unknown> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "q-a", prompt: "p", created_at: "2026-08-01T00:00:00Z" },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);

    await updateCheckInQuestion("coach-1", "q-a", { archived: true });
    const patch = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch).not.toHaveProperty("prompt");
  });
});
