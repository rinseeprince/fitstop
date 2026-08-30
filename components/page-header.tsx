interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-6 lg:px-8 h-[72px]">
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
