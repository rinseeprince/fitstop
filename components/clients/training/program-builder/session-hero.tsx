"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DarkSurplusPill } from "./dark-surplus-pill";
import {
  HEADER_EYEBROW_CLASS,
  HERO_DOT_CLASS,
  INLINE_EDIT_DARK_CLASS,
  MONO,
} from "./builder-tokens";

// Session-editor hero — the builder top-bar grammar at sheet scale. It replaces
// the white sheet header AND absorbs two fields that used to sit in the body's
// four-up grid: the session name (now the inline-edit title) and the calorie
// surplus (now the pill). The body keeps focus + duration.
//
// Only the 780px session-editor Sheet mounts this. The other three surfaces
// that share SessionEditorBody (create-session slide-over, placed-session
// editor, standalone Sessions-page editor) keep their white headers and the
// body's inline name/surplus fields — see SessionEditorBody's identityLocation.
//
// The meta row splits its typography rather than taking one class: "4
// exercises" and "60 min" are number-bearing data (mono), the focus is a
// word-only string (sans). Mono is numbers only.
type SessionHeroProps = {
  // Keys the uncontrolled inputs so opening a different session reseeds them.
  sessionUid: string;
  name: string;
  focus: string | null;
  exerciseCount: number;
  durationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  // What a blank surplus inherits from; drives the placeholder only.
  defaultSurplusPercentage: number | null;
  editable: boolean;
  // Session name is TEMPLATE identity — read-only in the client editor.
  identityEditable: boolean;
  onRename: (name: string) => void;
  onSurplusChange: (pct: number | null) => void;
  onClose: () => void;
};

export function SessionHero({
  sessionUid,
  name,
  focus,
  exerciseCount,
  durationMinutes,
  calorieSurplusPercentage,
  defaultSurplusPercentage,
  editable,
  identityEditable,
  onRename,
  onSurplusChange,
  onClose,
}: SessionHeroProps) {
  const nameEditable = editable && identityEditable;

  return (
    <div className="flex shrink-0 items-start gap-4 bg-[#0f2027] px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={HEADER_EYEBROW_CLASS}>Session</span>

        {nameEditable ? (
          <Input
            key={`hero-name-${sessionUid}`}
            defaultValue={name}
            maxLength={100}
            aria-label="Session name"
            className={cn(
              "text-[17px] font-semibold leading-tight tracking-[-0.01em]",
              INLINE_EDIT_DARK_CLASS,
            )}
            onFocus={(e) => {
              // Select-all so the coach types OVER the name rather than
              // deleting it; a programmatic focus just highlights.
              e.target.select();
            }}
            onBlur={(e) => {
              const value = e.target.value.trim() || name;
              // Write the committed value back so the uncontrolled input can
              // never show blank while the draft holds the fallback.
              e.target.value = value;
              onRename(value);
            }}
          />
        ) : (
          <span className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {name}
          </span>
        )}

        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px]">
          <span className={cn(MONO, "shrink-0 text-[rgba(255,255,255,0.4)]")}>
            <span className="font-medium text-[rgba(255,255,255,0.92)]">
              {exerciseCount}
            </span>{" "}
            {exerciseCount === 1 ? "exercise" : "exercises"}
          </span>
          {durationMinutes != null && (
            <>
              <span className={HERO_DOT_CLASS} />
              <span className={cn(MONO, "shrink-0 text-[rgba(255,255,255,0.4)]")}>
                <span className="font-medium text-[rgba(255,255,255,0.92)]">
                  {durationMinutes}
                </span>{" "}
                min
              </span>
            </>
          )}
          {focus && (
            <>
              <span className={HERO_DOT_CLASS} />
              {/* Word-only, so sans — not the mono the numeric segments take. */}
              <span className="truncate text-[rgba(255,255,255,0.4)]">
                {focus}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        <DarkSurplusPill
          inputKey={`hero-surplus-${sessionUid}-${editable}`}
          value={calorieSurplusPercentage}
          disabled={!editable}
          placeholder={
            defaultSurplusPercentage != null
              ? `${defaultSurplusPercentage}`
              : "—"
          }
          ariaLabel="Calorie surplus percent"
          onChange={onSurplusChange}
        />
        <button
          type="button"
          aria-label="Close session editor"
          className="rounded p-1 text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
          onClick={onClose}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
