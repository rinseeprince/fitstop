import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

// The page's header action is the client page's arrow: Back when a coach
// page precedes this entry, the client page when none does.
const { back, coachHistory } = vi.hoisted(() => ({
  back: vi.fn(),
  coachHistory: { current: false },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/coach-history", () => ({
  hasCoachHistory: () => coachHistory.current,
}))
// The shell reaches auth and the rail; the intake body reaches SWR. Markers —
// the header action is what this file is about.
vi.mock("@/components/app-layout", () => ({
  AppLayout: ({
    children,
    headerActions,
  }: {
    children: React.ReactNode
    headerActions?: React.ReactNode
  }) => (
    <div>
      <header>{headerActions}</header>
      {children}
    </div>
  ),
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/components/coach/intake-review-page", () => ({ IntakeReviewPage: () => null }))
vi.mock("swr", () => ({
  default: () => ({ data: undefined, isLoading: true, error: undefined }),
}))
vi.mock("@/hooks/use-check-in-data", () => ({ useClient: () => ({ client: null }) }))

import IntakeReviewRoute from "./page"

// React's `use` reads a settled thenable without suspending, so the page
// renders in one pass — the shape Next hands a client page once its params
// have resolved.
const params = Object.assign(Promise.resolve({ id: "c-1" }), {
  status: "fulfilled" as const,
  value: { id: "c-1" },
})

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
  back.mockClear()
  coachHistory.current = false
})

describe("IntakeReviewRoute", () => {
  it("links its Back action to the client page, and goes back when a coach page precedes it", () => {
    coachHistory.current = true
    render(<IntakeReviewRoute params={params} />)

    const link = screen.getByRole("link", { name: "Back" })
    expect(link).toHaveAttribute("href", "/clients/c-1")
    expect(clickAndRecord(link)).toBe(true)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it("lets the link open the client page when nothing in-app precedes it", () => {
    render(<IntakeReviewRoute params={params} />)

    const link = screen.getByRole("link", { name: "Back" })
    expect(clickAndRecord(link)).toBe(false)
    expect(back).not.toHaveBeenCalled()
  })
})
