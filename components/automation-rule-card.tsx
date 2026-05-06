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
    <div className="bg-white rounded-[6px] p-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-balance text-[#0c1a1e]">{rule.name}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]">
            <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 p-4 rounded-[6px] bg-[rgba(13,148,136,0.05)]">
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4] mb-1">WHEN</p>
            <p className="text-sm font-medium text-[#0c1a1e]">{rule.trigger.type}</p>
            <p className="text-xs text-[#5a7d82] mt-1">{rule.trigger.description}</p>
          </div>

          <ArrowRight className="h-5 w-5 text-[#0d9488] shrink-0 mx-auto sm:mx-0" strokeWidth={1.5} />

          <div className="flex-1 p-4 rounded-[6px] bg-[rgba(13,148,136,0.05)]">
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4] mb-1">THEN</p>
            <p className="text-sm font-medium text-[#0c1a1e]">{rule.action.type}</p>
            <p className="text-xs text-[#5a7d82] mt-1">{rule.action.description}</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={rule.isActive}
              onCheckedChange={(checked) => onToggle?.(rule.id, checked)}
              className="data-[state=checked]:bg-[#0d9488]"
            />
            <span className={`text-sm ${rule.isActive ? "text-[#0d9488] font-medium" : "text-[#93b0b4]"}`}>
              {rule.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <span className="text-xs text-[#93b0b4] font-mono-display">Created {rule.createdAt.toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}
