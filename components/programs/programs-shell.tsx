"use client"

import type { ReactNode } from "react"
import { ProgramsTopbar } from "./programs-topbar"
import { CheckInNotificationListener } from "@/components/check-in-notification-listener"

// Section shell for /dashboard/programs/** — the 52px dark icon strip is
// rendered by PersistentSidebar (root layout); this adds the sticky topbar
// and the page background. The old 200px sub-sidebar (Builder / Programs /
// The Programs list is full-width,
// and the builder's own left library panel absorbs Sessions + Exercises.
// CheckInNotificationListener is re-mounted here because these pages no
// longer render AppLayout (which normally provides it).
export function ProgramsShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Main content area — offset only by the 52px icon strip now.
          min-w-0 + overflow-x-hidden are load-bearing: without them the
          builder grid's intrinsic width propagates up, the BODY scrolls
          horizontally, the grid's own scroll container never engages, and
          its sticky cells ride over the fixed icon strip. Wide content must
          scroll inside its own container (the grid does), never the page. */}
      <div className="min-w-0 flex-1 flex flex-col lg:ml-[52px]">
        <ProgramsTopbar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#f4f7f6] px-8 py-5 pb-[60px]">
          {children}
        </main>
      </div>

      <CheckInNotificationListener />
    </div>
  )
}
