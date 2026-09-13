import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Client } from "@/types/check-in";

// The client editor is a PLACE of its own (`?editor=<savedPlanId>`), the apply
// tray a local overlay under it. The router and the count are mocked and the
// address driven, so the contract at the host is what a coach would see:
// a pick pushes the editor and hides the tray, browser Back lands on the
// calendar, the editor's arrow lands on the list, an apply completes the
// editor's entry rather than leaving it behind Back.
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
    open: boolean;
    editorPlanId: string | null;
    preselectedBlockId?: string | null;
    onPick: (savedPlanId: string) => void;
    onExitEditor: () => void;
    onApplied?: () => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div
      data-testid="overlay"
      data-tray={String(props.open)}
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
      <button type="button" onClick={() => props.onOpenChange(false)}>
        close
      </button>
    </div>
  ),
}));

import { TrainingPlanBuilder } from "./training-plan-builder";

const client = { id: "c-1", name: "Sam Doe" } as Client;
const overlay = () => screen.getByTestId("overlay");

beforeEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  back.mockClear();
  search.current = new URLSearchParams("tab=training&training=plans");
  coachHistory.current = false;
});

describe("TrainingPlanBuilder — the client editor is a place", () => {
  it("resolves ?editor= from the address on the first render", () => {
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    render(<TrainingPlanBuilder client={client} />);
    expect(overlay()).toHaveAttribute("data-editor", "plan-1");
  });

  it("a pick hides the tray and pushes the editor's address, keeping the scroll position", () => {
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply program" }));
    expect(overlay()).toHaveAttribute("data-tray", "true");

    fireEvent.click(screen.getByRole("button", { name: "pick" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&editor=plan-1", {
      scroll: false,
    });
    expect(replace).not.toHaveBeenCalled();
    expect(overlay()).toHaveAttribute("data-tray", "false");
  });

  it("browser Back out of the editor lands on the calendar: the tray stays hidden", () => {
    const { rerender } = render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply program" }));
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} />);
    expect(overlay()).toHaveAttribute("data-editor", "plan-1");

    // The pop: the address loses the editor and nothing else changes.
    search.current = new URLSearchParams("tab=training&training=plans");
    rerender(<TrainingPlanBuilder client={client} />);

    expect(overlay()).toHaveAttribute("data-editor", "");
    expect(overlay()).toHaveAttribute("data-tray", "false");
  });

  it("the editor's arrow shows the list and pops the editor's entry", () => {
    coachHistory.current = true;
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    render(<TrainingPlanBuilder client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "exit" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(overlay()).toHaveAttribute("data-tray", "true");
  });

  it("the editor's arrow on a pasted address replaces the editor away", () => {
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    render(<TrainingPlanBuilder client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "exit" }));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans", { scroll: false });
    expect(overlay()).toHaveAttribute("data-tray", "true");
  });

  it("an apply with a Journey trip completes the editor's entry as the Journey entry", () => {
    // The trip arrives, the tray opens and the one-shots are stripped.
    search.current = new URLSearchParams(
      "tab=training&training=plans&apply=1&returnTo=journey&returnBlock=blk-7"
    );
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    expect(overlay()).toHaveAttribute("data-tray", "true");
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    // The trip survives the pick: the block still preselects the apply dialog.
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(onTabChange).toHaveBeenCalledWith(
      "metrics",
      { journey: "blocks", block: "blk-7" },
      { replace: true }
    );
    expect(back).not.toHaveBeenCalled();
  });

  it("an apply without a trip pops the editor's entry onto the calendar", () => {
    coachHistory.current = true;
    search.current = new URLSearchParams("tab=training&training=plans&editor=plan-1");
    const onTabChange = vi.fn();
    render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("button", { name: "applied" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(onTabChange).not.toHaveBeenCalled();
    expect(overlay()).toHaveAttribute("data-tray", "false");
  });

  it("the tray's X closes it without a navigation", () => {
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply program" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(overlay()).toHaveAttribute("data-tray", "false");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});
