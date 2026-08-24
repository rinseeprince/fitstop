"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProgramDraft } from "./program-builder-types";
import {
  HEADER_EYEBROW_CLASS,
  INLINE_EDIT_DARK_CLASS,
} from "./builder-tokens";
import { DarkSurplusPill } from "./dark-surplus-pill";

// Builder hero — the slim dark program header. Eyebrow + the program NAME and
// FOCUS (both inline-editable in edit mode) · the default-surplus pill on the
// right. The weeks/sessions/per-week/assignments stat row was removed — it
// duplicated the Schedule divider on the right. Flat #0f2027 (design system —
// NOT the mockup's gradient/glow).
//
// The hero carries NO back arrow: the library panel's header arrow is the
// builder's single exit on every target (it is also the only one wired to the
// unsaved-changes guard), so a second one here read as a duplicate affordance.
type ProgramTopBarProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  // Name + focus are TEMPLATE identity — editable in the program builder, but
  // read-only in the client editor (the coach applies the template + adjusts
  // the training/surplus for the client, they don't rename the template).
  identityEditable?: boolean;
  // The default-surplus pill is a TEMPLATE concept: sessions inherit it at
  // placement time. A placed plan carries the RESOLVED value on every row
  // (surplus is absolute there), so the amendment surface hides the pill —
  // a dead knob would read as a bulk control and silently do nothing.
  showSurplus?: boolean;
  onRename: (name: string) => void;
  onFocusChange: (focus: string | null) => void;
  onDescriptionChange: (description: string | null) => void;
  onDefaultSurplusChange: (pct: number | null) => void;
};

// Multiline description on the dark band — same inline-edit language as name/
// focus, but muted and small so it reads as secondary. Overrides the shared
// Textarea's light border + min-height; caps its own height with a soft scroll.
const INLINE_DESC_CLASS =
  "-ml-1.5 mt-0.5 min-h-0 max-h-20 w-full resize-none overflow-y-auto rounded-[4px] border-0 bg-transparent px-1.5 py-0.5 text-[11.5px] leading-snug text-[rgba(255,255,255,0.72)] shadow-none outline-none transition-colors placeholder:text-[rgba(255,255,255,0.3)] focus:bg-[rgba(255,255,255,0.08)] focus:ring-0";

export function ProgramTopBar({
  draft,
  mode,
  identityEditable = true,
  showSurplus = true,
  onRename,
  onFocusChange,
  onDescriptionChange,
  onDefaultSurplusChange,
}: ProgramTopBarProps) {
  return (
    <div className="mb-4 flex items-center gap-4 overflow-hidden rounded-[6px] bg-[#0f2027] px-5 py-3">
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
        {mode === "edit" && identityEditable ? (
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
                INLINE_EDIT_DARK_CLASS,
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
              className={cn("text-[12.5px] leading-tight", INLINE_EDIT_DARK_CLASS)}
              onBlur={(e) => {
                const value = e.target.value.trim();
                onFocusChange(value === "" ? null : value);
              }}
            />
            <Textarea
              // Uncontrolled + keyed like name/focus; empty commits null.
              key={`desc-${draft.id}`}
              defaultValue={draft.description ?? ""}
              maxLength={500}
              rows={2}
              aria-label="Program description"
              placeholder="Add a description (optional)"
              className={INLINE_DESC_CLASS}
              onBlur={(e) => {
                const value = e.target.value.trim();
                onDescriptionChange(value === "" ? null : value);
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
            {draft.description && (
              <span className="line-clamp-2 text-[11.5px] leading-snug text-[rgba(255,255,255,0.5)]">
                {draft.description}
              </span>
            )}
          </>
        )}
      </div>

      {/* Default-surplus pill (editable — the header's only control) */}
      {showSurplus && (
        <div className="ml-auto">
          <DarkSurplusPill
            inputKey={`surplus-${draft.id}-${mode}`}
            value={draft.defaultSurplusPercentage}
            disabled={mode !== "edit"}
            // Blank means "no default" (null) — never coerce to a number.
            placeholder="—"
            ariaLabel="Default calorie surplus percent"
            onChange={onDefaultSurplusChange}
          />
        </div>
      )}
    </div>
  );
}
