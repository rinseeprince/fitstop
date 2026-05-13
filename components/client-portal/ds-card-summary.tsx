import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DsCardSummaryProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export function DsCardSummary({ title, children, className }: DsCardSummaryProps) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-2 space-y-2">{children}</div>
      </CardContent>
    </Card>
  );
}

type DsCardSummaryRowProps = {
  href?: string;
  prefetch?: boolean;
  ariaLabel?: string;
  leadingText: string;
  trailingText?: string;
  hint?: string;
};

export function DsCardSummaryRow({
  href,
  prefetch,
  ariaLabel,
  leadingText,
  trailingText,
  hint,
}: DsCardSummaryRowProps) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {leadingText}
        </div>
        {trailingText ? (
          <div className="truncate text-xs text-muted-foreground">
            {trailingText}
          </div>
        ) : null}
      </div>
      {href ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {hint ? <span>{hint}</span> : null}
          <ChevronRight
            className="h-4 w-4"
            strokeWidth={1.5}
            aria-hidden="true"
            data-testid="ds-row-chevron"
          />
        </div>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <div className="flex items-center justify-between gap-3">{body}</div>
    );
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md transition",
        "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
      )}
    >
      {body}
    </Link>
  );
}
