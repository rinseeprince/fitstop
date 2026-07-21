"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { MONO_LABEL_CLASS, TEXT_PRIMARY, TEXT_SECONDARY } from "../builder-tokens";
import type {
  AssistantChatMessage,
  PendingAssistantOps,
} from "./use-assistant-chat";

// Message thread + the preview-gate panel for the assistant dock. Pure
// presentation — all state lives in use-assistant-chat.

// Starter commands for the empty state. Picking one SENDS it, so every entry
// must be a complete, self-contained instruction — nothing that needs the coach
// to name a target first ("swap an exercise" for what?), or the assistant would
// have to come back asking, which is worse than the friction it saved. They
// double as a lesson in the command style, so they're phrased the way a coach
// actually speaks, and each maps onto a different tool so the set demonstrates
// range rather than five ways to do one thing.
const SUGGESTIONS = [
  "Add 2 more weeks",
  "Increase load 5% each week",
  "Add a set to every compound",
  "Add a warm-up set to every compound",
  "Make the last week a deload",
] as const;

type AssistantMessagesProps = {
  messages: AssistantChatMessage[];
  pending: PendingAssistantOps | null;
  busy: boolean;
  onApplyPending: () => void;
  onDismissPending: () => void;
  onPickSuggestion?: (text: string) => void;
};

export function AssistantMessages({
  messages,
  pending,
  busy,
  onApplyPending,
  onDismissPending,
  onPickSuggestion,
}: AssistantMessagesProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Optional-call: jsdom doesn't implement scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending, busy]);

  return (
    <div className="scrollbar-none flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
      {messages.length === 0 && !busy && (
        // Centred in the empty panel so the composer keeps its full height.
        <div className="flex h-full flex-col items-center justify-center gap-3 px-2">
          <p className={cn("text-center text-[12px]", TEXT_SECONDARY)}>
            Tell me what to change.
          </p>
          {/* No handler = not sendable right now (view mode, or a turn in
              flight): show the prompt without starters that would do nothing. */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {onPickSuggestion &&
              SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  // rounded-[6px], not a pill: the design system reserves
                  // rounded-full for circles.
                  className="rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:text-[#0d9488]"
                  onClick={() => onPickSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
          </div>
        </div>
      )}
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-[6px] bg-[#0d9488] px-2.5 py-1.5 text-[12px] leading-relaxed text-white">
              {message.text}
            </div>
          </div>
        ) : (
          <div key={message.id} className="flex flex-col items-start gap-1">
            <div
              className={cn(
                "max-w-[92%] whitespace-pre-wrap rounded-[6px] bg-[#f0f5f4] px-2.5 py-1.5 text-[12px] leading-relaxed",
                TEXT_PRIMARY,
              )}
            >
              {message.text}
            </div>
            {message.applied != null && (
              <span className={MONO_LABEL_CLASS}>
                {message.applied} edit{message.applied === 1 ? "" : "s"} applied
              </span>
            )}
            {message.skipped
              ?.filter(Boolean)
              .map((reason, i) => (
                <span
                  key={`${message.id}-skip-${i}`}
                  className="text-[10px] leading-snug text-[#c06060]"
                >
                  ⊘ {reason}
                </span>
              ))}
          </div>
        ),
      )}

      {pending && (
        <div className="rounded-[6px] border border-[rgba(13,148,136,0.15)] bg-white p-2.5">
          <div className={MONO_LABEL_CLASS}>
            {pending.reason === "destructive"
              ? "Review — includes destructive edits"
              : "Review — you edited while I was working"}
          </div>
          <ul className="mt-1.5 space-y-1">
            {pending.labels.map((label, i) => (
              <li key={i} className={cn("text-[11px] leading-snug", TEXT_PRIMARY)}>
                • {label}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-[6px] bg-[#0d9488] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#0b7f75]"
              onClick={onApplyPending}
            >
              Apply all
            </button>
            <button
              type="button"
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors hover:text-[#c06060]",
                TEXT_SECONDARY,
              )}
              onClick={onDismissPending}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className={cn("flex items-center gap-1.5 px-1 text-[11px]", TEXT_SECONDARY)}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0d9488]" />
          Working on it…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
