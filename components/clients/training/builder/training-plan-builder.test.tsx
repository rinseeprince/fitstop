import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Client } from "@/types/check-in";

// The apply surface has ONE owner, the address: the tray is `?apply=1` and the
// client editor `?editor=<savedPlanId>` (CONVENTIONS §7 → "No frame
// disagrees"). The router and the count are mocked and the address driven, so
// the contract at the host is what a coach would see: "Apply program" pushes
// the tray, a pick replaces the tray's entry with the editor's, the arrow
// replaces back to the list, the X pops the tray's entry, Back out of the
// editor lands on the calendar, an apply completes the editor's entry, and a
// pasted address falls back to a replace.
const { push, replace, back, search, coachHistory } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  search: { current: new URLSearchParams("tab=training&training=plans") },
  coachHistory: { current: false },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back }),
  useSearchParams: () => search.current,
}));
vi.mock("@/lib/coach-history", () => ({
  hasCoachHistory: () => coachHistory.current,
}));
// The provider fetches the client's plan; the siblings under it have their own
// tests. The overlay stub exposes exactly the contract the builder hands it.
vi.mock("@/contexts/training-builder-context", () => ({
  TrainingBuilderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./training-builder-right-panel", () => ({
  TrainingBuilderRightPanel: ({ onOpenGenerator }: { onOpenGenerator?: () => void }) => (
    <button type="button" onClick={onOpenGenerator}>
      Apply program
    </button>
  ),
}));
vi.mock("../training-history-table", () => ({ TrainingHistoryTable: () => null }));
vi.mock("./training-plan-builder-overlay", () => ({
  TrainingPlanBuilderOverlay: (props: {
    trayOpen: boolean;
    editorPlanId: string | null;
    preselectedBlockId?: string | null;
    onPick: (savedPlanId: string) => void;
    onExitEditor: () => void;
    onApplied?: () => void;
    onCloseTray: () => void;
  }) => (
    <div
      data-testid="overlay"
      data-tray={String(props.trayOpen)}
      data-editor={props.editorPlanId ?? ""}
      data-block={props.preselectedBlockId ?? ""}
    >
      <button type="button" onClick={() => props.onPick("plan-1")}>
        pick
      </button>
      <button type="button" onClick={props.onExitEditor}>
        exit
      </button>
      <button type="button" onClick={() => props.onApplied?.()}>
        applied
      </button>
      <button type="button" onClick={props.onCloseTray}>
        close
      </button>
    </div>
  ),
}));

import { TrainingPlanBuilder } from "./training-plan-builder";

const client = { id: "c-1", name: "Sam Doe" } as Client;
const overlay = () => screen.getByTestId("overlay");
const at = (query: string) => {
  search.current = new URLSearchParams(query);
};

beforeEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  back.mockClear();
  at("tab=training&training=plans");
  coachHistory.current = false;
});

describe("TrainingPlanBuilder — the tray and the editor are places", () => {
  it("resolves the tray and the editor from the address on the first render", () => {
    at("tab=training&training=plans&apply=1");
    const { rerender } = render(<TrainingPlanBuilder client={client} />);
    expect(overlay()).toHaveAttribute("data-tray", "true");
    expect(overlay()).toHaveAttribute("data-editor", "");

    at("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} />);
    expect(overlay()).toHaveAttribute("data-tray", "false");
    expect(overlay()).toHaveAttribute("data-editor", "plan-1");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("Apply program PUSHES the tray's address, keeping the scroll position, and nothing else", () => {
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply program" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&apply=1", {
      scroll: false,
    });
    expect(replace).not.toHaveBeenCalled();
    // The tray follows the address, not the click.
    expect(overlay()).toHaveAttribute("data-tray", "false");
  });

  it("a pick REPLACES the tray's entry with the editor's: apply out, editor in", () => {
    at("tab=training&training=plans&apply=1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "pick" }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans&editor=plan-1", {
      scroll: false,
    });
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("browser Back out of the editor lands on the calendar: no tray, no editor", () => {
    at("tab=training&training=plans&editor=plan-1");
    const { rerender } = render(<TrainingPlanBuilder client={client} />);
    expect(overlay()).toHaveAttribute("data-editor", "plan-1");

    // The pop: the address is the entry before the tray's push.
    at("tab=training&training=plans");
    rerender(<TrainingPlanBuilder client={client} />);

    expect(overlay()).toHaveAttribute("data-editor", "");
    expect(overlay()).toHaveAttribute("data-tray", "false");
  });

  it("the editor's arrow REPLACES the editor's entry with the tray's, never a pop", () => {
    coachHistory.current = true;
    at("tab=training&training=plans&editor=plan-1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "exit" }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans&apply=1", {
      scroll: false,
    });
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("the tray's X pops its entry when a coach page precedes it", () => {
    coachHistory.current = true;
    at("tab=training&training=plans&apply=1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("the tray's X on a pasted address replaces the tray away", () => {
    at("tab=training&training=plans&apply=1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans", { scroll: false });
  });

  it("an apply without a trip pops the editor's entry onto the calendar", () => {
    coachHistory.current = true;
    at("tab=training&training=plans&editor=plan-1");
    const onTabChange = vi.fn();
    render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("an apply on a pasted editor address replaces the editor away", () => {
    at("tab=training&training=plans&editor=plan-1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans", { scroll: false });
  });
});

describe("TrainingPlanBuilder — the Journey round trip", () => {
  const TRIP = "tab=training&training=plans&apply=1&returnTo=journey&returnBlock=blk-7";

  it("arrives with the tray open, captures the block, and strips ONLY the return params", () => {
    at(TRIP);
    render(<TrainingPlanBuilder client={client} />);

    expect(overlay()).toHaveAttribute("data-tray", "true");
    expect(overlay()).toHaveAttribute("data-block", "blk-7");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans&apply=1", {
      scroll: false,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("the block survives the pick and the arrow, and an apply completes the editor's entry as the Journey entry", () => {
    at(TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    at("tab=training&training=plans&apply=1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    at("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "exit" }));
    at("tab=training&training=plans&apply=1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    at("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(onTabChange).toHaveBeenCalledWith(
      "metrics",
      { journey: "blocks", block: "blk-7" },
      { replace: true }
    );
    expect(back).not.toHaveBeenCalled();
  });

  it("the X abandons the trip: a later apply pops onto the calendar", () => {
    coachHistory.current = true;
    at(TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    at("tab=training&training=plans&apply=1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(overlay()).toHaveAttribute("data-block", "");

    // Forward re-enters the tray as a place; the flow is fresh.
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    at("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(onTabChange).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("a hand open starts a fresh flow: nothing rides on from a trip left by browser Back", () => {
    at(TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    // Back out of the editor left the trip captured and the surface closed.
    at("tab=training&training=plans");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "Apply program" }));
    expect(overlay()).toHaveAttribute("data-block", "");
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&apply=1", {
      scroll: false,
    });
  });
});
