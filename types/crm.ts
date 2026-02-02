export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  source?: string
  notes?: string
  stage: "cold" | "warm" | "booked" | "client"
}

export interface KanbanColumn {
  id: string
  title: string
  stage: Lead["stage"]
  leads: Lead[]
}
