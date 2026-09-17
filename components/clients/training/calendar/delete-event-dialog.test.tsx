import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ClearWeekDialog, DeleteEventDialog } from "./delete-event-dialog";
import type { TrainingEvent } from "@/types/training";

// `open` is each confirm's own prop, never derived from its subject: a closed
// confirm still holds the subject it showed (CONVENTIONS §7 → "No frame
// disagrees"), so a subject in hand must not open it.

const EVENT: TrainingEvent = {
  id: "ev1",
  clientId: "c1",
  trainingPlanId: "p1",
  trainingSessionId: "s1",
  date: "2026-07-24",
  sessionName: "Push Day A",
  sessionFocus: null,
  estimatedCalories: null,
  status: "scheduled",
  sessionLogId: null,
  log: null,
  isModified: false,
  calorieSurplusPercentage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// jsdom computes no animation, so Radix unmounts a closing card at once. Radix
// holds a card while its animation name changes, as the fade does in a
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

function closingCard(): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    '[data-slot="dialog-content"][data-state="closed"]',
  );
  if (!card) throw new Error("no closing card on the page");
  return card;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeleteEventDialog", () => {
  const renderDialog = (open: boolean) =>
    render(
      <DeleteEventDialog
        open={open}
        event={EVENT}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

  it("renders its subject's session when open", () => {
    renderDialog(true);
    expect(screen.getByText("Remove session?")).toBeDefined();
    expect(screen.getByText("Push Day A")).toBeDefined();
    expect(screen.getByText(/on Fri, Jul 24 from the calendar/)).toBeDefined();
  });

  it("stays shut when closed with its subject still in hand", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its session while the closing card fades", () => {
    holdExitAnimation();
    const { rerender } = renderDialog(true);
    rerender(
      <DeleteEventDialog
        open={false}
        event={EVENT}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(closingCard().querySelector("p")?.textContent).toBe(
      "Removes Push Day A on Fri, Jul 24 from the calendar.",
    );
  });
});

describe("ClearWeekDialog", () => {
  const renderDialog = (open: boolean) =>
    render(
      <ClearWeekDialog
        open={open}
        weekStartDate="2026-07-20"
        isClearing={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

  it("renders its subject's week when open", () => {
    renderDialog(true);
    expect(screen.getByText("Clear this week?")).toBeDefined();
    expect(screen.getByText(/from the week of Mon, Jul 20/)).toBeDefined();
  });

  it("stays shut when closed with its subject still in hand", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its week while the closing card fades", () => {
    holdExitAnimation();
    const { rerender } = renderDialog(true);
    rerender(
      <ClearWeekDialog
        open={false}
        weekStartDate="2026-07-20"
        isClearing={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(closingCard().querySelector("p")?.textContent).toBe(
      "Removes the upcoming scheduled sessions from the week of Mon, Jul 20.",
    );
  });
});
