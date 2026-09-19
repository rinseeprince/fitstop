"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, RotateCcw, SendHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, HEADER_EYEBROW_CLASS, TEXT_SECONDARY } from "../builder-tokens";
import { useProgramDraft } from "../program-draft-provider";
import { useAssistantChat } from "./use-assistant-chat";
import { AssistantMessages } from "./assistant-messages";

// The AI assistant dock (builder S6a): a launcher chip bottom-right that
// expands into a chat panel. Portaled to document.body — the proven
// DragOverlay pattern: in the client-draft mount an animated/transformed
// Dialog ancestor would hijack position:fixed and offset the panel. z-[60]
// sits above all z-50 builder chrome and below the z-[100] toast viewport
// (toasts transiently overlap the corner — accepted). Mounted only inside
// ProgramBuilder, so useProgramDraft context always resolves.
//
// The open panel is a Radix layer of its own — a non-modal Dialog with no
// overlay — because the session editor is a MODAL sheet: Radix switches
// pointer events off for everything outside the top-most modal layer and
// bounces focus back into it, so a plain div over the sheet could be neither
// clicked (its chevron included) nor typed into. A layer registered after the
// sheet's gets pointer events and pauses the sheet's focus trap while it is
// open; the sheet, for its part, treats a press in the panel as no outside
// click (lib/outside-interaction.ts). The layer is keyed on the sheet being
// open so it re-registers ABOVE a sheet opened while the panel was already
// up. Escape collapses the panel — the top-most layer — and a second Escape
// reaches the sheet. Nothing about the panel is an address: `open` is lifted
// so the session sheet's footer button can open it, and `sessionSheetOpen`
// also hides the fixed corner chip while that sheet is up, where it sat on
// top of the sheet's own footer actions.
type AssistantDockProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionSheetOpen?: boolean;
};

export function AssistantDock({
  open,
  onOpenChange,
  sessionSheetOpen = false,
}: AssistantDockProps) {
  const { mode, setMode, isSaving } = useProgramDraft();
  const chat = useAssistantChat();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  if (typeof document === "undefined") return null;

  const canSend = mode === "edit" && !chat.busy && !isSaving && input.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    void chat.send(input);
    setInput("");
  };

  return createPortal(
    <div data-assistant-dock="" className="fixed bottom-5 right-5 z-[60] flex flex-col items-end">
      {open ? (
        <DialogPrimitive.Root
          key={sessionSheetOpen ? "over-sheet" : "over-grid"}
          open
          modal={false}
          onOpenChange={(next) => {
            if (!next) onOpenChange(false);
          }}
        >
          {/* Fixed height, not max-height: with max-h the panel collapsed to
              its content, so an empty conversation opened as a sliver and
              squashed the composer. The viewport cap keeps it usable on short
              screens. No Portal of its own — the dock is already on the body —
              and no overlay: the panel floats over whatever is open. Clicks
              and focus elsewhere never collapse it; only the chevron and
              Escape do. Focus is left where it was on open and on close, so
              re-registering over a sheet steals nothing from it. */}
          <DialogPrimitive.Content
            className="flex h-[540px] max-h-[calc(100vh-7rem)] w-[380px] flex-col overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white shadow-[0_10px_40px_rgba(13,148,136,0.18)] outline-none"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DialogPrimitive.Description className="sr-only">
              Describe a change to the program and the assistant makes it.
            </DialogPrimitive.Description>
          <div className="flex items-center justify-between bg-[#0f2027] px-3 py-2.5">
            <div className="flex flex-col">
              <span className={HEADER_EYEBROW_CLASS}>Assistant</span>
              {/* The visible heading is the dialog's own title. */}
              <DialogPrimitive.Title className="text-[13px] font-semibold text-white">
                Program assistant
              </DialogPrimitive.Title>
            </div>
            <div className="flex items-center gap-1">
              {chat.canUndo && (
                <button
                  type="button"
                  title="Undo the last AI edit (also reverts your own edits made since it)"
                  aria-label="Undo the last AI edit"
                  // On-dark active-icon teal (#5eead4 mint is retired — see
                  // the design doc's on-dark table).
                  className="rounded p-1 text-[#0d9488] transition-colors hover:text-white"
                  onClick={chat.undo}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                aria-label="Collapse assistant"
                className="rounded p-1 text-[#93b0b4] transition-colors hover:text-white"
                onClick={() => onOpenChange(false)}
              >
                <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <AssistantMessages
            messages={chat.messages}
            pending={chat.pending}
            busy={chat.busy}
            onApplyPending={chat.applyPending}
            onDismissPending={chat.dismissPending}
            // Only wired in edit mode — AssistantMessages hides the starters
            // without a handler, so a click can never land on send()'s silent
            // mode guard and look like the button is broken.
            onPickSuggestion={
              mode === "edit" && !chat.busy && !isSaving
                ? (text) => void chat.send(text)
                : undefined
            }
          />

          {mode === "view" ? (
            <div className="flex items-center justify-between gap-2 border-t border-[rgba(13,148,136,0.08)] px-3 py-2.5">
              <span className={cn("text-[11px]", TEXT_SECONDARY)}>
                Switch to edit mode to make changes.
              </span>
              <button
                type="button"
                className="rounded-[6px] bg-[#0d9488] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#0b7f75]"
                onClick={() => setMode("edit")}
              >
                Switch to edit
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2 border-t border-[rgba(13,148,136,0.08)] px-3 py-2.5">
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                // Mirrors the route's zod cap so an over-long command is
                // prevented, not rejected with a generic 400.
                maxLength={2000}
                placeholder="Describe the change…"
                className={cn(
                  "min-h-[38px] flex-1 resize-none rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white px-2 py-1.5 text-[12px] leading-snug text-[#0c1a1e] placeholder:text-[#93b0b4]",
                  FOCUS_RING,
                )}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Esc collapses the dock through its own Radix layer (the
                  // top-most one, so the sheet under it stays). It must never
                  // fall through React's tree to the client-draft overlay's
                  // (deliberately guarded) leave path.
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    return;
                  }
                  // nativeEvent.isComposing: Enter during IME composition
                  // commits the candidate word, it doesn't send the message.
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Send"
                disabled={!canSend}
                className="rounded-[6px] bg-[#0d9488] p-2 text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-40"
                onClick={submit}
              >
                <SendHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Root>
      ) : sessionSheetOpen ? null : (
        <button
          type="button"
          aria-label="Open the program assistant"
          className="flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_6px_20px_rgba(13,148,136,0.25)] transition-colors hover:bg-[#0b7f75]"
          onClick={() => onOpenChange(true)}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          Assistant
        </button>
      )}
    </div>,
    document.body,
  );
}
