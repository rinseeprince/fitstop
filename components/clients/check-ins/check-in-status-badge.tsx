import { Badge } from "@/components/ui/badge";
import { getStatusLabel } from "@/lib/check-in-utils";
import type { CheckInStatus } from "@/types/check-in";

// Label reuses getStatusLabel (single source of truth); the variant maps to the
// Badge color API (getStatusColor returns raw Tailwind classes, not variants).
const STATUS_VARIANT: Record<CheckInStatus, "warning" | "info" | "success"> = {
  pending: "warning",
  ai_processed: "info",
  reviewed: "success",
};

export const CheckInStatusBadge = ({ status }: { status: CheckInStatus }) => (
  <Badge variant={STATUS_VARIANT[status]}>{getStatusLabel(status)}</Badge>
);
