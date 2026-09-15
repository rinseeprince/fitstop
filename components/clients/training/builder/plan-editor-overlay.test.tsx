import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlanEditorOverlay } from "./plan-editor-overlay";

// The plan editor's mount. A save rewrites the calendar, so the overlay
// refetches the training area BEFORE it hands the host the close: the first
// frame after the editor goes is the saved plan. The provider stub exposes the
// save callback and the plan it was handed; the builder stub, its arrow.

const order: string[] = [];
let finishTrainingRefetch: () => void = () => {};
const invalidateTrainingData = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      finishTrainingRefetch = () => {
        order.push("training refetched");
        resolve();
      };
    }),
);
const invalidateNutritionCalendar = vi.fn();
const clearClientOverview = vi.fn();
const clearAttentionFeed = vi.fn();
const clearBlockFacts = vi.fn();
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => invalidateTrainingData,
}));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => invalidateNutritionCalendar,
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => clearClientOverview,
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => clearAttentionFeed,
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClearBlockFacts: () => clearBlockFacts,
}));
vi.mock("@/components/clients/training/program-builder/program-draft-provider", () => ({
  ProgramDraftProvider: ({
    children,
    placedPlanId,
    onSaved,
  }: {
    children: ReactNode;
    placedPlanId?: string;
    onSaved?: () => Promise<void> | void;
  }) => (
    <div data-testid="provider" data-plan={placedPlanId}>
      <button type="button" onClick={() => void onSaved?.()}>
        provider saved
      </button>
      {children}
    </div>
  ),
}));
vi.mock("@/components/clients/training/program-builder/program-builder", () => ({
  ProgramBuilder: ({ onExit }: { onExit?: () => void }) => (
    <button type="button" onClick={() => onExit?.()}>
      builder arrow
    </button>
  ),
}));
vi.mock("./client-draft-leave-guard", () => ({ ClientDraftLeaveGuard: () => null }));

function renderOverlay(planId: string | null) {
  const onExit = vi.fn();
  const onSaved = vi.fn(() => order.push("host closes"));
  render(
    <PlanEditorOverlay clientId="client-1" planId={planId} onExit={onExit} onSaved={onSaved} />,
  );
  return { onExit, onSaved };
}

describe("PlanEditorOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("opens on the plan its address names, and on nothing without one", () => {
    renderOverlay("plan-7");
    expect(screen.getByTestId("provider")).toHaveAttribute("data-plan", "plan-7");
    cleanup();

    renderOverlay(null);
    expect(screen.queryByTestId("provider")).toBeNull();
  });

  it("closes only once the training area has the saved plan, clearing what reads it", async () => {
    const { onSaved } = renderOverlay("plan-7");

    fireEvent.click(screen.getByRole("button", { name: "provider saved" }));

    expect(invalidateTrainingData).toHaveBeenCalledWith("client-1");
    expect(invalidateNutritionCalendar).toHaveBeenCalledWith("client-1");
    expect(clearClientOverview).toHaveBeenCalledWith("client-1");
    expect(clearAttentionFeed).toHaveBeenCalledTimes(1);
    expect(clearBlockFacts).toHaveBeenCalledWith("client-1");
    // Still refetching: the host has not been told to close.
    expect(onSaved).not.toHaveBeenCalled();

    finishTrainingRefetch();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["training refetched", "host closes"]);
  });

  it("hands the builder's arrow to the host", () => {
    const { onExit } = renderOverlay("plan-7");
    fireEvent.click(screen.getByRole("button", { name: "builder arrow" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
