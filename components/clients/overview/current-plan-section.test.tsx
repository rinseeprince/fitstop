import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CurrentPlanSection } from "./current-plan-section";

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the Overview's out-of-date line opens
// the Nutrition tab's drawer in ONE navigation — the tab, the Plans pane and the
// drawer's one-shot open, with the day when the line names one.

const nutritionCard = vi.hoisted(() => ({
  props: null as null | { clientId: string; onOpenNutritionDrawer: (startsOn?: string) => void },
}));
vi.mock("./plan-training-card", () => ({ PlanTrainingCard: () => null }));
vi.mock("./plan-nutrition-card", () => ({
  PlanNutritionCard: (props: { clientId: string; onOpenNutritionDrawer: (startsOn?: string) => void }) => {
    nutritionCard.props = props;
    return null;
  },
}));

beforeEach(() => {
  cleanup();
  nutritionCard.props = null;
});

describe("CurrentPlanSection — the nutrition card's way into the drawer", () => {
  it("Regenerate opens the drawer on the Plans pane from today; Set nutrition from carries the day", () => {
    const onTabChange = vi.fn();
    render(<CurrentPlanSection clientId="client-7" summary={null} isLoading={false} onTabChange={onTabChange} />);

    expect(nutritionCard.props?.clientId).toBe("client-7");

    nutritionCard.props?.onOpenNutritionDrawer();
    expect(onTabChange).toHaveBeenLastCalledWith("nutrition", { nutrition: "plans", edit: "1" });

    nutritionCard.props?.onOpenNutritionDrawer("2026-10-19");
    expect(onTabChange).toHaveBeenLastCalledWith("nutrition", {
      nutrition: "plans",
      edit: "1",
      startsOn: "2026-10-19",
    });
    expect(onTabChange).toHaveBeenCalledTimes(2);
  });
});
