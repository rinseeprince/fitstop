import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const { timezoneSync } = vi.hoisted(() => ({ timezoneSync: vi.fn() }))

vi.mock("@/hooks/use-timezone-sync", () => ({
  useTimezoneSync: (...args: unknown[]) => timezoneSync(...args),
}))
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ coach: { timezone: "Europe/London" } }),
}))
vi.mock("@/components/check-in-notification-listener", () => ({
  CheckInNotificationListener: () => <div data-testid="check-in-listener" />,
}))
vi.mock("@/components/coach/coach-history-tracker", () => ({
  CoachHistoryTracker: () => <div data-testid="history-tracker" />,
}))

import CoachLayout from "./layout"

describe("CoachLayout", () => {
  it("renders the page inside the coach boundary", () => {
    render(
      <CoachLayout>
        <p>page</p>
      </CoachLayout>
    )
    expect(screen.getByText("page")).toBeInTheDocument()
  })

  it("mounts the check-in notification listener on every coach page", () => {
    render(
      <CoachLayout>
        <p>page</p>
      </CoachLayout>
    )
    expect(screen.getByTestId("check-in-listener")).toBeInTheDocument()
  })

  it("runs coach timezone sync against the resolved profile", () => {
    // The sync has no DOM and no error path: if the layout stops mounting it,
    // nothing fails and the stored zone silently goes stale. This is the guard.
    render(
      <CoachLayout>
        <p>page</p>
      </CoachLayout>
    )
    expect(timezoneSync).toHaveBeenCalledWith("coach", "Europe/London")
  })

  it("mounts the history tracker on every coach page", () => {
    // The count every back arrow reads runs at the boundary, not in a shell:
    // an arrow on a page whose shell forgot it would always go Up.
    render(
      <CoachLayout>
        <p>page</p>
      </CoachLayout>
    )
    expect(screen.getByTestId("history-tracker")).toBeInTheDocument()
  })
})
