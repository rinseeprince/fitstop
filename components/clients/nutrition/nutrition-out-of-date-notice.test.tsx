import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionOutOfDateNotice } from "./nutrition-out-of-date-notice";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const TODAY = "2026-09-23";

const fromToday: NutritionOutOfDate = {
  versionId: "v-run",
  fromDay: TODAY,
  built: { goalWeightKg: 80, deadline: "2026-10-01" },
  goal: { goalWeightKg: 81.5, deadline: "2026-11-09" },
};

const fromLater: NutritionOutOfDate = {
  versionId: "v-run",
  fromDay: "2026-10-19",
  built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
  goal: { goalWeightKg: 84.2, deadline: null },
};

beforeEach(() => {
  cleanup();
  units.preference = "metric";
});

describe("NutritionOutOfDateNotice", () => {
  it("a problem from today says the goal changed, what it was and is, and offers Regenerate", () => {
    const onRegenerate = vi.fn();
    const onSetFrom = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={fromToday}
        clientToday={TODAY}
        onRegenerate={onRegenerate}
        onSetFrom={onSetFrom}
      />
    );

    expect(screen.getByText("Goal changed since these targets were built.")).toBeInTheDocument();
    expect(screen.getByText("80.0 kg by 1 Oct → 81.5 kg by 9 Nov")).toBeInTheDocument();
    screen.getByRole("button", { name: "Regenerate" }).click();
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onSetFrom).not.toHaveBeenCalled();
  });

  it("a later day's problem names the day and offers Set nutrition from it", () => {
    const onRegenerate = vi.fn();
    const onSetFrom = vi.fn();
    render(
      <NutritionOutOfDateNotice
        outOfDate={fromLater}
        clientToday={TODAY}
        onRegenerate={onRegenerate}
        onSetFrom={onSetFrom}
      />
    );

    expect(
      screen.getByText("The targets from 19 Oct weren't built for that day's goal.")
    ).toBeInTheDocument();
    expect(screen.getByText("81.5 kg by 9 Nov → 84.2 kg, no deadline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(onSetFrom).toHaveBeenCalledWith("2026-10-19");
  });

  it("in the drawer, whose own button regenerates, today's problem moves Starts on instead", () => {
    const onSetFrom = vi.fn();
    render(<NutritionOutOfDateNotice outOfDate={fromToday} clientToday={TODAY} onSetFrom={onSetFrom} />);

    screen.getByRole("button", { name: "Set nutrition from 23 Sept" }).click();
    expect(onSetFrom).toHaveBeenCalledWith(TODAY);
  });

  it("with nothing to do — the drawer already on the day — it only says so", () => {
    render(<NutritionOutOfDateNotice outOfDate={fromLater} clientToday={TODAY} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads no weight target as maintenance, and follows the coach's unit", () => {
    units.preference = "imperial";
    render(
      <NutritionOutOfDateNotice
        outOfDate={{ ...fromLater, goal: { goalWeightKg: null, deadline: "2027-01-15" } }}
        clientToday={TODAY}
      />
    );
    // 81.5 kg is 179.7 lbs; a goal with no weight target prices maintenance.
    expect(screen.getByText("179.7 lbs by 9 Nov → Maintenance")).toBeInTheDocument();
  });
});
