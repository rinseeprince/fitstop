import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EditReadingDialog } from "./edit-reading-dialog";
import { RemoveReadingDialog } from "./remove-reading-dialog";
import type { LogRow } from "./metrics-view-types";

// The closing card's shape (CONVENTIONS §7 → "No frame disagrees", rule 5).
// Radix keeps a closing card mounted through its exit animation and re-renders
// it from live props; jsdom never plays that animation, so the stub below
// stands in for it: the card stays rendered whatever `open` is, and carries
// `open` as data. The host hands a closing dialog open=false and the SAME
// reading (metrics-tab-content.reading-dialogs.test.tsx); the card rendered
// from them must be the card the close left, and only the next open resets it.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (
    <div data-testid="card" data-open={String(open)}>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
// The edit field reaches useUnits() -> auth-context -> the browser Supabase
// client, which throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: undefined }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function row(overrides: Partial<LogRow> = {}): LogRow {
  return {
    id: "m-1",
    date: "2026-08-14",
    metricId: "weight",
    metricName: "Weight",
    value: 90,
    unit: "kg",
    canonicalValue: 90,
    change: null,
    note: null,
    source: "check_in",
    sourceId: "ci-1",
    isMeasurement: true,
    voided: null,
    isCurrent: false,
    isBaseline: false,
    beforeStart: false,
    ...overrides,
  };
}

const card = () => screen.getByTestId("card");
const field = () => screen.getByLabelText<HTMLInputElement>("Value");
const cancel = () => screen.getByRole("button", { name: "Cancel" });
const save = () => screen.getByRole("button", { name: "Save reading" });
const confirm = () => screen.getByRole("button", { name: "Remove reading" });
// The in-flight spinner is the only icon either CTA carries.
const spinnerOn = (button: HTMLElement) => button.querySelector("svg") !== null;

beforeEach(() => cleanup());

describe("EditReadingDialog's closing card", () => {
  it("Cancel closes on the reading and the draft it showed; the next open re-seeds the field", async () => {
    const user = userEvent.setup();
    const target = row();
    const props = { onOpenChange: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<EditReadingDialog key="open-1" open row={target} {...props} />);

    await user.clear(field());
    await user.type(field(), "95");
    await user.click(cancel());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<EditReadingDialog key="open-1" open={false} row={target} {...props} />);

    expect(card()).toHaveAttribute("data-open", "false");
    expect(field().value).toBe("95");
    expect(card()).toHaveTextContent("Weight");
    expect(card()).toHaveTextContent("14 August");

    rerender(<EditReadingDialog key="open-2" open row={target} {...props} />);
    expect(field().value).toBe("90");
  });

  it("a save that succeeds closes on its draft with the spinner still on", async () => {
    const user = userEvent.setup();
    const target = row();
    const props = { onOpenChange: vi.fn(), onConfirm: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<EditReadingDialog key="open-1" open row={target} {...props} />);

    await user.clear(field());
    await user.type(field(), "91");
    await user.click(save());
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    rerender(<EditReadingDialog key="open-1" open={false} row={target} {...props} />);

    expect(card()).toHaveAttribute("data-open", "false");
    expect(field().value).toBe("91");
    expect(spinnerOn(save())).toBe(true);
    expect(save()).toBeDisabled();
    expect(cancel()).toBeDisabled();
  });
});

describe("RemoveReadingDialog's closing card", () => {
  it("Cancel closes on the sentence it showed", async () => {
    const user = userEvent.setup();
    const target = row({ value: 91, canonicalValue: 91 });
    const props = { clientName: "Sam", onOpenChange: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<RemoveReadingDialog key="open-1" open row={target} {...props} />);

    await user.click(cancel());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<RemoveReadingDialog key="open-1" open={false} row={target} {...props} />);

    expect(card()).toHaveAttribute("data-open", "false");
    expect(screen.getByText("91 kg weight")).toBeInTheDocument();
    expect(card()).toHaveTextContent("reading of 14 August from every figure and from Sam’s app.");
  });

  it("a removal that succeeds closes with its spinner still on; the next open clears it", async () => {
    const user = userEvent.setup();
    const target = row({ value: 91, canonicalValue: 91 });
    const props = {
      clientName: "Sam",
      onOpenChange: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(<RemoveReadingDialog key="open-1" open row={target} {...props} />);

    await user.click(confirm());
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    rerender(<RemoveReadingDialog key="open-1" open={false} row={target} {...props} />);

    expect(card()).toHaveAttribute("data-open", "false");
    expect(screen.getByText("91 kg weight")).toBeInTheDocument();
    expect(spinnerOn(confirm())).toBe(true);
    expect(confirm()).toBeDisabled();
    expect(cancel()).toBeDisabled();

    rerender(<RemoveReadingDialog key="open-2" open row={target} {...props} />);
    expect(spinnerOn(confirm())).toBe(false);
    expect(confirm()).toBeEnabled();
    expect(cancel()).toBeEnabled();
  });
});
