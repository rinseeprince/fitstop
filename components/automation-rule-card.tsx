import { Card, CardContent } from "./ui/card"
import { Button } from "./ui/button"
import { Switch } from "./ui/switch"
import { ArrowRight, MoreVertical } from "lucide-react"
import type { AutomationRule } from "@/types/automation"

interface AutomationRuleCardProps {
  rule: AutomationRule
  onToggle?: (id: string, isActive: boolean) => void
}

export function AutomationRuleCard({ rule, onToggle }: AutomationRuleCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-balance">{rule.name}</h3>
            <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 p-4 rounded-lg border bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-1">WHEN</p>
              <p className="text-sm font-medium">{rule.trigger.type}</p>
              <p className="text-xs text-muted-foreground mt-1">{rule.trigger.description}</p>
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0 mx-auto sm:mx-0" />

            <div className="flex-1 p-4 rounded-lg border bg-primary/5">
              <p className="text-xs font-medium text-muted-foreground mb-1">THEN</p>
              <p className="text-sm font-medium">{rule.action.type}</p>
              <p className="text-xs text-muted-foreground mt-1">{rule.action.description}</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Switch checked={rule.isActive} onCheckedChange={(checked) => onToggle?.(rule.id, checked)} />
              <span className="text-sm text-muted-foreground">{rule.isActive ? "Active" : "Inactive"}</span>
            </div>
            <span className="text-xs text-muted-foreground">Created {rule.createdAt.toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
