import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { DeleteGoalDialog, type DeleteGoalSubject } from "./delete-goal-dialog";

// A goal's delete confirm: it takes `open` apart from the goal it names, so a
// closing card keeps the name and the sentence while it fades (CONVENTIONS §7 →
// "No frame disagrees"). The current goal's delete is typed.

const PLANNED: DeleteGoalSubject = {
  goal: {
    id: "goal-trim",
    clientId: "client-5",
    name: "Trim",
    type: "lose_weight",
    targetWeight: 74.3,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-11-23",
    source: "coach",
    setBy: "coach-4",
    createdAt: "2026-10-02T09:00:00Z",
    updatedAt: "2026-10-02T09:00:00Z",
    deadline: null,
  },
  isCurrent: false,
};

const CURRENT: DeleteGoalSubject = {
  goal: { ...PLANNED.goal, id: "goal-base", name: "Base", startsOn: "2026-07-13" },
  isCurrent: true,
};

// jsdom computes no animation, so Radix unmounts a closing card at once. Radix
// holds the card while its animation name changes, as the fade does in a
// browser, so naming one keeps the closing frame on the page to be read.
function holdExitAnimation() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const styles = computed(element, pseudo);
    if (element instanceof HTMLElement && element.dataset.slot === "dialog-content") {
      Object.defineProperty(styles, "animationName", {
        get: () => (element.dataset.state === "closed" ? "exit" : "enter"),
      });
    }
    return styles;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DeleteGoalDialog", () => {
  it("names a planned goal and its day, and deletes it at a click", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<DeleteGoalDialog open subject={PLANNED} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("heading").textContent).toBe("Delete Trim?");
    expect(screen.getByText("Deletes Trim, planned from 23 Nov.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Type DELETE to confirm")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Delete goal" }).click();
    expect(onConfirm).toHaveBeenCalledWith(PLANNED);
  });

  // An ended goal can never be set again, so its delete is typed too.
  it("names a goal that has ended with its days, and deletes it only once DELETE is typed", () => {
    // Its days carry their year when it isn't this one, so today is pinned
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00"));
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const ENDED: DeleteGoalSubject = {
      goal: { ...PLANNED.goal, id: "goal-cut", name: "Cut", startsOn: "2026-03-16" },
      isCurrent: false,
      endsOn: "2026-05-10",
    };
    render(<DeleteGoalDialog open subject={ENDED} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText("Deletes Cut, 16 Mar – 10 May.")).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Delete goal" });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(cta).toBeEnabled();
    cta.click();
    expect(onConfirm).toHaveBeenCalledWith(ENDED);
  });

  // The current goal can't be put back as it was, so its delete is typed.
  it("deletes the current goal only once DELETE is typed", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<DeleteGoalDialog open subject={CURRENT} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    expect(
      screen.getByText(
        "Base is the current goal. Deleting it can't be undone: set again, it starts from today and its progress counts from today's weight."
      )
    ).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Delete goal" });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "delete" } });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(cta).toBeEnabled();
    cta.click();
    expect(onConfirm).toHaveBeenCalledWith(CURRENT);
  });

  it("is closed whenever `open` is false, even with a goal to name", () => {
    render(<DeleteGoalDialog open={false} subject={PLANNED} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its goal while it fades out", () => {
    holdExitAnimation();
    const props = { subject: PLANNED, onOpenChange: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<DeleteGoalDialog open {...props} />);
    rerender(<DeleteGoalDialog open={false} {...props} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Delete Trim?");
    expect(closing?.textContent).toContain("Deletes Trim, planned from 23 Nov.");
  });
});
