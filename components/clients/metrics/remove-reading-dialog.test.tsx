import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RemoveReadingDialog } from "./remove-reading-dialog";
import type { LogRow } from "./metrics-view-types";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function row(overrides: Partial<LogRow> = {}): LogRow {
  return {
    id: "m-1",
    date: "2026-08-14",
    metricId: "weight",
    metricName: "Weight",
    value: 91,
    unit: "kg",
    canonicalValue: 91,
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

const sentence = () => screen.getByRole("dialog").textContent ?? "";
const confirm = () => screen.getByRole("button", { name: "Remove reading" });
const cancel = () => screen.getByRole("button", { name: "Cancel" });

beforeEach(() => cleanup());

describe("RemoveReadingDialog", () => {
  it("names the reading, its date and the client, and says the reading survives", () => {
    render(
      <RemoveReadingDialog open row={row()} clientName="Sam Kalepa" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );

    expect(screen.getByRole("heading", { name: "Remove reading?" })).toBeInTheDocument();
    expect(screen.getByText("91 kg weight")).toBeInTheDocument();
    expect(sentence()).toContain("reading of 14 August from every figure and from Sam Kalepa’s app.");
    expect(sentence()).toContain("It stays in the log and can be restored.");
    expect(sentence()).not.toContain("This is the");
  });

  it("attaches a percent, so body fat reads 18.5% not 18.5 %", () => {
    render(
      <RemoveReadingDialog
        open
        row={row({ metricId: "bodyFat", metricName: "Body Fat", value: 18.5, unit: "%" })}
        clientName="Sam"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("18.5% body fat")).toBeInTheDocument();
  });

  it("warns when the reading is the current one, the baseline, or both", () => {
    const { rerender } = render(
      <RemoveReadingDialog open row={row({ isCurrent: true })} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(sentence()).toContain("This is the current reading.");

    rerender(
      <RemoveReadingDialog open row={row({ isBaseline: true })} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(sentence()).toContain("This is the reading the since-start figures use.");

    rerender(
      <RemoveReadingDialog
        open
        row={row({ isCurrent: true, isBaseline: true })}
        clientName="Sam"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(sentence()).toContain(
      "This is the current reading and the reading the since-start figures use."
    );
  });

  it("confirms with the row and closes; Cancel confirms nothing", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const target = row();
    render(
      <RemoveReadingDialog open row={target} clientName="Sam" onOpenChange={onOpenChange} onConfirm={onConfirm} />
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Remove reading" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(target));
  });

  it("renders nothing while closed, even holding a reading — open is its own prop", () => {
    render(
      <RemoveReadingDialog open={false} row={row()} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// The reading outlives the close (CONVENTIONS §7 → "No frame disagrees"), so
// the in-flight flag a success leaves set is cleared by the next open. jsdom
// unmounts a closing card at once, so these read the closing frame with the
// card held open; reading-dialogs.closing-card.test.tsx reads it with the card
// kept mounted through `open={false}`.
describe("RemoveReadingDialog — the flag resets on the open, never on the close", () => {
  it("a removal that succeeds asks to close with its spinner still on; the next open clears it", async () => {
    const user = userEvent.setup();
    const target = row();
    const props = {
      clientName: "Sam",
      onOpenChange: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(<RemoveReadingDialog key="open-1" open row={target} {...props} />);

    await user.click(confirm());
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    await act(async () => {});

    expect(confirm()).toBeDisabled();
    expect(cancel()).toBeDisabled();
    expect(screen.getByText("91 kg weight")).toBeInTheDocument();

    rerender(<RemoveReadingDialog key="open-1" open={false} row={target} {...props} />);
    rerender(<RemoveReadingDialog key="open-2" open row={target} {...props} />);

    expect(confirm()).toBeEnabled();
    expect(cancel()).toBeEnabled();
  });

  it("a removal that fails keeps the card and hands the flag back", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error("nope"));
    render(<RemoveReadingDialog open row={row()} clientName="Sam" onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await user.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(cancel()).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
