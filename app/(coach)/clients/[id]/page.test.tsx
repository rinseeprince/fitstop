import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react"

// The URL contract at the host, with the router mocked and the real sidebar
// driven: a tab change pushes, a same-tab address replaces, a tab change that
// completes a flow replaces, and the arrow LEAVES the page — to the entry
// before it began when a coach page precedes it, to the clients list when
// the page began the count (ARCHITECTURE → "Client page tab structure").
const { push, replace, leave, search, coachHistory, clientState } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  leave: vi.fn(),
  search: { current: new URLSearchParams("tab=overview") },
  coachHistory: { current: false },
  clientState: {
    current: {
      client: { id: "c-1", name: "Sam Doe", email: "sam@example.com" } as unknown,
      isLoading: false,
      isError: false,
      mutate: vi.fn(),
    },
  },
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c-1" }),
  useSearchParams: () => search.current,
  useRouter: () => ({ push, replace }),
}))
// jsdom cannot navigate; a plain anchor keeps the href observable.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/coach-history", () => ({
  hasEntryBeforePage: () => coachHistory.current,
  leaveCoachPage: leave,
}))
vi.mock("@/hooks/use-check-in-data", () => ({
  useClient: () => clientState.current,
}))

// The tabs are the siblings under their own tests; this file is about the
// page's navigation, so each is a marker. The Check-ins marker exposes the
// same-tab return the real tab makes after a reply is sent, and the
// flow-completing tab change the Training tab makes after an apply.
vi.mock("@/components/clients/client-overview-tab", () => ({
  ClientOverviewTab: () => <div data-testid="tab-overview" />,
}))
vi.mock("@/components/clients/metrics/metrics-tab-content", () => ({
  MetricsTabContent: () => <div data-testid="tab-metrics" />,
}))
vi.mock("@/components/clients/training/training-plan-card", () => ({
  TrainingPlanCard: () => <div data-testid="tab-training" />,
}))
vi.mock("@/components/clients/nutrition/nutrition-calculator-card-enhanced", () => ({
  NutritionCalculatorCardEnhanced: () => <div data-testid="tab-nutrition" />,
}))
vi.mock("@/components/clients/wellness/wellness-tab-content", () => ({
  WellnessTabContent: () => <div data-testid="tab-wellness" />,
}))
vi.mock("@/components/clients/habits/habits-tab-content", () => ({
  HabitsTabContent: () => <div data-testid="tab-habits" />,
}))
vi.mock("@/components/clients/check-ins/check-ins-tab-content", () => ({
  CheckInsTabContent: ({
    onTabChange,
  }: {
    onTabChange: (
      tab: string,
      extra?: Record<string, string | null>,
      options?: { replace?: boolean }
    ) => void
  }) => (
    <>
      <button type="button" onClick={() => onTabChange("check-ins", { checkIn: null })}>
        return to list
      </button>
      <button
        type="button"
        onClick={() => onTabChange("metrics", { journey: "blocks" }, { replace: true })}
      >
        complete a flow
      </button>
    </>
  ),
}))
vi.mock("@/components/clients/notes/notes-tab-content", () => ({
  NotesTabContent: () => <div data-testid="tab-notes" />,
}))

// The frame's header controls reach auth, SWR or a portal; markers.
vi.mock("@/components/coach/pin-intake-button", () => ({ PinIntakeButton: () => null }))
vi.mock("@/components/clients/invite-client-dialog", () => ({
  InviteClientDialog: () => null,
}))
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}))
vi.mock("@/components/collapsed-icon-strip", () => ({ CollapsedIconStrip: () => null }))

import ClientProfilePage from "./page"

/** Whether the arrow's own handler prevented the click (see back-link.test). */
function clickAndRecord(element: HTMLElement): boolean | null {
  let prevented: boolean | null = null
  const record = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }
  document.addEventListener("click", record)
  fireEvent.click(element)
  document.removeEventListener("click", record)
  return prevented
}

beforeEach(() => {
  cleanup()
  push.mockClear()
  replace.mockClear()
  leave.mockClear()
  search.current = new URLSearchParams("tab=overview")
  coachHistory.current = false
  clientState.current = {
    client: { id: "c-1", name: "Sam Doe", email: "sam@example.com" },
    isLoading: false,
    isError: false,
    mutate: vi.fn(),
  }
})

describe("ClientProfilePage navigation", () => {
  it("a sidebar tab click pushes the built address — a place, scrolled to top", () => {
    render(<ClientProfilePage />)
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Training" }))

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/clients/c-1?tab=training")
    expect(replace).not.toHaveBeenCalled()
  })

  it("a same-tab address replaces in place, keeping the scroll position", () => {
    search.current = new URLSearchParams("tab=check-ins&checkIn=ci-9")
    render(<ClientProfilePage />)

    fireEvent.click(screen.getByRole("button", { name: "return to list" }))

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith("/clients/c-1?tab=check-ins", { scroll: false })
    expect(push).not.toHaveBeenCalled()
  })

  it("a tab change that completes a flow replaces, scrolled to top like any tab change", () => {
    search.current = new URLSearchParams("tab=check-ins&training=plans")
    render(<ClientProfilePage />)

    fireEvent.click(screen.getByRole("button", { name: "complete a flow" }))

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith("/clients/c-1?tab=metrics&training=plans&journey=blocks")
    expect(push).not.toHaveBeenCalled()
  })

  it("the sidebar arrow leaves the page when a coach page precedes it", () => {
    coachHistory.current = true
    render(<ClientProfilePage />)

    expect(clickAndRecord(screen.getByLabelText("Back"))).toBe(true)
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it("the sidebar arrow is a link to the clients list when the page began the count", () => {
    render(<ClientProfilePage />)
    const arrow = screen.getByLabelText("Back")

    expect(arrow).toHaveAttribute("href", "/clients")
    expect(clickAndRecord(arrow)).toBe(false)
    expect(leave).not.toHaveBeenCalled()
  })

  it("the failed-to-load card's way out is the same arrow", () => {
    clientState.current = { client: null, isLoading: false, isError: true, mutate: vi.fn() }
    coachHistory.current = true
    render(<ClientProfilePage />)

    const card = screen.getByText("Failed to load client").closest("[data-slot], div.flex") as HTMLElement
    const link = within(card).getByRole("link", { name: "Back" })
    expect(link).toHaveAttribute("href", "/clients")
    expect(clickAndRecord(link)).toBe(true)
    expect(leave).toHaveBeenCalledTimes(1)
  })
})
