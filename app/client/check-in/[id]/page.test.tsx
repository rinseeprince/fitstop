import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import CheckInDetailPage from "./page";

// The client's own sent check-in: its Training & Nutrition card shows the
// habit days the check-in froze (docs/HABITS-REBUILD-PLAN.md §6, commit 6),
// from `habits` on GET /api/client/check-ins/[id].

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "ci-1" }),
}));
vi.mock("@/contexts/units-context", () => ({ useUnits: () => ({ preference: "metric" }) }));

function serve(checkIn: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { id: "ci-1", clientId: "c-1", status: "pending", createdAt: "2026-09-30T18:00:00Z", ...checkIn },
          }),
          { status: 200 }
        )
      )
    )
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the client's sent check-in — its habit days", () => {
  it("shows the habit days met over the days planned, as the check-in froze them", async () => {
    serve({ habits: { met: 11, planned: 13 } });
    render(<CheckInDetailPage />);

    expect(await screen.findByText("11/13 habit days done")).toBeInTheDocument();
    expect(screen.getByText("Habits")).toBeInTheDocument();
  });

  it("says nothing of habits for a week that planned none, or a check-in whose copy holds no week", async () => {
    serve({ habits: { met: 0, planned: 0 }, prs: "First pull-up" });
    render(<CheckInDetailPage />);
    expect(await screen.findByText("First pull-up")).toBeInTheDocument();
    expect(screen.queryByText("Habits")).not.toBeInTheDocument();
    cleanup();

    serve({ habits: null, prs: "First pull-up" });
    render(<CheckInDetailPage />);
    expect(await screen.findByText("First pull-up")).toBeInTheDocument();
    expect(screen.queryByText(/habit days done/)).not.toBeInTheDocument();
  });
});
