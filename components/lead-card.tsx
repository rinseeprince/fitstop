"use client"

import type React from "react"

import { Button } from "./ui/button"
import { Mail, Phone, MoreVertical } from "lucide-react"
import type { Lead } from "@/types/crm"

interface LeadCardProps {
  lead: Lead
  onDragStart?: (e: React.DragEvent, lead: Lead) => void
}

export function LeadCard({ lead, onDragStart }: LeadCardProps) {
  return (
    <div
      className="cursor-move bg-white rounded-[6px] border border-[rgba(13,148,136,0.08)] p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
      draggable
      onDragStart={(e) => onDragStart?.(e, lead)}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-balance text-[#0c1a1e]">{lead.name}</h3>
            <p className="text-sm text-[#5a7d82] truncate font-mono-display">{lead.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mt-1 text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>

        {lead.source && (
          <div className="inline-flex items-center rounded-[4px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[11px] font-medium text-[#5a7d82]">
            {lead.source}
          </div>
        )}

        {lead.notes && <p className="text-sm text-[#5a7d82] line-clamp-2">{lead.notes}</p>}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0c1a1e] rounded-[6px]"
          >
            <Mail className="h-3 w-3 mr-1" strokeWidth={1.5} />
            Email
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0c1a1e] rounded-[6px]"
          >
            <Phone className="h-3 w-3 mr-1" strokeWidth={1.5} />
            Call
          </Button>
        </div>
      </div>
    </div>
  )
}
