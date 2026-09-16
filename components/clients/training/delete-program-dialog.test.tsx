import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { DeleteProgramDialog, type ProgramDeleteTarget } from "./delete-program-dialog";
import { formatDateOnlyShort } from "@/lib/date-helpers";

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

const queued: ProgramDeleteTarget = {
  id: "plan-2",
  name: "Strength",
  startsOn: "2026-10-05",
  endsOn: "2026-10-18",
  hasStarted: false,
  sessionsFrom: "today",
};

const running: ProgramDeleteTarget = {
  id: "plan-1",
  name: "Upper Lower",
  startsOn: "2026-09-07",
  endsOn: "2026-10-04",
  hasStarted: true,
  sessionsFrom: "today",
};

function renderDialog(overrides: Partial<Parameters<typeof DeleteProgramDialog>[0]> = {}) {
  const props = {
    open: true,
    target: queued,
    onCancel: vi.fn(),
    onConfirm: vi.fn(() => new Promise<boolean>(() => {})),
    ...overrides,
  };
  return { ...props, ...render(<DeleteProgramDialog {...props} />) };
}

const cancelButton = () => screen.getByRole("button", { name: "Cancel" });

describe("DeleteProgramDialog", () => {
  it("a program that hasn't started is removed, with its dates", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Remove plan?" })).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain(
      `Removes Strength, ${formatDateOnlyShort("2026-10-05")} – ${formatDateOnlyShort("2026-10-18")}.`,
    );
    expect(screen.getByRole("button", { name: "Remove plan" })).toBeInTheDocument();
  });

  it("a running program ends, and its sessions go from today", () => {
    renderDialog({ target: running });
    expect(screen.getByRole("heading", { name: "End plan?" })).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain(
      "Ends Upper Lower. Its sessions from today onwards are removed.",
    );
    expect(screen.getByRole("button", { name: "End plan" })).toBeInTheDocument();
  });

  it("once the client has logged a workout today, its sessions go from tomorrow", () => {
    renderDialog({ target: { ...running, sessionsFrom: "tomorrow" } });
    expect(screen.getByRole("dialog").textContent).toContain(
      "Ends Upper Lower. Its sessions from tomorrow onwards are removed.",
    );
  });

  it("Cancel cancels and the danger button confirms, each alone", () => {
    const { onCancel, onConfirm } = renderDialog();

    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("while the delete runs it spins and can't be cancelled or pressed again", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));

    const button = screen.getByRole("button", { name: /Remove plan/ });
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(cancelButton()).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(button);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("a failed delete stays open as the retry, its buttons back", async () => {
    let fail!: (closing: boolean) => void;
    const pending = new Promise<boolean>((resolve) => (fail = resolve));
    const onConfirm = vi.fn(() => pending);
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));

    await act(async () => {
      fail(false);
      await pending;
    });

    const button = screen.getByRole("button", { name: /Remove plan/ });
    expect(button).toBeEnabled();
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(cancelButton()).toBeEnabled();
  });

  it("names its program while it fades out, spinner and all after a delete", async () => {
    holdExitAnimation();
    let succeed!: (closing: boolean) => void;
    const pending = new Promise<boolean>((resolve) => (succeed = resolve));
    const onConfirm = vi.fn(() => pending);
    const onCancel = vi.fn();
    const { rerender } = render(
      <DeleteProgramDialog open target={queued} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));
    rerender(<DeleteProgramDialog open={false} target={queued} onCancel={onCancel} onConfirm={onConfirm} />);
    await act(async () => {
      succeed(true);
      await pending;
    });

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Remove plan?");
    expect(closing?.textContent).toContain("Removes Strength");
    const button = Array.from(closing?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Remove plan"),
    );
    expect(button?.querySelector(".animate-spin")).not.toBeNull();
  });
});
