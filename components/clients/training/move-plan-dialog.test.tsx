import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MovePlanDialog, type PlanMoveChoice } from "./move-plan-dialog";
import { formatDateOnlyWeekday } from "@/components/clients/overview/overview-format";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom computes no animation, so Radix unmounts a closing card at once. Naming
// an exit animation holds the closing frame on the page to be read.
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

const later: PlanMoveChoice = {
  programName: "Upper Lower",
  fromDate: "2026-09-16",
  toDate: "2026-09-18",
};

function renderDialog(overrides: Partial<Parameters<typeof MovePlanDialog>[0]> = {}) {
  const props = {
    open: true,
    choice: later,
    onCancel: vi.fn(),
    onConfirm: vi.fn(() => new Promise<void>(() => {})),
    ...overrides,
  };
  const view = render(<MovePlanDialog {...props} />);
  return { ...props, ...view };
}

const moveButton = () => screen.getByRole("button", { name: /Move program/ });
const cancelButton = () => screen.getByRole("button", { name: "Cancel" });

describe("MovePlanDialog", () => {
  it("names the program, its new start and how far every session moves", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Move Upper Lower?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        `It will start on ${formatDateOnlyWeekday("2026-09-18")}, and every session moves 2 days later with it.`,
      ),
    ).toBeInTheDocument();
  });

  it("says earlier for a move back, and one day in the singular", () => {
    renderDialog({ choice: { programName: "Strength", fromDate: "2026-10-19", toDate: "2026-10-18" } });
    expect(
      screen.getByText(
        `It will start on ${formatDateOnlyWeekday("2026-10-18")}, and every session moves 1 day earlier with it.`,
      ),
    ).toBeInTheDocument();
  });

  it("Cancel cancels and Move program confirms, each alone", () => {
    const { onCancel, onConfirm } = renderDialog();

    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(moveButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels before the move starts", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("once Move program is pressed it spins and can't be cancelled or pressed again", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(moveButton());

    expect(moveButton()).toBeDisabled();
    expect(moveButton().querySelector(".animate-spin")).not.toBeNull();
    expect(cancelButton()).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(moveButton());
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("still asks about its move while it fades out", () => {
    holdExitAnimation();
    const { rerender, onCancel, onConfirm } = renderDialog();
    rerender(<MovePlanDialog open={false} choice={later} onCancel={onCancel} onConfirm={onConfirm} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Move Upper Lower?");
  });

  it("keeps its spinner through the fade after a move", () => {
    holdExitAnimation();
    const { rerender, onCancel, onConfirm } = renderDialog();
    fireEvent.click(moveButton());
    rerender(<MovePlanDialog open={false} choice={later} onCancel={onCancel} onConfirm={onConfirm} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    const button = Array.from(closing?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Move program"),
    );
    expect(button?.querySelector(".animate-spin")).not.toBeNull();
    expect(button).toBeDisabled();
  });
});
