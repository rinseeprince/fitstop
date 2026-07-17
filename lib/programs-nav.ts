// Navigation helpers for the Programs section (/dashboard/programs/**).
// The S4.5 nav flatten retired the sub-sidebar + its PROGRAMS_NAV list; these
// path helpers survive because the topbar (view title) and the builder
// provider (last-opened-plan storage) still read them.

// The provider still writes the last-opened program id here; since S4.5 no
// surface reads it back (the sub-sidebar's Builder link is gone), so the
// write is inert — a Phase-7 removal candidate.
export const LAST_PLAN_STORAGE_KEY = "programs.builder.lastPlanId"

// The two retired standalone routes still resolve as non-builder paths so a
// stray navigation never mistakes them for a savedPlanId.
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
