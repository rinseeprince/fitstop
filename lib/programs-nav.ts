// Navigation model for the Programs section (/dashboard/programs/**).
// Mirrors the lib/client-tabs.ts precedent, but route-driven: each view is a
// real route behind the section sub-sidebar, not a query-param tab.

export const PROGRAMS_SECTION_PREFIX = "/dashboard/programs"

// The sub-sidebar's Builder item returns to the program last opened this
// browser session (per-tab by design — sessionStorage).
export const LAST_PLAN_STORAGE_KEY = "programs.builder.lastPlanId"

// Static section views. The Builder item is route-dynamic (needs a plan id)
// and is rendered separately by ProgramsSidebar.
export const PROGRAMS_NAV = [
  { value: "programs", label: "Programs", href: "/dashboard/programs" },
  { value: "sessions", label: "Sessions", href: "/dashboard/programs/sessions" },
  { value: "exercises", label: "Exercises", href: "/dashboard/programs/exercises" },
] as const

const STATIC_SEGMENTS = new Set(["sessions", "exercises"])

// A builder path is /dashboard/programs/<savedPlanId>[/**] where the first
// segment is not a static section view. Sub-paths (e.g. the create-session
// slide-over route) still count as the builder.
export function getBuilderPlanId(pathname: string): string | null {
  const match = /^\/dashboard\/programs\/([^/]+)/.exec(pathname)
  if (!match || STATIC_SEGMENTS.has(match[1])) return null
  return match[1]
}

export function isBuilderPath(pathname: string): boolean {
  return getBuilderPlanId(pathname) !== null
}

export type ProgramsView = "programs" | "sessions" | "exercises" | "builder"

export function getProgramsView(pathname: string): ProgramsView {
  if (isBuilderPath(pathname)) return "builder"
  if (pathname.startsWith("/dashboard/programs/sessions")) return "sessions"
  if (pathname.startsWith("/dashboard/programs/exercises")) return "exercises"
  return "programs"
}
