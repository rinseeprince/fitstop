import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/components/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
// The two real cards are tested beside their files; here they stand in by name.
vi.mock("@/components/coach/account-card", () => ({ CoachAccountCard: () => <section aria-label="Account card" /> }))
vi.mock("@/components/coach/settings-units-card", () => ({ SettingsUnitsCard: () => <section aria-label="Units card" /> }))
vi.mock("@/components/coach/change-email-link-notice", () => ({ ChangeEmailLinkNotice: () => <output aria-label="Link notice" /> }))

import SettingsPage from "./page"

describe("the coach's Settings (rule 5)", () => {
  afterEach(() => cleanup())

  it("holds the Account card where the Profile card was, first, then Business Information and Units as before", () => {
    render(<SettingsPage />)
    const account = screen.getByRole("region", { name: "Account card" })
    const business = screen.getByRole("heading", { name: "Business Information" })
    const units = screen.getByRole("region", { name: "Units card" })
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(account, business)).toBe(true)
    expect(follows(business, units)).toBe(true)
    expect(screen.queryByText("Profile Information")).toBeNull()
    expect(screen.queryByLabelText("Bio")).toBeNull()
  })

  it("hosts the notice that says when a change-of-email link failed", () => {
    render(<SettingsPage />)
    expect(screen.getByLabelText("Link notice")).toBeInTheDocument()
  })
})
