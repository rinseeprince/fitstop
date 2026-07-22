import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { TrainingPlanHero } from "./training-plan-hero";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));

const SUMMARY = {
  success: true,
  data: { completed: 3, plannedUpToToday: 4, totalPlanned: 5, missed: 1 },
};

function renderHero(props: Partial<Parameters<typeof TrainingPlanHero>[0]> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TrainingPlanHero clientId="client-1" {...props} />
    </SWRConfig>,
  );
}

describe("TrainingPlanHero", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(SUMMARY),
      } as Response),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the empty branch with the library CTA on the sanctioned hover pair", () => {
    ctx.value = { plan: null };
    const onOpenGenerator = vi.fn();
    const { container } = renderHero({ onOpenGenerator });

    expect(screen.getByText("No training plan yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Browse programs/ }),
    ).toBeInTheDocument();
    // The old empty hero invented hover:bg-[#0f766e]; the fix pins #0b7f75.
    expect(container.innerHTML).not.toContain("0f766e");
    expect(container.innerHTML).toContain("0b7f75");
  });

  it("renders the plan branch with the mono week stats from the summary endpoint", async () => {
    ctx.value = {
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4, programDurationWeeks: 8 },
    };
    renderHero({ onOpenGenerator: vi.fn() });

    expect(screen.getByText("PPL")).toBeInTheDocument();
    expect(screen.getByText("Training plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply program/ }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3/4")).toBeInTheDocument());
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("renders the Edit-plan primary only when onEditPlan is provided (Job 2 seam)", () => {
    ctx.value = { plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 } };
    renderHero();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    cleanup();

    renderHero({ onEditPlan: vi.fn() });
    expect(screen.getByRole("button", { name: /Edit plan/ })).toBeInTheDocument();
  });
});
