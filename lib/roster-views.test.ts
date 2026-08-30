import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  indexUnreviewedCheckIns,
  matchesRosterView,
  resolveRosterView,
  rosterViewLabel,
  rosterViewNavLabel,
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

describe("the two ways a view is named", () => {
  it("keeps the full name for surfaces that cite the view alone", () => {
    // The stat-band cell, the sticky title and the dashboard card have no
    // heading above them saying what the number is about.
    expect(rosterViewLabel("review")).toBe("Unreviewed check-ins")
    expect(rosterViewLabel("overdue")).toBe("Overdue check-ins")
  })

  it("shortens ONLY the sidebar, which supplies its own subject", () => {
    // The two attention tabs sit under a "Check-ins" heading in a 200px column
    // that truncates; the full names clipped.
    expect(rosterViewNavLabel("review")).toBe("Review due")
    expect(rosterViewNavLabel("overdue")).toBe("Overdue")
  })

  it("falls back to the full name for a view with no short form", () => {
    // The four roster shapes are already short and need no entry — and a new
    // view must not have to add one to appear in the sidebar at all.
    for (const view of ["all", "active", "onboarding", "inactive"] as const) {
      expect(rosterViewNavLabel(view)).toBe(rosterViewLabel(view))
    }
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

// ---------------------------------------------------------------------------
// The scan. This module's header says every writer of `?view=` goes through
// `rosterViewUrl`, and until C3 the notifications bell quietly disagreed:
// `href="/clients?view=overdue"`, hand-typed. One literal is a typo away from a
// link that 404s and a rename away from a link that lands on the wrong queue,
// so the rule is only durable if a SECOND one cannot be typed unnoticed.
// Modelled on lib/check-in-week.test.ts.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..")
const SCANNED_DIRS = ["app", "components", "hooks", "lib", "services", "utils"]
const VIEW_LITERAL = /\/clients\?view=/

/** Source files allowed to spell the param. Each needs a reason. */
const EXEMPT: Record<string, string> = {
  "lib/roster-views.ts": "builds the URL — the one writer",
}

/**
 * Tests are out of scope, not exempted one by one. The defect is a SHIPPING
 * file carrying a hand-typed link; a test cannot ship one, and a test asserting
 * the concrete URL a coach lands on is the thing that would CATCH a bad rename.
 * Growing an exemption list would have penalised exactly the right habit.
 */
const IS_TEST = /\.test\.tsx?$/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next") continue
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  walk(join(REPO_ROOT, dir))
  return out
}

describe("nothing writes a roster view URL by hand", () => {
  it("every `/clients?view=` comes from rosterViewUrl", () => {
    const offenders: string[] = []

    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        const rel = relative(REPO_ROOT, file)
        if (EXEMPT[rel] || IS_TEST.test(rel)) continue
        if (VIEW_LITERAL.test(readFileSync(file, "utf8"))) offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
  })
})
