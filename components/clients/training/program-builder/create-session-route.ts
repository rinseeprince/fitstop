// The create-blank-session slide-over's address: the builder route's
// intercepted `sessions/new` segment (app/(coach)/dashboard/programs/
// [savedPlanId]/@modal/(.)sessions/new), with the day it adds to as
// positional ?w=&d= (uids regenerate on every seed, so they can't be trusted in
// a URL). The slide-over is open exactly while this is the address, so the
// add-session popover pushes it and the corner assistant steps aside for it
// (program-builder.tsx) — one spelling of the path for both.

function createSessionPath(savedPlanId: string): string {
  return `/dashboard/programs/${savedPlanId}/sessions/new`;
}

export function createSessionHref(
  savedPlanId: string,
  weekIndex: number,
  dayIndex: number,
): string {
  return `${createSessionPath(savedPlanId)}?w=${weekIndex}&d=${dayIndex}`;
}

/** Whether the address is the create-session slide-over's, over this program's builder. */
export function isCreateSessionPath(
  pathname: string | null,
  savedPlanId: string | null,
): boolean {
  return savedPlanId != null && pathname === createSessionPath(savedPlanId);
}
