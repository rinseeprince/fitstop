import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RemoveReadingDialog } from "./remove-reading-dialog";
import type { LogRow } from "./metrics-view-types";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
    folded: [],
    voided: null,
    isCurrent: false,
    isBaseline: false,
    beforeStart: false,
    ...overrides,
  };
}

const sentence = () => screen.getByRole("dialog").textContent ?? "";

beforeEach(() => cleanup());

describe("RemoveReadingDialog", () => {
  it("names the reading, its date and the client, and says the reading survives", () => {
    render(
      <RemoveReadingDialog row={row()} clientName="Sam Kalepa" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
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
      <RemoveReadingDialog row={row({ isCurrent: true })} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(sentence()).toContain("This is the current reading.");

    rerender(
      <RemoveReadingDialog row={row({ isBaseline: true })} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(sentence()).toContain("This is the reading the since-start figures use.");

    rerender(
      <RemoveReadingDialog
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
      <RemoveReadingDialog row={target} clientName="Sam" onOpenChange={onOpenChange} onConfirm={onConfirm} />
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Remove reading" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(target));
  });

  it("renders nothing for no row", () => {
    render(<RemoveReadingDialog row={null} clientName="Sam" onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
