import { describe, it, expect } from "vitest"
import {
  indexUnreviewedCheckIns,
  matchesRosterView,
  resolveRosterView,
  rosterViewUrl,
  type RosterRow,
  type RosterStatus,
} from "./roster-views"
import type { ClientWithCheckInInfo } from "@/types/check-in"

function makeRow(overrides: Partial<RosterRow> & { status: RosterStatus }): RosterRow {
  return {
    client: { id: "client-1", name: "Jane", email: "j@d.com" } as ClientWithCheckInInfo,
    daysOverdue: 0,
    unreviewedCheckIn: null,
    ...overrides,
  }
}

describe("resolveRosterView", () => {
  it("resolves a known view and falls back to all", () => {
    expect(resolveRosterView("review")).toBe("review")
    expect(resolveRosterView("nonsense")).toBe("all")
    expect(resolveRosterView(null)).toBe("all")
  })
})

describe("rosterViewUrl", () => {
  it("leaves the default view as the bare path", () => {
    expect(rosterViewUrl("all")).toBe("/clients")
    expect(rosterViewUrl("review")).toBe("/clients?view=review")
  })
})

describe("indexUnreviewedCheckIns", () => {
  it("keeps the FIRST row per client — the endpoint's newest-first order", () => {
    const index = indexUnreviewedCheckIns([
      { id: "newest", clientId: "a", createdAt: "2026-08-29T10:00:00Z" },
      { id: "older", clientId: "a", createdAt: "2026-08-22T10:00:00Z" },
      { id: "other", clientId: "b", createdAt: "2026-08-25T10:00:00Z" },
    ])

    expect(index.get("a")).toEqual({
      id: "newest",
      submittedAt: "2026-08-29T10:00:00Z",
    })
    expect(index.get("b")?.id).toBe("other")
  })

  it("counts CLIENTS, not check-ins", () => {
    const index = indexUnreviewedCheckIns([
      { id: "1", clientId: "a", createdAt: "2026-08-29T10:00:00Z" },
      { id: "2", clientId: "a", createdAt: "2026-08-22T10:00:00Z" },
      { id: "3", clientId: "a", createdAt: "2026-08-15T10:00:00Z" },
    ])

    expect(index.size).toBe(1)
  })

  it("is empty for an empty queue", () => {
    expect(indexUnreviewedCheckIns([]).size).toBe(0)
  })
})

describe("matchesRosterView — review", () => {
  const waiting = { id: "ci-1", submittedAt: "2026-08-29T10:00:00Z" }

  it("holds a client with an unreviewed check-in", () => {
    expect(
      matchesRosterView(
        makeRow({ status: "active", unreviewedCheckIn: waiting }),
        "review",
      ),
    ).toBe(true)
  })

  it("drops a client with nothing waiting", () => {
    expect(matchesRosterView(makeRow({ status: "active" }), "review")).toBe(false)
  })

  it("drops a DEACTIVATED client even with one waiting — their page 404s", () => {
    expect(
      matchesRosterView(
        makeRow({ status: "inactive", unreviewedCheckIn: waiting }),
        "review",
      ),
    ).toBe(false)
  })

  it("no longer holds a submitted intake — that is the Onboarding view now", () => {
    const intakeIn = makeRow({ status: "awaiting_review" })

    expect(matchesRosterView(intakeIn, "review")).toBe(false)
    expect(matchesRosterView(intakeIn, "onboarding")).toBe(true)
  })
})

describe("matchesRosterView — the other views are unchanged", () => {
  it("still sorts by status and lateness", () => {
    const active = makeRow({ status: "active" })
    const late = makeRow({ status: "active", daysOverdue: 3 })
    const gone = makeRow({ status: "inactive" })

    expect(matchesRosterView(active, "all")).toBe(true)
    expect(matchesRosterView(active, "active")).toBe(true)
    expect(matchesRosterView(active, "overdue")).toBe(false)
    expect(matchesRosterView(late, "overdue")).toBe(true)
    expect(matchesRosterView(gone, "inactive")).toBe(true)
    expect(matchesRosterView(gone, "active")).toBe(false)
  })
})
