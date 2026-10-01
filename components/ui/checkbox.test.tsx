import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Checkbox } from "./checkbox";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";

// The Teal-Summit tick (docs/newdesignsystem.md → Checkbox): the look lives
// in the primitive, and a call site passes a size and nothing else of it
// (components/checkbox-ownership.test.ts holds the call sites to that).

describe("Checkbox", () => {
  it("is the Teal-Summit tick: a teal-grey box on the shared focus ring, with no OKLCH token left", () => {
    render(<Checkbox aria-label="Done" />);
    const box = screen.getByRole("checkbox", { name: "Done" });

    expect(box).toHaveAttribute("data-slot", "checkbox");
    expect(box).toHaveClass("size-4", "rounded-[4px]", "border", "border-[#93b0b4]");
    expect(box).toHaveClass(...FOCUS_RING.split(" "));
    expect(box.className).not.toMatch(/\b(border-input|bg-primary|text-primary-foreground|ring-ring|border-ring|ring-\[3px\]|dark:)/);
  });

  it("fills teal with a white tick when ticked, and light teal while part of something is done", () => {
    const { rerender } = render(<Checkbox aria-label="Done" checked />);
    const box = screen.getByRole("checkbox", { name: "Done" });
    expect(box).toHaveAttribute("data-state", "checked");
    expect(box).toHaveClass("data-[state=checked]:border-[#0d9488]", "data-[state=checked]:bg-[#0d9488]", "data-[state=checked]:text-white");
    expect(box.querySelector('[data-slot="checkbox-indicator"] svg')).not.toBeNull();

    rerender(<Checkbox aria-label="Done" checked="indeterminate" />);
    expect(box).toHaveAttribute("data-state", "indeterminate");
    expect(box).toHaveClass("data-[state=indeterminate]:border-[#0d9488]", "data-[state=indeterminate]:bg-[rgba(13,148,136,0.25)]");
  });

  it("takes its size from the call site, in place of its own", () => {
    render(<Checkbox aria-label="Done" className="size-5" />);
    const box = screen.getByRole("checkbox", { name: "Done" });
    expect(box).toHaveClass("size-5");
    expect(box).not.toHaveClass("size-4");
  });

  it("ticks and unticks on a click, and answers nothing while disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Checkbox aria-label="Done" checked={false} onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Done" }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<Checkbox aria-label="Done" checked onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Done" }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    onCheckedChange.mockClear();
    rerender(<Checkbox aria-label="Done" checked={false} onCheckedChange={onCheckedChange} disabled />);
    const box = screen.getByRole("checkbox", { name: "Done" });
    expect(box).toBeDisabled();
    expect(box).toHaveClass("disabled:cursor-not-allowed", "disabled:opacity-50");
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
