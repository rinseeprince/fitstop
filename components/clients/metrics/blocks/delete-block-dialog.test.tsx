import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeleteBlockDialog } from "./delete-block-dialog";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

// The block delete's confirm: two CTAs, the block named in the title. It
// takes `open` apart from the block it names, so a closing card keeps the
// name while it fades (CONVENTIONS §7 → "No frame disagrees").

const block: ClientBlockView = {
  id: "blk-1",
  name: "Cut 2",
  focus: null,
  startsOn: "2026-08-01",
  endsOn: "2026-09-30",
  archivedAt: null,
  weeks: 9,
  state: "current",
  weekOfTotal: null,
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

describe("DeleteBlockDialog", () => {
  it("names the block and confirms with it, with or without its plans", () => {
    const onConfirm = vi.fn();
    render(<DeleteBlockDialog open block={block} deleting={null} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByRole("heading").textContent).toBe("Delete Cut 2?");
    screen.getByRole("button", { name: "Delete block" }).click();
    expect(onConfirm).toHaveBeenLastCalledWith(block, false);
    screen.getByRole("button", { name: "Delete block and its plans" }).click();
    expect(onConfirm).toHaveBeenLastCalledWith(block, true);
  });

  it("is inert mid-delete", () => {
    render(<DeleteBlockDialog open block={block} deleting="plans" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete block" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete block and its plans" })).toBeDisabled();
  });

  it("is closed whenever `open` is false, even with a block to name", () => {
    render(<DeleteBlockDialog open={false} block={block} deleting={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still names its block while it fades out", () => {
    holdExitAnimation();
    const props = { block, deleting: null, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<DeleteBlockDialog open {...props} />);
    rerender(<DeleteBlockDialog open={false} {...props} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Delete Cut 2?");
  });
});
