import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { SavedSession } from "@/types/training";
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
  { id: "sess-1", name: "Push Day A", focus: null, groups: [], estimatedDurationMinutes: null },
  { id: "sess-2", name: "Pull Day A", focus: null, groups: [], estimatedDurationMinutes: null },
] as unknown as SavedSession[];
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions,
    isLoading: false,
    error: null,
    mutate: sessionMutate,
  }),
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

const confirm = () => screen.getByTestId("confirm");

const onNewSession = vi.fn();
const onEditSession = vi.fn();

function renderList() {
  return render(
    <DndContext>
      <LibrarySessionList
        editable
        onNewSession={onNewSession}
        onEditSession={onEditSession}
      />
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

  // The sheet is the builder's (program-builder.tsx), which keeps its subject
  // through the close and steps the corner assistant aside while it is up.
  it("New session and Edit hand the session editor to the builder", () => {
    renderList();
    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    expect(onEditSession).toHaveBeenCalledTimes(1);
    expect(onEditSession.mock.calls[0][0]).toMatchObject({ id: "sess-1" });

    fireEvent.click(screen.getByRole("button", { name: /New session/ }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
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
