import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mockSetMode = vi.fn();
const mockChat = {
  messages: [] as Array<{ id: string; role: "user" | "assistant"; text: string }>,
  pending: null as null | {
    ops: never[];
    reason: "destructive";
    labels: string[];
    assistantText: string;
  },
  send: vi.fn(),
  applyPending: vi.fn(),
  dismissPending: vi.fn(),
  undo: vi.fn(),
  canUndo: false,
  busy: false,
};
const mockContext = {
  mode: "edit" as "view" | "edit",
  setMode: mockSetMode,
  isSaving: false,
};

vi.mock("../program-draft-provider", () => ({
  useProgramDraft: () => mockContext,
}));
vi.mock("./use-assistant-chat", () => ({
  useAssistantChat: () => mockChat,
}));

import { AssistantDock } from "./assistant-dock";
import { AssistantMessages } from "./assistant-messages";

describe("AssistantDock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.mode = "edit";
    mockChat.busy = false;
    mockChat.pending = null;
  });

  it("renders a collapsed launcher and expands into the panel", () => {
    render(<AssistantDock />);
    const launcher = screen.getByRole("button", { name: /open the program assistant/i });
    fireEvent.click(launcher);
    expect(screen.getByText("Program assistant")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe the change/i)).toBeInTheDocument();
  });

  it("gates input behind edit mode with a switch affordance", () => {
    mockContext.mode = "view";
    render(<AssistantDock />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    expect(screen.queryByPlaceholderText(/describe the change/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /switch to edit/i }));
    expect(mockSetMode).toHaveBeenCalledWith("edit");
  });

  it("sends on Enter and clears the input; Escape collapses without sending", () => {
    render(<AssistantDock />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    const input = screen.getByPlaceholderText(/describe the change/i);

    fireEvent.change(input, { target: { value: "add a leg day" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockChat.send).toHaveBeenCalledWith("add a leg day");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Program assistant")).not.toBeInTheDocument();
  });
});

describe("AssistantMessages", () => {
  it("renders the preview gate with Apply all / Dismiss for destructive turns", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AssistantMessages
        messages={[{ id: "1", role: "assistant", text: "Review these" }]}
        pending={{
          ops: [],
          reason: "destructive",
          labels: ["Delete week 3", "Clear W1 D2"],
          assistantText: "Review these",
        }}
        busy={false}
        onApplyPending={onApply}
        onDismissPending={onDismiss}
      />,
    );
    expect(screen.getByText(/includes destructive edits/i)).toBeInTheDocument();
    expect(screen.getByText(/Delete week 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /apply all/i }));
    expect(onApply).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("surfaces applied counts and skip reasons on assistant messages", () => {
    render(
      <AssistantMessages
        messages={[
          {
            id: "1",
            role: "assistant",
            text: "Done",
            applied: 3,
            skipped: ["That week no longer exists"],
          },
        ]}
        pending={null}
        busy={false}
        onApplyPending={() => undefined}
        onDismissPending={() => undefined}
      />,
    );
    expect(screen.getByText(/3 edits applied/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });
});

describe("suggestion chips", () => {
  beforeEach(() => {
    // Own reset: the mocks are module-scoped, so without this the send()
    // assertion below sees the call made by the Enter-key test above.
    vi.clearAllMocks();
    mockContext.mode = "edit";
    mockChat.messages = [];
  });

  it("sends immediately when a starter is picked", () => {
    render(<AssistantDock />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));

    fireEvent.click(screen.getByRole("button", { name: "Add 2 more weeks" }));

    expect(mockChat.send).toHaveBeenCalledWith("Add 2 more weeks");
  });

  it("hides the starters when a send would be a no-op (view mode, busy, saving)", () => {
    for (const state of [
      { mode: "view" as const, busy: false, isSaving: false },
      { mode: "edit" as const, busy: true, isSaving: false },
      { mode: "edit" as const, busy: false, isSaving: true },
    ]) {
      mockContext.mode = state.mode;
      mockContext.isSaving = state.isSaving;
      mockChat.busy = state.busy;
      const { unmount } = render(<AssistantDock />);
      fireEvent.click(
        screen.getByRole("button", { name: /open the program assistant/i }),
      );
      expect(
        screen.queryByRole("button", { name: "Add 2 more weeks" }),
      ).not.toBeInTheDocument();
      unmount();
    }
    mockContext.isSaving = false;
    mockChat.busy = false;
  });

  it("hides the starters once a conversation exists", () => {
    mockContext.mode = "edit";
    mockChat.messages = [{ id: "1", role: "user", text: "hi" }];
    render(<AssistantDock />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    expect(
      screen.queryByRole("button", { name: "Add 2 more weeks" }),
    ).not.toBeInTheDocument();
    mockChat.messages = [];
  });
});
