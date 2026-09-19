"use client";

import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { AssistantPanel } from "./assistant-panel";

// The assistant's corner host (builder S6a): bottom-right over the grid, a
// launcher chip that expands into the panel (assistant-panel.tsx). Portaled to
// document.body — the proven DragOverlay pattern: in the client-draft mount an
// animated/transformed Dialog ancestor would hijack position:fixed and offset
// the corner. z-[60] sits above all z-50 builder chrome and below the z-[100]
// toast viewport (toasts transiently overlap the corner — accepted). Mounted
// only inside ProgramBuilder, under AssistantProvider, which owns whether the
// panel is open.
//
// One host at a time. While the session sheet is open this renders nothing:
// the sheet hosts the panel inside its own content, where the modal rules
// include it, and its footer button is the way in — the corner chip sat on top
// of that footer. The sheet's open flag is the one source both hosts read, so
// the panel is in exactly one of them on every frame. Over the grid the panel
// is a plain element with no layer of its own: nothing to out-rank, and a
// modal opened over it (a confirm, the duplicate-week dialog) covers it as it
// covers the grid.
type AssistantDockProps = {
  sessionSheetOpen: boolean;
};

export function AssistantDock({ sessionSheetOpen }: AssistantDockProps) {
  const { open, setOpen } = useAssistant();

  if (typeof document === "undefined" || sessionSheetOpen) return null;

  return createPortal(
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col items-end">
      {open ? (
        <AssistantPanel />
      ) : (
        <button
          type="button"
          aria-label="Open the program assistant"
          className="flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_6px_20px_rgba(13,148,136,0.25)] transition-colors hover:bg-[#0b7f75]"
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          Assistant
        </button>
      )}
    </div>,
    document.body,
  );
}
