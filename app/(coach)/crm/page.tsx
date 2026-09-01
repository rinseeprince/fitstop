"use client"

import type React from "react"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { LeadCard } from "@/components/lead-card"
import { Plus } from "lucide-react"
import type { Lead, KanbanColumn } from "@/types/crm"

const inputClass = "border-[rgba(13,148,136,0.08)] rounded-[6px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:border-[#0d9488] focus:ring-[#0d9488]/20"
const labelClass = "text-[12px] font-medium text-[#0c1a1e]"

const initialColumns: KanbanColumn[] = [
  {
    id: "cold",
    title: "Cold Lead",
    stage: "cold",
    leads: [
      {
        id: "1",
        name: "John Smith",
        email: "john@email.com",
        source: "Instagram",
        notes: "Interested in strength training",
        stage: "cold",
      },
      {
        id: "2",
        name: "Mary Johnson",
        email: "mary@email.com",
        source: "Referral",
        notes: "Looking for nutrition coaching",
        stage: "cold",
      },
    ],
  },
  {
    id: "warm",
    title: "Warm Lead",
    stage: "warm",
    leads: [
      {
        id: "3",
        name: "Alex Brown",
        email: "alex@email.com",
        source: "Website",
        notes: "Responded to initial email",
        stage: "warm",
      },
      {
        id: "4",
        name: "Lisa Davis",
        email: "lisa@email.com",
        source: "Facebook",
        notes: "Asked about pricing",
        stage: "warm",
      },
    ],
  },
  {
    id: "booked",
    title: "Call Booked",
    stage: "booked",
    leads: [
      {
        id: "5",
        name: "Tom Wilson",
        email: "tom@email.com",
        source: "Instagram",
        notes: "Discovery call scheduled for Thursday",
        stage: "booked",
      },
    ],
  },
  {
    id: "client",
    title: "Client",
    stage: "client",
    leads: [
      {
        id: "6",
        name: "Emma Taylor",
        email: "emma@email.com",
        source: "Referral",
        notes: "Onboarded last week",
        stage: "client",
      },
      {
        id: "7",
        name: "David Martinez",
        email: "david@email.com",
        source: "Website",
        notes: "Starting this Monday",
        stage: "client",
      },
    ],
  },
]

export default function CRMPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>(initialColumns)
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newLead, setNewLead] = useState({
    name: "",
    email: "",
    source: "",
    notes: "",
  })

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, targetStage: Lead["stage"]) => {
    e.preventDefault()

    if (!draggedLead) return

    setColumns((prevColumns) => {
      const newColumns = prevColumns.map((column) => {
        // Remove lead from source column
        if (column.stage === draggedLead.stage) {
          return {
            ...column,
            leads: column.leads.filter((lead) => lead.id !== draggedLead.id),
          }
        }
        // Add lead to target column
        if (column.stage === targetStage) {
          return {
            ...column,
            leads: [...column.leads, { ...draggedLead, stage: targetStage }],
          }
        }
        return column
      })
      return newColumns
    })

    setDraggedLead(null)
  }

  const handleAddLead = () => {
    if (!newLead.name || !newLead.email) return

    const lead: Lead = {
      id: Date.now().toString(),
      ...newLead,
      stage: "cold",
    }

    setColumns((prevColumns) =>
      prevColumns.map((column) => (column.stage === "cold" ? { ...column, leads: [...column.leads, lead] } : column)),
    )

    setNewLead({ name: "", email: "", source: "", notes: "" })
    setIsDialogOpen(false)
  }

  const addLeadButton = (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-[6px] text-[#5a7d82] hover:text-[#0c1a1e] hover:bg-[rgba(0,0,0,0.02)] transition-all"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          <span className="sr-only">Add New Lead</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
          <DialogDescription>
            Enter the details for your new lead. They will be added to the Cold Lead column.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className={labelClass}>Name</Label>
            <Input
              id="name"
              placeholder="John Doe"
              value={newLead.name}
              onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className={labelClass}>Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={newLead.email}
              onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source" className={labelClass}>Source</Label>
            <Input
              id="source"
              placeholder="Instagram, Website, Referral..."
              value={newLead.source}
              onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes" className={labelClass}>Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add any relevant notes..."
              value={newLead.notes}
              onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsDialogOpen(false)}
            className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddLead}
            className="bg-[#0d9488] hover:bg-[#0d9488]/90 text-white"
          >
            Add Lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const pageHeader = (
    <PageHeader
      title="CRM Pipeline"
      description="Track leads through your sales funnel"
    />
  )

  return (
    <AppLayout pageHeader={pageHeader} headerActions={addLeadButton}>
      <div className="space-y-6">
        {/* Kanban Board */}
        <div className="grid gap-4 lg:grid-cols-4">
          {columns.map((column) => (
            <div
              key={column.id}
              className="flex flex-col"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.stage)}
            >
              <div className="flex items-center justify-between pb-3 border-b border-[rgba(13,148,136,0.08)] mb-3">
                <h3 className="text-[13.5px] font-semibold text-[#0c1a1e]">{column.title}</h3>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-[4px] bg-[rgba(13,148,136,0.05)] px-1.5 text-[11px] font-medium text-[#0d9488] font-mono-display">
                  {column.leads.length}
                </span>
              </div>
              <div className="flex-1 space-y-3">
                {column.leads.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-sm text-[#93b0b4]">
                    No leads yet
                  </div>
                ) : (
                  column.leads.map((lead) => <LeadCard key={lead.id} lead={lead} onDragStart={handleDragStart} />)
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Stats Summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {columns.map((column) => (
            <div key={`stat-${column.id}`} className="bg-white rounded-[6px] p-5">
              <div className="text-center">
                <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">{column.title}</p>
                <p className="mt-2 text-[28px] font-bold font-mono-display text-[#0c1a1e] leading-tight tracking-[-0.02em]">{column.leads.length}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
