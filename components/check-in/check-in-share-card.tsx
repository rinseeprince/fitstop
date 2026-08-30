"use client";

import { useEffect, useState } from "react";
import { Send, Copy, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ReviewBlock, ReviewProse } from "@/components/clients/check-ins/review-block";

type CheckInShareCardProps = {
  checkInId: string;
  clientName: string;
  clientMessage: string;
  onSent?: () => void;
};

// "What to say": the AI-drafted message for the client. The coach can send it
// straight away, edit it in place, or copy it to paste elsewhere. A sub-block
// of the AI review card since C4 — it owns the send/copy/edit logic, not a
// card shell of its own.
export const CheckInShareCard = ({
  checkInId,
  clientName,
  clientMessage,
  onSent,
}: CheckInShareCardProps) => {
  const [message, setMessage] = useState(clientMessage);
  const [isEditing, setIsEditing] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // The draft is a PROP, and `useState` only seeds from it once: before this,
  // a regenerate rewrote the draft upstream while this card kept showing —
  // and would have sent — the previous one. Deliberately an effect rather than
  // a `key` reset on the parent: a remount would also drop `isSending` if a
  // regenerate landed mid-send. A new draft replaces the local copy, which is
  // what "regenerate" means.
  useEffect(() => {
    setMessage(clientMessage);
  }, [clientMessage]);

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
    <ReviewBlock
      label="Share with client"
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsEditing((value) => !value)}
          aria-label={isEditing ? "Done editing message" : "Edit message"}
          className="h-8 w-8 p-0 text-[#93b0b4] hover:text-[#5a7d82]"
        >
          {isEditing ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </Button>
      }
    >
      {isEditing ? (
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          className="resize-none bg-white"
        />
      ) : (
        <ReviewProse>{message || "No draft message yet."}</ReviewProse>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={isSending || !message.trim()}
          className="h-8 gap-1.5 bg-[#0d9488] text-xs text-white hover:bg-[#0b7f75]"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
          Send
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="h-8 gap-1.5 text-xs text-[#5a7d82] hover:text-[#0c1a1e]"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
          Copy
        </Button>
      </div>
    </ReviewBlock>
  );
};
