import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BlockTrimDialog, type BlockTrimQuestion } from "./block-trim-dialog";

// The one question a block save asks when it trims plans: one sentence per
// plan, then Cancel or the verb. It takes `open` apart from its question, so a
// closing card keeps its list while it fades (CONVENTIONS §7 → "No frame
// disagrees").

// Dated in the year the suite runs in, so the dates read without a year (the
// year rule is formatBlockDate's).
const Y = new Date().getFullYear();
const question: BlockTrimQuestion = {
  kind: "add",
  blockName: "Build",
  trims: [
    { track: "training", id: "p-1", name: "Power", startsOn: `${Y}-10-26`, endsOn: `${Y}-12-20`, newEndsOn: `${Y}-11-08` },
    { track: "training", id: "p-2", name: "Glute", startsOn: `${Y}-10-26`, endsOn: `${Y}-11-08`, newEndsOn: null },
    { track: "nutrition", id: "v-1", name: null, startsOn: `${Y}-10-26`, endsOn: `${Y}-12-20`, newEndsOn: `${Y}-11-08` },
    { track: "nutrition", id: "v-2", name: null, startsOn: `${Y}-10-26`, endsOn: `${Y}-11-08`, newEndsOn: null },
  ],
};

// jsdom computes no animation, so Radix unmounts a closing card at once; naming
// one keeps the closing frame on the page to be read (delete-block-dialog.test).
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

describe("BlockTrimDialog", () => {
  it("names the block and says what happens to each plan, in the owner's words", () => {
    render(<BlockTrimDialog open question={question} isSaving={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole("heading").textContent).toBe('Add "Build"?');
    expect(screen.getByText("Saving it changes these plans:")).toBeDefined();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Power ends 8 Nov. Its sessions after that are removed.",
      "Glute, 26 Oct – 8 Nov, is removed.",
      "The nutrition targets running 26 Oct – 20 Dec end 8 Nov.",
      "The nutrition targets for 26 Oct – 8 Nov are removed.",
    ]);
  });

  it("a shorten says Save; the verb confirms and Cancel cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BlockTrimDialog
        open
        question={{ ...question, kind: "save" }}
        isSaving={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("heading").textContent).toBe('Save "Build"?');
    expect(screen.queryByRole("button", { name: "Just the dates" })).toBeNull();
    screen.getByRole("button", { name: "Save block" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("is inert mid-save", () => {
    render(<BlockTrimDialog open question={question} isSaving onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add block" })).toBeDisabled();
  });

  it("is closed whenever `open` is false, even with a question to ask", () => {
    render(<BlockTrimDialog open={false} question={question} isSaving={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still lists its plans while it fades out", () => {
    holdExitAnimation();
    const props = { question, isSaving: false, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<BlockTrimDialog open {...props} />);
    rerender(<BlockTrimDialog open={false} {...props} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe('Add "Build"?');
    expect(closing?.querySelectorAll("li")).toHaveLength(4);
  });
});
