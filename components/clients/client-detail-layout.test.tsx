import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientDetailLayout } from "./client-detail-layout";
import { CLIENT_TABS } from "@/lib/client-tabs";

// The header's three controls each reach auth, SWR or a portal. None of them is
// what this file is about — the invariant under test is that the FRAME does not
// wait on the client record — so they are stubbed down to markers.
vi.mock("@/components/coach/pin-intake-button", () => ({
  PinIntakeButton: () => null,
}));
vi.mock("@/components/clients/invite-client-dialog", () => ({
  InviteClientDialog: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}));
// The rail reaches auth, the router and SWR. Whether the LAYOUT keeps it
// outside the loading branch is the question here, so it is a marker.
vi.mock("@/components/collapsed-icon-strip", () => ({
  CollapsedIconStrip: () => <aside data-testid="rail" />,
}));

const CLIENT = { id: "c-1", name: "Sam Doe", email: "sam@example.com" };
/** What the page passes before the record lands (`client ?? {…name: ""}`). */
const UNRESOLVED = { id: "c-1", name: "", email: "" };

function renderLayout(props: Partial<React.ComponentProps<typeof ClientDetailLayout>> = {}) {
  return render(
    <ClientDetailLayout
      client={CLIENT}
      activeTab="overview"
      onTabChange={vi.fn()}
      {...props}
    >
      <p>tab content</p>
    </ClientDetailLayout>
  );
}

/**
 * Which of these actually guards the invariant, stated because it is not
 * obvious: **"names what it is waiting for"** is the regression test. jsdom
 * loads no stylesheet, so a Tailwind `opacity-0` on the frame leaves every
 * element in the document and every query below still passes — the three
 * structural tests document intent and would NOT catch a re-added visual gate.
 * Mutation-checked both ways. The visual half belongs to the browser smoke; a
 * `not.toHaveClass("opacity-0")` assertion was considered and rejected, since
 * it would guard one spelling of the mistake and imply cover for `hidden`,
 * `visibility` and Suspense, which it has not got.
 *
 * "keeps the application rail outside the loading branch" is the other real
 * guard: the loader is a branch, so a rail rendered beside it is a structural
 * fact, not a class. Mutation-checked by moving the rail into the loaded arm.
 */
describe("ClientDetailLayout", () => {
  it("renders the whole tab list while the client record is still loading", () => {
    // The invariant: navigating to a client shows you where you are and lets
    // you move, before the record arrives. The frame is derivable from the URL.
    renderLayout({ client: UNRESOLVED, isLoading: true });

    // By role, not by text: the active tab's label is also the page heading.
    for (const tab of CLIENT_TABS) {
      expect(screen.getByRole("button", { name: tab.label })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Back to clients")).toBeInTheDocument();
  });

  it("names what it is waiting for instead of showing an empty column", () => {
    renderLayout({ client: UNRESOLVED, isLoading: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading client…")).toBeInTheDocument();
    expect(screen.queryByText("tab content")).not.toBeInTheDocument();
  });

  it("titles the frame from the active tab, not from the record", () => {
    // `?tab=` is in the URL, so the title is known before the fetch settles.
    renderLayout({ client: UNRESOLVED, activeTab: "daily-habits", isLoading: true });

    expect(screen.getByRole("heading", { name: "Habits" })).toBeInTheDocument();
  });

  it("keeps the application rail outside the loading branch", () => {
    // Content loading must never take the chrome with it (ARCHITECTURE →
    // "Coach route group"). The rail is this shell's, mounted beside the
    // column; `isLoading` decides only what fills the column.
    renderLayout({ client: UNRESOLVED, isLoading: true });

    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hands the column to the tab once the record resolves", () => {
    renderLayout({ isLoading: false });

    expect(screen.getByText("tab content")).toBeInTheDocument();
    expect(screen.queryByText("Loading client…")).not.toBeInTheDocument();
    expect(screen.getByText("Sam Doe")).toBeInTheDocument();
  });
});
