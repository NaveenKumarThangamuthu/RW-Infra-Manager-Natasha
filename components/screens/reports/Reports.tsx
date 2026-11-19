"use client";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileCode, FileSpreadsheet, FileText, RefreshCw, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { bytes } from "@/components/natasha/format";
import { Banner, EmptyState, ErrorNote, PageHeader, Screen, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { ReportViewer } from "./ReportViewer";
import { KIND_META, type ReportEntry, type ReportKind, type ReportsResp } from "./types";

const ICONS: Record<ReportKind, LucideIcon> = { pdf: FileText, csv: FileSpreadsheet, html: FileCode };
const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

function ReportList({ reports, activeId, onPick }: { reports: ReportEntry[]; activeId: string; onPick: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <nav aria-label="Reports">
        {reports.map((r) => {
          const active = r.id === activeId;
          const Icon = ICONS[r.kind];
          return (
            <button key={r.id} type="button" aria-current={active ? "true" : undefined} onClick={() => onPick(r.id)}
              className={cn("flex w-full cursor-pointer items-start gap-3 border-0 border-b border-solid border-border bg-transparent px-4 py-3 text-left hover:bg-hover", active && "bg-hover")}
              style={active ? { boxShadow: "inset 3px 0 0 var(--brand)" } : undefined}>
              <span className="mt-0.5 text-muted-foreground"><Icon size={16} className="block" /></span>
              <span className="min-w-0">
                <span className="block break-words text-[13.5px] font-medium">{r.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <Badge size="xs" tone={KIND_META[r.kind].color}>{KIND_META[r.kind].label}</Badge>
                  <span>{new Date(r.modifiedAt).toLocaleDateString("en-GB", DATE_OPTS)}</span>
                  <span>{bytes(r.sizeBytes)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </Card>
  );
}

function Inner() {
  const router = useRouter();
  const pathname = usePathname();
  const selectedId = useSearchParams().get("r");
  const { data, error, reload } = useJson<ReportsResp>("/api/reports");
  const reports = data?.reports ?? [];
  const selected = reports.find((x) => x.id === selectedId) ?? reports[0];
  const pick = (id: string) => router.replace(`${pathname}?r=${encodeURIComponent(id)}`, { scroll: false });

  return (
    <Screen label="Reports">
      <PageHeader title="Reports" description="Incident write-ups, data exports and generated reports. Pick one to read it here."
        actions={<Button onClick={reload}><RefreshCw size={14} />Refresh</Button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true">
          <Skeleton className="h-[200px] rounded-[12px]" />
          <Skeleton className="h-[420px] rounded-[12px]" />
        </div>
      )}
      {data && reports.length === 0 && (
        <Card><EmptyState title="No reports yet">Reports appear here once they are added to the server.</EmptyState></Card>
      )}
      {selected && (
        <>
          {selectedId && !reports.some((x) => x.id === selectedId) && (
            <Banner tone="var(--warning)">That report is no longer available. Showing the newest one instead.</Banner>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <ReportList reports={reports} activeId={selected.id} onPick={pick} />
            <div className="min-w-0"><ReportViewer report={selected} /></div>
          </div>
        </>
      )}
    </Screen>
  );
}

export default function Reports() {
  return (
    <Suspense fallback={<Skeleton className="h-[320px] rounded-[12px]" />}>
      <Inner />
    </Suspense>
  );
}
