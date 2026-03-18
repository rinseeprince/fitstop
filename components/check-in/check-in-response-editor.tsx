"use client";

import { useState } from "react";
import { Send, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type CheckInResponseEditorProps = {
  checkInId: string;
  initialResponse?: string;
  clientName: string;
  onSent?: () => void;
};

export const CheckInResponseEditor = ({
  checkInId,
  initialResponse = "",
  clientName,
  onSent,
}: CheckInResponseEditorProps) => {
  const [response, setResponse] = useState(initialResponse);
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!response.trim()) {
      toast.error("Please write a response before sending");
      return;
    }

    setIsSending(true);

    try {
      const res = await fetch(`/api/check-in/${checkInId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachResponse: response }),
      });

      if (!res.ok) {
        throw new Error("Failed to send response");
      }

      toast.success(`Response sent to ${clientName}`);
      onSent?.();
    } catch (error) {
      toast.error("Failed to send response");
      console.error(error);
    } finally {
      setIsSending(false);
    }
  };

  const _characterCount = response.length;
  const _wordCount = response.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder={`Write your feedback to ${clientName}...`}
        rows={10}
        className="resize-none font-sans border-0 focus-visible:ring-0 rounded-b-none"
      />
      <div className="flex items-center justify-end gap-1.5 px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          className="w-8 h-8 text-muted-foreground hover:text-foreground"
          onClick={() => {
            toast.info("Schedule call feature coming soon!");
          }}
        >
          <Calendar className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleSend}
          disabled={isSending || !response.trim()}
          className="w-8 h-8 text-primary hover:text-primary/80"
        >
          {isSending ? (
            <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
