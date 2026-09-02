"use client";

import { useEffect, useState } from "react";
import { Send, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { ReviewProse } from "./review-block";

type CheckInReplyBlockProps = {
  checkInId: string;
  clientName: string;
  /** The AI-drafted message. */
  draft: string;
  /** What the coach has already sent, if anything. */
  sentMessage?: string;
  /** When it was sent. Both are present together or neither is. */
  sentAt?: string;
  /** The reply landed — the review is done. */
  onSent?: () => void;
};

/**
 * The coach's reply, and the destination of the whole page: everything above it
 * is what they read before writing this.
 *
 * A sent reply does NOT lock the block. A coach can follow up, so the previous
 * message becomes context above a live box rather than a closed state — what
 * changes is that the rail dates it and the button says which kind of message
 * this is.
 */
export const CheckInReplyBlock = ({
  checkInId,
  clientName,
  draft,
  sentMessage,
  sentAt,
  onSent,
}: CheckInReplyBlockProps) => {
  const [message, setMessage] = useState(draft);
  const [isSending, setIsSending] = useState(false);

  // The draft is a PROP and `useState` only seeds from it once, so a Regenerate
  // upstream would leave this box showing — and sending — the previous draft.
  // Deliberately an effect rather than a `key` reset on the parent: a remount
  // would also drop `isSending` if a regenerate landed mid-send.
  useEffect(() => {
    setMessage(draft);
  }, [draft]);

  const hasSent = Boolean(sentAt);

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error("Write a message before sending");
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch(`/api/check-in/${checkInId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachResponse: message }),
      });
      if (!res.ok) throw new Error("Failed to send response");
      toast.success(`Message sent to ${clientName}`);
      onSent?.();
    } catch (error) {
      toast.error("Failed to send message");
      console.error(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Message copied");
    } catch (error) {
      toast.error("Could not copy to clipboard");
      console.error(error instanceof Error ? error.message : "Unknown error");
    }
  };

  return (
    <div>
      <SectionLabel
        label="Reply"
        meta={sentAt ? `Sent ${format(new Date(sentAt), "MMM d")}` : undefined}
      />
      <div className="rounded-[6px] bg-white p-5">
        {hasSent && sentMessage && (
          <div className="mb-4">
            <span className={LABEL_CLASS}>Already sent</span>
            <div className="mt-1.5">
              <ReviewProse tone="muted">{sentMessage}</ReviewProse>
            </div>
          </div>
        )}

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          placeholder="No draft message yet."
          aria-label={hasSent ? "Follow-up message" : "Reply to the client"}
          className="resize-none bg-white"
        />

        {/* Actions sit at the right edge with the primary outermost (divider
            grammar: identity left, actions right), so Copy reads first. */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-8 gap-1.5 text-xs text-[#5a7d82] hover:text-[#0c1a1e]"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
            Copy
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="h-8 gap-1.5 bg-[#0d9488] text-xs text-white hover:bg-[#0b7f75]"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
            {hasSent ? "Send follow-up" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
};
