"use client";

import { ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSavedPlanAssignments } from "@/hooks/use-saved-plan-assignments";
import type { ProgramDraft } from "./program-builder-types";
import { FOCUS_RING, HEADER_EYEBROW_CLASS } from "./builder-tokens";

// Builder hero — the slim dark program header (mockup `.prog-head`): back
// arrow · eyebrow + inline-editable name · a mono stat row (weeks · sessions ·
// per-week · assignments) · the default-surplus control as a bordered pill on
// the right. Flat #0f2027 (design system — NOT the mockup's gradient/glow),
// rgba-white mutes. ALL program actions (Edit/Delete/Discard/Save) live on the
// SCHEDULE divider (roadmap pattern) — the header carries no buttons. No
// assign-to-client here (assignment lives in the client's planner, Phase 5).
type ProgramTopBarProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  onBack: () => void;
  // Client-draft returns to the library list, not /dashboard/programs.
  backLabel?: string;
  onRename: (name: string) => void;
  onDefaultSurplusChange: (pct: number | null) => void;
};

// rgba-white mutes on the dark band (design-system dark-surface text scale).
const STAT_MUTE = "text-[rgba(255,255,255,0.4)]";
const STAT_STRONG = "text-[rgba(255,255,255,0.92)] font-medium";

function Dot() {
  return <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-[rgba(255,255,255,0.2)]" />;
}

export function ProgramTopBar({
  draft,
  mode,
  onBack,
  backLabel = "Back to programs",
  onRename,
  onDefaultSurplusChange,
}: ProgramTopBarProps) {
  const { assignments } = useSavedPlanAssignments();
  const assignmentCount =
    assignments?.perPlan.find((p) => p.savedPlanId === draft.id)?.count ?? null;

  const trainingCount = draft.weeks.reduce(
    (sum, w) => sum + w.days.filter((d) => !d.isRest).length,
    0,
  );
  // Always one decimal ("4.3/wk").
  const perWeek = (trainingCount / draft.weeks.length).toFixed(1);

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

      {/* Eyebrow + name */}
      <div className="flex min-w-0 shrink flex-col">
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
          <Input
            // Uncontrolled + keyed so reseeding picks up a fresh name; commit
            // on blur (empty falls back rather than violating name min(1)).
            key={`name-${draft.id}`}
            defaultValue={draft.name}
            maxLength={100}
            aria-label="Program name"
            className={cn(
              "mt-0.5 h-auto border-0 bg-transparent p-0 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white shadow-none placeholder:text-[rgba(255,255,255,0.35)]",
              FOCUS_RING,
            )}
            onBlur={(e) => {
              const value = e.target.value.trim() || "Untitled program";
              // Write the committed value back so the (uncontrolled) input
              // can never display blank while the draft holds the fallback.
              e.target.value = value;
              onRename(value);
            }}
          />
        ) : (
          <span className="mt-0.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {draft.name}
          </span>
        )}
      </div>

      {/* Inline stat row */}
      <div
        className={cn(
          "ml-1 hidden shrink-0 items-center gap-2 whitespace-nowrap font-mono-display text-[11px] md:flex",
          STAT_MUTE,
        )}
      >
        <span>
          <b className={STAT_STRONG}>{draft.weeks.length}</b>{" "}
          {draft.weeks.length === 1 ? "week" : "weeks"}
        </span>
        <Dot />
        <span>
          <b className={STAT_STRONG}>{trainingCount}</b>{" "}
          {trainingCount === 1 ? "session" : "sessions"}
        </span>
        <Dot />
        <span>
          <b className={STAT_STRONG}>{perWeek}</b>/wk
        </span>
        <Dot />
        <span>
          <b className={STAT_STRONG}>{assignmentCount ?? "—"}</b>{" "}
          {assignmentCount === 1 ? "active client" : "active clients"}
        </span>
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
