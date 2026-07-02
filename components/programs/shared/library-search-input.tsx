"use client"

import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export function LibrarySearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93b0b4]"
        strokeWidth={1.5}
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-[260px] pl-9 text-sm"
      />
    </div>
  )
}
