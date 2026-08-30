import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const {
  mockUseCheckInQuestions,
  mockUseCheckInFormTemplates,
  mockInvalidateForm,
  mockInvalidateBank,
  mockInvalidateTemplates,
  mockToast,
} = vi.hoisted(() => ({
  mockUseCheckInQuestions: vi.fn(),
  mockUseCheckInFormTemplates: vi.fn(),
  mockInvalidateForm: vi.fn(),
  mockInvalidateBank: vi.fn(),
  mockInvalidateTemplates: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-check-in-form-config", () => ({
  useCheckInQuestions: mockUseCheckInQuestions,
  useCheckInFormTemplates: mockUseCheckInFormTemplates,
  useInvalidateClientCheckInForm: () => mockInvalidateForm,
  useInvalidateCheckInQuestions: () => mockInvalidateBank,
  useInvalidateCheckInFormTemplates: () => mockInvalidateTemplates,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

import { useCheckInFormEditor } from "./use-check-in-form-editor";

const FORM = {
  fields: ["notes", "weight", "prs"],
  questions: [
    { id: "q-1", prompt: "How did the split feel?", enabled: true },
    { id: "q-2", prompt: "Sleep any better?", enabled: false },
  ],
};

function mount(onClose = vi.fn(), initialForm = FORM) {
  return renderHook(() =>
    useCheckInFormEditor({ clientId: "client-1", initialForm, onClose })
  );
}

function okFetch(data: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  });
}

describe("useCheckInFormEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCheckInQuestions.mockReturnValue({
      questions: [
        { id: "q-1", prompt: "How did the split feel?", createdAt: "" },
        { id: "q-3", prompt: "Anything hurting?", createdAt: "" },
      ],
      isLoading: false,
      isError: false,
    });
    mockUseCheckInFormTemplates.mockReturnValue({
      templates: [],
      isLoading: false,
      isError: false,
    });
    mockInvalidateForm.mockResolvedValue(undefined);
    mockInvalidateBank.mockResolvedValue(undefined);
    mockInvalidateTemplates.mockResolvedValue(undefined);
  });

  it("initialises from the saved form, disabled questions included", () => {
    const { result } = mount();
    expect(result.current.fields).toEqual(["notes", "weight", "prs"]);
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-1", "q-2"]);
    expect(result.current.questions[1].enabled).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("does NOT re-read the prop after mount, so edits survive a revalidation", () => {
    // State is initialised ONCE from `initialForm`, structurally — there is no
    // effect syncing it, so a re-render carrying the stored (pre-edit) form
    // cannot clobber an edit in progress.
    const { result, rerender } = mount();
    act(() => result.current.toggleField("weight"));
    expect(result.current.fields).not.toContain("weight");

    rerender();

    expect(result.current.fields).not.toContain("weight");
  });

  it("toggles a field off and back on", () => {
    const { result } = mount();
    act(() => result.current.toggleField("weight"));
    expect(result.current.fields).toEqual(["notes", "prs"]);
    act(() => result.current.toggleField("weight"));
    expect(result.current.fields).toEqual(["notes", "prs", "weight"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("reorders by drag (active over target), removes and adds questions", () => {
    const { result } = mount();

    act(() => result.current.reorderQuestion("q-2", "q-1"));
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-2", "q-1"]);

    // A drop onto a row that is not on the list is a no-op, not a splice at -1.
    act(() => result.current.reorderQuestion("q-2", "not-here"));
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-2", "q-1"]);

    act(() => result.current.removeQuestion("q-2"));
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-1"]);

    act(() =>
      result.current.addExistingQuestion({ id: "q-3", prompt: "Anything hurting?" })
    );
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-1", "q-3"]);
    expect(result.current.questions[1].enabled).toBe(true);
  });

  it("will not add the same question twice", () => {
    const { result } = mount();
    act(() =>
      result.current.addExistingQuestion({ id: "q-1", prompt: "How did the split feel?" })
    );
    expect(result.current.questions).toHaveLength(2);
  });

  it("caps a form at MAX_CHECK_IN_QUESTIONS", () => {
    const { result } = mount(vi.fn(), {
      fields: [],
      questions: Array.from({ length: 10 }, (_, i) => ({
        id: `q${i}`,
        prompt: `Q${i}`,
        enabled: true,
      })),
    });
    act(() => result.current.addExistingQuestion({ id: "extra", prompt: "One more" }));
    expect(result.current.questions).toHaveLength(10);
  });

  it("saves fields and questions with POSITION AS THE ARRAY ORDER", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    const { result } = mount(onClose);

    act(() => result.current.reorderQuestion("q-2", "q-1"));
    await act(async () => {
      await result.current.save();
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-1/check-in-form");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      fields: ["notes", "weight", "prs"],
      questions: [
        { questionId: "q-2", enabled: false },
        { questionId: "q-1", enabled: true },
      ],
    });
    expect(mockInvalidateForm).toHaveBeenCalledWith("client-1");
    expect(onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps the sheet open and toasts when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ success: false, error: "A question is not yours" }),
      })
    );
    const onClose = vi.fn();
    const { result } = mount(onClose);

    await act(async () => {
      await result.current.save();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })
    );
    vi.unstubAllGlobals();
  });

  it("a reword updates the row ON SCREEN, not just the bank cache", async () => {
    // The editor's list is local state seeded once per open, so an
    // invalidate-only reword would leave the old wording visible until the
    // sheet was reopened — while the card promises the change lands everywhere.
    vi.stubGlobal("fetch", okFetch());
    const { result } = mount();

    await act(async () => {
      await result.current.renameQuestion("q-1", "How is the new split?");
    });

    expect(result.current.questions[0].prompt).toBe("How is the new split?");
    expect(mockInvalidateBank).toHaveBeenCalled();
    // The bank row was already written, so the FORM is not dirty.
    expect(result.current.isDirty).toBe(false);
    vi.unstubAllGlobals();
  });

  it("creating a question writes the bank row and puts it on the form", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({ question: { id: "q-9", prompt: "New one?" } })
    );
    const { result } = mount();

    await act(async () => {
      await result.current.createQuestion("New one?");
    });

    await waitFor(() =>
      expect(result.current.questions.map((q) => q.id)).toEqual(["q-1", "q-2", "q-9"])
    );
    vi.unstubAllGlobals();
  });

  it("applying a template REPLACES the editor and writes nothing", () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = mount();

    act(() =>
      result.current.applyTemplate({
        id: "t-1",
        name: "Fat loss",
        createdAt: "",
        fields: ["weight"],
        questions: [{ id: "q-3", prompt: "Anything hurting?", enabled: true }],
      })
    );

    expect(result.current.fields).toEqual(["weight"]);
    expect(result.current.questions.map((q) => q.id)).toEqual(["q-3"]);
    expect(result.current.appliedTemplateId).toBe("t-1");
    // Copy-based: nothing lands until Save changes.
    expect(fetchMock).not.toHaveBeenCalled();

    // The first edit after applying clears the marker, which is what makes
    // re-applying the same template expressible.
    act(() => result.current.toggleField("weight"));
    expect(result.current.appliedTemplateId).toBeNull();
    vi.unstubAllGlobals();
  });

  it("saves a template from the CURRENT editor state, unsaved edits included", async () => {
    const fetchMock = okFetch({ templateId: "t-2" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = mount();

    act(() => result.current.toggleField("weight"));
    await act(async () => {
      await result.current.saveAsTemplate("Minimal");
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/check-ins/forms");
    expect(JSON.parse(init.body)).toEqual({
      name: "Minimal",
      fields: ["notes", "prs"],
      questions: [
        { questionId: "q-1", enabled: true },
        { questionId: "q-2", enabled: false },
      ],
    });
    expect(mockInvalidateTemplates).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("surfaces a failed BANK read on its own, without blocking the editor", () => {
    // It used to be destructured away entirely, and `isBankLoading` held the
    // whole sheet's spinner with no error path out of it.
    mockUseCheckInQuestions.mockReturnValue({
      questions: [],
      isLoading: false,
      isError: true,
    });
    const { result } = mount();
    expect(result.current.isBankError).toBe(true);
    expect(result.current.fields).toEqual(["notes", "weight", "prs"]);
  });
});
