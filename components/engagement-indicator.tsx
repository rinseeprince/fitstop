import { cn } from "@/lib/utils"

type EngagementLevel = "low" | "medium" | "high"

interface EngagementIndicatorProps {
  level: EngagementLevel
}

export function EngagementIndicator({ level }: EngagementIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3].map((bar) => (
          <div
            key={bar}
            className={cn(
              "h-4 w-1.5 rounded-full",
              bar <= (level === "low" ? 1 : level === "medium" ? 2 : 3)
                ? level === "high"
                  ? "bg-success"
                  : level === "medium"
                    ? "bg-warning"
                    : "bg-destructive"
                : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="text-sm capitalize text-muted-foreground">{level}</span>
    </div>
  )
}
