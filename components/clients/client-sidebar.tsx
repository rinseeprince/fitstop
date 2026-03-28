"use client"

import Link from "next/link"
import { ArrowLeft, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { CLIENT_TABS, type ClientTab } from "@/lib/client-tabs"
import type { OnboardingStatus } from "@/types/client-intake"

interface ClientSidebarProps {
  client: {
    id: string
    name: string
    email: string
    onboardingStatus?: OnboardingStatus
  }
  activeTab: ClientTab
  onTabChange: (tab: ClientTab) => void
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

export function ClientSidebar({ client, activeTab, onTabChange }: ClientSidebarProps) {
  return (
    <aside className="hidden lg:flex fixed top-0 left-[52px] h-screen w-[200px] flex-col bg-white border-r border-[rgba(13,148,136,0.08)] z-20">
      {/* Top: back arrow + avatar + name */}
      <div className="px-4 pt-[18px] pb-[14px]">
        <div className="flex items-center gap-2.5">
          <Link
            href="/clients"
            className="text-[#93b0b4] hover:text-[#5a7d82] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {client.name ? (
            <>
              <div
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-[10px] font-bold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
              >
                {getInitials(client.name)}
              </div>
              <span className="text-[13.5px] font-semibold text-[#0c1a1e] truncate">
                {client.name}
              </span>
            </>
          ) : (
            <>
              <div className="h-[26px] w-[26px] rounded-[6px] bg-[rgba(13,148,136,0.08)] animate-pulse flex-shrink-0" />
              <div className="h-4 w-24 rounded bg-[rgba(13,148,136,0.08)] animate-pulse" />
            </>
          )}
        </div>
      </div>

      {/* Vertical tab list */}
      <nav className="flex-1 flex flex-col gap-1 px-2 pt-4 overflow-y-auto">
        {CLIENT_TABS.map((tab) => {
          const isActive = activeTab === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              className={cn(
                "relative flex items-center px-3 py-[9px] rounded-[6px] text-[13.5px] transition-colors duration-150 text-left",
                isActive
                  ? "font-semibold text-[#0c1a1e] bg-[rgba(13,148,136,0.05)]"
                  : "font-normal text-[#6b8a8e] bg-transparent hover:bg-[rgba(0,0,0,0.02)]"
              )}
            >
              {/* Active left bar indicator */}
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-[2px] bg-[#0d9488]"
                />
              )}
              {tab.label}
            </button>
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
