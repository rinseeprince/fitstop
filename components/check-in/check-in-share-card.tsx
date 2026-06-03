"use client";

import { useState } from "react";
import { Send, Copy, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type CheckInShareCardProps = {
  checkInId: string;
  clientName: string;
  clientMessage: string;
  onSent?: () => void;
};

// "What to say": the AI-drafted message for the client. The coach can send it
// straight away, edit it in place, or copy it to paste elsewhere.
export const CheckInShareCard = ({
  checkInId,
  clientName,
  clientMessage,
  onSent,
}: CheckInShareCardProps) => {
  const [message, setMessage] = useState(clientMessage);
  const [isEditing, setIsEditing] = useState(false);
  const [isSending, setIsSending] = useState(false);

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
    <div className="bg-[rgba(13,148,136,0.05)] border border-[rgba(13,148,136,0.15)] rounded-[6px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Send className="w-3.5 h-3.5 text-[#0d9488]" strokeWidth={1.5} />
        <span className="text-sm font-medium text-[#0c1a1e]">Share with client</span>
      </div>

      {isEditing ? (
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          className="resize-none bg-white border-[rgba(13,148,136,0.15)] rounded-[6px] text-sm text-[#0c1a1e] mb-3 focus:border-[#0d9488]"
        />
      ) : (
        <p className="text-sm text-[#0c1a1e] leading-relaxed whitespace-pre-line mb-3">
          {message || "No draft message yet."}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={isSending || !message.trim()}
          className="text-xs h-8 gap-1.5 bg-[#0d9488] hover:bg-[#0f766e] text-white"
        >
          <Send className="w-3.5 h-3.5" strokeWidth={1.5} />
          Send
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing((value) => !value)}
          className="text-xs h-8 gap-1.5 bg-white border-[rgba(13,148,136,0.2)] text-[#5a7d82] hover:text-[#0c1a1e]"
        >
          {isEditing ? <Check className="w-3.5 h-3.5" strokeWidth={1.5} /> : <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />}
          {isEditing ? "Done" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="text-xs h-8 gap-1.5 text-[#5a7d82] hover:text-[#0c1a1e]"
        >
          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
          Copy
        </Button>
      </div>
    </div>
  );
};
