"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckInScheduleSection } from "@/components/clients/check-in/check-in-schedule-card"
import { Edit2, Mail, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  LABEL_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens"
import type { Client } from "@/types/check-in"

interface ClientScheduleCardProps {
  client: Client
  onClientUpdated?: () => void
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getFrequencyLabel(client: Client): string {
  switch (client.checkInFrequency) {
    case "weekly":
      return "Weekly"
    case "biweekly":
      return "Bi-weekly"
    case "monthly":
      return "Monthly"
    case "custom":
      return `Every ${client.checkInFrequencyDays} days`
    case "none":
      return "No schedule"
    default:
      return "Weekly"
  }
}

function getDayLabel(day: string | null | undefined): string {
  if (!day) return "Any day"
  return day.charAt(0).toUpperCase() + day.slice(1)
}

export function ClientScheduleCard({ client, onClientUpdated }: ClientScheduleCardProps) {
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)

  return (
    <>
      <div
        className="bg-white rounded-[6px] flex flex-col animate-card-in"
        style={{ animationDelay: "0.04s" }}
      >
        {/* Header with avatar */}
        <div className="p-5 pb-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-16 h-16 rounded-[6px] flex items-center justify-center text-white text-lg font-bold shadow-md"
                style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
              >
                {getInitials(client.name)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-[#0c1a1e]">
                    Client & Schedule
                  </h3>
                  {client.active && (
                    <span className="w-[5px] h-[5px] rounded-full bg-[#0d9488] inline-block" />
                  )}
                </div>
                <p className="text-[12px] text-[#93b0b4] mt-0.5">{client.name}</p>
              </div>
            </div>
            {!isEditingSchedule && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditingSchedule(true)}
                className="text-[#93b0b4] hover:text-[#5a7d82]"
              >
                <Edit2 className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-5 flex-1">
          {isEditingSchedule ? (
            <CheckInScheduleSection
              client={client}
              onUpdate={() => {
                setIsEditingSchedule(false)
                window.location.reload()
              }}
              onCancel={() => setIsEditingSchedule(false)}
            />
          ) : (
            <div className="space-y-2.5 mt-1">
              {/* Frequency | Check-in Day */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className={LABEL_CLASS}>
                    Frequency
                  </p>
                  <p
                    className={cn(
                      "text-[13px] font-semibold text-[#0c1a1e] mt-0.5",
                      client.checkInFrequency === "custom" && MONO
                    )}
                  >
                    {getFrequencyLabel(client)}
                  </p>
                </div>
                <div>
                  <p className={LABEL_CLASS}>
                    Check-in Day
                  </p>
                  <p className="text-[13px] font-semibold text-[#0c1a1e] mt-0.5">
                    {getDayLabel(client.expectedCheckInDay)}
                  </p>
                </div>
              </div>

              {/* Email */}
              <div>
                <p className={LABEL_CLASS}>
                  Email
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Mail className="h-3.5 w-3.5 text-[#93b0b4] shrink-0" strokeWidth={1.5} />
                  <p className="text-[13px] text-[#0c1a1e] truncate">{client.email}</p>
                </div>
              </div>

              {/* Phone */}
              <div>
                <p className={LABEL_CLASS}>
                  Phone
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Phone className="h-3.5 w-3.5 text-[#93b0b4] shrink-0" strokeWidth={1.5} />
                  <p className="text-[13px] text-[#93b0b4]">Not set</p>
                </div>
              </div>

              {/* Height | Gender */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className={LABEL_CLASS}>
                    Height
                  </p>
                  <p className="text-[13px] font-semibold text-[#0c1a1e] mt-0.5">
                    {client.height ? (
                      <span className={MONO}>
                        {client.height}
                        <span className="text-[11px] text-[#93b0b4] font-normal ml-0.5">
                          {client.heightUnit || "in"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#93b0b4]">Not set</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className={LABEL_CLASS}>
                    Gender
                  </p>
                  <p className="text-[13px] font-semibold text-[#0c1a1e] mt-0.5 capitalize">
                    {client.gender || <span className="text-[#93b0b4]">Not set</span>}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  )
}
