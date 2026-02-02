"use client"

import type React from "react"

import { Card, CardContent } from "./ui/card"
import { Button } from "./ui/button"
import { Mail, Phone, MoreVertical } from "lucide-react"
import type { Lead } from "@/types/crm"

interface LeadCardProps {
  lead: Lead
  onDragStart?: (e: React.DragEvent, lead: Lead) => void
}

export function LeadCard({ lead, onDragStart }: LeadCardProps) {
  return (
    <Card
      className="cursor-move hover:shadow-md transition-shadow"
      draggable
      onDragStart={(e) => onDragStart?.(e, lead)}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-balance">{lead.name}</h3>
              <p className="text-sm text-muted-foreground truncate">{lead.email}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>

          {lead.source && (
            <div className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {lead.source}
            </div>
          )}

          {lead.notes && <p className="text-sm text-muted-foreground line-clamp-2">{lead.notes}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="flex-1 bg-transparent">
              <Mail className="h-3 w-3 mr-1" />
              Email
            </Button>
            <Button variant="outline" size="sm" className="flex-1 bg-transparent">
              <Phone className="h-3 w-3 mr-1" />
              Call
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
