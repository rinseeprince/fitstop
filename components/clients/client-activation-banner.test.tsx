import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Client } from "@/types/check-in";
import type { Readiness } from "@/lib/activation-readiness-items";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown) => mockUseSWR(key),
}));
// The dialog reaches toasts and date state; the question HERE is whether the
// banner mounts it, and only once readiness exists — so it is a marker that
// still renders its trigger.
vi.mock("@/components/coach/client-activation-dialog", () => ({
  ClientActivationDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="activation-dialog">{trigger}</div>
  ),
}));

import { ClientActivationBanner } from "./client-activation-banner";

// Energy fields deliberately absent, so findProfileGaps (real and pure)
// reports gaps — the Client-profile row must have a live synchronous state
// while everything readiness-backed is still pending.
const CLIENT = {
  id: "c-1",
  name: "Sam Doe",
  email: "sam@example.com",
  onboardingStatus: "setup_in_progress",
} as Client;

function wire(state: {
  data?: { success: boolean; data: Readiness };
  isLoading: boolean;
}) {
  mockUseSWR.mockReturnValue(state);
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

/**
 * The lifecycle under test is CONVENTIONS §7 "Gate content, not structure":
 * whether this card exists is `onboardingStatus` (synchronous, already on the
 * record); the readiness read decides only what the slots say. The in-flight
 * test is the regression guard — mutation-checked by restoring `isLoading ||`
 * to the gate, which empties it.
 */
describe("ClientActivationBanner", () => {
  it("mounts with the page and renders readiness as pending, not absent", () => {
    wire({ isLoading: true });
    render(<ClientActivationBanner client={CLIENT} />);

    expect(
      screen.getByRole("heading", { name: "Ready to activate" })
    ).toBeInTheDocument();
    // No slot claims a state it does not have yet…
    expect(screen.queryByText(/of 3 plans ready/)).toBeNull();
    expect(screen.queryByText("Not set up")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
    // …while the one synchronous row is already live…
    expect(screen.getByText(/^Add /)).toBeInTheDocument();
    // …and the action holds its box but cannot open a dialog that needs a
    // resolved Readiness.
    expect(
      screen.getByRole("button", { name: /Activate client/ })
    ).toBeDisabled();
    expect(screen.queryByTestId("activation-dialog")).toBeNull();
  });

  it("renders nothing for a client who is not in setup", () => {
    wire({ isLoading: true });
    const { container } = render(
      <ClientActivationBanner
        client={{ ...CLIENT, onboardingStatus: "active" }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("fills the slots when readiness lands", () => {
    wire({
      isLoading: false,
      data: {
        success: true,
        data: { hasTrainingPlan: true, hasNutritionPlan: false, hasHabits: false },
      },
    });
    render(<ClientActivationBanner client={CLIENT} />);

    expect(screen.getByText("1 of 3 plans ready")).toBeInTheDocument();
    expect(screen.getAllByText("Not set up")).toHaveLength(2);
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Activating now sends the training plan through/)
    ).toBeInTheDocument();
    expect(screen.getByTestId("activation-dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Activate client/ })
    ).toBeEnabled();
  });

  it("hides the card when the read settles with nothing, exactly as before", () => {
    wire({ isLoading: false });
    const { container } = render(<ClientActivationBanner client={CLIENT} />);
    expect(container.firstChild).toBeNull();
  });
});
