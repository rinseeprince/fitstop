import type { ReactNode } from "react"
import { CheckInNotificationListener } from "@/components/check-in-notification-listener"
import { CoachTimezoneSync } from "@/components/coach/coach-timezone-sync"

/**
 * The coach application boundary. Everything under app/(coach)/ is trainer
 * territory: middleware has proved the viewer's role before this renders, and
 * `trainerRoutes` (middleware.ts) is bound to this folder by test.
 *
 * This layout owns only what belongs to the whole coach application — the
 * concerns that must run on every coach page whichever shell it uses. It
 * renders no rail and holds no route classification: which rail a surface gets
 * is not a boundary-level question (/dashboard and /dashboard/programs are
 * parent and child and want different rails, which nesting cannot express).
 * A concern that belongs to one surface belongs in that surface's shell.
 */
export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CheckInNotificationListener />
      <CoachTimezoneSync />
    </>
  )
}
