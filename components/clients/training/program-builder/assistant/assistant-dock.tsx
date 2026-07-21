"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
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
// ProgramBuilder, so useProgramDraft context always resolves; in the
// client-draft overlay it exists only in editor state, where the Dialog is
// non-modal (modal={false}) and body-portaled content stays interactive.

export function AssistantDock() {
  const { mode, setMode, isSaving } = useProgramDraft();
  const chat = useAssistantChat();
  const [open, setOpen] = useState(false);
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
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col items-end">
      {open ? (
        // Fixed height, not max-height: with max-h the panel collapsed to its
        // content, so an empty conversation opened as a sliver and squashed the
        // composer. The viewport cap keeps it usable on short screens.
        <div className="flex h-[540px] max-h-[calc(100vh-7rem)] w-[380px] flex-col overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white shadow-[0_10px_40px_rgba(13,148,136,0.18)]">
          <div className="flex items-center justify-between bg-[#0f2027] px-3 py-2.5">
            <div className="flex flex-col">
              <span className={HEADER_EYEBROW_CLASS}>Assistant</span>
              <span className="text-[13px] font-semibold text-white">
                Program assistant
              </span>
            </div>
            <div className="flex items-center gap-1">
              {chat.canUndo && (
                <button
                  type="button"
                  title="Undo the last AI edit (also reverts your own edits made since it)"
                  aria-label="Undo the last AI edit"
                  className="rounded p-1 text-[#5eead4] transition-colors hover:text-white"
                  onClick={chat.undo}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                aria-label="Collapse assistant"
                className="rounded p-1 text-[#93b0b4] transition-colors hover:text-white"
                onClick={() => setOpen(false)}
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
                  // Esc collapses the dock and must never fall through to the
                  // client-draft overlay's (deliberately guarded) leave path.
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
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
        </div>
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
