import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { DeleteGoalDialog, type DeleteGoalSubject } from "./delete-goal-dialog";

// A goal's delete confirm: it takes `open` apart from the goal it names, so a
// closing card keeps the name and the sentence while it fades (CONVENTIONS §7 →
// "No frame disagrees").

const SUBJECT: DeleteGoalSubject = {
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
  previousName: null,
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
});

describe("DeleteGoalDialog", () => {
  it("names the goal and its day, and confirms with the verb", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteGoalDialog open subject={SUBJECT} clientName="Sam Lee" onOpenChange={vi.fn()} onConfirm={onConfirm} />
    );

    expect(screen.getByRole("heading").textContent).toBe("Delete Trim?");
    expect(screen.getByText("Deletes Trim, planned from 23 Nov.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Delete goal" }).click();
    expect(onConfirm).toHaveBeenCalledWith(SUBJECT);
  });

  it("is closed whenever `open` is false, even with a goal to name", () => {
    render(
      <DeleteGoalDialog open={false} subject={SUBJECT} clientName="Sam Lee" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its goal while it fades out", () => {
    holdExitAnimation();
    const props = { subject: SUBJECT, clientName: "Sam Lee", onOpenChange: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<DeleteGoalDialog open {...props} />);
    rerender(<DeleteGoalDialog open={false} {...props} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Delete Trim?");
    expect(closing?.textContent).toContain("Deletes Trim, planned from 23 Nov.");
  });
});
