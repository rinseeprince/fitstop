import { Home, Users, Dumbbell, Library, KanbanSquare, Zap, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  showBadge?: boolean
  beta?: boolean
}

export const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "Clients", href: "/clients", icon: Users, showBadge: true },
  { name: "Programs", href: "/dashboard/programs", icon: Dumbbell },
  { name: "Content", href: "/dashboard/content", icon: Library },
  { name: "CRM", href: "/crm", icon: KanbanSquare, beta: true },
  { name: "Automation", href: "/automation", icon: Zap, beta: true },
  { name: "Settings", href: "/settings", icon: Settings },
]
