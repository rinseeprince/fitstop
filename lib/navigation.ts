import { Home, Users, Library, KanbanSquare, MessageSquare, Zap, Mail, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  showBadge?: boolean
}

export const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "Clients", href: "/clients", icon: Users, showBadge: true },
  { name: "Content", href: "/dashboard/content", icon: Library },
  { name: "CRM", href: "/crm", icon: KanbanSquare },
  { name: "Messages", href: "/messages", icon: MessageSquare },
  { name: "Automation", href: "/automation", icon: Zap },
  { name: "Email Marketing", href: "/email", icon: Mail },
  { name: "Settings", href: "/settings", icon: Settings },
]
