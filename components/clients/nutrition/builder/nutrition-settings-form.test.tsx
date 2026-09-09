import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { NutritionSettingsForm } from "./nutrition-settings-form";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const CLIENT_TODAY = "2026-07-02";
const RUNS_UNTIL = /Targets are already queued for/;
const REPLACES = /This replaces the targets queued for/;

// `Partial` of a required prop would type each override as possibly undefined,
// so the overrides are a plain subset: every key given is given in full.
type FormOverrides = {
  [K in keyof ComponentProps<typeof NutritionSettingsForm>]?: ComponentProps<
    typeof NutritionSettingsForm
  >[K];
};

function renderForm(overrides: FormOverrides = {}) {
  const onEffectiveFromChange = vi.fn();
  render(
    <NutritionSettingsForm
      tdee={2400}
      proteinTargetGPerKg={2.0}
      dietType="balanced"
      onSettingsChange={vi.fn()}
      effectiveFrom={CLIENT_TODAY}
      clientToday={CLIENT_TODAY}
      startFloor={CLIENT_TODAY}
      clientName="Alex Doe"
      queuedChangeDate={null}
      onEffectiveFromChange={onEffectiveFromChange}
      {...overrides}
    />,
  );
  return { onEffectiveFromChange };
}

// The day the plan takes effect is a drawer setting picked BEFORE the save
// (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D26) — no dialog stands between
// Generate and the save any more.
describe("NutritionSettingsForm — Starts on", () => {
  beforeEach(cleanup);

  it("floors the field at the start floor — the server's belt, as an affordance", () => {
    renderForm();
    expect(screen.getByLabelText("Starts on")).toHaveAttribute("min", CLIENT_TODAY);
  });

  // The floor is the shared deletion floor (commit B): today, or tomorrow once
  // the client has logged today. A greyed-out today with no explanation is
  // worse than an error, so the field says why.
  describe("the logged-today line", () => {
    const TOMORROW = "2026-07-03";

    it("floors at the deletion floor and says who logged which day, and when targets can start", () => {
      renderForm({ startFloor: TOMORROW, effectiveFrom: TOMORROW });
      expect(screen.getByLabelText("Starts on")).toHaveAttribute("min", TOMORROW);
      // en-AU spells July in full (June/July/Sept are the four-letter months).
      expect(screen.getByText(/has already logged/)).toHaveTextContent(
        "Alex Doe has already logged 2 July. Targets can start from 3 July."
      );
    });

    it("says nothing while the floor is today", () => {
      renderForm();
      expect(screen.queryByText(/has already logged/)).toBeNull();
    });
  });

  it("shows the day it was given — the client's today until the coach picks", () => {
    renderForm();
    expect(screen.getByLabelText("Starts on")).toHaveValue(CLIENT_TODAY);
  });

  it("hands a pick up to the hook, which owns the setting", () => {
    const { onEffectiveFromChange } = renderForm();
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-07-23" } });
    expect(onEffectiveFromChange).toHaveBeenCalledWith("2026-07-23");
  });

  it("renders empty, with no floor, until the resolved inputs have loaded", () => {
    renderForm({ effectiveFrom: null, clientToday: null, startFloor: null });
    const field = screen.getByLabelText("Starts on");
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("min");
  });

  // The queued-change line (migration 166): a save dated BEFORE a queued
  // version runs until the day before it and leaves it standing; a save dated
  // ON it replaces it in place. Inform, never block — one sentence says which,
  // then the save does what was asked.
  describe("the queued-change line", () => {
    const QUEUED = "2026-07-12";

    it("a pick BEFORE the queued change says these targets run until the day before it", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-02" });
      expect(screen.getByText(RUNS_UNTIL)).toHaveTextContent("12 Jul");
      expect(screen.queryByText(REPLACES)).toBeNull();
    });

    it("a pick ON the queued date says it replaces those targets", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: QUEUED });
      expect(screen.getByText(REPLACES)).toHaveTextContent("12 Jul");
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
    });

    it("a pick after the queued change shows neither", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-13" });
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
      expect(screen.queryByText(REPLACES)).toBeNull();
    });

    it("nothing queued shows neither", () => {
      renderForm({ queuedChangeDate: null, effectiveFrom: "2026-07-02" });
      expect(screen.queryByText(RUNS_UNTIL)).toBeNull();
      expect(screen.queryByText(REPLACES)).toBeNull();
    });
  });
});
