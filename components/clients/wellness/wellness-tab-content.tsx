"use client";

import { WellnessHistoryTable } from "@/components/clients/wellness/wellness-history-table";

type Props = {
  client: { id: string };
};

export function WellnessTabContent({ client }: Props) {
  return <WellnessHistoryTable clientId={client.id} />;
}
