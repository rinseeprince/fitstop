import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import {
  ROSTER_VIEWS,
  rosterViewLabel,
  rosterViewNavLabel,
  type RosterCounts,
} from "@/lib/roster-views";

// The frame's contract is what is under test — which slots wait for the view
// and which never do — so the rail and the data-heavy leaves are markers.
vi.mock("@/components/collapsed-icon-strip", () => ({
  CollapsedIconStrip: () => <aside data-testid="rail" />,
}));
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}));
vi.mock("@/components/add-client-dialog", () => ({
  AddClientDialog: () => null,
}));
vi.mock("./roster-stat-band", () => ({
  RosterStatBand: () => null,
}));
vi.mock("./roster-table", () => ({
  RosterTable: ({ view }: { view: string }) => (
    <div data-testid="roster-table" data-view={view} />
  ),
}));

import { RosterFrame } from "./roster-frame";

const COUNTS = Object.fromEntries(
  ROSTER_VIEWS.map((view) => [view.value, 0])
) as RosterCounts;

function renderFrame(props: Partial<React.ComponentProps<typeof RosterFrame>> = {}) {
  return render(
    <RosterFrame
      view="all"
      rows={[]}
      counts={COUNTS}
      isLoading={false}
      isError={false}
      onRosterChanged={vi.fn()}
      {...props}
    />
  );
}

/**
 * `view: null` is what static prerendering emits (the page's Suspense
 * fallback), so the null tests describe the HTML a hard load starts from:
 * the full surface in its pending state — never a blank, never a guess.
 * Mutation-checked by resolving null to "all" inside the frame: the
 * no-highlight and no-table assertions fail on it.
 */
describe("RosterFrame", () => {
  it("renders the full surface with the view not yet known", () => {
    renderFrame({ view: null });

    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Clients" })).toBeInTheDocument();
    // Every view is offered, none is claimed: the fallback must not pretend
    // to know where the coach is.
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-table")).toBeNull();
  });

  it("titles and highlights the resolved view, and hands it to the table", () => {
    renderFrame({ view: "review" });

    expect(
      screen.getByRole("heading", { name: rosterViewLabel("review") })
    ).toBeInTheDocument();
    const active = screen.getByRole("link", { current: "page" });
    expect(
      within(active).getByText(rosterViewNavLabel("review"))
    ).toBeInTheDocument();
    expect(screen.getByTestId("roster-table")).toHaveAttribute(
      "data-view",
      "review"
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the loading state while data is in flight even with the view resolved", () => {
    renderFrame({ isLoading: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-table")).toBeNull();
  });

  it("reports a failed roster and retries through the shared handler", () => {
    const onRosterChanged = vi.fn();
    renderFrame({ isError: true, onRosterChanged });

    expect(screen.getByText("Could not load your clients")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRosterChanged).toHaveBeenCalledTimes(1);
  });
});
