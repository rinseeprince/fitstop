"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import {
  HistoryTable,
  type ColumnDef,
} from "@/components/clients/history-table/history-table";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DividerPager } from "@/components/programs/shared/divider-pager";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import {
  formatDayName,
  formatLogDate,
  formatSigned,
  TONE_TEXT,
} from "./metrics-format";
import type { LogRow } from "./metrics-view-types";

type MeasurementLogSectionProps = {
  /** Newest-first rows for the CURRENT tab; the host remounts with key={tab}
   *  so the internal page state resets on tab switch. */
  rows: LogRow[];
};

function renderDash() {
  return <span className="text-[#93b0b4]">—</span>;
}

function renderChange(change: LogRow["change"]) {
  if (!change) return renderDash();
  const Icon = change.amount > 0 ? ArrowUp : change.amount < 0 ? ArrowDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5", TONE_TEXT[change.tone])}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      <span className={cn(MONO, "text-[11px] tabular-nums")}>
        {formatSigned(change.amount)}
      </span>
    </span>
  );
}

// Columns are state-free; module scope keeps the component body to paging.
const COLUMNS: ColumnDef<LogRow>[] = [
  {
    key: "date",
    label: "Date",
    render: (_v, row) => (
      <span className={cn(MONO, "tabular-nums text-[#93b0b4]")}>
        {formatLogDate(row.date)}
      </span>
    ),
  },
  {
    key: "day",
    label: "Day",
    render: (_v, row) => (
      <span className="text-[#93b0b4]">{formatDayName(row.date)}</span>
    ),
  },
  {
    key: "metricName",
    label: "Metric",
    render: (_v, row) => (
      <span className="text-[#0c1a1e] font-medium">{row.metricName}</span>
    ),
  },
  {
    key: "value",
    label: "Value",
    render: (_v, row) => (
      <span className={cn(MONO, "tabular-nums text-[#0c1a1e]")}>
        {row.value}
        <span className="text-[10px] text-[#93b0b4] ml-1">{row.unit}</span>
      </span>
    ),
  },
  {
    key: "change",
    label: "Change",
    render: (_v, row) => renderChange(row.change),
  },
  {
    key: "note",
    label: "Notes",
    render: (_v, row) => {
      if (!row.note) return renderDash();
      const truncated =
        row.note.length > 50 ? row.note.slice(0, 50) + "…" : row.note;
      return <span className="text-sm text-[#93b0b4]">{truncated}</span>;
    },
  },
];

export function MeasurementLogSection({ rows }: MeasurementLogSectionProps) {
  const [page, setPage] = useState(0);
  const pageRows = rows.slice(
    page * HISTORY_PAGE_SIZE,
    page * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  return (
    <div>
      <SectionLabel
        label="Measurement log"
        actions={
          <DividerPager
            page={page}
            total={rows.length}
            pageSize={HISTORY_PAGE_SIZE}
            noun="entries"
            onPageChange={setPage}
          />
        }
      />
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<LogRow>
          columns={COLUMNS}
          data={pageRows}
          isLoading={false}
          emptyMessage="No measurements logged yet"
        />
      </div>
    </div>
  );
}
