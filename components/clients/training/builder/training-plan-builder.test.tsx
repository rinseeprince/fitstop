import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Client } from "@/types/check-in";

// Every surface here has ONE owner, the address: the tray is `?apply=1`, the
// client editor `?editor=<savedPlanId>` and the plan editor `?plan=<planId>`
// (CONVENTIONS §7 → "No frame disagrees"). The router and the count are mocked
// and the address driven, so the contract at the host is what a coach would
// see: "Apply program" pushes the tray, a pick replaces the tray's entry with
// the editor's, the arrow replaces back to the list, the X pops the tray's
// entry, Back out of the editor lands on the calendar, an apply completes the
// editor's entry, and a pasted address falls back to a replace. "Edit plan"
// pushes the plan editor, its arrow pops that entry, and a save completes it.
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
// tests. Each stub exposes exactly the contract the builder hands it: the
// panel's hero offers "Apply program" and "Edit plan" on the plan it shows.
vi.mock("@/contexts/training-builder-context", () => ({
  TrainingBuilderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./training-builder-right-panel", () => ({
  TrainingBuilderRightPanel: ({
    onOpenGenerator,
    onEditPlan,
  }: {
    onOpenGenerator?: () => void;
    onEditPlan?: (planId: string) => void;
  }) => (
    <>
      <button type="button" onClick={onOpenGenerator}>
        Apply program
      </button>
      <button type="button" onClick={() => onEditPlan?.("plan-9")}>
        Edit plan
      </button>
    </>
  ),
}));
// Required, not optional: the real plan editor mounts the program builder,
// whose import chain reaches auth-context, which constructs the browser
// Supabase client at module load and throws without env vars.
vi.mock("./plan-editor-overlay", () => ({
  PlanEditorOverlay: (props: {
    planId: string | null;
    onExit: () => void;
    onSaved: () => void;
  }) => (
    <div data-testid="plan-editor" data-plan={props.planId ?? ""}>
      <button type="button" onClick={props.onExit}>
        plan arrow
      </button>
      <button type="button" onClick={props.onSaved}>
        plan saved
      </button>
    </div>
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
const planEditor = () => screen.getByTestId("plan-editor");
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

describe("TrainingPlanBuilder — the plan editor is a place", () => {
  it("resolves the plan editor from the address on the first render, and Back closes it", () => {
    at("tab=training&training=plans&plan=plan-9");
    const { rerender } = render(<TrainingPlanBuilder client={client} />);
    expect(planEditor()).toHaveAttribute("data-plan", "plan-9");
    expect(overlay()).toHaveAttribute("data-tray", "false");
    expect(overlay()).toHaveAttribute("data-editor", "");

    // The pop: the address is the entry before Edit plan's push.
    at("tab=training&training=plans");
    rerender(<TrainingPlanBuilder client={client} />);
    expect(planEditor()).toHaveAttribute("data-plan", "");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("Edit plan PUSHES the plan editor's address on the hero's plan, keeping the scroll position", () => {
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&plan=plan-9", {
      scroll: false,
    });
    expect(replace).not.toHaveBeenCalled();
    // The editor follows the address, not the click.
    expect(planEditor()).toHaveAttribute("data-plan", "");
  });

  it("Edit plan's address names one place: a tray or a client editor on it goes", () => {
    at("tab=training&training=plans&apply=1&editor=sp-1");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));

    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&plan=plan-9", {
      scroll: false,
    });
  });

  it("the arrow pops the plan editor's entry when a coach page precedes it", () => {
    coachHistory.current = true;
    at("tab=training&training=plans&plan=plan-9");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "plan arrow" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("the arrow on a pasted address replaces the plan editor away", () => {
    at("tab=training&training=plans&plan=plan-9");
    render(<TrainingPlanBuilder client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "plan arrow" }));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans", { scroll: false });
  });

  it("a save without a trip pops the plan editor's entry onto the calendar", () => {
    coachHistory.current = true;
    at("tab=training&training=plans&plan=plan-9");
    const onTabChange = vi.fn();
    render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "plan saved" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("a save on a pasted address replaces the plan editor away", () => {
    at("tab=training&training=plans&plan=plan-9");
    const onTabChange = vi.fn();
    render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "plan saved" }));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans", { scroll: false });
    expect(onTabChange).not.toHaveBeenCalled();
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

  // Journey's "edit plan" lands straight in the plan editor: no tray, no
  // `?apply=1`, and the trip rides beside `?plan=`.
  const PLAN_TRIP = "tab=training&training=plans&plan=plan-9&returnTo=journey&returnBlock=blk-7";

  it("arrives in the plan editor, captures the block, and strips ONLY the return params", () => {
    at(PLAN_TRIP);
    render(<TrainingPlanBuilder client={client} />);

    expect(planEditor()).toHaveAttribute("data-plan", "plan-9");
    expect(overlay()).toHaveAttribute("data-block", "blk-7");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?tab=training&training=plans&plan=plan-9", {
      scroll: false,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("a plan save completes the editor's entry as the Journey entry", () => {
    coachHistory.current = true;
    at(PLAN_TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    at("tab=training&training=plans&plan=plan-9");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("button", { name: "plan saved" }));
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith(
      "metrics",
      { journey: "blocks", block: "blk-7" },
      { replace: true }
    );
    expect(back).not.toHaveBeenCalled();
    // The arrival's strip is the only replace here; the save is the tab change.
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("the plan editor's arrow abandons the trip and pops: a later save pops onto the calendar", () => {
    coachHistory.current = true;
    at(PLAN_TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    at("tab=training&training=plans&plan=plan-9");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("button", { name: "plan arrow" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(overlay()).toHaveAttribute("data-block", "");

    // Forward re-enters the plan editor as a place; the flow is fresh.
    fireEvent.click(screen.getByRole("button", { name: "plan saved" }));
    expect(onTabChange).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("Edit plan starts a fresh flow: nothing rides on from a trip left by browser Back", () => {
    coachHistory.current = true;
    at(TRIP);
    const onTabChange = vi.fn();
    const { rerender } = render(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    // Back out of the tray left the trip captured and the surface closed.
    at("tab=training&training=plans");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    expect(overlay()).toHaveAttribute("data-block", "blk-7");

    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(overlay()).toHaveAttribute("data-block", "");
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&plan=plan-9", {
      scroll: false,
    });

    at("tab=training&training=plans&plan=plan-9");
    rerender(<TrainingPlanBuilder client={client} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "plan saved" }));
    expect(onTabChange).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });
});
