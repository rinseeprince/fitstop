import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { SavedSession } from "@/types/training";
import type { SessionEditorState } from "@/components/programs/use-standalone-session-editor";
import { LibrarySessionList } from "./library-session-list";

// jsdom never paints and Radix Presence unmounts at once there, so the exit
// frame is not observable. What IS observable is the shape that keeps it
// right: each surface gets `open` apart from its subject, a close flips `open`
// and leaves the subject, and the next show replaces it (CONVENTIONS §7 →
// "No frame disagrees", rule 5). The surfaces are stubbed to expose exactly
// those props.

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const sessionMutate = vi.fn();
const sessions = [
  { id: "sess-1", name: "Push Day A", focus: null, exercises: [], estimatedDurationMinutes: null },
  { id: "sess-2", name: "Pull Day A", focus: null, exercises: [], estimatedDurationMinutes: null },
] as unknown as SavedSession[];
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions,
    isLoading: false,
    error: null,
    mutate: sessionMutate,
  }),
}));

vi.mock("@/components/programs/standalone-session-editor", () => ({
  StandaloneSessionEditor: ({
    open,
    state,
    onClose,
  }: {
    open: boolean;
    state: SessionEditorState | null;
    onClose: () => void;
  }): ReactNode => (
    <div
      data-testid="session-editor"
      data-open={String(open)}
      data-subject={
        state == null ? "" : state.mode === "edit" ? `edit:${state.session.id}` : "create"
      }
    >
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));

// The action mirrors AlertDialogAction: it runs onConfirm, then Radix closes.
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    description,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    description: string;
    onConfirm: () => void;
  }): ReactNode => (
    <div data-testid="confirm" data-open={String(open)} data-description={description}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Cancel confirm
      </button>
      <button
        type="button"
        onClick={() => {
          onConfirm();
          onOpenChange(false);
        }}
      >
        Confirm
      </button>
    </div>
  ),
}));

const editor = () => screen.getByTestId("session-editor");
const confirm = () => screen.getByTestId("confirm");

function renderList() {
  return render(
    <DndContext>
      <LibrarySessionList editable />
    </DndContext>,
  );
}

describe("LibrarySessionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => ({}) }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the editor keeps its session through the close, and the next show replaces it", () => {
    renderList();
    expect(editor()).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-subject", "edit:sess-1");

    fireEvent.click(screen.getByText("Close editor"));
    expect(editor()).toHaveAttribute("data-open", "false");
    expect(editor()).toHaveAttribute("data-subject", "edit:sess-1");

    fireEvent.click(screen.getByRole("button", { name: /New session/ }));
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-subject", "create");
  });

  it("the delete confirm keeps naming its session through the close, and the next show replaces it", () => {
    renderList();

    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm().getAttribute("data-description")).toContain('"Push Day A"');

    fireEvent.click(screen.getByText("Cancel confirm"));
    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm().getAttribute("data-description")).toContain('"Push Day A"');

    fireEvent.click(screen.getAllByLabelText("Delete")[1]);
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm().getAttribute("data-description")).toContain('"Pull Day A"');
  });

  it("confirming deletes the subject and the closing card still names it", async () => {
    renderList();

    fireEvent.click(screen.getAllByLabelText("Delete")[1]);
    fireEvent.click(screen.getByText("Confirm"));

    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm().getAttribute("data-description")).toContain('"Pull Day A"');
    expect(fetch).toHaveBeenCalledWith("/api/training/saved-sessions/sess-2", {
      method: "DELETE",
    });
    await waitFor(() => expect(sessionMutate).toHaveBeenCalledTimes(1));
  });
});
