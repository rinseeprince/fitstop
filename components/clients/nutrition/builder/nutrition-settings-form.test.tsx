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
      queuedChangeDate={null}
      onEffectiveFromChange={onEffectiveFromChange}
      {...overrides}
    />,
  );
  return { onEffectiveFromChange };
}

const startsOn = () => screen.getByLabelText("Starts on");

// The day the plan takes effect is a drawer setting picked BEFORE the save
// (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D26) — no dialog stands between
// Generate and the save any more.
describe("NutritionSettingsForm — Starts on", () => {
  beforeEach(cleanup);

  it("floors the field at the client's today — the server's past-date belt, as an affordance", () => {
    renderForm();
    expect(startsOn()).toHaveAttribute("min", CLIENT_TODAY);
  });

  // Owner, 2026-09-11: today is the coach's to replace whatever the client has
  // logged — a logged today is re-recorded onto their log by the save — so the
  // field carries no floor line and greys nothing past today. The deletion
  // floor is training's; it never reaches this form.
  it("says nothing about the client's logs, and never greys today", () => {
    renderForm({ effectiveFrom: CLIENT_TODAY });
    expect(startsOn()).toHaveAttribute("min", CLIENT_TODAY);
    expect(screen.queryByText(/has already logged/)).toBeNull();
    expect(screen.queryByText(/can start from/)).toBeNull();
  });

  it("shows the day it was given — the client's today until the coach picks", () => {
    renderForm();
    expect(startsOn()).toHaveValue(CLIENT_TODAY);
  });

  it("hands a pick up to the hook, which owns the setting", () => {
    const { onEffectiveFromChange } = renderForm();
    fireEvent.change(startsOn(), { target: { value: "2026-07-23" } });
    expect(onEffectiveFromChange).toHaveBeenCalledWith("2026-07-23");
  });

  it("renders empty, with no floor, until the resolved inputs have loaded", () => {
    renderForm({
      effectiveFrom: null,
      clientToday: null,
    });
    const field = startsOn();
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("min");
    expect(field).toBeEnabled();
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

// The start is a plain date field (SD6, docs/SUNSET-PLAN.md): no Block field
// above it, never disabled, floored at the client's today with no ceiling.
describe("NutritionSettingsForm — the start field", () => {
  beforeEach(cleanup);

  it("has no Block field, and the date is the coach's own", () => {
    renderForm();
    expect(screen.queryByLabelText("Block")).toBeNull();
    expect(startsOn()).toBeEnabled();
    expect(startsOn()).toHaveAttribute("min", CLIENT_TODAY);
    expect(startsOn()).not.toHaveAttribute("max");
  });
});
