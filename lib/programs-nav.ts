// Navigation helpers for the Programs section (/dashboard/programs/**).
// The S4.5 nav flatten retired the sub-sidebar + its PROGRAMS_NAV list. What
// survives is the topbar's view title, so `getProgramsView` is the only export;
// the two path helpers below are its internals. S7 removed LAST_PLAN_STORAGE_KEY
// with the provider write that fed it — nothing had read it back since S4.5.

// The two retired standalone routes still resolve as non-builder paths so a
// stray navigation never mistakes them for a savedPlanId.
const STATIC_SEGMENTS = new Set(["sessions", "exercises"])

// A builder path is /dashboard/programs/<savedPlanId>[/**] where the first
// segment is not a static section view. Sub-paths (e.g. the create-session
// slide-over route) still count as the builder.
function getBuilderPlanId(pathname: string): string | null {
  const match = /^\/dashboard\/programs\/([^/]+)/.exec(pathname)
  if (!match || STATIC_SEGMENTS.has(match[1])) return null
  return match[1]
}

function isBuilderPath(pathname: string): boolean {
  return getBuilderPlanId(pathname) !== null
}

export type ProgramsView = "programs" | "sessions" | "exercises" | "builder"

export function getProgramsView(pathname: string): ProgramsView {
  if (isBuilderPath(pathname)) return "builder"
  if (pathname.startsWith("/dashboard/programs/sessions")) return "sessions"
  if (pathname.startsWith("/dashboard/programs/exercises")) return "exercises"
  return "programs"
}
