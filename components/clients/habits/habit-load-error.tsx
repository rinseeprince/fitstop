"use client";

import { Button } from "@/components/ui/button";

/**
 * A habit read that failed (docs/newdesignsystem.md → Loading & async states
 * → Errors): what failed, in plain words — never the fetch's own — and a
 * Retry, in the Habits tab's one treatment wherever a habit read can fail.
 */
export function HabitLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <p className="text-[13px] text-[#93b0b4]">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="text-[12px] border-[rgba(13,148,136,0.08)] text-[#5a7d82]">
        Retry
      </Button>
    </div>
  );
}
