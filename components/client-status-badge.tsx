import { Badge } from "./ui/badge"
import { cn } from "@/lib/utils"

type ClientStatus = "active" | "lead" | "inactive"

interface ClientStatusBadgeProps {
  status: ClientStatus
}

export function ClientStatusBadge({ status }: ClientStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        status === "active" && "border-success text-success bg-success/10",
        status === "lead" && "border-warning text-warning bg-warning/10",
        status === "inactive" && "border-muted-foreground text-muted-foreground bg-muted",
      )}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}
