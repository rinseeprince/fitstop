"use client"

import { Button } from "@/components/ui/button"
import { Link2, UserPlus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface OverviewHeaderProps {
  clientId: string
}

export function OverviewHeader({ clientId: _clientId }: OverviewHeaderProps) {
  const { toast } = useToast()

  const handleCopyLink = () => {
    void navigator.clipboard.writeText(window.location.href)
    toast({ title: "Link copied to clipboard" })
  }

  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-[18px] font-bold text-[#0c1a1e]">Overview</h2>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyLink}
          className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] rounded-[6px] hover:bg-[rgba(13,148,136,0.03)]"
        >
          <Link2 className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
          Copy Link
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] rounded-[6px] hover:bg-[rgba(13,148,136,0.03)]"
        >
          <UserPlus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
          Invite
        </Button>
      </div>
    </div>
  )
}
