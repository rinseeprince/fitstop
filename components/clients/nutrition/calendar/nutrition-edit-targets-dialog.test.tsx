import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NutritionEvent } from "@/types/check-in";
import { resolveSelectedEvents } from "@/utils/nutrition-range-edit-model";
import { gramsToSplit, splitToGrams } from "@/lib/nutrition/macro-balance";
import { NutritionEditTargetsDialog } from "./nutrition-edit-targets-dialog";

// jsdom doesn't implement the APIs the balancer's Radix Slider needs to render.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function ev(date: string, overrides: Partial<NutritionEvent> = {}): NutritionEvent {
  return {
    id: date,
    clientId: "c1",
    nutritionPlanId: "np-1",
    date,
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

function resolve(events: NutritionEvent[]) {
  return resolveSelectedEvents(
    events.map((e) => e.date),
    new Map(events.map((e) => [e.date, e])),
    true,
    false
  );
}

beforeEach(() => cleanup());

// The dialog is the macro balancer and nothing else: "Adjust by" (a percent or
// kcal delta scaled per day) was removed on 2026-09-10, and with it the tab
// switcher — there is one edit, so there is nothing to switch between. It is a
// centred modal sized to its content, carrying the plan generator's hero.
describe("NutritionEditTargetsDialog — one edit, the balancer", () => {
  it("opens as a modal on the balancer over the first selected day, with no tab switcher and no Adjust by", () => {
    const days = resolve([ev("2026-06-01"), ev("2026-06-02", { baselineCalories: 2200 })]);
    render(
      <NutritionEditTargetsDialog open onOpenChange={vi.fn()} days={days} isSaving={false} onApply={vi.fn()} />
    );

    expect(screen.getByRole("dialog", { name: "Edit targets" })).toBeInTheDocument();
    expect(screen.getByText("2 days selected")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Carbs and fat boundary" })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>("Calories").value).toBe("2000");
    expect(screen.getByText(/Selected days currently range/)).toBeInTheDocument();
    expect(screen.queryByText("Adjust by")).toBeNull();
    expect(screen.queryByText("Set targets")).toBeNull();
    expect(screen.queryByText(/Hold protein steady/)).toBeNull();
    // The note sits beside the balancer, one field for the whole selection.
    expect(screen.getByLabelText(/^Note/)).toHaveAttribute("placeholder", "Applies one note to every selected day");
    // The generator's hero: the built-in close is off and the dark band
    // carries exactly one labelled close of its own.
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("the close on the hero dismisses the dialog, but not while a save is in flight", () => {
    const days = resolve([ev("2026-06-01")]);
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <NutritionEditTargetsDialog open onOpenChange={onOpenChange} days={days} isSaving={false} onApply={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    unmount();

    const blocked = vi.fn();
    render(
      <NutritionEditTargetsDialog open onOpenChange={blocked} days={days} isSaving onApply={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(blocked).not.toHaveBeenCalled();
  });

  it("Apply sends the target and the grams its split derives — one payload for every selected day", () => {
    const days = resolve([ev("2026-06-01"), ev("2026-06-02")]);
    const onApply = vi.fn();
    render(
      <NutritionEditTargetsDialog open onOpenChange={vi.fn()} days={days} isSaving={false} onApply={onApply} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 days" }));

    const split = gramsToSplit({ proteinG: 150, carbG: 200, fatG: 60 });
    expect(onApply).toHaveBeenCalledWith({
      mode: "absolute",
      calories: 2000,
      ...splitToGrams(2000, split),
    });
  });

  it("Apply stays disabled with no calorie target", () => {
    const days = resolve([ev("2026-06-01")]);
    render(
      <NutritionEditTargetsDialog open onOpenChange={vi.fn()} days={days} isSaving={false} onApply={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Calories"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Apply to 1 day" })).toBeDisabled();
  });
});
