import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SavedPlan } from "@/types/training";
import { TrainingPlanBuilderOverlay } from "./training-plan-builder-overlay";

// The tray's template list and its delete confirm. jsdom never paints and
// Radix Presence unmounts at once there, so the confirm's exit frame is not
// observable. The shape that keeps it right is: `open` apart from the
// subject, a close that leaves the subject, and a next show that replaces it
// (CONVENTIONS §7 → "No frame disagrees", rule 5). The stub exposes exactly
// those props; its action mirrors AlertDialogAction, which runs onConfirm and
// then closes.

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ({
    clientId: "client-1",
    clientTimezone: "UTC",
    fetchPlan: vi.fn(),
  }),
}));
// The editor branch is not under test here.
vi.mock("@/components/clients/training/program-builder/program-draft-provider", () => ({
  ProgramDraftProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/clients/training/program-builder/program-builder", () => ({
  ProgramBuilder: () => null,
}));
vi.mock("./client-draft-leave-guard", () => ({ ClientDraftLeaveGuard: () => null }));

const plansMutate = vi.fn();
const plans = [
  { id: "plan-a", name: "Template A", splitType: null, sessions: [], programDurationWeeks: null },
  { id: "plan-b", name: "Template B", splitType: null, sessions: [], programDurationWeeks: null },
] as unknown as SavedPlan[];
vi.mock("@/hooks/use-saved-plans", () => ({
  useSavedPlans: () => ({ plans, isLoading: false, error: undefined, mutate: plansMutate }),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    title,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }): ReactNode => (
    <div
      data-testid="confirm"
      data-open={String(open)}
      data-title={title}
      data-confirm-label={confirmLabel ?? ""}
    >
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

function renderTray() {
  return render(
    <TrainingPlanBuilderOverlay
      trayOpen
      editorPlanId={null}
      onCloseTray={vi.fn()}
      onPick={vi.fn()}
      onExitEditor={vi.fn()}
    />,
  );
}

describe("the tray's template delete", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps naming its template through the close, and the next show replaces it", () => {
    renderTray();

    fireEvent.click(screen.getByLabelText("Delete Template A"));
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm()).toHaveAttribute("data-title", 'Delete "Template A"?');

    fireEvent.click(screen.getByText("Cancel confirm"));
    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm()).toHaveAttribute("data-title", 'Delete "Template A"?');

    fireEvent.click(screen.getByLabelText("Delete Template B"));
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm()).toHaveAttribute("data-title", 'Delete "Template B"?');
  });

  it("confirming deletes the subject behind a closed card whose title and label hold", async () => {
    renderTray();

    fireEvent.click(screen.getByLabelText("Delete Template B"));
    fireEvent.click(screen.getByText("Confirm"));

    // The action closes the confirm on click: the delete runs behind the
    // closing card, which keeps its title and its one label.
    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm()).toHaveAttribute("data-title", 'Delete "Template B"?');
    expect(confirm()).toHaveAttribute("data-confirm-label", "Delete");
    expect(fetchMock).toHaveBeenCalledWith("/api/training/saved-plans/plan-b", {
      method: "DELETE",
    });

    await waitFor(() => expect(plansMutate).toHaveBeenCalledTimes(1));
    expect(confirm()).toHaveAttribute("data-title", 'Delete "Template B"?');
    expect(confirm()).toHaveAttribute("data-confirm-label", "Delete");
  });
});
