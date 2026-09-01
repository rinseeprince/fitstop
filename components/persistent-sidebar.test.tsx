import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { navigation } from "@/lib/navigation"

const route = vi.hoisted(() => ({ pathname: "/dashboard" }))

// The context in its FIRST-PAINT shape: session not resolved, nothing known.
// The rail must not care. (ARCHITECTURE → "Coach route group": the viewer's
// role was settled by middleware before the page was sent; the rail has
// nothing to wait for and nothing to decide.)
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    loading: true,
    coach: null,
    role: null,
    isClient: false,
    isTrainer: false,
    logout: vi.fn(),
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => route.pathname,
}))
// The badge count rides two SWR reads; whether the rail exists is not about them.
vi.mock("@/hooks/use-client-attention", () => ({ useClientAttentionCount: () => 0 }))

import { PersistentSidebar } from "./persistent-sidebar"

/**
 * The full rail's signature is its visible labels. Roles alone do not tell the
 * two rails apart: the collapsed strip names its icon-only links through
 * `title`, which reaches the accessible name too — a mutation that swapped in
 * the strip passed a role-and-name check. The label TEXT is what only the full
 * rail has.
 */
function expectFullRail() {
  expect(screen.getByRole("navigation")).toBeInTheDocument()
  for (const item of navigation) {
    expect(screen.getByText(item.name)).toBeInTheDocument()
    // "CRM Beta" — the beta chip joins the accessible name, hence the prefix.
    expect(screen.getByRole("link", { name: new RegExp(`^${item.name}`) })).toHaveAttribute(
      "href",
      item.href
    )
  }
}

describe("PersistentSidebar", () => {
  it("renders the whole rail before auth has resolved", () => {
    // Mutation-checked: a `loading && !isTrainer` gate at the top of the
    // component fails this.
    render(<PersistentSidebar />)
    expectFullRail()
  })

  it.each([
    "/dashboard",
    "/dashboard/content",
    "/clients",
    "/clients/3f0c1a22-0000-4000-8000-000000000000",
    "/clients/3f0c1a22-0000-4000-8000-000000000000/intake-review",
    "/dashboard/programs",
    "/dashboard/programs/3f0c1a22-0000-4000-8000-000000000000",
    "/crm",
    "/automation",
    "/settings",
  ])("is the same rail on %s — the route is the shell's business, not the rail's", (pathname) => {
    // The rail used to swap itself for the collapsed strip on some of these
    // and hide itself on others. Which rail a surface gets is now decided by
    // the shell that mounts it, so the route must make no difference here.
    route.pathname = pathname
    render(<PersistentSidebar />)
    expectFullRail()
  })
})
