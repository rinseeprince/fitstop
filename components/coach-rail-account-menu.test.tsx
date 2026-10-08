import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import type { ReactNode } from "react"

/**
 * Both coach rails' account menus name the coach as the Settings Account card
 * does: the login's own name and address, from Better Auth's session (D18).
 * The coach row's copy of the address can lag the login (another tab, a copy
 * that failed), so a menu reading it would disagree with the card.
 */
const auth = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string } | null,
  coach: null as { name: string; email: string } | null,
  loading: false,
}))
vi.mock("@/contexts/auth-context", () => ({ useAuth: () => ({ ...auth, logout: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/settings" }))
vi.mock("@/hooks/use-client-attention", () => ({ useClientAttentionCount: () => 0 }))
// The menu's content drawn in place, so its label can be read without opening it.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div data-testid="account-menu">{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div data-testid="account-menu-label">{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}))

import { PersistentSidebar } from "./persistent-sidebar"
import { CollapsedIconStrip } from "./collapsed-icon-strip"

const RAILS = [
  ["the full rail (PersistentSidebar)", PersistentSidebar],
  ["the collapsed strip (CollapsedIconStrip)", CollapsedIconStrip],
] as const

describe("the coach rails' account menus", () => {
  beforeEach(() => {
    auth.user = null
    auth.coach = null
    auth.loading = false
  })
  afterEach(() => cleanup())

  it.each(RAILS)("%s names the coach by the session, where the coach row's copy has not caught up", (_label, Rail) => {
    auth.user = { id: "user-1", name: "Sam Coach", email: "sam.new@example.com" }
    auth.coach = { name: "Sam Coach", email: "sam@example.com" }
    render(<Rail />)
    const label = screen.getByTestId("account-menu-label")
    expect(label).toHaveTextContent("Sam Coach")
    expect(label).toHaveTextContent("sam.new@example.com")
    expect(label).not.toHaveTextContent("sam@example.com")
  })

  it.each(RAILS)("%s says it is loading until the session is read, whatever the coach row holds", (_label, Rail) => {
    auth.coach = { name: "Sam Coach", email: "sam@example.com" }
    render(<Rail />)
    const label = screen.getByTestId("account-menu-label")
    expect(label).toHaveTextContent("Loading...")
    expect(label).not.toHaveTextContent("sam@example.com")
  })
})
