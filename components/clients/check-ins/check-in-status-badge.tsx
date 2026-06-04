import { Badge } from "@/components/ui/badge";
import type { CheckInStatus } from "@/types/check-in";

const STATUS_CONFIG: Record<
  CheckInStatus,
  { label: string; variant: "warning" | "info" | "success" }
> = {
  pending: { label: "Pending", variant: "warning" },
  ai_processed: { label: "AI Processed", variant: "info" },
  reviewed: { label: "Reviewed", variant: "success" },
};

export const CheckInStatusBadge = ({ status }: { status: CheckInStatus }) => {
  const { label, variant } = STATUS_CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
};
