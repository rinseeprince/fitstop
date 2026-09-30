import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-saved-plans-summary", () => ({
  useSavedPlansSummary: () => ({ summary: null, isLoading: true }),
}));
vi.mock("@/hooks/use-saved-plan-assignments", () => ({
  useSavedPlanAssignments: () => ({ assignments: null, isLoading: true }),
}));

import { StatBand } from "./stat-band";
import { ProgramsStatBand } from "../programs-stat-band";
import { RosterStatBand } from "@/components/clients/roster/roster-stat-band";

afterEach(() => cleanup());

const band = (container: HTMLElement) => container.querySelector('[data-slot="stat-band"]') as HTMLElement;
const subLines = (container: HTMLElement) => band(container).querySelectorAll("span.mt-1");

describe("StatBand", () => {
  // Animation marks arrival (docs/newdesignsystem.md): a band on a client-page
  // tab is not arrived at, so the shared band enters on no surface by itself.
  it("carries no entrance of its own", () => {
    const { container } = render(<StatBand cells={[{ label: "This week", value: "8/13" }]} />);
    expect(band(container).className).not.toContain("animate-card-in");
  });

  it("holds a pending cell's sub line, so the band does not grow when its words land", () => {
    const { container } = render(<StatBand cells={[{ label: "Total programs", value: "—", pending: true }]} />);
    expect(subLines(container)).toHaveLength(1);
  });

  it("holds no line for a cell that has none, pending or settled, so the band does not shrink when its value lands", () => {
    const { container, rerender } = render(<StatBand cells={[{ label: "Habits", value: "—", pending: true, sub: null }]} />);
    expect(subLines(container)).toHaveLength(0);
    rerender(<StatBand cells={[{ label: "Habits", value: "3", sub: null }]} />);
    expect(subLines(container)).toHaveLength(0);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("the arrival surfaces animate their own band", () => {
  it("the Programs page's band enters", () => {
    const { container } = render(<ProgramsStatBand />);
    expect(band(container).parentElement?.className).toContain("animate-card-in");
  });

  it("the roster's band enters", () => {
    const { container } = render(
      <RosterStatBand rows={[]} counts={{ all: 0, active: 0, onboarding: 0, inactive: 0, overdue: 0, review: 0 }} />
    );
    expect(band(container).parentElement?.className).toContain("animate-card-in");
  });
});
