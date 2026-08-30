import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockEditor, mockForm } = vi.hoisted(() => ({
  mockEditor: vi.fn(),
  mockForm: vi.fn(),
}));
vi.mock("./use-check-in-form-editor", () => ({
  useCheckInFormEditor: (args: unknown) => mockEditor(args),
}));
// The panel owns the ONE read that gates the editor; the editor's own two are
// inside the mocked hook. Loading and error live in check-in-form-panel.test.tsx,
// which runs the real thing.
vi.mock("@/hooks/use-check-in-form-config", () => ({
  useClientCheckInForm: () => mockForm(),
}));

import { CheckInFormSheet } from "./check-in-form-sheet";
import { CHECK_IN_FORM_FIELDS } from "@/lib/check-in/form-fields";
import type { Client } from "@/types/check-in";

const client = { id: "client-1", name: "Jane Doe", email: "j@d.com" } as Client;

function setEditor(overrides: Record<string, unknown> = {}) {
  const editor = {
    fields: ["notes", "weight"],
    questions: [{ id: "q-1", prompt: "How did the split feel?", enabled: true }],
    bank: [{ id: "q-3", prompt: "Anything hurting?", createdAt: "" }],
    templates: [],
    isBankError: false,
    isTemplatesError: false,
    appliedTemplateId: null,
    isDirty: false,
    isSaving: false,
    toggleField: vi.fn(),
    toggleQuestion: vi.fn(),
    reorderQuestion: vi.fn(),
    removeQuestion: vi.fn(),
    addExistingQuestion: vi.fn(),
    createQuestion: vi.fn(),
    renameQuestion: vi.fn(),
    applyTemplate: vi.fn(),
    save: vi.fn(),
    saveAsTemplate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  mockEditor.mockReturnValue(editor);
  return editor;
}

function renderSheet(onOpenChange = vi.fn()) {
  render(<CheckInFormSheet client={client} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe("CheckInFormSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockForm.mockReturnValue({
      form: { fields: ["notes", "weight"], questions: [] },
      isLoading: false,
      isError: false,
    });
    setEditor();
  });

  it("renders every built-in field as its own switch, checked per the form", () => {
    renderSheet();

    for (const field of CHECK_IN_FORM_FIELDS) {
      expect(screen.getByRole("switch", { name: field.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Weight" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Body fat" })).not.toBeChecked();
    expect(screen.getByText("2/14 on")).toBeInTheDocument();
  });

  it("toggling a row asks the editor for that field key, not its label", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    renderSheet();

    await user.click(screen.getByRole("switch", { name: "Body fat" }));

    expect(editor.toggleField).toHaveBeenCalledWith("body_fat");
  });

  it("renders the coach's questions with a drag grip and no up/down arrows", () => {
    renderSheet();
    expect(screen.getByText("How did the split feel?")).toBeInTheDocument();
    expect(screen.getByText("1 question")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reorder "How did the split feel\?"/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove "How did the split feel\?"/ })
    ).toBeInTheDocument();
    // The arrows were replaced by the grip — dnd-kit's pointer drag can't be
    // driven in jsdom, so the reorder KERNEL is pinned in the editor hook's
    // test and this only asserts the affordance swapped.
    expect(screen.queryByRole("button", { name: /Move .* up/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move .* down/ })).not.toBeInTheDocument();
  });

  it("puts the question's switch last, so it lines up with the fields above", () => {
    renderSheet();
    const row = screen.getByRole("switch", { name: "How did the split feel?" })
      .parentElement as HTMLElement;
    const controls = Array.from(row.children);
    // …[prompt] [reword] [remove] [switch]
    expect(controls[controls.length - 1]).toHaveAttribute("role", "switch");
  });

  it("removes a question from the form", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    renderSheet();

    await user.click(
      screen.getByRole("button", { name: /Remove "How did the split feel\?"/ })
    );
    expect(editor.removeQuestion).toHaveBeenCalledWith("q-1");
  });

  it("rewording a question commits through the editor, which owns the local row", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    renderSheet();

    await user.click(
      screen.getByRole("button", { name: /Reword "How did the split feel\?"/ })
    );
    const input = screen.getByRole("textbox", {
      name: /Reword "How did the split feel\?"/,
    });
    await user.clear(input);
    await user.type(input, "How is the new split?");
    await user.click(screen.getByRole("button", { name: "Save wording" }));

    expect(editor.renameQuestion).toHaveBeenCalledWith("q-1", "How is the new split?");
  });

  it("Save changes commits, Cancel closes without saving", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    const onOpenChange = renderSheet();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(editor.save).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Save as template names it first, then saves the state on screen", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    renderSheet();

    await user.click(screen.getByRole("button", { name: /Save as template/ }));
    await user.type(screen.getByLabelText("Template name"), "Fat loss");
    await user.click(screen.getByRole("button", { name: "Save template" }));

    expect(editor.saveAsTemplate).toHaveBeenCalledWith("Fat loss");
  });

  it("offers no template picker until the coach has saved one", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /Choose a template/ })).toBeDisabled();
  });

  it("tells the coach what an all-off form still asks", () => {
    setEditor({ fields: [] });
    renderSheet();
    expect(screen.getByText(/still gets a two-step check-in/)).toBeInTheDocument();
  });

  it("disables the commits while a save is in flight, and keeps an exit", () => {
    setEditor({ isSaving: true });
    renderSheet();

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // The X stays live deliberately: it is the only exit from a slow load, and
    // Escape and the overlay can close the sheet regardless.
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });
});
