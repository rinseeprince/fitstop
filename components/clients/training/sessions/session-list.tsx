"use client";

import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Trash2, GripVertical, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ManualSessionDraft } from "@/types/training";

type SessionListProps = {
  sessions: ManualSessionDraft[];
  onUpdateSession: (tempId: string, updates: Partial<ManualSessionDraft>) => void;
  onRemoveSession: (tempId: string) => void;
};

export const SessionList = memo(function SessionList({
  sessions,
  onUpdateSession,
  onRemoveSession,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-6 text-[12.5px] text-[#93b0b4]">
        Add sessions and rest days above to build your cycle.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session, idx) => {
        const isRest = !!session.isRest;
        return (
          <div
            key={session.tempId}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-[6px] border transition-colors",
              isRest
                ? "bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.2)]"
                : "bg-white border-[rgba(13,148,136,0.1)]"
            )}
          >
            <GripVertical className="h-4 w-4 text-[#93b0b4] flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#93b0b4] tabular-nums w-6 flex-shrink-0">
              {String(idx + 1).padStart(2, "0")}
            </span>

            {isRest ? (
              <div className="flex-1 flex items-center gap-2">
                <Moon className="h-3.5 w-3.5 text-[#64748b]" />
                <span className="text-[13px] font-medium text-[#64748b]">Rest Day</span>
              </div>
            ) : (
              <Input
                value={session.name}
                onChange={(e) =>
                  onUpdateSession(session.tempId, { name: e.target.value })
                }
                className="flex-1 h-8 text-[13px] font-medium border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:border-b focus-visible:border-[rgba(13,148,136,0.35)] rounded-none"
              />
            )}

            <button
              onClick={() => onRemoveSession(session.tempId)}
              className="p-1 text-[#93b0b4] hover:text-[#c06060] transition-colors"
              aria-label="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
});
