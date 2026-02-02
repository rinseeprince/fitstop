"use client";

import { useState } from "react";
import { Send, Calendar, MessageSquare } from "lucide-react";
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

  const characterCount = response.length;
  const wordCount = response.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Your Response</h4>
        <div className="text-xs text-muted-foreground">
          {wordCount} words · {characterCount} characters
        </div>
      </div>

      <Textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder={`Write your feedback to ${clientName}...\n\nTip: The AI has drafted a response for you above. Feel free to edit it or write your own!`}
        rows={10}
        className="resize-none font-sans"
      />

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // TODO: Implement schedule call functionality
              toast.info("Schedule call feature coming soon!");
            }}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Schedule Call
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // TODO: Implement quick message functionality
              toast.info("Quick message feature coming soon!");
            }}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Quick Message
          </Button>
        </div>

        <Button
          onClick={handleSend}
          disabled={isSending || !response.trim()}
        >
          {isSending ? (
            <>
              <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin mr-2" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Send Response
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {clientName} will receive an email with your response
      </p>
    </div>
  );
};
