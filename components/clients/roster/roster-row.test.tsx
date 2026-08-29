import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RosterTableRow } from "./roster-row"
import type { RosterRow, RosterStatus, RosterView } from "@/lib/roster-views"
import type { ClientWithCheckInInfo } from "@/types/check-in"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const WAITING = { id: "ci-9", submittedAt: "2026-08-24T09:00:00Z" }

function makeRow(
  overrides: Partial<RosterRow> & { status?: RosterStatus } = {},
): RosterRow {
  return {
    client: {
      id: "client-1",
      name: "Jane Doe",
      email: "jane@example.com",
      createdAt: "2026-08-01T09:00:00Z",
      lastCheckInDate: "2026-08-24T09:00:00Z",
      checkInFrequency: "none",
    } as ClientWithCheckInInfo,
    status: "active",
    daysOverdue: 0,
    unreviewedCheckIn: null,
    ...overrides,
  } as RosterRow
}

function renderRow(row: RosterRow, view: RosterView = "all") {
  return render(
    <table>
      <tbody>
        <RosterTableRow
          row={row}
          view={view}
          isPending={false}
          onReactivate={vi.fn()}
          onSendReminder={vi.fn()}
        />
      </tbody>
    </table>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date("2026-08-29T12:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RosterTableRow — the Review check-in action", () => {
  it("links to the check-in's own page through checkInReviewUrl", () => {
    renderRow(makeRow({ unreviewedCheckIn: WAITING }))

    expect(screen.getByRole("link", { name: /review check-in/i })).toHaveAttribute(
      "href",
      "/clients/client-1?tab=check-ins&checkIn=ci-9",
    )
  })

  it("is absent when nothing is waiting", () => {
    renderRow(makeRow())

    expect(screen.queryByRole("link", { name: /review check-in/i })).toBeNull()
  })

  it("is absent on a deactivated row, whose client page 404s", () => {
    renderRow(makeRow({ status: "inactive", unreviewedCheckIn: WAITING }))

    expect(screen.queryByRole("link", { name: /review check-in/i })).toBeNull()
  })
})

describe("RosterTableRow — the Last check-in sub-line", () => {
  it("dates the waiting line from the UNREVIEWED check-in", () => {
    renderRow(
      makeRow({
        // A newer, already-reviewed check-in: the main line reads it, the
        // sub-line must not.
        client: {
          ...makeRow().client,
          lastCheckInDate: "2026-08-28T09:00:00Z",
        } as ClientWithCheckInInfo,
        unreviewedCheckIn: WAITING,
      }),
    )

    expect(screen.getByText("Yesterday")).toBeInTheDocument()
    expect(screen.getByText("review · 24 Aug")).toBeInTheDocument()
  })

  it("gives lateness precedence over a waiting check-in", () => {
    renderRow(makeRow({ daysOverdue: 3, unreviewedCheckIn: WAITING }))

    expect(screen.getByText("3d late")).toBeInTheDocument()
    expect(screen.queryByText(/^review · /)).toBeNull()
  })

  it("falls back to the forward-looking due date", () => {
    renderRow(
      makeRow({
        client: {
          ...makeRow().client,
          checkInFrequency: "weekly",
          nextCheckInDue: "2026-09-03",
          timezone: "UTC",
        } as ClientWithCheckInInfo,
      }),
    )

    // "Sept", not "Sep" — en-GB's short form for September. Pre-existing
    // rendering, unchanged here; pinned so a locale change is visible.
    expect(screen.getByText("due 3 Sept")).toBeInTheDocument()
  })
})

describe("RosterTableRow — where a click lands", () => {
  it("goes to the check-in in the review view", async () => {
    const user = userEvent.setup()
    renderRow(makeRow({ unreviewedCheckIn: WAITING }), "review")

    await user.click(screen.getByText("jane@example.com"))

    expect(push).toHaveBeenCalledWith("/clients/client-1?tab=check-ins&checkIn=ci-9")
  })

  it("goes to the client page everywhere else, even with one waiting", async () => {
    const user = userEvent.setup()
    renderRow(makeRow({ unreviewedCheckIn: WAITING }), "all")

    await user.click(screen.getByText("jane@example.com"))

    expect(push).toHaveBeenCalledWith("/clients/client-1")
  })

  it("keeps the NAME pointed at the client, review view included", () => {
    renderRow(makeRow({ unreviewedCheckIn: WAITING }), "review")

    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveAttribute(
      "href",
      "/clients/client-1",
    )
  })
})
