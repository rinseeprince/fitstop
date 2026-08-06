"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus, ClipboardList, PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { createClientSchema, type CreateClientInput } from "@/lib/validations/client";
import { AddClientIntakeForm } from "@/components/clients/add-client-intake-form";
import { AddClientManualForm } from "@/components/clients/add-client-manual-form";

type AddClientDialogProps = {
  trigger?: React.ReactNode;
  onClientAdded?: () => void;
};

type SetupMode = "intake" | "manual" | null;

export const AddClientDialog = ({ trigger, onClientAdded }: AddClientDialogProps) => {
  const [open, setOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const { toast } = useToast();

  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    // No unit defaults. Weights and lengths on this payload are canonical
    // kilograms/centimetres; the form converts from the coach's own display
    // units on the way in (components/clients/add-client-manual-form.tsx).
    defaultValues: {
      name: "",
      email: "",
      notes: "",
    },
  });

  const onSubmit = async (data: CreateClientInput) => {
    try {
      const payload = { ...data, setupMode: setupMode ?? undefined };
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result: { client?: unknown; inviteSent?: boolean; error?: string } = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create client");
      }

      const message = setupMode === "intake"
        ? result.inviteSent
          ? `Intake questionnaire sent to ${data.email}.`
          : `${data.name} added but invite email failed — send manually from their profile.`
        : `${data.name} has been added to your client list.`;

      toast({
        title: "Client added",
        description: message,
        variant: setupMode === "intake" && !result.inviteSent ? "destructive" : undefined,
      });

      form.reset();
      setSetupMode(null);
      setOpen(false);

      onClientAdded?.();
    } catch (error) {
      toast({
        title: "Failed to add client",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.reset();
      setSetupMode(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg transition-all hover:scale-110"
          >
            <UserPlus className="h-4 w-4" />
            <span className="sr-only">Add New Client</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
          <DialogDescription>
            {setupMode === null
              ? "Choose how you want to set up this client."
              : setupMode === "intake"
                ? "Enter basic details. The client will complete an intake questionnaire."
                : "Add a new client to your roster with full details."}
          </DialogDescription>
        </DialogHeader>

        {/* Setup mode selection */}
        {setupMode === null && (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setSetupMode("intake")}
              className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ClipboardList className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Send intake questionnaire</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Client fills out goals, training, nutrition, and medical history
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSetupMode("manual")}
              className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <PenLine className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Set up manually</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enter all client details yourself
                </p>
              </div>
            </button>
          </div>
        )}

        {setupMode === "intake" && (
          <AddClientIntakeForm
            form={form}
            onSubmit={onSubmit}
            onBack={() => setSetupMode(null)}
          />
        )}

        {setupMode === "manual" && (
          <AddClientManualForm
            form={form}
            onSubmit={onSubmit}
            onBack={() => setSetupMode(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
