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
// by ProgramBuilder, under AssistantProvider, which owns whether the panel is
// open.
//
// One host at a time. While a sheet is over the builder this renders nothing.
// The session sheet and the create-session slide-over host the panel inside
// their own content, where the modal rules include it, and their footer button
// is the way in; the library's session editor offers no assistant, because it
// edits a library session and the assistant edits only the program. The corner
// chip sat on top of each one's footer and took no clicks under its modal.
// `sheetOpen` is derived by ProgramBuilder from each sheet's one owner, the
// same source the sheet reads, so the panel is in exactly one host on every
// frame. Over the grid the panel is a plain element with no layer of its own.
type AssistantDockProps = {
  sheetOpen: boolean;
};

export function AssistantDock({ sheetOpen }: AssistantDockProps) {
  const { open, setOpen } = useAssistant();

  if (typeof document === "undefined" || sheetOpen) return null;

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
