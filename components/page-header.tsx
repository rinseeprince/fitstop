import Link from "next/link"
import { ArrowLeft } from "lucide-react"

interface PageHeaderProps {
  title: string
  description?: string
  backHref?: string
  actions?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  backHref,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-6 lg:px-8 h-[72px]">
      {backHref && (
        <Link
          href={backHref}
          className="text-[#93b0b4] hover:text-[#5a7d82] transition-colors"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-semibold tracking-tight truncate text-[#0c1a1e]">{title}</h1>
        {description && (
          <p className="text-sm text-[#5a7d82] truncate">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 pr-20 flex-shrink-0">{actions}</div>}
    </div>
  )
}
