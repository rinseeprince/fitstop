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

type AssistantMessagesProps = {
  messages: AssistantChatMessage[];
  pending: PendingAssistantOps | null;
  busy: boolean;
  onApplyPending: () => void;
  onDismissPending: () => void;
};

export function AssistantMessages({
  messages,
  pending,
  busy,
  onApplyPending,
  onDismissPending,
}: AssistantMessagesProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Optional-call: jsdom doesn't implement scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending, busy]);

  return (
    <div className="scrollbar-none flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
      {messages.length === 0 && !busy && (
        <p className={cn("px-1 py-2 text-[12px] leading-relaxed", TEXT_SECONDARY)}>
          Tell me what to change — &ldquo;duplicate week 2 three times, adding 2kg
          each week&rdquo;, &ldquo;swap leg press for hack squat in week 1&rdquo;,
          &ldquo;add a warm-up set to every compound&rdquo;.
        </p>
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
