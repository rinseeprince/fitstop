"use client";

import { useEffect, useRef } from "react";
import { useUnreviewedCheckIns } from "@/hooks/use-check-in-data";
import { useToast } from "@/hooks/use-toast";

export function CheckInNotificationListener() {
  const { checkIns } = useUnreviewedCheckIns();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (checkIns.length === 0) return;

    // On first load, seed the seen set without toasting
    if (!initializedRef.current) {
      seenIdsRef.current = new Set(checkIns.map((c) => c.id));
      initializedRef.current = true;
      return;
    }

    const newCheckIns = checkIns.filter((c) => !seenIdsRef.current.has(c.id));
    if (newCheckIns.length === 0) return;

    for (const c of newCheckIns) seenIdsRef.current.add(c.id);

    if (newCheckIns.length === 1) {
      toast({
        title: "New check-in received",
        description: `${newCheckIns[0].clientName || "A client"} submitted a check-in`,
      });
    } else {
      toast({
        title: `${newCheckIns.length} new check-ins`,
        description: "New check-ins are ready for review",
      });
    }
  }, [checkIns, toast]);

  return null;
}
