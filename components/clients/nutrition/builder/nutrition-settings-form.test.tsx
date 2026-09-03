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
const WARNING = /This replaces the change queued for/;

function renderForm(overrides: Partial<ComponentProps<typeof NutritionSettingsForm>> = {}) {
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

// The day the plan takes effect is a drawer setting picked BEFORE the save
// (docs/MEASUREMENT-LOG-PLAN.md commit 8bb, D26) — no dialog stands between
// Generate and the save any more.
describe("NutritionSettingsForm — Starts on", () => {
  beforeEach(cleanup);

  it("floors the field at the CLIENT's today — the server's past-date belt, as an affordance", () => {
    renderForm();
    expect(screen.getByLabelText("Starts on")).toHaveAttribute("min", CLIENT_TODAY);
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
    renderForm({ effectiveFrom: null, clientToday: null });
    const field = screen.getByLabelText("Starts on");
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("min");
  });

  // The absorb warning (migration 144): a save dated on or before a queued
  // version's start replaces that version. Warn, never block — the same
  // sentence the save-time dialog used to carry, now under the field.
  describe("the absorb warning", () => {
    const QUEUED = "2026-07-12";

    it("shows for a pick before the queued change", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-02" });
      expect(screen.getByText(WARNING)).toHaveTextContent("12 Jul");
    });

    it("shows for a pick ON the queued date — a same-day save absorbs too", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: QUEUED });
      expect(screen.getByText(WARNING)).toBeInTheDocument();
    });

    it("does not show for a pick after the queued change", () => {
      renderForm({ queuedChangeDate: QUEUED, effectiveFrom: "2026-07-13" });
      expect(screen.queryByText(WARNING)).toBeNull();
    });

    it("does not show with nothing queued", () => {
      renderForm({ queuedChangeDate: null, effectiveFrom: "2026-07-02" });
      expect(screen.queryByText(WARNING)).toBeNull();
    });
  });
});
