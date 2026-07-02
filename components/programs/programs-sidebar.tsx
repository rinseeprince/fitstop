"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, Dumbbell, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getBuilderPlanId,
  LAST_PLAN_STORAGE_KEY,
  PROGRAMS_NAV,
} from "@/lib/programs-nav"

// Route-driven sub-sidebar for the Programs section. The visual pattern
// mirrors ClientSidebar (3px teal active bar, 13.5px items) but stays a
// separate component — that one is tab-driven and hardcodes client identity.
// NOTE: links here can't be guarded against unsaved builder edits (App Router
// navigation isn't interceptable) — same exposure as the main sidebar.
export function ProgramsSidebar() {
  const pathname = usePathname() ?? ""
  const [lastPlanId, setLastPlanId] = useState<string | null>(null)

  const builderPlanId = getBuilderPlanId(pathname)
  const onBuilder = builderPlanId !== null

  // sessionStorage is read in an effect (never during render) so SSR and
  // hydration agree on the initial "no plan opened yet" markup.
  useEffect(() => {
    setLastPlanId(sessionStorage.getItem(LAST_PLAN_STORAGE_KEY))
  }, [pathname])

  const itemClass = (isActive: boolean) =>
    cn(
      "relative flex items-center px-3 py-[9px] rounded-[6px] text-[13.5px] transition-colors duration-150 text-left",
      isActive
        ? "font-semibold text-[#0c1a1e] bg-[rgba(13,148,136,0.05)]"
        : "font-normal text-[#6b8a8e] bg-transparent hover:bg-[rgba(0,0,0,0.02)]",
    )

  const activeBar = (
    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-[2px] bg-[#0d9488]" />
  )

  const builderHref = builderPlanId ?? lastPlanId

  return (
    <aside className="hidden lg:flex fixed top-0 left-[52px] h-screen w-[200px] flex-col bg-white border-r border-[rgba(13,148,136,0.08)] z-20">
      {/* Top: back arrow + section icon + title */}
      <div className="px-4 pt-[18px] pb-[14px]">
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            className="text-[#93b0b4] hover:text-[#5a7d82] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
          >
            <Dumbbell className="h-[13px] w-[13px]" strokeWidth={2} />
          </div>
          <span className="text-[13.5px] font-semibold text-[#0c1a1e] truncate">
            Programs
          </span>
        </div>
      </div>

      {/* Vertical nav */}
      <nav className="flex-1 flex flex-col gap-1 px-2 pt-4 overflow-y-auto">
        {/* Builder — route-dynamic: active on any open program; otherwise it
            returns to the program last opened this session. */}
        {builderHref ? (
          <Link
            href={`/dashboard/programs/${builderHref}`}
            className={itemClass(onBuilder)}
          >
            {onBuilder && activeBar}
            Builder
          </Link>
        ) : (
          <div
            aria-disabled="true"
            title="Open a program from the list first"
            className="flex items-center px-3 py-[9px] rounded-[6px] text-[13.5px] font-normal text-[#b6c9cc] cursor-default"
          >
            Builder
          </div>
        )}

        {PROGRAMS_NAV.map((item) => {
          const isActive =
            item.href === "/dashboard/programs"
              ? pathname === "/dashboard/programs"
              : pathname.startsWith(item.href)
          return (
            <Link key={item.value} href={item.href} className={itemClass(isActive)}>
              {isActive && activeBar}
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-[rgba(13,148,136,0.08)] px-2 py-2">
        <Link
          href="/settings"
          className="flex items-center gap-2 px-3 py-[9px] rounded-[6px] text-[13.5px] font-normal text-[#93b0b4] hover:bg-[rgba(0,0,0,0.02)] transition-colors"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  )
}
