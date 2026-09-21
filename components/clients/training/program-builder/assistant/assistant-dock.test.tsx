import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SessionDraft } from "../program-builder-types";

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
// The session sheet's body: the picker fetches the catalog on mount, and
// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
vi.mock("../exercise-picker", () => ({
  ExercisePicker: () => <div data-testid="exercise-picker" />,
}));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

import { AssistantDock } from "./assistant-dock";
import { AssistantProvider } from "./assistant-provider";
import { AssistantMessages } from "./assistant-messages";
import { SessionEditorSheet } from "../session-editor-sheet";

// The corner host alone, under the state's owner, with no session open.
function Dock() {
  return (
    <AssistantProvider>
      <AssistantDock sheetOpen={false} />
    </AssistantProvider>
  );
}

const openPanel = () =>
  fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));

describe("AssistantDock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.mode = "edit";
    mockChat.busy = false;
    mockChat.pending = null;
  });

  it("renders a collapsed launcher and expands into the panel", () => {
    render(<Dock />);
    openPanel();
    expect(screen.getByText("Program assistant")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe the change/i)).toBeInTheDocument();
  });

  it("gates input behind edit mode with a switch affordance", () => {
    mockContext.mode = "view";
    render(<Dock />);
    openPanel();
    expect(screen.queryByPlaceholderText(/describe the change/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /switch to edit/i }));
    expect(mockSetMode).toHaveBeenCalledWith("edit");
  });

  it("sends on Enter and clears the input; Escape collapses without sending", () => {
    render(<Dock />);
    openPanel();
    const input = screen.getByPlaceholderText(/describe the change/i);

    fireEvent.change(input, { target: { value: "add a leg day" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockChat.send).toHaveBeenCalledWith("add a leg day");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Program assistant")).not.toBeInTheDocument();
    expect(mockChat.send).toHaveBeenCalledTimes(1);
  });

  it("Escape anywhere in the panel collapses it, and the chevron does too", () => {
    render(<Dock />);
    openPanel();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Program assistant" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Collapse assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the program assistant/i })).toBeInTheDocument();
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
    render(<Dock />);
    openPanel();

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
      const { unmount } = render(<Dock />);
      openPanel();
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
    render(<Dock />);
    openPanel();
    expect(
      screen.queryByRole("button", { name: "Add 2 more weeks" }),
    ).not.toBeInTheDocument();
    mockChat.messages = [];
  });
});

// The session sheet is a MODAL Radix layer: it writes pointer-events none onto
// the body and auto onto its own content, traps focus inside that content,
// aria-hides everything outside it and locks scrolling outside it. The panel
// must be usable over it whichever opened first, so while the sheet is open
// the sheet hosts the panel inside its content and the corner renders nothing.
// This is ProgramBuilder's wiring: one provider above both hosts, both reading
// the sheet's open flag.
describe("the panel inside the session sheet", () => {
  const session: SessionDraft = {
    uid: "sess-1",
    name: "Push Day",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
  };
  const noop = () => undefined;
  const sheetProps = {
    session,
    mode: "edit" as const,
    defaultSurplusPercentage: null,
    onUpdateSession: noop,
    onAddExercise: noop,
    onRemoveExercise: noop,
    onEditExercise: noop,
    onLinkExercises: noop,
    onUnlinkGroup: noop,
    onMoveExercise: noop,
    onMoveGroup: noop,
    onUpdateGroup: noop,
    onSpecEdit: noop,
    onSaveAsWorkout: noop,
    isSavingWorkout: false,
  };

  function Builder({ sessionOpen = false }: { sessionOpen?: boolean }) {
    const [sheetOpen, setSheetOpen] = useState(sessionOpen);
    return (
      <AssistantProvider>
        <button type="button" onClick={() => setSheetOpen(true)}>
          Open session
        </button>
        <SessionEditorSheet
          {...sheetProps}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
        <AssistantDock sheetOpen={sheetOpen} />
      </AssistantProvider>
    );
  }

  // Without `hidden: true`: an aria-hidden panel is not found.
  const panel = () => screen.getByRole("dialog", { name: "Program assistant" });
  const sheet = () => screen.getByRole("dialog", { name: "Push Day" });
  const launcher = () => screen.queryByRole("button", { name: /open the program assistant/i });
  // What pointer-events resolves to: Radix writes it inline on the body and on
  // each layer's content, and everything else inherits its nearest ancestor's.
  const pointerEvents = (element: HTMLElement): string => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.style.pointerEvents) return node.style.pointerEvents;
    }
    return "auto";
  };
  const proveHosted = () => {
    expect(document.body.style.pointerEvents).toBe("none");
    const hosted = panel();
    expect(sheet().contains(hosted)).toBe(true);
    expect(pointerEvents(hosted)).toBe("auto");
    // One panel on the page — none left in the corner under the sheet.
    expect(
      screen.getAllByRole("dialog", { name: "Program assistant", hidden: true }),
    ).toHaveLength(1);
    expect(launcher()).toBeNull();
  };

  // jsdom computes no animation, so Radix unmounts a closing sheet at once.
  // Naming the content's exit animation holds the closing frame on the page to
  // be read (the delete-plan dialog's recipe). The content has no entrance of
  // its own while open and slides out on close, as in a browser.
  function holdExitAnimation() {
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const styles = computed(element, pseudo);
      if (element instanceof HTMLElement && element.dataset.slot === "sheet-content") {
        Object.defineProperty(styles, "animationName", {
          get: () => (element.dataset.state === "closed" ? "exit" : "none"),
        });
      }
      return styles;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.mode = "edit";
    mockChat.busy = false;
    mockChat.pending = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is hosted by the sheet, with pointer events and not aria-hidden, when the sheet opens over an already open panel", () => {
    render(<Builder />);
    openPanel();
    expect(panel()).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open session"));
    proveHosted();
  });

  it("is hosted by the sheet, with pointer events and not aria-hidden, when opened from the sheet's footer", () => {
    render(<Builder sessionOpen />);
    expect(launcher()).toBeNull();

    fireEvent.click(within(sheet()).getByRole("button", { name: "Assistant" }));
    proveHosted();
  });

  it("Escape inside the panel collapses it and the sheet stays; Escape anywhere else in the sheet closes the sheet", () => {
    render(<Builder sessionOpen />);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Assistant" }));

    fireEvent.keyDown(screen.getByPlaceholderText(/describe the change/i), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Program assistant" })).toBeNull();
    expect(sheet()).toBeInTheDocument();

    fireEvent.keyDown(within(sheet()).getByRole("button", { name: "Done" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Push Day" })).toBeNull();
    expect(launcher()).toBeInTheDocument();
  });

  // The content is the modal's scope and the panel's anchor, so it must not
  // move while the sheet arrives: it carries no entrance of its own, and the
  // body inside it is what slides. The panel hangs off the frame, never the
  // body, so it holds its corner while the sheet slides in beneath it.
  it("anchors the panel to a still frame: the content has no entrance of its own, the body inside it slides", () => {
    render(<Builder sessionOpen />);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Assistant" }));

    const frame = sheet();
    expect(frame.style.animation).toBe("none");
    const body = frame.firstElementChild as HTMLElement;
    expect(body.className).toMatch(/\banimate-in\b/);
    expect(body.className).toMatch(/\bslide-in-from-right\b/);
    expect(body).toHaveTextContent("Push Day");
    expect(body.contains(panel())).toBe(false);
    expect(panel().parentElement).toBe(frame);
  });

  it("a closing sheet keeps its session but holds no panel: the corner has it in the same frame", () => {
    holdExitAnimation();
    render(<Builder sessionOpen />);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Assistant" }));

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));

    const closing = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"][data-state="closed"]',
    );
    expect(closing).not.toBeNull();
    expect(closing).toHaveTextContent("Push Day");
    // No exit animation on the frame's own inline style: the slide-out is the class's.
    expect(closing!.style.animation).toBe("");
    expect(closing!.querySelector('[role="dialog"]')).toBeNull();
    // The closing sheet is still a modal layer, so the corner's copy is
    // aria-hidden until it unmounts.
    const corner = screen.getByRole("dialog", { name: "Program assistant", hidden: true });
    expect(closing!.contains(corner)).toBe(false);
    expect(
      screen.getAllByRole("dialog", { name: "Program assistant", hidden: true }),
    ).toHaveLength(1);
  });

  it("the open panel and the command being typed survive a session opening and closing", () => {
    render(<Builder />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/describe the change/i), {
      target: { value: "add a leg d" },
    });

    fireEvent.click(screen.getByText("Open session"));
    expect(within(sheet()).getByPlaceholderText(/describe the change/i)).toHaveValue("add a leg d");

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Push Day" })).toBeNull();
    expect(panel()).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe the change/i)).toHaveValue("add a leg d");
  });
});
