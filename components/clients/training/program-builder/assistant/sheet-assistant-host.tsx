"use client";

import { useCallback, useRef, type RefObject } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-provider";
import { AssistantPanel } from "./assistant-panel";

// A sheet over the builder that hosts the program assistant's panel: the
// session sheet (session-editor-sheet.tsx) and the create-blank-session
// slide-over (create-session-slide-over.tsx), one shape for both. A sheet is a
// modal layer, so a panel anywhere else on the page would be given no pointer
// events, bounced out of by the focus trap, hidden from screen readers and
// locked out of wheel scrolling. As a child of the sheet's own content it is
// inside every one of those rules by construction; the conversation is the
// provider's, so it is the one the corner dock showed, and the dock steps aside
// while any sheet is over the builder (program-builder.tsx).
//
// The content is a STILL FRAME and the body inside it is what slides. The
// content is the modal's scope and the panel's anchor, so it must not move
// while the sheet arrives: a panel anchored to a sliding content rode in from
// the right edge with it (the owner's veto, 2026-09-19). So the content carries
// no entrance of its own while open (inline, because the base sheet's entrance
// is a class the class merge does not know), shows nothing of its own and holds
// the panel, while the body carries the sheet's look and its slide-in beneath
// the panel. Anything that should arrive with the sheet — its close included —
// lives in the body.

/** The sheet content: a transparent frame the width of the 780px sheet. */
export const ASSISTANT_SHEET_CONTENT_CLASS =
  "w-full gap-0 bg-transparent p-0 shadow-none sm:w-[780px] sm:max-w-full";

/** The content's style while open: no entrance of its own. */
export const ASSISTANT_SHEET_STILL = { animation: "none" } as const;

/** The body: the sheet's look and its slide-in; each sheet adds its own background. */
export const ASSISTANT_SHEET_BODY_CLASS =
  "relative flex h-full min-h-0 flex-col shadow-lg ease-in-out duration-500 animate-in slide-in-from-right";

/**
 * The hosted panel's ref and Escape rule. Radix brings every Escape on the
 * page to the top layer — the sheet. One pressed inside the hosted panel is the
 * panel's to answer (its own key handler collapses it), so the sheet declines
 * it; anywhere else in the sheet, the sheet's own rule stands.
 */
export function useSheetAssistantHost() {
  const panelRef = useRef<HTMLDivElement>(null);
  const escapeWasInPanel = useCallback(
    (event: KeyboardEvent) =>
      event.target instanceof Node && panelRef.current?.contains(event.target) === true,
    [],
  );
  return { panelRef, escapeWasInPanel };
}

/**
 * The hosted panel, anchored to the still content and last in it so the tab
 * order reaches it after the footer. The content is flush with the viewport's
 * right and bottom edges, so bottom-5 right-5 here is the corner the dock uses
 * over the grid: the panel keeps its pixels while the body slides in beneath
 * it. z-10 paints it over everything in the body, whose pinned set cells carry
 * a z-index of their own (PINNED_CELL_CLASS in set-row-editor.tsx). `hosting`
 * is the sheet's open flag, never its content: a closing sheet keeps its
 * content for its slide-out but hands the panel back to the corner dock in the
 * same commit, so there is one panel on every frame.
 */
export function SheetAssistantPanel({
  hosting,
  panelRef,
}: {
  hosting: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const { open } = useAssistant();
  if (!hosting || !open) return null;
  return <AssistantPanel ref={panelRef} className="absolute bottom-5 right-5 z-10" />;
}

/**
 * The way in while a sheet is up, first in its footer: the corner chip sat on
 * top of the footer, so it steps aside and this is the one button.
 */
export function SheetAssistantButton() {
  const { setOpen } = useAssistant();
  return (
    <Button variant="outline" onClick={() => setOpen(true)}>
      <Sparkles className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
      Assistant
    </Button>
  );
}
