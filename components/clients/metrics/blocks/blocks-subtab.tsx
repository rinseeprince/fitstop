"use client";

import { Flag } from "lucide-react";
import { SectionLabel } from "@/components/programs/shared/section-label";

// The Journey tab's Blocks pane. Session 3.1 lands the pane shell; the block
// list, facts and add/delete flows arrive in Tasks 3.2–3.4.

type BlocksSubtabProps = {
  clientId: string;
};

export function BlocksSubtab({ clientId: _clientId }: BlocksSubtabProps) {
  return (
    <div>
      <SectionLabel label="Blocks" />
      <div className="rounded-[6px] bg-white py-12 px-5 text-center">
        <Flag className="mx-auto h-8 w-8 text-[#93b0b4] opacity-50" strokeWidth={1.5} />
        <p className="mt-2 text-sm text-[#5a7d82]">No blocks yet</p>
        <p className="mt-1 text-xs text-[#93b0b4]">
          Blocks are named stretches of this client&apos;s journey — a cut, a
          build, a deload — with the training, nutrition and weight story of
          each.
        </p>
      </div>
    </div>
  );
}
