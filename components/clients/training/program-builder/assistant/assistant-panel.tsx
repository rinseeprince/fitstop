"use client";

import { useId, type Ref } from "react";
import { ChevronDown, RotateCcw, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, HEADER_EYEBROW_CLASS, TEXT_SECONDARY } from "../builder-tokens";
import { useProgramDraft } from "../program-draft-provider";
import { useAssistant } from "./assistant-provider";
import { AssistantMessages } from "./assistant-messages";

// The program assistant's panel (builder S6a): header, transcript, composer.
// Every piece of its state is the provider's (assistant-provider.tsx) — the
// chat, whether it is open, the command being typed — so the panel shows the
// same conversation wherever it is mounted, and it is mounted by whichever
// surface is on top: the corner dock over the grid (assistant-dock.tsx), or
// the session sheet while a session is open, as a child of the sheet's own
// content (session-editor-sheet.tsx). Inside the sheet it is an ordinary
// descendant of the modal content, so Radix's pointer-events rule, focus trap,
// aria-hidden and scroll lock include it by construction: no layer of its own,
// nothing for the sheet to exempt.
//
// Escape collapses the panel through the key handler on its root — a handler
// on the panel, never a document listener. tabIndex -1 so a click anywhere in
// the panel puts focus inside it and the next Escape is the panel's. In the
// sheet, Radix's own document listener runs first and asks the sheet's
// onEscapeKeyDown, which declines a key pressed inside the panel so the sheet
// stays; the panel's handler then collapses it.
//
// Fixed height, not max-height: with max-h the panel collapsed to its content,
// so an empty conversation opened as a sliver and squashed the composer. The
// viewport cap keeps it usable on short screens. Focus is left where it was
// when the panel opens.
type AssistantPanelProps = {
  ref?: Ref<HTMLDivElement>;
  // The host's placement of the panel; the panel's own classes are the card.
  className?: string;
};

export function AssistantPanel({ ref, className }: AssistantPanelProps) {
  const { mode, setMode, isSaving } = useProgramDraft();
  const {
    messages,
    pending,
    busy,
    send,
    applyPending,
    dismissPending,
    undo,
    canUndo,
    setOpen,
    input,
    setInput,
  } = useAssistant();
  const titleId = useId();
  const descriptionId = useId();

  const canSend = mode === "edit" && !busy && !isSaving && input.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    void send(input);
    setInput("");
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      className={cn(
        "flex h-[540px] max-h-[calc(100vh-7rem)] w-[380px] flex-col overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white shadow-[0_10px_40px_rgba(13,148,136,0.18)] outline-none",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // The key stops at the panel: nothing above it in the React tree may
        // read it as its own.
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <p id={descriptionId} className="sr-only">
        Describe a change to the program and the assistant makes it.
      </p>
      <div className="flex items-center justify-between bg-[#0f2027] px-3 py-2.5">
        <div className="flex flex-col">
          <span className={HEADER_EYEBROW_CLASS}>Assistant</span>
          {/* The visible heading is the panel's accessible name. */}
          <h2 id={titleId} className="text-[13px] font-semibold text-white">
            Program assistant
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {canUndo && (
            <button
              type="button"
              title="Undo the last AI edit (also reverts your own edits made since it)"
              aria-label="Undo the last AI edit"
              // On-dark active-icon teal (#5eead4 mint is retired — see
              // the design doc's on-dark table).
              className="rounded p-1 text-[#0d9488] transition-colors hover:text-white"
              onClick={undo}
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
        messages={messages}
        pending={pending}
        busy={busy}
        onApplyPending={applyPending}
        onDismissPending={dismissPending}
        // Only wired in edit mode — AssistantMessages hides the starters
        // without a handler, so a click can never land on send()'s silent
        // mode guard and look like the button is broken.
        onPickSuggestion={
          mode === "edit" && !busy && !isSaving ? (text) => void send(text) : undefined
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
              // nativeEvent.isComposing: Enter during IME composition
              // commits the candidate word, it doesn't send the message.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
  );
}
