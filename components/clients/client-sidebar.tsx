"use client"

import Link from "next/link"
import { ArrowLeft, Settings } from "lucide-react"
import {
  SectionSidebar,
  SectionSidebarNav,
  SectionSidebarTab,
} from "@/components/section-sidebar"
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
    <SectionSidebar
      header={
        <>
          <Link
            href="/clients"
            aria-label="Back to clients"
            className="text-[#93b0b4] transition-colors hover:text-[#5a7d82]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {client.name ? (
            <>
              <div
                className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] text-[10px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
              >
                {getInitials(client.name)}
              </div>
              <span className="truncate text-[13.5px] font-semibold text-[#0c1a1e]">
                {client.name}
              </span>
            </>
          ) : (
            <>
              <div className="h-[26px] w-[26px] flex-shrink-0 animate-pulse rounded-[6px] bg-[rgba(13,148,136,0.08)]" />
              <div className="h-4 w-24 animate-pulse rounded bg-[rgba(13,148,136,0.08)]" />
            </>
          )}
        </>
      }
      footer={
        <div className="px-2 py-2">
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-[6px] px-3 py-[9px] text-[13.5px] font-normal text-[#93b0b4] transition-colors hover:bg-[rgba(0,0,0,0.02)]"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      }
    >
      <SectionSidebarNav className="pt-4">
        {CLIENT_TABS.map((tab) => (
          <SectionSidebarTab
            key={tab.value}
            label={tab.label}
            isActive={activeTab === tab.value}
            onClick={() => onTabChange(tab.value)}
          />
        ))}
      </SectionSidebarNav>
    </SectionSidebar>
  )
}
