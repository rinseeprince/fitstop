import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function NutritionPlanCard() {
  return (
    <Link
      href="/client/program/nutrition"
      className="block rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-semibold text-foreground">
            Nutrition plan
          </span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
