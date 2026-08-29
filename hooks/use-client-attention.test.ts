import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const { mockUseOverdueClients, mockUseUnreviewedCheckIns } = vi.hoisted(() => ({
  mockUseOverdueClients: vi.fn(),
  mockUseUnreviewedCheckIns: vi.fn(),
}))
vi.mock("@/hooks/use-check-in-data", () => ({
  useOverdueClients: mockUseOverdueClients,
  useUnreviewedCheckIns: mockUseUnreviewedCheckIns,
}))

import { useClientAttentionCount } from "./use-client-attention"

function wire(
  overdueTotal: number,
  checkIns: { id: string; clientId: string; createdAt: string }[],
) {
  mockUseOverdueClients.mockReturnValue({ total: overdueTotal })
  mockUseUnreviewedCheckIns.mockReturnValue({ checkIns, total: checkIns.length })
}

beforeEach(() => vi.clearAllMocks())

describe("useClientAttentionCount", () => {
  it("adds the two attention queues", () => {
    wire(2, [{ id: "1", clientId: "a", createdAt: "2026-08-29T10:00:00Z" }])

    expect(renderHook(() => useClientAttentionCount()).result.current).toBe(3)
  })

  it("counts a client once however many check-ins they are waiting on", () => {
    wire(0, [
      { id: "1", clientId: "a", createdAt: "2026-08-29T10:00:00Z" },
      { id: "2", clientId: "a", createdAt: "2026-08-22T10:00:00Z" },
      { id: "3", clientId: "b", createdAt: "2026-08-21T10:00:00Z" },
    ])

    // NOT `total`, which is 3: two check-ins from one client are one thing to
    // do, and the roster's Ready-for-review view would read 2.
    expect(renderHook(() => useClientAttentionCount()).result.current).toBe(2)
  })

  it("is the overdue total alone when nothing is waiting", () => {
    wire(4, [])

    expect(renderHook(() => useClientAttentionCount()).result.current).toBe(4)
  })
})
