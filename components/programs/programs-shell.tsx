"use client"

import type { ReactNode } from "react"
import { ProgramsTopbar } from "./programs-topbar"
import { CollapsedIconStrip } from "@/components/collapsed-icon-strip"

// Section shell for /dashboard/programs/** — mounts the 52px dark icon strip
// (its own rail: the shell decides the variant) plus the sticky topbar and the
// page background. The Programs list is full-width, and the builder's own left
// library panel absorbs Sessions + Exercises.
export function ProgramsShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <CollapsedIconStrip />
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
    </div>
  )
}
