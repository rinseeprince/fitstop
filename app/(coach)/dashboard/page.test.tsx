import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const { mockUseSWR, mockUseOverdueClients, mockUseUnreviewedCheckIns } =
  vi.hoisted(() => ({
    mockUseSWR: vi.fn(),
    mockUseOverdueClients: vi.fn(),
    mockUseUnreviewedCheckIns: vi.fn(),
  }))

// The page's own read (/api/check-ins/recent). The queue read goes through
// use-check-in-data below, so `use-client-attention` and the roster's
// `indexUnreviewedCheckIns` both run for real — the point of these tests is
// that the card's number comes off THAT chain and not off /recent.
vi.mock("swr", () => ({ __esModule: true, default: (key: unknown) => mockUseSWR(key) }))
vi.mock("@/hooks/use-check-in-data", () => ({
  useOverdueClients: mockUseOverdueClients,
  useClientsDueSoon: vi.fn(() => ({ clients: [], total: 0 })),
  useUnreviewedCheckIns: mockUseUnreviewedCheckIns,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
// The shell mounts the bell and the toast listener; neither is under test and
// both would pull in more of the SWR surface.
vi.mock("@/components/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/coach/pending-intake-banner", () => ({ PendingIntakeBanner: () => null }))
vi.mock("@/components/dashboard/needs-attention-feed", () => ({ NeedsAttentionFeed: () => null }))
vi.mock("@/components/coach-tip-card", () => ({ CoachTipCard: () => null }))
// Springs from 0 towards its value, so the rendered number never settles in
// jsdom. The card's VALUE is what these tests assert, so it renders plainly.
vi.mock("@/components/animated-counter", () => ({
  AnimatedCounter: ({ value }: { value: number }) => <span>{value}</span>,
}))
vi.mock("@/components/ui/chart", () => ({ Sparkline: () => null }))

import DashboardPage from "./page"

type QueueRow = { id: string; clientId: string; createdAt: string }

function wire({
  queue = [],
  recent = [],
}: {
  queue?: QueueRow[]
  recent?: { id: string; clientId: string; status: string; createdAt: string }[]
} = {}) {
  mockUseOverdueClients.mockReturnValue({ clients: [], total: 0 })
  mockUseUnreviewedCheckIns.mockReturnValue({ checkIns: queue, total: queue.length })
  mockUseSWR.mockReturnValue({
    data: {
      checkIns: recent.map((r) => ({ ...r, clientName: "Jane Doe", clientAvatar: null })),
    },
    isLoading: false,
  })
}

/** The review card, found the way a coach finds it — by its label. */
function reviewCard() {
  return screen.getByRole("link", { name: /unreviewed check-ins/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe("the dashboard's unreviewed check-ins card", () => {
  it("links to the roster view, not the deleted queue page", () => {
    wire({ queue: [{ id: "ci-1", clientId: "c1", createdAt: "2026-08-29T10:00:00Z" }] })
    render(<DashboardPage />)

    expect(reviewCard()).toHaveAttribute("href", "/clients?view=review")
  })

  it("counts clients, so a client with two waiting counts once", () => {
    // The destination lists one row per client. A card reading 3 above a list
    // of 2 rows is the defect this replaced.
    wire({
      queue: [
        { id: "ci-1", clientId: "c1", createdAt: "2026-08-29T10:00:00Z" },
        { id: "ci-2", clientId: "c1", createdAt: "2026-08-22T10:00:00Z" },
        { id: "ci-3", clientId: "c2", createdAt: "2026-08-21T10:00:00Z" },
      ],
    })
    render(<DashboardPage />)

    expect(reviewCard()).toHaveTextContent("2")
  })

  it("does not take its number from /api/check-ins/recent any more", () => {
    // The old count was `ai_processed` rows inside /recent's newest 10. Five
    // of them here, and an empty queue: the card must read 0.
    wire({
      queue: [],
      recent: [
        { id: "r1", clientId: "c1", status: "ai_processed", createdAt: "2026-08-29T10:00:00Z" },
        { id: "r2", clientId: "c2", status: "ai_processed", createdAt: "2026-08-28T10:00:00Z" },
        { id: "r3", clientId: "c3", status: "ai_processed", createdAt: "2026-08-27T10:00:00Z" },
      ],
    })
    render(<DashboardPage />)

    expect(reviewCard()).toHaveTextContent("0")
    expect(reviewCard()).toHaveTextContent(/all caught up/i)
  })
})

describe("the dashboard's Recent check-ins rows", () => {
  it("deep-link to the check-in they name, not the client's default tab", () => {
    wire({
      recent: [
        { id: "r1", clientId: "c1", status: "reviewed", createdAt: "2026-08-29T10:00:00Z" },
      ],
    })
    render(<DashboardPage />)

    expect(screen.getByRole("link", { name: /jane doe/i })).toHaveAttribute(
      "href",
      "/clients/c1?tab=check-ins&checkIn=r1",
    )
  })
})
