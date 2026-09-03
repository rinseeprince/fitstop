import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EditReadingDialog } from "./edit-reading-dialog";
import type { LogRow } from "./metrics-view-types";
import type { UnitSystem } from "@/utils/unit-conversions";

// The dialog reaches useUnits() -> auth-context -> the browser Supabase client,
// which throws without env vars. Same mock the log dialog's suite carries.
const preference = { current: "metric" as UnitSystem };
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: preference.current, isLoading: false, error: undefined }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
    folded: [],
    voided: null,
    isCurrent: false,
    isBaseline: false,
    beforeStart: false,
    ...overrides,
  };
}

const field = () => screen.getByLabelText<HTMLInputElement>("Value");
const save = () => screen.getByRole("button", { name: "Save reading" });

beforeEach(() => {
  cleanup();
  preference.current = "metric";
});

describe("EditReadingDialog", () => {
  it("renders nothing for no row", () => {
    render(<EditReadingDialog row={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("seeds the field from the CANONICAL value in the viewer's unit, and names the reading", () => {
    preference.current = "imperial";
    render(
      <EditReadingDialog
        row={row({ value: 198.4, unit: "lbs", canonicalValue: 90 })}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(field().value).toBe("198.4");
    expect(screen.getByText(/Weight/)).toBeInTheDocument();
    expect(screen.getByText("14 August")).toBeInTheDocument();
    expect(screen.getByText(/check-in/)).toBeInTheDocument();
  });

  it("refuses an untouched field — a correction that changes nothing is not a correction", () => {
    render(<EditReadingDialog row={row()} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    expect(save()).toBeDisabled();
  });

  it("converts what the coach typed and hands the caller the canonical value", async () => {
    const user = userEvent.setup();
    preference.current = "imperial";
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const target = row({ value: 198.4, unit: "lbs", canonicalValue: 90 });
    render(<EditReadingDialog row={target} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await user.clear(field());
    await user.type(field(), "200");
    await user.click(save());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [passedRow, canonical] = onConfirm.mock.calls[0];
    expect(passedRow).toBe(target);
    expect(canonical).toBeCloseTo(90.72, 1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("holds a value outside the metric's STORAGE bounds, judged on the converted number", async () => {
    const user = userEvent.setup();
    render(<EditReadingDialog row={row()} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    await user.clear(field());
    await user.type(field(), "300");

    expect(save()).toBeDisabled();
    expect(screen.getByText("Out of range for weight.")).toBeInTheDocument();
  });

  it("takes body fat straight through — no unit, no conversion, whatever the viewer's preference", async () => {
    const user = userEvent.setup();
    preference.current = "imperial";
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <EditReadingDialog
        row={row({ metricId: "bodyFat", metricName: "Body Fat", value: 18.5, unit: "%", canonicalValue: 18.5 })}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(field().value).toBe("18.5");
    await user.clear(field());
    await user.type(field(), "17");
    await user.click(save());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.anything(), 17));
  });
});
