"use client";

import { ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProgramDraft } from "./program-builder-types";
import { FOCUS_RING, HEADER_EYEBROW_CLASS } from "./builder-tokens";

// Builder hero — the slim dark program header. Back arrow · eyebrow + the
// program NAME and FOCUS (both inline-editable in edit mode) · the default-
// surplus pill on the right. The weeks/sessions/per-week/assignments stat row
// was removed — it duplicated the Schedule divider on the right. Flat #0f2027
// (design system — NOT the mockup's gradient/glow).
type ProgramTopBarProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  onBack: () => void;
  // Client-draft returns to the library list, not /dashboard/programs.
  backLabel?: string;
  onRename: (name: string) => void;
  onFocusChange: (focus: string | null) => void;
  onDefaultSurplusChange: (pct: number | null) => void;
};

// rgba-white mute on the dark band (design-system dark-surface text scale).
const STAT_MUTE = "text-[rgba(255,255,255,0.4)]";

// Inline-editable text on the dark band — no boxy ring, a faint white wash on
// focus so it reads as an editable field without looking like a form input.
const INLINE_EDIT_CLASS =
  "-ml-1.5 h-auto w-full rounded-[4px] border-0 bg-transparent px-1.5 py-0.5 text-white shadow-none outline-none transition-colors placeholder:text-[rgba(255,255,255,0.35)] focus:bg-[rgba(255,255,255,0.08)]";

export function ProgramTopBar({
  draft,
  mode,
  onBack,
  backLabel = "Back to programs",
  onRename,
  onFocusChange,
  onDefaultSurplusChange,
}: ProgramTopBarProps) {
  return (
    <div className="mb-4 flex items-center gap-4 overflow-hidden rounded-[6px] bg-[#0f2027] px-5 py-3">
      <button
        type="button"
        aria-label={backLabel}
        className="shrink-0 rounded p-1 text-[rgba(255,255,255,0.45)] transition-colors hover:text-white"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {/* Eyebrow + name + focus — fills the width up to the surplus pill so a
          long focus doesn't truncate at half the header. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className={HEADER_EYEBROW_CLASS}>Program</span>
          {draft.status === "draft" && (
            <Badge
              variant="outline"
              className="border-[rgba(255,255,255,0.2)] px-1.5 py-0 text-[9px] text-[rgba(255,255,255,0.6)]"
            >
              Draft
            </Badge>
          )}
        </span>
        {mode === "edit" ? (
          <>
            <Input
              // Uncontrolled + keyed so reseeding picks up a fresh name; commit
              // on blur (empty falls back rather than violating name min(1)).
              key={`name-${draft.id}`}
              defaultValue={draft.name}
              maxLength={100}
              aria-label="Program name"
              className={cn(
                "text-[17px] font-semibold leading-tight tracking-[-0.01em]",
                INLINE_EDIT_CLASS,
              )}
              onBlur={(e) => {
                const value = e.target.value.trim() || "Untitled program";
                // Write the committed value back so the (uncontrolled) input
                // can never display blank while the draft holds the fallback.
                e.target.value = value;
                onRename(value);
              }}
            />
            <Input
              // Free-text focus; empty commits null (no focus).
              key={`focus-${draft.id}`}
              defaultValue={draft.splitType ?? ""}
              maxLength={100}
              aria-label="Program focus"
              placeholder="Add a focus (e.g. Push/Pull)"
              className={cn("text-[12.5px] leading-tight", INLINE_EDIT_CLASS)}
              onBlur={(e) => {
                const value = e.target.value.trim();
                onFocusChange(value === "" ? null : value);
              }}
            />
          </>
        ) : (
          <>
            <span className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
              {draft.name}
            </span>
            {draft.splitType && (
              <span className="truncate text-[12.5px] leading-tight text-[rgba(255,255,255,0.55)]">
                {draft.splitType}
              </span>
            )}
          </>
        )}
      </div>

      {/* Default-surplus pill (editable — the header's only control) */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[rgba(255,255,255,0.14)] px-2.5 py-1">
        <span className={cn("font-mono-display text-[10px] uppercase tracking-[0.08em]", STAT_MUTE)}>
          Surplus
        </span>
        <Input
          key={`surplus-${draft.id}-${mode}`}
          type="number"
          min={0}
          max={100}
          step={0.5}
          disabled={mode !== "edit"}
          // Blank means "no default" (null) — never coerce to a number.
          defaultValue={draft.defaultSurplusPercentage ?? ""}
          placeholder="—"
          aria-label="Default calorie surplus percent"
          className={cn(
            "h-6 w-10 border-0 bg-transparent px-0 text-center font-mono-display text-xs text-white shadow-none placeholder:text-[rgba(255,255,255,0.35)]",
            FOCUS_RING,
          )}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onDefaultSurplusChange(null);
              return;
            }
            const parsed = Number(raw);
            const clamped = Number.isFinite(parsed)
              ? Math.min(100, Math.max(0, parsed))
              : null;
            onDefaultSurplusChange(clamped);
            e.target.value = clamped == null ? "" : String(clamped);
          }}
        />
        <span className={cn("text-[10px]", STAT_MUTE)}>%</span>
      </div>
    </div>
  );
}
