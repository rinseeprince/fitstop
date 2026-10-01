"use client";

import { AlertCircle, Loader2 } from "lucide-react";

import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { cn } from "@/lib/utils";

/**
 * A client habit read that failed (docs/newdesignsystem.md → Loading & async
 * states → Errors): what failed in plain words, a muted hint, and Try again —
 * the habits page's and the Journey's one treatment. Never the empty state's
 * words: a failed read says nothing about the habits. While the read it asks
 * for is out (`retrying`), the button holds an inline spinner and waits.
 */
export function HabitsLoadError({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="py-12 text-center text-[#5a7d82]">
      <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-[13px]">We couldn&apos;t load your habits.</p>
      <p className="mt-1 text-[12px] text-[#93b0b4]">They didn&apos;t come back this time.</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75] disabled:cursor-not-allowed disabled:opacity-50",
          FOCUS_RING
        )}
      >
        {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Try again
      </button>
    </div>
  );
}
