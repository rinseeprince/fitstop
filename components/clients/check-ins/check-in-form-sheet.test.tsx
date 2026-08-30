import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockEditor } = vi.hoisted(() => ({ mockEditor: vi.fn() }));
vi.mock("./use-check-in-form-editor", () => ({
  useCheckInFormEditor: (args: unknown) => mockEditor(args),
}));

import { CheckInFormSheet } from "./check-in-form-sheet";
import { CHECK_IN_FORM_FIELDS } from "@/lib/check-in/form-fields";
import type { Client } from "@/types/check-in";

const client = { id: "client-1", name: "Jane Doe", email: "j@d.com" } as Client;

function setEditor(overrides: Record<string, unknown> = {}) {
  const editor = {
    isLoading: false,
    isError: false,
    fields: ["notes", "weight"],
    questions: [{ id: "q-1", prompt: "How did the split feel?", enabled: true }],
    bank: [{ id: "q-3", prompt: "Anything hurting?", createdAt: "" }],
    templates: [],
    appliedTemplateId: null,
    isDirty: false,
    isSaving: false,
    toggleField: vi.fn(),
    toggleQuestion: vi.fn(),
    moveQuestion: vi.fn(),
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
    setEditor();
  });

  it("renders every built-in field as its own On/Off row", () => {
    renderSheet();

    for (const field of CHECK_IN_FORM_FIELDS) {
      const row = screen.getByRole("group", { name: field.label });
      expect(within(row).getByRole("button", { name: "On" })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Off" })).toBeInTheDocument();
    }
    expect(screen.getByText("2/14 on")).toBeInTheDocument();
  });

  it("toggling a row asks the editor for that field key, not its label", async () => {
    const user = userEvent.setup();
    const editor = setEditor();
    renderSheet();

    const row = screen.getByRole("group", { name: "Body fat" });
    await user.click(within(row).getByRole("button", { name: "On" }));

    expect(editor.toggleField).toHaveBeenCalledWith("body_fat");
  });

  it("renders the coach's questions and their controls", () => {
    renderSheet();
    expect(screen.getByText("How did the split feel?")).toBeInTheDocument();
    expect(screen.getByText("1 question")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove "How did the split feel\?"/ })
    ).toBeInTheDocument();
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

  it("shows the error state instead of an empty editor when the read fails", () => {
    setEditor({ isError: true });
    renderSheet();
    expect(screen.getByText(/Failed to load the check-in form/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Weight" })).not.toBeInTheDocument();
  });

  it("cannot be closed while a save is in flight", async () => {
    const user = userEvent.setup();
    setEditor({ isSaving: true });
    const onOpenChange = renderSheet();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
