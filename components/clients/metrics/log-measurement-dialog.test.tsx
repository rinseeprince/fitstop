import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LogMeasurementDialog } from "./log-measurement-dialog";
import type { MetricSummary } from "./metrics-view-types";
import type { UnitSystem } from "@/utils/unit-conversions";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";

// The dialog reaches useUnits() -> auth-context -> the browser Supabase client,
// which throws without env vars. Same mock ~20 other suites carry since Phase 3.
const preference = { current: "metric" as UnitSystem };
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: preference.current, isLoading: false, error: undefined }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function metric(overrides: Partial<MetricSummary> = {}): MetricSummary {
  return {
    id: "weight",
    name: "Weight",
    tab: "body",
    unit: "kg",
    points: [],
    latest: null,
    first: null,
    entryCount: 0,
    totalChange: null,
    startsOn: null,
    avgRate: null,
    change30d: null,
    week: null,
    goal: null,
    goalToGo: null,
    best: null,
    ...overrides,
  } as MetricSummary;
}

const METRICS: MetricSummary[] = [
  metric(),
  metric({ id: "waist", name: "Waist", unit: "cm" }),
  metric({ id: "sleep", name: "Sleep", tab: "wellness", unit: "/10" }),
];

type SubmitSpy = Mock<(input: CreateMetricEntryRequest) => Promise<void>>;

const submitSpy = (): SubmitSpy =>
  vi.fn<(input: CreateMetricEntryRequest) => Promise<void>>().mockResolvedValue(
    undefined,
  );

async function logValue(
  initialMetricId: string,
  typed: string,
  onSubmit: SubmitSpy,
) {
  render(
    <LogMeasurementDialog
      open
      onOpenChange={vi.fn()}
      metrics={METRICS}
      initialMetricId={initialMetricId}
      onSubmit={onSubmit}
    />,
  );

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Value"), typed);
  const submit = screen.getByRole("button", { name: /log entry/i });
  if (!submit.hasAttribute("disabled")) await user.click(submit);
  return submit;
}

describe("LogMeasurementDialog", () => {
  beforeEach(() => {
    preference.current = "metric";
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("an imperial coach", () => {
    beforeEach(() => {
      preference.current = "imperial";
    });

    // The defect: this dialog has always LABELLED its input in the viewer's
    // unit but submitted the typed number verbatim, so 180 lbs was stored as
    // 180 kilograms — under a label that said lbs and a chart that read it back
    // as kg. The label was right and the write was wrong.
    it("stores a typed weight as kilograms, not as the pounds that were typed", async () => {
      const onSubmit = submitSpy();
      await logValue("weight", "180", onSubmit);

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const { value, metricKey } = onSubmit.mock.calls[0][0];
      expect(metricKey).toBe("weight");
      expect(value).toBeCloseTo(81.6466, 4);
      expect(value).not.toBe(180);
    });

    it("stores a typed girth as centimetres", async () => {
      const onSubmit = submitSpy();
      await logValue("waist", "34", onSubmit);

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0].value).toBeCloseTo(86.36, 4);
    });

    it("leaves an unitless wellness score alone", async () => {
      const onSubmit = submitSpy();
      await logValue("sleep", "8", onSubmit);

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0].value).toBe(8);
    });

    // METRIC_VALUE_RANGES is kilograms, so validating the TYPED string would
    // compare 180 lbs against a 20-250 kg bound and wave it through — while
    // 600 lbs (272 kg) would be accepted as "under 700" under the old range.
    it("judges the range against the converted value", async () => {
      const onSubmit = submitSpy();
      const submit = await logValue("weight", "600", onSubmit);

      expect(submit).toBeDisabled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("accepts a weight that is only in range once converted", async () => {
      const onSubmit = submitSpy();
      // 300 lb = 136 kg: in range as kilograms, out of range if read as kg.
      await logValue("weight", "300", onSubmit);

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0].value).toBeCloseTo(136.078, 3);
    });
  });

  describe("a metric coach", () => {
    it("is an identity path — the typed kilograms are stored", async () => {
      const onSubmit = submitSpy();
      await logValue("weight", "82.5", onSubmit);

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0].value).toBe(82.5);
    });

    it("still rejects a weight above the kg ceiling", async () => {
      const onSubmit = submitSpy();
      const submit = await logValue("weight", "300", onSubmit);

      expect(submit).toBeDisabled();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
