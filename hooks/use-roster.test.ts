import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const { mockUseSWR, mockUseOverdueClients, mockUseUnreviewedCheckIns } = vi.hoisted(
  () => ({
    mockUseSWR: vi.fn(),
    mockUseOverdueClients: vi.fn(),
    mockUseUnreviewedCheckIns: vi.fn(),
  }),
)
vi.mock("swr", () => ({ default: mockUseSWR }))
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }))
vi.mock("@/hooks/use-check-in-data", () => ({
  useOverdueClients: mockUseOverdueClients,
  useUnreviewedCheckIns: mockUseUnreviewedCheckIns,
}))

import { useRoster } from "./use-roster"

const CLIENTS = [
  { id: "a", name: "Ann", email: "a@x.com", active: true, onboardingStatus: "active" },
  { id: "b", name: "Bea", email: "b@x.com", active: true, onboardingStatus: "active" },
  { id: "c", name: "Cal", email: "c@x.com", active: false, onboardingStatus: "active" },
]

function wire({
  clients = CLIENTS,
  overdue = [] as { id: string; daysOverdue: number }[],
  unreviewed = [] as { id: string; clientId: string; createdAt: string }[],
  rosterError = undefined as unknown,
  rosterLoading = false,
  overdueError = undefined as unknown,
  overdueLoading = false,
  unreviewedError = undefined as unknown,
  unreviewedLoading = false,
} = {}) {
  const mutate = vi.fn().mockResolvedValue(undefined)
  const mutateOverdue = vi.fn().mockResolvedValue(undefined)
  const mutateUnreviewed = vi.fn().mockResolvedValue(undefined)

  mockUseSWR.mockReturnValue({
    data: { clients },
    error: rosterError,
    isLoading: rosterLoading,
    mutate,
  })
  mockUseOverdueClients.mockReturnValue({
    clients: overdue,
    isLoading: overdueLoading,
    isError: overdueError,
    mutate: mutateOverdue,
  })
  mockUseUnreviewedCheckIns.mockReturnValue({
    checkIns: unreviewed,
    isLoading: unreviewedLoading,
    isError: unreviewedError,
    mutate: mutateUnreviewed,
  })

  return { mutate, mutateOverdue, mutateUnreviewed }
}

beforeEach(() => vi.clearAllMocks())

describe("useRoster — the unreviewed check-in queue", () => {
  it("stamps the newest waiting check-in onto its own row only", () => {
    wire({
      unreviewed: [
        { id: "newest", clientId: "b", createdAt: "2026-08-29T10:00:00Z" },
        { id: "older", clientId: "b", createdAt: "2026-08-22T10:00:00Z" },
      ],
    })

    const { result } = renderHook(() => useRoster())
    const byId = new Map(result.current.rows.map((row) => [row.client.id, row]))

    expect(byId.get("b")?.unreviewedCheckIn).toEqual({
      id: "newest",
      submittedAt: "2026-08-29T10:00:00Z",
    })
    expect(byId.get("a")?.unreviewedCheckIn).toBeNull()
  })

  it("counts the review view as CLIENTS, excluding deactivated ones", () => {
    wire({
      unreviewed: [
        { id: "1", clientId: "a", createdAt: "2026-08-29T10:00:00Z" },
        { id: "2", clientId: "a", createdAt: "2026-08-22T10:00:00Z" },
        // Cal is deactivated: their check-in must not reach the queue view.
        { id: "3", clientId: "c", createdAt: "2026-08-20T10:00:00Z" },
      ],
    })

    const { result } = renderHook(() => useRoster())

    expect(result.current.counts.review).toBe(1)
  })

  it("does not put a submitted intake in the review view any more", () => {
    wire({
      clients: [
        {
          id: "a",
          name: "Ann",
          email: "a@x.com",
          active: true,
          onboardingStatus: "intake_completed",
        },
      ],
    })

    const { result } = renderHook(() => useRoster())

    expect(result.current.counts.review).toBe(0)
    expect(result.current.counts.onboarding).toBe(1)
  })
})

describe("useRoster — all three fetches are represented", () => {
  it("reports loading while the queue is still in flight", () => {
    wire({ unreviewedLoading: true })
    expect(renderHook(() => useRoster()).result.current.isLoading).toBe(true)
  })

  it("reports error when only the queue failed", () => {
    wire({ unreviewedError: new Error("boom") })
    expect(renderHook(() => useRoster()).result.current.isError).toBe(true)
  })

  it("refreshes all three keys", async () => {
    const { mutate, mutateOverdue, mutateUnreviewed } = wire()

    const { result } = renderHook(() => useRoster())
    await result.current.refresh()

    expect(mutate).toHaveBeenCalled()
    expect(mutateOverdue).toHaveBeenCalled()
    expect(mutateUnreviewed).toHaveBeenCalled()
  })
})
