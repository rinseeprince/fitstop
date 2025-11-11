"use client";

import { useState, useEffect } from "react";
import { Link2, Mail, MessageSquare, Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SendCheckInDialogProps = {
  clientId: string;
  clientName: string;
  clientEmail?: string;
  trigger?: React.ReactNode;
};

export const SendCheckInDialog = ({
  clientId,
  clientName,
  clientEmail,
  trigger,
}: SendCheckInDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [checkInLink, setCheckInLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateLink = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/check-in/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });

      const data = await response.json();

      if (response.ok && data.link) {
        setCheckInLink(data.link);
      } else {
        throw new Error("Failed to generate link");
      }
    } catch (error) {
      console.error("Error generating check-in link:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!checkInLink) return;

    try {
      await navigator.clipboard.writeText(checkInLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const openInNewTab = () => {
    if (checkInLink) {
      window.open(checkInLink, "_blank");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset state when closing
      setTimeout(() => {
        setCheckInLink(null);
        setCopied(false);
      }, 200);
    }
  };

  // Auto-generate link when dialog opens
  useEffect(() => {
    if (open && !checkInLink && !isGenerating) {
      generateLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <MessageSquare className="w-4 h-4 mr-2" />
            Send Check-In
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Check-In to {clientName}</DialogTitle>
          <DialogDescription>
            Generate a secure link for {clientName} to complete their check-in
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">
                Generating secure link...
              </p>
            </div>
          ) : checkInLink ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="link">Check-In Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="link"
                    value={checkInLink}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={copyToClipboard}
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                {copied && (
                  <p className="text-xs text-green-600">Copied to clipboard!</p>
                )}
              </div>

              <div className="glass-card p-4 space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <p className="text-muted-foreground">
                    Link expires in 7 days
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <p className="text-muted-foreground">
                    Can only be used once
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <p className="text-muted-foreground">
                    No login required for client
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={openInNewTab}
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                {clientEmail && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      window.location.href = `mailto:${clientEmail}?subject=Weekly Check-In&body=Hi ${clientName},%0D%0A%0D%0ATime for your weekly check-in! Click the link below:%0D%0A%0D%0A${checkInLink}%0D%0A%0D%0AThanks!`;
                    }}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Email
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">
                Click "Generate Link" to create a check-in link
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
