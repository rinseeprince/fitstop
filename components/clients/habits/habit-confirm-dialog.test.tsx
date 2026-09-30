import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { HabitConfirmDialog, type HabitConfirmSubject } from "./habit-confirm-dialog";
import type { CoachHabit } from "@/types/habits";

// A habit's stop and delete confirm: it takes `open` apart from the habit it
// names, so a closing card keeps the name, the sentence and its spinner while
// it fades (CONVENTIONS §7 → "No frame disagrees").

const WATER: CoachHabit = {
  id: "h-water",
  name: "Water",
  howTo: null,
  measure: "number",
  unit: "L",
  direction: "at_least",
  position: 0,
  versions: [],
  dayEdits: [],
  hasEntries: true,
  status: "running",
  words: { schedule: "Every day", target: "at least 3 L" },
};
const STOP: HabitConfirmSubject = { kind: "stop", habit: WATER };
const DELETE: HabitConfirmSubject = { kind: "delete", habit: { ...WATER, hasEntries: false } };

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

describe("HabitConfirmDialog", () => {
  it("asks to stop a habit from today, keeping its past", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<HabitConfirmDialog open subject={STOP} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("heading").textContent).toBe("Stop Water?");
    expect(screen.getByText("It stops from today. Its past stays.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Stop habit" }).click();
    expect(onConfirm).toHaveBeenCalledWith(STOP);
  });

  it("asks to delete a habit in one sentence, whether or not the client ever logged it", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const logged: HabitConfirmSubject = { kind: "delete", habit: WATER };
    const { rerender } = render(<HabitConfirmDialog open subject={DELETE} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toBe("Delete Water?");
    expect(screen.getByText("Everything the client has logged against this habit will stay.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete habit" })).toBeEnabled();

    rerender(<HabitConfirmDialog open subject={logged} onOpenChange={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole("heading").textContent).toBe("Delete Water?");
    expect(screen.getByText("Everything the client has logged against this habit will stay.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Delete habit" }).click();
    expect(onConfirm).toHaveBeenCalledWith(logged);
  });

  it("cannot be dismissed while its write is in flight", async () => {
    let settle: () => void = () => {};
    const write = new Promise<void>((resolve) => (settle = resolve));
    const onConfirm = vi.fn(() => write);
    const onOpenChange = vi.fn();
    render(<HabitConfirmDialog open subject={STOP} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    screen.getByRole("button", { name: "Stop habit" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop habit" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      settle();
      await write;
    });
  });

  it("says why a refused write failed and can be tried again", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Habit not found."));
    render(<HabitConfirmDialog open subject={DELETE} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    screen.getByRole("button", { name: "Delete habit" }).click();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Delete failed", {
        description: "Habit not found.",
      })
    );
    // The toast is sent a beat before React commits the idle button: wait for it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete habit" })).toBeEnabled());
  });

  // A stop can be undone by starting the habit again, so its yes is the
  // non-destructive confirm's teal primary; a delete keeps the danger outline.
  it("asks for a stop with the teal primary, and for a delete with the danger outline", () => {
    const TEAL_PRIMARY = ["bg-[#0d9488]", "text-white", "hover:bg-[#0b7f75]"];
    const DANGER_OUTLINE = ["border-[rgba(192,96,96,0.3)]", "text-[#c06060]"];
    const { rerender } = render(<HabitConfirmDialog open subject={STOP} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    const stop = screen.getByRole("button", { name: "Stop habit" });
    expect(stop).toHaveClass(...TEAL_PRIMARY);
    for (const danger of DANGER_OUTLINE) expect(stop).not.toHaveClass(danger);

    rerender(<HabitConfirmDialog open subject={DELETE} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    const remove = screen.getByRole("button", { name: "Delete habit" });
    expect(remove).toHaveClass(...DANGER_OUTLINE);
    for (const teal of TEAL_PRIMARY) expect(remove).not.toHaveClass(teal);
  });

  it("is closed whenever `open` is false, even with a habit to name", () => {
    render(<HabitConfirmDialog open={false} subject={STOP} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its habit, and keeps its spinner, while it fades out after the write answered", async () => {
    holdExitAnimation();
    const props = { subject: STOP, onOpenChange: vi.fn(), onConfirm: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<HabitConfirmDialog open {...props} />);
    screen.getByRole("button", { name: "Stop habit" }).click();
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith(STOP));
    // The host lands the answer and closes the confirm together.
    rerender(<HabitConfirmDialog open={false} {...props} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Stop Water?");
    expect(closing?.textContent).toContain("It stops from today. Its past stays.");
    expect(closing?.querySelector(".animate-spin")).not.toBeNull();
  });
});
