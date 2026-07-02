"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import type { SavedSession } from "@/types/training";
import {
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "./builder-tokens";

// Rest-cell popover (mockup `pop`): pick a library session to clone into the
// day, or hand off to the routed create-blank slide-over. Anchored to the
// clicked cell via a virtual ref; Radix handles outside-click/Escape, and a
// capture-phase scroll listener closes it like the mockup (the anchor cell
// scrolls away under it otherwise).
export type AddSessionTarget = {
  slotUid: string;
  weekIndex: number;
  dayIndex: number;
  anchorEl: HTMLElement;
};

type AddSessionPopoverProps = {
  target: AddSessionTarget | null;
  onClose: () => void;
  onPickSession: (target: AddSessionTarget, session: SavedSession) => void;
  onCreateBlank: (target: AddSessionTarget) => void;
};

export function AddSessionPopover({
  target,
  onClose,
  onPickSession,
  onCreateBlank,
}: AddSessionPopoverProps) {
  const { sessions, isLoading } = useStandaloneSessions();
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Fresh search per open.
  useEffect(() => {
    if (target) setQuery("");
  }, [target]);

  // Close when the page/grid scrolls the anchor cell away (capture-phase —
  // element scrolls don't bubble but DO capture through window). Scrolls
  // originating INSIDE the popover (its own session list overflows) must not
  // close it, or sessions below the fold become unreachable.
  useEffect(() => {
    if (!target) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && contentRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [target, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.focus ?? "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  if (!target) return null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={{ current: target.anchorEl }} />
      <PopoverContent
        ref={contentRef}
        align="start"
        sideOffset={6}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
      >
        <div className="flex items-start justify-between px-3.5 pb-2 pt-3">
          <div>
            <div className={cn("text-sm font-semibold", TEXT_PRIMARY)}>
              Add session
            </div>
            <div className={cn("mt-0.5", MONO_LABEL_CLASS)}>
              Week {target.weekIndex + 1} · Day {target.dayIndex + 1}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:bg-[#f0f5f4] hover:text-[#5a7d82]"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-3.5 pb-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#93b0b4]"
              strokeWidth={1.5}
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions"
              className={cn("h-8 pl-8 text-xs", FOCUS_RING)}
            />
          </div>
        </div>

        <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5">
          {isLoading ? (
            <p className={cn("py-4 text-center text-xs", TEXT_MUTED)}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p className={cn("py-4 text-center text-xs", TEXT_MUTED)}>
              {sessions.length === 0
                ? "No saved sessions yet"
                : "No sessions match your search"}
            </p>
          ) : (
            filtered.map((session) => (
              <button
                key={session.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-[rgba(13,148,136,0.05)]"
                onClick={() => onPickSession(target, session)}
              >
                <span className="min-w-0">
                  <span className={cn("block truncate text-xs font-medium", TEXT_PRIMARY)}>
                    {session.name}
                  </span>
                  <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                    {session.exercises.length} exercises
                    {session.estimatedDurationMinutes != null &&
                      ` · ${session.estimatedDurationMinutes} min`}
                  </span>
                </span>
                {session.focus && (
                  <span className={cn("shrink-0", CHIP_NEUTRAL_CLASS)}>
                    {session.focus}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-[rgba(13,148,136,0.06)] p-1.5">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-xs font-semibold text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.05)]"
            onClick={() => onCreateBlank(target)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Create blank session
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
